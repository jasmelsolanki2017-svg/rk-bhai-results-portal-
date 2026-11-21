const host=document.getElementById("results");
const topResultCards=document.getElementById("topResultCards");
if(topResultCards)topResultCards.addEventListener("click",event=>{
  const link=event.target.closest("[data-chart-city]");
  if(!link)return;
  event.preventDefault();
  if(chartCity){chartCity.value=link.dataset.chartCity;loadMonth();}
  document.getElementById("archive")?.scrollIntoView({behavior:"smooth"});
});
const chartHost=document.getElementById("historyChart");
const monthLabel=document.getElementById("monthLabel");
const prevButton=document.getElementById("prevMonth");
const nextButton=document.getElementById("nextMonth");
const citySearch=document.getElementById("citySearch");
const chartCity=document.getElementById("chartCity");
const historyDate=document.getElementById("historyDate");
const clearDate=document.getElementById("clearDate");
document.getElementById("year").textContent=new Date().getFullYear();
let selectedMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);
let recentRows=[];
let recentCities=[];
let monthRows=[];
let monthCities=[];
let knownResultKeys=new Set();
let notificationBaselineReady=false;
let notificationToastTimer=null;
function resultKey(row){return String(row.id||row._id||[row.title,row.resultDate,row.resultText].join("|"));}
function showNewResultNotice(rows){
  if(!rows.length)return;
  const toast=document.getElementById("newResultToast");
  if(toast){
    const first=rows[0];
    toast.textContent=rows.length===1
      ? "नया रिजल्ट प्रकाशित: "+(first.title||"नया परिणाम")+" — "+(first.resultText||"देखने के लिए खोलें")
      : rows.length+" नए रिजल्ट प्रकाशित हुए हैं।";
    toast.hidden=false;
    toast.classList.add("is-visible");
    clearTimeout(notificationToastTimer);
    notificationToastTimer=setTimeout(()=>{toast.classList.remove("is-visible");toast.hidden=true;},9000);
  }
  if("Notification" in window && Notification.permission==="granted"){
    const first=rows[0];
    try{
      new Notification("Satta King पर नया रिजल्ट",{
        body:rows.length===1?(first.title+" : "+first.resultText):rows.length+" नए रिजल्ट प्रकाशित हुए हैं।",
        icon:"./icon.svg",
        tag:"rk-bhai-new-results"
      });
    }catch(error){console.warn("Browser notification unavailable:",error);}
  }
}
function updateKnownResults(rows,notify=false){
  const nextKeys=new Set(rows.map(resultKey));
  if(notificationBaselineReady&&notify){
    const added=rows.filter(row=>!knownResultKeys.has(resultKey(row)));
    if(added.length)showNewResultNotice(added);
  }
  knownResultKeys=nextKeys;
  notificationBaselineReady=true;
}

