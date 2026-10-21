/**
 * Fundaciones del Edificio E en el tiempo (actividad `fundaciones`, 40 días hábiles): trazado,
 * excavación en zanjas con excavadora y camiones tolva, perfilado y recepción de sellos,
 * emplantillado con capacho, enfierradura de zapatas y esperas, moldaje de costados y pollos,
 * hormigonado de cada sector con la bomba estacionaria, muros bajo NPT y V.S.C. con capacho,
 * descimbre, impermeabilización (Igol) y relleno lateral compactado.
 *
 * Avanza en 3 sectores en tren (juntas de hormigonado en x = −8,9 y x = 9,4) según la carta Gantt de
 * la especificación (planos E-01/E-02). Todo es función pura del tiempo de simulación: la escena,
 * la grúa, la logística y las cuadrillas leen de aquí los mismos horarios.
 *
 * Días: el día hábil d (1..40) ocupa [T(d − 1), T(d)]; cada día dura según lo que pasa en él
 * (FUND_PACE), así la excavación y los hormigonados se alcanzan a ver.
 */
import { FUND_PACE, SITE } from '../config';
import type { FootingStrip, FundData, WallData } from '../data/building';
import { Route, easeTravel, type Pose } from './paths';
import { LB_S, RZ, arc, arrival, line, reverseToLayby, shift, type P } from './roads';
import { polyBounds, type V2 } from '../scene/geom';

export type Win = [number, number];
type P3 = { x: number; y: number; z: number };

/** Zona de excavación de cada sello (E-01): fondo, sobreancho por lado y talud 3:1 si pasa de 1,20 m. */
export interface ExcZone {
  sello: number;
  fondoY: number;
  off: number;
  /** Ensanche horizontal del borde respecto del fondo (0 = paredes verticales). */
  talud: number;
}

/** Trozo de zanja que la excavadora abre de una vez (franja partida a lo largo de su eje). */
export interface ExcCell {
  id: number;
  franja: FootingStrip;
  sector: number;
  /** Rectángulo del fondo de excavación. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  fondoY: number;
  talud: number;
  cx: number;
  cz: number;
  vol: number;
  phase: 'A' | 'B' | 'C';
  /** Ventana en que se excava (la superficie baja del terreno al fondo). */
  dig: Win;
  station: number;
}

/** Puesto de la excavadora: desde ahí abre sus celdas y carga el camión detenido en `truck`. */
export interface ExcStation {
  x: number;
  z: number;
  sector: number;
  phase: 'A' | 'B' | 'C';
  cells: ExcCell[];
  dig: Win;
  /** Pose del camión tolva mientras se carga desde este puesto y centro de su tolva. */
  truck: Pose & { kind: 'lane' | 'inner' };
  bed: { x: number; z: number };
}

export interface TruckLeg {
  route: Route;
  t: Win;
  back: boolean;
}

/** Camión tolva de 14 m³ que se carga en un sector (uno por sector en la animación). */
export interface TruckVisit {
  id: number;
  sector: number;
  legs: TruckLeg[];
  arrive: Win;
  leave: Win;
  /** Si espera en el bolsón a que salga el camión del sector anterior. */
  waitFrom: number | null;
  gateIn: number;
  /** Volumen del sector (m³ en sitio) y cuándo se carga (para el llenado de la tolva). */
  cells: ExcCell[];
}

export interface TruckState {
  id: number;
  pose: Pose;
  dist: number;
  /** Llenado de la tolva (0..1). */
  load: number;
  loading: boolean;
}

export interface ExcavatorState {
  visible: boolean;
  x: number;
  z: number;
  /** Rumbo del tren de orugas (atan2(dz, dx)). */
  heading: number;
  /** Rumbo de la tornamesa (hacia la punta del balde). */
  slew: number;
  /** Punta del balde: distancia horizontal al eje de giro y cota (mundo). */
  r: number;
  y: number;
  /** 0 = balde recogido (cargado), 1 = abierto (descargando). */
  curl: number;
  /** Tierra en el balde. */
  load: boolean;
  moving: boolean;
  task: string;
  /** Distancia recorrida (para las orugas). */
  dist: number;
}

/** Serie de capachos (emplantillado, muros bajo NPT o V.S.C.): un mixer en el camino posterior. */
export interface CapachoSeries {
  t0: number;
  t1: number;
  trips: { t0: number; t1: number; walls: number[]; x: number; y: number; z: number }[];
  task: string;
  what: 'emplantillado' | 'murosNPT' | 'vsc';
  sector: number;
}

export interface CraneTripF {
  t0: number;
  t1: number;
  kind: 'rebar' | 'panel';
  x: number;
  y: number;
  z: number;
  task: string;
}

/** Hormigonado de un sector con la bomba estacionaria y un mixer (sin cambio de camión). */
export interface FundPour {
  sector: number;
  pour: Win;
  pumpStop: Win;
}

/** Tiempos de cada franja. */
export interface StripTiming {
  franja: FootingStrip;
  empl: Win;
  fierro: Win;
  moldaje: Win;
  pour: Win;
  /** Descimbre de los costados (los tableros suben y salen). */
  strip: Win;
  igol: Win;
  fill: Win;
}

/** Muro del 1P sobre una franja (muro ∩ franja): pollo (0,16 m) o muro bajo NPT (escalones de sello). */
export interface WallPiece {
  poly: V2[];
  franja: FootingStrip;
  /** Muro alto bajo NPT (A-B, eje A, escalón, núcleo) que se hormigona aparte con capacho. */
  deep: boolean;
  y0: number;
  /** Eje largo del trozo (centro, dirección y largo) para las esperas y los moldajes. */
  axis: { cx: number; cz: number; ux: number; uz: number; len: number; w: number };
  fierro: Win;
  forms: Win;
  pour: Win;
  strip: Win;
}

export interface SectorPlan {
  n: number;
  x0: number;
  x1: number;
  exc: Win;
  perfil: Win;
  recep: Win;
  empl: CapachoSeries;
  fierro: Win;
  moldaje: Win;
  pour: FundPour;
  desc: Win;
  npt: { fierro: Win; cap: CapachoSeries; strip: Win } | null;
  igol: Win;
  relleno: Win;
  /** Hormigón de zapatas (m³) y fierro (kg con 5 %) del sector. */
  m3: number;
  kg: number;
  moldajeM2: number;
}

export interface CrewFront {
  pts: [number, number, number][];
  n: number;
  action: 'work' | 'walk' | 'idle' | 'carry';
  label: string;
}

export interface FundStep {
  key: string;
  label: string;
  win: Win;
}

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const k01 = (t: number, [a, b]: Win) => clamp01((t - a) / Math.max(b - a, 1e-6));
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/** Juntas de hormigonado entre sectores (E-01). */
export const SECTOR_X = [-8.9, 9.4];
export const sectorOfX = (x: number) => (x < SECTOR_X[0] ? 1 : x < SECTOR_X[1] ? 2 : 3);

/** Cota visual de la plataforma (terreno de la app). */
const PLAT = SITE.groundY;

/** Carta Gantt por sector (días hábiles, 1..40; ver especificación §5.2). */
type D2 = readonly [number, number];
interface GanttRow { exc: D2; perfil: D2; recep: D2; empl: number; fierro: D2; moldaje: D2; pour: number; desc: D2; npt: { fierro: D2; cap: number; strip: D2 } | null; igol: D2; relleno: D2 }
const GANTT: GanttRow[] = [
  { exc: [4, 6], perfil: [6.4, 7], recep: [7, 7], empl: 8, fierro: [9, 13], moldaje: [12, 14], pour: 15, desc: [17, 17], npt: { fierro: [16, 17], cap: 18, strip: [19, 19] }, igol: [19, 19], relleno: [20, 21] },
  { exc: [7, 9], perfil: [10, 10], recep: [10, 10], empl: 11, fierro: [14, 19], moldaje: [18, 21], pour: 22, desc: [23, 23], npt: { fierro: [23, 23], cap: 24, strip: [25, 25] }, igol: [25, 25], relleno: [26, 27] },
  { exc: [10, 12], perfil: [13, 13], recep: [13, 13], empl: 14, fierro: [20, 25], moldaje: [24, 27], pour: 28, desc: [29, 29], npt: null, igol: [30, 30], relleno: [31, 33] },
];

