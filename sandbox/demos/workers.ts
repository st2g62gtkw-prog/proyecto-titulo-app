/**
 * Demo de cuadrillas: 60 trabajadores.
 *  - 18 caminando en dos círculos (sentidos opuestos) alrededor de (-10, 4)
 *  - 8 cargando tablas, ida y vuelta por z ≈ 14 con una pausa en cada extremo
 *  - 14 trabajando en fila frente a un muro de moldaje (losa en x 0…16, z -10…-2)
 *  - 8 trabajando sobre la malla de la losa
 *  - 12 en reposo, en tres grupos conversando
 * Clic sobre un trabajador: muestra su índice en la barra superior. Admite zoom > 9 (detalle).
 * &strip=1: tiras de 8 trabajadores por acción (marcha y carga en 8 fases) para revisar las poses.
 */
import * as THREE from 'three';
import type { Stage } from '../../src/scene/stage';
import { SITE } from '../../src/config';
import { createCrowd, type WorkerAction, type WorkerPose } from '../../src/scene/equipment/workers';

export default function demo(stage: Stage) {
  const G = SITE.groundY;
  const scene = stage.scene;

  // ── contexto para juzgar la escala: losa, muro de moldaje y malla de fierro
  const concrete = new THREE.MeshStandardMaterial({ color: '#b9b6ae', roughness: 0.9 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(16, 0.2, 8), concrete);
  slab.position.set(8, G + 0.1, -6);
  const form = new THREE.Mesh(new THREE.BoxGeometry(14, 2.4, 0.3), new THREE.MeshStandardMaterial({ color: '#c0452f', roughness: 0.6 }));
  form.position.set(8, 1.2, -9.9);
  const rebar = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#6e4a3a', roughness: 0.7 }), 26);
  const bar = (k: number, x: number, y: number, z: number, sx: number, sz: number) =>
    rebar.setMatrixAt(k, new THREE.Matrix4().makeScale(sx, 0.03, sz).setPosition(x, y, z));
  for (let k = 0; k <= 12; k++) {
    bar(k, 4.5, 0.06, -7 + k * 0.5, 6, 0.03);
    bar(13 + k, 1.5 + k * 0.5, 0.09, -4, 0.03, 6);
  }
  for (const o of [slab, form, rebar]) {
    o.castShadow = o.receiveShadow = true;
    scene.add(o);
  }

  // ── trabajadores
  const N = 60;
  const crowd = createCrowd(N);
  scene.add(crowd.group);

  type Plan = (t: number) => Omit<WorkerPose, 't' | 'vest' | 'helmet' | 'visible'>;
  const plans: Plan[] = [];
  const circle = (cx: number, cz: number, r: number, speed: number, a0: number, action: WorkerAction): Plan => (t) => {
    const a = a0 + (speed * t) / r;
    const sgn = Math.sign(speed);
    return {
      x: cx + r * Math.cos(a), y: G, z: cz + r * Math.sin(a),
      heading: Math.atan2(sgn * Math.cos(a), -sgn * Math.sin(a)),
      walk: Math.abs(speed * t) + a0, action,
    };
  };
  const still = (x: number, y: number, z: number, heading: number, action: WorkerAction): Plan => () => ({ x, y, z, heading, walk: 0, action });
  // ida y vuelta cargando tablas, con una pausa (reposo) en cada extremo: prueba las transiciones
  const pingPong = (x0: number, x1: number, z: number, speed: number, off: number): Plan => (t) => {
    const L = x1 - x0, leg = L / speed + 2.5;
    const n = Math.floor((t + off) / leg), s = Math.min(((t + off) - n * leg) * speed, L);
    const back = n % 2 === 1;
    return { x: back ? x1 - s : x0 + s, y: G, z, heading: back ? Math.PI : 0, walk: n * L + s, action: s < L ? 'carry' : 'idle' };
  };

  const q = new URLSearchParams(location.search);
  if (q.get('strip') === '1') {
    // tira de inspección: 8 fases de cada acción, quietos en su lugar (x = -11, 0, 11, 22)
    for (const [x0, action] of [[-11, 'walk'], [0, 'carry'], [11, 'work'], [22, 'idle']] as const) {
      for (let k = 0; k < 8; k++) plans.push((t) => ({ x: x0 + k * 1.3, y: G, z: 6, heading: 0, walk: 1.2 * t + (k / 8) * 1.5, action }));
    }
  } else {
    for (let k = 0; k < 12; k++) plans.push(circle(-10, 4, 7, 1.25, (k / 12) * Math.PI * 2, 'walk'));
    for (let k = 0; k < 6; k++) plans.push(circle(-10, 4, 3.5, -1.0, (k / 6) * Math.PI * 2, 'walk'));
    for (let k = 0; k < 8; k++) plans.push(pingPong(-4, 16, 13 + (k % 2) * 1.6, 1.05, k * 4.3));
    for (let k = 0; k < 14; k++) plans.push(still(1.9 + k * 0.95, 0, -8.7, -Math.PI / 2, 'work'));
    for (let k = 0; k < 8; k++) plans.push(still(2 + (k % 4) * 1.6, 0, -6.2 + Math.floor(k / 4) * 2.6, (k * 1.7) % 6.28, 'work'));
    for (const [gx, gz] of [[21, 3], [21, 11], [-17, -7]]) {
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + gx;
        plans.push(still(gx + 0.95 * Math.cos(a), G, gz + 0.95 * Math.sin(a), a + Math.PI, 'idle'));
      }
    }
  }

  // permite acercarse más que en la app (zoom > 9) para revisar detalles
  const zoom = +(q.get('zoom') ?? 1);
  stage.controls.maxZoom = Math.max(stage.controls.maxZoom, zoom);
  stage.camera.zoom = zoom;
  stage.camera.updateProjectionMatrix();

  // clic → índice del trabajador
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const info = document.getElementById('info');
  stage.renderer.domElement.addEventListener('click', (e) => {
    const r = stage.renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, stage.camera);
    const hit = ray.intersectObjects(crowd.pickables, false)[0];
    if (info) info.textContent = hit ? `trabajador #${hit.instanceId} (${hit.object.userData.pick.type})` : 'workers';
  });

  return (t: number) => {
    plans.forEach((plan, i) => {
      crowd.set(i, {
        ...plan(t), t: t + i * 0.37,
        vest: (i % 3 === 0 ? 1 : 0), helmet: ((i * 7) % 4) as 0 | 1 | 2 | 3, visible: true,
      });
    });
    crowd.commit();
  };
}
