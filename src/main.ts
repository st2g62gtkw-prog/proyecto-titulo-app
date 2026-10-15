/**
 * Edificio E · Obra en vivo — punto de entrada.
 */
import * as THREE from 'three';
import './ui/hud.css';
import './ui/app.css';
import { SITE } from './config';
import { loadBuilding } from './data/building';
import { BUILDING_FACTS, EQUIPMENT, FLOOR_PROGRAM, PROJECT, RATIOS, SLAB_M3, TOTALS, WALL_M3 } from './data/project';
import { buildFeed, dayLabel, type FeedEvent } from './core/feed';
import { computeProgress, floorSteps } from './core/progress';
import { CREW_ROLES } from './core/crews';
import { createStage } from './scene/stage';
import { World } from './scene/world';
import { createHud, type HudState, type KPI, type Selection, type ViewMode } from './ui/hud';

const app = document.getElementById('app')!;
const stage = createStage(app);

let playing = true;
let speed = 2;
let T = 0;
let view: ViewMode = 'iso';
let world: World | null = null;
let feed: FeedEvent[] = [];
let selected: { type: string; id?: string; slot?: number } | null = null;

const hud = createHud(app, {
  onPlayPause: () => (playing = !playing),
  onSeek: (t) => {
    T = t;
  },
  onSpeed: (s) => (speed = s),
  onView: (v) => setView(v),
  onToggle: (k, on) => {
    if (!world) return;
    if (k === 'labels') world.setLabels(on);
    if (k === 'cutaway') world.setCutaway(on);
  },
  onCloseSelection: () => select(null),
});
hud.setCompass(SITE.northAngle);
hud.setLoading(0.05, 'Cargando modelo del Edificio E…');

const ISO_TARGET = new THREE.Vector3(2, 5, 6);

function setView(v: ViewMode) {
  view = v;
  hud.setView(v);
  const c = stage.controls;
  if (v === 'top') {
    c.minPolarAngle = 0;
    c.target.set(0, 0, 4);
    stage.setIsoView(90, 89.5);
    stage.camera.zoom = 1.1;
    stage.camera.updateProjectionMatrix();
  } else {
    c.minPolarAngle = THREE.MathUtils.degToRad(12);
    if (v === 'iso') {
      c.target.copy(ISO_TARGET);
      stage.setIsoView();
      stage.camera.zoom = window.innerWidth < 820 ? 0.9 : 1.15;
      stage.camera.updateProjectionMatrix();
    }
  }
}

// --- selección de objetos ---------------------------------------------------------------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downAt: { x: number; y: number; t: number } | null = null;
stage.renderer.domElement.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY, t: performance.now() }));
stage.renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || !world) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  const quick = performance.now() - downAt.t < 450;
  downAt = null;
  if (moved > 6 || !quick) return;
  const r = stage.renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, stage.camera);
  const hits = ray.intersectObjects(world.pickables, true);
  for (const h of hits) {
    if (!isVisible(h.object)) continue;
    const mesh = h.object as THREE.Mesh;
    if (mesh.userData.kind && h.faceIndex !== undefined && h.faceIndex !== null && !world.structure.isBuiltAt(mesh, h.faceIndex, T)) continue;
    let o: THREE.Object3D | null = h.object;
    while (o && !o.userData.pick) o = o.parent;
    if (o) {
      select(o.userData.pick);
      return;
    }
  }
  select(null);
});

function isVisible(o: THREE.Object3D) {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

function select(p: { type: string; id?: string; slot?: number } | null) {
  selected = p;
  if (!world) return;
  world.highlightLevel(p?.type === 'level' ? world.sched.levelNames.indexOf(p.id ?? '') : null);
  hud.showSelection(p ? describe(p) : null);
}

const fmt = (n: number, d = 0) => n.toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });

