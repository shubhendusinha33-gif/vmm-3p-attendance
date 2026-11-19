/* ======================= sample data (same shape as the live RPCs) ======================= */
const CATS=[{id:'HK',n:'Housekeeping'},{id:'SEC',n:'Security'},{id:'TRAVEL',n:'Travel Promoter'},{id:'CDIT',n:'CDIT Promoter'}];
const VENDOR={HK:'BVG India',SEC:'G4S Secure',TRAVEL:'Safari / VIP',CDIT:'Bajaj / Prestige'};
const BRANDS={TRAVEL:['Safari','VIP'],CDIT:['Bajaj','Prestige','Usha']};
const ZFMS=[['Z1','Rakesh Sharma'],['Z2','Manoj Tiwari'],['Z3','Sunita Rao']];
const AMS=[['A1','Ajay Kumar','Z1'],['A2','Neha Gupta','Z1'],['A3','Rohit Verma','Z2'],['A4','Pooja Singh','Z2'],['A5','Vikas Jain','Z3'],['A6','Anil Mehta','Z3']];
const RLPOS=[['R1','Sanjay Rathore','sanjay.rathore@vishalretail.co.in'],['R2','Imran Khan','imran.khan@vishalretail.co.in']];
const CITIES=['Indore','Ranchi','Churu','Sikar','Dhanbad','Bikaner','Ramgarh','Bhopal','Kota','Ajmer','Jaipur','Patna','Gaya','Ujjain','Dewas','Bokaro','Alwar','Hazaribagh','Ratlam','Sagar','Rewa','Satna','Giridih','Deoghar','Tonk','Nagaur','Pali','Bhilwara','Bundi','Barmer'];
const STORES=CITIES.map((c,i)=>{const a=AMS[i%AMS.length];return{code:['HY','HJ','HR','HK'][i%4]+String(10+i*3).slice(-2),name:c,city:c,am:a[0],am_name:a[1],zfm:a[2],zfm_name:ZFMS.find(z=>z[0]===a[2])[1],
  rlpo:i%7===6?'':RLPOS[i%2][0],lat:i%7===3?null:22.7+i*.1,lng:i%7===3?null:75.8+i*.1,mail:i%6===5?'':c.toLowerCase()+'@vishalmegamart.in',active:i!==17&&i!==29,set:i%2?12:8,hkTot:3+(i%3)+1,split:i%5===4?null:null}});
STORES.forEach((s,i)=>{const t=s.hkTot;s.split=i%5===4?null:{m:Math.ceil(t*.6),e:t-Math.ceil(t*.6)}});
const DATES=['2026-11-12','2026-11-13','2026-11-14','2026-11-15','2026-11-16','2026-11-17','2026-11-18'],TODAY=6;
const DL=d=>{const x=new Date(DATES[d]+'T00:00');return[x.getDate(),x.toLocaleDateString('en-IN',{weekday:'short'})]};
const NAMES=['Ramesh Yadav','Sita Devi','Mohd Arif','Kamla Bai','Suresh Kumar','Geeta Sahu','Raju Singh','Vinod Patel','Lalit Mishra','Anita Kumari','Pappu Ram','Rekha Verma','Deepak Gupta','Sunil Meena','Pinki Devi','Manoj Rawat','Babita','Harish Chand'];
function h(str){let x=2166136261;for(const c of str){x^=c.charCodeAt(0);x=Math.imul(x,16777619)}return((x>>>0)%10000)/10000}
const SI=code=>STORES.findIndex(s=>s.code===code);
// required: HK = store's own M/E split of Admin's total (unsplit = total in Morning); SEC from Manpower; promoters Morning only
function reqOf(i,c,sh){const s=STORES[i];if(c==='HK'){if(!s.split)return sh==='M'?s.hkTot:0;return sh==='M'?s.split.m:s.split.e}
  const b=c==='SEC'?2+(i%2):c==='TRAVEL'?(i%3?2:0):(i%4?3:0);return sh==='E'?(c==='SEC'?b:0):b}
