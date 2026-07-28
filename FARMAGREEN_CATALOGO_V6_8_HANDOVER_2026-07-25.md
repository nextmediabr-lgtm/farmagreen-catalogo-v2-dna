# FarmaGreen Catálogo V6.8 — handover beta pública

Estado: beta pública desplegada en un proyecto Vercel de test separado. No es la producción canónica de FarmaGreen y no hubo deploy ni carga de imágenes en GCP.
Actualizado: 2026-07-27, auditoría y QA pública PC/móvil cerradas.

## Base y aislamiento

- Rama: `codex/v68-claude-review`
- Base exacta: `codex/v67-beta-ui` en `e1b872f39363eb3f9b0f9366c352c1c2149d298d`
- Worktree: `/Users/danielbernardes/Documents/New project/.worktrees/eucerin-catalogo-v68-local`
- Proyecto Vercel V6.8: `farmagreen-v6-8-public-test` (`prj_xRKBg36seCceZKD8g5oAhA27g44s`).
- Deployment V6.8: `dpl_3dELKp7vKEh2FoLyvnMtA769CRD3`, estado `READY`, target `production` únicamente dentro del proyecto público de test.
- El worktree no quedó vinculado mediante `.vercel/project.json`; el destino se seleccionó explícitamente con `--scope` y `--project`.
- V6.7 y su preview público no fueron modificados. Después del deploy V6.8, V6.7 conservó `prj_konNiMkJDXE7S01geyVb2tXqOYaX`, `updatedAt=1784926296671` y último deployment `dpl_G1pHwvUT7VBkHAYFA2uun6iqRKav`.

## Acceso público para el equipo

- Catálogo PC/móvil: `https://farmagreen-v6-8-public-test.vercel.app/catalogo-v6-8/`
- API pública minimizada: `https://farmagreen-v6-8-public-test.vercel.app/api/catalog-v6-8`
- Inspector Vercel: `https://vercel.com/farma-green/farmagreen-v6-8-public-test/3dELKp7vKEh2FoLyvnMtA769CRD3`
- V6.7 preservada: `https://farmagreen-v6-7-public-test.vercel.app/catalogo-v6-7/`

## Acceso local

```bash
cd "/Users/danielbernardes/Documents/New project/.worktrees/eucerin-catalogo-v68-local"
npm ci
npm run dev:v68
```

- Catálogo: `http://127.0.0.1:8100/catalogo-v6-8/`
- API local: `http://127.0.0.1:8100/api/catalog-v6-8`
- Si el servidor local se detiene, usar `npm run dev:v68`.
- `npm start` no habilita V6.8 por accidente: fuera de la preview local explícita, catálogo, API, PDP e imágenes responden `503`.

## Datos y fuente

- 688 productos.
- 11 marcas; nombres visibles normalizados: `Aveno` y `L'Oréal Revitalift`.
- Duplicado visual de Vichy eliminado: `e58ab2ba2993`.
- 0 descripciones terminadas en `...`.
- 0 necesidades vacías.
- Cada producto tiene entre 1 y 2 necesidades primarias; no se acumulan etiquetas secundarias sin límite.
- 0 nombres normalizados duplicados.
- 395 productos tienen URL GPSFarma trazable; 394 fueron recuperados directamente de esas páginas.
- 291 fichas conservan contenido completo o frases completas del catálogo base GPSFarma.
- 670 fichas tienen contenido útil normalizado; 250 exponen secciones semánticas cuando la fuente trae encabezados.
- 73 bloques corporativos de Eucerin en primera persona fueron retirados.
- 73 repeticiones de Presentación/Cantidad fueron omitidas del Detalle porque el dato ya aparece en la ficha.
- 15 textos que eran sólo códigos de depósito, el mismo título o un fragmento genérico se muestran honestamente como `gpsfarma-metadata-only`.
- 3 fichas quedan explícitamente como `gpsfarma-detail-pending`; no se inventó contenido médico:
  - Suplemento Dietario Activamente x 30 comp.
  - Suplemento Dietario Energía x 30 comp.
  - Creatina AMPK Sport Monohidrato x 300 gr.

Archivos de procedencia:

- `data/gpsfarma-v68-source.json`: snapshot de extracción.
- `data/v68-taxonomy-audit.json`: muestra estratificada y etiquetas de revisión.
- `scripts/fetch-gpsfarma-v68.mjs`: extracción reproducible.
- `scripts/gpsfarma-http.mjs`: frontera HTTPS, redirects, timeout y reintentos.
- `scripts/gpsfarma-listing.mjs`: parser y matcher de marca/título compartido por las rutas primaria y fallback.
- `scripts/build-v68-data.mjs`: normalización determinística.
- `data/catalog-v68.json`: catálogo consumido por V6.8.

La procedencia permanece en esos archivos internos. La superficie pública de V6.8 —HTML, JSON embebido, API, metadatos y cabeceras— no publica proveedor, URLs de extracción ni campos `source`.

