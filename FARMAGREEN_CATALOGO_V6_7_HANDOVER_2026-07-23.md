# FarmaGreen Catálogo V6.7 — Handover operativo y beta candidate

Fecha de corte: 2026-07-24
Owner local: `/Users/danielbernardes/Documents/New project/eucerin-catalogo-v2-dna`
Superficie: FarmaGreen 1, catálogo público y embudo de consulta por WhatsApp
Sesión de origen indicada por el usuario: `019ee1c9-9b8b-7cf3-846a-3ef72a6f7b4f`
Estado: V6.7 desplegada como beta pública de prueba aislada; V6.6 permanece
intacta.

## Resumen ejecutivo

V6.7 es una versión local separada que parte del ADN visual validado de V6.6,
pero reemplaza su taxonomía ambigua por un catálogo único y determinista.

El estado al cierre es:

- 689 productos únicos;
- 11 marcas;
- ISDIN, Cetaphil y Aveno incorporadas como marcas completas;
- ENA completada y modelada únicamente como marca;
- marca, categoría y necesidad separadas en los datos;
- rutas propias `/catalogo-v6-7/` y `/producto-v6-7/<slug>/`;
- enlaces filtrados mediante query params, sin crear rutas paralelas;
- preview social contextual en el servidor local; preview general en el export
  estático para filtros por query string;
- cinco tarjetas en PC y dos en móvil;
- imágenes originales de GPSFarma, sin el lienzo horizontal artificial;
- fallback visual común ante fallas de imagen;
- exportador estático y proyecto Vercel exclusivos de V6.7;
- acceso público:
  `https://farmagreen-v6-7-public-test.vercel.app/catalogo-v6-7/`;
- `npm run verify`: 18/18 pruebas aprobadas;
- V6.6 pública y sus archivos propios preservados;
- sin cambios en GCP, Firebase, producción real ni aliases de V6.6.

V6.7 está abierta para dry run en PC y móvil. Antes de promoverla fuera de este
proyecto de test todavía debe cerrar retorno a resultados, contrato de
disponibilidad y preview social contextual de filtros en la exportación
estática.

## Regla de continuidad

La próxima sesión debe continuar sobre V6.7. No debe parchear V6.6, reutilizar
su exportador para publicar V6.7 ni iniciar otro rediseño general.

Leer primero:

1. `/Users/danielbernardes/Documents/New project/AGENTS.md`
2. `/Users/danielbernardes/Documents/New project/Codex.md`
3. Este archivo.
4. Los archivos propios de V6.7:
   - `data/catalog-v67.json`
   - `src/render-v67.ts`
   - `public/app-v6-7.js`
   - `tests/v67-local.test.ts`
   - las rutas V6.7 dentro de `src/server.ts`

Objetivo recomendado para la próxima sesión:

> Endurecer V6.7 como beta sin cambiar su arquitectura ni su dirección visual.

## Separación entre versiones

### V6.6

V6.6 sigue siendo la preview pública de referencia:

```text
https://farmagreen-v6-6-public-test.vercel.app/catalogo-v6-6/
```

Estado verificado al cierre:

- acceso anónimo, sin login;
- catálogo HTTP 200;
- fichas HTTP 200;
- cinco columnas PC y dos móvil;
- no se tocó producción real, GCP ni Firebase.

### V6.7

V6.7 conserva su runtime local y tiene una beta pública separada.

Rutas locales:

```text
http://127.0.0.1:8099/catalogo-v6-7/
http://127.0.0.1:8099/producto-v6-7/<slug>/
```

Ruta pública:

```text
https://farmagreen-v6-7-public-test.vercel.app/catalogo-v6-7/
```

El deploy usa `src/export-v67-static.ts`, `dist/vercel-v67`,
`export:vercel:v67` y `deploy:vercel:v67:preview`. El proyecto Vercel es
`farmagreen-v6-7-public-test`; no reemplaza V6.6 ni producción real.

## Cómo iniciar V6.7 local

Desde el owner:

```bash
cd "/Users/danielbernardes/Documents/New project/eucerin-catalogo-v2-dna"
PORT=8099 DEFAULT_ROUTE=/catalogo-v6-7 npm run dev
```

Abrir:

```text
http://127.0.0.1:8099/catalogo-v6-7/
```

Ejemplos de estado compartible:

