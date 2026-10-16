/**
 * Demo de vehículos y cargas: mixer descargando a un capacho y las cargas de grúa
 * colgando de postes (la última, un capacho con la compuerta abierta).
 */
import * as THREE from 'three';
import type { Stage } from '../../src/scene/stage';
import { SITE } from '../../src/config';
import { createMixer } from '../../src/scene/equipment/mixer';
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

  const hose = new THREE.Vector3(), outlet = new THREE.Vector3(), floor = new THREE.Vector3();
  return (t: number) => {
    mixer.setDrumSpin(t * 2.4);
    mixerStream.set(mixer.chuteTip.getWorldPosition(hose), toCapacho, 1, t);

    loads.forEach((l, i) => (l.rotation.y = Math.sin(t * 0.6 + i) * 0.12));
    const open = Math.min(1, Math.max(0, Math.sin(t * 0.8) * 1.6));
    hung.setOpen(open);
    hung.setFill(0.6 + 0.35 * Math.cos(t * 0.4));
    hung.outlet.getWorldPosition(outlet);
    floor.set(outlet.x, G, outlet.z);
    gateStream.set(outlet, floor, open, t);
  };
}
