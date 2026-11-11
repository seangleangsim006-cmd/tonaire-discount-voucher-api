
const {
  createQuote,
  confirmOrder,
} = require('../services/order.service');

async function quoteOrder(req, res) {
  try {
    const result = await createQuote(req.body);

    return res.status(200).json({
      success: true,
      message: 'Order quote calculated successfully',
      data: result,
    });
  } catch (error) {
    console.error('Quote error:', error.message);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode
        ? error.message
        : 'Failed to calculate order quote',
    });
  }
}

async function confirmOrderController(req, res) {
  try {
    const idempotencyKey = req.get('Idempotency-Key');

    if (!idempotencyKey || idempotencyKey.length < 10 ||
        idempotencyKey.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Valid Idempotency-Key header is required',
      });
    }

    const result = await confirmOrder({
      ...req.body,
      idempotencyKey,
    });

    return res.status(201).json({
      success: true,
      message: result.alreadyProcessed
        ? 'Order was already processed'
        : 'Order confirmed successfully',
      data: result,
    });
  } catch (error) {
    console.error('Confirm order error:', error.message);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode
        ? error.message
        : 'Failed to confirm order',
    });
  }
}

module.exports = {
  quoteOrder,
  confirmOrderController,
};