const CP=[['','Live',1],['08:00','8 AM',.62],['10:00','10 AM',.8],['12:00','12 PM',.92],['14:00','2 PM',.98],['18:00','6 PM',1]];
/* SG: hours → status by the store's shift set (12-hr: <6 A, 6–<12 H, 12+ P · 8-hr: <4 A, 4–<8 H, 8+ P); IN without OUT = mis-punch (MP, counts Absent till RLPO approves) */
function sgStatus(hrs,set,mp){if(mp)return'MP';const[a,p]=set===12?[S.settings.sg12a,S.settings.sg12p]:[S.settings.sg8a,S.settings.sg8p];return hrs<a?'A':hrs<p?'H':'P'}
function guards(i,d,sh){const s=STORES[i],req=reqOf(i,'SEC',sh);return Array.from({length:req},(_,j)=>{const k=h(s.code+'SEC'+DATES[d]+sh+j),n=NAMES[(i*4+j+7)%NAMES.length];
  const mp=k>.86,hrs=mp?null:+(s.set===12?(k<.08?3+k*20:k<.25?7+k*10:12+k*.8):(k<.08?2+k*20:k<.25?5+k*8:8+k*.8)).toFixed(1);
  const key=s.code+'|'+n+'|'+DATES[d];const ex=S.exc[key];return{n,code:s.code+'-S'+(11+j),hrs,mp:mp&&!ex,st:ex?ex.st:sgStatus(hrs,s.set,mp),exc:ex}})}
function rowsFor(d,sh,upto){if(sh==='B')return mergeB(rowsFor(d,'M',upto),rowsFor(d,'E',upto));
  const out=[],isT=d===TODAY;let f=(CP.find(c=>c[0]===upto)||CP[0])[2];if(isT&&sh==='E')f=Math.min(f,.35);if(isT&&!upto)f=sh==='M'?.97:.35;
  STORES.forEach((s,i)=>{if(!s.active)return;CATS.forEach(c=>{const req=reqOf(i,c.id,sh);if(!req)return;let p;
    if(c.id==='SEC'&&!upto&&!(isT&&sh==='E')){const g=guards(i,d,sh);p=g.filter(x=>x.st==='P'||x.st==='H'||x.st==='P*').length}
    else{const k=h(s.code+c.id+DATES[d]+sh);p=Math.round(req*Math.min(1,(.5+k*.6))*f)}
    if(isT&&sh==='M'&&((i===1&&c.id==='HK')||(i===5&&c.id==='SEC')||(i===10&&c.id==='HK')))p=0;out.push({s:s.code,c:c.id,req,p})})});return out}
function mergeB(a,b){const m=new Map();[...a,...b].forEach(r=>{const k=r.s+r.c,o=m.get(k);if(o){o.req+=r.req;o.p+=r.p}else m.set(k,{...r})});return[...m.values()]}

