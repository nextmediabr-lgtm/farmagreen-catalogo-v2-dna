# FarmaGreen Catálogo V6.9

Catálogo público vigente de FarmaGreen Rosario: <https://farmagreenrosario.web.app/>.
No tiene carrito ni checkout; la conversión comercial es la consulta directa por WhatsApp.

## Rutas productivas

- `/` y `/catalogo`: catálogo;
- `/p/:publicId`: ficha de producto;
- `/api/catalog-v6-9`: catálogo público;
- `/api/catalog-v6-9/health`: salud, frescura y configuración pública;
- `/api/meta-events-v6-9`: receptor same-origin de Meta Conversions API.

## Desarrollo y verificación

```bash
npm ci
npm run verify:v69
npm run dev:v69
```

Vista local: <http://127.0.0.1:8109/>.

## Administración V6.9

La consola integral productiva vive en `/admin-v6-9` dentro de la misma app de
Cloud Run. Tiene cuatro secciones: Estado, Navegación, Reglas EAN y Operaciones.

- limita la navegación a las marcas legacy más `Productos Saludables` como
  paraguas;
- permite seleccionar promociones por marca, con acciones para seleccionar o
  deseleccionar todas; las marcas desmarcadas conservan sus fichas y precio
  regular del snapshot, pero no publican descuentos, ahorro ni 2×1;
- permite deshabilitar y rehabilitar marcas técnicas completas; al publicar,
  sus productos salen o vuelven a catálogo, búsqueda, PDP y sitemap;
- migra y administra inclusión/exclusión por EAN;
- conserva memoria operativa, revisiones y rollback;
- recibe el comprobante post-deploy de Codex Agent Manager;
- no puede editar precio, stock, código, analítica, IAM ni desplegar.

La opción temporal `Sin stock` del selector público muestra sólo los productos
para consultar. Se habilita o retira desde Navegación en el panel, sin deploy y
sin excluir productos automáticamente.

### Resultado de auditoría de promociones, 22 de septiembre de 2026

El HTML de GPSFarma informa `finalPrice` como precio publicado; `oldPrice` es
opcional y aparece cuando hay precio anterior. En V6.9, `offerPrice` es un campo
interno presente incluso sin descuento. En la revisión congelada del 22/9,
si hay badge porcentual sin `oldPrice`, el parser deduce `offerPrice` aplicando el porcentaje a `finalPrice`: ese segundo
importe no estaba observado en la fuente. El snapshot no conserva la procedencia
de cada precio. El 22/9 una sesión GPSFarma nueva permitió consultar fichas de
las seis marcas seleccionadas localmente: Dermaglos, Vitamin Way, ENA, Bagóvit,
Caviahue y Aveno. Las seis muestras tenían `finalPrice` pero no `oldPrice`.
Daniel aceptó temporalmente ese cálculo para esas marcas, no para el resto.

Mitigación local: el backoffice ofrece selección por marca. La política antigua
sigue mostrando todas hasta que se publique una selección explícita; el
borrador local guardado habilita las seis marcas indicadas arriba. Al desmarcar una marca,
el catálogo, la búsqueda, la ficha, la API y los datos estructurados conservan
el SKU con el precio regular guardado en el snapshot, sin factores ni reclamos
promocionales. Ese precio base es una mitigación conservadora, **no una garantía
de coincidir con el `finalPrice` actual** de GPSFarma para cada SKU. `Seleccionar
todas` y `Deseleccionar todas` solo modifican el
borrador del panel hasta pulsar `Guardar y publicar`. Esto **no corrige** la
extracción de origen ni convierte el snapshot en un precio en tiempo real. Los
cron diario y semanal siguen pausados hasta una decisión posterior; publicar el
selector no equivale a reanudarlos.

### Recuperación GPSFarma del 25 de septiembre de 2026

Registro de la validación previa al despliegue. La configuración productiva
descargada para la prueba fue la revisión 12, con seis marcas promocionales,
89 marcas excluidas y 103 EAN excluidos. La publicación autorizada incluye el
candidato validado y la selección de todas las promociones hecha en el panel
local, conservando las demás reglas. Scheduler diario y semanal deben permanecer
pausados, sin cambiar sus horarios. El despliegue efectivo se acredita por la
revisión de Cloud Run y el comprobante de Operaciones del back office, no por
esta sección ni por el resultado de las pruebas locales.