let publicSnapshotPromise=null;
function loadPublicSnapshot(){
  if(!publicSnapshotPromise){
    const snapshotUrl="https://raw.githubusercontent.com/jasmelsolanki2017-svg/rk-bhai-results-portal-/public-data/data/public-results.json";
    publicSnapshotPromise=fetch(snapshotUrl,{cache:"no-store"})
      .then(response=>{if(!response.ok)throw new Error("Public results snapshot unavailable");return response.json();})
      .catch(error=>{publicSnapshotPromise=null;throw error;});
  }
  return publicSnapshotPromise;
}
async function getJson(url){
  // GitHub Pages is static: read one shared snapshot instead of waiting for the sleeping Render API.
  if(location.hostname.endsWith("github.io")&&(url.startsWith("/api/results")||url.startsWith("/api/public/cities"))){
    try {
      const snapshot=await loadPublicSnapshot();
      if(!Array.isArray(snapshot.results)||!Array.isArray(snapshot.cities))throw new Error("Snapshot format invalid");
      if(url.startsWith("/api/public/cities"))return snapshot.cities;
      const params=new URLSearchParams(url.split("?")[1]||"");
      let rows=snapshot.results;
      if(params.get("recent")==="2"){
        const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
        const start=new Date(today+"T00:00:00.000Z");
        const from=new Date(start.getTime()-86400000);
        const to=new Date(start.getTime()+86400000);
        rows=rows.filter(row=>new Date(row.resultDate)>=from&&new Date(row.resultDate)<to);
      }else if(params.get("month")){
        const [year,month]=params.get("month").split("-").map(Number);
        const from=new Date(Date.UTC(year,month-1,1)),to=new Date(Date.UTC(year,month,1));
        rows=rows.filter(row=>new Date(row.resultDate)>=from&&new Date(row.resultDate)<to);
      }else if(params.get("today")==="1"){
        const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
        const from=new Date(today+"T00:00:00.000Z"),to=new Date(from.getTime()+86400000);
        rows=rows.filter(row=>new Date(row.resultDate)>=from&&new Date(row.resultDate)<to);
      }else if(params.get("date")){
        const from=new Date(params.get("date")+"T00:00:00.000Z"),to=new Date(from.getTime()+86400000);
        rows=rows.filter(row=>new Date(row.resultDate)>=from&&new Date(row.resultDate)<to);
      }
      return rows;
    } catch(snapshotError) {
      console.warn("GitHub snapshot unavailable; falling back to Render API:",snapshotError);
      const fallback=await fetch("https://rk-bhai-results-portal.onrender.com"+url,{mode:"cors",credentials:"omit",cache:"no-store"});
      if(!fallback.ok)throw new Error("Snapshot and live API are unavailable");
      return fallback.json();
    }
  }
  const response=await fetch(url);
  if(!response.ok)throw new Error("Request failed");
  return response.json();
}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function dateKey(value){return new Date(value).toISOString().slice(0,10);}
function formatUpdate(value){
  if(!value)return "";
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return "";
  return date.toLocaleString("hi-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:true});
}
function renderLiveResultTicker(){
  const track=document.getElementById("liveResultTickerTrack");
  if(!track)return;
  const todayKey=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const latest=recentRows
    .filter(row=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(row.resultDate))===todayKey)
    .sort((a,b)=>new Date(b.createdAt||b.updatedAt||b.resultDate||0)-new Date(a.createdAt||a.updatedAt||a.resultDate||0));
  if(!latest.length){track.innerHTML="<span>आज का कोई रिजल्ट उपलब्ध नहीं है</span>";return;}
  const items=latest.map(row=>'<span class="live-result-ticker-item"><b>'+escapeHtml(row.title||"Result")+'</b><strong>'+escapeHtml(row.resultText||"—")+'</strong></span>').join("");
  track.innerHTML=items+items;
}
function renderRecent(){
  renderLiveResultTicker();
  const todayKey=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const todayStart=new Date(todayKey+"T00:00:00.000Z");
  const yesterdayKey=new Date(todayStart.getTime()-86400000).toISOString().slice(0,10);
  const byCity=new Map();
  recentRows.forEach(row=>{
    const dayKey=dateKey(row.resultDate);
    if(!byCity.has(row.title))byCity.set(row.title,{today:null,yesterday:null});
    const item=byCity.get(row.title);
    if(dayKey===todayKey)item.today=row;
    if(dayKey===yesterdayKey)item.yesterday=row;
  });
  recentCities.forEach(city=>{if(!byCity.has(city.cityName))byCity.set(city.cityName,{today:null,yesterday:null});});
  const todayStat=document.getElementById("statToday");
  if(todayStat)todayStat.textContent=recentRows.filter(r=>dateKey(r.resultDate)===todayKey).length;
  const query=(citySearch?.value||"").trim().toLocaleLowerCase("hi");
  const entries=[...byCity.entries()].filter(([city])=>city.toLocaleLowerCase("hi").includes(query)).sort((a,b)=>{
    const latestTime=item=>Math.max(...[item[1].today,item[1].yesterday].filter(Boolean).map(row=>new Date(row.createdAt||row.updatedAt||row.resultDate||0).getTime()),0);
    return latestTime(b)-latestTime(a);
  });
  if(!entries.length){if(topResultCards)topResultCards.innerHTML='<p class="muted">अभी कोई प्रकाशित रिजल्ट नहीं है।</p>';return;}
  const yesterdayLabel=new Date(todayStart.getTime()-86400000).toLocaleDateString("hi-IN",{day:"2-digit",month:"short"});
  const todayLabel=todayStart.toLocaleDateString("hi-IN",{day:"2-digit",month:"short"});
  const newestResult=[...recentRows].sort((a,b)=>new Date(b.createdAt||b.updatedAt||b.resultDate||0).getTime()-new Date(a.createdAt||a.updatedAt||a.resultDate||0).getTime())[0];
  const newestResultKey=newestResult?resultKey(newestResult):null;
  const cell=(row,isToday=false)=>{if(!row)return isToday?'<span class="wait-badge">WAIT</span>':'<span class="no-result">XX</span>';return '<span'+(isToday?' class="result-blink"':'')+'>'+escapeHtml(row.resultText)+'</span>'+(isToday?' <span class="new-result-badge">NEW</span>':'');};
  if(topResultCards){
    topResultCards.innerHTML=entries.map(([city,result])=>{
      const cityInfo=recentCities.find(item=>item.cityName===city)||{};
      const fixedTimes={"disawar":"05:00 AM","desawar":"05:00 AM","faridabad":"06:20 PM","ghaziabad":"10:05 PM","gali":"12:05 AM","delhi bazar":"03:15 PM","shri ganesh":"04:45 PM","shree ganesh":"04:45 PM"};
      const time=cityInfo.expectedTime||cityInfo.resultTime||cityInfo.time||fixedTimes[String(city).trim().toLocaleLowerCase("en")]||"";
      const isGali=String(city).trim().toLocaleLowerCase("en")==="gali";
      const indiaHour=Number(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Kolkata",hour:"2-digit",hourCycle:"h23"}).format(new Date()));
      const galiBlinkWindow=isGali&&indiaHour<14;
      const galiCarry=galiBlinkWindow&&!result.today&&!!result.yesterday;
      const currentRow=isGali
        ?(galiBlinkWindow?(result.today||(galiCarry?result.yesterday:null)):(result.today||result.yesterday))
        :result.today;
      const previousRow=isGali&&!galiBlinkWindow&&!result.today?null:result.yesterday;
      const shouldBlink=isGali?!!currentRow&&(galiBlinkWindow||!result.today):!!result.today;
      const previousDisplayRow=isGali?(currentRow||previousRow):previousRow;
      const previous=previousDisplayRow?escapeHtml(previousDisplayRow.resultText):"XX";
      const current=isGali?"-":(currentRow?escapeHtml(currentRow.resultText):"—");
      const blinkLeft=isGali&&shouldBlink&&!!previousDisplayRow;
      const blinkRight=!isGali&&shouldBlink;
      return '<article class="top-result-card"><h3>'+escapeHtml(city)+'</h3><p class="top-result-time">'+(time?'( '+escapeHtml(time)+' )':'&nbsp;')+'</p><div class="top-result-values"><span class="top-previous">'+(blinkLeft?'<span class="new-result-badge">NEW</span>':'')+previous+'</span><span class="top-result-arrow" aria-hidden="true">➡️</span><span class="top-current-wrap">'+(blinkRight?'<span class="new-result-badge">NEW</span>':'')+'<span class="top-current'+(blinkRight?' result-blink':'')+'">'+current+'</span></span></div><div class="top-result-actions"><a class="top-chart-link" href="#archive" data-chart-city="'+escapeHtml(city)+'">चार्ट देखें</a><button type="button" class="top-share-card" data-share-city="'+escapeHtml(city)+'" data-share-value="'+escapeHtml(currentRow?currentRow.resultText:"") +'" data-share-date="'+escapeHtml(currentRow?currentRow.resultDate:"") +'" '+(currentRow?'':'disabled')+'>शेयर कार्ड</button></div></article>';
    }).join("");
  }

}
async function makeResultShareCard(city,value,resultDate){
  const siteUrl="https://jasmelsolanki2017-svg.github.io/rk-bhai-results-portal-/";
  const canvas=document.createElement("canvas");
  canvas.width=1080;canvas.height=1350;
  const ctx=canvas.getContext("2d");
  const gradient=ctx.createLinearGradient(0,0,1080,1350);
  gradient.addColorStop(0,"#17140e");gradient.addColorStop(1,"#090909");
  ctx.fillStyle=gradient;ctx.fillRect(0,0,1080,1350);
  ctx.strokeStyle="#b88a3b";ctx.lineWidth=5;ctx.strokeRect(42,42,996,1266);
  ctx.textAlign="center";
  ctx.fillStyle="#e6bd70";ctx.font="bold 62px Arial";ctx.fillText("👑 Satta king 👑",540,170);
  ctx.fillStyle="#f5f0e6";ctx.font="bold 36px Arial";ctx.fillText("RESULTS PORTAL",540,225);
  ctx.strokeStyle="#80632d";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(180,275);ctx.lineTo(900,275);ctx.stroke();
  ctx.fillStyle="#d8d0c0";ctx.font="bold 40px Arial";ctx.fillText("TODAY'S RESULT",540,365);
  const label=String(city||"").slice(0,28);
  ctx.fillStyle="#e6bd70";ctx.font="bold 58px Arial";ctx.fillText(label,540,485);
  const shareDateValue=resultDate?new Date(resultDate):new Date();
  if(String(city||"").trim().toLocaleLowerCase("en")==="gali"&&resultDate)shareDateValue.setUTCDate(shareDateValue.getUTCDate()-1);
  const date=shareDateValue.toLocaleDateString("en-IN",{day:"2-digit",month:"long",year:"numeric",timeZone:"Asia/Kolkata"});
  ctx.fillStyle="#cfc6b5";ctx.font="32px Arial";ctx.fillText(date,540,550);
  ctx.fillStyle="#b88a3b";ctx.font="bold 30px Arial";ctx.fillText("PUBLISHED RESULT",540,680);
  ctx.fillStyle="#f5d78e";ctx.font="bold 190px Arial";ctx.fillText(String(value||"—").slice(0,12),540,890);
  ctx.strokeStyle="#80632d";ctx.beginPath();ctx.moveTo(180,980);ctx.lineTo(900,980);ctx.stroke();
  ctx.fillStyle="#e6bd70";ctx.font="bold 34px Arial";ctx.fillText("CHECK MORE RESULTS & OLD RECORDS",540,1070);
  ctx.fillStyle="#f5f0e6";ctx.font="30px Arial";ctx.fillText("VISIT OUR WEBSITE",540,1140);
  ctx.fillStyle="#d8d0c0";ctx.font="27px Arial";ctx.fillText("jasmelsolanki2017-svg.github.io/rk-bhai-results-portal-",540,1195);
  ctx.fillStyle="#9f8a64";ctx.font="24px Arial";ctx.fillText("THANK YOU FOR YOUR SUPPORT",540,1260);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
  if(!blob)throw new Error("Card image could not be created");
  const file=new File([blob],"satta-king-result.png",{type:"image/png"});
  const shareText="👑 Satta king 👑 RESULTS PORTAL\n"+String(city||"Result")+" : "+String(value||"—")+"\nDate: "+date+"\n\nपूरा रिजल्ट और पुराने रिकॉर्ड यहाँ देखें:\n"+siteUrl;
  if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){
    await navigator.share({files:[file],title:"👑 Satta king 👑 Result",text:shareText});
  }else{
    const url=URL.createObjectURL(blob);
    const link=document.createElement("a");link.href=url;link.download="satta-king-result.png";link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(shareText);}catch(error){}}
    alert("रिजल्ट कार्ड डाउनलोड हो गया। शेयर करने के लिए वेबसाइट लिंक भी कॉपी कर दिया गया है।");
  }
}
if(topResultCards)topResultCards.addEventListener("click",async event=>{
  const button=event.target.closest("[data-share-city]");
  if(!button)return;
  try{button.disabled=true;await makeResultShareCard(button.dataset.shareCity,button.dataset.shareValue,button.dataset.shareDate);}
  catch(error){if(error.name!=="AbortError")alert("शेयर कार्ड नहीं बन पाया।");}
  finally{button.disabled=false;}
});
async function loadResults({notify=false}={}){
  try{
    const [rows,cities]=await Promise.all([getJson("/api/results?recent=2"),getJson("/api/public/cities")]);
    recentRows=rows;recentCities=cities;updateKnownResults(rows,notify);renderRecent();
  }catch(e){if(topResultCards)topResultCards.innerHTML='<p class="muted">अभी परिणाम लोड नहीं हो पाए। कृपया बाद में प्रयास करें।</p>';}
}
async function checkForNewResults(){
  // Refresh the static GitHub snapshot in the background; Render is not required.
  publicSnapshotPromise=null;
  try{
    await loadResults({notify:true});
    await loadMonth();
  }catch(error){console.warn("Background result refresh failed:",error);}
}
const notificationButton=document.getElementById("enableNotifications");
if(notificationButton){
  const refreshNotificationButton=()=>{
    notificationButton.textContent=("Notification" in window&&Notification.permission==="granted")
      ?"✓ रिजल्ट नोटिफिकेशन चालू हैं":"🔔 रिजल्ट नोटिफिकेशन चालू करें";
  };
  refreshNotificationButton();
  notificationButton.addEventListener("click",async()=>{
    if(!("Notification" in window)){
      alert("इस ब्राउज़र में नोटिफिकेशन उपलब्ध नहीं हैं। नए रिजल्ट वेबसाइट खोलने पर दिखेंगे।");
      return;
    }
    try{
      const permission=await Notification.requestPermission();
      refreshNotificationButton();
      if(permission==="granted")alert("नोटिफिकेशन चालू हो गए। वेबसाइट खुली रहने पर नए रिजल्ट की सूचना मिलेगी।");
      else alert("नोटिफिकेशन की अनुमति नहीं मिली। वेबसाइट पर नए रिजल्ट की सूचना फिर भी दिखेगी।");
    }catch(error){alert("नोटिफिकेशन चालू नहीं हो पाए।");}
  });
}
function monthKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;}
function populateCityFilter(cities,rows){
  if(!chartCity)return;
  const current=chartCity.value;
  const names=[...new Set([...rows.map(r=>r.title),...cities.map(c=>c.cityName)])].sort((a,b)=>a.localeCompare(b,"hi"));
  chartCity.innerHTML='<option value="">सभी शहर / मार्केट</option>'+names.map(name=>'<option value="'+escapeHtml(name)+'">'+escapeHtml(name)+'</option>').join("");
  if(names.includes(current))chartCity.value=current;
}
async function loadMonth(){
  const key=monthKey(selectedMonth);
  monthLabel.textContent=selectedMonth.toLocaleDateString("hi-IN",{month:"long",year:"numeric"});
  prevButton.disabled=false;
  nextButton.disabled=monthKey(selectedMonth)>=monthKey(new Date());
  chartHost.innerHTML='<p class="muted">रिकॉर्ड लोड हो रहे हैं…</p>';
  try{
    const [rows,cities]=await Promise.all([getJson("/api/results?month="+encodeURIComponent(key)),getJson("/api/public/cities")]);
    monthRows=rows;monthCities=cities;
    const monthStat=document.getElementById("statMonth"),cityStat=document.getElementById("statCities");
    if(monthStat)monthStat.textContent=rows.length;
    if(cityStat)cityStat.textContent=new Set(rows.map(r=>r.title)).size;
    populateCityFilter(cities,rows);

    renderMonthTable();
  }catch(e){chartHost.innerHTML='<p class="muted">मासिक रिकॉर्ड लोड नहीं हो पाए।</p>';}
}
function renderMonthTable(){
  let rows=monthRows;
  let titles=[...new Set([...rows.map(r=>r.title),...monthCities.map(c=>c.cityName)])];
  if(chartCity?.value){titles=titles.filter(t=>t===chartCity.value);rows=rows.filter(r=>r.title===chartCity.value);}
  const marketOrder=[["दिसावर","disawar","दिसावर"],["श्री गणेश","शिरी गणेश","shri ganesh","sri ganesh"],["दिल्ली बाजार","delhi bajar","delhi bazar","दिल्ली बाजार"],["फरीदाबाद","faridabad"],["चंडीगढ़ सिटी","chandigarh city","चंडीगढ़"],["गाजियाबाद","ghaziabad","गाजियाबाद"],["गली","gali"]];
  const marketRank=name=>{const value=String(name).toLocaleLowerCase("hi").replace(/[\\s_-]+/g,"");const index=marketOrder.findIndex(aliases=>aliases.some(alias=>value.includes(alias.toLocaleLowerCase("hi").replace(/[\\s_-]+/g,""))));return index<0?marketOrder.length:index;};
  titles.sort((a,b)=>{const ar=marketRank(a),br=marketRank(b);return ar!==br?ar-br:a.localeCompare(b,"hi");});
  if(!titles.length){chartHost.innerHTML='<p class="muted empty-month">इस महीने के लिए कोई प्रकाशित रिकॉर्ड या approved city नहीं मिला।</p>';return;}
  const byDay=new Map();
  rows.forEach(row=>{
    const day=new Date(row.resultDate).getUTCDate();
    if(!byDay.has(day))byDay.set(day,{});
    byDay.get(day)[row.title]=row;
  });
  const daysInMonth=new Date(selectedMonth.getFullYear(),selectedMonth.getMonth()+1,0).getDate();
  const chosenDate=historyDate?.value||"";
  const todayKey=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const currentMonthKey=todayKey.slice(0,7);
  const visibleDays=monthKey(selectedMonth)===currentMonthKey?Math.min(daysInMonth,Number(todayKey.slice(8,10))):daysInMonth;
  const dayNumbers=Array.from({length:visibleDays},(_,i)=>i+1).filter(day=>!chosenDate||String(day).padStart(2,"0")===chosenDate.slice(8,10));
  const groups=[];for(let i=0;i<titles.length;i+=7)groups.push(titles.slice(i,i+7));
  const summary='<div class="chart-summary"><strong>'+titles.length+' शहर/मार्केट</strong>'+(chosenDate?'<span>तारीख: '+escapeHtml(new Date(chosenDate+"T00:00:00").toLocaleDateString("hi-IN"))+'</span>':'')+'</div>';
  const tables=groups.map((group,index)=>{
    const head='<tr><th class="date-col">तारीख</th>'+group.map(t=>'<th>'+escapeHtml(t)+'</th>').join("")+'</tr>';
    const body=dayNumbers.map(day=>{
      const values=byDay.get(day)||{};
      return '<tr><th class="date-col">'+String(day).padStart(2,"0")+'</th>'+group.map(t=>{const row=values[t];return '<td>'+(row?escapeHtml(row.resultText):'—')+'</td>';}).join("")+'</tr>';
    }).join("");
    return '<section class="market-chart"><h3>चार्ट '+(index+1)+' / '+groups.length+'</h3><div class="table-scroll"><table class="history-table"><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div></section>';
  }).join("");
  chartHost.innerHTML=summary+tables;
  if(chosenDate&&monthKey(new Date(chosenDate+"T00:00:00"))!==monthKey(selectedMonth)){
    chartHost.innerHTML='<p class="muted">चुनी गई तारीख इस महीने में नहीं है। उस महीने पर जाने के लिए ऊपर महीना बदलें।</p>';
  }
}
prevButton.addEventListener("click",()=>{selectedMonth=new Date(selectedMonth.getFullYear(),selectedMonth.getMonth()-1,1);loadMonth();});
nextButton.addEventListener("click",()=>{const candidate=new Date(selectedMonth.getFullYear(),selectedMonth.getMonth()+1,1);if(candidate<=new Date(new Date().getFullYear(),new Date().getMonth(),1)){selectedMonth=candidate;loadMonth();}});
if(citySearch)citySearch.addEventListener("input",renderRecent);
if(chartCity)chartCity.addEventListener("change",renderMonthTable);
if(historyDate)historyDate.addEventListener("change",()=>{if(historyDate.value){const chosen=new Date(historyDate.value+"T00:00:00");selectedMonth=new Date(chosen.getFullYear(),chosen.getMonth(),1);loadMonth();}else{renderMonthTable();}});
if(clearDate)clearDate.addEventListener("click",()=>{if(historyDate)historyDate.value="";renderMonthTable();});

