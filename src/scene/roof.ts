/**
 * Obras sobre la losa de techumbre (core/roofPlan, config TECHO), construidas en el tiempo:
 *  - Obra gruesa: parapetos y muros de la caja de escala y sala de máquinas (fierro, moldaje,
 *    hormigón con capacho y desmolde, como los muros de piso) y la losa de cielo de la caja.
 *  - Techumbre (en paralelo con las terminaciones), avanzando a lo largo del edificio: cerchas y
 *    costaneras de pino impregnado y tapa OSB; aislación (Aislán); cubierta de zincalum
 *    emballetado con sus nervios, forros de parapeto, cumbrera, canales y ventilaciones; y las
 *    aguas lluvia (cubetas en las esquinas y bajadas de la caja).
 * Las mallas usan materiales reveal (ver reveal.ts) con vértices en coordenadas de mundo.
 */
import * as THREE from 'three';
import type { WallData } from '../data/building';
import type { RoofCell } from '../core/roofPlan';
import type { Schedule } from '../core/schedule';
import { TECHO } from '../config';
import { GeoBuilder, offsetPolygon, pointInPolygon, polyBounds, scanline, type V2 } from './geom';
import { NEVER, revealMaterial, type RevealMaterial, type RevealOptions } from './reveal';

/** Lo que structure.ts presta para armar la techumbre con sus mismos materiales y piezas. */
export interface RoofKit {
  add(geo: THREE.BufferGeometry, mat: RevealMaterial, kind: string, level: number, from: number, to: number, pick?: boolean, shadows?: boolean): THREE.Mesh | undefined;
  mats: { concrete: RevealMaterial; rebar: RevealMaterial; form: RevealMaterial; props: RevealMaterial; beams: RevealMaterial };
  clipping: THREE.Plane[];
  wallRebar(g: GeoBuilder, w: WallData, win: [number, number], starters: boolean): void;
  wallForm(g: GeoBuilder, w: WallData, inWin: [number, number], outWin: [number, number]): void;
  pickables: THREE.Mesh[];
}

const COL = {
  pine: '#b3a46a',
  osb: '#c9a362',
  foil: '#d3d8dd',
  zinc: '#8d979f',
  trim: '#a3acb3',
  galv: '#b9bfc5',
  pvc: '#dedbd3',
  shaft: '#d9d4c7',
  door: '#56606b',
  grate: '#3b3f44',
};

