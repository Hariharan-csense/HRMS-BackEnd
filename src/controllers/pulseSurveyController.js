const db = require("../db/db");
const { transporter } = require("../utils/mailer");
const { sendPushToUsers } = require("../services/pushNotificationService");
const {
  normalizeMobileNumber,
  sendOwnChatTemplate,
} = require("../utils/kpiOwnChat");
const { getDateKey } = require("../utils/dateTime");

const requireAuthType = (req, res) => {
  if (!req.user) {
    res.status(403).json({ message: "Access denied" });
    return false;
  }
  // Route-level RBAC (requirePermission) is the source of truth.
  return true;
};

const clampScore = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, n));
};

const parseList = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
};

const isNumeric = (value) => {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  return /^\d+$/.test(value.trim());
};

const buildRecipientsQuery = async ({
  companyId,
  recipientType,
  selectedEmployeeIds,
  selectedDepartment,
  selectedDesignation,
}) => {
  const query = db("employees")
    .select(
      "employees.id",
      "employees.first_name",
      "employees.last_name",
      "employees.email",
      "employees.mobile as phone",
    )
    .where("employees.company_id", companyId);

  if (recipientType === "employee" && selectedEmployeeIds.length > 0) {
    const ids = selectedEmployeeIds.filter(isNumeric).map((x) => Number(x));
    if (ids.length > 0) {
      query.whereIn("employees.id", ids);
    }
    return query;
  }

  if (recipientType === "department" && selectedDepartment.length > 0) {
    const ids = selectedDepartment.filter(isNumeric).map((x) => Number(x));
    const names = selectedDepartment
      .filter((x) => !isNumeric(x))
      .map((x) => String(x).trim())
      .filter(Boolean);

    if (ids.length > 0) {
      query.whereIn("employees.department_id", ids);
      return query;
    }

    if (names.length > 0) {
      query
        .join("departments", "employees.department_id", "departments.id")
        .whereIn("departments.name", names);
      return query;
    }

    return query.whereRaw("1=0");
  }

  if (recipientType === "designation" && selectedDesignation.length > 0) {
    const ids = selectedDesignation.filter(isNumeric).map((x) => Number(x));
    const names = selectedDesignation
      .filter((x) => !isNumeric(x))
      .map((x) => String(x).trim())
      .filter(Boolean);

    if (ids.length > 0) {
      query.whereIn("employees.designation_id", ids);
      return query;
    }

    if (names.length > 0) {
      query
        .join("designations", "employees.designation_id", "designations.id")
        .whereIn("designations.name", names);
      return query;
    }

    return query.whereRaw("1=0");
  }

  return query;
};

const getEmployeeName = (employee) =>
  `${employee.first_name || ""} ${employee.last_name || ""}`.trim() ||
  employee.email ||
  "Employee";

const parseJson = (value, fallback = []) => {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const normalizeWhatsappButtons = (value) => {
  const rows = parseJson(value, []);
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => {
      if (typeof row === "string") {
        return { id: String(index + 1), label: row, score: index + 1 };
      }
      return {
        id: String(row?.id || row?.value || index + 1),
        label: String(row?.label || row?.title || row?.text || row?.value || index + 1).trim(),
        score: Number(row?.score || row?.value || index + 1),
      };
    })
    .filter((row) => row.label)
    .slice(0, 3);
};

const renderPulseTemplateText = (text, values) =>
  String(text || "").replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_m, key) =>
    String(values[key] ?? ""),
  );

const detectPulseTemplateLanguage = (template, title, message) => {
  const pulseLanguage = String(
    process.env.OWNCHAT_PULSE_SURVEY_LANGUAGE ||
      process.env.OWNCHAT_SURVEY_LANGUAGE ||
      "",
  ).trim();
  if (pulseLanguage) return pulseLanguage;

  const configured = String(template?.whatsapp_language || "").trim();
  if (configured) return configured;
  const text = `${template?.title || title || ""} ${template?.message || message || ""}`;
  return /[\u0B80-\u0BFF]/.test(text) ? "ta" : "en_US";
};

const getPulseTemplateParameters = (text, values) => {
  const matches = [...String(text || "").matchAll(/{{\s*([a-zA-Z0-9_]+)\s*}}/g)];
  const uniqueKeys = matches.map((match) => match[1]);
  if (!uniqueKeys.length) {
    return [values.employee_name, values.survey_title, values.question];
  }
  return uniqueKeys.map((key) => values[key] ?? "");
};

const parseButtonScore = (value, options) => {
  const raw = String(value || "").trim();
  const payloadMatch = raw.match(/^pulse:(\d+):(\d+)$/);
  const optionIndex = payloadMatch ? Number(payloadMatch[2]) : null;
  if (optionIndex && options[optionIndex - 1]) return options[optionIndex - 1];

  const byIdOrLabel = options.find(
    (option) =>
      String(option.id).toLowerCase() === raw.toLowerCase() ||
      String(option.label).toLowerCase() === raw.toLowerCase(),
  );
  if (byIdOrLabel) return byIdOrLabel;

  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return { score: numeric, label: raw };

  const numericTokens = raw
    .match(/\b10\b|\b[1-9]\b/g)
    ?.map((token) => Number(token))
    .filter((score) => score >= 1 && score <= 10);
  if (numericTokens?.length) {
    const score = numericTokens[numericTokens.length - 1];
    return { score, label: String(score) };
  }

  return null;
};

const getPulseSurveyTemplateForSend = async ({ companyId, templateId }) => {
  if (!templateId) return null;
  return db("pulse_survey_templates")
    .where({ id: Number(templateId), company_id: companyId, is_active: 1 })
    .first();
};

