const host=document.getElementById("results");
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

async function getJson(url){
  try{
    const response=await fetch(url);
    if(!response.ok) throw new Error("Request failed");
    return await response.json();
  }catch(error){
    // Public pages can fall back to the last GitHub snapshot while the free Render API sleeps.
    if(!url.startsWith("/api/results")&&!url.startsWith("/api/public/cities"))throw error;
    const snapshotUrl="https://raw.githubusercontent.com/jasmelsolanki2017-svg/rk-bhai-results-portal-/main/data/public-results.json?ts="+Date.now();
    const response=await fetch(snapshotUrl,{cache:"no-store"});
    if(!response.ok)throw error;
    const snapshot=await response.json();
    if(url.startsWith("/api/public/cities"))return snapshot.cities||[];
    const params=new URLSearchParams(url.split("?")[1]||"");
    let rows=Array.isArray(snapshot.results)?snapshot.results:[];
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
  }
}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function dateKey(value){return new Date(value).toISOString().slice(0,10);}
function formatUpdate(value){
  if(!value)return "";
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return "";
  return date.toLocaleString("hi-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:true});
}
function renderRecent(){
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
  const query=(citySearch.value||"").trim().toLocaleLowerCase("hi");
  const entries=[...byCity.entries()].filter(([city])=>city.toLocaleLowerCase("hi").includes(query)).sort((a,b)=>a[0].localeCompare(b[0],"hi"));
  if(!entries.length){host.innerHTML='<p class="muted">इस खोज से कोई शहर नहीं मिला।</p>';return;}
  const yesterdayLabel=new Date(todayStart.getTime()-86400000).toLocaleDateString("hi-IN",{day:"2-digit",month:"short"});
  const todayLabel=todayStart.toLocaleDateString("hi-IN",{day:"2-digit",month:"short"});
  const cell=(row,isToday=false)=>{if(!row)return isToday?'<span class="wait-badge">WAIT</span>':'<span class="no-result">XX</span>';const addedAt=new Date(row.createdAt||0).getTime();const age=Date.now()-addedAt;const isNew=Number.isFinite(addedAt)&&addedAt>0&&age>=0&&age<2*60*60*1000;return '<span'+(isNew?' class="result-blink"':'')+'>'+escapeHtml(row.resultText)+'</span>'+(isNew?' <span class="new-result-badge">NEW</span>':'');};
  host.innerHTML='<div class="recent-results-wrap"><table class="recent-results-table"><thead><tr><th>शहर / मार्केट</th><th>कल ('+yesterdayLabel+')</th><th>आज ('+todayLabel+')</th></tr></thead><tbody>'+
    entries.map(([city,result])=>'<tr><th>'+escapeHtml(city)+'</th><td>'+cell(result.yesterday)+'</td><td>'+cell(result.today,true)+'</td></tr>').join("")+
    '</tbody></table></div>';
}
async function loadResults(){
  try{
    const [rows,cities]=await Promise.all([getJson("/api/results?recent=2"),getJson("/api/public/cities")]);
    recentRows=rows;recentCities=cities;renderRecent();
  }catch(e){host.innerHTML='<p class="muted">अभी परिणाम लोड नहीं हो पाए। कृपया बाद में प्रयास करें।</p>';}
}
function monthKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;}
function populateCityFilter(cities,rows){
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
  if(chartCity.value){titles=titles.filter(t=>t===chartCity.value);rows=rows.filter(r=>r.title===chartCity.value);}
  titles.sort((a,b)=>{const ac=/chandigarh/i.test(a),bc=/chandigarh/i.test(b);return ac!==bc?(ac?1:-1):a.localeCompare(b,"hi");});
  if(!titles.length){chartHost.innerHTML='<p class="muted empty-month">इस महीने के लिए कोई प्रकाशित रिकॉर्ड या approved city नहीं मिला।</p>';return;}
  const byDay=new Map();
  rows.forEach(row=>{
    const day=new Date(row.resultDate).getUTCDate();
    if(!byDay.has(day))byDay.set(day,{});
    byDay.get(day)[row.title]=row;
  });
  const daysInMonth=new Date(selectedMonth.getFullYear(),selectedMonth.getMonth()+1,0).getDate();
  const chosenDate=historyDate.value;
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
citySearch.addEventListener("input",renderRecent);
chartCity.addEventListener("change",renderMonthTable);
historyDate.addEventListener("change",()=>{if(historyDate.value){const chosen=new Date(historyDate.value+"T00:00:00");selectedMonth=new Date(chosen.getFullYear(),chosen.getMonth(),1);loadMonth();}else{renderMonthTable();}});
clearDate.addEventListener("click",()=>{historyDate.value="";renderMonthTable();});

loadMonth();
loadResults();
setInterval(renderRecent,30000);

 
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
  const shareData = { title: "RK Bhai Results & Historical Archive", text: "RK Bhai Portal देखें", url: location.origin };
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
  navigator.serviceWorker.register("/sw.js").catch(error => console.warn("App offline setup unavailable:", error));
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
