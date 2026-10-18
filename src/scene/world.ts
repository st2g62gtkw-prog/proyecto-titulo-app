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
import { createStationaryPump, type StationaryPumpRig } from './equipment/stationaryPump';
import { createPipeline, type Pipeline } from './pipeline';
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

const MIXER_POOL = 5;

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
  pump: StationaryPumpRig;
  pipeline: Pipeline;
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
    // el capacho se llena apoyado en el suelo, con la punta de la canaleta sobre su boca (un poco
    // hacia el camión); entra y sale a ras de suelo desde 1,7 m frente a la punta (sobre el eje del
    // mixer, fuera del alcance de la canaleta) y en reposo queda a un costado del carril (lado del
    // edificio), un poco más atrás que el punto de llenado para no rozar la parte trasera del mixer
    const capachoFill = {
      x: SITE.mixerCapacho.x + this.mixerChuteLocal.x + 0.25,
      y: SITE.groundY,
      z: SITE.mixerCapacho.z + this.mixerChuteLocal.z,
    };
    const capachoSlide = { x: capachoFill.x - 1.7, y: SITE.groundY, z: capachoFill.z };
    this.capachoRest.set(capachoFill.x - 1.0, SITE.groundY, SITE.road.inZ + 3.0);
    // asa perpendicular al eje del mixer (el gancho no gira con la pluma): así la canaleta pasa bajo
    // el travesaño del asa y no a través de sus brazos
    this.capacho.group.rotation.y = Math.PI / 2;

    // bomba estacionaria en su caseta y la tubería que sube por el shaft del ascensor
    this.pump = createStationaryPump();
    this.pump.group.position.set(SITE.pump.x, SITE.groundY, SITE.pump.z);
    this.pump.group.rotation.y = SITE.pump.heading;
    scene.add(this.pump.group);
    this.pump.group.updateMatrixWorld(true);
    this.pickables.push(...this.pump.pickables);
    const outlet = this.pump.outlet.getWorldPosition(new THREE.Vector3());
    // la tubería sale de la caseta por su muro trasero (−z local de la bomba)
    const outletDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.pump.group.quaternion);
    this.pipeline = createPipeline(data, this.sched, outlet, outletDir, this.structure.clipping);
    scene.add(this.pipeline.group);
    this.pickables.push(...this.pipeline.pickables);

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
      capachoFill,
      capachoSlide,
      capachoRest: P(this.capachoRest),
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
    this.addLabel('pump', 'Bomba estacionaria', 'pump', this.pump.group, new THREE.Vector3(0, 4.2, 0));
    this.addLabel('gate', 'Portón de camiones', 'info', root, new THREE.Vector3(SITE.gate.x + 1, 4.2, SITE.gate.z));
    this.mixers.forEach((m, i) => this.addLabel(`mixer${i}`, 'Mixer 7 m³', 'mixer', m.group, new THREE.Vector3(0, 4.6, 0)));
    this.addLabel('front', 'Frente de trabajo', 'work', root, new THREE.Vector3());
  }

  setLabels(on: boolean) {
    this.labelsOn = on;
    for (const l of this.labels) l.obj.visible = on;
  }

  /**
   * Plano del corte longitudinal (z = 1,2, a media planta). Mirando desde el frente se quita la
   * mitad delantera (+z); en la vista posterior, la mitad trasera, para ver el interior desde atrás.
   */
  private cutPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1.2);

  /** Activa/desactiva el corte longitudinal del edificio para ver el interior. */
  setCutaway(on: boolean) {
    const planes = this.structure.clipping;
    planes.length = 0;
    if (on) planes.push(this.cutPlane);
    // el vano de la puerta (en el grupo de la tubería) se corta junto con el edificio
    for (const g of [this.structure.group, this.pipeline.group]) {
      g.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m) {
          m.needsUpdate = true;
          const depth = m.userData?.depth as THREE.Material | undefined;
          if (depth) depth.needsUpdate = true;
        }
      });
    }
  }

  /** Orienta el corte según el lado desde el que mira la cámara (se puede llamar cada cuadro). */
  setCutSide(fromBack: boolean) {
    const s = fromBack ? 1 : -1;
    if (this.cutPlane.normal.z !== s) this.cutPlane.set(new THREE.Vector3(0, 0, s), -s * 1.2);
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
      // misma cota que cuando la grúa lo apoya (gancho = suelo + 1 cm + alto del capacho)
      this.capacho.group.position.copy(this.capachoRest).add(new THREE.Vector3(0, this.capacho.height + 0.01, 0));
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

    // chorro mixer → capacho (solo mientras se llena): de la canaleta al hormigón dentro del capacho
    const sMix = this.streams[0];
    if (chuteActive && cs.payload === 'capacho' && cs.cycle && T >= cs.cycle.fill[0] && T <= cs.cycle.fill[1]) {
      this.capacho.group.getWorldPosition(this.tmp);
      sMix.set(chuteActive, this.tmp.clone().add(new THREE.Vector3(0, -1.25, 0)), 1, clock);
    } else sMix.set(this.tmp, this.tmp, 0, clock);

    // chorro capacho → muro
    const sCap = this.streams[1];
    if (cs.payload === 'capacho' && cs.open > 0.05 && cs.cycle) {
      this.capacho.outlet.getWorldPosition(this.tmp);
      this.tmp2.set(this.tmp.x, cs.cycle.to.y, this.tmp.z);
      sCap.set(this.tmp, this.tmp2, cs.open, clock);
    } else sCap.set(this.tmp, this.tmp, 0, clock);

    // --- bomba estacionaria y tubería ---
    const ps = this.log.pumpState(T);
    const sHose = this.streams[2];
    const sHop = this.streams[3];
    this.state.pumpBusy = ps.pumping;
    this.pump.setPumping(ps.pumping, clock);
    const sw = this.structure.sweeps[ps.slab];
    const target = ps.pumping && sw ? this.sweepPoint(sw, ps.progress) : null;
    const tip = this.pipeline.update(ps.slab, ps.pumping, target);
    if (tip && target && sw) {
      sHose.set(tip, new THREE.Vector3(target.x, sw.y, target.z), 1, clock);
      this.state.focus.set(target.x, sw.y, target.z);
    } else sHose.set(this.tmp, this.tmp, 0, clock);
    if (pumpHopperFeed && ps.pumping) {
      this.pump.hopper.getWorldPosition(this.tmp2);
      sHop.set(pumpHopperFeed, this.tmp2, 0.8, clock);
    } else sHop.set(this.tmp2, this.tmp2, 0, clock);

    // --- cuadrillas ---
    const act = this.sched.at(T);
    const a = this.site.anchors;
    // en terreno: alrededor de los acopios (no encima), taller de fierro, capacho y faena
    const ground: { x: number; z: number; r?: number; spread?: number; action: 'idle' | 'walk' | 'work' | 'carry' }[] = [
      { x: a.acopioFierro.x - 4.5, z: a.acopioFierro.z + 1, r: 0.8, action: 'work' },
      { x: SITE.tallerFierro.x, z: SITE.tallerFierro.z, r: 1.6, action: 'work' },
      { x: SITE.tallerFierro.x - 2, z: SITE.tallerFierro.z + 2, r: 1.2, action: 'work' },
      { x: a.acopioMoldajeMuro.x + 6.5, z: a.acopioMoldajeMuro.z - 1.5, r: 0.8, action: 'work' },
      // rigger del capacho: al borde del carril (lado del edificio), junto al punto de llenado
      { x: this.capachoRest.x + 2.5, z: SITE.road.inZ + 2.6, r: 0.3, spread: 0.5, action: act.kind === 'muroHormigon' || act.kind === 'fundaciones' ? 'work' : 'idle' },
      { x: a.acopioMoldajeLosa.x - 5.5, z: a.acopioMoldajeLosa.z + 1.5, r: 0.8, action: 'work' },
      { x: SITE.faena.x + 7, z: SITE.faena.z + 5, r: 1.5, action: 'idle' },
      { x: SITE.crane.x + 4.2, z: SITE.crane.z + 3.8, r: 0.5, action: 'idle' },
    ];
    // concreteros en la bomba: el operador junto a la caseta (lado del edificio) y uno en la tolva.
    // Los puestos están siempre en la lista (en espera fuera del bombeo) para que el largo no cambie
    // y nadie más salte de puesto al empezar o terminar un hormigonado
    {
      const P = SITE.pump, on = ps.pumping;
      ground.push(
        { x: P.x - 0.4, z: P.z + 2.6, r: 0.15, spread: 0.35, action: on ? 'work' : 'idle' },
        on ? { x: P.x + 3.0, z: P.z + 2.25, r: 0.15, spread: 0.3, action: 'work' } : { x: P.x + 0.8, z: P.z + 2.7, r: 0.2, spread: 0.4, action: 'idle' },
      );
    }
    // trabajos en paralelo en el 1er piso (redes bajo radier, hormigonado del radier): cuatro puestos
    // fijos; sin trabajo en paralelo esas personas apoyan en el taller de fierro y en la faena
    const par = this.sched.parallel.find((x) => T >= x.t0 && T <= x.t1);
    const spare = [ground[1], ground[2], ground[6], ground[7]];
    for (let i = 0; i < 4; i++) {
      if (!par) {
        ground.push(spare[i]);
        continue;
      }
      const b0 = this.structure.sweeps[0];
      const k = (T - par.t0) / (par.t1 - par.t0);
      const at = par.kind === 'radier' && ps.pumping && ps.slab === 0 && target
        ? { x: target.x, z: target.z }
        : { x: b0.xmin + k * (b0.xmax - b0.xmin), z: (b0.zmin + b0.zmax) / 2 + 0.6 };
      ground.push({ x: at.x + (i - 1.5) * 1.2, z: at.z + (i % 2 ? 1 : -1), r: 0.5, action: 'work' });
    }
    this.crews.update(T, act, ground);
    this.crews.members.forEach((m, i) => this.crowd.set(i, { ...m, t: clock + i * 0.37 }));
    this.crowd.commit();
    if (!ps.pumping) {
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
