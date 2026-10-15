/**
 * Mundo de la simulación: arma la escena completa (edificio, faena, grúa, camiones,
 * cuadrillas, etiquetas) y la actualiza para cada instante T del cronograma.
 */
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { SITE } from '../config';
import type { LoadedBuilding } from '../data/building';
import { CranePlan, type PayloadKind } from '../core/cranePlan';
import { Crews } from '../core/crews';
import { Logistics } from '../core/logistics';
import { buildSchedule, haWalls, type Schedule } from '../core/schedule';
import { createCapacho, type CapachoRig } from './equipment/capacho';
import { createCrane, type CraneRig } from './equipment/crane';
import { createMixer, type MixerRig } from './equipment/mixer';
import { createPanelPack, createDeckPack, createPropBundle, createRebarBundle } from './equipment/payloads';
import { createConcreteStream, type ConcreteStream } from './equipment/pour';
import { createPump, type PumpRig } from './equipment/pump';
import type { Crowd } from './equipment/workers';
import { uTime } from './reveal';
import type { SiteRig } from './site';
import type { Stage } from './stage';
import { buildStructure, type Structure } from './structure';
import type { createTag } from '../ui/hud';

/** Fábricas de las partes que viven en otros módulos (permite probar el mundo por partes). */
export interface WorldDeps {
  createSite: () => SiteRig;
  createCrowd: (max: number) => Crowd;
  createTag: typeof createTag;
}

const MIXER_POOL = 4;

export interface WorldState {
  /** Punto de trabajo actual (para seguir la obra con la cámara). */
  focus: THREE.Vector3;
  craneTask: string;
  pumpBusy: boolean;
  mixersOnSite: number;
}

export class World {
  sched: Schedule;
  structure: Structure;
  site: SiteRig;
  crane: CraneRig;
  plan: CranePlan;
  log: Logistics;
  crews: Crews;
  crowd: Crowd;
  capacho: CapachoRig;
  pump: PumpRig;
  mixers: MixerRig[] = [];
  streams: ConcreteStream[] = [];
  payloads: Record<Exclude<PayloadKind, 'capacho'>, THREE.Group>;
  pickables: THREE.Object3D[] = [];
  labels: { obj: CSS2DObject; el: HTMLElement; key: string }[] = [];
  state: WorldState = { focus: new THREE.Vector3(0, 8, 0), craneTask: '', pumpBusy: false, mixersOnSite: 0 };
  private capachoRest = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private mixerChuteLocal = new THREE.Vector3();
  private labelsOn = true;
  private highlight: THREE.LineSegments;

