/**
 * Plan de movimientos de la grúa torre a lo largo de toda la obra.
 *
 * Cada viaje se descompone en: izar → girar/trasladar el carro hacia el punto de carga →
 * bajar → enganchar → izar → girar hacia el destino → bajar → descargar → izar.
 * El estado de la grúa es una función pura del tiempo, por lo que la línea de tiempo
 * se puede adelantar o retroceder sin acumular errores.
 */
import type { Activity, Schedule } from './schedule';

/** timber: madera de la techumbre (pino impregnado, OSB); sheets: Aislán y planchas de zincalum. */
export type PayloadKind = 'panel' | 'rebar' | 'deck' | 'props' | 'capacho' | 'timber' | 'sheets';

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
   * del mixer detenido en el camino posterior (la grúa lo toma ahí, pasando sobre el edificio).
   */
  capachoFill: P3;
  /**
   * Punto (mundo) del suelo frente a la punta de la canaleta, sobre el eje del mixer: el capacho
   * baja ahí y entra (y sale) arrastrado a ras de suelo hasta el punto de llenado, así nunca baja ni
   * sube a través de la canaleta desplegada.
   */
  capachoSlide: P3;
  /**
   * Punto (mundo) del suelo donde queda el capacho entre hormigonados: a un costado del camino (lado
   * del talud), fuera del paso de los mixers y al lado del punto de entrada, para llevarlo de uno al
   * otro sin pasar sobre el camión. La grúa lo engancha ahí antes del primer viaje y lo deja al terminar.
   */
  capachoRest: P3;
  /** Distancia del gancho al fondo de cada tipo de carga. */
  hang: Record<PayloadKind, number>;
  /** Cota superior del edificio construido en el tiempo t (para izar con holgura). */
  topAt(t: number): number;
  levelFloorY(level: number): number;
  wallTopY(level: number): number;
  slabBottomY(level: number): number;
}

const TAU = Math.PI * 2;

/** Fracción del viaje que dura el arrastre del capacho a ras de suelo, al entrar o salir de la canaleta. */
const SLIDE = 0.025;

/**
 * Ventanas de un viaje de capacho (instantes absolutos): entra a ras de suelo bajo la canaleta, se
 * llena y sale. La logística del mixer usa las mismas ventanas (llega antes del primer llenado y
 * repliega la canaleta después de la última salida).
 */
export function capachoWindows(tr: { t0: number; t1: number }) {
  const D = tr.t1 - tr.t0;
  const T = (x: number) => tr.t0 + x * D;
  const [f0, f1] = [0.22, 0.32];
  const w: Record<'slideIn' | 'fill' | 'slideOut', [number, number]> = {
    slideIn: [T(f0 - SLIDE), T(f0)],
    fill: [T(f0), T(f1)],
    slideOut: [T(f1), T(f1 + SLIDE)],
  };
  return w;
}

/** Fracciones de un viaje de carga (ver trip): el índice 7 es cuando se suelta la carga en destino. */
export const LOAD_F = [0.05, 0.22, 0.3, 0.38, 0.46, 0.64, 0.72, 0.78, 0.86];

