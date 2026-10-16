/**
 * Logística de hormigón: llegada de mixers, colas y salidas. Los muros se hormigonan con
 * capacho; las losas y el radier con la bomba estacionaria que queda fija en su caseta.
 * Igual que la grúa, todo es función del tiempo de simulación.
 *
 * Circuito (costado posterior, ver SITE.road): portón norponiente → carril de entrada (+x) →
 * punto de descarga → rotonda del extremo +x → carril de salida (−x) → portón. Para la bomba el
 * mixer pasa frente a la caseta, se detiene y retrocede por la bahía hasta la tolva; al terminar
 * sale hacia adelante por la bahía, así el siguiente (que espera en el carril) retrocede enseguida.
 */
import { SITE } from '../config';
import { Route, easeTravel, type Pose } from './paths';
import type { Schedule } from './schedule';

/** Tramo de un recorrido: una ruta que se recorre entre t[0] y t[1], hacia adelante o en retroceso. */
export interface Leg {
  route: Route;
  t: [number, number];
  back: boolean;
}

export interface MixerVisit {
  id: number;
  /** 'capacho' = descarga al capacho de la grúa; 'bomba' = alimenta la tolva de la bomba. */
  spot: 'capacho' | 'bomba';
  /** Tramos de llegada en orden (entrada, avance desde la cola, retroceso hasta la tolva). */
  legs: Leg[];
  /** Tramo de salida: del punto de descarga, por la rotonda, hasta la calle. */
  out: Leg;
  /** Entrada a la faena (inicio del primer tramo) y llegada al punto de descarga (fin del último). */
  arrive: [number, number];
  discharge: [number, number];
  leave: [number, number];
}

export interface MixerState {
  id: number;
  pose: Pose;
  chute: number;
  discharging: boolean;
  /** Distancia recorrida con signo (para girar las ruedas; disminuye en retroceso). */
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

type P = [number, number];
const RD = SITE.road, G = SITE.gate;
const IN = RD.inZ, OUT = RD.outZ, BAY = RD.bayZ;
const PMP = SITE.mixerPump, CAP = SITE.mixerCapacho;
/** Centro del mixer en el carril de entrada cuando se detiene para retroceder hasta la bomba. */
const REV_X = PMP.x + 16.5;
/** Centro del mixer que espera en cola detrás del que carga el capacho. */
const CAP_QUEUE_X = CAP.x - 14;

/** Curva en S suave (planta) de (x0, z0) a (x1, z1), con ambos extremos paralelos al eje x. */
function sCurve(x0: number, z0: number, x1: number, z1: number, n = 10): P[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const u = i / n;
    return [x0 + (x1 - x0) * u, z0 + (z1 - z0) * u * u * (3 - 2 * u)] as P;
  });
}

/** Parte alta de la rotonda (lado del edificio), donde se entra hacia +x. */
const TURN_TOP: P = [RD.turnX, RD.turnZ + RD.turnR];

/** Rotonda del extremo +x: desde su parte alta gira hasta quedar hacia −x y baja al carril de salida. */
function turnaround(): P[] {
  const pts: P[] = [];
  for (let d = 15; d <= 180; d += 15) {
    const a = (d * Math.PI) / 180;
    pts.push([RD.turnX + RD.turnR * Math.sin(a), RD.turnZ + RD.turnR * Math.cos(a)]);
  }
  return [...pts, ...sCurve(RD.turnX - 1.5, RD.turnZ - RD.turnR, RD.turnX - 13, OUT).slice(1)];
}

/** Entrada desde la calle por el portón hasta un punto del carril de entrada. */
function entry(xStop: number) {
  return new Route().add([[G.x - 9, IN], [G.x, IN], [xStop, IN]]);
}

/** Salida: desde `pts` (que terminan en la parte alta de la rotonda) hasta la calle. */
function exitVia(pts: P[]) {
  return new Route().add([...pts, ...turnaround(), [G.x, OUT], [G.x - 10, OUT]]);
}

/** Retroceso desde el carril de entrada hasta que la canaleta queda sobre la tolva. */
const reverseToPump = () => new Route().add([[REV_X, IN], ...sCurve(REV_X - 2.5, IN, PMP.x + 1.0, BAY), [PMP.x, BAY]], true);
/** Salida de la bahía de la bomba hacia adelante, hasta la parte alta de la rotonda. */
const exitFromPump = () => exitVia([[PMP.x, BAY], ...sCurve(RD.turnX - 12, BAY, TURN_TOP[0], TURN_TOP[1])]);
/** Salida desde el punto del capacho por el carril de entrada. */
const exitFromCapacho = () => exitVia([[CAP.x, IN], ...sCurve(RD.turnX - 14, IN, TURN_TOP[0], TURN_TOP[1])]);

