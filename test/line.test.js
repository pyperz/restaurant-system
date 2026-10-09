// ทดสอบบอท LINE โดยจำลองเซิร์ฟเวอร์ LINE และ AI (ไม่ได้ส่งข้อความจริง)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startLocal } from './local.js';

const PORT = 3996, LPORT = 3995, PIN = '112233', SECRET = 'test-channel-secret', BASE = `http://localhost:${PORT}`;
const USER = 'U' + 'a'.repeat(32);
let server, lineMock;
const sent = []; // ข้อความที่บอทส่งไป LINE
const aiCalls = [];

before(async () => {
  lineMock = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    if (req.url.startsWith('/v2/bot/profile/')) { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ displayName: 'คุณเอ' })); return; }
    sent.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(body || '{}') });
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
  });
  await new Promise((ok) => lineMock.listen(LPORT, ok));
  const AI = { async run(model, input) { aiCalls.push({ model, input }); return { response: 'มีที่จอดรถหน้าร้านค่ะ' }; } };
  server = await startLocal({ port: PORT, pin: PIN, extraEnv: { LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: 'tok', LINE_API_BASE: `http://localhost:${LPORT}`, AI } });
});
after(() => { server.close(); lineMock.close(); });

const call = async (method, url, body, pin = PIN) => {
  const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', 'x-pin': pin }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const ok = async (...a) => { const r = await call(...a); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
async function lineEvent(ev, { badSig = false } = {}) {
  const raw = JSON.stringify({ destination: 'x', events: [{ replyToken: 'rt' + Math.random(), source: { type: 'user', userId: USER }, timestamp: Date.now(), ...ev }] });
  const sig = crypto.createHmac('sha256', badSig ? 'wrong' : SECRET).update(raw).digest('base64');
  sent.length = 0;
  const r = await fetch(BASE + '/api/line/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-line-signature': sig }, body: raw });
  return r.status;
}
const say = (t) => lineEvent({ type: 'message', message: { type: 'text', id: '1', text: t } });
const lastReply = () => sent.find((s) => s.path === '/v2/bot/message/reply')?.body;
const replyText = () => lastReply()?.messages.filter((m) => m.type === 'text').map((m) => m.text).join('\n') || '';

let fried, coke;
before(async () => {
  await ok('PUT', '/api/settings', { shop_name: 'ร้านทดสอบ', open_hours: 'ทุกวัน 11:00-22:00', phone: '02-123-4567' });
  fried = (await ok('POST', '/api/menu', { name: 'ข้าวผัด', category: 'จานเดียว', price: 60 })).id;
  coke = (await ok('POST', '/api/menu', { name: 'น้ำอัดลม', price: 25 })).id;
  await ok('POST', '/api/packages', { name: 'หมูกระทะ', adult_price: 299, item_ids: [] });
});

test('ปฏิเสธข้อความที่ไม่ได้มาจาก LINE จริง', async () => {
  assert.equal(await lineEvent({ type: 'message', message: { type: 'text', text: 'hi' } }, { badSig: true }), 401);
  assert.equal(sent.length, 0);
});

test('ตอบคำถามพื้นฐานจากข้อมูลจริง และมีปุ่มลัด', async () => {
  assert.equal(await say('ร้านเปิดกี่โมงคะ'), 200);
  assert.match(replyText(), /11:00-22:00/);
  assert.equal(sent[0].auth, 'Bearer tok');
  const labels = lastReply().messages.at(-1).quickReply.items.map((i) => i.action.label);
  assert.deepEqual(labels, ['ดูเมนู', 'ราคาบุฟเฟต์', 'เวลาเปิด-ปิด', 'สั่งกลับบ้าน', 'จองโต๊ะ', 'คุยกับพนักงาน']);

  await say('ราคาบุฟเฟต์');
  assert.match(replyText(), /หมูกระทะ: ผู้ใหญ่ 299 บาท/);

  await say('ดูเมนู');
  const flex = lastReply().messages[0];
  assert.equal(flex.type, 'flex');
  assert.equal(flex.contents.contents.length, 3); // 2 เมนู + ปุ่มสั่งกลับบ้าน
});

test('คำถามอื่นส่งให้ AI พร้อมข้อมูลร้าน', async () => {
  aiCalls.length = 0;
  await say('มีที่จอดรถไหม');
  assert.equal(replyText(), 'มีที่จอดรถหน้าร้านค่ะ');
  assert.match(aiCalls[0].input.messages[0].content, /ข้าวผัด/);
  assert.match(aiCalls[0].input.messages[0].content, /ทุกวัน 11:00-22:00/);
  // ปิด AI แล้วต้องตอบข้อความสำรองแทน
  await ok('PUT', '/api/settings', { bot_ai: '0' });
  await say('มีที่จอดรถไหม');
  assert.match(replyText(), /คุยกับพนักงาน/);
  await ok('PUT', '/api/settings', { bot_ai: '1' });
});

