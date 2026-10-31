/**
 * Correcciones del modelo IFC según los planos de arquitectura (Edificios E: plantas L38–L40 y
 * elevaciones L42):
 *
 * 1. Del 2° piso hacia arriba las fachadas son iguales (elevaciones y renders del proyecto), pero en
 *    el IFC el 2° piso tiene otra losa (con una franja que sobresale al centro del frente), otros
 *    muros y otras ventanas y barandas. Aquí el 2° piso toma la losa, los muros, las ventanas, los
 *    vidrios, las barandas y las puertas del 3er piso, bajados a su cota.
 * 2. Hall de acceso a doble altura. En la planta del 1er piso el ACCESO (hall) queda al centro del
 *    costado posterior, entre los ejes K. y M., y en la planta del 2° piso ese espacio es un VACÍO de
 *    5,87 × 4,37 m, desde la línea de fachada hasta el pasillo: la losa del 2P no llega ahí, no hay
 *    muros ni ventanas del 2P sobre el hall y el vidrio del hall sube hasta la losa del 3er piso.
 */
import type { BuildingData, DetailGroup } from './building';
import type { V2 } from '../scene/geom';

/** Vacío del hall en planta (coordenadas de la app): entre los muros laterales y el del pasillo. */
const HALL = { x0: -4.41, x1: 1.06, z1: -3.06 };
/** Fachada del hall en el 1er piso (retranqueada respecto de la línea de fachada). */
const HALL_FACE = -5.63;

export function applyPlanFixes(data: BuildingData, detail: ArrayBuffer): ArrayBuffer {
  const L2 = data.levels.find((l) => l.name === '2P'), L3 = data.levels.find((l) => l.name === '3P');
  if (!L2 || !L3) return detail;
  const dy = L3.slab.y0 - L2.slab.y0;
  const { x0, x1, z1 } = HALL;

  // --- 1. el 2P igual al 3P -------------------------------------------------------------------
  // losa: contorno del 3P con la muesca del vacío del hall en el borde posterior
  const outer: V2[] = [];
  let zFace = -7.35;
  const ring = L3.slab.outer;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    outer.push(a);
    // tramo del borde posterior que cruza el hall (va de +x a −x por la línea de fachada)
    if (Math.abs(a[1] - b[1]) < 0.01 && a[1] < -6 && a[0] > x1 && b[0] < x0) {
      outer.push([x1, a[1]], [x1, z1], [x0, z1], [x0, a[1]]);
      zFace = a[1];
    }
  }
  L2.slab.outer = outer;
  L2.slab.holes = L3.slab.holes.map((h) => h.map(([x, z]) => [x, z] as V2));
  L2.slab.area = L3.slab.area - (x1 - x0) * (z1 - zFace);
  L2.walls = L3.walls.map((w) => ({ ...w, id: w.id + '-2P', y0: w.y0 - dy, y1: w.y1 - dy, poly: w.poly.map(([x, z]) => [x, z] as V2), holes: w.holes }));

  // --- 2. hall a doble altura: sin muros ni ventanas del 2P sobre el hall ----------------------
  const overHall = (x: number, z: number) => x > x0 + 0.2 && x < x1 - 0.2 && z > zFace - 0.4 && z < z1 - 0.15;
  L2.walls = L2.walls.filter((w) => {
    const cx = w.poly.reduce((s, p) => s + p[0], 0) / w.poly.length, cz = w.poly.reduce((s, p) => s + p[1], 0) / w.poly.length;
    return !overHall(cx, cz);
  });

  // detalles (ventanas, vidrios, barandas, puertas): los del 2P se reemplazan por los del 3P bajados
  const parts: Float32Array[] = [];
  const out: DetailGroup[] = [];
  let offset = 0;
  const push = (g: DetailGroup, arr: Float32Array) => {
    parts.push(arr);
    out.push({ ...g, offset, count: arr.length / 3 });
    offset += arr.byteLength;
  };
  for (const g of data.detail.groups) {
    if (g.level === '2P') continue;
    push(g, new Float32Array(detail, g.offset, g.count * 3));
    if (g.level !== '3P') continue;
    const src = new Float32Array(detail, g.offset, g.count * 3), kept: number[] = [];
    for (let t = 0; t < g.count / 3; t++) {
      let cx = 0, cz = 0;
      for (let k = 0; k < 3; k++) {
        cx += src[t * 9 + k * 3];
        cz += src[t * 9 + k * 3 + 2];
      }
      if (overHall(cx / 3, cz / 3)) continue;
      for (let k = 0; k < 3; k++) kept.push(src[t * 9 + k * 3], src[t * 9 + k * 3 + 1] - dy, src[t * 9 + k * 3 + 2]);
    }
    push({ ...g, level: '2P' }, new Float32Array(kept));
  }
  // vidrio del hall en la altura del 2P, sobre la fachada del hall del 1er piso
  {
    const z = HALL_FACE - 0.02, ya = L2.slab.y0, yb = L3.slab.y0;
    const q = [[x0, ya, z], [x1, ya, z], [x1, yb, z], [x0, yb, z]];
    push({ level: '2P', kind: 'plate', offset: 0, count: 0 }, new Float32Array([0, 2, 1, 0, 3, 2, 0, 1, 2, 0, 2, 3].flatMap((k) => q[k])));
  }
  const buf = new ArrayBuffer(offset);
  let o = 0;
  for (const p of parts) {
    new Float32Array(buf, o, p.length).set(p);
    o += p.byteLength;
  }
  data.detail.groups = out;
  return buf;
}
