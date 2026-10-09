// ส่วนที่ 2: หน้าร้าน — เปิดโต๊ะ สั่งอาหาร (ในแพ็กเกจ / สั่งเพิ่ม) ครัว และคิดเงิน
import { all, first, run, bad, int, baht, toBaht, text, readJson, insertRows } from './lib.js';

export const SERVICE_SCHEMA = [
  // หนึ่ง "รอบลูกค้า" ต่อโต๊ะ ตั้งแต่เปิดโต๊ะจนปิดบิล (เก็บราคา/ชื่อไว้ ณ ตอนเปิด เผื่อแก้แพ็กเกจทีหลัง)
  `CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY,
    table_id INTEGER REFERENCES dining_tables(id) ON DELETE SET NULL,
    table_name TEXT NOT NULL,
    package_id INTEGER REFERENCES packages(id) ON DELETE SET NULL,
    package_name TEXT NOT NULL DEFAULT '',
    adults INTEGER NOT NULL DEFAULT 0, children INTEGER NOT NULL DEFAULT 0,
    adult_satang INTEGER NOT NULL DEFAULT 0, child_satang INTEGER NOT NULL DEFAULT 0,
    duration_min INTEGER NOT NULL DEFAULT 0, max_per_round INTEGER NOT NULL DEFAULT 0,
    opened_at INTEGER NOT NULL, closed_at INTEGER,
    status TEXT NOT NULL DEFAULT 'open',
    discount_satang INTEGER NOT NULL DEFAULT 0, penalty_satang INTEGER NOT NULL DEFAULT 0,
    total_satang INTEGER, pay_method TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS one_open_session_per_table ON sessions(table_id) WHERE status = 'open'`,
  `CREATE INDEX IF NOT EXISTS sessions_status ON sessions(status)`,
  `CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    round_no INTEGER NOT NULL, created_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'new', note TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS orders_status ON orders(status)`,
  `CREATE INDEX IF NOT EXISTS orders_session ON orders(session_id)`,
  `CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
    name TEXT NOT NULL, qty INTEGER NOT NULL,
    in_package INTEGER NOT NULL, unit_satang INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS order_items_order ON order_items(order_id)`,
  `CREATE INDEX IF NOT EXISTS sessions_closed ON sessions(closed_at)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS shop_files (key TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL, v INTEGER NOT NULL DEFAULT 1)`,
];

const ACTIVE = ['new', 'cooking', 'ready'];
const NEXT_STATUS = new Set(['new', 'cooking', 'ready', 'done', 'cancelled']);
const PAY = { cash: 'เงินสด', promptpay: 'PromptPay', transfer: 'โอน', other: 'อื่น ๆ' };

const inList = (n) => Array(n).fill('?').join(',');

function sessionOut(s) {
  return {
    id: s.id, table_id: s.table_id, table_name: s.table_name, package_id: s.package_id, package_name: s.package_name,
    adults: s.adults, children: s.children, adult_price: toBaht(s.adult_satang), child_price: toBaht(s.child_satang),
    duration_min: s.duration_min, max_per_round: s.max_per_round, opened_at: s.opened_at, closed_at: s.closed_at,
    status: s.status, ends_at: s.duration_min ? s.opened_at + s.duration_min * 60000 : null,
  };
}

async function itemsFor(db, orderIds) {
  if (!orderIds.length) return [];
  return all(db, `SELECT * FROM order_items WHERE order_id IN (${inList(orderIds.length)}) ORDER BY id`, ...orderIds);
}
const itemOut = (i) => ({ id: i.id, item_id: i.item_id, name: i.name, qty: i.qty, in_package: !!i.in_package, unit_price: toBaht(i.unit_satang), note: i.note });

// ---------- ภาพรวมหน้าร้าน (ผังโต๊ะ + ครัว) ----------
async function live(db) {
  const sessions = await all(db, "SELECT * FROM sessions WHERE status = 'open'");
  const active = await all(db, `SELECT o.*, s.table_name FROM orders o JOIN sessions s ON s.id = o.session_id
    WHERE o.status IN (${inList(ACTIVE.length)}) ORDER BY o.created_at`, ...ACTIVE);
  const rounds = sessions.length
    ? await all(db, `SELECT session_id, COUNT(*) AS n FROM orders WHERE session_id IN (${inList(sessions.length)}) AND status != 'cancelled' GROUP BY session_id`, ...sessions.map((s) => s.id))
    : [];
  const items = await itemsFor(db, active.map((o) => o.id));
  return {
    now: Date.now(),
    sessions: sessions.map((s) => ({ ...sessionOut(s), rounds: rounds.find((r) => r.session_id === s.id)?.n || 0 })),
    orders: active.map((o) => ({
      id: o.id, session_id: o.session_id, table_name: o.table_name, round_no: o.round_no, created_at: o.created_at, status: o.status, note: o.note,
      items: items.filter((i) => i.order_id === o.id).map(itemOut),
    })),
  };
}

