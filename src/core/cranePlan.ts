/**
 * Plan de movimientos de la grúa torre a lo largo de toda la obra.
 *
 * Cada viaje se descompone en: izar → girar/trasladar el carro hacia el punto de carga →
 * bajar → enganchar → izar → girar hacia el destino → bajar → descargar → izar.
 * El estado de la grúa es una función pura del tiempo, por lo que la línea de tiempo
 * se puede adelantar o retroceder sin acumular errores.
 */
import type { Activity, Schedule } from './schedule';

export type PayloadKind = 'panel' | 'rebar' | 'deck' | 'props' | 'capacho';

export interface P3 {
  x: number;
  y: number;
  z: number;
}

interface Key {
  t: number;
  slew: number;
  r: number;
  y: number;
}

export interface CapachoCycle {
  fill: [number, number];
  pour: [number, number];
  /** Punto donde cae el hormigón (tope del moldaje / zapata). */
  to: P3;
}

export interface CraneState {
  slew: number;
  r: number;
  /** Cota de mundo del punto de enganche del gancho. */
  hookY: number;
  payload: PayloadKind | null;
  fill: number;
  open: number;
  /** Ciclo de capacho activo (para dibujar el chorro de hormigón). */
  cycle: CapachoCycle | null;
  /** Descripción corta de lo que hace la grúa. */
  task: string;
}

export interface CraneSetup {
  base: { x: number; z: number; y: number };
  jibY: number;
  jibLength: number;
  anchors: Record<'acopioMoldajeMuro' | 'acopioMoldajeLosa' | 'acopioFierro' | 'acopioPuntales', P3>;
  /**
   * Punto (mundo) del suelo donde se apoya el capacho para llenarlo: bajo la punta de la canaleta
   * del mixer detenido en el carril posterior (la grúa lo toma ahí, pasando sobre el edificio).
   */
  capachoFill: P3;
  /** Distancia del gancho al fondo de cada tipo de carga. */
  hang: Record<PayloadKind, number>;
  /** Cota superior del edificio construido en el tiempo t (para izar con holgura). */
  topAt(t: number): number;
  levelFloorY(level: number): number;
  wallTopY(level: number): number;
  slabBottomY(level: number): number;
}

const TAU = Math.PI * 2;

export class CranePlan {
  keys: Key[] = [];
  carries: { t0: number; t1: number; kind: PayloadKind; task: string }[] = [];
  cycles: CapachoCycle[] = [];
  tasks: { t0: number; t1: number; task: string }[] = [];
  constructor(private s: CraneSetup, sched: Schedule) {
    const b = s.base;
    const start = this.polar({ x: b.x + 6, y: 0, z: b.z - 12 });
    this.keys.push({ t: -1, slew: start.slew, r: start.r, y: s.jibY - 4 });
    for (const a of sched.activities) this.plan(a);
    this.keys.sort((p, q) => p.t - q.t);
  }

  private polar(p: P3) {
    const dx = p.x - this.s.base.x, dz = p.z - this.s.base.z;
    return { slew: Math.atan2(dz, dx), r: Math.min(Math.max(Math.hypot(dx, dz), 3), this.s.jibLength - 1.5) };
  }

  private last() {
    return this.keys[this.keys.length - 1];
  }

  private key(t: number, p: P3 | null, y: number) {
    const prev = this.last();
    let slew = prev.slew, r = prev.r;
    if (p) {
      const q = this.polar(p);
      // desenrolla el ángulo para girar por el camino corto
      let d = q.slew - prev.slew;
      d -= Math.round(d / TAU) * TAU;
      slew = prev.slew + d;
      r = q.r;
    }
    if (t <= prev.t) t = prev.t + 1e-3;
    this.keys.push({ t, slew, r, y: Math.min(y, this.s.jibY - 1.2) });
  }

  private safeY(t: number, kind: PayloadKind | null, ...pts: P3[]) {
    const hang = kind ? this.s.hang[kind] : 1.5;
    const top = Math.max(this.s.topAt(t), ...pts.map((p) => p.y));
    return top + hang + 3.5;
  }

