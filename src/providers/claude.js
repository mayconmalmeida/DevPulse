const fs = require("fs");
const path = require("path");
const os = require("os");

const CREDENTIALS_PATH = path.join(
  os.homedir(),
  ".claude",
  ".credentials.json"
);

const USAGE_URL =
  "https://api.anthropic.com/api/oauth/usage";

function loadCredential() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error("CLAUDE_NOT_AUTHENTICATED");
  }

  let credentials;

  try {
    credentials = JSON.parse(
      fs.readFileSync(CREDENTIALS_PATH, "utf8")
    );
  } catch {
    throw new Error("CLAUDE_CREDENTIALS_INVALID");
  }

  const accessToken =
    credentials?.claudeAiOauth?.accessToken;

  if (!accessToken) {
    throw new Error("CLAUDE_CREDENTIALS_INVALID");
  }

  return {
    accessToken
  };
}

async function requestUsage(credential) {
  const response = await fetch(USAGE_URL, {
    method: "GET",

    headers: {
      Authorization: `Bearer ${credential.accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
      "User-Agent": "claude-code/2.1.270",
      Accept: "application/json"
    },

    signal: AbortSignal.timeout(15000)
  });

  if (response.status === 401 ||
      response.status === 403) {
    throw new Error("CLAUDE_AUTH_REQUIRED");
  }

  if (response.status === 429) {
    throw new Error("CLAUDE_RATE_LIMITED");
  }

  if (!response.ok) {
    throw new Error(
      `CLAUDE_HTTP_${response.status}`
    );
  }

  return response.json();
}

function normalizeWindow(id, label, value) {
  if (!value ||
      typeof value.utilization !== "number") {
    return null;
  }

  const used = value.utilization;

  return {
    id,
    label,

    usedPercent: used,

    remainingPercent:
      Math.max(0, 100 - used),

    resetsAt:
      value.resets_at || null,

    lockedReason:
      value.locked_reason || null
  };
}

function normalizeBreakdown(data) {
  const rows =
    data?.seven_day_breakdown?.rows;

  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map((row) => ({
    id: row.key,
    name: row.display_name,
    percent: row.percent
  }));
}

function normalizeExtraUsage(data) {
  const extra = data?.extra_usage;

  if (!extra) {
    return null;
  }

  const divisor =
    10 ** (extra.decimal_places ?? 2);

  return {
    enabled: Boolean(extra.is_enabled),

    currency:
      extra.currency || null,

    limit:
      typeof extra.monthly_limit === "number"
        ? extra.monthly_limit / divisor
        : null,

    used:
      typeof extra.used_credits === "number"
        ? extra.used_credits / divisor
        : null,

    usedPercent:
      typeof extra.utilization === "number"
        ? extra.utilization
        : null,

    disabledReason:
      extra.disabled_reason || null,

    userDisabled:
      Boolean(extra.user_disabled),

    spendLimitReached:
      Boolean(extra.spend_limit_reached)
  };
}

async function getClaudeSnapshot() {
  const credential = loadCredential();

  const usage =
    await requestUsage(credential);

  return {
    id: "claude",
    name: "Claude",

    fidelity: "official",

    installed: true,
    authenticated: true,
    connected: true,

    status: "ok",

    windows: {
      primary: normalizeWindow(
        "five_hour",
        "5 h",
        usage.five_hour
      ),

      secondary: normalizeWindow(
        "seven_day",
        "Semanal",
        usage.seven_day
      )
    },

    breakdown:
      normalizeBreakdown(usage),

    extraUsage:
      normalizeExtraUsage(usage),

    memberDashboardAvailable:
      Boolean(
        usage.member_dashboard_available
      ),

    updatedAt:
      new Date().toISOString()
  };
}

module.exports = {
  getClaudeSnapshot
};