/*
 * Avaliador de alerts — v0.12.0.
 *
 * Funções puras: recebem snapshots/config/estado atual e
 * devolvem TRANSIÇÕES (o que deveria virar uma nova linha
 * no store), sem tocar em arquivo nenhum. Isso é o que
 * permite testar as 20 regras do smoke suite só com
 * fixtures, sem depender da máquina real.
 *
 * ALERT != ACTIVITY: aqui só decidimos "isso merece
 * atenção?" — quem registra FATOS é src/activity/tracker.js
 * (já existe, v0.11.0). Os dois observam os mesmos
 * snapshots, mas com propósitos diferentes.
 */

/*
 * < warning              -> normal
 * >= warning e < critical -> warning
 * >= critical             -> critical
 *
 * Thresholds do PRÓPRIO DevPulse (config), nunca
 * apresentados como classificação oficial do provider.
 */
function tierForPercent(percent, config) {
  if (typeof percent !== "number" || !Number.isFinite(percent)) {
    return "normal";
  }

  if (percent >= config.criticalThreshold) {
    return "critical";
  }

  if (percent >= config.warningThreshold) {
    return "warning";
  }

  return "normal";
}

function severityToTier(severity) {
  if (severity === "critical") return "critical";
  if (severity === "warning") return "warning";
  return "normal";
}

/*
 * Uma transição descreve o que deveria acontecer com UM
 * alerta (identificado por id determinístico). `action` é
 * só para o chamador decidir se deve notificar — o estado
 * final gravado é sempre o mesmo formato (ver
 * src/alerts/store.js).
 */
function buildTransition({
  action,
  id,
  existing,
  providerId,
  type,
  severity,
  title,
  message,
  meta
}) {
  const now = new Date().toISOString();

  return {
    action, // "create" | "escalate" | "resolve" | "none"
    alert: {
      id,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      providerId,
      type,
      severity,
      title,
      message,
      state:
        action === "resolve"
          ? "resolved"
          : existing?.state === "acknowledged" &&
              action !== "escalate"
            ? "acknowledged"
            : "active",
      meta: meta || {},
      lastNotifiedSeverity:
        existing?.lastNotifiedSeverity || null
    }
  };
}

/*
 * Codex/Claude (ou qualquer provider com capabilities.quota)
 * — uma transição por janela (primary/secondary) que tenha
 * percentual real. Usa o `id` real da janela do snapshot
 * (ex.: "five_hour"/"seven_day" no Claude, "primary"/
 * "secondary" no Codex) — nunca assume nomes fixos.
 */
function evaluateQuotaAlerts({
  provider,
  currentSnapshot,
  config,
  getExisting
}) {
  const transitions = [];

  if (
    !provider?.capabilities?.quota ||
    !currentSnapshot?.windows ||
    !currentSnapshot.connected
  ) {
    return transitions;
  }

  for (const windowKey of ["primary", "secondary"]) {
    const windowData =
      currentSnapshot.windows[windowKey];

    if (
      !windowData ||
      typeof windowData.usedPercent !== "number"
    ) {
      continue;
    }

    const windowId =
      windowData.id || windowKey;

    const alertId = `${provider.id}:quota:${windowId}`;
    const existing = getExisting(alertId);

    const currentTier = tierForPercent(
      windowData.usedPercent,
      config
    );

    /*
     * "ongoing" inclui "active" E "acknowledged" — um alerta
     * confirmado pelo usuário continua sendo a MESMA condição
     * até resolver ou escalar. Tratar só "active" aqui faria
     * um alerta acknowledged, sem nenhuma mudança real, virar
     * "create" de novo a cada polling (gravando linha nova
     * sem necessidade e perdendo o estado acknowledged).
     */
    const existingOngoing =
      existing?.state === "active" ||
      existing?.state === "acknowledged";

    const existingTier = existingOngoing
      ? severityToTier(existing.severity)
      : "normal";

    const meta = {
      windowId,
      windowLabel: windowData.label || null,
      percent: Math.round(windowData.usedPercent),
      warningThreshold: config.warningThreshold,
      criticalThreshold: config.criticalThreshold
    };

    if (currentTier === "normal") {
      if (existingOngoing) {
        transitions.push(
          buildTransition({
            action: "resolve",
            id: alertId,
            existing,
            providerId: provider.id,
            type: "quota",
            severity: existing.severity,
            title: existing.title,
            message: `Voltou a ${meta.percent}%, abaixo do limite de atenção do DevPulse (${config.warningThreshold}%).`,
            meta
          })
        );
      }

      continue;
    }

    if (existingOngoing && existingTier === currentTier) {
      // já ativo/confirmado na mesma faixa — não duplica.
      continue;
    }

    const title = `${provider.name} · ${meta.windowLabel || windowId}`;

    const message = `${meta.percent}% utilizado (limite ${currentTier === "critical" ? "crítico" : "de atenção"} do DevPulse: ${currentTier === "critical" ? config.criticalThreshold : config.warningThreshold}%).`;

    transitions.push(
      buildTransition({
        action: existingOngoing ? "escalate" : "create",
        id: alertId,
        existing,
        providerId: provider.id,
        type: "quota",
        severity: currentTier,
        title,
        message,
        meta
      })
    );
  }

  return transitions;
}

