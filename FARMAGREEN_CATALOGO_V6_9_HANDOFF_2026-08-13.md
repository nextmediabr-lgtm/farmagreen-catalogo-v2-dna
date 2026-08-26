# FarmaGreen Catálogo V6.9 — handoff canónico de producción

Creado: 13 de agosto de 2026
Última actualización: 26 de agosto de 2026
Estado: V6.9 desplegada y saludable; panel GCP, catálogo vivo semanal, stock diario y medición digital activos.
Propósito: punto único de continuidad para código, datos, GCP, búsqueda, taxonomía, exclusiones, navegación, imágenes y analítica.

Este documento describe estado; no amplía autorizaciones. Commit, push, deploy,
refresh, IAM, Scheduler y cualquier mutación futura requieren una autorización
explícita en el turno correspondiente.

## 1. Punto de entrada exacto

| Superficie | Valor verificado |
| --- | --- |
| Worktree dueño | `/Users/danielbernardes/Documents/New project/.worktrees/eucerin-catalogo-v69-local` |
| Rama | `codex/v69-stock-ordering` |
| Último commit técnico/test | `8c14622` — `feat(v69): add reversible brand exclusions` |
| Remoto | `origin/codex/v69-stock-ordering` |
| Producción | <https://farmagreenrosario.web.app/> |
| Proyecto GCP | `project-e2a7bc6d-e741-4d4e-85d` |
| Servicio Cloud Run | `farmagreen-v69-preprod` |
| Región | `southamerica-east1` |
| Revisión activa | `farmagreen-v69-preprod-brandx-20260826`, 100% |
| Imagen activa | build `8a5005a9-d72b-4543-9a1c-938e3dce6544` |
| Refresh comercial | `fg-v69-preprod-sync-0700-art` |
| Discovery semanal | Job `farmagreen-v69-weekly-discovery`; Scheduler `fg-v69-weekly-discovery` |

Los handoffs del 3 y 4 de agosto conservan valor histórico. Sus conteos,
arquitectura de 11 fuentes y estado Git no representan producción actual.

## 2. Estado público confirmado

Lectura directa del health/API el 26/8/2026 después del release final:

```json
{
  "version": 6.9,
  "status": "ready",
  "reason": "current",
  "commerceSyncedAt": "2026-08-26T04:00:06.651Z",
  "totalProducts": 1459,
  "availabilitySummary": {
    "available": 1227,
    "unavailable": 232,
    "unverified": 0
  },
  "analytics": {
    "ga4MeasurementId": "G-SL7GG138WV",
    "googleAdsTagId": "AW-18405204387",
    "metaPixelId": "1198250568817946",
    "metaCapiConfigured": true
  }
}
```

Controles adicionales:

- 1.459 DTO públicos y 1.459 `publicId` únicos;
- 140 marcas reales;
- 664 productos en la vista transversal `Productos Saludables`;
- 685 rutas Magento públicas;
- 0 productos sin necesidades;
- 0 campos públicos `sku`, `source` o proveedor;
- sitemap con 1.461 URLs: home, catálogo y 1.459 PDP;
- barcode `3337875694469` presente exactamente una vez como Retinol B3 de
  La Roche Posay, disponible y con necesidad `antiedad`;
- las seis exclusiones solicitadas el 25/8 están ausentes.

`syncedAt` describe el contenido base. `commerceSyncedAt` describe la frescura
de precio/disponibilidad y es la fecha que debe usarse operativamente.

## 3. Arquitectura productiva

```text
Usuario
  -> farmagreenrosario.web.app
  -> Firebase Hosting (dominio, CDN y rewrite)
  -> Cloud Run farmagreen-v69-preprod (SSR, API, búsqueda, PDP y CAPI)
  -> GCS (snapshot comercial validado e imágenes responsivas)

Cloud Scheduler 07:00/14:00 ART
  -> refresh comercial autenticado
  -> precio/stock Rosario-STOM
  -> adopción de un snapshot semanal más nuevo si existe

Cloud Scheduler lunes 04:00 ART
  -> Cloud Run Job semanal
  -> scan de 16 fuentes
  -> altas/bajas + marcas + vistas
  -> imágenes + Magento + búsqueda + necesidades
  -> snapshot atómico sólo si todos los gates pasan
```

