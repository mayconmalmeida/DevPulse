/*
 * DevPulse v0.11.0 — smoke suite.
 *
 * Roda com: node test/smoke.js
 *
 * REGRAS DESTE ARQUIVO (não violar):
 *   - nunca escreve em data/history.jsonl real;
 *   - nunca escreve em data/activity.jsonl real;
 *   - nunca chama rede/APIs externas;
 *   - nunca lê/gera credenciais reais;
 *   - usa exclusivamente fixtures em memória.
 *
 * Isso é possível porque testamos as funções REAIS
 * exportadas (executeProvider, isEligibleForHistory,
 * recordActivity, sanitizeProvider) passando fixtures como
 * argumento — nunca uma reimplementação paralela da lógica,
 * e nunca os adapters de verdade (que tocariam rede/CLI/
 * arquivos reais do usuário).
 */

const assert = require("node:assert/strict");

const { executeProvider } = require("../src/providers/runtime");
const { isEligibleForHistory, sanitizeProvider } = require("../src/history/store");
const { recordActivity } = require("../src/activity/tracker");

const {
  evaluateAndPersistAlerts
} = require("../src/alerts/engine");

const {
  tierForPercent,
  evaluateHealthAlert,
  classifyHealthCondition,
  STALE_PERSISTENCE_MS
} = require("../src/alerts/evaluator");

const {
  sanitizeAlert
} = require("../src/alerts/store");

const {
  isValidConfig
} = require("../src/alerts/config");

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

/* =========================================================
   FIXTURES (nunca dado real)
========================================================= */

function fixtureCodexSnapshot(percent) {
  return {
    id: "codex",
    name: "Codex",
    kind: "cloud-provider",
    connected: true,
    status: "ok",
    windows: {
      primary: {
        id: "primary",
        label: "5 h",
        usedPercent: percent,
        remainingPercent: 100 - percent,
        resetsAt: null
      },
      secondary: null
    },
    updatedAt: new Date().toISOString()
  };
}

function fixtureClaudeSnapshot(percent) {
  return {
    id: "claude",
    name: "Claude",
    kind: "cloud-provider",
    connected: true,
    status: "ok",
    windows: {
      primary: {
        id: "five_hour",
        label: "5 h",
        usedPercent: 10,
        remainingPercent: 90,
        resetsAt: null
      },
      secondary: {
        id: "seven_day",
        label: "Semanal",
        usedPercent: percent,
        remainingPercent: 100 - percent,
        resetsAt: null
      }
    },
    breakdown: [],
    updatedAt: new Date().toISOString()
  };
}

function fixtureOllamaSnapshot({ online, loadedModels }) {
  return {
    id: "ollama",
    name: "Ollama",
    kind: "local-runtime",
    connected: online,
    detected: true,
    status: online ? "ok" : "offline",
    online,
    version: "0.34.0",
    modelsInstalled: 7,
    modelsLoaded: loadedModels.length,
    models: [],
    loadedModels,
    updatedAt: new Date().toISOString()
  };
}

function fixtureOpencodeSnapshot({ sessions, messages }) {
  return {
    id: "opencode",
    name: "OpenCode",
    kind: "ai-client",
    connected: true,
    detected: true,
    status: "ok",
    version: "1.18.31",
    configuredProviders: [{ name: "OpenAI", source: "environment" }],
    activity: { sessions, messages, periodDays: 7 },
    note: "O consumo pertence aos providers utilizados pelo OpenCode e não é somado novamente pelo DevPulse.",
    updatedAt: new Date().toISOString()
  };
}

function fixtureNotInstalledSnapshot(id, name) {
  return {
    id,
    name,
    kind: id === "gemini" ? "cloud-provider" : "ai-client",
    connected: false,
    detected: false,
    status: "not-installed",
    note: `${name} não foi encontrado.`,
    updatedAt: new Date().toISOString()
  };
}

const CAPABILITIES = {
  codex: { quota: true, history: true, runtime: false, models: false, activity: true },
  claude: { quota: true, history: true, runtime: false, models: false, activity: true },
  ollama: { quota: false, history: false, runtime: true, models: true, activity: true },
  opencode: { quota: false, history: false, runtime: false, models: false, activity: true },
  gemini: { quota: false, history: false, runtime: false, models: false, activity: true },
  cursor: { quota: false, history: false, runtime: false, models: false, activity: true }
};

