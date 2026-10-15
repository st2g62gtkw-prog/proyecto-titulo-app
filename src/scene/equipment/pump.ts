/**
 * Camión bomba pluma 42 m (cabina adelantada blanca, pluma de 4 tramos plegada en Z,
 * torreta tras la cabina, 4 estabilizadores, tolva trasera y manguera final de 3,5 m).
 * Origen = suelo bajo el centro del vehículo; avanza hacia +x (cabina en +x).
 *
 * La pluma vive en un plano vertical que gira con la torreta (grupo `slew`, eje y).
 * En ese plano x = alcance horizontal r, y = altura h; cada tramo es un grupo girado en z.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PartKit, createWheels, markPickable, smooth, truckMaterials, type XY } from './mixer';

export interface PumpRig {
  group: THREE.Group;
  length: number;
  boomReach: number;
  setOutriggers(k: number): void;
  setBoom(k: number, target: THREE.Vector3 | null): void;
  hoseTip: THREE.Object3D;
  hopper: THREE.Object3D;
  pickables: THREE.Object3D[];
}

const deg = THREE.MathUtils.degToRad;
const SLEW_X = 3.65;
/** Pivote del 1er tramo en el plano de la pluma (r, h). */
const J0: XY = [0.35, 3.45];
const SECTIONS = [
  { L: 10.0, h0: 0.75, h1: 0.56, w: 0.5 },
  { L: 9.4, h0: 0.56, h1: 0.46, w: 0.44 },
  { L: 9.3, h0: 0.46, h1: 0.37, w: 0.38 },
  { L: 9.3, h0: 0.37, h1: 0.27, w: 0.32 },
];
const LEN = SECTIONS.map((s) => s.L);
const LSUM = LEN.reduce((a, b) => a + b, 0);
const HOSE = 3.5;
/** Ángulos relativos de transporte (plegado en Z sobre el camión). */
const FOLD = [deg(0), deg(176.5), deg(-176.5), deg(176.5)];
const YAW_FOLD = Math.PI;
/** Ventanas de despliegue escalonado [k0, k1]: tramos 1..4, giro de torreta, manguera. */
const WIN_SEC: XY[] = [[0, 0.4], [0.22, 0.62], [0.4, 0.8], [0.55, 0.95]];
const WIN_YAW: XY = [0.12, 0.5];
const WIN_HOSE: XY = [0.8, 1.0];
/** Pose "de operador": 1er tramo empinado y último colgando; tramos 2–3 resuelven el resto. */
const T1_NAT = deg(80);
const T4_NAT = deg(-78);
const T1_MIN = deg(8);

const FRONT_PIVOT = { x: 2.55, y: 1.62, z: 1.0, len: 3.75 };
const FRONT_SWING = deg(125);
const REAR = { x: -4.775, y: 1.21, z: 1.45, ext: 2.75 };

const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const win = (k: number, w: XY) => smooth((k - w[0]) / (w[1] - w[0]));

