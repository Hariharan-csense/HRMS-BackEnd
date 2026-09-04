const knex = require("../db/db");

const CATEGORY_SLA_HOURS = {
  pf_issue: 48,
  salary_query: 24,
  asset_issue: 24,
  leave_balance_issue: 16,
  policy_query: 48,
  general: 72,
};

const CATEGORY_LABELS = {
  pf_issue: "PF Issue",
  salary_query: "Salary Query",
  asset_issue: "Asset Issue",
  leave_balance_issue: "Leave Balance Issue",
  policy_query: "Policy Query",
  general: "General",
};

const VALID_CATEGORIES = Object.keys(CATEGORY_SLA_HOURS);
const VALID_PRIORITIES = ["low", "medium", "high", "urgent"];
const VALID_STATUSES = ["open", "assigned", "in_progress", "resolved", "closed"];

const ensureHelpdeskTable = async () => {
  const exists = await knex.schema.hasTable("hr_helpdesk_tickets");
  if (exists) return;

  await knex.schema.createTable("hr_helpdesk_tickets", (table) => {
    table.increments("id").primary();
    table.integer("company_id").unsigned().notNullable();
    table.string("ticket_number", 30).notNullable();
    table.integer("employee_id").unsigned().nullable();
    table.string("employee_name", 150).nullable();
    table.string("employee_email", 150).nullable();
    table.string("category", 60).notNullable().defaultTo("general");
    table.string("priority", 20).notNullable().defaultTo("medium");
    table.string("subject", 200).notNullable();
    table.text("description").nullable();
    table.string("status", 30).notNullable().defaultTo("open");
    table.integer("assigned_hr_id").unsigned().nullable();
    table.string("assigned_hr_name", 150).nullable();
    table.integer("sla_hours").unsigned().notNullable().defaultTo(72);
    table.timestamp("due_at").nullable();
    table.timestamp("resolved_at").nullable();
    table.text("resolution_notes").nullable();
    table.integer("created_by").unsigned().nullable();
    table.integer("updated_by").unsigned().nullable();
    table.timestamps(true, true);
    table.unique(["company_id", "ticket_number"]);
  });
};

const normalize = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const isEmployeeUser = (user = {}) =>
  normalize(user.type) === "employee" || normalize(user.role) === "employee";

const resolveEmployee = async (user = {}) => {
  if (!user.company_id) return null;

  if (user.employee_id) {
    const byEmployeeId = await knex("employees")
      .where({ id: user.employee_id, company_id: user.company_id })
      .first();
    if (byEmployeeId) return byEmployeeId;
  }

  if (isEmployeeUser(user) && user.id) {
    const byId = await knex("employees")
      .where({ id: user.id, company_id: user.company_id })
      .first();
    if (byId) return byId;
  }

  if (user.email) {
    const byEmail = await knex("employees")
      .where({ company_id: user.company_id })
      .whereRaw("LOWER(email) = ?", [normalize(user.email)])
      .first();
    if (byEmail) return byEmail;
  }

  return null;
};

const getUserName = (user = {}, employee = null) => {
  const employeeName = employee
    ? `${employee.first_name || ""} ${employee.last_name || ""}`.trim()
    : "";
  return employeeName || user.name || user.email || "User";
};

const generateHelpdeskNumber = async (companyId) => {
  const prefix = `HRD${new Date().getFullYear()}`;
  const latest = await knex("hr_helpdesk_tickets")
    .where({ company_id: companyId })
    .where("ticket_number", "like", `${prefix}%`)
    .orderBy("ticket_number", "desc")
    .first("ticket_number");
  const seq = latest?.ticket_number
    ? Number(String(latest.ticket_number).replace(prefix, "")) + 1
    : 1;
  return `${prefix}${String(seq || 1).padStart(4, "0")}`;
};

const addHours = (hours) => {
  const date = new Date();
  date.setHours(date.getHours() + Number(hours || 0));
  return date;
};

