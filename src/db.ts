// src/db.ts
import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Generic query helper (used by agent.ts / knowledge.ts)
export function query<T = any>(text: string, params?: any[]) {
  return pool.query(text, params);
}

// Upsert JSON by (org_id, key)
export async function upsertMemory(orgId: string, key: string, value: any) {
  const sql = `
    INSERT INTO style_memories (org_id, key, value, updated_at)
    VALUES ($1, $2, $3, now())
    ON CONFLICT (org_id, key)
    DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
  await pool.query(sql, [orgId, key, value]);
}

// Read JSON by (org_id, key)
export async function readMemory(orgId: string, key: string) {
  const { rows } = await pool.query(
    "SELECT value FROM style_memories WHERE org_id = $1 AND key = $2 LIMIT 1",
    [orgId, key]
  );
  return rows[0] ?? null; // { value: <json> } | null
}
