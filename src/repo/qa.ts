// src/repo/qa.ts
import { Pool } from "pg";
import { QAAnswer } from "../crawler/types";

// Local pool so this module is self-contained.
// Neon needs SSL; local dev doesn't.
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

/**
 * Save a batch of Q&A answers for a crawl.
 * Expects confidence as 'high' | 'medium' | 'low' and evidence as [{url, snippet}]
 * Note: This does plain INSERTs (no upsert) because there's no unique constraint
 * on (crawl_id, question) in your schema. If you add one later, we can switch to ON CONFLICT.
 */
export async function saveQAAnswers(crawlId: string, qa: QAAnswer[]) {
  if (!crawlId || !Array.isArray(qa) || qa.length === 0) return;

  const sql = `
    INSERT INTO qa_answers (crawl_id, question, answer, confidence, evidence)
    VALUES ($1, $2, $3, $4, $5)
  `;

  for (const item of qa) {
    await query(sql, [
      crawlId,
      item.question,
      item.answer,
      item.confidence, // 'high' | 'medium' | 'low'
      JSON.stringify(item.evidence ?? []),
    ]);
  }
}

/** Fetch all Q&A for a crawl, oldest first (useful for debug/UI) */
export async function getQAForCrawl(crawlId: string) {
  const res = await query(
    `SELECT id, crawl_id, question, answer, confidence, evidence, created_at
     FROM qa_answers
     WHERE crawl_id = $1
     ORDER BY created_at ASC`,
    [crawlId]
  );
  return (res.rows as any[]) || [];
}