test('ขอคุยกับพนักงาน: บอทหยุดตอบ และแจ้งในระบบ', async () => {
  await say('คุยกับพนักงาน');
  assert.match(replyText(), /แจ้งพนักงานแล้ว/);
  await say('สอบถามหน่อยค่ะ');
  assert.equal(sent.length, 0); // บอทเงียบ
  let inbox = await ok('GET', '/api/line/inbox');
  assert.equal(inbox.handoffs[0].name, 'คุณเอ');
  assert.equal((await ok('GET', '/api/live')).inbox.handoffs, 1);
  await ok('POST', '/api/line/handoff/end', { user_id: USER });
  await say('ร้านเปิดกี่โมง');
  assert.match(replyText(), /11:00/);
});

test('สั่งกลับบ้านผ่านลิงก์ → พนักงานรับ → เข้าครัว + แจ้งลูกค้าทาง LINE', async () => {
  await say('สั่งกลับบ้าน');
  const link = replyText().match(/order\.html\?t=([^\s]+)/);
  assert.ok(link, replyText());
  const t = link[1];
  assert.equal((await ok('GET', `/api/public/menu?t=${t}`)).linked, true);
  assert.equal((await ok('GET', '/api/public/menu?t=fake.token')).linked, false);

  const bad = await call('POST', '/api/public/order', { t, name: 'เอ', phone: '123', pickup: 'asap', items: [{ item_id: fried, qty: 1 }] });
  assert.equal(bad.status, 400);
  const o = await ok('POST', '/api/public/order', { t, name: 'เอ', phone: '081-111-2222', pickup: '18:30', items: [{ item_id: fried, qty: 2, note: 'ไม่ใส่ผัก' }, { item_id: coke, qty: 1 }] });
  assert.equal(o.total, 145);

  let inbox = await ok('GET', '/api/line/inbox');
  assert.equal(inbox.orders[0].status, 'pending');
  assert.equal(inbox.orders[0].from_line, true);
  assert.equal((await ok('GET', '/api/live')).inbox.orders, 1);

  sent.length = 0;
  const acc = await ok('POST', `/api/line/orders/${o.id}/accept`);
  assert.equal(acc.notified, true);
  assert.equal(sent[0].path, '/v2/bot/message/push');
  assert.equal(sent[0].body.to, USER);
  assert.match(sent[0].body.messages[0].text, /145 บาท/);

  const live = await ok('GET', '/api/live');
  const ses = live.sessions.find((s) => s.id === acc.session_id);
  assert.equal(ses.table_id, null);
  assert.match(ses.table_name, /กลับบ้าน · เอ \(18:30\)/);
  const kitchen = live.orders.find((x) => x.session_id === acc.session_id);
  assert.equal(kitchen.items.find((i) => i.name === 'ข้าวผัด').note, 'ไม่ใส่ผัก');
  assert.equal((await ok('GET', `/api/sessions/${acc.session_id}`)).bill.total, 145);
  assert.equal((await call('POST', `/api/line/orders/${o.id}/accept`)).status, 400); // รับซ้ำไม่ได้
});

test('ปฏิเสธออเดอร์ และปิดรับสั่งกลับบ้าน', async () => {
  const o = await ok('POST', '/api/public/order', { name: 'บี', phone: '0812223333', pickup: 'asap', items: [{ item_id: coke, qty: 1 }] }); // เปิดเว็บเอง ไม่ผ่าน LINE
  const r = await ok('POST', `/api/line/orders/${o.id}/reject`, { reason: 'ของหมด' });
  assert.equal(r.notified, false);
  await ok('PUT', '/api/settings', { takeaway_on: '0' });
  assert.equal((await call('POST', '/api/public/order', { name: 'ซี', phone: '0812223333', pickup: 'asap', items: [{ item_id: coke, qty: 1 }] })).status, 400);
  await ok('PUT', '/api/settings', { takeaway_on: '1' });
});

test('จองโต๊ะ → พนักงานยืนยัน → แจ้งลูกค้า', async () => {
  await say('จองโต๊ะ');
  const t = replyText().match(/reserve\.html\?t=([^\s]+)/)[1];
  const tomorrow = new Date(Date.now() + 7 * 3600000 + 86400000).toISOString().slice(0, 10);
  assert.equal((await call('POST', '/api/public/reserve', { t, name: 'เอ', phone: '0811112222', people: 4, date: '2020-01-01', time: '18:00' })).status, 400);
  const r = await ok('POST', '/api/public/reserve', { t, name: 'เอ', phone: '0811112222', people: 4, date: tomorrow, time: '18:00', note: 'ขอโต๊ะริมหน้าต่าง' });
  const inbox = await ok('GET', '/api/line/inbox');
  const rv = inbox.reservations.find((x) => x.id === r.id);
  assert.equal(rv.when, `${tomorrow} 18:00`);
  sent.length = 0;
  const c = await ok('POST', `/api/line/reservations/${r.id}`, { status: 'confirmed' });
  assert.equal(c.notified, true);
  assert.match(sent[0].body.messages[0].text, /4 ท่าน/);
});

test('ทุกเส้นทางของพนักงานต้องใช้ PIN', async () => {
  assert.equal((await call('GET', '/api/line/inbox', null, 'x')).status, 401);
});
