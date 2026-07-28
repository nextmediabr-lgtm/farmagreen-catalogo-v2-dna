import assert from "node:assert/strict";
import test from "node:test";
import { fetchTrustedHtml, trustedSourceUrl } from "../scripts/gpsfarma-http.mjs";
import {
  bestProductCandidate,
  candidateBrandMatchesProduct,
  criticalVariantTokens,
  criticalVariantsAgree,
  decodeEntities,
  productLinks,
  productTitleMatchScore,
} from "../scripts/gpsfarma-listing.mjs";

const ORIGIN = "https://gpsfarma.com";

test("el decoder conserva entidades numéricas que no son escalares Unicode válidos", () => {
  assert.equal(decodeEntities("válido: &#x1F600;"), "válido: 😀");
  assert.equal(decodeEntities("fuera: &#99999999;"), "fuera: &#99999999;");
  assert.equal(decodeEntities("surrogate: &#xD800;"), "surrogate: &#xD800;");
});

test("el extractor V6.8 limita cada request y redirección al único origen HTTPS permitido", async () => {
  assert.equal(trustedSourceUrl("/producto.html", ORIGIN), "https://gpsfarma.com/producto.html");
  assert.throws(() => trustedSourceUrl("http://gpsfarma.com/producto.html", ORIGIN), /no permitido/);
  assert.throws(() => trustedSourceUrl("https://otro.example/producto.html", ORIGIN), /no permitido/);
  assert.throws(() => trustedSourceUrl("http://127.0.0.1/latest/meta-data", ORIGIN), /no permitido/);

  const blockedCalls: string[] = [];
  const blockedFetch = async (url: string) => {
    blockedCalls.push(url);
    return new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/latest/meta-data" },
    });
  };
  await assert.rejects(
    fetchTrustedHtml("/inicio", {
      origin: ORIGIN,
      fetchImpl: blockedFetch,
      maxAttempts: 1,
      wait: async () => {},
    }),
    /no permitido/,
  );
  assert.deepEqual(blockedCalls, ["https://gpsfarma.com/inicio"]);

  const allowedCalls: string[] = [];
  const allowedFetch = async (url: string) => {
    allowedCalls.push(url);
    return allowedCalls.length === 1
      ? new Response(null, { status: 302, headers: { location: "/destino" } })
      : new Response("contenido", { status: 200 });
  };
  assert.equal(
    await fetchTrustedHtml("/inicio", {
      origin: ORIGIN,
      fetchImpl: allowedFetch,
      maxAttempts: 1,
      wait: async () => {},
    }),
    "contenido",
  );
  assert.deepEqual(allowedCalls, ["https://gpsfarma.com/inicio", "https://gpsfarma.com/destino"]);
});

test("el fallback de extracción conserva y valida la marca real del resultado", () => {
  const html = `
    <li class="item product product-item">
      <div class="product brand product-item-brand">Vichy&nbsp;</div>
      <strong class="product name product-item-name">
        <a class="product-item-link" href="https://gpsfarma.com/protector-solar-fps-50.html">
          Protector Solar FPS 50 x 50 ml
        </a>
      </strong>
    </li>`;
  const [candidate] = productLinks(html, ORIGIN);
  assert.deepEqual(candidate, {
    sourceUrl: "https://gpsfarma.com/protector-solar-fps-50.html",
    sourceName: "Protector Solar FPS 50 x 50 ml",
    sourceBrand: "Vichy",
  });
  assert.equal(
    candidateBrandMatchesProduct(
      {
        name: "Protector Solar FPS 50 x 50 ml",
        brand: { name: "Eucerin", aliases: ["eucerin"] },
        line: "Sun",
        aliases: [],
      },
      candidate,
    ),
    false,
  );
  assert.equal(
    candidateBrandMatchesProduct(
      {
        name: "Vichy Protector Solar FPS 50 x 50 ml",
        brand: { name: "Vichy", aliases: ["vichy"] },
        line: "Capital Soleil",
        aliases: [],
      },
      candidate,
    ),
    true,
  );

  assert.equal(
    candidateBrandMatchesProduct(
      {
        name: "Crema de avena hidratante",
        brand: { name: "Otra marca", aliases: [] },
        line: "",
        aliases: [],
      },
      { ...candidate, sourceBrand: "ENA" },
    ),
    false,
  );
  assert.equal(
    candidateBrandMatchesProduct(
      {
        name: "Protector compatible con ISDIN",
        brand: { name: "Eucerin", aliases: ["eucerin"] },
        line: "",
        aliases: [],
      },
      { ...candidate, sourceBrand: "ISDIN" },
    ),
    false,
  );
  assert.equal(
    candidateBrandMatchesProduct(
      {
        name: "Serum L'Oréal Revitalift x 30 ml",
        brand: { name: "L'oreal Revitalift", aliases: ["loreal paris"] },
        line: "",
        aliases: [],
      },
      { ...candidate, sourceBrand: "L'Oreal París" },
    ),
    true,
  );
  assert.equal(
    candidateBrandMatchesProduct(
      {
        name: "Vitamin Way multivitamínico energía x 30 caps.",
        brand: { name: "Productos Saludables", slug: "productos-saludables", aliases: ["saludables"] },
        line: "",
        aliases: [],
      },
      { ...candidate, sourceBrand: "Vitamin Way" },
    ),
    true,
  );
});

