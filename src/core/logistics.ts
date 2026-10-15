/**
 * Logística de hormigón: llegada de mixers y del camión bomba, colas y salidas.
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

export interface PumpVisit {
  slab: number;
  arrive: [number, number];
  outriggers: [number, number];
  unfold: [number, number];
  pour: [number, number];
  fold: [number, number];
  stow: [number, number];
  leave: [number, number];
}

export interface PumpState {
  pose: Pose;
  outriggers: number;
  boom: number;
  pouring: boolean;
  slab: number;
  /** Fracción del hormigonado de la losa (0..1). */
  progress: number;
  dist: number;
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
  pumps: PumpVisit[] = [];
  private pumpIn: Route;
  private pumpOut: Route;

  constructor(sched: Schedule) {
    const P = SITE.pump;
    this.pumpIn = new Route().add([
      [G.x - 8, IN], [G.x, IN], [X0 - 10, IN], [X0 - 2, IN - 1.2], [X0, IN - 4], [X0, LZ + 3.5], [X0 + 3, LZ], [P.x - 6, LZ], [P.x - 2.2, LZ - 0.6], [P.x - 0.2, LZ - 2.6], [P.x, P.z],
    ]);
    this.pumpOut = new Route()
      .add([[P.x, P.z], [P.x, LZ - 1.2], [P.x + 1.6, LZ + 1.4], [P.x + 4.5, LZ + 2]], true)
      .add([[P.x + 4.5, LZ + 2], [P.x + 1, LZ + 1.2], [P.x - 4, LZ], [X0 + 3, LZ], [X0, LZ + 3.5], [X0, OUT - 3], [X0 - 3, OUT], [G.x, OUT], [G.x - 10, OUT]]);

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
      if (a.kind === 'losaHormigon' || a.kind === 'radier') {
        const S = a.kind === 'radier' ? 0 : a.level;
        const pour = sched.slab[S].pour;
        const v: PumpVisit = {
          slab: S,
          arrive: [a.t0 - 4.5, a.t0 + 1.2],
          outriggers: [a.t0 + 1.3, a.t0 + 2.3],
          unfold: [a.t0 + 2.3, pour[0] - 0.1],
          pour,
          fold: [pour[1] + 0.2, pour[1] + 1.7],
          stow: [pour[1] + 1.7, pour[1] + 2.4],
          leave: [pour[1] + 2.5, pour[1] + 8.5],
        };
        this.pumps.push(v);
        // dos o tres mixers alimentan la bomba durante el hormigonado
        const n = 3;
        for (let k = 0; k < n; k++) {
          const d0 = pour[0] + ((pour[1] - pour[0]) * k) / n;
          const d1 = pour[0] + ((pour[1] - pour[0]) * (k + 1)) / n;
          this.mixers.push({
            id: id++, spot: 'bomba', inRoute: entry(pmp.x), outRoute: exitFrom(pmp.x),
            arrive: [d0 - 4.6, d0 - 0.25], discharge: [d0 - 0.1, d1 - 0.05], leave: [d1, d1 + 5],
          });
        }
      }
    }
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

  pumpState(t: number): PumpState | null {
    const v = this.pumps.find((p) => t >= p.arrive[0] && t <= p.leave[1]);
    if (!v) return null;
    const k = (w: [number, number]) => Math.min(Math.max((t - w[0]) / (w[1] - w[0]), 0), 1);
    let pose: Pose, dist = 0;
    if (t < v.arrive[1]) ({ pose, dist } = travel(this.pumpIn, t, v.arrive));
    else if (t < v.leave[0]) { pose = this.pumpIn.at(this.pumpIn.length); dist = this.pumpIn.length; }
    else { const r = travel(this.pumpOut, t, v.leave); pose = r.pose; dist = this.pumpIn.length + r.dist; }
    const out = 1 - k(v.stow);
    const outriggers = t < v.stow[0] ? k(v.outriggers) : out;
    const boom = t < v.fold[0] ? k(v.unfold) : 1 - k(v.fold);
    return {
      pose, outriggers, boom: easeTravel(boom), pouring: t >= v.pour[0] && t <= v.pour[1], slab: v.slab,
      progress: k(v.pour), dist,
    };
  }
}
