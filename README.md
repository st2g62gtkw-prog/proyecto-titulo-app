# proyecto-titulo-app

Simulación 3D isométrica de la construcción del **Edificio E** — Condominio Espacio Las Tablas (Curauma, Valparaíso).

La app muestra cómo crece el edificio con el **método tradicional de hormigón armado**, piso por piso y con la logística real de la obra:

1. **Muros:** la grúa trepa la bandeja de trabajo perimetral en ménsulas (plataforma de ~1 m con baranda y malla de ~1,2 m, solo en el piso en obra) → enfierradura → moldaje metálico (lo sube la grúa desde el acopio) → llega el mixer → hormigonado con **capacho** colgado de la grúa → desmolde.
2. **Losa:** puntales y vigas H20 → placas fenólicas → enfierradura → hormigonado con la **bomba estacionaria**: el mixer llega en retroceso hasta la tolva de la bomba (en su caseta del costado posterior, al frente opuesto de la grúa y al final del camino) y descarga con su canaleta; el hormigón sube por la tubería que va por el suelo, entra al 1er piso por la puerta posterior del hall y sube por el **shaft del ascensor**, y la cuadrilla lo reparte con la manguera sobre la losa. Cada losa la hacen dos mixers: mientras sale el primero y entra el segundo, la bomba se detiene.
3. **Radier del 1er piso:** no va en la ruta crítica. El 1er piso queda con relleno compactado mientras se colocan las redes bajo radier (alcantarillado y agua potable) y se hormigona en paralelo con los muros del último piso (en la visita del 09-10-2026 la obra tenía el 5° piso y aún no tenía radier).
4. **Techumbre (obra gruesa):** sobre la losa del 7° piso la grúa trepa la bandeja perimetral y se hacen los **parapetos** de H.A. (V.I. 15/80 y testeros, +17,50 → +18,14) y la **caja de escala y sala de máquinas** sobre el núcleo (ejes K.–M. / 3–7, muros hasta +19,93 con su losa de cielo a +20,09), con fierro, moldaje, capacho y desmolde, igual que los muros de piso (lámina L41, cubicación).
5. Al terminar la obra gruesa: tabiquería, ventanas de PVC, barandas y pintura de fachada, piso a piso. En paralelo va la **techumbre** del itemizado (cap. 3), con los días del cronograma detallado: estructura de cerchas y costaneras de pino impregnado con tapa OSB (33 días, parte 5 días después de la última losa), aislación con Aislán (21 días), cubierta de zincalum prepintado 0,5 mm emballetado con 1,5 % de pendiente (faldones norte, central y sur), hojalatería (canales, forros de parapeto, cumbrera y ventilaciones de los shafts, 36 días) y aguas lluvia (cubetas y bajadas Ø160 en las esquinas y Ø110 desde la caja). La grúa sube la madera, el OSB, el Aislán y las planchas y **se desmonta 5 días después de terminada la estructura**; el **ascensor** se monta con la sala de máquinas y la cubierta terminadas.

El calendario está calibrado en ~300 días hábiles (poco más de un año, como la programación de la obra).

**Accesos y logística de hormigón:** como en la obra real, el camino de camiones va por el costado posterior del edificio (entre la fachada posterior y el pie del talud), no por el frente, y es uno solo: va del portón norponiente (arriba a la izquierda en la vista principal) hasta la caseta de la bomba. El mixer llega por la calle, pasa el portón y entra **en retroceso** (la canaleta va atrás) hasta donde descarga: al capacho de la grúa para muros, que se llena antes de llegar a la bomba, o a la tolva de la bomba para losas y radier. Después sale de frente por el mismo camino y el mismo portón. Como no se pueden cruzar en el camino, en las losas el segundo mixer entra mientras descarga el primero y espera en un bolsón al costado del camino (junto al estacionamiento); cuando el primero sale y lo pasa, retrocede hasta la tolva, y la bomba se detiene solo unos instantes en el cambio. La grúa y los acopios quedan al frente; la grúa toma el capacho en el camino posterior pasando por sobre el edificio.

## Cómo se ve y se usa

