/**
 * Camión tolva de 3 ejes (14 m³, tolva basculante), el que retira a botadero la tierra de la
 * excavación de las fundaciones. Origen = suelo bajo el centro del camión; avanza hacia +x
 * (cabina en +x). El centro de la tolva queda a 1,85 m detrás del centro (TRUCK_BED de fundPlan).
 */
import * as THREE from 'three';
import { PartKit, createWheels, markPickable, metal, paint, truckSurfaces, type XY } from './mixer';

export interface DumpTruckRig {
  group: THREE.Group;
  /** Llenado de la tolva (0..1). */
  setLoad(k: number): void;
  setWheels(distance: number): void;
  pickables: THREE.Object3D[];
}

/** Tolva: largo (x), ancho (z), alto de la caja y cota del piso. */
const BED = { x0: -4.15, x1: 0.45, half: 1.22, y0: 1.38, h: 1.45 };

export function createDumpTruck(): DumpTruckRig {
  const M = truckSurfaces();
  const cab = paint('#d4561e'), box = paint('#c9a227'), dark = paint('#2a2d31'), steel = metal('#9aa1a8');
  const group = new THREE.Group();
  group.name = 'camion-tolva';
  const kit = new PartKit();
  // chasis
  kit.box(M.dark, -4.3, 0.72, -0.5, 4.5, 1.02, -0.36);
  kit.box(M.dark, -4.3, 0.72, 0.36, 4.5, 1.02, 0.5);
  kit.box(M.dark, -4.3, 1.02, -0.55, 0.6, 1.36, 0.55);
  // parachoques, capó y parrilla
  kit.box(M.chrome, 4.5, 0.48, -1.2, 4.72, 0.84, 1.2);
  kit.profile(cab, [[3.1, 0.98], [4.45, 0.98], [4.55, 1.2], [4.55, 1.88], [4.42, 2.02], [3.1, 2.12]], -0.7, 0.7);
  kit.box(M.dark, 4.55, 1.05, -0.58, 4.61, 1.9, 0.58);
  for (let i = 0; i < 5; i++) kit.box(M.chrome, 4.6, 1.12 + i * 0.15, -0.55, 4.64, 1.16 + i * 0.15, 0.55);
  // tapabarros delanteros
  const arch: XY[] = [];
  for (let i = 0; i <= 10; i++) {
    const a = THREE.MathUtils.degToRad(15 + i * 15);
    arch.push([3.55 + 0.66 * Math.cos(a), 0.52 + 0.66 * Math.sin(a)]);
  }
  const fender: XY[] = [[2.9, 0.69], [2.9, 1.5], [4.4, 1.44], [4.52, 1.26], [4.52, 0.69], ...arch];
  kit.profile(cab, fender, 0.7, 1.24);
  kit.profile(cab, fender, -1.24, -0.7);
  for (const s of [-1, 1]) {
    kit.box(M.lamp, 4.52, 1.08, s > 0 ? 0.8 : -1.1, 4.57, 1.28, s > 0 ? 1.1 : -0.8);
    kit.box(M.amber, 4.46, 1.31, s > 0 ? 0.95 : -1.1, 4.5, 1.38, s > 0 ? 1.1 : -0.95);
  }
  // cabina
  kit.profile(cab, [[1.6, 1.12], [3.1, 1.12], [3.1, 2.12], [2.98, 2.95], [2.86, 3.08], [1.6, 3.08]], -1.18, 1.18);
  kit.boxAt(M.glass, 0.03, 0.75, 2.12, [3.05, 2.55, 0], [0, 0, 0.147]);
  for (const s of [-1, 1]) {
    kit.box(M.glass, 2.05, 2.18, s > 0 ? 1.175 : -1.195, 2.92, 2.88, s > 0 ? 1.195 : -1.175);
    kit.bar(M.dark, [2.96, 2.72, s * 1.18], [3.04, 2.68, s * 1.42], 0.018, 6);
    kit.boxAt(M.dark, 0.06, 0.5, 0.2, [3.04, 2.45, s * 1.45]);
  }
  kit.box(M.glass, 1.585, 2.35, -0.55, 1.6, 2.8, 0.55);
  for (let i = 0; i < 4; i++) kit.boxAt(M.amber, 0.07, 0.05, 0.09, [2.8, 3.1, -0.4 + i * 0.27]);
  kit.box(M.dark, 1.9, 0.55, 1.0, 2.8, 0.6, 1.22);
  kit.cyl(M.chrome, 0.28, 0.28, 0.9, [2.3, 0.75, -0.92], 'x', 16);
  kit.cyl(M.chrome, 0.07, 0.07, 2.3, [1.45, 2.3, 0.98], 'y', 10);
  // tolva: caja de acero con visera sobre la cabina y compuerta trasera
  const { x0, x1, half, y0, h } = BED;
  kit.box(box, x0, y0 - 0.12, -half, x1, y0, half); // piso
  for (const s of [-1, 1]) {
    kit.box(box, x0, y0, s > 0 ? half - 0.06 : -half, x1, y0 + h, s > 0 ? half : -half + 0.06);
    // refuerzos verticales de los costados
    for (let i = 0; i < 6; i++) {
      const x = x0 + 0.2 + i * ((x1 - x0 - 0.4) / 5);
      kit.box(box, x - 0.05, y0, s * (half + 0.06) - 0.03, x + 0.05, y0 + h, s * (half + 0.06) + 0.03);
    }
    kit.box(dark, x0, y0 + h - 0.08, s > 0 ? half : -half - 0.08, x1, y0 + h, s > 0 ? half + 0.08 : -half);
  }
  kit.box(box, x1 - 0.06, y0, -half, x1, y0 + h + 0.25, half); // frente
  kit.box(box, x1 - 0.06, y0 + h + 0.18, -half, x1 + 1.0, y0 + h + 0.26, half); // visera
  kit.box(box, x0, y0, -half, x0 + 0.07, y0 + h - 0.1, half); // compuerta
  kit.box(dark, x0 - 0.06, y0 + 0.2, -half + 0.1, x0, y0 + h - 0.3, -half + 0.2);
  kit.box(dark, x0 - 0.06, y0 + 0.2, half - 0.2, x0, y0 + h - 0.3, half - 0.1);
  // guardafangos traseros y parachoques
  for (const s of [-1, 1]) {
    for (const ax of [-2.0, -3.4]) kit.box(steel, ax - 0.55, 1.12, s > 0 ? 0.62 : -1.26, ax + 0.55, 1.16, s > 0 ? 1.26 : -0.62);
    kit.box(M.red, -4.42, 0.46, s > 0 ? 0.75 : -1.05, -4.38, 0.58, s > 0 ? 1.05 : -0.75);
  }
  kit.box(steel, -4.4, 0.4, -1.1, -4.28, 0.6, 1.1);
  kit.box(dark, -0.2, 1.05, -0.25, 0.35, 1.38, 0.25); // cilindro de volteo
  group.add(kit.build());

  // carga: montón de tierra que sube en la tolva
  const heapGeo = new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  heapGeo.scale((x1 - x0) / 2 - 0.15, 1, half - 0.12);
  const heap = new THREE.Mesh(heapGeo, new THREE.MeshStandardMaterial({ color: '#7d5633', roughness: 1, flatShading: true }));
  heap.position.set((x0 + x1) / 2, y0, 0);
  heap.castShadow = true;
  heap.visible = false;
  group.add(heap);

  const wheels = createWheels([
    { x: 3.55, z: 1.07, dual: false }, { x: 3.55, z: -1.07, dual: false },
    { x: -2.0, z: 0.92, dual: true }, { x: -2.0, z: -0.92, dual: true },
    { x: -3.4, z: 0.92, dual: true }, { x: -3.4, z: -0.92, dual: true },
  ]);
  group.add(wheels.group);

  return {
    group,
    setLoad(k) {
      heap.visible = k > 0.02;
      heap.scale.set(Math.min(1, 0.4 + k * 0.8), 0.2 + k * 1.45, Math.min(1, 0.5 + k * 0.6));
    },
    setWheels: (d) => wheels.roll(d),
    pickables: markPickable(group, { type: 'tolva' }),
  };
}
