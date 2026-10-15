/**
 * Estructura del Edificio E construida en el tiempo: muros, losas, fierro, moldajes,
 * puntales, barandas y terminaciones. Todo se genera una vez desde los polígonos del IFC
 * y se anima con materiales reveal según el cronograma.
 */
import * as THREE from 'three';
import type { BuildingData, LevelData, WallData } from '../data/building';
import type { Schedule } from '../core/schedule';
import { haWalls } from '../core/schedule';
import { GeoBuilder, offsetPolygon, pointInPolygon, polyBounds, samplePerimeter, scanline, type V2 } from './geom';
import { NEVER, revealMaterial, revealMesh, type RevealMaterial } from './reveal';
import { concreteTexture, formPanelTexture, plywoodTexture } from './textures';

export interface Layer {
  mesh: THREE.Mesh;
  /** Ventana en que la capa puede verse; fuera de ella se oculta y se libera la GPU. */
  from: number;
  to: number;
  kind: string;
  level: number;
}

export interface SlabSweep {
  xmin: number;
  xmax: number;
  zmin: number;
  zmax: number;
  strips: number;
  y: number;
  pour: [number, number];
}

export interface Structure {
  group: THREE.Group;
  layers: Layer[];
  pickables: THREE.Mesh[];
  /** Parámetros del barrido de hormigonado de cada losa (para guiar la pluma de la bomba). */
  sweeps: SlabSweep[];
  /** Planos de corte (vista "Corte"): se activan/desactivan desde la app. */
  clipping: THREE.Plane[];
  update(t: number): void;
  /** true si el punto (cara) de la malla ya existe en el tiempo t. */
  isBuiltAt(mesh: THREE.Mesh, faceIndex: number, t: number): boolean;
}

const C = {
  concrete: '#c9c6bf',
  rebar: '#5f3b27',
  prop: '#c7352c',
  beam: '#e2b11f',
  guard: '#f0c22a',
  edge: '#9a5530',
  facade: '#e2dfd8',
  pvc: '#f1f0ec',
  glass: '#3f5361',
  railing: '#4a2b27',
  door: '#7a5232',
};

type Mats = ReturnType<typeof makeSharedMaterials>;

function makeSharedMaterials(clip: THREE.Plane[]) {
  const conc = concreteTexture();
  conc.repeat.set(1, 1);
  const form = formPanelTexture();
  form.repeat.set(1 / 1.2, 1 / 2.4);
  const ply = plywoodTexture();
  ply.repeat.set(1 / 2.44, 1 / 1.22);
  const withClip = <T extends THREE.Material>(m: T) => {
    m.clippingPlanes = clip;
    (m.userData.depth as THREE.Material | undefined)?.setValues({ clippingPlanes: clip });
    return m;
  };
  return {
    concTex: conc,
    plyTex: ply,
    wallConcrete: withClip(revealMaterial(
      { color: C.concrete, map: conc, roughness: 0.92 },
      { mode: 'rise', concrete: true, cap: true, cureTime: 18, paint: C.facade },
    )),
    footing: withClip(revealMaterial({ color: '#b3afa7', map: conc, roughness: 0.95 }, { mode: 'rise', concrete: true, cap: true, cureTime: 12 })),
    wallRebar: withClip(revealMaterial({ color: C.rebar, roughness: 0.55, metalness: 0.35 }, { mode: 'rise' })),
    wallForm: withClip(revealMaterial({ color: '#ffffff', map: form, roughness: 0.55, metalness: 0.35 }, { mode: 'drop', dropHeight: 2.6, outLift: new THREE.Vector3(0, 4.5, 0) })),
    props: withClip(revealMaterial({ color: C.prop, roughness: 0.5, metalness: 0.4 }, { mode: 'drop', dropHeight: 0.35, outLift: new THREE.Vector3(0, -0.4, 0) })),
    beams: withClip(revealMaterial({ color: C.beam, roughness: 0.75 }, { mode: 'drop', dropHeight: 0.6, outLift: new THREE.Vector3(0, -0.4, 0) })),
    edge: withClip(revealMaterial({ color: '#ffffff', map: ply, roughness: 0.7 }, { mode: 'drop', dropHeight: 0.8, outLift: new THREE.Vector3(0, 1.5, 0) })),
    guard: withClip(revealMaterial({ color: C.guard, roughness: 0.7 }, { mode: 'drop', dropHeight: 0.5, outLift: new THREE.Vector3(0, 0.6, 0) })),
    finishWall: withClip(revealMaterial({ color: C.facade, roughness: 0.9 }, { mode: 'rise' })),
    pvc: withClip(revealMaterial({ color: C.pvc, roughness: 0.5 }, { mode: 'drop', dropHeight: 0.6 })),
    glass: withClip(revealMaterial({ color: C.glass, roughness: 0.12, metalness: 0.65 }, { mode: 'drop', dropHeight: 0.6 })),
    railing: withClip(revealMaterial({ color: C.railing, roughness: 0.5, metalness: 0.5 }, { mode: 'drop', dropHeight: 0.6 })),
    door: withClip(revealMaterial({ color: C.door, roughness: 0.6 }, { mode: 'drop', dropHeight: 0.6 })),
    excavation: withClip(revealMaterial({ color: '#7d5b3b', roughness: 1 }, { mode: 'pop' })),
  };
}

