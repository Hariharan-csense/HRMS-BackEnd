const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/authMiddleware");
const { requirePermission } = require("../middleware/rbacMiddleware");
const {
  createPulseSurvey,
  getAdminPulseSurveys,
  getAdminPulseSurveyById,
  getAdminPulseOverview,
  getAdminPulseSurveyResponses,
  getMyPulseSurveys,
  getPulseSurveyForEmployee,
  respondPulseSurvey,
  createPulseSurveyTemplate,
  getPulseSurveyTemplates,
  updatePulseSurveyTemplate,
  deletePulseSurveyTemplate,
} = require("../controllers/pulseSurveyController");

// Admin
router.get("/admin/overview", protect, requirePermission("pulse_surveys", "view", { submodule: "dashboard" }), getAdminPulseOverview);
router.get("/admin", protect, requirePermission("pulse_surveys", "view", { submodule: "results" }), getAdminPulseSurveys);
router.get("/admin/:id", protect, requirePermission("pulse_surveys", "view", { submodule: "results" }), getAdminPulseSurveyById);
router.post("/", protect, requirePermission("pulse_surveys", "create", { submodule: "create" }), createPulseSurvey);
router.get("/admin/:id/responses", protect, requirePermission("pulse_surveys", "view", { submodule: "results" }), getAdminPulseSurveyResponses);
router.get("/templates", protect, requirePermission("pulse_surveys", "view", { submodule: "templates" }), getPulseSurveyTemplates);
router.post("/templates", protect, requirePermission("pulse_surveys", "create", { submodule: "templates" }), createPulseSurveyTemplate);
router.put("/templates/:id", protect, requirePermission("pulse_surveys", "update", { submodule: "templates" }), updatePulseSurveyTemplate);
router.delete("/templates/:id", protect, requirePermission("pulse_surveys", "delete", { submodule: "templates" }), deletePulseSurveyTemplate);

// Employee
router.get("/my", protect, requirePermission("pulse_surveys", "view", { submodule: "my_surveys" }), getMyPulseSurveys);
router.get("/:id", protect, requirePermission("pulse_surveys", "view", { submodule: "my_surveys" }), getPulseSurveyForEmployee);
router.post("/:id/respond", protect, requirePermission("pulse_surveys", "create", { submodule: "respond" }), respondPulseSurvey);

module.exports = router;
