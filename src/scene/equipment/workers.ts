/**
 * Cuadrillas: trabajadores low-poly instanciados (una InstancedMesh por parte del cuerpo;
 * las partes izquierda/derecha comparten malla con dos instancias por persona).
 *
 * Cada figura tiene su origen en el suelo bajo la pelvis y mira hacia +x local
 * (heading 0 = +x del mundo, positivo hacia +z). La pose se arma en CPU como ángulos de
 * articulaciones (caminar, trabajar, cargar, reposo), se mezcla suavemente al cambiar de
 * acción y se "aterriza" apoyando siempre el pie más bajo en el suelo. Al caminar, cada bota
 * queda plantada mientras sostiene el cuerpo (talón → planta → punta) y las piernas se
 * resuelven con IK de dos huesos, así los pies no patinan sobre la losa.
 *
 * Colores por instancia: chaleco y casco (pose.vest / pose.helmet) van en instanceColor;
 * camisa y piel (fijos por persona) en el atributo iColor2. Un único material comparte
 * programa para todas las partes.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type WorkerAction = 'idle' | 'walk' | 'work' | 'carry';

export interface WorkerPose {
  x: number;
  y: number;
  z: number;
  /** Radianes; 0 = mirando a +x, positivo hacia +z (heading = atan2(dz, dx)). */
  heading: number;
  /** Distancia caminada (m); mueve la fase de la marcha. */
  walk: number;
  action: WorkerAction;
  /** Tiempo (s) para los ciclos de reposo y trabajo. */
  t: number;
  vest: 0 | 1;
  helmet: 0 | 1 | 2 | 3;
  visible: boolean;
}

export interface Crowd {
  group: THREE.Group;
  /** Capacidad (máximo de trabajadores). */
  count: number;
  set(i: number, p: WorkerPose): void;
  /** Sube las matrices de instancia a la GPU (una vez por cuadro, después de los set). */
  commit(): void;
  /** Cajas de selección invisibles; intersection.instanceId = índice del trabajador. */
  pickables: THREE.Object3D[];
}

/** Escala de las figuras (1,75 m reales) para que se lean bien desde la cámara isométrica. */
export const WORKER_SCALE = 1.12;
/** Chaleco reflectante: 0 = amarillo-verde, 1 = naranjo. */
export const VEST_COLORS = ['#c6f02a', '#ff7a1a'] as const;
/** Casco: 0 blanco, 1 amarillo, 2 rojo, 3 azul. */
export const HELMET_COLORS = ['#f3f3ef', '#ffc61a', '#da3a2c', '#2c6ad4'] as const;

const SHIRTS = ['#24324d', '#3b4250', '#59606b', '#2e4a74', '#202329', '#6c737e'];
const SKINS = ['#e2b08b', '#c99470', '#b07a57', '#d79f78', '#91603f', '#eec29f'];
const PANTS = '#2c3241';
const BOOT = '#5b3d25';
const SOLE = '#1c1a18';
const GLOVE = '#d4b47e';
const HAIR = '#4b3628';
const WHITE = '#ffffff';

// ─────────────────────────── medidas (m, sin escalar) ───────────────────────────
const THIGH = 0.41;
const SHIN = 0.4;
const ANKLE = 0.09; // tobillo → suela
const HEEL = -0.085, TOE = 0.21; // largo de la bota respecto al tobillo
const HIP_W = 0.1;
const TORSO_H = 0.53; // pelvis → base del cuello
const SHOULDER_Y = 0.46, SHOULDER_W = 0.245;
const UPPER_ARM = 0.29;
const HAND_Y = -0.28; // centro del guante en el antebrazo
const TAU = Math.PI * 2;

// marcha con pies apoyados: cada bota queda fija en el suelo mientras soporta el cuerpo
/** Metros reales recorridos por ciclo de marcha (dos pasos) a paso normal. */
const STRIDE = 1.4;
/** Fracción del ciclo en que cada pie está apoyado (> 0,5: hay doble apoyo). */
const DUTY = 0.6;
/** Cabeceo de la bota al pisar con el talón (punta arriba) y al despegar con la punta. */
const Q_HEEL = 0.3, Q_TOE = 0.55;
/** Despeje de la bota a mitad del vuelo (m, sin escalar). */
const LIFT = 0.07;
const REACH = (THIGH + SHIN) * 0.995;
/** Altura máxima de la cadera al caminar (pierna de apoyo casi estirada). */
const HIP_UP = ANKLE + REACH - 0.006;
/** Zancada relativa según la rapidez (amp ∈ [0, 1]): a paso lento, pasos cortos. */
const strideK = (amp: number) => 0.4 + 0.6 * amp;