/** Fracción 0..1 de x dentro de un rango (orden de avance a lo largo del edificio). */
const fx = (x: number, x0: number, x1: number) => Math.min(Math.max((x - x0) / Math.max(x1 - x0, 1e-3), 0), 1);

export function buildStructure(data: BuildingData, sched: Schedule, detail: ArrayBuffer): Structure {
  const group = new THREE.Group();
  group.name = 'edificio';
  const clipping: THREE.Plane[] = [];
  const M: Mats = makeSharedMaterials(clipping);
  const layers: Layer[] = [];
  const pickables: THREE.Mesh[] = [];
  const sweeps: SlabSweep[] = [];
  const levels = data.levels;
  const nWall = sched.wall.length;
  const lastFinish = sched.finish[sched.finish.length - 1][1];

  const add = (
    geo: THREE.BufferGeometry, mat: RevealMaterial, kind: string, level: number, from: number, to: number,
    pick = false, shadows = true,
  ) => {
    if (!geo.getAttribute('position') || geo.getAttribute('position').count === 0) return;
    const mesh = revealMesh(geo, mat, shadows);
    mesh.name = `${kind}-${levels[level]?.name ?? level}`;
    mesh.userData.kind = kind;
    mesh.userData.level = level;
    if (pick) {
      mesh.userData.pick = { type: 'level', id: levels[level]?.name };
      pickables.push(mesh);
    }
    group.add(mesh);
    layers.push({ mesh, from, to, kind, level });
  };

  const bboxAll = polyBounds(levels[levels.length - 1].slab.outer);
  const X0 = bboxAll.x0, X1 = bboxAll.x1;

  // --- Excavación y fundaciones -------------------------------------------------------
  {
    const g = new GeoBuilder();
    const rad = sched.slab[0].pour;
    g.timing(0, 0, rad[1], rad[1] + 0.2);
    g.extrude(offsetPolygon(levels[0].slab.outer, -1.6), [], -0.2, -0.186, false, false);
    add(g.build(), M.excavation, 'excavacion', 0, 0, rad[1] + 0.3, false, false);

    const f = new GeoBuilder();
    f.uvScale = 1 / 2.4;
    haWalls(levels[0]).forEach((w, i) => {
      const [p0, p1] = sched.footing[i];
      f.timing(p0, p1, NEVER, NEVER, -0.75, 0.6);
      f.extrude(offsetPolygon(w.poly, -0.22), [], -0.75, -0.15);
    });
    add(f.build(), M.footing, 'zapatas', 0, sched.foundations[0], sched.slab[0].pour[1] + 2);
  }

  // --- Losas: radier (0) y losas 2P…Techumbre (1..7) ------------------------------------
  levels.forEach((lv, S) => {
    const sl = lv.slab;
    const st = sched.slab[S];
    if (!st) return;
    const b = polyBounds(sl.outer);
    const strips = S === 0 ? 4 : 6;
    const sweep = { xmin: b.x0, xmax: b.x1, zmin: b.z0, zmax: b.z1, strips, dir: 1 as const };
    sweeps[S] = { ...sweep, y: sl.y1, pour: st.pour };
    const paintWin = S === 0 ? null : sched.finish[Math.min(S - 1, nWall - 1)];

    // hormigón de losa (barrido en zig-zag como la bomba)
    const concMat = revealMaterial(
      { color: C.concrete, map: M.concTex, roughness: 0.9 },
      { mode: 'sweep', concrete: true, cureTime: 22, sweep, ...(paintWin ? { paint: C.facade } : {}) },
    );
    concMat.clippingPlanes = clipping;
    const gc = new GeoBuilder();
    gc.uvScale = 1 / 2.4;
    gc.timing(st.pour[0], st.pour[1], paintWin ? paintWin[0] : NEVER, paintWin ? paintWin[0] + (paintWin[1] - paintWin[0]) * 0.7 : NEVER, sl.y0, sl.y1 - sl.y0);
    gc.extrude(sl.outer, sl.holes, sl.y0, sl.y1);
    add(gc.build(), concMat, 'losa', S, st.pour[0], NEVER, true);

    // fierro de losa: malla inferior y superior
    const rebMat = revealMaterial({ color: C.rebar, roughness: 0.55, metalness: 0.35 }, { mode: 'sweep', sweep: { ...sweep, strips: 0 } });
    rebMat.clippingPlanes = clipping;
    const gr = new GeoBuilder();
    gr.timing(st.rebar[0], st.rebar[1]);
    const layersY = S === 0 ? [sl.y0 + 0.06] : [sl.y0 + 0.035, sl.y1 - 0.035];
    layersY.forEach((y, li) => {
      const step = li === 0 ? 0.3 : 0.6;
      for (let z = b.z0 + 0.12; z < b.z1; z += step) {
        const xs = scanline(sl.outer, 'z', z);
        for (let k = 0; k + 1 < xs.length; k += 2) gr.bar(new THREE.Vector3(xs[k] + 0.04, y, z), new THREE.Vector3(xs[k + 1] - 0.04, y, z), 0.018, false);
      }
      for (let x = b.x0 + 0.12; x < b.x1; x += step) {
        const zs = scanline(sl.outer, 'x', x);
        for (let k = 0; k + 1 < zs.length; k += 2) gr.bar(new THREE.Vector3(x, y + 0.018, zs[k] + 0.04), new THREE.Vector3(x, y + 0.018, zs[k + 1] - 0.04), 0.018, false);
      }
    });
    add(gr.build(), rebMat, 'fierro-losa', S, st.rebar[0], st.pour[1] + 6, false, false);

    if (S === 0) return; // el radier va sobre el terreno, sin moldaje

    const below = levels[S - 1];
    const floorY = below.slab.y1;
    const wallsBelow = haWalls(below).map((w) => offsetPolygon(w.poly, -0.35));
    const blocked = (x: number, z: number) => wallsBelow.some((p) => pointInPolygon(x, z, p));
    const wallsTight = haWalls(below).map((w) => offsetPolygon(w.poly, -0.05));

    // placa fenólica (barrido lineal) — fondo de losa
    const deckMat = revealMaterial({ color: '#ffffff', map: M.plyTex, roughness: 0.65 }, { mode: 'sweep', sweep: { ...sweep, strips: 0 } });
    deckMat.clippingPlanes = clipping;
    const gd = new GeoBuilder();
    gd.timing(st.deck[0], st.deck[1], st.deckOut[0], st.deckOut[1]);
    gd.extrude(offsetPolygon(sl.outer, 0.02), sl.holes, sl.y0 - 0.025, sl.y0 - 0.003, false, true);
    add(gd.build(), deckMat, 'placas', S, st.deck[0], st.deckOut[1]);

    // puntales y vigas H20, avanzan a lo largo del edificio
    const gp = new GeoBuilder();
    const gb = new GeoBuilder();
    const span = 1.25;
    const propTop = sl.y0 - 0.025 - 0.2;
    const [p0, p1] = st.props;
    const [o0, o1] = st.propsOut;
    for (let x = b.x0 + 0.6; x < b.x1 - 0.3; x += span) {
      const k = fx(x, b.x0, b.x1);
      const tIn = p0 + k * (p1 - p0 - 0.4);
      const tOut = o0 + k * (o1 - o0 - 0.3);
      const zs = scanline(sl.outer, 'x', x);
      for (let s = 0; s + 1 < zs.length; s += 2) {
        // viga primaria a lo largo de z, interrumpida donde hay muros
        gb.timing(Math.min(tIn + 0.25, st.deck[1] - 0.3), Math.min(tIn + 0.55, st.deck[1]), tOut, tOut + 0.3);
        let run: number | null = null;
        for (let z = zs[s] + 0.15; z <= zs[s + 1] - 0.15 + 1e-6; z += 0.2) {
          const free = !wallsTight.some((p) => pointInPolygon(x, z, p));
          if (free && run === null) run = z;
          if ((!free || z + 0.2 > zs[s + 1] - 0.15) && run !== null) {
            const zEnd = free ? z : z - 0.2;
            if (zEnd - run > 0.4) gb.aabb(x - 0.04, propTop, run, x + 0.04, propTop + 0.2, zEnd);
            run = null;
          }
        }
        for (let z = zs[s] + 0.5; z < zs[s + 1] - 0.3; z += span) {
          if (!pointInPolygon(x, z, below.slab.outer) || blocked(x, z)) continue;
          gp.timing(tIn, tIn + 0.35, tOut, tOut + 0.3);
          gp.cylinder(x, z, floorY, propTop, 0.032, 6);
          gp.aabb(x - 0.07, floorY, z - 0.07, x + 0.07, floorY + 0.012, z + 0.07);
          gp.aabb(x - 0.06, propTop - 0.012, z - 0.06, x + 0.06, propTop, z + 0.06);
        }
      }
    }
    add(gp.build(), M.props, 'puntales', S, p0, o1);
    add(gb.build(), M.beams, 'vigas', S, st.props[0], o1);

    // frontales de borde de losa y barandas perimetrales de seguridad (amarillas)
    const ge = new GeoBuilder();
    ge.uvScale = 1;
    const gg = new GeoBuilder();
    const outer = sl.outer;
    const guardIn = st.deck[1] - 0.5;
    const guardOut = S < nWall ? sched.finish[S][0] : lastFinish - 1.2;
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i], c = outer[(i + 1) % outer.length];
      const mx = (a[0] + c[0]) / 2;
      const k = fx(mx, b.x0, b.x1);
      const tE = st.deck[0] + k * (st.deck[1] - st.deck[0] - 0.4);
      const tR = st.pour[1] + 2.5 + k * 2.5;
      ge.timing(tE, tE + 0.4, tR, tR + 0.4);
      // contorno antihorario → offset negativo hacia afuera
      ge.wallPanel(a, c, sl.y0 - 0.06, sl.y1 + 0.06, 0.035, outward(outer));
    }
    const rail = offsetPolygon(outer, 0.12);
    gg.timing(guardIn, guardIn + 0.5, guardOut, guardOut + 0.6);
    for (const { p } of samplePerimeter(rail, 1.9)) gg.aabb(p[0] - 0.035, sl.y1, p[1] - 0.035, p[0] + 0.035, sl.y1 + 1.1, p[1] + 0.035);
    for (let i = 0; i < rail.length; i++) {
      const a = rail[i], c = rail[(i + 1) % rail.length];
      for (const h of [0.5, 1.02]) gg.bar(new THREE.Vector3(a[0], sl.y1 + h, a[1]), new THREE.Vector3(c[0], sl.y1 + h, c[1]), 0.05);
      gg.bar(new THREE.Vector3(a[0], sl.y1 + 0.08, a[1]), new THREE.Vector3(c[0], sl.y1 + 0.08, c[1]), 0.15, false);
    }
    add(ge.build(), M.edge, 'frontales', S, st.deck[0], st.pour[1] + 5.5);
    add(gg.build(), M.guard, 'barandas', S, guardIn, guardOut + 0.7, false, false);
  });

  // --- Muros de hormigón armado por piso ------------------------------------------------
  for (let L = 0; L < nWall; L++) {
    const lv = levels[L];
    const walls = haWalls(lv);
    const timing = sched.wall[L];
    const fin = sched.finish[L];
    const conc = new GeoBuilder();
    conc.uvScale = 1 / 2.4;
    const reb = new GeoBuilder();
    const form = new GeoBuilder();
    form.uvScale = 1;
    walls.forEach((w, i) => {
      const tm = timing[i];
      const h = w.y1 - w.y0;
      conc.timing(tm.pour[0], tm.pour[1], fin[0] + (i / walls.length) * (fin[1] - fin[0]) * 0.4, fin[0] + (fin[1] - fin[0]) * 0.75, w.y0, h);
      conc.extrude(w.poly, [], w.y0, w.y1);
      wallRebar(reb, w, tm.rebar, L < nWall - 1);
      wallForm(form, w, tm.form, tm.strip);
    });
    const nextPour = L + 1 < nWall ? sched.wall[L + 1].reduce((m, t) => Math.max(m, t.pour[1]), 0) : sched.slab[L + 1].pour[1] + 2;
    const firstPour = Math.min(...timing.map((t) => t.pour[0]));
    add(conc.build(), M.wallConcrete, 'muros', L, firstPour, NEVER, true);
    add(reb.build(), M.wallRebar, 'fierro-muros', L, Math.min(...timing.map((t) => t.rebar[0])), nextPour + 1, false, false);
    add(form.build(), M.wallForm, 'moldaje-muros', L, Math.min(...timing.map((t) => t.form[0])), Math.max(...timing.map((t) => t.strip[1])) + 0.2);

    // --- Terminaciones del piso: tabiquería, fachada liviana, ventanas, barandas -------
    const fw = new GeoBuilder();
    const light = lv.walls.filter((w) => !w.ha);
    const [f0, f1] = fin;
    light.forEach((w) => {
      const c = polyBounds(w.poly);
      const k = fx(c.cx, X0, X1);
      const s = f0 + k * (f1 - f0) * 0.45;
      fw.timing(s, s + (f1 - f0) * 0.25, NEVER, NEVER, w.y0, w.y1 - w.y0);
      fw.extrude(w.poly, [], w.y0, w.y1);
    });
    add(fw.build(), M.finishWall, 'tabiques', L, f0, NEVER, true);
    const mats = { window: M.pvc, plate: M.glass, railing: M.railing, door: M.door } as const;
    for (const grp of data.detail.groups.filter((g) => g.level === lv.name)) {
      const geo = detailGeometry(detail, grp.offset, grp.count, f0 + (f1 - f0) * 0.4, f1, X0, X1);
      add(geo, mats[grp.kind], grp.kind, L, f0, NEVER, false, grp.kind !== 'plate');
    }
  }

  const struct: Structure = {
    group, layers, pickables, sweeps, clipping,
    update(t: number) {
      for (const l of layers) {
        const vis = t >= l.from - 0.05 && t <= l.to;
        if (l.mesh.visible !== vis) {
          l.mesh.visible = vis;
          // libera memoria de GPU de capas que salen de escena (se re-suben si vuelven)
          if (!vis && l.mesh.userData.uploaded) {
            l.mesh.geometry.dispose();
            l.mesh.userData.uploaded = false;
          }
          if (vis) l.mesh.userData.uploaded = true;
        }
      }
    },
    isBuiltAt(mesh, faceIndex, t) {
      const idx = mesh.geometry.index;
      const aT = mesh.geometry.getAttribute('aT') as THREE.BufferAttribute | undefined;
      if (!aT) return true;
      const v = idx ? idx.getX(faceIndex * 3) : faceIndex * 3;
      const in1 = aT.getY(v);
      const out1 = aT.getW(v);
      const paints = !!(mesh.material as THREE.Material).defines?.REVEAL_PAINT;
      return t >= in1 && (paints || t < out1);
    },
  };
  return struct;
}

