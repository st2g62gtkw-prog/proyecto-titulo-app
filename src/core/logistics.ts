/**
 * Logística de hormigón: llegada de mixers, colas y salidas. Los muros se hormigonan con
 * capacho; las losas y el radier con la bomba estacionaria que queda fija en su caseta.
 * Igual que la grúa, todo es función del tiempo de simulación.
 *
 * Circuito (costado posterior, ver SITE.road): portón norponiente → carril de entrada (+x) →
 * punto de descarga → rotonda del extremo +x → carril de salida (−x) → portón. Para la bomba el
 * mixer pasa frente a la caseta, se detiene y retrocede por la bahía hasta la tolva; al terminar
 * sale hacia adelante por la bahía y el siguiente (que espera en el carril) retrocede apenas
 * el anterior despeja la bahía. Para el capacho el mixer se detiene en el carril de entrada, con la
 * canaleta desplegada mientras el capacho entra y sale a ras de suelo (ver CranePlan).
 */
import { SITE } from '../config';
import { capachoSwapTrip, capachoWindows } from './cranePlan';
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
  /** Canaleta: empieza a desplegarse en chute[0] y termina de replegarse en chute[1] (con el camión detenido). */
  chute: [number, number];
  /** Duración del despliegue y del repliegue de la canaleta (s). */
  chuteDur: [number, number];
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
/**
 * Largo (en x) de la curva en S que baja de la rotonda al carril de salida: larga para que el camión
 * gire poco (a lo más ≈ 16°, a media curva) y llegue casi recto al carril de salida, sin que su
 * esquina delantera invada el carril de entrada cuando se cruza con el mixer que entra.
 */
const EXIT_S_LEN = 22;
/** Canaleta del mixer en el capacho: se despliega y repliega rápido para alcanzar el cambio de camión. */
const CAP_CHUTE: [number, number] = [0.25, 0.22];
const PUMP_CHUTE: [number, number] = [0.45, 0.3];
/**
 * Bomba: tiempo entre el fin de una descarga y el inicio de la siguiente, duración del retroceso
 * hasta la tolva y de la salida. El siguiente camión empieza a retroceder ≈ 1 s después de que
 * arranca el anterior, cuando este ya va saliendo de la bahía (sus costados quedan a ≥ 0,9 m).
 */
const PUMP_SWAP = 2.15, PUMP_REV = 1.0, PUMP_EXIT = 5.6;

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
  return [...pts, ...exitCurve().slice(1)];
}

/** Curva en S de la parte baja de la rotonda al carril de salida (también la pinta el sitio). */
export function exitCurve(): P[] {
  return sCurve(RD.turnX - 1.5, RD.turnZ - RD.turnR, RD.turnX - EXIT_S_LEN, OUT, 14);
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
    const visit = (spot: MixerVisit['spot'], legs: Leg[], discharge: [number, number], chute: [number, number], out: Leg) => {
      this.mixers.push({
        id: 0, spot, legs, out, arrive: [legs[0].t[0], legs[legs.length - 1].t[1]], discharge, leave: out.t,
        chute, chuteDur: spot === 'capacho' ? CAP_CHUTE : PUMP_CHUTE,
      });
    };
    const capIn = CAP_CHUTE[1];
    for (const a of sched.activities) {
      if (a.kind === 'muroHormigon' || a.kind === 'fundaciones') {
        const tr = a.trips;
        const half = capachoSwapTrip(tr.length);
        const W = tr.map((x, k) => capachoWindows(x, k === half));
        const t1 = a.t0 + 1.9;
        // mixer 1: llega antes del primer llenado y despliega la canaleta apenas se detiene; la
        // repliega cuando el capacho ya salió de bajo ella y se va por el carril de entrada
        const r1 = W[half - 1].slideOut[1] + 0.01;
        const out1 = r1 + capIn;
        visit('capacho', [leg(entry(CAP.x), t1 - 5, t1)], [W[0].fill[0] - 0.05, W[half - 1].fill[1]], [t1 + 0.05, out1],
          leg(exitFromCapacho(), out1, out1 + 4.6));
        // mixer 2: espera en cola detrás y avanza apenas arranca el primero (sin alcanzarlo); llega,
        // despliega la canaleta y el capacho entra bajo ella para el primer llenado que le toca
        const at2 = out1 + 1.0;
        const r2 = W[tr.length - 1].slideOut[1] + 0.01;
        const out2 = r2 + capIn;
        visit('capacho', [
          leg(entry(CAP_QUEUE_X), out1 - 5, out1 - 0.3),
          leg(new Route().add([[CAP_QUEUE_X, IN], [CAP.x, IN]]), out1 + 0.2, at2),
        ], [W[half].fill[0] - 0.05, W[tr.length - 1].fill[1]], [at2 + 0.02, out2], leg(exitFromCapacho(), out2, out2 + 5.6));
      }
    }
    // losas y radier: los mixers alimentan la tolva de la bomba estacionaria
    for (const a of [...sched.activities, ...sched.parallel]) {
      if (a.kind !== 'losaHormigon' && a.kind !== 'radier') continue;
      const S = a.kind === 'radier' ? 0 : a.level;
      const pour = sched.slab[S].pour;
      this.pours.push({ slab: S, pour });
      // tres mixers por hormigonado; el siguiente espera en el carril mientras descarga el anterior
      // y retrocede cuando este ya salió de la bahía (cambio de camión = PUMP_SWAP)
      const n = 3;
      const d0 = pour[0] - 0.1;
      const each = (pour[1] - d0 - PUMP_SWAP * (n - 1)) / n;
      for (let k = 0; k < n; k++) {
        const s0 = d0 + k * (each + PUMP_SWAP), s1 = s0 + each;
        const legs = k === 0
          ? [leg(entry(REV_X), s0 - 6.3, s0 - 1.55), leg(reverseToPump(), s0 - 1.4, s0 - 0.15, true)]
          : [leg(entry(REV_X), s0 - PUMP_SWAP - 4.9, s0 - PUMP_SWAP - 0.3), leg(reverseToPump(), s0 - PUMP_REV - 0.1, s0 - 0.1, true)];
        const arrived = legs[legs.length - 1].t[1];
        visit('bomba', legs, [s0, s1 - 0.05], [Math.max(arrived, s0 - 0.6), s1], leg(exitFromPump(), s1, s1 + PUMP_EXIT));
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
      const [c0, c1] = m.chute, [dOut, dIn] = m.chuteDur;
      const chute = Math.min(1, Math.max(0, Math.min((t - c0) / dOut, (c1 - t) / dIn)));
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
