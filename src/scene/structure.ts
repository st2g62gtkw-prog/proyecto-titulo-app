/**
 * Estructura del Edificio E construida en el tiempo: muros, losas, fierro, moldajes,
 * puntales, barandas, bandeja perimetral en ménsulas y terminaciones. Todo se genera una vez
 * desde los polígonos del IFC y se anima con materiales reveal según el cronograma.
 */
import * as THREE from 'three';
import type { BuildingData, LevelData, WallData } from '../data/building';
import type { Schedule } from '../core/schedule';
import { haWalls } from '../core/schedule';
import { GeoBuilder, offsetPolygon, pointInPolygon, polyBounds, samplePerimeter, scanlineLoops, signedArea, type V2 } from './geom';
import { BANDEJA_LIFT, bandejaSpan, buildBandeja } from './bandeja';
import { NEVER, revealMaterial, revealMesh, type RevealMaterial } from './reveal';
import { SITE } from '../config';
import { concreteTexture, formPanelTexture, plywoodTexture } from './textures';
import { FACADE_COLORS } from './facadePaint';
import { exteriorFaces } from '../core/paintPlan';

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
  rebar: '#4f3224',
  prop: '#c7352c',
  beam: '#e2b11f',
  guard: '#f0c22a',
  edge: '#9a5530',
  facade: FACADE_COLORS.paint, // mismo látex que pinta el balancín (facadePaint.ts)
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
    // fachada liviana hacia el exterior: se levanta sin pintar y la pinta el balancín (piel de facadePaint)
    finishRaw: withClip(revealMaterial({ color: FACADE_COLORS.raw, map: conc, roughness: 0.92 }, { mode: 'rise' })),
    pvc: withClip(revealMaterial({ color: C.pvc, roughness: 0.5 }, { mode: 'drop', dropHeight: 0.6 })),
    glass: withClip(revealMaterial({ color: C.glass, roughness: 0.12, metalness: 0.65 }, { mode: 'drop', dropHeight: 0.6 })),
    railing: withClip(revealMaterial({ color: C.railing, roughness: 0.5, metalness: 0.5 }, { mode: 'drop', dropHeight: 0.6 })),
    door: withClip(revealMaterial({ color: C.door, roughness: 0.6 }, { mode: 'drop', dropHeight: 0.6 })),
    excavation: withClip(revealMaterial({ color: '#7d5b3b', roughness: 1 }, { mode: 'pop' })),
    trench: withClip(revealMaterial({ color: '#4c3523', roughness: 1 }, { mode: 'pop' })),
    fill: withClip(revealMaterial({ color: '#a8977f', roughness: 1 }, { mode: 'pop' })),
    sewer: withClip(revealMaterial({ color: '#e8642a', roughness: 0.55 }, { mode: 'drop', dropHeight: 0.4 })),
    hdpe: withClip(revealMaterial({ color: '#2f6fd1', roughness: 0.5 }, { mode: 'drop', dropHeight: 0.4 })),
    // bandeja en ménsulas: ménsulas y pies derechos de acero oscuro, baranda roja, tablones y raschel
    scaffold: withClip(revealMaterial({ color: '#3b3e43', roughness: 0.55, metalness: 0.5 }, { mode: 'rise', outLift: new THREE.Vector3(0, BANDEJA_LIFT, 0) })),
    scaffoldRail: withClip(revealMaterial({ color: '#d6322b', roughness: 0.6 }, { mode: 'rise', outLift: new THREE.Vector3(0, BANDEJA_LIFT, 0) })),
    scaffoldDeck: withClip(revealMaterial({ color: '#b98e4f', roughness: 0.85 }, { mode: 'rise', outLift: new THREE.Vector3(0, BANDEJA_LIFT, 0) })),
    scaffoldMesh: withClip(revealMaterial({ color: '#2f9e5e', roughness: 0.9, transparent: true, opacity: 0.86, side: THREE.DoubleSide, depthWrite: true }, { mode: 'rise', outLift: new THREE.Vector3(0, BANDEJA_LIFT, 0) })),
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

  // --- Excavación, fundaciones e instalaciones bajo radier ------------------------------
  {
    const rad = sched.slab[0].pour;
    const fund = sched.activities.find((a) => a.kind === 'fundaciones')!;
    const inst = sched.parallel.find((a) => a.kind === 'instalaciones')!;
    const area0 = offsetPolygon(levels[0].slab.outer, -1.6);

    // excavación abierta mientras se hacen las zapatas
    const g = new GeoBuilder();
    g.timing(0, 0, fund.t1, fund.t1 + 0.2);
    g.extrude(area0, [], -0.2, -0.186, false, false);
    add(g.build(), M.excavation, 'excavacion', 0, 0, fund.t1 + 0.3, false, false);

    // zanjas de las zapatas (se rellenan al terminar las fundaciones)
    const z = new GeoBuilder();
    z.timing(0, 0, fund.t1, fund.t1 + 0.2);
    haWalls(levels[0]).forEach((w) => z.extrude(offsetPolygon(w.poly, -0.32), [], -0.2, -0.183, false, false));
    add(z.build(), M.trench, 'zanjas', 0, 0, fund.t1 + 0.3, false, false);

    // relleno compactado del 1er piso: queda a la vista hasta que se hormigona el radier
    const r = new GeoBuilder();
    r.timing(fund.t1 - 0.4, fund.t1, rad[1], rad[1] + 0.2);
    r.extrude(area0, [], -0.2, -0.187, false, false);
    add(r.build(), M.fill, 'relleno', 0, fund.t1 - 0.5, rad[1] + 0.3, false, false);

    const f = new GeoBuilder();
    f.uvScale = 1 / 2.4;
    haWalls(levels[0]).forEach((w, i) => {
      const [p0, p1] = sched.footing[i];
      f.timing(p0, p1, NEVER, NEVER, -0.75, 0.6);
      f.extrude(offsetPolygon(w.poly, -0.22), [], -0.75, -0.15);
    });
    add(f.build(), M.footing, 'zapatas', 0, sched.foundations[0], rad[1] + 2);

    // redes bajo radier: colector de alcantarillado PVC (naranjo), agua potable HDPE (azul) y cámaras
    const b0 = polyBounds(levels[0].slab.outer);
    const inside = (x: number, zz: number) => pointInPolygon(x, zz, levels[0].slab.outer);
    const pvc = new GeoBuilder(), hdpe = new GeoBuilder(), cam = new GeoBuilder(), zan = new GeoBuilder();
    const yP = -0.13;
    const tIn = (x: number) => inst.t0 + fx(x, b0.x0, b0.x1) * (inst.t1 - inst.t0) * 0.7;
    const zMain = b0.cz + 0.6;
    const out = rad[1];
    for (let x = b0.x0 + 2; x < b0.x1 - 2.5; x += 2.5) {
      const xe = Math.min(x + 2.5, b0.x1 - 2);
      if (!inside(x, zMain) || !inside(xe, zMain)) continue;
      const t0 = tIn(x);
      zan.timing(t0, t0 + 0.3, out, out + 0.2);
      zan.aabb(x, -0.2, zMain - 0.28, xe, -0.181, zMain + 0.48);
      pvc.timing(t0 + 0.3, t0 + 0.6, out, out + 0.2);
      pvc.barN(x, yP, zMain, xe, yP, zMain, 0.11);
      hdpe.timing(t0 + 0.4, t0 + 0.7, out, out + 0.2);
      hdpe.barN(x, yP + 0.01, zMain + 0.32, xe, yP + 0.01, zMain + 0.32, 0.05);
    }
    // ramales hacia los baños y cocinas, con una cámara en cada empalme
    for (let x = b0.x0 + 4; x < b0.x1 - 3; x += 6.2) {
      if (!inside(x, zMain)) continue;
      const t0 = tIn(x) + 0.5;
      for (const dir of [-1, 1]) {
        let z1 = zMain;
        while (inside(x, z1 + dir * 0.5) && Math.abs(z1 - zMain) < 5.5) z1 += dir * 0.5;
        if (Math.abs(z1 - zMain) < 1.5) continue;
        zan.timing(t0, t0 + 0.3, out, out + 0.2);
        zan.aabb(x - 0.25, -0.2, Math.min(zMain, z1), x + 0.25, -0.181, Math.max(zMain, z1));
        pvc.timing(t0 + 0.3, t0 + 0.6, out, out + 0.2);
        pvc.barN(x, yP, zMain, x, yP, z1, 0.075);
      }
      cam.timing(t0, t0 + 0.4, out, out + 0.2);
      cam.aabb(x - 0.35, -0.2, zMain - 0.35, x + 0.35, -0.06, zMain + 0.35);
    }
    add(zan.build(), M.trench, 'zanjas-radier', 0, inst.t0, out + 0.3, false, false);
    add(pvc.build(), M.sewer, 'alcantarillado', 0, inst.t0, out + 0.3, false, false);
    add(hdpe.build(), M.hdpe, 'agua-potable', 0, inst.t0, out + 0.3, false, false);
    add(cam.build(), M.footing, 'camaras', 0, inst.t0, out + 0.3, false, false);
  }

  // Bandeja de trabajo perimetral en ménsulas (piso L = 1..6, sobre la losa del piso L): se arma
  // al comenzar los muros del 2P y, cuando parte el piso siguiente, la grúa la "trepa" un piso
  // (se levanta 2,5 m y en ese instante aparece la del piso de arriba); la última se retira al
  // terminar la obra gruesa. Solo el piso en obra tiene bandeja.
  const startWalls = (lvl: number) => sched.activities.find((a) => a.kind === 'muroFierro' && a.level === lvl)!.t0;
  /** Trepada de la bandeja del piso L al siguiente (o retiro final): [out0, out1]. */
  const climb = (L: number): [number, number] => {
    const o0 = L + 1 < nWall ? startWalls(L + 1) - 0.3 : sched.slab[L + 1].pour[1] + 2.5;
    return [o0, o0 + 1.0];
  };
  /** [llegada, out0, out1] de la bandeja del piso L (llega justo cuando termina de trepar la de abajo). */
  const bandejaTime = (L: number): [number, number, number] => [L === 1 ? startWalls(1) - 0.2 : climb(L - 1)[1] - 0.02, ...climb(L)];

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

    // hormigón de losa (barrido en zig-zag como la bomba; se detiene durante el cambio de mixer)
    const concMat = revealMaterial(
      { color: C.concrete, map: M.concTex, roughness: 0.9 },
      { mode: 'sweep', concrete: true, cureTime: 22, sweep, pause: st.pumpStop, ...(paintWin ? { paint: C.facade } : {}) },
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
        const xs = scanlineLoops([sl.outer, ...sl.holes], 'z', z);
        for (let k = 0; k + 1 < xs.length; k += 2) gr.bar(new THREE.Vector3(xs[k] + 0.04, y, z), new THREE.Vector3(xs[k + 1] - 0.04, y, z), 0.018, false);
      }
      for (let x = b.x0 + 0.12; x < b.x1; x += step) {
        const zs = scanlineLoops([sl.outer, ...sl.holes], 'x', x);
        for (let k = 0; k + 1 < zs.length; k += 2) gr.bar(new THREE.Vector3(x, y + 0.018, zs[k] + 0.04), new THREE.Vector3(x, y + 0.018, zs[k + 1] - 0.04), 0.018, false);
      }
    });
    add(gr.build(), rebMat, 'fierro-losa', S, st.rebar[0], st.pour[1] + 6, false, false);

    if (S === 0) return; // el radier va sobre el terreno, sin moldaje

    const below = levels[S - 1];
    // la primera losa se apuntala sobre el relleno: el radier se hace mucho después
    const floorY = S === 1 ? SITE.groundY + 0.013 : below.slab.y1;
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
      const zs = scanlineLoops([sl.outer, ...sl.holes], 'x', x);
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
          if (!pointInPolygon(x, z, below.slab.outer) || blocked(x, z) || sl.holes.some((hl) => pointInPolygon(x, z, hl))) continue;
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
      ge.wallPanel(a, c, sl.y0 - 0.06, sl.y1 + 0.06, 0.035, voidSide(outer, false, 0.035));
    }
    for (const hl of sl.holes) {
      const k = fx(polyBounds(hl).cx, b.x0, b.x1);
      const tE = st.deck[0] + k * (st.deck[1] - st.deck[0] - 0.4);
      const tR = st.pour[1] + 2.5 + k * 2.5;
      ge.timing(tE, tE + 0.4, tR, tR + 0.4);
      for (let i = 0; i < hl.length; i++) ge.wallPanel(hl[i], hl[(i + 1) % hl.length], sl.y0 - 0.06, sl.y1 + 0.06, 0.035, voidSide(hl, true, 0.035));
    }
    const rail = offsetPolygon(outer, 0.12);
    // mientras la bandeja en ménsulas está en esta losa, su baranda reemplaza a la de borde
    // (se saca antes de que llegue la bandeja que trepa desde abajo y vuelve cuando esta se va)
    let windows: [number, number][] = [[guardIn, guardOut]];
    if (S < nWall) {
      const arrive = S === 1 ? bandejaTime(S)[0] : climb(S - 1)[0];
      windows = [[guardIn, arrive - 0.7], [bandejaTime(S)[2] + 0.2, guardOut]];
    }
    for (const [w0, w1] of windows.filter(([a, b]) => b > a + 0.5)) {
      gg.timing(w0, w0 + 0.5, w1, w1 + 0.6);
      for (const { p } of samplePerimeter(rail, 1.9)) gg.aabb(p[0] - 0.035, sl.y1, p[1] - 0.035, p[0] + 0.035, sl.y1 + 1.1, p[1] + 0.035);
      for (let i = 0; i < rail.length; i++) {
        const a = rail[i], c = rail[(i + 1) % rail.length];
        for (const h of [0.5, 1.02]) gg.bar(new THREE.Vector3(a[0], sl.y1 + h, a[1]), new THREE.Vector3(c[0], sl.y1 + h, c[1]), 0.05);
        gg.bar(new THREE.Vector3(a[0], sl.y1 + 0.08, a[1]), new THREE.Vector3(c[0], sl.y1 + 0.08, c[1]), 0.15, false);
      }
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
      const door = L === 0 ? doorCut(w) : null;
      if (door) {
        // muro con el vano de la puerta posterior del hall (por donde entra la tubería de la bomba):
        // a cada lado del vano el muro va completo y sobre el vano queda el dintel
        for (const piece of [clipX(w.poly, -Infinity, door.x0), clipX(w.poly, door.x1, Infinity)]) if (piece.length >= 3) conc.extrude(piece, [], w.y0, w.y1);
        const lintel = clipX(w.poly, door.x0, door.x1);
        if (lintel.length >= 3) conc.extrude(lintel, [], door.h, w.y1);
      } else conc.extrude(w.poly, wallHoles(w), w.y0, w.y1);
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
    const fr = new GeoBuilder();
    fr.uvScale = 1 / 2.4;
    const light = lv.walls.filter((w) => !w.ha);
    const above = levels[L + 1].slab.outer;
    const [f0, f1] = fin;
    light.forEach((w) => {
      const c = polyBounds(w.poly);
      const k = fx(c.cx, X0, X1);
      const s = f0 + k * (f1 - f0) * 0.45;
      const g = w.cat === 'fachada' && exteriorFaces(w.poly, above).length ? fr : fw;
      g.timing(s, s + (f1 - f0) * 0.25, NEVER, NEVER, w.y0, w.y1 - w.y0);
      g.extrude(w.poly, wallHoles(w), w.y0, w.y1);
    });
    add(fw.build(), M.finishWall, 'tabiques', L, f0, NEVER, true);
    add(fr.build(), M.finishRaw, 'tabiques', L, f0, NEVER, true);
    const mats = { window: M.pvc, plate: M.glass, railing: M.railing, door: M.door } as const;
    for (const grp of data.detail.groups.filter((g) => g.level === lv.name)) {
      const geo = detailGeometry(detail, grp.offset, grp.count, f0 + (f1 - f0) * 0.4, f1, X0, X1);
      add(geo, mats[grp.kind], grp.kind, L, f0, NEVER, false, grp.kind !== 'plate');
    }
  }

  // --- Bandeja de trabajo perimetral en ménsulas ------------------------------------------
  // (los tiempos están en bandejaTime, más arriba)
  for (let L = 1; L < nWall; L++) {
    const y = levels[L].slab.y1;
    const [by, bh] = bandejaSpan(y);
    // la caja de aparición incluye el tramo que sube al trepar, para que no se recorte arriba
    const box = bh + BANDEJA_LIFT + 0.1;
    const [in0, out0, out1] = bandejaTime(L);
    // la del 2P se arma de abajo hacia arriba (~2,4 s); las demás aparecen cuando llega la que trepa
    const in1 = in0 + (L === 1 ? 2.4 * (box / bh) : 0.04);
    const parts = { frame: new GeoBuilder(), rails: new GeoBuilder(), deck: new GeoBuilder(), mesh: new GeoBuilder() };
    for (const gb of Object.values(parts)) gb.timing(in0, in1, out0, out1, by, box);
    // en la losa del 2P no va ménsula frente a la puerta posterior por donde entra la tubería
    const door = SITE.pipeline.door;
    const avoid = L === 1 ? (p: V2) => p[1] < -4 && p[0] > door.x0 - 0.2 && p[0] < door.x1 + 0.2 : undefined;
    buildBandeja(parts, levels[L].slab.outer, haWalls(levels[L - 1]).map((w) => w.poly), y, avoid);
    add(parts.frame.build(), M.scaffold, 'andamio', L, in0, out1 + 0.1);
    add(parts.rails.build(), M.scaffoldRail, 'andamio-barandas', L, in0, out1 + 0.1, false, false);
    add(parts.deck.build(), M.scaffoldDeck, 'andamio-plataformas', L, in0, out1 + 0.1);
    add(parts.mesh.build(), M.scaffoldMesh, 'andamio-malla', L, in0, out1 + 0.1, false, false);
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

/**
 * Desplazamiento para que una pieza de espesor `t` construida con wallPanel quede del lado
 * vacío del contorno (afuera del hormigón). wallPanel avanza hacia la normal derecha (dz, -dx),
 * que en un contorno antihorario apunta hacia afuera de él. En un vano el hormigón está afuera
 * del contorno, así que el lado vacío es el contrario.
 */
function voidSide(loop: V2[], hole: boolean, t: number) {
  const rightIsOutside = signedArea(loop) > 0;
  return (hole ? !rightIsOutside : rightIsOutside) ? 0 : -t;
}

/** Contornos de un muro: el exterior y sus vanos grandes (shafts), sin las astillas del dibujo. */
function wallLoops(w: WallData, minHole = 0.3) {
  return [
    { loop: w.poly, hole: false },
    ...w.holes.filter((h) => Math.abs(signedArea(h)) >= minHole).map((loop) => ({ loop, hole: true })),
  ];
}

/**
 * Recorte de un contorno a la franja x0 ≤ x ≤ x1 (Sutherland–Hodgman contra los dos semiplanos).
 * Basta para muros cuyo recorte queda en una sola pieza, como el de la puerta posterior del hall.
 */
function clipX(poly: V2[], x0: number, x1: number): V2[] {
  const half = (pts: V2[], inside: (p: V2) => boolean, xc: number): V2[] => {
    const out: V2[] = [];
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      const ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push([xc, a[1] + ((xc - a[0]) / (b[0] - a[0])) * (b[1] - a[1])]);
    });
    return out;
  };
  let r = poly;
  if (Number.isFinite(x0)) r = half(r, (p) => p[0] >= x0, x0);
  if (Number.isFinite(x1) && r.length) r = half(r, (p) => p[0] <= x1, x1);
  return r;
}

