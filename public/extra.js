'use strict';
// ส่วนที่ 3: ตั้งค่าร้าน, QR PromptPay, พิมพ์ใบสั่งครัว/ใบแจ้งยอด, รายงานยอดขาย
// (ใช้ตัวช่วยจาก app.js, service.js และ qr.js)

const settings = () => S.data?.settings || { shop_name: '', promptpay_id: '', paper: '80', bill_footer: '', pay_qr: 'promptpay', qr_image: null };
const PAY_TH = { cash: 'เงินสด', promptpay: 'สแกน QR', transfer: 'โอน', other: 'อื่น ๆ' };
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
const fmtDate = (ms) => new Date(ms).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Bangkok' });
const thaiToday = (offsetDays = 0) => new Date(Date.now() + 7 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10);

// ---------- QR รับเงิน ----------
// แบบ 1: รูป QR ที่ร้านอัปโหลด (เช่น K SHOP / แม่มณี) — ลูกค้ากรอกยอดเอง
// แบบ 2: สร้าง QR PromptPay จากเลขบัญชี พร้อมยอดเงิน
const qrMode = () => (settings().pay_qr === 'image' && settings().qr_image ? 'image' : settings().promptpay_id ? 'promptpay' : null);
const hasPayQR = () => !!qrMode();
function paymentQR(amount, px = 6) {
  const mode = qrMode();
  if (mode === 'image') return h('div', { class: 'qrbox' }, h('img', { class: 'qrimg', src: settings().qr_image, alt: 'QR รับเงินของร้าน' }));
  if (mode !== 'promptpay') return null;
  const box = h('div', { class: 'qrbox' });
  try { box.innerHTML = QR.svg(promptPayPayload(settings().promptpay_id, amount), { px, label: `QR PromptPay ${money(amount)}` }); }
  catch (e) { box.textContent = e.message; }
  return box;
}
const qrHint = (amount) => (qrMode() === 'image' ? `ให้ลูกค้าสแกนแล้วกรอกยอด ${money(amount)}` : 'สแกนจ่ายด้วยแอปธนาคาร ยอดเงินขึ้นให้อัตโนมัติ');

// ---------- พิมพ์ผ่านเบราว์เซอร์ ----------
// ใช้ได้กับเครื่องพิมพ์ที่เครื่องนี้สั่งพิมพ์ได้อยู่แล้ว (ตั้งขนาดกระดาษ 58/80 มม. ในหน้าตั้งค่าร้าน)
function printNodes(...nodes) {
  const area = document.getElementById('print');
  area.className = 'paper' + settings().paper;
  area.replaceChildren(...nodes.flat());
  document.getElementById('pagesize').textContent = `@page{size:${settings().paper}mm auto;margin:0}`;
  // รอรูป (เช่น QR) โหลดเสร็จก่อนสั่งพิมพ์
  const imgs = [...area.querySelectorAll('img')].map((i) => (i.complete ? null : new Promise((ok) => { i.onload = i.onerror = ok; })));
  Promise.all(imgs).then(() => setTimeout(() => window.print(), 50));
}
function kitchenTicket(o) {
  return h('div', { class: 'tk' },
    h('div', { class: 'tk-big' }, o.table_name),
    h('div', { class: 'tk-mid' }, `รอบที่ ${o.round_no}`),
    h('div', { class: 'tk-sm' }, fmtTime(o.created_at), o.source === 'qr' ? ' · ลูกค้าสั่งเอง (QR)' : ''),
    h('hr'),
    o.items.map((i) => [h('div', { class: 'tk-line' }, h('b', {}, `${i.qty}×`), ' ', i.name, i.in_package ? '' : ' [สั่งเพิ่ม]'), i.note ? h('div', { class: 'tk-note' }, `- ${i.note}`) : null]),
    o.note ? [h('hr'), h('div', { class: 'tk-note' }, `หมายเหตุ: ${o.note}`)] : null,
    h('div', { class: 'tk-cut' }));
}
function printOrder(o) { printNodes(kitchenTicket(o)); }

