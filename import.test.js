// ทดสอบนำเข้าเมนู และจำนวนคำสั่งฐานข้อมูลต่อครั้งไม่เกินโควตาแบบฟรี (50)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startLocal } from './local.js';

const PORT = 3994, PIN = '445566', BASE = `http://localhost:${PORT}`;
let server;
before(async () => { server = await startLocal({ port: PORT, pin: PIN }); });
after(() => server.close());
const call = async (method, url, body) => {
  const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', 'x-pin': PIN }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json(), q: Number(r.headers.get('x-d1-queries')) };
};
const ok = async (...a) => { const r = await call(...a); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.ok(r.q <= 50, `ใช้ ${r.q} คำสั่ง`); return r.body; };

test('นำเข้าแพ็กเกจและเมนูเป็นชุด แล้วนำเข้าซ้ำได้โดยไม่ซ้ำ', async () => {
  await ok('GET', '/api/state'); // สร้างตาราง
  const packages = [{ name: 'บุฟเฟต์ 199', adult_price: 199, duration_min: 90 }, { name: 'บุฟเฟต์ 299', adult_price: 299, child_price: 149, duration_min: 120 }];
  assert.deepEqual(await ok('POST', '/api/import/packages', { packages }), { created: 2, updated: 0 });
  const items = [
    { name: 'หมูสามชั้น', category: 'หมู', price: null, packages: ['บุฟเฟต์ 199', 'บุฟเฟต์ 299'] },
    { name: 'ไทยวากิว', category: 'เนื้อ', price: null, packages: ['บุฟเฟต์ 299'] },
    ...Array.from({ length: 8 }, (_, i) => ({ name: `ยำ ${i}`, category: 'ทานเล่น', price: 80 + i, packages: [] })),
  ];
  const names = packages.map((p) => p.name);
  const r = await ok('POST', '/api/import/items', { items, package_names: names });
  assert.equal(r.created, 10);
  let s = (await ok('GET', '/api/state'));
  const p299 = s.packages.find((p) => p.name === 'บุฟเฟต์ 299'), p199 = s.packages.find((p) => p.name === 'บุฟเฟต์ 199');
  assert.equal(p299.item_ids.length, 2); assert.equal(p199.item_ids.length, 1);
  assert.equal(p299.child_price, 149);
  assert.equal(s.menu.find((m) => m.name === 'ยำ 3').price, 83);

  // นำเข้าซ้ำ (แก้ราคา/ย้ายแพ็กเกจ) → อัปเดต ไม่สร้างซ้ำ
  items[1].packages = ['บุฟเฟต์ 199', 'บุฟเฟต์ 299']; items[2].price = 99;
  assert.deepEqual(await ok('POST', '/api/import/packages', { packages }), { created: 0, updated: 2 });
  const r2 = await ok('POST', '/api/import/items', { items, package_names: names });
  assert.equal(r2.created, 0); assert.equal(r2.updated, 10);
  s = await ok('GET', '/api/state');
  assert.equal(s.menu.length, 10);
  assert.equal(s.packages.find((p) => p.name === 'บุฟเฟต์ 199').item_ids.length, 2);
  assert.equal(s.menu.find((m) => m.name === 'ยำ 0').price, 99);
  assert.equal((await call('POST', '/api/import/items', { items: Array(11).fill(items[0]) })).status, 400);
});

test('งานหนักอื่น ๆ ไม่เกินโควตาคำสั่ง', async () => {
  await ok('POST', '/api/tables/bulk', { count: 100, start: 1 });
  const s = await ok('GET', '/api/state');
  assert.equal(s.tables.length, 100);
  const ses = await ok('POST', '/api/sessions', { table_id: s.tables[0].id, adults: 2 });
  const extra = s.menu.filter((m) => m.price !== null);
  await ok('POST', `/api/sessions/${ses.id}/orders`, { items: Array.from({ length: 40 }, (_, i) => ({ item_id: extra[i % extra.length].id, qty: 1, mode: 'extra' })) });
  await ok('GET', '/api/live');
  await ok('GET', '/api/report');
});