loadMonth();
loadResults();
setInterval(renderRecent,30000);
setInterval(checkForNewResults,60000);

 
// Persistent dark/light theme toggle.
const themeToggleButton=document.getElementById("themeToggle");
const themeToggleLabel=document.getElementById("themeToggleLabel");
function applyTheme(theme){const light=theme==="light";document.body.classList.toggle("theme-light",light);if(themeToggleLabel)themeToggleLabel.textContent=light?"डार्क मोड चालू करें":"लाइट मोड चालू करें";if(themeToggleButton)themeToggleButton.setAttribute("aria-pressed",String(light));try{localStorage.setItem("rkbhai-theme",light?"light":"dark");}catch(error){}}
let savedTheme="dark";try{savedTheme=localStorage.getItem("rkbhai-theme")||"dark";}catch(error){}applyTheme(savedTheme);
if(themeToggleButton)themeToggleButton.addEventListener("click",()=>applyTheme(document.body.classList.contains("theme-light")?"dark":"light"));

// Public announcement banner managed from the admin dashboard.
(async()=>{const box=document.getElementById("siteAnnouncement");if(!box)return;try{const response=await fetch("https://rk-bhai-results-portal.onrender.com/api/public/announcement",{cache:"no-store"});if(!response.ok)return;const notice=await response.json();if(!notice.enabled||!notice.message)return;const title=document.getElementById("announcementTitle"),message=document.getElementById("announcementMessage");if(title){title.textContent=notice.title||"महत्वपूर्ण सूचना";title.hidden=!notice.title;}if(message)message.textContent=notice.message;box.hidden=false;}catch(error){console.info("Announcement is currently unavailable",error);}})();

