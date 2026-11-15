/* VMM 3rd Party Attendance — dashboards shared by manage.html and admin.html (v1) */

const CHECKPOINTS = [['', 'Live'], ['08:00', '8 AM'], ['10:00', '10 AM'], ['12:00', '12 PM'], ['14:00', '2 PM'], ['18:00', '6 PM']];
const DONUT_COLORS = ['#1565C0', '#E91E8C', '#1565C0', '#E91E8C', '#0D47A1', '#B0005E'];

function donut(p, color) {
  return `<div class="donut" style="background:conic-gradient(${color} 0 ${Math.min(p, 100)}%,#E6EBF2 0)"><b>${p}%</b></div>`;
}
function kpi(label, value, extra = '', color = '') {
  return `<div class="kpi"><div class="l">${esc(label)}</div><span class="v" ${color ? `style="color:${color}"` : ''}>${value}</span>${extra}</div>`;
}
function pctCell(p, r) { const v = pct(p, r); return r || p ? `<span class="tag ${pctTag(v)}">${v}%</span>` : '—'; }

/* ---------- live dashboard v4: actions, category filter, view-by, 7-day boxes ---------- */
function weekBoxes(r, p, small) {
  return `<span class="hm${small ? ' sm' : ''}">${r.map((q, i) => { if (!q) return '<i class="n" title="No requirement"></i>';
    const v = pct(p[i], q); return `<i class="${v >= 90 ? 'g' : v >= 70 ? 'a' : 'r'}" title="${v}%">${small ? '' : v}</i>`; }).join('')}</span>`;
}
function LiveDash(root, me) {
  const mob = Layout.effective() === 'mobile';
  const defView = { am: 'store', zfm: 'am' }[me.role] || 'zfm';
  const st = { date: todayIST(), shift: istNow().getHours() < 14 ? 'M' : 'B', upto: '', zfm: '', am: '', q: '', cat: '', alert: '',
    view: defView, path: [], data: null, week: null };
  const views = [['zfm', 'ZFM'], ['am', 'AM'], ['store', 'Store'], ['dept', 'Dept']].filter(([v]) => !(me.role === 'am' && (v === 'zfm' || v === 'am')) && !(me.role === 'zfm' && v === 'zfm'));
  root.innerHTML = `
    <div class="top"><h1>Live Dashboard</h1>
      <div class="flt"><input type="date" id="ldDate">${mob ? '' : '<select id="ldZfm"></select><select id="ldAm"></select>'}
        <input id="ldQ" placeholder="Store code" maxlength="4" style="width:100px;text-transform:uppercase">${mob ? '' : '<select id="ldCat"></select>'}
        <button class="btn o sm" id="ldRefresh" title="Refresh">↻</button>${mob ? '' : '<button class="btn o sm" id="ldXls">⬇ Excel</button>'}</div></div>
    <div class="row" style="align-items:center"><div class="seg" id="ldShift" style="min-width:${mob ? 0 : 250}px;flex:1"><button data-s="M">Morning</button><button data-s="E">Evening</button><button data-s="B">Both</button></div>
      ${mob ? '' : `<div class="seg blue grow" id="ldCp" style="flex:2">${CHECKPOINTS.map(([v, l]) => `<button data-v="${v}">${l}</button>`).join('')}</div>`}</div>
    <div class="panel actp" id="ldAct"></div>
    <div class="k5" id="ldKpi"></div>
    <div class="pies${mob ? ' pies4' : ''}" id="ldPies"></div>
    <div class="vbar"><span class="mini" style="font-weight:700">VIEW BY</span><div class="view" id="ldView">${views.map(([v, l]) => `<button data-w="${v}">${l}</button>`).join('')}</div><span id="ldChips"></span></div>
    <div class="crumb" id="ldCrumb"></div>
    <div class="tbl" id="ldTbl"></div>
    <div id="ldStore"></div>`;
  const $r = (s) => root.querySelector(s);
  $r('#ldDate').value = st.date; $r('#ldDate').max = todayIST();
  const cname = (id) => { const c = st.data && st.data.categories.find((x) => x.id === id); return c ? catName(c) : id; };

  function paintSeg() {
    root.querySelectorAll('#ldShift button').forEach((b) => b.classList.toggle('on', b.dataset.s === st.shift));
    root.querySelectorAll('#ldCp button').forEach((b) => b.classList.toggle('on', b.dataset.v === st.upto));
    root.querySelectorAll('#ldView button').forEach((b) => b.classList.toggle('on', b.dataset.w === st.view));
  }
  async function load() {
    $r('#ldKpi').innerHTML = '<div class="spin"></div>';
    const [r, w] = await Promise.all([
      rpc('dash_overview', { p_token: me.token, p_date: st.date, p_shift: st.shift, p_upto: st.upto || null }),
      rpc('dash_week', { p_token: me.token, p_end: st.date, p_shift: st.shift })]);
    if (!r || !r.ok) { $r('#ldKpi').innerHTML = `<div class="note r">${esc(errText(r && r.error))}</div>`; return; }
    st.data = r; st.week = (w && w.ok) ? w.rows : [];
    if (!mob) {
      const zfms = [...new Map(r.stores.filter((s) => s.zfm).map((s) => [s.zfm, s.zfm_name || s.zfm])).entries()];
      $r('#ldZfm').innerHTML = `<option value="">ZFM: All</option>` + zfms.map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
      $r('#ldZfm').value = st.zfm; $r('#ldZfm').hidden = zfms.length < 2;
      $r('#ldCat').innerHTML = `<option value="">Dept: All</option>` + r.categories.map((c) => `<option value="${esc(c.id)}">${esc(catName(c))}</option>`).join('');
      $r('#ldCat').value = st.cat;
      paintAm();
    }
    paint();
  }
  function paintAm() {
    const ams = [...new Map(st.data.stores.filter((s) => s.am && (!st.zfm || s.zfm === st.zfm)).map((s) => [s.am, s.am_name || s.am])).entries()];
    $r('#ldAm').innerHTML = `<option value="">AM: All</option>` + ams.map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
    if (!ams.some(([k]) => k === st.am)) st.am = ''; $r('#ldAm').value = st.am; $r('#ldAm').hidden = ams.length < 2;
  }
  // stores in scope of filters + drill path (category filter applied to rows separately)
  function scopeStores() {
    let s = st.data.stores.filter((x) => (!st.zfm || x.zfm === st.zfm) && (!st.am || x.am === st.am) && (!st.q || x.code.startsWith(st.q)));
    st.path.forEach((p) => { s = s.filter((x) => x[p.key] === p.val); });
    return s;
  }
  const catOk = (c) => !st.cat || c === st.cat;
  function alertsOn() {
    const d = st.data; if (d.date < d.today) return true;
    if (d.date > d.today) return false;
    const gate = st.shift === 'E' ? d.alert_e : d.alert_m;
    return d.now >= gate;
  }
  // ---- action list (stores) ----
  function alertStores(kind) {
    const set = new Set(scopeStores().map((s) => s.code)), rows = st.data.rows.filter((x) => set.has(x.s));
    if (kind === 'hk' || kind === 'sec') {
      const c = kind === 'hk' ? 'HK' : 'SEC';
      return rows.filter((x) => x.c === c && x.req > 0 && x.p === 0).map((x) => ({ s: x.s, info: `${cname(c)} 0 of ${x.req}`, miss: x.req }));
    }
    if (kind === 'low') {
      const by = {}; st.week.filter((x) => set.has(x.s) && catOk(x.c)).forEach((x) => {
        const o = by[x.s] || (by[x.s] = { r: [0, 0, 0, 0, 0, 0, 0], p: [0, 0, 0, 0, 0, 0, 0] }); x.r.forEach((v, i) => { o.r[i] += v; o.p[i] += Math.min(x.p[i], v || x.p[i]); }); });
      const idx = st.data.date === st.data.today ? [3, 4, 5] : [4, 5, 6];
      return Object.entries(by).filter(([, o]) => idx.every((i) => o.r[i] > 0 && pct(o.p[i], o.r[i]) < 70))
        .map(([s, o]) => ({ s, info: idx.map((i) => `${pct(o.p[i], o.r[i])}%`).join(' · '), miss: 0 }));
    }
    if (kind === 'photo') return st.data.photo_due.filter((x) => set.has(x.s) && catOk(x.c)).reduce((a, x) => { const f = a.find((y) => y.s === x.s); if (f) { f.miss += x.n; f.info = `${f.miss} selfie due`; } else a.push({ s: x.s, info: `${x.n} selfie due`, miss: x.n }); return a; }, []);
    return [];
  }
  function paintActions() {
    if (!alertsOn()) { $r('#ldAct').innerHTML = `<h3>⚡ Action needed now</h3><div class="note i">Alerts start at ${st.shift === 'E' ? st.data.alert_e : st.data.alert_m} for this shift (set in Admin → Settings).</div>`; return; }
    const sm = new Map(st.data.stores.map((s) => [s.code, s]));
    const card = (k, title, cls, color) => { const l = alertStores(k); const ams = new Set(l.map((x) => (sm.get(x.s) || {}).am).filter(Boolean)).size;
      const sub = k === 'hk' || k === 'sec' ? `${l.reduce((a, x) => a + x.miss, 0)} missing · ${ams} AM${ams === 1 ? '' : 's'}` : k === 'low' ? 'Vendor follow-up needed' : 'Random check skipped';
      const n = k === 'photo' ? l.reduce((a, x) => a + x.miss, 0) : l.length;
      return `<button class="ac ${cls}${st.alert === k ? ' sel' : ''}" data-a="${k}"><span class="t">${title}</span><b style="color:${color}">${n} ${k === 'photo' ? 'punch' + (n === 1 ? '' : 'es') : 'store' + (n === 1 ? '' : 's')}</b><span class="s">${sub}</span><span class="lnk">${st.alert === k ? 'Showing ✓' : 'See stores ›'}</span></button>`; };
    $r('#ldAct').innerHTML = `<h3>⚡ Action needed now <span class="mini" style="font-weight:400">· ${{ M: 'Morning', E: 'Evening', B: 'Both shifts' }[st.shift]}${st.data.date === st.data.today ? ' · till ' + st.data.now : ' · ' + fmtDate(st.data.date)}</span></h3>
      <div class="act">${card('hk', 'Housekeeping: required, nobody punched', '', 'var(--red)')}${card('sec', 'Security: required, nobody punched', '', 'var(--red)')}
      ${card('low', 'Below 70% for 3 days in a row', 'w', 'var(--amb)')}${card('photo', 'Selfie due but not taken', 'i', 'var(--blue)')}</div>`;
  }
  function paint() {
    paintSeg(); paintActions();
    const stores = scopeStores(), set = new Set(stores.map((s) => s.code));
    const rows = st.data.rows.filter((x) => set.has(x.s));
    const rowsC = rows.filter((x) => catOk(x.c));
    const tot = rowsC.reduce((a, x) => ({ req: a.req + x.req, p: a.p + x.p }), { req: 0, p: 0 });
    const byStore = {}; rowsC.forEach((x) => { const o = byStore[x.s] || (byStore[x.s] = { req: 0, p: 0 }); o.req += x.req; o.p += Math.min(x.p, x.req || x.p); });
    const full = Object.values(byStore).filter((o) => o.req && o.p >= o.req).length;
    const low = Object.values(byStore).filter((o) => o.req && pct(o.p, o.req) < 70).length;
    const tp = pct(tot.p, tot.req);
    $r('#ldKpi').innerHTML = kpi('Required', tot.req.toLocaleString('en-IN')) + kpi('Present', tot.p.toLocaleString('en-IN'), `<span class="p" style="color:${pctColor(tp)}">${tp}%</span>`)
      + kpi('Not punched', Math.max(tot.req - tot.p, 0).toLocaleString('en-IN'), '', 'var(--red)') + (mob ? '' : kpi('Stores at 100%', full) + kpi('Stores below 70%', low, '', 'var(--red)'));
    $r('#ldPies').innerHTML = st.data.categories.map((c, i) => {
      const cr = rows.filter((x) => x.c === c.id); const q = cr.reduce((a, x) => a + x.req, 0), p = cr.reduce((a, x) => a + x.p, 0);
      return `<button class="pie${st.cat === c.id ? ' sel' : st.cat ? ' dim' : ''}" data-c="${esc(c.id)}">${donut(pct(p, q), DONUT_COLORS[i % DONUT_COLORS.length])}<small>${esc(catName(c))}</small>${mob ? '' : `<span>${p.toLocaleString('en-IN')} / ${q.toLocaleString('en-IN')}</span>`}</button>`;
    }).join('');
    const chips = [];
    if (st.cat) chips.push(`<button class="chip" data-clear="cat">${esc(cname(st.cat))} ✕</button>`);
    if (st.alert) chips.push(`<button class="chip" data-clear="alert">${esc({ hk: 'HK nobody punched', sec: 'Security nobody punched', low: 'Below 70% · 3 days', photo: 'Selfie due' }[st.alert])} ✕</button>`);
    $r('#ldChips').innerHTML = chips.join(' ');
    if (!mob && $r('#ldCat')) $r('#ldCat').value = st.cat;
    paintTable(stores, rows);
  }
  function level() { return st.alert ? 'store' : st.path.length ? st.path[st.path.length - 1].next : st.view; }
  function weekFor(codes, cats) {
    const set = new Set(codes), r = [0, 0, 0, 0, 0, 0, 0], p = [0, 0, 0, 0, 0, 0, 0];
    st.week.filter((x) => set.has(x.s) && (!cats || cats.includes(x.c))).forEach((x) => x.r.forEach((v, i) => { r[i] += v; p[i] += Math.min(x.p[i], v || x.p[i]); }));
    return { r, p };
  }
  function paintTable(stores, rows) {
    const lv = level(), cats = st.data.categories;
    let lines;
    if (lv === 'dept') {
      lines = cats.filter((c) => catOk(c.id)).map((c) => { const cr = rows.filter((x) => x.c === c.id);
        const req = cr.reduce((a, x) => a + x.req, 0), p = cr.reduce((a, x) => a + x.p, 0);
        return { key: c.id, name: catName(c), n: new Set(cr.filter((x) => x.req).map((x) => x.s)).size, req, p, pc: pct(p, req),
          zero: cr.filter((x) => x.req > 0 && x.p === 0).length, wk: weekFor(stores.map((s) => s.code), [c.id]) }; });
    } else {
      let fStores = stores;
      if (st.alert) { const al = new Map(alertStores(st.alert).map((x) => [x.s, x])); fStores = stores.filter((s) => al.has(s.code)).map((s) => ({ ...s, _info: al.get(s.code).info })); }
      const keyOf = { zfm: (s) => s.zfm || '—', am: (s) => s.am || '—', store: (s) => s.code };
      const nameOf = { zfm: (s) => s.zfm_name || s.zfm || '—', am: (s) => s.am_name || s.am || '—', store: (s) => `${s.code} · ${s.name}` };
      const groups = new Map();
      fStores.forEach((s) => { const k = keyOf[lv](s); if (!groups.has(k)) groups.set(k, { key: k, name: nameOf[lv](s), zfm: s.zfm_name || s.zfm, stores: [], info: s._info }); groups.get(k).stores.push(s.code); });
      lines = [...groups.values()].map((g) => {
        const set = new Set(g.stores); const gr = rows.filter((x) => set.has(x.s) && catOk(x.c));
        const req = gr.reduce((a, x) => a + x.req, 0), p = gr.reduce((a, x) => a + x.p, 0);
        const zeroStores = new Set(gr.filter((x) => x.req > 0 && x.p === 0).map((x) => x.s)).size;
        return { ...g, n: g.stores.length, req, p, pc: pct(p, req), zero: zeroStores, wk: weekFor(g.stores, st.cat ? [st.cat] : null) };
      });
    }
    lines.sort((a, b) => (a.req ? a.pc : 101) - (b.req ? b.pc : 101));
    const head = { zfm: 'ZFM', am: 'AM', store: 'Store', dept: 'Dept' }[lv];
    const zeroH = lv === 'dept' ? 'Stores with 0' : st.cat ? `Stores with 0 ${esc(cname(st.cat))}` : 'Stores with a gap';
    const wa = (l) => `${l.name}: ${l.p}/${l.req} (${l.pc}%)${l.zero ? ` · ${l.zero} store(s) with nobody` : ''} · ${fmtDate(st.date)} ${{ M: 'Morning', E: 'Evening', B: '' }[st.shift]}`;
    if (mob) {
      $r('#ldTbl').innerHTML = `<table><thead><tr><th>${head}</th><th>P/R</th><th>%</th><th>Last 7 days</th></tr></thead><tbody>
        ${lines.map((l) => `<tr class="click" data-k="${esc(l.key)}" data-n="${esc(l.name)}"><td><b>${esc(lv === 'store' ? l.key : l.name)}</b>${lv === 'store' ? `<div class="mini">${esc(l.name.split(' · ')[1] || '')}</div>` : ''}${l.info ? `<div class="mini" style="color:var(--red)">${esc(l.info)}</div>` : ''}</td>
          <td>${l.p}/${l.req}</td><td>${pctCell(l.p, l.req)}${l.zero && lv === 'store' ? '<div><span class="tag r" style="margin-top:3px;display:inline-block">Nobody</span></div>' : ''}</td><td>${weekBoxes(l.wk.r, l.wk.p, true)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No data</td></tr>'}</tbody></table>`;
    } else {
      $r('#ldTbl').innerHTML = `<table><thead><tr><th>${head}</th>${lv === 'am' ? '<th>ZFM</th>' : ''}${lv !== 'store' ? '<th>Stores</th>' : ''}<th>Required</th><th>Present</th><th>%</th><th>${zeroH}</th>${st.alert ? '<th>Why</th>' : ''}<th>Last 7 days (%)</th><th>Share</th></tr></thead><tbody>
        ${lines.map((l) => `<tr class="click" data-k="${esc(l.key)}" data-n="${esc(l.name)}"><td><b>${esc(l.name)}</b></td>${lv === 'am' ? `<td>${esc(l.zfm || '—')}</td>` : ''}${lv !== 'store' ? `<td>${l.n}</td>` : ''}
          <td>${l.req}</td><td>${l.p}</td><td>${pctCell(l.p, l.req)}</td><td>${l.zero ? `<span class="tag r">${lv === 'store' ? 'Nobody' : l.zero + ' store' + (l.zero === 1 ? '' : 's')}</span>` : '—'}</td>
          ${st.alert ? `<td>${esc(l.info || '')}</td>` : ''}<td>${weekBoxes(l.wk.r, l.wk.p)}</td><td><span class="waicon" data-wa="${esc(wa(l))}" title="Send on WhatsApp">${WA_ICON}</span></td></tr>`).join('') || '<tr><td colspan="10" class="empty">No data</td></tr>'}</tbody></table>`;
    }
    const crumbs = [`<button data-i="-1">All</button>`].concat(st.path.map((p, i) => `<button data-i="${i}">${esc(p.name)}</button>`));
    $r('#ldCrumb').innerHTML = crumbs.join(' › ') + ` <span style="margin-left:8px">· tap a row to ${lv === 'store' ? 'see people' : 'open'}</span>`;
    $r('#ldStore').innerHTML = '';
    st.lines = lines; st.lv = lv;
  }
  async function storeDetail(code, name) {
    $r('#ldStore').innerHTML = '<div class="spin"></div>';
    const r = await rpc('dash_store', { p_token: me.token, p_store: code, p_date: st.date, p_shift: st.shift });
    if (!r || !r.ok) { $r('#ldStore').innerHTML = `<div class="note r">${esc(errText(r && r.error))}</div>`; return; }
    const slots = r.slots.filter((s) => catOk(s.c)), people = r.present.filter((a) => catOk(a.c));
    // one table: each category / brand block shows Required, Present, Status once, with its people underneath
    const gk = (c, b) => c + '|' + (b || ''); const groups = new Map();
    slots.forEach((s) => groups.set(gk(s.c, s.brand), { c: s.c, brand: s.brand || '', vendor: s.vendor, req: s.req, p: s.p, people: [] }));
    people.forEach((a) => { const k = gk(a.c, a.brand); if (!groups.has(k)) groups.set(k, { c: a.c, brand: a.brand || '', vendor: '', req: 0, p: 0, people: [] }); groups.get(k).people.push(a); });
    const photoCell = (a) => a.photo === 'done' ? (a.live === 'fail' ? '📷 <span class="tag r">Live ✕</span>' : a.live === 'pass' ? '📷 <span class="tag ok">Live ✓</span>' : '📷') : a.photo === 'pending' ? '<span class="tag r">Due</span>' : '';
    const rowsHtml = [...groups.values()].map((g) => {
      const n = Math.max(g.people.length, 1);
      const head = `<td rowspan="${n}" style="vertical-align:top"><b>${esc(cname(g.c))}</b>${g.brand ? `<div class="mini">${esc(g.brand)}</div>` : ''}${g.vendor ? `<div class="mini">Vendor: ${esc(g.vendor)}</div>` : ''}</td>
        <td rowspan="${n}" style="vertical-align:top;text-align:center">${g.req}</td><td rowspan="${n}" style="vertical-align:top;text-align:center">${g.p}</td>
        <td rowspan="${n}" style="vertical-align:top">${g.req > g.p ? `<span class="tag r">Missing ${g.req - g.p}</span>` : '<span class="tag ok">OK</span>'}</td>`;
      if (!g.people.length) return `<tr style="border-top:2px solid var(--line)">${head}<td colspan="8" style="color:var(--red)">Nobody has punched</td></tr>`;
      return g.people.map((a, i) => `<tr${i === 0 ? ' style="border-top:2px solid var(--line)"' : ''}>${i === 0 ? head : ''}<td>${esc(a.name)}</td><td>${esc(a.code)}</td><td>${esc(a.vendor || '—')}</td><td>${a.first_in || '—'}</td><td>${a.last_out || '—'}</td><td>${a.hours ?? '—'}</td><td>${a.via_mod ? '<span class="tag w">Store</span>' : 'Own'}</td>
        <td>${photoCell(a)} <a href="statement.html?s=${code}&a=${a.id}&from=${monthStart(st.date)}&to=${st.date}">Statement</a></td></tr>`).join('');
    }).join('');
    $r('#ldStore').innerHTML = `<div class="panel"><h3>${esc(name)} · ${fmtDate(st.date)}</h3>
      <div class="tbl"><table><thead><tr><th>Category</th><th>Required</th><th>Present</th><th>Status</th><th>Name</th><th>Code</th><th>Vendor</th><th>IN</th><th>OUT</th><th>Hours</th><th>Phone</th><th>Photo · Statement</th></tr></thead><tbody>
      ${rowsHtml || '<tr><td colspan="12" class="empty">Nothing required, nobody punched</td></tr>'}</tbody></table></div>
      ${r.regulars_missing.length ? `<h3>Regulars not here</h3><div>${r.regulars_missing.filter((a) => catOk(a.c)).map((a) => `<span class="tag w" style="margin:2px;display:inline-block">${esc(a.name)} · ${esc(cname(a.c))} · ${a.days}/7</span>`).join('')}</div>` : ''}</div>`;
    $r('#ldStore').scrollIntoView({ behavior: 'smooth' });
  }

  root.addEventListener('click', (e) => {
    const s = e.target.closest('#ldShift button'); if (s) { st.shift = s.dataset.s; load(); return; }
    const c = e.target.closest('#ldCp button'); if (c) { st.upto = c.dataset.v; load(); return; }
    const a = e.target.closest('[data-a]'); if (a) { st.alert = st.alert === a.dataset.a ? '' : a.dataset.a; st.path = []; paint(); return; }
    const p = e.target.closest('.pie[data-c]'); if (p) { st.cat = st.cat === p.dataset.c ? '' : p.dataset.c; paint(); return; }
    const v = e.target.closest('#ldView button'); if (v) { st.view = v.dataset.w; st.path = []; st.alert = ''; paint(); return; }
    const x = e.target.closest('[data-clear]'); if (x) { st[x.dataset.clear] = ''; paint(); return; }
    const w = e.target.closest('[data-wa]'); if (w) { e.stopPropagation(); waShare(w.dataset.wa); return; }
    const cr = e.target.closest('#ldCrumb button'); if (cr) { st.path = st.path.slice(0, Number(cr.dataset.i) + 1); paint(); return; }
    const tr = e.target.closest('#ldTbl tr.click'); if (tr) {
      const lv = st.lv;
      if (lv === 'store') { storeDetail(tr.dataset.k, tr.dataset.n); return; }
      if (lv === 'dept') { st.cat = tr.dataset.k; st.view = 'store'; st.path = []; paint(); return; }
      st.path.push({ key: lv, val: tr.dataset.k, name: tr.dataset.n, next: lv === 'zfm' ? 'am' : 'store' }); paint(); return;
    }
  });
  $r('#ldDate').addEventListener('change', (e) => { st.date = e.target.value || todayIST(); st.upto = st.date === todayIST() ? st.upto : ''; load(); });
  $r('#ldQ').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); st.q = e.target.value; if (st.data) paint(); });
  if (!mob) {
    $r('#ldZfm').addEventListener('change', (e) => { st.zfm = e.target.value; st.path = []; paintAm(); paint(); });
    $r('#ldAm').addEventListener('change', (e) => { st.am = e.target.value; st.path = []; paint(); });
    $r('#ldCat').addEventListener('change', (e) => { st.cat = e.target.value; paint(); });
    $r('#ldXls').addEventListener('click', () => {
      if (!st.lines) return;
      downloadXlsx(st.lines.map((l) => ({ [st.lv]: l.name, Stores: l.n, Required: l.req, Present: l.p, '%': l.pc, 'Stores with 0': l.zero,
        ...Object.fromEntries(l.wk.r.map((q, i) => [`D-${6 - i}`, q ? pct(l.wk.p[i], q) : ''])) })), `Attendance_${st.lv}_${st.date}_${st.shift}.xlsx`);
    });
  }
  $r('#ldRefresh').addEventListener('click', load);
  load();
  return { reload: load };
}

