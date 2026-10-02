const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey123';

// Database Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/cryptowallet',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Middleware: Authenticate JWT Token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access token required.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token.' });
    req.user = user;
    next();
  });
}

// ------------------------------------------
// HEALTH & AUTH ROUTES
// ------------------------------------------

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const userRes = await pool.query(
      'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username',
      [username, hashedPassword]
    );
    const newUser = userRes.rows[0];

    // Default starting balances: $10,000 USD, 0.5 BTC, 2.0 ETH, 500 USDT
    await pool.query(
      'INSERT INTO wallets (user_id, usd_balance, btc_balance, eth_balance, usdt_balance) VALUES ($1, 10000.00, 0.5, 2.0, 500.00)',
      [newUser.id]
    );

    res.status(201).json({ message: 'User registered successfully!', user: newUser });
  } catch (err) {
    console.error(err);
    if (err.code === '23505') return res.status(400).json({ error: 'Username already taken.' });
    res.status(500).json({ error: 'Registration failed.' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const userRes = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (userRes.rows.length === 0) return res.status(400).json({ error: 'Invalid username or password.' });

    const user = userRes.rows[0];
    const validPass = await bcrypt.compare(password, user.password);
    if (!validPass) return res.status(400).json({ error: 'Invalid username or password.' });

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ message: 'Login successful!', token, user: { id: user.id, username: user.username } });
  } catch (err) {
    res.status(500).json({ error: 'Login failed.' });
  }
});

// ------------------------------------------
// WALLET ROUTES
// ------------------------------------------

// GET /api/wallet/balance
app.get('/api/wallet/balance', authenticateToken, async (req, res) => {
  try {
    const walletRes = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [req.user.userId]);
    const txRes = await pool.query(
      'SELECT * FROM transactions WHERE user_id = $1 ORDER BY timestamp DESC LIMIT 10',
      [req.user.userId]
    );

    res.json({
      wallet: walletRes.rows[0],
      recentTransactions: txRes.rows
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve balance.' });
  }
});

// POST /api/wallet/buy - Buy crypto with USD
app.post('/api/wallet/buy', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { asset, amount, pricePerUnit } = req.body;

  const validAssets = ['BTC', 'ETH', 'USDT'];
  const assetUpper = asset ? asset.toUpperCase() : '';

  if (!validAssets.includes(assetUpper)) {
    return res.status(400).json({ error: 'Invalid asset type.' });
  }

  const numAmount = parseFloat(amount);
  const numPrice = parseFloat(pricePerUnit);

  if (isNaN(numAmount) || numAmount <= 0 || isNaN(numPrice) || numPrice <= 0) {
    return res.status(400).json({ error: 'Invalid amount or price.' });
  }

  const totalCostUsd = numAmount * numPrice;
  const assetCol = `${assetUpper.toLowerCase()}_balance`;

  try {
    const walletRes = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [userId]);
    const wallet = walletRes.rows[0];

    if (parseFloat(wallet.usd_balance) < totalCostUsd) {
      return res.status(400).json({ error: 'Insufficient USD balance.' });
    }

    await pool.query(
      `UPDATE wallets SET usd_balance = usd_balance - $1, ${assetCol} = ${assetCol} + $2 WHERE user_id = $3`,
      [totalCostUsd, numAmount, userId]
    );

    await pool.query(
      'INSERT INTO transactions (user_id, type, asset, amount, price_per_unit, total_usd) VALUES ($1, $2, $3, $4, $5, $6)',
      [userId, 'BUY', assetUpper, numAmount, numPrice, totalCostUsd]
    );

    const updatedWallet = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [userId]);

    res.json({
      message: `Successfully bought ${numAmount} ${assetUpper}`,
      wallet: updatedWallet.rows[0]
    });
  } catch (err) {
    console.error('Buy error:', err);
    res.status(500).json({ error: 'Buy transaction failed.' });
  }
});

