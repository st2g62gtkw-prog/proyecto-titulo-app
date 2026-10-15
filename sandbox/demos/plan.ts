/** Prueba del plan de grúa y la logística con cajas en lugar de camiones. */
import * as THREE from 'three';
import { loadBuilding } from '../../src/data/building';
import { buildSchedule, haWalls } from '../../src/core/schedule';
import { CranePlan } from '../../src/core/cranePlan';
import { Logistics } from '../../src/core/logistics';
import { buildStructure } from '../../src/scene/structure';
import { createCrane } from '../../src/scene/equipment/crane';
import { uTime } from '../../src/scene/reveal';
import { SITE } from '../../src/config';
import type { Stage } from '../../src/scene/stage';

export default function demo(stage: Stage) {
  const q = new URLSearchParams(location.search);
  let tick: ((t: number) => void) | null = null;
  loadBuilding('/data/').then(({ data, detail }) => {
    const sched = buildSchedule(data);
    const st = buildStructure(data, sched, detail);
    stage.scene.add(st.group);
    const C = SITE.crane;
    const crane = createCrane({ mastHeight: C.mastHeight, jibLength: C.jibLength, counterJibLength: C.counterJibLength });
    crane.group.position.set(C.x, SITE.groundY, C.z);
    stage.scene.add(crane.group);
    const box = (c: string, sx: number, sy: number, sz: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshStandardMaterial({ color: c }));
      m.castShadow = true;
      return m;
    };
    const load = box('#ffb020', 2.4, 1, 1.2); load.position.y = -1.8;
    const lv = data.levels;
    const anchors = {
      acopioMoldajeMuro: { x: SITE.acopioMoldajeMuro.x, y: 1, z: SITE.acopioMoldajeMuro.z },
      acopioMoldajeLosa: { x: SITE.acopioMoldajeLosa.x, y: 1, z: SITE.acopioMoldajeLosa.z },
      acopioFierro: { x: SITE.acopioFierro.x, y: 0.8, z: SITE.acopioFierro.z },
      acopioPuntales: { x: SITE.acopioPuntales.x, y: 0.8, z: SITE.acopioPuntales.z },
    };
    const plan = new CranePlan({
      base: { x: C.x, z: C.z, y: SITE.groundY }, jibY: SITE.groundY + crane.jibHeight, jibLength: C.jibLength, anchors,
      mixerChute: { x: SITE.mixerCapacho.x - 4.6, y: 1.3, z: SITE.mixerCapacho.z }, hang: { capacho: 2.1, panel: 2.3, rebar: 2.3, deck: 2.3, props: 2.3 },
      topAt: (t) => { const a = sched.at(t); return a.kind.startsWith('muro') ? lv[a.level].slab.y1 + 3 : a.kind.startsWith('losa') ? lv[a.level].slab.y1 + 1.3 : 1; },
      levelFloorY: (L) => lv[L].slab.y1, wallTopY: (L) => haWalls(lv[L])[0]?.y1 ?? 0, slabBottomY: (S) => lv[S].slab.y0,
    }, sched);
    const log = new Logistics(sched);
    const mix = [0, 1, 2, 3].map(() => { const m = box('#e8e8e8', 9, 3.4, 2.5); m.position.y = 1.5; const g = new THREE.Group(); g.add(m); stage.scene.add(g); return g; });
    const pump = box('#ff8a00', 11, 3.4, 2.5); pump.position.y = 1.5; const pg = new THREE.Group(); pg.add(pump); stage.scene.add(pg);
    if (q.get('check') === '1') {
      // recorre toda la obra buscando estados inválidos
      let bad = 0, maxR = 0, minY = 1e9, maxY = -1e9;
      for (let T = 0; T < sched.duration; T += 0.05) {
        const s = plan.at(T);
        if (![s.slew, s.r, s.hookY, s.fill, s.open].every(Number.isFinite)) { if (bad++ < 5) console.log('NaN at', T.toFixed(2)); }
        maxR = Math.max(maxR, s.r); minY = Math.min(minY, s.hookY); maxY = Math.max(maxY, s.hookY);
        for (const m of log.mixerStates(T)) if (![m.pose.x, m.pose.z, m.pose.heading].every(Number.isFinite)) bad++;
        const ps = log.pumpState(T);
        if (ps && ![ps.pose.x, ps.pose.z, ps.boom, ps.outriggers].every(Number.isFinite)) bad++;
      }
      console.log('check', { bad, maxR: maxR.toFixed(1), minY: minY.toFixed(2), maxY: maxY.toFixed(2), jibY: (SITE.groundY + crane.jibHeight).toFixed(1), dur: sched.duration.toFixed(1), mixers: log.mixers.length, pumps: log.pumps.length });
      // superposición de mixers por slot del pool
      const slots = new Map<number, number[][]>();
      for (const m of log.mixers) { const k = m.id % 4; if (!slots.has(k)) slots.set(k, []); slots.get(k)!.push([m.arrive[0], m.leave[1], m.id]); }
      let overlaps = 0;
      slots.forEach((arr) => { arr.sort((a, b) => a[0] - b[0]); for (let i = 1; i < arr.length; i++) if (arr[i][0] < arr[i - 1][1]) overlaps++; });
      console.log('pool overlaps', overlaps);
    }
    const act = q.get('act');
    const actT = act ? sched.activities.find((a) => a.id === act) : null;
    tick = (t) => {
      const T = actT ? actT.t0 + (actT.t1 - actT.t0) * (+(q.get('k') ?? 0.5)) : t;
      uTime.value = T; st.update(T);
      const s = plan.at(T);
      crane.setPose(s.slew, s.r, s.hookY - SITE.groundY);
      crane.update(t, 0.016);
      if (s.payload && load.parent !== crane.hook) crane.hook.add(load);
      if (!s.payload && load.parent) load.parent.remove(load);
      (load.material as THREE.MeshStandardMaterial).color.set(s.payload === 'capacho' ? '#888' : '#ffb020');
      mix.forEach((g) => (g.visible = false));
      for (const m of log.mixerStates(T)) { const g = mix[m.id % 4]; g.visible = true; g.position.set(m.pose.x, SITE.groundY, m.pose.z); g.rotation.y = -m.pose.heading; }
      const ps = log.pumpState(T);
      pg.visible = !!ps;
      if (ps) { pg.position.set(ps.pose.x, SITE.groundY, ps.pose.z); pg.rotation.y = -ps.pose.heading; }
      (document.getElementById('info')!).textContent = `${sched.at(T).title} · ${s.task} · fill ${s.fill.toFixed(2)} · T=${T.toFixed(1)}`;
    };
  });
  return (t: number) => tick?.(t);
}
