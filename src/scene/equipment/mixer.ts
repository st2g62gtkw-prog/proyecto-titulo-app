/**
 * Camión mixer 7 m³ (estilo International: cabina blanca con capó, tambor gris, 3 ejes).
 * Origen = suelo bajo el centro del vehículo; avanza hacia +x (cabina en +x).
 *
 * También exporta piezas comunes a los equipos: PartKit (fusión de geometría por material),
 * materiales de camión y juego de ruedas instanciado.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type XY = [number, number];
export type XYZ = [number, number, number];

const KEEP = new Set(['position', 'normal', 'uv']);
const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();

/**
 * Acumulador de piezas: cada primitiva se transforma y se agrupa por material;
 * build() entrega un Group con UNA malla por material (pocas llamadas de dibujo).
 * Las geometrías recibidas pasan a ser del kit (se descartan tras copiarlas).
 */
export class PartKit {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();

  /** Geometría con posición, giro (Euler XYZ, rad) y escala. */
  add(mat: THREE.Material, geo: THREE.BufferGeometry, pos: XYZ = [0, 0, 0], rot: XYZ = [0, 0, 0], scl: XYZ = [1, 1, 1]) {
    _m.compose(_p.set(...pos), _q.setFromEuler(_e.set(...rot)), _s.set(...scl));
    return this.addMatrix(mat, geo, _m);
  }

  addMatrix(mat: THREE.Material, geo: THREE.BufferGeometry, m: THREE.Matrix4) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    for (const k of Object.keys(g.attributes)) if (!KEEP.has(k)) g.deleteAttribute(k);
    g.clearGroups();
    g.applyMatrix4(m);
    let list = this.parts.get(mat);
    if (!list) this.parts.set(mat, (list = []));
    list.push(g);
    return this;
  }

  /** Caja alineada a los ejes entre dos esquinas. */
  box(mat: THREE.Material, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    return this.add(mat, new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]);
  }

  /** Caja centrada en `pos` con giro. */
  boxAt(mat: THREE.Material, sx: number, sy: number, sz: number, pos: XYZ, rot: XYZ = [0, 0, 0]) {
    return this.add(mat, new THREE.BoxGeometry(sx, sy, sz), pos, rot);
  }

  /** Cilindro o tronco de cono según eje x | y | z; rTop queda hacia el lado + del eje. */
  cyl(mat: THREE.Material, rTop: number, rBot: number, len: number, pos: XYZ, axis: 'x' | 'y' | 'z' = 'y', seg = 14, open = false) {
    const rot: XYZ = axis === 'x' ? [0, 0, -Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0];
    return this.add(mat, new THREE.CylinderGeometry(rTop, rBot, len, seg, 1, open), pos, rot);
  }

  /** Barra cilíndrica (tubo abierto) entre dos puntos. */
  bar(mat: THREE.Material, a: XYZ, b: XYZ, r: number, seg = 8) {
    _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = _d.length();
    if (len < 1e-5) return this;
    _q.setFromUnitVectors(UP, _d.divideScalar(len));
    _m.compose(_p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(1, 1, 1));
    return this.addMatrix(mat, new THREE.CylinderGeometry(r, r, len, seg, 1, true), _m);
  }

  /** Perfil lateral (x, y) extruido a lo largo de z entre z0 y z1. */
  profile(mat: THREE.Material, pts: XY[], z0: number, z1: number) {
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    return this.add(mat, new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false }), [0, 0, z0]);
  }

  /** Sólido de revolución en torno al eje y; perfil [radio, y]. */
  lathe(mat: THREE.Material, pts: XY[], seg: number, pos: XYZ = [0, 0, 0], rot: XYZ = [0, 0, 0]) {
    return this.add(mat, new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), pos, rot);
  }

  build(shadows = true): THREE.Group {
    const group = new THREE.Group();
    for (const [mat, list] of this.parts) {
      const geo = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      group.add(mesh);
    }
    this.parts.clear();
    return group;
  }
}

export const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** Marca como seleccionables todas las mallas bajo `root`. */
export function markPickable(root: THREE.Object3D, pick: { type: string; id?: string }): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.userData.pick = pick;
      out.push(o);
    }
  });
  return out;
}

// ───────────────────────── materiales compartidos ─────────────────────────

