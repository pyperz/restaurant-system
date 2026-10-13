// ---------- ถ่ายรูปเมนูไล่ทีละจาน (ใช้มือถือถ่ายได้เลย) ----------
// เปิดระบบบนมือถือ → เมนู → "ถ่ายรูปไล่ทีละจาน" → กดถ่าย → ระบบย่อรูป อัปโหลด แล้วข้ามไปจานถัดไปที่ยังไม่มีรูปให้เอง
S.shoot = { cat: '', idx: 0, skipped: new Set(), busy: false, last: null };
function shootView() {
  const st = S.shoot, menu = S.data.menu;
  const cats = [...new Set(menu.map((m) => m.category || 'อื่นๆ'))];
  const inCat = menu.filter((m) => !st.cat || (m.category || 'อื่นๆ') === st.cat);
  const todo = inCat.filter((m) => !m.image && !st.skipped.has(m.id));
  const have = menu.filter((m) => m.image).length;
  const cur = todo[0] || null;
  const back = h('button', { class: 'back', 'aria-label': 'กลับหน้าเมนู', onclick: () => { S.view = 'menu'; render(); } }, '‹');

  const picker = h('input', { type: 'file', accept: 'image/*', capture: 'environment', id: 'f_shot', class: 'sr', onchange: async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f || !cur) return;
    st.busy = true; render();
    try {
      const blob = await shrinkImage(f, 1000);
      await api('PUT', `/api/menu/${cur.id}/image`, blob);
      st.last = { name: cur.name, url: URL.createObjectURL(blob), id: cur.id };
      S.data = await api('GET', '/api/state');
      toast(`ใส่รูป ${cur.name} แล้ว`);
    } catch (err) { toast(err.message, true); }
    st.busy = false; render();
  } });

  const progress = h('div', { class: 'sub' }, `มีรูปแล้ว ${have} จาก ${menu.length} เมนู`,
    h('div', { class: 'prog', style: 'margin-top:6px' }, h('i', { style: `width:${menu.length ? Math.round(have * 100 / menu.length) : 0}%` })));
  const catSel = h('select', { class: 'inp', 'aria-label': 'เลือกหมวด', onchange: (e) => { st.cat = e.target.value; render(); } },
    h('option', { value: '' }, 'ทุกหมวด'), cats.map((c) => h('option', { value: c, selected: st.cat === c }, `${c} (${menu.filter((m) => (m.category || 'อื่นๆ') === c && !m.image).length} ยังไม่มีรูป)`)));

  const card = cur ? h('div', { class: 'shootcard' },
    h('div', { class: 'sub' }, 'จานต่อไป'),
    h('div', { class: 'shootname' }, cur.name),
    h('div', { class: 'sub' }, [cur.category, cur.price != null ? money(cur.price) : 'ในบุฟเฟต์'].filter(Boolean).join(' · ')),
    h('label', { for: 'f_shot', class: 'btn shootbtn' + (st.busy ? ' dis' : ''), 'aria-disabled': st.busy ? 'true' : null }, st.busy ? 'กำลังอัปโหลด…' : 'ถ่ายรูป / เลือกรูป'), picker,
    h('div', { class: 'row2' },
      h('button', { type: 'button', class: 'btn ghost', disabled: st.busy, onclick: () => { st.skipped.add(cur.id); render(); } }, 'ข้ามจานนี้'),
      h('button', { type: 'button', class: 'btn ghost', disabled: st.busy, onclick: () => { if (confirm(`ตั้ง "${cur.name}" เป็นหมด? (ไม่ต้องถ่าย)`)) act(() => api('PUT', `/api/menu/${cur.id}`, { ...cur, available: false }), 'ตั้งเป็นหมดแล้ว'); } }, 'ไม่มีขายแล้ว')),
    todo.length > 1 ? h('div', { class: 'sub' }, `เหลืออีก ${todo.length - 1} จานในหมวดนี้ · ถัดไป: ${todo.slice(1, 4).map((m) => m.name).join(', ')}${todo.length > 4 ? ' …' : ''}`) : null)
    : h('div', { class: 'shootcard' }, h('div', { class: 'shootname' }, st.skipped.size ? 'ถ่ายครบแล้ว (ยกเว้นที่ข้ามไว้)' : 'ถ่ายครบทุกจานในหมวดนี้แล้ว 🎉'),
      st.skipped.size ? h('button', { class: 'btn ghost', onclick: () => { st.skipped.clear(); render(); } }, `กลับไปถ่ายจานที่ข้ามไว้ (${st.skipped.size})`) : null);

  const last = st.last ? h('div', { class: 'shootlast' }, h('img', { src: st.last.url, alt: '' }),
    h('div', {}, h('div', {}, `รูปล่าสุด: ${st.last.name}`),
      h('button', { class: 'linkbtn', onclick: () => { const m = menu.find((x) => x.id === st.last.id); if (m) { st.skipped.delete(m.id); doThen(() => api('DELETE', `/api/menu/${m.id}/image`), 'ลบรูปแล้ว ถ่ายใหม่ได้เลย', async () => { S.data = await api('GET', '/api/state'); st.last = null; render(); }); } } }, 'ไม่สวย ถ่ายใหม่'))) : null;

  const tips = h('details', { class: 'tips' }, h('summary', {}, 'เคล็ดลับถ่ายรูปอาหารให้น่ากิน'),
    h('ul', {},
      h('li', {}, 'ถ่ายใกล้หน้าต่างตอนกลางวัน แสงธรรมชาติสวยที่สุด ปิดแฟลช'),
      h('li', {}, 'ถือมือถือแนวนอน ให้จานเต็มกรอบ ระบบจะตัดเป็นสี่เหลี่ยมแนวนอนบนหน้าลูกค้า'),
      h('li', {}, 'ใช้จาน/โต๊ะพื้นหลังเดียวกันทุกรูป เมนูจะดูเป็นชุดเดียวกัน'),
      h('li', {}, 'ของในบุฟเฟต์ (เนื้อ หมู ผัก) ถ่ายจัดจานเหมือนตอนเสิร์ฟจริง'),
      h('li', {}, 'ถ่ายเลยตอนทำอาหารเสิร์ฟลูกค้า ไม่ต้องทำแยก ค่อยๆ เก็บครบใน 1–2 สัปดาห์')));

  return [h('div', { class: 'shootwrap' },
    h('div', { class: 'ph' }, h('span', {}, back, 'ถ่ายรูปเมนูไล่ทีละจาน')),
    progress, catSel, card, last, tips)];
}
