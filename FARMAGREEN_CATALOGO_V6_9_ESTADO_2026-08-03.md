# FarmaGreen Catálogo V6.9 — estado operativo y handover

Fecha de corte: 3 de agosto de 2026  
Estado: V6.9 pública, operativa y conectada al dominio oficial. Este documento registra el estado comprobado; no ejecuta ni autoriza nuevos despliegues.

## Resumen ejecutivo

| Área | Estado verificado |
| --- | --- |
| URL oficial | <https://farmagreenrosario.web.app/> |
| Aplicación | V6.9 servida por Cloud Run |
| Entrada pública | Firebase Hosting como CDN/proxy inverso hacia Cloud Run |
| Catálogo activo | 685 productos |
| Disponibilidad | 527 disponibles, 158 para consultar, 0 sin verificar |
| Inventario | Rosario, depósito STOM exclusivamente |
| Última sincronización observada | 3/8/2026, 19:38 ART |
| Imágenes | Store de Google Cloud; no se sirven desde el proveedor |
| Rama | `codex/v69-stock-ordering` |
| Commit documentado | `1b2f6f0dcb015a88afb1e202ad1c8a0f0a3930c3` |

V6.9 reemplaza la experiencia pública de V2 sin borrar todavía la implementación anterior. La home definitiva es la de marcas apiladas, la URL raíz llega a esa home y el logotipo vuelve siempre a ella.

## Arquitectura vigente

```text
Usuario
  -> farmagreenrosario.web.app
  -> Firebase Hosting (CDN, cache y rewrite)
  -> Cloud Run (SSR, API, rutas cortas y lógica V6.9)
  -> Google Cloud Storage (snapshot comercial e imágenes)

Cloud Scheduler
  -> refresh autenticado con OIDC
  -> sincronización de 11 fuentes comerciales
  -> validación Rosario/STOM + cobertura + disponibilidad
  -> publicación atómica del snapshot
  -> activación sólo si el dataset es válido
```

### Qué hace Firebase y qué no hace

- Firebase no aloja una segunda aplicación ni una home huérfana.
- Su carpeta estática contiene únicamente el archivo de control vacío.
- La regla `**` reescribe todas las rutas hacia el servicio V6.9 de Cloud Run.
- El HTML, API, rutas cortas y lógica de negocio se ejecutan en Cloud Run.
- Los cuerpos comparados entre el dominio público y Cloud Run fueron idénticos en home, catálogo, API, health, producto corto, CSS y JavaScript.
- Firebase sigue formando parte del camino de cada solicitud. Mantener el dominio `web.app` implica conservar esa capa frontal; no funciona como una mera redirección HTTP.

La configuración canónica se encuentra en `firebase-v69.json`. La aplicación HTTP está en `src/server-v69.ts`.

## Rutas públicas

| Ruta | Función |
| --- | --- |
| `/` | Home definitiva con marcas apiladas |
| `/catalogo` | Catálogo completo, filtros, búsqueda y ordenamiento |
| `/p/{id}` | URL corta y estable de producto |
| `/api/catalog-v6-9` | DTO público del catálogo |
| `/api/catalog-v6-9/health` | Salud y vigencia comercial |
| Rutas históricas V6.9 | Compatibilidad con enlaces ya compartidos |

Las rutas cortas y la home no viven como páginas independientes en Firebase: ambas se resuelven en Cloud Run.

## Experiencia de producto

### Home y navegación

- Home de marcas apiladas con dos filas de productos por marca en desktop y dos columnas en móvil.
- Encabezado, buscador y filtros compartidos con el catálogo.
- El logotipo es el acceso permanente a la home.
- En fichas individuales, `Volver` regresa a la página anterior.
- WhatsApp permanece como conversión principal.
- Vista de cinco tarjetas en desktop y dos en móvil.
- Cada carga incorpora 48 productos y conserva el botón `Cargar más productos`.

### Búsqueda, filtros y orden

- Búsqueda por producto, marca, necesidad y código de barras.
- Marca y necesidad son caminos mutuamente excluyentes; no se combinan entre sí.
- Ordenamientos: relevancia, disponibilidad, descuento, precio ascendente, precio descendente y nombre.
- La marca visible es `Aveno`; los enlaces históricos con la variante anterior continúan resolviendo.
- Los productos con FPS se clasifican por intención principal y no se envían automáticamente a solares.

### Disponibilidad y CTA

