/*
 * Cursor — nesta auditoria (v0.10.0) não há instalação
 * detectável nesta máquina, e nenhuma API local oficial de
 * uso/quota foi confirmada para o Cursor (o dashboard de
 * uso vive no lado do serviço, atrás de login). Por isso
 * este adapter NUNCA tenta autenticar, ler sessão do editor
 * ou contornar proteção nenhuma — só detecta instalação e,
 * se possível, lê a versão de um product.json local (padrão
 * comum a editores da família VS Code).
 *
 * Se não houver instalação real para validar, o adapter
 * ainda assim precisa lidar com esse caminho com segurança
 * — daí o try/catch defensivo em cada leitura.
 */

const fs = require("fs");
const path = require("path");

function exists(target) {
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
}

function readJsonSafe(target) {
  try {
    return JSON.parse(
      fs.readFileSync(target, "utf8")
    );
  } catch {
    return null;
  }
}

function findCursorInstallDir() {
  const candidates = [];

  if (process.env.LOCALAPPDATA) {
    candidates.push(
      path.join(
        process.env.LOCALAPPDATA,
        "Programs",
        "cursor"
      )
    );
  }

  if (process.env.APPDATA) {
    candidates.push(
      path.join(
        process.env.APPDATA,
        "Cursor"
      )
    );
  }

  return (
    candidates.find(exists) || null
  );
}

function readCursorVersion(installDir) {
  const candidates = [
    path.join(
      installDir,
      "resources",
      "app",
      "product.json"
    ),

    path.join(
      installDir,
      "product.json"
    )
  ];

  for (const candidate of candidates) {
    const data =
      readJsonSafe(candidate);

    if (data?.version) {
      return data.version;
    }
  }

  return null;
}

async function getCursorSnapshot() {
  const installDir =
    findCursorInstallDir();

  if (!installDir) {
    return {
      id: "cursor",
      name: "Cursor",
      kind: "ai-client",

      connected: false,
      detected: false,
      status: "not-installed",

      note:
        "Cursor não foi encontrado nos diretórios de instalação padrão.",

      updatedAt: new Date().toISOString()
    };
  }

  const version =
    readCursorVersion(installDir);

  return {
    id: "cursor",
    name: "Cursor",
    kind: "ai-client",

    connected: false,
    detected: true,
    status: "detected",

    version,

    note:
      "Nenhuma API local oficial de uso/quota foi confirmada para o Cursor — percentual não é exibido para evitar dado inventado.",

    updatedAt: new Date().toISOString()
  };
}

module.exports = {
  getCursorSnapshot
};
