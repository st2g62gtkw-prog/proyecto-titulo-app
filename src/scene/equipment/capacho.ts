/**
 * Capacho de hormigón 1 m³ colgado de la grúa: cono de acero gris con marco y asa amarillos,
 * compuerta inferior de corredera con palanca y manga de goma corta.
 * Origen = ojo de izaje (arriba); el cuerpo cuelga hacia -y (alto total 2,0 m).
 */
import * as THREE from 'three';
import { PartKit, markPickable, truckMaterials, type XY } from './mixer';

export interface CapachoRig {
  group: THREE.Group;
  height: number;
  setFill(k: number): void;
  setOpen(k: number): void;
  outlet: THREE.Object3D;
  pickables: THREE.Object3D[];
}

const RIM_Y = -0.8;
const RIM_R = 0.8;
const CONE_TOP = -0.9;
const CONE_BOT = -1.72;
const BOT_R = 0.22;
const HEIGHT = 2.0;

let mats: Record<'body' | 'frame' | 'rubber', THREE.MeshStandardMaterial> | null = null;
function materials() {
  if (mats) return mats;
  mats = {
    body: new THREE.MeshStandardMaterial({ color: '#8b9096', roughness: 0.62, metalness: 0.3 }),
    frame: new THREE.MeshStandardMaterial({ color: '#f2c12e', roughness: 0.45, metalness: 0.1 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#202124', roughness: 0.8 }),
  };
  return mats;
}

export function createCapacho(): CapachoRig {
  const M = materials();
  const T = truckMaterials();
  const group = new THREE.Group();
  group.name = 'capacho';

  const kit = new PartKit();
  // cuerpo: exterior, labio y cara interior en un solo perfil de revolución
  const body: XY[] = [
    [BOT_R, CONE_BOT], [RIM_R, CONE_TOP], [RIM_R, RIM_Y - 0.02], [RIM_R + 0.03, RIM_Y], [RIM_R - 0.04, RIM_Y + 0.01],
    [RIM_R - 0.05, CONE_TOP], [BOT_R - 0.03, CONE_BOT + 0.04], [0.0, CONE_BOT + 0.04],
  ];
  kit.lathe(M.body, body, 32);
  // anillo superior y marco con 4 patas (amarillo)
  kit.cyl(M.frame, RIM_R + 0.05, RIM_R + 0.05, 0.12, [0, CONE_TOP + 0.02, 0], 'y', 32, true);
  const legs: XY[] = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  const feet = legs.map(([sx, sz]) => [sx * 0.62, -HEIGHT + 0.03, sz * 0.62] as [number, number, number]);
  legs.forEach(([sx, sz], i) => {
    kit.bar(M.frame, [sx * 0.6, CONE_TOP, sz * 0.6], feet[i], 0.04);
    kit.boxAt(M.frame, 0.16, 0.03, 0.16, [feet[i][0], -HEIGHT + 0.015, feet[i][2]]);
  });
  feet.forEach((f, i) => kit.bar(M.frame, [f[0], -1.86, f[2]], [feet[(i + 1) % 4][0], -1.86, feet[(i + 1) % 4][2]], 0.03));
  // asa (bail) sobre muñones laterales, hasta el ojo de izaje
  const bail: [number, number, number][] = [[-0.88, RIM_Y - 0.05, 0], [-0.88, -0.42, 0], [-0.3, -0.13, 0], [0.3, -0.13, 0], [0.88, -0.42, 0], [0.88, RIM_Y - 0.05, 0]];
  for (let i = 0; i < bail.length - 1; i++) kit.bar(M.frame, bail[i], bail[i + 1], 0.045);
  for (const s of [-1, 1]) kit.cyl(T.steel, 0.07, 0.07, 0.14, [s * 0.85, RIM_Y - 0.05, 0], 'x', 12);
  kit.bar(M.frame, [-0.3, -0.13, 0], [0, -0.06, 0], 0.04);
  kit.bar(M.frame, [0.3, -0.13, 0], [0, -0.06, 0], 0.04);
  kit.add(T.steel, new THREE.TorusGeometry(0.07, 0.022, 8, 16), [0, -0.07, 0]);
  // compuerta (caja) y manga de goma
  kit.box(M.body, -0.27, -1.86, -0.2, 0.27, -1.7, 0.2);
  kit.cyl(M.rubber, 0.13, 0.12, 0.14, [0, -1.93, 0], 'y', 16, true);
  group.add(kit.build());

  // palanca y placa de corredera (móviles)
  const lever = new PartKit();
  lever.bar(M.frame, [0, 0, 0], [0, 0.55, 0], 0.025, 6);
  lever.boxAt(T.dark, 0.06, 0.14, 0.06, [0, 0.6, 0]);
  const leverGroup = lever.build();
  leverGroup.position.set(0, -1.78, 0.22);
  const plate = new PartKit();
  plate.box(T.steel, -0.24, -0.015, -0.18, 0.24, 0.015, 0.18);
  plate.box(T.dark, 0.24, -0.04, -0.06, 0.3, 0.04, 0.06);
  const plateGroup = plate.build();
  plateGroup.position.set(0, -1.78, 0);
  group.add(leverGroup, plateGroup);

  // hormigón dentro: domo bajo, escalado según el nivel
  const fill = new THREE.Mesh(
    new THREE.LatheGeometry([new THREE.Vector2(1, 0), new THREE.Vector2(0.85, 0.03), new THREE.Vector2(0.5, 0.065), new THREE.Vector2(0, 0.08)], 24),
    T.concrete,
  );
  fill.receiveShadow = true;
  fill.visible = false;
  group.add(fill);

  const outlet = new THREE.Object3D();
  outlet.position.set(0, -HEIGHT, 0);
  group.add(outlet);

  const innerTop = RIM_Y - 0.06;
  const innerBot = CONE_BOT + 0.04;
  const setFill = (k: number) => {
    fill.visible = k > 0.01;
    if (!fill.visible) return;
    const h = Math.cbrt(Math.min(1, k)) * 0.85 + Math.min(1, k) * 0.15;
    const y = THREE.MathUtils.lerp(innerBot, innerTop, h);
    const r = THREE.MathUtils.lerp(BOT_R - 0.03, RIM_R - 0.05, (y - innerBot) / (CONE_TOP - innerBot));
    fill.position.y = y;
    fill.scale.set(Math.min(r, RIM_R - 0.05), 1, Math.min(r, RIM_R - 0.05));
  };
  const setOpen = (k: number) => {
    const s = Math.min(1, Math.max(0, k));
    plateGroup.position.x = 0.32 * s;
    leverGroup.rotation.z = -1.1 * s;
  };
  setOpen(0);

  return {
    group,
    height: HEIGHT,
    setFill,
    setOpen,
    outlet,
    pickables: markPickable(group, { type: 'capacho' }),
  };
}
