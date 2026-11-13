// ============================================================
// Shaya XRP Miner - FINAL V2 PROFITABLE
// Boost = +2 diamonds per ad
// Min Withdraw: FREE 2000 diamonds, VIP 1000 diamonds
// Semi-Auto: <=2 XRP Auto-Approved, >2 XRP Manual Review
// VIP Stars + Giga Ads + Giga Offerwall + OnclickA + Walt Check + Admin /pay
// ============================================================
const express = require('express');
const cors = require('cors');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME || 'ShayaXRPMinerBot';
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://shaya-xrp-miner.onrender.com';
const ADMIN_ID = process.env.ADMIN_ID || '';
const PORT = process.env.PORT || 3000;
const AUTO_APPROVE_LIMIT_XRP = 2;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

let users = {};
let withdraws = [];
let xrpPrice = 1.0636;

const ROBOTS = {
  v1: { name:'Robot v1.00', img:'robot1.png', energy:30, price:100 },
  v2: { name:'Robot v2.00', img:'robot2.png', energy:400, price:1000 },
  v3: { name:'Robot v3.00', img:'robot3.png', energy:2150, price:5000 },
  v4: { name:'Robot v4.00', img:'robot4.png', energy:35000, price:75000 },
  v5: { name:'Robot v5.00', img:'robot5.png', energy:100000, price:200000 },
  v6: { name:'Robot v6.00', img:'robot6.png', energy:300000, price:500000 },
};

const VIP_PLANS = {
  'VIP': { stars: 250, perHourBoost: 2, minWithdraw: 1000, days: 30 },
  'VIP PRO': { stars: 500, perHourBoost: 4, minWithdraw: 1000, days: 30 },
  'VIP ELITE': { stars: 1000, perHourBoost: 8, minWithdraw: 1000, days: 30 },
};

function getUser(id, from={}){
  if(!users[id]){
    users[id] = { id, first_name: from.first_name||'Player', username: from.username||'', diamonds: 300, payment: 0, paidOut: 0, energy: 0, robots:{}, lastClaim: Date.now(), referrals:0, bonusLast:0, vip_level:'FREE', vip_until:null };
  }
  return users[id];
}
function calcEnergy(u){
  let perHour = 0;
  for(let k in u.robots) perHour += ROBOTS[k].energy * u.robots[k];
  if(u.vip_level && u.vip_level!=='FREE' && VIP_PLANS[u.vip_level]) perHour *= VIP_PLANS[u.vip_level].perHourBoost;
  return perHour;
}
function collect(u){
  const hours = (Date.now()-u.lastClaim)/3600000;
  const earned = Math.floor(calcEnergy(u)*hours);
  const diamondsEarned = Math.floor(earned/10);
  u.energy += earned; u.lastClaim = Date.now();
  return { earned, diamondsEarned };
}
function isVipActive(u){ return u.vip_level!=='FREE' && u.vip_until && new Date(u.vip_until) > new Date(); }
// ===== PROFIT RULES V2 =====
function getMinWithdraw(u){ return isVipActive(u) ? 1000 : 2000; }
function getBoostReward(){ return 2; }
function isAdmin(msg){ return String(msg.from.id) === String(ADMIN_ID); }

const bot = TOKEN ? new TelegramBot(TOKEN, { polling:true }) : null;

