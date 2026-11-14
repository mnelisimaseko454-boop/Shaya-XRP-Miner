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
const BOT_USERNAME = process.env.BOT_USERNAME || 'ShayaXRPMinerBot';
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://shaya-xrp-miner.onrender.com';
const ADMIN_ID = process.env.ADMIN_ID || '';
const PORT = process.env.PORT || 3000;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const MAX_ENERGY = 100;
const MINE_COOLDOWN_MS = 3000;
const AUTO_APPROVE_LIMIT = 2;

const ROBOTS = {
  v1: { name: 'Robot v1.00', energy: 30, price: 100 },
  v2: { name: 'Robot v2.00', energy: 400, price: 1000 },
  v3: { name: 'Robot v3.00', energy: 2150, price: 5000 },
  v4: { name: 'Robot v4.00', energy: 35000, price: 75000 },
  v5: { name: 'Robot v5.00', energy: 100000, price: 200000 },
  v6: { name: 'Robot v6.00', energy: 300000, price: 500000 },
};
const VIP_PLANS = {
  'VIP': { stars: 250, mult: 2, minWithdraw: 1000, days: 30 },
  'VIP PRO': { stars: 500, mult: 4, minWithdraw: 1000, days: 30 },
  'VIP ELITE': { stars: 1000, mult: 8, minWithdraw: 1000, days: 30 },
};

async function getUser(id, from = {}) {
  let { data: u } = await supabase.from('users').select('*').eq('id', id).single();
  if (!u) {
    const { data: n } = await supabase.from('users').insert({ id, username: from.username || '', first_name: from.first_name || 'Player', diamonds: 300, energy: 100 }).select().single();
    u = n;
  }
  return u;
}
function calcPerHour(u) {
  let p = 0; const robots = u.robots || {};
  for (let k in robots) if (ROBOTS[k]) p += ROBOTS[k].energy * robots[k];
  if (u.vip_level && VIP_PLANS[u.vip_level] && u.vip_until && new Date(u.vip_until) > new Date()) p *= VIP_PLANS[u.vip_level].mult;
  return p;
}
function isVip(u) { return u.vip_level !== 'FREE' && u.vip_until && new Date(u.vip_until) > new Date(); }
function getMinWithdraw(u) { return isVip(u) ? 1000 : 2000; }
function collect(u) {
  const hours = (Date.now() - new Date(u.last_claim || Date.now()).getTime()) / 3600000;
  const earnedEnergy = Math.floor(calcPerHour(u) * hours);
  const diamondsEarned = Math.floor(earnedEnergy / 10);
  return { earnedEnergy, diamondsEarned };
}
async function checkEnergy(id) {
  let { data: user } = await supabase.from('users').select('*').eq('id', id).single();
  if (!user) return { energy: 100, user: null };
  let energy = user.energy ?? 100;
  let regen = Math.floor((Date.now() - new Date(user.last_regen || Date.now()).getTime()) / 60000);
  if (regen > 0) { energy = Math.min(MAX_ENERGY, energy + regen); await supabase.from('users').update({ energy, last_regen: new Date().toISOString() }).eq('id', id); user.energy = energy; }
  return { energy, user };
}
function dashboardText(u) {
  const c = collect(u);
  return `👤 DASHBOARD\n\n⬜ Available: ${u.diamonds} 💎\n⬜ Payment: ${u.payment || 0} 💎\n⬜ Payed out: ${(u.paid_out || 0).toFixed(2)} XRP\n1 XRP ~ 1.0636 $ | 1000 💎 = 1 XRP\n⚡ Energy: ${u.energy} | ${calcPerHour(u)}/hour\n👑 VIP: ${isVip(u) ? u.vip_level : 'FREE'} | Min Withdraw: ${getMinWithdraw(u)} 💎`;
}
function mainKeyboard() {
  return { reply_markup: { inline_keyboard: [
    [{ text: '🔥 Boost', web_app: { url: WEBAPP_URL } }, { text: '⚡ Factory', callback_data: 'factory' }, { text: '🏪 Shop', callback_data: 'shop' }],
    [{ text: '💎 Add', callback_data: 'add' }, { text: '📩 Withdraw', callback_data: 'withdraw' }],
    [{ text: '👑 VIP ⭐', callback_data: 'vip' }],
    [{ text: '👥 Invite friends', callback_data: 'invite' }],
    [{ text: '🎁 Bonus', callback_data: 'bonus' }, { text: '✨ Extra', callback_data: 'extra' }],
    [{ text: '📋 Menu', callback_data: 'menu' }],
    [{ text: '⛏️ OPEN MINER', web_app: { url: WEBAPP_URL } }],
  ]}};
}

