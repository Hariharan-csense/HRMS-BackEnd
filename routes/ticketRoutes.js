// routes/ticketRoutes.js
const express = require('express');
const {
  createTicket,
  getTickets,
  getTicket,
  updateTicket,
  deleteTicket,
  getUsersForAssignment
} = require('../controllers/ticketController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");

const router = express.Router();

// All routes require authentication
router.use(protect);

// POST /api/tickets - Create new ticket
router.post('/', requirePermission("tickets", "create"), createTicket);

// GET /api/tickets - Get all tickets with filters and pagination
router.get('/', requirePermission("tickets", "view"), getTickets);

// GET /api/tickets/users - Get users for ticket assignment
router.get('/users', requirePermission("tickets", "view"), getUsersForAssignment);

// GET /api/tickets/:id - Get single ticket
router.get('/:id', requirePermission("tickets", "view"), getTicket);

// PUT /api/tickets/:id - Update ticket
router.put('/:id', requirePermission("tickets", "update"), updateTicket);

// DELETE /api/tickets/:id - Delete ticket
router.delete('/:id', requirePermission("tickets", "delete"), deleteTicket);

module.exports = router;