export function buildRoof(sched: Schedule, kit: RoofKit) {
  const R = sched.roof;
  const G = R.geo;
  const RL = sched.levelNames.length - 1;
  const y = G.y;
  const K = TECHO.cubierta;
  const withClip = (m: RevealMaterial) => {
    m.clippingPlanes = kit.clipping;
    m.userData.depth.setValues({ clippingPlanes: kit.clipping });
    return m;
  };
  const mat = (p: THREE.MeshStandardMaterialParameters, o: RevealOptions) => withClip(revealMaterial(p, o));
  const M = {
    pine: mat({ color: COL.pine, roughness: 0.85 }, { mode: 'drop', dropHeight: 0.35 }),
    osb: mat({ color: COL.osb, roughness: 0.9 }, { mode: 'drop', dropHeight: 0.2 }),
    foil: mat({ color: COL.foil, roughness: 0.35, metalness: 0.6 }, { mode: 'drop', dropHeight: 0.12 }),
    zinc: mat({ color: COL.zinc, roughness: 0.45, metalness: 0.55 }, { mode: 'drop', dropHeight: 0.25 }),
    trim: mat({ color: COL.trim, roughness: 0.4, metalness: 0.6 }, { mode: 'drop', dropHeight: 0.25 }),
    galv: mat({ color: COL.galv, roughness: 0.4, metalness: 0.65 }, { mode: 'drop', dropHeight: 0.3 }),
    pvc: mat({ color: COL.pvc, roughness: 0.5 }, { mode: 'drop', dropHeight: 0.3 }),
    shaft: mat({ color: COL.shaft, roughness: 0.9 }, { mode: 'rise' }),
    door: mat({ color: COL.door, roughness: 0.5, metalness: 0.4 }, { mode: 'drop', dropHeight: 0.4 }),
    // placas fenólicas bajo la losa de la caja: al descimbrar bajan y se retiran por la puerta
    deck: mat({ color: '#c8963e', roughness: 0.7 }, { mode: 'drop', dropHeight: 0.4, outLift: new THREE.Vector3(0, -0.4, 0) }),
    grate: mat({ color: COL.grate, roughness: 0.6, metalness: 0.3 }, { mode: 'pop' }),
  };
  const meshes: THREE.Mesh[] = [];
  /** Agrega una capa pickeable como "techumbre" (ficha propia en main.ts). */
  const put = (g: GeoBuilder, m: RevealMaterial, kind: string, from: number, shadows = true) => {
    const mesh = kit.add(g.build(), m, kind, RL, from, NEVER, false, shadows);
    if (mesh) {
      mesh.userData.pick = { type: 'techumbre', id: kind };
      kit.pickables.push(mesh);
      meshes.push(mesh);
    }
    return mesh;
  };

  // --- Obra gruesa: parapetos y muros de la caja ---------------------------------------------
  {
    const conc = new GeoBuilder();
    conc.uvScale = 1 / 2.4;
    const reb = new GeoBuilder();
    const form = new GeoBuilder();
    form.uvScale = 1;
    const nPar = G.parapets.length;
    R.walls.forEach((w, i) => {
      const tm = R.wall[i];
      // la caja se pinta del color de la fachada junto con la cubierta (los parapetos los pinta el balancín)
      const paint: [number, number] = i >= nPar ? R.cubierta : [NEVER, NEVER];
      conc.timing(tm.pour[0], tm.pour[1], paint[0], paint[1], w.y0, w.y1 - w.y0);
      conc.extrude(w.poly, [], w.y0, w.y1);
      kit.wallRebar(reb, w, tm.rebar, false);
      kit.wallForm(form, w, tm.form, tm.strip);
    });
    const first = (k: 'rebar' | 'form' | 'pour') => Math.min(...R.wall.map((t) => t[k][0]));
    kit.add(conc.build(), kit.mats.concrete, 'techo-muros', RL, first('pour'), NEVER, true);
    kit.add(reb.build(), kit.mats.rebar, 'techo-fierro', RL, first('rebar'), R.slab.pour[1] + 1, false, false);
    kit.add(form.build(), kit.mats.form, 'techo-moldaje', RL, first('form'), Math.max(...R.wall.map((t) => t.strip[1])) + 0.2);
  }

  // --- Losa de cielo de la caja: puntales, vigas, placas, fierro y hormigón ------------------
  {
    const S = R.slab;
    // sin puntales sobre el shaft del ascensor ni sobre la llegada de la escalera (zona C, hacia +x)
    const ob0 = polyBounds(G.box.outline);
    const [cx0, cz0] = TECHO.caja.contorno[0];
    const shX = ob0.x0 - cx0, shZ = ob0.z0 - cz0; // esquina interior del shaft (x0, z0)
    const shaftX1 = shX + 2.03 + 0.12;
    const overVoid = (x: number, z: number) => z > shZ && (x < shaftX1 || x > shaftX1 + 1.9);
    const [sy0, sy1] = [TECHO.caja.muroTop, TECHO.caja.losaTop];
    const inner = G.box.inner;
    const ib = polyBounds(inner);
    const gp = new GeoBuilder(), gb = new GeoBuilder(), gd = new GeoBuilder(), gr = new GeoBuilder(), gc = new GeoBuilder();
    gc.uvScale = 1 / 2.4;
    const propTop = sy0 - 0.025 - 0.2;
    const fx = (x: number) => (x - ib.x0) / Math.max(ib.x1 - ib.x0, 1e-3);
    for (let x = ib.x0 + 0.5; x < ib.x1 - 0.3; x += 1.1) {
      const tIn = S.props[0] + fx(x) * (S.props[1] - S.props[0] - 0.3);
      const tOut = S.out[0] + fx(x) * (S.out[1] - S.out[0] - 0.2);
      for (let z = ib.z0 + 0.45; z < ib.z1 - 0.3; z += 1.1) {
        if (!pointInPolygon(x, z, inner) || overVoid(x, z)) continue;
        gp.timing(tIn, tIn + 0.3, tOut, tOut + 0.3);
        gp.cylinder(x, z, y, propTop, 0.032, 6);
        gp.aabb(x - 0.07, y, z - 0.07, x + 0.07, y + 0.012, z + 0.07);
      }
      gb.timing(Math.min(tIn + 0.2, S.deck[1] - 0.3), Math.min(tIn + 0.5, S.deck[1]), tOut, tOut + 0.3);
      const zs = scanline(inner, 'x', x);
      for (let k = 0; k + 1 < zs.length; k += 2) gb.aabb(x - 0.04, propTop, zs[k] + 0.1, x + 0.04, propTop + 0.2, zs[k + 1] - 0.1);
    }
    gd.timing(S.deck[0], S.deck[1], S.out[0], S.out[1]);
    gd.extrude(inner, [], sy0 - 0.025, sy0 - 0.003, false, true);
    gr.timing(S.rebar[0], S.rebar[1], NEVER, NEVER, sy0, sy1 - sy0);
    const ob = polyBounds(G.box.outline);
    for (const yy of [sy0 + 0.035, sy1 - 0.035]) {
      for (let z = ob.z0 + 0.1; z < ob.z1; z += 0.3) {
        const xs = scanline(G.box.outline, 'z', z);
        for (let k = 0; k + 1 < xs.length; k += 2) gr.barN(xs[k] + 0.04, yy, z, xs[k + 1] - 0.04, yy, z, 0.016, false);
      }
      for (let x = ob.x0 + 0.1; x < ob.x1; x += 0.3) {
        const zs = scanline(G.box.outline, 'x', x);
        for (let k = 0; k + 1 < zs.length; k += 2) gr.barN(x, yy + 0.016, zs[k] + 0.04, x, yy + 0.016, zs[k + 1] - 0.04, 0.016, false);
      }
    }
    // la losa se hormigona de abajo hacia arriba con el capacho (y se pinta con la caja)
    gc.timing(S.pour[0], S.pour[1], R.cubierta[0], R.cubierta[1], sy0, sy1 - sy0);
    gc.extrude(G.box.outline, [], sy0, sy1);
    kit.add(gp.build(), kit.mats.props, 'puntales', RL, S.props[0], S.out[1] + 0.3);
    kit.add(gb.build(), kit.mats.beams, 'vigas', RL, S.props[0], S.out[1] + 0.3);
    kit.add(gd.build(), M.deck, 'placas', RL, S.deck[0], S.out[1] + 0.3);
    kit.add(gr.build(), kit.mats.rebar, 'fierro-losa', RL, S.rebar[0], S.pour[1] + 4, false, false);
    kit.add(gc.build(), kit.mats.concrete, 'losa-caja', RL, S.pour[0], NEVER, true);
  }

  // --- Techumbre: estructura, aislación y cubierta por celdas ----------------------------------
  const H = (z: number) => y + G.rise(z);
  const W = (w: [number, number]) => w[1] - w[0];
  const tStruct = (x: number) => R.layerAt('estructura', x) - 0.06 * W(R.estructura);
  const tPurlin = (x: number) => R.layerAt('estructura', x) - 0.035 * W(R.estructura);
  const tOsb = (x: number) => R.layerAt('estructura', x);
  const tFoil = (x: number) => R.layerAt('aislacion', x);
  const tZinc = (x: number) => R.layerAt('cubierta', x);
  // las celdas junto a un canal se acortan para dejarle su franja (0,30 m; la limahoya, 0,15 a cada lado)
  const band = (z: number) => (Math.abs(z - G.valleyZ) < 0.01 ? 0.15 : 0.3);
  const onGutter = (z: number, x0: number, x1: number) => G.gutters.some((g) => Math.abs(g.a[1] - z) < 0.01 && Math.min(x1, g.b[0]) - Math.max(x0, g.a[0]) > 0.05);
  const trim = (c: RoofCell): [number, number] => [
    c.z0 + (onGutter(c.z0, c.x0, c.x1) ? band(c.z0) : 0),
    c.z1 - (onGutter(c.z1, c.x0, c.x1) ? band(c.z1) : 0),
  ];
  /** Trozos de cada celda de hasta 2,44 m a lo largo de x (largo de un tablero OSB). */
  const tiles: { x0: number; x1: number; z0: number; z1: number }[] = [];
  for (const c of G.cells) {
    const [z0, z1] = trim(c);
    if (z1 - z0 < 0.05) continue;
    const n = Math.max(1, Math.ceil((c.x1 - c.x0) / 2.44));
    for (let k = 0; k < n; k++) tiles.push({ x0: c.x0 + ((c.x1 - c.x0) * k) / n, x1: c.x0 + ((c.x1 - c.x0) * (k + 1)) / n, z0, z1 });
  }
  /** Placa inclinada sobre el faldón: de z0 a z1 en el tramo x0..x1, con su cara superior a `top(z)`. */
  const plate = (g: GeoBuilder, x0: number, x1: number, z0: number, z1: number, top: (z: number) => number, th: number) => {
    const ya = top(z0) - th, yb = top(z1) - th;
    const len = Math.hypot(z1 - z0, yb - ya);
    const wy = (yb - ya) / len, wz = (z1 - z0) / len;
    // u = +x, w = a lo largo de la pendiente, v = normal (w × u)
    g.boxN(x0, ya, z0, 1, 0, 0, 0, wz, -wy, 0, wy, wz, x1 - x0, th, len);
  };
  {
    const cer = new GeoBuilder(), cos = new GeoBuilder(), osb = new GeoBuilder(), foil = new GeoBuilder(), zinc = new GeoBuilder(), rib = new GeoBuilder();
    osb.uvScale = 1 / 1.22;
    for (const t of tiles) {
      const xm = (t.x0 + t.x1) / 2;
      // cerchas cada 1,0 m (de la losa a la cara inferior de las costaneras), en trozos de 1 m
      for (let x = Math.ceil(t.x0 / K.cerchas) * K.cerchas; x < t.x1 - 0.02; x += K.cerchas) {
        const tc = tStruct(x);
        for (let z = t.z0; z < t.z1 - 0.02; z += 1) {
          const ze = Math.min(z + 1, t.z1);
          cer.timing(tc, tc + 0.25);
          cer.aabb(x - 0.022, y, z, x + 0.022, H((z + ze) / 2) - 0.061, ze);
        }
      }
      // costaneras cada 0,6 m a lo largo de x
      const tp = tPurlin(xm);
      for (let z = t.z0 + 0.1; z < t.z1 - 0.05; z += K.costaneras) {
        cos.timing(tp, tp + 0.25);
        cos.aabb(t.x0, H(z) - 0.061, z - 0.02, t.x1, H(z) - 0.021, z + 0.02);
      }
      osb.timing(tOsb(xm), tOsb(xm) + 0.3);
      plate(osb, t.x0, t.x1, t.z0, t.z1, (z) => H(z) - 0.006, 0.015);
      foil.timing(tFoil(xm), tFoil(xm) + 0.3);
      plate(foil, t.x0, t.x1, t.z0, t.z1, (z) => H(z) - 0.002, 0.003);
      zinc.timing(tZinc(xm), tZinc(xm) + 0.3);
      plate(zinc, t.x0, t.x1, t.z0, t.z1, H, 0.004);
      // emballetado: nervios a lo largo de la pendiente cada 0,5 m
      for (let x = Math.ceil(t.x0 / K.plancha) * K.plancha; x < t.x1 - 0.01; x += K.plancha) {
        rib.timing(tZinc(x), tZinc(x) + 0.3);
        plate(rib, x - 0.0125, x + 0.0125, t.z0, t.z1, (z) => H(z) + 0.035, 0.035);
      }
    }
    put(cer, M.pine, 'cerchas', R.estructura[0]);
    put(cos, M.pine, 'costaneras', R.estructura[0]);
    put(osb, M.osb, 'osb', R.estructura[0]);
    put(foil, M.foil, 'aislacion', R.aislacion[0], false);
    put(zinc, M.zinc, 'cubierta', R.cubierta[0]);
    put(rib, M.zinc, 'cubierta-nervios', R.cubierta[0], false);
  }

  // --- Hojalatería: forros de parapeto, cumbrera y canales ------------------------------------
  {
    const g = new GeoBuilder();
    const top = y + TECHO.parapeto.alto;
    for (const w of G.parapets) {
      const b = polyBounds(w.poly);
      const tt = tZinc((b.x0 + b.x1) / 2);
      g.timing(tt, tt + 0.3);
      g.extrude(offsetPolygon(w.poly, -0.03), [], top, top + 0.02);
    }
    // cumbrera: tapa de 0,30 m sobre la línea de cumbrera, fuera de la caja
    for (const c of G.cells) {
      if (Math.abs(c.z1 - G.ridgeZ) > 0.01) continue;
      const tt = tZinc((c.x0 + c.x1) / 2);
      g.timing(tt, tt + 0.3);
      g.aabb(c.x0, H(G.ridgeZ) + 0.02, G.ridgeZ - 0.15, c.x1, H(G.ridgeZ) + 0.05, G.ridgeZ + 0.15);
    }
    // canales en U (0,30 m; la limahoya se reparte a ambos lados de su línea)
    for (const gu of G.gutters) {
      const z = gu.a[1];
      const valley = Math.abs(z - G.valleyZ) < 0.01;
      const back = z < G.ridgeZ;
      const za = valley ? z - 0.15 : back ? z : z - 0.3, zb = za + 0.3;
      const tt = tZinc((gu.a[0] + gu.b[0]) / 2);
      g.timing(tt, tt + 0.3);
      const yb = y + 0.03, yt = y + K.base - 0.01;
      g.aabb(gu.a[0], yb, za, gu.b[0], yb + 0.008, zb);
      g.aabb(gu.a[0], yb, za, gu.b[0], yt, za + 0.008);
      g.aabb(gu.a[0], yb, zb - 0.008, gu.b[0], yt, zb);
    }
    put(g, M.trim, 'hojalateria', R.cubierta[0]);
  }

  // --- Ventilaciones de los shafts y chimeneas (tabique T6 "shaft techo") ----------------------
  {
    const sh = new GeoBuilder(), cap = new GeoBuilder(), pipe = new GeoBuilder();
    for (const v of G.vents) {
      const yb = H(v.z);
      const tt = tZinc(v.x) + 0.1;
      if (v.kind === 'chimenea') {
        // shaft que sube 1,45 m sobre la losa, revestido, con su sombrerete
        const hw = v.w / 2 + 0.1, hd = v.d / 2 + 0.1;
        const ts = tStruct(v.x);
        sh.timing(ts, ts + 0.6, NEVER, NEVER, y, 1.45);
        sh.aabb(v.x - hw, y, v.z - hd, v.x + hw, y + 1.45, v.z + hd);
        cap.timing(tt, tt + 0.3);
        cap.aabb(v.x - hw - 0.08, y + 1.6, v.z - hd - 0.08, v.x + hw + 0.08, y + 1.63, v.z + hd + 0.08);
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) cap.aabb(v.x + sx * hw - 0.02, y + 1.45, v.z + sz * hd - 0.02, v.x + sx * hw + 0.02, y + 1.6, v.z + sz * hd + 0.02);
      } else if (v.kind === 'ducto') {
        // ducto galvanizado de 0,45 m sobre la cubierta con sombrerete separado 0,12 m
        const hw = v.w / 2 + 0.05, hd = v.d / 2 + 0.05;
        cap.timing(tt, tt + 0.3);
        cap.aabb(v.x - hw, yb - 0.02, v.z - hd, v.x + hw, yb + 0.45, v.z + hd);
        cap.aabb(v.x - hw - 0.12, yb + 0.57, v.z - hd - 0.12, v.x + hw + 0.12, yb + 0.6, v.z + hd + 0.12);
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) cap.aabb(v.x + sx * hw - 0.015, yb + 0.45, v.z + sz * hd - 0.015, v.x + sx * hw + 0.015, yb + 0.57, v.z + sz * hd + 0.015);
      } else {
        // ventilación Ø110 de PVC con su gorro
        pipe.timing(tt, tt + 0.3);
        pipe.cylinder(v.x, v.z, yb - 0.02, yb + 0.4, 0.055, 10);
        cap.timing(tt, tt + 0.3);
        cap.cylinder(v.x, v.z, yb + 0.42, yb + 0.47, 0.11, 10);
      }
    }
    put(sh, M.shaft, 'shafts', R.estructura[0]);
    put(cap, M.galv, 'ventilaciones', R.cubierta[0]);
    put(pipe, M.pvc, 'ventilaciones-pvc', R.cubierta[0], false);
  }

  // --- Cubierta de la caja (dos aguas sobre su losa) -------------------------------------------
  {
    const ob = polyBounds(G.box.outline);
    const zr = (ob.z0 + ob.z1) / 2;
    const top = (z: number) => TECHO.caja.losaTop + 0.08 + K.pendiente * (z < zr ? z - ob.z0 : ob.z1 - z);
    const tt = tZinc(G.box.cx) - 0.08 * W(R.cubierta);
    const g = new GeoBuilder(), rib = new GeoBuilder(), trim = new GeoBuilder();
    // celdas del contorno de la caja (ortogonal) partidas en la cumbrera
    const xs = [...new Set(G.box.outline.map((p) => p[0]))].sort((a, b) => a - b);
    const zs = [...new Set([...G.box.outline.map((p) => p[1]), zr])].sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i++) {
      for (let j = 0; j + 1 < zs.length; j++) {
        if (!pointInPolygon((xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2, G.box.outline)) continue;
        g.timing(tt, tt + 0.4);
        plate(g, xs[i], xs[i + 1], zs[j], zs[j + 1], top, 0.08);
        for (let x = Math.ceil(xs[i] / K.plancha) * K.plancha; x < xs[i + 1] - 0.01; x += K.plancha) {
          rib.timing(tt, tt + 0.4);
          plate(rib, x - 0.0125, x + 0.0125, zs[j], zs[j + 1], (z) => top(z) + 0.035, 0.035);
        }
      }
    }
    // forro del borde de la losa de la caja
    trim.timing(tt, tt + 0.4);
    const edge = offsetPolygon(G.box.outline, -0.04);
    trim.extrude(edge, [offsetPolygon(G.box.outline, 0.1)], TECHO.caja.losaTop - 0.06, TECHO.caja.losaTop + 0.1);
    put(g, M.zinc, 'cubierta-caja', tt);
    put(rib, M.zinc, 'cubierta-caja-nervios', tt, false);
    put(trim, M.trim, 'forro-caja', tt);
  }

  // --- Puertas de la caja y pasada de despresurización (con la cubierta terminada) ---------------
  {
    const g = new GeoBuilder(), gr = new GeoBuilder();
    const tt = R.cubierta[1] - 0.2;
    const ob = polyBounds(G.box.outline);
    for (const o of G.box.openings) {
      const along = Math.abs(o.b[0] - o.a[0]) > Math.abs(o.b[1] - o.a[1]);
      // la hoja va al medio del espesor del muro (0,20)
      const inward: V2 = along ? [0, o.a[1] > (ob.z0 + ob.z1) / 2 ? -0.1 : 0.1] : [o.a[0] > (ob.x0 + ob.x1) / 2 ? -0.1 : 0.1, 0];
      const x0 = Math.min(o.a[0], o.b[0]) + inward[0], x1 = Math.max(o.a[0], o.b[0]) + inward[0];
      const z0 = Math.min(o.a[1], o.b[1]) + inward[1], z1 = Math.max(o.a[1], o.b[1]) + inward[1];
      const tg = o.kind === 'pasada' ? gr : g;
      tg.timing(tt, tt + 0.3);
      const th = 0.025;
      if (along) tg.aabb(x0, o.y0, z0 - th, x1, o.y1, z1 + th);
      else tg.aabb(x0 - th, o.y0, z0, x1 + th, o.y1, z1);
      if (o.kind === 'pasada') continue;
      // manilla
      const hx = along ? x0 + 0.12 : x0, hz = along ? z0 : z0 + 0.12;
      tg.aabb(hx - 0.03 + (along ? 0 : -0.05), o.y0 + 1.0, hz - 0.03 + (along ? -0.05 : 0), hx + 0.03 + (along ? 0 : 0.05), o.y0 + 1.04, hz + 0.03 + (along ? 0.05 : 0));
    }
    put(g, M.door, 'puertas-caja', tt);
    put(gr, M.grate, 'pasada', tt, false);
  }

  // --- Aguas lluvia: cubetas en las esquinas y bajadas Ø110 de la caja ---------------------------
  {
    const g = new GeoBuilder(), grate = new GeoBuilder();
    const [a0, a1] = R.aguas;
    const n = G.outlets.length + G.boxDrains.length;
    let k = 0;
    const tk = () => a0 + ((k++ + 0.3) / Math.max(n, 1)) * (a1 - a0 - 0.3);
    for (const [x, z] of G.outlets) {
      const tt = tk();
      // cubeta en el canal y bajada Ø160 que entra a su shaft bajo la losa
      g.timing(tt, tt + 0.3);
      g.aabb(x - 0.18, y + 0.01, z - 0.18, x + 0.18, y + 0.035, z + 0.18);
      g.cylinder(x, z, y - 0.3, y + 0.03, 0.08, 10);
      grate.timing(tt, tt + 0.3);
      grate.cylinder(x, z, y + 0.035, y + 0.11, 0.07, 8);
    }
    for (const [x, z] of G.boxDrains) {
      const tt = tk();
      const yTop = TECHO.caja.losaTop + 0.02, yBot = H(z) + 0.12;
      g.timing(tt, tt + 0.3);
      // gárgola desde el borde de la cubierta de la caja, bajada adosada al muro y codo sobre la techumbre
      g.aabb(x - 0.06, yTop - 0.05, z - 0.06, x + 0.06, yTop + 0.06, z + 0.06);
      g.cylinder(x, z, yBot, yTop, 0.055, 10);
      grate.timing(tt, tt + 0.3);
      grate.aabb(x - 0.2, H(z) + 0.01, z - 0.2, x + 0.2, H(z) + 0.03, z + 0.2);
    }
    put(g, M.pvc, 'aguas-lluvia', a0);
    put(grate, M.grate, 'aguas-lluvia-cubetas', a0, false);
  }

  return { meshes };
}