// ---------- เปิดโต๊ะ ----------
async function openSession(db, b) {
  const tableId = int(b.table_id, 'โต๊ะ', { min: 1, max: 1e9 });
  const table = await first(db, 'SELECT id, name FROM dining_tables WHERE id = ?', tableId);
  if (!table) throw bad('ไม่พบโต๊ะนี้');
  const adults = int(b.adults, 'จำนวนผู้ใหญ่', { min: 0, max: 99, fallback: 0 });
  const children = int(b.children, 'จำนวนเด็ก', { min: 0, max: 99, fallback: 0 });
  if (adults + children < 1) throw bad('กรุณาใส่จำนวนลูกค้าอย่างน้อย 1 คน');

  let pkg = null;
  if (b.package_id) {
    pkg = await first(db, 'SELECT * FROM packages WHERE id = ? AND active = 1', int(b.package_id, 'แพ็กเกจ', { min: 1, max: 1e9 }));
    if (!pkg) throw bad('แพ็กเกจนี้ปิดขายหรือไม่มีแล้ว');
  }
  try {
    const r = await run(db, `INSERT INTO sessions (table_id, table_name, package_id, package_name, adults, children,
      adult_satang, child_satang, duration_min, max_per_round, opened_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      table.id, table.name, pkg?.id ?? null, pkg?.name ?? '', adults, children,
      pkg?.adult_satang ?? 0, pkg?.child_satang ?? 0, pkg?.duration_min ?? 0, pkg?.max_per_round ?? 0, Date.now());
    return { id: r.meta.last_row_id };
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) throw bad(`${table.name} มีลูกค้าอยู่แล้ว`);
    throw e;
  }
}

async function getOpen(db, id) {
  const s = await first(db, 'SELECT * FROM sessions WHERE id = ?', id);
  if (!s) throw bad('ไม่พบโต๊ะที่เปิดอยู่');
  return s;
}

// ---------- สั่งอาหาร (หนึ่งครั้ง = หนึ่งรอบ) ----------
async function placeOrder(db, sessionId, b) {
  const s = await getOpen(db, sessionId);
  if (s.status !== 'open') throw bad('โต๊ะนี้ปิดบิลแล้ว');
  if (!Array.isArray(b.items) || !b.items.length) throw bad('ยังไม่ได้เลือกรายการอาหาร');
  if (b.items.length > 60) throw bad('รายการเยอะเกินไปในรอบเดียว');
  const note = text(b.note, 'หมายเหตุ', { required: false, max: 200 });

  const ids = [...new Set(b.items.map((x) => int(x.item_id, 'รายการอาหาร', { min: 1, max: 1e9 })))];
  const menu = await all(db, `SELECT id, name, price_satang, available FROM menu_items WHERE id IN (${inList(ids.length)})`, ...ids);
  const inPkg = s.package_id
    ? new Set((await all(db, 'SELECT item_id FROM package_items WHERE package_id = ?', s.package_id)).map((r) => r.item_id))
    : new Set();

  let pkgQty = 0;
  const lines = b.items.map((x) => {
    const m = menu.find((r) => r.id === Number(x.item_id));
    if (!m) throw bad('มีรายการอาหารที่ถูกลบไปแล้ว กรุณาโหลดหน้าใหม่');
    if (!m.available) throw bad(`${m.name} หมดแล้ว`);
    const qty = int(x.qty, 'จำนวน', { min: 1, max: 99 });
    const lineNote = text(x.note, 'หมายเหตุ', { required: false, max: 100 });
    if (x.mode === 'pkg') {
      if (!inPkg.has(m.id)) throw bad(`${m.name} ไม่ได้อยู่ในแพ็กเกจของโต๊ะนี้`);
      pkgQty += qty;
      return [m.id, m.name, qty, 1, 0, lineNote];
    }
    if (x.mode !== 'extra') throw bad('รูปแบบรายการไม่ถูกต้อง');
    if (m.price_satang === null) throw bad(`${m.name} ไม่ได้ขายแยก`);
    return [m.id, m.name, qty, 0, m.price_satang, lineNote];
  });
  if (s.max_per_round && pkgQty > s.max_per_round) throw bad(`แพ็กเกจนี้สั่งได้ไม่เกิน ${s.max_per_round} จานต่อรอบ (เลือกไว้ ${pkgQty})`);

  const round = (await first(db, "SELECT COUNT(*) AS n FROM orders WHERE session_id = ? AND status != 'cancelled'", s.id)).n + 1;
  const o = await run(db, 'INSERT INTO orders (session_id, round_no, created_at, note) VALUES (?,?,?,?)', s.id, round, Date.now(), note);
  const orderId = o.meta.last_row_id;
  await insertRows(db, 'order_items', ['order_id', 'item_id', 'name', 'qty', 'in_package', 'unit_satang', 'note'], lines.map((l) => [orderId, ...l]));
  return { id: orderId, round_no: round };
}

async function setOrderStatus(db, id, b) {
  if (!NEXT_STATUS.has(b.status)) throw bad('สถานะไม่ถูกต้อง');
  const o = await first(db, 'SELECT o.status, s.status AS s_status FROM orders o JOIN sessions s ON s.id = o.session_id WHERE o.id = ?', id);
  if (!o) throw bad('ไม่พบออเดอร์นี้');
  if (b.status === 'cancelled' && o.s_status !== 'open') throw bad('ยกเลิกไม่ได้ เพราะโต๊ะนี้ปิดบิลแล้ว');
  await run(db, 'UPDATE orders SET status = ? WHERE id = ?', b.status, id);
  return { ok: true };
}

// ---------- บิล ----------
function computeBill(s, items, { discount = s.discount_satang, penalty = s.penalty_satang } = {}) {
  const buffet = s.adults * s.adult_satang + s.children * s.child_satang;
  const extras = items.filter((i) => !i.in_package).reduce((a, i) => a + i.qty * i.unit_satang, 0);
  const total = Math.max(0, buffet + extras + penalty - discount);
  return { buffet, extras, penalty, discount, total };
}
const billOut = (b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, toBaht(v)]));

async function sessionDetail(db, id) {
  const s = await getOpen(db, id);
  const orders = await all(db, 'SELECT * FROM orders WHERE session_id = ? ORDER BY created_at', id);
  const items = await itemsFor(db, orders.map((o) => o.id));
  const live = orders.filter((o) => o.status !== 'cancelled').map((o) => o.id);
  return {
    now: Date.now(),
    session: { ...sessionOut(s), pay_method: s.pay_method, total: toBaht(s.total_satang) },
    orders: orders.map((o) => ({ id: o.id, round_no: o.round_no, created_at: o.created_at, status: o.status, note: o.note,
      items: items.filter((i) => i.order_id === o.id).map(itemOut) })),
    bill: billOut(computeBill(s, items.filter((i) => live.includes(i.order_id)))),
  };
}

async function closeSession(db, id, b) {
  const s = await getOpen(db, id);
  if (s.status !== 'open') throw bad('โต๊ะนี้ปิดบิลไปแล้ว');
  if (!PAY[b.method]) throw bad('กรุณาเลือกวิธีชำระเงิน');
  const discount = baht(b.discount ?? 0, 'ส่วนลด');
  const penalty = baht(b.penalty ?? 0, 'ค่าปรับ');
  const items = await all(db, `SELECT i.* FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE o.session_id = ? AND o.status != 'cancelled'`, id);
  const bill = computeBill(s, items, { discount, penalty });
  // ปิดบิลแล้วออเดอร์ที่ค้างอยู่ถือว่าเสร็จ ไม่ให้ค้างบนจอครัว
  await db.batch([
    db.prepare(`UPDATE sessions SET status='closed', closed_at=?, discount_satang=?, penalty_satang=?, total_satang=?, pay_method=?
      WHERE id=? AND status='open'`).bind(Date.now(), discount, penalty, bill.total, b.method, id),
    db.prepare("UPDATE orders SET status='done' WHERE session_id=? AND status IN ('new','cooking','ready')").bind(id),
  ]);
  return { ok: true, bill: billOut(bill) };
}

// เปิดโต๊ะผิด: ยกเลิกได้เฉพาะตอนที่ยังไม่มีออเดอร์
async function cancelSession(db, id) {
  const s = await getOpen(db, id);
  if (s.status !== 'open') throw bad('โต๊ะนี้ปิดบิลไปแล้ว');
  const n = (await first(db, "SELECT COUNT(*) AS n FROM orders WHERE session_id = ? AND status != 'cancelled'", id)).n;
  if (n) throw bad('โต๊ะนี้มีออเดอร์แล้ว ยกเลิกไม่ได้ ให้ยกเลิกออเดอร์ก่อนหรือปิดบิลแทน');
  await run(db, 'DELETE FROM sessions WHERE id = ?', id);
  return { ok: true };
}

// ---------- ตั้งค่าร้าน ----------
const SETTINGS = {
  shop_name: (v) => text(v, 'ชื่อร้าน', { required: false, max: 60 }),
  promptpay_id: (v) => {
    const d = String(v ?? '').replace(/\D/g, '');
    if (d && ![10, 13, 15].includes(d.length)) throw bad('เลข PromptPay ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลข 13 หลัก');
    return d;
  },
  paper: (v) => (['58', '80'].includes(String(v)) ? String(v) : '80'),
  pay_qr: (v) => (v === 'image' ? 'image' : 'promptpay'), // ใช้รูป QR ที่อัปโหลด หรือสร้างจากเลข PromptPay
  // ข้อมูลที่บอท LINE ใช้ตอบลูกค้า
  open_hours: (v) => text(v, 'เวลาเปิด-ปิด', { required: false, max: 120 }),
  address: (v) => text(v, 'ที่อยู่', { required: false, max: 200 }),
  phone: (v) => text(v, 'เบอร์โทร', { required: false, max: 30 }),
  shop_info: (v) => text(v, 'ข้อมูลเพิ่มเติม', { required: false, max: 1500 }),
  bot_on: (v) => (v === '0' || v === false ? '0' : '1'),
  bot_ai: (v) => (v === '0' || v === false ? '0' : '1'),
  takeaway_on: (v) => (v === '0' || v === false ? '0' : '1'),
  reserve_on: (v) => (v === '0' || v === false ? '0' : '1'),
  bill_footer: (v) => text(v, 'ข้อความท้ายบิล', { required: false, max: 120 }),
};
export async function getSettings(db) {
  const [rows, qr] = await Promise.all([all(db, 'SELECT key, value FROM settings'), first(db, "SELECT v FROM shop_files WHERE key = 'qr'")]);
  const out = { shop_name: '', promptpay_id: '', paper: '80', bill_footer: '', pay_qr: 'promptpay',
    open_hours: '', address: '', phone: '', shop_info: '', bot_on: '1', bot_ai: '1', takeaway_on: '1', reserve_on: '1' };
  for (const r of rows) if (r.key in SETTINGS) out[r.key] = r.value;
  out.qr_image = qr ? `/img/qr?v=${qr.v}` : null;
  return out;
}
async function saveSettings(db, b) {
  const ins = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const stmts = Object.entries(SETTINGS).filter(([k]) => k in b).map(([k, fn]) => ins.bind(k, fn(b[k])));
  if (stmts.length) await db.batch(stmts);
  return getSettings(db);
}

// รูป QR รับเงินที่ร้านอัปโหลดเอง (เช่น QR จาก K SHOP / แม่มณี)
const QR_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
async function putQrImage(db, req) {
  const mime = (req.headers.get('content-type') || '').split(';')[0].trim();
  if (!QR_TYPES.has(mime)) throw bad('รองรับเฉพาะรูป PNG, JPG หรือ WEBP');
  const buf = await req.arrayBuffer();
  if (!buf.byteLength) throw bad('ไม่พบไฟล์รูป');
  if (buf.byteLength > 1_500_000) throw bad('รูปใหญ่เกินไป');
  await run(db, `INSERT INTO shop_files (key, mime, data, v) VALUES ('qr', ?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET mime = excluded.mime, data = excluded.data, v = shop_files.v + 1`, mime, buf);
  return getSettings(db);
}
export async function getQrImage(db) {
  const row = await first(db, "SELECT mime, data FROM shop_files WHERE key = 'qr'");
  if (!row) return new Response('ไม่พบรูป', { status: 404 });
  const body = row.data instanceof ArrayBuffer ? row.data : new Uint8Array(row.data);
  return new Response(body, { headers: { 'Content-Type': row.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
}

// ---------- รายงานยอดขาย (ใช้วันตามเวลาไทย) ----------
const TZ = 7 * 3600000;
const thaiDate = (ms) => new Date(ms + TZ).toISOString().slice(0, 10);
function dayStart(str, field) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ''));
  const ms = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) - TZ : NaN;
  if (!m || thaiDate(ms) !== m[0]) throw bad(`${field}ไม่ถูกต้อง`);
  return ms;
}
async function report(db, url) {
  const today = thaiDate(Date.now());
  const from = dayStart(url.searchParams.get('from') || today, 'วันที่เริ่ม');
  const to = dayStart(url.searchParams.get('to') || url.searchParams.get('from') || today, 'วันที่สิ้นสุด') + 86400000;
  if (to <= from) throw bad('ช่วงวันที่ไม่ถูกต้อง');
  if (to - from > 93 * 86400000) throw bad('ดูรายงานได้ครั้งละไม่เกิน 3 เดือน');

  const bills = await all(db, `SELECT id, table_name, package_name, adults, children, adult_satang, child_satang,
    opened_at, closed_at, discount_satang, penalty_satang, total_satang, pay_method
    FROM sessions WHERE status = 'closed' AND closed_at >= ? AND closed_at < ? ORDER BY closed_at`, from, to);
  const items = await all(db, `SELECT i.name, i.in_package, SUM(i.qty) AS qty, SUM(i.qty * i.unit_satang) AS amount
    FROM order_items i JOIN orders o ON o.id = i.order_id JOIN sessions s ON s.id = o.session_id
    WHERE s.status = 'closed' AND s.closed_at >= ? AND s.closed_at < ? AND o.status != 'cancelled'
    GROUP BY i.name, i.in_package ORDER BY qty DESC LIMIT 30`, from, to);

  const sum = (f) => bills.reduce((a, b) => a + f(b), 0);
  const buffet = sum((b) => b.adults * b.adult_satang + b.children * b.child_satang);
  const byMethod = {}, byDay = {};
  for (const b of bills) {
    byMethod[b.pay_method] = (byMethod[b.pay_method] || 0) + b.total_satang;
    const d = thaiDate(b.closed_at);
    byDay[d] = byDay[d] || { date: d, bills: 0, total: 0 };
    byDay[d].bills++; byDay[d].total += b.total_satang;
  }
  return {
    from: thaiDate(from), to: thaiDate(to - 1),
    total: toBaht(sum((b) => b.total_satang)), bills: bills.length, guests: sum((b) => b.adults + b.children),
    buffet: toBaht(buffet), discount: toBaht(sum((b) => b.discount_satang)), penalty: toBaht(sum((b) => b.penalty_satang)),
    extras: toBaht(items.filter((i) => !i.in_package).reduce((a, i) => a + i.amount, 0)),
    by_method: Object.fromEntries(Object.entries(byMethod).map(([k, v]) => [k, toBaht(v)])),
    by_day: Object.values(byDay).map((d) => ({ ...d, total: toBaht(d.total) })),
    items: items.map((i) => ({ name: i.name, in_package: !!i.in_package, qty: i.qty, amount: toBaht(i.amount) })),
    list: bills.map((b) => ({ id: b.id, table_name: b.table_name, package_name: b.package_name, guests: b.adults + b.children,
      opened_at: b.opened_at, closed_at: b.closed_at, total: toBaht(b.total_satang), pay_method: b.pay_method })),
  };
}

export async function checkTableDeletable(db, id) {
  if (await first(db, "SELECT id FROM sessions WHERE table_id = ? AND status = 'open'", id)) throw bad('โต๊ะนี้มีลูกค้าอยู่ ปิดบิลก่อนแล้วค่อยลบ');
}

export const serviceRoutes = [
  ['PUT', /^\/api\/settings$/, async (db, req) => saveSettings(db, await readJson(req))],
  ['PUT', /^\/api\/settings\/qr-image$/, (db, req) => putQrImage(db, req)],
  ['DELETE', /^\/api\/settings\/qr-image$/, async (db) => { await run(db, "DELETE FROM shop_files WHERE key = 'qr'"); return getSettings(db); }],
  ['GET', /^\/api\/report$/, (db, req) => report(db, new URL(req.url))],
  ['GET', /^\/api\/live$/, (db) => live(db)],
  ['POST', /^\/api\/sessions$/, async (db, req) => openSession(db, await readJson(req))],
  ['GET', /^\/api\/sessions\/(\d+)$/, (db, req, id) => sessionDetail(db, id)],
  ['POST', /^\/api\/sessions\/(\d+)\/orders$/, async (db, req, id) => placeOrder(db, id, await readJson(req))],
  ['POST', /^\/api\/sessions\/(\d+)\/close$/, async (db, req, id) => closeSession(db, id, await readJson(req))],
  ['DELETE', /^\/api\/sessions\/(\d+)$/, (db, req, id) => cancelSession(db, id)],
  ['PUT', /^\/api\/orders\/(\d+)\/status$/, async (db, req, id) => setOrderStatus(db, id, await readJson(req))],
];
