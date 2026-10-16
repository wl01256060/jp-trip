/* 旅日語：以旅行行程為主軸的日語學習網站
 * 內容放在 data/*.json，學習記錄存在瀏覽器 localStorage，可匯出／匯入。 */
(() => {
  'use strict';

  const $app = document.getElementById('app');
  const KEY = 'jptrip.v1';

  const TYPE = {
    spot: { label: '景點', cls: 't-spot' },
    restaurant: { label: '餐廳', cls: 't-rest' },
    shop: { label: '店家', cls: 't-shop' },
    hotel: { label: '入住飯店', cls: 't-hotel' },
    transport: { label: '交通', cls: 't-move' }
  };
  const CATS = [['all', '全部'], ['menu', '菜單'], ['place', '地名・店名'], ['talk', '對話'], ['transit', '交通'], ['shop', '購物']];
  const CAT_LABEL = Object.fromEntries(CATS);

  /* ---------------- 學習記錄 ---------------- */
  const blank = () => ({ v: 1, current: null, prefs: { kana: true, zh: false }, scen: {}, fam: {}, notes: {}, lastExport: null });
  let rec = blank();
  function loadRec() {
    try {
      const r = JSON.parse(localStorage.getItem(KEY));
      if (r && r.v === 1) rec = Object.assign(blank(), r, { prefs: Object.assign(blank().prefs, r.prefs || {}) });
    } catch (e) { /* 讀不到就用空白記錄 */ }
  }
  function saveRec() {
    try { localStorage.setItem(KEY, JSON.stringify(rec)); }
    catch (e) { toast('無法儲存：這個瀏覽器封鎖了本機儲存'); }
  }
  const now = () => Date.now();
  const scenDone = k => !!(rec.scen[k] && rec.scen[k].v);
  const setScen = (k, v) => { rec.scen[k] = { v: !!v, ts: now() }; saveRec(); };
  const famOf = k => (rec.fam[k] ? rec.fam[k].v : 0);
  const setFam = (k, v) => { rec.fam[k] = { v: Math.max(0, Math.min(3, v)), ts: now() }; saveRec(); };
  const noteOf = k => (rec.notes[k] ? rec.notes[k].v : '');
  const setNote = (k, v) => { rec.notes[k] = { v, ts: now() }; saveRec(); };
  function changesSinceExport() {
    const t = rec.lastExport || 0; let n = 0;
    for (const m of [rec.scen, rec.fam, rec.notes]) for (const k in m) if (m[k] && m[k].ts > t) n++;
    return n;
  }
  const pad = n => String(n).padStart(2, '0');
  function fmtDate(ts) { const d = new Date(ts); return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }

  function exportRec() {
    const data = { app: 'jptrip', v: 1, exportedAt: new Date().toISOString(), current: rec.current, prefs: rec.prefs, scen: rec.scen, fam: rec.fam, notes: rec.notes };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const d = new Date();
    a.href = URL.createObjectURL(blob);
    a.download = `jptrip-records-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    rec.lastExport = now(); saveRec(); render(); toast('已匯出記錄');
  }
  const isEntry = e => e && typeof e === 'object' && typeof e.ts === 'number';
  function importRec(file, mode) {
    const r = new FileReader();
    r.onload = () => {
      let d;
      try { d = JSON.parse(r.result); } catch (e) { toast('檔案格式不對'); return; }
      if (!d || d.app !== 'jptrip') { toast('這不是本網站匯出的記錄檔'); return; }
      for (const name of ['scen', 'fam', 'notes']) {
        const src = d[name] && typeof d[name] === 'object' ? d[name] : {};
        if (mode === 'replace') rec[name] = {};
        for (const k in src) {
          if (!isEntry(src[k])) continue;
          const cur = rec[name][k];
          if (!cur || src[k].ts > cur.ts) rec[name][k] = src[k];
        }
      }
      if (mode === 'replace' && d.current) rec.current = d.current;
      saveRec(); render(); toast(mode === 'replace' ? '已用檔案覆蓋記錄' : '已合併記錄');
    };
    r.readAsText(file);
  }

  /* ---------------- 內容資料 ---------------- */
  let index = null;
  const trips = {};
  let curTrip = null;

  async function getJSON(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(url + ' ' + res.status);
    return res.json();
  }
  async function loadTrip(id) {
    if (trips[id]) return trips[id];
    const meta = index.trips.find(t => t.id === id);
    if (!meta) return null;
    const t = await getJSON(meta.file);
    prepTrip(t);
    trips[id] = t;
    return t;
  }
  function prepTrip(t) {
    t.places = t.places || {};
    t.vocab = t.vocab || {};
    t.vocabList = Object.entries(t.vocab).map(([id, v]) => ({ id, ...v, key: v.ja + '|' + (v.kana || ''), refs: [] }));
    t.vocabById = Object.fromEntries(t.vocabList.map(v => [v.id, v]));
    t.placeAt = {};
    t.days.forEach(d => {
      let no = 0;
      d.steps.forEach(s => {
        if (s.kind === 'stop') s.no = ++no;
        const ids = (s.places || []).concat(s.place ? [s.place] : []);
        ids.forEach(pid => { if (!t.placeAt[pid]) t.placeAt[pid] = { day: d.day, step: s }; });
      });
    });
    for (const [pid, p] of Object.entries(t.places)) {
      p.scenarios = p.scenarios || [];
      (p.vocab || []).forEach(vid => { const v = t.vocabById[vid]; if (v && !v.refs.includes(pid)) v.refs.push(pid); });
    }
  }
  async function currentTrip() {
    const id = (rec.current && index.trips.some(t => t.id === rec.current)) ? rec.current : (index.trips[0] && index.trips[0].id);
    if (!id) return null;
    return loadTrip(id);
  }

  const scenKey = (t, pid, sid) => `${t.id}:${pid}:${sid}`;
  function placeProgress(t, pid) {
    const s = (t.places[pid] && t.places[pid].scenarios) || [];
    return [s.filter(x => scenDone(scenKey(t, pid, x.id))).length, s.length];
  }
  function tripProgress(t) {
    let d = 0, n = 0;
    for (const pid in t.places) { const [a, b] = placeProgress(t, pid); d += a; n += b; }
    return [d, n];
  }

  /* ---------------- 工具 ---------------- */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const RUBY = /\{([^|{}]+)\|([^{}]+)\}/g;
  const ja = s => esc(s).replace(RUBY, (m, b, r) => `<ruby>${b}<rt>${r}</rt></ruby>`);
  const plain = s => String(s || '').replace(RUBY, '$1');

  function speak(text) {
    if (!('speechSynthesis' in window)) { toast('這個瀏覽器不支援朗讀'); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(plain(text));
    u.lang = 'ja-JP';
    const v = speechSynthesis.getVoices().find(x => x.lang && x.lang.toLowerCase().startsWith('ja'));
    if (v) u.voice = v;
    u.rate = 0.95;
    speechSynthesis.speak(u);
  }
  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  /* ---------------- 畫面狀態（不保存） ---------------- */
  const ui = {
    day: null,
    ptab: 'scen', variant: {}, cloze: {}, open: {}, menuItem: null,
    vmode: 'list', q: '', vcat: 'all', vday: 'all', vfam: 'all',
    pmode: 'flash', flash: null, cz: 0, ls: 0, lsShow: false,
    impMode: 'merge'
  };

  function route() { return (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean); }

  /* ---------------- 共用元件 ---------------- */
  function countdown(d) {
    if (!d) return '出發日未定';
    const n = Math.round((new Date(d + 'T00:00:00') - new Date(new Date().toDateString())) / 86400000);
    const ds = d.replace(/-/g, '/');
    if (n > 0) return `${ds} 出發・還有 ${n} 天`;
    if (n === 0) return `${ds} 今天出發！`;
    return `${ds} 出發・旅程第 ${-n + 1} 天`;
  }
  function tripHeader(t, tab) {
    return `<header class="top">
      <div class="row between start"><div><h1>${esc(t.name)}</h1><div class="sub">${esc(countdown(t.startDate))}</div></div><a class="pill" href="#/trips">切換行程 ⇄</a></div>
      <nav class="tabs"><a href="#/" class="${tab === 'home' ? 'on' : ''}">行程</a><a href="#/vocab" class="${tab === 'vocab' ? 'on' : ''}">單字表</a></nav>
    </header>`;
  }
  function progText(t, pid) {
    const [d, n] = placeProgress(t, pid);
    if (!n) return '<span>情境待補</span>';
    return d === n ? `<span class="ok">情境 ${d}/${n} ✓</span>` : `<span>情境 ${d}/${n}</span>`;
  }
  function prefsBar() {
    return `<div class="prefs" role="group" aria-label="顯示設定">
      <button data-act="kana" class="${rec.prefs.kana ? 'on' : ''}" aria-pressed="${rec.prefs.kana}">讀音 ${rec.prefs.kana ? '開' : '關'}</button>
      <button data-act="zhall" class="${rec.prefs.zh ? 'on' : ''}" aria-pressed="${rec.prefs.zh}">中文 ${rec.prefs.zh ? '顯示' : '隱藏'}</button>
    </div>`;
  }
  function dots(key) {
    const f = famOf(key);
    return `<button class="dots" data-act="fam" data-key="${esc(key)}" aria-label="熟悉度 ${f}/3，點一下調整">${[1, 2, 3].map(i => `<i class="${i <= f ? 'f' : ''}"></i>`).join('')}</button>`;
  }

  /* ---------------- 首頁：行程 ---------------- */
  function viewHome(t) {
    const day = t.days.find(d => d.day === ui.day) || t.days[0];
    if (!day) return tripHeader(t, 'home') + '<p class="empty">這個行程還沒有內容。</p>';
    ui.day = day.day;
    const steps = [];
    day.steps.forEach(s => {
      if (s.kind === 'stop') steps.push(stepStop(t, s));
      else if (s.kind === 'move') steps.push(stepMove(t, s));
      else if (s.kind === 'hotel') steps.push(stepHotel(t, s));
    });
    return `${tripHeader(t, 'home')}
    <div class="bar2">
      <div class="chips" role="group" aria-label="選擇天數">${t.days.map(d => `<button class="chip ${d.day === day.day ? 'on' : ''}" data-act="day" data-day="${d.day}">Day ${d.day}</button>`).join('')}</div>
    </div>
    <section class="wrap" style="gap:0">
      <div class="daytitle">Day ${day.day}${day.area ? '・' + esc(day.area) : ''}・依順序</div>
      ${steps.join('') || '<p class="empty">這天還沒有內容。</p>'}
    </section>`;
  }
  const rail = (num, cls = '') => `<div class="rail">${num != null ? `<span class="num ${cls}">${num}</span>` : ''}<span class="vline"></span></div>`;
  function stepStop(t, s) {
    const ty = TYPE[s.type] || TYPE.spot;
    const ids = s.places || [];
    const tag = `${ty.label}${s.label ? '・' + esc(s.label) : ''}`;
    if (ids.length === 1 && !s.label) {
      const pid = ids[0], p = t.places[pid] || {};
      return `<div class="step">${rail(s.no)}<div class="sbody"><a class="card" href="#/p/${encodeURIComponent(pid)}">
        <span class="tag ${ty.cls}">${tag}</span><span class="pname">${esc(p.name || pid)}</span>
        <span class="meta"><span>${esc(p.kana || '')}</span>${progText(t, pid)}</span></a></div></div>`;
    }
    const cands = ids.map(pid => {
      const p = t.places[pid] || {};
      const [d, n] = placeProgress(t, pid);
      return `<a class="cand" href="#/p/${encodeURIComponent(pid)}"><span style="display:flex;flex-direction:column;gap:2px;min-width:0"><span class="pname">${esc(p.name || pid)}</span><span class="vsub">${esc(p.kana || '')}${p.menu ? '・有菜單' : ''}</span></span><span class="vsub ${n && d === n ? 'ok' : ''}">${n ? `${d}/${n}` : '待補'}</span></a>`;
    }).join('');
    return `<div class="step">${rail(s.no)}<div class="sbody"><div class="card group">
      <span class="meta"><span class="tag ${ty.cls}">${tag}</span><span>${ids.length > 1 ? `候選 ${ids.length} 間` : ''}</span></span>${cands}</div></div></div>`;
  }
  function stepMove(t, s) {
    const desc = [s.line, (s.from || s.to) ? `${s.from || ''} → ${s.to || ''}` : '', s.detail].filter(Boolean).map(esc).join('・');
    const inner = `<span><b>${esc(s.mode || '移動')}</b>　${desc}</span>`;
    const body = s.place && t.places[s.place]
      ? `<a class="move" href="#/p/${encodeURIComponent(s.place)}">${inner}<span style="white-space:nowrap">${progText(t, s.place)}</span></a>`
      : `<div class="move">${inner}</div>`;
    return `<div class="step">${rail(null)}<div class="sbody">${body}</div></div>`;
  }
  function stepHotel(t, s) {
    const p = t.places[s.place] || {};
    return `<div class="step"><div class="rail"><span class="num hotel">宿</span></div><div class="sbody"><a class="card hotel" href="#/p/${encodeURIComponent(s.place)}">
      <span class="tag">入住飯店</span><span class="pname">${esc(p.name || s.place)}</span>
      <span class="meta"><span>${esc(p.kana || '')}${s.night ? '・' + esc(s.night) : ''}</span>${progText(t, s.place)}</span></a></div></div>`;
  }

  /* ---------------- 地點詳情 ---------------- */
  function lineHTML(l, staffLabel, masked) {
    const me = l.who === 'me';
    return `<div class="line ${me ? 'me' : 'staff'} ${masked && me ? 'masked' : ''}">
      <div class="who">${me ? '你・要會說' : esc(staffLabel || '對方') + '・聽懂就好'}</div>
      <div class="bubble" lang="ja" ${masked && me ? 'data-act="reveal" role="button" tabindex="0"' : ''}><span class="txt">${ja(l.ja)}</span><span class="ph">想想看怎麼說，點一下看答案</span></div>
      ${l.zh ? `<div class="zh">${esc(l.zh)}</div>` : ''}
      <div class="tools">${l.zh ? '<button data-act="zh">中文</button>' : ''}<button data-act="say" data-say="${esc(plain(l.ja))}">▶ 朗讀</button></div>
      ${l.note ? `<div class="note">語感：${esc(l.note)}</div>` : ''}
    </div>`;
  }
  function scenHTML(t, pid, sc) {
    const key = scenKey(t, pid, sc.id);
    const done = scenDone(key);
    const v = ui.variant[key] === 'ng' && sc.ng ? 'ng' : 'ok';
    const lines = (v === 'ng' ? sc.ng : sc.ok) || [];
    const open = ui.open[key] !== undefined ? ui.open[key] : !done;
    const masked = !!ui.cloze[key];
    return `<details class="scen" data-key="${esc(key)}" ${open ? 'open' : ''}>
      <summary><span>${esc(sc.title)}</span><span class="st ${done ? 'ok' : ''}">${done ? '完成 ✓' : '未完成'}</span></summary>
      <div class="scen-body">
        ${sc.ng ? `<div class="vtoggle" role="group" aria-label="版本"><button data-act="variant" data-key="${esc(key)}" data-v="ok" class="${v === 'ok' ? 'on' : ''}">順利</button><button data-act="variant" data-key="${esc(key)}" data-v="ng" class="${v === 'ng' ? 'on' : ''}">出狀況</button></div>` : ''}
        ${lines.map(l => lineHTML(l, sc.staff, masked)).join('')}
        <div class="acts">
          <button class="btn ${masked ? 'on' : ''}" data-act="cloze" data-key="${esc(key)}">${masked ? '顯示我的台詞' : '遮住我的台詞'}</button>
          <button class="btn ${done ? '' : 'dark'}" data-act="done" data-key="${esc(key)}">${done ? '取消完成' : '標記完成 ✓'}</button>
        </div>
      </div>
    </details>`;
  }
  function vrowHTML(t, v, showSrc = true) {
    const src = showSrc ? v.refs.map(pid => {
      const p = t.places[pid] || {}; const at = t.placeAt[pid];
      return `<a href="#/p/${encodeURIComponent(pid)}">${at ? 'Day ' + at.day + '・' : ''}${esc(plain(p.name || pid))}</a>`;
    }).join('、') : '';
    return `<div class="vrow"><div style="display:flex;flex-direction:column;gap:2px;min-width:0">
      <div class="vja" lang="ja">${esc(v.ja)}</div>
      <div class="vsub"><span lang="ja">${esc(v.kana || '')}</span>・${esc(v.zh || '')}${v.unverified ? '　<span class="unv">讀音未確認</span>' : ''}</div>
      ${v.note ? `<div class="vsub">${esc(v.note)}</div>` : ''}
      <div class="vsrc">${esc(CAT_LABEL[v.cat] || '')}${src ? '・' + src : ''}</div>
    </div>${dots(v.key)}</div>`;
  }
  function viewPlace(t, pid) {
    const p = t.places[pid];
    if (!p) return `<p class="empty">找不到這個地點。<a href="#/">回行程</a></p>`;
    const at = t.placeAt[pid];
    const ty = TYPE[p.type] || TYPE.spot;
    let where = at ? `Day ${at.day}` : '';
    if (at && at.step.kind === 'stop') {
      where += `・第 ${at.step.no} 站・${ty.label}`;
      if (at.step.label) where += `（${esc(at.step.label)}${at.step.places.length > 1 ? '候選' : ''}）`;
    } else if (at) where += `・${ty.label}`;
    const tabs = [['scen', '情境']].concat(p.menu ? [['menu', '菜單']] : [], [['vocab', '單字'], ['notes', '筆記']]);
    if (!tabs.some(x => x[0] === ui.ptab)) ui.ptab = 'scen';
    let body = '';
    if (ui.ptab === 'scen') {
      body = p.scenarios.length ? p.scenarios.map(sc => scenHTML(t, pid, sc)).join('') : '<p class="empty">這裡還沒有情境。把想練的情境告訴 Claude 就能補上。</p>';
    } else if (ui.ptab === 'menu') {
      body = menuHTML(t, p);
    } else if (ui.ptab === 'vocab') {
      const vs = (p.vocab || []).map(id => t.vocabById[id]).filter(Boolean);
      body = vs.length ? `<div class="vlist" style="border-radius:12px;overflow:hidden;border:1px solid var(--line)">${vs.map(v => vrowHTML(t, v, false)).join('')}</div>` : '<p class="empty">這裡還沒有單字。</p>';
    } else {
      const nk = `${t.id}:${pid}`;
      body = `<label class="search">我的筆記（自動儲存）<textarea class="notes" data-note="${esc(nk)}" placeholder="例：店門口要先買餐券、店員講話很快…">${esc(noteOf(nk))}</textarea></label>`;
    }
    return `<header class="top" style="gap:10px">
      <a class="back" href="#/">‹ ${at ? 'Day ' + at.day : '行程'}</a>
      <div style="display:flex;flex-direction:column;gap:2px">
        <div class="sub">${where}</div>
        <div class="ptitle" lang="ja">${esc(p.name)}</div>
        <div class="sub"><span lang="ja">${esc(p.kana || '')}</span>${p.zh ? '・' + esc(p.zh) : ''}</div>
      </div>
      <nav class="tabs">${tabs.map(([k, l]) => `<button data-act="ptab" data-tab="${k}" class="${ui.ptab === k ? 'on' : ''}">${l}</button>`).join('')}</nav>
    </header>
    <section class="wrap">${body}</section>${prefsBar()}`;
  }
  function menuHTML(t, p) {
    const m = p.menu;
    const all = m.sections.flatMap(s => s.items);
    const sel = all.find(i => i.id === ui.menuItem);
    let pop = '';
    if (sel) {
      const v = sel.v ? t.vocabById[sel.v] : null;
      const kana = sel.kana || (v && v.kana) || '';
      const zh = sel.zh || (v && v.zh) || '';
      const note = sel.note || (v && v.note) || '';
      pop = `<div class="pop" role="dialog" aria-label="${esc(sel.ja)}">
        <button class="x" data-act="menu" data-id="" aria-label="關閉">×</button>
        <div class="big" lang="ja">${esc(sel.ja)}</div>
        <div class="vsub" lang="ja">${esc(kana)}</div>
        <div>${esc(zh)}</div>
        ${note ? `<div class="vsub">${esc(note)}</div>` : ''}
        <div class="row" style="margin-top:6px;flex-wrap:wrap">
          <button class="btn" data-act="say" data-say="${esc(sel.ja)}">▶ 朗讀</button>
          <button class="btn" data-act="say" data-say="${esc(sel.ja + 'をひとつお願いします。')}">▶ 點這道：「${esc(sel.ja)}をひとつお願いします」</button>
          ${v ? dots(v.key) : ''}
        </div>
      </div>`;
    }
    return `<p class="small" style="margin:0">先自己讀，看不懂再點品項。</p>
    <div class="paper" lang="ja"><h2>${esc(m.title || 'お品書き')}</h2>
      ${m.sections.map(s => `<div class="msec"><h3>${esc(s.title)}</h3>${s.items.map(i => `<button class="mitem ${i.id === ui.menuItem ? 'on' : ''}" data-act="menu" data-id="${esc(i.id)}"><span>${esc(i.ja)}</span><span>${esc(i.price || '')}</span></button>`).join('')}</div>`).join('')}
    </div>${pop}`;
  }

  /* ---------------- 單字表 ---------------- */
  function filteredVocab(t) {
    const q = ui.q.trim().toLowerCase();
    return t.vocabList.filter(v => {
      if (ui.vcat !== 'all' && v.cat !== ui.vcat) return false;
      if (ui.vday !== 'all' && !v.refs.some(pid => t.placeAt[pid] && String(t.placeAt[pid].day) === ui.vday)) return false;
      const f = famOf(v.key);
      if (ui.vfam === 'new' && f >= 3) return false;
      if (ui.vfam === 'done' && f < 3) return false;
      if (q && !`${v.ja} ${v.kana} ${v.zh} ${v.note || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }
  function vlistHTML(t) {
    const vs = filteredVocab(t);
    return `<div class="count">${vs.length} 個單字・點右邊圓點調整熟悉度</div>
      <div class="vlist">${vs.map(v => vrowHTML(t, v)).join('') || '<p class="empty">沒有符合的單字。</p>'}</div>`;
  }
  function filtersHTML(t) {
    return `<div class="chips" role="group" aria-label="分類">${CATS.map(([k, l]) => `<button class="chip sm ${ui.vcat === k ? 'on' : ''}" data-act="vcat" data-cat="${k}">${l}</button>`).join('')}</div>
      <div class="selects">
        <label>Day <select data-filter="vday"><option value="all">全部</option>${t.days.map(d => `<option value="${d.day}" ${ui.vday === String(d.day) ? 'selected' : ''}>Day ${d.day}</option>`).join('')}</select></label>
        <label>熟悉度 <select data-filter="vfam"><option value="all">全部</option><option value="new" ${ui.vfam === 'new' ? 'selected' : ''}>還不熟</option><option value="done" ${ui.vfam === 'done' ? 'selected' : ''}>熟悉</option></select></label>
      </div>`;
  }
  function viewVocab(t) {
    const top = `${tripHeader(t, 'vocab')}<div class="bar2">
      <div class="seg" role="group" aria-label="模式"><button data-act="vmode" data-m="list" class="${ui.vmode === 'list' ? 'on' : ''}">列表</button><button data-act="vmode" data-m="practice" class="${ui.vmode === 'practice' ? 'on' : ''}">練習</button></div>`;
    if (ui.vmode === 'list') {
      return `${top}
        <label class="search">搜尋日文、讀音或中文<input type="search" id="q" value="${esc(ui.q)}" placeholder="例：そば、餘額" autocomplete="off"></label>
        ${filtersHTML(t)}</div>
        <div id="vlist">${vlistHTML(t)}</div>`;
    }
    return `${top}
      <div class="chips" role="group" aria-label="練習方式">${[['flash', '閃卡'], ['cloze', '對話填空'], ['listen', '聽力']].map(([k, l]) => `<button class="chip sm ${ui.pmode === k ? 'on' : ''}" data-act="pmode" data-m="${k}">${l}</button>`).join('')}</div>
      ${ui.pmode === 'flash' ? filtersHTML(t) : ''}</div>
      <section class="wrap">${ui.pmode === 'flash' ? flashHTML(t) : ui.pmode === 'cloze' ? clozeHTML(t) : listenHTML(t)}</section>${ui.pmode === 'flash' ? '' : prefsBar()}`;
  }

  function flashSig() { return [curTrip && curTrip.id, ui.vcat, ui.vday, ui.vfam, ui.q].join('|'); }
  function buildFlash(t) {
    const vs = shuffle(filteredVocab(t).slice()).sort((a, b) => famOf(a.key) - famOf(b.key));
    ui.flash = { sig: flashSig(), ids: vs.map(v => v.id), i: 0, flip: false, known: 0 };
  }
  function flashHTML(t) {
    if (!ui.flash || ui.flash.sig !== flashSig()) buildFlash(t);
    const F = ui.flash;
    if (!F.ids.length) return '<p class="empty">這個範圍沒有單字，換個篩選試試。</p>';
    if (F.i >= F.ids.length) {
      return `<div class="flash" style="cursor:default"><div class="m">這一輪完成！</div><div class="k">${F.known} / ${F.ids.length} 個標記為「會了」</div></div>
        <button class="btn dark" data-act="restart">再練一輪</button>`;
    }
    const v = t.vocabById[F.ids[F.i]];
    return `<div class="row between small"><span>依熟悉度由低到高出題</span><span>${F.i + 1} / ${F.ids.length}</span></div>
      <div class="track"><div class="fill" style="width:${Math.round(F.i / F.ids.length * 100)}%"></div></div>
      <button class="flash" data-act="flip" aria-label="翻面">
        <span class="small">${esc(CAT_LABEL[v.cat] || '')}</span>
        <span class="w" lang="ja">${esc(v.ja)}</span>
        ${F.flip ? `<span class="k" lang="ja">${esc(v.kana || '')}</span><span class="m">${esc(v.zh || '')}</span>${v.note ? `<span class="small">${esc(v.note)}</span>` : ''}` : '<span class="hint">點卡片翻面看讀音和意思</span>'}
      </button>
      <div class="row" style="justify-content:center"><button class="btn" data-act="say" data-say="${esc(v.ja)}">▶ 朗讀</button></div>
      <div class="grades"><button class="btn" data-act="grade" data-g="0">不會</button><button class="btn" data-act="grade" data-g="1">有點印象</button><button class="btn dark" data-act="grade" data-g="2">會了</button></div>
      <p class="center">結果會更新列表的熟悉度（會了三次＝熟悉）</p>`;
  }
  function allScenarios(t) {
    const out = [];
    t.days.forEach(d => d.steps.forEach(s => {
      const ids = (s.places || []).concat(s.place ? [s.place] : []);
      ids.forEach(pid => {
        const p = t.places[pid];
        if (!p) return;
        p.scenarios.forEach(sc => {
          if (out.some(o => o.pid === pid && o.sc.id === sc.id)) return;
          out.push({ pid, p, sc, day: d.day });
        });
      });
    }));
    return out;
  }
  function clozeHTML(t) {
    const list = allScenarios(t);
    if (!list.length) return '<p class="empty">還沒有情境。</p>';
    ui.cz = ((ui.cz % list.length) + list.length) % list.length;
    const { pid, p, sc, day } = list[ui.cz];
    const lines = (sc.ok || []).concat(sc.ng ? [{ sep: true }] : [], sc.ng || []);
    return `<div class="row between small"><span>Day ${day}・<a href="#/p/${encodeURIComponent(pid)}">${esc(plain(p.name))}</a></span><span>${ui.cz + 1} / ${list.length}</span></div>
      <div class="sec-title" style="margin-top:0">${esc(sc.title)}</div>
      <p class="small" style="margin:0">你的台詞被遮住了，先自己說說看，再點開對答案。</p>
      ${lines.map(l => l.sep ? '<div class="small" style="border-top:1px dashed var(--line2);padding-top:8px">出狀況版</div>' : lineHTML(l, sc.staff, true)).join('')}
      <div class="grades"><button class="btn" data-act="cz" data-d="-1">‹ 上一個</button><button class="btn" data-act="cz" data-d="rand">隨機</button><button class="btn dark" data-act="cz" data-d="1">下一個 ›</button></div>`;
  }
  function listenHTML(t) {
    const list = [];
    allScenarios(t).forEach(({ pid, p, sc, day }) => (sc.ok || []).concat(sc.ng || []).forEach(l => { if (l.who !== 'me') list.push({ l, pid, p, sc, day }); }));
    if (!list.length) return '<p class="empty">還沒有對方的台詞可以練聽力。</p>';
    ui.ls = ((ui.ls % list.length) + list.length) % list.length;
    const it = list[ui.ls];
    return `<div class="row between small"><span>只聽不看：對方會說的話</span><span>${ui.ls + 1} / ${list.length}</span></div>
      <button class="flash" data-act="say" data-say="${esc(plain(it.l.ja))}"><span class="w" style="font-size:44px">▶</span><span class="hint">點這裡播放（可重複）</span></button>
      ${ui.lsShow ? `<div class="card"><span class="small">Day ${it.day}・${esc(plain(it.p.name))}・${esc(it.sc.title)}</span><span lang="ja" style="font-size:17px;line-height:1.9">${ja(it.l.ja)}</span><span class="small">${esc(it.l.zh || '')}</span></div>`
        : '<button class="btn" data-act="lsshow">聽完了，看原文</button>'}
      <div class="grades"><button class="btn" data-act="ls" data-d="-1">‹ 上一句</button><button class="btn" data-act="ls" data-d="rand">隨機</button><button class="btn dark" data-act="ls" data-d="1">下一句 ›</button></div>
      <p class="center">朗讀用的是裝置內建的日文語音，聲音依手機而定。</p>`;
  }

  /* ---------------- 切換行程 ---------------- */
  async function viewTrips() {
    const cur = curTrip && curTrip.id;
    const cards = [];
    for (const m of index.trips) {
      let prog = '';
      try { const t = await loadTrip(m.id); const [d, n] = tripProgress(t); prog = `<div class="track"><div class="fill" style="width:${n ? Math.round(d / n * 100) : 0}%"></div></div><span class="small">情境 ${d} / ${n}</span>`; } catch (e) { prog = '<span class="small warn">資料讀取失敗</span>'; }
      cards.push(`<button class="trip ${m.id === cur ? 'cur' : ''}" data-act="setcur" data-id="${esc(m.id)}">
        <span class="row between"><span class="tn">${esc(m.name)}</span>${m.id === cur ? '<span class="badge">目前學習中</span>' : ''}</span>
        <span class="small">${esc(m.region || '')}${m.days ? `・${m.days} 天` : ''}・${m.startDate ? esc(m.startDate.replace(/-/g, '/')) + ' 出發' : '日期未定'}</span>${prog}</button>`);
    }
    const n = changesSinceExport();
    return `<header class="top" style="gap:8px;padding-bottom:16px">
      ${cur ? '<a class="back" href="#/">‹ 返回</a>' : ''}
      <h1>我的行程</h1><div class="sub">選一個當作首頁</div>
    </header>
    <section class="wrap">
      ${cards.join('') || '<p class="empty">還沒有行程。</p>'}
      <div class="dashed">＋ 新增行程：把每天的順序（景點、餐廳、店家、交通）和飯店傳給 Claude，會產生新的資料檔。</div>
      <div class="sec-title">我的書</div>
      <div class="dashed">${index.books && index.books.length ? index.books.map(b => esc(b.name)).join('、') : '尚未建立：把書頁拍給 Claude，整理單字後會出現在這裡。'}</div>
      <div class="box">
        <h2>學習記錄</h2>
        <div class="small">記錄存在這台裝置的瀏覽器。換裝置前先匯出，在另一台匯入；清除瀏覽資料前也記得先匯出。</div>
        <div class="small ${n ? 'warn' : ''}">${rec.lastExport ? `上次匯出：${fmtDate(rec.lastExport)}・之後有 ${n} 筆新記錄` : `還沒匯出過・目前有 ${n} 筆記錄`}</div>
        <div class="acts"><button class="btn dark" data-act="export">匯出記錄</button><button class="btn" data-act="import">匯入記錄</button></div>
        <div class="radio" role="radiogroup" aria-label="匯入方式">
          <label><input type="radio" name="imp" value="merge" ${ui.impMode === 'merge' ? 'checked' : ''}> 合併（保留較新的）</label>
          <label><input type="radio" name="imp" value="replace" ${ui.impMode === 'replace' ? 'checked' : ''}> 覆蓋</label>
        </div>
        <input type="file" id="impfile" accept="application/json,.json" hidden>
      </div>
    </section>`;
  }

  /* ---------------- 繪製 ---------------- */
  let lastRoute = '';
  async function render() {
    document.body.classList.toggle('no-kana', !rec.prefs.kana);
    document.body.classList.toggle('show-zh', !!rec.prefs.zh);
    const r = route();
    const rk = r.join('/');
    if (rk !== lastRoute) { ui.menuItem = null; if (r[0] === 'p') ui.ptab = 'scen'; }
    try {
      curTrip = await currentTrip();
      let html;
      if (r[0] === 'trips' || !curTrip) html = await viewTrips();
      else if (r[0] === 'p') html = viewPlace(curTrip, decodeURIComponent(r[1] || ''));
      else if (r[0] === 'vocab') html = viewVocab(curTrip);
      else html = viewHome(curTrip);
      $app.innerHTML = html;
    } catch (e) {
      console.error(e);
      $app.innerHTML = `<p class="empty">資料載入失敗：${esc(e.message)}</p>`;
    }
    if (rk !== lastRoute) { window.scrollTo(0, 0); lastRoute = rk; }
  }

  /* ---------------- 事件 ---------------- */
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const a = el.dataset.act, d = el.dataset;
    const t = curTrip;
    switch (a) {
      case 'day': ui.day = Number(d.day); render(); break;
      case 'ptab': ui.ptab = d.tab; render(); break;
      case 'variant': ui.variant[d.key] = d.v; render(); break;
      case 'cloze': ui.cloze[d.key] = !ui.cloze[d.key]; render(); break;
      case 'done': { const v = !scenDone(d.key); setScen(d.key, v); ui.open[d.key] = !v; render(); if (v) toast('已標記完成'); break; }
      case 'zh': el.closest('.line').classList.toggle('show'); break;
      case 'reveal': el.closest('.line').classList.add('reveal'); break;
      case 'say': speak(d.say); break;
      case 'menu': ui.menuItem = d.id || null; render(); break;
      case 'kana': rec.prefs.kana = !rec.prefs.kana; saveRec(); render(); break;
      case 'zhall': rec.prefs.zh = !rec.prefs.zh; saveRec(); render(); break;
      case 'fam': setFam(d.key, (famOf(d.key) + 1) % 4); render(); break;
      case 'vcat': ui.vcat = d.cat; render(); break;
      case 'vmode': ui.vmode = d.m; render(); break;
      case 'pmode': ui.pmode = d.m; ui.lsShow = false; render(); break;
      case 'flip': ui.flash.flip = !ui.flash.flip; render(); break;
      case 'grade': {
        const v = t.vocabById[ui.flash.ids[ui.flash.i]];
        const f = famOf(v.key), g = Number(d.g);
        setFam(v.key, g === 0 ? 0 : g === 1 ? Math.min(Math.max(f, 1), 2) : f + 1);
        if (g === 2) ui.flash.known++;
        ui.flash.i++; ui.flash.flip = false; render(); break;
      }
      case 'restart': ui.flash = null; render(); break;
      case 'cz': ui.cz = d.d === 'rand' ? Math.floor(Math.random() * 1e6) : ui.cz + Number(d.d); render(); break;
      case 'ls': ui.ls = d.d === 'rand' ? Math.floor(Math.random() * 1e6) : ui.ls + Number(d.d); ui.lsShow = false; render(); break;
      case 'lsshow': ui.lsShow = true; render(); break;
      case 'setcur': rec.current = d.id; saveRec(); ui.day = null; ui.flash = null; location.hash = '#/'; break;
      case 'export': exportRec(); break;
      case 'import': document.getElementById('impfile').click(); break;
    }
  });
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-act="reveal"]')) { e.preventDefault(); e.target.closest('.line').classList.add('reveal'); }
  });
  document.addEventListener('toggle', e => {
    const el = e.target;
    if (el.matches && el.matches('details.scen')) ui.open[el.dataset.key] = el.open;
  }, true);
  let noteTimer;
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.id === 'q') {
      ui.q = el.value;
      const box = document.getElementById('vlist');
      if (box && curTrip) box.innerHTML = vlistHTML(curTrip);
    } else if (el.dataset && el.dataset.note) {
      clearTimeout(noteTimer);
      const k = el.dataset.note, v = el.value;
      noteTimer = setTimeout(() => setNote(k, v), 400);
    }
  });
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset && el.dataset.filter) { ui[el.dataset.filter] = el.value; render(); }
    else if (el.name === 'imp') ui.impMode = el.value;
    else if (el.id === 'impfile' && el.files[0]) { importRec(el.files[0], ui.impMode); el.value = ''; }
  });
  window.addEventListener('hashchange', render);
  if ('speechSynthesis' in window) speechSynthesis.getVoices();

  /* ---------------- 啟動 ---------------- */
  (async () => {
    loadRec();
    try { index = await getJSON('data/index.json'); }
    catch (e) { $app.innerHTML = '<p class="empty">讀不到 data/index.json。若是直接開啟檔案，請改用網址（GitHub Pages 或本機伺服器）開啟。</p>'; return; }
    render();
  })();
})();
