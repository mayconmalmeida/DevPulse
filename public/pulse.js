const $ = (id) =>
  document.getElementById(id);

/* =========================================================
   PROVIDER METADATA
========================================================= */

const PROVIDER_ORDER = [
  "codex",
  "claude",
  "ollama",
  "opencode",
  "gemini",
  "cursor"
];

/*
 * Mapeamento central de identidade visual por provider.
 *
 * `image` aponta para um asset OFICIAL armazenado
 * localmente em /public/providers/ (sem hotlink, sem
 * base64, sem CDN externo). `initials` é usado apenas
 * como fallback técnico caso o arquivo não carregue —
 * nunca é o visual normal.
 *
 * Origem de cada asset (auditoria):
 * - codex/openai.png    -> favicon oficial de openai.com
 * - claude/anthropic.png -> apple-touch-icon oficial de
 *   anthropic.com (cdn.prod.website-files.com, domínio
 *   da própria Anthropic)
 * - ollama/ollama.png   -> imagem do README oficial de
 *   github.com/ollama/ollama
 * - gemini/gemini.png   -> ícone oficial servido por
 *   gstatic.com (link <link rel="icon"> de
 *   gemini.google.com)
 * - opencode/opencode.svg -> brand asset oficial em
 *   github.com/anomalyco/opencode
 *   (packages/console/app/src/asset/brand)
 * - cursor/cursor.svg   -> brand kit oficial publicado em
 *   cursor.com (General Logos/Cube)
 *
 * Um provider sem entrada aqui (ou sem asset confirmado)
 * cai automaticamente no fallback de iniciais — nunca
 * inventamos um logo.
 */
const PROVIDER_VISUALS = {
  codex: {
    name: "Codex",
    initials: "CX",
    image: "/providers/openai.png",
    imageAlt: "OpenAI"
  },

  claude: {
    name: "Claude",
    initials: "CL",
    image: "/providers/anthropic.png",
    imageAlt: "Anthropic"
  },

  ollama: {
    name: "Ollama",
    initials: "OL",
    image: "/providers/ollama.png",
    imageAlt: "Ollama"
  },

  opencode: {
    name: "OpenCode",
    initials: "OC",
    image: "/providers/opencode.svg",
    imageAlt: "OpenCode"
  },

  gemini: {
    name: "Gemini",
    initials: "GM",
    image: "/providers/gemini.png",
    imageAlt: "Google Gemini"
  },

  cursor: {
    name: "Cursor",
    initials: "CR",
    image: "/providers/cursor.svg",
    imageAlt: "Cursor"
  }
};

/*
 * Alias mantido para não quebrar nenhuma referência
 * antiga a PROVIDER_META dentro deste arquivo.
 */
const PROVIDER_META = PROVIDER_VISUALS;

const RING_RADIUS = 20;

const RING_CIRCUMFERENCE =
  2 * Math.PI * RING_RADIUS;

const REDUCED_MOTION =
  window.matchMedia &&
  window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

const DETAIL_CLOSE_TRANSITION_MS =
  REDUCED_MOTION ? 0 : 190;

/* =========================================================
   STATE
========================================================= */

let providers = [];
let detection = [];

/*
 * Só passa a "true" depois que o primeiro fetch real
 * (providers/detection) responde — antes disso o dock
 * nunca deve afirmar que um provider está indisponível.
 */
let dataLoaded = false;

let selectedProviderId = null;

let windowTransitioning = false;

/*
 * Fila de intenção de 1 posição: se o usuário interage de
 * novo enquanto uma transição de janela nativa ainda está
 * em andamento, a intenção mais recente substitui qualquer
 * outra pendente (nunca acumula) e é executada assim que a
 * transição atual terminar — "a última intenção vence",
 * sem nunca disparar dois POSTs de resize concorrentes.
 */
let pendingIntent = null;

function scheduleIntent(intentFn) {
  pendingIntent = intentFn;
  drainPendingIntent();
}

function drainPendingIntent() {
  if (
    windowTransitioning ||
    !pendingIntent
  ) {
    return;
  }

  const next = pendingIntent;
  pendingIntent = null;
  next();
}

const MODE_PREFERENCE_KEY =
  "pulse.modePreference";

const LEGACY_MODE_KEY =
  "devpulse:pulse-mode";

const LEGACY_COLLAPSED_KEY =
  "devpulse:pulse-collapsed";

let mode = resolveInitialMode();

function resolveInitialMode() {
  const stored = localStorage.getItem(
    MODE_PREFERENCE_KEY
  );

  if (
    stored === "expanded" ||
    stored === "dock"
  ) {
    return stored;
  }

  /*
   * Migração de instalações anteriores do Pulse — em
   * nenhuma versão "detail" foi (ou deve ser) restaurado
   * como preferência inicial.
   */

  const legacyMode =
    localStorage.getItem(
      LEGACY_MODE_KEY
    );

  if (
    legacyMode === "expanded" ||
    legacyMode === "dock"
  ) {
    return legacyMode;
  }

  const legacyCollapsed =
    localStorage.getItem(
      LEGACY_COLLAPSED_KEY
    );

  return legacyCollapsed === "1"
    ? "dock"
    : "expanded";
}

function persistModePreference(nextMode) {
  /*
   * Só dock/expanded são preferência de startup válida —
   * detail é contextual/transitório e nunca é persistido.
   */

  if (
    nextMode !== "dock" &&
    nextMode !== "expanded"
  ) {
    return;
  }

  localStorage.setItem(
    MODE_PREFERENCE_KEY,
    nextMode
  );
}

/* =========================================================
   UTIL
========================================================= */

