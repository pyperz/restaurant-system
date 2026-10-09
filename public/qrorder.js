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

// ---------- เสียงเตือน (ตั้งค่าแยกแต่ละเครื่อง) ----------
// ออเดอร์ใหม่จากลูกค้า = เสียงกริ๊ง "ติ๊ง-ต่อง" · เรียกพนักงาน/เช็คบิล = เสียงผู้หญิงพูดภาษาไทย
const sound = {
  on: () => store.get('snd_off') !== '1',
  voiceOn: () => store.get('voice_off') !== '1',
  ac: null,
  ctx() {
    try { this.ac = this.ac || new (window.AudioContext || window.webkitAudioContext)(); if (this.ac.state === 'suspended') this.ac.resume(); } catch { this.ac = null; }
    return this.ac;
  },
  tones(list, vol = 0.18) { // list = [[ความถี่, เริ่ม(วินาที), ยาว]]
    const ac = this.ctx(); if (!ac) return;
    list.forEach(([f, d, len]) => {
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + d;
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.start(t); o.stop(t + len + 0.05);
    });
  },
  orderChime() { if (this.on()) this.tones([[1047, 0, 0.5], [784, 0.28, 0.8]]); },          // ติ๊ง-ต่อง (ออเดอร์ใหม่)
  callChime() { if (this.on()) this.tones([[880, 0, 0.18], [1175, 0.15, 0.18], [1568, 0.3, 0.35]], 0.14); }, // ติ๊ด-ติ๊ด-ติ๊ง สั้นๆ ก่อนพูด
  kaching() { // เสียงเครื่องคิดเงิน "กะ-ฉิ่ง!" ตอนรับเงินปิดโต๊ะ (สังเคราะห์เอง ไม่ใช้ไฟล์เสียงลิขสิทธิ์)
    if (!this.on()) return; const ac = this.ctx(); if (!ac) return;
    const t0 = ac.currentTime;
    // "กะ" = เสียงลิ้นชักกระแทก (noise สั้นๆ)
    const len = Math.floor(ac.sampleRate * 0.09), buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const n = ac.createBufferSource(), nf = ac.createBiquadFilter(), ng = ac.createGain();
    n.buffer = buf; nf.type = 'bandpass'; nf.frequency.value = 1800; nf.Q.value = 0.8; ng.gain.value = 0.9;
    n.connect(nf); nf.connect(ng); ng.connect(ac.destination); n.start(t0);
    // "ฉิ่ง!" = กระดิ่งโลหะ (โอเวอร์โทนไม่ลงตัว) ดังค้างแล้วค่อยๆ หาย
    [[2637, 0.16], [3951, 0.1], [5274, 0.07], [6645, 0.05], [3322, 0.06]].forEach(([f, v]) => {
      const o = ac.createOscillator(), g = ac.createGain(), t = t0 + 0.08;
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      o.start(t); o.stop(t + 1.5);
    });
    // เหรียญกรุ๊งกริ๊งเบาๆ
    [0.3, 0.38, 0.47].forEach((d2, i) => this.tones([[4200 + i * 500, d2, 0.12]], 0.05));
  },
  thaiVoice() {
    const vs = (window.speechSynthesis?.getVoices() || []).filter((v) => /^th/i.test(v.lang) || /thai|ไทย/i.test(v.name));
    const female = /premwadee|achara|kanya|narisa|pattara|female|ผู้หญิง/i; // ชื่อเสียงผู้หญิงที่พบบ่อยบน Windows / Edge / Mac / Android
    return vs.find((v) => female.test(v.name) && /online|natural/i.test(v.name)) || vs.find((v) => female.test(v.name)) || vs.find((v) => !/niwat|male/i.test(v.name)) || vs[0] || null;
  },
  say(text) {
    if (!this.on()) return;
    if (!this.voiceOn() || !window.speechSynthesis) { this.callChime(); return; }
    const v = this.thaiVoice();
    if (!v) { this.callChime(); return; }
    this.callChime();
    setTimeout(() => {
      const u = new SpeechSynthesisUtterance(text);
      u.voice = v; u.lang = v.lang || 'th-TH'; u.rate = 0.95; u.pitch = 1.1; u.volume = 1;
      speechSynthesis.speak(u);
    }, 650);
  },
};
if (window.speechSynthesis) { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices(); }
// เบราว์เซอร์ไม่ยอมให้เล่นเสียงจนกว่าจะแตะหน้าจอ 1 ครั้ง → แตะครั้งแรกปลดล็อกให้เลย
addEventListener('pointerdown', () => sound.ctx(), { once: true });

const tableNo = (name) => String(name || '').replace(/^\s*โต๊ะ\s*(ที่)?\s*/, '').trim() || name;
const callText = (s, bill) => `ลูกค้าโต๊ะที่ ${tableNo(s.table_name)} ${bill ? 'ขอเช็คบิลค่ะ' : 'เรียกพนักงานค่ะ'}`;

