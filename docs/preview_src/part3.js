/* ======================= LIVE DASHBOARD ======================= */
const catOk=c=>!S.cat||c===S.cat;
function scope(){let s=roleStores().filter(x=>(!S.zfm||x.zfm===S.zfm)&&(!S.am||x.am===S.am)&&(!S.q||x.code.startsWith(S.q.toUpperCase())));S.path.forEach(p=>{s=s.filter(x=>x[p.key]===p.val)});return s}
const WK={};function weekRows(sh){const k=sh+JSON.stringify(S.exc)+S.settings.sg12a+S.settings.sg8a+STORES.map(s=>s.split?s.split.m:'-').join();if(!WK[k])WK[k]=DATES.map((_,d)=>rowsFor(d,sh,''));return WK[k]}
function weekFor(codes,cats){const set=new Set(codes),W=weekRows(S.shift),r=Array(7).fill(0),p=Array(7).fill(0);W.forEach((rows,d)=>rows.filter(x=>set.has(x.s)&&(!cats||cats.includes(x.c))).forEach(x=>{r[d]+=x.req;p[d]+=Math.min(x.p,x.req)}));return{r,p}}
function weekBoxes(w){return `<span class="hm">${w.r.map((q,i)=>{if(!q)return '<i class="n"></i>';const v=Math.round(pct(w.p[i],q));return `<i class="${v>=90?'g':v>=70?'a':'r'}" title="${DL(i)[0]} Nov · ${v}%">${v}</i>`}).join('')}</span>`}
function alertsOn(){if(S.d<TODAY)return true;return S.lastRef>=(S.shift==='E'?S.settings.alertE:S.settings.alertM)}
function alertStores(k,all){const sc=scope(),set=new Set(sc.map(s=>s.code)),rows=all.filter(x=>set.has(x.s));
  if(k==='hk'||k==='sec'){const c=k==='hk'?'HK':'SEC';return rows.filter(x=>x.c===c&&x.req>0&&x.p===0).map(x=>({s:x.s,info:`${c==='HK'?'Housekeeping':'Security'} 0 of ${x.req}`,miss:x.req}))}
  if(k==='low'){const W=weekRows(S.shift),n=S.settings.lowDays,idx=Array.from({length:n},(_,j)=>S.d-n+1+j).filter(i=>i>=0);if(idx.length<n)return[];const by={};
    idx.forEach((d,j)=>W[d].filter(x=>set.has(x.s)&&catOk(x.c)).forEach(x=>{const o=by[x.s]||(by[x.s]={r:Array(n).fill(0),p:Array(n).fill(0)});o.r[j]+=x.req;o.p[j]+=Math.min(x.p,x.req)}));
    return Object.entries(by).filter(([,o])=>o.r.every((q,j)=>pct(o.p[j],q)<S.settings.lowPct+5)).map(([s,o])=>({s,info:o.r.map((q,j)=>pct(o.p[j],q)+'%').join(' · '),miss:0}))}
  if(k==='photo')return S.d===TODAY?[{s:STORES[2].code,info:'2 selfie due',miss:2},{s:STORES[7].code,info:'1 selfie due',miss:1},{s:STORES[0].code,info:'1 selfie due',miss:1}].filter(x=>set.has(x.s)):[];
  if(k==='split')return sc.filter(s=>!s.split).map(s=>({s:s.code,info:`HK total ${s.hkTot} · M/E split not entered`,miss:0}));
  if(k==='mp'){const out=[];sc.forEach(s=>{const i=SI(s.code);const g=guards(i,S.d,'M').filter(x=>x.mp);if(g.length)out.push({s:s.code,info:`${g.length} mis-punch · ${g.map(x=>x.n).join(', ')}`,miss:g.length})});return out}
  if(k==='nob')return[...alertStores('hk',all),...alertStores('sec',all)];
  if(k==='low7'){const by={};rows.filter(x=>catOk(x.c)).forEach(x=>{const o=by[x.s]||(by[x.s]={q:0,p:0});o.q+=x.req;o.p+=Math.min(x.p,x.req)});return Object.entries(by).filter(([,o])=>pct(o.p,o.q)<S.settings.lowPct).map(([s,o])=>({s,info:pct(o.p,o.q)+'% now'}))}
  return[]}