function billDoc(d, p, total, withQR) {
  const ses = d.session, st = settings();
  const row = (a, b) => h('div', { class: 'tk-row' }, h('span', {}, a), h('span', {}, b));
  const extras = {};
  d.orders.filter((o) => o.status !== 'cancelled').forEach((o) => o.items.filter((i) => !i.in_package).forEach((i) => {
    const k = `${i.name}|${i.unit_price}`; extras[k] = extras[k] || { name: i.name, unit: i.unit_price, qty: 0 }; extras[k].qty += i.qty;
  }));
  const num = (v) => (Number(v) > 0 ? Number(v) : 0);
  return h('div', { class: 'tk' },
    h('div', { class: 'tk-mid', style: 'text-align:center' }, st.shop_name || 'ใบแจ้งยอด'),
    h('div', { class: 'tk-sm', style: 'text-align:center' }, `${ses.table_name} · ${fmtDate(Date.now())} ${fmtTime(Date.now())}`),
    h('hr'),
    ses.package_name ? [
      ses.adults ? row(`${ses.package_name} ผู้ใหญ่ ${ses.adults}×${ses.adult_price}`, money(ses.adults * ses.adult_price)) : null,
      ses.children ? row(`${ses.package_name} เด็ก ${ses.children}×${ses.child_price}`, money(ses.children * ses.child_price)) : null] : null,
    Object.values(extras).map((x) => row(`${x.name} ${x.qty}×${x.unit}`, money(x.qty * x.unit))),
    num(p.penalty) ? row('ค่าปรับ', money(num(p.penalty))) : null,
    num(p.discount) ? row('ส่วนลด', '-' + money(num(p.discount))) : null,
    h('hr'),
    h('div', { class: 'tk-row tk-mid' }, h('span', {}, 'ยอดชำระ'), h('span', {}, money(total))),
    withQR ? [h('div', { class: 'tk-sm', style: 'text-align:center;margin-top:6px' }, qrHint(total)), paymentQR(total, 4)] : null,
    h('div', { class: 'tk-sm', style: 'text-align:center;margin-top:6px' }, st.bill_footer || 'ขอบคุณที่ใช้บริการ'),
    h('div', { class: 'tk-sm', style: 'text-align:center' }, '(ใบแจ้งยอด ไม่ใช่ใบกำกับภาษี)'),
    h('div', { class: 'tk-cut' }));
}

// ---------- พิมพ์ออเดอร์ใหม่อัตโนมัติ (ตั้งแยกแต่ละเครื่อง เช่น เปิดไว้ที่เครื่องในครัว) ----------
const autoPrint = {
  on: () => store.get('autoprint') === '1',
  seen: () => { try { return new Set(JSON.parse(store.get('printed') || '[]')); } catch { return new Set(); } },
  remember(ids) { store.set('printed', JSON.stringify([...ids].slice(-300))); },
  toggle() {
    const on = !this.on();
    store.set('autoprint', on ? '1' : null);
    if (on && S.live) this.remember(new Set([...this.seen(), ...S.live.orders.map((o) => o.id)])); // ไม่พิมพ์ของเก่าที่ค้างอยู่
    toast(on ? 'เปิดพิมพ์อัตโนมัติบนเครื่องนี้แล้ว' : 'ปิดพิมพ์อัตโนมัติแล้ว');
    render();
  },
  check() {
    if (!this.on() || !S.live) return;
    const seen = this.seen();
    const fresh = S.live.orders.filter((o) => o.status === 'new' && !seen.has(o.id));
    if (!fresh.length) return;
    fresh.forEach((o) => seen.add(o.id));
    this.remember(seen);
    printNodes(fresh.map(kitchenTicket));
  },
};

