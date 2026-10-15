/**
 * Cargas colgadas del gancho de la grúa. Cada una es un Group con origen en el gancho:
 * argolla maestra + 4 eslingas oscuras que bajan hasta la carga (2–3 m bajo el gancho).
 * Materiales y geometría se comparten entre instancias (la 1ª llamada construye un prototipo
 * y las siguientes lo clonan).
 */
import * as THREE from 'three';
import { PartKit, markPickable, metal, paint, type Swatch, type XYZ } from './mixer';

type MatKey = 'sling' | 'link' | 'panelFrame' | 'panelFace' | 'rebar' | 'wire' | 'ply' | 'plyDark' | 'h20' | 'h20End' | 'prop' | 'galv' | 'plate' | 'nut';
let surf: Record<MatKey, Swatch> | null = null;

/** Colores de las cargas sobre los materiales compartidos (pintura / acero). */
function materials() {
  surf ??= {
    sling: paint('#2a2c30'),
    link: metal('#8f969d'),
    panelFrame: metal('#929aa2'),
    panelFace: metal('#555b62'),
    rebar: paint('#7a4a2e'),
    wire: paint('#3a3a3a'),
    ply: paint('#c8963e'),
    plyDark: paint('#b07f34'),
    h20: paint('#f0c02c'),
    h20End: paint('#c0392b'),
    prop: paint('#c62a1f'),
    galv: metal('#b8bdc2'),
    plate: paint('#3d4146'),
    nut: paint('#e08a1e'),
  };
  return surf;
}

/** Argolla maestra en el gancho y eslingas hasta los puntos de amarre. */
function slings(kit: PartKit, points: XYZ[]) {
  const M = materials();
  kit.add(M.link, new THREE.TorusGeometry(0.09, 0.022, 8, 18), [0, -0.1, 0]);
  for (const p of points) kit.bar(M.sling, [0, -0.18, 0], p, 0.016, 5);
}

const protos = new Map<string, THREE.Group>();
function payload(key: string, pickId: string, build: (kit: PartKit, M: Record<MatKey, Swatch>) => void) {
  let proto = protos.get(key);
  if (!proto) {
    const kit = new PartKit();
    build(kit, materials());
    proto = kit.build();
    proto.name = key;
    markPickable(proto, { type: 'carga', id: pickId });
    protos.set(key, proto);
  }
  return proto.clone();
}

/** Paquete de 7 paneles de moldaje de muro (marco de acero gris, módulos 2,4 × 0,9 m). */
export function createPanelPack(): THREE.Group {
  return payload('panelPack', 'moldaje-muro', (kit, M) => {
    const N = 7, T = 0.125, top = -2.3;
    for (let i = 0; i < N; i++) {
      const y = top - (N - i) * T;
      const dx = i % 2 ? 0.03 : -0.02, dz = ((i % 3) - 1) * 0.015;
      const x0 = -1.2 + dx, x1 = 1.2 + dx, z0 = -0.45 + dz, z1 = 0.45 + dz;
      kit.box(M.panelFace, x0, y, z0, x1, y + 0.008, z1);
      kit.box(M.panelFrame, x0, y, z0, x1, y + 0.12, z0 + 0.05);
      kit.box(M.panelFrame, x0, y, z1 - 0.05, x1, y + 0.12, z1);
      kit.box(M.panelFrame, x0, y, z0 + 0.05, x0 + 0.05, y + 0.12, z1 - 0.05);
      kit.box(M.panelFrame, x1 - 0.05, y, z0 + 0.05, x1, y + 0.12, z1 - 0.05);
      for (const x of [-0.6, 0, 0.6]) kit.box(M.panelFrame, x - 0.02 + dx, y + 0.008, z0 + 0.05, x + 0.02 + dx, y + 0.09, z1 - 0.05);
      kit.box(M.panelFrame, x0 + 0.05, y + 0.008, dz - 0.015, x1 - 0.05, y + 0.06, dz + 0.015);
    }
    slings(kit, [[-1.12, top, -0.4], [1.12, top, -0.4], [1.12, top, 0.4], [-1.12, top, 0.4]]);
  });
}

