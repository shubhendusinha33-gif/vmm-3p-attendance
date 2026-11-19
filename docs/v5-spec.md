# 3PA v5 build spec (single source of truth for all v5 work)

Visual + behaviour spec: `docs/preview_v6.html` (open in a browser; top strip "See as" switches roles). Its source is split in `docs/preview_src/part*.js` (sample data only — the real portal calls Supabase RPCs). **Match its look and flows.** Where the preview and this file differ, this file wins.

Stack stays: plain HTML + `assets/app.js` (rpc, Session, i18n EN/हिं, consent, helpers) + `assets/dash.js` + `assets/app.css`, Supabase project `phyllziizajuphenpwxz` (RPC-only, RLS locked). GitHub Pages serves `main`; all v5 work is on branch `v5`. No build step. Keep CSP meta tags valid (add `https://cdn.jsdelivr.net` only where already allowed).

## 1. Look & shell
- Theme tokens (CSS vars) exactly as preview `part1.html`: default **Slate & Orange** (`--pri #334155`, `--acc #EA580C`, `--side #1E293B` …) + 8 alternates (`data-pal` p1,p2,p4–p8,cur) + dark (`data-theme=dark`). Status colours fixed: ok #1E8E3E, amb #B26A00, red #C0392B.
- Theme picker (🎨 select) + Dark toggle in the sidebar user block; saved in `localStorage` keys `3pa_theme`, `3pa_dark` (try/catch). Applied on every page at load (app.js).
- Desktop shell (admin.html, manage.html): left sidebar 216px (brand "3rd Party Attendance · Control Tower", nav with SVG icons, active = accent, Admin group), sticky top bar (crumb + page filters), `.wrap` content. Mobile ≤760px: sidebar becomes top icon row.
- **Store login (store.html, statement/qr when role=store) = phone app** on every screen size: max-width 480 centered, dark header (store code · name, user, ☰ menu with theme/dark/Change PIN/Logout), bottom tab bar: Today · Punch (for staff) · HK split · Requests · Statement · QR. Amber dot on HK split when not set.
- Idle auto-logout: Settings `idle_store_min` (store logins) / `idle_other_min` (others). Warning modal "Still there?" with 60 s countdown → `auth_logout` + "Logged out" screen. Activity = mouse/key/touch/scroll.
- Excel everywhere = real .xlsx via `xlsx-js-style@1.2.0` (jsdelivr, lazy-loaded): Calibri 10, thin borders all cells, bold white header on `#334155`, auto-fit widths, autofilter. One helper in app.js: `downloadXlsx(rows, filename, sheet)` (replace the old one, same signature).
- PIN inputs everywhere: 4 boxes, digit-only, auto-advance, Backspace on empty goes back, paste fills, Enter submits (`pinBoxes()` in app.js).

## 2. Login (index.html)
- Hero exactly like preview (Store Live motion: moving grid, floating blobs, 3 auto slides every 4.5 s with dots, LIVE pulse) with **3rd-party staff illustrations** (guards + 12-hr clock + P/H/A; housekeeping morning/evening crew; promoter + phone selfie QR). Stats tiles from `login_options()` → `stats` {guards, housekeeping, promoters, vendors, stores}. Headline "Every guard, cleaner and promoter. On duty, on time."
- Card: role chips Store · AM · ZFM · HO Dept · RLPO · Admin. ID rules:
  - Store: Emp Code (5+ digits) + Post + Store Code (unchanged self-registration flow).
  - HO Dept: mail id + Department. RLPO: mail id.
  - AM / ZFM / Admin: Emp Code **or** mail id.
- Captcha (5 chars, SVG, ↻ refresh, client-side) before Next. "Remember me" (stores role + id in localStorage). "Forgot PIN?" note. "First time here? Set your PIN" → setup-code screen. PIN step with pinBoxes. On sign-in the card fades out (`.out`) then redirect.
- Keep existing consent gate / geo for store logins, desktop/mobile switch not needed anymore (layout is automatic).

