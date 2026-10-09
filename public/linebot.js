'use strict';
// ส่วนที่ 4: หน้าจอพนักงานสำหรับงานจาก LINE (ออเดอร์กลับบ้าน, การจอง, ลูกค้าขอคุยกับพนักงาน) + ตั้งค่าบอท

S.inbox = null;
async function loadInbox() { S.inbox = await api('GET', '/api/line/inbox'); }
const inboxTotal = (c) => (c ? c.orders + c.reservations + c.handoffs : 0);

// เสียงเตือนสั้น ๆ เมื่อมีงานใหม่จาก LINE (เบราว์เซอร์อนุญาตเสียงหลังจากแตะหน้าจอแล้วครั้งหนึ่ง)
let lastInbox = null;
function alertNewInbox(counts) {
  const n = inboxTotal(counts);
  if (lastInbox !== null && n > lastInbox) {
    toast('มีงานใหม่จาก LINE ดูที่แท็บ LINE');
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.25].forEach((d) => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(ac.destination); o.start(ac.currentTime + d); o.stop(ac.currentTime + d + 0.15); });
    } catch {}
  }
  lastInbox = n;
}

const lineDo = (fn, okMsg) => doThen(async () => {
  const r = await fn();
  await loadInbox();
  if (r && r.notified === false && okMsg) toast(okMsg + ' (ไม่ได้ส่ง LINE แจ้งลูกค้า)'); else if (okMsg) toast(okMsg + (r?.notified ? ' และแจ้งลูกค้าทาง LINE แล้ว' : ''));
}, null, async () => render());

