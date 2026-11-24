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
     RatingView(root, me, opts?)         → { reload() }   v5.5 staff rating: tasks pending / missed, brand-vendor summary, 1–2 ★ reasons
                                                          (rating_tasks / rating_detail; admin corrects with rating_admin_set). opts.onCount(n) = pending stores.
     ratingPendingCount(me)              → Promise<int>   stores that have not finished rating yesterday (nav badge).
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
.dv .dnz{display:grid;grid-template-columns:repeat(auto-fit,minmax(92px,1fr));gap:8px;margin-top:10px}
.dv .dn{display:flex;flex-direction:column;align-items:center;gap:2px;border:1px solid var(--line);border-radius:10px;padding:8px 4px;background:var(--card);font:inherit;color:var(--ink)}
.dv button.dn{cursor:pointer}.dv button.dn:hover{border-color:var(--acc)}.dv .dn.on{border-color:var(--acc);box-shadow:0 0 0 2px var(--acc-l)}.dv .dn b{font-size:13px}.dv .dn small{font-size:11.5px;color:var(--mut)}.dv .dn.tot{background:var(--acc-l);border-color:transparent}
.dv .mxt th.bl,.dv .mxt td.bl{border-left:2px solid var(--line)}.dv .mxt tr.tot td{font-weight:700;background:var(--hover)}.dv .mxt td{white-space:nowrap}
.dv.noanim svg.ch rect.br{animation:none}
.dv .srcl{margin:1px 0;white-space:nowrap}.dv .srcl small{color:var(--mut);display:inline-block;min-width:58px}
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
    const S = { date: todayIST(), shift: 'B', upto: '', zfm: '', am: '', q: '', cat: '', sub: '', sort: 'hi', alert: '', ndays: 7, weekN: null, wix: null, mx: [],
      view: 'dept', path: [], d: null, week: null, y: null, store: null, seq: 0, lock: '', lines: [], lv: '', bd: null, rt: null, cx: null, all: false };
    const CACHE = new Map();   // v5.5: answers kept in memory → clicks never wait for the network twice
    function cached(key, date, fn) {
      const c = CACHE.get(key), ttl = date >= todayIST() ? 60000 : 36e5;
      if (c && Date.now() - c.t < ttl) return c.p;
      const p = fn().then((r) => { if (!r || !r.ok) CACHE.delete(key); return r; });
      CACHE.set(key, { t: Date.now(), p }); return p;
    }

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
    const subKind = () => (['HK', 'SEC'].includes(S.cat) ? 'Vendor' : 'Brand');
    const bkey = (b, v) => String((b && String(b).trim()) || (v && String(v).trim().replace(/\s+/g, ' ')) || '—').toLowerCase();
    const sl = (n) => { const x = String(n || '').replace(/\b(private|pvt|limited|ltd|llp)\b\.?/gi, '').replace(/\s+/g, ' ').trim() || String(n || ''); return x.length > 22 ? x.slice(0, 21) + '…' : x; };   // short vendor label
    const bdReady = () => !!(S.cat && S.bd && S.bd.rows && S.bd.cat === S.cat);

    /* ---------- fast lookups (v5.5): rows indexed by store once, not filtered per line ---------- */
    function mkIx(rows) { const m = new Map(); (rows || []).forEach((x) => { let a = m.get(x.s); if (!a) m.set(x.s, (a = [])); a.push(x); }); return m; }
    function ixOf(d) { if (!d._ix) Object.defineProperty(d, '_ix', { value: mkIx(d.rows), enumerable: false }); return d._ix; }
    function rowsOf(d, set) { const ix = ixOf(d), out = []; set.forEach((s) => { const a = ix.get(s); if (a) for (const x of a) out.push(x); }); return out; }
    function bdRowsOf(set) { const out = []; if (!bdReady()) return out; set.forEach((s) => { const a = S.bd.ix.get(s); if (a) for (const x of a) out.push(x); }); return out; }
    function scopeStores() {
      const q = S.q.trim().toUpperCase();
      let s = S.d.stores.filter((x) => (!S.zfm || x.zfm === S.zfm) && (!S.am || x.am === S.am) && (!q || x.code.startsWith(q)));
      S.path.forEach((p) => { s = s.filter((x) => (x[p.key] || '—') === p.val); });
      return s;
    }
    // one context per paint: scope, raw rows (dept level), effective rows (brand/vendor filter applied), indexes
    function cx() {
      if (S.cx) return S.cx;
      const stores = scopeStores(), set = new Set(stores.map((s) => s.code)), raw = rowsOf(S.d, set);
      let rows = raw;
      if (S.sub && bdReady()) rows = raw.filter((x) => x.c !== S.cat).concat(bdRowsOf(set).filter((x) => x.k === S.sub));
      S.cx = { stores, set, raw, rows, eix: mkIx(rows), memo: {} };
      return S.cx;
    }
    function totals(rows) { return rows.filter((x) => catOk(x.c)).reduce((a, x) => ({ req: a.req + x.req, p: a.p + Math.min(x.p, x.req) }), { req: 0, p: 0 }); }
    function weekDates() { const end = (S.week && S.weekEnd) || S.date; return Array.from({ length: 7 }, (_, i) => addDays(end, i - 6)); }
    function weekFor(codes, cs) {
      const r = Array(7).fill(0), p = Array(7).fill(0);
      codes.forEach((s) => { const a = S.wix && S.wix.get(s); if (!a) return; a.forEach((x) => { if (cs && !cs.includes(x.c)) return; (x.r || []).forEach((q, i) => { r[i] += q || 0; p[i] += Math.min((x.p || [])[i] || 0, q || 0); }); }); });
      return { r, p };
    }
    function weekBoxes(w) {
      if (!w) return '<span class="hint">dept level only</span>';
      const ds = weekDates();
      return `<span class="hm">${w.r.map((q, i) => { if (!q) return `<i class="n" title="${esc(fmtDay(ds[i]))} · not required"></i>`;
        const v = pct(w.p[i], q); return `<i class="${v >= 90 ? 'g' : v >= 70 ? 'a' : 'r'}" title="${esc(fmtDay(ds[i]))} · ${v}%">${v}</i>`; }).join('')}</span>`;
    }
    const nmOf = (x) => String(typeof x.name === 'string' ? x.name : typeof x.n === 'string' ? x.n : x.k || '');
    const byPct = (a, b) => S.sort === 'az' ? nmOf(a).localeCompare(nmOf(b), 'en', { numeric: true, sensitivity: 'base' }) : (S.sort === 'hi'
      ? (b.req ? b.pc : -1) - (a.req ? a.pc : -1) || b.req - a.req
      : (a.req ? a.pc : 101) - (b.req ? b.pc : 101) || b.req - a.req);
    function nobCats() { const c = ['HK', 'SEC'].filter(hasCat); return c.length ? c : cats().map((x) => x.id); }
    function nobLabel() { const c = ['HK', 'SEC'].filter(hasCat); return c.length === 2 ? 'HK / Security · nobody' : c[0] === 'HK' ? 'HK · nobody' : c[0] === 'SEC' ? 'Security · nobody' : 'Nobody in a dept'; }
    function alertsOn() {
      const d = S.d; if (d.date < d.today) return true; if (d.date > d.today) return false;
      return d.now >= (S.shift === 'E' ? d.alert_e : d.alert_m);
    }
    function alertStores(k) {
      const c = cx(); if (c.memo[k]) return c.memo[k];
      return (c.memo[k] = alertCalc(k, c));
    }
    function alertCalc(k, c) {
      const d = S.d, sc = c.stores, set = c.set, rows = c.rows;
      const zero = (cs) => rows.filter((x) => cs.includes(x.c) && x.req > 0 && x.p === 0).map((x) => ({ s: x.s, info: `${cname(x.c)}${x.k ? ' ' + (S.bd.lab[x.k] || '') : ''} 0 of ${x.req}`, miss: x.req }));
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
      if (k === 'rate') return ((S.rt && S.rt.stores) || []).filter((x) => x.st === 'pending' && set.has(x.s))
        .map((x) => ({ s: x.s, info: `Rating ${x.rated}/${x.n} · ${fmtDay(x.d)}${x.who ? ' · ' + x.who : ''}`, miss: x.n - x.rated }));
      if (k === 'low7') {
        const by = {}; rows.filter((x) => catOk(x.c)).forEach((x) => { const o = by[x.s] || (by[x.s] = { q: 0, p: 0 }); o.q += x.req; o.p += Math.min(x.p, x.req); });
        return Object.entries(by).filter(([, o]) => o.q && pct(o.p, o.q) < d.low_pct).map(([s, o]) => ({ s, info: `${pct(o.p, o.q)}% now`, miss: o.q - o.p }));
      }
      if (k === 'low') {
        const n = Math.max(1, Math.min(Number(d.low_days) || 3, isToday() ? 6 : 7)), last = isToday() ? 5 : 6;
        const idx = Array.from({ length: n }, (_, j) => last - n + 1 + j);
        const by = {}; set.forEach((s) => { (S.wix && S.wix.get(s) || []).filter((x) => catOk(x.c)).forEach((x) => {
          const o = by[x.s] || (by[x.s] = { r: Array(7).fill(0), p: Array(7).fill(0) }); (x.r || []).forEach((q, i) => { o.r[i] += q || 0; o.p[i] += Math.min((x.p || [])[i] || 0, q || 0); }); }); });
        return Object.entries(by).filter(([, o]) => idx.every((i) => o.r[i] > 0 && pct(o.p[i], o.r[i]) < d.low_pct))
          .map(([s, o]) => ({ s, info: idx.map((i) => `${pct(o.p[i], o.r[i])}%`).join(' · '), miss: 0 }));
      }
      return [];
    }
    const ALN = () => ({ hk: 'HK nobody', sec: 'Security nobody', mp: 'SG mis-punch', split: 'HK split not set', photo: 'Selfie due', rate: 'Rating pending (yesterday)',
      low: `Below ${S.d.low_pct}% · ${S.d.low_days} days`, low7: `Below ${S.d.low_pct}% now`, nob: nobLabel() });

    /* ---------- load (only what changed; cached) ---------- */
    async function load(what) {
      what = what || { ov: 1, days: 1 };
      const seq = ++S.seq;
      if (S.d) mainEl.classList.add('busy'); else mainEl.innerHTML = spin;
      const date = S.date, shift = S.shift, upto = S.upto, nd = S.ndays;
      const ovP = what.ov || !S.d ? cached(`ov|${date}|${shift}|${upto}`, date, () => rpc('dash_overview', { p_token: me.token, p_date: date, p_shift: shift, p_upto: upto || null })) : Promise.resolve(S.d);
      const dyP = what.days || !S.weekN ? cached(`dy|${date}|${shift}|${nd}`, date, () => rpc('dash_days', { p_token: me.token, p_end: date, p_shift: shift, p_days: nd })
        .then((x) => (x && x.ok ? x : rpc('dash_week', { p_token: me.token, p_end: date, p_shift: shift })))) : Promise.resolve(null);
      const [r, w] = await Promise.all([ovP, dyP]);
      if (seq !== S.seq || !V.alive()) return;
      mainEl.classList.remove('busy');
      if (!r || !r.ok) { mainEl.innerHTML = errBox(r); return; }
      if (r !== S.d) { S.d = r; S.y = null; }
      if (w) {
        S.weekN = w.ok ? w.rows || [] : []; S.weekEnd = w.ok ? w.end || date : date;
        S.nGot = S.weekN.length ? (S.weekN[0].r || []).length : 7;
        S.week = S.weekN.map((x) => ({ ...x, r: (x.r || []).slice(-7), p: (x.p || []).slice(-7) }));   // 7-day boxes + "low N days"
        S.wix = mkIx(S.week);
      }
      if (S.upto && r.date === r.today && S.upto > r.now) S.upto = '';
      S.lock = r.categories.length === 1 ? r.categories[0].id : '';
      if (S.lock) S.cat = S.lock; else if (S.cat && !hasCat(S.cat)) { S.cat = ''; S.sub = ''; }
      fillSelects(); paint();
      if (S.store) storeDetail(S.store, false);
      loadBrands(); loadRt();
      // "vs yesterday": light totals only (dash_ytot); same checkpoint, or now when live today
      const yUpto = S.upto || (r.date === r.today ? r.now : null), yd = addDays(r.date, -1);
      cached(`y|${yd}|${shift}|${yUpto || ''}`, r.date, () => rpc('dash_ytot', { p_token: me.token, p_date: yd, p_shift: shift, p_upto: yUpto })
        .then((x) => (x && x.ok ? { ok: true, rows: (x.rows || []).map((a) => ({ s: a[0], c: a[1], req: a[2], p: a[3] })) } : rpc('dash_overview', { p_token: me.token, p_date: yd, p_shift: shift, p_upto: yUpto }))))
        .then((y) => { if (seq !== S.seq || !V.alive()) return; S.y = y && y.ok ? y : false; paintKpis(); });
    }
    // brand (Travel / CDIT) or vendor (HK / Security) rows: only when a dept is picked
    function loadBrands() {
      if (!S.cat || !S.d) return;
      const key = `bd|${S.date}|${S.shift}|${S.upto}|${S.cat}`;
      if (S.bd && S.bd.key === key) return;
      const cat = S.cat; S.bd = { key, cat, loading: true };
      cached(key, S.date, () => rpc('dash_brands', { p_token: me.token, p_date: S.date, p_shift: S.shift, p_upto: S.upto || null, p_cat: cat })).then((r) => {
        if (!V.alive() || !S.bd || S.bd.key !== key) return;
        if (!r || !r.ok) { S.bd = { key, cat, err: true }; paint(); return; }
        const lab = {}, rows = (r.rows || []).map((a) => { const k = bkey(a[2]); if (!lab[k]) lab[k] = a[2]; return { s: a[0], c: a[1], k, req: a[3], p: a[4] }; });
        S.bd = { key, cat, rows, lab, ix: mkIx(rows) };
        if (S.sub && !lab[S.sub]) S.sub = '';
        S.cx = null; paint();
      });
    }
    function loadRt() {
      if (S.rt || me.role === 'store') return;
      const yd = addDays(todayIST(), -1); S.rt = { stores: [] };
      cached(`rt|${yd}`, yd, () => rpc('rating_tasks', { p_token: me.token, p_from: yd, p_to: yd })).then((r) => {
        if (!V.alive() || !r || !r.ok) return; S.rt = r; if (S.cx) S.cx.memo = {}; paintStrip(); });
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
        !((me.role === 'am' || me.role === 'rlpo') && (v === 'zfm' || v === 'am')) && !(me.role === 'zfm' && v === 'zfm') && !(S.lock && v === 'dept' && !bdReady()));
    }
    // brand / vendor keys inside the current scope, biggest requirement first
    function subKeys() {
      if (!bdReady()) return [];
      const m = new Map(); bdRowsOf(cx().set).forEach((x) => { const o = m.get(x.k) || { k: x.k, name: S.bd.lab[x.k] || x.k, q: 0, p: 0 }; o.q += x.req; o.p += Math.min(x.p, x.req); m.set(x.k, o); });
      return [...m.values()].sort((a, b) => b.q - a.q || a.name.localeCompare(b.name));
    }
    function paint() {
      if (!S.d) return;
      S.cx = null;
      const vs = views(); if (!vs.some((v) => v[0] === S.view)) S.view = vs.some((v) => v[0] === defView) ? defView : vs[0][0];
      const d = S.d, cs = cats(), today = isToday();
      const tsel = `<div class="seg" title="Dashboard as of a fixed time">${CP.map(([v, l]) => { const pend = today && v && v > d.now;
        return `<button type="button" data-cp="${v}" class="${S.upto === v ? 'on' : ''}"${pend ? ' disabled title="Not reached yet"' : ''}>${l}</button>`; }).join('')}</div>`;
      const keys = subKeys(), top = keys.slice(0, 7), rest = keys.slice(7);
      const subRow = !S.cat ? '' : `<div class="toolrow" style="background:var(--card);border:1px solid var(--line);border-radius:10px;padding:6px 10px"><div class="pills">
        <span class="sub" style="margin:0 4px 0 0;font-weight:700">${esc(cname(S.cat)).toUpperCase()} ${subKind().toUpperCase()}</span>
        ${S.bd && S.bd.loading ? '<span class="hint">loading…</span>' : S.bd && S.bd.err ? '<span class="hint">not available</span>' : `<button type="button" class="pill ${!S.sub ? 'on' : ''}" data-sub="">All ${subKind().toLowerCase()}s</button>${top.map((x) => `<button type="button" class="pill ${S.sub === x.k ? 'on' : ''}" data-sub="${esc(x.k)}" title="${esc(x.name)}">${esc(sl(x.name))}</button>`).join('')}
        ${rest.length ? `<select data-subsel aria-label="More"><option value="">+ ${rest.length} more ▾</option>${rest.map((x) => `<option value="${esc(x.k)}"${S.sub === x.k ? ' selected' : ''}>${esc(sl(x.name))}</option>`).join('')}</select>` : ''}`}</div>
        <span class="hint">Pick a ${subKind().toLowerCase()} → KPIs, dept summary and gaps show only that ${subKind().toLowerCase()}</span></div>`;
      mainEl.innerHTML = `
      <div class="toolrow"><div class="pills">${S.lock ? `<span class="pill on">${esc(cname(S.lock))}</span>`
        : `<button type="button" class="pill ${!S.cat ? 'on' : ''}" data-cat="">All depts</button>${cs.map((c) => `<button type="button" class="pill ${S.cat === c.id ? 'on' : ''}" data-cat="${esc(c.id)}">${esc(catName(c))}</button>`).join('')}`}</div>
        <div class="pills"><div class="seg">${SHIFTS.map(([v, l]) => `<button type="button" data-sh="${v}" class="${S.shift === v ? 'on' : ''}">${l}</button>`).join('')}</div>${tsel}</div></div>
      ${subRow}
      <div class="kpis" data-ld="kpis"></div>
      <div class="astrip" data-ld="strip"></div>
      <div class="cols">
        <div class="card"><div class="hd"><div><h2>Last ${S.ndays} days</h2><div class="sub">Present % of required, end of day${S.cat ? ' · ' + esc(cname(S.cat)) + ' (dept level)' : ''}. ${today ? 'Today is live. ' : ''}Lighter bars are Sat and Sun. Click a bar to open that day.</div></div>
          <div class="seg" role="radiogroup" aria-label="Days">${[7, 10, 15].map((k) => `<button type="button" role="radio" aria-checked="${S.ndays === k}" data-nd="${k}" class="${S.ndays === k ? 'on' : ''}">${S.ndays === k ? '◉' : '○'} ${k} days</button>`).join('')}</div></div><div data-ld="trend"></div></div>
        <div class="card"><h2>Dept-wise · required vs present</h2><div class="sub">Present % of required.${S.lock ? '' : ' Click a dept to filter.'}</div><div data-ld="lad"></div></div>
      </div>
      <div class="card" data-ld="mx"></div>
      <div class="card" data-ld="gap"></div>`;
      const c = cx();
      if (!S.painted) { S.painted = true; setTimeout(() => mainEl.classList.add('noanim'), 600); }   // bars grow once, not on every click
      paintKpis(); paintStrip(); paintTrend(c.stores); paintLadder(c.raw); paintMatrix(c.stores); paintGap(c.stores, c.rows);
    }
    function paintStrip() {
      const box = V.q('[data-ld="strip"]'); if (!box || !S.d) return;
      const d = S.d, names = ALN();
      const AL = [['hk', 'r'], ['sec', 'r'], ['mp', 'a'], ['split', 'a'], ['low', 'a'], ['photo', 'i']].filter(([k]) =>
        !(k === 'hk' && (!hasCat('HK') || !catOk('HK'))) && !(k === 'split' && (!hasCat('HK') || !catOk('HK')))
        && !(k === 'sec' && (!hasCat('SEC') || !catOk('SEC'))) && !(k === 'mp' && (!hasCat('SEC') || !catOk('SEC'))));
      const chip = ([k, c]) => { const l = alertStores(k), n = k === 'photo' || k === 'mp' ? l.reduce((a, x) => a + x.miss, 0) : l.length;
        return `<button type="button" class="ach ${c} ${S.alert === k ? 'on' : ''} ${n ? '' : 'zero'}" data-al="${k}" title="${k === 'mp' ? 'Guards with IN but no OUT on ' + esc(fmtDay(d.mispunch_date || d.date)) : k === 'rate' ? 'SM / ASM have not finished rating yesterday’s staff' : ''}">${esc(names[k])} <b>${n}</b></button>`; };
      box.innerHTML = `<span class="t">⚡ Action needed</span>${alertsOn() ? AL.map(chip).join('')
        : `<span class="sub" style="margin:0">Starts at ${esc(S.shift === 'E' ? d.alert_e : d.alert_m)} for this shift (Settings)</span>`}${me.role !== 'store' ? chip(['rate', 'a']) : ''}`;
    }
    function paintKpis() {
      const box = V.q('[data-ld="kpis"]'); if (!box || !S.d) return;
      const d = S.d, c = cx(), stores = c.stores, rows = c.rows;
      const tot = totals(rows), tp = pct(tot.p, tot.req), tp1 = pct1(tot.p, tot.req);
      const by = {}; rows.filter((x) => catOk(x.c)).forEach((x) => { const o = by[x.s] || (by[x.s] = { req: 0, p: 0 }); o.req += x.req; o.p += Math.min(x.p, x.req); });
      const withReq = Object.values(by).filter((o) => o.req), full = withReq.filter((o) => o.p >= o.req).length;
      const low = alertStores('low7').length, nob = alertStores('nob').length;
      let dl = '<span class="hint">vs yesterday …</span>';
      if (S.y === false || S.sub) dl = S.sub ? `<span class="hint">${esc(S.bd.lab[S.sub] || '')} only</span>` : '';
      else if (S.y) {
        const yt = totals(rowsOf(S.y, c.set)); const y1 = pct1(yt.p, yt.req), v = +(tp1 - y1).toFixed(1);
        const at = S.upto ? 'at ' + CP.find((x) => x[0] === S.upto)[1] : isToday() ? 'at same time' : '';
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
      const n = S.nGot || 7, end = S.weekEnd || S.date, ds = Array.from({ length: n }, (_, i) => addDays(end, i - (n - 1)));
      const set = new Set(stores.map((s) => s.code)), w = { r: Array(n).fill(0), p: Array(n).fill(0) };
      (S.weekN || []).forEach((x) => { if (!set.has(x.s) || (S.cat && x.c !== S.cat)) return; (x.r || []).forEach((q, i) => { w.r[i] += q || 0; w.p[i] += Math.min((x.p || [])[i] || 0, q || 0); }); });
      const v = w.r.map((q, i) => (q ? pct(w.p[i], q) : null));
      const prev = v.slice(0, n - 1).filter((x) => x != null), avg = prev.length ? +(prev.reduce((a, b) => a + b, 0) / prev.length).toFixed(1) : null;
      const W = 560, H = 190, bw = Math.min(44, ((W - 40) / n) * 0.72), gap = n > 1 ? (W - 40 - bw * n) / (n - 1) : 0, y = (x) => H - 28 - (Math.min(x, 100) / 100) * (H - 50);
      V.q('[data-ld="trend"]').innerHTML = `<svg class="ch" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;margin-top:6px" role="img" aria-label="Present % for the last ${n} days">
        ${[0, 25, 50, 75, 100].map((t) => `<line x1="30" x2="${W}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="24" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
        ${avg != null ? `<line x1="30" x2="${W}" y1="${y(avg)}" y2="${y(avg)}" stroke="var(--grey)" stroke-dasharray="4 4"/><text x="${W}" y="10" text-anchor="end">- - - ${prev.length}-day avg ${avg}%</text>` : ''}
        ${v.map((x, i) => { const X = 36 + i * (bw + gap), dd = dayLbl(ds[i]), last = i === n - 1, c = last ? 'var(--acc)' : isWeekend(ds[i]) ? 'var(--wk)' : 'var(--pri)';
          return `<g data-day="${ds[i]}" style="cursor:pointer"><title>${esc(fmtDate(ds[i]))}${x == null ? ' · not required' : ` · ${x}% (${fmt(w.p[i])} / ${fmt(w.r[i])})`}</title>
            <rect x="${X}" y="0" width="${bw}" height="${H - 28}" fill="transparent"/>
            ${x == null ? `<text x="${X + bw / 2}" y="${y(0) - 6}" text-anchor="middle">—</text>` : `<rect class="br" x="${X}" y="${y(x)}" width="${bw}" height="${Math.max(y(0) - y(x), 1)}" rx="4" fill="${c}"/><text class="b" x="${X + bw / 2}" y="${y(x) - 6}" text-anchor="middle"${n > 10 ? ' style="font-size:9px"' : ''}>${x}</text>`}
            <text x="${X + bw / 2}" y="${H - 14}" text-anchor="middle"${last ? ' class="b"' : ''}${n > 10 ? ' style="font-size:9px"' : ''}>${n > 10 ? dd[1] : dd[0]}</text>${n > 10 ? '' : `<text x="${X + bw / 2}" y="${H - 2}" text-anchor="middle">${dd[1]}</text>`}</g>`; }).join('')}</svg>`;
    }
    const donut = (v, c, size = 84) => { const R = 30, C = 2 * Math.PI * R, L = C * Math.min(v, 100) / 100;
      return `<svg width="${size}" height="${size}" viewBox="0 0 86 86" aria-hidden="true"><circle cx="43" cy="43" r="${R}" fill="none" stroke="var(--track)" stroke-width="11"/><circle cx="43" cy="43" r="${R}" fill="none" stroke="${c}" stroke-width="11" stroke-dasharray="${L} ${C}" transform="rotate(-90 43 43)" stroke-linecap="round"/><text x="43" y="48" text-anchor="middle" font-size="16" font-weight="800" fill="var(--ink)">${v}%</text></svg>`; };
    function paintLadder(raw) {
      const cs = S.lock ? cats().filter((c) => c.id === S.lock) : cats();
      const ix = mkIx(raw);
      const sums = cs.map((c) => { let q = 0, p = 0; const z = new Set(); ix.forEach((a, s) => a.forEach((x) => { if (x.c !== c.id) return; q += x.req; p += Math.min(x.p, x.req); if (x.req && !x.p) z.add(s); }));
        return { c, q, p, v: pct(p, q), z: z.size }; });
      let sg = '';
      const g = S.d.sg_counts;
      if (g && hasCat('SEC') && catOk('SEC')) {
        const filtered = S.zfm || S.am || S.q || S.path.length;
        sg = `<div class="sub" style="margin-top:12px;font-weight:700">Security ${S.d.sg_final ? '· final (hours rule)' : '· live (punched IN)'}${filtered ? ' · all your stores' : ''}</div>
          <div class="sgrow"><span class="tg ok" title="Present">P ${fmt(g.P)}</span><span class="tg acc" title="Manual present by RLPO">P* ${fmt(g.Pstar)}</span><span class="tg amb" title="Half day">H ${fmt(g.H)}</span><span class="tg red" title="Absent">A ${fmt(g.A)}</span><span class="tg grey" title="IN without OUT: counts Absent until RLPO decides">MP ${fmt(g.MP)} (A till RLPO)</span></div>`;
      }
      // v5.5: brand (Travel / CDIT) or vendor (HK / Security) donuts for the picked dept · top 7 by requirement, highest % first
      let bx = '';
      if (S.cat) {
        const keys = subKeys(), top = keys.slice(0, 7), rest = keys.slice(7);
        const more = rest.reduce((o, x) => ({ q: o.q + x.q, p: o.p + x.p }), { q: 0, p: 0 });
        const L = top.map((x) => ({ ...x, v: pct(x.p, x.q) })).sort((a, b) => b.v - a.v || b.q - a.q);
        bx = `<div style="border:1px dashed var(--acc);border-radius:10px;padding:8px 10px;margin-top:10px"><b style="font-size:12px">${esc(cname(S.cat)).toUpperCase()} · ${subKind().toUpperCase()}-WISE</b>
          ${S.bd && S.bd.loading ? `<div>${spin}</div>` : !keys.length ? '<div class="hint">No requirement in this view</div>' : `<div class="dnz">${L.map((x) => `<button type="button" class="dn ${S.sub === x.k ? 'on' : ''}" data-sub="${S.sub === x.k ? '' : esc(x.k)}" title="${esc(x.name)}: ${fmt(x.p)} of ${fmt(x.q)}">
            ${x.q ? donut(x.v, col(x.v)) : donut(0, 'var(--track)')}<b>${esc(sl(x.name))}</b><small>${x.q ? `${fmt(x.p)} / ${fmt(x.q)}` : 'Not required'}</small></button>`).join('')}
            ${rest.length ? `<div class="dn">${donut(pct(more.p, more.q), col(pct(more.p, more.q)))}<b>+ ${rest.length} more</b><small>${fmt(more.p)} / ${fmt(more.q)}</small></div>` : ''}</div>`}</div>`;
      }
      V.q('[data-ld="lad"]').innerHTML = `<div class="dnz">${sums.map((x) => `<button type="button" class="dn ${S.cat === x.c.id ? 'on' : ''}" data-cat="${S.lock ? esc(x.c.id) : S.cat === x.c.id ? '' : esc(x.c.id)}" title="${esc(catName(x.c))}: ${fmt(x.p)} of ${fmt(x.q)}">
          ${x.q ? donut(x.v, col(x.v)) : donut(0, 'var(--track)')}<b>${esc(catName(x.c))}</b><small>${x.q ? `${fmt(x.p)} / ${fmt(x.q)}` : 'Not required'}</small>${x.z ? `<small style="color:var(--red)">${x.z} store${pl(x.z)} with 0</small>` : ''}</button>`).join('')}</div>
        ${bx}
        <div class="leg"><span><i style="background:var(--ok)"></i>90%+</span><span><i style="background:var(--amb)"></i>70–90%</span><span><i style="background:var(--red)"></i>Below 70%</span></div>${sg}`;
    }
    const sortSeg = () => `<div class="seg" title="Sort by %"><button type="button" data-sort="hi" class="${S.sort === 'hi' ? 'on' : ''}">▼ High % first</button><button type="button" data-sort="lo" class="${S.sort === 'lo' ? 'on' : ''}">▲ Low % first</button><button type="button" data-sort="az" class="${S.sort === 'az' ? 'on' : ''}" title="ZFM / AM / store name A–Z">A–Z name</button></div>`;
    const CAP = 150;
    const capRow = (n, cols) => (n > CAP && !S.all ? `<tr><td class="l" colspan="${cols}"><button type="button" class="btn s sm" data-all="1">Show all ${fmt(n)} rows</button> <span class="hint">first ${CAP} shown for speed</span></td></tr>` : '');
    /* dept summary: depts (or brands / vendors of the picked dept) in columns (Req / Avl / %), National by ZFM → AM → Store */
    function paintMatrix(stores) {
      const el = V.q('[data-ld="mx"]'); if (!el) return;
      const start = me.role === 'am' || me.role === 'rlpo' ? 'store' : me.role === 'zfm' ? 'am' : 'zfm';
      const path = S.mx || [], lv = path.length ? path[path.length - 1].next : start;
      let st = stores; path.forEach((p) => { st = st.filter((x) => (x[p.key] || '—') === p.val); });
      // columns + which rows feed them
      let cols, colOf, ix, totName = 'Total';
      if (bdReady()) {
        const keys = subKeys().filter((x) => !S.sub || x.k === S.sub);
        const many = keys.length > 5, topK = many ? keys.slice(0, 3) : keys, topSet = new Set(topK.map((x) => x.k));
        cols = topK.map((x) => [x.k, sl(x.name)]); if (many) cols.push(['_o', `Others (${keys.length - 3})`]);
        colOf = (r) => (S.sub && r.k !== S.sub ? null : topSet.has(r.k) ? r.k : many ? '_o' : null);
        ix = S.bd.ix; totName = `${cname(S.cat)}${S.sub ? ' · ' + (S.bd.lab[S.sub] || '') : ''} total`;
      } else {
        const cs = S.lock ? cats().filter((c) => c.id === S.lock) : cats();
        cols = cs.map((c) => [c.id, catName(c)]); colOf = (r) => r.c; ix = ixOf(S.d);
      }
      const K = { zfm: (s) => s.zfm || '—', am: (s) => s.am || '—', store: (s) => s.code }, N = { zfm: (s) => s.zfm_name || s.zfm || '—', am: (s) => s.am_name || s.am || '—', store: (s) => `${s.code} · ${s.name || ''}` };
      const g = new Map(), all = { c: {}, t: { q: 0, p: 0 } };
      const add = (o, k, r) => { const x = o.c[k] || (o.c[k] = { q: 0, p: 0 }); x.q += r.req; x.p += Math.min(r.p, r.req); o.t.q += r.req; o.t.p += Math.min(r.p, r.req); };
      st.forEach((s) => { const k = K[lv](s); let o = g.get(k); if (!o) g.set(k, (o = { k, n: N[lv](s), c: {}, t: { q: 0, p: 0 } }));
        (ix.get(s.code) || []).forEach((r) => { const ck = colOf(r); if (ck == null) return; add(o, ck, r); const a = all.c[ck] || (all.c[ck] = { q: 0, p: 0 }); a.q += r.req; a.p += Math.min(r.p, r.req); all.t.q += r.req; all.t.p += Math.min(r.p, r.req); }); });
      const cell = (o) => { o = o || { q: 0, p: 0 }; const v = pct(o.p, o.q); return `<td class="bl">${o.q ? fmt(o.q) : '—'}</td><td>${o.q || o.p ? fmt(o.p) : '—'}</td><td>${o.q ? `<span class="tg ${v >= 90 ? 'ok' : v >= 70 ? 'amb' : 'red'}">${v}%</span>` : ''}</td>`; };
      const lines = [...g.values()].map((x) => ({ ...x, req: x.t.q, pc: pct(x.t.p, x.t.q) })).sort(byPct);
      const shown = S.all ? lines : lines.slice(0, CAP);
      const head = { zfm: 'ZFM', am: 'AM', store: 'Store' }[lv];
      el.innerHTML = `<div class="hd"><div><h2>Department summary · Required / Available${S.cat && bdReady() ? ' · ' + esc(cname(S.cat)) + ' by ' + subKind().toLowerCase() : ''}</h2><div class="sub">${lv === 'store' ? 'Stores' : 'Click a row to drill down'} · ${S.sort === 'az' ? 'name A–Z' : S.sort === 'hi' ? 'highest % first' : 'lowest % first'}</div></div>${sortSeg()}</div>
        <div class="bc" style="margin-top:6px"><button type="button" data-mx="-1">${me.role === 'admin' || me.role === 'hodept' ? 'National' : 'All my stores'}</button>${path.map((p, i) => ` › <button type="button" data-mx="${i}">${esc(p.name)}</button>`).join('')}</div>
        <div class="tw"><table class="mxt"><thead><tr><th class="l" rowspan="2">${head}</th>${cols.map((c) => `<th colspan="3" class="bl" style="text-align:center">${esc(c[1])}</th>`).join('')}<th colspan="3" class="bl" style="text-align:center">${esc(totName)}</th></tr>
        <tr>${[...cols, 0].map(() => '<th class="bl">Req</th><th>Avl</th><th>%</th>').join('')}</tr></thead><tbody>
        ${shown.map((x) => `<tr class="click" data-mxk="${esc(x.k)}" data-mxn="${esc(x.n)}"${lv === 'store' ? ' data-mxstore="1"' : ''}><td class="l"><span class="lk">${esc(x.n)}</span>${lv === 'store' ? '' : ' ›'}</td>${cols.map((c) => cell(x.c[c[0]])).join('')}${cell(x.t)}</tr>`).join('') || '<tr><td class="l" colspan="40" style="color:var(--mut)">No stores</td></tr>'}
        ${capRow(lines.length, cols.length * 3 + 4)}
        ${lines.length > 1 ? `<tr class="tot"><td class="l"><b>Total</b></td>${cols.map((c) => cell(all.c[c[0]])).join('')}${cell(all.t)}</tr>` : ''}</tbody></table></div>`;
    }
    function level() { return S.alert ? 'store' : S.path.length ? S.path[S.path.length - 1].next : S.view; }
    function gapLines(stores, rows) {
      const lv = level(), eix = cx().eix;
      if (lv === 'dept') {
        if (bdReady()) {   // brand / vendor lines of the picked dept
          const m = new Map(); bdRowsOf(cx().set).forEach((x) => { if (S.sub && x.k !== S.sub) return; const o = m.get(x.k) || { key: x.k, name: S.bd.lab[x.k] || x.k, st: new Set(), z: new Set(), req: 0, p: 0 };
            o.req += x.req; o.p += Math.min(x.p, x.req); if (x.req) o.st.add(x.s); if (x.req && !x.p) o.z.add(x.s); m.set(x.k, o); });
          return [...m.values()].map((o) => ({ key: o.key, name: o.name, sub: true, n: o.st.size, req: o.req, p: o.p, pc: pct(o.p, o.req), zero: o.z.size, wk: null })).filter((l) => l.req || l.p);
        }
        return cats().filter((c) => catOk(c.id)).map((c) => { let req = 0, p = 0; const st = new Set(), z = new Set();
          eix.forEach((a, s) => a.forEach((x) => { if (x.c !== c.id) return; req += x.req; p += Math.min(x.p, x.req); if (x.req) st.add(s); if (x.req && !x.p) z.add(s); }));
          return { key: c.id, name: catName(c), n: st.size, req, p, pc: pct(p, req), zero: z.size, wk: weekFor(stores.map((s) => s.code), [c.id]) }; })
          .filter((l) => l.req || l.p);
      }
      let fs = stores;
      if (S.alert) { const m = new Map(alertStores(S.alert).map((x) => [x.s, x])); fs = stores.filter((s) => m.has(s.code)).map((s) => ({ ...s, _i: m.get(s.code).info })); }
      const K = { zfm: (s) => s.zfm || '—', am: (s) => s.am || '—', store: (s) => s.code };
      const N = { zfm: (s) => s.zfm_name || s.zfm || '—', am: (s) => s.am_name || s.am || '—', store: (s) => s.name || '' };
      const g = new Map();
      fs.forEach((s) => { const k = K[lv](s); let o = g.get(k);
        if (!o) g.set(k, (o = { key: k, name: N[lv](s), zfm: s.zfm_name || '—', am: s.am_name || '—', stores: [], info: s._i, req: 0, p: 0, z: 0 }));
        o.stores.push(s.code);
        let zr = false; (eix.get(s.code) || []).forEach((r) => { if (!catOk(r.c)) return; o.req += r.req; o.p += Math.min(r.p, r.req); if (r.req && !r.p) zr = true; });
        if (zr) o.z++; });
      return [...g.values()].map((x) => ({ ...x, n: x.stores.length, pc: pct(x.p, x.req), zero: x.z, wk: weekFor(x.stores, S.cat ? [S.cat] : null) }));
    }
    function paintGap(stores, rows) {
      const lv = level(), lines = gapLines(stores, rows).sort(byPct);
      S.lines = lines; S.lv = lv;
      const subD = lv === 'dept' && bdReady();
      const head = subD ? subKind() : { zfm: 'ZFM', am: 'AM', store: 'Store', dept: 'Dept' }[lv];
      const chips = [S.cat && !S.lock && `<button type="button" class="chip" data-clr="cat">${esc(cname(S.cat))} ✕</button>`,
        S.sub && bdReady() && `<button type="button" class="chip" data-clr="sub">${esc(S.bd.lab[S.sub] || '')} ✕</button>`,
        S.alert && `<button type="button" class="chip" data-clr="alert">${esc(ALN()[S.alert])} ✕</button>`,
        S.q && `<button type="button" class="chip" data-clr="q">Store ${esc(S.q.toUpperCase())} ✕</button>`].filter(Boolean).join(' ');
      const shown = S.all ? lines : lines.slice(0, CAP);
      V.q('[data-ld="gap"]').innerHTML = `<div class="hd"><div><h2>Where the gaps are</h2><div class="sub">${S.sort === 'az' ? 'Name A–Z' : S.sort === 'hi' ? 'Highest % first' : 'Lowest % first'} · click a row to ${lv === 'store' ? 'see people' : 'open'}</div></div>
        <div class="pills"><span class="sub" style="margin:0 4px 0 0;font-weight:700">VIEW BY</span>${views().map(([v, l]) => `<button type="button" class="pill ${S.view === v && !S.alert && !S.path.length ? 'on' : ''}" data-vw="${v}">${v === 'dept' && bdReady() ? subKind() : l}</button>`).join('')}${sortSeg()}</div></div>
        <div class="bc" style="margin-top:8px"><button type="button" data-bc="-1">All</button>${S.path.map((p, i) => ` › <button type="button" data-bc="${i}">${esc(p.name)}</button>`).join('')} ${chips}</div>
        <div class="tw"><table><thead><tr><th class="l">${head}</th>${lv === 'am' ? '<th class="l">ZFM</th>' : ''}${lv === 'store' && me.role !== 'am' ? '<th class="l">AM</th>' : ''}${lv !== 'store' ? '<th>Stores</th>' : ''}<th>Required</th><th>Present</th><th>Gap</th><th>%</th><th class="l">${lv === 'store' ? 'Status' : 'Stores with a gap'}</th>${S.alert ? '<th class="l">Why</th>' : ''}<th class="l">Last 7 days (%)</th></tr></thead><tbody>
        ${shown.map((l) => `<tr class="click" data-k="${esc(l.key)}" data-n="${esc(lv === 'store' ? l.key + ' · ' + l.name : l.name)}"${l.sub ? ' data-subrow="1"' : ''}><td class="l"><span class="lk">${esc(lv === 'store' ? l.key : l.name)}</span>${lv === 'store' ? ' ' + esc(l.name) : ''}</td>${lv === 'am' ? `<td class="l">${esc(l.zfm)}</td>` : ''}${lv === 'store' && me.role !== 'am' ? `<td class="l">${esc(l.am)}</td>` : ''}${lv !== 'store' ? `<td>${l.n}</td>` : ''}
          <td>${fmt(l.req)}</td><td>${fmt(l.p)}</td><td style="color:${l.req - l.p ? 'var(--red)' : 'var(--mut)'};font-weight:700">${l.req - l.p ? '-' + fmt(l.req - l.p) : '0'}</td><td>${l.req ? heat(l.pc) : '—'}</td>
          <td class="l">${l.zero ? `<span class="tg red">${lv === 'store' ? (S.lock ? 'Nobody' : 'Nobody in a dept') : l.zero + ' store' + pl(l.zero)}</span>` : lv === 'store' ? (!l.req ? '<span class="tg grey">Not required</span>' : l.pc >= 90 ? '<span class="tg ok">On track</span>' : '<span class="tg amb">Short</span>') : '—'}</td>${S.alert ? `<td class="l">${esc(l.info || '')}</td>` : ''}
          <td class="l">${weekBoxes(l.wk)}</td></tr>`).join('') || '<tr><td colspan="10" class="l" style="color:var(--mut)">No stores here</td></tr>'}
          ${capRow(lines.length, 10)}</tbody></table></div>`;
    }

    /* ---------- store detail (Security = status only, never times) ---------- */
    const SGT = { P: '<span class="tg ok">P</span>', H: '<span class="tg amb">H · half day</span>', A: '<span class="tg red">A</span>',
      MP: '<span class="tg grey">MP · with RLPO</span>', 'P*': '<span class="tg acc">P* · RLPO exception</span>', IN: '<span class="tg info">On duty</span>' };
    async function storeDetail(code, scroll = true) {
      S.store = code;
      sdEl.innerHTML = `<div class="card">${spin}</div>`;
      const date = S.date, shift = S.shift;
      const r = await cached(`sd|${code}|${date}|${shift}`, date, () => rpc('dash_store', { p_token: me.token, p_store: code, p_date: date, p_shift: shift }));
      if (!V.alive() || S.store !== code || date !== S.date || shift !== S.shift) return;
      if (!r || !r.ok) { sdEl.innerHTML = `<div class="card">${errBox(r)}</div>`; return; }
      const s = (S.d && S.d.stores.find((x) => x.code === code)) || {};
      const subOk = (x) => !S.sub || !bdReady() || x.c !== S.cat || bkey(x.brand, x.vendor) === S.sub;
      const gk = (c, b) => c + '|' + (b || ''); const groups = new Map();
      (r.slots || []).filter((x) => catOk(x.c) && subOk(x)).forEach((x) => groups.set(gk(x.c, x.brand), { c: x.c, brand: x.brand || '', vendor: x.vendor || '', req: x.req, p: x.p, co: x.co, ppl: [] }));
      (r.present || []).filter((a) => catOk(a.c) && subOk(a)).forEach((a) => { const k = gk(a.c, a.brand); if (!groups.has(k)) groups.set(k, { c: a.c, brand: a.brand || '', vendor: a.vendor || '', req: 0, p: 0, ppl: [] }); groups.get(k).ppl.push(a); });
      const stm = (a) => `<a class="lk" href="statement.html?s=${encodeURIComponent(code)}&a=${encodeURIComponent(a.id)}&from=${monthStart(date)}&to=${date}">Statement</a>`;
      const photo = (a) => (a.photo === 'done' ? `<button class="btn ghost sm" style="padding:2px 6px" title="View selfie" data-selfie="${esc(a.id)}|${esc(date)}">📷</button> ${a.live === 'fail' ? '<span class="tg red">Live ✕</span>' : a.live === 'pass' ? '<span class="tg ok">Live ✓</span>' : ''} ` : a.photo === 'pending' ? '<span class="tg red">Selfie due</span> ' : '');
      const body = [...groups.values()].map((g) => {
        const sec = g.c === 'SEC', n = Math.max(g.ppl.length, 1);
        const pr = sec ? g.p : Math.max(g.p, 0);
        const head = `<td class="l" rowspan="${n}" style="vertical-align:top"><b>${esc(cname(g.c))}</b>${g.brand ? `<small>${esc(g.brand)}</small>` : ''}${g.vendor ? `<small>Vendor: ${esc(g.vendor)}</small>` : ''}${sec ? `<small>${esc(r.sg_set || s.sg_set || 8)}-hr set · RLPO ${esc(r.rlpo_name || s.rlpo_name || '—')}</small>` : ''}${g.co ? `<small>${g.co} comp-off</small>` : ''}</td>
          <td rowspan="${n}" style="vertical-align:top">${g.req}</td><td rowspan="${n}" style="vertical-align:top">${pr}</td>
          <td class="l" rowspan="${n}" style="vertical-align:top">${g.req > pr ? `<span class="tg red">Missing ${g.req - pr}</span>` : '<span class="tg ok">OK</span>'}</td>`;
        if (!g.ppl.length) return `<tr>${head}<td class="l" colspan="7" style="color:var(--red);font-weight:700">${g.req ? 'Nobody has punched' : '—'}</td></tr>`;
        return g.ppl.map((a, i) => `<tr>${i ? '' : head}<td class="l">${esc(a.name)}</td><td class="l">${esc(a.code || '')}</td>${sec
          ? `<td class="l" colspan="3">${SGT[a.st] || (a.st ? `<span class="tg grey">${esc(a.st)}</span>` : SGT.IN)}</td>`
          : `<td>${esc(a.first_in || '—')}</td><td>${a.last_out ? esc(a.last_out) : a.out_done ? 'OUT ✓' : '—'}</td><td>${a.hours ?? '—'}</td>`}
          <td class="l">${(a.src || []).length ? (a.src).map((p) => `<div class="srcl"><small>${esc(p.k)}${p.t ? ' ' + esc(p.t) : ''}</small> ${punchSrc(p)}</div>`).join('') : a.via_mod ? '<span class="tg acc">🏪 Store</span>' : '<span class="tg info">📱 Own</span>'}</td><td class="l">${sec ? '' : photo(a)}${stm(a)}</td></tr>`).join('');
      }).join('');
      const hk = r.hk && hasCat('HK') && catOk('HK') ? (r.hk.set ? ` · HK split M ${r.hk.morning} / E ${r.hk.evening}` : ` · <span style="color:var(--amb)">HK split not set (total ${r.hk.total} in Morning)</span>`) : '';
      const regs = (r.regulars_missing || []).filter((a) => catOk(a.c));
      sdEl.innerHTML = `<div class="card"><div class="hd"><div><h2>${esc(code)} · ${esc(r.store_name || s.name || '')}</h2>
        <div class="sub">${s.am_name ? 'AM ' + esc(s.am_name) + ' · ' : ''}${s.zfm_name ? 'ZFM ' + esc(s.zfm_name) + ' · ' : ''}${esc(fmtDate(date))} · ${SHN[shift]}${S.sub && bdReady() ? ' · ' + esc(S.bd.lab[S.sub] || '') + ' only' : ''}${hk}${hasCat('SEC') && catOk('SEC') ? ' · Security shows status only (no timing)' : ''}</div></div>
        <button type="button" class="btn s sm" data-x="closesd">✕ Close</button></div>
        <div class="tw"><table><thead><tr><th class="l">Dept</th><th>Required</th><th>Present</th><th class="l">Status</th><th class="l">Name</th><th class="l">Code</th><th>IN</th><th>OUT</th><th>Hours</th><th class="l">Punched from</th><th class="l">Photo · Statement</th></tr></thead>
        <tbody>${body || '<tr><td class="l" colspan="11" style="color:var(--mut)">Nothing required in this shift, nobody punched</td></tr>'}</tbody></table></div>
        ${regs.length ? `<div class="sub" style="margin-top:10px;font-weight:700">Regulars not here today</div><div class="kv" style="margin-top:6px">${regs.map((a) => `<span class="tg amb">${esc(a.name)} · ${esc(cname(a.c))} · came ${a.days}/7</span>`).join('')}</div>` : ''}</div>`;
      if (scroll) sdEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function excel() {
      if (!S.lines.length) return toast('Nothing to export');
      const H = S.lv === 'dept' && bdReady() ? subKind() : { zfm: 'ZFM', am: 'AM', store: 'Store', dept: 'Dept' }[S.lv], ds = weekDates();
      downloadXlsx(S.lines.map((l) => ({ [H]: S.lv === 'store' ? l.key : l.name, ...(S.lv === 'store' ? { 'Store name': l.name, AM: l.am, ZFM: l.zfm } : {}), ...(S.lv === 'am' ? { ZFM: l.zfm } : {}),
        ...(S.lv !== 'store' ? { Stores: l.n } : {}), Required: l.req, Present: l.p, Gap: l.req - l.p, '%': l.req ? l.pc : '', 'Stores with 0': l.zero,
        ...(S.alert ? { Why: l.info || '' } : {}), ...(l.wk ? Object.fromEntries(l.wk.r.map((q, i) => [`${fmtDay(ds[i])} %`, q ? pct(l.wk.p[i], q) : ''])) : {}) })),
      `3PA_Live_${H}_${S.date}_${S.shift}${S.upto ? '_' + S.upto.replace(':', '') : ''}${S.cat ? '_' + S.cat : ''}${S.sub && bdReady() ? '_' + String(S.bd.lab[S.sub] || '').replace(/\W+/g, '') : ''}.xlsx`, 'Live');
    }

    /* ---------- events ---------- */
    const repaint = () => { S.all = false; paint(); };
    function setCat(c) { if (S.lock) return; S.cat = c; S.sub = ''; S.alert = ''; S.mx = []; repaint(); loadBrands(); }
    V.el.addEventListener('click', (e) => {
      const m = e.target.closest('[data-nd],[data-mx],tr[data-mxk],[data-sort],[data-sub],[data-all]');
      if (m && S.d) {
        if (m.dataset.nd) { const k = Number(m.dataset.nd); if (k !== S.ndays) { S.ndays = k; load({ days: 1 }); } return; }
        if (m.dataset.sort) { if (S.sort !== m.dataset.sort) { S.sort = m.dataset.sort; repaint(); } return; }
        if (m.dataset.sub != null) { S.sub = m.dataset.sub; S.alert = ''; repaint(); return; }
        if (m.dataset.all) { S.all = true; paint(); return; }
        if (m.dataset.mx != null) { S.mx = (S.mx || []).slice(0, Number(m.dataset.mx) + 1); repaint(); return; }
        if (m.dataset.mxstore) { storeDetail(m.dataset.mxk); return; }   // store row → employee-wise IN / OUT / hours
        if (m.dataset.mxk != null && m.classList.contains('click')) { const start = me.role === 'zfm' ? 'am' : 'zfm', lv = (S.mx || []).length ? S.mx[S.mx.length - 1].next : start;
          (S.mx = S.mx || []).push({ key: lv, val: m.dataset.mxk, name: m.dataset.mxn, next: lv === 'zfm' ? 'am' : 'store' }); repaint(); }
        return;
      }
      const t = e.target.closest('[data-cat],[data-sh],[data-cp],[data-al],[data-vw],[data-bc],[data-clr],[data-day],[data-x],tr.click');
      if (!t || !S.d) return;
      const D = t.dataset;
      if (D.cat != null) { setCat(D.cat); return; }
      if (D.sh) { if (S.shift !== D.sh) { S.shift = D.sh; load(); } return; }
      if (D.cp != null) { if (t.disabled) return; S.upto = D.cp; load({ ov: 1 }); return; }
      if (D.al) { S.alert = S.alert === D.al ? '' : D.al; S.path = []; repaint(); return; }
      if (D.vw) { S.view = D.vw; S.path = []; S.alert = ''; repaint(); return; }
      if (D.bc != null) { S.path = S.path.slice(0, Number(D.bc) + 1); S.alert = ''; repaint(); return; }
      if (D.clr) { if (D.clr === 'q') { S.q = ''; B('q').value = ''; } else if (D.clr === 'cat') { setCat(''); return; } else S[D.clr] = ''; repaint(); return; }
      if (D.day) { if (D.day > todayIST()) return; S.date = D.day; S.store = null; sdEl.innerHTML = ''; load(); return; }
      if (D.x === 'closesd') { S.store = null; sdEl.innerHTML = ''; return; }
      if (t.matches('tr.click')) {
        const lv = S.lv;
        if (lv === 'store') { storeDetail(D.k); return; }
        if (lv === 'dept') {
          if (D.subrow) { S.sub = D.k; S.view = views().some((v) => v[0] === 'store') ? 'store' : S.view; S.path = []; repaint(); return; }
          S.view = views().some((v) => v[0] === 'store') ? 'store' : S.view; S.path = []; setCat(D.k); return;
        }
        S.path.push({ key: lv, val: D.k, name: D.n, next: lv === 'zfm' ? 'am' : 'store' }); repaint();
      }
    });
    V.el.addEventListener('change', (e) => { if (e.target.matches('[data-subsel]') && e.target.value) { S.sub = e.target.value; S.alert = ''; repaint(); } });
    V.bar.addEventListener('change', (e) => {
      const f = e.target.dataset.f;
      if (f === 'date') { const v = e.target.value || todayIST(); S.date = v > todayIST() ? todayIST() : v; S.store = null; sdEl.innerHTML = ''; load(); }
      if (f === 'zfm') { S.zfm = e.target.value; S.am = ''; S.path = []; fillSelects(); repaint(); }
      if (f === 'am') { S.am = e.target.value; S.path = []; repaint(); }
    });
    let qT = 0;
    V.bar.addEventListener('input', (e) => {
      if (e.target.dataset.f !== 'q') return;
      e.target.value = e.target.value.toUpperCase(); S.q = e.target.value; S.path = [];
      clearTimeout(qT); qT = setTimeout(() => { if (S.d) repaint(); }, 150);
    });
    const fresh = () => { CACHE.clear(); S.bd = null; S.rt = null; load(); };
    V.bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]'); if (!b) return;
      if (b.dataset.f === 'ref') fresh();
      if (b.dataset.f === 'xls') excel();
    });
    // live view refreshes itself every 5 minutes while visible
    V.every(() => { if (S.d && S.d.date === S.d.today && !S.upto && document.visibilityState === 'visible' && !document.querySelector('.ov')) fresh(); }, 5 * 60000);
    load();
    return { reload: fresh };
  }

  /* =====================================================================
     APPROVALS (Pending + History)
     ===================================================================== */
  const CR_KIND = { compoff: 'Comp-off', staff: 'Staff detail change', missed_out: 'Missed OUT', missed_in: 'Missed IN', sg_mispunch: 'SG mis-punch', sg_edit: 'SG time edit', cross_store: 'Phone from other store (SM)',
    week_off: 'Week off (store, direct)', break_shift: 'Break shift (store, direct)', punch_delete: 'Punch deleted (store, direct)' };
  const isSg = (k) => k === 'sg_mispunch' || k === 'sg_edit';
  function crChange(r) {
    const p = r.payload || {};
    if (r.kind === 'compoff') return p.on === false ? `Remove comp-off · ${r.date ? fmtDay(r.date) : ''}` : `Absent → Comp-off · ${r.date ? fmtDay(r.date) : ''}`;
    if (r.kind === 'staff') { const o = p.old || {}, n = p.new || {};
      return ['name', 'vendor', 'brand'].filter((k) => (o[k] || '') !== (n[k] || '')).map((k) => `${k}: ${o[k] || '—'} → ${n[k] || '—'}`).join(' · ') || 'No change'; }
    if (r.kind === 'week_off') return `${p.on === false ? 'Week off removed' : 'Week off'} · ${r.date ? fmtDay(r.date) : ''}`;
    if (r.kind === 'break_shift') return `Break shift ${p.on ? 'ON (4 punches)' : 'OFF'}`;
    if (r.kind === 'punch_delete') return `Deleted ${p.kind || ''} ${p.time || ''} · ${r.date ? fmtDay(r.date) : ''}${p.why ? ' · ' + p.why : ''}`;
    if (r.kind === 'cross_store') return `Registered at ${p.home_store || '?'} · tried ${p.tries || 3}× at ${r.store} · ${r.date ? fmtDay(r.date) : ''} · today only`;
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
    if (!me || !['am', 'rlpo', 'admin'].includes(me.role) || me.view_by) return 0;
    const r = await rpc('cr_list', { p_token: me.token, p_status: 'pending', p_days: 120 });
    return r && r.ok ? (r.rows || []).filter((x) => x.can_decide).length : 0;
  }

  function ApprovalsView(root, me, opts = {}) {
    const V = mount(root, { bar: false });
    const today = todayIST();
    const S = { tab: 'pend', from: addDays(today, -30), to: today, group: 'all', status: 'all', q: '', pend: null, hist: null, busy: false };
    const decider = ['am', 'rlpo', 'admin'].includes(me.role) && !me.view_by, isAdm = me.role === 'admin' && !me.view_by;
    S.sel = new Set(); S.f = { kind: '', store: '' };
    const title = me.role === 'rlpo' ? 'SG approvals' : decider ? 'Approvals' : 'Approvals (view only)';
    const sub = me.role === 'rlpo' ? 'Security mis-punch (IN without OUT) and time edits from your stores. Until you decide, a mis-punch counts as Absent. Add a remark if you want; every decision is saved.'
      : me.role === 'am' ? 'Requests from your stores (comp-off, staff detail change). Add a remark if you want; every decision is saved with who and when. Security requests go to the RLPO.'
      : isAdm ? 'Admin can approve or reject every request (AM, RLPO and SM ones). Tick rows and use the bar to decide many at once. A remark is mandatory to reject; optional to approve. Security approved in bulk = P.'
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
      return `<div class="reqc" data-row="${x.id}">${isAdm ? `<input type="checkbox" data-sel="${x.id}" ${S.sel.has(String(x.id)) ? 'checked' : ''} aria-label="Select" style="width:18px;height:18px;margin:2px 4px 0 0;flex:0 0 auto">` : ''}<div style="min-width:0;flex:1 1 300px"><b>${esc(x.store)}${x.store_name ? ' · ' + esc(x.store_name) : ''} · ${esc(CR_KIND[x.kind] || x.kind)}</b>
        <div class="sub">${esc(x.assoc || '')}${x.assoc_code ? ' · ' + esc(x.assoc_code) : ''}${x.cat ? ' · ' + esc(x.cat) : ''} · from ${esc([x.by_post, x.by_name || x.by].filter(Boolean).join(' '))} · ${esc(x.at || '')}</div>
        <div style="margin-top:4px"><span class="tg info">${esc(crChange(x))}</span></div><div style="margin-top:4px;font-size:13px">“${esc(x.reason || '')}”</div></div>
        <span class="act"><input class="f" data-rmk="${x.id}" placeholder="${isAdm ? 'Remark (mandatory to reject)' : 'Remark (optional)'}" maxlength="300">${btns}</span></div>`;
    }
    function fOk(x) { return (!S.f.kind || x.kind === S.f.kind) && (!S.f.store || [x.store, x.store_name, x.assoc, x.assoc_code].join(' ').toUpperCase().includes(S.f.store.toUpperCase())); }
    function bulkBar() {
      if (!isAdm) return '';
      const kinds = [...new Set(S.pend.map((x) => x.kind))];
      const vis = S.pend.filter((x) => x.can_decide && fOk(x)), n = vis.filter((x) => S.sel.has(String(x.id))).length;
      return `<div class="toolrow" style="margin-top:6px"><span class="ftl"><select data-bf="kind" aria-label="Type"><option value="">All types (${S.pend.length})</option>${kinds.map((k) => `<option value="${esc(k)}" ${S.f.kind === k ? 'selected' : ''}>${esc(CR_KIND[k] || k)} (${S.pend.filter((x) => x.kind === k).length})</option>`).join('')}</select>
          <input class="f" data-bf="store" placeholder="Store / staff" value="${esc(S.f.store)}" style="width:150px"><label class="sub" style="margin:0;display:flex;gap:6px;align-items:center"><input type="checkbox" data-selall ${vis.length && n === vis.length ? 'checked' : ''}> Select all shown (${vis.length})</label></span></div>
        <div data-bulk style="position:sticky;bottom:0;z-index:5;margin-top:8px;background:var(--ink);color:#fff;border-radius:10px;padding:8px 10px;display:${n ? 'flex' : 'none'};gap:8px;align-items:center;flex-wrap:wrap">
          <b data-bn>${n} selected</b><input class="f" data-brm placeholder="Remark for all (mandatory to reject)" maxlength="300" style="flex:1;min-width:180px;color:var(--ink)">
          <button type="button" class="btn g sm" data-bulk-go="ok">✓ Approve ${n}</button><button type="button" class="btn r sm" data-bulk-go="no">✕ Reject ${n}</button></div>`;
    }
    function paintPend() {
      const mine = S.pend.filter((x) => x.can_decide && (!isAdm || fOk(x))), others = S.pend.filter((x) => !x.can_decide);
      const table = others.length ? `${mine.length ? '<h2 style="margin-top:14px">Waiting with others</h2>' : ''}<div class="tw"><table><thead><tr><th class="l">Store</th><th class="l">Type</th><th class="l">Staff</th><th class="l">For date</th><th class="l">Change</th><th class="l">Reason</th><th class="l">From</th><th class="l">Waiting with</th></tr></thead><tbody>
        ${others.map((x) => `<tr><td class="l"><b>${esc(x.store)}</b><small>${esc(x.store_name || '')}</small></td><td class="l">${esc(CR_KIND[x.kind] || x.kind)}</td><td class="l">${esc(x.assoc || '')}<small>${esc(x.assoc_code || '')}</small></td><td class="l">${x.date ? esc(fmtDay(x.date)) : '—'}</td>
          <td class="l">${esc(crChange(x))}</td><td class="l" style="white-space:normal;min-width:180px">${esc(x.reason || '')}</td><td class="l">${esc([x.by_post, x.by_name || x.by].filter(Boolean).join(' '))}<small>${esc(x.at || '')}</small></td><td class="l"><span class="tg amb">${esc(x.approver || (isSg(x.kind) ? 'RLPO' : 'AM'))}</span></td></tr>`).join('')}</tbody></table></div>` : '';
      body.innerHTML = bulkBar() + (mine.length ? `<div class="dlist">${mine.map(card).join('')}</div>` : decider ? '<div class="note k" style="margin-top:8px">All done. No pending requests for you.</div>' : '')
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
      if (isAdm && !approve && !note) { toast('Remark is mandatory to reject.'); if (inp) inp.focus(); return; }
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
    async function bulk(ok) {
      if (S.busy) return;
      const ids = S.pend.filter((x) => x.can_decide && fOk(x) && S.sel.has(String(x.id))).map((x) => Number(x.id));
      const note = (V.q('[data-brm]') || {}).value ? V.q('[data-brm]').value.trim() : '';
      if (!ids.length) return;
      if (!ok && !note) { toast('Remark is mandatory to reject.'); V.q('[data-brm]').focus(); return; }
      if (!window.confirm(`${ok ? 'Approve' : 'Reject'} ${ids.length} request${pl(ids.length)}?`)) return;
      S.busy = true; V.el.querySelectorAll('[data-bulk-go]').forEach((b) => { b.disabled = true; });
      const r = await rpc('cr_decide_bulk', { p_token: me.token, p_ids: ids, p_approve: ok, p_note: note || null });
      S.busy = false;
      if (!r || !r.ok) { toast(errText(r && r.error)); V.el.querySelectorAll('[data-bulk-go]').forEach((b) => { b.disabled = false; }); return; }
      const bad = r.failed || [];
      toast(`${ok ? 'Approved' : 'Rejected'} ${r.done}${bad.length ? ` · ${bad.length} not done (${[...new Set(bad.map((x) => errText(x.error)))].join(', ')})` : ''}`, bad.length ? 6000 : 2600);
      S.sel.clear(); load();
    }
    function selPaint() {
      const vis = S.pend.filter((x) => x.can_decide && fOk(x)), n = vis.filter((x) => S.sel.has(String(x.id))).length, bar = V.q('[data-bulk]');
      if (bar) { bar.style.display = n ? 'flex' : 'none'; V.q('[data-bn]').textContent = `${n} selected`; V.q('[data-bulk-go="ok"]').textContent = `✓ Approve ${n}`; V.q('[data-bulk-go="no"]').textContent = `✕ Reject ${n}`; }
      const all = V.q('[data-selall]'); if (all) all.checked = vis.length > 0 && n === vis.length;
    }
    V.el.addEventListener('change', (e) => {
      const c = e.target;
      if (c.dataset.sel) { if (c.checked) S.sel.add(c.dataset.sel); else S.sel.delete(c.dataset.sel); selPaint(); return; }
      if (c.hasAttribute('data-selall')) { S.pend.filter((x) => x.can_decide && fOk(x)).forEach((x) => { if (c.checked) S.sel.add(String(x.id)); else S.sel.delete(String(x.id)); }); paintPend(); return; }
      if (c.dataset.bf === 'kind') { S.f.kind = c.value; S.sel.clear(); paintPend(); }
    });
    let bft = 0;
    V.el.addEventListener('input', (e) => { if (e.target.dataset.bf !== 'store') return; clearTimeout(bft); const v = e.target.value; bft = setTimeout(() => { S.f.store = v; S.sel.clear(); paintPend(); const i = V.q('[data-bf="store"]'); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } }, 250); });
    V.el.addEventListener('click', (e) => {
      const bg = e.target.closest('[data-bulk-go]'); if (bg) { bulk(bg.dataset.bulkGo === 'ok'); return; }
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

  /* =====================================================================
     STAFF RATING (v5.5): SM / ASM rate yesterday's staff 1–5 ★ in the store app.
     AM / ZFM / Admin / HO Dept: tasks (pending / missed / done), brand / vendor summary, low ratings with reasons.
     ===================================================================== */
  const STAR = (k) => `<span style="color:#F59E0B;letter-spacing:1px">${'★'.repeat(k)}</span><span style="color:var(--track);letter-spacing:1px">${'★'.repeat(5 - k)}</span>`;
  const RST = { pending: '<span class="tg amb">Pending</span>', missed: '<span class="tg red">Missed</span>', done: '<span class="tg ok">Done</span>' };
  function ratingPendingCount(me) {
    const yd = addDays(todayIST(), -1);
    return rpc('rating_tasks', { p_token: me.token, p_from: yd, p_to: yd }).then((r) => (r && r.ok ? (r.stores || []).filter((x) => x.st === 'pending').length : 0)).catch(() => 0);
  }
  function RatingView(root, me, opts = {}) {
    const V = mount(root);
    const yd = addDays(todayIST(), -1);
    const S = { from: yd, to: yd, tab: 'tasks', st: 'open', q: '', cat: '', r: null, det: null };
    V.bar.innerHTML = `<input class="f" type="date" data-f="from" max="${yd}" value="${S.from}" aria-label="From"><input class="f" type="date" data-f="to" max="${yd}" value="${S.to}" aria-label="To">
      <button type="button" class="btn s sm" data-f="y">Yesterday</button><button type="button" class="btn s sm" data-f="w">Last 7 days</button><button type="button" class="btn s sm" data-f="m">Last 30 days</button>
      <input class="f" data-f="q" placeholder="Store code" maxlength="4" style="width:100px;text-transform:uppercase" aria-label="Store code"><button type="button" class="btn sm" data-f="xls">⬇ Excel</button>`;
    V.el.insertAdjacentHTML('beforeend', `<div data-ld="m">${spin}</div><div data-ld="det"></div>`);
    const M = V.q('[data-ld="m"]'), D = V.q('[data-ld="det"]');
    const B = (k) => V.bar.querySelector(`[data-f="${k}"]`);
    const CN = { HK: 'Housekeeping', SEC: 'Security', TRAVEL: 'Travel', CDIT: 'CDIT' };
    async function load() {
      M.classList.add('busy');
      const r = await rpc('rating_tasks', { p_token: me.token, p_from: S.from, p_to: S.to });
      if (!V.alive()) return; M.classList.remove('busy');
      if (!r || !r.ok) { M.innerHTML = errBox(r); return; }
      S.r = r; if (opts.onCount) opts.onCount((r.stores || []).filter((x) => x.st === 'pending').length);
      paint();
    }
    const qOk = (s) => !S.q || String(s).startsWith(S.q);
    function rowsTasks() { return (S.r.stores || []).filter((x) => qOk(x.s) && (S.st === 'all' || (S.st === 'open' ? x.st !== 'done' : x.st === S.st))); }
    function rowsBrands() { return (S.r.brands || []).filter((x) => !S.cat || x.c === S.cat); }
    function rowsLow() { return (S.r.low || []).filter((x) => qOk(x.s) && (!S.cat || x.c === S.cat)); }
    function paint() {
      const r = S.r, all = r.stores || [];
      const n = { pending: 0, missed: 0, done: 0 }; all.forEach((x) => { n[x.st]++; });
      const ppl = all.reduce((a, x) => a + x.n, 0), rated = all.reduce((a, x) => a + x.rated, 0);
      const sum = all.reduce((a, x) => a + (x.avg || 0) * x.rated, 0), low = all.reduce((a, x) => a + x.low, 0);
      const cs = [...new Set((r.brands || []).map((x) => x.c))];
      M.innerHTML = `<div class="kpis">
          <div class="kpi"><span class="l">Staff present</span><span class="v">${fmt(ppl)}</span><span class="d">${esc(fmtDay(r.from))}${r.to !== r.from ? ' – ' + esc(fmtDay(r.to)) : ''}</span></div>
          <div class="kpi"><span class="l">Rated</span><span class="v">${fmt(rated)} <span class="tg ${pct(rated, ppl) >= 90 ? 'ok' : 'amb'}" style="vertical-align:4px">${pct(rated, ppl)}%</span></span><span class="d">by SM / ASM</span></div>
          <div class="kpi"><span class="l">Average</span><span class="v" style="color:#F59E0B">★ ${rated ? (sum / rated).toFixed(1) : '—'}</span><span class="d">out of 5</span></div>
          <div class="kpi"><span class="l">1–2 ★</span><span class="v" style="color:var(--red)">${fmt(low)}</span><span class="d">with reason</span></div>
          <div class="kpi"><span class="l">Stores pending</span><span class="v" style="color:var(--amb)">${n.pending}</span><span class="d">yesterday · can still rate</span></div>
          <div class="kpi"><span class="l">Stores missed</span><span class="v" style="color:var(--red)">${n.missed}</span><span class="d">day passed, not rated</span></div></div>
        <div class="card"><div class="toolrow"><div class="pills">${[['tasks', '📋 Tasks pending'], ['brand', 'By brand / vendor'], ['low', '1–2 ★ with reason']].map(([k, l]) => `<button type="button" class="pill ${S.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
          <div class="pills">${S.tab === 'tasks' ? `<div class="seg">${[['open', 'Pending + Missed'], ['pending', 'Pending'], ['missed', 'Missed'], ['done', 'Done'], ['all', 'All']].map(([k, l]) => `<button type="button" data-st="${k}" class="${S.st === k ? 'on' : ''}">${l}</button>`).join('')}</div>`
            : `<button type="button" class="pill ${!S.cat ? 'on' : ''}" data-cat="">All depts</button>${cs.map((c) => `<button type="button" class="pill ${S.cat === c ? 'on' : ''}" data-cat="${esc(c)}">${esc(CN[c] || c)}</button>`).join('')}`}</div></div>
          <div class="tw" style="margin-top:8px">${S.tab === 'tasks' ? tTasks() : S.tab === 'brand' ? tBrand() : tLow()}</div></div>`;
    }
    function tTasks() {
      const L = rowsTasks();
      return `<table><thead><tr><th class="l">Store</th><th class="l">AM</th><th class="l">Day</th><th>Present</th><th>Rated</th><th>Avg</th><th>1–2 ★</th><th class="l">SM / ASM</th><th class="l">Status</th></tr></thead><tbody>
        ${L.slice(0, 500).map((x) => `<tr class="click" data-s="${esc(x.s)}" data-d="${esc(x.d)}"><td class="l"><span class="lk">${esc(x.s)}</span> ${esc(x.name || '')}</td><td class="l">${esc(x.am_name || '—')}</td><td class="l">${esc(fmtDay(x.d))}</td>
          <td>${x.n}</td><td>${x.rated}/${x.n}</td><td>${x.avg != null ? '★ ' + x.avg : '—'}</td><td>${x.low ? `<span class="tg red">${x.low}</span>` : '—'}</td><td class="l">${esc(x.who || '—')}</td><td class="l">${RST[x.st]}</td></tr>`).join('')
        || '<tr><td class="l" colspan="9" style="color:var(--mut)">Nothing here 👍</td></tr>'}</tbody></table>`;
    }
    function tBrand() {
      const L = rowsBrands();
      return `<table><thead><tr><th class="l">Dept</th><th class="l">Brand / vendor</th><th>Present</th><th>Rated</th><th>Avg</th><th>1–2 ★</th></tr></thead><tbody>
        ${L.map((x) => `<tr><td class="l">${esc(CN[x.c] || x.c)}</td><td class="l"><b>${esc(x.b)}</b></td><td>${x.n}</td><td>${x.rated} <small class="hint">${pct(x.rated, x.n)}%</small></td><td>${x.avg != null ? '★ ' + x.avg : '—'}</td><td>${x.low ? `<span class="tg red">${x.low}</span>` : '—'}</td></tr>`).join('')
        || '<tr><td class="l" colspan="6" style="color:var(--mut)">No staff present in these dates</td></tr>'}</tbody></table>`;
    }
    function tLow() {
      const L = rowsLow();
      return `<table><thead><tr><th class="l">Day</th><th class="l">Store</th><th class="l">Name</th><th class="l">Dept · brand / vendor</th><th class="l">Rating</th><th class="l">Reason</th><th class="l">Rated by</th></tr></thead><tbody>
        ${L.map((x) => `<tr class="click" data-s="${esc(x.s)}" data-d="${esc(x.d)}"><td class="l">${esc(fmtDay(x.d))}</td><td class="l"><span class="lk">${esc(x.s)}</span></td><td class="l">${esc(x.name)}</td><td class="l">${esc(CN[x.c] || x.c)} · ${esc(x.b)}</td>
          <td class="l">${STAR(x.stars)}</td><td class="l" style="color:var(--red);white-space:normal">${esc(x.tag || '')}${x.note ? ' · ' + esc(x.note) : ''}</td><td class="l">${esc(x.by || '')}${x.post ? ' (' + esc(x.post) + ')' : ''}</td></tr>`).join('')
        || '<tr><td class="l" colspan="7" style="color:var(--mut)">No 1–2 ★ ratings 👍</td></tr>'}</tbody></table>`;
    }
    async function detail(s, d) {
      D.innerHTML = `<div class="card">${spin}</div>`;
      const r = await rpc('rating_detail', { p_token: me.token, p_store: s, p_date: d });
      if (!V.alive()) return;
      if (!r || !r.ok) { D.innerHTML = `<div class="card">${errBox(r)}</div>`; return; }
      S.det = r;
      D.innerHTML = `<div class="card"><div class="hd"><div><h2>${esc(s)} · ${esc(fmtDate(d))}</h2><div class="sub">Each staff who punched IN that day · rating by SM / ASM${r.can_edit ? ' · admin can correct' : ''}</div></div><button type="button" class="btn s sm" data-x="close">✕ Close</button></div>
        <div class="tw"><table><thead><tr><th class="l">Name</th><th class="l">Code</th><th class="l">Dept · brand / vendor</th><th class="l">Rating</th><th class="l">Reason</th><th class="l">Rated by</th>${r.can_edit ? '<th></th>' : ''}</tr></thead><tbody>
        ${(r.rows || []).map((a) => `<tr><td class="l">${esc(a.name)}</td><td class="l">${esc(a.code || '')}</td><td class="l">${esc(CN[a.c] || a.c)} · ${esc(a.brand || a.vendor || '—')}</td>
          <td class="l">${a.stars ? STAR(a.stars) + (a.edited ? ' <small class="hint">edited</small>' : '') : '<span class="tg amb">Not rated</span>'}</td><td class="l" style="white-space:normal;${a.stars <= 2 ? 'color:var(--red)' : ''}">${esc(a.tag || '')}${a.note ? ' · ' + esc(a.note) : ''}</td>
          <td class="l">${esc(a.by || '')}${a.post ? ' (' + esc(a.post) + ')' : ''}</td>${r.can_edit ? `<td><button type="button" class="btn ghost sm" data-ed="${a.id}">Edit</button></td>` : ''}</tr>`).join('')
        || '<tr><td class="l" colspan="7" style="color:var(--mut)">Nobody punched IN</td></tr>'}</tbody></table></div><a class="lk" href="statement.html?s=${encodeURIComponent(s)}">Open statements ›</a></div>`;
      D.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function edit(id) {
      const a = (S.det.rows || []).find((x) => String(x.id) === String(id)); if (!a) return;
      const tags = reasonsFor(a.c);
      const m = modal(`<h2>Correct rating · ${esc(a.name)}</h2><div class="sub">${esc(S.det.store)} · ${esc(fmtDate(S.det.date))}</div>
        <div class="frm" style="margin-top:10px"><label>Stars<select id="rgS"><option value="">— remove rating</option>${[5, 4, 3, 2, 1].map((k) => `<option value="${k}"${a.stars === k ? ' selected' : ''}>${'★'.repeat(k)} (${k})</option>`).join('')}</select></label>
        <label>Reason (1–2 ★)<select id="rgT"><option value="">—</option>${tags.map((g) => `<option${a.tag === g ? ' selected' : ''}>${esc(g)}</option>`).join('')}</select></label>
        <label style="grid-column:1/-1">Note<input class="f" id="rgN" maxlength="300" value="${esc(a.note || '')}"></label></div>
        <div id="rgE" class="note r" hidden></div><div class="acts" style="margin-top:10px;display:flex;gap:8px"><button type="button" class="btn" id="rgOk">Save</button><button type="button" class="btn s" id="rgNo">Cancel</button></div>`);
      const q = (x) => (m && m.querySelector ? m.querySelector(x) : document.querySelector(x));
      q('#rgNo').addEventListener('click', () => closeModal());
      q('#rgOk').addEventListener('click', async () => {
        const st = q('#rgS').value ? Number(q('#rgS').value) : null;
        const r = await rpc('rating_admin_set', { p_token: me.token, p_associate: a.id, p_date: S.det.date, p_stars: st, p_tag: q('#rgT').value || null, p_note: q('#rgN').value || null });
        if (!r || !r.ok) { const e = q('#rgE'); e.hidden = false; e.textContent = r && r.error === 'REASON_REQUIRED' ? '1–2 ★ needs a reason and a short note.' : errText(r && r.error); return; }
        closeModal(); toast('Rating saved'); detail(S.det.store, S.det.date); load();
      });
    }
    function excel() {
      if (!S.r) return;
      const name = `Staff_rating_${S.tab}_${S.from}_${S.to}.xlsx`;
      if (S.tab === 'tasks') return downloadXlsx(rowsTasks().map((x) => ({ Store: x.s, 'Store name': x.name || '', AM: x.am_name || '', ZFM: x.zfm_name || '', Day: x.d, Present: x.n, Rated: x.rated, Avg: x.avg ?? '', '1–2 ★': x.low, 'SM / ASM': x.who || '', Status: x.st })), name, 'Tasks');
      if (S.tab === 'brand') return downloadXlsx(rowsBrands().map((x) => ({ Dept: CN[x.c] || x.c, 'Brand / vendor': x.b, Present: x.n, Rated: x.rated, Avg: x.avg ?? '', '1–2 ★': x.low })), name, 'Brands');
      downloadXlsx(rowsLow().map((x) => ({ Day: x.d, Store: x.s, Name: x.name, Dept: CN[x.c] || x.c, 'Brand / vendor': x.b, Stars: x.stars, Reason: x.tag || '', Note: x.note || '', 'Rated by': `${x.by || ''}${x.post ? ' (' + x.post + ')' : ''}` })), name, 'Low');
    }
    V.el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab],[data-st],[data-cat],tr.click,[data-x],[data-ed]'); if (!t || !S.r) return;
      if (t.dataset.tab) { S.tab = t.dataset.tab; paint(); return; }
      if (t.dataset.st) { S.st = t.dataset.st; paint(); return; }
      if (t.dataset.cat != null) { S.cat = t.dataset.cat; paint(); return; }
      if (t.dataset.x) { D.innerHTML = ''; return; }
      if (t.dataset.ed) { edit(t.dataset.ed); return; }
      if (t.matches('tr.click')) detail(t.dataset.s, t.dataset.d);
    });
    const setRange = (f, t) => { S.from = f; S.to = t; B('from').value = f; B('to').value = t; D.innerHTML = ''; load(); };
    V.bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]'); if (!b) return; const k = b.dataset.f;
      if (k === 'y') setRange(yd, yd); if (k === 'w') setRange(addDays(yd, -6), yd); if (k === 'm') setRange(addDays(yd, -29), yd);
      if (k === 'xls') excel();
    });
    V.bar.addEventListener('change', (e) => {
      const k = e.target.dataset.f; if (k !== 'from' && k !== 'to') return;
      let f = B('from').value || yd, t = B('to').value || yd; if (t > yd) t = yd; if (f > t) { if (k === 'from') t = f; else f = t; }
      setRange(f, t);
    });
    V.bar.addEventListener('input', (e) => { if (e.target.dataset.f !== 'q') return; e.target.value = e.target.value.toUpperCase(); S.q = e.target.value; if (S.r) paint(); });
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

  Object.assign(window, { LiveDash, RatingView, ratingPendingCount, ApprovalsView, RlpoManualView, StoreTeamView, ChurnView, PinReset, dashPendingCount, Shell, kpi, CR_KIND, crChange });
}());
