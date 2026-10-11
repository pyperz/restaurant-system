// ทดสอบตั้งเงินทอน + ปิดร้านสรุปยอด
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startLocal } from './local.js';

const PORT = 3994, PIN = '111222', BASE = `http://localhost:${PORT}`;
let server;
before(async () => { server = await startLocal({ port: PORT, pin: PIN }); });
after(() => server.close());
const call = async (method, url, body) => {
  const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', 'x-pin': PIN }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const ok = async (...a) => { const r = await call(...a); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };

test('ตั้งเงินทอน → ขาย → ปิดร้านสรุปยอด (เงินขาด/เกิน)', async () => {
  let st = await ok('GET', '/api/shift');
  assert.equal(st.shift, null);
  st = await ok('POST', '/api/shift/float', { float: 1000 });
  assert.equal(st.shift.float, 1000);
  st = await ok('POST', '/api/shift/float', { float: 1500 }); // แก้เงินทอน ไม่เปิดกะซ้ำ
  assert.equal(st.shift.float, 1500);
  assert.equal((await call('POST', '/api/shift/float', { float: -5 })).status, 400);

  const coke = (await ok('POST', '/api/menu', { name: 'โค้ก', price: 25 })).id;
  await ok('POST', '/api/tables/bulk', { count: 2, start: 1 });
  const [t1, t2] = (await ok('GET', '/api/state')).tables.map((t) => t.id);
  const s1 = await ok('POST', '/api/sessions', { table_id: t1, adults: 1 });
  await ok('POST', `/api/sessions/${s1.id}/orders`, { items: [{ item_id: coke, qty: 4, mode: 'extra' }] });
  await ok('POST', `/api/sessions/${s1.id}/close`, { method: 'cash', received: 100 });
  const s2 = await ok('POST', '/api/sessions', { table_id: t2, adults: 2 });
  await ok('POST', `/api/sessions/${s2.id}/orders`, { items: [{ item_id: coke, qty: 2, mode: 'extra' }] });
  await ok('POST', `/api/sessions/${s2.id}/close`, { method: 'promptpay' });
  await ok('POST', '/api/sessions', { table_id: t1, adults: 1 }); // ยังเปิดอยู่ 1 โต๊ะ

  st = await ok('GET', '/api/shift');
  assert.equal(st.live.total, 150); assert.equal(st.live.cash, 100); assert.equal(st.live.expected_cash, 1600);
  assert.equal(st.live.bills, 2); assert.equal(st.live.guests, 3); assert.equal(st.live.open_tables, 1);
  assert.deepEqual(st.live.by_method, { cash: 100, promptpay: 50 });

  const c = await ok('POST', '/api/shift/close', { counted: 1580 });
  assert.equal(c.summary.diff, -20); assert.equal(c.summary.counted, 1580);
  st = await ok('GET', '/api/shift');
  assert.equal(st.shift, null); assert.equal(st.live.total, 0); // กะใหม่เริ่มนับจากตอนปิดร้าน
  assert.equal(st.history.length, 1); assert.equal(st.history[0].summary.total, 150);

  // ไม่ได้ตั้งเงินทอน ก็ปิดร้านได้ (เงินทอน 0)
  const c2 = await ok('POST', '/api/shift/close', {});
  assert.equal(c2.summary.float, 0); assert.equal(c2.summary.counted, null);
});
