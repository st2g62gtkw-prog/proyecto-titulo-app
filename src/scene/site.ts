/**
 * Faena de obra alrededor del Edificio E (Condominio Espacio Las Tablas, Curauma):
 * terreno con talud de corte, caminos de ripio, cierros y portón, instalación de faena,
 * acopios al alcance de la grúa, taller de fierro y el barrio alrededor.
 *
 * Todo lo estático se fusiona por material (≈ 50 mallas en total). Cada acopio y la faena
 * son grupos propios con userData.pick para poder seleccionarlos con un clic.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SITE } from '../config';
import { BUILDING_FACTS, PROJECT } from '../data/project';
import { formPanelTexture, plywoodTexture } from './textures';

type AnchorKey = 'acopioMoldajeMuro' | 'acopioMoldajeLosa' | 'acopioFierro' | 'acopioPuntales';

export interface SiteRig {
  group: THREE.Group;
  /** Grupos seleccionables: acopios ({type:'acopio', id}) y faena ({type:'faena'}). */
  pickables: THREE.Object3D[];
  /** Punto (mundo) sobre cada acopio donde el gancho de la grúa toma la carga. */
  anchors: Record<AnchorKey, THREE.Vector3>;
  /** Movimiento sutil: bandera y balizas del portón. */
  update(t: number, dt: number): void;
  /** Cota del terreno en (x, z), para apoyar objetos sobre el talud o el entorno. */
  heightAt?(x: number, z: number): number;
}

type V2 = [number, number];

const G = SITE.groundY;
/** Cierro perimetral; el borde z0 va sobre el coronamiento del talud. */
const FENCE = { x0: SITE.gate.x, x1: 72, z0: SITE.talud.zTop - 1, z1: 46 };
const GATE = { z0: SITE.gate.z - 4.3, z1: SITE.gate.z + 4.3 };
/** Calle exterior del portón (eje x = cte). */
const ST_W = SITE.gate.x - 8;
/** Barrio: calles a lo largo de x (z = cte) y de z (x = cte), y su extensión plana. */
const TOWN = { xSt: [56, 100, 144, 188], zSt: [-118, ST_W, 82, 160], x0: -170, x1: 230, z1: 205 };

// ---------------------------------------------------------------------------------------
// Ruido y utilidades
// ---------------------------------------------------------------------------------------

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function hash(ix: number, iy: number, seed: number) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Ruido de valor 2D (0..1). */
function vnoise(x: number, y: number, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

function fbm(x: number, y: number, oct = 4, seed = 0) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f, seed + i * 17);
    n += a;
    a *= 0.5;
    f *= 2;
  }
  return s / n;
}

/**
 * Ruido periódico w × h para texturas que se repiten sin costura: octavas de ruido de valor
 * sobre una grilla de px × py celdas (que se duplica en cada octava). Valores 0..1.
 */
function noiseField(w: number, h: number, px: number, py: number, oct: number, seed: number) {
  const out = new Float32Array(w * h);
  // tablas por columna (celda, vecina y peso suavizado) que se reutilizan en cada fila
  const c0 = new Int32Array(w), c1 = new Int32Array(w), cu = new Float32Array(w);
  let amp = 0.5, total = 0;
  for (let o = 0; o < oct; o++) {
    const nx = px << o, ny = py << o;
    const lat = new Float32Array(nx * ny);
    for (let i = 0; i < lat.length; i++) lat[i] = hash(i % nx, Math.floor(i / nx), seed + o * 17);
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * nx, ix = Math.floor(fx), tx = fx - ix;
      c0[x] = ix;
      c1[x] = (ix + 1) % nx;
      cu[x] = tx * tx * (3 - 2 * tx);
    }
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * ny, iy = Math.floor(fy), ty = fy - iy, uy = ty * ty * (3 - 2 * ty);
      const r0 = iy * nx, r1 = ((iy + 1) % ny) * nx, row = y * w;
      for (let x = 0; x < w; x++) {
        const a = c0[x], b = c1[x], ux = cu[x];
        const top = lat[r0 + a] + (lat[r0 + b] - lat[r0 + a]) * ux;
        const bot = lat[r1 + a] + (lat[r1 + b] - lat[r1 + a]) * ux;
        out[row + x] += amp * (top + (bot - top) * uy);
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Transformación local → planta de un objeto girado `ry` en torno a Y. */
function frame(x0: number, z0: number, ry: number) {
  const c = Math.cos(ry), s = Math.sin(ry);
  return (lx: number, lz: number): V2 => [x0 + lx * c + lz * s, z0 - lx * s + lz * c];
}

// ---------------------------------------------------------------------------------------
// Terreno: plano de la obra, talud de corte al oriente (-z) y lomas lejanas
// ---------------------------------------------------------------------------------------

const outsideX = (x: number) => Math.max(0, FENCE.x0 - x, x - FENCE.x1);

/** Perfil del corte: rampa recta con redondeo suave al pie y en el coronamiento. */
function cutProfile(s: number) {
  const a = 0.14;
  if (s <= 0) return 0;
  if (s >= 1) return 1;
  if (s < a) return (s * s) / (2 * a * (1 - a));
  if (s > 1 - a) return 1 - ((1 - s) * (1 - s)) / (2 * a * (1 - a));
  return (s - a / 2) / (1 - a);
}

function heightAt(x: number, z: number) {
  const T = SITE.talud;
  // fuera del ancho de la obra el corte se suaviza en una ladera natural
  const k = smooth(0, 30, outsideX(x));
  const zs = T.zStart + 2 * k, zt = T.zTop - 24 * k;
  const s = clamp((zs - z) / (zs - zt), 0, 1);
  let h = G + T.height * lerp(cutProfile(s), s * s * (3 - 2 * s), k);
  if (s > 0 && s < 1) h += (vnoise(x * 0.35, z * 0.6, 9) - 0.5) * 0.45 * Math.sin(Math.PI * s) * (1 - k);
  const behind = zt - z;
  if (behind > 0) h += behind * 0.06 * smooth(0, 50, behind) + (fbm(x * 0.03, z * 0.03, 3, 5) - 0.5) * 2.5 * smooth(0, 25, behind);
  const far = Math.max(TOWN.x0 - 5 - x, x - TOWN.x1 - 5, z - TOWN.z1 - 5, 0);
  if (far > 0) h += smooth(0, 90, far) * fbm(x * 0.01, z * 0.01, 3, 11) * 16;
  const r = Math.hypot(x - 10, z - 10);
  if (r > 260) h += smooth(260, 520, r) * (fbm(x * 0.005, z * 0.005, 4, 3) * 70 - 8);
  return h;
}

function axis(lo: number, hi: number, step: number, ext: number, fine?: [number, number, number]) {
  const v: number[] = [];
  for (let x = lo; x <= hi + 1e-6; x += step) v.push(x);
  if (fine) for (let x = fine[0]; x <= fine[1] + 1e-6; x += fine[2]) v.push(x);
  for (const dir of [1, -1]) {
    let s = step, x = dir > 0 ? hi : lo;
    while (Math.abs(x) < ext) {
      s *= 1.22;
      x += dir * s;
      v.push(clamp(x, -ext, ext));
    }
  }
  return [...new Set(v.map((a) => Math.round(a * 100) / 100))].sort((a, b) => a - b);
}

const TC = {
  sand: new THREE.Color('#dfbd8e'),
  sandDark: new THREE.Color('#cda575'),
  grass: new THREE.Color('#86a052'),
  grassDry: new THREE.Color('#aca66a'),
  forest: new THREE.Color('#5d7044'),
  cut: new THREE.Color('#d48a56'),
  cutDark: new THREE.Color('#b8693f'),
};

function terrainColor(x: number, z: number, h: number, ny: number, out: THREE.Color, tmp: THREE.Color) {
  const n1 = fbm(x * 0.09, z * 0.09, 3, 21), n2 = fbm(x * 0.02, z * 0.02, 3, 22);
  out.lerpColors(TC.grass, TC.grassDry, smooth(0.35, 0.7, n1));
  out.lerp(TC.forest, smooth(0.42, 0.72, n2) * 0.75);
  // suelo compactado dentro del cierro
  const din = Math.min(x - FENCE.x0, FENCE.x1 - x, z - FENCE.z0, FENCE.z1 - z);
  const site = smooth(-2.5, 1.2, din + (n1 - 0.5) * 5);
  tmp.lerpColors(TC.sand, TC.sandDark, smooth(0.25, 0.85, n1 * 0.35 + n2 * 0.65));
  out.lerp(tmp, site);
  // cara del corte: rojizo con vetas verticales
  const cut = smooth(0.06, 0.13, 1 - ny) * (1 - smooth(0, 18, outsideX(x)));
  if (cut > 0) {
    // cárcavas verticales y estratos horizontales
    const rill = smooth(0.3, 0.8, vnoise(x * 0.55, z * 0.12, 4)) * 0.8 + 0.2 * Math.sin(h * 2.3) ** 2;
    tmp.lerpColors(TC.cut, TC.cutDark, rill);
    out.lerp(tmp, cut);
  }
}

function buildTerrain(mat: THREE.Material) {
  const xs = axis(-130, 170, 3, 900, [FENCE.x0 - 6, FENCE.x1 + 6, 1.5]);
  const zs = axis(-120, 150, 3, 900, [-28, -11, 0.75]);
  const nx = xs.length, nz = zs.length;
  const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), col = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i, x = xs[i], z = zs[j];
      pos.set([x, heightAt(x, z), z], k * 3);
      uv.set([x / 10, -z / 10], k * 2);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nrm = g.attributes.normal;
  const c = new THREE.Color(), tmp = new THREE.Color();
  for (let k = 0; k < nx * nz; k++) {
    terrainColor(pos[k * 3], pos[k * 3 + 2], pos[k * 3 + 1], nrm.getY(k), c, tmp);
    col.set([c.r, c.g, c.b], k * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terreno';
  return { mesh, xs, zs, pos, nrm };
}

/**
 * Cara del talud: capa con textura (cárcavas, estratos, piedras) sobre los MISMOS vértices y
 * triángulos del terreno (sin z-fighting). u = cota relativa (pie → coronamiento), v = largo en x.
 * El alfa sigue la pendiente, igual que el color de corte del terreno.
 */
function buildCutFace(t: ReturnType<typeof buildTerrain>, mat: THREE.Material) {
  const { xs, zs, pos, nrm } = t;
  const nx = xs.length;
  const cols: number[] = [], rows: number[] = [];
  // termina poco después del cierro: más allá corre la calle exterior
  xs.forEach((x, i) => outsideX(x) < 4.5 && cols.push(i));
  zs.forEach((z, j) => z > SITE.talud.zTop - 6 && z < SITE.talud.zStart + 2 && rows.push(j));
  const b = new Batch(true), white = new THREE.Color(1, 1, 1);
  const at = new Map<number, number>();
  for (const j of rows) for (const i of cols) {
    const k = j * nx + i, x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2];
    const a = smooth(0.06, 0.13, 1 - nrm.getY(k)) * (1 - smooth(0, 4, outsideX(x)));
    const u = clamp((y - G) / SITE.talud.height, 0, 1);
    at.set(k, b.vert(x, y + 0.02, z, nrm.getX(k), nrm.getY(k), nrm.getZ(k), u, x / 28, white, a));
  }
  for (let r = 0; r < rows.length - 1; r++) for (let c = 0; c < cols.length - 1; c++) {
    const ka = rows[r] * nx + cols[c], kb = ka + 1, kc = rows[r + 1] * nx + cols[c], kd = kc + 1;
    const A = at.get(ka)!, B = at.get(kb)!, C = at.get(kc)!, D = at.get(kd)!;
    if (cols[c + 1] !== cols[c] + 1 || rows[r + 1] !== rows[r] + 1) continue;
    // solo los cuadros donde se ve el corte
    if (Math.max(b.alpha(A), b.alpha(B), b.alpha(C), b.alpha(D)) < 0.01) continue;
    b.idx.push(A, C, B, B, C, D);
  }
  const mesh = new THREE.Mesh(b.build()!, mat);
  mesh.receiveShadow = true;
  mesh.renderOrder = -4;
  mesh.name = 'talud';
  return mesh;
}

// ---------------------------------------------------------------------------------------
// Acumulador de geometría con color por vértice (una malla por material)
// ---------------------------------------------------------------------------------------

class Batch {
  private p: number[] = [];
  private n: number[] = [];
  private u: number[] = [];
  private c: number[] = [];
  readonly idx: number[] = [];
  constructor(readonly rgba = false) {}
  get count() {
    return this.p.length / 3;
  }
  /** Alfa del vértice i (1 si el lote no lleva alfa). */
  alpha(i: number) {
    return this.rgba ? this.c[i * 4 + 3] : 1;
  }
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, col: THREE.Color, a = 1) {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.u.push(u, v);
    if (this.rgba) this.c.push(col.r, col.g, col.b, a);
    else this.c.push(col.r, col.g, col.b);
    return this.count - 1;
  }
  build() {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, this.rgba ? 4 : 3));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Mallas de un grupo: un Batch por material. */
class Kit {
  private map = new Map<THREE.Material, Batch>();
  b(m: THREE.Material) {
    let b = this.map.get(m);
    if (!b) this.map.set(m, (b = new Batch(m.transparent)));
    return b;
  }
  into(group: THREE.Group, cast = true) {
    for (const [m, b] of this.map) {
      const g = b.build();
      if (!g) continue;
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.map.clear();
    return group;
  }
}

interface PartOpt {
  rx?: number;
  ry?: number;
  rz?: number;
  q?: THREE.Quaternion;
  /** UV en metros (tamaño de la textura) proyectadas por cara en ejes locales. */
  uv?: number | V2;
  /** Deformación radial pseudoaleatoria (copas de árboles, montículos). */
  jitter?: number;
  seed?: number;
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);

/** Agrega una plantilla escalada (sx, sy, sz), girada (orden YXZ) y centrada en (x, y, z). */
function part(b: Batch, g: THREE.BufferGeometry, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation, o: PartOpt = {}) {
  const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
  const q = o.q ?? _q.setFromEuler(_e.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, 'YXZ'));
  _c.set(color);
  const us = o.uv === undefined ? null : typeof o.uv === 'number' ? [o.uv, o.uv] : o.uv;
  const base = b.count;
  for (let k = 0; k < P.count; k++) {
    let lx = P.getX(k), ly = P.getY(k), lz = P.getZ(k);
    if (o.jitter) {
      const j = 1 + (hash(Math.round(lx * 997), Math.round(ly * 991) + Math.round(lz * 983) * 7919, o.seed ?? 0) - 0.5) * o.jitter;
      lx *= j; ly *= j; lz *= j;
    }
    _v.set(lx * sx, ly * sy, lz * sz);
    _n.set(N.getX(k) / sx, N.getY(k) / sy, N.getZ(k) / sz).normalize();
    let u = U ? U.getX(k) : 0, v = U ? U.getY(k) : 0;
    if (us) {
      const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
      if (ay >= ax && ay >= az) { u = _v.x; v = -_v.z; }
      else if (ax >= az) { u = _v.z; v = _v.y; }
      else { u = _v.x; v = _v.y; }
      u /= us[0];
      v /= us[1];
    }
    _v.applyQuaternion(q);
    _n.applyQuaternion(q);
    b.vert(_v.x + x, _v.y + y, _v.z + z, _n.x, _n.y, _n.z, u, v, _c);
  }
  if (g.index) for (let k = 0; k < g.index.count; k++) b.idx.push(base + g.index.getX(k));
  else for (let k = 0; k < P.count; k++) b.idx.push(base + k);
}

/** Montón de áridos de diámetro 1 y alto 1 (talud natural ~30° al escalarlo), con terrones. */
function heapGeometry(seed: number) {
  // perfil de abajo hacia arriba (así las caras del torno miran hacia afuera)
  const prof = [[0.53, 0], [0.48, 0.07], [0.4, 0.27], [0.28, 0.58], [0.16, 0.86], [0.07, 0.97], [0, 1]];
  const lathe = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 18);
  const g = mergeVertices(lathe.deleteAttribute('uv').deleteAttribute('normal'));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = (vnoise(x * 7 + 3, z * 7 + 3, seed) - 0.5) * 0.3;
    p.setXYZ(i, x * (1 + d), y * (1 + d * 0.5), z * (1 + d));
  }
  g.computeVertexNormals();
  return g;
}

