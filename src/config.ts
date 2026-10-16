/**
 * Disposición de la faena (coordenadas de la app, metros).
 *
 *  x: a lo largo del edificio (≈ -24 … +26)
 *  z: a lo ancho; +z es la fachada de la entrada (lado poniente, donde está la grúa)
 *  y: altura; 0 = NPT del 1er piso (cara superior del radier)
 *
 * Todo lo que es "dónde está cada cosa en la obra" se ajusta aquí.
 */
export const SITE = {
  /** Cota del terreno natural alrededor del edificio. */
  groundY: -0.2,

  /** Rumbo del norte en planta (radianes, desde +x hacia -z). Solo para la brújula. */
  northAngle: (3 * Math.PI) / 4,

  /** Grúa torre: al medio del edificio, frente a la entrada poniente. */
  crane: {
    x: -1.0,
    z: 12.6,
    mastHeight: 30.5, // altura de la base del giro sobre el terreno
    jibLength: 45,
    counterJibLength: 13,
  },

  /**
   * Bomba estacionaria de hormigón (losas y radier), dentro de su caseta frente al edificio.
   * heading = giro de la caseta; con 0 la tolva mira hacia el camino interior (+z).
   */
  pump: { x: 6.8, z: 16.3, heading: 0 },

  /** Tendido de la tubería por el suelo: frente al edificio, entrada por el hall y llegada al shaft. */
  pipeline: { zFront: 11.2, xEntry: 2.9, zHall: 6.2 },

  /** Punto donde el mixer descarga al capacho (muros) y donde se detiene. */
  mixerCapacho: { x: -6.0, z: 21.5 },
  /** Centro del mixer cuando su canaleta descarga en la tolva de la bomba. */
  mixerPump: { x: 11.5, z: 21.5 },

  /** Accesos y caminos. Los camiones entran por el portón poniente. */
  gate: { x: -56, z: 31 },
  roadZ: 31,
  loopZ: 21.5,
  loopX0: -26,
  loopX1: 27,

  /** Acopios dentro del alcance de la grúa (rectángulos en planta: centro, ancho x, fondo z, giro). */
  acopioMoldajeMuro: { x: -17.5, z: 16.5, w: 10, d: 5.5, rot: 0 },
  acopioMoldajeLosa: { x: 17.5, z: 13.8, w: 9, d: 4.5, rot: 0 },
  acopioFierro: { x: 34, z: 11, w: 7, d: 10, rot: 0 },
  tallerFierro: { x: 36, z: -1, w: 9, d: 9, rot: 0 },
  acopioPuntales: { x: -30, z: 8, w: 5, d: 8, rot: 0 },
  faena: { x: -42, z: 12, w: 18, d: 18, rot: 0 },

  /** Talud de corte en el costado oriente (photos: talud con malla naranja). */
  talud: { zStart: -15, zTop: -24, height: 6 },
};

/** Duración visual (segundos de simulación a velocidad x1) de cada actividad. */
export const PACE = {
  fundaciones: 12,
  muroFierro: 9,
  muroMoldaje: 13,
  muroHormigon: 16,
  muroDesmolde: 7.5,
  losaMoldaje: 11,
  losaFierro: 9,
  losaHormigon: 16,
  terminacionesPorPiso: 2.5,
};

/**
 * Duración real (días hábiles) de cada actividad, para el calendario. Calibrada para que la
 * obra completa dure poco más de un año, como en la programación de la constructora
 * (~290 días hábiles ≈ 13 meses de 22 días).
 */
export const DAYS = {
  fundaciones: 40, // instalación de faena, excavación y zapatas
  muroFierro: 3,
  muroMoldaje: 3,
  muroHormigon: 1,
  muroDesmolde: 1,
  losaMoldaje: 3,
  losaFierro: 3,
  losaHormigon: 1,
  terminacionesPorPiso: 21,
};

/** Días hábiles por mes, para mostrar el mes de obra. */
export const DAYS_PER_MONTH = 22;