function clamp(value) {
  return Math.min(
    100,
    Math.max(
      0,
      Number(value) || 0
    )
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatBytes(bytes) {
  if (
    typeof bytes !== "number" ||
    !Number.isFinite(bytes) ||
    bytes < 0
  ) {
    return null;
  }

  const units = ["B", "KB", "MB", "GB", "TB"];

  let value = bytes;
  let unitIndex = 0;

  while (
    value >= 1024 &&
    unitIndex < units.length - 1
  ) {
    value /= 1024;
    unitIndex += 1;
  }

  const decimals =
    unitIndex > 0 && value < 10
      ? 1
      : 0;

  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

function waitForMs(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, ms)
  );
}

function providerInitial(provider) {
  if (provider.id === "codex") {
    return "CX";
  }

  if (provider.id === "claude") {
    return "CL";
  }

  return String(
    provider.name || "AI"
  )
    .slice(0, 2)
    .toUpperCase();
}

function iconMarkup(meta) {
  if (meta.image) {
    /*
     * Fallback técnico: se o asset local não carregar por
     * qualquer motivo, mostramos as iniciais em vez de um
     * logo quebrado — nunca um ícone inventado.
     */
    return `
      <img
        src="${meta.image}"
        alt="${escapeHtml(meta.imageAlt || meta.name || "")}"
        class="provider-visual"
        onerror="this.style.display='none';var f=this.nextElementSibling;if(f)f.style.display='grid';"
      >
      <span
        class="dock-item-icon-fallback provider-visual-fallback"
        style="display:none"
      >
        ${escapeHtml(meta.initials || "")}
      </span>
    `;
  }

  return `
    <span class="dock-item-icon-fallback">
      ${escapeHtml(meta.initials || "?")}
    </span>
  `;
}

function healthForPercent(percent) {
  const value =
    Number(percent) || 0;

  if (value >= 90) {
    return "critical";
  }

  if (value >= 70) {
    return "warning";
  }

  return "normal";
}

function getRelevantWindow(provider) {
  /*
   * Pulse:
   *
   * Codex  -> limite de 5 h
   * Claude -> limite semanal
   */

  if (!provider) {
    return null;
  }

  if (provider.id === "claude") {
    return (
      provider.windows?.secondary ||
      provider.windows?.primary ||
      null
    );
  }

  return (
    provider.windows?.primary ||
    provider.windows?.secondary ||
    null
  );
}

function formatDuration(dateValue) {
  if (!dateValue) {
    return "—";
  }

  const target =
    new Date(dateValue).getTime();

  const diff =
    target - Date.now();

  if (!Number.isFinite(diff)) {
    return "—";
  }

  if (diff <= 0) {
    return "agora";
  }

  const totalMinutes =
    Math.floor(diff / 60000);

  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours =
    Math.floor(
      totalMinutes / 60
    );

  const minutes =
    totalMinutes % 60;

  if (hours < 24) {
    return minutes
      ? `${hours}h ${minutes}m`
      : `${hours}h`;
  }

  const days =
    Math.floor(
      hours / 24
    );

  const remainingHours =
    hours % 24;

  return remainingHours
    ? `${days}d ${remainingHours}h`
    : `${days}d`;
}

/* =========================================================
   EXPANDED — PROVIDERS
========================================================= */

function renderProvider(provider) {
  const usageWindow =
    getRelevantWindow(
      provider
    );

  const meta =
    PROVIDER_META[provider.id] || {
      initials: providerInitial(provider)
    };

  if (
    !provider.connected ||
    !usageWindow
  ) {
    return `
      <article class="pulse-provider">

        <div class="provider-main">

          <div class="provider-symbol">
            ${iconMarkup(meta)}
          </div>

          <div class="provider-info">

            <strong>
              ${escapeHtml(provider.name)}
            </strong>

            <span>
              indisponível
            </span>

          </div>

          <strong class="provider-percent unavailable">
            —
          </strong>

        </div>

      </article>
    `;
  }

  const used =
    clamp(
      usageWindow.usedPercent
    );

  const remaining =
    Math.max(
      0,
      100 - used
    );

  const health =
    healthForPercent(
      used
    );

  return `
    <article class="pulse-provider">

      <div class="provider-main">

        <div class="provider-symbol">
          ${iconMarkup(meta)}
        </div>

        <div class="provider-info">

          <strong>
            ${escapeHtml(provider.name)}
          </strong>

          <span>
            ${escapeHtml(
              usageWindow.label ||
              "Limite"
            )}
          </span>

        </div>

        <strong
          class="provider-percent ${health}"
        >
          ${Math.round(used)}%
        </strong>

      </div>

      <div class="mini-usage">

        <div class="mini-progress">

          <div
            class="mini-progress-fill ${health}"
            style="width:${used}%"
          ></div>

        </div>

        <div class="mini-usage-meta">

          <span>
            ${Math.round(remaining)}% restante
          </span>

          <span
            class="reset-value"
            data-reset="${escapeHtml(
              usageWindow.resetsAt ||
              ""
            )}"
          >
            ${formatDuration(
              usageWindow.resetsAt
            )}
          </span>

        </div>

      </div>

    </article>
  `;
}

function renderProviders() {
  const list =
    $("providerList");

  if (!list) {
    return;
  }

  const supported =
    providers.filter(
      (provider) =>
        provider.id === "codex" ||
        provider.id === "claude"
    );

  if (!supported.length) {
    list.innerHTML = `
      <div class="pulse-error">
        Nenhum provider monitorável.
      </div>
    `;

    return;
  }

  list.innerHTML =
    supported
      .map(renderProvider)
      .join("");
}

/* =========================================================
   NEXT RESET
========================================================= */

function getNextReset() {
  const candidates = [];

  for (const provider of providers) {
    if (!provider.connected) {
      continue;
    }

    const usageWindow =
      getRelevantWindow(
        provider
      );

    if (
      !usageWindow?.resetsAt
    ) {
      continue;
    }

    const timestamp =
      new Date(
        usageWindow.resetsAt
      ).getTime();

    if (
      !Number.isFinite(
        timestamp
      )
    ) {
      continue;
    }

    if (
      timestamp <=
      Date.now()
    ) {
      continue;
    }

    candidates.push({
      provider,
      usageWindow,
      timestamp
    });
  }

  candidates.sort(
    (a, b) =>
      a.timestamp -
      b.timestamp
  );

  return candidates[0] ||
    null;
}

function renderNextReset() {
  const container =
    $("nextReset");

  if (!container) {
    return;
  }

  const next =
    getNextReset();

  if (!next) {
    container.innerHTML = `
      <div class="reset-provider">
        <span>
          Nenhum reset disponível
        </span>
      </div>
    `;

    return;
  }

  container.innerHTML = `
    <div class="reset-provider">

      <span class="reset-provider-name">

        <i class="reset-dot"></i>

        <span>
          ${escapeHtml(
            next.provider.name
          )}
          ·
          ${escapeHtml(
            next.usageWindow.label
          )}
        </span>

      </span>

      <strong
        class="reset-countdown"
        data-reset="${escapeHtml(
          next.usageWindow.resetsAt
        )}"
      >
        ${formatDuration(
          next.usageWindow.resetsAt
        )}
      </strong>

    </div>
  `;
}

/* =========================================================
   OPERATIONAL SUMMARY — v0.11.0
   Visão rápida de todos os 6 providers no expanded. Conta
   por status real (nunca por percentual) — "disponível"
   cobre tanto quota conectada quanto runtime/ai-client
   funcionando; "não instalado"/"offline"/"erro" nunca viram
   a mesma categoria que "disponível".
========================================================= */

function summarizeProviderStatuses() {
  const counts = {
    ok: 0,
    "not-installed": 0,
    offline: 0,
    error: 0,
    other: 0
  };

  for (const provider of providers) {
    const status = provider.status;

    if (Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status] += 1;
    } else {
      counts.other += 1;
    }
  }

  return counts;
}

function renderOperationalSummary() {
  const container = $("operationalSummary");

  if (!container) {
    return;
  }

  if (!providers.length) {
    container.innerHTML = "";
    return;
  }

  const counts = summarizeProviderStatuses();

  const chips = [];

  if (counts.ok > 0) {
    chips.push(
      `<span class="summary-chip is-positive"><strong>${counts.ok}</strong>disponíve${counts.ok === 1 ? "l" : "is"}</span>`
    );
  }

  if (counts["not-installed"] > 0) {
    chips.push(
      `<span class="summary-chip"><strong>${counts["not-installed"]}</strong>não instalado${counts["not-installed"] === 1 ? "" : "s"}</span>`
    );
  }

  if (counts.offline > 0) {
    chips.push(
      `<span class="summary-chip"><strong>${counts.offline}</strong>offline</span>`
    );
  }

  if (counts.error > 0 || counts.other > 0) {
    const errorTotal = counts.error + counts.other;

    chips.push(
      `<span class="summary-chip"><strong>${errorTotal}</strong>indisponíve${errorTotal === 1 ? "l" : "is"}</span>`
    );
  }

  container.innerHTML = chips.join("");
}

/* =========================================================
   ACTIVITY TIMELINE — v0.11.0
   Só renderiza eventos que o backend realmente detectou
   (ver src/activity) — nunca fixtures/exemplos.
========================================================= */

let activityEvents = [];

function activityProviderName(providerId) {
  return (
    PROVIDER_META[providerId]?.name ||
    providerId
  );
}

