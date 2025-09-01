// src/crawler/run.ts
import "dotenv/config";
import crawlSite from "./index";
import { saveCrawl } from "./save";
import { summarizeAndExtract } from "./extract";
import { pool } from "../db";

(async () => {
  const [startUrl = "https://example.com", maxPagesArg = "10", maxDepthArg = "1"] = process.argv.slice(2);
  const maxPages = Number(maxPagesArg);
  const maxDepth = Number(maxDepthArg);

  console.log(`[crawler] start ${startUrl} pages=${maxPages} depth=${maxDepth}`);

  try {
    const result = await crawlSite({ startUrl, maxPages, maxDepth });

    console.log(`[crawler] fetched pages=${result.pages.length} errors=${result.errors.length}`);
    for (const p of result.pages) {
      console.log(` - [${p.status}] d=${p.depth} ${p.url}`);
    }
    if (result.errors.length) {
      console.log("Errors:");
      for (const e of result.errors) {
        console.log(` - d=${e.depth} ${e.url} :: ${e.error}`);
      }
    }

    const { crawlId } = await saveCrawl(startUrl, result);
    console.log(`[crawler] saved crawl_id=${crawlId}`);

    // Summarize + extract for each saved page
    for (const p of result.pages) {
      try {
        const row = await pool.query(
          `SELECT id FROM site_pages WHERE crawl_id = $1 AND url = $2 LIMIT 1`,
          [crawlId, p.url]
        );
        const pageId: string | undefined = row.rows?.[0]?.id;

        if (!pageId) {
          console.warn(`[crawler] skip summarize (no page id) ${p.url}`);
          continue;
        }

        const text = (p.text ?? "").trim();
        if (!text) {
          console.warn(`[crawler] skip summarize (no text) ${p.url}`);
          continue;
        }

        const { summary, entities } = await summarizeAndExtract(pageId, p.url, text);
        console.log(`[crawler] summarized ${p.url}`);
        console.log("  summary:", summary);
        console.log("  entities:", entities);
      } catch (err) {
        console.error(`[crawler] failed to summarize ${p.url}`, err);
      }
    }
  } catch (err) {
    console.error("[crawler] failed:", err);
    process.exit(1);
  }
})();