/** Icosaedro con vértices compartidos (12 en vez de 60); el material del follaje usa flatShading. */
function indexedBlob() {
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const m = mergeVertices(g);
  m.computeVertexNormals();
  return m;
}

/** Proporción del techo de la cabina de los autos respecto de su base (largo). */
const CABIN_TOP = 0.62;

/** Caja unitaria cuya cara superior se reduce a (tx, tz): cabinas de autos. */
function taperedBox(tx: number, tz: number) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setXYZ(i, p.getX(i) * tx, p.getY(i), p.getZ(i) * tz);
  g.computeVertexNormals();
  return g;
}

/** Plantillas compartidas (geometrías unitarias). */
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
  tube: new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1, true),
  trunk: new THREE.CylinderGeometry(0.3, 0.5, 1, 6, 1, true),
  cone: new THREE.ConeGeometry(0.5, 1, 12, 1, true),
  sphere: new THREE.SphereGeometry(0.5, 14, 9),
  blob: indexedBlob(),
  twig: new THREE.CylinderGeometry(0.5, 0.5, 1, 4, 1, true),
  torus: new THREE.TorusGeometry(0.5, 0.1, 6, 22),
  cabin: taperedBox(CABIN_TOP, 0.86),
};

/** Caja apoyada: (x, z) centro en planta, y0 = cara inferior. */
function box(b: Batch, x: number, y0: number, z: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation, o?: PartOpt) {
  part(b, GEO.box, x, y0 + sy / 2, z, sx, sy, sz, color, o);
}

/** Barra entre dos puntos con la plantilla dada (caja o tubo) y sección `d`. */
function rod(b: Batch, g: THREE.BufferGeometry, ax: number, ay: number, az: number, bx: number, by: number, bz: number, d: number, color: THREE.ColorRepresentation) {
  _v.set(bx - ax, by - ay, bz - az);
  const len = _v.length();
  if (len < 1e-4) return;
  const q = new THREE.Quaternion().setFromUnitVectors(_up, _v.divideScalar(len));
  part(b, g, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, d, len, d, color, { q });
}

/** Polígono plano convexo (orden antihorario visto desde la cara); u sigue el primer lado. */
function poly(b: Batch, pts: THREE.Vector3[], color: THREE.ColorRepresentation, uv: V2 = [1, 1]) {
  const e1 = pts[1].clone().sub(pts[0]).normalize();
  const n = pts[1].clone().sub(pts[0]).cross(pts[2].clone().sub(pts[0])).normalize();
  const e2 = n.clone().cross(e1);
  _c.set(color);
  const base = b.count;
  for (const p of pts) {
    _v.copy(p).sub(pts[0]);
    b.vert(p.x, p.y, p.z, n.x, n.y, n.z, _v.dot(e1) / uv[0], _v.dot(e2) / uv[1], _c);
  }
  for (let i = 1; i < pts.length - 1; i++) b.idx.push(base, base + i, base + i + 1);
}

/** Techo a cuatro aguas sobre una planta w × d (local), alero incluido. */
function hipRoof(b: Batch, x: number, z: number, y: number, w: number, d: number, rise: number, ry: number, color: THREE.ColorRepresentation) {
  if (w < d) return hipRoof(b, x, z, y, d, w, rise, ry + Math.PI / 2, color);
  const f = frame(x, z, ry);
  const P = (lx: number, ly: number, lz: number) => {
    const [px, pz] = f(lx, lz);
    return new THREE.Vector3(px, y + ly, pz);
  };
  const hw = w / 2, hd = d / 2, r = hd;
  const A = P(-hw, 0, -hd), B = P(hw, 0, -hd), Cc = P(hw, 0, hd), D = P(-hw, 0, hd);
  const R1 = P(-hw + r, rise, 0), R2 = P(hw - r, rise, 0);
  const uv: V2 = [0.45, 0.4];
  poly(b, [D, Cc, R2, R1], color, uv);
  poly(b, [B, A, R1, R2], color, uv);
  poly(b, [Cc, B, R2], color, uv);
  poly(b, [A, D, R1], color, uv);
}

// ---------------------------------------------------------------------------------------
// Caminos (cintas que siguen el terreno, con bordes suaves por alfa de vértice)
// ---------------------------------------------------------------------------------------

function filletPath(path: V2[], r: number, step: number): V2[] {
  const seq: V2[] = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const p = path[i], a = path[i - 1], c = path[i + 1];
    const l1 = Math.hypot(a[0] - p[0], a[1] - p[1]), l2 = Math.hypot(c[0] - p[0], c[1] - p[1]);
    const d1: V2 = [(a[0] - p[0]) / l1, (a[1] - p[1]) / l1], d2: V2 = [(c[0] - p[0]) / l2, (c[1] - p[1]) / l2];
    const ang = Math.acos(clamp(d1[0] * d2[0] + d1[1] * d2[1], -1, 1));
    if (r <= 0 || ang > Math.PI - 1e-3) {
      seq.push(p);
      continue;
    }
    const t = Math.min(r / Math.tan(ang / 2), l1 / 2, l2 / 2);
    const rr = t * Math.tan(ang / 2);
    const A: V2 = [p[0] + d1[0] * t, p[1] + d1[1] * t], B: V2 = [p[0] + d2[0] * t, p[1] + d2[1] * t];
    const bl = Math.hypot(d1[0] + d2[0], d1[1] + d2[1]);
    const dc = rr / Math.sin(ang / 2);
    const Cc: V2 = [p[0] + ((d1[0] + d2[0]) / bl) * dc, p[1] + ((d1[1] + d2[1]) / bl) * dc];
    const a0 = Math.atan2(A[1] - Cc[1], A[0] - Cc[0]);
    let da = Math.atan2(B[1] - Cc[1], B[0] - Cc[0]) - a0;
    if (da > Math.PI) da -= 2 * Math.PI;
    if (da < -Math.PI) da += 2 * Math.PI;
    const n = Math.max(3, Math.ceil(Math.abs(da) * rr));
    for (let k = 0; k <= n; k++) seq.push([Cc[0] + rr * Math.cos(a0 + (da * k) / n), Cc[1] + rr * Math.sin(a0 + (da * k) / n)]);
  }
  seq.push(path[path.length - 1]);
  const out: V2[] = [seq[0]];
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1], b = seq[i];
    const m = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 1; k <= m; k++) out.push([lerp(a[0], b[0], k / m), lerp(a[1], b[1], k / m)]);
  }
  return out;
}

interface RibbonOpt {
  width: number;
  texLen: number;
  radius?: number;
  uRep?: number;
  fade?: number;
  lift?: number;
  step?: number;
  alpha?: number;
}

function ribbon(b: Batch, path: V2[], o: RibbonOpt) {
  const pts = filletPath(path, o.radius ?? 0, o.step ?? 3);
  const hw = o.width / 2, f = o.fade ?? 0, lift = o.lift ?? 0.03, uRep = o.uRep ?? 1, al = o.alpha ?? 1;
  const across = f > 0 ? [-hw - f, -hw + f, hw - f, hw + f] : [-hw, hw];
  const alpha = f > 0 ? [0, al, al, 0] : [al, al];
  const col = new THREE.Color(1, 1, 1);
  let s = 0, prev = -1;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i > 0) s += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    const a = pts[Math.max(i - 1, 0)], c = pts[Math.min(i + 1, pts.length - 1)];
    const tl = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const tx = (c[0] - a[0]) / tl, tz = (c[1] - a[1]) / tl;
    const base = b.count;
    across.forEach((w, k) => {
      const px = p[0] - tz * w, pz = p[1] + tx * w, h = heightAt(px, pz);
      // normal del terreno (las calles del barrio suben la loma)
      _n.set(h - heightAt(px + 0.5, pz), 0.5, h - heightAt(px, pz + 0.5)).normalize();
      b.vert(px, h + lift, pz, _n.x, _n.y, _n.z, ((w + hw) / o.width) * uRep, s / o.texLen, col, alpha[k]);
    });
    if (prev >= 0) {
      for (let k = 0; k < across.length - 1; k++) b.idx.push(prev + k, prev + k + 1, base + k + 1, prev + k, base + k + 1, base + k);
    }
    prev = base;
  }
}

// ---------------------------------------------------------------------------------------
// Texturas procedurales
// ---------------------------------------------------------------------------------------

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function pixels(g: CanvasRenderingContext2D, w: number, h: number, fn: (x: number, y: number, o: number[]) => void) {
  const img = g.createImageData(w, h);
  const o = [0, 0, 0, 1];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      o[3] = 1;
      fn(x, y, o);
      // Uint8ClampedArray: recorta a 0..255 sola
      const i = (y * w + x) * 4;
      img.data[i] = o[0] * 255;
      img.data[i + 1] = o[1] * 255;
      img.data[i + 2] = o[2] * 255;
      img.data[i + 3] = o[3] * 255;
    }
  }
  g.putImageData(img, 0, 0);
}

/** Suelo: grano fino neutro con piedrecillas; se tiñe con el color de vértice. */
function groundTexture() {
  const S = 512;
  const N = noiseField(S, S, 8, 8, 4, 3), Mf = noiseField(S, S, 48, 48, 2, 7);
  return canvasTex(S, S, (g) => {
    pixels(g, S, S, (x, y, o) => {
      const n = N[y * S + x], m = Mf[y * S + x];
      const sp = hash(x, y, 1);
      let v = 0.78 + 0.2 * n + 0.08 * m + (sp - 0.5) * 0.09;
      if (sp > 0.986) v *= 0.8;
      o[0] = v; o[1] = v * 0.985; o[2] = v * 0.955;
    });
    const r = rng(5);
    for (let i = 0; i < 320; i++) {
      const x = r() * S, y = r() * S, rad = 0.8 + r() * 2.4;
      for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
        g.fillStyle = 'rgba(70,52,34,0.28)';
        g.beginPath(); g.ellipse(x + dx + 0.8, y + dy + 1, rad, rad * 0.75, 0, 0, 7); g.fill();
        g.fillStyle = r() > 0.5 ? 'rgba(255,248,236,0.45)' : 'rgba(150,140,128,0.5)';
        g.beginPath(); g.ellipse(x + dx, y + dy, rad, rad * 0.75, 0, 0, 7); g.fill();
      }
    }
  });
}

