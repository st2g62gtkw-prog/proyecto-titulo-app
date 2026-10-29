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
   * mixers y se apartan a una huella de carguío pegada a la fachada posterior (laneZ; la caseta de la
   * bomba se arma recién cuando sale el último camión, así que la huella va derecho) y,
   * para las zanjas del frente, entran a la plataforma por la franja de los peines posteriores
   * (aún sin excavar) hasta innerZ, detrás de la excavadora. entryX = donde salen del camino.
   */
  excavacion: {
    park0: { x: -29.5, z: -4.5 },
    park1: { x: 29.8, z: -4.5 },
    laneZ: -9.8,
    innerZ: -3.4,
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
  /** Obra gruesa sobre la losa de techumbre: parapetos y sala de máquinas (ver TECHO); viajes de grúa al ritmo de los pisos. */
  techoFierro: 9,
  techoMoldaje: 9,
  techoHormigon: 16,
  techoDesmolde: 7.5,
  salaLosa: 18,
  /**
   * Cada piso de terminaciones. La techumbre (estructura, aislación y cubierta) y la pintura de
   * fachada avanzan en paralelo con estas, así que el ritmo da tiempo para verlas.
   */
  terminacionesPorPiso: 6,
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
 * (~300 días hábiles ≈ 13,6 meses de 22 días).
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
  /** Parapetos y muros de la sala de máquinas (+17,50 → +18,14 y +20,09) y su losa de cielo. */
  techoFierro: 1,
  techoMoldaje: 2,
  techoHormigon: 1,
  techoDesmolde: 1,
  salaLosa: 2,
  terminacionesPorPiso: 21,
};

/** Días hábiles por mes, para mostrar el mes de obra. */
export const DAYS_PER_MONTH = 22;

/**
 * Obras sobre la losa de techumbre (+17,50). Fuentes: lámina L41 (planta de techumbre y "SUP
 * TECHOS"), elevaciones L42, cubicación (respaldos oct 2026), itemizado cap. 3 "Techumbre y
 * hojalatería" y el cronograma detallado (oct 2026).
 *  - Parapetos de H.A. en todo el borde (V.I. 15/80 y testeros e = 20) de +17,50 a +18,14.
 *  - Caja de escala y sala de máquinas sobre el núcleo (ejes K.–M. / 3–7): muros H.A. e = 20 hasta
 *    +19,93 y losa de cielo e = 16 hasta +20,09, con su propia cubierta.
 *  - Techumbre liviana (supuesto de la cubicación, pendiente 6): cerchas y costaneras de pino
 *    impregnado con tapa OSB, aislación (Aislán) y cubierta de zincalum prepintado 0,5 mm
 *    emballetada con pendiente 1,5 % (L41): faldón norte (posterior), central y sur (franja frontal).
 *  - Hojalatería: canales, forros de parapeto, cumbreras y ventilaciones de los shafts.
 *  - Aguas lluvia: 4 bajadas de PVC Ø160 con cubeta en las esquinas (bajan por shafts interiores)
 *    y 2 de PVC Ø110 desde la cubierta de la caja hasta la techumbre.
 */
export const TECHO = {
  /** Alto sobre la losa, espesor y largo máximo de cada tramo que se hormigona por separado. */
  parapeto: { alto: 0.64, espesor: 0.15, tramo: 6 },
  caja: {
    /**
     * Contorno en planta (zonas A + B + C de "SUP TECHOS": sala de telecomunicaciones, shaft de
     * los ascensores y llegada de la escalera con su vestíbulo), medido desde la esquina (x0, z0)
     * del interior del shaft del ascensor del modelo.
     */
    contorno: [[-0.21, -2.24], [4.06, -2.24], [4.06, 0.01], [9.03, 0.01], [9.03, 3.53], [2.147, 3.53], [2.147, 3.8], [-0.21, 3.8]] as [number, number][],
    espesor: 0.2,
    /** Coronamiento de los muros (bajo la losa de cielo) y cara superior de la losa. */
    muroTop: 19.93,
    losaTop: 20.09,
    /** Salida a la techumbre (cara +z del vestíbulo junto al eje M, vano 105 × 219): desde x0 del shaft. */
    salida: { d: 3.42, ancho: 1.05, alto: 2.19 },
    /** Puerta de la sala (eje M, cara +x de la zona A; dintel +19,69 → vano 105 × 219): desde z0 del shaft. */
    puerta: { d: -1.66, ancho: 1.05, alto: 2.19 },
    /** Pasada de despresurización 72 × 72 bajo la losa de cielo (cara −z de la zona C): desde x0 del shaft. */
    pasada: { d: 4.96, lado: 0.72 },
  },
  cubierta: {
    pendiente: 0.015,
    /** Alto de la techumbre en la línea de canal (cercha + costanera + OSB + aislación + plancha). */
    base: 0.14,
    /** Separación de cerchas (a lo largo del edificio), de costaneras y ancho de plancha emballetada. */
    cerchas: 1.0,
    costaneras: 0.6,
    plancha: 0.5,
  },
  /**
   * Días hábiles del capítulo 3 y partidas ligadas, según el cronograma detallado: la estructura
   * parte 5 días después de la última losa (2.14 FC+5); la aislación y la hojalatería se traslapan
   * (CC+5 / FF+3 y CC+3 / FF+3); las aguas lluvia parten 10 días después de la hojalatería (CC+10);
   * la grúa se desmonta 5 días después de la estructura (3.1 FF+5) y el subcontrato de ascensores
   * entra con la sala de máquinas y la cubierta terminadas (3.3 FC).
   */
  dias: {
    desfase: 5,
    estructura: 33,
    aislacion: [16, 21] as [number, number],
    cubierta: [19, 36] as [number, number],
    aguas: [29, 10] as [number, number],
    grua: 5,
    ascensor: 20,
  },
};

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
