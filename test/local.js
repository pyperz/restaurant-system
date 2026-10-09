// ใช้สำหรับทดสอบบนเครื่องเท่านั้น: จำลองฐานข้อมูล D1 ด้วย SQLite ที่มากับ Node.js
// และเปิดเว็บที่ http://localhost:PORT ให้ทำงานเหมือนบน Cloudflare
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/worker.js';

const toSql = (v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : v);

export function createD1(file = ':memory:') {
  const sq = new DatabaseSync(file);
  const counter = { n: 0 }; // นับจำนวนคำสั่งต่อคำขอ (Cloudflare แบบฟรีจำกัด 50)
  sq.exec('PRAGMA foreign_keys = ON');
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    _exec() {
      counter.n++;
      const p = sq.prepare(sql);
      const a = args.map(toSql);
      if (/^\s*(SELECT|WITH)/i.test(sql)) return { results: p.all(...a).map((r) => ({ ...r })), meta: { changes: 0 } };
      const r = p.run(...a);
      return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
    async all() { return this._exec(); },
    async run() { return this._exec(); },
    async first() { return this._exec().results[0] ?? null; },
  });
  return {
    counter,
    prepare: (sql) => stmt(sql),
    async batch(list) {
      sq.exec('BEGIN');
      try { const out = list.map((s) => s._exec()); sq.exec('COMMIT'); return out; }
      catch (e) { sq.exec('ROLLBACK'); throw e; }
    },
  };
}

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

export function startLocal({ port, pin, dbFile = ':memory:', extraEnv = {} }) {
  const env = { DB: createD1(dbFile), ADMIN_PIN: pin, ...extraEnv };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/img/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      env.DB.counter.n = 0;
      const r = await worker.fetch(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env);
      res.writeHead(r.status, { ...Object.fromEntries(r.headers), 'x-d1-queries': String(env.DB.counter.n) });
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
  });
  server.env = env; // ให้ชุดทดสอบเข้าถึงฐานข้อมูลได้
  return new Promise((ok) => server.listen(port, () => ok(server)));
}

// รันตรง ๆ: node test/local.js  → เปิด http://localhost:8787 (PIN 123456)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8787;
  await startLocal({ port, pin: process.env.ADMIN_PIN || '123456', dbFile: process.env.DB_FILE || ':memory:' });
  console.log(`ทดสอบที่ http://localhost:${port}`);
}
