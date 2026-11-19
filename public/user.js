const $=s=>document.querySelector(s);
async function userApi(url,opts={}){
 const response=await fetch(url,{credentials:"same-origin",...opts,headers:{...(opts.body?{"Content-Type":"application/json"}:{}),...(opts.headers||{})}});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error||"Request failed");
 return data;
}

async function loadUserTopResults(){
 const box=$("#userTopResultCards");if(!box)return;
 try{
  const [rows,cities]=await Promise.all([userApi("/api/results?recent=2"),userApi("/api/public/cities")]);
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const start=new Date(today+"T00:00:00.000Z"),yesterday=new Date(start.getTime()-86400000).toISOString().slice(0,10);
  const byCity=new Map();
  rows.filter(r=>r.published!==false&&!r.deleted).forEach(r=>{const day=new Date(r.resultDate).toISOString().slice(0,10);if(day!==today&&day!==yesterday)return;if(!byCity.has(r.title))byCity.set(r.title,{today:null,yesterday:null});const slot=byCity.get(r.title);if(day===today)slot.today=r;else slot.yesterday=r;});
  const visible=[...new Set([...cities.map(c=>c.cityName),...byCity.keys()])].sort((a,b)=>a.localeCompare(b,"hi"));
  if(!visible.length){box.innerHTML='<p class="muted">अभी कोई प्रकाशित रिजल्ट नहीं है।</p>';return;}
  const fixed={"disawar":"05:00 AM","desawar":"05:00 AM","faridabad":"06:20 PM","ghaziabad":"10:05 PM","gali":"12:05 AM","delhi bazar":"03:15 PM","shri ganesh":"04:45 PM","shree ganesh":"04:45 PM"};
  box.innerHTML=visible.map(city=>{
   const result=byCity.get(city)||{},now=result.today,prev=result.yesterday,info=cities.find(c=>c.cityName===city)||{};
   const time=info.expectedTime||info.resultTime||info.time||fixed[city.trim().toLowerCase()]||"";
   const value=now?String(now.resultText):"WAIT";
   const date=now?new Date(now.resultDate).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric",timeZone:"Asia/Kolkata"}):"";
   const publishedAt=now?.createdAt||now?.updatedAt||now?.resultDate;
   const clock=publishedAt?new Date(publishedAt).toLocaleTimeString("en-IN",{hour:"numeric",minute:"2-digit",hour12:true,timeZone:"Asia/Kolkata"}):"";
   const message="RK Bhai - प्रकाशित परिणाम और पुराने रिकॉर्ड\n\n❤️ "+city.toUpperCase()+" ❤️\n👇 Live Result 👇\n\n"+(prev?"पिछला रिजल्ट: "+prev.resultText+"\n":"")+"✅ (( "+value+" )) ✅\n\n"+location.origin+"\nDate : "+date+(clock?"\n"+clock:"");
   return '<article class="top-result-card"><h3>'+userEsc(city)+'</h3><p class="top-result-time">'+(time?'( '+userEsc(time)+' )':'&nbsp;')+'</p><div class="top-result-values"><span class="top-previous">'+(prev?userEsc(prev.resultText):"XX")+'</span><span class="top-result-arrow">➡️</span><span class="top-current-wrap">'+(now?'<span class="new-result-badge">NEW</span>':'')+'<span class="top-current'+(now?' result-blink':'')+'">'+userEsc(value)+'</span></span></div><a class="dashboard-whatsapp-share" '+(now?'href="https://wa.me/?text='+encodeURIComponent(message)+'" target="_blank" rel="noopener"':'aria-disabled="true"')+'>WhatsApp पर शेयर करें</a></article>';
  }).join("");
 }catch(error){box.innerHTML='<p class="muted">रिजल्ट लोड नहीं हो पाए: '+userEsc(error.message)+'</p>';}
}

