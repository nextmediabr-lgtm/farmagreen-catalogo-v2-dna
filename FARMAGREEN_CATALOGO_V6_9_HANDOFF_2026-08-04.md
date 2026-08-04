# FarmaGreen Catálogo V6.9 — handoff completo

Fecha de corte: 4 de agosto de 2026  
Estado: V6.9 completa, desplegada y operativa en el dominio oficial. Este documento registra el estado comprobado y sirve como punto de entrada para una nueva sesión. No autoriza por sí mismo commits, pushes, despliegues ni cambios de infraestructura.

## Resumen ejecutivo

| Área | Estado comprobado |
| --- | --- |
| URL oficial | <https://farmagreenrosario.web.app/> |
| Aplicación | V6.9, SSR/API en Cloud Run |
| Entrada pública | Firebase Hosting/CDN con rewrite a Cloud Run |
| Productos visibles | 666 |
| Snapshot fuente activo | 685 productos antes de exclusiones |
| Exclusiones aplicadas | 19 discontinuados ocultos |
| Disponibilidad pública | 517 disponibles, 149 para consultar, 0 sin verificar |
| Inventario | Rosario, depósito STOM exclusivamente |
| Última sincronización comercial | 4/8/2026 18:44 ART (`2026-08-04T21:44:39.986Z`) |
| Imágenes | Google Cloud Storage; sin puentes al proveedor |
| Rama local | `codex/v69-stock-ordering` |
| HEAD local | `1b2f6f0dcb015a88afb1e202ad1c8a0f0a3930c3` |
| Revisión desplegada | `farmagreen-v69-preprod-00012-qc9`, 100% del tráfico |

La diferencia entre 685 y 666 es intencional: 685 es el snapshot comercial válido; 666 es el catálogo que se publica después de aplicar la única razón de ocultamiento aceptada, `Discontinuado`.

## Arquitectura vigente

```text
Usuario
  -> farmagreenrosario.web.app
  -> Firebase Hosting (dominio, CDN, cache y rewrite)
  -> Cloud Run (SSR, API, búsqueda, PDP y rutas cortas)
  -> Google Cloud Storage (snapshot comercial e imágenes)

Cloud Scheduler
  -> POST privado con OIDC
  -> refresh comercial Rosario / STOM
  -> validaciones de identidad, precio, stock y exclusiones
  -> activación atómica del nuevo snapshot
  -> last-known-good ante fallas
```

Identificadores operativos actuales:

- proyecto GCP: `project-e2a7bc6d-e741-4d4e-85d`;
- servicio Cloud Run: `farmagreen-v69-preprod`;
- región: `southamerica-east1`;
- scheduler: `fg-v69-preprod-sync-0700-art`.

Firebase no conserva una segunda home ni ejecuta rutas cortas: reescribe hacia Cloud Run. V2 permanece aislada para rollback, pero no es la aplicación servida por la URL oficial.

## Rutas públicas

| Ruta | Función |
| --- | --- |
| `/` | Home definitiva con marcas apiladas |
| `/catalogo` | Catálogo, buscador, filtros y ordenamiento |
| `/p/{publicId}` | PDP con URL corta estable |
| `/api/catalog-v6-9` | DTO público del catálogo visible |
| `/api/catalog-v6-9/health` | Salud y frescura comercial |
| `/robots.txt` | Robots público, HTTP 200 |
| `/sitemap.xml` | Home, catálogo y todas las PDP visibles, HTTP 200 |

El sitemap comprobado contiene 668 URLs: 666 productos, home y catálogo.

## Contratos funcionales que no deben romperse

### Navegación y layout

- La URL raíz abre la home de marcas apiladas.
- El logotipo vuelve siempre a esa home.
- En PDP, `Volver` usa el historial y regresa a la página anterior.
- La grilla es de cinco tarjetas en desktop y dos en móvil.
- Cada carga incorpora 48 productos y conserva `Cargar más productos`.
- El layout aprobado debe conservar anchos, separación horizontal/vertical y bordes visibles.
- El footer incluye identidad local, WhatsApp e Instagram oficial.

### Búsqueda

- Busca por producto, marca, necesidad y código de barras.
- Mantiene semántica AND entre palabras útiles.
- Tolera tildes, stopwords, raíces y errores ortográficos razonables.
- Activa coincidencias desde tres caracteres útiles sin crear reglas a medida para frases concretas.
- Casos cubiertos: `Vichi`/`Vichg`, cara/rostro, seco/reseco, crema/loción, serum/suero, arrugas/líneas de expresión, raíces `hidra` y `faci`, y búsqueda por barcode.
- Marca y necesidad no se combinan: seleccionar una limpia la otra.