let bot = null;
if (BOT_TOKEN) {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  bot.onText(/\/start(?:\s+ref_(\d+))?/, async (msg, match) => {
    const u = await getUser(msg.from.id, msg.from);
    const refId = match[1];
    if (refId && refId != String(msg.from.id) && !u.referred_by) {
      await supabase.from('users').update({ referred_by: Number(refId) }).eq('id', msg.from.id);
      const { data: ref } = await supabase.from('users').select('*').eq('id', Number(refId)).single();
      if (ref) { await supabase.from('users').update({ diamonds: ref.diamonds + 50, referrals: (ref.referrals || 0) + 1 }).eq('id', Number(refId)); bot.sendMessage(refId, `🎉 New referral! +50 💎 | Total: ${(ref.referrals || 0) + 1}`).catch(()=>{}); }
    }
    bot.sendMessage(msg.chat.id, `Mining XRP rewards is simple and free. Don't miss out, get started now!!\n\n${dashboardText(u)}`, mainKeyboard());
  });
  bot.onText(/\/pending/, async (msg) => {
    if (String(msg.from.id) !== String(ADMIN_ID)) return bot.sendMessage(msg.chat.id, '❌ Admin only');
    const { data } = await supabase.from('withdraws').select('*').in('status', ['auto_approved', 'pending_review', 'approved']).order('created_at', { ascending: false });
    if (!data?.length) return bot.sendMessage(msg.chat.id, '✅ No pending withdraws.');
    let txt = `📩 PENDING (${data.length})\n\n`;
    data.forEach(w => { txt += `${w.status} | ID: ${w.id}\nUser: ${w.user_id} @${w.username || ''}\nAmount: ${w.xrp.toFixed(2)} XRP (${w.amount_diamonds} 💎)\nWallet: ${w.wallet}\n➡️ /pay ${w.id} | /reject ${w.id} | /approve ${w.id}\n\n`; });
    bot.sendMessage(msg.chat.id, txt);
  });
  bot.onText(/\/approve (\d+)/, async (msg, match) => {
    if (String(msg.from.id) !== String(ADMIN_ID)) return;
    const { data: w } = await supabase.from('withdraws').select('*').eq('id', Number(match[1])).single();
    if (!w || w.status !== 'pending_review') return bot.sendMessage(msg.chat.id, '⚠️ Not in review');
    await supabase.from('withdraws').update({ status: 'approved' }).eq('id', w.id);
    bot.sendMessage(w.user_id, `✅ WITHDRAW APPROVED! ${w.xrp.toFixed(2)} XRP - Payment in 24h`).catch(()=>{});
    bot.sendMessage(msg.chat.id, `✅ APPROVED #${w.id} - Now pay, then /pay ${w.id}`);
  });
  bot.onText(/\/pay (\d+)/, async (msg, match) => {
    if (String(msg.from.id) !== String(ADMIN_ID)) return;
    const { data: w } = await supabase.from('withdraws').select('*').eq('id', Number(match[1])).single();
    if (!w || w.status === 'paid' || w.status === 'rejected') return bot.sendMessage(msg.chat.id, '⚠️ Already handled');
    await supabase.from('withdraws').update({ status: 'paid' }).eq('id', w.id);
    const { data: u } = await supabase.from('users').select('*').eq('id', w.user_id).single();
    if (u) await supabase.from('users').update({ paid_out: (u.paid_out || 0) + w.xrp, payment: Math.max(0, (u.payment || 0) - w.amount_diamonds) }).eq('id', w.user_id);
    bot.sendMessage(w.user_id, `✅ WITHDRAW PAID! 💸 ${w.xrp.toFixed(2)} XRP sent via ${w.method}`).catch(()=>{});
    bot.sendMessage(msg.chat.id, `✅ PAID #${w.id}`);
  });
  bot.onText(/\/reject (\d+)/, async (msg, match) => {
    if (String(msg.from.id) !== String(ADMIN_ID)) return;
    const { data: w } = await supabase.from('withdraws').select('*').eq('id', Number(match[1])).single();
    if (!w || w.status === 'paid' || w.status === 'rejected') return bot.sendMessage(msg.chat.id, '⚠️ Already handled');
    await supabase.from('withdraws').update({ status: 'rejected' }).eq('id', w.id);
    const { data: u } = await supabase.from('users').select('*').eq('id', w.user_id).single();
    if (u) await supabase.from('users').update({ diamonds: u.diamonds + w.amount_diamonds, payment: Math.max(0, (u.payment || 0) - w.amount_diamonds) }).eq('id', w.user_id);
    bot.sendMessage(w.user_id, `❌ WITHDRAW REJECTED - ${w.amount_diamonds} 💎 refunded.`).catch(()=>{});
    bot.sendMessage(msg.chat.id, `❌ REJECTED #${w.id} - Refunded`);
  });
  bot.onText(/\/stats/, async (msg) => {
    if (String(msg.from.id) !== String(ADMIN_ID)) return;
    const { data: users } = await supabase.from('users').select('*');
    const { data: wd } = await supabase.from('withdraws').select('*').eq('status', 'paid');
    const paid = (wd || []).reduce((a, b) => a + b.xrp, 0);
    bot.sendMessage(msg.chat.id, `📊 STATS\n👥 Users: ${(users || []).length}\n👑 VIP: ${(users || []).filter(u => u.vip_level !== 'FREE').length}\n💎 Diamonds in circulation: ${(users || []).reduce((a, b) => a + b.diamonds, 0)}\n✅ Paid: ${paid.toFixed(2)} XRP`);
  });
  bot.on('pre_checkout_query', (q) => bot.answerPreCheckoutQuery(q.id, true).catch(()=>{}));
  bot.on('successful_payment', async (msg) => {
    const plan = msg.successful_payment.invoice_payload.replace('vip_', '');
    const info = VIP_PLANS[plan]; if (!info) return;
    const until = new Date(Date.now() + info.days * 86400000).toISOString();
    await supabase.from('users').update({ vip_level: plan, vip_until: until }).eq('id', msg.from.id);
    bot.sendMessage(msg.chat.id, `✅ VIP ACTIVATED! 👑 ${plan} for ${info.days} days\n⚡ ${info.mult}x Mining | Min Withdraw now 1000 💎`, mainKeyboard());
    if (ADMIN_ID) bot.sendMessage(ADMIN_ID, `⭐ NEW VIP SALE\nUser: ${msg.from.id} @${msg.from.username || ''}\nPlan: ${plan} - ${info.stars} Stars`).catch(()=>{});
  });
  bot.on('callback_query', async (q) => {
    const u = await getUser(q.from.id, q.from); const data = q.data;
    bot.answerCallbackQuery(q.id).catch(()=>{});
    if (data === 'menu') return bot.editMessageText(dashboardText(u), { chat_id: q.message.chat.id, message_id: q.message.message_id, ...mainKeyboard() }).catch(()=>{});
    if (data === 'factory') {
      let kb = Object.keys(ROBOTS).map(k => [{ text: `🤖 ${ROBOTS[k].name} - ${ROBOTS[k].price} 💎 - ${ROBOTS[k].energy}/h - Owned: ${(u.robots || {})[k] || 0}`, callback_data: `hire_${k}` }]);
      kb.push([{ text: '⬅ Back', callback_data: 'menu' }]);
      return bot.editMessageText(`⚡ FACTORY - Hire Robots\nPer hour: ${calcPerHour(u)}`, { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: kb } }).catch(()=>{});
    }
    if (data.startsWith('hire_')) {
      const k = data.replace('hire_', ''); const r = ROBOTS[k];
      if (u.diamonds < r.price) return bot.answerCallbackQuery(q.id, { text: `❌ Need ${r.price} 💎`, show_alert: true });
      const robots = { ...(u.robots || {}), [k]: ((u.robots || {})[k] || 0) + 1 };
      await supabase.from('users').update({ diamonds: u.diamonds - r.price, robots }).eq('id', u.id);
      return bot.answerCallbackQuery(q.id, { text: `✅ Hired ${r.name}`, show_alert: true });
    }
    if (data === 'boost' || data === 'add') return bot.sendMessage(q.from.id, `🔥 BOOST = Watch Ad + Get +2 💎\nAds only work INSIDE the App.`, { reply_markup: { inline_keyboard: [[{ text: '🤖 OPEN MINER APP - Watch Ad', web_app: { url: WEBAPP_URL } }]] } });
    if (data === 'vip') {
      let kb = Object.keys(VIP_PLANS).map(k => [{ text: `👑 ${k} - ${VIP_PLANS[k].stars} ⭐`, callback_data: `buyvip_${k}` }]);
      kb.push([{ text: '⬅ Back', callback_data: 'menu' }]);
      return bot.editMessageText(`👑 VIP PLANS - 30 DAYS\nVIP 250⭐ = 2x + 1000 💎 Min\nVIP PRO 500⭐ = 4x + 1000 💎 Min\nVIP ELITE 1000⭐ = 8x + 1000 💎 Min\nFREE = 2000 💎 Min`, { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: kb } }).catch(()=>{});
    }
    if (data.startsWith('buyvip_')) {
      const plan = data.replace('buyvip_', ''); const info = VIP_PLANS[plan];
      try { await bot.sendInvoice(q.from.id, `👑 ${plan} - Shaya XRP Miner`, `${plan} - 30 Days - ${info.mult}x Mining`, `vip_${plan}`, '', 'XTR', [{ label: plan, amount: info.stars }]); } catch(e) { bot.answerCallbackQuery(q.id, { text: '❌ Press /start first.', show_alert: true }); }
      return;
    }
    if (data === 'bonus') {
      if (u.bonus_last && Date.now() - new Date(u.bonus_last).getTime() < 86400000) return bot.answerCallbackQuery(q.id, { text: '❌ Already claimed today', show_alert: true });
      await supabase.from('users').update({ bonus_last: new Date().toISOString(), diamonds: u.diamonds + 50 }).eq('id', u.id);
      return bot.answerCallbackQuery(q.id, { text: '🎁 Bonus +50 💎', show_alert: true });
    }
    if (data === 'extra') return bot.editMessageText(`✨ EXTRA\n• Daily Bonus +50 💎\n• Invite +50 💎 per friend\n• Factory robots mine 24/7\n• Boost = +2 💎 per REAL ad`, { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [[{ text: '⬅ Back', callback_data: 'menu' }]] } }).catch(()=>{});
    if (data === 'invite') return bot.editMessageText(`👥 Invite\nhttps://t.me/${BOT_USERNAME}?start=ref_${u.id}\n+50 💎 per friend`, { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [[{ text: '⬅ Back', callback_data: 'menu' }]] } }).catch(()=>{});
    if (data === 'shop') return bot.editMessageText(`🏪 SHOP\nHire robots in Factory to earn more. Open Mini App for full Shop.`, { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [[{ text: '⬅ Back', callback_data: 'menu' }]] } }).catch(()=>{});
    if (data === 'withdraw') {
      const minW = getMinWithdraw(u);
      if (u.diamonds < minW) return bot.answerCallbackQuery(q.id, { text: `❌ Min ${minW} 💎. You have ${u.diamonds} 💎.`, show_alert: true });
      return bot.editMessageText(`📩 WITHDRAW\nMin: ${minW} 💎\nYou have: ${u.diamonds} 💎\nOpen App to withdraw.`, { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [[{ text: '🤖 OPEN APP TO WITHDRAW', web_app: { url: WEBAPP_URL } }], [{ text: '⬅ Back', callback_data: 'menu' }]] } }).catch(()=>{});
    }
  });
}