function fixtureProviderDescriptor(id, overrides = {}) {
  return {
    id,
    name: id,
    kind: "cloud-provider",
    capabilities: CAPABILITIES[id],
    ttlMs: 200,
    ...overrides
  };
}

/* =========================================================
   1-2. QUOTA VÁLIDA (Codex/Claude) — elegibilidade real
========================================================= */

test("Codex quota válida é elegível para histórico", () => {
  const provider = { capabilities: CAPABILITIES.codex, ...fixtureCodexSnapshot(12) };
  assert.equal(isEligibleForHistory(provider), true);
});

test("Claude quota válida é elegível para histórico", () => {
  const provider = { capabilities: CAPABILITIES.claude, ...fixtureClaudeSnapshot(84) };
  assert.equal(isEligibleForHistory(provider), true);
});

/* =========================================================
   3. QUOTA TEMPORARIAMENTE OFFLINE COM SNAPSHOT VÁLIDO
========================================================= */

test("provider com quota volta 'stale' após falha, preservando o último dado válido", async () => {
  let callCount = 0;

  const provider = fixtureProviderDescriptor("test-stale-quota", {
    capabilities: CAPABILITIES.codex,
    ttlMs: 50,
    getSnapshot: async () => {
      callCount += 1;
      if (callCount === 1) {
        return fixtureCodexSnapshot(42);
      }
      throw new Error("SIMULATED_TEMPORARY_FAILURE");
    }
  });

  const first = await executeProvider(provider, { force: true });
  assert.equal(first.runtime.source, "live");
  assert.equal(first.windows.primary.usedPercent, 42);

  const second = await executeProvider(provider, { force: true });
  assert.equal(second.status, "stale");
  assert.equal(second.runtime.stale, true);
  assert.equal(
    second.windows.primary.usedPercent,
    42,
    "o último valor válido deve ser preservado, não apagado"
  );
});

/* =========================================================
   4-6. OLLAMA: online sem modelo / com modelo / offline
========================================================= */

test("Ollama online sem modelo carregado não gera evento de modelo", () => {
  const provider = fixtureProviderDescriptor("ollama");
  const events = [];
  const append = (event) => events.push(event);

  const previous = fixtureOllamaSnapshot({ online: true, loadedModels: [] });
  const current = fixtureOllamaSnapshot({ online: true, loadedModels: [] });

  recordActivity(provider, previous, current, append);

  const modelEvents = events.filter((event) => event.type.startsWith("model-"));
  assert.equal(modelEvents.length, 0);
});

test("Ollama online com modelo recém-carregado gera 'model-loaded'", () => {
  const provider = fixtureProviderDescriptor("ollama");
  const events = [];
  const append = (event) => events.push(event);

  const previous = fixtureOllamaSnapshot({ online: true, loadedModels: [] });
  const current = fixtureOllamaSnapshot({
    online: true,
    loadedModels: [{ name: "qwen3.5:2b" }]
  });

  recordActivity(provider, previous, current, append);

  const loaded = events.find((event) => event.type === "model-loaded");
  assert.ok(loaded, "esperava um evento model-loaded");
  assert.equal(loaded.payload.model, "qwen3.5:2b");
});

test("Ollama que fica offline gera 'runtime-offline'", () => {
  const provider = fixtureProviderDescriptor("ollama");
  const events = [];
  const append = (event) => events.push(event);

  const previous = fixtureOllamaSnapshot({ online: true, loadedModels: [] });
  const current = fixtureOllamaSnapshot({ online: false, loadedModels: [] });

  recordActivity(provider, previous, current, append);

  const offlineEvent = events.find((event) => event.type === "runtime-offline");
  assert.ok(offlineEvent, "esperava um evento runtime-offline");
});

/* =========================================================
   7. OPENCODE DISPONÍVEL
========================================================= */

test("OpenCode disponível não é elegível para histórico de quota (nunca soma consumo)", () => {
  const provider = { capabilities: CAPABILITIES.opencode, ...fixtureOpencodeSnapshot({ sessions: 5, messages: 900 }) };
  assert.equal(isEligibleForHistory(provider), false);
});

