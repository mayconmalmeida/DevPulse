const {
  getCodexSnapshot
} = require("./codex");

const {
  getClaudeSnapshot
} = require("./claude");

const {
  getOllamaSnapshot
} = require("./ollama");

const {
  getGeminiSnapshot
} = require("./gemini");

const {
  getOpencodeSnapshot
} = require("./opencode");

const {
  getCursorSnapshot
} = require("./cursor");

const {
  executeProvider
} = require("./runtime");

const {
  evaluateAndPersistAlerts
} = require("../alerts/engine");

/*
 * "kind" classifica o tipo de provider para o frontend
 * decidir como renderizar o detail (ver v0.10.0):
 *
 *   cloud-provider -> usage/quota (Codex, Claude, Gemini)
 *   local-runtime  -> status/versão/modelos (Ollama)
 *   ai-client      -> status/versão/providers/sessões
 *                     (OpenCode, Cursor)
 *
 * "capabilities" (v0.11.0) substitui a heurística antiga
 * `provider.connected && provider.windows` por sinais
 * explícitos do que cada provider é CAPAZ de fornecer:
 *
 *   quota    -> tem janela de uso com percentual real
 *               (primary/secondary), elegível a virar
 *               série de quota no histórico.
 *   history  -> a quota desse provider deve ser persistida
 *               em data/history.jsonl. Só faz sentido
 *               quando quota=true (Codex/Claude).
 *   runtime  -> conceito de runtime local online/offline
 *               com versão (Ollama).
 *   models   -> pode listar modelos instalados/carregados
 *               (Ollama).
 *   activity -> participa da Activity Timeline (v0.11.0):
 *               o tracker observa mudanças reais (quota,
 *               online/offline, modelo carregado, stats,
 *               transição de status) e só grava evento
 *               quando algo realmente mudou. Verdadeiro
 *               para todos — a ausência de mudança real
 *               simplesmente não gera evento nenhum.
 *
 * Ambos são só o valor-padrão aqui — se o próprio snapshot
 * do adapter já definir "kind"/"capabilities", o dele
 * prevalece (nenhum adapter faz isso hoje; é uma saída para
 * o futuro sem precisar mexer no registry de novo).
 */
const providers = [
  {
    id: "codex",
    name: "Codex",
    kind: "cloud-provider",
    capabilities: {
      quota: true,
      history: true,
      runtime: false,
      models: false,
      activity: true
    },
    ttlMs: 60 * 1000,
    getSnapshot: getCodexSnapshot
  },

  {
    id: "claude",
    name: "Claude",
    kind: "cloud-provider",
    capabilities: {
      quota: true,
      history: true,
      runtime: false,
      models: false,
      activity: true
    },
    ttlMs: 60 * 1000,
    getSnapshot: getClaudeSnapshot
  },

  {
    id: "ollama",
    name: "Ollama",
    kind: "local-runtime",
    capabilities: {
      quota: false,
      history: false,
      runtime: true,
      models: true,
      activity: true
    },
    /*
     * Runtime local: uma checagem HTTP em 127.0.0.1 é
     * barata e o estado (online, modelo carregado) é o
     * mais "vivo" de todos — TTL curto para o dock/detail
     * não ficarem defasados.
     */
    ttlMs: 20 * 1000,
    getSnapshot: getOllamaSnapshot
  },

  {
    id: "gemini",
    name: "Gemini",
    kind: "cloud-provider",
    capabilities: {
      quota: false,
      history: false,
      runtime: false,
      models: false,
      activity: true
    },
    /*
     * Não instalado nesta máquina e sem quota nenhuma —
     * não há necessidade de rechecar com a mesma frequência
     * de um provider com dado ao vivo.
     */
    ttlMs: 5 * 60 * 1000,
    getSnapshot: getGeminiSnapshot
  },

  {
    id: "opencode",
    name: "OpenCode",
    kind: "ai-client",
    capabilities: {
      quota: false,
      history: false,
      runtime: false,
      models: false,
      activity: true
    },
    /*
     * Cada leitura chama 3 subcomandos de CLI (~1-4s) — as
     * estatísticas de 7 dias não mudam segundo a segundo,
     * então um TTL maior reduz custo sem perder relevância.
     */
    ttlMs: 3 * 60 * 1000,
    getSnapshot: getOpencodeSnapshot
  },

  {
    id: "cursor",
    name: "Cursor",
    kind: "ai-client",
    capabilities: {
      quota: false,
      history: false,
      runtime: false,
      models: false,
      activity: true
    },
    ttlMs: 5 * 60 * 1000,
    getSnapshot: getCursorSnapshot
  }
];

async function getProviderSnapshot(
  id,
  options = {}
) {
  const provider =
    providers.find(
      (item) => item.id === id
    );

  if (!provider) {
    throw new Error(
      "PROVIDER_NOT_FOUND"
    );
  }

  const snapshot =
    await executeProvider(
      provider,
      options
    );

  return withProviderMeta(
    provider,
    snapshot
  );
}

/*
 * Só preenche "kind"/"capabilities" quando o próprio
 * snapshot do adapter não definiu o dele — nunca
 * sobrescreve um valor que o adapter já retornou.
 */
function withProviderMeta(
  provider,
  snapshot
) {
  return {
    kind: provider.kind,
    capabilities: provider.capabilities,
    ...snapshot
  };
}

async function getAllProviderSnapshots(
  options = {}
) {
  const results =
    await Promise.allSettled(
      providers.map(
        (provider) =>
          executeProvider(
            provider,
            options
          )
      )
    );

  return results.map(
    (result, index) => {
      const provider =
        providers[index];

      if (
        result.status ===
        "fulfilled"
      ) {
        return withProviderMeta(
          provider,
          result.value
        );
      }

      const errorSnapshot = {
        id: provider.id,
        name: provider.name,
        kind: provider.kind,
        capabilities:
          provider.capabilities,

        connected: false,
        status: "error",

        error:
          result.reason?.message ||
          "UNKNOWN_ERROR",

        updatedAt:
          new Date().toISOString()
      };

      /*
       * Único caso em que `runtime.js` nunca chega a avaliar
       * alerts: primeira falha de um provider sem NENHUM
       * cache anterior (executeProvider rejeita em vez de
       * devolver stale). Avalia aqui para que um provider
       * "morto" desde o primeiro fetch ainda gere o alerta de
       * saúde esperado.
       */
      evaluateAndPersistAlerts(
        provider,
        errorSnapshot
      );

      return errorSnapshot;
    }
  );
}

function listProviders() {
  return providers.map(
    ({ id, name }) => ({
      id,
      name
    })
  );
}

module.exports = {
  getProviderSnapshot,
  getAllProviderSnapshots,
  listProviders
};