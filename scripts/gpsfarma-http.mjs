const RETRYABLE_STATUS = new Set([403, 429, 500, 502, 503, 504]);
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
export const MAX_HTML_BYTES = 6_000_000;

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
    maxResponseBytes = MAX_HTML_BYTES,
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

    if (response.ok) return readHtmlWithinLimit(response, maxResponseBytes);
    if (attempt < maxAttempts && RETRYABLE_STATUS.has(response.status)) {
      await wait(retryDelayMs * attempt);
      attempt += 1;
      continue;
    }
    throw new Error(`${response.status} ${response.statusText}: ${currentUrl}`);
  }
}

export async function readHtmlWithinLimit(response, maxBytes = MAX_HTML_BYTES) {
  const limit = Number(maxBytes);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Límite HTML inválido.");
  const declaredHeader = response.headers.get("content-length");
  const declaredBytes = declaredHeader === null ? null : Number(declaredHeader);
  if (declaredBytes !== null && Number.isFinite(declaredBytes) && declaredBytes > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`HTML supera el límite de ${limit} bytes.`);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > limit) throw new Error(`HTML supera el límite de ${limit} bytes.`);
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