function dashboardText(u){
  const c = collect(u); u.diamonds += c.diamondsEarned; u.energy -= c.diamondsEarned*10;
  return `👤 DASHBOARD\n\n⬜ Available: ${u.diamonds} 💎\n⬜ Payment: ${u.payment} 💎\n⬜ Payed out: ${u.paidOut.toFixed(2)} XRP\n1 XRP ~ ${xrpPrice} $ | 1000 💎 = 1 XRP\n⚡ Energy: ${u.energy} | ${calcEnergy(u)}/hour\n👑 VIP: ${isVipActive(u)?u.vip_level+' until '+u.vip_until:'FREE'} | Min Withdraw: ${getMinWithdraw(u)} 💎`;
}
function mainKeyboard(){
  return { reply_markup: { inline_keyboard: [
    [{text:'🔥 Boost', callback_data:'boost'},{text:'⚡ Factory', callback_data:'factory'},{text:'🏪 Shop', callback_data:'shop'}],
    [{text:'💎 Add', callback_data:'add'},{text:'📩 Withdraw', callback_data:'withdraw'}],
    [{text:'👑 VIP', callback_data:'vip'}],
    [{text:'👥 Invite friends', callback_data:'invite'}],
    [{text:'🎁 Bonus', callback_data:'bonus'},{text:'✨ Extra', callback_data:'extra'}],
    [{text:'📋 Menu', callback_data:'menu'}],
  ]}};
}