### Disponibilidad y CTA

- Disponible: `Disponible para Entrega`, CTA verde.
- Sin stock explícito: `Consultar Disponibilidad`, CTA amarillo `#FFD101` con texto blanco.
- Nunca inferir “sin stock” por ausencia de información.
- Cero productos `unverified` es requisito de activación.
- La tarjeta, PDP, API y WhatsApp deben usar el mismo estado.

### Datos y privacidad

- `HIDDEN_REASONS_V69 = ["Discontinuado"]` es el único concepto para ocultar productos.
- La lista privada vive en `data/catalog-exclusions-v69.local.json` y puede resolver por SKU privado, barcode, ID o URL interna.
- SKU, proveedor, URLs fuente y detalle de extracción nunca salen en HTML ni DTO público.
- El código de barras sí es público, visible en PDP y buscable.
- El DTO público actual expone únicamente: `publicId`, `slug`, `name`, `brand`, `line`, `primaryCategory`, `needs`, `aliases`, `barcode`, `prices`, `discount`, `availability`, `checkedAt` e `images`.
- Las imágenes públicas están bajo `images.card` e `images.detail`; no usar un campo legado `product.image` para auditarlas.

## Sincronización comercial

Contrato vigente:

- localidad pública: Rosario;
- depósito: `STOM`;
- 11 fuentes comerciales esperadas;
- identidad mínima: 95%;
- precios mínimos: 95%;
- disponibilidad: 100%;
- refresh protegido por OIDC;
- snapshot nuevo sólo se activa si todas las validaciones pasan.

Scheduler verificado:

```text
Estado: ENABLED
Cron: 0 7,14 * * *
Zona: America/Argentina/Buenos_Aires
Método: POST con OIDC
Retry count: 3
Deadline: 1800 s
Último intento observado: 2026-08-04T21:43:52.730917Z
```

El nombre histórico menciona 07:00, pero la expresión actual ejecuta a las 07:00 y 14:00 ART. No inferir el horario por el nombre del job. Cambiarlo requiere decisión explícita de Daniel.

Health público comprobado después del refresh manual:

```json
{
  "version": 6.9,
  "status": "ready",
  "reason": "current",
  "commerceSyncedAt": "2026-08-04T21:44:39.986Z",
  "totalProducts": 666,
  "availabilitySummary": {
    "available": 517,
    "unavailable": 149,
    "unverified": 0
  },
  "runtime": {
    "status": "ready",
    "catalogVersion": 6.9,
    "products": 685,
    "commerceSyncedAt": "2026-08-04T21:44:39.986Z",
    "lastSuccessAt": "2026-08-04T21:44:39.986Z",
    "lastFailureAt": null,
    "syncConfigured": true
  }
}
```

`syncedAt` del catálogo base continúa en `2026-07-25T06:39:05.518Z`; no confundirlo con `commerceSyncedAt`, que representa precio/stock frescos.

## SEO, seguridad y assets

- `/robots.txt` y `/sitemap.xml` responden 200.
- Canonical, Open Graph y JSON-LD son dinámicos por ruta/PDP.
- El sitemap sólo publica productos visibles.
- CSP restringida, sin dominio del proveedor.
- HTML raíz y catálogo son SSR; los enlaces de PDP visibles son crawlables.
- Los cuatro CSS históricos se consolidan en `public/styles-v6-9-1.css`, generado por `scripts/build-v69-css.mjs`.
- Imágenes en GCS, con derivados responsivos y originales conservados.
- Preview social raíz vigente: `Farmacia y Dermocosmetica, Catalogo de Precios y Promociones`.

## Estado Git local: preservar

El worktree no está limpio. No descartar, resetear, reemplazar ni normalizar estos cambios sin inspección:

```text
 M Dockerfile.v69-preprod
 M package-lock.json
 M package.json
 M public/app-v6-9.js
 M public/styles-v6-9.css
 M scripts/prepare-gcp-catalog-v69.mjs
 M src/data-v69.ts
 M src/data.ts
 M src/render-v69.ts
 M src/server-v69.ts
 M src/server.ts
 M tests/v69-gcp-preparation.test.mjs
 M tests/v69-layout.e2e.mjs
 M tests/v69-local.test.ts
?? .gcloudignore
?? FARMAGREEN_CATALOGO_V6_9_ESTADO_2026-08-03.md
?? FARMAGREEN_CATALOGO_V6_9_HANDOFF_2026-08-04.md
?? public/styles-v6-9-1.css
?? scripts/build-v69-css.mjs
?? tests/v69-search-intelligence.test.ts
```

