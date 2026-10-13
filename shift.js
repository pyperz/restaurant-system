// ---------- เปิดร้าน (ตั้งเงินทอน) / ปิดร้านสรุปยอด — อยู่บนหน้ารายงาน ----------
S.shift = { data: null, loading: false, mode: null, counted: '', result: null };
async function loadShift() {
  S.shift.loading = true;
  try { S.shift.data = await api('GET', '/api/shift'); } catch (e) { toast(e.message, true); }
  S.shift.loading = false; S.shift.at = Date.now(); render();
}
const fmtDT = (ms) => `${fmtDate(ms)} ${fmtTime(ms)}`;

// ใบสรุปยอดปิดร้าน (พิมพ์เครื่องพิมพ์ใบเสร็จ)
function shiftSlip(sum, openedAt, closedAt) {
  const st = settings(), row = (a, b) => h('div', { class: 'tk-row' }, h('span', {}, a), h('span', {}, b));
  return h('div', { class: 'tk' },
    st.shop_name ? h('div', { class: 'tk-mid', style: 'text-align:center' }, st.shop_name) : null,
    h('div', { class: st.shop_name ? 'tk-sm' : 'tk-mid', style: 'text-align:center' }, 'สรุปยอดปิดร้าน'),
    h('div', { class: 'tk-sm', style: 'text-align:center' }, `${fmtDT(openedAt)} – ${fmtTime(closedAt)}`),
    h('hr'),
    row('จำนวนบิล', String(sum.bills)), row('ลูกค้า', `${sum.guests} คน`),
    sum.discount ? row('ส่วนลดรวม', money(sum.discount)) : null,
    sum.penalty ? row('ค่าปรับรวม', money(sum.penalty)) : null,
    h('div', { class: 'tk-row tk-mid' }, h('span', {}, 'ยอดขายรวม'), h('span', {}, money(sum.total))),
    h('hr'),
    Object.entries(sum.by_method).map(([k, v]) => row(PAY_TH[k] || k, money(v))),
    h('hr'),
    row('เงินทอนตั้งต้น', money(sum.float)), row('+ ขายเงินสด', money(sum.cash)),
    h('div', { class: 'tk-row tk-mid' }, h('span', {}, 'ควรมีในลิ้นชัก'), h('span', {}, money(sum.expected_cash))),
    sum.counted != null ? [row('นับได้จริง', money(sum.counted)),
      h('div', { class: 'tk-row tk-mid' }, h('span', {}, sum.diff < 0 ? 'เงินขาด' : sum.diff > 0 ? 'เงินเกิน' : 'ตรงพอดี'), h('span', {}, sum.diff ? money(Math.abs(sum.diff)) : '✓'))] : null,
    sum.open_tables ? h('div', { class: 'tk-sm' }, `* ตอนปิดร้านยังมีโต๊ะเปิดอยู่ ${sum.open_tables} โต๊ะ (ยังไม่รวมในยอดนี้)`) : null,
    h('div', { class: 'tk-cut' }));
}