// ---------- ตั้งค่า (ร้าน + โต๊ะ) ----------
function settingsView() {
  const st = settings();
  const seg = h('div', { class: 'seg', style: 'max-width:420px' },
    h('button', { class: S.setTab !== 'tables' ? 'on' : '', onclick: () => { S.setTab = 'shop'; S.sel = null; render(); } }, 'ข้อมูลร้าน'),
    h('button', { class: S.setTab === 'tables' ? 'on' : '', onclick: () => { S.setTab = 'tables'; S.sel = null; render(); } }, 'โต๊ะ'));
  if (S.setTab === 'tables') return [h('div', { style: 'display:flex;flex-direction:column;gap:16px;width:100%' }, seg, h('div', { class: 'wrap', style: 'padding:0' }, tablesView()))];

  const paper = h('select', { class: 'inp', id: 'f_paper', name: 'paper' },
    h('option', { value: '80', selected: st.paper === '80' }, '80 มม. (ใหญ่)'), h('option', { value: '58', selected: st.paper === '58' }, '58 มม. (เล็ก)'));
  // ---- QR รับเงิน ----
  S.qrTab = S.qrTab || (st.pay_qr === 'image' ? 'image' : 'promptpay');
  const preview = h('div', { class: 'qrprev' });
  const showQR = (id) => {
    preview.replaceChildren();
    const d = String(id || '').replace(/\D/g, '');
    if (![10, 13, 15].includes(d.length)) { preview.append(h('span', { class: 'sub' }, 'ใส่เลขให้ครบ แล้วจะเห็นตัวอย่าง QR ที่นี่')); return; }
    const box = h('div', { class: 'qrbox' }); box.innerHTML = QR.svg(promptPayPayload(d, 1), { px: 5, label: 'ตัวอย่าง QR 1 บาท' });
    preview.append(box, h('div', { class: 'sub' }, 'ลองสแกนด้วยแอปธนาคาร ควรขึ้นชื่อบัญชีร้าน และยอด 1 บาท (ไม่ต้องโอนจริง)'));
  };
  const qrPicker = h('input', { type: 'file', accept: 'image/*', id: 'f_qrimg', class: 'sr', onchange: async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    // QR ต้องคมชัด: ย่อไม่เกิน 1200px และเก็บเป็น PNG
    act(async () => { const blob = await shrinkImage(f, 1200, 'image/png'); await api('PUT', '/api/settings/qr-image', blob); await api('PUT', '/api/settings', { pay_qr: 'image' }); }, 'อัปโหลดรูป QR แล้ว');
  } });
  const imagePane = h('div', { class: 'qrprev' },
    st.qr_image ? h('div', { class: 'qrbox big' }, h('img', { class: 'qrimg', src: st.qr_image, alt: 'รูป QR รับเงินของร้าน' })) : h('div', { class: 'photo', style: 'width:220px;height:220px;flex:none' }, 'ยังไม่มีรูป QR'),
    h('div', { style: 'display:flex;flex-direction:column;gap:10px' },
      h('div', { class: 'sub' }, 'บันทึกรูป QR รับเงินจากแอป K SHOP (หรือแอปธนาคารอื่น) เป็นรูปภาพ แล้วอัปโหลดที่นี่ ตอนคิดเงินระบบจะแสดงรูปนี้พร้อมยอดเงิน ลูกค้าสแกนแล้วกรอกยอดเอง'),
      h('div', { class: 'sub' }, 'แนะนำ: ครอปรูปให้เหลือเฉพาะตัว QR ก่อนอัปโหลด จะสแกนง่ายกว่า และพิมพ์บนเครื่องพิมพ์ความร้อนได้ชัดกว่า'),
      h('label', { for: 'f_qrimg', class: 'btn blue filebtn' }, st.qr_image ? 'เปลี่ยนรูป QR' : 'อัปโหลดรูป QR'), qrPicker,
      st.qr_image ? h('button', { type: 'button', class: 'btn ghost', onclick: () => { if (confirm('ลบรูป QR นี้ใช่ไหม?')) act(() => api('DELETE', '/api/settings/qr-image'), 'ลบรูปแล้ว'); } }, 'ลบรูป') : null));
  const ppPane = h('div', { style: 'display:flex;flex-direction:column;gap:12px' },
    h('div', { class: 'field' }, h('label', { for: 'f_promptpay_id' }, 'เลข PromptPay (เบอร์มือถือ หรือเลข 13 หลัก)'),
      h('input', { class: 'inp', id: 'f_promptpay_id', name: 'promptpay_id', value: st.promptpay_id, inputmode: 'numeric', maxlength: 20, oninput: (e) => showQR(e.target.value) })),
    preview);
  const qrSeg = h('div', { class: 'seg', style: 'max-width:560px' },
    h('button', { type: 'button', class: S.qrTab === 'image' ? 'on' : '', onclick: () => { S.qrTab = 'image'; render(); } }, 'อัปโหลดรูป QR (เช่น K SHOP)'),
    h('button', { type: 'button', class: S.qrTab === 'promptpay' ? 'on' : '', onclick: () => { S.qrTab = 'promptpay'; render(); } }, 'สร้างจากเลข PromptPay'));
  const qrSection = h('div', { class: 'qrsec' },
    h('div', { class: 'lab' }, 'QR รับเงิน'), qrSeg,
    S.qrTab === 'image' ? imagePane : ppPane,
    h('div', { class: 'sub' }, `ตอนนี้ใช้: ${qrMode() === 'image' ? 'รูป QR ที่อัปโหลด' : qrMode() === 'promptpay' ? 'QR PromptPay พร้อมยอดเงิน' : 'ยังไม่ได้ตั้ง'}${S.qrTab !== (st.pay_qr === 'image' ? 'image' : 'promptpay') ? ' · กด "บันทึก" เพื่อเปลี่ยนไปใช้แบบนี้' : ''}`));

  const form = h('form', { class: 'panel grow', style: 'flex:none;max-height:none', onsubmit: (e) => {
    e.preventDefault();
    const body = { shop_name: val(form, 'shop_name'), paper: paper.value, bill_footer: val(form, 'bill_footer'), pay_qr: S.qrTab, qr_order_on: form.elements.qr_order_on.checked ? '1' : '0' };
    if (S.qrTab === 'promptpay') body.promptpay_id = val(form, 'promptpay_id');
    act(() => api('PUT', '/api/settings', body), 'บันทึกแล้ว');
  } },
    h('div', { class: 'ph' }, h('span', {}, 'ข้อมูลร้าน')),
    field('ชื่อร้าน (แสดงบนแถบด้านบนและใบแจ้งยอด)', { name: 'shop_name', value: st.shop_name, maxlength: 60 }),
    h('label', { class: 'switch', style: 'background:var(--ground)' }, h('input', { type: 'checkbox', name: 'qr_order_on', checked: st.qr_order_on !== '0' }),
      h('span', {}, 'ให้ลูกค้าสแกน QR ที่โต๊ะสั่งอาหารเองได้', h('span', { class: 'sub', style: 'display:block;font-weight:400' }, 'เปิดโต๊ะแล้วกด "QR ให้ลูกค้าสั่ง" ในหน้าสั่งอาหาร หรือให้เครื่องที่พิมพ์อัตโนมัติพิมพ์ QR ออกมาเอง'))),
    qrSection,
    h('div', { class: 'field' }, h('label', { for: 'f_paper' }, 'ขนาดกระดาษเครื่องพิมพ์'), paper),
    field('ข้อความท้ายใบแจ้งยอด', { name: 'bill_footer', value: st.bill_footer, maxlength: 120, placeholder: 'ขอบคุณที่ใช้บริการ' }),
    h('button', { class: 'btn', type: 'submit', style: 'max-width:240px' }, 'บันทึก'));
  if (S.qrTab === 'promptpay') showQR(st.promptpay_id);
  return [h('div', { style: 'display:flex;flex-direction:column;gap:16px;width:100%' }, seg, form, soundPanel())];
}

