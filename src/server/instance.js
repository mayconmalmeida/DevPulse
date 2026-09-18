const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/*
 * Identidade estável por instalação (v0.13.1).
 *
 * Cada cópia física do DevPulse (cada pasta onde o projeto foi
 * clonado/extraído) recebe um identificador opaco e aleatório,
 * gerado no primeiro uso e persistido em data/instance-id.
 *
 * Este id NUNCA contém path, username, hostname ou credencial —
 * é apenas um UUID aleatório. Ele existe para que o launcher
 * (DevPulse.bat) consiga distinguir "a porta 4173 responde como
 * ESTA instalação" de "a porta 4173 responde como DevPulse, mas
 * de OUTRA instalação" (ver pulse-handshake.ps1).
 *
 * data/instance-id é local/runtime e está no .gitignore — um
 * clone ou ZIP novo nunca herda o id de outra cópia.
 */

const DATA_DIR = path.resolve(
  __dirname,
  "../../data"
);

const INSTANCE_ID_FILE = path.join(
  DATA_DIR,
  "instance-id"
);

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(
      DATA_DIR,
      {
        recursive: true
      }
    );
  }
}

function readExistingInstanceId() {
  try {
    const raw = fs.readFileSync(
      INSTANCE_ID_FILE,
      "utf8"
    ).trim();

    return raw || null;
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function getInstanceId() {
  ensureDataDir();

  const existing = readExistingInstanceId();

  if (existing) {
    return existing;
  }

  const generated = crypto.randomUUID();

  fs.writeFileSync(
    INSTANCE_ID_FILE,
    generated,
    "utf8"
  );

  return generated;
}

module.exports = {
  getInstanceId,
  INSTANCE_ID_FILE
};
