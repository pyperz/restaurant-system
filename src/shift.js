// ---------- กะ/วันขาย: ตั้งเงินทอนตอนเปิดร้าน และปิดร้านสรุปยอด ----------
import { all, first, run, bad, baht, toBaht, readJson } from './lib.js';

export const SHIFT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY,
    opened_at INTEGER NOT NULL,
    float_satang INTEGER NOT NULL DEFAULT 0,
    closed_at INTEGER,
    counted_satang INTEGER,
    summary TEXT)`,
  'CREATE INDEX IF NOT EXISTS shifts_open ON shifts(closed_at)',
];

const TZ = 7 * 3600000;
const thaiMidnight = (ms) => { const d = new Date(ms + TZ); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - TZ; };
const openShift = (db) => first(db, 'SELECT * FROM shifts WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1');

// ยอดขายช่วง [from, to) จากบิลที่ปิดแล้ว
async function summarize(db, from, to, floatSatang) {
  const bills = await all(db, `SELECT adults, children, discount_satang, penalty_satang, total_satang, pay_method
    FROM sessions WHERE status = 'closed' AND closed_at >= ? AND closed_at < ?`, from, to);
  const open = await first(db, "SELECT COUNT(*) AS n FROM sessions WHERE status = 'open'");
  const byMethod = {};
  for (const b of bills) byMethod[b.pay_method] = (byMethod[b.pay_method] || 0) + b.total_satang;
  const total = bills.reduce((a, b) => a + b.total_satang, 0);
  const cash = byMethod.cash || 0;
  return {
    from, to, bills: bills.length, guests: bills.reduce((a, b) => a + b.adults + b.children, 0),
    total, cash, float: floatSatang, expected_cash: floatSatang + cash,
    discount: bills.reduce((a, b) => a + b.discount_satang, 0), penalty: bills.reduce((a, b) => a + b.penalty_satang, 0),
    by_method: byMethod, open_tables: open.n,
  };
}
const out = (s) => s && ({
  ...s, total: toBaht(s.total), cash: toBaht(s.cash), float: toBaht(s.float), expected_cash: toBaht(s.expected_cash),
  discount: toBaht(s.discount), penalty: toBaht(s.penalty),
  counted: s.counted == null ? null : toBaht(s.counted), diff: s.diff == null ? null : toBaht(s.diff),
  by_method: Object.fromEntries(Object.entries(s.by_method).map(([k, v]) => [k, toBaht(v)])),
});

// ร้านที่ไม่ได้กด "ตั้งเงินทอน" ก็ยังปิดร้านได้: นับตั้งแต่ปิดร้านครั้งก่อน (ถ้าเป็นวันนี้) หรือเที่ยงคืนวันนี้
async function implicitStart(db, now) {
  const last = await first(db, 'SELECT closed_at FROM shifts WHERE closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 1');
  return Math.max(thaiMidnight(now), last?.closed_at || 0);
}

async function current(db) {
  const now = Date.now(), s = await openShift(db);
  const from = s ? s.opened_at : await implicitStart(db, now);
  const history = await all(db, 'SELECT id, opened_at, closed_at, summary FROM shifts WHERE closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 10');
  return {
    shift: s ? { id: s.id, opened_at: s.opened_at, float: toBaht(s.float_satang) } : null,
    live: out(await summarize(db, from, now + 1, s ? s.float_satang : 0)),
    history: history.map((h) => ({ id: h.id, opened_at: h.opened_at, closed_at: h.closed_at, summary: out(JSON.parse(h.summary || 'null')) })),
  };
}

async function openOrSetFloat(db, b) {
  const fl = baht(b.float ?? 0, 'เงินทอน');
  const s = await openShift(db);
  if (s) await run(db, 'UPDATE shifts SET float_satang = ? WHERE id = ?', fl, s.id);
  else await run(db, 'INSERT INTO shifts (opened_at, float_satang) VALUES (?, ?)', Date.now(), fl);
  return current(db);
}

async function closeShift(db, b) {
  const now = Date.now();
  let s = await openShift(db);
  if (!s) {
    const r = await run(db, 'INSERT INTO shifts (opened_at, float_satang) VALUES (?, 0)', await implicitStart(db, now));
    s = await first(db, 'SELECT * FROM shifts WHERE id = ?', r.meta.last_row_id);
  }
  const sum = await summarize(db, s.opened_at, now + 1, s.float_satang);
  sum.to = now;
  if (b.counted !== undefined && b.counted !== null && b.counted !== '') {
    sum.counted = baht(b.counted, 'เงินสดที่นับได้');
    sum.diff = sum.counted - sum.expected_cash;
  }
  await run(db, 'UPDATE shifts SET closed_at = ?, counted_satang = ?, summary = ? WHERE id = ? AND closed_at IS NULL',
    now, sum.counted ?? null, JSON.stringify(sum), s.id);
  return { id: s.id, opened_at: s.opened_at, closed_at: now, summary: out(sum) };
}

export const shiftRoutes = [
  ['GET', /^\/api\/shift$/, (db) => current(db)],
  ['POST', /^\/api\/shift\/float$/, async (db, req) => openOrSetFloat(db, await readJson(req))],
  ['POST', /^\/api\/shift\/close$/, async (db, req) => closeShift(db, await readJson(req))],
];
