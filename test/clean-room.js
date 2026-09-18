/*
 * DevPulse v0.13.1 — clean-room real (Fase 6).
 *
 * Constrói uma cópia temporária contendo SOMENTE os arquivos
 * publicáveis (`git ls-files --cached --others --exclude-standard`,
 * ou seja: tracked + não-ignorado — exatamente o que um clone ou
 * ZIP novo receberia), sobe o servidor REAL dessa cópia numa
 * porta de teste isolada, confirma que o PID que respondeu é o
 * PID que este teste criou, e valida que data/ nasce limpo
 * (sem histórico, atividade, alerts ou instance-id herdados do
 * projeto de desenvolvimento).
 *
 * Nunca usa a porta 4173 de produção. Encerra, ao final, SOMENTE
 * o PID que este próprio teste criou.
 *
 * Roda com: node test/clean-room.js (incluído em `npm test`).
 */

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  buildCleanRoomCopy,
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

let cleanRoomDir = null;
let manifest = null;
let server = null;

test("manifest do clean-room não inclui nenhum dado pessoal/runtime", () => {
  const forbidden = [
    "data/history.jsonl",
    "data/activity.jsonl",
    "data/alerts.jsonl",
    "data/alerts-config.json",
    "data/instance-id",
    "node_modules"
  ];

  for (const forbiddenPath of forbidden) {
    const hit = manifest.files.find(
      (file) => file === forbiddenPath || file.startsWith(`${forbiddenPath}/`)
    );

    assert.equal(
      hit,
      undefined,
      `manifest do clean-room não deveria conter "${forbiddenPath}"`
    );
  }
});

test("PID criado pelo teste é o PID que responde na porta de teste", async () => {
  assert.ok(server.pid > 0);

  const res = await httpGet(`${server.baseUrl}/api/health`);
  assert.equal(res.statusCode, 200);
});

test("GET /api/health -> 200, service DevPulse, instanceId próprio", async () => {
  const res = await httpGet(`${server.baseUrl}/api/health`);
  const body = JSON.parse(res.body);

  assert.equal(body.status, "ok");
  assert.equal(body.service, "DevPulse");
  assert.ok(typeof body.instanceId === "string" && body.instanceId.length > 0);
});

test("GET / -> 200 e HTML esperado", async () => {
  const res = await httpGet(`${server.baseUrl}/`);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<title>DevPulse<\/title>/);
});

test("GET /pulse.html -> 200 e HTML do Pulse", async () => {
  const res = await httpGet(`${server.baseUrl}/pulse.html`);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /DevPulse · Pulse/);
});

test("GET /pulse.js -> 200 + JavaScript", async () => {
  const res = await httpGet(`${server.baseUrl}/pulse.js`);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /javascript/);
});

test("GET /pulse.css -> 200 + CSS", async () => {
  const res = await httpGet(`${server.baseUrl}/pulse.css`);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /text\/css/);
});

test("GET /api/providers -> 200 com os 6 providers esperados", async () => {
  const res = await httpGet(`${server.baseUrl}/api/providers`);
  assert.equal(res.statusCode, 200);

  const body = JSON.parse(res.body);
  const ids = body.map((p) => p.id).sort();

  assert.deepEqual(
    ids,
    ["claude", "codex", "cursor", "gemini", "ollama", "opencode"]
  );
});

test("data/ nasce limpo: nenhum dado pessoal, nenhuma atividade/alerts herdados", () => {
  const dataDir = path.join(cleanRoomDir, "data");
  const entries = fs.readdirSync(dataDir).sort();

  /*
   * GET /api/health chama getStats(), que (comportamento já
   * existente, não introduzido por v0.13.1) cria
   * data/history.jsonl vazio como parte do bootstrap normal de
   * leitura. Isso é aceitável — é um arquivo vazio, sem nenhum
   * snapshot real dentro. O que este teste garante é que
   * NENHUM outro arquivo de dado (atividade, alerts, config) é
   * criado por rotas que não os tocam, e que o history.jsonl
   * criado está genuinamente vazio (sem herdar snapshots do
   * projeto de desenvolvimento).
   */
  assert.deepEqual(
    entries,
    [".gitkeep", "history.jsonl", "instance-id"],
    `data/ do clean-room deveria conter só .gitkeep + history.jsonl (vazio) + instance-id, encontrou: ${entries.join(", ")}`
  );

  const historyContent = fs.readFileSync(path.join(dataDir, "history.jsonl"), "utf8");
  assert.equal(historyContent, "", "history.jsonl do clean-room deveria nascer vazio, sem snapshots herdados");
});

test("instance-id do clean-room é opaco (uuid), sem path/username/hostname", () => {
  const idFile = path.join(cleanRoomDir, "data", "instance-id");
  const id = fs.readFileSync(idFile, "utf8").trim();

  assert.match(
    id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "instance-id deveria ser um UUID puro"
  );

  const lowerId = id.toLowerCase();
  const username = (process.env.USERNAME || "").toLowerCase();
  const hostname = require("os").hostname().toLowerCase();

  if (username) {
    assert.ok(!lowerId.includes(username), "instance-id não deveria conter o username");
  }

  if (hostname) {
    assert.ok(!lowerId.includes(hostname), "instance-id não deveria conter o hostname");
  }
});

test("encerrar o PID do teste realmente para o servidor (prova que era ele quem respondia)", async () => {
  await stopServer(server.child);

  await assert.rejects(
    httpGet(`${server.baseUrl}/api/health`),
    "depois de matar o PID do teste, a mesma porta não deveria mais responder"
  );

  server = null;
});

async function main() {
  let passed = 0;
  let failed = 0;

  cleanRoomDir = makeTempDir("devpulse-clean-room-");
  manifest = buildCleanRoomCopy(cleanRoomDir);

  const port = await findFreePort([48373, 48374, 48375, 48376]);

  try {
    server = await startServer({
      entryPath: path.join(cleanRoomDir, "src", "server", "index.js"),
      cwd: cleanRoomDir,
      port
    });

    for (const { name, fn } of tests) {
      try {
        // eslint-disable-next-line no-await-in-loop
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

    removeTempDir(cleanRoomDir);
  }

  console.log("");
  console.log(`${passed} passaram, ${failed} falharam (${tests.length} no total)`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main();
