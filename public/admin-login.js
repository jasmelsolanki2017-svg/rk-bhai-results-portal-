const form=document.getElementById("adminLoginForm");
const msg=document.getElementById("loginMsg");
form.addEventListener("submit",async event=>{
  event.preventDefault();
  const button=form.querySelector("button");
  button.disabled=true;
  msg.textContent="Login जाँच रहे हैं…";
  try{
    const data=new FormData(form);
    const response=await fetch("/api/admin/login",{
      method:"POST",
      credentials:"same-origin",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({username:data.get("username"),password:data.get("password")})
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(result.error||"Login नहीं हुआ। ID और Password जाँचें।");
    window.location.replace("/admin");
  }catch(error){
    msg.textContent=error.message;
    button.disabled=false;
  }
});