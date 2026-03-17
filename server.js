import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  crawl,
  search,
  getStats,
  openDatabase,
  saveDatabase,
  DB_PATH,
} from "./crawler.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, "public")));

let crawlRunning = false;
let lastCrawl = null;

app.get("/api/stats", (_req, res) => {
  try {
    res.json(getStats());
  } catch (e) {
    res.json({ pages: 0, indexEntries: 0 });
  }
});

app.get("/api/search", (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) {
    return res.json({ results: [] });
  }
  try {
    const results = search(q, 30);
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/crawl", async (req, res) => {
  if (crawlRunning) {
    return res
      .status(429)
      .json({ error: "A crawl is already running. Wait until it finishes." });
  }
  const { url, maxDepth } = req.body || {};
  if (!url || typeof url !== "string") {
    return res
      .status(400)
      .json({
        error: 'Send JSON: { "url": "https://example.com", "maxDepth": 2 }',
      });
  }
  const depth = Math.min(5, Math.max(0, parseInt(maxDepth, 10) || 2));

  crawlRunning = true;
  res.json({
    started: true,
    message: "Crawl running… this page will update when done.",
  });

  try {
    const result = await crawl(url.trim(), depth, {
      delayMs: 700,
      concurrency: 3,
    });
    saveDatabase();
    lastCrawl = { ok: true, ...result, at: new Date().toISOString() };
    console.log("Crawl done:", result);
  } catch (e) {
    lastCrawl = { ok: false, error: e.message, at: new Date().toISOString() };
    console.error(e);
  } finally {
    crawlRunning = false;
  }
});

app.get("/api/crawl-status", (_req, res) => {
  res.json({ busy: crawlRunning, last: lastCrawl });
});

await openDatabase(DB_PATH);
app.listen(PORT, () => {
  console.log(`Open http://localhost:${PORT} in your browser`);
});
