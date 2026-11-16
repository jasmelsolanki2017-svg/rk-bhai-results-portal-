function updateLiveClock(){
  const now=new Date();
  const time=new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:true}).format(now);
  const date=new Intl.DateTimeFormat("hi-IN",{timeZone:"Asia/Kolkata",weekday:"long",day:"2-digit",month:"long",year:"numeric"}).format(now);
  const t=document.getElementById("liveClock"),d=document.getElementById("liveDate");
  if(t)t.textContent=time;
  if(d)d.textContent=date;
}
updateLiveClock();setInterval(updateLiveClock,1000);
