/**
 * Cotas del movimiento de tierra de la faena (sin el ruido decorativo del terreno dibujado):
 * plataforma plana del edificio, camino posterior más abajo con el ensanche de la bomba, talud del
 * frente con la explanada de faena arriba, la bajada de la faena al camino, la subida del camino a
 * la plataforma, la rampa de salida de los camiones tolva y la calle del portón. Lo usan el terreno
 * dibujado (scene/site) y todo lo que se apoya en el suelo: camiones, cuadrillas, capacho, bomba y
 * tubería.
 *
 * Cada explanada o rampa fija su cota adentro y, afuera, limita el terreno con taludes de pendiente
 * s (alto por metro): en orden, cada una corta o rellena lo anterior hasta empalmar.
 */
import { SITE } from '../config';
import { RZ, salidaPath, subidaPath, type P } from './roads';

const TR = SITE.terreno;
/** Cotas: plataforma del edificio, camino posterior y explanada de faena. */
export const Y_PLAT = SITE.groundY, Y_CAMINO = TR.camino, Y_FAENA = TR.faena;
/** Pendiente de los cortes de la plataforma (corte posterior y talud del frente, ~53°). */
const S_PLAT = (Y_PLAT - Y_CAMINO) / TR.corte;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth01 = (u: number) => {
  u = clamp(u, 0, 1);
  return u * u * (3 - 2 * u);
};
/** Rampa con curvas verticales suaves al pie y arriba (fracción a en cada extremo). */
function ramp(u: number, a = 0.18) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  if (u < a) return (u * u) / (2 * a * (1 - a));
  if (u > 1 - a) return 1 - ((1 - u) * (1 - u)) / (2 * a * (1 - a));
  return (u - a / 2) / (1 - a);
}

/** Borde posterior de la plataforma en x (más atrás en el tramo −x, donde la huella se corre). */
export function bordePosterior(x: number) {
  const [a, b] = TR.bordePosterior;
  return a + (b - a) * smooth01((x + 14) / 6);
}
/** Pie del corte posterior (a la cota del camino). */
export const piePosterior = (x: number) => bordePosterior(x) - TR.corte;

/** Cota de la bajada (y de la ladera del costado −x) a lo largo de z. */
export function bajadaY(z: number) {
  const B = TR.bajada;
  return Y_CAMINO + (Y_FAENA - Y_CAMINO) * ramp((z - B.zAbajo) / (B.zArriba - B.zAbajo));
}
/** Cota de la calle del portón a lo largo de z: a la del camino en el portón, sube al barrio y, hacia atrás, sube el cerro. */
export function calleY(z: number) {
  if (z < TR.fondoBajo[1]) return natural(z);
  return Y_CAMINO + (Y_PLAT - Y_CAMINO) * smooth01((z - (RZ + 3)) / 16);
}
/** Cota del barrio junto a la faena (a la de la plataforma, salvo detrás, donde sube el cerro). */
const barrioY = (z: number) => (z < TR.fondoBajo[1] ? Math.max(Y_PLAT, natural(z)) : Y_PLAT);

/**
 * Corte típico a lo ancho (lo que no cubre ninguna explanada, como el costado +x): cerro con bosque
 * atrás, camino abajo, corte posterior, plataforma, talud del frente, explanada de faena y bajada al
 * barrio.
 */
function natural(z: number) {
  const z0 = TR.fondoBajo[1], zb = TR.bordePosterior[1], toe = zb - TR.corte;
  if (z < z0) return Y_CAMINO + 0.12 * (z0 - z);
  if (z < toe) return Y_CAMINO;
  if (z < zb) return Y_CAMINO + ((Y_PLAT - Y_CAMINO) * (z - toe)) / TR.corte;
  if (z < TR.pieTalud) return Y_PLAT;
  if (z < TR.frenteZ) return Math.min(Y_FAENA, Y_PLAT + S_PLAT * (z - TR.pieTalud));
  return Y_FAENA + (Y_PLAT - Y_FAENA) * smooth01((z - TR.frenteZ) / 10);
}

/** Distancia en planta a un rectángulo [x0, x1] × [z0, z1] (0 adentro). */
const rectD = (x: number, z: number, x0: number, x1: number, z0: number, z1: number) =>
  Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
/** Limita h a los taludes de una explanada de cota y con pendiente s, a distancia d de su borde. */
const grade = (h: number, d: number, y: number, s: number) => (d <= 0 ? y : clamp(h, y - s * d, y + s * d));

