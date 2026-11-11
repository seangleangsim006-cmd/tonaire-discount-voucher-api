# Tonaire Technical Assessment – Backend

A RESTful API for managing orders, vouchers, discount calculations, and voucher redemptions.

This project was developed as part of the **Junior Flutter & Backend Developer Technical Assessment** for Tonaire Digital Co., Ltd.

## 1. Technology Stack

| Technology | Purpose |
|---|---|
| Node.js | Backend runtime |
| Express.js | REST API framework |
| Microsoft SQL Server 2022 | Relational database |
| mssql | SQL Server database driver |
| decimal.js | Accurate monetary calculations |
| dotenv | Environment variable management |
| Docker | Local SQL Server environment |
| Postman / REST Client | API testing |

## 2. Project Structure

```text
backend/
├── src/
│   ├── config/
│   │   └── database.js
│   ├── controllers/
│   │   └── order.controller.js
│   ├── routes/
│   │   └── order.routes.js
│   ├── services/
│   │   └── order.service.js
│   ├── app.js
│   └── server.js
├── .env
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## 3. Main Features

- Calculate order subtotal, voucher discount, and final total.
- Validate voucher activation, validity dates, store eligibility, and usage limits.
- Confirm orders and save order details.
- Record voucher redemption history.
- Use database transactions to maintain data consistency.
- Use atomic SQL updates to prevent exceeding voucher usage limits.
- Support idempotent order confirmation using the `Idempotency-Key` header.
- Use parameterized SQL queries to reduce SQL injection risks.

## 4. Database Design

Database name: `TonaireAssessmentDB`

The system uses six main tables:

| Table | Description |
|---|---|
| Stores | Stores or merchants |
| Products | Products belonging to stores |
| Vouchers | Voucher and discount information |
| Orders | Confirmed customer orders |
| OrderItems | Products and quantities in each order |
| VoucherRedemptions | Voucher redemption history |

### Database Relationships

- One Store has many Products.
- One Store has many Orders.
- One Order has many OrderItems.
- One Product can appear in many OrderItems.
- One Voucher can have many VoucherRedemptions.
- One Order can have at most one VoucherRedemption.

## 5. Installation and Setup

### Prerequisites

- Node.js and npm
- Docker Desktop
- Microsoft SQL Server 2022
- Postman or another API testing tool

### Step 1: Clone or open the project

```bash
cd D:/sim/Tonaire/backend
```

### Step 2: Install dependencies

```bash
npm install
```

### Step 3: Configure environment variables

Create a `.env` file in the project root.

```env
PORT=your_port

DB_SERVER=your_server
DB_PORT=your_port
DB_USER=your_username
DB_PASSWORD=your_password
DB_DATABASE=your_database_name

