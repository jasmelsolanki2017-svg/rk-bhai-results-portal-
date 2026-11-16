(()=>{
 const menu=document.getElementById("dashboardSideMenu");
 const backdrop=document.getElementById("dashboardMenuBackdrop");
 const openBtn=document.getElementById("dashboardMenuOpen");
 const closeBtn=document.getElementById("dashboardMenuClose");
 if(!menu||!backdrop||!openBtn)return;
 const open=()=>{menu.classList.add("is-open");backdrop.hidden=false;openBtn.setAttribute("aria-expanded","true");menu.setAttribute("aria-hidden","false");document.body.classList.add("dashboard-menu-open");};
 const close=()=>{menu.classList.remove("is-open");backdrop.hidden=true;openBtn.setAttribute("aria-expanded","false");menu.setAttribute("aria-hidden","true");document.body.classList.remove("dashboard-menu-open");};
 openBtn.addEventListener("click",open);closeBtn?.addEventListener("click",close);backdrop.addEventListener("click",close);
 menu.addEventListener("click",e=>{if(e.target.closest("a"))close();});
 document.addEventListener("keydown",e=>{if(e.key==="Escape")close();});
 const logout=menu.querySelector("[data-dashboard-logout]");
 logout?.addEventListener("click",()=>{close();const target=document.getElementById("logout")||document.getElementById("userLogout")||document.getElementById("forcedLogout");target?.click();});
 const dashboard=document.getElementById("panel")||document.getElementById("userContent");
 if(dashboard){const sync=()=>{openBtn.hidden=dashboard.hidden;};new MutationObserver(sync).observe(dashboard,{attributes:true,attributeFilter:["hidden"]});sync();}
})();
