const RETRYABLE_STATUS = new Set([403, 429, 500, 502, 503, 504]);
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function trustedSourceUrl(value, origin) {
  const allowedOrigin = new URL(origin);
  const url = new URL(value, allowedOrigin);
  if (
    allowedOrigin.protocol !== "https:" ||
    url.protocol !== "https:" ||
    url.origin !== allowedOrigin.origin ||
    url.username ||
    url.password
  ) {
    throw new Error(`Origen de extracción no permitido: ${url.origin}`);
  }
  return url.toString();
}

export async function fetchTrustedHtml(
  value,
  {
    origin,
    headers = {},
    fetchImpl = globalThis.fetch,
    timeoutMs = 20_000,
    maxAttempts = 3,
    maxRedirects = 5,
    retryDelayMs = 450,
    wait = sleep,
  },
) {
  let currentUrl = trustedSourceUrl(value, origin);
  let redirects = 0;
  let attempt = 1;

  while (true) {
    let response;
    try {
      response = await fetchImpl(currentUrl, {
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (attempt < maxAttempts) {
        await wait(retryDelayMs * attempt);
        attempt += 1;
        continue;
      }
      throw new Error(`No se pudo obtener ${currentUrl} después de ${attempt} intentos.`, { cause: error });
    }

    if (REDIRECT_STATUS.has(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Redirección sin destino: ${currentUrl}`);
      if (redirects >= maxRedirects) throw new Error(`Demasiadas redirecciones: ${currentUrl}`);
      currentUrl = trustedSourceUrl(location, origin);
      redirects += 1;
      attempt = 1;
      continue;
    }

    if (response.ok) return response.text();
    if (attempt < maxAttempts && RETRYABLE_STATUS.has(response.status)) {
      await wait(retryDelayMs * attempt);
      attempt += 1;
      continue;
    }
    throw new Error(`${response.status} ${response.statusText}: ${currentUrl}`);
  }
}
