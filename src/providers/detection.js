const fs = require("fs");
const path = require("path");
const os = require("os");

const HOME = os.homedir();

function exists(...parts) {
  try {
    return fs.existsSync(
      path.join(...parts)
    );
  } catch {
    return false;
  }
}

function safeSource(label) {
  return label;
}

function detectCodex() {
  const authExists = exists(
    HOME,
    ".codex",
    "auth.json"
  );

  const directoryExists = exists(
    HOME,
    ".codex"
  );

  return {
    id: "codex",
    name: "Codex",
    category: "cloud",
    installed:
      directoryExists ||
      authExists,
    authenticated:
      authExists,
    monitoring: authExists
      ? "available"
      : "unavailable",
    source: safeSource(
      "~/.codex"
    ),
    description:
      "OpenAI Codex",
    capabilities: [
      "Limite 5 h",
      "Limite semanal",
      "Plano",
      "Histórico de tokens"
    ]
  };
}

function detectClaude() {
  const directoryExists = exists(
    HOME,
    ".claude"
  );

  const credentialsExists = exists(
    HOME,
    ".claude",
    ".credentials.json"
  );

  return {
    id: "claude",
    name: "Claude",
    category: "cloud",
    installed:
      directoryExists ||
      credentialsExists,
    authenticated:
      credentialsExists,
    monitoring:
      credentialsExists
        ? "available"
        : "unavailable",
    source: safeSource(
      "~/.claude"
    ),
    description:
      "Anthropic Claude Code",
    capabilities: [
      "Limite 5 h",
      "Limite semanal",
      "Breakdown semanal",
      "Extra usage"
    ]
  };
}

async function detectOllama() {
  let running = false;
  let models = [];

  try {
    const response =
      await fetch(
        "http://127.0.0.1:11434/api/tags",
        {
          signal:
            AbortSignal.timeout(
              1500
            )
        }
      );

    if (response.ok) {
      running = true;

      const data =
        await response.json();

      models =
        Array.isArray(
          data.models
        )
          ? data.models.map(
              (model) => ({
                name:
                  model.name ||
                  model.model ||
                  "Modelo local",

                size:
                  model.size ||
                  null,

                modifiedAt:
                  model.modified_at ||
                  null
              })
            )
          : [];
    }
  } catch {
    running = false;
  }

  const possibleInstall =
    exists(
      process.env.LOCALAPPDATA || "",
      "Programs",
      "Ollama"
    );

  return {
    id: "ollama",
    name: "Ollama",
    category: "local",
    installed:
      possibleInstall ||
      running,
    authenticated: null,
    monitoring:
      running
        ? "local"
        : "unavailable",
    running,
    source:
      "127.0.0.1:11434",
    description:
      "Runtime local de modelos",
    capabilities: [
      "Status local",
      "Modelos instalados"
    ],
    models
  };
}

function detectOpenCode() {
  const npmPath =
    process.env.APPDATA
      ? exists(
          process.env.APPDATA,
          "npm",
          "opencode.ps1"
        )
      : false;

  const configPaths = [
    path.join(
      HOME,
      ".config",
      "opencode"
    ),

    path.join(
      HOME,
      ".opencode"
    )
  ];

  const configExists =
    configPaths.some(
      (item) => {
        try {
          return fs.existsSync(item);
        } catch {
          return false;
        }
      }
    );

  return {
    id: "opencode",
    name: "OpenCode",
    category: "client",
    installed:
      npmPath ||
      configExists,
    authenticated: null,
    monitoring: "adapter_pending",
    source:
      npmPath
        ? "npm global"
        : configExists
          ? "config local"
          : null,
    description:
      "Cliente/orquestrador de modelos",
    capabilities: [
      "Detecção local"
    ],
    note:
      "O consumo pertence aos providers utilizados pelo OpenCode e não deve ser contado duas vezes."
  };
}

function detectGemini() {
  const candidates = [
    path.join(
      HOME,
      ".gemini"
    ),

    process.env.APPDATA
      ? path.join(
          process.env.APPDATA,
          "npm",
          "gemini.ps1"
        )
      : null
  ].filter(Boolean);

  const installed =
    candidates.some(
      (item) => {
        try {
          return fs.existsSync(item);
        } catch {
          return false;
        }
      }
    );

  return {
    id: "gemini",
    name: "Gemini",
    category: "cloud",
    installed,
    authenticated: null,
    monitoring:
      installed
        ? "adapter_pending"
        : "unavailable",
    source:
      installed
        ? "instalação local detectada"
        : null,
    description:
      "Google Gemini",
    capabilities:
      installed
        ? ["Detecção local"]
        : []
  };
}

function detectCursor() {
  const candidates = [
    process.env.LOCALAPPDATA
      ? path.join(
          process.env.LOCALAPPDATA,
          "Programs",
          "cursor"
        )
      : null,

    process.env.APPDATA
      ? path.join(
          process.env.APPDATA,
          "Cursor"
        )
      : null
  ].filter(Boolean);

  const installed =
    candidates.some(
      (item) => {
        try {
          return fs.existsSync(item);
        } catch {
          return false;
        }
      }
    );

  return {
    id: "cursor",
    name: "Cursor",
    category: "client",
    installed,
    authenticated: null,
    monitoring:
      installed
        ? "adapter_pending"
        : "unavailable",
    source:
      installed
        ? "instalação local detectada"
        : null,
    description:
      "Editor com recursos de IA",
    capabilities:
      installed
        ? ["Detecção local"]
        : []
  };
}

async function detectProviders() {
  const results =
    await Promise.all([
      Promise.resolve(
        detectCodex()
      ),

      Promise.resolve(
        detectClaude()
      ),

      detectOllama(),

      Promise.resolve(
        detectOpenCode()
      ),

      Promise.resolve(
        detectGemini()
      ),

      Promise.resolve(
        detectCursor()
      )
    ]);

  return results;
}

module.exports = {
  detectProviders
};