const formatTicket = (row = {}) => ({
  id: row.id,
  ticketNumber: row.ticket_number,
  employeeId: row.employee_id,
  employeeName: row.employee_name,
  employeeEmail: row.employee_email,
  category: row.category,
  categoryLabel: CATEGORY_LABELS[row.category] || row.category,
  priority: row.priority,
  subject: row.subject,
  description: row.description,
  status: row.status,
  assignedHrId: row.assigned_hr_id,
  assignedHrName: row.assigned_hr_name,
  slaHours: row.sla_hours,
  dueAt: row.due_at,
  resolvedAt: row.resolved_at,
  resolutionNotes: row.resolution_notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const getHelpdeskTickets = async (req, res) => {
  try {
    await ensureHelpdeskTable();
    const companyId = req.user.company_id;
    const { status, category, priority } = req.query;
    const employee = await resolveEmployee(req.user);

    let query = knex("hr_helpdesk_tickets")
      .where({ company_id: companyId })
      .orderBy("created_at", "desc");

    if (isEmployeeUser(req.user) && employee?.id) {
      query.where("employee_id", employee.id);
    }
    if (status && status !== "all") query.where("status", status);
    if (category && category !== "all") query.where("category", category);
    if (priority && priority !== "all") query.where("priority", priority);

    const rows = await query;
    const stats = rows.reduce(
      (acc, row) => {
        acc.total += 1;
        acc[row.status] = (acc[row.status] || 0) + 1;
        if (row.due_at && !["resolved", "closed"].includes(row.status)) {
          if (new Date(row.due_at).getTime() < Date.now()) acc.overdue += 1;
        }
        return acc;
      },
      { total: 0, open: 0, assigned: 0, in_progress: 0, resolved: 0, closed: 0, overdue: 0 },
    );

    res.json({ success: true, data: rows.map(formatTicket), stats });
  } catch (error) {
    console.error("HR helpdesk list error:", error);
    res.status(500).json({ success: false, message: "Failed to load HR helpdesk tickets" });
  }
};

const createHelpdeskTicket = async (req, res) => {
  try {
    await ensureHelpdeskTable();
    const companyId = req.user.company_id;
    const employee = await resolveEmployee(req.user);
    const {
      category = "general",
      priority = "medium",
      subject,
      description,
    } = req.body;

    if (!subject) {
      return res.status(400).json({ success: false, message: "Subject is required" });
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: "Invalid category" });
    }
    if (!VALID_PRIORITIES.includes(priority)) {
      return res.status(400).json({ success: false, message: "Invalid priority" });
    }

    const slaHours = CATEGORY_SLA_HOURS[category] || CATEGORY_SLA_HOURS.general;
    const ticketNumber = await generateHelpdeskNumber(companyId);
    const employeeName = getUserName(req.user, employee);
    const insertResult = await knex("hr_helpdesk_tickets").insert({
      company_id: companyId,
      ticket_number: ticketNumber,
      employee_id: employee?.id || req.user.employee_id || null,
      employee_name: employeeName,
      employee_email: employee?.email || req.user.email || null,
      category,
      priority,
      subject,
      description,
      status: "open",
      sla_hours: slaHours,
      due_at: addHours(slaHours),
      created_by: req.user.id || req.user.employee_id || null,
      updated_by: req.user.id || req.user.employee_id || null,
    });

    const id = Array.isArray(insertResult) ? insertResult[0] : insertResult;
    const row = await knex("hr_helpdesk_tickets").where({ id, company_id: companyId }).first();
    res.status(201).json({ success: true, data: formatTicket(row), message: "HR helpdesk ticket created" });
  } catch (error) {
    console.error("HR helpdesk create error:", error);
    res.status(500).json({ success: false, message: "Failed to create HR helpdesk ticket" });
  }
};

const updateHelpdeskTicket = async (req, res) => {
  try {
    await ensureHelpdeskTable();
    const companyId = req.user.company_id;
    const { id } = req.params;
    const current = await knex("hr_helpdesk_tickets")
      .where({ id, company_id: companyId })
      .first();

    if (!current) {
      return res.status(404).json({ success: false, message: "Ticket not found" });
    }

    if (isEmployeeUser(req.user)) {
      const employee = await resolveEmployee(req.user);
      if (employee?.id && Number(current.employee_id) !== Number(employee.id)) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
    }

    const updateData = {};
    const {
      status,
      priority,
      assignedHrId,
      assignedHrName,
      resolutionNotes,
    } = req.body;

    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ success: false, message: "Invalid status" });
      }
      updateData.status = status;
      if (["resolved", "closed"].includes(status)) updateData.resolved_at = new Date();
    }
    if (priority) {
      if (!VALID_PRIORITIES.includes(priority)) {
        return res.status(400).json({ success: false, message: "Invalid priority" });
      }
      updateData.priority = priority;
    }
    if (assignedHrId !== undefined) updateData.assigned_hr_id = assignedHrId || null;
    if (assignedHrName !== undefined) updateData.assigned_hr_name = assignedHrName || null;
    if (resolutionNotes !== undefined) updateData.resolution_notes = resolutionNotes || null;
    updateData.updated_by = req.user.id || req.user.employee_id || null;
    updateData.updated_at = knex.fn.now();

    await knex("hr_helpdesk_tickets")
      .where({ id, company_id: companyId })
      .update(updateData);

    const row = await knex("hr_helpdesk_tickets").where({ id, company_id: companyId }).first();
    res.json({ success: true, data: formatTicket(row), message: "HR helpdesk ticket updated" });
  } catch (error) {
    console.error("HR helpdesk update error:", error);
    res.status(500).json({ success: false, message: "Failed to update HR helpdesk ticket" });
  }
};

const getHrAssignees = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const users = await knex("users")
      .where({ company_id: companyId })
      .whereIn("role", ["hr", "admin", "ceo"])
      .select("id", "name", "email", "role")
      .orderBy("name");

    res.json({ success: true, data: users });
  } catch (error) {
    console.error("HR assignees error:", error);
    res.status(500).json({ success: false, message: "Failed to load HR assignees" });
  }
};

module.exports = {
  getHelpdeskTickets,
  createHelpdeskTicket,
  updateHelpdeskTicket,
  getHrAssignees,
};
