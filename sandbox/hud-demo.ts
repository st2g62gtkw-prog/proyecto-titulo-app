/**
 * Demo del tablero: /sandbox/hud.html
 * Parámetros: ?t=<0..100> tiempo fijo (en pausa) · &play=1 sigue corriendo · &speed=4 · &sel=crane|mixer|level
 *             &load=0.4 pantalla de carga fija (load=1 la omite) · &sheet=open&tab=etapa|kpi|feed · &bg=light · &view=follow
 * Un clic sobre el fondo (la "vista 3D") recorre las selecciones de ejemplo.
 */
import { createHud, createTag, type FeedItem, type HudState, type KPI, type Selection, type SheetTab, type StepInfo, type ViewMode } from '../src/ui/hud';

const q = new URLSearchParams(location.search);
if (q.get('bg') === 'light') document.body.classList.add('light');
const app = document.getElementById('app')!;
const svg = document.getElementById('standin') as unknown as SVGSVGElement;
const tagLayer = document.getElementById('tags')!;

// --- cronograma ficticio (unidades de demo): fundaciones, 7 ciclos de piso y terminaciones -----
const STEPS = [
  { key: 'muroFierro', label: 'Enfierradura de muros', d: 2.2 },
  { key: 'muroMoldaje', label: 'Moldaje de muros', d: 2.0 },
  { key: 'muroHormigon', label: 'Hormigonado con capacho', d: 1.4 },
  { key: 'muroDesmolde', label: 'Desmolde', d: 0.8 },
  { key: 'losaMoldaje', label: 'Moldaje de losa', d: 2.6 },
  { key: 'losaFierro', label: 'Enfierradura de losa', d: 2.0 },
  { key: 'losaHormigon', label: 'Hormigonado con bomba', d: 1.0 },
];
const CYCLE = STEPS.reduce((s, x) => s + x.d, 0);
const FUND = 8, FLOORS = 7, TERM = 8;
const DURATION = FUND + FLOORS * CYCLE + TERM;
const DAYS_PER_UNIT = 0.92;
const UNITS_PER_SEC = 0.25; // a velocidad ×1

// cantidades (cubicación del Edificio E, redondeadas)
const WALL_M3 = [95.5, 120.0, 119.4, 119.4, 119.4, 119.4, 119.4];
const SLAB_M3 = 105.3, FUND_M3 = 386.0, ROOF_M3 = 43.0, TOTAL_M3 = 1978.3;
const WALL_T = 10.39, SLAB_T = 11.15, FUND_T = 15.2, TOTAL_T = 166.0;
const WALL_M2 = 1199.9, SLAB_M2 = 664.7, FUND_M2 = 597.3, TOTAL_M2 = 13741.5;
const CREW = [
  { label: 'Enfierradores', count: 18 },
  { label: 'Carpinteros', count: 22 },
  { label: 'Concreteros', count: 9 },
  { label: 'Operador grúa', count: 1 },
  { label: 'Jornales', count: 20 },
  { label: 'Instalaciones', count: 9 },
  { label: 'Supervisión', count: 6 },
];

const clamp01 = (k: number) => Math.min(Math.max(k, 0), 1);
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const fmt = (n: number, d = 0) => n.toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });
const stepStart = (f: number, i: number) => FUND + f * CYCLE + STEPS.slice(0, i).reduce((s, x) => s + x.d, 0);
const stepEnd = (f: number, i: number) => stepStart(f, i) + STEPS[i].d;

