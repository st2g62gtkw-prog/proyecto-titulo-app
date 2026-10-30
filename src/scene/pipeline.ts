/**
 * Tubería de la bomba estacionaria: sale de la caseta (costado posterior), corre por el suelo
 * con tramos ortogonales y codos, entra al 1er piso por la puerta posterior del hall, cruza el
 * pasillo y el vestíbulo del ascensor y entra al shaft por el vano de su puerta (sin atravesar
 * muros de H.A.); sube por el shaft piso a piso y, durante cada hormigonado, sigue por la losa
 * con tramos rígidos hasta una manguera que la cuadrilla mueve sobre el frente de vaciado.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BuildingData } from '../data/building';
import { haWalls, type Schedule } from '../core/schedule';
import { SITE } from '../config';
import { bordePosterior, groundAt, piePosterior } from '../core/terrain';
import { GeoBuilder } from './geom';
import { revealMaterial, revealMesh } from './reveal';

export interface Pipeline {
  group: THREE.Group;
  /** Punto donde la tubería llega a la base del shaft (para el radier). */
  shaftBase: THREE.Vector3;
  /**
   * Dibuja la tubería sobre la losa y la manguera hasta `pourPoint` mientras se hormigona
   * (slab < 0: hormigonado de zapatas, con la tubería por el suelo).
   * Devuelve la punta de la manguera (de donde cae el hormigón) o null si no hay vaciado.
   */
  update(slab: number, active: boolean, pourPoint: THREE.Vector3 | null): THREE.Vector3 | null;
  pickables: THREE.Object3D[];
}

const R = 0.07; // radio exterior de la tubería Ø125
const STEEL = '#8d9399';
const WOOD = '#a77b4f';

/**
 * `outlet` es la salida de la bomba (mundo) y `dir` la dirección horizontal en que sale la tubería.
 * `clipping` son los planos de corte del edificio (el vano de la puerta se corta con el muro).
 */
