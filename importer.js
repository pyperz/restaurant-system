'use strict';
// นำเข้าเมนูจากไฟล์ และใส่รูปเมนูทีละหลายรูป (จับคู่จากชื่อไฟล์)

S.imp = null;   // { data, error, running, done, progress }
S.pics = null;  // { rows:[{file, itemId}], running, progress }

const norm = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/\.[a-z0-9]+$/i, '').replace(/[\s_\-()[\]{}.,+]/g, '');

function progressBar(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return h('div', { class: 'pbar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct }, h('i', { style: `width:${pct}%` }), h('span', {}, `${done}/${total}`));
}

// ไฟล์เมนูที่เตรียมไว้ในระบบแล้ว (แปลงจาก Food Story) กดปุ่มเดียวนำเข้าได้
async function loadBundledMenu() {
  try {
    const r = await fetch('/data/menu-foodstory.json', { cache: 'no-store' });
    if (!r.ok) throw new Error();
    S.imp = { data: await r.json(), file: 'เมนูจาก Food Story (เตรียมไว้แล้ว)' };
  } catch { S.imp = { error: 'ไม่พบไฟล์เมนูที่เตรียมไว้ในระบบ' }; }
  S.view = 'import'; render();
}

// ---------- นำเข้าเมนูจากไฟล์ ----------
function importView() {
  const st = S.imp || (S.imp = {});
  const back = h('button', { class: 'back', 'aria-label': 'กลับหน้าเมนู', onclick: () => { S.view = 'menu'; S.imp = null; render(); } }, '‹');
  const picker = h('input', { type: 'file', accept: '.json,application/json', id: 'f_import', class: 'sr', onchange: async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.format !== 'restaurant-menu' || !Array.isArray(d.items)) throw new Error('ไฟล์นี้ไม่ใช่ไฟล์นำเข้าเมนูของระบบนี้');
      S.imp = { data: d, file: f.name };
    } catch (err) { S.imp = { error: err.message.startsWith('ไฟล์') ? err.message : 'อ่านไฟล์ไม่ได้ ไฟล์อาจเสียหรือไม่ใช่ไฟล์ .json' }; }
    render();
  } });
  const head = h('div', { class: 'panel grow' },
    h('div', { class: 'ph' }, h('span', {}, back, 'นำเข้าเมนูจากไฟล์')),
    h('div', { class: 'sub' }, 'ใช้ไฟล์ .json ที่เตรียมไว้ (เช่น ไฟล์ที่ Claude แปลงจากเมนู Food Story ให้) เมนูที่ชื่อซ้ำกับของเดิมจะถูกอัปเดตราคาและหมวด ไม่สร้างซ้ำ รูปและสถานะ "หมด" ของเดิมยังอยู่'),
    h('div', { class: 'row2', style: 'max-width:640px' },
      h('button', { class: 'btn', onclick: loadBundledMenu }, 'ใช้เมนูจาก Food Story ที่เตรียมไว้'),
      h('label', { for: 'f_import', class: 'btn blue filebtn' }, 'เลือกไฟล์อื่น'), picker),
    st.error ? h('div', { class: 'warnbox' }, st.error) : null);
  if (!st.data) return [h('div', { class: 'stack' }, head)];

  const d = st.data, pk = d.packages || [];
  const cats = {};
  d.items.forEach((i) => { cats[i.category || 'ไม่มีหมวด'] = (cats[i.category || 'ไม่มีหมวด'] || 0) + 1; });
  const buffet = d.items.filter((i) => i.price == null).length;
  const summary = h('div', { class: 'panel grow' },
    h('div', { class: 'ph' }, h('span', {}, `ไฟล์: ${st.file}`)),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('div', { class: 'sub' }, 'เมนูทั้งหมด'), h('div', { class: 'sv' }, d.items.length)),
      h('div', { class: 'stat' }, h('div', { class: 'sub' }, 'ขายแยก (มีราคา)'), h('div', { class: 'sv' }, d.items.length - buffet)),
      h('div', { class: 'stat' }, h('div', { class: 'sub' }, 'อยู่ในบุฟเฟต์อย่างเดียว'), h('div', { class: 'sv' }, buffet)),
      h('div', { class: 'stat' }, h('div', { class: 'sub' }, 'แพ็กเกจ'), h('div', { class: 'sv' }, pk.length))),
    pk.length ? [h('div', { class: 'sh' }, 'แพ็กเกจ'), h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, ['ชื่อ', 'ผู้ใหญ่', 'เด็ก', 'เวลา', 'จาน/รอบ', 'จำนวนรายการ'].map((c, i) => h('th', { class: i ? 'num' : null }, c)))),
      h('tbody', {}, pk.map((p) => h('tr', {}, h('td', {}, p.name), h('td', { class: 'num' }, money(p.adult_price)), h('td', { class: 'num' }, p.child_price ? money(p.child_price) : '—'),
        h('td', { class: 'num' }, p.duration_min ? `${p.duration_min} นาที` : '—'), h('td', { class: 'num' }, p.max_per_round || 'ไม่จำกัด'),
        h('td', { class: 'num' }, d.items.filter((i) => (i.packages || []).includes(p.name)).length)))))] : null,
    h('div', { class: 'sh' }, 'หมวด'),
    h('div', { class: 'chips' }, Object.entries(cats).map(([c, n]) => h('span', { class: 'chip', style: 'cursor:default' }, `${c} · ${n}`))),
    d.notes ? h('div', { class: 'note' }, d.notes) : null,
    st.done ? h('div', { class: 'okbox' }, `นำเข้าเสร็จแล้ว: เมนูใหม่ ${st.done.created} · อัปเดต ${st.done.updated} · แพ็กเกจใหม่ ${st.done.pkCreated} · อัปเดต ${st.done.pkUpdated}`) : null,
    st.running || st.done ? progressBar(st.progress || 0, d.items.length) : null,
    st.done ? h('button', { class: 'btn blue', style: 'max-width:320px', onclick: () => { S.view = 'photos'; S.pics = null; render(); } }, 'ต่อไป: ใส่รูปเมนู')
      : h('button', { class: 'btn', style: 'max-width:320px', disabled: !!st.running, onclick: runImport }, st.running ? 'กำลังนำเข้า…' : `นำเข้า ${d.items.length} เมนู`));

  const list = h('div', { class: 'panel grow' }, h('div', { class: 'sh' }, 'รายการในไฟล์'),
    h('div', { class: 'scrollbox' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, h('th', {}, 'เมนู'), h('th', {}, 'หมวด'), h('th', { class: 'num' }, 'ราคาสั่งแยก'), h('th', {}, 'อยู่ในแพ็กเกจ'))),
      h('tbody', {}, d.items.map((i) => h('tr', {}, h('td', {}, i.name), h('td', {}, i.category || '—'), h('td', { class: 'num' }, i.price == null ? '—' : money(i.price)), h('td', { class: 'sub' }, (i.packages || []).join(', ') || '—')))))));
  return [h('div', { class: 'stack' }, head, summary, list)];
}

