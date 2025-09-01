// src/repo/crawl.ts
import { Pool } from "pg";
import { PageRecord } from "../crawler/types";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("neon.tech")
    ? { rejectUnauthorized: false }
    : undefined,
});

async function query<T = any>(text: string, params?: any[]) {
  const client = await pool.connect();
  try {
    const res = await client.query<T>(text, params);
    return res;
  } finally {
    client.release();
  }
}

export async function getLatestCrawlByStartUrl(startUrl: string): Promise<string | null> {
  // Exact match first
  let res = await query<{ id: string }>(
    `SELECT id FROM site_crawls
     WHERE start_url = $1
     ORDER BY created_at DESC NULLS LAST
     LIMIT 1`,
    [startUrl]
  );
  if (res.rows?.[0]?.id) return String(res.rows[0].id);

  // Fallback: prefix match
  res = await query<{ id: string }>(
    `SELECT id FROM site_crawls
     WHERE start_url ILIKE $1 || '%'
     ORDER BY created_at DESC NULLS LAST
     LIMIT 1`,
    [startUrl]
  );
  return res.rows?.[0]?.id ? String(res.rows[0].id) : null;
}

// --- helpers to map flexible schemas ---
function pickFirst<T = any>(row: any, keys: string[], fallback?: T): T | undefined {
  for (const k of keys) {
    if (k in row && row[k] !== null && row[k] !== undefined) return row[k] as T;
  }
  return fallback;
}
function toNum(v: any, def: number | null = null): number | null {
  if (v === null || v === undefined) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

/**
 * Load pages for a crawl and map to PageRecord, tolerating column name drift.
 * We select * and then pick likely column variants.
 */
export async function getPagesForCrawl(crawlId: string, limit = 200): Promise<PageRecord[]> {
  const res = await query<any>(
    `SELECT * FROM site_pages
     WHERE crawl_id = $1 AND url IS NOT NULL
     ORDER BY COALESCE(depth, 0) ASC, url ASC
     LIMIT $2`,
    [crawlId, limit]
  );

  const out: PageRecord[] = [];
  for (const r of res.rows || []) {
    const url = pickFirst<string>(r, ["url", "page_url", "link"]);
    if (!url) continue;

    const depth = toNum(pickFirst(r, ["depth", "crawl_depth"]), 0) ?? 0;

    const status = toNum(pickFirst(r, ["status", "http_status", "code"]), null);

    const contentType = pickFirst<string>(r, ["content_type", "mime", "mimetype", "contenttype"]);

    const title = pickFirst<string>(r, ["title", "page_title", "h1"]);

    const text = pickFirst<string>(r, ["text", "content", "body", "plaintext", "plain_text", "extracted_text"]);

    const fetchedAtRaw =
      pickFirst<string>(r, ["fetched_at", "crawled_at", "created_at", "updated_at"]) || new Date().toISOString();
    const fetchedAt = new Date(fetchedAtRaw).toString() === "Invalid Date"
      ? new Date().toISOString()
      : new Date(fetchedAtRaw).toISOString();

    const parentUrl = pickFirst<string | null>(r, ["parent_url", "parent", "referrer"], null) ?? null;

    out.push({
      url,
      depth,
      status,
      contentType,
      title,
      text,
      fetchedAt,
      parentUrl,
    });
  }

  return out;
}
