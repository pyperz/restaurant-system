// ทดสอบตั้งค่าร้าน และรายงานยอดขาย
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startLocal } from './local.js';

const PORT = 3997, PIN = '975310', BASE = `http://localhost:${PORT}`;
let server;
before(async () => { server = await startLocal({ port: PORT, pin: PIN }); });
after(() => server.close());

const call = async (method, url, body) => {
  const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', 'x-pin': PIN }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const ok = async (...a) => { const r = await call(...a); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const thaiToday = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);

test('ตั้งค่าร้าน: บันทึกและตรวจเลข PromptPay', async () => {
  let s = (await ok('GET', '/api/state')).settings;
  assert.deepEqual({ shop_name: s.shop_name, promptpay_id: s.promptpay_id, paper: s.paper, pay_qr: s.pay_qr, qr_image: s.qr_image, takeaway_on: s.takeaway_on }, { shop_name: '', promptpay_id: '', paper: '80', pay_qr: 'promptpay', qr_image: null, takeaway_on: '1' });
  s = await ok('PUT', '/api/settings', { shop_name: 'ร้านหมูกระทะ', promptpay_id: '081-234-5678', paper: '58' });
  assert.equal(s.promptpay_id, '0812345678');
  assert.equal(s.paper, '58');
  assert.equal((await call('PUT', '/api/settings', { promptpay_id: '12345' })).status, 400);
  assert.equal((await ok('GET', '/api/state')).settings.shop_name, 'ร้านหมูกระทะ');
});

test('อัปโหลดรูป QR รับเงิน (เช่น K SHOP) และเลือกใช้', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const up = (type, body) => fetch(`${BASE}/api/settings/qr-image`, { method: 'PUT', headers: { 'Content-Type': type, 'x-pin': PIN }, body });
  assert.equal((await up('application/pdf', png)).status, 400);
  let s = await (await up('image/png', png)).json();
  assert.equal(s.qr_image, '/img/qr?v=1');
  s = await (await up('image/png', png)).json();
  assert.equal(s.qr_image, '/img/qr?v=2');
  const img = await fetch(BASE + s.qr_image);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), png);
  s = await ok('PUT', '/api/settings', { pay_qr: 'image' });
  assert.equal(s.pay_qr, 'image');
  assert.equal(s.shop_name, 'ร้านหมูกระทะ'); // ค่าอื่นไม่หาย
  s = await ok('DELETE', '/api/settings/qr-image');
  assert.equal(s.qr_image, null);
  assert.equal((await fetch(`${BASE}/img/qr`)).status, 404);
});

test('รายงานยอดขายวันนี้', async () => {
  const pork = (await ok('POST', '/api/menu', { name: 'หมู', price: 120 })).id;
  const coke = (await ok('POST', '/api/menu', { name: 'น้ำอัดลม', price: 25 })).id;
  const pkg = (await ok('POST', '/api/packages', { name: 'หมูกระทะ', adult_price: 299, child_price: 149, item_ids: [pork] })).id;
  await ok('POST', '/api/tables/bulk', { count: 3, start: 1 });
  const [t1, t2, t3] = (await ok('GET', '/api/state')).tables.map((t) => t.id);

  const a = await ok('POST', '/api/sessions', { table_id: t1, package_id: pkg, adults: 2, children: 1 });
  await ok('POST', `/api/sessions/${a.id}/orders`, { items: [{ item_id: pork, qty: 3, mode: 'pkg' }, { item_id: coke, qty: 2, mode: 'extra' }] });
  await ok('POST', `/api/sessions/${a.id}/close`, { method: 'promptpay', penalty: 20 });       // 747 + 50 + 20 = 817

  const b = await ok('POST', '/api/sessions', { table_id: t2, adults: 1 });
  await ok('POST', `/api/sessions/${b.id}/orders`, { items: [{ item_id: coke, qty: 4, mode: 'extra' }] });
  await ok('POST', `/api/sessions/${b.id}/close`, { method: 'cash', discount: 10 });          // 100 - 10 = 90

  await ok('POST', '/api/sessions', { table_id: t3, adults: 2 }); // ยังไม่ปิดบิล ไม่นับ

  const r = await ok('GET', `/api/report?from=${thaiToday()}`);
  assert.equal(r.total, 907);
  assert.equal(r.bills, 2);
  assert.equal(r.guests, 4);
  assert.equal(r.buffet, 747);
  assert.equal(r.extras, 150);
  assert.deepEqual(r.by_method, { promptpay: 817, cash: 90 });
  assert.deepEqual(r.items.find((i) => i.name === 'น้ำอัดลม'), { name: 'น้ำอัดลม', in_package: false, qty: 6, amount: 150 });
  assert.equal(r.by_day.length, 1);

  const yesterday = new Date(Date.now() + 7 * 3600000 - 86400000).toISOString().slice(0, 10);
  assert.equal((await ok('GET', `/api/report?from=${yesterday}&to=${yesterday}`)).bills, 0);
  assert.equal((await call('GET', '/api/report?from=2026-13-40')).status, 400);
  assert.equal((await call('GET', '/api/report?from=2025-01-01&to=2026-01-01')).status, 400);
});
