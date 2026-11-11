
const Decimal = require('decimal.js');
const { getPool, sql } = require('../config/database');

// ==========================================
// 1. Custom Error
// ==========================================

class OrderError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'OrderError';
    this.statusCode = statusCode;
  }
}

// ==========================================
// 2. Helper Functions
// ==========================================

function aggregateItems(items) {
  const quantities = new Map();

  for (const item of items) {
    const quantity =
      (quantities.get(item.productId) || 0) + item.quantity;

    if (quantity > 100) {
      throw new OrderError(
        'Combined product quantity cannot exceed 100',
        400
      );
    }

    quantities.set(item.productId, quantity);
  }

  return Array.from(quantities, ([productId, quantity]) => ({
    productId,
    quantity,
  }));
}

function isUniqueViolation(error) {
  return error.number === 2627 || error.number === 2601;
}

function formatOrder(order) {
  return {
    orderId: order.OrderId,
    subtotal: Number(order.Subtotal),
    discountAmount: Number(order.DiscountAmount),
    total: Number(order.Total),
    voucherCode: order.VoucherCode ?? null,
    status: 'CONFIRMED',
  };
}

// Find an existing order using Idempotency Key
async function findExistingOrder(pool, idempotencyKey) {
  const result = await pool.request()
    .input(
      'IdempotencyKey',
      sql.NVarChar(100),
      idempotencyKey
    )
    .query(`
      SELECT
        o.OrderId,
        o.Subtotal,
        o.DiscountAmount,
        o.Total,
        o.CreatedAt,
        v.Code AS VoucherCode
      FROM dbo.Orders o
      LEFT JOIN dbo.VoucherRedemptions vr
        ON vr.OrderId = o.OrderId
      LEFT JOIN dbo.Vouchers v
        ON v.VoucherId = vr.VoucherId
      WHERE o.IdempotencyKey = @IdempotencyKey
    `);

  return result.recordset[0] || null;
}

// ==========================================
// 3. Create Quote
// ==========================================

async function createQuote(data) {
  const pool = getPool();

  // Combine duplicate product IDs
  const items = aggregateItems(data.items);

  // Get products from SQL Server
  const productRequest = pool.request()
    .input('StoreId', sql.Int, data.storeId);

  const productParams = items.map((item, index) => {
    productRequest.input(
      `ProductId${index}`,
      sql.Int,
      item.productId
    );

    return `@ProductId${index}`;
  });

  const productsResult = await productRequest.query(`
    SELECT
      ProductId,
      ProductName,
      CAST(Price AS VARCHAR(50)) AS Price
    FROM dbo.Products
    WHERE StoreId = @StoreId
      AND ProductId IN (${productParams.join(', ')})
  `);

  const products = productsResult.recordset;

  if (products.length !== items.length) {
    throw new OrderError(
      'One or more products are invalid',
      422
    );
  }

  // Calculate subtotal
  let subtotal = new Decimal(0);

  for (const item of items) {
    const product = products.find(
      (p) => p.ProductId === item.productId
    );

    subtotal = subtotal.plus(
      new Decimal(product.Price).times(item.quantity)
    );
  }

  subtotal = subtotal.toDecimalPlaces(
    2,
    Decimal.ROUND_HALF_UP
  );

  // Validate voucher
  let discountAmount = new Decimal(0);
  let voucher = null;

  if (data.voucherCode) {
    const voucherResult = await pool.request()
      .input('Code', sql.NVarChar(50), data.voucherCode)
      .input('StoreId', sql.Int, data.storeId)
      .query(`
        SELECT TOP 1
          VoucherId,
          Code,
          DiscountType,
          CAST(DiscountValue AS VARCHAR(50)) AS DiscountValue
        FROM dbo.Vouchers
        WHERE Code = @Code
          AND IsActive = 1
          AND StartsAt <= SYSUTCDATETIME()
          AND SYSUTCDATETIME() < ExpiresAt
          AND (StoreId IS NULL OR StoreId = @StoreId)
          AND (
            UsageLimit IS NULL
            OR RedeemedCount < UsageLimit
          )
      `);

    if (voucherResult.recordset.length === 0) {
      throw new OrderError(
        'Voucher is invalid or unavailable',
        422
      );
    }

    voucher = voucherResult.recordset[0];

    const value = new Decimal(voucher.DiscountValue);

    if (voucher.DiscountType === 'PERCENTAGE') {
      discountAmount = subtotal
        .times(value)
        .dividedBy(100);
    } else {
      discountAmount = value;
    }

    if (discountAmount.greaterThan(subtotal)) {
      discountAmount = subtotal;
    }

    discountAmount = discountAmount.toDecimalPlaces(
      2,
      Decimal.ROUND_HALF_UP
    );
  }

  const total = subtotal.minus(discountAmount);

  return {
    subtotal: Number(subtotal.toFixed(2)),
    discountAmount: Number(discountAmount.toFixed(2)),
    total: Number(total.toFixed(2)),
    voucherCode: voucher?.Code ?? null,
  };
}