function cur(){return rowsFor(S.d,S.shift,S.upto)}
function cpPct(d,v,stores){const set=new Set(stores.map(s=>s.code)),r=rowsFor(d,S.shift,v).filter(x=>set.has(x.s)&&catOk(x.c));return pct(r.reduce((a,x)=>a+Math.min(x.p,x.req),0),r.reduce((a,x)=>a+x.req,0))}
function pLd(){if(lockCat())S.cat=lockCat();
  const all=cur(),stores=scope(),set=new Set(stores.map(s=>s.code)),rows=all.filter(x=>set.has(x.s)),rc=rows.filter(x=>catOk(x.c));
  const tot=rc.reduce((a,x)=>({req:a.req+x.req,p:a.p+Math.min(x.p,x.req)}),{req:0,p:0}),tp=pct(tot.p,tot.req);
  const by={};rc.forEach(x=>{const o=by[x.s]||(by[x.s]={req:0,p:0});o.req+=x.req;o.p+=Math.min(x.p,x.req)});
  const full=Object.values(by).filter(o=>o.req&&o.p>=o.req).length,low=alertStores('low7',all).length,nob=new Set(alertStores('nob',all).map(x=>x.s)).size;
  const cats=lockCat()?CATS.filter(c=>c.id===lockCat()):CATS;
  const y=S.d>0?cpPct(S.d-1,S.upto,stores):null,dlt=y!=null?+(tp-y).toFixed(1):null;
  // compact time selector: today's later times are not reached yet
  const tsel=`<div class="seg" title="Dashboard as of a fixed time">${CP.map(([v,l])=>{const pend=S.d===TODAY&&v&&v>S.lastRef;return `<button data-cp="${v}" class="${S.upto===v?'on':''}" ${pend?'disabled title="Not reached yet"':''}>${l}</button>`}).join('')}</div>`;
  const AL=[['hk','HK nobody','r'],['sec','Security nobody','r'],['mp','SG mis-punch','a'],['split','HK split not set','a'],['low',`Below ${S.settings.lowPct+5}% · ${S.settings.lowDays} days`,'a'],['photo','Selfie due','i']].filter(([k])=>!(lockCat()&&(k==='hk'||k==='split'))&&!(S.cat&&S.cat!=='SEC'&&k==='mp')&&!(S.cat&&S.cat!=='HK'&&k==='split'));
  return `
  <div class="toolrow"><div class="pills">${lockCat()?`<span class="pill on">Security</span>`:`<button class="pill ${!S.cat?'on':''}" data-cat="">All depts</button>${cats.map(c=>`<button class="pill ${S.cat===c.id?'on':''}" data-cat="${c.id}">${c.n}</button>`).join('')}`}</div>
   <div class="pills"><div class="seg">${[['M','Morning'],['E','Evening'],['B','Both']].map(([v,l])=>`<button data-sh="${v}" class="${S.shift===v?'on':''}">${l}</button>`).join('')}</div>${tsel}</div></div>
  <div class="kpis">
   <div class="kpi"><span class="l">Required</span><span class="v">${fmt(tot.req)}</span><span class="d">${stores.length} store${pl(stores.length)} · ${{M:'Morning',E:'Evening',B:'Both shifts'}[S.shift]}</span></div>
   <div class="kpi"><span class="l">Present</span><span class="v">${fmt(tot.p)} <span class="tg ${tp>=90?'ok':tp>=70?'amb':'red'}" style="vertical-align:4px">${tp}%</span></span><span class="d">${dlt!=null?`<b style="color:${dlt>=0?'var(--ok)':'var(--red)'}">${dlt>=0?'▲ +':'▼ '}${dlt} pts</b> vs ${S.d===TODAY?'yesterday':'day before'} ${S.upto?'at '+CP.find(c=>c[0]===S.upto)[1]:''}`:''}</span><div class="track"><i style="width:${tp}%;background:${col(tp)}"></i></div></div>
   <div class="kpi"><span class="l">Not punched</span><span class="v" style="color:var(--red)">${fmt(tot.req-tot.p)}</span><span class="d">${tot.req?(100-tp).toFixed(1):0}% of required</span></div>
   <div class="kpi"><span class="l">Stores at 100%</span><span class="v" style="color:var(--ok)">${full}</span><span class="d">of ${Object.keys(by).length} with requirement</span></div>
   <button class="kpi fl a ${S.alert==='low7'?'on':''}" data-al="low7"><span class="l">Stores below ${S.settings.lowPct}%</span><span class="v" style="color:var(--amb)">${low} store${pl(low)}</span><span class="go">${S.alert==='low7'?'Showing ✓ · click to clear':'Click to filter stores'}</span></button>
   <button class="kpi fl r ${S.alert==='nob'?'on':''}" data-al="nob"><span class="l">${lockCat()?'Security · nobody':'HK / Security · nobody'}</span><span class="v" style="color:var(--red)">${nob} store${pl(nob)}</span><span class="go">${S.alert==='nob'?'Showing ✓ · click to clear':'Click to filter stores'}</span></button>
  </div>
  <div class="astrip"><span class="t">⚡ Action needed</span>${alertsOn()?AL.map(([k,t,c])=>{const l=alertStores(k,all),n=k==='photo'||k==='mp'?l.reduce((a,x)=>a+x.miss,0):l.length;return `<button class="ach ${c} ${S.alert===k?'on':''} ${n?'':'zero'}" data-al="${k}">${t} <b>${n}</b></button>`}).join(''):`<span class="sub" style="margin:0">Starts at ${S.shift==='E'?S.settings.alertE:S.settings.alertM} for this shift (Settings)</span>`}</div>
  <div class="cols">
   <div class="card"><h2>Last 7 days</h2><div class="sub">Present % of required, end of day. Today is live. Lighter bars are Sat and Sun. Click a bar to open that day.</div>${trend(stores)}</div>
   <div class="card"><h2>Dept-wise · required vs present</h2><div class="sub">Dashed box = required · bar = present.${lockCat()?' Security = P + H (half day).':' Click a dept to filter.'}</div>${ladder(rows,cats)}</div>
  </div>
  ${gapTable(stores,rows,all)}
  <div id="sd"></div>`}
