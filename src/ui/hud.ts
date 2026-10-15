/**
 * Tablero (HUD) de la obra en vivo: paneles DOM sobre el lienzo 3D, sin frameworks.
 *  - Escritorio: marca, etapa actual y avance por piso a la izquierda; indicadores, dotación y
 *    bitácora a la derecha; vistas arriba a la derecha; línea de tiempo abajo al centro.
 *  - Teléfono / tablet vertical (< 820 px): barra superior compacta, riel de vistas a la derecha
 *    y hoja inferior con pestañas (Etapa · Indicadores · Bitácora) sobre la línea de tiempo.
 * update() corre cada cuadro: solo escribe en el DOM lo que cambió (referencias guardadas).
 */

export interface StepInfo { key: string; label: string; state: 'done' | 'active' | 'todo'; progress: number }
export interface KPI { key: string; label: string; value: string; unit?: string; sub?: string; progress?: number }
export interface TimelineMarker { t: number; label: string }
export interface FeedItem { t: string; text: string; kind: 'mixer' | 'crane' | 'pump' | 'info' | 'ok' }
export interface HudState {
  time: number; duration: number; playing: boolean; speed: number;
  dayLabel: string; phaseTitle: string; activityTitle: string; activityDetail: string; levelLabel: string;
  steps: StepInfo[]; overall: number;
  floors: { name: string; state: 'done' | 'active' | 'todo'; progress: number }[];
  kpis: KPI[]; feed: FeedItem[]; crew: { label: string; count: number }[];
}
export interface Selection { title: string; subtitle?: string; badge?: string; rows: [string, string][]; note?: string }
export type ViewMode = 'iso' | 'follow' | 'top';
export interface HudCallbacks {
  onPlayPause(): void;
  onSeek(t: number): void;
  onSpeed(s: number): void;
  onView(v: ViewMode): void;
  onToggle(k: 'labels' | 'cutaway', on: boolean): void;
  onCloseSelection(): void;
}
/** Pestañas de la hoja inferior (modo teléfono). */
export type SheetTab = 'etapa' | 'kpi' | 'feed';
export interface Hud {
  el: HTMLElement;
  update(s: HudState): void;
  setMarkers(m: TimelineMarker[]): void;
  showSelection(sel: Selection | null): void;
  /** k ≥ 1 oculta la pantalla de carga. */
  setLoading(k: number, text?: string): void;
  setView(v: ViewMode): void;
  setCompass(angleRad: number): void;
  /** Sincroniza un interruptor si la app lo cambia por su cuenta. */
  setToggle?(k: 'labels' | 'cutaway', on: boolean): void;
  /** Abre o cierra la hoja inferior del modo teléfono. */
  setSheet?(open: boolean, tab?: SheetTab): void;
}

type Setter<T> = (v: T) => void;
type ToggleKey = 'labels' | 'cutaway';
type TagKind = 'crane' | 'mixer' | 'pump' | 'acopio' | 'work' | 'info';

const MOBILE_QUERY = '(max-width: 819.98px), (max-height: 560px)';
const SPEEDS = [1, 2, 4, 8];
const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap';

const C = {
  amber: '#ffb020', cyan: '#3fd0ff', green: '#39d98a', violet: '#a78bfa',
  rust: '#ff8f6b', blue: '#5b8cff', pink: '#f472b6', slate: '#8fa3bf',
};
const KPI_ACCENT: Record<string, string> = {
  avance: C.amber, hormigon: C.cyan, acero: C.rust, moldaje: C.violet,
  mixers: C.cyan, capachos: C.amber, losas: C.green, dotacion: C.green, accidentes: C.green,
};
const ACCENT_CYCLE = [C.amber, C.cyan, C.green, C.violet];
const CREW_COLORS = [C.amber, C.cyan, C.green, C.violet, C.rust, C.blue, C.pink, C.slate];

