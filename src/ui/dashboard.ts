/**
 * Tablero de la obra (HUD): paneles de vidrio oscuro sobre la vista 3D.
 * Se actualiza cada cuadro tocando solo los nodos cuyo valor cambió.
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
  onPlayPause(): void; onSeek(t: number): void; onSpeed(s: number): void; onView(v: ViewMode): void;
  onToggle(k: 'labels' | 'cutaway', on: boolean): void; onCloseSelection(): void;
}
export interface Hud {
  el: HTMLElement;
  update(s: HudState): void;
  setMarkers(m: TimelineMarker[]): void;
  showSelection(sel: Selection | null): void;
  setLoading(k: number, text?: string): void;
  setView(v: ViewMode): void;
  setCompass(angleRad: number): void;
}

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>',
  iso: '<svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z M12 12l8-4.5 M12 12v9 M12 12L4 7.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  follow: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  top: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 11h9v9M13 4v7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  tag: '<svg viewBox="0 0 24 24"><path d="M4 5h10l6 7-6 7H4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  cut: '<svg viewBox="0 0 24 24"><path d="M4 20L20 4" stroke="currentColor" stroke-width="1.8"/><rect x="4" y="8" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.5 2"/></svg>',
  chevron: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

const FEED_ICON: Record<FeedItem['kind'], string> = { mixer: 'M', crane: 'G', pump: 'B', info: '•', ok: '✓' };

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/** Fija texto solo si cambió. */
function setText(el: HTMLElement, v: string) {
  if (el.textContent !== v) el.textContent = v;
}
function setWidth(el: HTMLElement, k: number) {
  const v = `${(Math.max(0, Math.min(1, k)) * 100).toFixed(1)}%`;
  if (el.style.width !== v) el.style.width = v;
}
function setAttr(el: HTMLElement, name: string, v: string) {
  if (el.getAttribute(name) !== v) el.setAttribute(name, v);
}

function ensureFonts() {
  if (document.getElementById('hud-fonts')) return;
  const pre = h('link');
  pre.rel = 'preconnect';
  pre.href = 'https://fonts.gstatic.com';
  pre.crossOrigin = '';
  const l = h('link');
  l.id = 'hud-fonts';
  l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap';
  document.head.append(pre, l);
}