function showUser(on){$("#userLogin").hidden=on;$("#userContent").hidden=!on;$("#passwordChangeBox").hidden=true;}
function showExpiryWarning(expiresAt){
 const popup=$("#expiryWarning"),banner=$("#expiryStatusBanner");
 const bannerText=$("#expiryStatusText"),bannerDate=$("#expiryStatusDate");
 if(window.userExpiryTimer)clearInterval(window.userExpiryTimer);
 if(!expiresAt){
  if(popup)popup.hidden=true;
  if(banner){banner.hidden=false;bannerText.textContent="Admin ने अभी account की expiry date तय नहीं की है।";bannerDate.textContent="";}
  return;
 }
 const end=new Date(expiresAt);
 if(Number.isNaN(end.getTime())){
  if(popup)popup.hidden=true;
  if(banner){banner.hidden=false;bannerText.textContent="Account की अवधि की जानकारी उपलब्ध नहीं है।";bannerDate.textContent="";}
  return;
 }
 const update=()=>{
  const ms=end.getTime()-Date.now();
  const dateText="बंद होने की तारीख: "+end.toLocaleString("hi-IN",{dateStyle:"medium",timeStyle:"short"})+" (IST)";
  if(ms<=0){
   const msg="आपके account की अवधि समाप्त हो गई है।";
   if($("#expiryRemaining"))$("#expiryRemaining").textContent=msg;
   if($("#expiryDate"))$("#expiryDate").textContent="अब Admin से दोबारा अवधि बढ़वाएँ।";
   if(bannerText)bannerText.textContent=msg+" Admin से अवधि बढ़वाएँ।";
   if(bannerDate)bannerDate.textContent=dateText;
   return;
  }
  const days=Math.floor(ms/86400000),hours=Math.floor(ms%86400000/3600000),minutes=Math.floor(ms%3600000/60000),seconds=Math.floor(ms%60000/1000);
  const remaining=days+" दिन "+hours+" घंटे "+minutes+" मिनट "+seconds+" सेकंड बाकी";
  if($("#expiryRemaining"))$("#expiryRemaining").textContent=remaining;
  if($("#expiryDate"))$("#expiryDate").textContent=dateText;
  if(bannerText)bannerText.textContent=remaining+" — account अपने आप बंद हो जाएगा।";
  if(bannerDate)bannerDate.textContent=dateText;
 };
 update();
 if(banner)banner.hidden=false;
 if(popup)popup.hidden=false;
 window.userExpiryTimer=setInterval(update,1000);
}
$("#expiryClose")?.addEventListener("click",()=>{$("#expiryWarning").hidden=true;});
function showPasswordChange(on){$("#userLogin").hidden=true;$("#userContent").hidden=true;$("#passwordChangeBox").hidden=!on;}
$("#userLoginForm").addEventListener("submit",async e=>{
 e.preventDefault();$("#userMessage").textContent="Login हो रहा है…";
 try{const f=new FormData(e.target);const data=await userApi("/api/user/login",{method:"POST",body:JSON.stringify({username:f.get("username"),password:f.get("password")})});$("#userName").textContent=data.name||data.username;if(data.mustChangePassword){showPasswordChange(true);$("#passwordChangeMessage").textContent="Default password बदलना जरूरी है।";}else{showUser(true);showExpiryWarning(data.expiresAt);await loadMyCity();await loadUserTopResults();if(window.loadResults)loadResults();if(window.loadMonth)loadMonth();}$("#userMessage").textContent="";}
 catch(err){$("#userMessage").textContent=err.message;}
});
async function logoutUser(){try{await fetch("/api/user/logout",{method:"POST",credentials:"same-origin"});}catch{}showPasswordChange(false);showUser(false);$("#userLoginForm").reset();}
$("#userLogout").addEventListener("click",logoutUser);
$("#forcedLogout").addEventListener("click",logoutUser);
(async()=>{const checking=$("#sessionChecking");let data;try{data=await userApi("/api/user/session");}catch{if(checking)checking.hidden=true;showUser(false);return;}if(checking)checking.hidden=true;$("#userName").textContent=data.username;if(data.mustChangePassword){showPasswordChange(true);$("#passwordChangeMessage").textContent="पहले default password बदलें।";}else{showUser(true);showExpiryWarning(data.expiresAt);try{await loadMyCity();await loadUserTopResults();if(window.loadResults)await loadResults();if(window.loadMonth)await loadMonth();}catch(err){$("#cityStatus").textContent=err.message||"शहर की जानकारी लोड नहीं हो पाई।";}}})();

