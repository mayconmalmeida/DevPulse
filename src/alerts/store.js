/*
 * Alert store — v0.12.0.
 *
 * Mesmo padrão .jsonl append-only de history/activity, mas
 * um alerta tem CICLO DE VIDA (active -> acknowledged/
 * resolved), diferente de um evento de activity (que é só
 * um fato pontual). Resolvido assim: cada linha é o estado
 * COMPLETO do alerta naquele momento (criado, escalado,
 * confirmado ou resolvido); o estado "atual" de um alerta é
 * sempre a ÚLTIMA linha com aquele `id`.
 *
 * `id` é DETERMINÍSTICO por condição (ex.: "codex:quota:
 * primary", "ollama:health") — não um UUID aleatório. Isso
 * é o que garante, de graça, que:
 *   - a mesma condição nunca vira uma linha nova enquanto
 *     ainda está ativa (dedupe real, não por timestamp);
 *   - um restart do DevPulse não recria o alerta do zero —
 *     ele relê a última linha do id e continua dali.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(
  __dirname,
  "../../data"
);

const ALERTS_FILE = path.join(
  DATA_DIR,
  "alerts.jsonl"
);

const MAX_RETENTION_DAYS = 60;
const MAX_RECENT_RETURNED = 100;

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(
      DATA_DIR,
      { recursive: true }
    );
  }

  if (!fs.existsSync(ALERTS_FILE)) {
    fs.writeFileSync(
      ALERTS_FILE,
      "",
      "utf8"
    );
  }
}

/*
 * Só aceita os campos esperados — nunca grava um objeto
 * arbitrário (mesma defesa que activity/store.js já usa).
 * Exportada separada da escrita em disco (mesmo padrão de
 * sanitizeProvider em history/store.js) para ser testável
 * como função pura, sem tocar em data/alerts.jsonl.
 */
function sanitizeAlert(alert) {
  if (!alert?.id || !alert?.state) {
    return null;
  }

  return {
    id: alert.id,
    createdAt: alert.createdAt,
    updatedAt:
      alert.updatedAt ||
      new Date().toISOString(),

    providerId: alert.providerId,
    type: alert.type,
    severity: alert.severity,
    title: alert.title,
    message: alert.message,
    state: alert.state,

    meta:
      alert.meta &&
      typeof alert.meta === "object"
        ? alert.meta
        : {},

    lastNotifiedSeverity:
      alert.lastNotifiedSeverity || null
  };
}

/*
 * Único ponto de escrita real em disco.
 */
function appendAlertState(alert) {
  const record = sanitizeAlert(alert);

  if (!record) {
    return null;
  }

  ensureStorage();

  fs.appendFileSync(
    ALERTS_FILE,
    JSON.stringify(record) + "\n",
    "utf8"
  );

  return record;
}

function readAllRecords() {
  ensureStorage();

  let content;

  try {
    content = fs.readFileSync(
      ALERTS_FILE,
      "utf8"
    );
  } catch {
    return [];
  }

  if (!content.trim()) {
    return [];
  }

  const cutoff =
    Date.now() -
    MAX_RETENTION_DAYS *
      24 *
      60 *
      60 *
      1000;

  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((record) => {
      const time = new Date(
        record.updatedAt
      ).getTime();

      return (
        Number.isFinite(time) &&
        time >= cutoff
      );
    });
}

/*
 * Estado atual = última linha de cada `id`. Preserva a
 * ORDEM de primeira aparição do id, mas com os dados mais
 * recentes — assim o "createdAt" original nunca se perde.
 */
function latestStateById() {
  const records = readAllRecords();

  const latest = new Map();

  for (const record of records) {
    latest.set(record.id, record);
  }

  return [...latest.values()].sort(
    (a, b) =>
      new Date(a.updatedAt).getTime() -
      new Date(b.updatedAt).getTime()
  );
}

/*
 * Lê o estado ATUAL de um alerta específico (última linha
 * daquele id), ou null se nunca existiu.
 */
function getAlertById(id) {
  const records = readAllRecords();

  let found = null;

  for (const record of records) {
    if (record.id === id) {
      found = record;
    }
  }

  return found;
}

function getActiveAlerts() {
  return latestStateById().filter(
    (alert) => alert.state === "active"
  );
}

function getRecentAlerts(
  limit = 20
) {
  const safeLimit = Math.min(
    MAX_RECENT_RETURNED,
    Math.max(1, Number(limit) || 20)
  );

  return latestStateById()
    .slice(-safeLimit)
    .reverse();
}

/*
 * Confirma um alerta ATIVO (Fase 6 — endpoint opcional de
 * acknowledge). Só age sobre um alerta que exista e esteja
 * "active" — nunca cria um alerta novo, nunca reabre um já
 * resolvido. Grava uma nova linha (mesmo padrão de "estado
 * completo mais recente") preservando id/createdAt/dados
 * originais, só trocando `state`.
 */
function acknowledgeAlert(id) {
  const current = getAlertById(id);

  if (!current) {
    return {
      ok: false,
      error: "ALERT_NOT_FOUND"
    };
  }

  if (current.state !== "active") {
    return {
      ok: false,
      error: "ALERT_NOT_ACTIVE",
      alert: current
    };
  }

  const record = appendAlertState({
    ...current,
    state: "acknowledged",
    updatedAt: new Date().toISOString()
  });

  return {
    ok: true,
    alert: record
  };
}

module.exports = {
  appendAlertState,
  sanitizeAlert,
  getAlertById,
  getActiveAlerts,
  getRecentAlerts,
  acknowledgeAlert
};