  constructor(private stage: Stage, readonly b: LoadedBuilding, private deps: WorldDeps) {
    const { data, detail } = b;
    const scene = stage.scene;
    this.sched = buildSchedule(data);
    this.structure = buildStructure(data, this.sched, detail);
    scene.add(this.structure.group);
    this.pickables.push(...this.structure.pickables);

    this.site = deps.createSite();
    scene.add(this.site.group);
    this.pickables.push(...this.site.pickables);

    // grúa torre
    const C = SITE.crane;
    this.crane = createCrane({ mastHeight: C.mastHeight, jibLength: C.jibLength, counterJibLength: C.counterJibLength });
    this.crane.group.position.set(C.x, SITE.groundY, C.z);
    scene.add(this.crane.group);
    this.pickables.push(...this.crane.pickables);

    // cargas que cuelgan del gancho
    this.capacho = createCapacho();
    this.payloads = { panel: createPanelPack(), rebar: createRebarBundle(), deck: createDeckPack(), props: createPropBundle() };
    const hangOf = (o: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(o);
      return Math.max(0.5, -box.min.y);
    };
    const hang: Record<PayloadKind, number> = {
      capacho: this.capacho.height,
      panel: hangOf(this.payloads.panel),
      rebar: hangOf(this.payloads.rebar),
      deck: hangOf(this.payloads.deck),
      props: hangOf(this.payloads.props),
    };
    this.pickables.push(...this.capacho.pickables);

    // mixers y bomba
    for (let i = 0; i < MIXER_POOL; i++) {
      const m = createMixer();
      m.group.visible = false;
      scene.add(m.group);
      this.mixers.push(m);
      m.pickables.forEach((p) => (p.userData.pick = { ...(p.userData.pick ?? { type: 'mixer' }), slot: i }));
      this.pickables.push(...m.pickables);
    }
    // canaleta del mixer estacionado para el capacho (en coordenadas de mundo)
    {
      const m = this.mixers[0];
      m.setChute(1);
      m.group.position.set(0, 0, 0);
      m.group.rotation.set(0, 0, 0);
      m.group.updateMatrixWorld(true);
      m.chuteTip.getWorldPosition(this.mixerChuteLocal);
      m.setChute(0);
    }
    const chuteWorld = {
      x: SITE.mixerCapacho.x + this.mixerChuteLocal.x,
      y: SITE.groundY + this.mixerChuteLocal.y,
      z: SITE.mixerCapacho.z + this.mixerChuteLocal.z,
    };
    this.capachoRest.set(chuteWorld.x - 1.5, SITE.groundY, chuteWorld.z + 3.2);

    this.pump = createPump();
    this.pump.group.visible = false;
    scene.add(this.pump.group);
    this.pickables.push(...this.pump.pickables);

    for (let i = 0; i < 4; i++) {
      const s = createConcreteStream();
      scene.add(s.group);
      this.streams.push(s);
    }

    // plan de grúa y logística
    const lv = data.levels;
    const anchors = this.site.anchors;
    const P = (v: THREE.Vector3) => ({ x: v.x, y: v.y, z: v.z });
    this.plan = new CranePlan({
      base: { x: C.x, z: C.z, y: SITE.groundY },
      jibY: SITE.groundY + this.crane.jibHeight,
      jibLength: C.jibLength,
      anchors: {
        acopioMoldajeMuro: P(anchors.acopioMoldajeMuro),
        acopioMoldajeLosa: P(anchors.acopioMoldajeLosa),
        acopioFierro: P(anchors.acopioFierro),
        acopioPuntales: P(anchors.acopioPuntales),
      },
      mixerChute: chuteWorld,
      hang,
      topAt: (t) => {
        const a = this.sched.at(t);
        if (a.kind === 'fundaciones' || a.kind === 'radier') return 1;
        if (a.kind === 'terminaciones') return lv[lv.length - 1].slab.y1 + 1.2;
        if (a.kind.startsWith('muro')) return lv[a.level].slab.y1 + 3.0;
        return lv[a.level].slab.y1 + 1.3;
      },
      levelFloorY: (L) => lv[L].slab.y1,
      wallTopY: (L) => haWalls(lv[L])[0]?.y1 ?? lv[L].slab.y1 + 2.35,
      slabBottomY: (S) => lv[S].slab.y0,
    }, this.sched);
    this.log = new Logistics(this.sched);

    // cuadrillas
    this.crews = new Crews({ data, sched: this.sched, ground: {} });
    this.crowd = deps.createCrowd(this.crews.members.length);
    scene.add(this.crowd.group);
    this.pickables.push(...this.crowd.pickables);

    // resaltado de piso seleccionado
    this.highlight = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: '#ffb020', transparent: true, opacity: 0.95, depthTest: false }),
    );
    this.highlight.renderOrder = 10;
    this.highlight.visible = false;
    scene.add(this.highlight);

    this.makeLabels();
  }

  private addLabel(key: string, text: string, kind: Parameters<typeof createTag>[1], parent: THREE.Object3D, pos: THREE.Vector3) {
    const el = this.deps.createTag(text, kind);
    const obj = new CSS2DObject(el);
    obj.position.copy(pos);
    parent.add(obj);
    this.labels.push({ obj, el, key });
    return obj;
  }

  private makeLabels() {
    const a = this.site.anchors;
    const root = this.stage.scene;
    this.addLabel('crane', 'Grúa torre', 'crane', this.crane.group, new THREE.Vector3(0, this.crane.jibHeight + 9, 0));
    this.addLabel('am', 'Acopio moldajes de muro', 'acopio', root, a.acopioMoldajeMuro.clone().add(new THREE.Vector3(0, 2.2, 0)));
    this.addLabel('al', 'Acopio moldaje de losa', 'acopio', root, a.acopioMoldajeLosa.clone().add(new THREE.Vector3(0, 2.2, 0)));
    this.addLabel('af', 'Acopio de fierro', 'acopio', root, a.acopioFierro.clone().add(new THREE.Vector3(0, 2.2, 0)));
    this.addLabel('faena', 'Instalación de faena', 'info', root, new THREE.Vector3(SITE.faena.x, 5, SITE.faena.z));
    this.addLabel('pump', 'Camión bomba', 'pump', this.pump.group, new THREE.Vector3(0, 5.5, 0));
    this.mixers.forEach((m, i) => this.addLabel(`mixer${i}`, 'Mixer 7 m³', 'mixer', m.group, new THREE.Vector3(0, 4.6, 0)));
    this.addLabel('front', 'Frente de trabajo', 'work', root, new THREE.Vector3());
  }

  setLabels(on: boolean) {
    this.labelsOn = on;
    for (const l of this.labels) l.obj.visible = on;
  }

  /** Activa/desactiva el corte longitudinal del edificio para ver el interior. */
  setCutaway(on: boolean) {
    const planes = this.structure.clipping;
    planes.length = 0;
    if (on) planes.push(new THREE.Plane(new THREE.Vector3(0, 0, -1), 1.2));
    this.structure.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) {
        m.needsUpdate = true;
        const depth = m.userData?.depth as THREE.Material | undefined;
        if (depth) depth.needsUpdate = true;
      }
    });
  }

  /** Dibuja el contorno del piso seleccionado (o lo oculta). */
  highlightLevel(level: number | null) {
    if (level === null) {
      this.highlight.visible = false;
      return;
    }
    const lv = this.b.data.levels;
    const slab = lv[level].slab;
    const yTop = level + 1 < lv.length ? lv[level + 1].slab.y0 : slab.y1 + 2.35;
    const pts: number[] = [];
    const ring = slab.outer;
    for (const y of [slab.y0, yTop]) {
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        pts.push(p[0], y, p[1], q[0], y, q[1]);
      }
    }
    for (let i = 0; i < ring.length; i += Math.max(1, Math.floor(ring.length / 12))) pts.push(ring[i][0], slab.y0, ring[i][1], ring[i][0], yTop, ring[i][1]);
    this.highlight.geometry.dispose();
    this.highlight.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.highlight.visible = true;
  }

  update(T: number, dt: number, clock: number) {
    uTime.value = T;
    this.structure.update(T);
    this.site.update(clock, dt);

    // --- grúa y carga ---
    const cs = this.plan.at(T);
    const gy = SITE.groundY;
    this.crane.setPose(cs.slew, cs.r, cs.hookY - gy);
    this.crane.update(clock, dt);
    this.state.craneTask = cs.task;
    const hook = this.crane.hook;
    const want: THREE.Object3D | null = cs.payload === 'capacho' ? this.capacho.group : cs.payload ? this.payloads[cs.payload] : null;
    for (const p of [this.capacho.group, ...Object.values(this.payloads)]) {
      if (p !== want && p.parent === hook) hook.remove(p);
    }
    if (want && want.parent !== hook) hook.add(want);
    // capacho en reposo junto al punto del mixer cuando no está colgado
    if (cs.payload !== 'capacho') {
      if (this.capacho.group.parent !== this.stage.scene) this.stage.scene.add(this.capacho.group);
      this.capacho.group.position.copy(this.capachoRest).add(new THREE.Vector3(0, this.capacho.height - 0.02, 0));
      this.capacho.setFill(0);
      this.capacho.setOpen(0);
    } else {
      this.capacho.group.position.set(0, 0, 0);
      this.capacho.setFill(cs.fill);
      this.capacho.setOpen(cs.open);
    }

    // --- mixers ---
    const mstates = this.log.mixerStates(T);
    this.mixers.forEach((m) => (m.group.visible = false));
    let chuteActive: THREE.Vector3 | null = null;
    let pumpHopperFeed: THREE.Vector3 | null = null;
    for (const s of mstates) {
      const m = this.mixers[s.id % MIXER_POOL];
      m.group.visible = true;
      m.group.position.set(s.pose.x, gy, s.pose.z);
      m.group.rotation.set(0, -s.pose.heading, 0);
      m.setWheels(s.dist);
      m.setChute(s.chute);
      m.setDischarge(s.discharging);
      m.setDrumSpin(clock * (s.discharging ? -2.2 : 1.1) + s.id);
      if (s.discharging && s.chute > 0.95) {
        m.group.updateMatrixWorld(true);
        const v = m.chuteTip.getWorldPosition(new THREE.Vector3());
        const visit = this.log.mixers.find((x) => x.id === s.id);
        if (visit?.spot === 'bomba') pumpHopperFeed = v;
        else chuteActive = v;
      }
    }
    this.state.mixersOnSite = mstates.length;

    // chorro mixer → capacho (solo mientras se llena)
    const sMix = this.streams[0];
    if (chuteActive && cs.payload === 'capacho' && cs.cycle && T >= cs.cycle.fill[0] && T <= cs.cycle.fill[1]) {
      this.capacho.group.getWorldPosition(this.tmp);
      sMix.set(chuteActive, this.tmp.clone().add(new THREE.Vector3(0, -0.5, 0)), 1, clock);
    } else sMix.set(this.tmp, this.tmp, 0, clock);

    // chorro capacho → muro
    const sCap = this.streams[1];
    if (cs.payload === 'capacho' && cs.open > 0.05 && cs.cycle) {
      this.capacho.outlet.getWorldPosition(this.tmp);
      this.tmp2.set(this.tmp.x, cs.cycle.to.y, this.tmp.z);
      sCap.set(this.tmp, this.tmp2, cs.open, clock);
    } else sCap.set(this.tmp, this.tmp, 0, clock);

    // --- camión bomba ---
    const ps = this.log.pumpState(T);
    const sHose = this.streams[2];
    const sHop = this.streams[3];
    this.state.pumpBusy = !!ps;
    if (ps) {
      const pump = this.pump;
      pump.group.visible = true;
      pump.group.position.set(ps.pose.x, gy, ps.pose.z);
      pump.group.rotation.set(0, -ps.pose.heading, 0);
      pump.setOutriggers(ps.outriggers);
      pump.group.updateMatrixWorld(true);
      const sw = this.structure.sweeps[ps.slab];
      const target = this.sweepPoint(sw, ps.progress);
      pump.setBoom(ps.boom, target);
      if (ps.pouring) {
        pump.hoseTip.getWorldPosition(this.tmp);
        sHose.set(this.tmp, new THREE.Vector3(this.tmp.x, sw.y, this.tmp.z), 1, clock);
        this.state.focus.set(target.x, sw.y, target.z);
      } else sHose.set(this.tmp, this.tmp, 0, clock);
      if (pumpHopperFeed && ps.pouring) {
        pump.hopper.getWorldPosition(this.tmp2);
        sHop.set(pumpHopperFeed, this.tmp2, 0.8, clock);
      } else sHop.set(this.tmp2, this.tmp2, 0, clock);
    } else {
      this.pump.group.visible = false;
      sHose.set(this.tmp, this.tmp, 0, clock);
      sHop.set(this.tmp, this.tmp, 0, clock);
    }

    // --- cuadrillas ---
    const act = this.sched.at(T);
    const a = this.site.anchors;
    const ground: { x: number; z: number; action: 'idle' | 'walk' | 'work' | 'carry' }[] = [
      { x: a.acopioFierro.x, z: a.acopioFierro.z, action: 'work' },
      { x: SITE.tallerFierro.x, z: SITE.tallerFierro.z, action: 'work' },
      { x: SITE.tallerFierro.x - 2, z: SITE.tallerFierro.z + 2, action: 'work' },
      { x: a.acopioMoldajeMuro.x, z: a.acopioMoldajeMuro.z, action: 'work' },
      { x: SITE.mixerCapacho.x - 4, z: SITE.mixerCapacho.z + 2.5, action: 'idle' },
      { x: a.acopioMoldajeLosa.x, z: a.acopioMoldajeLosa.z, action: 'work' },
      { x: SITE.faena.x + 6, z: SITE.faena.z + 4, action: 'idle' },
      { x: SITE.crane.x + 2.5, z: SITE.crane.z + 2.5, action: 'idle' },
    ];
    this.crews.update(T, act, ground);
    this.crews.members.forEach((m, i) => this.crowd.set(i, { ...m, t: clock + i * 0.37 }));
    this.crowd.commit();
    if (!ps?.pouring) {
      const f = this.crews.focus(act, T);
      this.state.focus.set(f.x, f.y + 1, f.z);
    }

    // etiqueta del frente de trabajo
    const front = this.labels.find((l) => l.key === 'front');
    if (front) {
      front.obj.position.copy(this.state.focus).add(new THREE.Vector3(0, 3.2, 0));
      front.obj.visible = this.labelsOn && act.kind !== 'terminaciones';
    }
    for (const l of this.labels) {
      if (l.key === 'pump') l.obj.visible = this.labelsOn && this.pump.group.visible;
      if (l.key.startsWith('mixer')) l.obj.visible = this.labelsOn && this.mixers[+l.key.slice(5)].group.visible;
    }
  }

  /** Punto del barrido en zig-zag de la losa (mismo recorrido que el shader). */
  sweepPoint(sw: { xmin: number; xmax: number; zmin: number; zmax: number; strips: number; y: number }, p: number) {
    const n = sw.strips;
    const q = Math.min(Math.max(p, 0), 0.9999) * n;
    const strip = Math.floor(q);
    let along = q - strip;
    if (strip % 2 === 1) along = 1 - along;
    const x = sw.xmin + ((strip + 0.5) / n) * (sw.xmax - sw.xmin);
    const z = sw.zmin + 0.8 + along * (sw.zmax - sw.zmin - 1.6);
    return new THREE.Vector3(x, sw.y + 0.25, z);
  }
}
