/* VMM 3rd Party Attendance — shared views for manage.html and admin.html (v5)

   Needs assets/app.js (rpc, esc, pct, toast, modal, closeModal, downloadXlsx, todayIST, istNow, ymd, parseYmd,
   fmtDate, fmtDay, monthStart, catName, errText, POSTS, appShell, icon). Styles: assets/app.css + a small <style>
   injected once by this file (#dashCss).

   Every view renders into `root` (usually appShell().wrap). Page filters (date, ZFM/AM, store, Live, Refresh,
   Excel) go into the shell's sticky `.bar` when one is found next to `root` (root.closest('main') > .bar);
   otherwise they are drawn at the top of the view. A view cleans up its bar items and timers by itself when
   `root` is re-rendered (by another dash view or by any `root.innerHTML = …`).

   Public API (globals on window):
     LiveDash(root, me)                  → { reload() }   Live Dashboard (spec §4). Server scopes stores/categories:
                                                          HO Dept + RLPO are locked to their categories; AM default view = Store.
     ApprovalsView(root, me, opts?)      → { reload() }   Pending + History tabs. Decide buttons only when row.can_decide
                                                          (AM: non-SG kinds; RLPO: SG kinds as P / H / Reject(A)). Admin/HO/ZFM = view only.
                                                          cr_decide is always called with {p_token,p_id,p_approve,p_note,p_status}.
                                                          opts.onCount(n) and document event 'dash:pending' {detail:{n}} = decidable pending count.
     RlpoManualView(root, me)            → { reload() }   RLPO marks Manual present (P*) for a guard of his stores (rlpo_manual).
     StoreTeamView(root, me)             → { reload() }   AM/ZFM/Admin: store logins per post + Mark vacant (store_team / store_vacate).
                                                          RLPO / HO Dept: "My stores" list (from dash_overview).
     ChurnView(root, me)                 → { reload() }   Staff churn (churn RPC) + vendor ranking.
     PinReset(root, me, rowsLoader)      → { reload() }   Users & PIN list; rowsLoader() → Promise<rows[]>; reset_pin.
     dashPendingCount(me)                → Promise<int>   decidable pending requests (for the nav badge).
     Shell(me, items, onPick)            legacy v4 nav (kept as a stub over appShell; v5 pages call appShell directly).
     kpi(label, value, extra, color)     legacy v4 KPI tile html (old admin pages).
     CR_KIND, crChange(row)              request kind labels / one-line change text. */

