// src/server.ts
import "dotenv/config";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { initDb, query } from "./db";
import { runLinkedInAgent } from "./agent";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

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

// ---------- START ----------
const port = Number(process.env.PORT || 8080);
initDb().then(() => {
  app.listen(port, () => console.log("Server on http://localhost:" + port));
});