// Installable app, native share, QR code and print-to-PDF tools.
let deferredInstallPrompt = null;
const installButton = document.getElementById("installApp");
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (installButton) installButton.hidden = false;
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  if (installButton) installButton.hidden = true;
});
if (installButton) installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) {
    alert("Browser menu (⋮) खोलें और 'Add to Home screen' या 'Install app' चुनें।");
    return;
  }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.hidden = true;
});
const shareButton = document.getElementById("shareSite");
if (shareButton) shareButton.addEventListener("click", async () => {
  const shareData = { title: "Satta King 👑 Results & Historical Archive", text: "Satta King Portal देखें", url: location.origin };
  try {
    if (navigator.share) await navigator.share(shareData);
    else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(location.origin); alert("Website link copy हो गया।"); }
    else prompt("Website link copy करें:", location.origin);
  } catch (error) { if (error.name !== "AbortError") alert("Share नहीं हो पाया। Link: " + location.origin); }
});
const qrDialog = document.getElementById("qrDialog");
const qrImage = document.getElementById("qrImage");
const qrOpen = document.getElementById("qrOpen");
const showQrButton = document.getElementById("showQr");
const closeQrButton = document.getElementById("closeQr");
if (showQrButton && qrDialog && qrImage && qrOpen) showQrButton.addEventListener("click", () => {
  const target = location.origin + "/";
  const imageUrl = "https://api.qrserver.com/v1/create-qr-code/?size=280x280&format=png&data=" + encodeURIComponent(target);
  qrImage.src = imageUrl;
  qrOpen.href = imageUrl;
  qrDialog.hidden = false;
});
if (closeQrButton && qrDialog) closeQrButton.addEventListener("click", () => { qrDialog.hidden = true; });
if (qrDialog) qrDialog.addEventListener("click", event => { if (event.target === qrDialog) qrDialog.hidden = true; });
const printButton = document.getElementById("printArchive");
if (printButton) printButton.addEventListener("click", () => window.print());
if ("serviceWorker" in navigator) window.addEventListener("load", () => {
  navigator.serviceWorker.register("./sw.js").catch(error => console.warn("App offline setup unavailable:", error));
});