  /** Viaje de carga desde `pick` (fondo de la carga) hasta `drop`. */
  private trip(t0: number, D: number, pick: P3, drop: P3, kind: PayloadKind, task: string, f: number[]) {
    const [fUp, fA, fLow, fAtt, fUp2, fB, fLowB, fRel, fUp3] = f;
    const h = this.s.hang[kind];
    const safe = this.safeY(t0 + D, kind, pick, drop);
    const T = (x: number) => t0 + x * D;
    this.key(T(fUp), null, safe);
    this.key(T(fA), pick, safe);
    this.key(T(fLow), pick, pick.y + h);
    this.key(T(fAtt), pick, pick.y + h);
    this.key(T(fUp2), pick, safe);
    this.key(T(fB), drop, safe);
    this.key(T(fLowB), drop, drop.y + h);
    this.key(T(fRel), drop, drop.y + h);
    this.key(T(fUp3), drop, drop.y + h + 3);
    this.carries.push({ t0: T(fAtt), t1: T(fRel), kind, task });
    this.tasks.push({ t0, t1: t0 + D, task });
  }

  /** Viaje de capacho: llenado en el mixer y descarga sobre muros o zapatas. */
  private capacho(t0: number, D: number, to: P3, task: string) {
    const s = this.s;
    const h = s.hang.capacho;
    const fill = s.capachoFill;
    const T = (x: number) => t0 + x * D;
    const safe = this.safeY(t0 + D, 'capacho', to, fill);
    // el capacho baja hasta apoyar sus patas en el suelo, con la boca bajo la canaleta
    const atMixer = { x: fill.x, y: fill.y + 0.01, z: fill.z };
    const over = { x: to.x, y: to.y + 0.35, z: to.z };
    this.key(T(0.04), null, safe);
    this.key(T(0.16), atMixer, safe);
    this.key(T(0.22), atMixer, atMixer.y + h);
    this.key(T(0.32), atMixer, atMixer.y + h);
    this.key(T(0.38), atMixer, safe);
    this.key(T(0.5), over, safe);
    this.key(T(0.55), over, over.y + h);
    this.key(T(0.86), over, over.y + h);
    this.key(T(0.93), over, over.y + h + 3);
    this.cycles.push({ fill: [T(0.22), T(0.32)], pour: [T(0.55), T(0.86)], to });
    this.tasks.push({ t0, t1: t0 + D, task });
  }

  /** El capacho cuelga del gancho desde que se engancha junto al mixer hasta el último viaje. */
  private carryCapacho(n: number) {
    const cs = this.cycles.slice(-n);
    this.carries.push({ t0: cs[0].fill[0] - 0.05, t1: cs[cs.length - 1].pour[1] + 0.6, kind: 'capacho', task: '' });
  }

  /** Grúa en espera: deja la pluma lejos de la bomba. */
  private park(t: number, task: string, t1: number) {
    const b = this.s.base;
    const p = { x: b.x - 16, y: 0, z: b.z + 6 };
    this.key(t + 0.3, null, this.safeY(t, null));
    this.key(t + 2.0, p, this.safeY(t, null));
    this.tasks.push({ t0: t, t1, task });
  }