```text
http://127.0.0.1:8099/catalogo-v6-7/?scope=todo&marca=ISDIN
http://127.0.0.1:8099/catalogo-v6-7/?scope=todo&marca=Cetaphil
http://127.0.0.1:8099/catalogo-v6-7/?scope=todo&marca=Aveno
http://127.0.0.1:8099/catalogo-v6-7/?scope=todo&marca=ENA
http://127.0.0.1:8099/catalogo-v6-7/?scope=todo&need=solares
```

El catálogo se carga una vez y queda cacheado en memoria por
`src/render-v67.ts`. Después de modificar `data/catalog-v67.json`, reiniciar el
servidor para ver los cambios.

## Arquitectura V6.7

```text
data/catalog-v67.json
        |
        v
src/render-v67.ts
  - catálogo y ficha
  - filtros iniciales
  - canonical, Open Graph y JSON-LD
        |
        +----------------------+
        |                      |
        v                      v
public/app-v6-7.js      src/server.ts
  - búsqueda fuzzy       - rutas V6.7
  - URL/query state       - headers noindex
  - marcas/necesidades    - CSP e imágenes externas
  - paginado de 24
        |
        v
styles-v6-5.css + styles-v6-6.css
  - ADN visual reutilizado
  - cinco columnas PC
  - dos columnas móvil
        |
        v
styles-v6-7.css
  - descubrimiento compacto
  - desplegables superpuestos
  - canvas crema y contraste premium
  - adaptación PC y móvil
```

Decisiones importantes:

- V6.7 tiene un catálogo único, no overlays separados por marca.
- Los botones de marca se generan desde los datos.
- ENA no es categoría ni necesidad.
- Las necesidades representan intención funcional.
- Cada producto tiene una sola categoría primaria.
- Los filtros usan query params en la misma ruta.
- V6.7 reutiliza la base V6.5/V6.6 y limita su capa propia a ajustes exclusivos
  de esta versión.
- V6.6 no comparte datos ni renderer con V6.7.

## Superficie pública implementada

### Catálogo

Ruta:

```text
/catalogo-v6-7/
```

Estados:

- `scope=ofertas`: estado inicial si no hay otro filtro;
- `scope=todo`: catálogo completo;
- `marca=<nombre>`: una marca;
- `need=<slug>`: una necesidad;
- `marca=<nombre>&need=<slug>`: marca y necesidad combinadas;
- `q=<texto>`: búsqueda.

La carga inicial y cada `Ver más` muestran hasta 24 productos adicionales.

### Ficha

Ruta:

```text
/producto-v6-7/<slug>/
```

Incluye:

- imagen de detalle;
- marca, línea y categoría;
- presentación derivada del nombre;
- uso principal derivado de necesidades;
- precio, descuento y ahorro;
- CTA WhatsApp con marca, producto y URL;
- productos relacionados;
- canonical propio;
- Open Graph de producto;
- JSON-LD `Product`.

### Búsqueda

La búsqueda cliente tolera acentos, aliases y errores menores mediante
Levenshtein. Incluye aliases para las marcas nuevas.

Hay una diferencia pendiente: el filtrado inicial del servidor usa coincidencia
normalizada simple, mientras el navegador aplica búsqueda fuzzy. Una consulta
mal escrita puede producir un preview social distinto del resultado que aparece
después de cargar JavaScript.

### Preview social

V6.7 usa la misma ruta con query params. Para una marca o necesidad, el servidor
genera título, descripción e imagen contextual.

No se crearon rutas `/marca/`, `/categoria/` ni `/necesidad/`.

## Estado de datos

Snapshot:

```text
version: 6.7
syncedAt: 2026-07-23T23:28:27.888Z
totalProducts: 689
```

### Productos por marca

| Marca | Productos |
|---|---:|
| ISDIN | 144 |
| Dermaglos | 105 |
| Eucerin | 86 |
| La Roche Posay | 81 |
| Vichy | 81 |
| Cetaphil | 43 |
| ENA | 43 |
| Caviahue | 40 |
| Productos Saludables | 36 |
| L'oreal Revitalift | 16 |
| Aveno | 14 |
| **Total** | **689** |

### Extracción incorporada en V6.7

| Marca | Fuente GPSFarma | Productos |
|---|---|---:|
| ISDIN | `https://gpsfarma.com/categorias.html?marca=6023` | 144 |
| Cetaphil | `https://gpsfarma.com/categorias.html?marca=5756` | 43 |
| Aveno | `https://gpsfarma.com/categorias.html?marca=5697` | 14 |
| ENA | `https://gpsfarma.com/categorias.html?marca=5911` | 43 |
| **Total incorporado** |  | **244** |

