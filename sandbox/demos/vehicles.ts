/**
 * Demo de vehículos y cargas: mixer descargando a un capacho, camión bomba desplegando la
 * pluma (k: 0→1 en 6 s) y luego barriendo en zig-zag un rectángulo de 20 × 10 m a 15 m de
 * altura, y las cuatro cargas de grúa colgando de postes.
 */
import * as THREE from 'three';
import type { Stage } from '../../src/scene/stage';
import { SITE } from '../../src/config';
import { createMixer } from '../../src/scene/equipment/mixer';
import { createPump } from '../../src/scene/equipment/pump';
import { createCapacho } from '../../src/scene/equipment/capacho';
import { createConcreteStream } from '../../src/scene/equipment/pour';
import { createDeckPack, createPanelPack, createPropBundle, createRebarBundle } from '../../src/scene/equipment/payloads';

export default function demo(stage: Stage) {
  const G = SITE.groundY;
  const scene = stage.scene;

  // ── mixer → capacho
  const mixer = createMixer();
  mixer.group.position.set(-16, G, 12);
  scene.add(mixer.group);
  mixer.setChute(1);
  mixer.setDischarge(true);
  mixer.group.updateMatrixWorld(true);
  const chute = mixer.chuteTip.getWorldPosition(new THREE.Vector3());
  const capacho = createCapacho();
  capacho.group.position.set(chute.x - 0.35, G + capacho.height, chute.z);
  capacho.setFill(0.55);
  scene.add(capacho.group);
  const toCapacho = new THREE.Vector3(chute.x - 0.45, G + capacho.height - 1.2, chute.z);
  const mixerStream = createConcreteStream();
  scene.add(mixerStream.group);

  // ── camión bomba
  const pump = createPump();
  pump.group.position.set(0, G, 0);
  scene.add(pump.group);
  pump.setOutriggers(1);
  const hoseStream = createConcreteStream();
  scene.add(hoseStream.group);

  const rect = { x0: -10, x1: 10, z0: -25, z1: -15, y: 15, rows: 6 };
  const path: THREE.Vector3[] = [];
  for (let r = 0; r < rect.rows; r++) {
    const z = rect.z1 - (r / (rect.rows - 1)) * (rect.z1 - rect.z0);
    const [xa, xb] = r % 2 ? [rect.x1, rect.x0] : [rect.x0, rect.x1];
    path.push(new THREE.Vector3(xa, rect.y, z), new THREE.Vector3(xb, rect.y, z));
  }
  const segLen = path.slice(1).map((p, i) => p.distanceTo(path[i]));
  const total = segLen.reduce((a, b) => a + b, 0);
  const target = new THREE.Vector3();
  const sample = (d: number) => {
    d %= 2 * total;
    if (d > total) d = 2 * total - d; // ida y vuelta
    for (let i = 0; i < segLen.length; i++) {
      if (d <= segLen[i] || i === segLen.length - 1) return target.lerpVectors(path[i], path[i + 1], Math.min(1, d / segLen[i]));
      d -= segLen[i];
    }
    return target;
  };

  // ── cargas colgando de postes (la última: capacho con la compuerta abierta, como al llenar un muro)
  const hung = createCapacho();
  const gateStream = createConcreteStream();
  scene.add(gateStream.group);
  const postMat = new THREE.MeshStandardMaterial({ color: '#4a5058', roughness: 0.6, metalness: 0.3 });
  const loads = [createPanelPack(), createRebarBundle(), createDeckPack(), createPropBundle(), hung.group];
  loads.forEach((load, i) => {
    const x = 2 + i * 7.5, z = 14, hookY = G + 5.6;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 5.8, 0.2), postMat);
    post.position.set(x, G + 2.9, z - 1.6);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 1.8), postMat);
    arm.position.set(x, hookY + 0.08, z - 0.8);
    post.castShadow = arm.castShadow = true;
    load.position.set(x, hookY, z);
    scene.add(post, arm, load);
  });

  const hose = new THREE.Vector3(), ground = new THREE.Vector3(), outlet = new THREE.Vector3(), floor = new THREE.Vector3();
  return (t: number) => {
    mixer.setDrumSpin(t * 2.4);
    mixerStream.set(mixer.chuteTip.getWorldPosition(hose), toCapacho, 1, t);

    const k = Math.min(t / 6, 1);
    pump.setBoom(k, sample(Math.max(0, t - 6) * 2.5));
    pump.hoseTip.getWorldPosition(hose);
    ground.set(hose.x, G, hose.z);
    hoseStream.set(hose, ground, k >= 1 ? 1 : 0, t);

    loads.forEach((l, i) => (l.rotation.y = Math.sin(t * 0.6 + i) * 0.12));
    const open = Math.min(1, Math.max(0, Math.sin(t * 0.8) * 1.6));
    hung.setOpen(open);
    hung.setFill(0.6 + 0.35 * Math.cos(t * 0.4));
    hung.outlet.getWorldPosition(outlet);
    floor.set(outlet.x, G, outlet.z);
    gateStream.set(outlet, floor, open, t);
  };
}