const sendPulseSurveyWhatsApp = async ({
  companyId,
  surveyId,
  template,
  recipients,
  title,
  message,
}) => {
  const summary = { sent: 0, failed: 0, skipped: 0, errors: [] };
  const ownChatTemplateName = String(
    process.env.OWNCHAT_PULSE_SURVEY_TEMPLATE ||
      process.env.OWNCHAT_SURVEY_TEMPLATE ||
      template?.whatsapp_template_name ||
      "pulse_survey",
  ).trim();
  if (!ownChatTemplateName) {
    summary.errors.push({ reason: "missing_pulse_survey_template" });
    return summary;
  }

  const buttons = normalizeWhatsappButtons(template.whatsapp_buttons);
  const fallbackButtons = buttons.length
    ? buttons
    : [
        { id: "1", label: "1", score: 1 },
        { id: "5", label: "5", score: 5 },
        { id: "10", label: "10", score: 10 },
      ];
  const question = String(message || template.message || title || "").slice(0, 1000);

  for (const employee of recipients) {
    const employeeName = getEmployeeName(employee);
    const mobile = normalizeMobileNumber(employee.phone);
    const now = new Date();

    if (!mobile) {
      summary.skipped += 1;
      await db("pulse_survey_whatsapp_messages")
        .insert({
          company_id: companyId,
          survey_id: surveyId,
          employee_id: employee.id,
          template_id: template.id,
          status: "failed",
          question,
          button_options: JSON.stringify(fallbackButtons),
          created_at: now,
          updated_at: now,
        })
        .onConflict(["survey_id", "employee_id"])
        .merge({ status: "failed", updated_at: now });
      continue;
    }

    const [mappingId] = await db("pulse_survey_whatsapp_messages")
      .insert({
        company_id: companyId,
        survey_id: surveyId,
        employee_id: employee.id,
        template_id: template.id,
        status: "pending",
        question,
        button_options: JSON.stringify(fallbackButtons),
        created_at: now,
        updated_at: now,
      })
      .onConflict(["survey_id", "employee_id"])
      .merge({
        template_id: template.id,
        status: "pending",
        question,
        button_options: JSON.stringify(fallbackButtons),
        response_message_id: null,
        responded_at: null,
        updated_at: now,
      });

    const mapping =
      mappingId ||
      (
        await db("pulse_survey_whatsapp_messages")
          .where({
            company_id: companyId,
            survey_id: surveyId,
            employee_id: employee.id,
          })
          .first("id")
      )?.id;

    // Body {{1}} is the employee name and {{2}} must always come from the
    // survey currently being created. Do not fall back to the saved HRMS
    // template text, otherwise a custom title/message can be replaced by the
    // template's default happiness question.
    const whatsappQuestion = [title, message]
      .map((value) => String(value || "").trim())
      .filter((value, index, list) => value && list.indexOf(value) === index)
      .join(" - ")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/ {2,}/g, " ")
      .trim();
    const parameters = [employeeName, whatsappQuestion];

    // eslint-disable-next-line no-await-in-loop
    const language = detectPulseTemplateLanguage(template, title, message);
    const result = await sendOwnChatTemplate({
      to: mobile,
      recipientName: employeeName,
      templateName: ownChatTemplateName,
      language,
      parameters,
      returnResponse: true,
    });

    const status = result?.sent ? "sent" : "failed";
    if (result?.sent) summary.sent += 1;
    else {
      summary.failed += 1;
      summary.errors.push({
        employeeId: employee.id,
        mobile,
        templateName: ownChatTemplateName,
        language,
        reason: result?.error || "send_failed",
        responseBody: result?.responseBody || null,
      });
    }

    await db("pulse_survey_whatsapp_messages")
      .where({ id: mapping })
      .update({
        ownchat_message_id: result?.messageId || null,
        status,
        updated_at: new Date(),
      });
  }

  return summary;
};

const flattenWebhookMessages = (payload) => {
  const messages = [];
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;
    if (
      value.id ||
      value.message_id ||
      value.from ||
      value.interactive ||
      value.button ||
      value.text
    ) {
      messages.push(value);
    }
    for (const key of [
      "messages",
      "message",
      "data",
      "entry",
      "changes",
      "value",
      "statuses",
      "events",
    ]) {
      if (value[key]) visit(value[key]);
    }
  };
  visit(payload);
  return messages;
};

const getWebhookReply = (message) => {
  const interactive = message?.interactive || {};
  const buttonReply = interactive.button_reply || message?.button || {};
  const listReply = interactive.list_reply || {};
  const text =
    message?.text?.body ||
    message?.text?.message ||
    message?.body ||
    message?.message?.text ||
    (typeof message?.message === "string" ? message.message : "") ||
    message?.reply ||
    message?.content ||
    "";
  return {
    responseId:
      message?.id ||
      message?.message_id ||
      message?.wamid ||
      message?.event_id ||
      null,
    contextId:
      message?.context?.id ||
      message?.context?.message_id ||
      message?.context?.wamid ||
      message?.reply_to_message_id ||
      message?.quoted_message_id ||
      message?.quoted?.id ||
      message?.ownchat_context_id ||
      null,
    from:
      message?.from ||
      message?.wa_id ||
      message?.sender ||
      message?.sender_id ||
      message?.senderId ||
      message?.mobile ||
      message?.phone ||
      message?.phone_number ||
      message?.contact_number ||
      message?.customer_phone ||
      message?.customer?.phone ||
      message?.contact?.phone ||
      "",
    replyValue:
      buttonReply?.id ||
      buttonReply?.payload ||
      buttonReply?.title ||
      listReply?.id ||
      listReply?.title ||
      text,
    replyLabel:
      buttonReply?.title || listReply?.title || text || buttonReply?.id || "",
  };
};

const findWhatsappMapping = async ({ contextId, from, replyValue }) => {
  const payloadMatch = String(replyValue || "").match(/^pulse:(\d+):(\d+)$/);
  if (payloadMatch) {
    const row = await db("pulse_survey_whatsapp_messages")
      .where({ id: Number(payloadMatch[1]) })
      .first();
    if (row) return row;
  }

  if (contextId) {
    const row = await db("pulse_survey_whatsapp_messages")
      .where({ ownchat_message_id: contextId })
      .first();
    if (row) return row;
  }

  const normalizedFrom = normalizeMobileNumber(from);
  if (!normalizedFrom) return null;

  const candidates = await db("pulse_survey_whatsapp_messages as wm")
    .join("employees as e", "e.id", "wm.employee_id")
    .whereIn("wm.status", ["sent", "pending"])
    .orderBy("wm.created_at", "desc")
    .limit(20)
    .select("wm.*", "e.mobile as phone");

  const matches = candidates.filter(
    (row) => normalizeMobileNumber(row.phone) === normalizedFrom,
  );
  return matches[0] || null;
};

