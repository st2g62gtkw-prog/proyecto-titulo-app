/**
 * Logística de hormigón: llegada de mixers, esperas y salidas. Los muros se hormigonan con
 * capacho; las losas y el radier con la bomba estacionaria que queda fija en su caseta.
 * Igual que la grúa, todo es función del tiempo de simulación.
 *
 * Camino (costado posterior, ver SITE.road): es uno solo y termina en la bomba. El mixer llega por
 * la calle del portón (carril del lado de la obra), pasa el portón y se detiene; retrocede girando
 * por el portón y sigue en retroceso por el camino hasta el punto de descarga, porque la canaleta
 * va atrás: el capacho (muros) o la tolva de la bomba (losas y radier), que está al final del camino.
 * Al terminar sale hacia adelante por el mismo camino y el mismo portón y dobla hacia el barrio por
 * el otro carril de la calle. Como no hay por dónde adelantar, en cada hormigonado de losa el
 * segundo mixer entra en retroceso mientras descarga el primero y se aparta al bolsón de espera
 * (SITE.layby, al costado del camino); cuando el primero sale y lo pasa, retrocede desde ahí hasta
 * la tolva. Durante el cambio la bomba está detenida unos instantes (SlabTiming.pumpStop). Para
 * muros basta un mixer (7 capachos de 1 m³), igual que para el radier, que se hormigona entre el
 * último mixer de una losa y el del capacho.
 */
import { SITE } from '../config';
import { capachoWindows } from './cranePlan';
import { Route, easeTravel, type Pose } from './paths';
import { FAR, LANE_IN, R_OUT, RZ, WAIT, arrival, exitFrom, laybyTo, line, reverseTo, reverseToLayby } from './roads';
import { pourFrac, type Schedule } from './schedule';

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
  /**
   * Tramos de llegada en orden: por la calle hasta pasar el portón y, en retroceso, hasta el punto de
   * descarga (si espera su turno en el bolsón, en dos tramos: hasta el bolsón y de ahí a la tolva).
   */
  legs: Leg[];
  /** Tramo de salida: del punto de descarga, hacia adelante por el camino y el portón, hasta la calle. */
  out: Leg;
  /** Aparece en la calle (inicio del primer tramo) y llega al punto de descarga (fin del último). */
  arrive: [number, number];
  /** Instante en que empieza a retroceder desde la calle por el portón. */
  gateIn: number;
  /** Si espera su turno (el camino está ocupado): desde cuándo y dónde (en la calle o en el bolsón). */
  waitFrom: number | null;
  waitAt: 'calle' | 'bolsón';
  /** Ventanas en que vierte hormigón por la canaleta (una en la tolva; un llenado por capacho). */
  pours: [number, number][];
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
  /** Sector de zapatas (1..3) si es un hormigonado de las fundaciones; 0 si es una losa o el radier. */
  sector: number;
  pour: [number, number];
  /** Bomba detenida mientras se cambia de mixer. */
  pumpStop: [number, number];
}

export interface PumpState {
  /** Hormigonado en curso (tubería armada hasta la losa), incluida la pausa del cambio de mixer. */
  pour: boolean;
  /** Bombeando (hay un mixer descargando en la tolva). */
  pumping: boolean;
  /** Losa que se está hormigonando (o la próxima, si la bomba está detenida). */
  slab: number;
  /** Sector de zapatas que se hormigona (1..3), o 0 si es una losa o el radier. */
  sector: number;
  /** Fracción del hormigonado de la losa (0..1); no avanza durante el cambio de mixer. */
  progress: number;
}

type P = [number, number];
const G = SITE.gate;
const PMP = SITE.mixerPump, CAP = SITE.mixerCapacho;
/**
 * Al salir, el mixer cruza el carril de llegada para doblar hacia el barrio: si en ese momento
 * viene otro por la calle, este se detiene antes del portón (UP) y sigue cuando el otro ya dobló.
 * Mientras su eje está entre GATE_ZONE[0] y GATE_ZONE[1] (z) el que llega estorbaría al que sale.
 */
