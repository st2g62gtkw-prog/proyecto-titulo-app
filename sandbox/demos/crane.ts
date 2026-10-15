/**
 * Demo de la grúa torre: gira, mueve el carro y sube/baja el gancho con un paquete
 * de moldajes colgando de cuatro eslingas.
 */
import * as THREE from 'three';
import type { Stage } from '../../src/scene/stage';
import { SITE } from '../../src/config';
import { createCrane } from '../../src/scene/equipment/crane';

export default function demo(stage: Stage) {
  const { mastHeight, jibLength, counterJibLength } = SITE.crane;
  const crane = createCrane({ mastHeight, jibLength, counterJibLength });
  crane.group.position.y = SITE.groundY;
  stage.scene.add(crane.group);

  // carga de prueba: paquete de paneles bajo el gancho
  const drop = 2.2;
  const load = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.7, 1.2),
    new THREE.MeshStandardMaterial({ color: '#5f7d95', roughness: 0.6, metalness: 0.3 }),
  );
  load.position.y = -drop - 0.35;
  load.castShadow = load.receiveShadow = true;
  const corners = [[-1.1, -0.5], [1.1, -0.5], [1.1, 0.5], [-1.1, 0.5]];
  const slings = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(corners.flatMap(([x, z]) => [0, 0, 0, x, -drop, z]), 3),
    ),
    new THREE.LineBasicMaterial({ color: '#202326' }),
  );
  crane.hook.add(load, slings);

  return (t: number, dt: number) => {
    crane.setPose(t * 0.3, 23 + 17 * Math.sin(t * 0.5), 16.5 + 11.5 * Math.sin(t * 0.37));
    crane.update(t, dt);
  };
}