/* ======================= state ======================= */
const S={role:'admin',page:'ld',d:TODAY,cat:'',shift:'M',upto:'',zfm:'',am:'',q:'',alert:'',view:'zfm',path:[],store:null,lastRef:'14:08',exc:{},
  settings:{test:false,live:true,radius:500,alertM:'10:30',alertE:'17:30',idleStore:30,idleOther:60,sg12a:6,sg12p:12,sg8a:4,sg8p:8,lowPct:70,lowDays:3},
  reqs:[{id:1,store:'HY10',am:'Ajay Kumar',by:'SM Rahul Jain',type:'Comp-off',who:'Ramesh Yadav · HK',date:'16 Nov',why:'Worked on weekly off for stock count',st:'Pending'},{id:2,store:'HR16',am:'Ajay Kumar',by:'ASM Kiran',type:'Staff detail change',who:'Mohd Arif · HK',date:'—',why:'Name spelling wrong (Mohammad Arif)',st:'Pending'},
   {id:3,store:'HY28',am:'Neha Gupta',by:'SM Vivek',type:'Comp-off',who:'Sita Devi · HK',date:'17 Nov',why:'Extra shift during audit',st:'Approved'},{id:4,store:'HK19',am:'Rohit Verma',by:'SM Arvind',type:'Comp-off',who:'Geeta Sahu · HK',date:'15 Nov',why:'Covered Sunday',st:'Rejected'},{id:5,store:'HJ13',am:'Neha Gupta',by:'DM GM Sonal',type:'Staff detail change',who:'Lalit Mishra · CDIT',date:'—',why:'Brand change to Prestige',st:'Pending'}],
  sgReq:[{id:1,store:'HJ13',guard:'Raju Singh',date:'18 Nov',kind:'Mis-punch',detail:'IN 08:02 · no OUT',by:'SM Vivek'},{id:2,store:'HY10',guard:'Vinod Patel',date:'17 Nov',kind:'Edit request',detail:'OUT should be 20:05 (phone off)',by:'SM Rahul Jain'},{id:3,store:'HR16',guard:'Lalit Mishra',date:'18 Nov',kind:'Mis-punch',detail:'IN 07:58 · no OUT',by:'ASM Kiran'}],
  manual:[{store:'HY46',guard:'Harish Chand',date:'16 Nov',reason:'Biometric phone stolen, CCTV checked',by:'RLPO Sanjay Rathore'}],
  posts:null,myReq:[{t:'Comp-off',who:'Kamla Bai · HK',d:'15 Nov',st:'Approved'},{t:'Staff detail change',who:'Raju Singh · SEC',d:'—',st:'Pending'}],extra:[],
  logTab:'acc',logQ:'',logD:'',mail:{type:'invite',role:'am',sel:0,chk:{}},stmS:'',stmA:'',usrQ:'',stQ:'',stF:'',mpTab:'HK',apF:'Pending',apQ:'',
  depts:[{id:1,n:'Facility',cats:['HK'],act:true},{id:2,n:'Security (LP)',cats:['SEC'],act:true},{id:3,n:'Travel',cats:['TRAVEL'],act:true},{id:4,n:'CDIT',cats:['CDIT'],act:false}],
  users:null,login:{role:'store',step:1},punch:{step:'pick',cat:'HK',name:'',kind:'IN'}};
const $=s=>document.querySelector(s);const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pct=(p,r)=>r?Math.round(Math.min(p,r)*1000/r)/10:0;const fmt=n=>Number(n).toLocaleString('en-IN');
const col=v=>v>=90?'var(--ok)':v>=70?'var(--amb)':'var(--red)';const heat=v=>`<span class="heat ${v>=90?'h1':v>=70?'h2':'h3'}">${v}%</span>`;
const pl=n=>n===1?'':'s';
function toast(t){const e=$('#toast');e.textContent=t;e.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>e.hidden=true,2800)}
const store={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};

/* ---------- modal ---------- */
function modal(html){$('#modal').innerHTML=`<div class="ov" data-ovx="1"><div class="md" role="dialog">${html}</div></div>`}
function closeModal(){$('#modal').innerHTML=''}

