/*
 * DevPulse v0.13.1 — CWD portability (Fase 5).
 *
 * Sobe o servidor REAL desta cópia (src/server/index.js) a
 * partir de um cwd que NÃO é a raiz do projeto, para provar que
 * o static-root depende da localização do próprio arquivo
 * (__dirname), nunca do diretório de trabalho de quem o
 * iniciou. Isso importa porque DevPulse.bat, atalhos do Windows
 * e terminais diferentes podem iniciar `node src/server/index.js`
 * de cwds distintos.
 *
 * Roda com: node test/cwd-portability.js (incluído em `npm test`).
 */

const assert = require("node:assert/strict");
const path = require("path");

const {
  PROJECT_DIR,
  findFreePort,
  httpGet,
  startServer,
  stopServer,
  makeTempDir,
  removeTempDir
} = require("./helpers/harness");

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

let server = null;

test("GET /api/health -> 200 mesmo com cwd fora do projeto", async () => {
  const res = await httpGet(`${server.baseUrl}/api/health`);
  assert.equal(res.statusCode, 200);

  const body = JSON.parse(res.body);
  assert.equal(body.service, "DevPulse");
});

test("GET / -> 200 e HTML esperado mesmo com cwd fora do projeto", async () => {
  const res = await httpGet(`${server.baseUrl}/`);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<title>DevPulse<\/title>/);
});

test("GET /pulse.html -> 200 mesmo com cwd fora do projeto", async () => {
  const res = await httpGet(`${server.baseUrl}/pulse.html`);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /DevPulse · Pulse/);
});

test("GET /pulse.js -> 200 mesmo com cwd fora do projeto", async () => {
  const res = await httpGet(`${server.baseUrl}/pulse.js`);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /javascript/);
});

test("GET /pulse.css -> 200 mesmo com cwd fora do projeto", async () => {
  const res = await httpGet(`${server.baseUrl}/pulse.css`);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /text\/css/);
});

async function main() {
  let passed = 0;
  let failed = 0;

  const foreignCwd = makeTempDir("devpulse-cwd-portability-");
  const port = await findFreePort([48273, 48274, 48275, 48276]);

  try {
    server = await startServer({
      entryPath: path.join(PROJECT_DIR, "src", "server", "index.js"),
      cwd: foreignCwd,
      port
    });

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
    if (server) {
      await stopServer(server.child);
    }

    removeTempDir(foreignCwd);
  }

  console.log("");
  console.log(`${passed} passaram, ${failed} falharam (${tests.length} no total)`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main();
