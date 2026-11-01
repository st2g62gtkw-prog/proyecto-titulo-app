/**
 * Correcciones del modelo IFC según los planos de arquitectura (Edificios E: plantas L38–L40 y
 * elevaciones L42) y lo pedido para la entrega (un edificio ordenado):
 *
 * 1. Fachadas largas simétricas. La forma del edificio ya es simétrica respecto de su eje central
 *    (x = centro de la losa tipo), pero la distribución de ventanas del IFC no. En la fachada
 *    posterior (la del hall) se toma la mitad +x, que tiene el ritmo regular de vanos de 2,7 m, y en
 *    el frente la mitad −x; cada mitad se refleja sobre la otra (muros, ventanas, barandas, vidrios y
 *    puertas de esa franja). La ventana del medio de la saliente del frente queda centrada.
 * 2. Del 2° piso hacia arriba las fachadas son iguales (elevaciones y renders del proyecto), pero en
 *    el IFC el 2° piso tiene otra losa, otros muros y otras ventanas y barandas. Aquí el 2° piso toma
 *    la losa, los muros y los detalles del 3er piso, bajados a su cota.
 * 3. Hall de acceso a doble altura, al centro de la fachada posterior, bajo los dos vanos centrales:
 *    en el 1er piso el acceso se retranquea con su vidriería y su puerta (las del IFC, trasladadas), y
 *    en el 2° piso es un VACÍO desde la línea de fachada hasta el pasillo: la losa del 2P no llega ahí,
 *    no hay muros ni ventanas del 2P sobre el hall y el vidrio del hall sube hasta la losa del 3P.
 * 4. El 1er piso es de estacionamientos: sin ventanas, barandas ni vidrios (salvo la vidriería del hall).
 */
import type { BuildingData, DetailGroup, WallData } from './building';
import type { V2 } from '../scene/geom';
import { box, clusters } from '../scene/facadeDetail';

/** Franja de las fachadas largas: |z| mayor que esto. */
const BAND = 4.5;
/** Hall del IFC (vano entre sus muros laterales, al lado −x del eje) y su fachada retranqueada. */
const HALL_IFC = { x0: -4.51, x1: 1.16 };
const HALL_FACE = -5.63;
/** Fondo del vacío del hall en el 2P (muro del pasillo). */
const HALL_Z1 = -3.06;

type Keep = (cz: number) => 0 | 1 | -1;

/**
 * Recorta un polígono al semiplano del eje (0 = x, 1 = z) ≥ v (side 1) o ≤ v (side −1)
 * (Sutherland–Hodgman).
 */
