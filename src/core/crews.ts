/**
 * Cuadrillas en obra: dónde está cada trabajador según la actividad en curso.
 * Posiciones deterministas (función del tiempo) para que la línea de tiempo sea navegable.
 */
import type { BuildingData } from '../data/building';
import type { Activity, Schedule } from './schedule';
import { haWalls } from './schedule';
import { offsetPolygon, pointInPolygon, polyBounds, type V2 } from '../scene/geom';
import { SITE } from '../config';

export type Action = 'idle' | 'walk' | 'work' | 'carry';

export interface CrewMember {
  x: number;
  y: number;
  z: number;
  heading: number;
  walk: number;
  action: Action;
  visible: boolean;
  vest: 0 | 1;
  helmet: 0 | 1 | 2 | 3;
}

/** Hash entero simple y estable. */
function hash(a: number, b: number) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export interface CrewSetup {
  data: BuildingData;
  sched: Schedule;
  ground: Record<string, { x: number; z: number }>;
}

export const CREW_ROLES = [
  { key: 'enfierradores', label: 'Enfierradores', short: 'Enfierradores', n: 18 },
  { key: 'carpinteros', label: 'Carpinteros de moldaje', short: 'Carpinteros', n: 22 },
  { key: 'concreteros', label: 'Concreteros', short: 'Concreteros', n: 9 },
  { key: 'grua', label: 'Operador y rigger de grúa', short: 'Grúa', n: 3 },
  { key: 'jornales', label: 'Jornales', short: 'Jornales', n: 20 },
  { key: 'mantencion', label: 'Instalaciones y mantención', short: 'Instalaciones', n: 7 },
  { key: 'supervision', label: 'Supervisión y prevención', short: 'Supervisión', n: 6 },
] as const;

/** Cuántas personas de cada cuadrilla están en la losa de trabajo según la actividad. */
const ACTIVE_ON_FLOOR: Record<Activity['kind'], number> = {
  fundaciones: 14,
  radier: 14,
  muroFierro: 22,
  muroMoldaje: 24,
  muroHormigon: 16,
  muroDesmolde: 16,
  losaMoldaje: 24,
  losaFierro: 22,
  losaHormigon: 18,
  terminaciones: 0,
};

const FLOOR_SLOTS = 26;
const GROUND_SLOTS = 16;
export const CREW_VISIBLE = FLOOR_SLOTS + GROUND_SLOTS;

export class Crews {
  private spots: V2[][] = [];
  members: CrewMember[];
  constructor(private s: CrewSetup) {
    const lv = s.data.levels;
    // puntos caminables por piso: dentro de la losa, lejos de muros y del borde
    for (let L = 0; L < lv.length; L++) {
      const slab = lv[L].slab;
      const inner = offsetPolygon(slab.outer, 0.6);
      const walls = haWalls(lv[L]).map((w) => offsetPolygon(w.poly, -0.35));
      const b = polyBounds(slab.outer);
      const pts: V2[] = [];
      for (let x = b.x0 + 0.8; x < b.x1; x += 1.1) {
        for (let z = b.z0 + 0.8; z < b.z1; z += 1.1) {
          if (pointInPolygon(x, z, inner) && !walls.some((p) => pointInPolygon(x, z, p))) pts.push([x, z]);
        }
      }
      this.spots[L] = pts;
    }
    this.members = Array.from({ length: CREW_VISIBLE }, (_, i) => ({
      x: 0, y: 0, z: 0, heading: 0, walk: 0, action: 'idle' as Action, visible: false,
      vest: (hash(i, 7) < 0.55 ? 0 : 1) as 0 | 1,
      helmet: (i % 9 === 0 ? 0 : i % 5 === 0 ? 3 : hash(i, 3) < 0.6 ? 1 : 2) as 0 | 1 | 2 | 3,
    }));
  }

