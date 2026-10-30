/**
 * Fundaciones del Edificio E en la escena (planos E-01/E-02, ver core/fundPlan):
 *
 *  - Excavación: una malla de terreno propia sobre la planta de zanjas, cuyos vértices bajan del
 *    terreno (−0,20) al fondo de cada trozo de zanja mientras la excavadora lo abre (paredes
 *    verticales en la zona general y talud 3:1 en las zonas profundas) y vuelven a subir en capas de
 *    25 cm con el relleno lateral compactado. El terreno de la faena se recorta (máscara) sobre ella.
 *  - Cal del trazado y niveletas, emplantillado G05, enfierradura de zapatas (U inferiores,
 *    amarras, barras superiores y esperas del muro), moldaje de costados con costillas,
 *    tornapuntas y crucetas, "pollos" y muros bajo NPT, foso del ascensor con la V.S.C.,
 *    hormigón G25 que sube en el moldaje e impermeabilización Igol de las caras contra terreno.
 *
 * Todo es función del tiempo: las piezas usan materiales reveal y la excavación se recalcula en
 * update(t) a partir de las ventanas del plan.
 */
import * as THREE from 'three';
import { SITE } from '../config';
import type { Schedule } from '../core/schedule';
import type { ExcCell, StripTiming, WallPiece } from '../core/fundPlan';
import type { FootingStrip } from '../data/building';
import { GeoBuilder, pointInPolygon, type V2 } from './geom';
import { NEVER, revealMaterial, type RevealMaterial } from './reveal';
import { concreteTexture, formPanelTexture, plywoodTexture } from './textures';