Firebase no contiene otra aplicación. El HTML y la API nacen en Cloud Run. Los
assets versionados pueden quedar cacheados por un año; por eso todo cambio de
JavaScript/CSS inmutable debe usar un nombre nuevo, no sólo cambiar su contenido.

## 4. Horarios y recursos

### Refresh comercial diario

```text
Job: fg-v69-preprod-sync-0700-art
Estado: ENABLED
Cron: 0 7,14 * * *
Zona: America/Argentina/Buenos_Aires
Deadline: 1800 s
```

El nombre histórico menciona 07:00, pero la expresión real ejecuta 07:00 y
14:00 ART. La idempotencia se separa por horario.

### Discovery semanal

```text
Scheduler: fg-v69-weekly-discovery
Estado: ENABLED
Cron: 0 4 * * 1
Zona: America/Argentina/Buenos_Aires
Destino: Cloud Run Jobs v2 :run
Deadline: 1800 s
Retry count: 1
```

Configuración estable después del primer scan:

| Componente | CPU | Memoria | Timeout |
| --- | ---: | ---: | ---: |
| Servicio web | 1 | 512 MiB | 900 s |
| Job semanal | 1 | 1 GiB | 1.800 s |

Para el primer scan se usaron temporalmente 2 CPU y 2 GiB. La primera tarea
alcanzó 1.800 s; el retry reutilizó assets ya preparados y terminó correctamente
en 56m43s. El scan correctivo posterior terminó en 3m37s sin retry. El aumento
temporal fue retirado.

IAM mínimo vigente:

- la cuenta de runtime puede crear objetos de imagen, pero no borrarlos;
- la cuenta del Scheduler puede invocar exclusivamente el Job semanal;
- el token Meta CAPI permanece en Secret Manager/variable secreta y nunca en Git.

## 5. Catálogo vivo y reconciliación

### Causa raíz corregida

El sync diario anterior recorría solamente el catálogo base. Actualizaba
precio/stock y contaba `newCandidates`, pero no incorporaba esos productos.
Por eso STOM podía tener una ficha nueva y V6.9 seguir como una foto antigua.

La reconciliación semanal ahora:

1. recorre exactamente 16 fuentes completas;
2. agrupa apariciones por identidad canónica;
3. actualiza fichas conocidas y agrega altas verificadas;
4. aplica exclusiones privadas al final;
5. confirma bajas sólo ante 404/410 explícito;
6. ante 5xx, timeout, respuesta incompleta o identidad ambigua aborta y conserva
   last-known-good;
7. prepara GCS, reconstruye Magento, buscador, aliases y necesidades;
8. activa sólo con 0 `unverified`, 0 positivos pendientes y 0 negativos pendientes.

Comandos locales:

```bash
npm run scan:data:v69       # dry-run; no escribe
npm run scan:data:v69:apply # finaliza y escribe local; requiere entorno autorizado
```

El Job productivo ejecuta `node dist/catalog-discovery-job-v69.js` y escribe el
snapshot remoto validado. El refresh comercial adopta ese snapshot antes de
actualizar precio/stock.

### Resultado del primer scan

| Métrica | Resultado |
| --- | ---: |
| Apariciones de fuente | 1.713 |
| Grupos canónicos | 1.556 |
| Catálogo visible anterior | 864 |
| Altas visibles | 595 |
| Catálogo visible final | 1.459 |
| Bajas confirmadas | 0 |
| Pendientes positivos/negativos | 0 / 0 |

Las 595 altas no provienen de duplicar la vista transversal:

- 476 aparecen sólo en `Productos Saludables`;
- 39 aparecen también en una fuente de marca y quedaron fusionadas en una ficha;
- 80 aparecen sólo en fuentes de marca;
- 515 de las altas tienen membresía Saludables;
- el catálogo completo tiene 1.302 fichas con una membresía y 157 con dos;
- ninguna ficha tiene más de dos membresías.

En el ciclo vigente, las 1.713 apariciones vuelven a producir 1.556 grupos,
1.459 visibles y 97 exclusiones. El scan correctivo informó `positive=0`,
`negative=0` y ambos pendientes en cero.