// --- íconos (trazo 24×24) -------------------------------------------------------------------
const ICONS = {
  play: '<path d="M8 5.6v12.8a.9.9 0 0 0 1.4.75l9.7-6.4a.9.9 0 0 0 0-1.5L9.4 4.85A.9.9 0 0 0 8 5.6z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.5" y="5" width="4" height="14" rx="1.3" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1.3" fill="currentColor" stroke="none"/>',
  iso: '<path d="M12 3.2l7.8 4.4v8.8L12 20.8l-7.8-4.4V7.6z"/><path d="M4.2 7.6L12 12l7.8-4.4M12 12v8.8"/>',
  follow: '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  top: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M4 11h9v9M13 4v7"/>',
  tag: '<path d="M3.8 12.6V4.8a1 1 0 0 1 1-1h7.8l7.9 7.9a1.3 1.3 0 0 1 0 1.8l-7 7a1.3 1.3 0 0 1-1.8 0z"/><circle cx="8.3" cy="8.3" r="1.4"/>',
  cut: '<path d="M5 20.5V9.5L12 4l7 5.5v11M3 20.5h18"/><path d="M12 4v16.5" stroke-dasharray="2 2.4"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  check: '<path d="M5.5 12.5l4.2 4.2L18.5 7.5"/>',
  chevron: '<path d="M6.5 14.5L12 9l5.5 5.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.8v.01"/>',
  ok: '<circle cx="12" cy="12" r="8.5"/><path d="M8.3 12.2l2.5 2.5 5-5.2"/>',
  mixer: '<ellipse cx="8.8" cy="10.6" rx="5.8" ry="3.6" transform="rotate(-14 8.8 10.6)"/><path d="M3 16.4h12.4M15.4 16.4V8.8h3.4l2.4 3.4v4.2"/><circle cx="6.5" cy="17.8" r="1.6"/><circle cx="17.8" cy="17.8" r="1.6"/>',
  crane: '<path d="M7 21V5.5M4 21h6M4.5 5.5h16M7 5.5L4.5 8M7 9.5l3.2-4M17.5 5.5v6"/><path d="M16 11.5h3v2.8h-3z"/>',
  pump: '<path d="M2.5 17h12.3v-3.6H2.5zM14.8 17h5.7v-3l-2-2.4h-3.7"/><path d="M5 13.4l5-6.4 4.6 2.4 5.4-5"/><circle cx="5.6" cy="18.6" r="1.5"/><circle cx="17.5" cy="18.6" r="1.5"/>',
} as const;
type IconName = keyof typeof ICONS;

const icon = (name: IconName, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const LOGO =
  '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M9 26V11h14v15" stroke-width="2.4"/><path d="M9 16h14M9 21h14" stroke-width="1.7"/>' +
  '<path d="M5 26h22" stroke-width="2.2"/><path d="M19 11V4.5M12.5 5h14M24.5 5v3.4" stroke-width="1.5"/></svg>';

const COMPASS =
  '<svg viewBox="-20 -20 40 40" aria-hidden="true"><circle r="16.5" class="c-ring"/>' +
  '<path class="c-ticks" d="M16.5 0h-3M0 16.5v-3M-16.5 0h3"/>' +
  '<text y="-9.2" text-anchor="middle" class="c-n">N</text>' +
  '<path class="c-north" d="M0-7.5L3.1 0h-6.2z"/><path class="c-south" d="M0 7.5L3.1 0h-6.2z"/><circle r="1.5" class="c-hub"/></svg>';

/** Edificio isométrico de la pantalla de carga: 8 losas que se encienden con el avance. */
const LOADER_SLABS = Array.from({ length: 8 }, (_, i) => {
  const y = 104 - i * 12;
  return (
    `<g class="ld-s">` +
    `<polygon class="l" points="26,${y} 70,${y + 22} 70,${y + 27} 26,${y + 5}"/>` +
    `<polygon class="r" points="70,${y + 22} 114,${y} 114,${y + 5} 70,${y + 27}"/>` +
    `<polygon class="t" points="26,${y} 70,${y - 22} 114,${y} 70,${y + 22}"/></g>`
  );
}).join('');

// --- utilidades DOM ---------------------------------------------------------------------------
const clamp01 = (k: number) => (k > 0 ? (k < 1 ? k : 1) : 0);

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

/** Nodos marcados con data-r="nombre". */
function refs(root: HTMLElement): Record<string, HTMLElement> {
  const r: Record<string, HTMLElement> = {};
  root.querySelectorAll<HTMLElement>('[data-r]').forEach((e) => (r[e.dataset.r as string] = e));
  return r;
}

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Texto que solo se escribe si cambió. */
function text(el: HTMLElement): Setter<string> {
  let last: string | null = null;
  return (v) => {
    if (v !== last) {
      last = v;
      el.textContent = v;
    }
  };
}

/** Fracción 0..1 en una variable CSS (barras con transición). */
function frac(el: HTMLElement, prop = '--k'): Setter<number> {
  let last = -1;
  return (k) => {
    const q = Math.round(clamp01(k) * 1000) / 1000;
    if (q !== last) {
      last = q;
      el.style.setProperty(prop, String(q));
    }
  };
}

/** Porcentaje entero "38 %" (o el texto vacío si k es null). */
function percent(el: HTMLElement, empty = '—'): Setter<number | null> {
  let last = -2;
  return (k) => {
    const v = k === null ? -1 : Math.round(clamp01(k) * 100);
    if (v !== last) {
      last = v;
      el.textContent = v < 0 ? empty : `${v} %`;
    }
  };
}

/** Clase de estado exclusiva: is-done / is-active / is-todo… */
function stateClass(el: HTMLElement): Setter<string> {
  let last = '';
  return (s) => {
    if (s === last) return;
    if (last) el.classList.remove(`is-${last}`);
    if (s) el.classList.add(`is-${s}`);
    last = s;
  };
}

function flag(el: HTMLElement, cls: string): Setter<boolean> {
  let last: boolean | null = null;
  return (on) => {
    if (on !== last) {
      last = on;
      el.classList.toggle(cls, on);
    }
  };
}

// Números en formato es-CL ("1.978", "61,2") que cuentan hacia el nuevo valor en saltos grandes.
const NUM_ES = /^-?\d{1,3}(?:\.\d{3})*(?:,\d+)?$|^-?\d+(?:,\d+)?$/;
const parseEs = (s: string) => (NUM_ES.test(s) ? Number(s.replace(/\./g, '').replace(',', '.')) : null);
const fmtEs = (n: number, d: number) => n.toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });
const tweens = new Set<(now: number) => boolean>();
let tweenRaf = 0;
function runTweens(now: number) {
  for (const f of tweens) if (!f(now)) tweens.delete(f);
  tweenRaf = tweens.size ? requestAnimationFrame(runTweens) : 0;
}

