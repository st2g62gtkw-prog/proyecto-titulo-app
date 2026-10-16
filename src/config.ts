/**
 * Disposición de la faena (coordenadas de la app, metros).
 *
 *  x: a lo largo del edificio (≈ -24 … +26)
 *  z: a lo ancho; +z es la fachada poniente (frente, donde está la grúa) y -z la fachada
 *     posterior (oriente), donde corre el camino de los mixers, está la bomba y sube el talud
 *  y: altura; 0 = NPT del 1er piso (cara superior del radier)
 *
 * Todo lo que es "dónde está cada cosa en la obra" se ajusta aquí.
 */
export const SITE = {
  /** Cota del terreno natural alrededor del edificio. */
  groundY: -0.2,

  /** Rumbo del norte en planta (radianes, desde +x hacia -z). Solo para la brújula. */
  northAngle: (3 * Math.PI) / 4,

  /** Grúa torre: al medio del edificio, en el frente poniente (opuesto al camino de mixers). */
  crane: {
    x: -1.0,
    z: 12.6,
    mastHeight: 30.5, // altura de la base del giro sobre el terreno
    jibLength: 45,
    counterJibLength: 13,
  },

  /**
   * Bomba estacionaria de hormigón (losas y radier), dentro de su caseta en el costado posterior,
   * al frente opuesto de la grúa. heading = giro de la caseta: con π/2 la tolva mira hacia +x
   * (donde retrocede el mixer) y la salida de la tubería queda hacia el edificio, en su extremo -x.
   */
  pump: { x: 2.6, z: -10.6, heading: Math.PI / 2 },

  /**
   * Tendido de la tubería por el suelo (planta): de la salida de la bomba entra por la puerta
   * posterior del hall (x = xDoor), cruza al pasillo (z = zHall), sigue por el vestíbulo del
   * ascensor (x = xLobby) y entra al shaft por el vano de su puerta (z = zShaftDoor).
   */
  pipeline: { xDoor: -1.2, zHall: 0.45, xLobby: 0.6, zShaftDoor: 4.0 },

  /** Centro del mixer cuando descarga al capacho (muros): detenido en el carril de entrada. */
  mixerCapacho: { x: 0, z: -14.4 },
  /**
   * Centro del mixer cuando su canaleta descarga en la tolva de la bomba: retrocede por la
   * bahía hasta que la punta de la canaleta (6,28 m detrás del centro) queda sobre la tolva.
   */
  mixerPump: { x: 11.48, z: -10.6 },

  /**
   * Accesos y caminos. Los camiones entran por el portón norponiente (esquina -x del costado
   * posterior; arriba a la izquierda en la vista principal), avanzan por el carril de entrada
   * (z = inZ, hacia +x), dan la vuelta en la rotonda del extremo +x (centro turnX/turnZ, radio turnR)
   * y salen por el carril de salida (z = outZ, hacia -x). La bahía (z = bayZ) es donde el
   * mixer retrocede hasta la bomba y por donde sale hacia la rotonda.
   */
  gate: { x: -56, z: -16.2 },
  road: { inZ: -14.4, outZ: -18.0, bayZ: -10.6, turnX: 36, turnZ: -15.8, turnR: 6.2 },

  /** Acopios dentro del alcance de la grúa (rectángulos en planta: centro, ancho x, fondo z, giro). */
  acopioMoldajeMuro: { x: -17.5, z: 16.5, w: 10, d: 5.5, rot: 0 },
  acopioMoldajeLosa: { x: 17.5, z: 13.8, w: 9, d: 4.5, rot: 0 },
  acopioFierro: { x: 34, z: 11, w: 7, d: 10, rot: 0 },
  tallerFierro: { x: 36, z: -1, w: 9, d: 9, rot: 0 },
  acopioPuntales: { x: -30, z: 8, w: 5, d: 8, rot: 0 },
  faena: { x: -42, z: 12, w: 18, d: 18, rot: 0 },

  /**
   * Talud de corte en el costado oriente (fotos: talud con malla naranja). Su pie queda detrás del
   * camino de mixers y de la rotonda, con una franja plana de ~17 m desde la fachada posterior.
   */
  talud: { zStart: -25, zTop: -34, height: 6 },
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
