const $=s=>document.querySelector(s);
async function api(url,opts={}){const r=await fetch(url,{credentials:"same-origin",...opts,headers:{...(opts.body?{"Content-Type":"application/json"}:{}),...(opts.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Request failed");return d;}
function esc(v){return String(v??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
function show(on){$("#loginBox").hidden=on;$("#managePanel").hidden=!on;}
function showUserTab(tab){
 const demo=tab==="demo";
 $("#portalUsersPanel").hidden=demo;
 $("#portalCityPanel").hidden=demo;
 $("#demoUsersPanel").hidden=!demo;
 $("#showPortalUsers").setAttribute("aria-pressed",String(!demo));
 $("#showDemoPlayers").setAttribute("aria-pressed",String(demo));
}
$("#showPortalUsers").addEventListener("click",()=>showUserTab("portal"));
$("#showDemoPlayers").addEventListener("click",()=>showUserTab("demo"));

function indiaToday(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
async function refresh(){
 const users=await api("/api/admin/users");
 await loadAssignableChartCities();
 $("#usersList").innerHTML=users.map((u,i)=>'<article class="user-manage-card"><div class="user-card-head"><div class="user-identity"><span class="user-number">USER '+(i+1)+'</span><h3>'+esc(u.name||"नाम उपलब्ध नहीं")+'</h3><span class="username-tag">@'+esc(u.username)+'</span></div><span class="account-status '+(u.active?"is-active":"is-disabled")+'">'+(u.active?"ACTIVE":"DISABLED")+'</span></div><div class="user-details-grid"><div><small>मोबाइल नंबर</small><b>'+esc(u.mobile||"—")+'</b></div><div><small>Email ID</small><b>'+esc(u.email||"—")+'</b></div><div><small>अंतिम तारीख</small><b>'+(u.expiresAt?esc(new Date(u.expiresAt).toLocaleDateString("en-IN")):"तय नहीं")+'</b></div><div><small>शहर</small><b>'+((u.cities&&u.cities.length)?u.cities.map(c=>esc(c.name)+" ("+esc(c.status)+")").join(", "):"अभी नहीं")+'</b></div></div><div class="expiry-controls"><div class="expiry-field"><label for="days-'+u._id+'">कितने अतिरिक्त दिन बढ़ाने हैं?</label><input id="days-'+u._id+'" type="text" inputmode="numeric" pattern="[0-9]{1,4}" maxlength="4" autocomplete="off" placeholder="जैसे 30" data-days="'+u._id+'"><button type="button" data-setdays="'+u._id+'">दिन बढ़ाएँ</button></div><div class="expiry-field"><label for="date-'+u._id+'">किस तारीख तक चालू रखना है?</label><input id="date-'+u._id+'" type="date" min="'+indiaToday()+'" data-date="'+u._id+'"><button type="button" data-setdate="'+u._id+'">तारीख लागू करें</button></div><div class="actions"><button type="button" data-reset="'+u._id+'">Reset Password</button><button type="button" data-toggle="'+u._id+'" data-active="'+u.active+'">'+(u.active?"Disable":"Enable")+'</button><button type="button" class="danger" data-delete="'+u._id+'">Delete</button></div></div></article>').join("")||'<p class="muted">कोई User नहीं है।</p>';
 renderAssignmentOptions(users);
 const demoPlayers=await api("/api/admin/demo-players");
 $("#demoPlayerRequests").innerHTML=demoPlayers.map(p=>'<article class="admin-row"><div class="admin-row-info"><b>'+esc(p.name)+' · '+esc(p.mobile)+'</b><p>Email: '+esc(p.email||"—")+' · Registration: '+esc(new Date(p.createdAt).toLocaleString("hi-IN"))+' · Status: '+esc(p.status)+' · Wallet: <strong>'+Number(p.walletPoints||0).toLocaleString("en-IN")+' Points</strong></p><div class="actions"><input type="number" min="1" max="1000000" step="1" inputmode="numeric" placeholder="Points जोड़ें" id="demo-points-'+p._id+'" style="width:125px;padding:8px;border-radius:8px"><button type="button" data-demopoints="'+p._id+'">➕ Wallet में Points डालें</button></div></div><div class="actions">'+(p.status!=="approved"?'<button type="button" data-demoplayer="'+p._id+'" data-demostatus="approved">Approve</button>':'')+(p.status!=="rejected"?'<button type="button" data-demoplayer="'+p._id+'" data-demostatus="rejected">Reject</button>':'')+(p.status!=="disabled"?'<button type="button" class="danger" data-demoplayer="'+p._id+'" data-demostatus="disabled">Disable</button>':'<button type="button" data-demoplayer="'+p._id+'" data-demostatus="approved">Enable</button>')+'</div></article>').join("")||'<p class="muted">अभी कोई Demo registration नहीं है।</p>';
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
 const demoPoints=e.target.closest("[data-demopoints]"),demoPlayer=e.target.closest("[data-demoplayer]"),assignany=e.target.closest("[data-assignanychartcity]"),city=e.target.closest("[data-city]"),editcity=e.target.closest("[data-editcity]"),returncity=e.target.closest("[data-returncity]"),hidecity=e.target.closest("[data-hidecity]"),deletecity=e.target.closest("[data-deletecity]"),toggle=e.target.closest("[data-toggle]"),del=e.target.closest("[data-delete]"),reset=e.target.closest("[data-reset]"),setdays=e.target.closest("[data-setdays]"),setdate=e.target.closest("[data-setdate]");
 if(!demoPoints&&!demoPlayer&&!assignany&&!city&&!editcity&&!returncity&&!hidecity&&!deletecity&&!toggle&&!del&&!reset&&!setdays&&!setdate)return;
 try{
  if(demoPoints){const id=demoPoints.dataset.demopoints,field=document.getElementById("demo-points-"+id),points=Number(field?.value);if(!Number.isSafeInteger(points)||points<1||points>1000000)throw new Error("1 से 10,00,000 तक पूरे Points लिखें।");const result=await api("/api/admin/demo-players/"+id+"/points",{method:"POST",body:JSON.stringify({points})});alert(result.player.name+" के Wallet में "+points.toLocaleString("en-IN")+" Points जोड़ दिए गए। नया Balance: "+Number(result.player.walletPoints).toLocaleString("en-IN"));}
  if(demoPlayer){const status=demoPlayer.dataset.demostatus;if(!confirm("इस Demo account का status "+status+" करना है?"))return;await api("/api/admin/demo-players/"+demoPlayer.dataset.demoplayer,{method:"PATCH",body:JSON.stringify({status})});}
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
(async()=>{try{await api("/api/admin/session");show(true);await refresh();}catch{show(false);}})();