function counter(el: HTMLElement): Setter<string> {
  let target = '';
  let shown = 0, from = 0, to = 0, dec = 0, t0 = 0;
  const step = (now: number) => {
    const k = Math.min((now - t0) / 750, 1);
    shown = from + (to - from) * (1 - Math.pow(1 - k, 3));
    el.textContent = k < 1 ? fmtEs(shown, dec) : target;
    return k < 1;
  };
  return (v) => {
    if (v === target) return;
    const n = parseEs(v);
    const prev = tweens.has(step) ? shown : target === '' ? 0 : parseEs(target);
    target = v;
    if (n === null || prev === null || Math.abs(n - prev) <= Math.max(Math.abs(n), Math.abs(prev)) * 0.02) {
      tweens.delete(step);
      el.textContent = v;
      return;
    }
    from = prev;
    to = n;
    dec = (v.split(',')[1] ?? '').length;
    t0 = performance.now();
    tweens.add(step);
    if (!tweenRaf) tweenRaf = requestAnimationFrame(runTweens);
  };
}

/** Lista de filas reutilizables: se reconstruye solo si cambian las claves. */
function keyed<T>(parent: HTMLElement, key: (x: T) => string, make: (x: T, i: number) => { el: HTMLElement; set: Setter<T> }): Setter<T[]> {
  let keys: string[] = [];
  let rows: Setter<T>[] = [];
  return (items) => {
    let same = items.length === keys.length;
    for (let i = 0; same && i < items.length; i++) same = key(items[i]) === keys[i];
    if (!same) {
      keys = items.map(key);
      const made = items.map(make);
      parent.replaceChildren(...made.map((m) => m.el));
      rows = made.map((m) => m.set);
    }
    for (let i = 0; i < items.length; i++) rows[i](items[i]);
  };
}

function ensureFonts() {
  if (document.getElementById('hud-fonts')) return;
  for (const [href, cors] of [['https://fonts.googleapis.com', false], ['https://fonts.gstatic.com', true]] as const) {
    const l = document.createElement('link');
    l.rel = 'preconnect';
    l.href = href;
    if (cors) l.crossOrigin = '';
    document.head.appendChild(l);
  }
  const l = document.createElement('link');
  l.id = 'hud-fonts';
  l.rel = 'stylesheet';
  l.href = FONTS_HREF;
  document.head.appendChild(l);
}

// --- etiqueta 3D --------------------------------------------------------------------------------
/** Píldora para CSS2DObject: punto + texto + guía fina; el centro del elemento cae en la punta de la guía. */
export function createTag(text: string, kind: TagKind = 'info'): HTMLElement {
  ensureFonts();
  const el = h('div', `tag tag--${kind}`, '<span class="tag-pill"><i class="tag-dot"></i><span class="tag-txt"></span></span><span class="tag-line"></span>');
  (el.querySelector('.tag-txt') as HTMLElement).textContent = text;
  return el;
}

// --- secciones del tablero ----------------------------------------------------------------------
function buildBrand() {
  const el = h(
    'header',
    'hud-card hud-brand',
    `<div class="hb-logo">${LOGO}</div>
    <div class="hb-txt">
      <div class="hb-title"><span class="d-only">Espacio Las Tablas · </span><em>Edificio E</em></div>
      <div class="hb-sub"><span class="d-only">Curauma, Valparaíso · Obra gruesa</span><span class="m-only">Las Tablas · Curauma</span></div>
    </div>
    <div class="hb-live">
      <span class="live" data-r="live"><i></i><b data-r="liveTxt">EN VIVO</b></span>
      <span class="hb-day mono" data-r="day">—</span>
    </div>
    <div class="lvl lvl-sm" data-r="lvl">—</div>`,
  );
  const r = refs(el);
  const day = text(r.day), lvl = text(r.lvl), liveTxt = text(r.liveTxt);
  const paused = flag(r.live, 'is-paused'), long = flag(r.lvl, 'is-long');
  return {
    el,
    update(s: HudState) {
      day(s.dayLabel);
      lvl(s.levelLabel);
      long(s.levelLabel.length > 3);
      paused(!s.playing);
      liveTxt(s.playing ? 'EN VIVO' : 'EN PAUSA');
    },
  };
}