// Header three-dot button opens a full-height side drawer.
const moreToolsButton = document.getElementById("moreToolsButton");
const moreToolsBackdrop = document.getElementById("moreToolsBackdrop");
const moreToolsMenu = document.getElementById("moreToolsMenu");
const closeMoreToolsButton = document.getElementById("closeMoreTools");
if (moreToolsButton && moreToolsBackdrop && moreToolsMenu) {
  const closeMoreTools = () => {
    moreToolsBackdrop.hidden = true;
    moreToolsMenu.hidden = true;
    moreToolsButton.setAttribute("aria-expanded", "false");
  };
  const openMoreTools = () => {
    moreToolsBackdrop.hidden = false;
    moreToolsMenu.hidden = false;
    moreToolsButton.setAttribute("aria-expanded", "true");
  };
  moreToolsButton.addEventListener("click", openMoreTools);
  if (closeMoreToolsButton) closeMoreToolsButton.addEventListener("click", closeMoreTools);
  moreToolsBackdrop.addEventListener("click", event => {
    if (event.target === moreToolsBackdrop) closeMoreTools();
  });
  moreToolsMenu.addEventListener("click", event => {
    if (event.target.closest("a, button") && event.target.id !== "installApp") closeMoreTools();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeMoreTools();
  });
}


