export type VercelRouteV68 =
  | { src: string; dest: string }
  | { handle: "filesystem" };

export function upstreamOriginV68(value: string | undefined) {
  const cleaned = value?.trim();
  if (!cleaned) {
    throw new Error("V68_UPSTREAM_ORIGIN es obligatorio para exportar V6.8 sincronizada.");
  }
  const parsed = new URL(cleaned);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("V68_UPSTREAM_ORIGIN debe ser un origen HTTPS público sin ruta.");
  }
  return parsed.origin;
}

export function upstreamRoutesV68(value: string | undefined): VercelRouteV68[] {
  const origin = upstreamOriginV68(value);
  return [
    {
      src: "/catalogo-v6-8/?",
      dest: `${origin}/catalogo-v6-8`,
    },
    {
      src: "/producto-v6-8/(.*)",
      dest: `${origin}/producto-v6-8/$1`,
    },
    {
      src: "/api/catalog-v6-8/health",
      dest: `${origin}/api/catalog-v6-8/health`,
    },
    {
      src: "/api/catalog-v6-8$",
      dest: `${origin}/api/catalog-v6-8`,
    },
  ];
}

export function verifyPreparedRoutesV68(routes: unknown, value: string | undefined) {
  if (!Array.isArray(routes)) {
    throw new Error("La configuración Vercel V6.8 no contiene una lista de rutas.");
  }
  const filesystemIndex = routes.findIndex(
    (route) => route && typeof route === "object" && "handle" in route && route.handle === "filesystem",
  );
  if (filesystemIndex < 0) {
    throw new Error("La configuración Vercel V6.8 no contiene el handler filesystem.");
  }

  for (const expected of upstreamRoutesV68(value)) {
    if (!("src" in expected)) continue;
    const index = routes.findIndex(
      (route) =>
        route &&
        typeof route === "object" &&
        "src" in route &&
        "dest" in route &&
        route.src === expected.src &&
        route.dest === expected.dest,
    );
    if (index < 0) {
      throw new Error(`Falta el rewrite V6.8 ${expected.src} → ${expected.dest}.`);
    }
    if (index >= filesystemIndex) {
      throw new Error(`El rewrite V6.8 ${expected.src} debe ejecutarse antes de filesystem.`);
    }
  }
}