export interface TruckMaterials {
  white: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  tire: THREE.MeshStandardMaterial;
  rim: THREE.MeshStandardMaterial;
  amber: THREE.MeshStandardMaterial;
  red: THREE.MeshStandardMaterial;
  lamp: THREE.MeshStandardMaterial;
  grime: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
}

let truckMats: TruckMaterials | null = null;

export function truckMaterials(): TruckMaterials {
  if (truckMats) return truckMats;
  const std = (color: string, roughness: number, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  truckMats = {
    white: std('#f2f2ee', 0.4, 0.05),
    dark: std('#2b2e33', 0.7, 0.2),
    steel: std('#a3a9b0', 0.45, 0.3),
    chrome: std('#e2e6ea', 0.25, 0.5),
    glass: std('#1f2c37', 0.1, 0.4),
    tire: std('#1c1d1f', 0.88),
    rim: std('#ffffff', 0.4, 0.3, { vertexColors: true }),
    amber: std('#ffb238', 0.4, 0, { emissive: '#ff8a00', emissiveIntensity: 0.8 }),
    red: std('#d0241b', 0.4, 0, { emissive: '#8a0d08', emissiveIntensity: 0.7 }),
    lamp: std('#f6f3e8', 0.15, 0, { emissive: '#fff6d8', emissiveIntensity: 0.55 }),
    grime: std('#7e7f7c', 0.85, 0.2),
    concrete: std('#8a8a83', 0.3, 0.05),
  };
  return truckMats;
}

// ───────────────────────── ruedas ─────────────────────────

export interface WheelSpot {
  x: number;
  /** Centro de la rueda (o del par de ruedas gemelas). */
  z: number;
  dual: boolean;
}

export interface WheelSet {
  group: THREE.Group;
  radius: number;
  /** Gira las llantas según la distancia recorrida (m). */
  roll(distance: number): void;
}

const WHEEL_R = 0.52;
const TIRE_W = 0.3;
const DUAL_OFF = 0.165;
let wheelGeos: { tire: THREE.BufferGeometry; rim: THREE.BufferGeometry } | null = null;

function painted(geo: THREE.BufferGeometry, color: string, pos: XYZ, rot: XYZ = [0, 0, 0]) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.applyMatrix4(_m.compose(_p.set(...pos), _q.setFromEuler(_e.set(...rot)), _s.set(1, 1, 1)));
  return g;
}

function wheelGeometries() {
  if (wheelGeos) return wheelGeos;
  const h = TIRE_W / 2;
  // perfil del neumático (radio, ancho) con hombros redondeados; eje final = z
  const prof: XY[] = [[0.29, -h], [0.43, -h], [0.49, -h + 0.02], [0.515, -h + 0.05], [WHEEL_R, -h + 0.09], [WHEEL_R, h - 0.09], [0.515, h - 0.05], [0.49, h - 0.02], [0.43, h], [0.29, h]];
  const tire = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 22);
  tire.rotateX(Math.PI / 2);
  // llanta con perforaciones oscuras para que se note el giro (cara exterior hacia +z)
  const ax: XYZ = [Math.PI / 2, 0, 0];
  const parts = [
    painted(new THREE.CylinderGeometry(0.29, 0.29, 0.02, 22), '#c3c7cc', [0, 0, h - 0.04], ax),
    painted(new THREE.CylinderGeometry(0.286, 0.286, TIRE_W - 0.06, 22, 1, true), '#6f757c', [0, 0, -0.01], ax),
    painted(new THREE.CylinderGeometry(0.12, 0.15, 0.08, 14), '#4a4f55', [0, 0, h], ax),
    painted(new THREE.CylinderGeometry(0.06, 0.085, 0.06, 12), '#d2d6da', [0, 0, h + 0.06], ax),
  ];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    parts.push(painted(new THREE.BoxGeometry(0.07, 0.1, 0.024), '#1d1f22', [Math.cos(a) * 0.215, Math.sin(a) * 0.215, h - 0.035], [0, 0, a + Math.PI / 2]));
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    parts.push(painted(new THREE.BoxGeometry(0.025, 0.025, 0.04), '#e6e8ea', [Math.cos(a) * 0.165, Math.sin(a) * 0.165, h], [0, 0, a]));
  }
  const rim = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  wheelGeos = { tire, rim };
  return wheelGeos;
}

