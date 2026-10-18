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
   * al frente opuesto de la grúa y al final del camino de mixers. heading = giro de la caseta: con
   * −π/2 la tolva mira hacia −x (hacia el portón, por donde llega el mixer en retroceso) y la salida
   * de la tubería queda en el extremo +x, del lado del talud, justo frente a la puerta posterior del
   * hall (x = pipeline.xDoor), así la tubería va derecho hacia el edificio por el costado de la caseta.
   */
  pump: { x: -5.0, z: -12.0, heading: -Math.PI / 2 },

  /**
   * Tendido de la tubería por el suelo (planta): de la salida de la bomba entra por la puerta
   * posterior del hall (x = xDoor; la puerta del IFC va de x −2,56 a −0,79 y su cara exterior está
   * en z = zDoor), pasa entre los muros del hall y cruza al pasillo (z = zHall), sigue por el
   * vestíbulo del ascensor (x = xLobby) y entra al shaft por el vano de su puerta (z = zShaftDoor,
   * entre el tabique de la puerta y el muro H.A., z 3,69…4,39). Ningún tramo cruza muros de H.A.
   * `door` es el vano de esa puerta (ancho en x y alto), que se dibuja en el muro de fachada.
   */
  pipeline: { xDoor: -1.2, zDoor: -5.8, zHall: 0.45, xLobby: 0.6, zShaftDoor: 4.0, door: { x0: -2.5, x1: -0.85, h: 2.07 } },

  /**
   * Centro del mixer cuando descarga al capacho (muros): detenido en el camino, antes de llegar a
   * la bomba, con la cabina hacia el portón. El capacho se llena en el suelo bajo la punta de la
   * canaleta (≈ 6,3 m detrás del centro, hacia la bomba) y la grúa lo toma ahí, a ~28 m del mástil.
   */
  mixerCapacho: { x: -19.5, z: -12.0 },
  /**
   * Centro del mixer cuando su canaleta descarga en la tolva de la bomba: llega en retroceso hasta
   * que la punta de la canaleta (6,28 m detrás del centro) queda sobre la tolva (pump.x − 2,6).
   */
  mixerPump: { x: -13.88, z: -12.0 },

  /**
   * Accesos y caminos. Los camiones entran por el portón norponiente (en el cierro −x que da a la
   * calle, junto al costado posterior; arriba a la izquierda en la vista principal; con northAngle
   * queda ~32° al poniente del norte visto desde el edificio). El camino posterior es uno solo
   * (eje z = road.z, ancho road.width) y termina en la bomba: el mixer llega por la calle
   * (street, eje x = cte), pasa el portón, retrocede por el portón y por el camino hasta el punto
   * de descarga (capacho o tolva) y sale hacia adelante por el mismo camino y el mismo portón.
   */
  gate: { x: -56, z: -12.0 },
  road: { z: -12.0, width: 5 },
  street: { x: -64, width: 8 },

  /** Acopios dentro del alcance de la grúa (rectángulos en planta: centro, ancho x, fondo z, giro). */
  acopioMoldajeMuro: { x: -17.5, z: 16.5, w: 10, d: 5.5, rot: 0 },
  acopioMoldajeLosa: { x: 17.5, z: 13.8, w: 9, d: 4.5, rot: 0 },
  acopioFierro: { x: 34, z: 11, w: 7, d: 10, rot: 0 },
  tallerFierro: { x: 36, z: -1, w: 9, d: 9, rot: 0 },
  acopioPuntales: { x: -30, z: 8, w: 5, d: 8, rot: 0 },
  faena: { x: -42, z: 12, w: 18, d: 18, rot: 0 },

  /**
   * Talud de corte en el costado oriente (fotos: talud con malla naranja). Su pie queda detrás del
   * camino de mixers, con una franja plana de ~18 m desde la fachada posterior (camino, caseta de la
   * bomba, capacho en reposo y, junto al portón, el estacionamiento y la cancha de lavado).
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
  losaHormigon: 20,
  terminacionesPorPiso: 2.5,
  /**
   * Bomba detenida en cada cambio de mixer: el que terminó sale por el camino y el portón, y recién
   * ahí el siguiente (que esperaba en la calle) retrocede hasta la tolva. Ver Logistics.
   */
  cambioMixer: 6.9,
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
