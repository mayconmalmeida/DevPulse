const fs = require("fs");
const path = require("path");
const os = require("os");

const AUTH_PATH = path.join(os.homedir(), ".codex", "auth.json");
const BASE_URL = "https://chatgpt.com/backend-api";

function loadCredential() {
  if (!fs.existsSync(AUTH_PATH)) {
    throw new Error("CODEX_NOT_AUTHENTICATED");
  }

  let auth;

  try {
    auth = JSON.parse(fs.readFileSync(AUTH_PATH, "utf8"));
  } catch {
    throw new Error("CODEX_AUTH_INVALID");
  }

  const accessToken = auth?.tokens?.access_token;
  const accountID = auth?.tokens?.account_id;

  if (!accessToken || !accountID) {
    throw new Error("CODEX_AUTH_INVALID");
  }

  return { accessToken, accountID };
}

function headers(credential, beta = false) {
  const result = {
    Authorization: `Bearer ${credential.accessToken}`,
    "ChatGPT-Account-Id": credential.accountID,
    Accept: "application/json",
    "Cache-Control": "no-cache, no-store"
  };

  if (beta) {
    result["OpenAI-Beta"] = "codex-1";
  }

  return result;
}

async function request(endpoint, credential, beta = false) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: "GET",
    headers: headers(credential, beta),
    signal: AbortSignal.timeout(15000)
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("CODEX_AUTH_REQUIRED");
  }

  if (response.status === 429) {
    throw new Error("CODEX_RATE_LIMITED");
  }

  if (!response.ok) {
    throw new Error(`CODEX_HTTP_${response.status}`);
  }

  return response.json();
}

function normalizeWindow(id, window) {
  if (!window || typeof window.used_percent !== "number") {
    return null;
  }

  let resetsAt = null;

  if (typeof window.reset_at === "number") {
    resetsAt = new Date(window.reset_at * 1000).toISOString();
  } else if (typeof window.reset_after_seconds === "number") {
    resetsAt = new Date(
      Date.now() + window.reset_after_seconds * 1000
    ).toISOString();
  }

  return {
    id,
    label: windowLabel(window.limit_window_seconds, id),
    usedPercent: window.used_percent,
    remainingPercent: Math.max(0, 100 - window.used_percent),
    durationSeconds: window.limit_window_seconds ?? null,
    resetsAt
  };
}

function windowLabel(seconds, fallback) {
  if (!seconds || seconds <= 0) {
    return fallback === "primary"
      ? "Sessão atual"
      : "Janela ampliada";
  }

  const minutes = seconds / 60;

  if (minutes < 60) {
    return `${Math.round(minutes)} min`;
  }

  if (minutes < 1440) {
    return `${Math.round(minutes / 60)} h`;
  }

  const days = Math.round(minutes / 1440);

  if (days === 7) return "Semanal";
  if (days === 30) return "Mensal";

  return `${days} dias`;
}

function normalizeUsage(data) {
  const rateLimit = data?.rate_limit ?? {};

  return {
    plan: data?.plan_type ?? null,
    primary: normalizeWindow(
      "primary",
      rateLimit.primary_window
    ),
    secondary: normalizeWindow(
      "secondary",
      rateLimit.secondary_window
    )
  };
}

function normalizeProfile(data) {
  const stats = data?.stats;

  if (!stats) return null;

  return {
    lifetimeTokens: stats.lifetime_tokens ?? null,
    peakDailyTokens: stats.peak_daily_tokens ?? null,
    longestRunningTurnSeconds:
      stats.longest_running_turn_sec ?? null,
    currentStreakDays: stats.current_streak_days ?? null,
    longestStreakDays: stats.longest_streak_days ?? null,
    dailyUsage: Array.isArray(stats.daily_usage_buckets)
      ? stats.daily_usage_buckets
      : []
  };
}

async function getCodexSnapshot() {
  const credential = loadCredential();

  const usage = await request(
    "/wham/usage",
    credential
  );

  const [profileResult, creditsResult] =
    await Promise.allSettled([
      request("/wham/profiles/me", credential),
      request(
        "/wham/rate-limit-reset-credits",
        credential,
        true
      )
    ]);

  const normalized = normalizeUsage(usage);

  return {
    id: "codex",
    name: "Codex",
    connected: true,
    status: "ok",
    plan: normalized.plan,
    windows: {
      primary: normalized.primary,
      secondary: normalized.secondary
    },
    tokenUsage:
      profileResult.status === "fulfilled"
        ? normalizeProfile(profileResult.value)
        : null,
    resetCredits:
      creditsResult.status === "fulfilled"
        ? {
            available:
              creditsResult.value?.available_count ?? 0
          }
        : null,
    updatedAt: new Date().toISOString()
  };
}

module.exports = {
  getCodexSnapshot
};