/** Segundos de simulación de cada día hábil (1..40). */
function dayWeights(): number[] {
  const w: number[] = [];
  const cap = new Set(GANTT.flatMap((g) => [g.empl, g.npt?.cap ?? -1]));
  const pump = new Set(GANTT.map((g) => g.pour));
  for (let d = 1; d <= 40; d++) {
    let s = FUND_PACE.dia;
    if (d <= 3) s = FUND_PACE.trazado;
    else if (d <= 12) s = FUND_PACE.excavacion;
    else if (d === 13) s = FUND_PACE.trazado;
    else if (d >= 34) s = FUND_PACE.cierre;
    if (cap.has(d)) s = Math.max(s, FUND_PACE.capacho);
    if (pump.has(d)) s = FUND_PACE.bomba;
    w.push(s);
  }
  return w;
}

// ---------------------------------------------------------------------------------------
// Geometría auxiliar
// ---------------------------------------------------------------------------------------

/** Recorte de un polígono (cualquiera) contra un rectángulo (Sutherland–Hodgman). */
export function clipRect(poly: V2[], x0: number, z0: number, x1: number, z1: number): V2[] {
  let out = poly;
  const edges: [(p: V2) => number, (a: V2, b: V2) => V2][] = [
    [(p) => p[0] - x0, (a, b) => [x0, a[1] + ((x0 - a[0]) / (b[0] - a[0])) * (b[1] - a[1])]],
    [(p) => x1 - p[0], (a, b) => [x1, a[1] + ((x1 - a[0]) / (b[0] - a[0])) * (b[1] - a[1])]],
    [(p) => p[1] - z0, (a, b) => [a[0] + ((z0 - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), z0]],
    [(p) => z1 - p[1], (a, b) => [a[0] + ((z1 - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), z1]],
  ];
  for (const [inside, cut] of edges) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i], b = src[(i + 1) % src.length];
      const ia = inside(a) >= 0, ib = inside(b) >= 0;
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut(a, b));
    }
    if (out.length < 3) return [];
  }
  return out;
}

function polyArea(p: V2[]) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, z0] = p[i], [x1, z1] = p[(i + 1) % p.length];
    a += x0 * z1 - x1 * z0;
  }
  return Math.abs(a) / 2;
}

/** Ventanas consecutivas (con traslapo `lap` de cada una) repartidas por peso dentro de [A, B]. */
function seq<T>(items: T[], weight: (x: T) => number, [A, B]: Win, lap = 0): Win[] {
  const tot = items.reduce((s, x) => s + weight(x), 0) || 1;
  let c = 0;
  return items.map((x) => {
    const a = A + (c / tot) * (B - A);
    c += weight(x);
    const b = A + (c / tot) * (B - A);
    return [Math.max(A, a - (b - a) * lap), b] as Win;
  });
}

// ---------------------------------------------------------------------------------------
// Camino de los camiones tolva (huella de carguío junto a la fachada posterior)
// ---------------------------------------------------------------------------------------

const EX = SITE.excavacion;
/** Eje z de la huella de carguío en x (se corre hacia el edificio frente a la caseta de la bomba). */
export function laneZ(x: number) {
  const P = SITE.pump.x;
  const k = smooth((x - (P - 7.5)) / 2.5) * (1 - smooth((x - (P + 5.5)) / 2.5));
  return EX.laneZ + (EX.laneZPump - EX.laneZ) * k;
}
const laneLine = (xa: number, xb: number): P[] => {
  const n = Math.max(1, Math.ceil(Math.abs(xb - xa) / 1.5));
  return Array.from({ length: n + 1 }, (_, i) => {
    const x = xa + ((xb - xa) * i) / n;
    return [x, laneZ(x)] as P;
  });
};
/** Del camino a la huella (o vuelta): S suave entre x = entryX − 8 (camino) y entryX (huella). */
const ROAD_TO_LANE = (): P[] => shift([EX.entryX - 8, RZ], [EX.entryX, laneZ(EX.entryX)]);
/** Largo en x de la S para entrar a la plataforma por la franja de los peines posteriores. */
const INNER_S = 8;
/** Tolva del camión: centro a 1,85 m detrás del centro del camión (hacia la trasera). */
export const TRUCK_BED = 1.85;
/** Rapidez media en la obra (reposicionarse entre puestos), en retroceso desde el portón y al salir. */
const V_SITE = 7, V_BACK = 17, V_OUT = 21, V_STREET = 18;
const dur = (r: Route, v: number) => 0.45 + r.length / v;
/** Ruta por puntos sin repetidos consecutivos (el Catmull-Rom no admite dos puntos iguales). */
function R(pts: P[], back = false) {
  const q: P[] = [];
  for (const p of pts) if (!q.length || Math.hypot(p[0] - q[q.length - 1][0], p[1] - q[q.length - 1][1]) > 0.02) q.push(p);
  if (q.length === 1) q.push([q[0][0] + 0.03, q[0][1]]);
  return new Route().add(q, back);
}

function travel(route: Route, t: number, [t0, t1]: Win) {
  const u = easeTravel((t - t0) / (t1 - t0));
  const s = u * route.length;
  return { pose: route.at(s), s };
}

// ---------------------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------------------

export interface FundPlan {
  data: FundData;
  t0: number;
  t1: number;
  /** Instante en que se cumplen d días hábiles (d fraccional, 0..40). */
  T(d: number): number;
  /** Días hábiles transcurridos en el instante t (0..40). */
  dayAt(t: number): number;
  zones: Map<number, ExcZone>;
  cells: ExcCell[];
  stations: ExcStation[];
  trucks: TruckVisit[];
  sectors: SectorPlan[];
  strips: StripTiming[];
  pieces: WallPiece[];
  capachos: CapachoSeries[];
  craneTrips: CraneTripF[];
  pours: FundPour[];
  trazado: Win;
  compactacion: Win;
  replanteo: Win;
  /** Ventana de excavación de la excavadora en obra (llega y se retira). */
  excavatorOnSite: Win;
  steps: FundStep[];
  excavator(t: number): ExcavatorState;
  truckStates(t: number): TruckState[];
  /** Punto donde cae el hormigón de la manguera en el hormigonado del sector (k = avance 0..1). */
  pourPoint(sector: number, k: number): P3;
  /** Frentes de trabajo con su cuadrilla en el instante t. */
  fronts(t: number): CrewFront[];
  /** Qué se está haciendo (para el tablero). */
  describe(t: number): string;
  focus(t: number): P3;
  /** Avance de cantidades de la cubicación (hormigón m³, acero kg, moldaje m²). */
  quantities(t: number): { hormigon: number; acero: number; moldaje: number; capachos: number };
}

