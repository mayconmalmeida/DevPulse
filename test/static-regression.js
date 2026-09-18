/*
 * DevPulse v0.13.1 — regressão de static serving + identidade
 * de instância.
 *
 * Roda com: node test/static-regression.js (também incluído em
 * `npm test`).
 *
 * Sobe o servidor REAL (src/server/index.js) desta cópia numa
 * porta de teste isolada (nunca 4173, nunca a porta de produção
 * usada pelo DevPulse.bat) e confirma que as rotas estáticas
 * essenciais respondem. Este é exatamente o caso real que
 * falhou pós-publicação: /pulse.html devolvendo 404 numa
 * instância que o launcher considerou válida.
 *
 * Encerra, ao final, SOMENTE o PID que este próprio teste criou.
 */

const assert = require("node:assert/strict");
const path = require("path");

const {
  PROJECT_DIR,
  findFreePort,
  httpGet,
  startServer,
  stopServer
} = require("./helpers/harness");

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

let server = null;

test("GET /api/health -> 200 com service, version e instanceId", async () => {
  const res = await httpGet(`${server.baseUrl}/api/health`);
  assert.equal(res.statusCode, 200);

  const body = JSON.parse(res.body);
  assert.equal(body.status, "ok");
  assert.equal(body.service, "DevPulse");
  assert.ok(typeof body.version === "string" && body.version.length > 0);
  assert.ok(
    typeof body.instanceId === "string" && body.instanceId.length > 0,
    "esperava um instanceId opaco não-vazio"
  );
});

test("instanceId é estável entre duas chamadas de /api/health", async () => {
  const first = JSON.parse((await httpGet(`${server.baseUrl}/api/health`)).body);
  const second = JSON.parse((await httpGet(`${server.baseUrl}/api/health`)).body);

  assert.equal(first.instanceId, second.instanceId);
});

test("instanceId nunca contém o caminho absoluto da instalação", async () => {
  const body = JSON.parse((await httpGet(`${server.baseUrl}/api/health`)).body);
  const fullResponse = JSON.stringify(body);

  assert.ok(
    !fullResponse.includes(PROJECT_DIR),
    "resposta de /api/health não deveria conter o path absoluto do projeto"
  );
});

test("GET / -> 200 e HTML esperado (index.html)", async () => {
  const res = await httpGet(`${server.baseUrl}/`);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  assert.match(res.body, /<title>DevPulse<\/title>/);
});

test("GET /pulse.html -> 200 e HTML do Pulse", async () => {
  const res = await httpGet(`${server.baseUrl}/pulse.html`);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  assert.match(res.body, /DevPulse · Pulse/);
});

test("GET /pulse.js -> 200 + JavaScript", async () => {
  const res = await httpGet(`${server.baseUrl}/pulse.js`);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /javascript/);
  assert.ok(res.body.length > 0);
});

test("GET /pulse.css -> 200 + CSS", async () => {
  const res = await httpGet(`${server.baseUrl}/pulse.css`);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /text\/css/);
  assert.ok(res.body.length > 0);
});

test("GET /rota-inexistente -> 404 (prova que os 200 acima não são um catch-all)", async () => {
  const res = await httpGet(`${server.baseUrl}/rota-inexistente-${Date.now()}.html`);
  assert.equal(res.statusCode, 404);
});

async function main() {
  let passed = 0;
  let failed = 0;

  const port = await findFreePort([48173, 48174, 48175, 48176]);

  server = await startServer({
    entryPath: path.join(PROJECT_DIR, "src", "server", "index.js"),
    cwd: PROJECT_DIR,
    port
  });

  try {
    for (const { name, fn } of tests) {
      try {
        await fn();
        passed += 1;
        console.log(`  ok  - ${name}`);
      } catch (error) {
        failed += 1;
        console.error(`FAIL  - ${name}`);
        console.error(`        ${error.message}`);
      }
    }
  } finally {
    await stopServer(server.child);
  }

  console.log("");
  console.log(`${passed} passaram, ${failed} falharam (${tests.length} no total)`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main();
