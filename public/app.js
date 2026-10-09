'use strict';
// หน้าจอ iPad: ตั้งค่าเมนู แพ็กเกจบุฟเฟต์ และโต๊ะ (หน้าร้านอยู่ใน service.js)

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

const APP_VERSION = 'v2026.10.10';
const S = { pin: store.get('pin'), view: store.get('view') || 'floor', data: null, sel: null };

// ---------- ตัวช่วยสร้างหน้าจอ ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
const money = (n) => (n == null ? '—' : '฿' + Number(n).toLocaleString('th-TH', { maximumFractionDigits: 2 }));

// ย่อรูปบน iPad ก่อนส่ง (ด้านยาวสุด 800px, JPG) รูปจะเล็กลงมาก โหลดเร็ว
async function shrinkImage(file, max = 800, type = 'image/jpeg') {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error('เปิดไฟล์รูปนี้ไม่ได้ ลองเลือกรูปอื่น')); i.src = url; });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((ok) => c.toBlob(ok, type, 0.82));
  } finally { URL.revokeObjectURL(url); }
}

let toastTimer;
function toast(msg, err) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ''), 2600);
}

async function api(method, url, body) {
  const isBlob = body instanceof Blob;
  const res = await fetch(url, {
    method, headers: { 'Content-Type': isBlob ? body.type : 'application/json', 'x-pin': S.pin || '' },
    body: isBlob ? body : body ? JSON.stringify(body) : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/api/login') { S.pin = null; store.set('pin', null); render(); }
  if (!res.ok) throw new Error(out.error || 'เกิดข้อผิดพลาด');
  return out;
}

async function load() { S.data = await api('GET', '/api/state'); render(); }

async function act(fn, okMsg) {
  try { await fn(); await load(); if (okMsg) toast(okMsg); }
  catch (e) { toast(e.message, true); }
}

// ---------- เข้าสู่ระบบ ----------
function loginView() {
  const inp = h('input', { class: 'inp pin', type: 'password', inputmode: 'numeric', autocomplete: 'current-password', id: 'pin', required: true });
  return h('div', { class: 'login' }, h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        S.pin = inp.value; await api('POST', '/api/login', { pin: inp.value });
        store.set('pin', inp.value); await load();
      } catch (err) { S.pin = null; toast(err.message, true); inp.value = ''; inp.focus(); }
    },
  }, h('h1', {}, 'เข้าสู่ระบบร้าน'), h('div', { class: 'field' }, h('label', { for: 'pin' }, 'รหัส PIN'), inp),
     h('button', { class: 'btn', type: 'submit' }, 'เข้าสู่ระบบ')));
}

// ---------- แถบด้านบน ----------
function bar() {
  const current = ['table', 'checkout'].includes(S.view) ? 'floor' : ['import', 'photos'].includes(S.view) ? 'menu' : S.view;
  const tab = (key, label, badge) => h('button', { class: 'tab' + (current === key ? ' on' : ''), 'aria-current': current === key ? 'page' : null, onclick: () => {
    S.sel = null; S.open = null;
    if (key === 'line') S.inbox = null;
    if (key === 'report') S.rep.data = null;
    if (key === 'floor' || key === 'orders') { go(key); return; }
    S.view = key; store.set('view', key); render();
  } }, label, badge ? h('span', { class: 'tbadge', 'aria-label': `${badge} งานใหม่` }, badge) : null);
  return h('header', { class: 'bar' },
    h('nav', { class: 'tabs', 'aria-label': 'เมนูหลัก' }, h('span', { class: 'shopn' }, S.data?.settings?.shop_name || 'ร้านของเรา'),
      tab('floor', 'ผังโต๊ะ'), tab('orders', 'ออเดอร์'), tab('menu', 'เมนู'), tab('packages', 'แพ็กเกจ'), tab('line', 'LINE', inboxTotal(S.live?.inbox)), tab('report', 'รายงาน'), tab('settings', 'ตั้งค่า')),
    h('div', { style: 'display:flex;align-items:center;gap:10px' }, h('span', { class: 'ver', title: 'เวอร์ชันของระบบ' }, APP_VERSION),
      h('button', { class: 'logout', onclick: () => { S.pin = null; store.set('pin', null); render(); } }, 'ออกจากระบบ')));
}

