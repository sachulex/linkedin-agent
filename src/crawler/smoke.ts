// src/crawler/smoke.ts
import crawlSite from "./index";
import { CrawlOptions, PageRecord } from "./types";

const [startUrl = "https://example.com", maxPagesArg = "5", maxDepthArg = "1"] = process.argv.slice(2);
const maxPages = Number(maxPagesArg);
const maxDepth = Number(maxDepthArg);

(async () => {
  // Type the options explicitly to match our shared types
  const opts: CrawlOptions = {
    startUrl,
    maxPages,
    maxDepth,
    userAgent: "WebsiteResearchBot/0.1",
  };

  const raw = await crawlSite(opts);

  // Normalize across possible build namespaces and shapes
  const pages: PageRecord[] = (raw as any).pages ?? [];
  const errors: Array<{ depth?: number; url?: string; error?: string }> =
    Array.isArray((raw as any).errors) ? (raw as any).errors : [];

  const out = {
    meta: {
      startUrl,
      maxPages,
      maxDepth,
      pages: pages.length,
      errors: errors.length,
    },
    pages: pages.map((p) => ({
      url: p.url,
      depth: p.depth,
      // show whichever status field exists
      status: (p as any).status ?? (p as any).status_code ?? null,
      title: p.title,
      contentType: (p as any).contentType,
      parentUrl: (p as any).parentUrl,
    })),
    errors,
  };

  console.log(JSON.stringify(out, null, 2));
})();
