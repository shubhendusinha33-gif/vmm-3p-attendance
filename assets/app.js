/* VMM 3rd Party Attendance — shared helpers (v5)
   The only file to edit when moving to another Supabase project: CONFIG below.

   Kept from v1–v4 (same behaviour): rpc, photoFn, store, tabStore, Session, deviceId, homeFor, goLogin,
     requireSession, viewBanner, logout, istNow, ymd, todayIST, parseYmd, monthStart, fmtDate, fmtDay,
     I18N/lang/t/catName/applyI18n/langToggle, $, $$, esc, toast, pct, pctColor, pctTag, errText, credit,
     getPosition, compressPhoto, readXlsx, normRow, waShare, camPermission, askPermissions, consentKey,
     hasConsent, consentGate, permissionsReady, startCamera, compressDrawable, POSTS, Layout, WA_ICON,
     modal(html, onSubmit) (legacy form dialog when onSubmit is given), changePinDialog (→ changePinModal).

   New in v5 (see the v5 section at the end of this file):
     Theme.apply()                 runs on load: localStorage 3pa_theme / 3pa_dark → <html data-pal / data-theme>
     Theme.set(pal) · Theme.setDark(on) · Theme.toggleDark() → bool · Theme.pal() · Theme.isDark()
     Theme.PALS                    [[id, label]] — 'p3' = Slate & Orange (default, no data-pal)
     ICONS / icon(key)             nav icon paths (24×24, stroke) shared by sidebar + tab bar
     pinBoxes(el, n=4)             digit boxes; el.onEnter(pin) on Enter, el.onComplete(pin) when all filled
     pinVal(el) · pinClear(el, focus=true)
     loadScript(src)               lazy <script> loader (deduped, Promise)
     downloadXlsx(rows, filename, sheet='Sheet1') → Promise<bool>   styled .xlsx via xlsx-js-style
     modal(html, opts?) → .md el   v5 dialog (.ov/.md); backdrop / Esc / [data-close] close it
     closeModal(el?)               close one dialog (el inside it) or all v5 dialogs
     Idle.start({minutes, onLogout, warn=60}) · Idle.stop() · Idle.reset()
     appShell(root, {me, nav, adminNav, active, onNav, title, scope}) → {bar, wrap, side, main, setActive, setBadge, setTitle}
     mobileShell(root, {me, tabs, active, onNav, title, head, sub}) → {wrap, bar, header, setActive, setDot, setBadge, setTitle}
     changePinModal(me)            Change PIN with pinBoxes + change_pin RPC
     roleLabel(role)               'AM', 'ZFM', 'HO Dept', 'RLPO', 'Admin', 'Store' */
const CONFIG = {
  url: 'https://phyllziizajuphenpwxz.supabase.co',
  key: 'sb_publishable_KRASYzbWRPYoKzJItq-Gqw_zLwUvnX-',
  vapid: 'BAsbkygj12e9BqLRrc_h-9xIjkGgFgwX3vItu4s5c4lyPLVYISZYpoClWcmXZe2nKLtZC5SR_vsKw0TGK3ANUIg',   // web push public key
  version: 'v5',
  policy: '2026-11-v2',   // bump when the privacy text changes: everyone is asked again
};

/* ---------- no framing (clickjacking guard) ---------- */
if (window.top !== window.self) { document.documentElement.style.display = 'none'; try { window.top.location = window.self.location; } catch (e) {} }

