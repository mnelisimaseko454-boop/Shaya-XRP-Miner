const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = 'https://shaya-xrp-miner.onrender.com';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- ENERGY SYSTEM ---
const MAX_ENERGY = 100;
const MINE_COOLDOWN_MS = 3000;

async function getUser(id, username) {
  let { data: user } = await supabase.from('users').select('*').eq('id', id).single();
  if (!user) {
    const { data: n } = await supabase.from('users').insert({ id, username: username || 'user', diamonds: 300, energy: 100, total_mined: 0, total_earned_ads: 0, total_earned_offers: 0, last_regen: new Date().toISOString() }).select().single();
    user = n;
  }
  return user || { diamonds: 300, energy: 100, xrp: 0 };
}

async function checkEnergy(userId) {
  let { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
  if (!user) return { energy: MAX_ENERGY, user: null };
  let energy = user.energy ?? MAX_ENERGY;
  let lastRegen = new Date(user.last_regen || new Date()).getTime();
  let now = Date.now();
  let regen = Math.floor((now - lastRegen) / 60000);
  if (regen > 0) {
    energy = Math.min(MAX_ENERGY, energy + regen);
    await supabase.from('users').update({ energy, last_regen: new Date(now).toISOString() }).eq('id', userId);
    user.energy = energy;
  }
  return { energy, user };
}

function dashboardText(u) {
  return `👤 DASHBOARD\n\n` +
    `⬜ Available: ${u.diamonds || 0} 💎\n` +
    `⬜ Payment: 0 💎\n` +
    `⬜ Payed out: ${(u.xrp || 0).toFixed(2)} XRP\n` +
    `1 XRP ~ 1.0636 $ | 1000 💎 = 1 XRP\n` +
    `⚡ Energy: ${u.energy ?? 100} | 1/min\n` +
    `👑 VIP: FREE | Min Withdraw: 2000 💎`;
}

function dashboardKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🔥 Boost', web_app: { url: WEBAPP_URL } },
       { text: '⚡ Factory', callback_data: 'factory' },
       { text: '🏪 Shop', callback_data: 'shop' }],
      [{ text: '💎 Add', callback_data: 'add' },
       { text: '📩 Withdraw', callback_data: 'withdraw' }],
      [{ text: '👑 VIP', callback_data: 'vip' }],
      [{ text: '👥 Invite friends', callback_data: 'invite' }],
      [{ text: '🎁 Bonus', callback_data: 'bonus' },
       { text: '✨ Extra', callback_data: 'extra' }],
      [{ text: '📋 Menu', callback_data: 'menu' }],
      [{ text: '⛏️ OPEN MINER', web_app: { url: WEBAPP_URL } }],
    ]
  };
}

// --- TELEGRAM BOT ---
if (BOT_TOKEN) {
  const bot = new TelegramBot(BOT_TOKEN, { polling: true });
  console.log('Bot polling started');

  bot.onText(/\/start/, async (msg) => {
    const u = await getUser(msg.from.id, msg.from.username || msg.from.first_name);
    bot.sendMessage(msg.chat.id, dashboardText(u), { reply_markup: dashboardKeyboard() });
  });

  bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const userId = q.from.id;
    const u = await getUser(userId, q.from.username || q.from.first_name);
    bot.answerCallbackQuery(q.id).catch(()=>{});

    const replies = {
      factory: '⚡ Factory\n\nYour factory is Level 0.\nUpgrade in the Mini App to earn per hour.\n\nTap OPEN MINER below.',
      shop: '🏪 Shop\n\nBuy Energy / Factory upgrades.\nShop works inside the Mini App.',
      add: '💎 Add Diamonds\n\nWays to earn:\n• Mine in Mini App (costs Energy)\n• 🔥 Boost = Watch Ad (Mini App only)\n• 🎁 Offers (Mini App only)\n\nTap OPEN MINER to earn.',
      withdraw: `📩 Withdraw\n\nAvailable: ${u.diamonds} 💎\nMin Withdraw: 2000 💎\n1000 💎 = 1 XRP\n\n${u.diamonds >= 2000 ? 'You can withdraw! Open Mini App and tap Withdraw.' : 'You need ' + (2000 - u.diamonds) + ' more 💎 to withdraw.'}`,
      vip: '👑 VIP: FREE\n\nVIP gives you faster mining.\nActivate VIP inside the Mini App.',
      invite: `👥 Invite Friends\n\nShare this bot with friends!\nYour link: https://t.me/ShayaXRPMinerBot?start=${userId}\n\nYou earn bonus when they mine.`,
      bonus: '🎁 Daily Bonus\n\nClaim your Daily Bonus inside the Mini App.',
      extra: '✨ Extra\n\nExtra tasks + Offers inside the Mini App.\nTap OPEN MINER.',
      menu: dashboardText(u)
    };

    const text = replies[q.data] || dashboardText(u);
    if (q.data === 'menu') {
      bot.editMessageText(text, { chat_id: chatId, message_id: q.message.message_id, reply_markup: dashboardKeyboard() }).catch(()=>{});
    } else {
      bot.sendMessage(chatId, text, { reply_markup: dashboardKeyboard() });
    }
  });
} else { console.log('⚠️ BOT_TOKEN missing'); }

