const db = require("../db/db");
const { v4: uuidv4 } = require("uuid");
const { generateAutoNumber } = require("../utils/generateAutoNumber");

const ensureShiftRosterTable = async () => {
  const exists = await db.schema.hasTable("shift_roster_assignments");
  if (exists) return;

  await db.schema.createTable("shift_roster_assignments", (table) => {
    table.increments("id").primary();
    table.integer("company_id").unsigned().notNullable();
    table.integer("employee_id").unsigned().notNullable();
    table.integer("shift_id").unsigned().nullable();
    table.date("roster_date").notNullable();
    table.string("status", 30).notNullable().defaultTo("scheduled");
    table.string("notes", 500).nullable();
    table.integer("created_by").unsigned().nullable();
    table.integer("updated_by").unsigned().nullable();
    table.timestamps(true, true);
    table.unique(
      ["company_id", "employee_id", "roster_date"],
      "shift_roster_assignments_unique",
    );
  });
};

const toDateKey = (value) => {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
};

const resolveRosterRange = (query = {}) => {
  const today = new Date();
  const start = toDateKey(query.startDate) || toDateKey(today.toISOString());
  const end = toDateKey(query.endDate) || start;
  return { start, end };
};

/**
 * GET all shifts
 */
exports.getAllShifts = async (req, res) => {
  try {
    const companyId = req.user.company_id;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: "companyId is required",
      });
    }

    const shifts = await db("shifts")
      .where("company_id", companyId)
      .orderBy("created_at", "desc");

    res.json({
      success: true,
      data: shifts.map((s) => ({
        id: s.id,
        name: s.name,
        startTime: s.start_time,
        endTime: s.end_time,
        gracePeriod: s.grace_period,
        halfDayThreshold: s.half_day_threshold,
        otEligible: s.ot_eligible,
        createdAt: s.created_at,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createShift = async (req, res) => {
  try {
    const {
      name,
      startTime,
      endTime,
      gracePeriod,
      halfDayThreshold,
      otEligible,
    } = req.body;

    const companyId = req.user.company_id;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: "companyId is required",
      });
    }

    /* 🔥 AUTO GENERATE SHIFT CODE (SHF001 format) */
    const lastShift = await db("shifts")
      .where({ company_id: companyId })
      .orderBy("id", "desc")
      .first();

    let nextNumber = 1;
    if (lastShift && lastShift.shift_code) {
      const match = lastShift.shift_code.match(/SHF(\d+)/);
      if (match) {
        nextNumber = parseInt(match[1]) + 1;
      }
    }

    const shiftCode = `SHF${nextNumber.toString().padStart(3, "0")}`;

    await db("shifts").insert({
      shift_code: shiftCode,
      name,
      start_time: startTime,
      end_time: endTime,
      grace_period: gracePeriod,
      half_day_threshold: halfDayThreshold,
      ot_eligible: otEligible ?? true,
      company_id: companyId,
    });

    res.status(201).json({
      success: true,
      message: "Shift created successfully",
      data: {
        shiftCode,
      },
    });
  } catch (error) {
    console.error("Create Shift Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
/**
 * UPDATE shift
 */
exports.updateShift = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user?.company_id;

    if (!companyId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    /* 🔍 CHECK SHIFT BELONGS TO COMPANY */
    const shift = await db("shifts")
      .where({ id, company_id: companyId })
      .first();

    if (!shift) {
      return res.status(404).json({
        success: false,
        message: "Shift not found",
      });
    }

    await db("shifts")
      .where({ id, company_id: companyId })
      .update({
        name: req.body.name,
        start_time: req.body.startTime,
        end_time: req.body.endTime,
        grace_period: req.body.gracePeriod,
        half_day_threshold: req.body.halfDayThreshold,
        ot_eligible: req.body.otEligible ?? shift.ot_eligible,
        //updated_at: db.fn.now(),
      });

    res.json({
      success: true,
      message: "Shift updated successfully",
    });
  } catch (error) {
    console.error("Update Shift Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * DELETE shift
 */
exports.deleteShift = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user?.company_id;

    if (!companyId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // Check if shift belongs to company before deleting
    const shift = await db("shifts")
      .where({ id, company_id: companyId })
      .first();

    if (!shift) {
      return res.status(404).json({
        success: false,
        message: "Shift not found",
      });
    }

    await db("shifts").where({ id, company_id: companyId }).del();

    res.json({
      success: true,
      message: "Shift deleted successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getShiftRoster = async (req, res) => {
  try {
    await ensureShiftRosterTable();
    const companyId = req.user?.company_id;
    const { start, end } = resolveRosterRange(req.query);
    const { employeeId, departmentId } = req.query;

    let query = db("employees as e")
      .leftJoin("departments as d", "e.department_id", "d.id")
      .leftJoin("shift_roster_assignments as r", function () {
        this.on("r.employee_id", "=", "e.id")
          .andOn("r.company_id", "=", "e.company_id")
          .andOn(db.raw("r.roster_date BETWEEN ? AND ?", [start, end]));
      })
      .leftJoin("shifts as rs", "r.shift_id", "rs.id")
      .leftJoin("shifts as default_shift", "e.shift_id", "default_shift.id")
      .where("e.company_id", companyId)
      .select(
        "e.id as employeeId",
        "e.employee_id as employeeCode",
        db.raw(
          "TRIM(CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,''))) as employeeName",
        ),
        "d.id as departmentId",
        "d.name as department",
        "r.id as rosterId",
        db.raw("DATE_FORMAT(r.roster_date, '%Y-%m-%d') as rosterDate"),
        "r.status",
        "r.notes",
        "rs.id as shiftId",
        "rs.name as shiftName",
        "rs.start_time as startTime",
        "rs.end_time as endTime",
        "default_shift.id as defaultShiftId",
        "default_shift.name as defaultShiftName",
      )
      .orderBy("e.first_name")
      .orderBy("r.roster_date");

    if (employeeId && employeeId !== "all") {
      query.where(function () {
        this.where("e.employee_id", employeeId);
        if (/^\d+$/.test(String(employeeId)))
          this.orWhere("e.id", Number(employeeId));
      });
    }
    if (departmentId && departmentId !== "all") {
      query.where("e.department_id", departmentId);
    }

    const rows = await query;
    const summary = rows.reduce(
      (acc, row) => {
        acc.total += 1;
        if (row.shiftId) acc.assigned += 1;
        else acc.unassigned += 1;
        return acc;
      },
      { total: 0, assigned: 0, unassigned: 0 },
    );

    res.json({ success: true, data: rows, summary });
  } catch (error) {
    console.error("Get Shift Roster Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.upsertShiftRoster = async (req, res) => {
  try {
    await ensureShiftRosterTable();
    const companyId = req.user?.company_id;
    const {
      employeeId,
      shiftId,
      rosterDate,
      status = "scheduled",
      notes = "",
    } = req.body;
    const dateKey = toDateKey(rosterDate);

    if (!employeeId || !dateKey) {
      return res.status(400).json({
        success: false,
        message: "Employee and roster date are required",
      });
    }

    const employee = await db("employees")
      .where({ id: employeeId, company_id: companyId })
      .first();
    if (!employee) {
      return res
        .status(404)
        .json({ success: false, message: "Employee not found" });
    }

    if (shiftId) {
      const shift = await db("shifts")
        .where({ id: shiftId, company_id: companyId })
        .first();
      if (!shift)
        return res
          .status(404)
          .json({ success: false, message: "Shift not found" });
    }

    const existing = await db("shift_roster_assignments")
      .where({
        company_id: companyId,
        employee_id: employeeId,
        roster_date: dateKey,
      })
      .first();

    if (existing) {
      await db("shift_roster_assignments")
        .where({ id: existing.id, company_id: companyId })
        .update({
          shift_id: shiftId || null,
          status,
          notes,
          updated_by: req.user.id,
          updated_at: db.fn.now(),
        });
    } else {
      await db("shift_roster_assignments").insert({
        company_id: companyId,
        employee_id: employeeId,
        shift_id: shiftId || null,
        roster_date: dateKey,
        status,
        notes,
        created_by: req.user.id,
        updated_by: req.user.id,
      });
    }

    res.json({ success: true, message: "Roster assignment saved" });
  } catch (error) {
    console.error("Upsert Shift Roster Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteShiftRoster = async (req, res) => {
  try {
    await ensureShiftRosterTable();
    const companyId = req.user?.company_id;
    const deleted = await db("shift_roster_assignments")
      .where({ id: req.params.id, company_id: companyId })
      .del();
    if (!deleted) {
      return res
        .status(404)
        .json({ success: false, message: "Roster assignment not found" });
    }
    res.json({ success: true, message: "Roster assignment removed" });
  } catch (error) {
    console.error("Delete Shift Roster Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