/* ---------- API ---------- */
async function rpc(fn, args = {}) {
  let res;
  try {
    res = await fetch(`${CONFIG.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: CONFIG.key, Authorization: `Bearer ${CONFIG.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
  } catch (e) {
    return { ok: false, error: 'NETWORK' };
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: (data && (data.message || data.error)) || `HTTP_${res.status}` };
  if (data && data.ok === false && data.error === 'SESSION_EXPIRED') { Session.clear(); goLogin('expired'); }
  if (data && typeof data === 'object' && data.consent_epoch != null) store.set('vmm3p_cepoch', Number(data.consent_epoch) || 1);
  return data;
}
async function photoFn(body) {
  try {
    const res = await fetch(`${CONFIG.url}/functions/v1/photo`, {
      method: 'POST',
      headers: { apikey: CONFIG.key, Authorization: `Bearer ${CONFIG.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (e) { return { ok: false, error: 'NETWORK' }; }
}

/* ---------- storage that never throws ---------- */
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
/* View-as (Admin, read-only) lives in this tab only (sessionStorage), so the Admin's own login is untouched */
const tabStore = {
  get(k) { try { const v = sessionStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { sessionStorage.removeItem(k); } catch (e) {} },
};
(function takeViewHandoff() {
  if (!/[?&]view=1\b/.test(location.search)) return;
  const h = store.get('vmm3p_view_handoff'); store.del('vmm3p_view_handoff');
  if (h && h.token && Date.now() - (h.at || 0) < 60000) tabStore.set('vmm3p_view', h);
  history.replaceState(null, '', location.pathname + location.hash);
})();
const Session = {
  isView() { return !!tabStore.get('vmm3p_view'); },
  get() { return tabStore.get('vmm3p_view') || store.get('vmm3p_session'); },
  set(s) { if (this.isView()) tabStore.set('vmm3p_view', s); else store.set('vmm3p_session', s); },
  clear() { if (this.isView()) tabStore.del('vmm3p_view'); else store.del('vmm3p_session'); },
  token() { const s = this.get(); return s ? s.token : null; },
};
function deviceId() {
  let d = store.get('vmm3p_device');
  if (!d) { d = 'd' + Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('vmm3p_device', d); }
  return d;
}
function homeFor(role) {
  return { store: 'store.html', am: 'manage.html', zfm: 'manage.html', hodept: 'manage.html', rlpo: 'manage.html', admin: 'admin.html' }[role] || 'index.html';
}
function goLogin(reason) { location.href = 'index.html' + (reason ? `?r=${reason}` : ''); }
async function requireSession(roles) {
  const s = Session.get();
  if (!s || !s.token) { goLogin(); return null; }
  const me = await rpc('auth_me', { p_token: s.token });
  if (!me || !me.ok) { Session.clear(); goLogin('expired'); return null; }
  if (roles && !roles.includes(me.role)) { location.href = homeFor(me.role); return null; }
  Session.set({ ...s, ...me, token: s.token });
  if (me.view_by) viewBanner(me);
  window.__noIdle = !!me.no_idle && !me.view_by;
  return { ...me, token: s.token };
}
function viewBanner(me) {
  if ($('#viewBar')) return;
  document.body.insertAdjacentHTML('afterbegin', `<div id="viewBar" class="viewbar noprint">👁 Viewing as <b>${esc(me.name)}</b> (${esc(me.post || me.role)}${me.store_code ? ' · ' + esc(me.store_code) : ''}) · read-only<button type="button" id="viewExit">Exit view</button></div>`);
  $('#viewExit').addEventListener('click', logout);
}
async function logout() {
  const t = Session.token(), view = Session.isView();
  if (t && !view) { try { await Promise.race([Push.disable(t), new Promise((r) => setTimeout(r, 2500))]); } catch (e) {} }   // manual logout stops phone alerts
  if (t) await rpc('auth_logout', { p_token: t });
  Session.clear();
  if (view) { window.close(); location.href = 'admin.html'; return; }
  goLogin();
}

/* ---------- dates (IST) ---------- */
function istNow() { return new Date(Date.now() + (5.5 * 60 + new Date().getTimezoneOffset()) * 60000); }
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function todayIST() { return ymd(istNow()); }
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function monthStart(s) { return s.slice(0, 8) + '01'; }
function fmtDate(s) { const d = parseYmd(s); return d.toLocaleDateString(lang() === 'hi' ? 'hi-IN' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
function fmtDay(s) { const d = parseYmd(s); return d.toLocaleDateString(lang() === 'hi' ? 'hi-IN' : 'en-GB', { day: 'numeric', month: 'short' }); }

/* ---------- language ---------- */
const I18N = {
  en: {
    appTitle: '3rd Party Attendance', appSub: 'VMM Central Ops & BI',
    roleStore: 'Store', roleAm: 'AM', roleZfm: 'ZFM', roleHodept: 'HO Dept', roleAdmin: 'Admin',
    stepDetails: 'Your details', stepPin: 'PIN', empCode: 'Enter your Emp Code', empHint: 'min 5 digits', mailHint: 'Enter your full official mail id (name@company.com).', notFoundHo: 'No HO login found for this mail id + department. Check both, or ask Admin to add you in Users & PIN.',
    post: 'Post', storeCode: 'Store Code', storeHint: '2 letters + 2 digits (e.g. AA01)', department: 'Department', selectDept: '— Select department —',
    next: 'Next →', login: 'Login →', welcome: 'Welcome', verified: 'Emp Code verified ✓', enterPin: 'Enter your 4-digit PIN',
    forgotPin: 'Forgot PIN? Ask your ZFM or HO Admin to reset it.', back: '← Back',
    createPin: 'Create your PIN', answerQ: 'Answer this question', newPin: 'New PIN (4 digits)', confirmPin: 'Confirm PIN', savePin: 'Save PIN',
    pinSaved: 'PIN saved. Please log in.', wrongAnswer: 'Wrong answer. Try the new question.', pinMismatch: 'The two PINs do not match.',
    weakPin: 'PIN too easy (like 1234 or 0000). Pick another.', wrongOldPin: 'Current PIN is wrong.', adminSetup: 'Admin PIN is not set from this screen. Contact the portal owner.', forbidden: 'Not allowed for your login.',
    changePin: 'Change PIN', curPin: 'Current PIN', pinChanged: 'PIN changed.',
    loginLocked: 'Login locked', lockedWhy: 'Wrong PIN entered too many times.', tryAfter: 'Try again after this time',
    storeOpen: 'is already open', openOnPhone: 'The portal is open on {name}\'s phone (Emp {emp}) since {since}.',
    askLogout: 'Ask them to log out. If they are inactive, the store unlocks automatically around {at}.', checkAgain: 'Check again',
    notFound: 'No user found with these details. Check Emp Code, Post and Store Code.', wrongPin: 'Wrong PIN. {n} tries left.',
    network: 'No internet connection. Try again.', sessionExpired: 'You were logged out. Please log in again.',
    logout: 'Logout', today: 'Today', pickDate: 'Pick date', mtd: '1st – Today', morning: 'Morning', evening: 'Evening', both: 'Both',
    notPunched: '{n} not punched yet', allPunched: 'Everyone has punched in', present: 'Present', missing: 'Missing',
    emptySlots: 'Empty slots (as per master)', regularsMissing: 'Regulars not here today', cameDays: 'came {n} of last 7 days',
    absentQ: 'Absent?', shareWa: 'Share on WhatsApp', punchForStaff: '+ Punch for staff (no phone)', qrPoster: 'Download store QR poster',
    statement: 'Monthly statement', compOff: 'Comp-off', markCompOff: 'Mark comp-off', moreDetails: 'details',
    punchIn: 'Punch IN', punchOut: 'Punch OUT', punchTitle: 'Punch', vendor: 'Vendor', selectVendor: 'Select vendor', otherVendor: '+ Other vendor',
    brand: 'Brand', yourName: 'Your name', nameHint: 'Full name', getLocation: 'Checking your location…',
    insideStore: 'Inside store ({d} m)', locFound: 'Location found (±{a} m)', outside: 'You are {d} m away. Punch only inside the store ({r} m).', noGps: 'Turn on location (GPS) and allow it for this site.',
    testMode: 'Test mode: location not checked', alreadyReg: 'Code: {code} (already registered)', newReg: 'New name: a code will be created',
    photoToday: 'Your photo will be taken today', photoHint: 'Tap the button and take a clear selfie', takePhoto: 'Take photo',
    punchDone: 'Punch recorded', nextPunch: 'Next punch', photoSaved: 'Photo saved', photoFailed: 'Photo not saved, try again',
    duplicate: 'You just punched. Wait 2 minutes.', badName: 'Write your name in letters only (2–40).', brandRequired: 'Select your brand.',
    noPhone: 'No phone? Ask the SMT (store management team) to punch for you.', fromQr: '(from QR)', modMode: 'Store phone',
    associate: 'Associate', notYou: 'Not you?', otherPhone: 'This name is linked to another phone. Ask the SMT to punch for you.', phoneInUse: 'This phone is already used by another person. Ask the SMT to punch for you.', selectAssociate: 'Pick associate', newName: '+ New name', chooseCat: 'Choose department',
    consentTitle: 'Camera and location are needed', consentIntro: 'To mark attendance, this portal uses:',
    consentLoc: 'Your location, only when you log in or punch, to check you are inside the store.',
    consentCam: 'Your photo (small, about 8 KB), on some punches, to confirm the right person punched.',
    consentKeep: 'Used only by VMM for attendance and payroll with your vendor. Photos are removed from the portal after the monthly download.',
    consentRead: 'Read full privacy policy', consentAgree: 'I agree to share my location and photo for attendance.',
    consentBtn: 'Allow camera & location', consentNeedTick: 'Tick the box to agree first.',
    permDenied: 'Camera or location is blocked. This portal cannot be used without them.',
    permHow: 'Fix: tap the 🔒 icon next to the website address → Permissions → allow Camera and Location → reload the page.',
    permRetry: 'Try again', permTestSkip: 'Continue without (test mode only)',
    modConsent: 'The associate agreed to share location and photo for attendance.', consentRequired: 'Consent is required to punch.',
    noCamera: 'Camera not available. Use the button below to take the photo.', shutter: 'Capture',

    registerTitle: 'Register & create PIN', registerNew: 'New here · {store} · {post}', registerSub: 'First login registers you for this store and post.',
    fullName: 'Your full name', registerBtn: 'Register & save PIN', storeNotFound: 'Store code not found. Check the code.',
    postTaken: '{post} of {store} is already registered to {name} ({emp}). If that person left, ask your AM to mark the post vacant, then register again.',
    empElsewhere: 'This Emp Code is already registered as {where}. Ask your AM to mark it vacant first.',
    setupCode: 'Setup code from your invite email', setupHint: 'One-time code · sent in your invite email', badCode: 'Wrong setup code.',
    codeExpired: 'Setup code expired or not issued. Ask Admin or your ZFM for a new invite.', badNameReg: 'Write your full name in letters (3–60).',
    viewDesktop: '🖥 Desktop', viewMobile: '📱 Mobile',
    requestChange: 'Request change', reasonReq: 'Reason (required)', sendToAm: 'Send to AM for approval', myRequests: 'My requests',
    stPending: 'Pending AM', stApproved: 'Approved', stRejected: 'Rejected', nothingChanges: 'Nothing changes until your AM approves.',
    alreadyPending: 'A request for this is already pending with AM.', editTypeOff: 'This change type is switched off. Ask Admin.',
    reasonRequired: 'Write a reason (at least 5 letters).', compoffReq: 'Comp-off request', staffReq: 'Change staff details', requestSent: 'Sent to AM for approval',
    liveLook: 'Look straight at the camera', liveBlink: '👁 Blink 2 times', liveLeft: '↩ Turn your head LEFT', liveRight: '↪ Turn your head RIGHT',
    liveFound: 'Face found ✓ hold still', livePass: '✓ Live person', liveFail: 'Live check failed', liveLoading: 'Starting face check…',
    liveFailWhy: 'No blink or head turn seen in 15 seconds. A photo of a photo cannot do this.', liveTry: 'Try again ({n} left)', liveNoFace: 'Keep your face inside the oval',
    liveSeen: 'Seen: {n} of {m}', liveSaved: 'Saved as “Live check failed”.',
    retake: 'Retake', usePhoto: 'Use this photo', outsideLogin: 'You are {d} m from the store. Store login works only inside the store ({r} m).',
    roleRlpo: 'RLPO', idleTitle: 'Still there?', idleBody: 'No activity for a while. You will be logged out in {n} seconds to keep the portal safe.',
    idleStay: 'Stay logged in', idleOut: 'Log out now', loggedOut: 'Logged out', loggedOutWhy: 'You were inactive for a while, so we logged you out to keep the portal safe.',
    loginAgain: 'Log in again', dark: '☾ Dark', light: '☀ Light', theme: 'Theme', menu: 'Menu', nothingExport: 'Nothing to export', xlsxFail: 'Excel library could not load (offline?)', xlsxDone: '{name} downloaded · {n} rows',
  },
  hi: {
    appTitle: '3rd Party हाज़िरी', appSub: 'VMM Central Ops & BI',
    roleStore: 'स्टोर', roleAm: 'AM', roleZfm: 'ZFM', roleHodept: 'HO विभाग', roleAdmin: 'एडमिन',
    stepDetails: 'आपकी जानकारी', stepPin: 'PIN', empCode: 'अपना Emp Code डालें', empHint: 'कम से कम 5 अंक', mailHint: 'अपना पूरा ऑफिशियल मेल आईडी डालें (name@company.com)।', notFoundHo: 'इस मेल आईडी + विभाग से कोई HO लॉगिन नहीं मिला। दोनों जांचें या Admin से Users & PIN में जुड़वाएं।',
    post: 'पद', storeCode: 'स्टोर कोड', storeHint: '2 अक्षर + 2 अंक (जैसे AA01)', department: 'विभाग', selectDept: '— विभाग चुनें —',
    next: 'आगे →', login: 'लॉगिन →', welcome: 'स्वागत है', verified: 'Emp Code सही है ✓', enterPin: 'अपना 4 अंकों का PIN डालें',
    forgotPin: 'PIN भूल गए? ZFM या HO एडमिन से रीसेट करवाएं।', back: '← पीछे',
    createPin: 'अपना PIN बनाएं', answerQ: 'इस सवाल का जवाब दें', newPin: 'नया PIN (4 अंक)', confirmPin: 'PIN दोबारा डालें', savePin: 'PIN सेव करें',
    pinSaved: 'PIN सेव हो गया। अब लॉगिन करें।', wrongAnswer: 'जवाब गलत है। नया सवाल हल करें।', pinMismatch: 'दोनों PIN एक जैसे नहीं हैं।',
    weakPin: 'PIN बहुत आसान है (जैसे 1234 या 0000)। दूसरा चुनें।', wrongOldPin: 'मौजूदा PIN गलत है।', adminSetup: 'एडमिन PIN यहां से सेट नहीं होता। पोर्टल ओनर से संपर्क करें।', forbidden: 'आपके लॉगिन के लिए अनुमति नहीं है।',
    changePin: 'PIN बदलें', curPin: 'मौजूदा PIN', pinChanged: 'PIN बदल गया।',
    loginLocked: 'लॉगिन बंद है', lockedWhy: 'कई बार गलत PIN डाला गया।', tryAfter: 'इतने समय बाद दोबारा कोशिश करें',
    storeOpen: 'पहले से खुला है', openOnPhone: 'पोर्टल {name} के फ़ोन पर (Emp {emp}) {since} से खुला है।',
    askLogout: 'उनसे लॉगआउट करवाएं। वे इस्तेमाल न करें तो स्टोर लगभग {at} बजे अपने आप खुल जाएगा।', checkAgain: 'दोबारा जांचें',
    notFound: 'इस जानकारी से कोई यूज़र नहीं मिला। Emp Code, पद और स्टोर कोड जांचें।', wrongPin: 'गलत PIN। {n} कोशिश बाकी।',
    network: 'इंटरनेट नहीं है। दोबारा कोशिश करें।', sessionExpired: 'आप लॉगआउट हो गए। दोबारा लॉगिन करें।',
    logout: 'लॉगआउट', today: 'आज', pickDate: 'तारीख चुनें', mtd: '1 से आज तक', morning: 'सुबह', evening: 'शाम', both: 'दोनों',
    notPunched: '{n} ने अभी पंच नहीं किया', allPunched: 'सबने पंच कर लिया', present: 'मौजूद', missing: 'नहीं आया',
    emptySlots: 'खाली जगह (मास्टर के अनुसार)', regularsMissing: 'रोज़ आने वाले जो आज नहीं आए', cameDays: 'पिछले 7 में से {n} दिन आए',
    absentQ: 'गैरहाज़िर?', shareWa: 'WhatsApp पर भेजें', punchForStaff: '+ स्टाफ़ का पंच करें (बिना फ़ोन)', qrPoster: 'स्टोर QR पोस्टर डाउनलोड करें',
    statement: 'मासिक स्टेटमेंट', compOff: 'कॉम्प-ऑफ़', markCompOff: 'कॉम्प-ऑफ़ लगाएं', moreDetails: 'विवरण',
    punchIn: 'पंच IN', punchOut: 'पंच OUT', punchTitle: 'पंच', vendor: 'वेंडर', selectVendor: 'वेंडर चुनें', otherVendor: '+ दूसरा वेंडर',
    brand: 'ब्रांड', yourName: 'आपका नाम', nameHint: 'पूरा नाम', getLocation: 'आपकी लोकेशन देखी जा रही है…',
    insideStore: 'स्टोर के अंदर ({d} m)', locFound: 'लोकेशन मिल गई (±{a} m)', outside: 'आप {d} m दूर हैं। पंच सिर्फ़ स्टोर के अंदर ({r} m) होगा।', noGps: 'लोकेशन (GPS) चालू करें और इस साइट को अनुमति दें।',
    testMode: 'टेस्ट मोड: लोकेशन नहीं जांची जा रही', alreadyReg: 'कोड: {code} (पहले से रजिस्टर)', newReg: 'नया नाम: कोड अपने आप बनेगा',
    photoToday: 'आज आपकी फ़ोटो ली जाएगी', photoHint: 'बटन दबाएं और साफ़ सेल्फ़ी लें', takePhoto: 'फ़ोटो लें',
    punchDone: 'पंच हो गया', nextPunch: 'अगला पंच', photoSaved: 'फ़ोटो सेव हो गई', photoFailed: 'फ़ोटो सेव नहीं हुई, दोबारा लें',
    duplicate: 'आपने अभी पंच किया है। 2 मिनट रुकें।', badName: 'नाम सिर्फ़ अक्षरों में लिखें (2–40)।', brandRequired: 'अपना ब्रांड चुनें।',
    noPhone: 'फ़ोन नहीं है? SMT (स्टोर मैनेजमेंट टीम) से पंच करवाएं।', fromQr: '(QR से)', modMode: 'स्टोर का फ़ोन',
    associate: 'कर्मचारी', notYou: 'आप नहीं हैं?', otherPhone: 'यह नाम किसी दूसरे फ़ोन से जुड़ा है। SMT से पंच करवाएं।', phoneInUse: 'यह फ़ोन पहले से किसी और के लिए इस्तेमाल हुआ है। SMT से पंच करवाएं।', selectAssociate: 'कर्मचारी चुनें', newName: '+ नया नाम', chooseCat: 'विभाग चुनें',
    consentTitle: 'कैमरा और लोकेशन ज़रूरी है', consentIntro: 'हाज़िरी के लिए यह पोर्टल इस्तेमाल करता है:',
    consentLoc: 'आपकी लोकेशन, सिर्फ़ लॉगिन या पंच के समय, यह देखने के लिए कि आप स्टोर के अंदर हैं।',
    consentCam: 'आपकी फ़ोटो (छोटी, लगभग 8 KB), कुछ पंच पर, यह पक्का करने के लिए कि सही व्यक्ति ने पंच किया।',
    consentKeep: 'सिर्फ़ VMM हाज़िरी और वेंडर पेरोल के लिए इस्तेमाल करता है। मासिक डाउनलोड के बाद फ़ोटो पोर्टल से हटा दी जाती हैं।',
    consentRead: 'पूरी प्राइवेसी पॉलिसी पढ़ें', consentAgree: 'मैं हाज़िरी के लिए अपनी लोकेशन और फ़ोटो देने के लिए सहमत हूँ।',
    consentBtn: 'कैमरा और लोकेशन की अनुमति दें', consentNeedTick: 'पहले सहमति वाला बॉक्स टिक करें।',
    permDenied: 'कैमरा या लोकेशन बंद है। इनके बिना पोर्टल इस्तेमाल नहीं हो सकता।',
    permHow: 'ठीक करें: वेबसाइट पते के पास 🔒 आइकन दबाएं → Permissions → Camera और Location चालू करें → पेज रीलोड करें।',
    permRetry: 'दोबारा कोशिश करें', permTestSkip: 'बिना अनुमति आगे बढ़ें (सिर्फ़ टेस्ट मोड)',
    modConsent: 'कर्मचारी हाज़िरी के लिए लोकेशन और फ़ोटो देने के लिए सहमत है।', consentRequired: 'पंच के लिए सहमति ज़रूरी है।',
    noCamera: 'कैमरा नहीं मिला। फ़ोटो लेने के लिए नीचे का बटन दबाएं।', shutter: 'फ़ोटो लें',

    registerTitle: 'रजिस्टर करें और PIN बनाएं', registerNew: 'नए हैं · {store} · {post}', registerSub: 'पहला लॉगिन आपको इस स्टोर और पद पर रजिस्टर करता है।',
    fullName: 'आपका पूरा नाम', registerBtn: 'रजिस्टर करें और PIN सेव करें', storeNotFound: 'स्टोर कोड नहीं मिला। कोड जांचें।',
    postTaken: '{store} का {post} पहले से {name} ({emp}) के नाम है। वे चले गए हैं तो AM से पद खाली करवाएं, फिर रजिस्टर करें।',
    empElsewhere: 'यह Emp Code पहले से {where} के रूप में रजिस्टर है। पहले AM से खाली करवाएं।',
    setupCode: 'इनवाइट ईमेल का सेटअप कोड', setupHint: 'एक बार का कोड · इनवाइट ईमेल में', badCode: 'सेटअप कोड गलत है।',
    codeExpired: 'सेटअप कोड खत्म हो गया या मिला नहीं। एडमिन या ZFM से नया इनवाइट लें।', badNameReg: 'पूरा नाम अक्षरों में लिखें (3–60)।',
    viewDesktop: '🖥 डेस्कटॉप', viewMobile: '📱 मोबाइल',
    requestChange: 'बदलाव का अनुरोध', reasonReq: 'कारण (ज़रूरी)', sendToAm: 'AM को मंज़ूरी के लिए भेजें', myRequests: 'मेरे अनुरोध',
    stPending: 'AM के पास', stApproved: 'मंज़ूर', stRejected: 'नामंज़ूर', nothingChanges: 'AM की मंज़ूरी तक कुछ नहीं बदलेगा।',
    alreadyPending: 'इसका अनुरोध पहले से AM के पास है।', editTypeOff: 'यह बदलाव बंद है। एडमिन से पूछें।',
    reasonRequired: 'कारण लिखें (कम से कम 5 अक्षर)।', compoffReq: 'कॉम्प-ऑफ़ अनुरोध', staffReq: 'स्टाफ़ की जानकारी बदलें', requestSent: 'AM को मंज़ूरी के लिए भेजा गया',
    liveLook: 'कैमरे की तरफ़ सीधे देखें', liveBlink: '👁 पलक 2 बार झपकाएं', liveLeft: '↩ सिर बाईं ओर घुमाएं', liveRight: '↪ सिर दाईं ओर घुमाएं',
    liveFound: 'चेहरा मिल गया ✓ रुके रहें', livePass: '✓ असली व्यक्ति', liveFail: 'लाइव जांच फ़ेल', liveLoading: 'चेहरा जांच शुरू हो रही है…',
    liveFailWhy: '15 सेकंड में पलक या सिर नहीं हिला। फ़ोटो की फ़ोटो ऐसा नहीं कर सकती।', liveTry: 'दोबारा कोशिश ({n} बाकी)', liveNoFace: 'चेहरा अंडाकार के अंदर रखें',
    liveSeen: 'देखा: {m} में से {n}', liveSaved: '“लाइव जांच फ़ेल” के रूप में सेव हुआ।',
    retake: 'दोबारा लें', usePhoto: 'यह फ़ोटो भेजें', outsideLogin: 'आप स्टोर से {d} m दूर हैं। स्टोर लॉगिन सिर्फ़ स्टोर के अंदर ({r} m) होगा।',
    roleRlpo: 'RLPO', idleTitle: 'क्या आप अभी भी हैं?', idleBody: 'काफ़ी देर से कोई गतिविधि नहीं। सुरक्षा के लिए {n} सेकंड में लॉगआउट हो जाएगा।',
    idleStay: 'लॉगिन रहें', idleOut: 'अभी लॉगआउट करें', loggedOut: 'लॉगआउट हो गया', loggedOutWhy: 'आप काफ़ी देर से निष्क्रिय थे, इसलिए सुरक्षा के लिए लॉगआउट कर दिया गया।',
    loginAgain: 'दोबारा लॉगिन करें', dark: '☾ डार्क', light: '☀ लाइट', theme: 'थीम', menu: 'मेनू', nothingExport: 'एक्सपोर्ट के लिए कुछ नहीं', xlsxFail: 'Excel लाइब्रेरी लोड नहीं हुई (इंटरनेट?)', xlsxDone: '{name} डाउनलोड हुआ · {n} पंक्तियाँ',
  },
};
function lang() { return store.get('vmm3p_lang', 'en'); }
function t(k, vars) {
  let s = (I18N[lang()] && I18N[lang()][k]) || I18N.en[k] || k;
  if (vars) for (const [a, b] of Object.entries(vars)) s = s.replaceAll(`{${a}}`, b);
  return s;
}
function catName(c) { return lang() === 'hi' && c.name_hi ? c.name_hi : c.name; }
function applyI18n(root = document) {
  root.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  root.querySelectorAll('[data-tp]').forEach((el) => { el.placeholder = t(el.dataset.tp); });
  document.documentElement.lang = lang() === 'hi' ? 'hi' : 'en';
}
function langToggle(onChange) {
  const w = document.createElement('div');
  w.className = 'lang';
  w.innerHTML = `<button type="button" data-l="en">EN</button><button type="button" data-l="hi">हिंदी</button>`;
  const paint = () => w.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.l === lang()));
  w.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    store.set('vmm3p_lang', b.dataset.l); paint(); applyI18n(); onChange && onChange();
  });
  paint();
  return w;
}

/* ---------- ui helpers ---------- */
function $(s, r = document) { return r.querySelector(s); }
function $$(s, r = document) { return [...r.querySelectorAll(s)]; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function toast(msg, ms = 2600) {
  const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg;
  document.body.appendChild(d); setTimeout(() => d.remove(), ms);
}
function pct(p, r) { return r > 0 ? Math.round((p / r) * 100) : (p > 0 ? 100 : 0); }
function pctColor(v) { return v >= 90 ? 'var(--ok)' : v >= 70 ? 'var(--amb)' : 'var(--red)'; }
function pctTag(v) { return v >= 90 ? 'ok' : v >= 70 ? 'w' : 'r'; }
function errText(e) {
  return ({ NETWORK: t('network'), NOT_FOUND: t('notFound'), SESSION_EXPIRED: t('sessionExpired'),
    DUPLICATE: t('duplicate'), OTHER_PHONE: t('otherPhone'), PHONE_IN_USE: t('phoneInUse'), BAD_NAME: t('badName'), BRAND_REQUIRED: t('brandRequired'), CONSENT_REQUIRED: t('consentRequired'), NO_GPS: t('noGps'),
    READ_ONLY: 'View mode is read-only. Nothing was changed.', WEAK_PIN: t('weakPin'), WRONG_OLD_PIN: t('wrongOldPin'),
    ADMIN_SETUP: t('adminSetup'), BAD_CODE: t('badCode'), CODE_EXPIRED: t('codeExpired'), STORE_NOT_FOUND: t('storeNotFound'),
    ALREADY_PENDING: t('alreadyPending'), EDIT_TYPE_OFF: t('editTypeOff'), REASON_REQUIRED: t('reasonRequired'), POST_TAKEN: t('postTaken', { post: '', store: '', name: '', emp: '' }),
    EMP_ELSEWHERE: t('empElsewhere', { where: '—' }), ALREADY_DECIDED: 'Already decided by someone else.', DUPLICATE_NAME: 'Another associate in this store already has this name.', ADMIN_PROTECTED: 'Admin PIN cannot be reset here. Admin changes it with Change PIN.', FORBIDDEN: t('forbidden'),
    SM_ASM_ONLY: lang() === 'hi' ? 'यह सिर्फ़ SM / ASM कर सकते हैं।' : 'Only SM / ASM can do this.',
    NOTE_REQUIRED: 'Remark is mandatory to reject.', TOO_OLD: lang() === 'hi' ? 'सिर्फ़ आज और कल के पंच बदले जा सकते हैं।' : 'Only today and yesterday can be changed.',
    SELFIE_PUNCH: lang() === 'hi' ? 'ऑडिट सेल्फी वाला पंच डिलीट नहीं हो सकता।' : 'A punch with the audit selfie cannot be deleted.',
    ONLY_PUNCH: lang() === 'hi' ? 'उस दिन का अकेला पंच डिलीट नहीं हो सकता।' : 'The only punch of the day cannot be deleted.',
    PUNCHED_THAT_DAY: lang() === 'hi' ? 'उस दिन IN पंच हो चुका है, वीक ऑफ नहीं लग सकता।' : 'Already punched IN that day, so no week off.',
    ALREADY_OFF: lang() === 'hi' ? 'उस दिन पहले से छुट्टी लगी है।' : 'Already off on that day.',
    WO_IN_7_DAYS: lang() === 'hi' ? '7 दिन में एक ही वीक ऑफ लग सकता है।' : 'Only 1 week off in any 7 days.',
    NO_PHONE_LINK: lang() === 'hi' ? 'इस व्यक्ति से कोई फ़ोन जुड़ा नहीं है, वह अपने फ़ोन से सीधे पंच कर सकता है।' : 'No phone is linked to this person. They can punch from their own phone directly.',
    BAD_DATE: lang() === 'hi' ? 'तारीख सही नहीं है।' : 'Date is not allowed.', BAD_VALUE: lang() === 'hi' ? 'संख्या सही नहीं है।' : 'Number is not valid.' })[e] || String(e || 'Error');
}
function credit() { return `${CONFIG.version} · Designed &amp; Developed by Shubhendu Sinha · VMM Central Ops &amp; BI`; }

/* ---------- location ---------- */
function getPosition(timeoutMs = 15000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 });
  });
}

/* ---------- photo: compress to <= 8 KB (WebP, JPEG fallback) ---------- */
async function compressPhoto(file, maxKB = 8, w = 240, h = 320) {
  const img = await new Promise((res, rej) => {
    const u = URL.createObjectURL(file); const i = new Image();
    i.onload = () => res(i); i.onerror = () => rej(new Error('image')); i.src = u;
  });
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const r = Math.max(w / img.width, h / img.height);
  ctx.drawImage(img, (w - img.width * r) / 2, (h - img.height * r) / 2, img.width * r, img.height * r);
  const toBlob = (type, q) => new Promise((res) => c.toBlob(res, type, q));
  const probe = await toBlob('image/webp', 0.5);
  const type = probe && probe.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  let lo = 0.05, hi = 0.95, best = null;
  for (let k = 0; k < 9; k++) {
    const q = (lo + hi) / 2; const b = await toBlob(type, q);
    if (b.size <= maxKB * 1024) { best = b; lo = q; } else { hi = q; }
  }
  if (!best) best = await toBlob(type, 0.05);
  const b64 = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(best); });
  return { b64, bytes: best.size, type };
}

/* ---------- excel helpers ----------
   Export = real .xlsx through xlsx-js-style (lazy-loaded from jsdelivr; a superset of SheetJS, so it also
   reads). Calibri 10 · thin borders on every cell · bold white header on #334155 · auto-fit widths · autofilter.
   Import uses whichever XLSX is on the page (xlsx@0.18.5 or xlsx-js-style) and loads one if none is. */
const XLSX_STYLE_URL = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
const _scripts = {};
function loadScript(src) {
  if (_scripts[src]) return _scripts[src];
  _scripts[src] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = () => res(); s.onerror = () => { delete _scripts[src]; s.remove(); rej(new Error('load ' + src)); };
    document.head.appendChild(s);
  });
  return _scripts[src];
}
let _xlsxStyled = null;
async function xlsxStyled() {
  if (_xlsxStyled) return _xlsxStyled;
  if (window.XLSX && window.XLSX.style_version) return (_xlsxStyled = window.XLSX);
  const plain = window.XLSX;
  await loadScript(XLSX_STYLE_URL);
  if (!window.XLSX || window.XLSX === plain) throw new Error('xlsx-js-style');
  _xlsxStyled = window.XLSX;
  return _xlsxStyled;
}
async function xlsxAny() {
  if (_xlsxStyled) return _xlsxStyled;
  if (window.XLSX && window.XLSX.read) return window.XLSX;
  return xlsxStyled();
}
async function downloadXlsx(rows, name, sheet = 'Sheet1') {
  rows = rows || [];
  if (!rows.length) { toast(t('nothingExport')); return false; }
  let X;
  try { X = await xlsxStyled(); } catch (e) { toast(t('xlsxFail')); return false; }
  const head = [];
  rows.forEach((r) => Object.keys(r).forEach((k) => { if (!head.includes(k)) head.push(k); }));
  const aoa = [head, ...rows.map((r) => head.map((k) => (r[k] === null || r[k] === undefined ? '' : r[k])))];
  const ws = X.utils.aoa_to_sheet(aoa);
  const bd = { style: 'thin', color: { rgb: 'A6A6A6' } }, border = { top: bd, bottom: bd, left: bd, right: bd };
  aoa.forEach((r, ri) => r.forEach((v, ci) => {
    const ref = X.utils.encode_cell({ r: ri, c: ci });
    if (!ws[ref]) ws[ref] = { t: 's', v: '' };
    ws[ref].s = ri === 0
      ? { font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: 'FFFFFF' } }, border, fill: { patternType: 'solid', fgColor: { rgb: '334155' } }, alignment: { vertical: 'center', horizontal: 'left' } }
      : { font: { name: 'Calibri', sz: 10 }, border, alignment: { vertical: 'center', horizontal: typeof v === 'number' ? 'right' : 'left' } };
  }));
  const len = (v) => Math.max(...String(v ?? '').split('\n').map((s) => s.length));
  ws['!cols'] = head.map((_, ci) => ({ wch: Math.min(60, Math.max(4, ...aoa.map((r) => len(r[ci]))) + 2) }));
  ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: head.length - 1 } }) };
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, String(sheet || 'Sheet1').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  X.writeFile(wb, /\.xlsx$/i.test(name) ? name : name + '.xlsx');
  return true;
}
async function readXlsx(file) {
  const X = await xlsxAny();
  const buf = await file.arrayBuffer(); const wb = X.read(buf, { type: 'array' });
  return X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
}
/* normalise header names: "Store Code" -> store_code */
function normRow(r) { const o = {}; for (const [k, v] of Object.entries(r)) o[String(k).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')] = typeof v === 'string' ? v.trim() : v; return o; }

/* ---------- WhatsApp share (free, opens WhatsApp with text) ---------- */
function waShare(text) { location.href = 'https://wa.me/?text=' + encodeURIComponent(text); }

/* ---------- v2: permissions, consent gate, live camera ---------- */
async function camPermission() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
  try {
    const st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    st.getTracks().forEach((t) => t.stop());
    return true;
  } catch (e) { return false; }
}
/* asks for location + camera; returns { pos, cam } */
async function askPermissions(needCamera = true) {
  const [pos, cam] = await Promise.all([getPosition(), needCamera ? camPermission() : Promise.resolve(true)]);
  return { pos, cam };
}
// consent_epoch comes from the server (login_options / punch_context / auth_me). Admin → Settings → "Delete all consents"
// bumps it, so every phone is asked again (old keys simply stop matching).
function consentKey(kind) { const e = store.get('vmm3p_cepoch', 1); return `vmm3p_consent_${kind}_${CONFIG.policy}` + (e > 1 ? `_e${e}` : ''); }
function hasConsent(kind) { return !!store.get(consentKey(kind)); }

/* Full-screen gate: policy summary + tick box + permission check.
   opts: { kind: 'associate'|'user', store, emp, testMode, needCamera }
   resolves with { pos, cam } once consent is given and permissions are allowed (or test mode skip). */
function consentGate(opts) {
  return new Promise((resolve) => {
    const already = hasConsent(opts.kind);
    const el = document.createElement('div');
    el.className = 'gate';
    el.innerHTML = `<div class="card" style="max-width:440px">
      <img class="logo" src="assets/logo.png" alt="Vishal Mega Mart">
      <h2 class="ttl" data-t="consentTitle"></h2>
      <div data-box="info" style="display:flex;flex-direction:column;gap:8px;font-size:14px">
        <div data-t="consentIntro" style="font-weight:700"></div>
        <div class="note i">📍 <span data-t="consentLoc"></span></div>
        ${opts.needCamera === false ? '' : '<div class="note i">📷 <span data-t="consentCam"></span></div>'}
        <div class="crumb" data-t="consentKeep"></div>
        <a href="privacy.html" target="_blank" rel="noopener" style="font-size:13px;font-weight:700" data-t="consentRead"></a>
        <label style="display:flex;gap:10px;align-items:flex-start;font-size:14px;font-weight:700;cursor:pointer">
          <input type="checkbox" data-box="tick" style="width:22px;height:22px;flex-shrink:0;margin-top:1px" ${already ? 'checked' : ''}><span data-t="consentAgree"></span></label>
      </div>
      <div class="note r" data-box="err" hidden></div>
      <button class="btn" type="button" data-box="go" data-t="consentBtn"></button>
      <button class="btn o" type="button" data-box="skip" hidden data-t="permTestSkip"></button>
      <p class="credit">${credit()}</p></div>`;
    document.body.appendChild(el);
    applyI18n(el);
    const box = (k) => el.querySelector(`[data-box="${k}"]`);
    const fail = (m, how) => { box('err').hidden = false; box('err').innerHTML = esc(m) + (how ? `<br><br>${esc(t('permHow'))}` : ''); };
    box('go').addEventListener('click', async () => {
      if (!box('tick').checked) return fail(t('consentNeedTick'));
      if (opts.requirePerms === false) {
        if (!hasConsent(opts.kind)) { store.set(consentKey(opts.kind), { at: Date.now() });
          rpc('consent_record', { p_kind: opts.kind, p_store: opts.store || null, p_device: deviceId(), p_emp: opts.emp || null, p_version: CONFIG.policy, p_lang: lang(), p_ua: navigator.userAgent }); }
        el.remove(); return resolve({ pos: null, cam: false });
      }
      box('err').hidden = true; box('go').disabled = true; box('go').textContent = t('getLocation');
      const r = await askPermissions(opts.needCamera !== false);
      box('go').disabled = false; box('go').textContent = t('permRetry');
      if (!hasConsent(opts.kind)) {
        store.set(consentKey(opts.kind), { at: Date.now() });
        rpc('consent_record', { p_kind: opts.kind, p_store: opts.store || null, p_device: deviceId(), p_emp: opts.emp || null,
          p_version: CONFIG.policy, p_lang: lang(), p_ua: navigator.userAgent });
      }
      if (r.pos && r.cam) { el.remove(); return resolve(r); }
      fail(t('permDenied'), true);
      if (opts.testMode) box('skip').hidden = false;
    });
    box('skip').addEventListener('click', () => { el.remove(); resolve({ pos: null, cam: false, skipped: true }); });
  });
}
/* quick check without UI: consent stored and permissions already allowed? */
async function permissionsReady(kind, needCamera = true) {
  if (!hasConsent(kind)) return null;
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const g = await navigator.permissions.query({ name: 'geolocation' });
      if (g.state !== 'granted') return null;
      if (needCamera) { const c = await navigator.permissions.query({ name: 'camera' }).catch(() => null); if (c && c.state !== 'granted') return null; }
    }
  } catch (e) { /* some browsers do not support the query: fall through to a real request */ }
  const r = await askPermissions(needCamera);
  return r.pos && r.cam ? r : null;
}

/* live selfie camera into a <video>; returns a stop() function */
async function startCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
  video.srcObject = stream; video.setAttribute('playsinline', ''); video.muted = true; await video.play();
  return () => stream.getTracks().forEach((t) => t.stop());
}
/* compress any drawable (video frame or image) to <= maxKB */
async function compressDrawable(src, sw, sh, maxKB = 8, w = 240, h = 320, mirror = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const r = Math.max(w / sw, h / sh);
  if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
  ctx.drawImage(src, (w - sw * r) / 2, (h - sh * r) / 2, sw * r, sh * r);
  const toBlob = (type, q) => new Promise((res) => c.toBlob(res, type, q));
  const probe = await toBlob('image/webp', 0.5);
  const type = probe && probe.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  let lo = 0.05, hi = 0.95, best = null;
  for (let k = 0; k < 9; k++) {
    const q = (lo + hi) / 2; const b = await toBlob(type, q);
    if (b.size <= maxKB * 1024) { best = b; lo = q; } else { hi = q; }
  }
  if (!best) best = await toBlob(type, 0.05);
  const b64 = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(best); });
  return { b64, bytes: best.size, type };
}

/* ---------- v3: change own PIN — v5 uses PIN boxes (changePinModal below); old name kept ---------- */
function changePinDialog(me) { return changePinModal(me); }

/* ---------- v4: Desktop / Mobile layout (non-store users) ---------- */
const POSTS = ['SM', 'ASM', 'DM Apps', 'DM FMCG', 'DM GM'];
const Layout = {
  get() { return store.get('vmm3p_layout', null); },
  set(v) { store.set('vmm3p_layout', v); },
  small() { return Math.min(screen.width || 9999, window.outerWidth || 9999) < 820; },
  effective() { return this.get() || (this.small() ? 'mobile' : 'desktop'); },
  apply() {
    const m = this.get(), vp = document.querySelector('meta[name=viewport]');
    if (vp && m === 'desktop' && this.small()) vp.setAttribute('content', 'width=1280');
    document.documentElement.classList.toggle('force-mobile', m === 'mobile' && !this.small());
  },
  toggle(onChange) {
    const el = document.createElement('div'); el.className = 'layoutseg';
    const paint = () => { el.innerHTML = ['desktop', 'mobile'].map((v) => `<button type="button" data-l="${v}" class="${this.effective() === v ? 'on' : ''}">${t(v === 'desktop' ? 'viewDesktop' : 'viewMobile')}</button>`).join(''); };
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-l]'); if (!b) return; this.set(b.dataset.l); paint(); if (onChange) onChange(b.dataset.l); });
    paint(); return el;
  },
};
const WA_ICON = '<svg width="26" height="26" viewBox="0 0 32 32" aria-label="WhatsApp"><circle cx="16" cy="16" r="16" fill="#25D366"/><path d="M16 7.2a8.8 8.8 0 0 0-7.6 13.2L7.3 24.8l4.5-1.2A8.8 8.8 0 1 0 16 7.2z" fill="#fff"/><path d="M12.6 11.6c.2-.4.4-.4.7-.4h.5c.2 0 .4 0 .6.5l.8 1.9c.1.2.1.4 0 .6l-.5.7c-.1.2-.2.3 0 .6.5.9 1.6 2 2.7 2.5.3.1.4.1.6-.1l.7-.8c.2-.2.4-.2.6-.1l1.8.9c.3.1.4.2.4.4 0 .5-.2 1.2-.8 1.5-.5.3-1.4.5-3-.1-1.9-.8-3.5-2.6-4.2-3.9-.6-1.1-.6-2-.4-2.5z" fill="#25D366"/></svg>';

/* legacy form dialog (v4): modal(html, onSubmit) — onSubmit(form, close) returns an error string or nothing */
function legacyModal(html, onSubmit) {
  const el = document.createElement('div'); el.className = 'dlg';
  el.innerHTML = `<form class="box">${html}<div class="note r" data-err hidden></div><div class="row"><button type="button" class="btn o" data-x style="flex:1">✕</button><button class="btn" data-ok style="flex:2"></button></div></form>`;
  document.body.appendChild(el);
  const f = el.querySelector('form');
  const close = () => el.remove();
  el.querySelector('[data-x]').onclick = close;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = el.querySelector('[data-ok]'); btn.disabled = true;
    const err = await onSubmit(f, close);
    btn.disabled = false;
    if (err) { const n = el.querySelector('[data-err]'); n.hidden = false; n.textContent = err; }
  });
  return { el, form: f, okLabel: (s) => { el.querySelector('[data-ok]').textContent = s; } };
}

/* =====================================================================
   v5: theme, icons, PIN boxes, dialogs, idle logout, app shells
   ===================================================================== */

/* ---------- theme (9 palettes + dark), saved per device ---------- */
const Theme = {
  PALS: [['p3', 'Slate & Orange (default)'], ['p1', 'Indigo & Teal'], ['p2', 'Teal & Violet'], ['p4', 'Plum & Sky'], ['p5', 'Navy & Cyan'],
    ['p6', 'Charcoal & Violet'], ['p7', 'Espresso & Teal'], ['p8', 'Wine & Blue'], ['cur', 'Blue & Pink']],
  KEY: '3pa_theme', DARK: '3pa_dark',
  _get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  _put(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  _paint(pal, dark) {
    const r = document.documentElement;
    if (!pal || pal === 'p3' || !this.PALS.some((p) => p[0] === pal)) delete r.dataset.pal; else r.dataset.pal = pal;
    if (dark) r.dataset.theme = 'dark'; else delete r.dataset.theme;
    document.dispatchEvent(new CustomEvent('themechange', { detail: { pal: this.pal(), dark: this.isDark() } }));
  },
  pal() { return document.documentElement.dataset.pal || 'p3'; },
  isDark() { return document.documentElement.dataset.theme === 'dark'; },
  apply() { this._paint(this._get(this.KEY), this._get(this.DARK) === '1'); },
  set(pal) { this._put(this.KEY, pal || 'p3'); this._paint(pal, this.isDark()); },
  setDark(on) { this._put(this.DARK, on ? '1' : ''); this._paint(this.pal(), !!on); },
  toggleDark() { this.setDark(!this.isDark()); return this.isDark(); },
  options() { return this.PALS.map(([v, l]) => `<option value="${v}"${this.pal() === v ? ' selected' : ''}>🎨 ${esc(l)}</option>`).join(''); },
};
Theme.apply();
window.addEventListener('storage', (e) => { if (e.key === Theme.KEY || e.key === Theme.DARK) Theme.apply(); });

/* ---------- icons: 24×24 stroke paths (from the preview), used by appShell / mobileShell ---------- */
const ICONS = {
  ld: '<path d="M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 13h7v8H3z"/>',
  ap: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  tm: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M15 20c0-2 2-4 4-4"/>',
  ch: '<path d="M4 4v6h6"/><path d="M20 20v-6h-6"/><path d="M20 10A8 8 0 0 0 6 6L4 10M4 14a8 8 0 0 0 14 4l2-4"/>',
  stm: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h8"/>',
  st: '<path d="M3 9l1-5h16l1 5"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/>',
  mp: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  us: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  ho: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-5h6v5"/>',
  ml: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  set: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
  lg: '<path d="M4 5h16M4 12h16M4 19h10"/>',
  td: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  pn: '<path d="M12 2v10M8 8l4 4 4-4"/><rect x="4" y="14" width="16" height="7" rx="2"/>',
  rq: '<path d="M4 4h16v12H8l-4 4z"/>',
  qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM18 18h3v3h-3z"/>',
  // aliases used by the v5 pages
  sga: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  man: '<path d="M12 2v10M8 8l4 4 4-4"/><rect x="4" y="14" width="16" height="7" rx="2"/>',
  rl: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M15 20c0-2 2-4 4-4"/>',
  hks: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  store: '<path d="M3 9l1-5h16l1 5"/><path d="M4 9v11h16V9"/>',
};
/* icon(key | raw '<path…>' markup) → <svg> */
function icon(k, cls = '') {
  const p = ICONS[k] || (String(k || '').trim().startsWith('<') ? k : ICONS.lg);
  return `<svg viewBox="0 0 24 24"${cls ? ` class="${cls}"` : ''} aria-hidden="true">${p}</svg>`;
}
function roleLabel(role) {
  return { store: t('roleStore'), am: 'AM', zfm: 'ZFM', hodept: t('roleHodept'), rlpo: 'RLPO', admin: t('roleAdmin') }[role] || role || '';
}

/* ---------- PIN boxes: one digit each, auto-advance, Backspace goes back, arrows, paste fills, Enter submits ----------
   pinBoxes(el, n=4): el = element or selector. Set el.onEnter = (pin) => … for Enter; el.onComplete = (pin) => …
   when the last box is filled (otherwise focus moves to the next empty .pins group on the page).
   Defined on window (not with const/function) so an old page that declares its own pinBoxes/pinVal keeps working. */
function _pinEl(el) {
  if (!el) return null;
  if (typeof el !== 'string') return el;
  return document.querySelector(el) || document.getElementById(el) || document.querySelector(`[data-pins="${el}"]`);
}
window.pinBoxes = function (el, n = 4) {
  el = _pinEl(el); if (!el) return null;
  el.classList.add('pins'); el.dataset.pinbox = n;
  el.innerHTML = Array.from({ length: n }, (_, i) => `<input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="off" aria-label="PIN digit ${i + 1}" data-pi="${i}">`).join('');
  const ins = [...el.querySelectorAll('input')];
  const val = () => ins.map((i) => i.value).join('');
  const done = () => {
    const v = val(); if (v.length < n) return;
    if (typeof el.onComplete === 'function') return el.onComplete(v);
    const groups = [...document.querySelectorAll('[data-pinbox]')];
    const nx = groups.slice(groups.indexOf(el) + 1).find((g) => g.offsetParent !== null && [...g.querySelectorAll('input')].some((i) => !i.value));
    if (nx) nx.querySelector('input').focus();
  };
  const fill = (k, digits) => {
    digits.split('').slice(0, n - k).forEach((c, j) => { ins[k + j].value = c; });
    (ins[Math.min(k + digits.length, n) - 1] || ins[k]).focus();
    el.classList.remove('bad'); done();
  };
  ins.forEach((inp, k) => {
    inp.addEventListener('input', () => {
      const d = inp.value.replace(/\D/g, '');
      if (d.length > 1) { inp.value = ''; return fill(k, d); }   // autofill / IME
      inp.value = d; el.classList.remove('bad');
      if (d) { if (ins[k + 1]) ins[k + 1].focus(); else done(); }
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !inp.value && ins[k - 1]) { e.preventDefault(); ins[k - 1].value = ''; ins[k - 1].focus(); }
      else if (e.key === 'ArrowLeft' && ins[k - 1]) { e.preventDefault(); ins[k - 1].focus(); }
      else if (e.key === 'ArrowRight' && ins[k + 1]) { e.preventDefault(); ins[k + 1].focus(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (typeof el.onEnter === 'function') el.onEnter(val()); }
      else if (e.key.length === 1 && !/\d/.test(e.key) && !e.ctrlKey && !e.metaKey) e.preventDefault();
    });
    inp.addEventListener('paste', (e) => {
      const d = ((e.clipboardData || window.clipboardData).getData('text') || '').replace(/\D/g, '');
      e.preventDefault(); if (d) fill(k, d);
    });
    inp.addEventListener('focus', () => inp.select());
  });
  return el;
};
window.pinVal = function (el) { el = _pinEl(el); return el ? [...el.querySelectorAll('input')].map((i) => i.value).join('') : ''; };
window.pinClear = function (el, focus = true) {
  el = _pinEl(el); if (!el) return;
  const ins = [...el.querySelectorAll('input')]; ins.forEach((i) => { i.value = ''; });
  if (focus && ins[0]) ins[0].focus();
};
/* mark a PIN group as wrong (red + shake); clears it */
function pinBad(el) { el = _pinEl(el); if (!el) return; pinClear(el); el.classList.remove('bad'); void el.offsetWidth; el.classList.add('bad'); }

/* ---------- v5 dialog: modal(html) → the .md element; modal(html, onSubmit) = legacy v4 form dialog ----------
   opts: { persistent: true } (no backdrop / Esc close), { onClose() }, { cls: 'extra classes on .ov' } */
function modal(html, opts) {
  if (typeof opts === 'function') return legacyModal(html, opts);
  opts = opts || {};
  const ov = document.createElement('div');
  ov.className = 'ov' + (opts.cls ? ' ' + opts.cls : '');
  ov.innerHTML = `<div class="md" role="dialog" aria-modal="true">${html}</div>`;
  ov._opts = opts;
  ov.addEventListener('click', (e) => {
    if ((e.target === ov && !opts.persistent) || e.target.closest('[data-close]')) closeModal(ov);
  });
  document.body.appendChild(ov);
  const md = ov.firstElementChild;
  md.close = () => closeModal(ov);
  const f = md.querySelector('input:not([type=hidden]),select,textarea');
  if (f) setTimeout(() => f.focus(), 30);
  return md;
}
function closeModal(el) {
  const list = el ? [el.closest ? el.closest('.ov') : null].filter(Boolean) : [...document.querySelectorAll('.ov:not(.idle)')];
  list.forEach((ov) => { ov.remove(); if (ov._opts && typeof ov._opts.onClose === 'function') ov._opts.onClose(); });
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const all = [...document.querySelectorAll('.ov')]; const top = all[all.length - 1];
  if (top && !(top._opts && top._opts.persistent)) closeModal(top);
});

/* ---------- Change PIN (current + new + confirm, as PIN boxes) ---------- */
function changePinModal(me) {
  me = me || Session.get() || {};
  if (me.view_by) return toast(errText('READ_ONLY'));
  const md = modal(`<h3>${esc(t('changePin'))}</h3>
    <div class="pinrow"><span>${esc(t('curPin'))}</span><div data-cp="o"></div></div>
    <div class="pinrow"><span>${esc(t('newPin'))}</span><div data-cp="n"></div></div>
    <div class="pinrow"><span>${esc(t('confirmPin'))}</span><div data-cp="n2"></div></div>
    <div class="note r" data-cp="err" hidden></div>
    <div class="mx"><button type="button" class="btn s" data-close>${esc(t('back').replace(/^←\s*/, '')) || 'Cancel'}</button><button type="button" class="btn" data-cp="go">${esc(t('changePin'))}</button></div>`);
  const q = (k) => md.querySelector(`[data-cp="${k}"]`);
  ['o', 'n', 'n2'].forEach((k) => { pinBoxes(q(k)); q(k).onEnter = () => q('go').click(); });
  q('n2').onComplete = () => q('go').focus();
  const bad = (m, k) => { q('err').hidden = false; q('err').textContent = m; if (k) pinBad(q(k)); };
  q('go').addEventListener('click', async () => {
    const o = pinVal(q('o')), n = pinVal(q('n')), n2 = pinVal(q('n2'));
    if (o.length < 4) return bad(t('enterPin'), 'o');
    if (n.length < 4) return bad(t('newPin'), 'n');
    if (n !== n2) return bad(t('pinMismatch'), 'n2');
    q('go').disabled = true;
    const r = await rpc('change_pin', { p_token: me.token || Session.token(), p_old: o, p_new: n });
    q('go').disabled = false;
    if (!r || !r.ok) {
      const e = r && r.error;
      return bad(errText(e), e === 'WRONG_OLD_PIN' ? 'o' : e === 'WEAK_PIN' ? 'n' : null);
    }
    md.close(); toast(t('pinChanged'));
  });
  return md;
}

/* ---------- idle auto-logout ----------
   Idle.start({ minutes, onLogout, warn = 60 }) — minutes from Settings (idle_store_min / idle_other_min).
   Activity = mouse / key / touch / scroll / wheel, shared across tabs. In the last `warn` seconds a
   "Still there?" dialog counts down; then auth_logout + Session.clear(), then onLogout() if given,
   else a "Logged out" screen with a button to index.html?r=idle. minutes ≤ 0 / empty = off. */
const Idle = {
  _t: null, _last: 0, _limit: 0, _warn: 60000, _opts: null, _ov: null, _seen: 0,
  _evs: ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'],
  _on() {
    if (Idle._ov) return;   // while warning: only the buttons count
    const now = Date.now(); Idle._last = now;
    if (now - Idle._seen > 5000) { Idle._seen = now; try { localStorage.setItem('3pa_last_act', String(now)); } catch (e) {} }
  },
  start(o = {}) {
    this.stop();
    const m = Number(o.minutes);
    if (window.__noIdle || !m || m <= 0) return false;   // no_idle users (users.no_idle) never auto-logout
    this._opts = o; this._limit = m * 60000;
    this._warn = Math.max(1000, Math.min((o.warn == null ? 60 : o.warn) * 1000, this._limit - 3000));
    this._last = Date.now();
    this._evs.forEach((ev) => document.addEventListener(ev, this._on, { passive: true, capture: true }));
    this._t = setInterval(() => this._tick(), 1000);
    return true;
  },
  stop() {
    clearInterval(this._t); this._t = null;
    this._evs.forEach((ev) => document.removeEventListener(ev, this._on, { capture: true }));
    this._hide();
  },
  reset() { this._hide(); this._last = Date.now(); this._seen = 0; this._on(); },
  _hide() { if (this._ov) { this._ov.remove(); this._ov = null; } },
  _tick() {
    let other = 0; try { other = Number(localStorage.getItem('3pa_last_act')) || 0; } catch (e) {}
    if (other > this._last && !this._ov) this._last = other;
    const left = this._limit - (Date.now() - this._last);
    if (left <= 0) return this.logout();
    if (left <= this._warn) this._show(Math.ceil(left / 1000));
  },
  _show(sec) {
    if (this._ov) { const c = this._ov.querySelector('[data-idle="n"]'); if (c) c.textContent = sec; return; }
    const md = modal(`<h3>${esc(t('idleTitle'))}</h3><div class="sub" style="font-size:13px">${esc(t('idleBody', { n: '\u0000' })).replace('\u0000', `<b data-idle="n">${sec}</b>`)}</div>
      <div class="mx"><button type="button" class="btn s" data-idle="out">${esc(t('idleOut'))}</button><button type="button" class="btn" data-idle="stay">${esc(t('idleStay'))}</button></div>`, { persistent: true, cls: 'idle' });
    this._ov = md.parentElement;
    md.querySelector('[data-idle="stay"]').addEventListener('click', () => this.reset());
    md.querySelector('[data-idle="out"]').addEventListener('click', () => this.logout());
    md.querySelector('[data-idle="stay"]').focus();
  },
  async logout() {
    const o = this._opts || {};
    this.stop();
    closeModal();
    const tok = Session.token();
    if (tok) {
      try {
        await fetch(`${CONFIG.url}/rest/v1/rpc/auth_logout`, { method: 'POST',
          headers: { apikey: CONFIG.key, Authorization: `Bearer ${CONFIG.key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_token: tok }) });
      } catch (e) { /* offline: the session times out on the server anyway */ }
    }
    Session.clear();
    if (typeof o.onLogout === 'function') return o.onLogout();
    document.body.innerHTML = `<div class="lgbg"><div class="lgc"><h1>${esc(t('loggedOut'))}</h1><div class="sb" style="margin:0">${esc(t('loggedOutWhy'))}</div>
      <a class="btn" href="index.html?r=idle">${esc(t('loginAgain'))}</a><p class="credit">${credit()}</p></div></div>`;
  },
};

