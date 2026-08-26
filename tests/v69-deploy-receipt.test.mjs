import assert from "node:assert/strict";
import test from "node:test";
import {
  parseDeployReceiptArgsV69,
  recordDeployReceiptV69,
} from "../scripts/record-deploy-v69.mjs";

const args = [
  "--origin=https://farmagreenrosario.web.app",
  "--commit=abc1234",
  "--build=build-1",
  "--revision=farmagreen-v69-preprod-test",
  "--products=1459",
  "--healthy=true",
  "--verified-at=2026-08-26T01:00:00.000Z",
];

test("Codex Agent Manager registra sólo memoria post-deploy validada", async () => {
  assert.deepEqual(parseDeployReceiptArgsV69(args).receipt, {
    commit: "abc1234",
    build: "build-1",
    cloudRunRevision: "farmagreen-v69-preprod-test",
    products: 1459,
    healthy: true,
    verifiedAt: "2026-08-26T01:00:00.000Z",
  });
  let request;
  const result = await recordDeployReceiptV69({
    args,
    token: "secret-agent-token",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response('{"accepted":true}', { status: 202, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(result.response.accepted, true);
  assert.equal(request.url, "https://farmagreenrosario.web.app/api/admin-v69/deploy-receipt");
  assert.equal(request.init.headers.authorization, "Bearer secret-agent-token");
  assert.equal(JSON.parse(request.init.body).healthy, true);
});

test("el post-deploy rechaza campos incompletos y nunca inventa un deploy", async () => {
  assert.throws(() => parseDeployReceiptArgsV69(args.filter((entry) => !entry.startsWith("--revision="))), /Falta --revision/);
  assert.throws(() => parseDeployReceiptArgsV69(args.map((entry) => entry === "--healthy=true" ? "--healthy=maybe" : entry)), /Health post-deploy inválido/);
  await assert.rejects(recordDeployReceiptV69({ args, token: "" }), /Falta V69_AGENT_MANAGER_TOKEN/);
});