## 3. Staff phone punch (punch.html?s=XX00)
- First time on a phone: 1) department chips → 2) **vendor list for that store + dept** (from `punch_context.vendors`) — must pick one (brand shown for promoters); if none, show "No vendor is set up…" → 3) full name → Punch IN / OUT.
- Remembered phone (existing `punch_lookup` / same-phone memory): opens straight on the person card + IN/OUT, link "Not you, or vendor changed?".
- **Instant camera like DDR**: no blink/turn challenge. Open front camera, face-api tiny detector; as soon as one face is inside the oval → auto-capture (~0.7 s), compress to ~8 KB (existing compressor), upload. If models slow (>3 s) show manual shutter. Live result sent as `punch_live(token,'pass'|'noface')`. Keep geo-fence, consent, photo rule.

## 4. Live Dashboard (assets/dash.js, used by manage.html + admin.html)
Layout top→bottom as preview: dept pills + shift seg (Morning/Evening/Both) + compact time seg (Live, 8 AM, 10 AM, 12 PM, 2 PM, 6 PM; future times disabled today) · 6 KPI cards (Required; Present with % tag and "▲/▼ pts vs yesterday at same time"; Not punched; Stores at 100%; **Stores below X%** filter card; **HK/Security nobody** filter card) · thin **Action needed** chip strip (HK nobody, Security nobody, SG mis-punch, HK split not set, Low N days, Selfie due) · Last 7 days bar chart (SVG, today accent, weekend light, avg line, click bar = open that day) + Dept-wise ladder (dashed required box, coloured present bar, "N stores with 0"; Security block P / P* / H / A / MP counts) · "Where the gaps are" table (View by ZFM/AM/Store/Dept, breadcrumb, chips, Required/Present/Gap/%/status/7-day boxes, no WhatsApp) · store detail (people; **Security rows show status only, no IN/OUT/hours**). Excel = styled xlsx. HO Dept & RLPO are locked to their categories (RLPO = Security, mapped stores only). AM default view Store and sees **all** his stores.

## 5. Security (SG) rules
- Store has `sg_set` 8 or 12 (Store Master / Manpower SEC tab). Settings: `sg12_a`=6, `sg12_p`=12, `sg8_a`=4, `sg8_p`=8.
- Day status per guard: hours = last OUT − first IN. <A → A, <P → H, else P. IN without OUT on a finished day = **MP** (counts Absent until RLPO decides). RLPO decision or manual exception overrides: P, H, A, P* (manual present with reason).
- Present count for SEC on past days = P + H + P*. Today live = currently punched IN (unchanged).
- Mis-punch / time edit requests from store → **RLPO** of that store (`stores.rlpo_emp`). RLPO approves as P / H or rejects (A), optional remark. RLPO "Manual present" page marks P* with mandatory reason.
- SG never shows punch timings in store detail, store Today, or statement.

## 6. Housekeeping
- Admin Manpower HK tab uploads **total** only (`hk_total`). Store "HK split" page enters Morning + Evening (must equal total, effective date). Until set → HK required = total in Morning, store listed in "HK split not set". If Admin changes the total, split resets (needs re-entry).

## 7. Approvals
- Store → AM: comp-off, staff detail change (existing `change_requests`). AM approves/rejects with optional remark. SG kinds (`sg_mispunch`, `sg_edit`) → RLPO.
- Every decision stored (decided_by, decided_at, note) — `cr_history(token, from, to, kind_group)` returns back-dated history (Pending + History tabs for AM, RLPO, Admin). Admin = **view only** (no decide buttons). Each decision also written to access_log (`approval` / `sg_approve`).

