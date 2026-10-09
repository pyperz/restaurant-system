// ตัวช่วยที่ใช้ร่วมกันทุกส่วน
export const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
export const first = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
export const run = (db, sql, ...args) => db.prepare(sql).bind(...args).run();

// ---------- ตรวจข้อมูล ----------
export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
export const bad = (msg) => new HttpError(400, msg);

export function text(v, field, { required = true, max = 100 } = {}) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw bad(`กรุณากรอก${field}`);
  if (s.length > max) throw bad(`${field}ยาวเกินไป`);
  return s;
}
export function int(v, field, { min = 0, max = 1e6, fallback } = {}) {
  if ((v === undefined || v === null || v === '') && fallback !== undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${field}ไม่ถูกต้อง`);
  return n;
}
// รับราคาเป็นบาท (เช่น 59.5) เก็บเป็นสตางค์ เพื่อไม่ให้ทศนิยมเพี้ยน
export function baht(v, field, { optional = false } = {}) {
  if (optional && (v === undefined || v === null || v === '')) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e6) throw bad(`${field}ไม่ถูกต้อง`);
  return Math.round(n * 100);
}
export const toBaht = (s) => (s === null || s === undefined ? null : s / 100);
export const idList = (arr, field) => (Array.isArray(arr) ? [...new Set(arr.map((x) => int(x, field, { min: 1, max: 1e9 })))] : null);


export async function readJson(req) { try { return await req.json(); } catch { throw bad('รูปแบบข้อมูลไม่ถูกต้อง'); } }