async function loadMyCity(){
 const city=await userApi("/api/user/city");
 const form=$("#cityForm"),status=$("#cityStatus"),box=$("#userRecordBox");
 const recordsPanel=$("#myRecordsPanel");
 if(!city){status.textContent="आपने अभी शहर नहीं बनाया है। एक ही शहर भेज सकते हैं; Admin approval जरूरी है।";form.hidden=false;box.hidden=true;if(recordsPanel)recordsPanel.hidden=true;return;}
 form.hidden=true;
 status.innerHTML="शहर: "+userEsc(city.cityName)+" · स्थिति: "+({pending:"Approval pending",approved:"Approved",rejected:"Rejected",returned:"Admin ने वापस भेजा — नाम edit करें",hidden:"Admin ने hide किया"}[city.status]||city.status)+"<br>परिणाम का समय: "+(city.expectedTime||"समय नहीं दिया गया")+" IST";
 if(city.status==="returned") status.innerHTML+='<form id="cityRenameForm" class="inline-time-form"><label>शहर का नाम सुधारें</label><input name="cityName" minlength="2" maxlength="60" required value="'+userEsc(city.cityName)+'"><label>परिणाम का समय</label><input name="expectedTime" type="time" required value="'+userEsc(city.expectedTime||"")+'"><button type="submit">दोबारा Approval भेजें</button></form>';
 if(city.status==="approved") status.innerHTML+='<form id="cityTimeForm" class="inline-time-form"><label>परिणाम आने का समय बदलें (IST)</label><input name="expectedTime" type="time" required value="'+userEsc(city.expectedTime||"")+'"><button type="submit">समय अपडेट करें</button></form>';
 box.hidden=city.status!=="approved";
 if(recordsPanel)recordsPanel.hidden=city.status!=="approved";
 if(city.status==="approved") await loadMyRecords();
}
function userMonthKey(value){
 const d=new Date(value);return Number.isNaN(d.getTime())?"unknown":d.getUTCFullYear()+"-"+String(d.getUTCMonth()+1).padStart(2,"0");
}
function userMonthLabel(key){
 if(key==="unknown")return "तारीख उपलब्ध नहीं";
 const [year,month]=key.split("-").map(Number);
 return new Date(Date.UTC(year,month-1,1)).toLocaleDateString("hi-IN",{month:"long",year:"numeric",timeZone:"UTC"});
}
function currentUserMonthKey(){
 const parts=new Intl.DateTimeFormat("en",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit"}).formatToParts(new Date());
 return parts.find(x=>x.type==="year").value+"-"+parts.find(x=>x.type==="month").value;
}
let selectedMyRecordsMonth=currentUserMonthKey();
function shiftUserMonth(key,amount){
 const [year,month]=key.split("-").map(Number),d=new Date(Date.UTC(year,month-1+amount,1));
 return d.getUTCFullYear()+"-"+String(d.getUTCMonth()+1).padStart(2,"0");
}
$("#myRecordsPrev").addEventListener("click",()=>{selectedMyRecordsMonth=shiftUserMonth(selectedMyRecordsMonth,-1);loadMyRecords().catch(err=>{$("#myRecordsByMonth").textContent=err.message;});});
$("#myRecordsNext").addEventListener("click",()=>{const next=shiftUserMonth(selectedMyRecordsMonth,1);if(next<=currentUserMonthKey()){selectedMyRecordsMonth=next;loadMyRecords().catch(err=>{$("#myRecordsByMonth").textContent=err.message;});}});
async function loadMyRecords(){
 const rows=await userApi("/api/user/results");
 const groups=new Map();
 rows.forEach(row=>{const key=userMonthKey(row.resultDate);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);});
 const list=$("#myRecordsByMonth"),label=$("#myRecordsMonthLabel"),prev=$("#myRecordsPrev"),next=$("#myRecordsNext");
 if(!groups.has(selectedMyRecordsMonth)&&groups.size===1&&groups.has("unknown"))selectedMyRecordsMonth="unknown";
 prev.disabled=selectedMyRecordsMonth==="unknown";
 next.disabled=selectedMyRecordsMonth==="unknown"||selectedMyRecordsMonth>=currentUserMonthKey();
 const monthRows=(groups.get(selectedMyRecordsMonth)||[]).slice().sort((a,b)=>new Date(a.resultDate)-new Date(b.resultDate));
 label.textContent=userMonthLabel(selectedMyRecordsMonth)+" के रिकॉर्ड ("+monthRows.length+")";
 const firstHalf=monthRows.filter(r=>{const d=new Date(r.resultDate);return !Number.isNaN(d.getTime())&&d.getUTCDate()<=16;});
 const secondHalf=monthRows.filter(r=>{const d=new Date(r.resultDate);return !Number.isNaN(d.getTime())&&d.getUTCDate()>=17;});
 const renderRows=(items,empty)=>items.length?items.map(r=>{
  const d=new Date(r.resultDate),day=Number.isNaN(d.getTime())?"—":d.getUTCDate();
  return '<article class="my-record-item" role="button" tabindex="0" aria-label="दिन '+day+' का परिणाम edit करें" data-my-edit="'+userEsc(r._id)+'" style="cursor:pointer"><div class="my-record-day">'+day+'</div><div class="my-record-info"><b>'+userEsc(r.resultText)+'</b><span aria-hidden="true">✎ Edit</span></div></article>';
 }).join(""):'<p class="muted my-record-empty">'+empty+'</p>';
 list.innerHTML='<section class="my-record-half"><h3>1–16 तारीख <span>('+firstHalf.length+')</span></h3>'+renderRows(firstHalf,"इस हिस्से में कोई रिकॉर्ड नहीं")+'</section><section class="my-record-half"><h3>17–महीने का आखिरी दिन <span>('+secondHalf.length+')</span></h3>'+renderRows(secondHalf,"इस हिस्से में कोई रिकॉर्ड नहीं")+'</section>';
}
function userEsc(v){return String(v??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
$("#cityForm").addEventListener("submit",async e=>{
 e.preventDefault();const cityName=new FormData(e.target).get("cityName");
 try{await userApi("/api/user/city",{method:"POST",body:JSON.stringify({cityName,expectedTime:new FormData(e.target).get("expectedTime")})});await loadMyCity();}
 catch(err){$("#cityStatus").textContent=err.message;}
});
$("#userRecordForm").addEventListener("submit",async e=>{
 e.preventDefault();const f=new FormData(e.target);
 try{await userApi("/api/user/results",{method:"POST",body:JSON.stringify({resultText:f.get("resultText"),resultDate:f.get("resultDate"),sourceUrl:f.get("sourceUrl")})});e.target.reset();$("#recordMessage").textContent="रिकॉर्ड सेव हो गया।";await loadMyRecords();await loadUserTopResults();if(window.loadResults)loadResults();if(window.loadMonth)loadMonth();}
 catch(err){$("#recordMessage").textContent=err.message;}
});
async function editMyRecordItem(item){
 const id=item?.dataset.myEdit;if(!id)return;
 const next=prompt("नया परिणाम लिखें:");if(next===null)return;
 const date=prompt("तारीख YYYY-MM-DD (खाली छोड़ें तो तारीख नहीं बदलेगी):");
 const payload={resultText:next};if(date)payload.resultDate=date;
 try{await userApi("/api/user/results/"+id,{method:"PATCH",body:JSON.stringify(payload)});await loadMyRecords();if(window.loadResults)loadResults();if(window.loadMonth)loadMonth();}
 catch(err){alert(err.message);}
}
$("#myRecordsByMonth").addEventListener("click",e=>editMyRecordItem(e.target.closest("[data-my-edit]")));
$("#myRecordsByMonth").addEventListener("keydown",e=>{
 if((e.key==="Enter"||e.key===" ")&&e.target.matches("[data-my-edit]")){e.preventDefault();editMyRecordItem(e.target);}
});

document.addEventListener("submit",async e=>{
 if(e.target.id==="cityRenameForm"){e.preventDefault();const f=new FormData(e.target);try{await userApi("/api/user/city/name",{method:"PATCH",body:JSON.stringify({cityName:f.get("cityName"),expectedTime:f.get("expectedTime")})});await loadMyCity();}catch(err){alert(err.message);}return;}
 if(e.target.id!=="cityTimeForm")return;
 e.preventDefault();const expectedTime=new FormData(e.target).get("expectedTime");
 try{await userApi("/api/user/city/time",{method:"PATCH",body:JSON.stringify({expectedTime})});await loadMyCity();await loadUserTopResults();if(window.loadMonth)loadMonth();}
 catch(err){alert(err.message);}
});

$("#passwordChangeForm").addEventListener("submit",async e=>{
 e.preventDefault();const f=new FormData(e.target),currentPassword=f.get("currentPassword"),newPassword=f.get("newPassword");
 if(newPassword!==f.get("confirmPassword")){$("#passwordChangeMessage").textContent="दोनों नए password एक जैसे नहीं हैं।";return;}
 try{await userApi("/api/user/change-password",{method:"POST",body:JSON.stringify({currentPassword,newPassword})});$("#passwordChangeMessage").textContent="Password बदल गया।";showUser(true);const session=await userApi("/api/user/session");showExpiryWarning(session.expiresAt);await loadMyCity();if(window.loadResults)loadResults();if(window.loadMonth)loadMonth();}
 catch(err){$("#passwordChangeMessage").textContent=err.message;}
});


// Show/hide password fields on explicit eye-button tap.
document.addEventListener("click",e=>{
 const button=e.target.closest(".password-toggle");
 if(!button)return;
 const input=button.parentElement.querySelector("input");
 if(!input)return;
 const visible=input.type==="password";
 input.type=visible?"text":"password";
 button.textContent=visible?"🙈":"👁";
 button.setAttribute("aria-label",visible?"Password छिपाएँ":"Password दिखाएँ");
 button.setAttribute("aria-pressed",String(visible));
});
