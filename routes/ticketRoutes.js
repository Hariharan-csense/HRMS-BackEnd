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
const { protect, adminOnly } = require('../middleware/authMiddleware');

const router = express.Router();

// All routes require authentication
router.use(protect);

// POST /api/tickets - Create new ticket
router.post('/', createTicket);

// GET /api/tickets - Get all tickets with filters and pagination
router.get('/', getTickets);

// GET /api/tickets/users - Get users for ticket assignment
router.get('/users', getUsersForAssignment);

// GET /api/tickets/:id - Get single ticket
router.get('/:id', getTicket);

// PUT /api/tickets/:id - Update ticket
router.put('/:id', updateTicket);

// DELETE /api/tickets/:id - Delete ticket
router.delete('/:id', deleteTicket);

module.exports = router;
