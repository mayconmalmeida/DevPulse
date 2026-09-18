/*
 * Detecta transições REAIS entre um snapshot anterior e um
 * novo snapshot de um provider, e grava um evento por
 * mudança — nunca por polling. Se nada mudou, nenhum evento
 * é gerado (deduplicação por definição: comparar valor
 * anterior x atual, não por timestamp).
 *
 * Só olha para campos já sanitizados que os próprios
 * adapters retornam (nunca lê nada bruto de API/arquivo) —
 * o payload gravado é sempre um subconjunto pequeno e
 * tipado desses campos, nunca o snapshot inteiro.
 */

const { appendEvent } = require("./store");

function round(value) {
  return typeof value === "number" &&
    Number.isFinite(value)
    ? Math.round(value)
    : null;
}

function modelNames(list) {
  return new Set(
    (Array.isArray(list) ? list : [])
      .map((model) => model?.name)
      .filter(Boolean)
  );
}

/*
 * "append" é injetável só para teste (ver
 * test/smoke.js) — em produção é sempre a escrita real
 * em data/activity.jsonl.
 */
function recordActivity(
  provider,
  previousSnapshot,
  currentSnapshot,
  append = appendEvent
) {
  if (!provider?.capabilities?.activity) {
    return [];
  }

  if (!currentSnapshot) {
    return [];
  }

  const timestamp = new Date().toISOString();
  const events = [];

  const pushEvent = (type, payload) => {
    events.push({
      timestamp,
      providerId: provider.id,
      type,
      payload: payload || {}
    });
  };

  /*
   * Transição de status — genérico, vale para qualquer
   * provider (ex.: not-installed -> ok, ok -> offline).
   * Só compara se já havia um snapshot anterior; a
   * primeira leitura da sessão não é "mudança".
   */
  if (
    previousSnapshot &&
    previousSnapshot.status !==
      currentSnapshot.status
  ) {
    pushEvent("status-changed", {
      from: previousSnapshot.status ?? null,
      to: currentSnapshot.status ?? null
    });
  }

  /*
   * Quota (Codex/Claude): percentual mudou de verdade
   * (comparado como inteiro, para não gerar ruído por
   * casas decimais/telemetria de milissegundos).
   */
  if (
    provider.capabilities.quota &&
    currentSnapshot.windows
  ) {
    for (const windowKey of [
      "primary",
      "secondary"
    ]) {
      const prevWindow =
        previousSnapshot?.windows?.[
          windowKey
        ];

      const currWindow =
        currentSnapshot.windows[
          windowKey
        ];

      const prevPercent = round(
        prevWindow?.usedPercent
      );

      const currPercent = round(
        currWindow?.usedPercent
      );

      if (
        prevPercent !== null &&
        currPercent !== null &&
        prevPercent !== currPercent
      ) {
        pushEvent("quota-changed", {
          window: windowKey,
          label: currWindow?.label ?? null,
          from: prevPercent,
          to: currPercent
        });
      }
    }
  }

  /*
   * Runtime local (Ollama): online/offline.
   */
  if (provider.capabilities.runtime) {
    const prevOnline =
      previousSnapshot?.online;

    const currOnline =
      currentSnapshot.online;

    if (
      typeof prevOnline === "boolean" &&
      typeof currOnline === "boolean" &&
      prevOnline !== currOnline
    ) {
      pushEvent(
        currOnline
          ? "runtime-online"
          : "runtime-offline",
        {}
      );
    }
  }

  /*
   * Modelos (Ollama): o que entrou/saiu de /api/ps desde a
   * última leitura bem-sucedida.
   */
  if (provider.capabilities.models) {
    const prevLoaded = modelNames(
      previousSnapshot?.loadedModels
    );

    const currLoaded = modelNames(
      currentSnapshot.loadedModels
    );

    for (const name of currLoaded) {
      if (!prevLoaded.has(name)) {
        pushEvent("model-loaded", {
          model: name
        });
      }
    }

    for (const name of prevLoaded) {
      if (!currLoaded.has(name)) {
        pushEvent("model-unloaded", {
          model: name
        });
      }
    }
  }

  /*
   * Atividade própria (OpenCode): sessões/mensagens dos
   * últimos 7 dias mudaram desde a última leitura.
   */
  if (
    currentSnapshot.activity &&
    typeof currentSnapshot.activity ===
      "object"
  ) {
    const prevActivity =
      previousSnapshot?.activity;

    const currActivity =
      currentSnapshot.activity;

    const changed =
      !prevActivity ||
      prevActivity.sessions !==
        currActivity.sessions ||
      prevActivity.messages !==
        currActivity.messages;

    if (changed && prevActivity) {
      pushEvent("activity-changed", {
        sessions:
          currActivity.sessions ?? null,
        messages:
          currActivity.messages ?? null
      });
    }
  }

  for (const event of events) {
    append(event);
  }

  return events;
}

module.exports = {
  recordActivity
};
