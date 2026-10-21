/**
 * Pintura de fachada como subcontrato: un andamio colgante (balancín) que cuelga de dos pescantes
 * con contrapeso apoyados en la losa de techumbre y baja por paños (franjas verticales del ancho
 * del balancín), una fachada a la vez, dando la vuelta al edificio.
 *
 * Solo cambia lo que se ve: en el cronograma la pintura sigue dentro de las terminaciones de cada
 * piso, pero en la escena la fachada se pinta de arriba hacia abajo a medida que baja el balancín,
 * a su propio ritmo (PINTURA en config), sin esperar a las ventanas ni a las barandas.
 *
 * Todo es función pura del tiempo T (se puede recorrer la línea de tiempo hacia adelante y atrás).
 *
 * Fachadas (normal hacia afuera, sentido de avance a lo largo de su tangente):
 *   frente       +z  de −x a +x   (surponiente, donde está la grúa)
 *   suroriente   +x  de +z a −z   (cabezal)
 *   posterior    −z  de +x a −x   (nororiente, camino de mixers)
 *   norponiente  −x  de −z a +z   (cabezal, junto al portón)
 */
import type { BuildingData } from '../data/building';
import { PINTURA, SITE } from '../config';
import { pointInPolygon, polyBounds, samplePerimeter, type V2 } from '../scene/geom';
import type { Schedule } from './schedule';

export type FacadeKey = 'frente' | 'suroriente' | 'posterior' | 'norponiente';

export interface Facade {
  key: FacadeKey;
  name: string;
  /** Artículo del nombre (para la bitácora: «a la fachada…», «al cabezal…»). */
  art: 'la' | 'el';
  /** Normal hacia afuera en planta (x, z). */
  n: V2;
  /** Eje de la tangente (coordenada que recorre la fachada). */
  axis: 'x' | 'z';
  /** Sentido de avance del balancín a lo largo de la tangente. */
  dir: 1 | -1;
}

export const FACADES: Facade[] = [
  { key: 'frente', name: 'Fachada frontal (surponiente)', art: 'la', n: [0, 1], axis: 'x', dir: 1 },
  { key: 'suroriente', name: 'Cabezal suroriente', art: 'el', n: [1, 0], axis: 'z', dir: -1 },
  { key: 'posterior', name: 'Fachada posterior (nororiente)', art: 'la', n: [0, -1], axis: 'x', dir: -1 },
  { key: 'norponiente', name: 'Cabezal norponiente', art: 'el', n: [-1, 0], axis: 'z', dir: 1 },
];

export interface Pano {
  /** Índice en el orden de trabajo (0 = primero). */
  i: number;
  facade: Facade;
  /** N° del paño dentro de su fachada (1…nOf) y total de paños de esa fachada. */
  k: number;
  nOf: number;
  /** Tramo de la tangente que cubre (s0 < s1). */
  s0: number;
  s1: number;
  /** Centro de la plataforma a lo largo de la tangente (se corre si el paño vecino sobresale). */
  c: number;
  /** Coordenada hacia afuera (p·n) de la cara más saliente del paño, en todos los pisos. */
  line: number;
  /** Coordenada hacia afuera del borde de la losa de techumbre (donde se apoyan los pescantes). */
  roof: number;
  /** Área a pintar del paño (m²). */
  area: number;
  /**
   * Cota más baja del piso de la plataforma: sobre el terreno o, si al pie del paño hay algo fijo
   * de la faena (cerco de la base de la grúa, puerta posterior del hall con la tubería de la bomba),
   * sobre ese obstáculo. Lo que queda más abajo se pinta con rodillo extensible desde la plataforma.
   */
  yMin: number;
  /** Cota donde se apoyan las colas de los cables y las cuerdas de vida (terreno u obstáculo). */
  base: number;
  /** Qué detiene la plataforma antes del terreno (null si llega abajo). */
  stopBy: string | null;
  /** Bajada pintando, subida y traslado al paño siguiente (o desmontaje), en s de simulación. */
  down: [number, number];
  up: [number, number];
  move: [number, number];
  /** Días hábiles de la bajada. */
  days: [number, number];
}

/** Cara exterior a pintar (muro H.A. de fachada o canto de losa), ya cortada por paños. */
export interface FacadePiece {
  a: V2;
  b: V2;
  y0: number;
  y1: number;
  /** Normal hacia afuera. */
  n: V2;
  pano: number;
  /** Desde cuándo existe la cara (s de simulación): 0 en los muros H.A. y losas; en la fachada
   *  liviana, cuando la levantan las terminaciones de su piso. */
  from: number;
}

