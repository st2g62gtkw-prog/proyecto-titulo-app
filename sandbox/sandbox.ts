/**
 * Banco de pruebas de modelos: /sandbox/?m=<demo>&t=<segundos>&az=<grados>&el=<grados>&zoom=<z>&tx=&ty=&tz=
 * Cada demo vive en sandbox/demos/<demo>.ts y exporta por defecto
 *   (stage: Stage) => ((t: number, dt: number) => void) | void
 */
import * as THREE from 'three';
import { createStage } from '../src/scene/stage';

const q = new URLSearchParams(location.search);
const name = q.get('m') ?? 'empty';
const stage = createStage(document.getElementById('app')!);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshStandardMaterial({ color: '#c8a77c', roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.2;
ground.receiveShadow = true;
if (q.get('ground') !== '0') stage.scene.add(ground);
const grid = new THREE.GridHelper(200, 100, 0x6b5a45, 0x9c8668);
grid.position.y = -0.19;
if (q.get('grid') === '1') stage.scene.add(grid);

const tx = +(q.get('tx') ?? 0), ty = +(q.get('ty') ?? 4), tz = +(q.get('tz') ?? 0);
stage.controls.target.set(tx, ty, tz);
stage.setIsoView(+(q.get('az') ?? 55), +(q.get('el') ?? 30));
stage.camera.zoom = +(q.get('zoom') ?? 1);
stage.camera.updateProjectionMatrix();

const mods = import.meta.glob('./demos/*.ts');
const info = document.getElementById('info')!;
info.textContent = name;
let tick: ((t: number, dt: number) => void) | void;
const key = `./demos/${name}.ts`;
if (mods[key]) {
  const mod = (await mods[key]()) as { default: (s: typeof stage) => typeof tick };
  tick = mod.default(stage);
} else {
  info.textContent = `demo no encontrada: ${name} — disponibles: ${Object.keys(mods).join(', ')}`;
}
// t fijo (para capturas) o reloj real
const fixed = q.get('t');
let t = fixed ? +fixed : 0;
let last = performance.now();
function loop(now: number) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (!fixed) t += dt;
  if (tick) tick(t, dt);
  stage.update(dt);
  stage.render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
(window as unknown as { __stage: typeof stage }).__stage = stage;