- Vista isométrica navegable: arrastrar para moverse, rueda o pellizco para zoom y botón derecho para rotar.
- Línea de tiempo con play/pausa, velocidades ×1 a ×8 y marcas por piso.
- Al hacer clic en un piso, la grúa, un mixer, la bomba, los acopios o la faena se abren sus datos en un panel lateral.
- El tablero muestra la etapa actual, el avance de cada piso, los indicadores (hormigón, acero, moldaje, mixers y capachos) y la bitácora de obra.
- Botones: Vista iso (vista principal, desde el frente) · Vista posterior (desde el talud: camino de mixers, portón, bomba y tubería) · Seguir la obra · Planta · Etiquetas · Corte (corta el edificio para ver el interior).
- Parámetros de URL para revisar un momento: `?act=losaHormigon-4&k=0.5` (fracción de una actividad), `?t=` (segundos de simulación), `?play=0`, `?view=back` o `?view=top` (abre en la vista posterior o en planta), `?labels=0` (oculta las etiquetas), `?cut=1` (activa el corte) y `?cam=x,y,z&zoom=&az=&el=` (cámara fija).

## De dónde salen los datos

Todo viene de la carpeta **Proyecto de titulo 07-10** en Drive:

| Dato | Fuente |
|---|---|
| Geometría de losas, muros, ventanas, barandas y puertas | `Modelo/Edificio-E.ifc` → `tools/ifc_to_json.py` → `public/data/` |
| Muros de hormigón armado e=20 vs. tabiquería | espesor de cada muro en el IFC (≥ 15 cm = H.A.) |
| Hormigón, acero y moldaje por piso | *Cubicación Edificio E – respaldos (oct 2026)* |
| Techumbre: parapetos, caja de escala, faldones, bajadas y ductos | L41 (planta de techumbre y "SUP TECHOS"), L42, cubicación; ductos en los vanos de shaft de los muros del 7P del IFC |
| Partidas y plazos de la techumbre (cap. 3, 14.5, 2.23 y 2.24) | *Itemizado / Presupuesto (APU)* y *Cronograma Edificio E – versión detallada con cuadrillas (oct 2026)* |
| Programa por piso, superficies y deptos | *CATALOGO.md* (láminas L38–L40) |
| Grúa, mixer, faena, acopios, 85 trabajadores | fotos de la visita a terreno del 09-10-2026 |

Los tiempos de cada actividad (días hábiles) son típicos del método y se ajustan en `src/config.ts` (`DAYS` y `PACE`). Ahí también se definen las ubicaciones de la grúa, la bomba, los acopios, los caminos y el portón.

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # genera dist/ (sitio estático)
```

Para regenerar los datos si cambia el modelo:

```bash
pip install ifcopenshell numpy
python tools/ifc_to_json.py ruta/Edificio-E.ifc public/data
```

`sandbox/` es un banco de pruebas para revisar cada modelo por separado (`/sandbox/?m=crane`, `?m=vehicles`, `?m=site`, `?m=workers`, `?m=structure`, `?m=world`, `?m=stationaryPump`).

## Estructura

```
src/
  config.ts            disposición de la faena y ritmo de la animación
  data/                datos del IFC y cifras del proyecto
  core/
    schedule.ts        cronograma por piso (muros → losa)
    roofPlan.ts        techumbre: parapetos, caja de escala, faldones, canales, bajadas y ductos
    cranePlan.ts       viajes de la grúa (fierro, moldajes, capacho, materiales de techumbre)
    logistics.ts       mixers por el camino posterior, capacho y bomba (llegada, cola, retroceso, salida)
    crews.ts           cuadrillas en la losa y en terreno
    progress.ts        indicadores de avance
  scene/
    structure.ts       edificio que crece (hormigón, fierro, moldajes, puntales)
    roof.ts            obras sobre la losa de techumbre (parapetos, caja de escala, techumbre y cubierta)
    reveal.ts          materiales que hacen aparecer/crecer/retirar elementos en el tiempo
    site.ts            terreno, talud, camino posterior y portón, faena y acopios
    pipeline.ts        tubería de la bomba por el suelo y el shaft del ascensor
    equipment/         grúa, mixer, bomba estacionaria, capacho, cargas, trabajadores
    world.ts           arma la escena y la sincroniza con el tiempo
  ui/                  tablero (HUD) y estilos
```

## Publicación

El sitio es estático (`dist/`). Se publica en Vercel conectado a este repositorio; más adelante se agregará Supabase para datos y usuarios.