export class CranePlan {
  keys: Key[] = [];
  carries: { t0: number; t1: number; kind: PayloadKind; task: string }[] = [];
  cycles: CapachoCycle[] = [];
  tasks: { t0: number; t1: number; task: string }[] = [];
  constructor(private s: CraneSetup, private sched: Schedule) {
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

  /**
   * Viaje de capacho: llenado en el mixer y descarga sobre muros o zapatas. En el primero de la
   * serie (`first`) el capacho ya cuelga frente a la canaleta (lo trae pickCapacho) y solo baja.
   */
  private capacho(t0: number, D: number, to: P3, task: string, first: boolean) {
    const s = this.s;
    const h = s.hang.capacho;
    const fill = s.capachoFill, slide = s.capachoSlide;
    const T = (x: number) => t0 + x * D;
    const w = capachoWindows({ t0, t1: t0 + D });
    const safe = this.safeY(t0 + D, 'capacho', to, fill);
    // baja frente a la punta de la canaleta y entra a ras de suelo (2 cm) hasta apoyar sus patas con
    // la boca bajo la punta; al terminar el llenado sale igual y recién ahí se iza
    const atMixer = { x: fill.x, y: fill.y + 0.01, z: fill.z };
    const low = { x: slide.x, y: slide.y + 0.02, z: slide.z };
    const over = { x: to.x, y: to.y + 0.35, z: to.z };
    if (!first) {
      this.key(T(0.04), null, safe);
      this.key(T(0.15), low, safe);
    }
    this.key(w.slideIn[0], low, low.y + h);
    this.key(w.fill[0], atMixer, atMixer.y + h);
    this.key(w.fill[1], atMixer, atMixer.y + h);
    this.key(w.slideOut[1], low, low.y + h);
    this.key(w.slideOut[1] + 0.035 * D, low, safe);
    this.key(T(0.5), over, safe);
    this.key(T(0.55), over, over.y + h);
    this.key(T(0.86), over, over.y + h);
    this.key(T(0.93), over, over.y + h + 3);
    this.cycles.push({ fill: w.fill, pour: [T(0.55), T(0.86)], to });
    this.tasks.push({ t0, t1: t0 + D, task });
  }

  /**
   * Antes del primer viaje (entre t0 y t1): la grúa engancha el capacho donde quedó en reposo, lo
   * levanta lo justo para despegarlo del suelo y lo deja colgando frente a la punta de la canaleta
   * (detrás del mixer, que termina de llegar en retroceso); el primer viaje lo baja y lo entra bajo
   * la canaleta. Devuelve el instante del enganche.
   */
  private pickCapacho(t0: number, t1: number) {
    const s = this.s, h = s.hang.capacho;
    const rest = s.capachoRest, fill = s.capachoFill, slide = s.capachoSlide;
    const T = (x: number) => t0 + x * (t1 - t0);
    const safe = this.safeY(t1, 'capacho', rest, fill);
    const low = rest.y + 0.01 + h; // patas apoyadas en el suelo
    const lift = low + 1.8;
    this.key(T(0.05), null, safe);
    this.key(T(0.3), rest, safe);
    this.key(T(0.5), rest, low);
    this.key(T(0.58), rest, low);
    this.key(T(0.7), rest, lift);
    this.key(T(0.95), slide, lift);
    this.tasks.push({ t0, t1, task: 'Engancha el capacho junto al camino posterior' });
    return T(0.54);
  }

  /** Después del último viaje (entre t0 y t1): deja el capacho vacío en su lugar de reposo. Devuelve el instante en que lo suelta. */
  private returnCapacho(t0: number, t1: number) {
    const s = this.s, h = s.hang.capacho;
    const rest = s.capachoRest;
    const T = (x: number) => t0 + x * (t1 - t0);
    const low = rest.y + 0.01 + h;
    const safe = this.safeY(t0, 'capacho', rest);
    this.key(T(0.12), null, safe);
    this.key(T(0.5), rest, safe);
    this.key(T(0.8), rest, low);
    this.key(T(1), rest, low + 1.2);
    this.tasks.push({ t0, t1, task: 'Deja el capacho junto al camino posterior' });
    return T(0.84);
  }

  /** Serie de capachos de una actividad: lo engancha, hace todos los viajes y lo devuelve. */
  private capachoSeries(a: Activity, to: (tr: Activity['trips'][number]) => P3, task: (k: number) => string) {
    this.capachoSeriesAt(a.t0, a.t1, a.trips, to, task);
  }

  /** Serie de capachos entre t0 y t1 (engancha, viajes y lo deja en reposo). */
  private capachoSeriesAt<T extends { t0: number; t1: number }>(t0: number, t1: number, tr: T[], to: (tr: T) => P3, task: (k: number) => string) {
    const attach = this.pickCapacho(t0, tr[0].t0);
    tr.forEach((x, k) => this.capacho(x.t0, x.t1 - x.t0, to(x), task(k), k === 0));
    const last = tr[tr.length - 1];
    const release = this.returnCapacho(last.t0 + 0.93 * (last.t1 - last.t0), t1 - 0.05);
    // el capacho cuelga del gancho desde que se engancha hasta que vuelve al suelo
    this.carries.push({ t0: attach, t1: release, kind: 'capacho', task: '' });
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
    const loadF = LOAD_F;
    const formF = [0.04, 0.18, 0.25, 0.31, 0.38, 0.56, 0.62, 0.66, 0.74];
    switch (a.kind) {
      case 'fundaciones': {
        // paquetes de fierro dimensionado y de tableros al borde de cada sector, y series de capacho
        // (emplantillado, muros bajo NPT y V.S.C.), en orden de tiempo
        const F = this.sched.fund;
        const items = [
          ...F.craneTrips.map((c) => ({ t: c.t0, run: () => this.trip(c.t0, c.t1 - c.t0, c.kind === 'rebar' ? A.acopioFierro : A.acopioMoldajeMuro, { x: c.x, y: c.y, z: c.z }, c.kind, c.task, loadF) })),
          ...F.capachos.map((c) => ({
            t: c.t0,
            run: () => this.capachoSeriesAt(c.t0, c.t1, c.trips, (tr) => ({ x: tr.x, y: tr.y, z: tr.z }), (k) => `${c.task} (${k + 1}/${c.trips.length})`),
          })),
        ].sort((p, q) => p.t - q.t);
        for (const it of items) it.run();
        break;
      }
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
        this.capachoSeries(a, (tr) => ({ x: tr.x, y: s.wallTopY(a.level), z: tr.z }), (k) => `Capacho ${k + 1}/${a.trips.length}: hormigón a muros`);
        break;
      case 'muroDesmolde':
        a.trips.forEach((tr, k) => this.unload(tr, { x: tr.x, y: s.wallTopY(a.level) + 4.2, z: tr.z }, `Retiro de paneles, sector ${k + 1}/${a.trips.length}`));
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
      // --- obra gruesa sobre la losa de techumbre (los viajes traen su cota de trabajo) ---
      case 'techoFierro':
        a.trips.forEach((tr, k) => this.trip(tr.t0, D0(tr), A.acopioFierro, { x: tr.x, y: tr.y - 0.05, z: tr.z }, 'rebar', `Fierro de parapetos y caja de escala (${k + 1}/${a.trips.length})`, loadF));
        break;
      case 'techoMoldaje':
        a.trips.forEach((tr, k) => this.trip(tr.t0, D0(tr), A.acopioMoldajeMuro, { x: tr.x, y: tr.y + 0.6, z: tr.z }, 'panel', `Paneles de moldaje a la techumbre (${k + 1}/${a.trips.length})`, formF));
        break;
      case 'techoHormigon':
        this.capachoSeries(a, (tr) => ({ x: tr.x, y: tr.y, z: tr.z }), (k) => `Capacho ${k + 1}/${a.trips.length}: parapetos y caja de escala`);
        break;
      case 'techoDesmolde':
        a.trips.forEach((tr, k) => this.unload(tr, { x: tr.x, y: tr.y + 4.2, z: tr.z }, `Retiro de paneles de la techumbre (${k + 1}/${a.trips.length})`));
        break;
      case 'salaLosa': {
        // puntales, placas y fierro dentro de la caja; luego la serie de capachos de la losa
        const kinds: PayloadKind[] = ['props', 'deck', 'rebar'];
        const from = [A.acopioPuntales, A.acopioMoldajeLosa, A.acopioFierro];
        const tasks = ['Puntales para la losa de la caja de escala', 'Vigas H20 y placas fenólicas para la losa de la caja', 'Fierro de la losa de la caja'];
        a.trips.slice(0, 3).forEach((tr, k) => this.trip(tr.t0, D0(tr), from[k], { x: tr.x, y: tr.y, z: tr.z }, kinds[k], tasks[k], loadF));
        const caps = a.trips.slice(3);
        this.capachoSeriesAt(a.trips[2].t1, a.t1, caps, (tr) => ({ x: tr.x, y: tr.y, z: tr.z }), (k) => `Capacho ${k + 1}/${caps.length}: losa de la caja de escala`);
        break;
      }
      case 'terminaciones':
        if (a.level === 0) {
          // sube los materiales de la techumbre (madera, OSB, Aislán y zincalum) y queda libre hasta
          // que la desmontan, 5 días después de terminada la estructura de techumbre
          const R = this.sched.roof;
          const first = R.loads[0], last = R.loads[R.loads.length - 1];
          if (first.t0 - a.t0 > 2.4) this.park(a.t0, 'En espera: terminaciones', first.t0);
          else this.tasks.push({ t0: a.t0, t1: first.t0, task: 'En espera: terminaciones' });
          R.loads.forEach((ld) => this.trip(ld.t0, ld.t1 - ld.t0, A.acopioMoldajeLosa, { x: ld.x, y: ld.y, z: ld.z }, ld.kind, ld.task, loadF));
          this.park(last.t1, 'Grúa liberada: terminaciones', R.gruaOut);
          this.tasks.push({ t0: R.gruaOut, t1: R.gruaOut + 1e6, task: 'Grúa desmontada' });
        }
        break;
    }
  }

  /** Retiro de un paquete de paneles desde `at` (gancho sobre el muro) hasta el acopio de moldajes. */
  private unload(tr: { t0: number; t1: number }, at: P3, task: string) {
    const A = this.s.anchors;
    const D = tr.t1 - tr.t0;
    const T = (x: number) => tr.t0 + x * D;
    const safe = this.safeY(tr.t1, 'panel', at, A.acopioMoldajeMuro);
    const h = this.s.hang.panel;
    this.key(T(0.05), null, safe);
    this.key(T(0.16), at, safe);
    this.key(T(0.22), at, at.y + h);
    this.key(T(0.7), at, at.y + h);
    this.key(T(0.76), at, safe);
    this.key(T(0.9), A.acopioMoldajeMuro, safe);
    this.key(T(0.96), A.acopioMoldajeMuro, A.acopioMoldajeMuro.y + h);
    this.key(T(0.99), A.acopioMoldajeMuro, A.acopioMoldajeMuro.y + h + 0.5);
    this.carries.push({ t0: T(0.68), t1: T(0.97), kind: 'panel', task: '' });
    this.tasks.push({ t0: tr.t0, t1: tr.t1, task });
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