function describeActivityEvent(event) {
  const payload = event.payload || {};

  switch (event.type) {
    case "quota-changed":
      return `Uso ${escapeHtml(payload.label || "")} passou de ${payload.from}% para ${payload.to}%`;

    case "runtime-online":
      return "Ficou online";

    case "runtime-offline":
      return "Ficou offline";

    case "model-loaded":
      return `${escapeHtml(payload.model || "modelo")} carregado`;

    case "model-unloaded":
      return `${escapeHtml(payload.model || "modelo")} descarregado`;

    case "activity-changed":
      return `Nova atividade — ${payload.sessions ?? "?"} sessões, ${payload.messages ?? "?"} mensagens`;

    case "status-changed":
      return `Status mudou de ${escapeHtml(payload.from || "—")} para ${escapeHtml(payload.to || "—")}`;

    default:
      return event.type;
  }
}

function formatEventTime(timestamp) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleTimeString(
    "pt-BR",
    {
      hour: "2-digit",
      minute: "2-digit"
    }
  );
}

function renderActivity() {
  const container = $("activityList");

  if (!container) {
    return;
  }

  if (!activityEvents.length) {
    container.innerHTML = `
      <div class="activity-empty">
        Nenhuma atividade recente registrada.
      </div>
    `;

    return;
  }

  container.innerHTML = activityEvents
    .map(
      (event) => `
        <div class="activity-row">
          <span class="activity-time">
            ${formatEventTime(event.timestamp)}
          </span>
          <div class="activity-body">
            <span class="activity-provider">
              ${escapeHtml(activityProviderName(event.providerId))}
            </span>
            <span class="activity-description">
              ${describeActivityEvent(event)}
            </span>
          </div>
        </div>
      `
    )
    .join("");
}

async function loadActivity() {
  try {
    const response = await fetch(
      `/api/activity?limit=8&t=${Date.now()}`,
      { cache: "no-store" }
    );

    if (!response.ok) {
      return;
    }

    const data = await response.json();

    activityEvents = Array.isArray(
      data.events
    )
      ? data.events
      : [];

    renderActivity();
  } catch (error) {
    console.warn(
      "[DevPulse Pulse] Não foi possível carregar a atividade recente:",
      error
    );
  }
}

/* =========================================================
   ALERTS — v0.12.0
   ALERT != ACTIVITY: aqui só renderizamos o que o backend
   (src/alerts) já decidiu que merece atenção — nunca
   recalculamos limiares no frontend, nunca usa fixtures.
========================================================= */

let alerts = { active: [], recent: [] };

const ALERT_SEVERITY_RANK = {
  critical: 0,
  warning: 1,
  info: 2
};

function alertProviderName(providerId) {
  return (
    PROVIDER_META[providerId]?.name ||
    providerId
  );
}

function alertsForProvider(providerId) {
  return (alerts.active || []).filter(
    (alert) => alert.providerId === providerId
  );
}

/*
 * Linha de uma palavra só, no formato pedido:
 * "CRÍTICO / Claude · Semanal / 91% utilizado"
 */
function describeAlertHeadline(alert) {
  const severityLabel =
    alert.severity === "critical"
      ? "CRÍTICO"
      : alert.severity === "warning"
        ? "ATENÇÃO"
        : "INFO";

  const scope =
    alert.type === "quota"
      ? alert.meta?.windowLabel ||
        alert.meta?.windowId ||
        ""
      : "Saúde";

  const providerScope = [
    alertProviderName(alert.providerId),
    scope
  ]
    .filter(Boolean)
    .join(" · ");

  const detail =
    alert.type === "quota" &&
    typeof alert.meta?.percent === "number"
      ? `${alert.meta.percent}% utilizado`
      : alert.message;

  return [severityLabel, providerScope, detail]
    .filter(Boolean)
    .join(" / ");
}

function renderAlerts() {
  const container = $("alertsList");

  if (!container) {
    return;
  }

  const active = [...(alerts.active || [])].sort(
    (a, b) =>
      (ALERT_SEVERITY_RANK[a.severity] ?? 3) -
      (ALERT_SEVERITY_RANK[b.severity] ?? 3)
  );

  if (!active.length) {
    container.innerHTML = `
      <div class="alerts-empty">
        Nenhum alerta ativo.
      </div>
    `;

    return;
  }

  container.innerHTML = active
    .map(
      (alert) => `
        <div class="alert-row is-${escapeHtml(alert.severity)}">
          ${escapeHtml(describeAlertHeadline(alert))}
        </div>
      `
    )
    .join("");
}

function renderDockAlertBadge() {
  const badge = $("dockAlertBadge");

  if (!badge) {
    return;
  }

  const active = alerts.active || [];

  if (!active.length) {
    badge.hidden = true;
    badge.textContent = "";
    badge.removeAttribute("title");

    return;
  }

  const hasCritical = active.some(
    (alert) => alert.severity === "critical"
  );

  badge.hidden = false;
  badge.classList.toggle("is-critical", hasCritical);

  badge.textContent =
    active.length > 9
      ? "9+"
      : String(active.length);

  badge.title = `${active.length} alerta${
    active.length === 1 ? "" : "s"
  } ativo${active.length === 1 ? "" : "s"}`;
}

/*
 * Nota discreta no detail panel — explicitamente NUNCA
 * apresentada como classificação oficial do provider
 * (prefixo "DevPulse" sempre presente).
 */
function describeAlertForDetail(alert) {
  if (alert.type === "quota") {
    const severityLabel =
      alert.severity === "critical"
        ? "Crítico"
        : "Atenção";

    const percent = alert.meta?.percent;

    return `Limite DevPulse / ${severityLabel}${
      typeof percent === "number"
        ? ` · ${percent}%`
        : ""
    }`;
  }

  return `Saúde DevPulse / ${
    alert.message || "Atenção"
  }`;
}

function renderProviderAlertNotes(id) {
  const relevant = alertsForProvider(id);

  if (!relevant.length) {
    return "";
  }

  return relevant
    .map(
      (alert) => `
        <p class="detail-alert-note is-${escapeHtml(alert.severity)}">
          ${escapeHtml(describeAlertForDetail(alert))}
        </p>
      `
    )
    .join("");
}

async function loadAlerts() {
  try {
    const response = await fetch(
      `/api/alerts?limit=10&t=${Date.now()}`,
      { cache: "no-store" }
    );

    if (!response.ok) {
      return;
    }

    const data = await response.json();

    alerts = {
      active: Array.isArray(data.active)
        ? data.active
        : [],

      recent: Array.isArray(data.recent)
        ? data.recent
        : []
    };

    renderAlerts();
    renderDockAlertBadge();

    if (
      mode === "detail" &&
      selectedProviderId
    ) {
      renderDetailBody(
        selectedProviderId
      );
    }
  } catch (error) {
    console.warn(
      "[DevPulse Pulse] Não foi possível carregar alertas:",
      error
    );
  }
}

/* =========================================================
   DOCK — PROVIDER RAIL
========================================================= */

function ringMarkup(percent, health) {
  const value =
    percent === null
      ? 0
      : clamp(percent);

  const offset =
    RING_CIRCUMFERENCE *
    (1 - value / 100);

  const center = RING_RADIUS + 5;
  const size = center * 2;

  return `
    <svg class="dock-item-ring" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle class="ring-bg" cx="${center}" cy="${center}" r="${RING_RADIUS - 1.5}"></circle>
      <circle class="ring-track" cx="${center}" cy="${center}" r="${RING_RADIUS}"></circle>
      <circle
        class="ring-fill ${health}"
        cx="${center}" cy="${center}" r="${RING_RADIUS}"
        style="stroke-dasharray:${RING_CIRCUMFERENCE.toFixed(2)};--ring-offset:${offset.toFixed(2)}"
      ></circle>
    </svg>
  `;
}

