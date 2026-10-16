/**
 * Cifras del proyecto (fuente: carpeta "Proyecto de titulo 07-10" en Drive).
 *  - Catálogo de documentación (CATALOGO.md): permiso, programa, arquitectura y EETT.
 *  - "Cubicación Edificio E – respaldos (oct 2026)": hormigón, moldaje y enfierradura.
 *  - "Itemizado Edificio E – cantidades (oct 2026)".
 *  - Visita a terreno 09-10-2026 (fotos): grúa torre, dotación en obra.
 */

export const PROJECT = {
  nombre: 'Espacio Las Tablas',
  conjunto: 'Condominio Espacio Las Lomas – Las Tablas',
  edificio: 'Edificio E',
  ubicacion: 'Av. Las Tablas, Placilla-Peñuelas / Curauma, Valparaíso',
  mandante: 'Inmobiliaria Umbrales Quince SpA',
  constructora: 'Constructora Umbrales SpA',
  arquitectura: 'Alberto Hurtado Arquitectos Asociados',
  calculo: 'Alfonso Larraín Vial y Asoc.',
  permiso: 'PE N° 90 · DOM Valparaíso · 25-05-2023',
  metodo: 'Hormigón armado tradicional · muros e=20 cm y losas e=16 cm',
};

export const BUILDING_FACTS = {
  pisos: 7,
  deptos: 93,
  supUtil: 3812.67,
  supComun: 856.66,
  supTotal: 4669.33,
  altura: 17.92,
  pisoAPiso: 2.5,
  hormigon: 'G25 (NCh 170:2016)',
  acero: 'A630-420H',
  suelo: 'Maicillo a roca meteorizada (U3) · qa 2,0 kg/cm²',
  tipologias: [
    { tipo: 'A1e', programa: '2D+1B', sup: 46.3, n: 14 },
    { tipo: 'B1', programa: '1D+1B', sup: 36.74, n: 50 },
    { tipo: 'C1', programa: '2D+1B', sup: 45.27, n: 12 },
    { tipo: 'E1e', programa: '1D+1B', sup: 36.28, n: 11 },
    { tipo: 'F1e', programa: '1D+1B', sup: 40.3, n: 6 },
  ],
};

/** Programa por piso (L38, L39, L40). */
export const FLOOR_PROGRAM: Record<string, { deptos: number; util: number; comun: number; uso: string }> = {
  '1P': { deptos: 4, util: 287.19, comun: 291.86, uso: 'Hall, estacionamientos 1E–41E, bodegas, bicicleteros, sala eléctrica y basura' },
  '2P': { deptos: 14, util: 555.68, comun: 93.83, uso: 'Departamentos' },
  '3P': { deptos: 15, util: 594.0, comun: 89.93, uso: 'Departamentos' },
  '4P': { deptos: 15, util: 594.0, comun: 89.93, uso: 'Departamentos' },
  '5P': { deptos: 15, util: 594.0, comun: 89.93, uso: 'Departamentos' },
  '6P': { deptos: 15, util: 594.0, comun: 89.93, uso: 'Departamentos' },
  '7P': { deptos: 15, util: 594.0, comun: 89.93, uso: 'Departamentos' },
  Techumbre: { deptos: 0, util: 0, comun: 21.32, uso: 'Cubierta plana 1,5 %, sala de máquinas' },
};

/** Totales de obra gruesa (cubicación NCh353:2018). */
export const TOTALS = {
  hormigonFundaciones: 361.77 + 18.91 + 5.32,
  hormigonElevaciones: 842.1,
  hormigonLosas: 737.31,
  hormigonTotal: 1978.34,
  aceroFundaciones: 14074.6,
  aceroElevaciones: 72709.9,
  aceroLosas: 78059.9,
  aceroTotal: 166009.8,
  moldajeFundaciones: 597.29,
  moldajeElevaciones: 8399.17,
  moldajeLosas: 4652.93,
  moldajeTotal: 13741.53,
  radier: 665.68,
  excavacion: 573.91 + 53.39,
};

/** Hormigón de muros (elevaciones) por piso, m³. Incluye vigas invertidas de antepecho del piso. */
export const WALL_M3: Record<string, number> = {
  '1P': 95.53,
  '2P': 119.96,
  '3P': 119.4,
  '4P': 119.37,
  '5P': 119.37,
  '6P': 119.37,
  '7P': 119.37,
};
/** Parapetos de techo y sala de máquinas, m³. */
export const ROOF_WALL_M3 = 29.73;

/** Hormigón de losas por piso (la losa que se apoya sobre los muros de ese piso), m³. */
export const SLAB_M3: Record<string, number> = {
  '2P': 100.37, // losa cielo 1P
  '3P': 105.17, // losa cielo 2P
  '4P': 105.2,
  '5P': 105.2,
  '6P': 105.2,
  '7P': 105.2,
  Techumbre: 105.2 + 5.77, // losa cielo 7P + losa sala de máquinas
};

export const RATIOS = {
  aceroMuroPorM3: TOTALS.aceroElevaciones / TOTALS.hormigonElevaciones,
  aceroLosaPorM3: TOTALS.aceroLosas / TOTALS.hormigonLosas,
  moldajeMuroPorM3: TOTALS.moldajeElevaciones / TOTALS.hormigonElevaciones,
  moldajeLosaPorM3: TOTALS.moldajeLosas / TOTALS.hormigonLosas,
};

export const EQUIPMENT = {
  mixerM3: 7,
  capachoM3: 1,
  grua: { modelo: 'Grúa torre (Pingon)', alturaGancho: 32, pluma: 45, cargaPunta: '1,3 t', cargaMax: '6 t' },
  bomba: { tipo: 'Bomba estacionaria sobre remolque', caudal: '~60 m³/h' },
  dotacion: 85,
};
