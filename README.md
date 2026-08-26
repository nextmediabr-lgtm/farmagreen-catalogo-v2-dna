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

Vista local: <http://127.0.0.1:8099/>.

## Administración V6.9

La consola integral productiva vive en `/admin-v6-9` dentro de la misma app de
Cloud Run. Tiene cuatro secciones: Estado, Navegación, Reglas EAN y Operaciones.

- limita la navegación a las marcas legacy más `Productos Saludables` como
  paraguas;
- permite deshabilitar y rehabilitar marcas técnicas completas; al publicar,
  sus productos salen o vuelven a catálogo, búsqueda, PDP y sitemap;
- migra y administra inclusión/exclusión por EAN;
- conserva memoria operativa, revisiones y rollback;
- recibe el comprobante post-deploy de Codex Agent Manager;
- no puede editar precio, stock, código, analítica, IAM ni desplegar.

La opción temporal `Sin stock` del selector público muestra sólo los productos
para consultar. Se habilita o retira desde Navegación en el panel, sin deploy y
sin excluir productos automáticamente.

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

## Estado y continuidad

El snapshot productivo conserva 1.459 fichas canónicas. La política dinámica
vigente publica 1.285: 1.097 disponibles, 188 para consultar y 0 sin verificar,
después de exclusiones reversibles por marca y EAN. Meta Pixel/CAPI, GA4 y la
etiqueta Google Ads correcta `AW-18405204387` están desplegados.

Las notas EAN son opcionales. Guardar una política idéntica no crea una revisión
ni memoria falsa.

La disponibilidad/precio se actualiza todos los días a las 07:00 y 14:00 ART.
El catálogo completo se reconcilia los lunes a las 04:00 ART: detecta altas y
bajas conservadoras, reconstruye búsqueda/necesidades/taxonomía y sólo activa
un snapshot completo. `Productos Saludables` es una vista transversal de 664
productos, no una marca.

El reindexado vivo descarta aliases taxonómicos históricos antes de reconstruir
necesidades. En el snapshot vigente, `Nutrición` contiene 569 productos y ya no
incluye dermocosmética por herencia del paraguas.

```bash
npm run scan:data:v69       # auditoría local, no escribe
npm run scan:data:v69:apply # aplica localmente; requiere autorización y entorno GCP
```

El estado operativo, contratos, cuentas correctas, cambios, verificación y límites
de publicación están en
[`FARMAGREEN_CATALOGO_V6_9_HANDOFF_2026-08-13.md`](./FARMAGREEN_CATALOGO_V6_9_HANDOFF_2026-08-13.md).

## Versiones históricas

- [V6.7 beta](./FARMAGREEN_CATALOGO_V6_7_HANDOVER_2026-07-23.md)
- [V6.8](./FARMAGREEN_CATALOGO_V6_8_HANDOVER_2026-07-25.md)
- [V6.9 — corte 3/8](./FARMAGREEN_CATALOGO_V6_9_ESTADO_2026-08-03.md)
- [V6.9 — handoff 4/8](./FARMAGREEN_CATALOGO_V6_9_HANDOFF_2026-08-04.md)