### Taxonomía

Categorías primarias permitidas:

```text
rostro, cuerpo, limpieza, solares, capilar, bebe, nutricion, otros
```

Necesidades permitidas:

```text
manchas, acne, piel-sensible, hidratacion, solares,
capilar, antiedad, reparacion, nutricion
```

Reglas verificadas:

- cada producto tiene una sola categoría primaria;
- `categorySlugs` contiene solamente esa categoría;
- una necesidad nunca puede ser el slug de la marca;
- ENA tiene 43 productos;
- todos los productos ENA son `nutricion`;
- no existe `ena-suplementos` como categoría o necesidad.

### Disponibilidad

El snapshot contiene:

| Estado fuente | Productos |
|---|---:|
| `limited` | 635 |
| `out_of_stock` | 54 |

Este valor proviene de la fuente y no está presentado en la interfaz. No debe
tratarse automáticamente como stock real de FarmaGreen.

La ficha genera actualmente `LimitedAvailability` en JSON-LD para todos los
productos. Antes de beta pública hay que definir el contrato comercial de stock
y alinear interfaz, CTA y schema.

## Imágenes: corrección final de esta sesión

El primer import usaba una transformación:

```text
canvas=942:610&fit=bounds
```

Ese lienzo horizontal reducía artificialmente el packshot dentro de las cajas
cuadradas. Aveno y Cetaphil se veían notablemente más pequeños que Revitalift y
la sombra quedaba separada del producto.

Corrección aplicada:

- 244 productos usan la URL de imagen original;
- 488 referencias, tarjeta y detalle, quedaron sin query de canvas;
- no se recomprimieron imágenes;
- no se agregó CSS por marca;
- se mantuvo el tratamiento común de sombra de V6.6.

Mediana de ocupación vertical medida sobre los originales:

| Marca | Ocupación aproximada |
|---|---:|
| Revitalift, muestra de referencia | 79% |
| Aveno | 73% |
| Cetaphil | 83% |
| ISDIN | 70% |
| ENA | 86% |

Las 244 imágenes originales respondieron durante el control técnico. El navegador
mostró las cuatro marcas sin imágenes rotas ni overflow.

V6.7 sigue dependiendo de imágenes servidas por GPSFarma. El dry run incorpora
un fallback visual común, también en fichas, para que una falla externa no deje
un espacio vacío. Para una versión estable conviene evaluar almacenamiento
controlado, preservando el original y sin recomprimir.

## Verificación al cierre

### Automatizada

Comando:

```bash
npm run verify
```

Resultado verificado el 2026-07-24:

```text
tests 18
pass 18
fail 0
```

Cobertura V6.7:

- catálogo único de 689 productos;
- 689 `publicId` únicos;
- 689 slugs únicos;
- conteos de las 11 marcas;
- cuatro fuentes de extracción;
- ENA sólo como marca;
- categorías y necesidades permitidas;
- cinco columnas PC y dos móvil;
- rutas y assets V6.7;
- entrega HTTP de `styles-v6-7.css`;
- preview contextual por query params;
- ficha con WhatsApp, presentación, uso y relacionados;
- 488 referencias GPSFarma sin canvas forzado;
- fallback común para imágenes rotas en catálogo y ficha;
- exportador y comando de deploy V6.7 aislados, sin `--prod`.

### HTTP

Verificado:

```text
V6.7 local: 200
V6.7 pública estable: 200, sin login
V6.6 pública: 200
```

El hostname técnico único del deployment redirige al SSO de Vercel. El alias
estable anterior es el acceso público que debe usarse para el dry run.

### Visual

Se revisaron:

- Aveno en catálogo;
- Cetaphil en catálogo y ficha;
- ISDIN en catálogo;
- ENA en catálogo;
- escala, resolución y sombra;
- cinco columnas desktop;
- ausencia de overflow;
- carga de imágenes;
- consola del navegador sin errores.

QA posterior al deploy sobre el alias público:

- desktop 1440 × 1000: cinco columnas, bloque de búsqueda de 133 px, logo de
  432 px y overflow horizontal 0;
- móvil 390 × 844: dos columnas, bloque de 121 px, logo de 302 px y overflow
  horizontal 0;