/* ---------- Excel: real .xlsx · Calibri 10 · borders on every cell · bold header · auto-fit width ---------- */
function loadScript(src){return new Promise((res,rej)=>{if(document.querySelector(`script[src="${src}"]`))return res();const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=rej;document.head.appendChild(s)})}
async function xlsx(rows,name,sheet='Sheet1'){if(!rows.length)return toast('Nothing to export');
  try{await loadScript('https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js')}catch(e){return toast('Excel library could not load (offline?)')}
  const X=window.XLSX,head=Object.keys(rows[0]),aoa=[head,...rows.map(r=>head.map(k=>r[k]??''))],ws=X.utils.aoa_to_sheet(aoa);
  const bd={style:'thin',color:{rgb:'A6A6A6'}},border={top:bd,bottom:bd,left:bd,right:bd};
  aoa.forEach((r,ri)=>r.forEach((v,ci)=>{const ref=X.utils.encode_cell({r:ri,c:ci});if(!ws[ref])ws[ref]={t:'s',v:''};
    ws[ref].s={font:{name:'Calibri',sz:10,bold:ri===0,color:ri===0?{rgb:'FFFFFF'}:undefined},border,alignment:{vertical:'center',horizontal:typeof v==='number'?'right':'left'},fill:ri===0?{patternType:'solid',fgColor:{rgb:'334155'}}:undefined}}));
  ws['!cols']=head.map((_,ci)=>({wch:Math.min(60,Math.max(...aoa.map(r=>String(r[ci]??'').length))+2)}));
  ws['!autofilter']={ref:X.utils.encode_range({s:{r:0,c:0},e:{r:aoa.length-1,c:head.length-1}})};
  const wb=X.utils.book_new();X.utils.book_append_sheet(wb,ws,sheet.slice(0,31));X.writeFile(wb,name);toast(`${name} downloaded · ${rows.length} rows`)}
function dl(name,text,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click()}

/* ---------- idle auto-logout (Store logins and others have their own minutes in Settings) ---------- */
const IDLE={left:0,warn:60,t:null,demo:0};
function idleLimit(){return IDLE.demo||((S.role==='store'?S.settings.idleStore:S.settings.idleOther)*60)}
function idleReset(){if(S.role==='login'||S.role==='punch'||S.loggedOut)return;IDLE.left=idleLimit();if($('#idlem'))closeModal()}
function idleTick(){if(S.role==='login'||S.role==='punch'||S.loggedOut)return;IDLE.left--;
  if(IDLE.left<=0){closeModal();S.loggedOut=true;shell();return}
  if(IDLE.left<=Math.min(IDLE.warn,idleLimit()-3)){if(!$('#idlem'))modal(`<div id="idlem"><h3>Still there?</h3><div class="sub" style="margin:8px 0">No activity for a while. You will be logged out in <b id="idlec">${IDLE.left}</b> seconds to keep the portal safe.</div><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn s" data-x="out">Log out now</button><button class="btn" data-x="stay">Stay logged in</button></div></div>`);else $('#idlec').textContent=IDLE.left}}
setInterval(idleTick,1000);['mousemove','keydown','touchstart','scroll'].forEach(ev=>document.addEventListener(ev,()=>{if(!$('#idlem'))idleReset()},{passive:true}));

/* ======================= roles, nav, shell ======================= */
const ME={admin:{n:'Admin',s:'All India'},ho:{n:'HO · Security (LP)',s:'All India · Security only'},zfm:{n:'ZFM · Rakesh Sharma',s:'Zone Z1'},am:{n:'AM · Ajay Kumar',s:'AM A1 · 3 stores'},rlpo:{n:'RLPO · Sanjay Rathore',s:'Security · R1 stores'},store:{n:'SM · Rahul Jain',s:'HY10 · Indore'}};
function roleStores(){return STORES.filter(s=>s.active&&(S.role==='zfm'?s.zfm==='Z1':S.role==='am'?s.am==='A1':S.role==='store'?s.code===STORES[0].code:S.role==='rlpo'?s.rlpo==='R1':true))}
const lockCat=()=>S.role==='ho'||S.role==='rlpo'?'SEC':'';
function navItems(){const r=S.role,pend=S.reqs.filter(x=>x.st==='Pending'&&x.am==='Ajay Kumar').length;
  if(r==='store')return{a:[['td','Today','td'],['hks','HK split','mp'],['pn','Punch for staff','pn'],['rq','Requests to AM','rq'],['qr','QR poster','qr'],['stm','Statements','stm']],ad:[]};
  if(r==='rlpo')return{a:[['ld','Live Dashboard','ld'],['sga','SG approvals','ap',S.sgReq.length||''],['man','Manual present','pn'],['stm','Statements','stm']],ad:[]};
  const a=[['ld','Live Dashboard','ld']];if(r==='am')a.push(['ap','Approvals','ap',pend||''],['tm','Store team','tm']);if(r==='zfm')a.push(['tm','Store team','tm'],['us','Users & PIN','us']);if(r==='admin')a.push(['apv','Approvals (view)','ap']);
  a.push(['ch','Churn','ch'],['stm','Statements','stm']);
  const ad=r==='admin'?[['st','Store Master','st'],['mp','Manpower Master','mp'],['us','Users & PIN','us'],['rl','RLPO Master','tm'],['ho','HO Dept Master','ho'],['ml','Mail Center','ml'],['set','Settings','set'],['lg','Access & Consent log','lg']]:[];return{a,ad}}
