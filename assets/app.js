/* VMM 3rd Party Attendance — shared helpers (v4)
   The only file to edit when moving to another Supabase project: CONFIG below. */
const CONFIG = {
  url: 'https://phyllziizajuphenpwxz.supabase.co',
  key: 'sb_publishable_KRASYzbWRPYoKzJItq-Gqw_zLwUvnX-',
  version: 'v4',
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
  if (me.view_by) viewBanner(me);
  return { ...me, token: s.token };
}
function viewBanner(me) {
  if ($('#viewBar')) return;
  document.body.insertAdjacentHTML('afterbegin', `<div id="viewBar" class="viewbar noprint">👁 Viewing as <b>${esc(me.name)}</b> (${esc(me.post || me.role)}${me.store_code ? ' · ' + esc(me.store_code) : ''}) · read-only<button type="button" id="viewExit">Exit view</button></div>`);
  $('#viewExit').addEventListener('click', logout);
}
async function logout() {
  const t = Session.token(), view = Session.isView();
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
    stepDetails: 'Your details', stepPin: 'PIN', empCode: 'Enter your Emp Code', empHint: 'min 5 digits',
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
    noPhone: 'No phone? Ask SM / ASM / DM to punch for you from the store login.', fromQr: '(from QR)', modMode: 'Store phone',
    associate: 'Associate', notYou: 'Not you?', otherPhone: 'This name is linked to another phone. Ask your SM / ASM / DM to punch for you.', phoneInUse: 'This phone is already used by another person. Ask your SM / ASM / DM to punch for you.', selectAssociate: 'Pick associate', newName: '+ New name', chooseCat: 'Choose department',
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
    noPhone: 'फ़ोन नहीं है? SM / ASM / DM से स्टोर लॉगिन से पंच करवाएं।', fromQr: '(QR से)', modMode: 'स्टोर का फ़ोन',
    associate: 'कर्मचारी', notYou: 'आप नहीं हैं?', otherPhone: 'यह नाम किसी दूसरे फ़ोन से जुड़ा है। SM / ASM / DM से पंच करवाएं।', phoneInUse: 'यह फ़ोन पहले से किसी और के लिए इस्तेमाल हुआ है। SM / ASM / DM से पंच करवाएं।', selectAssociate: 'कर्मचारी चुनें', newName: '+ नया नाम', chooseCat: 'विभाग चुनें',
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
    EMP_ELSEWHERE: t('empElsewhere', { where: '—' }), ALREADY_DECIDED: 'Already decided by someone else.', DUPLICATE_NAME: 'Another associate in this store already has this name.', ADMIN_PROTECTED: 'Admin PIN cannot be reset here. Admin changes it with Change PIN.', FORBIDDEN: t('forbidden') })[e] || String(e || 'Error');
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

/* ---------- v3: change own PIN (old + new) ---------- */
function changePinDialog(me) {
  if (me.view_by) return toast(errText('READ_ONLY'));
  const el = document.createElement('div'); el.className = 'dlg';
  el.innerHTML = `<form class="box"><h3>${t('changePin')}</h3>
    <label class="lbl">${t('curPin')}<input class="in" type="password" inputmode="numeric" maxlength="4" autocomplete="current-password" id="cpOld"></label>
    <label class="lbl">${t('newPin')}<input class="in" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" id="cpNew"></label>
    <label class="lbl">${t('confirmPin')}<input class="in" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" id="cpNew2"></label>
    <div class="note r" id="cpErr" hidden></div>
    <div class="row"><button type="button" class="btn o" id="cpCancel" style="flex:1">✕</button><button class="btn" id="cpSave" style="flex:2">${t('changePin')}</button></div></form>`;
  document.body.appendChild(el);
  const f = (id) => el.querySelector('#' + id);
  const bad = (m) => { f('cpErr').hidden = false; f('cpErr').textContent = m; };
  el.querySelectorAll('input').forEach((i) => i.addEventListener('input', () => { i.value = i.value.replace(/\D/g, '').slice(0, 4); }));
  f('cpCancel').onclick = () => el.remove();
  f('cpOld').focus();
  el.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const o = f('cpOld').value, n = f('cpNew').value;
    if (!/^\d{4}$/.test(o) || !/^\d{4}$/.test(n)) return bad(t('enterPin'));
    if (n !== f('cpNew2').value) return bad(t('pinMismatch'));
    f('cpSave').disabled = true;
    const r = await rpc('change_pin', { p_token: me.token, p_old: o, p_new: n });
    f('cpSave').disabled = false;
    if (!r || !r.ok) return bad(errText(r && r.error));
    el.remove(); toast(t('pinChanged'));
  });
}

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

/* simple modal: returns a Promise resolving to form values or null */
function modal(html, onSubmit) {
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
