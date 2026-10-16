/**
 * Tubería de la bomba estacionaria: sale de la caseta, corre por el suelo hasta el núcleo,
 * sube por el shaft del ascensor piso a piso y, durante cada hormigonado, sigue por la losa
 * con tramos rígidos hasta una manguera que la cuadrilla mueve sobre el frente de vaciado.
 */
import * as THREE from 'three';
import type { BuildingData } from '../data/building';
import type { Schedule } from '../core/schedule';
import { SITE } from '../config';
import { GeoBuilder } from './geom';
import { revealMaterial, revealMesh } from './reveal';

export interface Pipeline {
  group: THREE.Group;
  /** Punto donde la tubería llega a la base del shaft (para el radier). */
  shaftBase: THREE.Vector3;
  /**
   * Dibuja la tubería sobre la losa y la manguera hasta `pourPoint` mientras se hormigona.
   * Devuelve la punta de la manguera (de donde cae el hormigón) o null si no hay vaciado.
   */
  update(slab: number, active: boolean, pourPoint: THREE.Vector3 | null): THREE.Vector3 | null;
  pickables: THREE.Object3D[];
}

const R = 0.07; // radio exterior de la tubería Ø125
const STEEL = '#8d9399';

export function createPipeline(data: BuildingData, sched: Schedule, outlet: THREE.Vector3): Pipeline {
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

  // tendido en el suelo: caseta → frente al edificio → núcleo → base del shaft
  const route: [number, number][] = [
    [outlet.x, outlet.z],
    [outlet.x, SITE.pipeline.zFront],
    [SITE.pipeline.xEntry, SITE.pipeline.zFront],
    [SITE.pipeline.xEntry, SITE.pipeline.zHall],
    [vx, SITE.pipeline.zHall],
    [vx, vz],
  ];
  const tLay = firstUse - 6;
  g.timing(tLay, tLay + 0.6, removeAt, removeAt + 0.3);
  g.barN(outlet.x, outlet.y, outlet.z, outlet.x, yG, outlet.z - 0.6, R * 2);
  let along = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const [ax, az] = route[i], [bx, bz] = route[i + 1];
    g.barN(ax, yG, az, bx, yG, bz, R * 2);
    const len = Math.hypot(bx - ax, bz - az);
    // uniones cada 3 m y tacos de madera bajo la tubería
    for (let s = 3 - (along % 3); s < len; s += 3) {
      const k = s / len;
      const px = ax + (bx - ax) * k, pz = az + (bz - az) * k;
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      g.barN(px - ux * 0.07, yG, pz - uz * 0.07, px + ux * 0.07, yG, pz + uz * 0.07, R * 2.6);
    }
    along += len;
  }

  // tramos verticales por el shaft: se agregan antes de hormigonar cada losa
  for (let S = 1; S < levels.length; S++) {
    const pour = sched.slab[S]?.pour;
    if (!pour) continue;
    const yA = S === 1 ? yG : levels[S - 1].slab.y1 + 0.35;
    const yB = levels[S].slab.y1 + 0.35;
    const t0 = pour[0] - 3.5;
    g.timing(t0, t0 + 0.6, removeAt, removeAt + 0.3);
    g.barN(vx, yA, vz, vx, yB, vz, R * 2);
    // abrazadera de anclaje al muro del shaft en cada piso
    g.aabb(vx - 0.12, yB - 0.6, vz - 0.12, vx + 0.12, yB - 0.52, vz + 0.12);
    g.barN(vx - 0.03, (yA + yB) / 2, vz - 0.03, vx + 0.03, (yA + yB) / 2, vz + 0.03, R * 2.6);
  }
  const fixed = revealMesh(g.build(), mat);
  fixed.userData.pick = { type: 'pipe' };
  group.add(fixed);

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

  return {
    group,
    shaftBase,
    pickables: [fixed, segA, segB, hose],
    update(slab, active, pourPoint) {
      if (!active || !pourPoint) {
        segA.visible = segB.visible = elbow.visible = hose.visible = false;
        return null;
      }
      const y = slab === 0 ? yG : levels[slab].slab.y1 + 0.12;
      // en la losa la tubería sale del shaft; para el radier, desde el tendido del suelo
      const A = slab === 0 ? new THREE.Vector3(vx, y, SITE.pipeline.zHall) : new THREE.Vector3(vx, y, vz);
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

