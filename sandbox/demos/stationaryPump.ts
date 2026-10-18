/**
 * Demo de la bomba estacionaria en su caseta: alterna bombeando / detenida cada 4 s. La caseta
 * lleva el mismo giro que en la app (SITE.pump.heading) y un mixer queda como en la obra: llegado
 * en retroceso por el camino, alineado con el eje largo de la caseta, con la cabina hacia el portón
 * (−x) y la canaleta desplegada sobre la tolva (SITE.mixerPump respecto de SITE.pump), para revisar
 * holguras y la caída del chorro. Esferas en la tolva (roja), la punta de la canaleta (naranja) y la salida de la tubería
 * (azul); la huella de la caseta en amarillo.
 */
import * as THREE from 'three';
import type { Stage } from '../../src/scene/stage';
import { SITE } from '../../src/config';
import { createMixer } from '../../src/scene/equipment/mixer';
import { createConcreteStream } from '../../src/scene/equipment/pour';
import { createStationaryPump } from '../../src/scene/equipment/stationaryPump';

export default function demo(stage: Stage) {
  const G = SITE.groundY;
  const scene = stage.scene;
  const rig = createStationaryPump();
  rig.group.position.set(0, G, 0);
  rig.group.rotation.y = SITE.pump.heading;
  scene.add(rig.group);
  rig.group.updateMatrixWorld(true);
  const hop = rig.hopper.getWorldPosition(new THREE.Vector3());
  const out = rig.outlet.getWorldPosition(new THREE.Vector3());

  // mixer en la tolva: misma posición relativa a la caseta que en la app (rumbo −x, hacia el
  // portón, con la trasera hacia la tolva); ?truck=0 lo oculta y ?shed=0 oculta muros y techo
  const q = new URLSearchParams(location.search);
  const mixer = createMixer();
  mixer.group.position.set(SITE.mixerPump.x - SITE.pump.x, G, SITE.mixerPump.z - SITE.pump.z);
  mixer.group.rotation.y = -Math.PI;
  mixer.setChute(1);
  mixer.setDischarge(true);
  mixer.group.visible = q.get('truck') !== '0';
  scene.add(mixer.group);
  mixer.group.updateMatrixWorld(true);
  const tip = mixer.chuteTip.getWorldPosition(new THREE.Vector3());
  const stream = createConcreteStream();
  scene.add(stream.group);
  if (q.get('shed') === '0') {
    rig.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if ((o as THREE.Mesh).isMesh && m?.map && (o.parent === rig.group.children[0] || o.parent === rig.group)) o.visible = false;
    });
  }
  const line = (a: THREE.Vector3, b: THREE.Vector3, color: string) =>
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color })));

  // marcadores y huella (la huella en coordenadas de la caseta)
  const marker = (p: THREE.Vector3, color: string) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), new THREE.MeshBasicMaterial({ color }));
    m.position.copy(p);
    scene.add(m);
  };
  marker(hop, '#e0281e');
  marker(tip, '#ff7a00');
  marker(out, '#1e6be0');
  const outDir = new THREE.Vector3(0, 0, -1).applyQuaternion(rig.group.quaternion);
  line(out, out.clone().addScaledVector(outDir, 6), '#1e6be0');
  const { w, d } = rig.footprint;
  const y = 0.03;
  rig.group.add(new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-w / 2, y, -d / 2), new THREE.Vector3(w / 2, y, -d / 2),
      new THREE.Vector3(w / 2, y, d / 2), new THREE.Vector3(-w / 2, y, d / 2),
    ]),
    new THREE.LineBasicMaterial({ color: '#f2c200' }),
  ));

  // holgura entre la trasera del camión (sin la canaleta) y la huella de la caseta
  const rear = rig.group.worldToLocal(mixer.group.localToWorld(new THREE.Vector3(-mixer.length / 2, 0, 0)));
  const gap = Math.max(Math.abs(rear.x) - w / 2, Math.abs(rear.z) - d / 2);
  let meshes = 0;
  rig.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
  const info = document.getElementById('info');
  const f = (v: THREE.Vector3) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;
  const base = `${info?.textContent ?? ''} · tolva ${f(hop)} · punta canaleta ${f(tip)} · salida ${f(out)} · huella ${w} × ${d} m · holgura camión–caseta ${gap.toFixed(2)} m · ${meshes} mallas`;

  return (t: number) => {
    const on = Math.floor(t / 4) % 2 === 0;
    rig.setPumping(on, t);
    mixer.setDrumSpin(t * (on ? -2.2 : 1.1));
    mixer.setDischarge(on);
    stream.set(tip, hop, on && mixer.group.visible ? 0.8 : 0, t);
    if (info) info.textContent = `${base} · ${on ? 'BOMBEANDO' : 'detenida'}`;
  };
}
