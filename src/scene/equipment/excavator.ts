/**
 * Excavadora hidráulica sobre orugas de ~20 t (amarilla, balde de ≈ 0,9 m³), la que abre las
 * zanjas de las fundaciones y carga los camiones tolva.
 *
 * Origen = suelo bajo el eje de giro; el tren de orugas avanza hacia +x local. La tornamesa (cabina,
 * motor y contrapeso) gira sobre él y el brazo (pluma, brazo y balde) se resuelve con cinemática
 * inversa de dos tramos: se le da la punta del balde (distancia horizontal al eje de giro y cota) y
 * el giro del balde (curl: 0 = recogido con tierra, 1 = abierto descargando).
 */
import * as THREE from 'three';
import { PartKit, markPickable, metal, paint, truckSurfaces } from './mixer';

export interface ExcavatorPose {
  /** Rumbo del tren de orugas y de la tornamesa (rad, atan2(dz, dx) en el mundo). */
  heading: number;
  slew: number;
  /** Punta del balde: distancia horizontal al eje de giro (m) y cota sobre el suelo de la máquina (m). */
  r: number;
  h: number;
  curl: number;
  load: boolean;
  /** Distancia recorrida (para las orugas). */
  dist: number;
}

export interface ExcavatorRig {
  group: THREE.Group;
  setPose(p: ExcavatorPose): void;
  pickables: THREE.Object3D[];
}

/** Pivote de la pluma en la tornamesa (x adelante, y alto) y largos de pluma, brazo y balde. */
const PIV = new THREE.Vector2(0.62, 1.95);
const L1 = 5.7, L2 = 2.9, LB = 1.45;

