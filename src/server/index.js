const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const {
  getProviderSnapshot,
  getAllProviderSnapshots,
  listProviders
} = require("../providers/registry");

const {
  detectProviders
} = require("../providers/detection");

const {
  appendSnapshot,
  getHistory,
  getStats
} = require("../history/store");

const {
  getRecentActivity,
  getActivityStats
} = require("../activity/store");

const {
  getActiveAlerts,
  getRecentAlerts,
  acknowledgeAlert
} = require("../alerts/store");

const {
  getConfig: getAlertsConfig,
  updateConfig: updateAlertsConfig
} = require("../alerts/config");

const HOST = "127.0.0.1";
const PORT = 4173;

const VERSION = "0.13.0";

const PULSE_WINDOW_MODES = [
  "expanded",
  "dock",
  "detail"
];

const PUBLIC_DIR =
  path.resolve(
    __dirname,
    "../../public"
  );

const PROJECT_DIR =
  path.resolve(
    __dirname,
    "../.."
  );

const RESIZE_SCRIPT =
  path.join(
    PROJECT_DIR,
    "resize-pulse.ps1"
  );

const CONTENT_TYPES = {
  ".html":
    "text/html; charset=utf-8",

  ".css":
    "text/css; charset=utf-8",

  ".js":
    "application/javascript; charset=utf-8",

  ".json":
    "application/json; charset=utf-8",

  ".svg":
    "image/svg+xml",

  ".png":
    "image/png",

  ".jpg":
    "image/jpeg",

  ".jpeg":
    "image/jpeg",

  ".webp":
    "image/webp",

  ".ico":
    "image/x-icon"
};

let lastStoredSnapshotAt = 0;

const SNAPSHOT_INTERVAL_MS =
  5 * 60 * 1000;

/* =========================================================
   SECURITY
========================================================= */

function securityHeaders() {
  return {
    "X-Content-Type-Options":
      "nosniff",

    "X-Frame-Options":
      "DENY",

    "Referrer-Policy":
      "no-referrer"
  };
}

/* =========================================================
   RESPONSES
========================================================= */

function sendJson(
  res,
  statusCode,
  body
) {
  res.writeHead(
    statusCode,
    {
      ...securityHeaders(),

      "Content-Type":
        "application/json; charset=utf-8",

      "Cache-Control":
        "no-store"
    }
  );

  res.end(
    JSON.stringify(
      body,
      null,
      2
    )
  );
}

function sendText(
  res,
  statusCode,
  text
) {
  res.writeHead(
    statusCode,
    {
      ...securityHeaders(),

      "Content-Type":
        "text/plain; charset=utf-8",

      "Cache-Control":
        "no-store"
    }
  );

  res.end(text);
}

/* =========================================================
   BODY
========================================================= */

function readJsonBody(req) {
  return new Promise(
    (resolve, reject) => {
      let body = "";

      let finished = false;

      req.on(
        "data",
        (chunk) => {
          if (finished) {
            return;
          }

          body += chunk;

          if (
            Buffer.byteLength(body) >
            4096
          ) {
            finished = true;

            reject(
              new Error(
                "REQUEST_BODY_TOO_LARGE"
              )
            );

            req.destroy();
          }
        }
      );

      req.on(
        "end",
        () => {
          if (finished) {
            return;
          }

          finished = true;

          if (!body) {
            resolve({});
            return;
          }

          try {
            resolve(
              JSON.parse(body)
            );
          } catch {
            reject(
              new Error(
                "INVALID_JSON"
              )
            );
          }
        }
      );

      req.on(
        "error",
        (error) => {
          if (finished) {
            return;
          }

          finished = true;

          reject(error);
        }
      );
    }
  );
}

/* =========================================================
   STATIC FILES
========================================================= */

function serveFile(
  res,
  filePath
) {
  fs.readFile(
    filePath,
    (error, data) => {
      if (error) {
        if (
          error.code === "ENOENT"
        ) {
          sendText(
            res,
            404,
            "Not found"
          );

          return;
        }

        console.error(
          "[DevPulse] Erro ao ler arquivo:",
          error
        );

        sendText(
          res,
          500,
          "Internal server error"
        );

        return;
      }

      const extension =
        path.extname(
          filePath
        ).toLowerCase();

      res.writeHead(
        200,
        {
          ...securityHeaders(),

          "Content-Type":
            CONTENT_TYPES[
              extension
            ] ||
            "application/octet-stream",

          "Cache-Control":
            "no-cache"
        }
      );

      res.end(data);
    }
  );
}

