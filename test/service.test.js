// ทดสอบส่วนหน้าร้าน: เปิดโต๊ะ สั่งอาหาร ครัว คิดเงิน
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startLocal } from './local.js';

const PORT = 3998, PIN = '135790', BASE = `http://localhost:${PORT}`;
let server;
before(async () => { server = await startLocal({ port: PORT, pin: PIN }); });
after(() => server.close());

const call = async (method, url, body) => {
  const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', 'x-pin': PIN }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const ok = async (...a) => { const r = await call(...a); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };

let pork, shrimp, coke, rice, pkg, t1, t2;
before(async () => {
  pork = (await ok('POST', '/api/menu', { name: 'หมูสามชั้น', price: 120 })).id;
  shrimp = (await ok('POST', '/api/menu', { name: 'กุ้งสด', price: 150 })).id;
  coke = (await ok('POST', '/api/menu', { name: 'น้ำอัดลม', price: 25 })).id;
  rice = (await ok('POST', '/api/menu', { name: 'ผักรวม', price: '' })).id; // ไม่ขายแยก
  pkg = (await ok('POST', '/api/packages', { name: 'หมูกระทะ', adult_price: 299, child_price: 149, duration_min: 90, max_per_round: 6, item_ids: [pork, rice] })).id;
  await ok('POST', '/api/tables/bulk', { count: 2, start: 1 });
  [t1, t2] = (await ok('GET', '/api/state')).tables.map((t) => t.id);
});

test('เปิดโต๊ะบุฟเฟต์ และเปิดซ้ำไม่ได้', async () => {
  const s = await ok('POST', '/api/sessions', { table_id: t1, package_id: pkg, adults: 3, children: 1 });
  const dup = await call('POST', '/api/sessions', { table_id: t1, package_id: pkg, adults: 2 });
  assert.equal(dup.status, 400); assert.match(dup.body.error, /มีลูกค้าอยู่แล้ว/);
  assert.equal((await call('POST', '/api/sessions', { table_id: t2, adults: 0, children: 0 })).status, 400);
  const live = await ok('GET', '/api/live');
  const ses = live.sessions.find((x) => x.id === s.id);
  assert.equal(ses.ends_at - ses.opened_at, 90 * 60000);
  assert.equal((await call('DELETE', `/api/tables/${t1}`)).status, 400); // มีลูกค้าอยู่ ลบโต๊ะไม่ได้
});

test('สั่งอาหาร: แยกในแพ็กเกจกับสั่งเพิ่ม และตรวจเงื่อนไข', async () => {
  const sid = (await ok('GET', '/api/live')).sessions.find((x) => x.table_id === t1).id;
  // ของนอกแพ็กเกจ ห้ามสั่งแบบฟรี
  let r = await call('POST', `/api/sessions/${sid}/orders`, { items: [{ item_id: shrimp, qty: 1, mode: 'pkg' }] });
  assert.equal(r.status, 400); assert.match(r.body.error, /ไม่ได้อยู่ในแพ็กเกจ/);
  // ของไม่ขายแยก ห้ามสั่งเพิ่มแบบคิดเงิน
  r = await call('POST', `/api/sessions/${sid}/orders`, { items: [{ item_id: rice, qty: 1, mode: 'extra' }] });
  assert.equal(r.status, 400);
  // เกินจำนวนจานต่อรอบ
  r = await call('POST', `/api/sessions/${sid}/orders`, { items: [{ item_id: pork, qty: 5, mode: 'pkg' }, { item_id: rice, qty: 2, mode: 'pkg' }] });
  assert.equal(r.status, 400); assert.match(r.body.error, /ไม่เกิน 6 จาน/);

  const o1 = await ok('POST', `/api/sessions/${sid}/orders`, { items: [{ item_id: pork, qty: 4, mode: 'pkg', note: 'ไม่เอามัน' }, { item_id: coke, qty: 2, mode: 'extra' }] });
  assert.equal(o1.round_no, 1);
  const o2 = await ok('POST', `/api/sessions/${sid}/orders`, { items: [{ item_id: shrimp, qty: 1, mode: 'extra' }] });
  assert.equal(o2.round_no, 2);

  // เมนูหมด สั่งไม่ได้
  await ok('PUT', `/api/menu/${coke}`, { name: 'น้ำอัดลม', price: 25, available: false });
  r = await call('POST', `/api/sessions/${sid}/orders`, { items: [{ item_id: coke, qty: 1, mode: 'extra' }] });
  assert.match(r.body.error, /หมดแล้ว/);
  await ok('PUT', `/api/menu/${coke}`, { name: 'น้ำอัดลม', price: 25, available: true });

  // บิล: บุฟเฟต์ 3×299 + 1×149 = 1046, สั่งเพิ่ม 2×25 + 150 = 200
  const d = await ok('GET', `/api/sessions/${sid}`);
  assert.deepEqual(d.bill, { buffet: 1046, extras: 200, penalty: 0, discount: 0, total: 1246 });

  // ยกเลิกรอบ 2 → ยอดสั่งเพิ่มลดลง และไม่ขึ้นจอครัว
  await ok('PUT', `/api/orders/${o2.id}/status`, { status: 'cancelled' });
  assert.equal((await ok('GET', `/api/sessions/${sid}`)).bill.extras, 50);
  const live = await ok('GET', '/api/live');
  assert.deepEqual(live.orders.map((o) => o.id), [o1.id]);
  assert.equal(live.orders[0].items.find((i) => i.name === 'หมูสามชั้น').note, 'ไม่เอามัน');

  // ครัวเลื่อนสถานะ
  await ok('PUT', `/api/orders/${o1.id}/status`, { status: 'cooking' });
  assert.equal((await ok('GET', '/api/live')).orders[0].status, 'cooking');
  assert.equal((await call('PUT', `/api/orders/${o1.id}/status`, { status: 'eaten' })).status, 400);
});

test('คิดเงินและปิดโต๊ะ', async () => {
  const sid = (await ok('GET', '/api/live')).sessions.find((x) => x.table_id === t1).id;
  assert.equal((await call('POST', `/api/sessions/${sid}/close`, {})).status, 400); // ยังไม่เลือกวิธีจ่าย
  const r = await ok('POST', `/api/sessions/${sid}/close`, { method: 'promptpay', discount: 46, penalty: 100 });
  assert.equal(r.bill.total, 1046 + 50 + 100 - 46);
  const live = await ok('GET', '/api/live');
  assert.equal(live.sessions.length, 0);
  assert.equal(live.orders.length, 0); // ออเดอร์ค้างถูกปิดไปด้วย
  assert.equal((await call('POST', `/api/sessions/${sid}/orders`, { items: [{ item_id: coke, qty: 1, mode: 'extra' }] })).status, 400);
  // เปิดโต๊ะเดิมใหม่ได้หลังปิดบิล และลบโต๊ะได้แล้ว (ประวัติบิลยังอยู่)
  await ok('POST', '/api/sessions', { table_id: t1, adults: 2 });
});

test('โต๊ะสั่งตามเมนู (ไม่ใช่บุฟเฟต์) และยกเลิกโต๊ะที่เปิดผิด', async () => {
  const s = await ok('POST', '/api/sessions', { table_id: t2, adults: 2 });
  const r = await call('POST', `/api/sessions/${s.id}/orders`, { items: [{ item_id: pork, qty: 1, mode: 'pkg' }] });
  assert.equal(r.status, 400);
  await ok('DELETE', `/api/sessions/${s.id}`);
  const s2 = await ok('POST', '/api/sessions', { table_id: t2, adults: 1 });
  await ok('POST', `/api/sessions/${s2.id}/orders`, { items: [{ item_id: pork, qty: 2, mode: 'extra' }] });
  assert.equal((await call('DELETE', `/api/sessions/${s2.id}`)).status, 400);
  const d = await ok('GET', `/api/sessions/${s2.id}`);
  assert.equal(d.bill.total, 240);
});
