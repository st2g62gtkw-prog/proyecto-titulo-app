/**
 * Andamio colgante (balancín) del subcontrato de pintura de fachada.
 *
 *  - Plataforma metálica liviana (PINTURA.plataforma, ~4,5 × 0,75 m): piso de aluminio, rodapié,
 *    baranda perimetral (más baja hacia el muro) y un estribo en cada extremo con su huinche.
 *  - Dos pescantes (vigas de suspensión) apoyados en la losa de techumbre junto al borde, con su
 *    contrapeso atrás; de la punta de cada uno baja un cable de acero hasta el estribo y la cola
 *    del cable cuelga hasta el terreno.
 *  - Una cuerda de vida independiente por pintor, anclada en la techumbre, con su estrobo al arnés.
 *
 * Marco local de la plataforma: origen en el centro del piso, +x a lo largo de la fachada, +z hacia
 * afuera (el muro queda en −z) e y hacia arriba. Los pescantes usan el mismo giro, con el origen en
 * el punto de cuelga del cable sobre la losa de techumbre.
 */
import * as THREE from 'three';
import { PINTURA } from '../../config';
import type { PaintState } from '../../core/paintPlan';
import { PartKit, markPickable, metal, paint } from './mixer';

export interface BalancinRig {
  group: THREE.Group;
  pickables: THREE.Object3D[];
  /** Puestos de los dos pintores (mundo): pie, rumbo (0 = +x, hacia +z) y si van en la plataforma. */
  painters: { x: number; y: number; z: number; heading: number; onPlatform: boolean }[];
  set(s: PaintState | null): void;
}

const L = PINTURA.plataforma.largo;
const W = PINTURA.plataforma.ancho;
/** Cable a lo largo de la plataforma (en cada estribo) y altura del estribo. */
const CABLE_X = L / 2 - 0.12;
const STIRRUP_Y = 1.95;
/** Altura de la viga del pescante sobre la losa (pasa sobre la baranda de borde, 1,1 m). */
const BEAM_Y = 1.75;
/** Retranqueo del mástil y del contrapeso respecto del borde de la losa. */
const MAST_IN = 0.45;
const TAIL_IN = 2.9;
/** Pintores a lo largo de la plataforma. */
const PAINTER_X = 1.05;

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();

/** Cilindro unitario que se estira entre dos puntos cada cuadro (cables y cuerdas). */
function strand(color: THREE.ColorRepresentation, r: number) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 5, 1, true), new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.3 }));
  m.castShadow = true;
  m.frustumCulled = false;
  return m;
}
function stretch(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
  _d.subVectors(b, a);
  const len = _d.length();
  m.visible = len > 1e-3;
  if (!m.visible) return;
  m.position.addVectors(a, b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, _d.divideScalar(len));
  m.scale.set(1, len, 1);
}

function buildPlatform() {
  const kit = new PartKit();
  const alu = metal('#b4b9be'), dark = metal('#5d6269'), rail = paint('#f0a51c'), red = paint('#c7302a'), grey = paint('#3a3d42');
  const hx = L / 2, hz = W / 2;
  // piso de aluminio antideslizante sobre dos largueros
  kit.box(alu, -hx, -0.05, -hz, hx, 0, hz);
  for (const z of [-hz + 0.04, hz - 0.04]) kit.box(dark, -hx, -0.16, z - 0.03, hx, -0.05, z + 0.03);
  // rodapié en todo el contorno
  kit.box(alu, -hx, 0, -hz, hx, 0.15, -hz + 0.02);
  kit.box(alu, -hx, 0, hz - 0.02, hx, 0.15, hz);
  for (const x of [-hx, hx - 0.02]) kit.box(alu, x, 0, -hz, x + 0.02, 0.15, hz);
  // baranda: 1,0 m hacia afuera y en los extremos, 0,7 m hacia el muro; pasamanos y travesaño intermedio
  const posts = Math.ceil(L / 1.5);
  for (let i = 0; i <= posts; i++) {
    const x = -hx + 0.03 + ((L - 0.06) * i) / posts;
    kit.bar(rail, [x, 0, hz - 0.03], [x, 1.0, hz - 0.03], 0.022);
    kit.bar(rail, [x, 0, -hz + 0.03], [x, 0.7, -hz + 0.03], 0.022);
  }
  for (const [z, top] of [[hz - 0.03, 1.0], [-hz + 0.03, 0.7]] as const) {
    kit.bar(rail, [-hx, top, z], [hx, top, z], 0.024);
    kit.bar(rail, [-hx, top * 0.5, z], [hx, top * 0.5, z], 0.02);
  }
  for (const x of [-hx + 0.03, hx - 0.03]) {
    kit.bar(rail, [x, 1.0, hz - 0.03], [x, 0.7, -hz + 0.03], 0.024);
    kit.bar(rail, [x, 0.5, hz - 0.03], [x, 0.35, -hz + 0.03], 0.02);
  }
  // estribos en los extremos, con el huinche (tecle eléctrico) y la caja de control
  for (const s of [-1, 1]) {
    const x = s * CABLE_X;
    for (const z of [-hz + 0.05, hz - 0.05]) kit.bar(dark, [x, 0, z], [x, STIRRUP_Y - 0.05, z * 0.15], 0.032);
    kit.bar(dark, [x, STIRRUP_Y - 0.06, -0.08], [x, STIRRUP_Y - 0.06, 0.08], 0.035);
    kit.boxAt(dark, 0.08, 0.1, 0.08, [x, STIRRUP_Y, 0]);
    kit.boxAt(red, 0.34, 0.42, 0.3, [x - s * 0.02, 1.05, 0]);
    kit.cyl(grey, 0.12, 0.12, 0.36, [x - s * 0.02, 1.05, 0], 'x', 12);
    kit.boxAt(grey, 0.06, 0.16, 0.12, [x - s * 0.22, 0.85, 0.12]);
  }
  // balde de pintura y bandeja con rodillo de repuesto
  kit.cyl(paint('#f4f4f0'), 0.15, 0.13, 0.32, [0.2, 0.16, 0.05], 'y', 12);
  kit.cyl(paint('#d8d5cc'), 0.14, 0.14, 0.01, [0.2, 0.32, 0.05], 'y', 12);
  kit.box(paint('#2f6fd1'), -0.55, 0, -0.1, -0.15, 0.07, 0.2);
  return kit.build();
}

