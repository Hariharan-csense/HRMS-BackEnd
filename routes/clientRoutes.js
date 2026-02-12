const express = require('express');
const router = express.Router();
const {
  getClients,
  createClient,
  updateClient,
  deleteClient,
  getEmployeesForAssignment
} = require('../controllers/clientController');
const { protect, restrictTo} = require('../middleware/authMiddleware');

// Apply auth middleware to all routes
router.use(protect);

// GET /api/clients - Get all clients (allow all authenticated users)
router.get('/', restrictTo('admin', 'hr', 'employee', 'sales'), getClients);

// GET /api/clients/employees - Get employees for assignment (allow admin and HR)
router.get('/employees', restrictTo('admin', 'hr'));

// POST /api/clients - Create new client (admin and HR only)
router.post('/', restrictTo('admin', 'hr'), createClient);

// PUT /api/clients/:id - Update client (admin and HR only)
router.put('/:id', restrictTo('admin', 'hr'), updateClient);

// DELETE /api/clients/:id - Delete client (admin only)
router.delete('/:id', restrictTo('admin'), deleteClient);

module.exports = router;