/**
 * Cara del talud en maicillo: u = cota (0 pie, 1 coronamiento), v = largo (periódica).
 * Cárcavas que bajan por la pendiente con relieve sombreado, estratos, capa vegetal arriba,
 * derrame de material suelto al pie y piedras.
 */
function cutTexture() {
  const W = 128, H = 1024;
  const N = noiseField(W, H, 3, 24, 4, 51); // manchas
  const R = noiseField(W, H, 3, 44, 3, 52); // cárcavas: alargadas en u
  const S = noiseField(W, H, 1, 40, 2, 53); // borde irregular de estratos
  const light = [0.84, 0.53, 0.33], dark = [0.66, 0.37, 0.21], pale = [0.86, 0.68, 0.49], soil = [0.5, 0.33, 0.22];
  return canvasTex(W, H, (g) => {
    pixels(g, W, H, (x, y, o) => {
      const u = x / (W - 1), i = y * W + x;
      const n = N[i], wob = (S[i] - 0.5) * 0.12;
      // relieve: diferencia de la cárcava entre filas vecinas = cara iluminada / en sombra
      const r = R[i], dr = R[((y + 4) % H) * W + x] - R[((y + H - 4) % H) * W + x];
      const t = smooth(0.28, 0.72, n * 0.8 + r * 0.25);
      for (let c = 0; c < 3; c++) o[c] = lerp(light[c], dark[c], t);
      // estrato claro de maicillo a media altura y vetas horizontales finas
      const band = smooth(0.0, 0.05, 0.08 - Math.abs(u - 0.42 - wob));
      const fine = 0.025 * Math.sin((u + wob * 0.5) * 80);
      for (let c = 0; c < 3; c++) o[c] = lerp(o[c], pale[c], band * 0.35) * (1 + fine);
      // cárcavas: surco oscuro con un borde iluminado
      const gully = smooth(0.6, 0.78, r) * smooth(0.02, 0.25, u) * (1 - smooth(0.9, 0.98, u));
      const shade = 1 - gully * 0.16 + clamp(dr * 1.6, -0.07, 0.08) * (0.4 + gully);
      // capa vegetal oscura en el coronamiento y derrame claro al pie
      const top = smooth(0.9, 0.97, u + wob * 0.3), foot = 1 - smooth(0.0, 0.14, u + (n - 0.5) * 0.1);
      for (let c = 0; c < 3; c++) {
        let v = o[c] * shade;
        v = lerp(v, soil[c], top * 0.75);
        v = lerp(v, pale[c] * (0.92 + n * 0.1), foot * 0.7);
        o[c] = v;
      }
      // piedras: punto claro con sombra abajo
      // (1 px en u ≈ 3 px en v: la textura cubre ~11 m de talud a lo alto y 28 m a lo largo)
      const cy = Math.floor(y / 3);
      if (hash(x, cy, 54) > 0.995) for (let c = 0; c < 3; c++) o[c] = o[c] * 0.7 + 0.3 * 0.92;
      else if (hash(x + 1, cy, 54) > 0.995) for (let c = 0; c < 3; c++) o[c] *= 0.8;
    });
  });
}

/** Ripio compactado; con huellas de neumáticos si `tracks`. u = través del camino, v = largo. */
function gravelTexture(tracks: boolean) {
  const W = tracks ? 128 : 256, H = tracks ? 512 : 256;
  const N = noiseField(W, H, 4, tracks ? 16 : 4, 3, 11);
  return canvasTex(W, H, (g) => {
    pixels(g, W, H, (x, y, o) => {
      const u = x / W, v = y / H;
      const n = N[y * W + x];
      const sp = hash(x, y, 2);
      let val = (tracks ? 0.5 : 0.53) + 0.12 * n + (sp - 0.5) * 0.14;
      if (sp > 0.97) val *= 1.25;
      if (tracks) {
        const wob = 0.008 * Math.sin(v * Math.PI * 2) + 0.004 * Math.sin(v * Math.PI * 6 + 1);
        for (const c of [0.27, 0.73]) {
          const t = 1 - smooth(0.04, 0.075, Math.abs(u - c - wob));
          const tread = y % 6 < 2 ? 0.94 : 1;
          val = lerp(val, (0.44 + 0.05 * n) * tread, t * 0.7);
        }
      }
      o[0] = val; o[1] = val * 0.93; o[2] = val * 0.82;
    });
  });
}

function asphaltTexture() {
  const W = 256, H = 512;
  const N = noiseField(W, H, 4, 8, 3, 31);
  return canvasTex(W, H, (g) => {
    pixels(g, W, H, (x, y, o) => {
      const u = x / W, v = y / H;
      const n = N[y * W + x];
      let val = 0.3 + 0.07 * n + (hash(x, y, 3) - 0.5) * 0.06;
      const line = Math.abs(u - 0.07) < 0.008 || Math.abs(u - 0.93) < 0.008 || (Math.abs(u - 0.5) < 0.007 && v % 0.5 < 0.22);
      if (line) val = 0.82;
      o[0] = val; o[1] = val; o[2] = val * 1.03;
    });
  });
}

/** Plancha OSB 1,22 × 2,44 m. */
function osbTexture() {
  return canvasTex(256, 512, (g) => {
    g.fillStyle = '#c9a674';
    g.fillRect(0, 0, 256, 512);
    const r = rng(9);
    const pal = ['#ab8550', '#dcc08b', '#b98f5c', '#d1b07a', '#9c7646', '#e6cf9f'];
    for (let i = 0; i < 1500; i++) {
      g.save();
      g.translate(r() * 256, r() * 512);
      g.rotate(r() * Math.PI);
      g.globalAlpha = 0.55 + r() * 0.4;
      g.fillStyle = pal[Math.floor(r() * pal.length)];
      const l = 10 + r() * 22, w = 3 + r() * 6;
      g.fillRect(-l / 2, -w / 2, l, w);
      g.restore();
    }
    g.strokeStyle = 'rgba(80,58,34,0.6)';
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, 253, 509);
  });
}

/** Plancha acanalada (zinc) o nervios de contenedor: ondas a lo largo de u. */
function corrugatedTexture() {
  return canvasTex(64, 32, (g) => {
    pixels(g, 64, 32, (x, y, o) => {
      const s = 0.5 + 0.5 * Math.cos((x / 64) * Math.PI * 2 * 4);
      const v = 0.68 + 0.32 * s + (hash(x, y, 4) - 0.5) * 0.04;
      o[0] = v; o[1] = v; o[2] = v;
    });
  });
}

/** Teja de arcilla: ondas y línea de hilada. */
function tileTexture() {
  return canvasTex(64, 64, (g) => {
    pixels(g, 64, 64, (x, y, o) => {
      const s = 0.5 + 0.5 * Math.cos((x / 64) * Math.PI * 4);
      const yy = y / 64;
      const v = (0.7 + 0.3 * s) * (yy < 0.14 ? 0.62 : 1 - 0.12 * yy) + (hash(x, y, 6) - 0.5) * 0.05;
      o[0] = v; o[1] = v; o[2] = v;
    });
  });
}

/** Malla raschel verde. */
function clothTexture() {
  return canvasTex(64, 64, (g) => {
    pixels(g, 64, 64, (x, y, o) => {
      const weave = ((x >> 1) + (y >> 1)) % 2 ? 0.9 : 1.06;
      const hole = x % 4 === 0 && y % 4 === 0 ? 1.25 : 1;
      const v = weave * hole * (0.94 + (hash(x, y, 8) - 0.5) * 0.08);
      o[0] = 0.13 * v; o[1] = 0.36 * v; o[2] = 0.22 * v;
    });
  });
}

/** Malla de seguridad naranja (con transparencias). */
function netTexture() {
  return canvasTex(128, 64, (g) => {
    g.fillStyle = '#ff6a1a';
    g.fillRect(0, 0, 128, 64);
    g.globalCompositeOperation = 'destination-out';
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 5; i++) {
        const x = i * 32 + (j % 2 ? 16 : 0), y = j * 32;
        g.beginPath(); g.ellipse(x, y, 12, 10, 0, 0, 7); g.fill();
      }
    }
  });
}

/** Fachada de casa (dos pisos, ventanas) que se tiñe con el color de vértice. */
function facadeTexture() {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#f4f1ea';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(0,0,0,0.05)';
    g.fillRect(0, 128, 256, 4);
    g.fillStyle = '#a8a196';
    g.fillRect(0, 238, 256, 18);
    for (const row of [44, 156]) {
      for (const col of [36, 110, 184]) {
        g.fillStyle = '#ffffff';
        g.fillRect(col - 3, row - 3, 42, 50);
        const gr = g.createLinearGradient(0, row, 0, row + 44);
        gr.addColorStop(0, '#6f8597');
        gr.addColorStop(1, '#34404b');
        g.fillStyle = gr;
        g.fillRect(col, row, 36, 44);
        g.fillStyle = '#ffffff';
        g.fillRect(col + 17, row, 2, 44);
        g.fillStyle = '#c8c3ba';
        g.fillRect(col - 5, row + 46, 46, 4);
      }
    }
  }, false);
}

/** Letrero de la Mutual: dotación y días sin accidentes. */
function safetySignTexture() {
  const W = 1024, H = 640, green = '#5fa83a';
  const t = canvasTex(W, H, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, W, H);
    g.fillStyle = green;
    g.fillRect(0, 0, W, 86);
    g.fillRect(0, H - 92, W, 92);
    g.fillStyle = '#ffffff';
    g.font = '600 40px system-ui, Arial, sans-serif';
    g.textBaseline = 'middle';
    g.fillText('Empresa con programa en Prevención de Riesgos', 36, 44);
    g.font = 'italic 600 40px system-ui, Arial, sans-serif';
    g.fillText('Agregamos Valor, Protegiendo a las Personas', 36, H - 46);
    // logo: tres hojas y nombre
    g.fillStyle = green;
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.ellipse(W - 140 + i * 30, 392 - i * 8, 11, 34, 0.25, 0, 7);
      g.fill();
    }
    g.font = '800 44px system-ui, Arial, sans-serif';
    g.fillText('MUTUAL', W - 250, 470);
    g.font = '500 26px system-ui, Arial, sans-serif';
    g.fillText('de seguridad', W - 220, 505);
    // filas de texto con casilleros de números (como el letrero de la visita a terreno)
    const row = (y: number, items: (string | [string])[], maxPx: number, maxW = W - 80) => {
      let px = maxPx;
      const width = () => {
        g.font = `700 ${px}px system-ui, Arial, sans-serif`;
        return items.reduce((w, it) => w + (typeof it === 'string' ? g.measureText(it).width : it[0].length * px * 1.12) + px * 0.4, 0);
      };
      while (width() > maxW && px > 20) px -= 2;
      let x = 40;
      for (const it of items) {
        if (typeof it === 'string') {
          g.fillStyle = '#1d2329';
          g.fillText(it, x, y);
          x += g.measureText(it).width + px * 0.4;
          continue;
        }
        for (const ch of it[0]) {
          g.fillStyle = '#e9ecef';
          g.fillRect(x, y - px * 0.68, px, px * 1.36);
          g.strokeStyle = '#b5bcc3';
          g.lineWidth = 2;
          g.strokeRect(x, y - px * 0.68, px, px * 1.36);
          g.fillStyle = '#1d2329';
          g.fillText(ch, x + (px - g.measureText(ch).width) / 2, y + 2);
          x += px * 1.12;
        }
        x += px * 0.4;
      }
    };
    row(180, ['AQUÍ TRABAJAMOS', ['085'], 'PERSONAS'], 56);
    row(290, ['LLEVAMOS', ['015'], 'DÍAS SIN ACCIDENTES'], 56);
    row(410, ['FECHA', ['091026']], 44, 600);
  }, false);
  return t;
}

/** Letrero de obra hacia la calle. */
function projectBoardTexture() {
  const W = 1024, H = 512;
  return canvasTex(W, H, (g) => {
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#1f3346');
    bg.addColorStop(1, '#2f4b63');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    // ilustración del edificio
    g.fillStyle = '#d9e2ea';
    g.fillRect(56, 120, 330, 330);
    g.fillStyle = '#8fa3b5';
    for (let f = 0; f < 7; f++) for (let i = 0; i < 7; i++) g.fillRect(72 + i * 44, 140 + f * 44, 30, 26);
    g.fillStyle = '#f08a24';
    g.fillRect(56, 450, 330, 10);
    // texto ajustado al ancho disponible
    const text = (t: string, y: number, weight: number, px: number, color: string) => {
      do g.font = `${weight} ${px}px system-ui, Arial, sans-serif`;
      while (g.measureText(t).width > W - 470 && (px -= 2) > 12);
      g.fillStyle = color;
      g.fillText(t, 430, y);
    };
    g.textBaseline = 'alphabetic';
    text('CONDOMINIO', 120, 500, 30, '#ffffff');
    text(PROJECT.nombre.toUpperCase(), 190, 800, 64, '#ffffff');
    g.fillStyle = '#f08a24';
    g.fillRect(430, 214, 120, 8);
    text(`${PROJECT.edificio} · ${BUILDING_FACTS.pisos} pisos · ${BUILDING_FACTS.deptos} deptos.`, 285, 600, 40, '#ffffff');
    text(PROJECT.constructora, 350, 400, 30, '#c9d6e2');
    text(PROJECT.permiso, 395, 400, 30, '#c9d6e2');
    text('Curauma · Valparaíso', 440, 400, 30, '#c9d6e2');
  }, false);
}

