// backend/db.js
const { Pool } = require('pg');
require('dotenv').config();

// Standard connection configuration for PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' || process.env.DATABASE_URL?.includes('render')
    ? { rejectUnauthorized: false }
    : false
});

pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

// Helper function to initialize database tables automatically
const initDb = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Users Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Wallets Table (Stores dummy coin holdings)
    await client.query(`
      CREATE TABLE IF NOT EXISTS wallets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        usd_balance NUMERIC(15, 2) DEFAULT 10000.00,
        btc_balance NUMERIC(15, 8) DEFAULT 0.50000000,
        eth_balance NUMERIC(15, 8) DEFAULT 2.00000000,
        usdt_balance NUMERIC(15, 2) DEFAULT 500.00
      );
    `);

    // 3. Transactions Table (Logs simulated trades & transfers)
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(20) NOT NULL, -- 'BUY', 'SELL', 'TRANSFER'
        asset VARCHAR(10) NOT NULL, -- 'BTC', 'ETH', 'USDT'
        amount NUMERIC(15, 8) NOT NULL,
        total_usd NUMERIC(15, 2) NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query('COMMIT');
    console.log('PostgreSQL tables initialized successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error initializing PostgreSQL tables:', error);
  } finally {
    client.release();
  }
};

// Initialize tables on startup
initDb();

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};