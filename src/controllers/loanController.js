const knex = require("../db/db");
const { hasAnyRole } = require("../middleware/authMiddleware");
const { validateLoanPolicy } = require("../services/companyPolicyService");
const { getDateKey } = require("../utils/dateTime");

const PRIVILEGED_ROLES = ["admin", "hr", "finance", "ceo", "superadmin"];

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const roundTo2 = (value) => Number((Number(value) || 0).toFixed(2));

const todayKey = () => getDateKey();

const normalizeMonth = (value) => {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}$/.test(text) ? text : null;
};

const normalizeRequestType = (value) => {
  const type = String(value || "loan").toLowerCase().trim();
  return type === "advance" ? "advance" : "loan";
};

const isPrivilegedUser = (user) => hasAnyRole(user, PRIVILEGED_ROLES);

const getActorEmployeeId = (req) => req.user?.employee_id || req.user?.id || null;

const resolveEmployee = async (req, companyId) => {
  const bodyEmployeeId = req.body?.employee_id || req.body?.employeeId;
  const bodyEmployeeCode = req.body?.employee_code || req.body?.employeeCode;

  let query = knex("employees as e")
    .leftJoin("departments as d", "e.department_id", "d.id")
    .where("e.company_id", companyId)
    .select(
      "e.id",
      "e.employee_id",
      "e.first_name",
      "e.last_name",
      "e.department_id",
      "d.name as department_name",
    );

  if (isPrivilegedUser(req.user) && (bodyEmployeeId || bodyEmployeeCode)) {
    query = query.where((builder) => {
      if (bodyEmployeeId && !Number.isNaN(Number(bodyEmployeeId))) {
        builder.orWhere("e.id", Number(bodyEmployeeId));
      }
      if (bodyEmployeeId) {
        builder.orWhere("e.employee_id", String(bodyEmployeeId));
      }
      if (bodyEmployeeCode) {
        builder.orWhere("e.employee_id", String(bodyEmployeeCode));
      }
    });
  } else {
    const actorEmployeeId = getActorEmployeeId(req);
    if (!actorEmployeeId) return null;
    query = query.where("e.id", actorEmployeeId);
  }

  return query.first();
};

