const $ = (id) =>
  document.getElementById(id);

let currentView =
  "overview";

let historyHours =
  24;

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
  return String(
    value ?? ""
  )
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatReset(
  dateValue
) {
  if (!dateValue) {
    return "Reset indisponível";
  }

  const target =
    new Date(
      dateValue
    ).getTime();

  const diff =
    target -
    Date.now();

  if (
    !Number.isFinite(diff)
  ) {
    return "Reset indisponível";
  }

  if (diff <= 0) {
    return "Reset iminente";
  }

  const minutes =
    Math.floor(
      diff / 60000
    );

  if (minutes < 60) {
    return `Reset em ${minutes} min`;
  }

  const hours =
    Math.floor(
      minutes / 60
    );

  if (hours < 24) {
    return `Reset em ${hours}h ${minutes % 60}min`;
  }

  const days =
    Math.floor(
      hours / 24
    );

  return `Reset em ${days}d ${hours % 24}h`;
}

function formatMoney(
  value,
  currency = "BRL"
) {
  if (value == null) {
    return "—";
  }

  return new Intl.NumberFormat(
    "pt-BR",
    {
      style: "currency",
      currency
    }
  ).format(value);
}

function formatDateTime(
  value
) {
  if (!value) {
    return "—";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "—";
  }

  return date
    .toLocaleString(
      "pt-BR",
      {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }
    );
}

/* =========================================================
   HEALTH
========================================================= */

function getHealth(percent) {
  const value =
    Number(percent) || 0;

  if (value >= 90) {
    return {
      id: "critical",
      label: "Crítico"
    };
  }

  if (value >= 70) {
    return {
      id: "warning",
      label: "Atenção"
    };
  }

  return {
    id: "normal",
    label: "Normal"
  };
}

function providerHealth(
  provider
) {
  if (
    !provider.connected
  ) {
    return {
      id: "offline",
      label: "Indisponível"
    };
  }

  if (
    provider.status ===
    "stale"
  ) {
    return {
      id: "stale",
      label: "Desatualizado"
    };
  }

  const percentages =
    Object.values(
      provider.windows || {}
    )
      .filter(Boolean)
      .map(
        (item) =>
          Number(
            item.usedPercent
          ) || 0
      );

  const highest =
    Math.max(
      0,
      ...percentages
    );

  return getHealth(
    highest
  );
}

/* =========================================================
   PROVIDER CARDS
========================================================= */

function providerInitial(
  provider
) {
  const initials = {
    codex: "CX",
    claude: "CL",
    ollama: "OL",
    opencode: "OC",
    gemini: "GM",
    cursor: "CR"
  };

  return (
    initials[
      provider.id
    ] ||
    String(
      provider.name || "AI"
    )
      .slice(0, 2)
      .toUpperCase()
  );
}

