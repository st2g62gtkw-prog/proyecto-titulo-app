/**
 * Demo de la faena: terreno, talud, caminos, cierros, instalación de faena, acopios y barrio.
 * Un bloque translúcido marca el edificio y un mástil rojo la grúa, para juzgar la composición.
 */
import * as THREE from 'three';
import type { Stage } from '../../src/scene/stage';
import { SITE } from '../../src/config';
import { createSite } from '../../src/scene/site';

export default function demo(stage: Stage) {
  // el terreno de la faena reemplaza al plano de suelo del banco de pruebas
  for (const o of [...stage.scene.children]) {
    if (o instanceof THREE.Mesh && o.geometry instanceof THREE.PlaneGeometry) stage.scene.remove(o);
  }
  const site = createSite();
  stage.scene.add(site.group);

  const building = new THREE.Mesh(
    new THREE.BoxGeometry(50.5, 18, 19.2),
    new THREE.MeshStandardMaterial({ color: '#9aa2aa', transparent: true, opacity: 0.55, roughness: 0.8 }),
  );
  building.position.set((-24 + 26.5) / 2, 9, 0);
  building.castShadow = true;
  stage.scene.add(building);

  const mast = new THREE.Mesh(new THREE.BoxGeometry(1.6, SITE.crane.mastHeight, 1.6), new THREE.MeshStandardMaterial({ color: '#c62f22' }));
  mast.position.set(SITE.crane.x, SITE.groundY + SITE.crane.mastHeight / 2, SITE.crane.z);
  mast.castShadow = true;
  stage.scene.add(mast);

  // marcas de los puntos de enganche de la grúa
  for (const p of Object.values(site.anchors)) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), new THREE.MeshBasicMaterial({ color: '#00c2ff' }));
    m.position.copy(p);
    stage.scene.add(m);
  }

  let meshes = 0;
  site.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
  console.log(`site: ${meshes} mallas`);

  const hide = new URLSearchParams(location.search).get('hide');
  if (hide) site.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.renderOrder >= 0) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (hide === '1') o.visible = false;
    if (hide === 'opaque') { mat.transparent = false; mat.needsUpdate = true; }
    if (hide === 'noalpha') { m.geometry.deleteAttribute('color'); mat.vertexColors = false; mat.needsUpdate = true; }
  });
  return (t: number, dt: number) => site.update(t, dt);
}
