const host = document.getElementById("results");
document.getElementById("year").textContent = new Date().getFullYear();
async function loadResults(){
  try{
    const response = await fetch("/api/results");
    if(!response.ok) throw new Error("Could not load results");
    const rows = await response.json();
    if(!rows.length){host.innerHTML='<p class="muted">अभी कोई प्रकाशित रिकॉर्ड उपलब्ध नहीं है।</p>';return;}
    host.innerHTML = rows.map(row => `
      <article class="result">
        <div><h2>${escapeHtml(row.title)}</h2><time>${new Date(row.resultDate).toLocaleDateString("hi-IN")}</time></div>
        <div class="value">${escapeHtml(row.resultText)}</div>
      </article>`).join("");
  }catch(e){host.innerHTML='<p class="muted">अभी परिणाम लोड नहीं हो पाए। कृपया बाद में प्रयास करें।</p>';}
}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
loadResults();