test("OpenCode com atividade alterada gera 'activity-changed'", () => {
  const provider = fixtureProviderDescriptor("opencode");
  const events = [];
  const append = (event) => events.push(event);

  const previous = fixtureOpencodeSnapshot({ sessions: 5, messages: 900 });
  const current = fixtureOpencodeSnapshot({ sessions: 5, messages: 918 });

  recordActivity(provider, previous, current, append);

  const changed = events.find((event) => event.type === "activity-changed");
  assert.ok(changed, "esperava um evento activity-changed");
  assert.equal(changed.payload.messages, 918);
});

/* =========================================================
   8-9. GEMINI / CURSOR NOT-INSTALLED
========================================================= */

test("Gemini not-installed não é elegível para histórico", () => {
  const provider = { capabilities: CAPABILITIES.gemini, ...fixtureNotInstalledSnapshot("gemini", "Gemini") };
  assert.equal(isEligibleForHistory(provider), false);
});

test("Cursor not-installed não é elegível para histórico", () => {
  const provider = { capabilities: CAPABILITIES.cursor, ...fixtureNotInstalledSnapshot("cursor", "Cursor") };
  assert.equal(isEligibleForHistory(provider), false);
});

/* =========================================================
   10. HISTORY CAPABILITY ISOLATION (visão consolidada)
========================================================= */

test("isolamento do histórico: só Codex/Claude entram, os outros 4 nunca", () => {
  const fixtures = [
    { capabilities: CAPABILITIES.codex, ...fixtureCodexSnapshot(12) },
    { capabilities: CAPABILITIES.claude, ...fixtureClaudeSnapshot(84) },
    { capabilities: CAPABILITIES.ollama, ...fixtureOllamaSnapshot({ online: true, loadedModels: [] }) },
    { capabilities: CAPABILITIES.opencode, ...fixtureOpencodeSnapshot({ sessions: 5, messages: 900 }) },
    { capabilities: CAPABILITIES.gemini, ...fixtureNotInstalledSnapshot("gemini", "Gemini") },
    { capabilities: CAPABILITIES.cursor, ...fixtureNotInstalledSnapshot("cursor", "Cursor") }
  ];

  const eligible = fixtures.filter(isEligibleForHistory).map((p) => p.id);

  assert.deepEqual(eligible, ["codex", "claude"]);
});

/* =========================================================
   11. ACTIVITY DEDUPLICATION
========================================================= */

test("nenhum evento é gravado quando nada muda entre duas leituras", () => {
  const provider = fixtureProviderDescriptor("codex");
  const events = [];
  const append = (event) => events.push(event);

  const snapshot = fixtureCodexSnapshot(50);

  recordActivity(provider, snapshot, snapshot, append);

  assert.equal(events.length, 0);
});

/* =========================================================
   12. CACHE TTL
========================================================= */

test("dentro do TTL, a segunda chamada usa cache e não busca de novo", async () => {
  let callCount = 0;

  const provider = fixtureProviderDescriptor("test-ttl-cache", {
    ttlMs: 5000,
    getSnapshot: async () => {
      callCount += 1;
      return fixtureCodexSnapshot(7);
    }
  });

  const first = await executeProvider(provider);
  const second = await executeProvider(provider);

  assert.equal(callCount, 1, "getSnapshot deveria ter sido chamado só uma vez");
  assert.equal(first.runtime.source, "live");
  assert.equal(second.runtime.source, "cache");
});

/* =========================================================
   13. FORCE REFRESH
========================================================= */

test("force:true ignora o cache e busca de novo", async () => {
  let callCount = 0;

  const provider = fixtureProviderDescriptor("test-force-refresh", {
    ttlMs: 5000,
    getSnapshot: async () => {
      callCount += 1;
      return fixtureCodexSnapshot(callCount);
    }
  });

  await executeProvider(provider);
  const second = await executeProvider(provider, { force: true });

  assert.equal(callCount, 2, "getSnapshot deveria ter sido chamado duas vezes com force:true");
  assert.equal(second.windows.primary.usedPercent, 2);
});

/* =========================================================
   14. CONCURRENT REFRESH / SINGLE-FLIGHT
========================================================= */

