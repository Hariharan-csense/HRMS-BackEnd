const db = require("../db/db");
const { v4: uuidv4 } = require("uuid");
const { generateAutoNumber } = require("../utils/generateAutoNumber");

/**
 * GET all shifts
 */
exports.getAllShifts = async (req, res) => {
  try {
    const shifts = await db("shifts").orderBy("created_at", "desc");

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

    /* 🔥 AUTO GENERATE SHIFT CODE */
    const shiftCode = await generateAutoNumber(companyId, "shift");

    await db("shifts").insert({
      shift_code: shiftCode,
      name,
      start_time: startTime,
      end_time: endTime,
      grace_period: gracePeriod,
      half_day_threshold: halfDayThreshold,
      ot_eligible: otEligible ?? true,
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

    await db("shifts").where({ id }).del();

    res.json({
      success: true,
      message: "Shift deleted successfully",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