- menú móvil de marcas: 12 opciones, scroll interno y sin overflow de página;
- búsqueda `ISDIN solar`: 9 de 9;
- combinación `ISDIN + Solares`: 24 visibles de 55 y ambos parámetros en URL;
- ENA móvil: 24 visibles de 43;
- ficha ENA móvil: CTA WhatsApp, `noindex,nofollow`, sin overflow ni imágenes
  rotas;
- consola pública: 0 errores o advertencias.

### Navegación compacta vigente — 2026-07-24

El bloque `Buscá como hablás` fue rediseñado sin eliminar funciones ni crear
otra arquitectura de filtros.

La primera iteración con carriles horizontales quedó reemplazada. También se
descartó la alternativa de un único botón `Filtros`. La dirección aprobada es
el híbrido A+C:

- título, búsqueda y `Limpiar` comparten la primera fila;
- `¿Qué necesitás?` y `Marca` permanecen como dos controles independientes;
- ambos controles ocupan una sola fila cerrada en PC y móvil;
- necesidades abre una grilla visual con iconos pequeños;
- marcas abre una grilla tipográfica en PC y una lista con scroll interno en
  móvil;
- los paneles se superponen al catálogo y no empujan los productos;
- sólo puede quedar un menú abierto;
- `Escape`, clic exterior y selección cierran el panel;
- marca y necesidad pueden combinarse usando los query params existentes;
- cada control interactivo mantiene una altura mínima de 44 px;
- la búsqueda tiene borde verde de 2 px, fondo marfil y halo de foco visible;
- el logo aumenta hasta 20% y se adapta al ancho disponible;
- el canvas usa un crema ligeramente más marcado y las tarjetas conservan fondo
  blanco, borde cálido y sombra más definida;
- `styles-v6-7.css` concentra la capa visual propia;
- V6.6 y sus estilos permanecen sin cambios.

Altura cerrada medida:

| Viewport | Antes del rediseño | Vigente | Altura conservada |
|---|---:|---:|---:|
| 1440 px | 300,7 px | 133 px | 44% |
| 390 px | 326,4 px | 121 px | 37% |

QA responsive:

- viewports verificados en la implementación vigente: 320, 390, 768, 1440 y
  1970 px;
- overflow horizontal de página: 0 px en todos;
- grilla: cinco columnas desktop, tres tablet y dos móvil;
- apertura de necesidades y marcas: desplazamiento vertical de productos 0 px;
- búsqueda `ISDIN solar`: 9 resultados;
- filtro `Solares`: 195 resultados;
- filtro `ISDIN`: 144 resultados;
- combinación `ISDIN + Solares`: 55 resultados y URL con ambos parámetros;
- navegación superior `Marcas`, `Escape` y clic exterior verificados;
- logo medido: 432 px desktop, 360 px tablet y 302 px a 390 px;
- consola del navegador: 0 errores o advertencias;
- `npm run verify`: 18/18 pruebas.
- validación visual manual del usuario: catálogo Vichy con ambos desplegables y
  ficha Vichy aprobados el 2026-07-24.

ImageGen se usó para explorar la dirección desktop y móvil antes de implementar.
Las opciones aprobadas y las capturas del runtime real quedaron en:

```text
/Users/danielbernardes/.gstack/projects/eucerin-catalogo-v2-dna/designs/v67-filter-hybrid-ac-20260724/
```

No se incorporaron imágenes generadas al runtime: la interfaz final sigue siendo
HTML, CSS y JavaScript determinista.

### Refinamiento local posterior al dry run — pendiente de redeploy

El 2026-07-24 se cerraron tres ajustes de consistencia visual sobre V6.7 local.
El alias público continúa sirviendo la revisión anterior hasta que exista una
nueva autorización explícita de deploy.

- `¿Qué necesitás?` recupera la paleta exacta de categorías de la versión II:
  gradiente `#ffd08a → #ffad62` y texto grafito `#4b4a45`;
- `Marca` recupera la paleta exacta de marcas de la versión II: fondo `#2d7f89`,
  texto y chevron blancos;
- el botón incremental ahora dice siempre `Cargar más productos`, usa el naranja
  de los badges (`#ff5c2d`) y ocupa exactamente el ancho de la grilla;
- la ficha individual reutiliza las clases de la tarjeta general para mostrar
  marca a la izquierda y badge de descuento a la derecha en una única cabecera;
