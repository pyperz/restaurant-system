'use strict';
// ส่วนที่ 2: หน้าร้าน — ผังโต๊ะ เปิดโต๊ะ สั่งอาหาร จอครัว คิดเงิน
// (ใช้ตัวช่วย h, api, toast, money, S, render จาก app.js)

S.live = null;      // ข้อมูลโต๊ะที่เปิดอยู่ + ออเดอร์ที่ครัวยังทำไม่เสร็จ
S.skew = 0;         // เวลาเครื่อง iPad ต่างจากเวลาเซิร์ฟเวอร์เท่าไร
S.open = null;      // ฟอร์มเปิดโต๊ะ { table_id, package_id, adults, children }
S.sid = null;       // โต๊ะที่กำลังสั่งอาหาร / คิดเงิน
S.detail = null;
S.cart = {};        // 'pkg:12' | 'extra:12' → { qty, note }
S.mode = 'pkg';
S.cat = '';
S.pay = { method: 'cash', discount: '', penalty: '' };

const now = () => Date.now() + S.skew;
const mins = (ms) => Math.floor(ms / 60000);
function clock(ms) {
  const a = Math.abs(ms), m = Math.floor(a / 60000), s = Math.floor((a % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
}
function timeInfo(ses) {
  if (!ses.ends_at) return { cls: 'ok', tag: 'กำลังทาน', label: `นั่งมา ${mins(now() - ses.opened_at)} นาที`, pct: 0 };
  const left = ses.ends_at - now();
  const pct = Math.min(100, Math.max(0, ((now() - ses.opened_at) / (ses.ends_at - ses.opened_at)) * 100));
  if (left < 0) return { cls: 'over', tag: 'เกินเวลา', label: `เกิน ${clock(left)}`, pct: 100 };
  if (left <= 10 * 60000) return { cls: 'warn', tag: 'ใกล้หมดเวลา', label: `เหลือ ${clock(left)}`, pct };
  return { cls: 'ok', tag: 'กำลังทาน', label: `เหลือ ${clock(left)}`, pct };
}
const ago = (t) => { const m = mins(now() - t); return m < 1 ? 'เมื่อสักครู่' : `${m} นาทีที่แล้ว`; };

async function loadLive() {
  const t0 = Date.now();
  const live = await api('GET', '/api/live');
  S.skew = live.now - Math.round((t0 + Date.now()) / 2);
  S.live = live;
}
async function loadDetail() { S.detail = await api('GET', `/api/sessions/${S.sid}`); S.skew = S.detail.now - Date.now(); }

async function go(view, extra = {}) {
  Object.assign(S, { showQr: false }, extra, { view });
  if (['floor', 'orders'].includes(view)) store.set('view', view);
  try {
    if (view === 'table') {
      [S.data] = await Promise.all([api('GET', '/api/state'), loadDetail()]);
      const ss = S.detail.session; // พนักงานเปิดดูโต๊ะแล้ว = รับทราบการเรียก
      if (ss.call_staff_at || ss.call_bill_at) { api('POST', `/api/sessions/${ss.id}/ack`).catch(() => {}); ss.call_staff_at = ss.call_bill_at = 0; }
    }
    else if (view === 'checkout') await loadDetail();
    else if (['floor', 'orders'].includes(view)) { await loadLive(); alertNewInbox(S.live?.inbox); alertCalls(S.live?.sessions); alertNewOrders(S.live?.orders); autoPrint.check(); }
  } catch (e) { toast(e.message, true); }
  render();
}
async function doThen(fn, okMsg, after) {
  try { await fn(); if (okMsg) toast(okMsg); } catch (e) { toast(e.message, true); }
  if (after) await after(); else render();
}

// อัปเดตอัตโนมัติ: ตัวจับเวลาทุกวินาที และดึงข้อมูลใหม่ทุก 15 วินาที (เฉพาะตอนเปิดหน้าจออยู่)
setInterval(() => {
  document.querySelectorAll('[data-ses]').forEach((el) => {
    const ses = S.live?.sessions.find((x) => x.id === Number(el.dataset.ses)) || (S.detail?.session.id === Number(el.dataset.ses) ? S.detail.session : null);
    if (!ses) return;
    const t = timeInfo(ses);
    const lab = el.querySelector('.tm'); if (lab) lab.textContent = t.label;
    const bar = el.querySelector('.prog i'); if (bar) bar.style.width = t.pct + '%';
    const tag = el.querySelector('.tag2'); if (tag) tag.textContent = t.tag;
    el.classList.remove('ok', 'warn', 'over'); el.classList.add(t.cls);
  });
}, 1000);
let lastPoll = 0;
setInterval(async () => {
  if (!S.pin) return;
  const shown = ['floor', 'orders', 'line'].includes(S.view) && !document.hidden;
  // เครื่องที่เปิด "พิมพ์อัตโนมัติ" ดึงออเดอร์ทุก 8 วินาทีไม่ว่าจะอยู่หน้าไหน (แม้ย่อหน้าต่างไว้) จะได้พิมพ์และมีเสียงตลอด
  if (!shown && !autoPrint.on()) return;
  if (S.view === 'floor' && S.open) return; // กำลังกรอกฟอร์มเปิดโต๊ะอยู่ ไม่รบกวน
  const every = autoPrint.on() ? 8000 : S.view === 'orders' ? 10000 : 15000;
  if (Date.now() - lastPoll < every) return;
  lastPoll = Date.now();
  // ถ้ากำลังพิมพ์หมายเหตุหรือตัวเลขอยู่ ไม่วาดหน้าจอใหม่ (กันข้อความหาย)
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  try {
    if (S.view === 'line') await Promise.all([loadInbox(), loadLive()]); else await loadLive();
    autoPrint.check(); alertNewInbox(S.live?.inbox); alertCalls(S.live?.sessions); alertNewOrders(S.live?.orders);
    if (!typing && shown) render();
  } catch {}
}, 1000);

// ---------- ผังโต๊ะ ----------
function needLive(view) {
  if (S.live) return false;
  if (!S.loadingLive) { S.loadingLive = true; loadLive().then(() => { alertCalls(S.live?.sessions); alertNewOrders(S.live?.orders); alertNewInbox(S.live?.inbox); }).catch((e) => toast(e.message, true)).finally(() => { S.loadingLive = false; if (S.live) render(); }); }
  return true;
}
function floorView() {
  if (needLive()) return [h('div', { class: 'empty' }, 'กำลังโหลด…')];
  const { tables, packages } = S.data;
  const bySession = Object.fromEntries(S.live.sessions.map((s) => [s.table_id, s]));
  const used = S.live.sessions.filter((x) => x.table_id).length;

  const cards = tables.map((t) => {
    const ses = bySession[t.id];
    if (!ses) return h('button', { class: 'tc free' + (S.open?.table_id === t.id ? ' sel' : ''), onclick: () => { S.open = { table_id: t.id, package_id: packages.find((p) => p.active)?.id ?? 0, adults: Math.min(2, t.seats), children: 0 }; render(); } },
      h('span', { class: 'tt' }, t.name), h('span', { class: 'sub' }, `ว่าง · ${t.seats} ที่นั่ง`), h('span', { class: 'btn small' }, 'เปิดโต๊ะ'));
    const ti = timeInfo(ses);
    const calling = ses.call_bill_at ? 'ขอเช็คบิล' : ses.call_staff_at ? 'เรียกพนักงาน' : '';
    return h('button', { class: 'tc ' + ti.cls + (calling ? ' calling' : ''), 'data-ses': ses.id, onclick: () => go('table', { sid: ses.id, cart: {}, mode: ses.package_id ? 'pkg' : 'extra', cat: '' }) },
      h('span', { class: 'row' }, h('span', { class: 'tt' }, t.name), h('span', { class: 'tag2' }, ti.tag)),
      calling ? h('span', { class: 'callbadge' }, calling) : null,
      h('span', { class: 'pkn' }, ses.package_name || 'สั่งตามเมนู'),
      h('span', { class: 'sub' }, `${ses.adults + ses.children} คน · สั่งไปแล้ว ${ses.rounds} รอบ`),
      h('span', { class: 'tm' }, ti.label),
      ses.ends_at ? h('span', { class: 'prog' }, h('i', { style: `width:${ti.pct}%` })) : null);
  });

  const list = h('section', { class: 'list' },
    h('div', { class: 'ph' }, h('span', {}, 'ผังโต๊ะ'), h('span', { class: 'sub' }, `ลูกค้า ${used}/${tables.length} โต๊ะ`)),
    tables.length ? h('div', { class: 'tgrid' }, cards) : h('div', { class: 'empty' }, 'ยังไม่มีโต๊ะ ไปเพิ่มที่แท็บ "ตั้งค่า → โต๊ะ" ก่อน'),
    takeawayStrip());
  return S.open ? [list, openTablePanel()] : [list];
}

function openTablePanel() {
  const f = S.open;
  const t = S.data.tables.find((x) => x.id === f.table_id);
  const pkgs = S.data.packages.filter((p) => p.active);
  const pkg = pkgs.find((p) => p.id === f.package_id);
  const total = pkg ? f.adults * pkg.adult_price + f.children * pkg.child_price : 0;
  const step = (label, key) => h('div', { class: 'row' }, h('span', { class: 'lab' }, label),
    h('div', { class: 'stp' },
      h('button', { type: 'button', 'aria-label': `ลด${label}`, onclick: () => { f[key] = Math.max(0, f[key] - 1); render(); } }, '−'),
      h('span', { 'aria-live': 'polite' }, f[key]),
      h('button', { type: 'button', 'aria-label': `เพิ่ม${label}`, onclick: () => { f[key] = Math.min(99, f[key] + 1); render(); } }, '+')));
  return h('div', { class: 'panel' },
    h('div', { class: 'ph' }, h('span', {}, `เปิด${t?.name || 'โต๊ะ'}`)),
    h('div', { class: 'lab' }, 'แพ็กเกจ'),
    h('div', { class: 'opts' },
      pkgs.map((p) => h('button', { type: 'button', class: 'opt' + (f.package_id === p.id ? ' sel' : ''), 'aria-pressed': f.package_id === p.id ? 'true' : 'false', onclick: () => { f.package_id = p.id; render(); } }, p.name, h('br'), money(p.adult_price))),
      h('button', { type: 'button', class: 'opt' + (!f.package_id ? ' sel' : ''), 'aria-pressed': !f.package_id ? 'true' : 'false', onclick: () => { f.package_id = 0; render(); } }, 'สั่งตามเมนู', h('br'), h('small', {}, 'ไม่ใช่บุฟเฟต์'))),
    step(pkg ? 'ผู้ใหญ่' : 'จำนวนลูกค้า', 'adults'),
    pkg ? step(`เด็ก (${money(pkg.child_price)})`, 'children') : null,
    pkg ? h('div', { class: 'row' }, h('span', { class: 'lab' }, 'เวลาทาน'), h('strong', {}, pkg.duration_min ? `${pkg.duration_min} นาที` : 'ไม่จำกัด')) : null,
    pkg ? h('div', { class: 'sum' }, h('span', {}, 'ค่าบุฟเฟต์'), h('span', {}, money(total))) : null,
    h('div', { class: 'row2' },
      h('button', { type: 'button', class: 'btn ghost', onclick: () => { S.open = null; render(); } }, 'ยกเลิก'),
      h('button', { type: 'button', class: 'btn', onclick: () => doThen(async () => {
        const r = await api('POST', '/api/sessions', { table_id: f.table_id, package_id: f.package_id || null, adults: f.adults, children: pkg ? f.children : 0 });
        S.open = null; await go('table', { sid: r.id, cart: {}, mode: pkg ? 'pkg' : 'extra', cat: '' });
        if (autoPrint.on() && settings().qr_order_on !== '0') printQrSlip(S.detail?.session); // พิมพ์ QR สั่งอาหารวางบนโต๊ะ
      }, pkg ? 'เปิดโต๊ะแล้ว เริ่มจับเวลา' : 'เปิดโต๊ะแล้ว', async () => {}) }, pkg ? 'เริ่มจับเวลา' : 'เปิดโต๊ะ')));
}

// ---------- สั่งอาหาร ----------
function tableView() {
  const d = S.detail;
  if (!d || d.session.id !== S.sid) return [h('div', { class: 'empty' }, 'กำลังโหลด…')];
  const ses = d.session;
  if (ses.status !== 'open') { S.view = 'floor'; return floorView(); }
  const pkg = S.data.packages.find((p) => p.id === ses.package_id);
  const pkgItems = new Set(pkg ? pkg.item_ids : []);
  const mode = ses.package_id ? S.mode : 'extra';
  const pool = S.data.menu.filter((m) => (mode === 'pkg' ? pkgItems.has(m.id) : m.price != null));
  const cats = [...new Set(pool.map((m) => m.category).filter(Boolean))];
  const shown = S.cat ? pool.filter((m) => m.category === S.cat) : pool;
  const nextRound = d.orders.filter((o) => o.status !== 'cancelled').length + 1;
  const ti = timeInfo(ses);

  const qtyOf = (k) => S.cart[k]?.qty || 0;
  const setQty = (k, q) => { if (q <= 0) delete S.cart[k]; else S.cart[k] = { ...(S.cart[k] || {}), qty: Math.min(99, q) }; render(); };

  const tile = (m) => {
    const k = `${mode}:${m.id}`, q = qtyOf(k);
    return h('div', { class: 'ic' + (q ? ' picked' : '') + (m.available ? '' : ' soldout') },
      m.image ? h('img', { src: m.image, alt: '', loading: 'lazy' }) : h('div', { class: 'noimg emo' }, foodEmoji(m)),
      h('div', { class: 'icb' },
        h('div', { class: 'n' }, m.name),
        h('div', { class: 'p' }, m.available ? (mode === 'pkg' ? 'ในแพ็กเกจ' : money(m.price)) : 'หมด'),
        m.available ? h('div', { class: 'stp' },
          h('button', { type: 'button', 'aria-label': `ลด ${m.name}`, disabled: !q, onclick: () => setQty(k, q - 1) }, '−'),
          h('span', {}, q),
          h('button', { type: 'button', 'aria-label': `เพิ่ม ${m.name}`, onclick: () => setQty(k, q + 1) }, '+')) : null));
  };

  const menuBy = Object.fromEntries(S.data.menu.map((m) => [m.id, m]));
  const lines = Object.entries(S.cart).map(([k, v]) => { const [md, id] = k.split(':'); return { k, mode: md, m: menuBy[id], ...v }; }).filter((l) => l.m);
  const pkgLines = lines.filter((l) => l.mode === 'pkg'), extraLines = lines.filter((l) => l.mode === 'extra');
  const pkgCount = pkgLines.reduce((a, l) => a + l.qty, 0);
  const extraSum = extraLines.reduce((a, l) => a + l.qty * l.m.price, 0);
  const over = !!ses.max_per_round && pkgCount > ses.max_per_round;
  const cartLine = (l) => h('div', { class: 'cl' },
    h('div', { class: 'cr' }, h('span', {}, `${l.qty}× ${l.m.name}`), h('span', {}, l.mode === 'extra' ? money(l.qty * l.m.price) : '')),
    l.showNote || l.note
      ? h('input', { class: 'inp small', placeholder: 'หมายเหตุ เช่น ไม่เผ็ด', value: l.note || '', maxlength: 100, 'aria-label': `หมายเหตุ ${l.m.name}`,
          oninput: (e) => { S.cart[l.k].note = e.target.value; } })
      : h('button', { type: 'button', class: 'linkbtn', style: 'min-height:32px;padding:0', onclick: () => { S.cart[l.k].showNote = true; render(); document.querySelector(`input[aria-label="หมายเหตุ ${l.m.name}"]`)?.focus(); } }, '+ หมายเหตุ'));

  const noteInp = h('input', { class: 'inp small', id: 'f_onote', placeholder: 'หมายเหตุทั้งรอบ (ไม่บังคับ)', maxlength: 200 });
  const send = () => doThen(async () => {
    const items = lines.map((l) => ({ item_id: l.m.id, qty: l.qty, mode: l.mode, note: S.cart[l.k]?.note || '' }));
    const r = await api('POST', `/api/sessions/${ses.id}/orders`, { items, note: noteInp.value });
    S.cart = {}; await loadDetail(); toast(`ส่งรอบที่ ${r.round_no} เข้าครัวแล้ว`);
    // เครื่องที่เปิด "พิมพ์อัตโนมัติ" ไว้ พิมพ์ใบสั่งครัวทันทีที่ส่ง (ไม่ต้องรอรอบดึงข้อมูล) และจำไว้ไม่ให้พิมพ์ซ้ำ
    const sent = S.detail.orders.find((o) => o.id === r.id);
    if (sent && autoPrint.on()) {
      const seen = autoPrint.seen(); seen.add(sent.id); autoPrint.remember(seen);
      printOrder({ ...sent, table_name: ses.table_name });
      autoPrint.accept([sent.id]);
    }
  }, null, async () => render());

  const statusTh = { new: 'รอครัวรับ', cooking: 'กำลังทำ', ready: 'พร้อมเสิร์ฟ', done: 'เสิร์ฟแล้ว', cancelled: 'ยกเลิก' };
  const history = d.orders.slice().reverse().map((o) => h('div', { class: 'hist' + (o.status === 'cancelled' ? ' cancelled' : '') },
    h('div', { class: 'cr' }, h('strong', {}, o.status === 'cancelled' ? 'ยกเลิก' : `รอบที่ ${o.round_no}`, o.source === 'qr' ? h('span', { class: 'xt' }, 'ลูกค้าสั่งเอง') : null), h('span', { class: 'sub' }, `${ago(o.created_at)} · ${statusTh[o.status]}`)),
    h('div', { class: 'sub' }, o.items.map((i) => `${i.qty}× ${i.name}${i.in_package ? '' : ' (สั่งเพิ่ม)'}`).join(', ')),
    ['new', 'cooking'].includes(o.status) ? h('button', { type: 'button', class: 'linkbtn', onclick: () => { if (confirm(`ยกเลิกรอบที่ ${o.round_no} ใช่ไหม?`)) doThen(async () => { await api('PUT', `/api/orders/${o.id}/status`, { status: 'cancelled' }); await loadDetail(); }, 'ยกเลิกรอบแล้ว', async () => render()); } }, 'ยกเลิกรอบนี้') : null));

  const left = h('section', { class: 'list' },
    h('div', { class: 'ph' }, h('span', {}, h('button', { class: 'back', 'aria-label': 'กลับผังโต๊ะ', onclick: () => go('floor', { sid: null }) }, '‹'), `${ses.table_name} · รอบที่ ${nextRound}`),
      h('span', { class: 'tchip ' + ti.cls, 'data-ses': ses.id }, h('span', { class: 'tm' }, ti.label))),
    h('div', { class: 'sub' }, `${ses.package_name || 'สั่งตามเมนู'} · ${ses.adults + ses.children} คน${ses.max_per_round ? ` · ในแพ็กเกจสั่งได้รอบละ ${ses.max_per_round} จาน` : ''}`),
    ses.package_id ? h('div', { class: 'seg' },
      h('button', { class: mode === 'pkg' ? 'on' : '', 'aria-pressed': mode === 'pkg' ? 'true' : 'false', onclick: () => { S.mode = 'pkg'; S.cat = ''; render(); } }, 'ในแพ็กเกจ'),
      h('button', { class: mode === 'extra' ? 'on' : '', 'aria-pressed': mode === 'extra' ? 'true' : 'false', onclick: () => { S.mode = 'extra'; S.cat = ''; render(); } }, 'สั่งเพิ่ม (คิดเงินแยก)')) : null,
    cats.length > 1 ? h('div', { class: 'chips' }, h('button', { class: 'chip' + (!S.cat ? ' on' : ''), onclick: () => { S.cat = ''; render(); } }, 'ทั้งหมด'),
      cats.map((c) => h('button', { class: 'chip' + (S.cat === c ? ' on' : ''), onclick: () => { S.cat = c; render(); } }, c))) : null,
    shown.length ? h('div', { class: 'igrid' }, shown.map(tile))
      : h('div', { class: 'empty' }, mode === 'pkg' ? 'แพ็กเกจนี้ยังไม่มีรายการอาหาร ไปเลือกได้ที่แท็บ "แพ็กเกจ"' : 'ยังไม่มีเมนูที่ตั้งราคาสั่งเพิ่มไว้'));

  const right = h('div', { class: 'panel' },
    h('div', { class: 'ph' }, h('span', {}, 'รอบนี้'),
      ses.qr_token ? h('button', { class: 'btn ghost', style: 'height:44px;font-size:15px', onclick: () => { S.showQr = true; render(); } }, 'QR ให้ลูกค้าสั่ง') : null),
    lines.length ? null : h('div', { class: 'sub' }, 'แตะ + ที่รายการอาหารเพื่อเลือก'),
    pkgLines.length ? [h('div', { class: 'sh' }, `ในแพ็กเกจ (${pkgCount}${ses.max_per_round ? '/' + ses.max_per_round : ''} จาน)`), pkgLines.map(cartLine)] : null,
    over ? h('div', { class: 'warnbox' }, `เกินจำนวนจานต่อรอบ (${ses.max_per_round} จาน)`) : null,
    extraLines.length ? [h('div', { class: 'sh' }, 'สั่งเพิ่ม'), extraLines.map(cartLine)] : null,
    lines.length ? noteInp : null,
    extraLines.length ? h('div', { class: 'sum' }, h('span', {}, 'ยอดสั่งเพิ่มรอบนี้'), h('span', {}, money(extraSum))) : null,
    h('button', { class: 'btn sendbtn', disabled: !lines.length || over, onclick: send }, 'ส่งเข้าครัว'),
    h('button', { class: 'btn ghost', onclick: () => go('checkout', { pay: { method: 'cash', discount: '', penalty: '' } }) }, 'คิดเงิน / ปิดโต๊ะ'),
    d.orders.length ? [h('div', { class: 'sh' }, 'ที่สั่งไปแล้ว'), history]
      : h('button', { type: 'button', class: 'linkbtn', onclick: () => { if (confirm('ยกเลิกการเปิดโต๊ะนี้ใช่ไหม? (ใช้กรณีเปิดผิดโต๊ะ)')) doThen(() => api('DELETE', `/api/sessions/${ses.id}`), 'ยกเลิกการเปิดโต๊ะแล้ว', () => go('floor', { sid: null })); } }, 'เปิดโต๊ะผิด? ยกเลิกการเปิดโต๊ะ'));
  return [left, right, S.showQr ? qrModal(ses, () => { S.showQr = false; render(); }) : null];
}

// ---------- คิดเงิน ----------
function checkoutView() {
  const d = S.detail;
  if (!d || d.session.id !== S.sid) return [h('div', { class: 'empty' }, 'กำลังโหลด…')];
  const ses = d.session, b = d.bill, p = S.pay;
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  const total = () => Math.max(0, b.buffet + b.extras + num(p.penalty) - num(p.discount));
  const totalEl = h('span', {}, money(total()));
  const cr = (a, v) => h('div', { class: 'cr' }, h('span', {}, a), h('span', {}, v));

  const extras = {};
  d.orders.filter((o) => o.status !== 'cancelled').forEach((o) => o.items.filter((i) => !i.in_package).forEach((i) => {
    const k = `${i.name}|${i.unit_price}`; extras[k] = extras[k] || { name: i.name, unit: i.unit_price, qty: 0 }; extras[k].qty += i.qty;
  }));
  const adj = (label, key) => h('div', { class: 'adj' }, h('label', { for: 'f_' + key }, label),
    h('input', { class: 'inp', id: 'f_' + key, type: 'number', inputmode: 'decimal', min: 0, step: '1', value: p[key], placeholder: '0', style: 'width:140px;text-align:right',
      oninput: (e) => { p[key] = e.target.value; totalEl.textContent = money(total()); refreshQR(); } }));

  const left = h('div', { class: 'panel grow' },
    h('div', { class: 'ph' }, h('span', {}, h('button', { class: 'back', 'aria-label': 'กลับไปหน้าสั่งอาหาร', onclick: () => go('table') }, '‹'), `บิล ${ses.table_name}`),
      h('span', { class: 'sub' }, `เปิด ${new Date(ses.opened_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} · ทาน ${mins(now() - ses.opened_at)} นาที`)),
    ses.package_id || ses.package_name ? [h('div', { class: 'sh' }, `ค่าบุฟเฟต์ · ${ses.package_name}`),
      ses.adults ? cr(`${ses.adults}× ผู้ใหญ่ × ${money(ses.adult_price)}`, money(ses.adults * ses.adult_price)) : null,
      ses.children ? cr(`${ses.children}× เด็ก × ${money(ses.child_price)}`, money(ses.children * ses.child_price)) : null] : null,
    h('div', { class: 'sh' }, ses.package_name ? 'สั่งเพิ่ม (à la carte)' : 'รายการอาหาร'),
    Object.values(extras).length ? Object.values(extras).map((x) => cr(`${x.qty}× ${x.name} × ${money(x.unit)}`, money(x.qty * x.unit))) : h('div', { class: 'sub' }, 'ไม่มี'),
    h('div', { class: 'sh' }, 'ปรับยอด'),
    adj('ค่าปรับ (บาท) เช่น อาหารเหลือ', 'penalty'),
    adj('ส่วนลด (บาท)', 'discount'),
    h('div', { class: 'tot' }, h('span', {}, 'ยอดชำระ'), totalEl));

  const methods = [['cash', 'เงินสด'], ['promptpay', 'สแกน QR'], ['transfer', 'โอน'], ['other', 'อื่น ๆ']];
  // QR รับเงิน (รูปที่ร้านอัปโหลด หรือ QR PromptPay พร้อมยอด) อัปเดตตามส่วนลด/ค่าปรับ
  const qrWrap = h('div', {});
  function refreshQR() {
    if (p.method !== 'promptpay') { qrWrap.replaceChildren(); return; }
    const q = paymentQR(total(), 6);
    qrWrap.replaceChildren(q ? h('div', { class: 'qrpay' }, q, h('div', { class: 'qramt' }, money(total())), h('div', { class: 'sub', style: 'text-align:center' }, qrHint(total())))
      : h('div', { class: 'warnbox' }, 'ยังไม่ได้ตั้ง QR รับเงินของร้าน ไปตั้งได้ที่แท็บ "ตั้งค่า"'));
  }
  refreshQR();
  const right = h('div', { class: 'panel' },
    h('div', { class: 'ph' }, h('span', {}, 'ชำระเงิน')),
    h('div', { class: 'opts' }, methods.map(([k, l]) => h('button', { type: 'button', class: 'opt' + (p.method === k ? ' sel' : ''), 'aria-pressed': p.method === k ? 'true' : 'false', onclick: () => { p.method = k; render(); } }, l))),
    qrWrap,
    h('div', { class: 'sub' }, p.method === 'cash' ? 'รับเงินสดแล้วกดยืนยัน' : 'ตรวจว่าเงินเข้าบัญชีร้านแล้ว (เช่น ในแอป K SHOP) จึงกดยืนยัน'),
    h('button', { class: 'btn ghost', onclick: () => printNodes(billDoc(d, p, total(), p.method === 'promptpay' && hasPayQR())) }, 'พิมพ์ใบแจ้งยอด'),
    h('button', { class: 'btn big', onclick: () => {
      if (!confirm(`ยืนยันรับเงิน ${money(total())} และปิด${ses.table_name}?`)) return;
      doThen(async () => {
        const r = await api('POST', `/api/sessions/${ses.id}/close`, { method: p.method, discount: num(p.discount), penalty: num(p.penalty) });
        sound.kaching(); toast(`ปิด${ses.table_name}แล้ว · ${money(r.bill.total)}`);
      }, null, () => go('floor', { sid: null, detail: null }));
    } }, 'ยืนยันรับเงิน + ปิดโต๊ะ'));
  return [left, right];
}

// ---------- จอครัว / ออเดอร์ ----------
function ordersView() {
  if (needLive()) return [h('div', { class: 'empty' }, 'กำลังโหลด…')];
  const cols = [['new', 'ออเดอร์ใหม่', 'cooking', 'รับออเดอร์', 'b1'], ['cooking', 'กำลังทำ', 'ready', 'พร้อมเสิร์ฟ', 'blue'], ['ready', 'พร้อมเสิร์ฟ', 'done', 'เสิร์ฟแล้ว', 'okb']];
  const set = (o, status, msg) => doThen(async () => { await api('PUT', `/api/orders/${o.id}/status`, { status }); await loadLive(); }, msg, async () => render());
  const card = (o, next, label, cls) => h('div', { class: 'card' },
    h('div', { class: 'row' }, h('span', { class: 'no' }, o.table_name), h('span', { class: 'badge' }, `รอบที่ ${o.round_no}`)),
    h('div', { class: 'sub' }, ago(o.created_at), o.source === 'qr' ? h('span', { class: 'xt' }, 'ลูกค้าสั่งเอง') : null),
    o.items.map((i) => h('div', { class: 'it' }, h('span', { class: 'q' }, `${i.qty}×`), h('span', {}, i.name, i.in_package ? null : h('span', { class: 'xt' }, 'สั่งเพิ่ม'), i.note ? h('span', { class: 'inote' }, i.note) : null))),
    o.note ? h('div', { class: 'note' }, o.note) : null,
    h('div', { class: 'row2' },
      h('button', { class: 'btn ' + cls, onclick: () => set(o, next) }, label),
      h('button', { class: 'btn ghost narrow', 'aria-label': `พิมพ์ใบสั่ง ${o.table_name} รอบที่ ${o.round_no}`, onclick: () => printOrder(o) }, 'พิมพ์'),
      o.status !== 'ready' ? h('button', { class: 'btn ghost narrow', onclick: () => { if (confirm(`ยกเลิกออเดอร์ ${o.table_name} รอบที่ ${o.round_no}?`)) set(o, 'cancelled', 'ยกเลิกออเดอร์แล้ว'); } }, 'ยกเลิก') : null));
  const ap = autoPrint.on();
  const tools = h('div', { class: 'ktools' },
    h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: ap, onchange: () => autoPrint.toggle() }), ' พิมพ์และรับออเดอร์ใหม่อัตโนมัติบนเครื่องนี้'),
    h('span', { class: 'sub' }, ap ? 'ออเดอร์ใหม่จะพิมพ์ใบครัวเองแล้วย้ายไป "กำลังทำ" ทันที ไม่ต้องกดรับ (เช็กทุก 8 วินาที เปิดระบบค้างไว้หน้าไหนก็ได้)' : 'เปิดบนเครื่องที่ต่อเครื่องพิมพ์ จะพิมพ์และรับออเดอร์ให้เอง'));
  return [tools, h('div', { class: 'cols' }, cols.map(([st, title, next, label, cls]) => {
    const list = S.live.orders.filter((o) => o.status === st);
    return h('section', { class: 'col' }, h('div', { class: 'ch' }, h('span', {}, title), h('span', { class: 'cnt' }, list.length)),
      list.length ? list.map((o) => card(o, next, label, cls)) : h('div', { class: 'sub', style: 'text-align:center;padding:20px' }, 'ไม่มี'));
  }))];
}

