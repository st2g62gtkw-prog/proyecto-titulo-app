/**
 * Mundo de la simulación: arma la escena completa (edificio, faena, grúa, camiones,
 * cuadrillas, etiquetas) y la actualiza para cada instante T del cronograma.
 */
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { SITE } from '../config';
import type { LoadedBuilding } from '../data/building';
import { CranePlan, LOAD_F, type PayloadKind } from '../core/cranePlan';
import { Crews } from '../core/crews';
import { Logistics } from '../core/logistics';
import { buildPaintPlan, type PaintPlan, type PaintState } from '../core/paintPlan';
import { buildSchedule, haWalls, type Schedule } from '../core/schedule';
import { groundAt, Y_FAENA } from '../core/terrain';
import { createBalancin, type BalancinRig } from './equipment/balancin';
import { createCapacho, type CapachoRig } from './equipment/capacho';
import { createCrane, type CraneRig } from './equipment/crane';
import { createDumpTruck, type DumpTruckRig } from './equipment/dumpTruck';
import { createExcavator, type ExcavatorRig } from './equipment/excavator';
import { createMixer, type MixerRig } from './equipment/mixer';
import { createRammer, type RammerRig } from './equipment/rammer';
import { createPanelPack, createDeckPack, createPropBundle, createRebarBundle, createSheetPack, createTimberPack } from './equipment/payloads';
import { createConcreteStream, type ConcreteStream } from './equipment/pour';
import { createStationaryPump, type StationaryPumpRig } from './equipment/stationaryPump';
import { buildFacadePaint } from './facadePaint';
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
/** Camiones tolva que pueden estar a la vez en la obra (uno cargando y otro esperando o saliendo). */
const TRUCK_POOL = 3;

/** Punto plano {x, y, z} de un vector (para el plan de la grúa, que no depende de three). */
const toP3 = (v: THREE.Vector3) => ({ x: v.x, y: v.y, z: v.z });

/**
 * Apoya un camión en el terreno (la calle del portón, el camino de abajo y la rampa de los
 * camiones tolva tienen pendiente): a la cota media de sus ejes y con el cabeceo de la pendiente a lo
 * largo del rumbo (half = medio largo entre ejes).
 */
function onGround(g: THREE.Object3D, x: number, z: number, heading: number, half = 2.4) {
  const c = Math.cos(heading), s = Math.sin(heading);
  const yf = groundAt(x + c * half, z + s * half), yb = groundAt(x - c * half, z - s * half);
  g.position.set(x, (yf + yb) / 2, z);
  g.rotation.set(0, -heading, Math.atan2(yf - yb, 2 * half), 'YXZ');
}