// Mobile bottom navigation shortcuts and active-section indicator.
const mobileMenuButton = document.getElementById("mobileMenuButton");
if (mobileMenuButton && moreToolsButton) {
  mobileMenuButton.addEventListener("click", () => moreToolsButton.click());
}
const mobileNavItems = [...document.querySelectorAll("[data-mobile-nav]")];
const setMobileNavActive = key => mobileNavItems.forEach(item => {
  const active = item.dataset.mobileNav === key;
  item.classList.toggle("is-active", active);
  if (active) item.setAttribute("aria-current", "page");
  else item.removeAttribute("aria-current");
});
mobileNavItems.forEach(item => item.addEventListener("click", () => {
  if (item.dataset.mobileNav) setMobileNavActive(item.dataset.mobileNav);
}));
if ("IntersectionObserver" in window && mobileNavItems.length) {
  const mobileNavObserver = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a,b) => b.intersectionRatio-a.intersectionRatio)[0];
    if (!visible) return;
    const key = visible.target.id === "archive" ? "archive" :
      (visible.target.id === "resultsHeading" || visible.target.id === "results" ? "results" : "home");
    setMobileNavActive(key);
  }, {rootMargin:"-18% 0px -62% 0px",threshold:[0,.15,.35,.6]});
  ["top","resultsHeading","archive"].forEach(id => {
    const target=document.getElementById(id);
    if(target) mobileNavObserver.observe(target);
  });
}