  /** Foco de trabajo: dónde está la cuadrilla en la losa en este instante. */
  focus(a: Activity, t: number): { x: number; z: number; L: number; y: number } {
    const lv = this.s.data.levels;
    const trip = a.trips.find((tr) => t >= tr.t0 && t < tr.t1) ?? a.trips[a.trips.length - 1];
    const slabFront = (S: number, w: [number, number]) => {
      const b = polyBounds(lv[S].slab.outer);
      const k = Math.min(Math.max((t - w[0]) / (w[1] - w[0]), 0), 1);
      return b.x0 + k * (b.x1 - b.x0);
    };
    switch (a.kind) {
      case 'losaMoldaje': {
        const S = a.level;
        return { x: slabFront(S, this.s.sched.slab[S].props), z: polyBounds(lv[S].slab.outer).cz, L: S - 1, y: lv[S - 1].slab.y1 };
      }
      case 'losaFierro':
      case 'losaHormigon': {
        const S = a.level;
        const w = a.kind === 'losaFierro' ? this.s.sched.slab[S].rebar : this.s.sched.slab[S].pour;
        return { x: slabFront(S, w), z: polyBounds(lv[S].slab.outer).cz, L: S, y: lv[S].slab.y0 };
      }
      case 'radier':
        return { x: slabFront(0, this.s.sched.slab[0].pour), z: 0, L: 0, y: -0.12 };
      case 'fundaciones':
        return { x: trip?.x ?? 0, z: trip?.z ?? 0, L: 0, y: -0.2 };
      default:
        return { x: trip?.x ?? 0, z: trip?.z ?? 0, L: a.level, y: lv[a.level].slab.y1 };
    }
  }

  /** Puntos de la losa más cercanos al frente de trabajo en el instante `time`. */
  private nearFocus(a: Activity, time: number, cache: Map<number, { pts: V2[]; f: ReturnType<Crews['focus']> }>) {
    const key = Math.round(time * 4);
    let v = cache.get(key);
    if (!v) {
      const f = this.focus(a, Math.min(Math.max(time, a.t0), a.t1));
      const pts = (this.spots[f.L] ?? [])
        .map((p) => ({ p, d: Math.hypot(p[0] - f.x, (p[1] - f.z) * 1.6) }))
        .sort((u, w) => u.d - w.d)
        .slice(0, 20)
        .map((o) => o.p);
      v = { pts, f };
      cache.set(key, v);
    }
    return v;
  }

  update(t: number, a: Activity, groundTargets: { x: number; z: number; r?: number; action: Action }[]) {
    const seg = 3.2; // cada cuánto un trabajador cambia de puesto (s de simulación)
    const speed = 1.4; // m/s al caminar
    const nFloor = Math.min(ACTIVE_ON_FLOOR[a.kind], FLOOR_SLOTS);
    const cache = new Map<number, { pts: V2[]; f: ReturnType<Crews['focus']> }>();
    const now = this.nearFocus(a, t, cache);
    for (let i = 0; i < FLOOR_SLOTS; i++) {
      const m = this.members[i];
      m.visible = i < nFloor && now.pts.length > 0;
      if (!m.visible) continue;
      const ph = hash(i, 11) * seg;
      const k = Math.floor((t + ph) / seg);
      const tk = k * seg - ph; // inicio del tramo actual
      const prev = this.nearFocus(a, tk - seg, cache).pts;
      const cur = this.nearFocus(a, tk, cache).pts;
      if (!prev.length || !cur.length) { m.visible = false; continue; }
      const A = prev[Math.floor(hash(i, k) * prev.length)];
      const B = cur[Math.floor(hash(i, k + 1) * cur.length)];
      const dist = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const walkT = Math.min(Math.max(dist / speed, 0.4), seg * 0.8);
      const u = t - tk;
      if (u < walkT && dist > 0.05) {
        const w = u / walkT;
        m.x = A[0] + (B[0] - A[0]) * w;
        m.z = A[1] + (B[1] - A[1]) * w;
        m.action = hash(i, k + 99) < 0.25 ? 'carry' : 'walk';
        m.heading = Math.atan2(B[1] - A[1], B[0] - A[0]);
        m.walk = k * 7 + dist * w;
      } else {
        m.x = B[0];
        m.z = B[1];
        m.action = hash(i, k + 7) < 0.82 ? 'work' : 'idle';
        m.heading = Math.atan2(now.f.z - B[1], now.f.x - B[0]) + (hash(i, k + 3) - 0.5) * 1.6;
        m.walk = k * 7 + dist;
      }
      m.y = now.f.y;
    }
    // cuadrilla en terreno: rigger en el acopio, taller de fierro, mixer, caminatas
    for (let j = 0; j < GROUND_SLOTS; j++) {
      const m = this.members[FLOOR_SLOTS + j];
      const g = groundTargets[j % Math.max(groundTargets.length, 1)];
      m.visible = !!g;
      if (!g) continue;
      const ang = hash(j, 5) * Math.PI * 2;
      const rad = (g.r ?? 1.2) + hash(j, 6) * 1.6;
      const sway = Math.sin(t * 0.7 + j) * 0.35;
      m.x = g.x + Math.cos(ang) * rad + sway;
      m.z = g.z + Math.sin(ang) * rad;
      m.y = SITE.groundY;
      m.action = g.action;
      m.heading = Math.atan2(g.z - m.z, g.x - m.x);
      m.walk = t * 1.3 + j;
    }
  }
}