/* ---------- shared bits of the two shells ---------- */
function _shellWho(me, o) {
  const name = o.name || (me.role === 'store' ? `${me.post || t('roleStore')} · ${me.name || ''}` : `${roleLabel(me.role)} · ${me.name || ''}`);
  const scope = o.scope || me.scope || (me.role === 'store' ? `${me.store_code || ''}${me.store_name ? ' · ' + me.store_name : ''}`
    : me.role === 'hodept' ? `${me.dept || ''}` : me.emp || me.email || '');
  return { name, scope };
}
function _shellActions(rootEl, me) {
  rootEl.addEventListener('change', (e) => { const s = e.target.closest('[data-sh="theme"]'); if (s) Theme.set(s.value); });
  rootEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sh]'); if (!b) return;
    const k = b.dataset.sh;
    if (k === 'dark') Theme.toggleDark();
    else if (k === 'pin') changePinModal(me);
    else if (k === 'out') { Idle.stop(); logout(); }
  });
  const sync = () => {
    rootEl.querySelectorAll('[data-sh="dark"]').forEach((b) => { b.textContent = Theme.isDark() ? t('light') : t('dark'); });
    rootEl.querySelectorAll('[data-sh="theme"]').forEach((s) => { s.value = Theme.pal(); });
  };
  document.addEventListener('themechange', sync);
  return sync;
}

