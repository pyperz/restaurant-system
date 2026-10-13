// ทดสอบลูกค้าสแกน QR ที่โต๊ะสั่งอาหารเอง
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startLocal } from './local.js';

const PORT = 3993, PIN = '778899', BASE = `http://localhost:${PORT}`;
let server;
before(async () => { server = await startLocal({ port: PORT, pin: PIN }); });
after(() => server.close());
const call = async (method, url, body, pin = PIN) => {
  const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(pin ? { 'x-pin': pin } : {}) }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json(), q: Number(r.headers.get('x-d1-queries')) };
};
const ok = async (...a) => { const r = await call(...a); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.ok(r.q <= 50, `ใช้ ${r.q} คำสั่ง`); return r.body; };
const pub = (m, u, b) => call(m, u, b, null); // ลูกค้า ไม่มี PIN

let pork, beer, rice, table, ses;
before(async () => {
  pork = (await ok('POST', '/api/menu', { name: 'หมูสามชั้น', category: 'หมู', price: '' })).id;
  beer = (await ok('POST', '/api/menu', { name: 'เบียร์', category: 'เครื่องดื่ม', price: 90 })).id;
  rice = (await ok('POST', '/api/menu', { name: 'ข้าวผัด', category: 'จานเดียว', price: 60 })).id;
  const pkg = (await ok('POST', '/api/packages', { name: 'บุฟเฟต์ 199', adult_price: 199, child_price: 99.5, duration_min: 90, item_ids: [pork] })).id;
  await ok('POST', '/api/tables/bulk', { count: 2, start: 1 });
  table = (await ok('GET', '/api/state')).tables[0].id;
  ses = await ok('POST', '/api/sessions', { table_id: table, package_id: pkg, adults: 2, children: 1 });
});

