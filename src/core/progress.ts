/**
 * Indicadores de avance (hormigón, acero, moldaje, mixers, capachos) calculados
 * desde el cronograma y las cantidades reales de la cubicación.
 */
import { EQUIPMENT, RATIOS, ROOF_WALL_M3, SALA_LOSA_M3, SLAB_M3, TOTALS, WALL_M3 } from '../data/project';
import { pourFrac, type Activity, type ActivityKind, type Schedule } from './schedule';

/** Obra gruesa sobre la losa de techumbre (ruta crítica). */
const ROOF_GRUESA: ActivityKind[] = ['techoFierro', 'techoMoldaje', 'techoHormigon', 'techoDesmolde', 'salaLosa'];

const k01 = (t: number, a: number, b: number) => Math.min(Math.max((t - a) / Math.max(b - a, 1e-6), 0), 1);

export interface Progress {
  hormigon: number;
  hormigonMuros: number;
  acero: number;
  moldaje: number;
  mixers: number;
  capachos: number;
  losas: number;
  /** Avance de obra gruesa ponderado por días hábiles (0..1). */
  obraGruesa: number;
  /** Avance de cada piso (0..1) y estado. */
  floors: { name: string; state: 'done' | 'active' | 'todo'; progress: number }[];
}

export const FLOOR_STEPS: { kind: ActivityKind; label: string }[] = [
  { kind: 'muroFierro', label: 'Bandeja y enfierradura de muros' },
  { kind: 'muroMoldaje', label: 'Moldaje de muros' },
  { kind: 'muroHormigon', label: 'Hormigonado con capacho' },
  { kind: 'muroDesmolde', label: 'Desmolde' },
  { kind: 'losaMoldaje', label: 'Moldaje de losa' },
  { kind: 'losaFierro', label: 'Enfierradura de losa' },
  { kind: 'losaHormigon', label: 'Hormigonado con bomba estacionaria' },
];

export function computeProgress(sched: Schedule, t: number): Progress {
  const acts = sched.activities;
  const names = sched.levelNames;
  let hormigon = 0, hormigonMuros = 0, acero = 0, moldaje = 0, losas = 0, fundCapachos = 0;
  let daysDone = 0, daysTotal = 0;
  for (const a of acts) {
    const k = k01(t, a.t0, a.t1);
    // los parapetos y los muros de la caja de escala tienen su propio ciclo en la techumbre
    const wallM3 = a.kind.startsWith('techo') ? ROOF_WALL_M3 : WALL_M3[a.levelName] ?? 0;
    const slabName = names[a.level];
    const slabM3 = SLAB_M3[slabName] ?? 0;
    switch (a.kind) {
      case 'fundaciones': {
        // cantidades de la cubicación según avanza cada sector (emplantillado, zapatas, capachos)
        const q = sched.fund.quantities(t);
        hormigon += Math.min(q.hormigon, TOTALS.hormigonFundaciones);
        acero += Math.min(q.acero, TOTALS.aceroFundaciones);
        moldaje += Math.min(q.moldaje, TOTALS.moldajeFundaciones);
        fundCapachos = q.capachos;
        break;
      }
      case 'muroFierro':
      case 'techoFierro':
        acero += wallM3 * RATIOS.aceroMuroPorM3 * k;
        break;
      case 'muroMoldaje':
      case 'techoMoldaje':
        moldaje += wallM3 * RATIOS.moldajeMuroPorM3 * k;
        break;
      case 'muroHormigon':
      case 'techoHormigon':
        hormigon += wallM3 * k;
        hormigonMuros += wallM3 * k;
        break;
      case 'salaLosa': {
        // losa de la caja con capacho: moldaje y fierro antes del hormigón (cuenta como muros para los capachos)
        const S = sched.roof.slab;
        const kp = k01(t, S.pour[0], S.pour[1]);
        moldaje += SALA_LOSA_M3 * RATIOS.moldajeLosaPorM3 * k01(t, S.props[0], S.deck[1]);
        acero += SALA_LOSA_M3 * RATIOS.aceroLosaPorM3 * k01(t, S.rebar[0], S.rebar[1]);
        hormigon += SALA_LOSA_M3 * kp;
        hormigonMuros += SALA_LOSA_M3 * kp;
        break;
      }
      case 'losaMoldaje':
        moldaje += slabM3 * RATIOS.moldajeLosaPorM3 * k;
        break;
      case 'losaFierro':
        acero += slabM3 * RATIOS.aceroLosaPorM3 * k;
        break;
      case 'losaHormigon': {
        const kp = pourFrac(sched.slab[a.level], t);
        hormigon += slabM3 * kp;
        if (kp >= 1) losas++;
        break;
      }
    }
    if (a.kind !== 'terminaciones') {
      daysTotal += a.d1 - a.d0;
      daysDone += (a.d1 - a.d0) * k;
    }
  }
  // mixers: radier (≈66,6 m³) + todo el hormigón colocado, en camiones de 7 m³
  const radM3 = TOTALS.radier * 0.1 * pourFrac(sched.slab[0], t);
  const mixers = Math.floor((hormigon + radM3) / EQUIPMENT.mixerM3 + 1e-6);
  const capachos = Math.floor(hormigonMuros / EQUIPMENT.capachoM3 + 1e-6) + fundCapachos;

  const floors = names.map((name, L) => {
    // la techumbre suma su losa, los parapetos y la caja de escala
    const own = [...acts, ...sched.parallel].filter((a) => a.kind !== 'terminaciones' && ((a.kind.startsWith('muro') && a.level === L) || (a.kind.startsWith('losa') && a.level === L) || (ROOF_GRUESA.includes(a.kind) && a.level === L) || (L === 0 && (a.kind === 'fundaciones' || a.kind === 'radier'))));
    const tot = own.reduce((s, a) => s + (a.t1 - a.t0), 0);
    const done = own.reduce((s, a) => s + (a.t1 - a.t0) * k01(t, a.t0, a.t1), 0);
    const p = tot > 0 ? done / tot : 0;
    const state: 'done' | 'active' | 'todo' = p >= 0.999 ? 'done' : p > 0 ? 'active' : 'todo';
    return { name, state, progress: p };
  });

  return { hormigon, hormigonMuros, acero, moldaje, mixers, capachos, losas, obraGruesa: daysTotal ? daysDone / daysTotal : 0, floors };
}

