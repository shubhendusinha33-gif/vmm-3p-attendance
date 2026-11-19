/* ======================= v6: login hero about 3rd-party staff (guards, housekeeping, promoters) — same Store Live motion ======================= */
// simple flat people (original drawings): skin, uniform colour, prop
function person(x,y,uni,cap,prop,delay){return `<g class="pp" style="animation-delay:${delay}s" transform="translate(${x} ${y})">
  <ellipse cx="0" cy="62" rx="18" ry="4" fill="rgba(0,0,0,.25)"/>
  <rect x="-13" y="16" width="26" height="34" rx="10" fill="${uni}"/>
  <rect x="-11" y="46" width="9" height="16" rx="3" fill="#2B3445"/><rect x="2" y="46" width="9" height="16" rx="3" fill="#2B3445"/>
  <circle cx="0" cy="6" r="10" fill="#E6B98F"/>${cap}${prop}</g>`}
const CAP={guard:'<path d="M-11 0 Q0 -10 11 0 L11 2 L-11 2 Z" fill="#1F2A44"/><rect x="-13" y="1" width="26" height="3" rx="1.5" fill="#1F2A44"/><circle cx="0" cy="-2" r="2" fill="#FBBF24"/>',hk:'<path d="M-10 0 Q0 -9 10 0 Z" fill="#0EA5A4"/>',prom:'<path d="M-10 -1 Q0 -11 10 -1 L13 1 L-10 1 Z" fill="#F97316"/>'};
const PROP={shield:'<g transform="translate(14 22)"><path d="M0 0 L9 3 L9 10 Q9 17 0 20 Q-9 17 -9 10 L-9 3 Z" fill="#FBBF24"/><path d="M-4 10 L-1 13 L5 6" stroke="#1F2A44" stroke-width="2" fill="none"/></g>',
  mop:'<g class="mop"><line x1="13" y1="20" x2="22" y2="62" stroke="#A16207" stroke-width="3" stroke-linecap="round"/><rect x="15" y="58" width="16" height="6" rx="2" fill="#5EEAD4"/></g>',
  badge:'<g transform="translate(-6 24)"><rect width="12" height="9" rx="2" fill="#fff"/><rect x="2" y="3" width="8" height="1.5" fill="#F97316"/><rect x="2" y="6" width="5" height="1.5" fill="#94A3B8"/></g>',
  phone:'<g transform="translate(13 18)"><rect width="12" height="20" rx="2.5" fill="#0F172A" stroke="#fff" stroke-width="1"/><rect x="2" y="3" width="8" height="12" rx="1" fill="#38BDF8"/></g>'};
