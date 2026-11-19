/* VMM 3rd Party Attendance — Admin console (v5), used by admin.html only.
   Pages: Live Dashboard · Approvals (view) · Store team · Staff churn · Reports & export   (dash.js globals for the first four)
          Store Master · Manpower Master · RLPO Master · Users & PIN · HO Dept Master · Mail Center · Settings ·
          Access & Consent log · View as user
   Everything is wrapped in one IIFE so nothing here can clash with dash.js / app.js globals. */
(function () {
  'use strict';
  let me = null, SH = null, curPage = '', dirty = null;   // dirty(): unsaved-changes check of the open page

  /* ================= small helpers ================= */
  const SPIN = '<div class="spin"></div>';
  const isMail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
  const mailOk = (v) => !v || isMail(v);
  const yes = (v) => !['false', 'no', 'n', '0', 'inactive', 'off'].includes(String(v ?? 'true').trim().toLowerCase());
  const plural = (n, w) => `${Number(n).toLocaleString('en-IN')} ${w}${n === 1 ? '' : 's'}`;
  const nf = (n) => Number(n || 0).toLocaleString('en-IN');
  const nowHM = () => istNow().toTimeString().slice(0, 5);
  const toDate = (v) => { if (v === '' || v == null) return ''; if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
    const s = String(v).trim(); const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return s.slice(0, 10); };
  const okDate = (s) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s);
  const g = (r, ...ks) => { for (const k of ks) if (r[k] !== undefined && r[k] !== null && String(r[k]).trim() !== '') return String(r[k]).trim(); return ''; };
  const ERR = { BAD_CODE: 'Store code must be 2 letters + 2 digits', RLPO_NOT_FOUND: 'RLPO mail is not in RLPO Master', BAD_SG_SET: 'SG set must be 8 or 12',
    BAD_HK_TOTAL: 'HK total must be 0 or more', BAD_MAIL: 'Mail id format is wrong', NAME_REQUIRED: 'Name missing', STORE_NOT_FOUND: 'Store not in Store Master',
    BAD_SG_HOURS: 'SG hours: Absent-below must be ≤ Present-from, both 0–24', BAD_VALUE: 'A value is out of range' };
  const eText = (e) => { e = String(e || ''); if (ERR[e]) return ERR[e]; const m = e.match(/^MAIL_USED_BY_(\w+)/); if (m) return `Mail id already used by a ${m[1]} login`; return errText(e); };
  const dlBlob = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  const fileBtn = (label, key) => `<label class="btn s">${label}<input type="file" data-up="${key}" accept=".xlsx,.xls,.csv" hidden></label>`;
  const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
  async function zipLib() { if (!window.JSZip) await loadScript(JSZIP_URL); return window.JSZip; }
  const kpiBox = (l, v, d = '', color = '') => `<div class="kpi"><span class="l">${esc(l)}</span><span class="v"${color ? ` style="color:${color}"` : ''}>${v}</span>${d ? `<span class="d">${d}</span>` : ''}</div>`;
  const RN = { store: 'Store', am: 'AM', zfm: 'ZFM', hodept: 'HO Dept', rlpo: 'RLPO', admin: 'Admin' };
  const pinTag = (u) => u.active === false ? '<span class="tg grey">Inactive</span>' : u.locked ? '<span class="tg red">Locked</span>' : u.pin_set ? '<span class="tg ok">Set</span>'
    : u.has_code ? '<span class="tg info">Code sent</span>' : '<span class="tg amb">Not set</span>';

  /* admin_get cache (per page load; force = reload) */
  const cache = {};
  async function aget(kind, force) {
    if (!force && cache[kind]) return cache[kind];
    const r = await rpc('admin_get', { p_token: me.token, p_kind: kind });
    if (!r || r.ok === false) throw new Error(eText(r && r.error));
    cache[kind] = r.rows || (kind === 'settings' ? {} : []);
    return cache[kind];
  }
  const drop = (...k) => k.forEach((x) => { delete cache[x]; });

  /* pager: st = {page, size} */
  function pagerHtml(n, st) {
    const pages = Math.max(1, Math.ceil(n / st.size)); if (st.page > pages) st.page = pages; if (st.page < 1) st.page = 1;
    const a = n ? (st.page - 1) * st.size + 1 : 0, b = Math.min(n, st.page * st.size);
    return `<div class="pager"><span>${n ? `${nf(a)}–${nf(b)} of ${nf(n)}` : '0 rows'}</span><span class="pgb">
      <button type="button" data-pg="first" ${st.page <= 1 ? 'disabled' : ''} aria-label="First page">«</button><button type="button" data-pg="prev" ${st.page <= 1 ? 'disabled' : ''} aria-label="Previous page">‹</button>
      <b>${st.page} / ${pages}</b><button type="button" data-pg="next" ${st.page >= pages ? 'disabled' : ''} aria-label="Next page">›</button><button type="button" data-pg="last" ${st.page >= pages ? 'disabled' : ''} aria-label="Last page">»</button>
      <select data-pgsize aria-label="Rows per page">${[25, 50, 100, 200].map((s) => `<option value="${s}"${s === st.size ? ' selected' : ''}>${s} / page</option>`).join('')}</select></span></div>`;
  }
  function pagerEvent(e, st, n) {
    const b = e.target.closest('[data-pg]');
    if (b) { const pages = Math.max(1, Math.ceil(n / st.size)); st.page = { first: 1, prev: st.page - 1, next: st.page + 1, last: pages }[b.dataset.pg]; return true; }
    if (e.type === 'change' && e.target.matches('[data-pgsize]')) { st.size = +e.target.value; st.page = 1; store.set('3pa_adm_size', st.size); return true; }
    return false;
  }
  const pageSlice = (arr, st) => arr.slice((st.page - 1) * st.size, st.page * st.size);
  const defSize = () => { const s = +store.get('3pa_adm_size', 50); return [25, 50, 100, 200].includes(s) ? s : 50; };

  /* v5 form dialog. fields: [{k, label, type:'text|email|number|date|select|multi|static', v, options:[[v,l]], lock, wide, max, ph}]
     onSave(val) → Promise<string|null> (error text keeps it open). */
  function formModal(title, fields, onSave, o = {}) {
    const fld = (f) => {
      const lab = `<label${f.wide ? ' class="wide"' : ''}>${esc(f.label)}`;
      if (f.type === 'static') return `${lab}<span style="font-weight:500;color:var(--ink);font-size:13px">${f.html}</span></label>`;
      if (f.type === 'select') return `${lab}<select name="${f.k}"${f.lock ? ' disabled' : ''}>${f.options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(f.v ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
      if (f.type === 'multi') return `<div class="wide" style="grid-column:1/-1"><div class="sub" style="font-weight:700;margin-bottom:6px">${esc(f.label)}</div><div class="ckl">${f.options.map(([v, l]) => `<label><input type="checkbox" name="${f.k}" value="${esc(v)}"${(f.v || []).includes(v) ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</div></div>`;
      return `${lab}<input class="f" name="${f.k}" type="${f.type || 'text'}" value="${esc(f.v ?? '')}"${f.lock ? ' disabled' : ''}${f.max ? ` maxlength="${f.max}"` : ''}${f.ph ? ` placeholder="${esc(f.ph)}"` : ''}${f.type === 'number' ? ' min="0" step="1"' : ''}></label>`;
    };
    const md = modal(`<h3>${esc(title)}</h3><div class="frm">${fields.map(fld).join('')}</div>${o.note ? `<div class="sub" style="margin:0">${o.note}</div>` : ''}
      <div class="note r" data-fm="err" hidden></div><div class="mx"><button type="button" class="btn s" data-close>Cancel</button><button type="button" class="btn" data-fm="ok">${esc(o.ok || 'Save')}</button></div>`);
    if (o.wide) md.style.maxWidth = '640px';
    const ok = md.querySelector('[data-fm="ok"]'), err = md.querySelector('[data-fm="err"]');
    const collect = () => { const val = {}; fields.forEach((f) => { if (f.type === 'static') return;
      if (f.type === 'multi') val[f.k] = [...md.querySelectorAll(`[name="${f.k}"]:checked`)].map((x) => x.value);
      else { const el = md.querySelector(`[name="${f.k}"]`); val[f.k] = f.lock ? f.v : String(el.value ?? '').trim(); } }); return val; };
    const go = async () => { ok.disabled = true; err.hidden = true; let m = null;
      try { m = await onSave(collect()); } catch (e) { m = String(e.message || e); }
      ok.disabled = false; if (m) { err.hidden = false; err.textContent = m; } else md.close(); };
    ok.addEventListener('click', go);
    md.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') { e.preventDefault(); go(); } });
    return md;
  }
  function infoModal(title, html) {
    return modal(`<h3>${esc(title)}</h3>${html}<div class="mx"><button type="button" class="btn" data-close>Done</button></div>`);
  }

  /* import check: res = {good, errors:[{row,msg,data}], newCount, updCount, same, note} */
  function importBox(el, file, res, onSave, fname) {
    const errs = res.errors.slice(0, 4).map((e) => `row ${e.row}: ${e.msg}`).join(' · ');
    el.innerHTML = `<div class="card"><div class="impc"><b>Import check · ${esc(file)}</b>
      <span class="tg info">${res.newCount} new</span><span class="tg ok">${res.updCount} update</span>${res.same ? `<span class="tg grey">${res.same} unchanged</span>` : ''}
      ${res.errors.length ? `<span class="tg red">${res.errors.length} error${res.errors.length === 1 ? '' : 's'}</span>` : ''}
      <span class="sp">${res.errors.length ? '<button type="button" class="btn ghost sm" data-imp="errs">⬇ Errors</button>' : ''}<button type="button" class="btn s sm" data-imp="cancel">Cancel</button>
      ${res.good.length ? `<button type="button" class="btn sm" data-imp="save">Save ${plural(res.good.length, 'row')}</button>` : ''}</span></div>
      ${res.errors.length ? `<div class="sub" style="color:var(--red)">${esc(errs)}${res.errors.length > 4 ? ' …' : ''}</div>` : ''}${res.note ? `<div class="sub">${esc(res.note)}</div>` : ''}</div>`;
    el.onclick = async (e) => {
      const b = e.target.closest('[data-imp]'); if (!b) return;
      if (b.dataset.imp === 'cancel') { el.innerHTML = ''; el.onclick = null; }
      if (b.dataset.imp === 'errs') downloadXlsx(res.errors.map((x) => ({ Row: x.row, Problem: x.msg, ...x.data })), `${fname || 'Import'}_errors.xlsx`, 'Errors');
      if (b.dataset.imp === 'save') { b.disabled = true; b.textContent = 'Saving…'; el.onclick = null; await onSave(res.good); }
    };
  }
  async function readSheet(input) {
    const file = input.files[0]; input.value = ''; if (!file) return null;
    try { return { name: file.name, rows: (await readXlsx(file)).map(normRow) }; } catch (e) { toast('Could not read this file (use .xlsx)'); return null; }
  }
  function resLine(r) {
    const errs = r.errs || [];
    return `<div class="res2"><b>Last save · ${esc(r.at)}</b>${r.u != null ? `<span class="tg ok">Updated ${r.u}</span>` : ''}${r.a != null ? `<span class="tg info">Added ${r.a}</span>` : ''}
      <span class="tg ${errs.length ? 'red' : 'grey'}">Errors ${errs.length}</span>${r.msg ? `<span class="sub" style="margin:0">${esc(r.msg)}</span>` : ''}
      ${errs.length ? `<div class="errs">${errs.slice(0, 12).map((x) => `${esc(x.store || x.mail || x.key || '')}: ${esc(eText(x.error))}`).join(' · ')}${errs.length > 12 ? ' …' : ''}</div>` : ''}</div>`;
  }

  /* ================= mails (.eml) shared by Mail Center + invite buttons ================= */
  const BASE = () => location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
  const b64 = (str) => { const bytes = new TextEncoder().encode(str); let bin = ''; for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return btoa(bin); };
  const mailBox = (title, body) => `<div style="font-family:Segoe UI,Calibri,Arial,sans-serif;font-size:14px;color:#1A2130;max-width:640px"><div style="background:#334155;color:#fff;padding:12px 16px;font-weight:700;font-size:16px;border-bottom:3px solid #EA580C">${title}</div><div style="padding:16px;line-height:1.55">${body}</div><div style="padding:8px 16px;color:#98A1AE;font-size:11px">VMM Central Ops &amp; BI · 3rd Party Attendance portal · Designed &amp; Developed by Shubhendu Sinha</div></div>`;
  const kv = (rows) => `<table style="border-collapse:collapse;margin:8px 0">${rows.map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#5A6472">${k}</td><td style="padding:4px 0"><b>${v}</b></td></tr>`).join('')}</table>`;
  const listT = (rows, head) => `<table style="border-collapse:collapse;margin:8px 0;font-size:13px"><tr>${head.map((h) => `<th style="text-align:left;background:#EDF1F5;color:#0F172A;padding:6px 10px">${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td style="padding:6px 10px;border-top:1px solid #E2E6EC">${c}</td>`).join('')}</tr>`).join('')}</table>`;
  const codeHtml = (code, days) => `First time: enter the <b>setup code</b> below, answer the small sum and set your own 4-digit PIN.<br><span style="display:inline-block;font:800 22px monospace;letter-spacing:6px;background:#FFF1E8;color:#C2410C;padding:8px 14px;border-radius:8px;margin:6px 0">${esc(code)}</span><br><small style="color:#5A6472">Valid for ${days} days, one time only. Never share it.</small>`;
  const loginId = (u) => (u.role === 'hodept' || u.role === 'rlpo') ? (u.email || u.emp_code) : u.emp_code;
  function loginSteps(u) {
    if (u.role === 'hodept') return `Open the link → <b>HO Dept</b> → your <b>mail id</b> → Department <b>${esc(u.dept || '')}</b> → Next.`;
    if (u.role === 'rlpo') return 'Open the link → <b>RLPO</b> → your <b>mail id</b> → Next.';
    return `Open the link → <b>${RN[u.role] || u.role}</b> → your <b>Emp Code or mail id</b> → Next.`;
  }
  function inviteMail(u) {
    const role = RN[u.role] || u.role;
    return { subject: `3rd Party Attendance portal · your ${role} login`,
      html: (code, days) => mailBox('3rd Party Staff Attendance · your login', `Dear ${esc(u.name)},<br><br>Your <b>${role}</b> login${u.dept ? ` (${esc(u.dept)})` : ''}${u.role === 'rlpo' ? ' (Security: SG approvals, manual present)' : ''} for the 3rd Party Staff Attendance portal is ready.
        ${kv([['Link', BASE()], ['Login as', role + (u.dept ? ' · ' + esc(u.dept) : '')], ['Login ID', esc(loginId(u)) + (u.role === 'am' || u.role === 'zfm' || u.role === 'admin' ? (u.email ? ` <span style="font-weight:400;color:#5A6472">or ${esc(u.email)}</span>` : '') : ' (your mail id)')]])}${loginSteps(u)}<br><br>
        ${u.pin_set ? 'You already have a PIN: just log in.' : codeHtml(code || '######', days || 7)}<br><br>Do not share your PIN${u.pin_set ? '' : ' or this code'}.<br><br>Regards,<br>Central Ops &amp; BI`) };
  }
  const eml = (x, html) => [`To: ${x.to}`, x.cc ? `Cc: ${x.cc}` : null, `Subject: =?UTF-8?B?${b64(x.subject)}?=`, 'MIME-Version: 1.0', 'X-Unsent: 1', 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    b64(`<!doctype html><html><body>${html}</body></html>`).replace(/.{76}/g, '$&\r\n')].filter((l) => l !== null).join('\r\n');
  const emlName = (x) => `${(x.emp || x.store || 'mail').replace(/[^\w@.-]/g, '_')}_${String(x.name || '').replace(/[^\w]+/g, '_').slice(0, 30)}.eml`;
  /* one invite .eml for a user (issues a fresh setup code when no PIN yet) → true when downloaded */
  async function inviteEml(u) {
    const to = u.email || (isMail(u.emp_code) ? u.emp_code : '');
    if (!to) { toast('This user has no mail id'); return false; }
    let code = '', days = 7;
    if (!u.pin_set) { const r = await rpc('admin_issue_codes', { p_token: me.token, p_emps: [u.emp_code] });
      if (!r || !r.ok || !r.rows || !r.rows[0]) { toast(r && r.error ? eText(r.error) : 'Could not issue a setup code (inactive user?)'); return false; }
      code = r.rows[0].code; days = r.days || 7; }
    const m = inviteMail(u), x = { to, subject: m.subject, emp: u.emp_code, name: u.name };
    dlBlob(new Blob([eml(x, m.html(code, days))], { type: 'message/rfc822' }), `Invite_${emlName(x)}`);
    toast('Invite .eml downloaded · open it in Outlook and send');
    return true;
  }
  /* Reset PIN (two taps) → shows the new setup code */
  async function resetPin(b, onDone) {
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Tap again to reset'; b.classList.add('r'); b.classList.remove('ghost', 's'); return; }
    b.disabled = true; const r = await rpc('reset_pin', { p_token: me.token, p_emp: b.dataset.reset });
    if (r && r.ok) {
      if (r.code) infoModal('New setup code', `<p class="sub" style="font-size:13px;margin:0">${esc(r.name)} needs this one-time code to create a new PIN. Share it privately, or send the invite mail.</p><div style="font:800 28px monospace;letter-spacing:8px;color:var(--acc);text-align:center;padding:8px">${esc(r.code)}</div>`);
      else toast(`PIN reset for ${r.name}`);
      if (onDone) onDone();
    } else { toast(eText(r && r.error)); b.disabled = false; }
  }

  /* ================= STORE MASTER ================= */
  async function StoreMaster(root) {
    root.innerHTML = SPIN;
    let rows, users, rlpos;
    try { [rows, users, rlpos] = await Promise.all([aget('stores', true), aget('users'), aget('rlpos')]); } catch (e) { root.innerHTML = `<div class="note r">${esc(e.message)}</div>`; return; }
    const ams = () => users.filter((u) => u.role === 'am' && u.active !== false), zfms = () => users.filter((u) => u.role === 'zfm' && u.active !== false);
    const uname = (e) => { const u = users.find((x) => x.emp_code === e); return u ? u.name : e || ''; };
    const umail = (e) => (users.find((x) => x.emp_code === e) || {}).email || '';
    const st = { f: 'all', q: '', page: 1, size: defSize(), edit: {}, add: false, res: null };
    const F = { all: ['Total stores', () => true, ''], act: ['Active', (s) => s.active, 'ok'], gps: ['GPS missing', (s) => s.active && (s.lat == null || s.lat === ''), 'r'],
      mail: ['Mail missing', (s) => s.active && !s.store_email, 'a'], rlpo: ['RLPO missing', (s) => s.active && !s.rlpo_mail, 'a'], split: ['HK split not set', (s) => s.active && s.hk_split_set === false, 'a'] };
    const EK = ['name', 'am_emp', 'zfm_emp', 'rlpo_mail', 'store_email', 'sg_set', 'hk_total', 'active'];
    const orig = (s, k) => k === 'active' ? !!s.active : k === 'sg_set' ? String(s.sg_set || 8) : k === 'hk_total' ? (s.hk_total == null ? '' : String(s.hk_total)) : String(s[k] ?? '');
    const val = (s, k) => { const e = st.edit[s.store_code]; return e && k in e ? e[k] : orig(s, k); };
    const nCh = () => Object.values(st.edit).reduce((a, e) => a + Object.keys(e).length, 0);
    dirty = () => nCh() > 0;
    const opts = (list, v, blank) => { let o = (blank != null ? `<option value="">${blank}</option>` : '') + list.map((u) => `<option value="${esc(u[0])}"${u[0] === v ? ' selected' : ''}>${esc(u[1])}</option>`).join('');
      if (v && !list.some((u) => u[0] === v)) o += `<option value="${esc(v)}" selected>${esc(v)} (not in list)</option>`; return o; };
    const amL = () => ams().map((u) => [u.emp_code, `${u.name} · ${u.emp_code}`]), zfL = () => zfms().map((u) => [u.emp_code, `${u.name} · ${u.emp_code}`]);
    const rlL = () => rlpos.filter((r) => r.active !== false).map((r) => [r.mail, r.name]);

    root.innerHTML = `<div class="toolrow"><div><h1 class="pt">Store Master</h1><div class="sub">Change any cell, then <b>Save changes</b>. Bulk add / update: Excel template → upload. GPS, city and AM / ZFM mails: ✎ More.</div></div>
      <span class="acts"><button type="button" class="btn" data-a="add">+ Add store</button><button type="button" class="btn s" data-a="tpl">⬇ Template</button>${fileBtn('⬆ Upload (add / update)', 'st')}
      <button type="button" class="btn s" data-a="exp">⬇ Export</button><a class="btn ghost" href="qr.html?all=1" style="text-decoration:none">🖨 All QR posters</a></span></div>
      <div class="kpis one" data-r="kpi"></div><div data-r="add"></div><div data-r="imp"></div><div data-r="res"></div>
      <div class="card" style="padding-top:8px"><div class="toolrow"><span class="sub" style="margin:0" data-r="cnt"></span><input class="f" type="search" data-r="q" placeholder="Search code / name / city / AM / ZFM / RLPO" style="width:300px"></div>
        <div class="tw"><table class="edt"><thead><tr><th class="l">Store</th><th class="l">Name</th><th class="l">AM</th><th class="l">ZFM</th><th class="l">RLPO</th><th class="l">Store mail</th><th class="l">GPS</th><th class="l">SG set</th><th class="l">HK total · split</th><th class="l">Active</th><th class="l"></th></tr></thead><tbody data-r="tb"></tbody></table></div>
        <div data-r="pg"></div></div><div data-r="save"></div>`;
    const R = (k) => root.querySelector(`[data-r="${k}"]`);
    const filtered = () => { const q = st.q.toLowerCase();
      return rows.filter(F[st.f][1]).filter((s) => !q || `${s.store_code} ${s.name} ${s.city || ''} ${uname(s.am_emp)} ${uname(s.zfm_emp)} ${s.rlpo_name || ''} ${s.rlpo_mail || ''}`.toLowerCase().includes(q)); };
    function paintKpi() {
      R('kpi').innerHTML = Object.entries(F).map(([k, [l, fn, c]]) => `<button type="button" class="kpi fl ${c === 'r' ? 'r' : c === 'a' ? 'a' : ''} ${st.f === k ? 'on' : ''}" data-stf="${k}"${st.f === k && (!c || c === 'ok') ? ' style="border-color:var(--acc);background:var(--acc-l)"' : ''}>
        <span class="l">${l}</span><span class="v" style="color:${c === 'r' ? 'var(--red)' : c === 'a' ? 'var(--amb)' : c === 'ok' ? 'var(--ok)' : 'var(--ink)'}">${nf(rows.filter(fn).length)}</span><span class="go">${st.f === k ? 'Showing ✓' : 'Click to filter'}</span></button>`).join('');
    }
    const cell = (s, k, html) => `<td class="l${st.edit[s.store_code] && k in st.edit[s.store_code] ? ' chg' : ''}" data-c="${k}">${html}</td>`;
    function rowHtml(s) {
      const c = esc(s.store_code), act = val(s, 'active');
      return `<tr data-code="${c}"><td class="l code">${c}${s.is_test ? ' <span class="tg info">TEST</span>' : ''}<small>${esc(s.city || '')}</small></td>
        ${cell(s, 'name', `<input class="ci nm" data-se="name" value="${esc(val(s, 'name'))}" aria-label="Name ${c}">`)}
        ${cell(s, 'am_emp', `<select class="ci" data-se="am_emp" aria-label="AM ${c}">${opts(amL(), val(s, 'am_emp'), '— none')}</select>`)}
        ${cell(s, 'zfm_emp', `<select class="ci" data-se="zfm_emp" aria-label="ZFM ${c}">${opts(zfL(), val(s, 'zfm_emp'), '— none')}</select>`)}
        ${cell(s, 'rlpo_mail', `<select class="ci" data-se="rlpo_mail" aria-label="RLPO ${c}">${opts(rlL(), val(s, 'rlpo_mail'), '— missing')}</select>`)}
        ${cell(s, 'store_email', `<input class="ci ml" type="email" data-se="store_email" value="${esc(val(s, 'store_email'))}" placeholder="missing" aria-label="Store mail ${c}">`)}
        <td class="l">${s.lat != null && s.lat !== '' ? '<span class="tg ok">Set</span>' : '<span class="tg red">Missing</span>'}</td>
        ${cell(s, 'sg_set', `<select class="ci" data-se="sg_set" style="min-width:70px" aria-label="SG set ${c}"><option value="8"${val(s, 'sg_set') === '8' ? ' selected' : ''}>8 hr</option><option value="12"${val(s, 'sg_set') === '12' ? ' selected' : ''}>12 hr</option></select>`)}
        ${cell(s, 'hk_total', `<span class="hkc"><input class="ci nu" type="number" min="0" step="1" data-se="hk_total" value="${esc(val(s, 'hk_total'))}" placeholder="—" aria-label="HK total ${c}">${s.hk_total == null ? '' : s.hk_split_set === false ? '<span class="tg amb" title="Store has not entered Morning / Evening yet">Split not set</span>' : `<span class="tg ok" title="Morning / Evening (by store)">${s.hk_morning ?? '–'} / ${s.hk_evening ?? '–'}</span>`}</span>`)}
        ${cell(s, 'active', `<span class="sw"><button type="button" data-sa="1" class="${act ? 'on y' : ''}">Y</button><button type="button" data-sa="0" class="${act ? '' : 'on n'}">N</button></span>`)}
        <td class="l"><button type="button" class="btn ghost sm" data-more="${c}">✎ More</button></td></tr>`;
    }
    function paintTable() {
      const f = filtered();
      R('cnt').textContent = `${plural(f.length, 'store')}${st.f !== 'all' ? ' · ' + F[st.f][0] : ''}${st.q ? ` · “${st.q}”` : ''}`;
      R('tb').innerHTML = pageSlice(f, st).map(rowHtml).join('') || '<tr><td class="l" colspan="11" style="color:var(--mut)">No stores match</td></tr>';
      R('pg').innerHTML = pagerHtml(f.length, st);
    }
    function paintSave() {
      const n = nCh(), ns = Object.keys(st.edit).length;
      R('save').innerHTML = n ? `<div class="sticky-save"><b>${plural(n, 'change')} in ${plural(ns, 'store')}</b><button type="button" class="btn s sm" data-a="disc">Discard</button><button type="button" class="btn sm" data-a="save">Save changes</button></div>` : '';
    }
    const paintRes = () => { R('res').innerHTML = st.res ? resLine(st.res) : ''; };
    function paintAdd() {
      R('add').innerHTML = !st.add ? '' : `<div class="card"><div class="hd"><h2>Add a store</h2><button type="button" class="btn ghost sm" data-a="add">✕ Close</button></div><div class="frm" style="margin-top:8px">
        <label>Store code<input class="f" data-ad="store_code" maxlength="4" placeholder="AB12" style="text-transform:uppercase"></label><label>Name<input class="f" data-ad="name"></label><label>City<input class="f" data-ad="city"></label>
        <label>AM<select data-ad="am_emp">${opts(amL(), '', '—')}</select></label><label>ZFM<select data-ad="zfm_emp">${opts(zfL(), '', '—')}</select></label><label>RLPO<select data-ad="rlpo_mail">${opts(rlL(), '', '—')}</select></label>
        <label>Store mail<input class="f" type="email" data-ad="store_email"></label><label>Latitude<input class="f" data-ad="lat" inputmode="decimal"></label><label>Longitude<input class="f" data-ad="lng" inputmode="decimal"></label>
        <label>SG set<select data-ad="sg_set"><option value="8">8 hr</option><option value="12">12 hr</option></select></label><label>HK total<input class="f" type="number" min="0" data-ad="hk_total" placeholder="optional"></label>
        <label>&nbsp;<button type="button" class="btn" data-a="addsave">Add store</button></label></div><div class="note r" data-r="adderr" hidden style="margin-top:8px"></div></div>`;
    }
    function paintAll() { paintKpi(); paintTable(); paintSave(); paintRes(); }
    async function reload() { drop('stores'); rows = await aget('stores', true); paintKpi(); paintTable(); }

    function setEdit(code, k, v) {
      const s = rows.find((x) => x.store_code === code); if (!s) return;
      const e = st.edit[code] || (st.edit[code] = {});
      if (k === 'active' ? v === !!s.active : String(v) === orig(s, k)) delete e[k]; else e[k] = v;
      if (!Object.keys(e).length) delete st.edit[code];
      const td = root.querySelector(`tr[data-code="${CSS.escape(code)}"] td[data-c="${k}"]`); if (td) td.classList.toggle('chg', !!(st.edit[code] && k in st.edit[code]));
      paintSave();
    }
    const baseRow = (s) => ({ store_code: s.store_code, name: s.name, city: s.city || '', am_emp: s.am_emp || '', zfm_emp: s.zfm_emp || '', lat: s.lat ?? '', lng: s.lng ?? '',
      active: !!s.active, store_email: s.store_email || '', am_email: s.am_email || '', zfm_email: s.zfm_email || '' });
    async function saveEdits() {
      const out = [], bad = [];
      Object.entries(st.edit).forEach(([code, e]) => {
        const s = rows.find((x) => x.store_code === code); if (!s) return;
        const o = baseRow(s);
        ['name', 'am_emp', 'zfm_emp', 'store_email', 'active'].forEach((k) => { if (k in e) o[k] = e[k]; });
        if ('am_emp' in e && umail(e.am_emp)) o.am_email = umail(e.am_emp);
        if ('zfm_emp' in e && umail(e.zfm_emp)) o.zfm_email = umail(e.zfm_emp);
        if ('rlpo_mail' in e) o.rlpo_mail = e.rlpo_mail;
        if ('sg_set' in e) o.sg_set = +e.sg_set;
        if ('hk_total' in e) o.hk_total = e.hk_total === '' ? null : +e.hk_total;
        const msg = !String(o.name).trim() ? 'Name missing' : !mailOk(o.store_email) ? 'Store mail format wrong'
          : 'hk_total' in e && (e.hk_total === '' || !Number.isInteger(+e.hk_total) || +e.hk_total < 0) ? 'HK total must be a whole number 0 or more' : null;
        if (msg) bad.push({ store: code, error: msg }); else out.push(o);
      });
      if (bad.length && !out.length) { st.res = { at: nowHM(), u: 0, a: 0, errs: bad }; paintRes(); return; }
      const b = root.querySelector('[data-a="save"]'); if (b) { b.disabled = true; b.textContent = 'Saving…'; }
      const r = await rpc('admin_stores_upsert', { p_token: me.token, p_rows: out });
      if (!r || !r.ok) { if (b) { b.disabled = false; b.textContent = 'Save changes'; } st.res = { at: nowHM(), u: 0, a: 0, errs: [{ store: '', error: (r && r.error) || 'NETWORK' }] }; paintRes(); return; }
      const errs = bad.concat(r.errors || []); const failed = new Set(errs.map((x) => x.store));
      Object.keys(st.edit).forEach((c) => { if (!failed.has(c)) delete st.edit[c]; });
      st.res = { at: nowHM(), u: r.updated, a: r.added, errs };
      drop('rlpos'); await reload(); paintSave(); paintRes();
      toast(errs.length ? `Saved with ${errs.length} error(s)` : 'Saved');
    }
    async function addStore() {
      const v = {}; root.querySelectorAll('[data-ad]').forEach((el) => { v[el.dataset.ad] = String(el.value || '').trim(); });
      v.store_code = v.store_code.toUpperCase();
      const err = !/^[A-Z]{2}\d{2}$/.test(v.store_code) ? 'Store code must be 2 letters + 2 digits (e.g. AB12).' : rows.some((s) => s.store_code === v.store_code) ? 'This store code already exists.'
        : !v.name ? 'Enter the store name.' : (v.lat && isNaN(+v.lat)) || (v.lng && isNaN(+v.lng)) ? 'Latitude / Longitude must be numbers.' : !mailOk(v.store_email) ? 'Check the store mail.'
        : v.hk_total && (!Number.isInteger(+v.hk_total) || +v.hk_total < 0) ? 'HK total must be a whole number.' : null;
      const eb = R('adderr'); if (err) { eb.hidden = false; eb.textContent = err; return; }
      const o = { store_code: v.store_code, name: v.name, city: v.city, am_emp: v.am_emp, zfm_emp: v.zfm_emp, lat: v.lat, lng: v.lng, active: true, store_email: v.store_email,
        am_email: umail(v.am_emp), zfm_email: umail(v.zfm_emp), sg_set: +v.sg_set };
      if (v.rlpo_mail) o.rlpo_mail = v.rlpo_mail; if (v.hk_total !== '') o.hk_total = +v.hk_total;
      const r = await rpc('admin_stores_upsert', { p_token: me.token, p_rows: [o] });
      if (!r || !r.ok) { eb.hidden = false; eb.textContent = eText(r && r.error); return; }
      st.res = { at: nowHM(), u: r.updated, a: r.added, errs: r.errors || [], msg: `${v.store_code} ${v.name}` };
      if (!(r.errors || []).length) { st.add = false; paintAdd(); }
      await reload(); paintRes();
    }
    function more(code) {
      const s = rows.find((x) => x.store_code === code); if (!s) return;
      formModal(`✎ ${s.store_code} · ${s.name}`, [
        { k: 'store_code', label: 'Store code', v: s.store_code, lock: true }, { k: 'name', label: 'Store name', v: s.name }, { k: 'city', label: 'City', v: s.city || '' },
        { k: 'lat', label: 'Latitude', v: s.lat ?? '', ph: 'e.g. 28.6415' }, { k: 'lng', label: 'Longitude', v: s.lng ?? '', ph: 'e.g. 77.1209' },
        { k: 'store_email', label: 'Store mail', type: 'email', v: s.store_email || '' }, { k: 'am_email', label: 'AM mail', type: 'email', v: s.am_email || '' },
        { k: 'zfm_email', label: 'ZFM mail', type: 'email', v: s.zfm_email || '' },
        { type: 'static', label: 'HK split (by store)', html: s.hk_total == null ? 'No HK requirement' : s.hk_split_set === false ? `Not set · total ${s.hk_total} counts in Morning` : `Morning ${s.hk_morning ?? '–'} · Evening ${s.hk_evening ?? '–'} (total ${s.hk_total})` },
        { type: 'static', label: 'QR poster', html: `<a href="qr.html?s=${encodeURIComponent(s.store_code)}" target="_blank" rel="noopener">Open poster for ${esc(s.store_code)}</a>` },
      ], async (v) => {
        if (!v.name) return 'Enter the store name.'; if ((v.lat && isNaN(+v.lat)) || (v.lng && isNaN(+v.lng))) return 'Latitude / Longitude must be numbers.';
        if (![v.store_email, v.am_email, v.zfm_email].every(mailOk)) return 'Check the mail format.';
        if ((v.lat === '') !== (v.lng === '')) return 'Enter both latitude and longitude.';
        const o = { ...baseRow(s), name: v.name, city: v.city, lat: v.lat, lng: v.lng, store_email: v.store_email, am_email: v.am_email, zfm_email: v.zfm_email };
        const r = await rpc('admin_stores_upsert', { p_token: me.token, p_rows: [o] });
        if (!r || !r.ok) return eText(r && r.error); if ((r.errors || []).length) return eText(r.errors[0].error);
        toast('Saved'); st.res = { at: nowHM(), u: r.updated, a: r.added, errs: [], msg: `${s.store_code} details` }; await reload(); paintRes(); return null;
      }, { wide: true, note: 'Changes go to the Access Log (who, when, old → new). Lat / Lng are needed for the geo-fence. A blank mail keeps the old one.' });
    }

    /* Excel */
    const HDR = ['StoreCode', 'StoreName', 'City', 'State', 'SM Name', 'SM Mail', 'AM Name', 'AM Code', 'AM Mail', 'ZFM Name', 'ZFM Code', 'ZFM Email', 'RLPO Mail', 'SG Set', 'HK Total', 'Latitude', 'Longitude', 'Active'];
    const smName = (c) => (users.find((u) => u.role === 'store' && u.store_code === c && u.post === 'SM') || {}).name || '';
    const expRow = (s) => ({ StoreCode: s.store_code, StoreName: s.name, City: s.city || '', State: '', 'SM Name': smName(s.store_code), 'SM Mail': s.store_email || '',
      'AM Name': s.am_emp ? uname(s.am_emp) : '', 'AM Code': s.am_emp || '', 'AM Mail': s.am_email || '', 'ZFM Name': s.zfm_emp ? uname(s.zfm_emp) : '', 'ZFM Code': s.zfm_emp || '', 'ZFM Email': s.zfm_email || '',
      'RLPO Mail': s.rlpo_mail || '', 'SG Set': s.sg_set || 8, 'HK Total': s.hk_total ?? '', Latitude: s.lat ?? '', Longitude: s.lng ?? '', Active: s.active ? 'TRUE' : 'FALSE' });
    function parse(raw) {
      const res = { good: [], errors: [], newCount: 0, updCount: 0, same: 0 }; const seen = new Set(); const people = new Map();
      raw.forEach((r, i) => {
        const ex0 = rows.find((s) => s.store_code === g(r, 'storecode', 'store_code', 'store').toUpperCase());
        const keep = (v, k) => v !== '' ? v : ex0 ? String(ex0[k] ?? '') : '';
        const o = { store_code: g(r, 'storecode', 'store_code', 'store').toUpperCase(), name: keep(g(r, 'storename', 'name', 'store_name'), 'name'), city: keep(g(r, 'city'), 'city'),
          am_emp: keep(g(r, 'am_code', 'am_emp', 'am'), 'am_emp'), zfm_emp: keep(g(r, 'zfm_code', 'zfm_emp', 'zfm'), 'zfm_emp'), lat: g(r, 'latitude', 'lat'), lng: g(r, 'longitude', 'lng', 'long'),
          active: r.active === undefined || r.active === '' ? (ex0 ? !!ex0.active : true) : yes(r.active),
          store_email: g(r, 'sm_mail', 'store_email', 'store_mail'), am_email: g(r, 'am_mail', 'am_email'), zfm_email: g(r, 'zfm_email', 'zfm_mail') };
        const rl = g(r, 'rlpo_mail', 'rlpo').toLowerCase(), sg = g(r, 'sg_set', 'sg_shift', 'shift_set').replace(/\s*hr?s?$/i, ''), hk = g(r, 'hk_total', 'hk');
        const clash = (e, role) => { const u = users.find((x) => x.emp_code === e); return u && u.role !== role ? u.role : ''; };
        const bad = !/^[A-Z]{2}\d{2}$/.test(o.store_code) ? 'Store Code must be 2 letters + 2 digits' : !o.name ? 'Name missing' : seen.has(o.store_code) ? 'Store Code repeated in file'
          : (o.lat && isNaN(+o.lat)) || (o.lng && isNaN(+o.lng)) ? 'Lat / Lng not a number'
          : o.am_emp && clash(o.am_emp, 'am') ? `AM Code ${o.am_emp} already exists as ${clash(o.am_emp, 'am')}` : o.zfm_emp && clash(o.zfm_emp, 'zfm') ? `ZFM Code ${o.zfm_emp} already exists as ${clash(o.zfm_emp, 'zfm')}`
          : ![o.store_email, o.am_email, o.zfm_email].every(mailOk) ? 'Mail format wrong' : rl && !rlpos.some((x) => x.mail === rl) ? `RLPO ${rl} not in RLPO Master`
          : sg && !['8', '12'].includes(sg) ? 'SG Set must be 8 or 12' : hk && (!Number.isInteger(+hk) || +hk < 0) ? 'HK Total must be a whole number' : null;
        if (bad) { res.errors.push({ row: i + 2, msg: bad, data: r }); return; }
        [['am', o.am_emp, g(r, 'am_name'), o.am_email], ['zfm', o.zfm_emp, g(r, 'zfm_name'), o.zfm_email]].forEach(([role, code, nm, em]) => {
          if (!code || users.some((x) => x.emp_code === code)) return;
          const k = people.get(code); if (!k) people.set(code, { emp_code: code, name: nm || code, role, email: em, active: true }); else if (!k.email && em) k.email = em;
        });
        seen.add(o.store_code);
        const ex = ex0;
        if (ex) { if (rl !== '' && rl !== (ex.rlpo_mail || '')) o.rlpo_mail = rl; if (sg && +sg !== (ex.sg_set || 8)) o.sg_set = +sg; if (hk !== '' && +hk !== ex.hk_total) o.hk_total = +hk; }
        else { if (rl) o.rlpo_mail = rl; if (sg) o.sg_set = +sg; if (hk !== '') o.hk_total = +hk; }
        if (!ex) res.newCount++;
        else if (['name', 'city', 'am_emp', 'zfm_emp'].some((k) => (ex[k] || '') !== o[k]) || ['store_email', 'am_email', 'zfm_email'].some((k) => o[k] && (ex[k] || '') !== o[k].toLowerCase())
          || ex.active !== o.active || (o.lat && +o.lat !== +ex.lat) || (o.lng && +o.lng !== +ex.lng) || 'rlpo_mail' in o || 'sg_set' in o || 'hk_total' in o) res.updCount++;
        else { res.same++; return; }
        res.good.push(o);
      });
      res.people = [...people.values()];
      if (res.people.length) res.note = `+ ${res.people.filter((x) => x.role === 'am').length} AM and ${res.people.filter((x) => x.role === 'zfm').length} ZFM logins will be created (PIN via setup code from Mail Center).`;
      return res;
    }

    root.addEventListener('click', async (e) => {
      if (pagerEvent(e, st, filtered().length)) return paintTable();
      const k = e.target.closest('[data-stf]'); if (k) { st.f = k.dataset.stf; st.page = 1; paintKpi(); paintTable(); return; }
      const sa = e.target.closest('[data-sa]'); if (sa) { const tr = sa.closest('tr'); const on = sa.dataset.sa === '1'; setEdit(tr.dataset.code, 'active', on);
        const w = sa.parentElement; w.children[0].className = on ? 'on y' : ''; w.children[1].className = on ? '' : 'on n'; return; }
      const mo = e.target.closest('[data-more]'); if (mo) return more(mo.dataset.more);
      const b = e.target.closest('[data-a]'); if (!b) return;
      const a = b.dataset.a;
      if (a === 'add') { st.add = !st.add; paintAdd(); b.blur(); if (st.add) { const f = root.querySelector('[data-ad="store_code"]'); if (f) f.focus(); } }
      if (a === 'addsave') { b.disabled = true; await addStore(); b.disabled = false; }
      if (a === 'disc') { st.edit = {}; paintTable(); paintSave(); }
      if (a === 'save') saveEdits();
      if (a === 'tpl') downloadXlsx([Object.fromEntries(HDR.map((h) => [h, { StoreCode: 'AB12', StoreName: 'Rajouri Garden', City: 'Delhi', State: 'Delhi', 'SM Name': 'Store Manager', 'SM Mail': 'ab12@company.com',
        'AM Name': 'AM Name', 'AM Code': '20117', 'AM Mail': 'am@company.com', 'ZFM Name': 'ZFM Name', 'ZFM Code': '30001', 'ZFM Email': 'zfm@company.com', 'RLPO Mail': 'rlpo@company.com',
        'SG Set': 8, 'HK Total': 3, Latitude: 28.6415, Longitude: 77.1209, Active: 'TRUE' }[h]]))], 'Store_Master_template.xlsx', 'Stores');
      if (a === 'exp') downloadXlsx(filtered().map(expRow), `Store_Master_${todayIST()}.xlsx`, 'Stores');
    });
    root.addEventListener('input', (e) => {
      if (e.target === R('q')) { st.q = e.target.value.trim(); st.page = 1; clearTimeout(st.tq); st.tq = setTimeout(paintTable, 150); return; }
      const se = e.target.closest('[data-se]'); if (se && se.tagName === 'INPUT') setEdit(se.closest('tr').dataset.code, se.dataset.se, se.value.trim());
    });
    root.addEventListener('change', async (e) => {
      if (pagerEvent(e, st, filtered().length)) return paintTable();
      const se = e.target.closest('[data-se]'); if (se && se.tagName === 'SELECT') return setEdit(se.closest('tr').dataset.code, se.dataset.se, se.value);
      if (e.target.matches('[data-up="st"]')) {
        const f = await readSheet(e.target); if (!f) return;
        const res = parse(f.rows);
        importBox(R('imp'), f.name, res, async (good) => {
          if (res.people.length) { const pr = await rpc('admin_users_upsert', { p_token: me.token, p_rows: res.people });
            if (!pr || !pr.ok) { st.res = { at: nowHM(), errs: [{ store: 'AM/ZFM', error: (pr && pr.error) || 'NETWORK' }] }; R('imp').innerHTML = ''; return paintRes(); }
            drop('users'); users = await aget('users'); }
          const r = await rpc('admin_stores_upsert', { p_token: me.token, p_rows: good });
          R('imp').innerHTML = '';
          st.res = r && r.ok ? { at: nowHM(), u: r.updated, a: r.added, errs: (r.errors || []).concat(res.errors.map((x) => ({ store: 'row ' + x.row, error: x.msg }))), msg: `Upload ${f.name}` }
            : { at: nowHM(), errs: [{ store: '', error: (r && r.error) || 'NETWORK' }] };
          drop('rlpos'); await reload(); paintRes();
        }, 'Store_Master');
      }
    });
    paintAll(); paintAdd();
  }

  /* ================= MANPOWER MASTER ================= */
  async function ManpowerMaster(root) {
    root.innerHTML = SPIN;
    let cats, rows, stores;
    try { [cats, rows, stores] = await Promise.all([aget('categories'), aget('manpower', true), aget('stores')]); } catch (e) { root.innerHTML = `<div class="note r">${esc(e.message)}</div>`; return; }
    cats = cats.filter((c) => c.active !== false);
    const st = { tab: (cats[0] || {}).id || 'HK', q: '', ven: '', page: 1, size: defSize(), eff: todayIST() };
    const cat = () => cats.find((c) => c.id === st.tab) || { id: st.tab, name: st.tab, brands: [] };
    const kind = (c = cat()) => c.id === 'HK' ? 'hk' : c.id === 'SEC' ? 'sec' : (c.brands || []).length ? 'brand' : 'plain';
    const sName = (c) => (stores.find((s) => s.store_code === c) || {}).name || '';
    const NOTE = { hk: 'Admin uploads only the <b>total</b> Housekeeping count. Each store enters its own Morning / Evening split (store login → HK split). Changing the total resets the split.',
      sec: 'Security: Morning / Evening guards + the store’s shift set (8-hr or 12-hr) used for the A / H / P rule.',
      brand: 'One row per store + brand.', plain: 'One row per store.' };
    const COLS = {
      hk: [['Store', (r) => `<b>${esc(r.store_code)}</b><small>${esc(sName(r.store_code))}</small>`, 'l'], ['Vendor', (r) => esc(r.vendor || '—'), 'l'], ['HK total', (r) => r.hk_total ?? (r.morning + r.evening)],
        ['Morning (by store)', (r) => r.hk_split_set === false ? '—' : r.morning], ['Evening (by store)', (r) => r.hk_split_set === false ? '—' : r.evening],
        ['Split', (r) => r.hk_split_set === false ? '<span class="tg amb">Not set</span>' : '<span class="tg ok">Set</span>', 'l'], ['Effective from', (r) => esc(r.effective_from || ''), 'l']],
      sec: [['Store', (r) => `<b>${esc(r.store_code)}</b><small>${esc(sName(r.store_code))}</small>`, 'l'], ['Vendor', (r) => esc(r.vendor || '—'), 'l'], ['Morning', (r) => r.morning], ['Evening', (r) => r.evening],
        ['Shift set', (r) => `${r.sg_set || 8} hr`, 'l'], ['Effective from', (r) => esc(r.effective_from || ''), 'l']],
      brand: [['Store', (r) => `<b>${esc(r.store_code)}</b><small>${esc(sName(r.store_code))}</small>`, 'l'], ['Brand', (r) => esc(r.brand || '—'), 'l'], ['Vendor', (r) => esc(r.vendor || '—'), 'l'],
        ['Morning', (r) => r.morning], ['Evening', (r) => r.evening], ['Effective from', (r) => esc(r.effective_from || ''), 'l']],
    };
    COLS.plain = COLS.brand.filter((c) => c[0] !== 'Brand');
    const tabRows = () => rows.filter((r) => r.category_id === st.tab);
    const filtered = () => { const q = st.q.toLowerCase(); return tabRows().filter((r) => (!st.ven || (r.vendor || '') === st.ven) && (!q || `${r.store_code} ${sName(r.store_code)} ${r.vendor || ''} ${r.brand || ''}`.toLowerCase().includes(q))); };
    root.innerHTML = `<div class="toolrow"><div><h1 class="pt">Manpower Master</h1><div class="sub">Required people per store. Every save is a new version from its effective date; past days keep the old numbers.</div></div>
      <span class="acts"><label class="sub" style="margin:0;display:flex;gap:6px;align-items:center">Effective from <input class="f" type="date" data-r="eff" value="${st.eff}"></label>
      <button type="button" class="btn s" data-a="tpl">⬇ Template</button>${fileBtn('⬆ Upload Excel', 'mp')}<button type="button" class="btn s" data-a="exp">⬇ Export</button><button type="button" class="btn" data-a="add">+ Add row</button></span></div>
      <div data-r="imp"></div><div data-r="res"></div>
      <div class="card"><div class="tabs" data-r="tabs"></div><div class="note" style="margin-top:8px" data-r="note"></div>
        <div class="toolrow" style="margin-top:8px"><span class="sub" style="margin:0" data-r="cnt"></span><span class="acts"><select data-r="ven" aria-label="Vendor"></select><input class="f" type="search" data-r="q" placeholder="Search store / vendor / brand" style="width:240px"></span></div>
        <div class="tw"><table><thead data-r="th"></thead><tbody data-r="tb"></tbody></table></div><div data-r="pg"></div></div>`;
    const R = (k) => root.querySelector(`[data-r="${k}"]`);
    function paint() {
      const c = cat(), K = kind(c), cols = COLS[K];
      R('tabs').innerHTML = cats.map((x) => `<button type="button" data-tab="${esc(x.id)}" class="${x.id === st.tab ? 'on' : ''}">${esc(x.name)} <small style="opacity:.7">${rows.filter((r) => r.category_id === x.id).length}</small></button>`).join('');
      R('note').innerHTML = `${NOTE[K]} Template and upload are for <b>${esc(c.name)}</b> only.`;
      root.querySelector('[data-a="tpl"]').textContent = `⬇ ${c.name} template`;
      const vens = [...new Set(tabRows().map((r) => r.vendor).filter(Boolean))].sort();
      if (st.ven && !vens.includes(st.ven)) st.ven = '';
      R('ven').innerHTML = `<option value="">Vendor: All</option>${vens.map((v) => `<option${v === st.ven ? ' selected' : ''}>${esc(v)}</option>`).join('')}`;
      const f = filtered();
      R('cnt').textContent = `${plural(f.length, 'row')} · ${c.name}`;
      R('th').innerHTML = `<tr>${cols.map(([h, , l]) => `<th class="${l || ''}">${h}</th>`).join('')}<th class="l"></th></tr>`;
      R('tb').innerHTML = pageSlice(f, st).map((r) => `<tr>${cols.map(([, fn, l]) => `<td class="${l || ''}">${fn(r)}</td>`).join('')}<td class="l"><button type="button" class="btn s sm" data-ed="${rows.indexOf(r)}">✎ Edit</button></td></tr>`).join('')
        || `<tr><td class="l" colspan="${cols.length + 1}" style="color:var(--mut)">No ${esc(c.name)} rows${st.q || st.ven ? ' match' : ' yet: download the template and upload'}</td></tr>`;
      R('pg').innerHTML = pagerHtml(f.length, st);
    }
    async function reload() { drop('manpower'); rows = await aget('manpower', true); paint(); }
    async function save(list, eff, label) {
      const r = await rpc('admin_manpower_upload', { p_token: me.token, p_rows: list, p_effective: eff || st.eff || todayIST() });
      R('res').innerHTML = resLine(r && r.ok ? { at: nowHM(), u: r.count, errs: r.skipped ? [{ key: 'rows', error: `${r.skipped} row(s) skipped (category unknown)` }] : [],
        msg: `${label} · from ${eff || st.eff}${r.sg_updated ? ` · shift set changed in ${r.sg_updated} store(s)` : ''}` } : { at: nowHM(), errs: [{ key: '', error: (r && r.error) || 'NETWORK' }] });
      if (r && r.ok) { drop('stores'); stores = await aget('stores'); await reload(); }
      return r;
    }
    const TPL = {
      hk: () => [{ 'Store Code': 'AB12', Vendor: 'BVG India', 'HK Total': 4, 'Effective From': '' }],
      sec: () => [{ 'Store Code': 'AB12', Vendor: 'G4S Secure', Morning: 1, Evening: 1, 'Shift Set': 12, 'Effective From': '' }],
      brand: () => (cat().brands || ['Brand']).slice(0, 2).map((b) => ({ 'Store Code': 'AB12', Brand: b, Vendor: `${b} India`, Morning: 1, Evening: 0, 'Effective From': '' })),
      plain: () => [{ 'Store Code': 'AB12', Vendor: 'Vendor name', Morning: 1, Evening: 0, 'Effective From': '' }],
    };
    const EXP = {
      hk: (r) => ({ 'Store Code': r.store_code, 'Store Name': sName(r.store_code), Vendor: r.vendor || '', 'HK Total': r.hk_total ?? (r.morning + r.evening), 'Morning (by store)': r.hk_split_set === false ? '' : r.morning, 'Evening (by store)': r.hk_split_set === false ? '' : r.evening, Split: r.hk_split_set === false ? 'Not set' : 'Set', 'Effective From': r.effective_from || '' }),
      sec: (r) => ({ 'Store Code': r.store_code, 'Store Name': sName(r.store_code), Vendor: r.vendor || '', Morning: r.morning, Evening: r.evening, 'Shift Set': r.sg_set || 8, 'Effective From': r.effective_from || '' }),
      brand: (r) => ({ 'Store Code': r.store_code, 'Store Name': sName(r.store_code), Brand: r.brand || '', Vendor: r.vendor || '', Morning: r.morning, Evening: r.evening, 'Effective From': r.effective_from || '' }),
      plain: (r) => ({ 'Store Code': r.store_code, 'Store Name': sName(r.store_code), Vendor: r.vendor || '', Morning: r.morning, Evening: r.evening, 'Effective From': r.effective_from || '' }),
    };
    function check(o, c) {
      const K = kind(c), n = (x) => Number.isInteger(x) && x >= 0 && x <= 99;
      if (!stores.some((s) => s.store_code === o.store_code)) return `Store ${o.store_code || '(blank)'} not in Store Master`;
      if (!okDate(o.effective_from)) return 'Effective From must be a date (YYYY-MM-DD or DD-MM-YYYY)';
      if (K === 'hk') return n(o.hk_total) ? null : 'HK Total must be a whole number 0–99';
      if (K === 'brand' && !(c.brands || []).includes(o.brand)) return `Brand must be one of ${(c.brands || []).join(' / ')}`;
      if (![o.morning, o.evening].every(n)) return 'Morning / Evening must be whole numbers 0–99';
      if (K === 'sec' && o.sg_set != null && ![8, 12].includes(o.sg_set)) return 'Shift Set must be 8 or 12';
      return null;
    }
    function parse(raw) {
      const c = cat(), K = kind(c), res = { good: [], errors: [], newCount: 0, updCount: 0, same: 0 }, seen = new Set();
      raw.forEach((r, i) => {
        const fc = g(r, 'category'); if (fc && ![c.id, c.name].map((x) => String(x).toLowerCase()).includes(fc.toLowerCase())) { res.errors.push({ row: i + 2, msg: `Category ${fc}: upload it on the ${fc} tab`, data: r }); return; }
        const num = (v) => v === '' ? 0 : Number(v);
        const o = { store_code: g(r, 'store_code', 'store', 'storecode').toUpperCase(), category: c.id, brand: K === 'brand' ? g(r, 'brand') : '', vendor: g(r, 'vendor'),
          morning: num(g(r, 'morning')), evening: num(g(r, 'evening')), effective_from: toDate(r.effective_from ?? r.effective ?? '') };
        if (K === 'hk') { o.hk_total = num(g(r, 'hk_total', 'total', 'hk')); o.morning = o.hk_total; o.evening = 0; }
        if (K === 'brand') { const b = (c.brands || []).find((x) => x.toLowerCase() === o.brand.toLowerCase()); if (b) o.brand = b; }
        if (K === 'sec') { const s = g(r, 'shift_set', 'sg_set', 'shift').replace(/\s*hr?s?$/i, ''); o.sg_set = s === '' ? null : Number(s); }
        const key = `${o.store_code}|${o.brand}`;
        const bad = check(o, c) || (seen.has(key) ? 'Same store' + (o.brand ? ' + brand' : '') + ' repeated in file' : null);
        if (bad) { res.errors.push({ row: i + 2, msg: bad, data: r }); return; }
        seen.add(key); if (o.sg_set == null) delete o.sg_set;
        const ex = rows.find((x) => x.store_code === o.store_code && x.category_id === c.id && (x.brand || '') === o.brand);
        if (!ex) res.newCount++;
        else if ((ex.vendor || '') !== o.vendor || (K === 'hk' ? (ex.hk_total ?? ex.morning + ex.evening) !== o.hk_total : ex.morning !== o.morning || ex.evening !== o.evening)
          || (K === 'sec' && o.sg_set && o.sg_set !== (ex.sg_set || 8)) || o.effective_from) res.updCount++;
        else { res.same++; return; }
        res.good.push(o);
      });
      return res;
    }
    function edit(r) {
      const c = cat(), K = kind(c), F = [];
      F.push(r ? { type: 'static', label: 'Store', html: `<b>${esc(r.store_code)}</b> · ${esc(sName(r.store_code))}` }
        : { k: 'store_code', label: 'Store', type: 'select', v: '', options: [['', '— pick']].concat(stores.filter((s) => s.active).map((s) => [s.store_code, `${s.store_code} · ${s.name}`])) });
      if (K === 'brand') F.push(r ? { type: 'static', label: 'Brand', html: esc(r.brand) } : { k: 'brand', label: 'Brand', type: 'select', v: (c.brands || [])[0], options: (c.brands || []).map((b) => [b, b]) });
      F.push({ k: 'vendor', label: 'Vendor', v: r ? r.vendor || '' : '' });
      if (K === 'hk') F.push({ k: 'hk_total', label: 'HK total', type: 'number', v: r ? r.hk_total ?? (r.morning + r.evening) : 1 });
      else F.push({ k: 'morning', label: 'Morning', type: 'number', v: r ? r.morning : 1 }, { k: 'evening', label: 'Evening', type: 'number', v: r ? r.evening : 0 });
      if (K === 'sec') F.push({ k: 'sg_set', label: 'Shift set', type: 'select', v: String(r ? r.sg_set || 8 : 8), options: [['8', '8 hr'], ['12', '12 hr']] });
      F.push({ k: 'effective_from', label: 'Effective from', type: 'date', v: st.eff });
      formModal(r ? `✎ ${c.name} · ${r.store_code}${r.brand ? ' · ' + r.brand : ''}` : `+ ${c.name} row`, F, async (v) => {
        const o = { store_code: r ? r.store_code : v.store_code, category: c.id, brand: r ? r.brand || '' : v.brand || '', vendor: v.vendor, effective_from: v.effective_from || st.eff,
          morning: K === 'hk' ? +v.hk_total : +v.morning, evening: K === 'hk' ? 0 : +v.evening };
        if (K === 'hk') o.hk_total = +v.hk_total; if (K === 'sec') o.sg_set = +v.sg_set;
        const bad = check(o, c); if (bad) return bad;
        if (!r && rows.some((x) => x.store_code === o.store_code && x.category_id === c.id && (x.brand || '') === o.brand)) return 'This store already has a row: use ✎ Edit on it.';
        const res = await save([o], o.effective_from, `${o.store_code} ${c.name}`); return res && res.ok ? null : eText(res && res.error);
      }, { note: `Saved as a new version from the effective date. ${K === 'hk' ? 'A new total resets the store’s Morning / Evening split.' : ''}` });
    }
    root.addEventListener('click', (e) => {
      if (pagerEvent(e, st, filtered().length)) return paint();
      const t = e.target.closest('[data-tab]'); if (t) { st.tab = t.dataset.tab; st.page = 1; st.q = ''; R('q').value = ''; R('imp').innerHTML = ''; return paint(); }
      const ed = e.target.closest('[data-ed]'); if (ed) return edit(rows[+ed.dataset.ed]);
      const b = e.target.closest('[data-a]'); if (!b) return;
      const c = cat(), K = kind(c);
      if (b.dataset.a === 'tpl') downloadXlsx(TPL[K](), `Manpower_${c.id}_template.xlsx`, c.id);
      if (b.dataset.a === 'exp') downloadXlsx(filtered().map(EXP[K]), `Manpower_${c.id}_${todayIST()}.xlsx`, c.id);
      if (b.dataset.a === 'add') edit(null);
    });
    root.addEventListener('input', (e) => { if (e.target === R('q')) { st.q = e.target.value.trim(); st.page = 1; clearTimeout(st.tq); st.tq = setTimeout(paint, 150); } });
    root.addEventListener('change', async (e) => {
      if (pagerEvent(e, st, filtered().length)) return paint();
      if (e.target === R('ven')) { st.ven = e.target.value; st.page = 1; return paint(); }
      if (e.target === R('eff')) { st.eff = e.target.value || todayIST(); return; }
      if (e.target.matches('[data-up="mp"]')) {
        const f = await readSheet(e.target); if (!f) return; const c = cat();
        const res = parse(f.rows);
        importBox(R('imp'), `${f.name} → ${c.name}`, res, async (good) => { await save(good, st.eff, `Upload ${f.name}`); R('imp').innerHTML = ''; }, `Manpower_${c.id}`);
      }
    });
    paint();
  }

  /* ================= RLPO MASTER ================= */
  async function RlpoMaster(root) {
    root.innerHTML = SPIN;
    let rl, stores, users;
    try { [rl, stores, users] = await Promise.all([aget('rlpos', true), aget('stores'), aget('users')]); } catch (e) { root.innerHTML = `<div class="note r">${esc(e.message)}</div>`; return; }
    const st = { tab: 'list', q: '', mf: '', page: 1, size: defSize(), res: null };
    const uname = (e) => (users.find((x) => x.emp_code === e) || {}).name || e || '';
    root.innerHTML = `<div class="toolrow"><div><h1 class="pt">RLPO Master</h1><div class="sub">Regional LP Officers approve Security mis-punch / time edits and mark P*. They log in with their mail id.</div></div><span class="acts" data-r="acts"></span></div>
      <div class="kpis k4" data-r="kpi"></div><div data-r="imp"></div><div data-r="res"></div>
      <div class="card"><div class="tabs"><button type="button" data-tab="list">RLPO list</button><button type="button" data-tab="map">Store mapping</button></div><div data-r="body"></div></div>`;
    const R = (k) => root.querySelector(`[data-r="${k}"]`);
    const act = () => stores.filter((s) => s.active);
    const mapRows = () => { const q = st.q.toLowerCase(); return act().filter((s) => (st.mf === '' || (st.mf === '-' ? !s.rlpo_mail : s.rlpo_mail === st.mf)) && (!q || `${s.store_code} ${s.name} ${s.city || ''} ${uname(s.am_emp)} ${s.rlpo_name || ''}`.toLowerCase().includes(q)))
      .sort((a, b) => (a.rlpo_mail ? 1 : 0) - (b.rlpo_mail ? 1 : 0) || a.store_code.localeCompare(b.store_code)); };
    const listRows = () => { const q = st.q.toLowerCase(); return rl.filter((r) => !q || `${r.name} ${r.mail} ${r.phone || ''} ${r.region || ''}`.toLowerCase().includes(q)); };
    function paint() {
      const T = st.tab;
      root.querySelectorAll('.tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === T));
      R('acts').innerHTML = `<button type="button" class="btn s" data-a="tpl">⬇ ${T === 'list' ? 'RLPO list' : 'Mapping'} template</button>${fileBtn(`⬆ Upload ${T === 'list' ? 'RLPO list' : 'mapping'}`, T)}<button type="button" class="btn s" data-a="exp">⬇ Export</button>${T === 'list' ? '<button type="button" class="btn" data-a="add">+ Add RLPO</button>' : ''}`;
      const un = act().filter((s) => !s.rlpo_mail).length;
      R('kpi').innerHTML = kpiBox('RLPOs active', nf(rl.filter((r) => r.active !== false).length), `${rl.length} in total`) + kpiBox('Stores mapped', nf(act().length - un), `of ${nf(act().length)} active`, 'var(--ok)')
        + `<button type="button" class="kpi fl a${T === 'map' && st.mf === '-' ? ' on' : ''}" data-a="unmapped"><span class="l">Stores without RLPO</span><span class="v" style="color:var(--amb)">${nf(un)}</span><span class="go">Map now ›</span></button>`
        + kpiBox('PIN not set', nf(rl.filter((r) => r.active !== false && !r.pin_set).length), 'send the invite (✉) or Mail Center');
      if (T === 'list') {
        const L = listRows();
        R('body').innerHTML = `<div class="toolrow" style="margin-top:8px"><span class="sub" style="margin:0">${plural(L.length, 'RLPO')}</span><input class="f" type="search" data-r="q" value="${esc(st.q)}" placeholder="Search name / mail / region" style="width:240px"></div>
          <div class="tw"><table><thead><tr><th class="l">RLPO</th><th class="l">Mail id (login)</th><th class="l">Phone</th><th class="l">Region</th><th>Stores</th><th class="l">PIN</th><th class="l">Last login</th><th class="l">Status</th><th class="l"></th></tr></thead><tbody>
          ${L.map((r) => `<tr><td class="l"><b>${esc(r.name)}</b>${r.is_test ? ' <span class="tg info">TEST</span>' : ''}</td><td class="l">${esc(r.mail)}</td><td class="l">${esc(r.phone || '—')}</td><td class="l">${esc(r.region || '—')}</td>
            <td>${r.n_stores ? `<button type="button" class="lk" data-a="mapof" data-m="${esc(r.mail)}">${r.n_stores}</button>` : 0}</td><td class="l">${pinTag(r)}</td><td class="l">${esc(r.last_login || '—')}</td>
            <td class="l"><span class="tg ${r.active !== false ? 'ok' : 'grey'}">${r.active !== false ? 'Active' : 'Off'}</span></td>
            <td class="l"><button type="button" class="btn s sm" data-ed="${esc(r.mail)}">✎ Edit</button> ${r.active !== false && (r.pin_set || r.locked) ? `<button type="button" class="btn ghost sm" data-reset="${esc(r.mail)}">Reset PIN</button> ` : ''}${r.active !== false ? `<button type="button" class="btn ghost sm" data-inv="${esc(r.mail)}" title="Download invite .eml${r.pin_set ? '' : ' (with a new setup code)'}">✉ Invite</button>` : ''}</td></tr>`).join('')
            || '<tr><td class="l" colspan="9" style="color:var(--mut)">No RLPOs yet. + Add RLPO or upload the RLPO list.</td></tr>'}</tbody></table></div>`;
      } else {
        const L = mapRows();
        const opt = (v) => `<option value="">— not mapped</option>${rl.filter((r) => r.active !== false || r.mail === v).map((r) => `<option value="${esc(r.mail)}"${r.mail === v ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}`;
        R('body').innerHTML = `<div class="toolrow" style="margin-top:8px"><span class="sub" style="margin:0">Pick the RLPO for each store: it saves at once. Bulk: template has Store Code + RLPO Mail.</span>
          <span class="acts"><select data-r="mf" aria-label="Filter"><option value="">All active stores</option><option value="-"${st.mf === '-' ? ' selected' : ''}>Not mapped</option>${rl.map((r) => `<option value="${esc(r.mail)}"${st.mf === r.mail ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
          <input class="f" type="search" data-r="q" value="${esc(st.q)}" placeholder="Search store / AM" style="width:200px"></span></div>
          <div class="tw"><table class="edt"><thead><tr><th class="l">Store</th><th class="l">Name</th><th class="l">AM</th><th class="l">SG set</th><th class="l">RLPO</th><th class="l"></th></tr></thead><tbody>
          ${pageSlice(L, st).map((s) => `<tr><td class="l code"><b>${esc(s.store_code)}</b></td><td class="l">${esc(s.name)}</td><td class="l">${esc(uname(s.am_emp) || '—')}</td><td class="l">${s.sg_set || 8} hr</td>
            <td class="l"><select class="ci" data-map="${esc(s.store_code)}" aria-label="RLPO for ${esc(s.store_code)}">${opt(s.rlpo_mail || '')}</select></td><td class="l" data-ok="${esc(s.store_code)}"></td></tr>`).join('')
            || '<tr><td class="l" colspan="6" style="color:var(--mut)">No stores match</td></tr>'}</tbody></table></div>${pagerHtml(L.length, st)}`;
      }
      R('res').innerHTML = st.res ? resLine(st.res) : '';
    }
    async function reload() { drop('rlpos', 'stores'); [rl, stores] = await Promise.all([aget('rlpos', true), aget('stores', true)]); paint(); }
    function edit(r) {
      formModal(r ? `✎ ${r.name}` : '+ Add RLPO', [
        { k: 'name', label: 'Name', v: r ? r.name : '' }, { k: 'mail', label: 'Mail id (login)', type: 'email', v: r ? r.mail : '', lock: !!r },
        { k: 'phone', label: 'Phone', v: r ? r.phone || '' : '' }, { k: 'region', label: 'Region', v: r ? r.region || '' : '', ph: 'e.g. MP + Rajasthan' },
        { k: 'active', label: 'Status', type: 'select', v: r ? String(r.active !== false) : 'true', options: [['true', 'Active'], ['false', 'Off']] }],
      async (v) => {
        if (!v.name) return 'Enter the name.'; if (!isMail(v.mail)) return 'Enter a valid mail id (it is the login id).';
        if (!r && rl.some((x) => x.mail === v.mail.toLowerCase())) return 'This mail id is already an RLPO.';
        const x = await rpc('admin_rlpo_upsert', { p_token: me.token, p_rows: [{ mail: v.mail.toLowerCase(), name: v.name, phone: v.phone, region: v.region, active: v.active === 'true' }] });
        if (!x || !x.ok) return eText(x && x.error); if ((x.errors || []).length) return eText(x.errors[0].error);
        toast(r ? 'Saved' : 'RLPO added · send the invite (✉) so they can set a PIN'); drop('users'); await reload(); return null;
      }, { note: r ? 'Mail id is the login id and cannot change. To replace it, add a new RLPO and switch the mapping.' : 'After adding, use ✉ Invite to send the setup code.' });
    }
    async function mapOne(sel) {
      const code = sel.dataset.map, mail = sel.value, cellOk = root.querySelector(`[data-ok="${CSS.escape(code)}"]`);
      sel.disabled = true;
      const r = await rpc('admin_rlpo_map', { p_token: me.token, p_rows: [{ store: code, rlpo_mail: mail }] });
      sel.disabled = false;
      if (r && r.ok && !(r.errors || []).length) {
        const s = stores.find((x) => x.store_code === code); if (s) { s.rlpo_mail = mail || null; s.rlpo_name = mail ? (rl.find((x) => x.mail === mail) || {}).name : null; }
        rl.forEach((x) => { x.n_stores = stores.filter((y) => y.rlpo_mail === x.mail).length; }); drop('stores');
        if (cellOk) cellOk.innerHTML = '<span class="tg ok">Saved ✓</span>';
        const un = act().filter((s2) => !s2.rlpo_mail).length; const k = root.querySelector('[data-a="unmapped"] .v'); if (k) k.textContent = nf(un);
      } else { toast(eText(r && ((r.errors || [])[0] || {}).error || (r && r.error))); const s = stores.find((x) => x.store_code === code); sel.value = (s && s.rlpo_mail) || ''; }
    }
    function parseList(raw) {
      const res = { good: [], errors: [], newCount: 0, updCount: 0, same: 0 }, seen = new Set();
      raw.forEach((r, i) => {
        const o = { mail: g(r, 'mail', 'mail_id', 'email', 'rlpo_mail').toLowerCase(), name: g(r, 'name', 'rlpo_name', 'rlpo'), phone: g(r, 'phone', 'mobile'), region: g(r, 'region', 'zone'), active: yes(r.active) };
        const ex = rl.find((x) => x.mail === o.mail);
        const clash = users.find((u) => u.emp_code === o.mail && u.role !== 'rlpo');
        const bad = !isMail(o.mail) ? 'Mail id missing or wrong' : !o.name && !ex ? 'Name missing' : seen.has(o.mail) ? 'Mail repeated in file' : clash ? `Mail already used by a ${RN[clash.role] || clash.role} login` : null;
        if (bad) { res.errors.push({ row: i + 2, msg: bad, data: r }); return; }
        seen.add(o.mail);
        if (!ex) res.newCount++; else if ((o.name && o.name !== ex.name) || (o.phone || '') !== (ex.phone || '') || (o.region || '') !== (ex.region || '') || o.active !== (ex.active !== false)) res.updCount++; else { res.same++; return; }
        res.good.push(o);
      });
      return res;
    }
    function parseMap(raw) {
      const res = { good: [], errors: [], newCount: 0, updCount: 0, same: 0 }, seen = new Set();
      raw.forEach((r, i) => {
        const o = { store: g(r, 'store_code', 'store', 'storecode').toUpperCase(), rlpo_mail: g(r, 'rlpo_mail', 'mail', 'rlpo', 'mail_id').toLowerCase() };
        const s = stores.find((x) => x.store_code === o.store);
        const bad = !s ? `Store ${o.store || '(blank)'} not in Store Master` : o.rlpo_mail && !rl.some((x) => x.mail === o.rlpo_mail) ? `RLPO ${o.rlpo_mail} not in RLPO list` : seen.has(o.store) ? 'Store repeated in file' : null;
        if (bad) { res.errors.push({ row: i + 2, msg: bad, data: r }); return; }
        seen.add(o.store);
        if ((s.rlpo_mail || '') === o.rlpo_mail) { res.same++; return; }
        if (s.rlpo_mail) res.updCount++; else res.newCount++;
        res.good.push(o);
      });
      res.note = 'Blank RLPO Mail removes the mapping for that store.';
      return res;
    }
    root.addEventListener('click', async (e) => {
      if (st.tab === 'map' && pagerEvent(e, st, mapRows().length)) return paint();
      const t = e.target.closest('[data-tab]'); if (t) { st.tab = t.dataset.tab; st.q = ''; st.page = 1; R('imp').innerHTML = ''; return paint(); }
      const ed = e.target.closest('[data-ed]'); if (ed) return edit(rl.find((x) => x.mail === ed.dataset.ed));
      const rs = e.target.closest('[data-reset]'); if (rs) return resetPin(rs, async () => { drop('users'); await reload(); });
      const iv = e.target.closest('[data-inv]'); if (iv) { iv.disabled = true; const r = rl.find((x) => x.mail === iv.dataset.inv);
        if (await inviteEml({ ...r, role: 'rlpo', emp_code: r.mail, email: r.mail })) { r.has_code = r.has_code || !r.pin_set; paint(); } else iv.disabled = false; return; }
      const b = e.target.closest('[data-a]'); if (!b) return;
      const a = b.dataset.a;
      if (a === 'add') edit(null);
      if (a === 'unmapped') { st.tab = 'map'; st.mf = '-'; st.page = 1; st.q = ''; paint(); }
      if (a === 'mapof') { st.tab = 'map'; st.mf = b.dataset.m; st.page = 1; st.q = ''; paint(); }
      if (a === 'tpl') downloadXlsx(st.tab === 'list' ? [{ Name: 'Sanjay Rathore', Mail: 'sanjay.rathore@company.com', Phone: '98290 11223', Region: 'MP + Rajasthan', Active: 'TRUE' }]
        : act().slice(0, 3).map((s) => ({ 'Store Code': s.store_code, 'Store Name': s.name, 'RLPO Mail': s.rlpo_mail || '' })).concat(act().length ? [] : [{ 'Store Code': 'AB12', 'Store Name': 'Store', 'RLPO Mail': 'rlpo@company.com' }]),
      `RLPO_${st.tab === 'list' ? 'list' : 'mapping'}_template.xlsx`, st.tab === 'list' ? 'RLPO' : 'Mapping');
      if (a === 'exp') downloadXlsx(st.tab === 'list' ? listRows().map((r) => ({ Name: r.name, Mail: r.mail, Phone: r.phone || '', Region: r.region || '', Stores: r.n_stores, PIN: r.pin_set ? 'Set' : 'Not set', 'Last login': r.last_login || '', Active: r.active !== false ? 'TRUE' : 'FALSE' }))
        : mapRows().map((s) => ({ 'Store Code': s.store_code, 'Store Name': s.name, AM: uname(s.am_emp), 'SG Set': s.sg_set || 8, 'RLPO Mail': s.rlpo_mail || '', 'RLPO Name': s.rlpo_name || '' })),
      `RLPO_${st.tab === 'list' ? 'list' : 'mapping'}_${todayIST()}.xlsx`, st.tab === 'list' ? 'RLPO' : 'Mapping');
    });
    root.addEventListener('input', (e) => { if (e.target.matches('[data-r="q"]')) { st.q = e.target.value.trim(); st.page = 1; clearTimeout(st.tq); st.tq = setTimeout(() => { paint(); const q = R('q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 200); } });
    root.addEventListener('change', async (e) => {
      if (st.tab === 'map' && pagerEvent(e, st, mapRows().length)) return paint();
      if (e.target.matches('[data-map]')) return mapOne(e.target);
      if (e.target.matches('[data-r="mf"]')) { st.mf = e.target.value; st.page = 1; return paint(); }
      const up = e.target.closest('[data-up]'); if (!up) return;
      const f = await readSheet(up); if (!f) return;
      if (up.dataset.up === 'list') {
        const res = parseList(f.rows);
        importBox(R('imp'), f.name, res, async (good) => { const r = await rpc('admin_rlpo_upsert', { p_token: me.token, p_rows: good }); R('imp').innerHTML = '';
          st.res = r && r.ok ? { at: nowHM(), u: r.updated, a: r.added, errs: (r.errors || []).concat(res.errors.map((x) => ({ key: 'row ' + x.row, error: x.msg }))), msg: `RLPO list · ${f.name}` } : { at: nowHM(), errs: [{ key: '', error: (r && r.error) || 'NETWORK' }] };
          drop('users'); await reload(); }, 'RLPO_list');
      } else {
        const res = parseMap(f.rows);
        importBox(R('imp'), f.name, res, async (good) => { const r = await rpc('admin_rlpo_map', { p_token: me.token, p_rows: good }); R('imp').innerHTML = '';
          st.res = r && r.ok ? { at: nowHM(), u: r.updated, errs: (r.errors || []).concat(res.errors.map((x) => ({ key: 'row ' + x.row, error: x.msg }))), msg: `Mapping · ${f.name}` } : { at: nowHM(), errs: [{ key: '', error: (r && r.error) || 'NETWORK' }] };
          await reload(); }, 'RLPO_mapping');
      }
    });
    paint();
  }

  /* ================= USERS & PIN (AM / ZFM / HO; store + admin listed for PIN reset; RLPO lives in RLPO Master) ================= */
  async function UsersView(root) {
    root.innerHTML = SPIN;
    let users, depts;
    try { [users, depts] = await Promise.all([aget('users', true), aget('departments')]); } catch (e) { root.innerHTML = `<div class="note r">${esc(e.message)}</div>`; return; }
    const st = { q: '', role: '', pin: '', page: 1, size: defSize(), res: null };
    const ROLES = [['am', 'AM'], ['zfm', 'ZFM'], ['hodept', 'HO Dept'], ['store', 'Store'], ['admin', 'Admin']];
    const list = () => { const q = st.q.toLowerCase(); return users.filter((u) => u.role !== 'rlpo' && (!st.role || u.role === st.role)
      && (!st.pin || (st.pin === 'set' ? u.pin_set : st.pin === 'no' ? !u.pin_set && u.active : st.pin === 'lock' ? u.locked : !u.active))
      && (!q || `${u.name} ${u.emp_code} ${u.store_code || ''} ${u.email || ''} ${u.dept || ''} ${u.post || ''}`.toLowerCase().includes(q))); };
    const empOk = (e, role) => role === 'hodept' ? isMail(e) : /^\d{5,}$/.test(e);
    root.innerHTML = `<div class="toolrow"><div><h1 class="pt">Users &amp; PIN</h1><div class="sub">AM, ZFM and Admin log in with Emp Code or mail id · HO Dept with mail id · RLPOs are in RLPO Master · store logins register themselves (one per post).</div></div>
      <span class="acts"><button type="button" class="btn s" data-a="tpl">⬇ Template</button>${fileBtn('⬆ Upload Excel', 'us')}<button type="button" class="btn s" data-a="exp">⬇ Export</button><button type="button" class="btn" data-a="add">+ Add user</button></span></div>
      <div class="kpis k4" data-r="kpi"></div><div data-r="imp"></div><div data-r="res"></div>
      <div class="card" style="padding-top:8px"><div class="toolrow"><span class="sub" style="margin:0" data-r="cnt"></span><span class="acts">
        <select data-r="role" aria-label="Role"><option value="">Role: All</option>${ROLES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        <select data-r="pin" aria-label="PIN"><option value="">PIN: All</option><option value="set">Set</option><option value="no">Not set</option><option value="lock">Locked</option><option value="off">Inactive / vacated</option></select>
        <input class="f" type="search" data-r="q" placeholder="Search name / code / store / mail" style="width:240px"></span></div>
        <div class="tw"><table><thead><tr><th class="l">Role</th><th class="l">Name</th><th class="l">Login ID</th><th class="l">Post / Dept</th><th class="l">Store</th><th class="l">PIN</th><th class="l">Last login</th><th class="l"></th></tr></thead><tbody data-r="tb"></tbody></table></div><div data-r="pg"></div></div>`;
    const R = (k) => root.querySelector(`[data-r="${k}"]`);
    function paint() {
      const nonStore = users.filter((u) => ['am', 'zfm', 'hodept'].includes(u.role) && u.active);
      R('kpi').innerHTML = kpiBox('AM', nf(users.filter((u) => u.role === 'am' && u.active).length)) + kpiBox('ZFM', nf(users.filter((u) => u.role === 'zfm' && u.active).length))
        + kpiBox('HO Dept', nf(users.filter((u) => u.role === 'hodept' && u.active).length)) + kpiBox('PIN not set (AM / ZFM / HO)', nf(nonStore.filter((u) => !u.pin_set).length), 'invite from ✉ or Mail Center', 'var(--amb)');
      const f = list();
      R('cnt').textContent = plural(f.length, 'user');
      R('tb').innerHTML = pageSlice(f, st).map((u) => `<tr><td class="l"><span class="tg info">${RN[u.role] || u.role}</span></td><td class="l"><b>${esc(u.name)}</b>${u.is_test ? ' <span class="tg info">TEST</span>' : ''}</td>
        <td class="l">${u.role === 'hodept' ? esc(u.email || u.emp_code) : esc(u.emp_code)}${u.role !== 'hodept' && u.role !== 'store' && u.email ? `<small>or ${esc(u.email)}</small>` : ''}</td>
        <td class="l">${esc(u.post || u.dept || '—')}</td><td class="l">${esc(u.store_code || '—')}${u.store_name ? `<small>${esc(u.store_name)}</small>` : ''}</td><td class="l">${pinTag(u)}</td><td class="l">${esc(u.last_login || '—')}</td>
        <td class="l">${u.role !== 'store' ? `<button type="button" class="btn s sm" data-ed="${esc(u.emp_code)}">✎ Edit</button> ` : ''}${(u.role !== 'admin' || u.emp_code !== me.emp) && u.active && (u.pin_set || u.locked) ? `<button type="button" class="btn ghost sm" data-reset="${esc(u.emp_code)}">Reset PIN</button> ` : ''}
          ${u.role !== 'store' && u.active ? `<button type="button" class="btn ghost sm" data-inv="${esc(u.emp_code)}" title="Download invite .eml">✉</button>` : ''}</td></tr>`).join('')
        || '<tr><td class="l" colspan="8" style="color:var(--mut)">No users match</td></tr>';
      R('pg').innerHTML = pagerHtml(f.length, st);
      R('res').innerHTML = st.res ? resLine(st.res) : '';
    }
    async function reload() { drop('users'); users = await aget('users', true); paint(); }
    function edit(u) {
      const isAdm = u && u.role === 'admin';
      formModal(u ? `✎ ${u.name}` : '+ Add user', [
        { k: 'role', label: 'Role', type: 'select', v: u ? u.role : 'am', lock: !!u, options: isAdm ? [['admin', 'Admin']] : [['am', 'AM'], ['zfm', 'ZFM'], ['hodept', 'HO Dept']] },
        { k: 'name', label: 'Name', v: u ? u.name : '' },
        { k: 'emp_code', label: 'Emp Code (AM / ZFM) · Mail id (HO Dept)', v: u ? u.emp_code : '', lock: !!u },
        { k: 'email', label: 'Mail id', type: 'email', v: u ? u.email || '' : '' },
        { k: 'dept', label: 'HO Dept (HO only)', type: 'select', v: u ? u.dept || '' : '', options: [['', '—']].concat(depts.map((d) => [d.name, d.name])) },
        { k: 'active', label: 'Status', type: 'select', v: u ? String(!!u.active) : 'true', options: [['true', 'Active'], ['false', 'Inactive']] }],
      async (v) => {
        if (isAdm) return 'Admin users are changed by the portal owner only.';
        if (v.role === 'hodept' && !u && !v.emp_code && isMail(v.email)) v.emp_code = v.email;
        v.emp_code = v.role === 'hodept' ? v.emp_code.toLowerCase() : v.emp_code;
        const err = !empOk(v.emp_code, v.role) ? (v.role === 'hodept' ? 'HO Dept login id must be the mail id.' : 'Emp Code must be 5+ digits.') : !u && users.some((x) => x.emp_code === v.emp_code) ? 'This login id already exists.'
          : !v.name ? 'Enter the name.' : v.role === 'hodept' && !v.dept ? 'Pick the HO Dept.' : !mailOk(v.email) ? 'Check the mail format.' : null;
        if (err) return err;
        const r = await rpc('admin_users_upsert', { p_token: me.token, p_rows: [{ emp_code: v.emp_code, name: v.name, role: v.role, dept: v.role === 'hodept' ? v.dept : '', email: v.role === 'hodept' ? v.email || v.emp_code : v.email, active: v.active === 'true', post: '', store_code: '' }] });
        if (!r || !r.ok) return eText(r && r.error); toast(u ? 'Saved' : 'User added · send the invite (✉)'); await reload(); return null;
      }, { note: u ? 'Every change is saved in the Access Log.' : 'First PIN needs a setup code: use ✉ on the row or the Mail Center invite.' });
    }
    function parse(raw) {
      const res = { good: [], errors: [], newCount: 0, updCount: 0, same: 0 };
      raw.forEach((r, i) => {
        const o = { emp_code: g(r, 'emp_code', 'emp', 'login_id', 'mail_id'), name: g(r, 'name'), role: g(r, 'role').toLowerCase().replace(/\s+/g, ''), post: '', store_code: '',
          dept: g(r, 'dept', 'department'), email: g(r, 'email', 'mail'), active: yes(r.active) };
        if (o.role === 'ho' || o.role === 'hodepartment') o.role = 'hodept';
        if (o.role === 'hodept') { if (!o.emp_code && o.email) o.emp_code = o.email; o.emp_code = o.emp_code.toLowerCase(); if (!o.email) o.email = o.emp_code; }
        const ex = users.find((u) => u.emp_code === o.emp_code);
        const bad = !['am', 'zfm', 'hodept'].includes(o.role) ? 'Role must be am / zfm / hodept' : !empOk(o.emp_code, o.role) ? 'Emp Code must be 5+ digits (HO Dept: mail id)' : !o.name ? 'Name missing'
          : o.role === 'hodept' && !depts.some((d) => d.name.toLowerCase() === o.dept.toLowerCase()) ? `Dept "${o.dept}" not found` : !mailOk(o.email) ? 'Mail format wrong'
          : ex && ['admin', 'store', 'rlpo'].includes(ex.role) ? `${ex.emp_code} is a ${RN[ex.role]} login: not changed by this sheet` : null;
        if (bad) { res.errors.push({ row: i + 2, msg: bad, data: r }); return; }
        if (!ex) res.newCount++; else if (ex.name !== o.name || ex.role !== o.role || (ex.email || '') !== o.email.toLowerCase() || ex.active !== o.active || (o.role === 'hodept' && (ex.dept || '') !== o.dept)) res.updCount++; else { res.same++; return; }
        res.good.push(o);
      });
      return res;
    }
    root.addEventListener('click', async (e) => {
      if (pagerEvent(e, st, list().length)) return paint();
      const ed = e.target.closest('[data-ed]'); if (ed) return edit(users.find((u) => u.emp_code === ed.dataset.ed));
      const rs = e.target.closest('[data-reset]'); if (rs) return resetPin(rs, reload);
      const iv = e.target.closest('[data-inv]'); if (iv) { iv.disabled = true; const u = users.find((x) => x.emp_code === iv.dataset.inv); if (await inviteEml(u)) { u.has_code = u.has_code || !u.pin_set; paint(); } else iv.disabled = false; return; }
      const b = e.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.a === 'add') edit(null);
      if (b.dataset.a === 'tpl') downloadXlsx([{ 'Emp Code': '20117', Name: 'Vikas Sharma', Role: 'am', Dept: '', Email: 'vikas@company.com', Active: 'TRUE' },
        { 'Emp Code': '30001', Name: 'Anil Mehta', Role: 'zfm', Dept: '', Email: 'anil@company.com', Active: 'TRUE' },
        { 'Emp Code': 'p.das@company.com', Name: 'P. Das', Role: 'hodept', Dept: (depts[0] || {}).name || 'Security', Email: 'p.das@company.com', Active: 'TRUE' }], 'Users_template.xlsx', 'Users');
      if (b.dataset.a === 'exp') downloadXlsx(list().map((u) => ({ Role: RN[u.role] || u.role, 'Emp Code': u.emp_code, Name: u.name, Post: u.post || '', 'Store Code': u.store_code || '', Dept: u.dept || '', Email: u.email || '',
        Active: u.active ? 'TRUE' : 'FALSE', PIN: u.locked ? 'Locked' : u.pin_set ? 'Set' : 'Not set', 'Last login': u.last_login || '' })), `Users_${todayIST()}.xlsx`, 'Users');
    });
    root.addEventListener('input', (e) => { if (e.target === R('q')) { st.q = e.target.value.trim(); st.page = 1; clearTimeout(st.tq); st.tq = setTimeout(paint, 150); } });
    root.addEventListener('change', async (e) => {
      if (pagerEvent(e, st, list().length)) return paint();
      if (e.target === R('role')) { st.role = e.target.value; st.page = 1; return paint(); }
      if (e.target === R('pin')) { st.pin = e.target.value; st.page = 1; return paint(); }
      if (e.target.matches('[data-up="us"]')) {
        const f = await readSheet(e.target); if (!f) return; const res = parse(f.rows);
        importBox(R('imp'), f.name, res, async (good) => { const r = await rpc('admin_users_upsert', { p_token: me.token, p_rows: good }); R('imp').innerHTML = '';
          st.res = r && r.ok ? { at: nowHM(), u: r.count, errs: res.errors.map((x) => ({ key: 'row ' + x.row, error: x.msg })), msg: `${f.name} · added + updated` } : { at: nowHM(), errs: [{ key: '', error: (r && r.error) || 'NETWORK' }] };
          await reload(); }, 'Users');
      }
    });
    paint();
  }

  /* ================= HO DEPT MASTER ================= */
  async function DeptView(root) {
    root.innerHTML = SPIN;
    let cats, depts, users;
    const load = async () => { [cats, depts, users] = await Promise.all([aget('categories'), aget('departments', true), aget('users', true)]); };
    try { await load(); } catch (e) { root.innerHTML = `<div class="note r">${esc(e.message)}</div>`; return; }
    const cn = (id) => (cats.find((c) => c.id === id) || {}).name || id;
    const ho = () => users.filter((u) => u.role === 'hodept');
    root.innerHTML = `<div class="toolrow"><div><h1 class="pt">HO Dept Master</h1><div class="sub">Each HO department sees only its own categories. HO users log in with their <b>mail id</b> + Department + PIN.</div></div>
      <span class="acts"><button type="button" class="btn s" data-a="tpl">⬇ Template</button>${fileBtn('⬆ Upload Excel', 'ho')}<button type="button" class="btn s" data-a="exp">⬇ Export</button><button type="button" class="btn" data-a="add">+ Add department</button></span></div>
      <div data-r="imp"></div><div data-r="res"></div>
      <div class="card"><div class="tw"><table><thead><tr><th class="l">Department</th><th class="l">Categories it sees</th><th>Users</th><th class="l">Status</th><th class="l"></th></tr></thead><tbody data-r="tb"></tbody></table></div></div>
      <div class="card"><div class="hd"><h2>HO Dept users</h2><span class="sub">✉ downloads the invite .eml (with a setup code when no PIN yet)</span></div><div class="tw"><table><thead><tr><th class="l">Name</th><th class="l">Mail id (login)</th><th class="l">Dept</th><th class="l">PIN</th><th class="l">Last login</th><th class="l"></th></tr></thead><tbody data-r="us"></tbody></table></div></div>`;
    const R = (k) => root.querySelector(`[data-r="${k}"]`);
    function paint() {
      R('tb').innerHTML = depts.map((d) => `<tr><td class="l"><b>${esc(d.name)}</b></td><td class="l">${(d.category_ids || []).map((c) => `<span class="tg info">${esc(cn(c))}</span>`).join(' ') || '<span class="tg amb">none yet</span>'}</td>
        <td>${ho().filter((u) => u.dept === d.name).length}</td><td class="l"><span class="tg ${d.active === false ? 'grey' : 'ok'}">${d.active === false ? 'Off' : 'Active'}</span></td>
        <td class="l"><button type="button" class="btn s sm" data-ed="${d.id}">✎ Edit</button></td></tr>`).join('') || '<tr><td class="l" colspan="5" style="color:var(--mut)">No departments yet</td></tr>';
      R('us').innerHTML = ho().map((u) => `<tr><td class="l"><b>${esc(u.name)}</b></td><td class="l">${esc(u.email || u.emp_code)}</td><td class="l">${esc(u.dept || '—')}</td><td class="l">${pinTag(u)}</td><td class="l">${esc(u.last_login || '—')}</td>
        <td class="l">${(u.pin_set || u.locked) && u.active ? `<button type="button" class="btn ghost sm" data-reset="${esc(u.emp_code)}">Reset PIN</button> ` : ''}${u.active ? `<button type="button" class="btn ghost sm" data-inv="${esc(u.emp_code)}">✉ Invite</button>` : ''}</td></tr>`).join('')
        || '<tr><td class="l" colspan="6" style="color:var(--mut)">No HO users yet: ✎ Edit a department → Person name + Mail id, or Users &amp; PIN → + Add user.</td></tr>';
    }
    async function reload() { drop('users', 'departments'); await load(); paint(); }
    function edit(d) {
      formModal(d ? `✎ ${d.name}` : '+ Add department', [
        { k: 'name', label: 'Department name', v: d ? d.name : '' },
        { k: 'active', label: 'Status', type: 'select', v: d ? String(d.active !== false) : 'true', options: [['true', 'Active'], ['false', 'Off']] },
        { k: 'cats', label: 'Categories this department sees', type: 'multi', v: d ? d.category_ids || [] : [], options: cats.map((c) => [c.id, c.name]) },
        { k: 'pname', label: 'Add a person: name (optional)', v: '' }, { k: 'pmail', label: 'Mail id (login id)', type: 'email', v: '' }],
      async (v) => {
        if (v.name.length < 2) return 'Enter the department name.';
        if (depts.some((x) => x.name.toLowerCase() === v.name.toLowerCase() && (!d || x.id !== d.id))) return 'This department already exists.';
        if ((v.pname || v.pmail) && (!v.pname || !isMail(v.pmail))) return 'Person: enter the name and a valid mail id.';
        const r = await rpc('admin_dept_save', { p_token: me.token, p_id: d ? d.id : null, p_name: v.name, p_cats: v.cats, p_active: v.active === 'true' });
        if (!r || !r.ok) return eText(r && r.error);
        if (v.pmail) { const pm = v.pmail.toLowerCase(); const x = await rpc('admin_users_upsert', { p_token: me.token, p_rows: [{ emp_code: pm, name: v.pname, role: 'hodept', dept: v.name, email: pm, active: true }] }); if (!x || !x.ok) return eText(x && x.error); }
        toast('Saved'); await reload(); return null;
      }, { wide: true, note: 'One department can have many people. Renaming keeps its users.' });
    }
    function parse(raw) {
      const res = { good: [], errors: [], newCount: 0, updCount: 0, same: 0 };
      raw.forEach((r, i) => {
        const name = g(r, 'dept', 'department');
        const ids = g(r, 'categories', 'category').split(/[,;/]/).map((x) => x.trim()).filter(Boolean).map((x) => (cats.find((c) => c.id.toLowerCase() === x.toLowerCase() || c.name.toLowerCase() === x.toLowerCase()) || {}).id || '?' + x);
        const pn = g(r, 'person_name', 'person', 'name', 'user_name'), pm = g(r, 'mail', 'email', 'mail_id').toLowerCase();
        const bad = (pn || pm) && (!pn || !pm) ? 'Person name and Mail both needed' : pm && !isMail(pm) ? 'Mail format wrong' : name.length < 2 ? 'Dept name missing' : ids.find((x) => x.startsWith('?')) ? `Category ${ids.find((x) => x.startsWith('?')).slice(1)} unknown` : null;
        if (bad) { res.errors.push({ row: i + 2, msg: bad, data: r }); return; }
        const ex = depts.find((d) => d.name.toLowerCase() === name.toLowerCase()); if (ex) res.updCount++; else res.newCount++;
        res.good.push({ id: ex ? ex.id : null, name, cats: ids.length ? ids : ex ? ex.category_ids || [] : [], active: yes(r.active), person: pm ? { name: pn, mail: pm } : null });
      });
      return res;
    }
    root.addEventListener('click', async (e) => {
      const ed = e.target.closest('[data-ed]'); if (ed) return edit(depts.find((d) => String(d.id) === ed.dataset.ed));
      const rs = e.target.closest('[data-reset]'); if (rs) return resetPin(rs, reload);
      const iv = e.target.closest('[data-inv]'); if (iv) { iv.disabled = true; const u = users.find((x) => x.emp_code === iv.dataset.inv); if (await inviteEml(u)) { u.has_code = u.has_code || !u.pin_set; paint(); } else iv.disabled = false; return; }
      const b = e.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.a === 'add') edit(null);
      if (b.dataset.a === 'tpl') downloadXlsx([{ Dept: 'Security (LP)', Categories: 'SEC', 'Person Name': 'Person Name', Mail: 'person@company.com', Active: 'TRUE' }], 'HO_Departments_template.xlsx', 'Departments');
      if (b.dataset.a === 'exp') downloadXlsx(depts.flatMap((d) => { const us = ho().filter((u) => u.dept === d.name); const base = { Dept: d.name, Categories: (d.category_ids || []).join(', '), Active: d.active === false ? 'FALSE' : 'TRUE' };
        return us.length ? us.map((u) => ({ ...base, 'Person Name': u.name, Mail: u.email || u.emp_code, PIN: u.pin_set ? 'Set' : 'Not set' })) : [{ ...base, 'Person Name': '', Mail: '', PIN: '' }]; }), `HO_Departments_${todayIST()}.xlsx`, 'Departments');
    });
    root.addEventListener('change', async (e) => {
      if (!e.target.matches('[data-up="ho"]')) return;
      const f = await readSheet(e.target); if (!f) return; const res = parse(f.rows);
      importBox(R('imp'), f.name, res, async (good) => {
        let n = 0, errs = res.errors.map((x) => ({ key: 'row ' + x.row, error: x.msg }));
        for (const d of good) { const r = await rpc('admin_dept_save', { p_token: me.token, p_id: d.id, p_name: d.name, p_cats: d.cats, p_active: d.active }); if (r && r.ok) n++; else errs.push({ key: d.name, error: (r && r.error) || 'NETWORK' }); }
        const ppl = good.filter((d) => d.person).map((d) => ({ emp_code: d.person.mail, name: d.person.name, role: 'hodept', dept: d.name, email: d.person.mail, active: true }));
        if (ppl.length) { const r = await rpc('admin_users_upsert', { p_token: me.token, p_rows: ppl }); if (!r || !r.ok) errs.push({ key: 'people', error: (r && r.error) || 'NETWORK' }); }
        R('imp').innerHTML = ''; R('res').innerHTML = resLine({ at: nowHM(), u: n, errs, msg: `${f.name}${ppl.length ? ` · ${ppl.length} people` : ''}` }); await reload();
      }, 'HO_Departments');
    });
    paint();
  }

  /* ================= MAIL CENTER (preview pane + recipients tick list + .eml + ZIP + tracker) ================= */
  async function MailView(root) {
    const TYPES = [['invite', 'Login invite', 'Link, login id, steps · AM / ZFM / HO / RLPO get a setup code'], ['nopin', 'PIN not set / logins missing', 'People who never set a PIN · stores with posts not registered'],
      ['idle', 'Not logged in for N days', 'Stores / people who stopped opening the portal'], ['amday', 'AM daily: nobody punched', 'Stores with HK / Security required but 0 present'],
      ['amweek', 'Weekly: low attendance', 'To AM, CC ZFM · stores below the low % for N days'], ['month', 'Monthly statements ready', 'To store: print, sign, stamp, send to vendor'],
      ['custom', 'Admin custom mail', 'Your own subject + message with {Name} {Store} {EmpCode} {Link}']];
    const st = { type: 'invite', role: 'am', zfm: '', am: '', only: 'nopin', days: 3, ccAm: true, ccZfm: false, subj: '', body: '', sel: 0, off: new Set() };
    root.innerHTML = SPIN;
    let users, stores, cfg;
    try { [users, stores, cfg] = await Promise.all([aget('users', true), aget('stores'), aget('settings')]); } catch (e) { root.innerHTML = `<div class="note r">${esc(e.message)}</div>`; return; }
    users = users.filter((u) => u.active); stores = stores.filter((s) => s.active);
    const lowPct = cfg.low_pct || 70, lowDays = Math.min(6, Math.max(1, cfg.low_days || 3));
    root.innerHTML = `<div class="toolrow"><div><h1 class="pt">Mail Center</h1><div class="sub">Makes Outlook-ready .eml files (one ZIP, folders of 50) for your batch macro, plus a tracker. Setup codes are made when you download.</div></div><span class="acts"><button type="button" class="btn" data-a="zip">⬇ ZIP</button><button type="button" class="btn s" data-a="trk">⬇ Tracker</button></span></div>
      <div class="card"><div class="frm" data-r="frm"></div><div data-r="cc" style="margin-top:8px"></div><div data-r="custom"></div></div><div data-r="warn"></div>
      <div class="mcols"><div class="card"><div class="hd"><h2>Mail preview</h2><span data-r="pvb"></span></div><div data-r="pv" style="margin-top:8px"></div></div>
        <div class="card"><div class="hd"><h2 data-r="rh">Recipients</h2><span class="acts"><button type="button" class="btn ghost sm" data-a="all">Tick all</button><button type="button" class="btn ghost sm" data-a="none">Untick all</button></span></div>
          <div class="sub">Click a name to preview their mail. Untick to leave out of the ZIP.</div><input class="f" type="search" data-r="rq" placeholder="Find recipient" style="width:100%;margin-top:8px"><div class="rlist" style="margin-top:8px" data-r="rl"></div></div></div>`;
    const R = (k) => root.querySelector(`[data-r="${k}"]`);
    const uBy = new Map(users.map((u) => [u.emp_code, u]));
    const emailOf = (u) => u.email || (isMail(u.emp_code) ? u.emp_code : '') || (u.role === 'am' ? (stores.find((s) => s.am_emp === u.emp_code && s.am_email) || {}).am_email : u.role === 'zfm' ? (stores.find((s) => s.zfm_emp === u.emp_code && s.zfm_email) || {}).zfm_email : '') || '';
    const amMail = (s) => s.am_email || (uBy.get(s.am_emp) || {}).email || '';
    const zfmMail = (s) => s.zfm_email || (uBy.get(s.zfm_emp) || {}).email || '';
    let dash = null, week = null;
    async function ensureDash() {
      if (dash) return;
      const [d, w] = await Promise.all([rpc('dash_overview', { p_token: me.token, p_date: todayIST(), p_shift: istNow().getHours() < 14 ? 'M' : 'B', p_upto: null }), rpc('dash_week', { p_token: me.token, p_end: todayIST(), p_shift: 'B' })]);
      dash = d && d.ok ? d : { rows: [], categories: [] }; week = w && w.ok ? w.rows || [] : [];
    }
    const daysAgo = (ts) => ts ? Math.floor((Date.now() - new Date(ts).getTime()) / 86400000) : 9999;
    const inScope = (s) => (!st.zfm || s.zfm_emp === st.zfm) && (!st.am || s.am_emp === st.am);
    const fill = (txt, v) => String(txt).replace(/\{(\w+)\}/g, (m, k) => (v[k] ?? m));
    async function build() {
      const out = [], base = BASE();
      const userMail = (u, subject, html, needCode) => out.push({ key: 'u:' + u.emp_code, to: emailOf(u), cc: '', name: u.name, role: RN[u.role] || u.role, store: u.store_code || '', emp: u.emp_code, needCode, subject, html });
      const storeMail = (s, subject, html) => out.push({ key: 's:' + s.store_code, to: s.store_email || '', cc: [st.ccAm ? amMail(s) : '', st.ccZfm ? zfmMail(s) : ''].filter(Boolean).join('; '), name: `${s.store_code} · ${s.name}`, role: 'Store', store: s.store_code, emp: '', subject, html });
      const pool = () => users.filter((u) => u.role !== 'store' && (st.role === 'all' ? ['am', 'zfm', 'hodept', 'rlpo'].includes(u.role) : u.role === st.role)
        && (!st.zfm || u.role !== 'am' || stores.some((s) => s.am_emp === u.emp_code && s.zfm_emp === st.zfm)) && (!st.zfm || u.role !== 'zfm' || u.emp_code === st.zfm)
        && (!st.am || u.role !== 'am' || u.emp_code === st.am) && (!st.zfm || u.role !== 'rlpo' || stores.some((s) => s.rlpo_mail === u.emp_code && s.zfm_emp === st.zfm)));
      if (st.type === 'invite' || st.type === 'nopin') {
        if (st.role === 'store') {
          stores.filter(inScope).forEach((s) => {
            const reg = users.filter((u) => u.role === 'store' && u.store_code === s.store_code).map((u) => u.post); const missing = POSTS.filter((p) => !reg.includes(p));
            if (st.type === 'nopin' && !missing.length) return;
            storeMail(s, st.type === 'invite' ? `3rd Party Attendance portal · store logins (${s.store_code} ${s.name})` : `Reminder: register store logins · ${s.store_code} (${missing.length} pending)`,
              () => mailBox('3rd Party Staff Attendance · store login', `Dear Store Team (${esc(s.store_code)} ${esc(s.name)}),<br><br>Each of these posts gets its own login: <b>${POSTS.join(', ')}</b>.
                ${kv([['Link', base], ['Store Code', esc(s.store_code)], ['Not registered yet', missing.length ? missing.join(', ') : 'none']])}
                Steps (inside the store): open the link → <b>Store</b> → your Emp Code → your Post → Store Code → Next → your full name → small sum → set your own 4-digit PIN.<br>
                One login per post. Only one phone can be logged in at a time. Do not share your PIN. Forgot it? Ask your ZFM to reset.<br><br>Regards,<br>Central Ops &amp; BI`));
          });
        } else pool().filter((u) => st.type === 'nopin' || st.only === 'nopin' ? !u.pin_set : true).forEach((u) => { const m = inviteMail(u);
          userMail(u, st.type === 'invite' ? m.subject : 'Reminder: set your PIN · 3rd Party Attendance portal', m.html, !u.pin_set); });
      } else if (st.type === 'idle') {
        if (st.role === 'store') stores.filter(inScope).forEach((s) => { const us = users.filter((u) => u.role === 'store' && u.store_code === s.store_code && u.pin_set && daysAgo(u.last_login_ts) >= st.days); if (!us.length) return;
          storeMail(s, `Reminder: open the attendance portal · ${s.store_code}`, () => mailBox('Please use the attendance portal daily', `Dear Store Team (${esc(s.store_code)}),<br><br>These logins have not opened the portal for ${st.days}+ days:
            ${listT(us.map((u) => [esc(u.post), esc(u.name), esc(u.last_login || 'never')]), ['Post', 'Name', 'Last login'])}Please check the “not punched” list every morning and evening: <b>${base}</b><br><br>Regards,<br>Central Ops &amp; BI`)); });
        else pool().filter((u) => u.pin_set && daysAgo(u.last_login_ts) >= st.days).forEach((u) => userMail(u, 'Reminder: please check the 3rd Party Attendance dashboard',
          () => mailBox('Please check your dashboard', `Dear ${esc(u.name)},<br><br>You last opened the portal ${u.last_login ? 'on ' + esc(u.last_login) : 'never'}. The “Action needed” strip shows stores where nobody came today.${kv([['Link', base], ['Login ID', esc(loginId(u))]])}Regards,<br>Central Ops &amp; BI`), false));
      } else if (st.type === 'amday' || st.type === 'amweek') {
        await ensureDash();
        const cn = (id) => ((dash.categories || []).find((c) => c.id === id) || {}).name || id;
        const idx = Array.from({ length: lowDays }, (_, i) => 5 - i).reverse();
        users.filter((u) => u.role === 'am' && (!st.am || u.emp_code === st.am) && (!st.zfm || stores.some((s) => s.am_emp === u.emp_code && s.zfm_emp === st.zfm))).forEach((u) => {
          const my = stores.filter((s) => s.am_emp === u.emp_code); const set = new Set(my.map((s) => s.store_code)); let rows;
          if (st.type === 'amday') rows = (dash.rows || []).filter((x) => set.has(x.s) && (x.c === 'HK' || x.c === 'SEC') && x.req > 0 && x.p === 0)
            .map((x) => [`${esc(x.s)} ${esc((my.find((y) => y.store_code === x.s) || {}).name || '')}`, esc(cn(x.c)), `0 of ${x.req}`]);
          else { const by = {}; week.filter((x) => set.has(x.s)).forEach((x) => { const o = by[x.s] || (by[x.s] = { r: [0, 0, 0, 0, 0, 0, 0], p: [0, 0, 0, 0, 0, 0, 0] }); (x.r || []).forEach((v, i) => { o.r[i] += v; o.p[i] += Math.min((x.p || [])[i] || 0, v || (x.p || [])[i] || 0); }); });
            rows = Object.entries(by).filter(([, o]) => idx.every((i) => o.r[i] > 0 && pct(o.p[i], o.r[i]) < lowPct))
              .map(([sc, o]) => [esc(sc + ' ' + ((my.find((y) => y.store_code === sc) || {}).name || '')), idx.map((i) => pct(o.p[i], o.r[i]) + '%').join(' · ')]); }
          if (!rows.length) return;
          out.push({ key: 'u:' + u.emp_code, to: emailOf(u), cc: st.type === 'amweek' || st.ccZfm ? (my[0] ? zfmMail(my[0]) : '') : '', name: u.name, role: 'AM', store: `${rows.length} stores`, emp: u.emp_code,
            subject: st.type === 'amday' ? `Action today: ${rows.length} store(s) with nobody in HK / Security` : `Weekly: ${rows.length} store(s) below ${lowPct}% for ${lowDays} days`,
            html: () => mailBox(st.type === 'amday' ? 'Nobody punched today' : `Below ${lowPct}% for ${lowDays} days in a row`, `Dear ${esc(u.name)},<br><br>${st.type === 'amday'
              ? `As of ${nowHM()} today, these stores have required staff but nobody punched:` : `These stores were below ${lowPct}% attendance on each of the last ${lowDays} days. Please follow up with the vendor:`}
              ${listT(rows, st.type === 'amday' ? ['Store', 'Dept', 'Present'] : ['Store', `Last ${lowDays} days`])}Dashboard: <b>${base}</b><br><br>Regards,<br>Central Ops &amp; BI`) });
        });
      } else if (st.type === 'month') {
        const n = istNow(); const m = new Date(n.getFullYear(), n.getMonth() - (n.getDate() < 10 ? 1 : 0), 1); const ml = m.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
        stores.filter(inScope).forEach((s) => storeMail(s, `Monthly attendance statements ready · ${ml} · ${s.store_code}`, () => mailBox(`Statements for ${ml}`, `Dear Store Team (${esc(s.store_code)} ${esc(s.name)}),<br><br>
          The monthly attendance statements (P / A; Security also H) for <b>${ml}</b> are ready. Please: <ol><li>Open the portal → Statement</li><li>Print each associate’s statement</li><li>Sign and stamp</li><li>Send to the vendor</li></ol>Link: <b>${base}</b><br><br>Regards,<br>Central Ops &amp; BI`)));
      } else if (st.type === 'custom') {
        const subj = st.subj || '(no subject)', body = st.body || '';
        const html = (v) => mailBox(esc(fill(subj, v)), esc(fill(body, v)).replace(/\n/g, '<br>'));
        if (st.role === 'store') stores.filter(inScope).forEach((s) => { const v = { Name: 'Store Team', Store: `${s.store_code} ${s.name}`, EmpCode: '', Link: base }; storeMail(s, fill(subj, v), () => html(v)); });
        else pool().forEach((u) => { const v = { Name: u.name, Store: u.store_code || '', EmpCode: loginId(u), Link: base }; userMail(u, fill(subj, v), () => html(v), false); });
      }
      return out;
    }
    let recs = [];
    const ticked = () => recs.filter((x) => x.to && !st.off.has(x.key));
    function paintForm() {
      const zf = users.filter((u) => u.role === 'zfm'), am = users.filter((u) => u.role === 'am' && (!st.zfm || stores.some((s) => s.am_emp === u.emp_code && s.zfm_emp === st.zfm)));
      const roleOpts = st.type === 'amday' || st.type === 'amweek' ? [['am', 'AM']] : st.type === 'month' ? [['store', 'Store logins (store mail)']]
        : [['am', 'AM'], ['zfm', 'ZFM'], ['hodept', 'HO Dept'], ['rlpo', 'RLPO'], ['store', 'Store logins (store mail)'], ['admin', 'Admin'], ['all', 'AM + ZFM + HO + RLPO']];
      if (!roleOpts.some(([v]) => v === st.role)) st.role = roleOpts[0][0];
      R('frm').innerHTML = `<label>Mail type<select data-k="type">${TYPES.map(([k, l]) => `<option value="${k}"${st.type === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Send to<select data-k="role">${roleOpts.map(([v, l]) => `<option value="${v}"${st.role === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>ZFM<select data-k="zfm"><option value="">All</option>${zf.map((u) => `<option value="${esc(u.emp_code)}"${st.zfm === u.emp_code ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
        <label>AM<select data-k="am"><option value="">All</option>${am.map((u) => `<option value="${esc(u.emp_code)}"${st.am === u.emp_code ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
        ${st.type === 'invite' && st.role !== 'store' ? `<label>Who<select data-k="only"><option value="nopin"${st.only === 'nopin' ? ' selected' : ''}>Only: no PIN yet</option><option value="all"${st.only === 'all' ? ' selected' : ''}>Everyone</option></select></label>` : ''}
        ${st.type === 'idle' ? `<label>Not logged in for (days)<input class="f" type="number" data-k="days" value="${st.days}" min="1" max="60"></label>` : ''}`;
      R('cc').innerHTML = st.role === 'store' || st.type === 'amday' || st.type === 'amweek' ? `<span class="ckl">${st.role === 'store' ? `<label><input type="checkbox" data-k="ccAm"${st.ccAm ? ' checked' : ''}> CC the store's AM</label>` : ''}
        <label><input type="checkbox" data-k="ccZfm"${st.ccZfm || st.type === 'amweek' ? ' checked' : ''}${st.type === 'amweek' ? ' disabled' : ''}> CC ZFM</label><span class="sub" style="margin:0">· 1 mail per ${st.role === 'store' ? 'store' : 'person'} · folders of 50</span></span>`
        : '<span class="sub">1 mail per person · folders of 50 · AM / ZFM / HO / RLPO without a PIN get a new one-time setup code</span>';
      R('custom').innerHTML = st.type === 'custom' ? `<div class="frm" style="margin-top:8px"><label class="wide" style="grid-column:1/-1">Subject<input class="f" data-k="subj" value="${esc(st.subj)}" placeholder="e.g. Training on {Store} attendance"></label>
        <label style="grid-column:1/-1">Message<textarea class="f" data-k="body" rows="5" placeholder="Dear {Name}, …">${esc(st.body)}</textarea></label></div><span class="sub">Words in { } are filled for each person: {Name} {Store} {EmpCode} {Link}</span>` : '';
    }
    function paintList() {
      const q = (R('rq').value || '').trim().toLowerCase();
      const t = ticked().length, miss = recs.filter((x) => !x.to).length;
      R('rh').textContent = `Recipients · ${recs.length}${miss ? ` · ${miss} no mail` : ''}`;
      const z = root.querySelector('[data-a="zip"]'); z.textContent = `⬇ ZIP of ${t} mail${t === 1 ? '' : 's'}`; z.disabled = !t;
      R('rl').innerHTML = recs.map((x, i) => (!q || `${x.name} ${x.to} ${x.emp} ${x.store}`.toLowerCase().includes(q)) ? `<label class="${i === st.sel ? 'on' : ''}${x.to && st.off.has(x.key) ? ' off' : ''}"><input type="checkbox" data-chk="${i}"${x.to && !st.off.has(x.key) ? ' checked' : ''}${x.to ? '' : ' disabled'}>
        <span data-sel="${i}">${esc(x.name)}${x.needCode ? ' <span class="tg info">+ code</span>' : ''}</span><small>${x.to ? esc(x.to) : '<span style="color:var(--red)">no mail</span>'}</small></label>` : '').join('') || '<div class="empty">Nobody matches</div>';
      R('warn').innerHTML = miss ? `<div class="note w">${miss} ${st.role === 'store' ? 'stores have no store mail: add it in Store Master' : 'people have no mail id: add it in Users &amp; PIN / RLPO Master / Store Master (AM / ZFM mail)'}.</div>` : '';
    }
    function paintPrev() {
      const x = recs[st.sel];
      R('pvb').innerHTML = x && x.to ? '<button type="button" class="btn s sm" data-a="one">⬇ This mail (.eml)</button>' : '';
      R('pv').innerHTML = x ? `<div class="mailv"><div class="mh"><b>To</b>${x.to ? esc(x.to) : '<span style="color:#C0392B">mail missing</span>'}${x.cc ? `<br><b>Cc</b>${esc(x.cc)}` : ''}<br><b>Subject</b><strong>${esc(x.subject)}</strong></div>
        <div class="mb">${x.html(x.needCode ? '######' : '', cfg.setup_days || 7)}</div></div>${x.needCode ? '<div class="sub">###### = a new one-time setup code is made for each person when you download.</div>' : ''}` : '<div class="note">Nobody to send to for this choice.</div>';
    }
    async function refresh() {
      R('rl').innerHTML = SPIN; recs = await build(); st.off = new Set(); st.sel = Math.max(0, recs.findIndex((x) => x.to)); paintList(); paintPrev();
    }
    async function codesFor(list) {
      const need = list.filter((x) => x.needCode).map((x) => x.emp); if (!need.length) return { codes: {}, days: cfg.setup_days || 7 };
      const r = await rpc('admin_issue_codes', { p_token: me.token, p_emps: need }); if (!r || !r.ok) throw new Error(eText(r && r.error));
      const codes = {}; (r.rows || []).forEach((c) => { codes[c.emp] = c.code; }); return { codes, days: r.days || 7 };
    }
    const trackRow = (x, folder, file, codes) => ({ Batch: folder || '', File: file || '', To: x.to, Cc: x.cc, Name: x.name, Role: x.role, 'Emp / Store': x.emp || x.store, Subject: x.subject,
      'Setup code issued': x.needCode ? (codes && codes[x.emp] ? 'Yes' : codes ? 'No (PIN already set)' : 'At download') : '', Status: x.to ? (st.off.has(x.key) ? 'Left out' : 'Ready') : 'Mail missing', Sent: '' });
    async function trackerBytes(rows) {
      const X = await xlsxStyled(); const ws = X.utils.json_to_sheet(rows); const head = Object.keys(rows[0] || {});
      head.forEach((h, c) => { const ref = X.utils.encode_cell({ r: 0, c }); if (ws[ref]) ws[ref].s = { font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '334155' } } }; });
      ws['!cols'] = head.map((h) => ({ wch: Math.min(50, Math.max(h.length, ...rows.map((r) => String(r[h] ?? '').length)) + 2) }));
      const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'Mails'); return X.write(wb, { type: 'array', bookType: 'xlsx' });
    }
    root.addEventListener('change', (e) => {
      const ck = e.target.closest('[data-chk]'); if (ck) { const x = recs[+ck.dataset.chk]; if (ck.checked) st.off.delete(x.key); else st.off.add(x.key); paintList(); return; }
      const k = e.target.dataset.k; if (!k || k === 'subj' || k === 'body') return;
      st[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? Number(e.target.value) || 1 : e.target.value;
      if (k === 'zfm') st.am = '';
      paintForm(); refresh();
    });
    root.addEventListener('input', (e) => {
      if (e.target === R('rq')) return paintList();
      const k = e.target.dataset.k; if (k === 'subj' || k === 'body') { st[k] = e.target.value; clearTimeout(st.tm); st.tm = setTimeout(refresh, 400); }
    });
    root.addEventListener('click', async (e) => {
      const s = e.target.closest('[data-sel]'); if (s) { e.preventDefault(); st.sel = +s.dataset.sel; paintList(); paintPrev(); return; }
      const b = e.target.closest('[data-a]'); if (!b) return;
      const a = b.dataset.a;
      if (a === 'all') { st.off.clear(); paintList(); }
      if (a === 'none') { recs.forEach((x) => st.off.add(x.key)); paintList(); }
      if (a === 'trk') downloadXlsx(recs.map((x) => trackRow(x)), `Mail_${st.type}_${todayIST()}.xlsx`, 'Mails');
      if (a === 'one') {
        const x = recs[st.sel]; if (!x || !x.to) return; b.disabled = true;
        try { const { codes, days } = await codesFor([x]); dlBlob(new Blob([eml(x, x.html(codes[x.emp] || '', days))], { type: 'message/rfc822' }), emlName(x)); toast(x.needCode ? 'Saved · a new setup code was made' : 'Saved');
          if (x.needCode && codes[x.emp]) { const u = uBy.get(x.emp); if (u) u.has_code = true; } } catch (err) { toast(err.message); }
        b.disabled = false;
      }
      if (a === 'zip') {
        const ok = ticked(); if (!ok.length) return; b.disabled = true; b.textContent = 'Making files…';
        try {
          const [JSZip, cd] = await Promise.all([zipLib(), codesFor(ok)]); const zip = new JSZip(); const tracker = [];
          ok.forEach((x, i) => { const folder = `Batch_${String(Math.floor(i / 50) + 1).padStart(2, '0')}`; const fname = `${String(i + 1).padStart(4, '0')}_${emlName(x)}`;
            zip.file(`${folder}/${fname}`, eml(x, x.html(cd.codes[x.emp] || '', cd.days))); tracker.push(trackRow(x, folder, fname, cd.codes)); });
          try { zip.file('Mail_tracker.xlsx', await trackerBytes(tracker)); } catch (err) { zip.file('Mail_tracker.csv', [Object.keys(tracker[0]).join(','), ...tracker.map((r) => Object.values(r).map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))].join('\r\n')); }
          dlBlob(await zip.generateAsync({ type: 'blob' }), `Mails_${st.type}_${todayIST()}.zip`);
          toast(`${ok.length} .eml files saved${Object.keys(cd.codes).length ? ` · ${Object.keys(cd.codes).length} setup codes made` : ''}`);
          drop('users'); users = (await aget('users', true)).filter((u) => u.active); refresh();
        } catch (err) { toast(err.message || 'Could not make the ZIP'); }
        b.disabled = false; paintList();
      }
    });
    paintForm(); refresh();
  }

  /* ================= SETTINGS ================= */
  async function SettingsView(root) {
    root.innerHTML = SPIN;
    let s;
    try { s = await aget('settings', true); } catch (e) { root.innerHTML = `<div class="note r">${esc(e.message)}</div>`; return; }
    const sw = (k, l, d, on) => `<div class="tgl"><div><b>${l}</b><span>${d}</span></div><button type="button" class="swi${on ? ' on' : ''}" data-sw="${k}" aria-label="${esc(l)}" aria-pressed="${!!on}"></button></div>`;
    const num = (k, l, d, min, max, step = 1) => `<div class="tgl"><div><b>${l}</b><span>${d}</span></div><input class="f" type="number" data-sk="${k}" min="${min}" max="${max}" step="${step}" value="${esc(s[k] ?? '')}" aria-label="${esc(l)}"></div>`;
    const tm = (k, l, d, def) => `<div class="tgl"><div><b>${l}</b><span>${d}</span></div><input class="f" type="time" data-sk="${k}" value="${esc(String(s[k] || def).slice(0, 5))}" aria-label="${esc(l)}"></div>`;
    const et = s.edit_types || [];
    const ck = (k, l, dis) => `<label class="ck"><input type="checkbox" data-et="${k}"${et.includes(k) ? ' checked' : ''}${dis ? ' disabled' : ''}> ${l}</label>`;
    root.innerHTML = `<div class="toolrow"><div><h1 class="pt">Settings</h1><div class="sub">Every save is written to the Access Log.</div></div><button type="button" class="btn" data-a="save">Save settings</button></div>
      <div class="note w" data-r="tw"${s.test_mode ? '' : ' hidden'}>Test mode is ON: punches are accepted from anywhere. Turn it OFF before go-live.</div>
      <div class="cols2">
        <div class="card"><h2>Punch rules</h2>${sw('test_mode', 'Test mode', 'GPS not checked. Keep ON only for trial days.', s.test_mode)}${sw('live_check', 'Live face check', 'Instant camera: auto-snaps as soon as one face is in the oval.', s.live_check !== false)}
          ${num('radius_m', 'Geo-fence radius (m)', 'Punch allowed within this distance of the store', 50, 3800000)}</div>
        <div class="card"><h2>Security (SG) A / H / P rule</h2>${num('sg12_a', '12-hr set · Absent below (hrs)', 'e.g. 6 → under 6 hrs = A', 0, 24, 0.5)}${num('sg12_p', '12-hr set · Present from (hrs)', 'e.g. 12 → 6 to under 12 = H, 12+ = P', 0, 24, 0.5)}
          ${num('sg8_a', '8-hr set · Absent below (hrs)', 'e.g. 4 → under 4 hrs = A', 0, 24, 0.5)}${num('sg8_p', '8-hr set · Present from (hrs)', 'e.g. 8 → 4 to under 8 = H, 8+ = P', 0, 24, 0.5)}
          <div class="sub" style="margin-top:6px">Mis-punch (IN without OUT) counts Absent until the RLPO decides.</div></div>
        <div class="card"><h2>Alerts</h2>${tm('alert_m', 'Morning alerts start', '“Action needed” stays quiet before this, so staff can arrive', '10:00')}${tm('alert_e', 'Evening alerts start', '', '16:00')}
          ${num('low_pct', '“Below %” line', 'Stores below this % are flagged', 0, 100)}${num('low_days', '“Low for N days” alert', 'Days in a row', 1, 31)}${num('storage_alert_pct', 'Photo storage alert at (%)', '', 10, 99)}</div>
        <div class="card"><h2>Sessions &amp; login</h2>${num('store_idle_min', 'Auto logout · store logins (min)', 'No activity for this long → logged out', 1, 480)}${num('idle_other_min', 'Auto logout · AM / ZFM / HO / RLPO / Admin (min)', '', 1, 480)}
          ${num('pin_max_tries', 'Wrong PIN limit', 'Then the login is locked', 1, 10)}${num('pin_lock_min', 'Lock time (min)', '', 1, 60)}${num('setup_days', 'Setup code valid for (days)', 'One-time code in the invite mail', 1, 30)}</div>
        <div class="card"><h2>Store can ask AM to change</h2><div class="tgl"><div><b>Request types</b><span>Every request needs a reason; AM approves. Security mis-punch / edit always go to the RLPO.</span></div></div>
          <div class="ckl" style="padding:6px 0">${ck('compoff', 'Comp-off')}${ck('staff', 'Staff details (name / vendor / brand)')}${ck('missed_out', 'Missed OUT time', true)}${ck('missed_in', 'Missed IN', true)}</div><div class="sub">Missed IN / OUT: switch on later when decided.</div></div>
        <div class="card"><h2>Test data</h2><div class="tgl"><div><b>Delete all TEST stores, users and punches</b><span data-r="td">Checking…</span></div><button type="button" class="btn r sm" data-a="tddel" hidden>Delete all test data</button></div></div>
      </div>
      <div class="card"><h2>Photo storage</h2><div class="toolrow" style="margin-top:6px"><span data-r="ps">Checking…</span><b data-r="psp"></b></div><div class="meter2"><i data-r="psb" style="width:0"></i></div>
        <div class="acts" style="margin-top:10px"><input class="f" type="date" data-r="pf"> to <input class="f" type="date" data-r="pt"><button type="button" class="btn s sm" data-a="pzip">⬇ Photos ZIP</button><button type="button" class="btn r sm" data-a="pdel">Downloaded, remove from portal</button></div>
        <div class="sub" data-r="pm">Save the ZIP to your drive first, then remove. Removing cannot be undone.</div></div>`;
    const R = (k) => root.querySelector(`[data-r="${k}"]`);
    const swv = (k) => root.querySelector(`[data-sw="${k}"]`).classList.contains('on');
    R('pf').value = monthStart(todayIST()); R('pt').value = todayIST(); R('pf').max = R('pt').max = todayIST();
    async function tdCount() { const r = await rpc('admin_test_data', { p_token: me.token, p_action: 'count' });
      R('td').textContent = r && r.ok ? (r.stores || r.users ? `${r.stores} test stores, ${r.users} test users, ${nf(r.punches)} test punches. Delete them before go-live.` : 'No test data.') : eText(r && r.error);
      root.querySelector('[data-a="tddel"]').hidden = !(r && r.ok && (r.stores || r.users)); }
    async function usage() {
      const u = await photoFn({ action: 'usage', session: me.token });
      if (!u || !u.ok) { R('ps').textContent = 'Could not read storage (' + ((u && u.error) || 'error') + ')'; return; }
      const p = Math.round((u.bytes / u.limit) * 100), lim = s.storage_alert_pct || 70;
      R('ps').textContent = `${(u.bytes / 1048576).toFixed(0)} MB of ${(u.limit / 1073741824).toFixed(0)} GB used · ${nf(u.photos)} photos`;
      R('psp').textContent = p + '%'; R('psp').style.color = p >= lim ? 'var(--red)' : 'var(--ok)';
      R('psb').style.width = Math.min(p, 100) + '%'; R('psb').style.background = p >= lim ? 'var(--red)' : p >= 50 ? 'var(--amb)' : 'var(--ok)';
    }
    root.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-sw]'); if (t) { t.classList.toggle('on'); t.setAttribute('aria-pressed', t.classList.contains('on')); if (t.dataset.sw === 'test_mode') R('tw').hidden = !t.classList.contains('on'); return; }
      const b = e.target.closest('[data-a]'); if (!b) return;
      const a = b.dataset.a;
      if (a === 'save') {
        const p = { test_mode: swv('test_mode'), live_check: swv('live_check'), edit_types: [...root.querySelectorAll('[data-et]:checked')].map((c) => c.dataset.et) };
        let bad = null;
        root.querySelectorAll('[data-sk]').forEach((el) => { const k = el.dataset.sk; if (el.type === 'time') { if (el.value) p[k] = el.value; return; }
          if (el.value === '' || isNaN(+el.value) || +el.value < +el.min || +el.value > +el.max) bad = bad || `${el.getAttribute('aria-label')}: enter ${el.min}–${el.max}`; else p[k] = +el.value; });
        if (!bad && (p.sg12_a > p.sg12_p || p.sg8_a > p.sg8_p)) bad = 'SG hours: “Absent below” must not be more than “Present from”.';
        if (bad) return toast(bad, 4000);
        b.disabled = true; const r = await rpc('admin_settings_set', { p_token: me.token, p }); b.disabled = false;
        if (r && r.ok) { toast('Settings saved'); drop('settings'); s = await aget('settings', true); } else toast(eText(r && r.error), 4000);
      }
      if (a === 'tddel') { if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Tap again: delete ALL test data'; return; }
        b.disabled = true; const r = await rpc('admin_test_data', { p_token: me.token, p_action: 'delete' }); b.disabled = false; b.dataset.confirm = ''; b.textContent = 'Delete all test data';
        toast(r && r.ok ? `${r.stores} test stores deleted` : eText(r && r.error)); Object.keys(cache).forEach((k) => drop(k)); tdCount(); }
      if (a === 'pzip') {
        R('pm').textContent = 'Preparing list…';
        const l = await photoFn({ action: 'list', session: me.token, from: R('pf').value, to: R('pt').value });
        if (!l || !l.ok) { R('pm').textContent = 'Error: ' + ((l && l.error) || ''); return; }
        if (!l.files.length) { R('pm').textContent = 'No photos in these dates.'; return; }
        b.disabled = true; let JSZip; try { JSZip = await zipLib(); } catch (err) { R('pm').textContent = 'Could not load the ZIP tool.'; b.disabled = false; return; }
        const zip = new JSZip(); let done = 0;
        for (const f of l.files) { try { zip.file(f.path.split('/').slice(1).join('/'), await (await fetch(f.url)).blob()); } catch (err) { /* skip one */ } done++; if (done % 25 === 0) R('pm').textContent = `Downloading ${done} / ${l.files.length}…`; }
        R('pm').textContent = 'Making ZIP…'; dlBlob(await zip.generateAsync({ type: 'blob' }), `Selfies_${R('pf').value}_${R('pt').value}.zip`);
        R('pm').textContent = `${l.files.length} photos saved in the ZIP. Keep it on your drive, then remove from portal.`; b.disabled = false;
      }
      if (a === 'pdel') { if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = `Tap again: remove photos ${R('pf').value} to ${R('pt').value}`; return; }
        b.disabled = true; R('pm').textContent = 'Removing…';
        const r = await photoFn({ action: 'delete', session: me.token, from: R('pf').value, to: R('pt').value });
        b.disabled = false; b.dataset.confirm = ''; b.textContent = 'Downloaded, remove from portal';
        R('pm').textContent = r && r.ok ? `${r.deleted} photos removed.` : 'Error: ' + ((r && r.error) || ''); usage(); }
    });
    tdCount(); usage();
  }

  /* ================= ACCESS & CONSENT LOG (search + date) ================= */
  function LogsView(root) {
    const st = { tab: 'acc', role: 'store', date: todayIST(), q: '', from: monthStart(todayIST()), to: todayIST(), kind: '', page: 1, size: defSize() };
    let acc = null, con = null;
    const EV = { login: ['info', 'Login'], logout: ['grey', 'Logout'], auto_logout: ['amb', 'Auto logout'], pin_lock: ['red', 'PIN lock'], pin_set: ['ok', 'PIN created'], pin_reset: ['amb', 'PIN reset'],
      store_busy: ['amb', 'Blocked: store open'], settings: ['info', 'Settings'], view_as: ['info', 'Viewed by admin'], approval: ['ok', 'Approval'], sg_approve: ['ok', 'SG decision'], master_edit: ['info', 'Master edit'], register: ['info', 'Registered'], geo_block: ['red', 'Geo block'] };
    const KN = { associate: 'Associate · own phone', mod_associate: 'Associate · via MOD', user: 'User login' };
    root.innerHTML = `<div class="toolrow"><div><h1 class="pt">Access &amp; Consent log</h1><div class="sub">Who logged in, PIN resets, auto logouts · camera / location consent with policy version (current ${esc(CONFIG.policy)}).</div></div><a class="btn ghost" href="privacy.html" target="_blank" rel="noopener" style="text-decoration:none">Privacy policy</a></div>
      <div class="card"><div class="tabs"><button type="button" data-tab="acc">Access log</button><button type="button" data-tab="con">Consent log</button></div><div data-r="body"></div></div>`;
    const R = (k) => root.querySelector(`[data-r="${k}"]`);
    const accRows = () => { if (!acc || !acc.ok) return []; const q = st.q.toLowerCase();
      return acc.users.filter((u) => !q || `${u.name} ${u.emp_code} ${u.store_code || ''} ${u.post || ''} ${u.dept || ''} ${u.last_event ? u.last_event.event + ' ' + ((EV[u.last_event.event] || [])[1] || '') : ''}`.toLowerCase().includes(q)); };
    const conRows = () => { if (!con || !con.ok) return []; const q = st.q.toLowerCase();
      return con.rows.filter((r) => !q || `${r.store || ''} ${r.associate || ''} ${r.user_name || ''} ${r.emp || ''} ${r.mod_name || ''} ${r.device || ''} ${r.version || ''}`.toLowerCase().includes(q)); };
    function shell() {
      root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === st.tab));
      R('body').innerHTML = st.tab === 'acc'
        ? `<div class="toolrow" style="margin-top:6px"><span class="lgflt"><input class="f" type="search" data-r="q" value="${esc(st.q)}" placeholder="Search name / code / store / event" style="width:260px"><input class="f" type="date" data-r="date" value="${st.date}" max="${todayIST()}" aria-label="Date"><button type="button" class="btn ghost sm" data-a="clr">Clear</button></span><button type="button" class="btn sm" data-a="xls">⬇ Excel</button></div>
          <div class="seg" data-r="roles" style="margin-top:8px"></div><div class="kpis k5x" data-r="kpi" style="margin-top:8px"></div><div class="cols" style="margin-top:8px"><div data-r="tbl"></div><div data-r="rs"></div></div>`
        : `<div class="toolrow" style="margin-top:6px"><span class="lgflt"><input class="f" type="search" data-r="q" value="${esc(st.q)}" placeholder="Search store / person / device" style="width:240px"><input class="f" type="date" data-r="from" value="${st.from}" max="${todayIST()}" aria-label="From"> to <input class="f" type="date" data-r="to" value="${st.to}" max="${todayIST()}" aria-label="To">
          <select data-r="kind" aria-label="Type"><option value="">All types</option>${Object.entries(KN).map(([k, l]) => `<option value="${k}"${st.kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select><button type="button" class="btn ghost sm" data-a="clr">Clear</button></span><button type="button" class="btn sm" data-a="xls">⬇ Excel</button></div>
          <div class="kpis k3x" data-r="kpi" style="margin-top:8px"></div><div data-r="tbl"></div>`;
      load();
    }
    async function load() {
      R('tbl').innerHTML = SPIN;
      if (st.tab === 'acc') { acc = await rpc('access_view', { p_token: me.token, p_role: st.role, p_date: st.date }); if (st.tab === 'acc') paintAcc(); }
      else { con = await rpc('consent_view', { p_token: me.token, p_from: st.from, p_to: st.to, p_kind: st.kind || null }); if (st.tab === 'con') paintCon(); }
    }
    function paintAcc() {
      if (!R('roles')) return;
      if (!acc || !acc.ok) { R('tbl').innerHTML = `<div class="note r">${esc(eText(acc && acc.error))}</div>`; return; }
      const c = acc.counts || {}, k = acc.kpi || {};
      R('roles').innerHTML = Object.keys(RN).map((r) => `<button type="button" data-role="${r}" class="${r === st.role ? 'on' : ''}">${RN[r]} (${c[r] || 0})</button>`).join('');
      R('kpi').innerHTML = kpiBox('Logged in on this day', nf(k.today), `${pct(k.today, k.total)}% of ${nf(k.total)}`, 'var(--ok)') + kpiBox('Logged in till date', nf(k.ever), `${pct(k.ever, k.total)}%`)
        + kpiBox('Never logged in', nf((k.total || 0) - (k.ever || 0)), '', 'var(--red)') + kpiBox('Auto logouts', nf(k.auto_logout)) + kpiBox('PIN resets', nf(k.pin_resets));
      const L = accRows();
      R('tbl').innerHTML = `<div class="tw"><table><thead><tr><th class="l">${st.role === 'store' ? 'Store' : 'Login ID'}</th><th class="l">User</th><th class="l">Last login</th><th class="l">Event on this day</th></tr></thead><tbody>
        ${pageSlice(L, st).map((u) => { const e = u.last_event ? EV[u.last_event.event] || ['info', u.last_event.event] : null;
          return `<tr><td class="l">${esc(st.role === 'store' ? u.store_code : u.emp_code)}</td><td class="l"><b>${esc(u.name)}</b>${u.post ? ' · ' + esc(u.post) : ''}${u.dept ? ' · ' + esc(u.dept) : ''}${st.role === 'store' ? `<small>${esc(u.emp_code)}</small>` : ''}</td>
          <td class="l">${esc(u.last_login || '—')}</td><td class="l">${u.active_now ? '<span class="tg ok">Active now</span> ' : ''}${e ? `<span class="tg ${e[0]}">${esc(e[1])} ${esc(u.last_event.at)}</span>` : u.ever ? '<span class="tg grey">Not on this day</span>' : '<span class="tg red">Never logged in</span>'}</td></tr>`; }).join('')
          || '<tr><td class="l" colspan="4" style="color:var(--mut)">No match</td></tr>'}</tbody></table></div>${pagerHtml(L.length, st)}`;
      R('rs').innerHTML = `<div class="tw"><table><thead><tr><th class="l">PIN reset</th><th class="l">Reset by</th><th class="l">Time</th></tr></thead><tbody>
        ${(acc.resets || []).map((x) => `<tr><td class="l">${esc(x.name || x.emp)}${x.store ? ' · ' + esc(x.store) : ''}</td><td class="l">${esc(x.by_name || x.by || '—')}</td><td class="l">${esc(x.at)}</td></tr>`).join('') || '<tr><td class="l" colspan="3" style="color:var(--mut)">No PIN resets on this day</td></tr>'}</tbody></table></div>`;
    }
    function paintCon() {
      if (!R('kind')) return;
      if (!con || !con.ok) { R('tbl').innerHTML = `<div class="note r">${esc(eText(con && con.error))}</div>`; return; }
      const c = con.counts || {};
      R('kpi').innerHTML = kpiBox('Associates · own phone', nf(c.associate)) + kpiBox('Associates · via MOD', nf(c.mod_associate)) + kpiBox('User logins', nf(c.user));
      const L = conRows();
      R('tbl').innerHTML = `<div class="tw"><table><thead><tr><th class="l">Date &amp; time</th><th class="l">Type</th><th class="l">Store</th><th class="l">Person</th><th class="l">Confirmed by</th><th class="l">Policy</th><th class="l">Language</th><th class="l">Device</th></tr></thead><tbody>
        ${pageSlice(L, st).map((r) => `<tr><td class="l">${esc(r.at)}</td><td class="l">${esc(KN[r.kind] || r.kind)}</td><td class="l">${esc(r.store || '—')}</td><td class="l">${esc(r.associate || r.user_name || r.emp || '—')}${r.associate && r.emp ? `<small>${esc(r.emp)}</small>` : ''}</td>
          <td class="l">${r.mod_emp ? esc((r.mod_name || '') + ' · ' + r.mod_emp) : 'Self'}</td><td class="l">${esc(r.version)}</td><td class="l">${esc(r.lang || '—')}</td><td class="l" title="${esc(r.ua || '')}">${esc((r.device || '').slice(0, 14))}</td></tr>`).join('')
          || '<tr><td class="l" colspan="8" style="color:var(--mut)">No consent records match</td></tr>'}</tbody></table></div>${pagerHtml(L.length, st)}`;
    }
    const repaint = () => (st.tab === 'acc' ? paintAcc() : paintCon());
    root.addEventListener('click', (e) => {
      if (pagerEvent(e, st, (st.tab === 'acc' ? accRows() : conRows()).length)) return repaint();
      const t = e.target.closest('[data-tab]'); if (t) { st.tab = t.dataset.tab; st.q = ''; st.page = 1; return shell(); }
      const r = e.target.closest('[data-role]'); if (r) { st.role = r.dataset.role; st.page = 1; return load(); }
      const b = e.target.closest('[data-a]'); if (!b) return;
      if (b.dataset.a === 'clr') { st.q = ''; st.page = 1; if (st.tab === 'acc') st.date = todayIST(); else { st.from = monthStart(todayIST()); st.to = todayIST(); st.kind = ''; } return shell(); }
      if (b.dataset.a === 'xls') {
        if (st.tab === 'acc') downloadXlsx(accRows().map((u) => ({ Role: RN[st.role], 'Login ID': u.emp_code, Name: u.name, Post: u.post || '', Store: u.store_code || '', Dept: u.dept || '', 'Last login': u.last_login || '', 'Ever logged in': u.ever ? 'Yes' : 'No',
          'Active now': u.active_now ? 'Yes' : '', 'Event on day': u.last_event ? `${(EV[u.last_event.event] || [])[1] || u.last_event.event} ${u.last_event.at}` : '' })), `Access_${st.role}_${st.date}.xlsx`, 'Access');
        else downloadXlsx(conRows().map((r) => ({ 'Date & time': r.at, Type: KN[r.kind] || r.kind, Store: r.store || '', Person: r.associate || r.user_name || r.emp || '', Code: r.emp || '',
          'Confirmed by': r.mod_emp ? `${r.mod_name || ''} ${r.mod_emp}` : 'Self', Policy: r.version, Language: r.lang || '', Device: r.device || '', Browser: r.ua || '' })), `Consent_${st.from}_${st.to}.xlsx`, 'Consent');
      }
    });
    root.addEventListener('input', (e) => { if (e.target.matches('[data-r="q"]')) { st.q = e.target.value.trim(); st.page = 1; clearTimeout(st.tq); st.tq = setTimeout(repaint, 150); } });
    root.addEventListener('change', (e) => {
      if (pagerEvent(e, st, (st.tab === 'acc' ? accRows() : conRows()).length)) return repaint();
      const k = e.target.dataset.r;
      if (k === 'date') { st.date = e.target.value || todayIST(); st.page = 1; load(); }
      if (k === 'from' || k === 'to') { st[k] = e.target.value || todayIST(); if (st.from > st.to) { toast('From must be before To'); return; } st.page = 1; load(); }
      if (k === 'kind') { st.kind = e.target.value; st.page = 1; load(); }
    });
    shell();
  }

  /* ================= VIEW AS USER (read-only) ================= */
  function ViewAsView(root) {
    const st = { q: '', role: '', page: 1, size: defSize() }; let rows = [];
    root.innerHTML = `<div class="toolrow"><div><h1 class="pt">View as user</h1><div class="sub">Opens the portal in a new tab exactly as this person sees it. Read-only: nothing can be punched, reset or changed. Every view is saved in the Access Log.</div></div>
      <span class="acts"><select data-r="role" aria-label="Role"><option value="">All roles</option>${['store', 'am', 'zfm', 'hodept', 'rlpo'].map((r) => `<option value="${r}">${RN[r]}</option>`).join('')}</select><input class="f" type="search" data-r="q" placeholder="Search name / code / store" style="width:220px"></span></div>
      <div class="card"><div class="tw" data-r="tbl">${SPIN}</div></div>`;
    const R = (k) => root.querySelector(`[data-r="${k}"]`);
    const list = () => { const q = st.q.toLowerCase(); return rows.filter((u) => u.role !== 'admin' && u.active !== false && (!st.role || u.role === st.role) && (!q || `${u.name} ${u.emp_code} ${u.store_code || ''} ${u.dept || ''} ${u.email || ''}`.toLowerCase().includes(q))); };
    function paint() {
      const f = list();
      R('tbl').innerHTML = `<table><thead><tr><th class="l">Login ID</th><th class="l">Name</th><th class="l">Role</th><th class="l">Post / Dept</th><th class="l">Store</th><th class="l">Last login</th><th class="l"></th></tr></thead><tbody>
        ${pageSlice(f, st).map((u) => `<tr><td class="l">${esc(u.emp_code)}</td><td class="l"><b>${esc(u.name)}</b></td><td class="l"><span class="tg info">${RN[u.role] || u.role}</span></td><td class="l">${esc(u.post || u.dept || '—')}</td><td class="l">${esc(u.store_code || '—')}</td><td class="l">${esc(u.last_login || '—')}</td>
          <td class="l"><button type="button" class="btn s sm" data-va="${esc(u.emp_code)}">👁 View as</button></td></tr>`).join('') || '<tr><td class="l" colspan="7" style="color:var(--mut)">No users</td></tr>'}</tbody></table>${pagerHtml(f.length, st)}`;
    }
    root.addEventListener('input', (e) => { if (e.target === R('q')) { st.q = e.target.value.trim(); st.page = 1; paint(); } });
    root.addEventListener('change', (e) => { if (pagerEvent(e, st, list().length)) return paint(); if (e.target === R('role')) { st.role = e.target.value; st.page = 1; paint(); } });
    root.addEventListener('click', async (e) => {
      if (pagerEvent(e, st, list().length)) return paint();
      const b = e.target.closest('[data-va]'); if (!b) return;
      const w = window.open('about:blank', '_blank');
      b.disabled = true; const r = await rpc('admin_view_as', { p_token: me.token, p_emp: b.dataset.va }); b.disabled = false;
      if (!r || !r.ok) { if (w) w.close(); return toast(eText(r && r.error)); }
      store.set('vmm3p_view_handoff', { ...r, at: Date.now() });
      const url = homeFor(r.role) + '?view=1';
      if (w) w.location.href = url; else location.href = url;
    });
    aget('users', true).then((u) => { rows = u; paint(); }).catch((e) => { R('tbl').innerHTML = `<div class="note r">${esc(e.message)}</div>`; });
  }

  /* ================= REPORTS & PUNCH EXPORT ================= */
  function ReportsView(root) {
    root.innerHTML = `<div class="toolrow"><div><h1 class="pt">Reports &amp; export</h1><div class="sub">Monthly statements (A4) and raw punch export.</div></div></div>
      <div class="cols2"><div class="card"><h2>Monthly statement (A4)</h2><div class="sub" style="margin:6px 0 10px">Pick store, associate and month. Print, save as PDF or download Excel. Cells show P / A (Security also H).</div><a class="btn" href="statement.html" style="text-decoration:none;display:inline-block">Open statement</a></div>
      <div class="card"><h2>Raw punches (Excel)</h2><div class="sub" style="margin:6px 0 10px">Every IN / OUT with time, shift, device and photo status. Up to 62 days at a time.</div>
        <div class="acts"><input class="f" type="date" data-r="f" aria-label="From"> to <input class="f" type="date" data-r="t" aria-label="To"><button type="button" class="btn" data-a="go">⬇ Download Excel</button></div><div data-r="m" style="margin-top:8px"></div></div></div>`;
    const R = (k) => root.querySelector(`[data-r="${k}"]`);
    R('f').value = monthStart(todayIST()); R('t').value = todayIST(); R('f').max = R('t').max = todayIST();
    root.querySelector('[data-a="go"]').addEventListener('click', async (e) => {
      const f = R('f').value, t = R('t').value; if (!f || !t || f > t) return toast('Pick a valid date range');
      if ((parseYmd(t) - parseYmd(f)) / 86400000 > 62) return toast('Up to 62 days at a time');
      e.currentTarget.disabled = true; R('m').innerHTML = SPIN;
      const r = await rpc('admin_punch_export', { p_token: me.token, p_from: f, p_to: t });
      root.querySelector('[data-a="go"]').disabled = false;
      if (!r || !r.ok) { R('m').innerHTML = `<div class="note r">${esc(eText(r && r.error))}</div>`; return; }
      if (!(r.rows || []).length) { R('m').innerHTML = '<div class="note">No punches in these dates.</div>'; return; }
      await downloadXlsx(r.rows, `Punches_${f}_${t}.xlsx`, 'Punches');
      R('m').innerHTML = `<div class="note k">${nf(r.rows.length)} punches downloaded.</div>`;
    });
  }

  /* ================= boot: shell + navigation ================= */
  const callDash = (fn, ...a) => (root) => { if (typeof window[fn] === 'function') return window[fn](root, me, ...a); root.innerHTML = `<div class="note r">${fn} is not available (assets/dash.js did not load).</div>`; };
  const PAGES = {
    live: ['Live Dashboard', callDash('LiveDash')], apv: ['Approvals (view only)', callDash('ApprovalsView')], team: ['Store team', callDash('StoreTeamView')],
    churn: ['Staff churn', callDash('ChurnView')], reports: ['Reports & export', ReportsView],
    stores: ['Store Master', StoreMaster], manpower: ['Manpower Master', ManpowerMaster], rlpo: ['RLPO Master', RlpoMaster], users: ['Users & PIN', UsersView],
    depts: ['HO Dept Master', DeptView], mail: ['Mail Center', MailView], settings: ['Settings', SettingsView], logs: ['Access & Consent log', LogsView], viewas: ['View as user', ViewAsView],
  };
  const NAV = [['live', 'Live Dashboard', 'ld'], ['apv', 'Approvals (view)', 'ap'], ['team', 'Store team', 'tm'], ['churn', 'Staff churn', 'ch'], ['reports', 'Reports & export', 'stm']];
  const ADM = [['stores', 'Store Master', 'st'], ['manpower', 'Manpower Master', 'mp'], ['rlpo', 'RLPO Master', 'rl'], ['users', 'Users & PIN', 'us'], ['depts', 'HO Dept Master', 'ho'],
    ['mail', 'Mail Center', 'ml'], ['settings', 'Settings', 'set'], ['logs', 'Access & Consent log', 'lg'], ['viewas', 'View as user', 'user']];

  function go(id) {
    if (!PAGES[id]) id = 'live';
    if (curPage && id !== curPage && dirty && dirty() && !window.confirm('You have unsaved changes on this page. Leave without saving?')) { SH.setActive(curPage); return; }
    dirty = null; curPage = id;
    SH.setActive(id); SH.setTitle(PAGES[id][0]);
    [...SH.bar.children].forEach((c, i) => { if (i > 0) c.remove(); });   // keep the crumb, drop page filters of the previous page
    try { history.replaceState(null, '', '#' + id); } catch (e) { /* file:// */ }
    const old = SH.wrap.firstElementChild;   // stop dash.js timers / bar items of the page we leave
    if (old) { try { if (old._dashOff) old._dashOff(); } catch (e) { /* ignore */ } old.innerHTML = ''; }
    const root = document.createElement('div'); root.className = 'pgroot pg-in';
    SH.wrap.replaceChildren(root); window.scrollTo(0, 0);
    try { const p = PAGES[id][1](root); if (p && p.catch) p.catch((e) => { root.innerHTML = `<div class="note r">Could not open this page: ${esc(e.message || e)}</div>`; }); }
    catch (e) { root.innerHTML = `<div class="note r">Could not open this page: ${esc(e.message || e)}</div>`; }
  }

  (async function boot() {
    me = await requireSession(['admin']); if (!me) return;
    Idle.start({ minutes: me.idle_min || 60 });
    let start = (location.hash || '').slice(1); if (!PAGES[start]) start = 'live';
    SH = appShell('#root', { me, nav: NAV, adminNav: ADM, active: start, title: PAGES[start][0], scope: 'All India', onNav: go });
    window.addEventListener('beforeunload', (e) => { if (dirty && dirty()) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('hashchange', () => { const h = (location.hash || '').slice(1); if (PAGES[h] && h !== curPage) go(h); });
    go(start);
  })();
})();
