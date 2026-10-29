/**
 * Obras sobre la losa de techumbre (config TECHO): geometría que comparten el cronograma (viajes
 * de grúa, cuadrillas), la escena (scene/roof.ts) y la pintura de fachada.
 *
 *  - Parapetos y muros de la caja de escala y sala de máquinas como muros H.A. (WallData), partidos
 *    en tramos para hormigonarlos por sectores. Los vanos de las puertas y de la pasada quedan entre
 *    tramos, con su dintel (o antepecho) como tramo aparte.
 *  - Techumbre: celdas rectangulares dentro de los parapetos y fuera de la caja (el contorno del
 *    edificio es ortogonal), cada una dentro de un solo faldón, con la cubierta a la altura que da la
 *    pendiente de su faldón: cumbrera a lo largo del edificio, canal posterior junto al parapeto y
 *    limahoya entre el faldón central y la franja frontal (faldón sur, L41).
 *  - Ductos de ventilación en los vanos de shaft de los muros del 7° piso (los mismos de la planta
 *    de techumbre), canales, cubetas de las bajadas de aguas lluvia y bajadas de la caja.
 */
import type { BuildingData, WallData } from '../data/building';
import { TECHO } from '../config';
import { offsetPolygon, pointInPolygon, polyBounds, signedArea, type V2 } from '../scene/geom';

