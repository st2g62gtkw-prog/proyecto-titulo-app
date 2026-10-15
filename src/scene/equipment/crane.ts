/**
 * Grúa torre "PINGON" (cabeza de martillo con torreta / cat-head y tirantes).
 *
 * Origen del grupo = centro de la base del mástil a nivel de terreno (y = 0).
 * Las piezas que giran se construyen con la pluma hacia +x local; setPose() las orienta
 * para que la pluma apunte a (cos(slew), 0, sin(slew)).
 * Toda la estructura reticulada se fusiona en pocas mallas (una por material y parte móvil).
 */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface CraneOptions {
  mastHeight: number;
  jibLength: number;
  counterJibLength: number;
}

export interface CraneRig {
  /** Origen = centro de la base del mástil a nivel de terreno. No se rota. */
  group: THREE.Group;
  /** slew: dirección de la pluma (cos, 0, sin); trolley: radio del carro [m]; hookY: altura local del gancho. */
  setPose(slew: number, trolley: number, hookY: number): void;
  /** Punto de enganche; las cargas se agregan como hijos y cuelgan hacia -y. Conserva la orientación del grupo. */
  hook: THREE.Object3D;
  /** y local de la cara inferior del cordón inferior de la pluma. */
  readonly jibHeight: number;
  update(t: number, dt: number): void;
  pickables: THREE.Object3D[];
  /** Altura máxima admitida para hookY (el motón queda justo bajo el carro). */
  readonly maxHookY: number;
  /** Intensidad del leve balanceo de la carga al acelerar (0 = sin balanceo). */
  swing: number;
}

// ───────────────────────────── geometría ─────────────────────────────

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Junta cajas, barras y cilindros en una sola BufferGeometry (atributos estándar). */
class Parts {
  private geos: THREE.BufferGeometry[] = [];
  private m = new THREE.Matrix4();

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    this.m.makeScale(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
    this.m.setPosition((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.geos.push(UNIT_BOX.clone().applyMatrix4(this.m));
    return this;
  }

  /** Perfil de sección w × h entre dos puntos. */
  bar(a: THREE.Vector3, b: THREE.Vector3, w: number, h = w) {
    const d = b.clone().sub(a);
    const len = d.length();
    if (len < 1e-4) return this;
    const ux = d.divideScalar(len);
    const ref = Math.abs(ux.y) > 0.95 ? v(1, 0, 0) : v(0, 1, 0);
    const uz = new THREE.Vector3().crossVectors(ux, ref).normalize();
    const uy = new THREE.Vector3().crossVectors(uz, ux);
    this.m.makeBasis(ux, uy, uz).scale(v(len, h, w)).setPosition(a.clone().add(b).multiplyScalar(0.5));
    this.geos.push(UNIT_BOX.clone().applyMatrix4(this.m));
    return this;
  }

  cyl(r: number, len: number, axis: 'x' | 'y' | 'z', x: number, y: number, z: number, seg = 12) {
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    else if (axis === 'z') g.rotateX(Math.PI / 2);
    return this.geo(g.translate(x, y, z));
  }

  geo(g: THREE.BufferGeometry) {
    this.geos.push(g);
    return this;
  }

  build() {
    const g = mergeGeometries(this.geos, false);
    this.geos.forEach((p) => p.dispose());
    this.geos = [];
    g.computeBoundingSphere();
    return g;
  }
}

/** Plano con las UV recortadas a una región (px) del atlas de letreros. */
function atlasPlane(w: number, h: number, r: { x: number; y: number; w: number; h: number }) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (r.x + uv.getX(i) * r.w) / ATLAS_W, 1 - (r.y + (1 - uv.getY(i)) * r.h) / ATLAS_H);
  }
  return g;
}

// ───────────────────────────── texturas ─────────────────────────────

function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Pseudoaleatorio con semilla: la textura OSB sale igual en cada carga. */
function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

const ATLAS_W = 1024;
const ATLAS_H = 512;
const SIGN_PINGON = { x: 0, y: 0, w: 1024, h: 150 };
const SIGN_FENCE = { x: 0, y: 192, w: 512, h: 300 };