(async()=>{const box=document.getElementById("publicPoster");if(!box)return;try{const r=await fetch("/api/public/poster",{cache:"no-store"});if(!r.ok)return;const p=await r.json();if(!p.enabled||!p.description)return;box.innerHTML='<article class="public-text-ad-card">'+(p.heading?'<h2>'+escapeHtml(p.heading)+'</h2>':'')+'<p>'+escapeHtml(p.description).replace(/\n/g,"<br>")+'</p>'+(p.buttonUrl?'<a class="public-text-ad-button" href="'+escapeHtml(p.buttonUrl)+'" target="_blank" rel="noopener">'+escapeHtml(p.buttonText||"Open Link")+'</a>':'')+'</article>';box.hidden=false;}catch(e){console.info("Public text ad not available",e);}})();


// Admin-managed promotional popup: shown only at the configured interval.
(async()=>{const dialog=document.getElementById("popupAdDialog"),content=document.getElementById("popupAdContent"),close=document.getElementById("popupAdClose");if(!dialog||!content||!close)return;const key="sattaKingPopupAdLastShown";close.addEventListener("click",()=>{dialog.hidden=true;});dialog.addEventListener("click",e=>{if(e.target===dialog)dialog.hidden=true;});try{const response=await fetch("https://rk-bhai-results-portal.onrender.com/api/public/popup-ad",{cache:"no-store"});if(!response.ok)return;const ad=await response.json();if(!ad.enabled||!ad.imageData)return;const safeUrl=ad.buttonUrl&&/^https:\/\//i.test(ad.buttonUrl)?ad.buttonUrl:"";content.innerHTML='<h2>'+escapeHtml(ad.title||"विशेष विज्ञापन")+'</h2><img class="popup-ad-image" src="'+ad.imageData+'" alt="विज्ञापन">'+(ad.description?'<p>'+escapeHtml(ad.description)+'</p>':'')+(safeUrl?'<a class="popup-ad-button" href="'+escapeHtml(safeUrl)+'" target="_blank" rel="noopener">'+escapeHtml(ad.buttonText||"अभी देखें")+'</a>':'');dialog.hidden=false;}catch(error){console.info("Popup ad unavailable",error);}})();
