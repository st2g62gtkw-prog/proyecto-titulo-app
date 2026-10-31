/**
 * Ventanas y barandas de la fachada según las elevaciones de arquitectura (lámina L42): el IFC trae
 * las ventanas como cajas de marco de 0,6 m de fondo que sobresalen del muro y las barandas como
 * paneles llenos. Aquí, de cada ventana del IFC se toma solo su vano (ancho y alto) y se arma una
 * ventana a ras de la cara exterior del muro: vidrio con marco delgado y montante al centro; de
 * cada baranda, un paño de vidrio con pasamanos y perfiles de aluminio (renders del proyecto).
 */
import type { WallData } from '../data/building';

export type Box = [number, number, number, number, number, number];
/** Centro del edificio en planta y medio largo (x) y medio ancho (z). */
export type Center = [number, number, number, number];

/** Grupos de triángulos seguidos y vecinos (cada ventana o baranda del IFC). */
export function clusters(pos: Float32Array, gap: number): Box[] {
  const out: Box[] = [];
  let b: Box | null = null;
  for (let t = 0; t < pos.length / 9; t++) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      const i = t * 9 + k * 3;
      x0 = Math.min(x0, pos[i]); y0 = Math.min(y0, pos[i + 1]); z0 = Math.min(z0, pos[i + 2]);
      x1 = Math.max(x1, pos[i]); y1 = Math.max(y1, pos[i + 1]); z1 = Math.max(z1, pos[i + 2]);
    }
    if (b && (x0 > b[3] + gap || x1 < b[0] - gap || y0 > b[4] + gap || y1 < b[1] - gap || z0 > b[5] + gap || z1 < b[2] - gap)) {
      out.push(b);
      b = null;
    }
    b = b ? [Math.min(b[0], x0), Math.min(b[1], y0), Math.min(b[2], z0), Math.max(b[3], x1), Math.max(b[4], y1), Math.max(b[5], z1)] : [x0, y0, z0, x1, y1, z1];
  }
  if (b) out.push(b);
  return merge(out, 0.08);
}

/** Une las cajas que se tocan (con holgura tol): las piezas de un mismo marco quedan en una sola. */
function merge(boxes: Box[], tol: number): Box[] {
  const bs = boxes.slice();
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i], b = bs[j];
        if (a[0] > b[3] + tol || b[0] > a[3] + tol || a[1] > b[4] + tol || b[1] > a[4] + tol || a[2] > b[5] + tol || b[2] > a[5] + tol) continue;
        bs[i] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5])];
        bs.splice(j, 1);
        changed = true;
        j--;
      }
    }
  }
  return bs;
}

/** Caja alineada a los ejes como triángulos. */
export function box(out: number[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  for (const [a, b, c, d] of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]]) {
    for (const k of [a, b, c, a, c, d]) out.push(...v[k]);
  }
}

/**
 * Plano (eje delgado, sentido hacia afuera) y extensión en el plano de una ventana o baranda. La
 * fachada se reconoce por la posición respecto del centro del edificio (center = [cx, cz, medio
 * largo, medio ancho]): las ventanas de los testeros son tan anchas como hondas.
 */
function frameOf(b: Box, center: Center) {
  const [ax, ay, az, bx, by, bz] = b;
  const ex = bx - ax, ez = bz - az;
  const alongX = Math.abs(ex - ez) > 0.3 ? ex > ez : Math.abs((az + bz) / 2 - center[1]) / center[3] > Math.abs((ax + bx) / 2 - center[0]) / center[2];
  const mid = alongX ? (az + bz) / 2 : (ax + bx) / 2;
  const sign = alongX ? Math.sign(mid - center[1]) || 1 : Math.sign(mid - center[0]) || 1;
  return { alongX, sign, u0: alongX ? ax : az, u1: alongX ? bx : bz, y0: ay, y1: by, d0: alongX ? az : ax, d1: alongX ? bz : bx };
}

/**
 * Coordenada de la cara exterior del muro de fachada que tapa la ventana (o el medio de su caja): la
 * cara más exterior entre los cantos de muro paralelos a la fachada que cubren al menos la mitad del
 * ancho de la ventana (el IFC no les abre el vano). Se miran los cantos y no la caja del muro porque
 * los muros de la saliente del frente tienen retornos y la caja tiene más de 1 m de fondo.
 */