- Se retira el cálculo temporal por badge: sin `oldPrice`, `finalPrice` se
  conserva como único precio. Con ambos importes se calcula el descuento de esa
  pareja, sin volver a aplicarlo sobre el precio final. Se ignoran importes sin
  impuestos y precios anteriores identificados como pertenecientes a otro producto.
- Cada precio de la actualización diaria conserva evidencia privada en `source.pricingEvidence`:
  precio actual, anterior si existe, tipo de evidencia y fecha de observación.
  Un listado sin precio actual se verifica por ficha directa; no se declara
  actualizado usando sólo el importe anterior.
- El 2×1 conserva la regla de paquete: precio unitario publicado, dos unidades
  por ese importe y ahorro equivalente a una unidad. No se anuncia un precio
  individual rebajado que exija comprar dos.
- El diario busca URLs alternativas por SKU/EAN en todas las fuentes ya
  recorridas y exige confirmar identidad en la ficha. Sólo reconcilia una baja
  si el producto con identidad conocida está ausente de los listados completos
  y sus URLs devuelven 404/410. Un producto aún listado, una identidad ambigua,
  un 403/429/5xx o un fallo de red bloquean la publicación.
- Las bajas diarias quedan registradas en `commerceSync.removedPublicIds` y
  `metrics.permanentMissing`. Continúan vigentes la validación completa, el
  control de caída de productos/precios y la publicación condicional con respaldo.

La evidencia de esta ejecución queda local en
`.codex-artifacts/recovery-20260925/`: candidato, respuestas de origen,
comparación contra producción y reporte. No contiene un permiso de publicación.

Resultado local: 16/16 fuentes, 1.468 fichas canónicas y 1.208 públicas con la
política 12; 1.005 disponibles, 203 para consultar y 0 sin verificar. Se detectó
una baja permanente (`3e07cdf4103e`, Magnesio sport x 30 cápsulas). El origen
aporta 354 pares de precios con descuento y un 2×1; la selección administrativa
publica 167 ofertas y ninguna de Eucerin. Las muestras de ficha/listado coinciden.
Después, por pedido del operador, se utilizó la interfaz del back office local
para seleccionar todas las promociones y guardar la revisión local 13: 15/15
marcas, 317 descuentos y un 2×1 (318 promociones en total), sin cambiar las 89
marcas excluidas ni los 103 EAN excluidos. Eucerin y Productos Saludables vuelven
a mostrar sus ofertas verificadas en esta vista previa. Para trasladar esa
selección a producción sólo se cambia `navigation.promotionBrandSlugs` mediante
publicación condicional; no se reemplaza el documento local completo ni la
memoria productiva. Los cron permanecen pausados.
Build + 130 pruebas de lógica + 61 de sync/GCP + 4 E2E: 195/195 verdes.

Configuración: [`.env.example`](./.env.example). Los valores reales permanecen
fuera de Git. En desarrollo puede usarse un token local efímero:

```bash
V69_ADMIN_LOCAL_TOKEN=admin-local \
V69_ADMIN_CONFIG_FILE=/tmp/farmagreen-v69-admin.json \
npm run dev:v69
```

Después de un deploy verificado, Codex Agent Manager registra el resultado con:

```bash
V69_AGENT_MANAGER_TOKEN=... npm run record:deploy:v69 -- \
  --origin=https://farmagreenrosario.web.app \
  --commit=<sha> --build=<build-id> --revision=<cloud-run-revision> \
  --products=<total> --healthy=true --verified-at=<iso-8601>
```

## Fiabilidad: candidato local del 19 de septiembre de 2026

Implementación local; esta sección **no acredita un deploy**. No modifica las
exclusiones, STOM, horarios, CPU, memoria ni mínimo de instancias.

- El snapshot de fiabilidad preparado el 19/9 no deducía descuentos a partir de
  badges. La revisión productiva temporal del 22/9 sí conserva el cálculo por
  badge y el selector administrativo limita cuáles se muestran al público.
- Diario y semanal usan el mismo control de publicación: identidad, precios,
  disponibilidad, exclusiones, taxonomía e imágenes, incluyendo JPEG 320/640
  (o ancho real si el original es menor; no se amplían imágenes).
- Preparar/validar no modifica el catálogo activo. GCS archiva la generación
  anterior en `<objeto>.history/` y publica con `ifGenerationMatch`; recién
  entonces se activa el candidato en memoria. Un conflicto conserva el activo.
