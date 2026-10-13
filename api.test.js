// ทดสอบ API อัตโนมัติ: รันด้วย  npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startLocal } from './local.js';

const PORT = 3999, PIN = '864213', BASE = `http://localhost:${PORT}`;
let server;
before(async () => { server = await startLocal({ port: PORT, pin: PIN }); });
after(() => server.close());

const call = async (method, url, body, pin = PIN) => {
  const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', 'x-pin': pin }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const state = async () => (await call('GET', '/api/state')).body;

test('ต้องใส่ PIN ถูกถึงจะเข้าได้', async () => {
  assert.equal((await call('GET', '/api/state', null, 'wrong')).status, 401);
  assert.equal((await call('POST', '/api/login', { pin: PIN })).status, 200);
  assert.equal((await call('POST', '/api/login', { pin: 'nope' })).status, 401);
});

test('เพิ่มเมนู แพ็กเกจ และผูกรายการกัน', async () => {
  const pork = (await call('POST', '/api/menu', { name: 'หมูสามชั้น', category: 'เนื้อสัตว์', price: 120 })).body.id;
  const coke = (await call('POST', '/api/menu', { name: 'น้ำอัดลม', category: 'เครื่องดื่ม', price: 25.5 })).body.id;
  const pkg = (await call('POST', '/api/packages', { name: 'หมูกระทะ', adult_price: 299, child_price: 149, duration_min: 90, item_ids: [pork] })).body.id;
  let s = await state();
  assert.deepEqual(s.packages.find((p) => p.id === pkg).item_ids, [pork]);
  assert.equal(s.menu.find((m) => m.id === coke).price, 25.5);
  assert.equal(s.packages[0].adult_price, 299);

  await call('PUT', `/api/menu/${coke}`, { name: 'น้ำอัดลม', category: 'เครื่องดื่ม', price: 25.5, package_ids: [pkg] });
  s = await state();
  assert.deepEqual(s.packages[0].item_ids.sort(), [pork, coke].sort());

  await call('DELETE', `/api/menu/${coke}`);
  assert.deepEqual((await state()).packages[0].item_ids, [pork]);
});

test('อัปโหลด เปลี่ยน และลบรูปเมนู', async () => {
  const id = (await call('POST', '/api/menu', { name: 'ข้าวผัด', price: 60 })).body.id;
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const up = (type, body) => fetch(`${BASE}/api/menu/${id}/image`, { method: 'PUT', headers: { 'Content-Type': type, 'x-pin': PIN }, body });

  assert.equal((await up('text/html', '<b>x</b>')).status, 400);
  assert.equal((await up('image/png', png)).status, 200);
  let m = (await state()).menu.find((x) => x.id === id);
  assert.match(m.image, new RegExp(`^/img/${id}\\?v=1$`));
  const img = await fetch(BASE + m.image);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), png);

  await up('image/png', png);
  m = (await state()).menu.find((x) => x.id === id);
  assert.match(m.image, /\?v=2$/);

  await call('DELETE', `/api/menu/${id}/image`);
  assert.equal((await state()).menu.find((x) => x.id === id).image, null);
  assert.equal((await fetch(`${BASE}/img/${id}`)).status, 404);

  // ลบเมนูแล้วรูปต้องหายตาม
  await up('image/png', png);
  await call('DELETE', `/api/menu/${id}`);
  assert.equal((await fetch(`${BASE}/img/${id}`)).status, 404);
});

test('สลับเมนูหมด/พร้อมขาย และเมนูที่ไม่ขายแยก', async () => {
  const id = (await call('POST', '/api/menu', { name: 'ผักรวม', price: '' })).body.id;
  await call('PUT', `/api/menu/${id}`, { name: 'ผักรวม', price: null, available: false });
  const m = (await state()).menu.find((x) => x.id === id);
  assert.equal(m.available, false);
  assert.equal(m.price, null);
});

test('เพิ่มโต๊ะทีละหลายโต๊ะ และแก้ไขได้', async () => {
  await call('POST', '/api/tables/bulk', { count: 3, start: 1, seats: 4, prefix: 'โต๊ะ' });
  let t = (await state()).tables;
  assert.deepEqual(t.map((x) => x.name), ['โต๊ะ 1', 'โต๊ะ 2', 'โต๊ะ 3']);
  await call('PUT', `/api/tables/${t[1].id}`, { name: 'โต๊ะ VIP', seats: 8, zone: 'ชั้น 2' });
  t = (await state()).tables;
  assert.equal(t[1].name, 'โต๊ะ VIP');
  assert.equal(t[1].seats, 8);
});

test('ข้อมูลผิดต้องถูกปฏิเสธพร้อมข้อความภาษาไทย', async () => {
  const r1 = await call('POST', '/api/menu', { name: '  ' });
  assert.equal(r1.status, 400); assert.match(r1.body.error, /ชื่อเมนู/);
  assert.equal((await call('POST', '/api/packages', { name: 'x', adult_price: -5 })).status, 400);
  assert.equal((await call('POST', '/api/tables/bulk', { count: 0 })).status, 400);
  assert.equal((await call('DELETE', '/api/tables/99999')).status, 400);
});

test('ใส่ PIN ผิด 5 ครั้งต้องโดนล็อก', async () => {
  for (let i = 0; i < 5; i++) await call('POST', '/api/login', { pin: 'bad' });
  assert.equal((await call('POST', '/api/login', { pin: PIN })).status, 429);
});