/** Ruedas de un camión: neumáticos y llantas como dos InstancedMesh. */
export function createWheels(spots: WheelSpot[]): WheelSet {
  const M = truckMaterials();
  const geo = wheelGeometries();
  const tireCount = spots.reduce((n, s) => n + (s.dual ? 2 : 1), 0);
  const tires = new THREE.InstancedMesh(geo.tire, M.tire, tireCount);
  const rims = new THREE.InstancedMesh(geo.rim, M.rim, spots.length);
  const flip = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);
  const spin = new THREE.Quaternion();
  const Z = new THREE.Vector3(0, 0, 1);
  let ti = 0;
  for (const s of spots) {
    const side = Math.sign(s.z) || 1;
    const offs = s.dual ? [-DUAL_OFF, DUAL_OFF] : [0];
    for (const o of offs) tires.setMatrixAt(ti++, _m.compose(_p.set(s.x, WHEEL_R, s.z + o), side > 0 ? _q.identity() : flip, _s.set(1, 1, 1)));
  }
  const roll = (distance: number) => {
    const a = distance / WHEEL_R;
    spots.forEach((s, i) => {
      const side = Math.sign(s.z) || 1;
      const zOut = s.z + (s.dual ? side * DUAL_OFF : 0);
      spin.setFromAxisAngle(Z, side > 0 ? -a : a);
      if (side < 0) spin.premultiply(flip);
      rims.setMatrixAt(i, _m.compose(_p.set(s.x, WHEEL_R, zOut), spin, _s.set(1, 1, 1)));
    });
    rims.instanceMatrix.needsUpdate = true;
  };
  roll(0);
  for (const m of [tires, rims]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.computeBoundingSphere();
  }
  const group = new THREE.Group();
  group.add(tires, rims);
  return { group, radius: WHEEL_R, roll };
}

// ───────────────────────── mixer ─────────────────────────

export interface MixerRig {
  group: THREE.Group;
  length: number;
  chuteTip: THREE.Object3D;
  setDrumSpin(angle: number): void;
  setChute(k: number): void;
  setDischarge(on: boolean): void;
  setWheels(distance: number): void;
  pickables: THREE.Object3D[];
}

/** Eje del tambor: punta del domo delantero e inclinación (sube hacia atrás). */
const DRUM_FRONT: XY = [1.4, 2.27];
const DRUM_TILT = THREE.MathUtils.degToRad(10.5);
const DRUM_LEN = 5.45;
/** Perfil del tambor [radio, distancia sobre el eje desde el domo]. */
const DRUM_PROFILE: XY[] = [
  [0.0, 0], [0.35, 0.06], [0.62, 0.18], [0.85, 0.35], [1.02, 0.6], [1.13, 1.0], [1.18, 1.6], [1.18, 2.3],
  [1.1, 3.0], [0.95, 3.7], [0.8, 4.3], [0.64, 4.8], [0.52, 5.2], [0.49, 5.4], [0.46, DRUM_LEN], [0.4, DRUM_LEN], [0.36, 5.15],
];
const CHUTE_PIVOT: XYZ = [-4.45, 2.12, 0];
const CHUTE_LEN = 1.95;

let drumMat: THREE.MeshStandardMaterial | null = null;

/** Tambor: gris cálido con bandas helicoidales tenues, costuras y salpicaduras de hormigón. */
function drumMaterial() {
  if (drumMat) return drumMat;
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c3bdb0';
  g.fillRect(0, 0, W, H);
  // u (x del canvas) = vuelta alrededor del eje; v = largo del tambor (y=0 → boca trasera)
  const helix = (off: number, width: number, color: string) => {
    g.fillStyle = color;
    for (const k of [-2, -1, 0, 1]) {
      g.beginPath();
      g.moveTo((off + k) * W, H);
      g.lineTo((off + k + width) * W, H);
      g.lineTo((off + k + width + 1.6) * W, 0);
      g.lineTo((off + k + 1.6) * W, 0);
      g.closePath();
      g.fill();
    }
  };
  helix(0, 0.13, '#a19b8f');
  helix(0.5, 0.13, '#a19b8f');
  helix(0.13, 0.012, '#e4dfd4');
  helix(0.63, 0.012, '#e4dfd4');
  // costuras circunferenciales
  g.fillStyle = 'rgba(70,66,60,0.35)';
  for (const v of [0.3, 0.52, 0.74]) g.fillRect(0, (1 - v) * H, W, 2);
  // suciedad hacia la boca y salpicaduras (semilla fija)
  const grad = g.createLinearGradient(0, 0, 0, H * 0.4);
  grad.addColorStop(0, 'rgba(120,116,108,0.75)');
  grad.addColorStop(1, 'rgba(120,116,108,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H * 0.4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 260; i++) {
    const y = Math.pow(rnd(), 1.8) * H;
    g.fillStyle = rnd() > 0.5 ? 'rgba(135,131,122,0.7)' : 'rgba(208,203,193,0.6)';
    g.beginPath();
    g.ellipse(rnd() * W, y, 2 + rnd() * 6, 1 + rnd() * 3, 0, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  drumMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0.12 });
  return drumMat;
}

