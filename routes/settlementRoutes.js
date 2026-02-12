const express = require('express');
const router = express.Router();
const settlementController = require('../controllers/settlementController');
const { protect,adminOnly } = require('../middleware/authMiddleware');
const { adminOrHr } = require('../middleware/roleMiddleware');

// Apply authentication middleware to all routes
router.use(protect,adminOnly);

// Apply HR role middleware to all routes
router.use(adminOrHr);

// Settlement CRUD operations
router.get('/', settlementController.getAllSettlements);
router.get('/employees', settlementController.getEmployeesForSettlement);
router.get('/:id', settlementController.getSettlementById);
router.post('/', settlementController.createSettlement);
router.put('/:id', settlementController.updateSettlement);

// Settlement workflow operations
router.post('/:id/calculate', settlementController.calculateSettlement);
router.post('/:id/approve', settlementController.approveSettlement);
router.post('/:id/reject', settlementController.rejectSettlement);

// Settlement reports
router.get('/:id/download', settlementController.downloadSettlementReport);

// Settlement email
router.post('/send-email', settlementController.sendSettlementEmail);

module.exports = router;
