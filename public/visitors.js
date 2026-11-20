(()=>{
const $=s=>document.querySelector(s);
async function api(url,opts={}){
 const headers={...(opts.body?{"Content-Type":"application/json"}:{}),...(opts.headers||{})};
 const response=await fetch(url,{credentials:"same-origin",...opts,headers,signal:opts.signal||AbortSignal.timeout(20000)});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error||("Request failed ("+response.status+")"));
 return data;
}
const number=value=>Number(value||0).toLocaleString("en-IN");
async function load(){
 const status=$("#visitorAnalyticsMsg");status.textContent="Visitor data लोड हो रहा है…";
 try{
  await api("/api/admin/session");
  const data=await api("/api/admin/visitors",{signal:AbortSignal.timeout(15000)});
  $("#visitorToday").textContent=number(data.today);
  $("#visitorYesterday").textContent=number(data.yesterday);
  $("#visitor7Days").textContent=number(data.last7);
  $("#visitor30Days").textContent=number(data.last30);
  $("#visitorTotal").textContent=number(data.total);
  $("#visitorRecent").textContent=number(data.recent5m);
  const newVisitors=data.newVisitors||{};
  $("#newVisitorToday").textContent=number(newVisitors.today);
  $("#newVisitorYesterday").textContent=number(newVisitors.yesterday);
  $("#newVisitor7Days").textContent=number(newVisitors.last7);
  $("#newVisitor30Days").textContent=number(newVisitors.last30);
  const newDays=Array.isArray(newVisitors.daily)?newVisitors.daily:[];
  $("#newVisitorDaily").innerHTML=newDays.length?newDays.map(day=>{
   const label=new Date(day._id+"T00:00:00+05:30").toLocaleDateString("hi-IN",{day:"2-digit",month:"short"});
   return '<div class="visitor-day-row"><span>'+label+'</span><strong>'+number(day.count)+'</strong></div>';
  }).join(""):'<p class="muted">अभी नए विज़िटर का रिकॉर्ड नहीं है।</p>';
  $("#visitorGithubToday").textContent=number(data.sites?.github_pages?.today);
  $("#visitorGithubTotal").textContent=number(data.sites?.github_pages?.total);
  $("#visitorRenderToday").textContent=number(data.sites?.render?.today);
  $("#visitorRenderTotal").textContent=number(data.sites?.render?.total);
  const days=Array.isArray(data.daily)?data.daily:[];
  $("#visitorDaily").innerHTML=days.length?days.map(day=>{
   const label=new Date(day._id+"T00:00:00+05:30").toLocaleDateString("hi-IN",{day:"2-digit",month:"short"});
   return '<div class="visitor-day-row"><span>'+label+'</span><strong>'+number(day.count)+'</strong></div>';
  }).join(""):'<p class="muted">अभी कोई Visit रिकॉर्ड नहीं है।</p>';
  status.textContent="आखिरी अपडेट: "+new Date().toLocaleTimeString("hi-IN");
 }catch(error){
  status.textContent="Visitor data लोड नहीं हुआ: "+error.message;
  if(/unauthorized|login|session/i.test(error.message))$("#visitorPageMsg").textContent="Admin session नहीं मिली। पहले Admin Panel में Login करें।";
 }
}
$("#visitorRefresh").addEventListener("click",load);
load();
})();