const API_BASE = 'http://localhost:5000/api';

// Live price cache updated from CoinGecko
let livePrices = {
  BTC: 65000,
  ETH: 3500,
  USDT: 1.00
};

let isLoginMode = true;
let jwtToken = localStorage.getItem('token') || null;
let portfolioChartInstance = null;

// DOM Elements
const authView = document.getElementById('auth-view');
const dashboardView = document.getElementById('dashboard-view');
const authForm = document.getElementById('auth-form');
const authTitle = document.getElementById('auth-title');
const authBtn = document.getElementById('auth-btn');
const toggleAuth = document.getElementById('toggle-auth');
const togglePrompt = document.getElementById('toggle-prompt');
const authMessage = document.getElementById('auth-message');
const logoutBtn = document.getElementById('logout-btn');
const userDisplay = document.getElementById('user-display');
const buyForm = document.getElementById('buy-form');
const tradeMessage = document.getElementById('trade-message');
const sellForm = document.getElementById('sell-form');
const sellMessage = document.getElementById('sell-message');
const transferForm = document.getElementById('transfer-form');
const transferMessage = document.getElementById('transfer-message');

// ==========================================
// 1. REAL-TIME COINGECKO PRICE POLLING
// ==========================================

async function fetchLivePrices() {
  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether&vs_currencies=usd'
    );

    if (!response.ok) throw new Error('CoinGecko API rate limit or error');

    const data = await response.json();

    livePrices.BTC = data.bitcoin?.usd || livePrices.BTC;
    livePrices.ETH = data.ethereum?.usd || livePrices.ETH;
    livePrices.USDT = data.tether?.usd || livePrices.USDT;

    updatePriceDropdownLabels();

    if (jwtToken && !dashboardView.classList.contains('hidden')) {
      fetchDashboardData();
    }
  } catch (err) {
    console.warn('Using fallback prices due to CoinGecko error:', err.message);
  }
}

function updatePriceDropdownLabels() {
  const assetSelect = document.getElementById('buy-asset');
  if (!assetSelect) return;

  assetSelect.options[0].text = `Bitcoin (BTC) - $${livePrices.BTC.toLocaleString('en-US')}`;
  assetSelect.options[1].text = `Ethereum (ETH) - $${livePrices.ETH.toLocaleString('en-US')}`;
  assetSelect.options[2].text = `Tether (USDT) - $${livePrices.USDT.toFixed(2)}`;
}

// ==========================================
// 2. INITIALIZATION & AUTHENTICATION
// ==========================================

window.addEventListener('DOMContentLoaded', () => {
  fetchLivePrices();
  setInterval(fetchLivePrices, 30000);

  if (jwtToken) showDashboard();
});

toggleAuth.addEventListener('click', (e) => {
  e.preventDefault();
  isLoginMode = !isLoginMode;
  authMessage.textContent = '';

  if (isLoginMode) {
    authTitle.textContent = 'Login to Your Wallet';
    authBtn.textContent = 'Log In';
    togglePrompt.textContent = "Don't have an account?";
    toggleAuth.textContent = 'Register here';
  } else {
    authTitle.textContent = 'Register New Account';
    authBtn.textContent = 'Register';
    togglePrompt.textContent = 'Already have an account?';
    toggleAuth.textContent = 'Login here';
  }
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  authMessage.textContent = '';

  const endpoint = isLoginMode ? '/auth/login' : '/auth/register';

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Auth failed');

    if (isLoginMode) {
      jwtToken = data.token;
      localStorage.setItem('token', jwtToken);
      localStorage.setItem('username', data.user.username);
      showDashboard();
    } else {
      authMessage.className = 'message success';
      authMessage.textContent = 'Registration successful! Please log in.';
      toggleAuth.click();
    }
  } catch (err) {
    authMessage.className = 'message error';
    authMessage.textContent = err.message;
  }
});

logoutBtn.addEventListener('click', () => {
  localStorage.clear();
  jwtToken = null;
  dashboardView.classList.add('hidden');
  authView.classList.remove('hidden');
});

// ==========================================
// 3. DASHBOARD, BALANCES & CHART LOGIC
// ==========================================

async function fetchDashboardData() {
  try {
    const response = await fetch(`${API_BASE}/wallet/balance`, {
      headers: { 'Authorization': `Bearer ${jwtToken}` }
    });

    if (response.status === 401 || response.status === 403) {
      logoutBtn.click();
      return;
    }

    const data = await response.json();
    renderBalances(data.wallet);
    renderTransactions(data.recentTransactions);
  } catch (err) {
    console.error('Error fetching dashboard data:', err);
  }
}

