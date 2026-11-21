const $=s=>document.querySelector(s);
const msg=$("#msg");
let allRows=[];
let cityNames=[];
let hiddenCityNames=new Set();
let selectedMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);

async function api(url,opts={}){
  const headers={...(opts.body?{"Content-Type":"application/json"}:{}),...(opts.headers||{})};
  const response=await fetch(url,{credentials:"same-origin",...opts,headers,signal:opts.signal||AbortSignal.timeout(20000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error||("Request failed ("+response.status+")"));
  return data;
}
function showPanel(on){$("#loginBox").hidden=on;$("#panel").hidden=!on;}
function showAdminView(view){
 const ads=view==="ads";
 const dashboard=$("#adminMainView");
 const adWorkspace=$("#adManagementView");
 const shortcuts=document.querySelector(".pro-shortcuts");
 dashboard.hidden=ads;
 adWorkspace.hidden=!ads;
 dashboard.style.display=ads?"none":"block";
 adWorkspace.style.display=ads?"block":"none";
 if(shortcuts)shortcuts.hidden=ads;
 if(ads) window.scrollTo({top:0,behavior:"smooth"});
}
function applyAdminRoute(){
 if(location.pathname==="/admin/advertisements"||location.pathname==="/admin/advertisements/")showAdminView("ads");
 else showAdminView("main");
}

function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function dateValue(v){return new Date(v).toISOString().slice(0,10);}
function monthKey(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");}

async function refresh(){
  // Start the month chart immediately; the larger all-results request must
  // never block the chart from appearing.
  const hiddenTask = api("/api/admin/users", {signal:AbortSignal.timeout(12000)}).then(users=>{
    hiddenCityNames = new Set((users||[]).flatMap(user=>user.cities||[]).filter(city=>city.status==="hidden").map(city=>String(city.name||"").trim()).filter(Boolean));
  }).catch(error=>{ console.warn("Hidden city status could not be loaded:",error.message); hiddenCityNames=new Set(); });
  const monthTask = hiddenTask.then(()=>loadMonth());
  try {
    allRows = await api("/api/admin/results", {signal:AbortSignal.timeout(15000)});
    await renderAdminTopResults();
    await hiddenTask;
    renderCityLinks();
  } catch (e) {
    allRows = [];
    $("#cityLinks").innerHTML = '<p class="muted">शहरों की सूची लोड नहीं हुई: '+esc(e.message)+'</p>';
  }
  const monthLoaded = await monthTask;
  // If the month endpoint failed before the full list arrived, render from
  // the data that has now loaded instead of leaving the chart stuck.
  if (!monthLoaded && allRows.length) {
    const fallback = allRows.filter(row => {
      const d = new Date(row.resultDate);
      return d.getFullYear() === selectedMonth.getFullYear() &&
        d.getMonth() === selectedMonth.getMonth();
    });
    renderMonthChart(fallback, selectedMonth);
  }
}

async function renderAdminTopResults(){
 const box=$("#adminTopResultCards");if(!box)return;
 try{
  const [rows,cities]=await Promise.all([Promise.resolve(allRows),api("/api/public/cities")]);
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const todayStart=new Date(today+"T00:00:00.000Z"),yesterday=new Date(todayStart.getTime()-86400000).toISOString().slice(0,10);
  const byCity=new Map();
  rows.filter(r=>r.published!==false&&!r.deleted).forEach(r=>{const day=new Date(r.resultDate).toISOString().slice(0,10);if(day!==today&&day!==yesterday)return;if(!byCity.has(r.title))byCity.set(r.title,{today:null,yesterday:null});const slot=byCity.get(r.title);if(day===""+today)slot.today=r;else slot.yesterday=r;});
  const visible=[...new Set([...cities.map(c=>c.cityName),...byCity.keys()])].filter(n=>n&&!hiddenCityNames.has(n)).sort((a,b)=>a.localeCompare(b,"hi"));
  if(!visible.length){box.innerHTML='<p class="muted">अभी कोई प्रकाशित रिजल्ट नहीं है।</p>';return;}
  const fixed={"disawar":"05:00 AM","desawar":"05:00 AM","faridabad":"06:20 PM","ghaziabad":"10:05 PM","gali":"12:05 AM","delhi bazar":"03:15 PM","shri ganesh":"04:45 PM","shree ganesh":"04:45 PM"};
  box.innerHTML=visible.map(city=>{
   const result=byCity.get(city)||{},now=result.today,prev=result.yesterday;
   const info=cities.find(c=>c.cityName===city)||{},time=info.expectedTime||info.resultTime||info.time||fixed[city.trim().toLowerCase()]||"";
   const value=now?String(now.resultText):"WAIT";
   const date=now?new Date(now.resultDate).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric",timeZone:"Asia/Kolkata"}):"";
   const publishedAt=now?.createdAt||now?.updatedAt||now?.resultDate;
   const clock=publishedAt?new Date(publishedAt).toLocaleTimeString("en-IN",{hour:"numeric",minute:"2-digit",hour12:true,timeZone:"Asia/Kolkata"}):"";
   const resultUrl="https://jasmelsolanki2017-svg.github.io/rk-bhai-results-portal-/";
   const message=["❤️ "+city.toUpperCase()+" ❤️","👇 LIVE RESULT 👇","","*✅   (( "+value+" ))   ✅*","","Date : "+date,...(clock?[clock]:[]),"","पूरा रिजल्ट देखें:",resultUrl].join("\n");
   const shareAttrs=now?'href="https://wa.me/?text='+encodeURIComponent(message)+'" target="_blank" rel="noopener" data-share-city="'+esc(city)+'" data-share-value="'+esc(value)+'" data-share-date="'+esc(now.resultDate)+'"':'aria-disabled="true"';
   return '<article class="top-result-card"><h3>'+esc(city)+'</h3><p class="top-result-time">'+(time?'( '+esc(time)+' )':'&nbsp;')+'</p><div class="top-result-values"><span class="top-previous">'+(prev?esc(prev.resultText):"XX")+'</span><span class="top-result-arrow">➡️</span><span class="top-current-wrap">'+(now?'<span class="new-result-badge">NEW</span>':'')+'<span class="top-current'+(now?' result-blink':'')+'">'+esc(value)+'</span></span></div><div class="dashboard-share-options"><a class="dashboard-whatsapp-share" '+shareAttrs+' data-share-mode="both">कार्ड + मैसेज</a><a class="dashboard-whatsapp-share" '+shareAttrs+' data-share-mode="card">केवल कार्ड</a><a class="dashboard-whatsapp-share" '+shareAttrs+' data-share-mode="message">केवल मैसेज</a></div></article>';
  }).join("");
 }catch(error){box.innerHTML='<p class="muted">रिजल्ट लोड नहीं हो पाए: '+esc(error.message)+'</p>';}
}


// Admin result card sharing: send the image and the public archive link together where supported.
function createAdminResultCard(city,value,resultDate){
 const canvas=document.createElement("canvas");canvas.width=1080;canvas.height=1350;
 const ctx=canvas.getContext("2d");
 const bg=ctx.createLinearGradient(0,0,1080,1350);bg.addColorStop(0,"#21172f");bg.addColorStop(.52,"#101827");bg.addColorStop(1,"#080d18");
 ctx.fillStyle=bg;ctx.fillRect(0,0,1080,1350);
 const glow=ctx.createRadialGradient(540,650,80,540,650,650);glow.addColorStop(0,"rgba(213,160,70,.20)");glow.addColorStop(1,"rgba(213,160,70,0)");
 ctx.fillStyle=glow;ctx.fillRect(0,0,1080,1350);
 ctx.strokeStyle="#d6a84f";ctx.lineWidth=7;ctx.strokeRect(34,34,1012,1282);ctx.strokeStyle="rgba(255,225,165,.38)";ctx.lineWidth=2;ctx.strokeRect(54,54,972,1242);
 ctx.textAlign="center";
 ctx.fillStyle="#f6d58d";ctx.font="bold 66px Arial";ctx.fillText("👑 Satta king 👑",540,170);
 ctx.fillStyle="#ffffff";ctx.font="bold 42px Arial";ctx.fillText("RESULTS PORTAL",540,232);
 ctx.strokeStyle="#d6a84f";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(170,292);ctx.lineTo(910,292);ctx.stroke();
 ctx.fillStyle="#ffffff";ctx.font="bold 44px Arial";ctx.fillText("TODAY'S RESULT",540,385);
 ctx.fillStyle="#f6d58d";ctx.font="bold 76px Arial";ctx.fillText(String(city||"").toUpperCase().slice(0,24),540,520);
 const date=resultDate?new Date(resultDate).toLocaleDateString("en-IN",{day:"2-digit",month:"long",year:"numeric",timeZone:"Asia/Kolkata"}):new Date().toLocaleDateString("en-IN");
 ctx.fillStyle="#e4e9f2";ctx.font="36px Arial";ctx.fillText(date,540,590);
 const panel=ctx.createLinearGradient(150,0,930,0);panel.addColorStop(0,"#30233d");panel.addColorStop(.5,"#49351d");panel.addColorStop(1,"#30233d");
 ctx.fillStyle=panel;ctx.beginPath();ctx.roundRect(115,665,850,335,34);ctx.fill();
 ctx.strokeStyle="#e0b75f";ctx.lineWidth=4;ctx.stroke();
 ctx.fillStyle="#f7dfaa";ctx.font="bold 36px Arial";ctx.fillText("PUBLISHED RESULT",540,735);
 const resultText=String(value||"—").slice(0,12);let resultFont=250;if(resultText.length>5)resultFont=210;if(resultText.length>8)resultFont=170;
 ctx.fillStyle="#ffffff";ctx.font="bold "+resultFont+"px Arial";ctx.fillText(resultText,540,925);
 ctx.strokeStyle="#d6a84f";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(170,1050);ctx.lineTo(910,1050);ctx.stroke();
 ctx.fillStyle="#f6d58d";ctx.font="bold 36px Arial";ctx.fillText("MORE RESULTS & OLD RECORDS",540,1120);
 ctx.fillStyle="#ffffff";ctx.font="bold 28px Arial";ctx.fillText("VISIT OUR WEBSITE",540,1180);
 ctx.fillStyle="#dce5f5";ctx.font="24px Arial";ctx.fillText("jasmelsolanki2017-svg.github.io/rk-bhai-results-portal-",540,1225);
 ctx.fillStyle="#c5a66c";ctx.font="26px Arial";ctx.fillText("THANK YOU FOR YOUR SUPPORT",540,1280);
 const data=canvas.toDataURL("image/png"),binary=atob(data.split(",")[1]),bytes=new Uint8Array(binary.length);
 for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
 return new File([bytes],"satta-king-result.png",{type:"image/png"});
}
function downloadAdminResultCard(file){
 const url=URL.createObjectURL(file),link=document.createElement("a");link.href=url;link.download=file.name;link.click();
 setTimeout(()=>URL.revokeObjectURL(url),1500);
}
const adminResultBox=$("#adminTopResultCards");
if(adminResultBox)adminResultBox.addEventListener("click",event=>{
 const link=event.target.closest(".dashboard-whatsapp-share[data-share-city]");
 if(!link)return;
 const mode=link.dataset.shareMode||"both";
 if(mode==="message")return; // Keep the normal WhatsApp text-only link behavior.
 try{
  const file=createAdminResultCard(link.dataset.shareCity,link.dataset.shareValue,link.dataset.shareDate);
  const message=decodeURIComponent((link.href.split("?text=")[1]||""));
  if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){
   event.preventDefault();
   const payload={files:[file],title:"👑 Satta king 👑 Result"};
   if(mode==="both")payload.text=message;
   navigator.share(payload).catch(error=>{if(error.name!=="AbortError")console.warn("Result share failed:",error);});
  }else{
   if(mode==="card")event.preventDefault();
   downloadAdminResultCard(file);
   // Combined mode also opens WhatsApp with the text and link.
  }
 }catch(error){console.warn("Result card could not be created:",error);}
});

function renderCityLinks(){
 const cities=[...new Set(allRows.map(x=>String(x.title||"").trim()).filter(name=>name&&!hiddenCityNames.has(name)))].sort((a,b)=>{const ac=/chandigarh/i.test(a),bc=/chandigarh/i.test(b);return ac!==bc?(ac?1:-1):a.localeCompare(b,"hi");});
 cityNames=cities;
 $("#cityLinks").innerHTML=cities.map(city=>"<a class=\"city-link\" href=\"/city.html?name="+encodeURIComponent(city)+"\"><strong>"+esc(city)+"</strong><span>"+allRows.filter(x=>x.title===city).length+" रिकॉर्ड</span></a>").join("")||"<p class=\"muted\">अभी कोई शहर/मार्केट रिकॉर्ड नहीं है।</p>";
}
async function loadMonth(){
  const key=monthKey(selectedMonth);
  $("#monthLabel").textContent=selectedMonth.toLocaleDateString("hi-IN",{month:"long",year:"numeric"});
  $("#nextMonth").disabled=key>=monthKey(new Date());
  $("#adminChart").innerHTML='<p class="muted">चार्ट लोड हो रहा है…</p>';
  try{
    const rows=await api("/api/admin/results?month="+encodeURIComponent(key),{signal:AbortSignal.timeout(12000)});
    renderMonthChart(rows,selectedMonth);
    return true;
  }catch(e){
    // If the month-filtered query fails but the full admin list loaded,
    // keep the chart usable from that already-fetched data.
    const fallback=allRows.filter(row=>{
      const d=new Date(row.resultDate);
      return d.getFullYear()===selectedMonth.getFullYear() && d.getMonth()===selectedMonth.getMonth();
    });
    if(fallback.length || allRows.length){
      renderMonthChart(fallback,selectedMonth);
      $("#adminChart").insertAdjacentHTML("afterbegin",'<p class="muted">मासिक API धीमा था; उपलब्ध रिकॉर्ड से चार्ट दिखाया गया है।</p>');
    }else{
      $("#adminChart").innerHTML='<p class="muted">चार्ट लोड नहीं हुआ: '+esc(e.message)+'</p>';
    }
    return false;
  }
}
function renderMonthChart(rows,month){
  rows=rows.filter(row=>!hiddenCityNames.has(String(row.title||"").trim()));
  if(!rows.length){$("#adminChart").innerHTML='<p class="muted empty-month">इस महीने का कोई रिकॉर्ड नहीं है।</p>';return;}
  const titles=[...new Set(rows.map(r=>r.title))].sort((a,b)=>{const ac=/chandigarh/i.test(a),bc=/chandigarh/i.test(b);return ac!==bc?(ac?1:-1):a.localeCompare(b,"hi");});
  const byDay=new Map();
  rows.forEach(row=>{
    const day=new Date(row.resultDate).getUTCDate();
    if(!byDay.has(day))byDay.set(day,{});
    byDay.get(day)[row.title]=row;
  });
  const daysInMonth=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  const groups=[];
  for(let i=0;i<titles.length;i+=7)groups.push(titles.slice(i,i+7));
  const summary='<div class="chart-summary"><strong>'+titles.length+' शहर/मार्केट</strong><span>'+rows.length+' रिकॉर्ड · एंट्री एडिट करने के लिए उस पर टैप करें</span></div>';
  const tables=groups.map((group,index)=>{
    const head='<tr><th class="date-col">तारीख</th>'+group.map(t=>'<th>'+esc(t)+'</th>').join("")+'</tr>';
    const body=Array.from({length:daysInMonth},(_,i)=>{
      const day=i+1, values=byDay.get(day)||{};
      return '<tr><th class="date-col">'+String(day).padStart(2,"0")+'</th>'+group.map(t=>{
        const row=values[t];
        return '<td>'+(row?'<button class="chart-edit" type="button" data-edit="'+row._id+'" aria-label="Edit '+esc(t)+' '+day+'">'+esc(row.resultText)+'</button>':'—')+'</td>';
      }).join("")+'</tr>';
    }).join("");
    return '<section class="market-chart"><h3>चार्ट '+(index+1)+' / '+groups.length+'</h3><div class="table-scroll"><table class="history-table"><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div></section>';
  }).join("");
  $("#adminChart").innerHTML=summary+tables;
}
function resetForm(){
  const form=$("#resultForm");form.reset();form.elements.editId.value="";
  form.elements.resultDate.value=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  form.elements.published.checked=true;
  $("#formTitle").textContent="नया रिकॉर्ड जोड़ें";$("#saveRecord").textContent="रिकॉर्ड सेव करें";$("#cancelEdit").hidden=true;
}
function editRecord(id){
  const row=allRows.find(x=>x._id===id);if(!row)return;
  const f=$("#resultForm").elements;
  f.editId.value=row._id;f.title.value=row.title;f.resultText.value=row.resultText;
  f.resultDate.value=dateValue(row.resultDate);f.sourceUrl.value=row.sourceUrl||"";
  f.published.checked=!!row.published;
  $("#formTitle").textContent="रिकॉर्ड एडिट करें";$("#saveRecord").textContent="बदलाव सेव करें";$("#cancelEdit").hidden=false;
  $("#resultForm").scrollIntoView({behavior:"smooth",block:"start"});
}

function renderTitleSuggestions(query=""){
 const box=$("#titleSuggestions");if(!box)return;
 const q=String(query||"").trim().toLocaleLowerCase("hi");
 const matches=cityNames.filter(name=>!q||name.toLocaleLowerCase("hi").includes(q)).slice(0,40);
 box.innerHTML=matches.map(name=>'<button type="button" class="city-suggestion" data-city-name="'+esc(name)+'">'+esc(name)+'</button>').join("")||'<div class="city-suggestion-empty">कोई मिलता-जुलता शहर नहीं मिला</div>';
 box.hidden=false;
}
const titleInput=$("#resultTitle"),suggestionBox=$("#titleSuggestions");
titleInput.addEventListener("focus",()=>renderTitleSuggestions(titleInput.value));
titleInput.addEventListener("input",()=>renderTitleSuggestions(titleInput.value));
suggestionBox.addEventListener("click",e=>{
 const item=e.target.closest("[data-city-name]");if(!item)return;
 titleInput.value=item.dataset.cityName;suggestionBox.hidden=true;titleInput.focus();
});
document.addEventListener("click",e=>{
 if(!e.target.closest(".city-picker"))suggestionBox.hidden=true;
});
titleInput.addEventListener("keydown",e=>{if(e.key==="Escape")suggestionBox.hidden=true;});

$("#loginForm").addEventListener("submit",async e=>{
  e.preventDefault();msg.textContent="Login हो रहा है…";
  try{const f=new FormData(e.target);await api("/api/admin/login",{method:"POST",body:JSON.stringify({username:f.get("username"),password:f.get("password")})});showPanel(true);applyAdminRoute();await loadPosterManager();await loadPopupAdManager();await loadAnnouncementManager();await refresh();msg.textContent="Login सफल";}
  catch(err){msg.textContent=err.message;}
});
$("#resultForm").addEventListener("submit",async e=>{
  e.preventDefault();
  try{
    const f=new FormData(e.target),id=f.get("editId");
    const payload={title:f.get("title"),resultText:f.get("resultText"),resultDate:f.get("resultDate"),sourceUrl:f.get("sourceUrl"),published:f.has("published")};
    await api(id?"/api/admin/results/"+id:"/api/admin/results",{method:id?"PATCH":"POST",body:JSON.stringify(payload)});
    resetForm();await refresh();msg.textContent=id?"रिकॉर्ड अपडेट हो गया":"नया रिकॉर्ड सेव हो गया";
  }catch(err){msg.textContent=err.message;}
});
$("#adminChart").addEventListener("click",e=>{
  const edit=e.target.closest("[data-edit]")?.dataset.edit;if(edit)editRecord(edit);
});


resetForm();
$("#cancelEdit").addEventListener("click",resetForm);
$("#prevMonth").addEventListener("click",()=>{selectedMonth=new Date(selectedMonth.getFullYear(),selectedMonth.getMonth()-1,1);loadMonth();});
$("#nextMonth").addEventListener("click",()=>{const d=new Date(selectedMonth.getFullYear(),selectedMonth.getMonth()+1,1);if(d<=new Date(new Date().getFullYear(),new Date().getMonth(),1)){selectedMonth=d;loadMonth();}});
$("#logout").addEventListener("click",async()=>{
  try{await api("/api/admin/logout",{method:"POST"});showPanel(false);$("#loginForm").reset();msg.textContent="Logout हो गया";}
  catch(err){msg.textContent=err.message;showPanel(false);}
});
(async()=>{try{await api("/api/admin/session");showPanel(true);applyAdminRoute();await loadPosterManager();await loadPopupAdManager();await loadAnnouncementManager();await refresh();msg.textContent="Admin session चालू है";}
catch{showPanel(false);}})();

async function loadPopupAdManager(){try{const p=await api("/api/admin/popup-ad");$("#popupAdTitle").value=p.title||"";$("#popupAdDescription").value=p.description||"";$("#popupAdUrl").value=p.buttonUrl||"";$("#popupAdButton").value=p.buttonText||"अभी देखें";$("#popupAdDelay").value=String(p.delaySeconds??0);$("#popupAdFrequency").value=String(p.frequencyMinutes??0);$("#popupAdEnabled").checked=!!p.enabled;if(p.imageData)$("#popupAdPreview").innerHTML='<img src="'+p.imageData+'" alt="Popup ad preview">';}catch(e){$("#popupAdMsg").textContent="Popup Ad load error: "+e.message;}}
$("#popupAdImage").addEventListener("change",()=>{const file=$("#popupAdImage").files[0];if(!file)return;if(file.size>5*1024*1024){$("#popupAdMsg").textContent="फोटो 5 MB से छोटी रखें।";$("#popupAdImage").value="";return;}const reader=new FileReader();reader.onload=()=>{$("#popupAdPreview").innerHTML='<img src="'+reader.result+'" alt="Popup ad preview">';};reader.readAsDataURL(file);});
$("#popupAdForm").addEventListener("submit",async e=>{e.preventDefault();$("#popupAdMsg").textContent="सेव हो रहा है…";try{let imageData="";const file=$("#popupAdImage").files[0];if(file){if(file.size>5*1024*1024)throw new Error("फोटो 5 MB से छोटी रखें।");imageData=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error("फोटो पढ़ी नहीं जा सकी।"));reader.readAsDataURL(file);});}await api("/api/admin/popup-ad",{method:"PUT",body:JSON.stringify({title:$("#popupAdTitle").value,description:$("#popupAdDescription").value,buttonUrl:$("#popupAdUrl").value,buttonText:$("#popupAdButton").value,imageData,delaySeconds:Number($("#popupAdDelay").value),frequencyMinutes:Number($("#popupAdFrequency").value),enabled:$("#popupAdEnabled").checked})});$("#popupAdImage").value="";$("#popupAdMsg").textContent="Popup Ad सेव हो गया।";await loadPopupAdManager();}catch(err){$("#popupAdMsg").textContent=err.message;}});
$("#popupAdOff").addEventListener("click",async()=>{try{await api("/api/admin/popup-ad",{method:"PUT",body:JSON.stringify({title:$("#popupAdTitle").value,description:$("#popupAdDescription").value,buttonUrl:$("#popupAdUrl").value,buttonText:$("#popupAdButton").value,imageData:"",delaySeconds:Number($("#popupAdDelay").value),frequencyHours:Number($("#popupAdFrequency").value),enabled:false})});$("#popupAdEnabled").checked=false;$("#popupAdMsg").textContent="Popup Ad बंद कर दिया गया।";}catch(e){$("#popupAdMsg").textContent=e.message;}});
async function loadPosterManager(){try{const p=await api("/api/admin/poster");$("#posterHeading").value=p.heading||"";$("#posterDescription").value=p.description||"";$("#posterButtonText").value=p.buttonText||"";$("#posterButtonUrl").value=p.buttonUrl||"";$("#posterEnabled").checked=!!p.enabled;}catch(e){$("#posterMsg").textContent="Ad load error: "+e.message;}}
$("#posterForm").addEventListener("submit",async e=>{e.preventDefault();$("#posterMsg").textContent="Saving…";try{await api("/api/admin/poster",{method:"PUT",body:JSON.stringify({heading:$("#posterHeading").value,description:$("#posterDescription").value,buttonText:$("#posterButtonText").value,buttonUrl:$("#posterButtonUrl").value,enabled:$("#posterEnabled").checked})});$("#posterMsg").textContent="Ad saved. Public index पर update हो गया।";}catch(err){$("#posterMsg").textContent=err.message;}});
$("#posterOff").addEventListener("click",async()=>{$("#posterEnabled").checked=false;try{await api("/api/admin/poster",{method:"PUT",body:JSON.stringify({heading:$("#posterHeading").value,description:$("#posterDescription").value,buttonText:$("#posterButtonText").value,buttonUrl:$("#posterButtonUrl").value,enabled:false})});$("#posterMsg").textContent="Ad public page से OFF कर दिया गया।";}catch(e){$("#posterMsg").textContent=e.message;}});
$("#posterDelete").addEventListener("click",async()=>{if(!confirm("विज्ञापन खाली और OFF करना है?"))return;$("#posterHeading").value="";$("#posterDescription").value="";$("#posterButtonText").value="";$("#posterButtonUrl").value="";$("#posterEnabled").checked=false;try{await api("/api/admin/poster",{method:"PUT",body:JSON.stringify({heading:"",description:"",buttonText:"",buttonUrl:"",enabled:false})});$("#posterMsg").textContent="Ad delete/clear हो गया।";}catch(e){$("#posterMsg").textContent=e.message;}});

async function loadAnnouncementManager(){try{const a=await api("/api/admin/announcement");$("#announcementTitleInput").value=a.title||"";$("#announcementMessageInput").value=a.message||"";$("#announcementEnabled").checked=!!a.enabled;}catch(e){$("#announcementMsg").textContent="Banner load error: "+e.message;}}
$("#announcementForm").addEventListener("submit",async e=>{e.preventDefault();$("#announcementMsg").textContent="Saving…";try{await api("/api/admin/announcement",{method:"PUT",body:JSON.stringify({title:$("#announcementTitleInput").value,message:$("#announcementMessageInput").value,enabled:$("#announcementEnabled").checked})});$("#announcementMsg").textContent="सूचना सेव हो गई। Public website पर update हो जाएगी।";}catch(err){$("#announcementMsg").textContent=err.message;}});
$("#announcementOff").addEventListener("click",async()=>{try{await api("/api/admin/announcement",{method:"PUT",body:JSON.stringify({title:$("#announcementTitleInput").value,message:$("#announcementMessageInput").value,enabled:false})});$("#announcementEnabled").checked=false;$("#announcementMsg").textContent="Public banner OFF कर दिया गया।";}catch(e){$("#announcementMsg").textContent=e.message;}});
