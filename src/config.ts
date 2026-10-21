/**
 * Disposición de la faena (coordenadas de la app, metros).
 *
 *  x: a lo largo del edificio (≈ -24 … +26)
 *  z: a lo ancho; +z es la fachada frontal (surponiente según northAngle; donde está la grúa) y -z
 *     la fachada posterior (nororiente), donde corre el camino de los mixers, está la bomba y sube el talud
 *  y: altura; 0 = NPT del 1er piso (cara superior del radier)
 *
 * Todo lo que es "dónde está cada cosa en la obra" se ajusta aquí.
 */
export const SITE = {
  /** Cota del terreno natural alrededor del edificio. */
  groundY: -0.2,

  /** Rumbo del norte en planta (radianes, desde +x hacia -z). Solo para la brújula. */
  northAngle: (3 * Math.PI) / 4,

  /** Grúa torre: al medio del edificio, en el frente (+z), opuesta al camino de mixers. */
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
  /**
   * Bolsón de espera: ensanche al costado del camino (lado del talud), entre el portón y la bomba.
   * En los hormigonados de losa el segundo mixer entra en retroceso y espera aquí (centro del
   * camión) mientras descarga el primero; cuando este sale y lo pasa, retrocede hasta la tolva.
   */
  layby: { x: -29, z: -16.6 },
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
   * Talud de corte en el costado posterior, nororiente (fotos: talud con malla naranja). Su pie queda detrás del
   * camino de mixers, con una franja plana de ~18 m desde la fachada posterior (camino, caseta de la
   * bomba, capacho en reposo y, junto al portón, el estacionamiento y la cancha de lavado).
   */
  talud: { zStart: -25, zTop: -34, height: 6 },

  /**
   * Excavación de las fundaciones (días 1 a 13). La excavadora llega en cama baja y queda en el
   * testero −x (park0); al terminar el sector 3 se estaciona en el testero +x (park1) y se retira.
   * Los camiones tolva entran en retroceso por el portón y el camino posterior igual que los
   * mixers, se apartan antes de la caseta de la bomba a una huella de carguío pegada a la
   * fachada posterior (laneZ; frente a la caseta se corre a laneZPump para no topar su techo) y,
   * para las zanjas del frente, entran a la plataforma por la franja de los peines posteriores
   * (aún sin excavar) hasta innerZ, detrás de la excavadora. entryX = donde salen del camino.
   */
  excavacion: {
    park0: { x: -29.5, z: -4.5 },
    park1: { x: 29.8, z: -4.5 },
    laneZ: -9.45,
    laneZPump: -8.9,
    innerZ: -3.0,
    entryX: -27,
  },
};

/** Duración visual (segundos de simulación a velocidad x1) de cada actividad. */
export const PACE = {
  muroFierro: 9,
  muroMoldaje: 13,
  muroHormigon: 16,
  muroDesmolde: 7.5,
  losaMoldaje: 11,
  losaFierro: 9,
  losaHormigon: 20,
  terminacionesPorPiso: 2.5,
  /**
   * Bomba detenida en cada cambio de mixer: el que terminó sale por el camino y, apenas pasa el
   * bolsón de espera, el siguiente retrocede desde ahí hasta la tolva. Ver Logistics.
   */
  cambioMixer: 3.6,
};

/**
 * Fundaciones (DAYS.fundaciones = 40 días hábiles): segundos de simulación de cada día según lo que
 * pasa ese día (ver core/fundPlan, carta Gantt de 3 sectores en tren). Los días de excavación y de
 * hormigonado llevan más tiempo para que se alcance a ver la excavadora, los camiones y la bomba.
 */
export const FUND_PACE = {
  trazado: 1.2,
  /** Excavación del sector 1 (días 4 a 6: zona profunda A-B y cambio de camión tolva). */
  excavacionS1: 4.2,
  excavacion: 3.0,
  /**
   * Día con una serie de capachos (emplantillado, muros bajo NPT, V.S.C.): el mixer entra en
   * retroceso por el camino (capachoLead) y la grúa hace un viaje de capachoTrip por capacho.
   */
  capachoLead: 4.3,
  capachoTrip: 1.7,
  /** Día de hormigonado de un sector con la bomba estacionaria (dos mixers con cambio al 60 %). */
  bomba: 16,
  dia: 1.0,
  /** Compactación de la plataforma, replanteo y recepción (días 34 a 40). */
  cierre: 0.7,
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

/**
 * Pintura de fachada: subcontrato aparte que trabaja con un andamio colgante (balancín) desde la
 * techumbre, a su propio ritmo e independiente de las terminaciones piso a piso (que siguen con
 * tabiques, ventanas y barandas). Parte cuando la obra gruesa está terminada arriba y baja por
 * paños (franjas verticales del ancho del balancín), una fachada a la vez. El ritmo sale del área
 * real de fachada (caras exteriores de los muros H.A. y cantos de losa, ver core/paintPlan).
 */
export const PINTURA = {
  /** Rendimiento por balancín (2 pintores) y por mano (m²/día). */
  rendimiento: 60,
  /** Manos por paño: empaste y sellador + 2 manos de látex acrílico para exteriores. */
  manos: 3,
  /** Ancho máximo de cada paño (m); el balancín cubre el paño completo sin moverse de lado. */
  anchoPano: 5.5,
  /** Montaje en la techumbre de pescantes, contrapesos, cables y balancín (días hábiles). */
  montajeDias: 4,
  /** Subir, correr los pescantes y bajar por el paño siguiente de la misma fachada. */
  trasladoDias: 1,
  /** Desarmar el balancín y volver a armarlo en la fachada siguiente. */
  cambioFachadaDias: 2,
  /** Retiro final del equipo. */
  desmontajeDias: 2,
  /** Plataforma metálica del balancín (m). */
  plataforma: { largo: 4.5, ancho: 0.75 },
  /** Separación entre la cara de la fachada y la plataforma (m). */
  holgura: 0.25,
  /** Altura de la línea de pintura sobre el piso de la plataforma (alcance del rodillo, m). */
  alcance: 1.3,
};
