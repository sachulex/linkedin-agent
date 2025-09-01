// src/workflows/website_research_v1.ts
import { JSDOM } from "jsdom";

/** ========== Types ========== */
export type WebsiteResearchInputs = {
  start_url?: string;
  crawl_id?: string; // accepted but unused here (kept for compatibility)
  max_pages?: number;
  max_depth?: number;
  include_sitemap?: boolean;
  questions?: string[];
};

type PageSummary = {
  url: string;
  title: string;
  type: "home" | "about" | "pricing" | "product" | "case_study" | "contact" | "legal" | "blog" | "other";
  depth: number;
  summary: string; // short trimmed text sample
};

type Findings = {
  mentions_pricing: boolean;
  pricing_page_urls: string[];
  value_prop: string | null;
  key_features: string[];
  partners_integrations: string[];
  noteworthy_metrics: string[];
  coverage: {
    pages_considered: number;
    unique_urls_in_evidence: number;
  };
};

/** ========== Small utils ========== */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cleanSpaces(s: string): string {
  return s
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ *[\r\n]+ */g, " ")
    .trim();
}

function normalizeForDedup(s: string): string {
  return cleanSpaces(
    s
      .toLowerCase()
      .replace(/\[[^\]]*\]/g, "") // remove bracketed elisions like […]
      .replace(/[“”"']/g, "")
      .replace(/[–—]/g, "-")
  );
}

function splitSentences(text: string): string[] {
  // Basic sentence splitter, respects periods/!/?
  const pieces = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z(])/)
    .map((s) => cleanSpaces(s));
  // Further split very long clauses when cue-verbs appear
  const more: string[] = [];
  const cue = /\b(Identify|Automatically|Increase|Forecast|Optimize|Reduce|Improve|Recommend|Manage|Analyze|Reveal|Predict)\b/i;
  for (const p of pieces) {
    if (p.length > 240 && cue.test(p)) {
      // break on ; or — or · or • when present
      const split = p.split(/[;•·—-]+/).map(cleanSpaces).filter(Boolean);
      if (split.length > 1) {
        more.push(...split);
        continue;
      }
    }
    more.push(p);
  }
  return more.filter(Boolean);
}

function pageTypeFromUrl(url: string): PageSummary["type"] {
  const u = new URL(url);
  const p = u.pathname.toLowerCase();
  if (p === "/" || p === "/home") return "home";
  if (p.includes("about")) return "about";
  if (p.includes("pricing") || p.includes("plans")) return "pricing";
  if (p.includes("case") && p.includes("stud")) return "case_study";
  if (p.includes("contact")) return "contact";
  if (p.includes("privacy") || p.includes("terms") || p.includes("policy")) return "legal";
  if (p.startsWith("/blog")) return "blog";
  if (p.includes("product") || p.includes("features")) return "product";
  return "other";
}

function sameOrigin(a: string, b: string): boolean {
  try {
    const A = new URL(a);
    const B = new URL(b);
    return A.origin === B.origin;
  } catch {
    return false;
  }
}

/** ========== Fetch + Extract ========== */
async function fetchHTML(url: string, timeoutMs = 12000): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function extractTextWithAlt(html: string): { text: string; title: string; metas: string[]; alts: string[] } {
  const dom = new JSDOM(html);
  const { document } = dom.window;

  // Kill scripts/styles
  document.querySelectorAll("script,style,noscript,iframe").forEach((n) => n.remove());

  const title = cleanSpaces(document.title || "");
  const metaDesc = Array.from(document.querySelectorAll('meta[name="description"], meta[property="og:description"]'))
    .map((m) => cleanSpaces(m.getAttribute("content") || ""))
    .filter(Boolean);

  // Collect visible text (rough)
  const bodyText = cleanSpaces(document.body?.textContent || "");

  // Collect IMG alt text (helps surface partner names, feature labels on logos)
  const alts = Array.from(document.querySelectorAll("img[alt]"))
    .map((img) => cleanSpaces(img.getAttribute("alt") || ""))
    .filter((s) => s && s.length > 1);

  const text = cleanSpaces([title, ...metaDesc, bodyText].filter(Boolean).join(". "));
  return { text, title, metas: metaDesc, alts };
}