La extracción falla de forma conservadora: cada redirect debe permanecer en el único origen HTTPS permitido; la marca observada en cada resultado se contrasta con la identidad declarada; marcas cortas no coinciden como subcadenas; y un título genérico con baja cobertura no supera el umbral. La misma selección validada se usa en la ruta primaria y en el fallback. Las variantes numéricas conservan su rol y unidad, por lo que `FPS 50 × 30 ml` no puede confundirse con `FPS 30 × 50 ml` ni `30 ml` con `30 g`.

## Razonador de necesidades V6.8

- Versión: `v68.2-primary-intent`.
- Objetivo de precisión aceptado: `95%`.
- Precisión observada en auditoría interna: `100/100` decisiones válidas. La muestra toma de manera determinística 10 decisiones de cada una de las 10 necesidades específicas, ordenadas por SHA-256 con semilla fija.
- El build reconstruye la muestra, exige que coincida exactamente con las etiquetas y falla si la precisión cae por debajo de `95%`.
- Esta medición es una auditoría interna estratificada, no un gold set externo etiquetado por farmacia; queda registrada como `externalHumanGold: false`.
- Evidencia permitida: nombre del producto, línea y categoría primaria.
- Evidencia excluida: descripción, instrucciones y aliases. Así, frases como “usar fotoprotector” ya no convierten un ácido en producto solar.
- Las líneas compuestas, por ejemplo `Aquaphor/AtopiControl`, se ignoran como evidencia para evitar que una sublínea contamine a la otra.
- Nutrición, solares y capilar son categorías dominantes: cuando la fuente ubica allí un producto, no se agregan usos cosméticos contradictorios.
- Las señales del nombre pesan más que las de la línea; si no existe evidencia específica suficiente, se usa `Cuidado diario`.
- La auditoría detectó que `piel grasa` no equivale necesariamente a `Acné`; esa regla genérica fue retirada. Acné requiere ahora una señal específica como Acniben, Effaclar, DermoPure, Normaderm, acné o imperfecciones.
- Resultado actual: 631 de 688 fichas (`91,7%`) tienen una necesidad específica respaldada; 57 quedan conservadoramente en `Cuidado diario`. Distribución: Manchas 20, Acné 41, Piel sensible 21, Hidratación 143, Limpieza 83, Solares 197, Capilar 31, Antiedad 75, Reparación 24 y Nutrición 79.
- Casos informados por farmacia:
  - Los 36 productos de `Productos Saludables` quedan únicamente en Nutrición.
  - Dermaglós pasa de un único resultado evidente a 11 productos de Antiedad respaldados por el nombre.
  - Un solar ISDIN queda únicamente en Solares aunque su texto mencione piel grasa o acné.
  - Glicoisdin no se clasifica como solar o acné por instrucciones; queda conservadoramente en `Cuidado diario`.

## Cambios de interfaz

- Rutas separadas `/catalogo-v6-8/` y `/producto-v6-8/`.
- Canonical, `og:url` y links de producto en WhatsApp son absolutos.
- Contador de marca refleja el resultado filtrado actual.
- Marca y necesidad son caminos mutuamente excluyentes: elegir una marca limpia la necesidad y elegir una necesidad limpia la marca.
- Una URL heredada con `marca` y `need` conserva la marca y descarta `need`; la URL visible se normaliza automáticamente.
- Menú de necesidades: 12 opciones, 6 × 2 en desktop y 4 × 3 en mobile.
- Nuevas necesidades explícitas: Limpieza y Cuidado diario.
- Se conserva el contrato de 5 tarjetas desktop y 2 mobile.
- Tarjetas colectivas: `Presentación` y `Uso` quedan como información secundaria; se eliminó la palabra `principal`.
- Todos los badges de descuento muestran el signo negativo, por ejemplo `-30%`, tanto en tarjetas como en los dos puntos de la ficha individual.
- Ficha individual: título levemente menor, Presentación/Uso compactos en dos columnas, dos beneficios y Detalle completo, sin atribución ni enlace visible al proveedor.
- El Detalle respeta la estructura disponible en GPSFarma: resumen, Beneficios, Composición y Modo de uso con HTML semántico.
- En desktop, la foto del PDP queda alineada arriba y conserva su propia altura; el texto largo ya no estira la columna visual.
- Eliminada la frase `Podés compartir esta URL tal como está.`
- Fallback defensivo para marca e imagen ausentes.
- La información pública usa un DTO explícito y no envía descripción, detalle, procedencia, taxonomía ni metadatos internos en el catálogo/API.
- El boot del cliente se entrega como JSON inerte; la CSP V6.8 no requiere `unsafe-inline`.

## Verificación

