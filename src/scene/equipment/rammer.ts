/**
 * Vibropisón ("canguro") para el relleno compactado de las fundaciones: zapata de acero, fuelle
 * negro, cuerpo con el motor a bencina y manilla en arco hacia el operador. Origen en el suelo bajo
 * la zapata; el operador queda hacia −x local (la manilla) y avanza hacia +x.
 */
import * as THREE from 'three';
import { PartKit, markPickable, metal, paint } from './mixer';

export interface RammerRig {
  group: THREE.Group;
  /** Salto de la zapata (m) y leve cabeceo del cuerpo, según el reloj. */
  pound(clock: number): void;
  pickables: THREE.Object3D[];
}

export function createRammer(): RammerRig {
  const M = { plate: metal('#5c6166'), body: paint('#e0a419'), dark: paint('#1f2124'), engine: paint('#c9372c'), bar: metal('#9aa1a8') };
  const group = new THREE.Group();
  group.name = 'vibropison';
  const body = new THREE.Group();
  group.add(body);
  const kit = new PartKit();
  // zapata (0,34 × 0,28) y fuelle
  kit.box(M.plate, -0.17, 0, -0.14, 0.17, 0.035, 0.14);
  kit.cyl(M.dark, 0.075, 0.09, 0.3, [0, 0.19, 0], 'y', 12);
  // pierna y cuerpo inclinados hacia el operador
  kit.boxAt(M.body, 0.2, 0.26, 0.2, [-0.03, 0.47, 0], [0, 0, 0.18]);
  kit.boxAt(M.engine, 0.24, 0.16, 0.22, [-0.1, 0.66, 0], [0, 0, 0.18]);
  kit.cyl(M.dark, 0.05, 0.05, 0.08, [-0.02, 0.77, 0.06], 'y', 10);
  // manilla en arco
  kit.bar(M.bar, [-0.16, 0.6, -0.17], [-0.42, 0.88, -0.2], 0.014);
  kit.bar(M.bar, [-0.16, 0.6, 0.17], [-0.42, 0.88, 0.2], 0.014);
  kit.bar(M.bar, [-0.42, 0.88, -0.2], [-0.42, 0.88, 0.2], 0.016);
  body.add(kit.build());
  const pickables = markPickable(group, { type: 'fund', id: 'vibropison' });
  return {
    group,
    pickables,
    pound(clock) {
      // ~11 golpes por segundo de reloj: la zapata sube unos 5 cm y cae
      const p = Math.abs(Math.sin(clock * 35));
      body.position.y = p * 0.05;
      body.rotation.z = (p - 0.5) * 0.03;
    },
  };
}