function field(label, attrs) {
  const id = 'f_' + attrs.name;
  return h('div', { class: 'field' }, h('label', { for: id }, label), h('input', { class: 'inp', id, ...attrs }));
}
const val = (form, name) => form.elements[name].value;
const chipsOf = (box) => [...box.querySelectorAll('.chip.on')].map((c) => Number(c.dataset.id));
function chip(label, id, on) {
  return h('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), 'data-id': id, 'aria-pressed': on ? 'true' : 'false',
    onclick: (e) => { const c = e.currentTarget; c.classList.toggle('on'); c.setAttribute('aria-pressed', c.classList.contains('on')); } }, label);
}
function confirmDelete(what, fn) { if (confirm(`ลบ${what}นี้ใช่ไหม? ลบแล้วกู้คืนไม่ได้`)) fn(); }

// ---------- หน้าเมนู ----------
function menuView() {
  const { menu, packages } = S.data;
  const item = S.sel === 'new' ? {} : menu.find((m) => m.id === S.sel);
  const pkgName = Object.fromEntries(packages.map((p) => [p.id, p.name]));
  const inPkgs = (id) => packages.filter((p) => p.item_ids.includes(id));

  const rows = menu.map((m) => h('div', { class: 'mrow' + (m.id === S.sel ? ' sel' : '') },
    m.image ? h('img', { class: 'thumb', src: m.image, alt: '', loading: 'lazy' }) : h('span', { class: 'thumb none', 'aria-hidden': 'true' }, 'ไม่มีรูป'),
    h('button', { class: 'mn', style: 'border:0;background:none;text-align:left;padding:8px 0;color:inherit', onclick: () => { S.sel = m.id; render(); } }, m.name, m.category ? h('span', { class: 'mc' }, m.category) : null),
    h('span', { class: 'mp' }, money(m.price)),
    h('span', { class: 'pk' }, inPkgs(m.id).length ? inPkgs(m.id).map((p) => h('span', { class: 'tag' }, pkgName[p.id])) : h('span', { class: 'sub' }, 'นอกแพ็กเกจ')),
    h('button', { class: 'mb ' + (m.available ? 'ok' : 'out'), 'aria-label': `${m.name}: ${m.available ? 'พร้อมขาย' : 'หมด'} แตะเพื่อเปลี่ยน`,
      onclick: () => act(() => api('PUT', `/api/menu/${m.id}`, { ...m, available: !m.available }), m.available ? `${m.name} หมดแล้ว` : `${m.name} พร้อมขาย`) },
      m.available ? 'พร้อมขาย' : 'หมด')));

  const list = h('section', { class: 'list' },
    h('div', { class: 'ph' }, h('span', {}, 'จัดการเมนู'), h('div', { class: 'acts2' },
      h('button', { class: 'btn ghost', onclick: () => { S.view = 'import'; S.imp = null; render(); } }, 'นำเข้าจากไฟล์'),
      h('button', { class: 'btn ghost', onclick: () => { S.view = 'photos'; S.pics = null; render(); } }, 'ใส่รูปหลายรูป'),
      h('button', { class: 'btn blue', onclick: () => { S.sel = 'new'; render(); } }, '+ เพิ่มเมนู'))),
    menu.length ? h('div', { class: 'colhead' }, h('span', { style: 'width:56px' }), h('span', { style: 'flex:1' }, 'ชื่อเมนู / หมวด'),
      h('span', { style: 'width:80px;text-align:right' }, 'ราคาสั่งเพิ่ม'), h('span', { style: 'width:170px' }, 'อยู่ในแพ็กเกจ'), h('span', { style: 'width:120px' })) : null,
    rows.length ? rows : h('div', { class: 'empty', style: 'display:flex;flex-direction:column;gap:14px;align-items:center' },
      h('div', {}, 'ยังไม่มีเมนู'),
      h('button', { class: 'btn', onclick: () => loadBundledMenu() }, 'นำเข้าเมนูจาก Food Story (288 รายการ)'),
      h('div', { class: 'sub' }, 'หรือกด "+ เพิ่มเมนู" เพื่อเพิ่มเอง')));

  if (!item) return [list];
  const chips = h('div', { class: 'chips' }, packages.length ? packages.map((p) => chip(p.name, p.id, item.id && p.item_ids.includes(item.id))) : h('span', { class: 'hint' }, 'ยังไม่มีแพ็กเกจ'));
  // รูปเมนู: เลือกจากคลังรูปหรือถ่ายใหม่ได้บน iPad
  let photo = null, dropPhoto = false;
  const preview = h('div', { class: 'photo' }, item.image ? h('img', { src: item.image, alt: 'รูปเมนู' }) : h('span', {}, 'ยังไม่มีรูป'));
  const removeBtn = h('button', { type: 'button', class: 'btn ghost', hidden: !item.image, onclick: () => {
    photo = null; dropPhoto = true; preview.replaceChildren(h('span', {}, 'ยังไม่มีรูป')); removeBtn.hidden = true;
  } }, 'ลบรูป');
  const picker = h('input', { type: 'file', accept: 'image/*', id: 'f_photo', class: 'sr', onchange: async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      photo = await shrinkImage(f); dropPhoto = false;
      preview.replaceChildren(h('img', { src: URL.createObjectURL(photo), alt: 'รูปเมนูที่เลือก' })); removeBtn.hidden = false;
    } catch (err) { toast(err.message, true); }
  } });
  const form = h('form', { class: 'panel', onsubmit: (e) => {
    e.preventDefault();
    const body = { name: val(form, 'name'), category: val(form, 'category'), price: val(form, 'price'), available: item.available !== false, package_ids: chipsOf(chips) };
    act(async () => {
      const r = await api(item.id ? 'PUT' : 'POST', item.id ? `/api/menu/${item.id}` : '/api/menu', body); S.sel = r.id;
      if (photo) await api('PUT', `/api/menu/${r.id}/image`, photo);
      else if (dropPhoto && item.image) await api('DELETE', `/api/menu/${r.id}/image`);
    }, 'บันทึกแล้ว');
  } },
    h('div', { class: 'ph' }, h('span', {}, item.id ? 'แก้ไขเมนู' : 'เมนูใหม่')),
    preview,
    h('div', { class: 'row2' }, h('label', { for: 'f_photo', class: 'btn blue filebtn' }, item.image ? 'เปลี่ยนรูป' : 'เลือกรูป / ถ่ายรูป'), removeBtn), picker,
    field('ชื่อเมนู', { name: 'name', value: item.name || '', required: true, maxlength: 80 }),
    field('หมวด', { name: 'category', value: item.category || '', maxlength: 40, list: 'cats', placeholder: 'เช่น เนื้อสัตว์ เครื่องดื่ม' }),
    h('datalist', { id: 'cats' }, [...new Set(menu.map((m) => m.category).filter(Boolean))].map((c) => h('option', { value: c }))),
    field('ราคาสั่งเพิ่ม (บาท)', { name: 'price', value: item.price ?? '', type: 'number', inputmode: 'decimal', min: 0, step: '0.25', placeholder: 'เว้นว่าง = ไม่ขายแยก' }),
    h('div', { class: 'sh' }, 'อยู่ในแพ็กเกจบุฟเฟต์ (แตะเพื่อเลือก)'), chips,
    h('div', { class: 'row2', style: 'margin-top:8px' },
      item.id ? h('button', { type: 'button', class: 'btn danger', onclick: () => confirmDelete('เมนู', () => act(async () => { await api('DELETE', `/api/menu/${item.id}`); S.sel = null; }, 'ลบแล้ว')) }, 'ลบ')
              : h('button', { type: 'button', class: 'btn ghost', onclick: () => { S.sel = null; render(); } }, 'ยกเลิก'),
      h('button', { class: 'btn', type: 'submit' }, 'บันทึก')));
  return [list, form];
}