export function createPipeline(data: BuildingData, sched: Schedule, outlet: THREE.Vector3, dir = new THREE.Vector3(0, 0, -1), clipping: THREE.Plane[] = []): Pipeline {
  const group = new THREE.Group();
  group.name = 'tuberia-bomba';
  const levels = data.levels;
  const sh = data.shaft ?? { x0: -2.3, x1: -0.3, z0: 1.4, z1: 5 };
  const vx = sh.x1 - 0.42, vz = sh.z1 - 0.42; // la tubería vertical va en una esquina del shaft
  const yG = SITE.groundY + 0.1;
  const firstUse = Math.min(...sched.slab.map((s) => s.pour[0]));
  const removeAt = sched.finish[0][0];

  const mat = revealMaterial({ color: STEEL, roughness: 0.45, metalness: 0.6 }, { mode: 'drop', dropHeight: 0.5 });
  const g = new GeoBuilder();

  // tendido en el suelo: caseta → puerta posterior del hall → pasillo → vestíbulo → base del shaft.
  // Afuera va sobre el terreno: de la caseta (abajo, a la cota del camino) sube por el corte posterior
  // hasta la plataforma y sigue por detrás de las zanjas hasta frente a la puerta; justo antes de la
  // puerta sube en rampa a la cota del radier terminado (adentro queda sobre tacos de madera mientras
  // el 1er piso sigue en relleno y, una vez hormigonado el radier, apoyada sobre él en vez de quedar
  // ahogada en el hormigón).
  const P = SITE.pipeline;
  const yIn = levels[0].slab.y1 + R + 0.02;
  const d = new THREE.Vector2(dir.x, dir.z).normalize();
  const drop = { x: outlet.x + d.x * 0.5, z: outlet.z + d.y * 0.5 };
  /** Tramo por el terreno, de la bomba hasta frente a la puerta posterior (detrás de las zanjas, z = −8,7). */
  const zRun = -8.7;
  const onSoil = (x: number, z: number): [number, number, number] => [x, groundAt(x, z) + 0.1, z];
  const soil: [number, number, number][] = [
    onSoil(drop.x, drop.z),
    onSoil(drop.x, piePosterior(drop.x) - 0.1),
    [drop.x, yG, bordePosterior(drop.x) + 0.1],
    [drop.x, yG, zRun],
    [P.xDoor, yG, zRun],
  ];
  const route = ([
    ...soil,
    [P.xDoor, yG, P.zDoor - 0.9],
    [P.xDoor, yIn, P.zDoor - 0.3],
    [P.xDoor, yIn, P.zHall],
    [P.xLobby, yIn, P.zHall],
    [P.xLobby, yIn, P.zShaftDoor],
    [vx, yIn, P.zShaftDoor],
    [vx, yIn, vz],
  ] as [number, number, number][]).filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[2] - a[i - 1][2]) > 0.01);
  const tLay = firstUse - 6;
  g.timing(tLay, tLay + 0.6, removeAt, removeAt + 0.3);
  // codo de salida: de la brida de la bomba baja al suelo
  g.barN(outlet.x, outlet.y, outlet.z, ...soil[0], R * 2);
  const joint = (x: number, y: number, z: number) => g.aabb(x - R * 1.35, y - R * 1.35, z - R * 1.35, x + R * 1.35, y + R * 1.35, z + R * 1.35);
  joint(...soil[0]);
  // tacos de madera bajo el tramo interior (del relleno a la tubería)
  const wood = new GeoBuilder();
  wood.timing(tLay, tLay + 0.6, removeAt, removeAt + 0.3);
  const yFill = SITE.groundY;
  let along = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const [ax, ay, az] = route[i], [bx, by, bz] = route[i + 1];
    g.barN(ax, ay, az, bx, by, bz, R * 2);
    if (i > 0) joint(ax, ay, az); // codo en cada cambio de dirección
    const len = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    // uniones (abrazaderas) cada 3 m
    for (let s = 3 - (along % 3); s < len; s += 3) {
      const k = s / len;
      const px = ax + (bx - ax) * k, py = ay + (by - ay) * k, pz = az + (bz - az) * k;
      g.barN(px - ux * 0.07, py, pz - uz * 0.07, px + ux * 0.07, py, pz + uz * 0.07, R * 2.6);
    }
    if (ay === yIn && by === yIn) {
      for (let s = 0.6; s < len - 0.3; s += 2.0) {
        const px = ax + ux * s, pz = az + uz * s;
        const hx = Math.abs(ux) > 0.5 ? 0.06 : 0.16, hz = Math.abs(ux) > 0.5 ? 0.16 : 0.06;
        wood.aabb(px - hx, yFill, pz - hz, px + hx, yIn - R, pz + hz);
      }
    }
    along += len;
  }
  /** Derivación en el pasillo desde donde se arma la tubería del radier. */
  const radierTap = new THREE.Vector3(P.xLobby, yIn, P.zHall);

  // tramos verticales por el shaft: se agregan antes de hormigonar cada losa
  for (let S = 1; S < levels.length; S++) {
    const pour = sched.slab[S]?.pour;
    if (!pour) continue;
    const yA = S === 1 ? yIn : levels[S - 1].slab.y1 + 0.35;
    const yB = levels[S].slab.y1 + 0.35;
    const t0 = pour[0] - 3.5;
    g.timing(t0, t0 + 0.6, removeAt, removeAt + 0.3);
    g.barN(vx, yA, vz, vx, yB, vz, R * 2);
    // abrazadera de anclaje al muro del shaft en cada piso
    g.aabb(vx - 0.12, yB - 0.6, vz - 0.12, vx + 0.12, yB - 0.52, vz + 0.12);
    g.barN(vx - 0.03, (yA + yB) / 2, vz - 0.03, vx + 0.03, (yA + yB) / 2, vz + 0.03, R * 2.6);
  }
  // fundaciones: mientras se hormigona cada sector de zapatas, la tubería va por el suelo desde la
  // caseta, sube el corte y llega al borde de la excavación frente a la puerta posterior (fundTap); de
  // ahí, sobre caballetes que cruzan las zanjas (ver update), hasta la manguera
  const fundTap = new THREE.Vector3(...soil[soil.length - 1]);
  for (const fp of sched.fund.pours) {
    g.timing(fp.pour[0] - 3.2, fp.pour[0] - 2.6, fp.pour[1] + 0.6, fp.pour[1] + 1.0);
    g.barN(outlet.x, outlet.y, outlet.z, ...soil[0], R * 2);
    soil.forEach((p, i) => {
      joint(...p);
      if (i > 0) g.barN(...soil[i - 1], ...p, R * 2);
    });
  }
  const fixed = revealMesh(g.build(), mat);
  fixed.userData.pick = { type: 'pipe' };
  group.add(fixed);
  const blocks = revealMesh(wood.build(), revealMaterial({ color: WOOD, roughness: 0.85 }, { mode: 'drop', dropHeight: 0.5 }));
  blocks.userData.pick = { type: 'pipe' };
  group.add(blocks);

  // vano de la puerta posterior del hall (el muro se recorta en structure.ts): se marca con un
  // pre-marco metálico (jambas y cabezal) para que se lea como puerta por la que entra la tubería.
  // Aparece al desmoldar los muros del 1P y se quita cuando se instala la puerta.
  {
    const faces = haWalls(levels[0]).flatMap((w) => {
      const zs: number[] = [];
      w.poly.forEach((a, i) => {
        const b = w.poly[(i + 1) % w.poly.length];
        if ((a[0] - P.xDoor) * (b[0] - P.xDoor) < 0) zs.push(a[1] + ((P.xDoor - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
      });
      return zs.filter((z) => Math.abs(z - P.zDoor) < 1);
    });
    if (faces.length >= 2) {
      const D = P.door, z0 = Math.min(...faces) - 0.012, z1 = Math.max(...faces) + 0.012;
      const strip = sched.activities.find((a) => a.kind === 'muroDesmolde' && a.level === 0);
      const v = new GeoBuilder();
      v.timing(strip?.t1 ?? tLay, strip?.t1 ?? tLay, removeAt, removeAt + 0.05);
      const yb = levels[0].slab.y1 - 0.15, fw = 0.07;
      v.aabb(D.x0 - fw, yb, z0, D.x0, D.h + fw, z1);
      v.aabb(D.x1, yb, z0, D.x1 + fw, D.h + fw, z1);
      v.aabb(D.x0, D.h, z0, D.x1, D.h + fw, z1);
      const vMat = revealMaterial({ color: '#5d6166', roughness: 0.6, metalness: 0.4 }, { mode: 'pop', outLift: new THREE.Vector3() });
      vMat.clippingPlanes = clipping;
      group.add(revealMesh(v.build(), vMat, false));
    }
  }

  // ---- tramo sobre la losa y manguera (se recalculan cada cuadro) ----
  const steel = new THREE.MeshStandardMaterial({ color: STEEL, roughness: 0.45, metalness: 0.6 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#1d1f22', roughness: 0.75 });
  const unit = new THREE.CylinderGeometry(R, R, 1, 10, 1, false).translate(0, 0.5, 0);
  const segA = new THREE.Mesh(unit, steel);
  const segB = new THREE.Mesh(unit, steel);
  const elbow = new THREE.Mesh(new THREE.SphereGeometry(R * 1.25, 10, 8), steel);
  const hose = new THREE.Mesh(new THREE.BufferGeometry(), rubber);
  for (const m of [segA, segB, elbow, hose]) {
    m.castShadow = true;
    m.visible = false;
    m.userData.pick = { type: 'pipe' };
    group.add(m);
  }
  const up = new THREE.Vector3(0, 1, 0);
  const place = (m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    m.visible = len > 0.05;
    if (!m.visible) return;
    m.position.copy(a);
    m.quaternion.setFromUnitVectors(up, d.divideScalar(len));
    m.scale.set(1, len, 1);
  };
  const tip = new THREE.Vector3();
  const shaftBase = new THREE.Vector3(vx, yG, vz);

  // zapatas: desde fundTap la tubería sube a caballetes de madera (FUND_H sobre el terreno) para cruzar
  // las zanjas sin apoyarse en el vacío; los caballetes van cada ≤ 2,4 m y nunca dentro del borde
  // superior de una zanja (fondo + talud) ni a menos de 0,3 m de él
  const FUND_H = 0.55;
  const yF = SITE.groundY + FUND_H;
  const segR = new THREE.Mesh(unit, steel);
  const elbowR = new THREE.Mesh(elbow.geometry, steel);
  for (const m of [segR, elbowR]) {
    m.castShadow = true;
    m.visible = false;
    m.userData.pick = { type: 'pipe' };
    group.add(m);
  }
  const trestleGeo = (() => {
    // travesaño perpendicular a la tubería (eje x local) sobre dos pares de patas abiertas
    const top = FUND_H - R;
    const parts = [new THREE.BoxGeometry(0.7, 0.07, 0.09).translate(0, top - 0.035, 0)];
    for (const sx of [-0.28, 0.28]) for (const sz of [-0.1, 0.1]) {
      const leg = new THREE.BoxGeometry(0.05, top, 0.05);
      leg.rotateX(sz * 1.2).translate(sx, top / 2, sz * 0.9);
      parts.push(leg);
    }
    return mergeGeometries(parts);
  })();
  const MAX_TRESTLES = 48;
  const trestles = new THREE.InstancedMesh(trestleGeo, new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.85 }), MAX_TRESTLES);
  trestles.count = 0;
  trestles.castShadow = true;
  trestles.userData.pick = { type: 'pipe' };
  group.add(trestles);
  const tops = sched.fund.cells.map((c) => [c.x0 - c.talud - 0.3, c.x1 + c.talud + 0.3, c.z0 - c.talud - 0.3, c.z1 + c.talud + 0.3]);
  const onFirm = (x: number, z: number) => tops.every(([x0, x1, z0, z1]) => x < x0 || x > x1 || z < z0 || z > z1);
  const tm = new THREE.Matrix4(), tq = new THREE.Quaternion(), tpos = new THREE.Vector3(), tsc = new THREE.Vector3(1, 1, 1);
  /** Caballetes a lo largo de a→b (horizontal), en terreno firme. */
  const placeTrestles = (a: THREE.Vector3, b: THREE.Vector3, n0: number) => {
    let n = n0;
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L < 0.3) return n;
    tq.setFromAxisAngle(up, Math.atan2(b.x - a.x, b.z - a.z));
    const at = (q: number) => [a.x + ((b.x - a.x) * q) / L, a.z + ((b.z - a.z) * q) / L] as const;
    const firm = (q: number) => onFirm(...at(q));
    let last = -2.0;
    while (n < MAX_TRESTLES && last < L - 0.6) {
      // el más lejano en terreno firme dentro de 2,4 m; si no hay, el primero más allá (vano mayor)
      const target = Math.min(last + 2.4, L - 0.2);
      let pick = -1;
      for (let q = target; q > last + 0.6 && pick < 0; q -= 0.2) if (q >= 0.2 && firm(q)) pick = q;
      for (let q = target + 0.2; q <= L - 0.2 && pick < 0; q += 0.2) if (firm(q)) pick = q;
      if (pick < 0) break;
      const [x, z] = at(pick);
      tm.compose(tpos.set(x, SITE.groundY, z), tq, tsc);
      trestles.setMatrixAt(n++, tm);
      last = pick;
    }
    return n;
  };

  return {
    group,
    shaftBase,
    pickables: [fixed, blocks, segA, segB, hose, segR, trestles],
    update(slab, active, pourPoint) {
      if (!active || !pourPoint) {
        segA.visible = segB.visible = elbow.visible = hose.visible = segR.visible = elbowR.visible = false;
        trestles.count = 0;
        return null;
      }
      const y = slab < 0 ? yF : slab === 0 ? yIn : levels[slab].slab.y1 + 0.12;
      // en la losa la tubería sale del shaft; para el radier, desde el tendido del suelo; en las
      // zapatas (slab < 0), desde el borde de la excavación frente a la puerta posterior
      const A = slab < 0 ? fundTap.clone().setY(y) : slab === 0 ? radierTap.clone().setY(y) : new THREE.Vector3(vx, y, vz);
      // zapatas: tramo vertical desde el tendido del suelo hasta los caballetes
      if (slab < 0) place(segR, fundTap, A);
      else segR.visible = false;
      elbowR.visible = segR.visible;
      elbowR.position.copy(A);
      const P = pourPoint;
      const dx = P.x - A.x, dz = P.z - A.z;
      const dist = Math.hypot(dx, dz);
      // la tubería rígida llega a ~3 m del frente; el resto lo cubre la manguera
      const reach = Math.max(0, dist - 3.2);
      const E = new THREE.Vector3(A.x + (dx / Math.max(dist, 1e-6)) * reach, y, A.z + (dz / Math.max(dist, 1e-6)) * reach);
      const C = new THREE.Vector3(E.x, y, A.z); // tramos ortogonales, como se arma en obra
      place(segA, A, C);
      place(segB, C, E);
      elbow.visible = segA.visible && segB.visible;
      elbow.position.copy(C);
      if (slab < 0) {
        const n = placeTrestles(A, C, 0);
        trestles.count = placeTrestles(C, E, n);
        trestles.instanceMatrix.needsUpdate = true;
        trestles.computeBoundingSphere();
      } else trestles.count = 0;
      // manguera de goma con una curva suave hasta la punta, que la cuadrilla sostiene
      tip.set(P.x, P.y + 0.9, P.z);
      const mid = new THREE.Vector3().lerpVectors(E, tip, 0.5);
      mid.y = y + 0.05;
      mid.x += (P.z - E.z) * 0.18;
      mid.z -= (P.x - E.x) * 0.18;
      const curve = new THREE.CatmullRomCurve3([E.clone(), mid, tip.clone()]);
      hose.geometry.dispose();
      hose.geometry = new THREE.TubeGeometry(curve, 16, R * 0.95, 8, false);
      hose.visible = true;
      return tip;
    },
  };
}