/* ---------- staff churn ---------- */
function ChurnView(root, me) {
  const st = { days: 30, data: null, ov: null, f: { zfm: '', am: '', store: '', cat: '', vendor: '' } };
  root.innerHTML = `
    <div class="top"><h1>Staff Churn · last <span id="chDaysL">30</span> days</h1>
      <div class="flt"><select id="chZfm"></select><select id="chAm"></select><input id="chStore" placeholder="Store code" maxlength="4" style="width:100px;text-transform:uppercase"><select id="chCat"></select><select id="chVendor"></select>
      <select id="chDays"><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option></select><button class="btn o sm" id="chXls">⬇ Excel</button></div></div>
    <div class="note i">Stable: up to 1 more name than required · Some churn: up to 2× required · High churn: more than that.</div>
    <div class="k5" id="chKpi"></div>
    <div class="tbl" id="chTbl"></div>
    <h3 style="margin:6px 0 0">Vendor ranking</h3>
    <div class="tbl" id="chVen"></div>`;
  const $r = (s) => root.querySelector(s);
  const status = (x) => { if (!x.req) return x.names ? 'r' : 'ok'; if (x.names <= x.req + 1) return 'ok'; if (x.names <= x.req * 2) return 'w'; return 'r'; };
  const label = { ok: 'Stable', w: 'Some churn', r: 'High churn' };
  async function load() {
    $r('#chKpi').innerHTML = '<div class="spin"></div>';
    const [r, ov] = await Promise.all([rpc('churn', { p_token: me.token, p_days: st.days }), st.ov ? Promise.resolve(st.ov) : rpc('dash_overview', { p_token: me.token, p_date: todayIST(), p_shift: 'B', p_upto: null })]);
    if (!r || !r.ok) { $r('#chKpi').innerHTML = `<div class="note r">${esc(errText(r && r.error))}</div>`; return; }
    st.data = r; st.ov = ov;
    const stores = ov.stores || [];
    const opt = (arr, all) => `<option value="">${all}</option>` + arr.map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
    $r('#chZfm').innerHTML = opt([...new Map(stores.filter((s) => s.zfm).map((s) => [s.zfm, s.zfm_name || s.zfm]))], 'ZFM: All');
    $r('#chAm').innerHTML = opt([...new Map(stores.filter((s) => s.am).map((s) => [s.am, s.am_name || s.am]))], 'AM: All');
    $r('#chCat').innerHTML = opt((ov.categories || []).map((c) => [c.id, c.name]), 'Category: All');
    $r('#chVendor').innerHTML = opt([...new Set(r.rows.map((x) => x.vendor).filter(Boolean))].sort().map((v) => [v, v]), 'Vendor: All');
    Object.entries({ chZfm: 'zfm', chAm: 'am', chCat: 'cat', chVendor: 'vendor' }).forEach(([id, k]) => $r('#' + id).value = st.f[k]);
    paint();
  }
  function rowsF() {
    const sm = new Map((st.ov.stores || []).map((s) => [s.code, s]));
    return st.data.rows.filter((x) => { const s = sm.get(x.s) || {};
      return (!st.f.zfm || s.zfm === st.f.zfm) && (!st.f.am || s.am === st.f.am) && (!st.f.store || x.s === st.f.store)
        && (!st.f.cat || x.c === st.f.cat) && (!st.f.vendor || x.vendor === st.f.vendor); }).map((x) => ({ ...x, st: status(x), sname: (sm.get(x.s) || {}).name || '' }));
  }
  function paint() {
    const rows = rowsF();
    const n = (k) => rows.filter((x) => x.st === k).length;
    $r('#chKpi').innerHTML = kpi('Stable slots', n('ok'), '', 'var(--ok)') + kpi('Some churn', n('w'), '', 'var(--amb)') + kpi('High churn', n('r'), '', 'var(--red)');
    const order = { r: 0, w: 1, ok: 2 };
    rows.sort((a, b) => order[a.st] - order[b.st] || (b.names - b.req) - (a.names - a.req));
    $r('#chTbl').innerHTML = `<table><thead><tr><th>Store</th><th>Category</th><th>Brand</th><th>Vendor</th><th>Required</th><th>Different names</th><th>Status</th></tr></thead><tbody>
      ${rows.slice(0, 500).map((x) => `<tr><td>${esc(x.s)} · ${esc(x.sname)}</td><td>${esc(x.c)}</td><td>${esc(x.brand || '—')}</td><td>${esc(x.vendor || '—')}</td><td>${x.req}</td><td>${x.names}</td><td><span class="tag ${x.st}">${label[x.st]}</span></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No data</td></tr>'}</tbody></table>`;
    const vm = new Map(); rows.forEach((x) => { const v = x.vendor || '—'; const o = vm.get(v) || { slots: 0, high: 0, stable: 0 }; o.slots++; if (x.st === 'r') o.high++; if (x.st === 'ok') o.stable++; vm.set(v, o); });
    $r('#chVen').innerHTML = `<table><thead><tr><th>Vendor</th><th>Slots</th><th>High churn</th><th>Stable %</th></tr></thead><tbody>
      ${[...vm.entries()].sort((a, b) => b[1].high - a[1].high).map(([v, o]) => `<tr><td>${esc(v)}</td><td>${o.slots}</td><td>${o.high}</td><td><span class="tag ${pctTag(pct(o.stable, o.slots))}">${pct(o.stable, o.slots)}%</span></td></tr>`).join('')}</tbody></table>`;
    st.rows = rows;
  }
  root.addEventListener('change', (e) => {
    const m = { chZfm: 'zfm', chAm: 'am', chCat: 'cat', chVendor: 'vendor' }[e.target.id];
    if (m) { st.f[m] = e.target.value; paint(); }
    if (e.target.id === 'chDays') { st.days = Number(e.target.value); $r('#chDaysL').textContent = st.days; load(); }
  });
  $r('#chStore').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); st.f.store = /^[A-Z]{2}\d{2}$/.test(e.target.value) ? e.target.value : ''; paint(); });
  $r('#chXls').addEventListener('click', () => { if (st.rows) downloadXlsx(st.rows.map((x) => ({ Store: x.s, Name: x.sname, Category: x.c, Brand: x.brand, Vendor: x.vendor, Required: x.req, 'Different names': x.names, Status: label[x.st] })), `Staff_churn_${st.days}d_${todayIST()}.xlsx`); });
  load();
}