function usageRow(
  usageWindow
) {
  if (!usageWindow) {
    return `
      <div class="usage-row">

        <div class="usage-row-head">

          <span>
            Indisponível
          </span>

          <strong>
            —
          </strong>

        </div>

      </div>
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

  return `
    <div class="usage-row">

      <div class="usage-row-head">

        <span>
          ${escapeHtml(
            usageWindow.label
          )}
        </span>

        <strong>
          ${Math.round(used)}%
        </strong>

      </div>

      <div class="progress">

        <div
          class="progress-fill"
          style="width:${used}%"
        ></div>

      </div>

      <div class="usage-meta">

        <span>
          ${Math.round(
            remaining
          )}% restante
        </span>

        <span
          class="reset-countdown"
          data-reset="${escapeHtml(
            usageWindow.resetsAt ||
            ""
          )}"
        >
          ${formatReset(
            usageWindow.resetsAt
          )}
        </span>

      </div>

    </div>
  `;
}

function renderProvider(
  provider
) {
  const health =
    providerHealth(
      provider
    );

  if (
    !provider.connected ||
    provider.status ===
      "error"
  ) {
    return `
      <article class="provider-card error-card">

        <div class="provider-card-head">

          <div class="provider-identity">

            <div class="provider-logo">
              ${providerInitial(
                provider
              )}
            </div>

            <div>

              <strong>
                ${escapeHtml(
                  provider.name
                )}
              </strong>

              <small>
                Provider indisponível
              </small>

            </div>

          </div>

        </div>

        <div class="error-text">
          ${escapeHtml(
            provider.error ||
            "Erro desconhecido"
          )}
        </div>

      </article>
    `;
  }

  let subtitle =
    "Conectado";

  if (provider.plan) {
    subtitle =
      `Plano ${String(
        provider.plan
      ).toUpperCase()}`;
  }

  const source =
    provider.runtime?.cached
      ? "CACHE"
      : "LIVE";

  return `
    <article class="provider-card">

      <div class="provider-card-head">

        <div class="provider-identity">

          <div class="provider-logo">
            ${providerInitial(
              provider
            )}
          </div>

          <div>

            <strong>
              ${escapeHtml(
                provider.name
              )}
            </strong>

            <small>
              ${escapeHtml(
                subtitle
              )}
            </small>

          </div>

        </div>

        <div
          class="provider-status health-${health.id}"
        >

          <span class="status-dot"></span>

          ${health.label}

        </div>

      </div>

      ${usageRow(
        provider.windows?.primary
      )}

      ${usageRow(
        provider.windows?.secondary
      )}

      <div class="provider-footer">

        <span>
          ${source}
          ·
          ${
            new Date(
              provider.updatedAt
            )
              .toLocaleTimeString(
                "pt-BR",
                {
                  hour:
                    "2-digit",

                  minute:
                    "2-digit"
                }
              )
          }
        </span>

        ${
          provider.fidelity
            ? `
              <span class="fidelity">
                ${escapeHtml(
                  provider.fidelity
                )}
              </span>
            `
            : ""
        }

      </div>

    </article>
  `;
}

/* =========================================================
   CLAUDE DETAILS
========================================================= */

function renderClaudeDetails(
  claude
) {
  if (
    !claude?.connected
  ) {
    return "";
  }

  const breakdown =
    Array.isArray(
      claude.breakdown
    )
      ? claude.breakdown
      : [];

  const extra =
    claude.extraUsage;

  if (
    breakdown.length === 0 &&
    !extra
  ) {
    return "";
  }

  return `
    <article class="claude-details">

      <div class="details-title">

        <h2>
          Claude — detalhes semanais
        </h2>

        <span>
          Dados oficiais
        </span>

      </div>

      ${
        breakdown.length
          ? `
            <div class="breakdown">

              ${
                breakdown
                  .map(
                    (item) => `
                      <div class="breakdown-item">

                        <span>
                          ${escapeHtml(
                            item.name
                          )}
                        </span>

                        <strong>
                          ${Math.round(
                            item.percent
                          )}%
                        </strong>

                      </div>
                    `
                  )
                  .join("")
              }

            </div>
          `
          : ""
      }

      ${
        extra
          ? `
            <div class="extra-usage">

              <span>
                Extra usage
                ${
                  extra.enabled
                    ? "ativo"
                    : "desativado"
                }
              </span>

              <strong>
                ${formatMoney(
                  extra.used,
                  extra.currency
                )}
                /
                ${formatMoney(
                  extra.limit,
                  extra.currency
                )}
              </strong>

            </div>
          `
          : ""
      }

    </article>
  `;
}

/* =========================================================
   SUMMARY
========================================================= */

function renderSummary(
  providers
) {
  const connected =
    providers.filter(
      (provider) =>
        provider.connected
    );

  $("providerCount")
    .textContent =
      providers.length;

  $("connectedCount")
    .textContent =
      connected.length;

  let critical = 0;
  let warning = 0;

  for (
    const provider
    of connected
  ) {
    const health =
      providerHealth(
        provider
      );

    if (
      health.id ===
      "critical"
    ) {
      critical++;
    }

    if (
      health.id ===
      "warning"
    ) {
      warning++;
    }
  }

  const alerts =
    critical +
    warning;

  $("alertCount")
    .textContent =
      alerts;

  if (critical > 0) {
    $("alertSummary")
      .textContent =
        `${critical} crítico · ${warning} atenção`;

    return;
  }

  if (warning > 0) {
    $("alertSummary")
      .textContent =
        `${warning} em atenção`;

    return;
  }

  $("alertSummary")
    .textContent =
      "todos normais";
}

/* =========================================================
   DETECTION
========================================================= */

function monitoringLabel(
  item
) {
  if (
    item.monitoring ===
    "available"
  ) {
    return {
      id: "available",
      text:
        "Monitoramento disponível"
    };
  }

  if (
    item.monitoring ===
    "local"
  ) {
    return {
      id: "available",
      text:
        "Monitoramento local"
    };
  }

  if (
    item.monitoring ===
    "adapter_pending"
  ) {
    return {
      id: "pending",
      text:
        "Adapter pendente"
    };
  }

  return {
    id: "offline",
    text:
      "Monitoramento indisponível"
  };
}

function renderDetectionCard(
  item
) {
  const monitoring =
    monitoringLabel(
      item
    );

  const installedText =
    item.installed
      ? "Detectado"
      : "Não detectado";

  const installedClass =
    item.installed
      ? "detected"
      : "missing";

  const capabilities =
    Array.isArray(
      item.capabilities
    )
      ? item.capabilities
      : [];

  const models =
    Array.isArray(
      item.models
    )
      ? item.models
      : [];

  return `
    <article
      class="detection-card ${
        !item.installed
          ? "detection-disabled"
          : ""
      }"
    >

      <div class="detection-head">

        <div class="provider-identity">

          <div class="provider-logo">
            ${providerInitial(
              item
            )}
          </div>

          <div>

            <strong>
              ${escapeHtml(
                item.name
              )}
            </strong>

            <small>
              ${escapeHtml(
                item.description
              )}
            </small>

          </div>

        </div>

        <span
          class="detect-badge ${installedClass}"
        >
          ${installedText}
        </span>

      </div>

      <div class="detection-status-list">

        <div class="detection-status-row">

          <span>
            Instalação
          </span>

          <strong>
            ${
              item.installed
                ? "Sim"
                : "Não"
            }
          </strong>

        </div>

        ${
          item.authenticated !== null
            ? `
              <div class="detection-status-row">

                <span>
                  Autenticação
                </span>

                <strong>
                  ${
                    item.authenticated
                      ? "Detectada"
                      : "Não detectada"
                  }
                </strong>

              </div>
            `
            : ""
        }

        ${
          item.running !== undefined
            ? `
              <div class="detection-status-row">

                <span>
                  Serviço
                </span>

                <strong>
                  ${
                    item.running
                      ? "Online"
                      : "Offline"
                  }
                </strong>

              </div>
            `
            : ""
        }

        <div class="detection-status-row">

          <span>
            Monitoramento
          </span>

          <strong
            class="monitor-${monitoring.id}"
          >
            ${monitoring.text}
          </strong>

        </div>

      </div>

      ${
        item.source
          ? `
            <div class="detection-source">
              Fonte:
              ${escapeHtml(
                item.source
              )}
            </div>
          `
          : ""
      }

      ${
        capabilities.length
          ? `
            <div class="capability-list">

              ${
                capabilities
                  .map(
                    (capability) => `
                      <span>
                        ${escapeHtml(
                          capability
                        )}
                      </span>
                    `
                  )
                  .join("")
              }

            </div>
          `
          : ""
      }

      ${
        models.length
          ? `
            <div class="models-block">

              <span class="models-title">
                MODELOS LOCAIS
              </span>

              ${
                models
                  .slice(0, 6)
                  .map(
                    (model) => `
                      <div class="model-row">
                        ${escapeHtml(
                          model.name
                        )}
                      </div>
                    `
                  )
                  .join("")
              }

            </div>
          `
          : ""
      }

      ${
        item.note
          ? `
            <p class="detection-note">
              ${escapeHtml(
                item.note
              )}
            </p>
          `
          : ""
      }

    </article>
  `;
}

async function loadDetection() {
  const grid =
    $("detectionGrid");

  try {
    const response =
      await fetch(
        `/api/detection?t=${Date.now()}`,
        {
          cache: "no-store"
        }
      );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const items =
      await response.json();

    if (
      !Array.isArray(items)
    ) {
      throw new Error(
        "Resposta de detecção inválida"
      );
    }

    grid.innerHTML =
      items
        .map(
          renderDetectionCard
        )
        .join("");

    const installed =
      items.filter(
        (item) =>
          item.installed
      ).length;

    const monitorable =
      items.filter(
        (item) =>
          item.monitoring ===
            "available" ||
          item.monitoring ===
            "local"
      ).length;

    $("detectedTotal")
      .textContent =
        items.length;

    $("detectedInstalled")
      .textContent =
        installed;

    $("detectedMonitorable")
      .textContent =
        monitorable;

    $("detectionUpdatedAt")
      .textContent =
        `Detectado às ${
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

  } catch (error) {
    console.error(
      "[DevPulse Detection]",
      error
    );

    grid.innerHTML = `
      <article class="provider-card error-card">

        <strong>
          Falha na detecção local
        </strong>

        <p class="error-text">
          ${escapeHtml(
            error.message
          )}
        </p>

      </article>
    `;
  }
}