### Auditoría de duplicados

Sobre las 1.459 fichas productivas:

| Identidad | Grupos duplicados |
| --- | ---: |
| SKU privado | 0 |
| `publicId` | 0 |
| URL fuente normalizada | 0 |
| Imagen origen | 0 |
| Barcode | 2 grupos / 4 fichas |
| Título exacto + marca | 5 grupos / 10 fichas |

Los títulos coincidentes conservan SKU e imagen distintos. Cuatro grupos son
variantes comprobables por tono, tipo de piel, presentación o barcode. Queda una
pareja Dermaglós probablemente vieja/nueva: mismo título y barcode, una sin
stock y otra disponible. Ambas siguen expuestas por la fuente con SKU distinto;
no se eliminó automáticamente porque el contrato exige evidencia o exclusión
explícita.

## 6. `Productos Saludables` y marcas reales

`Productos Saludables` es una vista transversal (`kind=collection`), nunca una
marca. Puede solaparse con cualquier fuente sin crear otra ficha; la unicidad
canónica se mantiene por SKU.

El primer snapshot vivo reveló 36 fichas heredadas que aún usaban el nombre de
la colección como marca. La corrección:

- extrae `Marca` de la tabla técnica de la PDP GPSFarma;
- repara fichas heredadas sin cambiar su SKU ni `publicId`;
- canoniza alias como `VitaminWay` a `Vitamin Way`;
- preserva `Bagó` y `Bagó +` como marcas diferentes;
- aborta si alguna ficha intenta volver a publicar la colección como marca.

Resultado vigente: 140 marcas reales, 0 `Productos Saludables` como marca y
664 membresías en la vista transversal.

## 7. Búsqueda, necesidades y Magento

### Búsqueda viva

- busca por nombre, marca real, necesidad, barcode, categoría Magento e ID;
- conserva semántica AND y ranking determinista por intención;
- tolera tildes, raíces, sinónimos de dominio y errores razonables;
- prioriza función/tipo de producto antes que descuento;
- reindexa aliases y evidencia en cada scan semanal;
- una prueba E2E calcula sus expectativas desde el catálogo vivo, no desde
  conteos congelados.

### Necesidades vivas

Cada scan reconstruye `primaryCategory`, `needs`, aliases y auditoría desde
nombre, marca real, categorías Magento y vistas. El snapshot vigente tiene 0
fichas sin necesidad.

El scan del 26/8 eliminó aliases taxonómicos históricos del conjunto de
evidencia antes de inferir necesidades. Eran términos genéricos heredados de
`Productos Saludables` (`vitaminas`, `suplementos`, etc.) y hacían que algunas
fichas dermocosméticas entraran en `Nutrición`. Resultado remoto verificado:

- `Nutrición`: 606 -> 569 fichas;
- el sérum Eucerin Vitamin C señalado quedó `rostro`, con `hidratacion` y
  `antiedad`;
- el protector Dermaglós FPS50 señalado quedó `solares`;
- auditoría de categorías dermo/solar dentro de `Nutrición`: 0 sospechosos.

### Magento

- extracción GraphQL pura hasta `level <= 7`;
- identidad por `publicId`, SKU, barcode y URL privada;
- categorías y paths embebidos en el snapshot semanal;
- el snapshot vivo embebido tiene prioridad sobre el artefacto local de
  contingencia;
- el archivo local sólo completa el arranque si todavía no existe snapshot sano;
- una contradicción de identidad sin taxonomía embebida continúa abortando.

Esta prioridad evitó que una URL migrada quedara bloqueada por la taxonomía de
864 productos anterior al scan.

## 8. Exclusiones y privacidad

Reglas vigentes:

- ocultamiento permitido: `Discontinuado` o identidad privada incluida en la
  lista de exclusiones;
- la lista local contiene 96 registros detallados y un barcode auxiliar;
- las exclusiones se aplican después de todas las fuentes y antes de publicar;
- SKU, URL fuente, proveedor y detalle de extracción permanecen privados;
- barcode es público, visible y buscable;
- una ausencia de listing nunca equivale por sí sola a falta de stock;
- 0 `unverified` es gate de activación.

Archivos privados ignorados por Git:

```text
data/catalog-v69.json
data/catalog-exclusions-v69.local.json
data/catalog-taxonomy-v69.local.json
```

No copiar sus SKU/URLs a issues, commits, handoffs o logs públicos.

## 9. Imágenes y assets inmutables

- originales y derivados AVIF/WebP de 320, 640 y 1000 px viven en GCS;
- tarjeta y PDP usan `picture`, dimensiones intrínsecas y `object-fit: contain`;
- ninguna ficha productiva queda sin card/detail responsiva;
- el Job sólo puede crear objetos; un asset existente se reutiliza;
- el snapshot no se guarda hasta terminar imágenes y taxonomía.

Los assets inmutables vigentes son `app-v6-9-11.js?v=20260826-2`,
`styles-v6-9-2.css?v=20260826-1` y `admin-v69-3.js?v=20260826-3`. Cada cambio de
JavaScript usa una URL nueva para impedir que Firebase/Chrome retengan una
versión anterior.

## 10. Navegación y visual desplegado

- `/` y `/catalogo` muestran el catálogo vigente;
- `/p/{publicId}` es la PDP corta estable;
- cinco columnas desktop y dos móvil;
- 48 productos por carga;
- orden inicial `Relevancia`;
- opciones: relevancia, marca, disponibilidad, `Sin stock`, descuento, precio
  ascendente, precio descendente y nombre;
- `Sin stock` filtra sólo los 232 productos para consultar; es temporal, no es
  el orden inicial y puede ocultarse desde el panel sin deploy;
- `Marca`, `Necesidad` y `Ordenar por` emiten eventos al abrir/seleccionar;
- marca, necesidad, búsqueda y vista transversal se normalizan de forma
  mutuamente consistente;
- la URL `?view=productos-saludables` conserva el parámetro, muestra 48 de 664 y
  sólo renderiza miembros de la colección;
- el tile del menú muestra `Productos Saludables` y `hasta 50%`, sin cantidad ni
  la palabra `paraguas`;
- el target `3337875694469` abre PDP 200 con barcode, disponibilidad e imagen;
- no hay overflow horizontal en 320, 390 ni desktop.

### Panel integral

- ruta productiva `/admin-v6-9`, dentro del mismo servicio Cloud Run;
- acceso Google limitado por allowlist; la API anónima responde 401;
- cuatro secciones: Estado, Navegación, Reglas EAN y Operaciones;
- permite curar marcas, paraguas, orden inicial, opción temporal `Sin stock`,
  listas de inclusión/exclusión EAN y exclusiones reversibles por marca;
- `Deshabilitar` una marca técnica elimina sus productos de catálogo, búsqueda,
  necesidades, PDP, sitemap y conteos; `Rehabilitar` los restaura. Ninguna marca
  queda excluida automáticamente ni por tener pocos SKU;
- guarda configuración, memoria, snapshots y rollback en GCS;
- puede lanzar refresh comercial o el Job semanal con IAM mínimo;
- no edita precios, stock, colores, código, analítica o usuarios y no despliega;
- Codex Agent Manager registró el recibo post-deploy `8c14622`, build
  `8a5005a9-d72b-4543-9a1c-938e3dce6544`, revisión
  `farmagreen-v69-preprod-brandx-20260826`, `healthy=true`.

El zócalo comercial fijo para PDP móvil sigue siendo un concepto pendiente. No
se implementó. Conserva como referencia dos líneas azules `#1557FF` de 6 px,
CTA WhatsApp verde y respeto de safe area; requiere nueva autorización.

## 11. Medición digital y cuentas correctas

### Identificadores

| Plataforma | Cuenta/propiedad correcta | ID |
| --- | --- | --- |
| Meta Business | FarmaGreen | `985275581947783` |
| Meta Ads | Instagram Negocio Nueva Cuenta | `1092979807764139` |
| Meta dataset/pixel | V6.9 | `1198250568817946` |
| Google Analytics 4 | FarmaGreen Rosario | `G-SL7GG138WV` |
| Google Ads | CID `734-953-2701` | `AW-18405204387` |
| Google tag asociado | FarmaGreen Rosario | `GT-NS4BV48V` |

No usar:

- Meta Ads `512774379638492`;
- Google Ads `AW-800809075`;
- cuenta cerrada `708-543-4134`;
- snippets de compra: V6.9 no tiene checkout ni evento `Purchase`.

### Eventos desplegados

| Acción | Meta browser/CAPI | GA4/Google |
| --- | --- | --- |
| Carga | `PageView` | `page_view` |
| PDP | `ViewContent` | `view_item` |
| Búsqueda | `Search` | `search` |
| WhatsApp general | `Contact` | `generate_lead` (`lead_type=general`) |
| WhatsApp de producto | `Contact` + `Lead` | `generate_lead` (`lead_type=product`) |
| Abrir filtro/orden | `CatalogFilterOpen` | `filter_open` |
| Seleccionar filtro/orden | `CatalogFilterSelect` | `filter_select` |

Pixel y CAPI comparten `event_id`. CAPI limita evento/body/origen y no envía
email ni teléfono. La prueba de navegador verificó `dataLayer`, carga de Google,
Pixel y respuesta same-origin; la aparición final en dashboards puede demorar y
debe distinguirse del transporte aceptado.

No existe evidencia contemporánea en este handoff de que Linktree/Maps o la
vinculación externa GA4–Maps hayan quedado guardados. Tratarlos como pendientes.

## 12. Cambios técnicos desde el corte anterior

| Commit | Resultado |
| --- | --- |
| `23042d3` | Activa Google Ads `AW-18405204387`. |
| `e3b62dd` | Cuenta todo clic WhatsApp como `generate_lead` en Google. |
| `e35179e` | Agrega discovery semanal, vistas vivas y reconciliación completa. |
| `cd22b63` | Repara marcas heredadas y versiona el asset cliente. |
| `53a3ef3` | Da prioridad a taxonomía viva embebida sobre fallback local. |
| `bfa1ef2` | Hace que el E2E derive conteos desde el catálogo actual. |
| `880d213` | Agrega navegación curada, panel integral, reglas EAN y memoria operativa. |
| `fe1d8c8` | Evita duplicar marcas legacy entre las técnicas detectadas. |
| `1c0d820` | Versiona el asset del panel para respetar cache inmutable. |
| `5fb3532` | Agrega `Sin stock` temporal y endurece la evidencia viva de Nutrición. |
| `f2826b7` | Simplifica el tile de Productos Saludables conservando el mejor descuento. |
| `8c14622` | Agrega exclusión y rehabilitación reversible de marcas completas. |

El release final se construyó desde `8c14622`.

## 13. Verificación contemporánea

Gate local:

```bash
npm run verify:v69
```

Resultado:

- build TypeScript/CSS: aprobado;
- lógica/contratos: 104/104;
- sync/GCP/post-deploy: 42/42;
- E2E: 2/2;
- total: 148/148, 0 fallas;
- `git diff --check`: limpio;
- TruffleHog: limpio;
- autoreview: sin hallazgos aceptados/accionables.

Verificación remota:

- candidata a 0% validada antes de promover;
- E2E completo contra candidata: verde;
- E2E completo contra <https://farmagreenrosario.web.app>: verde;
- health/API, raíz, catálogo, búsqueda por barcode, vista Saludables, PDP,
  robots y sitemap: HTTP 200;
- asset público nuevo con hash idéntico al local;
- servicio web: 1 CPU, 512 MiB, timeout 900 s;
- revisión final al 100% y revisiones fallidas/intermedias al 0%.
- autenticación Google real comprobada con la cuenta permitida;
- recibo post-deploy persistido en GCS y visible en Memoria operativa después
  del TTL de lectura de 30 segundos;
- ejecución `farmagreen-v69-weekly-discovery-mqdfl` completada con `exit(0)` y
  snapshot vivo adoptado por producción.

Una primera candidata detectó el conflicto de taxonomía y nunca recibió
tráfico. No presentar una revisión `Ready` como release sin pasar health, datos
y navegador sobre su URL etiquetada.

## 14. Archivos canónicos