test("el matcher exige marca real y cobertura suficiente antes de recuperar detalle", () => {
  const product = {
    name: "Protector Solar Facial FPS 50 con Color x 50 ml",
    brand: { name: "Eucerin", aliases: ["eucerin"] },
  };
  const generic = {
    sourceUrl: "https://gpsfarma.com/protector-solar.html",
    sourceName: "Protector Solar",
    sourceBrand: "Eucerin",
  };
  const wrongBrand = {
    sourceUrl: "https://gpsfarma.com/eucerin-protector-solar.html",
    sourceName: product.name,
    sourceBrand: "Vichy",
  };
  const exact = {
    sourceUrl: "https://gpsfarma.com/eucerin-protector-solar-facial.html",
    sourceName: product.name,
    sourceBrand: "Eucerin",
  };
  const wrongSpf = {
    sourceUrl: "https://gpsfarma.com/eucerin-protector-solar-fps30.html",
    sourceName: "Protector Solar Facial FPS 30 con Color x 50 ml",
    sourceBrand: "Eucerin",
  };

  assert.ok(productTitleMatchScore(product.name, generic.sourceName) < 0.74);
  assert.deepEqual([...criticalVariantTokens(product.name)].sort(), ["fps:50", "measure:ml:50"]);
  assert.equal(criticalVariantsAgree(product.name, wrongSpf.sourceName), false);
  assert.equal(bestProductCandidate(product, [generic, wrongBrand, wrongSpf]), null);
  assert.deepEqual(bestProductCandidate(product, [generic, wrongBrand, wrongSpf, exact]), {
    ...exact,
    confidence: 1,
  });
});

test("el matcher conserva el rol y la unidad de cada variante numérica", () => {
  const canonical = "Protector Solar FPS 50 x 30 ml";
  const swappedRoles = "Protector Solar FPS 30 x 50 ml";
  const wrongUnit = "Protector Solar FPS 50 x 30 g";
  const equivalent = "Protector Solar SPF50 30 mililitros";

  assert.deepEqual([...criticalVariantTokens(canonical)].sort(), ["fps:50", "measure:ml:30"]);
  assert.equal(criticalVariantsAgree(canonical, swappedRoles), false);
  assert.equal(criticalVariantsAgree(canonical, wrongUnit), false);
  assert.equal(criticalVariantsAgree(canonical, equivalent), true);

  const product = {
    name: canonical,
    brand: { name: "Eucerin", aliases: ["eucerin"] },
  };
  const candidates = [swappedRoles, wrongUnit].map((sourceName, index) => ({
    sourceUrl: `https://gpsfarma.com/variante-${index}.html`,
    sourceName,
    sourceBrand: "Eucerin",
  }));
  assert.equal(bestProductCandidate(product, candidates), null);
});