## 8. Admin pages (admin.html)
- **Store Master**: 6 KPI filter cards in one line (Total, Active, GPS missing, Mail missing, RLPO missing, HK split not set) · "+ Add store" inline form · table with inline edit (Name, AM, ZFM, RLPO, Store mail, SG set, HK total, Active Y/N), changed cells highlighted, sticky "N changes · Discard · Save changes", result line Updated/Added/Errors · Template / Upload (add + update) / Export xlsx · "✎ More" modal for GPS etc.
- **Manpower Master**: tabs per dept with own format/template: HK (Store, Vendor, HK total, split by store shown read-only, Effective), SEC (Store, Vendor, Morning, Evening, Shift set, Effective), Travel/CDIT (Store, Brand, Vendor, Morning, Evening, Effective). Effective-date history kept.
- **RLPO Master** (separate): tab RLPO list (Name, Mail id = login, Phone, Region, Stores, PIN, Active; Add/Edit/Reset PIN) + tab Store mapping (per-store select saves at once); separate templates/uploads.
- Users & PIN (AM/ZFM/HO; Edit/Add/Reset PIN), **HO Dept Master with Edit**, Mail Center with **full mail preview** pane + recipient list (tick/untick) + .eml download + ZIP + tracker, Settings (all working incl. SG hours, alerts, low % / days, idle minutes, test data, photos), Access & Consent log with **search + date**, Approvals (view only, history).

## 9. Statement
Same A4 layout as today; cells show **P / A** (Security also H; Comp-Off) — no times. Summary Working days / Present / (Half day for SEC) / Absent / Comp-Off. Excel = Date, Store, Name, Dept, Vendor, Status.

## 10. Backend contract (migration `backend/sql/012_v5.sql`, must stay backward compatible with the v4 frontend on `main`)
New/changed (all `security definer`, granted to `anon` like the rest):
- `stores` + `rlpo_emp text`, `sg_set int default 8 check (sg_set in (8,12))`.
- `users.role` adds `'rlpo'` (emp_code = lower(mail), like hodept); `users` + `phone text`, `region text`.
- `manpower` + `hk_total int` (HK rows). New `hk_split(store_code, effective_from, morning, evening, set_by, created_at)`.
- New `sg_exceptions(associate_id, work_date, status in ('P','H','A','P*'), reason, by_emp, at, cr_id)` unique (associate_id, work_date).
- `settings` + `sg12_a, sg12_p, sg8_a, sg8_p numeric`, `idle_other_min int default 60`, `low_pct int default 70`, `low_days int default 3` (`store_idle_min` = store idle).
- `_match_user`: am/zfm/admin match `emp_code = p_emp OR lower(email) = lower(p_emp)`; rlpo like hodept (lower mail). `auth_check`/`auth_login`/`auth_set_pin` accept mail for am/zfm/admin/hodept/rlpo.
- `login_options()` adds `stats`.
- `punch_context(p_store)` adds `vendors: [{cat, vendor, brand}]` from current manpower of that store.
- `_req(date)` uses hk_split for HK (else total → Morning).
- `dash_overview` adds per-store `rlpo`, `sg_set`, `hk_split_set`; for past dates SEC present uses SG status; adds `sg_counts {P,H,A,MP,Pstar}` and `mispunch [{s, n, names}]`; respects rlpo scope (`_scope_stores` for role rlpo = mapped stores, `_scope_cats` = SEC).
- `dash_store` SEC people get `st` (P/H/A/MP/P*) and no in/out/hours.
- `statement` days get `st` (P/A/H/CO/'' future).
- `cr_create` kinds `sg_mispunch`, `sg_edit` (routed to RLPO). `cr_decide(token,id,approve,note,p_status default null)` — RLPO passes P/H/A for SG (writes sg_exceptions); AM decides only his stores' non-SG kinds; admin/ho cannot decide. `cr_history(p_token, p_from date, p_to date, p_group text default 'all')`.
- `rlpo_manual(p_token, p_associate bigint, p_date date, p_reason text)` → P*.
- `hk_split_get(p_token)` / `hk_split_set(p_token, p_morning int, p_evening int, p_effective date)` (store role).
- Admin: `admin_get` kinds add `rlpos`; `admin_rlpo_upsert(p_token, p_rows jsonb)`; `admin_rlpo_map(p_token, p_rows jsonb)` rows {store, rlpo_mail}; `admin_stores_upsert` accepts rlpo_mail, sg_set, hk_total; `admin_manpower_upload` accepts `hk_total` for HK and `sg_set` for SEC; `admin_settings_set` accepts the new settings.
