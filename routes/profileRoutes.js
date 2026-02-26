// routes/profileRoutes.js
const express = require('express');
const router = express.Router();
const profilePhotoUpload = require('../middleware/profilePhotoUpload');


const { protect, adminOnly } = require('../middleware/authMiddleware');
const {
  getMyProfile,
  updateMyProfile,
  deleteMyAccountAndOrganization
} = require('../controllers/profileController');

// 🔐 All routes protected by token
router.use(protect);

// GET my profile (token based)
router.get('/me', getMyProfile);

// UPDATE my profile (token based)

router.put(
  '/me',
  protect,
  profilePhotoUpload,   // ✅ ONLY for profile
  updateMyProfile
);

// DELETE admin account + full organization data
router.delete('/me/account', protect, adminOnly, deleteMyAccountAndOrganization);

module.exports = router;