function flagTexture() {
  return canvasTex(192, 128, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 192, 64);
    g.fillStyle = '#d52b1e';
    g.fillRect(0, 64, 192, 64);
    g.fillStyle = '#0039a6';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#ffffff';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 7 : 17, a = -Math.PI / 2 + (i * Math.PI) / 5;
      g.lineTo(32 + r * Math.cos(a), 32 + r * Math.sin(a));
    }
    g.fill();
  }, false);
}

// ---------------------------------------------------------------------------------------
// Materiales
// ---------------------------------------------------------------------------------------

function createMaterials() {
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
  const decal = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };
  return {
    ground: std({ map: groundTexture(), vertexColors: true, roughness: 1 }),
    cut: std({ map: cutTexture(), vertexColors: true, roughness: 1, ...decal }),
    road: std({ map: gravelTexture(true), vertexColors: true, roughness: 1, ...decal }),
    pad: std({ map: gravelTexture(false), vertexColors: true, roughness: 1, ...decal }),
    asphalt: std({ map: asphaltTexture(), roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    paint: std({ vertexColors: true, roughness: 0.55, metalness: 0.05 }),
    rough: std({ vertexColors: true, roughness: 0.9 }),
    metal: std({ vertexColors: true, roughness: 0.45, metalness: 0.35 }),
    osb: std({ map: osbTexture(), vertexColors: true, roughness: 0.92 }),
    sheet: std({ map: corrugatedTexture(), vertexColors: true, roughness: 0.48, metalness: 0.3 }),
    cloth: std({ map: clothTexture(), vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }),
    net: std({ map: netTexture(), alphaTest: 0.4, roughness: 0.8, side: THREE.DoubleSide }),
    glass: std({ color: '#33414d', roughness: 0.18, metalness: 0.45 }),
    form: std({ map: formPanelTexture(), vertexColors: true, roughness: 0.55, metalness: 0.3 }),
    ply: std({ map: plywoodTexture(), vertexColors: true, roughness: 0.7 }),
    foliage: std({ vertexColors: true, roughness: 0.95, flatShading: true }),
    facade: std({ map: facadeTexture(), vertexColors: true, roughness: 0.9 }),
    tile: std({ map: tileTexture(), vertexColors: true, roughness: 0.8 }),
    sign: std({ map: safetySignTexture(), roughness: 0.6 }),
    board: std({ map: projectBoardTexture(), roughness: 0.55 }),
    flag: std({ map: flagTexture(), roughness: 0.8, side: THREE.DoubleSide }),
    beacon: std({ color: '#ffb020', emissive: '#ff9a00', emissiveIntensity: 0.4, roughness: 0.3 }),
  };
}
type Mats = ReturnType<typeof createMaterials>;

const COL = {
  timber: '#9b7650',
  timberDark: '#7a5a3a',
  sleeper: '#6e5139',
  zinc: '#c5cbd0',
  steel: '#8e979f',
  galv: '#b7bec4',
  dark: '#2a2e33',
  rust: '#8a4a2b',
  red: '#c8321f',
  yellow: '#f2b705',
  orange: '#ff6a1a',
  blue: '#1f6fd1',
  toilet: '#1f5fae',
  white: '#f4f5f2',
  concrete: '#bdb9b1',
};

// ---------------------------------------------------------------------------------------
// Cierros, portón y letreros
// ---------------------------------------------------------------------------------------

/** Cierro provisorio de OSB (planchas escalonadas que siguen el terreno). `inSide` = ±1 lado interior. */
function osbFence(k: Kit, M: Mats, a: V2, b: V2, inSide: number, tint: () => string) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
  const ry = Math.atan2(-dz, dx);
  const H = 2.2, n = Math.round(L / 1.22), w = L / n;
  const nx = -dz * inSide, nz = dx * inSide; // normal hacia adentro
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) * w;
    const x = a[0] + dx * s, z = a[1] + dz * s;
    const y0 = heightAt(x, z) - 0.12;
    box(k.b(M.osb), x, y0, z, w - 0.01, H, 0.03, tint(), { ry });
    if (i % 2 === 0) {
      const px = a[0] + dx * i * w + nx * 0.06, pz = a[1] + dz * i * w + nz * 0.06;
      box(k.b(M.rough), px, heightAt(px, pz) - 0.3, pz, 0.09, H + 0.25, 0.09, COL.timber, { ry });
    }
    for (const hy of [0.45, 1.75]) box(k.b(M.rough), x + nx * 0.05, y0 + hy, z + nz * 0.05, w, 0.09, 0.045, COL.timberDark, { ry });
  }
}

/** Cierro de malla con raschel verde sobre postes galvanizados. */
function clothFence(k: Kit, M: Mats, a: V2, b: V2) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
  const ry = Math.atan2(-dz, dx);
  const n = Math.round(L / 2.5), w = L / n, H = 2;
  for (let i = 0; i <= n; i++) {
    const x = a[0] + dx * i * w, z = a[1] + dz * i * w, y = heightAt(x, z);
    part(k.b(M.metal), GEO.tube, x, y + (H + 0.1) / 2 - 0.05, z, 0.07, H + 0.2, 0.07, COL.galv);
    if (i < n) {
      const cx = x + dx * w / 2, cz = z + dz * w / 2, cy = heightAt(cx, cz);
      box(k.b(M.cloth), cx, cy + 0.03, cz, w, H - 0.06, 0.02, '#ffffff', { ry, uv: 0.5 });
      rod(k.b(M.metal), GEO.tube, x, y + H, z, x + dx * w, heightAt(x + dx * w, z + dz * w) + H, z + dz * w, 0.045, COL.galv);
    }
  }
}

/** Baranda del coronamiento del talud: estacas naranjas, pasamanos de madera y malla naranja. */
function crestFence(k: Kit, M: Mats, a: V2, b: V2) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
  const ry = Math.atan2(-dz, dx);
  const n = Math.round(L / 2.5), w = L / n;
  for (let i = 0; i <= n; i++) {
    const x = a[0] + dx * i * w, z = a[1] + dz * i * w, y = heightAt(x, z);
    box(k.b(M.paint), x, y - 0.3, z, 0.045, 1.6, 0.045, COL.orange, { ry });
    if (i < n) {
      const x2 = x + dx * w, z2 = z + dz * w, y2 = heightAt(x2, z2);
      rod(k.b(M.rough), GEO.box, x, y + 1.15, z + 0.04, x2, y2 + 1.15, z2 + 0.04, 0.07, COL.timber);
      rod(k.b(M.rough), GEO.box, x, y + 0.6, z + 0.04, x2, y2 + 0.6, z2 + 0.04, 0.05, COL.timber);
      const cx = (x + x2) / 2, cz = (z + z2) / 2;
      box(k.b(M.net), cx, heightAt(cx, cz) + 0.05, cz - 0.03, w, 1.05, 0.01, '#ffffff', { ry, uv: [0.36, 0.18] });
    }
  }
}

function buildFences(k: Kit, M: Mats) {
  const r = rng(77);
  const tints = ['#ffffff', '#f3ece0', '#e9dfcd', '#fff6e8', '#ddd2bf'];
  const tint = () => tints[Math.floor(r() * tints.length)];
  const { x0, x1, z0, z1 } = FENCE;
  // poniente (calle, con portón) y oriente: OSB
  osbFence(k, M, [x0, z1], [x0, GATE.z1 + 0.2], 1, tint);
  osbFence(k, M, [x0, GATE.z0 - 0.2], [x0, z0], 1, tint);
  osbFence(k, M, [x1, z0], [x1, z1], 1, tint);
  // hacia el barrio: malla con raschel
  clothFence(k, M, [x0, z1], [x1, z1]);
  // coronamiento del talud
  crestFence(k, M, [x0, z0 + 0.3], [x1, z0 + 0.3]);
}

/** Portón de dos hojas (abiertas hacia adentro) con balizas sobre los pilares. */
function buildGate(k: Kit, M: Mats, beacons: Batch) {
  const x = FENCE.x0;
  for (const [zp, open] of [[GATE.z0, 0.14], [GATE.z1, -0.12]] as const) {
    box(k.b(M.metal), x, G - 0.3, zp, 0.22, 3.1, 0.22, COL.dark);
    part(beacons, GEO.cyl, x, G + 2.92, zp, 0.18, 0.2, 0.18, '#ffffff');
    // hoja: marco de tubos + raschel
    const f = frame(x, zp, open);
    const L = 4.1, H = 2.1;
    const P = (lx: number, ly: number): [number, number, number] => {
      const [px, pz] = f(lx, 0);
      return [px, G + ly, pz];
    };
    const corners = [P(0.1, 0.1), P(L, 0.1), P(L, H), P(0.1, H)];
    for (let i = 0; i < 4; i++) {
      const p = corners[i], q = corners[(i + 1) % 4];
      rod(k.b(M.metal), GEO.tube, p[0], p[1], p[2], q[0], q[1], q[2], 0.06, COL.galv);
    }
    rod(k.b(M.metal), GEO.tube, ...corners[0], ...corners[2], 0.04, COL.galv);
    const [cx, cz] = f(L / 2 + 0.05, 0.03);
    box(k.b(M.cloth), cx, G + 0.15, cz, L - 0.15, H - 0.1, 0.02, '#ffffff', { ry: open, uv: 0.5 });
  }
}

/** Letrero de seguridad junto al portón (dos caras) sobre dos postes. */
function buildSafetySign(k: Kit, M: Mats, group: THREE.Group) {
  const x = SITE.gate.x + 6.5, z = GATE.z0 - 2.3, ry = 0.55;
  const W = 3.4, H = 2.1, y0 = G + 1.0;
  const f = frame(x, z, ry);
  for (const s of [-1, 1]) {
    const [px, pz] = f(s * (W / 2 + 0.1), -0.06);
    box(k.b(M.metal), px, G - 0.2, pz, 0.1, y0 + H + 0.1 - G + 0.2, 0.1, COL.steel, { ry });
  }
  const [bx, bz] = f(0, -0.06);
  box(k.b(M.paint), bx, y0 - 0.04, bz, W + 0.12, H + 0.08, 0.06, '#e9ece8', { ry });
  for (const [lz, rot] of [[-0.025, 0], [-0.095, Math.PI]]) {
    const [px, pz] = f(0, lz);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(W, H).rotateY(ry + rot).translate(px, y0 + H / 2, pz), M.sign);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
}

/** Letrero de obra mirando a la calle del barrio (+z). */
function buildProjectBoard(k: Kit, M: Mats, group: THREE.Group) {
  const x = 6, z = FENCE.z1 - 0.8, W = 8, H = 4, y0 = G + 2.6;
  for (const s of [-1, 1]) {
    box(k.b(M.metal), x + s * 3.2, G - 0.3, z - 0.15, 0.18, y0 + H - G + 0.3, 0.18, COL.dark);
    rod(k.b(M.metal), GEO.box, x + s * 3.2, G, z - 2.2, x + s * 3.2, y0 + H * 0.7, z - 0.2, 0.1, COL.dark);
  }
  box(k.b(M.paint), x, y0 - 0.05, z - 0.06, W + 0.15, H + 0.1, 0.08, '#28323c');
  const g = new THREE.PlaneGeometry(W, H).translate(x, y0 + H / 2, z - 0.015);
  const m = new THREE.Mesh(g, M.board);
  m.castShadow = true;
  group.add(m);
}

// ---------------------------------------------------------------------------------------
// Instalación de faena
// ---------------------------------------------------------------------------------------

/** Lámina de techo monopendiente (alta al frente +z local). */
function roofSheet(b: Batch, x: number, z: number, ry: number, w: number, d: number, y: number, rise: number, color: THREE.ColorRepresentation) {
  part(b, GEO.box, x, y + rise / 2, z, w, 0.04, Math.hypot(d, rise), color, { ry, rx: -Math.atan2(rise, d), uv: [0.3, 1] });
}

