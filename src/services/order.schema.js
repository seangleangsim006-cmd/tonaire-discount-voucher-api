
const { z } = require('zod');

const orderItemSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().positive().max(100),
});

const quoteSchema = z.object({
  storeId: z.number().int().positive(),

  items: z.array(orderItemSchema)
    .min(1, 'At least one product is required')
    .max(50, 'Maximum 50 items allowed'),

  voucherCode: z.string()
    .trim()
    .min(1)
    .max(50)
    .optional(),
});
const confirmSchema = quoteSchema.extend({
  idempotencyKey: z.string().trim().min(10).max(100),
});

module.exports = {
  quoteSchema,
   confirmSchema,
};