if(bot){
  bot.onText(/\/start(?:\s+ref_(\d+))?/, async (msg, match)=>{
    const u = getUser(msg.from.id, msg.from);
    const refId = match[1];
    if(refId && refId != String(msg.from.id) && !u.referredBy){
      u.referredBy = refId; const ref = users[refId];
      if(ref){ ref.diamonds+=50; ref.referrals++; try{ bot.sendMessage(refId, `🎉 New referral! +50 💎 | Total: ${ref.referrals}`);}catch(e){} }
    }
    await bot.sendMessage(msg.chat.id, `Mining XRP rewards is simple and free. Don't miss out, get started now!!\n\n${dashboardText(u)}`, {
      reply_markup:{ inline_keyboard:[
        [{text:'🤖 OPEN MINER APP', web_app:{url: WEBAPP_URL+`?start=${msg.from.id}`}}],
        ...mainKeyboard().reply_markup.inline_keyboard
      ]}
    });
  });

  // ===== ADMIN =====
  bot.onText(/\/pending/, async (msg)=>{
    if(!isAdmin(msg)) return bot.sendMessage(msg.chat.id, '❌ Admin only');
    const pending = withdraws.filter(w=>w.status==='auto_approved' || w.status==='pending_review' || w.status==='approved');
    if(!pending.length) return bot.sendMessage(msg.chat.id, '✅ No pending withdraws.');
    let txt = `📩 PENDING (${pending.length})\n\n`;
    pending.forEach(w=>{
      const label = w.status==='auto_approved' ? '✅ AUTO' : w.status==='pending_review' ? '🛑 REVIEW' : '✅ APPROVED - PAY NOW';
      txt += `${label} | ID: ${w.id}\nUser: ${w.user_id} @${w.username||''} ${users[w.user_id]?.first_name||''}\nAmount: ${w.xrp.toFixed(2)} XRP (${w.amount_diamonds} 💎)\nMethod: ${w.method}\nWallet: ${w.wallet}\n➡️ /pay ${w.id} | /reject ${w.id} | /approve ${w.id}\n\n`;
    });
    txt += `Total to pay: ${pending.reduce((a,b)=>a+b.xrp,0).toFixed(2)} XRP`;
    await bot.sendMessage(msg.chat.id, txt);
  });

  bot.onText(/\/approve (\d+)/, async (msg, match)=>{
    if(!isAdmin(msg)) return bot.sendMessage(msg.chat.id, '❌ Admin only');
    const id = Number(match[1]);
    const w = withdraws.find(x=>x.id===id);
    if(!w) return bot.sendMessage(msg.chat.id, `❌ #${id} not found`);
    if(w.status!=='pending_review') return bot.sendMessage(msg.chat.id, `⚠️ #${id} is ${w.status}`);
    w.status = 'approved';
    try{ await bot.sendMessage(w.user_id, `✅ WITHDRAW APPROVED!\n\n💸 ${w.xrp.toFixed(2)} XRP approved by admin.\nPayment will be sent in 24h to ${w.method}\nWallet: ${w.wallet}`); }catch(e){}
    await bot.sendMessage(msg.chat.id, `✅ APPROVED #${id} - ${w.xrp.toFixed(2)} XRP\nNow pay in Walt, then /pay ${id}`);
  });

  bot.onText(/\/pay (\d+)/, async (msg, match)=>{
    if(!isAdmin(msg)) return bot.sendMessage(msg.chat.id, '❌ Admin only');
    const id = Number(match[1]);
    const w = withdraws.find(x=>x.id===id);
    if(!w) return bot.sendMessage(msg.chat.id, `❌ #${id} not found. Send /pending`);
    if(w.status==='pending_review') return bot.sendMessage(msg.chat.id, `🛑 #${id} needs approval first! Send /approve ${id} then /pay ${id}`);
    if(w.status==='paid') return bot.sendMessage(msg.chat.id, `⚠️ #${id} already paid`);
    if(w.status==='rejected') return bot.sendMessage(msg.chat.id, `⚠️ #${id} was rejected`);
    w.status='paid'; w.paidAt=new Date().toISOString();
    const u = users[w.user_id];
    if(u){ u.paidOut+=w.xrp; u.payment=Math.max(0,(u.payment||0)-w.amount_diamonds); }
    try{ await bot.sendMessage(w.user_id, `✅ WITHDRAW PAID!\n\n💸 ${w.xrp.toFixed(2)} XRP sent via ${w.method}\nWallet: ${w.wallet}\nThank you! 🙏`); }catch(e){}
    await bot.sendMessage(msg.chat.id, `✅ PAID #${id} - ${w.xrp.toFixed(2)} XRP to ${w.user_id}`);
  });

  bot.onText(/\/reject (\d+)/, async (msg, match)=>{
    if(!isAdmin(msg)) return bot.sendMessage(msg.chat.id, '❌ Admin only');
    const id = Number(match[1]);
    const w = withdraws.find(x=>x.id===id);
    if(!w) return bot.sendMessage(msg.chat.id, `❌ #${id} not found`);
    if(w.status==='paid' || w.status==='rejected') return bot.sendMessage(msg.chat.id, `⚠️ Already ${w.status}`);
    w.status='rejected';
    const u = users[w.user_id];
    if(u){ u.diamonds+=w.amount_diamonds; u.payment=Math.max(0,(u.payment||0)-w.amount_diamonds); }
    try{ await bot.sendMessage(w.user_id, `❌ WITHDRAW REJECTED #${id}\nReason: Wrong wallet / Invalid details\nYour ${w.amount_diamonds} 💎 refunded. Check UQ... address and try again.`); }catch(e){}
    await bot.sendMessage(msg.chat.id, `❌ REJECTED #${id} - ${w.amount_diamonds} 💎 refunded`);
  });

  bot.onText(/\/stats/, async (msg)=>{
    if(!isAdmin(msg)) return bot.sendMessage(msg.chat.id, '❌ Admin only');
    const totalUsers = Object.keys(users).length;
    const totalPaid = withdraws.filter(w=>w.status==='paid').reduce((a,b)=>a+b.xrp,0);
    const totalPending = withdraws.filter(w=>['auto_approved','pending_review','approved'].includes(w.status)).reduce((a,b)=>a+b.xrp,0);
    const vipUsers = Object.values(users).filter(u=>u.vip_level!=='FREE').length;
    const totalDiamonds = Object.values(users).reduce((a,b)=>a+b.diamonds,0);
    await bot.sendMessage(msg.chat.id, `📊 SHAYA XRP MINER STATS\n\n👥 Total Users: ${totalUsers}\n👑 VIP Users: ${vipUsers}\n💎 Total Diamonds Held: ${totalDiamonds}\n\n✅ Paid Out: ${totalPaid.toFixed(2)} XRP\n⏳ Pending: ${totalPending.toFixed(2)} XRP\n📩 Total Requests: ${withdraws.length}\n\nRules: Boost +2 💎/ad | FREE Min 2000 💎 | VIP Min 1000 💎`);
  });

  bot.on('pre_checkout_query', (q)=>{ bot.answerPreCheckoutQuery(q.id, true); });
  bot.on('successful_payment', async (msg)=>{
    const pay = msg.successful_payment;
    const plan = pay.invoice_payload.replace('vip_','');
    const u = getUser(msg.from.id, msg.from);
    const planInfo = VIP_PLANS[plan];
    if(planInfo){
      const until = new Date(Date.now()+planInfo.days*86400000).toISOString().slice(0,10);
      u.vip_level = plan; u.vip_until = until;
      await bot.sendMessage(msg.chat.id, `✅ VIP ACTIVATED!\n👑 ${plan} for ${planInfo.days} days until ${until}\n⚡ ${planInfo.perHourBoost}x Mining Boost\n💸 NEW Min Withdraw: 1000 💎 (was 2000 💎)`);
      if(ADMIN_ID) bot.sendMessage(ADMIN_ID, `⭐ NEW VIP SALE\nUser: ${u.id} @${u.username}\nPlan: ${plan} - ${planInfo.stars} Stars`);
    }
  });

  bot.on('callback_query', async (q)=>{
    const u = getUser(q.from.id, q.from); const data = q.data;

    if(data.startsWith('admin_approve_')){
      if(!isAdmin(q)) return bot.answerCallbackQuery(q.id, {text:'Admin only', show_alert:true});
      const id = Number(data.replace('admin_approve_',''));
      const w = withdraws.find(x=>x.id===id);
      if(!w || w.status!=='pending_review') return bot.answerCallbackQuery(q.id, {text:'Already handled', show_alert:true});
      w.status='approved';
      try{ await bot.sendMessage(w.user_id, `✅ WITHDRAW APPROVED! ${w.xrp.toFixed(2)} XRP - Payment coming in 24h`); }catch(e){}
      await bot.editMessageText(`✅ APPROVED #${id} - ${w.xrp.toFixed(2)} XRP\nNow pay in Walt, then tap I PAID:`, {chat_id:q.message.chat.id, message_id:q.message.message_id, reply_markup:{inline_keyboard:[[{text:'✅ I PAID - Mark Paid', callback_data:`admin_pay_${id}`}],[{text:'❌ Reject + Refund', callback_data:`admin_reject_${id}` }]]}});
      return;
    }
    if(data.startsWith('admin_pay_')){
      if(!isAdmin(q)) return bot.answerCallbackQuery(q.id, {text:'Admin only', show_alert:true});
      const id = Number(data.replace('admin_pay_',''));
      const w = withdraws.find(x=>x.id===id);
      if(!w || (w.status!=='auto_approved' && w.status!=='approved')) return bot.answerCallbackQuery(q.id, {text:'Already handled / needs approve first', show_alert:true});
      w.status='paid'; w.paidAt=new Date().toISOString();
      const uu = users[w.user_id];
      if(uu){ uu.paidOut+=w.xrp; uu.payment=Math.max(0,(uu.payment||0)-w.amount_diamonds); }
      try{ await bot.sendMessage(w.user_id, `✅ WITHDRAW PAID!\n💸 ${w.xrp.toFixed(2)} XRP sent via ${w.method}`); }catch(e){}
      await bot.editMessageText(`✅ PAID #${id} - ${w.xrp.toFixed(2)} XRP to ${w.user_id}`, {chat_id:q.message.chat.id, message_id:q.message.message_id});
      return;
    }
    if(data.startsWith('admin_reject_')){
      if(!isAdmin(q)) return bot.answerCallbackQuery(q.id, {text:'Admin only', show_alert:true});
      const id = Number(data.replace('admin_reject_',''));
      const w = withdraws.find(x=>x.id===id);
      if(!w || w.status==='paid' || w.status==='rejected') return bot.answerCallbackQuery(q.id, {text:'Already handled', show_alert:true});
      w.status='rejected';
      const uu = users[w.user_id];
      if(uu){ uu.diamonds+=w.amount_diamonds; uu.payment=Math.max(0,(uu.payment||0)-w.amount_diamonds); }
      try{ await bot.sendMessage(w.user_id, `❌ WITHDRAW REJECTED - ${w.amount_diamonds} 💎 refunded. Check UQ... address.`); }catch(e){}
      await bot.editMessageText(`❌ REJECTED #${id} - Refunded`, {chat_id:q.message.chat.id, message_id:q.message.message_id});
      return;
    }

    if(data==='menu') return bot.editMessageText(dashboardText(u), {chat_id:q.message.chat.id, message_id:q.message.message_id, ...mainKeyboard()});
    if(data==='factory'){
      let kb = Object.keys(ROBOTS).map(k=>[{text:`🤖 ${ROBOTS[k].name} - ${ROBOTS[k].price} 💎 - ${ROBOTS[k].energy}/h - Hired: ${u.robots[k]||0}`, callback_data:`hire_${k}` }]);
      kb.push([{text:'⬅ Back', callback_data:'menu'}]);
      return bot.editMessageText(`⚡ FACTORY - Hire Robots`, {chat_id:q.message.chat.id, message_id:q.message.message_id, reply_markup:{inline_keyboard:kb}});
    }
    if(data.startsWith('hire_')){
      const k=data.replace('hire_',''); const r=ROBOTS[k];
      if(u.diamonds<r.price) return bot.answerCallbackQuery(q.id,{text:`❌ Need ${r.price} 💎`,show_alert:true});
      u.diamonds-=r.price; u.robots[k]=(u.robots[k]||0)+1;
      return bot.answerCallbackQuery(q.id,{text:`✅ Hire ${r.name}`,show_alert:true});
    }
    if(data==='boost'){ u.diamonds += getBoostReward(); return bot.answerCallbackQuery(q.id,{text:`⚡ Boosted! +${getBoostReward()} 💎 (Ad watched)`,show_alert:true}); }
    if(data==='add'){ u.diamonds+=10; return bot.answerCallbackQuery(q.id,{text:`💎 +10 Diamonds`,show_alert:true}); }
    if(data==='vip'){
      let kb = Object.keys(VIP_PLANS).map(k=>[{text:`👑 ${k} - ${VIP_PLANS[k].stars} ⭐`, callback_data:`buyvip_${k}`}]);
      kb.push([{text:'⬅ Back', callback_data:'menu'}]);
      return bot.editMessageText(`👑 VIP PLANS - 30 DAYS\nVIP 250⭐ = 2x Mining + 1000 💎 Min Withdraw\nVIP PRO 500⭐ = 4x Mining + 1000 💎 Min\nVIP ELITE 1000⭐ = 8x Mining + 1000 💎 Min\n\nFREE = 2000 💎 Min Withdraw`, {chat_id:q.message.chat.id, message_id:q.message.message_id, reply_markup:{inline_keyboard:kb}});
    }
    if(data.startsWith('buyvip_')){
      const plan=data.replace('buyvip_',''); const info=VIP_PLANS[plan];
      try{ await bot.sendInvoice(q.from.id, `👑 ${plan} - Shaya XRP Miner`, `${plan} - 30 Days - ${info.perHourBoost}x Mining + 1000 Diamonds Min Withdraw`, `vip_${plan}`, '', 'XTR', [{label: plan, amount: info.stars}]); }catch(e){ bot.answerCallbackQuery(q.id,{text:'❌ Stars invoice failed. Press /start first.',show_alert:true}); }
      return;
    }
    if(data==='bonus'){
      if(Date.now()-u.bonusLast<86400000) return bot.answerCallbackQuery(q.id,{text:'❌ Already claimed today',show_alert:true});
      u.bonusLast=Date.now(); u.diamonds+=50; return bot.answerCallbackQuery(q.id,{text:'🎁 Bonus +50 💎',show_alert:true});
    }
    if(data==='extra') return bot.editMessageText(`✨ EXTRA\n• Daily Bonus +50 💎\n• Invite +50 💎 per friend\n• Factory robots mine 24/7\n• Boost = +2 💎 per ad`, {chat_id:q.message.chat.id, message_id:q.message.message_id, reply_markup:{inline_keyboard:[[{text:'⬅ Back', callback_data:'menu'}]]}});
    if(data==='invite') return bot.editMessageText(`👥 Invite\nhttps://t.me/${BOT_USERNAME}?start=ref_${u.id}\n+50 💎 per friend`, {chat_id:q.message.chat.id, message_id:q.message.message_id, reply_markup:{inline_keyboard:[[{text:'⬅ Back', callback_data:'menu'}]]}});
    if(data==='shop') return bot.editMessageText(`🏪 SHOP\n100 💎 = Free demo\nHire robots to earn more`, {chat_id:q.message.chat.id, message_id:q.message.message_id, reply_markup:{inline_keyboard:[[{text:'⬅ Back', callback_data:'menu'}]]}});
    if(data==='withdraw'){
      const minW = getMinWithdraw(u);
      if(u.diamonds<minW) return bot.answerCallbackQuery(q.id,{text:`❌ Min ${minW} 💎. You have ${u.diamonds} 💎. ${isVipActive(u)?'VIP':'Buy VIP for 1000 💎 min!'}`,show_alert:true});
      return bot.editMessageText(`📩 WITHDRAW\nMin: ${minW} 💎 = ${(minW/1000).toFixed(1)} XRP (${isVipActive(u)?'VIP':'FREE - VIP = 1000 💎 min'})\nYou have: ${u.diamonds} 💎\n\nOpen App to withdraw with Walt address.`, {chat_id:q.message.chat.id, message_id:q.message.message_id, reply_markup:{inline_keyboard:[[{text:'🤖 OPEN APP TO WITHDRAW', web_app:{url: WEBAPP_URL+`?start=${u.id}`}}],[{text:'⬅ Back', callback_data:'menu'}]]}});
    }
  });
}