test('เปิดโต๊ะแล้วได้ QR และลูกค้าเห็นเมนูโดยไม่ต้องใช้ PIN', async () => {
  assert.match(ses.qr_token, /^[A-Za-z0-9_-]{16}$/);
  const r = await pub('GET', `/api/t/${ses.qr_token}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.table_name, 'โต๊ะ 1');
  assert.deepEqual(r.body.pkg_items.map((i) => i.name), ['หมูสามชั้น']);
  assert.deepEqual(r.body.extra_items.map((i) => i.name).sort(), ['ข้าวผัด', 'เบียร์']);
  assert.equal(r.body.bill.total, 497.5);
  assert.equal((await pub('GET', '/api/t/notarealtoken123')).status, 404);
  assert.equal((await pub('GET', '/api/state')).status, 401); // ส่วนอื่นยังต้องใช้ PIN
});

test('ลูกค้าสั่งได้ทั้งบุฟเฟต์และสั่งเพิ่ม → ขึ้นจอครัวพร้อมป้าย "ลูกค้าสั่งเอง"', async () => {
  const r = await pub('POST', `/api/t/${ses.qr_token}/orders`, { items: [{ item_id: pork, qty: 3, mode: 'pkg' }, { item_id: beer, qty: 2, mode: 'extra', note: 'เย็น ๆ' }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const live = await ok('GET', '/api/live');
  const o = live.orders.find((x) => x.session_id === ses.id);
  assert.equal(o.source, 'qr');
  assert.equal(o.items.find((i) => i.name === 'เบียร์').note, 'เย็น ๆ');
  // กันกดส่งรัว
  const again = await pub('POST', `/api/t/${ses.qr_token}/orders`, { items: [{ item_id: rice, qty: 1, mode: 'extra' }] });
  assert.equal(again.status, 400); assert.match(again.body.error, /รอสักครู่/);
  // ลูกค้าสั่งของที่ไม่อยู่ในแพ็กเกจแบบฟรีไม่ได้
  const cheat = await pub('POST', `/api/t/${ses.qr_token}/orders`, { items: [{ item_id: rice, qty: 1, mode: 'pkg' }] });
  assert.equal(cheat.status, 400);
  const view = await pub('GET', `/api/t/${ses.qr_token}?light`);
  assert.equal(view.body.bill.extras, 180);
  assert.equal(view.body.orders[0].items.length, 2);
  assert.equal(view.body.pkg_items, undefined); // แบบเบาไม่ส่งเมนูซ้ำ
  // ข้อมูลสำหรับบิลเบื้องต้นฝั่งลูกค้า: ราคาต่อหัว + ราคาต่อจานของที่สั่งเพิ่ม (ของในบุฟเฟต์ = 0)
  assert.ok(view.body.adults >= 1 && view.body.adult_price > 0);
  const extra = view.body.orders.flatMap((o) => o.items).filter((i) => !i.in_package);
  assert.equal(extra.reduce((a, i) => a + i.qty * i.price, 0), 180);
  assert.ok(view.body.orders.flatMap((o) => o.items).filter((i) => i.in_package).every((i) => i.price === 0));
});

test('เรียกพนักงาน / ขอเช็คบิล → ขึ้นที่ผังโต๊ะ และพนักงานรับทราบได้', async () => {
  await pub('POST', `/api/t/${ses.qr_token}/call`, { type: 'staff' });
  await pub('POST', `/api/t/${ses.qr_token}/call`, { type: 'bill' });
  let s = (await ok('GET', '/api/live')).sessions.find((x) => x.id === ses.id);
  assert.ok(s.call_staff_at > 0 && s.call_bill_at > 0);
  await ok('POST', `/api/sessions/${ses.id}/ack`);
  s = (await ok('GET', '/api/live')).sessions.find((x) => x.id === ses.id);
  assert.equal(s.call_staff_at, 0); assert.equal(s.call_bill_at, 0);
});

test('สร้าง QR ใหม่แล้ว QR เก่าใช้ไม่ได้ · ปิดบิลแล้ว QR หมดอายุ · ปิดฟีเจอร์ได้', async () => {
  const old = ses.qr_token;
  const fresh = (await ok('POST', `/api/sessions/${ses.id}/qr`)).qr_token;
  assert.notEqual(fresh, old);
  assert.equal((await pub('GET', `/api/t/${old}`)).status, 404);
  await ok('PUT', '/api/settings', { qr_order_on: '0' });
  assert.equal((await pub('POST', `/api/t/${fresh}/orders`, { items: [{ item_id: rice, qty: 1, mode: 'extra' }] })).status, 400);
  await ok('PUT', '/api/settings', { qr_order_on: '1' });
  await ok('POST', `/api/sessions/${ses.id}/close`, { method: 'cash' });
  assert.equal((await pub('GET', `/api/t/${fresh}`)).status, 404);
});

test('หมดเวลาบุฟเฟต์: ลูกค้าสั่งรายการในแพ็กเกจไม่ได้ แต่สั่งเพิ่มได้', async () => {
  const pkg2 = (await ok('POST', '/api/packages', { name: 'บุฟเฟต์ทดสอบ', adult_price: 100, duration_min: 1, item_ids: [pork] })).id;
  const tables = (await ok('GET', '/api/state')).tables;
  const s2 = await ok('POST', '/api/sessions', { table_id: tables[1].id, package_id: pkg2, adults: 1 });
  // ย้อนเวลาเปิดโต๊ะไป 2 นาที (จำลองว่าเกินเวลาแล้ว)
  await server.env.DB.prepare('UPDATE sessions SET opened_at = ? WHERE id = ?').bind(Date.now() - 120000, s2.id).run();
  const late = await pub('POST', `/api/t/${s2.qr_token}/orders`, { items: [{ item_id: pork, qty: 1, mode: 'pkg' }] });
  assert.equal(late.status, 400); assert.match(late.body.error, /หมดเวลา/);
  const extra = await pub('POST', `/api/t/${s2.qr_token}/orders`, { items: [{ item_id: beer, qty: 1, mode: 'extra' }] });
  assert.equal(extra.status, 200);
  // พนักงานยังสั่งรายการในแพ็กเกจให้ได้ (เช่น ขยายเวลาให้ลูกค้า)
  await ok('POST', `/api/sessions/${s2.id}/orders`, { items: [{ item_id: pork, qty: 1, mode: 'pkg' }] });
});
