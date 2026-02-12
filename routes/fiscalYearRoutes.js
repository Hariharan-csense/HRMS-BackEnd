const express = require('express');
const router = express.Router();
//const fiscalYearController = require('../controllers/fiscalYearController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const {
  getAllFiscalYears,
  getFiscalYearById,
  createFiscalYear,
  updateFiscalYear,
  deleteFiscalYear
} = require('../controllers/fiscalYearController');
router.get('/', protect,adminOnly, getAllFiscalYears);
router.get('/:id', protect,adminOnly   , getFiscalYearById);
router.post('/', protect, adminOnly, createFiscalYear);
router.put('/:id', protect, adminOnly, updateFiscalYear);
router.delete('/:id', protect, adminOnly, deleteFiscalYear);





module.exports = router;