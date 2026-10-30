/**
 * Edificio E · Obra en vivo — punto de entrada.
 */
import * as THREE from 'three';
import './ui/hud.css';
import './ui/app.css';
import { PINTURA, SITE } from './config';
import { loadBuilding } from './data/building';
import { BUILDING_FACTS, EQUIPMENT, FLOOR_PROGRAM, PROJECT, RATIOS, ROOF_FACTS, ROOF_WALL_M3, SALA_LOSA_M3, SLAB_M3, TOTALS, WALL_M3 } from './data/project';
import { buildFeed, dayLabel, dayShort, type FeedEvent } from './core/feed';
import { computeProgress, floorSteps, fundSteps, roofSteps } from './core/progress';
import { CREW_ROLES } from './core/crews';
import { createStage } from './scene/stage';
import { World } from './scene/world';
import { createSite } from './scene/site';
import { createCrowd } from './scene/equipment/workers';
import { compassAngle, createHud, createTag, type HudState, type KPI, type Selection, type ViewMode } from './ui/hud';

const app = document.getElementById('app')!;
const stage = createStage(app);

let playing = true;
let speed = 1;
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
hud.setLoading(0.05, 'Cargando modelo del Edificio E…');

/** Objetivo de la vista principal: algo corrido hacia −x para que el portón (arriba a la izquierda) quede a la vista. */
const ISO_TARGET = new THREE.Vector3(-1.3, 5, 8.3);
/**
 * Vistas fijas: la principal mira desde el frente (+z, grúa y acopios adelante); la posterior
 * gira 180° para ver desde atrás el camino de mixers (abajo), el portón, la bomba y la tubería, con
 * el talud del frente y la faena al fondo.
 */
const VIEWS = {
  iso: { target: ISO_TARGET, az: 55, el: 33, zoom: 1.0 },
  back: { target: new THREE.Vector3(-14, 2, -6), az: 55 + 180, el: 33, zoom: 1.1 },
  top: { target: new THREE.Vector3(-7, 0, -2), az: 90, el: 89.5, zoom: 0.8 },
};
const MIN_POLAR = THREE.MathUtils.degToRad(12);

/**
 * Planta (en pantalla +x a la derecha y −z hacia arriba): encuadra el recorrido de los camiones
 * (la calle del portón, el camino posterior, la bomba y la subida), el edificio, los acopios y el
 * talud del frente con la faena, en el espacio libre entre las columnas del tablero. Devuelve el
 * objetivo y el zoom de la cámara.
 */
function topFit() {
  const x0 = SITE.street.x - SITE.street.width / 2 - 2, x1 = SITE.terreno.subida.x + SITE.terreno.subida.r + 4;
  // (desde el estacionamiento, detrás del camino, hasta la faena arriba del talud del frente)
  const z0 = SITE.road.z - 10, z1 = SITE.faena.z + SITE.faena.d / 2 + 2;
  const c = stage.renderer.domElement.getBoundingClientRect();
  // espacio libre: entre las columnas (escritorio) y bajo la barra superior, sobre la línea de tiempo
  let l = c.left, r = c.right;
  const el = app.querySelector('.hud');
  if (el && !el.classList.contains('is-mobile')) {
    const L = el.querySelector('.hud-left')?.getBoundingClientRect();
    const Rr = el.querySelector('.hud-right')?.getBoundingClientRect();
    if (L && L.width > 0) l = Math.max(l, L.right - 12);
    if (Rr && Rr.width > 0) r = Math.min(r, Rr.left + 12);
  }
  const w = Math.max(r - l, c.width * 0.4), h = c.height * 0.8;
  // px por metro con zoom 1 (mismo encuadre que Stage.resize: 90 m de alto, o 70 m de ancho en vertical)
  const k1 = c.width < c.height ? c.width / 70 : c.height / stage.frustum;
  const zoom = THREE.MathUtils.clamp(Math.min(w / (x1 - x0), h / (z1 - z0)) / k1, 0.45, 1.4);
  // corre el objetivo para que el recorrido quede al centro del espacio libre (no de la pantalla)
  const dx = ((l + r) / 2 - (c.left + c.right) / 2) / (k1 * zoom);
  return { target: new THREE.Vector3((x0 + x1) / 2 - dx, 0, (z0 + z1) / 2), zoom };
}

