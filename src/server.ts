// src/server.ts
import "dotenv/config";
import express from "express";
import knowledgeRouter from './knowledge';
import cors from "cors";
import { z } from "zod";
import { initDb, query } from "./db";
import { getKnowledgePacks } from "./knowledgeClient";
import { runLinkedInAgent } from "./agent";
import OpenAI from "openai";
import promptContextRoute from "./promptContextRoute";
import packsRoute from "./packsRoute";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
// Inline prompt context route
app.get("/v1/prompt-context", async (req, res) => {
  try {
    const select = String(req.query.select || "brand,company,design")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const { version, checksum, packs } = await getKnowledgePacks(select);
    const context = JSON.stringify(packs, null, 2);
    res.json({ version, checksum, context, packs });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});
app.use(promptContextRoute);
app.use(packsRoute);
app.use(knowledgeRouter);

app.get("/healthz", (_req, res) => res.send("ok"));

// ---------- RUNS ----------
const RunInput = z.object({
  workflow: z.string().default("linkedin_post_v1"),
  inputs: z.object({
    topic: z.string(),
    audience: z.string().optional(),
    tone: z.string().optional(),
    length: z.string().optional(),
    image_count: z.number().optional(),
    seed: z.number().optional()
  })
});

// start a run
app.post("/v1/runs", async (req, res) => {
  const parsed = RunInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);

  const { inputs } = parsed.data;
  const r = await query<{ id: string }>(
    "insert into runs(status,inputs) values('RUNNING',$1) returning id",
    [inputs]
  );
  const runId = r.rows[0].id;

  // fire-and-forget worker
  setImmediate(() =>
    runLinkedInAgent(runId, inputs).catch(async (e) => {
      await query("update runs set status='FAILED', outputs=$2 where id=$1", [
        runId,
        { error: String(e) },
      ]);
    })
  );

  res.json({ run_id: runId });
});

// get run
app.get("/v1/runs/:id", async (req, res) => {
  const r = await query("select id, status, inputs, outputs, created_at from runs where id=$1", [req.params.id]);
  if (r.rows.length === 0) return res.status(404).json({ error: "not found" });
  res.json(r.rows[0]);
});

// ---------- FEEDBACK ----------
app.post("/v1/feedback", async (req, res) => {
  const { run_id, items } = req.body || {};
  if (!run_id || !Array.isArray(items)) return res.status(400).json({ error: "bad body" });
  for (const it of items) {
    await query(
      "insert into feedback(run_id,target,dimension,score,note) values($1,$2,$3,$4,$5)",
      [run_id, it.target, it.dimension, it.score, it.note || null]
    );
  }
  // simple learning: if tone < 3, add some words to avoid next time
  const badTone = items.find((i: any) => i.dimension === "tone" && i.score < 3);
  if (badTone) {
    await query(
      `insert into style_memories(org_id,key,value,weight)
       values('demo','avoid_words', $1, 1)
       on conflict (org_id, key) do update set value = excluded.value, updated_at = now()`,
      [JSON.stringify(["boost","ultimate","insane"])]
    );
  }
  res.json({ ok: true });
});

// ---------- STYLE (NEW) ----------
const StyleBody = z.object({
  voice_rules: z.record(z.any()).default({}),
  post_structure: z.record(z.any()).default({}),
  image_style: z.record(z.any()).default({})
});

// GET style profile
app.get("/v1/style", async (_req, res) => {
  // defaults
  const profile: any = {
    voice_rules: { avoid_words: ["boost"], prefer_words: ["profit clarity"] },
    post_structure: { hook: true, one_liners: true },
    image_style: { character_name: "Brand Mascot", palette: ["#ea43e3","#43eae4"], seed: 12345 }
  };

  const r = await query<{ key: string; value: any }>(
    "select key, value from style_memories where org_id=$1 and key in ('voice_rules','post_structure','image_style')",
    ["demo"]
  );
  for (const row of r.rows) {
    (profile as any)[row.key] = row.value;
  }
  res.json(profile);
});

