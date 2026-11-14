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

/* ---------- live dashboard with drill-down ---------- */
function LiveDash(root, me) {
  const st = { date: todayIST(), shift: istNow().getHours() < 14 ? 'M' : 'B', upto: '', zfm: '', am: '', path: [], data: null };
  root.innerHTML = `
    <div class="top"><h1>Live Dashboard</h1>
      <div class="flt"><input type="date" id="ldDate"><select id="ldZfm"></select><select id="ldAm"></select><button class="btn o sm" id="ldRefresh">↻</button><button class="btn o sm" id="ldXls">⬇ Excel</button></div></div>
    <div class="row"><div class="seg" id="ldShift" style="min-width:260px"><button data-s="M">Morning</button><button data-s="E">Evening</button><button data-s="B">Both</button></div>
      <div class="seg blue grow" id="ldCp">${CHECKPOINTS.map(([v, l]) => `<button data-v="${v}">${l}</button>`).join('')}</div></div>
    <div class="k5" id="ldKpi"></div>
    <div class="pies" id="ldPies"></div>
    <div class="crumb" id="ldCrumb"></div>
    <div class="tbl" id="ldTbl"></div>
    <div id="ldStore"></div>`;
  const $r = (s) => root.querySelector(s);
  $r('#ldDate').value = st.date; $r('#ldDate').max = todayIST();
  const paintSeg = () => {
    root.querySelectorAll('#ldShift button').forEach((b) => b.classList.toggle('on', b.dataset.s === st.shift));
    root.querySelectorAll('#ldCp button').forEach((b) => b.classList.toggle('on', b.dataset.v === st.upto));
  };

  async function load() {
    $r('#ldKpi').innerHTML = '<div class="spin"></div>';
    const r = await rpc('dash_overview', { p_token: me.token, p_date: st.date, p_shift: st.shift, p_upto: st.upto || null });
    if (!r || !r.ok) { $r('#ldKpi').innerHTML = `<div class="note r">${esc(errText(r && r.error))}</div>`; return; }
    st.data = r;
    const zfms = [...new Map(r.stores.filter((s) => s.zfm).map((s) => [s.zfm, s.zfm_name || s.zfm])).entries()];
    $r('#ldZfm').innerHTML = `<option value="">ZFM: All</option>` + zfms.map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
    $r('#ldZfm').value = st.zfm; $r('#ldZfm').hidden = zfms.length < 2;
    paintAm(); paint();
  }
  function paintAm() {
    const r = st.data; const ams = [...new Map(r.stores.filter((s) => s.am && (!st.zfm || s.zfm === st.zfm)).map((s) => [s.am, s.am_name || s.am])).entries()];
    $r('#ldAm').innerHTML = `<option value="">AM: All</option>` + ams.map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
    if (!ams.some(([k]) => k === st.am)) st.am = ''; $r('#ldAm').value = st.am; $r('#ldAm').hidden = ams.length < 2;
  }
  function scoped() {
    const r = st.data;
    const stores = r.stores.filter((s) => (!st.zfm || s.zfm === st.zfm) && (!st.am || s.am === st.am));
    const set = new Set(stores.map((s) => s.code));
    return { stores, rows: r.rows.filter((x) => set.has(x.s)) };
  }
  function paint() {
    const r = st.data, { stores, rows } = scoped();
    const tot = rows.reduce((a, x) => ({ req: a.req + x.req, p: a.p + x.p }), { req: 0, p: 0 });
    const byStore = {}; rows.forEach((x) => { const o = byStore[x.s] || (byStore[x.s] = { req: 0, p: 0 }); o.req += x.req; o.p += Math.min(x.p, x.req || x.p); });
    const full = Object.values(byStore).filter((o) => o.req && o.p >= o.req).length;
    const low = Object.values(byStore).filter((o) => o.req && pct(o.p, o.req) < 70).length;
    const tp = pct(tot.p, tot.req);
    $r('#ldKpi').innerHTML = kpi('Required', tot.req.toLocaleString('en-IN')) + kpi('Present', tot.p.toLocaleString('en-IN'), `<span class="p" style="color:${pctColor(tp)}">${tp}%</span>`)
      + kpi('Not punched', Math.max(tot.req - tot.p, 0).toLocaleString('en-IN')) + kpi('Stores at 100%', full) + kpi('Stores below 70%', low, '', 'var(--red)');
    $r('#ldPies').innerHTML = r.categories.map((c, i) => {
      const cr = rows.filter((x) => x.c === c.id); const q = cr.reduce((a, x) => a + x.req, 0), p = cr.reduce((a, x) => a + x.p, 0);
      return `<div class="pie">${donut(pct(p, q), DONUT_COLORS[i % DONUT_COLORS.length])}<small>${esc(catName(c))}</small><span>${p.toLocaleString('en-IN')} / ${q.toLocaleString('en-IN')}</span></div>`;
    }).join('');
    paintTable(stores, rows);
  }
  // level: zfm -> am -> store
  function level() {
    if (st.path.length) return st.path[st.path.length - 1].next;
    if (me.role === 'am') return 'store';
    if (me.role === 'zfm') return 'am';
    return 'zfm';
  }
  function paintTable(stores, rows) {
    const r = st.data, lv = level();
    let fStores = stores;
    st.path.forEach((p) => { fStores = fStores.filter((s) => s[p.key] === p.val); });
    const keyOf = { zfm: (s) => s.zfm || '—', am: (s) => s.am || '—', store: (s) => s.code };
    const nameOf = { zfm: (s) => s.zfm_name || s.zfm || '—', am: (s) => s.am_name || s.am || '—', store: (s) => `${s.code} · ${s.name}` };
    const groups = new Map();
    fStores.forEach((s) => { const k = keyOf[lv](s); if (!groups.has(k)) groups.set(k, { key: k, name: nameOf[lv](s), stores: [] }); groups.get(k).stores.push(s.code); });
    const lines = [...groups.values()].map((g) => {
      const set = new Set(g.stores); const gr = rows.filter((x) => set.has(x.s));
      const cells = r.categories.map((c) => { const cr = gr.filter((x) => x.c === c.id); return { req: cr.reduce((a, x) => a + x.req, 0), p: cr.reduce((a, x) => a + x.p, 0) }; });
      const req = cells.reduce((a, c) => a + c.req, 0), p = cells.reduce((a, c) => a + c.p, 0);
      return { ...g, cells, req, p, pc: pct(p, req) };
    }).sort((a, b) => a.pc - b.pc);
    const head = { zfm: 'ZFM', am: 'AM', store: 'Store' }[lv];
    $r('#ldTbl').innerHTML = `<table><thead><tr><th>${head}</th>${lv !== 'store' ? '<th>Stores</th>' : ''}${r.categories.map((c) => `<th>${esc(catName(c))}</th>`).join('')}<th>Present / Req</th><th>Total</th></tr></thead><tbody>
      ${lines.map((l) => `<tr class="click" data-k="${esc(l.key)}" data-n="${esc(l.name)}"><td>${esc(l.name)}</td>${lv !== 'store' ? `<td>${l.stores.length}</td>` : ''}
        ${l.cells.map((c) => `<td>${c.req || c.p ? `${c.p}/${c.req} ${pctCell(c.p, c.req)}` : '—'}</td>`).join('')}<td>${l.p}/${l.req}</td><td>${pctCell(l.p, l.req)}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">No data</td></tr>'}</tbody></table>`;
    const crumbs = [`<button data-i="-1">All</button>`].concat(st.path.map((p, i) => `<button data-i="${i}">${esc(p.name)}</button>`));
    $r('#ldCrumb').innerHTML = crumbs.join(' › ') + ` <span style="margin-left:8px">· tap a row to drill down</span>`;
    $r('#ldStore').innerHTML = '';
    st.lines = lines; st.lv = lv;
  }
  async function storeDetail(code, name) {
    $r('#ldStore').innerHTML = '<div class="spin"></div>';
    const r = await rpc('dash_store', { p_token: me.token, p_store: code, p_date: st.date, p_shift: st.shift });
    if (!r || !r.ok) { $r('#ldStore').innerHTML = `<div class="note r">${esc(errText(r && r.error))}</div>`; return; }
    const cname = (id) => { const c = st.data.categories.find((x) => x.id === id); return c ? catName(c) : id; };
    $r('#ldStore').innerHTML = `<div class="panel"><h3>${esc(name)} · ${fmtDate(st.date)}</h3>
      <div class="tbl"><table><thead><tr><th>Category</th><th>Brand</th><th>Vendor</th><th>Required</th><th>Present</th><th>Status</th></tr></thead><tbody>
      ${r.slots.map((s) => `<tr><td>${esc(cname(s.c))}</td><td>${esc(s.brand || '—')}</td><td>${esc(s.vendor || '—')}</td><td>${s.req}</td><td>${s.p}</td><td>${s.req > s.p ? `<span class="tag r">Missing ${s.req - s.p}</span>` : '<span class="tag ok">OK</span>'}</td></tr>`).join('')}</tbody></table></div>
      <h3>People</h3><div class="tbl"><table><thead><tr><th>Name</th><th>Code</th><th>Category</th><th>Vendor</th><th>IN</th><th>OUT</th><th>Hours</th><th>Device</th><th>Photo</th><th></th></tr></thead><tbody>
      ${r.present.map((a) => `<tr><td>${esc(a.name)}</td><td>${esc(a.code)}</td><td>${esc(cname(a.c))}${a.brand ? ' · ' + esc(a.brand) : ''}</td><td>${esc(a.vendor || '—')}</td><td>${a.first_in || '—'}</td><td>${a.last_out || '—'}</td><td>${a.hours ?? '—'}</td><td>${a.via_mod ? '<span class="tag w">MOD</span>' : 'Own'}</td><td>${a.photo === 'done' ? '📷' : a.photo === 'pending' ? '<span class="tag r">Missing</span>' : ''}</td>
        <td><a href="statement.html?s=${code}&a=${a.id}&from=${monthStart(st.date)}&to=${st.date}">Statement</a></td></tr>`).join('') || '<tr><td colspan="10" class="empty">Nobody has punched</td></tr>'}</tbody></table></div>
      ${r.regulars_missing.length ? `<h3>Regulars not here</h3><div>${r.regulars_missing.map((a) => `<span class="tag w" style="margin:2px">${esc(a.name)} · ${esc(cname(a.c))} · ${a.days}/7</span>`).join('')}</div>` : ''}</div>`;
    $r('#ldStore').scrollIntoView({ behavior: 'smooth' });
  }

  root.addEventListener('click', (e) => {
    const s = e.target.closest('#ldShift button'); if (s) { st.shift = s.dataset.s; paintSeg(); load(); return; }
    const c = e.target.closest('#ldCp button'); if (c) { st.upto = c.dataset.v; paintSeg(); load(); return; }
    const cr = e.target.closest('#ldCrumb button'); if (cr) { st.path = st.path.slice(0, Number(cr.dataset.i) + 1); paint(); return; }
    const tr = e.target.closest('#ldTbl tr.click'); if (tr) {
      const lv = st.lv;
      if (lv === 'store') { storeDetail(tr.dataset.k, tr.dataset.n); return; }
      st.path.push({ key: lv, val: tr.dataset.k, name: tr.dataset.n, next: lv === 'zfm' ? 'am' : 'store' }); paint(); return;
    }
  });
  $r('#ldDate').addEventListener('change', (e) => { st.date = e.target.value || todayIST(); st.upto = st.date === todayIST() ? st.upto : ''; paintSeg(); load(); });
  $r('#ldZfm').addEventListener('change', (e) => { st.zfm = e.target.value; st.path = []; paintAm(); paint(); });
  $r('#ldAm').addEventListener('change', (e) => { st.am = e.target.value; st.path = []; paint(); });
  $r('#ldRefresh').addEventListener('click', load);
  $r('#ldXls').addEventListener('click', () => {
    if (!st.data) return; const { stores, rows } = scoped(); const cats = st.data.categories;
    const out = stores.map((s) => { const o = { Store: s.code, Name: s.name, AM: s.am_name || s.am, ZFM: s.zfm_name || s.zfm };
      let q = 0, p = 0; cats.forEach((c) => { const x = rows.find((y) => y.s === s.code && y.c === c.id); o[`${c.name} req`] = x ? x.req : 0; o[`${c.name} present`] = x ? x.p : 0; q += x ? x.req : 0; p += x ? x.p : 0; });
      o['Total req'] = q; o['Total present'] = p; o['%'] = pct(p, q); return o; });
    downloadXlsx(out, `Attendance_${st.date}_${st.shift}${st.upto ? '_' + st.upto.replace(':', '') : ''}.xlsx`);
  });
  paintSeg(); load();
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
        <td>${u.pin_set || u.locked ? `<button class="btn o sm" data-reset="${esc(u.emp_code)}">Reset PIN</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No users</td></tr>'}</tbody></table>`;
  }
  $r('#prQ').addEventListener('input', paint);
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-reset]'); if (!b) return;
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Tap again to confirm'; b.classList.add('red'); b.classList.remove('o'); return; }
    b.disabled = true; const r = await rpc('reset_pin', { p_token: me.token, p_emp: b.dataset.reset });
    if (r && r.ok) { toast(`PIN reset for ${r.name}`); load(); } else { toast(errText(r && r.error)); b.disabled = false; }
  });
  load();
}

/* ---------- shell / nav ---------- */
function Shell(me, items, onPick) {
  const nav = $('#nav');
  nav.innerHTML = `<div class="brand"><img src="assets/logo.png" alt="Vishal Mega Mart"></div><div class="subt">3RD PARTY ATTENDANCE</div>
    <div class="who">${esc(me.name)}<small>${esc({ admin: 'Admin', am: 'AM', zfm: 'ZFM', hodept: 'HO ' + (me.dept || 'Dept') }[me.role] || me.role)} · ${esc(me.emp)}</small></div>
    ${items.map((it) => it.grp ? `<div class="grp">${esc(it.grp)}</div>` : `<button data-v="${it.id}">${esc(it.label)}</button>`).join('')}
    <button id="navLogout">Logout</button>
    <div class="bottom">${credit()}</div>`;
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]'); if (b) { pick(b.dataset.v); }
    if (e.target.id === 'navLogout') logout();
  });
  function pick(id) { nav.querySelectorAll('button[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === id)); location.hash = id; onPick(id); }
  const first = (location.hash || '').slice(1);
  const ids = items.filter((i) => i.id).map((i) => i.id);
  pick(ids.includes(first) ? first : ids[0]);
}
