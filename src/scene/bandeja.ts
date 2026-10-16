/**
 * Bandeja de trabajo perimetral en ménsulas (andamio de obra gruesa).
 *
 * Como en la obra: en el piso que se está construyendo hay una plataforma de tablones de
 * ~1 m de ancho en voladizo junto a la fachada, al nivel de la última losa, apoyada en ménsulas
 * metálicas triangulares fijadas al muro del piso de abajo. Lleva pies derechos en cada ménsula,
 * pasamanos, baranda intermedia, rodapié y malla raschel verde solo en la altura de la baranda.
 * Bajo la bandeja solo asoman las ménsulas: no hay parantes hasta el suelo.
 */
import { GeoBuilder, offsetPolygon, outerEnvelope, pointInPolygon, type V2 } from './geom';

export interface BandejaParts {
  /** Ménsulas y pies derechos (acero oscuro). */
  frame: GeoBuilder;
  /** Pasamanos y baranda intermedia. */
  rails: GeoBuilder;
  /** Tablones y rodapié. */
  deck: GeoBuilder;
  /** Malla raschel por fuera de la baranda. */
  mesh: GeoBuilder;
}

/** Medidas de la bandeja (m). */
export const BANDEJA = {
  /** Holgura entre la fachada y el primer tablón. */
  gap: 0.05,
  /** Ancho de la plataforma de tablones. */
  ancho: 1.0,
  /** Alto de la ménsula bajo la plataforma (pie contra el muro de abajo). */
  mensula: 1.2,
  /** Separación máxima entre ménsulas a lo largo de la fachada. */
  paso: 2.8,
  pasamanos: 1.1,
  intermedia: 0.5,
  rodapie: 0.15,
  /** Alto de la malla sobre la plataforma. */
  malla: 1.2,
};

/** Lo que sube la bandeja al trepar al piso siguiente (un piso a piso). */
export const BANDEJA_LIFT = 2.5;

/** Base y alto de la bandeja (del pie de las ménsulas al borde de la malla) para la losa de cota `y`. */
export function bandejaSpan(y: number): [number, number] {
  const y0 = y - BANDEJA.mensula - 0.16;
  return [y0, y + BANDEJA.malla + 0.02 - y0];
}

/**
 * Agrega la bandeja alrededor del contorno `outline` (losa del piso en obra, cara superior en `y`).
 * `anchors` son las plantas de los muros del piso de abajo: cada ménsula se corre unos centímetros
 * para quedar contra un muro cuando lo hay cerca. La timing de cada GeoBuilder se fija afuera.
 */