function renderBalances(wallet) {
  userDisplay.textContent = localStorage.getItem('username') || 'Trader';

  const usd = parseFloat(wallet.usd_balance);
  const btc = parseFloat(wallet.btc_balance);
  const eth = parseFloat(wallet.eth_balance);
  const usdt = parseFloat(wallet.usdt_balance);

  const btcValue = btc * livePrices.BTC;
  const ethValue = eth * livePrices.ETH;
  const usdtValue = usdt * livePrices.USDT;
  const totalNetWorth = usd + btcValue + ethValue + usdtValue;

  document.getElementById('usd-balance').textContent = `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  document.getElementById('btc-balance').textContent = btc.toFixed(8);
  document.getElementById('eth-balance').textContent = eth.toFixed(6);
  document.getElementById('usdt-balance').textContent = usdt.toFixed(2);

  const netWorthEl = document.getElementById('net-worth');
  if (netWorthEl) {
    netWorthEl.textContent = `Portfolio Value: $${totalNetWorth.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  }

  renderPortfolioChart(usd, btcValue, ethValue, usdtValue);
}

function renderPortfolioChart(usdVal, btcVal, ethVal, usdtVal) {
  const ctx = document.getElementById('portfolioChart');
  if (!ctx) return;

  if (portfolioChartInstance) {
    portfolioChartInstance.destroy();
  }

  portfolioChartInstance = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: ['USD Cash', 'Bitcoin (BTC)', 'Ethereum (ETH)', 'Tether (USDT)'],
      datasets: [{
        data: [usdVal, btcVal, ethVal, usdtVal],
        backgroundColor: ['#10b981', '#f59e0b', '#6366f1', '#38bdf8'],
        borderColor: '#1e293b',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#f8fafc',
            font: { size: 11 }
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              const val = context.raw || 0;
              return `${label}: $${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }
          }
        }
      }
    }
  });
}

function renderTransactions(transactions) {
  const list = document.getElementById('transactions-list');
  list.innerHTML = '';

  if (!transactions || transactions.length === 0) {
    list.innerHTML = '<li style="justify-content:center; color:#64748b;">No recent transactions</li>';
    return;
  }

  transactions.forEach(tx => {
    const li = document.createElement('li');
    const date = new Date(tx.timestamp).toLocaleTimeString();
    li.innerHTML = `
      <span><strong>${tx.type}</strong> ${tx.amount} ${tx.asset}</span>
      <span>$${parseFloat(tx.total_usd).toFixed(2)} USD (${date})</span>
    `;
    list.appendChild(li);
  });
}

function showDashboard() {
  authView.classList.add('hidden');
  dashboardView.classList.remove('hidden');
  fetchDashboardData();
}

// ==========================================
// 4. CRYPTO BUY LOGIC
// ==========================================

buyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  tradeMessage.textContent = '';

  const asset = document.getElementById('buy-asset').value;
  const amount = parseFloat(document.getElementById('buy-amount').value);
  const pricePerUnit = livePrices[asset];

  try {
    const response = await fetch(`${API_BASE}/wallet/buy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`
      },
      body: JSON.stringify({ asset, amount, pricePerUnit })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Purchase failed');

    tradeMessage.className = 'message success';
    tradeMessage.textContent = `${data.message} @ $${pricePerUnit.toLocaleString('en-US')}/unit`;
    document.getElementById('buy-amount').value = '';
    fetchDashboardData();
  } catch (err) {
    tradeMessage.className = 'message error';
    tradeMessage.textContent = err.message;
  }
});

// ==========================================
// 5. CRYPTO SELL LOGIC
// ==========================================

if (sellForm) {
  sellForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    sellMessage.textContent = '';

    const asset = document.getElementById('sell-asset').value;
    const amount = parseFloat(document.getElementById('sell-amount').value);
    const pricePerUnit = livePrices[asset];

    try {
      const response = await fetch(`${API_BASE}/wallet/sell`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({ asset, amount, pricePerUnit })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Sale failed');

      sellMessage.className = 'message success';
      sellMessage.textContent = data.message;
      document.getElementById('sell-amount').value = '';
      fetchDashboardData();
    } catch (err) {
      sellMessage.className = 'message error';
      sellMessage.textContent = err.message;
    }
  });
}

// ==========================================
// 6. USER-TO-USER TRANSFER LOGIC
// ==========================================

if (transferForm) {
  transferForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    transferMessage.textContent = '';

    const recipientUsername = document.getElementById('transfer-recipient').value.trim();
    const asset = document.getElementById('transfer-asset').value;
    const amount = parseFloat(document.getElementById('transfer-amount').value);
    const pricePerUnit = asset === 'USD' ? 1.0 : livePrices[asset];

    try {
      const response = await fetch(`${API_BASE}/wallet/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify({ recipientUsername, asset, amount, pricePerUnit })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Transfer failed');

      transferMessage.className = 'message success';
      transferMessage.textContent = data.message;
      document.getElementById('transfer-recipient').value = '';
      document.getElementById('transfer-amount').value = '';
      fetchDashboardData();
    } catch (err) {
      transferMessage.className = 'message error';
      transferMessage.textContent = err.message;
    }
  });
}