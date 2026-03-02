const express = require('express');
const router = express.Router();
const settlementController = require('../controllers/settlementController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission, requireAnyPermission } = require("../middleware/rbacMiddleware");

// Apply authentication middleware to all routes
router.use(protect);

// Settlement CRUD operations
router.get('/', requirePermission("exit", "view", { submodule: "settlement" }), settlementController.getAllSettlements);
router.get('/employees', requirePermission("exit", "view", { submodule: "settlement" }), settlementController.getEmployeesForSettlement);
router.get('/:id', requirePermission("exit", "view", { submodule: "settlement" }), settlementController.getSettlementById);
router.post('/', requirePermission("exit", "create", { submodule: "settlement" }), settlementController.createSettlement);
router.put('/:id', requirePermission("exit", "update", { submodule: "settlement" }), settlementController.updateSettlement);

// Settlement workflow operations
router.post('/:id/calculate', requirePermission("exit", "update", { submodule: "settlement" }), settlementController.calculateSettlement);
router.post('/:id/approve', requirePermission("exit", "approve", { submodule: "settlement" }), settlementController.approveSettlement);
router.post('/:id/reject', requireAnyPermission([{ module: "exit", submodule: "settlement", action: "reject" }, { module: "exit", submodule: "settlement", action: "approve" }]), settlementController.rejectSettlement);

// Settlement reports
router.get('/:id/download', requirePermission("exit", "view", { submodule: "settlement" }), settlementController.downloadSettlementReport);

// Settlement email
router.post('/send-email', requirePermission("exit", "update", { submodule: "settlement" }), settlementController.sendSettlementEmail);

module.exports = router;
