/*
 * Orquestra avaliação -> persistência -> notificação.
 *
 * Importante: a decisão de "já existe alerta ativo nessa
 * condição" vem sempre do STORE (última linha persistida
 * daquele id), nunca de estado em memória — é isso que
 * garante que um restart do DevPulse não recria/duplica um
 * alerta que já estava ativo (Fase 5/11 do pedido).
 *
 * A única coisa mantida em memória é `staleTracking` (desde
 * quando um provider está "stale" sem interrupção) — perder
 * isso num restart é seguro por natureza: na pior hipótese
 * o DevPulse fica mais cauteloso por mais alguns minutos
 * logo após reiniciar, nunca gera alerta demais.
 */

const { getConfig } = require("./config");
const {
  appendAlertState,
  getAlertById
} = require("./store");

const {
  evaluateQuotaAlerts,
  evaluateHealthAlert
} = require("./evaluator");

const {
  sendWindowsNotification
} = require("./notifier");

const staleTracking = new Map();

function shouldNotify(transition) {
  if (
    transition.action !== "create" &&
    transition.action !== "escalate"
  ) {
    return false;
  }

  const severity = transition.alert.severity;

  // Nunca notifica por "info" — só warning/critical, e só
  // critical tem prioridade real (Fase 7).
  if (severity !== "warning" && severity !== "critical") {
    return false;
  }

  // Cooldown: já notificamos essa MESMA severidade para
  // esse alerta? Não notifica de novo (Fase 8).
  return (
    transition.alert.lastNotifiedSeverity !== severity
  );
}

function applyTransition(
  transition,
  config,
  { appendAlertState, sendWindowsNotification }
) {
  if (
    !transition ||
    transition.action === "none"
  ) {
    return null;
  }

  let alertToWrite = transition.alert;

  const notificationsAllowed =
    config.alertsEnabled &&
    config.windowsNotificationsEnabled;

  if (
    notificationsAllowed &&
    shouldNotify(transition)
  ) {
    sendWindowsNotification(alertToWrite);

    alertToWrite = {
      ...alertToWrite,
      lastNotifiedSeverity:
        alertToWrite.severity
    };
  }

  if (transition.action === "resolve") {
    /*
     * Limpa o cooldown ao resolver — se a mesma condição
     * voltar a acontecer depois, é um alerta novo e
     * legítimo, deve notificar de novo (ver Fase 8: "89 ->
     * 90 -> novo critical legítimo").
     */
    alertToWrite = {
      ...alertToWrite,
      lastNotifiedSeverity: null
    };
  }

  return appendAlertState(alertToWrite);
}

/*
 * Chamado pelo backend a cada leitura "ao vivo" bem-sucedida
 * OU quando um snapshot volta "stale" (ver
 * src/providers/runtime.js) — nunca a cada resposta servida
 * de cache, isso é o que evita reavaliar/notificar a cada
 * polling sem mudança real.
 *
 * `deps` é injetável só para teste (mesmo padrão de
 * recordActivity em src/activity/tracker.js — ver
 * test/smoke.js) — em produção são sempre as implementações
 * reais (config/store/notifier de verdade, Map de
 * staleTracking compartilhado no módulo).
 */
function evaluateAndPersistAlerts(
  provider,
  currentSnapshot,
  deps = {}
) {
  const resolvedGetConfig =
    deps.getConfig || getConfig;

  const resolvedGetExisting =
    deps.getExisting ||
    ((id) => getAlertById(id));

  const resolvedAppendAlertState =
    deps.appendAlertState || appendAlertState;

  const resolvedSendWindowsNotification =
    deps.sendWindowsNotification ||
    sendWindowsNotification;

  const resolvedStaleTracking =
    deps.staleTracking || staleTracking;

  const config = resolvedGetConfig();

  if (!config.alertsEnabled || !currentSnapshot) {
    return [];
  }

  const written = [];

  const quotaTransitions =
    evaluateQuotaAlerts({
      provider,
      currentSnapshot,
      config,
      getExisting: resolvedGetExisting
    });

  for (const transition of quotaTransitions) {
    const record = applyTransition(
      transition,
      config,
      {
        appendAlertState: resolvedAppendAlertState,
        sendWindowsNotification:
          resolvedSendWindowsNotification
      }
    );

    if (record) {
      written.push(record);
    }
  }

  const healthTransition =
    evaluateHealthAlert({
      provider,
      currentSnapshot,
      getExisting: resolvedGetExisting,
      staleTracking: resolvedStaleTracking
    });

  const healthRecord = applyTransition(
    healthTransition,
    config,
    {
      appendAlertState: resolvedAppendAlertState,
      sendWindowsNotification:
        resolvedSendWindowsNotification
    }
  );

  if (healthRecord) {
    written.push(healthRecord);
  }

  return written;
}

module.exports = {
  evaluateAndPersistAlerts
};
