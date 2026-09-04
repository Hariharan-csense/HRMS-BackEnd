const express = require('express');
const router = express.Router();
//const fiscalYearController = require('../controllers/fiscalYearController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");
const {
  getAllFiscalYears,
  getFiscalYearById,
  createFiscalYear,
  updateFiscalYear,
  deleteFiscalYear
} = require('../controllers/fiscalYearController');
router.get('/', protect, requirePermission("leave", "view", { submodule: "config" }), getAllFiscalYears);
router.get('/:id', protect, requirePermission("leave", "view", { submodule: "config" }), getFiscalYearById);
router.post('/', protect, requirePermission("leave", "create", { submodule: "config" }), createFiscalYear);
router.put('/:id', protect, requirePermission("leave", "update", { submodule: "config" }), updateFiscalYear);
router.delete('/:id', protect, requirePermission("leave", "delete", { submodule: "config" }), deleteFiscalYear);





module.exports = router;