/*
 * v0.10.1: o dock usava só /api/detection (legado) para o
 * estado dos providers secundários — o mesmo detection.js
 * que a auditoria da v0.10.0 provou ter falso positivo para
 * o Gemini (confundia "Antigravity" com "Gemini CLI"), além
 * de mostrar "Pendente" em amarelo para quem nem está
 * instalado, sugerindo um warning de quota que não existe.
 *
 * Agora preferimos o snapshot real do próprio adapter (via
 * /api/providers/all, o mesmo já usado no detail panel).
 * Cor "warning" (amarela) fica reservada só para os anéis
 * de Codex/Claude baseados em percentual real — nunca para
 * um provider sem telemetria.
 */
function providerStateInfo(
  usageProvider,
  detectionItem
) {
  if (!usageProvider) {
    return detectionStateInfo(
      detectionItem
    );
  }

  switch (usageProvider.status) {
    case "ok":
      return {
        caption:
          usageProvider.kind === "local-runtime"
            ? "Online"
            : "Disponível",
        dot: "normal"
      };

    case "offline":
      return {
        caption: "Offline",
        dot: "offline"
      };

    case "not-installed":
      return {
        caption: "Não instalado",
        dot: "offline"
      };

    case "detected":
      return {
        caption: "Detectado",
        dot: "normal"
      };

    case "error":
      return {
        caption: "Erro",
        dot: "critical"
      };

    default:
      return {
        caption: "Indisponível",
        dot: "offline"
      };
  }
}

function detectionStateInfo(item) {
  if (!item) {
    return {
      caption: "Indisponível",
      dot: "offline"
    };
  }

  if (item.id === "ollama") {
    if (item.running) {
      return {
        caption: "Online",
        dot: "normal"
      };
    }

    if (item.installed) {
      return {
        caption: "Offline",
        dot: "offline"
      };
    }

    return {
      caption: "Indisponível",
      dot: "offline"
    };
  }

  if (item.monitoring === "adapter_pending") {
    return {
      caption: "Pendente",
      dot: "warning"
    };
  }

  if (item.installed) {
    return {
      caption: "Detectado",
      dot: "normal"
    };
  }

  return {
    caption: "Indisponível",
    dot: "offline"
  };
}

const SECONDARY_PROVIDER_IDS =
  PROVIDER_ORDER.filter(
    (id) => id !== "codex" && id !== "claude"
  );

/*
 * Micro-rótulo compacto exibido só para Codex/Claude,
 * abaixo do percentual (ex.: "5H", "SEM"). Puramente
 * cosmético — nunca substitui o rótulo completo, que
 * continua disponível no aria-label/title e no detail.
 */
function microWindowLabel(label) {
  if (!label) {
    return "";
  }

  const known = {
    "5 h": "5H",
    "Semanal": "SEM",
    "Mensal": "MÊS"
  };

  if (known[label]) {
    return known[label];
  }

  return label
    .replace(/\s+/g, "")
    .toUpperCase()
    .slice(0, 4);
}

function renderDockItemSkeleton(id, meta, isRing) {
  /*
   * Estado neutro exibido só até o primeiro fetch real
   * responder. Nunca afirma "indisponível" nem qualquer
   * percentual — apenas ícone atenuado e pulsante.
   */

  const badgeHtml =
    isRing
      ? `
        <div class="dock-item-badge">
          ${ringMarkup(null, "offline")}
          ${iconMarkup(meta)}
        </div>
      `
      : `
        <div class="dock-item-badge">
          <div class="dock-item-plain">
            ${iconMarkup(meta)}
          </div>
        </div>
      `;

  return `
    <button
      type="button"
      class="dock-item is-loading ${isRing ? "dock-item-primary" : "dock-item-secondary"}"
      data-provider-id="${id}"
      role="listitem"
      aria-pressed="false"
      aria-label="${escapeHtml(meta.name)}, carregando"
      title="${escapeHtml(meta.name)}"
      disabled
    >
      ${badgeHtml}
    </button>
  `;
}

function renderDockItem(id) {
  const meta = PROVIDER_META[id];

  if (!meta) {
    return "";
  }

  const isRing =
    id === "codex" ||
    id === "claude";

  if (!dataLoaded) {
    return renderDockItemSkeleton(id, meta, isRing);
  }

  const usageProvider =
    providers.find(
      (item) => item.id === id
    ) || null;

  const detectionItem =
    detection.find(
      (item) => item.id === id
    ) || null;

  const displayName =
    usageProvider?.name ||
    detectionItem?.name ||
    meta.name;

  let badgeHtml;
  let valueHtml = "";
  let microHtml = "";
  let ariaLabel;
  let itemClasses;
  let dimClass = "";

  if (isRing) {
    const usageWindow =
      getRelevantWindow(
        usageProvider
      );

    const connected =
      Boolean(usageProvider?.connected) &&
      Boolean(usageWindow);

    const percent =
      connected
        ? clamp(usageWindow.usedPercent)
        : null;

    const health =
      connected
        ? healthForPercent(percent)
        : "offline";

    badgeHtml = `
      <div class="dock-item-badge">
        ${ringMarkup(percent, health)}
        ${iconMarkup(meta)}
      </div>
    `;

    valueHtml = `
      <span class="dock-item-value ${health}">
        ${connected ? `${Math.round(percent)}%` : "—"}
      </span>
    `;

    const micro =
      connected
        ? microWindowLabel(usageWindow.label)
        : "";

    microHtml =
      micro
        ? `<span class="dock-item-micro">${escapeHtml(micro)}</span>`
        : "";

    ariaLabel =
      connected
        ? `${displayName}, uso ${Math.round(percent)}% de ${usageWindow.label || "limite"}`
        : `${displayName}, indisponível`;

    itemClasses = "dock-item-primary";

  } else {
    const state =
      providerStateInfo(
        usageProvider,
        detectionItem
      );

    badgeHtml = `
      <div class="dock-item-badge">
        <div class="dock-item-plain">
          ${iconMarkup(meta)}
        </div>
        <span class="dock-item-dot ${state.dot}"></span>
      </div>
    `;

    ariaLabel =
      `${displayName}, ${state.caption.toLowerCase()}`;

    itemClasses = "dock-item-secondary";

    const isDetected =
      usageProvider
        ? Boolean(usageProvider.detected)
        : Boolean(detectionItem?.installed);

    if (!isDetected) {
      dimClass = " is-dim";
    }
  }

  const selected =
    selectedProviderId === id;

  /*
   * Nenhum texto permanente (nome/estado) fica no dock —
   * essa informação vive em aria-label/title (tooltip ao
   * passar o mouse) e no detail panel ao clicar.
   */
  return `
    <button
      type="button"
      class="dock-item ${itemClasses}${dimClass}${selected ? " is-selected" : ""}"
      data-provider-id="${id}"
      role="listitem"
      aria-pressed="${selected ? "true" : "false"}"
      aria-label="${escapeHtml(ariaLabel)}"
      title="${escapeHtml(ariaLabel)}"
    >
      ${badgeHtml}
      ${valueHtml}
      ${microHtml}
    </button>
  `;
}

function renderDock() {
  const list =
    $("dockProviderList");

  if (!list) {
    return;
  }

  const primaryHtml =
    ["codex", "claude"]
      .map(renderDockItem)
      .join("");

  const secondaryHtml =
    SECONDARY_PROVIDER_IDS
      .map(renderDockItem)
      .join("");

  list.innerHTML = `
    ${primaryHtml}
    <div
      class="dock-secondary-grid"
      role="list"
      aria-label="Providers detectados"
    >
      ${secondaryHtml}
    </div>
  `;
}