async function runImport() {
  const st = S.imp, d = st.data;
  st.running = true; st.progress = 0; render();
  const names = (d.packages || []).map((p) => p.name);
  const done = { created: 0, updated: 0, pkCreated: 0, pkUpdated: 0 };
  try {
    if (names.length) { const r = await api('POST', '/api/import/packages', { packages: d.packages }); done.pkCreated = r.created; done.pkUpdated = r.updated; }
    for (let i = 0; i < d.items.length; i += 10) {
      const r = await api('POST', '/api/import/items', { items: d.items.slice(i, i + 10), package_names: names });
      done.created += r.created; done.updated += r.updated;
      st.progress = Math.min(d.items.length, i + 10); render();
    }
    st.done = done;
    S.data = await api('GET', '/api/state');
    toast('นำเข้าเมนูเสร็จแล้ว');
  } catch (e) { toast(`หยุดที่รายการที่ ${st.progress + 1}: ${e.message} (กดนำเข้าใหม่ได้ ของที่เข้าแล้วจะไม่ซ้ำ)`, true); }
  st.running = false; render();
}

// ---------- ใส่รูปหลายรูป (จับคู่จากชื่อไฟล์) ----------
function matchItem(fileName) {
  const n = norm(fileName);
  const menu = S.data.menu;
  return menu.find((m) => norm(m.name) === n) || menu.find((m) => n.length >= 3 && (norm(m.name).includes(n) || n.includes(norm(m.name)) && norm(m.name).length >= 3));
}
function photosView() {
  const st = S.pics || (S.pics = { rows: [] });
  const back = h('button', { class: 'back', 'aria-label': 'กลับหน้าเมนู', onclick: () => { S.view = 'menu'; S.pics = null; render(); } }, '‹');
  const picker = h('input', { type: 'file', accept: 'image/*', multiple: true, id: 'f_pics', class: 'sr', onchange: (e) => {
    const files = [...e.target.files]; e.target.value = '';
    files.forEach((f) => { const m = matchItem(f.name); st.rows.push({ file: f, url: URL.createObjectURL(f), itemId: m ? m.id : 0, status: '' }); });
    render();
  } });
  const menuOpts = S.data.menu.slice().sort((a, b) => a.name.localeCompare(b.name, 'th'));
  const matched = st.rows.filter((r) => r.itemId && r.status !== 'done');
  const head = h('div', { class: 'panel grow' },
    h('div', { class: 'ph' }, h('span', {}, back, 'ใส่รูปเมนูหลายรูปพร้อมกัน')),
    h('div', { class: 'sub' }, 'ตั้งชื่อไฟล์รูปตามชื่อเมนู (เช่น หมูสามชั้น.jpg) ระบบจะจับคู่ให้เอง รูปไหนจับคู่ไม่ได้หรือผิด เลือกเมนูเองได้ในตาราง ระบบย่อรูปให้อัตโนมัติ'),
    h('div', { class: 'row2', style: 'max-width:640px' },
      h('label', { for: 'f_pics', class: 'btn blue filebtn' }, st.rows.length ? 'เลือกรูปเพิ่ม' : 'เลือกรูป (เลือกได้หลายรูป)'), picker,
      h('button', { class: 'btn', disabled: !matched.length || st.running, onclick: runPhotos }, st.running ? 'กำลังอัปโหลด…' : `อัปโหลด ${matched.length} รูป`)),
    st.running || st.total ? progressBar(st.progress || 0, st.total || 0) : null);
  if (!st.rows.length) return [h('div', { class: 'stack' }, head)];
  const rows = st.rows.map((r, idx) => h('tr', {},
    h('td', {}, h('img', { src: r.url, alt: '', class: 'thumb' })),
    h('td', { class: 'sub', style: 'word-break:break-all' }, r.file.name),
    h('td', {}, h('select', { class: 'inp', 'aria-label': `เมนูสำหรับรูป ${r.file.name}`, disabled: r.status === 'done', onchange: (e) => { r.itemId = Number(e.target.value); render(); } },
      h('option', { value: '0', selected: !r.itemId }, '— ไม่ใช้รูปนี้ —'),
      menuOpts.map((m) => h('option', { value: m.id, selected: r.itemId === m.id }, m.name + (m.image ? ' (มีรูปแล้ว)' : ''))))),
    h('td', {}, r.status === 'done' ? h('span', { class: 'tag2' }, 'เรียบร้อย') : r.status ? h('span', { class: 'sub', style: 'color:var(--bad)' }, r.status) : r.itemId ? '' : h('span', { class: 'sub' }, 'ไม่พบเมนูที่ชื่อตรง')),
    h('td', {}, r.status === 'done' ? null : h('button', { class: 'linkbtn', onclick: () => { st.rows.splice(idx, 1); render(); } }, 'เอาออก'))));
  const table = h('div', { class: 'panel grow' }, h('div', { class: 'sh' }, `รูปที่เลือก ${st.rows.length} รูป · จับคู่ได้ ${st.rows.filter((r) => r.itemId).length}`),
    h('div', { class: 'scrollbox' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['', 'ไฟล์', 'เมนู', 'สถานะ', ''].map((c) => h('th', {}, c)))), h('tbody', {}, rows))));
  return [h('div', { class: 'stack' }, head, table)];
}
async function runPhotos() {
  const st = S.pics;
  const todo = st.rows.filter((r) => r.itemId && r.status !== 'done');
  st.running = true; st.total = todo.length; st.progress = 0; render();
  for (const r of todo) {
    try { const blob = await shrinkImage(r.file); await api('PUT', `/api/menu/${r.itemId}/image`, blob); r.status = 'done'; }
    catch (e) { r.status = e.message; }
    st.progress++; render();
  }
  st.running = false;
  S.data = await api('GET', '/api/state').catch(() => S.data);
  const fail = todo.filter((r) => r.status !== 'done').length;
  toast(fail ? `อัปโหลดสำเร็จ ${todo.length - fail} รูป ไม่สำเร็จ ${fail} รูป` : `อัปโหลดรูปเรียบร้อย ${todo.length} รูป`, !!fail);
  render();
}
