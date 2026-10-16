/**
 * Bomba estacionaria de hormigón (tipo remolque, estilo Putzmeister BSA / Schwing SP) dentro de
 * su caseta de OSB con techo de zinc acanalado, como en la obra: queda instalada toda la faena,
 * el mixer se estaciona junto a la caseta y descarga por la canaleta a la tolva, y la tubería de
 * impulsión (acero Ø125) sale por el muro trasero hacia el edificio.
 *
 * Origen = suelo bajo el centro de la bomba. Ejes locales: la tolva mira a +z (lado abierto de la
 * caseta) y la salida de la tubería a −z. La huella (losa de apoyo, techo y tolva) está centrada en
 * el origen: x ∈ [−w/2, w/2], z ∈ [−d/2, d/2].
 *
 *   z  +3,50 ─ borde de la losa (delantal de la tolva; el camión puede invadirlo ~0,25 m)
 *      +2,92 ─ cara exterior de la tolva (el codo de la válvula S llega a +3,16)
 *      +1,95 ─ borde del techo (0,33 m antes de la tolva, para que entre la canaleta)
 *      +1,60 ─ fin de los muros laterales (lado abierto)
 *      −3,10 ─ muro trasero de OSB (la tubería lo cruza en x = −1,10)
 *      −3,50 ─ alero trasero
 */
import * as THREE from 'three';
import { PartKit, createWheels, markPickable, metal, paint, smooth, tinted, type Surface, type XY, type XYZ } from './mixer';

export interface StationaryPumpRig {
  /** Origen = suelo bajo el centro de la bomba; tolva hacia +z, salida de la tubería hacia −z. */
  group: THREE.Group;
  /** Punto justo sobre la parrilla de la tolva, donde vierte la canaleta del mixer. */
  hopper: THREE.Object3D;
  /** Punto donde la tubería deja la bomba (fuera del muro −z), horizontal hacia −z. */
  outlet: THREE.Object3D;
  /** Huella de la caseta en x y z (m), centrada en el origen. */
  readonly footprint: { w: number; d: number };
  /** Bombeando: hormigón en la tolva, agitador girando, válvula S y cilindros pulsando, motor vibrando, baliza. */
  setPumping(on: boolean, t: number): void;
  pickables: THREE.Object3D[];
}

// ───────────────────────── medidas ─────────────────────────

/** Cota del eje de la tubería de impulsión. */
const PY = 0.56;
/** Tubería Ø125 (radio exterior ≈ 6,5 cm) y sus uniones. */
const PIPE_R = 0.065;
const PIPE_X = -1.1;
const OUTLET: XYZ = [PIPE_X, PY, -3.3];

/** Tolva: centro en z, cotas del fondo y del borde, semi-anchos (x, z) abajo y arriba, espesor. */
const HOP = { z: 2.6, y0: 0.45, y1: 1.2, bot: [0.42, 0.19] as XY, top: [0.74, 0.32] as XY, t: 0.025 };
const HOPPER_POINT: XYZ = [0, 1.25, HOP.z];
const hopHalf = (y: number): XY => {
  const k = (y - HOP.y0) / (HOP.y1 - HOP.y0);
  return [HOP.bot[0] + (HOP.top[0] - HOP.bot[0]) * k, HOP.bot[1] + (HOP.top[1] - HOP.bot[1]) * k];
};

/** Válvula S: palanca sobre el eje de la salida, dos cilindros de cambio arriba. */
const VALVE_Z = 2.95;
const LEVER_L = 0.44;
const RAM_Y = PY + LEVER_L;
const RAM_X0 = 0.36; // extremo interior de las camisas
const RAM_X1 = 0.6;
const SWING = 0.3; // rad
const STROKE = 1.8; // s por embolada

/** Caseta: muros, techo monopendiente (más alto hacia +x) y huella. */
const SHED = { x: 1.4, zBack: -3.1, zFront: 1.6, roofX: 1.8, roofZ0: -3.5, roofZ1: 1.95, t: 0.015 };
const FOOT = { w: 3.6, d: 7.0 };
const SLOPE = 0.055;
const roofY = (x: number) => 2.86 + SLOPE * x;
const ROOF_TILT = Math.atan(SLOPE);
const AMP = 0.018; // media altura de la onda del zinc
const RAFTER_H = 0.1;
const wallTop = (x: number) => roofY(x) - AMP - RAFTER_H;
const POST_X = SHED.x - SHED.t - 0.045;
const POSTS_Z = [-3.04, -1.9, -0.75, 0.4, 1.555];
const OSB_TILE = 2.44; // la textura cubre 2 planchas de 1,22 × 2,44 m

/** Eje del remolque: posición en z, trocha (centro de rueda en x), escala de la rueda del camión. */
const AXLE_Z = -0.2;
const WHEEL_X = 0.86;
const WHEEL_K = 0.72;
const WHEEL_Y = 0.52 * WHEEL_K;

const UP = new THREE.Vector3(0, 1, 0);