test("duas chamadas concorrentes reaproveitam a mesma busca (single-flight)", async () => {
  let callCount = 0;
  let resolveFetch;

  const provider = fixtureProviderDescriptor("test-single-flight", {
    ttlMs: 5000,
    getSnapshot: () =>
      new Promise((resolve) => {
        callCount += 1;
        resolveFetch = () => resolve(fixtureCodexSnapshot(33));
      })
  });

  const call1 = executeProvider(provider, { force: true });
  const call2 = executeProvider(provider, { force: true });

  // dá tempo dos dois `executeProvider` iniciarem antes de resolver
  await new Promise((resolve) => setTimeout(resolve, 20));
  resolveFetch();

  const [result1, result2] = await Promise.all([call1, call2]);

  assert.equal(callCount, 1, "getSnapshot deveria ter sido chamado só uma vez para as duas chamadas concorrentes");
  assert.equal(result1.windows.primary.usedPercent, 33);
  assert.equal(result2.windows.primary.usedPercent, 33);
});

/* =========================================================
   15. SANITIZAÇÃO
========================================================= */

test("sanitizeProvider nunca repassa campos sensíveis de um snapshot contaminado", () => {
  const dirty = {
    id: "codex",
    name: "Codex",
    connected: true,
    status: "ok",
    plan: "plus",
    windows: {
      primary: { id: "p", label: "5 h", usedPercent: 10, remainingPercent: 90, resetsAt: null },
      secondary: null
    },

    // campos que NUNCA deveriam sobreviver à sanitização —
    // simulando um bug hipotético em algum adapter futuro.
    access_token: "sk-live-super-secret",
    refresh_token: "rt-should-not-leak",
    accountId: "acct_should_not_leak",
    authorization: "Bearer should-not-leak",
    cookie: "session=should-not-leak"
  };

  const sanitized = sanitizeProvider(dirty);
  const serialized = JSON.stringify(sanitized);

  for (const secret of [
    "sk-live-super-secret",
    "rt-should-not-leak",
    "acct_should_not_leak",
    "should-not-leak"
  ]) {
    assert.equal(
      serialized.includes(secret),
      false,
      `valor sensível "${secret}" vazou na sanitização`
    );
  }
});

test("evento de atividade nunca contém campos fora do payload tipado esperado", () => {
  const provider = fixtureProviderDescriptor("codex");
  const events = [];
  const append = (event) => events.push(event);

  const previous = fixtureCodexSnapshot(10);
  const current = {
    ...fixtureCodexSnapshot(15),
    // campo hipotético que um adapter nunca deveria incluir,
    // mas que o tracker também não deve propagar de jeito
    // nenhum caso ele exista.
    access_token: "sk-should-never-appear"
  };

  recordActivity(provider, previous, current, append);

  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes("sk-should-never-appear"), false);

  const allowedKeys = new Set(["timestamp", "providerId", "type", "payload"]);
  for (const event of events) {
    for (const key of Object.keys(event)) {
      assert.ok(allowedKeys.has(key), `chave inesperada "${key}" em evento de atividade`);
    }
  }
});

/* =========================================================
   ALERTS — v0.12.0
   ALERT != ACTIVITY: testa evaluateAndPersistAlerts (a
   função REAL usada em produção via src/providers/runtime.js
   e registry.js) com dependências injetadas (mesmo padrão de
   recordActivity/append acima) — nunca toca data/alerts.jsonl
   nem data/alerts-config.json, nunca spawna PowerShell de
   verdade.
========================================================= */

const DEFAULT_ALERTS_CONFIG = {
  alertsEnabled: true,
  windowsNotificationsEnabled: true,
  warningThreshold: 70,
  criticalThreshold: 90
};

function fixtureAlertsConfig(overrides = {}) {
  return { ...DEFAULT_ALERTS_CONFIG, ...overrides };
}

/*
 * Store fake em memória — mesmo contrato de
 * src/alerts/store.js (getExisting/appendAlertState), mas
 * sem tocar em disco. É isso que permite testar dedup e
 * "sobrevive a restart" sem um arquivo real.
 */
/*
 * `calls` conta toda ESCRITA (mesmo padrão do
 * data/alerts.jsonl real, que cresce uma linha por escrita,
 * mesmo repetindo o mesmo id) — é o que prova "não duplicou".
 * `byId` só guarda o estado mais recente, para leitura
 * (getExisting), igual ao "latestStateById" do store real.
 */
function createFakeAlertStore() {
  const byId = new Map();
  const calls = [];

  return {
    getExisting: (id) => byId.get(id) || null,

    appendAlertState: (alert) => {
      const record = { ...alert };
      byId.set(alert.id, record);
      calls.push(record);
      return record;
    },

    all: () => [...byId.values()],
    calls
  };
}

