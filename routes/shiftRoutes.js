const express = require("express");
const router = express.Router();
const { getAllShifts, createShift, updateShift, deleteShift} = require("../controllers/shiftController");
const { protect } = require("../middleware/authMiddleware");
const { requirePermission } = require("../middleware/rbacMiddleware");

router.get("/", protect, requirePermission("shift_management", "view"), getAllShifts);
router.post("/", protect, requirePermission("shift_management", "create"), createShift);
router.put("/:id", protect, requirePermission("shift_management", "update"), updateShift);
router.delete("/:id", protect, requirePermission("shift_management", "delete"), deleteShift);

module.exports = router;