// --- API ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/api/user/:id', async (req, res) => {
  try {
    const { energy, user } = await checkEnergy(req.params.id);
    if (!user) return res.json({ diamonds: 300, energy: 100, xrp: 0 });
    res.json({ diamonds: user.diamonds || 0, energy, xrp: user.xrp || 0 });
  } catch(e){ res.json({ diamonds: 300, energy: 100 }); }
});

// MINE - WITH ENERGY + COOLDOWN (NOT INFINITE)
app.post('/api/mine', async (req, res) => {
  try {
    const { userId, username } = req.body;
    const { energy, user } = await checkEnergy(userId);
    if (energy <= 0) return res.json({ success: false, error: 'No Energy! Wait or Watch Boost to refill.', energy: 0 });
    if (user && user.last_mine) {
      const diff = Date.now() - new Date(user.last_mine).getTime();
      if (diff < MINE_COOLDOWN_MS) return res.json({ success: false, error: 'Too fast! Wait ' + Math.ceil((MINE_COOLDOWN_MS-diff)/1000) + 's', energy });
    }
    const newEnergy = energy - 1;
    const newDiamonds = (user?.diamonds || 0) + 1;
    if (!user) {
      await supabase.from('users').insert({ id: userId, username, diamonds: 1, energy: newEnergy, last_mine: new Date().toISOString(), last_regen: new Date().toISOString() });
    } else {
      await supabase.from('users').update({ diamonds: newDiamonds, energy: newEnergy, total_mined: (user.total_mined||0)+1, last_mine: new Date().toISOString() }).eq('id', userId);
    }
    await supabase.from('rewards_log').insert({ user_id: userId, source: 'mine', amount: 1 });
    res.json({ success: true, diamonds: newDiamonds, energy: newEnergy });
  } catch(e){ res.json({ success: false, error: e.message }); }
});

app.post('/api/add-diamonds', async (req, res) => {
  try {
    const { userId, username, amount, source, rewardId } = req.body;
    if (!userId || !amount) return res.json({ success: false });
    if (rewardId) { const { data: ex } = await supabase.from('rewards_log').select('id').eq('reward_id', rewardId).single(); if (ex) return res.json({ success: false, error: 'Already credited' }); }
    let { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
    if (!user) { const { data: n } = await supabase.from('users').insert({ id: userId, username: username||'user', diamonds: amount, energy: 100 }).select().single(); user = n; }
    else {
      let upd = { diamonds: (user.diamonds||0)+amount };
      if(source==='mine') upd.total_mined=(user.total_mined||0)+amount;
      if(source==='boost') { upd.total_earned_ads=(user.total_earned_ads||0)+amount; upd.energy = Math.min(100, (user.energy ?? 100) + 20); }
      if(source==='offerwall') upd.total_earned_offers=(user.total_earned_offers||0)+amount;
      await supabase.from('users').update(upd).eq('id', userId);
      user.diamonds = upd.diamonds; user.energy = upd.energy ?? user.energy;
    }
    await supabase.from('rewards_log').insert({ user_id: userId, source: source||'unknown', amount, reward_id: rewardId||null });
    res.json({ success: true, newBalance: user.diamonds, newEnergy: user.energy ?? 100 });
  } catch(e){ res.json({ success: false, error: e.message }); }
});

app.post('/api/claim', async (req, res) => {
  try {
    const { userId, username, wallet } = req.body;
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
    if (!user || (user.diamonds||0) < 2000) return res.json({ success: false, error: 'Need 2000 diamonds to withdraw' });
    const xrpAmount = user.diamonds/1000;
    await supabase.from('claims').insert({ user_id: userId, username, diamonds_used: user.diamonds, xrp_amount: xrpAmount, wallet_address: wallet, status: 'pending' });
    await supabase.from('users').update({ diamonds: 0, xrp: (user.xrp||0)+xrpAmount }).eq('id', userId);
    res.json({ success: true, xrp: xrpAmount });
  } catch(e){ res.json({ success: false, error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Running on ' + PORT));