// ---------- หน้าแพ็กเกจ ----------
function packagesView() {
  const { packages, menu } = S.data;
  const pkg = S.sel === 'new' ? {} : packages.find((p) => p.id === S.sel);
  const list = h('section', { class: 'list' },
    h('div', { class: 'ph' }, h('span', {}, 'แพ็กเกจบุฟเฟต์'), h('button', { class: 'btn blue', onclick: () => { S.sel = 'new'; render(); } }, '+ เพิ่มแพ็กเกจ')),
    packages.length ? packages.map((p) => h('button', { class: 'mrow' + (p.id === S.sel ? ' sel' : ''), onclick: () => { S.sel = p.id; render(); } },
      h('span', { class: 'mn' }, p.name, p.active ? null : h('span', { class: 'tag', style: 'margin-left:10px' }, 'ปิดขาย')),
      h('span', { class: 'sub' }, `${p.duration_min} นาที · ${p.item_ids.length} รายการ`),
      h('span', { class: 'mp', style: 'width:auto' }, money(p.adult_price))))
      : h('div', { class: 'empty' }, 'ยังไม่มีแพ็กเกจ กด "+ เพิ่มแพ็กเกจ" เพื่อเริ่ม'));

  if (!pkg) return [list];
  const chips = h('div', { class: 'chips' }, menu.length ? menu.map((m) => chip(m.name, m.id, pkg.item_ids?.includes(m.id))) : h('span', { class: 'hint' }, 'ยังไม่มีเมนู เพิ่มที่แท็บ "เมนู" ก่อน'));
  const active = h('input', { type: 'checkbox', id: 'f_active', checked: pkg.active !== false, style: 'width:24px;height:24px' });
  const form = h('form', { class: 'panel', onsubmit: (e) => {
    e.preventDefault();
    const body = { name: val(form, 'name'), adult_price: val(form, 'adult'), child_price: val(form, 'child') || 0,
      duration_min: val(form, 'dur'), max_per_round: val(form, 'max') || 0, active: active.checked, item_ids: chipsOf(chips) };
    act(async () => { const r = await api(pkg.id ? 'PUT' : 'POST', pkg.id ? `/api/packages/${pkg.id}` : '/api/packages', body); S.sel = r.id; }, 'บันทึกแล้ว');
  } },
    h('div', { class: 'ph' }, h('span', {}, pkg.id ? 'แก้ไขแพ็กเกจ' : 'แพ็กเกจใหม่')),
    field('ชื่อแพ็กเกจ', { name: 'name', value: pkg.name || '', required: true, maxlength: 60 }),
    h('div', { class: 'row2' },
      field('ราคาผู้ใหญ่ (บาท)', { name: 'adult', value: pkg.adult_price ?? '', type: 'number', inputmode: 'decimal', min: 0, step: '0.25', required: true }),
      field('ราคาเด็ก (บาท)', { name: 'child', value: pkg.child_price ?? '', type: 'number', inputmode: 'decimal', min: 0, step: '0.25' })),
    h('div', { class: 'row2' },
      field('เวลาทาน (นาที)', { name: 'dur', value: pkg.duration_min ?? 90, type: 'number', inputmode: 'numeric', min: 0, step: 1 }),
      field('จำกัดจาน/รอบ', { name: 'max', value: pkg.max_per_round ?? 0, type: 'number', inputmode: 'numeric', min: 0, step: 1 })),
    h('div', { class: 'hint' }, 'จำกัดจาน/รอบ ใส่ 0 = ไม่จำกัด'),
    h('label', { for: 'f_active', style: 'display:flex;gap:10px;align-items:center;font-size:17px;font-weight:600' }, active, 'เปิดขายแพ็กเกจนี้'),
    h('div', { class: 'sh' }, 'รายการอาหารในแพ็กเกจ (แตะเพื่อเลือก)'), chips,
    h('div', { class: 'row2', style: 'margin-top:8px' },
      pkg.id ? h('button', { type: 'button', class: 'btn danger', onclick: () => confirmDelete('แพ็กเกจ', () => act(async () => { await api('DELETE', `/api/packages/${pkg.id}`); S.sel = null; }, 'ลบแล้ว')) }, 'ลบ')
             : h('button', { type: 'button', class: 'btn ghost', onclick: () => { S.sel = null; render(); } }, 'ยกเลิก'),
      h('button', { class: 'btn', type: 'submit' }, 'บันทึก')));
  return [list, form];
}

