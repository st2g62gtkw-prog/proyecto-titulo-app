# proyecto-titulo-app

Simulación 3D isométrica de la construcción del **Edificio E** — Condominio Espacio Las Tablas (Curauma, Valparaíso).

La app muestra cómo crece el edificio con el **método tradicional de hormigón armado**, piso por piso y con la logística real de la obra:

1. **Muros:** la grúa trepa la bandeja de trabajo perimetral en ménsulas (plataforma de ~1 m con baranda y malla de ~1,2 m, solo en el piso en obra) → enfierradura → moldaje metálico (lo sube la grúa desde el acopio) → llega el mixer → hormigonado con **capacho** colgado de la grúa → desmolde.
2. **Losa:** puntales y vigas H20 → placas fenólicas → enfierradura → hormigonado con la **bomba estacionaria**: el mixer retrocede hasta la tolva de la bomba (en su caseta del costado posterior, al frente opuesto de la grúa) y descarga con su canaleta; el hormigón sube por la tubería que va por el suelo, entra al 1er piso por la puerta posterior del hall y sube por el **shaft del ascensor**, y la cuadrilla lo reparte con la manguera sobre la losa.
3. **Radier del 1er piso:** no va en la ruta crítica. El 1er piso queda con relleno compactado mientras se colocan las redes bajo radier (alcantarillado y agua potable) y se hormigona en paralelo con los muros del último piso (en la visita del 09-10-2026 la obra tenía el 5° piso y aún no tenía radier).
4. Al terminar la obra gruesa: tabiquería, ventanas de PVC, barandas y pintura de fachada.

El calendario está calibrado en ~290 días hábiles (poco más de un año, como la programación de la obra).

**Accesos y logística de hormigón:** como en la obra real, el camino de camiones va por el costado posterior del edificio (entre la fachada posterior y el pie del talud), no por el frente. Los mixers entran por el portón norponiente (arriba a la izquierda en la vista principal), avanzan por el carril de entrada, se detienen donde descargan (al capacho de la grúa para muros, o retroceden por la bahía hasta la tolva de la bomba para losas y radier), dan la vuelta en la rotonda del otro extremo y salen por el carril de salida al mismo portón. La grúa y los acopios quedan al frente; la grúa toma el capacho en el camino posterior pasando por sobre el edificio.

## Cómo se ve y se usa

- Vista isométrica navegable: arrastrar para moverse, rueda o pellizco para zoom y botón derecho para rotar.
- Línea de tiempo con play/pausa, velocidades ×1 a ×8 y marcas por piso.
- Al hacer clic en un piso, la grúa, un mixer, la bomba, los acopios o la faena se abren sus datos en un panel lateral.
- El tablero muestra la etapa actual, el avance de cada piso, los indicadores (hormigón, acero, moldaje, mixers y capachos) y la bitácora de obra.
- Botones: Vista iso (vista principal, desde el frente) · Vista posterior (desde el talud: camino de mixers, portón, bomba y tubería) · Seguir la obra · Planta · Etiquetas · Corte (corta el edificio para ver el interior).
- Parámetros de URL para revisar un momento: `?act=losaHormigon-4&k=0.5` (fracción de una actividad), `?t=` (segundos de simulación), `?play=0`, `?view=back` (abre en la vista posterior) y `?cam=x,y,z&zoom=&az=&el=` (cámara fija).

## De dónde salen los datos

Todo viene de la carpeta **Proyecto de titulo 07-10** en Drive:

| Dato | Fuente |
|---|---|
| Geometría de losas, muros, ventanas, barandas y puertas | `Modelo/Edificio-E.ifc` → `tools/ifc_to_json.py` → `public/data/` |
| Muros de hormigón armado e=20 vs. tabiquería | espesor de cada muro en el IFC (≥ 15 cm = H.A.) |
| Hormigón, acero y moldaje por piso | *Cubicación Edificio E – respaldos (oct 2026)* |
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

`sandbox/` es un banco de pruebas para revisar cada modelo por separado (`/sandbox/?m=crane`, `?m=vehicles`, `?m=site`, `?m=workers`, `?m=structure`).

## Estructura

```
src/
  config.ts            disposición de la faena y ritmo de la animación
  data/                datos del IFC y cifras del proyecto
  core/
    schedule.ts        cronograma por piso (muros → losa)
    cranePlan.ts       viajes de la grúa (fierro, moldajes, capacho)
    logistics.ts       mixers por el camino posterior, capacho y bomba (llegada, cola, retroceso, salida)
    crews.ts           cuadrillas en la losa y en terreno
    progress.ts        indicadores de avance
  scene/
    structure.ts       edificio que crece (hormigón, fierro, moldajes, puntales)
    reveal.ts          materiales que hacen aparecer/crecer/retirar elementos en el tiempo
    site.ts            terreno, talud, camino posterior y portón, faena y acopios
    pipeline.ts        tubería de la bomba por el suelo y el shaft del ascensor
    equipment/         grúa, mixer, bomba estacionaria, capacho, cargas, trabajadores
    world.ts           arma la escena y la sincroniza con el tiempo
  ui/                  tablero (HUD) y estilos
```

## Publicación

El sitio es estático (`dist/`). Se publica en Vercel conectado a este repositorio; más adelante se agregará Supabase para datos y usuarios.
