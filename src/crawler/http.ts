// src/crawler/http.ts

export const USER_AGENT =
  process.env.CRAWLER_UA ??
  "WebsiteResearchBot/0.1 (+https://linkedin-agent-kozf.onrender.com)";

export type FetchResult = {
  ok: boolean;
  status: number;
  url: string; // final URL after redirects
  contentType: string;
  html?: string; // present for text/html
  bytes?: Buffer; // present for non-HTML responses
  headers: Record<string, string>;
  error?: string;
};

/**
 * Normalize a URL for consistent deduping.
 * - lowercases host
 * - removes fragment
 * - strips default ports
 * - collapses duplicate slashes
 */
export function normalizeUrl(input: string): string {
  const u = new URL(input);
  u.hostname = u.hostname.toLowerCase();
  u.hash = "";
  if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) {
    u.port = "";
  }
  u.pathname = u.pathname.replace(/\/{2,}/g, "/");
  return u.toString();
}

/**
 * Minimal fetch wrapper with timeout and content-type handling.
 * Uses Node's global fetch (Node 18+).
 */
export async function fetchPage(inputUrl: string, timeoutMs = 15000): Promise<FetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(inputUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        "accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    const headersObj: Record<string, string> = {};
    res.headers.forEach((v, k) => (headersObj[k] = v));

    const finalUrl = res.url;
    const contentType = res.headers.get("content-type") ?? "";

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        url: finalUrl,
        contentType,
        headers: headersObj,
        error: `HTTP ${res.status}`,
      };
    }

    // If HTML, return text. Otherwise, return bytes.
    if (contentType.includes("text/html") || contentType.includes("application/xhtml+xml")) {
      const html = await res.text();
      return {
        ok: true,
        status: res.status,
        url: finalUrl,
        contentType,
        html,
        headers: headersObj,
      };
    } else {
      const ab = await res.arrayBuffer();
      return {
        ok: true,
        status: res.status,
        url: finalUrl,
        contentType,
        bytes: Buffer.from(ab),
        headers: headersObj,
      };
    }
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      url: inputUrl,
      contentType: "",
      headers: {},
      error: err?.message ?? String(err),
    };
  } finally {
    clearTimeout(timeout);
  }
}