function wallFace(f: ReturnType<typeof frameOf>, walls: WallData[]) {
  const faces: { d: number; ov: number }[] = [];
  for (const w of walls) {
    // un muro que tapa la ventana en toda su altura cuenta aunque esté hasta 2 m por delante (sobre el
    // hall el IFC pone las ventanas 1,2 m detrás del muro de fachada; en la elevación van en la fachada)
    const reach = w.y0 <= f.y0 + 0.15 && w.y1 >= f.y1 - 0.15 ? 2 : 0.8;
    for (let i = 0; i < w.poly.length; i++) {
      const a = w.poly[i], b = w.poly[(i + 1) % w.poly.length];
      const [ua, da] = f.alongX ? a : [a[1], a[0]], [ub, db] = f.alongX ? b : [b[1], b[0]];
      if (Math.abs(da - db) > 0.02) continue;
      const ov = Math.min(f.u1, Math.max(ua, ub)) - Math.max(f.u0, Math.min(ua, ub)), d = (da + db) / 2;
      if (ov < 0.05 || d < f.d0 - reach || d > f.d1 + reach) continue;
      const c = faces.find((c) => Math.abs(c.d - d) < 0.03);
      if (c) c.ov += ov;
      else faces.push({ d, ov });
    }
  }
  let best: number | null = null;
  for (const c of faces) if (c.ov >= 0.5 * (f.u1 - f.u0) && (best === null || f.sign * c.d > f.sign * best)) best = c.d;
  return best ?? (f.d0 + f.d1) / 2;
}

/** Ventanas a ras del muro: marco delgado con montante (frame) y vidrio (glass). */
export function windowsFromIfc(pos: Float32Array, walls: WallData[], center: Center) {
  const frame: number[] = [], glass: number[] = [];
  for (const b of clusters(pos, 0.03)) {
    if (b[4] - b[1] < 0.3) continue;
    const f = frameOf(b, center);
    if (f.u1 - f.u0 < 0.15) continue;
    const face = wallFace(f, walls), s = f.sign, t = 0.06, dep = 0.1;
    // caja en coordenadas (u, y, d) → (x, y, z)
    const put = (u0: number, y0: number, u1: number, y1: number, e0: number, e1: number, out: number[]) => {
      const [a, c] = [Math.min(face + s * e0, face + s * e1), Math.max(face + s * e0, face + s * e1)];
      if (f.alongX) box(out, u0, y0, a, u1, y1, c);
      else box(out, a, y0, u0, c, y1, u1);
    };
    const { u0, u1, y0, y1 } = f;
    put(u0, y0, u1, y0 + t, 0, dep, frame);
    put(u0, y1 - t, u1, y1, 0, dep, frame);
    put(u0, y0, u0 + t, y1, 0, dep, frame);
    put(u1 - t, y0, u1, y1, 0, dep, frame);
    if (u1 - u0 > 1.1) put((u0 + u1) / 2 - t / 2, y0, (u0 + u1) / 2 + t / 2, y1, 0, dep, frame);
    // (bien delante de la piel de pintura de la fachada, que va a 1,2 cm del muro con desfase de profundidad)
    put(u0 + t, y0 + t, u1 - t, y1 - t, 0.06, 0.07, glass);
  }
  return { frame: new Float32Array(frame), glass: new Float32Array(glass) };
}

/**
 * Barandas de vidrio como en los renders del proyecto: paño de vidrio translúcido (glass) con
 * pasamanos, perfil inferior y perfiles en las juntas de los paños (rail), en el plano de cada panel
 * de baranda del IFC.
 */
export function railingsFromIfc(pos: Float32Array, center: Center, walls: WallData[]) {
  const rail: number[] = [], glass: number[] = [];
  for (const b of clusters(pos, 0.03)) {
    const f = frameOf(b, center);
    if (f.u1 - f.u0 < 0.2 || f.y1 - f.y0 < 0.3) continue;
    const r = 0.022;
    let d = (f.d0 + f.d1) / 2;
    // si el panel queda dentro de un muro de fachada sin vano, va por fuera, delante de la ventana
    const face = wallFace(f, walls);
    if (f.sign * face > f.sign * d) d = face + f.sign * 0.13;
    const bar = (out: number[], u0: number, y0: number, u1: number, y1: number, h = r) => {
      if (f.alongX) box(out, u0, y0, d - h, u1, y1, d + h);
      else box(out, d - h, y0, u0, d + h, y1, u1);
    };
    const { u0, u1, y0, y1 } = f;
    // pasamanos de 5 × 4,4 cm y perfil inferior
    bar(rail, u0, y1 - 0.05, u1, y1);
    bar(rail, u0, y0 + 0.06, u1, y0 + 0.1, 0.016);
    // paños de ~1,2 m con perfiles delgados en las juntas y en los extremos
    const n = Math.max(1, Math.round((u1 - u0) / 1.2));
    for (let i = 0; i <= n; i++) {
      const u = u0 + ((u1 - u0) * i) / n;
      bar(rail, Math.max(u0, u - 0.018), y0 + 0.06, Math.min(u1, u + 0.018), y1 - 0.05, 0.018);
    }
    bar(glass, u0, y0 + 0.1, u1, y1 - 0.05, 0.006);
  }
  return { rail: new Float32Array(rail), glass: new Float32Array(glass) };
}