function lineView() {
  if (!S.inbox) { if (!S.loadingInbox) { S.loadingInbox = true; loadInbox().catch((e) => toast(e.message, true)).finally(() => { S.loadingInbox = false; render(); }); } return [h('div', { class: 'empty' }, 'กำลังโหลด…')]; }
  const ib = S.inbox, st = settings();
  const ago2 = (t) => { const m = Math.floor((Date.now() - t) / 60000); return m < 1 ? 'เมื่อสักครู่' : m < 60 ? `${m} นาทีที่แล้ว` : `${Math.floor(m / 60)} ชม.ที่แล้ว`; };

  const setup = !ib.configured ? h('div', { class: 'panel grow warnpanel' },
    h('div', { class: 'ph' }, h('span', {}, 'ยังไม่ได้เชื่อม LINE OA')),
    h('div', {}, 'ทำตามขั้นตอนในไฟล์ README หัวข้อ "เชื่อม LINE OA" แล้วใส่ Webhook URL นี้ในหน้า LINE Developers'),
    h('div', { class: 'copyrow' }, h('code', {}, ib.webhook_url),
      h('button', { class: 'btn ghost narrow', onclick: () => navigator.clipboard?.writeText(ib.webhook_url).then(() => toast('คัดลอกแล้ว')) }, 'คัดลอก'))) : null;

  const orderCard = (o) => h('div', { class: 'card' },
    h('div', { class: 'row' }, h('span', { class: 'no' }, o.name), h('span', { class: 'badge' }, o.pickup === 'asap' ? 'รับเร็วที่สุด' : `รับ ${o.pickup} น.`)),
    h('div', { class: 'sub' }, `โทร ${o.phone} · ${ago2(o.created_at)}${o.from_line ? ' · จาก LINE' : ''}`),
    o.items.map((i) => h('div', { class: 'it' }, h('span', { class: 'q' }, `${i.qty}×`), h('span', { style: 'flex:1' }, i.name, i.note ? h('span', { class: 'inote' }, i.note) : null), h('span', {}, money(i.qty * i.unit_price)))),
    o.note ? h('div', { class: 'note' }, o.note) : null,
    h('div', { class: 'cr', style: 'font-weight:700' }, h('span', {}, 'รวม'), h('span', {}, money(o.total))),
    o.status === 'pending' ? h('div', { class: 'row2' },
      h('button', { class: 'btn', onclick: () => lineDo(() => api('POST', `/api/line/orders/${o.id}/accept`), 'รับออเดอร์แล้ว ส่งเข้าครัวแล้ว') }, 'รับออเดอร์'),
      h('button', { class: 'btn ghost narrow', onclick: () => { const reason = prompt('เหตุผลที่รับไม่ได้ (จะส่งให้ลูกค้า)', 'ของหมด'); if (reason !== null) lineDo(() => api('POST', `/api/line/orders/${o.id}/reject`, { reason }), 'ปฏิเสธออเดอร์แล้ว'); } }, 'ปฏิเสธ'))
      : h('div', { class: 'sub' }, o.status === 'accepted' ? 'รับแล้ว · ดูที่ผังโต๊ะ (สั่งกลับบ้าน)' : `ปฏิเสธแล้ว${o.reason ? ` · ${o.reason}` : ''}`));

  const resvCard = (r) => h('div', { class: 'card' },
    h('div', { class: 'row' }, h('span', { class: 'no' }, r.name), h('span', { class: 'badge' }, `${r.people} คน`)),
    h('div', { style: 'font-size:18px;font-weight:600' }, r.when.split(' ')[0].split('-').reverse().join('/') + ' · ' + r.when.split(' ')[1] + ' น.'),
    h('div', { class: 'sub' }, `โทร ${r.phone}${r.from_line ? ' · จาก LINE' : ''}`),
    r.note ? h('div', { class: 'note' }, r.note) : null,
    r.status === 'pending' ? h('div', { class: 'row2' },
      h('button', { class: 'btn blue', onclick: () => lineDo(() => api('POST', `/api/line/reservations/${r.id}`, { status: 'confirmed' }), 'ยืนยันการจองแล้ว') }, 'ยืนยันการจอง'),
      h('button', { class: 'btn ghost narrow', onclick: () => { const reason = prompt('เหตุผล (จะส่งให้ลูกค้า)', 'โต๊ะเต็มช่วงเวลานี้'); if (reason !== null) lineDo(() => api('POST', `/api/line/reservations/${r.id}`, { status: 'declined', reason }), 'ปฏิเสธการจองแล้ว'); } }, 'ปฏิเสธ'))
      : h('div', { class: 'row2' }, h('span', { class: 'tag2', style: 'align-self:center' }, 'ยืนยันแล้ว'),
        h('button', { class: 'btn ghost narrow', onclick: () => lineDo(() => api('POST', `/api/line/reservations/${r.id}`, { status: 'arrived' }), 'บันทึกว่ามาถึงแล้ว') }, 'มาแล้ว'),
        h('button', { class: 'btn ghost narrow', onclick: () => { if (confirm('ยกเลิกการจองนี้?')) lineDo(() => api('POST', `/api/line/reservations/${r.id}`, { status: 'cancelled' }), 'ยกเลิกการจองแล้ว'); } }, 'ยกเลิก')));

  const pendingOrders = ib.orders.filter((o) => o.status === 'pending'), doneOrders = ib.orders.filter((o) => o.status !== 'pending');
  const col = (title, n, kids, empty) => h('section', { class: 'col' }, h('div', { class: 'ch' }, h('span', {}, title), h('span', { class: 'cnt' }, n)), kids.length ? kids : h('div', { class: 'sub', style: 'text-align:center;padding:20px' }, empty));

  const board = h('div', { class: 'cols' },
    col('สั่งกลับบ้าน รอรับ', pendingOrders.length, [...pendingOrders.map(orderCard), doneOrders.length ? h('details', {}, h('summary', { class: 'sub', style: 'padding:8px 0;cursor:pointer' }, `ที่จัดการแล้ววันนี้ (${doneOrders.length})`), doneOrders.map(orderCard)) : null].filter(Boolean), 'ไม่มีออเดอร์ใหม่'),
    col('การจองโต๊ะ', ib.reservations.filter((r) => r.status === 'pending').length, ib.reservations.map(resvCard), 'ยังไม่มีการจอง'),
    col('ลูกค้าขอคุยกับพนักงาน', ib.handoffs.length, ib.handoffs.map((u) => h('div', { class: 'card' },
      h('div', { class: 'no' }, u.name), h('div', { class: 'sub' }, `ขอเมื่อ ${ago2(u.asked_at)} · บอทหยุดตอบจนถึง ${new Date(u.until).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`),
      h('div', { class: 'sub' }, 'ตอบลูกค้าในแอป LINE Official Account (แท็บแชท)'),
      h('button', { class: 'btn ghost', onclick: () => lineDo(() => api('POST', '/api/line/handoff/end', { user_id: u.user_id }), 'ให้บอทตอบต่อแล้ว') }, 'คุยเสร็จแล้ว ให้บอทตอบต่อ'))), 'ไม่มี'));

  // ---- ตั้งค่าบอท ----
  const sw = (key, label, hint) => h('label', { class: 'switch', style: 'background:var(--ground)' },
    h('input', { type: 'checkbox', name: key, checked: st[key] !== '0' }), h('span', {}, label, hint ? h('span', { class: 'sub', style: 'display:block;font-weight:400' }, hint) : null));
  const origin = location.origin;
  const form = h('form', { class: 'panel grow', onsubmit: (e) => {
    e.preventDefault();
    const el = form.elements, b = {};
    ['bot_on', 'bot_ai', 'takeaway_on', 'reserve_on'].forEach((k) => { b[k] = el[k].checked ? '1' : '0'; });
    ['open_hours', 'address', 'phone', 'shop_info'].forEach((k) => { b[k] = el[k].value; });
    act(() => api('PUT', '/api/settings', b), 'บันทึกการตั้งค่าบอทแล้ว');
  } },
    h('div', { class: 'ph' }, h('span', {}, 'ตั้งค่าบอท LINE'), h('span', { class: 'sub' }, ib.ai ? 'AI พร้อมใช้งาน' : 'ยังไม่ได้เปิด AI (ดู README)')),
    h('div', { class: 'two' },
      sw('bot_on', 'เปิดบอทตอบอัตโนมัติ', 'ปิดเมื่ออยากตอบแชทเองทั้งหมด'),
      sw('bot_ai', 'ใช้ AI ตอบคำถามที่พิมพ์มา', 'ฟรีตามโควตารายวันของ Cloudflare'),
      sw('takeaway_on', 'รับสั่งกลับบ้านผ่าน LINE'),
      sw('reserve_on', 'รับจองโต๊ะผ่าน LINE')),
    h('div', { class: 'two' },
      field('เวลาเปิด-ปิด', { name: 'open_hours', value: st.open_hours, maxlength: 120, placeholder: 'เช่น ทุกวัน 11:00–22:00 (หยุดวันจันทร์)' }),
      field('เบอร์โทรร้าน', { name: 'phone', value: st.phone, maxlength: 30 })),
    field('ที่อยู่ / วิธีเดินทาง', { name: 'address', value: st.address, maxlength: 200 }),
    h('div', { class: 'field' }, h('label', { for: 'f_shop_info' }, 'ข้อมูลอื่นที่ให้บอทใช้ตอบ (ที่จอดรถ โปรโมชั่น ฯลฯ)'),
      h('textarea', { class: 'inp area', id: 'f_shop_info', name: 'shop_info', maxlength: 1500, rows: 4, placeholder: 'เช่น มีที่จอดรถ 10 คัน · วันเกิดลด 10% · เด็กสูงไม่เกิน 100 ซม. ทานฟรี' }, st.shop_info)),
    h('div', { class: 'sub' }, 'ลิงก์สำหรับใส่ใน Rich menu หรือโพสต์: ', h('code', {}, `${origin}/order.html`), ' · ', h('code', {}, `${origin}/reserve.html`),
      ' (ลิงก์จากปุ่มในแชทจะผูกกับบัญชี LINE ของลูกค้า ร้านจึงส่งแจ้งผลกลับทาง LINE ได้)'),
    h('button', { class: 'btn', type: 'submit', style: 'max-width:240px' }, 'บันทึก'));

  return [h('div', { class: 'stack' }, setup, board, form)];
}

// ส่วนสั่งกลับบ้านบนผังโต๊ะ (ไม่มีโต๊ะ) ให้กดเข้าไปคิดเงินได้
function takeawayStrip() {
  const list = (S.live?.sessions || []).filter((s) => !s.table_id);
  if (!list.length) return null;
  return h('div', { style: 'margin-top:18px;display:flex;flex-direction:column;gap:10px' },
    h('div', { class: 'ph' }, h('span', {}, 'สั่งกลับบ้าน'), h('span', { class: 'sub' }, `${list.length} ออเดอร์`)),
    h('div', { class: 'tgrid' }, list.map((s) => h('button', { class: 'tc ok', style: 'min-height:120px', onclick: () => go('checkout', { sid: s.id, pay: { method: 'cash', discount: '', penalty: '' } }) },
      h('span', { class: 'pkn' }, s.table_name), h('span', { class: 'sub' }, `รับเมื่อ ${new Date(s.opened_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`),
      h('span', { class: 'btn small', style: 'margin-top:auto' }, 'คิดเงิน')))));
}

render();
