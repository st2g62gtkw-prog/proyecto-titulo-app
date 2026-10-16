/**
 * Demo de la bomba estacionaria en su caseta: alterna bombeando / detenida cada 4 s. Un camión
 * de referencia (caja gris 9,6 × 2,5 × 3,4 m, avanza hacia +x) queda con su trasera junto a la
 * tolva para revisar holguras; una línea naranja marca la canaleta (pivote → tolva), esferas en
 * la tolva (roja) y la salida de la tubería (azul), y la huella en amarillo.
 */
import * as THREE from 'three';
import type { Stage } from '../../src/scene/stage';
import { SITE } from '../../src/config';
import { createStationaryPump } from '../../src/scene/equipment/stationaryPump';

export default function demo(stage: Stage) {
  const G = SITE.groundY;
  const scene = stage.scene;
  const rig = createStationaryPump();
  rig.group.position.set(0, G, 0);
  scene.add(rig.group);
  rig.group.updateMatrixWorld(true);
  const hop = rig.hopper.getWorldPosition(new THREE.Vector3());
  const out = rig.outlet.getWorldPosition(new THREE.Vector3());

  // camión de referencia: trasera hacia la tolva, canaleta (pivote 0,35 m antes de la trasera, a 2,12 m)
  const L = 9.6, W = 2.5, H = 3.4;
  const truckX = 4.55, truckZ = hop.z + 1.9;
  const truckMat = new THREE.MeshStandardMaterial({ color: '#7d8186', transparent: true, opacity: 0.35, depthWrite: false });
  const truck = new THREE.Mesh(new THREE.BoxGeometry(L, H, W), truckMat);
  truck.position.set(truckX, G + H / 2, truckZ);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(truck.geometry), new THREE.LineBasicMaterial({ color: '#33363a' }));
  truck.add(edges);
  // ?truck=0 oculta el camión; ?shed=0 oculta muros y techo (inspección de la bomba)
  const q = new URLSearchParams(location.search);
  if (q.get('truck') !== '0') scene.add(truck);
  if (q.get('shed') === '0') {
    rig.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if ((o as THREE.Mesh).isMesh && m?.map && o.parent === rig.group.children[0]) o.visible = false;
    });
  }
  const pivot = new THREE.Vector3(truckX - L / 2 + 0.35, G + 2.12, truckZ);
  const line = (a: THREE.Vector3, b: THREE.Vector3, color: string) =>
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color })));
  line(pivot, hop, '#ff7a00');

  // marcadores y huella
  const marker = (p: THREE.Vector3, color: string) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), new THREE.MeshBasicMaterial({ color }));
    m.position.copy(p);
    scene.add(m);
  };
  marker(hop, '#e0281e');
  marker(out, '#1e6be0');
  line(out, out.clone().add(new THREE.Vector3(0, 0, -6)), '#1e6be0');
  const { w, d } = rig.footprint;
  const y = G + 0.03;
  scene.add(new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-w / 2, y, -d / 2), new THREE.Vector3(w / 2, y, -d / 2),
      new THREE.Vector3(w / 2, y, d / 2), new THREE.Vector3(-w / 2, y, d / 2),
    ]),
    new THREE.LineBasicMaterial({ color: '#f2c200' }),
  ));

  let meshes = 0;
  rig.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
  const info = document.getElementById('info');
  const f = (v: THREE.Vector3) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;
  const base = `${info?.textContent ?? ''} · tolva ${f(hop)} · salida ${f(out)} · huella ${w} × ${d} m · holgura camión–huella ${(truckZ - W / 2 - d / 2).toFixed(2)} m · ${meshes} mallas`;

  return (t: number) => {
    const on = Math.floor(t / 4) % 2 === 0;
    rig.setPumping(on, t);
    if (info) info.textContent = `${base} · ${on ? 'BOMBEANDO' : 'detenida'}`;
  };
}