function container(k: Kit, M: Mats, x: number, y0: number, z: number, ry: number, door: boolean) {
  const f = frame(x, z, ry);
  const L = 6.06, H = 2.59, D = 2.44;
  part(k.b(M.sheet), GEO.box, x, y0 + H / 2, z, L - 0.12, H - 0.12, D - 0.06, COL.white, { ry, uv: [1.1, 2.6] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [px, pz] = f(sx * (L / 2 - 0.08), sz * (D / 2 - 0.08));
    box(k.b(M.metal), px, y0, pz, 0.16, H, 0.16, '#d9dde0', { ry });
  }
  for (const sz of [-1, 1]) for (const yy of [0, H - 0.15]) {
    const [px, pz] = f(0, sz * (D / 2 - 0.07));
    box(k.b(M.metal), px, y0 + yy, pz, L, 0.15, 0.14, '#d9dde0', { ry });
  }
  for (const wx of door ? [-1.9, 1.5] : [-1.6, 0, 1.6]) {
    const [px, pz] = f(wx, D / 2 - 0.01);
    box(k.b(M.paint), px, y0 + 0.92, pz, 1.22, 1.08, 0.06, '#f9fafb', { ry });
    const [gx, gz] = f(wx, D / 2 + 0.01);
    box(k.b(M.glass), gx, y0 + 0.98, gz, 1.06, 0.94, 0.04, 0, { ry });
  }
  if (door) {
    const [px, pz] = f(-0.2, D / 2);
    box(k.b(M.paint), px, y0 + 0.08, pz, 0.92, 2.05, 0.08, '#9aa4ad', { ry });
  }
  const [ax, az] = f(L / 2 - 1.2, -D / 2 - 0.15);
  box(k.b(M.paint), ax, y0 + 1.6, az, 0.8, 0.55, 0.28, '#e4e7ea', { ry });
}

function osbHut(k: Kit, M: Mats, x: number, z: number, ry: number, w: number, d: number, h: number, porch = 0) {
  const f = frame(x, z, ry);
  part(k.b(M.osb), GEO.box, x, G + h / 2, z, w, h, d, '#ffffff', { ry, uv: [1.22, 2.44] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [px, pz] = f(sx * (w / 2 + 0.03), sz * (d / 2 + 0.03));
    box(k.b(M.rough), px, G, pz, 0.1, h, 0.1, COL.timber, { ry });
  }
  // techo con alero (y corredor si porch > 0) y viga frontal
  const [rx, rz] = f(0, porch / 2);
  roofSheet(k.b(M.sheet), rx, rz, ry, w + 0.6, d + 0.6 + porch, G + h + 0.1, 0.35, COL.zinc);
  const [fx, fz] = f(0, d / 2 + porch + 0.2);
  box(k.b(M.rough), fx, G + h + 0.22, fz, w + 0.6, 0.22, 0.1, COL.timberDark, { ry });
  if (porch > 0) for (const sx of [-1, 1]) {
    const [px, pz] = f(sx * (w / 2 - 0.1), d / 2 + porch);
    box(k.b(M.rough), px, G, pz, 0.12, h + 0.3, 0.12, COL.timber, { ry });
  }
  const [dx, dz] = f(-w / 2 + 1.0, d / 2 + 0.02);
  box(k.b(M.rough), dx, G + 0.02, dz, 0.9, 2.0, 0.05, '#6d5640', { ry });
  if (w > 3.5) {
    const [wx, wz] = f(w / 2 - 1.3, d / 2 + 0.02);
    box(k.b(M.glass), wx, G + 1.1, wz, 1.2, 0.8, 0.04, 0, { ry });
  }
}

function toilet(k: Kit, M: Mats, x: number, z: number, ry: number) {
  const f = frame(x, z, ry);
  box(k.b(M.paint), x, G, z, 1.12, 2.2, 1.12, COL.toilet, { ry });
  box(k.b(M.paint), x, G + 2.2, z, 1.22, 0.1, 1.22, '#e9eef2', { ry });
  const [dx, dz] = f(0, 0.57);
  box(k.b(M.paint), dx, G + 0.12, dz, 0.82, 1.9, 0.04, '#174c8c', { ry });
  const [vx, vz] = f(0.35, -0.35);
  part(k.b(M.paint), GEO.cyl, vx, G + 2.45, vz, 0.1, 0.4, 0.1, '#cfd6dc');
}

function waterTank(k: Kit, M: Mats, x: number, z: number) {
  const b = k.b(M.paint);
  part(b, GEO.cyl, x, G + 0.85, z, 1.7, 1.1, 1.7, COL.yellow);
  part(b, GEO.sphere, x, G + 1.4, z, 1.7, 0.75, 1.7, COL.yellow);
  part(b, GEO.sphere, x, G + 0.3, z, 1.7, 0.6, 1.7, COL.yellow);
  part(b, GEO.cyl, x, G + 1.8, z, 0.45, 0.08, 0.45, '#d89f00');
  for (const yy of [0.6, 1.1]) part(b, GEO.cyl, x, G + yy, z, 1.74, 0.06, 1.74, '#e2a800');
  // manguera de la salida inferior, tendida en el suelo hasta los baños
  const hose: [number, number, number][] = [[x + 0.78, G + 0.22, z - 0.25], [x + 1.0, G + 0.03, z - 0.7], [x + 0.6, G + 0.03, z - 1.9], [x - 0.6, G + 0.03, z - 2.6]];
  for (let i = 1; i < hose.length; i++) rod(b, GEO.tube, ...hose[i - 1], ...hose[i], 0.05, COL.blue);
}

function buildFaena(M: Mats) {
  const k = new Kit();
  const F = SITE.faena;
  const x0 = F.x - F.w / 2, z1 = F.z + F.d / 2;
  // oficinas: dos contenedores abajo y uno arriba, con escalera
  const cz = z1 - 2.2;
  container(k, M, x0 + 4.2, G, cz, 0, true);
  container(k, M, x0 + 10.4, G, cz, 0, true);
  container(k, M, x0 + 4.2, G + 2.6, cz, 0, false);
  {
    const sx = x0 + 8.0, sz = cz + 1.77, b = k.b(M.metal);
    for (const s of [-1, 1]) rod(b, GEO.box, sx + 2.6, G, sz + s * 0.45, sx, G + 2.6, sz + s * 0.45, 0.08, COL.dark);
    for (let i = 1; i < 13; i++) {
      const t = i / 13;
      box(b, sx + 2.6 * (1 - t), G + 2.6 * t - 0.03, sz, 0.24, 0.04, 0.9, COL.steel);
    }
    box(b, x0 + 4.75, G + 2.55, sz, 7.1, 0.06, 1.0, COL.steel);
    for (const yy of [0.5, 1.0]) box(b, x0 + 4.75, G + 2.6 + yy, sz + 0.47, 7.1, 0.05, 0.05, COL.yellow);
    for (let i = 0; i < 6; i++) box(b, x0 + 1.3 + i * 1.4, G + 2.6, sz + 0.47, 0.05, 1.05, 0.05, COL.yellow);
  }
  // casetas de OSB (bodega, vestidores)
  osbHut(k, M, x0 + 4.5, F.z - F.d / 2 + 3, 0, 7, 4, 2.5, 1.2);
  osbHut(k, M, x0 + 12.5, F.z - F.d / 2 + 3, 0, 6, 4, 2.5);
  // comedor techado
  {
    const cx = x0 + 5, czc = F.z + 1.2, w = 8, d = 5;
    const f = frame(cx, czc, 0);
    for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) {
      const [px, pz] = f(sx * (w / 2 - 0.1), sz * (d / 2 - 0.1));
      box(k.b(M.rough), px, G, pz, 0.12, sz > 0 ? 2.75 : 2.45, 0.12, COL.timber);
    }
    roofSheet(k.b(M.sheet), cx, czc, 0, w + 0.6, d + 0.6, G + 2.4, 0.35, '#dfe6ea');
    box(k.b(M.osb), cx, G, czc - d / 2 + 0.05, w - 0.2, 1.2, 0.04, '#ffffff', { uv: [1.22, 2.44] });
    for (const tz of [-1, 1]) {
      const tzc = czc + tz * 1.05;
      box(k.b(M.rough), cx, G + 0.72, tzc, 5.6, 0.05, 0.8, '#b48a5e');
      for (const lx of [-2.5, 2.5]) box(k.b(M.rough), cx + lx, G, tzc, 0.08, 0.72, 0.7, COL.timberDark);
      for (const bz of [-0.62, 0.62]) {
        box(k.b(M.rough), cx, G + 0.43, tzc + bz, 5.4, 0.04, 0.28, '#a47b51');
        for (const lx of [-2.4, 2.4]) box(k.b(M.rough), cx + lx, G, tzc + bz, 0.06, 0.43, 0.22, COL.timberDark);
      }
    }
  }
  // baños químicos
  for (let i = 0; i < 4; i++) toilet(k, M, x0 + 11.6 + i * 1.3, F.z + 0.4, 0);
  waterTank(k, M, x0 + 16.4, F.z + 3.6);
  // punto limpio (contenedores de colores)
  ['#2e7d32', '#f9a825', '#1565c0', '#616161'].forEach((c, i) => {
    const bx = x0 + 14.6 + i * 0.8, bz = z1 + 2.2;
    box(k.b(M.paint), bx, G, bz, 0.7, 1.0, 0.7, c);
    box(k.b(M.paint), bx, G + 1.0, bz - 0.05, 0.74, 0.07, 0.78, c);
  });
  // caseta del guardia junto al portón
  osbHut(k, M, SITE.gate.x + 3.2, GATE.z1 + 3.2, Math.PI / 2, 2.4, 2.2, 2.3);
  // asta con bandera
  part(k.b(M.metal), GEO.cyl, x0 + 17.5, G + 4, z1 + 1.5, 0.08, 8, 0.08, COL.galv);
  return k;
}

// ---------------------------------------------------------------------------------------
// Acopios y taller
// ---------------------------------------------------------------------------------------

function sleepers(b: Batch, x: number, z: number, len: number, along: 'x' | 'z', offs: number[]) {
  for (const o of offs) {
    if (along === 'x') box(b, x + o, G, z, 0.14, 0.12, len, COL.sleeper);
    else box(b, x, G, z + o, len, 0.12, 0.14, COL.sleeper);
  }
}

/** Moldaje metálico de muros: pilas de paneles 2,4 × 0,9 m acostados + panelera con paneles parados. */
function buildMoldajeMuro(M: Mats) {
  const k = new Kit();
  const r = rng(11);
  const tints = ['#ffffff', '#eef2f6', '#e2e7ec', '#f6f4ef'];
  // filas en z ≤ 17: al girar desde la pata del circuito, la cola de los camiones barre hasta z ≈ 17,4
  const piles: [number, number, number][] = [
    [-20.7, 13.9, 11], [-20.7, 15.15, 7], [-20.7, 16.4, 5],
    [-17.7, 13.9, 9], [-17.7, 15.15, 13], [-17.7, 16.4, 6],
  ];
  const T = 0.11;
  let top = G;
  for (const [px, pz, n] of piles) {
    sleepers(k.b(M.rough), px, pz, 1.1, 'x', [-0.8, 0.8]);
    for (let i = 0; i < n; i++) {
      const dx = (r() - 0.5) * 0.08, dz = (r() - 0.5) * 0.05;
      part(k.b(M.form), GEO.box, px + dx, G + 0.12 + T * (i + 0.5), pz + dz, 0.9, T, 2.4, tints[Math.floor(r() * 4)], { ry: Math.PI / 2 + (r() - 0.5) * 0.03 });
    }
    if (px === -17.7 && pz === 15.15) top = G + 0.12 + T * n;
  }
  // panelera (caballete en A) con paneles parados apoyados a ambos lados
  const rx = -14.2, rz0 = 13.5, rz1 = 17.6, b = k.b(M.metal);
  for (const zz of [rz0, rz1]) {
    rod(b, GEO.box, rx - 0.9, G, zz, rx, G + 2.3, zz, 0.08, '#3b4855');
    rod(b, GEO.box, rx + 0.9, G, zz, rx, G + 2.3, zz, 0.08, '#3b4855');
    box(b, rx, G, zz, 2.0, 0.08, 0.08, '#3b4855');
  }
  box(b, rx, G + 2.26, (rz0 + rz1) / 2, 0.08, 0.08, rz1 - rz0, '#3b4855');
  for (const s of [-1, 1]) {
    box(b, rx + s * 0.85, G, (rz0 + rz1) / 2, 0.1, 0.1, rz1 - rz0, '#3b4855');
    for (let i = 0; i < 4; i++) {
      const layers = 2 + Math.floor(r() * 3);
      for (let l = 0; l < layers; l++) {
        part(k.b(M.form), GEO.box, rx + s * (0.46 + l * 0.1), G + 0.1 + 1.14, rz0 + 0.55 + i * 0.98, 0.9, 2.4, 0.08, tints[Math.floor(r() * 4)], { ry: Math.PI / 2, rx: -s * 0.33 });
      }
    }
  }
  // alineadores (perfiles largos) y esquineros
  sleepers(k.b(M.rough), -24.2, 15.0, 1.4, 'z', [-1.6, 1.6]);
  for (let l = 0; l < 3; l++) for (let i = 0; i < 6 - l; i++) {
    box(k.b(M.metal), -24.8 + i * 0.22 + l * 0.11, G + 0.12 + l * 0.12, 15.0, 0.16, 0.12, 4.4, '#56636f');
  }
  for (let i = 0; i < 5; i++) {
    const ex = -16.0 + (r() - 0.5) * 0.3, ez = 14.2 + i * 0.3;
    box(k.b(M.form), ex, G, ez, 0.3, 0.3, 0.22, '#ffffff');
  }
  const g = k.into(new THREE.Group());
  g.userData.pick = { type: 'acopio', id: 'moldaje-muro' };
  return { group: g, anchor: new THREE.Vector3(-17.7, top, 15.15) };
}

/** Moldaje de losa: paquetes de vigas H20 amarillas y pilas de placas fenólicas. */
function buildMoldajeLosa(M: Mats) {
  const k = new Kit();
  const r = rng(12);
  const bundles: [number, number, number, number][] = [
    [17.6, 12.5, 2.9, 5], [17.6, 13.75, 2.9, 4], [17.35, 15.0, 2.45, 3],
  ];
  let top = G;
  for (const [bx, bz, L, layers] of bundles) {
    sleepers(k.b(M.rough), bx, bz, 1.0, 'x', [-L / 2 + 0.4, L / 2 - 0.4]);
    for (let l = 0; l < layers; l++) {
      for (let i = 0; i < 10; i++) {
        const z = bz - 0.43 + i * 0.096, dx = (r() - 0.5) * 0.06;
        const y = G + 0.12 + l * 0.2;
        box(k.b(M.paint), bx + dx, y + 0.16, z, L, 0.04, 0.08, COL.yellow);
        box(k.b(M.paint), bx + dx, y + 0.04, z, L - 0.02, 0.12, 0.03, '#e5a800');
        box(k.b(M.paint), bx + dx, y, z, L, 0.04, 0.08, COL.yellow);
        for (const e of [-1, 1]) box(k.b(M.paint), bx + dx + e * (L / 2 - 0.04), y, z, 0.08, 0.2, 0.082, '#c0392b');
      }
    }
    for (const s of [-1, 1]) box(k.b(M.paint), bx + s * L * 0.3, G + 0.11, bz, 0.04, layers * 0.2 + 0.02, 0.98, '#1d1f22');
    if (bz === 13.75) top = G + 0.12 + layers * 0.2;
  }
  const stacks: [number, number, number][] = [[20.75, 12.45, 3], [20.75, 13.85, 4], [20.75, 15.25, 2]];
  for (const [sx, sz, n] of stacks) {
    sleepers(k.b(M.rough), sx, sz, 1.3, 'x', [-0.9, 0, 0.9]);
    for (let i = 0; i < n; i++) {
      part(k.b(M.ply), GEO.box, sx + (r() - 0.5) * 0.06, G + 0.12 + i * 0.13 + 0.065, sz + (r() - 0.5) * 0.05, 2.44, 0.13, 1.22, i % 2 ? '#ffffff' : '#f0e6e0', { ry: (r() - 0.5) * 0.02 });
    }
  }
  // pallets con accesorios (cabezales, crucetas)
  palletStack(k.b(M.rough), 23.3, 12.6, 0.1, 4, r);
  palletStack(k.b(M.rough), 23.3, 14.2, -0.05, 2, r);
  for (let i = 0; i < 12; i++) part(k.b(M.paint), GEO.cyl, 23.0 + (i % 4) * 0.22, G + 0.42, 14.0 + Math.floor(i / 4) * 0.22, 0.12, 0.3, 0.12, '#e0b100');
  const g = k.into(new THREE.Group());
  g.userData.pick = { type: 'acopio', id: 'moldaje-losa' };
  return { group: g, anchor: new THREE.Vector3(17.6, top, 13.75) };
}

function palletStack(b: Batch, x: number, z: number, ry: number, n: number, r: () => number) {
  for (let i = 0; i < n; i++) {
    const f = frame(x + (r() - 0.5) * 0.06, z + (r() - 0.5) * 0.06, ry + (r() - 0.5) * 0.05);
    const y = G + i * 0.145;
    const c = r() > 0.5 ? '#b99568' : '#a7835a';
    for (const lz of [-0.42, 0, 0.42]) {
      const [px, pz] = f(0, lz);
      box(b, px, y, pz, 1.2, 0.1, 0.1, '#8d6b47', { ry });
    }
    for (let j = 0; j < 5; j++) {
      const [px, pz] = f(-0.5 + j * 0.25, 0);
      box(b, px, y + 0.1, pz, 0.14, 0.024, 1.0, c, { ry });
    }
  }
}

/** Acopio de fierro: paquetes de barras sobre durmientes, mallas y armaduras armadas. */
function buildFierro(M: Mats) {
  const k = new Kit();
  const r = rng(13);
  const rust = ['#8a4a2b', '#7b4127', '#955637', '#6f3b24'];
  const b = k.b(M.rough);
  const z0 = 6.6, z1 = 15.4;
  sleepers(b, 32.6, 11, 4.2, 'z', [z0 + 0.6 - 11, 0, z1 - 0.6 - 11]);
  let top = G;
  for (let i = 0; i < 5; i++) {
    const cx = 31.0 + i * 0.78, d = 0.022 + (i % 3) * 0.006, col = rust[i % 4];
    const per = Math.floor(0.5 / (d + 0.008)), layers = 3 + (i % 2);
    for (let l = 0; l < layers; l++) for (let j = 0; j < per - l; j++) {
      const x = cx - 0.25 + (j + l * 0.5) * (d + 0.008), y = G + 0.12 + l * d * 0.9;
      const o = (r() - 0.5) * 0.4;
      box(b, x, y, (z0 + z1) / 2 + o, d, d, z1 - z0 - Math.abs(o), col);
    }
    top = Math.max(top, G + 0.12 + layers * d);
  }
  // mallas electrosoldadas apiladas
  sleepers(b, 36.1, 9.5, 2.8, 'z', [-2, 0, 2]);
  for (let s = 0; s < 4; s++) {
    const y = G + 0.12 + s * 0.035, ox = (r() - 0.5) * 0.1, oz = (r() - 0.5) * 0.1;
    for (let i = 0; i <= 17; i++) box(b, 34.85 + ox + i * 0.15, y, 9.5 + oz, 0.012, 0.012, 5, rust[s % 4]);
    for (let i = 0; i <= 33; i++) box(b, 36.1 + ox, y + 0.012, 7.0 + oz + i * 0.15, 2.6, 0.012, 0.012, rust[(s + 1) % 4]);
  }
  // armaduras de pilares/vigas ya armadas
  for (let c = 0; c < 2; c++) {
    const cx = 35.6 + c * 1.0, cz0 = 12.6, cz1 = 16.0, y0 = G + 0.15, s = 0.3;
    for (const [ox, oy] of [[0, 0], [s, 0], [0, s], [s, s]]) box(b, cx + ox, y0 + oy, (cz0 + cz1) / 2, 0.022, 0.022, cz1 - cz0, '#7d4428');
    for (let zz = cz0 + 0.1; zz < cz1; zz += 0.2) {
      box(b, cx + s / 2, y0, zz, s + 0.02, 0.01, 0.01, '#8c4f30');
      box(b, cx + s / 2, y0 + s, zz, s + 0.02, 0.01, 0.01, '#8c4f30');
      box(b, cx, y0, zz, 0.01, s, 0.01, '#8c4f30');
      box(b, cx + s, y0, zz, 0.01, s, 0.01, '#8c4f30');
    }
    for (const zz of [cz0 + 0.5, cz1 - 0.5]) box(b, cx + s / 2, G, zz, 0.6, 0.15, 0.12, COL.sleeper);
  }
  const g = k.into(new THREE.Group());
  g.userData.pick = { type: 'acopio', id: 'fierro' };
  return { group: g, anchor: new THREE.Vector3(32.6, top, 11) };
}

/** Taller de fierro: cobertizo abierto, banco de doblado, cizalla y racks de barras. */
function buildTaller(M: Mats) {
  const k = new Kit();
  const T = SITE.tallerFierro;
  const r = rng(14);
  const x0 = T.x - 4, x1 = T.x + 4, zb = T.z - 3.6, zf = T.z + 2.4;
  for (const x of [x0, T.x, x1]) for (const z of [zb, zf]) box(k.b(M.rough), x, G, z, 0.15, z === zf ? 3.4 : 3.0, 0.15, COL.timber);
  for (const z of [zb, zf]) box(k.b(M.rough), T.x, G + (z === zf ? 3.25 : 2.85), z, x1 - x0 + 0.3, 0.16, 0.12, COL.timberDark);
  roofSheet(k.b(M.sheet), T.x, (zb + zf) / 2, 0, x1 - x0 + 0.8, zf - zb + 0.8, G + 2.95, 0.45, COL.zinc);
  // banco de doblado
  const by = G + 0.9, bz = T.z - 1.0;
  box(k.b(M.metal), T.x, by - 0.06, bz, 6.2, 0.06, 0.9, '#4a545d');
  for (const lx of [-3, -1, 1, 3]) for (const lz of [-0.4, 0.4]) box(k.b(M.metal), T.x + lx, G, bz + lz, 0.07, 0.84, 0.07, '#3a4249');
  // dobladora y cizalla
  box(k.b(M.paint), T.x - 2.2, by, bz, 0.8, 0.45, 0.75, '#2f6db3');
  part(k.b(M.metal), GEO.cyl, T.x - 2.2, by + 0.5, bz, 0.55, 0.08, 0.55, '#c9cfd4');
  for (const a of [0, 2.1, 4.2]) part(k.b(M.metal), GEO.cyl, T.x - 2.2 + Math.cos(a) * 0.18, by + 0.6, bz + Math.sin(a) * 0.18, 0.05, 0.14, 0.05, '#2a2e33');
  box(k.b(M.paint), T.x + 3.0, G, T.z - 3.0, 1.2, 0.85, 0.7, COL.orange);
  box(k.b(M.metal), T.x + 3.0, G + 0.85, T.z - 3.0, 0.5, 0.25, 0.4, '#3a4249');
  // barras sobre el banco
  for (let i = 0; i < 9; i++) box(k.b(M.rough), T.x + 0.4 + (r() - 0.5) * 0.4, by, bz - 0.3 + i * 0.07, 3.6 + r() * 1.5, 0.018, 0.018, COL.rust);
  // rack de barras (dos niveles) al fondo
  for (const lx of [-3.4, -1.1, 1.1, 3.4]) {
    box(k.b(M.metal), T.x + lx, G, zf - 0.6, 0.08, 1.5, 0.08, '#3a4249');
    for (const yy of [0.6, 1.3]) box(k.b(M.metal), T.x + lx, G + yy, zf - 0.6, 0.06, 0.06, 0.9, '#3a4249');
  }
  for (const yy of [0.66, 1.36]) for (let i = 0; i < 16; i++) {
    box(k.b(M.rough), T.x + (r() - 0.5) * 0.4, G + yy + (i % 2) * 0.02, zf - 0.95 + i * 0.045, 7.6, 0.02, 0.02, ['#8a4a2b', '#7b4127', '#955637'][i % 3]);
  }
  // estribos ya doblados (lazos rectangulares) en pilas
  for (let p = 0; p < 2; p++) for (let i = 0; i < 14; i++) {
    const ex = T.x + 0.2 + p * 0.9, ez = T.z - 3.2, y = G + 0.02 + i * 0.022, s = 0.4;
    const c = '#8c4f30', o = (r() - 0.5) * 0.04;
    box(k.b(M.rough), ex + o, y, ez - s / 2, s, 0.012, 0.012, c);
    box(k.b(M.rough), ex + o, y, ez + s / 2, s, 0.012, 0.012, c);
    box(k.b(M.rough), ex + o - s / 2, y, ez, 0.012, 0.012, s, c);
    box(k.b(M.rough), ex + o + s / 2, y, ez, 0.012, 0.012, s, c);
  }
  // barras cortadas en el suelo, fuera del cobertizo
  sleepers(k.b(M.rough), T.x + 1, T.z + 3.55, 1.0, 'x', [-1, 1]);
  for (let i = 0; i < 26; i++) box(k.b(M.rough), T.x + 1 + (r() - 0.5) * 2.4, G + 0.12 + Math.floor(i / 13) * 0.02, T.z + 3.25 + (i % 13) * 0.05, 1.5 + r() * 2.2, 0.02, 0.02, COL.rust);
  const g = k.into(new THREE.Group());
  g.userData.pick = { type: 'acopio', id: 'taller' };
  return { group: g };
}

/** Puntales metálicos rojos apilados (tubo exterior rojo, interior galvanizado, placas). */
function buildPuntales(M: Mats) {
  const k = new Kit();
  const A = SITE.acopioPuntales;
  // la grúa engancha en la pila más alta (la última)
  let top = G;
  const piles: [number, number][] = [[A.x - 1.25, A.z - 2], [A.x + 1.25, A.z - 2], [A.x - 1.25, A.z + 2], [A.x + 1.25, A.z + 2]];
  piles.forEach(([px, pz], pi) => {
    sleepers(k.b(M.rough), px, pz, 2.0, 'z', [-1.0, 1.0]);
    const layers = 4 + (pi % 2) * 2, dd = 0.075;
    for (let l = 0; l < layers; l++) {
      const n = 12 - l;
      for (let i = 0; i < n; i++) {
        const x = px - ((n - 1) * dd) / 2 + i * dd, y = G + 0.12 + 0.035 + l * 0.065;
        const flip = (i + l) % 2 ? 1 : -1, z0 = pz - 1.55 * flip;
        rod(k.b(M.paint), GEO.tube, x, y, z0, x, y, z0 + 1.9 * flip, 0.06, COL.red);
        rod(k.b(M.metal), GEO.tube, x, y, z0 + 1.9 * flip, x, y, z0 + 3.1 * flip, 0.045, '#c3c9ce');
        box(k.b(M.metal), x, y - 0.06, z0 - 0.005 * flip, 0.13, 0.13, 0.01, '#5d6a74');
      }
      top = G + 0.12 + 0.035 + l * 0.065 + 0.07; // cara superior de las placas base
    }
  });
  const g = k.into(new THREE.Group());
  g.userData.pick = { type: 'acopio', id: 'puntales' };
  const [ax, az] = piles[piles.length - 1];
  return { group: g, anchor: new THREE.Vector3(ax, top, az) };
}

// ---------------------------------------------------------------------------------------
// Elementos sueltos: generador, rollos de tubería, conos, pallets, batea, áridos, autos
// ---------------------------------------------------------------------------------------

function coil(b: Batch, x: number, y: number, z: number, R: number, color: string, h = 0.24) {
  part(b, GEO.torus, x, y + h / 2, z, 2 * R, 2 * R, h / 0.2, color, { rx: Math.PI / 2 });
}

function cone(b: Batch, x: number, z: number) {
  box(b, x, G, z, 0.38, 0.04, 0.38, '#1d1f22');
  part(b, GEO.cone, x, G + 0.04 + 0.34, z, 0.32, 0.68, 0.32, COL.orange);
  part(b, GEO.cyl, x, G + 0.4, z, 0.17, 0.1, 0.17, '#f4f4f4');
}

function car(k: Kit, M: Mats, x: number, z: number, ry: number, color: string, pickup = false) {
  const f = frame(x, z, ry), p = k.b(M.paint);
  const L = pickup ? 5.2 : 4.3, Wd = pickup ? 1.85 : 1.76;
  // carrocería, parachoques/faldón oscuro y cabina de vidrio en tronco de pirámide con techo
  box(p, x, G + 0.3, z, L, 0.5, Wd, color, { ry });
  box(p, x, G + 0.2, z, L + 0.06, 0.22, Wd - 0.04, '#2b2f33', { ry });
  const [cx, cz] = f(pickup ? 0.75 : -0.2, 0);
  const cl = pickup ? 1.9 : 2.45, cw = Wd - 0.08;
  part(k.b(M.glass), GEO.cabin, cx, G + 0.8 + 0.26, cz, cl, 0.52, cw, 0, { ry });
  box(p, cx, G + 1.32, cz, cl * CABIN_TOP + 0.06, 0.06, cw * 0.86 + 0.04, color, { ry });
  if (pickup) {
    const [bx, bz] = f(-1.35, 0);
    for (const s of [-1, 1]) {
      const [sx, sz] = f(-1.35, s * (Wd / 2 - 0.04));
      box(p, sx, G + 0.8, sz, 2.3, 0.3, 0.06, color, { ry });
    }
    const [tx, tz] = f(-2.47, 0);
    box(p, tx, G + 0.8, tz, 0.06, 0.3, Wd, color, { ry });
    box(k.b(M.rough), bx, G + 0.8, bz, 2.2, 0.015, Wd - 0.12, '#2b2b2b', { ry });
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const [wx, wz] = f(sx * (L / 2 - 0.85), sz * (Wd / 2 - 0.1));
    part(p, GEO.cyl, wx, G + 0.33, wz, 0.66, 0.24, 0.66, '#1b1d20', { ry, rx: Math.PI / 2 });
  }
  for (const sz of [-1, 1]) {
    const [hx, hz] = f(L / 2 + 0.01, sz * 0.6);
    box(p, hx, G + 0.6, hz, 0.04, 0.12, 0.32, '#f1f3f5', { ry });
    const [tx, tz] = f(-L / 2 - 0.01, sz * 0.62);
    box(p, tx, G + 0.6, tz, 0.04, 0.12, 0.28, '#b3261e', { ry });
  }
}

function buildMisc(k: Kit, M: Mats) {
  const r = rng(21);
  const p = k.b(M.paint);
  // generador amarillo bajo cobertizo y pañol de OSB, junto al edificio
  {
    const gx = -31.5, gz = -3.5;
    box(k.b(M.metal), gx, G, gz, 2.5, 0.14, 1.15, '#3a4249');
    box(p, gx, G + 0.14, gz, 2.3, 1.25, 1.05, COL.yellow);
    for (const s of [-1, 1]) box(k.b(M.metal), gx + 0.55, G + 0.45, gz + s * 0.53, 0.9, 0.7, 0.02, '#4a4f55');
    box(p, gx - 0.6, G + 0.8, gz + 0.535, 0.5, 0.3, 0.01, '#1d1f22');
    part(k.b(M.metal), GEO.cyl, gx + 0.8, G + 1.6, gz - 0.2, 0.1, 0.4, 0.1, '#2a2e33');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(k.b(M.rough), gx + sx * 1.5, G, gz + sz * 1.05, 0.1, sz > 0 ? 2.5 : 2.3, 0.1, COL.timber);
    roofSheet(k.b(M.sheet), gx, gz, 0, 3.6, 2.8, G + 2.3, 0.25, '#e6eaec');
    osbHut(k, M, -36.5, -4.5, 0, 3.2, 3.0, 2.3);
  }
  // rollos de tubería HDPE naranja y azul, junto al pie del talud
  const coils: [number, number, string, number][] = [
    [-39, -10.5, COL.orange, 3], [-37.4, -10.8, COL.orange, 2], [-38.3, -12.4, COL.blue, 2], [-36, -12.2, COL.orange, 1],
    [43, -10, COL.orange, 2], [44.6, -10.6, COL.blue, 3],
  ];
  for (const [cx, cz, c, n] of coils) for (let i = 0; i < n; i++) coil(p, cx + (r() - 0.5) * 0.15, G + i * 0.24, cz + (r() - 0.5) * 0.15, 0.62 - i * 0.02, c);
  // conos de seguridad
  const cones: V2[] = [
    [-30.5, 23.4], [-30.4, 25.6], [31.6, 24.6], [31.6, 26.8], [-50, 27.1], [-46, 27.1],
    [43, 22.9], [45.5, 22.9], [30, 4.4], [29.5, 6.2], [-24.3, 12.5], [-28.4, 18.2], [24.6, 17.4],
  ];
  for (const [cx, cz] of cones) cone(p, cx, cz);
  // pallets sueltos
  palletStack(k.b(M.rough), -32.4, 25.1, 0.2, 5, r);
  palletStack(k.b(M.rough), -32.2, 23.7, -0.1, 3, r);
  palletStack(k.b(M.rough), 41.5, 5.5, 0.3, 6, r);
  palletStack(k.b(M.rough), 41.6, 7.2, 0.1, 2, r);
  // batea de escombros
  {
    const bx = 49, bz = 21.2, L = 4.2, W = 2.0, H = 1.3, b = k.b(M.paint), c = '#e08a1e';
    box(b, bx, G, bz, L, 0.08, W, c);
    for (const s of [-1, 1]) {
      box(b, bx, G, bz + s * (W / 2 - 0.04), L, H, 0.08, c);
      box(b, bx + s * (L / 2 - 0.04), G, bz, 0.08, H, W, c);
    }
    for (let i = 0; i < 9; i++) box(k.b(M.rough), bx + (r() - 0.5) * 3, G + 0.1 + r() * 0.6, bz + (r() - 0.5) * 1.4, 0.4 + r() * 0.9, 0.08 + r() * 0.2, 0.2 + r() * 0.4, ['#8f8a80', '#9b7650', '#6d6a64', '#b7b2a8'][i % 4], { ry: r() * 3 });
  }
  // bodega en contenedor marítimo
  {
    const cx = 64.5, cz = 40.5;
    part(k.b(M.sheet), GEO.box, cx, G + 1.3, cz, 6.06, 2.59, 2.44, '#3f6b88', { uv: [1.1, 2.6] });
    box(p, cx - 3.04, G + 0.06, cz, 0.04, 2.47, 2.32, '#355a73');
    for (const s of [-0.55, -0.15, 0.15, 0.55]) box(k.b(M.metal), cx - 3.08, G + 0.2, cz + s, 0.05, 2.2, 0.05, '#9aa4ad');
  }
  // cancha de lavado de canoas de mixer (losa con muretes y lechada)
  {
    const cx = 61, cz = 28.5, b = k.b(M.rough);
    box(b, cx, G, cz, 4.4, 0.12, 3.4, '#a9a59d');
    box(b, cx + 0.2, G + 0.12, cz, 3.6, 0.02, 2.8, '#c9c6c0');
    box(b, cx + 2.1, G, cz, 0.2, 0.5, 3.4, '#9e9a92');
    for (const s of [-1, 1]) box(b, cx, G, cz + s * 1.6, 4.4, 0.5, 0.2, '#9e9a92');
  }
  // sacos de cemento sobre pallets (envueltos en film)
  for (let i = 0; i < 3; i++) {
    const cx = 44.6 + i * 1.35, cz = 1.5;
    palletStack(k.b(M.rough), cx, cz, Math.PI / 2, 1, r);
    box(p, cx, G + 0.15, cz, 0.95, 0.95, 1.12, '#dcd9d2');
    box(p, cx, G + 1.1, cz, 0.85, 0.02, 1.0, '#c8c4bb');
  }
  // acopio de áridos y excedentes de excavación
  const mounds: [number, number, number, number, number, string][] = [
    [56, 4, 9, 2.6, 7, '#cfae82'], [62, 13, 7, 2.0, 6, '#9e968a'], [60, -6, 8, 2.2, 6, '#c99266'],
  ];
  mounds.forEach(([mx, mz, sx, sy, sz, c], i) => part(k.b(M.ground), heapGeometry(i + 3), mx, G - 0.05, mz, sx, sy, sz, c, { ry: i, uv: 10 }));
  // postes de iluminación en las esquinas
  for (const [lx, lz, a] of [[FENCE.x0 + 1.5, FENCE.z1 - 1.5, -0.8], [FENCE.x1 - 1.5, FENCE.z1 - 1.5, -2.4], [FENCE.x1 - 1.5, -13.5, 2.4], [FENCE.x0 + 1.5, -13.5, 0.8]] as const) {
    part(k.b(M.metal), GEO.cyl, lx, G + 4.5, lz, 0.16, 9, 0.16, COL.galv);
    const f = frame(lx, lz, a);
    for (const s of [-0.35, 0.35]) {
      const [hx, hz] = f(0.25, s);
      box(p, hx, G + 8.7, hz, 0.4, 0.3, 0.5, '#2f353b', { ry: a });
    }
  }
  // autos de los trabajadores (estacionamiento junto al portón) y camionetas
  const colors = ['#e9ecef', '#9aa3ab', '#b3261e', '#23344d', '#2b2d30', '#d7dadd', '#5f6b75'];
  for (let i = 0; i < 7; i++) {
    const cx = SITE.gate.x + 8.5 + i * 2.7;
    car(k, M, cx, 39.6 + (r() - 0.5) * 0.4, Math.PI / 2 + (i % 3 === 1 ? Math.PI : 0) + (r() - 0.5) * 0.06, colors[i], i === 2 || i === 5);
  }
  car(k, M, -45, 24.6, 0.02, '#f2f3f4', true);
  car(k, M, ST_W + 2.9, 14, -Math.PI / 2, '#8d969e');
  car(k, M, ST_W + 2.9, 48, Math.PI / 2, '#c9ccd0');
  car(k, M, ST_W - 2.9, 64, -Math.PI / 2, '#3b4c63');
}

// ---------------------------------------------------------------------------------------
// Entorno: calles, veredas, casas y árboles
// ---------------------------------------------------------------------------------------

/** Calles asfaltadas y veredas (cortadas en los cruces y en el acceso a la obra). */
function buildStreets(asphalt: Batch, k: Kit, M: Mats) {
  const o = { width: 8, texLen: 16, step: 3 };
  TOWN.zSt.forEach((x, i) => ribbon(asphalt, [[x, -170], [x, TOWN.z1 + 25]], { ...o, lift: 0.04 + i * 0.003 }));
  TOWN.xSt.forEach((z, i) => ribbon(asphalt, [[ST_W + 4, z], [TOWN.x1 + 25, z]], { ...o, lift: 0.055 + i * 0.003 }));
  const b = k.b(M.rough);
  const walk = (along: 'x' | 'z', c: number, a: number, e: number, cuts: number[]) => {
    let s0 = a;
    for (const cut of [...cuts.filter((v) => v > a && v < e).sort((p, q) => p - q), e + 5]) {
      const s1 = cut - 5;
      if (s1 - s0 > 2) {
        const m = (s0 + s1) / 2, L = s1 - s0;
        for (const side of [-1, 1]) {
          const x = along === 'x' ? m : c + side * 5, z = along === 'x' ? c + side * 5 : m;
          box(b, x, heightAt(x, z) - 0.05, z, along === 'x' ? L : 2, 0.2, along === 'x' ? 2 : L, COL.concrete);
        }
      }
      s0 = cut + 5;
    }
  };
  for (const x of TOWN.zSt) walk('z', x, -10, TOWN.z1 + 20, x === ST_W ? [...TOWN.xSt, SITE.roadZ] : TOWN.xSt);
  for (const z of TOWN.xSt) walk('x', z, ST_W + 6, TOWN.x1 + 20, TOWN.zSt);
}

const WALLS = ['#f6f2ea', '#efe4cc', '#f3e7d3', '#ebe8e1', '#f1dcc0', '#f8f6f1'];
const ROOFS = ['#b4532f', '#a84a2a', '#c0613a', '#9d4630', '#b85b36'];

const DOORS = ['#6b4a33', '#7a5638', '#f2efe8', '#4f3526'];

function house(fac: Batch, tile: Batch, paint: Batch, x: number, z: number, ry: number, r: () => number) {
  const w = 7.2 + r() * 1.6, d = 8 + r() * 1.5, h = 5.6 + (r() - 0.5) * 0.4;
  const y0 = heightAt(x, z) - 0.4;
  const wall = WALLS[Math.floor(r() * WALLS.length)], roof = ROOFS[Math.floor(r() * ROOFS.length)];
  const f = frame(x, z, ry);
  part(fac, GEO.box, x, y0 + h / 2, z, w, h, d, wall, { ry });
  hipRoof(tile, x, z, y0 + h, w + 0.8, d + 0.8, 1.9 + r() * 0.5, ry, roof);
  // puerta y alero de acceso hacia el antejardín (+z local)
  const [dx, dz] = f(0, d / 2 + 0.03), gy = heightAt(dx, dz);
  box(paint, dx, gy - 0.05, dz, 1.0, 2.25, 0.08, DOORS[Math.floor(hash(Math.round(x), Math.round(z), 7) * DOORS.length)], { ry });
  const [cx, cz] = f(0, d / 2 + 0.45);
  box(paint, cx, gy + 2.32, cz, 1.6, 0.08, 0.9, '#d9d4cb', { ry });
  if (r() > 0.45) {
    // ampliación de un piso hacia el patio
    const s = r() > 0.5 ? 1 : -1;
    const [ax, az] = f(s * w * 0.2, -(d / 2 + 1.4));
    part(fac, GEO.box, ax, y0 + 1.5, az, w * 0.55, 3.0, 2.8, wall, { ry });
    hipRoof(tile, ax, az, y0 + 3.0, w * 0.55 + 0.6, 3.4, 0.9, ry, roof);
  }
}

function eucalyptus(b: Batch, x: number, z: number, H: number, r: () => number, branches = true) {
  const y = heightAt(x, z) - 0.2;
  const lx = (r() - 0.5) * 0.1, lz = (r() - 0.5) * 0.1;
  const tw = H / 22, bark = r() > 0.5 ? '#cfc6b4' : '#a89c88';
  part(b, GEO.trunk, x, y + H * 0.4, z, tw, H * 0.8, tw, bark, { rx: lz, rz: -lx });
  // copa rala: masas sueltas en la punta de ramas que salen del tronco
  const n = 4 + Math.floor(r() * 3);
  const ox = x + lx * H * 0.35, oz = z + lz * H * 0.35;
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = H * (0.05 + r() * 0.13), cr = H * (0.07 + r() * 0.05);
    const cx = ox + Math.cos(a) * d, cz = oz + Math.sin(a) * d, cy = y + H * (0.66 + (r() - 0.3) * 0.28);
    if (branches) rod(b, GEO.twig, x + lx * H * 0.15, y + H * 0.52, z + lz * H * 0.15, cx, cy - cr * 0.4, cz, tw * 0.28, bark);
    const c = ['#5b6d47', '#66774f', '#52653f', '#718057', '#5f704e'][Math.floor(r() * 5)];
    part(b, GEO.blob, cx, cy, cz, cr * 2.6, cr * 1.9, cr * 2.6, c, { ry: r() * 6, rx: (r() - 0.5) * 0.8, jitter: 0.5, seed: Math.floor(r() * 1e6) });
  }
}