/** Pasos de las obras sobre la losa de techumbre: obra gruesa (ruta crítica) y capítulo 3 (en paralelo). */
export const ROOF_STEPS: { kind: ActivityKind; label: string }[] = [
  { kind: 'techoFierro', label: 'Bandeja y enfierradura de parapetos y caja de escala' },
  { kind: 'techoMoldaje', label: 'Moldaje de parapetos y caja' },
  { kind: 'techoHormigon', label: 'Hormigonado con capacho' },
  { kind: 'techoDesmolde', label: 'Desmolde' },
  { kind: 'salaLosa', label: 'Losa de cielo de la caja de escala' },
  { kind: 'estructuraTecho', label: 'Estructura de pino impregnado y OSB' },
  { kind: 'aislacionTecho', label: 'Aislación bajo cubierta' },
  { kind: 'cubiertaTecho', label: 'Cubierta de zincalum y hojalatería' },
  { kind: 'aguasLluvia', label: 'Aguas lluvia' },
];

export function roofSteps(sched: Schedule, t: number) {
  return ROOF_STEPS.map((s) => {
    const act = [...sched.activities, ...sched.parallel].find((x) => x.kind === s.kind);
    const p = act ? k01(t, act.t0, act.t1) : 0;
    return { key: s.kind, label: s.label, state: (p >= 1 ? 'done' : p > 0 ? 'active' : 'todo') as 'done' | 'active' | 'todo', progress: p };
  });
}

/** Pasos de las fundaciones (excavación, sellos, fierro, moldaje, hormigón y relleno). */
export function fundSteps(sched: Schedule, t: number) {
  return sched.fund.steps.map((s) => {
    const p = k01(t, s.win[0], s.win[1]);
    return { key: s.key, label: s.label, state: (p >= 1 ? 'done' : p > 0 ? 'active' : 'todo') as 'done' | 'active' | 'todo', progress: p };
  });
}

/** Pasos del ciclo de piso para el nivel de la actividad actual. */
export function floorSteps(sched: Schedule, a: Activity, t: number) {
  // nivel de muros del ciclo actual: para actividades de losa es el piso de abajo
  const L = a.kind.startsWith('losa') ? a.level - 1 : a.level;
  return FLOOR_STEPS.map((s) => {
    const lvl = s.kind.startsWith('losa') ? L + 1 : L;
    const act = sched.activities.find((x) => x.kind === s.kind && x.level === lvl);
    if (!act) return { key: s.kind, label: s.label, state: 'todo' as const, progress: 0 };
    const p = k01(t, act.t0, act.t1);
    return { key: s.kind, label: s.label, state: (p >= 1 ? 'done' : p > 0 ? 'active' : 'todo') as 'done' | 'active' | 'todo', progress: p };
  });
}