function describe(p: { type: string; id?: string; slot?: number }): Selection {
  const w = world!;
  const prog = computeProgress(w.sched, T);
  switch (p.type) {
    case 'level': {
      const name = p.id ?? '';
      const L = w.sched.levelNames.indexOf(name);
      const fp = FLOOR_PROGRAM[name];
      const fl = prog.floors[L];
      const wallM3 = WALL_M3[name];
      const slabM3 = SLAB_M3[name];
      const rows: [string, string][] = [
        ['Estado', fl.state === 'done' ? 'Obra gruesa terminada' : fl.state === 'active' ? `En ejecución · ${fmt(fl.progress * 100)} %` : 'Pendiente'],
        ['Uso', fp?.uso ?? '—'],
      ];
      if (fp?.deptos) rows.push(['Departamentos', String(fp.deptos)]);
      if (fp) rows.push(['Superficie útil / común', `${fmt(fp.util, 2)} / ${fmt(fp.comun, 2)} m²`]);
      if (wallM3) rows.push(['Hormigón muros', `${fmt(wallM3, 1)} m³ G25`], ['Acero muros (est.)', `${fmt((wallM3 * RATIOS.aceroMuroPorM3) / 1000, 1)} t`]);
      if (slabM3) rows.push([name === 'Techumbre' ? 'Losa de techumbre' : `Losa de piso ${name}`, `${fmt(slabM3, 1)} m³ · e = 16 cm`]);
      rows.push(['Losa (IFC)', `${fmt(w.b.data.levels[L].slab.area, 1)} m²`]);
      return {
        title: `Edificio E · ${name === 'Techumbre' ? 'Techumbre' : `Piso ${name.replace('P', '')}`}`,
        subtitle: PROJECT.metodo,
        badge: name,
        rows,
        note: `Edificio de ${BUILDING_FACTS.pisos} pisos y ${BUILDING_FACTS.deptos} departamentos · ${fmt(BUILDING_FACTS.supTotal, 2)} m² · altura ${fmt(BUILDING_FACTS.altura, 2)} m.`,
      };
    }
    case 'crane':
      return {
        title: 'Grúa torre',
        subtitle: EQUIPMENT.grua.modelo,
        badge: 'GRÚA',
        rows: [
          ['Tarea actual', w.state.craneTask],
          ['Pluma / contrapluma', `${SITE.crane.jibLength} m / ${SITE.crane.counterJibLength} m`],
          ['Altura de giro', `${fmt(SITE.crane.mastHeight, 1)} m`],
          ['Carga máx. / en punta', `${EQUIPMENT.grua.cargaMax} / ${EQUIPMENT.grua.cargaPunta}`],
          ['Ubicación', 'Al centro del edificio, frente al acceso poniente'],
          ['Capachos de muro', `${fmt(prog.capachos)} viajes (1 m³)`],
        ],
        note: 'Sube fierro y moldajes desde los acopios y hormigona los muros con capacho.',
      };
    case 'capacho':
      return { title: 'Capacho 1 m³', subtitle: 'Balde de hormigonado colgado de la grúa', badge: 'CAPACHO', rows: [['Viajes realizados', fmt(prog.capachos)], ['Uso', 'Hormigonado de muros y zapatas']] };
    case 'mixer':
      return {
        title: 'Camión mixer',
        subtitle: `Hormigón premezclado ${BUILDING_FACTS.hormigon}`,
        badge: 'MIXER',
        rows: [
          ['Capacidad', `${EQUIPMENT.mixerM3} m³`],
          ['Mixers en faena ahora', String(w.state.mixersOnSite)],
          ['Despachados a la fecha', fmt(prog.mixers)],
          ['Hormigón colocado', `${fmt(prog.hormigon)} m³`],
        ],
        note: 'Para muros descarga al capacho de la grúa; para losas alimenta la tolva del camión bomba.',
      };
    case 'pump':
      return {
        title: 'Camión bomba pluma',
        subtitle: EQUIPMENT.bomba.tipo,
        badge: 'BOMBA',
        rows: [['Alcance de pluma', `${EQUIPMENT.bomba.alcance} m`], ['Rendimiento', EQUIPMENT.bomba.caudal], ['Losas hormigonadas', `${prog.losas} de 7`]],
        note: 'Se usa para hormigonar las losas: la pluma recorre la losa en franjas mientras la cuadrilla vibra y platacha.',
      };
    case 'worker':
      return {
        title: 'Cuadrilla en obra',
        subtitle: 'Dotación total en faena',
        badge: `${EQUIPMENT.dotacion}`,
        rows: CREW_ROLES.map((r) => [r.label, String(r.n)] as [string, string]),
        note: 'Letrero de la faena (visita 09-10-2026): "Aquí trabajamos 85 personas".',
      };
    case 'acopio': {
      const info: Record<string, Selection> = {
        'moldaje-muro': { title: 'Acopio de moldajes de muro', subtitle: 'Paneles metálicos', badge: 'ACOPIO', rows: [['Moldaje de elevaciones (total)', `${fmt(TOTALS.moldajeElevaciones)} m²`], ['Armado a la fecha', `${fmt(prog.moldaje)} m² (muros + losas)`]] },
        'moldaje-losa': { title: 'Acopio de moldaje de losa', subtitle: 'Vigas H20 y placas fenólicas', badge: 'ACOPIO', rows: [['Moldaje de losas (total)', `${fmt(TOTALS.moldajeLosas)} m²`]] },
        fierro: { title: 'Acopio de fierro', subtitle: 'Acero A630-420H', badge: 'ACOPIO', rows: [['Enfierradura total', `${fmt(TOTALS.aceroTotal / 1000, 1)} t`], ['Instalada a la fecha', `${fmt(prog.acero / 1000, 1)} t`], ['Diámetros', 'Ø8 a Ø22 mm']] },
        puntales: { title: 'Acopio de puntales', subtitle: 'Alzaprimas metálicas', badge: 'ACOPIO', rows: [['Uso', 'Apuntalamiento de losas (2 pisos)']] },
        taller: { title: 'Taller de fierro', subtitle: 'Corte y doblado', badge: 'TALLER', rows: [['Uso', 'Corte y doblado de barras según planos E-01 a E-20']] },
      };
      return info[p.id ?? ''] ?? { title: 'Acopio', rows: [] };
    }
    case 'faena':
      return { title: 'Instalación de faena', subtitle: 'Oficinas, bodega, comedor y baños', badge: 'FAENA', rows: [['Dotación', `${EQUIPMENT.dotacion} personas`], ['Constructora', PROJECT.constructora], ['Mandante', PROJECT.mandante]] };
    default:
      return { title: p.type, rows: [] };
  }
}