/* =========================================================
   PROVIDER OPTIONS
========================================================= */

function getForceOption(
  url
) {
  return (
    url.searchParams.get(
      "force"
    ) === "1"
  );
}

/* =========================================================
   HISTORY
========================================================= */

function maybeStoreSnapshot(
  providers
) {
  const now =
    Date.now();

  if (
    now -
      lastStoredSnapshotAt <
    SNAPSHOT_INTERVAL_MS
  ) {
    return;
  }

  try {
    const snapshot =
      appendSnapshot(
        providers
      );

    if (snapshot) {
      lastStoredSnapshotAt =
        now;

      console.log(
        `[DevPulse] Snapshot salvo: ${snapshot.capturedAt}`
      );
    }
  } catch (error) {
    console.error(
      "[DevPulse] Falha ao salvar histórico:",
      error.message
    );
  }
}

/* =========================================================
   PULSE WINDOW
========================================================= */

function resizePulseWindow(
  mode
) {
  return new Promise(
    (resolve, reject) => {
      if (
        !PULSE_WINDOW_MODES.includes(
          mode
        )
      ) {
        reject(
          new Error(
            "INVALID_PULSE_WINDOW_MODE"
          )
        );

        return;
      }

      if (
        !fs.existsSync(
          RESIZE_SCRIPT
        )
      ) {
        reject(
          new Error(
            "RESIZE_SCRIPT_NOT_FOUND"
          )
        );

        return;
      }

      /*
       * Importante:
       *
       * O navegador NÃO fornece comandos
       * PowerShell.
       *
       * A única entrada aceita é:
       *
       * collapsed
       * expanded
       *
       * O script e os argumentos são definidos
       * pelo próprio DevPulse.
       */

      const child =
        spawn(
          "powershell.exe",
          [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            RESIZE_SCRIPT,
            "-Mode",
            mode
          ],
          {
            cwd:
              PROJECT_DIR,

            windowsHide:
              true,

            stdio:
              [
                "ignore",
                "pipe",
                "pipe"
              ]
          }
        );

      let stdout = "";
      let stderr = "";

      child.stdout.on(
        "data",
        (chunk) => {
          stdout +=
            chunk.toString();
        }
      );

      child.stderr.on(
        "data",
        (chunk) => {
          stderr +=
            chunk.toString();
        }
      );

      child.on(
        "error",
        (error) => {
          reject(error);
        }
      );

      child.on(
        "close",
        (code) => {
          if (code !== 0) {
            console.error(
              "[DevPulse] Falha ao redimensionar Pulse:",
              stderr.trim()
            );

            reject(
              new Error(
                "PULSE_RESIZE_FAILED"
              )
            );

            return;
          }

          resolve({
            mode,
            output:
              stdout.trim()
          });
        }
      );
    }
  );
}

/* =========================================================
   SERVER
========================================================= */