function buildPescanteBase() {
  // en el marco del borde de la losa (z = 0 es el borde, −z hacia adentro de la techumbre)
  const kit = new PartKit();
  const steel = metal('#9aa1a8'), dark = metal('#4f545a'), weight = paint('#6d7075'), red = paint('#c7302a');
  // patín apoyado en la losa (sobre tablones de reparto)
  kit.box(paint('#b98e4f'), -0.25, 0, -TAIL_IN - 0.35, 0.25, 0.04, -MAST_IN + 0.3);
  kit.box(steel, -0.07, 0.04, -TAIL_IN - 0.2, 0.07, 0.16, -MAST_IN + 0.15);
  // mástil delantero con su tornapunta y pie trasero
  kit.box(steel, -0.06, 0.16, -MAST_IN - 0.06, 0.06, BEAM_Y, -MAST_IN + 0.06);
  kit.bar(steel, [0, 0.2, -MAST_IN - 0.9], [0, BEAM_Y - 0.2, -MAST_IN - 0.06], 0.03);
  kit.box(steel, -0.05, 0.16, -TAIL_IN - 0.05, 0.05, BEAM_Y, -TAIL_IN + 0.05);
  // contrapeso: bloques de acero apilados en el pie trasero
  for (let k = 0; k < 4; k++) kit.box(weight, -0.22, 0.16 + k * 0.13, -TAIL_IN - 0.18, 0.22, 0.27 + k * 0.13, -TAIL_IN + 0.18);
  kit.box(red, -0.23, 0.69, -TAIL_IN - 0.19, 0.23, 0.72, -TAIL_IN + 0.19);
  kit.box(dark, -0.03, 0.72, -TAIL_IN - 0.03, 0.03, 0.85, -TAIL_IN + 0.03);
  return kit.build();
}