// ─────────────────────────── geometría ───────────────────────────

type Tint = 0 | 1 | 2; // 0 color fijo · 1 instanceColor (chaleco/casco/carga) · 2 iColor2 (camisa/piel)

/** Color por vértice + canal de tinte + brillo propio (cintas reflectantes, tela fluorescente). */
function paint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, tint: Tint = 0, glow = 0) {
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(col, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(n).fill(tint), 1));
  g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
  return g;
}

const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number) =>
  new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);

/** Cilindro vertical (extremidades) entre y0 (arriba) e y1 (abajo). */
const limb = (rTop: number, rBot: number, y0: number, y1: number, seg = 6) =>
  new THREE.CylinderGeometry(rTop, rBot, y0 - y1, seg).translate(0, (y0 + y1) / 2, 0);

const ball = (r: number, ws: number, hs: number) => new THREE.SphereGeometry(r, ws, hs);

/** Media esfera abierta abajo (copa del casco). */
const dome = (r: number, ws: number, hs: number) => new THREE.SphereGeometry(r, ws, hs, 0, TAU, 0, Math.PI / 2);

/** Tronco de pirámide rectangular: fondo d (x) y ancho w (z) abajo (y0) y arriba (y1). */
function taper(d0: number, w0: number, d1: number, w1: number, y0: number, y1: number) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 0;
    p.setXYZ(i, p.getX(i) * (top ? d1 : d0), top ? y1 : y0, p.getZ(i) * (top ? w1 : w0));
  }
  g.computeVertexNormals();
  return g;
}

function merge(parts: THREE.BufferGeometry[]) {
  const g = mergeGeometries(parts);
  if (!g) throw new Error('workers: no se pudieron unir las geometrías');
  parts.forEach((p) => p.dispose());
  return g;
}

/** Chaleco: fondo y ancho a la altura y (sigue el tronco del torso, un poco más holgado). */
const VEST_Y0 = -0.035, VEST_Y1 = 0.44;
const vestAt = (y: number) => {
  const k = (y - VEST_Y0) / (VEST_Y1 - VEST_Y0);
  return { d: 0.236 + 0.02 * k, w: 0.356 + 0.07 * k };
};
const STRIPE = '#dfe3e6';

