/* VMM 3rd Party Attendance — store login "phone app" helpers (v5), shared by store.html + statement.html.
   Load after assets/app.js.
     storeShell(root, me, active, { onNav, onLang, checkHk }) → mobileShell api
       Tabs: Today · Punch · HK split · Requests · Statement · QR. Statement → statement.html, QR → qr.html,
       others → onNav(id) when given (store.html), else store.html#id. Adds EN/हिंदी to the ☰ menu.
       checkHk (default true) calls hk_split_get and shows the amber dot on HK split when not set.
     SG_TAG(st)  status-only tag for a Security guard (P / H / A / MP / P* / IN) — never times. */
Object.assign(I18N.en, {
  tabToday: 'Today', tabPunch: 'Punch', tabHk: 'HK split', tabReq: 'Requests', tabStm: 'Statement', tabQr: 'QR',
  live: 'Live', endOfDay: 'End of day', required: 'Required', notPunchedK: 'Not punched', monthToDate: 'Month to date',
  hkNotSet: 'HK split not entered. Admin set HK total = {n}.', hkEnter: 'Enter Morning / Evening split',
  statusOnly: 'status only', hrSet: '{n}-hr set', notPunchedN: '{n} not punched', notOnDuty: '{n} not on duty',
  punchedByStore: 'punched by store', stillIn: 'still in', liveOk: '📷 Live ✓', extra: '+{n} extra',
  sgP: 'P', sgH: 'H · half day', sgA: 'A', sgMP: 'MP · with RLPO', sgPs: 'P* · RLPO exception', sgIN: 'IN · on duty',
  misPunchReq: 'Mis-punch → RLPO', compoffShort: 'Comp-off',
  punchForStaffT: 'Punch for staff', punchHelp: 'For staff without a phone. Counts as “punched by store” and is shown to the AM.',
  openPunch: '+ Punch for staff (no phone)', whoIn: 'Who is in now', byStoreToday: 'Punched by store today', noneYet: 'None yet',
  lastPunch: 'last punch', notToday: 'not punched today',
  hkTitle: 'HK split', hkHelp: 'Admin uploads only the total Housekeeping count for your store. You decide how many come in the Morning and how many in the Evening. Morning + Evening must equal the total.',
  hkTotal: 'HK total (from Admin)', hkVendor: 'Vendor', effFrom: 'Effective from', saveSplit: 'Save split', hkCurrent: 'Current: Morning {m} + Evening {e} = {t}',
  hkNotYet: 'Not entered yet · your store shows in “HK split not set” on AM / Admin dashboards', hkSum: 'Morning + Evening = {s} of {t}',
  hkNoTotal: 'No Housekeeping total is set for your store yet. Ask Admin (Manpower Master → HK).', hkSaved: 'HK split saved',
  hkHistory: 'History', setBy: 'Set by', sumMismatch: 'Morning + Evening must equal the HK total ({t}).',
  reqTitle: 'Requests', reqHelp: 'Comp-off and staff detail changes go to your AM. Security mis-punch / time edits go to the RLPO.',
  reqType: 'Type', staff: 'Staff', date: 'Date', reason: 'Reason', send: 'Send', pickStaff: '— Select staff —',
  kCompoff: 'Comp-off', kStaff: 'Staff detail change', kSgMis: 'SG mis-punch (to RLPO)', kSgEdit: 'SG time edit (to RLPO)',
  missingPunch: 'Missing punch', actualIn: 'Actual IN', actualOut: 'Actual OUT', toAm: 'To AM', toRlpo: 'To RLPO',
  stPend: 'Pending', decidedBy: 'by {who}', remark: 'Remark', all: 'All', sentRlpo: 'Sent to RLPO for approval',
  noRlpo: 'Sent. No RLPO is mapped to your store yet — Admin will see it.', noRequests: 'No requests in the last 60 days',
  badDate: 'Pick a date within the last 45 days (not in the future).', notSecurity: 'Only Security staff can have SG requests.',
  noSecStaff: 'No Security staff found for your store.', back2: '‹ Back', excel: '⬇ Excel', month: 'Month',
  stmTitle: 'Monthly statement', dept: 'Department', show: 'Show', print: '🖨 Print / Save as PDF', selAssoc: 'Select associate', allDepts: 'All departments',
  refresh: 'Refresh',
});
Object.assign(I18N.hi, {
  tabToday: 'आज', tabPunch: 'पंच', tabHk: 'HK बंटवारा', tabReq: 'अनुरोध', tabStm: 'स्टेटमेंट', tabQr: 'QR',
  live: 'लाइव', endOfDay: 'दिन खत्म', required: 'ज़रूरत', notPunchedK: 'पंच नहीं हुआ', monthToDate: 'महीने में अब तक',
  hkNotSet: 'HK बंटवारा नहीं भरा। एडमिन ने HK कुल = {n} रखा है।', hkEnter: 'सुबह / शाम बंटवारा भरें',
  statusOnly: 'सिर्फ़ स्टेटस', hrSet: '{n} घंटे सेट', notPunchedN: '{n} ने पंच नहीं किया', notOnDuty: '{n} ड्यूटी पर नहीं',
  punchedByStore: 'स्टोर से पंच', stillIn: 'अभी अंदर', liveOk: '📷 लाइव ✓', extra: '+{n} ज़्यादा',
  sgP: 'P', sgH: 'H · आधा दिन', sgA: 'A', sgMP: 'MP · RLPO के पास', sgPs: 'P* · RLPO छूट', sgIN: 'IN · ड्यूटी पर',
  misPunchReq: 'मिस-पंच → RLPO', compoffShort: 'कॉम्प-ऑफ़',
  punchForStaffT: 'स्टाफ़ का पंच', punchHelp: 'जिनके पास फ़ोन नहीं है उनके लिए। यह “स्टोर से पंच” गिना जाता है और AM को दिखता है।',
  openPunch: '+ स्टाफ़ का पंच करें (बिना फ़ोन)', whoIn: 'अभी कौन अंदर है', byStoreToday: 'आज स्टोर से पंच', noneYet: 'अभी कोई नहीं',
  lastPunch: 'आखिरी पंच', notToday: 'आज पंच नहीं',
  hkTitle: 'HK बंटवारा', hkHelp: 'एडमिन आपके स्टोर के लिए सिर्फ़ हाउसकीपिंग की कुल संख्या डालता है। सुबह और शाम में कितने आएंगे यह आप तय करें। सुबह + शाम = कुल होना चाहिए।',
  hkTotal: 'HK कुल (एडमिन से)', hkVendor: 'वेंडर', effFrom: 'कब से लागू', saveSplit: 'बंटवारा सेव करें', hkCurrent: 'अभी: सुबह {m} + शाम {e} = {t}',
  hkNotYet: 'अभी नहीं भरा · आपका स्टोर AM / एडमिन डैशबोर्ड पर “HK split not set” में दिखेगा', hkSum: 'सुबह + शाम = {t} में से {s}',
  hkNoTotal: 'आपके स्टोर के लिए हाउसकीपिंग कुल अभी सेट नहीं है। एडमिन से पूछें।', hkSaved: 'HK बंटवारा सेव हुआ',
  hkHistory: 'इतिहास', setBy: 'किसने', sumMismatch: 'सुबह + शाम = HK कुल ({t}) होना चाहिए।',
  reqTitle: 'अनुरोध', reqHelp: 'कॉम्प-ऑफ़ और स्टाफ़ जानकारी बदलाव AM को जाते हैं। सिक्योरिटी मिस-पंच / समय बदलाव RLPO को जाते हैं।',
  reqType: 'प्रकार', staff: 'स्टाफ़', date: 'तारीख', reason: 'कारण', send: 'भेजें', pickStaff: '— स्टाफ़ चुनें —',
  kCompoff: 'कॉम्प-ऑफ़', kStaff: 'स्टाफ़ जानकारी बदलाव', kSgMis: 'SG मिस-पंच (RLPO को)', kSgEdit: 'SG समय बदलाव (RLPO को)',
  missingPunch: 'कौन सा पंच छूटा', actualIn: 'असल IN', actualOut: 'असल OUT', toAm: 'AM को', toRlpo: 'RLPO को',
  stPend: 'बाकी', decidedBy: '{who} द्वारा', remark: 'टिप्पणी', all: 'सभी', sentRlpo: 'RLPO को मंज़ूरी के लिए भेजा गया',
  noRlpo: 'भेज दिया। आपके स्टोर पर अभी कोई RLPO नहीं है — एडमिन देखेगा।', noRequests: 'पिछले 60 दिन में कोई अनुरोध नहीं',
  badDate: 'पिछले 45 दिन में की तारीख चुनें (आगे की नहीं)।', notSecurity: 'SG अनुरोध सिर्फ़ सिक्योरिटी स्टाफ़ के लिए है।',
  noSecStaff: 'आपके स्टोर में कोई सिक्योरिटी स्टाफ़ नहीं मिला।', back2: '‹ पीछे', excel: '⬇ Excel', month: 'महीना',
  stmTitle: 'मासिक स्टेटमेंट', dept: 'विभाग', show: 'दिखाएं', print: '🖨 प्रिंट / PDF', selAssoc: 'कर्मचारी चुनें', allDepts: 'सभी विभाग',
  refresh: 'रीफ़्रेश',
});