| Responsabilidad | Archivo |
| --- | --- |
| Servidor, rutas, assets y headers | `src/server.ts`, `src/server-v69.ts` |
| SSR, DTO, catálogo y PDP | `src/render-v69.ts` |
| Datos, exclusiones y precedencia Magento | `src/data-v69.ts` |
| Runtime, GCS y last-known-good | `src/commerce-runtime-v69.ts` |
| Cliente, búsqueda, vistas y filtros | `public/app-v6-9.js` |
| Panel y política pública | `public/admin-v69.js`, `src/catalog-admin-v69.ts`, `src/catalog-admin-http-v69.ts`, `src/catalog-policy-v69.ts` |
| Medición Google | `public/analytics-v69.js` |
| Meta Pixel/CAPI cliente | `public/meta-pixel-v69.js` |
| Sync comercial | `scripts/sync-catalog-commerce-v69.mjs` |
| Discovery semanal | `scripts/scan-catalog-v69.mjs`, `src/catalog-discovery-job-v69.ts` |
| Construcción de fichas/marcas | `scripts/build-local-v7-beta.mjs` |
| Magento | `scripts/extract-magento-taxonomy-v69.mjs`, `src/magento-taxonomy-v69.ts` |
| Imágenes GCP | `scripts/prepare-gcp-catalog-v69.mjs` |
| Build/deploy | `Dockerfile.v69-preprod`, `cloudbuild-v69-preprod.yaml`, `firebase-v69.json` |
| Pruebas | `tests/v69-*` |

## 15. Comandos seguros para retomar

```bash
cd "/Users/danielbernardes/Documents/New project/.worktrees/eucerin-catalogo-v69-local"
git status --short --branch
git log -5 --oneline --decorate
git rev-list --left-right --count HEAD...origin/codex/v69-stock-ordering
curl -fsS https://farmagreenrosario.web.app/api/catalog-v6-9/health | jq .
curl -fsS https://farmagreenrosario.web.app/api/catalog-v6-9 \
  | jq '{totalProducts,commerceSyncedAt,availabilitySummary}'
npm run verify:v69
```

Auditoría semanal local sin escritura:

```bash
npm run scan:data:v69
```

Cloud read-only:

```bash
gcloud run services describe farmagreen-v69-preprod \
  --project=project-e2a7bc6d-e741-4d4e-85d \
  --region=southamerica-east1
gcloud run jobs describe farmagreen-v69-weekly-discovery \
  --project=project-e2a7bc6d-e741-4d4e-85d \
  --region=southamerica-east1
gcloud scheduler jobs describe fg-v69-weekly-discovery \
  --project=project-e2a7bc6d-e741-4d4e-85d \
  --location=southamerica-east1
```

## 16. Pendientes reales

1. Decidir si la pareja Dermaglós vieja/nueva debe excluirse por SKU/URL privada;
   no usar el barcode compartido para ocultar ambas accidentalmente.
2. Verificar en las interfaces externas la vinculación GA4–Google Ads/Maps y el
   estado de Linktree/Google Maps antes de documentarlos como completados.
3. Evaluar el zócalo móvil conceptual sólo con nueva autorización.
4. Observar la primera ejecución automática del lunes a las 04:00 ART. El Job
   directo y su IAM ya fueron validados; el Scheduler aún no tiene intento
   histórico y muestra su próxima ejecución correctamente.
5. Cuando termine la revisión manual de discontinuados, desmarcar `Mostrar “Sin
   stock” en Ordenar` en `/admin-v6-9` y usar `Guardar y publicar`. No requiere
   commit ni deploy y no altera por sí mismo las exclusiones EAN.

## 17. Cierre

V6.9 ya no depende de una foto fija. Producción publica 1.459 productos, 1.227
disponibles, 232 para consultar y 0 sin verificar. `Productos Saludables` es una
vista transversal de 664 fichas; el catálogo conserva SKU canónico único y 140
marcas reales. El scan semanal del lunes 04:00 ART reconstruye altas, bajas,
búsqueda, necesidades, Magento e imágenes; el refresh 07:00/14:00 mantiene el
estado comercial Rosario/STOM. Cloud Run sirve
`farmagreen-v69-preprod-brandx-20260826` al 100%; la imagen del servicio y el
Job semanal corresponde al build `8a5005a9-d72b-4543-9a1c-938e3dce6544`, y los
gates local/remoto quedaron verdes (148/148).
