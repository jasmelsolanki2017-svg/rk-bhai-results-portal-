const $=s=>document.querySelector(s);
const city=new URLSearchParams(location.search).get("name")||"";
let rows=[];
async function api(url,opts={}){const headers={...(opts.body?{"Content-Type":"application/json"}:{}),...(opts.headers||{})};const r=await fetch(url,{credentials:"same-origin",...opts,headers});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Request failed");return d;}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function dateValue(v){const d=new Date(v);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);}
function monthKey(v){const d=new Date(v);return d.getUTCFullYear()+"-"+String(d.getUTCMonth()+1).padStart(2,"0");}
function monthLabel(key){const [y,m]=key.split("-").map(Number);return new Date(Date.UTC(y,m-1,1)).toLocaleDateString("hi-IN",{month:"long",year:"numeric",timeZone:"UTC"});}
async function load(){
 if(!city)throw new Error("City name missing");
 await api("/api/admin/session");
 const all=await api("/api/admin/results");
 rows=all.filter(x=>String(x.title||"").trim()===city).sort((a,b)=>new Date(b.resultDate)-new Date(a.resultDate));
 $("#cityTitle").textContent=city;
 $("#cityCount").textContent=rows.length+" कुल रिकॉर्ड · महीने के अनुसार अलग-अलग चार्ट";
 render();
}
function render(){
 const months=[...new Set(rows.map(x=>monthKey(x.resultDate)))].sort((a,b)=>b.localeCompare(a));
 $("#cityRecords").innerHTML=months.map((key,index)=>{
  const list=rows.filter(x=>monthKey(x.resultDate)===key);
  const body=list.map(x=>'<tr><td class="date-col">'+new Date(x.resultDate).toLocaleDateString("hi-IN",{day:"2-digit",month:"short",year:"numeric",timeZone:"UTC"})+'</td><td><button class="chart-edit" type="button" data-edit="'+x._id+'" title="Edit record">'+esc(x.resultText)+'</button></td><td>'+(x.published?"Published":"Unpublished")+'</td><td><div class="actions"><button type="button" data-edit="'+x._id+'">Edit</button><button type="button" class="danger" data-del="'+x._id+'">Delete</button></div></td></tr>').join("");
  return '<section class="market-chart city-month-chart"><h3>'+esc(monthLabel(key))+' <span class="muted">('+list.length+' रिकॉर्ड)</span></h3><div class="table-scroll"><table class="history-table"><thead><tr><th>तारीख</th><th>परिणाम</th><th>स्थिति</th><th>कार्रवाई</th></tr></thead><tbody>'+body+'</tbody></table></div></section>';
 }).join("")||'<p class="muted">इस शहर का कोई रिकॉर्ड नहीं मिला।</p>';
}
function edit(id){
 const x=rows.find(r=>r._id===id);if(!x)return;
 const f=$("#cityEditForm").elements;
 f.id.value=x._id;f.title.value=x.title;f.resultText.value=x.resultText;
 f.resultDate.value=dateValue(x.resultDate);f.sourceUrl.value=x.sourceUrl||"";f.published.checked=!!x.published;
 $("#cityEditBox").hidden=false;$("#cityEditBox").scrollIntoView({behavior:"smooth",block:"start"});
}
$("#cityRecords").addEventListener("click",async e=>{
 const editId=e.target.closest("[data-edit]")?.dataset.edit,del=e.target.closest("[data-del]")?.dataset.del;
 try{
  if(editId){edit(editId);return;}
  if(del){const x=rows.find(r=>r._id===del);if(!x||!confirm("क्या "+x.resultText+" वाला रिकॉर्ड हटाना है?"))return;await api("/api/admin/results/"+del,{method:"DELETE"});await load();$("#cityLoginMsg").textContent="रिकॉर्ड डिलीट हो गया";}
 }catch(err){$("#cityLoginMsg").textContent=err.message;}
});
$("#cityEditForm").addEventListener("submit",async e=>{
 e.preventDefault();const f=new FormData(e.target),id=f.get("id");
 try{
  await api("/api/admin/results/"+id,{method:"PATCH",body:JSON.stringify({title:f.get("title"),resultText:f.get("resultText"),resultDate:f.get("resultDate"),sourceUrl:f.get("sourceUrl"),published:f.has("published")})});
  $("#cityEditBox").hidden=true;await load();$("#cityLoginMsg").textContent="रिकॉर्ड अपडेट हो गया";
 }catch(err){$("#cityLoginMsg").textContent=err.message;}
});
$("#cancelCityEdit").addEventListener("click",()=>$("#cityEditBox").hidden=true);
(async()=>{try{await load();$("#cityLoginMsg").textContent="";}catch(e){$("#cityLoginMsg").textContent=e.message+" — Admin Panel में दोबारा login करें।";}})();
