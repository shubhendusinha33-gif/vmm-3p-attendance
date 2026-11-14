/* VMM 3rd Party Attendance — shared helpers (v1)
   The only file to edit when moving to another Supabase project: CONFIG below. */
const CONFIG = {
  url: 'https://phyllziizajuphenpwxz.supabase.co',
  key: 'sb_publishable_KRASYzbWRPYoKzJItq-Gqw_zLwUvnX-',
  version: 'v2',
  policy: '2026-11-v1',   // bump when the privacy text changes: everyone is asked again
};

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
const Session = {
  get() { return store.get('vmm3p_session'); },
  set(s) { store.set('vmm3p_session', s); },
  clear() { store.del('vmm3p_session'); },
  token() { const s = store.get('vmm3p_session'); return s ? s.token : null; },
};
function deviceId() {
  let d = store.get('vmm3p_device');
  if (!d) { d = 'd' + Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('vmm3p_device', d); }
  return d;
}
function homeFor(role) {
  return { store: 'store.html', am: 'manage.html', zfm: 'manage.html', hodept: 'manage.html', admin: 'admin.html' }[role] || 'index.html';
}
function goLogin(reason) { location.href = 'index.html' + (reason ? `?r=${reason}` : ''); }
async function requireSession(roles) {
  const s = Session.get();
  if (!s || !s.token) { goLogin(); return null; }
  const me = await rpc('auth_me', { p_token: s.token });
  if (!me || !me.ok) { Session.clear(); goLogin('expired'); return null; }
  if (roles && !roles.includes(me.role)) { location.href = homeFor(me.role); return null; }
  Session.set({ ...s, ...me, token: s.token });
  return { ...me, token: s.token };
}
async function logout() {
  const t = Session.token();
  if (t) await rpc('auth_logout', { p_token: t });
  Session.clear();
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
    stepDetails: 'Your details', stepPin: 'PIN', empCode: 'Enter your Emp Code', empHint: 'min 5 digits',
    post: 'Post', storeCode: 'Store Code', storeHint: '2 letters + 2 digits (e.g. AA01)', department: 'Department', selectDept: '— Select department —',
    next: 'Next →', login: 'Login →', welcome: 'Welcome', verified: 'Emp Code verified ✓', enterPin: 'Enter your 4-digit PIN',
    forgotPin: 'Forgot PIN? Ask your ZFM or HO Admin to reset it.', back: '← Back',
    createPin: 'Create your PIN', answerQ: 'Answer this question', newPin: 'New PIN (4 digits)', confirmPin: 'Confirm PIN', savePin: 'Save PIN',
    pinSaved: 'PIN saved. Please log in.', wrongAnswer: 'Wrong answer. Try the new question.', pinMismatch: 'The two PINs do not match.',
    loginLocked: 'Login locked', lockedWhy: 'Wrong PIN entered too many times.', tryAfter: 'Try again after this time',
    storeOpen: 'is already open', openOnPhone: 'The portal is open on {name}\'s phone (Emp {emp}) since {since}.',
    askLogout: 'Ask them to log out. If they are inactive, the store unlocks automatically around {at}.', checkAgain: 'Check again',
    notFound: 'No user found with these details. Check Emp Code, Post and Store Code.', wrongPin: 'Wrong PIN. {n} tries left.',
    network: 'No internet connection. Try again.', sessionExpired: 'You were logged out. Please log in again.',
    logout: 'Logout', today: 'Today', pickDate: 'Pick date', mtd: '1st – Today', morning: 'Morning', evening: 'Evening', both: 'Both',
    notPunched: '{n} not punched yet', allPunched: 'Everyone has punched in', present: 'Present', missing: 'Missing',
    emptySlots: 'Empty slots (as per master)', regularsMissing: 'Regulars not here today', cameDays: 'came {n} of last 7 days',
    absentQ: 'Absent?', shareWa: 'Share on WhatsApp', punchForStaff: '+ Punch for staff (MOD)', qrPoster: 'Download store QR poster',
    statement: 'Monthly statement', compOff: 'Comp-off', markCompOff: 'Mark comp-off', moreDetails: 'details',
    punchIn: 'Punch IN', punchOut: 'Punch OUT', punchTitle: 'Punch', vendor: 'Vendor', selectVendor: 'Select vendor', otherVendor: '+ Other vendor',
    brand: 'Brand', yourName: 'Your name', nameHint: 'Full name', getLocation: 'Checking your location…',
    insideStore: 'Inside store ({d} m)', locFound: 'Location found (±{a} m)', outside: 'You are {d} m away. Punch only inside the store ({r} m).', noGps: 'Turn on location (GPS) and allow it for this site.',
    testMode: 'Test mode: location not checked', alreadyReg: 'Code: {code} (already registered)', newReg: 'New name: a code will be created',
    photoToday: 'Your photo will be taken today', photoHint: 'Tap the button and take a clear selfie', takePhoto: 'Take photo',
    punchDone: 'Punch recorded', nextPunch: 'Next punch', photoSaved: 'Photo saved', photoFailed: 'Photo not saved, try again',
    duplicate: 'You just punched. Wait 2 minutes.', badName: 'Write your name in letters only (2–40).', brandRequired: 'Select your brand.',
    noPhone: 'No phone? Ask the MOD to punch for you from the store login.', fromQr: '(from QR)', modMode: 'MOD phone',
    associate: 'Associate', selectAssociate: 'Pick associate', newName: '+ New name', chooseCat: 'Choose department',
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
    retake: 'Retake', usePhoto: 'Use this photo', outsideLogin: 'You are {d} m from the store. Store login works only inside the store ({r} m).',
  },
  hi: {
    appTitle: '3rd Party हाज़िरी', appSub: 'VMM Central Ops & BI',
    roleStore: 'स्टोर', roleAm: 'AM', roleZfm: 'ZFM', roleHodept: 'HO विभाग', roleAdmin: 'एडमिन',
    stepDetails: 'आपकी जानकारी', stepPin: 'PIN', empCode: 'अपना Emp Code डालें', empHint: 'कम से कम 5 अंक',
    post: 'पद', storeCode: 'स्टोर कोड', storeHint: '2 अक्षर + 2 अंक (जैसे AA01)', department: 'विभाग', selectDept: '— विभाग चुनें —',
    next: 'आगे →', login: 'लॉगिन →', welcome: 'स्वागत है', verified: 'Emp Code सही है ✓', enterPin: 'अपना 4 अंकों का PIN डालें',
    forgotPin: 'PIN भूल गए? ZFM या HO एडमिन से रीसेट करवाएं।', back: '← पीछे',
    createPin: 'अपना PIN बनाएं', answerQ: 'इस सवाल का जवाब दें', newPin: 'नया PIN (4 अंक)', confirmPin: 'PIN दोबारा डालें', savePin: 'PIN सेव करें',
    pinSaved: 'PIN सेव हो गया। अब लॉगिन करें।', wrongAnswer: 'जवाब गलत है। नया सवाल हल करें।', pinMismatch: 'दोनों PIN एक जैसे नहीं हैं।',
    loginLocked: 'लॉगिन बंद है', lockedWhy: 'कई बार गलत PIN डाला गया।', tryAfter: 'इतने समय बाद दोबारा कोशिश करें',
    storeOpen: 'पहले से खुला है', openOnPhone: 'पोर्टल {name} के फ़ोन पर (Emp {emp}) {since} से खुला है।',
    askLogout: 'उनसे लॉगआउट करवाएं। वे इस्तेमाल न करें तो स्टोर लगभग {at} बजे अपने आप खुल जाएगा।', checkAgain: 'दोबारा जांचें',
    notFound: 'इस जानकारी से कोई यूज़र नहीं मिला। Emp Code, पद और स्टोर कोड जांचें।', wrongPin: 'गलत PIN। {n} कोशिश बाकी।',
    network: 'इंटरनेट नहीं है। दोबारा कोशिश करें।', sessionExpired: 'आप लॉगआउट हो गए। दोबारा लॉगिन करें।',
    logout: 'लॉगआउट', today: 'आज', pickDate: 'तारीख चुनें', mtd: '1 से आज तक', morning: 'सुबह', evening: 'शाम', both: 'दोनों',
    notPunched: '{n} ने अभी पंच नहीं किया', allPunched: 'सबने पंच कर लिया', present: 'मौजूद', missing: 'नहीं आया',
    emptySlots: 'खाली जगह (मास्टर के अनुसार)', regularsMissing: 'रोज़ आने वाले जो आज नहीं आए', cameDays: 'पिछले 7 में से {n} दिन आए',
    absentQ: 'गैरहाज़िर?', shareWa: 'WhatsApp पर भेजें', punchForStaff: '+ स्टाफ़ का पंच करें (MOD)', qrPoster: 'स्टोर QR पोस्टर डाउनलोड करें',
    statement: 'मासिक स्टेटमेंट', compOff: 'कॉम्प-ऑफ़', markCompOff: 'कॉम्प-ऑफ़ लगाएं', moreDetails: 'विवरण',
    punchIn: 'पंच IN', punchOut: 'पंच OUT', punchTitle: 'पंच', vendor: 'वेंडर', selectVendor: 'वेंडर चुनें', otherVendor: '+ दूसरा वेंडर',
    brand: 'ब्रांड', yourName: 'आपका नाम', nameHint: 'पूरा नाम', getLocation: 'आपकी लोकेशन देखी जा रही है…',
    insideStore: 'स्टोर के अंदर ({d} m)', locFound: 'लोकेशन मिल गई (±{a} m)', outside: 'आप {d} m दूर हैं। पंच सिर्फ़ स्टोर के अंदर ({r} m) होगा।', noGps: 'लोकेशन (GPS) चालू करें और इस साइट को अनुमति दें।',
    testMode: 'टेस्ट मोड: लोकेशन नहीं जांची जा रही', alreadyReg: 'कोड: {code} (पहले से रजिस्टर)', newReg: 'नया नाम: कोड अपने आप बनेगा',
    photoToday: 'आज आपकी फ़ोटो ली जाएगी', photoHint: 'बटन दबाएं और साफ़ सेल्फ़ी लें', takePhoto: 'फ़ोटो लें',
    punchDone: 'पंच हो गया', nextPunch: 'अगला पंच', photoSaved: 'फ़ोटो सेव हो गई', photoFailed: 'फ़ोटो सेव नहीं हुई, दोबारा लें',
    duplicate: 'आपने अभी पंच किया है। 2 मिनट रुकें।', badName: 'नाम सिर्फ़ अक्षरों में लिखें (2–40)।', brandRequired: 'अपना ब्रांड चुनें।',
    noPhone: 'फ़ोन नहीं है? MOD से स्टोर लॉगिन से पंच करवाएं।', fromQr: '(QR से)', modMode: 'MOD का फ़ोन',
    associate: 'कर्मचारी', selectAssociate: 'कर्मचारी चुनें', newName: '+ नया नाम', chooseCat: 'विभाग चुनें',
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
    retake: 'दोबारा लें', usePhoto: 'यह फ़ोटो भेजें', outsideLogin: 'आप स्टोर से {d} m दूर हैं। स्टोर लॉगिन सिर्फ़ स्टोर के अंदर ({r} m) होगा।',
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
    DUPLICATE: t('duplicate'), BAD_NAME: t('badName'), BRAND_REQUIRED: t('brandRequired'), CONSENT_REQUIRED: t('consentRequired'), NO_GPS: t('noGps') })[e] || String(e || 'Error');
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

/* ---------- excel helpers (SheetJS loaded per page) ---------- */
function downloadXlsx(rows, name, sheet = 'Sheet1') {
  const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet); XLSX.writeFile(wb, name);
}
async function readXlsx(file) {
  const buf = await file.arrayBuffer(); const wb = XLSX.read(buf, { type: 'array' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
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
function consentKey(kind) { return `vmm3p_consent_${kind}_${CONFIG.policy}`; }
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
