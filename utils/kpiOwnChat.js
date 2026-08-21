const DEFAULT_COUNTRY_CODE = (process.env.OWNCHAT_DEFAULT_COUNTRY_CODE || "91")
  .replace(/\D/g, "")
  .trim() || "91";

const normalizeMobileNumber = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length === 10 ? `${DEFAULT_COUNTRY_CODE}${digits}` : digits;
};

const formatTargetDate = (value) => {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(date);
};

const getOwnChatConfig = () => {
  const apiUrl = String(process.env.OWNCHAT_API_URL || "").trim();
  const apiKey = String(process.env.OWNCHAT_API_KEY || "").trim();
  const apiSecret = String(process.env.OWNCHAT_API_SECRET || "").trim();
  const templateLanguage = String(process.env.OWNCHAT_TEMPLATE_LANGUAGE || "en_US").trim();
  const debug = String(process.env.OWNCHAT_DEBUG || "").trim() === "1";
  const correctiveActionTemplate = String(
    process.env.OWNCHAT_KPI_CORRECTIVE_ACTION_TEMPLATE ||
      "kpi_corrective_action",
  ).trim();
  const statusUpdateTemplate = String(
    process.env.OWNCHAT_KPI_STATUS_UPDATE_TEMPLATE ||
      "kpi_corrective_action_status_update",
  ).trim();
  return {
    apiUrl,
    apiKey,
    apiSecret,
    templateLanguage,
    debug,
    correctiveActionTemplate,
    statusUpdateTemplate,
  };
};

async function sendOwnChatTemplate({
  to,
  recipientName,
  templateName,
  parameters = [],
  buttonPayloads = [],
  urlButtonParameters = [],
  language,
  returnResponse = false,
}) {
  const { apiUrl, apiKey, apiSecret, templateLanguage, debug } =
    getOwnChatConfig();
  if (!apiUrl || !apiKey || !apiSecret) {
    console.warn("[OwnChat] skipped: missing API configuration");
    return returnResponse ? { sent: false, error: "missing_configuration" } : false;
  }

  const mobileNumber = normalizeMobileNumber(to);
  if (!mobileNumber) {
    console.warn("[OwnChat] skipped: invalid mobile number");
    return returnResponse ? { sent: false, error: "invalid_mobile" } : false;
  }

  const payload = {
    messaging_product: "whatsapp",
    to: mobileNumber,
    recipient_name: String(recipientName || "").trim() || "Employee",
    type: "template",
    template: {
      language: { policy: "deterministic", code: language || templateLanguage },
      name: templateName,
      components: [
        {
          type: "body",
          parameters: parameters.map((text) => ({ type: "text", text: String(text ?? "") })),
        },
        ...buttonPayloads.map((button, index) => ({
          type: "button",
          sub_type: "quick_reply",
          index: String(index),
          parameters: [
            {
              type: "payload",
              payload: String(button?.payload ?? button ?? ""),
            },
          ],
        })),
        ...urlButtonParameters.map((value, index) => ({
          type: "button",
          sub_type: "url",
          index: String(index),
          parameters: [
            {
              type: "text",
              text: String(value ?? ""),
            },
          ],
        })),
      ],
    },
  };

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "OWNCHAT-API-KEY": apiKey,
        "OWNCHAT-API-SECRET": apiSecret,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      console.warn(
        `[OwnChat] template=${templateName} http=${response.status} body=${body}`,
      );
      return returnResponse
        ? { sent: false, error: `http_${response.status}`, responseBody: body }
        : false;
    }
    if (debug) {
      console.log(`[OwnChat] sent template=${templateName} to=${mobileNumber}`);
    }
    if (!returnResponse) return true;
    const body = await response.json().catch(() => ({}));
    return { sent: true, messageId: body?.messages?.[0]?.id || body?.message_id || body?.id || null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[OwnChat] template=${templateName} failed: ${message}`);
    return returnResponse ? { sent: false, error: message } : false;
  }
}

async function sendKpiCorrectiveActionNotification({
  recipientName,
  mobileNumber,
  kpiName,
  correctiveAction,
  targetDate,
}) {
  const { correctiveActionTemplate } = getOwnChatConfig();
  return sendOwnChatTemplate({
    to: mobileNumber,
    recipientName,
    templateName: correctiveActionTemplate,
    parameters: [
      recipientName,
      kpiName,
      correctiveAction,
      formatTargetDate(targetDate),
    ],
  });
}

async function sendKpiCorrectiveActionStatusUpdateNotification({
  recipientName,
  mobileNumber,
  kpiName,
  assignedToName,
  correctiveAction,
  status,
  targetDate,
}) {
  const { correctiveActionTemplate, statusUpdateTemplate } = getOwnChatConfig();
  const sent = await sendOwnChatTemplate({
    to: mobileNumber,
    recipientName,
    templateName: statusUpdateTemplate,
    parameters: [
      recipientName,
      kpiName,
      assignedToName,
      correctiveAction,
      status,
      formatTargetDate(targetDate),
    ],
  });
  if (sent || statusUpdateTemplate === correctiveActionTemplate) return sent;

  console.warn(
    `[OwnChat] status template failed; retrying template=${correctiveActionTemplate}`,
  );
  return sendOwnChatTemplate({
    to: mobileNumber,
    recipientName,
    templateName: correctiveActionTemplate,
    parameters: [
      recipientName,
      kpiName,
      `${correctiveAction} - Status: ${status}`,
      formatTargetDate(targetDate),
    ],
  });
}

module.exports = {
  normalizeMobileNumber,
  sendOwnChatTemplate,
  sendKpiCorrectiveActionNotification,
  sendKpiCorrectiveActionStatusUpdateNotification,
};