- Con stock: `Disponible para Entrega` y botón verde.
- Sin stock confirmado: `Consultar Disponibilidad` y botón amarillo `#FFD101`.
- No se infiere falta de stock por ausencia: sólo se publica a partir de señales comerciales explícitas.
- La ficha individual muestra la fecha de verificación comercial.
- La consulta por WhatsApp utiliza el mismo estado que la tarjeta colectiva.

### Ficha individual

- Marca, badge de descuento, nombre, presentación, uso, disponibilidad, precio y detalle.
- Código de barras visible y utilizable en la búsqueda.
- SKU conservado de forma privada; nunca se incorpora al DTO público.
- URL corta compartible por producto.
- Sin enlaces, nombres de origen ni metadatos internos visibles.

## Datos y sincronización

### Contrato de inventario

La sincronización comercial de V6.9 está cerrada a:

- localidad pública: Rosario;
- fuente de inventario: `STOM`;
- conjunto esperado: 11 fuentes comerciales;
- cobertura mínima de identidad: 95%;
- cobertura mínima de precios: 95%;
- disponibilidad verificada: 100%.

El sincronizador rechaza una corrida si la localidad, depósito, fuentes, cobertura o disponibilidad no cumplen el contrato. No agrega productos nuevos por aproximación y conserva el último snapshot válido ante cualquier falla.

### Estados comerciales

| Estado interno | Presentación pública |
| --- | --- |
| Disponible | `Disponible para Entrega` |
| Sin stock explícito | `Consultar Disponibilidad` |
| No verificable | No puede activarse en producción |

El endpoint de salud observado el 3/8/2026 informó:

```json
{
  "version": 6.9,
  "status": "ready",
  "reason": "current",
  "totalProducts": 685,
  "availabilitySummary": {
    "available": 527,
    "unavailable": 158,
    "unverified": 0
  },
  "lastFailureAt": null,
  "syncConfigured": true
}
```

### Horario observado

El scheduler activo se encuentra habilitado para las 07:00 y 14:00, zona `America/Argentina/Buenos_Aires`.

Esto difiere del requisito expresado de una única sincronización diaria a las 07:00 ART. No se modificó en esta pasada documental: queda como decisión operativa pendiente entre conservar el refuerzo de las 14:00 o volver al horario único acordado.

## Exclusiones e identidad privada

- La lista de exclusión se evalúa antes de publicar.
- Puede identificar productos por ID público, SKU privado, código de barras o URL interna.
- El SKU nunca sale del backend ni del snapshot público.
- El código de barras sí es público porque se muestra en la ficha y sirve como búsqueda.
- Los conflictos de identidad abortan la actualización; no se resuelven sobrescribiendo silenciosamente.

La lógica está distribuida entre `src/data-v69.ts`, `scripts/sync-catalog-commerce-v69.mjs` y `scripts/prepare-gcp-catalog-v69.mjs`.

## Seguridad y privacidad pública

- CSP sin `unsafe-inline` y sin permiso para el dominio del proveedor.
- DTO público mínimo: no contiene SKU, URL fuente, proveedor ni detalle de extracción.
- Refresh interno protegido por OIDC, audiencia y cuenta de servicio exactas.
- Imágenes públicas restringidas al Store de Google Cloud.
- Snapshot activado de forma atómica y con last-known-good.
- El servidor degrada el health si la sincronización comercial supera 36 horas.
- No se documentan aquí identificadores de proyecto, bucket, cuenta, teléfono, token ni URL directa de Cloud Run.

## Rendimiento observado

### Transferencia comprimida en rutas principales

| Recurso | Tamaño aproximado |
| --- | ---: |
| Home HTML | 17 KB |
| Catálogo HTML | 11 KB |
| API pública | 71 KB |
| CSS | 19 KB |
| JavaScript | 28 KB |
| Preview social 1200 × 630 | 69 KB |

La home ya no incrusta todo el catálogo: el navegador descarga un boot mínimo y obtiene los productos desde la API cacheable.

### Medianas de navegador, tres rondas

| Vista | Camino | TTFB | Load |
| --- | --- | ---: | ---: |
| Home | Firebase CDN | 66 ms | 518 ms |
| Home | Cloud Run directo | 165 ms | 317 ms |
| Catálogo | Firebase CDN | 54 ms | 506 ms |
| Catálogo | Cloud Run directo | 127 ms | 243 ms |

Interpretación:

- El edge de Firebase mejora el primer byte cuando el documento está en cache.
- La carga completa agrega aproximadamente 200–263 ms frente al acceso directo en la muestra repetible.
- Un MISS con query única llegó a unos 421 ms totales, aproximadamente 250 ms por encima del camino directo.
- No se reprodujo una penalización sostenida de 0,9 segundos.
- La deuda de peso dominante está en las imágenes de productos del Store, no en el HTML ni en una home duplicada.

Comprimir y cachear respuestas no altera la calidad fuente de las imágenes. Una optimización adicional debería generar derivados responsivos WebP/AVIF conservando los originales y pasar control visual antes de activarse.

## Preview social

La URL raíz publica:

- título: `Farmagreen Rosario | Marcas y productos`;
- descripción: `Farmacia y Dermocosmetica, Catalogo de Precios y Promociones`;
- imagen: `farmagreen-social-preview-v69-social-2.png`;
- dimensiones: 1200 × 630.

El preview correcto quedó comprobado en móvil. La tarjeta antigua observada en WhatsApp para Mac correspondía al cache de esa aplicación, no a HTML viejo servido por FarmaGreen.

## Verificación del 3/8/2026

### Resultado reproducido

- Build TypeScript: aprobado.
- Tests unitarios y de contrato: 47/47 aprobados.
- Tests de sincronización y preparación GCP: 24/24 aprobados.
- Health público: `ready`, 685 productos, 0 sin verificar y sin falla registrada.
- Metadata raíz: canonical, Open Graph y preview social correctos.
- Dominio oficial: HTTP 200, sin redirección.

### Excepción de la suite visual

La prueba E2E de layout no quedó verde en esta ejecución:

1. Primera corrida: Playwright intentó desplazar un elemento que había sido reemplazado en el DOM.
2. Reintento aislado: agotó el timeout del test.

No hubo una aserción concreta que demostrara una rotura de columnas, overflow o fuga de datos, y el sitio público continuó respondiendo correctamente. Sin embargo, la verificación automatizada visual actual no es reproducible y debe estabilizarse antes de usarla como gate de una próxima entrega. No debe registrarse esta corrida como “72/72 verde”.

## Comprobaciones operativas

Estado público:

```bash
curl -fsS https://farmagreenrosario.web.app/api/catalog-v6-9/health
```

Cabeceras y cache:

```bash
curl -sS -D - -o /dev/null https://farmagreenrosario.web.app/
```

Verificación local completa:

```bash
npm ci
npm run verify:v69
```

Servidor local:

```bash
npm run dev:v69
```

Luego abrir <http://127.0.0.1:8109/>.

## Pendientes explícitos

1. Decidir si el scheduler queda a las 07:00 y 14:00 o vuelve al requisito único de las 07:00 ART.
2. Estabilizar el test E2E de layout frente al reemplazo dinámico del DOM y volver a ejecutar PC/móvil.
3. Optimizar imágenes de producto con derivados responsivos, sin degradar originales ni alterar la composición aprobada.
4. Mantener V2 aislada y disponible para rollback hasta autorizar expresamente su retiro.
5. Actualizar el README general, que todavía describe versiones anteriores, cuando se cierre el handover definitivo.

## Fuentes canónicas del código

| Responsabilidad | Archivo |
| --- | --- |
| Servidor, rutas, compresión, cache, CSP y health | `src/server-v69.ts` |
| Render SSR, home, DTO público y rutas cortas | `src/render-v69.ts` |
| Catálogo, taxonomía y exclusiones privadas | `src/data-v69.ts` |
| Runtime, last-known-good y refresh | `src/commerce-runtime-v69.ts` |
| Sincronización Rosario/STOM | `scripts/sync-catalog-commerce-v69.mjs` |
| Preparación de snapshot e imágenes GCP | `scripts/prepare-gcp-catalog-v69.mjs` |
| Proxy/CDN del dominio oficial | `firebase-v69.json` |
| Contratos automatizados | `tests/v69-*.test.*`, `tests/v69-layout.e2e.mjs` |

## Cierre

V6.9 está operativa y comercialmente verificada en el dominio oficial. El problema de una home huérfana o una V2 todavía servida por Firebase quedó descartado: Firebase actúa como frente cacheable y Cloud Run es el dueño de la aplicación. El principal pendiente técnico inmediato no es de disponibilidad pública, sino de confianza de release: estabilizar el E2E visual y resolver de forma explícita el horario definitivo del scheduler.