function createFakeNotifier() {
  const calls = [];

  return {
    sendWindowsNotification: (alert) => {
      calls.push(alert);
    },
    calls
  };
}

function alertDeps({
  config = fixtureAlertsConfig(),
  store = createFakeAlertStore(),
  notifier = createFakeNotifier(),
  staleTracking = new Map()
} = {}) {
  return {
    deps: {
      getConfig: () => config,
      getExisting: store.getExisting,
      appendAlertState: store.appendAlertState,
      sendWindowsNotification: notifier.sendWindowsNotification,
      staleTracking
    },
    store,
    notifier
  };
}

/* =========================================================
   16-17. QUOTA: tierForPercent (limiares puros)
========================================================= */

test("tierForPercent classifica normal/warning/critical pelos limiares do DevPulse", () => {
  const config = fixtureAlertsConfig();

  assert.equal(tierForPercent(69, config), "normal");
  assert.equal(tierForPercent(70, config), "warning");
  assert.equal(tierForPercent(89, config), "warning");
  assert.equal(tierForPercent(90, config), "critical");
});

/* =========================================================
   18. 69 -> 70 CRIA ALERTA DE WARNING
========================================================= */

test("quota 69% -> 70% cria um alerta de warning novo", () => {
  const { deps, store } = alertDeps();
  const provider = fixtureProviderDescriptor("codex");

  evaluateAndPersistAlerts(provider, fixtureCodexSnapshot(69), deps);
  assert.equal(store.calls.length, 0, "69% ainda é normal, não deveria criar nada");

  evaluateAndPersistAlerts(provider, fixtureCodexSnapshot(70), deps);

  assert.equal(store.calls.length, 1);
  assert.equal(store.calls[0].severity, "warning");
  assert.equal(store.calls[0].state, "active");
});

/* =========================================================
   19. 70 -> 71 NÃO DUPLICA (mesma faixa)
========================================================= */

test("quota 70% -> 71% (mesma faixa de warning) não duplica o alerta", () => {
  const { deps, store } = alertDeps();
  const provider = fixtureProviderDescriptor("codex");

  evaluateAndPersistAlerts(provider, fixtureCodexSnapshot(70), deps);
  evaluateAndPersistAlerts(provider, fixtureCodexSnapshot(71), deps);

  assert.equal(store.calls.length, 1, "70->71 é a mesma faixa, não deveria gravar de novo");
});

/* =========================================================
   20. 89 -> 90 ESCALA PARA CRITICAL
========================================================= */

test("quota 89% -> 90% escala o alerta existente para critical", () => {
  const { deps, store } = alertDeps();
  const provider = fixtureProviderDescriptor("codex");

  evaluateAndPersistAlerts(provider, fixtureCodexSnapshot(89), deps);
  evaluateAndPersistAlerts(provider, fixtureCodexSnapshot(90), deps);

  const record = store.getExisting("codex:quota:primary");
  assert.equal(record.severity, "critical");
  assert.equal(record.state, "active");
});

/* =========================================================
   21. 90 -> 95 NÃO DUPLICA (já em critical)
========================================================= */

test("quota 90% -> 95% (já em critical) não duplica o alerta", () => {
  const { deps, store } = alertDeps();
  const provider = fixtureProviderDescriptor("codex");

  evaluateAndPersistAlerts(provider, fixtureCodexSnapshot(90), deps);
  evaluateAndPersistAlerts(provider, fixtureCodexSnapshot(95), deps);

  assert.equal(store.calls.length, 1, "90 cria o alerta; 95 (mesma faixa critical) não deveria gravar de novo");
});

/* =========================================================
   22. RESET ABAIXO DO WARNING RESOLVE
========================================================= */

test("quota volta abaixo do warning e resolve o alerta ativo", () => {
  const { deps, store } = alertDeps();
  const provider = fixtureProviderDescriptor("codex");

  evaluateAndPersistAlerts(provider, fixtureCodexSnapshot(95), deps);
  evaluateAndPersistAlerts(provider, fixtureCodexSnapshot(20), deps);

  const record = store.getExisting("codex:quota:primary");
  assert.equal(record.state, "resolved");
});

/* =========================================================
   23-24. HEALTH: ok <-> offline
========================================================= */