/**
 * Vano de la puerta posterior del hall en el 1P (SITE.pipeline.door): los muros del IFC vienen sin
 * descontar sus vanos, así que se recorta solo este, porque por ahí entra la tubería de la bomba.
 * Devuelve el vano si el muro de fachada lo contiene (muro sin otros vanos que cruza x0…x1 en zDoor).
 */
function doorCut(w: WallData) {
  const P = SITE.pipeline, D = P.door;
  if (w.holes.length || !w.ha) return null;
  const crosses = w.poly.some((a, i) => {
    const b = w.poly[(i + 1) % w.poly.length];
    return (a[0] - P.xDoor) * (b[0] - P.xDoor) < 0 && Math.abs(a[1] + ((P.xDoor - a[0]) / (b[0] - a[0])) * (b[1] - a[1]) - P.zDoor) < 1;
  });
  return crosses ? { x0: D.x0, x1: D.x1, h: D.h } : null;
}

/** Vanos que se descuentan del hormigón (se ignoran los de área despreciable). */
function wallHoles(w: WallData) {
  return w.holes.filter((h) => Math.abs(signedArea(h)) >= 0.02);
}

/** Fierro de muro: barras verticales (con arranques sobre la losa) y horizontales a ambas caras. */
function wallRebar(g: GeoBuilder, w: WallData, [t0, t1]: [number, number], starters: boolean) {
  const top = starters ? w.y1 + 0.55 : w.y1 - 0.03;
  g.timing(t0, t1, NEVER, NEVER, w.y0, top - w.y0);
  const cover = Math.min(0.05, w.t * 0.3);
  for (const { loop: l, hole } of wallLoops(w)) {
    const loop = offsetPolygon(l, hole ? -cover : cover);
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
}

/** Moldaje de muro: paneles de ≤1,2 m pegados a cada cara (también dentro de los shafts), con alineadores. */
function wallForm(g: GeoBuilder, w: WallData, [in0, in1]: [number, number], [out0, out1]: [number, number]) {
  const y0 = w.y0 - 0.02, y1 = w.y1 + 0.1;
  for (const { loop: poly, hole } of wallLoops(w)) {
    const off = voidSide(poly, hole, 0.07);
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
