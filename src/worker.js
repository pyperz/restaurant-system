// ระบบร้านอาหาร — เซิร์ฟเวอร์บน Cloudflare Workers + ฐานข้อมูล D1
// ส่วนที่ 1: ข้อมูลร้าน (เมนู + รูป, แพ็กเกจบุฟเฟต์, โต๊ะ)  ·  ส่วนที่ 2 อยู่ใน service.js

import { all, first, run, HttpError, bad, text, int, baht, toBaht, idList, readJson } from './lib.js';
import { SERVICE_SCHEMA, serviceRoutes, checkTableDeletable, getSettings } from './service.js';

// ---------- ฐานข้อมูล ----------
// สร้างตารางให้อัตโนมัติครั้งแรกที่ระบบทำงาน ไม่ต้องไปพิมพ์คำสั่งเอง
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS dining_tables (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, seats INTEGER NOT NULL DEFAULT 4,
    zone TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
    price_satang INTEGER, available INTEGER NOT NULL DEFAULT 1,
    image_v INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS menu_images (
    item_id INTEGER PRIMARY KEY REFERENCES menu_items(id) ON DELETE CASCADE,
    mime TEXT NOT NULL, data BLOB NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS packages (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, adult_satang INTEGER NOT NULL,
    child_satang INTEGER NOT NULL DEFAULT 0, duration_min INTEGER NOT NULL DEFAULT 90,
    max_per_round INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS package_items (
    package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    PRIMARY KEY (package_id, item_id))`,
  `CREATE TABLE IF NOT EXISTS login_fails (
    ip TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL)`,
];
let schemaReady = null;
function ensureSchema(db) {
  if (!schemaReady) schemaReady = db.batch([...SCHEMA, ...SERVICE_SCHEMA].map((s) => db.prepare(s))).catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}

// ---------- อ่านข้อมูลทั้งหมด ----------
async function getState(db) {
  const [settings, tables, menu, links, packages] = await Promise.all([
    getSettings(db),
    all(db, 'SELECT id, name, seats, zone FROM dining_tables ORDER BY sort, id'),
    all(db, 'SELECT * FROM menu_items ORDER BY category, sort, id'),
    all(db, 'SELECT package_id, item_id FROM package_items'),
    all(db, 'SELECT * FROM packages ORDER BY sort, id'),
  ]);
  return {
    settings,
    tables,
    menu: menu.map((m) => ({
      id: m.id, name: m.name, category: m.category, price: toBaht(m.price_satang), available: !!m.available,
      image: m.image_v ? `/img/${m.id}?v=${m.image_v}` : null,
    })),
    packages: packages.map((p) => ({
      id: p.id, name: p.name, adult_price: toBaht(p.adult_satang), child_price: toBaht(p.child_satang),
      duration_min: p.duration_min, max_per_round: p.max_per_round, active: !!p.active,
      item_ids: links.filter((l) => l.package_id === p.id).map((l) => l.item_id),
    })),
  };
}

const nextSort = async (db, table) => (await first(db, `SELECT COALESCE(MAX(sort),0)+1 AS n FROM ${table}`)).n;

// ---------- โต๊ะ ----------
function tableFields(b) {
  return [text(b.name, 'ชื่อโต๊ะ', { max: 30 }), int(b.seats, 'จำนวนที่นั่ง', { min: 1, max: 50, fallback: 4 }),
    text(b.zone, 'โซน', { required: false, max: 30 })];
}
async function saveTable(db, b, id) {
  const v = tableFields(b);
  if (id) {
    const r = await run(db, 'UPDATE dining_tables SET name=?, seats=?, zone=? WHERE id=?', ...v, id);
    if (!r.meta.changes) throw bad('ไม่พบโต๊ะนี้');
    return id;
  }
  const r = await run(db, 'INSERT INTO dining_tables (name, seats, zone, sort) VALUES (?,?,?,?)', ...v, await nextSort(db, 'dining_tables'));
  return r.meta.last_row_id;
}
async function bulkTables(db, b) {
  const count = int(b.count, 'จำนวนโต๊ะ', { min: 1, max: 100 });
  const start = int(b.start, 'เลขเริ่มต้น', { min: 0, max: 9999, fallback: 1 });
  const prefix = text(b.prefix ?? 'โต๊ะ', 'คำนำหน้า', { required: false, max: 20 });
  const seats = int(b.seats, 'จำนวนที่นั่ง', { min: 1, max: 50, fallback: 4 });
  const zone = text(b.zone, 'โซน', { required: false, max: 30 });
  const s0 = await nextSort(db, 'dining_tables');
  const ins = db.prepare('INSERT INTO dining_tables (name, seats, zone, sort) VALUES (?,?,?,?)');
  await db.batch(Array.from({ length: count }, (_, i) => ins.bind(`${prefix} ${start + i}`.trim(), seats, zone, s0 + i)));
}

// ---------- เมนู ----------
async function saveMenuItem(db, b, id) {
  const v = [text(b.name, 'ชื่อเมนู', { max: 80 }), text(b.category, 'หมวด', { required: false, max: 40 }),
    baht(b.price, 'ราคา', { optional: true }), b.available === false ? 0 : 1];
  const pkgIds = idList(b.package_ids, 'แพ็กเกจ');
  if (id) {
    const r = await run(db, 'UPDATE menu_items SET name=?, category=?, price_satang=?, available=? WHERE id=?', ...v, id);
    if (!r.meta.changes) throw bad('ไม่พบเมนูนี้');
  } else {
    id = (await run(db, 'INSERT INTO menu_items (name, category, price_satang, available, sort) VALUES (?,?,?,?,?)', ...v, await nextSort(db, 'menu_items'))).meta.last_row_id;
  }
  // เลือกแพ็กเกจที่เมนูนี้อยู่ได้จากหน้าเมนูด้วย
  if (pkgIds) {
    const ins = db.prepare('INSERT OR IGNORE INTO package_items (package_id, item_id) SELECT id, ? FROM packages WHERE id=?');
    await db.batch([db.prepare('DELETE FROM package_items WHERE item_id=?').bind(id), ...pkgIds.map((p) => ins.bind(id, p))]);
  }
  return id;
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE = 1_500_000; // หน้าเว็บย่อรูปให้ก่อนส่ง ปกติจะเหลือไม่ถึง 150 KB

async function putImage(db, req, id) {
  const mime = (req.headers.get('content-type') || '').split(';')[0].trim();
  if (!IMAGE_TYPES.has(mime)) throw bad('รองรับเฉพาะรูป JPG, PNG หรือ WEBP');
  const buf = await req.arrayBuffer();
  if (!buf.byteLength) throw bad('ไม่พบไฟล์รูป');
  if (buf.byteLength > MAX_IMAGE) throw bad('รูปใหญ่เกินไป');
  if (!(await first(db, 'SELECT id FROM menu_items WHERE id=?', id))) throw bad('ไม่พบเมนูนี้');
  await db.batch([
    db.prepare('INSERT OR REPLACE INTO menu_images (item_id, mime, data) VALUES (?,?,?)').bind(id, mime, buf),
    db.prepare('UPDATE menu_items SET image_v = image_v + 1 WHERE id=?').bind(id),
  ]);
}
async function deleteImage(db, id) {
  await db.batch([
    db.prepare('DELETE FROM menu_images WHERE item_id=?').bind(id),
    db.prepare('UPDATE menu_items SET image_v = 0 WHERE id=?').bind(id),
  ]);
}
async function getImage(db, id) {
  const row = await first(db, 'SELECT mime, data FROM menu_images WHERE item_id=?', id);
  if (!row) return new Response('ไม่พบรูป', { status: 404 });
  const body = row.data instanceof ArrayBuffer ? row.data : new Uint8Array(row.data);
  // ลิงก์รูปมีเลขเวอร์ชัน (?v=) จึงเก็บแคชได้นาน เปลี่ยนรูปแล้วลิงก์ก็เปลี่ยนตาม
  return new Response(body, { headers: { 'Content-Type': row.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
}

// ---------- แพ็กเกจ ----------
async function savePackage(db, b, id) {
  const v = [text(b.name, 'ชื่อแพ็กเกจ', { max: 60 }), baht(b.adult_price, 'ราคาผู้ใหญ่'),
    baht(b.child_price ?? 0, 'ราคาเด็ก'), int(b.duration_min, 'เวลาทาน', { min: 0, max: 1440, fallback: 90 }),
    int(b.max_per_round, 'จำกัดจานต่อรอบ', { min: 0, max: 999, fallback: 0 }), b.active === false ? 0 : 1];
  const itemIds = idList(b.item_ids, 'รายการอาหาร');
  if (id) {
    const r = await run(db, 'UPDATE packages SET name=?, adult_satang=?, child_satang=?, duration_min=?, max_per_round=?, active=? WHERE id=?', ...v, id);
    if (!r.meta.changes) throw bad('ไม่พบแพ็กเกจนี้');
  } else {
    id = (await run(db, 'INSERT INTO packages (name, adult_satang, child_satang, duration_min, max_per_round, active, sort) VALUES (?,?,?,?,?,?,?)', ...v, await nextSort(db, 'packages'))).meta.last_row_id;
  }
  if (itemIds) {
    const ins = db.prepare('INSERT OR IGNORE INTO package_items (package_id, item_id) SELECT ?, id FROM menu_items WHERE id=?');
    await db.batch([db.prepare('DELETE FROM package_items WHERE package_id=?').bind(id), ...itemIds.map((i) => ins.bind(id, i))]);
  }
  return id;
}

async function remove(db, table, id) {
  const r = await run(db, `DELETE FROM ${table} WHERE id=?`, id);
  if (!r.meta.changes) throw bad('ไม่พบข้อมูลนี้');
}

// ---------- รหัส PIN (กันการเดารหัส: ผิด 5 ครั้ง ล็อก 5 นาที) ----------
async function pinOk(env, pin) {
  const want = String(env.ADMIN_PIN || '');
  if (!want) throw new HttpError(500, 'ยังไม่ได้ตั้งรหัส ADMIN_PIN ในหน้าตั้งค่าของ Cloudflare');
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(String(pin || ''))), crypto.subtle.digest('SHA-256', enc.encode(want))]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
async function requirePin(req, env, db, pin) {
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  const f = await first(db, 'SELECT n, until FROM login_fails WHERE ip=?', ip);
  if (f && f.until > Date.now()) throw new HttpError(429, 'ใส่รหัสผิดหลายครั้ง กรุณารอ 5 นาที');
  if (!(await pinOk(env, pin))) {
    const n = (f?.n || 0) + 1;
    await run(db, 'INSERT OR REPLACE INTO login_fails (ip, n, until) VALUES (?,?,?)', ip, n >= 5 ? 0 : n, n >= 5 ? Date.now() + 5 * 60 * 1000 : 0);
    throw new HttpError(401, req.url.endsWith('/api/login') ? 'รหัสไม่ถูกต้อง' : 'กรุณาเข้าสู่ระบบ');
  }
  if (f) await run(db, 'DELETE FROM login_fails WHERE ip=?', ip); // เขียนฐานข้อมูลเฉพาะตอนจำเป็น (ประหยัดโควตา)
}

// ---------- เส้นทาง API ----------
const routes = [
  ['GET', /^\/api\/state$/, (db) => getState(db)],
  ['POST', /^\/api\/tables$/, async (db, req) => ({ id: await saveTable(db, await readJson(req)) })],
  ['POST', /^\/api\/tables\/bulk$/, async (db, req) => (await bulkTables(db, await readJson(req)), { ok: true })],
  ['PUT', /^\/api\/tables\/(\d+)$/, async (db, req, id) => ({ id: await saveTable(db, await readJson(req), id) })],
  ['DELETE', /^\/api\/tables\/(\d+)$/, async (db, req, id) => (await checkTableDeletable(db, id), await remove(db, 'dining_tables', id), { ok: true })],
  ['POST', /^\/api\/menu$/, async (db, req) => ({ id: await saveMenuItem(db, await readJson(req)) })],
  ['PUT', /^\/api\/menu\/(\d+)$/, async (db, req, id) => ({ id: await saveMenuItem(db, await readJson(req), id) })],
  ['DELETE', /^\/api\/menu\/(\d+)$/, async (db, req, id) => (await remove(db, 'menu_items', id), { ok: true })],
  ['PUT', /^\/api\/menu\/(\d+)\/image$/, async (db, req, id) => (await putImage(db, req, id), { ok: true })],
  ['DELETE', /^\/api\/menu\/(\d+)\/image$/, async (db, req, id) => (await deleteImage(db, id), { ok: true })],
  ['POST', /^\/api\/packages$/, async (db, req) => ({ id: await savePackage(db, await readJson(req)) })],
  ['PUT', /^\/api\/packages\/(\d+)$/, async (db, req, id) => ({ id: await savePackage(db, await readJson(req), id) })],
  ['DELETE', /^\/api\/packages\/(\d+)$/, async (db, req, id) => (await remove(db, 'packages', id), { ok: true })],
];

async function handle(req, env) {
  const url = new URL(req.url);
  const db = env.DB;
  if (!db) throw new HttpError(500, 'ยังไม่ได้เชื่อมฐานข้อมูล D1 (ชื่อ DB)');
  await ensureSchema(db);

  const img = url.pathname.match(/^\/img\/(\d+)$/);
  if (img && req.method === 'GET') return getImage(db, Number(img[1]));

  if (url.pathname === '/api/login' && req.method === 'POST') {
    const b = await readJson(req);
    await requirePin(req, env, db, b.pin);
    return { ok: true };
  }
  if (!url.pathname.startsWith('/api/')) throw new HttpError(404, 'ไม่พบหน้านี้');
  await requirePin(req, env, db, req.headers.get('x-pin'));
  for (const [method, re, fn] of [...routes, ...serviceRoutes]) {
    const m = url.pathname.match(re);
    if (m && req.method === method) return fn(db, req, m[1] ? Number(m[1]) : undefined);
  }
  throw new HttpError(404, 'ไม่พบ');
}

export default {
  async fetch(req, env) {
    try {
      const out = await handle(req, env);
      if (out instanceof Response) return out;
      return Response.json(out, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500 && !(e instanceof HttpError)) console.error(e);
      const msg = status === 500 && !(e instanceof HttpError) ? 'ระบบขัดข้อง กรุณาลองใหม่' : e.message;
      return Response.json({ error: msg }, { status, headers: { 'Cache-Control': 'no-store' } });
    }
  },
};