export function buildBandeja(g: BandejaParts, outline: V2[], anchors: V2[][], y: number) {
  const B = BANDEJA;
  const W = B.gap + B.ancho; // borde exterior de la plataforma, medido desde la fachada
  const dPost = W - 0.04; // eje de los pies derechos y de la baranda
  const yTop = y - 0.02, yBot = yTop - 0.05; // tablones (levemente bajo la losa)
  const yArm = yBot - 0.035; // eje del brazo horizontal de la ménsula

  // fachada limpia (sin pilastras ni astillas) en sentido antihorario: normal exterior (dz, -dx)
  const F = outerEnvelope(outline, 0.35, 2 * W + 0.3);
  const n = F.length;
  const rail = offsetPolygon(F, -dPost);
  const outer = offsetPolygon(F, -W);

  // --- tablones: tres hileras con juntas, y rodapié de madera por dentro de la baranda ---
  const planks: [number, number][] = [[B.gap, B.gap + 0.32], [B.gap + 0.34, B.gap + 0.66], [B.gap + 0.68, W]];
  for (const [o0, o1] of planks) g.deck.extrude(offsetPolygon(F, -o1), [offsetPolygon(F, -o0)], yBot, yTop, true, true);
  const toe = offsetPolygon(F, -(dPost - 0.025));
  for (let i = 0; i < n; i++) g.deck.wallPanel(toe[i], toe[(i + 1) % n], yTop, yTop + B.rodapie, 0.025, -0.025);

  // --- baranda y malla: pasamanos, intermedia y raschel por fuera de los pies derechos ---
  const meshLoop = offsetPolygon(F, -(dPost + 0.03));
  for (let i = 0; i < n; i++) {
    const a = rail[i], c = rail[(i + 1) % n];
    for (const h of [B.intermedia, B.pasamanos]) g.rails.barN(a[0], yTop + h, a[1], c[0], yTop + h, c[1], 0.045);
    g.mesh.wallPanel(meshLoop[i], meshLoop[(i + 1) % n], yBot - 0.02, yTop + B.malla, 0.01, 0);
  }

  // --- ménsulas: brazo bajo la plataforma, pie contra el muro de abajo y diagonal ---
  const posts: V2[] = [];
  const post = (p: V2) => {
    if (posts.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.35)) return;
    posts.push(p);
    g.frame.barN(p[0], yArm - 0.035, p[1], p[0], yTop + B.pasamanos + 0.06, p[1], 0.05);
  };
  const bracket = (p: V2, u: V2, nrm: V2, reach: number) => {
    const at = (d: number): V2 => [p[0] + nrm[0] * d, p[1] + nrm[1] * d];
    const [ax, az] = at(0.0), [bx, bz] = at(reach), [lx, lz] = at(0.045), [dx, dz] = at(reach - 0.14);
    const yFoot = yArm - B.mensula;
    g.frame.barN(ax, yArm, az, bx, yArm, bz, 0.07);
    g.frame.barN(lx, yArm + 0.035, lz, lx, yFoot, lz, 0.07);
    g.frame.barN(lx, yFoot + 0.1, lz, dx, yArm - 0.03, dz, 0.055);
    // placas de anclaje contra el muro: arriba la pasada del perno, abajo el apoyo del pie
    const plate = (y0: number, w: number, h: number) =>
      g.frame.boxN(ax - u[0] * w / 2, y0, az - u[1] * w / 2, u[0], 0, u[1], 0, 1, 0, nrm[0], 0, nrm[1], w, h, 0.012);
    plate(yArm - 0.34, 0.2, 0.3);
    plate(yFoot, 0.14, 0.14);
  };
  // ¿hay muro del piso de abajo detrás de este punto de la fachada?
  const onWall = (p: V2, nrm: V2) => [0.1, 0.25, 0.4].some((d) => {
    const x = p[0] - nrm[0] * d, z = p[1] - nrm[1] * d;
    return anchors.some((poly) => pointInPolygon(x, z, poly));
  });
  const convex = (i: number) => {
    const a = F[(i - 1 + n) % n], b = F[i], c = F[(i + 1) % n];
    return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) > 0;
  };

  for (let i = 0; i < n; i++) {
    const a = F[i], c = F[(i + 1) % n];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const u: V2 = [(c[0] - a[0]) / len, (c[1] - a[1]) / len];
    const nrm: V2 = [u[1], -u[0]];
    const cxA = convex(i), cxC = convex((i + 1) % n);
    // en esquinas salientes va una ménsula en diagonal; en las entrantes el brazo vecino ya apoya
    const lo = cxA ? 0.6 : 0.35, hi = len - (cxC ? 0.6 : 0.35);
    // fuera de este rango el extremo del brazo no cae en la baranda (esquinas entrantes)
    const pLo = cxA ? 0 : W + 0.05, pHi = len - (cxC ? 0 : W + 0.05);
    const ss: number[] = [];
    if (hi - lo >= 0.3) {
      const k = Math.ceil((hi - lo) / B.paso);
      for (let j = 0; j <= k; j++) ss.push(lo + (j * (hi - lo)) / k);
    } else if (hi >= lo) ss.push((lo + hi) / 2);
    for (let s of ss) {
      const pt = (v: number): V2 => [a[0] + u[0] * v, a[1] + u[1] * v];
      if (!onWall(pt(s), nrm)) {
        // se corre hasta 0,6 m para tomarse de un muro si lo hay
        for (let j = 1; j <= 4; j++) {
          const hit = [s - 0.15 * j, s + 0.15 * j].find((v) => v >= lo && v <= hi && onWall(pt(v), nrm));
          if (hit !== undefined) { s = hit; break; }
        }
      }
      bracket(pt(s), u, nrm, W);
      if (s >= pLo && s <= pHi) post([pt(s)[0] + nrm[0] * dPost, pt(s)[1] + nrm[1] * dPost]);
    }
  }
  // ménsulas de esquina (diagonal hacia la punta de la plataforma) y pies derechos en cada quiebre
  for (let i = 0; i < n; i++) {
    if (convex(i)) {
      const p = F[i], q = outer[i];
      const reach = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const nrm: V2 = [(q[0] - p[0]) / reach, (q[1] - p[1]) / reach];
      bracket(p, [-nrm[1], nrm[0]], nrm, reach * 0.98);
    }
    post(rail[i]);
  }
}