// ===== API =====
app.get('/api/user/:id', (req,res)=>{
  const u=getUser(req.params.id,{}); const c=collect(u); u.diamonds+=c.diamondsEarned; u.energy-=c.diamondsEarned*10;
  res.json({...u, perHour:calcEnergy(u), xrpPrice, robotsList:ROBOTS, vipPlans:VIP_PLANS, vipActive:isVipActive(u), minWithdraw:getMinWithdraw(u), boostReward:getBoostReward()});
});
app.post('/api/hire', (req,res)=>{
  const u=getUser(req.body.user_id,{}); const r=ROBOTS[req.body.robot];
  if(!r) return res.json({success:false, error:'No robot'});
  if(u.diamonds<r.price) return res.json({success:false, error:'Not enough diamonds'});
  u.diamonds-=r.price; u.robots[req.body.robot]=(u.robots[req.body.robot]||0)+1;
  res.json({success:true, user:u});
});
app.post('/api/bonus', (req,res)=>{
  const u=getUser(req.body.user_id,{});
  if(Date.now()-u.bonusLast<86400000) return res.json({success:false, error:'Already claimed'});
  u.bonusLast=Date.now(); u.diamonds+=50; res.json({success:true, user:u});
});
app.post('/api/collect', (req,res)=>{
  const u=getUser(req.body.user_id,{}); const c=collect(u); u.diamonds+=c.diamondsEarned; u.energy-=c.diamondsEarned*10;
  res.json({success:true, earned:c.diamondsEarned, user:u});
});
app.post('/api/boost', (req,res)=>{
  const u=getUser(req.body.user_id,{});
  u.diamonds += getBoostReward();
  res.json({success:true, earned:getBoostReward(), user:u});
});