export function buildFundPlan(f: FundData, t0: number, walls1P: WallData[]): FundPlan {
  // --- días ---
  const w = dayWeights();
  const cum = [0];
  for (const x of w) cum.push(cum[cum.length - 1] + x);
  const T = (d: number) => {
    const dd = Math.min(Math.max(d, 0), 40);
    const i = Math.min(Math.floor(dd), 39);
    return t0 + cum[i] + (dd - i) * w[i];
  };
  const dayAt = (t: number) => {
    const s = t - t0;
    if (s <= 0) return 0;
    for (let i = 0; i < 40; i++) if (s < cum[i + 1]) return i + (s - cum[i]) / w[i];
    return 40;
  };
  const span = (a: number, b: number): Win => [T(a - 1), T(b)];
  const t1 = T(40);

  // --- zonas de sello ---
  const zones = new Map<number, ExcZone>();
  for (const e of f.excavacion) {
    const H = PLAT - e.fondoY;
    zones.set(e.sello, { sello: e.sello, fondoY: e.fondoY, off: e.off, talud: e.talud.startsWith('vert') ? 0 : H / 3 });
  }
  const zoneOf = (s: number) => zones.get(s) ?? { sello: s, fondoY: s - 0.05, off: 0.38, talud: 0 };

  // --- celdas de excavación ---
  const cells: ExcCell[] = [];
  for (const fr of f.franjas) {
    const z = zoneOf(fr.sello);
    const X0 = fr.x0 - z.off, X1 = fr.x1 + z.off, Z0 = fr.z0 - z.off, Z1 = fr.z1 + z.off;
    const along = fr.eje === 'x' ? X1 - X0 : Z1 - Z0;
    const n = Math.max(1, Math.round(along / 1.8));
    for (let i = 0; i < n; i++) {
      const a = i / n, b = (i + 1) / n;
      const r = fr.eje === 'x'
        ? { x0: X0 + a * (X1 - X0), x1: X0 + b * (X1 - X0), z0: Z0, z1: Z1 }
        : { x0: X0, x1: X1, z0: Z0 + a * (Z1 - Z0), z1: Z0 + b * (Z1 - Z0) };
      const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
      const H = PLAT - z.fondoY;
      const A = (r.x1 - r.x0) * (r.z1 - r.z0), At = (r.x1 - r.x0 + 2 * z.talud) * (r.z1 - r.z0 + 2 * z.talud);
      cells.push({
        id: cells.length, franja: fr, sector: fr.sector, ...r, fondoY: z.fondoY, talud: z.talud, cx, cz,
        vol: (H * (A + At + Math.sqrt(A * At))) / 3,
        phase: cz > 2.4 ? 'A' : cz > -1.85 ? 'B' : 'C', dig: [0, 0], station: -1,
      });
    }
  }

  // --- puestos de la excavadora (por sector: frente, pasillo y peines posteriores) ---
  const R_DIG = 7.6;
  const STATION_Z = { A: 2.8, B: -4.2, C: -4.2 };
  const DIR = { A: 1, B: -1, C: 1 };
  const FOOT = 2.35; // media huella de la excavadora (orugas y giro de la cola)
  const hits = (sx: number, sz: number, c: ExcCell) =>
    sx + FOOT > c.x0 - c.talud && sx - FOOT < c.x1 + c.talud && sz + FOOT > c.z0 - c.talud && sz - FOOT < c.z1 + c.talud;
  const stations: ExcStation[] = [];
  const dug: ExcCell[] = [];
  const sectorRange = (n: number): Win => (n === 1 ? [-40, SECTOR_X[0]] : n === 2 ? [SECTOR_X[0], SECTOR_X[1]] : [SECTOR_X[1], 40]);
  for (const sn of [1, 2, 3]) {
    const xa = sn === 1 ? EX.entryX : sectorRange(sn)[0];
    for (const ph of ['A', 'B', 'C'] as const) {
      const pend = cells.filter((c) => c.sector === sn && c.phase === ph).sort((a, b) => DIR[ph] * (a.cx - b.cx) || a.cz - b.cz);
      while (pend.length) {
        const c0 = pend[0];
        let best: { x: number; z: number } | null = null;
        const offs = [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 2.5, -2.5, 3, -3, 3.5, -3.5, 4, -4];
        search: for (const dz of [0, 0.7, -0.7, 1.4, -1.4]) {
          for (const dx of offs) {
            const sx = c0.cx + DIR[ph] * 1.5 + dx, sz = STATION_Z[ph] + dz;
            if (Math.hypot(c0.cx - sx, c0.cz - sz) > R_DIG) continue;
            if (hits(sx, sz, c0) || dug.some((c) => hits(sx, sz, c))) continue;
            best = { x: sx, z: sz };
            break search;
          }
        }
        best ??= { x: c0.cx + DIR[ph] * 1.5, z: STATION_Z[ph] };
        const group = pend.filter((c) => c === c0 || (Math.hypot(c.cx - best!.x, c.cz - best!.z) <= R_DIG && !hits(best!.x, best!.z, c) && Math.abs(c.cx - c0.cx) <= 7));
        for (const c of group) pend.splice(pend.indexOf(c), 1);
        dug.push(...group);
        // camión: en la plataforma (frente) o en la huella de carguío (pasillo y peines)
        const inner = ph === 'A';
        const xMin = inner ? xa + INNER_S + 0.3 : EX.entryX + 1;
        const tx = Math.max(best.x - TRUCK_BED, xMin);
        const tz = inner ? EX.innerZ : laneZ(tx);
        stations.push({
          x: best.x, z: best.z, sector: sn, phase: ph, cells: group, dig: [0, 0],
          truck: { x: tx, z: tz, heading: Math.PI, kind: inner ? 'inner' : 'lane' },
          bed: { x: tx + TRUCK_BED, z: tz },
        });
        group.forEach((c) => (c.station = stations.length - 1));
      }
    }
  }

  // --- tiempos de la excavación: excavadora y camiones tolva ---
  type ExSeg =
    | { t: Win; kind: 'park'; x: number; z: number; heading: number; task: string }
    | { t: Win; kind: 'travel'; route: Route; task: string; d0: number }
    | { t: Win; kind: 'dig'; st: ExcStation; heading: number; x: number; z: number };
  const exSegs: ExSeg[] = [];
  const P0 = EX.park0, P1 = EX.park1;
  const excRoute = (a: { x: number; z: number }, b: { x: number; z: number }) => R(line([a.x, a.z], [b.x, b.z], 1.5));
  const V_EXC = 4.2;
  let exDist = 0;
  const pushTravel = (a: { x: number; z: number }, b: { x: number; z: number }, tA: number, tB: number, task: string) => {
    if (Math.hypot(b.x - a.x, b.z - a.z) < 0.05) return;
    const route = excRoute(a, b);
    exSegs.push({ t: [tA, tB], kind: 'travel', route, task, d0: exDist });
    exDist += route.length;
  };
  // trazado y escarpe (días 1 a 3): la excavadora deja la plataforma a −0,20 en el sector 1
  const first = stations[0];
  exSegs.push({ t: [t0, T(1)], kind: 'park', x: P0.x, z: P0.z, heading: 0, task: 'Excavadora en obra (llegó en cama baja)' });
  const esc1 = { x: -21, z: 4.2 }, esc2 = { x: -12, z: 4.2 };
  pushTravel(P0, esc1, T(1), T(2), 'Escarpe y plataforma a −0,20 (retiro de capa vegetal)');
  pushTravel(esc1, esc2, T(2), T(2.6), 'Escarpe y plataforma a −0,20 (retiro de capa vegetal)');
  pushTravel(esc2, first, T(2.6), T(3) - 0.05, 'Se instala en el sector 1');

  // camiones: rutas de cada sector
  const trucks: TruckVisit[] = [];
  /** Tramos entre dos detenciones del camión (cambios de sentido = tramos separados). */
  const moveLegs = (a: ExcStation['truck'], b: ExcStation['truck'], xa: number): { route: Route; back: boolean }[] => {
    const out: { route: Route; back: boolean }[] = [];
    const xe = xa + INNER_S;
    const along = (pts: P[], back: boolean) => {
      if (pts.length >= 2 && Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]) > 0.05) out.push({ route: R(pts, back), back });
    };
    if (a.kind === b.kind) {
      const pts = a.kind === 'inner' ? line([a.x, a.z], [b.x, b.z], 1.5) : laneLine(a.x, b.x);
      along(pts, b.x > a.x);
    } else if (a.kind === 'inner' && b.kind === 'lane') {
      // sale de frente de la plataforma a la huella y retrocede (o avanza) hasta el puesto
      along([...line([a.x, a.z], [xe, EX.innerZ], 1.5), ...shift([xe, EX.innerZ], [xa, laneZ(xa)]).slice(1)], false);
      along(laneLine(xa, b.x), b.x > xa);
    } else {
      along(laneLine(a.x, xa), xa > a.x);
      along([...shift([xa, laneZ(xa)], [xe, EX.innerZ]), ...line([xe, EX.innerZ], [b.x, b.z], 1.5).slice(1)], true);
    }
    return out;
  };
  /** Salida de frente desde la huella: hasta el camino, el portón y la calle. */
  const exitRoute = (from: ExcStation['truck']) => {
    const G = SITE.gate;
    const LANE_OUT = SITE.street.x - SITE.street.width / 4 + 0.35, R_OUT = G.x - LANE_OUT;
    const pts: P[] = [
      ...laneLine(from.x, EX.entryX),
      ...ROAD_TO_LANE().reverse().slice(1),
      ...line([EX.entryX - 8, RZ], [G.x, RZ]).slice(1),
      ...arc([G.x, RZ + R_OUT], R_OUT, -Math.PI / 2, -Math.PI).slice(1),
      ...line([LANE_OUT, RZ + R_OUT], [LANE_OUT, RZ + 52], 6).slice(1),
    ];
    return R(pts);
  };
  const LBp = SITE.layby;
  const LB_IN = LBp.x - 4 - LB_S;
  const streetLeg = () => arrival();
  let exPos: { x: number; z: number } = first;
  let prevExit: { route: Route; t: Win } | null = null;
  const sectors: SectorPlan[] = [];
  for (const sn of [1, 2, 3]) {
    const g = GANTT[sn - 1];
    const E: Win = span(g.exc[0], g.exc[1]);
    const sts = stations.filter((s) => s.sector === sn);
    const xa = sn === 1 ? EX.entryX : sectorRange(sn)[0];
    // llegada del camión al primer puesto
    const legs: TruckLeg[] = [];
    let startDig: number;
    let waitFrom: number | null = null;
    let gateIn: number;
    const firstStop = sts[0].truck;
    const entryToFirst = (fromLane: P[]): P[] => {
      const tail = firstStop.kind === 'inner'
        ? [...laneLine(fromLane[fromLane.length - 1][0], xa).slice(1), ...shift([xa, laneZ(xa)], [xa + INNER_S, EX.innerZ]).slice(1), ...line([xa + INNER_S, EX.innerZ], [firstStop.x, firstStop.z], 1.5).slice(1)]
        : laneLine(fromLane[fromLane.length - 1][0], firstStop.x).slice(1);
      return [...fromLane, ...tail];
    };
    if (!prevExit) {
      // primer camión: de la calle en retroceso por el portón y el camino hasta su puesto
      const LANE_IN = SITE.street.x + SITE.street.width / 4, R_IN = 8;
      const back = R(entryToFirst([
        ...arc([LANE_IN + R_IN, RZ - R_IN], R_IN, Math.PI, Math.PI / 2),
        ...line([LANE_IN + R_IN, RZ], [EX.entryX - 8, RZ]).slice(1),
        ...ROAD_TO_LANE().slice(1),
      ]), true);
      startDig = E[0];
      gateIn = startDig - dur(back, V_BACK);
      const st = streetLeg();
      legs.push({ route: st, t: [gateIn - 0.25 - dur(st, V_STREET), gateIn - 0.25], back: false }, { route: back, t: [gateIn, startDig], back: true });
    } else {
      // espera en el bolsón a que pase el camión del sector anterior y retrocede hasta su puesto
      const toLb = reverseToLayby();
      const fromLb = R(entryToFirst([...shift([LBp.x, LBp.z], [LBp.x + 12, laneZ(LBp.x + 12)])]), true);
      // instante en que el que sale ya pasó el bolsón (su trasera más allá de la entrada de la S)
      const pe = prevExit;
      let clear = pe.t[1];
      for (let s = 0; s <= pe.route.length; s += 0.5) {
        if (pe.route.at(s).x < LB_IN - 6) {
          const f = s / pe.route.length;
          const u = f <= 0.5 ? Math.sqrt(f / 2) : 1 - Math.sqrt((1 - f) / 2);
          clear = pe.t[0] + u * (pe.t[1] - pe.t[0]);
          break;
        }
      }
      const go = clear + 0.15;
      // la excavadora también tiene que llegar al primer puesto del sector
      const exArrive = E[0] + Math.hypot(sts[0].x - exPos.x, sts[0].z - exPos.z) / V_EXC + 0.4;
      startDig = Math.max(E[0], go + dur(fromLb, V_BACK), exArrive);
      const atLb = Math.min(go, E[0]) - 0.6;
      gateIn = atLb - dur(toLb, V_BACK);
      const st = streetLeg();
      legs.push(
        { route: st, t: [gateIn - 0.25 - dur(st, V_STREET), gateIn - 0.25], back: false },
        { route: toLb, t: [gateIn, atLb], back: true },
        { route: fromLb, t: [startDig - dur(fromLb, V_BACK), startDig], back: true },
      );
      waitFrom = atLb;
    }
    // excavadora: del puesto anterior al primero del sector
    if (sn > 1) {
      const tr = Math.hypot(sts[0].x - exPos.x, sts[0].z - exPos.z) / V_EXC + 0.4;
      pushTravel(exPos, sts[0], E[0], E[0] + tr, `Se traslada al sector ${sn}`);
    }
    // repartición: transiciones (el camión se reubica y la excavadora avanza) y excavación por volumen
    const moves = sts.slice(1).map((s, i) => moveLegs(sts[i].truck, s.truck, xa));
    const trans = sts.slice(1).map((s, i) => Math.max(
      Math.hypot(s.x - sts[i].x, s.z - sts[i].z) / V_EXC + 0.35,
      moves[i].reduce((acc, m) => acc + dur(m.route, V_SITE), 0) + 0.1,
    ));
    const avail = E[1] - startDig;
    let trSum = trans.reduce((a, b) => a + b, 0);
    let kTr = 1;
    if (avail - trSum < avail * 0.5) {
      kTr = (avail * 0.5) / Math.max(trSum, 1e-3);
      trSum *= kTr;
    }
    const volSum = sts.reduce((a, s) => a + s.cells.reduce((b, c) => b + c.vol, 0), 0);
    const kV = (avail - trSum) / volSum;
    let t = startDig;
    sts.forEach((s, i) => {
      if (i > 0) {
        const tr = trans[i - 1] * kTr;
        pushTravel(sts[i - 1], s, t, t + tr * 0.9, 'Avanza al puesto siguiente');
        // tramos del camión dentro de la transición
        const ms = moves[i - 1];
        const tot = ms.reduce((acc, m) => acc + dur(m.route, V_SITE), 0) || 1;
        let tt = t + 0.05;
        for (const m of ms) {
          const d = (dur(m.route, V_SITE) / tot) * (tr - 0.1);
          legs.push({ route: m.route, t: [tt, tt + d], back: m.back });
          tt += d;
        }
        t += tr;
      }
      const v = s.cells.reduce((b, c) => b + c.vol, 0);
      s.dig = [t, t + v * kV];
      exSegs.push({ t: s.dig, kind: 'dig', st: s, heading: 0, x: s.x, z: s.z });
      let tc = t;
      for (const c of s.cells) {
        c.dig = [tc, tc + c.vol * kV];
        tc += c.vol * kV;
      }
      t = s.dig[1];
    });
    exPos = sts[sts.length - 1];
    // salida del camión
    const exR = exitRoute(sts[sts.length - 1].truck);
    const exT: Win = [E[1], E[1] + dur(exR, V_OUT)];
    legs.push({ route: exR, t: exT, back: false });
    prevExit = { route: exR, t: exT };
    trucks.push({ id: sn, sector: sn, legs, arrive: [legs[0].t[0], startDig], leave: exT, waitFrom, gateIn, cells: cells.filter((c) => c.sector === sn) });

    // --- resto del sector ---
    const perfil = span(g.perfil[0], g.perfil[1]);
    const recep = span(g.recep[0], g.recep[1]);
    sectors.push({
      n: sn, x0: sectorRange(sn)[0], x1: sectorRange(sn)[1], exc: E, perfil, recep,
      empl: null as unknown as CapachoSeries,
      fierro: span(g.fierro[0], g.fierro[1]), moldaje: span(g.moldaje[0], g.moldaje[1]),
      pour: { sector: sn, pour: [T(g.pour - 1) + 4.4, T(g.pour) - 1.0], pumpStop: [T(g.pour) - 1.0, T(g.pour) - 1.0] },
      desc: span(g.desc[0], g.desc[1]), npt: null, igol: span(g.igol[0], g.igol[1]), relleno: span(g.relleno[0], g.relleno[1]),
      m3: f.sectores[sn - 1]?.hormigonZapatas_m3 ?? 115, kg: (f.sectores[sn - 1]?.fierroZapatas_kg ?? 4000) * 1.05, moldajeM2: 0,
    });
  }
  // la excavadora termina el sector 3, se estaciona en el testero +x y se retira
  const lastDig = stations[stations.length - 1].dig[1];
  const parkAt = lastDig + 0.05 + Math.hypot(P1.x - exPos.x, P1.z - exPos.z) / V_EXC + 0.3;
  pushTravel(exPos, P1, lastDig + 0.05, parkAt, 'Termina la excavación y se estaciona');
  const exOff = Math.max(T(12.7), parkAt + 0.6);
  exSegs.sort((a, b) => a.t[0] - b.t[0]);
  // rumbo del tren de orugas en cada puesto: el del último traslado
  {
    let h = 0;
    for (const s of exSegs) {
      if (s.kind === 'travel') {
        const L = s.route.length;
        h = s.route.at(Math.max(L - 0.3, 0)).heading;
      } else if (s.kind === 'dig') s.heading = h;
    }
  }

  // --- franjas: emplantillado, fierro, moldaje, hormigón, descimbre ---
  const strips: StripTiming[] = [];
  const capachos: CapachoSeries[] = [];
  const series = (day: number, sector: number, what: CapachoSeries['what'], pts: P3[], task: string): CapachoSeries => {
    const a = T(day - 1) + 0.1, b = T(day) - 0.1;
    const lead = 0.9, tail = 0.55;
    const D = (b - a - lead - tail) / pts.length;
    const s: CapachoSeries = {
      t0: a, t1: b, what, sector, task,
      trips: pts.map((p, k) => ({ t0: a + lead + k * D, t1: a + lead + (k + 1) * D, walls: [], ...p })),
    };
    capachos.push(s);
    return s;
  };
  /** Ventana de vaciado del capacho dentro de su viaje (igual que CranePlan: 55 % a 86 %). */
  const capPour = (tr: { t0: number; t1: number }): Win => [tr.t0 + 0.55 * (tr.t1 - tr.t0), tr.t0 + 0.86 * (tr.t1 - tr.t0)];
  const pumpEntryX = SITE.pipeline.xDoor;
  for (const S of sectors) {
    const g = GANTT[S.n - 1];
    const fr = f.franjas.filter((x) => x.sector === S.n).sort((a, b) => (a.x0 + a.x1) - (b.x0 + b.x1) || a.z0 - b.z0);
    const cxOf = (x: FootingStrip) => (x.x0 + x.x1) / 2, czOf = (x: FootingStrip) => (x.z0 + x.z1) / 2;
    // emplantillado: 3 capachos por sector (grupos de franjas contiguas)
    const groups: FootingStrip[][] = [[], [], []];
    const areaTot = fr.reduce((s, x) => s + x.B * x.L, 0);
    let acc = 0;
    for (const x of fr) {
      groups[Math.min(2, Math.floor((acc / areaTot) * 3))].push(x);
      acc += x.B * x.L;
    }
    const gPts = groups.filter((gg) => gg.length).map((gg) => {
      const big = gg.reduce((m, x) => (x.B * x.L > m.B * m.L ? x : m), gg[0]);
      return { x: cxOf(big), y: zoneOf(big.sello).fondoY + 0.12, z: czOf(big) };
    });
    S.empl = series(g.empl, S.n, 'emplantillado', gPts, `Capacho: emplantillado G05 del sector ${S.n}`);
    const emplWin = new Map<FootingStrip, Win>();
    groups.filter((gg) => gg.length).forEach((gg, k) => gg.forEach((x) => emplWin.set(x, capPour(S.empl.trips[k]))));
    const fWins = seq(fr, (x) => x.B * x.L, S.fierro, 0.4);
    const mWins = seq(fr, (x) => 2 * (x.B + x.L), S.moldaje, 0.4);
    // hormigonado: desde el lado de la tubería (que llega por la fachada posterior en x de la puerta)
    const order = [...fr].sort((a, b) => Math.abs(cxOf(a) - (S.n === 2 ? pumpEntryX : S.n === 1 ? S.x1 : S.x0)) - Math.abs(cxOf(b) - (S.n === 2 ? pumpEntryX : S.n === 1 ? S.x1 : S.x0)) || czOf(a) - czOf(b));
    const pWins = seq(order, (x) => x.B * x.L * (x.tope - x.sello), S.pour.pour, 0);
    const pMap = new Map(order.map((x, i) => [x, pWins[i]]));
    const stripW = S.desc;
    fr.forEach((x, i) => {
      const sw = seq(fr, () => 1, stripW, 0.6)[i];
      strips.push({ franja: x, empl: emplWin.get(x)!, fierro: fWins[i], moldaje: mWins[i], pour: pMap.get(x)!, strip: sw, igol: S.igol, fill: S.relleno });
    });
    S.moldajeM2 = fr.reduce((s, x) => s + 2 * (x.B + x.L) * 0.95, 0);
  }
  const stripOf = new Map(strips.map((s) => [s.franja, s]));

  // --- muros del 1P sobre las franjas: pollos (con la zapata) y muros bajo NPT (con capacho) ---
  const pieces: WallPiece[] = [];
  for (const wl of walls1P) {
    for (const fr of f.franjas) {
      const poly = clipRect(wl.poly, fr.x0, fr.z0, fr.x1, fr.z1);
      if (poly.length < 3 || polyArea(poly) < 0.02) continue;
      const b = polyBounds(poly);
      const alongX = b.x1 - b.x0 >= b.z1 - b.z0;
      const len = alongX ? b.x1 - b.x0 : b.z1 - b.z0;
      const st = stripOf.get(fr)!;
      const deep = fr.tope < PLAT - 0.05;
      const S = sectors[fr.sector - 1];
      pieces.push({
        poly, franja: fr, deep, y0: fr.tope,
        axis: { cx: b.cx, cz: b.cz, ux: alongX ? 1 : 0, uz: alongX ? 0 : 1, len, w: alongX ? b.z1 - b.z0 : b.x1 - b.x0 },
        fierro: [st.fierro[0] + (st.fierro[1] - st.fierro[0]) * 0.8, st.fierro[1]],
        forms: deep && S.npt ? S.npt.fierro : st.moldaje,
        pour: deep ? [0, 0] : [st.pour[1] - (st.pour[1] - st.pour[0]) * 0.15, st.pour[1]],
        strip: deep && S.npt ? S.npt.strip : st.strip,
      });
    }
  }
  // series de capacho para los muros bajo NPT (S1) y la V.S.C. con los muros del foso (S2)
  const fo = f.foso;
  for (const S of sectors) {
    const g = GANTT[S.n - 1];
    if (!g.npt) continue;
    const deep = pieces.filter((p) => p.deep && p.franja.sector === S.n).sort((a, b) => a.axis.cx - b.axis.cx);
    if (!deep.length) continue;
    const pts: P3[] = S.n === 2
      ? [{ x: (fo.vsc.x0 + fo.vsc.x1) / 2, y: 0.08, z: (fo.vsc.z0 + fo.vsc.z1) / 2 }, { x: deep[0].axis.cx, y: 0.08, z: deep[0].axis.cz }]
      : [deep[0], deep[deep.length - 1]].map((p) => ({ x: p.axis.cx, y: 0.08, z: p.axis.cz }));
    const cap = series(g.npt.cap, S.n, S.n === 2 ? 'vsc' : 'murosNPT', pts, S.n === 2 ? 'Capacho: V.S.C. 20/140 y muros del foso' : 'Capacho: muros bajo NPT de los ejes A-B');
    S.npt = { fierro: span(g.npt.fierro[0], g.npt.fierro[1]), cap, strip: span(g.npt.strip[0], g.npt.strip[1]) };
    const pw = cap.trips.map(capPour);
    deep.forEach((p, i) => {
      p.forms = S.npt!.fierro;
      p.strip = S.npt!.strip;
      p.pour = pw[Math.min(pw.length - 1, Math.floor((i / deep.length) * pw.length))];
    });
  }

  // --- viajes de grúa: paquetes de fierro y de tableros a cada sector (sin topar los capachos) ---
  const craneTrips: CraneTripF[] = [];
  {
    const busy: Win[] = capachos.map((c) => [c.t0 - 0.05, c.t1 + 0.05]);
    const want: (Omit<CraneTripF, 't0' | 't1'> & { at: number })[] = [];
    const D = 2.6;
    for (const S of sectors) {
      const cx = (Math.max(S.x0, -22) + Math.min(S.x1, 24)) / 2;
      const drop = (dx: number) => ({ x: cx + dx, y: PLAT + 0.05, z: -4.2 });
      want.push({ at: S.fierro[0] - 1.0, kind: 'rebar', ...drop(-3), task: `Paquete de fierro dimensionado al sector ${S.n} (1/2)` });
      want.push({ at: S.fierro[0] + 1.6, kind: 'rebar', ...drop(3), task: `Paquete de fierro dimensionado al sector ${S.n} (2/2)` });
      want.push({ at: S.moldaje[0] - 0.4, kind: 'panel', ...drop(0), task: `Tableros de moldaje al sector ${S.n}` });
      if (S.npt) want.push({ at: S.npt.fierro[0] + 0.1, kind: 'panel', x: S.n === 1 ? -22.5 : -2.5, y: PLAT + 0.05, z: S.n === 1 ? -3.5 : -3.2, task: S.n === 1 ? 'Paneles de muro para los muros bajo NPT (A-B)' : 'Paneles para la V.S.C. y los muros del foso' });
    }
    want.sort((a, b) => a.at - b.at);
    let free = t0 + 0.5;
    for (const wt of want) {
      let s = Math.max(wt.at, free);
      for (let guard = 0; guard < 20; guard++) {
        const b = busy.find(([a, bb]) => s < bb && s + D > a);
        if (!b) break;
        s = b[1];
      }
      const { at: _at, ...rest } = wt;
      void _at;
      craneTrips.push({ ...rest, t0: s, t1: s + D });
      busy.push([s, s + D]);
      free = s + D;
    }
  }

  const pours = sectors.map((s) => s.pour);
  const trazado: Win = [t0, T(3)];
  const compactacion = span(34, 37), replanteo = span(38, 40);
  const lastS = sectors[sectors.length - 1];

  const steps: FundStep[] = [
    { key: 'f-trazado', label: 'Trazado, niveletas y escarpe', win: trazado },
    { key: 'f-excavacion', label: 'Excavación con excavadora y camiones tolva', win: [sectors[0].exc[0], sectors[2].exc[1]] },
    { key: 'f-sellos', label: 'Recepción de sellos y emplantillado', win: [sectors[0].perfil[0], sectors[2].empl.t1] },
    { key: 'f-fierro', label: 'Enfierradura de zapatas y esperas', win: [sectors[0].fierro[0], sectors[2].fierro[1]] },
    { key: 'f-moldaje', label: 'Moldaje de zapatas y pollos', win: [sectors[0].moldaje[0], sectors[2].moldaje[1]] },
    { key: 'f-hormigon', label: 'Hormigonado con bomba estacionaria', win: [sectors[0].pour.pour[0], lastS.pour.pour[1]] },
    { key: 'f-relleno', label: 'Descimbre, Igol y relleno compactado', win: [sectors[0].desc[0], t1] },
  ];

  // --- estado de la excavadora ---
  const CYC = 1.05;
  const excavator = (t: number): ExcavatorState => {
    const st: ExcavatorState = { visible: t >= t0 && t < exOff, x: P0.x, z: P0.z, heading: 0, slew: 0, r: 4.6, y: PLAT + 0.6, curl: 0.2, load: false, moving: false, task: 'Estacionada', dist: 0 };
    if (!st.visible) return st;
    let seg: ExSeg | null = null;
    for (const s of exSegs) {
      if (s.t[0] <= t) seg = s;
      else break;
    }
    if (!seg) return st;
    const park = (x: number, z: number, h: number, task: string) => {
      st.x = x; st.z = z; st.heading = h; st.slew = h; st.task = task;
      st.r = 4.4; st.y = PLAT + 0.15; st.curl = 0.1;
    };
    if (seg.kind === 'park') {
      park(seg.x, seg.z, seg.heading, seg.task);
      return st;
    }
    if (seg.kind === 'travel') {
      const L = seg.route.length;
      const inT = t <= seg.t[1];
      const r = inT ? travel(seg.route, t, seg.t) : { pose: seg.route.at(L), s: L };
      park(r.pose.x, r.pose.z, r.pose.heading, inT ? seg.task : 'En espera del camión');
      st.dist = seg.d0 + r.s;
      st.moving = inT;
      // en el escarpe el balde va raspando la plataforma
      if (inT && seg.task.startsWith('Escarpe')) {
        st.r = 6.2 + Math.sin(t * 5) * 0.6;
        st.y = PLAT + 0.05;
        st.curl = 0.25;
      }
      st.load = false;
      return st;
    }
    // excavando desde un puesto
    const s = seg.st;
    st.x = s.x; st.z = s.z; st.heading = seg.heading;
    let tc = Math.min(t, s.dig[1] - 1e-4);
    if (t > s.dig[1]) {
      // terminó el puesto y espera (camión saliendo o el traslado siguiente)
      st.slew = Math.atan2(s.bed.z - s.z, s.bed.x - s.x);
      st.r = 5.2; st.y = PLAT + 2.2; st.curl = 0.1;
      st.task = 'Espera el cambio de camión';
      return st;
    }
    const c = s.cells.find((x) => tc >= x.dig[0] && tc < x.dig[1]) ?? s.cells[s.cells.length - 1];
    const D = s.dig[1] - s.dig[0];
    const n = Math.max(1, Math.round(D / CYC));
    const cl = D / n;
    const ci = Math.min(n - 1, Math.floor((tc - s.dig[0]) / cl));
    const u = (tc - s.dig[0] - ci * cl) / cl;
    // punto de excavación: recorre la celda a lo largo de su eje, bajando con la celda
    const kc = k01(tc, c.dig);
    const along = ((ci * 0.37) % 1) * 0.7 + 0.15;
    const ex = c.franja.eje === 'x' ? c.x0 + (c.x1 - c.x0) * along : c.cx;
    const ez = c.franja.eje === 'z' ? c.z0 + (c.z1 - c.z0) * along : c.cz;
    const yDig = PLAT + (c.fondoY - PLAT) * kc + 0.25;
    const aDig = Math.atan2(ez - s.z, ex - s.x), rDig = Math.hypot(ex - s.x, ez - s.z);
    const aBed = Math.atan2(s.bed.z - s.z, s.bed.x - s.x), rBed = Math.hypot(s.bed.x - s.x, s.bed.z - s.z);
    let dA = aBed - aDig;
    dA -= Math.round(dA / (Math.PI * 2)) * Math.PI * 2;
    const yBed = PLAT + 3.9;
    if (u < 0.36) {
      // baja y llena el balde (tira hacia la tornamesa)
      const k = u / 0.36;
      st.slew = aDig; st.r = rDig + 0.9 * (1 - k); st.y = yDig + Math.max(0, 1 - k * 3) * 1.6 - Math.sin(k * Math.PI) * 0.15; st.curl = 0.55 * (1 - k);
      st.load = k > 0.6;
    } else if (u < 0.56) {
      const k = smooth((u - 0.36) / 0.2);
      st.slew = aDig + dA * k; st.r = rDig + (rBed - rDig) * k; st.y = yDig + (yBed - yDig) * Math.min(1, k * 1.6); st.curl = 0; st.load = true;
    } else if (u < 0.72) {
      const k = (u - 0.56) / 0.16;
      st.slew = aBed; st.r = rBed; st.y = yBed; st.curl = Math.sin(Math.min(k * 1.4, 1) * Math.PI / 2); st.load = k < 0.4;
    } else {
      const k = smooth((u - 0.72) / 0.28);
      st.slew = aBed - dA * k; st.r = rBed + (rDig + 0.9 - rBed) * k; st.y = yBed + (yDig + 1.6 - yBed) * k; st.curl = 1 - 0.45 * k; st.load = false;
    }
    st.task = `Excava zanjas del sector ${s.sector} y carga el camión tolva`;
    return st;
  };

  // --- estado de los camiones tolva ---
  const truckStates = (t: number): TruckState[] => {
    const out: TruckState[] = [];
    for (const v of trucks) {
      if (t < v.legs[0].t[0] || t > v.leave[1]) continue;
      let pose: Pose = v.legs[0].route.at(0);
      let dist = 0;
      for (const L of v.legs) {
        const sign = L.back ? -1 : 1;
        if (t < L.t[0]) break;
        if (t >= L.t[1]) {
          pose = L.route.at(L.route.length);
          dist += sign * L.route.length;
          continue;
        }
        const r = travel(L.route, t, L.t);
        pose = r.pose;
        dist += sign * r.s;
        break;
      }
      const tot = v.cells.reduce((s, c) => s + c.vol, 0) || 1;
      const load = v.cells.reduce((s, c) => s + c.vol * k01(t, c.dig), 0) / tot;
      const loading = v.cells.some((c) => t >= c.dig[0] && t < c.dig[1]);
      out.push({ id: v.id, pose, dist, load, loading });
    }
    return out;
  };

  // --- punto de vaciado de la manguera ---
  const pourPoint = (sector: number, k: number): P3 => {
    const sp = sectors[sector - 1];
    const list = strips.filter((s) => s.franja.sector === sector).sort((a, b) => a.pour[0] - b.pour[0]);
    const tt = sp.pour.pour[0] + clamp01(k) * (sp.pour.pour[1] - sp.pour.pour[0]);
    const s = list.find((x) => tt <= x.pour[1]) ?? list[list.length - 1];
    const u = k01(tt, s.pour);
    const fr = s.franja;
    const zig = fr.eje === 'x' ? { x: fr.x0 + 0.3 + (fr.x1 - fr.x0 - 0.6) * u, z: (fr.z0 + fr.z1) / 2 } : { x: (fr.x0 + fr.x1) / 2, z: fr.z0 + 0.3 + (fr.z1 - fr.z0 - 0.6) * u };
    return { x: zig.x, y: fr.sello + (fr.tope - fr.sello) * Math.min(1, u * 1.3) + 0.05, z: zig.z };
  };

  // --- cuadrillas por frente ---
  const stripPts = (list: StripTiming[], y: (s: StripTiming) => number, edge = false): [number, number, number][] => {
    const pts: [number, number, number][] = [];
    for (const s of list) {
      const fr = s.franja;
      const z = zoneOf(fr.sello);
      const L = fr.eje === 'x' ? fr.x1 - fr.x0 : fr.z1 - fr.z0;
      const n = Math.max(1, Math.round(L / 1.4));
      for (let i = 0; i < n; i++) {
        const a = (i + 0.5) / n;
        // a un costado de la zapata, en el espacio entre el moldaje y la pared de la zanja
        const side = edge ? (i % 2 ? 1 : -1) * ((fr.eje === 'x' ? fr.z1 - fr.z0 : fr.x1 - fr.x0) / 2 + z.off * 0.55) : 0;
        const px = fr.eje === 'x' ? fr.x0 + L * a : (fr.x0 + fr.x1) / 2 + side;
        const pz = fr.eje === 'z' ? fr.z0 + L * a : (fr.z0 + fr.z1) / 2 + side;
        pts.push([px, y(s), pz]);
      }
    }
    return pts;
  };
  const active = (list: StripTiming[], key: 'fierro' | 'moldaje' | 'pour' | 'strip', t: number) => {
    const on = list.filter((s) => t >= s[key][0] && t <= s[key][1]);
    if (on.length) return on;
    return [list.reduce((m, s) => (Math.abs(s[key][0] - t) < Math.abs(m[key][0] - t) ? s : m), list[0])];
  };
  const bottomY = (s: StripTiming) => zoneOf(s.franja.sello).fondoY + 0.01;
  const fronts = (t: number): CrewFront[] => {
    const out: CrewFront[] = [];
    const inW = (w: Win) => t >= w[0] && t <= w[1];
    if (inW(trazado)) {
      // topógrafo y alarife con la estación total; jornales marcan con cal
      const k = k01(t, trazado);
      const x = -22 + k * 46;
      out.push({ pts: [[x, PLAT, -8.6], [x + 1.2, PLAT, 9.9], [x - 2, PLAT, 1.0], [x + 2.5, PLAT, 4.5]], n: 4, action: 'work', label: 'Trazado y niveletas' });
    }
    for (const S of sectors) {
      const list = strips.filter((s) => s.franja.sector === S.n);
      if (inW(S.exc)) {
        // perfilado a mano en las zanjas ya abiertas y un señalero junto al camión
        const done = cells.filter((c) => c.sector === S.n && c.dig[1] < t - 0.3);
        const pts = done.slice(-6).map((c) => [c.cx, c.fondoY + 0.01, c.cz] as [number, number, number]);
        if (pts.length) out.push({ pts, n: 4, action: 'work', label: 'Perfilado a mano' });
        const stn = stations.find((s) => s.sector === S.n && t >= s.dig[0] - 0.8 && t <= s.dig[1] + 0.8);
        if (stn) out.push({ pts: [[stn.truck.x - 1.2, PLAT, stn.truck.z + (stn.truck.kind === 'inner' ? 2.4 : 2.0)]], n: 1, action: 'idle', label: 'Señalero' });
      }
      if (inW(S.perfil)) out.push({ pts: stripPts(list, bottomY), n: 5, action: 'work', label: `Perfilado y limpieza del sello, sector ${S.n}` });
      if (inW(S.recep)) out.push({ pts: stripPts(list.slice(0, 3), bottomY), n: 2, action: 'idle', label: 'Recepción de sellos (mecánico de suelos)' });
      if (t >= S.empl.t0 && t <= S.empl.t1) out.push({ pts: S.empl.trips.map((tr) => [tr.x + 0.9, tr.y - 0.1, tr.z + 0.6] as [number, number, number]), n: 3, action: 'work', label: 'Emplantillado' });
      if (inW(S.fierro)) out.push({ pts: stripPts(active(list, 'fierro', t), (s) => s.franja.sello + 0.02), n: 8, action: 'work', label: `Enfierradura sector ${S.n}` });
      if (inW(S.moldaje)) out.push({ pts: stripPts(active(list, 'moldaje', t), bottomY, true), n: 6, action: 'work', label: `Moldaje sector ${S.n}` });
      if (inW(S.pour.pour)) out.push({ pts: stripPts(active(list, 'pour', t), (s) => s.franja.tope + 0.02, true).map(([x, , z]) => [x, PLAT, z] as [number, number, number]), n: 7, action: 'work', label: `Hormigonado sector ${S.n}` });
      if (inW(S.desc)) out.push({ pts: stripPts(active(list, 'strip', t), bottomY, true), n: 4, action: 'carry', label: 'Descimbre' });
      if (S.npt && (inW(S.npt.fierro) || (t >= S.npt.cap.t0 && t <= S.npt.cap.t1))) {
        const deep = pieces.filter((p) => p.deep && p.franja.sector === S.n);
        out.push({ pts: deep.map((p) => [p.axis.cx + 0.6, p.y0 + 0.02, p.axis.cz + 0.6] as [number, number, number]), n: 4, action: 'work', label: 'Muros bajo NPT' });
      }
      if (inW(S.igol)) out.push({ pts: stripPts(list, bottomY, true), n: 2, action: 'work', label: 'Impermeabilización Igol' });
      if (inW(S.relleno)) {
        const k = k01(t, S.relleno);
        out.push({ pts: stripPts(list, (s) => zoneOf(s.franja.sello).fondoY + (PLAT - zoneOf(s.franja.sello).fondoY) * k, true), n: 4, action: 'work', label: 'Relleno compactado con vibropisón' });
      }
    }
    if (inW(compactacion) || inW(replanteo)) {
      const pts = strips.filter((_, i) => i % 3 === 0).map((s) => [(s.franja.x0 + s.franja.x1) / 2, PLAT, (s.franja.z0 + s.franja.z1) / 2] as [number, number, number]);
      out.push({ pts, n: 5, action: 'work', label: inW(compactacion) ? 'Compactación de la plataforma y ensayos de densidad' : 'Replanteo de muros del 1P sobre los pollos' });
    }
    return out;
  };

  const describe = (t: number) => {
    const parts: string[] = [];
    const inW = (w: Win) => t >= w[0] && t <= w[1];
    if (inW(trazado)) parts.push('Trazado de ejes, niveletas y cal; escarpe y plataforma a −0,20');
    for (const S of sectors) {
      const s = `S${S.n}`;
      if (inW(S.exc)) parts.push(`${s}: excavación de zanjas${S.n === 1 ? ' (A-B a −2,66 con talud 3:1)' : S.n === 2 ? ' (núcleo y foso a −1,45)' : ''}`);
      if (inW(S.perfil) && !inW(S.recep)) parts.push(`${s}: perfilado a mano de los últimos 10 cm`);
      if (inW(S.recep)) parts.push(`${s}: recepción de sellos por el mecánico de suelos`);
      if (t >= S.empl.t0 && t <= S.empl.t1) parts.push(`${s}: emplantillado G05 de 5 cm con capacho`);
      if (inW(S.fierro)) parts.push(`${s}: enfierradura Ø12 A630-420H y esperas`);
      if (inW(S.moldaje)) parts.push(`${s}: moldaje de costados y pollos`);
      if (inW([S.pour.pour[0] - 2.5, S.pour.pour[1] + 0.3])) parts.push(`${s}: hormigonado G25 con bomba estacionaria (≈ ${Math.round(S.m3)} m³)`);
      if (inW(S.desc)) parts.push(`${s}: descimbre de costados`);
      if (S.npt && inW(S.npt.fierro)) parts.push(`${s}: ${S.n === 2 ? 'fierro y moldaje de la V.S.C. y muros del foso' : 'fierro y moldaje de muros bajo NPT'}`);
      if (S.npt && t >= S.npt.cap.t0 && t <= S.npt.cap.t1) parts.push(`${s}: ${S.npt.cap.task.toLowerCase()}`);
      if (inW(S.igol)) parts.push(`${s}: impermeabilización Igol de caras contra terreno`);
      if (inW(S.relleno)) parts.push(`${s}: relleno lateral compactado en capas de 25 cm`);
    }
    if (inW(compactacion)) parts.push('Compactación y nivelación de la plataforma, ensayos de densidad');
    if (inW(replanteo)) parts.push('Replanteo de muros del 1P y recepción de fundaciones (ITO)');
    if (!parts.length) parts.push('Curado húmedo de zapatas');
    return parts.join(' · ');
  };

  const focus = (t: number): P3 => {
    const ex = excavator(t);
    for (const S of sectors) {
      if (t >= S.pour.pour[0] - 2 && t <= S.pour.pour[1]) return pourPoint(S.n, k01(t, S.pour.pour));
    }
    if (ex.visible && t >= sectors[0].exc[0] && t <= sectors[2].exc[1]) return { x: ex.x, y: PLAT, z: ex.z };
    const fr = fronts(t).find((x) => x.n >= 4) ?? fronts(t)[0];
    if (fr && fr.pts.length) {
      const p = fr.pts[Math.floor(fr.pts.length / 2)];
      return { x: p[0], y: PLAT, z: p[2] };
    }
    return { x: 0, y: PLAT, z: 0 };
  };

  // cantidades de la cubicación: hormigón 361,77 + 5,32 m³, emplantillado 18,91 m³, fierro 14.074,6 kg, moldaje 597,29 m²
  const quantities = (t: number) => {
    let hormigon = 0, acero = 0, moldaje = 0, capN = 0;
    const m3Tot = sectors.reduce((s, x) => s + x.m3, 0);
    const kgTot = sectors.reduce((s, x) => s + x.kg, 0);
    const mTot = sectors.reduce((s, x) => s + x.moldajeM2, 0);
    for (const S of sectors) {
      hormigon += (S.m3 / m3Tot) * 361.77 * k01(t, S.pour.pour);
      hormigon += (18.91 / 3) * k01(t, [S.empl.t0, S.empl.t1]);
      acero += (S.kg / kgTot) * 14074.6 * k01(t, S.fierro);
      moldaje += (S.moldajeM2 / mTot) * 597.29 * k01(t, S.moldaje);
    }
    for (const c of capachos) {
      if (c.what !== 'emplantillado') hormigon += (5.32 / 2) * k01(t, [c.t0, c.t1]);
      capN += c.trips.filter((tr) => t >= tr.t0 + 0.86 * (tr.t1 - tr.t0)).length;
    }
    return { hormigon, acero, moldaje, capachos: capN };
  };

  return {
    data: f, t0, t1, T, dayAt, zones, cells, stations, trucks, sectors, strips, pieces, capachos, craneTrips, pours,
    trazado, compactacion, replanteo, excavatorOnSite: [t0, exOff], steps,
    excavator, truckStates, pourPoint, fronts, describe, focus, quantities,
  };
}