/** Signo para desplazar paneles hacia afuera de un contorno según su orientación. */
function outward(poly: V2[]) {
  // wallPanel desplaza hacia la normal derecha del avance (dz, -dx); para contornos
  // antihorarios en (x, z) esa normal apunta hacia afuera.
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length];
    a += x0 * z1 - x1 * z0;
  }
  return a > 0 ? 0 : -0.035;
}

/** Fierro de muro: barras verticales (con arranques sobre la losa) y horizontales a ambas caras. */
function wallRebar(g: GeoBuilder, w: WallData, [t0, t1]: [number, number], starters: boolean) {
  const top = starters ? w.y1 + 0.55 : w.y1 - 0.03;
  g.timing(t0, t1, NEVER, NEVER, w.y0, top - w.y0);
  const loop = offsetPolygon(w.poly, Math.min(0.05, w.t * 0.3));
  for (const { p } of samplePerimeter(loop, 0.32)) {
    g.bar(new THREE.Vector3(p[0], w.y0, p[1]), new THREE.Vector3(p[0], top, p[1]), 0.022, true);
  }
  for (let y = w.y0 + 0.2; y < w.y1 - 0.05; y += 0.45) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.06) continue;
      g.bar(new THREE.Vector3(a[0], y, a[1]), new THREE.Vector3(b[0], y, b[1]), 0.02, false);
    }
  }
}