export type PaintPhase = 'montaje' | 'bajando' | 'subiendo' | 'traslado' | 'cambio' | 'desmontaje';

export interface PaintState {
  phase: PaintPhase;
  /** Paño en que está (o del que sale durante un traslado o un cambio de fachada). */
  pano: Pano;
  /** Paño de destino durante un traslado o un cambio de fachada. */
  next: Pano | null;
  /** Centro de la plataforma en planta, cota de su piso y rumbo (giro en y: el +z local mira hacia afuera). */
  x: number;
  z: number;
  y: number;
  heading: number;
  /** Coordenada hacia afuera del borde de techumbre bajo los pescantes y del eje de los cables. */
  roofOut: number;
  /** Cota donde se apoyan las colas de los cables y las cuerdas de vida. */
  base: number;
  /** La línea de pintura va bajo la plataforma detenida (tramo bajo con rodillo extensible). */
  lowReach: boolean;
  cableOut: number;
  /** false mientras el equipo está desarmado (a mitad de un cambio de fachada). */
  rigged: boolean;
  /** Pintores sobre la plataforma (si no, trabajan en la techumbre junto a los pescantes). */
  onPlatform: boolean;
  /** Avance de la bajada del paño actual (0…1). */
  progress: number;
  /** Área pintada a la fecha (m²). */
  painted: number;
}

export interface PaintPlan {
  panos: Pano[];
  pieces: FacadePiece[];
  /** Área total de fachada a pintar (m²). */
  area: number;
  /** Desde cuándo la fachada se separa de las terminaciones por piso (s de simulación). */
  skinFrom: number;
  /** Montaje del equipo en la techumbre y retiro al final. */
  mount: [number, number];
  dismount: [number, number];
  /** Días hábiles de inicio y término del subcontrato. */
  dStart: number;
  dEnd: number;
  roofY: number;
  groundY: number;
  /** Estado del balancín en t (null si el subcontrato aún no parte o ya se retiró). */
  state(t: number): PaintState | null;
  paintedArea(t: number): number;
}

/** Altura mínima del piso de la plataforma sobre el terreno (los largueros quedan sobre el suelo). */
const FLOOR_MIN = 0.2;
/** Holgura entre la plataforma y lo que tenga debajo cuando se detiene sobre un obstáculo. */
const OVER = 0.3;

/**
 * Cara exterior de un muro de fachada: hacia afuera no hay losa encima (no es un balcón ni un
 * muro interior). Lo usan la piel de pintura y structure.ts (fachada liviana sin pintar).
 */
export function exteriorFaces(poly: V2[], above: V2[]): { a: V2; b: V2; n: V2 }[] {
  const out: { a: V2; b: V2; n: V2 }[] = [];
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.12) return;
    const n = outward(poly, a, b);
    if (!n) return;
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    if (pointInPolygon(mx + n[0] * 0.12, mz + n[1] * 0.12, above)) return;
    out.push({ a, b, n });
  });
  return out;
}

const dot = (p: V2, n: V2) => p[0] * n[0] + p[1] * n[1];
const tanOf = (p: V2, f: Facade) => (f.axis === 'x' ? p[0] : p[1]);
const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
const smooth = (x: number) => {
  const k = clamp01(x);
  return k * k * (3 - 2 * k);
};

/** Normal hacia afuera de la arista a→b del polígono (la que no entra en él). */
function outward(poly: V2[], a: V2, b: V2): V2 | null {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-6) return null;
  const n: V2 = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
  return pointInPolygon(mx + n[0] * 0.02, mz + n[1] * 0.02, poly) ? [-n[0], -n[1]] : n;
}

/**
 * Fachada a la que pertenece una cara: las que miran a ±z van al frente o a la posterior; las que
 * miran a ±x van al cabezal si están en el extremo del edificio y, si no (quiebres de la fachada
 * larga), al frente o a la posterior según el lado.
 */
