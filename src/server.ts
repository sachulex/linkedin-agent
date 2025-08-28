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
  setImmediate(() => runLinkedInAgent(runId, inputs).catch(async (e) => {
    await query("update runs set status='FAILED', outputs=$2 where id=$1", [runId, { error: String(e) }]);
  }));

  res.json({ run_id: runId });
});

// get run
app.get("/v1/runs/:id", async (req, res) => {
  const r = await query("select id, status, inputs, outputs, created_at from runs where id=$1", [req.params.id]);
  if (r.rows.length === 0) return res.status(404).json({ error: "not found" });
  res.json(r.rows[0]);
});

// feedback
app.post("/v1/feedback", async (req, res) => {
  const { run_id, items } = req.body || {};
  if (!run_id || !Array.isArray(items)) return res.status(400).json({ error: "bad body" });
  for (const it of items) {
    await query(
      "insert into feedback(run_id,target,dimension,score,note) values($1,$2,$3,$4,$5)",
      [run_id, it.target, it.dimension, it.score, it.note || null]
    );
  }
  // simple learning: if tone < 3, add avoid words
  const badTone = items.find((i: any) => i.dimension === "tone" && i.score < 3);
  if (badTone) {
    await query(
      `insert into style_memories(org_id,key,value,weight)
       values('demo','avoid_words', $1, 1)`,
      [JSON.stringify(["boost","ultimate","insane"])]
    );
  }
  res.json({ ok: true });
});

const port = Number(process.env.PORT || 8080);
initDb().then(() => {
  app.listen(port, () => console.log("Server on http://localhost:" + port));
});
