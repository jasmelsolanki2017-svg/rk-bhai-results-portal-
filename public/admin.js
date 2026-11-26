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
 const ads=view==="ads",sync=view==="sync";
 const dashboard=$("#adminMainView");
 const adWorkspace=$("#adManagementView");
 const syncWorkspace=$("#autoSyncManagementView");
 const shortcuts=document.querySelector(".pro-shortcuts");
 dashboard.hidden=ads||sync;
 adWorkspace.hidden=!ads;
 syncWorkspace.hidden=!sync;
 dashboard.style.display=(ads||sync)?"none":"block";
 adWorkspace.style.display=ads?"block":"none";
 syncWorkspace.style.display=sync?"block":"none";
 if(shortcuts)shortcuts.hidden=ads||sync;
 if(ads||sync) window.scrollTo({top:0,behavior:"smooth"});
}
function applyAdminRoute(){
 const isAds=location.pathname==="/admin/advertisements"||location.pathname==="/admin/advertisements/";
 const isSync=new URLSearchParams(location.search).get("section")==="automatic-sync";
 showAdminView(isAds?"ads":isSync?"sync":"main");
 if(isSync){loadAutoSyncStatus();return;}
 if(!isAds)return;
 const section=new URLSearchParams(location.search).get("section")||"home";
 const map={popup:"popupAdManager",blink:"blinkMessageManager",text:"posterManager",notice:"announcementManager"};
 const ids=["announcementManager","popupAdManager","blinkMessageManager","posterManager"];
 ids.forEach(id=>{const el=document.getElementById(id);if(el)el.hidden=section!=="home"&&map[section]!==id;});
 const home=document.getElementById("adManagerHome"),back=document.getElementById("adManagerBack");
 if(home)home.hidden=section!=="home";
 if(back)back.hidden=section==="home";
 const heading=document.querySelector(".admin-ad-view-head h2");
 if(heading)heading.textContent=section==="home"?"Advertisement Management":({popup:"Popup Advertisement",blink:"Blinking Message Ad",text:"Text Advertisement",notice:"Maintenance / Announcement"}[section]||"Advertisement Management");
}

