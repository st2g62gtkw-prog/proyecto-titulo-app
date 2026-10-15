/**
 * Acumulador de geometría: junta muchas piezas (barras, paneles, muros) en un solo
 * BufferGeometry, cada una con sus atributos de tiempo para los materiales reveal.
 */
import * as THREE from 'three';

export type V2 = [number, number];

export class GeoBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private t: number[] = [];
  private box: number[] = [];
  private idx: number[] = [];
  private cur = { t: [0, 0, 1e7, 1e7] as number[], box: [0, 1] as number[] };
  uvScale = 1;

  /** Ventana de aparición/retiro y caja vertical para las piezas que siguen. */
  timing(in0: number, in1: number, out0 = 1e7, out1 = 1e7, y0 = 0, h = 1) {
    this.cur = { t: [in0, in1, out0, out1], box: [y0, h] };
    return this;
  }

  get vertexCount() {
    return this.pos.length / 3;
  }

  private vtx(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    this.t.push(...this.cur.t);
    this.box.push(...this.cur.box);
    return this.pos.length / 3 - 1;
  }

  private quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, n: THREE.Vector3, uw = 1, vh = 1) {
    const s = this.uvScale;
    // asegura que la cara frontal mire hacia la normal indicada
    const cr = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const i0 = this.vtx(a.x, a.y, a.z, n.x, n.y, n.z, 0, 0);
    const i1 = this.vtx(b.x, b.y, b.z, n.x, n.y, n.z, uw * s, 0);
    const i2 = this.vtx(c.x, c.y, c.z, n.x, n.y, n.z, uw * s, vh * s);
    const i3 = this.vtx(d.x, d.y, d.z, n.x, n.y, n.z, 0, vh * s);
    if (cr.dot(n) >= 0) this.idx.push(i0, i1, i2, i0, i2, i3);
    else this.idx.push(i0, i2, i1, i0, i3, i2);
  }

  /**
   * Caja orientada: esquina `o`, ejes unitarios ortogonales `ux, uy, uz`, tamaños sx, sy, sz.
   */
  orientedBox(o: THREE.Vector3, ux: THREE.Vector3, uy: THREE.Vector3, uz: THREE.Vector3, sx: number, sy: number, sz: number, caps = true) {
    const X = ux.clone().multiplyScalar(sx);
    const Y = uy.clone().multiplyScalar(sy);
    const Z = uz.clone().multiplyScalar(sz);
    const p = (i: number, j: number, k: number) =>
      o.clone().addScaledVector(X, i).addScaledVector(Y, j).addScaledVector(Z, k);
    const nx = ux.clone(), ny = uy.clone(), nz = uz.clone();
    // +X / -X
    this.quad(p(1, 0, 0), p(1, 0, 1), p(1, 1, 1), p(1, 1, 0), nx, sz, sy);
    this.quad(p(0, 0, 1), p(0, 0, 0), p(0, 1, 0), p(0, 1, 1), nx.clone().negate(), sz, sy);
    // +Z / -Z
    this.quad(p(0, 0, 1), p(0, 1, 1), p(1, 1, 1), p(1, 0, 1), nz, sy, sx);
    this.quad(p(1, 0, 0), p(1, 1, 0), p(0, 1, 0), p(0, 0, 0), nz.clone().negate(), sy, sx);
    if (caps) {
      this.quad(p(0, 1, 0), p(1, 1, 0), p(1, 1, 1), p(0, 1, 1), ny, sx, sz);
      this.quad(p(0, 0, 1), p(1, 0, 1), p(1, 0, 0), p(0, 0, 0), ny.clone().negate(), sx, sz);
    }
    return this;
  }

  /** Caja alineada a los ejes entre min y max. */
  aabb(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    return this.orientedBox(
      new THREE.Vector3(x0, y0, z0),
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1),
      x1 - x0, y1 - y0, z1 - z0,
    );
  }

  /** Barra de sección cuadrada `w` entre dos puntos 3D (fierros, puntales, perfiles). */
  bar(a: THREE.Vector3, b: THREE.Vector3, w: number, caps = true) {
    const d = b.clone().sub(a);
    const len = d.length();
    if (len < 1e-5) return this;
    const ux = d.divideScalar(len);
    const ref = Math.abs(ux.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const uz = new THREE.Vector3().crossVectors(ux, ref).normalize();
    const uy = new THREE.Vector3().crossVectors(uz, ux).normalize();
    const o = a.clone().addScaledVector(uy, -w / 2).addScaledVector(uz, -w / 2);
    // eje largo = X de la caja; las tapas son las caras ±X
    return this.orientedBox(o, ux, uy, uz, len, w, w, caps);
  }

  /** Panel vertical a lo largo del tramo a→b (planta), desplazado `off` hacia la normal izquierda. */
  wallPanel(a: V2, b: V2, y0: number, y1: number, thick: number, off: number) {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return this;
    const ux = new THREE.Vector3(dx / len, 0, dz / len);
    const n = new THREE.Vector3(dz / len, 0, -dx / len); // normal a la derecha del avance
    const o = new THREE.Vector3(a[0], y0, a[1]).addScaledVector(n, off);
    return this.orientedBox(o, ux, new THREE.Vector3(0, 1, 0), n, len, y1 - y0, thick);
  }

  /** Cilindro vertical de pocos lados (puntales, postes). */
  cylinder(x: number, z: number, y0: number, y1: number, r: number, sides = 6) {
    const s = this.uvScale;
    const base = this.vertexCount;
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      this.vtx(x + c * r, y0, z + sn * r, c, 0, sn, i / sides * s, 0);
      this.vtx(x + c * r, y1, z + sn * r, c, 0, sn, i / sides * s, (y1 - y0) * s);
    }
    for (let i = 0; i < sides; i++) {
      const a = base + i * 2;
      this.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    return this;
  }

  /** Polígono extruido (con agujeros) entre y0 e y1. Polígono en planta [x, z]. */
  extrude(outer: V2[], holes: V2[][], y0: number, y1: number, sides = true, bottom = true) {
    const shapeOuter = outer.map((p) => new THREE.Vector2(p[0], p[1]));
    const shapeHoles = holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
    // triangulateShape requiere sentido antihorario para el contorno
    if (THREE.ShapeUtils.isClockWise(shapeOuter)) shapeOuter.reverse();
    shapeHoles.forEach((h) => { if (!THREE.ShapeUtils.isClockWise(h)) h.reverse(); });
    const tris = THREE.ShapeUtils.triangulateShape(shapeOuter, shapeHoles);
    const all = [...shapeOuter, ...shapeHoles.flat()];
    const s = this.uvScale;
    // tapa superior (normal +y) y fondo (normal -y)
    const topBase = this.vertexCount;
    for (const p of all) this.vtx(p.x, y1, p.y, 0, 1, 0, p.x * s, p.y * s);
    for (const t of tris) this.idx.push(topBase + t[0], topBase + t[2], topBase + t[1]);
    if (bottom) {
      const botBase = this.vertexCount;
      for (const p of all) this.vtx(p.x, y0, p.y, 0, -1, 0, p.x * s, p.y * s);
      for (const t of tris) this.idx.push(botBase + t[0], botBase + t[1], botBase + t[2]);
    }
    if (sides) {
      const ring = (pts: THREE.Vector2[]) => {
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          const dx = b.x - a.x, dz = b.y - a.y;
          const len = Math.hypot(dx, dz);
          if (len < 1e-5) continue;
          // contorno antihorario en planta (x, z) => normal exterior = (dz, -dx)
          const n = new THREE.Vector3(dz / len, 0, -dx / len);
          this.quad(
            new THREE.Vector3(a.x, y0, a.y), new THREE.Vector3(b.x, y0, b.y),
            new THREE.Vector3(b.x, y1, b.y), new THREE.Vector3(a.x, y1, a.y), n, len, y1 - y0,
          );
        }
      };
      ring(shapeOuter);
      shapeHoles.forEach(ring);
    }
    return this;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(this.t, 4));
    g.setAttribute('aBox', new THREE.Float32BufferAttribute(this.box, 2));
    g.setIndex(this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Área con signo de un polígono en planta (positivo = antihorario en x→z). */
export function signedArea(p: V2[]) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, z0] = p[i];
    const [x1, z1] = p[(i + 1) % p.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

export function pointInPolygon(x: number, z: number, poly: V2[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Intersecciones de la recta z = const (o x = const) con el polígono, ordenadas. */
export function scanline(poly: V2[], axis: 'x' | 'z', value: number): number[] {
  const out: number[] = [];
  const a = axis === 'z' ? 1 : 0; // coordenada fija
  const b = 1 - a; // coordenada que varía
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    if ((p[a] > value) !== (q[a] > value)) {
      const t = (value - p[a]) / (q[a] - p[a]);
      out.push(p[b] + t * (q[b] - p[b]));
    }
  }
  return out.sort((x, y) => x - y);
}

/** Desplaza un polígono hacia adentro (d > 0) o afuera (d < 0) con uniones en inglete. */
export function offsetPolygon(poly: V2[], d: number): V2[] {
  const ccw = signedArea(poly) > 0;
  const s = ccw ? 1 : -1;
  const n = poly.length;
  const res: V2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i - 1 + n) % n], p1 = poly[i], p2 = poly[(i + 1) % n];
    const e1 = norm2([p1[0] - p0[0], p1[1] - p0[1]]);
    const e2 = norm2([p2[0] - p1[0], p2[1] - p1[1]]);
    // normal interior para contorno antihorario en (x, z) con z hacia "abajo": (-dz, dx)
    const n1: V2 = [-e1[1] * s, e1[0] * s];
    const n2: V2 = [-e2[1] * s, e2[0] * s];
    let m: V2 = [n1[0] + n2[0], n1[1] + n2[1]];
    const ml = Math.hypot(m[0], m[1]);
    if (ml < 1e-6) m = n1; else m = [m[0] / ml, m[1] / ml];
    const cos = Math.max(0.35, m[0] * n1[0] + m[1] * n1[1]);
    res.push([p1[0] + (m[0] * d) / cos, p1[1] + (m[1] * d) / cos]);
  }
  return res;
}

function norm2(v: V2): V2 {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

/** Recorre un polígono cerrado y entrega puntos cada `step` metros (con su tangente). */
export function samplePerimeter(poly: V2[], step: number): { p: V2; t: V2 }[] {
  const out: { p: V2; t: V2 }[] = [];
  let carry = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const t: V2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    let s = carry;
    while (s < len) {
      out.push({ p: [a[0] + t[0] * s, a[1] + t[1] * s], t });
      s += step;
    }
    carry = s - len;
  }
  return out;
}

/** Centroide aproximado (promedio de vértices) y caja en planta. */
export function polyBounds(poly: V2[]) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, cx = 0, cz = 0;
  for (const [x, z] of poly) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    cx += x; cz += z;
  }
  return { x0, x1, z0, z1, cx: cx / poly.length, cz: cz / poly.length };
}
