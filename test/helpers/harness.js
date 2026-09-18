/*
 * DevPulse v0.13.1 — helpers de integração (clean-room, cwd
 * portability, duas instalações).
 *
 * Usado apenas por test/*.js fora de smoke.js. Regras:
 *   - nunca inicia um servidor na porta 4173 de produção;
 *   - nunca mata um processo que não foi criado pela própria
 *     chamada de startServer() nesta suíte;
 *   - cada cópia "clean-room" é construída a partir de
 *     `git ls-files --cached --others --exclude-standard`
 *     (tracked + não-ignorado), nunca de um recorte manual —
 *     é a definição real de "o que um clone novo receberia".
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const net = require("net");
const http = require("http");
const { execFileSync, spawn } = require("child_process");

const PROJECT_DIR = path.resolve(__dirname, "../..");

function listPublishableFiles(repoDir) {
  const output = execFileSync(
    "git",
    ["-C", repoDir, "ls-files", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8" }
  );

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildCleanRoomCopy(destDir, { sourceDir = PROJECT_DIR } = {}) {
  fs.mkdirSync(destDir, { recursive: true });

  const files = listPublishableFiles(sourceDir);

  for (const relativePath of files) {
    const from = path.join(sourceDir, relativePath);
    const to = path.join(destDir, relativePath);

    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }

  return { destDir, files };
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();

    tester.once("error", () => {
      resolve(false);
    });

    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });

    tester.listen(port, "127.0.0.1");
  });
}

async function findFreePort(candidates) {
  for (const port of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(port)) {
      return port;
    }
  }

  throw new Error(
    "NO_FREE_TEST_PORT: nenhuma porta candidata estava livre"
  );
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";

      res.on("data", (chunk) => {
        body += chunk;
      });

      res.on("end", () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body
        });
      });
    });

    req.on("error", reject);
    req.setTimeout(3000, () => {
      req.destroy(new Error("REQUEST_TIMEOUT"));
    });
  });
}

async function waitForHealth(baseUrl, { attempts = 40, delayMs = 150 } = {}) {
  let lastError = null;

  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await httpGet(`${baseUrl}/api/health`);

      if (res.statusCode === 200) {
        return JSON.parse(res.body);
      }
    } catch (error) {
      lastError = error;
    }

    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(
    `SERVER_DID_NOT_BECOME_HEALTHY: ${lastError ? lastError.message : "sem resposta"}`
  );
}

/*
 * Sobe o servidor REAL (src/server/index.js) de uma cópia
 * específica, isolado numa porta de teste. cwd é configurável
 * de propósito (Fase 5 - CWD portability): o processo deve
 * responder corretamente mesmo iniciado de um diretório que não
 * é a raiz do projeto.
 */
async function startServer({ entryPath, cwd, port, env = {} }) {
  const child = spawn(
    process.execPath,
    [entryPath],
    {
      cwd,
      env: {
        ...process.env,
        ...env,
        DEVPULSE_PORT: String(port)
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}`;

  let exitedEarly = null;

  child.once("exit", (code, signal) => {
    exitedEarly = { code, signal };
  });

  try {
    const health = await waitForHealth(baseUrl);

    return {
      child,
      pid: child.pid,
      baseUrl,
      health,
      getStdout: () => stdout,
      getStderr: () => stderr
    };
  } catch (error) {
    if (exitedEarly) {
      throw new Error(
        `SERVER_EXITED_EARLY code=${exitedEarly.code} signal=${exitedEarly.signal} stderr=${stderr}`
      );
    }

    stopServer(child);
    throw error;
  }
}

/*
 * Encerra SOMENTE o PID que este helper criou (o próprio
 * ChildProcess retornado por startServer). Nunca por nome de
 * processo, nunca por porta.
 *
 * Espera o evento "exit" antes de resolver - no Windows, o
 * processo mantém um handle aberto no seu próprio cwd até
 * terminar de verdade, e um rmSync() da pasta temporária logo
 * após kill() (sem esperar) falha com EPERM.
 */
function stopServer(child, { timeoutMs = 3000 } = {}) {
  if (!child) {
    return Promise.resolve();
  }

  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const done = () => resolve();

    child.once("exit", done);

    setTimeout(done, timeoutMs);

    try {
      child.kill();
    } catch {
      // já encerrado - nada a fazer.
    }
  });
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function removeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = {
  PROJECT_DIR,
  listPublishableFiles,
  buildCleanRoomCopy,
  findFreePort,
  httpGet,
  waitForHealth,
  startServer,
  stopServer,
  makeTempDir,
  removeTempDir
};
