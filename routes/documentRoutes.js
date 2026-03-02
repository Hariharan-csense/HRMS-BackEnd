// routes/documentRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");
const {
  getEmployeeDocuments,
  downloadDocument
} = require('../controllers/documentController');

// 🔐 All routes protected by token
router.use(protect);

// DEBUG: Get all documents (temporary)
router.get('/debug/all', async (req, res) => {
  try {
    const knex = require('../db/db');
    const allDocuments = await knex('employee_documents').select('*');
    res.json({
      success: true,
      data: allDocuments,
      employeeId: req.user.id,
      user: req.user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// GET employee documents
router.get('/', requirePermission("employees", "view", { submodule: "profile" }), getEmployeeDocuments);

// DOWNLOAD document
router.get('/:id/download', requirePermission("employees", "view", { submodule: "profile" }), downloadDocument);

module.exports = router;
