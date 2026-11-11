
const sql = require('mssql');
require('dotenv').config();

const dbConfig = {
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,

  options: {
    encrypt: false,
    trustServerCertificate: true,
  },

  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let pool;

async function connectDatabase() {
  try {
    pool = await new sql.ConnectionPool(dbConfig).connect();

    console.log('SQL Server connected successfully!');

    return pool;
  } catch (error) {
    console.error('Database connection failed:', error.message);
    throw error;
  }
}

function getPool() {
  if (!pool) {
    throw new Error('Database is not connected');
  }

  return pool;
}

module.exports = {
  sql,
  connectDatabase,
  getPool,
};
