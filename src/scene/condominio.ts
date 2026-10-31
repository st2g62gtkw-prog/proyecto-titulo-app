/**
 * Edificios ya construidos del condominio Espacio Las Tablas, al frente de la obra y más arriba
 * (terraza SITE.condominio). Son iguales al Edificio E, así que se arman con sus mismos datos del
 * IFC (losas, muros de fachada con sus vanos, ventanas, vidrios, barandas y puertas) y la misma
 * paleta que el E terminado (FINISH).
 */
import * as THREE from 'three';
import { SITE } from '../config';
import { groundAt } from '../core/terrain';
import type { BuildingData } from '../data/building';
import { FINISH, detailGeometry, timedGeometry, wallHoles } from './structure';
import { railingsFromIfc, windowsFromIfc, type Center } from './facadeDetail';
import { GeoBuilder, offsetPolygon, polyBounds } from './geom';

export function createCondominio(data: BuildingData, detail: ArrayBuffer): THREE.Group {
  const lv = data.levels;
  const slabs = new GeoBuilder(), walls = new GeoBuilder(), roof = new GeoBuilder();
  lv.forEach((L, i) => {
    if (i > 0) slabs.extrude(L.slab.outer, L.slab.holes, L.slab.y0, L.slab.y1);
    // radier sobre un zócalo que llega al terreno, con la vereda perimetral de 2 m alrededor
    else {
      slabs.extrude(L.slab.outer, [], -1.5, L.slab.y1);
      slabs.extrude(offsetPolygon(L.slab.outer, -2), [], -1.5, SITE.groundY + 0.06);
    }
    for (const w of L.walls) if (w.ha || w.cat === 'fachada') walls.extrude(w.poly, wallHoles(w), w.y0, w.y1);
  });
  // techumbre: parapeto en el borde y cubierta de zincalum
  const top = lv[lv.length - 1].slab;
  walls.extrude(top.outer, [], top.y1, top.y1 + 0.64);
  roof.extrude(offsetPolygon(top.outer, 0.2), [], top.y1 + 0.64, top.y1 + 0.7);
  const std = (color: string, roughness = 0.85, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const parts: [THREE.BufferGeometry, THREE.Material][] = [
    [slabs.build(), std(FINISH.slab)],
    [walls.build(), std(FINISH.facade, 0.9)],
    [roof.build(), std(FINISH.roof, 0.5, 0.3)],
  ];
  const b0 = polyBounds(lv[1].slab.outer);
  const kindMat = {
    window: std(FINISH.pvc, 0.5),
    plate: std(FINISH.glass, 0.25, 0.15),
    railing: std(FINISH.railing, 0.45, 0.4),
    door: std(FINISH.door, 0.6),
  };
  const railGlass = new THREE.MeshStandardMaterial({ color: FINISH.railGlass, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false });
  // ventanas y barandas como en el E (según las elevaciones)
  const bt = polyBounds(top.outer), center: Center = [(bt.x0 + bt.x1) / 2, (bt.z0 + bt.z1) / 2, (bt.x1 - bt.x0) / 2, (bt.z1 - bt.z0) / 2];
  for (const g of data.detail.groups) {
    const src = new Float32Array(detail, g.offset, g.count * 3), walls = lv.find((l) => l.name === g.level)?.walls ?? [];
    if (g.kind === 'window') {
      const w = windowsFromIfc(src, walls, center);
      parts.push([timedGeometry(w.frame, 0, 1, b0.x0, b0.x1), kindMat.window], [timedGeometry(w.glass, 0, 1, b0.x0, b0.x1), kindMat.plate]);
    } else if (g.kind === 'railing') {
      const r = railingsFromIfc(src, center, walls);
      parts.push([timedGeometry(r.rail, 0, 1, b0.x0, b0.x1), kindMat.railing], [timedGeometry(r.glass, 0, 1, b0.x0, b0.x1), railGlass]);
    }
    else parts.push([detailGeometry(detail, g.offset, g.count, 0, 1, b0.x0, b0.x1), kindMat[g.kind]]);
  }
  const cx = (b0.x0 + b0.x1) / 2, cz = (b0.z0 + b0.z1) / 2;
  const group = new THREE.Group();
  group.name = 'condominio';
  for (const [x, z] of SITE.condominio.centros) {
    const g = new THREE.Group();
    for (const [geo, m] of parts) {
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    // el NPT del 1er piso queda 0,20 m sobre la terraza, como el E sobre su plataforma
    g.position.set(x - cx, groundAt(x, z) - SITE.groundY, z - cz);
    group.add(g);
  }
  return group;
}
