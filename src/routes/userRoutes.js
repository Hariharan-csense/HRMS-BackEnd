const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const {protect} = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");

// Apply auth middleware to all routes
router.use(protect);

// User routes
router.get('/', requirePermission("users", "view"), userController.getUsers);
router.get('/:id', requirePermission("users", "view"), userController.getUserById);
router.post('/', requirePermission("users", "create"), userController.createUser);
router.put('/:id', requirePermission("users", "update"), userController.updateUser);
router.delete('/:id', requirePermission("users", "delete"), userController.deleteUser);

module.exports = router;
