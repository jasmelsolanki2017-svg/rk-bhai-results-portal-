const host = document.getElementById("results");
const chartHost = document.getElementById("historyChart");
document.getElementById("year").textContent = new Date().getFullYear();

async function loadResults(){
  try{
    const response = await fetch("/api/results");
    if(!response.ok) throw new Error("Could not load results");
    const rows = await response.json();
    renderHistoryChart(rows);
    if(!rows.length){
      host.innerHTML='<p class="muted">अभी कोई प्रकाशित रिकॉर्ड उपलब्ध नहीं है।</p>';
      return;
    }
    host.innerHTML = rows.map(row => `
      <article class="result">
        <div><h2>${escapeHtml(row.title)}</h2><time>${new Date(row.resultDate).toLocaleDateString("hi-IN")}</time></div>
        <div class="value">${escapeHtml(row.resultText)}</div>
      </article>`).join("");
  }catch(e){
    host.innerHTML='<p class="muted">अभी परिणाम लोड नहीं हो पाए। कृपया बाद में प्रयास करें।</p>';
    chartHost.innerHTML='<p class="muted">चार्ट अभी उपलब्ध नहीं है।</p>';
  }
}

function renderHistoryChart(rows){
  const now = new Date();
  const months = [];
  for(let offset=5; offset>=0; offset--){
    const d = new Date(now.getFullYear(), now.getMonth()-offset, 1);
    months.push({key:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`,label:d.toLocaleDateString("hi-IN",{month:"short"}),count:0});
  }
  rows.forEach(row=>{
    const d = new Date(row.resultDate);
    if(Number.isNaN(d.getTime())) return;
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    const month = months.find(item=>item.key===key);
    if(month) month.count++;
  });
  const max = Math.max(1,...months.map(m=>m.count));
  chartHost.innerHTML = `
    <div class="chart-bars" role="img" aria-label="पिछले छह महीनों में प्रकाशित रिकॉर्ड की संख्या">
      ${months.map(m=>`
        <div class="chart-column">
          <span class="chart-count">${m.count}</span>
          <div class="chart-track"><div class="chart-fill" style="height:${Math.max(m.count ? 6 : 0,(m.count/max)*100)}%"></div></div>
          <span class="chart-month">${escapeHtml(m.label)}</span>
        </div>`).join("")}
    </div>
    <p class="chart-note">यह चार्ट केवल प्रकाशित रिकॉर्ड की गिनती दिखाता है, भविष्य का अनुमान नहीं।</p>`;
}

function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
loadResults();