- `npm ci`: instalación local reproducible, 0 vulnerabilidades reportadas por npm.
- `npm run verify`: gate portable, 34/34 pruebas lógicas.
- `npm run verify:release:v68`: gate portable + 1/1 prueba de navegador Chrome real en un entorno que lo tenga provisionado.
- El gate completo también pasó heredando `NODE_ENV=production`; los servidores de prueba fuerzan explícitamente entorno de test y ya no dependen del shell de release.
- Desktop 1440 × 900: 5 columnas y sin overflow horizontal.
- Mobile 390 × 844: 2 columnas y sin overflow horizontal.
- Desplegable mobile: 12 opciones, 4 columnas, sin crecimiento del bloque cerrado.
- URL heredada ISDIN + solares: se normaliza a ISDIN, necesidad `Todas`, 144 productos.
- Interacción real: elegir Acné después de ISDIN limpia la marca; elegir Dermaglós después de Acné limpia la necesidad.
- Búsqueda tolerante `protetor solar bebe`: 2 resultados.
- PDP largo desktop: foto y buybox comienzan en `y=250`; foto `520 px`, buybox `1495 px`, sin estiramiento ni overflow.
- PDP mobile: foto `320 px`, buybox apilado después de la imagen, sin overflow.
- PDP desktop/mobile: dos facts por fila, secciones completas, sin referencia visible al proveedor y URL WhatsApp absoluta.
- Consola del navegador: 0 errores durante la pasada.
- Barrida HTTP de las 688 fichas: 0 referencias públicas al proveedor, 0 atribuciones visibles, 0 badges positivos y 0 cabeceras CSP con el dominio de origen.
- API pública: 688 productos, 0 campos `source`, 0 metadatos internos de extracción y 488 referencias de imagen transformadas a rutas propias `/media-v6-8/...`.
- Inspección visual adicional en Chrome 1440 × 1000 y 390 × 844: Aveno correcto, jerarquía secundaria legible, 5/2 columnas, 0 overflow, 0 errores de consola, 0 fallos de red y 0 solicitudes del navegador al proveedor.
- QA sobre el dominio Vercel público: 688/688 PDP en `200`, 488/488 medios en `200` con MIME de imagen, 0 fugas de procedencia, 0 badges positivos, 0 descuentos sin sus dos badges negativos, 0 errores de navegador y 0 solicitudes directas al proveedor.
- Artefacto Build Output API v3: 688 PDP, 488 rutas de medios, 489 overrides, 23 MB de contenido y 32 MB en `.vercel/output`.
- Alias estable, catálogo, API y V6.7 respondieron `200` después del deploy.
- `npm start` sin entorno explícito: las cuatro superficies V6.8 responden `503`.
- `NODE_ENV=production`, `V68_ENABLE_PRODUCTION=1` y `PUBLIC_ORIGIN` válido: las cuatro superficies continúan en `503` mientras existan imágenes temporales.
- Catálogo reconstruido de forma determinística: SHA-256 `062fe27e79d72775371669305e8e59696e89c98a8ee6347f058ff19263bb061b`.
- Auditoría de cierre: TruffleHog limpio; los 2 P2 aceptados (roles/unidades numéricas y entorno de tests) fueron corregidos; dos auditorías read-only independientes cerraron sin P1/P2. La repetición externa final del revisor estructurado fue bloqueada por la política de salida de código, sin eludir esa protección.

La guarda 5/2 ya no depende sólo de buscar texto dentro del CSS: `tests/v68-layout.e2e.mjs` levanta la app compilada y mide el layout renderizado en Chrome.

## Deuda explícita antes de producción

- 244 productos todavía dependen internamente de imágenes del proveedor (488 referencias card/detail). Para esta beta, el exportador descargó copias temporales dentro del artefacto Vercel y las publica mediante rutas propias `/media-v6-8/...`; el navegador no contacta al proveedor. Esas copias se reemplazarán por el Store de imágenes en GCP antes de la producción canónica.
- Producción requiere `PUBLIC_ORIGIN`, `V68_ENABLE_PRODUCTION=1` y que las imágenes card/detail de las 688 fichas ya pertenezcan al Store GCP; el servidor valida las tres condiciones y falla cerrado.
- No se creó bucket, no se subieron imágenes y no se inició ningún deploy en GCP.
- 15 fichas `metadata-only` y 3 `detail-pending` necesitan mejor contenido en la fuente para ampliarse sin inventar información.
- Quedan 8 descripciones legítimamente más breves que el nombre del producto; no se rellenaron automáticamente.
- Se preservan errores o redacción imperfecta del texto fuente cuando corregirlos implicaría alterar información médica/comercial sin una referencia adicional.
- Las 57 fichas en `Cuidado diario` expresan incertidumbre deliberadamente. Mejorar su recall requiere validar nuevas reglas o etiquetarlas humanamente; no se rellenarán desde texto médico o instrucciones.
- La auditoría interna supera el umbral del 95%, pero una cifra de precisión externa requiere una muestra etiquetada por farmacia y separada de esta revisión.

## Estado Git y despliegue

- Los cambios permanecen sin commit ni push en el worktree V6.8.
- El deployment público se construyó desde ese worktree; Vercel registra `gitDirty=1`, rama `codex/v68-claude-review` y SHA base `e1b872f39363eb3f9b0f9366c352c1c2149d298d`.
- Exportador: `src/export-v68-static.ts`.
- Build: `npm run export:vercel:v68`.
- Deploy aislado: `npx --yes vercel@58.0.0 deploy --prebuilt --yes --prod --scope farma-green --project farmagreen-v6-8-public-test`.
- No se ejecutó ningún comando de deploy sobre V6.7 ni sobre GCP.