function signAtlas() {
  return canvasTexture(ATLAS_W, ATLAS_H, (c) => {
    // placa de marca en la contrapluma
    c.fillStyle = '#f4f4f1';
    c.fillRect(0, 0, 1024, 150);
    c.strokeStyle = '#2a2f36';
    c.lineWidth = 6;
    c.strokeRect(5, 5, 1014, 140);
    c.fillStyle = '#c4232b';
    c.beginPath();
    c.moveTo(60, 110); c.lineTo(110, 40); c.lineTo(160, 110); c.closePath();
    c.fill();
    c.fillStyle = '#1f2630';
    c.font = 'bold 104px Arial, Helvetica, sans-serif';
    c.textBaseline = 'middle';
    c.textAlign = 'center';
    c.fillText('P I N G O N', 560, 80);
    // letrero de seguridad en el cerco de la base
    const y = 192;
    c.fillStyle = '#ffffff';
    c.fillRect(0, y, 512, 300);
    c.fillStyle = '#c62026';
    c.fillRect(0, y, 512, 96);
    c.fillStyle = '#ffffff';
    c.font = 'bold 66px Arial, Helvetica, sans-serif';
    c.fillText('PELIGRO', 256, y + 50);
    c.fillStyle = '#1c232b';
    c.font = 'bold 44px Arial, Helvetica, sans-serif';
    c.fillText('ZONA DE GRÚA', 256, y + 140);
    c.font = '30px Arial, Helvetica, sans-serif';
    c.fillText('No pasar bajo carga', 256, y + 200);
    c.fillText('suspendida', 256, y + 238);
    c.strokeStyle = '#1c232b';
    c.lineWidth = 8;
    c.strokeRect(4, y + 4, 504, 292);
  });
}

