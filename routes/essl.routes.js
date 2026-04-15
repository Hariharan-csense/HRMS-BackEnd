const router = require('express').Router();
const {
  esslHealth,
  esslPunchTest,
  esslPunch,
} = require('../controllers/essl.controller');

router.get('/essl/health', esslHealth);
router.post('/essl/attendance/test', esslPunchTest);
router.post('/essl/attendance', esslPunch);

module.exports = router;