(function () {
  'use strict';

  /* ---------- small helpers ---------- */
  const CP = [['', 'Live'], ['08:00', '8 AM'], ['10:00', '10 AM'], ['12:00', '12 PM'], ['14:00', '2 PM'], ['18:00', '6 PM']];
  const SHIFTS = [['M', 'Morning'], ['E', 'Evening'], ['B', 'Both']];
  const SHN = { M: 'Morning', E: 'Evening', B: 'Both shifts' };
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fmt = (n) => Number(n || 0).toLocaleString('en-IN');
  const pl = (n) => (n === 1 ? '' : 's');
  const col = (v) => (v >= 90 ? 'var(--ok)' : v >= 70 ? 'var(--amb)' : 'var(--red)');
  const heat = (v) => `<span class="heat ${v >= 90 ? 'h1' : v >= 70 ? 'h2' : 'h3'}">${v}%</span>`;
  const pct1 = (p, r) => (r > 0 ? Math.round((p / r) * 1000) / 10 : 0);
  const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
  const dayLbl = (s) => { const d = parseYmd(s); return [String(d.getDate()), DOW[d.getDay()]]; };
  const isWeekend = (s) => { const g = parseYmd(s).getDay(); return g === 0 || g === 6; };
  const errBox = (r) => `<div class="note r">${esc(errText(r && r.error))}</div>`;
  const spin = '<div class="spin"></div>';

  function css() {
    if (document.getElementById('dashCss')) return;
    const s = document.createElement('style'); s.id = 'dashCss';
    s.textContent = `.dv{display:flex;flex-direction:column;gap:12px;min-width:0}.dvbar{display:contents}
.dv .busy{opacity:.55;pointer-events:none;transition:opacity .15s}
.dv .sgrow{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.dv .reqc .act{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.dv .reqc .act input{width:180px}
.dv .kv{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.dv .slotc{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.dv .hint{font-size:11.5px;color:var(--mut)}
.dv svg.ch g[data-day]:hover rect{opacity:.85}
.dv .ftl{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
@media(max-width:760px){.dv .reqc .act input{width:100%}.dv .reqc .act{width:100%}.dv .ftl input.f,.dv .ftl select{flex:1 1 140px}}`;
    document.head.appendChild(s);
  }

  /* mount a view: own container in root, bar slot, auto cleanup when root is re-rendered */
  function mount(root, opts = {}) {
    css();
    root = typeof root === 'string' ? document.querySelector(root) : root;
    if (root._dashOff) root._dashOff();
    const el = document.createElement('div'); el.className = 'dv';
    root.innerHTML = ''; root.appendChild(el);
    const main = root.closest('main');
    const shellBar = main ? main.querySelector(':scope > .bar') : null;
    let bar;
    if (shellBar && !shellBar.hidden && opts.bar !== false) {
      shellBar.querySelectorAll(':scope > .dvbar').forEach((x) => x.remove());
      bar = document.createElement('span'); bar.className = 'dvbar'; shellBar.appendChild(bar);
    } else {
      bar = document.createElement('div'); bar.className = 'ftl card'; bar.style.padding = '8px 12px';
      if (opts.bar !== false) el.appendChild(bar);
    }
    const timers = [];
    const ctx = {
      el, bar, root,
      q: (s) => el.querySelector(s),
      alive: () => root.contains(el),
      every(fn, ms) { timers.push(setInterval(() => { if (ctx.alive()) fn(); }, ms)); },
      off() {
        timers.forEach(clearInterval); timers.length = 0;
        if (bar.parentNode && bar.classList.contains('dvbar')) bar.remove();
        mo.disconnect(); if (root._dashOff === ctx.off) delete root._dashOff;
      },
    };
    const mo = new MutationObserver(() => { if (!root.contains(el)) ctx.off(); });
    mo.observe(root, { childList: true });
    root._dashOff = ctx.off;
    return ctx;
  }

  /* =====================================================================
     LIVE DASHBOARD
     ===================================================================== */
  function LiveDash(root, me) {
    const V = mount(root);
    const defView = { am: 'store', rlpo: 'store', zfm: 'am' }[me.role] || 'zfm';
    const S = { date: todayIST(), shift: istNow().getHours() < 14 ? 'M' : 'B', upto: '', zfm: '', am: '', q: '', cat: '', alert: '',
      view: defView, path: [], d: null, week: null, y: null, store: null, seq: 0, lock: '', lines: [], lv: '' };

    V.bar.innerHTML = `<input class="f" type="date" data-f="date" max="${todayIST()}" value="${S.date}" aria-label="Date">
      <select data-f="zfm" hidden aria-label="ZFM"></select><select data-f="am" hidden aria-label="AM"></select>
      <input class="f" data-f="q" placeholder="Store code" maxlength="4" style="width:100px;text-transform:uppercase" aria-label="Store code">
      <span class="lvz" data-f="lvz"></span><button type="button" class="btn s sm" data-f="ref">↻ Refresh</button><button type="button" class="btn sm" data-f="xls">⬇ Excel</button>`;
    V.el.insertAdjacentHTML('beforeend', `<div class="dv" data-ld="main">${spin}</div><div data-ld="sd"></div>`);
    const mainEl = V.q('[data-ld="main"]'), sdEl = V.q('[data-ld="sd"]');
    const B = (k) => V.bar.querySelector(`[data-f="${k}"]`);

    const cats = () => (S.d ? S.d.categories : []);
    const cname = (id) => { const c = cats().find((x) => x.id === id); return c ? catName(c) : id; };
    const catOk = (c) => !S.cat || c === S.cat;
    const hasCat = (id) => cats().some((c) => c.id === id);
    const isToday = () => S.d && S.d.date === S.d.today;

    function scopeStores() {
      const q = S.q.trim().toUpperCase();
      let s = S.d.stores.filter((x) => (!S.zfm || x.zfm === S.zfm) && (!S.am || x.am === S.am) && (!q || x.code.startsWith(q)));
      S.path.forEach((p) => { s = s.filter((x) => (x[p.key] || '—') === p.val); });
      return s;
    }
    function rowsOf(d, set) { return (d.rows || []).filter((x) => set.has(x.s)); }
    function totals(rows) { return rows.filter((x) => catOk(x.c)).reduce((a, x) => ({ req: a.req + x.req, p: a.p + Math.min(x.p, x.req) }), { req: 0, p: 0 }); }
    function weekDates() { const end = (S.week && S.weekEnd) || S.date; return Array.from({ length: 7 }, (_, i) => addDays(end, i - 6)); }
    function weekFor(codes, cs) {
      const set = new Set(codes), r = Array(7).fill(0), p = Array(7).fill(0);
      (S.week || []).forEach((x) => { if (!set.has(x.s) || (cs && !cs.includes(x.c))) return; (x.r || []).forEach((q, i) => { r[i] += q || 0; p[i] += Math.min((x.p || [])[i] || 0, q || 0); }); });
      return { r, p };
    }
    function weekBoxes(w) {
      const ds = weekDates();
      return `<span class="hm">${w.r.map((q, i) => { if (!q) return `<i class="n" title="${esc(fmtDay(ds[i]))} · not required"></i>`;
        const v = pct(w.p[i], q); return `<i class="${v >= 90 ? 'g' : v >= 70 ? 'a' : 'r'}" title="${esc(fmtDay(ds[i]))} · ${v}%">${v}</i>`; }).join('')}</span>`;
    }
    function nobCats() { const c = ['HK', 'SEC'].filter(hasCat); return c.length ? c : cats().map((x) => x.id); }
    function nobLabel() { const c = ['HK', 'SEC'].filter(hasCat); return c.length === 2 ? 'HK / Security · nobody' : c[0] === 'HK' ? 'HK · nobody' : c[0] === 'SEC' ? 'Security · nobody' : 'Nobody in a dept'; }
    function alertsOn() {
      const d = S.d; if (d.date < d.today) return true; if (d.date > d.today) return false;
      return d.now >= (S.shift === 'E' ? d.alert_e : d.alert_m);
    }
    function alertStores(k) {
      const d = S.d, sc = scopeStores(), set = new Set(sc.map((s) => s.code)), rows = rowsOf(d, set);
      const zero = (cs) => rows.filter((x) => cs.includes(x.c) && x.req > 0 && x.p === 0).map((x) => ({ s: x.s, info: `${cname(x.c)} 0 of ${x.req}`, miss: x.req }));
      if (k === 'hk') return zero(['HK']);
      if (k === 'sec') return zero(['SEC']);
      if (k === 'nob') {
        const m = new Map(); zero(nobCats().filter(catOk)).forEach((x) => { const o = m.get(x.s); if (o) { o.info += ' · ' + x.info; o.miss += x.miss; } else m.set(x.s, { ...x }); });
        return [...m.values()];
      }
      if (k === 'mp') return (d.mispunch || []).filter((x) => set.has(x.s)).map((x) => ({ s: x.s, info: `${x.n} mis-punch · ${(x.names || []).join(', ')}`, miss: x.n }));
      if (k === 'split') return sc.filter((s) => s.hk_split_set === false).map((s) => ({ s: s.code, info: 'HK split (Morning / Evening) not entered', miss: 0 }));
      if (k === 'photo') {
        const m = new Map(); (d.photo_due || []).filter((x) => set.has(x.s) && catOk(x.c)).forEach((x) => { const o = m.get(x.s) || { s: x.s, miss: 0 }; o.miss += x.n; o.info = `${o.miss} selfie due`; m.set(x.s, o); });
        return [...m.values()];
      }
      if (k === 'low7') {
        const by = {}; rows.filter((x) => catOk(x.c)).forEach((x) => { const o = by[x.s] || (by[x.s] = { q: 0, p: 0 }); o.q += x.req; o.p += Math.min(x.p, x.req); });
        return Object.entries(by).filter(([, o]) => o.q && pct(o.p, o.q) < d.low_pct).map(([s, o]) => ({ s, info: `${pct(o.p, o.q)}% now`, miss: o.q - o.p }));
      }
      if (k === 'low') {
        const n = Math.max(1, Math.min(Number(d.low_days) || 3, isToday() ? 6 : 7)), last = isToday() ? 5 : 6;
        const idx = Array.from({ length: n }, (_, j) => last - n + 1 + j);
        const by = {}; (S.week || []).filter((x) => set.has(x.s) && catOk(x.c)).forEach((x) => {
          const o = by[x.s] || (by[x.s] = { r: Array(7).fill(0), p: Array(7).fill(0) }); (x.r || []).forEach((q, i) => { o.r[i] += q || 0; o.p[i] += Math.min((x.p || [])[i] || 0, q || 0); }); });
        return Object.entries(by).filter(([, o]) => idx.every((i) => o.r[i] > 0 && pct(o.p[i], o.r[i]) < d.low_pct))
          .map(([s, o]) => ({ s, info: idx.map((i) => `${pct(o.p[i], o.r[i])}%`).join(' · '), miss: 0 }));
      }
      return [];
    }
    const ALN = () => ({ hk: 'HK nobody', sec: 'Security nobody', mp: 'SG mis-punch', split: 'HK split not set', photo: 'Selfie due',
      low: `Below ${S.d.low_pct}% · ${S.d.low_days} days`, low7: `Below ${S.d.low_pct}% now`, nob: nobLabel() });

    /* ---------- load ---------- */
    async function load() {
      const seq = ++S.seq;
      if (S.d) mainEl.classList.add('busy'); else mainEl.innerHTML = spin;
      const [r, w] = await Promise.all([
        rpc('dash_overview', { p_token: me.token, p_date: S.date, p_shift: S.shift, p_upto: S.upto || null }),
        rpc('dash_week', { p_token: me.token, p_end: S.date, p_shift: S.shift })]);
      if (seq !== S.seq || !V.alive()) return;
      mainEl.classList.remove('busy');
      if (!r || !r.ok) { mainEl.innerHTML = errBox(r); return; }
      S.d = r; S.week = w && w.ok ? w.rows || [] : []; S.weekEnd = w && w.ok ? w.end || S.date : S.date; S.y = null;
      if (S.upto && r.date === r.today && S.upto > r.now) S.upto = '';
      S.lock = r.categories.length === 1 ? r.categories[0].id : '';
      if (S.lock) S.cat = S.lock; else if (S.cat && !hasCat(S.cat)) S.cat = '';
      fillSelects(); paint();
      if (S.store) storeDetail(S.store, false);
      // "vs yesterday at the same time": same checkpoint, or now when live today; past day live = end of day
      const yUpto = S.upto || (r.date === r.today ? r.now : null);
      rpc('dash_overview', { p_token: me.token, p_date: addDays(r.date, -1), p_shift: S.shift, p_upto: yUpto }).then((y) => {
        if (seq !== S.seq || !V.alive()) return; S.y = y && y.ok ? y : false; paintKpis();
      });
    }
    function fillSelects() {
      const st = S.d.stores, opt = (arr, all, v) => `<option value="">${all}</option>` + arr.map(([k, n]) => `<option value="${esc(k)}"${k === v ? ' selected' : ''}>${esc(n)}</option>`).join('');
      const zfms = [...new Map(st.filter((s) => s.zfm).map((s) => [s.zfm, s.zfm_name || s.zfm])).entries()].sort((a, b) => String(a[1]).localeCompare(b[1]));
      if (!zfms.some(([k]) => k === S.zfm)) S.zfm = '';
      B('zfm').innerHTML = opt(zfms, 'ZFM: All', S.zfm); B('zfm').hidden = zfms.length < 2 || !['admin', 'hodept'].includes(me.role);
      const ams = [...new Map(st.filter((s) => s.am && (!S.zfm || s.zfm === S.zfm)).map((s) => [s.am, s.am_name || s.am])).entries()].sort((a, b) => String(a[1]).localeCompare(b[1]));
      if (!ams.some(([k]) => k === S.am)) S.am = '';
      B('am').innerHTML = opt(ams, 'AM: All', S.am); B('am').hidden = ams.length < 2 || me.role === 'am' || me.role === 'rlpo';
      B('date').value = S.date;
      const live = S.d.date === S.d.today && !S.upto, cpl = (CP.find((c) => c[0] === S.upto) || CP[0])[1];
      B('lvz').innerHTML = `<span class="dot ${live ? '' : 'off'}"></span>${live ? `Live · ${esc(S.d.now)}` : S.d.date === S.d.today ? `As of ${cpl}` : `${S.upto ? 'As of ' + cpl : 'End of day'} · ${esc(fmtDay(S.d.date))}`}`;
    }

    /* ---------- paint ---------- */
    function views() {
      return [['zfm', 'ZFM'], ['am', 'AM'], ['store', 'Store'], ['dept', 'Dept']].filter(([v]) =>
        !((me.role === 'am' || me.role === 'rlpo') && (v === 'zfm' || v === 'am')) && !(me.role === 'zfm' && v === 'zfm') && !(S.lock && v === 'dept'));
    }
    function paint() {
      if (!S.d) return;
      const vs = views(); if (!vs.some((v) => v[0] === S.view)) S.view = vs.some((v) => v[0] === defView) ? defView : vs[0][0];
      const d = S.d, cs = cats(), today = isToday();
      const tsel = `<div class="seg" title="Dashboard as of a fixed time">${CP.map(([v, l]) => { const pend = today && v && v > d.now;
        return `<button type="button" data-cp="${v}" class="${S.upto === v ? 'on' : ''}"${pend ? ' disabled title="Not reached yet"' : ''}>${l}</button>`; }).join('')}</div>`;
      const AL = [['hk', 'r'], ['sec', 'r'], ['mp', 'a'], ['split', 'a'], ['low', 'a'], ['photo', 'i']].filter(([k]) =>
        !(k === 'hk' && (!hasCat('HK') || !catOk('HK'))) && !(k === 'split' && (!hasCat('HK') || !catOk('HK')))
        && !(k === 'sec' && (!hasCat('SEC') || !catOk('SEC'))) && !(k === 'mp' && (!hasCat('SEC') || !catOk('SEC'))));
      const names = ALN();
      mainEl.innerHTML = `
      <div class="toolrow"><div class="pills">${S.lock ? `<span class="pill on">${esc(cname(S.lock))}</span>`
        : `<button type="button" class="pill ${!S.cat ? 'on' : ''}" data-cat="">All depts</button>${cs.map((c) => `<button type="button" class="pill ${S.cat === c.id ? 'on' : ''}" data-cat="${esc(c.id)}">${esc(catName(c))}</button>`).join('')}`}</div>
        <div class="pills"><div class="seg">${SHIFTS.map(([v, l]) => `<button type="button" data-sh="${v}" class="${S.shift === v ? 'on' : ''}">${l}</button>`).join('')}</div>${tsel}</div></div>
      <div class="kpis" data-ld="kpis"></div>
      <div class="astrip"><span class="t">⚡ Action needed</span>${alertsOn() ? AL.map(([k, c]) => { const l = alertStores(k), n = k === 'photo' || k === 'mp' ? l.reduce((a, x) => a + x.miss, 0) : l.length;
        return `<button type="button" class="ach ${c} ${S.alert === k ? 'on' : ''} ${n ? '' : 'zero'}" data-al="${k}" title="${k === 'mp' ? 'Guards with IN but no OUT on ' + esc(fmtDay(d.mispunch_date || d.date)) : ''}">${esc(names[k])} <b>${n}</b></button>`; }).join('')
        : `<span class="sub" style="margin:0">Starts at ${esc(S.shift === 'E' ? d.alert_e : d.alert_m)} for this shift (Settings)</span>`}</div>
      <div class="cols">
        <div class="card"><h2>Last 7 days</h2><div class="sub">Present % of required, end of day. ${today ? 'Today is live. ' : ''}Lighter bars are Sat and Sun. Click a bar to open that day.</div><div data-ld="trend"></div></div>
        <div class="card"><h2>Dept-wise · required vs present</h2><div class="sub">Dashed box = required · bar = present.${S.lock ? '' : ' Click a dept to filter.'}</div><div data-ld="lad"></div></div>
      </div>
      <div class="card" data-ld="gap"></div>`;
      const stores = scopeStores(), set = new Set(stores.map((s) => s.code)), rows = rowsOf(d, set);
      paintKpis(); paintTrend(stores); paintLadder(rows); paintGap(stores, rows);
    }
    function paintKpis() {
      const box = V.q('[data-ld="kpis"]'); if (!box || !S.d) return;
      const d = S.d, stores = scopeStores(), set = new Set(stores.map((s) => s.code)), rows = rowsOf(d, set);
      const tot = totals(rows), tp = pct(tot.p, tot.req), tp1 = pct1(tot.p, tot.req);
      const by = {}; rows.filter((x) => catOk(x.c)).forEach((x) => { const o = by[x.s] || (by[x.s] = { req: 0, p: 0 }); o.req += x.req; o.p += Math.min(x.p, x.req); });
      const withReq = Object.values(by).filter((o) => o.req), full = withReq.filter((o) => o.p >= o.req).length;
      const low = alertStores('low7').length, nob = alertStores('nob').length;
      let dl = '<span class="hint">vs yesterday …</span>';
      if (S.y === false) dl = '';
      else if (S.y) {
        const yt = totals(rowsOf(S.y, set)); const y1 = pct1(yt.p, yt.req), v = +(tp1 - y1).toFixed(1);
        const at = S.upto ? 'at ' + CP.find((c) => c[0] === S.upto)[1] : isToday() ? 'at same time' : '';
        dl = yt.req ? `<b style="color:${v >= 0 ? 'var(--ok)' : 'var(--red)'}">${v >= 0 ? '▲ +' : '▼ '}${v} pts</b> vs ${isToday() ? 'yesterday' : 'day before'} ${at}` : '';
      }
      const tg = tp >= 90 ? 'ok' : tp >= 70 ? 'amb' : 'red';
      box.innerHTML = `
        <div class="kpi"><span class="l">Required</span><span class="v">${fmt(tot.req)}</span><span class="d">${stores.length} store${pl(stores.length)} · ${SHN[S.shift]}</span></div>
        <div class="kpi"><span class="l">Present</span><span class="v">${fmt(tot.p)} <span class="tg ${tg}" style="vertical-align:4px">${tp}%</span></span><span class="d">${dl}</span><div class="track"><i style="width:${Math.min(tp, 100)}%;background:${col(tp)}"></i></div></div>
        <div class="kpi"><span class="l">Not punched</span><span class="v" style="color:var(--red)">${fmt(Math.max(tot.req - tot.p, 0))}</span><span class="d">${tot.req ? (100 - tp1).toFixed(1) : 0}% of required</span></div>
        <div class="kpi"><span class="l">Stores at 100%</span><span class="v" style="color:var(--ok)">${full}</span><span class="d">of ${withReq.length} with requirement</span></div>
        <button type="button" class="kpi fl a ${S.alert === 'low7' ? 'on' : ''}" data-al="low7"><span class="l">Stores below ${esc(d.low_pct)}%</span><span class="v" style="color:var(--amb)">${low} store${pl(low)}</span><span class="go">${S.alert === 'low7' ? 'Showing ✓ · click to clear' : 'Click to filter stores'}</span></button>
        <button type="button" class="kpi fl r ${S.alert === 'nob' ? 'on' : ''}" data-al="nob"><span class="l">${esc(nobLabel())}</span><span class="v" style="color:var(--red)">${nob} store${pl(nob)}</span><span class="go">${S.alert === 'nob' ? 'Showing ✓ · click to clear' : 'Click to filter stores'}</span></button>`;
    }
    function paintTrend(stores) {
      const w = weekFor(stores.map((s) => s.code), S.cat ? [S.cat] : null), ds = weekDates();
      const v = w.r.map((q, i) => (q ? pct(w.p[i], q) : null));
      const prev = v.slice(0, 6).filter((x) => x != null), avg = prev.length ? +(prev.reduce((a, b) => a + b, 0) / prev.length).toFixed(1) : null;
      const W = 560, H = 190, bw = 44, gap = (W - 40 - bw * 7) / 6, y = (x) => H - 28 - (Math.min(x, 100) / 100) * (H - 50);
      V.q('[data-ld="trend"]').innerHTML = `<svg class="ch" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;margin-top:6px" role="img" aria-label="Present % for the last 7 days">
        ${[0, 25, 50, 75, 100].map((t) => `<line x1="30" x2="${W}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="24" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
        ${avg != null ? `<line x1="30" x2="${W}" y1="${y(avg)}" y2="${y(avg)}" stroke="var(--grey)" stroke-dasharray="4 4"/><text x="${W}" y="10" text-anchor="end">- - - ${prev.length}-day avg ${avg}%</text>` : ''}
        ${v.map((x, i) => { const X = 36 + i * (bw + gap), dd = dayLbl(ds[i]), last = i === 6, c = last ? 'var(--acc)' : isWeekend(ds[i]) ? 'var(--wk)' : 'var(--pri)';
          return `<g data-day="${ds[i]}" style="cursor:pointer"><title>${esc(fmtDate(ds[i]))}${x == null ? ' · not required' : ` · ${x}% (${fmt(w.p[i])} / ${fmt(w.r[i])})`}</title>
            <rect x="${X}" y="0" width="${bw}" height="${H - 28}" fill="transparent"/>
            ${x == null ? `<text x="${X + bw / 2}" y="${y(0) - 6}" text-anchor="middle">—</text>` : `<rect class="br" x="${X}" y="${y(x)}" width="${bw}" height="${Math.max(y(0) - y(x), 1)}" rx="4" fill="${c}"/><text class="b" x="${X + bw / 2}" y="${y(x) - 6}" text-anchor="middle">${x}</text>`}
            <text x="${X + bw / 2}" y="${H - 14}" text-anchor="middle"${last ? ' class="b"' : ''}>${dd[0]}</text><text x="${X + bw / 2}" y="${H - 2}" text-anchor="middle">${dd[1]}</text></g>`; }).join('')}</svg>`;
    }
    function paintLadder(rows) {
      const cs = S.lock ? cats().filter((c) => c.id === S.lock) : cats();
      const sums = cs.map((c) => { const cr = rows.filter((x) => x.c === c.id), q = cr.reduce((a, x) => a + x.req, 0), p = cr.reduce((a, x) => a + Math.min(x.p, x.req), 0);
        return { c, q, p, v: pct(p, q), z: new Set(cr.filter((x) => x.req && !x.p).map((x) => x.s)).size }; });
      const mx = Math.max(1, ...sums.map((s) => Math.max(s.q, s.p)));
      let sg = '';
      const g = S.d.sg_counts;
      if (g && hasCat('SEC') && catOk('SEC')) {
        const filtered = S.zfm || S.am || S.q || S.path.length;
        sg = `<div class="sub" style="margin-top:12px;font-weight:700">Security ${S.d.sg_final ? '· final (hours rule)' : '· live (punched IN)'}${filtered ? ' · all your stores' : ''}</div>
          <div class="sgrow"><span class="tg ok" title="Present">P ${fmt(g.P)}</span><span class="tg acc" title="Manual present by RLPO">P* ${fmt(g.Pstar)}</span><span class="tg amb" title="Half day">H ${fmt(g.H)}</span><span class="tg red" title="Absent">A ${fmt(g.A)}</span><span class="tg grey" title="IN without OUT: counts Absent until RLPO decides">MP ${fmt(g.MP)} (A till RLPO)</span></div>`;
      }
      V.q('[data-ld="lad"]').innerHTML = `<div class="lad">${sums.map((s) => `<button type="button" class="rn ${S.cat === s.c.id ? 'on' : ''}" data-cat="${S.lock ? esc(s.c.id) : S.cat === s.c.id ? '' : esc(s.c.id)}">${esc(catName(s.c))}</button>
        <div class="stack"><span class="bm" style="width:${(s.q / mx) * 100}%"></span><span class="pr" style="width:${(s.p / mx) * 100}%;background:${col(s.v)}"></span></div>
        <div class="nums">${s.q ? `<b>${fmt(s.p)}</b> / ${fmt(s.q)} · <b style="color:${col(s.v)}">${s.v}%</b>` : 'Not required'}${s.z ? `<br><span style="color:var(--red)">${s.z} store${pl(s.z)} with 0</span>` : ''}</div>`).join('') || '<span class="sub">No departments</span>'}</div>
        <div class="leg"><span><i style="border:1.5px dashed var(--grey);height:9px"></i>Required</span><span><i style="background:var(--ok)"></i>90%+</span><span><i style="background:var(--amb)"></i>70–90%</span><span><i style="background:var(--red)"></i>Below 70%</span></div>${sg}`;
    }
    function level() { return S.alert ? 'store' : S.path.length ? S.path[S.path.length - 1].next : S.view; }
    function gapLines(stores, rows) {
      const lv = level();
      if (lv === 'dept') {
        return cats().filter((c) => catOk(c.id)).map((c) => { const cr = rows.filter((x) => x.c === c.id), req = cr.reduce((a, x) => a + x.req, 0), p = cr.reduce((a, x) => a + Math.min(x.p, x.req), 0);
          return { key: c.id, name: catName(c), n: new Set(cr.filter((x) => x.req).map((x) => x.s)).size, req, p, pc: pct(p, req), zero: new Set(cr.filter((x) => x.req && !x.p).map((x) => x.s)).size, wk: weekFor(stores.map((s) => s.code), [c.id]) }; })
          .filter((l) => l.req || l.p);
      }
      let fs = stores;
      if (S.alert) { const m = new Map(alertStores(S.alert).map((x) => [x.s, x])); fs = stores.filter((s) => m.has(s.code)).map((s) => ({ ...s, _i: m.get(s.code).info })); }
      const K = { zfm: (s) => s.zfm || '—', am: (s) => s.am || '—', store: (s) => s.code };
      const N = { zfm: (s) => s.zfm_name || s.zfm || '—', am: (s) => s.am_name || s.am || '—', store: (s) => s.name || '' };
      const g = new Map();
      fs.forEach((s) => { const k = K[lv](s); if (!g.has(k)) g.set(k, { key: k, name: N[lv](s), zfm: s.zfm_name || '—', am: s.am_name || '—', stores: [], info: s._i }); g.get(k).stores.push(s.code); });
      return [...g.values()].map((x) => { const st = new Set(x.stores), gr = rows.filter((r) => st.has(r.s) && catOk(r.c));
        const req = gr.reduce((a, r) => a + r.req, 0), p = gr.reduce((a, r) => a + Math.min(r.p, r.req), 0);
        return { ...x, n: x.stores.length, req, p, pc: pct(p, req), zero: new Set(gr.filter((r) => r.req && !r.p).map((r) => r.s)).size, wk: weekFor(x.stores, S.cat ? [S.cat] : null) }; });
    }
    function paintGap(stores, rows) {
      const lv = level(), lines = gapLines(stores, rows).sort((a, b) => (a.req ? a.pc : 101) - (b.req ? b.pc : 101) || b.req - a.req);
      S.lines = lines; S.lv = lv;
      const head = { zfm: 'ZFM', am: 'AM', store: 'Store', dept: 'Dept' }[lv];
      const chips = [S.cat && !S.lock && `<button type="button" class="chip" data-clr="cat">${esc(cname(S.cat))} ✕</button>`,
        S.alert && `<button type="button" class="chip" data-clr="alert">${esc(ALN()[S.alert])} ✕</button>`,
        S.q && `<button type="button" class="chip" data-clr="q">Store ${esc(S.q.toUpperCase())} ✕</button>`].filter(Boolean).join(' ');
      V.q('[data-ld="gap"]').innerHTML = `<div class="hd"><div><h2>Where the gaps are</h2><div class="sub">Lowest % first · click a row to ${lv === 'store' ? 'see people' : 'open'}</div></div>
        <div class="pills"><span class="sub" style="margin:0 4px 0 0;font-weight:700">VIEW BY</span>${views().map(([v, l]) => `<button type="button" class="pill ${S.view === v && !S.alert && !S.path.length ? 'on' : ''}" data-vw="${v}">${l}</button>`).join('')}</div></div>
        <div class="bc" style="margin-top:8px"><button type="button" data-bc="-1">All</button>${S.path.map((p, i) => ` › <button type="button" data-bc="${i}">${esc(p.name)}</button>`).join('')} ${chips}</div>
        <div class="tw"><table><thead><tr><th class="l">${head}</th>${lv === 'am' ? '<th class="l">ZFM</th>' : ''}${lv === 'store' && me.role !== 'am' ? '<th class="l">AM</th>' : ''}${lv !== 'store' ? '<th>Stores</th>' : ''}<th>Required</th><th>Present</th><th>Gap</th><th>%</th><th class="l">${lv === 'store' ? 'Status' : 'Stores with a gap'}</th>${S.alert ? '<th class="l">Why</th>' : ''}<th class="l">Last 7 days (%)</th></tr></thead><tbody>
        ${lines.map((l) => `<tr class="click" data-k="${esc(l.key)}" data-n="${esc(lv === 'store' ? l.key + ' · ' + l.name : l.name)}"><td class="l"><span class="lk">${esc(lv === 'store' ? l.key : l.name)}</span>${lv === 'store' ? ' ' + esc(l.name) : ''}</td>${lv === 'am' ? `<td class="l">${esc(l.zfm)}</td>` : ''}${lv === 'store' && me.role !== 'am' ? `<td class="l">${esc(l.am)}</td>` : ''}${lv !== 'store' ? `<td>${l.n}</td>` : ''}
          <td>${fmt(l.req)}</td><td>${fmt(l.p)}</td><td style="color:${l.req - l.p ? 'var(--red)' : 'var(--mut)'};font-weight:700">${l.req - l.p ? '-' + fmt(l.req - l.p) : '0'}</td><td>${l.req ? heat(l.pc) : '—'}</td>
          <td class="l">${l.zero ? `<span class="tg red">${lv === 'store' ? (S.lock ? 'Nobody' : 'Nobody in a dept') : l.zero + ' store' + pl(l.zero)}</span>` : lv === 'store' ? (!l.req ? '<span class="tg grey">Not required</span>' : l.pc >= 90 ? '<span class="tg ok">On track</span>' : '<span class="tg amb">Short</span>') : '—'}</td>${S.alert ? `<td class="l">${esc(l.info || '')}</td>` : ''}
          <td class="l">${weekBoxes(l.wk)}</td></tr>`).join('') || '<tr><td colspan="10" class="l" style="color:var(--mut)">No stores here</td></tr>'}</tbody></table></div>`;
    }

    /* ---------- store detail (Security = status only, never times) ---------- */
    const SGT = { P: '<span class="tg ok">P</span>', H: '<span class="tg amb">H · half day</span>', A: '<span class="tg red">A</span>',
      MP: '<span class="tg grey">MP · with RLPO</span>', 'P*': '<span class="tg acc">P* · RLPO exception</span>', IN: '<span class="tg info">On duty</span>' };
    async function storeDetail(code, scroll = true) {
      S.store = code;
      sdEl.innerHTML = `<div class="card">${spin}</div>`;
      const date = S.date, shift = S.shift;
      const r = await rpc('dash_store', { p_token: me.token, p_store: code, p_date: date, p_shift: shift });
      if (!V.alive() || S.store !== code || date !== S.date || shift !== S.shift) return;
      if (!r || !r.ok) { sdEl.innerHTML = `<div class="card">${errBox(r)}</div>`; return; }
      const s = (S.d && S.d.stores.find((x) => x.code === code)) || {};
      const gk = (c, b) => c + '|' + (b || ''); const groups = new Map();
      (r.slots || []).filter((x) => catOk(x.c)).forEach((x) => groups.set(gk(x.c, x.brand), { c: x.c, brand: x.brand || '', vendor: x.vendor || '', req: x.req, p: x.p, co: x.co, ppl: [] }));
      (r.present || []).filter((a) => catOk(a.c)).forEach((a) => { const k = gk(a.c, a.brand); if (!groups.has(k)) groups.set(k, { c: a.c, brand: a.brand || '', vendor: a.vendor || '', req: 0, p: 0, ppl: [] }); groups.get(k).ppl.push(a); });
      const stm = (a) => `<a class="lk" href="statement.html?s=${encodeURIComponent(code)}&a=${encodeURIComponent(a.id)}&from=${monthStart(date)}&to=${date}">Statement</a>`;
      const photo = (a) => (a.photo === 'done' ? `📷 ${a.live === 'fail' ? '<span class="tg red">Live ✕</span>' : a.live === 'pass' ? '<span class="tg ok">Live ✓</span>' : ''} ` : a.photo === 'pending' ? '<span class="tg red">Selfie due</span> ' : '');
      const body = [...groups.values()].map((g) => {
        const sec = g.c === 'SEC', n = Math.max(g.ppl.length, 1);
        const pr = sec ? g.p : Math.max(g.p, 0);
        const head = `<td class="l" rowspan="${n}" style="vertical-align:top"><b>${esc(cname(g.c))}</b>${g.brand ? `<small>${esc(g.brand)}</small>` : ''}${g.vendor ? `<small>Vendor: ${esc(g.vendor)}</small>` : ''}${sec ? `<small>${esc(r.sg_set || s.sg_set || 8)}-hr set · RLPO ${esc(r.rlpo_name || s.rlpo_name || '—')}</small>` : ''}${g.co ? `<small>${g.co} comp-off</small>` : ''}</td>
          <td rowspan="${n}" style="vertical-align:top">${g.req}</td><td rowspan="${n}" style="vertical-align:top">${pr}</td>
          <td class="l" rowspan="${n}" style="vertical-align:top">${g.req > pr ? `<span class="tg red">Missing ${g.req - pr}</span>` : '<span class="tg ok">OK</span>'}</td>`;
        if (!g.ppl.length) return `<tr>${head}<td class="l" colspan="7" style="color:var(--red);font-weight:700">${g.req ? 'Nobody has punched' : '—'}</td></tr>`;
        return g.ppl.map((a, i) => `<tr>${i ? '' : head}<td class="l">${esc(a.name)}</td><td class="l">${esc(a.code || '')}</td>${sec
          ? `<td class="l" colspan="3">${SGT[a.st] || (a.st ? `<span class="tg grey">${esc(a.st)}</span>` : SGT.IN)}</td>`
          : `<td>${esc(a.first_in || '—')}</td><td>${esc(a.last_out || '—')}</td><td>${a.hours ?? '—'}</td>`}
          <td class="l">${a.via_mod ? '<span class="tg amb">Store</span>' : 'Own'}</td><td class="l">${sec ? '' : photo(a)}${stm(a)}</td></tr>`).join('');
      }).join('');
      const hk = r.hk && hasCat('HK') && catOk('HK') ? (r.hk.set ? ` · HK split M ${r.hk.morning} / E ${r.hk.evening}` : ` · <span style="color:var(--amb)">HK split not set (total ${r.hk.total} in Morning)</span>`) : '';
      const regs = (r.regulars_missing || []).filter((a) => catOk(a.c));
      sdEl.innerHTML = `<div class="card"><div class="hd"><div><h2>${esc(code)} · ${esc(r.store_name || s.name || '')}</h2>
        <div class="sub">${s.am_name ? 'AM ' + esc(s.am_name) + ' · ' : ''}${s.zfm_name ? 'ZFM ' + esc(s.zfm_name) + ' · ' : ''}${esc(fmtDate(date))} · ${SHN[shift]}${hk}${hasCat('SEC') && catOk('SEC') ? ' · Security shows status only (no timing)' : ''}</div></div>
        <button type="button" class="btn s sm" data-x="closesd">✕ Close</button></div>
        <div class="tw"><table><thead><tr><th class="l">Dept</th><th>Required</th><th>Present</th><th class="l">Status</th><th class="l">Name</th><th class="l">Code</th><th>IN</th><th>OUT</th><th>Hours</th><th class="l">Phone</th><th class="l">Photo · Statement</th></tr></thead>
        <tbody>${body || '<tr><td class="l" colspan="11" style="color:var(--mut)">Nothing required in this shift, nobody punched</td></tr>'}</tbody></table></div>
        ${regs.length ? `<div class="sub" style="margin-top:10px;font-weight:700">Regulars not here today</div><div class="kv" style="margin-top:6px">${regs.map((a) => `<span class="tg amb">${esc(a.name)} · ${esc(cname(a.c))} · came ${a.days}/7</span>`).join('')}</div>` : ''}</div>`;
      if (scroll) sdEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function excel() {
      if (!S.lines.length) return toast('Nothing to export');
      const H = { zfm: 'ZFM', am: 'AM', store: 'Store', dept: 'Dept' }[S.lv], ds = weekDates();
      downloadXlsx(S.lines.map((l) => ({ [H]: S.lv === 'store' ? l.key : l.name, ...(S.lv === 'store' ? { 'Store name': l.name, AM: l.am, ZFM: l.zfm } : {}), ...(S.lv === 'am' ? { ZFM: l.zfm } : {}),
        ...(S.lv !== 'store' ? { Stores: l.n } : {}), Required: l.req, Present: l.p, Gap: l.req - l.p, '%': l.req ? l.pc : '', 'Stores with 0': l.zero,
        ...(S.alert ? { Why: l.info || '' } : {}), ...Object.fromEntries(l.wk.r.map((q, i) => [`${fmtDay(ds[i])} %`, q ? pct(l.wk.p[i], q) : ''])) })),
      `3PA_Live_${H}_${S.date}_${S.shift}${S.upto ? '_' + S.upto.replace(':', '') : ''}${S.cat ? '_' + S.cat : ''}.xlsx`, 'Live');
    }

    /* ---------- events ---------- */
    V.el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-cat],[data-sh],[data-cp],[data-al],[data-vw],[data-bc],[data-clr],[data-day],[data-x],tr.click');
      if (!t || !S.d) return;
      const D = t.dataset;
      if (D.cat != null) { if (S.lock) return; S.cat = D.cat; S.alert = ''; paint(); return; }
      if (D.sh) { if (S.shift !== D.sh) { S.shift = D.sh; load(); } return; }
      if (D.cp != null) { if (t.disabled) return; S.upto = D.cp; load(); return; }
      if (D.al) { S.alert = S.alert === D.al ? '' : D.al; S.path = []; paint(); return; }
      if (D.vw) { S.view = D.vw; S.path = []; S.alert = ''; paint(); return; }
      if (D.bc != null) { S.path = S.path.slice(0, Number(D.bc) + 1); S.alert = ''; paint(); return; }
      if (D.clr) { if (D.clr === 'q') { S.q = ''; B('q').value = ''; } else S[D.clr] = ''; paint(); return; }
      if (D.day) { if (D.day > todayIST()) return; S.date = D.day; S.store = null; sdEl.innerHTML = ''; load(); return; }
      if (D.x === 'closesd') { S.store = null; sdEl.innerHTML = ''; return; }
      if (t.matches('tr.click')) {
        const lv = S.lv;
        if (lv === 'store') { storeDetail(D.k); return; }
        if (lv === 'dept') { S.cat = D.k; S.view = views().some((v) => v[0] === 'store') ? 'store' : S.view; S.path = []; paint(); return; }
        S.path.push({ key: lv, val: D.k, name: D.n, next: lv === 'zfm' ? 'am' : 'store' }); paint();
      }
    });
    V.bar.addEventListener('change', (e) => {
      const f = e.target.dataset.f;
      if (f === 'date') { const v = e.target.value || todayIST(); S.date = v > todayIST() ? todayIST() : v; S.store = null; sdEl.innerHTML = ''; load(); }
      if (f === 'zfm') { S.zfm = e.target.value; S.am = ''; S.path = []; fillSelects(); paint(); }
      if (f === 'am') { S.am = e.target.value; S.path = []; paint(); }
    });
    V.bar.addEventListener('input', (e) => {
      if (e.target.dataset.f !== 'q') return;
      e.target.value = e.target.value.toUpperCase(); S.q = e.target.value; S.path = []; if (S.d) paint();
    });
    V.bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]'); if (!b) return;
      if (b.dataset.f === 'ref') load();
      if (b.dataset.f === 'xls') excel();
    });
    // live view refreshes itself every 5 minutes while visible
    V.every(() => { if (S.d && S.d.date === S.d.today && !S.upto && document.visibilityState === 'visible' && !document.querySelector('.ov')) load(); }, 5 * 60000);
    load();
    return { reload: load };
  }

  /* =====================================================================
     APPROVALS (Pending + History)
     ===================================================================== */
  const CR_KIND = { compoff: 'Comp-off', staff: 'Staff detail change', missed_out: 'Missed OUT', missed_in: 'Missed IN', sg_mispunch: 'SG mis-punch', sg_edit: 'SG time edit' };
  const isSg = (k) => k === 'sg_mispunch' || k === 'sg_edit';
  function crChange(r) {
    const p = r.payload || {};
    if (r.kind === 'compoff') return p.on === false ? `Remove comp-off · ${r.date ? fmtDay(r.date) : ''}` : `Absent → Comp-off · ${r.date ? fmtDay(r.date) : ''}`;
    if (r.kind === 'staff') { const o = p.old || {}, n = p.new || {};
      return ['name', 'vendor', 'brand'].filter((k) => (o[k] || '') !== (n[k] || '')).map((k) => `${k}: ${o[k] || '—'} → ${n[k] || '—'}`).join(' · ') || 'No change'; }
    if (isSg(r.kind)) {
      const bits = [r.date ? fmtDay(r.date) : '', p.in ? `IN ${p.in}` : '', p.out ? `OUT ${p.out}` : '', p.missing ? `missing ${p.missing}` : '', p.sg ? `now ${p.sg}` : ''].filter(Boolean);
      return bits.join(' · ');
    }
    return r.date ? fmtDay(r.date) : '';
  }
  function decisionTag(r) {
    if (r.status === 'pending') return `<span class="tg amb">Pending · ${esc(r.approver || (isSg(r.kind) ? 'RLPO' : 'AM'))}</span>`;
    if (isSg(r.kind)) {
      if (r.status === 'rejected' || r.decision === 'A') return '<span class="tg red">Rejected (A)</span>';
      return r.decision === 'H' ? '<span class="tg amb">Approved as H</span>' : `<span class="tg ok">Approved as ${esc(r.decision || 'P')}</span>`;
    }
    return r.status === 'approved' ? '<span class="tg ok">Approved</span>' : '<span class="tg red">Rejected</span>';
  }
  function decisionText(r) {
    if (r.status === 'pending') return 'Pending';
    if (isSg(r.kind)) return r.status === 'rejected' || r.decision === 'A' ? 'Rejected (A)' : `Approved as ${r.decision || 'P'}`;
    return r.status === 'approved' ? 'Approved' : 'Rejected';
  }
  async function dashPendingCount(me) {
    if (!me || !['am', 'rlpo'].includes(me.role) || me.view_by) return 0;
    const r = await rpc('cr_list', { p_token: me.token, p_status: 'pending', p_days: 120 });
    return r && r.ok ? (r.rows || []).filter((x) => x.can_decide).length : 0;
  }

  function ApprovalsView(root, me, opts = {}) {
    const V = mount(root, { bar: false });
    const today = todayIST();
    const S = { tab: 'pend', from: addDays(today, -30), to: today, group: 'all', status: 'all', q: '', pend: null, hist: null, busy: false };
    const decider = ['am', 'rlpo'].includes(me.role) && !me.view_by;
    const title = me.role === 'rlpo' ? 'SG approvals' : decider ? 'Approvals' : 'Approvals (view only)';
    const sub = me.role === 'rlpo' ? 'Security mis-punch (IN without OUT) and time edits from your stores. Until you decide, a mis-punch counts as Absent. Add a remark if you want; every decision is saved.'
      : me.role === 'am' ? 'Requests from your stores (comp-off, staff detail change). Add a remark if you want; every decision is saved with who and when. Security requests go to the RLPO.'
        : 'Store requests are decided by their AM; Security mis-punch / edits by the RLPO. You can watch and download, not decide.';
    V.el.insertAdjacentHTML('beforeend', `<div><h1 class="pt">${esc(title)}</h1><div class="sub">${esc(sub)}</div></div>
      <div class="card"><div class="tabs"><button type="button" data-apt="pend" class="on">Pending</button><button type="button" data-apt="hist">History</button></div><div data-ap="body">${spin}</div></div>`);
    const body = V.q('[data-ap="body"]');
    const emit = (n) => { if (typeof opts.onCount === 'function') opts.onCount(n); document.dispatchEvent(new CustomEvent('dash:pending', { detail: { n } })); };

    async function load() {
      V.el.querySelectorAll('[data-apt]').forEach((b) => b.classList.toggle('on', b.dataset.apt === S.tab));
      body.innerHTML = spin;
      if (S.tab === 'pend') {
        const r = await rpc('cr_list', { p_token: me.token, p_status: 'pending', p_days: 120 });
        if (!V.alive() || S.tab !== 'pend') return;
        if (!r || !r.ok) { body.innerHTML = errBox(r); return; }
        S.pend = r.rows || []; emit(S.pend.filter((x) => x.can_decide).length); paintPend();
      } else {
        const r = await rpc('cr_history', { p_token: me.token, p_from: S.from, p_to: S.to, p_group: S.group });
        if (!V.alive() || S.tab !== 'hist') return;
        if (!r || !r.ok) { body.innerHTML = histTools() + errBox(r); return; }
        S.hist = r; paintHist();
      }
    }
    function card(x) {
      const sg = isSg(x.kind);
      const btns = sg
        ? `<button type="button" class="btn g sm" data-dec="${x.id}|P">Approve as P</button><button type="button" class="btn sm" style="background:var(--amb)" data-dec="${x.id}|H">Approve as H</button><button type="button" class="btn r sm" data-dec="${x.id}|A">Reject (A)</button>`
        : `<button type="button" class="btn g sm" data-dec="${x.id}|ok">Approve</button><button type="button" class="btn r sm" data-dec="${x.id}|no">Reject</button>`;
      return `<div class="reqc" data-row="${x.id}"><div style="min-width:0;flex:1 1 300px"><b>${esc(x.store)}${x.store_name ? ' · ' + esc(x.store_name) : ''} · ${esc(CR_KIND[x.kind] || x.kind)}</b>
        <div class="sub">${esc(x.assoc || '')}${x.assoc_code ? ' · ' + esc(x.assoc_code) : ''}${x.cat ? ' · ' + esc(x.cat) : ''} · from ${esc([x.by_post, x.by_name || x.by].filter(Boolean).join(' '))} · ${esc(x.at || '')}</div>
        <div style="margin-top:4px"><span class="tg info">${esc(crChange(x))}</span></div><div style="margin-top:4px;font-size:13px">“${esc(x.reason || '')}”</div></div>
        <span class="act"><input class="f" data-rmk="${x.id}" placeholder="Remark (optional)" maxlength="300">${btns}</span></div>`;
    }
    function paintPend() {
      const mine = S.pend.filter((x) => x.can_decide), others = S.pend.filter((x) => !x.can_decide);
      const table = others.length ? `${mine.length ? '<h2 style="margin-top:14px">Waiting with others</h2>' : ''}<div class="tw"><table><thead><tr><th class="l">Store</th><th class="l">Type</th><th class="l">Staff</th><th class="l">For date</th><th class="l">Change</th><th class="l">Reason</th><th class="l">From</th><th class="l">Waiting with</th></tr></thead><tbody>
        ${others.map((x) => `<tr><td class="l"><b>${esc(x.store)}</b><small>${esc(x.store_name || '')}</small></td><td class="l">${esc(CR_KIND[x.kind] || x.kind)}</td><td class="l">${esc(x.assoc || '')}<small>${esc(x.assoc_code || '')}</small></td><td class="l">${x.date ? esc(fmtDay(x.date)) : '—'}</td>
          <td class="l">${esc(crChange(x))}</td><td class="l" style="white-space:normal;min-width:180px">${esc(x.reason || '')}</td><td class="l">${esc([x.by_post, x.by_name || x.by].filter(Boolean).join(' '))}<small>${esc(x.at || '')}</small></td><td class="l"><span class="tg amb">${esc(x.approver || (isSg(x.kind) ? 'RLPO' : 'AM'))}</span></td></tr>`).join('')}</tbody></table></div>` : '';
      body.innerHTML = (mine.length ? `<div class="dlist">${mine.map(card).join('')}</div>` : decider ? '<div class="note k" style="margin-top:8px">All done. No pending requests for you.</div>' : '')
        + table + (!mine.length && !others.length && !decider ? '<div class="note k" style="margin-top:8px">Nothing pending.</div>' : '');
    }
    function histTools() {
      const c = (S.hist && S.hist.counts) || {}, all = (c.pending || 0) + (c.approved || 0) + (c.rejected || 0);
      return `<div class="toolrow" style="margin-top:6px"><span class="ftl"><label class="sub" style="margin:0">From <input class="f" type="date" data-h="from" value="${S.from}" max="${today}"></label>
        <label class="sub" style="margin:0">To <input class="f" type="date" data-h="to" value="${S.to}" max="${today}"></label>
        ${me.role === 'rlpo' ? '' : `<select data-h="group" aria-label="Type"><option value="all"${S.group === 'all' ? ' selected' : ''}>All types</option><option value="other"${S.group === 'other' ? ' selected' : ''}>Store → AM</option><option value="sg"${S.group === 'sg' ? ' selected' : ''}>Security → RLPO</option></select>`}
        <input class="f" data-h="q" placeholder="Search store / name / approver" value="${esc(S.q)}" style="width:220px"></span><button type="button" class="btn sm" data-h="xls">⬇ Excel</button></div>
        ${S.hist ? `<div class="stat" style="margin-top:10px">${[['all', 'All', all, ''], ['pending', 'Pending', c.pending || 0, 'a'], ['approved', 'Approved', c.approved || 0, ''], ['rejected', 'Rejected', c.rejected || 0, 'r']]
          .map(([k, l, n, cls]) => `<button type="button" data-hs="${k}" class="${S.status === k ? 'on' : ''} ${cls}">${l}<b>${n}</b></button>`).join('')}</div>` : ''}`;
    }
    function histRows() {
      const q = S.q.trim().toLowerCase();
      return ((S.hist && S.hist.rows) || []).filter((h) => (S.status === 'all' || h.status === S.status)
        && (!q || [h.store, h.store_name, h.assoc, h.assoc_code, h.by_name, h.decided_by, CR_KIND[h.kind], h.reason, h.note].join(' ').toLowerCase().includes(q)));
    }
    function paintHist() {
      const R = histRows();
      body.innerHTML = histTools() + `<div class="tw"><table><thead><tr><th class="l">Decided on</th><th class="l">Store</th><th class="l">Type</th><th class="l">Staff</th><th class="l">Change</th><th class="l">Reason</th><th class="l">Requested</th><th class="l">Decision</th><th class="l">By</th><th class="l">Remark</th></tr></thead><tbody>
        ${R.map((h) => `<tr><td class="l">${esc(h.decided_at || '—')}</td><td class="l"><b>${esc(h.store)}</b><small>${esc(h.store_name || '')}</small></td><td class="l">${esc(CR_KIND[h.kind] || h.kind)}</td><td class="l">${esc(h.assoc || '')}<small>${esc([h.assoc_code, h.cat].filter(Boolean).join(' · '))}</small></td>
          <td class="l">${esc(crChange(h))}</td><td class="l" style="white-space:normal;min-width:160px">${esc(h.reason || '')}</td><td class="l">${esc(h.at || '')}<small>${esc([h.by_post, h.by_name || h.by].filter(Boolean).join(' '))}</small></td>
          <td class="l">${decisionTag(h)}</td><td class="l">${esc(h.decided_by ? `${h.decided_by_role ? roleLabel(h.decided_by_role) + ' ' : ''}${h.decided_by}` : '—')}</td><td class="l" style="white-space:normal">${esc(h.note || '')}</td></tr>`).join('')
          || '<tr><td class="l" colspan="10" style="color:var(--mut)">No requests in these dates</td></tr>'}</tbody></table></div>
        <div class="sub">${R.length} request${pl(R.length)} · ${esc(fmtDate(S.hist.from || S.from))} – ${esc(fmtDate(S.hist.to || S.to))} · every approve / reject is saved with who and when, and also goes to the Access log</div>`;
    }
    async function decide(btn) {
      if (S.busy) return;
      const [id, v] = btn.dataset.dec.split('|'), row = (S.pend || []).find((x) => String(x.id) === id); if (!row) return;
      const sg = isSg(row.kind), inp = V.q(`[data-rmk="${id}"]`), note = inp ? inp.value.trim() : '';
      const approve = sg ? v !== 'A' : v === 'ok';
      S.busy = true; const box = btn.closest('.reqc'); box.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      const r = await rpc('cr_decide', { p_token: me.token, p_id: Number(id), p_approve: approve, p_note: note || null, p_status: sg ? v : null });
      S.busy = false;
      if (r && r.ok) {
        toast(sg ? (v === 'A' ? 'Rejected · marked A' : `Approved as ${v}`) : approve ? 'Approved' : 'Rejected');
        S.pend = S.pend.filter((x) => String(x.id) !== id); emit(S.pend.filter((x) => x.can_decide).length); paintPend();
      } else {
        toast(errText(r && r.error)); box.querySelectorAll('button').forEach((b) => { b.disabled = false; });
        if (r && r.error === 'ALREADY_DECIDED') load();
      }
    }
    V.el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-apt],[data-dec],[data-hs],[data-h="xls"]'); if (!t) return;
      if (t.dataset.apt) { if (S.tab !== t.dataset.apt) { S.tab = t.dataset.apt; load(); } return; }
      if (t.dataset.dec) { decide(t); return; }
      if (t.dataset.hs) { S.status = t.dataset.hs; paintHist(); return; }
      if (t.dataset.h === 'xls') {
        const R = histRows();
        downloadXlsx(R.map((h) => ({ 'Requested on': h.at || '', Store: h.store, 'Store name': h.store_name || '', Type: CR_KIND[h.kind] || h.kind, Staff: h.assoc || '', Code: h.assoc_code || '', Dept: h.cat || '',
          'For date': h.date || '', Change: crChange(h), Reason: h.reason || '', 'Requested by': [h.by_post, h.by_name || h.by].filter(Boolean).join(' '), Approver: h.approver || '',
          Decision: decisionText(h), 'Decided by': h.decided_by || '', 'Decided on': h.decided_at || '', Remark: h.note || '' })), `3PA_Approvals_${S.from}_${S.to}.xlsx`, 'Approvals');
      }
    });
    V.el.addEventListener('change', (e) => {
      const k = e.target.dataset.h; if (!k || k === 'q') return;
      if (k === 'from' || k === 'to') {
        const v = e.target.value; if (!v) return; S[k] = v > today ? today : v;
        if (S.from > S.to) { if (k === 'from') S.to = S.from; else S.from = S.to; }
      }
      if (k === 'group') S.group = e.target.value;
      load();
    });
    V.el.addEventListener('input', (e) => { if (e.target.dataset.h === 'q') { S.q = e.target.value; const pos = e.target.selectionStart; paintHist(); const n = V.q('[data-h="q"]'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (er) { /* */ } } });
    V.el.addEventListener('keydown', (e) => { const i = e.target.closest('[data-rmk]'); if (i && e.key === 'Enter') e.preventDefault(); });
    load();
    return { reload: load };
  }

  /* =====================================================================
     RLPO: MANUAL PRESENT (P*)
     ===================================================================== */
  function RlpoManualView(root, me) {
    const V = mount(root, { bar: false });
    const today = todayIST(), minD = addDays(today, -45);
    const S = { stores: [], store: '', date: today, guards: [], st: {}, done: [], seq: 0 };
    V.el.insertAdjacentHTML('beforeend', `<div><h1 class="pt">Manual present (exception)</h1><div class="sub">Only RLPO. Marks a guard Present when the punch could not happen. Shows as <span class="tg acc">P*</span> everywhere; the reason is mandatory and logged.</div></div>
      <div class="card" data-mn="form">${spin}</div><div class="card" data-mn="day"></div><div class="card" data-mn="done" hidden></div>`);
    const form = V.q('[data-mn="form"]'), day = V.q('[data-mn="day"]'), done = V.q('[data-mn="done"]');
    if (me.role !== 'rlpo') { form.innerHTML = '<div class="note w">Only an RLPO login can mark Manual present.</div>'; day.hidden = true; return { reload() {} }; }
    const SGL = { P: 'P', H: 'H · half day', A: 'A', MP: 'MP · with RLPO', 'P*': 'P* · manual', IN: 'On duty' };
    const SGC = { P: 'ok', H: 'amb', A: 'red', MP: 'grey', 'P*': 'acc', IN: 'info' };

    async function init() {
      const r = await rpc('dash_overview', { p_token: me.token, p_date: today, p_shift: 'B', p_upto: null });
      if (!V.alive()) return;
      if (!r || !r.ok) { form.innerHTML = errBox(r); return; }
      S.stores = r.stores || [];
      if (!S.stores.length) { form.innerHTML = '<div class="note w">No stores are mapped to you yet. Ask Admin (RLPO Master → Store mapping).</div>'; day.hidden = true; return; }
      S.store = S.stores[0].code;
      form.innerHTML = `<div class="frm">
        <label>Store<select data-m="store">${S.stores.map((s) => `<option value="${esc(s.code)}">${esc(s.code)} · ${esc(s.name || '')}</option>`).join('')}</select></label>
        <label>Date<input class="f" type="date" data-m="date" value="${today}" min="${minD}" max="${today}"></label>
        <label>Guard<select data-m="guard"><option value="">Loading…</option></select></label>
        <label style="grid-column:span 2">Reason (required)<input class="f" data-m="reason" maxlength="300" placeholder="e.g. phone stolen, CCTV checked"></label>
        <label>&nbsp;<button type="button" class="btn" data-m="save">Mark P*</button></label></div>
        <div class="note r" data-m="err" hidden style="margin-top:8px"></div>
        <div class="hint" style="margin-top:8px">Date: today or up to 45 days back. If the guard already has a status that day, P* replaces it.</div>`;
      loadStore();
    }
    async function loadStore() {
      const seq = ++S.seq, store = S.store, date = S.date;
      const gs = form.querySelector('[data-m="guard"]'); gs.innerHTML = '<option value="">Loading…</option>';
      day.innerHTML = spin;
      const [a, d] = await Promise.all([rpc('associates_list', { p_token: me.token, p_store: store }), rpc('dash_store', { p_token: me.token, p_store: store, p_date: date, p_shift: 'B' })]);
      if (!V.alive() || seq !== S.seq) return;
      const byId = new Map();
      ((a && a.ok && a.rows) || []).filter((x) => x.c === 'SEC').forEach((x) => byId.set(String(x.id), { id: x.id, name: x.name, code: x.code, vendor: x.vendor }));
      S.st = {};
      ((d && d.ok && d.present) || []).filter((x) => x.c === 'SEC').forEach((x) => { if (!byId.has(String(x.id))) byId.set(String(x.id), { id: x.id, name: x.name, code: x.code, vendor: x.vendor }); S.st[x.id] = x.st || (date === today ? 'IN' : ''); });
      S.guards = [...byId.values()].sort((x, y) => String(x.name).localeCompare(y.name));
      const lbl = (g) => { const s = S.st[g.id]; return `${g.name}${g.code ? ' · ' + g.code : ''} — ${s ? SGL[s] || s : date < today ? 'no punch (A)' : 'not punched yet'}`; };
      const keep = gs.value;
      gs.innerHTML = S.guards.length ? `<option value="">— Select guard —</option>${S.guards.map((g) => `<option value="${esc(g.id)}"${String(g.id) === keep ? ' selected' : ''}>${esc(lbl(g))}</option>`).join('')}` : '<option value="">No guards registered at this store</option>';
      const sm = S.stores.find((s) => s.code === store) || {};
      day.innerHTML = `<div class="hd"><div><h2>Security at ${esc(store)} · ${esc(fmtDate(date))}</h2><div class="sub">${esc(sm.name || '')}${sm.sg_set ? ` · ${esc(sm.sg_set)}-hr set` : ''} · status only, no timings</div></div></div>
        ${!d || !d.ok ? errBox(d) : `<div class="tw"><table><thead><tr><th class="l">Guard</th><th class="l">Code</th><th class="l">Vendor</th><th class="l">Status</th><th class="l"></th></tr></thead><tbody>
        ${S.guards.map((g) => { const s = S.st[g.id]; return `<tr><td class="l">${esc(g.name)}</td><td class="l">${esc(g.code || '')}</td><td class="l">${esc(g.vendor || '—')}</td>
          <td class="l">${s ? `<span class="tg ${SGC[s] || 'grey'}">${esc(SGL[s] || s)}</span>` : `<span class="tg grey">${date < today ? 'No punch · A' : 'Not punched yet'}</span>`}</td>
          <td class="l">${s !== 'P*' ? `<button type="button" class="lk" data-pick="${esc(g.id)}">Mark P*</button>` : ''}</td></tr>`; }).join('') || '<tr><td class="l" colspan="5" style="color:var(--mut)">No guards registered at this store</td></tr>'}</tbody></table></div>`}`;
    }
    async function save() {
      const err = form.querySelector('[data-m="err"]'), bad = (m) => { err.hidden = false; err.textContent = m; };
      err.hidden = true;
      const gid = form.querySelector('[data-m="guard"]').value, date = form.querySelector('[data-m="date"]').value, reason = form.querySelector('[data-m="reason"]').value.trim();
      if (!gid) return bad('Pick the guard.');
      if (!date || date > today || date < minD) return bad('Date must be today or within the last 45 days.');
      if (reason.length < 5) return bad('Write the reason (at least 5 letters).');
      const btn = form.querySelector('[data-m="save"]'); btn.disabled = true;
      const r = await rpc('rlpo_manual', { p_token: me.token, p_associate: Number(gid), p_date: date, p_reason: reason });
      btn.disabled = false;
      if (!r || !r.ok) return bad(r && r.error === 'BAD_DATE' ? 'Date must be today or within the last 45 days.' : errText(r && r.error));
      const g = S.guards.find((x) => String(x.id) === gid) || {};
      S.done.unshift({ store: S.store, guard: g.name || gid, code: g.code || '', date, reason, at: istNow().toTimeString().slice(0, 5) });
      toast(`${g.name || 'Guard'} marked P* for ${fmtDay(date)}`);
      form.querySelector('[data-m="reason"]').value = ''; form.querySelector('[data-m="guard"]').value = '';
      paintDone(); loadStore();
    }
    function paintDone() {
      done.hidden = !S.done.length;
      done.innerHTML = `<h2>Marked in this session</h2><div class="tw"><table><thead><tr><th class="l">Store</th><th class="l">Guard</th><th class="l">Date</th><th class="l">Reason</th><th class="l">At</th></tr></thead><tbody>
        ${S.done.map((m) => `<tr><td class="l">${esc(m.store)}</td><td class="l">${esc(m.guard)}<small>${esc(m.code)}</small></td><td class="l">${esc(fmtDay(m.date))}</td><td class="l" style="white-space:normal">${esc(m.reason)}</td><td class="l">${esc(m.at)}</td></tr>`).join('')}</tbody></table></div>
        <div class="sub">Full history is in the Access log (Admin) as sg_approve · manual P*.</div>`;
    }
    V.el.addEventListener('change', (e) => {
      const k = e.target.dataset.m;
      if (k === 'store') { S.store = e.target.value; loadStore(); }
      if (k === 'date') { const v = e.target.value; if (!v) return; S.date = v > today ? today : v < minD ? minD : v; e.target.value = S.date; loadStore(); }
    });
    V.el.addEventListener('click', (e) => {
      if (e.target.closest('[data-m="save"]')) { save(); return; }
      const p = e.target.closest('[data-pick]');
      if (p) { const gs = form.querySelector('[data-m="guard"]'); gs.value = p.dataset.pick; form.scrollIntoView({ behavior: 'smooth', block: 'start' }); form.querySelector('[data-m="reason"]').focus(); }
    });
    V.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset.m === 'reason') { e.preventDefault(); save(); } });
    init();
    return { reload: loadStore };
  }

  /* =====================================================================
     STORE TEAM (AM / ZFM / Admin) · MY STORES (RLPO / HO Dept)
     ===================================================================== */
  function StoreTeamView(root, me) {
    const V = mount(root, { bar: false });
    const team = ['am', 'zfm', 'admin'].includes(me.role);
    const title = me.role === 'am' ? 'My stores & team' : team ? 'Store team' : 'My stores';
    V.el.insertAdjacentHTML('beforeend', `<div class="toolrow"><div><h1 class="pt">${esc(title)}</h1><div class="sub" data-tm="sub"></div></div>
      <span class="ftl"><input class="f" data-tm="q" placeholder="Find store" style="width:180px">${team ? '' : '<button type="button" class="btn sm" data-tm="xls">⬇ Excel</button>'}</span></div>
      ${team ? '<div class="note">One login per post. People register themselves at first login inside the store. If someone left, mark the post vacant so the new person can register.</div>' : ''}
      <div data-tm="list">${spin}</div>`);
    const list = V.q('[data-tm="list"]');
    let data = null, ov = null;
    const shift = istNow().getHours() < 14 ? 'M' : 'B';
    async function load() {
      list.innerHTML = spin;
      const [t, o] = await Promise.all([team ? rpc('store_team', { p_token: me.token }) : Promise.resolve(null), rpc('dash_overview', { p_token: me.token, p_date: todayIST(), p_shift: shift, p_upto: null })]);
      if (!V.alive()) return;
      ov = o && o.ok ? o : null;
      if (team) { if (!t || !t.ok) { list.innerHTML = errBox(t); return; } data = t; }
      else if (!ov) { list.innerHTML = errBox(o); return; }
      paint();
    }
    const cnm = (id) => { const c = ov && ov.categories.find((x) => x.id === id); return c ? catName(c) : id; };
    function today(code) {
      if (!ov) return null;
      const r = ov.rows.filter((x) => x.s === code), q = r.reduce((a, x) => a + x.req, 0), p = r.reduce((a, x) => a + Math.min(x.p, x.req), 0);
      return { r, q, p, v: pct(p, q) };
    }
    function paint() {
      const q = V.q('[data-tm="q"]').value.trim().toUpperCase();
      if (team) {
        const stores = data.stores.filter((s) => !q || s.code.includes(q) || String(s.name).toUpperCase().includes(q));
        V.q('[data-tm="sub"]').textContent = `${data.stores.length} store${pl(data.stores.length)} · today ${SHN[shift]} · one login per post`;
        list.innerHTML = `<div class="cols2">${stores.slice(0, 150).map((s) => { const us = data.rows.filter((u) => u.store === s.code), td = today(s.code);
          return `<div class="card"><div class="hd"><div><h2>${esc(s.code)} · ${esc(s.name)}</h2><div class="sub">${td && td.r.length ? td.r.map((y) => `${esc(cnm(y.c))} ${Math.min(y.p, y.req)}/${y.req}`).join(' · ') : `${us.length}/${POSTS.length} logins`}</div></div>${td && td.q ? heat(td.v) : ''}</div>
            <div class="dlist">${POSTS.map((p) => { const u = us.find((x) => x.post === p);
              return `<div class="post"><span><b>${esc(p)}</b> · ${u ? `${esc(u.name)} <small style="color:var(--mut)">${esc(u.emp)}${u.last_login ? ' · ' + esc(u.last_login) : ''}</small>` : '<span class="tg grey">Vacant</span>'}</span>
                ${u ? (data.can_vacate && !me.view_by ? `<button type="button" class="btn s sm" data-vac="${esc(u.emp)}" data-n="${esc(u.name)}" data-p="${esc(p)}">Mark vacant</button>` : '<span class="tg ok">Active</span>') : '<span class="sub">Waiting for registration</span>'}</div>`; }).join('')}</div></div>`; }).join('')
          || '<div class="card"><span class="sub">No stores</span></div>'}</div>`;
        return;
      }
      const stores = ov.stores.filter((s) => !q || s.code.includes(q) || String(s.name).toUpperCase().includes(q));
      V.q('[data-tm="sub"]').textContent = `${ov.stores.length} store${pl(ov.stores.length)} · today ${SHN[shift]} so far`;
      const sec = ov.categories.some((c) => c.id === 'SEC');
      list.innerHTML = `<div class="card"><div class="tw" style="margin-top:0"><table><thead><tr><th class="l">Store</th><th class="l">AM</th><th class="l">ZFM</th>${sec ? '<th class="l">RLPO</th><th>SG set</th>' : ''}<th>Required</th><th>Present</th><th>%</th></tr></thead><tbody>
        ${stores.map((s) => { const td = today(s.code); return `<tr><td class="l"><b>${esc(s.code)}</b> ${esc(s.name || '')}</td><td class="l">${esc(s.am_name || '—')}</td><td class="l">${esc(s.zfm_name || '—')}</td>
          ${sec ? `<td class="l">${esc(s.rlpo_name || '—')}</td><td>${esc(s.sg_set || '—')}-hr</td>` : ''}<td>${td.q}</td><td>${td.p}</td><td>${td.q ? heat(td.v) : '—'}</td></tr>`; }).join('') || '<tr><td class="l" colspan="8" style="color:var(--mut)">No stores</td></tr>'}</tbody></table></div></div>`;
    }
    V.q('[data-tm="q"]').addEventListener('input', () => { if (data || ov) paint(); });
    V.el.addEventListener('click', (e) => {
      if (e.target.closest('[data-tm="xls"]') && ov) {
        downloadXlsx(ov.stores.map((s) => { const td = today(s.code); return { Store: s.code, Name: s.name, AM: s.am_name || '', ZFM: s.zfm_name || '', RLPO: s.rlpo_name || '', 'SG set': s.sg_set || '', Required: td.q, Present: td.p, '%': td.q ? td.v : '' }; }),
          `3PA_My_stores_${todayIST()}.xlsx`, 'Stores');
        return;
      }
      const b = e.target.closest('[data-vac]'); if (!b) return;
      const md = modal(`<h3>Mark ${esc(b.dataset.p)} vacant</h3><div class="sub" style="font-size:13px">${esc(b.dataset.n)} (${esc(b.dataset.vac)}) will be logged out and cannot log in. Their history stays.</div>
        <div class="frm" style="grid-template-columns:minmax(0,1fr);margin-top:10px"><label>Reason (required)<select data-v="why"><option>Left the company</option><option>Transferred to another store</option><option>Wrong post registered</option><option>Other</option></select></label>
        <label>Details (optional)<input class="f" data-v="more" maxlength="150"></label></div><div class="note r" data-v="err" hidden></div>
        <div class="mx"><button type="button" class="btn s" data-close>Cancel</button><button type="button" class="btn r" data-v="go">Mark vacant</button></div>`);
      md.querySelector('[data-v="go"]').addEventListener('click', async (ev) => {
        const go = ev.currentTarget; go.disabled = true;
        const more = md.querySelector('[data-v="more"]').value.trim();
        const r = await rpc('store_vacate', { p_token: me.token, p_emp: b.dataset.vac, p_reason: md.querySelector('[data-v="why"]').value + (more ? ' · ' + more : '') });
        if (r && r.ok) { md.close(); toast(`${r.post || b.dataset.p} is now vacant`); load(); return; }
        go.disabled = false; const er = md.querySelector('[data-v="err"]'); er.hidden = false; er.textContent = errText(r && r.error);
      });
    });
    load();
    return { reload: load };
  }

  /* =====================================================================
     STAFF CHURN
     ===================================================================== */
  function ChurnView(root, me) {
    const V = mount(root, { bar: false });
    const S = { days: 30, data: null, ov: null, rows: [], f: { zfm: '', am: '', store: '', cat: '', vendor: '' } };
    V.el.insertAdjacentHTML('beforeend', `<div class="toolrow"><div><h1 class="pt">Churn</h1><div class="sub">How often the person in each required slot changes (last <span data-c="dl">30</span> days). Stable: up to 1 more name than required · Some churn: up to 2× required · High churn: more than that.</div></div>
      <button type="button" class="btn sm" data-c="xls">⬇ Excel</button></div>
      <div class="card ftl" style="padding:8px 12px"><select data-c="zfm" aria-label="ZFM"></select><select data-c="am" aria-label="AM"></select><input class="f" data-c="store" placeholder="Store code" maxlength="4" style="width:100px;text-transform:uppercase">
        <select data-c="cat" aria-label="Dept"></select><select data-c="vendor" aria-label="Vendor"></select><select data-c="days" aria-label="Days"><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option></select></div>
      <div class="kpis k4" data-c="kpi">${spin}</div>
      <div class="card"><h2>Slots</h2><div data-c="tbl"></div></div>
      <div class="card"><h2>Vendor ranking</h2><div data-c="ven"></div></div>`);
    const q = (k) => V.q(`[data-c="${k}"]`);
    const status = (x) => { if (!x.req) return x.names ? 'r' : 'ok'; if (x.names <= x.req + 1) return 'ok'; if (x.names <= x.req * 2) return 'w'; return 'r'; };
    const LBL = { ok: 'Stable', w: 'Some churn', r: 'High churn' }, TG = { ok: 'ok', w: 'amb', r: 'red' };
    async function load() {
      q('kpi').innerHTML = spin;
      const [r, ov] = await Promise.all([rpc('churn', { p_token: me.token, p_days: S.days }),
        S.ov ? Promise.resolve(S.ov) : rpc('dash_overview', { p_token: me.token, p_date: todayIST(), p_shift: 'B', p_upto: null })]);
      if (!V.alive()) return;
      if (!r || !r.ok) { q('kpi').innerHTML = errBox(r); return; }
      S.data = r; S.ov = ov && ov.ok ? ov : { stores: [], categories: [] };
      const stores = S.ov.stores || [];
      const opt = (arr, all, v) => `<option value="">${all}</option>` + arr.map(([k, n]) => `<option value="${esc(k)}"${k === v ? ' selected' : ''}>${esc(n)}</option>`).join('');
      const zf = [...new Map(stores.filter((s) => s.zfm).map((s) => [s.zfm, s.zfm_name || s.zfm]))], am = [...new Map(stores.filter((s) => s.am).map((s) => [s.am, s.am_name || s.am]))];
      q('zfm').innerHTML = opt(zf, 'ZFM: All', S.f.zfm); q('zfm').hidden = zf.length < 2;
      q('am').innerHTML = opt(am, 'AM: All', S.f.am); q('am').hidden = am.length < 2;
      const cs = (S.ov.categories || []).map((c) => [c.id, catName(c)]);
      q('cat').innerHTML = opt(cs, 'Dept: All', S.f.cat); q('cat').hidden = cs.length < 2;
      q('vendor').innerHTML = opt([...new Set((r.rows || []).map((x) => x.vendor).filter(Boolean))].sort().map((v) => [v, v]), 'Vendor: All', S.f.vendor);
      paint();
    }
    function paint() {
      const sm = new Map((S.ov.stores || []).map((s) => [s.code, s]));
      const cn = (id) => { const c = (S.ov.categories || []).find((x) => x.id === id); return c ? catName(c) : id; };
      const rows = (S.data.rows || []).filter((x) => { const s = sm.get(x.s) || {};
        return (!S.f.zfm || s.zfm === S.f.zfm) && (!S.f.am || s.am === S.f.am) && (!S.f.store || x.s === S.f.store) && (!S.f.cat || x.c === S.f.cat) && (!S.f.vendor || x.vendor === S.f.vendor); })
        .map((x) => ({ ...x, st: status(x), sname: (sm.get(x.s) || {}).name || '', cname: cn(x.c) }));
      const n = (k) => rows.filter((x) => x.st === k).length;
      q('kpi').innerHTML = `<div class="kpi"><span class="l">Stable slots</span><span class="v" style="color:var(--ok)">${n('ok')}</span></div><div class="kpi"><span class="l">Some churn</span><span class="v" style="color:var(--amb)">${n('w')}</span></div>
        <div class="kpi"><span class="l">High churn</span><span class="v" style="color:var(--red)">${n('r')}</span></div><div class="kpi"><span class="l">Stores</span><span class="v">${new Set(rows.map((x) => x.s)).size}</span></div>`;
      const order = { r: 0, w: 1, ok: 2 };
      rows.sort((a, b) => order[a.st] - order[b.st] || (b.names - b.req) - (a.names - a.req));
      q('tbl').innerHTML = `<div class="tw"><table><thead><tr><th class="l">Store</th><th class="l">Dept</th><th class="l">Brand</th><th class="l">Vendor</th><th>Required</th><th>Different names</th><th class="l">Status</th></tr></thead><tbody>
        ${rows.slice(0, 500).map((x) => `<tr><td class="l"><b>${esc(x.s)}</b> ${esc(x.sname)}</td><td class="l">${esc(x.cname)}</td><td class="l">${esc(x.brand || '—')}</td><td class="l">${esc(x.vendor || '—')}</td><td>${x.req}</td><td>${x.names}</td><td class="l"><span class="tg ${TG[x.st]}">${LBL[x.st]}</span></td></tr>`).join('')
          || '<tr><td colspan="7" class="l" style="color:var(--mut)">No data</td></tr>'}</tbody></table></div>${rows.length > 500 ? `<div class="sub">Showing 500 of ${rows.length} · Excel has all</div>` : ''}`;
      const vm = new Map(); rows.forEach((x) => { const v = x.vendor || '—'; const o = vm.get(v) || { slots: 0, high: 0, stable: 0 }; o.slots++; if (x.st === 'r') o.high++; if (x.st === 'ok') o.stable++; vm.set(v, o); });
      q('ven').innerHTML = `<div class="tw"><table><thead><tr><th class="l">Vendor</th><th>Slots</th><th>High churn</th><th>Stable %</th></tr></thead><tbody>
        ${[...vm.entries()].sort((a, b) => b[1].high - a[1].high).map(([v, o]) => `<tr><td class="l">${esc(v)}</td><td>${o.slots}</td><td>${o.high}</td><td>${heat(pct(o.stable, o.slots))}</td></tr>`).join('') || '<tr><td colspan="4" class="l" style="color:var(--mut)">No data</td></tr>'}</tbody></table></div>`;
      S.rows = rows;
    }
    V.el.addEventListener('change', (e) => {
      const k = e.target.dataset.c; if (!k || !S.data) return;
      if (k === 'days') { S.days = Number(e.target.value); q('dl').textContent = S.days; load(); return; }
      if (k in S.f && k !== 'store') { S.f[k] = e.target.value; paint(); }
    });
    q('store').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); S.f.store = /^[A-Z]{2}\d{2}$/.test(e.target.value) ? e.target.value : ''; if (S.data) paint(); });
    q('xls').addEventListener('click', () => downloadXlsx(S.rows.map((x) => ({ Store: x.s, Name: x.sname, Dept: x.cname, Brand: x.brand || '', Vendor: x.vendor || '', Required: x.req, 'Different names': x.names, Status: LBL[x.st] })), `3PA_Churn_${S.days}d_${todayIST()}.xlsx`, 'Churn'));
    load();
    return { reload: load };
  }

  /* =====================================================================
     USERS & PIN (ZFM + Admin)
     ===================================================================== */
  function PinReset(root, me, rowsLoader) {
    const V = mount(root, { bar: false });
    V.el.insertAdjacentHTML('beforeend', `<div class="toolrow"><div><h1 class="pt">Users &amp; PIN</h1><div class="sub">Reset clears the PIN. The person creates a new PIN at next login.</div></div>
      <input class="f" data-pr="q" placeholder="Search name / emp / store" style="width:220px"></div><div class="card"><div data-pr="tbl">${spin}</div></div>`);
    let rows = [];
    async function load() {
      V.q('[data-pr="tbl"]').innerHTML = spin;
      try { rows = (await rowsLoader()) || []; } catch (e) { rows = []; }
      if (V.alive()) paint();
    }
    function paint() {
      const qv = V.q('[data-pr="q"]').value.trim().toLowerCase();
      const f = rows.filter((u) => !qv || `${u.name} ${u.emp_code} ${u.store_code || ''} ${u.email || ''}`.toLowerCase().includes(qv));
      V.q('[data-pr="tbl"]').innerHTML = `<div class="tw" style="margin-top:0"><table><thead><tr><th class="l">Emp</th><th class="l">Name</th><th class="l">Role</th><th class="l">Post</th><th class="l">Store</th><th class="l">PIN</th><th class="l"></th></tr></thead><tbody>
        ${f.slice(0, 400).map((u) => `<tr><td class="l">${esc(u.emp_code)}</td><td class="l">${esc(u.name)}</td><td class="l">${esc(roleLabel(u.role))}</td><td class="l">${esc(u.post || '—')}</td><td class="l">${esc(u.store_code || '—')}</td>
          <td class="l">${u.locked ? '<span class="tg red">Locked</span>' : u.pin_set ? '<span class="tg ok">Set</span>' : '<span class="tg amb">Not set</span>'}</td>
          <td class="l">${(u.role !== 'admin' || (me.role === 'admin' && u.emp_code !== me.emp)) && (u.pin_set || u.locked) && !me.view_by ? `<button type="button" class="btn s sm" data-reset="${esc(u.emp_code)}">Reset PIN</button>` : ''}</td></tr>`).join('')
          || '<tr><td colspan="7" class="l" style="color:var(--mut)">No users</td></tr>'}</tbody></table></div>${f.length > 400 ? `<div class="sub">Showing 400 of ${f.length} · search to narrow</div>` : ''}`;
    }
    V.q('[data-pr="q"]').addEventListener('input', paint);
    V.el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-reset]'); if (!b) return;
      if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Tap again to confirm'; b.classList.remove('s'); b.classList.add('r'); return; }
      b.disabled = true;
      const r = await rpc('reset_pin', { p_token: me.token, p_emp: b.dataset.reset });
      if (r && r.ok) {
        if (r.code) modal(`<h3>New setup code</h3><div class="sub" style="font-size:13px">${esc(r.name)} needs this code to create a new PIN (valid 7 days). Share it privately, not in a group.</div>
          <div style="font-size:30px;font-weight:800;letter-spacing:6px;text-align:center;margin:12px 0">${esc(r.code)}</div><div class="mx"><button type="button" class="btn" data-close>Done</button></div>`);
        else toast(`PIN reset for ${r.name}`);
        load();
      } else { toast(errText(r && r.error)); b.disabled = false; }
    });
    load();
    return { reload: load };
  }

  /* ---------- legacy v4 helpers kept for old callers ---------- */
  function kpi(label, value, extra = '', color = '') {
    return `<div class="kpi"><span class="l">${esc(label)}</span><span class="v"${color ? ` style="color:${color}"` : ''}>${value}</span>${extra}</div>`;
  }
  /* Shell(me, items, onPick): v4 nav API → appShell. items: [{grp}|{id,label}]; onPick(id) renders into #view. */
  function Shell(me, items, onPick) {
    const IC = { live: 'ld', approvals: 'ap', team: 'tm', churn: 'ch', reports: 'stm', pins: 'us' };
    const nav = items.filter((i) => i.id).map((i) => [i.id, i.label, IC[i.id] || 'lg']);
    const host = document.getElementById('root') || document.body;
    const ids = nav.map((n) => n[0]), h = (location.hash || '').slice(1), first = ids.includes(h) ? h : ids[0];
    const S = appShell(host, { me, nav, active: first, title: (nav.find((n) => n[0] === first) || [])[1], onNav: (id) => { location.hash = id; S.setTitle((nav.find((n) => n[0] === id) || [])[1]); onPick(id); } });
    if (!document.getElementById('view')) S.wrap.id = 'view';
    if (first) onPick(first);
    return S;
  }

  Object.assign(window, { LiveDash, ApprovalsView, RlpoManualView, StoreTeamView, ChurnView, PinReset, dashPendingCount, Shell, kpi, CR_KIND, crChange });
}());
