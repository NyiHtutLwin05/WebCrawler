import { crawl } from "./crawler.js";

const url = process.argv[2];
const depth = parseInt(process.argv[3], 10) || 2;

if (!url) {
  console.log("Usage: node crawler-cli.js <start-url> [maxDepth]");
  process.exit(1);
}

console.log("Crawling:", url, "depth:", depth);
crawl(url, depth)
  .then((r) => {
    console.log("Pages crawled:", r.pagesCrawled);
    if (r.errors.length) console.log("Errors (sample):", r.errors.slice(0, 10));
    console.log("Done. Run: npm start  →  search in the web UI.");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