test("provider fica offline (ok -> offline) cria um alerta de saúde", () => {
  const { deps, store } = alertDeps();
  const provider = fixtureProviderDescriptor("ollama");

  evaluateAndPersistAlerts(
    provider,
    { id: "ollama", name: "Ollama", connected: true, status: "ok" },
    deps
  );

  assert.equal(store.all().length, 0);

  evaluateAndPersistAlerts(
    provider,
    { id: "ollama", name: "Ollama", connected: false, status: "offline" },
    deps
  );

  const record = store.getExisting("ollama:health");
  assert.equal(record.state, "active");
  assert.equal(record.severity, "warning");
});

test("provider volta (offline -> ok) resolve o alerta de saúde", () => {
  const { deps, store } = alertDeps();
  const provider = fixtureProviderDescriptor("ollama");

  evaluateAndPersistAlerts(
    provider,
    { id: "ollama", name: "Ollama", connected: false, status: "offline" },
    deps
  );

  evaluateAndPersistAlerts(
    provider,
    { id: "ollama", name: "Ollama", connected: true, status: "ok" },
    deps
  );

  const record = store.getExisting("ollama:health");
  assert.equal(record.state, "resolved");
});

/* =========================================================
   25. NOT-INSTALLED NUNCA ALERTA
========================================================= */

test("provider not-installed nunca gera alerta de saúde", () => {
  const { deps, store } = alertDeps();
  const provider = fixtureProviderDescriptor("gemini");

  evaluateAndPersistAlerts(
    provider,
    fixtureNotInstalledSnapshot("gemini", "Gemini"),
    deps
  );

  assert.equal(store.all().length, 0);
  assert.equal(classifyHealthCondition("not-installed"), "not-applicable");
});

/* =========================================================
   26-27. STALE TRANSIENTE X PERSISTENTE
========================================================= */

test("stale pontual (dentro da janela de tolerância) não gera alerta ainda", () => {
  const provider = fixtureProviderDescriptor("ollama");
  const staleTracking = new Map();
  const now = Date.now();

  const transition = evaluateHealthAlert({
    provider,
    currentSnapshot: { id: "ollama", status: "stale" },
    getExisting: () => null,
    staleTracking,
    now
  });

  assert.equal(transition, null, "não deveria alertar por uma leitura stale isolada");
});

test("stale persistente (acima de STALE_PERSISTENCE_MS) gera no máximo um alerta", () => {
  const provider = fixtureProviderDescriptor("ollama");
  const staleTracking = new Map();
  const start = Date.now();

  const first = evaluateHealthAlert({
    provider,
    currentSnapshot: { id: "ollama", status: "stale" },
    getExisting: () => null,
    staleTracking,
    now: start
  });

  assert.equal(first, null);

  const later = start + STALE_PERSISTENCE_MS + 1000;

  const second = evaluateHealthAlert({
    provider,
    currentSnapshot: { id: "ollama", status: "stale" },
    getExisting: () => null,
    staleTracking,
    now: later
  });

  assert.ok(second, "deveria alertar após persistir além do limiar");
  assert.equal(second.action, "create");

  // simula o alerta já ativo no store a partir daqui
  const existing = { ...second.alert };

  const third = evaluateHealthAlert({
    provider,
    currentSnapshot: { id: "ollama", status: "stale" },
    getExisting: () => existing,
    staleTracking,
    now: later + 60000
  });

  assert.equal(third, null, "não deveria alertar de novo enquanto já ativo (no máximo um alerta)");
});

/* =========================================================
   28. RESTART NÃO DUPLICA UM ALERTA JÁ ATIVO
========================================================= */

test("reiniciar o DevPulse (staleTracking novo) não duplica um alerta de quota já ativo", () => {
  const { deps: firstRunDeps, store } = alertDeps();
  const provider = fixtureProviderDescriptor("codex");

  evaluateAndPersistAlerts(provider, fixtureCodexSnapshot(80), firstRunDeps);
  assert.equal(store.calls.length, 1);

  // "restart": o store persistido continua o mesmo, mas
  // staleTracking (em memória) começa vazio de novo — é
  // exatamente isso que acontece quando o processo reinicia.
  const restarted = alertDeps({ store });

  evaluateAndPersistAlerts(provider, fixtureCodexSnapshot(81), restarted.deps);

  assert.equal(
    store.calls.length,
    1,
    "condição ainda ativa na mesma faixa não deveria recriar o alerta após um 'restart'"
  );
});

/* =========================================================
   29. ACKNOWLEDGE NÃO É RECRIADO A CADA POLLING
========================================================= */