  private plan(a: Activity) {
    const s = this.s;
    const A = s.anchors;
    const D0 = (tr: { t0: number; t1: number }) => tr.t1 - tr.t0;
    const loadF = [0.05, 0.22, 0.3, 0.38, 0.46, 0.64, 0.72, 0.78, 0.86];
    const formF = [0.04, 0.18, 0.25, 0.31, 0.38, 0.56, 0.62, 0.66, 0.74];
    switch (a.kind) {
      case 'fundaciones':
        for (const tr of a.trips) this.capacho(tr.t0, D0(tr), { x: tr.x, y: -0.1, z: tr.z }, 'Capacho: hormigón a zapatas');
        this.carryCapacho(a.trips.length);
        break;
      case 'radier':
      case 'losaHormigon':
        this.park(a.t0, 'En espera: la bomba hormigona la losa', a.t1);
        break;
      case 'muroFierro':
        a.trips.forEach((tr, k) => this.trip(tr.t0, D0(tr), A.acopioFierro, { x: tr.x, y: s.levelFloorY(a.level) + 0.25, z: tr.z }, 'rebar', `Paquete de fierro al ${a.levelName} (${k + 1}/${a.trips.length})`, loadF));
        break;
      case 'muroMoldaje':
        a.trips.forEach((tr, k) => this.trip(tr.t0, D0(tr), A.acopioMoldajeMuro, { x: tr.x, y: s.wallTopY(a.level) + 0.6, z: tr.z }, 'panel', `Paneles de moldaje, sector ${k + 1}/${a.trips.length}`, formF));
        break;
      case 'muroHormigon':
        a.trips.forEach((tr, k) => this.capacho(tr.t0, D0(tr), { x: tr.x, y: s.wallTopY(a.level), z: tr.z }, `Capacho ${k + 1}/${a.trips.length}: hormigón a muros`));
        this.carryCapacho(a.trips.length);
        break;
      case 'muroDesmolde':
        a.trips.forEach((tr, k) => {
          const D = D0(tr);
          const T = (x: number) => tr.t0 + x * D;
          const at = { x: tr.x, y: s.wallTopY(a.level) + 4.2, z: tr.z };
          const safe = this.safeY(tr.t1, 'panel', at, A.acopioMoldajeMuro);
          const h = s.hang.panel;
          this.key(T(0.05), null, safe);
          this.key(T(0.16), at, safe);
          this.key(T(0.22), at, at.y + h);
          this.key(T(0.7), at, at.y + h);
          this.key(T(0.76), at, safe);
          this.key(T(0.9), A.acopioMoldajeMuro, safe);
          this.key(T(0.96), A.acopioMoldajeMuro, A.acopioMoldajeMuro.y + h);
          this.key(T(0.99), A.acopioMoldajeMuro, A.acopioMoldajeMuro.y + h + 0.5);
          this.carries.push({ t0: T(0.68), t1: T(0.97), kind: 'panel', task: '' });
          this.tasks.push({ t0: tr.t0, t1: tr.t1, task: `Retiro de paneles, sector ${k + 1}/${a.trips.length}` });
        });
        break;
      case 'losaMoldaje':
        a.trips.forEach((tr, k) => {
          const kind: PayloadKind = k === 0 ? 'props' : 'deck';
          const from = k === 0 ? A.acopioPuntales : A.acopioMoldajeLosa;
          this.trip(tr.t0, D0(tr), from, { x: tr.x, y: s.levelFloorY(a.level - 1) + 0.25, z: tr.z }, kind,
            k === 0 ? 'Paquete de puntales' : `Vigas H20 y placas fenólicas (${k}/2)`, loadF);
        });
        break;
      case 'losaFierro':
        a.trips.forEach((tr, k) => this.trip(tr.t0, D0(tr), A.acopioFierro, { x: tr.x, y: s.slabBottomY(a.level) + 0.1, z: tr.z }, 'rebar', `Fierro de losa (${k + 1}/${a.trips.length})`, loadF));
        break;
      case 'terminaciones':
        if (a.level === 0) this.park(a.t0, 'Grúa liberada: terminaciones', a.t1 + 1e6);
        break;
    }
  }

  at(t: number): CraneState {
    const K = this.keys;
    let lo = 0, hi = K.length - 1;
    if (t <= K[0].t) lo = hi = 0;
    else if (t >= K[hi].t) lo = hi;
    else {
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (K[m].t <= t) lo = m; else hi = m;
      }
    }
    let slew: number, r: number, y: number;
    if (lo === hi) ({ slew, r, y } = K[lo]);
    else {
      const a = K[lo], b = K[hi];
      let u = (t - a.t) / (b.t - a.t);
      u = u * u * (3 - 2 * u);
      slew = a.slew + (b.slew - a.slew) * u;
      r = a.r + (b.r - a.r) * u;
      y = a.y + (b.y - a.y) * u;
    }
    const carry = this.carries.find((c) => t >= c.t0 && t < c.t1) ?? null;
    let fill = 0, open = 0;
    let cycle: CapachoCycle | null = null;
    if (carry?.kind === 'capacho') {
      for (const c of this.cycles) {
        if (t < c.fill[0]) break;
        cycle = c;
      }
      if (cycle) {
        const [f0, f1] = cycle.fill, [p0, p1] = cycle.pour;
        if (t < f1) fill = (t - f0) / (f1 - f0);
        else if (t < p0) fill = 1;
        else if (t < p1) {
          fill = 1 - (t - p0) / (p1 - p0);
          open = Math.min(1, (t - p0) / 0.25, (p1 - t) / 0.25);
        } else fill = 0;
        if (t > p1 + 0.2) cycle = null;
      }
    }
    const task = this.tasks.find((k) => t >= k.t0 && t < k.t1)?.task ?? 'En espera';
    return { slew, r, hookY: y, payload: carry?.kind ?? null, fill: Math.max(0, Math.min(1, fill)), open: Math.max(0, open), cycle, task };
  }
}
