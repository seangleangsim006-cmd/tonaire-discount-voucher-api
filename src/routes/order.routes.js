
const express = require('express');

const {
  quoteOrder,
  confirmOrderController,
} = require('../controllers/order.controller');

const router = express.Router();

router.post('/quote', quoteOrder);
router.post('/confirm', confirmOrderController);

module.exports = router;
