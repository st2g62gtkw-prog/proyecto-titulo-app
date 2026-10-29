/** Bitácora de obra: eventos fechados que se muestran en el tablero. */
import { ROOF_WALL_M3, SALA_LOSA_M3, SLAB_M3, WALL_M3 } from '../data/project';
import { DAYS_PER_MONTH } from '../config';
import type { Logistics } from './logistics';
import type { PaintPlan } from './paintPlan';
import type { Schedule } from './schedule';

export type FeedKind = 'mixer' | 'crane' | 'pump' | 'info' | 'ok';
export interface FeedEvent {
  t: number;
  text: string;
  kind: FeedKind;
}

export function buildFeed(sched: Schedule, log: Logistics, paint?: PaintPlan): FeedEvent[] {
  const ev: FeedEvent[] = [];
  const fmt = (n: number) => n.toLocaleString('es-CL', { maximumFractionDigits: 1 });
  for (const a of sched.activities) {
    ev.push({ t: a.t0, text: `Inicio: ${a.title}`, kind: 'info' });
    if (a.kind === 'muroHormigon') ev.push({ t: a.t1 - 0.5, text: `Muros ${a.levelName} hormigonados · ${fmt(WALL_M3[a.levelName] ?? 0)} m³`, kind: 'ok' });
    if (a.kind === 'muroMoldaje') ev.push({ t: a.t0 + 0.3, text: `Grúa sube paneles de moldaje al ${a.levelName}`, kind: 'crane' });
    if (a.kind === 'muroFierro') ev.push({ t: a.t0 + 0.3, text: `Grúa sube paquetes de fierro al ${a.levelName}`, kind: 'crane' });
    if (a.kind === 'muroFierro' && a.level > 0) {
      ev.push(a.level === 1
        ? { t: a.t0 + 0.1, text: `Bandeja perimetral en ménsulas armada en el ${a.levelName}`, kind: 'info' }
        : { t: a.t0 + 0.7, text: `Grúa trepa la bandeja perimetral en ménsulas al ${a.levelName}`, kind: 'crane' });
    }
    if (a.kind === 'losaHormigon') {
      const p = sched.slab[a.level].pour;
      ev.push({ t: p[1], text: `${a.levelName === 'Techumbre' ? 'Losa de techumbre' : `Losa de piso ${a.levelName}`} hormigonada · ${fmt(SLAB_M3[a.levelName] ?? 0)} m³`, kind: 'ok' });
    }
    // obra gruesa sobre la losa de techumbre
    if (a.kind === 'techoFierro') {
      ev.push({ t: a.t0 + 0.1, text: 'Grúa trepa la bandeja perimetral a la techumbre para los parapetos', kind: 'crane' });
      ev.push({ t: a.t0 + 0.4, text: 'Grúa sube fierro para los parapetos y la caja de escala', kind: 'crane' });
    }
    if (a.kind === 'techoHormigon') ev.push({ t: a.t1 - 0.5, text: `Parapetos y muros de la caja de escala hormigonados · ${fmt(ROOF_WALL_M3)} m³`, kind: 'ok' });
    if (a.kind === 'techoDesmolde') ev.push({ t: a.t1, text: 'Se retira la bandeja perimetral: la baranda de seguridad queda sobre los parapetos', kind: 'info' });
    if (a.kind === 'salaLosa') ev.push({ t: sched.roof.slab.pour[1], text: `Losa de cielo de la caja de escala hormigonada · ${fmt(SALA_LOSA_M3)} m³: termina la obra gruesa`, kind: 'ok' });
  }
  // techumbre en paralelo con las terminaciones (cronograma: capítulo 3, grúa torre y ascensores)
  {
    const R = sched.roof;
    for (const ld of R.loads) ev.push({ t: ld.t0 + 0.2, text: `Grúa sube a la techumbre: ${ld.task.charAt(0).toLowerCase()}${ld.task.slice(1)}`, kind: 'crane' });
    ev.push({ t: R.gruaOut, text: 'Desmontaje de la grúa torre (5 días después de terminada la estructura de techumbre)', kind: 'crane' });
    ev.push({ t: R.cubierta[1], text: 'Término de techumbre: cubierta de zincalum, canales, forros y ventilaciones listos', kind: 'ok' });
    ev.push({ t: R.aguas[1], text: 'Aguas lluvia: cubetas y bajadas conectadas', kind: 'ok' });
    ev.push({ t: R.ascensor[1], text: 'Ascensor montado y probado por el fabricante', kind: 'ok' });
  }
  const rad = sched.slab[0].pour;
  ev.push({ t: rad[1], text: 'Radier del 1er piso hormigonado · 665,7 m²', kind: 'ok' });
  for (const m of log.mixers) {
    if (m.waitFrom !== null) ev.push({ t: m.waitFrom, text: m.waitAt === 'bolsón' ? `Mixer N° ${m.id} espera en el bolsón del camino a que salga el anterior` : `Mixer N° ${m.id} espera en la calle junto al portón a que salga el anterior`, kind: 'mixer' });
    ev.push({ t: m.gateIn + 0.3, text: `Mixer N° ${m.id} entra en retroceso por el portón norponiente · 7 m³ G25`, kind: 'mixer' });
    ev.push({ t: m.discharge[0], text: m.spot === 'bomba' ? `Mixer N° ${m.id} descarga en tolva de la bomba` : `Mixer N° ${m.id} carga el capacho`, kind: 'mixer' });
  }
  // fundaciones: excavación por sectores, sellos, fierro, moldaje, hormigón y relleno
  {
    const F = sched.fund;
    ev.push({ t: F.t0 + 0.1, text: 'Trazado de ejes con estación total, niveletas y cal; escarpe y plataforma a −0,20', kind: 'info' });
    ev.push({ t: F.t0 + 0.4, text: 'Llega la excavadora de orugas (20 t) en cama baja', kind: 'info' });
    const vol = (cells: typeof F.cells) => cells.reduce((a, c) => a + c.vol, 0);
    const tot = vol(F.cells);
    let acc = 0;
    for (const v of F.trucks) {
      ev.push({ t: v.gateIn + 0.2, text: `Camión tolva N° ${v.id} entra en retroceso por el portón${v.waitFrom !== null ? ' y espera en el bolsón' : ''}`, kind: 'mixer' });
      acc += vol(v.cells);
      ev.push({ t: v.leave[0] + 0.1, text: `Camión tolva N° ${v.id} sale a botadero · ${fmt(Math.round((acc / tot) * 627))} de 627 m³ excavados`, kind: 'mixer' });
    }
    for (const S of F.sectors) {
      const n = S.n;
      ev.push({ t: S.exc[0] + 0.05, text: `Excavación del sector ${n}${n === 1 ? ': zona profunda A-B a −2,66 con talud 3:1' : n === 2 ? ': núcleo y foso del ascensor a −1,45' : ''}`, kind: 'info' });
      ev.push({ t: S.recep[0] + 0.05, text: `Mecánico de suelos recibe los sellos del sector ${n} (libro de obra)`, kind: 'ok' });
      ev.push({ t: S.empl.t0 + 0.1, text: `Emplantillado G05 de 5 cm en el sector ${n}, con capacho`, kind: 'crane' });
      ev.push({ t: S.fierro[0] + 0.05, text: `Enfierradura de zapatas del sector ${n} · ≈ ${fmt(S.kg / 1000)} t Ø12`, kind: 'info' });
      ev.push({ t: S.moldaje[0] + 0.05, text: `Moldaje de costados y pollos del sector ${n}`, kind: 'info' });
      ev.push({ t: S.pour.pour[0] - 0.3, text: `Bomba estacionaria: se tiende la tubería por el suelo hasta el sector ${n}`, kind: 'pump' });
      ev.push({ t: S.pour.pour[0], text: `Bomba estacionaria inicia el hormigonado de zapatas del sector ${n}: ≈ ${Math.round(S.m3 / 7)} mixers de 7 m³ en cola (en pantalla, cada mixer representa unos ${Math.round(S.m3 / 7 / 2)} viajes)`, kind: 'pump' });
      ev.push({ t: S.pour.pumpStop[0] + 0.05, text: 'Bomba detenida: cambio de mixer (el camino es uno solo)', kind: 'pump' });
      ev.push({ t: S.pour.pour[1], text: `Zapatas del sector ${n} hormigonadas · ≈ ${fmt(Math.round(S.m3))} m³ G25`, kind: 'ok' });
      ev.push({ t: S.desc[0] + 0.05, text: `Descimbre de costados del sector ${n}`, kind: 'info' });
      if (S.npt) ev.push({ t: S.npt.cap.t0 + 0.1, text: n === 2 ? 'Capacho: V.S.C. 20/140 y muros del foso del ascensor' : 'Capacho: muros bajo NPT de los ejes A-B', kind: 'crane' });
      ev.push({ t: S.igol[0] + 0.05, text: `Impermeabilización con Igol de las caras contra terreno, sector ${n}`, kind: 'info' });
      ev.push({ t: S.relleno[0] + 0.05, text: `Relleno lateral compactado en capas de 25 cm, sector ${n}`, kind: 'info' });
    }
    ev.push({ t: F.excavatorOnSite[1], text: 'Termina la excavación: se retira la excavadora', kind: 'info' });
    ev.push({ t: F.pumpIn, text: 'Llega la bomba estacionaria: se arma su caseta junto al camino (la huella de carguío queda libre)', kind: 'pump' });
    ev.push({ t: F.compactacion[0] + 0.05, text: 'Compactación de la plataforma y ensayos de densidad', kind: 'info' });
    ev.push({ t: F.replanteo[1] - 0.2, text: 'Fundaciones recibidas por la ITO · replanteo de muros del 1er piso', kind: 'ok' });
  }
  for (const p of log.pours) {
    if (p.sector > 0) continue;
    const name = p.slab === 0 ? 'radier del 1er piso' : sched.levelNames[p.slab] === 'Techumbre' ? 'losa de techumbre' : `losa de piso ${sched.levelNames[p.slab]}`;
    ev.push({ t: p.pour[0] - 0.3, text: `Bomba estacionaria: se arma la tubería hasta la ${p.slab === 0 ? 'zona del radier' : 'losa por el shaft del ascensor'}`, kind: 'pump' });
    ev.push({ t: p.pour[0], text: `Bomba estacionaria inicia el hormigonado ${p.slab === 0 ? 'del' : 'de la'} ${name}`, kind: 'pump' });
    if (p.pumpStop[1] > p.pumpStop[0]) ev.push({ t: p.pumpStop[0] + 0.05, text: 'Bomba detenida: cambio de mixer (el camino es uno solo)', kind: 'pump' });
  }
  for (const a of sched.parallel) ev.push({ t: a.t0, text: `En paralelo: ${a.title.toLowerCase()}`, kind: 'info' });
  if (paint) {
    // subcontrato de pintura de fachada con balancín: inicio, cada cambio de fachada y término
    ev.push({ t: paint.mount[0] + 0.02, text: 'Parte el subcontrato de pintura: se montan pescantes y balancín en la techumbre', kind: 'info' });
    paint.panos.forEach((p, i) => {
      if (i === 0 || paint.panos[i - 1].facade !== p.facade) {
        ev.push({ t: p.down[0], text: `Balancín de pintura ${i === 0 ? `baja por el primer paño ${p.facade.art === 'el' ? 'del' : 'de la'}` : `pasa ${p.facade.art === 'el' ? 'al' : 'a la'}`} ${p.facade.name.toLowerCase()} · ${p.nOf} paños`, kind: 'info' });
      }
    });
    ev.push({ t: paint.dismount[0], text: `Pintura de fachada terminada · ${fmt(Math.round(paint.area))} m², se retira el balancín`, kind: 'ok' });
  }
  return ev.sort((a, b) => a.t - b.t);
}

/** Etiqueta de calendario en días hábiles: "Día 145 · Mes 7". */
export function dayLabel(day: number) {
  const d = Math.floor(day);
  return `Día ${d + 1} · Mes ${Math.floor(d / DAYS_PER_MONTH) + 1}`;
}

/** Etiqueta corta para la bitácora: "D145". */
export function dayShort(day: number) {
  return `D${Math.floor(day) + 1}`;
}
