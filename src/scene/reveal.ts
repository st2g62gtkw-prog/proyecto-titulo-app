/**
 * Materiales "reveal": hacen aparecer, crecer o retirar los elementos de la obra
 * según el tiempo de simulación, sin recrear geometría.
 *
 * Cada vértice lleva:
 *   aT   = (in0, in1, out0, out1)  ventana de aparición y de retiro (segundos de simulación)
 *   aBox = (y0, h)                 base y altura del elemento (modo "rise")
 *
 * Modos de aparición:
 *   rise   el elemento crece de abajo hacia arriba (fierro de muros, hormigón en moldaje)
 *   drop   el elemento baja desde arriba hasta su lugar (moldajes que coloca la grúa)
 *   sweep  la losa se llena en franjas en zig-zag, como avanza la bomba (strips = 0: barrido lineal en x);
 *          con `pause` el barrido se detiene en esa ventana (cambio de mixer) y sigue después
 *   pop    aparece de golpe en in0
 *
 * Retiro: entre out0 y out1 el elemento se desplaza `outLift` (p. ej. sube con la grúa)
 * y desaparece en out1.
 *
 * Las mallas que usan estos materiales deben tener matriz de mundo identidad
 * (sus vértices ya están en coordenadas de mundo).
 */
import * as THREE from 'three';

export type RevealMode = 'rise' | 'drop' | 'sweep' | 'pop';

/** Tiempo global de simulación compartido por todos los materiales. */
export const uTime = { value: 0 };

export interface RevealOptions {
  mode: RevealMode;
  /** Altura desde la que bajan los elementos en modo drop (m). */
  dropHeight?: number;
  /** Desplazamiento durante el retiro (m). */
  outLift?: THREE.Vector3;
  /** Simula hormigón fresco que se va secando (color y brillo). */
  concrete?: boolean;
  /** Segundos de simulación que tarda el hormigón en "secar" visualmente. */
  cureTime?: number;
  /** Dibuja las caras interiores como tapa plana (para el llenado en modo rise). */
  cap?: boolean;
  /** Parámetros de barrido en zig-zag (modo sweep): rectángulo xz y número de franjas. */
  sweep?: { xmin: number; xmax: number; zmin: number; zmax: number; strips: number; dir?: 1 | -1 };
  /** Modo sweep: ventana (s de simulación, dentro de in0..in1) en que el barrido queda detenido. */
  pause?: [number, number];
  /** Si se define, la ventana de retiro (out0..out1) pinta el elemento de este color en vez de retirarlo. */
  paint?: THREE.ColorRepresentation;
}

const WET = new THREE.Color('#5d6064');

function makeUniforms(o: RevealOptions) {
  const s = o.sweep ?? { xmin: 0, xmax: 1, zmin: 0, zmax: 1, strips: 1, dir: 1 };
  return {
    uT: uTime,
    uDrop: { value: o.dropHeight ?? 3.0 },
    uOutLift: { value: o.outLift ?? new THREE.Vector3(0, 6, 0) },
    uCure: { value: o.cureTime ?? 25 },
    uWet: { value: WET.clone() },
    uSweep: { value: new THREE.Vector4(s.xmin, s.xmax, s.zmin, s.zmax) },
    uStrips: { value: s.strips },
    uSweepDir: { value: s.dir ?? 1 },
    uPause: { value: new THREE.Vector2(...(o.pause ?? [NEVER, NEVER])) },
    uPaint: { value: new THREE.Color(o.paint ?? '#dcdad4') },
  };
}

const COMMON_DECL = /* glsl */ `
uniform float uT;
uniform float uDrop;
uniform vec3 uOutLift;
uniform float uCure;
uniform vec3 uWet;
uniform vec4 uSweep;
uniform float uStrips;
uniform float uSweepDir;
uniform vec2 uPause;
uniform vec3 uPaint;
varying vec3 vRvWorld;
varying vec4 vRvT;
varying vec2 vRvBox;
varying float vRvHide;

// Tiempo en que el barrido en zig-zag alcanza el punto (x, z): 0..1 dentro de [in0, in1]
float rvSweepFrac(vec2 xz) {
  float fx = clamp((xz.x - uSweep.x) / max(uSweep.y - uSweep.x, 1e-3), 0.0, 0.9999);
  if (uSweepDir < 0.0) fx = 0.9999 - fx;
  if (uStrips < 0.5) return fx;
  float fz = clamp((xz.y - uSweep.z) / max(uSweep.w - uSweep.z, 1e-3), 0.0, 1.0);
  float strip = floor(fx * uStrips);
  float along = mod(strip, 2.0) < 0.5 ? fz : 1.0 - fz;
  return (strip + along) / uStrips;
}

// Tiempo "de vaciado": el reloj sin la pausa del barrido (igual a uT si no hay pausa)
float rvPauseLen() { return uPause.y - uPause.x; }
float rvPoured(float t) { return t - clamp(t - uPause.x, 0.0, rvPauseLen()); }
`;

const VERTEX_DECL = /* glsl */ `
attribute vec4 aT;
attribute vec2 aBox;
`;