function extractLinks(html: string, baseUrl: string): string[] {
  try {
    const dom = new JSDOM(html);
    const { document } = dom.window;
    const links = Array.from(document.querySelectorAll("a[href]"))
      .map((a) => {
        const href = a.getAttribute("href") || "";
        try {
          return new URL(href, baseUrl).toString();
        } catch {
          return "";
        }
      })
      .filter(Boolean);
    // Keep only same-origin http(s)
    const filtered = Array.from(
      new Set(links.filter((u) => /^https?:\/\//.test(u) && sameOrigin(u, baseUrl)))
    );
    return filtered;
  } catch {
    return [];
  }
}

/** ========== Finders ========== */
function pickValueProp(text: string, title: string): string | null {
  // Prefer short, punchy sentences that look like taglines or product value
  const want = /\b(AI|platform|co-?pilot|profit|revenue|conversion|optimi[sz]e|pricing|exposure|ROAS|CAC)\b/i;
  const sents = splitSentences(text);
  const candidates = sents
    .filter((s) => s.length >= 40 && s.length <= 180 && want.test(s))
    .slice(0, 10);

  if (candidates.length) return candidates[0];

  // Fallback: use title if it looks descriptive
  if (title && /AI|platform|pricing|profit|growth|e-?commerce/i.test(title)) return title;
  return null;
}

function pickKeyFeatures(text: string, maxItems = 8): string[] {
  const sents = splitSentences(text);
  const cue = /\b(Identify|Automatically|Increase|Forecast|Optimize|Reduce|Improve|Recommend|Manage|Analyze|Reveal|Predict)\b/i;

  const raw = sents
    .filter((s) => s.length >= 40 && s.length <= 220)
    .filter((s) => cue.test(s));

  const dedup = new Map<string, string>();
  for (const r of raw) {
    const key = normalizeForDedup(r);
    if (!dedup.has(key)) dedup.set(key, r);
  }
  return Array.from(dedup.values()).slice(0, maxItems);
}

const KNOWN_BRANDS = [
  "Shopify",
  "Google",
  "Meta",
  "Klaviyo",
  "Stripe",
  "Salesforce",
  "HubSpot",
  "Mailchimp",
  "Facebook",
  "Instagram",
  "TikTok",
  "Amazon",
];

function findPartners(allText: string, alts: string[]): string[] {
  const out = new Set<string>();

  // 1) Known brand names present anywhere in text
  for (const b of KNOWN_BRANDS) {
    const re = new RegExp(`\\b${b}\\b`, "i");
    if (re.test(allText)) out.add(b);
  }

  // 2) ALT text often contains just the brand name
  for (const a of alts) {
    // Keep single/token-ish alts that match brand names or look like proper names
    if (a.length <= 40) {
      for (const b of KNOWN_BRANDS) {
        if (new RegExp(`^${b}$`, "i").test(a)) out.add(b);
      }
      // Generic catch: capitalized single word (e.g., "Shopify" even if not in list)
      if (/^[A-Z][A-Za-z0-9+&.\- ]{1,39}$/.test(a)) out.add(a);
    }
  }

  // Return sorted
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

function findPricing(text: string, url: string, links: string[]): { mentions: boolean; urls: string[] } {
  const inText = /\b(pricing|price|plans?|packages?)\b/i.test(text);
  const pricingLinks = links.filter((u) => /pricing|plans?(\b|\/)/i.test(u) && sameOrigin(u, url));
  return { mentions: inText || pricingLinks.length > 0, urls: Array.from(new Set(pricingLinks)) };
}

function findMetrics(text: string, maxItems = 8): string[] {
  // Look for sentences with percentages or explicit stats
  const sents = splitSentences(text);
  const metricish = sents.filter((s) => /(\d+(\.\d+)?\s?%|\b\d{2,}(,\d{3})*\b)/.test(s));

  const cleaned = metricish.map((s) =>
    cleanSpaces(
      s
        .replace(/\[[^\]]*\]/g, "")
        .replace(/…/g, "")
        .replace(/—/g, "-")
    )
  );

  // Deduplicate aggressively
  const dedup = new Map<string, string>();
  for (const c of cleaned) {
    const key = normalizeForDedup(c);
    if (!dedup.has(key)) dedup.set(key, c);
  }
  return Array.from(dedup.values()).slice(0, maxItems);
}

/** ========== Crawl (light) ========== */
async function crawlSite(startUrl: string, maxPages: number, maxDepth: number): Promise<PageSummary[]> {
  const seen = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }];
  const origin = new URL(startUrl).origin;

  const pages: PageSummary[] = [];

  while (queue.length && pages.length < maxPages) {
    const { url, depth } = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);

    const html = await fetchHTML(url);
    if (!html) continue;

    const { text, title, metas, alts } = extractTextWithAlt(html);
    const summary = cleanSpaces((metas[0] || text).slice(0, 240));
    pages.push({
      url,
      title: title || url,
      type: pageTypeFromUrl(url),
      depth,
      summary,
    });

    // Expand links if depth allows
    if (depth < maxDepth) {
      const links = extractLinks(html, url)
        .filter((u) => u.startsWith(origin))
        .slice(0, 30); // modest fan-out per page
      for (const next of links) {
        if (!seen.has(next) && queue.findIndex((q) => q.url === next) === -1) {
          queue.push({ url: next, depth: depth + 1 });
        }
      }
    }

    // small courtesy pause to avoid hammering
    await sleep(120);
  }

  return pages;
}

