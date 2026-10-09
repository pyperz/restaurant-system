// ระบบร้านอาหาร — เซิร์ฟเวอร์หลัก (ส่วนที่ 1: ข้อมูลร้าน + หน้าตั้งค่า)
// ไม่ต้องติดตั้งแพ็กเกจเพิ่ม ใช้แค่ Node.js เวอร์ชัน 22.13 ขึ้นไป
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');

if (!process.env.ADMIN_PIN) {
  console.warn('คำเตือน: ยังไม่ได้ตั้ง ADMIN_PIN กำลังใช้รหัส 1234 ห้ามใช้แบบนี้ตอนเปิดใช้จริง');
}

// ---------- ฐานข้อมูล ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'restaurant.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS dining_tables (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    seats INTEGER NOT NULL DEFAULT 4,
    zone TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    price_satang INTEGER,              -- ราคาสั่งเพิ่ม (à la carte) ว่าง = ไม่ขายแยก
    available INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS packages (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    adult_satang INTEGER NOT NULL,
    child_satang INTEGER NOT NULL DEFAULT 0,
    duration_min INTEGER NOT NULL DEFAULT 90,
    max_per_round INTEGER NOT NULL DEFAULT 0,  -- 0 = ไม่จำกัด
    active INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS package_items (
    package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    PRIMARY KEY (package_id, item_id)
  );
`);

// ---------- ตัวช่วยตรวจข้อมูล ----------
class BadRequest extends Error {}

function text(v, field, { required = true, max = 100 } = {}) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new BadRequest(`กรุณากรอก${field}`);
  if (s.length > max) throw new BadRequest(`${field}ยาวเกินไป`);
  return s;
}
function int(v, field, { min = 0, max = 1e6, fallback } = {}) {
  if ((v === undefined || v === null || v === '') && fallback !== undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new BadRequest(`${field}ไม่ถูกต้อง`);
  return n;
}
// รับราคาเป็นบาท (เช่น 59.5) เก็บเป็นสตางค์ เพื่อไม่ให้ทศนิยมเพี้ยน
function baht(v, field, { optional = false } = {}) {
  if (optional && (v === undefined || v === null || v === '')) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e6) throw new BadRequest(`${field}ไม่ถูกต้อง`);
  return Math.round(n * 100);
}
const toBaht = (s) => (s === null ? null : s / 100);

// ---------- อ่านข้อมูลทั้งหมด ----------
function getState() {
  const tables = db.prepare('SELECT * FROM dining_tables ORDER BY sort, id').all();
  const menu = db.prepare('SELECT * FROM menu_items ORDER BY category, sort, id').all()
    .map((m) => ({ id: m.id, name: m.name, category: m.category, price: toBaht(m.price_satang), available: !!m.available }));
  const links = db.prepare('SELECT package_id, item_id FROM package_items').all();
  const packages = db.prepare('SELECT * FROM packages ORDER BY sort, id').all().map((p) => ({
    id: p.id, name: p.name,
    adult_price: toBaht(p.adult_satang), child_price: toBaht(p.child_satang),
    duration_min: p.duration_min, max_per_round: p.max_per_round, active: !!p.active,
    item_ids: links.filter((l) => l.package_id === p.id).map((l) => l.item_id),
  }));
  return { tables: tables.map(({ sort, ...t }) => t), menu, packages };
}

// ---------- จัดการแต่ละส่วน ----------
function saveTable(body, id) {
  const v = [text(body.name, 'ชื่อโต๊ะ', { max: 30 }), int(body.seats, 'จำนวนที่นั่ง', { min: 1, max: 50, fallback: 4 }),
    text(body.zone, 'โซน', { required: false, max: 30 })];
  if (id) {
    const r = db.prepare('UPDATE dining_tables SET name=?, seats=?, zone=? WHERE id=?').run(...v, id);
    if (!r.changes) throw new BadRequest('ไม่พบโต๊ะนี้');
    return id;
  }
  const next = db.prepare('SELECT COALESCE(MAX(sort),0)+1 n FROM dining_tables').get().n;
  return Number(db.prepare('INSERT INTO dining_tables (name, seats, zone, sort) VALUES (?,?,?,?)').run(...v, next).lastInsertRowid);
}

function bulkTables(body) {
  const count = int(body.count, 'จำนวนโต๊ะ', { min: 1, max: 100 });
  const start = int(body.start, 'เลขเริ่มต้น', { min: 0, max: 9999, fallback: 1 });
  const prefix = text(body.prefix ?? 'โต๊ะ', 'คำนำหน้า', { required: false, max: 20 });
  const seats = int(body.seats, 'จำนวนที่นั่ง', { min: 1, max: 50, fallback: 4 });
  const zone = text(body.zone, 'โซน', { required: false, max: 30 });
  inTransaction(() => {
    for (let i = 0; i < count; i++) saveTable({ name: `${prefix} ${start + i}`.trim(), seats, zone });
  });
}

function saveMenuItem(body, id) {
  const v = [text(body.name, 'ชื่อเมนู', { max: 80 }), text(body.category, 'หมวด', { required: false, max: 40 }),
    baht(body.price, 'ราคา', { optional: true }), body.available === false ? 0 : 1];
  if (id) {
    const r = db.prepare('UPDATE menu_items SET name=?, category=?, price_satang=?, available=? WHERE id=?').run(...v, id);
    if (!r.changes) throw new BadRequest('ไม่พบเมนูนี้');
  } else {
    const next = db.prepare('SELECT COALESCE(MAX(sort),0)+1 n FROM menu_items').get().n;
    id = Number(db.prepare('INSERT INTO menu_items (name, category, price_satang, available, sort) VALUES (?,?,?,?,?)').run(...v, next).lastInsertRowid);
  }
  // เลือกแพ็กเกจที่เมนูนี้อยู่ได้จากหน้าเมนูด้วย
  if (Array.isArray(body.package_ids)) {
    const ids = body.package_ids.map((x) => int(x, 'แพ็กเกจ', { min: 1, max: 1e9 }));
    db.prepare('DELETE FROM package_items WHERE item_id=?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO package_items (package_id, item_id) SELECT id, ? FROM packages WHERE id=?');
    for (const p of ids) ins.run(id, p);
  }
  return id;
}

function savePackage(body, id) {
  const v = [text(body.name, 'ชื่อแพ็กเกจ', { max: 60 }), baht(body.adult_price, 'ราคาผู้ใหญ่'),
    baht(body.child_price ?? 0, 'ราคาเด็ก'), int(body.duration_min, 'เวลาทาน', { min: 0, max: 1440, fallback: 90 }),
    int(body.max_per_round, 'จำกัดจานต่อรอบ', { min: 0, max: 999, fallback: 0 }), body.active === false ? 0 : 1];
  if (id) {
    const r = db.prepare('UPDATE packages SET name=?, adult_satang=?, child_satang=?, duration_min=?, max_per_round=?, active=? WHERE id=?').run(...v, id);
    if (!r.changes) throw new BadRequest('ไม่พบแพ็กเกจนี้');
  } else {
    const next = db.prepare('SELECT COALESCE(MAX(sort),0)+1 n FROM packages').get().n;
    id = Number(db.prepare('INSERT INTO packages (name, adult_satang, child_satang, duration_min, max_per_round, active, sort) VALUES (?,?,?,?,?,?,?)').run(...v, next).lastInsertRowid);
  }
  if (Array.isArray(body.item_ids)) {
    const ids = body.item_ids.map((x) => int(x, 'รายการอาหาร', { min: 1, max: 1e9 }));
    db.prepare('DELETE FROM package_items WHERE package_id=?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO package_items (package_id, item_id) SELECT ?, id FROM menu_items WHERE id=?');
    for (const i of ids) ins.run(id, i);
  }
  return id;
}

function remove(table, id) {
  const r = db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
  if (!r.changes) throw new BadRequest('ไม่พบข้อมูลนี้');
}

function inTransaction(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ---------- รหัส PIN ----------
const pinOk = (pin) => {
  const a = Buffer.from(String(pin || '')), b = Buffer.from(ADMIN_PIN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const failed = new Map(); // ip -> { n, until } กันการเดารหัส
function checkLock(ip) {
  const f = failed.get(ip);
  if (f && f.until > Date.now()) throw Object.assign(new Error('ใส่รหัสผิดหลายครั้ง กรุณารอ 5 นาที'), { status: 429 });
}
function noteFail(ip) {
  const f = failed.get(ip) || { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= 5) { f.n = 0; f.until = Date.now() + 5 * 60 * 1000; }
  failed.set(ip, f);
}

// ---------- เส้นทาง API ----------
const routes = [
  ['GET', /^\/api\/state$/, () => getState()],
  ['POST', /^\/api\/tables$/, (b) => ({ id: saveTable(b) })],
  ['POST', /^\/api\/tables\/bulk$/, (b) => (bulkTables(b), { ok: true })],
  ['PUT', /^\/api\/tables\/(\d+)$/, (b, id) => ({ id: saveTable(b, id) })],
  ['DELETE', /^\/api\/tables\/(\d+)$/, (b, id) => (remove('dining_tables', id), { ok: true })],
  ['POST', /^\/api\/menu$/, (b) => ({ id: inTransaction(() => saveMenuItem(b)) })],
  ['PUT', /^\/api\/menu\/(\d+)$/, (b, id) => ({ id: inTransaction(() => saveMenuItem(b, id)) })],
  ['DELETE', /^\/api\/menu\/(\d+)$/, (b, id) => (remove('menu_items', id), { ok: true })],
  ['POST', /^\/api\/packages$/, (b) => ({ id: inTransaction(() => savePackage(b)) })],
  ['PUT', /^\/api\/packages\/(\d+)$/, (b, id) => ({ id: inTransaction(() => savePackage(b, id)) })],
  ['DELETE', /^\/api\/packages\/(\d+)$/, (b, id) => (remove('packages', id), { ok: true })],
];

async function handleApi(req, res, url) {
  const ip = req.socket.remoteAddress;
  if (url.pathname === '/api/login' && req.method === 'POST') {
    checkLock(ip);
    const body = await readBody(req);
    if (!pinOk(body.pin)) { noteFail(ip); throw Object.assign(new Error('รหัสไม่ถูกต้อง'), { status: 401 }); }
    failed.delete(ip);
    return { ok: true };
  }
  checkLock(ip);
  if (!pinOk(req.headers['x-pin'])) { noteFail(ip); throw Object.assign(new Error('กรุณาเข้าสู่ระบบ'), { status: 401 }); }
  for (const [method, re, fn] of routes) {
    const m = url.pathname.match(re);
    if (m && req.method === method) {
      const body = method === 'GET' || method === 'DELETE' ? {} : await readBody(req);
      return fn(body, m[1] ? Number(m[1]) : undefined);
    }
  }
  throw Object.assign(new Error('ไม่พบ'), { status: 404 });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1e6) { reject(new BadRequest('ข้อมูลใหญ่เกินไป')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new BadRequest('รูปแบบข้อมูลไม่ถูกต้อง')); }
    });
    req.on('error', reject);
  });
}

// ---------- ไฟล์หน้าเว็บ ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('ไม่พบหน้านี้'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);
  try {
    const out = await handleApi(req, res, url);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(out));
  } catch (e) {
    const status = e instanceof BadRequest ? 400 : e.status || 500;
    if (status === 500) console.error(e);
    const msg = status === 500 ? 'ระบบขัดข้อง กรุณาลองใหม่' : e.message;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: msg }));
  }
});

server.listen(PORT, () => console.log(`ระบบร้านพร้อมใช้งานที่ http://localhost:${PORT}`));
