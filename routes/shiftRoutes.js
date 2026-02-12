const express = require("express");
const router = express.Router();
const { getAllShifts, createShift, updateShift, deleteShift} = require("../controllers/shiftController");
const { protect, adminOnly } = require("../middleware/authMiddleware");

router.get("/", protect, getAllShifts);
router.post("/", protect, adminOnly, createShift);
router.put("/:id", protect, adminOnly, updateShift);
router.delete("/:id", protect, adminOnly, deleteShift);

module.exports = router;