function buildMixerBody(kit: PartKit) {
  const M = truckMaterials();
  // chasis
  kit.box(M.dark, -4.72, 0.72, -0.48, 4.5, 1.0, -0.36);
  kit.box(M.dark, -4.72, 0.72, 0.36, 4.5, 1.0, 0.48);
  kit.box(M.dark, -4.5, 1.0, -0.55, 1.62, 1.14, 0.55);
  // parachoques y capó
  kit.box(M.chrome, 4.55, 0.5, -1.22, 4.8, 0.86, 1.22);
  kit.box(M.dark, 4.5, 0.42, -1.0, 4.74, 0.5, 1.0);
  kit.profile(M.white, [[3.1, 0.98], [4.5, 0.98], [4.6, 1.2], [4.6, 1.9], [4.47, 2.04], [3.1, 2.14]], -0.68, 0.68);
  // parrilla cromada con lamas
  kit.box(M.chrome, 4.58, 1.06, -0.6, 4.64, 1.96, 0.6);
  kit.box(M.dark, 4.62, 1.14, -0.5, 4.665, 1.88, 0.5);
  for (let i = 0; i < 5; i++) kit.box(M.chrome, 4.64, 1.22 + i * 0.14, -0.5, 4.685, 1.255 + i * 0.14, 0.5);
  kit.box(M.chrome, 4.6, 1.97, -0.12, 4.66, 2.03, 0.12);
  // tapabarros delanteros con arco de rueda
  const arch: XY[] = [];
  for (let i = 0; i <= 10; i++) {
    const a = THREE.MathUtils.degToRad(15 + i * 15);
    arch.push([3.62 + 0.66 * Math.cos(a), 0.52 + 0.66 * Math.sin(a)]);
  }
  const fender: XY[] = [[2.95, 0.69], [2.95, 1.52], [4.44, 1.46], [4.57, 1.28], [4.57, 0.69], ...arch];
  kit.profile(M.white, fender, 0.68, 1.24);
  kit.profile(M.white, fender, -1.24, -0.68);
  for (const s of [-1, 1]) {
    kit.box(M.lamp, 4.55, 1.1, s > 0 ? 0.8 : -1.12, 4.6, 1.3, s > 0 ? 1.12 : -0.8);
    kit.box(M.amber, 4.5, 1.33, s > 0 ? 0.95 : -1.12, 4.54, 1.4, s > 0 ? 1.12 : -0.95);
  }
  // cabina
  kit.profile(M.white, [[1.72, 1.15], [3.12, 1.15], [3.12, 2.14], [3.0, 2.95], [2.88, 3.08], [1.72, 3.08]], -1.18, 1.18);
  kit.box(M.dark, 1.72, 0.98, -1.15, 3.12, 1.15, 1.15);
  kit.boxAt(M.glass, 0.03, 0.75, 2.12, [3.072, 2.548, 0], [0, 0, 0.147]);
  for (const s of [-1, 1]) {
    kit.box(M.glass, 2.15, 2.18, s > 0 ? 1.175 : -1.195, 2.95, 2.88, s > 0 ? 1.195 : -1.175);
    kit.box(M.dark, 2.22, 1.98, s > 0 ? 1.18 : -1.2, 2.36, 2.02, s > 0 ? 1.2 : -1.18);
    // espejos
    kit.bar(M.dark, [2.98, 2.75, s * 1.18], [3.05, 2.7, s * 1.42], 0.018, 6);
    kit.bar(M.dark, [2.98, 2.2, s * 1.18], [3.05, 2.22, s * 1.42], 0.018, 6);
    kit.boxAt(M.dark, 0.06, 0.55, 0.2, [3.05, 2.45, s * 1.45]);
  }
  kit.box(M.glass, 1.705, 2.35, -0.55, 1.72, 2.8, 0.55);
  for (let i = 0; i < 5; i++) kit.boxAt(M.amber, 0.07, 0.05, 0.09, [2.86, 3.1, -0.5 + i * 0.25]);
  // peldaños, estanque de combustible, escape y filtro de aire
  kit.box(M.dark, 2.0, 0.55, 1.0, 2.85, 0.6, 1.22);
  kit.box(M.dark, 2.0, 0.85, 1.0, 2.85, 0.9, 1.22);
  kit.cyl(M.chrome, 0.3, 0.3, 1.0, [2.4, 0.75, -0.92], 'x', 18);
  kit.cyl(M.chrome, 0.08, 0.08, 2.4, [1.6, 2.35, 0.98], 'y', 10);
  kit.cyl(M.dark, 0.2, 0.2, 0.9, [1.6, 1.85, -0.95], 'y', 14);
  // caja de herramientas y estanque de agua
  kit.box(M.white, 0.2, 0.62, 0.72, 1.4, 1.05, 1.22);
  kit.cyl(M.white, 0.3, 0.3, 2.4, [0.1, 0.86, -0.92], 'x', 16);
  // guardafangos traseros, faldones y parachoques
  for (const s of [-1, 1]) {
    kit.box(M.dark, -4.3, 1.12, s > 0 ? 0.62 : -1.28, -1.4, 1.17, s > 0 ? 1.28 : -0.62);
    kit.box(M.dark, -4.32, 0.28, s > 0 ? 0.65 : -1.22, -4.28, 1.12, s > 0 ? 1.22 : -0.65);
    kit.box(M.red, -4.82, 0.46, s > 0 ? 0.75 : -1.05, -4.79, 0.58, s > 0 ? 1.05 : -0.75);
    kit.box(M.steel, -4.75, 0.62, s > 0 ? 0.5 : -0.6, -4.65, 1.0, s > 0 ? 0.6 : -0.5);
  }
  kit.box(M.steel, -4.8, 0.4, -1.15, -4.68, 0.62, 1.15);
  // pedestal delantero y trasero del tambor (con rodillos)
  kit.box(M.dark, 1.2, 1.14, -0.42, 1.55, 2.05, 0.42);
  for (const s of [-1, 1]) {
    kit.bar(M.dark, [-3.15, 1.14, s * 0.6], [-2.83, 2.2, s * 0.55], 0.07);
    kit.bar(M.dark, [-2.5, 1.14, s * 0.6], [-2.83, 2.2, s * 0.55], 0.07);
    kit.cyl(M.dark, 0.11, 0.11, 0.16, [-2.83, 2.27, s * 0.545], 'x', 12);
  }
  kit.box(M.dark, -2.95, 2.05, -0.62, -2.7, 2.2, 0.62);
  // tolva de carga (arriba) y de descarga (bajo la boca)
  kit.add(M.grime, new THREE.CylinderGeometry(0.62, 0.25, 0.6, 4, 1, true), [-4.25, 3.8, 0], [0, Math.PI / 4, 0.35]);
  kit.add(M.grime, new THREE.CylinderGeometry(0.45, 0.18, 0.38, 4, 1, true), [-4.35, 2.62, 0], [0, Math.PI / 4, 0]);
  for (const s of [-1, 1]) {
    kit.bar(M.grime, [-4.45, 3.5, s * 0.35], [-3.6, 2.25, s * 0.55], 0.04);
    kit.bar(M.grime, [-4.45, 2.45, s * 0.3], [-3.2, 2.15, s * 0.5], 0.035);
  }
  kit.cyl(M.dark, 0.1, 0.1, 0.25, [CHUTE_PIVOT[0], CHUTE_PIVOT[1] + 0.08, 0], 'y', 10);
  // plataforma y escalera trasera
  kit.box(M.steel, -4.65, 2.98, 0.4, -4.05, 3.04, 1.1);
  kit.bar(M.steel, [-4.65, 3.04, 1.1], [-4.65, 3.85, 1.1], 0.025);
  kit.bar(M.steel, [-4.05, 3.04, 1.1], [-4.05, 3.85, 1.1], 0.025);
  kit.bar(M.steel, [-4.65, 3.85, 1.1], [-4.05, 3.85, 1.1], 0.025);
  for (const z of [0.6, 1.02]) kit.bar(M.steel, [-4.8, 0.45, z], [-4.62, 3.0, z], 0.022);
  for (let i = 1; i < 9; i++) {
    const t = i / 9;
    const x = -4.8 + 0.18 * t, y = 0.45 + 2.55 * t;
    kit.bar(M.steel, [x, y, 0.6], [x, y, 1.02], 0.016, 6);
  }
}

