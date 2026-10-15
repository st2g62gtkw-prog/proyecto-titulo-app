/**
 * Chorro de hormigón fresco (mixer → capacho, capacho → muro, manguera → losa).
 * Un InstancedMesh de 40 gotas: 32 forman el chorro (caen en parábola de `from` a `to`,
 * cada una estirada hasta tocar la siguiente para que se lea como un cordón continuo)
 * y 8 son salpicaduras; más un charco que late en `to`.
 */
import * as THREE from 'three';
import { truckSurfaces } from './mixer';

export interface ConcreteStream {
  group: THREE.Group;
  /** Coordenadas de mundo; intensity 0 = oculto; t = tiempo (s) para animar. */
  set(from: THREE.Vector3, to: THREE.Vector3, intensity: number, t: number): void;
}

const N_STREAM = 32;
const N_SPLASH = 8;
const UP = new THREE.Vector3(0, 1, 0);

let shared: { blob: THREE.BufferGeometry; puddle: THREE.BufferGeometry } | null = null;
function geometries() {
  shared ??= {
    blob: new THREE.IcosahedronGeometry(1, 1),
    puddle: new THREE.LatheGeometry(
      [[1, 0], [0.92, 0.03], [0.7, 0.07], [0.35, 0.1], [0, 0.11]].map(([r, y]) => new THREE.Vector2(r, y)),
      20,
    ),
  };
  return shared;
}

const hash = (i: number, c: number) => {
  const s = Math.sin(i * 12.9898 + c * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

export function createConcreteStream(): ConcreteStream {
  const G = geometries();
  const mat = truckSurfaces().concrete;
  const group = new THREE.Group();
  group.name = 'concreteStream';
  const blobs = new THREE.InstancedMesh(G.blob, mat, N_STREAM + N_SPLASH);
  blobs.frustumCulled = false;
  blobs.castShadow = true;
  const puddle = new THREE.Mesh(G.puddle, mat);
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
    const dx = b.x - a.x, dz = b.z - a.z;
    // si el destino queda más alto que el origen, el chorro sólo cae lo mínimo
    const dy = Math.min(b.y - a.y, -0.05);
    // tiempo de caída libre: define la velocidad aparente del chorro
    const fall = Math.max(Math.sqrt((-2 * dy) / 9.81), 0.25);
    const thick = 0.35 + 0.65 * Math.min(1, intensity);
    for (let i = 0; i < N_STREAM; i++) {
      const ph = t / fall + i / N_STREAM;
      const cyc = Math.floor(ph);
      const u = ph - cyc;
      const h1 = hash(i, cyc), h2 = hash(i + 101, cyc);
      // el cordón se adelgaza y ondula un poco al acelerar
      const jit = 0.05 * u * thick;
      p.set(a.x + dx * u + (h1 - 0.5) * jit, a.y + dy * u * u, a.z + dz * u + (h2 - 0.5) * jit);
      v.set(dx, 2 * dy * u, dz);
      const speed = v.length();
      if (speed < 1e-6) v.set(0, -1, 0);
      q.setFromUnitVectors(UP, v.normalize());
      const r = 0.085 * thick * (1 - 0.3 * u) * (0.85 + 0.3 * h1);
      // semilargo ≥ medio paso entre gotas (+ traslape) → sin huecos aunque la caída sea larga
      const half = Math.max(r * 1.3, (0.7 * speed) / N_STREAM);
      blobs.setMatrixAt(i, m.compose(p, q, s.set(r, half, r)));
    }
    q.identity();
    for (let i = 0; i < N_SPLASH; i++) {
      const ph = t * 1.8 + i / N_SPLASH;
      const cyc = Math.floor(ph);
      const u = ph - cyc;
      const ang = (hash(i + 7, cyc) + i / N_SPLASH) * Math.PI * 2;
      const rad = (0.15 + 0.35 * u) * thick;
      p.set(b.x + Math.cos(ang) * rad, b.y + 0.05 + 0.35 * u * (1 - u) * thick, b.z + Math.sin(ang) * rad);
      const r = 0.055 * thick * (1 - u) + 1e-3;
      blobs.setMatrixAt(N_STREAM + i, m.compose(p, q, s.set(r, r * 0.75, r)));
    }
    blobs.instanceMatrix.needsUpdate = true;
    const pr = (0.36 + 0.04 * Math.sin(t * 6)) * thick;
    puddle.position.copy(b);
    puddle.scale.set(pr, 0.8 + 0.4 * thick, pr);
  };

  return { group, set };
}