export function createExcavator(): ExcavatorRig {
  const M = truckSurfaces();
  const yellow = paint('#f0b419'), dark = paint('#2a2c30'), steel = metal('#8f969d'), black = paint('#18191b');
  const group = new THREE.Group();
  group.name = 'excavadora';

  // tren de orugas
  const under = new PartKit();
  for (const s of [-1, 1]) {
    const z = s * 1.0;
    under.box(dark, -2.22, 0.12, z - 0.3, 2.22, 0.86, z + 0.3);
    under.cyl(dark, 0.4, 0.4, 0.6, [2.0, 0.42, z], 'z', 16);
    under.cyl(dark, 0.4, 0.4, 0.6, [-2.0, 0.42, z], 'z', 16);
    // zapatas (garras) a lo largo de la oruga
    for (let i = 0; i < 24; i++) under.box(black, -2.15 + i * 0.187, 0.0, z - 0.31, -2.07 + i * 0.187, 0.12, z + 0.31);
    for (let i = 0; i < 4; i++) under.cyl(steel, 0.14, 0.14, 0.62, [-1.3 + i * 0.87, 0.3, z], 'z', 10);
  }
  under.box(dark, -1.1, 0.5, -0.7, 1.1, 0.95, 0.7);
  under.cyl(dark, 0.9, 0.9, 0.18, [0, 1.0, 0], 'y', 20);
  const underMesh = under.build();
  group.add(underMesh);

  // tornamesa: cabina a la izquierda adelante, motor y contrapeso atrás
  const upper = new THREE.Group();
  upper.position.y = 0;
  const up = new PartKit();
  up.box(yellow, -2.0, 1.1, -1.35, 1.25, 2.15, 1.35);
  up.profile(yellow, [[-2.85, 1.15], [-2.0, 1.15], [-2.0, 2.2], [-2.75, 2.2], [-2.9, 1.9]], -1.35, 1.35); // contrapeso
  up.box(dark, -2.92, 1.15, -1.38, -2.86, 1.85, 1.38);
  up.box(yellow, -1.9, 2.15, -1.3, -0.2, 2.45, 0.2); // capó del motor
  for (let i = 0; i < 5; i++) up.box(dark, -1.75 + i * 0.3, 2.45, -1.2, -1.6 + i * 0.3, 2.47, 0.1);
  up.cyl(dark, 0.07, 0.07, 0.6, [-0.9, 2.75, -0.9], 'y', 8); // escape
  // cabina
  up.box(dark, -0.15, 2.15, 0.32, 1.25, 2.22, 1.32);
  up.profile(yellow, [[-0.15, 2.2], [1.2, 2.2], [1.25, 3.0], [1.05, 3.25], [-0.15, 3.25]], 0.34, 1.32);
  up.box(M.glass, 1.18, 2.4, 0.42, 1.27, 3.1, 1.24);
  up.box(M.glass, 0.05, 2.45, 1.31, 1.1, 3.1, 1.335);
  up.box(M.glass, 0.05, 2.45, 0.32, 1.1, 3.1, 0.345);
  up.box(dark, -0.15, 3.25, 0.3, 1.1, 3.3, 1.34);
  // baliza y barandas
  up.cyl(M.amber, 0.09, 0.09, 0.14, [-0.6, 2.55, 1.0], 'y', 10);
  up.box(yellow, 0.2, 1.75, -0.35, 1.3, 2.0, 0.35); // soporte de la pluma
  upper.add(up.build());
  group.add(upper);

  // pluma (a lo largo de +x local, desde el pivote), brazo y balde
  const boom = new THREE.Group();
  boom.position.set(PIV.x, PIV.y, 0);
  const bk = new PartKit();
  // pluma "banana": dos tramos con quiebre
  const knee = new THREE.Vector2(2.9, 0.75);
  const boomSeg = (a: THREE.Vector2, b: THREE.Vector2, w0: number, w1: number) => {
    const d = b.clone().sub(a), len = d.length(), ang = Math.atan2(d.y, d.x);
    const shape = new THREE.Shape([new THREE.Vector2(0, -w0 / 2), new THREE.Vector2(len, -w1 / 2), new THREE.Vector2(len, w1 / 2), new THREE.Vector2(0, w0 / 2)]);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false });
    geo.translate(0, 0, -0.25);
    bk.add(yellow, geo, [a.x, a.y, 0], [0, 0, ang]);
  };
  const tipB = new THREE.Vector2(L1, 0);
  boomSeg(new THREE.Vector2(0, 0), knee, 0.62, 0.72);
  boomSeg(knee, tipB, 0.72, 0.42);
  bk.cyl(steel, 0.12, 0.12, 0.62, [0, 0, 0], 'z', 12);
  boom.add(bk.build());
  upper.add(boom);

  const stick = new THREE.Group();
  stick.position.set(L1, 0, 0);
  const sk = new PartKit();
  sk.box(yellow, -0.5, -0.2, -0.2, L2, 0.2, 0.2);
  sk.box(yellow, -0.6, 0.1, -0.18, 0.1, 0.5, 0.18);
  sk.cyl(steel, 0.1, 0.1, 0.5, [0, 0, 0], 'z', 12);
  sk.cyl(steel, 0.08, 0.08, 0.5, [L2, 0, 0], 'z', 12);
  stick.add(sk.build());
  boom.add(stick);

  const bucket = new THREE.Group();
  bucket.position.set(L2, 0, 0);
  const bu = new PartKit();
  // balde: concha curva (de la articulación a los dientes, hacia +x local)
  const shell = new THREE.Shape([
    new THREE.Vector2(0, 0.05), new THREE.Vector2(0.55, 0.38), new THREE.Vector2(1.1, 0.32), new THREE.Vector2(LB, 0.0),
    new THREE.Vector2(1.3, -0.1), new THREE.Vector2(0.6, -0.12), new THREE.Vector2(0.1, -0.2),
  ]);
  const sg = new THREE.ExtrudeGeometry(shell, { depth: 1.0, bevelEnabled: false });
  sg.translate(0, 0, -0.5);
  bu.add(dark, sg);
  for (let i = 0; i < 5; i++) bu.box(steel, LB - 0.02, -0.04, -0.42 + i * 0.21, LB + 0.13, 0.04, -0.36 + i * 0.21);
  bucket.add(bu.build());
  const dirtKit = new PartKit();
  dirtKit.add(paint('#7a5030'), new THREE.SphereGeometry(0.45, 10, 6), [0.75, -0.05, 0], [0, 0, 0], [1.3, 0.55, 1.0]);
  const dirt = dirtKit.build();
  bucket.add(dirt);
  stick.add(bucket);

  // cilindros hidráulicos (se reubican en cada pose)
  const cylMat = new THREE.MeshStandardMaterial({ color: '#c9cdd1', roughness: 0.3, metalness: 0.7 });
  const unit = new THREE.CylinderGeometry(0.08, 0.08, 1, 10).translate(0, 0.5, 0);
  const boomCyl = new THREE.Mesh(unit, cylMat), stickCyl = new THREE.Mesh(unit, cylMat);
  for (const c of [boomCyl, stickCyl]) {
    c.castShadow = true;
    upper.add(c);
  }
  const UP = new THREE.Vector3(0, 1, 0);
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpD = new THREE.Vector3();
  const place = (m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) => {
    tmpD.subVectors(b, a);
    const len = tmpD.length();
    m.position.copy(a);
    m.quaternion.setFromUnitVectors(UP, tmpD.divideScalar(Math.max(len, 1e-4)));
    m.scale.set(1, len, 1);
  };

  const setPose = (p: ExcavatorPose) => {
    group.rotation.y = -p.heading;
    upper.rotation.y = -(p.slew - p.heading);
    // balde: ángulo absoluto en el plano del brazo (recogido = dientes hacia la máquina)
    const aB = THREE.MathUtils.lerp(-2.35, -0.55, p.curl);
    const tip = new THREE.Vector2(p.r, p.h);
    const wrist = tip.clone().sub(new THREE.Vector2(Math.cos(aB) * LB, Math.sin(aB) * LB));
    const d = wrist.clone().sub(PIV);
    const dist = THREE.MathUtils.clamp(d.length(), Math.abs(L1 - L2) + 0.2, L1 + L2 - 0.05);
    const th = Math.atan2(d.y, d.x);
    const beta = Math.acos(THREE.MathUtils.clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1));
    const aBoom = th + beta;
    const elbow = new THREE.Vector2(PIV.x + Math.cos(aBoom) * L1, PIV.y + Math.sin(aBoom) * L1);
    const w2 = PIV.clone().add(d.clone().normalize().multiplyScalar(dist));
    const aStick = Math.atan2(w2.y - elbow.y, w2.x - elbow.x);
    boom.rotation.z = aBoom;
    stick.rotation.z = aStick - aBoom;
    bucket.rotation.z = aB - aStick;
    dirt.visible = p.load;
    // cilindro de la pluma: del soporte bajo la cabina a media pluma; del brazo: sobre la pluma al talón del brazo
    const loc = (x: number, y: number, ang: number, ox: number, oy: number, out: THREE.Vector3) =>
      out.set(ox + x * Math.cos(ang) - y * Math.sin(ang), oy + x * Math.sin(ang) + y * Math.cos(ang), 0);
    tmpA.set(1.15, 1.45, 0);
    loc(2.4, -0.45, aBoom, PIV.x, PIV.y, tmpB);
    place(boomCyl, tmpA, tmpB);
    loc(2.3, 0.5, aBoom, PIV.x, PIV.y, tmpA);
    const ex = elbow.x + (-0.55 * Math.cos(aStick) - 0.35 * Math.sin(aStick)), ey = elbow.y + (-0.55 * Math.sin(aStick) + 0.35 * Math.cos(aStick));
    tmpB.set(ex, ey, 0);
    place(stickCyl, tmpA, tmpB);
  };
  setPose({ heading: 0, slew: 0, r: 5, h: 0.3, curl: 0.2, load: false, dist: 0 });

  return { group, setPose, pickables: markPickable(group, { type: 'excavadora' }) };
}
