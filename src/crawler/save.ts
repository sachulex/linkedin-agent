import type { CrawlResult, PageRecord } from "./types";
import { pool } from "../db";
import { classifyPage } from "./pageClassifier";

/**
 * Persists a crawl:
 * - site_crawls(start_url, status, max_pages, max_depth, include_sitemap, created_at, completed_at, id)
 * - site_pages(id, crawl_id, url, status_code, depth, page_type, title, meta_description, content, language, created_at, type_confidence, ...)
 */
export async function saveCrawl(startUrl: string, res: CrawlResult) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const crawl = await client.query(
      `INSERT INTO site_crawls (start_url, status, completed_at)
       VALUES ($1, $2, now())
       RETURNING id`,
      [startUrl, "completed"]
    );
    const crawlId: string = crawl.rows[0].id;

    if (res.pages.length) {
      const values: any[] = [];
      const chunks: string[] = [];

      // Insert 11 columns per row:
      // (crawl_id, url, status_code, depth, page_type, title, meta_description, content, language, created_at, type_confidence)
      res.pages.forEach((p: PageRecord, i: number) => {
        const { type, confidence } = classifyPage(p.url, p.title ?? "", p.text ?? "");

        const base = i * 11;
        chunks.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11})`
        );

        values.push(
          crawlId,                 // 1: crawl_id
          p.url,                   // 2: url
          p.status ?? null,        // 3: status_code
          p.depth ?? null,         // 4: depth
          type,                    // 5: page_type
          p.title ?? null,         // 6: title
          p.metaDescription ?? null, // 7: meta_description
          p.text ?? null,          // 8: content (raw HTML for now)
          p.language ?? null,      // 9: language
          p.fetchedAt,             // 10: created_at
          confidence ?? null       // 11: type_confidence
        );
      });

      await client.query(
        `
        INSERT INTO site_pages
          (crawl_id, url, status_code, depth, page_type, title, meta_description, content, language, created_at, type_confidence)
        VALUES
          ${chunks.join(",")}
        ON CONFLICT (crawl_id, url) DO UPDATE
        SET
          status_code     = EXCLUDED.status_code,
          depth           = EXCLUDED.depth,
          page_type       = EXCLUDED.page_type,
          title           = EXCLUDED.title,
          meta_description= EXCLUDED.meta_description,
          content         = EXCLUDED.content,
          language        = EXCLUDED.language,
          type_confidence = EXCLUDED.type_confidence
        `,
        values
      );
    }

    await client.query("COMMIT");
    return { crawlId };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