// ลูกค้าเรียกพนักงาน / ขอเช็คบิล → ข้อความ + เสียงผู้หญิงประกาศ (ประกาศครบทุกโต๊ะที่เรียกใหม่)
let lastCalls = null;
function alertCalls(sessions) {
  const now = {};
  (sessions || []).forEach((s) => { now[s.id] = { s, staff: s.call_staff_at || 0, bill: s.call_bill_at || 0 }; });
  if (lastCalls !== null) {
    const fresh = [];
    for (const id in now) {
      const c = now[id], p = lastCalls[id] || { staff: 0, bill: 0 };
      if (c.staff && c.staff !== p.staff) fresh.push([c.staff, c.s, false]);
      if (c.bill && c.bill !== p.bill) fresh.push([c.bill, c.s, true]);
    }
    fresh.sort((a, b) => a[0] - b[0]).slice(-3).forEach(([, s, bill]) => { toast(callText(s, bill)); sound.say(callText(s, bill)); });
  }
  lastCalls = now;
}

// ออเดอร์ใหม่ที่ลูกค้าสั่งเองผ่าน QR → เสียงติ๊ง-ต่อง (ออเดอร์ที่พนักงานกดเองไม่ต้องดัง)
let lastOrderIds = null;
function alertNewOrders(orders) {
  const qr = (orders || []).filter((o) => o.source === 'qr' && o.status === 'new');
  if (lastOrderIds !== null) {
    const fresh = qr.filter((o) => !lastOrderIds.has(o.id));
    if (fresh.length) { sound.orderChime(); toast(`ออเดอร์ใหม่จากลูกค้า ${[...new Set(fresh.map((o) => o.table_name || 'กลับบ้าน'))].join(', ')}`); }
  }
  lastOrderIds = new Set([...(lastOrderIds || []), ...qr.map((o) => o.id)]);
}

function soundPanel() {
  const sw = (key, label, sub) => h('label', { class: 'switch', style: 'background:var(--ground)' },
    h('input', { type: 'checkbox', checked: store.get(key) !== '1', onchange: (e) => { store.set(key, e.target.checked ? null : '1'); render(); } }),
    h('span', {}, label, h('span', { class: 'sub', style: 'display:block;font-weight:400' }, sub)));
  const v = sound.thaiVoice();
  return h('div', { class: 'panel grow', style: 'flex:none;max-height:none' },
    h('div', { class: 'ph' }, h('span', {}, 'เครื่องนี้: พิมพ์อัตโนมัติ และเสียงเตือน')),
    h('label', { class: 'switch', style: 'background:var(--ground)' },
      h('input', { type: 'checkbox', checked: autoPrint.on(), onchange: () => autoPrint.toggle() }),
      h('span', {}, 'พิมพ์และรับออเดอร์ใหม่อัตโนมัติ', h('span', { class: 'sub', style: 'display:block;font-weight:400' }, 'เปิดเฉพาะเครื่องที่ต่อเครื่องพิมพ์ ออเดอร์ใหม่ (ทั้งลูกค้าสั่งเองและพนักงานสั่ง) จะพิมพ์ใบครัวเองและขึ้น "กำลังทำ" ทันที ไม่ต้องกดรับ · ต้องเปิด Chrome แบบ --kiosk-printing ถึงจะไม่มีหน้าต่างถามก่อนพิมพ์'))),
    sw('snd_off', 'เปิดเสียงเตือนบนเครื่องนี้', 'ออเดอร์ใหม่จากลูกค้า = "ติ๊ง-ต่อง" · เรียกพนักงาน/เช็คบิล = เสียงผู้หญิงประกาศ · รับเงินปิดโต๊ะ = "กะ-ฉิ่ง!"'),
    sw('voice_off', 'ใช้เสียงพูดประกาศ', '"ลูกค้าโต๊ะที่ 5 เรียกพนักงานค่ะ" / "ลูกค้าโต๊ะที่ 5 ขอเช็คบิลค่ะ"'),
    h('div', { class: 'sub' }, v ? `เสียงที่ใช้: ${v.name}` : 'เครื่องนี้ยังไม่มีเสียงพูดภาษาไทย จะใช้เสียงกริ๊งแทน (ดูวิธีเพิ่มด้านล่าง)'),
    h('div', { class: 'row3', style: 'display:flex;flex-wrap:wrap;gap:10px' },
      h('button', { type: 'button', class: 'btn ghost', onclick: () => sound.orderChime() }, 'ทดสอบเสียงออเดอร์ใหม่'),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => sound.say('ลูกค้าโต๊ะที่ 5 เรียกพนักงานค่ะ') }, 'ทดสอบเสียงเรียกพนักงาน'),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => sound.kaching() }, 'ทดสอบเสียงรับเงิน')),
    v ? null : h('div', { class: 'warnbox' }, 'Windows: Settings → Time & language → Language & region → Add a language → ไทย (ติ๊ก Speech / Text-to-speech) แล้วปิดเปิด Chrome ใหม่ · ถ้าใช้ Microsoft Edge จะมีเสียงผู้หญิงแบบธรรมชาติ (Premwadee) ให้เลย'),
    h('div', { class: 'sub' }, 'เปิดหน้าผังโต๊ะหรือออเดอร์ทิ้งไว้ และแตะหน้าจอ 1 ครั้งหลังเปิดเครื่อง เบราว์เซอร์ถึงจะยอมให้มีเสียง'));
}
