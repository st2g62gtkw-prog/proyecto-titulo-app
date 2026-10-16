/** Bitácora de obra: eventos fechados que se muestran en el tablero. */
import { SLAB_M3, WALL_M3 } from '../data/project';
import { DAYS_PER_MONTH } from '../config';
import type { Logistics } from './logistics';
import type { Schedule } from './schedule';

export type FeedKind = 'mixer' | 'crane' | 'pump' | 'info' | 'ok';
export interface FeedEvent {
  t: number;
  text: string;
  kind: FeedKind;
}

export function buildFeed(sched: Schedule, log: Logistics): FeedEvent[] {
  const ev: FeedEvent[] = [];
  const fmt = (n: number) => n.toLocaleString('es-CL', { maximumFractionDigits: 1 });
  for (const a of sched.activities) {
    ev.push({ t: a.t0, text: `Inicio: ${a.title}`, kind: 'info' });
    if (a.kind === 'muroHormigon') ev.push({ t: a.t1 - 0.5, text: `Muros ${a.levelName} hormigonados · ${fmt(WALL_M3[a.levelName] ?? 0)} m³`, kind: 'ok' });
    if (a.kind === 'muroMoldaje') ev.push({ t: a.t0 + 0.3, text: `Grúa sube paneles de moldaje al ${a.levelName}`, kind: 'crane' });
    if (a.kind === 'muroFierro') ev.push({ t: a.t0 + 0.3, text: `Grúa sube paquetes de fierro al ${a.levelName}`, kind: 'crane' });
    if (a.kind === 'muroFierro' && a.level > 0) {
      ev.push(a.level === 1
        ? { t: a.t0 + 0.1, text: `Bandeja perimetral en ménsulas armada en el ${a.levelName}`, kind: 'info' }
        : { t: a.t0 + 0.7, text: `Grúa trepa la bandeja perimetral en ménsulas al ${a.levelName}`, kind: 'crane' });
    }
    if (a.kind === 'losaHormigon') {
      const p = sched.slab[a.level].pour;
      ev.push({ t: p[1], text: `${a.levelName === 'Techumbre' ? 'Losa de techumbre' : `Losa de piso ${a.levelName}`} hormigonada · ${fmt(SLAB_M3[a.levelName] ?? 0)} m³`, kind: 'ok' });
    }
  }
  const rad = sched.slab[0].pour;
  ev.push({ t: rad[1], text: 'Radier del 1er piso hormigonado · 665,7 m²', kind: 'ok' });
  for (const m of log.mixers) {
    ev.push({ t: m.arrive[0] + 1, text: `Mixer N° ${m.id} ingresa por el portón norponiente · 7 m³ G25`, kind: 'mixer' });
    ev.push({ t: m.discharge[0], text: m.spot === 'bomba' ? `Mixer N° ${m.id} descarga en tolva de la bomba` : `Mixer N° ${m.id} carga el capacho`, kind: 'mixer' });
  }
  for (const p of log.pours) {
    const name = p.slab === 0 ? 'radier del 1er piso' : sched.levelNames[p.slab] === 'Techumbre' ? 'losa de techumbre' : `losa de piso ${sched.levelNames[p.slab]}`;
    ev.push({ t: p.pour[0] - 0.3, text: `Bomba estacionaria: se arma la tubería hasta la ${p.slab === 0 ? 'zona del radier' : 'losa por el shaft del ascensor'}`, kind: 'pump' });
    ev.push({ t: p.pour[0], text: `Bomba estacionaria inicia el hormigonado ${p.slab === 0 ? 'del' : 'de la'} ${name}`, kind: 'pump' });
  }
  for (const a of sched.parallel) ev.push({ t: a.t0, text: `En paralelo: ${a.title.toLowerCase()}`, kind: 'info' });
  return ev.sort((a, b) => a.t - b.t);
}

/** Etiqueta de calendario en días hábiles: "Día 145 · Mes 7". */
export function dayLabel(day: number) {
  const d = Math.floor(day);
  return `Día ${d + 1} · Mes ${Math.floor(d / DAYS_PER_MONTH) + 1}`;
}

/** Etiqueta corta para la bitácora: "D145". */
export function dayShort(day: number) {
  return `D${Math.floor(day) + 1}`;
}
