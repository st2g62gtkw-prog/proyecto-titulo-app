/**
 * Cronograma de obra gruesa del Edificio E (método tradicional de hormigón armado).
 *
 * Secuencia por piso, como se hace en terreno:
 *   Muros:  enfierradura → moldaje (lo sube la grúa) → hormigonado con capacho → desmolde
 *   Losa:   moldaje (puntales, vigas y placas) → enfierradura → hormigonado con camión bomba
 *
 * El tiempo de simulación T está en "segundos de animación". Cada actividad tiene además
 * su duración real en días hábiles para mostrar el calendario.
 */
import type { BuildingData, LevelData, WallData } from '../data/building';
import { DAYS, PACE } from '../config';
import { polyBounds } from '../scene/geom';

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
  | 'terminaciones'
  | 'instalaciones';

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

export interface Schedule {
  activities: Activity[];
  /** Actividades fuera de la ruta crítica que corren en paralelo (instalaciones bajo radier, radier). */
  parallel: Activity[];
  duration: number;
  totalDays: number;
  /** Tiempos por muro HA: wall[level][i] (índice dentro de haWalls(level)). */
  wall: WallTiming[][];
  /** Tiempos por losa (índice de piso de la losa, 1..7 = 2P..Techumbre; 0 = radier). */
  slab: {
    props: [number, number];
    deck: [number, number];
    rebar: [number, number];
    pour: [number, number];
    propsOut: [number, number];
    deckOut: [number, number];
  }[];
  foundations: [number, number];
  /** Hormigonado de zapatas bajo cada muro HA del 1P (mismo índice que haWalls(1P)). */
  footing: [number, number][];
  /** Ventanas de terminaciones por piso. */
  finish: [number, number][];
  levelNames: string[];
  at(t: number): Activity;
  dayAt(t: number): number;
}

export function haWalls(level: LevelData): WallData[] {
  return level.walls.filter((w) => w.ha);
}

/** Orden de trabajo de los muros: por sectores a lo largo del edificio (de poniente a oriente en x). */
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
  const fund = push('fundaciones', 0, PACE.fundaciones, DAYS.fundaciones, 'Fundaciones', 'Zapatas corridas G25 con capacho, sello en maicillo (−1,11 a −2,61 m)');
  const walls0 = haWalls(levels[0]);
  const gF = groups(wallOrder(walls0), 5);
  const footing: [number, number][] = walls0.map(() => [0, 0]);
  const leadF = 2.0;
  const tripF = (PACE.fundaciones - leadF - 1.2) / gF.length;
  fund.trips = gF.map((g, k) => {
    const c = groupCenter(walls0, g);
    const t0 = fund.t0 + leadF + k * tripF;
    g.forEach((wi) => (footing[wi] = [t0 + tripF * 0.55, t0 + tripF * 0.86]));
    return { t0, t1: t0 + tripF, walls: g, x: c.x, z: c.z, y: 0.9 };
  });
  for (let L = 0; L < nWallLevels; L++) {
    const lv = levels[L];
    const walls = haWalls(lv);
    const order = wallOrder(walls);
    const timing: WallTiming[] = walls.map(() => ({ rebar: [0, 0], form: [0, 0], pour: [0, 0], strip: [0, 0] }));
    const yWork = lv.slab.y1;
    const piso = `Piso ${L + 1}`;

    // 1) Enfierradura de muros: avanza por sectores; la grúa sube paquetes de fierro.
    const aF = push('muroFierro', L, PACE.muroFierro, DAYS.muroFierro, `${piso} · Enfierradura de muros`,
      L > 0 ? 'Se arma el andamio perimetral con malla; mallas Ø8–Ø12 A630-420H sobre los arranques' : 'Mallas Ø8–Ø12 A630-420H amarradas sobre los arranques de las zapatas');
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
    slab[S] = {
      props: [aLM.t0 + 0.2, aLM.t0 + PACE.losaMoldaje * 0.55],
      deck: [aLM.t0 + PACE.losaMoldaje * 0.3, aLM.t1 - 0.3],
      rebar: [aLF.t0 + 0.3, aLF.t1 - 0.4],
      pour: [aLH.t0 + 4.2, aLH.t1 - 3.4],
      propsOut: [1e7, 1e7],
      deckOut: [1e7, 1e7],
    };
  }

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
  const rEnd = find('muroMoldaje', lastWalls).t1 - 0.6;
  const radier = par('radier', rStart, rEnd, 'Radier 1er piso', 'Radier e=10 cm sobre relleno compactado, con bomba estacionaria');
  const rDur = rEnd - rStart;
  slab[0] = {
    props: [rStart, rStart], deck: [rStart, rStart], rebar: [rStart, rStart + rDur * 0.32],
    pour: [rStart + rDur * 0.4, rEnd - 0.4], propsOut: [1e7, 1e7], deckOut: [1e7, 1e7],
  };
  const parallel = [inst, radier];

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

  const duration = t + 4;
  const sched: Schedule = {
    activities: acts,
    parallel,
    duration,
    totalDays: d,
    wall,
    slab,
    foundations: [fund.t0 + 1, fund.t1 - 1],
    footing,
    finish,
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
      const k = Math.min(Math.max((time - a.t0) / (a.t1 - a.t0), 0), 1);
      return a.d0 + k * (a.d1 - a.d0);
    },
  };
  return sched;
}