const UP: P = [LANE_IN, RZ + 16.5];
const GATE_ZONE: [number, number] = [RZ + 16, RZ - 6.6];
/** Rapidez media (m/s de simulación) por la calle, en retroceso y al salir (vacío). */
const V_STREET = 18, V_BACK = 17, V_OUT = 21;
/** Pausa en la calle entre detenerse y empezar a retroceder. */
const HOLD = 0.25;
/** Canaleta: despliegue y repliegue (s). En el capacho es más corta: el camión ya está detenido. */
const CAP_CHUTE: [number, number] = [0.25, 0.22];
const PUMP_CHUTE: [number, number] = [0.45, 0.3];

const leg = (route: Route, t0: number, t1: number, back = false): Leg => ({ route, t: [t0, t1], back });
/** Duración de un tramo a la rapidez media v (con arranque y frenado suaves). */
const dur = (r: Route, v: number) => 0.5 + r.length / v;

/** Instante en que un tramo recorrido con easeTravel llega a la distancia s (inversa de easeTravel). */
function timeAt(L: Leg, s: number) {
  const f = Math.min(Math.max(s / L.route.length, 0), 1);
  const u = f <= 0.5 ? Math.sqrt(f / 2) : 1 - Math.sqrt((1 - f) / 2);
  return L.t[0] + u * (L.t[1] - L.t[0]);
}

/** Largo del arco de salida (del portón al carril de salida). */
const OUT_ARC = (R_OUT * Math.PI) / 2;

/** Caja del mixer en planta (desde su centro: largo hacia la cabina y hacia atrás, medio ancho). */
const BODY = { front: 4.8, rear: 4.85, half: 1.3 };