/*
 * Condição de saúde derivada do `status` do snapshot —
 * genérica para qualquer provider (Codex/Claude/Ollama/
 * OpenCode). Nunca gera alerta para not-installed/detected
 * (ausência de instalação não é um problema).
 */
function classifyHealthCondition(status) {
  if (status === "ok") {
    return "healthy";
  }

  if (status === "offline" || status === "error") {
    return "degraded-confirmed";
  }

  if (status === "stale") {
    return "degraded-transient";
  }

  // not-installed, detected, adapter_pending, etc.
  return "not-applicable";
}

/*
 * `staleTracking` é um Map (providerId -> timestamp da
 * primeira leitura "stale" consecutiva), mantido em memória
 * pelo chamador (ver src/alerts/engine.js) — evita alertar
 * por uma falha de rede pontual dentro de um único ciclo de
 * TTL.
 */
const STALE_PERSISTENCE_MS = 5 * 60 * 1000;

function evaluateHealthAlert({
  provider,
  currentSnapshot,
  getExisting,
  staleTracking,
  now = Date.now()
}) {
  if (!currentSnapshot) {
    return null;
  }

  const alertId = `${provider.id}:health`;
  const existing = getExisting(alertId);

  const existingOngoing =
    existing?.state === "active" ||
    existing?.state === "acknowledged";

  const condition = classifyHealthCondition(
    currentSnapshot.status
  );

  if (condition === "healthy" || condition === "not-applicable") {
    staleTracking.delete(provider.id);

    if (existingOngoing) {
      return buildTransition({
        action: "resolve",
        id: alertId,
        existing,
        providerId: provider.id,
        type: "health",
        severity: existing.severity,
        title: existing.title,
        message: `${provider.name} voltou ao normal.`,
        meta: { status: currentSnapshot.status }
      });
    }

    return null;
  }

  if (condition === "degraded-confirmed") {
    staleTracking.delete(provider.id);

    if (existingOngoing) {
      return null;
    }

    return buildTransition({
      action: "create",
      id: alertId,
      existing,
      providerId: provider.id,
      type: "health",
      severity: "warning",
      title: `${provider.name} indisponível`,
      message:
        currentSnapshot.status === "error"
          ? "Falha ao consultar este provider."
          : "Provider offline no momento.",
      meta: { status: currentSnapshot.status }
    });
  }

  // degraded-transient (stale)
  const firstStaleAt =
    staleTracking.get(provider.id) || now;

  if (!staleTracking.has(provider.id)) {
    staleTracking.set(provider.id, now);
  }

  const persistedMs = now - firstStaleAt;

  if (
    persistedMs < STALE_PERSISTENCE_MS ||
    existingOngoing
  ) {
    // ainda dentro da janela de ruído, ou já alertado.
    return null;
  }

  return buildTransition({
    action: "create",
    id: alertId,
    existing,
    providerId: provider.id,
    type: "health",
    severity: "warning",
    title: `${provider.name} instável`,
    message: `Sem leitura nova há mais de ${Math.round(
      STALE_PERSISTENCE_MS / 60000
    )} min — mostrando o último dado válido.`,
    meta: { status: currentSnapshot.status }
  });
}

module.exports = {
  tierForPercent,
  evaluateQuotaAlerts,
  evaluateHealthAlert,
  classifyHealthCondition,
  STALE_PERSISTENCE_MS
};