const TITLES={rl:'RLPO Master',aph:'Approval history',ld:'Live Dashboard',ap:'Approvals',apv:'Approvals (view only)',tm:'Store team',ch:'Churn',stm:'Statements',st:'Store Master',mp:'Manpower Master',us:'Users & PIN',ho:'HO Dept Master',ml:'Mail Center',set:'Settings',lg:'Access & Consent log',td:'Today',hks:'HK split',pn:'Punch for staff',rq:'Requests to AM',qr:'QR poster',sga:'SG approvals',man:'Manual present'};
const PALS=[['p3','Slate & Orange (default)'],['p1','Indigo & Teal'],['p2','Teal & Violet'],['p4','Plum & Sky'],['p5','Navy & Cyan'],['p6','Charcoal & Violet'],['p7','Espresso & Teal'],['p8','Wine & Blue'],['cur','Blue & Pink']];
function setTheme(p,dark){const r=document.documentElement;if(p!=null){if(p==='p3')delete r.dataset.pal;else r.dataset.pal=p;store.set('3pa_theme',p)}if(dark!=null){if(dark)r.dataset.theme='dark';else delete r.dataset.theme;store.set('3pa_dark',dark?'1':'')}}
const ROLES=[['login','Login'],['admin','Admin'],['ho','HO Dept'],['zfm','ZFM'],['am','AM'],['rlpo','RLPO'],['store','Store'],['punch','Staff phone']];
function strip(){return `<div class="preview noprint"><b>Preview · sample data</b><span class="sep"></span><span>See as</span>${ROLES.map(([r,l])=>`<button data-role="${r}" class="${S.role===r?'on':''}">${l}</button>`).join('')}<span class="sep"></span><button data-x="idledemo">Test idle logout (15 s)</button></div>`}
function shell(){const r=S.role;
  if(S.loggedOut){$('#root').innerHTML=strip()+`<div class="lgbg"><div class="lgc"><h1>Logged out</h1><div class="sb" style="margin:0">You were inactive for a while, so we logged you out to keep the portal safe.</div><button class="btn" data-x="relogin">Log in again</button></div></div>`;return}
  if(r==='login'){$('#root').innerHTML=strip()+pLogin();return}if(r==='punch'){$('#root').innerHTML=strip()+pPunch();return}
  const nv=navItems(),b=x=>`<button class="nav ${S.page===x[0]?'on':''}" data-go="${x[0]}"><svg viewBox="0 0 24 24">${IC[x[2]]}</svg><span class="lbl2">${x[1]}</span>${x[3]?`<span class="bd">${x[3]}</span>`:''}</button>`;
  const pal=document.documentElement.dataset.pal||'p3',dark=document.documentElement.dataset.theme==='dark';
  $('#root').innerHTML=`<div class="shell"><aside class="side noprint"><div class="brand"><span class="lg">VMM</span><div><b>3rd Party Attendance</b><small>Control Tower</small></div></div>${nv.a.map(b).join('')}${nv.ad.length?'<div class="grp">Admin</div>'+nv.ad.map(b).join(''):''}
  <div class="who"><b>${ME[r].n}</b><span>${ME[r].s}</span><br><select data-f="theme" title="Theme">${PALS.map(p=>`<option value="${p[0]}" ${pal===p[0]?'selected':''}>🎨 ${p[1]}</option>`).join('')}</select><br><button data-x="dark">${dark?'☀ Light':'☾ Dark'}</button> <button data-x="pinc">Change PIN</button> <button data-x="out">Logout</button></div></aside>
  <main>${strip()}<div class="bar noprint" id="bar"></div><div class="wrap" id="pg"></div></main></div>`;page(true)}
