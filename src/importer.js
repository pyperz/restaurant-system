// นำเข้าเมนูและแพ็กเกจจากไฟล์ (ทีละชุดเล็ก ๆ เพื่อไม่เกินโควตาคำสั่งฐานข้อมูลต่อครั้งของ Cloudflare แบบฟรี)
import { all, run, bad, text, int, baht, readJson } from './lib.js';

const marks = (n) => Array(n).fill('?').join(',');

async function importPackages(db, b) {
  if (!Array.isArray(b.packages) || b.packages.length > 30) throw bad('ข้อมูลแพ็กเกจไม่ถูกต้อง');
  const list = b.packages.map((p) => ({
    name: text(p.name, 'ชื่อแพ็กเกจ', { max: 60 }), adult: baht(p.adult_price, 'ราคาผู้ใหญ่'), child: baht(p.child_price ?? 0, 'ราคาเด็ก'),
    dur: int(p.duration_min, 'เวลาทาน', { min: 0, max: 1440, fallback: 90 }), max: int(p.max_per_round, 'จำกัดจาน', { min: 0, max: 999, fallback: 0 }),
  }));
  const existing = await all(db, 'SELECT id, name FROM packages');
  const stmts = [];
  let created = 0, updated = 0, sort = existing.length;
  for (const p of list) {
    const ex = existing.find((e) => e.name === p.name);
    if (ex) { updated++; stmts.push(db.prepare('UPDATE packages SET adult_satang=?, child_satang=?, duration_min=?, max_per_round=?, active=1 WHERE id=?').bind(p.adult, p.child, p.dur, p.max, ex.id)); }
    else { created++; stmts.push(db.prepare('INSERT INTO packages (name, adult_satang, child_satang, duration_min, max_per_round, active, sort) VALUES (?,?,?,?,?,1,?)').bind(p.name, p.adult, p.child, p.dur, p.max, ++sort)); }
  }
  if (stmts.length) await db.batch(stmts);
  return { created, updated };
}

async function importItems(db, b) {
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 10) throw bad('ส่งได้ครั้งละไม่เกิน 10 รายการ');
  const items = b.items.map((x) => ({
    name: text(x.name, 'ชื่อเมนู', { max: 80 }), category: text(x.category, 'หมวด', { required: false, max: 40 }),
    price: baht(x.price, `ราคา ${x.name}`, { optional: true }),
    packages: Array.isArray(x.packages) ? x.packages.map((n) => String(n)) : [],
  }));
  // แพ็กเกจที่อยู่ในไฟล์นี้ (ใช้ล้างความเชื่อมโยงเดิมเฉพาะแพ็กเกจเหล่านี้)
  const scope = Array.isArray(b.package_names) ? b.package_names.map(String).slice(0, 30) : [];
  const pk = scope.length ? await all(db, `SELECT id, name FROM packages WHERE name IN (${marks(scope.length)})`, ...scope) : [];
  const names = items.map((i) => i.name);
  const existing = await all(db, `SELECT id, name FROM menu_items WHERE name IN (${marks(names.length)})`, ...names);
  let created = 0, updated = 0;
  const ids = {};
  const sortBase = (await all(db, 'SELECT COALESCE(MAX(sort),0) AS n FROM menu_items'))[0].n;
  for (const [i, it] of items.entries()) {
    const ex = existing.find((e) => e.name === it.name);
    if (ex) { await run(db, 'UPDATE menu_items SET category=?, price_satang=? WHERE id=?', it.category, it.price, ex.id); ids[it.name] = ex.id; updated++; }
    else { ids[it.name] = (await run(db, 'INSERT INTO menu_items (name, category, price_satang, available, sort) VALUES (?,?,?,1,?)', it.name, it.category, it.price, sortBase + i + 1)).meta.last_row_id; created++; }
  }
  if (pk.length) {
    const itemIds = Object.values(ids), pkIds = pk.map((p) => p.id);
    await run(db, `DELETE FROM package_items WHERE item_id IN (${marks(itemIds.length)}) AND package_id IN (${marks(pkIds.length)})`, ...itemIds, ...pkIds);
    const pairs = [];
    for (const it of items) for (const n of it.packages) { const p = pk.find((x) => x.name === n); if (p) pairs.push([p.id, ids[it.name]]); }
    for (let i = 0; i < pairs.length; i += 40) {
      const part = pairs.slice(i, i + 40);
      await run(db, `INSERT OR IGNORE INTO package_items (package_id, item_id) VALUES ${part.map(() => '(?,?)').join(',')}`, ...part.flat());
    }
  }
  return { created, updated, ids };
}

export const importRoutes = [
  ['POST', /^\/api\/import\/packages$/, async (db, req) => importPackages(db, await readJson(req))],
  ['POST', /^\/api\/import\/items$/, async (db, req) => importItems(db, await readJson(req))],
];
