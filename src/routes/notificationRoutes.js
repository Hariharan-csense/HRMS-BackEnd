const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");
const {
  getNotifications,
  createNotification,
  registerNotificationToken,
  unregisterNotificationToken,
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

// Save/remove this browser's Firebase Cloud Messaging token
router.post('/push-token', requirePermission("dashboard", "view"), registerNotificationToken);
router.delete('/push-token', requirePermission("dashboard", "view"), unregisterNotificationToken);

// PUT /api/notifications/:notificationId/read - Mark notification as read
// Personal notification actions should be available to anyone who can view the dashboard.
router.put('/:notificationId/read', requirePermission("dashboard", "view"), markNotificationAsRead);

// PUT /api/notifications/read-all - Mark all notifications as read
router.put('/read-all', requirePermission("dashboard", "view"), markAllNotificationsAsRead);

// DELETE /api/notifications/:notificationId - Delete notification
router.delete('/:notificationId', requirePermission("dashboard", "view"), deleteNotification);

module.exports = router;
