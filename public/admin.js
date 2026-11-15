const $=s=>document.querySelector(s);
const msg=$("#msg");
let allRows=[];
let selectedMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);

async function api(url,opts={}){
  const headers={...(opts.body?{"Content-Type":"application/json"}:{}),...(opts.headers||{})};
  const response=await fetch(url,{credentials:"same-origin",...opts,headers});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error||("Request failed ("+response.status+")"));
  return data;
}
function showPanel(on){$("#loginBox").hidden=on;$("#panel").hidden=!on;}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function dateValue(v){return new Date(v).toISOString().slice(0,10);}
function monthKey(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");}

async function refresh(){
  allRows=await api("/api/admin/results");
  renderCityLinks();
  await loadMonth();
  await loadUsers();
}
function renderCityLinks(){
 const cities=[...new Set(allRows.map(x=>String(x.title||"").trim()).filter(Boolean))].sort((a,b)=>{const ac=/chandigarh/i.test(a),bc=/chandigarh/i.test(b);return ac!==bc?(ac?1:-1):a.localeCompare(b,"hi");});
 $("#cityLinks").innerHTML=cities.map(city=>"<a class=\"city-link\" href=\"/city.html?name="+encodeURIComponent(city)+"\"><strong>"+esc(city)+"</strong><span>"+allRows.filter(x=>x.title===city).length+" रिकॉर्ड</span></a>").join("")||"<p class=\"muted\">अभी कोई शहर/मार्केट रिकॉर्ड नहीं है।</p>";
}
async function loadMonth(){
  const key=monthKey(selectedMonth);
  $("#monthLabel").textContent=selectedMonth.toLocaleDateString("hi-IN",{month:"long",year:"numeric"});
  $("#nextMonth").disabled=key>=monthKey(new Date());
  $("#adminChart").innerHTML='<p class="muted">चार्ट लोड हो रहा है…</p>';
  try{
    const rows=await api("/api/admin/results?month="+encodeURIComponent(key));
    renderMonthChart(rows,selectedMonth);
  }catch(e){$("#adminChart").innerHTML='<p class="muted">चार्ट लोड नहीं हुआ: '+esc(e.message)+'</p>';}
}
function renderMonthChart(rows,month){
  if(!rows.length){$("#adminChart").innerHTML='<p class="muted empty-month">इस महीने का कोई रिकॉर्ड नहीं है।</p>';return;}
  const titles=[...new Set(rows.map(r=>r.title))].sort((a,b)=>a.localeCompare(b,"hi"));
  const byDay=new Map();
  rows.forEach(row=>{
    const day=new Date(row.resultDate).getUTCDate();
    if(!byDay.has(day))byDay.set(day,{});
    byDay.get(day)[row.title]=row;
  });
  const daysInMonth=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  const groups=[];
  for(let i=0;i<titles.length;i+=5)groups.push(titles.slice(i,i+5));
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
$("#loginForm").addEventListener("submit",async e=>{
  e.preventDefault();msg.textContent="Login हो रहा है…";
  try{const f=new FormData(e.target);await api("/api/admin/login",{method:"POST",body:JSON.stringify({username:f.get("username"),password:f.get("password")})});showPanel(true);await refresh();msg.textContent="Login सफल";}
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

async function loadUsers(){
  try{
    const users=await api("/api/admin/users");
    $("#adminUsers").innerHTML=users.map(u=>`
      <article class="admin-row"><div class="admin-row-info"><b>${esc(u.username)}</b><p>${u.active?"Active":"Disabled"} · ${new Date(u.createdAt).toLocaleDateString("hi-IN")}</p></div>
      <div class="actions"><button type="button" data-user-toggle="${u._id}" data-active="${u.active}">${u.active?"Disable":"Enable"}</button><button type="button" class="danger" data-user-delete="${u._id}">Delete</button></div></article>`).join("")||"<p class='muted'>अभी कोई user नहीं बनाया गया।</p>";
  }catch(e){$("#adminUsers").innerHTML="<p class='muted'>Users लोड नहीं हुए: "+esc(e.message)+"</p>";}
}
$("#createUserForm").addEventListener("submit",async e=>{
 e.preventDefault();const f=new FormData(e.target),status=$("#userAdminMsg");status.textContent="User बनाया जा रहा है…";
 try{const data=await api("/api/admin/users",{method:"POST",body:JSON.stringify({username:f.get("username"),password:f.get("password")})});status.textContent="User "+data.username+" सफलतापूर्वक बन गया। Login जानकारी user को सुरक्षित तरीके से दें।";e.target.reset();await loadUsers();}
 catch(err){status.textContent=err.message;}
});
$("#adminUsers").addEventListener("click",async e=>{
 const toggle=e.target.closest("[data-user-toggle]"),del=e.target.closest("[data-user-delete]");
 try{
  if(toggle){await api("/api/admin/users/"+toggle.dataset.userToggle,{method:"PATCH",body:JSON.stringify({active:toggle.dataset.active!=="true"})});}
  if(del){if(!confirm("क्या इस user को हटाना है?"))return;await api("/api/admin/users/"+del.dataset.userDelete,{method:"DELETE"});}
  await loadUsers();
 }catch(err){$("#userAdminMsg").textContent=err.message;}
});

$("#cancelEdit").addEventListener("click",resetForm);
$("#prevMonth").addEventListener("click",()=>{selectedMonth=new Date(selectedMonth.getFullYear(),selectedMonth.getMonth()-1,1);loadMonth();});
$("#nextMonth").addEventListener("click",()=>{const d=new Date(selectedMonth.getFullYear(),selectedMonth.getMonth()+1,1);if(d<=new Date(new Date().getFullYear(),new Date().getMonth(),1)){selectedMonth=d;loadMonth();}});
$("#logout").addEventListener("click",async()=>{
  try{await api("/api/admin/logout",{method:"POST"});showPanel(false);$("#loginForm").reset();msg.textContent="Logout हो गया";}
  catch(err){msg.textContent=err.message;showPanel(false);}
});
(async()=>{try{await api("/api/admin/session");showPanel(true);await refresh();msg.textContent="Admin session चालू है";}
catch{showPanel(false);}})();
