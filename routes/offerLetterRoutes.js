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

// Apply authentication middleware to all routes
router.use(protect);

// Offer Letters routes
router.get('/', getOfferLetters);
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
router.get('/templates', getOfferTemplates);
router.post('/templates', createOfferTemplate);
router.put('/templates/:id', updateOfferTemplate);
router.delete('/templates/:id', deleteOfferTemplate);

// Offer Letters by ID (must come after templates)
router.get('/:id', getOfferLetterById);
router.post('/', createOfferLetter);
router.put('/:id', updateOfferLetter);
router.delete('/:id', deleteOfferLetter);
router.post('/:id/send', sendOfferLetter);

module.exports = router;