// --- estado del tablero -------------------------------------------------------------------
function hudState(): HudState {
  const w = world!;
  const s = w.sched;
  const a = s.at(T);
  const prog = computeProgress(s, T);
  const kpis: KPI[] = [
    { key: 'avance', label: 'Avance obra gruesa', value: fmt(prog.obraGruesa * 100), unit: '%', progress: prog.obraGruesa },
    { key: 'hormigon', label: 'Hormigón colocado', value: fmt(prog.hormigon), unit: 'm³', sub: `de ${fmt(TOTALS.hormigonTotal)} m³`, progress: prog.hormigon / TOTALS.hormigonTotal },
    { key: 'acero', label: 'Acero instalado', value: fmt(prog.acero / 1000, 1), unit: 't', sub: `de ${fmt(TOTALS.aceroTotal / 1000, 1)} t`, progress: prog.acero / TOTALS.aceroTotal },
    { key: 'moldaje', label: 'Moldaje armado', value: fmt(prog.moldaje), unit: 'm²', sub: `de ${fmt(TOTALS.moldajeTotal)} m²`, progress: prog.moldaje / TOTALS.moldajeTotal },
    { key: 'mixers', label: 'Mixers despachados', value: fmt(prog.mixers), sub: `${w.state.mixersOnSite} en faena` },
    { key: 'capachos', label: 'Viajes de capacho', value: fmt(prog.capachos), sub: '1 m³ por viaje' },
    { key: 'losas', label: 'Losas hormigonadas', value: `${prog.losas}`, unit: '/ 7', progress: prog.losas / 7 },
    { key: 'dotacion', label: 'Trabajadores en obra', value: `${EQUIPMENT.dotacion}`, sub: 'según letrero de faena' },
  ];
  const k = Math.min(Math.max((T - a.t0) / (a.t1 - a.t0), 0), 1);
  let detail = a.detail;
  if (a.kind === 'muroHormigon' || a.kind === 'fundaciones') detail = `${w.state.craneTask} · ${w.state.mixersOnSite} mixer${w.state.mixersOnSite === 1 ? '' : 's'} en faena`;
  else if (a.kind === 'losaHormigon' || a.kind === 'radier') detail = `${a.detail} · ${fmt(k * 100)} %`;
  else if (a.kind !== 'terminaciones') detail = `${a.detail} · Grúa: ${w.state.craneTask}`;
  const lastIdx = feed.findIndex((e) => e.t > T);
  const recent = (lastIdx === -1 ? feed : feed.slice(0, lastIdx)).slice(-7).reverse();
  const lvName = s.levelNames[a.kind.startsWith('losa') ? a.level : a.level];
  return {
    time: T,
    duration: s.duration,
    playing,
    speed,
    dayLabel: dayLabel(s.dayAt(T)),
    phaseTitle: a.kind === 'terminaciones' ? 'Terminaciones' : a.kind === 'fundaciones' || a.kind === 'radier' ? 'Fundaciones' : `Piso ${(a.kind.startsWith('losa') ? a.level : a.level + 1)} · ${a.kind.startsWith('losa') ? 'Losa' : 'Muros'}`,
    activityTitle: a.title.split(' · ').pop() ?? a.title,
    activityDetail: detail,
    levelLabel: lvName === 'Techumbre' ? 'TECHO' : lvName,
    steps: a.kind === 'fundaciones' || a.kind === 'radier' || a.kind === 'terminaciones'
      ? floorSteps(s, s.activities.find((x) => x.kind === 'muroFierro' && x.level === 0)!, T)
      : floorSteps(s, a, T),
    overall: prog.obraGruesa,
    floors: prog.floors.map((f) => ({ ...f, name: f.name === 'Techumbre' ? 'Techo' : f.name })),
    kpis,
    feed: recent.map((e) => ({ t: dayLabel(s.dayAt(e.t)).replace('Día ', 'D'), text: e.text, kind: e.kind })),
    crew: CREW_ROLES.map((r) => ({ label: r.label, count: r.n })),
  };
}

