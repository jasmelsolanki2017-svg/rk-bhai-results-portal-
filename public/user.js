const $=s=>document.querySelector(s);
async function userApi(url,opts={}){
 const response=await fetch(url,{credentials:"same-origin",...opts,headers:{...(opts.body?{"Content-Type":"application/json"}:{}),...(opts.headers||{})}});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error||"Request failed");
 return data;
}
function showUser(on){$("#userLogin").hidden=on;$("#userContent").hidden=!on;}
$("#userLoginForm").addEventListener("submit",async e=>{
 e.preventDefault();$("#userMessage").textContent="Login हो रहा है…";
 try{const f=new FormData(e.target);const data=await userApi("/api/user/login",{method:"POST",body:JSON.stringify({username:f.get("username"),password:f.get("password")})});$("#userName").textContent=data.username;showUser(true);$("#userMessage").textContent="";if(window.loadResults)loadResults();if(window.loadMonth)loadMonth();}
 catch(err){$("#userMessage").textContent=err.message;}
});
$("#userLogout").addEventListener("click",async()=>{try{await userApi("/api/user/logout",{method:"POST"});}catch{}showUser(false);$("#userLoginForm").reset();});
(async()=>{try{const data=await userApi("/api/user/session");$("#userName").textContent=data.username;showUser(true);}catch{showUser(false);}})();
