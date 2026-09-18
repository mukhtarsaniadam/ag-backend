const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const app = express();

app.use(cors());
app.use(express.json());

const CLOB_API_KEY = process.env.CLOB_API_KEY;
const CLOB_BASE = "https://www.clobnet.com.ng/api";
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

function getWallet() {
  try  {
    if(!fs.existsSync('/tmp/wallets.json')) return{};
    return JSON.parse(fs.readFileSync('/tmp/wallets.json'));

    } catch { return {};}
}
function saveWallets(wallets){
    fs.writeFileSync('tmp/wallets.json', JSON.stringify(wallets, null,2));
    try { fs.writeFileSync('wallets.json', JSON.stringify(wallets, null, 2));} catch(e){}
}
 function getTransactions() {
    try {
        if (!fs.existsSync('/tmp/transactions.json')) return [];
        return JSON.parse(fs.readFileSync('/tmp/transactions.json'));

     } catch { return []; }
 }
 function saveTransactions(tx) {
    let txs = getTransactions();
    txs.unshift(tx);
    fs.writeFileSync('/tmp/transactions.json', JSON.stringify(txs.slice(0, 100), null, 2));
 }
app.get('/',(req, res) => res.json({status: 'AG Backend Running', wallet: '/api/wallet/balance/:email' }));


app.post('/api/wallet/init', async (req, res) => {
   try {
    const{ email, amount } = req.body;
    if (!email || !amount) return res.status(400).json({ error: 'email and amount required'});
        
    const response = await axios.post('https://api.paystack.co/transaction/initialize',{
        email,
        amount: Math.round(amount * 100), //kobo
        callback_url: 'https://ag-frontend-beige.vercel.app/dashboard',
        Metadata: { custom_fields: [{display_name: "Purpose", variable_name: "Purpose", value: "Wallet Funding"}]}
    }, {
        headers: {Authorization: 'Bearer ' + PAYSTACK_SECRET}
    }); 
    res.json({authorization_url: response.data.data.authorization_url, reference: response.data.data.reference});
 } catch (e) {
    res.status(500).json({ error: e.response?.data || e.message });

   }

});
app.get('/api/wallet/verify/:reference',async (req, res) =>{
    try {
const r = await axios.get('https://api.paystack.co/transaction/verify/${req.params.reference}', {
  headers: {Authorization: 'Bearer ${PAYSTACK_SECRET}' }
});
const data = r.data.data;
if (data.status === 'success') {
    let wallets = getWallets();
    const email = data.customer.email;
    const amount = data.amount / 100;
    if (!wallets[email]) wallets[email] = 0;
    wallets[email] += amount;
    saveWallets(wallets);
    saveTransactions({ type: 'fund',email, amount,reference: data.reference, date: new Date() });
    return res.json({ success: true, email,amount,newBalance: wallets[email]});

}
res.json({ success: false, data});
    } catch(e) {
        res.status(500).json({error: e.response?.data || e.message});
    }
});

app.get('/api/wallet/balance/:email', (req, res) => {
    let wallets = getWallet();
    res.json({ email: req.params.email, balance: wallets[req.params.email] || 0 });
});
app.post('/api/buy/data', async (req, res) => {
    try {
        const { email, network,plan_id, phone } = req.body; //network: 1=MTN,2=GLO,3=9MOBILE,4=AIRTEL
        let wallets = getWallets();
        const balance = wallets[email] || 0;

        const plansRes = await axios.get('${CLOB_BASE}/data/plans', {
            headers: { Authorization: 'Token ${CLOB_API_KEY}'}
        });
        let price = 0;
        const allPlans = plansRes.data.data || plansRes.data;
        const selectedPlans = Array.isArray(allPlans)? allPlans.find(P => P.id == plan_id || P.plan_id == plan_id ) : null;
        price = selectedPlans? (selectedPlans.price || selectedPlans.amount) : 300; // fallback

        if (balance < price) return res.status(400).json({error: 'insufficient balance. You have ${balance}, need ${price}' });

        wallets[email] = balance - price;
        saveWallets(wallets);

        const buyRes = await axios.post('${CLOB_BASE}/data/',{
            network: network,
            plan: plan_id,
            phone: phone
        }, {
            headers: { Authorization: 'Token ${CLOB_API_KEY}'}
        });


         saveTransactions({ type: 'data', email, network,plan_id, phone, price, response: buyRes.data, date: new Date()});

         res.json( { success: true, newBalance: wallets[email], clobResponse: buyRes.data });

    } catch (e) {
        if (req.body.email) {
            let wallets = getWallets();
            console.log('Data purchase failed, manual refund may be needed');
        }
        res.status(500).json({ error: e.response?.data || e.message, details: e.response?.data });

    }
});

app.post('/api/buy/airtime', async (req, res) => {
    try {
        const { email, network, phone, amount } = req.body;
            let wallets = getWallets();
            const balance = wallets[email] || 0;

            if (balance < amount) return res.status(400).json({error: 'insufficient balance. You have ${balance}'})
            
                wallets[email] = balance - amount;
                saveWallets(wallets);

                const buyRes = await axios.post('${CLOB_BASE}/airtime/', {
                    network: network,
                    phone: phone,
                    amount: amount
                }, {
                    headers: {Authorization: 'Token ${CLOB_API_KEY}'}
                });

                saveTransactions({ type: 'airtime', email, network, phone, amount, response: buyRes.data, date: new Date()});

        res.json({ success: true, newBalance: wallets[email], clobResponse: buyRes.data });
    } catch (e) {
        res.status(500).json({ error: e.response?.data || e.message });
    }
});
app.get('/api/plans', async (req, res) =>{
   try {
    const r = await axios.get('${CLOB_BASE}/data/plans', {
      headers: {Authorization: 'Token ${CLOB_API_KEY}'}
    });
    res.json(r.data);
   } catch (e) {
    res.status(500).json({ erro: e.response?.data || e.message });
   }
});


const PORT = process.env.PORT || 3000;
app.lsten(PORT, () => console.log('AG Backend Running on ' + PORT));

module.exports = app;