function buildGeometries() {
  const v0 = vestAt(VEST_Y0), v1 = vestAt(VEST_Y1);
  const torsoParts = [
    paint(box(0.205, 0.17, 0.32, 0, -0.045, 0), PANTS), // pelvis
    paint(taper(0.2, 0.32, 0.22, 0.4, -0.02, TORSO_H), WHITE, 2), // camisa
    paint(box(0.13, 0.04, 0.17, 0, TORSO_H + 0.01, 0), WHITE, 2), // cuello de la camisa
    paint(taper(v0.d, v0.w, v1.d, v1.w, VEST_Y0, VEST_Y1), WHITE, 1, 0.16),
    paint(box(0.006, 0.44, 0.014, vestAt(0.2).d / 2 + 0.004, 0.2, 0), '#7a7a7a', 1, 0.08), // cierre
  ];
  // cintas reflectantes horizontales
  for (const y of [0.08, 0.19]) {
    const a = vestAt(y), b = vestAt(y + 0.036);
    torsoParts.push(paint(taper(a.d + 0.012, a.w + 0.012, b.d + 0.012, b.w + 0.012, y, y + 0.036), STRIPE, 0, 0.35));
  }
  const top = TORSO_H + 0.005;
  for (const s of [-1, 1]) {
    torsoParts.push(
      paint(box(0.25, top - 0.4, 0.09, 0, (top + 0.4) / 2, s * 0.115), WHITE, 1, 0.16), // tirante sobre el hombro
      paint(box(0.262, top - 0.226, 0.036, 0, (top + 0.226) / 2, s * 0.115), STRIPE, 0, 0.35), // cinta vertical
      paint(box(0.262, 0.012, 0.036, 0, top + 0.002, s * 0.115), STRIPE, 0, 0.35), // ... y sobre el hombro
      paint(box(0.04, 0.03, 0.04, 0.12, 0.31, s * 0.065), '#bfc4c8', 1, 0.05), // broche
    );
  }

  const head = merge([
    paint(limb(0.056, 0.06, 0.09, -0.03), WHITE, 2), // cuello
    paint(ball(0.125, 8, 5).scale(1, 1.1, 0.96).translate(0.005, 0.21, 0), WHITE, 2), // cabeza
    paint(box(0.04, 0.05, 0.034, 0.126, 0.195, 0), WHITE, 2), // nariz
    paint(box(0.036, 0.05, 0.022, -0.01, 0.2, 0.12), WHITE, 2), // orejas
    paint(box(0.036, 0.05, 0.022, -0.01, 0.2, -0.12), WHITE, 2),
    paint(box(0.012, 0.024, 0.022, 0.119, 0.228, 0.048), '#17171c'), // ojos
    paint(box(0.012, 0.024, 0.022, 0.119, 0.228, -0.048), '#17171c'),
    paint(box(0.05, 0.05, 0.16, -0.112, 0.238, 0), HAIR), // nuca bajo el casco
    // casco: copa, ala con visera al frente y nervio central
    paint(dome(0.148, 10, 3).scale(1.08, 0.86, 1).translate(0, 0.265, 0), WHITE, 1),
    paint(new THREE.CylinderGeometry(0.158, 0.161, 0.022, 10).scale(1.1, 1, 1).translate(0.03, 0.266, 0), WHITE, 1),
    paint(dome(0.148, 6, 3).scale(1.13, 0.93, 0.22).translate(0, 0.265, 0), '#d6d6d6', 1),
  ]);

  const upper = merge([
    paint(ball(0.076, 7, 4), WHITE, 2), // hombro
    paint(limb(0.066, 0.056, 0, -UPPER_ARM - 0.01), WHITE, 2),
  ]);
  const fore = merge([
    paint(ball(0.057, 6, 3), WHITE, 2), // codo
    paint(limb(0.056, 0.047, 0, -0.225), WHITE, 2),
    paint(box(0.078, 0.105, 0.064, 0.006, HAND_Y, 0), GLOVE),
    paint(box(0.03, 0.05, 0.03, 0.052, HAND_Y + 0.025, 0), GLOVE), // pulgar
  ]);
  const thigh = merge([paint(limb(0.096, 0.078, 0.04, -THIGH - 0.01), PANTS)]);
  const shin = merge([
    paint(limb(0.077, 0.062, 0.03, -0.27), PANTS),
    paint(limb(0.068, 0.067, -0.24, -SHIN + 0.005), BOOT), // caña de la bota
  ]);
  const foot = merge([
    paint(box(0.19, 0.085, 0.122, 0.015, -0.035, 0), BOOT),
    paint(box(0.1, 0.055, 0.116, 0.155, -0.05, 0), BOOT), // puntera
    paint(box(TOE - HEEL, 0.02, 0.13, (TOE + HEEL) / 2, -ANKLE + 0.01, 0), SOLE),
  ]);

  // tablas cargadas al frente (marco del torso, sobre las manos)
  const prop = merge(
    ['#c99a5c', '#b5844a', '#d6a96e'].map((c, k) =>
      paint(box(0.2, 0.034, 1.3 - k * 0.1, 0.37 + k * 0.006, 0.225 + k * 0.035, (k - 1) * 0.05), c, 1),
    ),
  );

  // martillo en la mano derecha (marco del antebrazo), mango inclinado γ bajo +x
  const gamma = 1.1;
  const tool = merge([
    paint(box(0.32, 0.026, 0.026, 0.1, 0, 0), '#b8894f'),
    paint(box(0.045, 0.13, 0.045, 0.27, 0, 0), '#596068'),
  ]);
  tool.rotateZ(-gamma).translate(0.006, HAND_Y, 0);

  const proxy = new THREE.BoxGeometry(0.62, 1.95, 0.62).translate(0, 0.975, 0);
  return { torso: merge(torsoParts), head, upper, fore, thigh, shin, foot, prop, tool, proxy };
}

// ─────────────────────────── material ───────────────────────────

let material: THREE.MeshStandardMaterial | null = null;

/** Material único: color por vértice × (instanceColor | iColor2 según aTint) + brillo propio. */
function crowdMaterial() {
  if (material) return material;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, flatShading: true });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <color_pars_vertex>',
        '#include <color_pars_vertex>\nattribute float aTint;\nattribute float aGlow;\nattribute vec3 iColor2;\nvarying float vGlow;',
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
#ifdef USE_INSTANCING_COLOR
vColor = color * (aTint < 0.5 ? vec3(1.0) : (aTint < 1.5 ? instanceColor : iColor2));
#endif
vGlow = aGlow;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_pars_fragment>', '#include <color_pars_fragment>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow;');
  };
  m.customProgramCacheKey = () => 'crowd-worker';
  return (material = m);
}

