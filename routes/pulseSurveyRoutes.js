const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/authMiddleware");
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
router.get("/admin/overview", protect, getAdminPulseOverview);
router.get("/admin", protect, getAdminPulseSurveys);
router.get("/admin/:id", protect, getAdminPulseSurveyById);
router.post("/", protect, createPulseSurvey);
router.get("/admin/:id/responses", protect, getAdminPulseSurveyResponses);
router.get("/templates", protect, getPulseSurveyTemplates);
router.post("/templates", protect, createPulseSurveyTemplate);
router.put("/templates/:id", protect, updatePulseSurveyTemplate);
router.delete("/templates/:id", protect, deletePulseSurveyTemplate);

// Employee
router.get("/my", protect, getMyPulseSurveys);
router.get("/:id", protect, getPulseSurveyForEmployee);
router.post("/:id/respond", protect, respondPulseSurvey);

module.exports = router;
