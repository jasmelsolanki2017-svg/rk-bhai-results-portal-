const $=s=>document.querySelector(s);
async function api(url,opts={}){const r=await fetch(url,{credentials:"same-origin",...opts,headers:{...(opts.body?{"Content-Type":"application/json"}:{}),...(opts.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Request failed");return d;}
function esc(v){return String(v??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
function show(on){$("#loginBox").hidden=on;$("#managePanel").hidden=!on;}
function showUserTab(tab){
 const demo=tab==="demo";
 if(location.hash!==(demo?"#demo-users":"#superusers")) history.replaceState(null,"",demo?"#demo-users":"#superusers");
 $("#userManagementTitle").textContent=demo?"🎮 Demo User Management":"👑 Super User Management";
 $("#userManagementDescription").textContent=demo?"Demo Game users, उनकी Plays, Points और Calendar हिसाब manage करें।":"Superuser / Portal accounts, access duration और city assignments manage करें।";
 document.title="👑 Satta king 👑 | "+(demo?"Demo User Management":"Super User Management");
 $("#portalUsersPanel").hidden=demo;
 $("#portalCityPanel").hidden=demo;
 $("#demoUsersPanel").hidden=!demo;
}
$("#loadDemoLedger").addEventListener("click",loadDemoLedger);
$("#loadDemoPlays").addEventListener("click",loadDemoPlays);
async function loadDemoPlays(){
 const msg=$("#demoPlaysMsg"),out=$("#demoPlaysList"),status=$("#demoPlayStatusFilter").value;
 msg.textContent="Plays लोड हो रही हैं…";out.innerHTML="";
 try{
  const d=await api("/api/admin/demo-plays?status="+encodeURIComponent(status));
  const plays=d.plays||[];
  msg.textContent="कुल "+plays.length+" हाल की Plays";
  const sorted=[...plays].sort((a,b)=>{
   const user=String(a.playerId?._id||"").localeCompare(String(b.playerId?._id||""));
   if(user)return user;
   const market=String(a.market||"").localeCompare(String(b.market||""));
   if(market)return market;
   const date=String(a.playDate||"").localeCompare(String(b.playDate||""));
   if(date)return date;
   return new Date(a.createdAt)-new Date(b.createdAt)||Number(a.number||0)-Number(b.number||0);
  });
  const batches=[];
  sorted.forEach(p=>{
   const batchKey=[p.playerId?._id||"",p.market,p.playDate,p.status,p.points,p.playType||"NUMBER",p.lineDigit??"",Math.floor(new Date(p.createdAt).getTime()/3000)].join("|");
   let batch=batches.find(x=>x.key===batchKey);
   if(!batch){batch={key:batchKey,rows:[]};batches.push(batch);}
   batch.rows.push(p);
  });
  const cards=[];
  batches.forEach(batch=>{
   const rows=batch.rows.sort((a,b)=>Number(a.number)-Number(b.number));
   let groups=[];
   rows.forEach(p=>{
    const n=Number(p.number),last=groups[groups.length-1];
    if(last&&p.playType!=="LINE"&&last.playType!=="LINE"&&n===last.to+1){last.to=n;last.rows.push(p);}
    else groups.push({from:n,to:n,playType:p.playType||"NUMBER",lineDigit:p.lineDigit,rows:[p]});
   });
   groups.forEach(g=>{
    const first=g.rows[0],count=g.rows.length,total=g.rows.reduce((s,p)=>s+Number(p.points||0),0);
    const range=g.playType==="LINE"?"Line "+g.lineDigit:(count>1?String(g.from).padStart(2,"0")+"-"+String(g.to).padStart(2,"0"):"Number "+String(g.from).padStart(2,"0"));
    const amount=count>1?money(first.points)+" × "+count+" = "+money(total)+" Points":money(total)+" Points";
    const ids=g.rows.map(p=>p._id).join(",");
    cards.push({time:new Date(first.createdAt).getTime(),html:'<article class="admin-row"><div class="admin-row-info"><b>'+esc(first.playerId?.name||"Deleted User")+' · '+esc(first.playerId?.mobile||"")+'</b><p>'+esc(first.market)+' · '+esc(range)+' · '+esc(first.playDate)+' · '+amount+' · <strong>'+esc(first.status)+'</strong></p></div><div class="actions">'+(first.status==="PENDING"?'<button type="button" class="danger" data-playnotok-group="'+esc(ids)+'">Not OK · Points वापस करें ('+count+')</button>':'')+'</div></article>'});
   });
  });
  cards.sort((a,b)=>b.time-a.time);
  out.innerHTML=cards.length?cards.map(x=>x.html).join(""):'<p class="muted">कोई Play नहीं मिली।</p>';
 }catch(e){msg.textContent=e.message;}
}


function currentIndiaMonth(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit"}).format(new Date());}
function money(v){return Number(v||0).toLocaleString("en-IN",{maximumFractionDigits:1});}
async function loadDemoLedger(){
 const userId=$("#demoLedgerUser").value,month=$("#demoLedgerMonth").value,msg=$("#demoLedgerMsg"),out=$("#demoLedgerResult");
 if(!userId||!month){msg.textContent="पहले Demo User और महीना चुनें।";return;}
 msg.textContent="हिसाब लोड हो रहा है…";out.innerHTML="";
 try{
  const d=await api("/api/admin/demo-players/"+encodeURIComponent(userId)+"/ledger?month="+encodeURIComponent(month));
  msg.textContent=d.player.name+" · "+month+" · कुल लगाए "+money(d.totals.staked)+" Points · Return "+money(d.totals.returned)+" Points · Net "+(d.totals.net>=0?"+":"")+money(d.totals.net)+" Points";
  out.innerHTML=d.markets.length?d.markets.map(m=> '<section class="admin-box" style="margin-top:12px"><h3>'+esc(m.market)+'</h3><p class="muted">कुल Play: '+m.totals.plays+' · जीत: '+m.totals.wins+' · हार: '+m.totals.losses+' · Pending: '+m.totals.pending+' · लगाए: '+money(m.totals.staked)+' · Return: '+money(m.totals.returned)+' · Net: '+(m.totals.net>=0?"+":"")+money(m.totals.net)+'</p><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:650px"><thead><tr><th style="text-align:left;padding:8px">तारीख</th><th style="text-align:right;padding:8px">Play</th><th style="text-align:right;padding:8px">जीत / हार / Pending</th><th style="text-align:right;padding:8px">लगाए Points</th><th style="text-align:right;padding:8px">Return</th><th style="text-align:right;padding:8px">Net</th></tr></thead><tbody>'+m.days.map(day=> '<tr><td style="padding:8px">'+esc(day.date)+'</td><td style="text-align:right;padding:8px">'+day.plays+'</td><td style="text-align:right;padding:8px">'+day.wins+' / '+day.losses+' / '+day.pending+'</td><td style="text-align:right;padding:8px">'+money(day.staked)+'</td><td style="text-align:right;padding:8px">'+money(day.returned)+'</td><td style="text-align:right;padding:8px">'+(day.net>=0?"+":"")+money(day.net)+'</td></tr>').join("")+'</tbody></table></div></section>').join(""):'<p class="muted">इस महीने इस User की कोई Play नहीं मिली।</p>';
  if(d.walletTransactions.length)out.innerHTML+= '<section class="admin-box" style="margin-top:12px"><h3>Wallet Transactions</h3>'+d.walletTransactions.map(t=> '<p style="padding:7px 0;border-bottom:1px solid #ddd">'+esc(t.date)+' · '+esc(String(t.reason||"—").replace(/^Demo Play\s*·\s*/i,""))+' · <b>'+(t.type==="CREDIT"?"+":"-")+money(t.amount)+'</b></p>').join("")+'</section>';
 }catch(e){msg.textContent=e.message;}
}
function indiaToday(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
async function refresh(){
 const users=await api("/api/admin/users");
 await loadAssignableChartCities();
 $("#usersList").innerHTML=users.map((u,i)=>'<article class="user-manage-card"><div class="user-card-head"><div class="user-identity"><span class="user-number">USER '+(i+1)+'</span><h3>'+esc(u.name||"नाम उपलब्ध नहीं")+'</h3><span class="username-tag">@'+esc(u.username)+'</span></div><span class="account-status '+(u.active?"is-active":"is-disabled")+'">'+(u.active?"ACTIVE":"DISABLED")+'</span></div><div class="user-details-grid"><div><small>मोबाइल नंबर</small><b>'+esc(u.mobile||"—")+'</b></div><div><small>Email ID</small><b>'+esc(u.email||"—")+'</b></div><div><small>अंतिम तारीख</small><b>'+(u.expiresAt?esc(new Date(u.expiresAt).toLocaleDateString("en-IN")):"तय नहीं")+'</b></div><div><small>शहर</small><b>'+((u.cities&&u.cities.length)?u.cities.map(c=>esc(c.name)+" ("+esc(c.status)+")").join(", "):"अभी नहीं")+'</b></div></div><div class="expiry-controls"><div class="expiry-field"><label for="days-'+u._id+'">कितने अतिरिक्त दिन बढ़ाने हैं?</label><input id="days-'+u._id+'" type="text" inputmode="numeric" pattern="[0-9]{1,4}" maxlength="4" autocomplete="off" placeholder="जैसे 30" data-days="'+u._id+'"><button type="button" data-setdays="'+u._id+'">दिन बढ़ाएँ</button></div><div class="expiry-field"><label for="date-'+u._id+'">किस तारीख तक चालू रखना है?</label><input id="date-'+u._id+'" type="date" min="'+indiaToday()+'" data-date="'+u._id+'"><button type="button" data-setdate="'+u._id+'">तारीख लागू करें</button></div><div class="actions"><button type="button" data-reset="'+u._id+'">Reset Password</button><button type="button" data-toggle="'+u._id+'" data-active="'+u.active+'">'+(u.active?"Disable":"Enable")+'</button><button type="button" class="danger" data-delete="'+u._id+'">Delete</button></div></div></article>').join("")||'<p class="muted">कोई User नहीं है।</p>';
 renderAssignmentOptions(users);
 const demoPlayers=await api("/api/admin/demo-players");
 $("#demoPlayerRequests").innerHTML=demoPlayers.map(p=>'<article class="admin-row"><div class="admin-row-info"><b>'+esc(p.name)+' · '+esc(p.mobile)+'</b><p>Email: '+esc(p.email||"—")+' · Registration: '+esc(new Date(p.createdAt).toLocaleString("hi-IN"))+' · Status: '+esc(p.status)+' · Wallet: <strong>'+Number(p.walletPoints||0).toLocaleString("en-IN")+' Points</strong></p><div class="actions"><input type="number" min="1" max="1000000" step="1" inputmode="numeric" placeholder="Points जोड़ें" id="demo-points-'+p._id+'" style="width:125px;padding:8px;border-radius:8px"><button type="button" data-demopoints="'+p._id+'">➕ Wallet में Points डालें</button></div></div><div class="actions">'+(p.status!=="approved"?'<button type="button" data-demoplayer="'+p._id+'" data-demostatus="approved">Approve</button>':'')+(p.status!=="rejected"?'<button type="button" data-demoplayer="'+p._id+'" data-demostatus="rejected">Reject</button>':'')+(p.status!=="disabled"?'<button type="button" class="danger" data-demoplayer="'+p._id+'" data-demostatus="disabled">Disable</button>':'<button type="button" data-demoplayer="'+p._id+'" data-demostatus="approved">Enable</button>')+'<button type="button" class="danger" data-demodelete="'+p._id+'">🗑️ Delete</button></div></article>').join("")||'<p class="muted">अभी कोई Demo registration नहीं है।</p>';
 const ledgerSelect=$("#demoLedgerUser"),selectedLedgerUser=ledgerSelect.value;
 ledgerSelect.innerHTML='<option value="">Demo User चुनें</option>'+demoPlayers.map(p=>'<option value="'+esc(p._id)+'">'+esc(p.name)+' · '+esc(p.mobile)+'</option>').join("");
 if(demoPlayers.some(p=>p._id===selectedLedgerUser))ledgerSelect.value=selectedLedgerUser;
 if(!$("#demoLedgerMonth").value)$("#demoLedgerMonth").value=currentIndiaMonth();

 const cities=await api("/api/admin/cities");
 $("#cityRequests").innerHTML='<article class="admin-row"><div class="admin-row-info"><b>Chart की पुरानी City / Market Assign करें</b><p>Chart में पहले से मौजूद किसी भी City का नाम और किसी भी active User का Username डालें। पुराने Results उसी User को मिलेंगे।</p></div><div class="actions"><button type="button" data-assignanychartcity>City Assign करें</button></div></article>'+cities.map(c=>'<article class="admin-row"><div class="admin-row-info"><b>'+esc(c.cityName)+'</b><p>User: '+esc(c.username)+' · समय: '+esc(c.expectedTime||"नहीं दिया")+' IST · '+esc(c.status)+'</p></div><div class="actions">'+(c.status==="pending"?'<button type="button" data-city="'+c._id+'" data-status="approved">Approve</button>':'')+'<button type="button" data-editcity="'+c._id+'" data-name="'+esc(c.cityName)+'">Name Edit</button><button type="button" data-returncity="'+c._id+'">Send Back</button><button type="button" data-hidecity="'+c._id+'">'+(c.status==="hidden"?"Unhide":"Hide")+'</button><button type="button" class="danger" data-deletecity="'+c._id+'">Remove</button></div></article>').join("")||'<p class="muted">कोई शहर नहीं है।</p>';
}
let assignableChartCities=[];
function renderAssignmentOptions(users){
 const citySelect=$("#assignCitySelect"),userSelect=$("#assignUserSelect"),button=$("#assignSelectedCity");
 if(!citySelect||!userSelect||!button)return;
 const previous=citySelect.value;
 citySelect.innerHTML='<option value="">City / Market चुनें</option>';
 assignableChartCities.forEach(name=>{const o=document.createElement("option");o.value=name;o.textContent=name;citySelect.appendChild(o);});
 if(assignableChartCities.includes(previous))citySelect.value=previous;
 const chosen=citySelect.value;
 userSelect.innerHTML='<option value="">User चुनें</option>';
 if(chosen){
  users.filter(u=>u.active).sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"hi")).forEach(u=>{const o=document.createElement("option");o.value=u.username;o.textContent=(u.name||u.username)+" (@"+u.username+")";userSelect.appendChild(o);});
  userSelect.disabled=false;
 }else userSelect.disabled=true;
 button.disabled=!(chosen&&userSelect.value);
}
async function loadAssignableChartCities(){
 const rows=await api("/api/admin/results");
 assignableChartCities=[...new Set(rows.map(r=>String(r.title||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"hi"));
}
$("#assignCitySelect").addEventListener("change",async()=>{
 const users=await api("/api/admin/users");
 renderAssignmentOptions(users);
 $("#assignCityMsg").textContent=$("#assignCitySelect").value?"अब इस City के लिए User चुनें।":"";
});
$("#assignUserSelect").addEventListener("change",()=>{$("#assignSelectedCity").disabled=!($("#assignCitySelect").value&&$("#assignUserSelect").value);});
$("#assignSelectedCity").addEventListener("click",async()=>{
 const cityName=$("#assignCitySelect").value,username=$("#assignUserSelect").value,msg=$("#assignCityMsg");
 if(!cityName||!username)return;
 if(!confirm(cityName+" के पुराने Chart Results "+username+" को assign करें?"))return;
 const button=$("#assignSelectedCity");button.disabled=true;msg.textContent="City assign हो रही है…";
 try{
  const result=await api("/api/admin/chart-city/assign-any",{method:"POST",body:JSON.stringify({cityName,username})});
  msg.textContent=result.cityName+" अब "+result.name+" (@"+result.username+") को assign हो गई। पुराने Results: "+result.movedResults;
  await refresh();
 }catch(err){msg.textContent=err.message;button.disabled=false;}
});
$("#loginForm").addEventListener("submit",async e=>{e.preventDefault();try{const f=new FormData(e.target);await api("/api/admin/login",{method:"POST",body:JSON.stringify({username:f.get("username"),password:f.get("password")})});show(true);await refresh();}catch(err){$("#loginMsg").textContent=err.message;}});
$("#createUserForm").addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.target);try{await api("/api/admin/users",{method:"POST",body:JSON.stringify({name:f.get("name"),username:f.get("username"),mobile:f.get("mobile"),email:f.get("email"),expiresInDays:Number(f.get("expiresInDays"))})});e.target.reset();$("#userMsg").textContent="User बन गया। चुनी गई अवधि के बाद account अपने आप बंद हो जाएगा। Login Password: userlogin (पहली Login पर बदलना जरूरी)।";await refresh();}catch(err){$("#userMsg").textContent=err.message;}});
document.addEventListener("click",async e=>{
 const playNotOk=e.target.closest("[data-playnotok]"),playNotOkGroup=e.target.closest("[data-playnotok-group]"),demoPoints=e.target.closest("[data-demopoints]"),demoPlayer=e.target.closest("[data-demoplayer]"),demoDelete=e.target.closest("[data-demodelete]"),assignany=e.target.closest("[data-assignanychartcity]"),city=e.target.closest("[data-city]"),editcity=e.target.closest("[data-editcity]"),returncity=e.target.closest("[data-returncity]"),hidecity=e.target.closest("[data-hidecity]"),deletecity=e.target.closest("[data-deletecity]"),toggle=e.target.closest("[data-toggle]"),del=e.target.closest("[data-delete]"),reset=e.target.closest("[data-reset]"),setdays=e.target.closest("[data-setdays]"),setdate=e.target.closest("[data-setdate]");
 if(!playNotOk&&!playNotOkGroup&&!demoPoints&&!demoPlayer&&!demoDelete&&!assignany&&!city&&!editcity&&!returncity&&!hidecity&&!deletecity&&!toggle&&!del&&!reset&&!setdays&&!setdate)return;
 try{
  if(playNotOkGroup){const ids=playNotOkGroup.dataset.playnotokGroup.split(",").filter(Boolean);if(!confirm("इस पूरी grouped Play ("+ids.length+" नंबर) को Not OK करके सभी Points वापस User के Wallet में जोड़ने हैं?"))return;let refunded=0,last=null,done=0;for(const id of ids){const result=await api("/api/admin/demo-plays/"+encodeURIComponent(id)+"/not-ok",{method:"POST",body:JSON.stringify({})});refunded+=Number(result.refunded||0);last=result.player;done++;}alert((last?.name||"User")+" की "+done+" Plays Not OK हुईं। "+money(refunded)+" Points वापस Wallet में जोड़ दिए गए। नया Balance: "+money(last?.walletPoints));await loadDemoPlays();}else if(playNotOk){if(!confirm("इस Play को Not OK करके "+(playNotOk.closest(".admin-row")?.querySelector(".admin-row-info p")?.textContent||"") +" के Points वापस User के Wallet में जोड़ने हैं?"))return;const result=await api("/api/admin/demo-plays/"+encodeURIComponent(playNotOk.dataset.playnotok)+"/not-ok",{method:"POST",body:JSON.stringify({})});alert(result.player.name+" की Play Not OK हुई। "+money(result.refunded)+" Points वापस Wallet में जोड़ दिए गए। नया Balance: "+money(result.player.walletPoints));await loadDemoPlays();}
  if(demoPoints){const id=demoPoints.dataset.demopoints,field=document.getElementById("demo-points-"+id),points=Number(field?.value);if(!Number.isSafeInteger(points)||points<1||points>1000000)throw new Error("1 से 10,00,000 तक पूरे Points लिखें।");const result=await api("/api/admin/demo-players/"+id+"/points",{method:"POST",body:JSON.stringify({points})});alert(result.player.name+" के Wallet में "+points.toLocaleString("en-IN")+" Points जोड़ दिए गए। नया Balance: "+Number(result.player.walletPoints).toLocaleString("en-IN"));}
  if(demoPlayer){const status=demoPlayer.dataset.demostatus;if(!confirm("इस Demo account का status "+status+" करना है?"))return;await api("/api/admin/demo-players/"+demoPlayer.dataset.demoplayer,{method:"PATCH",body:JSON.stringify({status})});}
  if(demoDelete){if(!confirm("इस Demo User को हमेशा के लिए हटाएँ? उसका Wallet और पूरा Play History भी delete हो जाएगा। यह वापस नहीं आएगा।"))return;await api("/api/admin/demo-players/"+demoDelete.dataset.demodelete,{method:"DELETE"});alert("Demo User और उसका Play History delete हो गया।");}
  if(setdays){const id=setdays.dataset.setdays,v=document.getElementById("days-"+id).value.trim();if(!/^\d{1,4}$/.test(v)||Number(v)<1||Number(v)>3650)throw new Error("1 से 3650 तक दिन लिखें।");const result=await api("/api/admin/users/"+id,{method:"PATCH",body:JSON.stringify({extendByDays:Number(v)})});alert("यूज़र की मौजूदा अवधि में "+v+" दिन बढ़ा दिए गए। नई अंतिम तारीख: "+new Date(result.expiresAt).toLocaleString("hi-IN"));document.getElementById("days-"+id).value="";}
  if(setdate){const id=setdate.dataset.setdate,v=document.getElementById("date-"+id).value;if(!v)throw new Error("पहले तारीख चुनें।");const expiry=new Date(v+"T23:59:59+05:30");if(Number.isNaN(expiry.getTime())||expiry<=new Date())throw new Error("आज के बाद की तारीख चुनें।");await api("/api/admin/users/"+id,{method:"PATCH",body:JSON.stringify({expiresAt:expiry.toISOString()})});alert("यूज़र की अंतिम तारीख सेट हो गई।");}
  if(reset){if(!confirm("इस User का password userlogin पर reset करें? अगली Login पर बदलना जरूरी होगा।"))return;await api("/api/admin/users/"+reset.dataset.reset,{method:"PATCH",body:JSON.stringify({resetPassword:true})});}
  if(assignany){const cityName=prompt("Chart में पहले से मौजूद City/Market का नाम बिल्कुल वैसा ही लिखें:");if(cityName===null)return;const identifier=prompt("जिस User को देना है उसका पूरा नाम या Username लिखें:");if(identifier===null)return;if(!confirm(cityName+" के पुराने Chart Results "+identifier+" को assign करें? कोई नया Chart result नहीं बनेगा।"))return;const result=await api("/api/admin/chart-city/assign-any",{method:"POST",body:JSON.stringify({cityName,username:identifier})});alert(result.cityName+" अब "+result.name+" (@"+result.username+") को assign है। पुराने Results मिलान: "+result.matchedResults+"; अपडेट: "+result.movedResults);}
  if(city)await api("/api/admin/cities/"+city.dataset.city,{method:"PATCH",body:JSON.stringify({status:city.dataset.status})});
  if(editcity){const cityName=prompt("शहर का नया नाम लिखें:",editcity.dataset.name);if(cityName===null)return;await api("/api/admin/cities/"+editcity.dataset.editcity,{method:"PATCH",body:JSON.stringify({cityName})});}
  if(returncity){if(!confirm("शहर User के पास वापस भेजें? User नाम edit करके दोबारा approval भेज सकेगा।"))return;await api("/api/admin/cities/"+returncity.dataset.returncity,{method:"PATCH",body:JSON.stringify({status:"returned"})});}
  if(hidecity)await api("/api/admin/cities/"+hidecity.dataset.hidecity,{method:"PATCH",body:JSON.stringify({status:hidecity.textContent.trim()==="Unhide"?"approved":"hidden"})});
  if(deletecity){if(!confirm("शहर हटाएँ? इससे उसके पुराने public records भी hide हो जाएंगे।"))return;await api("/api/admin/cities/"+deletecity.dataset.deletecity,{method:"DELETE"});}
  if(toggle)await api("/api/admin/users/"+toggle.dataset.toggle,{method:"PATCH",body:JSON.stringify(toggle.dataset.active==="true"?{active:false}:{active:true,clearExpiry:true})});
  if(del){if(!confirm("इस User को हटाएँ?"))return;await api("/api/admin/users/"+del.dataset.delete,{method:"DELETE"});}
  await refresh();
 }catch(err){alert(err.message);}
});
(async()=>{try{await api("/api/admin/session");show(true);showUserTab(location.hash==="#demo-users"?"demo":"portal");await refresh();}catch{show(false);}})();