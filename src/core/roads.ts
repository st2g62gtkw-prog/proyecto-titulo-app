/**
 * Caminos de la faena para los camiones (mixers y camiones tolva): la calle del portón, el giro en
 * retroceso por el portón norponiente, el camino posterior (uno solo, a la cota del camino, que
 * termina antes del extremo +x), el ensanche de la bomba, el bolsón de espera y la rampa entre el
 * camino, junto al portón, y la huella de carguío. Solo geometría en planta (rutas Route); los horarios los arma
 * cada logística.
 */
import { SITE } from '../config';
import { Route } from './paths';

export type P = [number, number];
export const RZ = SITE.road.z;
const G = SITE.gate, ST = SITE.street, LB = SITE.layby, TR = SITE.terreno;
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
/** Largo de la S con que el mixer se corre del eje del camino al ensanche de la bomba. */
export const BAY_S = 15;

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

/** Del eje del camino al punto de detención: derecho por el camino y, si queda al costado (ensanche de la bomba), con una S al final. */
const alongTo = (x0: number, xStop: number, zStop: number): P[] =>
  Math.abs(zStop - RZ) < 0.01
    ? line([x0, RZ], [xStop, RZ])
    : [...line([x0, RZ], [xStop - BAY_S, RZ]), ...shift([xStop - BAY_S, RZ], [xStop, zStop]).slice(1)];

/** Llegada por la calle hasta pasar el portón (de frente, hacia −z). */
export const arrival = () => new Route().add(line([LANE_IN, FAR], WAIT, 6));
/** Retroceso: gira de la calle al portón (la trasera adelante) y sigue por el camino hasta (xStop, zStop). */
export const reverseTo = (xStop: number, zStop = RZ) => new Route().add([
  ...arc([LANE_IN + R_IN, RZ - R_IN], R_IN, Math.PI, Math.PI / 2),
  ...alongTo(LANE_IN + R_IN, xStop, zStop).slice(1),
], true);
/** Retroceso al bolsón (en el ensanche de la bomba): gira de la calle al portón, sigue por el camino y se corre al ensanche con una S. */
export const reverseToLayby = () => new Route().add([
  ...arc([LANE_IN + R_IN, RZ - R_IN], R_IN, Math.PI, Math.PI / 2),
  ...alongTo(LANE_IN + R_IN, LB.x, LB.z).slice(1),
], true);
/** Retroceso del bolsón a la tolva: derecho por el ensanche hasta (xStop, zStop). */
export const laybyTo = (xStop: number, zStop = RZ) => new Route().add(
  Math.abs(zStop - LB.z) < 0.01 ? line([LB.x, LB.z], [xStop, zStop], 2) : [...shift([LB.x, LB.z], [LB.x + BAY_S, RZ]), ...alongTo(LB.x + BAY_S, xStop, zStop).slice(1)],
  true,
);
/** Del portón a la calle: dobla al carril de salida y sigue hacia el barrio. */
const toStreet = (): P[] => [
  ...arc([G.x, RZ + R_OUT], R_OUT, -Math.PI / 2, -Math.PI),
  ...line([LANE_OUT, RZ + R_OUT], [LANE_OUT, FAR], 6).slice(1),
];
/** Salida de frente: (del ensanche, con una S) por el camino hasta el portón, dobla al carril de salida y sigue hacia el barrio. */
export const exitFrom = (xStop: number, zStop = RZ) => new Route().add([
  ...alongTo(G.x, xStop, zStop).reverse(),
  ...toStreet().slice(1),
]);

// ---------------------------------------------------------------------------------------
// Camiones tolva (excavación): entran en retroceso por el portón y la rampa, salen de frente por ella
// ---------------------------------------------------------------------------------------

/** Cuánto se corre hacia atrás la huella de carguío en el tramo −x (zona profunda A-B). */
export const LANE_DIP = 1.25;
const smooth01 = (x: number) => {
  const u = Math.min(Math.max(x, 0), 1);
  return u * u * (3 - 2 * u);
};
/** Eje z de la huella de carguío en x: pegada a la fachada posterior y más atrás frente a la zona profunda A-B. */
export function laneZ(x: number) {
  return SITE.excavacion.laneZ - LANE_DIP * (1 - smooth01((x + 15.9) / 8));
}

/** Eje de la rampa (sube y baja de la plataforma): del extremo −x de la huella baja con una S al camino. */
export function salidaPath(): P[] {
  const S = TR.salida;
  return shift([S.x0, laneZ(S.x0)], [S.x1, RZ], 1);
}
/**
 * Entrada en retroceso: desde la calle (pasado el portón, en WAIT) gira por el portón, sube la rampa
 * hasta la huella y queda en su extremo −x (x = salida.x0), con la cabina hacia la rampa.
 */
export const backUpRamp = (): P[] => [
  ...arc([LANE_IN + R_IN, RZ - R_IN], R_IN, Math.PI, Math.PI / 2),
  ...salidaPath().reverse(),
];
/** Rampa de salida y camino hasta el portón, la calle y el barrio. */
export const salidaToStreet = (): P[] => [
  ...salidaPath(),
  ...line([TR.salida.x1, RZ], [G.x, RZ]).slice(1),
  ...toStreet().slice(1),
];
