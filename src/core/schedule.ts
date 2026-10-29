/**
 * Cronograma de obra gruesa del Edificio E (método tradicional de hormigón armado).
 *
 * Secuencia por piso, como se hace en terreno:
 *   Muros:  enfierradura → moldaje (lo sube la grúa) → hormigonado con capacho → desmolde
 *   Losa:   moldaje (puntales, vigas y placas) → enfierradura → hormigonado con bomba estacionaria
 *
 * El tiempo de simulación T está en "segundos de animación". Cada actividad tiene además
 * su duración real en días hábiles para mostrar el calendario.
 */
import type { BuildingData, LevelData, WallData } from '../data/building';
import { DAYS, PACE, TECHO } from '../config';
import { pointInPolygon, polyBounds } from '../scene/geom';
import { buildFundPlan, type FundPlan } from './fundPlan';
import { buildRoofGeometry, type RoofGeometry } from './roofPlan';

export type ActivityKind =
  | 'fundaciones'
  | 'radier'
  | 'muroFierro'
  | 'muroMoldaje'
  | 'muroHormigon'
  | 'muroDesmolde'
  | 'losaMoldaje'
  | 'losaFierro'
  | 'losaHormigon'
  // obra gruesa sobre la losa de techumbre: parapetos y caja de escala / sala de máquinas
  | 'techoFierro'
  | 'techoMoldaje'
  | 'techoHormigon'
  | 'techoDesmolde'
  | 'salaLosa'
  | 'terminaciones'
  | 'instalaciones'
  // en paralelo con las terminaciones (itemizado cap. 3, 14.5 y 2.24)
  | 'estructuraTecho'
  | 'aislacionTecho'
  | 'cubiertaTecho'
  | 'aguasLluvia'
  | 'ascensor';

/** Capas de la techumbre que avanzan a lo largo del edificio. */
export type RoofLayer = 'estructura' | 'aislacion' | 'cubierta';

export interface Trip {
  /** Ventana total del viaje de grúa. */
  t0: number;
  t1: number;
  /** Índices de muros (o franja de losa) que atiende este viaje. */
  walls: number[];
  /** Punto destino en planta y altura de trabajo. */
  x: number;
  z: number;
  y: number;
}

export interface Activity {
  id: string;
  kind: ActivityKind;
  /** Índice del piso (0 = 1P). Para losas, el piso cuya losa se construye (la losa de piso i se apoya en los muros de i-1). */
  level: number;
  levelName: string;
  t0: number;
  t1: number;
  d0: number;
  d1: number;
  title: string;
  detail: string;
  /** Viajes de grúa o capacho de la actividad (si aplica). */
  trips: Trip[];
}

export interface WallTiming {
  rebar: [number, number];
  form: [number, number];
  pour: [number, number];
  strip: [number, number];
}

export interface SlabTiming {
  props: [number, number];
  deck: [number, number];
  rebar: [number, number];
  /** Hormigonado con la bomba (de la primera descarga al fin de la última). */
  pour: [number, number];
  /**
   * Bomba detenida en el cambio de mixer (al 60 % del hormigonado): el primer mixer sale por el
   * camino y el segundo, que esperaba en el bolsón, retrocede hasta la tolva (PACE.cambioMixer).
   * El vaciado no avanza.
   */
  pumpStop: [number, number];
  propsOut: [number, number];
  deckOut: [number, number];
}

/**
 * Fracción hormigonada de una losa en el instante t (0..1): avanza mientras la bomba vacía y se
 * detiene durante el cambio de mixer. La usan el barrido de la losa, la manguera, la cuadrilla y
 * los indicadores, para que todos vayan juntos.
 */
export function pourFrac(s: Pick<SlabTiming, 'pour' | 'pumpStop'>, t: number) {
  const [p0, p1] = s.pour, [q0, q1] = s.pumpStop;
  const tt = Math.min(Math.max(t, p0), p1);
  const run = p1 - p0 - (q1 - q0);
  return Math.min(Math.max((tt - p0 - Math.min(Math.max(tt - q0, 0), q1 - q0)) / run, 0), 1);
}

/**
 * Bomba detenida para el cambio de mixer, centrada al 60 % del hormigonado [p0, p1]: el primer
 * mixer descarga algo más que el segundo, que llega a la tolva con la losa ya avanzada.
 */