/** Máscara en planta de la excavación: el terreno de la faena no se dibuja donde vale 1. */
export interface GroundMask {
  tex: THREE.DataTexture;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface Foundations {
  /** Terreno excavado (se deforma en update). */
  ground: THREE.Mesh;
  mask: GroundMask;
  /** Mallas seleccionables (zapatas, moldajes, excavación). */
  pickables: THREE.Mesh[];
  update(t: number): void;
}

/** Agrega una capa al edificio (misma firma que el `add` de structure.ts). */
export type AddLayer = (geo: THREE.BufferGeometry, mat: RevealMaterial, kind: string, level: number, from: number, to: number, pick?: boolean, shadows?: boolean) => THREE.Mesh | undefined;

const PLAT = SITE.groundY;
/** El terreno excavado queda 3 mm bajo el de la faena (donde se juntan manda el de la faena). */
const LIFT = -0.003;
const EPS = 0.012;
const k01 = (t: number, a: number, b: number) => Math.min(Math.max((t - a) / Math.max(b - a, 1e-6), 0), 1);

const COLORS = {
  rebar: '#5a3526',
  lean: '#a9a59c',
  igol: '#1c1c1e',
  timber: '#a57a4c',
  cal: '#f4f2ea',
};

export function buildFoundations(sched: Schedule, add: AddLayer, clipping: THREE.Plane[]): Foundations {
  const F = sched.fund;
  const fo = F.data.foso;
  const withClip = <T extends THREE.Material>(m: T) => {
    m.clippingPlanes = clipping;
    (m.userData.depth as THREE.Material | undefined)?.setValues({ clippingPlanes: clipping });
    return m;
  };
  const conc = concreteTexture();
  const ply = plywoodTexture();
  ply.repeat.set(1 / 1.22, 1 / 1.22);
  const form = formPanelTexture();
  form.repeat.set(1 / 1.2, 1 / 2.4);
  const M = {
    concrete: withClip(revealMaterial({ color: '#b8b4ab', map: conc, roughness: 0.95 }, { mode: 'rise', concrete: true, cap: true, cureTime: 10 })),
    lean: withClip(revealMaterial({ color: COLORS.lean, roughness: 1 }, { mode: 'rise', concrete: true, cap: true, cureTime: 6 })),
    rebar: withClip(revealMaterial({ color: COLORS.rebar, roughness: 0.55, metalness: 0.35 }, { mode: 'drop', dropHeight: 0.45 })),
    ply: withClip(revealMaterial({ color: '#ffffff', map: ply, roughness: 0.75 }, { mode: 'drop', dropHeight: 1.1, outLift: new THREE.Vector3(0, 2.2, 0) })),
    timber: withClip(revealMaterial({ color: COLORS.timber, roughness: 0.8 }, { mode: 'drop', dropHeight: 1.1, outLift: new THREE.Vector3(0, 2.2, 0) })),
    wallForm: withClip(revealMaterial({ color: '#ffffff', map: form, roughness: 0.55, metalness: 0.35 }, { mode: 'drop', dropHeight: 2.2, outLift: new THREE.Vector3(0, 3.5, 0) })),
    igol: withClip(revealMaterial({ color: COLORS.igol, roughness: 0.35, metalness: 0.05 }, { mode: 'pop' })),
    cal: withClip(revealMaterial({ color: COLORS.cal, roughness: 0.9 }, { mode: 'pop', outLift: new THREE.Vector3(0, 0, 0) })),
  };

  const strips = F.strips;
  const stripOf = new Map<FootingStrip, StripTiming>(strips.map((s) => [s.franja, s]));
  const franjas = F.data.franjas;
  const inStrip = (x: number, z: number, skip?: FootingStrip) =>
    franjas.some((f) => f !== skip && x > f.x0 - 1e-4 && x < f.x1 + 1e-4 && z > f.z0 - 1e-4 && z < f.z1 + 1e-4);
  const zoneOf = (s: number) => F.zones.get(s) ?? { sello: s, fondoY: s - 0.05, off: 0.38, talud: 0 };
  const sectorOf = (n: number) => F.sectors[n - 1];
  const fundEnd = F.t1;
  const picks: THREE.Mesh[] = [];

  // ---------------------------------------------------------------------------------------
  // Caras exteriores de cada zapata (las que no se comparten con otra franja): moldaje e Igol
  // ---------------------------------------------------------------------------------------
  interface Face { fr: FootingStrip; a: V2; b: V2; n: V2 }
  const faces: Face[] = [];
  for (const fr of franjas) {
    const edges: { a: V2; b: V2; n: V2 }[] = [
      { a: [fr.x0, fr.z0], b: [fr.x0, fr.z1], n: [-1, 0] },
      { a: [fr.x1, fr.z0], b: [fr.x1, fr.z1], n: [1, 0] },
      { a: [fr.x0, fr.z0], b: [fr.x1, fr.z0], n: [0, -1] },
      { a: [fr.x0, fr.z1], b: [fr.x1, fr.z1], n: [0, 1] },
    ];
    for (const e of edges) {
      const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
      const n = Math.max(1, Math.round(len / 0.05));
      let run0 = -1;
      for (let i = 0; i <= n; i++) {
        const u = (i + 0.5) / n;
        const px = e.a[0] + (e.b[0] - e.a[0]) * u + e.n[0] * 0.03, pz = e.a[1] + (e.b[1] - e.a[1]) * u + e.n[1] * 0.03;
        const ext = i < n && !inStrip(px, pz, fr);
        if (ext && run0 < 0) run0 = i;
        if (!ext && run0 >= 0) {
          const u0 = run0 / n, u1 = i / n;
          if ((u1 - u0) * len > 0.12) {
            faces.push({
              fr, n: e.n,
              a: [e.a[0] + (e.b[0] - e.a[0]) * u0, e.a[1] + (e.b[1] - e.a[1]) * u0],
              b: [e.a[0] + (e.b[0] - e.a[0]) * u1, e.a[1] + (e.b[1] - e.a[1]) * u1],
            });
          }
          run0 = -1;
        }
      }
    }
  }
  /** Avance (0..1) de un punto a lo largo de su franja (orden en que se arma). */
  const along = (fr: FootingStrip, x: number, z: number) =>
    fr.eje === 'x' ? k01(x, fr.x0, fr.x1) : k01(z, fr.z0, fr.z1);

  // ---------------------------------------------------------------------------------------
  // Cal del trazado y niveletas
  // ---------------------------------------------------------------------------------------
  {
    const g = new GeoBuilder();
    const nv = new GeoBuilder();
    const [tz0, tz1] = F.trazado;
    const brd = F.cells.map((c) => ({ x0: c.x0 - c.talud, x1: c.x1 + c.talud, z0: c.z0 - c.talud, z1: c.z1 + c.talud, c }));
    const inUnion = (x: number, z: number) => brd.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
    const firstDig = new Map<FootingStrip, number>();
    for (const c of F.cells) firstDig.set(c.franja, Math.min(firstDig.get(c.franja) ?? NEVER, c.dig[0]));
    for (const r of brd) {
      const sides: [V2, V2, V2][] = [
        [[r.x0, r.z0], [r.x1, r.z0], [0, -1]], [[r.x0, r.z1], [r.x1, r.z1], [0, 1]],
        [[r.x0, r.z0], [r.x0, r.z1], [-1, 0]], [[r.x1, r.z0], [r.x1, r.z1], [1, 0]],
      ];
      for (const [a, b, n] of sides) {
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const k = Math.max(1, Math.round(len / 0.25));
        for (let i = 0; i < k; i++) {
          const u0 = i / k, u1 = (i + 1) / k, um = (u0 + u1) / 2;
          const mx = a[0] + (b[0] - a[0]) * um, mz = a[1] + (b[1] - a[1]) * um;
          if (inUnion(mx + n[0] * 0.04, mz + n[1] * 0.04)) continue;
          // la cal se tira de −x a +x durante el trazado y desaparece cuando se abre ese trozo
          const tin = tz0 + 0.15 + k01(mx, -26, 28) * (tz1 - tz0 - 0.4);
          g.timing(tin, tin + 0.05, r.c.dig[0], r.c.dig[0] + 0.02);
          const ax = a[0] + (b[0] - a[0]) * u0, az = a[1] + (b[1] - a[1]) * u0;
          const bx = a[0] + (b[0] - a[0]) * u1, bz = a[1] + (b[1] - a[1]) * u1;
          const w = 0.035;
          g.aabb(Math.min(ax, bx) - w + n[0] * w, PLAT + 0.002, Math.min(az, bz) - w + n[1] * w, Math.max(ax, bx) + w + n[0] * w, PLAT + 0.008, Math.max(az, bz) + w + n[1] * w);
        }
      }
    }
    // niveletas (caballetes de madera con lienza) en los extremos del eje de las franjas largas
    for (const fr of franjas) {
      if (fr.L < 3) continue;
      const z = zoneOf(fr.sello);
      const out = z.off + z.talud + 0.7;
      const cx = (fr.x0 + fr.x1) / 2, cz = (fr.z0 + fr.z1) / 2;
      const ends: V2[] = fr.eje === 'x' ? [[fr.x0 - out, cz], [fr.x1 + out, cz]] : [[cx, fr.z0 - out], [cx, fr.z1 + out]];
      const gone = firstDig.get(fr) ?? NEVER;
      const tin = tz0 + 0.1 + k01(cx, -26, 28) * (tz1 - tz0 - 0.4);
      for (const [ex, ez] of ends) {
        if (inUnion(ex, ez) || inStrip(ex, ez)) continue;
        nv.timing(tin, tin + 0.05, gone, gone + 0.02);
        const half = (fr.B + 2 * z.off) / 2 + 0.25;
        const ux = fr.eje === 'x' ? 0 : 1, uz = fr.eje === 'x' ? 1 : 0;
        for (const s of [-1, 1]) nv.aabb(ex + ux * s * half - 0.03, PLAT, ez + uz * s * half - 0.03, ex + ux * s * half + 0.03, PLAT + 0.75, ez + uz * s * half + 0.03);
        nv.barN(ex - ux * half, PLAT + 0.68, ez - uz * half, ex + ux * half, PLAT + 0.68, ez + uz * half, 0.05);
      }
    }
    add(g.build(), M.cal, 'fund-cal', 0, tz0, F.sectors[2].exc[1] + 0.5, false, false);
    add(nv.build(), M.timber, 'fund-niveletas', 0, tz0, F.sectors[2].exc[1] + 0.5, false, true);
  }

  // ---------------------------------------------------------------------------------------
  // Emplantillado G05 (5 cm) y hormigón de las zapatas
  // ---------------------------------------------------------------------------------------
  const S2 = sectorOf(2);
  const lastEmplS2 = S2.empl.trips[S2.empl.trips.length - 1];
  const capPour = (tr: { t0: number; t1: number }): [number, number] => [tr.t0 + 0.55 * (tr.t1 - tr.t0), tr.t0 + 0.86 * (tr.t1 - tr.t0)];
  {
    const g = new GeoBuilder();
    for (const st of strips) {
      const fr = st.franja, y0 = zoneOf(fr.sello).fondoY;
      g.timing(st.empl[0], st.empl[1], NEVER, NEVER, y0, fr.sello - y0);
      g.aabb(fr.x0 - 0.05, y0, fr.z0 - 0.05, fr.x1 + 0.05, fr.sello, fr.z1 + 0.05);
    }
    // bajo la losa del foso y la V.S.C.
    const ef = capPour(lastEmplS2);
    g.timing(ef[0], ef[1], NEVER, NEVER, fo.losaFoso.y0 - 0.05, 0.05);
    g.aabb(fo.losaFoso.x0, fo.losaFoso.y0 - 0.05, fo.losaFoso.z0, fo.vsc.x1, fo.losaFoso.y0, fo.losaFoso.z1);
    g.aabb(fo.vsc.x0, fo.vsc.y0 - 0.05, fo.vsc.z0, fo.vsc.x1, fo.vsc.y0, fo.vsc.z1);
    add(g.build(), M.lean, 'fund-emplantillado', 0, F.t0, NEVER, false, false);
  }
  const footing = new GeoBuilder();
  footing.uvScale = 1 / 2.4;
  for (const st of strips) {
    const fr = st.franja;
    footing.timing(st.pour[0], st.pour[1], NEVER, NEVER, fr.sello, fr.tope - fr.sello);
    footing.aabb(fr.x0, fr.sello, fr.z0, fr.x1, fr.tope, fr.z1);
  }
  // losa del foso (con el sector 2) y V.S.C. 20/140 (con capacho)
  {
    const z07 = strips.find((s) => s.franja.id === 'Z07') ?? strips.find((s) => s.franja.sector === 2)!;
    const L = fo.losaFoso;
    footing.timing(z07.pour[0], z07.pour[1], NEVER, NEVER, L.y0, L.y1 - L.y0);
    footing.aabb(L.x0, L.y0, L.z0, L.x1, L.y1, L.z1);
    const vp = S2.npt ? capPour(S2.npt.cap.trips[0]) : z07.pour;
    const V = fo.vsc;
    footing.timing(vp[0], vp[1], NEVER, NEVER, V.y0, V.y1 - V.y0);
    footing.aabb(V.x0, V.y0, V.z0, V.x1, V.y1, V.z1);
  }
  // pollos (0,16 m, con la zapata) y muros bajo NPT (con capacho)
  for (const p of F.pieces) {
    footing.timing(p.pour[0], p.pour[1], NEVER, NEVER, p.y0, 0 - p.y0);
    footing.extrude(p.poly, [], p.y0, 0);
  }
  const footMesh = add(footing.build(), M.concrete, 'zapatas', 0, F.t0, NEVER);
  if (footMesh) {
    footMesh.userData.pick = { type: 'fund', id: 'zapatas' };
    picks.push(footMesh);
  }

  // ---------------------------------------------------------------------------------------
  // Enfierradura (E-02, todo Ø12 A630-420H en zapatas; visual: barras de 3 cm)
  // ---------------------------------------------------------------------------------------
  {
    const g = new GeoBuilder();
    const R = 0.028;
    const SP = 0.25; // separación visual (real: 18–20 cm)
    for (const st of strips) {
      const fr = st.franja;
      const [f0, f1] = st.fierro, D = f1 - f0;
      const sx = fr.eje === 'x';
      const L = sx ? fr.x1 - fr.x0 : fr.z1 - fr.z0;
      const W0 = (sx ? fr.z0 : fr.x0) + 0.05, W1 = (sx ? fr.z1 : fr.x1) - 0.05;
      const A0 = sx ? fr.x0 : fr.z0;
      const P = (a: number, y: number, w: number): [number, number, number] => (sx ? [a, y, w] : [w, y, a]);
      const bar = (p: [number, number, number], q: [number, number, number], w = R) => g.barN(p[0], p[1], p[2], q[0], q[1], q[2], w, false);
      const yB = fr.sello + 0.056, yLeg = Math.min(fr.sello + 0.55, fr.tope - 0.06), yT = fr.tope - 0.056;
      // U inferiores transversales, una tras otra a lo largo de la franja
      const n = Math.max(1, Math.floor((L - 0.1) / SP));
      for (let i = 0; i <= n; i++) {
        const a = A0 + 0.05 + ((L - 0.1) * i) / Math.max(n, 1);
        const t = f0 + (i / Math.max(n, 1)) * D * 0.5;
        g.timing(t, t + 0.22);
        bar(P(a, yB, W0), P(a, yB, W1));
        if (W1 - W0 > 0.3) {
          bar(P(a, yB, W0), P(a, yLeg, W0));
          bar(P(a, yB, W1), P(a, yLeg, W1));
        }
      }
      // amarras longitudinales sobre la parrilla
      g.timing(f0 + D * 0.5, f0 + D * 0.56);
      for (const u of [0.15, 0.5, 0.85]) {
        const w = W0 + (W1 - W0) * u;
        bar(P(A0 + 0.05, yB + R, w), P(A0 + L - 0.05, yB + R, w));
      }
      // superiores longitudinales con patas de 50 cm en los extremos
      const m = Math.max(1, Math.round((W1 - W0) / SP));
      for (let j = 0; j <= m; j++) {
        const w = W0 + ((W1 - W0) * j) / m;
        const t = f0 + D * (0.58 + (j / m) * 0.22);
        g.timing(t, t + 0.2);
        bar(P(A0 + 0.05, yT, w), P(A0 + L - 0.05, yT, w));
        if (L > 0.6) {
          bar(P(A0 + 0.05, yT, w), P(A0 + 0.05, Math.max(yT - 0.5, yB + 0.05), w));
          bar(P(A0 + L - 0.05, yT, w), P(A0 + L - 0.05, Math.max(yT - 0.5, yB + 0.05), w));
        }
      }
    }
    // esperas del muro: doble malla Ø8a20 anclada en la zapata (y barras de cabeza en los bordes)
    const inPiece = (x: number, z: number, self: WallPiece) => F.pieces.some((q) => q !== self && pointInPolygon(x, z, q.poly));
    for (const p of F.pieces) {
      const { cx, cz, ux, uz, len } = p.axis;
      const [f0, f1] = p.fierro, D = f1 - f0;
      const nx = -uz, nz = ux;
      const yBot = Math.max(p.franja.sello + 0.09, p.y0 - 0.85);
      const yTop = 0.58;
      const k = Math.max(1, Math.round((len - 0.1) / SP));
      for (let i = 0; i <= k; i++) {
        const s = -len / 2 + 0.05 + ((len - 0.1) * i) / k;
        const t = f0 + (i / k) * D * 0.7;
        g.timing(t, t + 0.25);
        for (const side of [-1, 1]) {
          const x = cx + ux * s + nx * side * 0.06, z = cz + uz * s + nz * side * 0.06;
          g.barN(x, yBot, z, x, yTop, z, 0.022, false);
        }
      }
      // horizontales: amarra en la cabeza de la zapata y, en los muros bajo NPT, cada 30 cm
      const hs: number[] = [p.franja.tope + 0.08, 0.3];
      if (p.deep) for (let y = p.y0 + 0.1; y < -0.05; y += 0.3) hs.push(y);
      g.timing(f0 + D * 0.72, f0 + D * 0.85);
      for (const y of hs) {
        for (const side of [-1, 1]) {
          const ox = nx * side * 0.075, oz = nz * side * 0.075;
          g.barN(cx - ux * len / 2 + ox, y, cz - uz * len / 2 + oz, cx + ux * len / 2 + ox, y, cz + uz * len / 2 + oz, 0.02, false);
        }
      }
      // barras de borde Ø16–Ø22 en las cabezas de muro (donde el muro no sigue en otra franja)
      g.timing(f0 + D * 0.85, f1);
      for (const e of [-1, 1]) {
        const ex = cx + ux * e * (len / 2 + 0.08), ez = cz + uz * e * (len / 2 + 0.08);
        if (inPiece(ex, ez, p)) continue;
        for (const side of [-1, 1]) {
          const x = cx + ux * e * (len / 2 - 0.05) + nx * side * 0.05, z = cz + uz * e * (len / 2 - 0.05) + nz * side * 0.05;
          g.barN(x, yBot, z, x, 1.2, z, 0.036, false);
        }
      }
    }
    // losa del foso: doble malla Ø8a15 (a 20 cm en la vista) y armadura de la V.S.C.
    {
      const L = fo.losaFoso;
      const [f0, f1] = S2.fierro;
      const tf = f0 + (f1 - f0) * 0.55;
      g.timing(tf, tf + 0.6);
      for (const y of [L.y0 + 0.05, L.y1 - 0.05]) {
        for (let x = L.x0 + 0.08; x < L.x1 - 0.04; x += 0.2) g.barN(x, y, L.z0 + 0.05, x, y, L.z1 - 0.05, 0.02, false);
        for (let z = L.z0 + 0.08; z < L.z1 - 0.04; z += 0.2) g.barN(L.x0 + 0.05, y + 0.02, z, L.x1 - 0.05, y + 0.02, z, 0.02, false);
      }
      const V = fo.vsc;
      const vw = S2.npt ? S2.npt.fierro : S2.fierro;
      g.timing(vw[0], vw[0] + (vw[1] - vw[0]) * 0.6);
      const xa = V.x0 + 0.045, xb = V.x1 - 0.045;
      for (const y of [V.y0 + 0.06, V.y1 - 0.06]) for (const x of [xa, xb]) g.barN(x, y, V.z0 + 0.05, x, y, V.z1 - 0.05, 0.035, false);
      for (let z = V.z0 + 0.1; z < V.z1 - 0.05; z += 0.2) {
        for (const x of [xa, xb]) g.barN(x, V.y0 + 0.06, z, x, V.y1 - 0.06, z, 0.02, false);
        for (const y of [V.y0 + 0.06, V.y1 - 0.06]) g.barN(xa, y, z, xb, y, z, 0.02, false);
      }
    }
    // (las esperas quedan ahogadas en los muros y el radier del 1er piso: no se ven en la obra terminada)
  const mr = add(g.build(), M.rebar, 'fund-fierro', 0, F.t0, sched.slab[0].pour[1]);
    if (mr) {
      mr.userData.pick = { type: 'fund', id: 'fierro' };
      picks.push(mr);
    }
  }

  // ---------------------------------------------------------------------------------------
  // Moldaje: tableros de terciado en los costados, costillas, tornapuntas, estacas y crucetas;
  // cuello del pollo con tablas; paneles de muro para los muros bajo NPT y la V.S.C.
  // ---------------------------------------------------------------------------------------
  {
    const pl = new GeoBuilder(), tb = new GeoBuilder(), wf = new GeoBuilder();
    pl.uvScale = 1;
    const timing = (b: GeoBuilder, st: { moldaje: [number, number]; strip: [number, number] }, p: number, lag = 0) => {
      const [m0, m1] = st.moldaje, [s0, s1] = st.strip;
      const tin = m0 + Math.min(p * 0.8 + lag, 0.95) * (m1 - m0);
      const tout = s0 + p * 0.55 * (s1 - s0);
      b.timing(tin, tin + Math.min(0.35, (m1 - m0) * 0.2), tout, tout + Math.max(0.3, (s1 - s0) * 0.4));
    };
    for (const f of faces) {
      const fr = f.fr, st = stripOf.get(fr)!;
      const z = zoneOf(fr.sello);
      const len = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]);
      const ux = (f.b[0] - f.a[0]) / len, uz = (f.b[1] - f.a[1]) / len;
      const [nx, nz] = f.n;
      const y0 = fr.sello, y1 = fr.tope + 0.04;
      // tableros de ≤ 2,44 m
      const k = Math.max(1, Math.ceil(len / 2.44));
      for (let i = 0; i < k; i++) {
        const s0 = (len * i) / k + 0.004, s1 = (len * (i + 1)) / k - 0.004;
        const ax = f.a[0] + ux * s0, az = f.a[1] + uz * s0, bx = f.a[0] + ux * s1, bz = f.a[1] + uz * s1;
        timing(pl, st, along(fr, (ax + bx) / 2, (az + bz) / 2));
        pl.aabb(
          Math.min(ax, bx) + Math.min(nx, 0) * 0.04 + Math.max(nx, 0) * 0.02, y0,
          Math.min(az, bz) + Math.min(nz, 0) * 0.04 + Math.max(nz, 0) * 0.02,
          Math.max(ax, bx) + Math.max(nx, 0) * 0.04 + Math.min(nx, 0) * 0.02, y1,
          Math.max(az, bz) + Math.max(nz, 0) * 0.04 + Math.min(nz, 0) * 0.02,
        );
      }
      // costillas cada 0,6 m; tornapuntas y estacas cada 1,2 m contra la pared de la zanja
      const ns = Math.max(1, Math.round(len / 0.6));
      for (let i = 0; i <= ns; i++) {
        const s = Math.min(Math.max((len * i) / ns, 0.04), len - 0.04);
        const px = f.a[0] + ux * s, pz = f.a[1] + uz * s;
        timing(tb, st, along(fr, px, pz), 0.04);
        const cx = px + nx * 0.075, cz = pz + nz * 0.075;
        tb.aabb(cx - 0.035 * Math.abs(uz) - 0.025 * Math.abs(ux), y0, cz - 0.035 * Math.abs(ux) - 0.025 * Math.abs(uz), cx + 0.035 * Math.abs(uz) + 0.025 * Math.abs(ux), y1 + 0.02, cz + 0.035 * Math.abs(ux) + 0.025 * Math.abs(uz));
        if (i % 2 === 0) {
          const reach = Math.max(0.14, z.off - 0.05);
          const yf = z.fondoY + 0.02;
          tb.barN(px + nx * 0.1, fr.sello + 0.72 * (fr.tope - fr.sello), pz + nz * 0.1, px + nx * reach, yf + 0.12, pz + nz * reach, 0.05);
          tb.aabb(px + nx * reach - 0.03, yf, pz + nz * reach - 0.03, px + nx * reach + 0.03, yf + 0.3, pz + nz * reach + 0.03);
        }
      }
    }
    // crucetas sobre el moldaje cada 1,2 m (fijan el ancho B)
    for (const st of strips) {
      const fr = st.franja;
      if (fr.B < 0.5 || fr.L < 0.8) continue;
      const sx = fr.eje === 'x';
      const L = sx ? fr.x1 - fr.x0 : fr.z1 - fr.z0;
      const n = Math.max(1, Math.round(L / 1.2));
      for (let i = 0; i < n; i++) {
        const a = (sx ? fr.x0 : fr.z0) + ((i + 0.5) * L) / n;
        const y = fr.tope + 0.06;
        timing(tb, st, (i + 0.5) / n, 0.1);
        if (sx) tb.aabb(a - 0.05, y, fr.z0 - 0.06, a + 0.05, y + 0.025, fr.z1 + 0.06);
        else tb.aabb(fr.x0 - 0.06, y, a - 0.05, fr.x1 + 0.06, y + 0.025, a + 0.05);
      }
    }
    // cuello del pollo (dos tablas de 1×6") y paneles de muro de los muros bajo NPT
    for (const p of F.pieces) {
      const { cx, cz, ux, uz, len, w } = p.axis;
      const nx = -uz, nz = ux;
      const st = { moldaje: p.forms, strip: p.strip };
      const b = p.deep ? wf : tb;
      const th = p.deep ? 0.06 : 0.025;
      for (const side of [-1, 1]) {
        const o = w / 2 + 0.006 + th / 2;
        const k = p.deep ? Math.max(1, Math.ceil(len / 1.2)) : 1;
        for (let i = 0; i < k; i++) {
          const s0 = -len / 2 + (len * i) / k, s1 = -len / 2 + (len * (i + 1)) / k;
          const ax = cx + ux * s0 + nx * side * o, az = cz + uz * s0 + nz * side * o;
          const bx = cx + ux * s1 + nx * side * o, bz = cz + uz * s1 + nz * side * o;
          timing(b, st, (i + 0.5) / k, 0.15);
          b.aabb(Math.min(ax, bx) - Math.abs(nx) * th / 2, p.y0, Math.min(az, bz) - Math.abs(nz) * th / 2, Math.max(ax, bx) + Math.abs(nx) * th / 2, p.deep ? 0.08 : 0.03, Math.max(az, bz) + Math.abs(nz) * th / 2);
        }
      }
    }
    // V.S.C.: paneles a ambas caras (de −1,40 a ±0,00)
    if (S2.npt) {
      const V = fo.vsc;
      const st = { moldaje: S2.npt.fierro, strip: S2.npt.strip };
      const k = Math.ceil((V.z1 - V.z0) / 1.2);
      for (let i = 0; i < k; i++) {
        const z0 = V.z0 + ((V.z1 - V.z0) * i) / k + 0.004, z1 = V.z0 + ((V.z1 - V.z0) * (i + 1)) / k - 0.004;
        timing(wf, st, 0.4 + (i / k) * 0.5, 0.2);
        wf.aabb(V.x0 - 0.066, V.y0, z0, V.x0 - 0.006, 0.08, z1);
        wf.aabb(V.x1 + 0.006, V.y0, z0, V.x1 + 0.066, 0.08, z1);
      }
    }
    const mPly = add(pl.build(), M.ply, 'fund-moldaje', 0, F.t0, fundEnd);
    const mTb = add(tb.build(), M.timber, 'fund-moldaje-madera', 0, F.t0, fundEnd);
    const mWf = add(wf.build(), M.wallForm, 'fund-moldaje-muros', 0, F.t0, fundEnd);
    for (const m of [mPly, mTb, mWf]) {
      if (!m) continue;
      m.userData.pick = { type: 'fund', id: 'moldaje' };
      picks.push(m);
    }
  }

  // ---------------------------------------------------------------------------------------
  // Impermeabilización Igol (2 manos de Primer + 1 de Denso) en las caras contra terreno
  // ---------------------------------------------------------------------------------------
  {
    const g = new GeoBuilder();
    // (el interior del foso del ascensor queda sin Igol: no va contra terreno)
    const L = fo.losaFoso;
    const facesFoso = (f: Face) => {
      const mx = (f.a[0] + f.b[0]) / 2 + f.n[0] * 0.1, mz = (f.a[1] + f.b[1]) / 2 + f.n[1] * 0.1;
      return mx > L.x0 && mx < fo.vsc.x1 && mz > L.z0 && mz < L.z1;
    };
    for (const f of faces) {
      if (facesFoso(f)) continue;
      const fr = f.fr, S = sectorOf(fr.sector);
      const p = along(fr, (f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2);
      const t = S.igol[0] + p * (S.igol[1] - S.igol[0]) * 0.7;
      g.timing(t, t + 0.05);
      const [nx, nz] = f.n;
      const x0 = Math.min(f.a[0], f.b[0]), x1 = Math.max(f.a[0], f.b[0]), z0 = Math.min(f.a[1], f.b[1]), z1 = Math.max(f.a[1], f.b[1]);
      g.aabb(x0 + Math.min(nx, 0) * 0.006, fr.sello + 0.002, z0 + Math.min(nz, 0) * 0.006, x1 + Math.max(nx, 0) * 0.006, fr.tope - 0.004, z1 + Math.max(nz, 0) * 0.006);
    }
    for (const p of F.pieces) {
      if (!p.deep) continue;
      const S = sectorOf(p.franja.sector);
      g.timing(S.igol[0] + 0.1, S.igol[0] + 0.15);
      const { cx, cz, ux, uz, len, w } = p.axis;
      const hx = Math.abs(ux) * len / 2 + Math.abs(uz) * (w / 2 + 0.006), hz = Math.abs(uz) * len / 2 + Math.abs(ux) * (w / 2 + 0.006);
      g.aabb(cx - hx, p.y0 + 0.002, cz - hz, cx + hx, -0.03, cz + hz);
    }
    add(g.build(), M.igol, 'fund-igol', 0, F.t0, NEVER, false, false);
  }

  // ---------------------------------------------------------------------------------------
  // Terreno excavado: malla de alturas sobre la planta de zanjas (función del tiempo)
  // ---------------------------------------------------------------------------------------
  const excavation = buildExcavation(F.cells, sched, fo.losaFoso);
  picks.push(excavation.mesh);
  return { ground: excavation.mesh, mask: excavation.mask, pickables: picks, update: excavation.update };
}