export interface RoofCell {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface RoofVent {
  x: number;
  z: number;
  /** Medidas del vano del shaft en planta (x, z). */
  w: number;
  d: number;
  /** ducto: shaft de 50 × 50 con sombrerete; chimenea: shaft junto a la caja (tabique T6 "shaft techo"); tubo: ventilación Ø110. */
  kind: 'ducto' | 'chimenea' | 'tubo';
}

/** Vano en un muro de la caja (puerta o pasada), medido sobre la cara exterior. */
export interface RoofOpening {
  a: V2;
  b: V2;
  y0: number;
  y1: number;
  kind: 'salida' | 'puerta' | 'pasada';
}

export interface RoofGeometry {
  /** Cara superior de la losa de techumbre. */
  y: number;
  /** Contorno de la losa y contorno interior de los parapetos. */
  outer: V2[];
  inner: V2[];
  parapets: WallData[];
  box: {
    outline: V2[];
    /** Interior de la caja (cara interior de sus muros). */
    inner: V2[];
    walls: WallData[];
    openings: RoofOpening[];
    /** Centro de la caja en planta. */
    cx: number;
    cz: number;
  };
  /** Celdas de la cubierta (dentro de los parapetos, fuera de la caja), ordenadas por x. */
  cells: RoofCell[];
  /** Línea de canal posterior (z mínima), cumbrera y limahoya entre el faldón central y el sur. */
  backZ: number;
  ridgeZ: number;
  valleyZ: number;
  /** Alto de la cubierta terminada sobre la losa según z (faldón norte, central o sur). */
  rise(z: number): number;
  /** Canales: tramos en planta (a lo largo de x) sobre la línea baja de cada faldón. */
  gutters: { a: V2; b: V2 }[];
  /** Cubetas de las bajadas Ø160 en las cuatro esquinas. */
  outlets: V2[];
  /** Bajadas Ø110 desde la cubierta de la caja hasta la techumbre (pie en la techumbre). */
  boxDrains: V2[];
  vents: RoofVent[];
  /** Caja en planta de la losa (para ordenar el avance a lo largo del edificio). */
  x0: number;
  x1: number;
}

const ccw = (p: V2[]) => (signedArea(p) < 0 ? [...p].reverse() : p);

/**
 * Tramos rectangulares de muro hacia el interior de un contorno (espesor t), uno por arista y partidos
 * cada `maxLen` m. En los vértices cóncavos el tramo se alarga t para cerrar la esquina. `openings`
 * corta los tramos donde hay un vano (queda el dintel o el antepecho como tramo aparte).
 */
function wallsAlong(
  outline: V2[], t: number, y0: number, y1: number, maxLen: number, name: string,
  openings: RoofOpening[] = [],
): WallData[] {
  const p = ccw(outline);
  const n = p.length;
  const out: WallData[] = [];
  const dir = (i: number): V2 => {
    const a = p[(i + n) % n], b = p[(i + 1) % n];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  // contorno antihorario: el interior queda a la izquierda, normal (−uz, ux); vértice cóncavo = giro a la derecha
  const concave = (i: number) => {
    const u1 = dir(i - 1), u2 = dir(i);
    return u1[0] * u2[1] - u1[1] * u2[0] < -1e-6;
  };
  const piece = (a: V2, b: V2, u: V2, ya: number, yb: number, k: number) => {
    const nin: V2 = [-u[1], u[0]];
    const poly: V2[] = [a, b, [b[0] + nin[0] * t, b[1] + nin[1] * t], [a[0] + nin[0] * t, a[1] + nin[1] * t]];
    out.push({ id: `${name}-${out.length}`, name: `${name} ${k}`, cat: 'fachada', ha: true, t, y0: ya, y1: yb, poly: ccw(poly), holes: [] });
  };
  for (let i = 0; i < n; i++) {
    const u = dir(i);
    const len0 = Math.hypot(p[(i + 1) % n][0] - p[i][0], p[(i + 1) % n][1] - p[i][1]);
    if (len0 < 0.05) continue;
    const e0 = concave(i) ? t : 0, e1 = concave(i + 1) ? t : 0;
    const A: V2 = [p[i][0] - u[0] * e0, p[i][1] - u[1] * e0];
    const len = len0 + e0 + e1;
    const at = (s: number): V2 => [A[0] + u[0] * s, A[1] + u[1] * s];
    // vanos sobre esta arista (proyectados sobre ella)
    const cuts = openings
      .map((o) => {
        const s0 = (o.a[0] - A[0]) * u[0] + (o.a[1] - A[1]) * u[1];
        const s1 = (o.b[0] - A[0]) * u[0] + (o.b[1] - A[1]) * u[1];
        const off = Math.abs((o.a[0] - A[0]) * -u[1] + (o.a[1] - A[1]) * u[0]);
        return { o, s0: Math.min(s0, s1), s1: Math.max(s0, s1), off };
      })
      .filter((c) => c.off < 0.08 && c.s0 > -0.01 && c.s1 < len + 0.01)
      .sort((c, d) => c.s0 - d.s0);
    // tramos llenos entre vanos, partidos cada maxLen
    const full: [number, number][] = [];
    let s = 0;
    for (const c of cuts) {
      if (c.s0 > s + 0.02) full.push([s, c.s0]);
      if (c.o.y0 > y0 + 0.02) piece(at(c.s0), at(c.s1), u, y0, c.o.y0, out.length);
      if (c.o.y1 < y1 - 0.02) piece(at(c.s0), at(c.s1), u, c.o.y1, y1, out.length);
      s = c.s1;
    }
    if (len > s + 0.02) full.push([s, len]);
    for (const [f0, f1] of full) {
      const k = Math.max(1, Math.ceil((f1 - f0) / maxLen));
      for (let j = 0; j < k; j++) piece(at(f0 + ((f1 - f0) * j) / k), at(f0 + ((f1 - f0) * (j + 1)) / k), u, y0, y1, out.length);
    }
  }
  return out;
}

export function buildRoofGeometry(data: BuildingData): RoofGeometry {
  const roof = data.levels[data.levels.length - 1];
  const y = roof.slab.y1;
  const outer = ccw(roof.slab.outer);
  const P = TECHO.parapeto;
  const inner = offsetPolygon(outer, P.espesor);
  const parapets = wallsAlong(outer, P.espesor, y, y + P.alto, P.tramo, 'Parapeto');

  // --- caja de escala y sala de máquinas, calzada al shaft del ascensor del modelo -----------
  const C = TECHO.caja;
  const sh = data.shaft ?? { x0: -2.336, x1: -0.309, z0: 1.394, z1: 4.993 };
  const outline = ccw(C.contorno.map(([dx, dz]) => [sh.x0 + dx, sh.z0 + dz] as V2));
  const ob = polyBounds(outline);
  const yDoor = (h: number) => y + h;
  // vanos sobre las caras exteriores: salida al techo (cara +z del vestíbulo), puerta de la sala (cara +x
  // de la zona A) y pasada de despresurización bajo la losa (cara −z de la zona C)
  const zFront = sh.z0 + C.contorno[4][1], xA = sh.x0 + C.contorno[1][0], zC = sh.z0 + C.contorno[2][1];
  const openings: RoofOpening[] = [
    { kind: 'salida', a: [sh.x0 + C.salida.d, zFront], b: [sh.x0 + C.salida.d + C.salida.ancho, zFront], y0: y, y1: yDoor(C.salida.alto) },
    { kind: 'puerta', a: [xA, sh.z0 + C.puerta.d], b: [xA, sh.z0 + C.puerta.d + C.puerta.ancho], y0: y, y1: yDoor(C.puerta.alto) },
    { kind: 'pasada', a: [sh.x0 + C.pasada.d, zC], b: [sh.x0 + C.pasada.d + C.pasada.lado, zC], y0: C.muroTop - C.pasada.lado, y1: C.muroTop },
  ];
  const boxWalls = wallsAlong(outline, C.espesor, y, C.muroTop, 7, 'Caja escala', openings);
  const boxInner = offsetPolygon(outline, C.espesor);

  // --- faldones: canal posterior, cumbrera y limahoya con la franja frontal -----------------
  const ib = polyBounds(inner);
  const backZ = ib.z0;
  // la limahoya va en la línea de fachada más baja del frente (los cabezales), donde parte la franja frontal
  let valleyZ = Infinity;
  outer.forEach((a, i) => {
    const b = outer[(i + 1) % outer.length];
    // arista a lo largo de x con el exterior hacia +z (contorno antihorario: exterior a la derecha)
    if (Math.abs(a[1] - b[1]) < 0.01 && b[0] < a[0] - 1) valleyZ = Math.min(valleyZ, a[1]);
  });
  if (!Number.isFinite(valleyZ)) valleyZ = ib.z1;
  const ridgeZ = (backZ + valleyZ) / 2;
  const K = TECHO.cubierta;
  const rise = (z: number) => K.base + K.pendiente * (z <= ridgeZ ? z - backZ : z <= valleyZ ? valleyZ - z : z - valleyZ);

  // --- celdas: cortes en todos los x/z del contorno interior, de la caja, la cumbrera y la limahoya
  const uniq = (v: number[]) => [...new Set(v.map((x) => +x.toFixed(3)))].sort((a, b) => a - b);
  const xs = uniq([...inner.map((q) => q[0]), ...outline.map((q) => q[0])]);
  const zs = uniq([...inner.map((q) => q[1]), ...outline.map((q) => q[1]), ridgeZ, valleyZ]);
  const cells: RoofCell[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < zs.length; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
      if (xs[i + 1] - xs[i] < 0.02 || zs[j + 1] - zs[j] < 0.02) continue;
      if (!pointInPolygon(cx, cz, inner) || pointInPolygon(cx, cz, outline)) continue;
      cells.push({ x0: xs[i], x1: xs[i + 1], z0: zs[j], z1: zs[j + 1] });
    }
  }

  // --- canales: aristas del contorno interior a lo largo de x en la línea baja de un faldón (el
  // parapeto posterior y los cabezales del frente), y la limahoya en el tramo de la franja frontal.
  // Los bordes posteriores de los cabezales quedan junto a la cumbrera: ahí no hay canal
  const gutters: { a: V2; b: V2 }[] = [];
  let stripX0 = Infinity, stripX1 = -Infinity;
  inner.forEach((a, i) => {
    const b = inner[(i + 1) % inner.length];
    if (Math.abs(a[1] - b[1]) > 0.01 || Math.abs(b[0] - a[0]) < 0.3) return;
    const z = a[1];
    const back = b[0] > a[0]; // antihorario: avanza hacia +x por el lado posterior (−z)
    const low = back ? z < backZ + 0.6 : z <= valleyZ + 0.01 && z > valleyZ - 0.6;
    if (low) gutters.push({ a: [Math.min(a[0], b[0]), z], b: [Math.max(a[0], b[0]), z] });
    if (!back && z > valleyZ + 0.01) {
      stripX0 = Math.min(stripX0, a[0], b[0]);
      stripX1 = Math.max(stripX1, a[0], b[0]);
    }
  });
  // la franja frontal va de esquina a esquina de su contorno: la limahoya la recorre completa
  for (const c of cells) if (c.z0 >= valleyZ - 0.01) { stripX0 = Math.min(stripX0, c.x0); stripX1 = Math.max(stripX1, c.x1); }
  if (stripX1 > stripX0) gutters.push({ a: [stripX0, valleyZ], b: [stripX1, valleyZ] });

  // cubetas de las bajadas Ø160 en las cuatro esquinas de los canales (extremos −x y +x, atrás y adelante)
  const backG = gutters.filter((g) => g.a[1] < ridgeZ), frontG = gutters.filter((g) => g.a[1] > ridgeZ);
  const ends = (gs: { a: V2; b: V2 }[], side: 1 | -1) => {
    const left = gs.reduce((m, g) => (g.a[0] < m.a[0] ? g : m), gs[0]);
    const right = gs.reduce((m, g) => (g.b[0] > m.b[0] ? g : m), gs[0]);
    return [[left.a[0] + 0.3, left.a[1] + side * 0.18], [right.b[0] - 0.3, right.b[1] + side * 0.18]] as V2[];
  };
  const outlets = [...(backG.length ? ends(backG, 1) : []), ...(frontG.length ? ends(frontG, -1) : [])];
  // bajadas de la caja: por su cara posterior (−z) junto a la sala y por la cara frontal del shaft
  const boxDrains: V2[] = [
    [sh.x0 + C.contorno[1][0] - 0.25, ob.z0 - 0.08],
    [sh.x0 + C.contorno[5][0] - 0.25, sh.z0 + C.contorno[6][1] + 0.08],
  ];

  // --- ductos: vanos de shaft de los muros del 7° piso (fuera de la caja y del shaft del ascensor) ---
  const L7 = data.levels[data.levels.length - 2];
  const vents: RoofVent[] = [];
  const near = (x: number, z: number, d: number) => x > ob.x0 - d && x < ob.x1 + d && z > ob.z0 - d && z < ob.z1 + d;
  for (const w of L7.walls) {
    for (const h of w.holes) {
      const a = Math.abs(signedArea(h));
      if (a < 0.06 || a > 2) continue;
      const b = polyBounds(h);
      const x = (b.x0 + b.x1) / 2, z = (b.z0 + b.z1) / 2;
      if (pointInPolygon(x, z, outline) || !pointInPolygon(x, z, inner)) continue;
      const wv = b.x1 - b.x0, dv = b.z1 - b.z0;
      const kind: RoofVent['kind'] = a < 0.15 ? 'tubo' : near(x, z, 1.4) ? 'chimenea' : 'ducto';
      vents.push({ x, z, w: wv, d: dv, kind });
    }
  }
  cells.sort((a, b) => a.x0 - b.x0 || a.z0 - b.z0);
  vents.sort((a, b) => a.x - b.x);
  const sb = polyBounds(outer);
  return {
    y, outer, inner, parapets,
    box: { outline, inner: boxInner, walls: boxWalls, openings, cx: (ob.x0 + ob.x1) / 2, cz: (ob.z0 + ob.z1) / 2 },
    cells, backZ, ridgeZ, valleyZ, rise, gutters, outlets, boxDrains, vents, x0: sb.x0, x1: sb.x1,
  };
}

/** Losa de cielo de la caja: contorno exterior de la caja, de muroTop a losaTop. */
export const boxSlabSpan = (): [number, number] => [TECHO.caja.muroTop, TECHO.caja.losaTop];
