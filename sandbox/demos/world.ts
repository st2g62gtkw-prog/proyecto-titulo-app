/**
 * Mundo integrado (edificio + grúa + camiones) con faena, cuadrillas y etiquetas simplificadas,
 * para probar la sincronización sin depender de esos módulos.
 * ?t=<T> fija el tiempo; ?act=<id>&k=<0..1> salta a una actividad.
 */
import * as THREE from 'three';
import { loadBuilding } from '../../src/data/building';
import { World } from '../../src/scene/world';
import { SITE } from '../../src/config';
import type { Stage } from '../../src/scene/stage';
import type { SiteRig } from '../../src/scene/site';
import type { Crowd } from '../../src/scene/equipment/workers';

function stubSite(): SiteRig {
  const group = new THREE.Group();
  const v = (x: number, z: number, y = 0.9) => new THREE.Vector3(x, y, z);
  return {
    group, pickables: [], update() {},
    anchors: {
      acopioMoldajeMuro: v(SITE.acopioMoldajeMuro.x, SITE.acopioMoldajeMuro.z),
      acopioMoldajeLosa: v(SITE.acopioMoldajeLosa.x, SITE.acopioMoldajeLosa.z),
      acopioFierro: v(SITE.acopioFierro.x, SITE.acopioFierro.z, 0.7),
      acopioPuntales: v(SITE.acopioPuntales.x, SITE.acopioPuntales.z, 0.7),
    },
  } as SiteRig;
}

function stubCrowd(max: number): Crowd {
  const mesh = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.25, 1.2, 2, 6), new THREE.MeshStandardMaterial({ color: '#ff7a1a' }), max);
  const m = new THREE.Matrix4();
  const group = new THREE.Group();
  group.add(mesh);
  return {
    group, count: max, pickables: [],
    set(i, p) { m.makeTranslation(p.x, p.y + 0.85, p.z); if (!p.visible) m.makeScale(0, 0, 0); mesh.setMatrixAt(i, m); },
    commit() { mesh.instanceMatrix.needsUpdate = true; },
  } as Crowd;
}

export default function demo(stage: Stage) {
  const q = new URLSearchParams(location.search);
  let tick: ((t: number, dt: number) => void) | null = null;
  loadBuilding('/data/').then((b) => {
    const w = new World(stage, b, {
      createSite: stubSite, createCrowd: stubCrowd,
      createTag: (text) => { const el = document.createElement('div'); el.textContent = text; el.style.cssText = 'background:#0b1220cc;color:#fff;font:11px system-ui;padding:2px 6px;border-radius:8px'; return el; },
    });
    const act = q.get('act');
    const a = act ? w.sched.activities.find((x) => x.id === act) : null;
    const T0 = a ? a.t0 + (a.t1 - a.t0) * +(q.get('k') ?? 0.5) : null;
    let T = T0 ?? 0;
    tick = (t, dt) => {
      if (T0 === null) T = t; else if (q.get('run') === '1') T += dt;
      w.update(T, dt, t);
      (document.getElementById('info')!).textContent = `${w.sched.at(T).title} · ${w.state.craneTask} · T=${T.toFixed(1)}`;
    };
    (window as unknown as { __world: World }).__world = w;
  });
  return (t: number, dt: number) => tick?.(t, dt);
}
