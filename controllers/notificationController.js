const knex = require('../db/db');
const {
  registerPushToken,
  deactivatePushToken,
  sendPushToUsers,
} = require('../services/pushNotificationService');

const isMySqlClient = () => {
  const clientName = String(knex?.client?.config?.client || knex?.client?.dialect || "").toLowerCase();
  return clientName.includes('mysql');
};

// Get all notifications for the authenticated user
const getNotifications = async (req, res) => {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const notifications = await knex('notifications')
      .where({ user_id: userId })
      .orderBy('created_at', 'desc')
      .select('*');

    const unreadCount = await knex('notifications')
      .where({ user_id: userId, read: false })
      .count('* as count')
      .first();

    const formattedNotifications = notifications.map(notification => ({
      id: notification.id,
      type: notification.type || 'info',
      title: notification.title,
      description: notification.description,
      timestamp: notification.created_at,
      read: Boolean(notification.read),
      moduleId: notification.module_id,
      actionUrl: notification.action_url
    }));

    res.json({
      success: true,
      notifications: formattedNotifications,
      unreadCount: parseInt(unreadCount.count) || 0
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ message: 'Failed to fetch notifications' });
  }
};

// Create a new notification
const createNotification = async (req, res) => {
  try {
    const { title, description, type = 'info', moduleId, actionUrl, userId } = req.body;
    
    if (!title || !description) {
      return res.status(400).json({ message: 'Title and description are required' });
    }

    const notificationData = {
      user_id: userId || req.user?.id,
      title,
      description,
      type,
      module_id: moduleId,
      action_url: actionUrl,
      read: false,
      created_at: new Date()
    };

    let notification;

    if (isMySqlClient()) {
      const insertResult = await knex('notifications').insert(notificationData);
      const insertedId = Array.isArray(insertResult) ? insertResult[0] : insertResult;

      notification = await knex('notifications')
        .where({ id: insertedId })
        .first();
    } else {
      const insertResult = await knex('notifications')
        .insert(notificationData)
        .returning('*');

      notification = Array.isArray(insertResult) ? insertResult[0] : insertResult;
    }

    res.status(201).json({
      success: true,
      notification: {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        description: notification.description,
        timestamp: notification.created_at,
        read: Boolean(notification.read),
        moduleId: notification.module_id,
        actionUrl: notification.action_url
      }
    });

    sendPushToUsers({
      userIds: [notification.user_id],
      title: notification.title,
      body: notification.description,
      data: {
        notificationId: notification.id,
        moduleId: notification.module_id || '',
        actionUrl: notification.action_url || '',
      },
    }).catch((pushError) => {
      console.error('Notification push failed:', pushError);
    });
  } catch (error) {
    console.error('Error creating notification:', error);
    res.status(500).json({ message: 'Failed to create notification' });
  }
};

const registerNotificationToken = async (req, res) => {
  try {
    const userId = req.user?.id;
    const companyId = req.user?.company_id || null;
    const { token, platform = 'web' } = req.body || {};

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    if (!token) {
      return res.status(400).json({ message: 'FCM token is required' });
    }

    const id = await registerPushToken({
      userId,
      companyId,
      token,
      platform,
      userAgent: req.get('user-agent') || '',
    });

    return res.status(201).json({ success: true, id });
  } catch (error) {
    console.error('Error registering push token:', error);
    return res.status(500).json({ message: 'Failed to register push token' });
  }
};

const unregisterNotificationToken = async (req, res) => {
  try {
    const { token } = req.body || {};
    await deactivatePushToken(token);
    return res.json({ success: true });
  } catch (error) {
    console.error('Error unregistering push token:', error);
    return res.status(500).json({ message: 'Failed to unregister push token' });
  }
};

// Mark notification as read
const markNotificationAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    let updatedNotification;

    if (isMySqlClient()) {
      const updatedCount = await knex('notifications')
        .where({ id: notificationId, user_id: userId })
        .update({ read: true });

      if (!updatedCount) {
        return res.status(404).json({ message: 'Notification not found' });
      }

      updatedNotification = await knex('notifications')
        .where({ id: notificationId, user_id: userId })
        .first();
    } else {
      const updateResult = await knex('notifications')
        .where({ id: notificationId, user_id: userId })
        .update({ read: true })
        .returning('*');

      updatedNotification = Array.isArray(updateResult) ? updateResult[0] : updateResult;
    }

    if (!updatedNotification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ message: 'Failed to mark notification as read' });
  }
};

// Mark all notifications as read
const markAllNotificationsAsRead = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    await knex('notifications')
      .where({ user_id: userId, read: false })
      .update({ read: true });

    res.json({ success: true });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ message: 'Failed to mark all notifications as read' });
  }
};

// Delete notification
const deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const deletedCount = await knex('notifications')
      .where({ id: notificationId, user_id: userId })
      .del();

    if (deletedCount === 0) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ message: 'Failed to delete notification' });
  }
};

module.exports = {
  getNotifications,
  createNotification,
  registerNotificationToken,
  unregisterNotificationToken,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification
};