function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function dateValue(v){return new Date(v).toISOString().slice(0,10);}
function monthKey(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");}


function buildSourceCityChart(diagnostics){
 const markets=["Disawar","Faridabad","Ghaziabad","Gali","Delhi Bazar","Shree Ganesh"];
 const hostOf=value=>{try{const host=new URL(value).hostname;return host.toLowerCase().startsWith("www.")?host.slice(4):host;}catch{const host=String(value||"").split("://").pop().split("/")[0];return host.toLowerCase().startsWith("www.")?host.slice(4):host;}};
 const sources=[...new Set(diagnostics.map(item=>hostOf(item.url)).filter(Boolean))];
 if(!sources.length)return '<p class="muted">अभी किसी वेबसाइट की जाँच उपलब्ध नहीं है।</p>';
 const headers=sources.map(host=>'<th style="min-width:110px;padding:8px;border:1px solid var(--border,#444);overflow-wrap:anywhere">'+esc(host)+'</th>').join("");
 const rows=markets.map(market=>{
  const cells=sources.map(host=>{
   const matches=diagnostics.filter(item=>hostOf(item.url)===host);
   const values=[];
   matches.forEach(item=>{
    const sourceValues=item.marketValues||item.marketResults||{};
    const key=Object.keys(sourceValues).find(k=>String(k).trim().toLowerCase()===market.toLowerCase());
    if(key!==undefined){
     const value=String(sourceValues[key]).trim();
     if(value&&!values.includes(value))values.push(value);
    }
   });
   const detail=matches.map(item=>(item.pass||"जाँच")+": "+(item.result||"स्थिति उपलब्ध नहीं")+(item.status?" (HTTP "+item.status+")":"")).join("\n");
   const value=values.length?values.join(" / "):"—";
   return '<td title="'+esc(detail)+'" style="min-width:90px;text-align:center;padding:8px;border:1px solid var(--border,#444);font-weight:700;'+(values.length?'color:#35c979;':'color:var(--muted,#999);')+'">'+esc(value)+'</td>';
  }).join("");
  return '<tr><th scope="row" style="position:sticky;left:0;background:var(--card,#171717);text-align:left;padding:8px;border:1px solid var(--border,#444);white-space:nowrap">'+esc(market)+'</th>'+cells+'</tr>';
 }).join("");
 return '<div style="margin:12px 0 16px"><h3 style="margin:0 0 6px;font-size:15px">Source-wise City Result Chart</h3><p class="muted" style="font-size:12px;margin:0 0 8px">हर वेबसाइट से आज किस मार्केट का नंबर मिला। — का मतलब उस जाँच में नंबर नहीं मिला।</p><div style="overflow-x:auto"><table style="border-collapse:collapse;width:max-content;min-width:100%;font-size:12px"><thead><tr><th style="position:sticky;left:0;background:var(--card,#171717);padding:8px;border:1px solid var(--border,#444);text-align:left">मार्केट</th>'+headers+'</tr></thead><tbody>'+rows+'</tbody></table></div></div>';
}

async function loadAutoSyncStatus(){
 const box=$("#autoSyncStatus");if(!box)return;
 box.textContent="Sync status लोड हो रहा है…";
 try{
  const url="https://raw.githubusercontent.com/jasmelsolanki2017-svg/rk-bhai-results-portal-/public-data/data/auto-sync-status.json?ts="+Date.now();
  const response=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error("Status उपलब्ध नहीं ("+response.status+")");
  const data=await response.json();
  const labels={success:"सफल",failed:"फेल",running:"चल रहा है",skipped:"आज का रिजल्ट नहीं मिला"};
  const color=data.status==="success"?"#35c979":data.status==="failed"?"#ff6b6b":data.status==="running"?"#e7b84c":"#9ca3af";
  const when=data.checkedAt?new Date(data.checkedAt).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Kolkata"}):"समय उपलब्ध नहीं";
  const diagnostics=Array.isArray(data.sourceDiagnostics)?data.sourceDiagnostics:[];
  const passNames={first_check:"पहली जाँच",recheck:"दोबारा जाँच"};
  const resultNames={dated_values_found:"आज के रिजल्ट मिले",no_values:"रिजल्ट नहीं मिले",date_not_recognized:"तारीख नहीं पहचानी",stale_date:"पुरानी तारीख",stale_last_modified:"पुराना अपडेट",fetch_failed:"HTTP त्रुटि",request_error:"Request फेल",same_day_conflict:"आज के रिकॉर्ड से अंतर"};
  const marketColumns=["Disawar","Faridabad","Ghaziabad","Gali","Delhi Bazar","Shree Ganesh"];
  const sourceRows=diagnostics.map(item=>{
   const host=String(item.url||"").replace("https://","").replace("http://","").split("/")[0];
   const sourceValues=item.marketValues||item.marketResults||{};
   const status=item.status?"HTTP "+item.status:"HTTP —";
   const cells=marketColumns.map(market=>{
    const value=sourceValues&&Object.prototype.hasOwnProperty.call(sourceValues,market)?String(sourceValues[market]):"—";
    const color=value==="—"?"var(--muted,#999)":"var(--text,#fff)";
    return '<span style="display:inline-flex;gap:4px;align-items:center;padding:4px 7px;border:1px solid var(--border,#444);border-radius:7px;font-size:12px;color:'+color+'"><span>'+esc(market)+':</span><strong>'+esc(value)+'</strong></span>';
   }).join("");
   const ambiguous=Array.isArray(item.ambiguousValues)&&item.ambiguousValues.length
    ?'<div style="margin-top:5px;color:#e7b84c;font-size:12px">संदिग्ध मिलान रोका: '+item.ambiguousValues.map(x=>esc(x.value)+" ("+(x.markets||[]).map(esc).join(", ")+")").join(" · ")+'</div>':"";
   return '<div style="padding:9px 0;border-top:1px solid var(--border,#333);font-size:13px"><div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div style="min-width:0;overflow-wrap:anywhere"><strong>'+esc(host||item.market||"Source")+'</strong><div class="muted">'+esc(passNames[item.pass]||item.pass||"")+' · '+esc(resultNames[item.result]||item.result||"स्थिति उपलब्ध नहीं")+'</div></div><span class="muted" style="white-space:nowrap">'+esc(status)+'</span></div><div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:7px">'+cells+'</div>'+ambiguous+'</div>';
  }).join("");
  const aiBox=$("#aiDataMonitor");
  if(aiBox){
   const aiEvents=diagnostics.filter(item=>["groq","deepseek","coarena"].includes(String(item.aiProvider||"").toLowerCase())||item.aiReason||["groq_fallback","deepseek_fallback"].includes(item.result));
   const reasonNames={deepseek_exact_evidence:"DeepSeek ने exact evidence के साथ नंबर पहचाना",deepseek_exact_source_evidence:"DeepSeek ने source evidence के साथ नंबर पहचाना",deepseek_no_verified_evidence:"DeepSeek को verify करने योग्य नंबर नहीं मिला",deepseek_http_429:"DeepSeek rate limit (429)",deepseek_http_401:"DeepSeek API key स्वीकार नहीं हुई (401)",deepseek_http_403:"DeepSeek access denied (403)",deepseek_http_500:"DeepSeek server error (500)",deepseek_invalid_json:"DeepSeek response JSON सही नहीं था",deepseek_request_error:"DeepSeek request में error",groq_exact_evidence:"AI ने exact evidence के साथ नंबर पहचाना",groq_no_verified_evidence:"AI को verify करने योग्य नंबर नहीं मिला",groq_http_429:"Groq rate limit (429)",groq_http_401:"Groq API key स्वीकार नहीं हुई (401)",groq_http_403:"Groq access denied (403)",groq_http_500:"Groq server error (500)",groq_invalid_json:"AI response JSON सही नहीं था",groq_request_error:"AI request में error",chart_context_too_short:"AI को पर्याप्त chart data नहीं मिला"};
   aiBox.innerHTML=aiEvents.length?aiEvents.map(item=>{
    const host=String(item.url||"").replace("https://","").replace("http://","").split("/")[0]||"AI source";
    const found=Array.isArray(item.aiMarketsFound)?item.aiMarketsFound:[];
    const requested=Array.isArray(item.aiRequestedMarkets)?item.aiRequestedMarkets:[];
    const values=item.aiMarketValues&&typeof item.aiMarketValues==="object"?item.aiMarketValues:{};
    const exactEvidence=["deepseek_exact_evidence","deepseek_exact_source_evidence","groq_exact_evidence"].includes(item.aiReason);
    const ok=exactEvidence&&found.length>0;
    const status=reasonNames[item.aiReason]||item.aiReason||(item.result==="deepseek_fallback"?"DeepSeek AI attempt":"AI status उपलब्ध नहीं");
    const valueMarkets=Object.keys(values).filter(m=>/^\d{2}$/.test(String(values[m]||"")));
    const shownMarkets=[...new Set([...requested,...found,...valueMarkets])];
    const numbers=shownMarkets.length?shownMarkets.map(m=>{const hasValue=/^\d{2}$/.test(String(values[m]||""));const verified=exactEvidence&&found.includes(m)&&hasValue;return '<span style="display:inline-flex;gap:5px;align-items:center;padding:5px 8px;border:1px solid var(--border,#444);border-radius:7px;font-size:12px"><strong>'+esc(m)+'</strong><strong style="font-size:16px;color:'+(verified?'#35c979':hasValue?'#e7b84c':'var(--muted,#999)')+'">'+esc(hasValue?values[m]:"—")+'</strong><span style="color:'+(verified?'#35c979':hasValue?'#e7b84c':'var(--muted,#999)')+'">'+(verified?'Evidence verified':hasValue?'AI candidate · verify नहीं हुआ':'नंबर नहीं मिला')+'</span></span>';}).join(""):'<span class="muted">AI ने कोई मार्केट request नहीं की</span>';
    return '<article style="padding:11px 0;border-top:1px solid var(--border,#333)"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><strong>'+esc(host)+'</strong><span style="font-size:12px;color:'+(ok?'#35c979':'#e7b84c')+'">'+esc(status)+'</span></div><p class="muted" style="font-size:12px;margin:5px 0">Pass: '+esc(item.pass||"—")+' · Chart data: '+esc(item.chartChars??"—")+' characters · Truncated: '+(item.chartWasTruncated?"हाँ":"नहीं")+'</p><div style="display:flex;flex-wrap:wrap;gap:6px">'+numbers+'</div>'+(item.detail?'<p class="muted" style="font-size:12px;overflow-wrap:anywhere">'+esc(item.detail)+'</p>':"")+'</article>';
   }).join(""):'<p class="muted">इस Sync cycle में AI का कोई attempt दर्ज नहीं है। AI सिर्फ चुनी हुई websites पर चलता है।</p>';
   const savedAi=Object.values(data.aiSavedResults&&typeof data.aiSavedResults==="object"?data.aiSavedResults:{}).filter(item=>item&&item.evidenceVerified&&/^\\d{2}$/.test(String(item.value||"")));
   if(savedAi.length){
    const savedHtml='<section style="margin:8px 0 12px;padding:10px;border:1px solid var(--border,#444);border-radius:9px"><h3 style="font-size:14px;margin:0 0 8px">सेव किए गए AI रिजल्ट</h3>'+savedAi.sort((a,b)=>String(b.savedAt||"").localeCompare(String(a.savedAt||""))).map(item=>'<div style="display:flex;justify-content:space-between;gap:8px;padding:7px 0;border-top:1px solid var(--border,#333)"><strong>'+esc(item.market||"Market")+'</strong><strong style="color:#35c979;font-size:18px">'+esc(item.value)+'</strong><span class="muted" style="font-size:11px">'+esc(item.resultDate||"")+' · Saved</span></div>').join("")+'</section>';
    aiBox.innerHTML=savedHtml+aiBox.innerHTML;
   }
  }
  box.innerHTML='<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0"><strong style="color:'+color+'">'+esc(labels[data.status]||data.status||"Unknown")+'</strong><span class="muted">Last check: '+esc(when)+'</span></div><p style="margin:6px 0;white-space:pre-wrap">'+esc(data.message||"कोई विवरण नहीं")+'</p><p class="muted" style="margin:4px 0">कुल Source Requests: '+esc(data.attempts??diagnostics.length)+' · हर वेबसाइट की स्थिति नीचे</p>'+buildSourceCityChart(diagnostics)+'<div style="margin-top:8px"><h3 style="font-size:15px;margin:0 0 6px">वेबसाइट की जाँच का विवरण</h3>'+(sourceRows||'<p class="muted">अभी Source-wise विवरण उपलब्ध नहीं है। अगली Sync के बाद दिखेगा।</p>')+'</div>';
 }catch(error){
  box.innerHTML='<span class="muted">अभी sync status उपलब्ध नहीं है। अगली automatic run के बाद यहाँ दिखाई देगा। ('+esc(error.message)+')</span>';
 }
}
$("#refreshAutoSyncStatus")?.addEventListener("click",loadAutoSyncStatus);
async function loadResultConflictPopup(){
 const modal=$("#resultConflictModal"),items=$("#resultConflictItems"),message=$("#resultConflictMessage");
 if(!modal||!items)return;
 try{
  const url="https://raw.githubusercontent.com/jasmelsolanki2017-svg/rk-bhai-results-portal-/public-data/data/auto-sync-status.json?ts="+Date.now();
  const response=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error("Sync status unavailable");
  const data=await response.json();
  const conflicts=(Array.isArray(data.sourceDiagnostics)?data.sourceDiagnostics:[])
    .filter(x=>x.result==="manual_result_protected"&&x.market&&x.resultDate&&x.incomingValue!==undefined);
  const pending=conflicts.filter(c=>{
    const row=allRows.find(r=>String(r.title).trim().toLowerCase()===String(c.market).trim().toLowerCase()&&
      new Date(r.resultDate).toISOString().slice(0,10)===new Date(c.resultDate).toISOString().slice(0,10));
    if(!row)return false;
    const reviewed=row.syncReview;
    return String(row.resultText).trim()===String(c.existingValue).trim()&&
      !(reviewed&&reviewed.automaticValue===String(c.incomingValue)&&["manual","automatic"].includes(reviewed.choice));
  });
  if(!pending.length){modal.hidden=true;modal.style.display="none";return;}
  items.innerHTML=pending.map((c,i)=>{
    const sources=(c.candidateSources||[]).map(x=>String(x).replace(/^https?:\/\//,"").split("/")[0]).join(", ");
    return '<article class="admin-box" style="margin:12px 0;padding:14px;border:1px solid var(--border,#8b7445)">'+
      '<h3 style="margin:0 0 8px">'+esc(c.market)+'</h3>'+
      '<p class="muted" style="margin:4px 0">तारीख: '+esc(new Date(c.resultDate).toLocaleDateString("hi-IN",{timeZone:"Asia/Kolkata"}))+'</p>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0">'+
      '<div style="padding:12px;border:1px solid #d6ad55;border-radius:10px"><small>मैनुअल रिजल्ट</small><div style="font-size:28px;font-weight:800">'+esc(c.existingValue)+'</div></div>'+
      '<div style="padding:12px;border:1px solid #35a66b;border-radius:10px"><small>ऑटोमैटिक रिजल्ट</small><div style="font-size:28px;font-weight:800">'+esc(c.incomingValue)+'</div></div></div>'+
      '<p class="muted" style="font-size:12px">जाँच वाले स्रोत: '+esc(sources||"दोबारा जाँचे गए स्रोत")+'</p>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
      '<button type="button" data-conflict-index="'+i+'" data-conflict-choice="manual" class="secondary">मैनुअल वाला रखें</button>'+
      '<button type="button" data-conflict-index="'+i+'" data-conflict-choice="automatic">ऑटोमैटिक वाला रखें</button></div></article>';
  }).join("");
  modal.hidden=false;modal.style.display="flex";message.textContent="";
  modal.dataset.conflicts=JSON.stringify(pending);
 }catch(error){console.warn("Result conflict popup could not load:",error.message);}
}
$("#resultConflictClose")?.addEventListener("click",()=>{const m=$("#resultConflictModal");m.hidden=true;m.style.display="none";});
$("#resultConflictItems")?.addEventListener("click",async event=>{
 const button=event.target.closest("[data-conflict-choice]");if(!button)return;
 const list=JSON.parse($("#resultConflictModal").dataset.conflicts||"[]");
 const conflict=list[Number(button.dataset.conflictIndex)];if(!conflict)return;
 const choice=button.dataset.conflictChoice;
 const buttons=$("#resultConflictItems").querySelectorAll("button");buttons.forEach(b=>b.disabled=true);
 $("#resultConflictMessage").textContent="आपका फैसला सेव हो रहा है…";
 try{
  await api("/api/admin/results/resolve-conflict",{method:"POST",body:JSON.stringify({
   title:conflict.market,resultDate:conflict.resultDate,manualValue:String(conflict.existingValue),
   automaticValue:String(conflict.incomingValue),choice,sourceUrls:conflict.candidateSources||[]
  })});
  $("#resultConflictMessage").textContent=conflict.market+": "+(choice==="manual"?"मैनुअल रिजल्ट सुरक्षित रखा गया।":"ऑटोमैटिक रिजल्ट चुन लिया गया।");
  await refresh();
  setTimeout(()=>loadResultConflictPopup(),250);
 }catch(error){
  $("#resultConflictMessage").textContent=error.message;
  buttons.forEach(b=>b.disabled=false);
 }
});


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
  await loadResultConflictPopup();
}

async function renderAdminTopResults(){
 const box=$("#adminTopResultCards");if(!box)return;
 try{
  const [rows,cities]=await Promise.all([Promise.resolve(allRows),api("/api/public/cities")]);
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const todayStart=new Date(today+"T00:00:00.000Z"),yesterday=new Date(todayStart.getTime()-86400000).toISOString().slice(0,10);
  const byCity=new Map();
  rows.filter(r=>r.published!==false&&!r.deleted).forEach(r=>{const day=new Date(r.resultDate).toISOString().slice(0,10);if(day!==today&&day!==yesterday)return;if(!byCity.has(r.title))byCity.set(r.title,{today:null,yesterday:null});const slot=byCity.get(r.title);if(day===today)slot.today=r;else slot.yesterday=r;});
  // Put the market with the most recently added result first.
  const latestEntryByCity=new Map();
  rows.filter(r=>r.published!==false&&!r.deleted).forEach(r=>{
   const stamp=Date.parse(r.createdAt||r.updatedAt||r.resultDate)||0;
   const oldStamp=latestEntryByCity.get(r.title)||0;
   if(stamp>oldStamp)latestEntryByCity.set(r.title,stamp);
  });
  const visible=[...new Set([...cities.map(c=>c.cityName),...byCity.keys()])]
   .filter(n=>n&&!hiddenCityNames.has(n))
   .sort((a,b)=>(latestEntryByCity.get(b)||0)-(latestEntryByCity.get(a)||0)||a.localeCompare(b,"hi"));
  if(!visible.length){box.innerHTML='<p class="muted">अभी कोई प्रकाशित रिजल्ट नहीं है।</p>';return;}
  const fixed={"disawar":"05:00–06:30 AM","desawar":"05:00–06:30 AM","faridabad":"06:00–06:30 PM","ghaziabad":"10:00–10:45 PM","gali":"11:30 PM–12:30 AM","delhi bazar":"03:15–04:00 PM","shri ganesh":"04:40–05:20 PM","shree ganesh":"04:40–05:20 PM"};
  const indiaHour=Number(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Kolkata",hour:"2-digit",hourCycle:"h23"}).format(new Date()));
  const galiBlinkWindow=indiaHour<14;
  box.innerHTML=visible.map(city=>{
   const result=byCity.get(city)||{},isGali=String(city).trim().toLocaleLowerCase("en")==="gali";
   const now=isGali?(galiBlinkWindow?(result.today||(result.yesterday?result.yesterday:null)):(result.today||result.yesterday)):result.today;
   const prev=isGali&&!galiBlinkWindow&&!result.today?null:result.yesterday;
   const previousDisplay=isGali?(now||prev):prev;
   const shouldBlink=isGali?!!now&&(galiBlinkWindow||!result.today):!!now;
   const blinkLeft=isGali&&shouldBlink&&!!previousDisplay;
   const blinkRight=!isGali&&shouldBlink;
   const info=cities.find(c=>c.cityName===city)||{},cityKey=city.trim().toLowerCase().replace(/\s+city$/,""),time=cityKey==="chandigarh"?"08:30 PM":(info.expectedTime||info.resultTime||info.time||fixed[cityKey]||"");
   const value=isGali?"-":(now?String(now.resultText):"WAIT");
   const date=now?new Date(now.resultDate).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric",timeZone:"UTC"}):"";
   const message=["❤️ "+city.toUpperCase()+" ❤️","👇 LIVE RESULT 👇","","*✅   (( "+(isGali&&now?now.resultText:value)+" ))   ✅*","","Date : "+date,"","Website: https://jasmelsolanki2017-svg.github.io/rk-bhai-results-portal-/"].join("\n");
   const shareAttrs=now?'href="https://wa.me/?text='+encodeURIComponent(message)+'" target="_blank" rel="noopener" data-share-city="'+esc(city)+'" data-share-value="'+esc(isGali?now.resultText:value)+'" data-share-date="'+esc(now.resultDate)+'"':'aria-disabled="true"';
   const telegramButton=now&&now.published===true?'<button type="button" class="dashboard-whatsapp-share telegram-manual-send" data-telegram-result-id="'+esc(now._id)+'">📨 Telegram भेजें</button>':'';
   return '<article class="top-result-card"><h3>'+esc(city)+'</h3><p class="top-result-time">'+(time?'( '+esc(time)+' )':'&nbsp;')+'</p><div class="top-result-values"><span class="top-previous'+(blinkLeft?' result-blink':'')+'">'+(blinkLeft?'<span class="new-result-badge">NEW</span>':'')+(previousDisplay?esc(previousDisplay.resultText):"XX")+'</span><span class="top-result-arrow">➡️</span><span class="top-current-wrap">'+(blinkRight?'<span class="new-result-badge">NEW</span>':'')+'<span class="top-current'+(blinkRight?' result-blink':'')+'">'+esc(value)+'</span></span></div><div class="dashboard-share-options"><a class="dashboard-whatsapp-share" '+shareAttrs+' data-share-mode="both">कार्ड + मैसेज</a><a class="dashboard-whatsapp-share" '+shareAttrs+' data-share-mode="card">केवल कार्ड</a><a class="dashboard-whatsapp-share" '+shareAttrs+' data-share-mode="message">केवल मैसेज</a>'+telegramButton+'</div></article>';
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
 const date=resultDate?new Date(resultDate).toLocaleDateString("en-IN",{day:"2-digit",month:"long",year:"numeric",timeZone:"UTC"}):new Date().toLocaleDateString("en-IN");
 ctx.fillStyle="#e4e9f2";ctx.font="36px Arial";ctx.fillText(date,540,590);
 const panel=ctx.createLinearGradient(150,0,930,0);panel.addColorStop(0,"#30233d");panel.addColorStop(.5,"#49351d");panel.addColorStop(1,"#30233d");
 ctx.fillStyle=panel;ctx.beginPath();ctx.roundRect(115,665,850,335,34);ctx.fill();
 ctx.strokeStyle="#e0b75f";ctx.lineWidth=4;ctx.stroke();
 ctx.fillStyle="#f7dfaa";ctx.font="bold 36px Arial";ctx.fillText("PUBLISHED RESULT",540,735);
 const resultText=String(value||"—").slice(0,12);let resultFont=250;if(resultText.length>5)resultFont=210;if(resultText.length>8)resultFont=170;
 ctx.fillStyle="#ffffff";ctx.font="bold "+resultFont+"px Arial";ctx.fillText(resultText,540,925);
 ctx.strokeStyle="#d6a84f";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(170,1050);ctx.lineTo(910,1050);ctx.stroke();
 ctx.fillStyle="#f6d58d";ctx.font="bold 36px Arial";ctx.fillText("MORE RESULTS & OLD RECORDS",540,1120);
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
if(adminResultBox)adminResultBox.addEventListener("click",async event=>{
 const telegramButton=event.target.closest(".telegram-manual-send[data-telegram-result-id]");
 if(!telegramButton)return;
 if(!confirm("इस प्रकाशित रिजल्ट को Telegram चैनल पर भेजना है?"))return;
 telegramButton.disabled=true;const oldText=telegramButton.textContent;telegramButton.textContent="भेजा जा रहा है…";
 try{await api("/api/admin/results/"+encodeURIComponent(telegramButton.dataset.telegramResultId)+"/telegram",{method:"POST",body:JSON.stringify({})});telegramButton.textContent="✓ Telegram पर भेज दिया";telegramButton.classList.add("is-sent");}
 catch(error){telegramButton.disabled=false;telegramButton.textContent=oldText;msg.textContent="Telegram भेजने में समस्या: "+error.message;}
});
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
  try{const f=new FormData(e.target);await api("/api/admin/login",{method:"POST",body:JSON.stringify({username:f.get("username"),password:f.get("password")})});showPanel(true);applyAdminRoute();await loadAutoSyncStatus();await loadPosterManager();await loadPopupAdManager();await loadBlinkMessages();await loadAnnouncementManager();await refresh();msg.textContent="Login सफल";}
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
(async()=>{try{await api("/api/admin/session");showPanel(true);applyAdminRoute();await loadAutoSyncStatus();await loadPosterManager();await loadPopupAdManager();await loadBlinkMessages();await loadAnnouncementManager();await refresh();msg.textContent="Admin session चालू है";}
catch{showPanel(false);}})();


const adDesignPresets={gold:{bg:"#20170d",text:"#f4ead5",border:"#d6ad55",button:"#18c76b",buttonText:"#07150d"},red:{bg:"#2b1010",text:"#fff0f0",border:"#e34b4b",button:"#e34b4b",buttonText:"#ffffff"},blue:{bg:"#101d35",text:"#edf5ff",border:"#4b91e8",button:"#2878d0",buttonText:"#ffffff"},green:{bg:"#10271b",text:"#edfff2",border:"#46a66b",button:"#249653",buttonText:"#ffffff"},simple:{bg:"#ffffff",text:"#222222",border:"#dddddd",button:"#222222",buttonText:"#ffffff"}};
function readAdDesign(p){return {backgroundColor:$("#"+p+"Bg").value,textColor:$("#"+p+"Text").value,borderColor:$("#"+p+"Border").value,buttonColor:$("#"+p+"Button").value,buttonTextColor:$("#"+p+"ButtonText").value,radius:Number($("#"+p+"Radius").value),fontSize:Number($("#"+p+"Size").value),alignment:$("#"+p+"Align").value};}
function previewAdDesign(p){
 const d=readAdDesign(p),b=$("#"+p+"Preview");
 const popup=p==="popupDesign";
 const title=$("#"+(popup?"popupAdTitle":"posterHeading")).value.trim();
 const message=$("#"+(popup?"popupAdDescription":"posterDescription")).value.trim();
 const button=$("#"+(popup?"popupAdButton":"posterButtonText")).value.trim();
 b.style.cssText="background:"+d.backgroundColor+";color:"+d.textColor+";border:2px solid "+d.borderColor+";border-radius:"+d.radius+"px;text-align:"+d.alignment+";font-size:"+d.fontSize+"px";
 b.innerHTML='<strong>'+esc(title||"आपका विज्ञापन")+'</strong><p style="white-space:pre-line">'+esc(message||"आपका लिखा हुआ विज्ञापन संदेश यहाँ दिखाई देगा।")+'</p>'+(button?'<span style="display:inline-block;background:'+d.buttonColor+';color:'+d.buttonTextColor+';padding:7px 13px;border-radius:'+d.radius+'px">'+esc(button)+'</span>':'');
}
function setAdDesign(p,d={}){const q=adDesignPresets.gold;$("#"+p+"Bg").value=d.backgroundColor||q.bg;$("#"+p+"Text").value=d.textColor||q.text;$("#"+p+"Border").value=d.borderColor||q.border;$("#"+p+"Button").value=d.buttonColor||q.button;$("#"+p+"ButtonText").value=d.buttonTextColor||q.buttonText;$("#"+p+"Radius").value=String(d.radius||14);$("#"+p+"Size").value=String(d.fontSize||16);$("#"+p+"Align").value=d.alignment||"center";previewAdDesign(p);}
["popupDesign","textDesign"].forEach(p=>{["Bg","Text","Border","Button","ButtonText","Radius","Size","Align"].forEach(s=>$("#"+p+s).addEventListener("input",()=>previewAdDesign(p)));setAdDesign(p);});[["popupDesign",["popupAdTitle","popupAdDescription","popupAdButton"]],["textDesign",["posterHeading","posterDescription","posterButtonText"]]].forEach(([p,ids])=>ids.forEach(id=>$("#"+id).addEventListener("input",()=>previewAdDesign(p))));
document.querySelectorAll("[data-ad-preset]").forEach(b=>b.addEventListener("click",()=>{const q=adDesignPresets[b.dataset.preset]||adDesignPresets.gold;setAdDesign(b.dataset.adPreset,{backgroundColor:q.bg,textColor:q.text,borderColor:q.border,buttonColor:q.button,buttonTextColor:q.buttonText});}));

let popupAdsCache=[];
function resetPopupAdForm(){const form=$("#popupAdForm");form.reset();$("#popupAdEditId").value="";$("#popupAdImage").value="";$("#popupAdPreview").innerHTML="";$("#popupAdEnabled").checked=true;setAdDesign("popupDesign");$("#popupAdFormHeading").textContent="नया Popup Ad जोड़ें";$("#popupAdSave").textContent="Popup Ad जोड़ें";}
function renderPopupAdList(){const box=$("#popupAdList");if(!popupAdsCache.length){box.innerHTML='<p class="muted">अभी कोई Popup Ad नहीं है। नीचे फॉर्म से पहला विज्ञापन जोड़ें।</p>';return;}box.innerHTML=popupAdsCache.map((ad,index)=>'<article class="popup-ad-admin-item"><div class="popup-ad-admin-info"><strong>'+(index+1)+'. '+esc(ad.title||"बिना शीर्षक वाला विज्ञापन")+'</strong><span class="popup-ad-admin-status '+(ad.enabled?'is-on':'is-off')+'">'+(ad.enabled?'ON':'OFF')+'</span><p>'+esc(ad.description||"कोई विवरण नहीं")+'</p></div><div class="popup-ad-admin-actions"><button type="button" data-popup-edit="'+ad.id+'">Edit</button><button type="button" data-popup-toggle="'+ad.id+'" data-enabled="'+(!ad.enabled)+'">'+(ad.enabled?'OFF करें':'ON करें')+'</button><button type="button" class="danger" data-popup-delete="'+ad.id+'">Delete</button></div></article>').join("");}
async function loadPopupAdManager(){try{const data=await api("/api/admin/popup-ads");popupAdsCache=Array.isArray(data.ads)?data.ads:[];renderPopupAdList();}catch(e){$("#popupAdMsg").textContent="Popup Ads load error: "+e.message;}}
$("#popupAdImage").addEventListener("change",()=>{const file=$("#popupAdImage").files[0];if(!file)return;if(file.size>5*1024*1024){$("#popupAdMsg").textContent="फोटो 5 MB से छोटी रखें।";$("#popupAdImage").value="";return;}const reader=new FileReader();reader.onload=()=>{$("#popupAdPreview").innerHTML='<img src="'+reader.result+'" alt="Popup ad preview">';};reader.readAsDataURL(file);});
$("#popupAdReset").addEventListener("click",()=>{resetPopupAdForm();$("#popupAdMsg").textContent="नया विज्ञापन जोड़ने के लिए फॉर्म तैयार है।";});
$("#popupAdForm").addEventListener("submit",async e=>{e.preventDefault();$("#popupAdMsg").textContent="सेव हो रहा है…";try{const editId=$("#popupAdEditId").value;const payload={title:$("#popupAdTitle").value,description:$("#popupAdDescription").value,buttonUrl:$("#popupAdUrl").value,buttonText:$("#popupAdButton").value,delaySeconds:Number($("#popupAdDelay").value),frequencyMinutes:Number($("#popupAdFrequency").value),design:readAdDesign("popupDesign"),enabled:$("#popupAdEnabled").checked};const file=$("#popupAdImage").files[0];if(file){if(file.size>5*1024*1024)throw new Error("फोटो 5 MB से छोटी रखें।");payload.imageData=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error("फोटो पढ़ी नहीं जा सकी।"));reader.readAsDataURL(file);});}await api(editId?"/api/admin/popup-ads/"+encodeURIComponent(editId):"/api/admin/popup-ads",{method:editId?"PUT":"POST",body:JSON.stringify(payload)});resetPopupAdForm();$("#popupAdMsg").textContent=editId?"Popup Ad अपडेट हो गया।":"नया Popup Ad जोड़ दिया गया।";await loadPopupAdManager();}catch(err){$("#popupAdMsg").textContent=err.message;}});
$("#popupAdList").addEventListener("click",async event=>{const edit=event.target.closest("[data-popup-edit]");const toggle=event.target.closest("[data-popup-toggle]");const del=event.target.closest("[data-popup-delete]");if(edit){const ad=popupAdsCache.find(x=>x.id===edit.dataset.popupEdit);if(!ad)return;$("#popupAdEditId").value=ad.id;$("#popupAdTitle").value=ad.title||"";$("#popupAdDescription").value=ad.description||"";$("#popupAdUrl").value=ad.buttonUrl||"";$("#popupAdButton").value=ad.buttonText||"अभी देखें";$("#popupAdDelay").value=String(ad.delaySeconds??0);$("#popupAdFrequency").value=String(ad.frequencyMinutes??0);$("#popupAdEnabled").checked=!!ad.enabled;setAdDesign("popupDesign",ad.design||{});$("#popupAdPreview").innerHTML=ad.imageData?'<img src="'+ad.imageData+'" alt="Popup ad preview">':"";$("#popupAdFormHeading").textContent="Popup Ad एडिट करें";$("#popupAdSave").textContent="बदलाव सेव करें";$("#popupAdForm").scrollIntoView({behavior:"smooth",block:"start"});return;}if(toggle){try{await api("/api/admin/popup-ads/"+encodeURIComponent(toggle.dataset.popupToggle),{method:"PUT",body:JSON.stringify({enabled:toggle.dataset.enabled==="true"})});await loadPopupAdManager();$("#popupAdMsg").textContent="विज्ञापन की स्थिति अपडेट हो गई।";}catch(e){$("#popupAdMsg").textContent=e.message;}return;}if(del){const ad=popupAdsCache.find(x=>x.id===del.dataset.popupDelete);if(!ad||!confirm('"'+(ad.title||"इस विज्ञापन")+'" को delete करना है?'))return;try{await api("/api/admin/popup-ads/"+encodeURIComponent(ad.id),{method:"DELETE"});if($("#popupAdEditId").value===ad.id)resetPopupAdForm();await loadPopupAdManager();$("#popupAdMsg").textContent="विज्ञापन delete हो गया।";}catch(e){$("#popupAdMsg").textContent=e.message;}}});
async function loadPosterManager(){try{const p=await api("/api/admin/poster");$("#posterHeading").value=p.heading||"";$("#posterDescription").value=p.description||"";$("#posterButtonText").value=p.buttonText||"";$("#posterButtonUrl").value=p.buttonUrl||"";$("#posterEnabled").checked=!!p.enabled;setAdDesign("textDesign",p.design||{});}catch(e){$("#posterMsg").textContent="Ad load error: "+e.message;}}
$("#posterForm").addEventListener("submit",async e=>{e.preventDefault();$("#posterMsg").textContent="Saving…";try{await api("/api/admin/poster",{method:"PUT",body:JSON.stringify({heading:$("#posterHeading").value,description:$("#posterDescription").value,buttonText:$("#posterButtonText").value,buttonUrl:$("#posterButtonUrl").value,design:readAdDesign("textDesign"),enabled:$("#posterEnabled").checked})});$("#posterMsg").textContent="Ad saved. Public index पर update हो गया।";}catch(err){$("#posterMsg").textContent=err.message;}});
$("#posterOff").addEventListener("click",async()=>{$("#posterEnabled").checked=false;try{await api("/api/admin/poster",{method:"PUT",body:JSON.stringify({heading:$("#posterHeading").value,description:$("#posterDescription").value,buttonText:$("#posterButtonText").value,buttonUrl:$("#posterButtonUrl").value,design:readAdDesign("textDesign"),enabled:false})});$("#posterMsg").textContent="Ad public page से OFF कर दिया गया।";}catch(e){$("#posterMsg").textContent=e.message;}});
$("#posterDelete").addEventListener("click",async()=>{if(!confirm("विज्ञापन खाली और OFF करना है?"))return;$("#posterHeading").value="";$("#posterDescription").value="";$("#posterButtonText").value="";$("#posterButtonUrl").value="";$("#posterEnabled").checked=false;try{await api("/api/admin/poster",{method:"PUT",body:JSON.stringify({heading:"",description:"",buttonText:"",buttonUrl:"",enabled:false})});$("#posterMsg").textContent="Ad delete/clear हो गया।";}catch(e){$("#posterMsg").textContent=e.message;}});

let blinkMessagesCache=[];
function blinkMessagePayload(){return {title:$("#blinkMessageTitle").value,message:$("#blinkMessageText").value,link:$("#blinkMessageLink").value.trim(),backgroundColor:$("#blinkMessageBg").value,textColor:$("#blinkMessageColor").value,borderColor:$("#blinkMessageBorder").value,speed:Number($("#blinkMessageSpeed").value),enabled:$("#blinkMessageEnabled").checked};}
function previewBlinkMessage(){const p=$("#blinkMessagePreview"),d=blinkMessagePayload();p.textContent=d.message||"आपका मैसेज यहाँ दिखेगा";p.style.cssText="--blink-bg:"+d.backgroundColor+";--blink-text:"+d.textColor+";--blink-border:"+d.borderColor+";--blink-speed:"+d.speed+"s;background:"+d.backgroundColor+";color:"+d.textColor+";border-color:"+d.borderColor+";animation-duration:"+d.speed+"s";}
function resetBlinkMessageForm(){ $("#blinkMessageForm").reset();$("#blinkMessageEditId").value="";$("#blinkMessageEnabled").checked=true;previewBlinkMessage();$("#blinkMessageSave").textContent="मैसेज जोड़ें";}
async function loadBlinkMessages(){try{const d=await api("/api/admin/blink-messages");blinkMessagesCache=Array.isArray(d.messages)?d.messages:[];const box=$("#blinkMessageList");box.innerHTML=blinkMessagesCache.length?blinkMessagesCache.map((m,i)=>'<article class="popup-ad-admin-item"><div class="popup-ad-admin-info"><strong>'+(i+1)+'. '+esc(m.title||"Blink Message")+'</strong><span class="popup-ad-admin-status '+(m.enabled?'is-on':'is-off')+'">'+(m.enabled?'ON':'OFF')+'</span><p>'+esc(m.message)+'</p></div><div class="popup-ad-admin-actions"><button type="button" data-blink-edit="'+m.id+'">Edit</button><button type="button" data-blink-toggle="'+m.id+'" data-enabled="'+(!m.enabled)+'">'+(m.enabled?'OFF करें':'ON करें')+'</button><button type="button" class="danger" data-blink-delete="'+m.id+'">Delete</button></div></article>').join():'<p class="muted">अभी कोई Blink Message नहीं है।</p>';}catch(e){$("#blinkMessageMsg").textContent="लोड नहीं हुआ: "+e.message;}}
["blinkMessageTitle","blinkMessageText","blinkMessageBg","blinkMessageColor","blinkMessageBorder","blinkMessageSpeed"].forEach(id=>$("#"+id).addEventListener("input",previewBlinkMessage));
$("#blinkMessageReset").addEventListener("click",resetBlinkMessageForm);
$("#blinkMessageForm").addEventListener("submit",async e=>{e.preventDefault();try{const id=$("#blinkMessageEditId").value;await api(id?"/api/admin/blink-messages/"+encodeURIComponent(id):"/api/admin/blink-messages",{method:id?"PUT":"POST",body:JSON.stringify(blinkMessagePayload())});$("#blinkMessageMsg").textContent=id?"मैसेज अपडेट हो गया।":"नया Blink Message जोड़ दिया गया।";resetBlinkMessageForm();await loadBlinkMessages();}catch(err){$("#blinkMessageMsg").textContent=err.message;}});
$("#blinkMessageList").addEventListener("click",async e=>{const edit=e.target.closest("[data-blink-edit]"),toggle=e.target.closest("[data-blink-toggle]"),del=e.target.closest("[data-blink-delete]");if(edit){const m=blinkMessagesCache.find(x=>x.id===edit.dataset.blinkEdit);if(!m)return;$("#blinkMessageEditId").value=m.id;$("#blinkMessageTitle").value=m.title||"";$("#blinkMessageText").value=m.message||"";$("#blinkMessageLink").value=m.link||"";$("#blinkMessageBg").value=m.backgroundColor||"#20170d";$("#blinkMessageColor").value=m.textColor||"#fff0c2";$("#blinkMessageBorder").value=m.borderColor||"#d6ad55";$("#blinkMessageSpeed").value=String(m.speed||1);$("#blinkMessageEnabled").checked=!!m.enabled;$("#blinkMessageSave").textContent="बदलाव सेव करें";previewBlinkMessage();$("#blinkMessageForm").scrollIntoView({behavior:"smooth",block:"start"});return;}try{if(toggle){await api("/api/admin/blink-messages/"+encodeURIComponent(toggle.dataset.blinkToggle),{method:"PUT",body:JSON.stringify({enabled:toggle.dataset.enabled==="true"})});await loadBlinkMessages();}if(del){const m=blinkMessagesCache.find(x=>x.id===del.dataset.blinkDelete);if(m&&confirm("यह Blink Message delete करना है?")){await api("/api/admin/blink-messages/"+encodeURIComponent(m.id),{method:"DELETE"});await loadBlinkMessages();}}}catch(err){$("#blinkMessageMsg").textContent=err.message;}});
previewBlinkMessage();
async function loadAnnouncementManager(){try{const a=await api("/api/admin/announcement");$("#announcementTitleInput").value=a.title||"";$("#announcementMessageInput").value=a.message||"";$("#announcementEnabled").checked=!!a.enabled;}catch(e){$("#announcementMsg").textContent="Banner load error: "+e.message;}}
$("#announcementForm").addEventListener("submit",async e=>{e.preventDefault();$("#announcementMsg").textContent="Saving…";try{await api("/api/admin/announcement",{method:"PUT",body:JSON.stringify({title:$("#announcementTitleInput").value,message:$("#announcementMessageInput").value,enabled:$("#announcementEnabled").checked})});$("#announcementMsg").textContent="सूचना सेव हो गई। Public website पर update हो जाएगी।";}catch(err){$("#announcementMsg").textContent=err.message;}});
$("#announcementOff").addEventListener("click",async()=>{try{await api("/api/admin/announcement",{method:"PUT",body:JSON.stringify({title:$("#announcementTitleInput").value,message:$("#announcementMessageInput").value,enabled:false})});$("#announcementEnabled").checked=false;$("#announcementMsg").textContent="Public banner OFF कर दिया गया।";}catch(e){$("#announcementMsg").textContent=e.message;}});