/** Dos paquetes de barras de 6 m (Ø25, color óxido) amarrados con alambre. */
export function createRebarBundle(): THREE.Group {
  return payload('rebar', 'fierro', (kit, M) => {
    const yC = -2.75, step = 0.027, rings = 4;
    const pts: [number, number][] = [[0, 0]];
    for (let k = 1; k <= rings; k++) {
      for (let s = 0; s < 6; s++) {
        const a0 = (s * Math.PI) / 3, a1 = ((s + 1) * Math.PI) / 3;
        for (let j = 0; j < k; j++) {
          const t = j / k;
          pts.push([k * step * (Math.cos(a0) * (1 - t) + Math.cos(a1) * t), k * step * (Math.sin(a0) * (1 - t) + Math.sin(a1) * t)]);
        }
      }
    }
    const R = rings * step + 0.0125;
    for (const zc of [-0.2, 0.2]) {
      pts.forEach(([a, b], i) => {
        const jit = (((i * 37 + (zc > 0 ? 5 : 0)) % 11) / 11 - 0.5) * 0.16;
        kit.cyl(M.rebar, 0.0125, 0.0125, 6, [jit, yC + b, zc + a], 'x', 5, true);
      });
      for (const x of [-2.3, 0, 2.3]) kit.add(M.wire, new THREE.TorusGeometry(R + 0.006, 0.008, 4, 16), [x, yC, zc], [0, Math.PI / 2, 0]);
      for (const x of [-1.8, 1.8]) kit.add(M.sling, new THREE.TorusGeometry(R + 0.014, 0.014, 4, 16), [x, yC, zc], [0, Math.PI / 2, 0]);
    }
    slings(kit, [[-1.8, yC + R, -0.2], [1.8, yC + R, -0.2], [1.8, yC + R, 0.2], [-1.8, yC + R, 0.2]]);
  });
}

/** Moldaje de losa: 10 vigas H20 amarillas (3,9 m) con 8 placas fenólicas encima. */
export function createDeckPack(): THREE.Group {
  return payload('deck', 'moldaje-losa', (kit, M) => {
    const yb = -2.65, X = 1.93;
    for (let i = 0; i < 10; i++) {
      const z = -0.45 + i * 0.1;
      kit.box(M.h20, -X, yb, z - 0.04, X, yb + 0.04, z + 0.04);
      kit.box(M.h20, -X, yb + 0.16, z - 0.04, X, yb + 0.2, z + 0.04);
      kit.box(M.h20, -X, yb + 0.04, z - 0.014, X, yb + 0.16, z + 0.014);
      kit.box(M.h20End, X, yb, z - 0.04, X + 0.02, yb + 0.2, z + 0.04);
      kit.box(M.h20End, -X - 0.02, yb, z - 0.04, -X, yb + 0.2, z + 0.04);
    }
    for (let i = 0; i < 8; i++) {
      const y = yb + 0.2 + i * 0.021;
      const dx = (((i * 7) % 5) - 2) * 0.012;
      kit.box(i % 2 ? M.ply : M.plyDark, -1.22 + dx, y, -0.61, 1.22 + dx, y + 0.021, 0.61);
    }
    const ys = yb + 0.2;
    slings(kit, [[-1.8, ys, -0.45], [1.8, ys, -0.45], [1.8, ys, 0.45], [-1.8, ys, 0.45]]);
  });
}

/** Atado de 20 puntales rojos en canastillo galvanizado. */
export function createPropBundle(): THREE.Group {
  return payload('props', 'puntales', (kit, M) => {
    const yb = -2.9, H = 0.78;
    for (const x of [-1.15, 1.15]) {
      kit.box(M.galv, x - 0.04, yb, -0.45, x + 0.04, yb + 0.06, 0.45);
      kit.box(M.galv, x - 0.04, yb + H - 0.06, -0.45, x + 0.04, yb + H, 0.45);
      for (const z of [-0.45, 0.45]) kit.box(M.galv, x - 0.04, yb, z - 0.03, x + 0.04, yb + H, z + 0.03);
    }
    for (const z of [-0.42, 0.42]) kit.box(M.galv, -1.2, yb, z - 0.03, 1.2, yb + 0.05, z + 0.03);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 5; c++) {
        const y = yb + 0.13 + r * 0.15, z = -0.32 + c * 0.16;
        const d = (r + c) % 2 ? 1 : -1;
        const ox = ((((r * 5 + c) * 13) % 7) - 3) * 0.02;
        kit.cyl(M.prop, 0.03, 0.03, 1.8, [ox - d * 0.6, y, z], 'x', 8);
        kit.cyl(M.galv, 0.024, 0.024, 1.25, [ox + d * 0.9, y, z], 'x', 8);
        kit.cyl(M.nut, 0.045, 0.045, 0.1, [ox + d * 0.32, y, z], 'x', 8);
        kit.boxAt(M.plate, 0.012, 0.13, 0.13, [ox - d * 1.5, y, z]);
        kit.boxAt(M.plate, 0.012, 0.13, 0.13, [ox + d * 1.53, y, z]);
      }
    }
    const yt = yb + H;
    slings(kit, [[-1.15, yt, -0.45], [1.15, yt, -0.45], [1.15, yt, 0.45], [-1.15, yt, 0.45]]);
  });
}