const pumpStopIn = (p0: number, p1: number): [number, number] => {
  const m = p0 + (p1 - p0) * 0.6;
  return [m - PACE.cambioMixer / 2, m + PACE.cambioMixer / 2];
};

/** Obras sobre la losa de techumbre: geometría (core/roofPlan) y tiempos. */
export interface RoofSchedule {
  geo: RoofGeometry;
  /** Parapetos y muros de la caja (en ese orden), con sus tiempos como los muros de piso. */
  walls: WallData[];
  wall: WallTiming[];
  /** Losa de cielo de la caja: puntales, placas, fierro, hormigón con capacho y descimbre. */
  slab: { props: [number, number]; deck: [number, number]; rebar: [number, number]; pour: [number, number]; out: [number, number] };
  /** Viajes de capacho de la losa de la caja (el mixer los atiende como una serie de muros). */
  slabCapacho: Trip[];
  /** Obra gruesa sobre la losa (de la enfierradura de parapetos al hormigón de la losa de la caja). */
  gruesa: [number, number];
  /** Partidas en paralelo con las terminaciones (s de simulación). */
  estructura: [number, number];
  aislacion: [number, number];
  cubierta: [number, number];
  aguas: [number, number];
  ascensor: [number, number];
  /** Desmontaje de la grúa torre (3.1 FF+5). */
  gruaOut: number;
  /** Viajes de grúa con los materiales de la techumbre. */
  loads: { t0: number; t1: number; kind: 'timber' | 'sheets'; x: number; z: number; y: number; task: string }[];
  /** Instante en que una capa de la techumbre llega a la abscisa x. */
  layerAt(layer: RoofLayer, x: number): number;
  /** Frente de trabajo (x) de una capa en el instante t. */
  frontAt(layer: RoofLayer, t: number): number;
  /** Cota de lo construido en (x, z) en el instante t: losa, techumbre o losa de la caja. */
  topAt(x: number, z: number, t: number): number;
}

export interface Schedule {
  activities: Activity[];
  /** Actividades fuera de la ruta crítica que corren en paralelo (instalaciones bajo radier, radier, techumbre). */
  parallel: Activity[];
  duration: number;
  totalDays: number;
  /** Tiempos por muro HA: wall[level][i] (índice dentro de haWalls(level)). */
  wall: WallTiming[][];
  /** Tiempos por losa (índice de piso de la losa, 1..7 = 2P..Techumbre; 0 = radier). */
  slab: SlabTiming[];
  /** Fundaciones (excavación, zapatas, moldaje, hormigón y relleno) por sectores, ver fundPlan. */
  fund: FundPlan;
  /** Ventanas de terminaciones por piso. */
  finish: [number, number][];
  roof: RoofSchedule;
  levelNames: string[];
  at(t: number): Activity;
  dayAt(t: number): number;
}

export function haWalls(level: LevelData): WallData[] {
  return level.walls.filter((w) => w.ha);
}

/** Orden de trabajo de los muros: por sectores a lo largo del edificio (de −x a +x). */
export function wallOrder(walls: WallData[]): number[] {
  return walls
    .map((w, i) => ({ i, cx: polyBounds(w.poly).cx, cz: polyBounds(w.poly).cz }))
    .sort((a, b) => a.cx - b.cx || a.cz - b.cz)
    .map((o) => o.i);
}

/** Agrupa los muros (ya ordenados) en k grupos contiguos. */
function groups(order: number[], k: number): number[][] {
  const out: number[][] = [];
  const n = order.length;
  for (let g = 0; g < k; g++) {
    const a = Math.round((g * n) / k), b = Math.round(((g + 1) * n) / k);
    if (b > a) out.push(order.slice(a, b));
  }
  return out;
}

function groupCenter(walls: WallData[], idx: number[]) {
  let x = 0, z = 0;
  for (const i of idx) {
    const b = polyBounds(walls[i].poly);
    x += (b.x0 + b.x1) / 2;
    z += (b.z0 + b.z1) / 2;
  }
  return { x: x / idx.length, z: z / idx.length };
}

