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
  detail: { file: string; groups: DetailGroup[] };
}

export interface LoadedBuilding {
  data: BuildingData;
  detail: ArrayBuffer;
}

export async function loadBuilding(base = import.meta.env.BASE_URL + 'data/'): Promise<LoadedBuilding> {
  const data: BuildingData = await (await fetch(base + 'edificio-e.json')).json();
  const detail = await (await fetch(base + data.detail.file)).arrayBuffer();
  return { data, detail };
}