// --- API ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/api/user/:id', async (req, res) => {
  const { energy, user } = await checkEnergy(req.params.id);
  if (!user) return res.json({ diamonds: 300, energy: 100, xrp: 0, factory_level: 0, vip_level: 'FREE' });
  const c = collect(user);
  const newDiamonds = user.diamonds + c.diamondsEarned;
  if (c.diamondsEarned > 0) await supabase.from('users').update({ diamonds: newDiamonds, energy: Math.max(0, (user.energy || 0) - c.diamondsEarned * 10), last_claim: new Date().toISOString() }).eq('id', user.id);
  res.json({ diamonds: newDiamonds, energy, xrp: user.paid_out || 0, factory_level: user.factory_level || 0, vip_level: user.vip_level || 'FREE', robots: user.robots || {}, perHour: calcPerHour(user), minWithdraw: getMinWithdraw(user) });
});
app.post('/api/mine', async (req, res) => {
  try {
    const { userId, username } = req.body;
    const { energy, user } = await checkEnergy(userId);
    if (energy <= 0) return res.json({ success: false, error: 'No Energy! Watch Boost.', energy: 0 });
    if (user && user.last_mine) { const diff = Date.now() - new Date(user.last_mine).getTime(); if (diff < MINE_COOLDOWN_MS) return res.json({ success: false, error: 'Too fast! Wait ' + Math.ceil((MINE_COOLDOWN_MS - diff) / 1000) + 's', energy }); }
    const mult = isVip(user || {}) ? VIP_PLANS[user.vip_level].mult : 1;
    const gain = 1 * mult;
    const newDiamonds = (user?.diamonds || 0) + gain;
    const newEnergy = energy - 1;
    if (!user) await supabase.from('users').insert({ id: userId, username, diamonds: gain, energy: newEnergy, last_mine: new Date().toISOString(), last_regen: new Date().toISOString() });
    else await supabase.from('users').update({ diamonds: newDiamonds, energy: newEnergy, last_mine: new Date().toISOString() }).eq('id', userId);
    await supabase.from('rewards_log').insert({ user_id: userId, source: 'mine', amount: gain });
    res.json({ success: true, diamonds: newDiamonds, energy: newEnergy, gain });
  } catch(e) { res.json({ success: false, error: e.message }); }
});
app.post('/api/boost', async (req, res) => {
  const { user_id, adShown } = req.body;
  if (!adShown) return res.json({ success: false, error: '❌ No ad was shown. Watch a full ad to get +2 💎.' });
  const { data: u } = await supabase.from('users').select('*').eq('id', user_id).single();
  if (!u) return res.json({ success: false, error: 'User not found' });
  await supabase.from('users').update({ diamonds: u.diamonds + 2, energy: Math.min(100, (u.energy || 0) + 20) }).eq('id', user_id);
  res.json({ success: true, earned: 2, diamonds: u.diamonds + 2, energy: Math.min(100, (u.energy || 0) + 20) });
});
app.post('/api/hire', async (req, res) => {
  const { user_id, robot } = req.body; const r = ROBOTS[robot]; if (!r) return res.json({ success: false, error: 'No robot' });
  const { data: u } = await supabase.from('users').select('*').eq('id', user_id).single();
  if (u.diamonds < r.price) return res.json({ success: false, error: 'Not enough diamonds' });
  const robots = { ...(u.robots || {}), [robot]: ((u.robots || {})[robot] || 0) + 1 };
  await supabase.from('users').update({ diamonds: u.diamonds - r.price, robots }).eq('id', user_id);
  res.json({ success: true, diamonds: u.diamonds - r.price, robots });
});
app.post('/api/shop-buy', async (req, res) => {
  const { userId, item } = req.body;
  const { data: u } = await supabase.from('users').select('*').eq('id', userId).single(); if (!u) return res.json({ success: false, error: 'User not found' });
  if (item === 'energy_50') {
    if (u.diamonds < 50) return res.json({ success: false, error: 'Need 50 💎' });
    await supabase.from('users').update({ diamonds: u.diamonds - 50, energy: Math.min(100, (u.energy || 0) + 50) }).eq('id', userId);
    return res.json({ success: true, diamonds: u.diamonds - 50, energy: Math.min(100, (u.energy || 0) + 50) });
  }
  if (item === 'factory') {
    const cost = 200 + (u.factory_level || 0) * 200;
    if (u.diamonds < cost) return res.json({ success: false, error: 'Need ' + cost + ' 💎' });
    await supabase.from('users').update({ diamonds: u.diamonds - cost, factory_level: (u.factory_level || 0) + 1 }).eq('id', userId);
    return res.json({ success: true, diamonds: u.diamonds - cost, factory_level: (u.factory_level || 0) + 1 });
  }
  if (item === 'factory_claim') {
    const earn = (u.factory_level || 0) * 5; if (earn <= 0) return res.json({ success: false, error: 'Buy Factory first!' });
    await supabase.from('users').update({ diamonds: u.diamonds + earn }).eq('id', userId);
    return res.json({ success: true, diamonds: u.diamonds + earn, earned: earn });
  }
  res.json({ success: false, error: 'Unknown item' });
});
app.post('/api/bonus', async (req, res) => {
  const { data: u } = await supabase.from('users').select('*').eq('id', req.body.user_id).single();
  if (u.bonus_last && Date.now() - new Date(u.bonus_last).getTime() < 86400000) return res.json({ success: false, error: 'Already claimed' });
  await supabase.from('users').update({ bonus_last: new Date().toISOString(), diamonds: u.diamonds + 50 }).eq('id', u.id);
  res.json({ success: true, diamonds: u.diamonds + 50 });
});
app.post('/api/add-diamonds', async (req, res) => {
  const { userId, username, amount, source, rewardId } = req.body;
  if (!userId || !amount) return res.json({ success: false });
  if (rewardId) { const { data: ex } = await supabase.from('rewards_log').select('id').eq('reward_id', rewardId).single(); if (ex) return res.json({ success: false, error: 'Already credited' }); }
  const { data: u } = await supabase.from('users').select('*').eq('id', userId).single();
  if (!u) { await supabase.from('users').insert({ id: userId, username, diamonds: amount }); return res.json({ success: true, newBalance: amount }); }
  await supabase.from('users').update({ diamonds: u.diamonds + amount }).eq('id', userId);
  await supabase.from('rewards_log').insert({ user_id: userId, source: source || 'unknown', amount, reward_id: rewardId || null });
  res.json({ success: true, newBalance: u.diamonds + amount });
});
app.post('/api/withdraw', async (req, res) => {
  const { user_id, method, wallet } = req.body;
  const { data: u } = await supabase.from('users').select('*').eq('id', user_id).single();
  const minW = getMinWithdraw(u);
  if (u.diamonds < minW) return res.json({ success: false, error: `Min ${minW} 💎. You have ${u.diamonds} 💎.` });
  if (!wallet) return res.json({ success: false, error: 'Enter wallet first' });
  if ((method || '').includes('Walt') && !wallet.startsWith('UQ')) return res.json({ success: false, error: '❌ Walt addresses start with UQ... TRC20 (T...) NOT accepted.' });
  const xrp = u.diamonds / 1000;
  const isAuto = xrp <= AUTO_APPROVE_LIMIT;
  const { data: wd } = await supabase.from('withdraws').insert({ user_id: u.id, username: u.username, amount_diamonds: u.diamonds, xrp, method, wallet, status: isAuto ? 'auto_approved' : 'pending_review' }).select().single();
  await supabase.from('users').update({ payment: (u.payment || 0) + u.diamonds, diamonds: 0 }).eq('id', u.id);
  if (bot && ADMIN_ID) bot.sendMessage(ADMIN_ID, `${isAuto ? '💸 AUTO' : '🛑 REVIEW'} WITHDRAW #${wd.id}\nUser: ${u.id} @${u.username || ''}\nAmount: ${xrp.toFixed(2)} XRP\nWallet: ${wallet}`).catch(()=>{});
  res.json({ success: true, xrp, message: isAuto ? `✅ AUTO-APPROVED! ${xrp.toFixed(2)} XRP - Admin will pay in 24h.` : `🛑 MANUAL REVIEW! ${xrp.toFixed(2)} XRP over ${AUTO_APPROVE_LIMIT} XRP.` });
});
app.post('/api/vip-buy', async (req, res) => {
  const { userId, level } = req.body; const p = VIP_PLANS[level]; if (!p) return res.json({ success: false, error: 'Bad level' });
  try { const link = await bot.createInvoiceLink(`${level} - Shaya XRP Miner 30 days`, `${level} - 30 Days - ${p.mult}x Mining`, `vip_${level}`, '', 'XTR', [{ label: level, amount: p.stars }]); res.json({ success: true, invoiceLink: link }); } catch(e) { res.json({ success: false, error: e.message }); }
});
app.get('/api/leaderboard', async (req, res) => {
  const { data } = await supabase.from('users').select('username,first_name,diamonds,paid_out').order('diamonds', { ascending: false }).limit(10);
  res.json(data || []);
});
app.listen(PORT, () => console.log('Shaya XRP Miner V4 running on ' + PORT));