function bar(){const isLd=S.page==='ld',isTd=S.page==='td';let f='';
  if(isLd||isTd){f+=`<input class="f" type="date" data-f="d" value="${DATES[S.d]}" min="${DATES[0]}" max="${DATES[TODAY]}">`;
   if(isLd){if(S.role==='admin'||S.role==='ho')f+=`<select data-f="zfm"><option value="">ZFM: All</option>${ZFMS.map(z=>`<option value="${z[0]}" ${S.zfm===z[0]?'selected':''}>${z[1]}</option>`).join('')}</select>`;
    if(S.role!=='am'&&S.role!=='rlpo')f+=`<select data-f="am"><option value="">AM: All</option>${AMS.filter(a=>(S.role!=='zfm'||a[2]==='Z1')&&(!S.zfm||a[2]===S.zfm)).map(a=>`<option value="${a[0]}" ${S.am===a[0]?'selected':''}>${a[1]}</option>`).join('')}</select>`;
    f+=`<input class="f" data-f="q" placeholder="Store code" maxlength="4" style="width:100px;text-transform:uppercase" value="${esc(S.q)}">`}}
  const live=S.d===TODAY&&!S.upto;
  $('#bar').innerHTML=`<span class="crumb">${ME[S.role].s} › <b>${TITLES[S.page]}</b></span>${f}
   ${isLd||isTd?`<span class="lvz"><span class="dot ${live?'':'off'}"></span>${live?'Live · '+S.lastRef:S.d===TODAY?'As of '+CP.find(c=>c[0]===S.upto)[1]:'End of day · '+DL(S.d)[0]+' Nov'}</span><button class="btn s sm" data-x="ref">↻ Refresh</button>`:'<span class="lvz"></span>'}
   ${isLd?'<button class="btn sm" data-x="xls">⬇ Excel</button>':''}`}
function page(anim){bar();const P={rl:pRl,ld:pLd,ap:pAp,apv:pApv,tm:pTm,ch:pCh,stm:pStm,st:pSt,mp:pMp,us:pUs,ho:pHo,ml:pMl,set:pSet,lg:pLg,td:pTd,hks:pHks,pn:pPn,rq:pRq,qr:pQr,sga:pSga,man:pMan}[S.page];
  $('#pg').innerHTML=P();if(anim){const pg=$('#pg');pg.classList.remove('pg-in');void pg.offsetWidth;pg.classList.add('pg-in')}if(S.page==='ld'&&S.store)storeDetail(S.store,false)}
const IC={ld:'<path d="M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 13h7v8H3z"/>',ap:'<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',tm:'<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M15 20c0-2 2-4 4-4"/>',ch:'<path d="M4 4v6h6"/><path d="M20 20v-6h-6"/><path d="M20 10A8 8 0 0 0 6 6L4 10M4 14a8 8 0 0 0 14 4l2-4"/>',stm:'<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h8M9 17h8"/>',st:'<path d="M3 9l1-5h16l1 5"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/>',mp:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',us:'<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',ho:'<path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-5h6v5"/>',ml:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',set:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',lg:'<path d="M4 5h16M4 12h16M4 19h10"/>',td:'<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',pn:'<path d="M12 2v10M8 8l4 4 4-4"/><rect x="4" y="14" width="16" height="7" rx="2"/>',rq:'<path d="M4 4h16v12H8l-4 4z"/>',qr:'<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM18 18h3v3h-3z"/>'};