function setView(v: ViewMode, animate = true) {
  view = v;
  hud.setView(v);
  const c = stage.controls;
  if (v === 'follow') {
    c.minPolarAngle = MIN_POLAR;
    return;
  }
  const V = v === 'top' ? { ...VIEWS.top, ...topFit() } : VIEWS[v];
  // durante el giro se libera el tope de inclinación (la planta queda casi vertical)
  c.minPolarAngle = 0;
  const done = () => (c.minPolarAngle = v === 'top' ? 0 : MIN_POLAR);
  if (animate) {
    stage.orbitTo(V.target, V.az, V.el, V.zoom, v === 'top' ? 1.1 : 1.5, done);
    return;
  }
  c.target.copy(V.target);
  stage.setIsoView(V.az, V.el);
  stage.camera.zoom = V.zoom;
  stage.camera.updateProjectionMatrix();
  done();
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
      if (name === 'Techumbre') {
        rows.push(
          ['Parapetos y caja de escala', `${fmt(ROOF_WALL_M3, 1)} m³ G25`],
          ['Losa de la caja de escala', `${fmt(SALA_LOSA_M3, 2)} m³ · e = 16 cm`],
          ['Cubierta', `${fmt(ROOF_FACTS.cubierta, 2)} m² de zincalum emballetado`],
        );
      }
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
          ['Ubicación', 'Al centro del frente del edificio, opuesta al camino de mixers'],
          ['Capachos de muro', `${fmt(prog.capachos)} viajes (1 m³)`],
        ],
        note: 'Sube fierro y moldajes desde los acopios y hormigona los muros con capacho.',
      };
    case 'capacho':
      return {
        title: 'Capacho 1 m³',
        subtitle: 'Balde de hormigonado colgado de la grúa',
        badge: 'CAPACHO',
        rows: [
          ['Viajes realizados', fmt(prog.capachos)],
          ['Uso', 'Muros, emplantillado de zapatas, muros bajo NPT y V.S.C. del foso'],
          ['Llenado', 'En el camino posterior, bajo la canaleta del mixer'],
        ],
        note: 'Entre hormigonados queda en el suelo al costado del camino posterior, junto a donde se detiene el mixer; la grúa lo engancha ahí, lo entra a ras de suelo bajo la canaleta, lo pasa por sobre el edificio hasta el muro y lo devuelve al terminar.',
      };
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
        note: 'Llega por la calle, pasa el portón norponiente y entra en retroceso (la canaleta va atrás) por el único camino del costado posterior. Para muros se detiene antes de la bomba y llena el capacho que toma la grúa; para losas sigue hasta la tolva de la bomba, al final del camino. Descarga y sale de frente por el mismo camino y el mismo portón. En las losas el segundo mixer entra mientras descarga el primero y espera en el bolsón al costado del camino; cuando el primero sale y lo pasa, retrocede hasta la tolva. En el hormigonado de zapatas de cada sector (≈ 115 a 135 m³, unos 16 a 20 viajes de 7 m³) la animación muestra solo dos mixers con su cambio: cada uno representa unos 8 viajes, y el contador de despachados sube con el hormigón colocado.',
      };
    case 'pump': {
      const ps = w.log.pumpState(T);
      return {
        title: 'Bomba estacionaria de hormigón',
        subtitle: EQUIPMENT.bomba.tipo,
        badge: 'BOMBA',
        rows: [
          ['Estado', ps.pumping ? `Bombeando · ${fmt(ps.progress * 100)} %` : ps.pour ? `Detenida: cambio de mixer · ${fmt(ps.progress * 100)} %` : 'Detenida'],
          ['Ubicación', 'Costado posterior, frente opuesto a la grúa'],
          ['Tubería', 'Ø125 mm por el suelo y el shaft del ascensor'],
          ['Rendimiento', EQUIPMENT.bomba.caudal],
          ['Losas hormigonadas', `${prog.losas} de 7`],
        ],
        note: 'Llega a la obra al terminar la excavación de las fundaciones (antes su lugar es la huella de carguío de los camiones tolva) y queda fija en su caseta toda la obra, al final del camino de mixers. En las zapatas la tubería cruza las zanjas sobre caballetes de madera. Cada mixer llega en retroceso hasta la tolva y descarga con su canaleta; mientras uno sale y entra el siguiente, la bomba se detiene. La tubería entra por la puerta posterior del hall, sube por el shaft del ascensor hasta la losa y la cuadrilla reparte el hormigón con la manguera.',
      };
    }
    case 'pipe':
      return {
        title: 'Tubería de bombeo',
        subtitle: 'Acero Ø125 mm con uniones cada 3 m',
        badge: 'BOMBA',
        rows: [['Recorrido', 'Caseta (costado posterior) → puerta posterior del hall → pasillo → vestíbulo → shaft del ascensor → losa'], ['Altura máxima', '≈ 18 m (losa de techumbre)']],
        note: 'Se agrega un tramo vertical por piso antes de cada hormigonado de losa.',
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
    case 'techumbre': {
      // ficha de la techumbre: estado de cada partida y lo que se construye sobre la losa
      const R = w.sched.roof;
      const act = (kind: string) => [...w.sched.activities, ...w.sched.parallel].find((x) => x.kind === kind);
      const stateOf = (kind: string) => {
        const a = act(kind);
        if (!a) return '—';
        return T >= a.t1 ? `Terminada (${dayLabel(a.d1)})` : T >= a.t0 ? `En ejecución · ${fmt(((T - a.t0) / (a.t1 - a.t0)) * 100)} %` : `Desde ${dayLabel(a.d0)}`;
      };
      const roofFront = (['cubierta', 'aislacion', 'estructura'] as const).find((l) => T >= R[l][0] && T <= R[l][1]);
      return {
        title: 'Techumbre del Edificio E',
        subtitle: 'Lámina L41 · itemizado cap. 3 "Techumbre y hojalatería"',
        badge: 'TECHO',
        rows: [
          ['Parapetos y caja de escala', stateOf('techoHormigon')],
          ['Estructura (pino impregnado y OSB)', stateOf('estructuraTecho')],
          ['Aislación (Aislán)', stateOf('aislacionTecho')],
          ['Cubierta y hojalatería', stateOf('cubiertaTecho')],
          ['Aguas lluvia', stateOf('aguasLluvia')],
          ...(roofFront ? [['Frente de trabajo', `x = ${fmt(R.frontAt(roofFront, T), 1)} m a lo largo del edificio`] as [string, string]] : []),
          ['Cubierta', `${fmt(ROOF_FACTS.cubierta, 2)} m² · zincalum prepintado 0,5 mm emballetado · pendiente 1,5 %`],
          ['Faldones', ROOF_FACTS.faldones],
          ['Parapetos', ROOF_FACTS.parapetos],
          ['Caja de escala y sala de máquinas', ROOF_FACTS.caja],
          ['Bajadas', ROOF_FACTS.bajadas],
          ['Ventilaciones', `${R.geo.vents.filter((v) => v.kind !== 'tubo').length} shafts con sombrerete o chimenea y ${R.geo.vents.filter((v) => v.kind === 'tubo').length} ventilaciones Ø110`],
        ],
        note: 'La estructura liviana sobre la losa es el supuesto de la cubicación (pendiente 6) para la cubierta emballetada con 1,5 % de L41. La estructura parte 5 días después de la última losa; la grúa sube madera, OSB, Aislán y planchas y se desmonta 5 días después de terminada la estructura; el ascensor se monta con la sala de máquinas y la cubierta terminadas.',
      };
    }
    case 'carga': {
      const cargas: Record<string, [string, string]> = {
        'moldaje-muro': ['Paquete de paneles de moldaje', 'Paneles metálicos para muros'],
        fierro: ['Paquete de fierro', 'Barras A630-420H de 6 m'],
        'moldaje-losa': ['Paquete de moldaje de losa', 'Vigas H20 y placas fenólicas'],
        puntales: ['Paquete de puntales', 'Alzaprimas metálicas'],
        techumbre: ['Paquete de madera de techumbre', 'Pino impregnado (cerchas y costaneras) y tableros OSB'],
        cubierta: ['Pallet de cubierta', 'Planchas de zincalum emballetado y rollos de Aislán'],
      };
      const [title, subtitle] = cargas[p.id ?? ''] ?? ['Carga de grúa', ''];
      return { title, subtitle, badge: 'GRÚA', rows: [['Tarea de la grúa', w.state.craneTask]] };
    }
    case 'balancin': {
      const ps = w.state.paint;
      const plan = w.paint;
      const P = PINTURA.plataforma;
      const fase: Record<string, string> = {
        montaje: 'Montando pescantes, contrapesos y cables en la techumbre',
        bajando: 'Bajando y pintando',
        subiendo: 'Subiendo vacío con los huinches',
        traslado: 'Corriendo los pescantes al paño siguiente',
        cambio: 'Cambio de fachada: se desarma y se vuelve a armar',
        desmontaje: 'Retiro del equipo',
      };
      const rows: [string, string][] = [
        ['Tipo', `Andamio colgante (balancín) · plataforma ${fmt(P.largo, 1)} × ${fmt(P.ancho, 2)} m`],
        ['Subcontrato', 'Pintura de fachada (a su propio ritmo)'],
        ['Dotación', '2 pintores con arnés y cuerda de vida independiente'],
        ['Suspensión', '2 pescantes con contrapeso en la techumbre, 2 cables de acero y huinche en cada estribo'],
      ];
      if (ps) {
        const p = ps.next && ps.phase === 'cambio' ? ps.next : ps.pano;
        rows.push(
          ['Fachada actual', p.facade.name],
          ['Paño actual', `${p.k} de ${p.nOf} en esta fachada · ${p.i + 1} de ${plan.panos.length} en total`],
          ['Estado', ps.phase === 'bajando' ? `${fase.bajando} · ${fmt(ps.progress * 100)} % del paño${ps.lowReach && ps.pano.stopBy ? ' · tramo bajo con rodillo extensible' : ''}` : fase[ps.phase]],
        );
        if (p.stopBy) rows.push(['Pie del paño', `La plataforma se detiene a ${fmt(p.yMin - plan.groundY, 1)} m del terreno, sobre ${p.stopBy}; abajo se pinta con rodillo extensible`]);
      } else rows.push(['Estado', T < plan.mount[0] ? 'Aún no llega a la obra (parte al terminar la obra gruesa)' : 'Fachada terminada, equipo retirado']);
      rows.push(
        ['Fachada pintada', `${fmt(plan.paintedArea(T))} de ${fmt(plan.area)} m²`],
        ['Esquema', `Empaste y sellador + 2 manos de látex · ${PINTURA.rendimiento} m²/día por mano`],
        ['Período', `${dayLabel(plan.dStart)} a ${dayLabel(plan.dEnd)}`],
      );
      return {
        title: 'Balancín de pintura',
        subtitle: 'Andamio colgante · subcontrato de pintura de fachada',
        badge: 'PINTURA',
        rows,
        note: 'Parte desde arriba cuando la obra gruesa está terminada y baja por paños del ancho del balancín, una fachada a la vez; al terminar un paño sube, se corren los pescantes y baja por el siguiente. Avanza independiente de las terminaciones de cada piso (tabiques, ventanas y barandas).',
      };
    }
    case 'excavadora':
    case 'tolva': {
      const F = w.sched.fund;
      const dug = F.cells.reduce((a, c) => a + c.vol * Math.min(Math.max((T - c.dig[0]) / Math.max(c.dig[1] - c.dig[0], 1e-6), 0), 1), 0);
      const tot = F.cells.reduce((a, c) => a + c.vol, 0);
      // la geometría de las zanjas da ≈ 640 m³; la cubicación (627,31 m³) manda en las cifras
      const m3 = (dug / tot) * 627.31;
      const trips = Math.floor((m3 * 1.25) / 14);
      const ex = F.excavator(T);
      if (p.type === 'excavadora') {
        return {
          title: 'Excavadora hidráulica',
          subtitle: 'Sobre orugas, ~20 t · balde ≈ 0,9 m³',
          badge: 'EXCAV.',
          rows: [
            ['Tarea actual', ex.visible ? ex.task : 'No está en obra'],
            ['Excavado a la fecha', `${fmt(m3)} de 627 m³ en sitio`],
            ['Método', 'Zanjas desde la plataforma a −0,20; últimos 10 cm a mano'],
            ['Sellos', '−1,11 general · −1,40 núcleo · −1,58 / −1,86 / −2,61 ejes A-B'],
            ['Taludes', 'Verticales hasta 1,20 m; más hondo, 3:1 (V:H) con berma de 1 m'],
            ['En obra', `${dayLabel(w.sched.dayAt(F.excavatorOnSite[0]))} a ${dayLabel(w.sched.dayAt(F.excavatorOnSite[1]))}`],
          ],
          note: 'Abre las zanjas por sectores (S1 con la zona profunda A-B, S2 con el núcleo y el foso del ascensor, S3) desde puestos sobre el terreno aún sin excavar, y carga los camiones tolva detenidos en la huella junto a la fachada posterior. El mecánico de suelos recibe los sellos de cada sector antes del emplantillado.',
        };
      }
      const st = F.truckStates(T);
      return {
        title: 'Camión tolva',
        subtitle: '3 ejes · tolva basculante de 14 m³',
        badge: 'TOLVA',
        rows: [
          ['En faena ahora', `${st.length}${st.some((x) => x.loading) ? ' · cargando' : ''}`],
          ['Retirado a botadero', `${fmt(m3 * 1.25)} m³ esponjados (25 %)`],
          ['Viajes equivalentes', `${fmt(trips)} de ≈ 56`],
          ['Recorrido', 'Portón norponiente → camino posterior → huella de carguío'],
        ],
        note: 'Entra en retroceso por el portón y el camino posterior, igual que los mixers (el camino es uno solo), se aparta a la huella de carguío junto a la fachada posterior y la excavadora lo carga; sale de frente a botadero autorizado. El siguiente espera en el bolsón a que pase el que sale. El maicillo excavado no se reutiliza en el relleno (va integral o estabilizado).',
      };
    }
    case 'fund': {
      const F = w.sched.fund;
      const q = F.quantities(T);
      const rows: [string, string][] = [
        ['Tipo', 'Zapatas corridas de H.A. G25 (90 %) bajo los muros; aisladas en el frente'],
        ['Sección típica', 'B = 1,50–2,10 m (núcleo 2,51) × H = 0,95 m; sello −1,11, tope −0,16'],
        ['Hormigón colocado', `${fmt(Math.min(q.hormigon, 386))} de 386 m³ (incl. emplantillado G05)`],
        ['Acero instalado', `${fmt(q.acero / 1000, 1)} de 14,1 t · Ø12 A630-420H`],
        ['Moldaje armado', `${fmt(q.moldaje)} de 597 m²`],
        ['En curso', F.describe(T)],
      ];
      const notes: Record<string, string> = {
        zapatas: 'Se hormigonan en 3 sectores (juntas en x = −8,9 y x = 9,4) con la bomba estacionaria y la tubería tendida por el suelo; los muros bajo NPT de A-B, la V.S.C. del foso y sus muros van con capacho. Los "pollos" de 16 cm guían el moldaje de los muros del 1er piso.',
        fierro: 'Parrilla inferior de U transversales Ø12a20 con patas de 50 cm, barras superiores longitudinales Ø12a20 y esperas de doble malla Ø8a20 ancladas 85 cm en la zapata (barras de borde en las cabezas de muro). Recubrimiento 5 cm sobre calugas.',
        moldaje: 'Costados de terciado con costillas cada 0,6 m, tornapuntas y estacas contra la pared de la zanja y crucetas que fijan el ancho; tablas para el cuello del pollo y paneles de muro para los muros bajo NPT. Se descimbra a las 24–48 h.',
        vibropison: 'Vibropisón ("canguro") a bencina, ~60 kg: compacta el relleno lateral en capas de 25 cm hasta el 95 % del Proctor Modificado, con control de densidad por capa. Lo opera la mitad de la cuadrilla de relleno; el resto palea y riega el material de empréstito.',
        sello: 'Banderín de sello recibido: el mecánico de suelos revisó el fondo de las zanjas del sector (sello horizontal en U3, paredes verticales, limpieza) y lo dejó anotado en el libro de obra. Se retira al terminar el emplantillado.',
        excavacion: 'Zanjas de B + 2 × 0,38 m con paredes verticales (zona general, fondo −1,16) y con talud 3:1 en las zonas profundas (núcleo −1,45; eje A −1,63; escalón −1,91; A-B −2,66). Paredes de finos café rojizo (U2) y maicillo café claro (U3) en el fondo; sin napa. Tras descimbrar e impermeabilizar con Igol se rellena en capas de 25 cm compactadas al 95 % del Proctor Modificado.',
      };
      return { title: 'Fundaciones del Edificio E', subtitle: 'Planos E-01 / E-02 · rev. 3', badge: 'FUND', rows, note: notes[p.id ?? ''] ?? notes.zapatas };
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
  const roofGruesa = a.kind.startsWith('techo') || a.kind === 'salaLosa';
  let detail = a.detail;
  if (a.kind === 'fundaciones') {
    // qué pasa en cada sector, la excavadora y los camiones (o la grúa y los mixers)
    detail = s.fund.describe(T);
    if (w.state.excavatorTask) detail += ` · Excavadora: ${w.state.excavatorTask.toLowerCase()} · ${w.state.trucksOnSite} camión${w.state.trucksOnSite === 1 ? '' : 'es'} tolva en faena`;
    else if (w.state.mixersOnSite) detail += ` · Grúa: ${w.state.craneTask} · ${w.state.mixersOnSite} mixer${w.state.mixersOnSite === 1 ? '' : 's'} en faena`;
    else if (w.state.craneTask && w.state.craneTask !== 'En espera') detail += ` · Grúa: ${w.state.craneTask}`;
  } else if (a.kind === 'muroHormigon') detail = `${w.state.craneTask} · ${w.state.mixersOnSite} mixer${w.state.mixersOnSite === 1 ? '' : 's'} en faena`;
  else if (a.kind === 'losaHormigon') detail = `${a.detail} · ${fmt(k * 100)} %`;
  else if (a.kind !== 'terminaciones') detail = `${a.detail} · Grúa: ${w.state.craneTask}`;
  const par = s.parallel.filter((p) => T >= p.t0 && T <= p.t1);
  if (par.length) detail += ` · En paralelo: ${par.map((p) => p.title.toLowerCase()).join(', ')}`;
  const ps = w.state.paint;
  if (ps && a.kind === 'terminaciones') detail += ` · Pintura (subcontrato): ${ps.pano.facade.name.toLowerCase()}, paño ${ps.pano.k}/${ps.pano.nOf}`;
  const lastIdx = feed.findIndex((e) => e.t > T);
  const recent = (lastIdx === -1 ? feed : feed.slice(0, lastIdx)).slice(-5).reverse();
  // el ciclo de piso se identifica por sus muros: la losa que se hormigona es la "losa cielo" de ese piso
  const lvName = s.levelNames[a.kind.startsWith('losa') ? a.level - 1 : a.level];
  return {
    time: T,
    duration: s.duration,
    playing,
    speed,
    dayLabel: dayLabel(s.dayAt(T)),
    phaseTitle: a.kind === 'terminaciones' ? 'Terminaciones' : a.kind === 'fundaciones' || a.kind === 'radier' ? 'Fundaciones y radier' : roofGruesa ? 'Techumbre · Obra gruesa' : `Piso ${(a.kind.startsWith('losa') ? a.level : a.level + 1)} · ${a.kind.startsWith('losa') ? 'Losa' : 'Muros'}`,
    activityTitle: a.kind === 'fundaciones' ? 'Fundaciones: excavación, fierro, moldaje y hormigón' : a.kind === 'radier' ? 'Radier del 1er piso con bomba' : a.kind === 'terminaciones' ? `Fachada, ventanas y barandas ${a.levelName}` : a.title.split(' · ').pop() ?? a.title,
    activityDetail: detail,
    levelLabel: a.kind === 'fundaciones' || a.kind === 'radier' ? 'FUND' : roofGruesa || lvName === 'Techumbre' ? 'TECHO' : lvName,
    // en la obra gruesa de la techumbre y mientras se arma la cubierta, los pasos de la techumbre
    steps: a.kind === 'fundaciones'
      ? fundSteps(s, T)
      : roofGruesa || (a.kind === 'terminaciones' && T < Math.max(s.roof.cubierta[1], s.roof.aguas[1]))
        ? roofSteps(s, T)
        : a.kind === 'radier' || a.kind === 'terminaciones'
          ? floorSteps(s, s.activities.find((x) => x.kind === 'muroFierro' && x.level === 0)!, T)
          : floorSteps(s, a, T),
    overall: prog.obraGruesa,
    floors: prog.floors.map((f) => ({ ...f, name: f.name === 'Techumbre' ? 'Techo' : f.name })),
    kpis,
    feed: recent.map((e) => ({ t: dayShort(s.dayAt(e.t)), text: e.text, kind: e.kind })),
    crew: CREW_ROLES.map((r) => ({ label: r.short, count: r.n })),
  };
}

// --- arranque ------------------------------------------------------------------------------
async function start() {
  const b = await loadBuilding();
  hud.setLoading(0.45, 'Generando estructura, moldajes y enfierradura…');
  await new Promise((r) => setTimeout(r, 30));
  world = new World(stage, b, { createSite, createCrowd, createTag });
  hud.setLoading(0.85, 'Preparando la faena…');
  feed = buildFeed(world.sched, world.log, world.paint);
  const markers = world.sched.activities
    .filter((a) => a.kind === 'muroFierro' || a.kind === 'techoFierro' || a.kind === 'fundaciones' || (a.kind === 'terminaciones' && a.level === 0))
    .map((a) => ({ t: a.t0, label: a.kind === 'fundaciones' ? 'Fund.' : a.kind === 'terminaciones' ? 'Term.' : a.kind === 'techoFierro' ? 'Techo' : a.levelName }));
  hud.setMarkers(markers);
  const q = new URLSearchParams(location.search);
  if (q.has('t')) T = +q.get('t')!;
  // ?act=<id>&k=<0..1> salta a un momento de una actividad (p. ej. losaHormigon-3)
  const act = q.get('act') ? [...world.sched.activities, ...world.sched.parallel].find((a) => a.id === q.get('act')) : null;
  if (act) T = act.t0 + (act.t1 - act.t0) * +(q.get('k') ?? 0.5);
  if (q.has('speed')) speed = +q.get('speed')!;
  if (q.get('play') === '0') playing = false;
  // ?view=back abre en la vista posterior y ?view=top en planta
  const v0 = q.get('view');
  setView(v0 === 'back' || v0 === 'top' ? v0 : 'iso', false);
  // ?labels=0 oculta las etiquetas y ?cut=1 activa el corte (para revisar detalles)
  if (q.get('labels') === '0') {
    world.setLabels(false);
    hud.setToggle?.('labels', false);
  }
  if (q.get('cut') === '1') {
    world.setCutaway(true);
    hud.setToggle?.('cutaway', true);
  }
  // cámara por parámetros (?cam=x,y,z&zoom=&az=&el=), útil para revisar un detalle
  if (q.has('cam')) {
    const [cx, cy, cz] = q.get('cam')!.split(',').map(Number);
    stage.controls.target.set(cx, cy, cz);
    stage.setIsoView(+(q.get('az') ?? 55), +(q.get('el') ?? 33));
  }
  if (q.has('zoom')) {
    stage.camera.zoom = +q.get('zoom')!;
    stage.camera.updateProjectionMatrix();
  }
  // entrada: la cámara parte alejada y se acerca a la obra
  if (!q.has('cam')) {
    const finalZoom = stage.camera.zoom;
    stage.camera.zoom = finalZoom * 0.55;
    stage.camera.updateProjectionMatrix();
    stage.focus(stage.controls.target.clone(), finalZoom, 2.6);
  }
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
let frames = 0;
function loop(now: number) {
  frames++;
  // el primer cuadro puede traer una marca de tiempo anterior a `last` (tras compilar shaders)
  const dt = Math.min(Math.max((now - last) / 1000, 0), 0.1);
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
  const cam = stage.camera.position, tgt = stage.controls.target;
  hud.setCompass(compassAngle(SITE.northAngle, cam.x - tgt.x, cam.z - tgt.z));
  // mirando desde atrás (cámara del lado del cerro) se oculta el bosque que taparía el camino
  w.site.setBackView?.(cam.z - tgt.z < -40);
  // el corte quita la mitad del edificio que queda hacia la cámara
  w.setCutSide(cam.z - tgt.z < 0);
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

// acceso para pruebas automatizadas (capturas)
Object.defineProperty(window, '__obra', { value: { get frames() { return frames; }, get T() { return T; }, get world() { return world; } } });

start().catch((e) => {
  console.error(e);
  hud.setLoading(0.99, 'Error al cargar: ' + (e as Error).message);
});