// ─────────────────────────── poses ───────────────────────────
// Vector de pose (radianes). Ángulos de cabeceo positivos = hacia adelante (+x).
const LEAN = 0, TWIST = 1, ROLL = 2, HIPYAW = 3, SHIFT = 4;
const THL = 5, THR = 6, KNL = 7, KNR = 8, FTL = 9, FTR = 10, SPREAD = 11;
const SHL = 12, SHR = 13, ABL = 14, ABR = 15, ELL = 16, ELR = 17;
const HYAW = 18, HPITCH = 19, BREATH = 20, PROP = 21, TOOL = 22;
const NP = 23;

const ACTIONS: Record<WorkerAction, number> = { idle: 0, walk: 1, work: 2, carry: 3 };

const clamp = THREE.MathUtils.clamp;
const fract = (x: number) => x - Math.floor(x);
const smooth = (x: number) => {
  x = clamp(x, 0, 1);
  return x * x * (3 - 2 * x);
};
/** Pulso suave 0→1→0 entre a y b (c ∈ [0, 1)). */
const pulse = (c: number, a: number, b: number) => {
  const e = (b - a) * 0.25;
  return smooth((c - a) / e) * smooth((b - c) / e);
};

/** Tobillo de la bota en curso: (x, y) sobre el suelo respecto de la cadera y cabeceo q (rad, + = punta arriba). */
const ank = new Float64Array(3);
/** Bota en el suelo con el tobillo plano en x = fx, girando sobre el talón (q > 0) o la punta (q < 0). */
function plant(fx: number, q: number) {
  const p = q > 0 ? HEEL : TOE;
  ank[0] = fx + p * (1 - Math.cos(q)) - ANKLE * Math.sin(q);
  ank[1] = ANKLE * Math.cos(q) - p * Math.sin(q);
  ank[2] = q;
}

/** Altura máxima de la cadera para que la pierna alcance un tobillo en (x, y). */
const reach = (x: number, y: number) => y + Math.sqrt(Math.max(0, REACH * REACH - x * x));

/**
 * Trayectoria de una bota relativa a la cadera (marco local, sin escalar) para la fase u ∈ [0, 1)
 * (0 = pisa con el talón). S = recorrido de la cadera durante el apoyo. Devuelve la altura máxima
 * de cadera que permite esta pierna: apoyada, la que alcanza; en la segunda mitad del vuelo baja
 * suave hacia la del próximo apoyo (la cadera desciende antes de pisar, no de golpe).
 */
function footPath(u: number, S: number, amp: number) {
  const qh = Q_HEEL * amp, qt = Q_TOE * amp;
  if (u < DUTY) {
    // apoyo: talón → planta → punta, siempre girando sobre el punto que toca el suelo
    const k = u / DUTY;
    plant(S * (0.5 - k), k < 0.15 ? qh * (1 - smooth(k / 0.15)) : -qt * smooth((k - 0.55) / 0.45));
    return reach(ank[0], ank[1]);
  }
  // vuelo: Hermite entre el despegue y el siguiente apoyo, con la velocidad del apoyo en los extremos
  const k = (u - DUTY) / (1 - DUTY);
  plant(-S / 2, -qt);
  const x0 = ank[0], y0 = ank[1];
  plant(S / 2, qh);
  const x1 = ank[0], y1 = ank[1];
  const land = reach(x1, y1);
  const m = (-S * (1 - DUTY)) / DUTY;
  const k2 = k * k, k3 = k2 * k, e = smooth(k);
  const q = -qt + (qh + qt) * e;
  const y = y0 + (y1 - y0) * e;
  const low = y + Math.min(HEEL * Math.sin(q), TOE * Math.sin(q)) - ANKLE * Math.cos(q);
  ank[0] = (2 * k3 - 3 * k2 + 1) * x0 + (k3 - 2 * k2 + k) * m + (3 * k2 - 2 * k3) * x1 + (k3 - k2) * m;
  ank[1] = y - Math.min(0, low) + LIFT * amp * Math.sin(Math.PI * k);
  ank[2] = q;
  return land + (HIP_UP - land) * (1 - smooth((k - 0.5) / 0.5));
}

/** IK de dos huesos en el plano sagital: tobillo en (dx, dy) respecto de la cadera; la rodilla va adelante. */
function legIK(o: Float32Array, side: number, dx: number, dy: number, q: number) {
  const d = Math.min(Math.hypot(dx, dy), REACH);
  const cosK = (THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN);
  const cosH = (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d);
  o[THL + side] = Math.atan2(dx, -dy) + Math.acos(clamp(cosH, -1, 1));
  o[KNL + side] = Math.PI - Math.acos(clamp(cosK, -1, 1));
  o[FTL + side] = q;
}