function dayLabel(t: number) {
  const day = t * DAYS_PER_UNIT;
  const d = Math.floor(day);
  const mins = Math.floor((day - d) * 600);
  return `Día ${d + 1} · ${String(8 + Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/** Fase actual: fundaciones, paso del ciclo de un piso o terminaciones. */
function phaseAt(t: number) {
  if (t < FUND) return { kind: 'fund' as const, floor: 0, step: -1, k: t / FUND };
  const u = t - FUND;
  if (u < FLOORS * CYCLE) {
    const floor = Math.floor(u / CYCLE);
    let r = u - floor * CYCLE;
    for (let i = 0; i < STEPS.length; i++) {
      if (r < STEPS[i].d) return { kind: 'floor' as const, floor, step: i, k: r / STEPS[i].d };
      r -= STEPS[i].d;
    }
  }
  return { kind: 'term' as const, floor: FLOORS - 1, step: STEPS.length, k: span(t, DURATION - TERM, DURATION) };
}

function quantities(t: number) {
  let m3 = FUND_M3 * span(t, 3, FUND), cap = m3;
  let tons = FUND_T * span(t, 0.5, 5), m2 = FUND_M2 * span(t, 1, 6);
  for (let f = 0; f < FLOORS; f++) {
    const wall = WALL_M3[f] * span(t, stepStart(f, 2), stepEnd(f, 2));
    cap += wall;
    m3 += wall + SLAB_M3 * span(t, stepStart(f, 6), stepEnd(f, 6));
    tons += WALL_T * span(t, stepStart(f, 0), stepEnd(f, 0)) + SLAB_T * span(t, stepStart(f, 5), stepEnd(f, 5));
    m2 += WALL_M2 * span(t, stepStart(f, 1), stepEnd(f, 1)) + SLAB_M2 * span(t, stepStart(f, 4), stepEnd(f, 4));
  }
  m3 += ROOF_M3 * span(t, DURATION - TERM, DURATION - TERM + 3);
  return { m3, tons, m2, capachos: Math.floor(cap), mixers: Math.floor(m3 / 7) };
}

// --- bitácora: eventos fechados en orden ---------------------------------------------------------
const EVENTS: { t: number; text: string; kind: FeedItem['kind'] }[] = [];
{
  let mixer = 0;
  const ev = (t: number, text: string, kind: FeedItem['kind']) => EVENTS.push({ t, text, kind });
  const mixers = (a: number, b: number, m3: number, text: (n: number) => string) => {
    const n = Math.ceil(m3 / 7);
    for (let i = 0; i < n; i++, mixer++) if (i % 2 === 0) ev(a + ((b - a) * i) / n, text(mixer + 1), 'mixer');
  };
  ev(0.1, 'Inicio de obra gruesa: excavación y emplantillado', 'info');
  ev(0.6, 'Grúa sube enfierradura de zapatas', 'crane');
  mixers(3, FUND, FUND_M3, (n) => `Mixer N° ${n} ingresa por portón poniente · 7 m³ G25`);
  ev(FUND - 0.1, `Fundaciones hormigonadas · ${fmt(FUND_M3, 1)} m³`, 'ok');
  for (let f = 0; f < FLOORS; f++) {
    const name = `${f + 1}P`;
    ev(stepStart(f, 0) + 0.05, `Inicio: enfierradura de muros ${name}`, 'info');
    ev(stepStart(f, 0) + 0.4, `Grúa sube paquetes de fierro al ${name}`, 'crane');
    ev(stepStart(f, 1) + 0.2, `Grúa sube paneles de moldaje al ${name}`, 'crane');
    mixers(stepStart(f, 2), stepEnd(f, 2), WALL_M3[f], (n) => `Mixer N° ${n} carga el capacho · muros ${name}`);
    ev(stepEnd(f, 2) - 0.05, `Muros ${name} hormigonados · ${fmt(WALL_M3[f], 1)} m³`, 'ok');
    ev(stepStart(f, 3) + 0.1, `Desmolde de muros ${name}, paneles al acopio`, 'crane');
    ev(stepStart(f, 4) + 0.1, `Inicio: moldaje de losa sobre ${name} · puntales y vigas H20`, 'info');
    ev(stepStart(f, 5) + 0.2, 'Grúa sube mallas de fierro para la losa', 'crane');
    ev(stepStart(f, 6) - 0.3, 'Camión bomba en posición, despliega estabilizadores', 'pump');
    ev(stepStart(f, 6) + 0.05, 'Bomba inicia hormigonado de losa', 'pump');
    mixers(stepStart(f, 6) + 0.1, stepEnd(f, 6), SLAB_M3, (n) => `Mixer N° ${n} descarga en tolva de la bomba`);
    ev(stepEnd(f, 6) - 0.02, `${f === FLOORS - 1 ? 'Losa de techumbre' : `Losa de piso ${f + 2}P`} hormigonada · ${fmt(SLAB_M3, 1)} m³`, 'ok');
  }
  ev(DURATION - TERM + 0.2, 'Obra gruesa terminada · comienzan terminaciones', 'ok');
  ev(DURATION - TERM + 3, `Parapetos y sala de máquinas hormigonados · ${fmt(ROOF_M3, 1)} m³`, 'ok');
  ev(DURATION - 1, 'Desmontaje de la grúa torre', 'crane');
  EVENTS.sort((a, b) => a.t - b.t);
}

// --- estado del tablero ---------------------------------------------------------------------------
const DETAIL: ((k: number, f: number, mixers: number) => string)[] = [
  (k) => `Grúa sube paquetes de fierro · izaje ${1 + Math.floor(k * 14)} de 14`,
  (k) => `Paneles metálicos ${fmt(k * 100)} % armados · aplomado y alineación`,
  (k, f, mixers) => `Viaje ${(Math.floor(k * WALL_M3[f]) % 7) + 1} de 7 · Mixer N° ${mixers + 1} (7 m³) en descarga`,
  (k) => `Retiro de paneles, limpieza y desmoldante · ${fmt(k * 100)} %`,
  (k) => `Puntales, vigas H20 y placas fenólicas · ${fmt(k * 100)} %`,
  (k) => `Malla inferior, superior y suples · ${fmt(k * 100)} %`,
  (k) => `Camión bomba · franja ${1 + Math.floor(k * 6)} de 6 · 2 mixers en cola`,
];

function state(t: number): HudState {
  const p = phaseAt(t);
  const qn = quantities(t);
  const overall = clamp01(t / DURATION);
  const day = t * DAYS_PER_UNIT;
  const sinAccidentes = Math.floor(day) - (day >= 19 ? 19 : 0);
  const pouring = p.kind === 'floor' && (p.step === 2 || p.step === 6);
  const kpis: KPI[] = [
    { key: 'avance', label: 'Avance obra gruesa', value: fmt(overall * 100), unit: '%', progress: overall },
    { key: 'hormigon', label: 'Hormigón colocado', value: fmt(qn.m3), unit: 'm³', sub: `de ${fmt(TOTAL_M3)} m³`, progress: qn.m3 / TOTAL_M3 },
    { key: 'acero', label: 'Acero instalado', value: fmt(qn.tons, 1), unit: 't', sub: `de ${fmt(TOTAL_T, 1)} t`, progress: qn.tons / TOTAL_T },
    { key: 'moldaje', label: 'Moldaje armado', value: fmt(qn.m2), unit: 'm²', sub: `de ${fmt(TOTAL_M2)} m²`, progress: qn.m2 / TOTAL_M2 },
    { key: 'mixers', label: 'Mixers despachados', value: fmt(qn.mixers), sub: pouring ? '2 en faena ahora' : 'ninguno en faena' },
    { key: 'capachos', label: 'Viajes de capacho', value: fmt(qn.capachos), sub: '1 m³ por viaje' },
    { key: 'dotacion', label: 'Trabajadores en obra', value: '85', sub: 'según letrero de faena' },
    { key: 'accidentes', label: 'Días sin accidentes', value: fmt(sinAccidentes), sub: 'récord anterior: 15' },
  ];
  const floorCycle = (f: number) => span(t, FUND + f * CYCLE, FUND + (f + 1) * CYCLE);
  const floors = [...Array(FLOORS).keys()].map((f) => {
    const k = floorCycle(f);
    return { name: `${f + 1}P`, state: (k >= 1 ? 'done' : k > 0 ? 'active' : 'todo') as StepInfo['state'], progress: k };
  });
  const kRoof = span(t, DURATION - TERM, DURATION);
  floors.push({ name: 'Techo', state: kRoof >= 1 ? 'done' : kRoof > 0 ? 'active' : 'todo', progress: kRoof });
  const steps: StepInfo[] = STEPS.map((s, i) => {
    const st: StepInfo['state'] = p.kind === 'fund' ? 'todo' : i < p.step ? 'done' : i === p.step ? 'active' : 'todo';
    return { key: s.key, label: s.label, state: st, progress: st === 'done' ? 1 : st === 'active' ? p.k : 0 };
  });
  let phaseTitle: string, activityTitle: string, activityDetail: string, levelLabel: string;
  if (p.kind === 'fund') {
    phaseTitle = 'Fundaciones';
    activityTitle = t < 3 ? 'Excavación y enfierradura de zapatas' : 'Hormigonado de zapatas y vigas';
    activityDetail = t < 3 ? `Emplantillado y fierro de fundación · ${fmt(span(t, 0, 3) * 100)} %` : `Capacho de 1 m³ · ${fmt(qn.mixers)} mixers despachados`;
    levelLabel = 'FUND';
  } else if (p.kind === 'term') {
    phaseTitle = 'Terminaciones';
    activityTitle = 'Techumbre, parapetos y sala de máquinas';
    activityDetail = `Obra gruesa terminada · retiro de moldajes y alzaprimas · ${fmt(p.k * 100)} %`;
    levelLabel = 'TECHO';
  } else {
    phaseTitle = `Piso ${p.floor + 1} · ${p.step < 4 ? 'Muros' : 'Losa'}`;
    activityTitle = STEPS[p.step].label;
    activityDetail = DETAIL[p.step](p.k, p.floor, qn.mixers);
    levelLabel = `${p.floor + 1}P`;
  }
  let last = -1;
  while (last + 1 < EVENTS.length && EVENTS[last + 1].t <= t) last++;
  const feed = EVENTS.slice(Math.max(0, last - 6), last + 1)
    .reverse()
    .map((e) => ({ t: dayLabel(e.t).replace('Día ', 'D'), text: e.text, kind: e.kind }));
  return {
    time: t, duration: DURATION, playing, speed,
    dayLabel: dayLabel(t), phaseTitle, activityTitle, activityDetail, levelLabel,
    steps, overall, floors, kpis, feed, crew: CREW,
  };
}

// --- selecciones de ejemplo ------------------------------------------------------------------------
const SELECTIONS: Record<string, Selection> = {
  crane: {
    title: 'Grúa torre',
    subtitle: 'Grúa torre fija sobre fundación aislada',
    badge: 'GRÚA',
    rows: [
      ['Tarea actual', 'Capacho de 1 m³ a muros 3P'],
      ['Pluma / contrapluma', '50 m / 12,5 m'],
      ['Altura de giro', '31,5 m'],
      ['Carga máx. / en punta', '6,0 t / 1,3 t'],
      ['Ubicación', 'Al centro del edificio, frente al acceso poniente'],
      ['Capachos de muro', '412 viajes (1 m³)'],
    ],
    note: 'Sube fierro y moldajes desde los acopios y hormigona los muros con capacho.',
  },
  mixer: {
    title: 'Camión mixer',
    subtitle: 'Hormigón premezclado G25 (NCh 170:2016)',
    badge: 'MIXER',
    rows: [['Capacidad', '7 m³'], ['Mixers en faena ahora', '2'], ['Despachados a la fecha', '106'], ['Hormigón colocado', '742 m³']],
    note: 'Para muros descarga al capacho de la grúa; para losas alimenta la tolva del camión bomba.',
  },
  level: {
    title: 'Edificio E · Piso 3',
    subtitle: 'Hormigón armado tradicional · muros e=20 cm y losas e=16 cm',
    badge: '3P',
    rows: [
      ['Estado', 'En ejecución · 38 %'],
      ['Uso', 'Departamentos'],
      ['Departamentos', '15'],
      ['Superficie útil / común', '594,00 / 89,93 m²'],
      ['Hormigón muros', '119,4 m³ G25'],
      ['Losa de piso 4P', '105,3 m³ · e = 16 cm'],
    ],
    note: 'Edificio de 7 pisos y 93 departamentos · 4.669,33 m² · altura 17,92 m.',
  },
};
const SEL_ORDER = ['crane', 'mixer', 'level'];

// --- tablero ----------------------------------------------------------------------------------------
let playing = !q.has('t') || q.get('play') === '1';
let speed = +(q.get('speed') ?? 2);
let T = q.has('t') ? +q.get('t')! : 37.2;
let selIdx = -1;

const hud = createHud(app, {
  onPlayPause: () => (playing = !playing),
  onSeek: (t) => (T = t),
  onSpeed: (s) => (speed = s),
  onView: (v) => hud.setView(v),
  onToggle: (k, on) => {
    if (k === 'labels') tagLayer.style.display = on ? '' : 'none';
  },
  onCloseSelection: () => select(-1),
});
function select(i: number) {
  selIdx = i;
  hud.showSelection(i >= 0 ? SELECTIONS[SEL_ORDER[i]] : null);
}
hud.setMarkers([
  { t: 0, label: 'Fund.' },
  ...[...Array(FLOORS).keys()].map((f) => ({ t: FUND + f * CYCLE, label: `${f + 1}P` })),
  { t: DURATION - TERM, label: 'Term.' },
]);
hud.setCompass((3 * Math.PI) / 4);
if (q.has('view')) hud.setView(q.get('view') as ViewMode);
if (q.has('sheet')) hud.setSheet?.(q.get('sheet') === 'open', (q.get('tab') ?? 'etapa') as SheetTab);
if (q.has('sel')) select(SEL_ORDER.indexOf(q.get('sel')!));
app.addEventListener('click', (e) => {
  if (e.target === app || e.target === svg || svg.contains(e.target as Node)) select(selIdx + 1 < SEL_ORDER.length ? selIdx + 1 : -1);
});

// pantalla de carga: fija con ?load=k, o una secuencia breve
const LOAD_STEPS: [number, string, number][] = [
  [0.05, 'Cargando modelo del Edificio E…', 0],
  [0.45, 'Generando estructura, moldajes y enfierradura…', 600],
  [0.85, 'Preparando la faena…', 1200],
  [1, '', 1800],
];
if (q.has('load')) hud.setLoading(+q.get('load')!, 'Generando estructura, moldajes y enfierradura…');
else for (const [k, txt, ms] of LOAD_STEPS) setTimeout(() => hud.setLoading(k, txt || undefined), ms);

// --- vista 3D de reemplazo: obra isométrica en SVG que crece con el tiempo -------------------------------
const W = 36, D = 14, H = 2.6;
type P3 = [number, number, number];
const iso = ([x, y, z]: P3) => [(x - z) * 0.866, (x + z) * 0.5 - y] as const;
const pts = (ps: P3[]) => ps.map((p) => iso(p).map((v) => v.toFixed(2)).join(',')).join(' ');
const poly = (ps: P3[], fill: string, stroke = 'none', extra = '') => `<polygon points="${pts(ps)}" fill="${fill}" stroke="${stroke}" stroke-width="0.25" ${extra}/>`;
const line = (a: P3, b: P3, stroke: string, w = 0.35, extra = '') => {
  const [x1, y1] = iso(a), [x2, y2] = iso(b);
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}" ${extra}/>`;
};
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: [string, string, string], stroke = 'none') {
  return (
    poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], c[0], stroke) +
    poly([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], c[1], stroke) +
    poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], c[2], stroke)
  );
}
const CONCRETE: [string, string, string] = ['#b9c2cc', '#8e99a6', '#d9dfe5'];
const ANCHORS: Record<string, P3> = {};
function drawStandIn(t: number) {
  const p = phaseAt(t);
  const light = document.body.classList.contains('light');
  let s = '';
  // terreno, caminos y acopios
  s += poly([[-26, 0, -24], [62, 0, -24], [62, 0, 40], [-26, 0, 40]], light ? 'rgba(160,120,70,.25)' : 'rgba(200,167,124,.10)', light ? 'rgba(120,90,50,.35)' : 'rgba(255,255,255,.10)');
  s += poly([[40, 0, -24], [48, 0, -24], [48, 0, 40], [40, 0, 40]], light ? 'rgba(90,80,70,.25)' : 'rgba(255,255,255,.05)');
  s += box(-14, 0, 2, -6, 0.9, 9, ['#7d6a55', '#6a5946', '#9b8469']);
  s += box(-20, 0, 22, -12, 2.6, 28, ['#c9b48f', '#a8946f', '#8a8f96']);
  ANCHORS.acopio = [-10, 1, 5.5];
  ANCHORS.faena = [-16, 2.8, 25];
  // grúa (detrás del edificio)
  const cx = 18, cz = -7, top = 30;
  s += line([cx, 0, cz], [cx, top, cz], '#e8a21a', 0.9);
  s += line([cx - 12, top, cz], [cx + 40, top, cz], '#e8a21a', 0.7);
  s += line([cx, top + 3, cz], [cx + 26, top, cz], '#e8a21a', 0.25);
  s += line([cx, top + 3, cz], [cx - 12, top, cz], '#e8a21a', 0.25);
  s += box(cx - 13, top - 1.6, cz - 1, cx - 9, top, cz + 1, ['#6b7380', '#59606b', '#808896']);
  ANCHORS.crane = [cx, top + 3.5, cz];
  // pisos: terminados, en obra (crece) y pendientes (fantasma)
  const done = p.kind === 'fund' ? 0 : p.kind === 'term' ? FLOORS : p.floor;
  for (let f = 0; f < FLOORS; f++) {
    const y0 = f * H;
    if (f < done) {
      s += box(0, y0, 0, W, y0 + H, D, CONCRETE, 'rgba(60,70,80,.35)');
      for (let x = 1.6; x < W - 1; x += 3.2) s += poly([[x, y0 + 0.9, D], [x + 1.7, y0 + 0.9, D], [x + 1.7, y0 + 2.0, D], [x, y0 + 2.0, D]], '#5b6878');
      for (let z = 1.4; z < D - 1; z += 3.4) s += poly([[W, y0 + 0.9, z], [W, y0 + 0.9, z + 1.6], [W, y0 + 2.0, z + 1.6], [W, y0 + 2.0, z]], '#4c5866');
    } else if (f === done && p.kind === 'floor') {
      const wallK = p.step < 2 ? 0.25 + p.step * 0.3 : 1;
      s += box(0, y0, 0, W, y0 + H * wallK, D, ['rgba(255,176,32,.28)', 'rgba(255,150,10,.22)', 'rgba(255,200,90,.18)'], '#ffb020');
      if (p.step >= 4) s += box(0, y0 + H, 0, W * (p.step === 4 ? p.k : 1), y0 + H + 0.3, D, ['#e0574a', '#b8443a', p.step === 6 ? '#c7ccd2' : '#e8c27a']);
    } else {
      s += box(0, y0, 0, W, y0 + H, D, ['none', 'none', 'none'], light ? 'rgba(40,50,60,.18)' : 'rgba(255,255,255,.10)');
    }
  }
  const workY = (p.kind === 'floor' ? p.floor : done) * H + H;
  ANCHORS.work = [W / 2, workY + 0.5, D / 2];
  // mixer y bomba en el camino de acceso
  s += box(42, 0, 18, 46, 2.6, 26, ['#e6e9ee', '#c2c8d0', '#f4f6f8']);
  ANCHORS.mixer = [44, 3, 22];
  const pump = p.kind === 'floor' && p.step === 6;
  if (pump) {
    s += box(41, 0, -6, 46, 2.8, 6, ['#f1f1f1', '#cfd3d8', '#fafafa']);
    s += line([44, 3, 0], [30, 14, 2], '#f2f2f2', 0.6) + line([30, 14, 2], [W * p.k, H * (p.floor + 1) + 3, 7], '#f2f2f2', 0.5);
  }
  ANCHORS.pump = [44, 3.2, 0];
  svg.innerHTML = s;
  tags.pump.style.display = pump ? '' : 'none';
  placeTags();
}

