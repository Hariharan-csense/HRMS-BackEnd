const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { requireAnyPermission, requirePermission } = require("../middleware/rbacMiddleware");
const {
  getParameterReviews,
  updateParameterReviewStatus,
  saveParameterReview,
  submitParameterReviews,
} = require("../controllers/kpiParameterReviewController");
const {
  getScorecards,
  createScorecard,
  updateScorecard,
  uploadParameterAttachment,
  deleteParameterAttachment,
} = require("../controllers/kpiScorecardController");
const { getKpiReportsSummary } = require("../controllers/kpiReportsController");
const kpiAttachmentUpload = require("../middleware/kpiAttachmentUpload");

const router = express.Router();

router.get(
  "/parameter-reviews",
  protect,
  requireAnyPermission([
    { module: "kpi", action: "view", submodule: "review" },
    { module: "kpi", action: "view", submodule: "corrective_actions" },
  ]),
  getParameterReviews,
);

router.patch(
  "/parameter-reviews/:id/status",
  protect,
  requireAnyPermission([
    { module: "kpi", action: "update", submodule: "review" },
    { module: "kpi", action: "update", submodule: "corrective_actions" },
    { module: "correctiveActionPlan", action: "update" },
    { module: "corrective_actions", action: "update" },
  ]),
  updateParameterReviewStatus,
);

router.patch(
  "/parameter-reviews/:id",
  protect,
  requireAnyPermission([
    { module: "kpi", action: "update", submodule: "review" },
    { module: "kpi", action: "update", submodule: "corrective_actions" },
    { module: "correctiveActionPlan", action: "update" },
    { module: "corrective_actions", action: "update" },
  ]),
  saveParameterReview,
);

router.post(
  "/parameter-reviews/:templateId/submit",
  protect,
  requireAnyPermission([
    { module: "kpi", action: "update", submodule: "review" },
    { module: "kpi", action: "update", submodule: "corrective_actions" },
    { module: "correctiveActionPlan", action: "update" },
    { module: "corrective_actions", action: "update" },
  ]),
  submitParameterReviews,
);

router.get(
  "/scorecards",
  protect,
  requirePermission("kpi", "view", { submodule: "scorecard" }),
  getScorecards,
);

router.post(
  "/scorecards",
  protect,
  requirePermission("kpi", "create", { submodule: "scorecard" }),
  createScorecard,
);

router.patch(
  "/scorecards/:id",
  protect,
  requirePermission("kpi", "update", { submodule: "scorecard" }),
  updateScorecard,
);

router.post(
  "/scorecards/parameters/:parameterId/attachment",
  protect,
  requirePermission("kpi", "update", { submodule: "scorecard" }),
  kpiAttachmentUpload,
  uploadParameterAttachment,
);

router.delete(
  "/scorecards/parameters/:parameterId/attachment",
  protect,
  requirePermission("kpi", "update", { submodule: "scorecard" }),
  deleteParameterAttachment,
);

router.get(
  "/reports/summary",
  protect,
  requirePermission("kpi", "view", { submodule: "reports" }),
  getKpiReportsSummary,
);

module.exports = router;