// ───────────────────────── texturas ─────────────────────────

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tx = new THREE.CanvasTexture(c);
  tx.colorSpace = THREE.SRGBColorSpace;
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  tx.anisotropy = 8;
  return tx;
}

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** OSB: hojuelas café claro en todas direcciones, juntas entre planchas y timbre del fabricante. */
function osbTexture() {
  const S = 512;
  return canvasTex(S, S, (g) => {
    g.fillStyle = '#cdb48a';
    g.fillRect(0, 0, S, S);
    const rnd = rng(4242);
    for (let i = 0; i < 5200; i++) {
      const l = 0.8 + rnd() * 0.3;
      g.fillStyle = `rgba(${Math.min(255, 220 * l) | 0},${Math.min(255, 190 * l) | 0},${Math.min(255, 142 * l) | 0},0.6)`;
      g.save();
      g.translate(rnd() * S, rnd() * S);
      g.rotate(rnd() * Math.PI);
      const len = 7 + rnd() * 22, w = 2.5 + rnd() * 4.5;
      g.fillRect(-len / 2, -w / 2, len, w);
      g.restore();
    }
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(120,92,58,${0.12 + rnd() * 0.2})`;
      g.fillRect(rnd() * S, rnd() * S, 1.5 + rnd() * 4, 1 + rnd() * 2);
    }
    // juntas entre planchas: borde izquierdo, centro (cada 1,22 m) y borde superior (2,44 m)
    g.fillStyle = 'rgba(78,54,30,0.65)';
    g.fillRect(0, 0, 3, S);
    g.fillRect(S / 2 - 1, 0, 3, S);
    g.fillRect(0, 0, S, 3);
    g.fillStyle = 'rgba(52,52,68,0.3)';
    g.font = 'bold 15px sans-serif';
    g.fillText('OSB 11,1 mm  ESTRUCTURAL', 40, 330);
    g.fillText('OSB 11,1 mm  ESTRUCTURAL', 40 + S / 2, 150);
  });
}

/** Zinc gris claro con vetas de polvo a lo largo de la pendiente y algo de suciedad en el alero bajo. */
function roofTexture() {
  const S = 256;
  return canvasTex(S, S, (g) => {
    g.fillStyle = '#d3d7da';
    g.fillRect(0, 0, S, S);
    const rnd = rng(77);
    for (let i = 0; i < 70; i++) {
      g.fillStyle = rnd() > 0.5 ? `rgba(150,150,145,${0.08 + rnd() * 0.12})` : `rgba(240,242,244,${0.1 + rnd() * 0.15})`;
      g.fillRect(rnd() * S * 0.3, rnd() * S, S * (0.4 + rnd() * 0.7), 1 + rnd() * 3);
    }
    const grad = g.createLinearGradient(0, 0, S * 0.25, 0);
    grad.addColorStop(0, 'rgba(140,128,108,0.35)');
    grad.addColorStop(1, 'rgba(140,128,108,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, S * 0.25, S);
  });
}

function signTexture() {
  return canvasTex(320, 128, (g) => {
    g.fillStyle = '#f3c316';
    g.fillRect(0, 0, 320, 128);
    g.strokeStyle = '#1b1b1b';
    g.lineWidth = 8;
    g.strokeRect(6, 6, 308, 116);
    g.fillStyle = '#1b1b1b';
    g.font = 'bold 76px Arial, Helvetica, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('BOMBA', 160, 68);
  });
}

// ───────────────────────── materiales ─────────────────────────

function makeSurfaces() {
  return {
    white: paint('#ebeae4'),
    yellow: paint('#f0b11a'),
    dark: paint('#34373c'),
    panel: paint('#cdd1d4'),
    red: paint('#d3271d'),
    green: paint('#2f9e44'),
    face: paint('#f4f4ef'),
    timber: paint('#b68e5e'),
    timberDark: paint('#94704a'),
    pad: paint('#a17d4f'),
    floor: paint('#aba597'),
    spill: paint('#a09b90'),
    crust: paint('#8e8b84'),
    sand: paint('#d3c7a6'),
    barrow: paint('#c5432b'),
    tube: paint('#c9cbc6'),
    steel: metal('#8f969c'),
    steelDark: metal('#5b6066'),
    pipe: metal('#8b9298'),
    chrome: metal('#dfe3e6'),
    coupling: metal('#4a4f55'),
    yellowSteel: metal('#e3a51c'),
    osb: new THREE.MeshStandardMaterial({ map: osbTexture(), roughness: 0.9 }),
    /** Hormigón fresco: gris más oscuro y brillante que el acero de la tolva. */
    wet: new THREE.MeshStandardMaterial({ color: '#6a6b6b', roughness: 0.16, metalness: 0.02 }),
    roof: new THREE.MeshStandardMaterial({ map: roofTexture(), roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide }),
    sign: new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.55 }),
  };
}
let surf: ReturnType<typeof makeSurfaces> | null = null;
const surfaces = () => (surf ??= makeSurfaces());

// ───────────────────────── geometrías propias ─────────────────────────

/** Triángulos de cuadriláteros (a, b, c, d en sentido antihorario visto desde la cara). */
function quadGeometry(quads: XYZ[][]) {
  const pos: number[] = [];
  for (const [a, b, c, d] of quads) pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.computeVertexNormals();
  return g;
}

/** Tronco de pirámide hueco y abierto arriba (tolva, carretilla): caras exterior, interior, borde y fondo. */
function hollowFrustum(bot: XY, top: XY, y0: number, y1: number, t: number) {
  const ring = (hx: number, hz: number, y: number): XYZ[] => [[hx, y, hz], [hx, y, -hz], [-hx, y, -hz], [-hx, y, hz]];
  const B = ring(bot[0], bot[1], y0), T = ring(top[0], top[1], y1);
  const Bi = ring(bot[0] - t, bot[1] - t, y0 + t), Ti = ring(top[0] - t, top[1] - t, y1);
  const q: XYZ[][] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    q.push([B[i], B[j], T[j], T[i]], [Bi[j], Bi[i], Ti[i], Ti[j]], [T[i], T[j], Ti[j], Ti[i]]);
  }
  q.push([B[3], B[2], B[1], B[0]], [Bi[0], Bi[1], Bi[2], Bi[3]]);
  return quadGeometry(q);
}

/** Plancha de zinc acanalado sobre todo el techo; las ondas corren a lo largo de la pendiente (x). */
function corrugatedRoof(x0: number, x1: number, z0: number, z1: number, pitch: number) {
  const PER = 8;
  const n = Math.round((z1 - z0) / pitch) * PER;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n;
    const dy = AMP * Math.sin((i / PER) * Math.PI * 2);
    for (const x of [x0, x1]) {
      pos.push(x, roofY(x) + dy, z);
      uv.push((x - x0) / (x1 - x0), (z - z0) / (z1 - z0));
    }
  }
  for (let i = 0; i < n; i++) {
    const a = 2 * i;
    idx.push(a, a + 2, a + 3, a, a + 3, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** UV planares en metros para el OSB (plano yz de los muros laterales o xy del muro trasero). */
function osbUV<G extends THREE.BufferGeometry>(g: G, plane: 'x' | 'z'): G {
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const u = plane === 'x' ? p.getZ(i) - SHED.zBack : p.getX(i) + SHED.x;
    uv.setXY(i, u / OSB_TILE, p.getY(i) / OSB_TILE);
  }
  return g;
}

function osbBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, plane: 'x' | 'z') {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return osbUV(g, plane);
}

/** Caja entre dos esquinas en cualquier orden (las coordenadas con signo ±s no quedan invertidas). */
function box(kit: PartKit, s: Surface, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  kit.box(s, Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1));
}

/** Codo de 90° en un plano horizontal: arco de radio R alrededor de `c` desde el ángulo a0 (rad, en xz). */
function elbow(kit: PartKit, s: Surface, c: XYZ, R: number, r: number, a0: number) {
  const g = new THREE.TorusGeometry(R, r, 10, 10, Math.PI / 2);
  g.rotateX(Math.PI / 2); // arco de +x a +z
  g.rotateY(-a0);
  kit.add(s, g, c);
}

// ───────────────────────── bomba ─────────────────────────

/** Chasis de remolque, lanza, gata, estabilizadores, estanque de agua, tablero, tolva y tubería (fijos). */
function buildPumpStatic(kit: PartKit) {
  const M = surfaces();
  // largueros, travesaños, ballestas y eje
  for (const s of [-1, 1]) {
    box(kit, M.dark, s * 0.45, 0.62, -2.0, s * 0.55, 0.8, 2.27);
    box(kit, M.dark, s * 0.53, WHEEL_Y, AXLE_Z - 0.28, s * 0.47, 0.62, AXLE_Z + 0.28);
    box(kit, M.dark, s * 0.56, WHEEL_Y - 0.02, AXLE_Z - 0.3, s * 0.44, WHEEL_Y + 0.02, AXLE_Z + 0.3);
  }
  for (const z of [-1.95, -0.2, 1.4]) box(kit, M.dark, -0.45, 0.64, z - 0.04, 0.45, 0.78, z + 0.04);
  kit.cyl(M.dark, 0.04, 0.04, 1.5, [0, WHEEL_Y, AXLE_Z], 'x', 10);
  // tapabarros sobre las ruedas
  for (const s of [-1, 1]) {
    kit.add(M.yellow, new THREE.CylinderGeometry(0.43, 0.43, 0.26, 14, 1, true, Math.PI, Math.PI), [s * WHEEL_X, WHEEL_Y, AXLE_Z], [0, 0, -Math.PI / 2]);
    box(kit, M.dark, s * 0.72, 0.78, AXLE_Z - 0.1, s * 0.74, 0.86, AXLE_Z + 0.1);
  }
  // lanza en A con cabezal y argolla, gata de apoyo sobre un taco
  for (const s of [-1, 1]) kit.bar(M.dark, [s * 0.48, 0.7, -1.98], [0, 0.55, -2.72], 0.04);
  kit.boxAt(M.dark, 0.13, 0.11, 0.24, [0, 0.55, -2.78]);
  kit.add(M.dark, new THREE.TorusGeometry(0.055, 0.016, 6, 14), [0, 0.55, -2.94], [Math.PI / 2, 0, 0]);
  box(kit, M.dark, -0.22, 0.58, -2.44, 0.22, 0.66, -2.36);
  kit.cyl(M.yellow, 0.045, 0.045, 0.5, [0, 0.62, -2.4], 'y', 10);
  kit.cyl(M.chrome, 0.032, 0.032, 0.34, [0, 0.25, -2.4], 'y', 10);
  box(kit, M.dark, -0.08, 0.075, -2.48, 0.08, 0.1, -2.32);
  box(kit, M.pad, -0.14, 0, -2.54, 0.14, 0.075, -2.26);
  kit.bar(M.dark, [0, 0.87, -2.4], [0.13, 0.9, -2.4], 0.012, 6);
  kit.bar(M.dark, [0.13, 0.9, -2.4], [0.13, 0.98, -2.4], 0.014, 6);
  // estabilizadores abatibles (delante y junto a la tolva) sobre tacos de madera
  for (const z of [-1.75, 2.4]) {
    for (const s of [-1, 1]) {
      box(kit, M.yellow, s * 0.755, 0.2, z - 0.045, s * 0.845, 0.84, z + 0.045);
      box(kit, M.dark, s * 0.5, 0.72, z - 0.05, s * 0.8, 0.8, z + 0.05);
      kit.cyl(M.chrome, 0.025, 0.025, 0.1, [s * 0.8, 0.16, z], 'y', 8);
      box(kit, M.dark, s * 0.7, 0.1, z - 0.1, s * 0.9, 0.12, z + 0.1);
      box(kit, M.pad, s * 0.62, 0, z - 0.18, s * 0.98, 0.1, z + 0.18);
    }
  }
  // estanque de agua (entre el capó y la tolva) con tapa de plancha diamantada
  box(kit, M.steel, -0.55, 0.8, 1.45, 0.55, 1.16, 2.27);
  box(kit, M.steelDark, -0.53, 1.16, 1.47, 0.53, 1.18, 2.25);
  box(kit, M.steel, -0.2, 1.18, 1.65, 0.2, 1.2, 2.05);
  kit.cyl(M.dark, 0.03, 0.03, 0.1, [-0.56, 0.86, 1.9], 'x', 8);
  // tablero de mando (lado +x): caja gris, visera, setas roja y verde, manómetros
  box(kit, M.dark, 0.6, 0.8, 1.76, 0.78, 0.95, 1.94);
  box(kit, M.panel, 0.58, 0.95, 1.58, 0.84, 1.5, 2.12);
  box(kit, M.dark, 0.56, 1.5, 1.55, 0.9, 1.53, 2.15);
  box(kit, M.dark, 0.84, 0.97, 1.6, 0.843, 1.48, 1.605);
  box(kit, M.yellow, 0.84, 1.33, 1.67, 0.85, 1.43, 1.77);
  kit.cyl(M.red, 0.035, 0.035, 0.04, [0.865, 1.38, 1.72], 'x', 12);
  kit.cyl(M.green, 0.026, 0.026, 0.03, [0.86, 1.38, 1.86], 'x', 12);
  kit.cyl(M.dark, 0.022, 0.022, 0.03, [0.86, 1.38, 1.98], 'x', 8);
  for (const z of [1.74, 1.94]) {
    kit.cyl(M.dark, 0.05, 0.05, 0.02, [0.85, 1.18, z], 'x', 14);
    kit.cyl(M.face, 0.041, 0.041, 0.006, [0.861, 1.18, z], 'x', 14);
  }
  box(kit, M.face, 0.84, 1.03, 1.64, 0.845, 1.08, 2.04);

  // ── tolva: tronco de pirámide de acero, parrilla, protección trasera y costras de hormigón
  kit.add(M.steel, hollowFrustum(HOP.bot, HOP.top, HOP.y0, HOP.y1, HOP.t), [0, 0, HOP.z]);
  const [tx, tz] = HOP.top;
  const gy = HOP.y1 + 0.018;
  for (const s of [-1, 1]) {
    box(kit, M.steelDark, -tx, HOP.y1, HOP.z + s * tz - 0.025, tx, HOP.y1 + 0.035, HOP.z + s * tz + 0.025);
    box(kit, M.steelDark, s * tx - 0.025, HOP.y1, HOP.z - tz, s * tx + 0.025, HOP.y1 + 0.035, HOP.z + tz);
  }
  for (let i = 0; i < 9; i++) kit.boxAt(M.steelDark, 0.018, 0.03, 2 * tz - 0.04, [-0.6 + i * 0.15, gy, HOP.z]);
  kit.boxAt(M.steelDark, 2 * tx - 0.04, 0.03, 0.025, [0, gy + 0.005, HOP.z]);
  // plancha vertical hacia la bomba (frena las salpicaduras) con cartelas
  const zb = HOP.z - tz;
  box(kit, M.steel, -tx, HOP.y1, zb - 0.022, tx, HOP.y1 + 0.58, zb);
  box(kit, M.crust, -tx + 0.03, HOP.y1 + 0.02, zb + 0.0, tx - 0.05, HOP.y1 + 0.22, zb + 0.006);
  for (const s of [-1, 1]) kit.boxAt(M.steelDark, 0.02, 0.4, 0.2, [s * (tx - 0.02), HOP.y1 + 0.22, zb - 0.11], [-0.5, 0, 0]);
  // costras de hormigón seco: manchas planas e irregulares sobre el borde y la parrilla, chorreras en las caras
  const splat = (pos: XYZ, r: number, rot: XYZ, seed: number) => {
    const g = new THREE.CylinderGeometry(1, 1, 1, 7);
    const rr = rng(seed);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 0.65 + rr() * 0.5;
      p.setXYZ(i, p.getX(i) * k, p.getY(i), p.getZ(i) * k);
    }
    kit.add(M.crust, g, pos, rot, [r * 1.3, 0.012, r]);
  };
  splat([0.6, HOP.y1 + 0.037, HOP.z + tz], 0.07, [0, 0.4, 0], 3);
  splat([-0.35, HOP.y1 + 0.037, HOP.z + tz], 0.055, [0, -0.3, 0], 5);
  splat([-tx, HOP.y1 + 0.037, HOP.z + 0.1], 0.06, [0, 1.3, 0], 7);
  splat([0.32, gy + 0.016, HOP.z - 0.14], 0.045, [0, 0.9, 0], 9);
  splat([-0.2, gy + 0.016, HOP.z + 0.18], 0.04, [0, 2.1, 0], 11);
  const lean = Math.atan2(tz - HOP.bot[1], HOP.y1 - HOP.y0); // cara +z de la tolva, inclinada hacia afuera
  for (const [x, y, r, sd] of [[0.5, 0.74, 0.06, 13], [-0.48, 0.82, 0.05, 15]]) {
    splat([x, y, HOP.z + hopHalf(y)[1] + 0.003], r, [Math.PI / 2 + lean, sd, 0], sd);
  }
  // motor hidráulico del agitador (+x) y descanso (−x)
  kit.cyl(M.dark, 0.085, 0.085, 0.13, [0.665, 0.68, HOP.z], 'x', 14);
  box(kit, M.dark, 0.6, 0.6, HOP.z - 0.11, 0.62, 0.76, HOP.z + 0.11);
  kit.cyl(M.dark, 0.06, 0.06, 0.06, [-0.64, 0.68, HOP.z], 'x', 12);
  kit.bar(M.coupling, [0.73, 0.68, HOP.z + 0.05], [0.73, 0.98, HOP.z - 0.25], 0.012, 6);
  kit.bar(M.coupling, [0.73, 0.98, HOP.z - 0.25], [0.6, 1.0, HOP.z - 0.75], 0.012, 6);

  // ── válvula S: brida de salida, camisas de los cilindros de cambio con sus soportes
  kit.cyl(M.steelDark, 0.15, 0.15, 0.03, [0, PY, 2.825], 'z', 16);
  kit.cyl(M.pipe, PIPE_R, 0.1, 0.1, [0, PY, 2.89], 'z', 16);
  for (const s of [-1, 1]) {
    const xm = (RAM_X0 + RAM_X1) / 2;
    kit.cyl(M.yellow, 0.05, 0.05, RAM_X1 - RAM_X0, [s * xm, RAM_Y, VALVE_Z], 'x', 12);
    kit.cyl(M.dark, 0.055, 0.055, 0.03, [s * RAM_X0, RAM_Y, VALVE_Z], 'x', 12);
    kit.boxAt(M.dark, 0.06, 0.13, 0.09, [s * (RAM_X1 + 0.01), RAM_Y, 2.92]);
  }

  // ── tubería de impulsión: sale por la cara +z, dobla hacia −x y corre por el costado hasta el muro −z
  const zA = 2.99, R = 0.1;
  kit.cyl(M.pipe, PIPE_R, PIPE_R, zA - 2.94, [0, PY, (2.94 + zA) / 2], 'z', 16);
  elbow(kit, M.pipe, [-R, PY, zA], R, PIPE_R, 0);
  const zS = zA + R;
  kit.cyl(M.pipe, PIPE_R, PIPE_R, -PIPE_X - 2 * R, [PIPE_X / 2, PY, zS], 'x', 16);
  elbow(kit, M.pipe, [PIPE_X + R, PY, zA], R, PIPE_R, Math.PI / 2);
  kit.cyl(M.pipe, PIPE_R, PIPE_R, zA - OUTLET[2], [PIPE_X, PY, (zA + OUTLET[2]) / 2], 'z', 16);
  const coupling = (pos: XYZ, axis: 'x' | 'z') => {
    kit.cyl(M.coupling, 0.086, 0.086, 0.08, pos, axis, 16);
    kit.boxAt(M.coupling, axis === 'z' ? 0.05 : 0.1, 0.05, axis === 'z' ? 0.1 : 0.05, [pos[0], pos[1] + 0.1, pos[2]]);
    kit.boxAt(M.coupling, 0.03, 0.06, 0.03, [pos[0], pos[1] - 0.1, pos[2]]);
  };
  coupling([PIPE_X / 2, PY, zS], 'x');
  for (const z of [2.3, 0.8, -0.7, -2.2, -3.2]) coupling([PIPE_X, PY, z], 'z');
  // caballetes de la tubería
  for (const z of [1.5, -1.5]) {
    kit.bar(M.dark, [PIPE_X, 0.02, z], [PIPE_X, PY - PIPE_R, z], 0.025, 6);
    box(kit, M.dark, PIPE_X - 0.12, 0, z - 0.12, PIPE_X + 0.12, 0.02, z + 0.12);
    box(kit, M.dark, PIPE_X - 0.09, PY - PIPE_R - 0.03, z - 0.04, PIPE_X + 0.09, PY - PIPE_R, z + 0.04);
  }
}

/** Grupo motor (capó blanco con franjas amarillas, celosías, rejilla y escape que sale por el techo). */
function buildEngine(kit: PartKit) {
  const M = surfaces();
  const z0 = -1.85, z1 = 1.45;
  kit.profile(M.white, [[-0.72, 0.8], [0.72, 0.8], [0.72, 1.82], [0.6, 1.98], [-0.6, 1.98], [-0.72, 1.82]], z0, z1);
  box(kit, M.yellow, -0.726, 0.8, z0 - 0.004, 0.726, 0.97, z1 + 0.004);
  box(kit, M.yellow, -0.725, 1.7, z0 - 0.003, 0.725, 1.76, z1 + 0.003);
  for (const s of [-1, 1]) {
    const xo = s * 0.722;
    // celosía del motor
    box(kit, M.dark, s > 0 ? 0.72 : -0.725, 1.1, -1.66, s > 0 ? 0.725 : -0.72, 1.62, -0.6);
    for (let i = 0; i < 6; i++) kit.boxAt(M.white, 0.03, 0.026, 1.0, [s * 0.735, 1.15 + i * 0.085, -1.13], [0, 0, s * 0.55]);
    // juntas de las puertas y manillas
    for (const z of [-0.45, 0.55]) box(kit, M.dark, Math.min(xo, xo + s * 0.004), 0.97, z - 0.006, Math.max(xo, xo + s * 0.004), 1.7, z + 0.006);
    for (const z of [-0.3, 0.7]) kit.boxAt(M.dark, 0.03, 0.05, 0.14, [s * 0.735, 1.38, z]);
    box(kit, M.dark, s > 0 ? 0.72 : -0.726, 1.25, 0.9, s > 0 ? 0.726 : -0.72, 1.45, 1.25);
  }
  // rejilla del radiador (cara −z)
  box(kit, M.dark, -0.55, 1.0, z0 - 0.015, 0.55, 1.65, z0);
  for (let i = 0; i < 6; i++) box(kit, M.white, -0.53, 1.04 + i * 0.1, z0 - 0.03, 0.53, 1.07 + i * 0.1, z0 - 0.01);
  // techo del capó: argolla de izaje, tapas de estanques, escape vertical con sombrerete
  kit.add(M.dark, new THREE.TorusGeometry(0.07, 0.016, 6, 14), [0, 2.05, -0.3], [0, Math.PI / 2, 0]);
  kit.cyl(M.dark, 0.06, 0.06, 0.05, [-0.35, 2.0, 0.75], 'y', 12);
  kit.cyl(M.yellow, 0.045, 0.045, 0.05, [-0.35, 2.0, 0.35], 'y', 12);
  box(kit, M.dark, 0.2, 1.98, 0.2, 0.5, 2.02, 0.9);
  kit.cyl(M.dark, 0.11, 0.11, 0.05, [0.42, 2.0, -1.25], 'y', 14);
  kit.cyl(M.tube, 0.075, 0.075, 1.6, [0.42, 2.78, -1.25], 'y', 14);
  kit.cyl(M.dark, 0.11, 0.11, 0.025, [0.42, 3.62, -1.25], 'y', 14);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    kit.bar(M.dark, [0.42 + Math.cos(a) * 0.07, 3.57, -1.25 + Math.sin(a) * 0.07], [0.42 + Math.cos(a) * 0.08, 3.61, -1.25 + Math.sin(a) * 0.08], 0.006, 4);
  }
}

/** Agitador de la tolva: eje con paletas y bridas con pernos (para que se note el giro). */
function buildAgitator() {
  const M = surfaces();
  const kit = new PartKit();
  kit.cyl(M.steelDark, 0.03, 0.03, 1.24, [0, 0, 0], 'x', 10);
  [-0.33, -0.11, 0.11, 0.33].forEach((x, k) => {
    const a = k * (Math.PI / 2) + (k % 2) * 0.4;
    kit.boxAt(M.steel, 0.15, 0.13, 0.03, [x, 0.095 * Math.cos(a), 0.095 * Math.sin(a)], [a, 0, 0]);
  });
  for (const s of [-1, 1]) {
    kit.cyl(M.yellowSteel, 0.065, 0.065, 0.04, [s * 0.58, 0, 0], 'x', 6);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      kit.boxAt(M.steelDark, 0.03, 0.028, 0.028, [s * 0.605, Math.cos(a) * 0.042, Math.sin(a) * 0.042], [a, 0, 0]);
    }
  }
  const g = kit.build();
  g.position.set(0, 0.68, HOP.z);
  return g;
}

// ───────────────────────── caseta ─────────────────────────

function buildShed(kit: PartKit) {
  const M = surfaces();
  const { x: X, zBack, zFront, t } = SHED;
  // losa de apoyo (toda la huella) con manchas de hormigón frente a la tolva
  box(kit, M.floor, -FOOT.w / 2, -0.1, -FOOT.d / 2, FOOT.w / 2, 0.008, FOOT.d / 2);
  kit.add(M.spill, new THREE.CylinderGeometry(1, 1, 0.006, 20), [0.05, 0.009, 2.95], [0, 0, 0], [1.0, 1, 0.5]);
  kit.add(M.spill, new THREE.CylinderGeometry(1, 1, 0.006, 16), [0.6, 0.01, 3.2], [0, 0.6, 0], [0.45, 1, 0.25]);
  // muros laterales de OSB (lado exterior en ±X) y muro trasero con pasada para la tubería
  for (const s of [-1, 1]) {
    const x0 = s > 0 ? X - t : -X, x1 = s > 0 ? X : -X + t;
    kit.add(M.osb, osbBox(x0, 0, zBack, x1, wallTop(s * X), zFront, 'x'));
  }
  const shape = new THREE.Shape([new THREE.Vector2(-X, 0), new THREE.Vector2(X, 0), new THREE.Vector2(X, wallTop(X)), new THREE.Vector2(-X, wallTop(-X))]);
  const hole = 0.14;
  shape.holes.push(new THREE.Path([
    new THREE.Vector2(PIPE_X - hole, PY - hole), new THREE.Vector2(PIPE_X - hole, PY + hole),
    new THREE.Vector2(PIPE_X + hole, PY + hole), new THREE.Vector2(PIPE_X + hole, PY - hole),
  ]));
  const back = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
  back.translate(0, 0, zBack);
  kit.add(M.osb, osbUV(back, 'z'));
  // pies derechos, soleras superiores, cabezal del lado abierto, tijerales y listones sobre el zinc
  for (const s of [-1, 1]) {
    for (const z of POSTS_Z) box(kit, M.timber, s * POST_X - 0.045, 0, z - 0.045, s * POST_X + 0.045, wallTop(s * POST_X) - 0.09, z + 0.045);
    box(kit, M.timberDark, s * POST_X - 0.045, wallTop(s * POST_X) - 0.09, zBack, s * POST_X + 0.045, wallTop(s * POST_X), zFront);
  }
  for (const x of [-0.45, 0.45]) box(kit, M.timber, x - 0.045, 0, zBack + t, x + 0.045, wallTop(x) - 0.01, zBack + t + 0.09);
  const rafterLen = (2 * SHED.roofX + 0.1) / Math.cos(ROOF_TILT);
  for (const z of POSTS_Z) kit.boxAt(M.timberDark, rafterLen, RAFTER_H, 0.05, [0, roofY(0) - AMP - RAFTER_H / 2, z], [0, 0, ROOF_TILT]);
  kit.boxAt(M.timber, 2 * X, 0.14, 0.03, [0, roofY(0) - AMP - RAFTER_H - 0.07, zFront + 0.02], [0, 0, ROOF_TILT]);
  for (const z of [-2.75, -0.9, 0.95]) kit.boxAt(M.timber, 2 * SHED.roofX, 0.025, 0.1, [0, roofY(0) + AMP + 0.0125, z], [0, 0, ROOF_TILT]);
  // techo de zinc y sombrerete de la pasada del escape
  kit.add(M.roof, corrugatedRoof(-SHED.roofX, SHED.roofX, SHED.roofZ0, SHED.roofZ1, 0.13));
  kit.cyl(M.steelDark, 0.085, 0.14, 0.08, [0.42, roofY(0.42) + 0.03, -1.25], 'y', 14);
  // letrero "BOMBA" (en su propia malla) se agrega aparte; aquí su marco
  box(kit, M.dark, X, 1.66, 0.28, X + 0.006, 2.04, 1.22);
  // baliza: base sobre la esquina +x/+z del techo
  const by = roofY(1.6) + AMP;
  box(kit, M.dark, 1.5, by, 1.74, 1.7, by + 0.02, 1.86);
  kit.cyl(M.dark, 0.06, 0.06, 0.05, [1.6, by + 0.045, 1.8], 'y', 12);
  // sacos de arena contra el muro +x (bajo el alero)
  const bags: XYZ[] = [[1.6, 0.06, -1.15], [1.6, 0.06, -0.68], [1.6, 0.06, -0.21], [1.61, 0.18, -0.92], [1.6, 0.18, -0.45]];
  bags.forEach((p, i) => kit.add(M.sand, new THREE.SphereGeometry(1, 10, 7), p, [0, (i % 3) * 0.12 - 0.1, 0], [0.16, 0.065, 0.235]));
  // carretilla junto a la tolva (lado +x), con restos de hormigón
  const bx = 1.37, bz = 2.45;
  kit.add(M.barrow, hollowFrustum([0.2, 0.26], [0.3, 0.36], 0.36, 0.6, 0.012), [bx, 0, bz]);
  box(kit, M.crust, bx - 0.18, 0.375, bz - 0.24, bx + 0.18, 0.4, bz + 0.24);
  kit.cyl(M.dark, 0.17, 0.17, 0.08, [bx, 0.17, bz + 0.45], 'x', 14);
  kit.cyl(M.steelDark, 0.05, 0.05, 0.1, [bx, 0.17, bz + 0.45], 'x', 10);
  for (const s of [-1, 1]) {
    kit.bar(M.dark, [bx + s * 0.06, 0.17, bz + 0.45], [bx + s * 0.25, 0.55, bz - 0.72], 0.016, 6);
    kit.bar(M.dark, [bx + s * 0.18, 0.33, bz - 0.2], [bx + s * 0.2, 0.0, bz - 0.25], 0.014, 6);
    kit.bar(M.dark, [bx + s * 0.25, 0.55, bz - 0.72], [bx + s * 0.255, 0.56, bz - 0.82], 0.022, 6);
  }
}

// ───────────────────────── ensamblaje ─────────────────────────

export function createStationaryPump(): StationaryPumpRig {
  const M = surfaces();
  const group = new THREE.Group();
  group.name = 'stationaryPump';

  const kit = new PartKit();
  buildPumpStatic(kit);
  buildShed(kit);
  group.add(kit.build());

  const engine = new PartKit();
  buildEngine(engine);
  const engineGroup = engine.build();
  group.add(engineGroup);

  // ruedas del remolque (las del camión, giradas 90° y a escala → radio ≈ 0,37 m)
  const wheels = createWheels([
    { x: -AXLE_Z / WHEEL_K, z: WHEEL_X / WHEEL_K, dual: false },
    { x: -AXLE_Z / WHEEL_K, z: -WHEEL_X / WHEEL_K, dual: false },
  ]);
  wheels.group.rotation.y = Math.PI / 2;
  wheels.group.scale.setScalar(WHEEL_K);
  group.add(wheels.group);

  const agitator = buildAgitator();
  group.add(agitator);

  // palanca de la válvula S (gira en z sobre el eje de la salida) y vástagos de los cilindros
  const lever = (() => {
    const k = new PartKit();
    k.cyl(M.steelDark, 0.1, 0.1, 0.04, [0, 0, 0], 'z', 16);
    k.box(M.yellowSteel, -0.045, 0.06, -0.018, 0.045, LEVER_L + 0.03, 0.018);
    k.cyl(M.chrome, 0.03, 0.03, 0.06, [0, LEVER_L, 0], 'z', 10);
    const g = k.build();
    g.position.set(0, PY, VALVE_Z);
    return g;
  })();
  group.add(lever);
  const rodGeo = tinted(new THREE.CylinderGeometry(0.022, 0.022, 1, 10), '#e4e7ea');
  const rods = [1, -1].map(() => {
    const m = new THREE.Mesh(rodGeo, M.chrome.mat);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  });

  // superficie del hormigón en la tolva (malla unitaria escalada al ancho de la tolva a esa cota)
  const fillGeo = new THREE.PlaneGeometry(1, 1, 8, 4);
  fillGeo.rotateX(-Math.PI / 2);
  const rnd = rng(31);
  const fp = fillGeo.attributes.position;
  for (let i = 0; i < fp.count; i++) fp.setY(i, (rnd() - 0.5) * 0.03);
  fillGeo.computeVertexNormals();
  const fill = new THREE.Mesh(fillGeo, M.wet);
  fill.position.set(0, 0, HOP.z);
  fill.castShadow = fill.receiveShadow = true;
  group.add(fill);
  const setLevel = (y: number) => {
    const [hx, hz] = hopHalf(y);
    fill.position.y = y;
    fill.scale.set(2 * (hx - HOP.t - 0.006), 1, 2 * (hz - HOP.t - 0.006));
  };

  // letrero y domo de la baliza (material propio: parpadea)
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.34), M.sign);
  sign.position.set(SHED.x + 0.008, 1.85, 0.75);
  sign.rotation.y = Math.PI / 2;
  sign.receiveShadow = true;
  group.add(sign);
  const beaconMat = new THREE.MeshStandardMaterial({ color: '#ffb02e', emissive: '#ff8a00', emissiveIntensity: 0, roughness: 0.3 });
  const dome = new THREE.Mesh(
    new THREE.LatheGeometry([[0, 0], [0.065, 0], [0.065, 0.08], [0.055, 0.115], [0.03, 0.138], [0, 0.145]].map(([r, y]) => new THREE.Vector2(r, y)), 16),
    beaconMat,
  );
  dome.position.set(1.6, roofY(1.6) + AMP + 0.07, 1.8);
  dome.castShadow = true;
  group.add(dome);

  const hopper = new THREE.Object3D();
  hopper.name = 'pumpHopper';
  hopper.position.set(...HOPPER_POINT);
  const outlet = new THREE.Object3D();
  outlet.name = 'pumpOutlet';
  outlet.position.set(...OUTLET);
  group.add(hopper, outlet);

  const tip = new THREE.Vector3(), base = new THREE.Vector3(), dir = new THREE.Vector3();
  const setValve = (theta: number) => {
    lever.rotation.z = theta;
    tip.set(-LEVER_L * Math.sin(theta), PY + LEVER_L * Math.cos(theta), VALVE_Z);
    rods.forEach((rod, i) => {
      base.set((i === 0 ? 1 : -1) * (RAM_X0 + 0.1), RAM_Y, VALVE_Z);
      dir.subVectors(tip, base);
      const len = dir.length();
      rod.position.copy(base).addScaledVector(dir, 0.5);
      rod.quaternion.setFromUnitVectors(UP, dir.divideScalar(len));
      rod.scale.set(1, len, 1);
    });
  };

  const setPumping = (on: boolean, t: number) => {
    if (!on) {
      setValve(SWING);
      setLevel(HOP.y0 + HOP.t + 0.07);
      engineGroup.position.set(0, 0, 0);
      beaconMat.emissiveIntensity = 0;
      return;
    }
    // cada embolada la válvula S cambia de cilindro de golpe (~0,25 s) y el nivel baja con la succión
    const s = t / STROKE;
    const k = Math.floor(s), f = s - k;
    const side = ((k % 2) + 2) % 2 === 0 ? 1 : -1;
    setValve(THREE.MathUtils.lerp(-side * SWING, side * SWING, smooth(f / 0.14)));
    setLevel(1.0 + 0.018 * (1 - 2 * f) + 0.004 * Math.sin(t * 7.3));
    agitator.rotation.x = -t * 2.6;
    engineGroup.position.set(0.003 * Math.sin(t * 91), 0.0025 * Math.sin(t * 127 + 1.3), 0.002 * Math.sin(t * 73 + 0.7));
    const p = (t * 0.9) % 1;
    beaconMat.emissiveIntensity = p < 0.1 || (p > 0.2 && p < 0.3) ? 2.6 : 0.05;
  };
  setPumping(false, 0);

  return {
    group,
    hopper,
    outlet,
    footprint: { w: FOOT.w, d: FOOT.d },
    setPumping,
    pickables: markPickable(group, { type: 'pump' }),
  };
}
