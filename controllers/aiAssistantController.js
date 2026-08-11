const knex = require("../db/db");

const MAX_HISTORY_MESSAGES = 12;
const MAX_MESSAGE_LENGTH = 4000;

const buildSystemPrompt = (user = {}, liveContext = "") => {
  const role = user.role || "employee";
  return [
    "You are the built-in AI Assistant for a HRMS application.",
    "Help users with HRMS workflows, attendance, leave, payroll, expenses, assets, reports, tickets, and onboarding.",
    "Keep answers concise, practical, and friendly.",
    "When live HRMS context is provided, answer from that context directly. Do not say you do not have database access.",
    "If earlier assistant messages claimed there is no database access, ignore that claim when live HRMS context is present.",
    "If the user asks for live totals that are present in the context, give the numbers first.",
    "Respect the access scope in live context. Do not reveal organization-wide, payroll, or employee-specific data unless that scope is explicitly present.",
    "Do not invent company policy, salary, employee, or payroll facts that are not provided in the conversation or live context.",
    `Current user role: ${role}.`,
    liveContext ? `Live HRMS context:\n${liveContext}` : "",
  ].join(" ");
};

const normalizeHistory = (history = []) => {
  if (!Array.isArray(history)) return [];

  return history
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      content: String(message?.content || "").slice(0, MAX_MESSAGE_LENGTH),
    }))
    .filter((message) => message.content.trim());
};

const getOpenAIClient = () => {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error("OPENAI_API_KEY is not configured");
    error.statusCode = 503;
    throw error;
  }

  try {
    const OpenAI = require("openai");
    return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  } catch (error) {
    error.statusCode = 500;
    error.message =
      "OpenAI SDK is not installed. Run npm install openai in the backend folder.";
    throw error;
  }
};

const safeCount = async (builder) => {
  try {
    const row = await builder.count("* as count").first();
    return Number(row?.count || 0);
  } catch {
    return 0;
  }
};

const tableExists = async (tableName) => {
  try {
    return await knex.schema.hasTable(tableName);
  } catch {
    return false;
  }
};

const getTodayString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getRoleSet = (user = {}) => {
  const roles = new Set();
  const addRole = (value) => {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized) roles.add(normalized);
  };

  addRole(user.role);
  if (Array.isArray(user.roles)) {
    user.roles.forEach(addRole);
  }
  if (String(user.type || "").toLowerCase() === "employee" && roles.size === 0) {
    roles.add("employee");
  }

  return roles;
};

const hasAnyAiRole = (roleSet, allowedRoles = []) =>
  allowedRoles.some((role) => roleSet.has(role));

const resolveEmployeeIdForAi = async (user = {}, companyId) => {
  const directIds = [user.employee_id, user.employeeId, user.id]
    .map((id) => Number(id))
    .filter(Boolean);

  for (const id of directIds) {
    const employee = await knex("employees")
      .where({ id, company_id: companyId })
      .first();
    if (employee) return Number(employee.id);
  }

  if (user.email) {
    const employee = await knex("employees")
      .where({ company_id: companyId })
      .whereRaw("LOWER(email) = ?", [String(user.email).toLowerCase().trim()])
      .first();
    if (employee) return Number(employee.id);
  }

  return null;
};