const legs = new Float64Array(6);
/**
 * Piernas de la marcha para la fase c (ciclos): pies plantados, cadera a la altura que alcanza la
 * pierna de apoyo (el vaivén vertical sale solo). Devuelve cuánto adelanta la pierna izquierda (−1…1)
 * para balancear brazos y torso.
 */
function walkLegs(o: Float32Array, c: number, amp: number) {
  const S = (DUTY * STRIDE * strideK(amp)) / WORKER_SCALE;
  let h = HIP_UP;
  for (let side = 0; side < 2; side++) {
    h = Math.min(h, footPath(fract(c + side * 0.5), S, amp));
    legs.set(ank, side * 3);
  }
  for (let side = 0; side < 2; side++) legIK(o, side, legs[side * 3], legs[side * 3 + 1] - h, legs[side * 3 + 2]);
  const s = Math.cos(TAU * c) * amp;
  o[SPREAD] = 0.03;
  o[HIPYAW] = -0.07 * s;
  o[ROLL] = 0.02 * s;
  return s;
}

function poseWalk(o: Float32Array, c: number, amp: number) {
  const s = walkLegs(o, c, amp);
  o[SHL] = -0.4 * s;
  o[SHR] = 0.4 * s;
  o[ELL] = 0.2 + 0.4 * Math.max(0, o[SHL]);
  o[ELR] = 0.2 + 0.4 * Math.max(0, o[SHR]);
  o[ABL] = o[ABR] = 0.09;
  o[LEAN] = 0.06 * amp;
  o[TWIST] = 0.08 * s;
  o[HYAW] = -0.06 * s;
  o[HPITCH] = 0.04;
}

function poseCarry(o: Float32Array, c: number, amp: number) {
  const s = walkLegs(o, c, amp);
  o[SHL] = o[SHR] = 0.3;
  o[ELL] = o[ELR] = 1.25;
  o[ABL] = o[ABR] = 0.02;
  o[LEAN] = -0.04;
  o[TWIST] = 0.025 * s;
  o[HYAW] = -0.025 * s;
  o[HPITCH] = 0.08;
  o[PROP] = 1;
}

/** Reposo: respiración, peso que cambia de pierna, mira alrededor; algunos conversan o señalan. */
function poseIdle(o: Float32Array, t: number, v: number) {
  const br = Math.sin(t * 1.8), sw = Math.sin(t * 0.43 + v * 5);
  o[THL] = 0.02 + 0.03 * sw;
  o[THR] = -0.03 + 0.03 * sw;
  o[KNL] = 0.03 + 0.1 * Math.max(0, -sw);
  o[KNR] = 0.03 + 0.1 * Math.max(0, sw);
  o[SPREAD] = 0.06;
  o[ROLL] = 0.02 * sw;
  o[HIPYAW] = 0.05 * sw;
  o[TWIST] = -0.04 * sw;
  o[SHL] = o[SHR] = 0.02 + 0.015 * br;
  o[ABL] = o[ABR] = 0.11;
  o[ELL] = o[ELR] = 0.16 + 0.03 * br;
  o[BREATH] = 0.014 * br;
  o[HYAW] = 0.55 * Math.sin(t * 0.29 + v * 7) ** 3;
  o[HPITCH] = 0.03 + 0.05 * Math.sin(t * 0.21 + v * 3);
  if (v > 0.72) {
    // supervisa: cada tanto apunta con el brazo derecho
    const g = pulse(fract(t / 9 + v * 3), 0, 0.3);
    o[SHR] += (1.45 - o[SHR]) * g;
    o[ELR] += (0.1 - o[ELR]) * g;
    o[ABR] += (0.3 - o[ABR]) * g;
    o[HYAW] += (-0.35 - o[HYAW]) * g;
    o[TWIST] -= 0.15 * g;
  } else if (v > 0.4) {
    // conversa: gestos con el antebrazo derecho
    const g = pulse(fract(t / 6 + v * 5), 0.1, 0.6);
    o[SHR] += 0.35 * g;
    o[ELR] += (1.05 + 0.3 * Math.sin(t * 2.6) - o[ELR]) * g;
  }
}