export function createBalancin(o: { roofY: number; groundY: number }): BalancinRig {
  const group = new THREE.Group();
  group.name = 'balancin';
  const platform = buildPlatform();
  group.add(platform);
  const pick = { type: 'balancin' };
  const pickables: THREE.Object3D[] = [...markPickable(platform, pick)];

  // pescantes: el grupo va en el punto de cuelga (sobre la losa); la base, en el borde de la losa
  const pescantes = [0, 1].map(() => {
    const g = new THREE.Group();
    const base = buildPescanteBase();
    g.add(base);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 1), new THREE.MeshStandardMaterial({ color: '#9aa1a8', roughness: 0.4, metalness: 0.35 }));
    beam.castShadow = beam.receiveShadow = true;
    g.add(beam);
    // punta: placa con polea por donde pasa el cable
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 10).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#c7302a', roughness: 0.5 }));
    tip.position.set(0, BEAM_Y - 0.09, 0);
    g.add(tip);
    group.add(g);
    pickables.push(...markPickable(g, pick));
    return { g, base, beam };
  });

  const cables = [0, 1].map(() => strand('#2a2d31', 0.009));
  const tails = [0, 1].map(() => strand('#2a2d31', 0.008));
  const ropes = [0, 1].map(() => [strand('#ff7a1a', 0.012), strand('#ff7a1a', 0.012), strand('#ff7a1a', 0.012), strand('#ffb21a', 0.01)]);
  for (const m of [...cables, ...tails, ...ropes.flat()]) group.add(m);

  const painters: BalancinRig['painters'] = [0, 1].map(() => ({ x: 0, y: 0, z: 0, heading: 0, onPlatform: false }));

  /** Punto del marco local (x a lo largo, z hacia afuera) con origen (ox, oz) y rumbo h. */
  const local = (out: THREE.Vector3, ox: number, oz: number, h: number, lx: number, y: number, lz: number) =>
    out.set(ox + lx * Math.cos(h) + lz * Math.sin(h), y, oz - lx * Math.sin(h) + lz * Math.cos(h));

  const set = (s: PaintState | null) => {
    group.visible = !!s;
    if (!s) return;
    const h = s.heading;
    const show = s.rigged;
    platform.visible = show;
    platform.position.set(s.x, s.y, s.z);
    platform.rotation.set(0, h, 0);
    const d = s.cableOut - s.roofOut; // del borde de la losa a la línea de los cables
    // los pescantes se apoyan en lo que haya en la techumbre: la losa o, ya construida, la cubierta
    const roofY = s.top ?? o.roofY;
    pescantes.forEach((p, i) => {
      const sx = i ? CABLE_X : -CABLE_X;
      p.g.visible = show;
      local(p.g.position, s.x, s.z, h, sx, roofY, 0);
      p.g.rotation.set(0, h, 0);
      p.base.position.set(0, 0, -d);
      // viga del pie trasero a la punta, sobre el mástil
      const len = d + TAIL_IN + 0.1;
      p.beam.scale.set(1, 1, len);
      p.beam.position.set(0, BEAM_Y, -len / 2 + 0.05);
      // cable: de la polea de la punta al estribo, y la cola hasta el terreno
      local(_a, s.x, s.z, h, sx, roofY + BEAM_Y - 0.12, 0);
      local(_b, s.x, s.z, h, sx, s.y + STIRRUP_Y, 0);
      stretch(cables[i], _a, _b);
      cables[i].visible &&= show;
      local(_a, s.x, s.z, h, sx - (i ? 0.02 : -0.02), s.y + 0.85, 0.02);
      local(_b, s.x, s.z, h, sx - (i ? 0.02 : -0.02), s.base + 0.02, 0.02);
      stretch(tails[i], _a, _b);
      tails[i].visible &&= show && s.y > s.base + 0.6;
    });

    // pintores y cuerdas de vida
    const faceWall = Math.atan2(-Math.cos(h), -Math.sin(h)); // rumbo hacia −z local (el muro)
    const ropeOut = W / 2 + 0.1;
    painters.forEach((pp, i) => {
      const lx = i ? PAINTER_X : -PAINTER_X;
      pp.onPlatform = s.onPlatform && show;
      if (pp.onPlatform) {
        local(_a, s.x, s.z, h, lx, s.y, 0.08);
        pp.heading = faceWall;
      } else {
        // en la techumbre, entre el mástil y el contrapeso de cada pescante, mirando hacia afuera
        local(_a, s.x, s.z, h, (i ? CABLE_X : -CABLE_X) - (i ? 0.75 : -0.75), roofY, -d - 1.5);
        pp.heading = faceWall + Math.PI;
      }
      pp.x = _a.x;
      pp.y = _a.y;
      pp.z = _a.z;
      const [anchor, over, drop, lanyard] = ropes[i];
      local(_a, s.x, s.z, h, lx + 0.25, roofY + 0.1, -d - 1.9);
      // quiebre sobre la baranda de borde de la techumbre (montada en los parapetos), con su protector de canto
      local(_b, s.x, s.z, h, lx + 0.25, o.roofY + 1.3, -d + 0.15);
      stretch(anchor, _a, _b);
      local(_a, s.x, s.z, h, lx + 0.25, o.roofY + 1.3, ropeOut);
      stretch(over, _b, _a);
      local(_b, s.x, s.z, h, lx + 0.25, s.base + 0.02, ropeOut);
      stretch(drop, _a, _b);
      for (const m of [anchor, over, drop]) m.visible &&= show;
      // estrobo del arnés (espalda del pintor) a la cuerda
      local(_a, s.x, s.z, h, lx, s.y + 1.2, 0.24);
      local(_b, s.x, s.z, h, lx + 0.25, s.y + 1.55, ropeOut);
      stretch(lanyard, _a, _b);
      lanyard.visible &&= pp.onPlatform;
    });
  };

  return { group, pickables, painters, set };
}