const handleOwnChatWebhook = async (req, res) => {
  try {
    const messages = flattenWebhookMessages(req.body);
    if (!messages.length) return res.json({ accepted: true, processed: 0 });

    let processed = 0;
    let ignored = 0;
    for (const rawMessage of messages) {
      const reply = getWebhookReply(rawMessage);
      if (!reply.replyValue) {
        ignored += 1;
        continue;
      }

      const mapping = await findWhatsappMapping(reply);
      if (!mapping || mapping.status === "responded") {
        ignored += 1;
        if (!mapping) {
          console.warn("Pulse OwnChat webhook ignored: no mapping found", {
            from: reply.from ? normalizeMobileNumber(reply.from) : null,
            contextId: reply.contextId || null,
            responseId: reply.responseId || null,
            replyValue: String(reply.replyValue || "").slice(0, 80),
          });
        }
        continue;
      }

      if (reply.responseId) {
        const duplicate = await db("pulse_survey_whatsapp_messages")
          .where({ response_message_id: reply.responseId })
          .first("id");
        if (duplicate) continue;
      }

      const options = normalizeWhatsappButtons(mapping.button_options);
      const answer = parseButtonScore(reply.replyValue, options) ||
        parseButtonScore(reply.replyLabel, options);
      const numericScore = clampScore(answer?.score);
      if (numericScore < 1 || numericScore > 10) {
        ignored += 1;
        continue;
      }

      const now = new Date();
      const responsePayload = {
        survey_id: mapping.survey_id,
        employee_id: mapping.employee_id,
        company_id: mapping.company_id,
        score: numericScore,
        label: String(answer?.label || reply.replyLabel || reply.replyValue).slice(0, 64),
        comment: null,
        is_anonymous: false,
        responded_at: now,
        updated_at: now,
      };

      const existing = await db("pulse_survey_responses")
        .where({
          company_id: mapping.company_id,
          survey_id: mapping.survey_id,
          employee_id: mapping.employee_id,
        })
        .first();
      if (existing) {
        await db("pulse_survey_whatsapp_messages")
          .where({ id: mapping.id })
          .update({
            status: "responded",
            response_message_id: reply.responseId || null,
            responded_at: now,
            updated_at: now,
          });
        continue;
      }

      await db("pulse_survey_responses").insert({
        ...responsePayload,
        created_at: now,
      });
      await db("pulse_survey_whatsapp_messages")
        .where({ id: mapping.id })
        .update({
          status: "responded",
          response_message_id: reply.responseId || null,
          responded_at: now,
          updated_at: now,
        });
      processed += 1;
    }

    return res.json({ accepted: true, processed, ignored });
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.json({ accepted: true, duplicate: true });
    }
    console.error("handleOwnChatWebhook error:", error);
    return res.status(500).json({ message: "Webhook processing failed" });
  }
};

const getSurveyEmployeeId = (user) => {
  const mappedEmployeeId = Number(user?.employee_id || 0);
  if (mappedEmployeeId) return mappedEmployeeId;
  return String(user?.type || "").toLowerCase() === "employee"
    ? Number(user?.id || 0)
    : 0;
};

const getLocalDateKey = (value = new Date()) => {
  return getDateKey(value) || getDateKey();
};

const getPulseSurveyCategory = (survey) => {
  const title = String(survey?.title || "").trim().toLowerCase();
  return title.startsWith("daily log -") ? "daily_log" : "survey";
};

const getFrontendBaseUrl = () =>
  String(process.env.FRONTEND_URL || process.env.BASE_URL || "https://hrms.procease.co")
    .replace(/\/backend\/?$/, "")
    .replace(/\/+$/, "");

const buildSurveyUrl = (surveyId) => {
  return `${getFrontendBaseUrl()}/pulse-surveys/respond/${surveyId}`;
};