```

Replace the password with your own local SQL Server password.

**Important:** Never commit `.env` or database credentials to GitHub.

### Step 4: Start SQL Server

If the Docker container has already been created:

```bash
docker start tonaire-sql
```

Check its status:

```bash
docker ps
```

SQL Server should be accessible on port `1433`.

### Step 5: Start the backend

Use the development script configured in `package.json`, if available:

```bash
npm run dev
```

Otherwise, start the application with:

```bash
node src/server.js
```

Expected server address:

```text
http://localhost:3001
```

## 6. API Endpoints

Base URL:

```text
http://localhost:3001/api/v1
```

### Health Check

**GET** `/health`

Checks API and database connectivity.

Example response:

```json
{
  "success": true,
  "message": "API and SQL Server are connected",
  "data": {
    "status": 1,
    "databaseName": "TonaireAssessmentDB"
  }
}
```

### Calculate Order Quote

**POST** `/orders/quote`

Calculates the order subtotal, discount, and final total without creating an order or consuming a voucher redemption.

Request:

```json
{
  "storeId": 1,
  "items": [
    {
      "productId": 1,
      "quantity": 2
    }
  ],
  "voucherCode": "COFFEE10"
}
```

Example response:

```json
{
  "success": true,
  "message": "Order quote calculated successfully",
  "data": {
    "subtotal": 7,
    "discountAmount": 0.7,
    "total": 6.3,
    "voucherCode": "COFFEE10"
  }
}
```

### Confirm Order

**POST** `/orders/confirm`

Confirms an order and stores the order, order items, and voucher redemption when applicable.

Request headers:

```http
Content-Type: application/json
Idempotency-Key: unique-order-request-001
```

Request body:

```json
{
  "storeId": 1,
  "items": [
    {
      "productId": 1,
      "quantity": 2
    }
  ],
  "voucherCode": "COFFEE10"
}
```

Example response:

```json
{
  "success": true,
  "message": "Order confirmed successfully",
  "data": {
    "orderId": 1,
    "subtotal": 7,
    "discountAmount": 0.7,
    "total": 6.3,
    "voucherCode": "COFFEE10",
    "status": "CONFIRMED",
    "alreadyProcessed": false
  }
}
```

## 7. Voucher Validation Rules

A voucher must satisfy these conditions:

1. The voucher must be active.
2. The current UTC time must be within its validity period.
3. The voucher must be valid for the requested store, or available globally.
4. The voucher must not exceed its usage limit.
5. The discount must not exceed the order subtotal.

### Supported Discount Types

- `PERCENTAGE`: Calculates a percentage discount.
- `FIXED`: Applies a fixed monetary discount.

### Usage Limit

- `UsageLimit = NULL`: Unlimited redemptions.
- `RedeemedCount < UsageLimit`: Redemption is available.
- `RedeemedCount >= UsageLimit`: Voucher is unavailable.

## 8. Transaction and Concurrency Handling

Order confirmation uses a SQL Server database transaction.

The confirmation process:

1. Begin transaction.
2. Check the idempotency key.
3. Validate products and voucher.
4. Atomically update the voucher redemption counter.
5. Insert the order.
6. Insert order items.
7. Insert voucher redemption history.
8. Commit the transaction.

If an operation fails, the transaction is rolled back.

### Preventing Concurrent Over-Redemption

The backend uses a conditional SQL update:

```sql
UPDATE dbo.Vouchers
SET RedeemedCount = RedeemedCount + 1
OUTPUT INSERTED.VoucherId
WHERE VoucherId = @VoucherId
  AND IsActive = 1
  AND (UsageLimit IS NULL OR RedeemedCount < UsageLimit);
```

Only a request that successfully updates the voucher can proceed with redemption.

This prevents two concurrent requests from consuming the same final available redemption.

## 9. Error Handling

| HTTP Status | Description |
|---|---|
| 200 | Request successful or existing order returned |
| 201 | Order created successfully |
| 400 | Invalid request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Resource not found |
| 409 | Voucher conflict or duplicate request conflict |
| 422 | Business validation error |
| 500 | Internal server error |

## 10. Testing

The following tests were performed in the local development environment:

| Test | Result |
|---|---|
| SQL Server database connection | Passed |
| Health Check API | Passed |
| Order Quote API | Passed |
| Order Confirmation API | Passed |
| Idempotency retry with the same key and payload | Passed |
| Concurrent final-redemption test | Not yet verified |
| Forced database failure and rollback test | Not yet verified |

## 11. Security Considerations

For production deployment, the following protections should be implemented or verified:

- JWT authentication middleware.
- Store-level authorization based on the authenticated user.
- HTTPS for API communication.
- Request validation and input sanitization.
- Parameterized SQL queries.
- Secure environment variable management.
- Idempotency key validation and request-payload matching.
- Rate limiting and appropriate logging.

**Current prototype limitation:** Authentication and store authorization are part of the proposed architecture but are not yet implemented in the current API prototype. Do not treat the prototype as production-ready.

## 12. Important Notes

- All sample data is fictional.
- Monetary values use `DECIMAL(19,2)` in SQL Server.
- Backend calculations use `decimal.js`.
- The backend is intended to be consumed by a Flutter POS application.
- The project was developed and tested locally.
- Concurrency and forced rollback scenarios are design requirements that still need additional verification.

