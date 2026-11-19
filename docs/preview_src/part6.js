/* ======================= events ======================= */
function nowStr(){const d=new Date();return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}
const mailOk=v=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
function clearWK(){for(const k in WK)delete WK[k]}
document.addEventListener('click',e=>{
  if(e.target.matches('.ov')){closeModal();return}
  const t=e.target.closest('[data-role],[data-x],[data-go],[data-cat],[data-sh],[data-al],[data-cp],[data-vw],[data-bc],[data-clr],[data-day],[data-apr],[data-apf],[data-sga],[data-vac],[data-msg],[data-sw],[data-tab],[data-stm],[data-stf],[data-edst],[data-savest],[data-mpt],[data-edmp],[data-savemp],[data-edus],[data-saveus],[data-edho],[data-saveho],[data-msel],[data-lr],[data-pc],tr.click');if(!t)return;
  const D=t.dataset;
  if(D.role){S.role=D.role;S.loggedOut=false;Object.assign(S,{page:{store:'td'}[S.role]||'ld',cat:'',zfm:'',am:'',q:'',alert:'',path:[],store:null,posts:null,view:{am:'store',zfm:'am',rlpo:'store'}[S.role]||'zfm'});S.login.step=1;S.punch.step='pick';IDLE.demo=0;idleReset();shell();return}
  if(D.go){S.page=D.go;S.store=null;shell();return}
  if(D.msg){toast(D.msg);return}
  if(D.lr){S.login.role=D.lr;shell();return}
  if(D.pc){S.punch.cat=D.pc;S.punch.name=($('#pName')||{}).value||S.punch.name;shell();return}
  if(D.stm){const[s,n,c]=D.stm.split('|');Object.assign(S,{stmS:s,stmA:n,stmC:c,page:'stm'});shell();return}
  if(D.apr){const[id,st]=D.apr.split('|');const a=S.reqs.find(x=>x.id==id);a.st=st;toast(`${a.type} for ${a.who.split(' · ')[0]} ${st.toLowerCase()} · store informed`);shell();return}
  if(D.apf){S.apF=D.apf;page(false);return}
  if(D.sga){const[id,st]=D.sga.split('|');const a=S.sgReq.find(x=>x.id==id),key=a.store+'|'+a.guard+'|'+DATES[TODAY];S.exc[key]={st,why:`RLPO ${st==='A'?'rejected':'approved as '+st} · ${a.kind}`};S.sgReq=S.sgReq.filter(x=>x.id!=id);clearWK();toast(`${a.guard} · ${a.date} → ${st}`);shell();return}
  if(D.vac){const[si,pi]=D.vac.split('|');const p=S.posts[si].p[pi];if(!t.classList.contains('cf')){t.classList.add('cf');t.textContent='Tap again to confirm';return}toast(`${p.p} at ${S.posts[si].s} marked vacant`);p.who=null;page(false);return}
  if(D.sw){if(D.sw==='test'&&!S.settings.test&&!confirm('Turn Test mode ON? GPS will not be checked.'))return;S.settings[D.sw]=!S.settings[D.sw];page(false);return}
  if(D.tab){S.logTab=D.tab;page(false);return}
  if(D.stf){S.stF=D.stf;page(false);return}
  if('edst' in D){editStore(D.edst);return}
  if('savest' in D){const code=D.savest||$('#eCode').value.trim().toUpperCase(),err=m=>{$('#eErr').hidden=false;$('#eErr').textContent=m};
    if(!/^[A-Z]{2}\d{2}$/.test(code))return err('Store code must be 2 letters + 2 digits (e.g. HY10)');if(!D.savest&&SI(code)>=0)return err('Store code already exists');
    if($('#eMail').value&&!mailOk($('#eMail').value))return err('Store mail is not valid');if(!$('#eName').value.trim())return err('Name is required');
    let s=D.savest?STORES[SI(code)]:null;if(!s){s={code,split:null};STORES.push(s)}const am=AMS.find(a=>a[0]===$('#eAm').value),zf=ZFMS.find(z=>z[0]===$('#eZfm').value);
    Object.assign(s,{name:$('#eName').value.trim(),city:$('#eName').value.trim(),am:am[0],am_name:am[1],zfm:zf[0],zfm_name:zf[1],rlpo:$('#eRl').value,mail:$('#eMail').value.trim(),lat:$('#eLat').value?+$('#eLat').value:null,lng:$('#eLng').value?+$('#eLng').value:null,set:+$('#eSet').value,hkTot:+$('#eHk').value||0,active:$('#eAct').value==='1'});
    closeModal();clearWK();toast(`Store ${code} saved`);page(false);return}
  if(D.mpt){S.mpTab=D.mpt;page(false);return}
  if('edmp' in D){editMp(+D.edmp);return}
  if(D.savemp){const s=STORES[SI(D.savemp)],v=k=>(document.querySelector(`[data-mpk="${k}"]`)||{}).value;if(S.mpTab==='SEC'&&v('Shift set'))s.set=parseInt(v('Shift set'));if(S.mpTab==='HK'&&v('HK total')){const n=+v('HK total');if(n!==s.hkTot){s.hkTot=n;s.split=null}}
    closeModal();clearWK();toast(`${D.savemp} saved from ${v('Effective from')||'effective date'}${S.mpTab==='HK'?' · store must re-enter the M/E split if the total changed':''}`);page(false);return}
  if('edus' in D){editUser(+D.edus);return}
  if('saveus' in D){const i=+D.saveus,r=$('#uR').value,n=$('#uN').value.trim(),em=$('#uE').value.trim(),m=$('#uM').value.trim(),err=x=>{$('#uErr').hidden=false;$('#uErr').textContent=x};
    if(n.length<3)return err('Name is required');if((r==='hodept'||r==='rlpo')&&!mailOk(m))return err(`${RL[r]} logs in with mail id · enter a valid mail`);if((r==='am'||r==='zfm')&&!/^\d{5,}$/.test(em)&&!mailOk(m))return err('AM / ZFM need an Emp Code (5+ digits) or a mail id');
    if(r==='hodept'&&!$('#uD').value)return err('Pick the HO department');const u={role:r,name:n,emp:em,mail:m,dept:$('#uD').value,pin:i>=0?S.users[i].pin:false};if(i>=0)S.users[i]=u;else S.users.push(u);closeModal();toast(`${n} saved${i<0?' · send the invite from Mail Center':''}`);page(false);return}
  if('edho' in D){editHo(+D.edho);return}
  if('saveho' in D){const i=+D.saveho,n=$('#hN').value.trim(),cats=[...document.querySelectorAll('[data-hc]:checked')].map(x=>x.dataset.hc);if(n.length<2){$('#hErr').hidden=false;$('#hErr').textContent='Name is required';return}if(!cats.length){$('#hErr').hidden=false;$('#hErr').textContent='Pick at least one category';return}
    const d={n,cats,act:$('#hA').value==='1'};if(i>=0)S.depts[i]=d;else S.depts.push(d);closeModal();toast(`${n} saved`);page(false);return}
  if(D.msel!=null){S.mail.sel=+D.msel;page(false);return}
  if(D.x){const x=D.x;
    if(x==='mclose'){closeModal();return}if(x==='stay'){closeModal();idleReset();return}
    if(x==='out'){closeModal();S.loggedOut=true;shell();return}if(x==='relogin'){S.loggedOut=false;IDLE.demo=0;S.role='login';S.login.step=1;shell();return}
    if(x==='idledemo'){if(S.role==='login'||S.role==='punch'){S.role='admin';S.page='ld'}S.loggedOut=false;IDLE.demo=15;IDLE.left=15;shell();toast('Now stop moving the mouse · warning comes, then auto logout');return}
    if(x==='dark'){setTheme(null,document.documentElement.dataset.theme!=='dark');shell();return}
    if(x==='pinc'){modal(`<h3>Change PIN</h3><div class="frm"><label>Current PIN<input class="f" type="password" maxlength="4" inputmode="numeric"></label><label>New PIN<input class="f" type="password" maxlength="4" inputmode="numeric"></label><label>New PIN again<input class="f" type="password" maxlength="4" inputmode="numeric"></label></div><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn s" data-x="mclose">Cancel</button><button class="btn" data-x="pinok">Change PIN</button></div>`);return}
    if(x==='pinok'){closeModal();toast('PIN changed');return}
    if(x==='ref'){S.lastRef='14:'+String(8+Math.floor(Math.random()*5)).padStart(2,'0');page(false);toast('Refreshed · '+S.lastRef);return}
    if(x==='xls')return excelLd();if(x==='closesd'){S.store=null;$('#sd').innerHTML='';return}if(x==='print'){window.print();return}
    if(x==='pin_in'||x==='pin_out'){const n=$('#pnN').value.trim();if(n.length<3)return toast('Write the full name');S.extra.push({s:STORES[0].code,c:$('#pnC').value,n,t:nowStr(),r:$('#pnR').value+(x==='pin_out'?' · OUT':'')});toast(`${x==='pin_in'?'IN':'OUT'} saved for ${n}`);page(false);return}
    if(x==='rqsend'){const r=$('#rqR').value.trim();if(r.length<5)return toast('Reason is required (5+ letters)');const ty=$('#rqT').value,sg=ty.startsWith('SG');S.myReq.unshift({t:ty,who:$('#rqW').value,d:$('#rqD').value.slice(8)+' Nov',st:'Pending'});
      if(sg)S.sgReq.push({id:Date.now(),store:STORES[0].code,guard:$('#rqW').value,date:$('#rqD').value.slice(8)+' Nov',kind:'Edit request',detail:r,by:'SM Rahul Jain'});else S.reqs.unshift({id:Date.now(),store:STORES[0].code,am:'Ajay Kumar',by:'SM Rahul Jain',type:ty,who:$('#rqW').value,date:$('#rqD').value.slice(8)+' Nov',why:r,st:'Pending'});
      toast(sg?'Sent to RLPO Sanjay Rathore':'Sent to AM Ajay Kumar');page(false);return}
    if(x==='hksave'){const s=STORES[0],m=+$('#hkM').value,ev=+$('#hkE').value;if($('#hkM').value===''||$('#hkE').value===''||m<0||ev<0)return toast('Enter both Morning and Evening');if(m+ev!==s.hkTot){$('#hkMsg').innerHTML=`<span style="color:var(--red);font-weight:700">Morning ${m} + Evening ${ev} = ${m+ev}, but HK total is ${s.hkTot}. Fix and save again.</span>`;return}
      s.split={m,e:ev};clearWK();toast('HK split saved · dashboards now use it');shell();return}
    if(x==='mnsave'){const r=$('#mnR').value.trim();if(r.length<8)return toast('Reason is mandatory (8+ letters)');const st=$('#mnS').value,g=$('#mnG').value,d=$('#mnD').value;S.manual.unshift({store:st,guard:g,date:d.slice(8)+' Nov',reason:r,by:'RLPO Sanjay Rathore'});S.exc[st+'|'+g+'|'+d]={st:'P*',why:r};clearWK();toast(`${g} marked P* for ${d.slice(8)} Nov`);page(false);return}
    if(x==='deltest'){if(!t.classList.contains('cf')){t.classList.add('cf');t.textContent='Tap again to delete';return}toast('All test data deleted');t.textContent='Deleted ✓';t.disabled=true;return}
    if(x==='saveset'){const s=S.settings;if(s.sg12a>=s.sg12p||s.sg8a>=s.sg8p)return toast('Absent-below hours must be less than Present-from hours');clearWK();idleReset();toast(`Settings saved · auto logout ${s.idleStore} min store / ${s.idleOther} min others`);return}
    if(x==='sttpl')return xlsx([{'Store Code':'HY10',Name:'Indore','AM Emp':'51221','ZFM Emp':'51880','RLPO Mail':'sanjay.rathore@vishalretail.co.in','Store Mail':'indore@vishalmegamart.in',Lat:22.71,Lng:75.85,'SG Shift Set (8/12)':8,'HK Total':4,Active:'Y'}],'Store_Master_template.xlsx','Stores');
    if(x==='stexp')return xlsx(STORES.map(s=>({'Store Code':s.code,Name:s.name,AM:s.am_name,ZFM:s.zfm_name,RLPO:(RLPOS.find(r=>r[0]===s.rlpo)||['',''])[1],'Store Mail':s.mail,Lat:s.lat??'',Lng:s.lng??'','SG Shift Set':s.set,'HK Total':s.hkTot,Active:s.active?'Y':'N'})),'Store_Master.xlsx','Stores');
    if(x==='mptpl'){const r=mpRows(S.mpTab).slice(0,2).map(o=>{const c={...o};delete c.Split;delete c['Morning (by store)'];delete c['Evening (by store)'];return c});return xlsx(r,`Manpower_${S.mpTab}_template.xlsx`,S.mpTab)}
    if(x==='mpexp')return xlsx(mpRows(S.mpTab),`Manpower_${S.mpTab}.xlsx`,S.mpTab);
    if(x==='chx')return xlsx(S._ch.map(r=>({Store:r.s.code,Name:r.s.name,Dept:r.c.n,Required:r.req,'Different names':r.names,Level:r.lv})),'Churn_30d.xlsx','Churn');
    if(x==='lgx')return xlsx(logRows().map(r=>S.logTab==='acc'?{Time:r[0],Store:r[1],Who:r[2],Event:r[3],Detail:r[4]}:{Time:r[0],Store:r[1],Person:r[2],Policy:r[3],Device:r[4]}),`${S.logTab==='acc'?'Access':'Consent'}_log.xlsx`,'Log');
    if(x==='logclr'){S.logQ='';S.logD='';page(false);return}
    if(x==='stmx'){const{sc,an,cat,s,days}=stmData();return xlsx(days.filter(d=>d.st).map(d=>({Date:`${String(d.d).padStart(2,'0')}-11-2026`,Store:sc,Name:an,Department:CATS.find(c=>c.id===cat).n,Vendor:VENDOR[cat],Status:{P:'P',A:'A',H:'H',CO:'Comp-Off'}[d.st]})),`Statement_${sc}_${an.replace(/ /g,'_')}_Nov2026.xlsx`,'Statement')}
    if(x==='eml'){const R=mailRecips(),i=Math.min(S.mail.sel,R.length-1),rc=R[i],m=mailBody(S.mail.type,rc,i);dl(`${rc.name.replace(/\W+/g,'_')}.eml`,eml(rc,m),'message/rfc822');toast('.eml downloaded · opens in Outlook ready to send');return}
    if(x==='zip'){const R=mailRecips().map((r,i)=>[r,i]).filter(([r,i])=>S.mail.chk[i]&&r.to);if(!R.length)return toast('No recipients ticked');loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js').then(async()=>{const z=new JSZip();R.forEach(([r,i],k)=>z.file(`Batch_${String(Math.floor(k/25)+1).padStart(2,'0')}/${r.name.replace(/\W+/g,'_')}.eml`,eml(r,mailBody(S.mail.type,r,i))));const b=await z.generateAsync({type:'blob'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`Mail_${S.mail.type}_${S.mail.role}.zip`;a.click();toast(`ZIP ready · ${R.length} mails`)}).catch(()=>toast('ZIP library could not load (offline?)'));return}
    if(x==='mlx')return xlsx(mailRecips().map((r,i)=>({To:r.to||'',Name:r.name,'Login ID':r.id,Subject:mailBody(S.mail.type,r,i).subj,Status:!r.to?'Mail missing':S.mail.chk[i]?'Ready':'Left out'})),`Mail_tracker_${S.mail.type}.xlsx`,'Mails');
    if(x==='lgnext'){const r=S.login.role,v=($('#lgId')||{}).value?.trim()||'',err=m=>{$('#lgErr').hidden=false;$('#lgErr').textContent=m};
      if(r==='store'&&!/^\d{5,}$/.test(v))return err('Emp Code: min 5 digits');if((r==='hodept'||r==='rlpo')&&!mailOk(v))return err('Enter your full official mail id (name@company.com)');if((r==='am'||r==='zfm'||r==='admin')&&!/^\d{5,}$/.test(v)&&!mailOk(v))return err('Enter your Emp Code (5+ digits) or your official mail id');
      S.login.step=2;S.login.id=v;shell();return}
    if(x==='lgback'){S.login.step=1;shell();return}
    if(x==='lgin'){const r=S.login.role;S.role={hodept:'ho'}[r]||r;S.page=S.role==='store'?'td':'ld';S.login.step=1;shell();toast('Logged in');return}
    if(x==='pin')return openCam('IN');if(x==='pout')return openCam('OUT');if(x==='pagain'){S.punch.step='pick';shell();return}
    if(x==='camx'){const c=document.querySelector('.cam');if(c){c._stop&&c._stop();c.remove()}return}
    return}
  if(D.day!=null){S.d=+D.day;if(S.d<TODAY)S.upto='';S.store=null;shell();return}
  if('cat' in D){if(lockCat())return;S.cat=D.cat;S.store=null}
  else if(D.sh){S.shift=D.sh}
  else if(D.al){S.alert=S.alert===D.al?'':D.al;S.path=[];S.store=null}
  else if('cp' in D){S.upto=D.cp}
  else if(D.vw){S.view=D.vw;S.path=[];S.alert='';S.store=null}
  else if(D.bc){S.path=S.path.slice(0,+D.bc+1);S.store=null}
  else if(D.clr){S[D.clr]=''}
  else if(t.matches('tr.click')){const lv=S._lv,k=D.k,n=D.n;if(lv==='store'){S.store=k;storeDetail(k);return}if(lv==='dept'){S.cat=k;S.view='store'}else S.path.push({key:lv,val:k,name:n,next:lv==='zfm'?'am':'store'})}
  shell()});
document.addEventListener('change',e=>{const el=e.target,f=el.dataset.f,v=el.value;
  if(el.dataset.up){const n=el.files[0]&&el.files[0].name;if(n)modal(`<h3>Import check · ${esc(n)}</h3><div class="stat"><button class="on">Good rows<b style="color:var(--ok)">${12+n.length%9}</b></button><button class="r">Problems<b>${n.length%4}</b></button></div><div class="note w">Problem rows: missing store code, HK total not a number. Download them, fix and upload again.</div><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn s" data-msg="Problem rows downloaded">⬇ Problem rows</button><button class="btn" data-x="mclose">Save good rows</button></div>`);el.value='';return}
  if(el.dataset.mchk!=null){S.mail.chk[+el.dataset.mchk]=el.checked;page(false);return}
  if(el.dataset.sk){const k=el.dataset.sk;S.settings[k]=el.type==='number'||k==='radius'?+v:v;return}
  if(!f)return;
  if(f==='theme'){setTheme(v);shell();return}
  if(f==='d'){const i=DATES.indexOf(v);if(i<0){toast('Pick a date from 12 to 18 Nov in this preview');el.value=DATES[S.d];return}S.d=i;if(i<TODAY)S.upto='';S.store=null;shell()}
  else if(f==='zfm'){S.zfm=v;S.am='';S.path=[];shell()}else if(f==='am'){S.am=v;S.path=[];shell()}
  else if(f==='stmS'||f==='stmA'||f==='stmC'){S[f]=v;page(false)}else if(f==='mailT'){S.mail.type=v;page(false)}else if(f==='mailR'){S.mail.role=v;S.mail.sel=0;S.mail.chk={};page(false)}
  else if(f==='logD'){S.logD=v;page(false)}});
let qt;document.addEventListener('input',e=>{const f=e.target.dataset.f;if(!['q','usrQ','stQ','logQ','apQ'].includes(f))return;S[f]=f==='q'?e.target.value.toUpperCase():e.target.value;clearTimeout(qt);
  qt=setTimeout(()=>{const c=e.target.selectionStart;page(false);const n=document.querySelector(`[data-f=${f}]`);if(n){n.focus();try{n.setSelectionRange(c,c)}catch(x){}}},250)});

