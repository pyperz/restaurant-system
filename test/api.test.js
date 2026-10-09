// ทดสอบ API อัตโนมัติ: รันด้วย  npm test
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3999;
const PIN = '4321';
const BASE = `http://localhost:${PORT}`;
let proc, dir;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-'));
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT, ADMIN_PIN: PIN, DATA_DIR: dir }, stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE + '/'); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});
after(() => { proc.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const call = async (method, url, body, pin = PIN) => {
  const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', 'x-pin': pin }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

test('ต้องใส่ PIN ถูกถึงจะเข้าได้', async () => {
  assert.equal((await call('GET', '/api/state', null, 'wrong')).status, 401);
  assert.equal((await call('POST', '/api/login', { pin: PIN })).status, 200);
});

test('เพิ่มเมนู แพ็กเกจ และผูกรายการกัน', async () => {
  const pork = (await call('POST', '/api/menu', { name: 'หมูสามชั้น', category: 'เนื้อสัตว์', price: 120 })).body.id;
  const coke = (await call('POST', '/api/menu', { name: 'น้ำอัดลม', category: 'เครื่องดื่ม', price: 25.5 })).body.id;
  const pkg = (await call('POST', '/api/packages', { name: 'หมูกระทะ', adult_price: 299, child_price: 149, duration_min: 90, item_ids: [pork] })).body.id;
  const s = (await call('GET', '/api/state')).body;
  assert.deepEqual(s.packages.find((p) => p.id === pkg).item_ids, [pork]);
  assert.equal(s.menu.find((m) => m.id === coke).price, 25.5);
  assert.equal(s.packages[0].adult_price, 299);

  // เปลี่ยนจากหน้าเมนู: ให้น้ำอัดลมอยู่ในแพ็กเกจด้วย
  await call('PUT', `/api/menu/${coke}`, { name: 'น้ำอัดลม', category: 'เครื่องดื่ม', price: 25.5, package_ids: [pkg] });
  const s2 = (await call('GET', '/api/state')).body;
  assert.deepEqual(s2.packages[0].item_ids.sort(), [pork, coke].sort());

  // ลบเมนูแล้ว รายการในแพ็กเกจต้องหายตาม
  await call('DELETE', `/api/menu/${coke}`);
  assert.deepEqual((await call('GET', '/api/state')).body.packages[0].item_ids, [pork]);
});

test('สลับเมนูหมด/พร้อมขาย และเมนูที่ไม่ขายแยก', async () => {
  const id = (await call('POST', '/api/menu', { name: 'ผักรวม', price: '' })).body.id;
  await call('PUT', `/api/menu/${id}`, { name: 'ผักรวม', price: null, available: false });
  const m = (await call('GET', '/api/state')).body.menu.find((x) => x.id === id);
  assert.equal(m.available, false);
  assert.equal(m.price, null);
});

test('เพิ่มโต๊ะทีละหลายโต๊ะ และแก้ไขได้', async () => {
  await call('POST', '/api/tables/bulk', { count: 3, start: 1, seats: 4, prefix: 'โต๊ะ' });
  let t = (await call('GET', '/api/state')).body.tables;
  assert.deepEqual(t.map((x) => x.name), ['โต๊ะ 1', 'โต๊ะ 2', 'โต๊ะ 3']);
  await call('PUT', `/api/tables/${t[1].id}`, { name: 'โต๊ะ VIP', seats: 8, zone: 'ชั้น 2' });
  t = (await call('GET', '/api/state')).body.tables;
  assert.equal(t[1].name, 'โต๊ะ VIP');
  assert.equal(t[1].seats, 8);
});

test('ข้อมูลผิดต้องถูกปฏิเสธพร้อมข้อความภาษาไทย', async () => {
  const r1 = await call('POST', '/api/menu', { name: '  ' });
  assert.equal(r1.status, 400); assert.match(r1.body.error, /ชื่อเมนู/);
  const r2 = await call('POST', '/api/packages', { name: 'x', adult_price: -5 });
  assert.equal(r2.status, 400);
  const r3 = await call('POST', '/api/tables/bulk', { count: 0 });
  assert.equal(r3.status, 400);
  assert.equal((await call('DELETE', '/api/tables/99999')).status, 400);
});

test('ไม่ให้เข้าถึงไฟล์นอกโฟลเดอร์หน้าเว็บ', async () => {
  const r = await fetch(BASE + '/..%2Fserver.js');
  assert.notEqual(r.status, 200);
});
