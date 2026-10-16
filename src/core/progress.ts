/**
 * Indicadores de avance (hormigón, acero, moldaje, mixers, capachos) calculados
 * desde el cronograma y las cantidades reales de la cubicación.
 */
import { EQUIPMENT, RATIOS, ROOF_WALL_M3, SLAB_M3, TOTALS, WALL_M3 } from '../data/project';
import type { Activity, ActivityKind, Schedule } from './schedule';

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
  let hormigon = 0, hormigonMuros = 0, acero = 0, moldaje = 0, losas = 0;
  let daysDone = 0, daysTotal = 0;
  const wallLevels = sched.wall.length;
  const extraM3 = ROOF_WALL_M3 / wallLevels; // parapetos y sala de máquinas repartidos
  for (const a of acts) {
    const k = k01(t, a.t0, a.t1);
    const wallM3 = (WALL_M3[a.levelName] ?? 0) + extraM3;
    const slabName = names[a.level];
    const slabM3 = SLAB_M3[slabName] ?? 0;
    switch (a.kind) {
      case 'fundaciones':
        hormigon += TOTALS.hormigonFundaciones * k;
        acero += TOTALS.aceroFundaciones * k;
        moldaje += TOTALS.moldajeFundaciones * k;
        break;
      case 'muroFierro':
        acero += wallM3 * RATIOS.aceroMuroPorM3 * k;
        break;
      case 'muroMoldaje':
        moldaje += wallM3 * RATIOS.moldajeMuroPorM3 * k;
        break;
      case 'muroHormigon':
        hormigon += wallM3 * k;
        hormigonMuros += wallM3 * k;
        break;
      case 'losaMoldaje':
        moldaje += slabM3 * RATIOS.moldajeLosaPorM3 * k;
        break;
      case 'losaFierro':
        acero += slabM3 * RATIOS.aceroLosaPorM3 * k;
        break;
      case 'losaHormigon': {
        const p = sched.slab[a.level].pour;
        const kp = k01(t, p[0], p[1]);
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
  const rad = sched.slab[0].pour;
  const radM3 = TOTALS.radier * 0.1 * k01(t, rad[0], rad[1]);
  const mixers = Math.floor((hormigon + radM3) / EQUIPMENT.mixerM3 + 1e-6);
  const capachos = Math.floor(hormigonMuros / EQUIPMENT.capachoM3 + 1e-6);

  const floors = names.map((name, L) => {
    const own = [...acts, ...sched.parallel].filter((a) => a.kind !== 'terminaciones' && ((a.kind.startsWith('muro') && a.level === L) || (a.kind.startsWith('losa') && a.level === L) || (L === 0 && (a.kind === 'fundaciones' || a.kind === 'radier'))));
    const tot = own.reduce((s, a) => s + (a.t1 - a.t0), 0);
    const done = own.reduce((s, a) => s + (a.t1 - a.t0) * k01(t, a.t0, a.t1), 0);
    const p = tot > 0 ? done / tot : 0;
    const state: 'done' | 'active' | 'todo' = p >= 0.999 ? 'done' : p > 0 ? 'active' : 'todo';
    return { name, state, progress: p };
  });

  return { hormigon, hormigonMuros, acero, moldaje, mixers, capachos, losas, obraGruesa: daysTotal ? daysDone / daysTotal : 0, floors };
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
