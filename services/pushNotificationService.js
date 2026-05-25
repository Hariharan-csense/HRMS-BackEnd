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

const deactivatePushToken = async (token) => {
  const trimmedToken = String(token || "").trim();
  if (!trimmedToken) return 0;
  const tokenHash = crypto.createHash("sha256").update(trimmedToken).digest("hex");

  return db("fcm_tokens")
    .where({ token_hash: tokenHash })
    .update({ active: false, updated_at: new Date() });
};

const sendPushToUsers = async ({ userIds, title, body, data = {} }) => {
  const messaging = getMessaging();
  const ids = [...new Set((userIds || []).map((id) => String(id)).filter(Boolean))];

  if (!messaging || !ids.length) {
    return { sent: 0, failed: 0, skipped: ids.length };
  }

  const rows = await db("fcm_tokens")
    .whereIn("user_id", ids)
    .andWhere({ active: true })
    .select("id", "token");

  const tokens = rows.map((row) => row.token).filter(Boolean);
  if (!tokens.length) {
    return { sent: 0, failed: 0, skipped: ids.length };
  }

  const tokenByValue = new Map(rows.map((row) => [row.token, row]));
  const summary = { sent: 0, failed: 0, skipped: 0, errors: [] };
  const invalidTokens = [];
  const stringData = Object.fromEntries(
    Object.entries(data || {}).map(([key, value]) => [key, String(value ?? "")]),
  );
  const webpushLink = /^https?:\/\//i.test(stringData.actionUrl || "")
    ? stringData.actionUrl
    : undefined;

  for (const tokenBatch of chunk(tokens, 500)) {
    // eslint-disable-next-line no-await-in-loop
    const response = await messaging.sendEachForMulticast({
      tokens: tokenBatch,
      notification: {
        title: String(title || "HRMS"),
        body: String(body || ""),
      },
      data: stringData,
      webpush: {
        fcmOptions: webpushLink
          ? {
              link: webpushLink,
            }
          : undefined,
      },
    });

    summary.sent += response.successCount || 0;
    summary.failed += response.failureCount || 0;

    response.responses.forEach((result, index) => {
      if (result.success) return;
      const code = result.error?.code || "";
      const message = result.error?.message || "";
      if (summary.errors.length < 5) {
        summary.errors.push({ code, message });
      }
      if (
        code.includes("registration-token-not-registered") ||
        code.includes("invalid-registration-token")
      ) {
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

  return summary;
};

module.exports = {
  registerPushToken,
  deactivatePushToken,
  sendPushToUsers,
};