function clip(poly: V2[], axis: 0 | 1, v: number, side: 1 | -1): V2[] {
  const out: V2[] = [];
  const inside = (p: V2) => side * (p[axis] - v) >= 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (inside(a)) out.push(a);
    if (inside(a) !== inside(b)) {
      const t = (v - a[axis]) / (b[axis] - a[axis]);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

const area = (p: V2[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
const mirror = (p: V2[], xc: number) => p.map(([x, z]) => [2 * xc - x, z] as V2).reverse();
const zMid = (w: WallData) => { const zs = w.poly.map((p) => p[1]); return (Math.min(...zs) + Math.max(...zs)) / 2; };

/** El trozo de un muro a un lado de x = v (o z = v) (null si no queda nada). */
function clipWall(w: WallData, v: number, side: 1 | -1, tag: string, axis: 0 | 1 = 0): WallData | null {
  const poly = clip(w.poly, axis, v, side);
  if (poly.length < 3 || area(poly) < 1e-3) return null;
  const holes = w.holes.map((h) => clip(h, axis, v, side)).filter((h) => h.length >= 3 && area(h) > 1e-3);
  return { ...w, id: w.id + tag, poly, holes };
}

/**
 * Muros de las fachadas largas: la mitad que se conserva y su reflejo. Los muros que envuelven las
 * esquinas (testero con sus retornos) se cortan en la franja posterior, el testero y la franja del
 * frente, para que los retornos queden iguales en ambos extremos.
 */
function symWalls(walls: WallData[], xc: number, keep: Keep): WallData[] {
  const out: WallData[] = [];
  for (const w of walls) {
    const zs = w.poly.map((p) => p[1]), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const split = (z0 < -BAND && z1 > -BAND) || (z0 < BAND && z1 > BAND);
    const mid = split ? clipWall(w, -BAND, 1, '-t', 1) : null;
    const parts = split
      ? [clipWall(w, -BAND, -1, '-p', 1), mid && clipWall(mid, BAND, -1, '', 1), clipWall(w, BAND, 1, '-f', 1)]
      : [w];
    for (const p of parts) {
      if (!p) continue;
      const k = keep(zMid(p));
      if (!k) { out.push(p); continue; }
      const c = clipWall(p, xc, k, '');
      if (c) out.push(c, { ...c, id: c.id + '-sim', poly: mirror(c.poly, xc), holes: c.holes.map((h) => mirror(h, xc)) });
    }
  }
  return out;
}

/** Quita de los muros de la franja posterior lo que cae entre x0 y x1. */
function cutWalls(walls: WallData[], x0: number, x1: number, inBand: (w: WallData) => boolean): WallData[] {
  const out: WallData[] = [];
  for (const w of walls) {
    if (!inBand(w)) { out.push(w); continue; }
    for (const c of [clipWall(w, x0, -1, '-a'), clipWall(w, x1, 1, '-b')]) if (c) out.push(c);
  }
  return out;
}

/** Ventanas, barandas y vidrios (cajas): la mitad que se conserva y su reflejo; la que cruza el eje se centra. */
function symBoxes(src: number[], xc: number, keep: Keep): number[] {
  const out: number[] = [];
  for (const b of clusters(new Float32Array(src), 0.03)) {
    const k = keep((b[2] + b[5]) / 2), cx = (b[0] + b[3]) / 2;
    if (!k) box(out, ...b);
    else if (b[0] < xc - 0.1 && b[3] > xc + 0.1) box(out, b[0] + xc - cx, b[1], b[2], b[3] + xc - cx, b[4], b[5]);
    else if (k * (cx - xc) > 0) {
      box(out, ...b);
      box(out, 2 * xc - b[3], b[1], b[2], 2 * xc - b[0], b[4], b[5]);
    }
  }
  return out;
}

/** Puertas (triángulos): la mitad que se conserva y su reflejo (con la cara hacia afuera). */
function symTris(src: number[], xc: number, keep: Keep): number[] {
  const out: number[] = [];
  for (let t = 0; t < src.length; t += 9) {
    const k = keep((src[t + 2] + src[t + 5] + src[t + 8]) / 3), cx = (src[t] + src[t + 3] + src[t + 6]) / 3;
    if (k && k * (cx - xc) < 0) continue;
    for (let i = 0; i < 9; i++) out.push(src[t + i]);
    if (k) for (const v of [0, 2, 1]) out.push(2 * xc - src[t + v * 3], src[t + v * 3 + 1], src[t + v * 3 + 2]);
  }
  return out;
}

/** Quita las cajas (ventanas, barandas, vidrios) o los triángulos (puertas) cuyo centro cumple drop. */
function dropBoxes(src: number[], drop: (x: number, z: number) => boolean): number[] {
  const out: number[] = [];
  for (const b of clusters(new Float32Array(src), 0.03)) if (!drop((b[0] + b[3]) / 2, (b[2] + b[5]) / 2)) box(out, ...b);
  return out;
}
function dropTris(src: number[], drop: (x: number, z: number) => boolean): number[] {
  const out: number[] = [];
  for (let t = 0; t < src.length; t += 9) {
    if (drop((src[t] + src[t + 3] + src[t + 6]) / 3, (src[t + 2] + src[t + 5] + src[t + 8]) / 3)) continue;
    for (let i = 0; i < 9; i++) out.push(src[t + i]);
  }
  return out;
}

/**
 * Muesca en el borde de una losa: saca los vértices del borde (z entre zA y zB) que caen entre x0 y
 * x1 y, en el tramo que queda cruzando, entra hasta zIn. Devuelve la z del borde.
 */
function notch(outer: V2[], x0: number, x1: number, zIn: number, zA: number, zB: number): { outer: V2[]; zEdge: number } {
  const onEdge = ([, z]: V2) => z >= zA && z <= zB;
  const ring = outer.filter((p) => !(onEdge(p) && p[0] > x0 && p[0] < x1));
  const out: V2[] = [];
  let zEdge = (zA + zB) / 2;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    out.push(a);
    if (onEdge(a) && onEdge(b) && a[0] >= x1 && b[0] <= x0) {
      out.push([x1, a[1]], [x1, zIn], [x0, zIn], [x0, b[1]]);
      zEdge = a[1];
    }
  }
  return { outer: out, zEdge };
}

export function applyPlanFixes(data: BuildingData, detail: ArrayBuffer): ArrayBuffer {
  const L1 = data.levels.find((l) => l.name === '1P'), L2 = data.levels.find((l) => l.name === '2P'), L3 = data.levels.find((l) => l.name === '3P');
  if (!L1 || !L2 || !L3) return detail;
  const xs = L3.slab.outer.map((p) => p[0]);
  const xc = (Math.min(...xs) + Math.max(...xs)) / 2;
  // el hall se traslada al centro: vano entre muros laterales (el del IFC) y vacío del 2P
  const dx = xc - (HALL_IFC.x0 + HALL_IFC.x1) / 2;
  const H0 = HALL_IFC.x0 + dx, H1 = HALL_IFC.x1 + dx;

  // detalles por piso y tipo
  const tris = new Map<string, number[]>();
  const order: DetailGroup[] = [];
  for (const g of data.detail.groups) {
    const key = g.level + '|' + g.kind;
    if (!tris.has(key)) { tris.set(key, []); order.push(g); }
    const a = tris.get(key)!, src = new Float32Array(detail, g.offset, g.count * 3);
    for (let i = 0; i < src.length; i++) a.push(src[i]);
  }
  const get = (level: string, kind: DetailGroup['kind']) => {
    const key = level + '|' + kind;
    if (!tris.has(key)) { tris.set(key, []); order.push({ level, kind, offset: 0, count: 0 }); }
    return tris.get(key)!;
  };
  const set = (level: string, kind: DetailGroup['kind'], a: number[]) => { get(level, kind); tris.set(level + '|' + kind, a); };
  const kinds: DetailGroup['kind'][] = ['window', 'railing', 'plate', 'door'];
  const isBox = (k: DetailGroup['kind']) => k !== 'door';

  // vidriería y puerta del hall del IFC (1P), trasladadas al centro
  const inHallIfc = (x: number, z: number) => x > HALL_IFC.x0 && x < HALL_IFC.x1 && z > HALL_FACE - 0.4 && z < HALL_FACE + 0.6;
  const hall = new Map<DetailGroup['kind'], number[]>();
  for (const k of ['window', 'plate', 'door'] as const) {
    const src = get('1P', k), moved: number[] = [];
    for (let t = 0; t < src.length; t += 9) {
      if (!inHallIfc((src[t] + src[t + 3] + src[t + 6]) / 3, (src[t + 2] + src[t + 5] + src[t + 8]) / 3)) continue;
      for (let i = 0; i < 9; i += 3) moved.push(src[t + i] + dx, src[t + i + 1], src[t + i + 2]);
    }
    hall.set(k, moved);
    set('1P', k, dropTris(src, inHallIfc));
  }

  // --- 1. fachadas simétricas (el 2P se arma después desde el 3P; el frente del 1P, con los
  // estacionamientos y el acceso vehicular, queda como en el IFC) -----------------------------------
  const keepBoth: Keep = (cz) => (cz < -BAND ? 1 : cz > BAND ? -1 : 0);
  const keepBack: Keep = (cz) => (cz < -BAND ? 1 : 0);
  for (const L of data.levels) {
    if (L === L2 || !L.walls.length) continue;
    const keep = L === L1 ? keepBack : keepBoth;
    L.walls = symWalls(L.walls, xc, keep);
    for (const k of kinds) set(L.name, k, isBox(k) ? symBoxes(get(L.name, k), xc, keep) : symTris(get(L.name, k), xc, keep));
  }

  // --- 3a. hall del 1P al centro --------------------------------------------------------------
  {
    const back = (w: WallData) => zMid(w) < -BAND;
    const ref = L1.walls.find((w) => w.cat === 'fachada' && w.ha && back(w));
    L1.walls = cutWalls(L1.walls, H0 - 0.2, H1 + 0.2, back);
    // muros laterales del retranqueo y antepecho de la vidriería (como los del IFC)
    if (ref) {
      L1.walls.push({
        ...ref, id: 'hall-1P', name: 'Hall acceso 1P', holes: [],
        poly: [[H0 - 0.2, -6.27], [H0, -6.27], [H0, HALL_FACE], [H1, HALL_FACE], [H1, -6.27], [H1 + 0.2, -6.27], [H1 + 0.2, HALL_FACE + 0.2], [H0 - 0.2, HALL_FACE + 0.2]],
      });
    }
    // losa: el retranqueo del hall del IFC se cierra y se abre al centro
    const ring = L1.slab.outer.filter(([x, z]) => !(z > -6.3 && z < -5.5 && x > HALL_IFC.x0 - 0.01 && x < HALL_IFC.x1 + 0.01));
    L1.slab.outer = notch(ring, H0, H1, HALL_FACE, -6.3, -6.2).outer;
    const inHall = (x: number, z: number) => x > H0 - 0.2 && x < H1 + 0.2 && z < -BAND;
    // (4) estacionamientos: de las ventanas, barandas y vidrios del 1P solo queda la vidriería del hall
    for (const k of kinds) set('1P', k, [...(isBox(k) ? [] : dropTris(get('1P', k), inHall)), ...(hall.get(k) ?? [])]);
  }

  // --- 2. el 2P igual al 3P, con el vacío del hall (3b) ----------------------------------------
  const dy = L3.slab.y0 - L2.slab.y0;
  const s2 = notch(L3.slab.outer, H0, H1, HALL_Z1, -7.5, -7.2);
  L2.slab.outer = s2.outer;
  L2.slab.holes = L3.slab.holes.map((h) => h.map(([x, z]) => [x, z] as V2));
  L2.slab.area = L3.slab.area - (H1 - H0) * (HALL_Z1 - s2.zEdge);
  const overHall = (x: number, z: number) => x > H0 && x < H1 && z > s2.zEdge - 0.4 && z < HALL_Z1 - 0.15;
  L2.walls = cutWalls(
    L3.walls.map((w) => ({ ...w, id: w.id + '-2P', y0: w.y0 - dy, y1: w.y1 - dy, poly: w.poly.map(([x, z]) => [x, z] as V2) })),
    H0, H1, (w) => zMid(w) > s2.zEdge - 0.4 && zMid(w) < HALL_Z1 - 0.15,
  );
  for (const k of kinds) {
    const src = get('3P', k), down: number[] = [];
    for (let i = 0; i < src.length; i += 3) down.push(src[i], src[i + 1] - dy, src[i + 2]);
    set('2P', k, isBox(k) ? dropBoxes(down, overHall) : dropTris(down, overHall));
  }
  // vidrio del hall en la altura del 2P, sobre la fachada del hall del 1er piso
  {
    const z = HALL_FACE - 0.02, ya = L2.slab.y0, yb = L3.slab.y0;
    const q = [[H0, ya, z], [H1, ya, z], [H1, yb, z], [H0, yb, z]];
    get('2P', 'plate').push(...[0, 2, 1, 0, 3, 2, 0, 1, 2, 0, 2, 3].flatMap((k) => q[k]));
  }

  // buffer de detalles
  const groups: DetailGroup[] = [];
  let count = 0;
  for (const g of order) count += tris.get(g.level + '|' + g.kind)!.length;
  const buf = new Float32Array(count);
  let o = 0;
  for (const g of order) {
    const a = tris.get(g.level + '|' + g.kind)!;
    buf.set(a, o);
    groups.push({ level: g.level, kind: g.kind, offset: o * 4, count: a.length / 3 });
    o += a.length;
  }
  data.detail.groups = groups;
  return buf.buffer;
}
