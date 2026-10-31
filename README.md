# proyecto-titulo-app

Simulación 3D isométrica de la construcción del **Edificio E** — Condominio Espacio Las Tablas (Curauma, Valparaíso).

La app muestra cómo crece el edificio con el **método tradicional de hormigón armado**, piso por piso y con la logística real de la obra:

1. **Muros:** enfierradura → moldaje metálico (lo sube la grúa desde el acopio) → llega el mixer → hormigonado con **capacho** colgado de la grúa → desmolde, con la bandeja de trabajo perimetral en ménsulas ya en el piso (plataforma de ~1 m con baranda y malla de ~1,2 m, solo en el piso en obra).
2. **Losa:** antes de cualquier trabajo en el piso de arriba, apenas se desmoldan los muros, la grúa trepa la bandeja perimetral a la cota de la losa nueva → puntales y vigas H20 → placas fenólicas → enfierradura → hormigonado con la **bomba estacionaria**: el mixer llega en retroceso hasta la tolva de la bomba (en su caseta del costado posterior, al frente opuesto de la grúa, abajo a la cota del camino y algo alejada del edificio) y descarga con su canaleta; el hormigón sube por la tubería que sube el corte hasta la plataforma y va por el suelo, entra al 1er piso por la puerta posterior del hall y sube por el **shaft del ascensor**, y la cuadrilla lo reparte con la manguera sobre la losa. Cada losa la hacen dos mixers: mientras sale el primero y entra el segundo, la bomba se detiene.
3. **Radier del 1er piso:** no va en la ruta crítica. El 1er piso queda con relleno compactado mientras se colocan las redes bajo radier (alcantarillado y agua potable) y se hormigona en paralelo con los muros del último piso (en la visita del 09-10-2026 la obra tenía el 5° piso y aún no tenía radier).
4. **Techumbre (obra gruesa):** con la bandeja perimetral, que ya trepó a la techumbre para la losa de techo, se hacen los **parapetos** de H.A. (V.I. 15/80 y testeros, +17,50 → +18,14) y la **caja de escala y sala de máquinas** sobre el núcleo (ejes K.–M. / 3–7, muros hasta +19,93 con su losa de cielo a +20,09), con fierro, moldaje, capacho y desmolde, igual que los muros de piso (lámina L41, cubicación).
5. Al terminar la obra gruesa: tabiquería, ventanas de PVC, barandas y pintura de fachada, piso a piso. En paralelo va la **techumbre** del itemizado (cap. 3), con los días del cronograma detallado: estructura de cerchas y costaneras de pino impregnado con tapa OSB (33 días, parte 5 días después de la última losa), aislación con Aislán (21 días), cubierta de zincalum prepintado 0,5 mm emballetado con 1,5 % de pendiente (faldones norte, central y sur), hojalatería (canales, forros de parapeto, cumbrera y ventilaciones de los shafts, 36 días) y aguas lluvia (cubetas y bajadas Ø160 en las esquinas y Ø110 desde la caja). La grúa sube la madera, el OSB, el Aislán y las planchas y **se desmonta 5 días después de terminada la estructura**; el **ascensor** se monta con la sala de máquinas y la cubierta terminadas.

El calendario está calibrado en ~300 días hábiles (poco más de un año, como la programación de la obra).

**Terreno (fotos de la visita y bosquejo de la distribución real):** la plataforma del edificio es plana (cota −0,20). El camino de camiones va más abajo (−2,20, como un piso), por el costado posterior, con un corte de ~2 m desde el borde de la plataforma; ahí abajo, en un ensanche junto al pie del corte, quedan la caseta de la bomba (algo alejada del edificio), el punto del capacho y el bolsón de espera. Al frente, un talud bastante inclinado sube unos 5 m hasta la explanada donde está la instalación de faena, que baja al camino por la bajada del costado del portón. Junto al portón, una rampa sube del camino a la plataforma (por ahí entran y salen los camiones tolva); el camino termina antes del otro extremo. Los acopios de moldaje van al frente: el de losa junto a los puntales y el de muros hacia el fierro.

