// src/agent.ts
import OpenAI from "openai";
import { query } from "./db";
import { buildPostSystemPrompt, buildImagePrompt } from "./prompts";
import { getPacksLocal } from "./knowledge";
import { runWebsiteResearchV1 } from "./workflows/website_research_v1";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// merge style memories from DB with a simple base
async function loadStyle(orgId: string) {
  const res = await query<{ key: string; value: any }>(
    "select key, value from style_memories where org_id=$1",
    [orgId]
  );
  const base: any = {
    avoid_words: ["boost"],
    prefer_words: ["profit clarity"],
    image_seed: 12345,
    palette: ["#ea43e3", "#43eae4"],
    character_name: "Brand Mascot"
  };
  for (const row of res.rows) base[row.key] = row.value;
  return base;
}

export async function runLinkedInAgent(runId: string, inputs: any) {
  const orgId = "demo";
  const style = await loadStyle(orgId);
  const { version: kVer, checksum: kCS, packs } = await getPacksLocal(["brand","company","design","sales","product"]);
  const knowledgeContext = `KNOWLEDGE PACKS v${kVer} ${kCS}\n` + JSON.stringify(packs);
  const palette = (packs.design?.image?.palette && packs.design.image.palette.length ? packs.design.image.palette : style.palette);
  const character_name = packs.design?.image?.character_name || style.character_name;

  // 1) Draft post
  const systemPrompt = `${buildPostSystemPrompt(style)}\n\n---\nUse this organization knowledge when writing:\n${knowledgeContext}`;
  const userPrompt = JSON.stringify({
    audience: inputs.audience || "Ecommerce founders",
    tone: inputs.tone || "casual yet professional",
    length: inputs.length || "short",
    topic: inputs.topic
  });

  const postResp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.7,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Using this topic and settings: ${userPrompt}` }
    ]
  });

  const raw = postResp.choices[0]?.message?.content || "";
  const match = raw.match(/\{[\s\S]*\}$/);
  let postJson: any = { post: raw, alt_text: "", hashtags: ["#AI", "#Ecommerce", "#Marketing"] };
  if (match) {
    try { postJson = JSON.parse(match[0]); } catch {}
  }

  // 2) Images (0..3) — skip if count is 0
  const count = Math.min(Math.max(Number(inputs.image_count ?? 1), 0), 3);
  const seed = Number(inputs.seed ?? style.image_seed ?? 12345);
  const images: string[] = [];

  if (count > 0) {
    for (let i = 0; i < count; i++) {
      const prompt = buildImagePrompt(character_name, palette, seed + i, inputs.topic);
      const img = await client.images.generate({
        model: "gpt-image-1",
        prompt,
        size: "1024x1024"
      });
      const b64 = img.data[0].b64_json!;
      images.push(`data:image/png;base64,${b64}`);
    }
  }
  /* POSITIONING_ENFORCE */
try {
  const base = process.env.INTERNAL_ORIGIN || ('http://127.0.0.1:' + (process.env.PORT || 8080));
  const r: any = await (globalThis as any).fetch(base + '/v1/packs?select=company');
  if (r && r.ok) {
    const j: any = await r.json().catch(() => ({}));
    const positioning: string = (j && j.packs && j.packs.company && j.packs.company.positioning) || '';
    if (positioning) {
      const present = String(postJson.post || '').toLowerCase().includes(positioning.toLowerCase());
      if (!present) {
        const SEP = String.fromCharCode(10) + String.fromCharCode(10);
        postJson.post = [String(postJson.post || '').trim(), positioning].filter(Boolean).join(SEP);
      }
    }
  }
} catch {}
/* /POSITIONING_ENFORCE */

  const outputs = {    post: postJson.post,
    alt_text: postJson.alt_text || "Illustration for the post",
    hashtags: postJson.hashtags || ["#AI", "#Ecommerce", "#Marketing"],
    images
  };

  await query("update runs set status='SUCCEEDED', outputs=$2 where id=$1", [runId, outputs]);
  return outputs;
}