function buildEtapa() {
  const el = h(
    'section',
    'hud-card hud-etapa',
    `<div class="card-h"><span class="ttl">Etapa actual</span><span class="card-meta mono" data-r="count"></span></div>
    <div class="et-main">
      <div class="lvl" data-r="lvl"></div>
      <div class="et-txt"><div class="et-phase" data-r="phase"></div><div class="et-act" data-r="act"></div></div>
    </div>
    <div class="et-detail" data-r="detail"></div>
    <div class="sep"></div>
    <ol class="steps" data-r="steps"></ol>`,
  );
  const r = refs(el);
  const lvl = text(r.lvl), long = flag(r.lvl, 'is-long');
  const phase = text(r.phase), act = text(r.act), detail = text(r.detail), count = text(r.count);
  const steps = keyed<StepInfo>(r.steps, (x) => x.key, (_x, i) => {
    const li = h(
      'li',
      'step',
      `<span class="step-node"><b class="mono">${i + 1}</b>${icon('check')}</span>
      <div class="step-body"><div class="step-row"><span class="step-lbl"></span><span class="step-pct mono"></span></div><div class="step-bar"><i></i></div></div>`,
    );
    const lbl = text(li.querySelector('.step-lbl') as HTMLElement);
    const pct = percent(li.querySelector('.step-pct') as HTMLElement, '');
    const st = stateClass(li), k = frac(li);
    return {
      el: li,
      set: (x) => {
        lbl(x.label);
        st(x.state);
        k(x.progress);
        pct(x.state === 'active' ? x.progress : null);
      },
    };
  });
  return {
    el,
    update(s: HudState) {
      lvl(s.levelLabel);
      long(s.levelLabel.length > 3);
      phase(s.phaseTitle);
      act(s.activityTitle);
      detail(s.activityDetail);
      steps(s.steps);
      let active = -1, done = 0;
      for (let i = 0; i < s.steps.length; i++) {
        if (s.steps[i].state === 'done') done++;
        else if (s.steps[i].state === 'active' && active < 0) active = i;
      }
      count(`Paso ${active >= 0 ? active + 1 : done} / ${s.steps.length}`);
    },
  };
}

function buildFloors() {
  const el = h(
    'section',
    'hud-card hud-floors',
    `<div class="card-h"><span class="ttl">Avance por piso</span><span class="card-meta mono" data-r="overall"></span></div>
    <div class="floors" data-r="list"></div>
    <div class="fl-ground"></div>
    <div class="fl-legend"><span class="lg-done">Terminado</span><span class="lg-active">En obra</span><span class="lg-todo">Pendiente</span></div>`,
  );
  const r = refs(el);
  const overall = percent(r.overall);
  const list = keyed<HudState['floors'][number]>(r.list, (x) => x.name, () => {
    const row = h('div', 'fl', '<span class="fl-n mono"></span><span class="fl-bar"><i></i></span><span class="fl-p mono"></span>');
    const name = text(row.querySelector('.fl-n') as HTMLElement);
    const pct = percent(row.querySelector('.fl-p') as HTMLElement);
    const st = stateClass(row), k = frac(row);
    return {
      el: row,
      set: (x) => {
        name(x.name);
        st(x.state);
        k(x.state === 'done' ? 1 : x.progress);
        pct(x.state === 'todo' && x.progress <= 0 ? null : x.state === 'done' ? 1 : x.progress);
      },
    };
  });
  return {
    el,
    update(s: HudState) {
      overall(s.overall);
      list(s.floors);
    },
  };
}

function buildKpis() {
  const el = h(
    'section',
    'hud-card hud-kpis',
    `<div class="card-h"><span class="ttl">Indicadores de obra</span><span class="card-meta">Obra gruesa</span></div><div class="kpis" data-r="grid"></div>`,
  );
  const grid = keyed<KPI>(refs(el).grid, (x) => x.key, (x, i) => {
    const acc = KPI_ACCENT[x.key] ?? ACCENT_CYCLE[i % ACCENT_CYCLE.length];
    const tile = h(
      'div',
      'kpi',
      '<div class="kpi-l"></div><div class="kpi-v"><b class="mono"></b><span class="kpi-u"></span></div><div class="kpi-s"></div><div class="kpi-bar"><i></i></div>',
    );
    tile.style.setProperty('--acc', acc);
    tile.style.setProperty('--acc-a', rgba(acc, 0.14));
    tile.title = x.label;
    const q = (s: string) => tile.querySelector(s) as HTMLElement;
    const label = text(q('.kpi-l')), value = counter(q('.kpi-v b')), unit = text(q('.kpi-u')), sub = text(q('.kpi-s'));
    const noBar = flag(tile, 'no-bar'), k = frac(tile);
    return {
      el: tile,
      set: (x) => {
        label(x.label);
        value(x.value);
        unit(x.unit ?? '');
        sub(x.sub ?? '');
        noBar(x.progress === undefined);
        if (x.progress !== undefined) k(x.progress);
      },
    };
  });
  return { el, update: (s: HudState) => grid(s.kpis) };
}