/* ---------- desktop shell: sidebar (brand, nav, Admin group, user block) + sticky bar + .wrap ----------
   appShell(root, { me, nav: [[id, label, icon, badge]], adminNav: [...], active, onNav(id), title, scope, name })
   → { shell, side, main, bar, wrap, setActive(id), setBadge(id, n), setTitle(title) }
   ≤760px the sidebar becomes a top icon row (CSS). The bar starts with a crumb "scope › title";
   pages may replace bar.innerHTML (keep a .crumb first) with their filters. */
function appShell(root, o = {}) {
  root = _pinEl(root) || document.body;
  const me = o.me || {}, who = _shellWho(me, o);
  let active = o.active;
  const btn = (x) => `<button type="button" class="nav${x[0] === active ? ' on' : ''}" data-nav="${esc(x[0])}" title="${esc(x[1])}">${icon(x[2] || x[0])}<span class="lbl2">${esc(x[1])}</span>${x[3] ? `<span class="bd">${esc(x[3])}</span>` : ''}</button>`;
  const nav = o.nav || [], adm = o.adminNav || [];
  root.innerHTML = `<div class="shell"><aside class="side noprint">
    <div class="brand"><span class="lg"><img src="assets/logo.png" alt="VMM"></span><div><b>3rd Party Attendance</b><small>Control Tower</small></div></div>
    ${nav.map(btn).join('')}${adm.length ? `<div class="grp">Admin</div>${adm.map(btn).join('')}` : ''}
    <div class="who"><b>${esc(who.name)}</b><span>${esc(who.scope)}</span><br><select data-sh="theme" class="wsel" title="${esc(t('theme'))}" aria-label="${esc(t('theme'))}">${Theme.options()}</select><br><button type="button" data-sh="dark"></button> <button type="button" data-sh="pin">${esc(t('changePin'))}</button> <button type="button" data-sh="out">${esc(t('logout'))}</button></div>
  </aside><main class="shmain"><div class="bar noprint"><span class="crumb">${esc(who.scope)} › <b data-sh-title>${esc(o.title || '')}</b></span></div><div class="wrap"></div><p class="foot noprint">${credit()}</p></main></div>`;
  const shell = root.querySelector('.shell'), side = shell.querySelector('.side'), main = shell.querySelector('main');
  const api = {
    shell, side, main, bar: main.querySelector('.bar'), wrap: main.querySelector('.wrap'),
    setActive(id) { active = id; side.querySelectorAll('[data-nav]').forEach((b) => b.classList.toggle('on', b.dataset.nav === id)); },
    setBadge(id, n) {
      const b = side.querySelector(`[data-nav="${CSS.escape(id)}"]`); if (!b) return;
      let s = b.querySelector('.bd'); if (!n) { if (s) s.remove(); return; }
      if (!s) { s = document.createElement('span'); s.className = 'bd'; b.appendChild(s); } s.textContent = n;
    },
    setTitle(title) { const e = api.bar.querySelector('[data-sh-title]'); if (e) e.textContent = title; if (title) document.title = `${title} · 3rd Party Attendance`; },
  };
  side.addEventListener('click', (e) => {
    const b = e.target.closest('[data-nav]'); if (!b) return;
    api.setActive(b.dataset.nav); if (o.onNav) o.onNav(b.dataset.nav);
  });
  _shellActions(side, me)();
  if (o.title) api.setTitle(o.title);
  return api;
}