const leg = (route: Route, t0: number, t1: number, back = false): Leg => ({ route, t: [t0, t1], back });

/** Recorre una ruta entre t0 y t1 con aceleración suave. */
function travel(route: Route, t: number, [t0, t1]: [number, number]) {
  const u = easeTravel((t - t0) / (t1 - t0));
  const s = u * route.length;
  return { pose: route.at(s), s };
}

export class Logistics {
  mixers: MixerVisit[] = [];
  pours: PumpPour[] = [];

  constructor(sched: Schedule) {
    const visit = (spot: MixerVisit['spot'], legs: Leg[], discharge: [number, number], out: Leg) => {
      this.mixers.push({ id: 0, spot, legs, out, arrive: [legs[0].t[0], legs[legs.length - 1].t[1]], discharge, leave: out.t });
    };
    for (const a of sched.activities) {
      if (a.kind === 'muroHormigon' || a.kind === 'fundaciones') {
        const tr = a.trips;
        const fill = (k: number) => tr[k].t0 + (tr[k].t1 - tr[k].t0) * 0.22;
        const fillEnd = (k: number) => tr[k].t0 + (tr[k].t1 - tr[k].t0) * 0.32;
        const half = Math.ceil(tr.length / 2);
        const t1 = a.t0 + 1.9;
        // mixer 1: llega justo antes del primer llenado
        const m1Leave = fillEnd(half - 1) + 0.1;
        visit('capacho', [leg(entry(CAP.x), t1 - 5, t1)], [fill(0) - 0.4, m1Leave], leg(exitFromCapacho(), m1Leave + 0.15, m1Leave + 5.6));
        // mixer 2: espera en cola detrás y avanza cuando sale el primero
        const end = fillEnd(tr.length - 1) + 0.1;
        visit('capacho', [
          leg(entry(CAP_QUEUE_X), m1Leave - 5, m1Leave - 0.3),
          leg(new Route().add([[CAP_QUEUE_X, IN], [CAP.x, IN]]), m1Leave + 0.55, fill(half) - 0.25),
        ], [fill(half) - 0.2, end], leg(exitFromCapacho(), end + 0.2, end + 5.8));
      }
    }
    // losas y radier: los mixers alimentan la tolva de la bomba estacionaria
    for (const a of [...sched.activities, ...sched.parallel]) {
      if (a.kind !== 'losaHormigon' && a.kind !== 'radier') continue;
      const S = a.kind === 'radier' ? 0 : a.level;
      const pour = sched.slab[S].pour;
      this.pours.push({ slab: S, pour });
      // tres mixers por hormigonado; el siguiente espera en el carril mientras descarga el anterior
      // y retrocede apenas este despeja la bahía (cambio de camión ≈ 2,2 s)
      const n = 3, swap = 2.15;
      const d0 = pour[0] - 0.1;
      const each = (pour[1] - d0 - swap * (n - 1)) / n;
      for (let k = 0; k < n; k++) {
        const s0 = d0 + k * (each + swap), s1 = s0 + each;
        const legs = k === 0
          ? [leg(entry(REV_X), s0 - 6.3, s0 - 1.55), leg(reverseToPump(), s0 - 1.4, s0 - 0.15, true)]
          : [leg(entry(REV_X), s0 - swap - 4.9, s0 - swap - 0.3), leg(reverseToPump(), s0 - 1.25, s0 - 0.1, true)];
        visit('bomba', legs, [s0, s1 - 0.05], leg(exitFromPump(), s1, s1 + 5.6));
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
      // recorre los tramos en orden: el último que ya empezó define la pose; entre tramos, detenido
      let pose: Pose = m.legs[0].route.at(0);
      let dist = 0;
      for (const L of [...m.legs, m.out]) {
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
      // canaleta desplegada solo con el camión detenido en el punto de descarga
      let chute = 0;
      if (t >= m.arrive[1] && t < m.leave[0]) {
        const from = Math.max(m.arrive[1], m.discharge[0] - 0.6);
        chute = Math.min(1, Math.max(0, (t - from) / 0.45), Math.max(0, (m.leave[0] - t) / 0.3));
      }
      out.push({ id: m.id, pose, chute, discharging: t >= m.discharge[0] && t <= m.discharge[1], dist });
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