test("alerta confirmado (acknowledged) e sem mudança real não é reescrito a cada polling", () => {
  const { deps, store } = alertDeps();
  const provider = fixtureProviderDescriptor("codex");

  evaluateAndPersistAlerts(provider, fixtureCodexSnapshot(75), deps);

  const active = store.getExisting("codex:quota:primary");
  store.appendAlertState({ ...active, state: "acknowledged" });

  assert.equal(store.calls.length, 2, "1 create + 1 acknowledge manual");

  evaluateAndPersistAlerts(provider, fixtureCodexSnapshot(75), deps);
  evaluateAndPersistAlerts(provider, fixtureCodexSnapshot(76), deps);

  const finalRecord = store.getExisting("codex:quota:primary");
  assert.equal(store.calls.length, 2, "sem mudança de faixa, não deveria gravar linha nova mesmo acknowledged");
  assert.equal(finalRecord.state, "acknowledged", "deveria permanecer acknowledged, não voltar sozinho para active");
});

/* =========================================================
   30. SANITIZAÇÃO DO ALERTA
========================================================= */

test("sanitizeAlert nunca repassa campos fora da whitelist", () => {
  const dirty = {
    id: "codex:quota:primary",
    createdAt: new Date().toISOString(),
    providerId: "codex",
    type: "quota",
    severity: "warning",
    title: "Codex · 5 h",
    message: "70% utilizado",
    state: "active",
    meta: { percent: 70 },

    // campos que nunca deveriam sobreviver
    access_token: "sk-live-should-not-leak",
    authorization: "Bearer should-not-leak"
  };

  const sanitized = sanitizeAlert(dirty);
  const serialized = JSON.stringify(sanitized);

  assert.equal(serialized.includes("should-not-leak"), false);

  const allowedKeys = new Set([
    "id", "createdAt", "updatedAt", "providerId", "type",
    "severity", "title", "message", "state", "meta",
    "lastNotifiedSeverity"
  ]);

  for (const key of Object.keys(sanitized)) {
    assert.ok(allowedKeys.has(key), `chave inesperada "${key}" em alerta sanitizado`);
  }
});

/* =========================================================
   31. THRESHOLDS INVÁLIDOS REJEITADOS
========================================================= */

test("config de alerts rejeita limiares inválidos (warning >= critical, ou fora de 0-100)", () => {
  assert.equal(isValidConfig(fixtureAlertsConfig({ warningThreshold: 90, criticalThreshold: 90 })), false);
  assert.equal(isValidConfig(fixtureAlertsConfig({ warningThreshold: 95, criticalThreshold: 90 })), false);
  assert.equal(isValidConfig(fixtureAlertsConfig({ warningThreshold: -1 })), false);
  assert.equal(isValidConfig(fixtureAlertsConfig({ criticalThreshold: 101 })), false);
  assert.equal(isValidConfig(fixtureAlertsConfig({ warningThreshold: 70, criticalThreshold: 90 })), true);
});

/* =========================================================
   32. NOTIFICAÇÃO DO WINDOWS RESPEITA A CONFIG
========================================================= */

test("windowsNotificationsEnabled:false nunca dispara notificação, mas ainda grava o alerta", () => {
  const { deps, store, notifier } = alertDeps({
    config: fixtureAlertsConfig({ windowsNotificationsEnabled: false })
  });

  const provider = fixtureProviderDescriptor("codex");

  evaluateAndPersistAlerts(provider, fixtureCodexSnapshot(95), deps);

  assert.equal(notifier.calls.length, 0, "notificação desabilitada não deveria disparar nada");
  assert.equal(store.all().length, 1, "o alerta em si ainda deve ser registrado");
});

test("alertsEnabled:false não avalia nem grava nenhum alerta", () => {
  const { deps, store, notifier } = alertDeps({
    config: fixtureAlertsConfig({ alertsEnabled: false })
  });

  const provider = fixtureProviderDescriptor("codex");

  evaluateAndPersistAlerts(provider, fixtureCodexSnapshot(95), deps);

  assert.equal(store.all().length, 0);
  assert.equal(notifier.calls.length, 0);
});

/* =========================================================
   33. COOLDOWN DE NOTIFICAÇÃO
========================================================= */