// ==========================================
// 4. Confirm Order
// ==========================================

async function confirmOrder(data) {
  const pool = getPool();
  const transaction = new sql.Transaction(pool);

  let transactionStarted = false;
  let transactionFinished = false;

  try {
    // 1. Start transaction
    await transaction.begin(
      sql.ISOLATION_LEVEL.READ_COMMITTED
    );

    transactionStarted = true;

    // 2. Check Idempotency Key
    const existingRequest = await new sql.Request(transaction)
      .input(
        'IdempotencyKey',
        sql.NVarChar(100),
        data.idempotencyKey
      )
      .query(`
        SELECT
          o.OrderId,
          o.Subtotal,
          o.DiscountAmount,
          o.Total,
          v.Code AS VoucherCode
        FROM dbo.Orders o
        LEFT JOIN dbo.VoucherRedemptions vr
          ON vr.OrderId = o.OrderId
        LEFT JOIN dbo.Vouchers v
          ON v.VoucherId = vr.VoucherId
        WHERE o.IdempotencyKey = @IdempotencyKey
      `);

    if (existingRequest.recordset.length > 0) {
      const existingOrder = existingRequest.recordset[0];

      await transaction.commit();
      transactionFinished = true;

      return {
        ...formatOrder(existingOrder),
        alreadyProcessed: true,
      };
    }

    // 3. Aggregate duplicate products
    const items = aggregateItems(data.items);

    // 4. Get products inside transaction
    const productRequest = new sql.Request(transaction)
      .input('StoreId', sql.Int, data.storeId);

    const productParams = items.map((item, index) => {
      productRequest.input(
        `ProductId${index}`,
        sql.Int,
        item.productId
      );

      return `@ProductId${index}`;
    });

    const productsResult = await productRequest.query(`
      SELECT
        ProductId,
        ProductName,
        CAST(Price AS VARCHAR(50)) AS Price
      FROM dbo.Products
      WHERE StoreId = @StoreId
        AND ProductId IN (${productParams.join(', ')})
    `);

    const products = productsResult.recordset;

    if (products.length !== items.length) {
      throw new OrderError(
        'One or more products are invalid',
        422
      );
    }

    // 5. Calculate subtotal
    let subtotal = new Decimal(0);

    for (const item of items) {
      const product = products.find(
        (p) => p.ProductId === item.productId
      );

      subtotal = subtotal.plus(
        new Decimal(product.Price).times(item.quantity)
      );
    }

    subtotal = subtotal.toDecimalPlaces(
      2,
      Decimal.ROUND_HALF_UP
    );

    // 6. Atomic voucher validation and usage increment
    let discountAmount = new Decimal(0);
    let voucher = null;

    if (data.voucherCode) {
      const voucherResult = await new sql.Request(transaction)
        .input(
          'Code',
          sql.NVarChar(50),
          data.voucherCode
        )
        .input('StoreId', sql.Int, data.storeId)
        .query(`
          UPDATE dbo.Vouchers
          SET RedeemedCount = RedeemedCount + 1
          OUTPUT
            INSERTED.VoucherId,
            INSERTED.Code,
            INSERTED.DiscountType,
            CAST(INSERTED.DiscountValue AS VARCHAR(50))
              AS DiscountValue
          WHERE Code = @Code
            AND IsActive = 1
            AND StartsAt <= SYSUTCDATETIME()
            AND SYSUTCDATETIME() < ExpiresAt
            AND (StoreId IS NULL OR StoreId = @StoreId)
            AND (
              UsageLimit IS NULL
              OR RedeemedCount < UsageLimit
            )
        `);

      if (voucherResult.recordset.length === 0) {
        throw new OrderError(
          'Voucher is invalid, expired, or unavailable',
          409
        );
      }

      voucher = voucherResult.recordset[0];

      const value = new Decimal(voucher.DiscountValue);

      if (voucher.DiscountType === 'PERCENTAGE') {
        discountAmount = subtotal
          .times(value)
          .dividedBy(100);
      } else {
        discountAmount = value;
      }

      if (discountAmount.greaterThan(subtotal)) {
        discountAmount = subtotal;
      }

      discountAmount = discountAmount.toDecimalPlaces(
        2,
        Decimal.ROUND_HALF_UP
      );
    }

    // 7. Calculate total
    const total = subtotal.minus(discountAmount);

    // 8. Insert order
    const orderResult = await new sql.Request(transaction)
      .input('StoreId', sql.Int, data.storeId)
      .input(
        'Subtotal',
        sql.Decimal(19, 2),
        subtotal.toFixed(2)
      )
      .input(
        'DiscountAmount',
        sql.Decimal(19, 2),
        discountAmount.toFixed(2)
      )
      .input(
        'Total',
        sql.Decimal(19, 2),
        total.toFixed(2)
      )
      .input(
        'IdempotencyKey',
        sql.NVarChar(100),
        data.idempotencyKey
      )
      .query(`
        INSERT INTO dbo.Orders (
          StoreId,
          Subtotal,
          DiscountAmount,
          Total,
          IdempotencyKey
        )
        OUTPUT
          INSERTED.OrderId,
          INSERTED.Subtotal,
          INSERTED.DiscountAmount,
          INSERTED.Total,
          INSERTED.CreatedAt
        VALUES (
          @StoreId,
          @Subtotal,
          @DiscountAmount,
          @Total,
          @IdempotencyKey
        )
      `);

    const order = orderResult.recordset[0];
    const orderId = order.OrderId;

    // 9. Insert order items
    for (const item of items) {
      const product = products.find(
        (p) => p.ProductId === item.productId
      );

      await new sql.Request(transaction)
        .input('OrderId', sql.Int, orderId)
        .input('ProductId', sql.Int, item.productId)
        .input('Quantity', sql.Int, item.quantity)
        .input(
          'UnitPrice',
          sql.Decimal(19, 2),
          product.Price
        )
        .query(`
          INSERT INTO dbo.OrderItems (
            OrderId,
            ProductId,
            Quantity,
            UnitPrice
          )
          VALUES (
            @OrderId,
            @ProductId,
            @Quantity,
            @UnitPrice
          )
        `);
    }

    // 10. Insert voucher redemption
    if (voucher) {
      await new sql.Request(transaction)
        .input(
          'VoucherId',
          sql.Int,
          voucher.VoucherId
        )
        .input('OrderId', sql.Int, orderId)
        .query(`
          INSERT INTO dbo.VoucherRedemptions (
            VoucherId,
            OrderId
          )
          VALUES (
            @VoucherId,
            @OrderId
          )
        `);
    }

    // 11. Commit all database changes
    await transaction.commit();
    transactionFinished = true;

    return {
      orderId,
      subtotal: Number(subtotal.toFixed(2)),
      discountAmount: Number(discountAmount.toFixed(2)),
      total: Number(total.toFixed(2)),
      voucherCode: voucher?.Code ?? null,
      status: 'CONFIRMED',
      alreadyProcessed: false,
    };

  } catch (error) {
    // 12. Rollback if anything fails
    if (transactionStarted && !transactionFinished) {
      try {
        await transaction.rollback();
        transactionFinished = true;
      } catch (rollbackError) {
        console.error(
          'Transaction rollback failed:',
          rollbackError.message
        );
      }
    }

    // Handle concurrent requests using the same key
    if (isUniqueViolation(error)) {
      const existingOrder = await findExistingOrder(
        pool,
        data.idempotencyKey
      );

      if (existingOrder) {
        return {
          ...formatOrder(existingOrder),
          alreadyProcessed: true,
        };
      }
    }

    throw error;
  }
}

// ==========================================
// 5. Export Services
// ==========================================

module.exports = {
  createQuote,
  confirmOrder,
};