/** Trabajo: amarrar fierro (agachado de cintura), martillar moldaje, o en cuclillas sobre la losa. */
function poseWork(o: Float32Array, t: number, v: number) {
  if (v < 0.34) {
    const b = Math.sin(t * 0.7), w1 = Math.sin(t * 9), w2 = Math.sin(t * 9 + 1.6);
    o[LEAN] = 0.95 + 0.05 * b;
    o[SHIFT] = -0.12; // cadera atrás, pies adelante: equilibrio al agacharse
    o[THL] = o[THR] = 0.45;
    o[KNL] = o[KNR] = 0.55;
    o[SPREAD] = 0.1;
    o[TWIST] = 0.12 * Math.sin(t * 0.45);
    o[SHL] = 1.05 + 0.06 * w1;
    o[SHR] = 1.1 + 0.06 * w2;
    o[ELL] = 0.45 + 0.12 * w2;
    o[ELR] = 0.5 + 0.12 * w1;
    o[ABL] = o[ABR] = -0.06;
    o[HPITCH] = -0.5;
    o[HYAW] = 0.1 * b;
  } else if (v < 0.67) {
    // golpe de martillo: sube lento, baja rápido, pausa en el impacto
    const c = fract(t / 0.8);
    const q = c < 0.55 ? smooth(c / 0.55) : c < 0.68 ? 1 - ((c - 0.55) / 0.13) ** 2 : 0;
    o[LEAN] = 0.14 + 0.06 * (1 - q);
    o[THL] = 0.2;
    o[THR] = -0.12;
    o[KNL] = 0.15;
    o[KNR] = 0.05;
    o[SPREAD] = 0.06;
    o[SHL] = 0.85;
    o[ELL] = 0.75;
    o[ABL] = 0.12;
    o[SHR] = 0.7 + 0.85 * q;
    o[ELR] = 0.35 + 1.45 * q;
    o[ABR] = 0.12 + 0.1 * q; // el martillo pasa al lado del casco
    o[TWIST] = -0.12 * q;
    o[HPITCH] = 0.3;
    o[HYAW] = 0.1;
    o[TOOL] = 1;
  } else {
    const s1 = Math.sin(t * 2.6), s2 = Math.sin(t * 5.2);
    o[THL] = o[THR] = 1.32;
    o[KNL] = o[KNR] = 2.15;
    o[SPREAD] = 0.24;
    o[SHIFT] = -0.1;
    o[LEAN] = 0.5 + 0.04 * Math.sin(t * 0.8);
    o[SHL] = 0.75 + 0.15 * s1;
    o[SHR] = 0.8 - 0.15 * s1;
    o[ELL] = 0.55 + 0.25 * s2;
    o[ELR] = 0.5 + 0.25 * Math.sin(t * 5.2 + 1.3);
    o[ABL] = o[ABR] = 0.05;
    o[HPITCH] = 0.25;
    o[TWIST] = 0.1 * Math.sin(t * 0.5);
  }
}

/** Altura de la suela más baja de una pierna respecto a la cadera. */
function soleY(th: number, kn: number, ft: number, spread: number) {
  const ankle = -(THIGH * Math.cos(th) + SHIN * Math.cos(th - kn)) * Math.cos(spread);
  const s = Math.sin(ft);
  return ankle + Math.min(HEEL * s, TOE * s) - ANKLE * Math.cos(ft);
}

/** Hash estable en [0, 1). */
function hash(a: number, b: number) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ─────────────────────────── multitud ───────────────────────────

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _r = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const T = (m: THREE.Matrix4, x: number, y: number, z: number) => m.multiply(_r.makeTranslation(x, y, z));
const RX = (m: THREE.Matrix4, a: number) => m.multiply(_r.makeRotationX(a));
const RY = (m: THREE.Matrix4, a: number) => m.multiply(_r.makeRotationY(a));
const RZ = (m: THREE.Matrix4, a: number) => m.multiply(_r.makeRotationZ(a));

