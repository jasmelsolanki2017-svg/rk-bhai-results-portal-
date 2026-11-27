function safeAdDesign(d={}){const c=(v,f)=>/^#[0-9a-f]{6}$/i.test(String(v||""))?v:f;return {bg:c(d.backgroundColor,"#20170d"),text:c(d.textColor,"#f4ead5"),border:c(d.borderColor,"#d6ad55"),button:c(d.buttonColor,"#18c76b"),buttonText:c(d.buttonTextColor,"#07150d"),radius:[8,14,22].includes(Number(d.radius))?Number(d.radius):14,size:[14,16,19,22].includes(Number(d.fontSize))?Number(d.fontSize):16,align:["left","center","right"].includes(d.alignment)?d.alignment:"center"};}function adDesignStyle(d){const x=safeAdDesign(d);return ` style="--ad-bg:${x.bg};--ad-text:${x.text};--ad-border:${x.border};--ad-button:${x.button};--ad-button-text:${x.buttonText};--ad-radius:${x.radius}px;--ad-size:${x.size}px;--ad-align:${x.align}"`;}
const host=document.getElementById("results");
let lastRobotMarketName=null;
let robotMatkaBreakUntil=0;
let robotMatkaCompletedName="";
const nextRobotArea=document.getElementById("nextResultHighlight");
if(nextRobotArea){
  let robotActionTimer=null;
  let robotActionStep=0;
  nextRobotArea.addEventListener("click",event=>{
    const robot=event.target.closest(".robot-mascot");
    if(!robot)return;
    event.preventDefault();
    robot.classList.remove("robot-action-wave","robot-action-dance","robot-action-spin");
    robotActionStep=(robotActionStep%3)+1;
    const action=["robot-action-wave","robot-action-dance","robot-action-spin"][robotActionStep-1];
    void robot.offsetWidth;
    robot.classList.add(action);
    clearTimeout(robotActionTimer);
    robotActionTimer=setTimeout(()=>robot.classList.remove(action),2200);
  });
  nextRobotArea.addEventListener("keydown",event=>{
    if((event.key==="Enter"||event.key===" ")&&event.target.matches(".robot-mascot")){
      event.preventDefault();event.target.click();
    }
  });
}
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
  const indiaDateKey=value=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value));
  const normalizeMarketName=value=>String(value||"").trim().toLocaleLowerCase("en").replace(/\s+city$/i,"").replace(/\s+/g," ");
  const todayKey=indiaDateKey(new Date());
  const todayStart=new Date(todayKey+"T00:00:00.000Z");
  const yesterdayKey=indiaDateKey(todayStart.getTime()-86400000);
  const byCity=new Map();
  const cityLabels=new Map();
  recentCities.forEach(city=>{
    const key=normalizeMarketName(city.cityName);
    if(!key)return;
    if(!byCity.has(key))byCity.set(key,{today:null,yesterday:null});
    if(!cityLabels.has(key)||/\bcity$/i.test(String(cityLabels.get(key))))cityLabels.set(key,String(city.cityName||"").replace(/\s+city$/i,"").trim());
  });
  if(byCity.has("chandigarh"))cityLabels.set("chandigarh","Chandigarh City");
  recentRows.forEach(row=>{
    const key=normalizeMarketName(row.title);
    if(!key)return;
    if(!byCity.has(key))byCity.set(key,{today:null,yesterday:null});
    if(!cityLabels.has(key))cityLabels.set(key,String(row.title||"").replace(/\s+city$/i,"").trim());
    const item=byCity.get(key);
    const dayKey=indiaDateKey(row.resultDate);
    if(dayKey===todayKey)item.today=row;
    if(dayKey===yesterdayKey)item.yesterday=row;
  });
  if(byCity.has("chandigarh"))cityLabels.set("chandigarh","Chandigarh City");
  const todayStat=document.getElementById("statToday");
  if(todayStat)todayStat.textContent=recentRows.filter(r=>dateKey(r.resultDate)===todayKey).length;
  const query=(citySearch?.value||"").trim().toLocaleLowerCase("hi");
  const fixedTimes={"disawar":"05:00 AM","desawar":"05:00 AM","faridabad":"06:20 PM","ghaziabad":"10:05 PM","gali":"12:05 AM","delhi bazar":"03:15 PM","shri ganesh":"04:45 PM","shree ganesh":"04:45 PM","chandigarh":"08:30 PM"};
  const getCityTime=city=>{
    const cityKey=normalizeMarketName(city);
    if(cityKey==="chandigarh")return "08:30 PM";
    const info=recentCities.find(item=>item.cityName===city)||{};
    return info.expectedTime||info.resultTime||info.time||fixedTimes[cityKey]||"";
  };
  const nowParts=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Kolkata",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date()).split(":").map(Number);
  const nowMinutes=nowParts[0]*60+nowParts[1];
  const entries=[...byCity.entries()].map(([key,result])=>[cityLabels.get(key)||key,result]).filter(([city])=>city.toLocaleLowerCase("hi").includes(query)).sort((a,b)=>{
    const aPublished=!!a[1].today,bPublished=!!b[1].today;
    if(aPublished!==bPublished)return aPublished?-1:1;
    const latestTime=item=>Math.max(...[item[1].today,item[1].yesterday].filter(Boolean).map(row=>new Date(row.createdAt||row.updatedAt||row.resultDate||0).getTime()),0);
    if(aPublished&&bPublished)return latestTime(b)-latestTime(a);
    const toMinutes=city=>{
      const match=String(getCityTime(city)).match(/(\\d{1,2}):(\\d{2})\\s*(AM|PM)/i);
      if(!match)return 9999;
      let hour=Number(match[1])%12;
      if(match[3].toUpperCase()==="PM")hour+=12;
      return hour*60+Number(match[2]);
    };
    const delta=city=>{
      const minutes=toMinutes(city);
      if(minutes===9999)return 9999;
      let value=minutes-nowMinutes;
      if(value < -720)value+=1440;
      return value;
    };
    return delta(a[0])-delta(b[0]);
  });
  if(!entries.length){if(topResultCards)topResultCards.innerHTML='<p class="muted">अभी कोई प्रकाशित रिजल्ट नहीं है।</p>';return;}
  const yesterdayLabel=new Date(todayStart.getTime()-86400000).toLocaleDateString("hi-IN",{day:"2-digit",month:"short"});
  const todayLabel=todayStart.toLocaleDateString("hi-IN",{day:"2-digit",month:"short"});
  const newestResult=[...recentRows].sort((a,b)=>new Date(b.createdAt||b.updatedAt||b.resultDate||0).getTime()-new Date(a.createdAt||a.updatedAt||a.resultDate||0).getTime())[0];
  const newestResultKey=newestResult?resultKey(newestResult):null;
  const cell=(row,isToday=false)=>{if(!row)return isToday?'<span class="wait-badge">WAIT</span>':'<span class="no-result">XX</span>';return '<span'+(isToday?' class="result-blink"':'')+'>'+escapeHtml(row.resultText)+'</span>'+(isToday?' <span class="new-result-badge">NEW</span>':'');};
  const nextResultHighlight=document.getElementById("nextResultHighlight");
  const parseCityMinutes=value=>{
    const match=String(value||"").match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if(!match)return null;
    let hour=Number(match[1])%12;
    if(match[3].toUpperCase()==="PM")hour+=12;
    return hour*60+Number(match[2]);
  };
  const upcomingEntries=[...entries];
  if(!upcomingEntries.some(([city])=>normalizeMarketName(city)==="chandigarh")){
    upcomingEntries.push(["Chandigarh City",{today:null,yesterday:null}]);
  }
  const upcomingCandidates=upcomingEntries
    .filter(([city,result])=>{const isGali=normalizeMarketName(city)==="gali";const galiArrived=isGali&&nowParts[0]<12&&!!result.yesterday;return !result.today&&!galiArrived&&parseCityMinutes(getCityTime(city))!==null;})
    .map(([city,result])=>{
      const minutes=parseCityMinutes(getCityTime(city));
      let delta=minutes-nowMinutes;
      if(delta < -720)delta+=1440;
      return {city,result,time:getCityTime(city),minutes,delta,due:delta<=0};
    })
    .sort((a,b)=>{
      if(a.due!==b.due)return a.due?-1:1;
      if(a.due&&b.due)return b.delta-a.delta;
      return a.delta-b.delta;
    });
  const nextMarket=upcomingCandidates[0]||null;
  if(lastRobotMarketName){
    const completedEntry=[...byCity.entries()].find(([key])=>key===normalizeMarketName(lastRobotMarketName));
    if(completedEntry&&completedEntry[1].today&&!robotMatkaBreakUntil){
      robotMatkaCompletedName=lastRobotMarketName;
      robotMatkaBreakUntil=Date.now()+4500;
    }
  }
  const showBrokenMatka=Date.now()<robotMatkaBreakUntil;
  const todayPublished=[...recentRows]
    .filter(row=>indiaDateKey(row.resultDate)===todayKey)
    .sort((x,y)=>new Date(y.createdAt||y.updatedAt||y.resultDate||0)-new Date(x.createdAt||x.updatedAt||x.resultDate||0));
  const latestPublished=todayPublished[0]||null;
  let publishedSince=0;
  if(latestPublished){
    const storedKey="sattaking-published-seen-"+resultKey(latestPublished);
    const sourceTime=new Date(latestPublished.createdAt||latestPublished.updatedAt||0).getTime();
    try{
      const saved=Number(localStorage.getItem(storedKey)||0);
      publishedSince=sourceTime>0?sourceTime:(saved||Date.now());
      if(!saved)localStorage.setItem(storedKey,String(publishedSince));
    }catch(_){publishedSince=sourceTime>0?sourceTime:Date.now();}
  }
  const showPublishedResult=!!latestPublished&&Date.now()-publishedSince<30*60*1000;
  const sceneMarket=showBrokenMatka?{city:robotMatkaCompletedName,time:getCityTime(robotMatkaCompletedName)}:nextMarket;
  if(nextMarket&&!showBrokenMatka)lastRobotMarketName=nextMarket.city;
  if(!showBrokenMatka&&robotMatkaBreakUntil&&Date.now()>=robotMatkaBreakUntil){robotMatkaBreakUntil=0;robotMatkaCompletedName="";}
  if(nextResultHighlight){
    nextResultHighlight.innerHTML=showPublishedResult
      ?'<div class="next-market-card published-result-highlight"><div class="next-market-kicker"><span class="next-market-pulse"></span> नया रिजल्ट प्रकाशित</div><div class="next-market-main"><div><h3>'+escapeHtml(latestPublished.title||"आज का रिजल्ट")+'</h3><p>रोबोट ने मटका फोड़कर रिजल्ट निकाला!</p></div><div class="next-market-time published-result-number">'+escapeHtml(latestPublished.resultText||"—")+'</div></div><div class="next-market-robot robot-scene matka-result-broken happy-robot-scene" aria-label="खुश रोबोट टूटा मटका और निकला हुआ रिजल्ट"><span class="robot-mascot"><span class="robot-antenna"></span><span class="robot-head"><i></i><b></b><em></em></span><span class="robot-neck"></span><span class="robot-body"><i></i></span><span class="robot-arm robot-arm-left"></span><span class="robot-arm robot-arm-right"></span><span class="robot-leg robot-leg-left"></span><span class="robot-leg robot-leg-right"></span></span><span class="result-matka" aria-hidden="true"></span><span class="matka-shards" aria-hidden="true"><i></i><b></b><em></em></span><span class="result-from-matka">'+escapeHtml(latestPublished.resultText||"—")+'</span><span class="robot-happy">☺</span></div></div>'
      :sceneMarket
        ?'<div class="next-market-card"><div class="next-market-kicker"><span class="next-market-pulse"></span> अगला आने वाला रिजल्ट</div><div class="next-market-main"><div><h3>'+escapeHtml(sceneMarket.city)+'</h3><p>आज का रिजल्ट आने वाला है</p></div><div class="next-market-time">'+escapeHtml(sceneMarket.time)+'</div></div><div class="next-market-robot robot-scene" aria-label="Robot walks to the matka and returns"><span class="robot-mascot" role="button" tabindex="0" aria-label="रोबोट को छूकर मज़ेदार हरकतें देखें"><span class="robot-antenna"></span><span class="robot-head"><i></i><b></b><em></em></span><span class="robot-neck"></span><span class="robot-body"><i></i></span><span class="robot-arm robot-arm-left"></span><span class="robot-arm robot-arm-right"></span><span class="robot-leg robot-leg-left"></span><span class="robot-leg robot-leg-right"></span></span><span class="result-matka" aria-hidden="true"><svg class="matka-pot" viewBox="0 0 90 100" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="potClay" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6c77d"/><stop offset=".28" stop-color="#d88b42"/><stop offset=".62" stop-color="#a65328"/><stop offset="1" stop-color="#632d19"/></linearGradient><linearGradient id="potNeck" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#71351d"/><stop offset=".45" stop-color="#e6a65d"/><stop offset="1" stop-color="#71351d"/></linearGradient></defs><ellipse cx="45" cy="92" rx="29" ry="5" fill="#000" opacity=".25"/><path d="M34 15 L34 26 C34 31 20 35 14 47 C5 65 15 86 29 90 Q45 96 61 90 C75 86 85 65 76 47 C70 35 56 31 56 26 L56 15 Z" fill="url(#potClay)" stroke="#6c351d" stroke-width="2"/><path d="M34 17 L34 27 Q45 31 56 27 L56 17 Z" fill="url(#potNeck)" stroke="#71351d" stroke-width="1.5"/><path d="M31 14 Q45 10 59 14 L59 19 Q45 23 31 19 Z" fill="#e8b66e" stroke="#73381e" stroke-width="2"/><ellipse cx="45" cy="14" rx="14" ry="4" fill="#5b2b19" stroke="#f2c77e" stroke-width="2"/><path d="M14 53 Q45 61 76 53 M12 61 Q45 69 78 61" fill="none" stroke="#f4c47a" stroke-width="2" opacity=".85"/><path d="M21 43 Q45 50 69 43" fill="none" stroke="#743719" stroke-width="2" opacity=".7"/><path d="M25 71 Q45 78 65 71" fill="none" stroke="#f4c47a" stroke-width="2" opacity=".7"/><path d="M25 42 Q18 60 27 78" fill="none" stroke="#ffe0a5" stroke-width="5" stroke-linecap="round" opacity=".28"/><path d="M45 46 l4 5 -4 5 -4 -5 Z" fill="#f6d59b" opacity=".85"/><circle cx="45" cy="62" r="3" fill="#713719" opacity=".8"/></svg></span><span class="matka-shards" aria-hidden="true"><i></i><b></b><em></em></span></div><div class="next-market-foot">रिजल्ट प्रकाशित होते ही मटका टूटेगा</div></div>'
        :'<div class="next-market-empty">अभी अगला रिजल्ट समय उपलब्ध नहीं है।</div>';
  }
  if(topResultCards){
    topResultCards.innerHTML=entries.map(([city,result])=>{
      const cityInfo=recentCities.find(item=>item.cityName===city)||{};
      const time=getCityTime(city);
      const isGali=String(city).trim().toLocaleLowerCase("en")==="gali";
      const indiaHour=Number(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Kolkata",hour:"2-digit",hourCycle:"h23"}).format(new Date()));
      const galiBlinkWindow=isGali&&indiaHour<12;
      const galiCarry=galiBlinkWindow&&!result.today&&!!result.yesterday;
      const currentRow=isGali
        ?(galiBlinkWindow?(result.today||(galiCarry?result.yesterday:null)):(result.today||result.yesterday))
        :result.today;
      const previousRow=isGali&&!galiBlinkWindow&&!result.today?null:result.yesterday;
      const shouldBlink=isGali?!!currentRow&&(galiBlinkWindow||!!result.today):!!result.today;
      const previousDisplayRow=isGali?(currentRow||previousRow):previousRow;
      const previous=previousDisplayRow?escapeHtml(previousDisplayRow.resultText):"XX";
      const current=isGali?"-":(currentRow?escapeHtml(currentRow.resultText):"—");
      const blinkLeft=isGali&&shouldBlink&&!!previousDisplayRow;
      const blinkRight=!isGali&&shouldBlink;
      const upcoming=!result.today&&!!time;
      const nextCard=false;
      const galiResultArrived=isGali&&galiBlinkWindow&&!!result.yesterday;
      const statusText=result.today?"आज का रिजल्ट आ गया":(galiCarry?"पिछली तारीख का रिजल्ट":(nextCard?"अगला रिजल्ट":"रिजल्ट का इंतज़ार है"));
      return '<article class="top-result-card'+(nextCard?' next-result-card':'')+'"><div class="result-card-topline"><span class="result-card-status'+(result.today?' is-published':'')+'">'+(nextCard?'⌛ अगला रिजल्ट':statusText)+'</span>'+(nextCard?'<span class="next-result-tag">NEXT</span>':'')+'</div><h3>'+escapeHtml(city)+'</h3><p class="top-result-time">'+(time?'( '+escapeHtml(time)+' )':'&nbsp;')+'</p><div class="top-result-values"><span class="top-previous-wrap">'+(blinkLeft?'<span class="new-result-badge">NEW</span>':'')+'<span class="top-previous'+(blinkLeft?' result-blink':'')+'">'+previous+'</span></span><span class="top-result-arrow" aria-hidden="true">➡️</span><span class="top-current-wrap">'+(blinkRight?'<span class="new-result-badge">NEW</span>':'')+'<span class="top-current'+(blinkRight?' result-blink':'')+'">'+current+'</span></span></div><div class="top-result-actions"><a class="top-chart-link" href="#archive" data-chart-city="'+escapeHtml(city)+'">चार्ट देखें</a><button type="button" class="top-share-card" data-share-city="'+escapeHtml(city)+'" data-share-value="'+escapeHtml(currentRow?currentRow.resultText:"") +'" data-share-date="'+escapeHtml(currentRow?currentRow.resultDate:"") +'" '+(currentRow?'':'disabled')+'>शेयर कार्ड</button></div></article>';
    }).join("");
  }

}
async function makeResultShareCard(city,value,resultDate){
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
  // Match the exact calendar day used by the chart (UTC date key), for every market including Gali.
  const date=shareDateValue.toLocaleDateString("en-IN",{day:"2-digit",month:"long",year:"numeric",timeZone:"UTC"});
  ctx.fillStyle="#cfc6b5";ctx.font="32px Arial";ctx.fillText(date,540,550);
  ctx.fillStyle="#b88a3b";ctx.font="bold 30px Arial";ctx.fillText("PUBLISHED RESULT",540,680);
  ctx.fillStyle="#f5d78e";ctx.font="bold 190px Arial";ctx.fillText(String(value||"—").slice(0,12),540,890);
  ctx.strokeStyle="#80632d";ctx.beginPath();ctx.moveTo(180,980);ctx.lineTo(900,980);ctx.stroke();
  ctx.fillStyle="#e6bd70";ctx.font="bold 34px Arial";ctx.fillText("CHECK MORE RESULTS & OLD RECORDS",540,1070);
  ctx.fillStyle="#9f8a64";ctx.font="24px Arial";ctx.fillText("THANK YOU FOR YOUR SUPPORT",540,1260);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
  if(!blob)throw new Error("Card image could not be created");
  const file=new File([blob],"satta-king-result.png",{type:"image/png"});
  const shareText="👑 Satta king 👑 RESULTS PORTAL\n"+String(city||"Result")+" : "+String(value||"—")+"\nDate: "+date+"\n\nWebsite: https://jasmelsolanki2017-svg.github.io/rk-bhai-results-portal-/";
  if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){
    await navigator.share({files:[file],title:"👑 Satta king 👑 Result",text:shareText});
  }else{
    const url=URL.createObjectURL(blob);
    const link=document.createElement("a");link.href=url;link.download="satta-king-result.png";link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    alert("रिजल्ट कार्ड डाउनलोड हो गया।");
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
      (visible.target.id === "top-result-section" ? "results" : "home");
    setMobileNavActive(key);
  }, {rootMargin:"-18% 0px -62% 0px",threshold:[0,.15,.35,.6]});
  ["top","top-result-section","archive"].forEach(id => {
    const target=document.getElementById(id);
    if(target) mobileNavObserver.observe(target);
  });
}

