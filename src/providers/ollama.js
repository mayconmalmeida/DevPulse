/*
 * Ollama é um runtime local — não existe conceito de quota
 * aqui. Este adapter só reporta o que a própria API local
 * oficial do Ollama (127.0.0.1:11434) expõe:
 *
 *   GET /api/version  -> versão instalada
 *   GET /api/tags     -> modelos instalados
 *   GET /api/ps       -> modelos atualmente carregados
 *
 * Nenhum percentual/limite é inventado. Se o serviço não
 * estiver rodando, o snapshot reflete isso — não lança
 * erro, "offline" é um estado normal para um runtime local.
 */

const fs = require("fs");
const path = require("path");

const BASE_URL = "http://127.0.0.1:11434";
const REQUEST_TIMEOUT_MS = 2500;

/*
 * Usado só para diferenciar "não instalado" de "instalado,
 * mas o serviço não está rodando agora" — dois estados bem
 * diferentes (ver v0.10.1). Uma pasta de instalação ausente
 * não prova rigorosamente que o Ollama não existe (pode
 * estar noutro local), mas é o mesmo sinal já usado pelo
 * detection.js — aqui só para melhorar a mensagem, nunca
 * para decidir se mostramos ou não o provider.
 */
function looksInstalled() {
  const localAppData = process.env.LOCALAPPDATA;

  if (!localAppData) {
    return false;
  }

  try {
    return fs.existsSync(
      path.join(
        localAppData,
        "Programs",
        "Ollama"
      )
    );
  } catch {
    return false;
  }
}

async function requestJson(endpoint) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`OLLAMA_HTTP_${response.status}`);
  }

  return response.json();
}

function normalizeInstalledModel(model) {
  return {
    name: model?.name || model?.model || null,
    size:
      typeof model?.size === "number"
        ? model.size
        : null,
    modifiedAt: model?.modified_at || null,
    family: model?.details?.family || null,
    parameterSize:
      model?.details?.parameter_size || null,
    quantization:
      model?.details?.quantization_level || null
  };
}

function normalizeLoadedModel(model) {
  return {
    name: model?.name || model?.model || null,
    size:
      typeof model?.size === "number"
        ? model.size
        : null,
    expiresAt: model?.expires_at || null
  };
}

async function getOllamaSnapshot() {
  let version = null;

  try {
    const versionData =
      await requestJson("/api/version");

    version = versionData?.version || null;
  } catch {
    /*
     * Se /api/version não responde, o serviço realmente
     * não está no ar agora — estado normal, não é erro.
     * Diferenciamos "instalado mas parado" (offline) de
     * "não instalado" (not-installed) — são estados
     * semanticamente diferentes (v0.10.1).
     */
    const installed = looksInstalled();

    return {
      id: "ollama",
      name: "Ollama",
      kind: "local-runtime",

      connected: false,
      detected: installed,
      status: installed
        ? "offline"
        : "not-installed",

      online: false,
      version: null,

      updatedAt: new Date().toISOString()
    };
  }

  const [tagsResult, psResult] =
    await Promise.allSettled([
      requestJson("/api/tags"),
      requestJson("/api/ps")
    ]);

  const installedModels =
    tagsResult.status === "fulfilled" &&
    Array.isArray(tagsResult.value?.models)
      ? tagsResult.value.models.map(
          normalizeInstalledModel
        )
      : [];

  const loadedModels =
    psResult.status === "fulfilled" &&
    Array.isArray(psResult.value?.models)
      ? psResult.value.models.map(
          normalizeLoadedModel
        )
      : [];

  return {
    id: "ollama",
    name: "Ollama",
    kind: "local-runtime",

    connected: true,
    detected: true,
    status: "ok",

    online: true,
    version,

    modelsInstalled: installedModels.length,
    modelsLoaded: loadedModels.length,
    models: installedModels,
    loadedModels,

    updatedAt: new Date().toISOString()
  };
}

module.exports = {
  getOllamaSnapshot
};
