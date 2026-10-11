// ---------- ลิ้นชักเก็บเงิน + รับเงินสด/ทอนเงิน + ใบเสร็จ ----------
// ลิ้นชักเสียบสายเข้าเครื่องพิมพ์ใบเสร็จ (ช่อง RJ11) · เบราว์เซอร์สั่งเครื่องพิมพ์ตรงๆ ไม่ได้
// จึงใช้ "ตัวช่วยเปิดลิ้นชัก" เล็กๆ ที่รันบนคอมแคชเชียร์ (public/tools/drawer-helper.ps1) รับคำสั่งที่ 127.0.0.1:17777
const HELPER = 'http://127.0.0.1:17777';
const drawer = {
  on: () => store.get('drawer_on') === '1',
  conn: () => store.get('drawer_conn') || 'usb',          // usb = เครื่องพิมพ์เสียบ USB เข้าคอม · lan = ต่อสายแลน
  printer: () => store.get('drawer_printer') || '',       // ชื่อเครื่องพิมพ์ใน Windows (ว่าง = เครื่องพิมพ์หลัก)
  ip: () => store.get('printer_ip') || '',
  pin: () => store.get('drawer_pin') || '2',
  async call(path) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000);
    try { const r = await fetch(HELPER + path, { signal: ctl.signal, cache: 'no-store', targetAddressSpace: 'loopback' }); return await r.json(); }
    finally { clearTimeout(t); }
  },
  async open({ quiet = false } = {}) {
    const lan = this.conn() === 'lan';
    if (lan && !this.ip()) { toast('ยังไม่ได้ใส่ IP เครื่องพิมพ์ (ตั้งค่า → เครื่องนี้ → ลิ้นชักเก็บเงิน)', true); return false; }
    try {
      const target = lan ? `ip=${encodeURIComponent(this.ip())}` : `printer=${encodeURIComponent(this.printer())}`;
      const j = await this.call(`/drawer?${target}&pin=${this.pin()}`);
      if (j.ok) { if (!quiet) toast('ส่งคำสั่งเปิดลิ้นชักแล้ว'); return true; }
      toast({
        printer_unreachable: 'ต่อเครื่องพิมพ์ไม่ได้ ตรวจ IP เครื่องพิมพ์ และดูว่าเครื่องพิมพ์เปิดอยู่',
        bad_ip: 'IP เครื่องพิมพ์ไม่ถูกต้อง (เช่น 192.168.1.100)',
        printer_not_found: 'ไม่พบเครื่องพิมพ์นี้ใน Windows เลือกชื่อเครื่องพิมพ์ใหม่ในหน้าตั้งค่า',
        print_failed: 'สั่งเครื่องพิมพ์ไม่สำเร็จ ดูว่าเครื่องพิมพ์เปิดอยู่และสาย USB เสียบแน่น',
      }[j.error] || 'เปิดลิ้นชักไม่ได้', true);
    } catch { toast('เปิดลิ้นชักไม่ได้: ยังไม่ได้ติดตั้งตัวช่วยเปิดลิ้นชักบนเครื่องนี้ หรือยังไม่ได้กด "อนุญาต"', true); }
    return false;
  },
  async ping() { try { return (await this.call('/ping')) || null; } catch { return null; } },
  async printers() { try { return await this.call('/printers'); } catch { return null; } },
};
const receiptAuto = () => store.get('receipt_off') !== '1';

// ปุ่มเงินที่ลูกค้ามักยื่นให้ (ปัดขึ้นเป็นแบงก์ 100 / 500 / 1000)
function cashSuggestions(total) {
  const out = new Set();
  [20, 50, 100, 500, 1000].forEach((n) => { const v = Math.ceil(total / n) * n; if (v > total) out.add(v); });
  return [...out].sort((a, b) => a - b).slice(0, 4);
}