/* =========================================================
   OVERVIEW
========================================================= */

function updateCountdowns() {
  document
    .querySelectorAll(
      ".reset-countdown"
    )
    .forEach(
      (element) => {
        element.textContent =
          formatReset(
            element.dataset.reset
          );
      }
    );
}

async function loadProviders() {
  try {
    const response =
      await fetch(
        `/api/providers/all?t=${Date.now()}`,
        {
          cache: "no-store"
        }
      );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const data =
      await response.json();

    const providers =
      Array.isArray(data)
        ? data
        : Array.isArray(
            data.value
          )
          ? data.value
          : [];

    if (!providers.length) {
      throw new Error(
        "Nenhum provider retornado"
      );
    }

    $("providersGrid")
      .innerHTML =
        providers
          .map(
            renderProvider
          )
          .join("");

    renderSummary(
      providers
    );

    const claude =
      providers.find(
        (provider) =>
          provider.id ===
          "claude"
      );

    $("detailsSection")
      .innerHTML =
        renderClaudeDetails(
          claude
        );

    $("updatedAt")
      .textContent =
        `Atualizado às ${
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

    updateCountdowns();

  } catch (error) {
    console.error(
      "[DevPulse]",
      error
    );

    $("providersGrid")
      .innerHTML = `
        <article class="provider-card error-card">

          <strong>
            Falha ao carregar providers
          </strong>

          <p class="error-text">
            ${escapeHtml(
              error.message
            )}
          </p>

        </article>
      `;
  }
}

/* =========================================================
   HISTORY
========================================================= */

function getProviderFromSnapshot(
  snapshot,
  id
) {
  return snapshot
    ?.providers
    ?.find(
      (provider) =>
        provider.id === id
    ) || null;
}

function getHistoryValue(
  snapshot,
  providerId
) {
  const provider =
    getProviderFromSnapshot(
      snapshot,
      providerId
    );

  if (!provider) {
    return null;
  }

  if (
    providerId === "codex"
  ) {
    return provider
      .windows
      ?.primary
      ?.usedPercent ?? null;
  }

  if (
    providerId === "claude"
  ) {
    return provider
      .windows
      ?.secondary
      ?.usedPercent ?? null;
  }

  return null;
}

function createSvgPolyline(
  points,
  className
) {
  if (
    points.length < 2
  ) {
    return "";
  }

  const value =
    points
      .map(
        (point) =>
          `${point.x},${point.y}`
      )
      .join(" ");

  return `
    <polyline
      class="${className}"
      points="${value}"
      fill="none"
      vector-effect="non-scaling-stroke"
    />
  `;
}

function renderHistoryChart(
  snapshots
) {
  const container =
    $("historyChart");

  if (
    !snapshots.length
  ) {
    container.innerHTML = `
      <div class="history-empty">

        <strong>
          Começamos a coletar agora.
        </strong>

        <span>
          Deixe o DevPulse rodando e o gráfico
          será construído automaticamente.
        </span>

      </div>
    `;

    return;
  }

  const width = 1000;
  const height = 300;

  const paddingLeft = 42;
  const paddingRight = 18;
  const paddingTop = 18;
  const paddingBottom = 34;

  const chartWidth =
    width -
    paddingLeft -
    paddingRight;

  const chartHeight =
    height -
    paddingTop -
    paddingBottom;

  const timestamps =
    snapshots.map(
      (snapshot) =>
        new Date(
          snapshot.capturedAt
        ).getTime()
    );

  let minTime =
    Math.min(
      ...timestamps
    );

  let maxTime =
    Math.max(
      ...timestamps
    );

  if (
    minTime === maxTime
  ) {
    minTime -= 1;
    maxTime += 1;
  }

  function xFor(time) {
    return (
      paddingLeft +
      (
        (time - minTime) /
        (maxTime - minTime)
      ) *
        chartWidth
    );
  }

  function yFor(percent) {
    return (
      paddingTop +
      (
        1 -
        clamp(percent) /
          100
      ) *
        chartHeight
    );
  }

  const codexPoints = [];
  const claudePoints = [];

  for (
    const snapshot
    of snapshots
  ) {
    const time =
      new Date(
        snapshot.capturedAt
      ).getTime();

    const codex =
      getHistoryValue(
        snapshot,
        "codex"
      );

    const claude =
      getHistoryValue(
        snapshot,
        "claude"
      );

    if (
      typeof codex ===
      "number"
    ) {
      codexPoints.push({
        x:
          xFor(time),
        y:
          yFor(codex)
      });
    }

    if (
      typeof claude ===
      "number"
    ) {
      claudePoints.push({
        x:
          xFor(time),
        y:
          yFor(claude)
      });
    }
  }

  const gridValues =
    [100, 75, 50, 25, 0];

  const grid =
    gridValues
      .map(
        (value) => {
          const y =
            yFor(value);

          return `
            <line
              class="chart-grid-line"
              x1="${paddingLeft}"
              y1="${y}"
              x2="${width - paddingRight}"
              y2="${y}"
            />

            <text
              class="chart-label"
              x="4"
              y="${y + 4}"
            >
              ${value}%
            </text>
          `;
        }
      )
      .join("");

  const firstLabel =
    formatDateTime(
      snapshots[0]
        .capturedAt
    );

  const lastLabel =
    formatDateTime(
      snapshots[
        snapshots.length - 1
      ].capturedAt
    );

  container.innerHTML = `
    <svg
      class="usage-history-svg"
      viewBox="0 0 ${width} ${height}"
      preserveAspectRatio="none"
      aria-label="Histórico de uso"
    >

      ${grid}

      ${createSvgPolyline(
        codexPoints,
        "chart-line chart-line-codex"
      )}

      ${createSvgPolyline(
        claudePoints,
        "chart-line chart-line-claude"
      )}

      <text
        class="chart-label chart-date-label"
        x="${paddingLeft}"
        y="${height - 6}"
      >
        ${escapeHtml(
          firstLabel
        )}
      </text>

      <text
        class="chart-label chart-date-label"
        x="${width - paddingRight}"
        y="${height - 6}"
        text-anchor="end"
      >
        ${escapeHtml(
          lastLabel
        )}
      </text>

    </svg>
  `;
}

function renderHistoryEvents(
  snapshots
) {
  const container =
    $("historyEvents");

  if (
    !snapshots.length
  ) {
    container.innerHTML = `
      <div class="history-empty">
        Nenhum snapshot no período.
      </div>
    `;

    return;
  }

  const recent =
    [...snapshots]
      .reverse()
      .slice(0, 12);

  container.innerHTML =
    recent
      .map(
        (snapshot) => {
          const codex =
            getHistoryValue(
              snapshot,
              "codex"
            );

          const claude =
            getHistoryValue(
              snapshot,
              "claude"
            );

          return `
            <div class="history-event">

              <span class="history-event-time">
                ${escapeHtml(
                  formatDateTime(
                    snapshot.capturedAt
                  )
                )}
              </span>

              <div class="history-event-values">

                <span>
                  Codex
                  <strong>
                    ${
                      codex == null
                        ? "—"
                        : `${Math.round(
                            codex
                          )}%`
                    }
                  </strong>
                </span>

                <span>
                  Claude
                  <strong>
                    ${
                      claude == null
                        ? "—"
                        : `${Math.round(
                            claude
                          )}%`
                    }
                  </strong>
                </span>

              </div>

            </div>
          `;
        }
      )
      .join("");
}

function renderHistory(
  data
) {
  const snapshots =
    Array.isArray(
      data.snapshots
    )
      ? data.snapshots
      : [];

  $("historySnapshotCount")
    .textContent =
      snapshots.length;

  const latest =
    snapshots[
      snapshots.length - 1
    ];

  const codex =
    latest
      ? getHistoryValue(
          latest,
          "codex"
        )
      : null;

  const claude =
    latest
      ? getHistoryValue(
          latest,
          "claude"
        )
      : null;

  $("historyCodexCurrent")
    .textContent =
      codex == null
        ? "—"
        : `${Math.round(
            codex
          )}%`;

  $("historyClaudeCurrent")
    .textContent =
      claude == null
        ? "—"
        : `${Math.round(
            claude
          )}%`;

  $("historyStatus")
    .textContent =
      snapshots.length
        ? `Última coleta: ${formatDateTime(
            latest.capturedAt
          )}`
        : "Aguardando primeira coleta";

  renderHistoryChart(
    snapshots
  );

  renderHistoryEvents(
    snapshots
  );
}

async function loadHistory() {
  $("historyStatus")
    .textContent =
      "Carregando histórico...";

  try {
    const response =
      await fetch(
        `/api/history?hours=${historyHours}&t=${Date.now()}`,
        {
          cache: "no-store"
        }
      );

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const data =
      await response.json();

    renderHistory(
      data
    );

  } catch (error) {
    console.error(
      "[DevPulse History]",
      error
    );

    $("historyStatus")
      .textContent =
        "Falha ao carregar histórico";

    $("historyChart")
      .innerHTML = `
        <div class="history-empty error-text">
          ${escapeHtml(
            error.message
          )}
        </div>
      `;
  }
}

/* =========================================================
   NAVIGATION
========================================================= */

const viewConfig = {
  overview: {
    element:
      "overviewView",

    title:
      "Visão geral",

    subtitle:
      "Limites e consumo das suas ferramentas de IA."
  },

  providers: {
    element:
      "providersView",

    title:
      "Providers",

    subtitle:
      "Ferramentas de IA detectadas nesta máquina e capacidades de monitoramento."
  },

  history: {
    element:
      "historyView",

    title:
      "Histórico",

    subtitle:
      "Evolução local do consumo e dos limites ao longo do tempo."
  }
};

function showView(
  viewName
) {
  const config =
    viewConfig[
      viewName
    ];

  if (!config) {
    return;
  }

  currentView =
    viewName;

  document
    .querySelectorAll(
      ".app-view"
    )
    .forEach(
      (view) =>
        view.classList
          .remove("active")
    );

  const element =
    $(config.element);

  if (element) {
    element.classList
      .add("active");
  }

  document
    .querySelectorAll(
      ".nav-item"
    )
    .forEach(
      (button) => {
        button.classList
          .toggle(
            "active",
            button.dataset
              .view ===
              viewName
          );
      }
    );

  $("pageTitle")
    .textContent =
      config.title;

  $("pageSubtitle")
    .textContent =
      config.subtitle;

  window.location.hash =
    viewName;

  if (
    viewName ===
    "providers"
  ) {
    loadDetection();
  }

  if (
    viewName ===
    "history"
  ) {
    loadHistory();
  }
}

document
  .querySelectorAll(
    ".nav-item"
  )
  .forEach(
    (button) => {
      button.addEventListener(
        "click",
        () => {
          showView(
            button.dataset.view
          );
        }
      );
    }
  );

document
  .querySelectorAll(
    ".range-button"
  )
  .forEach(
    (button) => {
      button.addEventListener(
        "click",
        () => {
          historyHours =
            Number(
              button.dataset.hours
            ) || 24;

          document
            .querySelectorAll(
              ".range-button"
            )
            .forEach(
              (item) =>
                item.classList
                  .remove(
                    "active"
                  )
            );

          button.classList
            .add("active");

          loadHistory();
        }
      );
    }
  );

/* =========================================================
   REFRESH
========================================================= */

async function refreshCurrentView() {
  const button =
    $("refreshButton");

  button.disabled = true;

  button.textContent =
    "Atualizando...";

  try {
    if (
      currentView ===
      "providers"
    ) {
      await loadDetection();

    } else if (
      currentView ===
      "history"
    ) {
      await loadHistory();

    } else {
      await loadProviders();
    }

  } finally {
    button.disabled = false;

    button.textContent =
      "Atualizar";
  }
}

$("refreshButton")
  .addEventListener(
    "click",
    refreshCurrentView
  );

/* =========================================================
   START
========================================================= */

const initialHash =
  window.location.hash
    .replace("#", "");

if (
  viewConfig[
    initialHash
  ]
) {
  showView(
    initialHash
  );
} else {
  showView(
    "overview"
  );
}

loadProviders();

setInterval(
  () => {
    if (
      currentView ===
      "overview"
    ) {
      loadProviders();
    }
  },
  60 * 1000
);

setInterval(
  updateCountdowns,
  30 * 1000
);