/* =========================================================
   DETAIL PANEL
========================================================= */

function renderDetailWindowBlock(windowData) {
  if (!windowData) {
    return "";
  }

  const used =
    clamp(windowData.usedPercent);

  const remaining =
    Math.max(0, 100 - used);

  const health =
    healthForPercent(used);

  return `
    <div class="detail-block">

      <div class="detail-metric">
        <strong class="detail-percent ${health}">
          ${Math.round(used)}%
        </strong>
        <span class="detail-window-label">
          ${escapeHtml(windowData.label || "Limite")}
        </span>
      </div>

      <div class="detail-progress">
        <div
          class="detail-progress-fill ${health}"
          style="width:${used}%"
        ></div>
      </div>

      <div class="detail-meta-row">
        <span>Restante</span>
        <strong>${Math.round(remaining)}%</strong>
      </div>

      <div class="detail-meta-row">
        <span>Reset em</span>
        <strong
          data-reset="${escapeHtml(windowData.resetsAt || "")}"
        >
          ${formatDuration(windowData.resetsAt)}
        </strong>
      </div>

    </div>
  `;
}

function renderBreakdownBlock(breakdown) {
  if (
    !Array.isArray(breakdown) ||
    !breakdown.length
  ) {
    return "";
  }

  return `
    <div class="detail-block detail-breakdown">

      <span class="pulse-section-label">
        USO SEMANAL
      </span>

      <ul>
        ${breakdown
          .map((row) => {
            const percent =
              clamp(row.percent);

            return `
              <li class="detail-breakdown-row">
                <div class="detail-breakdown-row-head">
                  <span>${escapeHtml(row.name || row.id || "—")}</span>
                  <span>${Math.round(percent)}%</span>
                </div>
                <div class="detail-breakdown-bar">
                  <div
                    class="detail-breakdown-bar-fill"
                    style="width:${percent}%"
                  ></div>
                </div>
              </li>
            `;
          })
          .join("")}
      </ul>

    </div>
  `;
}

function renderExtraUsageBlock(extra) {
  if (!extra || !extra.enabled) {
    return "";
  }

  const rows = [];

  if (typeof extra.usedPercent === "number") {
    rows.push(`
      <div class="detail-meta-row">
        <span>Utilização</span>
        <strong>${Math.round(clamp(extra.usedPercent))}%</strong>
      </div>
    `);
  }

  if (
    typeof extra.used === "number" &&
    typeof extra.limit === "number"
  ) {
    rows.push(`
      <div class="detail-meta-row">
        <span>Consumo</span>
        <strong>
          ${extra.used.toFixed(2)} / ${extra.limit.toFixed(2)}
          ${escapeHtml(extra.currency || "")}
        </strong>
      </div>
    `);
  }

  if (!rows.length) {
    return "";
  }

  return `
    <div class="detail-block">
      <span class="pulse-section-label">
        EXTRA USAGE
      </span>
      ${rows.join("")}
    </div>
  `;
}

function renderCodexExtrasBlock(provider) {
  const rows = [];

  if (provider.plan) {
    rows.push(`
      <div class="detail-status-row">
        <span>Plano</span>
        <strong>${escapeHtml(provider.plan)}</strong>
      </div>
    `);
  }

  if (
    provider.resetCredits &&
    typeof provider.resetCredits.available === "number"
  ) {
    rows.push(`
      <div class="detail-status-row">
        <span>Créditos de reset</span>
        <strong>${provider.resetCredits.available}</strong>
      </div>
    `);
  }

  if (!rows.length) {
    return "";
  }

  return `
    <div class="detail-block">
      ${rows.join("")}
    </div>
  `;
}

function renderUnavailableBlock(detectionItem, usageProvider) {
  const reason =
    usageProvider?.error ||
    (detectionItem && !detectionItem.authenticated
      ? "Não autenticado"
      : null);

  return `
    <div class="detail-block">

      <div class="detail-metric">
        <strong class="detail-percent offline">—</strong>
        <span class="detail-window-label">Indisponível</span>
      </div>

      <p class="detail-note">
        ${escapeHtml(reason || "Sem dados no momento.")}
      </p>

    </div>
  `;
}

function renderDetectionDetail(detectionItem) {
  if (!detectionItem) {
    return `
      <div class="detail-empty">
        Sem dados de detecção.
      </div>
    `;
  }

  const rows = [];

  rows.push(`
    <div class="detail-status-row">
      <span>Instalação</span>
      <strong>${detectionItem.installed ? "Sim" : "Não"}</strong>
    </div>
  `);

  if (
    detectionItem.authenticated !== null &&
    detectionItem.authenticated !== undefined
  ) {
    rows.push(`
      <div class="detail-status-row">
        <span>Autenticação</span>
        <strong>
          ${detectionItem.authenticated ? "Detectada" : "Não detectada"}
        </strong>
      </div>
    `);
  }

  if (detectionItem.running !== undefined) {
    rows.push(`
      <div class="detail-status-row">
        <span>Serviço</span>
        <strong>${detectionItem.running ? "Online" : "Offline"}</strong>
      </div>
    `);
  }

  const state =
    detectionStateInfo(
      detectionItem
    );

  rows.push(`
    <div class="detail-status-row">
      <span>Estado</span>
      <strong>${escapeHtml(state.caption)}</strong>
    </div>
  `);

  if (detectionItem.source) {
    rows.push(`
      <div class="detail-status-row">
        <span>Fonte</span>
        <strong>${escapeHtml(detectionItem.source)}</strong>
      </div>
    `);
  }

  const models =
    Array.isArray(detectionItem.models)
      ? detectionItem.models
      : [];

  const modelsHtml =
    models.length
      ? `
        <div class="detail-block">
          <span class="pulse-section-label">
            MODELOS LOCAIS
          </span>
          <div class="detail-models">
            ${models
              .slice(0, 8)
              .map(
                (model) => `
                  <div class="detail-model-row">
                    ${escapeHtml(model.name)}
                  </div>
                `
              )
              .join("")}
          </div>
        </div>
      `
      : "";

  const noteHtml =
    detectionItem.note
      ? `
        <p class="detail-note">
          ${escapeHtml(detectionItem.note)}
        </p>
      `
      : "";

  return `
    <div class="detail-block">
      ${rows.join("")}
    </div>
    ${modelsHtml}
    ${noteHtml}
  `;
}

/*
 * Local runtime (Ollama): status/versão/modelos — nunca
 * percentual, porque não existe quota para um runtime
 * local.
 */