function buildDrum(): THREE.Group {
  const M = truckMaterials();
  const pivot = new THREE.Group();
  pivot.position.set(DRUM_FRONT[0], DRUM_FRONT[1], 0);
  pivot.quaternion.setFromUnitVectors(UP, new THREE.Vector3(-Math.cos(DRUM_TILT), Math.sin(DRUM_TILT), 0));
  const spin = new THREE.Group();
  spin.name = 'drumSpin';
  const kit = new PartKit();
  kit.lathe(drumMaterial(), DRUM_PROFILE.map(([r, a]) => [r, a] as XY), 40);
  kit.add(M.dark, new THREE.TorusGeometry(0.83, 0.05, 8, 40), [0, 4.3, 0], [Math.PI / 2, 0, 0]);
  kit.add(M.dark, new THREE.TorusGeometry(0.47, 0.035, 6, 28), [0, 5.36, 0], [Math.PI / 2, 0, 0]);
  spin.add(kit.build());
  // reductor (no gira)
  const box = new PartKit();
  box.cyl(M.dark, 0.3, 0.26, 0.35, [0, -0.12, 0], 'y', 16);
  pivot.add(spin, box.build());
  return pivot;
}

function buildChute() {
  const M = truckMaterials();
  const yaw = new THREE.Group();
  yaw.position.set(...CHUTE_PIVOT);
  const pitch = new THREE.Group();
  yaw.add(pitch);
  const kit = new PartKit();
  const L = CHUTE_LEN;
  kit.box(M.grime, 0.0, -0.025, -0.21, L, 0.0, 0.21);
  kit.boxAt(M.grime, L, 0.21, 0.02, [L / 2, 0.1, 0.24], [0.28, 0, 0]);
  kit.boxAt(M.grime, L, 0.21, 0.02, [L / 2, 0.1, -0.24], [-0.28, 0, 0]);
  kit.box(M.dark, -0.05, -0.08, -0.12, 0.25, -0.02, 0.12);
  kit.boxAt(M.dark, 0.04, 0.1, 0.5, [0.97, -0.05, 0]);
  pitch.add(kit.build());
  const flow = new PartKit();
  flow.box(truckMaterials().concrete, 0.05, 0.0, -0.18, L - 0.01, 0.06, 0.18);
  const concrete = flow.build();
  concrete.visible = false;
  pitch.add(concrete);
  const tip = new THREE.Object3D();
  tip.position.set(L + 0.04, 0.02, 0);
  pitch.add(tip);
  return { yaw, pitch, concrete, tip };
}