function pine(b: Batch, x: number, z: number, H: number, r: () => number) {
  const y = heightAt(x, z) - 0.2;
  part(b, GEO.trunk, x, y + H * 0.3, z, H * 0.04, H * 0.6, H * 0.04, '#6b5440');
  for (let i = 0; i < 4; i++) {
    const t = 0.45 + i * 0.14, cr = H * (0.22 - i * 0.035);
    const c = ['#34503a', '#3c573c', '#2f4a36'][Math.floor(r() * 3)];
    part(b, GEO.blob, x + (r() - 0.5) * 1.2, y + H * t, z + (r() - 0.5) * 1.2, cr * 2.3, cr * 1.5, cr * 2.3, c, { ry: r() * 6, jitter: 0.45, seed: Math.floor(r() * 1e6) });
  }
}

function roundTree(b: Batch, x: number, z: number, H: number, r: () => number) {
  const y = heightAt(x, z) - 0.1;
  part(b, GEO.trunk, x, y + H * 0.25, z, 0.3, H * 0.5, 0.3, '#6b5440');
  const n = 1 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const cr = H * (0.3 + r() * 0.1);
    const c = ['#5f8240', '#6c8e48', '#557a3a', '#7a9650'][Math.floor(r() * 4)];
    part(b, GEO.blob, x + (r() - 0.5) * 1.4, y + H * (0.62 + i * 0.15), z + (r() - 0.5) * 1.4, cr * 2, cr * 1.8, cr * 2, c, { ry: r() * 6, jitter: 0.35, seed: Math.floor(r() * 1e6) });
  }
}