function trend(stores){const w=weekFor(stores.map(s=>s.code),S.cat?[S.cat]:null),v=w.r.map((q,i)=>pct(w.p[i],q)),W=560,H=190,bw=44,gap=(W-40-bw*7)/6,avg=(v.slice(0,6).reduce((a,b)=>a+b,0)/6).toFixed(1),y=x=>H-28-(x/100)*(H-50);
  return `<svg class="ch" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;margin-top:6px">${[0,25,50,75,100].map(t=>`<line x1="30" x2="${W}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="24" y="${y(t)+4}" text-anchor="end">${t}</text>`).join('')}
  <line x1="30" x2="${W}" y1="${y(avg)}" y2="${y(avg)}" stroke="var(--grey)" stroke-dasharray="4 4"/><text x="${W}" y="10" text-anchor="end">- - - 6-day avg ${avg}%</text>
  ${v.map((x,i)=>{const X=36+i*(bw+gap),dd=DL(i),we=dd[1]==='Sat'||dd[1]==='Sun',c=i===S.d?'var(--acc)':we?'var(--wk)':'var(--pri)';return `<g data-day="${i}" style="cursor:pointer"><rect class="br" x="${X}" y="${y(x)}" width="${bw}" height="${y(0)-y(x)}" rx="4" fill="${c}"/><text class="b" x="${X+bw/2}" y="${y(x)-6}" text-anchor="middle">${x}</text><text x="${X+bw/2}" y="${H-14}" text-anchor="middle" ${i===S.d?'class="b"':''}>${dd[0]}</text><text x="${X+bw/2}" y="${H-2}" text-anchor="middle">${dd[1]}</text></g>`}).join('')}</svg>`}
function ladder(rows,cats){const mx=Math.max(...cats.map(c=>rows.filter(x=>x.c===c.id).reduce((a,x)=>a+x.req,0)),1);
  let sg='';if(cats.some(c=>c.id==='SEC')&&catOk('SEC')){const c={P:0,H:0,A:0,MP:0,'P*':0};scope().forEach(s=>{if(S.shift==='E')return;guards(SI(s.code),S.d,'M').forEach(g=>c[g.st]=(c[g.st]||0)+1)});
    sg=`<div class="sub" style="margin-top:12px;font-weight:700">Security today (Morning) · by hours rule</div><div class="pills" style="margin-top:6px"><span class="tg ok">P ${c.P}</span><span class="tg acc">P* ${c['P*']}</span><span class="tg amb">H ${c.H}</span><span class="tg red">A ${c.A}</span><span class="tg grey">MP ${c.MP} (counts A till RLPO)</span></div>`}
  return `<div class="lad">${cats.map(c=>{const cr=rows.filter(x=>x.c===c.id),q=cr.reduce((a,x)=>a+x.req,0),p=cr.reduce((a,x)=>a+Math.min(x.p,x.req),0),v=pct(p,q),z=cr.filter(x=>x.req&&!x.p).length;
   return `<button class="rn ${S.cat===c.id?'on':''}" data-cat="${lockCat()?c.id:S.cat===c.id?'':c.id}">${c.n}</button><div class="stack"><span class="bm" style="width:${q/mx*100}%"></span><span class="pr" style="width:${p/mx*100}%;background:${col(v)}"></span></div><div class="nums">${q?`<b>${p}</b> / ${q} · <b style="color:${col(v)}">${v}%</b>`:'Not required'}${z?`<br><span style="color:var(--red)">${z} store${pl(z)} with 0</span>`:''}</div>`}).join('')}</div>
  <div class="leg"><span><i style="border:1.5px dashed var(--grey);height:9px"></i>Required</span><span><i style="background:var(--ok)"></i>90%+</span><span><i style="background:var(--amb)"></i>70–90%</span><span><i style="background:var(--red)"></i>Below 70%</span></div>${sg}`}
function level(){return S.alert?'store':S.path.length?S.path[S.path.length-1].next:S.view}
function gapLines(stores,rows,all){const lv=level();let lines;
  if(lv==='dept'){lines=CATS.filter(c=>catOk(c.id)).map(c=>{const cr=rows.filter(x=>x.c===c.id),req=cr.reduce((a,x)=>a+x.req,0),p=cr.reduce((a,x)=>a+Math.min(x.p,x.req),0);return{key:c.id,name:c.n,n:new Set(cr.map(x=>x.s)).size,req,p,pc:pct(p,req),zero:cr.filter(x=>x.req&&!x.p).length,wk:weekFor(stores.map(s=>s.code),[c.id])}}).filter(l=>l.req)}
  else{let fs=stores;if(S.alert){const m=new Map(alertStores(S.alert,all).map(x=>[x.s,x]));fs=stores.filter(s=>m.has(s.code)).map(s=>({...s,_i:m.get(s.code).info}))}
   const K={zfm:s=>s.zfm,am:s=>s.am,store:s=>s.code},N={zfm:s=>s.zfm_name,am:s=>s.am_name,store:s=>s.name},g=new Map();
   fs.forEach(s=>{const k=K[lv](s);if(!g.has(k))g.set(k,{key:k,name:N[lv](s),zfm:s.zfm_name,am:s.am_name,stores:[],info:s._i});g.get(k).stores.push(s.code)});
   lines=[...g.values()].map(x=>{const st=new Set(x.stores),gr=rows.filter(r=>st.has(r.s)&&catOk(r.c)),req=gr.reduce((a,r)=>a+r.req,0),p=gr.reduce((a,r)=>a+Math.min(r.p,r.req),0);return{...x,n:x.stores.length,req,p,pc:pct(p,req),zero:new Set(gr.filter(r=>r.req&&!r.p).map(r=>r.s)).size,wk:weekFor(x.stores,S.cat?[S.cat]:null)}})}
  return lines.sort((a,b)=>a.pc-b.pc)}
const ALN={hk:'HK nobody',sec:'Security nobody',low:'Low 3 days',photo:'Selfie due',nob:'HK / Security nobody',low7:'Below 70% now',split:'HK split not set',mp:'SG mis-punch'};
function gapTable(stores,rows,all){const lv=level(),lines=gapLines(stores,rows,all);S._lines=lines;S._lv=lv;
  const views=[['zfm','ZFM'],['am','AM'],['store','Store'],['dept','Dept']].filter(([v])=>!((S.role==='am'||S.role==='rlpo')&&(v==='zfm'||v==='am'))&&!(S.role==='zfm'&&v==='zfm')&&!(lockCat()&&v==='dept'));
  if(!views.some(v=>v[0]===S.view))S.view=views[0][0];
  const head={zfm:'ZFM',am:'AM',store:'Store',dept:'Dept'}[lv];
  const chips=[S.cat&&!lockCat()&&`<button class="chip" data-clr="cat">${CATS.find(c=>c.id===S.cat).n} ✕</button>`,S.alert&&`<button class="chip" data-clr="alert">${ALN[S.alert]} ✕</button>`,S.q&&`<button class="chip" data-clr="q">Store ${esc(S.q.toUpperCase())} ✕</button>`].filter(Boolean).join(' ');
  return `<div class="card"><div class="hd"><div><h2>Where the gaps are</h2><div class="sub">Lowest % first · click a row to ${lv==='store'?'see people':'open'}</div></div>
   <div class="pills"><span class="sub" style="margin:0 4px 0 0;font-weight:700">VIEW BY</span>${views.map(([v,l])=>`<button class="pill ${S.view===v&&!S.alert&&!S.path.length?'on':''}" data-vw="${v}">${l}</button>`).join('')}</div></div>
   <div class="bc" style="margin-top:8px"><button data-bc="-1">All</button>${S.path.map((p,i)=>` › <button data-bc="${i}">${esc(p.name)}</button>`).join('')} ${chips}</div>
   <div class="tw"><table><thead><tr><th class="l">${head}</th>${lv==='am'?'<th class="l">ZFM</th>':''}${lv==='store'?'<th class="l">AM</th>':''}${lv!=='store'?'<th>Stores</th>':''}<th>Required</th><th>Present</th><th>Gap</th><th>%</th><th class="l">${lv==='store'?'Status':'Stores with a gap'}</th>${S.alert?'<th class="l">Why</th>':''}<th class="l">Last 7 days (%)</th></tr></thead><tbody>
   ${lines.map(l=>`<tr class="click" data-k="${esc(l.key)}" data-n="${esc(l.name)}"><td class="l"><span class="lk">${esc(lv==='store'?l.key:l.name)}</span>${lv==='store'?' '+esc(l.name):''}</td>${lv==='am'?`<td class="l">${esc(l.zfm)}</td>`:''}${lv==='store'?`<td class="l">${esc(l.am)}</td>`:''}${lv!=='store'?`<td>${l.n}</td>`:''}
    <td>${l.req}</td><td>${l.p}</td><td style="color:${l.req-l.p?'var(--red)':'var(--mut)'};font-weight:700">${l.req-l.p?'-'+(l.req-l.p):'0'}</td><td>${l.req?heat(l.pc):'—'}</td>
    <td class="l">${l.zero?`<span class="tg red">${lv==='store'?'Nobody in a dept':l.zero+' store'+pl(l.zero)}</span>`:lv==='store'?(l.pc>=90?'<span class="tg ok">On track</span>':'<span class="tg amb">Short</span>'):'—'}</td>${S.alert?`<td class="l">${esc(l.info||'')}</td>`:''}
    <td class="l">${weekBoxes(l.wk)}</td></tr>`).join('')||'<tr><td colspan="10" class="l" style="color:var(--mut)">No stores here</td></tr>'}</tbody></table></div></div>`}
function people(code,d,sh){const i=SI(code),rs=rowsFor(d,sh,S.upto).filter(x=>x.s===code&&catOk(x.c));let k=i*3;
  return rs.map(r=>{if(r.c==='SEC'){const g=(sh==='B'?[...guards(i,d,'M'),...guards(i,d,'E')]:guards(i,d,sh));return{...r,sg:true,ppl:g}}
    const base=Array.from({length:r.p},(_,j)=>{const n=NAMES[(k++)%NAMES.length],o=j%3===0&&d===TODAY?null:'1'+(7+(j%3))+':'+String(5+j*11).slice(-2).padStart(2,'0');return{n,code:code+'-'+(101+k),in:'0'+(8+(j%2))+':'+String(10+j*7).slice(-2).padStart(2,'0'),out:o,hrs:o?(8.2+j*.4).toFixed(1):'—',via:j===1?'Store':'Own',photo:j===0?'done':''}});
    const add=S.extra.filter(e=>e.s===code&&e.c===r.c&&d===TODAY).map(e=>({n:e.n,code:'NEW',in:e.t,out:null,hrs:'—',via:'Store',photo:''}));return{...r,ppl:base.concat(add)}})}
const SGT={P:'<span class="tg ok">P</span>',H:'<span class="tg amb">H · half day</span>',A:'<span class="tg red">A</span>',MP:'<span class="tg grey">MP · with RLPO</span>','P*':'<span class="tg acc">P* · RLPO exception</span>'};
function storeDetail(code,scroll=true){const s=STORES[SI(code)],gs=people(code,S.d,S.shift);
  const body=gs.map(r=>{const c=CATS.find(x=>x.id===r.c).n;
   if(r.sg){const n=Math.max(r.ppl.length,1),pr=r.ppl.filter(g=>g.st!=='A'&&g.st!=='MP').length;
     const head=`<td class="l" rowspan="${n}" style="vertical-align:top"><b>${c}</b><small>Vendor: ${VENDOR.SEC} · ${s.set}-hr set</small><small>RLPO: ${esc(rlName(s.rlpo)||'—')}</small></td><td rowspan="${n}" style="vertical-align:top">${r.req}</td><td rowspan="${n}" style="vertical-align:top">${pr}</td><td class="l" rowspan="${n}" style="vertical-align:top">${r.req>pr?`<span class="tg red">Missing ${r.req-pr}</span>`:'<span class="tg ok">OK</span>'}</td>`;
     return r.ppl.map((g,i)=>`<tr>${i?'':head}<td class="l">${g.n}</td><td class="l">${g.code}</td><td class="l" colspan="3">${SGT[g.st]}${g.exc?` <small>${esc(g.exc.why)}</small>`:''}</td><td class="l">Own</td><td class="l"><button class="lk" data-stm="${code}|${g.n}|SEC">Statement</button></td></tr>`).join('')}
   const n=Math.max(r.ppl.length,1),pr=r.ppl.length;
   const head=`<td class="l" rowspan="${n}" style="vertical-align:top"><b>${c}</b><small>Vendor: ${VENDOR[r.c]}</small></td><td rowspan="${n}" style="vertical-align:top">${r.req}</td><td rowspan="${n}" style="vertical-align:top">${pr}</td><td class="l" rowspan="${n}" style="vertical-align:top">${r.req>pr?`<span class="tg red">Missing ${r.req-pr}</span>`:'<span class="tg ok">OK</span>'}</td>`;
   if(!pr)return `<tr>${head}<td class="l" colspan="7" style="color:var(--red);font-weight:700">Nobody has punched</td></tr>`;
   return r.ppl.map((p,i)=>`<tr>${i?'':head}<td class="l">${p.n}</td><td class="l">${p.code}</td><td>${p.in}</td><td>${p.out||'—'}</td><td>${p.hrs}</td><td class="l">${p.via==='Store'?'<span class="tg amb">Store</span>':'Own'}</td><td class="l">${p.photo?'📷 <span class="tg ok">Live ✓</span> ':''}<button class="lk" data-stm="${code}|${p.n}|${r.c}">Statement</button></td></tr>`).join('')}).join('');
  $('#sd').innerHTML=`<div class="card"><div class="hd"><div><h2>${code} · ${s.name}</h2><div class="sub">AM ${s.am_name} · ZFM ${s.zfm_name} · ${DL(S.d)[0]} Nov · ${{M:'Morning',E:'Evening',B:'Both shifts'}[S.shift]} · Security shows status only (no timing)</div></div><button class="btn s sm" data-x="closesd">✕ Close</button></div>
  <div class="tw"><table><thead><tr><th class="l">Dept</th><th>Required</th><th>Present</th><th class="l">Status</th><th class="l">Name</th><th class="l">Code</th><th>IN</th><th>OUT</th><th>Hours</th><th class="l">Phone</th><th class="l">Photo · Statement</th></tr></thead><tbody>${body||'<tr><td class="l" colspan="11">Nothing required in this shift</td></tr>'}</tbody></table></div></div>`;
  if(scroll)$('#sd').scrollIntoView({behavior:'smooth',block:'start'})}
function excelLd(){const L=S._lines||[],lv=S._lv,H={zfm:'ZFM',am:'AM',store:'Store',dept:'Dept'}[lv];
  xlsx(L.map(l=>({[H]:lv==='store'?l.key:l.name,...(lv==='store'?{'Store name':l.name,AM:l.am}:{}),...(lv==='am'?{ZFM:l.zfm}:{}),...(lv!=='store'?{Stores:l.n}:{}),Required:l.req,Present:l.p,Gap:l.req-l.p,'%':l.pc,
    ...Object.fromEntries(l.wk.r.map((q,i)=>[DL(i)[0]+' Nov %',q?pct(l.wk.p[i],q):'']))})),`3PA_Live_${H}_${DATES[S.d]}_${S.shift}.xlsx`,'Live')}
