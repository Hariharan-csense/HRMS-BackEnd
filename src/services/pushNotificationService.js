const db = require("../db/db");
const crypto = require("crypto");
const { getMessaging } = require("./firebaseAdmin");

const chunk = (items, size) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const registerPushToken = async ({
  userId,
  companyId,
  token,
  platform = "web",
  userAgent = "",
}) => {
  const trimmedToken = String(token || "").trim();
  if (!trimmedToken) {
    throw new Error("FCM token is required");
  }

  const tokenHash = crypto.createHash("sha256").update(trimmedToken).digest("hex");
  const existing = await db("fcm_tokens").where({ token_hash: tokenHash }).first();
  const payload = {
    user_id: String(userId),
    company_id: companyId || null,
    platform: String(platform || "web").slice(0, 32),
    user_agent: String(userAgent || "").slice(0, 512),
    active: true,
    updated_at: new Date(),
  };

  if (existing) {
    await db("fcm_tokens").where({ id: existing.id }).update(payload);
    return existing.id;
  }

  const [id] = await db("fcm_tokens").insert({
    ...payload,
    token: trimmedToken,
    token_hash: tokenHash,
    created_at: new Date(),
  });

  return id;
};

const classifyFcmError = (code = "", message = "") => {
  const combined = `${code} ${message}`.toLowerCase();
  if (combined.includes("cloudmessaging.messages.create")) {
    return "fcm_api_permission_denied";
  }
  if (code.includes("mismatched-credential")) {
    return "fcm_credential_mismatch";
  }
  if (
    code.includes("registration-token-not-registered") ||
    code.includes("invalid-registration-token")
  ) {
    return "invalid_fcm_token";
  }
  return null;
};

const deactivatePushToken = async (token) => {
  const trimmedToken = String(token || "").trim();
  if (!trimmedToken) return 0;
  const tokenHash = crypto.createHash("sha256").update(trimmedToken).digest("hex");

  return db("fcm_tokens")
    .where({ token_hash: tokenHash })
    .update({ active: false, updated_at: new Date() });
};

const sendPushToUsers = async ({ userIds, companyId, title, body, data = {} }) => {
  const messaging = getMessaging();
  const ids = [...new Set((userIds || []).map((id) => String(id)).filter(Boolean))];

  if (!messaging) {
    return {
      sent: 0,
      failed: 0,
      skipped: ids.length,
      skipReasons: ["firebase_not_configured"],
    };
  }

  const tokenQuery = db("fcm_tokens")
    .whereIn("user_id", ids)
    .andWhere({ active: true });

  if (companyId !== undefined && companyId !== null && companyId !== "") {
    tokenQuery.andWhere("company_id", companyId);
  }

  const rows = await tokenQuery.select("id", "user_id", "token");

  const tokens = rows.map((row) => row.token).filter(Boolean);
  if (!tokens.length) {
    const missingTokenUserIds = ids.filter(
      (id) => !rows.some((row) => String(row.user_id) === String(id)),
    );
    return {
      sent: 0,
      failed: 0,
      skipped: ids.length,
      skipReasons:
        missingTokenUserIds.length > 0 ? ["no_active_fcm_token"] : [],
    };
  }

  const tokenByValue = new Map(rows.map((row) => [row.token, row]));
  const summary = { sent: 0, failed: 0, skipped: 0, errors: [], skipReasons: [] };
  const invalidTokens = [];
  const skipReasons = new Set();
  const stringData = Object.fromEntries(
    Object.entries(data || {}).map(([key, value]) => [key, String(value ?? "")]),
  );
  const pushTitle = String(title || "HRMS");
  const pushBody = String(body || "");
  const pushData = {
    ...stringData,
    title: pushTitle,
    body: pushBody,
  };
  const rawActionUrl = String(stringData.actionUrl || "").trim();
  const frontendBase = String(process.env.FRONTEND_URL || "http://localhost:8080").replace(
    /\/$/,
    "",
  );
  const webpushLink = rawActionUrl
    ? /^https?:\/\//i.test(rawActionUrl)
      ? rawActionUrl
      : `${frontendBase}${rawActionUrl.startsWith("/") ? rawActionUrl : `/${rawActionUrl}`}`
    : frontendBase;

  for (const tokenBatch of chunk(tokens, 500)) {
    // Web: use webpush.notification (not top-level notification) so the service worker
    // reliably displays OS notifications in both foreground and background.
    // eslint-disable-next-line no-await-in-loop
    const response = await messaging.sendEachForMulticast({
      tokens: tokenBatch,
      data: pushData,
      webpush: {
        headers: {
          Urgency: "high",
        },
        notification: {
          title: pushTitle,
          body: pushBody,
          icon: `${frontendBase}/placeholder.svg`,
        },
        fcmOptions: {
          link: webpushLink,
        },
      },
    });

    summary.sent += response.successCount || 0;
    summary.failed += response.failureCount || 0;

    response.responses.forEach((result, index) => {
      if (result.success) return;
      const code = result.error?.code || "";
      const message = result.error?.message || "";
      const reason = classifyFcmError(code, message);
      if (reason) skipReasons.add(reason);
      if (summary.errors.length < 5) {
        summary.errors.push({ code, message, reason });
      }
      if (reason === "invalid_fcm_token") {
        const token = tokenBatch[index];
        const row = tokenByValue.get(token);
        if (row?.id) invalidTokens.push(row.id);
      }
    });
  }

  if (invalidTokens.length) {
    await db("fcm_tokens")
      .whereIn("id", invalidTokens)
      .update({ active: false, updated_at: new Date() });
  }

  summary.skipReasons = [...skipReasons];
  return summary;
};

module.exports = {
  registerPushToken,
  deactivatePushToken,
  sendPushToUsers,
};
