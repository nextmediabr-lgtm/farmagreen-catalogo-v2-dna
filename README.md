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

## Estado y continuidad

Producción publica 1.459 productos: 1.227 disponibles, 232 para consultar y
0 sin verificar. Meta Pixel/CAPI, GA4 y la etiqueta Google Ads correcta
`AW-18405204387` están desplegados.

La disponibilidad/precio se actualiza todos los días a las 07:00 y 14:00 ART.
El catálogo completo se reconcilia los lunes a las 04:00 ART: detecta altas y
bajas conservadoras, reconstruye búsqueda/necesidades/taxonomía y sólo activa
un snapshot completo. `Productos Saludables` es una vista transversal de 664
productos, no una marca.

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