- Cada instancia comprueba la generación como máximo una vez por 30 segundos,
  con tráfico entrante; sólo descarga el snapshot si cambió. Un arranque fallido
  puede reintentarse después de 5 segundos, sin reiniciar el proceso.
- Al iniciar se intenta snapshot, respaldo anterior y finalmente respaldo
  empaquetado. Se sigue aplicando la política administrativa vigente: nunca se
  reemplaza una política inaccesible por una política permisiva de emergencia.
- Los errores incluyen fase, ejecución, revisión de código y causa saneada en
  logs JSON privados. Health sólo expone identificación/estado, no la causa.
  Conflictos/errores transitorios responden 503; rechazo de datos, 422.
- Un rechazo determinista guarda recibo en `<objeto>.rejected/`, evitando repetir
  el crawl del mismo horario/ejecución. Si ya existe candidato, queda separado
  en `<objeto>.candidates/<sha256>.json`, **sin activarlo**. La publicación lleva
  el hash de ejecución, para reconocer un éxito incluso desde otra instancia.
- Caída de productos >30%, pérdida >80% de ofertas (desde al menos 20), o saltos
  de precio >2×/<0,5× en más del 10% (mínimo 6) requieren revisión. La promoción
  manual sólo admite el digest exacto revisado y la generación base observada;
  no evita controles estructurales ni permite fechas anteriores. No existe un
  flag permanente que salte esta revisión para los cron. Un nuevo scan cambia
  el candidato y requiere revisión nueva.
- Con cero ofertas verificadas, SSR y cliente muestran el catálogo y un aviso,
  no una grilla vacía. El cliente usa una URL nueva: `/app-v6-9-13.js`.
- `/api/catalog-v6-9/health` y `/readyz-v69` responden 503 en producción ante
  estado degradado, catálogo vacío/no verificado o antigüedad >36 horas. No usar
  este control de frescura como liveness: reiniciar no repara la fuente.

Verificación local del 19/9: un dry-run real completó las 16 fuentes, los 1.469
productos y 100% de cobertura de precio/stock, con 0 sin verificar. **No encontró
ofertas respaldadas por dos precios explícitos**; el control `offer_drop` lo
detuvo para revisión. No escribió GCS ni modificó los descuentos productivos.
Antes de publicar esa corrección de datos se debe revisar un candidato reciente
y autorizar su promoción exacta; no desactivar el control para hacer pasar el cron.

El operador puede descargar el candidato privado y ejecutar
`npm run review:candidate:v69 -- --input=<candidato.json>` con las variables GCS
y credenciales de operador configuradas. Es sólo lectura por defecto. Después de
revisión y autorización explícita, `--apply --approve-sha256=<digest-revisado>
--expected-generation=<generación-revisada>` publica ese mismo archivo mediante
CAS y conserva respaldo; no vuelve a recorrer la fuente ni acepta otro candidato.

### Control previo y posterior a un deploy autorizado

```bash
npm run verify:v69
npm run verify:fallback:v69 -- --from-gcs=gs://<bucket-v69>/<snapshot-v69>
docker build -f Dockerfile.v69-preprod --build-arg V69_CODE_REVISION=<sha> -t <imagen-local> .
```

El segundo comando sólo **lee** GCS y genera `data/catalog-v69-fallback.json`,
privado e ignorado por Git. La imagen incluye ese respaldo, validado con los
mismos controles productivos y no mayor a 36 horas al construir. El build
ejecuta compilación, pruebas unitarias/sync y el control del respaldo; la suite
completa local agrega navegador real. Cloud Build exige `_CODE_REVISION` con el
SHA completo. La imagen no incluye credenciales.

Para una publicación excepcional con catálogo congelado y ambos Scheduler
`PAUSED`, Cloud Build admite `_ALLOW_STALE_FALLBACK=1`. Sólo omite el límite de
36 horas al **empaquetar** un snapshot ya validado; por defecto vale `0`. No
actualiza precios, no escribe GCS y no cambia el control de frescura de
`/api/catalog-v6-9/health`, que continuará devolviendo 503 mientras el snapshot
esté vencido. Esta excepción no autoriza ejecutar ni reanudar los cron.

Tras autorizar deploy: actualizar servicio y Job al **mismo digest**, mantener
recursos/horarios, ejecutar un canary acotado diario y uno semanal y comprobar
su terminación. No basta con que Scheduler acepte el disparo. El control siguiente
es de sólo lectura y rechaza una ejecución antigua o con otra imagen:

```bash
npm run verify:release:v69 -- --commit=<sha-completo> --execution=<ejecucion-semanal-terminada>
```

Verifica revisión con 100% de tráfico, digest web/Job/ejecución, commit observado,
health, home no vacía, DTO, PDP y revisión administrativa. Sólo después corresponde
registrar el comprobante con `record:deploy:v69`. No cambia tráfico ni ejecuta Jobs.

Las plantillas `ops/v69-*.json` preparan uptime público, alerta por rechazo de
sync y alerta por ejecución semanal fallida incluso si no hubo log de aplicación.
**No están creadas ni activadas en GCP**: necesitan autorización, canal de aviso
confirmado e ID del uptime check. Los prefijos de historia/candidatos son privados;
su retención/lifecycle requiere decisión explícita (no se cambió la del bucket).
Contratos: [escritura condicional GCS](https://docs.cloud.google.com/storage/docs/request-preconditions),
[uptime](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.uptimeCheckConfigs),
[políticas de alerta](https://docs.cloud.google.com/monitoring/alerts/policies-in-json).

## Estado y continuidad: referencia histórica de agosto de 2026

Los conteos siguientes documentan aquel despliegue, no el inventario vivo actual;
consultar `/api/catalog-v6-9/health` para cifras públicas vigentes.

El snapshot productivo conserva 1.459 fichas canónicas. La política dinámica
vigente publica 1.183: 1.012 disponibles, 171 para consultar y 0 sin verificar,
después de exclusiones reversibles por marca y EAN. Meta Pixel/CAPI, GA4 y la
etiqueta Google Ads correcta `AW-18405204387` están desplegados.

La entrada pública conserva 48 fichas SSR sin descargar el DTO completo. El
catálogo se hidrata una sola vez al buscar, filtrar, ordenar o cargar más;
Google/Meta se inician después de `load` en idle o con la primera interacción.
JS/CSS se sirven versionados con Brotli/gzip y Cloud Run reutiliza HTML/DTO
codificados por snapshot y revisión de política.

El snapshot canónico tiene 2.918 sets JPEG 320/640 y la política pública expone
2.366. En la primera muestra de nueve tarjetas, Safari antiguo reduce 84% la
transferencia a 320 px y 55% a 640 px frente a los originales.

Las notas EAN son opcionales. Guardar una política idéntica no crea una revisión
ni memoria falsa.

La disponibilidad/precio se actualiza todos los días a las 07:00 y 14:00 ART.
El catálogo completo se reconcilia los lunes a las 04:00 ART: detecta altas y
bajas conservadoras, reconstruye búsqueda/necesidades/taxonomía y sólo activa
un snapshot completo. `Productos Saludables` es una vista transversal de 664
productos, no una marca.

El reindexado vivo descarta aliases taxonómicos históricos antes de reconstruir
necesidades. El snapshot vigente contiene 569 fichas de Nutrición y la política
pública expone 356; ya no incluye dermocosmética por herencia del paraguas.

```bash
npm run scan:data:v69       # auditoría local, no escribe
npm run scan:data:v69:apply # aplica localmente; requiere autorización y entorno GCP
```

Backfill JPEG reproducible, sólo local y sin publicación automática:

```bash
npm run backfill:jpeg:v69 -- \
  --input=<snapshot.json> --output=<candidate.json> --store-dir=<jpeg-dir> \
  --image-bucket=<bucket> --image-prefix=v69/catalog-images
```

El estado operativo, contratos, cuentas correctas, cambios, verificación y límites
de publicación están en
[`FARMAGREEN_CATALOGO_V6_9_HANDOFF_2026-08-13.md`](./FARMAGREEN_CATALOGO_V6_9_HANDOFF_2026-08-13.md).

## Versiones históricas

- [V6.7 beta](./FARMAGREEN_CATALOGO_V6_7_HANDOVER_2026-07-23.md)
- [V6.8](./FARMAGREEN_CATALOGO_V6_8_HANDOVER_2026-07-25.md)
- [V6.9 — corte 3/8](./FARMAGREEN_CATALOGO_V6_9_ESTADO_2026-08-03.md)
- [V6.9 — handoff 4/8](./FARMAGREEN_CATALOGO_V6_9_HANDOFF_2026-08-04.md)