export function buildSchedule(data: BuildingData): Schedule {
  const levels = data.levels;
  const acts: Activity[] = [];
  let t = 0;
  let d = 0;
  const push = (
    kind: ActivityKind, level: number, dur: number, days: number, title: string, detail: string, trips: Trip[] = [],
  ) => {
    const a: Activity = {
      id: `${kind}-${level}`, kind, level, levelName: levels[level]?.name ?? '', t0: t, t1: t + dur, d0: d, d1: d + days,
      title, detail, trips,
    };
    acts.push(a);
    t += dur;
    d += days;
    return a;
  };

  const nWallLevels = levels.filter((l) => l.walls.some((w) => w.ha)).length; // 1P..7P
  const wall: WallTiming[][] = [];
  const slab: Schedule['slab'] = [];
  const finish: [number, number][] = [];

  // --- Fundaciones y radier -------------------------------------------------------------
  // Excavación en zanjas, emplantillado, enfierradura, moldaje, hormigonado con la bomba y relleno,
  // en 3 sectores en tren; los días duran según lo que pasa en ellos (FUND_PACE)
  if (!data.fund) throw new Error('Faltan los datos de fundaciones (fundaciones-e.json)');
  const fundPlan = buildFundPlan(data.fund, t, haWalls(levels[0]));
  push('fundaciones', 0, fundPlan.t1 - fundPlan.t0, DAYS.fundaciones, 'Fundaciones',
    'Zapatas corridas G25 B 1,5–2,1 m × 0,95 con bomba estacionaria; sello en maicillo (−1,11 a −2,61 m)');
  for (let L = 0; L < nWallLevels; L++) {
    const lv = levels[L];
    const walls = haWalls(lv);
    const order = wallOrder(walls);
    const timing: WallTiming[] = walls.map(() => ({ rebar: [0, 0], form: [0, 0], pour: [0, 0], strip: [0, 0] }));
    const yWork = lv.slab.y1;
    const piso = `Piso ${L + 1}`;

    // 1) Enfierradura de muros: avanza por sectores; la grúa sube paquetes de fierro.
    const aF = push('muroFierro', L, PACE.muroFierro, DAYS.muroFierro, `${piso} · Enfierradura de muros`,
      L > 0
        ? `${L === 1 ? 'Se arma' : 'La grúa trepa'} la bandeja de trabajo perimetral en ménsulas; mallas Ø8–Ø12 A630-420H sobre los arranques`
        : 'Mallas Ø8–Ø12 A630-420H amarradas sobre los arranques de las zapatas');
    order.forEach((wi, k) => {
      const s = aF.t0 + 0.5 + (k / order.length) * (PACE.muroFierro - 2.6);
      timing[wi].rebar = [s, s + 1.8];
    });
    aF.trips = groups(order, 3).map((g, k) => {
      const c = groupCenter(walls, g);
      const t0 = aF.t0 + k * (PACE.muroFierro / 3);
      return { t0, t1: t0 + PACE.muroFierro / 3, walls: g, x: c.x, z: c.z, y: yWork + 0.3 };
    });

    // 2) Moldaje de muros: la grúa lleva paquetes de paneles; cada viaje arma un sector.
    const aM = push('muroMoldaje', L, PACE.muroMoldaje, DAYS.muroMoldaje, `${piso} · Moldaje de muros`, 'Paneles metálicos a ambas caras, alineados y aplomados');
    const gM = groups(order, 6);
    const tripM = PACE.muroMoldaje / gM.length;
    aM.trips = gM.map((g, k) => {
      const c = groupCenter(walls, g);
      const t0 = aM.t0 + k * tripM;
      const place = t0 + tripM * 0.62; // instante en que el paquete llega al piso
      g.forEach((wi, j) => (timing[wi].form = [place + j * 0.12, place + j * 0.12 + 0.9]));
      return { t0, t1: t0 + tripM, walls: g, x: c.x, z: c.z, y: yWork + 3.2 };
    });

    // 3) Hormigonado de muros con capacho: llega el mixer, la grúa va y viene con el capacho.
    const aH = push('muroHormigon', L, PACE.muroHormigon, DAYS.muroHormigon, `${piso} · Hormigonado de muros`, 'Hormigón G25 con capacho de 1 m³ desde el mixer');
    const gH = groups(order, 7);
    const lead = 2.2, tail = 1.6;
    const tripH = (PACE.muroHormigon - lead - tail) / gH.length;
    aH.trips = gH.map((g, k) => {
      const c = groupCenter(walls, g);
      const t0 = aH.t0 + lead + k * tripH;
      // el capacho descarga entre 55% y 85% del viaje
      g.forEach((wi) => (timing[wi].pour = [t0 + tripH * 0.55, t0 + tripH * 0.86]));
      return { t0, t1: t0 + tripH, walls: g, x: c.x, z: c.z, y: yWork + 2.35 + 1.2 };
    });

    // 4) Desmolde: los paneles se retiran por sectores y vuelven al acopio.
    const aD = push('muroDesmolde', L, PACE.muroDesmolde, DAYS.muroDesmolde, `${piso} · Desmolde de muros`, 'Retiro de paneles y limpieza para el siguiente uso');
    const gD = groups(order, 3);
    const tripD = PACE.muroDesmolde / gD.length;
    aD.trips = gD.map((g, k) => {
      const c = groupCenter(walls, g);
      const t0 = aD.t0 + k * tripD;
      const lift = t0 + tripD * 0.18;
      g.forEach((wi, j) => (timing[wi].strip = [lift + j * 0.08, lift + j * 0.08 + tripD * 0.5]));
      return { t0, t1: t0 + tripD, walls: g, x: c.x, z: c.z, y: yWork + 3.2 };
    });
    wall[L] = timing;

    // --- Losa que se apoya sobre estos muros (losa del piso L+1) ---
    const S = L + 1;
    const losaTxt = S === levels.length - 1 ? 'losa de techumbre' : `losa cielo ${lv.name}`;
    const aLM = push('losaMoldaje', S, PACE.losaMoldaje, DAYS.losaMoldaje, `${piso} · Moldaje de ${losaTxt}`, 'Puntales, vigas H20 y placas fenólicas; frontales de borde');
    const aLF = push('losaFierro', S, PACE.losaFierro, DAYS.losaFierro, `${piso} · Enfierradura de ${losaTxt}`, 'Malla inferior y superior Ø8–Ø10, suples y separadores');
    const aLH = push('losaHormigon', S, PACE.losaHormigon, DAYS.losaHormigon, `${piso} · Hormigonado de ${losaTxt}`, 'Bomba estacionaria: la tubería sube por el shaft del ascensor; vibrado y platachado');
    const bx = polyBounds(levels[S].slab.outer);
    aLM.trips = [0, 1, 2].map((k) => {
      const t0 = aLM.t0 + 0.4 + k * ((PACE.losaMoldaje - 0.8) / 3);
      return { t0, t1: t0 + (PACE.losaMoldaje - 0.8) / 3, walls: [], x: bx.x0 + ((k + 0.5) / 3) * (bx.x1 - bx.x0), z: bx.cz, y: yWork + 2.6 };
    });
    aLF.trips = [0, 1, 2].map((k) => {
      const t0 = aLF.t0 + k * (PACE.losaFierro / 3);
      return { t0, t1: t0 + PACE.losaFierro / 3, walls: [], x: bx.x0 + ((k + 0.5) / 3) * (bx.x1 - bx.x0), z: bx.cz, y: levels[S].slab.y0 + 0.4 };
    });
    // hormigonado con dos mixers: el primero entra en retroceso al comenzar la actividad y el
    // segundo después del cambio (la bomba se detiene unos instantes en el cambio, ver pumpStop)
    const pour: [number, number] = [aLH.t0 + 4.4, aLH.t1 - 1.6];
    slab[S] = {
      props: [aLM.t0 + 0.2, aLM.t0 + PACE.losaMoldaje * 0.55],
      deck: [aLM.t0 + PACE.losaMoldaje * 0.3, aLM.t1 - 0.3],
      rebar: [aLF.t0 + 0.3, aLF.t1 - 0.4],
      pour,
      pumpStop: pumpStopIn(...pour),
      propsOut: [1e7, 1e7],
      deckOut: [1e7, 1e7],
    };
  }

  // --- Obra gruesa sobre la losa de techumbre ----------------------------------------------
  // Parapetos (V.I. 15/80 y testeros, +17,50 → +18,14) y muros de la caja de escala y sala de
  // máquinas (+17,50 → +19,93) con el mismo ciclo que los muros de piso: la grúa sube fierro y
  // paneles y hormigona con capacho. Después, la losa de cielo de la caja, también con capacho.
  const geo = buildRoofGeometry(data);
  const RL = levels.length - 1;
  const roofWalls = [...geo.parapets, ...geo.box.walls];
  // los parapetos en el orden del contorno (cada grupo queda en un mismo tramo de fachada) y la caja al final
  const rOrder = roofWalls.map((_, i) => i);
  const rWall: WallTiming[] = roofWalls.map(() => ({ rebar: [0, 0], form: [0, 0], pour: [0, 0], strip: [0, 0] }));
  const topOf = (g: number[]) => Math.max(...g.map((i) => roofWalls[i].y1));
  /** Punto de trabajo de un grupo: el centro del tramo del medio (queda sobre el muro, no al centro de la losa). */
  const mid = (g: number[]) => {
    const b = polyBounds(roofWalls[g[Math.floor(g.length / 2)]].poly);
    return { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 };
  };
  const aRF = push('techoFierro', RL, PACE.techoFierro, DAYS.techoFierro, 'Techumbre · Enfierradura de parapetos y caja de escala',
    'La grúa trepa la bandeja perimetral a la techumbre; mallas Ø8a20 de los parapetos y de los muros de la caja de escala y sala de máquinas sobre las esperas de la losa');
  rOrder.forEach((wi, k) => {
    const s = aRF.t0 + 0.6 + (k / rOrder.length) * (PACE.techoFierro - 2.2);
    rWall[wi].rebar = [s, s + 1.4];
  });
  aRF.trips = groups(rOrder, 3).map((g, k) => {
    // el paquete de fierro se deja sobre la losa, 1,6 m hacia adentro del tramo
    const m = mid(g);
    const dx = geo.box.cx - m.x, dz = geo.box.cz - m.z, dl = Math.hypot(dx, dz) || 1;
    const c = { x: m.x + (dx / dl) * Math.min(1.6, dl), z: m.z + (dz / dl) * Math.min(1.6, dl) };
    const t0 = aRF.t0 + k * (PACE.techoFierro / 3);
    return { t0, t1: t0 + PACE.techoFierro / 3, walls: g, x: c.x, z: c.z, y: geo.y + 0.3 };
  });
  const aRM = push('techoMoldaje', RL, PACE.techoMoldaje, DAYS.techoMoldaje, 'Techumbre · Moldaje de parapetos y caja de escala',
    'Paneles metálicos a ambas caras; la cara exterior de los parapetos se arma desde la bandeja perimetral');
  const gRM = groups(rOrder, 4);
  const tripRM = PACE.techoMoldaje / gRM.length;
  aRM.trips = gRM.map((g, k) => {
    const c = mid(g);
    const t0 = aRM.t0 + k * tripRM;
    const place = t0 + tripRM * 0.62;
    g.forEach((wi, j) => (rWall[wi].form = [place + j * 0.04, place + j * 0.04 + 0.9]));
    return { t0, t1: t0 + tripRM, walls: g, x: c.x, z: c.z, y: topOf(g) };
  });
  const aRH = push('techoHormigon', RL, PACE.techoHormigon, DAYS.techoHormigon, 'Techumbre · Hormigonado de parapetos y caja de escala',
    'Hormigón G25 con capacho de 1 m³ desde el mixer');
  const gRH = groups(rOrder, 6);
  const leadR = 2.2, tailR = 1.4;
  const tripRH = (PACE.techoHormigon - leadR - tailR) / gRH.length;
  aRH.trips = gRH.map((g, k) => {
    const c = mid(g);
    const t0 = aRH.t0 + leadR + k * tripRH;
    g.forEach((wi) => (rWall[wi].pour = [t0 + tripRH * 0.55, t0 + tripRH * 0.86]));
    return { t0, t1: t0 + tripRH, walls: g, x: c.x, z: c.z, y: topOf(g) };
  });
  const aRD = push('techoDesmolde', RL, PACE.techoDesmolde, DAYS.techoDesmolde, 'Techumbre · Desmolde de parapetos y caja de escala',
    'Retiro de paneles; la grúa baja la bandeja perimetral');
  const gRD = groups(rOrder, 3);
  const tripRD = PACE.techoDesmolde / gRD.length;
  aRD.trips = gRD.map((g, k) => {
    const c = mid(g);
    const t0 = aRD.t0 + k * tripRD;
    const lift = t0 + tripRD * 0.18;
    g.forEach((wi, j) => (rWall[wi].strip = [lift + j * 0.03, lift + j * 0.03 + tripRD * 0.5]));
    return { t0, t1: t0 + tripRD, walls: g, x: c.x, z: c.z, y: topOf(g) };
  });
  // losa de cielo de la caja (losas 801–804, e = 16): la grúa baja puntales, placas y fierro dentro de
  // la caja y la hormigona con capacho (5,8 m³)
  const aRS = push('salaLosa', RL, PACE.salaLosa, DAYS.salaLosa, 'Techumbre · Losa de cielo de la caja de escala',
    'Puntales, placas fenólicas y malla Ø8–Ø10 sobre los muros de la caja; hormigón G25 con capacho');
  const TS = (f: number) => aRS.t0 + f * PACE.salaLosa;
  const bx = polyBounds(geo.box.outline);
  // puntales, placas y fierro (0 a 45 %); la grúa engancha el capacho (45 a 60 %) y hormigona
  aRS.trips = [0, 1, 2].map((k) => ({ t0: TS(k * 0.15), t1: TS((k + 1) * 0.15), walls: [], x: geo.box.cx, z: geo.box.cz, y: k < 2 ? geo.y + 0.3 : TECHO.caja.muroTop + 0.15 }));
  const nCap = 3, cap0 = TS(0.6), dCap = (TS(0.97) - cap0) / nCap;
  const slabCapacho: Trip[] = Array.from({ length: nCap }, (_, k) => ({
    t0: cap0 + k * dCap, t1: cap0 + (k + 1) * dCap, walls: [], x: geo.box.cx, z: bx.z0 + ((k + 0.5) / nCap) * (bx.z1 - bx.z0), y: TECHO.caja.losaTop,
  }));
  aRS.trips.push(...slabCapacho);
  const roofSlab: RoofSchedule['slab'] = {
    props: [TS(0.1), TS(0.3)], deck: [TS(0.22), TS(0.45)], rebar: [TS(0.42), TS(0.58)],
    pour: [slabCapacho[0].t0 + dCap * 0.55, slabCapacho[nCap - 1].t0 + dCap * 0.86], out: [1e7, 1e7],
  };

  // Los puntales de una losa se retiran cuando ya hay dos losas más arriba (re-apuntalamiento simplificado).
  for (let S = 1; S < slab.length; S++) {
    const later = acts.find((a) => a.kind === 'muroDesmolde' && a.level === S + 1);
    if (later) {
      slab[S].propsOut = [later.t0, later.t1];
      slab[S].deckOut = [later.t0, later.t1];
    }
  }

  // --- Radier del 1er piso: fuera de la ruta crítica ------------------------------------
  // No se hormigona después de las fundaciones: el 1er piso queda con relleno compactado
  // mientras se colocan y prueban las redes que van bajo el radier (alcantarillado, agua
  // potable) y mientras está ocupado por puntales y acopios. En la visita (09-10-2026) la
  // obra tenía el 5° piso terminado y aún sin radier. Aquí las instalaciones se hacen en
  // paralelo con los pisos 5 y 6, y el radier con los muros del 7° piso.
  const dayOf = (time: number) => {
    const a = acts.find((x) => time >= x.t0 && time < x.t1) ?? acts[acts.length - 1];
    return a.d0 + ((time - a.t0) / (a.t1 - a.t0)) * (a.d1 - a.d0);
  };
  const find = (kind: ActivityKind, level: number) => acts.find((a) => a.kind === kind && a.level === level)!;
  const par = (kind: ActivityKind, t0: number, t1: number, title: string, detail: string): Activity => ({
    id: `${kind}-par`, kind, level: 0, levelName: levels[0].name, t0, t1, d0: dayOf(t0), d1: dayOf(t1), title, detail, trips: [],
  });
  const lastWalls = nWallLevels - 1;
  const inst = par('instalaciones', find('muroFierro', lastWalls - 2).t0, find('losaHormigon', lastWalls).t1,
    'Instalaciones bajo radier', 'Alcantarillado PVC y agua potable HDPE en zanjas bajo el 1er piso, con pruebas de presión');
  const rStart = find('muroFierro', lastWalls).t0 + 0.6;
  // termina antes que el moldaje de muros: el último mixer del radier debe salir por el camino (que
  // es uno solo) antes de que entre en retroceso el mixer del hormigonado de muros del 7P
  const rEnd = find('muroMoldaje', lastWalls).t1 - 3.6;
  const radier = par('radier', rStart, rEnd, 'Radier 1er piso', 'Radier e=10 cm sobre relleno compactado, con bomba estacionaria');
  const rDur = rEnd - rStart;
  // un solo mixer (no cabe un cambio de camión): entra en retroceso cuando el último de la losa de
  // techumbre del 6P ya salió por el portón (≈ 7 s después de empezar el radier) y sale antes de
  // que llegue el del capacho; la bomba no se detiene (pumpStop vacío)
  const rPour: [number, number] = [rStart + 7.4, rEnd - 0.4];
  slab[0] = {
    props: [rStart, rStart], deck: [rStart, rStart], rebar: [rStart, rStart + rDur * 0.32],
    pour: rPour, pumpStop: [rPour[1], rPour[1]], propsOut: [1e7, 1e7], deckOut: [1e7, 1e7],
  };
  const parallel: Activity[] = [inst, radier];

  // --- Terminaciones: tabiquería, ventanas, barandas, pintura de fachada, piso a piso ---
  const aT0 = t;
  for (let L = 0; L < nWallLevels; L++) {
    const a = push('terminaciones', L, PACE.terminacionesPorPiso, DAYS.terminacionesPorPiso, `${levels[L].name} · Terminaciones`, 'Tabiques, ventanas de PVC, barandas y pintura de fachada');
    finish[L] = [a.t0, a.t1];
  }
  // retiro de puntales pendientes antes de terminaciones
  for (let S = 1; S < slab.length; S++) {
    if (slab[S].propsOut[0] >= 1e7) {
      slab[S].propsOut = [aT0, aT0 + 3];
      slab[S].deckOut = [aT0, aT0 + 3];
    }
  }

  // --- Techumbre (itemizado cap. 3) en paralelo con las terminaciones -----------------------
  // Los días salen del cronograma detallado (TECHO.dias) contados desde el término de la losa de
  // la caja; cada partida avanza a lo largo del edificio, de −x a +x, como el plan de la cubierta.
  const tAtDay = (day: number) => {
    for (const a of acts) if (day <= a.d1) return a.t0 + ((day - a.d0) / Math.max(a.d1 - a.d0, 1e-6)) * (a.t1 - a.t0);
    return acts[acts.length - 1].t1;
  };
  const D = TECHO.dias;
  const dR = aRS.d1 + D.desfase;
  const win = (d0: number, n: number): [number, number] => [tAtDay(d0), tAtDay(d0 + n)];
  const estructura = win(dR, D.estructura);
  const aislacion = win(dR + D.aislacion[0], D.aislacion[1]);
  const cubierta = win(dR + D.cubierta[0], D.cubierta[1]);
  const aguas = win(dR + D.aguas[0], D.aguas[1]);
  const ascensor = win(dR + D.cubierta[0] + D.cubierta[1], D.ascensor);
  const gruaOut = tAtDay(dR + D.estructura + D.grua);
  const roofPar = (kind: ActivityKind, w: [number, number], title: string, detail: string): Activity => ({
    id: `${kind}-par`, kind, level: RL, levelName: levels[RL].name, t0: w[0], t1: w[1], d0: dayOf(w[0]), d1: dayOf(w[1]), title, detail, trips: [],
  });
  parallel.push(
    roofPar('estructuraTecho', estructura, 'Estructura de techumbre',
      'Cerchas y costaneras de pino impregnado con tapa OSB sobre la losa (666,94 m²; 1 carpintero + 1 ayudante, 22 m²/día)'),
    roofPar('aislacionTecho', aislacion, 'Aislación bajo cubierta', 'Aislán sobre la tapa OSB (35 m²/día)'),
    roofPar('cubiertaTecho', cubierta, 'Cubierta y hojalatería',
      'Zincalum prepintado 0,5 mm emballetado, canales, forros de parapeto, cumbrera y ventilaciones (1 hojalatero + 1 ayudante, 20 m²/día)'),
    roofPar('aguasLluvia', aguas, 'Aguas lluvia', 'Cubetas y bajadas de PVC Ø160 en las esquinas y Ø110 desde la caja de escala'),
    roofPar('ascensor', ascensor, 'Subcontrato de ascensores', 'Montaje del ascensor de 7 paradas y 630 kg, con la sala de máquinas y la cubierta terminadas'),
  );
  // la losa de la caja se descimbra cuando parte la estructura de techumbre
  roofSlab.out = [estructura[0], estructura[0] + 1.2];
  const fxR = (x: number) => Math.min(Math.max((x - geo.x0) / Math.max(geo.x1 - geo.x0, 1e-3), 0), 1);
  /** Ventana de cada capa y fracción de ella en que llega a cada x (la estructura deja atrás la tapa OSB). */
  const LAYER: Record<RoofLayer, { w: [number, number]; a: number; b: number }> = {
    estructura: { w: estructura, a: 0.07, b: 0.85 },
    aislacion: { w: aislacion, a: 0.04, b: 0.9 },
    cubierta: { w: cubierta, a: 0.05, b: 0.85 },
  };
  const layerAt = (layer: RoofLayer, x: number) => {
    const L = LAYER[layer];
    return L.w[0] + (L.a + L.b * fxR(x)) * (L.w[1] - L.w[0]);
  };
  const frontAt = (layer: RoofLayer, time: number) => {
    const L = LAYER[layer];
    const k = ((time - L.w[0]) / Math.max(L.w[1] - L.w[0], 1e-6) - L.a) / L.b;
    return geo.x0 + Math.min(Math.max(k, 0), 1) * (geo.x1 - geo.x0);
  };
  // materiales de la techumbre: la grúa los sube antes de que la desmonten, delante del frente de trabajo
  const loadSpec: [RoofSchedule['loads'][number]['kind'], string][] = [
    ['timber', 'Paquete de cerchas y costaneras de pino impregnado'],
    ['timber', 'Tableros OSB para la tapa de la techumbre'],
    ['sheets', 'Rollos de Aislán para la aislación bajo cubierta'],
    ['sheets', 'Planchas de zincalum emballetado'],
  ];
  const loads: RoofSchedule['loads'] = loadSpec.map(([kind, task], k) => {
    const [t0, t1] = win(dR + k * 8, 7.5);
    const x = Math.min(Math.max(frontAt('estructura', t1) + 7, geo.x0 + 3), geo.x1 - 3);
    return { t0, t1, kind, x, z: geo.ridgeZ - 2.6, y: geo.y + 0.3, task };
  });

  const duration = t + 4;
  const sched: Schedule = {
    activities: acts,
    parallel,
    duration,
    totalDays: d,
    wall,
    slab,
    fund: fundPlan,
    finish,
    roof: {
      geo, walls: roofWalls, wall: rWall, slab: roofSlab, slabCapacho, gruesa: [aRF.t0, aRS.t1],
      estructura, aislacion, cubierta, aguas, ascensor, gruaOut, loads, layerAt, frontAt,
      topAt(x, z, time) {
        if (pointInPolygon(x, z, geo.box.outline)) return time >= roofSlab.pour[1] ? TECHO.caja.losaTop : geo.y;
        if (time < layerAt('estructura', x)) return geo.y;
        return geo.y + geo.rise(z) - (time < layerAt('cubierta', x) ? 0.012 : 0);
      },
    },
    levelNames: levels.map((l) => l.name),
    at(time: number) {
      let lo = 0, hi = acts.length - 1;
      if (time <= acts[0].t0) return acts[0];
      if (time >= acts[hi].t1) return acts[hi];
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (acts[mid].t0 <= time) lo = mid; else hi = mid - 1;
      }
      return acts[lo];
    },
    dayAt(time: number) {
      const a = sched.at(time);
      // en las fundaciones cada día dura distinto (ver fundPlan)
      if (a.kind === 'fundaciones') return a.d0 + fundPlan.dayAt(time);
      const k = Math.min(Math.max((time - a.t0) / (a.t1 - a.t0), 0), 1);
      return a.d0 + k * (a.d1 - a.d0);
    },
  };
  return sched;
}