**Accesos y logística de hormigón:** el camino de camiones va por el costado posterior del edificio, no por el frente, y es uno solo: parte abajo, en el portón norponiente (arriba a la izquierda en la vista principal), pasa por la bomba y termina antes del extremo +x. El mixer llega por la calle, pasa el portón y entra **en retroceso** (la canaleta va atrás) y, al final, se corre con una S al ensanche donde descarga: al capacho de la grúa para muros, antes de la bomba, o a la tolva de la bomba para losas y radier. Después sale de frente por el mismo camino y el mismo portón. En las losas el segundo mixer entra mientras descarga el primero y espera en el bolsón del ensanche, detrás de él; cuando el primero sale al camino y lo pasa, retrocede derecho hasta la tolva, y la bomba se detiene solo unos instantes en el cambio. En la excavación, que va del extremo +x hacia la rampa, los camiones tolva entran en retroceso por el portón, suben la rampa y siguen por la huella de carguío detrás del edificio hasta la excavadora; cargados, salen de frente por la misma rampa y el portón. El siguiente espera en la calle, pasado el portón. La grúa y los acopios quedan al frente; la grúa toma el capacho en el ensanche de abajo pasando por sobre el edificio.

## Cómo se ve y se usa

- Vista isométrica navegable: arrastrar para moverse, rueda o pellizco para zoom y botón derecho para rotar.
- Línea de tiempo con play/pausa, velocidades ×1 a ×8 y marcas por piso.
- Al hacer clic en un piso, la grúa, un mixer, la bomba, los acopios o la faena se abren sus datos en un panel lateral.
- El tablero muestra la etapa actual, el avance de cada piso, los indicadores (hormigón, acero, moldaje, mixers y capachos) y la bitácora de obra.
- Botones: Vista iso (vista principal, desde el frente) · Vista posterior (desde atrás: camino de mixers, portón, bomba, tubería y, al fondo, el talud con la faena) · Seguir la obra · Planta · Etiquetas · Corte (corta el edificio para ver el interior).
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
| Entorno: estero Las Tablas y avenida detrás de la obra, pasaje del portón y barrio, edificios del condominio al frente (iguales al E, en una terraza más alta), bosque; tamaño del sitio | vista satelital (Av. Las Tablas 230, Curauma) |
| Fachadas largas simétricas (ventanas, barandas y muros reflejados desde una mitad), hall de acceso a doble altura al centro de la fachada posterior (vacío del 2P), 2P igual a los pisos tipo, ventanas y barandas de vidrio de fachada | plantas 1P y 2P y elevaciones (L38, L39, L42): correcciones sobre el IFC en `src/data/planFixes.ts` y `src/scene/facadeDetail.ts` |
| Desniveles, camino, bajada y rampa, ubicación de la bomba, orden de excavación | fotos de la visita y bosquejo de la distribución real de la faena |

Los tiempos de cada actividad (días hábiles) son típicos del método y se ajustan en `src/config.ts` (`DAYS` y `PACE`). Ahí también se definen las ubicaciones de la grúa, la bomba, los acopios, los caminos y el portón, y las cotas del terreno (`SITE.terreno`).

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
    roads.ts           calle, portón, camino posterior, ensanche de la bomba y rampa de los camiones tolva (rutas en planta)
    terrain.ts         cotas del terreno: plataforma, camino más abajo, talud del frente con la faena, bajada y rampas
    crews.ts           cuadrillas en la losa y en terreno
    progress.ts        indicadores de avance
  scene/
    structure.ts       edificio que crece (hormigón, fierro, moldajes, puntales)
    roof.ts            obras sobre la losa de techumbre (parapetos, caja de escala, techumbre y cubierta)
    reveal.ts          materiales que hacen aparecer/crecer/retirar elementos en el tiempo
    site.ts            terreno, talud del frente, camino posterior y portón, faena y acopios
    pipeline.ts        tubería de la bomba por el suelo y el shaft del ascensor
    equipment/         grúa, mixer, bomba estacionaria, capacho, cargas, trabajadores
    facadeDetail.ts    ventanas a ras del muro y barandas de barras, según las elevaciones (L42)
    condominio.ts      edificios ya construidos del condominio (réplicas del E) al frente
    world.ts           arma la escena y la sincroniza con el tiempo
  ui/                  tablero (HUD) y estilos
```

## Publicación

El sitio es estático (`dist/`). Se publica en Vercel conectado a este repositorio; más adelante se agregará Supabase para datos y usuarios.