const server =
  http.createServer(
    async (req, res) => {
      try {
        const requestUrl =
          new URL(
            req.url,
            `http://${
              req.headers.host ||
              `${HOST}:${PORT}`
            }`
          );

        const pathname =
          decodeURIComponent(
            requestUrl.pathname
          );

        /* =========================
           HEALTH
        ========================= */

        if (
          req.method === "GET" &&
          pathname ===
            "/api/health"
        ) {
          sendJson(
            res,
            200,
            {
              status: "ok",

              service:
                "DevPulse",

              version:
                VERSION,

              timestamp:
                new Date()
                  .toISOString(),

              history:
                getStats()
            }
          );

          return;
        }

        /* =========================
           PULSE WINDOW
        ========================= */

        if (
          req.method === "POST" &&
          pathname ===
            "/api/pulse/window"
        ) {
          let body;

          try {
            body =
              await readJsonBody(
                req
              );
          } catch (error) {
            sendJson(
              res,
              400,
              {
                status:
                  "error",

                error:
                  error.message
              }
            );

            return;
          }

          const mode =
            body?.mode;

          if (
            !PULSE_WINDOW_MODES.includes(
              mode
            )
          ) {
            sendJson(
              res,
              400,
              {
                status:
                  "error",

                error:
                  "INVALID_PULSE_WINDOW_MODE"
              }
            );

            return;
          }

          try {
            await resizePulseWindow(
              mode
            );

            sendJson(
              res,
              200,
              {
                status:
                  "ok",

                mode
              }
            );
          } catch (error) {
            sendJson(
              res,
              500,
              {
                status:
                  "error",

                error:
                  error.message ||
                  "PULSE_RESIZE_FAILED"
              }
            );
          }

          return;
        }

        /* =========================
           HISTORY
        ========================= */

        if (
          req.method === "GET" &&
          pathname ===
            "/api/history"
        ) {
          const hours =
            requestUrl
              .searchParams
              .get("hours");

          sendJson(
            res,
            200,
            {
              hours:
                Number(hours) ||
                24,

              stats:
                getStats(),

              snapshots:
                getHistory(
                  hours
                )
            }
          );

          return;
        }

        /* =========================
           ACTIVITY (v0.11.0)
        ========================= */

        if (
          req.method === "GET" &&
          pathname ===
            "/api/activity"
        ) {
          const limit =
            requestUrl
              .searchParams
              .get("limit");

          sendJson(
            res,
            200,
            {
              stats:
                getActivityStats(),

              events:
                getRecentActivity(
                  limit
                )
            }
          );

          return;
        }

        /* =========================
           ALERTS (v0.12.0)
        ========================= */

        if (
          req.method === "GET" &&
          pathname === "/api/alerts"
        ) {
          const limit =
            requestUrl
              .searchParams
              .get("limit");

          sendJson(
            res,
            200,
            {
              active:
                getActiveAlerts(),

              recent:
                getRecentAlerts(
                  limit || 20
                )
            }
          );

          return;
        }

        const alertAckMatch =
          pathname.match(
            /^\/api\/alerts\/([a-zA-Z0-9:_-]+)\/acknowledge$/
          );

        if (
          req.method === "POST" &&
          alertAckMatch
        ) {
          const alertId =
            decodeURIComponent(
              alertAckMatch[1]
            );

          const result =
            acknowledgeAlert(
              alertId
            );

          sendJson(
            res,
            result.ok
              ? 200
              : result.error ===
                "ALERT_NOT_FOUND"
              ? 404
              : 409,
            result
          );

          return;
        }

        /* =========================
           ALERTS CONFIG (v0.12.0)
        ========================= */

        if (
          req.method === "GET" &&
          pathname ===
            "/api/alerts/config"
        ) {
          sendJson(
            res,
            200,
            getAlertsConfig()
          );

          return;
        }

        if (
          req.method === "POST" &&
          pathname ===
            "/api/alerts/config"
        ) {
          let body;

          try {
            body =
              await readJsonBody(
                req
              );
          } catch (error) {
            sendJson(
              res,
              400,
              {
                status: "error",
                error:
                  error.message
              }
            );

            return;
          }

          /*
           * Whitelist explícita — nunca repassa o body bruto
           * pro updateConfig, mesmo que ele já valide o
           * resultado final. Evita, por exemplo, um campo
           * extra desconhecido se infiltrar no JSON salvo.
           */
          const patch = {};

          if (
            typeof body?.alertsEnabled ===
            "boolean"
          ) {
            patch.alertsEnabled =
              body.alertsEnabled;
          }

          if (
            typeof body
              ?.windowsNotificationsEnabled ===
            "boolean"
          ) {
            patch.windowsNotificationsEnabled =
              body.windowsNotificationsEnabled;
          }

          if (
            typeof body
              ?.warningThreshold ===
            "number"
          ) {
            patch.warningThreshold =
              body.warningThreshold;
          }

          if (
            typeof body
              ?.criticalThreshold ===
            "number"
          ) {
            patch.criticalThreshold =
              body.criticalThreshold;
          }

          const result =
            updateAlertsConfig(
              patch
            );

          sendJson(
            res,
            result.ok ? 200 : 400,
            result
          );

          return;
        }

        /* =========================
           DETECTION
        ========================= */

        if (
          req.method === "GET" &&
          pathname ===
            "/api/detection"
        ) {
          const detected =
            await detectProviders();

          sendJson(
            res,
            200,
            detected
          );

          return;
        }

        /* =========================
           PROVIDERS
        ========================= */

        if (
          req.method === "GET" &&
          pathname ===
            "/api/providers"
        ) {
          sendJson(
            res,
            200,
            listProviders()
          );

          return;
        }

        /* =========================
           ALL SNAPSHOTS
        ========================= */

        if (
          req.method === "GET" &&
          pathname ===
            "/api/providers/all"
        ) {
          const force =
            getForceOption(
              requestUrl
            );

          const snapshots =
            await getAllProviderSnapshots(
              { force }
            );

          maybeStoreSnapshot(
            snapshots
          );

          sendJson(
            res,
            200,
            snapshots
          );

          return;
        }

        /* =========================
           PROVIDER INDIVIDUAL
        ========================= */

        const providerMatch =
          pathname.match(
            /^\/api\/providers\/([a-z0-9_-]+)$/
          );

        if (
          req.method === "GET" &&
          providerMatch
        ) {
          const providerId =
            providerMatch[1];

          const force =
            getForceOption(
              requestUrl
            );

          try {
            const snapshot =
              await getProviderSnapshot(
                providerId,
                { force }
              );

            sendJson(
              res,
              200,
              snapshot
            );

          } catch (error) {
            const statusCode =
              error.message ===
              "PROVIDER_NOT_FOUND"
                ? 404
                : 503;

            sendJson(
              res,
              statusCode,
              {
                id:
                  providerId,

                connected:
                  false,

                status:
                  "error",

                error:
                  error.message ||
                  "UNKNOWN_ERROR",

                updatedAt:
                  new Date()
                    .toISOString()
              }
            );
          }

          return;
        }

        /* =========================
           FAVICON
        ========================= */

        if (
          pathname ===
          "/favicon.ico"
        ) {
          res.writeHead(204);
          res.end();

          return;
        }

        if (
          req.method !==
          "GET"
        ) {
          sendText(
            res,
            405,
            "Method not allowed"
          );

          return;
        }

        /* =========================
           FRONTEND
        ========================= */

        const relativePath =
          pathname === "/"
            ? "index.html"
            : pathname.replace(
                /^\/+/,
                ""
              );

        const filePath =
          path.resolve(
            PUBLIC_DIR,
            relativePath
          );

        if (
          filePath !==
            PUBLIC_DIR &&
          !filePath.startsWith(
            PUBLIC_DIR +
              path.sep
          )
        ) {
          sendText(
            res,
            403,
            "Forbidden"
          );

          return;
        }

        serveFile(
          res,
          filePath
        );

      } catch (error) {
        console.error(
          "[DevPulse] Erro do servidor:",
          error
        );

        if (
          !res.headersSent
        ) {
          sendJson(
            res,
            500,
            {
              status:
                "error",

              error:
                "INTERNAL_SERVER_ERROR"
            }
          );
        } else {
          res.end();
        }
      }
    }
  );