function buildCrew() {
  const el = h(
    'section',
    'hud-card hud-crew',
    `<div class="card-h"><span class="ttl">Dotación en obra</span><span class="crew-total"><b class="mono" data-r="total"></b> personas</span></div>
    <div class="crew-bar" data-r="bar"></div><ul class="crew-list" data-r="list"></ul>`,
  );
  const r = refs(el);
  const total = counter(r.total);
  let labels: string[] = [];
  let rows: { count: Setter<string>; seg: HTMLElement; n: number }[] = [];
  return {
    el,
    update(s: HudState) {
      const crew = s.crew;
      let same = crew.length === labels.length;
      for (let i = 0; same && i < crew.length; i++) same = crew[i].label === labels[i];
      if (!same) {
        labels = crew.map((c) => c.label);
        const items: HTMLElement[] = [], segs: HTMLElement[] = [];
        rows = crew.map((c, i) => {
          const color = CREW_COLORS[i % CREW_COLORS.length];
          const li = h('li', '', '<i></i><span></span><b class="mono"></b>');
          li.style.setProperty('--c', color);
          (li.querySelector('span') as HTMLElement).textContent = c.label;
          li.title = c.label;
          const seg = h('i');
          seg.style.setProperty('--c', color);
          seg.title = c.label;
          items.push(li);
          segs.push(seg);
          return { count: text(li.querySelector('b') as HTMLElement), seg, n: -1 };
        });
        r.list.replaceChildren(...items);
        r.bar.replaceChildren(...segs);
      }
      let sum = 0;
      for (let i = 0; i < crew.length; i++) {
        const row = rows[i], n = crew[i].count;
        sum += n;
        row.count(String(n));
        if (row.n !== n) {
          row.n = n;
          row.seg.style.flexGrow = String(Math.max(n, 0));
        }
      }
      total(String(sum));
    },
  };
}

function buildFeed() {
  const el = h(
    'section',
    'hud-card hud-feed',
    `<div class="card-h"><span class="ttl">Bitácora de obra</span><span class="card-meta">Últimos eventos</span></div><ul class="feed" data-r="list"></ul>`,
  );
  const list = refs(el).list;
  let cached: FeedItem[] = [];
  let byKey = new Map<string, HTMLElement>();
  const make = (it: FeedItem) => {
    const li = h('li', `fi k-${it.kind}`, `<span class="fi-ic">${icon(it.kind)}</span><div class="fi-b"><div class="fi-t"></div><div class="fi-time mono"></div></div>`);
    (li.querySelector('.fi-t') as HTMLElement).textContent = it.text;
    (li.querySelector('.fi-time') as HTMLElement).textContent = it.t;
    li.addEventListener('animationend', () => li.classList.remove('is-new'));
    return li;
  };
  return {
    el,
    update(s: HudState) {
      const items = s.feed;
      let same = items.length === cached.length;
      for (let i = 0; same && i < items.length; i++) same = items[i].t === cached[i].t && items[i].text === cached[i].text;
      if (same) return;
      const first = cached.length === 0;
      const next = new Map<string, HTMLElement>();
      const els = items.map((it) => {
        const k = `${it.t}|${it.text}`;
        let li = byKey.get(k);
        if (!li) {
          li = make(it);
          if (!first) li.classList.add('is-new');
        }
        next.set(k, li);
        return li;
      });
      list.replaceChildren(...els);
      byKey = next;
      cached = items.map((it) => ({ ...it }));
    },
  };
}

