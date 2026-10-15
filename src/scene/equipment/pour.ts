/**
 * Chorro de hormigón fresco (mixer → capacho, capacho → muro, manguera → losa).
 * Un solo InstancedMesh: ~32 gotas que caen en parábola desde `from` hasta `to`
 * (más densas arriba, estiradas al acelerar) y 8 salpicaduras; más un charco en `to`.
 */
import * as THREE from 'three';

export interface ConcreteStream {
  group: THREE.Group;
  /** Coordenadas de mundo; intensity 0 = oculto; t = tiempo (s) para animar. */
  set(from: THREE.Vector3, to: THREE.Vector3, intensity: number, t: number): void;
}

const N_STREAM = 32;
const N_SPLASH = 8;
const UP = new THREE.Vector3(0, 1, 0);

let shared: { mat: THREE.MeshStandardMaterial; blob: THREE.BufferGeometry; puddle: THREE.BufferGeometry } | null = null;
function resources() {
  if (shared) return shared;
  shared = {
    mat: new THREE.MeshStandardMaterial({ color: '#808079', roughness: 0.28, metalness: 0.05 }),
    blob: new THREE.IcosahedronGeometry(1, 1),
    puddle: new THREE.LatheGeometry([new THREE.Vector2(1, 0), new THREE.Vector2(0.8, 0.035), new THREE.Vector2(0.4, 0.055), new THREE.Vector2(0, 0.06)], 20),
  };
  return shared;
}

const hash = (i: number, c: number) => {
  const s = Math.sin(i * 12.9898 + c * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

export function createConcreteStream(): ConcreteStream {
  const R = resources();
  const group = new THREE.Group();
  group.name = 'concreteStream';
  const blobs = new THREE.InstancedMesh(R.blob, R.mat, N_STREAM + N_SPLASH);
  blobs.frustumCulled = false;
  blobs.castShadow = true;
  const puddle = new THREE.Mesh(R.puddle, R.mat);
  puddle.receiveShadow = true;
  group.add(blobs, puddle);
  group.visible = false;

  const a = new THREE.Vector3(), b = new THREE.Vector3(), p = new THREE.Vector3(), v = new THREE.Vector3(), s = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();

  const set = (from: THREE.Vector3, to: THREE.Vector3, intensity: number, t: number) => {
    group.visible = intensity > 0.001;
    if (!group.visible) return;
    group.updateWorldMatrix(true, false);
    group.worldToLocal(a.copy(from));
    group.worldToLocal(b.copy(to));
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    // tiempo de caída libre: define la velocidad aparente del chorro
    const fall = Math.max(Math.sqrt((2 * Math.max(-dy, 0.05)) / 9.81), 0.25);
    const thick = 0.35 + 0.65 * Math.min(1, intensity);
    for (let i = 0; i < N_STREAM; i++) {
      const ph = t / fall + i / N_STREAM;
      const cyc = Math.floor(ph);
      const u = ph - cyc;
      const h1 = hash(i, cyc), h2 = hash(i + 101, cyc);
      const jit = 0.04 * (0.25 + u) * thick;
      p.set(a.x + dx * u + (h1 - 0.5) * jit, a.y + dy * u * u, a.z + dz * u + (h2 - 0.5) * jit);
      v.set(dx, 2 * dy * u, dz);
      if (v.lengthSq() < 1e-8) v.set(0, -1, 0);
      q.setFromUnitVectors(UP, v.normalize());
      const r = 0.1 * thick * (1 - 0.35 * u) * (0.8 + 0.4 * h1);
      blobs.setMatrixAt(i, m.compose(p, q, s.set(r, r * (1 + 1.5 * u), r)));
    }
    q.identity();
    for (let i = 0; i < N_SPLASH; i++) {
      const ph = t * 1.8 + i * 0.37;
      const cyc = Math.floor(ph);
      const u = ph - cyc;
      const ang = hash(i + 7, cyc) * Math.PI * 2;
      const rad = (0.12 + 0.32 * u) * thick;
      p.set(b.x + Math.cos(ang) * rad, b.y + 0.03 + 0.4 * u * (1 - u) * thick, b.z + Math.sin(ang) * rad);
      const r = 0.05 * thick * (1 - u) + 1e-3;
      blobs.setMatrixAt(N_STREAM + i, m.compose(p, q, s.set(r, r * 0.8, r)));
    }
    blobs.instanceMatrix.needsUpdate = true;
    const pr = (0.3 + 0.05 * Math.sin(t * 7)) * thick;
    puddle.position.copy(b);
    puddle.scale.set(pr, thick, pr);
  };

  return { group, set };
}
