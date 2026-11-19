# v5 front-end build brief (for all page agents)

Repo: /home/claude/vmm-3p-attendance, branch `v5`. Read FIRST: `docs/v5-spec.md` (rules, wins over preview), `docs/preview_v6.html` + `docs/preview_src/part*.js` (look & flows, sample data only), `assets/app.js` header comment (shared helpers: Theme, pinBoxes/pinVal/pinClear/pinBad, downloadXlsx, readXlsx, modal/closeModal, Idle, appShell, mobileShell, changePinModal, roleLabel, icon/ICONS, rpc, Session, requireSession, t()/i18n, consentGate, permissionsReady, startCamera, compressDrawable, getPosition), `assets/app.css`, `docs/shell-demo.html` (working shell example).

Backend is LIVE (Supabase phyllziizajuphenpwxz). Contract = `backend/sql/012_v5.sql` (v5 functions: exact args + JSON shapes) + older functions as currently called by the existing pages (read the current page you are replacing to learn RPC names/args: punch_submit, punch_lookup, store_team, store_roster, store_range, associates_list, admin_users_upsert, admin_issue_codes, admin_dept_save, admin_test_data, admin_punch_export, access_view, consent_view, zone_users, store_vacate, reset_pin, admin_view_as, dash_trend, churn…; grep `backend/sql/*.sql` for their definitions).
IMPORTANT deviations: `cr_decide` must ALWAYS be called with 5 args: {p_token,p_id,p_approve,p_note,p_status} (p_status null for non-SG). `login_options().stats` exists. `auth_me` returns idle_min, stores_n.

Rules:
- Only edit the files you own (listed in your task). Do NOT edit assets/app.js or assets/app.css (other agents depend on them). Page-specific CSS → a <style> in the page or a new file assets/<name>.css; page JS inline or assets/<name>.js. If app.js has a bug that blocks you, work around it locally and report it.
- Keep CSP meta tags valid (copy from the current page; add https://cdn.jsdelivr.net to script-src only if needed for xlsx-js-style/face-api as already allowed elsewhere).
- No WhatsApp anywhere. Excel = downloadXlsx (real .xlsx). Security (SEC) never shows punch times/hours to anyone (store detail, store Today, statement).
- Themes: Theme applied by app.js; use CSS vars only, works in dark mode.
- Idle logout: Idle.start({minutes: me.idle_min || 60}).
- Hindi/English toggle where the old page had it (t()).
- Test with Playwright (preinstalled; `require('playwright')`, chromium.launch()) by serving the repo (`python3 -m http.server`) and STUBBING network: route `**/rest/v1/rpc/**` to return realistic fake JSON per function; route fonts/cdn as needed (jsdelivr may be reachable; if not stub xlsx). Do NOT write to the live DB. Check: no console errors, every nav item/tab renders, key flows click through, phone width 390 and desktop 1366 screenshots look like the preview. Fix what you find.
- Do not git commit/push. At the end report: files changed, what's done, any gaps/known issues, any app.js bug found.