// POST style profile (upsert)
app.post("/v1/style", async (req, res) => {
  const parsed = StyleBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });

  const { voice_rules, post_structure, image_style } = parsed.data;

  // ensure we have a unique index for upserts (idempotent)
  await query(`create unique index if not exists style_memories_org_key_unique on style_memories(org_id, key);`);

  // upsert each key
  const upsert = async (key: string, value: any) => {
    await query(
      `insert into style_memories (org_id, key, value, weight, updated_at)
       values ('demo', $1, $2, 1, now())
       on conflict (org_id, key) do update set value = excluded.value, updated_at = now()`,
      [key, JSON.stringify(value)]
    );
  };

  await upsert("voice_rules", voice_rules || {});
  await upsert("post_structure", post_structure || {});
  await upsert("image_style", image_style || {});

  res.json({ ok: true });
});


// ---------- GENERIC WRITER ----------
const WriteBody = z.object({
  type: z.enum(['blog','webpage','sales']),
  topic: z.string(),
  audience: z.string().optional(),
  tone: z.string().optional(),
  length: z.string().optional()
});

async function getPromptPacks(select: string[] = ['brand','company','design']) {
  const r = await query("select version, checksum, data from knowledge_state where org_id=$1", ['demo']);
  const row = r.rows[0] || { version: 1, checksum: 'sha256:default', data: {} };
  const d: any = row.data || {};
  const packs: any = {};

  if (select.includes('brand')) {
    packs.brand = {
      rules: d.brand?.voice_rules || {},
      structure: d.brand?.post_structure || {}
    };
  }
  if (select.includes('company')) {
    packs.company = {
      name: d.company?.name || 'Bark AI',
      positioning: d.company?.positioning || 'Profit clarity for ecommerce',
      proof_points: d.company?.proof_points || []
    };
  }
  if (select.includes('design')) {
    packs.design = { image: d.design?.image_style || {} };
  }
  return { version: row.version, checksum: row.checksum, packs };
}

function systemFor(type: 'blog'|'webpage'|'sales', packs: any) {
  const tone = packs.brand?.rules?.tone || 'casual professional';
  const avoid = (packs.brand?.rules?.avoid_words || []).join(', ');
  const comp = packs.company || {};
  return [
    `You are a senior ${type} writer.`,
    `Follow brand voice:\n- tone: ${tone}\n- avoid_words: ${avoid || 'none'}`,
    `Company context:\n- name: ${comp.name || ''}\n- positioning: ${comp.positioning || ''}\n- proof_points: ${(comp.proof_points || []).join(' • ')}`,
    `Rules:\n- Be specific, clear, and helpful.\n- No hype. No empty superlatives.\n- Use short paragraphs and scannable structure.\n- Include a clear call-to-action when relevant.`
  ].join('\\n\\n');
}
function userFor(type: 'blog'|'webpage'|'sales', topic: string, audience?: string, length?: string) {
  const want = (length || 'short').toLowerCase();
  if (type === 'blog') {
    return `Write a blog post draft about: "${topic}". Audience: ${audience || 'Ecommerce founders'}. Length: ${want}. Provide: title, intro, 3-5 skimmable sections with takeaways, and a one-line CTA.`;
  }
  if (type === 'webpage') {
    return `Write a simple landing page section set about: "${topic}". Audience: ${audience || 'Ecommerce leaders'}. Length: ${want}. Provide: H1, subhead, 3 value bullets, proof point line, CTA.`;
  }
  return `Write a concise sales pitch about: "${topic}". Audience: ${audience || 'Ecommerce founders'}. Length: ${want}. Use the frame: Problem → Insight → Outcome → CTA.`;
}

const __oa = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

app.post("/v1/write", async (req, res) => {
  try {
    const parsed = WriteBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const { type, topic, audience, tone, length } = parsed.data;

    const { version, checksum, packs } = await getPromptPacks(['brand','company']);
    const sys = systemFor(type as any, packs) + (tone ? ('\n\nOverride tone for this piece: '+tone) : '');
    const usr = userFor(type as any, topic, audience, length);

    const resp = await __oa.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: usr }
      ]
    });
    const content = resp.choices[0]?.message?.content || "";
    res.json({ type, version, checksum, packs, content });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---------- START ----------
const port = Number(process.env.PORT || 8080);
initDb().then(() => {
  app.listen(port, () => console.log("Server on http://localhost:" + port));
});

// mount packsRoute
