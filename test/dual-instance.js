/*
 * DevPulse v0.13.1 — duas instalações em paralelo (Fase 7).
 *
 * Sobe DUAS cópias clean-room independentes (A e B), cada uma
 * na sua própria porta de teste, e usa o script de handshake
 * REAL (pulse-handshake.ps1 -Port <porta>) para provar que:
 *
 *   - A e B têm instanceId diferentes;
 *   - o handshake de B, apontado para a porta de A, reconhece
 *     que A NÃO é a mesma instalação (exit code 3) — nunca mata
 *     A, nunca reaproveita A silenciosamente;
 *   - o handshake de A, apontado para a própria porta de A,
 *     reconhece A como a mesma instalação (exit code 0);
 *   - depois de tudo isso, A continua rodando (B nunca a afetou).
 *
 * -Port é usado aqui só para apontar o handshake para as portas
 * de teste isoladas de A e B — a mesma lógica que o DevPulse.bat
 * usa em produção (sempre porta 4173, sem -Port).
 *
 * Roda com: node test/dual-instance.js (incluído em `npm test`).
 */

const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("child_process");

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

let dirA = null;
let dirB = null;
let serverA = null;
let serverB = null;

function runHandshake(installDir, targetPort) {
  const scriptPath = path.join(installDir, "pulse-handshake.ps1");

  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-Port",
      String(targetPort)
    ],
    { encoding: "utf8" }
  );

  if (result.error) {
    throw result.error;
  }

  return result.status;
}

test("A e B têm instanceId diferentes", async () => {
  const healthA = JSON.parse((await httpGet(`${serverA.baseUrl}/api/health`)).body);
  const healthB = JSON.parse((await httpGet(`${serverB.baseUrl}/api/health`)).body);

  assert.notEqual(healthA.instanceId, healthB.instanceId);
});

test("handshake de A contra a própria porta de A -> exit 0 (mesma instalação, reaproveita)", () => {
  const exitCode = runHandshake(dirA, serverA.port);
  assert.equal(exitCode, 0);
});

test("handshake de B contra a porta de A -> exit 3 (outra instalação, não reaproveita)", () => {
  const exitCode = runHandshake(dirB, serverA.port);
  assert.equal(
    exitCode,
    3,
    "B deveria reconhecer que quem responde na porta de A não é a própria instalação B"
  );
});

test("depois do handshake de B, A continua rodando normalmente (B nunca mexeu em A)", async () => {
  const res = await httpGet(`${serverA.baseUrl}/api/health`);
  assert.equal(res.statusCode, 200);
});

test("handshake de B contra uma porta livre -> exit 1 (porta livre, pode iniciar)", async () => {
  const freePort = await findFreePort([48973, 48974, 48975, 48976]);
  const exitCode = runHandshake(dirB, freePort);
  assert.equal(exitCode, 1);
});

async function main() {
  let passed = 0;
  let failed = 0;

  dirA = makeTempDir("devpulse-dual-a-");
  dirB = makeTempDir("devpulse-dual-b-");

  buildCleanRoomCopy(dirA);
  buildCleanRoomCopy(dirB);

  const portA = await findFreePort([48473, 48474, 48475, 48476]);
  const portB = await findFreePort([48573, 48574, 48575, 48576]);

  try {
    serverA = await startServer({
      entryPath: path.join(dirA, "src", "server", "index.js"),
      cwd: dirA,
      port: portA
    });
    serverA.port = portA;

    serverB = await startServer({
      entryPath: path.join(dirB, "src", "server", "index.js"),
      cwd: dirB,
      port: portB
    });
    serverB.port = portB;

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
    if (serverA) {
      await stopServer(serverA.child);
    }

    if (serverB) {
      await stopServer(serverB.child);
    }

    removeTempDir(dirA);
    removeTempDir(dirB);
  }

  console.log("");
  console.log(`${passed} passaram, ${failed} falharam (${tests.length} no total)`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main();