export function createCrowd(max: number): Crowd {
  max = Math.max(0, Math.floor(max));
  const geo = buildGeometries();
  const mat = crowdMaterial();
  const group = new THREE.Group();
  group.name = 'cuadrillas';

  const singles: THREE.InstancedMesh[] = [];
  const pairs: THREE.InstancedMesh[] = [];
  const part = (g: THREE.BufferGeometry, name: string, paired = false) => {
    const n = Math.max(1, paired ? max * 2 : max);
    g.setAttribute('iColor2', new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3));
    const m = new THREE.InstancedMesh(g, mat, n);
    m.name = name;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = m.receiveShadow = true;
    m.frustumCulled = false; // las instancias se mueven: el bounding sphere quedaría viejo
    _c.setRGB(1, 1, 1);
    for (let k = 0; k < n; k++) {
      m.setMatrixAt(k, ZERO);
      m.setColorAt(k, _c);
    }
    m.count = 0;
    (paired ? pairs : singles).push(m);
    group.add(m);
    return m;
  };
  const torso = part(geo.torso, 'torso');
  const head = part(geo.head, 'cabeza');
  const prop = part(geo.prop, 'carga');
  const tool = part(geo.tool, 'martillo');
  const upper = part(geo.upper, 'brazo', true);
  const fore = part(geo.fore, 'antebrazo', true);
  const thigh = part(geo.thigh, 'muslo', true);
  const shin = part(geo.shin, 'pierna', true);
  const foot = part(geo.foot, 'bota', true);

  // caja de selección invisible (más fácil de tocar que las extremidades)
  const proxy = new THREE.InstancedMesh(geo.proxy, new THREE.MeshBasicMaterial({ visible: false }), Math.max(1, max));
  proxy.name = 'trabajadores-seleccion';
  proxy.userData.pick = { type: 'worker' };
  proxy.frustumCulled = false;
  for (let k = 0; k < max; k++) proxy.setMatrixAt(k, ZERO);
  proxy.count = 0;
  singles.push(proxy);
  group.add(proxy);

  // colores fijos por persona: camisa, piel, tono de la madera que carga
  const shirtA = upper.geometry.attributes.iColor2 as THREE.InstancedBufferAttribute;
  const foreA = fore.geometry.attributes.iColor2 as THREE.InstancedBufferAttribute;
  const torsoA = torso.geometry.attributes.iColor2 as THREE.InstancedBufferAttribute;
  const skinA = head.geometry.attributes.iColor2 as THREE.InstancedBufferAttribute;
  const vIdle = new Float32Array(max), vWork = new Float32Array(max);
  for (let i = 0; i < max; i++) {
    _c.set(SHIRTS[Math.floor(hash(i, 1) * SHIRTS.length)]);
    for (const k of [2 * i, 2 * i + 1]) {
      shirtA.setXYZ(k, _c.r, _c.g, _c.b);
      foreA.setXYZ(k, _c.r, _c.g, _c.b);
    }
    torsoA.setXYZ(i, _c.r, _c.g, _c.b);
    _c.set(SKINS[Math.floor(hash(i, 2) * SKINS.length)]);
    skinA.setXYZ(i, _c.r, _c.g, _c.b);
    const wood = 0.82 + 0.3 * hash(i, 3);
    prop.setColorAt(i, _c.setRGB(wood, wood, wood));
    vIdle[i] = hash(i, 4);
    vWork[i] = hash(i, 5);
  }

  const vest = VEST_COLORS.map((c) => new THREE.Color(c));
  const helmet = HELMET_COLORS.map((c) => new THREE.Color(c));

  // estado por trabajador (mezcla de acciones, marcha, rumbo suavizado)
  const W = new Float32Array(max * 4);
  const lastT = new Float64Array(max), lastWalk = new Float64Array(max), gait = new Float64Array(max);
  const amp = new Float32Array(max), dir = new Float64Array(max);
  const ready = new Uint8Array(max), vis = new Uint8Array(max);
  const vestOf = new Int8Array(max).fill(-1), helmetOf = new Int8Array(max).fill(-1);
  let colorsDirty = false;

  const F = new Float32Array(NP), P = new Float32Array(NP);
  const root = new THREE.Matrix4(), pelvis = new THREE.Matrix4(), chest = new THREE.Matrix4(), m = new THREE.Matrix4();

  const hide = (i: number) => {
    for (const s of singles) s.setMatrixAt(i, ZERO);
    for (const s of pairs) {
      s.setMatrixAt(2 * i, ZERO);
      s.setMatrixAt(2 * i + 1, ZERO);
    }
  };

  const set = (i: number, p: WorkerPose) => {
    if (!(i >= 0 && i < max)) return;
    if (!p.visible) {
      if (vis[i]) hide(i);
      vis[i] = ready[i] = 0;
      return;
    }
    vis[i] = 1;
    const a = ACTIONS[p.action] ?? 0;
    const wi = i * 4;
    const dt = p.t - lastT[i];
    if (ready[i] && dt > 1e-4 && dt < 0.5) {
      // transición suave entre acciones; cadencia y amplitud según la velocidad real
      const k = 1 - Math.exp(-dt * 5);
      for (let j = 0; j < 4; j++) W[wi + j] += ((j === a ? 1 : 0) - W[wi + j]) * k;
      const dw = Math.abs(p.walk - lastWalk[i]);
      amp[i] += (Math.min(1, dw / dt / 0.7) - amp[i]) * (1 - Math.exp(-dt * 6));
      // fase en ciclos: avanza con la distancia real (pies plantados) hasta un trote de 2,5 m/s
      gait[i] += Math.min(dw, 2.5 * dt) / (STRIDE * strideK(amp[i]));
      const dh = p.heading - dir[i];
      dir[i] += Math.atan2(Math.sin(dh), Math.cos(dh)) * (1 - Math.exp(-dt * 10));
    } else {
      // primer cuadro, salto de la línea de tiempo o tiempo fijo: sin suavizado
      for (let j = 0; j < 4; j++) W[wi + j] = j === a ? 1 : 0;
      amp[i] = 1;
      gait[i] = p.walk / STRIDE;
      dir[i] = p.heading;
    }
    lastT[i] = p.t;
    lastWalk[i] = p.walk;
    ready[i] = 1;

    // pose mezclada
    const ph = gait[i];
    F.fill(0);
    for (let j = 0; j < 4; j++) {
      const w = W[wi + j];
      if (w < 0.002) continue;
      P.fill(0);
      if (j === 0) poseIdle(P, p.t, vIdle[i]);
      else if (j === 1) poseWalk(P, ph, amp[i]);
      else if (j === 2) poseWork(P, p.t, vWork[i]);
      else poseCarry(P, ph, amp[i]);
      for (let k = 0; k < NP; k++) F[k] += P[k] * w;
    }

    // raíz → pelvis (apoyada en el pie más bajo) → piernas / torso → cabeza y brazos
    root.makeRotationY(-dir[i]).scale(_s.setScalar(WORKER_SCALE)).setPosition(p.x, p.y, p.z);
    proxy.setMatrixAt(i, root);
    const hipY = -Math.min(soleY(F[THL], F[KNL], F[FTL], F[SPREAD]), soleY(F[THR], F[KNR], F[FTR], F[SPREAD]));
    RY(T(pelvis.copy(root), F[SHIFT], hipY, 0), F[HIPYAW]);

    for (let side = 0; side < 2; side++) {
      const s = side ? 1 : -1, k = 2 * i + side;
      const th = F[THL + side], kn = F[KNL + side], sp = F[SPREAD];
      RZ(RX(T(m.copy(pelvis), 0, 0, s * HIP_W), -s * sp), th);
      thigh.setMatrixAt(k, m);
      RZ(T(m, 0, -THIGH, 0), -kn);
      shin.setMatrixAt(k, m);
      // la bota queda nivelada: se deshace el giro acumulado y se aplica su cabeceo propio
      RZ(RY(RX(RZ(T(m, 0, -SHIN, 0), kn - th), s * sp), -s * 0.1), F[FTL + side]);
      foot.setMatrixAt(k, m);
    }

    RX(RZ(RY(chest.copy(pelvis), F[TWIST]), -F[LEAN]), F[ROLL]);
    torso.setMatrixAt(i, m.copy(chest).scale(_s.set(1 + F[BREATH], 1, 1 + F[BREATH])));
    head.setMatrixAt(i, RZ(RY(T(m.copy(chest), 0, TORSO_H, 0), F[HYAW]), -F[HPITCH]));
    prop.setMatrixAt(i, F[PROP] > 0.5 ? chest : ZERO);

    for (let side = 0; side < 2; side++) {
      const s = side ? 1 : -1, k = 2 * i + side;
      RZ(RX(T(m.copy(chest), 0, SHOULDER_Y, s * SHOULDER_W), -s * F[ABL + side]), F[SHL + side]);
      upper.setMatrixAt(k, m);
      RZ(T(m, 0, -UPPER_ARM, 0), F[ELL + side]);
      fore.setMatrixAt(k, m);
      if (side) tool.setMatrixAt(i, F[TOOL] > 0.5 ? m : ZERO);
    }

    if (vestOf[i] !== p.vest) {
      torso.setColorAt(i, vest[p.vest] ?? vest[0]);
      vestOf[i] = p.vest;
      colorsDirty = true;
    }
    if (helmetOf[i] !== p.helmet) {
      head.setColorAt(i, helmet[p.helmet] ?? helmet[0]);
      helmetOf[i] = p.helmet;
      colorsDirty = true;
    }
  };

  /** Dibuja solo hasta el último visible y sube a la GPU solo ese tramo de matrices. */
  const flush = (s: THREE.InstancedMesh, n: number) => {
    s.count = n;
    if (!n) return;
    s.instanceMatrix.clearUpdateRanges();
    s.instanceMatrix.addUpdateRange(0, n * 16);
    s.instanceMatrix.needsUpdate = true;
  };

  const commit = () => {
    let n = max;
    while (n > 0 && !vis[n - 1]) n--;
    for (const s of singles) flush(s, n);
    for (const s of pairs) flush(s, 2 * n);
    if (colorsDirty) {
      torso.instanceColor!.needsUpdate = true;
      head.instanceColor!.needsUpdate = true;
      colorsDirty = false;
    }
    proxy.boundingSphere = null; // se recalcula al hacer raycast
  };

  return { group, count: max, set, commit, pickables: [proxy] };
}
