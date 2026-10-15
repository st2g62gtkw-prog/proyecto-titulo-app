import * as THREE from 'three';
import type { Stage } from '../../src/scene/stage';

export default function demo(stage: Stage) {
  const box = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshStandardMaterial({ color: '#888' }));
  box.position.y = 5;
  box.castShadow = true;
  stage.scene.add(box);
  return (t: number) => { box.rotation.y = t * 0.5; };
}