// --- tablero ----------------------------------------------------------------------------------
export function createHud(root: HTMLElement, cb: HudCallbacks): Hud {
  ensureFonts();
  const el = h('div', 'hud');
  const left = h('div', 'hud-col hud-left');
  const right = h('div', 'hud-col hud-right');
  const brand = buildBrand();
  const etapa = buildEtapa();
  const floors = buildFloors();
  const kpis = buildKpis();
  const crew = buildCrew();
  const feed = buildFeed();

  // vistas, interruptores y brújula
  const tools = h(
    'div',
    'hud-toolbar',
    `<div class="hud-glass seg" role="group" aria-label="Vista">
      <button type="button" data-v="iso" title="Vista isométrica">${icon('iso')}<span class="lbl">Vista iso</span></button>
      <button type="button" data-v="follow" title="Seguir la obra">${icon('follow')}<span class="lbl">Seguir la obra</span></button>
      <button type="button" data-v="top" title="Vista en planta">${icon('top')}<span class="lbl">Planta</span></button>
    </div>
    <div class="hud-glass seg" role="group" aria-label="Capas">
      <button type="button" class="tgl" data-k="labels" title="Etiquetas">${icon('tag')}<span class="lbl">Etiquetas</span><i class="sw"></i></button>
      <button type="button" class="tgl" data-k="cutaway" title="Corte del edificio">${icon('cut')}<span class="lbl">Corte</span><i class="sw"></i></button>
    </div>
    <div class="hud-glass compass" title="Norte"><div class="rose" data-r="rose">${COMPASS}</div></div>`,
  );
  const rose = refs(tools).rose;
  const viewBtns = [...tools.querySelectorAll<HTMLButtonElement>('[data-v]')];
  const toggleBtns = [...tools.querySelectorAll<HTMLButtonElement>('[data-k]')];
  const toggles: Record<ToggleKey, boolean> = { labels: true, cutaway: false };
  const setView = (v: ViewMode) => viewBtns.forEach((b) => b.classList.toggle('is-on', b.dataset.v === v));
  const setToggle = (k: ToggleKey, on: boolean) => {
    toggles[k] = on;
    const b = toggleBtns.find((x) => x.dataset.k === k);
    b?.classList.toggle('is-on', on);
    b?.setAttribute('aria-pressed', String(on));
  };
  viewBtns.forEach((b) =>
    b.addEventListener('click', () => {
      const v = b.dataset.v as ViewMode;
      setView(v);
      cb.onView(v);
    }),
  );
  toggleBtns.forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.k as ToggleKey;
      setToggle(k, !toggles[k]);
      cb.onToggle(k, toggles[k]);
    }),
  );
  setView('iso');
  setToggle('labels', true);
  setToggle('cutaway', false);

  // línea de tiempo
  const transport = h(
    'div',
    'hud-glass hud-transport',
    `<button type="button" class="tp-play" data-r="play" aria-label="Reproducir o pausar (espacio)" title="Reproducir / pausar (espacio)">${icon('play', 'i-play')}${icon('pause', 'i-pause')}</button>
    <div class="tp-main">
      <div class="tp-row">
        <span class="tp-day mono" data-r="day">—</span>
        <span class="tp-ov"><span class="w">Avance</span> <b class="mono" data-r="ov">0</b><span class="pc">%</span></span>
        <div class="tp-speeds" data-r="speeds">${SPEEDS.map((s) => `<button type="button" class="mono" data-s="${s}" title="Velocidad ×${s}">×${s}</button>`).join('')}</div>
      </div>
      <div class="scrub" data-r="scrub" role="slider" tabindex="0" aria-label="Línea de tiempo de la obra" aria-valuemin="0" aria-valuemax="100">
        <div class="scrub-track"><div class="scrub-fill"></div></div>
        <div class="scrub-marks" data-r="marks"></div>
        <div class="scrub-handle"><span class="scrub-tip mono" data-r="tip"></span></div>
      </div>
    </div>`,
  );
  const tr = refs(transport);
  const trDay = text(tr.day), trTip = text(tr.tip), trOv = counter(tr.ov), trK = frac(tr.scrub);
  const playingFlag = flag(transport, 'is-playing');
  const speedBtns = [...tr.speeds.querySelectorAll<HTMLButtonElement>('button')];
  let playing = false, speed = 0, duration = 1, dragging = false;
  let markers: { t: number; el: HTMLElement }[] = [];
  let curMarker = -2;
  let ariaPct = -1;
  const setPlaying = (p: boolean) => {
    playing = p;
    playingFlag(p);
  };
  const setSpeed = (s: number) => {
    if (s === speed) return;
    speed = s;
    speedBtns.forEach((b) => b.classList.toggle('is-on', +(b.dataset.s ?? 0) === s));
  };
  // las marcas se ubican como fracción de la duración (puede llegar después que setMarkers)
  const placeMarkers = () => markers.forEach((m) => (m.el.style.left = `${(clamp01(m.t / duration) * 100).toFixed(3)}%`));
  const setTimeK = (k: number) => {
    trK(k);
    const p = Math.round(clamp01(k) * 100);
    if (p !== ariaPct) {
      ariaPct = p;
      tr.scrub.setAttribute('aria-valuenow', String(p));
    }
  };
  tr.play.addEventListener('click', () => {
    setPlaying(!playing);
    cb.onPlayPause();
  });
  speedBtns.forEach((b) =>
    b.addEventListener('click', () => {
      const s = +(b.dataset.s ?? 1);
      setSpeed(s);
      cb.onSpeed(s);
    }),
  );
  const seekAt = (x: number) => {
    const r = tr.scrub.getBoundingClientRect();
    const k = clamp01((x - r.left) / Math.max(r.width, 1));
    setTimeK(k);
    cb.onSeek(k * duration);
  };
  tr.scrub.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    tr.scrub.setPointerCapture(e.pointerId);
    el.classList.add('is-scrubbing');
    seekAt(e.clientX);
  });
  tr.scrub.addEventListener('pointermove', (e) => dragging && seekAt(e.clientX));
  const endDrag = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (tr.scrub.hasPointerCapture(e.pointerId)) tr.scrub.releasePointerCapture(e.pointerId);
    el.classList.remove('is-scrubbing');
  };
  tr.scrub.addEventListener('pointerup', endDrag);
  tr.scrub.addEventListener('pointercancel', endDrag);
  tr.scrub.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const k = clamp01(ariaPct / 100 + (e.key === 'ArrowRight' ? 0.01 : -0.01));
    setTimeK(k);
    cb.onSeek(k * duration);
  });

  // panel de selección
  const sel = h(
    'aside',
    'hud-glass hud-sel',
    `<div class="sel-grab"></div>
    <div class="sel-h"><span class="sel-kick">Selección</span><span class="sel-badge mono" data-r="badge"></span>
      <button type="button" class="icon-btn sel-x" data-r="close" aria-label="Cerrar" title="Cerrar (Esc)">${icon('close')}</button></div>
    <div class="sel-title" data-r="title"></div>
    <div class="sel-sub" data-r="sub"></div>
    <div class="sel-rows" data-r="rows"></div>
    <div class="sel-note" data-r="note">${icon('info')}<span data-r="noteTxt"></span></div>`,
  );
  sel.setAttribute('aria-label', 'Detalle del elemento seleccionado');
  const sr = refs(sel);
  const selTitle = text(sr.title), selSub = text(sr.sub), selBadge = text(sr.badge), selNote = text(sr.noteTxt);
  const selOpen = flag(el, 'sel-open');
  let selIsOpen = false;
  let rowsSig = '';
  sr.close.addEventListener('click', () => {
    showSelection(null);
    cb.onCloseSelection();
  });
  function showSelection(s: Selection | null) {
    selIsOpen = !!s;
    selOpen(selIsOpen);
    if (!s) return;
    selTitle(s.title);
    selSub(s.subtitle ?? '');
    sr.sub.hidden = !s.subtitle;
    selBadge(s.badge ?? '');
    sr.badge.hidden = !s.badge;
    selNote(s.note ?? '');
    sr.note.hidden = !s.note;
    const sig = s.rows.map((r) => `${r[0]}\u0001${r[1]}`).join('\u0002');
    if (sig !== rowsSig) {
      rowsSig = sig;
      sr.rows.replaceChildren(
        ...s.rows.map(([k, v]) => {
          const row = h('div', 'sel-row', '<span class="k"></span><span class="v"></span>');
          (row.firstChild as HTMLElement).textContent = k;
          (row.lastChild as HTMLElement).textContent = v;
          return row;
        }),
      );
    }
  }

  // hoja inferior (teléfono)
  const sheet = h(
    'section',
    'hud-glass hud-sheet',
    `<div class="sheet-h" data-r="head">
      <span class="grab"></span>
      <div class="tabs" role="tablist">
        <button type="button" role="tab" data-tab="etapa">Etapa</button>
        <button type="button" role="tab" data-tab="kpi">Indicadores</button>
        <button type="button" role="tab" data-tab="feed">Bitácora</button>
      </div>
      <button type="button" class="icon-btn sheet-tg" data-r="toggle" aria-label="Mostrar u ocultar panel">${icon('chevron')}</button>
    </div>
    <div class="sheet-now" data-r="now">
      <div class="sn-txt"><span class="sn-phase" data-r="phase"></span><b data-r="act"></b></div>
      <span class="sn-pct mono" data-r="pct"></span>
      <span class="sn-bar"><i></i></span>
    </div>
    <div class="sheet-body" data-r="body">
      <div class="pane" data-pane="etapa"></div><div class="pane" data-pane="kpi"></div><div class="pane" data-pane="feed"></div>
    </div>`,
  );
  const sh = refs(sheet);
  const panes = Object.fromEntries([...sheet.querySelectorAll<HTMLElement>('[data-pane]')].map((p) => [p.dataset.pane, p])) as Record<SheetTab, HTMLElement>;
  const tabBtns = [...sheet.querySelectorAll<HTMLButtonElement>('[data-tab]')];
  const snPhase = text(sh.phase), snAct = text(sh.act), snPct = percent(sh.pct, ''), snK = frac(sh.now);
  let sheetOpen = false;
  let sheetTab: SheetTab = 'etapa';
  const sheetOpenFlag = flag(sheet, 'is-open'), rootSheetFlag = flag(el, 'sheet-open');
  function setSheet(open: boolean, tab: SheetTab = sheetTab) {
    sheetOpen = open;
    sheetTab = tab;
    sheetOpenFlag(open);
    rootSheetFlag(open);
    tabBtns.forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
    });
    (Object.keys(panes) as SheetTab[]).forEach((k) => panes[k].classList.toggle('is-on', k === tab));
  }
  let dragY: number | null = null;
  let swallowClick = false;
  sh.head.addEventListener('pointerdown', (e) => (dragY = e.clientY));
  sh.head.addEventListener('pointerup', (e) => {
    if (dragY === null) return;
    const dy = e.clientY - dragY;
    dragY = null;
    if (Math.abs(dy) > 24) {
      swallowClick = true;
      setSheet(dy < 0);
    }
  });
  sh.head.addEventListener(
    'click',
    (e) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
    },
    true,
  );
  tabBtns.forEach((b) =>
    b.addEventListener('click', () => {
      const tab = b.dataset.tab as SheetTab;
      setSheet(!(sheetOpen && tab === sheetTab), tab);
    }),
  );
  sh.toggle.addEventListener('click', () => setSheet(!sheetOpen));
  sh.now.addEventListener('click', () => setSheet(true, 'etapa'));
  setSheet(false, 'etapa');

  // pantalla de carga
  const loading = h(
    'div',
    'hud-loading',
    `<div class="ld-box">
      <svg class="ld-iso" viewBox="0 -8 140 146" aria-hidden="true"><path class="ld-axis" d="M26 9v100M70 31v100M114 9v100"/>${LOADER_SLABS}</svg>
      <div class="ld-k">Simulación de obra gruesa</div>
      <div class="ld-title">Edificio E</div>
      <div class="ld-sub">Condominio Espacio Las Tablas · Curauma, Valparaíso</div>
      <div class="ld-bar" data-r="bar"><i></i></div>
      <div class="ld-row"><span data-r="txt">Preparando la obra…</span><span class="mono" data-r="pct">0&nbsp;%</span></div>
    </div>`,
  );
  const lr = refs(loading);
  const ldTxt = text(lr.txt), ldPct = percent(lr.pct), ldK = frac(lr.bar);
  const slabs = [...loading.querySelectorAll<SVGGElement>('.ld-s')];
  let ldTimer = 0;

  // armado y cambio de distribución escritorio ↔ teléfono
  const bottom = h('div', 'hud-bottom');
  bottom.append(sheet, transport);
  el.append(left, right, tools, bottom, sel, loading);
  root.appendChild(el);

  const mq = matchMedia(MOBILE_QUERY);
  const layout = () => {
    const mobile = mq.matches;
    el.classList.toggle('is-mobile', mobile);
    if (mobile) {
      el.prepend(brand.el);
      panes.etapa.append(etapa.el, floors.el);
      panes.kpi.append(kpis.el, crew.el);
      panes.feed.append(feed.el);
    } else {
      left.append(brand.el, etapa.el, floors.el);
      right.append(kpis.el, crew.el, feed.el);
    }
  };
  mq.addEventListener('change', layout);
  layout();

  // teclado: espacio = reproducir/pausar, Esc = cerrar selección
  const editable = (t: EventTarget | null) =>
    t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  window.addEventListener('keydown', (e) => {
    if (editable(e.target)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) {
        setPlaying(!playing);
        cb.onPlayPause();
      }
    } else if (e.key === 'Escape' && selIsOpen) {
      showSelection(null);
      cb.onCloseSelection();
    }
  });
  // evita que el espacio "pulse" además el botón enfocado
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && !editable(e.target)) e.preventDefault();
  });

  return {
    el,
    update(s) {
      if (s.duration > 0 && s.duration !== duration) {
        duration = s.duration;
        placeMarkers();
      }
      setPlaying(s.playing);
      setSpeed(s.speed);
      trDay(s.dayLabel);
      trTip(s.dayLabel);
      trOv(String(Math.round(clamp01(s.overall) * 100)));
      if (!dragging) setTimeK(s.time / duration);
      let cur = -1;
      for (let i = 0; i < markers.length && markers[i].t <= s.time; i++) cur = i;
      if (cur !== curMarker) {
        curMarker = cur;
        markers.forEach((m, i) => {
          m.el.classList.toggle('is-past', i < cur);
          m.el.classList.toggle('is-cur', i === cur);
        });
      }
      brand.update(s);
      etapa.update(s);
      floors.update(s);
      kpis.update(s);
      crew.update(s);
      feed.update(s);
      const active = s.steps.find((x) => x.state === 'active');
      snPhase(s.phaseTitle);
      snAct(s.activityTitle);
      snPct(active ? active.progress : null);
      snK(active ? active.progress : 0);
    },
    setMarkers(m) {
      markers = [...m]
        .sort((a, b) => a.t - b.t)
        .map((mk) => {
          const e = h('span', 'mk', '<i></i><em></em>');
          (e.lastChild as HTMLElement).textContent = mk.label;
          return { t: mk.t, el: e };
        });
      tr.marks.replaceChildren(...markers.map((x) => x.el));
      placeMarkers();
      curMarker = -2;
    },
    showSelection,
    setLoading(k, txt) {
      clearTimeout(ldTimer);
      if (txt) ldTxt(txt);
      ldK(k);
      ldPct(k);
      const lit = Math.round(clamp01(k) * slabs.length);
      slabs.forEach((g, i) => {
        g.classList.toggle('on', i < lit);
        g.classList.toggle('next', i === lit);
      });
      if (k >= 1) {
        loading.classList.add('is-done');
        ldTimer = window.setTimeout(() => (loading.hidden = true), 900);
      } else {
        loading.hidden = false;
        loading.classList.remove('is-done');
      }
    },
    setView,
    setCompass(a) {
      rose.style.transform = `rotate(${a.toFixed(4)}rad)`;
    },
    setToggle,
    setSheet,
  };
}
