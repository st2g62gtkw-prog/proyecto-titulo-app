/**
 * Pintura de fachada: una "piel" delgada sobre las caras exteriores de los muros H.A. y los cantos
 * de losa (core/paintPlan) que muestra el hormigón visto hasta que pasa el balancín y luego la
 * pintura, de arriba hacia abajo en cada paño a medida que baja la plataforma. Justo sobre la
 * línea de trabajo se ve el sellador blanco recién aplicado, que da paso al color final.
 *
 * Cada vértice lleva:
 *   aPaint = (t0, t1)  bajada del balancín por su paño (s de simulación)
 *   aBox   = (y0, h)   tramo vertical que recorre la línea de pintura en esa bajada
 *   aFrom  = t         desde cuándo existe la cara (fachada liviana: cuando la levantan)
 * La malla tiene matriz de mundo identidad (vértices en coordenadas de mundo), como las de reveal.
 */
import * as THREE from 'three';
import type { PaintPlan } from '../core/paintPlan';
import { uTime } from './reveal';
import { concreteTexture } from './textures';

/** Separación de la piel respecto de la cara del hormigón (m). */
const SKIN = 0.012;

export const FACADE_COLORS = {
  raw: '#c9c6bf', // mismo hormigón de los muros (structure.ts)
  seal: '#f7f6f1', // empaste y sellador
  paint: '#eee6d4', // látex de fachada (crema, distinto del hormigón visto)
};

export function buildFacadePaint(plan: PaintPlan, clipping: THREE.Plane[]): THREE.Mesh {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], tp: number[] = [], box: number[] = [], from: number[] = [], idx: number[] = [];
  const yBot = plan.groundY, H = plan.roofY - plan.groundY;
  for (const pc of plan.pieces) {
    const p = plan.panos[pc.pano];
    const [nx, nz] = pc.n;
    const len = Math.hypot(pc.b[0] - pc.a[0], pc.b[1] - pc.a[1]);
    // la textura avanza con la tangente de la fachada (las caras de un mismo paño empalman)
    const u0 = (p.facade.axis === 'x' ? pc.a[0] : pc.a[1]) / 2.4;
    const corners: [number, number, number, number][] = [
      [pc.a[0], pc.y0, pc.a[1], 0], [pc.b[0], pc.y0, pc.b[1], len], [pc.b[0], pc.y1, pc.b[1], len], [pc.a[0], pc.y1, pc.a[1], 0],
    ];
    const base = pos.length / 3;
    for (const [x, y, z, s] of corners) {
      pos.push(x + nx * SKIN, y, z + nz * SKIN);
      nor.push(nx, 0, nz);
      uv.push(u0 + s / 2.4, y / 2.4);
      tp.push(p.down[0], p.down[1]);
      box.push(yBot, H);
      from.push(pc.from);
    }
    // sentido de las caras hacia afuera: (b − a) × arriba debe apuntar como n
    const cross = (pc.b[1] - pc.a[1]) * 1 * nx - (pc.b[0] - pc.a[0]) * nz;
    if (cross < 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aPaint', new THREE.Float32BufferAttribute(tp, 2));
  g.setAttribute('aBox', new THREE.Float32BufferAttribute(box, 2));
  g.setAttribute('aFrom', new THREE.Float32BufferAttribute(from, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();

  const tex = concreteTexture();
  const mat = new THREE.MeshStandardMaterial({
    color: FACADE_COLORS.raw, map: tex, roughness: 0.92,
    // queda pegada al hormigón: se adelanta en profundidad para no parpadear con la cara del muro
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  mat.clippingPlanes = clipping;
  const uniforms = {
    uT: uTime,
    uRaw: { value: new THREE.Color(FACADE_COLORS.raw) },
    uSeal: { value: new THREE.Color(FACADE_COLORS.seal) },
    uPaint: { value: new THREE.Color(FACADE_COLORS.paint) },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aPaint;\nattribute vec2 aBox;\nattribute float aFrom;\nvarying vec2 vPaint;\nvarying vec2 vBox;\nvarying float vY;\nvarying float vFrom;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaint = aPaint;\nvBox = aBox;\nvY = transformed.y;\nvFrom = aFrom;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uT;\nuniform vec3 uRaw;\nuniform vec3 uSeal;\nuniform vec3 uPaint;\nvarying vec2 vPaint;\nvarying vec2 vBox;\nvarying float vY;\nvarying float vFrom;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (uT < vFrom) discard;
        {
          float dur = max(vPaint.y - vPaint.x, 1e-4);
          float p = clamp((uT - vPaint.x) / dur, 0.0, 1.0);
          float line = vBox.x + vBox.y * (1.0 - p);
          if (uT >= vPaint.x && vY >= line) {
            // instante en que la línea de pintura pasó por esta altura: lo recién pasado es sellador
            float tp = mix(vPaint.x, vPaint.y, clamp(1.0 - (vY - vBox.x) / max(vBox.y, 1e-3), 0.0, 1.0));
            float age = (uT - tp) / dur;
            vec3 c = mix(uSeal, uPaint, smoothstep(0.015, 0.09, age));
            // conserva un poco del moteado del hormigón bajo la pintura
            vec3 grain = diffuseColor.rgb / max(uRaw, vec3(1e-3));
            diffuseColor.rgb = c * mix(vec3(1.0), grain, 0.22);
          }
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'facade-paint';

  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'pintura-fachada';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}