/** Moldaje de muro: paneles de ≤1,2 m pegados a cada cara, con dos alineadores horizontales. */
function wallForm(g: GeoBuilder, w: WallData, [in0, in1]: [number, number], [out0, out1]: [number, number]) {
  const poly = w.poly;
  const off = outward(poly) === 0 ? 0 : -0.07;
  const y0 = w.y0 - 0.02, y1 = w.y1 + 0.1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.05) continue;
    const n = Math.max(1, Math.ceil(len / 1.2));
    for (let k = 0; k < n; k++) {
      const s0 = k / n + (n > 1 ? 0.004 : 0), s1 = (k + 1) / n - (n > 1 ? 0.004 : 0);
      const pa: V2 = [a[0] + (b[0] - a[0]) * s0, a[1] + (b[1] - a[1]) * s0];
      const pb: V2 = [a[0] + (b[0] - a[0]) * s1, a[1] + (b[1] - a[1]) * s1];
      const d = (k + i * 0.37) % 1;
      g.timing(in0 + d * 0.25, in1 + d * 0.25, out0 + d * 0.2, out1 + d * 0.2);
      g.wallPanel(pa, pb, y0, y1, 0.07, off);
    }
    if (len > 1.0) {
      // alineadores (tubos horizontales) por fuera del panel
      const off2 = off === 0 ? 0.07 : -0.14;
      g.timing(in0 + 0.3, in1 + 0.3, out0, out1);
      for (const h of [0.45, 1.85]) g.wallPanel(a, b, w.y0 + h, w.y0 + h + 0.08, 0.07, off2);
    }
  }
}

/** Malla de ventanas/vidrios/barandas/puertas del IFC con tiempos de instalación por posición. */
function detailGeometry(buf: ArrayBuffer, offset: number, count: number, t0: number, t1: number, x0: number, x1: number) {
  const pos = new Float32Array(buf, offset, count * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const aT = new Float32Array(count * 4);
  const aBox = new Float32Array(count * 2);
  for (let tri = 0; tri < count / 3; tri++) {
    let cx = 0;
    for (let k = 0; k < 3; k++) cx += pos[(tri * 3 + k) * 3];
    const s = t0 + fx(cx / 3, x0, x1) * (t1 - t0 - 0.5);
    for (let k = 0; k < 3; k++) {
      const v = tri * 3 + k;
      aT.set([s, s + 0.5, NEVER, NEVER], v * 4);
      aBox.set([0, 1], v * 2);
    }
  }
  g.setAttribute('aT', new THREE.BufferAttribute(aT, 4));
  g.setAttribute('aBox', new THREE.BufferAttribute(aBox, 2));
  g.computeBoundingSphere();
  return g;
}

export type { LevelData };