// --- arranque ------------------------------------------------------------------------------
async function start() {
  const b = await loadBuilding();
  hud.setLoading(0.45, 'Generando estructura, moldajes y enfierradura…');
  await new Promise((r) => setTimeout(r, 30));
  world = new World(stage, b);
  hud.setLoading(0.85, 'Preparando la faena…');
  feed = buildFeed(world.sched, world.log);
  const markers = world.sched.activities
    .filter((a) => a.kind === 'muroFierro' || a.kind === 'fundaciones' || (a.kind === 'terminaciones' && a.level === 0))
    .map((a) => ({ t: a.t0, label: a.kind === 'fundaciones' ? 'Fund.' : a.kind === 'terminaciones' ? 'Term.' : a.levelName }));
  hud.setMarkers(markers);
  const q = new URLSearchParams(location.search);
  if (q.has('t')) T = +q.get('t')!;
  if (q.has('speed')) speed = +q.get('speed')!;
  if (q.get('play') === '0') playing = false;
  setView('iso');
  // compila shaders con todo visible una vez para evitar tirones al aparecer capas
  world.update(T, 0, 0);
  stage.renderer.compile(stage.scene, stage.camera);
  hud.setLoading(1);
  last = performance.now();
  requestAnimationFrame(loop);
}

let last = performance.now();
let clock = 0;
let hudAcc = 0;
let selAcc = 0;
function loop(now: number) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  clock += dt;
  const w = world!;
  if (playing) T = Math.min(T + dt * speed, w.sched.duration);
  if (T >= w.sched.duration && playing) playing = false;
  w.update(T, dt, clock);
  if (view === 'follow') {
    const c = stage.controls;
    const to = w.state.focus;
    const k = 1 - Math.exp(-dt * 2.5);
    const d = to.clone().sub(c.target).multiplyScalar(k);
    c.target.add(d);
    stage.camera.position.add(d);
  }
  stage.update(dt);
  stage.render();
  hudAcc += dt;
  if (hudAcc > 1 / 20) {
    hudAcc = 0;
    hud.update(hudState());
  }
  selAcc += dt;
  if (selAcc > 0.6) {
    selAcc = 0;
    if (selected && selected.type !== 'level') hud.showSelection(describe(selected));
  }
  requestAnimationFrame(loop);
}

start().catch((e) => {
  console.error(e);
  hud.setLoading(0.99, 'Error al cargar: ' + (e as Error).message);
});
