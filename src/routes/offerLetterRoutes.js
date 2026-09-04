const express = require('express');
const router = express.Router();
const {
  getOfferLetters,
  getOfferLetterById,
  createOfferLetter,
  updateOfferLetter,
  deleteOfferLetter,
  sendOfferLetter,
  getOfferTemplates,
  createOfferTemplate,
  updateOfferTemplate,
  deleteOfferTemplate
} = require('../controllers/offerLetterController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require("../middleware/rbacMiddleware");

// Apply authentication middleware to all routes
router.use(protect);

// Offer Letters routes
router.get('/', requirePermission("hr_management", "view", { submodule: "offer_letters" }), getOfferLetters);
router.get('/stats', async (req, res) => {
  try {
    const companyId = req.user.company_id;
    
    const stats = await require('../db/db')('offer_letters')
      .where('company_id', companyId)
      .select(
        require('../db/db').raw('COUNT(*) as total'),
        require('../db/db').raw('COUNT(CASE WHEN status = \'draft\' THEN 1 END) as draft'),
        require('../db/db').raw('COUNT(CASE WHEN status = \'sent\' THEN 1 END) as sent'),
        require('../db/db').raw('COUNT(CASE WHEN status = \'accepted\' THEN 1 END) as accepted'),
        require('../db/db').raw('COUNT(CASE WHEN status = \'rejected\' THEN 1 END) as rejected')
      )
      .first();

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching offer letter stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch offer letter statistics'
    });
  }
});

// Offer Templates routes (must come before /:id to avoid conflicts)
router.get('/templates', requirePermission("hr_management", "view", { submodule: "offer_letters" }), getOfferTemplates);
router.post('/templates', requirePermission("hr_management", "create", { submodule: "offer_letters" }), createOfferTemplate);
router.put('/templates/:id', requirePermission("hr_management", "update", { submodule: "offer_letters" }), updateOfferTemplate);
router.delete('/templates/:id', requirePermission("hr_management", "delete", { submodule: "offer_letters" }), deleteOfferTemplate);

// Offer Letters by ID (must come after templates)
router.get('/:id', requirePermission("hr_management", "view", { submodule: "offer_letters" }), getOfferLetterById);
router.post('/', requirePermission("hr_management", "create", { submodule: "offer_letters" }), createOfferLetter);
router.put('/:id', requirePermission("hr_management", "update", { submodule: "offer_letters" }), updateOfferLetter);
router.delete('/:id', requirePermission("hr_management", "delete", { submodule: "offer_letters" }), deleteOfferLetter);
router.post('/:id/send', requirePermission("hr_management", "approve", { submodule: "offer_letters" }), sendOfferLetter);

module.exports = router;
