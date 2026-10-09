'use strict';
// QR สั่งอาหารที่โต๊ะ: แสดง/พิมพ์ QR ของแต่ละโต๊ะ และแจ้งเตือนเมื่อลูกค้าเรียกพนักงาน/ขอเช็คบิล

const tableUrl = (token) => `${location.origin}/t.html?k=${token}`;

function qrSlip(ses) {
  const st = settings();
  const box = h('div', { class: 'qrbox' });
  box.innerHTML = QR.svg(tableUrl(ses.qr_token), { px: 4, label: `QR สั่งอาหาร ${ses.table_name}` });
  return h('div', { class: 'tk' },
    st.shop_name ? h('div', { class: 'tk-mid', style: 'text-align:center' }, st.shop_name) : null,
    h('div', { class: 'tk-big' }, ses.table_name),
    h('div', { class: 'tk-sm', style: 'text-align:center' }, [ses.package_name, `${ses.adults + ses.children} คน`, `เปิด ${fmtTime(ses.opened_at)}`].filter(Boolean).join(' · ')),
    ses.ends_at ? h('div', { class: 'tk-sm', style: 'text-align:center' }, `ทานได้ถึง ${fmtTime(ses.ends_at)} น.`) : null,
    h('hr'),
    h('div', { class: 'tk-mid', style: 'text-align:center' }, 'สแกนเพื่อสั่งอาหาร'),
    box,
    h('div', { class: 'tk-sm', style: 'text-align:center' }, 'สั่งได้ทั้งบุฟเฟต์และเมนูสั่งเพิ่ม · เรียกพนักงาน · เช็คบิล'),
    h('div', { class: 'tk-cut' }));
}
function printQrSlip(ses) { if (ses?.qr_token) printNodes(qrSlip(ses)); }

// หน้าต่างแสดง QR บนจอ (ให้ลูกค้าสแกนจากจอได้เลย หรือพิมพ์วางบนโต๊ะ)
function qrModal(ses, onClose) {
  const box = h('div', { class: 'qrbox', style: 'max-width:320px;margin:0 auto' });
  box.innerHTML = QR.svg(tableUrl(ses.qr_token), { px: 8, label: `QR สั่งอาหาร ${ses.table_name}` });
  const wrap = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': `QR สั่งอาหาร ${ses.table_name}`, onclick: (e) => { if (e.target === wrap) onClose(); } },
    h('div', { class: 'panel', style: 'width:min(460px,100%);position:static;max-height:none' },
      h('div', { class: 'ph' }, h('span', {}, `QR สั่งอาหาร · ${ses.table_name}`)),
      settings().qr_order_on === '0' ? h('div', { class: 'warnbox' }, 'ตอนนี้ปิดการสั่งผ่าน QR อยู่ (เปิดได้ที่ ตั้งค่า → ข้อมูลร้าน)') : null,
      box,
      h('div', { class: 'sub', style: 'text-align:center;word-break:break-all' }, tableUrl(ses.qr_token)),
      h('div', { class: 'sub' }, 'QR นี้ใช้ได้จนกว่าจะปิดบิลโต๊ะนี้ ลูกค้าโต๊ะใหม่จะได้ QR ใหม่เสมอ'),
      h('div', { class: 'row2' },
        h('button', { class: 'btn', onclick: () => printQrSlip(ses) }, 'พิมพ์ QR'),
        h('button', { class: 'btn ghost', onclick: onClose }, 'ปิด')),
      h('button', { class: 'linkbtn', onclick: () => {
        if (!confirm('สร้าง QR ใหม่? QR เดิมที่ลูกค้าถืออยู่จะใช้ไม่ได้ทันที (ใช้เมื่อ QR หลุดไปถึงคนอื่น)')) return;
        doThen(async () => { await api('POST', `/api/sessions/${ses.id}/qr`); await loadDetail(); }, 'สร้าง QR ใหม่แล้ว', async () => render());
      } }, 'สร้าง QR ใหม่ (QR เดิมจะใช้ไม่ได้)')));
  return wrap;
}

// ลูกค้าเรียกพนักงาน / ขอเช็คบิล → เสียงเตือน + ข้อความ
let lastCalls = null;
function alertCalls(sessions) {
  const calling = (sessions || []).filter((s) => s.call_staff_at || s.call_bill_at);
  const key = calling.map((s) => `${s.id}:${s.call_staff_at}:${s.call_bill_at}`).join('|');
  if (lastCalls !== null && key && key !== lastCalls) {
    const newest = calling.slice().sort((a, b) => Math.max(b.call_staff_at, b.call_bill_at) - Math.max(a.call_staff_at, a.call_bill_at))[0];
    toast(`${newest.table_name} ${newest.call_bill_at >= newest.call_staff_at ? 'ขอเช็คบิล' : 'เรียกพนักงาน'}`);
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.2, 0.4].forEach((d) => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 660; g.gain.value = 0.15; o.connect(g); g.connect(ac.destination); o.start(ac.currentTime + d); o.stop(ac.currentTime + d + 0.12); });
    } catch {}
  }
  lastCalls = key;
}
