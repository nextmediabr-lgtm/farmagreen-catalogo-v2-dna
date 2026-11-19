import assert from 'node:assert/strict';
import test from 'node:test';
import type http from 'node:http';
import { handleV69Request } from '../src/server-v69.js';
import { couponConsultationV69 } from '../src/render-v69.js';

test('consulta abre WhatsApp al local con un solo código y sin cargar catálogo', async () => {
  for (const suffix of ['000000000001', '000000000007', '00000000001E']) {
    const code = 'FG-D' + suffix;
    const headers: Record<string, string> = {};
    const response = { statusCode: 0, setHeader: (k: string, v: string) => { headers[k] = v; }, end: () => {} };
    const handled = await handleV69Request(response as unknown as http.ServerResponse, new URL('https://example.test/consulta?cupon=' + code), '/consulta', { V69_ENABLE_PRODUCTION: '1' });
    assert.equal(handled, true);
    assert.equal(response.statusCode, 302);
    const target = new URL(headers.Location);
    assert.equal(target.hostname, 'wa.me');
    assert.equal(target.pathname.slice(-4), '4000');
    assert.equal(target.searchParams.get('text'), 'Hola, quiero consultar por Todo Dermo y Solares.\nCupón: ' + code);
    assert.equal(headers['Cache-Control'], 'no-store');
    assert.equal(headers['Referrer-Policy'], 'no-referrer');
  }
});

test('consulta no admite código ausente, duplicado, inválido ni destino arbitrario', async () => {
  for (const query of ['', 'cupon=bad', 'cupon=FG-D000000000001&cupon=FG-D000000000002', 'cupon=%0d%0aLocation:evil']) {
    let redirected = false;
    const response = { statusCode: 0, setHeader: (k: string) => { if (k === 'Location') redirected = true; }, end: () => {} };
    await handleV69Request(response as unknown as http.ServerResponse, new URL('https://example.test/consulta?' + query), '/consulta', { V69_ENABLE_PRODUCTION: '1' });
    assert.equal(response.statusCode, 400);
    assert.equal(redirected, false);
  }
  assert.equal(couponConsultationV69('https://evil.test'), '');
});
