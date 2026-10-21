/**
 * Caminos de la faena para los camiones (mixers y camiones tolva): la calle del portón, el giro en
 * retroceso por el portón norponiente, el camino posterior (uno solo, hasta la bomba) y el bolsón
 * de espera. Solo geometría en planta (rutas Route); los horarios los arma cada logística.
 */
import { SITE } from '../config';
import { Route } from './paths';

export type P = [number, number];
export const RZ = SITE.road.z;
const G = SITE.gate, ST = SITE.street, LB = SITE.layby;
/**
 * Carriles de la calle del portón: de llegada (lado de la obra, hacia −z) y de salida (hacia +z; un
 * poco hacia el eje para que al doblar la esquina delantera no pase sobre la vereda de enfrente).
 */
export const LANE_IN = ST.x + ST.width / 4, LANE_OUT = ST.x - ST.width / 4 + 0.35;
/** Radio (eje del camión) del giro en retroceso de la calle al portón y del giro de salida a la calle. */
export const R_IN = 8, R_OUT = G.x - LANE_OUT;
/** Punto de la calle, pasado el portón, donde el camión se detiene antes de retroceder. */
export const WAIT: P = [LANE_IN, RZ - R_IN];
/** Donde aparece y desaparece cada camión en la calle (bajo el tablero en la vista principal). */
export const FAR = RZ + 52;

/** Puntos de un tramo recto cada ~4 m (así el Catmull-Rom no se curva entre dos puntos lejanos). */
export function line(a: P, b: P, step = 4): P[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
  return Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as P);
}

/** Cambio de carril (planta) de a hasta b: avanza en x y se desplaza en z con una S suave. */
export function shift(a: P, b: P, step = 1): P[] {
  const n = Math.max(2, Math.ceil(Math.abs(b[0] - a[0]) / step));
  return Array.from({ length: n + 1 }, (_, i) => {
    const u = i / n;
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u * u * (3 - 2 * u)] as P;
  });
}

/** Arco (planta) de centro c y radio r entre los ángulos a0 y a1 (rad, desde +x hacia +z). */
export function arc(c: P, r: number, a0: number, a1: number): P[] {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 18)));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)] as P;
  });
}

/** Llegada por la calle hasta pasar el portón (de frente, hacia −z). */
export const arrival = () => new Route().add(line([LANE_IN, FAR], WAIT, 6));
/** Retroceso: gira de la calle al portón (la trasera adelante) y sigue por el camino hasta xStop. */
export const reverseTo = (xStop: number) => new Route().add([
  ...arc([LANE_IN + R_IN, RZ - R_IN], R_IN, Math.PI, Math.PI / 2),
  ...line([LANE_IN + R_IN, RZ], [xStop, RZ]).slice(1),
], true);
/** Largo de cada S del bolsón (entrar y salir del camino) y donde empieza la de entrada. */
export const LB_S = 10, LB_IN = LB.x - 4 - LB_S;
/** Retroceso al bolsón: gira de la calle al portón, sigue por el camino y se aparta al bolsón. */
export const reverseToLayby = () => new Route().add([
  ...arc([LANE_IN + R_IN, RZ - R_IN], R_IN, Math.PI, Math.PI / 2),
  ...line([LANE_IN + R_IN, RZ], [LB_IN, RZ]).slice(1),
  ...shift([LB_IN, RZ], [LB_IN + LB_S, LB.z]).slice(1),
  ...line([LB_IN + LB_S, LB.z], [LB.x, LB.z]).slice(1),
], true);
/** Retroceso del bolsón a la tolva: vuelve al camino con una S y sigue derecho hasta xStop. */
export const laybyTo = (xStop: number) => new Route().add([
  ...shift([LB.x, LB.z], [LB.x + LB_S, RZ]),
  ...line([LB.x + LB_S, RZ], [xStop, RZ]).slice(1),
], true);
/** Salida de frente: por el camino hasta el portón, dobla al carril de salida y sigue hacia el barrio. */
export const exitFrom = (xStop: number) => new Route().add([
  ...line([xStop, RZ], [G.x, RZ]),
  ...arc([G.x, RZ + R_OUT], R_OUT, -Math.PI / 2, -Math.PI).slice(1),
  ...line([LANE_OUT, RZ + R_OUT], [LANE_OUT, FAR], 6).slice(1),
]);