const buildSurveyPushPath = (surveyId) => `/pulse-surveys/respond/${surveyId}`;

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const sendSurveyEmail = async ({ employee, surveyId, title, message }) => {
  const email = String(employee.email || "").trim();
  if (!email) {
    return { skipped: true, reason: "missing_email" };
  }

  const employeeName = getEmployeeName(employee);
  const surveyUrl = buildSurveyUrl(surveyId);
  const safeTitle = String(title).trim();
  const safeMessage = String(message || "").trim();
  const htmlEmployeeName = escapeHtml(employeeName);
  const htmlTitle = escapeHtml(safeTitle);
  const htmlMessage = escapeHtml(safeMessage).replace(/\n/g, "<br>");
  const htmlSurveyUrl = escapeHtml(surveyUrl);

  await transporter.sendMail({
    from: `"HRMS System" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
    to: email,
    subject: `New Pulse Survey: ${safeTitle}`,
    text: [
      `Hi ${employeeName},`,
      "",
      "A new pulse survey has been assigned to you.",
      "",
      `Survey: ${safeTitle}`,
      safeMessage ? `Message: ${safeMessage}` : "",
      `Open HRMS: ${surveyUrl}`,
      "",
      "Please submit your response in HRMS.",
    ]
      .filter(Boolean)
      .join("\n"),
    html: `
      <div style="font-family:Segoe UI,Arial,sans-serif;line-height:1.5;color:#111827;">
        <p>Hi ${htmlEmployeeName},</p>
        <p>A new pulse survey has been assigned to you.</p>
        <h2 style="font-size:18px;margin:16px 0 8px;">${htmlTitle}</h2>
        ${safeMessage ? `<p>${htmlMessage}</p>` : ""}
        <p>
          <a href="${htmlSurveyUrl}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;">
            Open HRMS
          </a>
        </p>
        <p style="font-size:12px;color:#6b7280;">This is a system-generated email from HRMS.</p>
      </div>
    `,
  });

  return { sent: true };
};

const sendSurveyEmails = async ({ recipients, surveyId, title, message }) => {
  const summary = { sent: 0, skipped: 0, failed: 0 };
  const concurrency = 10;

  for (let i = 0; i < recipients.length; i += concurrency) {
    const batch = recipients.slice(i, i + concurrency);
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.allSettled(
      batch.map((employee) =>
        sendSurveyEmail({ employee, surveyId, title, message }),
      ),
    );

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        if (result.value?.skipped) summary.skipped += 1;
        else summary.sent += 1;
        return;
      }

      summary.failed += 1;
      console.error("Pulse survey email failed:", {
        surveyId,
        employeeId: batch[index]?.id,
        email: batch[index]?.email,
        error: result.reason?.message || result.reason,
      });
    });
  }

  return summary;
};

const createSurveyNotifications = async ({
  recipients,
  surveyId,
  title,
  message,
  companyId,
}) => {
  if (!recipients.length) return 0;

  const now = new Date();
  const actionUrl = `/pulse-surveys/respond/${surveyId}`;
  const rows = recipients.map((employee) => ({
    user_id: String(employee.id),
    company_id: companyId,
    title: "New Pulse Survey",
    description: String(
      message || title || "Please complete your new survey.",
    ).slice(0, 1000),
    type: "info",
    module_id: "pulse_surveys",
    action_url: actionUrl,
    read: false,
    created_at: now,
  }));

  const chunkSize = 500;
  let created = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    // eslint-disable-next-line no-await-in-loop
    await db("notifications").insert(rows.slice(i, i + chunkSize));
    created += rows.slice(i, i + chunkSize).length;
  }

  console.log("Pulse survey notifications created:", {
    surveyId,
    companyId,
    created,
  });

  return created;
};

// Admin: create and send
const createPulseSurvey = async (req, res) => {
  if (!requireAuthType(req, res, "admin")) return;

  const {
    title,
    message,
    recipientType = "all",
    selectedEmployeeIds,
    selectedDepartment,
    selectedDesignation,
    allowAnonymous = false,
    templateId,
    sendViaWhatsApp = false,
  } = req.body || {};

  const companyId = req.user.company_id;
  const createdByUserId = req.user.id;

  if (!companyId)
    return res.status(400).json({ message: "Missing company_id" });
  if (!title || !String(title).trim()) {
    return res.status(400).json({ message: "Title is required" });
  }

  const empList = parseList(selectedEmployeeIds);
  const deptList = parseList(selectedDepartment);
  const desigList = parseList(selectedDesignation);

  try {
    const recipientsQuery = await buildRecipientsQuery({
      companyId,
      recipientType,
      selectedEmployeeIds: empList,
      selectedDepartment: deptList,
      selectedDesignation: desigList,
    });

    const recipients = await recipientsQuery;
    if (!recipients.length) {
      return res.status(400).json({ message: "No recipients found" });
    }

    const pulseTemplate = await getPulseSurveyTemplateForSend({
      companyId,
      templateId,
    });
    if (sendViaWhatsApp && !pulseTemplate) {
      return res
        .status(400)
        .json({ message: "Select an active Pulse Survey template to send WhatsApp" });
    }

    const [surveyId] = await db("pulse_surveys").insert({
      company_id: companyId,
      created_by_user_id: createdByUserId,
      pulse_template_id: pulseTemplate?.id || null,
      title: String(title).trim(),
      message: message ? String(message) : null,
      recipient_type: recipientType,
      allow_anonymous: Boolean(allowAnonymous),
      status: "sent",
      total_sent: recipients.length,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const rows = recipients.map((r) => ({
      survey_id: surveyId,
      employee_id: r.id,
      company_id: companyId,
      sent_at: new Date(),
    }));

    // Insert in chunks to avoid max packet issues
    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      // eslint-disable-next-line no-await-in-loop
      await db("pulse_survey_recipients").insert(rows.slice(i, i + chunkSize));
    }

    let notificationsCreated = 0;
    let emailSummary = { sent: 0, skipped: 0, failed: 0 };
    let whatsappSummary = { sent: 0, skipped: 0, failed: 0 };

    try {
      notificationsCreated = await createSurveyNotifications({
        recipients,
        surveyId,
        title,
        message,
        companyId,
      });
    } catch (notificationError) {
      console.error("Pulse survey notification create failed:", {
        surveyId,
        error: notificationError?.message || notificationError,
      });
    }

    const pushSummaryPromise = sendPushToUsers({
      userIds: recipients.map((employee) => employee.id),
      companyId,
      title: "New Pulse Survey",
      body: String(
        message || title || "Please complete your new survey.",
      ).slice(0, 1000),
      data: {
        surveyId,
        moduleId: "pulse_surveys",
        actionUrl: buildSurveyPushPath(surveyId),
      },
    }).catch((pushError) => {
      console.error("Pulse survey push failed:", {
        surveyId,
        error: pushError?.message || pushError,
      });
      return { sent: 0, failed: 0, skipped: recipients.length };
    });

    try {
      emailSummary = await sendSurveyEmails({
        recipients,
        surveyId,
        title,
        message,
      });
    } catch (emailError) {
      console.error("Pulse survey email dispatch failed:", {
        surveyId,
        error: emailError?.message || emailError,
      });
    }

    if (sendViaWhatsApp) {
      try {
        whatsappSummary = await sendPulseSurveyWhatsApp({
          companyId,
          surveyId,
          template: pulseTemplate,
          recipients,
          title: String(title).trim(),
          message: message ? String(message) : "",
        });
      } catch (whatsappError) {
        console.error("Pulse survey WhatsApp dispatch failed:", {
          surveyId,
          error: whatsappError?.message || whatsappError,
        });
      }
    }

    const pushSummary = await pushSummaryPromise;
    const pushSkipReasons = [
      ...(Array.isArray(pushSummary?.skipReasons)
        ? pushSummary.skipReasons
        : []),
      ...(Array.isArray(pushSummary?.errors)
        ? pushSummary.errors.map((entry) => entry?.reason).filter(Boolean)
        : []),
    ].filter((reason, index, list) => list.indexOf(reason) === index);

    return res.status(201).json({
      id: surveyId,
      title: String(title).trim(),
      message: message ? String(message) : "",
      recipientType,
      allowAnonymous: Boolean(allowAnonymous),
      totalSent: recipients.length,
      notificationsCreated,
      push: {
        ...pushSummary,
        skipReasons: pushSkipReasons,
      },
      emails: emailSummary,
      whatsapp: whatsappSummary,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("createPulseSurvey error:", error);
    return res.status(500).json({ message: "Failed to create survey" });
  }
};

// Admin: list surveys with counts
const getAdminPulseSurveys = async (req, res) => {
  if (!requireAuthType(req, res, "admin")) return;

  const companyId = req.user.company_id;
  try {
    const surveys = await db("pulse_surveys as s")
      .leftJoin("pulse_survey_responses as r", "s.id", "r.survey_id")
      .where("s.company_id", companyId)
      .groupBy("s.id")
      .orderBy("s.created_at", "desc")
      .select(
        "s.*",
        db.raw("COUNT(r.id) as responseCount"),
        db.raw("AVG(r.score) as avgScore"),
      );

    return res.json(
      surveys.map((s) => ({
        id: s.id,
        title: s.title,
        message: s.message || "",
        recipientType: s.recipient_type,
        allowAnonymous: Boolean(s.allow_anonymous),
        status: s.status,
        totalSent: s.total_sent,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        responseCount: Number(s.responseCount || 0),
        avgScore: s.avgScore === null ? 0 : Number(s.avgScore),
        category: getPulseSurveyCategory(s),
      })),
    );
  } catch (error) {
    console.error("getAdminPulseSurveys error:", error);
    return res.status(500).json({ message: "Failed to fetch surveys" });
  }
};

// Admin: get one survey (with counts)
const getAdminPulseSurveyById = async (req, res) => {
  if (!requireAuthType(req, res, "admin")) return;

  const companyId = req.user.company_id;
  const { id } = req.params;

  try {
    const rows = await db("pulse_surveys as s")
      .leftJoin("pulse_survey_responses as r", "s.id", "r.survey_id")
      .where("s.company_id", companyId)
      .andWhere("s.id", Number(id))
      .groupBy("s.id")
      .select(
        "s.*",
        db.raw("COUNT(r.id) as responseCount"),
        db.raw("AVG(r.score) as avgScore"),
      );

    const s = rows[0];
    if (!s) return res.status(404).json({ message: "Survey not found" });

    return res.json({
      id: s.id,
      title: s.title,
      message: s.message || "",
      recipientType: s.recipient_type,
      allowAnonymous: Boolean(s.allow_anonymous),
      status: s.status,
      totalSent: s.total_sent,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      responseCount: Number(s.responseCount || 0),
      avgScore: s.avgScore === null ? 0 : Number(s.avgScore),
    });
  } catch (error) {
    console.error("getAdminPulseSurveyById error:", error);
    return res.status(500).json({ message: "Failed to fetch survey" });
  }
};

// Admin: overview KPIs + trends
const getAdminPulseOverview = async (req, res) => {
  if (!requireAuthType(req, res, "admin")) return;

  const companyId = req.user.company_id;

  try {
    const [{ totalEmployees }] = await db("employees")
      .where("company_id", companyId)
      .count({ totalEmployees: "*" });

    const responses = await db("pulse_survey_responses")
      .where("company_id", companyId)
      .select("score", "responded_at");

    const scores = responses.map((r) => clampScore(r.score));
    const avgHappiness = scores.length
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;

    const latest = responses
      .slice()
      .sort((a, b) =>
        String(b.responded_at).localeCompare(String(a.responded_at)),
      )[0];
    const avgScoreTrend = latest ? clampScore(latest.score) : 0;

    const [{ departments }] = await db("employees")
      .where("company_id", companyId)
      .whereNotNull("department_id")
      .countDistinct({ departments: "department_id" });

    const byGender = await db("employees as e")
      .leftJoin("pulse_survey_responses as r", "e.id", "r.employee_id")
      .where("e.company_id", companyId)
      .groupBy("e.gender")
      .select(
        "e.gender as gender",
        db.raw("COUNT(DISTINCT e.id) as employees"),
        db.raw("AVG(r.score) as avgScore"),
      );

    const normalizeGender = (g) => String(g || "").toLowerCase();
    const maleRow = byGender.find((x) => normalizeGender(x.gender) === "male");
    const femaleRow = byGender.find(
      (x) => normalizeGender(x.gender) === "female",
    );

    const deptDetails = await db("departments as d")
      .leftJoin("employees as e", "e.department_id", "d.id")
      .leftJoin("pulse_survey_responses as r", "r.employee_id", "e.id")
      .where("e.company_id", companyId)
      .groupBy("d.id")
      .select(
        "d.name as name",
        db.raw("COUNT(DISTINCT e.id) as employees"),
        db.raw("AVG(r.score) as avgScore"),
      )
      .orderBy("d.name", "asc");

    const branchDetails = await db("employees as e")
      .join("branches as b", "e.branch_id", "b.id")
      .leftJoin("pulse_survey_responses as r", function () {
        this.on("r.employee_id", "=", "e.id").andOn(
          "r.company_id",
          "=",
          "e.company_id",
        );
      })
      .where("e.company_id", companyId)
      .whereNotNull("e.branch_id")
      .groupBy("b.id", "b.name")
      .select(
        "b.name as name",
        db.raw("COUNT(DISTINCT e.id) as employees"),
        db.raw("AVG(r.score) as avgScore"),
      )
      .orderBy("name", "asc");

    const toPoint = (label, score) => ({ label, score: Number(score || 0) });

    // Trend buckets computed in JS (last N)
    const byDay = new Map();
    const byWeek = new Map();
    const byMonth = new Map();
    for (const r of responses) {
      const d = new Date(r.responded_at);
      const score = clampScore(r.score);

      const dayKey = d.toISOString().slice(0, 10);
      const dayLabel = d.toLocaleDateString(undefined, { weekday: "short" });
      const dayPrev = byDay.get(dayKey) || {
        label: dayLabel,
        sum: 0,
        count: 0,
      };
      byDay.set(dayKey, {
        label: dayPrev.label,
        sum: dayPrev.sum + score,
        count: dayPrev.count + 1,
      });

      const year = d.getFullYear();
      const first = new Date(Date.UTC(year, 0, 1));
      const days = Math.floor(
        (Date.UTC(year, d.getMonth(), d.getDate()) - first.getTime()) /
          86400000,
      );
      const week = Math.floor(days / 7) + 1;
      const weekKey = `${year}-W${String(week).padStart(2, "0")}`;
      const weekLabel = `W${week}`;
      const weekPrev = byWeek.get(weekKey) || {
        label: weekLabel,
        sum: 0,
        count: 0,
      };
      byWeek.set(weekKey, {
        label: weekPrev.label,
        sum: weekPrev.sum + score,
        count: weekPrev.count + 1,
      });

      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const monthLabel = d.toLocaleDateString(undefined, { month: "short" });
      const monthPrev = byMonth.get(monthKey) || {
        label: monthLabel,
        sum: 0,
        count: 0,
      };
      byMonth.set(monthKey, {
        label: monthPrev.label,
        sum: monthPrev.sum + score,
        count: monthPrev.count + 1,
      });
    }

    const dayTrend = [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-7)
      .map(([, v]) => toPoint(v.label, v.count ? v.sum / v.count : 0));
    const weekTrend = [...byWeek.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-4)
      .map(([, v]) => toPoint(v.label, v.count ? v.sum / v.count : 0));
    const monthTrend = [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-6)
      .map(([, v]) => toPoint(v.label, v.count ? v.sum / v.count : 0));

    const whatsappRows = await db("pulse_survey_whatsapp_messages")
      .where("company_id", companyId)
      .select("status");
    const whatsappSent = whatsappRows.filter((row) =>
      ["sent", "responded"].includes(String(row.status)),
    ).length;
    const whatsappResponded = whatsappRows.filter(
      (row) => String(row.status) === "responded",
    ).length;
    const whatsappPending = whatsappRows.filter(
      (row) => String(row.status) === "sent" || String(row.status) === "pending",
    ).length;
    const whatsappFailed = whatsappRows.filter(
      (row) => String(row.status) === "failed",
    ).length;
    const whatsappDistribution = await db("pulse_survey_whatsapp_messages as wm")
      .join("pulse_survey_responses as r", function () {
        this.on("r.company_id", "=", "wm.company_id")
          .andOn("r.survey_id", "=", "wm.survey_id")
          .andOn("r.employee_id", "=", "wm.employee_id");
      })
      .where("wm.company_id", companyId)
      .where("wm.status", "responded")
      .groupBy("r.label", "r.score")
      .orderBy("r.score", "asc")
      .select("r.label", "r.score", db.raw("COUNT(*) as count"));

    return res.json({
      kpis: {
        totalEmployees: Number(totalEmployees || 0),
        avgHappiness,
        departments: Number(departments || 0),
        avgScoreTrend,
      },
      trend: {
        day: dayTrend,
        week: weekTrend,
        month: monthTrend,
      },
      gender: {
        male: {
          employees: Number(maleRow?.employees || 0),
          score:
            maleRow?.avgScore === null ? 0 : Number(maleRow?.avgScore || 0),
        },
        female: {
          employees: Number(femaleRow?.employees || 0),
          score:
            femaleRow?.avgScore === null ? 0 : Number(femaleRow?.avgScore || 0),
        },
      },
      departmentsDetails: deptDetails.map((d) => ({
        name: d.name,
        employees: Number(d.employees || 0),
        score: d.avgScore === null ? 0 : Number(d.avgScore || 0),
      })),
      branchesDetails: branchDetails.map((b) => ({
        name: b.name,
        employees: Number(b.employees || 0),
        score: b.avgScore === null ? 0 : Number(b.avgScore || 0),
      })),
      whatsapp: {
        sent: whatsappSent,
        responded: whatsappResponded,
        pending: whatsappPending,
        failed: whatsappFailed,
        responseRate: whatsappSent
          ? Math.round((whatsappResponded / whatsappSent) * 100)
          : 0,
        answerDistribution: whatsappDistribution.map((row) => ({
          label: row.label || String(row.score || ""),
          score: Number(row.score || 0),
          count: Number(row.count || 0),
        })),
      },
    });
  } catch (error) {
    console.error("getAdminPulseOverview error:", error);
    return res.status(500).json({ message: "Failed to load overview" });
  }
};

// Admin: survey responses list
const getAdminPulseSurveyResponses = async (req, res) => {
  if (!requireAuthType(req, res, "admin")) return;

  const companyId = req.user.company_id;
  const { id } = req.params;

  try {
    const survey = await db("pulse_surveys")
      .where({ id: Number(id), company_id: companyId })
      .first();
    if (!survey) return res.status(404).json({ message: "Survey not found" });

    const responses = await db("pulse_survey_responses as r")
      .join("employees as e", "e.id", "r.employee_id")
      .leftJoin("departments as d", "e.department_id", "d.id")
      .leftJoin("branches as b", "e.branch_id", "b.id")
      .where("r.company_id", companyId)
      .andWhere("r.survey_id", Number(id))
      .orderBy("r.responded_at", "desc")
      .select(
        "r.*",
        "e.first_name",
        "e.last_name",
        "e.email",
        "e.gender",
        "d.name as department",
        "b.name as branch",
      );

    return res.json(
      responses.map((r) => ({
        id: r.id,
        surveyId: r.survey_id,
        employeeId: r.employee_id,
        score: r.score,
        label: r.label,
        comment: r.comment || "",
        isAnonymous: Boolean(r.is_anonymous),
        respondedAt: r.responded_at,
        updatedAt: r.updated_at,
        department: r.department || null,
        branch: r.branch || null,
        employee:
          Boolean(r.is_anonymous) ||
          (Boolean(survey.allow_anonymous) && Boolean(r.is_anonymous))
            ? null
            : {
                name: `${r.first_name} ${r.last_name || ""}`.trim(),
                email: r.email,
                gender: r.gender,
              },
      })),
    );
  } catch (error) {
    console.error("getAdminPulseSurveyResponses error:", error);
    return res.status(500).json({ message: "Failed to fetch responses" });
  }
};

// Employee: my surveys
const getMyPulseSurveys = async (req, res) => {
  if (!requireAuthType(req, res, "employee")) return;

  const companyId = req.user.company_id;
  const employeeId = getSurveyEmployeeId(req.user);

  try {
    // My Surveys is always recipient-scoped, including for admin/CEO users.
    const surveys = await db("pulse_survey_recipients as pr")
      .join("pulse_surveys as s", "s.id", "pr.survey_id")
      .leftJoin("pulse_survey_responses as r", function () {
        this.on("r.survey_id", "=", "s.id").andOn(
          "r.employee_id",
          "=",
          db.raw("?", [employeeId || 0]),
        );
      })
      .where("pr.company_id", companyId)
      .andWhere("pr.employee_id", employeeId || 0)
      .orderBy("s.created_at", "desc")
      .select(
        "s.id",
        "s.title",
        "s.message",
        "s.allow_anonymous as allowAnonymous",
        "s.created_at as createdAt",
        "r.score as myScore",
        "r.label as myLabel",
        "r.comment as myComment",
        "r.is_anonymous as myIsAnonymous",
        "r.responded_at as myRespondedAt",
      );

    return res.json(
      surveys.map((s) => ({
        id: s.id,
        title: s.title,
        message: s.message || "",
        allowAnonymous: Boolean(s.allowAnonymous),
        createdAt: s.createdAt,
        myResponse: s.myRespondedAt
          ? {
              score: Number(s.myScore || 0),
              label: s.myLabel || "",
              comment: s.myComment || "",
              isAnonymous: Boolean(s.myIsAnonymous),
              respondedAt: s.myRespondedAt,
            }
          : null,
      })),
    );
  } catch (error) {
    console.error("getMyPulseSurveys error:", error);
    return res.status(500).json({ message: "Failed to fetch surveys" });
  }
};

// Employee: get survey + my response
const getPulseSurveyForEmployee = async (req, res) => {
  if (!requireAuthType(req, res, "employee")) return;

  const companyId = req.user.company_id;
  const employeeId = getSurveyEmployeeId(req.user);
  const { id } = req.params;

  try {
    if (!employeeId)
      return res.status(404).json({ message: "Survey not found" });

    const assigned = await db("pulse_survey_recipients")
      .where({
        company_id: companyId,
        employee_id: employeeId,
        survey_id: Number(id),
      })
      .first();
    if (!assigned)
      return res.status(404).json({ message: "Survey not found" });

    const survey = await db("pulse_surveys")
      .where({ company_id: companyId, id: Number(id) })
      .first();
    if (!survey) return res.status(404).json({ message: "Survey not found" });

    const response = employeeId
      ? await db("pulse_survey_responses")
          .where({
            company_id: companyId,
            survey_id: Number(id),
            employee_id: employeeId,
          })
          .first()
      : null;

    return res.json({
      id: survey.id,
      title: survey.title,
      message: survey.message || "",
      allowAnonymous: Boolean(survey.allow_anonymous),
      createdAt: survey.created_at,
      myResponse: response
        ? {
            score: Number(response.score || 0),
            label: response.label || "",
            comment: response.comment || "",
            isAnonymous: Boolean(response.is_anonymous),
            respondedAt: response.responded_at,
            updatedAt: response.updated_at,
          }
        : null,
    });
  } catch (error) {
    console.error("getPulseSurveyForEmployee error:", error);
    return res.status(500).json({ message: "Failed to fetch survey" });
  }
};

// Employee: submit/update response
const respondPulseSurvey = async (req, res) => {
  if (!requireAuthType(req, res, "employee")) return;

  const companyId = req.user.company_id;
  const employeeId = getSurveyEmployeeId(req.user);
  const { id } = req.params;
  const {
    score,
    label = "",
    comment = "",
    isAnonymous = false,
  } = req.body || {};

  if (!employeeId) {
    return res.status(403).json({ message: "This survey is not assigned to you" });
  }

  const numericScore = clampScore(score);
  if (numericScore < 1 || numericScore > 10) {
    return res.status(400).json({ message: "Score must be between 1 and 10" });
  }

  try {
    const survey = await db("pulse_surveys")
      .where({ company_id: companyId, id: Number(id) })
      .first();
    if (!survey) return res.status(404).json({ message: "Survey not found" });

    const assigned = await db("pulse_survey_recipients")
      .where({
        company_id: companyId,
        employee_id: employeeId,
        survey_id: Number(id),
      })
      .first();
    if (!assigned)
      return res.status(403).json({ message: "This survey is not assigned to you" });

    const allowAnonymous = Boolean(survey.allow_anonymous);
    const anonymousFlag = allowAnonymous ? Boolean(isAnonymous) : false;

    const existing = await db("pulse_survey_responses")
      .where({
        company_id: companyId,
        survey_id: Number(id),
        employee_id: employeeId,
      })
      .first();

    const now = new Date();
    const payload = {
      survey_id: Number(id),
      employee_id: employeeId,
      company_id: companyId,
      score: numericScore,
      label: String(label || "").slice(0, 64),
      comment: comment ? String(comment) : null,
      is_anonymous: anonymousFlag,
      responded_at: now,
      updated_at: now,
    };

    if (existing) {
      await db("pulse_survey_responses")
        .where({ id: existing.id })
        .update(payload);
    } else {
      await db("pulse_survey_responses").insert({
        ...payload,
        created_at: now,
      });
    }

    return res.json({
      message: existing ? "Response updated" : "Response submitted",
    });
  } catch (error) {
    console.error("respondPulseSurvey error:", error);
    return res.status(500).json({ message: "Failed to submit response" });
  }
};

const resolveDailySurveyCreatorUserId = async ({ companyId, fallbackUserId }) => {
  const fallbackUser = fallbackUserId
    ? await db("users")
        .where({ id: fallbackUserId, company_id: companyId })
        .first()
    : null;

  if (fallbackUser) return fallbackUser.id;

  const companyAdmin = await db("users")
    .where({ company_id: companyId })
    .whereIn("role", ["admin", "ceo", "Admin", "CEO"])
    .orderBy("id", "asc")
    .first();

  if (companyAdmin) return companyAdmin.id;

  const companyUser = await db("users")
    .where({ company_id: companyId })
    .orderBy("id", "asc")
    .first();

  return companyUser?.id || null;
};

const ensureDailyPulseSurvey = async ({ companyId, employeeId, createdByUserId }) => {
  const dateKey = getLocalDateKey();
  const title = `Daily Log - ${dateKey}`;
  const message = "How are you feeling today?";

  let survey = await db("pulse_surveys")
    .where({ company_id: companyId, title })
    .first();

  if (!survey) {
    const creatorUserId = await resolveDailySurveyCreatorUserId({
      companyId,
      fallbackUserId: createdByUserId,
    });

    if (!creatorUserId) {
      throw new Error("No company user available to create daily survey");
    }

    const [surveyId] = await db("pulse_surveys").insert({
      company_id: companyId,
      created_by_user_id: creatorUserId,
      title,
      message,
      recipient_type: "employee",
      allow_anonymous: false,
      status: "sent",
      total_sent: 0,
      created_at: new Date(),
      updated_at: new Date(),
    });

    survey = await db("pulse_surveys")
      .where({ company_id: companyId, id: surveyId })
      .first();
  }

  const recipient = await db("pulse_survey_recipients")
    .where({
      company_id: companyId,
      survey_id: survey.id,
      employee_id: employeeId,
    })
    .first();

  if (!recipient) {
    await db("pulse_survey_recipients").insert({
      company_id: companyId,
      survey_id: survey.id,
      employee_id: employeeId,
      sent_at: new Date(),
    });

    await db("pulse_surveys")
      .where({ id: survey.id })
      .increment("total_sent", 1)
      .update({ updated_at: new Date() });
  }

  return survey;
};

const respondDailyPulseSurvey = async (req, res) => {
  if (!requireAuthType(req, res, "employee")) return;

  const companyId = req.user.company_id;
  const employeeId = getSurveyEmployeeId(req.user);
  const { score, label = "", comment = "" } = req.body || {};

  if (!companyId) {
    return res.status(400).json({ message: "Missing company_id" });
  }

  if (!employeeId) {
    return res.status(400).json({ message: "Employee profile is required" });
  }

  const numericScore = clampScore(score);
  if (numericScore < 1 || numericScore > 10) {
    return res.status(400).json({ message: "Score must be between 1 and 10" });
  }

  try {
    const survey = await ensureDailyPulseSurvey({
      companyId,
      employeeId,
      createdByUserId: req.user.id,
    });

    const existing = await db("pulse_survey_responses")
      .where({
        company_id: companyId,
        survey_id: survey.id,
        employee_id: employeeId,
      })
      .first();

    const now = new Date();
    const payload = {
      survey_id: survey.id,
      employee_id: employeeId,
      company_id: companyId,
      score: numericScore,
      label: String(label || "").slice(0, 64),
      comment: comment ? String(comment) : null,
      is_anonymous: false,
      responded_at: now,
      updated_at: now,
    };

    if (existing) {
      await db("pulse_survey_responses").where({ id: existing.id }).update(payload);
    } else {
      await db("pulse_survey_responses").insert({ ...payload, created_at: now });
    }

    return res.json({
      message: existing ? "Daily log updated" : "Daily log submitted",
      surveyId: survey.id,
    });
  } catch (error) {
    console.error("respondDailyPulseSurvey error:", error);
    return res.status(500).json({ message: "Failed to submit daily log" });
  }
};

// Admin: templates CRUD
const getPulseSurveyTemplates = async (req, res) => {
  if (!requireAuthType(req, res, "admin")) return;

  const companyId = req.user.company_id;
  const onlyActive = String(req.query.active || "").toLowerCase() === "true";

  try {
    const query = db("pulse_survey_templates")
      .where("company_id", companyId)
      .orderBy("created_at", "desc");

    if (onlyActive) query.andWhere("is_active", 1);

    const templates = await query;
    return res.json(
      templates.map((t) => ({
        id: t.id,
        name: t.name,
        title: t.title,
        message: t.message || "",
        category: t.category || "general",
        isActive: Boolean(t.is_active),
        whatsappTemplateName: t.whatsapp_template_name || "",
        whatsappLanguage: t.whatsapp_language || "en_US",
        whatsappButtons: normalizeWhatsappButtons(t.whatsapp_buttons),
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      })),
    );
  } catch (error) {
    console.error("getPulseSurveyTemplates error:", error);
    return res.status(500).json({ message: "Failed to fetch templates" });
  }
};

const createPulseSurveyTemplate = async (req, res) => {
  if (!requireAuthType(req, res, "admin")) return;

  const companyId = req.user.company_id;
  const createdByUserId = req.user.id;
  const {
    name,
    title,
    message = "",
    category = "general",
    isActive = true,
    whatsappTemplateName = "",
    whatsappLanguage = "en_US",
    whatsappButtons = [],
  } = req.body || {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ message: "Template name is required" });
  }
  if (!title || !String(title).trim()) {
    return res.status(400).json({ message: "Template title is required" });
  }

  try {
    const payload = {
      company_id: companyId,
      created_by_user_id: createdByUserId,
      name: String(name).trim(),
      title: String(title).trim(),
      message: message ? String(message) : null,
      category: String(category || "general").trim() || "general",
      is_active: Boolean(isActive),
      whatsapp_template_name: whatsappTemplateName
        ? String(whatsappTemplateName).trim()
        : null,
      whatsapp_language: String(whatsappLanguage || "en_US").trim() || "en_US",
      whatsapp_buttons: JSON.stringify(normalizeWhatsappButtons(whatsappButtons)),
      created_at: new Date(),
      updated_at: new Date(),
    };

    const [id] = await db("pulse_survey_templates").insert(payload);
    return res
      .status(201)
      .json({
        id,
        ...payload,
        company_id: undefined,
        created_by_user_id: undefined,
      });
  } catch (error) {
    console.error("createPulseSurveyTemplate error:", error);
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ message: "Template name already exists" });
    }
    return res.status(500).json({ message: "Failed to create template" });
  }
};

const updatePulseSurveyTemplate = async (req, res) => {
  if (!requireAuthType(req, res, "admin")) return;

  const companyId = req.user.company_id;
  const { id } = req.params;
  const {
    name,
    title,
    message,
    category,
    isActive,
    whatsappTemplateName,
    whatsappLanguage,
    whatsappButtons,
  } = req.body || {};

  try {
    const existing = await db("pulse_survey_templates")
      .where({ id: Number(id), company_id: companyId })
      .first();
    if (!existing)
      return res.status(404).json({ message: "Template not found" });

    const next = {
      updated_at: new Date(),
    };
    if (name !== undefined) next.name = String(name).trim();
    if (title !== undefined) next.title = String(title).trim();
    if (message !== undefined) next.message = message ? String(message) : null;
    if (category !== undefined)
      next.category = String(category || "general").trim() || "general";
    if (isActive !== undefined) next.is_active = Boolean(isActive);
    if (whatsappTemplateName !== undefined) {
      next.whatsapp_template_name = whatsappTemplateName
        ? String(whatsappTemplateName).trim()
        : null;
    }
    if (whatsappLanguage !== undefined) {
      next.whatsapp_language =
        String(whatsappLanguage || "en_US").trim() || "en_US";
    }
    if (whatsappButtons !== undefined) {
      next.whatsapp_buttons = JSON.stringify(
        normalizeWhatsappButtons(whatsappButtons),
      );
    }

    await db("pulse_survey_templates")
      .where({ id: Number(id), company_id: companyId })
      .update(next);

    return res.json({ message: "Template updated" });
  } catch (error) {
    console.error("updatePulseSurveyTemplate error:", error);
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ message: "Template name already exists" });
    }
    return res.status(500).json({ message: "Failed to update template" });
  }
};

const deletePulseSurveyTemplate = async (req, res) => {
  if (!requireAuthType(req, res, "admin")) return;

  const companyId = req.user.company_id;
  const { id } = req.params;

  try {
    const deleted = await db("pulse_survey_templates")
      .where({ id: Number(id), company_id: companyId })
      .del();

    if (!deleted)
      return res.status(404).json({ message: "Template not found" });
    return res.json({ message: "Template deleted" });
  } catch (error) {
    console.error("deletePulseSurveyTemplate error:", error);
    return res.status(500).json({ message: "Failed to delete template" });
  }
};

module.exports = {
  createPulseSurvey,
  getAdminPulseSurveys,
  getAdminPulseSurveyById,
  getAdminPulseOverview,
  getAdminPulseSurveyResponses,
  getMyPulseSurveys,
  getPulseSurveyForEmployee,
  respondPulseSurvey,
  respondDailyPulseSurvey,
  handleOwnChatWebhook,
  // Templates
  createPulseSurveyTemplate,
  getPulseSurveyTemplates,
  updatePulseSurveyTemplate,
  deletePulseSurveyTemplate,
};
