/*
 * OpenCode é um CLIENTE/ORQUESTRADOR — ele usa outros
 * providers (Codex, Claude, OpenAI direto, etc.), não tem
 * quota própria. Este adapter usa só subcomandos oficiais
 * não-interativos do próprio CLI:
 *
 *   opencode --version         -> versão
 *   opencode providers list    -> providers configurados
 *                                 (nome + tipo de fonte,
 *                                 NUNCA o valor da credencial)
 *   opencode stats --days 7    -> atividade (sessões/mensagens)
 *
 * "activity" aqui é a própria contagem do OpenCode — nunca é
 * somada ao consumo de Codex/Claude/etc. para evitar dupla
 * contagem (ver campo "note" no snapshot).
 */

const { exec } = require("child_process");
const { promisify } = require("util");

const execAsync = promisify(exec);

const TIMEOUT_MS = 5000;

const DOUBLE_COUNT_NOTE =
  "O consumo pertence aos providers utilizados pelo OpenCode e não é somado novamente pelo DevPulse.";

function stripAnsi(text) {
  return text.replace(
    /\x1B\[[0-9;]*[a-zA-Z]/g,
    ""
  );
}

/*
 * "commandSuffix" é sempre um literal fixo definido neste
 * arquivo (nunca input externo/usuário) — exec com string
 * estática, sem interpolação de dado externo.
 */
async function runOpencode(commandSuffix) {
  const { stdout } =
    await execAsync(
      `opencode ${commandSuffix}`,
      {
        timeout: TIMEOUT_MS,
        windowsHide: true
      }
    );

  return stripAnsi(stdout);
}

async function getVersion() {
  try {
    const output =
      await runOpencode("--version");

    return output.trim() || null;
  } catch {
    return null;
  }
}

function classifySource(sourceLabel) {
  return /^[A-Z][A-Z0-9_]*$/.test(
    sourceLabel
  )
    ? "environment"
    : "credential";
}

function parseConfiguredProviders(
  output
) {
  const providers = [];
  const lines = output.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(
      /●\s+(.+?)\s+(\S+)\s*$/
    );

    if (!match) {
      continue;
    }

    const name = match[1].trim();
    const sourceLabel = match[2].trim();

    providers.push({
      name,
      source:
        classifySource(sourceLabel)
    });
  }

  return providers;
}

async function getConfiguredProviders() {
  try {
    const output =
      await runOpencode(
        "providers list"
      );

    return parseConfiguredProviders(
      output
    );
  } catch {
    return [];
  }
}

function parseActivity(output) {
  const sessionsMatch =
    output.match(/Sessions\s+(\d+)/);

  const messagesMatch =
    output.match(/Messages\s+(\d+)/);

  if (!sessionsMatch && !messagesMatch) {
    return null;
  }

  return {
    sessions: sessionsMatch
      ? Number(sessionsMatch[1])
      : null,

    messages: messagesMatch
      ? Number(messagesMatch[1])
      : null,

    periodDays: 7
  };
}

async function getActivity() {
  try {
    const output =
      await runOpencode(
        "stats --days 7"
      );

    return parseActivity(output);
  } catch {
    return null;
  }
}

async function getOpencodeSnapshot() {
  const version = await getVersion();

  if (!version) {
    return {
      id: "opencode",
      name: "OpenCode",
      kind: "ai-client",

      connected: false,
      detected: false,
      status: "not-installed",

      note:
        "OpenCode não respondeu ao comando --version.",

      updatedAt: new Date().toISOString()
    };
  }

  const [
    configuredProviders,
    activity
  ] = await Promise.all([
    getConfiguredProviders(),
    getActivity()
  ]);

  return {
    id: "opencode",
    name: "OpenCode",
    kind: "ai-client",

    connected: true,
    detected: true,
    status: "ok",

    version,
    configuredProviders,
    activity,

    note: DOUBLE_COUNT_NOTE,

    updatedAt: new Date().toISOString()
  };
}

module.exports = {
  getOpencodeSnapshot
};