// ---------- หน้าโต๊ะ ----------
function tablesView() {
  const { tables } = S.data;
  const t = S.sel === 'new' ? {} : tables.find((x) => x.id === S.sel);
  const list = h('section', { class: 'list' },
    h('div', { class: 'ph' }, h('span', {}, 'ตั้งค่าโต๊ะ'), h('span', { class: 'sub' }, `${tables.length} โต๊ะ · แตะโต๊ะเพื่อแก้ไข`)),
    h('div', { class: 'grid' },
      tables.map((x) => h('button', { class: 'tile' + (x.id === S.sel ? ' sel' : ''), onclick: () => { S.sel = x.id; render(); } },
        h('span', {}, x.name), h('span', { class: 'sub' }, `${x.seats} ที่นั่ง${x.zone ? ' · ' + x.zone : ''}`))),
      h('button', { class: 'tile add', onclick: () => { S.sel = 'new'; render(); } }, h('span', {}, '+'), h('span', { class: 'sub' }, 'เพิ่มโต๊ะ'))));

  const nextNo = tables.length + 1;
  const bulk = h('form', { class: 'panel', style: t ? 'position:static' : null, onsubmit: (e) => {
    e.preventDefault();
    act(() => api('POST', '/api/tables/bulk', { count: val(bulk, 'count'), start: val(bulk, 'start'), seats: val(bulk, 'bseats'), zone: val(bulk, 'bzone'), prefix: 'โต๊ะ' }), 'เพิ่มโต๊ะแล้ว');
  } },
    h('div', { class: 'ph' }, h('span', {}, 'เพิ่มหลายโต๊ะพร้อมกัน')),
    h('div', { class: 'row2' }, field('จำนวน', { name: 'count', value: 4, type: 'number', inputmode: 'numeric', min: 1, max: 100, required: true }),
      field('เริ่มที่เลข', { name: 'start', value: nextNo, type: 'number', inputmode: 'numeric', min: 0, required: true })),
    h('div', { class: 'row2' }, field('ที่นั่ง/โต๊ะ', { name: 'bseats', value: 4, type: 'number', inputmode: 'numeric', min: 1, max: 50 }),
      field('โซน', { name: 'bzone', value: '', maxlength: 30, placeholder: 'ไม่บังคับ' })),
    h('button', { class: 'btn blue', type: 'submit' }, 'เพิ่มโต๊ะ'));

  if (!t) return [list, bulk];
  const form = h('form', { class: 'panel', onsubmit: (e) => {
    e.preventDefault();
    const body = { name: val(form, 'name'), seats: val(form, 'seats'), zone: val(form, 'zone') };
    act(async () => { const r = await api(t.id ? 'PUT' : 'POST', t.id ? `/api/tables/${t.id}` : '/api/tables', body); S.sel = r.id; }, 'บันทึกแล้ว');
  } },
    h('div', { class: 'ph' }, h('span', {}, t.id ? t.name : 'โต๊ะใหม่')),
    field('ชื่อโต๊ะ', { name: 'name', value: t.name || `โต๊ะ ${nextNo}`, required: true, maxlength: 30 }),
    field('จำนวนที่นั่ง', { name: 'seats', value: t.seats ?? 4, type: 'number', inputmode: 'numeric', min: 1, max: 50, required: true }),
    field('โซน', { name: 'zone', value: t.zone || '', maxlength: 30, placeholder: 'เช่น ในร้าน ระเบียง' }),
    h('div', { class: 'row2', style: 'margin-top:8px' },
      t.id ? h('button', { type: 'button', class: 'btn danger', onclick: () => confirmDelete('โต๊ะ', () => act(async () => { await api('DELETE', `/api/tables/${t.id}`); S.sel = null; }, 'ลบแล้ว')) }, 'ลบโต๊ะ')
           : h('button', { type: 'button', class: 'btn ghost', onclick: () => { S.sel = null; render(); } }, 'ยกเลิก'),
      h('button', { class: 'btn', type: 'submit' }, 'บันทึก')));
  return [list, h('div', { style: 'display:flex;flex-direction:column;gap:20px' }, form, bulk)];
}

// ---------- วาดหน้าจอ ----------
function render() {
  const app = document.getElementById('app');
  if (!S.pin) { app.replaceChildren(loginView()); return; }
  if (!S.data) { app.replaceChildren(h('div', { class: 'login' }, 'กำลังโหลด…')); load().catch((e) => toast(e.message, true)); return; }
  if (S.view === 'tables') { S.view = 'settings'; S.setTab = 'tables'; } // ลิงก์เก่า
  const views = { menu: menuView, packages: packagesView, floor: floorView, orders: ordersView, table: tableView, checkout: checkoutView, report: reportView, settings: settingsView, line: lineView, import: importView, photos: photosView };
  const view = views[S.view] || floorView;
  app.replaceChildren(bar(), h('main', { class: 'wrap' + (['orders', 'report', 'settings', 'line', 'import', 'photos'].includes(S.view) ? ' full' : '') }, view()));
}
// เริ่มทำงานอยู่ท้าย extra.js (ต้องโหลดไฟล์อื่นก่อน)
