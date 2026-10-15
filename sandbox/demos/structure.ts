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
