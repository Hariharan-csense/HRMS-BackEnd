const express = require("express");
const { sendAiAssistantMessage } = require("../controllers/aiAssistantController");
const { protect } = require("../middleware/authMiddleware");
const { requirePermission } = require("../middleware/rbacMiddleware");

const router = express.Router();

router.use(protect);

router.post(
  "/chat",
  requirePermission("ai_assistant", "create"),
  sendAiAssistantMessage,
);

module.exports = router;