const STORE_TABS = [['td', 'tabToday', 'td'], ['pn', 'tabPunch', 'pn'], ['hks', 'tabHk', 'hks'], ['rq', 'tabReq', 'rq'], ['stm', 'tabStm', 'stm'], ['qr', 'tabQr', 'qr']];

function storeShell(root, me, active, o = {}) {
  const title = t((STORE_TABS.find((x) => x[0] === active) || [, 'tabToday'])[1]);
  const sh = mobileShell(root, { me, active, title,
    tabs: STORE_TABS.map(([id, k, ic]) => [id, t(k), ic]),
    onNav(id) {
      if (id === 'stm' && !/statement\.html$/.test(location.pathname)) { location.href = 'statement.html'; return; }
      if (id === 'qr') { location.href = 'qr.html'; return; }
      if (o.onNav) { sh.setTitle(t(STORE_TABS.find((x) => x[0] === id)[1])); o.onNav(id); return; }
      if (id !== 'stm') location.href = 'store.html#' + id;
    } });
  if (o.onLang !== false) sh.menu.appendChild(langToggle(() => o.onLang && o.onLang()));
  if (o.checkHk !== false) rpc('hk_split_get', { p_token: me.token }).then((r) => { if (r && r.ok) sh.setDot('hks', r.has_hk && !r.set); });
  return sh;
}

function SG_TAG(st) {
  const m = { P: ['ok', 'sgP'], H: ['amb', 'sgH'], A: ['red', 'sgA'], MP: ['grey', 'sgMP'], 'P*': ['acc', 'sgPs'], IN: ['ok', 'sgIN'] }[st];
  return m ? `<span class="tg ${m[0]}">${esc(t(m[1]))}</span>` : '<span class="tg grey">—</span>';
}