// หน้าจอหลังรับเงิน: เงินทอนตัวใหญ่ + พิมพ์ใบเสร็จซ้ำ / เปิดลิ้นชัก
function paidView(paid) {
  return [h('div', { class: 'panel grow paid' },
    h('div', { class: 'sub' }, `ปิด${paid.table}แล้ว · ใบเสร็จเลขที่ ${paid.no}`),
    h('div', { class: 'paidtot' }, `ยอดชำระ ${money(paid.total)}`),
    paid.method === 'cash' ? [
      h('div', { class: 'sub' }, `รับเงินมา ${money(paid.received)}`),
      h('div', { class: 'change' }, h('span', {}, 'เงินทอน'), h('b', {}, money(paid.change)))]
      : h('div', { class: 'change' }, h('span', {}, 'ชำระโดย'), h('b', {}, PAY_TH[paid.method] || paid.method)),
    h('div', { class: 'row3', style: 'display:flex;flex-wrap:wrap;gap:10px;justify-content:center' },
      h('button', { class: 'btn ghost', onclick: () => printNodes(paid.doc()) }, 'พิมพ์ใบเสร็จ' + (paid.printed ? 'อีกครั้ง' : '')),
      drawer.on() ? h('button', { class: 'btn ghost', onclick: () => drawer.open() }, 'เปิดลิ้นชัก') : null),
    h('button', { class: 'btn big', style: 'max-width:360px;margin:0 auto', onclick: () => { S.paid = null; go('floor', { sid: null, detail: null }); } }, 'เสร็จ กลับผังโต๊ะ'))];
}