/** Si las cajas de dos mixers (con holgura g) se intersectan (ejes separadores). */
function overlap(a: Pose, b: Pose, g: number) {
  const corners = (p: Pose) => {
    const c = Math.cos(p.heading), s = Math.sin(p.heading);
    return ([[BODY.front + g, BODY.half + g], [BODY.front + g, -BODY.half - g], [-BODY.rear - g, -BODY.half - g], [-BODY.rear - g, BODY.half + g]] as P[])
      .map(([u, v]) => [p.x + u * c - v * s, p.z + u * s + v * c] as P);
  };
  const A = corners(a), B = corners(b);
  for (const p of [a, b]) {
    for (const h of [p.heading, p.heading + Math.PI / 2]) {
      const ax = Math.cos(h), az = Math.sin(h);
      const pa = A.map(([x, z]) => x * ax + z * az), pb = B.map(([x, z]) => x * ax + z * az);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
  }
  return true;
}

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
    /**
     * Visita de un mixer que debe quedar detenido en xStop en `at`: llega por la calle (si hay que
     * esperar, se detiene pasado el portón a más tardar en `waitBy`), retrocede hasta xStop, vierte
     * en `pours` y sale con la canaleta ya replegada en `done`.
     */
    const visit = (spot: MixerVisit['spot'], xStop: number, at: number, pours: [number, number][], done: number, laybyAt?: number) => {
      const [dOut, dIn] = spot === 'capacho' ? CAP_CHUTE : PUMP_CHUTE;
      const street = arrival(), out = exitFrom(xStop);
      const legs: Leg[] = [];
      let gateIn: number, waitFrom: number | null = null;
      if (laybyAt === undefined) {
        const back = reverseTo(xStop);
        gateIn = at - dur(back, V_BACK);
        legs.push(leg(back, gateIn, at, true));
      } else {
        // espera su turno en el bolsón: llega ahí en laybyAt y sale hacia la tolva justo a tiempo
        const toLb = reverseToLayby(), fromLb = laybyTo(xStop);
        gateIn = laybyAt - dur(toLb, V_BACK);
        legs.push(leg(toLb, gateIn, laybyAt, true), leg(fromLb, at - dur(fromLb, V_BACK), at, true));
        waitFrom = laybyAt;
      }
      const stopAt = gateIn - HOLD;
      legs.unshift(leg(street, stopAt - dur(street, V_STREET), stopAt));
      const exit = leg(out, done, done + dur(out, V_OUT));
      this.mixers.push({
        id: 0, spot, legs, out: exit, arrive: [legs[0].t[0], at], gateIn, waitFrom, waitAt: laybyAt === undefined ? 'calle' : 'bolsón',
        pours, discharge: [pours[0][0], pours[pours.length - 1][1]], leave: exit.t,
        chute: [at, done], chuteDur: [dOut, dIn],
      });
    };
    /** Tramo de la calle que termina pasado el portón (el anterior al primer retroceso). */
    const streetLeg = (m: MixerVisit) => m.legs.findIndex((L) => L.back) - 1;
    const xOf = (m: MixerVisit) => (m.spot === 'capacho' ? CAP.x : PMP.x);
    /** Ventana en que el que sale cruza el carril de llegada (de antes del portón a ya doblado). */
    const crossing = (m: MixerVisit): [number, number] => {
      const s0 = xOf(m) - G.x;
      return [timeAt(m.out, s0 - 1.5), timeAt(m.out, s0 + OUT_ARC + 2)];
    };
    /** Ventana en que el que llega por la calle pasa frente al portón (hasta quedar pasado el portón). */
    const passing = (m: MixerVisit): [number, number] => {
      const L = m.legs[streetLeg(m)], z0 = L.route.at(0).z;
      return [timeAt(L, z0 - GATE_ZONE[0]), timeAt(L, z0 - GATE_ZONE[1])];
    };
    // muros y zapatas: un mixer por serie de capachos; llega en retroceso con la canaleta replegada,
    // la despliega antes de que el capacho entre bajo ella y la repliega después del último llenado
    // (en las fundaciones, cada serie de capachos del plan: emplantillado, muros bajo NPT y V.S.C.)
    const series = [
      ...sched.activities.filter((a) => a.kind === 'muroHormigon').map((a) => a.trips),
      ...sched.fund.capachos.map((c) => c.trips),
    ];
    for (const trips of series) {
      const W = trips.map((x) => capachoWindows(x));
      const at = W[0].slideIn[0] - 0.05 - CAP_CHUTE[0];
      const done = W[W.length - 1].slideOut[1] + 0.01 + CAP_CHUTE[1];
      visit('capacho', CAP.x, at, W.map((w) => w.fill), done);
    }
    // hormigonado de cada sector de zapatas con la bomba estacionaria (tubería tendida por el
    // suelo): dos mixers con cambio, igual que en las losas
    for (const fp of sched.fund.pours) {
      const { pour, pumpStop } = fp;
      this.pours.push({ slab: 0, sector: fp.sector, pour, pumpStop });
      const [dOut, dIn] = PUMP_CHUTE;
      visit('bomba', PMP.x, pour[0] - dOut - 0.05, [[pour[0], pumpStop[0]]], pumpStop[0] + dIn);
      visit('bomba', PMP.x, pumpStop[1] - dOut - 0.05, [[pumpStop[1], pour[1]]], pour[1] + dIn, pumpStop[0] - 1.6);
    }
    // losas: dos mixers alimentan la tolva; el segundo entra mientras descarga el primero, espera
    // en el bolsón y retrocede hasta la tolva cuando el primero ya lo pasó al salir (la bomba se
    // detiene en el cambio). El radier, sin cambio de camión, lo hace uno solo
    for (const a of [...sched.activities, ...sched.parallel]) {
      if (a.kind !== 'losaHormigon' && a.kind !== 'radier') continue;
      const S = a.kind === 'radier' ? 0 : a.level;
      const { pour, pumpStop } = sched.slab[S];
      this.pours.push({ slab: S, sector: 0, pour, pumpStop });
      const [dOut, dIn] = PUMP_CHUTE;
      if (pumpStop[1] - pumpStop[0] < 0.01) {
        // sin cambio de camión (radier): un solo mixer descarga todo el hormigonado
        visit('bomba', PMP.x, pour[0] - dOut - 0.05, [pour], pour[1] + dIn);
        continue;
      }
      visit('bomba', PMP.x, pour[0] - dOut - 0.05, [[pour[0], pumpStop[0]]], pumpStop[0] + dIn);
      visit('bomba', PMP.x, pumpStop[1] - dOut - 0.05, [[pumpStop[1], pour[1]]], pour[1] + dIn, pumpStop[0] - 1.6);
    }
    this.pours.sort((p, q) => p.pour[0] - q.pour[0]);
    // si el que llega pasaría frente al portón mientras otro sale y dobla por su carril, espera en la
    // calle antes del portón (UP) y sigue cuando el otro ya dobló
    for (const m of this.mixers) {
      for (const o of this.mixers) {
        const [c0, c1] = crossing(o), [a0, a1] = passing(m);
        if (o === m || a1 <= c0 || a0 >= c1) continue;
        const ib = streetLeg(m), stopAt = m.legs[ib].t[1];
        const toUp = new Route().add(line([LANE_IN, FAR], UP, 6)), toWait = new Route().add(line(UP, WAIT, 6));
        const go = c1 + 0.1, d2 = dur(toWait, V_STREET);
        const atUp = Math.min(go, stopAt - d2) - 0.2;
        m.legs.splice(0, ib + 1, leg(toUp, atUp - dur(toUp, V_STREET), atUp), leg(toWait, go, go + d2));
        m.arrive[0] = m.legs[0].t[0];
        m.waitFrom = atUp;
        m.waitAt = 'calle';
        if (go + d2 > m.gateIn - HOLD + 1e-6) console.warn(`Logística: el mixer que entra en ${m.gateIn.toFixed(1)} s llega tarde al portón (${(go + d2 - m.gateIn + HOLD).toFixed(2)} s)`);
      }
    }
    // numeración correlativa por orden de llegada (también reparte los camiones del pool sin choques)
    this.mixers.sort((p, q) => p.arrive[0] - q.arrive[0]);
    this.mixers.forEach((m, i) => (m.id = i + 1));
    // el camino es uno solo: comprueba que ningún par de mixers se tope en ningún momento (cajas en
    // planta con 0,4 m de holgura, muestreadas cada 0,05 s mientras ambos están en la obra)
    for (let i = 0; i < this.mixers.length; i++) {
      for (let j = i + 1; j < this.mixers.length; j++) {
        const a = this.mixers[i], b = this.mixers[j];
        const t0 = Math.max(a.arrive[0], b.arrive[0]), t1 = Math.min(a.leave[1], b.leave[1]);
        for (let t = t0; t < t1; t += 0.05) {
          const [pa, pb] = [a, b].map((m) => this.mixerStates(t).find((s) => s.id === m.id)!);
          if (pa && pb && overlap(pa.pose, pb.pose, 0.4)) {
            console.warn(`Logística: los mixers ${a.id} y ${b.id} se topan en t = ${t.toFixed(2)} s`);
            break;
          }
        }
      }
    }
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
      const discharging = m.pours.some(([a, b]) => t >= a && t <= b);
      out.push({ id: m.id, pose, chute, discharging, dist });
    }
    return out;
  }

  /** Estado de la bomba estacionaria: bombeando durante cada hormigonado, salvo en el cambio de mixer. */
  pumpState(t: number): PumpState {
    const p = this.pours.find((x) => t <= x.pour[1] + 0.5) ?? this.pours[this.pours.length - 1];
    const pour = t >= p.pour[0] && t <= p.pour[1];
    const stopped = t > p.pumpStop[0] && t < p.pumpStop[1];
    return { pour, pumping: pour && !stopped, slab: p.slab, sector: p.sector, progress: pourFrac(p, t) };
  }
}
