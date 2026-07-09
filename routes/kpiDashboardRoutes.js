const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { requirePermission } = require("../middleware/rbacMiddleware");
const { getKpiDashboardWidgets } = require("../controllers/kpiDashboardController");

const router = express.Router();

router.get(
  "/widgets",
  protect,
  requirePermission("kpi", "view", { submodule: "dashboard" }),
  getKpiDashboardWidgets,
);

module.exports = router;