let pumpMats: Record<'boom' | 'pipe' | 'rubber' | 'pad' | 'warn', THREE.MeshStandardMaterial> | null = null;
function materials() {
  if (pumpMats) return pumpMats;
  pumpMats = {
    boom: new THREE.MeshStandardMaterial({ color: '#f2a516', roughness: 0.42, metalness: 0.1 }),
    pipe: new THREE.MeshStandardMaterial({ color: '#8d949b', roughness: 0.5, metalness: 0.35 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#1d1e20', roughness: 0.75 }),
    pad: new THREE.MeshStandardMaterial({ color: '#2a2c2f', roughness: 0.9 }),
    warn: new THREE.MeshStandardMaterial({ color: '#c8261d', roughness: 0.5 }),
  };
  return pumpMats;
}

// ───────────────────────── cinemática de la pluma ─────────────────────────

const _pose = { t1: 0, t4: 0, ax: 0, ay: 0, bx: 0, by: 0, d: 0 };
function operatorPose(R: number, Z: number, e: number, phi: number) {
  const p = _pose;
  p.t1 = Math.max(T1_MIN, T1_NAT + (phi - T1_NAT) * e);
  p.t4 = T4_NAT + (phi - T4_NAT) * e;
  p.ax = LEN[0] * Math.cos(p.t1);
  p.ay = LEN[0] * Math.sin(p.t1);
  p.bx = R - LEN[3] * Math.cos(p.t4);
  p.by = Z - LEN[3] * Math.sin(p.t4);
  p.d = Math.hypot(p.bx - p.ax, p.by - p.ay);
  return p;
}

/**
 * Ángulos absolutos de los 4 tramos para llevar la punta a (R, Z) respecto del pivote J0.
 * `e` mezcla la pose de operador con la recta al objetivo: crece con la distancia y lo
 * justo para que los tramos 2–3 alcancen (bisección). Todo es continuo en (R, Z);
 * fuera de alcance, la pluma se estira apuntando al objetivo.
 */
function solveBoom(R: number, Z: number, out: number[]) {
  let D = Math.hypot(R, Z);
  const maxD = LSUM * 0.995;
  if (D > maxD) {
    R *= maxD / D;
    Z *= maxD / D;
    D = maxD;
  }
  const phi = Math.atan2(Z, R);
  const dMax = (LEN[1] + LEN[2]) * 0.97;
  let e = smooth((D / LSUM - 0.62) / 0.37);
  if (operatorPose(R, Z, e, phi).d > dMax) {
    let lo = e, hi = 1;
    for (let i = 0; i < 26; i++) {
      const m = (lo + hi) / 2;
      if (operatorPose(R, Z, m, phi).d > dMax) lo = m;
      else hi = m;
    }
    e = hi;
  }
  const p = operatorPose(R, Z, e, phi);
  // tramos 2–3: dos barras con el codo hacia arriba
  const d = Math.min(Math.max(p.d, 1e-4), LEN[1] + LEN[2] - 1e-6);
  const base = Math.atan2(p.by - p.ay, p.bx - p.ax);
  const c = (LEN[1] * LEN[1] + d * d - LEN[2] * LEN[2]) / (2 * LEN[1] * d);
  const t2 = base + Math.acos(Math.min(1, Math.max(-1, c)));
  const ex = p.ax + LEN[1] * Math.cos(t2), ey = p.ay + LEN[1] * Math.sin(t2);
  out[0] = p.t1;
  out[1] = t2;
  out[2] = Math.atan2(p.by - ey, p.bx - ex);
  out[3] = p.t4;
}

// ───────────────────────── geometría ─────────────────────────

function buildTruck(kit: PartKit) {
  const M = truckMaterials();
  const P = materials();
  // chasis y cabina adelantada
  for (const s of [-1, 1]) kit.box(M.dark, -5.3, 0.72, s > 0 ? 0.36 : -0.48, 5.6, 1.0, s > 0 ? 0.48 : -0.36);
  kit.profile(M.white, [[4.42, 1.05], [6.05, 1.05], [6.1, 1.95], [5.98, 3.02], [5.85, 3.3], [4.42, 3.3]], -1.24, 1.24);
  kit.boxAt(M.glass, 0.03, 0.95, 2.25, [6.052, 2.486, 0], [0, 0, 0.1117]);
  kit.box(M.dark, 6.06, 1.2, -0.9, 6.11, 1.85, 0.9);
  for (const y of [1.33, 1.53, 1.73]) kit.box(M.steel, 6.1, y, -0.85, 6.125, y + 0.05, 0.85);
  kit.box(M.dark, 5.95, 0.5, -1.24, 6.2, 1.02, 1.24);
  kit.box(M.dark, 5.86, 3.18, -1.15, 6.12, 3.26, 1.15);
  for (const s of [-1, 1]) {
    const z = (a: number, b: number): [number, number] => (s > 0 ? [a, b] : [-b, -a]);
    let [z0, z1] = z(0.72, 1.06);
    kit.box(M.lamp, 6.2, 0.7, z0, 6.215, 0.86, z1);
    [z0, z1] = z(1.06, 1.2);
    kit.box(M.amber, 6.2, 0.7, z0, 6.215, 0.86, z1);
    [z0, z1] = z(1.24, 1.255);
    kit.box(M.glass, 5.0, 2.08, z0, 5.88, 2.95, z1);
    kit.box(M.dark, 5.05, 1.9, z0, 5.2, 1.94, z1);
    [z0, z1] = z(1.0, 1.24);
    kit.box(M.dark, 5.6, 0.5, z0, 5.95, 0.56, z1);
    kit.box(M.dark, 5.6, 0.78, z0, 5.95, 0.84, z1);
    [z0, z1] = z(0.75, 1.27);
    kit.box(M.dark, 4.45, 1.0, z0, 5.6, 1.1, z1);
    kit.box(M.dark, 2.75, 1.12, z0, 3.85, 1.17, z1);
    [z0, z1] = z(0.62, 1.28);
    kit.box(M.dark, -4.5, 1.12, z0, -1.9, 1.17, z1);
    [z0, z1] = z(0.65, 1.22);
    kit.box(M.dark, -4.52, 0.28, z0, -4.48, 1.12, z1);
    [z0, z1] = z(0.75, 1.05);
    kit.box(M.red, -5.335, 0.45, z0, -5.32, 0.58, z1);
    // espejos y balizas
    kit.bar(M.dark, [5.95, 2.9, s * 1.24], [6.05, 2.85, s * 1.48], 0.02, 6);
    kit.bar(M.dark, [5.95, 2.25, s * 1.24], [6.05, 2.3, s * 1.48], 0.02, 6);
    kit.boxAt(M.dark, 0.06, 0.6, 0.22, [6.05, 2.57, s * 1.5]);
    kit.cyl(M.amber, 0.08, 0.1, 0.14, [4.65, 3.37, s * 0.9], 'y', 10);
    // casilleros laterales con puertas
    [z0, z1] = z(0.6, 1.2);
    kit.box(M.white, -1.75, 0.5, z0, 2.1, 1.42, z1);
    for (const x of [-0.85, 0.15, 1.1]) kit.box(M.dark, x, 0.56, s * 1.2 - 0.008, x + 0.02, 1.36, s * 1.2 + 0.008);
    for (const x of [-0.6, 0.4, 1.35]) kit.box(M.dark, x, 1.2, s * 1.2 - 0.012, x + 0.16, 1.24, s * 1.2 + 0.012);
    // apoyo de pluma
    kit.bar(P.boom, [-3.6, 1.42, s * 0.55], [-3.6, 3.02, s * 0.4], 0.07);
  }
  kit.box(M.dark, -3.75, 3.0, -0.45, -3.45, 3.14, 0.45);
  // sobrechasis, estanque de agua, cilindros de bombeo y cajón de agua
  kit.box(P.boom, -5.3, 1.0, -0.55, 4.4, 1.42, 0.55);
  kit.box(M.white, -1.6, 1.42, -0.5, 1.9, 2.05, 0.5);
  for (const s of [-1, 1]) kit.cyl(M.steel, 0.13, 0.13, 2.7, [-3.1, 1.62, s * 0.25], 'x', 14);
  kit.box(P.boom, -2.2, 1.42, -0.45, -1.75, 1.95, 0.45);
  kit.box(P.boom, -4.85, 1.42, -0.42, -4.45, 1.85, 0.42);
  // tolva trasera con parrilla
  const hopper = new THREE.CylinderGeometry(0.62, 0.38, 0.55, 4, 1, true);
  hopper.rotateY(Math.PI / 4);
  kit.add(M.grime, hopper, [-5.8, 1.12, 0], [0, 0, 0], [0.72, 1, 1]);
  for (let i = 0; i < 6; i++) kit.box(M.steel, -6.06 + i * 0.1, 1.38, -0.42, -6.04 + i * 0.1, 1.41, 0.42);
  kit.box(M.dark, -5.6, 0.8, -0.4, -5.3, 1.0, 0.4);
  kit.box(M.dark, -5.32, 0.42, -1.1, -5.2, 0.62, 1.1);
  // tubería de impulsión hasta la torreta
  kit.cyl(P.pipe, 0.07, 0.07, 8.1, [-1.15, 1.55, 0.68], 'x', 10);
  kit.cyl(P.pipe, 0.07, 0.07, 1.05, [2.9, 2.07, 0.68], 'y', 10);
  // torreta fija, cajas de estabilizadores
  kit.box(P.boom, 2.95, 1.0, -0.75, 4.35, 1.6, 0.75);
  kit.cyl(P.boom, 0.62, 0.66, 1.0, [SLEW_X, 2.1, 0], 'y', 24);
  kit.cyl(M.dark, 0.7, 0.7, 0.15, [SLEW_X, 2.67, 0], 'y', 24);
  kit.box(P.boom, 2.3, 1.42, -1.05, 2.8, 1.82, 1.05);
  kit.box(P.boom, REAR.x - 0.225, 1.0, -1.18, REAR.x + 0.225, 1.42, 1.18);
}

/** Cabezal giratorio de la torreta (en coordenadas del plano de la pluma). */
function buildHead(kit: PartKit) {
  const M = truckMaterials();
  const P = materials();
  const cheek: XY[] = [[-0.55, 2.75], [0.9, 2.75], [1.25, 2.92], [1.25, 3.1], [0.75, 3.55], [0.35, 3.95], [-0.15, 3.95], [-0.6, 3.5]];
  kit.profile(P.boom, cheek, 0.27, 0.42);
  kit.profile(P.boom, cheek, -0.42, -0.27);
  kit.box(P.boom, -0.55, 2.75, -0.42, 1.25, 3.0, 0.42);
  kit.cyl(M.steel, 0.11, 0.11, 0.95, [J0[0], J0[1], 0], 'z', 12);
  kit.cyl(M.steel, 0.08, 0.08, 0.5, [1.05, 2.97, 0], 'z', 10);
  kit.box(M.dark, -0.9, 2.8, -0.3, -0.55, 3.25, 0.3);
  kit.cyl(P.pipe, 0.07, 0.07, 0.75, [-0.25, 3.1, 0.52], 'y', 10);
}

/** Tramo de pluma a lo largo de +x local: viga cajón ahusada, rótulas y tubería lateral. */
function buildSection(i: number): THREE.Group {
  const { L, h0, h1, w } = SECTIONS[i];
  const P = materials();
  const kit = new PartKit();
  const beam = new THREE.BoxGeometry(L - 0.2, 1, w);
  beam.translate((L - 0.2) / 2 + 0.1, 0, 0);
  const pos = beam.attributes.position;
  for (let v = 0; v < pos.count; v++) pos.setY(v, pos.getY(v) * THREE.MathUtils.lerp(h0, h1, pos.getX(v) / L));
  beam.computeVertexNormals();
  kit.add(P.boom, beam);
  kit.cyl(P.boom, h0 * 0.55, h0 * 0.55, w + 0.06, [0, 0, 0], 'z', 18);
  kit.cyl(P.boom, h1 * 0.6, h1 * 0.6, w * 0.8, [L, 0, 0], 'z', 16);
  kit.cyl(P.pipe, 0.075, 0.075, w + 0.16, [0, 0, 0], 'z', 10);
  const pz = w / 2 + 0.1;
  kit.cyl(P.pipe, 0.068, 0.068, L - 0.5, [L / 2, 0, pz], 'x', 10);
  for (const x of [0.4, L - 0.4]) kit.cyl(P.pipe, 0.095, 0.095, 0.12, [x, 0, pz], 'x', 10);
  for (let x = 1.4; x < L - 0.8; x += 2.2) kit.box(P.pipe, x - 0.04, -0.1, w / 2 - 0.01, x + 0.04, 0.1, pz + 0.02);
  if (i === 3) {
    kit.box(P.warn, L - 0.9, -h1 / 2 - 0.01, -w / 2 - 0.01, L - 0.55, h1 / 2 + 0.01, w / 2 + 0.01);
    kit.cyl(P.pipe, 0.09, 0.07, 0.35, [L, -0.2, 0], 'y', 10);
  }
  return kit.build();
}

function unitCylinder(r: number, y0: number, y1: number, seg: number) {
  const g = new THREE.CylinderGeometry(r, r, y1 - y0, seg);
  g.translate(0, (y0 + y1) / 2, 0);
  return g;
}

// ───────────────────────── rig ─────────────────────────

export function createPump(): PumpRig {
  const M = truckMaterials();
  const P = materials();
  const group = new THREE.Group();
  group.name = 'pump';

  const kit = new PartKit();
  buildTruck(kit);
  group.add(kit.build());

  const wheels = createWheels([
    { x: 5.05, z: 1.07, dual: false }, { x: 5.05, z: -1.07, dual: false },
    { x: 3.3, z: 1.07, dual: false }, { x: 3.3, z: -1.07, dual: false },
    { x: -2.5, z: 0.92, dual: true }, { x: -2.5, z: -0.92, dual: true },
    { x: -3.9, z: 0.92, dual: true }, { x: -3.9, z: -0.92, dual: true },
  ]);
  group.add(wheels.group);

  const hopper = new THREE.Object3D();
  hopper.position.set(-5.8, 1.4, 0);
  group.add(hopper);

  // ── torreta y pluma
  const slew = new THREE.Group();
  slew.position.x = SLEW_X;
  group.add(slew);
  const head = new PartKit();
  buildHead(head);
  slew.add(head.build());
  const sections = SECTIONS.map((_, i) => {
    const g = new THREE.Group();
    g.add(buildSection(i));
    slew.add(g);
    return g;
  });

  // cilindros hidráulicos: camisa (color pluma) y vástago (cromado)
  const ramGeo = unitCylinder(1, 0, 1, 12);
  const barrels = new THREE.InstancedMesh(ramGeo, P.boom, 4);
  const rods = new THREE.InstancedMesh(ramGeo, M.chrome, 4);
  for (const m of [barrels, rods]) {
    m.castShadow = true;
    m.frustumCulled = false;
    slew.add(m);
  }
  const RAM = [
    { r: 0.13, barrel: 1.9 }, { r: 0.1, barrel: 1.5 }, { r: 0.085, barrel: 1.3 }, { r: 0.07, barrel: 1.1 },
  ];

  // manguera final
  const hose = new THREE.Group();
  const hoseBody = new THREE.Mesh(unitCylinder(0.065, -1, 0, 10), P.rubber);
  const hoseCoupling = new THREE.Mesh(unitCylinder(0.09, -0.22, 0, 10), P.pipe);
  hoseBody.castShadow = hoseCoupling.castShadow = true;
  hose.add(hoseBody, hoseCoupling);
  slew.add(hose);
  const hoseTip = new THREE.Object3D();
  hose.add(hoseTip);

  // ── estabilizadores
  const front = [1, -1].map((s) => {
    const k = new PartKit();
    const z0 = -0.14, z1 = 0.14;
    k.box(P.boom, 0, -0.16, z0, FRONT_PIVOT.len + 0.15, 0.16, z1);
    k.cyl(P.boom, 0.2, 0.2, 0.42, [0, 0, 0], 'y', 14);
    k.cyl(P.boom, 0.13, 0.13, 1.2, [FRONT_PIVOT.len, 0.3, 0], 'y', 14);
    k.cyl(M.dark, 0.09, 0.09, 0.08, [FRONT_PIVOT.len, 0.94, 0], 'y', 10);
    k.box(P.warn, FRONT_PIVOT.len - 0.75, -0.165, z0 - 0.005, FRONT_PIVOT.len - 0.45, 0.165, z1 + 0.005);
    const g = k.build();
    g.position.set(FRONT_PIVOT.x, FRONT_PIVOT.y, s * FRONT_PIVOT.z);
    group.add(g);
    return { g, s };
  });
  const rear = [1, -1].map((s) => {
    const k = new PartKit();
    const zz = (a: number, b: number) => (s > 0 ? [a, b] : [-b, -a]);
    const [z0, z1] = zz(-1.2, REAR.z - 0.1);
    k.box(P.boom, -0.19, -0.14, z0, 0.19, 0.14, z1);
    k.cyl(P.boom, 0.13, 0.13, 1.2, [0, 0.3, s * REAR.z], 'y', 14);
    k.cyl(M.dark, 0.09, 0.09, 0.08, [0, 0.94, s * REAR.z], 'y', 10);
    const [w0, w1] = zz(REAR.z - 0.7, REAR.z - 0.4);
    k.box(P.warn, -0.195, -0.145, w0, 0.195, 0.145, w1);
    const g = k.build();
    g.position.set(REAR.x, REAR.y, 0);
    group.add(g);
    return { g, s };
  });
  const legParts = [unitCylinder(0.085, 0.05, 1.35, 12), unitCylinder(0.24, 0, 0.05, 16), unitCylinder(0.12, 0.05, 0.14, 12)];
  const legs = new THREE.InstancedMesh(mergeGeometries(legParts, false), M.steel, 4);
  legParts.forEach((g) => g.dispose());
  const mats = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.08, 0.9).translate(0, 0.04, 0), P.pad, 4);
  for (const m of [legs, mats]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    group.add(m);
  }

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _v = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const ONE = new THREE.Vector3(1, 1, 1);
  const UP = new THREE.Vector3(0, 1, 0);

  const setOutriggers = (k: number) => {
    const a = smooth(k / 0.6);
    const j = smooth((k - 0.55) / 0.45);
    const pad = smooth((a - 0.8) / 0.2);
    const feet: [number, number, number][] = [];
    for (const f of front) {
      const rot = Math.PI + f.s * a * FRONT_SWING;
      f.g.rotation.y = rot;
      feet.push([FRONT_PIVOT.x + FRONT_PIVOT.len * Math.cos(rot), f.s * FRONT_PIVOT.z - FRONT_PIVOT.len * Math.sin(rot), THREE.MathUtils.lerp(1.0, 0.08, j)]);
    }
    for (const r of rear) {
      r.g.position.z = r.s * a * REAR.ext;
      feet.push([REAR.x, r.s * (REAR.z + a * REAR.ext), THREE.MathUtils.lerp(0.7, 0.08, j)]);
    }
    feet.forEach(([x, z, y], i) => {
      legs.setMatrixAt(i, _m.compose(_v.set(x, y, z), _q.identity(), ONE));
      mats.setMatrixAt(i, _m.compose(_v.set(x, 0, z), _q, _s.set(pad + 1e-3, 1, pad + 1e-3)));
    });
    legs.instanceMatrix.needsUpdate = true;
    mats.instanceMatrix.needsUpdate = true;
    mats.visible = pad > 0.01;
  };

  // ── pose de la pluma
  const thT = [0, 0, 0, 0];
  const th = [0, 0, 0, 0];
  const pts: THREE.Vector2[] = [0, 1, 2, 3, 4].map(() => new THREE.Vector2());
  const local = new THREE.Vector3();
  let hasTarget = false;
  let yawT = Math.PI / 2;
  const _a = new THREE.Vector2(), _b = new THREE.Vector2(), _dir = new THREE.Vector3();

  const setRam = (i: number, a: THREE.Vector2, b: THREE.Vector2) => {
    const len = a.distanceTo(b);
    _dir.set(b.x - a.x, b.y - a.y, 0).divideScalar(Math.max(len, 1e-5));
    _q.setFromUnitVectors(UP, _dir);
    const { r, barrel } = RAM[i];
    const bl = Math.min(barrel, len - 0.1);
    barrels.setMatrixAt(i, _m.compose(_v.set(a.x, a.y, 0), _q, _s.set(r, bl, r)));
    const r0 = bl * 0.9;
    rods.setMatrixAt(i, _m.compose(_v.set(a.x + _dir.x * r0, a.y + _dir.y * r0, 0), _q, _s.set(r * 0.55, Math.max(len - r0, 0.05), r * 0.55)));
  };

  const setBoom = (k: number, target: THREE.Vector3 | null) => {
    if (target) {
      group.updateMatrixWorld(true);
      local.copy(target);
      group.worldToLocal(local);
      hasTarget = true;
    } else if (!hasTarget) {
      local.set(SLEW_X, 6, -18);
    }
    const dx = local.x - SLEW_X, dz = local.z;
    yawT = Math.atan2(-dz, dx);
    solveBoom(Math.hypot(dx, dz) - J0[0], local.y + HOSE - J0[1], thT);

    // ángulos relativos: plegado → objetivo, escalonados por tramo
    let prevT = 0, prev = 0;
    for (let i = 0; i < 4; i++) {
      const qT = i === 0 ? thT[0] : wrapPi(thT[i] - prevT);
      prevT = thT[i];
      const q = THREE.MathUtils.lerp(FOLD[i], qT, win(k, WIN_SEC[i]));
      th[i] = (i === 0 ? 0 : prev) + q;
      prev = th[i];
    }
    slew.rotation.y = YAW_FOLD + win(k, WIN_YAW) * wrapPi(yawT - YAW_FOLD);

    pts[0].set(J0[0], J0[1]);
    for (let i = 0; i < 4; i++) {
      sections[i].position.set(pts[i].x, pts[i].y, 0);
      sections[i].rotation.z = th[i];
      pts[i + 1].set(pts[i].x + LEN[i] * Math.cos(th[i]), pts[i].y + LEN[i] * Math.sin(th[i]));
    }
    // cilindros: 1º desde la torreta; los demás empujan la rótula siguiente
    _a.set(1.05, 2.97);
    _b.set(pts[0].x + 3 * Math.cos(th[0]) + 0.36 * Math.sin(th[0]), pts[0].y + 3 * Math.sin(th[0]) - 0.36 * Math.cos(th[0]));
    setRam(0, _a, _b);
    for (let j = 1; j < 4; j++) {
      const s = Math.sign(FOLD[j]);
      const a0 = th[j - 1];
      const off = SECTIONS[j - 1].h1 / 2 + 0.12;
      _a.set(pts[j].x - 2.3 * Math.cos(a0) - s * off * Math.sin(a0), pts[j].y - 2.3 * Math.sin(a0) + s * off * Math.cos(a0));
      const g = a0 + s * Math.PI / 2 + (th[j] - th[j - 1] - FOLD[j]) / 2;
      _b.set(pts[j].x + 0.55 * Math.cos(g), pts[j].y + 0.55 * Math.sin(g));
      setRam(j, _a, _b);
    }
    barrels.instanceMatrix.needsUpdate = true;
    rods.instanceMatrix.needsUpdate = true;

    const hl = Math.max(HOSE * win(k, WIN_HOSE), 0.25);
    hose.position.set(pts[4].x, pts[4].y, 0);
    hoseBody.scale.y = hl;
    hoseTip.position.set(0, -hl, 0);
  };

  setOutriggers(0);
  setBoom(0, null);

  return {
    group,
    length: 12.3,
    boomReach: 42,
    setOutriggers,
    setBoom,
    hoseTip,
    hopper,
    pickables: markPickable(group, { type: 'pump' }),
  };
}