/* ---------- reset PIN list (ZFM + Admin) ---------- */
function PinReset(root, me, rowsLoader) {
  root.innerHTML = `<div class="top"><h1>Users &amp; PIN</h1><div class="flt"><input id="prQ" placeholder="Search name / emp / store"></div></div>
    <div class="note i">Reset clears the PIN. The person creates a new PIN at next login (math captcha + new PIN).</div><div class="tbl" id="prTbl"></div>`;
  const $r = (s) => root.querySelector(s); let rows = [];
  async function load() { $r('#prTbl').innerHTML = '<div class="spin"></div>'; rows = await rowsLoader(); paint(); }
  function paint() {
    const qv = $r('#prQ').value.trim().toLowerCase();
    const f = rows.filter((u) => !qv || `${u.name} ${u.emp_code} ${u.store_code || ''}`.toLowerCase().includes(qv));
    $r('#prTbl').innerHTML = `<table><thead><tr><th>Emp</th><th>Name</th><th>Role</th><th>Post</th><th>Store</th><th>PIN</th><th></th></tr></thead><tbody>
      ${f.slice(0, 400).map((u) => `<tr><td>${esc(u.emp_code)}</td><td>${esc(u.name)}</td><td>${esc(u.role)}</td><td>${esc(u.post || '—')}</td><td>${esc(u.store_code || '—')}</td>
        <td>${u.locked ? '<span class="tag r">Locked</span>' : u.pin_set ? '<span class="tag ok">Set</span>' : '<span class="tag w">Not set</span>'}</td>
        <td>${(u.role !== 'admin' || (me.role === 'admin' && u.emp_code !== me.emp)) && (u.pin_set || u.locked) ? `<button class="btn o sm" data-reset="${esc(u.emp_code)}">Reset PIN</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No users</td></tr>'}</tbody></table>`;
  }
  $r('#prQ').addEventListener('input', paint);
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-reset]'); if (!b) return;
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Tap again to confirm'; b.classList.add('red'); b.classList.remove('o'); return; }
    b.disabled = true; const r = await rpc('reset_pin', { p_token: me.token, p_emp: b.dataset.reset });
    if (r && r.ok) {
      if (r.code) modal(`<h3>New setup code</h3><p style="margin:0">${esc(r.name)} needs this code to create a new PIN (valid ${7} days). Share it privately, not in a group.</p><div class="big" style="letter-spacing:6px">${esc(r.code)}</div>`, async (f, close) => { close(); return null; }).okLabel('Done');
      else toast(`PIN reset for ${r.name}`);
      load();
    } else { toast(errText(r && r.error)); b.disabled = false; }
  });
  load();
}

