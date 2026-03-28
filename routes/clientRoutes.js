const express = require('express');
const router = express.Router();
const {
  getClients,
  createClient,
  updateClient,
  deleteClient,
  getEmployeesForAssignment
} = require('../controllers/clientController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");

// Apply auth middleware to all routes
router.use(protect);

// GET /api/clients - Get all clients (allow all authenticated users)
router.get('/', requirePermission("my_clients", "view"), getClients);

// GET /api/clients/employees - Get employees for assignment (allow admin and HR)
router.get('/employees', requirePermission("my_clients", "view"), getEmployeesForAssignment);

// POST /api/clients - Create new client (admin and HR only)
router.post('/', requirePermission("my_clients", "create"), createClient);

// PUT /api/clients/:id - Update client (admin and HR only)
router.put('/:id', requirePermission("my_clients", "update"), updateClient);

// DELETE /api/clients/:id - Delete client (admin only)
router.delete('/:id', requirePermission("my_clients", "delete"), deleteClient);

module.exports = router;
