const $=s=>document.querySelector(s);
async function userApi(url,opts={}){
 const response=await fetch(url,{credentials:"same-origin",...opts,headers:{...(opts.body?{"Content-Type":"application/json"}:{}),...(opts.headers||{})}});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error||"Request failed");
 return data;
}
function showUser(on){$("#userLogin").hidden=on;$("#userContent").hidden=!on;}
$("#userLoginForm").addEventListener("submit",async e=>{
 e.preventDefault();$("#userMessage").textContent="Login हो रहा है…";
 try{const f=new FormData(e.target);const data=await userApi("/api/user/login",{method:"POST",body:JSON.stringify({username:f.get("username"),password:f.get("password")})});$("#userName").textContent=data.username;showUser(true);await loadMyCity();$("#userMessage").textContent="";if(window.loadResults)loadResults();if(window.loadMonth)loadMonth();}
 catch(err){$("#userMessage").textContent=err.message;}
});
$("#userLogout").addEventListener("click",async()=>{try{await userApi("/api/user/logout",{method:"POST"});}catch{}showUser(false);$("#userLoginForm").reset();});
(async()=>{try{const data=await userApi("/api/user/session");$("#userName").textContent=data.username;showUser(true);await loadMyCity();}catch{showUser(false);}})();

async function loadMyCity(){
 const city=await userApi("/api/user/city");
 const form=$("#cityForm"),status=$("#cityStatus"),box=$("#userRecordBox");
 if(!city){status.textContent="आपने अभी शहर नहीं बनाया है। एक ही शहर भेज सकते हैं; Admin approval जरूरी है।";form.hidden=false;box.hidden=true;return;}
 form.hidden=true;
 status.textContent="शहर: "+city.cityName+" · स्थिति: "+({pending:"Approval pending",approved:"Approved",rejected:"Rejected"}[city.status]||city.status);
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
 try{await userApi("/api/user/city",{method:"POST",body:JSON.stringify({cityName})});await loadMyCity();}
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
