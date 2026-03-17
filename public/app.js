const crawlForm = document.getElementById("crawlForm");
const crawlBtn = document.getElementById("crawlBtn");
const crawlMsg = document.getElementById("crawlMsg");
const pageCount = document.getElementById("pageCount");
const indexCount = document.getElementById("indexCount");
const searchForm = document.getElementById("searchForm");
const queryInput = document.getElementById("query");
const resultsEl = document.getElementById("results");

async function loadStats() {
  try {
    const r = await fetch("/api/stats");
    const d = await r.json();
    pageCount.textContent = d.pages ?? 0;
    indexCount.textContent = d.indexEntries ?? 0;
  } catch {
    pageCount.textContent = "?";
    indexCount.textContent = "?";
  }
}

let pollTimer;
function pollWhileCrawling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const r = await fetch("/api/crawl-status");
    const d = await r.json();
    await loadStats();
    if (!d.busy && d.last) {
      clearInterval(pollTimer);
      crawlBtn.disabled = false;
      if (d.last.ok) {
        crawlMsg.className = "msg ok";
        crawlMsg.textContent = `Done: ${d.last.pagesCrawled} pages indexed. (${d.last.errors?.length || 0} fetch errors — normal for some links.)`;
      } else {
        crawlMsg.className = "msg err";
        crawlMsg.textContent = "Error: " + (d.last.error || "unknown");
      }
    }
  }, 1500);
}

crawlForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  crawlMsg.className = "msg";
  crawlMsg.textContent = "Starting…";
  crawlBtn.disabled = true;
  const url = document.getElementById("startUrl").value.trim();
  const maxDepth = parseInt(document.getElementById("maxDepth").value, 10) || 0;
  try {
    const res = await fetch("/api/crawl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, maxDepth }),
    });
    const data = await res.json();
    if (!res.ok) {
      crawlMsg.className = "msg err";
      crawlMsg.textContent = data.error || res.statusText;
      crawlBtn.disabled = false;
      return;
    }
    crawlMsg.textContent = data.message || "Crawling…";
    pollWhileCrawling();
  } catch (err) {
    crawlMsg.className = "msg err";
    crawlMsg.textContent = err.message;
    crawlBtn.disabled = false;
  }
});

searchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = queryInput.value.trim();
  resultsEl.innerHTML = "";
  if (!q) return;
  const r = await fetch("/api/search?q=" + encodeURIComponent(q));
  const data = await r.json();
  const list = data.results || [];
  if (list.length === 0) {
    resultsEl.innerHTML = "<li>No results. Crawl a site first, or try other words.</li>";
    return;
  }
  for (const row of list) {
    const li = document.createElement("li");
    li.innerHTML = `<a href="${escapeAttr(row.url)}" target="_blank" rel="noopener">${escapeHtml(row.title || row.url)}</a><span class="snippet">${escapeHtml(row.snippet || "")}…</span>`;
    resultsEl.appendChild(li);
  }
});

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
function escapeAttr(s) {
  return String(s).replace(/"/g, "&quot;");
}

loadStats();