- marca y badge tienen una escala propia de ficha, mayor que en las tarjetas;
- el badge se repite intencionalmente junto al precio para reforzar la oferta,
  como en la versión anterior de la ficha;
- precio de lista y precio final aumentan de tamaño y jerarquía.

QA local de esta revisión:

- `npm run verify`: 18/18;
- desktop 1440 × 1000: cabecera de ficha de 72 px, marca y badge de 25,92 px,
  precio final de 34,56 px, botón incremental y grilla de 1356 px, overflow
  horizontal 0;
- móvil 390 × 844: cabecera de ficha de 58 px, marca de 18 px, badge superior de
  20 px, precio final de 24 px, botón incremental y grilla de 372 px, overflow
  horizontal 0;
- imágenes rotas: 0;
- errores o advertencias de consola: 0;
- V6.6 permanece sin cambios.

### Integridad de V6.6

Los archivos propios de V6.6 conservaron sus hashes:

```text
src/render-v66.ts
3d10a2e2ec22840e36f28e81d34886cf7135d0b13a5f72107141353d04adb7cc

public/app-v6-6.js
12aa87249a731c2e9b53c36d1d716dac5bb7e5a9e3505a92ccc48bd0df71f778

public/styles-v6-6.css
a18d6bef7cd1b996109091097baf52d4b93e10fcba310547ede0ac44f30b1d34

tests/v66-local.test.ts
de58690d2044e8459b04bf2d9f116c870d70ba3d3642b60c5f2b99753a26d4cd

src/export-v66-static.ts
90f822af6bcef146d1724179a68dd696a9ac2820ca78a3dc20519d4b41d39c1b
```

## Pendientes para beta

### P0 — cerrar antes de una preview pública V6.7

1. **Completado: crear exportador y scripts propios de V6.7**
   - `src/export-v67-static.ts`;
   - `export:vercel:v67`;
   - `deploy:vercel:v67:preview`;
   - output aislado `dist/vercel-v67`;
   - nunca reutilizar `dist/vercel-v66`.

2. **Parcialmente completado: controlar fallas de imagen**
   - fallback visible implementado;
   - hotlink verificado desde el dominio público;
   - evaluar copia a almacenamiento controlado sin recomprimir.

3. **Preservar el regreso a resultados**
   - `Volver al catálogo` pierde hoy marca, búsqueda, filtros y scroll;
   - conservar URL de retorno o historial con fallback seguro.

4. **Definir disponibilidad**
   - decidir si la fuente representa stock real de FarmaGreen;
   - mientras no haya verdad comercial, preferir `Consultar disponibilidad`;
   - corregir JSON-LD para no afirmar disponibilidad incorrecta.

5. **Unificar búsqueda servidor/cliente**
   - compartir la misma lógica de aliases y fuzzy matching;
   - evitar que el preview social difiera del resultado visible.

### P1 — beta operativa

6. **Identidad beta y feedback**
   - etiqueta discreta `Beta V6.7`;
   - acción `Reportar un problema`;
   - mensaje con URL y producto, sin agregar un servicio nuevo.

7. **Matriz visual final**
   - anchos 375, 390, 768, 1440 y 1970 px;
   - Chrome y Safari;
   - títulos largos;
   - productos verticales y horizontales;
   - imagen rota;
   - ficha abierta desde link directo;
   - retorno a resultados.

8. **Preview social real**
   - probar links de marca, necesidad y producto en WhatsApp;
   - verificar que el crawler pueda leer las imágenes;
   - mantener `noindex,nofollow` mientras sea beta.

9. **Piloto corto**
   - probar con 3 a 5 personas;
   - observar búsqueda, marca, producto y consulta;
   - registrar problemas concretos antes de otro cambio visual.

## Qué no agregar todavía

No se recomienda agregar antes de validar la beta:

- carrito;
- checkout;
- login;
- base de datos nueva;
- analytics externo;
- CRM nuevo;
- otra arquitectura de filtros;
- otro rediseño integral.

V6.7 sigue siendo un catálogo de consulta por WhatsApp. Esa simplicidad es parte
del producto, no una limitación a corregir.

## Gate para deploy V6.7

Antes de desplegar:

- [x] autorización explícita para crear una preview pública V6.7;
- [x] exportador V6.7 aislado;
- [x] V6.6 pública verificada antes del cambio;
- [x] `npm run verify` con 0 fallos;
- [x] QA desktop y móvil;
- [x] imágenes verificadas desde el dominio Vercel;
- [ ] preview social contextual de marca/necesidad en el export estático;
- [x] sin login si la prueba es para el equipo;
- [x] `noindex,nofollow`;
- [x] smoke de catálogo, producto, CSS y JS;
- [x] V6.6 pública verificada después del deploy.

El deploy debe producir una preview separada. No debe promover V6.7 sobre el
alias de V6.6 ni sobre producción.

### Deploy público de dry run — 2026-07-24

```text
Proyecto: farmagreen-v6-7-public-test
Project ID: prj_konNiMkJDXE7S01geyVb2tXqOYaX
Deployment ID: dpl_7VkZVabBbL5jq5mYAmZtU87N6h3P
Estado: READY
Alias público: https://farmagreen-v6-7-public-test.vercel.app
Catálogo: https://farmagreen-v6-7-public-test.vercel.app/catalogo-v6-7/
```

Vercel rotuló el primer deployment como target `production` dentro del proyecto
nuevo y exclusivo de test. Ese rótulo no promovió el proyecto principal, V6.6,
GCP, Firebase ni ningún dominio de producción real.

Dry run del artefacto antes de subir:

```text
698 archivos
689 fichas de producto
13 MB
robots.txt: Disallow /
noindex,nofollow: activo
rutas V6.6 en el artefacto V6.7: 0
```

Smoke público aprobado para raíz, catálogo, JavaScript, CSS, `robots.txt` y
fichas de ISDIN, Cetaphil, ENA y Vichy.

Límite confirmado: las fichas de producto exponen Open Graph e imagen accesible,
pero los filtros por query string de la página estática conservan el Open Graph
general del catálogo. No se creó otra ruta ni una arquitectura paralela para
resolverlo; queda pendiente antes de una promoción estable.

### Actualización pública del beta — 2026-07-25

Se publicó el snapshot aprobado del rediseño V6.7 en el mismo proyecto de test
aislado, sin tocar el proyecto ni el alias de V6.6:

```text
Rama: codex/v67-beta-ui
Proyecto: farmagreen-v6-7-public-test
Deployment ID: dpl_G1pHwvUT7VBkHAYFA2uun6iqRKav
Estado: READY
Preview inmutable: https://farmagreen-v6-7-public-test-pbfhwozdr-farma-green.vercel.app
Alias público: https://farmagreen-v6-7-public-test.vercel.app
Catálogo: https://farmagreen-v6-7-public-test.vercel.app/catalogo-v6-7/
```

El artefacto prebuilt contiene 698 archivos, 689 fichas de producto y 13 MB.
La verificación limpia aprobó 12/12 pruebas. El smoke público devolvió `200`
para catálogo, ficha Cetaphil, CSS, JavaScript y `robots.txt`; también confirmó:

- barra completa `Cargar más productos`;
- paleta V2 de necesidades y marcas;
- cabecera de marca y badge amplificados en ficha;
- badge repetido en la línea de precio;
- alias público apuntando al deployment nuevo;
- V6.6 pública respondiendo `200` después del cambio.

## Criterio de beta candidate

V6.7 puede considerarse beta candidate cuando:

- la información principal es correcta;
- las 11 marcas están completas;
- búsqueda, marca y necesidad llevan al resultado esperado;
- la ficha es compartible;
- las imágenes no dependen de un comportamiento frágil;
- volver mantiene el contexto;
- disponibilidad no hace afirmaciones falsas;
- PC y móvil conservan la misma utilidad;
- la preview no pisa V6.6 ni producción.

## Cierre de sesión

Estado documental:

- este archivo es el handover canónico de V6.7;
- `FARMAGREEN_CATALOGO_V6_HANDOVER_2026-06-28.md` queda como historia V2–V6.6;
- `FARMAGREEN_SESIONES.md` debe apuntar a este archivo para continuidad;
- el README sólo necesita un puntero corto, no duplicar este contenido.

Estado de código:

- el worktree histórico conserva sus cambios locales y archivos sin trackear;
- V6.7 se aisló en la rama limpia `codex/v67-beta-ui`;
- el snapshot versionado incluye únicamente datos, renderer, assets, pruebas,
  exportador y documentación necesarios para V6.7;
- no se limpió, revirtió ni incluyó trabajo ajeno;
- el deploy público sigue limitado al proyecto de test V6.7 documentado arriba.