function shiftPanel() {
  const sh = S.shift;
  if (!sh.loading && !sh.mode && !sh.result && (!sh.data || Date.now() - (sh.at || 0) > 20000)) loadShift();
  const d = sh.data;
  const wrap = (...kids) => h('div', { class: 'panel grow shiftp' }, h('div', { class: 'ph' }, h('span', {}, 'เปิด–ปิดร้าน')), ...kids);
  // หลังปิดร้าน: โชว์ผลสรุป
  if (sh.result) {
    const r = sh.result, s = r.summary;
    return wrap(
      h('div', { class: 'sub' }, `ปิดร้านแล้ว · ${fmtDT(r.opened_at)} – ${fmtTime(r.closed_at)}`),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('div', { class: 'sub' }, 'ยอดขายรวม'), h('div', { class: 'sv' }, money(s.total)), h('div', { class: 'sub' }, `${s.bills} บิล · ${s.guests} คน`)),
        h('div', { class: 'stat' }, h('div', { class: 'sub' }, 'ควรมีเงินสดในลิ้นชัก'), h('div', { class: 'sv' }, money(s.expected_cash)), h('div', { class: 'sub' }, `เงินทอน ${money(s.float)} + ขายเงินสด ${money(s.cash)}`)),
        s.counted != null ? h('div', { class: 'stat' }, h('div', { class: 'sub' }, s.diff < 0 ? 'เงินขาด' : s.diff > 0 ? 'เงินเกิน' : 'นับได้ตรง'),
          h('div', { class: 'sv', style: `color:${s.diff < 0 ? 'var(--bad,#B42318)' : '#1E6B3A'}` }, s.diff ? money(Math.abs(s.diff)) : '✓'), h('div', { class: 'sub' }, `นับได้ ${money(s.counted)}`)) : null),
      h('div', { class: 'row3', style: 'display:flex;flex-wrap:wrap;gap:10px' },
        h('button', { class: 'btn ghost', onclick: () => printNodes(shiftSlip(s, r.opened_at, r.closed_at)) }, 'พิมพ์ใบสรุปอีกครั้ง'),
        h('button', { class: 'btn', onclick: () => { sh.result = null; sh.mode = 'float'; loadShift(); } }, 'ตั้งเงินทอนวันใหม่')));
  }

  if (!d) return wrap(h('div', { class: 'sub' }, 'กำลังโหลด…'));

  const L = d.live;
  // ตั้งเงินทอน (เปิดร้าน / แก้ไข)
  if (sh.mode === 'float') {
    const inp = h('input', { class: 'inp big', type: 'number', inputmode: 'decimal', min: 0, step: '1', id: 'f_float', value: d.shift ? d.shift.float : '', placeholder: 'เช่น 2000', 'aria-label': 'เงินทอนตั้งต้น (บาท)' });
    const save = () => doThen(async () => { sh.data = await api('POST', '/api/shift/float', { float: inp.value || 0 }); sh.mode = null; }, d.shift ? 'แก้เงินทอนแล้ว' : 'เปิดร้านแล้ว ขายดีนะคะ', async () => render());
    inp.onkeydown = (e) => { if (e.key === 'Enter') save(); };
    setTimeout(() => inp.focus(), 50);
    return wrap(
      h('label', { class: 'lab', for: 'f_float' }, 'ใส่เงินทอนที่อยู่ในลิ้นชักตอนเปิดร้าน (บาท)'), inp,
      h('div', { class: 'chips' }, [500, 1000, 2000, 3000].map((v) => h('button', { type: 'button', class: 'chip', onclick: () => { inp.value = v; } }, money(v)))),
      h('div', { class: 'row3', style: 'display:flex;flex-wrap:wrap;gap:10px' },
        h('button', { class: 'btn', onclick: save }, d.shift ? 'บันทึกเงินทอน' : 'เปิดร้าน'),
        drawer.on() ? h('button', { class: 'btn ghost', onclick: () => drawer.open() }, 'เปิดลิ้นชัก') : null,
        h('button', { class: 'btn ghost', onclick: () => { sh.mode = null; render(); } }, 'ยกเลิก')));
  }

  // ปิดร้าน: นับเงิน → เทียบกับที่ควรมี
  if (sh.mode === 'close') {
    const diffEl = h('div', { class: 'change' });
    const inp = h('input', { class: 'inp big', type: 'number', inputmode: 'decimal', min: 0, step: '1', id: 'f_count', value: sh.counted, placeholder: 'ไม่ใส่ก็ได้', 'aria-label': 'เงินสดที่นับได้ในลิ้นชัก (บาท)',
      oninput: (e) => { sh.counted = e.target.value; upd(); } });
    function upd() {
      if (sh.counted === '') { diffEl.replaceChildren(h('span', {}, 'นับเงินในลิ้นชักแล้วใส่ตัวเลข ระบบจะบอกว่าขาดหรือเกิน')); diffEl.className = 'change'; return; }
      const diff = Math.round((Number(sh.counted) - L.expected_cash) * 100) / 100;
      diffEl.className = 'change' + (diff < 0 ? ' short' : '');
      diffEl.replaceChildren(h('span', {}, diff < 0 ? 'เงินขาด' : diff > 0 ? 'เงินเกิน' : 'ตรงพอดี'), h('b', {}, diff ? money(Math.abs(diff)) : '✓'));
    }
    upd();
    const close = () => {
      if (!confirm('ปิดร้านและสรุปยอดตอนนี้?' + (L.open_tables ? `\n\nยังมีโต๊ะเปิดอยู่ ${L.open_tables} โต๊ะ (จะไม่รวมในยอดรอบนี้)` : ''))) return;
      doThen(async () => {
        const r = await api('POST', '/api/shift/close', { counted: sh.counted === '' ? null : sh.counted });
        sh.result = r; sh.mode = null; sh.counted = ''; sh.data = null;
        printNodes(shiftSlip(r.summary, r.opened_at, r.closed_at));
      }, 'ปิดร้านแล้ว', async () => render());
    };
    return wrap(
      h('div', { class: 'sub' }, `ตั้งแต่ ${fmtDT(L.from)} · ${L.bills} บิล · ขายรวม ${money(L.total)}`),
      h('div', { class: 'cashbox' },
        h('div', { class: 'cr' }, h('span', {}, 'เงินทอนตั้งต้น'), h('span', {}, money(L.float))),
        h('div', { class: 'cr' }, h('span', {}, '+ ขายเงินสด'), h('span', {}, money(L.cash))),
        h('div', { class: 'cr', style: 'font-weight:700' }, h('span', {}, 'ควรมีเงินสดในลิ้นชัก'), h('span', {}, money(L.expected_cash))),
        h('label', { class: 'lab', for: 'f_count' }, 'นับเงินสดในลิ้นชักได้ (บาท)'), inp, diffEl),
      L.open_tables ? h('div', { class: 'warnbox' }, `ยังมีโต๊ะเปิดอยู่ ${L.open_tables} โต๊ะ ควรคิดเงินให้ครบก่อนปิดร้าน`) : null,
      h('div', { class: 'row3', style: 'display:flex;flex-wrap:wrap;gap:10px' },
        h('button', { class: 'btn', onclick: close }, 'ยืนยันปิดร้าน + พิมพ์ใบสรุป'),
        drawer.on() ? h('button', { class: 'btn ghost', onclick: () => drawer.open() }, 'เปิดลิ้นชัก') : null,
        h('button', { class: 'btn ghost', onclick: () => { sh.mode = null; render(); } }, 'ยกเลิก')));
  }

  // ปกติ: สถานะร้าน + 2 ปุ่ม
  return wrap(
    d.shift ? h('div', { class: 'sub' }, `เปิดร้านเมื่อ ${fmtDT(d.shift.opened_at)} · เงินทอนตั้งต้น ${money(d.shift.float)}`)
      : h('div', { class: 'sub' }, 'ยังไม่ได้ตั้งเงินทอนวันนี้'),
    h('div', { class: 'sub' }, `ขายแล้ว ${L.bills} บิล · ${money(L.total)} · เงินสดควรมีในลิ้นชัก ${money(L.expected_cash)}`),
    h('div', { class: 'row3', style: 'display:flex;flex-wrap:wrap;gap:10px' },
      h('button', { class: 'btn ' + (d.shift ? 'ghost' : 'blue'), onclick: () => { sh.mode = 'float'; render(); } }, d.shift ? `แก้เงินทอน (${money(d.shift.float)})` : 'ตั้งเงินทอน (เปิดร้าน)'),
      h('button', { class: 'btn', onclick: () => { sh.mode = 'close'; sh.counted = ''; loadShift().then(() => { sh.mode = 'close'; render(); }); } }, 'ปิดร้านสรุปยอด')),
    d.history.length ? h('details', { class: 'tips' }, h('summary', {}, 'ประวัติปิดร้าน'),
      h('table', { class: 'tbl' }, h('tbody', {}, d.history.map((x) => h('tr', {},
        h('td', {}, `${fmtDate(x.closed_at)} ${fmtTime(x.closed_at)}`), h('td', { class: 'num' }, money(x.summary.total)),
        h('td', { class: 'num' }, x.summary.diff == null ? '-' : x.summary.diff === 0 ? 'ตรง' : `${x.summary.diff < 0 ? 'ขาด' : 'เกิน'} ${money(Math.abs(x.summary.diff))}`),
        h('td', {}, h('button', { class: 'linkbtn', onclick: () => printNodes(shiftSlip(x.summary, x.opened_at, x.closed_at)) }, 'พิมพ์'))))))) : null);
}