test("cooldown de notificação: 91% notifica uma vez, 92%/93% (mesma faixa) não renotificam", () => {
  const { deps, notifier } = alertDeps();
  const provider = fixtureProviderDescriptor("codex");

  evaluateAndPersistAlerts(provider, fixtureCodexSnapshot(91), deps);
  assert.equal(notifier.calls.length, 1);

  evaluateAndPersistAlerts(provider, fixtureCodexSnapshot(92), deps);
  evaluateAndPersistAlerts(provider, fixtureCodexSnapshot(93), deps);

  assert.equal(notifier.calls.length, 1, "92%/93% ainda em critical não deveriam renotificar");
});

test("cooldown reseta ao resolver: reset a 20% depois 89->90 dispara nova notificação critical", () => {
  const { deps, store, notifier } = alertDeps();
  const provider = fixtureProviderDescriptor("codex");

  evaluateAndPersistAlerts(provider, fixtureCodexSnapshot(91), deps);
  assert.equal(notifier.calls.length, 1);

  evaluateAndPersistAlerts(provider, fixtureCodexSnapshot(20), deps);
  assert.equal(store.getExisting("codex:quota:primary").state, "resolved");

  evaluateAndPersistAlerts(provider, fixtureCodexSnapshot(89), deps);
  evaluateAndPersistAlerts(provider, fixtureCodexSnapshot(90), deps);

  /*
   * Depois do resolve, 89% é uma condição NOVA e legítima
   * (cruza o warning pela primeira vez desde a resolução) —
   * por isso notifica de novo em warning (chamada 2), e 90%
   * escala para critical (chamada 3). O ponto do teste é o
   * cooldown ter sido limpo pelo resolve, não o número exato
   * de chamadas intermediárias.
   */
  assert.equal(notifier.calls.length, 3, "resolve deveria ter limpo o cooldown, permitindo novas notificações");
  assert.equal(notifier.calls[notifier.calls.length - 1].severity, "critical");
});

/* =========================================================
   34. OPENCODE NUNCA VIRA ALERTA DE QUOTA
========================================================= */

test("atividade do OpenCode nunca vira alerta de quota (capabilities.quota=false)", () => {
  const { deps, store } = alertDeps();
  const provider = fixtureProviderDescriptor("opencode");

  evaluateAndPersistAlerts(
    provider,
    fixtureOpencodeSnapshot({ sessions: 5, messages: 900 }),
    deps
  );

  evaluateAndPersistAlerts(
    provider,
    fixtureOpencodeSnapshot({ sessions: 5, messages: 5000 }),
    deps
  );

  const quotaAlerts = store.all().filter((alert) => alert.type === "quota");
  assert.equal(quotaAlerts.length, 0);
});

/* =========================================================
   35. OLLAMA MODEL-LOADED NUNCA VIRA WARNING/CRITICAL
========================================================= */

test("Ollama carregando/descarregando modelo nunca gera alerta warning/critical", () => {
  const { deps, store } = alertDeps();
  const provider = fixtureProviderDescriptor("ollama");

  const online = { id: "ollama", name: "Ollama", connected: true, status: "ok", modelsLoaded: 0 };
  const withModel = { id: "ollama", name: "Ollama", connected: true, status: "ok", modelsLoaded: 1 };

  evaluateAndPersistAlerts(provider, online, deps);
  evaluateAndPersistAlerts(provider, withModel, deps);
  evaluateAndPersistAlerts(provider, online, deps);

  assert.equal(store.all().length, 0, "carregar/descarregar modelo com status 'ok' nunca deveria gerar alerta");
});

/* =========================================================
   36. EVALUATE QUOTA USA O ID REAL DA JANELA (Claude)
========================================================= */

test("alerta de quota do Claude usa os ids reais das janelas (five_hour/seven_day), não nomes fixos", () => {
  const { deps, store } = alertDeps();
  const provider = fixtureProviderDescriptor("claude");

  evaluateAndPersistAlerts(provider, fixtureClaudeSnapshot(95), deps);

  assert.ok(store.getExisting("claude:quota:seven_day"), "esperava o id real 'seven_day', não 'secondary'");
});

/* =========================================================
   RUNNER
========================================================= */

async function main() {
  let passed = 0;
  let failed = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      passed += 1;
      console.log(`  ok  - ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL  - ${name}`);
      console.error(`        ${error.message}`);
    }
  }

  console.log("");
  console.log(`${passed} passaram, ${failed} falharam (${tests.length} no total)`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main();
