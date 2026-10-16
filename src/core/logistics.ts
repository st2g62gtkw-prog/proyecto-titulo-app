/**
 * Logística de hormigón: llegada de mixers, colas y salidas. Los muros se hormigonan con
 * capacho; las losas y el radier con la bomba estacionaria que queda fija en su caseta.
 * Igual que la grúa, todo es función del tiempo de simulación.
 */
import { SITE } from '../config';
import { Route, easeTravel, type Pose } from './paths';
import type { Schedule } from './schedule';

export interface MixerVisit {
  id: number;
  /** 'capacho' = descarga al capacho de la grúa; 'bomba' = alimenta la tolva de la bomba. */
  spot: 'capacho' | 'bomba';
  inRoute: Route;
  outRoute: Route;
  arrive: [number, number];
  /** Tramo opcional: espera en cola y luego avanza hasta el punto de descarga. */
  queue?: { wait: Route; move: [number, number] };
  discharge: [number, number];
  leave: [number, number];
}

export interface MixerState {
  id: number;
  pose: Pose;
  chute: number;
  discharging: boolean;
  /** Distancia recorrida (para girar las ruedas). */
  dist: number;
}

/** Hormigonado con la bomba estacionaria (una losa o el radier). */
export interface PumpPour {
  /** Índice de la losa (0 = radier del 1er piso). */
  slab: number;
  pour: [number, number];
}

export interface PumpState {
  pumping: boolean;
  /** Losa que se está hormigonando (o la próxima, si la bomba está detenida). */
  slab: number;
  /** Fracción del hormigonado de la losa (0..1). */
  progress: number;
}

const R = SITE.roadZ, LZ = SITE.loopZ, X0 = SITE.loopX0, X1 = SITE.loopX1;
const G = SITE.gate;
const IN = R - 1.7, OUT = R + 1.7;

/** Entrada desde el portón poniente hasta un punto del camino interior (z = loopZ). */
function entry(xStop: number) {
  const pts: [number, number][] = [[G.x - 8, IN], [G.x, IN], [X0 - 10, IN], [X0 - 2, IN - 1.2], [X0, IN - 4], [X0, LZ + 3.5], [X0 + 3, LZ], [X0 + 9, LZ]];
  return new Route().add([...pts.filter(([x, z]) => z !== LZ || x < xStop - 1.5), [xStop, LZ]]);
}

/** Salida: sigue por el camino interior, sube al camino principal y vuelve al portón. */
function exitFrom(x: number) {
  return new Route().add([
    [x, LZ], [x + 6, LZ], [X1 - 3, LZ], [X1, LZ + 3], [X1, OUT - 3], [X1 - 3, OUT], [X1 - 12, OUT], [G.x, OUT], [G.x - 10, OUT],
  ]);
}

/** Recorre una ruta entre t0 y t1 con aceleración suave. */
function travel(route: Route, t: number, [t0, t1]: [number, number]) {
  const u = easeTravel((t - t0) / (t1 - t0));
  const s = u * route.length;
  return { pose: route.at(s), dist: s };
}

export class Logistics {
  mixers: MixerVisit[] = [];
  pours: PumpPour[] = [];