/** Barrio, bosques y lomas. Lo cercano proyecta sombras; lo lejano no (va en otra malla). */
function buildSurroundings(M: Mats, group: THREE.Group) {
  const near = new Kit(), far = new Kit();
  const r = rng(31);
  const isNear = (x: number, z: number) => Math.hypot(x - 1, z - 10) < 115;
  const kit = (x: number, z: number) => (isNear(x, z) ? near : far);
  const onStreet = (x: number, z: number) => TOWN.zSt.some((X) => Math.abs(x - X) < 7) || TOWN.xSt.some((Z) => Math.abs(z - Z) < 7 && x > ST_W);
  const addHouse = (x: number, z: number, ry: number) => {
    const k = kit(x, z);
    house(k.b(M.facade), k.b(M.tile), k.b(M.paint), x, z, ry, r);
    if (r() > 0.4) {
      const gx = x + (r() - 0.5) * 6, gz = z + (r() - 0.5) * 6;
      const f = frame(gx, gz, ry);
      const [tx, tz] = f(0, 7.5);
      roundTree(k.b(M.foliage), tx, tz, 4 + r() * 3, r);
    }
  };
  // filas a ambos lados de las calles en x (la primera fila de la calle 56 sería la obra)
  for (const zc of TOWN.xSt) for (const side of [-1, 1]) {
    const zr = zc + side * 15;
    if (zr < FENCE.z1 + 6) continue;
    for (let x = ST_W + 10 + (side < 0 ? 5.5 : 0); x < TOWN.x1; x += 11.5) {
      if (TOWN.zSt.some((X) => Math.abs(x - X) < 9)) continue;
      addHouse(x, zr + (r() - 0.5) * 0.6, side > 0 ? Math.PI : 0);
    }
  }
  // filas junto a las calles en z: poniente (todo el largo) y oriente (frente a la obra)
  // (ry = π/2 deja el antejardín hacia +x)
  for (const [xr, ry, z1] of [[-156, -Math.PI / 2, TOWN.z1], [-133, Math.PI / 2, TOWN.z1], [-103, -Math.PI / 2, TOWN.z1], [-79, Math.PI / 2, TOWN.z1],
    [97, -Math.PI / 2, 48], [120, Math.PI / 2, 48], [145, Math.PI / 2, 48], [175, -Math.PI / 2, 48], [198, Math.PI / 2, 48]] as const) {
    for (let z = -4 + (Math.abs(xr) % 2) * 5; z < z1; z += 11.5) addHouse(xr, z, ry);
  }
  // bosque de eucaliptos y pinos sobre el talud (oriente)
  for (let i = 0; i < 230; i++) {
    const x = -150 + r() * 330, z = FENCE.z0 - 4 - Math.pow(r(), 1.6) * 120, H = r();
    if (onStreet(x, z)) continue;
    const b = kit(x, z).b(M.foliage);
    if (r() > 0.3) eucalyptus(b, x, z, 15 + H * 12, r, isNear(x, z));
    else pine(b, x, z, 12 + H * 8, r);
  }
  // lomas lejanas con manchones de bosque (sin sombras)
  for (let i = 0; i < 1800; i++) {
    const x = -460 + r() * 920, z = -460 + r() * 920;
    const inTown = x > TOWN.x0 - 8 && x < TOWN.x1 + 8 && z > -14 && z < TOWN.z1 + 8;
    const inNear = x > -150 && x < 180 && z > -150 && z < -14;
    if (inTown || inNear || onStreet(x, z) || fbm(x * 0.012, z * 0.012, 2, 41) < 0.46) continue;
    if (r() > 0.35) eucalyptus(far.b(M.foliage), x, z, 16 + r() * 12, r, false);
    else pine(far.b(M.foliage), x, z, 12 + r() * 8, r);
  }
  // eucaliptos sueltos junto al cierro
  for (const [tx, tz] of [[-57.3, -6], [-57.3, 5], [74, -6]] as const) eucalyptus(near.b(M.foliage), tx, tz, 16 + r() * 6, r);
  near.into(group);
  far.into(group, false);
}

