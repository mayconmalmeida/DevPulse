const {
  recordActivity
} = require("../activity/tracker");

const {
  evaluateAndPersistAlerts
} = require("../alerts/engine");

/*
 * TTL padrão para providers que não declararem o próprio
 * (nenhum hoje deixa de declarar — este é só um piso de
 * segurança). Cada provider define seu `ttlMs` no registry
 * (ver src/providers/registry.js) com a justificativa ao
 * lado de cada valor.
 */
const DEFAULT_TTL_MS = 60 * 1000;

const state = new Map();

function getState(id) {
  if (!state.has(id)) {
    state.set(id, {
      snapshot: null,
      fetchedAt: 0,
      failures: 0,
      retryAfter: 0,

      /*
       * Single-flight: enquanto uma busca "ao vivo" está em
       * andamento para este provider, qualquer outra
       * chamada (com ou sem force) reaproveita a MESMA
       * promise em vez de disparar uma segunda busca
       * concorrente.
       */
      inFlight: null
    });
  }

  return state.get(id);
}

function calculateBackoff(failures) {
  const seconds = Math.min(
    15 * 60,
    30 * Math.pow(2, Math.max(0, failures - 1))
  );

  return seconds * 1000;
}

function getTtlMs(provider) {
  return typeof provider.ttlMs === "number" &&
    provider.ttlMs > 0
    ? provider.ttlMs
    : DEFAULT_TTL_MS;
}

/*
 * Busca "ao vivo" de verdade — chamada no máximo uma vez
 * por vez por provider (garantido pelo single-flight em
 * executeProvider). Atualiza o cache, roda o tracker de
 * atividade e nunca deixa uma exceção escapar sem antes
 * registrar o backoff.
 */
async function fetchLive(
  provider,
  runtime,
  now
) {
  const previousSnapshot =
    runtime.snapshot;

  try {
    const snapshot =
      await provider.getSnapshot();

    /*
     * Só grava atividade depois que a leitura teve sucesso
     * — comparando o que havia antes com o que chegou agora
     * (fatos observados, nunca fixtures).
     */
    recordActivity(
      provider,
      previousSnapshot,
      snapshot
    );

    /*
     * Alerts avaliados no mesmo ponto que activity — só em
     * leituras "ao vivo" de verdade, nunca por cache servido
     * de novo sem mudança (ver src/alerts/engine.js).
     */
    evaluateAndPersistAlerts(
      provider,
      snapshot
    );

    runtime.snapshot = snapshot;
    runtime.fetchedAt = now;
    runtime.failures = 0;
    runtime.retryAfter = 0;

    return {
      ...snapshot,

      runtime: {
        source: "live",
        cached: false,
        stale: false,
        fetchedAt: new Date(
          now
        ).toISOString()
      }
    };
  } catch (error) {
    runtime.failures += 1;

    runtime.retryAfter =
      now +
      calculateBackoff(
        runtime.failures
      );

    if (runtime.snapshot) {
      const staleSnapshot = {
        ...runtime.snapshot,
        status: "stale"
      };

      evaluateAndPersistAlerts(
        provider,
        staleSnapshot
      );

      return {
        ...staleSnapshot,

        runtime: {
          source: "cache",
          cached: true,
          stale: true,

          error: error.message,

          fetchedAt: new Date(
            runtime.fetchedAt
          ).toISOString(),

          retryAfter: new Date(
            runtime.retryAfter
          ).toISOString()
        }
      };
    }

    throw error;
  }
}

async function executeProvider(
  provider,
  { force = false } = {}
) {
  const runtime = getState(provider.id);
  const now = Date.now();
  const ttlMs = getTtlMs(provider);

  if (
    !force &&
    runtime.snapshot &&
    now - runtime.fetchedAt < ttlMs
  ) {
    return {
      ...runtime.snapshot,

      runtime: {
        source: "cache",
        cached: true,
        stale: false,
        fetchedAt: new Date(
          runtime.fetchedAt
        ).toISOString()
      }
    };
  }

  if (
    !force &&
    runtime.retryAfter > now
  ) {
    if (runtime.snapshot) {
      return {
        ...runtime.snapshot,

        status: "stale",

        runtime: {
          source: "cache",
          cached: true,
          stale: true,

          fetchedAt: new Date(
            runtime.fetchedAt
          ).toISOString(),

          retryAfter: new Date(
            runtime.retryAfter
          ).toISOString()
        }
      };
    }

    throw new Error(
      "PROVIDER_BACKOFF_ACTIVE"
    );
  }

  /*
   * Já existe uma busca em andamento para este provider?
   * Reaproveita — nunca dispara uma segunda chamada
   * concorrente ao mesmo adapter (evita, por exemplo, dois
   * `opencode stats` rodando ao mesmo tempo por dois
   * clientes pedindo refresh juntos).
   */
  if (runtime.inFlight) {
    return runtime.inFlight;
  }

  const inFlightPromise =
    fetchLive(provider, runtime, now).finally(
      () => {
        runtime.inFlight = null;
      }
    );

  runtime.inFlight = inFlightPromise;

  return inFlightPromise;
}

module.exports = {
  executeProvider
};
