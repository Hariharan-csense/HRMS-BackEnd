const express = require("express");
const router = express.Router();
const { getAllShifts, createShift, updateShift, deleteShift} = require("../controllers/shiftController");
const { protect } = require("../middleware/authMiddleware");
const { requirePermission } = require("../middleware/rbacMiddleware");

router.get("/", protect, requirePermission("attendance", "view", { submodule: "shift" }), getAllShifts);
router.post("/", protect, requirePermission("attendance", "create", { submodule: "shift" }), createShift);
router.put("/:id", protect, requirePermission("attendance", "update", { submodule: "shift" }), updateShift);
router.delete("/:id", protect, requirePermission("attendance", "delete", { submodule: "shift" }), deleteShift);

module.exports = router;
