# Web Crawler & Indexer (JavaScript)

A **beginner-friendly** mini search engine:

1. **Crawl** websites recursively (max depth), same host only  
2. **Parse** HTML → links + text (`cheerio`)  
3. **Store** keywords + page URLs in **SQLite** (`search_index.db`)  
4. **Search** with an **inverted index** (AND on all query words)  
5. **async/await**, **rate limiting** per host, **error handling**  
6. **Web UI** at `http://localhost:3000`  
7. **Indexed data file**: `indexed_data.json` (export after each crawl)  
8. **Database file**: `search_index.db` (SQLite via **sql.js** — no native compile)

## Requirements

- **Node.js 18+** (uses built-in `fetch`)

## Setup

```bash
cd Web_Crawler
npm install
npm start
```

Open **http://localhost:3000** in your browser.

## Optional CLI crawl

```bash
npm run crawl -- https://example.com 2
```

Then search in the web UI.

## Files (deliverables)

| File | Purpose |
|------|---------|
| `crawler.js` | Crawler + DB + inverted index + `search()` |
| `server.js` | Web server + `/api/crawl`, `/api/search` |
| `search_index.db` | SQLite file (sql.js; created on first crawl) |
| `indexed_data.json` | JSON export of pages + inverted index |
| `public/` | Simple search web interface |

## Mission checklist

- [x] Recursive crawl, depth limit  
- [x] Extract links + text  
- [x] Database (SQLite)  
- [x] Inverted index search  
- [x] async/await + concurrency (batch of 3)  
- [x] Rate limiting + errors handled  

**Note:** Only crawl sites you’re allowed to crawl. Use low depth and respect `robots.txt` on real projects (not implemented here to keep the starter small).

### If crawl shows “fetch failed” (Node / SSL)

On some systems Node cannot verify HTTPS certificates (`unable to get local issuer certificate`). Fix your system/keychain or Node install, or test against an **HTTP** dev server you run locally. The **web UI** uses your machine’s network the same way as `npm start`’s crawler.
