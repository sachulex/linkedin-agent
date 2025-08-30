import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { randomUUID } from "crypto";
import { fetchStyleLocal, enforceStyleOnPost, Style } from "./style";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(bodyParser.json());

/** In-memory style blob, matches current /v1/style flat JSON behavior */
let STYLE_BLOB: Style = { voice_rules: {}, post_structure: {}, image_style: {} };

/** very small in-memory runs store */
type Run = {
  id: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  inputs: any;
  outputs?: any;
  error?: string;
  created_at: string;
};
const RUNS = new Map<string, Run>();

app.get("/healthz", (_req, res) => res.send("ok"));

/** Get current style (flat JSON) */
app.get("/v1/style", (_req, res) => {
  res.json(STYLE_BLOB || { voice_rules: {}, post_structure: {}, image_style: {} });
});

/** Upsert style (flat JSON). */
app.post("/v1/style", (req, res) => {
  const body = req.body || {};
  STYLE_BLOB = body;
  res.json({ ok: true });
});

/** Accept feedback (no-op stub) */
app.post("/v1/feedback", (_req, res) => {
  res.json({ ok: true });
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** Generate text via OpenAI */
async function generateLinkedInPost(systemPrompt: string, userPrompt: string): Promise<string> {
  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.7,
  });
  return resp.choices?.[0]?.message?.content?.trim() || "";
}

/** Build prompts grounded in Style */
function buildPromptsFromStyle(style: Style, inputs: any): { system: string; user: string } {
  const persona = style.voice_rules?.persona || "Casual yet professional, concise, human.";
  const banned = (style.voice_rules?.banned_words || []).join(", ") || "none";
  const noDashes = style.voice_rules?.formatting?.no_dashes ? "Do not use dashes." : "";
  const must = style.post_structure?.must_include_phrase;
  const focus = style.post_structure?.topic_focus;
  const cta = style.post_structure?.closing_cta;

  const system = [
    `You are a LinkedIn writing agent.`,
    `Persona: ${persona}`,
    `Banned words: ${banned}. ${noDashes}`,
    `Always ground the writing in the provided knowledge from Base44.`,
    must ? `You must include this phrase somewhere verbatim: "${must}".` : "",
    focus ? `Keep the content aligned with this topic focus: "${focus}".` : "",
    cta ? `End with this closing CTA if natural: "${cta}".` : "",
  ].filter(Boolean).join("\n");

  const user = [
    `Write a short LinkedIn post.`,
    `Audience: ${inputs?.audience || "Ecommerce founders"}`,
    `Tone: ${inputs?.tone || "casual"}`,
    `Topic: ${inputs?.topic || "update"}`,
    `Keep it concise and actionable.`
  ].join("\n");

  return { system, user };
}

/** POST /v1/runs — start a run */
app.post("/v1/runs", async (req, res) => {
  const id = randomUUID();
  const run: Run = {
    id,
    status: "PENDING",
    inputs: req.body?.inputs || {},
    created_at: new Date().toISOString()
  };
  RUNS.set(id, run);
  res.json({ run_id: id });

  (async () => {
    try {
      run.status = "RUNNING";

      // 1) Fetch freshest style
      const style = await fetchStyleLocal();

      // 2) Build prompts
      const { system, user } = buildPromptsFromStyle(style, run.inputs);

      // 3) Generate
      const rawPost = await generateLinkedInPost(system, user);

      // 4) Enforce style
      const finalPost = enforceStyleOnPost(rawPost, style);

      run.status = "SUCCEEDED";
      run.outputs = {
        post: finalPost,
        images: [],
        alt_text: "Generated LinkedIn post",
        hashtags: ["#Ecommerce", "#MarketingAutomation"],
        meta: { style_version_used: style.version || null }
      };
      RUNS.set(id, run);
    } catch (e: any) {
      run.status = "FAILED";
      run.error = e?.message || String(e);
      RUNS.set(id, run);
    }
  })();
});

/** GET /v1/runs/:id */
app.get("/v1/runs/:id", (req, res) => {
  const run = RUNS.get(req.params.id);
  if (!run) return res.status(404).json({ error: "not found" });
  res.json(run);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server on :${port}`);
});
