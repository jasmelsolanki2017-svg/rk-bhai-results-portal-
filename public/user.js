const $=s=>document.querySelector(s);
async function userApi(url,opts={}){
 const response=await fetch(url,{credentials:"same-origin",...opts,headers:{...(opts.body?{"Content-Type":"application/json"}:{}),...(opts.headers||{})}});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error||"Request failed");
 return data;
}
function showUser(on){$("#userLogin").hidden=on;$("#userContent").hidden=!on;$("#passwordChangeBox").hidden=true;}
function showExpiryWarning(expiresAt){\n const popup=$("#expiryWarning");if(!popup)return;\n if(!expiresAt){popup.hidden=true;return;}\n const end=new Date(expiresAt);if(Number.isNaN(end.getTime())){popup.hidden=true;return;}\n const update=()=>{const ms=end.getTime()-Date.now();if(ms<=0){$("#expiryRemaining").textContent="आपके अकाउंट की अवधि समाप्त हो गई है।";$("#expiryDate").textContent="अब Admin से दोबारा अवधि बढ़वाएँ।";return;}\n const days=Math.floor(ms/86400000),hours=Math.floor(ms%86400000/3600000),minutes=Math.floor(ms%3600000/60000),seconds=Math.floor(ms%60000/1000);\n $("#expiryRemaining").textContent=`${days} दिन ${hours} घंटे ${minutes} मिनट ${seconds} सेकंड बाकी`;\n $("#expiryDate").textContent="अकाउंट बंद होने की तारीख: "+end.toLocaleString("hi-IN",{dateStyle:"medium",timeStyle:"short"})+" (IST)";};\n update();popup.hidden=false;if(window.userExpiryTimer)clearInterval(window.userExpiryTimer);window.userExpiryTimer=setInterval(update,1000);\n}\n$("#expiryClose")?.addEventListener("click",()=>{$("#expiryWarning").hidden=true;});\nfunction showPasswordChange(on){$("#userLogin").hidden=true;$("#userContent").hidden=true;$("#passwordChangeBox").hidden=!on;}
$("#userLoginForm").addEventListener("submit",async e=>{
 e.preventDefault();$("#userMessage").textContent="Login हो रहा है…";
 try{const f=new FormData(e.target);const data=await userApi("/api/user/login",{method:"POST",body:JSON.stringify({username:f.get("username"),password:f.get("password")})});$("#userName").textContent=data.name||data.username;if(data.mustChangePassword){showPasswordChange(true);$("#passwordChangeMessage").textContent="Default password बदलना जरूरी है।";}else{showUser(true);showExpiryWarning(data.expiresAt);await loadMyCity();if(window.loadResults)loadResults();if(window.loadMonth)loadMonth();}$("#userMessage").textContent="";}
 catch(err){$("#userMessage").textContent=err.message;}
});
async function logoutUser(){try{await fetch("/api/user/logout",{method:"POST",credentials:"same-origin"});}catch{}showPasswordChange(false);showUser(false);$("#userLoginForm").reset();}
$("#userLogout").addEventListener("click",logoutUser);
$("#forcedLogout").addEventListener("click",logoutUser);
(async()=>{try{const data=await userApi("/api/user/session");$("#userName").textContent=data.username;if(data.mustChangePassword){showPasswordChange(true);$("#passwordChangeMessage").textContent="पहले default password बदलें।";}else{showUser(true);showExpiryWarning(data.expiresAt);await loadMyCity();}}catch{showUser(false);}})();