/* ---------- phone-app shell (store logins, any screen size) ----------
   mobileShell(root, { me, tabs: [[id, label, icon, dot]], active, onNav(id), title, head, sub })
   → { app, header, wrap, bar, setActive(id), setDot(id, on), setBadge(id, n), setTitle(title) }
   Header "store_code · store_name" / "post name · title", ☰ menu (theme, dark, Change PIN, Logout),
   bottom tab bar (amber .mdot when dot is truthy). `bar` is a hidden .bar for pages that want one. */
function mobileShell(root, o = {}) {
  root = _pinEl(root) || document.body;
  const me = o.me || {};
  let active = o.active;
  const tabs = o.tabs || [];
  const head = o.head || `${me.store_code || ''}${me.store_name ? ' · ' + me.store_name : ''}` || me.name || '';
  const sub = o.sub || `${me.post || roleLabel(me.role)} ${me.name || ''}`.trim();
  root.innerHTML = `<div class="mapp"><header class="mhd noprint"><div class="mt"><b>${esc(head)}</b><small>${esc(sub)} · <span data-sh-title>${esc(o.title || '')}</span></small></div>
    <button type="button" data-sh="menu" aria-label="${esc(t('menu'))}" aria-expanded="false">☰</button></header>
    <div class="mmenu noprint" hidden><select data-sh="theme" aria-label="${esc(t('theme'))}">${Theme.options()}</select><button type="button" class="btn ghost sm" data-sh="dark"></button><button type="button" class="btn ghost sm" data-sh="pin">${esc(t('changePin'))}</button><button type="button" class="btn ghost sm" data-sh="out">${esc(t('logout'))}</button></div>
    <div class="bar noprint" hidden></div><div class="wrap mob"></div><p class="foot noprint">${credit()}</p>
    <nav class="mtab noprint" style="--tabs:${tabs.length || 1}">${tabs.map(([id, l, ic, dot]) => `<button type="button" data-nav="${esc(id)}" class="${id === active ? 'on' : ''}">${icon(ic || id)}<span>${esc(l)}</span>${dot ? '<i class="mdot"></i>' : ''}</button>`).join('')}</nav></div>`;
  const app = root.querySelector('.mapp'), menu = app.querySelector('.mmenu'), mb = app.querySelector('[data-sh="menu"]');
  const api = {
    app, header: app.querySelector('.mhd'), wrap: app.querySelector('.wrap'), bar: app.querySelector('.bar'), menu,
    setActive(id) { active = id; app.querySelectorAll('.mtab [data-nav]').forEach((b) => b.classList.toggle('on', b.dataset.nav === id)); },
    setDot(id, on) {
      const b = app.querySelector(`.mtab [data-nav="${CSS.escape(id)}"]`); if (!b) return;
      const d = b.querySelector('.mdot'); if (on && !d) b.insertAdjacentHTML('beforeend', '<i class="mdot"></i>'); else if (!on && d) d.remove();
    },
    setBadge(id, n) {
      const b = app.querySelector(`.mtab [data-nav="${CSS.escape(id)}"]`); if (!b) return;
      let s = b.querySelector('.bd'); if (!n) { if (s) s.remove(); return; }
      if (!s) { s = document.createElement('span'); s.className = 'bd'; b.appendChild(s); } s.textContent = n;
    },
    setTitle(title) { const e = app.querySelector('[data-sh-title]'); if (e) e.textContent = title; if (title) document.title = `${title} · 3rd Party Attendance`; },
  };
  mb.addEventListener('click', () => { menu.hidden = !menu.hidden; mb.setAttribute('aria-expanded', String(!menu.hidden)); });
  app.querySelector('.mtab').addEventListener('click', (e) => {
    const b = e.target.closest('[data-nav]'); if (!b) return;
    menu.hidden = true; api.setActive(b.dataset.nav); window.scrollTo(0, 0); if (o.onNav) o.onNav(b.dataset.nav);
  });
  _shellActions(menu, me)();
  if (o.title) api.setTitle(o.title);
  return api;
}

