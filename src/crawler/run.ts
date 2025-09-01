// src/crawler/run.ts
import "dotenv/config";
import crawlSite from "./index";
import { saveCrawl } from "./save";
import { summarizeAndExtract } from "./extract";
import { pool } from "../db";
import { CrawlResult, PageRecord } from "./types";

(async () => {
  const [startUrl = "https://example.com", maxPagesArg = "10", maxDepthArg = "1"] = process.argv.slice(2);
  const maxPages = Number(maxPagesArg);
  const maxDepth = Number(maxDepthArg);

  console.log(`[crawler] start ${startUrl} pages=${maxPages} depth=${maxDepth}`);

  try {
    // Some builds export a CrawlResult type from ./index that's structurally the same
    // but lives in a different TS namespace, causing incompatibility. We normalize here.
    const rawResult = await crawlSite({ startUrl, maxPages, maxDepth });

    // Normalize shapes so we have a single CrawlResult + an errors array for logging.
    const pages: PageRecord[] = (rawResult as any).pages ?? [];
    const errorsArr: Array<{ depth?: number; url?: string; error?: string }> =
      Array.isArray((rawResult as any).errors) ? (rawResult as any).errors : [];

    const result: CrawlResult & { errors: typeof errorsArr } = {
      pages,
      errors: errorsArr,
    };

    console.log(`[crawler] fetched pages=${result.pages.length} errors=${result.errors.length}`);
    for (const p of result.pages) {
      // status/status_code are both optional; display whichever exists
      const status = (p as any).status ?? (p as any).status_code ?? "";
      console.log(` - [${status}] d=${p.depth} ${p.url}`);
    }
    if (result.errors.length) {
      console.log("Errors:");
      for (const e of result.errors) {
        console.log(` - d=${e.depth ?? ""} ${e.url ?? ""} :: ${e.error ?? ""}`);
      }
    }

    // Persist crawl
    const { crawlId } = await saveCrawl(startUrl, result as any);
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
