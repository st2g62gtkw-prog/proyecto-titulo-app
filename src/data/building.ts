/** Datos del Edificio E exportados desde el IFC (ver tools/ifc_to_json.py). */
import type { V2 } from '../scene/geom';

export interface WallData {
  id: string;
  name: string;
  cat: 'fachada' | 'tabique' | 'fondo';
  /** true = muro de hormigón armado (e≈20 cm); false = tabiquería / fachada liviana */
  ha: boolean;
  t: number;
  y0: number;
  y1: number;
  poly: V2[];
  /** Vanos dentro del contorno (shafts, astillas del dibujo). */
  holes: V2[][];
}

export interface SlabData {
  name: string;
  y0: number;
  y1: number;
  outer: V2[];
  holes: V2[][];
  area: number;
}

export interface LevelData {
  name: string;
  elev: number;
  slab: SlabData;
  walls: WallData[];
}

export interface DetailGroup {
  level: string;
  kind: 'window' | 'plate' | 'railing' | 'door';
  offset: number;
  count: number;
}

export interface BuildingData {
  proyecto: string;
  edificio: string;
  levels: LevelData[];
  terrain: { y: number; outer: V2[] };
  /** Interior del shaft del ascensor (por donde sube la tubería de la bomba). */
  shaft: { x0: number; x1: number; z0: number; z1: number } | null;
  detail: { file: string; groups: DetailGroup[] };
  /** Planta de fundaciones (E-01/E-02), cargada aparte desde fundaciones-e.json. */
  fund?: FundData;
}

/** Contorno en planta con agujeros. */
export interface PolyRing {
  ext: V2[];
  holes: V2[][];
}

/** Franja rectangular de zapata corrida (o aislada) de E-01, ya partida por sello y por sector. */
export interface FootingStrip {
  id: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Ancho (lado corto) y largo (lado largo), m. */
  B: number;
  L: number;
  /** Eje largo de la franja. */
  eje: 'x' | 'z';
  sello: number;
  tope: number;
  sector: 1 | 2 | 3;
  /** m² de muro H.A. del 1P sobre la franja. */
  muroHA: number;
}

export interface FundBox {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y0: number;
  y1: number;
}

/** Fundaciones del Edificio E (zapatas corridas, foso del ascensor y V.S.C.), ver tools/ y la especificación. */
export interface FundData {
  hZapata: number;
  plataforma: number;
  emplantillado: number;
  franjas: FootingStrip[];
  /** Excavación por zona de sello: fondo de excavación, sobreancho por lado (off) y talud. */
  excavacion: { sello: number; fondoY: number; H: number; off: number; talud: string; volAprox: number }[];
  /** Contorno superior de la excavación (las islas de terreno son agujeros). */
  bordeExcavacionUnion: PolyRing[];
  huellaPorZona: Record<string, PolyRing[]>;
  foso: { losaFoso: FundBox; vsc: FundBox };
  sectores: { sector: number; x: [number, number]; franjas: number; areaHuella: number; hormigonZapatas_m3: number; fierroZapatas_kg: number; sellos: number[] }[];
}

export interface LoadedBuilding {
  data: BuildingData;
  detail: ArrayBuffer;
}

export async function loadBuilding(base = import.meta.env.BASE_URL + 'data/'): Promise<LoadedBuilding> {
  const data: BuildingData = await (await fetch(base + 'edificio-e.json')).json();
  const [detail, fund] = await Promise.all([
    fetch(base + data.detail.file).then((r) => r.arrayBuffer()),
    fetch(base + 'fundaciones-e.json').then((r) => (r.ok ? (r.json() as Promise<FundData>) : undefined)).catch(() => undefined),
  ]);
  data.fund = fund;
  return { data, detail };
}