(async()=>{const box=document.getElementById("publicPoster");if(!box)return;try{const r=await fetch("https://rk-bhai-results-portal.onrender.com/api/public/poster",{cache:"no-store",mode:"cors",credentials:"omit"});if(!r.ok)return;const p=await r.json();if(!p.enabled||!p.description)return;box.innerHTML='<article class="public-text-ad-card"'+adDesignStyle(p.design)+'>'+(p.heading?'<h2>'+escapeHtml(p.heading)+'</h2>':'')+'<p>'+escapeHtml(p.description).replace(/\n/g,"<br>")+'</p>'+(p.buttonUrl?'<a class="public-text-ad-button" href="'+escapeHtml(p.buttonUrl)+'" target="_blank" rel="noopener">'+escapeHtml(p.buttonText||"Open Link")+'</a>':'')+'</article>';box.hidden=false;}catch(e){console.info("Public text ad not available",e);}})();


// Show separate blinking message ads in a small floating card.
(async()=>{try{const r=await fetch("https://rk-bhai-results-portal.onrender.com/api/public/blink-messages",{cache:"no-store"});if(!r.ok)return;const d=await r.json(),items=Array.isArray(d.messages)?d.messages:[];if(!items.length)return;let last="";try{last=localStorage.getItem("rkBlinkMessageLast")||"";}catch(e){}const prev=items.findIndex(x=>x.id===last),m=items[(prev+1)%items.length];const root=document.createElement("aside");root.className="public-blink-message";const safeLink=typeof m.link==="string"&&/^https:\/\//i.test(m.link)?m.link:"";root.innerHTML=(safeLink?'<a class="public-blink-message-link" href="'+escapeHtml(safeLink)+'" target="_blank" rel="noopener noreferrer">':"")+(m.title?'<strong>'+escapeHtml(m.title)+'</strong>':"")+'<p>'+escapeHtml(m.message).replace(/\n/g,"<br>")+'</p>'+(safeLink?"</a>":"")+'<button type="button" aria-label="बंद करें">×</button>';root.style.setProperty("--blink-bg",/^#[0-9a-f]{6}$/i.test(m.backgroundColor)?m.backgroundColor:"#20170d");root.style.setProperty("--blink-text",/^#[0-9a-f]{6}$/i.test(m.textColor)?m.textColor:"#fff0c2");root.style.setProperty("--blink-border",/^#[0-9a-f]{6}$/i.test(m.borderColor)?m.borderColor:"#d6ad55");root.style.setProperty("--blink-speed",[0.5,0.8,1,1.5,2].includes(Number(m.speed))?Number(m.speed)+"s":"1s");root.querySelector("button").addEventListener("click",()=>root.remove());document.body.appendChild(root);try{localStorage.setItem("rkBlinkMessageLast",m.id);}catch(e){}window.setTimeout(()=>root.remove(),12000);}catch(e){console.info("Blink messages unavailable",e);}})();

function formatPopupAdDescription(value){
 const lines=String(value||"").split("\n").map(x=>x.trim()).filter(Boolean);
 const games=lines.filter(x=>/^[-:]?\s*\d{1,2}:\d{2}\s*[A-Z]{2,4}/i.test(x));
 const other=lines.filter(x=>!games.includes(x));
 const heading=other.filter(x=>/200\s*INTU|MOTI JODI/i.test(x));
 const rate=other.filter(x=>/रेट|जोड़ी|हरूफ/i.test(x));
 const note=other.filter(x=>/नोट|फोल्डर/i.test(x));
 const used=heading.concat(rate,note);
 const intro=other.filter(x=>!used.includes(x));
 const block=(label,items,cls)=>items.length?'<section class="popup-ad-section '+cls+'">'+(label?'<h3>'+label+'</h3>':'')+items.map(x=>'<p>'+escapeHtml(x)+'</p>').join('')+'</section>':'';
 return '<div class="popup-ad-description">'+block('',intro,'popup-ad-intro')+block('✦ GAME TIMINGS ✦',games,'popup-ad-games')+block('',heading,'popup-ad-highlight')+block('',rate,'popup-ad-rate')+block('',note,'popup-ad-note')+'</div>';
}
// Show enabled popup ads in rotation: consecutive visits use the next different ad.
(async()=>{const dialog=document.getElementById("popupAdDialog"),content=document.getElementById("popupAdContent"),close=document.getElementById("popupAdClose");if(!dialog||!content||!close)return;const lastIdKey="sattaKingPopupAdLastId",lastShownKey="sattaKingPopupAdLastShown";close.addEventListener("click",()=>{dialog.hidden=true;});dialog.addEventListener("click",e=>{if(e.target===dialog)dialog.hidden=true;});try{const response=await fetch("https://rk-bhai-results-portal.onrender.com/api/public/popup-ads",{cache:"no-store"});if(!response.ok)return;const data=await response.json();const ads=Array.isArray(data.ads)?data.ads:[];if(!ads.length)return;let lastId="",lastShown=0;try{lastId=localStorage.getItem(lastIdKey)||"";lastShown=Number(localStorage.getItem(lastShownKey)||0);}catch(e){}const previous=ads.findIndex(item=>item.id===lastId);const ad=ads[(previous+1)%ads.length];const minutes=Number(ad.frequencyMinutes??0);if(minutes>0&&lastShown&&Date.now()-lastShown<minutes*60000)return;const safeUrl=ad.buttonUrl&&/^https:\/\//i.test(ad.buttonUrl)?ad.buttonUrl:"";content.innerHTML='<div class="popup-ad-designed"'+adDesignStyle(ad.design)+'><h2>'+escapeHtml(ad.title||"👑 Satta king 👑")+'</h2>'+(ad.imageData?'<img class="popup-ad-image" src="'+ad.imageData+'" alt="विज्ञापन">':'<div class="popup-ad-text-only">👑</div>')+(ad.description?formatPopupAdDescription(String(ad.description).replace(/\s+(?=200 INTU SE MOTI)/gi,"\n\n").replace(/\s+(?=\d{1,2}:\d{2}\s*[A-Z]{2,4})/gi,"\n").replace(/\s+(?=💰?\s*रेट:)/g,"\n\n").replace(/\s+(?=⚠️?\s*नोट:)/g,"\n\n")):'<div class="popup-ad-description"><p>हमारी वेबसाइट पर आपका स्वागत है। नवीनतम रिजल्ट और अपडेट देखें।</p></div>')+(safeUrl?'<a class="popup-ad-button" href="'+escapeHtml(safeUrl)+'" target="_blank" rel="noopener">'+escapeHtml(ad.buttonText||"अभी देखें")+'</a>':"" )+'</div>';const delay=Math.max(0,Number(ad.delaySeconds)||0)*1000;window.setTimeout(()=>{dialog.hidden=false;try{localStorage.setItem(lastIdKey,ad.id);localStorage.setItem(lastShownKey,String(Date.now()));}catch(e){}window.setTimeout(()=>{dialog.hidden=true;},10000);},delay);}catch(error){console.info("Popup ads unavailable",error);}})();