  constructor(sched: Schedule) {
    let id = 1;
    const cap = SITE.mixerCapacho, pmp = SITE.mixerPump;
    for (const a of sched.activities) {
      if (a.kind === 'muroHormigon' || a.kind === 'fundaciones') {
        const tr = a.trips;
        const fill = (k: number) => tr[k].t0 + (tr[k].t1 - tr[k].t0) * 0.22;
        const fillEnd = (k: number) => tr[k].t0 + (tr[k].t1 - tr[k].t0) * 0.32;
        const half = Math.ceil(tr.length / 2);
        const t1 = a.t0 + 1.9;
        // mixer 1: llega justo antes del primer llenado
        const m1Leave = fillEnd(half - 1) + 0.1;
        this.mixers.push({
          id: id++, spot: 'capacho', inRoute: entry(cap.x), outRoute: exitFrom(cap.x),
          arrive: [t1 - 5, t1], discharge: [fill(0) - 0.4, m1Leave], leave: [m1Leave + 0.15, m1Leave + 5],
        });
        // mixer 2: espera en cola detrás y avanza cuando sale el primero
        const qx = cap.x - 13;
        this.mixers.push({
          id: id++, spot: 'capacho', inRoute: entry(qx), outRoute: exitFrom(cap.x),
          arrive: [m1Leave - 5, m1Leave - 0.3],
          queue: { wait: new Route().add([[qx, LZ], [cap.x, LZ]]), move: [m1Leave + 0.55, fill(half) - 0.25] },
          discharge: [fill(half) - 0.2, fillEnd(tr.length - 1) + 0.1], leave: [fillEnd(tr.length - 1) + 0.3, fillEnd(tr.length - 1) + 5.3],
        });
      }
    }
    // losas y radier: los mixers alimentan la tolva de la bomba estacionaria
    for (const a of [...sched.activities, ...sched.parallel]) {
      if (a.kind !== 'losaHormigon' && a.kind !== 'radier') continue;
      const S = a.kind === 'radier' ? 0 : a.level;
      const pour = sched.slab[S].pour;
      this.pours.push({ slab: S, pour });
      // tres mixers por hormigonado; el siguiente espera en cola detrás del que descarga
      const n = 3;
      const qx = pmp.x - 13;
      for (let k = 0; k < n; k++) {
        const d0 = pour[0] + ((pour[1] - pour[0]) * k) / n;
        const d1 = pour[0] + ((pour[1] - pour[0]) * (k + 1)) / n;
        if (k === 0) {
          this.mixers.push({
            id: id++, spot: 'bomba', inRoute: entry(pmp.x), outRoute: exitFrom(pmp.x),
            arrive: [d0 - 5.2, d0 - 0.6], discharge: [d0 - 0.4, d1 - 0.05], leave: [d1, d1 + 5],
          });
        } else {
          this.mixers.push({
            id: id++, spot: 'bomba', inRoute: entry(qx), outRoute: exitFrom(pmp.x),
            arrive: [d0 - 6, d0 - 1.2],
            queue: { wait: new Route().add([[qx, LZ], [pmp.x, LZ]]), move: [d0 + 0.45, d0 + 1.6] },
            discharge: [d0 + 1.7, d1 - 0.05], leave: [d1, d1 + 5],
          });
        }
      }
    }
    this.pours.sort((p, q) => p.pour[0] - q.pour[0]);
    // numeración correlativa por orden de llegada (también reparte los camiones del pool sin choques)
    this.mixers.sort((p, q) => p.arrive[0] - q.arrive[0]);
    this.mixers.forEach((m, i) => (m.id = i + 1));
  }

  mixerStates(t: number): MixerState[] {
    const out: MixerState[] = [];
    for (const m of this.mixers) {
      if (t < m.arrive[0] || t > m.leave[1]) continue;
      let st: { pose: Pose; dist: number };
      let chute = 0;
      if (t < m.arrive[1]) st = travel(m.inRoute, t, m.arrive);
      else if (m.queue && t < m.queue.move[1]) {
        const base = m.inRoute.length;
        st = t < m.queue.move[0] ? { pose: m.inRoute.at(base), dist: base } : (() => {
          const r = travel(m.queue!.wait, t, m.queue!.move);
          return { pose: r.pose, dist: base + r.dist };
        })();
      } else if (t < m.leave[0]) {
        st = { pose: m.queue ? m.queue.wait.at(m.queue.wait.length) : m.inRoute.at(m.inRoute.length), dist: m.inRoute.length + (m.queue?.wait.length ?? 0) };
        chute = Math.min(1, Math.max(0, (t - (m.discharge[0] - 0.6)) / 0.5), Math.max(0, (m.leave[0] - t) / 0.3));
      } else {
        const r = travel(m.outRoute, t, m.leave);
        st = { pose: r.pose, dist: m.inRoute.length + (m.queue?.wait.length ?? 0) + r.dist };
      }
      out.push({ id: m.id, pose: st.pose, chute, discharging: t >= m.discharge[0] && t <= m.discharge[1], dist: st.dist });
    }
    return out;
  }

  /** Estado de la bomba estacionaria: bombeando durante cada hormigonado de losa o radier. */
  pumpState(t: number): PumpState {
    const p = this.pours.find((x) => t <= x.pour[1] + 0.5) ?? this.pours[this.pours.length - 1];
    const k = Math.min(Math.max((t - p.pour[0]) / (p.pour[1] - p.pour[0]), 0), 1);
    return { pumping: t >= p.pour[0] && t <= p.pour[1], slab: p.slab, progress: k };
  }
}
