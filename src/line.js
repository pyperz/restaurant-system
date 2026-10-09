// ส่วนที่ 4: บอท LINE OA — ตอบคำถาม, ดูเมนู, สั่งกลับบ้าน, จองโต๊ะ, ส่งต่อพนักงาน
// ตอบกลับลูกค้าด้วย "reply message" ซึ่ง LINE ไม่นับโควตา (ฟรี)
// ส่วนข้อความแจ้งผลการยืนยัน (push) นับโควตาของแพ็กเกจ LINE OA
import { all, first, run, bad, int, text, toBaht, readJson, HttpError } from './lib.js';
import { getSettings } from './service.js';

export const LINE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS line_users (
    user_id TEXT PRIMARY KEY, display_name TEXT NOT NULL DEFAULT '',
    human_until INTEGER NOT NULL DEFAULT 0, human_asked_at INTEGER NOT NULL DEFAULT 0, last_seen INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS line_users_human ON line_users(human_until)`,
  `CREATE TABLE IF NOT EXISTS web_orders (
    id INTEGER PRIMARY KEY, user_id TEXT, name TEXT NOT NULL, phone TEXT NOT NULL, pickup TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '', items TEXT NOT NULL, total_satang INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', reason TEXT NOT NULL DEFAULT '', session_id INTEGER, created_at INTEGER NOT NULL, ip TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS web_orders_status ON web_orders(status)`,
  `CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY, user_id TEXT, name TEXT NOT NULL, phone TEXT NOT NULL, people INTEGER NOT NULL,
    at INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL, ip TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS reservations_status ON reservations(status, at)`,
];

const TZ = 7 * 3600000;
const HUMAN_MS = 60 * 60000; // ขอคุยกับพนักงานแล้ว บอทเงียบ 1 ชั่วโมง
const AI_MODEL = '@cf/aisingapore/gemma-sea-lion-v4-27b-it'; // โมเดลที่ฝึกภาษาเอเชียตะวันออกเฉียงใต้ (มีไทย)
const AI_FALLBACK = '@cf/qwen/qwen3-30b-a3b-fp8';
const enc = new TextEncoder();
const lineApi = (env) => env.LINE_API_BASE || 'https://api.line.me';
const configured = (env) => !!(env.LINE_CHANNEL_SECRET && env.LINE_CHANNEL_ACCESS_TOKEN);

// ---------- ความปลอดภัย ----------
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, typeof data === 'string' ? enc.encode(data) : data));
}
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
function sameStr(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

// ลิงก์สั่งอาหาร/จองที่ส่งให้ลูกค้าใน LINE แนบรหัสที่ปลอมไม่ได้ เพื่อรู้ว่าใครสั่ง แล้วตอบกลับทาง LINE ได้
async function userToken(env, userId) {
  const sig = b64(await hmac(env.LINE_CHANNEL_SECRET, 'u:' + userId)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 24);
  return `${b64url(userId)}.${sig}`;
}
async function userFromToken(env, t) {
  if (!t || !configured(env)) return null;
  const [u, sig] = String(t).split('.');
  try {
    const userId = unb64url(u);
    if (!/^U[0-9a-f]{32}$/.test(userId)) return null;
    const want = (await userToken(env, userId)).split('.')[1];
    return sameStr(sig || '', want) ? userId : null;
  } catch { return null; }
}

// ---------- เรียก LINE ----------
async function lineCall(env, path, body, method = 'POST') {
  const r = await fetch(lineApi(env) + path, {
    method, headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`LINE ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.headers.get('content-type')?.includes('json') ? r.json() : null;
}
const reply = (env, token, messages) => lineCall(env, '/v2/bot/message/reply', { replyToken: token, messages: messages.slice(0, 5) });
async function push(env, userId, messages) {
  if (!userId || !configured(env)) return false;
  try { await lineCall(env, '/v2/bot/message/push', { to: userId, messages }); return true; }
  catch (e) { console.error('push failed', e.message); return false; }
}

// ---------- ข้อมูลร้านที่บอทใช้ตอบ ----------
async function shopData(db) {
  const [st, menu, packages, links] = await Promise.all([
    getSettings(db),
    all(db, 'SELECT id, name, category, price_satang, available, image_v FROM menu_items ORDER BY category, sort, id'),
    all(db, 'SELECT id, name, adult_satang, child_satang, duration_min FROM packages WHERE active = 1 ORDER BY sort, id'),
    all(db, 'SELECT package_id, item_id FROM package_items'),
  ]);
  return { st, menu, packages, links };
}
const baht = (s) => `${toBaht(s).toLocaleString('th-TH')} บาท`;

function quick(st, base, token) {
  const items = [
    { type: 'action', action: { type: 'message', label: 'ดูเมนู', text: 'ดูเมนู' } },
    { type: 'action', action: { type: 'message', label: 'ราคาบุฟเฟต์', text: 'ราคาบุฟเฟต์' } },
    { type: 'action', action: { type: 'message', label: 'เวลาเปิด-ปิด', text: 'เวลาเปิด-ปิด' } },
  ];
  if (st.takeaway_on === '1') items.push({ type: 'action', action: { type: 'uri', label: 'สั่งกลับบ้าน', uri: `${base}/order.html?t=${token}` } });
  if (st.reserve_on === '1') items.push({ type: 'action', action: { type: 'uri', label: 'จองโต๊ะ', uri: `${base}/reserve.html?t=${token}` } });
  items.push({ type: 'action', action: { type: 'message', label: 'คุยกับพนักงาน', text: 'คุยกับพนักงาน' } });
  return { items };
}
const msg = (t, qr) => ({ type: 'text', text: t.slice(0, 4900), ...(qr ? { quickReply: qr } : {}) });

function packagesText(d) {
  if (!d.packages.length) return 'ตอนนี้ร้านยังไม่มีแพ็กเกจบุฟเฟต์ค่ะ';
  return 'ราคาบุฟเฟต์\n' + d.packages.map((p) => `• ${p.name}: ผู้ใหญ่ ${baht(p.adult_satang)}` +
    (p.child_satang ? ` / เด็ก ${baht(p.child_satang)}` : '') + (p.duration_min ? ` (ทานได้ ${p.duration_min} นาที)` : '')).join('\n');
}
function hoursText(st) {
  const lines = [];
  if (st.open_hours) lines.push(`เวลาเปิด-ปิด: ${st.open_hours}`);
  if (st.address) lines.push(`ที่อยู่: ${st.address}`);
  if (st.phone) lines.push(`โทร: ${st.phone}`);
  return lines.length ? lines.join('\n') : 'ขออภัยค่ะ ร้านยังไม่ได้ใส่ข้อมูลเวลาเปิด-ปิด กด "คุยกับพนักงาน" เพื่อสอบถามได้เลยค่ะ';
}
// เมนูแบบการ์ดเลื่อนดู (สูงสุด 12 ใบ) มีรูปจากระบบร้าน
function menuFlex(d, base, token) {
  const items = d.menu.filter((m) => m.available && m.price_satang !== null).slice(0, 11);
  const bubbles = items.map((m) => ({
    type: 'bubble', size: 'micro',
    ...(m.image_v ? { hero: { type: 'image', url: `${base}/img/${m.id}?v=${m.image_v}`, size: 'full', aspectRatio: '4:3', aspectMode: 'cover' } } : {}),
    body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
      { type: 'text', text: m.name, weight: 'bold', size: 'sm', wrap: true },
      { type: 'text', text: baht(m.price_satang), size: 'sm', color: '#555555' }] },
  }));
  if (d.st.takeaway_on === '1') bubbles.push({ type: 'bubble', size: 'micro', body: { type: 'box', layout: 'vertical', justifyContent: 'center', contents: [
    { type: 'button', style: 'primary', color: '#D9480F', action: { type: 'uri', label: 'สั่งกลับบ้าน', uri: `${base}/order.html?t=${token}` } }] } });
  if (!bubbles.length) return null;
  return { type: 'flex', altText: 'เมนูของร้าน', contents: { type: 'carousel', contents: bubbles } };
}

// ---------- AI ตอบคำถามทั่วไป ----------
function aiContext(d) {
  const pk = new Map(d.packages.map((p) => [p.id, p.name]));
  const inPkg = (id) => d.links.filter((l) => l.item_id === id && pk.has(l.package_id)).map((l) => pk.get(l.package_id));
  const menu = d.menu.slice(0, 150).map((m) => {
    const parts = [m.name, m.category && `(${m.category})`, m.price_satang !== null && `สั่งแยก ${toBaht(m.price_satang)} บาท`,
      inPkg(m.id).length && `อยู่ในบุฟเฟต์: ${inPkg(m.id).join(', ')}`, !m.available && 'วันนี้หมด'].filter(Boolean);
    return '- ' + parts.join(' ');
  }).join('\n');
  return [`ชื่อร้าน: ${d.st.shop_name || '-'}`, hoursText(d.st), d.st.shop_info && `ข้อมูลเพิ่มเติม: ${d.st.shop_info}`,
    packagesText(d), `รับสั่งกลับบ้าน: ${d.st.takeaway_on === '1' ? 'ได้ (กดปุ่ม "สั่งกลับบ้าน")' : 'ไม่รับ'}`,
    `รับจองโต๊ะ: ${d.st.reserve_on === '1' ? 'ได้ (กดปุ่ม "จองโต๊ะ")' : 'ไม่รับ'}`, 'เมนู:', menu || '-'].filter(Boolean).join('\n');
}
async function askAI(env, d, question) {
  if (!env.AI || d.st.bot_ai !== '1') return null;
  const messages = [
    { role: 'system', content: 'คุณคือพนักงานตอบแชท LINE ของร้านอาหาร ตอบเป็นภาษาไทย สุภาพ เป็นกันเอง ลงท้ายด้วย "ค่ะ" ' +
      'ตอบสั้น ไม่เกิน 4 บรรทัด ใช้เฉพาะข้อมูลร้านด้านล่างเท่านั้น ห้ามเดาราคา เมนู หรือโปรโมชั่นที่ไม่มีในข้อมูล ' +
      'ถ้าไม่มีข้อมูลให้ตอบว่าไม่แน่ใจ และแนะนำให้กด "คุยกับพนักงาน" ' +
      'ห้ามรับออเดอร์หรือรับจองในแชทเอง ให้แนะนำให้กดปุ่ม "สั่งกลับบ้าน" หรือ "จองโต๊ะ" แทน\n\nข้อมูลร้าน:\n' + aiContext(d) },
    { role: 'user', content: question.slice(0, 500) },
  ];
  for (const model of [AI_MODEL, AI_FALLBACK]) {
    try {
      const r = await env.AI.run(model, { messages: model === AI_FALLBACK ? [...messages.slice(0, 1), { role: 'user', content: messages[1].content + ' /no_think' }] : messages, max_tokens: 300 });
      let out = r?.response ?? r?.choices?.[0]?.message?.content ?? '';
      if (typeof out !== 'string') out = String(out ?? '');
      out = out.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (out) return out;
    } catch (e) { console.error('AI error', model, e.message); }
  }
  return null;
}

// ---------- รับข้อความจาก LINE ----------
const has = (t, words) => words.some((w) => t.includes(w));
async function handleEvent(env, db, ev, base) {
  const userId = ev.source?.userId;
  if (!userId || !ev.replyToken) return;
  const now = Date.now();
  let u = await first(db, 'SELECT * FROM line_users WHERE user_id = ?', userId);
  if (!u) {
    let name = '';
    try { name = (await lineCall(env, `/v2/bot/profile/${userId}`, null, 'GET'))?.displayName || ''; } catch {}
    await run(db, 'INSERT OR IGNORE INTO line_users (user_id, display_name, last_seen) VALUES (?,?,?)', userId, name.slice(0, 80), now);
    u = { user_id: userId, display_name: name, human_until: 0 };
  } else await run(db, 'UPDATE line_users SET last_seen = ? WHERE user_id = ?', now, userId);

  const d = await shopData(db);
  if (d.st.bot_on === '0') return; // ปิดบอทไว้ (ให้พนักงานตอบเองทั้งหมด)
  const token = await userToken(env, userId);
  const qr = quick(d.st, base, token);

  if (ev.type === 'follow') {
    return reply(env, ev.replyToken, [msg(`สวัสดีค่ะ ยินดีต้อนรับสู่${d.st.shop_name || 'ร้านของเรา'} 🙏\nเลือกจากปุ่มด้านล่าง หรือพิมพ์ถามได้เลยค่ะ`, qr)]);
  }
  if (ev.type !== 'message') return;
  const t = ev.message?.type === 'text' ? ev.message.text.trim() : '';

  if (has(t, ['คุยกับพนักงาน', 'ขอคุยกับคน', 'ติดต่อพนักงาน', 'แอดมิน'])) {
    await run(db, 'UPDATE line_users SET human_until = ?, human_asked_at = ? WHERE user_id = ?', now + HUMAN_MS, now, userId);
    return reply(env, ev.replyToken, [msg('แจ้งพนักงานแล้วค่ะ รอสักครู่นะคะ พนักงานจะตอบกลับในแชทนี้ 🙏')]);
  }
  if (u.human_until > now) return; // อยู่ระหว่างพนักงานตอบ บอทไม่แทรก
  if (!t) return reply(env, ev.replyToken, [msg('ได้รับแล้วค่ะ ถ้าต้องการสอบถาม พิมพ์ข้อความ หรือเลือกจากปุ่มด้านล่างได้เลยค่ะ', qr)]);

  if (has(t, ['ดูเมนู', 'เมนู', 'มีอะไรบ้าง'])) {
    const flex = menuFlex(d, base, token);
    return reply(env, ev.replyToken, flex ? [flex, msg('เลื่อนดูเมนูได้เลยค่ะ' + (d.st.takeaway_on === '1' ? ' สั่งกลับบ้านกดปุ่ม "สั่งกลับบ้าน" ได้ค่ะ' : ''), qr)] : [msg('ตอนนี้ร้านยังไม่ได้ใส่เมนูค่ะ', qr)]);
  }
  if (has(t, ['ราคาบุฟเฟต์', 'บุฟเฟ่ต์', 'บุฟเฟต์', 'หัวละ'])) return reply(env, ev.replyToken, [msg(packagesText(d), qr)]);
  if (has(t, ['เวลาเปิด', 'เปิดกี่โมง', 'ปิดกี่โมง', 'ที่อยู่', 'ร้านอยู่', 'เบอร์โทร'])) return reply(env, ev.replyToken, [msg(hoursText(d.st), qr)]);
  if (has(t, ['จองโต๊ะ', 'จองที่', 'อยากจอง']) && d.st.reserve_on === '1') return reply(env, ev.replyToken, [msg(`จองโต๊ะได้ที่ลิงก์นี้เลยค่ะ\n${base}/reserve.html?t=${token}`, qr)]);
  if (has(t, ['สั่งกลับบ้าน', 'สั่งอาหาร', 'ซื้อกลับ', 'เดลิเวอรี่']) && d.st.takeaway_on === '1') return reply(env, ev.replyToken, [msg(`สั่งกลับบ้านได้ที่ลิงก์นี้เลยค่ะ\n${base}/order.html?t=${token}`, qr)]);

  const ai = await askAI(env, d, t);
  return reply(env, ev.replyToken, [msg(ai || 'ขออภัยค่ะ ตอนนี้ตอบคำถามนี้ไม่ได้ เลือกจากปุ่มด้านล่าง หรือกด "คุยกับพนักงาน" ได้เลยค่ะ', qr)]);
}

export async function webhook(req, env, db, ctx) {
  if (!configured(env)) throw new HttpError(503, 'ยังไม่ได้ตั้งค่า LINE');
  const raw = new Uint8Array(await req.arrayBuffer());
  const sig = req.headers.get('x-line-signature') || '';
  if (!sameStr(sig, b64(await hmac(env.LINE_CHANNEL_SECRET, raw)))) throw new HttpError(401, 'bad signature');
  let body;
  try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { throw bad('bad json'); }
  const base = new URL(req.url).origin;
  const work = Promise.all((body.events || []).map((ev) => handleEvent(env, db, ev, base).catch((e) => console.error('LINE event error', e.message))));
  // ตอบ LINE ทันที แล้วค่อยประมวลผลต่อ (LINE ต้องการคำตอบเร็ว)
  if (ctx?.waitUntil) ctx.waitUntil(work); else await work;
  return { ok: true };
}

// ---------- หน้าเว็บสั่งอาหาร / จองโต๊ะ (ลูกค้าเปิดจากลิงก์ใน LINE ไม่ต้องใช้ PIN) ----------
export async function publicMenu(db, env, url) {
  const d = await shopData(db);
  const userId = await userFromToken(env, url.searchParams.get('t'));
  return {
    shop_name: d.st.shop_name, open_hours: d.st.open_hours, phone: d.st.phone,
    takeaway_on: d.st.takeaway_on === '1', reserve_on: d.st.reserve_on === '1', linked: !!userId,
    menu: d.menu.filter((m) => m.price_satang !== null).map((m) => ({ id: m.id, name: m.name, category: m.category, price: toBaht(m.price_satang), available: !!m.available, image: m.image_v ? `/img/${m.id}?v=${m.image_v}` : null })),
  };
}
const phoneOk = (v) => { const p = String(v || '').replace(/[^\d]/g, ''); if (p.length < 9 || p.length > 10) throw bad('เบอร์โทรไม่ถูกต้อง'); return p; };
async function limitIp(db, table, ip) {
  const n = (await first(db, `SELECT COUNT(*) AS n FROM ${table} WHERE ip = ? AND status = 'pending'`, ip)).n;
  if (n >= 3) throw bad('มีรายการที่รอร้านยืนยันอยู่แล้ว กรุณารอสักครู่ หรือโทรหาร้านค่ะ');
}

export async function publicOrder(db, env, req) {
  const b = await readJson(req);
  const st = await getSettings(db);
  if (st.takeaway_on !== '1') throw bad('ขณะนี้ร้านปิดรับสั่งกลับบ้าน');
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  await limitIp(db, 'web_orders', ip);
  const name = text(b.name, 'ชื่อ', { max: 60 }), phone = phoneOk(b.phone), note = text(b.note, 'หมายเหตุ', { required: false, max: 200 });
  const pickup = b.pickup === 'asap' ? 'asap' : /^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.pickup)) ? String(b.pickup) : null;
  if (!pickup) throw bad('กรุณาเลือกเวลารับอาหาร');
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 40) throw bad('ยังไม่ได้เลือกรายการอาหาร');
  const ids = [...new Set(b.items.map((x) => int(x.item_id, 'รายการ', { min: 1, max: 1e9 })))];
  const menu = await all(db, `SELECT id, name, price_satang, available FROM menu_items WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  let total = 0;
  const lines = b.items.map((x) => {
    const m = menu.find((r) => r.id === Number(x.item_id));
    if (!m || m.price_satang === null) throw bad('มีรายการที่สั่งไม่ได้ กรุณาโหลดหน้าใหม่');
    if (!m.available) throw bad(`${m.name} หมดแล้ว`);
    const qty = int(x.qty, 'จำนวน', { min: 1, max: 50 });
    total += qty * m.price_satang;
    return { item_id: m.id, name: m.name, qty, unit_satang: m.price_satang, note: text(x.note, 'หมายเหตุ', { required: false, max: 100 }) };
  });
  const userId = await userFromToken(env, b.t);
  const r = await run(db, 'INSERT INTO web_orders (user_id, name, phone, pickup, note, items, total_satang, created_at, ip) VALUES (?,?,?,?,?,?,?,?,?)',
    userId, name, phone, pickup, note, JSON.stringify(lines), total, Date.now(), ip);
  return { id: r.meta.last_row_id, total: toBaht(total), linked: !!userId };
}

export async function publicReserve(db, env, req) {
  const b = await readJson(req);
  const st = await getSettings(db);
  if (st.reserve_on !== '1') throw bad('ขณะนี้ร้านปิดรับจองออนไลน์');
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  await limitIp(db, 'reservations', ip);
  const name = text(b.name, 'ชื่อ', { max: 60 }), phone = phoneOk(b.phone), note = text(b.note, 'หมายเหตุ', { required: false, max: 200 });
  const people = int(b.people, 'จำนวนคน', { min: 1, max: 60 });
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(b.date || '')), tm = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(b.time || ''));
  if (!m || !tm) throw bad('กรุณาเลือกวันและเวลา');
  const at = Date.UTC(+m[1], +m[2] - 1, +m[3], +tm[1], +tm[2]) - TZ;
  if (at < Date.now() - 10 * 60000) throw bad('เวลาที่เลือกผ่านไปแล้ว');
  if (at > Date.now() + 60 * 86400000) throw bad('จองล่วงหน้าได้ไม่เกิน 60 วัน');
  const userId = await userFromToken(env, b.t);
  const r = await run(db, 'INSERT INTO reservations (user_id, name, phone, people, at, note, created_at, ip) VALUES (?,?,?,?,?,?,?,?)',
    userId, name, phone, people, at, note, Date.now(), ip);
  return { id: r.meta.last_row_id, linked: !!userId };
}

// ---------- กล่องงานของพนักงาน ----------
const thaiWhen = (ms) => new Date(ms + TZ).toISOString().replace('T', ' ').slice(0, 16);
export async function inboxCounts(db) {
  const [o, r, h] = await Promise.all([
    first(db, "SELECT COUNT(*) AS n FROM web_orders WHERE status = 'pending'"),
    first(db, "SELECT COUNT(*) AS n FROM reservations WHERE status = 'pending'"),
    first(db, 'SELECT COUNT(*) AS n FROM line_users WHERE human_until > ?', Date.now()),
  ]);
  return { orders: o.n, reservations: r.n, handoffs: h.n };
}
async function inbox(db, env, url) {
  const now = Date.now();
  const [orders, resv, humans] = await Promise.all([
    all(db, "SELECT * FROM web_orders WHERE status = 'pending' OR (status != 'pending' AND created_at > ?) ORDER BY created_at DESC LIMIT 50", now - 12 * 3600000),
    all(db, "SELECT * FROM reservations WHERE (status IN ('pending','confirmed') AND at > ?) ORDER BY at LIMIT 100", now - 3 * 3600000),
    all(db, 'SELECT user_id, display_name, human_until, human_asked_at FROM line_users WHERE human_until > ? ORDER BY human_asked_at', now),
  ]);
  return {
    now, configured: configured(env), ai: !!env.AI, webhook_url: `${url.origin}/api/line/webhook`,
    orders: orders.map((o) => ({ id: o.id, name: o.name, phone: o.phone, pickup: o.pickup, note: o.note, items: JSON.parse(o.items).map((i) => ({ ...i, unit_price: toBaht(i.unit_satang) })),
      total: toBaht(o.total_satang), status: o.status, reason: o.reason, created_at: o.created_at, from_line: !!o.user_id })),
    reservations: resv.map((r) => ({ id: r.id, name: r.name, phone: r.phone, people: r.people, at: r.at, when: thaiWhen(r.at), note: r.note, status: r.status, from_line: !!r.user_id })),
    handoffs: humans.map((h) => ({ user_id: h.user_id, name: h.display_name || 'ลูกค้า LINE', asked_at: h.human_asked_at, until: h.human_until })),
  };
}

async function acceptOrder(db, env, id) {
  const o = await first(db, 'SELECT * FROM web_orders WHERE id = ?', id);
  if (!o) throw bad('ไม่พบออเดอร์');
  if (o.status !== 'pending') throw bad('ออเดอร์นี้จัดการไปแล้ว');
  const items = JSON.parse(o.items);
  const now = Date.now();
  const label = `กลับบ้าน · ${o.name}${o.pickup !== 'asap' ? ` (${o.pickup})` : ''}`;
  const s = await run(db, 'INSERT INTO sessions (table_id, table_name, adults, opened_at) VALUES (NULL, ?, 1, ?)', label.slice(0, 60), now);
  const sid = s.meta.last_row_id;
  const ord = await run(db, 'INSERT INTO orders (session_id, round_no, created_at, note) VALUES (?,1,?,?)', sid, now, [`โทร ${o.phone}`, o.note].filter(Boolean).join(' · '));
  const ins = db.prepare('INSERT INTO order_items (order_id, item_id, name, qty, in_package, unit_satang, note) VALUES (?,?,?,?,0,?,?)');
  await db.batch([
    ...items.map((i) => ins.bind(ord.meta.last_row_id, i.item_id, i.name, i.qty, i.unit_satang, i.note || '')),
    db.prepare("UPDATE web_orders SET status = 'accepted', session_id = ? WHERE id = ?").bind(sid, id),
  ]);
  const notified = await push(env, o.user_id, [msg(`ร้านรับออเดอร์ของคุณ${o.name}แล้วค่ะ ✅\nยอดรวม ${baht(o.total_satang)}\n${o.pickup === 'asap' ? 'กำลังเตรียมอาหาร เสร็จแล้วรับที่ร้านได้เลยค่ะ' : `รับได้เวลา ${o.pickup} น. ค่ะ`}`)]);
  return { ok: true, session_id: sid, notified };
}
async function rejectOrder(db, env, id, b) {
  const o = await first(db, 'SELECT * FROM web_orders WHERE id = ?', id);
  if (!o) throw bad('ไม่พบออเดอร์');
  if (o.status !== 'pending') throw bad('ออเดอร์นี้จัดการไปแล้ว');
  const reason = text(b.reason, 'เหตุผล', { required: false, max: 120 });
  await run(db, "UPDATE web_orders SET status = 'rejected', reason = ? WHERE id = ?", reason, id);
  const notified = await push(env, o.user_id, [msg(`ขออภัยค่ะ ร้านรับออเดอร์ของคุณ${o.name}ไม่ได้${reason ? `\nเหตุผล: ${reason}` : ''}`)]);
  return { ok: true, notified };
}
async function setReservation(db, env, id, b) {
  const r = await first(db, 'SELECT * FROM reservations WHERE id = ?', id);
  if (!r) throw bad('ไม่พบการจอง');
  const status = b.status;
  if (!['confirmed', 'declined', 'cancelled', 'arrived'].includes(status)) throw bad('สถานะไม่ถูกต้อง');
  await run(db, 'UPDATE reservations SET status = ? WHERE id = ?', status, id);
  let notified = false;
  const when = new Date(r.at + TZ).toISOString().slice(0, 16).replace('T', ' เวลา ');
  if (status === 'confirmed') notified = await push(env, r.user_id, [msg(`ยืนยันการจองของคุณ${r.name}แล้วค่ะ ✅\nวันที่ ${when} น. จำนวน ${r.people} ท่าน\nแล้วพบกันนะคะ`)]);
  if (status === 'declined') notified = await push(env, r.user_id, [msg(`ขออภัยค่ะ ร้านรับจองวันที่ ${when} น. ไม่ได้ ${b.reason ? `(${String(b.reason).slice(0, 120)})` : ''}\nสอบถามเวลาอื่นได้ในแชทนี้ค่ะ`)]);
  return { ok: true, notified };
}

export const lineRoutes = [
  ['GET', /^\/api\/line\/inbox$/, (db, req, id, env) => inbox(db, env, new URL(req.url))],
  ['POST', /^\/api\/line\/orders\/(\d+)\/accept$/, (db, req, id, env) => acceptOrder(db, env, id)],
  ['POST', /^\/api\/line\/orders\/(\d+)\/reject$/, async (db, req, id, env) => rejectOrder(db, env, id, await readJson(req))],
  ['POST', /^\/api\/line\/reservations\/(\d+)$/, async (db, req, id, env) => setReservation(db, env, id, await readJson(req))],
  ['POST', /^\/api\/line\/handoff\/end$/, async (db, req) => { const b = await readJson(req); await run(db, 'UPDATE line_users SET human_until = 0 WHERE user_id = ?', String(b.user_id || '')); return { ok: true }; }],
];
