import * as cheerio from "cheerio";
import initSqlJs from "sql.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = join(__dirname, "search_index.db");
export const INDEX_JSON_PATH = join(__dirname, "indexed_data.json");

const DEFAULT_DELAY_MS = 600;
const DEFAULT_CONCURRENCY = 3;

let db = null;
let SQL = null;

async function ensureSql() {
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: (f) => join(__dirname, "node_modules", "sql.js", "dist", f),
    });
  }
  return SQL;
}

export function saveDatabase() {
  if (!db) return;
  const data = db.export();
  writeFileSync(DB_PATH, Buffer.from(data));
}

export async function openDatabase(path = DB_PATH) {
  await ensureSql();
  if (existsSync(path)) {
    const filebuffer = readFileSync(path);
    db = new SQL.Database(filebuffer);
  } else {
    db = new SQL.Database();
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      title TEXT,
      text_content TEXT
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS inverted_index (
      term TEXT NOT NULL,
      page_id INTEGER NOT NULL,
      UNIQUE(term, page_id)
    );
  `);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_inverted_term ON inverted_index(term);`,
  );
  return db;
}

function normalizeUrl(base, href) {
  try {
    const u = new URL(href, base);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}

function sameHost(urlStr, rootHost) {
  try {
    return new URL(urlStr).hostname === rootHost;
  } catch {
    return false;
  }
}

function tokenize(text) {
  if (!text) return [];
  const words = text.toLowerCase().match(/[a-z0-9]{2,}/g) || [];
  return [...new Set(words)];
}

const lastFetchByHost = new Map();

async function rateLimitedFetch(url, delayMs) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("Bad URL");
  }
  const now = Date.now();
  const last = lastFetchByHost.get(host) || 0;
  const wait = Math.max(0, delayMs - (now - last));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchByHost.set(host, Date.now());

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "MiniSearchBot/1.0 (educational crawler)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

function savePage(url, title, textContent) {
  db.run(
    `INSERT INTO pages (url, title, text_content) VALUES (?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET title = excluded.title, text_content = excluded.text_content`,
    [url, title || "", textContent || ""],
  );
  const stmt = db.prepare("SELECT id FROM pages WHERE url = ?");
  stmt.bind([url]);
  let id = null;
  if (stmt.step()) id = stmt.getAsObject().id;
  stmt.free();
  return id;
}

function indexPage(pageId, terms) {
  const ins = db.prepare(
    "INSERT OR IGNORE INTO inverted_index (term, page_id) VALUES (?, ?)",
  );
  for (const t of terms) {
    ins.run([t, pageId]);
  }
  ins.free();
}

export async function crawl(startUrl, maxDepth = 2, options = {}) {
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  await openDatabase(options.dbPath || DB_PATH);
  lastFetchByHost.clear();

  let rootHost;
  try {
    rootHost = new URL(startUrl).hostname;
  } catch {
    throw new Error("Invalid start URL");
  }

  const visited = new Set();
  let queue = [{ url: startUrl, depth: 0 }];
  const errors = [];
  let pagesCrawled = 0;

  async function processOne(item) {
    const { url, depth } = item;
    if (visited.has(url)) return;
    visited.add(url);

    let res;
    try {
      res = await rateLimitedFetch(url, delayMs);
    } catch (e) {
      errors.push(`${url}: ${e.message || "fetch failed"}`);
      return;
    }

    if (!res.ok) {
      errors.push(`${url}: HTTP ${res.status}`);
      return;
    }

    const ctype = res.headers.get("content-type") || "";
    if (!ctype.includes("text/html")) {
      return;
    }

    let html;
    try {
      html = await res.text();
    } catch (e) {
      errors.push(`${url}: ${e.message || "read body failed"}`);
      return;
    }

    let $;
    try {
      $ = cheerio.load(html);
    } catch {
      errors.push(`${url}: parse error`);
      return;
    }

    $("script, style, nav, footer").remove();
    const title = $("title").first().text().trim() || url;
    const textContent = $("body")
      .text()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 50000);
    const pageId = savePage(url, title, textContent);
    indexPage(pageId, tokenize(title + " " + textContent));
    pagesCrawled++;

    if (depth >= maxDepth) return;

    const links = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      const abs = normalizeUrl(url, href);
      if (abs && sameHost(abs, rootHost) && !visited.has(abs)) {
        links.push(abs);
      }
    });

    for (const link of [...new Set(links)]) {
      if (!visited.has(link)) {
        queue.push({ url: link, depth: depth + 1 });
      }
    }
  }

  while (queue.length > 0) {
    const batch = queue.splice(0, concurrency);
    await Promise.all(batch.map((item) => processOne(item)));
  }

  saveDatabase();
  exportIndexJson();
  return { pagesCrawled, errors };
}

export function exportIndexJson(path = INDEX_JSON_PATH) {
  if (!db) return path;
  const pages = [];
  const stmt = db.prepare("SELECT id, url, title FROM pages");
  while (stmt.step()) pages.push(stmt.getAsObject());
  stmt.free();

  const terms = [];
  const tstmt = db.prepare(
    "SELECT term, page_id FROM inverted_index ORDER BY term, page_id",
  );
  while (tstmt.step()) terms.push(tstmt.getAsObject());
  tstmt.free();

  const byTerm = {};
  for (const { term, page_id } of terms) {
    if (!byTerm[term]) byTerm[term] = [];
    byTerm[term].push(page_id);
  }
  writeFileSync(
    path,
    JSON.stringify({ pages, invertedIndex: byTerm }, null, 2),
    "utf8",
  );
  return path;
}

export function search(query, limit = 20) {
  if (!db) return [];
  const words = tokenize(query);
  if (words.length === 0) return [];

  let pageIds = null;
  for (const w of words) {
    const ids = new Set();
    const stmt = db.prepare(
      "SELECT page_id FROM inverted_index WHERE term = ?",
    );
    stmt.bind([w]);
    while (stmt.step()) ids.add(stmt.getAsObject().page_id);
    stmt.free();
    if (pageIds === null) pageIds = ids;
    else pageIds = new Set([...pageIds].filter((id) => ids.has(id)));
    if (pageIds.size === 0) return [];
  }

  const list = [...pageIds].slice(0, limit);
  if (list.length === 0) return [];

  const placeholders = list.map(() => "?").join(",");
  const stmt = db.prepare(
    `SELECT id, url, title, substr(text_content, 1, 200) AS snippet FROM pages WHERE id IN (${placeholders})`,
  );
  stmt.bind(list);
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}

export function getStats() {
  if (!db) return { pages: 0, indexEntries: 0 };
  let pages = 0;
  let s = db.prepare("SELECT COUNT(*) AS c FROM pages");
  if (s.step()) pages = s.getAsObject().c;
  s.free();
  let indexEntries = 0;
  s = db.prepare("SELECT COUNT(*) AS c FROM inverted_index");
  if (s.step()) indexEntries = s.getAsObject().c;
  s.free();
  return { pages, indexEntries };
}
