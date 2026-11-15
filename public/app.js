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
    const rows=await getJson("/api/results?today=1");
    const todayStat=document.getElementById("statToday");if(todayStat)todayStat.textContent=rows.length;
    if(!rows.length){host.innerHTML='<p class="muted">आज अभी कोई प्रकाशित परिणाम उपलब्ध नहीं है।</p>';}
    else host.innerHTML=rows.map(row=>`
      <article class="result"><div><h2>${escapeHtml(row.title)}</h2><time>${new Date(row.resultDate).toLocaleDateString("hi-IN")}</time></div><div class="value">${escapeHtml(row.resultText)}</div></article>`).join("");
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
    const rows=await getJson("/api/results?month="+encodeURIComponent(key));
    const monthStat=document.getElementById("statMonth"),cityStat=document.getElementById("statCities");
    if(monthStat)monthStat.textContent=rows.length;
    if(cityStat)cityStat.textContent=new Set(rows.map(r=>r.title)).size;
    renderMonthTable(rows,selectedMonth);
  }catch(e){chartHost.innerHTML='<p class="muted">मासिक रिकॉर्ड लोड नहीं हो पाए।</p>';}
}
function renderMonthTable(rows,month){
  if(!rows.length){chartHost.innerHTML='<p class="muted empty-month">इस महीने के लिए अभी कोई प्रकाशित रिकॉर्ड उपलब्ध नहीं है।</p>';return;}
  const titles=[...new Set(rows.map(r=>r.title))].sort((a,b)=>{const ac=/chandigarh/i.test(a),bc=/chandigarh/i.test(b);return ac!==bc?(ac?1:-1):a.localeCompare(b,"hi");});
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
    const head='<tr><th class="date-col">तारीख</th>'+group.map(t=>'<th>'+escapeHtml(t)+'</th>').join("")+'</tr>';
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
