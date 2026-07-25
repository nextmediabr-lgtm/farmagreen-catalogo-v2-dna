# FarmaGreen Catálogo V6.7 beta

Evolución orgánica del catálogo FarmaGreen sobre el DNA V2. V6.7 se mantiene
aislada de V6.6 y de producción.

Inspiración conceptual: catálogos comerciales como Disfit, pero adaptado a FarmaGreen: sin carrito, sin checkout, consulta directa por WhatsApp.

## Rutas

- `/catalogo`
- `/producto/:slug`
- `/api/catalog`
- `/catalogo-v6-7/`
- `/producto-v6-7/:slug/`

## Local

```bash
npm install
npm run verify
npm run dev:v67
```

Vista local: `http://127.0.0.1:8099/catalogo-v6-7/`.

## Preview público aislado

`https://farmagreen-v6-7-public-test.vercel.app/catalogo-v6-7/`

El deploy de V6.7 genera primero el Build Output estático de Vercel:

```bash
npm run deploy:vercel:v67:preview
```

No usar este flujo para V6.6 ni para producción. El estado completo y los
controles de continuidad están en
[`FARMAGREEN_CATALOGO_V6_7_HANDOVER_2026-07-23.md`](./FARMAGREEN_CATALOGO_V6_7_HANDOVER_2026-07-23.md).