async function loadMyCity(){
 const city=await userApi("/api/user/city");
 const form=$("#cityForm"),status=$("#cityStatus"),box=$("#userRecordBox");
 if(!city){status.textContent="आपने अभी शहर नहीं बनाया है। एक ही शहर भेज सकते हैं; Admin approval जरूरी है।";form.hidden=false;box.hidden=true;return;}
 form.hidden=true;
 status.innerHTML="शहर: "+userEsc(city.cityName)+" · स्थिति: "+({pending:"Approval pending",approved:"Approved",rejected:"Rejected",returned:"Admin ने वापस भेजा — नाम edit करें",hidden:"Admin ने hide किया"}[city.status]||city.status)+"<br>परिणाम का समय: "+(city.expectedTime||"समय नहीं दिया गया")+" IST";
 if(city.status==="returned") status.innerHTML+='<form id="cityRenameForm" class="inline-time-form"><label>शहर का नाम सुधारें</label><input name="cityName" minlength="2" maxlength="60" required value="'+userEsc(city.cityName)+'"><label>परिणाम का समय</label><input name="expectedTime" type="time" required value="'+userEsc(city.expectedTime||"")+'"><button type="submit">दोबारा Approval भेजें</button></form>';
 if(city.status==="approved") status.innerHTML+='<form id="cityTimeForm" class="inline-time-form"><label>परिणाम आने का समय बदलें (IST)</label><input name="expectedTime" type="time" required value="'+userEsc(city.expectedTime||"")+'"><button type="submit">समय अपडेट करें</button></form>';
 box.hidden=city.status!=="approved";
 if(city.status==="approved") await loadMyRecords();
}
async function loadMyRecords(){
 const rows=await userApi("/api/user/results");
 $("#myRecords").innerHTML=rows.map(r=>'<article class="admin-row"><div class="admin-row-info"><b>'+userEsc(r.resultText)+'</b><p>'+new Date(r.resultDate).toLocaleDateString("hi-IN")+'</p></div><button type="button" data-my-edit="'+r._id+'">Edit</button></article>').join("")||'<p class="muted">अभी कोई रिकॉर्ड नहीं जोड़ा।</p>';
}
function userEsc(v){return String(v??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
$("#cityForm").addEventListener("submit",async e=>{
 e.preventDefault();const cityName=new FormData(e.target).get("cityName");
 try{await userApi("/api/user/city",{method:"POST",body:JSON.stringify({cityName,expectedTime:new FormData(e.target).get("expectedTime")})});await loadMyCity();}
 catch(err){$("#cityStatus").textContent=err.message;}
});
$("#userRecordForm").addEventListener("submit",async e=>{
 e.preventDefault();const f=new FormData(e.target);
 try{await userApi("/api/user/results",{method:"POST",body:JSON.stringify({resultText:f.get("resultText"),resultDate:f.get("resultDate"),sourceUrl:f.get("sourceUrl")})});e.target.reset();$("#recordMessage").textContent="रिकॉर्ड सेव हो गया।";await loadMyRecords();if(window.loadResults)loadResults();if(window.loadMonth)loadMonth();}
 catch(err){$("#recordMessage").textContent=err.message;}
});
$("#myRecords").addEventListener("click",async e=>{
 const btn=e.target.closest("[data-my-edit]");if(!btn)return;
 const id=btn.dataset.myEdit;const next=prompt("नया परिणाम लिखें:");if(next===null)return;
 const date=prompt("तारीख YYYY-MM-DD (खाली छोड़ें तो तारीख नहीं बदलेगी):");
 const payload={resultText:next};if(date)payload.resultDate=date;
 try{await userApi("/api/user/results/"+id,{method:"PATCH",body:JSON.stringify(payload)});await loadMyRecords();if(window.loadResults)loadResults();if(window.loadMonth)loadMonth();}
 catch(err){alert(err.message);}
});

document.addEventListener("submit",async e=>{
 if(e.target.id==="cityRenameForm"){e.preventDefault();const f=new FormData(e.target);try{await userApi("/api/user/city/name",{method:"PATCH",body:JSON.stringify({cityName:f.get("cityName"),expectedTime:f.get("expectedTime")})});await loadMyCity();}catch(err){alert(err.message);}return;}
 if(e.target.id!=="cityTimeForm")return;
 e.preventDefault();const expectedTime=new FormData(e.target).get("expectedTime");
 try{await userApi("/api/user/city/time",{method:"PATCH",body:JSON.stringify({expectedTime})});await loadMyCity();if(window.loadMonth)loadMonth();}
 catch(err){alert(err.message);}
});

$("#passwordChangeForm").addEventListener("submit",async e=>{
 e.preventDefault();const f=new FormData(e.target),currentPassword=f.get("currentPassword"),newPassword=f.get("newPassword");
 if(newPassword!==f.get("confirmPassword")){$("#passwordChangeMessage").textContent="दोनों नए password एक जैसे नहीं हैं।";return;}
 try{await userApi("/api/user/change-password",{method:"POST",body:JSON.stringify({currentPassword,newPassword})});$("#passwordChangeMessage").textContent="Password बदल गया।";showUser(true);await loadMyCity();if(window.loadResults)loadResults();if(window.loadMonth)loadMonth();}
 catch(err){$("#passwordChangeMessage").textContent=err.message;}
});
