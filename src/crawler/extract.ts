// src/crawler/extract.ts
import OpenAI from "openai";
import { pool } from "../db";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type Entity = { type: string; value: string; confidence?: number };

// --- helpers ---
function normalizeType(s: string): string {
  const k = s.trim().toLowerCase().replace(/\s+/g, "_");
  if (["integration", "integrations"].includes(k)) return "integration";
  if (["plan", "plan_name"].includes(k)) return "plan";
  if (["case_study", "case", "case_studies", "case_study_name", "case_study_brand"].includes(k)) return "case_study";
  if (["price", "pricing"].includes(k)) return "price";
  if (["product", "tool"].includes(k)) return "product";
  if (["url", "link"].includes(k)) return "url";
  if (["team_member", "teammember", "team"].includes(k)) return "team_member";
  return k; // fallback
}

function looksLikePrice(s: string): boolean {
  const v = s.trim();
  // Matches $1,234.56 | 123.45 | €99 | £12.50 | 99 | 99.00 (basic, pragmatic)
  return /^[$€£]?\d{1,3}(?:,\d{3})*(?:\.\d{2})?$|^[$€£]?\d+(?:\.\d{2})?$/.test(v);
}

function cap(str: string, n = 600): string {
  return str.length > n ? str.slice(0, n) : str;
}
// --- end helpers ---

export async function summarizeAndExtract(pageId: string, url: string, text: string) {
  // 1) Summary (exactly 2 concise sentences)
  const summaryResp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Summarize the following webpage content in exactly 2 concise sentences." },
      { role: "user", content: `URL: ${url}\n\n${text}` }
    ],
  });

  // Cap length to avoid verbose summaries slipping in
  const rawSummary = summaryResp.choices[0].message?.content?.trim() || "";
  const summary = cap(rawSummary, 600);

  // 2) Entities (products, integrations, plans, prices)
  const entityResp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Extract structured entities from webpage content. Be concise." },
      {
        role: "user",
        content:
`Extract entities from this page. Capture product names, integrations, plan names, and price points.

Return JSON array like:
[{"type":"product","value":"X"},{"type":"price","value":"$99"}]

Content:
${text}`
      }
    ],
    response_format: { type: "json_object" },
  });

  let entities: Entity[] = [];
  try {
    const raw = entityResp.choices[0].message?.content || "{}";
    const parsed = JSON.parse(raw);
    entities = Array.isArray(parsed) ? parsed : (parsed.entities ?? []);
  } catch (e) {
    console.error("Failed to parse entities", e);
  }

  // Save summary
  await pool.query(`UPDATE site_pages SET summary = $1 WHERE id = $2`, [summary, pageId]);

  // Save entities (idempotent via unique index on page_id, entity_type, entity_value)
  for (const ent of entities) {
    const t = normalizeType(ent?.type ?? "");
    const v = (ent?.value ?? "").trim();
    if (!t || !v) continue;

    // Guard against bogus price values (ignore "N/A", "$0" unless you really want it, etc.)
    if (t === "price" && !looksLikePrice(v)) continue;

    const conf = typeof ent?.confidence === "number" ? ent.confidence! : null;

    await pool.query(
      `INSERT INTO page_entities (page_id, entity_type, entity_value, confidence)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (page_id, entity_type, entity_value) DO NOTHING`,
      [pageId, t, v, conf]
    );
  }

  return { summary, entities };
}