export function createHud(root: HTMLElement, cb: HudCallbacks): Hud {
  ensureFonts();
  const el = h('div', 'hud');
  root.appendChild(el);

  // ---------- marca ----------
  const brand = h('section', 'panel brand');
  brand.innerHTML = `
    <div class="brand__mark"><svg viewBox="0 0 32 32"><path d="M9 26V8h14v18" fill="none" stroke="currentColor" stroke-width="3"/><path d="M9 14h14M9 20h14" stroke="currentColor" stroke-width="2"/></svg></div>
    <div class="brand__txt">
      <div class="brand__title">Espacio Las Tablas <span>· Edificio E</span></div>
      <div class="brand__sub">Curauma, Valparaíso · Obra gruesa en H.A.</div>
    </div>
    <div class="brand__live"><i></i><span class="brand__day mono"></span></div>`;
  const dayEl = brand.querySelector<HTMLElement>('.brand__day')!;

  // ---------- etapa actual ----------
  const stage = h('section', 'panel stage');
  stage.innerHTML = `
    <div class="sect">Etapa actual</div>
    <div class="stage__head">
      <div class="badge-lvl mono"></div>
      <div class="stage__titles">
        <div class="stage__phase"></div>
        <div class="stage__act"></div>
      </div>
    </div>
    <div class="stage__detail"></div>
    <ol class="steps"></ol>`;
  const lvlEl = stage.querySelector<HTMLElement>('.badge-lvl')!;
  const phaseEl = stage.querySelector<HTMLElement>('.stage__phase')!;
  const actEl = stage.querySelector<HTMLElement>('.stage__act')!;
  const detailEl = stage.querySelector<HTMLElement>('.stage__detail')!;
  const stepsEl = stage.querySelector<HTMLElement>('.steps')!;
  let stepNodes: { li: HTMLElement; label: HTMLElement; bar: HTMLElement; pct: HTMLElement }[] = [];

  // ---------- pisos ----------
  const floorsP = h('section', 'panel floors');
  floorsP.innerHTML = `<div class="sect">Edificio E · avance por piso</div><div class="floors__stack"></div>`;
  const stackEl = floorsP.querySelector<HTMLElement>('.floors__stack')!;
  let floorNodes: { row: HTMLElement; fill: HTMLElement; pct: HTMLElement }[] = [];

  const left = h('div', 'col col--left');
  left.append(stage, floorsP);

  // ---------- indicadores ----------
  const kpiP = h('section', 'panel kpis');
  kpiP.innerHTML = `<div class="sect">Indicadores de obra</div><div class="kpis__grid"></div>`;
  const kpiGrid = kpiP.querySelector<HTMLElement>('.kpis__grid')!;
  const kpiNodes = new Map<string, { value: HTMLElement; unit: HTMLElement; sub: HTMLElement; bar: HTMLElement | null }>();

  const crewP = h('section', 'panel crew');
  crewP.innerHTML = `<div class="sect">Dotación en obra <span class="crew__total mono"></span></div><ul class="crew__list"></ul>`;
  const crewList = crewP.querySelector<HTMLElement>('.crew__list')!;
  const crewTotal = crewP.querySelector<HTMLElement>('.crew__total')!;
  let crewKey = '';

  const feedP = h('section', 'panel feed');
  feedP.innerHTML = `<div class="sect">Bitácora</div><ul class="feed__list"></ul>`;
  const feedList = feedP.querySelector<HTMLElement>('.feed__list')!;
  let feedKey = '';

  const right = h('div', 'col col--right');
  right.append(kpiP, crewP, feedP);

  // ---------- selección ----------
  const sel = h('section', 'panel selection');
  sel.innerHTML = `
    <button class="icon-btn selection__close" aria-label="Cerrar">${ICON.close}</button>
    <div class="selection__badge mono"></div>
    <div class="selection__title"></div>
    <div class="selection__sub"></div>
    <dl class="selection__rows"></dl>
    <p class="selection__note"></p>`;
  sel.querySelector('.selection__close')!.addEventListener('click', () => cb.onCloseSelection());
  right.appendChild(sel);

  // ---------- vista ----------
  const views = h('div', 'panel views');
  const viewBtns: Record<ViewMode, HTMLButtonElement> = {} as Record<ViewMode, HTMLButtonElement>;
  const mkView = (v: ViewMode, label: string, icon: string) => {
    const b = h('button', 'view-btn', `${icon}<span>${label}</span>`) as HTMLButtonElement;
    b.addEventListener('click', () => cb.onView(v));
    viewBtns[v] = b;
    views.appendChild(b);
  };
  mkView('iso', 'Vista iso', ICON.iso);
  mkView('follow', 'Seguir la obra', ICON.follow);
  mkView('top', 'Planta', ICON.top);
  views.appendChild(h('span', 'views__sep'));
  const toggles: Record<'labels' | 'cutaway', boolean> = { labels: true, cutaway: false };
  const mkToggle = (k: 'labels' | 'cutaway', label: string, icon: string) => {
    const b = h('button', 'view-btn toggle', `${icon}<span>${label}</span>`) as HTMLButtonElement;
    b.classList.toggle('on', toggles[k]);
    b.addEventListener('click', () => {
      toggles[k] = !toggles[k];
      b.classList.toggle('on', toggles[k]);
      cb.onToggle(k, toggles[k]);
    });
    views.appendChild(b);
  };
  mkToggle('labels', 'Etiquetas', ICON.tag);
  mkToggle('cutaway', 'Corte', ICON.cut);
  const compass = h('div', 'compass', '<div class="compass__rose"><b>N</b><i></i></div>');
  views.appendChild(compass);
  const rose = compass.querySelector<HTMLElement>('.compass__rose')!;

  // ---------- transporte ----------
  const tr = h('section', 'panel transport');
  tr.innerHTML = `
    <button class="play" aria-label="Reproducir/pausar">${ICON.pause}</button>
    <div class="speeds"></div>
    <div class="scrub">
      <div class="scrub__labels"></div>
      <div class="scrub__track"><div class="scrub__fill"></div><div class="scrub__marks"></div><div class="scrub__handle"></div></div>
    </div>
    <div class="tr__info"><div class="tr__day mono"></div><div class="tr__pct"><span class="mono"></span> obra gruesa</div></div>`;
  const playBtn = tr.querySelector<HTMLButtonElement>('.play')!;
  playBtn.addEventListener('click', () => cb.onPlayPause());
  const speedsEl = tr.querySelector<HTMLElement>('.speeds')!;
  const speedBtns = new Map<number, HTMLButtonElement>();
  for (const s of [1, 2, 4, 8]) {
    const b = h('button', 'chip mono', `×${s}`) as HTMLButtonElement;
    b.addEventListener('click', () => cb.onSpeed(s));
    speedsEl.appendChild(b);
    speedBtns.set(s, b);
  }
  const track = tr.querySelector<HTMLElement>('.scrub__track')!;
  const fill = tr.querySelector<HTMLElement>('.scrub__fill')!;
  const handle = tr.querySelector<HTMLElement>('.scrub__handle')!;
  const marksEl = tr.querySelector<HTMLElement>('.scrub__marks')!;
  const labelsEl = tr.querySelector<HTMLElement>('.scrub__labels')!;
  const trDay = tr.querySelector<HTMLElement>('.tr__day')!;
  const trPct = tr.querySelector<HTMLElement>('.tr__pct span')!;
  let duration = 1;
  let markers: TimelineMarker[] = [];
  let markersDur = 0;
  let dragging = false;
  const placeMarkers = () => {
    marksEl.innerHTML = '';
    labelsEl.innerHTML = '';
    for (const mk of markers) {
      const x = `${((mk.t / Math.max(duration, 1e-6)) * 100).toFixed(2)}%`;
      const tick = h('i');
      tick.style.left = x;
      marksEl.appendChild(tick);
      const lab = h('span', 'mono', mk.label);
      lab.style.left = x;
      labelsEl.appendChild(lab);
    }
    markersDur = duration;
  };
  const seekFrom = (e: PointerEvent) => {
    const r = track.getBoundingClientRect();
    const k = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
    cb.onSeek(k * duration);
  };
  track.addEventListener('pointerdown', (e) => {
    dragging = true;
    track.setPointerCapture(e.pointerId);
    tr.classList.add('dragging');
    seekFrom(e);
  });
  track.addEventListener('pointermove', (e) => dragging && seekFrom(e));
  const endDrag = () => {
    dragging = false;
    tr.classList.remove('dragging');
  };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);

  // ---------- móvil: barra superior y hoja inferior con pestañas ----------
  const mTop = h('section', 'panel mtop');
  mTop.innerHTML = `
    <div class="brand__mark sm"><svg viewBox="0 0 32 32"><path d="M9 26V8h14v18" fill="none" stroke="currentColor" stroke-width="3"/><path d="M9 14h14M9 20h14" stroke="currentColor" stroke-width="2"/></svg></div>
    <div class="mtop__txt"><div class="mtop__title">Edificio E <span>· Las Tablas</span></div><div class="mtop__act"></div></div>
    <div class="badge-lvl sm mono"></div>`;
  const mAct = mTop.querySelector<HTMLElement>('.mtop__act')!;
  const mLvl = mTop.querySelector<HTMLElement>('.badge-lvl')!;
  const sheet = h('section', 'panel sheet collapsed');
  sheet.innerHTML = `
    <div class="sheet__bar"><button class="sheet__grip" aria-label="Expandir">${ICON.chevron}</button>
      <div class="tabs"><button data-tab="stage" class="on">Etapa</button><button data-tab="kpis">Indicadores</button><button data-tab="feed">Bitácora</button></div></div>
    <div class="sheet__body"></div>`;
  const sheetBody = sheet.querySelector<HTMLElement>('.sheet__body')!;
  sheet.querySelector('.sheet__grip')!.addEventListener('click', () => sheet.classList.toggle('collapsed'));
  const tabs = sheet.querySelectorAll<HTMLButtonElement>('.tabs button');
  let tab = 'stage';
  const mobile = matchMedia('(max-width: 820px)');
  tabs.forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab!;
    tabs.forEach((x) => x.classList.toggle('on', x === b));
    sheet.classList.remove('collapsed');
    placePanels();
  }));

  /** En móvil los paneles viven dentro de la hoja inferior; en escritorio, en sus columnas. */
  function placePanels() {
    if (mobile.matches) {
      const want = tab === 'stage' ? [stage, floorsP] : tab === 'kpis' ? [kpiP, crewP] : [feedP];
      for (const p of [stage, floorsP, kpiP, crewP, feedP]) {
        if (want.includes(p)) { if (p.parentElement !== sheetBody) sheetBody.appendChild(p); }
        else if (p.parentElement === sheetBody) p.remove();
      }
      want.forEach((p) => sheetBody.appendChild(p));
      if (sel.parentElement !== el) el.appendChild(sel);
    } else {
      left.append(stage, floorsP);
      right.prepend(kpiP, crewP, feedP);
      if (sel.parentElement !== right) right.appendChild(sel);
    }
  }
  mobile.addEventListener('change', placePanels);

  // ---------- carga ----------
  const loading = h('div', 'loading');
  loading.innerHTML = `
    <div class="loading__card">
      <div class="brand__mark lg"><svg viewBox="0 0 32 32"><path d="M9 26V8h14v18" fill="none" stroke="currentColor" stroke-width="3"/><path d="M9 14h14M9 20h14" stroke="currentColor" stroke-width="2"/></svg></div>
      <div class="loading__title">Edificio E · Obra en vivo</div>
      <div class="loading__sub">Condominio Espacio Las Tablas · Curauma</div>
      <div class="loading__bar"><i></i></div>
      <div class="loading__txt"></div>
    </div>`;
  const loadBar = loading.querySelector<HTMLElement>('.loading__bar i')!;
  const loadTxt = loading.querySelector<HTMLElement>('.loading__txt')!;

  el.append(brand, left, right, views, tr, mTop, sheet, loading);
  placePanels();

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      cb.onPlayPause();
    }
  });

  let lastPlaying: boolean | null = null;
  let lastSpeed = -1;

  const hud: Hud = {
    el,
    update(s) {
      duration = s.duration;
      if (markersDur !== duration && markers.length) placeMarkers();
      setText(dayEl, s.dayLabel);
      setText(lvlEl, s.levelLabel);
      setText(mLvl, s.levelLabel);
      setText(phaseEl, s.phaseTitle);
      setText(actEl, s.activityTitle);
      setText(mAct, `${s.phaseTitle} · ${s.activityTitle}`);
      setText(detailEl, s.activityDetail);

      // pasos del ciclo de piso
      if (stepNodes.length !== s.steps.length) {
        stepsEl.innerHTML = '';
        stepNodes = s.steps.map((_, i) => {
          const li = h('li', 'step');
          li.innerHTML = `<span class="step__n mono">${i + 1}</span><span class="step__label"></span><span class="step__pct mono"></span><span class="step__bar"><i></i></span>`;
          stepsEl.appendChild(li);
          return { li, label: li.querySelector<HTMLElement>('.step__label')!, bar: li.querySelector<HTMLElement>('.step__bar i')!, pct: li.querySelector<HTMLElement>('.step__pct')! };
        });
      }
      s.steps.forEach((st, i) => {
        const n = stepNodes[i];
        setText(n.label, st.label);
        setAttr(n.li, 'data-state', st.state);
        setWidth(n.bar, st.progress);
        setText(n.pct, st.state === 'done' ? '✓' : st.state === 'active' ? `${Math.round(st.progress * 100)}%` : '');
      });

      // pisos (de arriba hacia abajo)
      if (floorNodes.length !== s.floors.length) {
        stackEl.innerHTML = '';
        floorNodes = [...s.floors].reverse().map((f) => {
          const row = h('div', 'floor');
          row.innerHTML = `<span class="floor__name mono">${f.name}</span><span class="floor__bar"><i></i></span><span class="floor__pct mono"></span>`;
          stackEl.appendChild(row);
          return { row, fill: row.querySelector<HTMLElement>('.floor__bar i')!, pct: row.querySelector<HTMLElement>('.floor__pct')! };
        }).reverse();
      }
      s.floors.forEach((f, i) => {
        const n = floorNodes[i];
        setAttr(n.row, 'data-state', f.state);
        setWidth(n.fill, f.progress);
        setText(n.pct, f.state === 'todo' ? '—' : `${Math.round(f.progress * 100)}%`);
      });

      // indicadores
      for (const k of s.kpis) {
        let n = kpiNodes.get(k.key);
        if (!n) {
          const card = h('div', 'kpi');
          card.innerHTML = `<div class="kpi__label"></div><div class="kpi__value"><span class="mono v"></span><span class="u"></span></div><div class="kpi__sub"></div>${k.progress !== undefined ? '<div class="kpi__bar"><i></i></div>' : ''}`;
          card.querySelector('.kpi__label')!.textContent = k.label;
          kpiGrid.appendChild(card);
          n = { value: card.querySelector<HTMLElement>('.v')!, unit: card.querySelector<HTMLElement>('.u')!, sub: card.querySelector<HTMLElement>('.kpi__sub')!, bar: card.querySelector<HTMLElement>('.kpi__bar i') };
          kpiNodes.set(k.key, n);
        }
        setText(n.value, k.value);
        setText(n.unit, k.unit ?? '');
        setText(n.sub, k.sub ?? '');
        if (n.bar && k.progress !== undefined) setWidth(n.bar, k.progress);
      }

      // dotación
      const ck = s.crew.map((c) => c.label + c.count).join('|');
      if (ck !== crewKey) {
        crewKey = ck;
        const total = s.crew.reduce((a, c) => a + c.count, 0);
        crewTotal.textContent = `${total}`;
        crewList.innerHTML = '';
        for (const c of s.crew) {
          const li = h('li');
          li.innerHTML = '<span></span><b class="mono"></b>';
          li.querySelector('span')!.textContent = c.label;
          li.querySelector('b')!.textContent = String(c.count);
          crewList.appendChild(li);
        }
      }

      // bitácora
      const fk = s.feed.map((f) => f.t + f.text).join('|');
      if (fk !== feedKey) {
        const prevFirst = feedKey.split('|')[0];
        feedKey = fk;
        feedList.innerHTML = '';
        s.feed.forEach((f, i) => {
          const li = h('li', `feed__item k-${f.kind}`);
          li.innerHTML = `<span class="feed__ic mono">${FEED_ICON[f.kind]}</span><span class="feed__txt"></span><span class="feed__t mono"></span>`;
          li.querySelector('.feed__txt')!.textContent = f.text;
          li.querySelector('.feed__t')!.textContent = f.t;
          if (i === 0 && f.t + f.text !== prevFirst) li.classList.add('fresh');
          feedList.appendChild(li);
        });
      }

      // transporte
      const k = s.duration > 0 ? s.time / s.duration : 0;
      setWidth(fill, k);
      const hl = `${(k * 100).toFixed(2)}%`;
      if (handle.style.left !== hl) handle.style.left = hl;
      setText(trDay, s.dayLabel);
      setText(trPct, `${Math.round(s.overall * 100)} %`);
      if (s.playing !== lastPlaying) {
        lastPlaying = s.playing;
        playBtn.innerHTML = s.playing ? ICON.pause : ICON.play;
        playBtn.classList.toggle('paused', !s.playing);
      }
      if (s.speed !== lastSpeed) {
        lastSpeed = s.speed;
        speedBtns.forEach((b, v) => b.classList.toggle('on', v === s.speed));
      }
    },
    setMarkers(m) {
      markers = m;
      placeMarkers();
    },
    showSelection(s) {
      if (!s) {
        el.classList.remove('has-selection');
        return;
      }
      setText(sel.querySelector<HTMLElement>('.selection__title')!, s.title);
      setText(sel.querySelector<HTMLElement>('.selection__sub')!, s.subtitle ?? '');
      const badge = sel.querySelector<HTMLElement>('.selection__badge')!;
      setText(badge, s.badge ?? '');
      badge.hidden = !s.badge;
      const rows = sel.querySelector<HTMLElement>('.selection__rows')!;
      const key = JSON.stringify(s.rows);
      if (rows.dataset.key !== key) {
        rows.dataset.key = key;
        rows.innerHTML = '';
        for (const [k, v] of s.rows) {
          const dt = h('dt');
          dt.textContent = k;
          const dd = h('dd');
          dd.textContent = v;
          rows.append(dt, dd);
        }
      }
      const note = sel.querySelector<HTMLElement>('.selection__note')!;
      setText(note, s.note ?? '');
      note.hidden = !s.note;
      el.classList.add('has-selection');
    },
    setLoading(k, text) {
      setWidth(loadBar, k);
      if (text) setText(loadTxt, text);
      if (k >= 1) {
        loading.classList.add('done');
        setTimeout(() => loading.remove(), 900);
      }
    },
    setView(v) {
      (Object.keys(viewBtns) as ViewMode[]).forEach((k) => viewBtns[k].classList.toggle('on', k === v));
    },
    setCompass(a) {
      rose.style.transform = `rotate(${(-a * 180) / Math.PI}deg)`;
    },
  };
  return hud;
}

/** Etiqueta 3D (se envuelve en un CSS2DObject): píldora con punto y línea guía hacia abajo. */
export function createTag(text: string, kind: 'crane' | 'mixer' | 'pump' | 'acopio' | 'work' | 'info' = 'info'): HTMLElement {
  const anchor = h('div', 'tag-anchor');
  const pill = h('div', `tag tag--${kind}`);
  pill.innerHTML = '<i></i><span></span>';
  pill.querySelector('span')!.textContent = text;
  anchor.appendChild(pill);
  return anchor;
}
