const express = require("express");
const {
  getHelpdeskTickets,
  createHelpdeskTicket,
  updateHelpdeskTicket,
  getHrAssignees,
} = require("../controllers/hrHelpdeskController");
const { protect } = require("../middleware/authMiddleware");
const { requirePermission } = require("../middleware/rbacMiddleware");

const router = express.Router();

router.use(protect);

router.get("/", requirePermission("hr_helpdesk", "view"), getHelpdeskTickets);
router.post("/", requirePermission("hr_helpdesk", "create"), createHelpdeskTicket);
router.get("/assignees", requirePermission("hr_helpdesk", "view"), getHrAssignees);
router.put("/:id", requirePermission("hr_helpdesk", "update"), updateHelpdeskTicket);

module.exports = router;
