'use strict';
// ตัวสร้าง QR Code ขนาดเล็ก (โหมด byte, แก้ไขข้อผิดพลาดระดับ M, เวอร์ชัน 1–10)
// เขียนเองเพื่อไม่ต้องพึ่งไฟล์จากภายนอก — ใช้สร้าง QR PromptPay
const QR = (() => {
  // [จำนวน EC ต่อบล็อก, [[จำนวนบล็อก, ข้อมูลต่อบล็อก], ...]] ของระดับ M
  const M = [null,
    [10, [[1, 16]]], [16, [[1, 28]]], [26, [[1, 44]]], [18, [[2, 32]]], [24, [[2, 43]]],
    [16, [[4, 27]]], [18, [[4, 31]]], [22, [[2, 38], [2, 39]]], [22, [[3, 36], [2, 37]]], [26, [[4, 43], [1, 44]]]];
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  // ---- เลขคณิต GF(256) ----
  const EXP = new Array(512), LOG = new Array(256);
  for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
  function rsGen(n) {
    let g = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= mul(g[j], EXP[i]); }
      g = next;
    }
    return g;
  }
  function rsRem(data, n) {
    const g = rsGen(n), r = new Array(n).fill(0);
    for (const d of data) {
      const f = d ^ r.shift(); r.push(0);
      for (let j = 0; j < n; j++) r[j] ^= mul(g[j + 1], f);
    }
    return r;
  }
  function formatBits(mask) { // ระดับ M = 0
    const data = (0 << 3) | mask; let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  }
  function versionBits(ver) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    return (ver << 12) | rem;
  }

  function encode(text) {
    const bytes = [...new TextEncoder().encode(text)];
    let ver = 1, info;
    for (; ver <= 10; ver++) {
      info = M[ver];
      const cap = info[1].reduce((a, [n, k]) => a + n * k, 0);
      const need = 4 + (ver < 10 ? 8 : 16) + bytes.length * 8;
      if (need <= cap * 8) break;
    }
    if (ver > 10) throw new Error('ข้อมูลยาวเกินไปสำหรับ QR');
    const cap = info[1].reduce((a, [n, k]) => a + n * k, 0);

    // ---- บิตข้อมูล ----
    const bits = [];
    const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach((b) => put(b, 8));
    put(0, Math.min(4, cap * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let p = 0; data.length < cap; p ^= 1) data.push(p ? 0x11 : 0xec);

    // ---- แบ่งบล็อก + Reed-Solomon + สลับลำดับ ----
    const blocks = [], ecs = [];
    let off = 0;
    for (const [n, k] of info[1]) for (let i = 0; i < n; i++) { const b = data.slice(off, off + k); off += k; blocks.push(b); ecs.push(rsRem(b, info[0])); }
    const final = [];
    const maxK = Math.max(...blocks.map((b) => b.length));
    for (let i = 0; i < maxK; i++) blocks.forEach((b) => { if (i < b.length) final.push(b[i]); });
    for (let i = 0; i < info[0]; i++) ecs.forEach((e) => final.push(e[i]));

    // ---- วางลวดลายคงที่ ----
    const size = ver * 4 + 17;
    const mod = Array.from({ length: size }, () => new Array(size).fill(null));
    const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (r, c, v) => { mod[r][c] = v; fixed[r][c] = true; };
    const finder = (r, c) => {
      for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) {
        const rr = r + i, cc = c + j;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const on = i >= 0 && i <= 6 && j >= 0 && j <= 6 && (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4));
        set(rr, cc, on);
      }
    };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const al = ALIGN[ver];
    const last = al.length - 1;
    al.forEach((r, i) => al.forEach((c, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return; // ทับ finder

      for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) set(r + y, c + x, Math.max(Math.abs(y), Math.abs(x)) !== 1);
    }));
    set(size - 8, 8, true); // dark module
    // จองที่สำหรับ format/version info
    for (let i = 0; i < 9; i++) { if (!fixed[8][i]) set(8, i, false); if (!fixed[i][8]) set(i, 8, false); }
    for (let i = 0; i < 8; i++) { set(8, size - 1 - i, false); set(size - 1 - i, 8, false); }
    if (ver >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { set(size - 11 + j, i, false); set(i, size - 11 + j, false); }

    // ---- วางข้อมูลแบบซิกแซก ----
    const dataBits = [];
    final.forEach((b) => { for (let i = 7; i >= 0; i--) dataBits.push((b >> i) & 1); });
    let bi = 0, up = true;
    for (let c = size - 1; c > 0; c -= 2) {
      if (c === 6) c--;
      for (let k = 0; k < size; k++) {
        const r = up ? size - 1 - k : k;
        for (const cc of [c, c - 1]) if (!fixed[r][cc]) { mod[r][cc] = bi < dataBits.length ? !!dataBits[bi] : false; bi++; }
      }
      up = !up;
    }

    // ---- เลือก mask ที่ดีที่สุด ----
    const MASKS = [(r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
      (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
      (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0];

    function build(m) {
      const g = mod.map((row, r) => row.map((v, c) => (fixed[r][c] ? v : v !== MASKS[m](r, c))));
      const fmt = formatBits(m), bit = (i) => ((fmt >> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) g[i][8] = bit(i);
      g[7][8] = bit(6); g[8][8] = bit(7); g[8][7] = bit(8);
      for (let i = 9; i < 15; i++) g[8][14 - i] = bit(i);
      for (let i = 0; i < 8; i++) g[8][size - 1 - i] = bit(i);
      for (let i = 8; i < 15; i++) g[size - 15 + i][8] = bit(i);
      g[size - 8][8] = true;
      if (ver >= 7) {
        const v = versionBits(ver);
        for (let i = 0; i < 18; i++) { const b = ((v >> i) & 1) === 1; const a = Math.floor(i / 3), cc = (i % 3) + size - 11; g[a][cc] = b; g[cc][a] = b; }
      }
      return g;
    }
    function penalty(g) {
      let p = 0;
      const line = (get) => {
        for (let i = 0; i < size; i++) {
          let run = 1;
          for (let j = 1; j < size; j++) {
            if (get(i, j) === get(i, j - 1)) run++; else { if (run >= 5) p += run - 2; run = 1; }
          }
          if (run >= 5) p += run - 2;
          for (let j = 0; j + 10 < size + 0 && j <= size - 11; j++) {
            const s = Array.from({ length: 11 }, (_, k) => (get(i, j + k) ? 1 : 0)).join('');
            if (s === '10111010000' || s === '00001011101') p += 40;
          }
        }
      };
      line((i, j) => g[i][j]); line((i, j) => g[j][i]);
      for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
        const v = g[r][c]; if (v === g[r][c + 1] && v === g[r + 1][c] && v === g[r + 1][c + 1]) p += 3;
      }
      const dark = g.flat().filter(Boolean).length;
      p += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
      return p;
    }
    let best = null, bestP = Infinity;
    for (let m = 0; m < 8; m++) { const g = build(m); const p = penalty(g); if (p < bestP) { bestP = p; best = g; } }
    return best;
  }

  // คืนค่าเป็น SVG (มีขอบขาว 4 ช่องตามมาตรฐาน)
  function svg(text, { px = 6, label = 'QR Code' } = {}) {
    const g = encode(text), n = g.length, q = 4, full = (n + q * 2) * px;
    let d = '';
    g.forEach((row, r) => row.forEach((on, c) => { if (on) d += `M${(c + q) * px} ${(r + q) * px}h${px}v${px}h-${px}z`; }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" width="${full}" height="${full}" role="img" aria-label="${label}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }
  return { encode, svg };
})();

// ---------- PromptPay (มาตรฐาน EMVCo ของธนาคารแห่งประเทศไทย) ----------
function crc16(str) {
  let crc = 0xffff;
  for (const b of new TextEncoder().encode(str)) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
const tlv = (id, v) => id + String(v.length).padStart(2, '0') + v;
// id = เบอร์มือถือ 10 หลัก / เลขบัตรประชาชนหรือเลขผู้เสียภาษี 13 หลัก / e-Wallet 15 หลัก
function promptPayPayload(id, amount) {
  const digits = String(id).replace(/\D/g, '');
  let acc;
  if (digits.length === 10) acc = tlv('01', '0066' + digits.slice(1).padStart(9, '0'));
  else if (digits.length === 13) acc = tlv('02', digits);
  else if (digits.length === 15) acc = tlv('03', digits);
  else throw new Error('เลข PromptPay ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลข 13 หลัก');
  const amt = Number(amount) > 0 ? tlv('54', Number(amount).toFixed(2)) : '';
  const body = tlv('00', '01') + tlv('01', amt ? '12' : '11') + tlv('29', tlv('00', 'A000000677010111') + acc) + tlv('53', '764') + amt + tlv('58', 'TH') + '6304';
  return body + crc16(body);
}