// ---------------------------------------------------------------------------------------
// Ensamble
// ---------------------------------------------------------------------------------------

export function createSite(): SiteRig {
  const M = createMaterials();
  const group = new THREE.Group();
  group.name = 'faena';

  const terrain = buildTerrain(M.ground);
  group.add(terrain.mesh, buildCutFace(terrain, M.cut));

  // caminos de ripio, explanadas y calles del barrio
  const roads = new Batch(true), pads = new Batch(true), asphalt = new Batch(false);
  const F = SITE.faena;
  const padAt = (x: number, z: number, w: number, d: number, alpha = 1) =>
    ribbon(pads, [[x - w / 2, z], [x + w / 2, z]], { width: d, texLen: 6, uRep: d / 6, fade: 0.8, alpha, lift: 0.02 });
  padAt(F.x, F.z + 1, F.w + 2, F.d + 3);
  padAt(SITE.gate.x + 14, 39.6, 22, 9.5);
  padAt(SITE.pump.x, (10.5 + SITE.loopZ + 1.5) / 2, 7, SITE.loopZ + 1.5 - 10.5);
  padAt(50, SITE.roadZ, 13, 15);
  for (const A of [SITE.acopioMoldajeMuro, SITE.acopioMoldajeLosa, SITE.acopioFierro, SITE.tallerFierro, SITE.acopioPuntales]) padAt(A.x, A.z, A.w + 1.5, A.d + 1.5, 0.75);
  ribbon(roads, [[SITE.loopX0, SITE.roadZ], [SITE.loopX0, SITE.loopZ], [SITE.loopX1, SITE.loopZ], [SITE.loopX1, SITE.roadZ]], { width: 5, texLen: 12, radius: 6, fade: 0.6, step: 2 });
  // el acceso parte en el borde de la calzada exterior (no se pinta ripio sobre el asfalto)
  ribbon(roads, [[ST_W + 4.3, SITE.roadZ], [52, SITE.roadZ]], { width: 7, texLen: 12, uRep: 2, fade: 0.6, step: 4, lift: 0.035 });
  const decals: [Batch, THREE.Material, number][] = [[pads, M.pad, -3], [roads, M.road, -2]];
  for (const [b, m, order] of decals) {
    const mesh = new THREE.Mesh(b.build()!, m);
    mesh.receiveShadow = true;
    mesh.renderOrder = order;
    group.add(mesh);
  }

  const k = new Kit();
  buildStreets(asphalt, k, M);
  const street = new THREE.Mesh(asphalt.build()!, M.asphalt);
  street.receiveShadow = true;
  group.add(street);

  const beacons = new Batch(false);
  buildFences(k, M);
  buildGate(k, M, beacons);
  buildProjectBoard(k, M, group);
  buildMisc(k, M);
  k.into(group);
  const beaconMesh = new THREE.Mesh(beacons.build()!, M.beacon);
  group.add(beaconMesh);

  // faena (seleccionable) con letrero y bandera
  const faena = buildFaena(M).into(new THREE.Group());
  faena.userData.pick = { type: 'faena' };
  const sk = new Kit();
  buildSafetySign(sk, M, faena);
  sk.into(faena);
  const flagGeo = new THREE.PlaneGeometry(2.1, 1.4, 14, 6);
  flagGeo.translate(1.05, 0, 0);
  const flagRest = Float32Array.from(flagGeo.attributes.position.array);
  const flag = new THREE.Mesh(flagGeo, M.flag);
  flag.position.set(F.x - F.w / 2 + 17.5, G + 7.2, F.z + F.d / 2 + 1.5);
  flag.rotation.y = -0.4;
  flag.castShadow = true;
  faena.add(flag);
  group.add(faena);

  const muro = buildMoldajeMuro(M), losa = buildMoldajeLosa(M), fierro = buildFierro(M), puntales = buildPuntales(M), taller = buildTaller(M);
  group.add(muro.group, losa.group, fierro.group, puntales.group, taller.group);

  buildSurroundings(M, group);

  // la selección también funciona sobre cada malla hija
  const pickables = [muro.group, losa.group, fierro.group, puntales.group, taller.group, faena];
  for (const p of pickables) p.traverse((o) => (o.userData.pick = p.userData.pick));

  const pos = flagGeo.attributes.position as THREE.BufferAttribute;
  return {
    group,
    pickables,
    anchors: {
      acopioMoldajeMuro: muro.anchor,
      acopioMoldajeLosa: losa.anchor,
      acopioFierro: fierro.anchor,
      acopioPuntales: puntales.anchor,
    },
    heightAt,
    update(t: number) {
      // bandera flameando
      for (let i = 0; i < pos.count; i++) {
        const x = flagRest[i * 3], y = flagRest[i * 3 + 1];
        const a = x / 2.1;
        pos.setZ(i, Math.sin(x * 2.6 - t * 5.2 + y * 0.6) * 0.16 * a + Math.sin(x * 5.1 - t * 8.3) * 0.04 * a);
        pos.setY(i, y - a * a * 0.12);
      }
      pos.needsUpdate = true;
      flagGeo.computeVertexNormals();
      // balizas del portón: destello doble cada 1,2 s
      const ph = (t % 1.2) / 1.2;
      M.beacon.emissiveIntensity = ph < 0.08 || (ph > 0.16 && ph < 0.24) ? 3.2 : 0.35;
    },
  };
}