// ===== WITHDRAW - SEMI-AUTO + PROFIT RULES =====
app.post('/api/withdraw', (req,res)=>{
  const {user_id, method, wallet} = req.body;
  const u=getUser(user_id,{});
  const minW = getMinWithdraw(u);
  if(u.diamonds<minW) return res.json({success:false, error:`Min ${minW} 💎 for ${isVipActive(u)?'VIP':'FREE'} users. You have ${u.diamonds} 💎. ${isVipActive(u)?'':'Buy VIP to withdraw at 1000 💎!'}`});
  if(!wallet) return res.json({success:false, error:'Enter your wallet first'});
  if((method==='Dollars (USDT) - Walt' || method==='Gram - Walt') && !wallet.startsWith('UQ')){
    return res.json({success:false, error:'❌ Wrong address! Walt addresses start with UQ... TRC20 (T...) NOT accepted.'});
  }
  const xrp = u.diamonds/1000;
  const isAuto = xrp <= AUTO_APPROVE_LIMIT_XRP;
  const reqObj = { id: Date.now(), user_id: u.id, username:u.username, first_name:u.first_name, amount_diamonds:u.diamonds, xrp, method, wallet, status: isAuto ? 'auto_approved' : 'pending_review', date:new Date().toISOString() };
  withdraws.push(reqObj);
  u.payment += u.diamonds; u.diamonds = 0;
  if(bot && ADMIN_ID){
    if(isAuto){
      bot.sendMessage(ADMIN_ID, `💸 NEW WITHDRAW #${reqObj.id} - ✅ AUTO-APPROVED (≤${AUTO_APPROVE_LIMIT_XRP} XRP)\nUser: ${u.id} @${u.username} ${u.first_name}\nAmount: ${xrp.toFixed(2)} XRP (${reqObj.amount_diamonds} 💎)\nMethod: ${method}\nWallet: ${wallet}\n\nJust pay in Walt, then tap I PAID:`, { reply_markup: { inline_keyboard: [[{text:'✅ I PAID - Mark Paid', callback_data:`admin_pay_${reqObj.id}` }],[{text:'❌ Reject + Refund', callback_data:`admin_reject_${reqObj.id}` }]] }});
    } else {
      bot.sendMessage(ADMIN_ID, `🛑 NEW WITHDRAW #${reqObj.id} - MANUAL REVIEW (>${AUTO_APPROVE_LIMIT_XRP} XRP)\nUser: ${u.id} @${u.username} ${u.first_name}\nAmount: ${xrp.toFixed(2)} XRP (${reqObj.amount_diamonds} 💎)\nMethod: ${method}\nWallet: ${wallet}\n\nCheck for cheating first!`, { reply_markup: { inline_keyboard: [[{text:'✅ Approve', callback_data:`admin_approve_${reqObj.id}`}],[{text:'❌ Reject + Refund', callback_data:`admin_reject_${reqObj.id}` }]] }});
    }
  }
  if(isAuto) res.json({success:true, xrp, message:`✅ AUTO-APPROVED! ${xrp.toFixed(2)} XRP approved. Admin will pay in 24h.`});
  else res.json({success:true, xrp, message:`🛑 Sent for MANUAL REVIEW! ${xrp.toFixed(2)} XRP is over ${AUTO_APPROVE_LIMIT_XRP} XRP. Admin will check and approve in 24h.`});
});
app.get('/api/withdraws', (req,res)=> res.json(withdraws));

app.post('/api/vip-stars-invoice', async (req,res)=>{
  const {user_id, plan} = req.body;
  const info = VIP_PLANS[plan];
  if(!info) return res.json({success:false, error:'Invalid plan'});
  if(!bot) return res.json({success:false, error:'Bot not connected'});
  try{
    await bot.sendInvoice(user_id, `👑 ${plan} - Shaya XRP Miner`, `${plan} - 30 Days - ${info.perHourBoost}x Mining + 1000 Diamonds Min Withdraw`, `vip_${plan}`, '', 'XTR', [{label: plan, amount: info.stars}]);
    res.json({success:true, stars: info.stars});
  }catch(e){ res.json({success:false, error:'Could not create Stars invoice. Press /start in @'+BOT_USERNAME+' first.'}); }
});

app.get('/api/leaderboard', (req,res)=>{
  const list = Object.values(users).sort((a,b)=>b.diamonds-a.diamonds).slice(0,10);
  res.json(list);
});
app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'index.html')));
app.listen(PORT, ()=> console.log('Shaya XRP Miner V2 Profitable running on '+PORT));
