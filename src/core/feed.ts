/** Bitácora de obra: eventos fechados que se muestran en el tablero. */
import { SLAB_M3, WALL_M3 } from '../data/project';
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
    if (a.kind === 'losaHormigon') {
      const p = sched.slab[a.level].pour;
      ev.push({ t: p[1], text: `${a.levelName === 'Techumbre' ? 'Losa de techumbre' : `Losa de piso ${a.levelName}`} hormigonada · ${fmt(SLAB_M3[a.levelName] ?? 0)} m³`, kind: 'ok' });
    }
    if (a.kind === 'radier') ev.push({ t: a.t1 - 0.5, text: 'Radier del 1er piso terminado · 665,7 m²', kind: 'ok' });
  }
  for (const m of log.mixers) {
    ev.push({ t: m.arrive[0] + 1, text: `Mixer N° ${m.id} ingresa por portón poniente · 7 m³ G25`, kind: 'mixer' });
    ev.push({ t: m.discharge[0], text: m.spot === 'bomba' ? `Mixer N° ${m.id} descarga en tolva de la bomba` : `Mixer N° ${m.id} carga el capacho`, kind: 'mixer' });
  }
  for (const p of log.pumps) {
    ev.push({ t: p.arrive[1], text: 'Camión bomba en posición, despliega estabilizadores', kind: 'pump' });
    ev.push({ t: p.pour[0], text: 'Bomba inicia hormigonado de losa', kind: 'pump' });
  }
  return ev.sort((a, b) => a.t - b.t);
}

/** Etiqueta de calendario: "Día 34 · 10:20" (jornada 08:00–18:00). */
export function dayLabel(day: number) {
  const d = Math.floor(day);
  const mins = Math.floor((day - d) * 600);
  const h = 8 + Math.floor(mins / 60);
  const m = mins % 60;
  return `Día ${d + 1} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
