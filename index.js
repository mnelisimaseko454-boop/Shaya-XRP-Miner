const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// --- SUPABASE FROM RENDER ENVIRONMENT ---
// You added these in Render -> Environment:
// SUPABASE_URL + SUPABASE_ANON_KEY
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.log('⚠️ WARNING: SUPABASE_URL or SUPABASE_ANON_KEY missing in Render Environment');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Serve frontend ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- Get user balance ---
app.get('/api/user/:id', async (req, res) => {
  try {
    const { data } = await supabase.from('users').select('*').eq('id', req.params.id).single();
    res.json(data || { id: req.params.id, diamonds: 0, xrp: 0 });
  } catch (e) { res.json({ diamonds: 0 }); }
});

// --- Add Diamonds (Mine / Boost / Offerwall) ---
app.post('/api/add-diamonds', async (req, res) => {
  try {
    const { userId, username, amount, source, rewardId } = req.body;
    if (!userId || !amount) return res.json({ success: false, error: 'Missing data' });

    // Prevent double-credit for same Giga reward
    if (rewardId) {
      const { data: exists } = await supabase.from('rewards_log').select('id').eq('reward_id', rewardId).single();
      if (exists) return res.json({ success: false, error: 'Already credited' });
    }

    let { data: user } = await supabase.from('users').select('*').eq('id', userId).single();

    if (!user) {
      const { data: newUser } = await supabase.from('users').insert({
        id: userId, username: username || 'unknown', diamonds: amount,
        total_mined: source === 'mine' ? amount : 0,
        total_earned_ads: source === 'boost' ? amount : 0,
        total_earned_offers: source === 'offerwall' ? amount : 0
      }).select().single();
      user = newUser;
    } else {
      let update = { diamonds: (user.diamonds || 0) + amount };
      if (source === 'mine') update.total_mined = (user.total_mined || 0) + amount;
      if (source === 'boost') update.total_earned_ads = (user.total_earned_ads || 0) + amount;
      if (source === 'offerwall') update.total_earned_offers = (user.total_earned_offers || 0) + amount;
      await supabase.from('users').update(update).eq('id', userId);
    }

    await supabase.from('rewards_log').insert({
      user_id: userId, source: source || 'unknown', amount, reward_id: rewardId || null
    });

    res.json({ success: true, newBalance: (user.diamonds || 0) + amount });
  } catch (e) {
    console.log('add-diamonds error', e);
    res.json({ success: false, error: e.message });
  }
});

// --- Claim XRP ---
app.post('/api/claim', async (req, res) => {
  try {
    const { userId, username, wallet } = req.body;
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
    if (!user || (user.diamonds || 0) < 1000) return res.json({ success: false, error: 'Need 1000 diamonds' });

    const xrpAmount = user.diamonds / 1000;
    await supabase.from('claims').insert({
      user_id: userId, username, diamonds_used: user.diamonds,
      xrp_amount: xrpAmount, wallet_address: wallet, status: 'pending'
    });
    await supabase.from('users').update({ diamonds: 0, xrp: (user.xrp || 0) + xrpAmount }).eq('id', userId);
    res.json({ success: true, xrp: xrpAmount });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Shaya XRP Miner running on ' + PORT));