/* ---------- v5.1: selfie viewer (📷 buttons anywhere: <button data-selfie="associateId|YYYY-MM-DD">) ---------- */
async function viewSelfie(assoc, date) {
  const m = modal(`<h3>Selfie · ${esc(fmtDate(date))}</h3><div class="sv" style="min-height:120px;display:flex;gap:12px;flex-wrap:wrap;justify-content:center;align-items:center;color:var(--mut)">Loading…</div><div class="acts" style="margin-top:12px;text-align:right"><button class="btn s sm" data-close>Close</button></div>`);
  const box = m && m.querySelector('.sv');
  const r = await photoFn({ action: 'view', session: Session.token(), associate: Number(assoc), date });
  if (!box) return;
  if (!r || !r.ok) { box.textContent = r && r.error === 'FORBIDDEN' ? 'Not allowed for this store.' : 'Could not load the photo. ' + esc((r && r.error) || ''); return; }
  const h = m.querySelector('h3'); if (h) h.textContent = `${r.name || ''} ${r.code ? '· ' + r.code : ''} · ${fmtDate(date)}`;
  const ph = (r.photos || []).filter((p) => p.url);
  box.innerHTML = ph.length ? ph.map((p) => `<figure style="margin:0;text-align:center"><a href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.url)}" alt="Selfie ${esc(p.kind)} ${esc(p.t)}" style="width:180px;height:240px;object-fit:cover;border-radius:10px;border:1px solid var(--line)"></a>
    <figcaption style="font-size:12px;margin-top:4px"><b>${esc(p.kind)}</b> ${esc(p.t)} ${p.live === 'pass' ? '<span class="tg ok">Live ✓</span>' : p.live === 'fail' || p.live === 'noface' ? '<span class="tg red">No face</span>' : ''}</figcaption></figure>`).join('')
    : 'No photo saved for this day (it may have been deleted after the retention period).';
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-selfie]'); if (!b) return;
  e.preventDefault(); const [a, d] = String(b.dataset.selfie).split('|'); if (a && d) viewSelfie(a, d);
});


