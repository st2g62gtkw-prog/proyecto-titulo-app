import * as THREE from 'three';
import { loadBuilding } from '../../src/data/building';
import { buildSchedule } from '../../src/core/schedule';
import { buildStructure } from '../../src/scene/structure';
import { uTime } from '../../src/scene/reveal';
import type { Stage } from '../../src/scene/stage';

export default function demo(stage: Stage) {
  let ready: ((t: number) => void) | null = null;
  const q = new URLSearchParams(location.search);
  loadBuilding('/public/data/'.replace('/public', '')).then(({ data, detail }) => {
    const sched = buildSchedule(data);
    const t0 = performance.now();
    const st = buildStructure(data, sched, detail);
    console.log('structure built ms', Math.round(performance.now() - t0), 'layers', st.layers.length, 'duration', sched.duration.toFixed(1));
    stage.scene.add(st.group);
    if (q.get('cut') === '1') {
      // corte longitudinal para ver el interior (como el botón "Corte" de la app)
      st.clipping.push(new THREE.Plane(new THREE.Vector3(0, 0, -1), 1.2));
    }
    const act = q.get('act');
    const actT = act ? sched.activities.find((a) => a.id === act) : null;
    ready = (t) => {
      const T = actT ? actT.t0 + (actT.t1 - actT.t0) * (+(q.get('k') ?? 0.5)) : t;
      uTime.value = T;
      st.update(T);
      (document.getElementById('info')!).textContent = `${sched.at(T).title} · T=${T.toFixed(1)}`;
    };
    (window as any).__sched = sched;
  });
  return (t: number) => ready?.(t);
}
