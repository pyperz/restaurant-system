// ---------- โหมดพิมพ์อัตโนมัติ (--kiosk-printing) ----------
// ถ้าเบราว์เซอร์ไม่ได้เปิดด้วย --kiosk-printing จะมีหน้าต่างให้กด Print ทุกครั้ง
// ตรวจจับได้จากเวลา: window.print() จะค้างรอจนกว่าคนกดในหน้าต่าง → ถ้าค้างนานแปลว่ามีหน้าต่างเด้ง
const kiosk = {
  warned: () => store.get('kiosk_warn') === '1',
  print() {
    const t0 = Date.now();
    window.print();
    const slow = Date.now() - t0 > 1200;
    if (slow !== this.warned()) { store.set('kiosk_warn', slow ? '1' : null); render(); }
  },
  isEdge: () => /Edg\//.test(navigator.userAgent),
  // ไฟล์ .bat สร้างไอคอน "ระบบร้าน" บนหน้าจอ ที่เปิดเบราว์เซอร์แบบพิมพ์ทันที + เล่นเสียงได้เลยไม่ต้องแตะจอ
  bat(edge) {
    const url = location.origin + '/';
    const exe = edge ? 'msedge.exe' : 'chrome.exe';
    const paths = edge
      ? ['%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe', '%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe']
      : ['%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe', '%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe', '%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe'];
    const name = edge ? 'Microsoft Edge' : 'Google Chrome';
    const policy = edge ? 'HKCU\\Software\\Policies\\Microsoft\\Edge' : 'HKCU\\Software\\Policies\\Google\\Chrome';
    const L = [
      '@echo off', 'setlocal',
      `set "URL=${url}"`, 'set "BROWSER="',
      ...paths.map((p) => `if not defined BROWSER if exist "${p}" set "BROWSER=${p}"`),
      `if not defined BROWSER (echo ERROR: ${name} not found on this computer. & pause & exit /b 1)`,
      'rem Stop the browser from staying open in the background (otherwise --kiosk-printing is ignored)',
      `reg add "${policy}" /v BackgroundModeEnabled /t REG_DWORD /d 0 /f >nul 2>&1`,
      edge ? `reg add "${policy}" /v StartupBoostEnabled /t REG_DWORD /d 0 /f >nul 2>&1` : null,
      'powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[Environment]::GetFolderPath(\'Desktop\'); $s=(New-Object -ComObject WScript.Shell).CreateShortcut($d+\'\\Restaurant POS.lnk\'); $s.TargetPath=$env:BROWSER; $s.Arguments=\'--kiosk-printing --autoplay-policy=no-user-gesture-required \'+$env:URL; $s.IconLocation=$env:BROWSER+\',0\'; $s.Save()"',
      'echo.',
      'echo OK - Created desktop icon "Restaurant POS" (auto print, no print dialog).',
      `echo Press any key to close ${name} and reopen the POS from the new icon.`,
      'echo (Save anything you are typing in the browser first.)',
      'pause >nul',
      `taskkill /IM ${exe} /F >nul 2>&1`,
      'timeout /t 3 /nobreak >nul',
      'for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "[Environment]::GetFolderPath(\'Desktop\')"`) do set "DESK=%%D"',
      'start "" "%DESK%\\Restaurant POS.lnk"',
    ].filter((x) => x != null);
    return L.join('\r\n') + '\r\n';
  },
  download(edge) {
    const blob = new Blob([this.bat(edge)], { type: 'application/octet-stream' });
    const a = h('a', { href: URL.createObjectURL(blob), download: edge ? 'restaurant-pos-edge.bat' : 'restaurant-pos-chrome.bat' });
    document.body.append(a); a.click(); a.remove();
  },
};

function kioskBanner() {
  if (!kiosk.warned()) return null;
  return h('div', { class: 'kbanner', role: 'alert' },
    h('span', {}, 'เครื่องนี้มีหน้าต่างให้กด Print ทุกครั้ง แปลว่ายังไม่ได้เปิดโหมดพิมพ์อัตโนมัติ'),
    h('button', { class: 'btn', onclick: () => { S.setTab = 'shop'; go('settings'); setTimeout(() => document.getElementById('kioskbox')?.scrollIntoView({ behavior: 'smooth' }), 300); } }, 'วิธีแก้ (1 นาที)'),
    h('button', { class: 'linkbtn', onclick: () => { store.set('kiosk_warn', null); render(); } }, 'ซ่อน'));
}

function kioskBox() {
  const edge = kiosk.isEdge();
  return h('div', { class: 'cashbox', id: 'kioskbox' },
    h('b', {}, 'ให้พิมพ์ทันทีโดยไม่มีหน้าต่างถาม'),
    h('div', { class: 'sub' }, `ตอนนี้เปิดระบบด้วย ${edge ? 'Microsoft Edge' : 'Google Chrome'} · กดปุ่มด้านล่าง → เปิดไฟล์ที่ดาวน์โหลด (ถ้ามีกรอบสีน้ำเงิน กด More info → Run anyway) → ระบบจะสร้างไอคอน "Restaurant POS" บนหน้าจอ แล้วเปิดเบราว์เซอร์ใหม่จากไอคอนนั้นให้เลย`),
    h('div', { class: 'row3', style: 'display:flex;flex-wrap:wrap;gap:10px' },
      h('button', { type: 'button', class: 'btn', onclick: () => kiosk.download(edge) }, `สร้างไอคอนพิมพ์อัตโนมัติ (${edge ? 'Edge' : 'Chrome'})`),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => kiosk.download(!edge) }, `ใช้ ${edge ? 'Chrome' : 'Edge'} แทน`),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => printNodes(h('div', { class: 'tk' }, h('div', { class: 'tk-mid', style: 'text-align:center' }, 'ทดสอบพิมพ์'), h('div', { class: 'tk-sm', style: 'text-align:center' }, new Date().toLocaleString('th-TH')), h('div', { class: 'tk-cut' }))) }, 'ทดสอบพิมพ์')),
    h('div', { class: 'sub' }, kiosk.warned() ? '✗ ทดสอบล่าสุด: ยังมีหน้าต่างให้กด Print' : 'หลังจากนี้ให้เปิดระบบร้านจากไอคอน "Restaurant POS" เท่านั้น (ไม่ใช่ไอคอนเบราว์เซอร์ปกติ) · ไอคอนนี้เล่นเสียงได้ทันทีไม่ต้องแตะจอก่อนด้วย'));
}