const VERTEX_BODY = /* glsl */ `
  vRvT = aT;
  vRvBox = aBox;
  vRvHide = 0.0;
  #ifdef REVEAL_PAINT
    if (uT < aT.x) vRvHide = 1.0;
  #else
    if (uT < aT.x || uT >= aT.w) vRvHide = 1.0;
  #endif
  #ifdef REVEAL_DROP
    float rvIn = clamp((uT - aT.x) / max(aT.y - aT.x, 1e-4), 0.0, 1.0);
    rvIn = 1.0 - pow(1.0 - rvIn, 3.0);
    transformed.y += uDrop * (1.0 - rvIn);
  #endif
  #ifndef REVEAL_PAINT
    float rvOut = clamp((uT - aT.z) / max(aT.w - aT.z, 1e-4), 0.0, 1.0);
    rvOut = rvOut * rvOut * (3.0 - 2.0 * rvOut);
    transformed += uOutLift * rvOut;
  #endif
  vRvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAGMENT_DISCARD = /* glsl */ `
  if (vRvHide > 0.5) discard;
  #ifdef REVEAL_RISE
    float rvP = clamp((uT - vRvT.x) / max(vRvT.y - vRvT.x, 1e-4), 0.0, 1.0);
    if (vRvWorld.y > vRvBox.x + vRvBox.y * rvP + 0.001) discard;
  #endif
  #ifdef REVEAL_SWEEP
    float rvP = (rvPoured(uT) - vRvT.x) / max(vRvT.y - vRvT.x - rvPauseLen(), 1e-4);
    if (rvP < rvSweepFrac(vRvWorld.xz)) discard;
  #endif
`;

const FRAGMENT_CONCRETE = /* glsl */ `
  #ifdef REVEAL_CONCRETE
    float rvReveal;
    #ifdef REVEAL_SWEEP
      // instante en que el barrido pasó por este punto (después de la pausa, si ya la había pasado)
      rvReveal = mix(vRvT.x, vRvT.y - rvPauseLen(), rvSweepFrac(vRvWorld.xz));
      if (rvReveal > uPause.x) rvReveal += rvPauseLen();
    #else
      rvReveal = mix(vRvT.x, vRvT.y, clamp((vRvWorld.y - vRvBox.x) / max(vRvBox.y, 1e-3), 0.0, 1.0));
    #endif
    float rvWetK = 1.0 - smoothstep(0.0, uCure, uT - rvReveal);
    diffuseColor.rgb = mix(diffuseColor.rgb, uWet, rvWetK * 0.9);
  #endif
  #ifdef REVEAL_PAINT
    float rvPaint = smoothstep(vRvT.z, vRvT.w, uT);
    diffuseColor.rgb = mix(diffuseColor.rgb, uPaint, rvPaint);
  #endif
`;

function patchVertex(src: string) {
  return src
    .replace('#include <common>', '#include <common>\n' + COMMON_DECL + VERTEX_DECL)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERTEX_BODY);
}

function patchFragmentDiscardOnly(src: string) {
  return src
    .replace('#include <common>', '#include <common>\n' + COMMON_DECL)
    .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FRAGMENT_DISCARD);
}

function defines(o: RevealOptions): Record<string, string> {
  const d: Record<string, string> = {};
  if (o.mode === 'rise') d.REVEAL_RISE = '';
  if (o.mode === 'drop') d.REVEAL_DROP = '';
  if (o.mode === 'sweep') d.REVEAL_SWEEP = '';
  if (o.concrete) d.REVEAL_CONCRETE = '';
  if (o.cap) d.REVEAL_CAP = '';
  if (o.paint !== undefined) d.REVEAL_PAINT = '';
  return d;
}

export interface RevealMaterial extends THREE.MeshStandardMaterial {
  userData: { revealUniforms: ReturnType<typeof makeUniforms>; depth: THREE.MeshDepthMaterial };
}

/**
 * Crea un MeshStandardMaterial con animación de aparición, más su material de profundidad
 * para que las sombras respeten lo que todavía no existe.
 */
export function revealMaterial(params: THREE.MeshStandardMaterialParameters, o: RevealOptions): RevealMaterial {
  const uniforms = makeUniforms(o);
  const m = new THREE.MeshStandardMaterial(params) as RevealMaterial;
  m.defines = { ...(m.defines ?? {}), ...defines(o) };
  if (o.cap) m.side = THREE.DoubleSide;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = patchVertex(sh.vertexShader);
    let fs = patchFragmentDiscardOnly(sh.fragmentShader);
    fs = fs.replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAGMENT_CONCRETE);
    if (o.concrete) {
      fs = fs.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        #ifdef REVEAL_CONCRETE
          roughnessFactor = mix(roughnessFactor, 0.32, rvWetK);
        #endif`,
      );
    }
    if (o.cap) {
      fs = fs.replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        if (!gl_FrontFacing) { normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz); }`,
      );
    }
    sh.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => 'reveal-' + JSON.stringify(m.defines);

  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.defines = { ...defines(o) };
  depth.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = patchVertex(sh.vertexShader);
    sh.fragmentShader = patchFragmentDiscardOnly(sh.fragmentShader);
  };
  depth.customProgramCacheKey = () => 'reveal-depth-' + JSON.stringify(depth.defines);
  m.userData = { revealUniforms: uniforms, depth };
  return m;
}

/** Crea la malla con su material de profundidad ya asignado. */
export function revealMesh(geo: THREE.BufferGeometry, mat: RevealMaterial, shadows = true): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.customDepthMaterial = mat.userData.depth;
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

export const NEVER = 1e7;