/** Malla de alturas de la excavación (ver encabezado del módulo). */
function buildExcavation(cells: ExcCell[], sched: Schedule, foso: { x0: number; x1: number; z0: number; z1: number }) {
  const F = sched.fund;
  // borde superior de cada trozo (fondo + talud)
  const R = cells.map((c) => ({ x0: c.x0 - c.talud, x1: c.x1 + c.talud, z0: c.z0 - c.talud, z1: c.z1 + c.talud }));
  let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
  for (const r of R) {
    bx0 = Math.min(bx0, r.x0); bx1 = Math.max(bx1, r.x1); bz0 = Math.min(bz0, r.z0); bz1 = Math.max(bz1, r.z1);
  }
  bx0 -= 0.6; bx1 += 0.6; bz0 -= 0.6; bz1 += 0.6;
  // ejes de la malla: cada 0,5 m más un par de líneas (±EPS) en cada borde de fondo y de talud,
  // así las paredes verticales quedan verticales y los escalones entre trozos se leen nítidos
  const axis = (lo: number, hi: number, edges: number[]) => {
    const v: number[] = [];
    for (let x = lo; x <= hi + 1e-6; x += 0.5) v.push(x);
    for (const e of edges) v.push(e - EPS, e + EPS);
    v.sort((a, b) => a - b);
    const out: number[] = [];
    for (const x of v) if (!out.length || x - out[out.length - 1] > 0.006) out.push(x);
    return out;
  };
  const ex: number[] = [], ez: number[] = [];
  cells.forEach((c, i) => {
    ex.push(c.x0, c.x1, R[i].x0, R[i].x1);
    ez.push(c.z0, c.z1, R[i].z0, R[i].z1);
  });
  ex.push(foso.x0, foso.x1);
  ez.push(foso.z0, foso.z1);
  const xs = axis(bx0, bx1, ex), zs = axis(bz0, bz1, ez);
  const nx = xs.length, nz = zs.length;

  // trozos que tocan cada vértice y su cota final de excavación
  const MAXC = 4;
  const vc = new Int16Array(nx * nz * MAXC).fill(-1);
  const vy = new Float32Array(nx * nz * MAXC);
  const yMin = new Float32Array(nx * nz).fill(PLAT);
  const sec = new Uint8Array(nx * nz);
  for (let ci = 0; ci < cells.length; ci++) {
    const c = cells[ci], r = R[ci];
    let i0 = 0;
    while (i0 < nx && xs[i0] <= r.x0) i0++;
    for (let i = i0; i < nx && xs[i] < r.x1; i++) {
      const x = xs[i];
      const dx = Math.max(c.x0 - x, 0, x - c.x1);
      for (let j = 0; j < nz; j++) {
        const z = zs[j];
        if (z <= r.z0 || z >= r.z1) continue;
        const dz = Math.max(c.z0 - z, 0, z - c.z1);
        if (c.talud <= 0 && (dx > 0 || dz > 0)) continue;
        const y = c.fondoY + Math.max(dx, dz) * 3;
        if (y >= PLAT - 1e-3) continue;
        const k = j * nx + i;
        for (let s = 0; s < MAXC; s++) {
          if (vc[k * MAXC + s] < 0) {
            vc[k * MAXC + s] = ci;
            vy[k * MAXC + s] = y;
            break;
          }
        }
        if (y < yMin[k]) {
          yMin[k] = y;
          sec[k] = c.sector;
        }
      }
    }
  }
  // solo los cuadros que tocan la excavación
  const used = new Int32Array(nx * nz).fill(-1);
  const quads: number[] = [];
  const isEx = (k: number) => vc[k * MAXC] >= 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      if (isEx(a) || isEx(b) || isEx(c) || isEx(d)) quads.push(a, b, c, d);
    }
  }
  const verts: number[] = [];
  for (const k of quads) if (used[k] < 0) used[k] = verts.push(k) - 1;
  const nV = verts.length;
  const pos = new Float32Array(nV * 3);
  const fill = new Float32Array(nV);
  const inFoso = new Uint8Array(nV);
  verts.forEach((k, v) => {
    const x = xs[k % nx], z = zs[Math.floor(k / nx)];
    pos.set([x, PLAT + LIFT, z], v * 3);
    inFoso[v] = x > foso.x0 && x < foso.x1 && z > foso.z0 && z < foso.z1 ? 1 : 0;
  });
  const idx: number[] = [];
  for (let q = 0; q < quads.length; q += 4) {
    const [a, b, c, d] = [used[quads[q]], used[quads[q + 1]], used[quads[q + 2]], used[quads[q + 3]]];
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const fillAttr = new THREE.BufferAttribute(fill, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('aFill', fillAttr);
  geo.setIndex(nV > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3((bx0 + bx1) / 2, -1, (bz0 + bz1) / 2), Math.hypot(bx1 - bx0, bz1 - bz0) / 2 + 3);

  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFill;\nvarying float vFill;\nvarying vec3 vGW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFill = aFill;\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vFill;
varying vec3 vGW;
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), f.x), f.y);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float d = ${(PLAT).toFixed(3)} - vGW.y;
  float n = gNoise(vGW.xz * 1.7) * 0.6 + gNoise(vGW.xz * 7.0) * 0.4;
  vec3 sand = mix(vec3(0.80, 0.66, 0.48), vec3(0.74, 0.59, 0.42), n);
  // U2: finos café rojizo; U3: maicillo café claro (gris en profundidad)
  float strata = gNoise(vec2(vGW.x * 0.6, vGW.y * 9.0));
  vec3 u2 = mix(vec3(0.47, 0.30, 0.19), vec3(0.55, 0.36, 0.23), strata);
  vec3 u3 = mix(vec3(0.71, 0.55, 0.36), vec3(0.66, 0.60, 0.50), smoothstep(1.4, 2.4, d));
  vec3 soil = mix(u2, u3, smoothstep(0.62, 0.92, d));
  vec3 fdx = dFdx(vGW), fdy = dFdy(vGW);
  vec3 fn = normalize(cross(fdx, fdy));
  // fondo perfilado a mano: plano y más claro
  if (abs(fn.y) > 0.9 && d > 0.3) soil = mix(u3, vec3(0.76, 0.63, 0.45), 0.4 + 0.2 * n);
  vec3 col = d < 0.025 ? sand : soil;
  // relleno compactado (integral o estabilizado): gris café, con huella de placa
  vec3 fillC = mix(vec3(0.63, 0.58, 0.50), vec3(0.57, 0.52, 0.45), n);
  col = mix(col, fillC, clamp(vFill, 0.0, 1.0));
  // (colores escritos en sRGB; el sombreado trabaja en espacio lineal)
  diffuseColor.rgb *= pow(col, vec3(2.2));
}`);
  };
  mat.customProgramCacheKey = () => 'excavacion-fundaciones';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'excavacion-fundaciones';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.userData.pick = { type: 'fund', id: 'excavacion' };

  // ventanas por vértice
  const sectors = F.sectors;
  const digOf = cells.map((c) => c.dig);
  const t0 = Math.min(...cells.map((c) => c.dig[0]));
  const tEnd = Math.max(...sectors.map((s) => s.relleno[1]));
  let lastT = NaN;
  const update = (t: number) => {
    const tc = Math.min(Math.max(t, t0 - 1), tEnd + 1);
    if (tc === lastT) return;
    lastT = tc;
    for (let v = 0; v < nV; v++) {
      const k = verts[v];
      let y = PLAT;
      for (let s = 0; s < MAXC; s++) {
        const ci = vc[k * MAXC + s];
        if (ci < 0) break;
        const [a, b] = digOf[ci];
        const kk = tc <= a ? 0 : tc >= b ? 1 : (tc - a) / (b - a);
        const yy = PLAT + (vy[k * MAXC + s] - PLAT) * kk;
        if (yy < y) y = yy;
      }
      let fl = 0;
      if (yMin[k] < PLAT - 1e-3 && !inFoso[v]) {
        // relleno lateral en capas de 25 cm (cada capa se esparce y se compacta)
        const S = sectors[sec[k] - 1];
        const kf = k01(tc, S.relleno[0], S.relleno[1]);
        if (kf > 0) {
          const D = PLAT - yMin[k];
          const N = Math.max(1, Math.ceil(D / 0.25));
          const q = kf * N, li = Math.floor(q), fr = q - li;
          const lvl = Math.min(1, (li + Math.min(1, fr / 0.6)) / N);
          const yf = yMin[k] + D * lvl;
          if (yf > y) {
            y = yf;
            fl = 1;
          }
        }
      }
      pos[v * 3 + 1] = y + LIFT;
      fill[v] = fl;
    }
    posAttr.needsUpdate = true;
    fillAttr.needsUpdate = true;
  };
  update(-1e6);

  // máscara para el terreno de la faena: 1 dentro del borde de excavación (más 3 cm)
  const RES = 0.05;
  const W = Math.ceil((bx1 - bx0) / RES), H = Math.ceil((bz1 - bz0) / RES);
  const data = new Uint8Array(W * H);
  for (const r of R) {
    const i0 = Math.max(0, Math.floor((r.x0 - 0.03 - bx0) / RES)), i1 = Math.min(W - 1, Math.ceil((r.x1 + 0.03 - bx0) / RES));
    const j0 = Math.max(0, Math.floor((r.z0 - 0.03 - bz0) / RES)), j1 = Math.min(H - 1, Math.ceil((r.z1 + 0.03 - bz0) / RES));
    for (let j = j0; j <= j1; j++) data.fill(255, j * W + i0, j * W + i1 + 1);
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return { mesh, update, mask: { tex, x0: bx0, z0: bz0, x1: bx0 + W * RES, z1: bz0 + H * RES } };
}