// ---------- รายงานยอดขาย ----------
S.rep = { from: thaiToday(), to: thaiToday(), data: null, loading: false };
async function loadReport() {
  S.rep.loading = true;
  try { S.rep.data = await api('GET', `/api/report?from=${S.rep.from}&to=${S.rep.to}`); }
  catch (e) { toast(e.message, true); }
  S.rep.loading = false; render();
}
function reportView() {
  const r = S.rep;
  if (!r.data && !r.loading) { loadReport(); }
  const quick = (label, from, to) => h('button', { class: 'chip' + (r.from === from && r.to === to ? ' on' : ''), onclick: () => { r.from = from; r.to = to; loadReport(); } }, label);
  const monthStart = thaiToday().slice(0, 8) + '01';
  const dateInp = (key, label) => h('div', { class: 'field' }, h('label', { for: 'f_' + key }, label),
    h('input', { class: 'inp', type: 'date', id: 'f_' + key, value: r[key], onchange: (e) => { r[key] = e.target.value; if (r.from && r.to) loadReport(); } }));
  const head = h('div', { class: 'panel grow' },
    h('div', { class: 'ph' }, h('span', {}, 'รายงานยอดขาย')),
    h('div', { class: 'chips' }, quick('วันนี้', thaiToday(), thaiToday()), quick('เมื่อวาน', thaiToday(-1), thaiToday(-1)),
      quick('7 วันล่าสุด', thaiToday(-6), thaiToday()), quick('เดือนนี้', monthStart, thaiToday())),
    h('div', { class: 'row2', style: 'max-width:520px' }, dateInp('from', 'ตั้งแต่วันที่'), dateInp('to', 'ถึงวันที่')));
  const d = r.data;
  if (!d) return [h('div', { class: 'stack' }, head, h('div', { class: 'empty' }, 'กำลังโหลด…'))];

  const stat = (label, value, sub) => h('div', { class: 'stat' }, h('div', { class: 'sub' }, label), h('div', { class: 'sv' }, value), sub ? h('div', { class: 'sub' }, sub) : null);
  const stats = h('div', { class: 'stats' },
    stat('ยอดขายรวม', money(d.total), `${d.bills} บิล`),
    stat('ลูกค้า', `${d.guests} คน`, d.bills ? `เฉลี่ย ${money(Math.round(d.total / Math.max(1, d.guests)))} / คน` : null),
    stat('ค่าบุฟเฟต์', money(d.buffet)),
    stat('สั่งเพิ่ม', money(d.extras), d.discount || d.penalty ? `ส่วนลด ${money(d.discount)} · ค่าปรับ ${money(d.penalty)}` : null));
  const table = (cols, rows) => h('table', { class: 'tbl' },
    h('thead', {}, h('tr', {}, cols.map((c) => h('th', { class: c.num ? 'num' : null }, c.label)))),
    h('tbody', {}, rows.length ? rows.map((r) => h('tr', {}, r.map((v, i) => h('td', { class: cols[i].num ? 'num' : null }, v))))
      : h('tr', {}, h('td', { colspan: cols.length, class: 'sub' }, 'ไม่มีข้อมูล'))));
  const methods = h('div', { class: 'panel grow' }, h('div', { class: 'sh' }, 'แยกตามวิธีชำระเงิน'),
    table([{ label: 'วิธีชำระ' }, { label: 'ยอด', num: true }], Object.entries(d.by_method).map(([k, v]) => [PAY_TH[k] || k, money(v)])));
  const days = d.by_day.length > 1 ? h('div', { class: 'panel grow' }, h('div', { class: 'sh' }, 'รายวัน'),
    table([{ label: 'วันที่' }, { label: 'บิล', num: true }, { label: 'ยอด', num: true }], d.by_day.map((x) => [x.date.split('-').reverse().join('/'), x.bills, money(x.total)]))) : null;
  const items = h('div', { class: 'panel grow' }, h('div', { class: 'sh' }, 'เมนูที่สั่งมากที่สุด'),
    table([{ label: 'เมนู' }, { label: 'ประเภท' }, { label: 'จำนวน', num: true }, { label: 'ยอดขาย', num: true }],
      d.items.map((i) => [i.name, i.in_package ? 'ในแพ็กเกจ' : 'สั่งเพิ่ม', i.qty, i.in_package ? '—' : money(i.amount)])));
  const bills = h('div', { class: 'panel grow' }, h('div', { class: 'sh' }, 'รายการบิล'),
    table([{ label: 'ปิดบิล' }, { label: 'โต๊ะ' }, { label: 'แพ็กเกจ' }, { label: 'คน', num: true }, { label: 'ชำระ' }, { label: 'ยอด', num: true }],
      d.list.slice().reverse().map((b) => [`${fmtDate(b.closed_at)} ${fmtTime(b.closed_at)}`, b.table_name, b.package_name || 'สั่งตามเมนู', b.guests, PAY_TH[b.pay_method] || b.pay_method, money(b.total)])));
  return [h('div', { class: 'stack' }, head, stats, h('div', { class: 'two' }, methods, days || items), days ? items : null, bills)];
}