export interface WorldState {
  /** Punto de trabajo actual (para seguir la obra con la cámara). */
  focus: THREE.Vector3;
  craneTask: string;
  /** Qué hace la excavadora (vacío si no está en obra). */
  excavatorTask: string;
  trucksOnSite: number;
  pumpBusy: boolean;
  mixersOnSite: number;
  /** Balancín del subcontrato de pintura (null si no está en obra). */
  paint: PaintState | null;
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
  /** Subcontrato de pintura de fachada: plan, piel pintada, balancín y sus dos pintores. */
  paint: PaintPlan;
  facade: THREE.Mesh;
  balancin: BalancinRig;
  painters: Crowd;
  capacho: CapachoRig;
  pump: StationaryPumpRig;
  pipeline: Pipeline;
  mixers: MixerRig[] = [];
  /** Excavación de las fundaciones: excavadora y camiones tolva. */
  excavator: ExcavatorRig;
  trucks: DumpTruckRig[] = [];
  streams: ConcreteStream[] = [];
  payloads: Record<Exclude<PayloadKind, 'capacho'>, THREE.Group>;
  pickables: THREE.Object3D[] = [];
  labels: { obj: CSS2DObject; el: HTMLElement; key: string }[] = [];
  state: WorldState = { focus: new THREE.Vector3(0, 8, 0), craneTask: '', excavatorTask: '', trucksOnSite: 0, pumpBusy: false, mixersOnSite: 0, paint: null };
  /** Paquetes de fierro y de tableros que la grúa dejó en el borde de cada sector (fundaciones). */
  private grounded: { obj: THREE.Object3D; from: number; to: number }[] = [];
  /** Vibropisones de la cuadrilla de relleno (fundaciones). */
  private rammers: RammerRig[] = [];
  private capachoRest = new THREE.Vector3();
  private capachoFill = new THREE.Vector3();
  private pumpHopper = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
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
    this.payloads = {
      panel: createPanelPack(), rebar: createRebarBundle(), deck: createDeckPack(), props: createPropBundle(),
      timber: createTimberPack(), sheets: createSheetPack(),
    };
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
      timber: hangOf(this.payloads.timber),
      sheets: hangOf(this.payloads.sheets),
    };
    this.pickables.push(...this.capacho.pickables);
    // fundaciones: al soltarlo, cada paquete queda en el suelo (sin eslingas) hasta que la cuadrilla
    // lo consume (enfierradura o moldaje del sector)
    for (const c of this.sched.fund.craneTrips) {
      const obj = c.kind === 'rebar' ? createRebarBundle(true) : createPanelPack(true);
      obj.position.set(c.x, c.y + hang[c.kind], c.z);
      obj.visible = false;
      scene.add(obj);
      this.pickables.push(obj);
      this.grounded.push({ obj, from: c.t0 + LOAD_F[7] * (c.t1 - c.t0), to: c.until });
    }
    // banderín de "sello recibido" de cada sector: lo clava el mecánico de suelos al recibir los
    // sellos y se retira al terminar el emplantillado
    {
      const pole = new THREE.CylinderGeometry(0.025, 0.025, 1.7, 6).translate(0, 0.85, 0);
      const flagGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1.68, 0), new THREE.Vector3(0.62, 1.5, 0), new THREE.Vector3(0, 1.3, 0)]);
      flagGeo.computeVertexNormals();
      const mPole = new THREE.MeshStandardMaterial({ color: '#e8e8e8', roughness: 0.6 });
      const mFlag = new THREE.MeshStandardMaterial({ color: '#2e9e4f', roughness: 0.7, side: THREE.DoubleSide });
      for (const S of this.sched.fund.sectors) {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(pole, mPole), new THREE.Mesh(flagGeo, mFlag));
        g.position.set(S.flag.x, SITE.groundY, S.flag.z);
        g.rotation.y = 0.6;
        g.visible = false;
        g.traverse((o) => (o.userData.pick = { type: 'fund', id: 'sello' }));
        scene.add(g);
        this.pickables.push(g);
        this.grounded.push({ obj: g, from: S.recep[0], to: S.empl.t1 });
      }
    }
    for (let i = 0; i < 4; i++) {
      const r = createRammer();
      r.group.visible = false;
      scene.add(r.group);
      this.pickables.push(...r.pickables);
      this.rammers.push(r);
    }

    // mixers y bomba
    for (let i = 0; i < MIXER_POOL; i++) {
      const m = createMixer();
      m.group.visible = false;
      scene.add(m.group);
      this.mixers.push(m);
      m.pickables.forEach((p) => (p.userData.pick = { ...(p.userData.pick ?? { type: 'mixer' }), slot: i }));
      this.pickables.push(...m.pickables);
    }
    // punta de la canaleta del mixer detenido para el capacho (llega en retroceso: la cabina mira al
    // portón, hacia −x, y la canaleta queda hacia la bomba)
    const cap = SITE.mixerCapacho, stopHeading = Math.PI;
    const toCab = new THREE.Vector3(Math.cos(stopHeading), 0, Math.sin(stopHeading));
    {
      const m = this.mixers[0];
      m.setChute(1);
      m.group.position.set(cap.x, groundAt(cap.x, cap.z), cap.z);
      m.group.rotation.set(0, -stopHeading, 0);
      m.group.updateMatrixWorld(true);
      m.chuteTip.getWorldPosition(this.capachoFill);
      m.setChute(0);
    }
    // el capacho se llena apoyado en el suelo, con la punta de la canaleta sobre su boca (un poco
    // hacia el camión); entra y sale a ras de suelo desde 1,7 m más allá de la punta (sobre el eje
    // del mixer, fuera del alcance de la canaleta) y en reposo queda al lado de ese punto, a un
    // costado del camino (lado del talud): la grúa lo lleva de uno a otro sin pasar sobre el camión
    this.capachoFill.addScaledVector(toCab, 0.25);
    this.capachoFill.setY(groundAt(this.capachoFill.x, this.capachoFill.z));
    const capachoFill = toP3(this.capachoFill);
    const capachoSlide = toP3(this.capachoFill.clone().addScaledVector(toCab, -1.7));
    this.capachoRest.set(capachoSlide.x, groundAt(capachoSlide.x, SITE.road.z - 3.4), SITE.road.z - 3.4);
    // asa perpendicular al eje del mixer (el gancho no gira con la pluma): así la canaleta pasa bajo
    // el travesaño del asa y no a través de sus brazos
    this.capacho.group.rotation.y = Math.PI / 2;

    // bomba estacionaria en su caseta y la tubería que sube por el shaft del ascensor
    this.pump = createStationaryPump();
    // abajo, a la cota del camino (ensanche entre el camino y el pie del corte posterior)
    this.pump.group.position.set(SITE.pump.x, groundAt(SITE.pump.x, SITE.pump.z), SITE.pump.z);
    this.pump.group.rotation.y = SITE.pump.heading;
    scene.add(this.pump.group);
    this.pump.group.updateMatrixWorld(true);
    this.pickables.push(...this.pump.pickables);
    const outlet = this.pump.outlet.getWorldPosition(new THREE.Vector3());
    this.pump.hopper.getWorldPosition(this.pumpHopper);
    // la tubería sale de la caseta por su muro trasero (−z local de la bomba)
    const outletDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.pump.group.quaternion);
    this.pipeline = createPipeline(data, this.sched, outlet, outletDir, this.structure.clipping);
    scene.add(this.pipeline.group);
    this.pickables.push(...this.pipeline.pickables);

    // excavadora y camiones tolva de la excavación de fundaciones
    this.excavator = createExcavator();
    this.excavator.group.visible = false;
    scene.add(this.excavator.group);
    this.pickables.push(...this.excavator.pickables);
    for (let i = 0; i < TRUCK_POOL; i++) {
      const tk = createDumpTruck();
      tk.group.visible = false;
      scene.add(tk.group);
      this.trucks.push(tk);
      this.pickables.push(...tk.pickables);
    }
    // la excavación de las zapatas recorta el terreno de la faena
    this.site.setGroundMask?.(this.structure.groundMask);

    for (let i = 0; i < 4; i++) {
      const s = createConcreteStream();
      scene.add(s.group);
      this.streams.push(s);
    }

    // plan de grúa y logística
    const lv = data.levels;
    const anchors = this.site.anchors;
    this.plan = new CranePlan({
      base: { x: C.x, z: C.z, y: SITE.groundY },
      jibY: SITE.groundY + this.crane.jibHeight,
      jibLength: C.jibLength,
      anchors: {
        acopioMoldajeMuro: toP3(anchors.acopioMoldajeMuro),
        acopioMoldajeLosa: toP3(anchors.acopioMoldajeLosa),
        acopioFierro: toP3(anchors.acopioFierro),
        acopioPuntales: toP3(anchors.acopioPuntales),
      },
      capachoFill,
      capachoSlide,
      capachoRest: toP3(this.capachoRest),
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

    // pintura de fachada (subcontrato): la piel pintada va con el edificio (corte incluido) y el
    // balancín cuelga de la techumbre con dos pintores (casco azul y chaleco naranjo)
    this.paint = buildPaintPlan(data, this.sched);
    this.facade = buildFacadePaint(this.paint, this.structure.clipping);
    this.structure.group.add(this.facade);
    this.balancin = createBalancin({ roofY: this.paint.roofY, groundY: SITE.groundY });
    scene.add(this.balancin.group);
    this.pickables.push(...this.balancin.pickables);
    this.painters = deps.createCrowd(2);
    this.painters.group.name = 'pintores';
    for (const p of this.painters.pickables) p.userData.pick = { type: 'balancin' };
    scene.add(this.painters.group);
    this.pickables.push(...this.painters.pickables);

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
    this.addLabel('faena', 'Instalación de faena', 'info', root, new THREE.Vector3(SITE.faena.x, Y_FAENA + 5, SITE.faena.z));
    this.addLabel('pump', 'Bomba estacionaria', 'pump', this.pump.group, new THREE.Vector3(0, 4.2, 0));
    // sobre el pilar del lado +z y más alta que la del mixer, para que no se tapen cuando pasa un camión
    this.addLabel('gate', 'Portón de camiones', 'info', root, new THREE.Vector3(SITE.gate.x, 7.2, SITE.gate.z + 4.6));
    this.mixers.forEach((m, i) => this.addLabel(`mixer${i}`, 'Mixer 7 m³', 'mixer', m.group, new THREE.Vector3(0, 4.6, 0)));
    this.addLabel('excavator', 'Excavadora 20 t', 'info', this.excavator.group, new THREE.Vector3(0, 5.2, 0));
    this.trucks.forEach((tk, i) => this.addLabel(`truck${i}`, 'Camión tolva 14 m³', 'mixer', tk.group, new THREE.Vector3(0, 4.4, 0)));
    this.addLabel('front', 'Frente de trabajo', 'work', root, new THREE.Vector3());
    this.addLabel('balancin', 'Balancín · pintura', 'info', this.balancin.group, new THREE.Vector3());
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

    // --- grúa y carga (se desmonta 5 días después de terminada la estructura de techumbre) ---
    const cs = this.plan.at(T);
    const gy = SITE.groundY;
    this.crane.group.visible = T < this.sched.roof.gruaOut;
    this.crane.setPose(cs.slew, cs.r, cs.hookY - gy);
    this.crane.update(clock, dt);
    this.state.craneTask = cs.task;
    const hook = this.crane.hook;
    const want: THREE.Object3D | null = cs.payload === 'capacho' ? this.capacho.group : cs.payload ? this.payloads[cs.payload] : null;
    for (const p of [this.capacho.group, ...Object.values(this.payloads)]) {
      if (p !== want && p.parent === hook) hook.remove(p);
    }
    if (want && want.parent !== hook) hook.add(want);
    for (const g of this.grounded) g.obj.visible = T >= g.from && T < g.to;
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
      onGround(m.group, s.pose.x, s.pose.z, s.pose.heading);
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

    // --- excavadora y camiones tolva (fundaciones) ---
    const F = this.sched.fund;
    const ex = F.excavator(T);
    this.excavator.group.visible = ex.visible;
    this.state.excavatorTask = ex.visible ? ex.task : '';
    if (ex.visible) {
      this.excavator.group.position.set(ex.x, gy, ex.z);
      this.excavator.setPose({ heading: ex.heading, slew: ex.slew, r: ex.r, h: ex.y - gy, curl: ex.curl, load: ex.load, dist: ex.dist });
    }
    const tstates = F.truckStates(T);
    this.trucks.forEach((tk) => (tk.group.visible = false));
    for (const s of tstates) {
      const tk = this.trucks[s.id % TRUCK_POOL];
      tk.group.visible = true;
      onGround(tk.group, s.pose.x, s.pose.z, s.pose.heading);
      tk.setWheels(s.dist);
      tk.setLoad(s.load);
    }
    this.state.trucksOnSite = tstates.length;

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
    // la bomba y su caseta se arman cuando sale el último camión tolva de la excavación
    this.pump.group.visible = T >= this.sched.fund.pumpIn;
    this.pump.setPumping(ps.pumping, clock);
    const sw = this.structure.sweeps[ps.slab];
    // durante el cambio de mixer la tubería y la manguera siguen armadas, pero no sale hormigón
    let target: THREE.Vector3 | null = null, floorY = 0;
    if (ps.pour && ps.sector > 0) {
      // zapatas: la manguera recorre las franjas del sector en el orden del plan
      const p = this.sched.fund.pourPoint(ps.sector, ps.progress);
      target = new THREE.Vector3(p.x, SITE.groundY + 0.3, p.z);
      floorY = p.y;
    } else if (ps.pour && sw) {
      target = this.sweepPoint(sw, ps.progress);
      floorY = sw.y;
    }
    const tip = this.pipeline.update(ps.sector > 0 ? -1 : ps.slab, ps.pour, target);
    if (tip && target) {
      sHose.set(tip, new THREE.Vector3(target.x, floorY, target.z), ps.pumping ? 1 : 0, clock);
      this.state.focus.set(target.x, floorY, target.z);
    } else sHose.set(this.tmp, this.tmp, 0, clock);
    if (pumpHopperFeed && ps.pumping) {
      // el chorro cae desde el labio de la canaleta hasta la parrilla dentro de la tolva (0,35 m bajo
      // el punto de la tolva), así se alcanza a ver entre la canaleta y el borde
      this.pump.hopper.getWorldPosition(this.tmp2);
      this.tmp2.y -= 0.35;
      sHop.set(pumpHopperFeed, this.tmp2, 0.8, clock);
    } else sHop.set(this.tmp2, this.tmp2, 0, clock);

    // --- pintura de fachada (subcontrato con balancín) ---
    this.facade.visible = T >= this.paint.skinFrom;
    const pst = this.paint.state(T);
    this.state.paint = pst;
    this.balancin.set(pst);
    this.balancin.painters.forEach((pp, i) => {
      const action = !pst ? 'idle' : pp.onPlatform ? (pst.phase === 'bajando' ? 'paint' : 'idle') : pst.phase === 'traslado' ? 'walk' : 'work';
      this.painters.set(i, {
        x: pp.x, y: pp.y, z: pp.z, heading: pp.heading, walk: pst ? Math.abs(pst.x) + Math.abs(pst.z) : 0,
        action, t: clock + i * 0.9, vest: 1, helmet: 3, visible: !!pst,
      });
    });
    this.painters.commit();

    // --- cuadrillas ---
    const act = this.sched.at(T);
    const a = this.site.anchors;
    // en terreno: alrededor de los acopios (no encima), taller de fierro, capacho y faena
    const ground: { x: number; z: number; r?: number; spread?: number; action: 'idle' | 'walk' | 'work' | 'carry' }[] = [
      { x: a.acopioFierro.x - 4.5, z: a.acopioFierro.z + 1, r: 0.8, action: 'work' },
      { x: SITE.tallerFierro.x, z: SITE.tallerFierro.z, r: 1.6, action: 'work' },
      { x: SITE.tallerFierro.x - 2, z: SITE.tallerFierro.z + 2, r: 1.2, action: 'work' },
      { x: a.acopioMoldajeMuro.x + 6.5, z: a.acopioMoldajeMuro.z - 1.5, r: 0.8, action: 'work' },
      // rigger del capacho: junto a su punto de reposo, al otro lado del camino (fuera del paso de los
      // camiones y del mixer de la bomba)
      { x: this.capachoRest.x + 1.0, z: this.capachoRest.z + 0.4, r: 0.3, spread: 0.5, action: act.kind === 'muroHormigon' || act.kind === 'fundaciones' ? 'work' : 'idle' },
      { x: a.acopioMoldajeLosa.x - 5.5, z: a.acopioMoldajeLosa.z + 1.5, r: 0.8, action: 'work' },
      { x: SITE.faena.x + 7, z: SITE.faena.z + 5, r: 1.5, action: 'idle' },
      { x: SITE.crane.x + 4.2, z: SITE.crane.z + 3.8, r: 0.5, action: 'idle' },
    ];
    // concreteros en la bomba: el operador junto a la caseta (lado del edificio) y uno en la tolva,
    // al costado del camión. Los puestos están siempre en la lista y en el mismo lugar (en espera
    // fuera del bombeo) para que el largo no cambie y nadie salte de puesto al empezar o terminar
    {
      const P = SITE.pump, H = this.pumpHopper, mode = ps.pour ? 'work' : 'idle';
      // antes de que llegue la bomba (excavación) esperan en la faena, fuera de la huella de carguío
      if (T < this.sched.fund.pumpIn) {
        ground.push(
          { x: SITE.faena.x + 4, z: SITE.faena.z - 6, r: 0.4, action: 'idle' },
          { x: SITE.faena.x + 5.2, z: SITE.faena.z - 5.4, r: 0.4, action: 'idle' },
        );
      } else ground.push(
        // abajo, en el ensanche: el operador al lado de la caseta que da al camino y uno en la tolva,
        // entre el camión y el pie del corte
        { x: P.x + 1.6, z: P.z - 2.2, r: 0.15, spread: 0.35, action: mode },
        { x: H.x - 0.5, z: P.z + 1.55, r: 0.15, spread: 0.2, action: mode },
      );
    }
    // trabajos en paralelo en el 1er piso (redes bajo radier, hormigonado del radier): cuatro puestos
    // fijos; sin trabajo en paralelo esas personas apoyan en el taller de fierro y en la faena (las
    // cuadrillas de la techumbre van en la losa de trabajo, ver Crews)
    const par = this.sched.parallel.find((x) => (x.kind === 'instalaciones' || x.kind === 'radier') && T >= x.t0 && T <= x.t1);
    const spare = [ground[1], ground[2], ground[6], ground[7]];
    for (let i = 0; i < 4; i++) {
      if (!par) {
        ground.push(spare[i]);
        continue;
      }
      const b0 = this.structure.sweeps[0];
      const k = (T - par.t0) / (par.t1 - par.t0);
      const at = par.kind === 'radier' && ps.pour && ps.slab === 0 && target
        ? { x: target.x, z: target.z }
        : { x: b0.xmin + k * (b0.xmax - b0.xmin), z: (b0.zmin + b0.zmax) / 2 + 0.6 };
      ground.push({ x: at.x + (i - 1.5) * 1.2, z: at.z + (i % 2 ? 1 : -1), r: 0.5, action: 'work' });
    }
    this.crews.update(T, act, ground);
    this.crews.members.forEach((m, i) => this.crowd.set(i, { ...m, t: clock + i * 0.37 }));
    // vibropisón delante de cada trabajador que lo lleva
    {
      let k = 0;
      for (const m of this.crews.members) {
        if (k >= this.rammers.length) break;
        if (!m.visible || m.tool !== 'vibropison') continue;
        const r = this.rammers[k++];
        r.group.visible = true;
        r.group.position.set(m.x + Math.cos(m.heading) * 0.5, m.y, m.z + Math.sin(m.heading) * 0.5);
        r.group.rotation.y = -m.heading;
        r.pound(clock + k * 0.13);
      }
      for (; k < this.rammers.length; k++) this.rammers[k].group.visible = false;
    }
    this.crowd.commit();
    if (!ps.pour) {
      const f = this.crews.focus(act, T);
      this.state.focus.set(f.x, f.y + 1, f.z);
    }

    // etiqueta del frente de trabajo
    const front = this.labels.find((l) => l.key === 'front');
    if (front) {
      front.obj.position.copy(this.state.focus).add(new THREE.Vector3(0, 3.2, 0));
      front.obj.visible = this.labelsOn && act.kind !== 'terminaciones';
    }
    const lb = this.labels.find((l) => l.key === 'balancin');
    if (lb && pst) lb.obj.position.set(pst.x, pst.y + 3.2, pst.z);
    for (const l of this.labels) {
      if (l.key === 'crane') l.obj.visible = this.labelsOn && this.crane.group.visible;
      if (l.key === 'balancin') l.obj.visible = this.labelsOn && !!pst && pst.rigged;
      if (l.key.startsWith('mixer')) l.obj.visible = this.labelsOn && this.mixers[+l.key.slice(5)].group.visible;
      if (l.key.startsWith('truck')) l.obj.visible = this.labelsOn && this.trucks[+l.key.slice(5)].group.visible;
      if (l.key === 'excavator') l.obj.visible = this.labelsOn && this.excavator.group.visible;
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
