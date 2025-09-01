// src/crawler/index.ts
import { fetchPage, normalizeUrl } from "./http";
import { allowedByRobots } from "./robots";

export type CrawlOptions = {
  startUrl: string;
  maxPages: number;
  maxDepth: number;
};

export type PageRecord = {
  url: string;
  depth: number;
  status: number;

  // used by save.ts and classifier
  title?: string | null;
  text?: string | null;      // raw HTML for now
  metaDescription?: string | null;
  language?: string | null;
  fetchedAt: Date;

  // diagnostics
  contentType: string;
  htmlSnippet?: string;
  outLinks: string[];
};

export type CrawlError = { url: string; depth: number; error: string; };
export type CrawlResult = { pages: PageRecord[]; errors: CrawlError[]; };

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function extractLinks(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const links = new Set<string>();
  const hrefRe = /<a\b[^>]*\bhref\s*=\s*(['"]?)([^'">\s]+)\1/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html))) {
    const raw = m[2].trim();
    if (!raw || raw.startsWith("#")) continue;
    if (/^(mailto:|tel:|javascript:|data:)/i.test(raw)) continue;
    try {
      const abs = new URL(raw, base).toString();
      const norm = normalizeUrl(abs);
      const u = new URL(norm);
      if ((u.protocol === "http:" || u.protocol === "https:") &&
          u.hostname.toLowerCase() === base.hostname.toLowerCase()) {
        links.add(norm);
      }
    } catch {}
  }
  return Array.from(links);
}

/** <title>…</title> */
function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const t = m?.[1]?.trim() || "";
  return t.length ? t : null;
}

/** <meta name="description" content="…"> (or og:description) */
function extractMetaDescription(html: string): string | null {
  const nameRe = /<meta\s+name=["']description["']\s+content=["']([^"']+)["'][^>]*>/i;
  const propRe = /<meta\s+property=["']og:description["']\s+content=["']([^"']+)["'][^>]*>/i;
  const m1 = html.match(nameRe)?.[1]?.trim();
  const m2 = html.match(propRe)?.[1]?.trim();
  const val = (m1 || m2 || "").replace(/\s+/g, " ").trim();
  return val.length ? val : null;
}

/** lang from <html lang=".."> or og:locale like en_US → en */
function extractLanguage(html: string): string | null {
  const langAttr = html.match(/<html[^>]*\blang=["']?([a-zA-Z-_.]+)["']?[^>]*>/i)?.[1]?.toLowerCase();
  if (langAttr) {
    // normalize en-US → en
    const short = langAttr.split(/[_-]/)[0];
    return short || langAttr;
  }
  const ogLocale = html.match(/<meta\s+property=["']og:locale["']\s+content=["']([^"']+)["']/i)?.[1]?.toLowerCase();
  if (ogLocale) {
    const short = ogLocale.split(/[_-]/)[0];
    return short || ogLocale;
  }
  return null;
}

/** Breadth-first crawl within the same host */
export default async function crawlSite(opts: CrawlOptions): Promise<CrawlResult> {
  const { startUrl, maxPages, maxDepth } = opts;
  const start = normalizeUrl(startUrl);
  const startHost = new URL(start).hostname.toLowerCase();

  const pages: PageRecord[] = [];
  const errors: CrawlError[] = [];
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: start, depth: 0 }];

  while (queue.length && pages.length < maxPages) {
    const { url, depth } = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      const isAllowed = await allowedByRobots(url);
      if (!isAllowed) { errors.push({ url, depth, error: "Blocked by robots.txt" }); continue; }

      const res = await fetchPage(url);
      if (!res.ok) { errors.push({ url, depth, error: res.error || `HTTP ${res.status}` }); continue; }

      const contentType = res.contentType || "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
        continue;
      }

      const html = res.html ?? "";
      const outLinks = html ? extractLinks(html, res.url) : [];
      const title = html ? extractTitle(html) : null;
      const metaDescription = html ? extractMetaDescription(html) : null;
      const language = html ? extractLanguage(html) : null;

      if (depth < maxDepth) {
        for (const link of outLinks) {
          if (!visited.has(link)) {
            const host = new URL(link).hostname.toLowerCase();
            if (host === startHost) queue.push({ url: link, depth: depth + 1 });
          }
        }
      }

      pages.push({
        url: res.url,
        depth,
        status: res.status,
        title,
        text: html,
        metaDescription,
        language,
        fetchedAt: new Date(),
        contentType,
        htmlSnippet: html ? html.slice(0, 400) : undefined,
        outLinks,
      });

      await sleep(2000);
    } catch (e: any) {
      errors.push({ url, depth, error: e?.message ?? String(e) });
    }
  }

  return { pages, errors };
}