/* ---------- v5.4: where a punch came from (shared by dashboard, pop-ups, store app) ---------- */
function punchSrc(o, short) {
  if (!o || !o.src) return '';
  if (o.src === 'store') return `<span class="tg acc" title="Punched from the store login">🏪 ${short ? 'Store' : 'Store phone'}${o.by ? ' · ' + esc(o.by) + (o.post ? ' (' + esc(o.post) + ')' : '') : ''}</span>`;
  if (o.src === 'cross') return `<span class="tg amb" title="Phone registered at another store, SM approved for the day">🔁 ${short ? 'Other store' : 'Other-store phone'}${o.home ? ' (' + esc(o.home) + ')' : ''}${o.appr ? ' · approved by ' + esc(o.appr) : ''}</span>`;
  const far = o.dist != null && o.dist > 500;
  return `<span class="tg ${far ? 'red' : 'info'}" title="Staff member's own phone · distance from the store">📱 ${short ? 'Own' : 'Own phone'}${o.dist != null ? ' · ' + esc(o.dist) + ' m' : ''}${far ? ' ⚠' : ''}</span>`;
}

/* ---------- v5.4: live punch alerts while the portal is open (pop-up + sound + tab count) ---------- */
const Live = {
  last: null, unseen: 0, base: '', opts: null, box: null, timer: null,
  sound() { try { return localStorage.getItem('3pa_sound') !== '0'; } catch (e) { return true; } },
  paused() { try { return localStorage.getItem('3pa_alerts') === '0'; } catch (e) { return false; } },
  set(k, v) { try { localStorage.setItem(k, v ? '1' : '0'); } catch (e) {} },
  start(me, opts = {}) {
    if (!me || !me.token || Session.isView() || this.timer) return;
    this.me = me; this.opts = opts; this.base = document.title.replace(/^\(\d+\)\s*/, '');
    this.box = document.createElement('div'); this.box.className = 'lvbox'; document.body.appendChild(this.box);
    if (opts.controls) this._controls();
    const clear = () => { if (this.unseen) { this.unseen = 0; this._title(); } };
    window.addEventListener('focus', clear); document.addEventListener('click', clear, true);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(clear, 1500); });
    // a click anywhere unlocks audio on browsers that block sound before the first tap
    document.addEventListener('click', () => { try { this._ctx = this._ctx || new (window.AudioContext || window.webkitAudioContext)(); this._ctx.resume(); } catch (e) {} }, { once: true, capture: true });
    this._poll(); this.timer = setInterval(() => this._poll(), opts.every || 15000);
  },
  async _poll() {
    const r = await rpc('punch_feed', { p_token: this.me.token, p_since: this.last, p_limit: 20 });
    if (!r || !r.ok) return;
    const first = this.last == null; this.last = r.last;
    if (first || !r.rows || !r.rows.length) return;
    if (this.opts.skip && this.opts.skip()) return;
    this.unseen += r.rows.length; this._title();
    if (this.paused()) return;
    r.rows.slice(-3).forEach((x) => this._toast(x));
    if (this.sound()) this.ding();
  },
  _title() { document.title = (this.unseen ? `(${this.unseen > 99 ? '99+' : this.unseen}) ` : '') + this.base; },
  ding() {
    try {
      const c = this._ctx || (this._ctx = new (window.AudioContext || window.webkitAudioContext)());
      [[880, 0], [1320, 0.13]].forEach(([f, t]) => { const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, c.currentTime + t); g.gain.exponentialRampToValueAtTime(0.25, c.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t + 0.35);
        o.connect(g); g.connect(c.destination); o.start(c.currentTime + t); o.stop(c.currentTime + t + 0.4); });
    } catch (e) {}
  },
  _toast(x) {
    const el = document.createElement('div'); el.className = 'lvt ' + (x.k === 'IN' ? 'in' : 'out');
    const showStore = this.opts.showStore !== false;
    el.innerHTML = `<span class="ic">🔔</span><div class="tx"><b>Punch ${esc(x.k)} · ${esc(x.name)}</b>
      <div class="s">${esc(x.cat || '')}${x.vendor ? ' · ' + esc(x.vendor) : ''}${showStore ? ` · <b>${esc(x.store)}${x.store_name ? ' ' + esc(x.store_name) : ''}</b>` : ''}</div>
      <div class="s">${x.t ? esc(x.t) : x.k === 'OUT' ? 'OUT ✓' : ''} ${punchSrc({ src: x.src, by: x.by_name, post: x.by_post, dist: x.dist, home: x.home })}</div></div><button type="button" class="x" aria-label="Close">✕</button>`;
    el.querySelector('.x').addEventListener('click', () => el.remove());
    this.box.prepend(el);
    while (this.box.children.length > 3) this.box.lastChild.remove();
    setTimeout(() => { el.classList.add('bye'); setTimeout(() => el.remove(), 400); }, 8000);
  },
  _controls() {
    const c = document.createElement('div'); c.className = 'lvctl';
    const paint = () => { c.innerHTML = `<button type="button" data-lv="a" title="Pop-ups for every punch">${this.paused() ? '🔕 Pop-ups OFF' : '🔔 Pop-ups ON'}</button><button type="button" data-lv="s" title="Sound">${this.sound() ? '🔊' : '🔇'}</button>`; };
    paint(); document.body.appendChild(c);
    c.addEventListener('click', (e) => { const b = e.target.closest('[data-lv]'); if (!b) return;
      if (b.dataset.lv === 'a') this.set('3pa_alerts', this.paused()); else this.set('3pa_sound', !this.sound());
      paint(); if (b.dataset.lv === 's' && this.sound()) this.ding(); });
  },
};
(function lvCss() {
  const st = document.createElement('style');
  st.textContent = `.lvbox{position:fixed;top:12px;right:12px;z-index:9000;display:flex;flex-direction:column;gap:8px;width:min(360px,calc(100vw - 24px));pointer-events:none}
  .lvt{pointer-events:auto;background:var(--card,#fff);color:var(--ink,#1A2130);border:1px solid var(--line,#E2E6EC);border-radius:12px;box-shadow:0 12px 30px rgba(15,23,42,.28);padding:10px 12px;display:flex;gap:10px;align-items:flex-start;animation:lvin .25s ease-out}
  .lvt .ic{width:34px;height:34px;flex:none;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--ok-l,#E9F5EC)}.lvt.out .ic{background:var(--red-l,#FDEDEC)}
  .lvt .tx{flex:1;min-width:0;font-size:13px}.lvt .s{font-size:12px;color:var(--mut,#5A6472);margin-top:2px}.lvt .x{border:0;background:none;color:var(--mut);font-size:15px;padding:0 2px}
  .lvt.bye{opacity:0;transform:translateX(30px);transition:.35s}
  .lvctl{position:fixed;right:12px;bottom:12px;z-index:8999;display:flex;gap:6px}.lvctl button{border:1px solid var(--line,#E2E6EC);background:var(--card,#fff);color:var(--ink);border-radius:999px;padding:6px 12px;font-size:12px;box-shadow:0 4px 12px rgba(15,23,42,.12)}
  @keyframes lvin{from{opacity:0;transform:translateY(-8px)}}
  @media(max-width:760px){.lvbox{top:62px;right:8px;left:8px;width:auto}.lvctl{bottom:70px}}`;
  document.head.appendChild(st);
})();