function stripesTexture() {
  const t = canvasTexture(64, 64, (c) => {
    c.fillStyle = '#f2b705';
    c.fillRect(0, 0, 64, 64);
    c.fillStyle = '#17191c';
    for (let i = -64; i < 128; i += 32) {
      c.beginPath();
      c.moveTo(i, 0); c.lineTo(i + 11, 0); c.lineTo(i + 11 + 64, 64); c.lineTo(i + 64, 64);
      c.closePath();
      c.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function osbTexture() {
  const r = rng(7);
  return canvasTexture(256, 256, (c) => {
    c.fillStyle = '#c9a36a';
    c.fillRect(0, 0, 256, 256);
    const tones = ['#b58c55', '#dcbb86', '#a57b45', '#e3c793', '#987040', '#cfa970'];
    for (let i = 0; i < 1100; i++) {
      c.save();
      c.translate(r() * 256, r() * 256);
      c.rotate(r() * Math.PI);
      c.globalAlpha = 0.35 + r() * 0.45;
      c.fillStyle = tones[(r() * tones.length) | 0];
      c.fillRect(-7, -2, 6 + r() * 14, 2 + r() * 5);
      c.restore();
    }
  });
}

function glowTexture() {
  return canvasTexture(64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,90,70,1)');
    g.addColorStop(0.25, 'rgba(255,40,30,0.55)');
    g.addColorStop(1, 'rgba(255,20,10,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
  });
}

// ───────────────────────────── piezas ─────────────────────────────

const MAST_HALF = 0.9; // mástil de 1,8 m
const CORNERS: [number, number][] = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
const FOOT_TOP = 0.08;
/** Altura del eje de la roldana del motón sobre el punto de enganche. */
const SHEAVE_Y = 1.25;

/** Mástil reticulado: 4 cordones, horizontales y diagonales en "N" por cara, uniones y escalera. */
function buildMast(red: Parts, steel: Parts, H: number) {
  const m = MAST_HALF;
  const ch = 0.17;
  for (const [sx, sz] of CORNERS) red.box(sx * m - ch / 2, FOOT_TOP, sz * m - ch / 2, sx * m + ch / 2, H, sz * m + ch / 2);
  const n = Math.max(2, Math.round((H - FOOT_TOP) / 1.8));
  const bay = (H - FOOT_TOP) / n;
  for (let k = 0; k <= n; k++) {
    const y = FOOT_TOP + k * bay;
    for (let f = 0; f < 4; f++) {
      const [ax, az] = CORNERS[f];
      const [bx, bz] = CORNERS[(f + 1) % 4];
      if (k > 0) red.bar(v(ax * m, y, az * m), v(bx * m, y, bz * m), 0.08);
      if (k < n) red.bar(v(ax * m, y, az * m), v(bx * m, y + bay, bz * m), 0.07);
    }
    // uniones entre tramos (cada 3 paños)
    if (k % 3 === 0 && k > 0 && k < n) {
      for (const [sx, sz] of CORNERS) red.box(sx * m - 0.14, y - 0.12, sz * m - 0.14, sx * m + 0.14, y + 0.12, sz * m + 0.14);
    }
  }
  // escalera interior junto a la cara -x
  const lx = -m + 0.32;
  steel.box(lx - 0.025, FOOT_TOP, -0.25, lx + 0.025, H, -0.2);
  steel.box(lx - 0.025, FOOT_TOP, 0.2, lx + 0.025, H, 0.25);
  for (let y = 0.4; y < H; y += 0.32) steel.box(lx - 0.02, y - 0.02, -0.22, lx + 0.02, y + 0.02, 0.22);
  // soporte de la corona de giro
  red.box(-1.0, H - 0.35, -1.0, 1.0, H, 1.0);
}

/** Fundación con lastre, tornapuntas y cerco de OSB alrededor (como en terreno). */
function buildBase(p: { steel: Parts; dark: Parts; footing: Parts; ballast: Parts; osb: Parts; soil: Parts; red: Parts; sign: Parts }) {
  const F = 2.95; // semiancho del cerco
  p.soil.box(-F, 0.005, -F, F, 0.025, F);
  p.footing.box(-2.4, -0.6, -2.4, 2.4, FOOT_TOP, 2.4);
  // pie del mástil
  p.red.box(-1.1, FOOT_TOP, -1.1, 1.1, FOOT_TOP + 0.22, 1.1);
  // bloques de lastre (dos hiladas) en las cuatro caras
  for (let s = 0; s < 4; s++) {
    const g = new THREE.Matrix4().makeRotationY((s * Math.PI) / 2);
    const blocks = new Parts();
    blocks.box(-1.25, FOOT_TOP, 1.05, 1.25, FOOT_TOP + 0.62, 2.0);
    blocks.box(-1.2, FOOT_TOP + 0.645, 1.08, 1.2, FOOT_TOP + 1.2, 1.97);
    p.ballast.geo(blocks.build().applyMatrix4(g));
    const eyes = new Parts();
    for (const x of [-0.6, 0.6]) eyes.geo(new THREE.TorusGeometry(0.09, 0.022, 4, 10).translate(x, FOOT_TOP + 1.22, 1.52));
    p.dark.geo(eyes.build().applyMatrix4(g));
  }
  // tornapuntas desde el mástil a las esquinas de la fundación
  for (const [sx, sz] of CORNERS) {
    const a = v(sx * MAST_HALF, 3.4, sz * MAST_HALF);
    const b = v(sx * 2.1, FOOT_TOP + 0.12, sz * 2.1);
    p.steel.bar(a, b, 0.16);
    p.steel.box(sx * 2.1 - 0.22, FOOT_TOP, sz * 2.1 - 0.22, sx * 2.1 + 0.22, FOOT_TOP + 0.1, sz * 2.1 + 0.22);
  }
  // cerco de placas OSB con pies derechos (abertura de acceso en +z)
  const H = 2.05;
  const sides: { a: [number, number]; b: [number, number] }[] = [
    { a: [-F, -F], b: [F, -F] }, { a: [F, -F], b: [F, F] }, { a: [F, F], b: [-F, F] }, { a: [-F, F], b: [-F, -F] },
  ];
  sides.forEach(({ a, b }, si) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.ceil(len / 1.22);
    const w = len / n;
    const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    const rot = new THREE.Matrix4().makeRotationY(-Math.atan2(uz, ux));
    for (let i = 0; i < n; i++) {
      if (si === 2 && i === 1) continue; // acceso
      const cx = a[0] + ux * (i + 0.5) * w, cz = a[1] + uz * (i + 0.5) * w;
      const board = new THREE.BoxGeometry(w - 0.015, H, 0.025).applyMatrix4(rot).translate(cx, H / 2 + 0.02, cz);
      p.osb.geo(board);
      const px = a[0] + ux * i * w, pz = a[1] + uz * i * w;
      p.osb.box(px - 0.045, 0, pz - 0.045, px + 0.045, H + 0.12, pz + 0.045);
    }
  });
  p.sign.geo(atlasPlane(0.9, 0.53, SIGN_FENCE).translate(0, 1.3, F + 0.02));
}

interface Dims { H: number; L: number; C: number; jh: number; apex: number }

/** Corona, torre giratoria, cabina, plataforma y torreta (cat-head). */
function buildHead(d: Dims, red: Parts, steel: Parts, dark: Parts, white: Parts, glass: Parts) {
  const { H, jh, apex: A } = d;
  dark.cyl(0.92, 0.2, 'y', 0, H + 0.1, 0, 24);
  red.box(-1.15, H + 0.2, -1.15, 1.15, H + 0.55, 1.15);
  red.box(-0.9, H + 0.55, -0.9, 0.9, jh, 0.9);
  // motores de giro
  for (const z of [-0.55, 0.55]) dark.cyl(0.13, 0.42, 'y', 1.02, H + 0.76, z, 10);
  // plataforma de acceso con baranda (lado -z)
  steel.box(-0.9, H + 0.5, -1.75, 0.9, H + 0.55, -1.15);
  for (const x of [-0.88, 0, 0.88]) red.box(x - 0.025, H + 0.55, -1.75, x + 0.025, H + 1.6, -1.7);
  red.box(-0.9, H + 1.55, -1.76, 0.9, H + 1.6, -1.69);
  red.box(-0.9, H + 1.05, -1.76, 0.9, H + 1.09, -1.69);
  // cabina del operador (lado +z, mirando a lo largo de la pluma): perfil con vidrio inferior inclinado
  const y0 = H + 0.1, z0 = 1.2, z1 = 2.5;
  const prof = new THREE.Shape([
    new THREE.Vector2(-0.2, 0), new THREE.Vector2(1.05, 0), new THREE.Vector2(1.5, 0.75),
    new THREE.Vector2(1.5, 1.72), new THREE.Vector2(1.38, 1.84), new THREE.Vector2(-0.2, 1.84),
  ]);
  const cab = new THREE.ExtrudeGeometry(prof, { depth: z1 - z0, bevelEnabled: false });
  white.geo(mergeVertices(cab.translate(0, y0, z0)));
  white.box(-0.26, y0 + 1.84, z0 - 0.05, 1.62, y0 + 1.9, z1 + 0.05);
  red.box(-0.25, y0 - 0.14, 1.1, 1.1, y0, z1 + 0.04);
  glass.box(1.5, y0 + 0.82, z0 + 0.1, 1.52, y0 + 1.66, z1 - 0.1); // frente
  glass.bar(v(1.07, y0 + 0.06, (z0 + z1) / 2).addScaledVector(v(-0.86, 0.51, 0), -0.012),
    v(1.48, y0 + 0.69, (z0 + z1) / 2).addScaledVector(v(-0.86, 0.51, 0), -0.012), z1 - z0 - 0.2, 0.02); // inclinado
  glass.box(0.25, y0 + 0.78, z1, 1.4, y0 + 1.66, z1 + 0.02); // costado
  glass.box(-0.1, y0 + 0.78, z1, 0.12, y0 + 1.66, z1 + 0.02);
  glass.box(-0.22, y0 + 0.9, z0 + 0.35, -0.2, y0 + 1.6, z1 - 0.35); // trasera
  // torreta piramidal
  const b = 0.85, t = 0.3, levels = 4;
  const at = (k: number) => b + (t - b) * (k / levels);
  for (const [sx, sz] of CORNERS) red.bar(v(sx * b, jh, sz * b), v(sx * t, A, sz * t), 0.15);
  for (let k = 0; k <= levels; k++) {
    const y = jh + ((A - jh) * k) / levels;
    const w0 = at(k), w1 = at(k + 1);
    for (let f = 0; f < 4; f++) {
      const [ax, az] = CORNERS[f];
      const [bx, bz] = CORNERS[(f + 1) % 4];
      if (k > 0) red.bar(v(ax * w0, y, az * w0), v(bx * w0, y, bz * w0), 0.08);
      if (k < levels) red.bar(v(ax * w0, y, az * w0), v(bx * w1, y + (A - jh) / levels, bz * w1), 0.07);
    }
  }
  red.box(-0.45, A, -0.45, 0.45, A + 0.25, 0.45);
  // baranda superior
  for (const [sx, sz] of CORNERS) red.box(sx * 0.45 - 0.02, A + 0.25, sz * 0.45 - 0.02, sx * 0.45 + 0.02, A + 0.95, sz * 0.45 + 0.02);
  for (let f = 0; f < 4; f++) {
    const [ax, az] = CORNERS[f];
    const [bx, bz] = CORNERS[(f + 1) % 4];
    red.bar(v(ax * 0.45, A + 0.95, az * 0.45), v(bx * 0.45, A + 0.95, bz * 0.45), 0.04);
  }
  // mástil de baliza y anemómetro
  dark.cyl(0.04, 0.6, 'y', 0, A + 0.55, 0, 6);
  dark.cyl(0.03, 0.85, 'y', -0.45, A + 1.3, 0.45, 6);
}

/** Pluma de sección triangular (Warren), con orejas de tirante. */
function buildJib(d: Dims, red: Parts, tieAt: number[]) {
  const { L, jh } = d;
  const hw = 0.55, x0 = 0.9;
  const yb = jh + 0.07, yt = jh + 1.32;
  const n = Math.max(4, Math.round((L - x0) / 1.75));
  const bay = (L - x0) / n;
  for (const s of [-1, 1]) red.box(x0, jh, s * hw - 0.07, L, jh + 0.14, s * hw + 0.07);
  red.box(0.75, yt - 0.065, -0.065, L - bay / 2, yt + 0.065, 0.065);
  for (const s of [-1, 1]) red.bar(v(x0, yb, s * hw), v(0.75, yt, 0), 0.09);
  for (let i = 0; i < n; i++) {
    const xi = x0 + i * bay, ti = xi + bay / 2, xn = xi + bay;
    for (const s of [-1, 1]) {
      red.bar(v(xi, yb, s * hw), v(ti, yt, 0), 0.07);
      red.bar(v(ti, yt, 0), v(xn, yb, s * hw), 0.07);
    }
    red.bar(v(xi, yb, -hw), v(xi, yb, hw), 0.07);
    const s = i % 2 ? 1 : -1;
    red.bar(v(xi, yb, s * hw), v(xn, yb, -s * hw), 0.05);
  }
  red.box(L - 0.08, jh, -hw - 0.07, L + 0.06, jh + 0.3, hw + 0.07);
  for (const x of tieAt) red.box(x - 0.2, yt + 0.05, -0.08, x + 0.2, yt + 0.22, 0.08);
}

/** Contrapluma con barandas reticuladas, pasarela, huinche, tablero y contrapesos. */
function buildCounterJib(d: Dims, red: Parts, steel: Parts, dark: Parts, white: Parts, weights: Parts) {
  const { C, jh } = d;
  const hw = 1.1, xa = -0.9, xb = -C, yTop = jh + 1.05;
  for (const s of [-1, 1]) {
    red.box(xb, jh - 0.12, s * hw - 0.08, xa, jh + 0.14, s * hw + 0.08);
    red.box(xb, yTop - 0.035, s * hw - 0.035, xa, yTop + 0.035, s * hw + 0.035);
  }
  const n = Math.max(3, Math.round((C - 0.9) / 1.5));
  const bay = (xa - xb) / n;
  for (let i = 0; i <= n; i++) {
    const x = xb + i * bay;
    red.box(x - 0.05, jh - 0.05, -hw, x + 0.05, jh + 0.05, hw);
    for (const s of [-1, 1]) {
      red.box(x - 0.035, jh + 0.14, s * hw - 0.035, x + 0.035, yTop, s * hw + 0.035);
      if (i < n) {
        const up = i % 2 === 0;
        red.bar(v(x, up ? jh + 0.14 : yTop, s * hw), v(x + bay, up ? yTop : jh + 0.14, s * hw), 0.06);
      }
    }
  }
  red.box(xa - 0.15, jh - 0.12, -hw - 0.08, xa, jh + 0.14, hw + 0.08);
  steel.box(xb + 2.6, jh + 0.14, -0.85, xa, jh + 0.18, 0.85);
  // huinche de levante
  const wx = -3.3;
  red.box(wx - 0.65, jh + 0.18, -0.8, wx + 0.65, jh + 0.3, 0.8);
  dark.cyl(0.36, 1.0, 'z', wx, jh + 0.7, -0.15, 16);
  for (const z of [-0.68, 0.38]) red.cyl(0.47, 0.06, 'z', wx, jh + 0.7, z, 16);
  white.box(wx - 0.55, jh + 0.3, 0.45, wx + 0.45, jh + 0.95, 0.8);
  red.box(wx - 0.2, jh + 0.3, -0.8, wx + 0.25, jh + 0.75, -0.72);
  // tablero eléctrico
  white.box(-1.75, jh + 0.18, -0.85, -1.2, jh + 1.3, -0.4);
  // contrapesos: bloques de hormigón apilados en la cola (núcleo oscuro marca las juntas)
  dark.box(xb + 0.2, jh - 1.25, -0.95, xb + 2.4, jh + 0.72, 0.95);
  for (let j = 0; j < 5; j++) {
    const y0 = jh - 1.3 + j * 0.42;
    weights.box(xb + 0.1, y0, -1.0, xb + 2.5, y0 + 0.39, 1.0);
  }
  red.box(xb - 0.12, jh - 0.12, -hw - 0.08, xb, jh + 0.9, hw + 0.08);
  for (const s of [-1, 1]) red.box(xb + 2.6, yTop, s * hw - 0.06, xb + 3.0, yTop + 0.16, s * hw + 0.06);
}

// ───────────────────────────── grúa ─────────────────────────────

export function createCrane(opts: CraneOptions): CraneRig {
  const H = opts.mastHeight, L = opts.jibLength, C = opts.counterJibLength;
  const jh = H + 2.0;
  const d: Dims = { H, L, C, jh, apex: jh + 7.2 };
  const A = d.apex;
  const tieAt = [0.42 * L, 0.78 * L];

  // materiales compartidos
  const mat = {
    red: new THREE.MeshStandardMaterial({ color: '#c4232b', roughness: 0.5, metalness: 0.15 }),
    steel: new THREE.MeshStandardMaterial({ color: '#79808a', roughness: 0.7, metalness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: '#2b2e33', roughness: 0.6, metalness: 0.3 }),
    footing: new THREE.MeshStandardMaterial({ color: '#9b978f', roughness: 0.95 }),
    concrete: new THREE.MeshStandardMaterial({ color: '#c3c0b8', roughness: 0.9 }),
    white: new THREE.MeshStandardMaterial({ color: '#eef0ee', roughness: 0.45 }),
    glass: new THREE.MeshStandardMaterial({ color: '#4d8486', roughness: 0.1, metalness: 0.55, emissive: '#10292b' }),
    osb: new THREE.MeshStandardMaterial({ map: osbTexture(), roughness: 0.9 }),
    soil: new THREE.MeshStandardMaterial({ color: '#7a6450', roughness: 1 }),
    sign: new THREE.MeshStandardMaterial({ map: signAtlas(), roughness: 0.6 }),
    hookBody: new THREE.MeshStandardMaterial({ map: stripesTexture(), roughness: 0.5, metalness: 0.1 }),
    beacon: new THREE.MeshStandardMaterial({ color: '#7a0d0d', emissive: '#ff2a1a', emissiveIntensity: 0.3 }),
  };
  (mat.hookBody.map as THREE.Texture).repeat.set(2, 2);

  const group = new THREE.Group();
  group.name = 'grua';
  const pickables: THREE.Object3D[] = [];
  type Shadow = 'both' | 'cast' | 'receive' | 'none';
  const add = (parent: THREE.Object3D, parts: Parts, m: THREE.Material, shadow: Shadow = 'both') => {
    const mesh = new THREE.Mesh(parts.build(), m);
    mesh.castShadow = shadow === 'both' || shadow === 'cast';
    mesh.receiveShadow = shadow === 'both' || shadow === 'receive';
    mesh.userData.pick = { type: 'crane' };
    parent.add(mesh);
    pickables.push(mesh);
  };

  // ── parte fija: base y mástil
  const base = {
    red: new Parts(), steel: new Parts(), dark: new Parts(), footing: new Parts(),
    ballast: new Parts(), osb: new Parts(), soil: new Parts(), sign: new Parts(),
  };
  buildBase(base);
  buildMast(base.red, base.steel, H);
  add(group, base.red, mat.red);
  add(group, base.steel, mat.steel);
  add(group, base.dark, mat.dark, 'cast');
  add(group, base.footing, mat.footing, 'receive');
  add(group, base.ballast, mat.concrete);
  add(group, base.osb, mat.osb);
  add(group, base.soil, mat.soil, 'receive');
  add(group, base.sign, mat.sign, 'receive');

  // ── parte giratoria: corona, torreta, pluma, contrapluma
  const slewing = new THREE.Group();
  slewing.name = 'grua-giro';
  group.add(slewing);
  const sl = { red: new Parts(), steel: new Parts(), dark: new Parts(), white: new Parts(), glass: new Parts(), weights: new Parts() };
  buildHead(d, sl.red, sl.steel, sl.dark, sl.white, sl.glass);
  buildJib(d, sl.red, tieAt);
  buildCounterJib(d, sl.red, sl.steel, sl.dark, sl.white, sl.weights);
  // tirantes (pendolones) desde la punta de la torreta
  const yt = jh + 1.32 + 0.14;
  for (const x of tieAt) sl.red.bar(v(0.3, A + 0.12, 0), v(x, yt, 0), 0.07, 0.05);
  for (const s of [-1, 1]) sl.red.bar(v(-0.3, A + 0.12, s * 0.3), v(-C + 2.8, jh + 1.15, s * 1.1), 0.07);
  // postes de balizas
  const beaconPos = [v(0, A + 0.95, 0), v(L - 0.05, jh + 0.62, 0), v(-C + 1.3, jh + 1.22, 0)];
  sl.dark.cyl(0.035, 0.32, 'y', L - 0.05, jh + 0.46, 0, 6);
  sl.dark.cyl(0.035, 0.3, 'y', -C + 1.3, jh + 0.95, 0, 6);
  add(slewing, sl.red, mat.red);
  add(slewing, sl.steel, mat.steel);
  add(slewing, sl.dark, mat.dark, 'cast');
  add(slewing, sl.white, mat.white);
  add(slewing, sl.glass, mat.glass, 'cast');
  add(slewing, sl.weights, mat.concrete);
  // placas "PINGON" a ambos lados de la contrapluma
  const signs = new Parts();
  const sx = -C + 5.6, sy = jh + 0.62;
  signs.geo(atlasPlane(3.6, 0.53, SIGN_PINGON).translate(sx, sy, 1.21));
  signs.geo(atlasPlane(3.6, 0.53, SIGN_PINGON).rotateY(Math.PI).translate(sx, sy, -1.21));
  add(slewing, signs, mat.sign, 'cast');

  // balizas rojas (emisivas + halo)
  const bulbs = new Parts();
  beaconPos.forEach((p) => bulbs.geo(new THREE.SphereGeometry(0.13, 10, 8).translate(p.x, p.y, p.z)));
  add(slewing, bulbs, mat.beacon, 'none');
  const glowMat = new THREE.SpriteMaterial({
    map: glowTexture(), color: '#ff3b2a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
  const glows = beaconPos.map((p, i) => {
    const s = new THREE.Sprite(glowMat);
    s.position.copy(p);
    s.scale.setScalar(i === 0 ? 2.2 : 1.6);
    s.raycast = () => {};
    slewing.add(s);
    return s;
  });

  // anemómetro (cazoletas que giran)
  const anemo = new THREE.Group();
  anemo.position.set(-0.45, A + 1.75, 0.45);
  const cups = new Parts();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const r = new THREE.Matrix4().makeRotationY(a);
    cups.geo(new THREE.BoxGeometry(0.3, 0.02, 0.02).translate(0.15, 0, 0).applyMatrix4(r));
    cups.geo(new THREE.SphereGeometry(0.06, 8, 6, 0, Math.PI).translate(0.3, 0, 0).applyMatrix4(r));
  }
  add(anemo, cups, mat.dark, 'cast');
  slewing.add(anemo);

  // ── carro
  const trolley = new THREE.Group();
  slewing.add(trolley);
  const tr = new Parts(), trDark = new Parts();
  for (const s of [-1, 1]) {
    tr.box(-0.6, jh + 0.14, s * 0.43, 0.6, jh + 0.3, s * 0.67);
    tr.box(-0.6, jh + 0.3, s * 0.4, 0.6, jh + 0.36, s * 0.78);
    tr.box(-0.55, jh - 0.48, s * 0.7, 0.55, jh + 0.36, s * 0.78);
    for (const x of [-0.38, 0.38]) trDark.cyl(0.09, 0.14, 'z', x, jh + 0.2, s * 0.55, 10);
  }
  tr.box(-0.55, jh - 0.55, -0.78, 0.55, jh - 0.42, 0.78);
  for (const x of [-0.4, 0.4]) trDark.cyl(0.18, 0.09, 'z', x, jh - 0.45, 0, 14);
  add(trolley, tr, mat.red);
  add(trolley, trDark, mat.dark, 'cast');

  // ── motón (gira con la pluma) y gancho
  const block = new THREE.Group();
  slewing.add(block);
  const body = new Parts(), metal = new Parts();
  body.box(-0.38, 0.62, -0.2, 0.38, SHEAVE_Y, 0.2);
  body.cyl(0.38, 0.4, 'z', 0, SHEAVE_Y, 0, 20);
  metal.cyl(0.11, 0.44, 'z', 0, SHEAVE_Y, 0, 12);
  metal.box(-0.26, 0.44, -0.17, 0.26, 0.62, 0.17);
  metal.cyl(0.06, 0.22, 'y', 0, 0.35, 0, 8);
  const R = 0.17, tube = 0.055;
  metal.geo(new THREE.TorusGeometry(R, tube, 8, 18, Math.PI * 1.6).rotateZ((66 * Math.PI) / 180).translate(0, R - tube, 0));
  add(block, body, mat.hookBody);
  add(block, metal, mat.dark, 'cast');

  // ── cables: huinche → pluma (fijo) y dos ramales verticales carro → motón
  const ropePos = new Float32Array(8 * 3);
  ropePos.set([-3.3, jh + 1.06, -0.15, 0.9, jh + 0.22, 0, 0.9, jh + 0.22, 0, L - 0.3, jh + 0.22, 0]);
  const ropeGeo = new THREE.BufferGeometry();
  ropeGeo.setAttribute('position', new THREE.BufferAttribute(ropePos, 3));
  const ropes = new THREE.LineSegments(ropeGeo, new THREE.LineBasicMaterial({ color: '#1b1d20' }));
  ropes.frustumCulled = false;
  slewing.add(ropes);

  const hook = new THREE.Object3D();
  hook.name = 'gancho';
  group.add(hook);

  const maxHookY = jh - 2.3;
  const sway = { prev: new THREE.Vector3(), vel: new THREE.Vector3(), ang: new THREE.Vector2(), angVel: new THREE.Vector2() };
  const tmp = new THREE.Vector3();

  const rig: CraneRig = {
    group,
    hook,
    jibHeight: jh,
    maxHookY,
    pickables,
    swing: 1,
    setPose(slew, trolleyR, hookY) {
      const r = THREE.MathUtils.clamp(trolleyR, 3, L - 1);
      const y = Math.min(hookY, maxHookY);
      slewing.rotation.y = -slew;
      trolley.position.x = r;
      block.position.set(r, y, 0);
      hook.position.set(Math.cos(slew) * r, y, Math.sin(slew) * r);
      const top = jh - 0.45, bot = y + SHEAVE_Y;
      ropePos.set([r - 0.22, top, 0, r - 0.22, bot, 0, r + 0.22, top, 0, r + 0.22, bot, 0], 12);
      ropeGeo.attributes.position.needsUpdate = true;
    },
    update(t, dt) {
      // baliza: destello suave ~0,7 s encendida / 0,7 s apagada
      const ph = (t % 1.4) / 1.4;
      const k = ph < 0.5 ? Math.pow(Math.sin((ph / 0.5) * Math.PI), 0.6) : 0;
      mat.beacon.emissiveIntensity = 0.25 + k * 3.5;
      glowMat.opacity = k;
      glows.forEach((g) => (g.visible = k > 0.01));
      anemo.rotation.y = t * 7;
      // balanceo de la carga: péndulo amortiguado excitado por la aceleración (suavizada) del gancho
      if (!(dt > 0 && dt < 0.25)) return;
      tmp.subVectors(hook.position, sway.prev).divideScalar(dt);
      sway.prev.copy(hook.position);
      if (tmp.lengthSq() > 900) tmp.copy(sway.vel); // salto de la línea de tiempo: sin impulso
      const a = 1 - Math.exp(-dt / 0.15);
      const vx = sway.vel.x + (tmp.x - sway.vel.x) * a, vz = sway.vel.z + (tmp.z - sway.vel.z) * a;
      const ax = (vx - sway.vel.x) / dt, az = (vz - sway.vel.z) / dt;
      sway.vel.set(vx, 0, vz);
      const lim = 0.06 * rig.swing;
      const tx = THREE.MathUtils.clamp((az / 9.81) * rig.swing, -lim, lim);
      const tz = THREE.MathUtils.clamp((-ax / 9.81) * rig.swing, -lim, lim);
      const w = 1.9, z = 0.12;
      sway.angVel.x += (w * w * (tx - sway.ang.x) - 2 * z * w * sway.angVel.x) * dt;
      sway.angVel.y += (w * w * (tz - sway.ang.y) - 2 * z * w * sway.angVel.y) * dt;
      sway.ang.x = THREE.MathUtils.clamp(sway.ang.x + sway.angVel.x * dt, -lim, lim);
      sway.ang.y = THREE.MathUtils.clamp(sway.ang.y + sway.angVel.y * dt, -lim, lim);
      hook.rotation.set(sway.ang.x, 0, sway.ang.y);
    },
  };
  rig.setPose(0, L * 0.5, jh - 10);
  sway.prev.copy(hook.position);
  return rig;
}