function renderLocalRuntimeDetail(
  usageProvider
) {
  const rows = [];

  const statusLabel =
    usageProvider.status === "not-installed"
      ? "Não instalado"
      : usageProvider.online
        ? "Online"
        : "Offline";

  rows.push(`
    <div class="detail-status-row">
      <span>Status</span>
      <strong>${statusLabel}</strong>
    </div>
  `);

  if (usageProvider.version) {
    rows.push(`
      <div class="detail-status-row">
        <span>Versão</span>
        <strong>${escapeHtml(usageProvider.version)}</strong>
      </div>
    `);
  }

  if (usageProvider.status === "not-installed") {
    const noteHtml =
      usageProvider.note
        ? `
          <p class="detail-note">
            ${escapeHtml(usageProvider.note)}
          </p>
        `
        : "";

    return `
      <div class="detail-block">
        ${rows.join("")}
      </div>
      ${noteHtml}
    `;
  }

  if (
    typeof usageProvider.modelsInstalled ===
    "number"
  ) {
    rows.push(`
      <div class="detail-status-row">
        <span>Modelos instalados</span>
        <strong>${usageProvider.modelsInstalled}</strong>
      </div>
    `);
  }

  if (
    typeof usageProvider.modelsLoaded ===
    "number"
  ) {
    rows.push(`
      <div class="detail-status-row">
        <span>Modelos carregados</span>
        <strong>${usageProvider.modelsLoaded}</strong>
      </div>
    `);
  }

  const loadedNames = new Set(
    (
      Array.isArray(usageProvider.loadedModels)
        ? usageProvider.loadedModels
        : []
    )
      .map((model) => model.name)
      .filter(Boolean)
  );

  const models =
    Array.isArray(usageProvider.models)
      ? usageProvider.models
      : [];

  const modelsHtml =
    models.length
      ? `
        <div class="detail-block">
          <span class="pulse-section-label">
            MODELOS INSTALADOS
          </span>
          <div class="detail-models">
            ${models
              .slice(0, 8)
              .map((model) => {
                const isActive =
                  Boolean(model.name) &&
                  loadedNames.has(
                    model.name
                  );

                const sizeLabel =
                  formatBytes(model.size);

                const metaParts = [
                  model.family,
                  model.parameterSize,
                  model.quantization,
                  sizeLabel
                ].filter(Boolean);

                return `
                  <div class="detail-model-row${isActive ? " is-active" : ""}">
                    <div class="detail-model-row-head">
                      <span>${escapeHtml(model.name || "—")}</span>
                      ${
                        isActive
                          ? `<span class="detail-model-badge">ATIVO</span>`
                          : ""
                      }
                    </div>
                    ${
                      metaParts.length
                        ? `
                          <span class="detail-model-meta">
                            ${escapeHtml(metaParts.join(" · "))}
                          </span>
                        `
                        : ""
                    }
                  </div>
                `;
              })
              .join("")}
          </div>
        </div>
      `
      : "";

  const noLoadedHtml =
    usageProvider.modelsLoaded === 0
      ? `
        <p class="detail-note">
          Nenhum modelo carregado no momento.
        </p>
      `
      : "";

  return `
    <div class="detail-block">
      ${rows.join("")}
    </div>
    ${modelsHtml}
    ${noLoadedHtml}
  `;
}

/*
 * AI client (OpenCode/Cursor): status/versão/providers
 * configurados/atividade — nunca percentual de quota, e a
 * nota de double-counting (quando existir) é sempre
 * mostrada.
 */
function aiClientStatusLabel(
  usageProvider
) {
  if (usageProvider.status === "ok") {
    return "Disponível";
  }

  if (usageProvider.status === "not-installed") {
    return "Não instalado";
  }

  return usageProvider.detected
    ? "Detectado"
    : "Indisponível";
}

function renderAiClientDetail(
  usageProvider
) {
  const rows = [];

  rows.push(`
    <div class="detail-status-row">
      <span>Status</span>
      <strong>${aiClientStatusLabel(usageProvider)}</strong>
    </div>
  `);

  if (usageProvider.version) {
    rows.push(`
      <div class="detail-status-row">
        <span>Versão</span>
        <strong>${escapeHtml(usageProvider.version)}</strong>
      </div>
    `);
  }

  const configuredProviders =
    Array.isArray(
      usageProvider.configuredProviders
    )
      ? usageProvider.configuredProviders
      : [];

  const providersHtml =
    configuredProviders.length
      ? `
        <div class="detail-block">
          <span class="pulse-section-label">
            PROVIDERS CONFIGURADOS
          </span>
          <div class="detail-models">
            ${configuredProviders
              .map(
                (item) => `
                  <div class="detail-model-row">
                    ${escapeHtml(item.name)}
                  </div>
                `
              )
              .join("")}
          </div>
        </div>
      `
      : "";

  const activity = usageProvider.activity;

  const activityHtml =
    activity
      ? `
        <div class="detail-block">
          <span class="pulse-section-label">
            ATIVIDADE (${activity.periodDays}D)
          </span>
          ${
            activity.sessions !== null &&
            activity.sessions !== undefined
              ? `
                <div class="detail-status-row">
                  <span>Sessões</span>
                  <strong>${activity.sessions}</strong>
                </div>
              `
              : ""
          }
          ${
            activity.messages !== null &&
            activity.messages !== undefined
              ? `
                <div class="detail-status-row">
                  <span>Mensagens</span>
                  <strong>${activity.messages}</strong>
                </div>
              `
              : ""
          }
        </div>
      `
      : "";

  const noteHtml =
    usageProvider.note
      ? `
        <p class="detail-note">
          ${escapeHtml(usageProvider.note)}
        </p>
      `
      : "";

  return `
    <div class="detail-block">
      ${rows.join("")}
    </div>
    ${providersHtml}
    ${activityHtml}
    ${noteHtml}
  `;
}

/*
 * Cloud provider sem usage confirmado (ex.: Gemini quando
 * detectado mas sem endpoint local de quota comprovado) —
 * mostra só o que é real, nunca um percentual inventado.
 */
function renderCloudProviderMinimalDetail(
  usageProvider
) {
  const rows = [];

  const statusLabel =
    usageProvider.status === "not-installed"
      ? "Não instalado"
      : usageProvider.detected
        ? "Detectado"
        : "Indisponível";

  rows.push(`
    <div class="detail-status-row">
      <span>Status</span>
      <strong>${statusLabel}</strong>
    </div>
  `);

  if (usageProvider.version) {
    rows.push(`
      <div class="detail-status-row">
        <span>Versão</span>
        <strong>${escapeHtml(usageProvider.version)}</strong>
      </div>
    `);
  }

  if (
    usageProvider.authenticated !== null &&
    usageProvider.authenticated !== undefined
  ) {
    rows.push(`
      <div class="detail-status-row">
        <span>Autenticação</span>
        <strong>
          ${usageProvider.authenticated ? "Detectada" : "Não detectada"}
        </strong>
      </div>
    `);
  }

  const noteHtml =
    usageProvider.note
      ? `
        <p class="detail-note">
          ${escapeHtml(usageProvider.note)}
        </p>
      `
      : "";

  return `
    <div class="detail-block">
      ${rows.join("")}
    </div>
    ${noteHtml}
  `;
}

function buildDetailBodyContent(id) {
  const usageProvider =
    providers.find(
      (item) => item.id === id
    ) || null;

  const detectionItem =
    detection.find(
      (item) => item.id === id
    ) || null;

  if (id === "codex" || id === "claude") {
    const primary =
      usageProvider?.windows?.primary || null;

    const secondary =
      usageProvider?.windows?.secondary || null;

    const relevant =
      getRelevantWindow(
        usageProvider
      );

    if (
      !usageProvider?.connected ||
      !relevant
    ) {
      return renderUnavailableBlock(
        detectionItem,
        usageProvider
      );
    }

    const blocks = [];

    if (id === "claude") {
      blocks.push(
        renderDetailWindowBlock(
          secondary || primary
        )
      );

      if (primary && secondary) {
        blocks.push(
          renderDetailWindowBlock(primary)
        );
      }

      blocks.push(
        renderBreakdownBlock(
          usageProvider.breakdown
        )
      );

      blocks.push(
        renderExtraUsageBlock(
          usageProvider.extraUsage
        )
      );

    } else {
      blocks.push(
        renderDetailWindowBlock(
          primary || secondary
        )
      );

      if (primary && secondary) {
        blocks.push(
          renderDetailWindowBlock(secondary)
        );
      }

      blocks.push(
        renderCodexExtrasBlock(
          usageProvider
        )
      );
    }

    return blocks
      .filter(Boolean)
      .join("");
  }

  /*
   * Providers v0.10.0 (Ollama/Gemini/OpenCode/Cursor): usa
   * o snapshot real do adapter (via /api/providers/all),
   * roteado pelo "kind". Só cai para o detection.js antigo
   * se, por algum motivo, o snapshot não tiver chegado.
   */

  if (usageProvider?.kind === "local-runtime") {
    return renderLocalRuntimeDetail(
      usageProvider
    );
  }

  if (usageProvider?.kind === "ai-client") {
    return renderAiClientDetail(
      usageProvider
    );
  }

  if (usageProvider?.kind === "cloud-provider") {
    return renderCloudProviderMinimalDetail(
      usageProvider
    );
  }

  return renderDetectionDetail(
    detectionItem
  );
}

