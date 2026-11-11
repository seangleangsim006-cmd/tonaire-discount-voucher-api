
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const { getPool } = require('./config/database');
const orderRoutes = require('./routes/order.routes');

const app = express();

// Global middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/v1/health', async (req, res) => {
  try {
    const pool = getPool();

    const result = await pool.request().query(`
      SELECT
        1 AS status,
        DB_NAME() AS databaseName
    `);

    return res.status(200).json({
      success: true,
      message: 'API and SQL Server are connected',
      data: result.recordset[0],
    });
  } catch (error) {
    console.error('Health check error:', error.message);

    return res.status(500).json({
      success: false,
      message: 'Database health check failed',
    });
  }
});

// API routes
app.use('/api/v1/orders', orderRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

module.exports = app;