const serializeLoan = (row) => ({
  id: row.id,
  requestNo: row.request_no,
  companyId: row.company_id,
  employeeId: row.employee_id,
  employeeCode: row.employee_code,
  employeeName: row.employee_name,
  departmentName: row.department_name,
  requestType: row.request_type,
  amount: Number(row.amount || 0),
  tenureMonths: Number(row.tenure_months || 0),
  emiAmount: Number(row.emi_amount || 0),
  recoveryStartMonth: row.recovery_start_month,
  requestDate: row.request_date,
  purpose: row.purpose,
  status: row.status,
  paidInstallments: Number(row.paid_installments || 0),
  remainingInstallments: Number(row.remaining_installments || 0),
  paidAmount: Number(row.paid_amount || 0),
  balanceAmount: Number(row.balance_amount || 0),
  approvedBy: row.approved_by || null,
  approvedAt: row.approved_at || null,
  approvalRemarks: row.approval_remarks || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const getNextRequestNo = async (companyId) => {
  const last = await knex("loan_requests")
    .where({ company_id: companyId })
    .orderBy("id", "desc")
    .first();
  const next = Number(last?.id || 0) + 1;
  return `LR${String(next).padStart(5, "0")}`;
};

const createLoanRequest = async (req, res) => {
  const companyId = req.user?.company_id;
  if (!companyId) {
    return res.status(400).json({ message: "You are not assigned to any company" });
  }

  try {
    const employee = await resolveEmployee(req, companyId);
    if (!employee) {
      return res.status(404).json({ message: "Employee not found or access denied" });
    }

    const requestType = normalizeRequestType(req.body.request_type || req.body.requestType);
    const amount = roundTo2(req.body.amount || req.body.loanAmount);
    const tenureMonths = Math.floor(toNumber(req.body.tenure_months || req.body.tenureMonths));
    const recoveryStartMonth = normalizeMonth(
      req.body.recovery_start_month || req.body.recoveryStartMonth,
    );
    const purpose = String(req.body.purpose || req.body.reason || "").trim();
    const requestDate = req.body.request_date || req.body.requestDate || todayKey();

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Enter a valid loan amount" });
    }
    if (!tenureMonths || tenureMonths <= 0) {
      return res.status(400).json({ message: "Enter a valid tenure in months" });
    }
    if (!recoveryStartMonth) {
      return res.status(400).json({ message: "Recovery start month must be YYYY-MM" });
    }
    if (!purpose) {
      return res.status(400).json({ message: "Purpose is required" });
    }

    const policyError = await validateLoanPolicy({
      companyId,
      employeeId: employee.id,
      amount,
      tenureMonths,
      requestDate,
    });
    if (policyError) {
      return res.status(400).json({ message: policyError });
    }

    const requestNo = await getNextRequestNo(companyId);
    const emiAmount = Math.ceil(amount / tenureMonths);
    const employeeName = `${employee.first_name || ""} ${employee.last_name || ""}`.trim();

    const [id] = await knex("loan_requests").insert({
      company_id: companyId,
      request_no: requestNo,
      employee_id: employee.id,
      employee_code: employee.employee_id || null,
      employee_name: employeeName,
      department_name: employee.department_name || null,
      request_type: requestType,
      amount,
      tenure_months: tenureMonths,
      emi_amount: emiAmount,
      recovery_start_month: recoveryStartMonth,
      request_date: requestDate,
      purpose,
      status: "pending",
      paid_installments: 0,
      remaining_installments: tenureMonths,
      paid_amount: 0,
      balance_amount: amount,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });

    const loan = await knex("loan_requests").where({ id, company_id: companyId }).first();

    return res.status(201).json({
      success: true,
      message: "Loan request submitted successfully",
      loan: serializeLoan(loan),
    });
  } catch (error) {
    console.error("Create loan request error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

const getLoanRequests = async (req, res) => {
  const companyId = req.user?.company_id;
  if (!companyId) {
    return res.status(400).json({ message: "You are not assigned to any company" });
  }

  try {
    let query = knex("loan_requests").where({ company_id: companyId });

    if (!isPrivilegedUser(req.user)) {
      query = query.where({ employee_id: getActorEmployeeId(req) });
    } else if (req.query.employee_id || req.query.employeeId) {
      query = query.where({
        employee_id: req.query.employee_id || req.query.employeeId,
      });
    }

    if (req.query.status) {
      query = query.where("status", String(req.query.status).toLowerCase());
    }

    const loans = await query.orderBy("created_at", "desc");
    return res.json({ success: true, loans: loans.map(serializeLoan) });
  } catch (error) {
    console.error("Get loan requests error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

const updateLoanStatus = async (req, res) => {
  const companyId = req.user?.company_id;
  const { id } = req.params;
  const status = String(req.body.status || "").toLowerCase().trim();

  if (!companyId) {
    return res.status(400).json({ message: "You are not assigned to any company" });
  }
  if (!["approved", "rejected", "disbursed", "closed"].includes(status)) {
    return res.status(400).json({ message: "Invalid loan status" });
  }

  try {
    const loan = await knex("loan_requests").where({ id, company_id: companyId }).first();
    if (!loan) {
      return res.status(404).json({ message: "Loan request not found" });
    }

    const update = {
      status,
      approval_remarks: req.body.remarks || req.body.approval_remarks || null,
      updated_at: knex.fn.now(),
    };

    if (["approved", "rejected"].includes(status)) {
      update.approved_by = getActorEmployeeId(req);
      update.approved_at = knex.fn.now();
    }

    await knex("loan_requests").where({ id, company_id: companyId }).update(update);
    const updated = await knex("loan_requests").where({ id, company_id: companyId }).first();

    return res.json({
      success: true,
      message: "Loan status updated successfully",
      loan: serializeLoan(updated),
    });
  } catch (error) {
    console.error("Update loan status error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

const addLoanRepayment = async (req, res) => {
  const companyId = req.user?.company_id;
  const { id } = req.params;
  const amount = roundTo2(req.body.amount);
  const paidOn = req.body.paid_on || req.body.paidOn || todayKey();
  const payrollMonth = normalizeMonth(req.body.payroll_month || req.body.payrollMonth);

  if (!companyId) {
    return res.status(400).json({ message: "You are not assigned to any company" });
  }
  if (!amount || amount <= 0) {
    return res.status(400).json({ message: "Enter a valid repayment amount" });
  }

  try {
    const loan = await knex("loan_requests").where({ id, company_id: companyId }).first();
    if (!loan) {
      return res.status(404).json({ message: "Loan request not found" });
    }
    if (!["approved", "disbursed"].includes(String(loan.status || "").toLowerCase())) {
      return res.status(400).json({ message: "Only approved or disbursed loans can be repaid" });
    }

    await knex.transaction(async (trx) => {
      await trx("loan_repayments").insert({
        company_id: companyId,
        loan_request_id: loan.id,
        employee_id: loan.employee_id,
        payroll_month: payrollMonth,
        paid_on: paidOn,
        amount,
        remarks: req.body.remarks || null,
        created_by: getActorEmployeeId(req),
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });

      const nextPaidAmount = roundTo2(toNumber(loan.paid_amount) + amount);
      const nextPaidInstallments = toNumber(loan.paid_installments) + 1;
      const nextBalance = Math.max(0, roundTo2(toNumber(loan.amount) - nextPaidAmount));
      const nextRemaining = Math.max(
        0,
        toNumber(loan.tenure_months) - nextPaidInstallments,
      );

      await trx("loan_requests")
        .where({ id: loan.id, company_id: companyId })
        .update({
          paid_amount: nextPaidAmount,
          paid_installments: nextPaidInstallments,
          balance_amount: nextBalance,
          remaining_installments: nextRemaining,
          status: nextBalance <= 0 ? "closed" : loan.status,
          updated_at: trx.fn.now(),
        });
    });

    const updated = await knex("loan_requests").where({ id, company_id: companyId }).first();
    return res.status(201).json({
      success: true,
      message: "Loan repayment recorded successfully",
      loan: serializeLoan(updated),
    });
  } catch (error) {
    console.error("Add loan repayment error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

module.exports = {
  createLoanRequest,
  getLoanRequests,
  updateLoanStatus,
  addLoanRepayment,
};