/*
 * v0.11.0 — freshness discreta no rodapé do detail: usa
 * exclusivamente os metadados que o backend já calcula
 * (runtime.fetchedAt/stale, ver src/providers/runtime.js).
 * Nunca inventa um timestamp — se não houver
 * `runtime.fetchedAt`, simplesmente não mostra a linha.
 */
function formatFreshness(usageProvider) {
  const runtimeMeta = usageProvider?.runtime;

  if (!runtimeMeta?.fetchedAt) {
    return "";
  }

  const fetchedDate = new Date(
    runtimeMeta.fetchedAt
  );

  if (Number.isNaN(fetchedDate.getTime())) {
    return "";
  }

  const diffMinutes = Math.max(
    0,
    Math.floor(
      (Date.now() - fetchedDate.getTime()) /
        60000
    )
  );

  const whenLabel =
    diffMinutes < 1
      ? "agora"
      : diffMinutes === 1
        ? "há 1 min"
        : `há ${diffMinutes} min`;

  if (runtimeMeta.stale) {
    return `
      <p class="detail-freshness is-stale">
        Dados anteriores · atualizado ${whenLabel} · provider temporariamente indisponível
      </p>
    `;
  }

  return `
    <p class="detail-freshness">
      Atualizado ${whenLabel}
    </p>
  `;
}

function buildDetailBody(id) {
  const usageProvider =
    providers.find(
      (item) => item.id === id
    ) || null;

  const content =
    buildDetailBodyContent(id);

  const alertNotes =
    renderProviderAlertNotes(id);

  const freshness =
    formatFreshness(usageProvider);

  return `${content}${alertNotes}${freshness}`;
}

function renderDetailBody(id) {
  const body = $("detailBody");

  if (!body) {
    return;
  }

  body.innerHTML =
    buildDetailBody(id);
}

function updateDetailHeader(id) {
  const meta =
    PROVIDER_META[id];

  if (!meta) {
    return;
  }

  const usageProvider =
    providers.find(
      (item) => item.id === id
    ) || null;

  const detectionItem =
    detection.find(
      (item) => item.id === id
    ) || null;

  const name =
    usageProvider?.name ||
    detectionItem?.name ||
    meta.name;

  const subtitle =
    detectionItem?.description ||
    "";

  const nameEl = $("detailName");
  const subtitleEl = $("detailSubtitle");
  const iconEl = $("detailIcon");

  if (nameEl) {
    nameEl.textContent = name;
  }

  if (subtitleEl) {
    subtitleEl.textContent = subtitle;
  }

  if (iconEl) {
    iconEl.innerHTML =
      iconMarkup(meta);
  }
}

/* =========================================================
   NATIVE WINDOW
========================================================= */

async function setNativeWindowMode(
  nativeMode
) {
  const response =
    await fetch(
      "/api/pulse/window",
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        cache:
          "no-store",

        body:
          JSON.stringify({
            mode: nativeMode
          })
      }
    );

  let data = null;

  try {
    data =
      await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      data?.error ||
      `HTTP ${response.status}`
    );
  }

  return data;
}

/*
 * Uma única tentativa extra, depois de um pequeno atraso,
 * antes de desistir. Cobre falhas transitórias (ex.: a
 * janela nativa ainda não existia no primeiro instante) sem
 * risco de loop — nunca mais de 2 chamadas por transição.
 */
async function setNativeWindowModeWithRetry(
  nativeMode
) {
  try {
    return await setNativeWindowMode(
      nativeMode
    );
  } catch (firstError) {
    console.warn(
      "[DevPulse Pulse] Resize falhou, tentando novamente uma vez:",
      firstError.message
    );

    await waitForMs(300);

    return await setNativeWindowMode(
      nativeMode
    );
  }
}

async function synchronizeNativeWindow() {
  try {
    await setNativeWindowModeWithRetry(
      mode === "expanded"
        ? "expanded"
        : "dock"
    );
  } catch (error) {
    console.warn(
      "[DevPulse Pulse] Não foi possível sincronizar a janela:",
      error
    );
  }
}

/* =========================================================
   MODE / TRANSITIONS
========================================================= */

function applyModeClasses() {
  const pulse = $("pulse");

  const dockContent =
    $("dockContent");

  const detailPanel =
    $("detailPanel");

  if (!pulse) {
    return;
  }

  pulse.classList.toggle(
    "mode-dock",
    mode === "dock" || mode === "detail"
  );

  pulse.classList.toggle(
    "mode-detail",
    mode === "detail"
  );

  if (dockContent) {
    dockContent.setAttribute(
      "aria-hidden",
      mode === "expanded" ? "true" : "false"
    );
  }

  if (detailPanel) {
    detailPanel.setAttribute(
      "aria-hidden",
      mode === "detail" ? "false" : "true"
    );
  }

  persistModePreference(mode);
}

async function collapseToDock() {
  if (
    mode !== "expanded" ||
    windowTransitioning
  ) {
    return;
  }

  windowTransitioning = true;

  mode = "dock";
  selectedProviderId = null;

  applyModeClasses();
  renderDock();

  try {
    await setNativeWindowModeWithRetry(
      "dock"
    );
  } catch (error) {
    console.error(
      "[DevPulse Pulse] Falha ao recolher para o dock:",
      error
    );

    mode = "expanded";
    applyModeClasses();
  } finally {
    windowTransitioning = false;
    drainPendingIntent();
  }
}

async function expandFromDock() {
  if (
    mode === "expanded" ||
    windowTransitioning
  ) {
    return;
  }

  windowTransitioning = true;

  /*
   * Primeiro aumentamos a janela.
   * Depois mostramos o conteúdo expandido.
   *
   * Isso reduz o "flash" de conteúdo
   * espremido durante a expansão.
   */

  try {
    await setNativeWindowModeWithRetry(
      "expanded"
    );

    mode = "expanded";
    selectedProviderId = null;

    applyModeClasses();
  } catch (error) {
    console.error(
      "[DevPulse Pulse] Falha ao expandir janela:",
      error
    );
  } finally {
    windowTransitioning = false;
    drainPendingIntent();
  }
}

async function openDetail(id) {
  if (
    windowTransitioning ||
    mode === "expanded"
  ) {
    return;
  }

  windowTransitioning = true;

  const wasInDetail =
    mode === "detail";

  selectedProviderId = id;

  updateDetailHeader(id);
  renderDetailBody(id);

  try {
    if (!wasInDetail) {
      /*
       * Resize primeiro, depois revela
       * o painel — evita o painel sendo
       * cortado pela janela nativa ainda
       * estreita. Trocar entre Codex/Claude
       * já em modo detail não passa por
       * aqui — a janela já está no tamanho
       * certo, então não redimensiona de novo.
       */
      await setNativeWindowModeWithRetry(
        "detail"
      );
    }

    mode = "detail";

    applyModeClasses();
    renderDock();

  } catch (error) {
    console.error(
      "[DevPulse Pulse] Falha ao abrir detalhes:",
      error
    );

    selectedProviderId = null;
  } finally {
    windowTransitioning = false;
    drainPendingIntent();
  }
}

