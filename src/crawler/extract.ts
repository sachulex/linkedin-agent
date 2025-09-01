// src/crawler/extract.ts
import OpenAI from "openai";
import { pool } from "../db";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type Entity = { type: string; value: string; confidence?: number };

// Normalization helper for entity types
function normalizeType(s: string): string {
  const k = s.trim().toLowerCase().replace(/\s+/g, "_");
  if (["integration", "integrations"].includes(k)) return "integration";
  if (["plan", "plan_name"].includes(k)) return "plan";
  if (["case_study", "case", "case_studies", "case_study_name", "case_study_brand"].includes(k)) return "case_study";
  if (["price", "pricing"].includes(k)) return "price";
  if (["product", "tool"].includes(k)) return "product";
  if (["url", "link"].includes(k)) return "url";
  return k; // fallback
}

export async function summarizeAndExtract(pageId: string, url: string, text: string) {
  // 1) Summary (exactly 2 concise sentences)
  const summaryResp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Summarize the following webpage content in exactly 2 concise sentences." },
      { role: "user", content: `URL: ${url}\n\n${text}` }
    ],
  });
  const summary = summaryResp.choices[0].message?.content?.trim() || "";

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
    const rawType = ent?.type ?? "";
    const rawValue = ent?.value ?? "";
    const t = normalizeType(rawType);
    const v = rawValue.trim();
    if (!t || !v) continue;

    await pool.query(
      `INSERT INTO page_entities (page_id, entity_type, entity_value, confidence)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (page_id, entity_type, entity_value) DO NOTHING`,
      [pageId, t, v, ent.confidence ?? null]
    );
  }

  return { summary, entities };
}
