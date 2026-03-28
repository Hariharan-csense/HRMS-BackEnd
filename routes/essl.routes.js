const router = require('express').Router();
const { esslPunch } = require('../controllers/essl.controller');

router.post('/essl/attendance', esslPunch);

module.exports = router;
