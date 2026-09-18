/*
 * Gemini CLI (@google/gemini-cli).
 *
 * IMPORTANTE (achado da auditoria v0.10.0): a antiga
 * detecção baseada só em "~/.gemini existe" é um falso
 * positivo comum — outros produtos Google (ex.: Antigravity)
 * também usam essa pasta para os próprios dados, sem
 * relação nenhuma com o Gemini CLI. Este adapter procura
 * marcadores específicos do Gemini CLI de verdade:
 *
 *   - binário "gemini" (--version funcionando)
 *   - ~/.gemini/settings.json (config real do Gemini CLI)
 *   - ~/.gemini/oauth_creds.json (indica autenticado —
 *     só a EXISTÊNCIA é checada, nunca o conteúdo)
 *
 * Nenhuma API local oficial de quota/uso foi confirmada
 * para o Gemini CLI nesta auditoria — por isso este adapter
 * nunca retorna percentual. Se isso mudar no futuro (ou em
 * outra instalação), normalizar aqui sem inventar dado.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");
const { promisify } = require("util");

const execAsync = promisify(exec);

const HOME = os.homedir();
const TIMEOUT_MS = 3000;

function exists(target) {
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
}

async function tryVersion() {
  /*
   * "gemini" é um nome de comando fixo (nunca vem de input
   * externo) — exec com string estática, sem interpolação.
   */
  try {
    const { stdout } =
      await execAsync(
        "gemini --version",
        {
          timeout: TIMEOUT_MS,
          windowsHide: true
        }
      );

    const version = stdout.trim();

    return version || null;
  } catch {
    return null;
  }
}

async function getGeminiSnapshot() {
  const settingsPath = path.join(
    HOME,
    ".gemini",
    "settings.json"
  );

  const oauthCredsPath = path.join(
    HOME,
    ".gemini",
    "oauth_creds.json"
  );

  const hasSettings = exists(settingsPath);

  const version = await tryVersion();

  const installed =
    Boolean(version) || hasSettings;

  if (!installed) {
    return {
      id: "gemini",
      name: "Gemini",
      kind: "cloud-provider",

      connected: false,
      detected: false,
      status: "not-installed",

      version: null,
      authenticated: null,

      note:
        "Gemini CLI não detectado neste sistema. Uma pasta ~/.gemini pode existir sem ser o Gemini CLI — outros produtos Google (ex.: Antigravity) reaproveitam esse nome de diretório.",

      updatedAt: new Date().toISOString()
    };
  }

  const authenticated = exists(
    oauthCredsPath
  );

  return {
    id: "gemini",
    name: "Gemini",
    kind: "cloud-provider",

    connected: false,
    detected: true,
    status: "detected",

    version,
    authenticated,

    note:
      "Nenhum endpoint local oficial de quota/uso foi confirmado para o Gemini CLI nesta auditoria — percentual não é exibido para evitar dado inventado.",

    updatedAt: new Date().toISOString()
  };
}

module.exports = {
  getGeminiSnapshot
};