// POST /api/wallet/sell - Convert crypto back into USD
app.post('/api/wallet/sell', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { asset, amount, pricePerUnit } = req.body;

  const validAssets = ['BTC', 'ETH', 'USDT'];
  const assetUpper = asset ? asset.toUpperCase() : '';

  if (!validAssets.includes(assetUpper)) {
    return res.status(400).json({ error: 'Invalid asset type.' });
  }

  const numAmount = parseFloat(amount);
  const numPrice = parseFloat(pricePerUnit);

  if (isNaN(numAmount) || numAmount <= 0 || isNaN(numPrice) || numPrice <= 0) {
    return res.status(400).json({ error: 'Invalid amount or price per unit.' });
  }

  const totalUsdEarned = numAmount * numPrice;
  const assetCol = `${assetUpper.toLowerCase()}_balance`;

  try {
    const walletRes = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [userId]);
    const wallet = walletRes.rows[0];
    const currentAssetBalance = parseFloat(wallet[assetCol]);

    if (currentAssetBalance < numAmount) {
      return res.status(400).json({ error: `Insufficient ${assetUpper} balance to sell.` });
    }

    await pool.query(
      `UPDATE wallets SET ${assetCol} = ${assetCol} - $1, usd_balance = usd_balance + $2 WHERE user_id = $3`,
      [numAmount, totalUsdEarned, userId]
    );

    await pool.query(
      'INSERT INTO transactions (user_id, type, asset, amount, price_per_unit, total_usd) VALUES ($1, $2, $3, $4, $5, $6)',
      [userId, 'SELL', assetUpper, numAmount, numPrice, totalUsdEarned]
    );

    const updatedWallet = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [userId]);

    res.json({
      message: `Successfully sold ${numAmount} ${assetUpper} for $${totalUsdEarned.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD`,
      wallet: updatedWallet.rows[0]
    });
  } catch (err) {
    console.error('Sell endpoint error:', err);
    res.status(500).json({ error: 'Sale transaction failed.' });
  }
});

// POST /api/wallet/transfer - Peer-to-peer asset transfer
app.post('/api/wallet/transfer', authenticateToken, async (req, res) => {
  const senderId = req.user.userId;
  const { recipientUsername, asset, amount, pricePerUnit } = req.body;

  const validAssets = ['USD', 'BTC', 'ETH', 'USDT'];
  const assetUpper = asset ? asset.toUpperCase() : '';

  if (!validAssets.includes(assetUpper)) {
    return res.status(400).json({ error: 'Invalid asset type.' });
  }

  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({ error: 'Amount must be greater than zero.' });
  }

  const assetColumn = `${assetUpper.toLowerCase()}_balance`;

  try {
    const recipientResult = await pool.query('SELECT id FROM users WHERE username = $1', [recipientUsername]);
    if (recipientResult.rows.length === 0) {
      return res.status(404).json({ error: `User '${recipientUsername}' not found.` });
    }

    const recipientId = recipientResult.rows[0].id;
    if (senderId === recipientId) return res.status(400).json({ error: 'Cannot transfer funds to yourself.' });

    const senderWallet = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [senderId]);
    const currentBalance = parseFloat(senderWallet.rows[0][assetColumn]);

    if (currentBalance < numAmount) {
      return res.status(400).json({ error: `Insufficient ${assetUpper} balance.` });
    }

    const unitPrice = parseFloat(pricePerUnit) || 1.0;
    const totalUsd = assetUpper === 'USD' ? numAmount : numAmount * unitPrice;

    // Deduct sender, credit recipient
    await pool.query(`UPDATE wallets SET ${assetColumn} = ${assetColumn} - $1 WHERE user_id = $2`, [numAmount, senderId]);
    await pool.query(`UPDATE wallets SET ${assetColumn} = ${assetColumn} + $1 WHERE user_id = $2`, [numAmount, recipientId]);

    // Record transactions for both parties
    await pool.query(
      'INSERT INTO transactions (user_id, type, asset, amount, price_per_unit, total_usd) VALUES ($1, $2, $3, $4, $5, $6)',
      [senderId, `TRANSFER_TO_${recipientUsername.toUpperCase()}`, assetUpper, numAmount, unitPrice, totalUsd]
    );

    await pool.query(
      'INSERT INTO transactions (user_id, type, asset, amount, price_per_unit, total_usd) VALUES ($1, $2, $3, $4, $5, $6)',
      [recipientId, `RECEIVED_FROM_${req.user.username.toUpperCase()}`, assetUpper, numAmount, unitPrice, totalUsd]
    );

    const updatedSenderWallet = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [senderId]);

    res.json({
      message: `Successfully sent ${numAmount} ${assetUpper} to ${recipientUsername}`,
      wallet: updatedSenderWallet.rows[0]
    });
  } catch (err) {
    console.error('Transfer error:', err);
    res.status(500).json({ error: 'Transfer failed.' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));