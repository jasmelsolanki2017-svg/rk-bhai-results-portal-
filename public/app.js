const host=document.getElementById("results");
const chartHost=document.getElementById("historyChart");
const monthLabel=document.getElementById("monthLabel");
const prevButton=document.getElementById("prevMonth");
const nextButton=document.getElementById("nextMonth");
document.getElementById("year").textContent=new Date().getFullYear();
let selectedMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);

async function getJson(url){
  const response=await fetch(url);
  if(!response.ok) throw new Error("Request failed");
  return response.json();
}
async function loadResults(){
  try{
    const [rows,cities]=await Promise.all([getJson("/api/results?recent=2"),getJson("/api/public/cities")]);
    const todayKey=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
    const todayStart=new Date(todayKey+"T00:00:00.000Z");
    const yesterdayKey=new Date(todayStart.getTime()-86400000).toISOString().slice(0,10);
    const byCity=new Map();
    rows.forEach(row=>{
      const dayKey=new Date(row.resultDate).toISOString().slice(0,10);
      if(!byCity.has(row.title))byCity.set(row.title,{today:"XX",yesterday:"XX"});
      const item=byCity.get(row.title);
      if(dayKey===todayKey)item.today=row.resultText;
      if(dayKey===yesterdayKey)item.yesterday=row.resultText;
    });
    cities.forEach(city=>{if(!byCity.has(city.cityName))byCity.set(city.cityName,{today:"XX",yesterday:"XX"});});
    const todayStat=document.getElementById("statToday");if(todayStat)todayStat.textContent=rows.filter(r=>new Date(r.resultDate).toISOString().slice(0,10)===todayKey).length;
    if(!byCity.size){host.innerHTML='<p class="muted">अभी कोई प्रकाशित परिणाम उपलब्ध नहीं है।</p>';return;}
    const yesterdayLabel=new Date(todayStart.getTime()-86400000).toLocaleDateString("hi-IN",{day:"2-digit",month:"short"});
    const todayLabel=todayStart.toLocaleDateString("hi-IN",{day:"2-digit",month:"short"});
    host.innerHTML='<div class="recent-results-wrap"><table class="recent-results-table"><thead><tr><th>शहर / मार्केट</th><th>कल ('+yesterdayLabel+')</th><th>आज ('+todayLabel+')</th></tr></thead><tbody>'+
      [...byCity.entries()].sort((a,b)=>a[0].localeCompare(b[0],"hi")).map(([city,result])=>'<tr><th>'+escapeHtml(city)+'</th><td class="'+(result.yesterday==="XX"?"no-result":"")+'">'+escapeHtml(result.yesterday)+'</td><td class="'+(result.today==="XX"?"no-result":"")+'">'+escapeHtml(result.today)+'</td></tr>').join("")+
      '</tbody></table></div>';
  }catch(e){host.innerHTML='<p class="muted">अभी परिणाम लोड नहीं हो पाए। कृपया बाद में प्रयास करें।</p>';}
}
function monthKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;}
async function loadMonth(){
  const key=monthKey(selectedMonth);
  monthLabel.textContent=selectedMonth.toLocaleDateString("hi-IN",{month:"long",year:"numeric"});
  prevButton.disabled=false;
  nextButton.disabled=monthKey(selectedMonth)>=monthKey(new Date());
  chartHost.innerHTML='<p class="muted">रिकॉर्ड लोड हो रहे हैं…</p>';
  try{
    const [rows,cities]=await Promise.all([getJson("/api/results?month="+encodeURIComponent(key)),getJson("/api/public/cities")]);
    const monthStat=document.getElementById("statMonth"),cityStat=document.getElementById("statCities");
    if(monthStat)monthStat.textContent=rows.length;
    if(cityStat)cityStat.textContent=new Set(rows.map(r=>r.title)).size;
    renderMonthTable(rows,selectedMonth,cities);
  }catch(e){chartHost.innerHTML='<p class="muted">मासिक रिकॉर्ड लोड नहीं हो पाए।</p>';}
}
function renderMonthTable(rows,month,cities=[]){
  const cityTimes=new Map(cities.map(c=>[c.cityName,c.expectedTime||""]));
  const titles=[...new Set([...rows.map(r=>r.title),...cities.map(c=>c.cityName)])].sort((a,b)=>{const ac=/chandigarh/i.test(a),bc=/chandigarh/i.test(b);return ac!==bc?(ac?1:-1):a.localeCompare(b,"hi");});
  if(!titles.length){chartHost.innerHTML='<p class="muted empty-month">इस महीने के लिए अभी कोई प्रकाशित परिणाम या approved city उपलब्ध नहीं है।</p>';return;}
  const byDay=new Map();
  rows.forEach(row=>{
    const raw=row.resultDate;
    const day=new Date(raw).getUTCDate();
    if(!byDay.has(day)) byDay.set(day,{});
    byDay.get(day)[row.title]=row.resultText;
  });
  const daysInMonth=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  const groups=[];
  for(let i=0;i<titles.length;i+=7) groups.push(titles.slice(i,i+7));
  const summary='<div class="chart-summary"><strong>'+titles.length+' शहर/मार्केट</strong><span>'+rows.length+' प्रकाशित रिकॉर्ड</span></div>';
  const tables=groups.map((group,index)=>{
    const head='<tr><th class="date-col">तारीख</th>'+group.map(t=>'<th>'+escapeHtml(t)+(cityTimes.get(t)?'<small class="chart-city-time">समय '+escapeHtml(cityTimes.get(t))+' IST</small>':'')+'</th>').join("")+'</tr>';
    const body=Array.from({length:daysInMonth},(_,i)=>{
      const day=i+1, values=byDay.get(day)||{};
      return '<tr><th class="date-col">'+String(day).padStart(2,"0")+'</th>'+group.map(t=>'<td>'+(values[t]?escapeHtml(values[t]):'—')+'</td>').join("")+'</tr>';
    }).join("");
    return '<section class="market-chart"><h3>चार्ट '+(index+1)+' / '+groups.length+'</h3><div class="table-scroll"><table class="history-table"><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div></section>';
  }).join("");
  chartHost.innerHTML=summary+tables;
}
prevButton.addEventListener("click",()=>{selectedMonth=new Date(selectedMonth.getFullYear(),selectedMonth.getMonth()-1,1);loadMonth();});
nextButton.addEventListener("click",()=>{const candidate=new Date(selectedMonth.getFullYear(),selectedMonth.getMonth()+1,1);if(candidate<=new Date(new Date().getFullYear(),new Date().getMonth(),1)){selectedMonth=candidate;loadMonth();}});
function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
loadMonth();
loadResults();
