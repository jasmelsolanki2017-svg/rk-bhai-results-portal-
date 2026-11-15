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
    const rows=await getJson("/api/results");
    if(!rows.length){host.innerHTML='<p class="muted">अभी कोई प्रकाशित रिकॉर्ड उपलब्ध नहीं है।</p>';}
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
    renderMonthTable(rows,selectedMonth);
  }catch(e){chartHost.innerHTML='<p class="muted">मासिक रिकॉर्ड लोड नहीं हो पाए।</p>';}
}
function renderMonthTable(rows,month){
  if(!rows.length){chartHost.innerHTML='<p class="muted empty-month">इस महीने के लिए अभी कोई प्रकाशित रिकॉर्ड नहीं है।</p>';return;}
  const titles=[...new Set(rows.map(r=>r.title))].sort((a,b)=>a.localeCompare(b));
  const byDay=new Map();
  rows.forEach(row=>{
    const d=new Date(row.resultDate);
    const day=d.getDate();
    if(!byDay.has(day)) byDay.set(day,{});
    byDay.get(day)[row.title]=byDay.get(day)[row.title] ? byDay.get(day)[row.title]+", "+row.resultText : row.resultText;
  });
  const daysInMonth=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  const head='<tr><th>तारीख</th>'+titles.map(t=>'<th>'+escapeHtml(t)+'</th>').join("")+'</tr>';
  const body=Array.from({length:daysInMonth},(_,i)=>{
    const day=i+1, values=byDay.get(day)||{};
    return '<tr><th>'+day+'</th>'+titles.map(t=>'<td>'+(values[t]?escapeHtml(values[t]):'—')+'</td>').join("")+'</tr>';
  }).join("");
  chartHost.innerHTML='<div class="table-scroll"><table class="history-table"><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div>';
}
prevButton.addEventListener("click",()=>{selectedMonth=new Date(selectedMonth.getFullYear(),selectedMonth.getMonth()-1,1);loadMonth();});
nextButton.addEventListener("click",()=>{const candidate=new Date(selectedMonth.getFullYear(),selectedMonth.getMonth()+1,1);if(candidate<=new Date(new Date().getFullYear(),new Date().getMonth(),1)){selectedMonth=candidate;loadMonth();}});
function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
loadMonth();
loadResults();