const appendSelfContext = async ({ parts, companyId, employeeId, today, currentMonth }) => {
  if (!employeeId || !(await tableExists("employees"))) return;

  const employee = await knex("employees as e")
    .leftJoin("departments as d", "e.department_id", "d.id")
    .where({ "e.id": employeeId, "e.company_id": companyId })
    .select(
      "e.employee_id",
      "e.first_name",
      "e.last_name",
      "e.email",
      "e.status",
      "d.name as department",
    )
    .first();

  if (employee) {
    parts.push(
      `Your employee profile: ${employee.employee_id || ""} ${employee.first_name || ""} ${employee.last_name || ""}`.trim(),
    );
    if (employee.department) parts.push(`Your department: ${employee.department}`);
  }

  if (await tableExists("attendance")) {
    const attendanceRows = await knex("attendance")
      .where({ employee_id: employeeId })
      .whereRaw("DATE(check_in) = ?", [today])
      .select("status", "check_in", "check_out", "hours_worked")
      .orderBy("check_in", "asc");

    if (attendanceRows.length) {
      const active = attendanceRows.some((row) => !row.check_out);
      const statuses = attendanceRows
        .map((row) => String(row.status || "present"))
        .filter(Boolean)
        .join(", ");
      parts.push(`Your attendance today: ${statuses || "checked in"}`);
      parts.push(`Your active check-in now: ${active ? "yes" : "no"}`);
      parts.push(`Your attendance entries today: ${attendanceRows.length}`);
    } else {
      parts.push("Your attendance today: no check-in found");
    }
  }

  if (await tableExists("leave_applications")) {
    const pendingOwnLeaves = await safeCount(
      knex("leave_applications").where({
        company_id: companyId,
        employee_id: employeeId,
        status: "pending",
      }),
    );
    const onLeaveToday = await safeCount(
      knex("leave_applications")
        .where({ company_id: companyId, employee_id: employeeId, status: "approved" })
        .whereRaw("? BETWEEN from_date AND to_date", [today]),
    );
    parts.push(`Your pending leave requests: ${pendingOwnLeaves}`);
    parts.push(`You are on approved leave today: ${onLeaveToday > 0 ? "yes" : "no"}`);
  }

  if (await tableExists("expenses")) {
    const pendingOwnExpenses = await safeCount(
      knex("expenses")
        .where({ employee_id: employeeId })
        .whereRaw("LOWER(COALESCE(status, 'pending')) = 'pending'"),
    );
    parts.push(`Your pending expense claims: ${pendingOwnExpenses}`);
  }

  if (await tableExists("payroll_processing")) {
    const ownPayrollRows = await safeCount(
      knex("payroll_processing")
        .where({ employee_id: employeeId, month: currentMonth }),
    );
    parts.push(`Your payroll records for ${currentMonth}: ${ownPayrollRows}`);
  }
};

const getAiLiveContext = async (user = {}) => {
  const companyId = Number(user.company_id || 0);
  if (!companyId) return "";

  const today = getTodayString();
  const currentMonth = today.slice(0, 7);
  const roleSet = getRoleSet(user);
  const canSeeOrgSummary = hasAnyAiRole(roleSet, [
    "admin",
    "ceo",
    "superadmin",
    "hr",
    "human resources",
    "human resource",
  ]);
  const canSeeFinanceSummary = hasAnyAiRole(roleSet, [
    "admin",
    "ceo",
    "superadmin",
    "finance",
  ]);
  const employeeId = await resolveEmployeeIdForAi(user, companyId);
  const parts = [`Date: ${today}`, `Company ID: ${companyId}`];

  if (!canSeeOrgSummary && !canSeeFinanceSummary) {
    parts.push("Access scope: self-service employee data only");
    await appendSelfContext({ parts, companyId, employeeId, today, currentMonth });
    return parts.join("\n");
  }

  if (canSeeOrgSummary) {
    parts.push("Access scope: organization HR summary");
  } else if (canSeeFinanceSummary) {
    parts.push("Access scope: finance summary");
  }

  if (canSeeOrgSummary && (await tableExists("employees"))) {
    const totalEmployees = await safeCount(
      knex("employees").where({ company_id: companyId }).whereRaw("LOWER(COALESCE(status, 'active')) = 'active'"),
    );
    parts.push(`Total active employees: ${totalEmployees}`);
  }

  if (canSeeOrgSummary && (await tableExists("attendance")) && (await tableExists("employees"))) {
    const attendanceRows = await knex("attendance as a")
      .leftJoin("employees as e", "a.employee_id", "e.id")
      .where("e.company_id", companyId)
      .whereRaw("DATE(a.check_in) = ?", [today])
      .select("a.employee_id", "a.status", "a.check_in", "a.check_out");

    const presentEmployeeIds = new Set(
      attendanceRows
        .filter((row) =>
          ["present", "late", "grace"].includes(
            String(row.status || "").toLowerCase().trim(),
          ),
        )
        .map((row) => Number(row.employee_id))
        .filter(Boolean),
    );
    const lateCount = attendanceRows.filter(
      (row) => String(row.status || "").toLowerCase().trim() === "late",
    ).length;
    const activeCheckins = attendanceRows.filter((row) => !row.check_out).length;

    let onLeave = 0;
    if (await tableExists("leave_applications")) {
      try {
        const leaveRow = await knex("leave_applications")
          .where({ company_id: companyId, status: "approved" })
          .whereRaw("? BETWEEN from_date AND to_date", [today])
          .countDistinct("employee_id as count")
          .first();
        onLeave = Number(leaveRow?.count || 0);
      } catch {
        onLeave = 0;
      }
    }

    const totalEmployees = await safeCount(
      knex("employees").where({ company_id: companyId }).whereRaw("LOWER(COALESCE(status, 'active')) = 'active'"),
    );
    const presentToday = presentEmployeeIds.size;
    const absentToday = Math.max(0, totalEmployees - presentToday - onLeave);

    parts.push(`Today's attendance present employees: ${presentToday}`);
    parts.push(`Today's attendance active check-ins: ${activeCheckins}`);
    parts.push(`Today's late arrivals: ${lateCount}`);
    parts.push(`Today's approved leave employees: ${onLeave}`);
    parts.push(`Today's likely absent employees: ${absentToday}`);

    parts.push("Employee names are not included in AI context by default.");
  }

  if (canSeeOrgSummary && (await tableExists("leave_applications"))) {
    const pendingLeaves = await safeCount(
      knex("leave_applications").where({ company_id: companyId, status: "pending" }),
    );
    parts.push(`Pending leave requests: ${pendingLeaves}`);
  }

  if (canSeeFinanceSummary && (await tableExists("expenses"))) {
    const pendingExpenses = await safeCount(
      knex("expenses as ex")
        .leftJoin("employees as e", "ex.employee_id", "e.id")
        .where("e.company_id", companyId)
        .whereRaw("LOWER(COALESCE(ex.status, 'pending')) = 'pending'"),
    );
    parts.push(`Pending expense claims: ${pendingExpenses}`);
  }

  if (canSeeFinanceSummary && (await tableExists("payroll_processing"))) {
    const processedPayroll = await safeCount(
      knex("payroll_processing as pp")
        .leftJoin("employees as e", "pp.employee_id", "e.id")
        .where("e.company_id", companyId)
        .where("pp.month", currentMonth)
        .whereRaw("LOWER(COALESCE(pp.status, 'processed')) = 'processed'"),
    );
    parts.push(`Payroll processed employees for ${currentMonth}: ${processedPayroll}`);
  }

  return parts.join("\n");
};

