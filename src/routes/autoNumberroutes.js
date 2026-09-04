const express = require('express');
const router = express.Router();
const {
  getAutoNumbers,
  createAutoNumber,
  updateAutoNumber,
  deleteAutoNumber
} = require('../controllers/autoNumbercontroller');

const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");

// Apply authentication middleware first
router.use(protect);

// Apply module/action RBAC middleware
router.use(requirePermission("organization", "update", { submodule: "role_management" }));

router.get('/', getAutoNumbers);          // GET all auto numbers
router.post('/', createAutoNumber);       // POST create auto number
router.put('/:id', updateAutoNumber);     // PUT update auto number
router.delete('/:id', deleteAutoNumber);  // DELETE auto number

module.exports = router;