async function closeDetail() {
  if (
    mode !== "detail" ||
    windowTransitioning
  ) {
    return;
  }

  windowTransitioning = true;

  selectedProviderId = null;
  mode = "dock";

  /*
   * Primeiro escondemos/encolhemos o
   * painel (transição CSS). Só depois
   * encolhemos a janela nativa — assim
   * o painel não é cortado no meio da
   * animação.
   */

  applyModeClasses();
  renderDock();

  await waitForMs(
    DETAIL_CLOSE_TRANSITION_MS
  );

  try {
    await setNativeWindowModeWithRetry(
      "dock"
    );
  } catch (error) {
    /*
     * O conteúdo já mudou para dock (acima) —
     * não voltamos para "detail" aqui, isso só
     * causaria um flash confuso de volta. A
     * janela nativa pode ficar temporariamente
     * maior que o conteúdo; a próxima transição
     * bem-sucedida (o resize é idempotente) se
     * autocorrige.
     */
    console.error(
      "[DevPulse Pulse] Falha ao fechar detalhes:",
      error
    );
  } finally {
    windowTransitioning = false;

    persistModePreference("dock");

    drainPendingIntent();
  }
}

function handleDockItemClick(id) {
  if (mode === "expanded") {
    return;
  }

  if (
    selectedProviderId === id &&
    mode === "detail"
  ) {
    closeDetail();
    return;
  }

  openDetail(id);
}

/* =========================================================
   LIVE INDICATORS
========================================================= */

function updateLiveIndicators(offline) {
  const liveStatus =
    $("liveStatus");

  if (liveStatus) {
    liveStatus.classList.toggle(
      "offline",
      offline
    );
  }

  const dockLive =
    $("dockLive");

  if (dockLive) {
    dockLive.classList.toggle(
      "offline",
      offline
    );
  }

  const dockTop =
    $("dockTop");

  if (dockTop) {
    dockTop.title =
      offline
        ? "DevPulse · Offline"
        : "DevPulse · Live";
  }
}

/* =========================================================
   COUNTDOWNS
========================================================= */

function updateCountdowns() {
  document
    .querySelectorAll(
      "[data-reset]"
    )
    .forEach(
      (element) => {
        element.textContent =
          formatDuration(
            element.dataset.reset
          );
      }
    );

  renderNextReset();
}

/* =========================================================
   FETCH
========================================================= */

async function loadProviders(
  force = false
) {
  const button =
    $("refreshButton");

  if (
    force &&
    button
  ) {
    button.disabled = true;
    button.textContent = "...";
  }

  try {
    const suffix =
      force
        ? `force=1&t=${Date.now()}`
        : `t=${Date.now()}`;

    const [
      providersResponse,
      detectionResponse
    ] = await Promise.all([
      fetch(
        `/api/providers/all?${suffix}`,
        { cache: "no-store" }
      ),

      fetch(
        `/api/detection?t=${Date.now()}`,
        { cache: "no-store" }
      )
    ]);

    if (!providersResponse.ok) {
      throw new Error(
        `HTTP ${providersResponse.status}`
      );
    }

    const providersData =
      await providersResponse.json();

    providers =
      Array.isArray(providersData)
        ? providersData
        : Array.isArray(providersData.value)
          ? providersData.value
          : [];

    if (detectionResponse.ok) {
      const detectionData =
        await detectionResponse.json();

      detection =
        Array.isArray(detectionData)
          ? detectionData
          : [];
    }

    dataLoaded = true;

    renderProviders();
    renderOperationalSummary();
    renderNextReset();
    renderDock();

    loadActivity();
    loadAlerts();

    if (
      mode === "detail" &&
      selectedProviderId
    ) {
      updateDetailHeader(
        selectedProviderId
      );

      renderDetailBody(
        selectedProviderId
      );
    }

    updateLiveIndicators(false);

    const updatedAt =
      $("updatedAt");

    if (updatedAt) {
      updatedAt.textContent =
        `Atualizado ${
          new Date()
            .toLocaleTimeString(
              "pt-BR",
              {
                hour:
                  "2-digit",

                minute:
                  "2-digit"
              }
            )
        }`;
    }

  } catch (error) {
    console.error(
      "[DevPulse Pulse]",
      error
    );

    const list =
      $("providerList");

    if (list) {
      list.innerHTML = `
        <div class="pulse-error">
          Não foi possível atualizar os providers.
        </div>
      `;
    }

    updateLiveIndicators(true);

    /*
     * Uma falha real de fetch é informação real (não uma
     * suposição) — a partir daqui o dock pode refletir o
     * estado de "indisponível" com segurança.
     */
    dataLoaded = true;

    renderDock();

  } finally {
    if (
      force &&
      button
    ) {
      button.disabled = false;

      button.textContent =
        "Atualizar";
    }
  }
}

/* =========================================================
   EVENTS
========================================================= */

const collapseButton =
  $("collapseButton");

if (collapseButton) {
  collapseButton
    .addEventListener(
      "click",
      () =>
        scheduleIntent(
          collapseToDock
        )
    );
}

const dockExpandButton =
  $("dockExpandButton");

if (dockExpandButton) {
  dockExpandButton
    .addEventListener(
      "click",
      () =>
        scheduleIntent(
          expandFromDock
        )
    );
}

const detailCloseButton =
  $("detailCloseButton");

if (detailCloseButton) {
  detailCloseButton
    .addEventListener(
      "click",
      () =>
        scheduleIntent(
          closeDetail
        )
    );
}

document.addEventListener(
  "click",
  (event) => {
    const item =
      event.target.closest?.(
        ".dock-item"
      );

    if (!item) {
      return;
    }

    const id =
      item.dataset.providerId;

    if (id) {
      scheduleIntent(
        () =>
          handleDockItemClick(id)
      );
    }
  }
);

document.addEventListener(
  "click",
  (event) => {
    if (mode !== "detail") {
      return;
    }

    const dockContentEl =
      $("dockContent");

    if (
      dockContentEl &&
      !dockContentEl.contains(
        event.target
      )
    ) {
      scheduleIntent(
        closeDetail
      );
    }
  }
);

document.addEventListener(
  "keydown",
  (event) => {
    if (
      event.key === "Escape" &&
      mode === "detail"
    ) {
      scheduleIntent(
        closeDetail
      );
    }
  }
);

const refreshButton =
  $("refreshButton");

if (refreshButton) {
  refreshButton
    .addEventListener(
      "click",
      () =>
        loadProviders(true)
    );
}

const dashboardButton =
  $("dashboardButton");

if (dashboardButton) {
  dashboardButton
    .addEventListener(
      "click",
      () => {
        window.open(
          "/#overview",
          "_blank",
          "noopener"
        );
      }
    );
}

/* =========================================================
   START
========================================================= */

applyModeClasses();
renderDock();

loadProviders();

/*
 * Sincroniza o tamanho nativo com
 * o último estado salvo.
 *
 * Pequeno delay para dar tempo de
 * o Edge terminar de criar a janela.
 */

setTimeout(
  synchronizeNativeWindow,
  700
);

setInterval(
  () =>
    loadProviders(false),
  60 * 1000
);

setInterval(
  updateCountdowns,
  30 * 1000
);
