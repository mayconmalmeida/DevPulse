/*
 * Activity Timeline — persistência local, separada do
 * history.jsonl de quota (ver src/history/store.js).
 *
 * Quota History  = série temporal de percentuais (Codex/
 *                   Claude), uma linha por snapshot salvo.
 * Activity Timeline = eventos discretos ("isso mudou",
 *                   "aquilo aconteceu"), uma linha por
 *                   evento REAL detectado pelo tracker
 *                   (ver ./tracker.js) — nunca por polling.
 *
 * Mesmo padrão de arquivo (.jsonl, append-only) do
 * history.jsonl, para não introduzir uma convenção nova
 * sem necessidade.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.resolve(
  __dirname,
  "../../data"
);

const ACTIVITY_FILE = path.join(
  DATA_DIR,
  "activity.jsonl"
);

/*
 * Retenção mais curta que a de quota (90 dias): eventos são
 * muito mais numerosos por natureza, e "o que aconteceu
 * recentemente" perde relevância operacional bem antes de
 * 90 dias.
 */
const MAX_RETENTION_DAYS = 30;

const MAX_EVENTS_RETURNED = 100;

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(
      DATA_DIR,
      {
        recursive: true
      }
    );
  }

  if (!fs.existsSync(ACTIVITY_FILE)) {
    fs.writeFileSync(
      ACTIVITY_FILE,
      "",
      "utf8"
    );
  }
}

/*
 * Único ponto de escrita — só aceita os campos sanitizados
 * esperados. Nunca grava um objeto arbitrário (isso evita
 * que uma resposta bruta de provider vaze para o arquivo
 * por engano em alguma chamada futura).
 */
function appendEvent({
  timestamp,
  providerId,
  type,
  payload
}) {
  if (!providerId || !type) {
    return null;
  }

  ensureStorage();

  const event = {
    timestamp:
      timestamp ||
      new Date().toISOString(),

    providerId,
    type,

    payload:
      payload &&
      typeof payload === "object"
        ? payload
        : {}
  };

  fs.appendFileSync(
    ACTIVITY_FILE,
    JSON.stringify(event) + "\n",
    "utf8"
  );

  return event;
}

function readEvents() {
  ensureStorage();

  let content;

  try {
    content = fs.readFileSync(
      ACTIVITY_FILE,
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
    .filter((event) => {
      const time = new Date(
        event.timestamp
      ).getTime();

      return (
        Number.isFinite(time) &&
        time >= cutoff
      );
    })
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() -
        new Date(b.timestamp).getTime()
    );
}

function getRecentActivity(
  limit = 20
) {
  const safeLimit = Math.min(
    MAX_EVENTS_RETURNED,
    Math.max(1, Number(limit) || 20)
  );

  const events = readEvents();

  return events
    .slice(-safeLimit)
    .reverse();
}

function getActivityStats() {
  const events = readEvents();

  if (!events.length) {
    return {
      events: 0,
      firstRecordedAt: null,
      lastRecordedAt: null
    };
  }

  return {
    events: events.length,
    firstRecordedAt:
      events[0].timestamp,
    lastRecordedAt:
      events[events.length - 1]
        .timestamp
  };
}

module.exports = {
  appendEvent,
  getRecentActivity,
  getActivityStats
};