/* ---------- shell / nav ---------- */
function Shell(me, items, onPick) {
  const nav = $('#nav');
  nav.innerHTML = `<div class="brand"><img src="assets/logo.png" alt="Vishal Mega Mart"></div><div class="subt">3RD PARTY ATTENDANCE</div>
    <div class="who">${esc(me.name)}<small>${esc({ admin: 'Admin', am: 'AM', zfm: 'ZFM', hodept: 'HO ' + (me.dept || 'Dept') }[me.role] || me.role)} · ${esc(me.emp)}</small></div>
    ${items.map((it) => it.grp ? `<div class="grp">${esc(it.grp)}</div>` : `<button data-v="${it.id}">${esc(it.label)}</button>`).join('')}
    <button id="navView">${Layout.effective() === 'mobile' ? '🖥 Desktop view' : '📱 Mobile view'}</button>
    <button id="navPin">Change PIN</button>
    <button id="navLogout">Logout</button>
    <div class="bottom">${credit()}</div>`;
  if (!$('#shellFoot')) document.body.insertAdjacentHTML('beforeend', `<p class="foot shellfoot" id="shellFoot">${credit()}</p>`);
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]'); if (b) { pick(b.dataset.v); }
    if (e.target.id === 'navLogout') logout();
    if (e.target.id === 'navPin') changePinDialog(me);
    if (e.target.id === 'navView') { Layout.set(Layout.effective() === 'mobile' ? 'desktop' : 'mobile'); location.reload(); }
  });
  function pick(id) { nav.querySelectorAll('button[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === id)); location.hash = id; onPick(id); }
  window.addEventListener('hashchange', () => { const h = (location.hash || '').slice(1); const on = nav.querySelector('button.on'); if (ids.includes(h) && (!on || on.dataset.v !== h)) pick(h); });
  const first = (location.hash || '').slice(1);
  const ids = items.filter((i) => i.id).map((i) => i.id);
  pick(ids.includes(first) ? first : ids[0]);
}

/* ---------- v4: approvals (AM decides, Admin sees all) ---------- */
const CR_KIND = { compoff: 'Comp-off', staff: 'Staff details', missed_out: 'Missed OUT', missed_in: 'Missed IN' };
function crChange(r) {
  if (r.kind === 'compoff') return (r.payload && r.payload.on === false) ? 'Comp-off → remove' : `Absent → Comp-off · ${fmtDay(r.date)}`;
  if (r.kind === 'staff') { const o = (r.payload && r.payload.old) || {}, n = (r.payload && r.payload.new) || {};
    return ['name', 'vendor', 'brand'].filter((k) => (o[k] || '') !== (n[k] || '')).map((k) => `${k}: ${o[k] || '—'} → ${n[k] || '—'}`).join(' · ') || 'No change'; }
  return '';
}
function ApprovalsView(root, me) {
  const st = { status: 'pending' };
  root.innerHTML = `<div class="top"><h1>Approvals</h1><div class="seg" id="apSt" style="min-width:300px"><button data-s="pending">Pending</button><button data-s="approved">Approved</button><button data-s="rejected">Rejected</button></div></div>
    <div class="note i">Store asks with a reason. Nothing changes until you approve. Only Admin can delete.</div><div class="panel" style="padding:0;overflow:hidden" id="apList"></div>`;
  const $r = (s) => root.querySelector(s);
  async function load() {
    root.querySelectorAll('#apSt button').forEach((b) => b.classList.toggle('on', b.dataset.s === st.status));
    $r('#apList').innerHTML = '<div class="spin"></div>';
    const r = await rpc('cr_list', { p_token: me.token, p_status: st.status, p_days: 60 });
    if (!r || !r.ok) { $r('#apList').innerHTML = `<div class="note r">${esc(errText(r && r.error))}</div>`; return; }
    $r('#apList').innerHTML = r.rows.map((x) => `<div class="reqcard"><b>${esc(x.store)} · ${esc(x.by_post || '')} ${esc(x.by_name || x.by)}</b>
      <div style="font-size:13px">${esc(CR_KIND[x.kind] || x.kind)} · ${esc(x.assoc || '')} <span class="mini">${esc(x.assoc_code || '')}</span></div>
      <div><span class="tag i">${esc(crChange(x))}</span></div><div class="mini">Reason: “${esc(x.reason)}” · ${esc(x.at)}</div>
      ${x.status === 'pending' ? (r.can_decide ? `<div class="row" style="margin-top:6px"><button class="btn o sm" data-rej="${x.id}" style="flex:1;border-color:var(--red);color:var(--red)">Reject</button><button class="btn sm" data-ok="${x.id}" style="flex:2;background:var(--blue)">Approve</button></div>` : '<span class="tag w" style="align-self:flex-start">Pending AM</span>')
        : `<div class="mini"><span class="tag ${x.status === 'approved' ? 'ok' : 'r'}">${x.status === 'approved' ? 'Approved' : 'Rejected'}</span> by ${esc(x.decided_by || '')} · ${esc(x.decided_at || '')}${x.note ? ' · “' + esc(x.note) + '”' : ''}</div>`}</div>`).join('')
      || '<div class="empty" style="padding:20px">Nothing here</div>';
  }
  root.addEventListener('click', async (e) => {
    const s = e.target.closest('#apSt button'); if (s) { st.status = s.dataset.s; load(); return; }
    const ok = e.target.closest('[data-ok]');
    if (ok) { ok.disabled = true; const r = await rpc('cr_decide', { p_token: me.token, p_id: Number(ok.dataset.ok), p_approve: true, p_note: null });
      if (r && r.ok) { toast('Approved'); load(); } else { toast(errText(r && r.error)); ok.disabled = false; } return; }
    const rj = e.target.closest('[data-rej]');
    if (rj) {
      const m = modal(`<h3>Reject request</h3><label class="lbl">Note to store (optional)<textarea class="in" name="note" rows="2"></textarea></label>`, async (f, close) => {
        const r = await rpc('cr_decide', { p_token: me.token, p_id: Number(rj.dataset.rej), p_approve: false, p_note: f.note.value });
        if (r && r.ok) { close(); toast('Rejected'); load(); return null; } return errText(r && r.error); });
      m.okLabel('Reject');
    }
  });
  load();
}

/* ---------- v4: store team (5 logins per store; AM marks a post vacant) ---------- */
function StoreTeamView(root, me) {
  root.innerHTML = `<div class="top"><h1>Store team</h1><div class="flt"><input id="tmQ" placeholder="Store code / name" style="width:180px"></div></div>
    <div class="note i">One login per post. People register themselves at first login inside the store. If someone left, mark the post vacant so the new person can register.</div><div id="tmList" class="k5" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr));align-items:start"></div>`;
  const $r = (s) => root.querySelector(s); let data = null;
  async function load() {
    $r('#tmList').innerHTML = '<div class="spin"></div>';
    data = await rpc('store_team', { p_token: me.token });
    if (!data || !data.ok) { $r('#tmList').innerHTML = `<div class="note r">${esc(errText(data && data.error))}</div>`; return; }
    paint();
  }
  function paint() {
    const q = $r('#tmQ').value.trim().toUpperCase();
    const stores = data.stores.filter((s) => !q || s.code.includes(q) || s.name.toUpperCase().includes(q));
    $r('#tmList').innerHTML = stores.slice(0, 120).map((s) => { const us = data.rows.filter((u) => u.store === s.code);
      return `<div class="panel" style="gap:0;padding:12px 14px"><h3 style="margin-bottom:6px">${esc(s.code)} · ${esc(s.name)} <span class="mini">${us.length}/5</span></h3>
        ${POSTS.map((p) => { const u = us.find((x) => x.post === p);
          return `<div class="slot"><div><b>${esc(p)}</b> · ${u ? `${esc(u.name)} <span class="mini">${esc(u.emp)}${u.last_login ? ' · ' + esc(u.last_login) : ''}</span>` : '—'}</div>
            ${u ? (data.can_vacate && !me.view_by ? `<button class="btn o sm" data-vac="${esc(u.emp)}" data-n="${esc(u.name)}" data-p="${esc(p)}" style="border-color:var(--amb);color:var(--amb)">Mark vacant</button>` : '<span class="tag ok">Active</span>') : '<span class="tag w">Vacant</span>'}</div>`; }).join('')}</div>`; }).join('')
      || '<div class="empty">No stores</div>';
  }
  $r('#tmQ').addEventListener('input', () => data && paint());
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-vac]'); if (!b) return;
    const m = modal(`<h3>Mark ${esc(b.dataset.p)} vacant</h3><p class="mini" style="margin:0">${esc(b.dataset.n)} (${esc(b.dataset.vac)}) will be logged out and cannot log in. Their history stays.</p>
      <label class="lbl">Reason (required)<select class="in" name="why"><option>Left the company</option><option>Transferred to another store</option><option>Wrong post registered</option><option>Other</option></select></label>
      <input class="in" name="more" placeholder="Details (optional)">`, async (f, close) => {
      const r = await rpc('store_vacate', { p_token: me.token, p_emp: b.dataset.vac, p_reason: f.why.value + (f.more.value.trim() ? ' · ' + f.more.value.trim() : '') });
      if (r && r.ok) { close(); toast(`${r.post} is now vacant`); load(); return null; } return errText(r && r.error); });
    m.okLabel('Mark vacant');
  });
  load();
}