const tags: Record<string, HTMLElement> = {
  crane: createTag('Grúa torre', 'crane'),
  work: createTag('Frente de trabajo', 'work'),
  mixer: createTag('Mixer 7 m³', 'mixer'),
  pump: createTag('Camión bomba', 'pump'),
  acopio: createTag('Acopio de fierro', 'acopio'),
  faena: createTag('Instalación de faena', 'info'),
};
tagLayer.append(...Object.values(tags));
function placeTags() {
  const m = svg.getScreenCTM();
  if (!m) return;
  for (const [k, el] of Object.entries(tags)) {
    const a = ANCHORS[k];
    if (!a) continue;
    const [x, y] = iso(a);
    const sp = new DOMPoint(x, y).matrixTransform(m);
    el.style.transform = `translate(-50%, -50%) translate(${sp.x.toFixed(1)}px, ${sp.y.toFixed(1)}px)`;
  }
}
function fitView() {
  const mobile = innerWidth < 820;
  svg.setAttribute('viewBox', mobile ? '-70 -44 156 124' : '-140 -62 280 140');
  placeTags();
}
addEventListener('resize', fitView);
fitView();

// --- bucle ----------------------------------------------------------------------------------------
let last = performance.now();
let drawnKey = '';
function loop(now: number) {
  const dt = Math.min(Math.max((now - last) / 1000, 0), 0.1);
  last = now;
  if (playing) T = Math.min(T + dt * speed * UNITS_PER_SEC, DURATION);
  if (T >= DURATION) playing = false;
  hud.update(state(T));
  const p = phaseAt(T);
  const key = `${p.kind}${p.floor}:${p.step}:${p.step === 4 || p.step === 6 ? Math.round(p.k * 20) : 0}`;
  if (key !== drawnKey) {
    drawnKey = key;
    drawStandIn(T);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