export function createMixer(): MixerRig {
  const group = new THREE.Group();
  group.name = 'mixer';
  const kit = new PartKit();
  buildMixerBody(kit);
  group.add(kit.build());

  const drum = buildDrum();
  const drumSpin = drum.getObjectByName('drumSpin')!;
  group.add(drum);

  const chute = buildChute();
  group.add(chute.yaw);

  const wheels = createWheels([
    { x: 3.62, z: 1.07, dual: false }, { x: 3.62, z: -1.07, dual: false },
    { x: -2.15, z: 0.92, dual: true }, { x: -2.15, z: -0.92, dual: true },
    { x: -3.55, z: 0.92, dual: true }, { x: -3.55, z: -0.92, dual: true },
  ]);
  group.add(wheels.group);

  const setChute = (k: number) => {
    const s = smooth(k);
    chute.yaw.rotation.y = THREE.MathUtils.lerp(Math.PI / 2, Math.PI, s);
    chute.pitch.rotation.z = THREE.MathUtils.lerp(THREE.MathUtils.degToRad(62), THREE.MathUtils.degToRad(-24), s);
  };
  setChute(0);

  return {
    group,
    length: 9.6,
    chuteTip: chute.tip,
    setDrumSpin: (angle) => { drumSpin.rotation.y = angle; },
    setChute,
    setDischarge: (on) => { chute.concrete.visible = on; },
    setWheels: (d) => wheels.roll(d),
    pickables: markPickable(group, { type: 'mixer' }),
  };
}