/* ---------- v5.4: phone push alerts for store management (consent + login once; stops on manual logout) ---------- */
/* v5.5: reason options for a 1–2 ★ rating: 5 per dept + Other (Other = type the reason) */
const RATING_REASONS = {
  HK: ['Late / absent from area', 'Work not done properly', 'Left work area without info', 'Uniform / ID not worn', 'Behaviour with staff or guest', 'Other'],
  SEC: ['Late', 'Not at post', 'Left post without info', 'Uniform / ID not worn', 'Mobile use on duty', 'Other'],
  TRAVEL: ['Late', 'Not at counter', 'Not following brand script', 'Uniform / appearance', 'Customer complaint', 'Other'],
  CDIT: ['Late', 'Not at counter', 'Product knowledge weak', 'Uniform / appearance', 'Customer complaint', 'Other'],
};
const reasonsFor = (c) => RATING_REASONS[c] || ['Late', 'Not at post', 'Behaviour', 'Uniform', 'Other'];

const Push = {
  supported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; },
  iosNeedsInstall() { return /iPhone|iPad|iPod/.test(navigator.userAgent) && !(window.navigator.standalone || matchMedia('(display-mode: standalone)').matches); },
  async _reg() { return navigator.serviceWorker.register('sw.js'); },
  async state() {
    if (!this.supported()) return this.iosNeedsInstall() ? 'ios' : 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    try { const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); return sub && Notification.permission === 'granted' ? 'on' : 'off'; } catch (e) { return 'off'; }
  },
  _key(b64) { const p = '='.repeat((4 - (b64.length % 4)) % 4), raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); },
  async enable(me) {
    if (!this.supported()) return { ok: false, error: this.iosNeedsInstall() ? 'IOS_INSTALL' : 'UNSUPPORTED' };
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, error: 'DENIED' };
    const reg = await this._reg(); await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: this._key(CONFIG.vapid) });
    return rpc('push_subscribe', { p_token: me.token, p_sub: sub.toJSON(), p_ua: navigator.userAgent.slice(0, 200) });
  },
  async disable(token) {
    if (!this.supported()) return;
    const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription();
    if (!sub) return;
    const ep = sub.endpoint; try { await sub.unsubscribe(); } catch (e) {}
    await rpc('push_unsubscribe', { p_token: token, p_endpoint: ep });
  },
};
