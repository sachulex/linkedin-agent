import type { CrawlOptions, CrawlResult, PageRecord } from "./types";
import { normalizeUrl, sameOrigin, allowedByRobots } from "./utils";
import { fetch } from "undici";
import * as cheerio from "cheerio";

export async function crawlSite(opts: CrawlOptions): Promise<CrawlResult> {
  const { startUrl, maxPages, maxDepth } = opts;
  const userAgent = opts.userAgent ?? "WebsiteResearchBot/0.1";

  const visited = new Set<string>();
  const pages: PageRecord[] = [];
  const errors: Array<{ url: string; error: string }> = [];

  const queue: Array<{ url: string; depth: number; parentUrl: string | null }> = [
    { url: normalizeUrl(startUrl), depth: 0, parentUrl: null },
  ];

  while (queue.length > 0 && pages.length < maxPages) {
    const { url, depth, parentUrl } = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    if (!(await allowedByRobots(url, userAgent))) {
      errors.push({ url, error: "Blocked by robots.txt" });
      continue;
    }

    try {
      const res = await fetch(url, { headers: { "User-Agent": userAgent } });
      const status = res.status;
      const contentType = res.headers.get("content-type") ?? undefined;
      const fetchedAt = new Date().toISOString();

      let title: string | undefined;
      let text: string | undefined;
      let links: string[] = [];

      if (status === 200 && contentType?.includes("text/html")) {
        const html = await res.text();
        const $ = cheerio.load(html);
        title = $("title").first().text().trim();
        text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 2000);
        links = $("a[href]")
          .map((_, el) => $(el).attr("href"))
          .get()
          .filter(Boolean)
          .map((href) => {
            try {
              return normalizeUrl(new URL(href!, url).toString());
            } catch {
              return "";
            }
          })
          .filter((u) => u && sameOrigin(startUrl, u));
      }

      const record: PageRecord = {
        url,
        depth,
        status,
        contentType,
        title,
        text,
        fetchedAt,
        parentUrl,
      };
      pages.push(record);

      if (depth + 1 <= maxDepth) {
        for (const link of links) {
          if (!visited.has(link)) {
            queue.push({ url: link, depth: depth + 1, parentUrl: url });
          }
        }
      }
    } catch (err: any) {
      errors.push({ url, error: err.message || String(err) });
    }
  }

  return { pages, errors };
}

export default crawlSite;