/** Rampa a lo largo de un eje (planta) con su cota en cada punto: distancia y cota del punto más cercano. */
function rampAlong(path: P[], ys: number[]) {
  const M = 25;
  const x0 = Math.min(...path.map((p) => p[0])) - M, x1 = Math.max(...path.map((p) => p[0])) + M;
  const z0 = Math.min(...path.map((p) => p[1])) - M, z1 = Math.max(...path.map((p) => p[1])) + M;
  return (x: number, z: number): [number, number] => {
    let best = Infinity, y = ys[0];
    // lejos de la rampa no la toca (sus taludes no alcanzan a M)
    if (x < x0 || x > x1 || z < z0 || z > z1) return [best, y];
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, az] = path[i], [bx, bz] = path[i + 1];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
      const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
      if (d < best) {
        best = d;
        y = ys[i] + (ys[i + 1] - ys[i]) * t;
      }
    }
    return [best, y];
  };
}
/** Largo acumulado de un eje. */
const lengths = (path: P[]) => path.map((_, i) => path.slice(1, i + 1).reduce((s, p, k) => s + Math.hypot(p[0] - path[k][0], p[1] - path[k][1]), 0));

/** Subida: del camino a la plataforma a lo largo de la vuelta (solo la curva, los tramos rectos van a su cota). */
const SUB = (() => {
  const path = subidaPath(), s = lengths(path), L = s[s.length - 1];
  const [s0, s1] = [6, L - 6];
  return { at: rampAlong(path, s.map((v) => Y_CAMINO + (Y_PLAT - Y_CAMINO) * ramp((v - s0) / (s1 - s0), 0.25))), half: TR.subida.ancho / 2 };
})();
/** Rampa de salida: de la plataforma (extremo −x de la huella) al camino. */
const SAL = (() => {
  const path = salidaPath(), s = lengths(path), L = s[s.length - 1];
  const [s0, s1] = [1.5, L - 2.5];
  return { at: rampAlong(path, s.map((v) => Y_PLAT + (Y_CAMINO - Y_PLAT) * ramp((v - s0) / (s1 - s0), 0.25))), half: TR.salida.ancho / 2 };
})();

/** Cota del movimiento de tierra dentro de la faena y su entorno inmediato. */
function graded(x: number, z: number) {
  let h = natural(z);
  // explanada de faena (arriba del talud del frente)
  h = grade(h, rectD(x, z, -40, 90, TR.coronaTalud, TR.frenteZ), Y_FAENA, 1.0);
  // costado −x: ladera a la cota de la bajada (del sector bajo junto al portón a la explanada de faena)
  {
    const d = Math.max(x + 40, 0, z - TR.frenteZ, TR.fondoBajo[0] - 1 - z);
    h = grade(h, d, bajadaY(Math.min(z, TR.frenteZ)), 1.0);
  }
  // plataforma del edificio: tramo con el borde posterior variable y ensanche +x
  {
    const zb = bordePosterior(Math.min(x, 51));
    const d1 = Math.hypot(Math.max(TR.plataformaX - x, 0, x - 51), Math.max(zb - z, 0, z - TR.pieTalud));
    const d2 = rectD(x, z, 51, 90, TR.ensancheZ, TR.pieTalud);
    h = grade(h, Math.min(d1, d2), Y_PLAT, S_PLAT);
  }
  // sector bajo: camino, bolsón, ensanche de la bomba y, junto al portón, estacionamiento
  {
    const zt = piePosterior(x);
    const d = Math.min(rectD(x, z, -120, -12, TR.fondoBajo[0], zt), rectD(x, z, -12, 90, TR.fondoBajo[1], Math.min(zt, TR.ensancheZ - TR.corte)));
    h = grade(h, d, Y_CAMINO, S_PLAT);
  }
  // subida y rampa de salida
  for (const R of [SUB, SAL]) {
    const [dist, y] = R.at(x, z);
    h = grade(h, dist - R.half, y, S_PLAT);
  }
  return h;
}

/** Cierros de la faena (el portón va en el cierro −x). */
export const FENCE = { x0: SITE.gate.x, x1: 72, z0: TR.cierroZ, z1: 50 };

/**
 * Cota del suelo en (x, z): movimiento de tierra dentro de la faena; afuera, la calle del portón
 * (a la cota del camino en el portón), la ladera hacia el barrio por +x y el barrio a la cota de
 * la plataforma. Los camiones, la bomba, el capacho y las cuadrillas se apoyan en esta cota.
 */
export function groundAt(x: number, z: number) {
  let h = graded(Math.max(x, FENCE.x0), z);
  if (x < FENCE.x0) {
    // talud del cierro a la calle (la calle sube del portón al barrio) y más allá, el barrio
    const yc = calleY(z);
    h += (yc - h) * smooth01((FENCE.x0 - x) / 4);
    h += (barrioY(z) - h) * smooth01((ST_E - 4 - x) / 14);
  } else if (x > FENCE.x1) {
    h += (barrioY(z) - h) * smooth01((x - FENCE.x1) / 16);
  }
  return h;
}
/** Borde oeste de la calle del portón. */
const ST_E = SITE.street.x - SITE.street.width / 2;