SL=[['Security guards','12-hr and 8-hr shifts · A / H / P by hours','sg'],['Housekeeping','Morning and evening crew, store by store','hk'],['Promoters','QR scan + selfie punch in 1 second','pr']];
function slideSvg(k){
  if(k==='sg'){const tick=[0,1,2,3,4,5,6,7,8,9,10,11].map(i=>{const a=i*30*Math.PI/180;return `<line x1="${200+Math.sin(a)*40}" y1="${78-Math.cos(a)*40}" x2="${200+Math.sin(a)*46}" y2="${78-Math.cos(a)*46}" stroke="rgba(255,255,255,.5)" stroke-width="${i%3?1:2}"/>`}).join('');
    return `<svg viewBox="0 0 300 170">${person(48,58,'#334155',CAP.guard,PROP.shield,0)}${person(102,62,'#334155',CAP.guard,'',.15)}
     <circle cx="200" cy="78" r="52" fill="rgba(255,255,255,.06)" stroke="rgba(255,255,255,.18)"/><circle class="arc" cx="200" cy="78" r="52" fill="none" stroke="#4CEB8B" stroke-width="6" stroke-linecap="round" stroke-dasharray="327" transform="rotate(-90 200 78)"/>${tick}
     <line class="hand" x1="200" y1="78" x2="200" y2="44" stroke="#fff" stroke-width="3" stroke-linecap="round" style="transform-origin:200px 78px"/><circle cx="200" cy="78" r="4" fill="#fff"/>
     <text x="200" y="146" text-anchor="middle" style="font-weight:700">12-hr shift</text>
     <g class="pop" style="animation-delay:1.4s"><rect x="252" y="26" width="38" height="20" rx="10" fill="#4CEB8B"/><text x="271" y="40" text-anchor="middle" style="fill:#0F172A;font-weight:800">P</text></g>
     <g class="pop" style="animation-delay:1.7s"><rect x="252" y="54" width="38" height="20" rx="10" fill="#FFD27A"/><text x="271" y="68" text-anchor="middle" style="fill:#0F172A;font-weight:800">H</text></g>
     <g class="pop" style="animation-delay:2s"><rect x="252" y="82" width="38" height="20" rx="10" fill="#FFB3A7"/><text x="271" y="96" text-anchor="middle" style="fill:#0F172A;font-weight:800">A</text></g></svg>`}
  if(k==='hk')return `<svg viewBox="0 0 300 170">${person(40,58,'#0F766E',CAP.hk,PROP.mop,0)}${person(96,62,'#0F766E',CAP.hk,'',.15)}
     <text x="150" y="30" style="font-weight:700">Morning</text><text x="150" y="88" style="font-weight:700">Evening</text>
     ${[0,1,2].map(i=>`<g class="pop" style="animation-delay:${.3+i*.15}s"><circle cx="${160+i*26}" cy="52" r="10" fill="#5EEAD4"/><rect x="${152+i*26}" y="60" width="16" height="10" rx="4" fill="#5EEAD4"/></g>`).join('')}
     ${[0,1].map(i=>`<g class="pop" style="animation-delay:${.8+i*.15}s"><circle cx="${160+i*26}" cy="110" r="10" fill="#99F6E4"/><rect x="${152+i*26}" y="118" width="16" height="10" rx="4" fill="#99F6E4"/></g>`).join('')}
     <g class="pop" style="animation-delay:1.3s"><rect x="232" y="94" width="58" height="38" rx="8" fill="rgba(255,255,255,.1)" stroke="rgba(255,255,255,.25)"/><text x="261" y="110" text-anchor="middle" style="font-size:10px">Total</text><text x="261" y="126" text-anchor="middle" style="font-weight:800;font-size:15px">3 + 2</text></g>
     <text x="150" y="160" style="font-size:10px;opacity:.8">Admin sets the total · store splits it</text></svg>`;
  return `<svg viewBox="0 0 300 170">${person(36,58,'#C2410C',CAP.prom,PROP.badge,0)}${person(86,62,'#7C3AED','<path d="M-10 -1 Q0 -11 10 -1 L13 1 L-10 1 Z" fill="#A78BFA"/>',PROP.phone,.15)}
     <g transform="translate(150 18)"><rect width="62" height="112" rx="12" fill="#0F172A" stroke="rgba(255,255,255,.5)"/><rect x="6" y="12" width="50" height="80" rx="6" fill="#1E293B"/>
      <ellipse cx="31" cy="50" rx="15" ry="20" fill="none" stroke="#4CEB8B" stroke-width="2"/><circle cx="31" cy="46" r="8" fill="#E6B98F"/><rect x="21" y="56" width="20" height="12" rx="6" fill="#C2410C"/>
      <rect class="scan" x="8" y="20" width="46" height="2" fill="#4CEB8B"/><g class="pop" style="animation-delay:1.5s"><circle cx="31" cy="100" r="7" fill="#4CEB8B"/><path d="M27 100 L30 103 L35 97" stroke="#0F172A" stroke-width="2" fill="none"/></g></g>
     <g transform="translate(232 30)">${[[0,0],[16,0],[0,16]].map(([x,y])=>`<rect x="${x}" y="${y}" width="12" height="12" fill="none" stroke="#fff" stroke-width="2"/><rect x="${x+4}" y="${y+4}" width="4" height="4" fill="#fff"/>`).join('')}<rect x="18" y="18" width="4" height="4" fill="#fff"/><rect x="24" y="22" width="4" height="4" fill="#fff"/></g>
     <text x="246" y="80" text-anchor="middle" style="font-size:10px">Store QR</text>
     <g class="pop" style="animation-delay:1.8s"><rect x="222" y="98" width="72" height="22" rx="11" fill="#4CEB8B"/><text x="258" y="113" text-anchor="middle" style="fill:#0F172A;font-weight:800;font-size:11px">IN 08:02 ✓</text></g></svg>`}
const _pLogin=pLogin;
pLogin=function(){return _pLogin().replace(/<h2>.*?<\/h2>/,'<h2>Every guard, cleaner and promoter. <em>On duty, on time.</em></h2>')
  .replace(/<p class="ld">.*?<\/p>/,'<p class="ld">One live view of your third-party staff: security guards, housekeeping crew and brand promoters, from every vendor, in every store, every shift.</p>')
  .replace(/<div class="lstats">.*?<\/div><\/div><\/div>/s,'<div class="lstats"><div><b>1,704</b><span>security guards</span></div><div><b>3,410</b><span>housekeeping</span></div><div><b>1,120</b><span>promoters</span></div><div><b>27</b><span>vendors</span></div></div></div>')
  .replace('Sample data shown.','').replace(/Sample data shown\./g,'')};

(function init(){const p=store.get('3pa_theme');if(p)setTheme(p);if(store.get('3pa_dark'))setTheme(null,true);idleReset();shell()})();
