const express = require("express");
const router = express.Router();
const {
  getAllShifts,
  createShift,
  updateShift,
  deleteShift,
  getShiftRoster,
  upsertShiftRoster,
  deleteShiftRoster,
} = require("../controllers/shiftController");
const { protect } = require("../middleware/authMiddleware");
const { requirePermission, requireAnyPermission } = require("../middleware/rbacMiddleware");

const shiftOrRosterPermission = (action) =>
  requireAnyPermission([
    { module: "attendance", action, submodule: "shift" },
    { module: "attendance", action, submodule: "roster" },
    { module: "shift_management", action },
  ]);

router.get("/", protect, requirePermission("attendance", "view", { submodule: "shift" }), getAllShifts);
router.post("/", protect, requirePermission("attendance", "create", { submodule: "shift" }), createShift);
router.get("/roster", protect, shiftOrRosterPermission("view"), getShiftRoster);
router.post("/roster", protect, shiftOrRosterPermission("create"), upsertShiftRoster);
router.delete("/roster/:id", protect, shiftOrRosterPermission("delete"), deleteShiftRoster);
router.put("/:id", protect, requirePermission("attendance", "update", { submodule: "shift" }), updateShift);
router.delete("/:id", protect, requirePermission("attendance", "delete", { submodule: "shift" }), deleteShift);

module.exports = router;
