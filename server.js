const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const CLOB_API_KEY = process.env.CLOB_API_KEY;
const CLOB_BASE = "https://www.clobnet.com.ng/api";

const WALLET_FILE = path.join('/tmp', 'wallets.json');

function getWallets() {
  try {
    if (!fs.existsSync(WALLET_FILE)) return {};
    return JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'));
  } catch { return {}; }
}
function saveWallets(wallets) {
  fs.writeFileSync(WALLET_FILE, JSON.stringify(wallets));
}

// Home
app.get('/', (req, res) => {
  res.json({ status: "AG Backend Running", time: new Date().toISOString() });
});

// Get plans
app.get('/api/plans', async (req, res) => {
  try {
    const resp = await axios.get(`${CLOB_BASE}/plans`, {
      headers: { 'Authorization': CLOB_API_KEY }
    });
    res.json(resp.data);
  } catch (e) {
    res.status(500).json({ error: e.message, data: e.response?.data });
  }
});

// Wallet balance
app.get('/api/wallet/balance', (req, res) => {
  const { email } = req.query;
  const wallets = getWallets();
  res.json({ balance: wallets[email]?.balance || 0 });
});

// Wallet init - FUND
app.post('/api/wallet/init', async (req, res) => {
  try {
    const { email, amount } = req.body;
    if (!PAYSTACK_SECRET) return res.status(500).json({ error: "PAYSTACK_SECRET_KEY missing" });

    const response = await axios.post('https://api.paystack.co/transaction/initialize', {
      email: email,
      amount: amount * 100,
      callback_url: "https://ag-frontend-ten.vercel.app/wallet",
      metadata: { email, type: "wallet_funding" }
    }, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });
    res.json(response.data);
  } catch (e) {
    res.status(500).json({ error: e.message, data: e.response?.data });
  }
});

// Wallet verify
app.get('/api/wallet/verify', async (req, res) => {
  try {
    const { reference, email } = req.query;
    const verify = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });
    if (verify.data.data.status === 'success') {
      const wallets = getWallets();
      const amt = verify.data.data.amount / 100;
      if (!wallets[email]) wallets[email] = { balance: 0 };
      wallets[email].balance += amt;
      saveWallets(wallets);
      return res.json({ success: true, balance: wallets[email].balance });
    }
    res.json(verify.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Buy data
app.post('/api/buy', async (req, res) => {
  try {
    const { network, plan_id, phone, email } = req.body;
    const wallets = getWallets();
    if ((wallets[email]?.balance || 0) <= 0) return res.status(400).json({ error: "Insufficient balance" });

    const resp = await axios.post(`${CLOB_BASE}/data`, {
      network, plan_id, phone
    }, { headers: { Authorization: CLOB_API_KEY } });

    // deduct - you need to get plan price logic here
    wallets[email].balance -= 100; // replace with real price
    saveWallets(wallets);
    res.json(resp.data);
  } catch (e) {
    res.status(500).json({ error: e.message, data: e.response?.data });
  }
});

if (!process.env.VERCEL){
    const PORT = process.env.PORT || 5000
    app.listen(PORT, () => {
        console.log(`Running on port ${PORT}`);
    });
}
module.exports = app;