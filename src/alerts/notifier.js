/*
 * Dispara a notificação nativa do Windows via
 * pulse-notify.ps1 (ver arquivo na raiz do projeto).
 *
 * Fire-and-forget por design: uma notificação nunca deve
 * atrasar nem quebrar uma resposta HTTP do DevPulse — os
 * erros são só logados, nunca propagados.
 */

const path = require("path");
const { spawn } = require("child_process");

const PROJECT_DIR = path.resolve(
  __dirname,
  "../.."
);

const NOTIFY_SCRIPT = path.join(
  PROJECT_DIR,
  "pulse-notify.ps1"
);

function severityToIcon(severity) {
  if (severity === "critical") {
    return "Error";
  }

  if (severity === "warning") {
    return "Warning";
  }

  return "Info";
}

/*
 * `alert` já é o registro sanitizado do store — title/
 * message são strings curtas já pensadas para exibição,
 * nunca dados brutos de provider.
 */
function sendWindowsNotification(alert) {
  try {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        NOTIFY_SCRIPT,
        "-Title",
        `DevPulse · ${alert.title}`,
        "-Message",
        alert.message,
        "-Icon",
        severityToIcon(alert.severity)
      ],
      {
        cwd: PROJECT_DIR,
        windowsHide: true,
        detached: true,
        stdio: "ignore"
      }
    );

    child.unref();
  } catch (error) {
    console.error(
      "[DevPulse Alerts] Falha ao disparar notificação do Windows:",
      error.message
    );
  }
}

module.exports = {
  sendWindowsNotification
};