function facadeOf(n: V2, m: V2, B: ReturnType<typeof polyBounds>): Facade {
  if (Math.abs(n[1]) >= Math.abs(n[0])) return FACADES[n[1] > 0 ? 0 : 2];
  const nearEnd = n[0] > 0 ? B.x1 - m[0] < 1.6 : m[0] - B.x0 < 1.6;
  if (nearEnd) return FACADES[n[0] > 0 ? 1 : 3];
  return FACADES[m[1] > (B.z0 + B.z1) / 2 ? 0 : 2];
}

/** Instante (s de simulación) en que el calendario llega al día hábil `day`. */
function tOfDay(sched: Schedule, day: number) {
  const acts = sched.activities;
  if (day <= acts[0].d0) return acts[0].t0;
  for (const a of acts) if (day <= a.d1) return a.t0 + ((day - a.d0) / Math.max(a.d1 - a.d0, 1e-6)) * (a.t1 - a.t0);
  return acts[acts.length - 1].t1;
}

export function buildPaintPlan(data: BuildingData, sched: Schedule): PaintPlan {
  const levels = data.levels;
  const nWall = sched.wall.length;
  const roofSlab = levels[levels.length - 1].slab;
  const roofY = roofSlab.y1;
  const gy = SITE.groundY;
  const B = polyBounds(roofSlab.outer);
  const P = PINTURA;

  // --- Paños: tramos largos (≥ 2 m) del borde de la techumbre, por fachada ------------------
  const spans: Record<FacadeKey, [number, number][]> = { frente: [], suroriente: [], posterior: [], norponiente: [] };
  const ro = roofSlab.outer;
  ro.forEach((a, i) => {
    const b = ro[(i + 1) % ro.length];
    const n = outward(ro, a, b);
    if (!n || Math.hypot(b[0] - a[0], b[1] - a[1]) < 2) return;
    const f = facadeOf(n, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], B);
    const s = [tanOf(a, f), tanOf(b, f)].sort((u, v) => u - v) as [number, number];
    spans[f.key].push(s);
  });
  // contornos donde buscar la cara más saliente de cada paño (losas de todos los pisos y muros del 1P)
  const outlines = [...levels.slice(1).map((l) => l.slab.outer), ...levels[0].walls.filter((w) => w.ha).map((w) => w.poly)];
  const samples = outlines.flatMap((o) => samplePerimeter(o, 0.2).map((s) => s.p));
  const roofSamples = samplePerimeter(ro, 0.2).map((s) => s.p);
  const panos: Pano[] = [];
  for (const f of FACADES) {
    const list = spans[f.key].sort((u, v) => u[0] - v[0]);
    const mine: Pano[] = [];
    for (const [a, b] of list) {
      const n = Math.max(1, Math.ceil((b - a) / P.anchoPano - 0.02));
      for (let k = 0; k < n; k++) {
        const s0 = a + ((b - a) * k) / n, s1 = a + ((b - a) * (k + 1)) / n;
        // (los quiebres justo en el borde del paño quedan fuera: el balancín no llega a ellos)
        const near = (p: V2) => tanOf(p, f) > s0 + 0.05 && tanOf(p, f) < s1 - 0.05 && dot(p, f.n) > dot([B.cx, B.cz], f.n);
        let line = Math.max(...samples.filter(near).map((p) => dot(p, f.n)));
        const roof = Math.max(...roofSamples.filter(near).map((p) => dot(p, f.n)));
        // la plataforma puede ser más larga que el paño: si un vecino sobresale de la fachada, se
        // corre hacia el otro lado para no toparlo (y si sobresalen los dos, cuelga por fuera)
        const half = P.plataforma.largo / 2 + 0.05;
        const lineIn = (lo: number, hi: number) => Math.max(-Infinity, ...samples
          .filter((p) => tanOf(p, f) > lo && tanOf(p, f) < hi && dot(p, f.n) > dot([B.cx, B.cz], f.n))
          .map((p) => dot(p, f.n)));
        let c = (s0 + s1) / 2;
        const hiOut = lineIn(s1 - 0.05, s0 + 2 * half) > line + 0.05;
        const loOut = lineIn(s1 - 2 * half, s0 + 0.05) > line + 0.05;
        if (hiOut && !loOut) c = s1 - half;
        else if (loOut && !hiOut) c = s0 + half;
        else if (hiOut && loOut) line = lineIn(c - half, c + half);
        mine.push({ i: 0, facade: f, k: 0, nOf: 0, s0, s1, c, line, roof, area: 0, yMin: gy + FLOOR_MIN, base: gy, stopBy: null, down: [0, 0], up: [0, 0], move: [0, 0], days: [0, 0] });
      }
    }
    if (f.dir < 0) mine.reverse();
    mine.forEach((p, k) => {
      p.k = k + 1;
      p.nOf = mine.length;
    });
    panos.push(...mine);
  }
  panos.forEach((p, i) => (p.i = i));

  // --- Obstáculos fijos de la faena al pie de la fachada ------------------------------------
  // cajas en planta (x0, x1, z0, z1) con su altura sobre el terreno; si la huella de la plataforma
  // (más una holgura) cae sobre alguna, la plataforma se detiene encima y no baja hasta el suelo
  const cr = SITE.crane, FENCE = 2.95; // semiancho del cerco de OSB (equipment/crane.ts)
  const pm = SITE.pump, pl = SITE.pipeline;
  const obstacles = [
    { name: 'el cerco de la base de la grúa', x0: cr.x - FENCE, x1: cr.x + FENCE, z0: cr.z - FENCE, z1: cr.z + FENCE, top: 2.05 },
    // caseta de la bomba: huella 7,0 × 3,6 m girada con la bomba (equipment/stationaryPump.ts)
    (() => {
      const c = Math.abs(Math.cos(pm.heading)), sn = Math.abs(Math.sin(pm.heading));
      const hx = (3.6 / 2) * c + (7.0 / 2) * sn, hz = (3.6 / 2) * sn + (7.0 / 2) * c;
      return { name: 'la caseta de la bomba', x0: pm.x - hx, x1: pm.x + hx, z0: pm.z - hz, z1: pm.z + hz, top: 2.7 };
    })(),
    // puerta posterior del hall, por donde entra la tubería de la bomba: queda libre bajo el balancín
    { name: 'la puerta posterior del hall (tubería de la bomba)', x0: pl.door.x0 - 0.15, x1: pl.door.x1 + 0.15, z0: pm.z, z1: pl.zDoor + 0.5, top: pl.door.h },
  ];
  {
    const W = P.plataforma.ancho, half = P.plataforma.largo / 2 + 0.1;
    for (const p of panos) {
      const f = p.facade;
      const o0 = p.line + P.holgura - 0.1, o1 = p.line + P.holgura + W + 0.1;
      const [ta, tb] = [p.c - half, p.c + half];
      const os = [o0 * (f.axis === 'x' ? f.n[1] : f.n[0]), o1 * (f.axis === 'x' ? f.n[1] : f.n[0])].sort((u, v) => u - v);
      const [x0, x1, z0, z1] = f.axis === 'x' ? [ta, tb, os[0], os[1]] : [os[0], os[1], ta, tb];
      for (const ob of obstacles) {
        if (ob.x1 <= x0 || ob.x0 >= x1 || ob.z1 <= z0 || ob.z0 >= z1) continue;
        const y = gy + ob.top + OVER;
        if (y > p.yMin) [p.yMin, p.base, p.stopBy] = [y, gy + ob.top, ob.name];
      }
    }
  }
  const panosOf = (f: Facade) => panos.filter((p) => p.facade === f);
  /** Paño de la fachada f que contiene la tangente s (o el más cercano). */
  const panoAt = (f: Facade, s: number) => {
    let best = panosOf(f)[0], dBest = Infinity;
    for (const p of panosOf(f)) {
      const d = s < p.s0 ? p.s0 - s : s > p.s1 ? s - p.s1 : 0;
      if (d < dBest) [best, dBest] = [p, d];
    }
    return best;
  };

  // --- Caras a pintar: muros H.A. de fachada (cara exterior) y cantos de losa ---------------
  const pieces: FacadePiece[] = [];
  const door = SITE.pipeline.door;
  const addFace = (a: V2, b: V2, y0: number, y1: number, n: V2, L: number, from = 0) => {
    const m: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const f = facadeOf(n, m, B);
    // corte en los bordes de los paños de la fachada (y en el vano de la puerta posterior del hall)
    const ta = tanOf(a, f), tb = tanOf(b, f);
    const cuts = [0, 1];
    if (Math.abs(tb - ta) > 1e-4) {
      const marks = panosOf(f).flatMap((p) => [p.s0, p.s1]);
      if (L === 0 && f.key === 'posterior' && Math.abs(dot(m, f.n) + SITE.pipeline.zDoor) < 0.6) marks.push(door.x0, door.x1);
      for (const s of marks) {
        const k = (s - ta) / (tb - ta);
        if (k > 1e-3 && k < 1 - 1e-3) cuts.push(k);
      }
    }
    cuts.sort((u, v) => u - v);
    for (let c = 0; c + 1 < cuts.length; c++) {
      const pa: V2 = [a[0] + (b[0] - a[0]) * cuts[c], a[1] + (b[1] - a[1]) * cuts[c]];
      const pb: V2 = [a[0] + (b[0] - a[0]) * cuts[c + 1], a[1] + (b[1] - a[1]) * cuts[c + 1]];
      const sm = (tanOf(pa, f) + tanOf(pb, f)) / 2;
      let yy0 = y0;
      // sobre el vano de la puerta solo queda el dintel
      if (L === 0 && f.key === 'posterior' && sm > door.x0 && sm < door.x1 && Math.abs(dot(m, f.n) + SITE.pipeline.zDoor) < 0.6) yy0 = door.h;
      if (y1 - yy0 > 0.01) pieces.push({ a: pa, b: pb, y0: yy0, y1, n, pano: panoAt(f, sm).i, from });
    }
  };
  for (let L = 0; L < nWall; L++) {
    const above = levels[L + 1].slab.outer;
    // la fachada liviana (no H.A.) aparece con las terminaciones de su piso, sin pintar: también
    // la pinta el balancín (structure.ts la levanta en el color del hormigón visto)
    const [f0, f1] = sched.finish[L];
    for (const w of levels[L].walls) {
      if (w.cat !== 'fachada') continue;
      for (const { a, b, n } of exteriorFaces(w.poly, above)) addFace(a, b, w.y0, w.y1, n, L, w.ha ? 0 : f0 + (f1 - f0) * 0.7);
    }
  }
  for (let S = 1; S < levels.length; S++) {
    const sl = levels[S].slab;
    sl.outer.forEach((a, i) => {
      const b = sl.outer[(i + 1) % sl.outer.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.08) return;
      const n = outward(sl.outer, a, b);
      if (n) addFace(a, b, sl.y0, sl.y1, n, S);
    });
  }
  for (const pc of pieces) panos[pc.pano].area += Math.hypot(pc.b[0] - pc.a[0], pc.b[1] - pc.a[1]) * (pc.y1 - pc.y0);
  const area = panos.reduce((s, p) => s + p.area, 0);

  // --- Calendario del subcontrato --------------------------------------------------------
  // parte cuando la obra gruesa terminó arriba: hormigonada la losa de techumbre y retirada la
  // bandeja en ménsulas del último piso (structure.ts: fin del hormigonado + 2,5 s, dura 1 s)
  const tGruesa = sched.slab[nWall].pour[1] + 3.6;
  const dStart = sched.dayAt(tGruesa);
  const lastFinish = sched.finish[sched.finish.length - 1];
  const dLimit = sched.dayAt(lastFinish[1]) - 3;
  const downDays = panos.map((p) => Math.max(0.5, (p.area * P.manos) / P.rendimiento));
  const moveDays = panos.map((p, i) => (i + 1 < panos.length ? (panos[i + 1].facade === p.facade ? P.trasladoDias : P.cambioFachadaDias) : P.desmontajeDias));
  const total = P.montajeDias + downDays.reduce((s, d) => s + d, 0) + moveDays.reduce((s, d) => s + d, 0);
  // si no cupiera antes del término de la obra, el subcontrato refuerza la cuadrilla (mismo orden, más rápido)
  const k = Math.min(1, (dLimit - dStart) / total);
  const upDays = 0.15; // subir el balancín vacío con los huinches (minutos en la realidad)
  let d = dStart + P.montajeDias * k;
  const mount: [number, number] = [tGruesa, tOfDay(sched, d)];
  panos.forEach((p, i) => {
    const d0 = d, d1 = d0 + downDays[i] * k;
    const u1 = d1 + Math.min(upDays, moveDays[i] * 0.3) * k;
    const m1 = d1 + moveDays[i] * k;
    p.days = [d0, d1];
    p.down = [tOfDay(sched, d0), tOfDay(sched, d1)];
    p.up = [p.down[1], tOfDay(sched, u1)];
    p.move = [p.up[1], tOfDay(sched, m1)];
    d = m1;
  });
  const last = panos[panos.length - 1];
  const dismount: [number, number] = [last.move[0], last.move[1]];

  const W = P.plataforma.ancho;
  const cableOff = P.holgura + W / 2;
  const topFloor = roofY - P.alcance + 0.1; // piso de la plataforma arriba, con la baranda bajo el borde de la losa
  const headingOf = (f: Facade) => Math.atan2(f.n[0], f.n[1]);
  /** Centro de la plataforma en planta para la tangente s y la coordenada hacia afuera o. */
  const xz = (f: Facade, s: number, o: number): V2 => (f.axis === 'x' ? [s, o * f.n[1]] : [o * f.n[0], s]);

  const paintedArea = (t: number) => panos.reduce((s, p) => s + p.area * clamp01((t - p.down[0]) / (p.down[1] - p.down[0])), 0);

  const rest = (p: Pano, phase: PaintPhase, y: number, onPlatform: boolean, progress: number, t: number, next: Pano | null = null): PaintState => {
    const [x, z] = xz(p.facade, p.c, p.line + cableOff);
    return {
      phase, pano: p, next, x, z, y, heading: headingOf(p.facade), roofOut: p.roof, cableOut: p.line + cableOff,
      base: p.base, lowReach: false, rigged: true, onPlatform, progress, painted: paintedArea(t),
    };
  };

  const state = (t: number): PaintState | null => {
    if (t < mount[0] || t > dismount[1]) return null;
    if (t < panos[0].down[0]) return rest(panos[0], 'montaje', topFloor, false, 0, t);
    for (const p of panos) {
      if (t > p.move[1]) continue;
      if (t <= p.down[1]) {
        const k = clamp01((t - p.down[0]) / (p.down[1] - p.down[0]));
        // la línea de pintura baja de la techumbre al terreno; el piso va bajo ella (alcance del rodillo)
        // (si la plataforma se detuvo sobre un obstáculo, el tramo bajo sigue con rodillo extensible)
        const line = roofY - (roofY - gy) * k;
        const s = rest(p, 'bajando', Math.max(line - P.alcance, p.yMin), true, k, t);
        s.lowReach = line < s.y + 0.2;
        return s;
      }
      if (t <= p.up[1]) {
        const k = smooth((t - p.up[0]) / Math.max(p.up[1] - p.up[0], 1e-6));
        return rest(p, 'subiendo', p.yMin + (topFloor - p.yMin) * k, true, 1, t);
      }
      const nx = p.i + 1 < panos.length ? panos[p.i + 1] : null;
      const k = clamp01((t - p.move[0]) / Math.max(p.move[1] - p.move[0], 1e-6));
      if (!nx) return rest(p, 'desmontaje', topFloor, false, 1, t);
      if (nx.facade !== p.facade) {
        // cambio de fachada: se desarma, se lleva por la techumbre y se vuelve a armar en la otra
        const s = rest(k < 0.5 ? p : nx, 'cambio', topFloor, false, 1, t, nx);
        s.pano = p;
        s.rigged = k < 0.32 || k > 0.68;
        return s;
      }
      // traslado en la misma fachada: si el paño siguiente sale más, primero se separa y luego
      // corre; si entra, primero corre y después se acerca (así no topa los quiebres de la fachada)
      const f = p.facade;
      const sa = p.c, sb = nx.c;
      const oa = p.line + cableOff, ob = nx.line + cableOff;
      const ko = ob > oa ? smooth(k / 0.3) : smooth((k - 0.7) / 0.3);
      const ks = smooth((k - 0.3) / 0.4);
      const o = oa + (ob - oa) * ko;
      const [x, z] = xz(f, sa + (sb - sa) * ks, o);
      return {
        phase: 'traslado', pano: p, next: nx, x, z, y: topFloor, heading: headingOf(f),
        roofOut: p.roof + (nx.roof - p.roof) * ks, cableOut: o, base: Math.max(p.base, nx.base), lowReach: false, rigged: true, onPlatform: false, progress: 1, painted: paintedArea(t),
      };
    }
    return rest(last, 'desmontaje', topFloor, false, 1, t);
  };

  return {
    panos, pieces, area,
    // la fachada se separa de las terminaciones por piso cuando estas empiezan
    skinFrom: sched.finish[0][0] - 0.02,
    mount, dismount, dStart, dEnd: sched.dayAt(dismount[1]),
    roofY, groundY: gy, state, paintedArea,
  };
}