// ตั้งค่าเฉพาะเครื่อง: ลิ้นชัก + ใบเสร็จ
function drawerPanel() {
  const lan = drawer.conn() === 'lan';
  const status = h('span', { class: 'sub' }, 'กำลังตรวจตัวช่วยเปิดลิ้นชัก…');
  const prnSel = h('select', { class: 'inp', id: 'f_dprn', onchange: (e) => store.set('drawer_printer', e.target.value || null) },
    h('option', { value: '' }, 'เครื่องพิมพ์หลักของคอม'));
  drawer.ping().then(async (p) => {
    const ok = !!p?.ok, old = ok && !(p.v >= 2);
    status.textContent = !ok ? '✗ ยังไม่พบตัวช่วยเปิดลิ้นชักบนเครื่องนี้ (ดูวิธีติดตั้งด้านล่าง)'
      : old ? '! ตัวช่วยเป็นรุ่นเก่า ยังไม่รองรับ USB ให้ดาวน์โหลด 2 ไฟล์ด้านล่างแล้วติดตั้งใหม่ แล้วรีสตาร์ทคอม 1 ครั้ง' : '✓ ตัวช่วยเปิดลิ้นชักทำงานอยู่บนเครื่องนี้';
    status.style.color = ok && !old ? 'var(--ok, #1E6B3A)' : 'var(--bad, #B42318)';
    const list = ok && !lan ? await drawer.printers() : null;
    (list?.printers || []).forEach((n) => prnSel.append(h('option', { value: n, selected: drawer.printer() === n }, n + (n === list.default ? ' (เครื่องหลัก)' : ''))));
    if (drawer.printer() && ![...prnSel.options].some((o) => o.value === drawer.printer())) prnSel.append(h('option', { value: drawer.printer(), selected: true }, drawer.printer()));
  });
  const sw = (key, label, sub, onVal = '1', inverted = false) => h('label', { class: 'switch', style: 'background:var(--ground)' },
    h('input', { type: 'checkbox', checked: inverted ? store.get(key) !== '1' : store.get(key) === onVal, onchange: (e) => { store.set(key, (inverted ? !e.target.checked : e.target.checked) ? '1' : null); render(); } }),
    h('span', {}, label, sub ? h('span', { class: 'sub', style: 'display:block;font-weight:400' }, sub) : null));
  return h('div', { class: 'panel grow', style: 'flex:none;max-height:none' },
    h('div', { class: 'ph' }, h('span', {}, 'เครื่องนี้: รับเงิน ลิ้นชัก และใบเสร็จ')),
    sw('receipt_off', 'พิมพ์ใบเสร็จอัตโนมัติหลังกดรับเงิน', 'ใบเสร็จมียอดชำระ เงินที่รับมา และเงินทอน', '1', true),
    sw('drawer_on', 'เปิดลิ้นชักเก็บเงินอัตโนมัติเมื่อรับเงินสด', 'ลิ้นชักเสียบสายอยู่ที่ด้านหลังเครื่องพิมพ์ใบเสร็จ (ช่อง DK)'),
    h('div', { class: 'field', style: 'max-width:560px' }, h('div', { class: 'lab' }, 'เครื่องพิมพ์ที่ต่อลิ้นชัก ต่อกับคอมแบบไหน'),
      h('div', { class: 'seg' },
        h('button', { type: 'button', class: lan ? '' : 'on', onclick: () => { store.set('drawer_conn', 'usb'); render(); } }, 'สาย USB เข้าคอม'),
        h('button', { type: 'button', class: lan ? 'on' : '', onclick: () => { store.set('drawer_conn', 'lan'); render(); } }, 'สายแลน (LAN)'))),
    h('div', { class: 'row2', style: 'max-width:560px' },
      lan ? h('div', { class: 'field' }, h('label', { for: 'f_pip' }, 'IP เครื่องพิมพ์'),
        h('input', { class: 'inp', id: 'f_pip', inputmode: 'decimal', placeholder: 'เช่น 192.168.1.100', value: drawer.ip(), onchange: (e) => { store.set('printer_ip', e.target.value.trim() || null); toast('บันทึก IP แล้ว'); } }))
        : h('div', { class: 'field' }, h('label', { for: 'f_dprn' }, 'เลือกเครื่องพิมพ์'), prnSel),
      h('div', { class: 'field' }, h('label', { for: 'f_dpin' }, 'ขาลิ้นชัก'),
        h('select', { class: 'inp', id: 'f_dpin', onchange: (e) => store.set('drawer_pin', e.target.value) },
          h('option', { value: '2', selected: drawer.pin() === '2' }, 'ขา 2 (ส่วนใหญ่ใช้แบบนี้)'), h('option', { value: '5', selected: drawer.pin() === '5' }, 'ขา 5 (ถ้าขา 2 ไม่เปิด)')))),
    status,
    h('div', { class: 'row3', style: 'display:flex;flex-wrap:wrap;gap:10px' },
      h('button', { type: 'button', class: 'btn ghost', onclick: () => drawer.open() }, 'ทดสอบเปิดลิ้นชัก'),
      h('a', { class: 'btn ghost', href: '/tools/install-drawer-helper.bat', download: 'install-drawer-helper.bat' }, 'ดาวน์โหลดไฟล์ติดตั้ง 1/2'),
      h('a', { class: 'btn ghost', href: '/tools/drawer-helper.ps1', download: 'drawer-helper.ps1' }, 'ดาวน์โหลดไฟล์ติดตั้ง 2/2')),
    h('details', { class: 'tips' }, h('summary', {}, 'วิธีติดตั้งตัวช่วยเปิดลิ้นชัก (ทำครั้งเดียวบนคอมแคชเชียร์)'),
      h('ol', {},
        h('li', {}, 'เลือกว่าเครื่องพิมพ์ต่อกับคอมด้วยสาย USB หรือสายแลน · ถ้า LAN ต้องใส่ IP (ปิดเครื่องพิมพ์ กด FEED ค้างแล้วเปิดเครื่อง จะพิมพ์ใบที่มี IP ออกมา)'),
        h('li', {}, 'กดดาวน์โหลดไฟล์ติดตั้งทั้ง 2 ไฟล์ (จะอยู่ในโฟลเดอร์ Downloads เดียวกัน)'),
        h('li', {}, 'เปิดโฟลเดอร์ Downloads ดับเบิลคลิก install-drawer-helper.bat · ถ้า Windows ขึ้นกรอบสีน้ำเงิน ให้กด "More info" → "Run anyway" · ขึ้นคำว่า OK แล้วกดปุ่มใดก็ได้เพื่อปิด'),
        h('li', {}, 'กลับมาหน้านี้ กด F5 จะขึ้น ✓ ตัวช่วยทำงานอยู่ · ถ้าเป็น USB ให้เลือกชื่อเครื่องพิมพ์ใบเสร็จ (เช่น XP-58) ในช่อง "เลือกเครื่องพิมพ์" แล้วกด "ทดสอบเปิดลิ้นชัก" · ถ้าเบราว์เซอร์ถามว่าจะให้เว็บนี้เชื่อมต่ออุปกรณ์ในเครือข่ายไหม ให้กด "อนุญาต / Allow"'),
        h('li', {}, 'ติดตั้งครั้งเดียว ตัวช่วยจะเปิดเองทุกครั้งที่เปิดคอม'))));
}