/* =========================================================
   SERVER ERROR
========================================================= */

server.on(
  "error",
  (error) => {
    if (
      error.code ===
      "EADDRINUSE"
    ) {
      console.error("");
      console.error(
        `[DevPulse] A porta ${PORT} já está em uso.`
      );

      console.error(
        "Encerre a instância anterior e tente novamente."
      );

      console.error("");

      process.exitCode = 1;

      return;
    }

    console.error(
      "[DevPulse] Erro:",
      error
    );
  }
);

/* =========================================================
   START
========================================================= */

server.listen(
  PORT,
  HOST,
  () => {
    console.log("");

    console.log(
      `  DevPulse v${VERSION}`
    );

    console.log("");

    console.log(
      `  http://${HOST}:${PORT}`
    );

    console.log("");

    console.log(
      "  Monitoramento:"
    );

    for (
      const provider
      of listProviders()
    ) {
      console.log(
        `  - ${provider.name}`
      );
    }

    console.log("");

    console.log(
      "  Pulse:"
    );

    console.log(
      "  - native collapse ativo"
    );

    console.log(
      "  - janela controlada localmente"
    );

    console.log("");

    console.log(
      "  Histórico local:"
    );

    console.log(
      "  - snapshots sanitizados"
    );

    console.log(
      "  - intervalo mínimo: 5 minutos"
    );

    console.log(
      "  - retenção consultável: 90 dias"
    );

    console.log("");

    console.log(
      "  Ctrl+C para encerrar."
    );

    console.log("");
  }
);