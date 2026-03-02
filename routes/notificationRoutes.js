const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");
const {
  getNotifications,
  createNotification,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification
} = require('../controllers/notificationController');

const router = express.Router();

// Apply authentication middleware to all routes
router.use(protect);

// GET /api/notifications - Get all notifications for authenticated user
router.get('/', requirePermission("dashboard", "view"), getNotifications);

// POST /api/notifications - Create a new notification
router.post('/', requirePermission("dashboard", "create"), createNotification);

// PUT /api/notifications/:notificationId/read - Mark notification as read
router.put('/:notificationId/read', requirePermission("dashboard", "update"), markNotificationAsRead);

// PUT /api/notifications/read-all - Mark all notifications as read
router.put('/read-all', requirePermission("dashboard", "update"), markAllNotificationsAsRead);

// DELETE /api/notifications/:notificationId - Delete notification
router.delete('/:notificationId', requirePermission("dashboard", "delete"), deleteNotification);

module.exports = router;