const getGeminiText = (responseBody = {}) => {
  return (
    responseBody.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim() || ""
  );
};

const toGeminiContents = (history = [], message = "") => {
  return [
    ...history.map((item) => ({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: item.content }],
    })),
    {
      role: "user",
      parts: [{ text: message.slice(0, MAX_MESSAGE_LENGTH) }],
    },
  ];
};

const sendGeminiMessage = async ({ message, history, user, liveContext }) => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    const error = new Error(
      "Gemini API key is not configured. Add GEMINI_API_KEY in backend/.env.",
    );
    error.statusCode = 503;
    throw error;
  }

  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: buildSystemPrompt(user, liveContext) }],
      },
      contents: toGeminiContents(history, message),
      generationConfig: {
        maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 800),
      },
    }),
  });

  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      responseBody.error?.message || `Gemini request failed with ${response.status}`,
    );
    error.statusCode = response.status;
    throw error;
  }

  return {
    reply: getGeminiText(responseBody) || "I could not generate a response right now.",
    model,
  };
};

const sendOpenAIMessage = async ({ message, history, user, liveContext }) => {
  const client = getOpenAIClient();
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const input = [
    ...history,
    {
      role: "user",
      content: message.slice(0, MAX_MESSAGE_LENGTH),
    },
  ];

  const response = await client.responses.create({
    model,
    instructions: buildSystemPrompt(user, liveContext),
    input,
    max_output_tokens: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 800),
  });

  return {
    reply:
      response.output_text ||
      "I could not generate a response right now. Please try again.",
    model,
  };
};

const sendAiAssistantMessage = async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    if (!message) {
      return res.status(400).json({
        success: false,
        message: "Message is required",
      });
    }

    const history = normalizeHistory(req.body?.history);
    const liveContext = await getAiLiveContext(req.user);
    const provider = String(process.env.AI_PROVIDER || "openai").toLowerCase();
    const result =
      provider === "gemini"
        ? await sendGeminiMessage({ message, history, user: req.user, liveContext })
        : await sendOpenAIMessage({ message, history, user: req.user, liveContext });

    return res.json({
      success: true,
      data: {
        ...result,
        provider,
      },
    });
  } catch (error) {
    console.error("AI assistant error:", error);
    const statusCode = error.statusCode || error.status || 500;
    return res.status(statusCode).json({
      success: false,
      message:
        statusCode === 503
          ? error.message ||
            "AI Assistant is not configured. Add an AI provider API key in backend/.env."
          : error.message || "AI Assistant failed to respond",
    });
  }
};

module.exports = {
  sendAiAssistantMessage,
};
