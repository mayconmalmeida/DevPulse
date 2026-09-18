const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(
  __dirname,
  "../../data"
);

const HISTORY_FILE = path.join(
  DATA_DIR,
  "history.jsonl"
);

const MAX_HISTORY_DAYS = 90;

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(
      DATA_DIR,
      {
        recursive: true
      }
    );
  }

  if (!fs.existsSync(HISTORY_FILE)) {
    fs.writeFileSync(
      HISTORY_FILE,
      "",
      "utf8"
    );
  }
}

function sanitizeWindow(window) {
  if (!window) {
    return null;
  }

  return {
    id:
      window.id || null,

    label:
      window.label || null,

    usedPercent:
      typeof window.usedPercent === "number"
        ? window.usedPercent
        : null,

    remainingPercent:
      typeof window.remainingPercent === "number"
        ? window.remainingPercent
        : null,

    resetsAt:
      window.resetsAt || null
  };
}

function sanitizeProvider(provider) {
  if (!provider) {
    return null;
  }

  const result = {
    id:
      provider.id,

    name:
      provider.name,

    connected:
      Boolean(
        provider.connected
      ),

    status:
      provider.status || null,

    plan:
      provider.plan || null,

    windows: {
      primary:
        sanitizeWindow(
          provider.windows?.primary
        ),

      secondary:
        sanitizeWindow(
          provider.windows?.secondary
        )
    }
  };

  if (
    provider.id === "claude"
  ) {
    result.breakdown =
      Array.isArray(
        provider.breakdown
      )
        ? provider.breakdown.map(
            (item) => ({
              id:
                item.id || null,

              name:
                item.name || null,

              percent:
                typeof item.percent === "number"
                  ? item.percent
                  : null
            })
          )
        : [];

    if (provider.extraUsage) {
      result.extraUsage = {
        enabled:
          Boolean(
            provider.extraUsage.enabled
          ),

        currency:
          provider.extraUsage.currency ||
          null,

        limit:
          typeof provider.extraUsage.limit === "number"
            ? provider.extraUsage.limit
            : null,

        used:
          typeof provider.extraUsage.used === "number"
            ? provider.extraUsage.used
            : null,

        usedPercent:
          typeof provider.extraUsage.usedPercent === "number"
            ? provider.extraUsage.usedPercent
            : null
      };
    }
  }

  if (
    provider.id === "codex" &&
    provider.tokenUsage
  ) {
    result.tokenUsage = {
      lifetimeTokens:
        typeof provider.tokenUsage.lifetimeTokens === "number"
          ? provider.tokenUsage.lifetimeTokens
          : null,

      peakDailyTokens:
        typeof provider.tokenUsage.peakDailyTokens === "number"
          ? provider.tokenUsage.peakDailyTokens
          : null,

      currentStreakDays:
        typeof provider.tokenUsage.currentStreakDays === "number"
          ? provider.tokenUsage.currentStreakDays
          : null,

      longestStreakDays:
        typeof provider.tokenUsage.longestStreakDays === "number"
          ? provider.tokenUsage.longestStreakDays
          : null
    };
  }

  return result;
}

/*
 * v0.11.0: elegibilidade decidida pela capability explícita
 * `history` (ver src/providers/registry.js), não mais pela
 * heurística estrutural "tem campo windows". Um provider só
 * é elegível se: (a) o registry declara `capabilities.history
 * = true` — hoje só Codex/Claude — e (b) o snapshot atual
 * realmente trouxe uma janela de uso conectada. Isso evita
 * tanto contaminar o histórico com providers sem quota
 * quanto gravar um ponto vazio de um provider elegível que
 * falhou momentaneamente.
 *
 * Exportado para o smoke suite testar sem tocar em arquivo
 * nenhum (ver test/smoke.js).
 */
function isEligibleForHistory(provider) {
  return Boolean(
    provider &&
      provider.capabilities?.history &&
      provider.connected &&
      provider.windows
  );
}

function createSnapshot(providers) {
  return {
    version: 1,

    capturedAt:
      new Date().toISOString(),

    providers:
      providers
        .filter(
          isEligibleForHistory
        )
        .map(
          sanitizeProvider
        )
        .filter(Boolean)
  };
}

function appendSnapshot(providers) {
  ensureStorage();

  if (
    !Array.isArray(providers) ||
    providers.length === 0
  ) {
    return null;
  }

  const snapshot =
    createSnapshot(
      providers
    );

  if (
    snapshot.providers.length === 0
  ) {
    return null;
  }

  fs.appendFileSync(
    HISTORY_FILE,
    JSON.stringify(snapshot) +
      "\n",
    "utf8"
  );

  return snapshot;
}

function readSnapshots() {
  ensureStorage();

  let content;

  try {
    content =
      fs.readFileSync(
        HISTORY_FILE,
        "utf8"
      );
  } catch {
    return [];
  }

  if (!content.trim()) {
    return [];
  }

  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .map(
      (line) => {
        try {
          return JSON.parse(
            line
          );
        } catch {
          return null;
        }
      }
    )
    .filter(Boolean)
    .sort(
      (a, b) =>
        new Date(
          a.capturedAt
        ).getTime() -
        new Date(
          b.capturedAt
        ).getTime()
    );
}

function getHistory(
  hours = 24
) {
  const safeHours =
    Math.min(
      MAX_HISTORY_DAYS * 24,
      Math.max(
        1,
        Number(hours) || 24
      )
    );

  const cutoff =
    Date.now() -
    safeHours *
      60 *
      60 *
      1000;

  return readSnapshots()
    .filter(
      (snapshot) =>
        new Date(
          snapshot.capturedAt
        ).getTime() >= cutoff
    );
}

function getStats() {
  const snapshots =
    readSnapshots();

  if (!snapshots.length) {
    return {
      snapshots: 0,
      firstCapturedAt: null,
      lastCapturedAt: null
    };
  }

  return {
    snapshots:
      snapshots.length,

    firstCapturedAt:
      snapshots[0]
        .capturedAt,

    lastCapturedAt:
      snapshots[
        snapshots.length - 1
      ].capturedAt
  };
}

module.exports = {
  appendSnapshot,
  getHistory,
  getStats,
  isEligibleForHistory,
  sanitizeProvider
};