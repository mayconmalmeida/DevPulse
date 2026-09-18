/*
 * Configuração local de alerts — v0.12.0.
 *
 * Diferente de history.jsonl/activity.jsonl (logs
 * append-only), config é UM objeto mutável — por isso vive
 * num JSON simples (data/alerts-config.json), reescrito
 * inteiro a cada mudança, e não num .jsonl.
 *
 * O backend é a fonte de verdade (o avaliador de alerts
 * roda no servidor, não no browser) — o frontend só lê/
 * escreve via API, nunca decide sozinho com localStorage.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(
  __dirname,
  "../../data"
);

const CONFIG_FILE = path.join(
  DATA_DIR,
  "alerts-config.json"
);

/*
 * Mesmos thresholds que o dock/detail já usam no frontend
 * (healthForPercent em pulse.js) — aqui é a cópia usada
 * pelo BACKEND para decidir alerts. Documentado para não
 * divergir por acidente: < warning = normal, >= warning e
 * < critical = warning, >= critical = critical.
 */
const DEFAULT_CONFIG = {
  alertsEnabled: true,
  windowsNotificationsEnabled: true,
  warningThreshold: 70,
  criticalThreshold: 90
};

function isValidConfig(config) {
  if (!config || typeof config !== "object") {
    return false;
  }

  const {
    warningThreshold,
    criticalThreshold
  } = config;

  if (
    typeof warningThreshold !== "number" ||
    typeof criticalThreshold !== "number"
  ) {
    return false;
  }

  /*
   * Regra explícita do pedido:
   * 0 <= warning < critical <= 100
   */
  return (
    warningThreshold >= 0 &&
    warningThreshold < criticalThreshold &&
    criticalThreshold <= 100
  );
}

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(
      DATA_DIR,
      { recursive: true }
    );
  }

  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify(
        DEFAULT_CONFIG,
        null,
        2
      ),
      "utf8"
    );
  }
}

function getConfig() {
  ensureStorage();

  try {
    const raw = fs.readFileSync(
      CONFIG_FILE,
      "utf8"
    );

    const parsed = JSON.parse(raw);

    if (!isValidConfig(parsed)) {
      return { ...DEFAULT_CONFIG };
    }

    return {
      alertsEnabled:
        typeof parsed.alertsEnabled === "boolean"
          ? parsed.alertsEnabled
          : DEFAULT_CONFIG.alertsEnabled,

      windowsNotificationsEnabled:
        typeof parsed.windowsNotificationsEnabled === "boolean"
          ? parsed.windowsNotificationsEnabled
          : DEFAULT_CONFIG.windowsNotificationsEnabled,

      warningThreshold: parsed.warningThreshold,
      criticalThreshold: parsed.criticalThreshold
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/*
 * Só aceita um patch PARCIAL e válido — nunca escreve um
 * config quebrado. Retorna { ok, config, error }.
 */
function updateConfig(patch) {
  const current = getConfig();

  const next = {
    ...current,
    ...(patch && typeof patch === "object"
      ? patch
      : {})
  };

  if (!isValidConfig(next)) {
    return {
      ok: false,
      error: "INVALID_ALERTS_CONFIG",
      config: current
    };
  }

  ensureStorage();

  fs.writeFileSync(
    CONFIG_FILE,
    JSON.stringify(next, null, 2),
    "utf8"
  );

  return {
    ok: true,
    config: next
  };
}

module.exports = {
  getConfig,
  updateConfig,
  isValidConfig,
  DEFAULT_CONFIG
};