El despliegue público incluye trabajo posterior al commit `1b2f6f0`; HEAD por sí solo no reproduce necesariamente la revisión pública. Antes de cualquier commit, separar con cuidado qué archivos corresponden a V6.9 y cuáles son espejos/compatibilidad.

## Verificación de cierre

Comando ejecutado contra producción:

```bash
V69_E2E_ORIGIN=https://farmagreenrosario.web.app npm run verify:v69
```

Resultados:

- build TypeScript: aprobado;
- suite lógica/contratos: 76/76;
- sincronización y preparación GCP: 25/25;
- total no visual: 101/101;
- E2E live directo: 1/1 aprobado en el reintento.

La corrida agregada tuvo antes un fallo intermitente en el margen lateral móvil (`mobileCardSpacing.left/right >= 2.5`). El reintento directo pasó. No hay evidencia de una rotura pública actual, pero el gate E2E debe estabilizarse antes de declarar una futura entrega completamente determinista.

La suite de búsqueda incluye 24 casos sistemáticos, no reglas especiales para una frase.

## Comandos seguros de diagnóstico

```bash
cd "/Users/danielbernardes/Documents/New project/.worktrees/eucerin-catalogo-v69-local"
git status --short
curl -fsS https://farmagreenrosario.web.app/api/catalog-v6-9/health
curl -fsS https://farmagreenrosario.web.app/robots.txt
curl -fsS https://farmagreenrosario.web.app/sitemap.xml | head
V69_E2E_ORIGIN=https://farmagreenrosario.web.app npm run verify:v69
```

Servidor local:

```bash
npm run dev:v69
```

No ejecutar un refresh, deploy, commit, push, cambio de scheduler, retiro de V2 ni limpieza del worktree sin autorización explícita en el turno actual.

## Fuentes canónicas del código

| Responsabilidad | Archivo |
| --- | --- |
| Servidor, rutas, cache, CSP, SEO y health | `src/server-v69.ts` |
| SSR, home, PDP, DTO y rutas cortas | `src/render-v69.ts` |
| Datos, taxonomía y exclusiones | `src/data-v69.ts` |
| Runtime y last-known-good | `src/commerce-runtime-v69.ts` |
| Sync Rosario/STOM | `scripts/sync-catalog-commerce-v69.mjs` |
| Snapshot e imágenes GCP | `scripts/prepare-gcp-catalog-v69.mjs` |
| Lista privada de discontinuados | `data/catalog-exclusions-v69.local.json` |
| Firebase/CDN | `firebase-v69.json` |
| CSS consolidado | `public/styles-v6-9-1.css` |
| Construcción CSS | `scripts/build-v69-css.mjs` |
| Búsqueda cliente | `public/app-v6-9.js` |
| Contratos | `tests/v69-*.test.*`, `tests/v69-layout.e2e.mjs` |

## Primeros pasos de la nueva sesión

1. Leer este documento completo.
2. Ejecutar `git status --short` y el health público; no asumir que el estado sigue idéntico.
3. Confirmar que la tarea pedida pertenece a V6.9 y no a V2/V6.7/V6.8/V10.
4. Mantener los contratos 5/2, 48 por carga, STOM/Rosario, discontinuados y privacidad SKU.
5. Si se modifica búsqueda, correr todos los casos sistemáticos y comprobar PC/móvil.
6. Si se propone una publicación, presentar primero diff, tests, estado público y rollback; desplegar sólo con aprobación expresa.

## Pendientes reales

1. Estabilizar el E2E de espaciado móvil para eliminar la intermitencia.
2. Resolver explícitamente si el scheduler definitivo queda 07:00 + 14:00 o sólo 07:00 ART.
3. Reconciliar y committear el worktree únicamente cuando Daniel lo autorice.
4. Mantener V2 aislada para rollback hasta que se autorice su retiro.

## Cierre

V6.9 está completa, desplegada y saludable en el dominio oficial. El catálogo público muestra 666 productos después de ocultar exclusivamente los discontinuados; el runtime conserva un snapshot válido de 685. Precio y disponibilidad quedaron sincronizados el 4/8/2026, con 517 disponibles, 149 para consultar y cero sin verificar. La próxima sesión debe continuar desde este estado sin reconstruir la versión ni retroceder a una rama anterior.