/** ========== Findings aggregation ========== */
function aggregateFindings(startUrl: string, pages: PageSummary[], htmlBlobs: Array<{ url: string; html: string }>): Findings {
  const texts: string[] = [];
  const titles: string[] = [];
  const altsAll: string[] = [];
  const linksAll: string[] = [];

  for (const { url, html } of htmlBlobs) {
    const { text, title, alts } = extractTextWithAlt(html);
    texts.push(text);
    if (title) titles.push(title);
    altsAll.push(...alts);
    linksAll.push(...extractLinks(html, url));
  }

  const allText = cleanSpaces(texts.join(" "));
  const title = titles[0] || "";

  const { mentions, urls: pricingUrls } = findPricing(allText, startUrl, linksAll);

  const value = pickValueProp(allText, title);
  const features = pickKeyFeatures(allText, 10);
  const partners = findPartners(allText, altsAll);
  const metrics = findMetrics(allText, 10);

  // unique URLs referenced in evidence = union of pricing URLs for now (lightweight)
  const uniqUrls = new Set<string>([...pricingUrls]);

  return {
    mentions_pricing: mentions,
    pricing_page_urls: pricingUrls,
    value_prop: value ?? null,
    key_features: features,
    partners_integrations: partners,
    noteworthy_metrics: metrics,
    coverage: {
      pages_considered: pages.length,
      unique_urls_in_evidence: uniqUrls.size || pages.length, // conservative fallback
    },
  };
}

/** ========== Main workflow ========== */
export async function runWebsiteResearchV1(inputs: WebsiteResearchInputs) {
  const start = (inputs.start_url || "").trim();
  const maxPages = Math.max(1, Math.min(Number(inputs.max_pages ?? 30), 200));
  const maxDepth = Math.max(0, Math.min(Number(inputs.max_depth ?? 2), 3));

  if (!/^https?:\/\//.test(start)) {
    return {
      id: null,
      status: "FAILED",
      inputs,
      error: "missing_required: start_url (must be http/https)",
      created_at: new Date().toISOString(),
    };
  }

  // Crawl
  const pages = await crawlSite(start, maxPages, maxDepth);

  // Re-fetch raw HTML for pages we actually kept (so findings have allText/links)
  const htmlBlobs: Array<{ url: string; html: string }> = [];
  for (const p of pages) {
    const html = await fetchHTML(p.url);
    if (html) htmlBlobs.push({ url: p.url, html });
  }

  // Findings
  const findings = aggregateFindings(start, pages, htmlBlobs);

  const outputs = {
    highlights: [
      `Crawled ${pages.length} page(s) from ${new URL(start).origin}`,
    ],
    pages,
    findings,
  };

  return {
    id: null,
    status: "SUCCEEDED",
    inputs: {
      start_url: start,
      max_pages: maxPages,
      max_depth: maxDepth,
      include_sitemap: Boolean(inputs.include_sitemap ?? false),
      questions: Array.isArray(inputs.questions) ? inputs.questions : undefined,
    },
    outputs,
    created_at: new Date().toISOString(),
  };
}
