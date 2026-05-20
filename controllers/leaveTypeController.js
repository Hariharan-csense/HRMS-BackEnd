const knex = require("../db/db");
const {
  backfillLeaveBalancesForLeaveType,
} = require("../services/leaveBalanceService");

exports.createLeaveType = async (req, res) => {
  try {
    const companyId = req.user.company_id;

    const {
      name,
      is_paid,
      annual_limit,
      carry_forward,
      encashable,
      description,
    } = req.body;

    if (!name) {
      return res.status(400).json({
        message: "name is required",
      });
    }

    const normalizedName = String(name).trim();

    if (!normalizedName) {
      return res.status(400).json({
        message: "Leave type name is required",
      });
    }

    const existingLeaveType = await knex("leave_types")
      .where({ company_id: companyId })
      .whereRaw("LOWER(TRIM(name)) = ?", [normalizedName.toLowerCase()])
      .first();

    if (existingLeaveType) {
      return res.status(409).json({
        message: `Leave type "${normalizedName}" already exists for this company`,
      });
    }

    const normalizedAnnualLimit =
      annual_limit === undefined || annual_limit === null || annual_limit === ""
        ? 0
        : Number(annual_limit);

    if (!Number.isFinite(normalizedAnnualLimit) || normalizedAnnualLimit < 0) {
      return res.status(400).json({
        message: "annual_limit must be a valid non-negative number",
      });
    }

    const lastLeaveType = await knex("leave_types")
      .where({ company_id: companyId })
      .orderBy("id", "desc")
      .first();

    let nextNumber = 1;
    if (lastLeaveType && lastLeaveType.leave_type_id) {
      const match = lastLeaveType.leave_type_id.match(/LVT(\d+)/);
      if (match) {
        nextNumber = parseInt(match[1]) + 1;
      }
    }

    const leaveTypeId = `LVT${nextNumber.toString().padStart(3, "0")}`;

    const [newLeaveTypeId] = await knex("leave_types").insert({
      company_id: companyId,
      leave_type_id: leaveTypeId,
      name: normalizedName,
      is_paid: is_paid ?? 1,
      annual_limit: normalizedAnnualLimit,
      carry_forward: carry_forward ?? 0,
      encashable: encashable ?? 0,
      description: description ?? null,
      status: "active",
    });

    try {
      const backfillResult = await backfillLeaveBalancesForLeaveType(
        companyId,
        newLeaveTypeId,
      );
      console.log(
        `Leave balance backfill completed for leave type ${leaveTypeId} - employees: ${backfillResult.employeesProcessed}, inserted: ${backfillResult.inserted}`,
      );
    } catch (backfillError) {
      console.error(
        `Leave balance backfill failed for leave type ${leaveTypeId}:`,
        backfillError,
      );
    }

    return res.status(201).json({
      message: "Leave type created successfully",
      leave_type_id: leaveTypeId,
    });
  } catch (error) {
    console.error(error);

    if (error?.code === "ER_DUP_ENTRY" || error?.errno === 1062) {
      return res.status(409).json({
        message: "This leave type already exists for this company",
      });
    }

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

exports.updateLeaveTypeById = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const id = Number(req.params.id);
    const currentYear = new Date().getFullYear();

    const {
      name,
      is_paid,
      annual_limit,
      carry_forward,
      encashable,
      description,
      status,
    } = req.body;

    const leaveType = await knex("leave_types").where({ id }).first();

    if (!leaveType) {
      return res.status(404).json({
        message: "Leave type not found",
      });
    }

    if (leaveType.company_id !== companyId) {
      return res.status(403).json({
        message: "Unauthorized to update this leave type",
      });
    }

    const normalizedName =
      name === undefined || name === null
        ? leaveType.name
        : String(name).trim();

    if (!normalizedName) {
      return res.status(400).json({
        message: "Leave type name is required",
      });
    }

    const duplicateLeaveType = await knex("leave_types")
      .where({ company_id: companyId })
      .whereRaw("LOWER(TRIM(name)) = ?", [normalizedName.toLowerCase()])
      .whereNot({ id })
      .first();

    if (duplicateLeaveType) {
      return res.status(409).json({
        message: `Leave type "${normalizedName}" already exists for this company`,
      });
    }

    await knex("leave_types").where({ id }).update({
      name: normalizedName,
      is_paid,
      annual_limit,
      carry_forward,
      encashable,
      description,
      status,
      updated_at: knex.fn.now(),
    });

    if (annual_limit !== undefined) {
      const hasTotalColumn = await knex.schema.hasColumn(
        "leave_balances",
        "total",
      );
      const balances = await knex("leave_balances")
        .where({
          company_id: companyId,
          leave_type_id: id,
          year: currentYear,
        })
        .select("id", "availed");

      const nextTotal = Number(annual_limit) || 0;

      for (const balance of balances) {
        const availed = Number(balance.availed) || 0;
        const updatePayload = {
          opening_balance: nextTotal,
          available: Math.max(nextTotal - availed, 0),
          updated_at: knex.fn.now(),
        };

        if (hasTotalColumn) {
          updatePayload.total = nextTotal;
        }

        await knex("leave_balances")
          .where({ id: balance.id })
          .update(updatePayload);
      }
    }

    try {
      const backfillResult = await backfillLeaveBalancesForLeaveType(
        companyId,
        id,
      );
      console.log(
        `Leave balance sync completed for leave type ${id} - employees: ${backfillResult.employeesProcessed}, inserted: ${backfillResult.inserted}`,
      );
    } catch (backfillError) {
      console.error(
        `Leave balance sync failed for leave type ${id}:`,
        backfillError,
      );
    }

    return res.status(200).json({
      message: "Leave type updated successfully",
    });
  } catch (error) {
    console.error(error);

    if (error?.code === "ER_DUP_ENTRY" || error?.errno === 1062) {
      return res.status(409).json({
        message: "This leave type already exists for this company",
      });
    }

    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

exports.deleteLeaveTypeById = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const id = Number(req.params.id);

    const leaveType = await knex("leave_types").where({ id }).first();

    if (!leaveType) {
      return res.status(404).json({
        message: "Leave type not found",
      });
    }

    if (leaveType.company_id !== companyId) {
      return res.status(403).json({
        message: "Unauthorized to delete this leave type",
      });
    }

    const linkedApplications = await knex("leave_applications")
      .where({ company_id: companyId, leave_type_id: id })
      .count({ count: "*" })
      .first();

    if (Number(linkedApplications?.count || 0) > 0) {
      return res.status(400).json({
        message:
          "This leave type is already used in leave applications and cannot be deleted",
      });
    }

    await knex("leave_types").where({ id, company_id: companyId }).del();

    return res.status(200).json({
      message: "Leave type deleted successfully",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};
