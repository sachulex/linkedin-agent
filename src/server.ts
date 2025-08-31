import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { fetchStyleLocal, enforceStyleOnPost, Style } from "./style";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(bodyParser.json());

/** In-memory style blob, flat JSON (as proven by your /v1/style behavior) */
let STYLE_BLOB: Style = { voice_rules: {}, post_structure: {}, image_style: {} };

app.get("/healthz", (_req, res) => res.send("ok"));

/** Get current style (flat JSON) */
app.get("/v1/style", (_req, res) => {
  res.json(STYLE_BLOB || { voice_rules: {}, post_structure: {}, image_style: {} });
});

/** Upsert style (flat JSON) */
app.post("/v1/style", (req, res) => {
  const body = req.body || {};
  // Accept both shapes:
  // 1) Flat:    { voice_rules, post_structure, image_style, version? }
  // 2) Nested:  { org_id, key:"style", value:{ ...flat... } }
  const incoming = (body && typeof body === "object" && body.value && typeof body.value === "object") ? body.value : body;
  // Basic validation: must at least be an object
  if (!incoming || typeof incoming !== "object") {
    return res.status(400).json({ ok: false, error: "invalid style payload" });
  }
  STYLE_BLOB = incoming;
  res.json({ ok: true, accepted_shape: body && body.value ? "nested" : "flat" });
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

/** POST /v1/runs — synchronous: returns finished post */
app.post("/v1/runs", async (req, res) => {
  try {
    const inputs = req.body?.inputs || {};

    // 1) Fetch freshest style from our own /v1/style (mirror of Base44)
    const style = await fetchStyleLocal();

    // 2) Build prompts
    const { system, user } = buildPromptsFromStyle(style, inputs);

    // 3) Generate
    const rawPost = await generateLinkedInPost(system, user);

    // 4) Enforce style (banned words, no dashes, must include phrase, topic focus, CTA)
    const finalPost = enforceStyleOnPost(rawPost, style);

    // 5) Return finished result now
    res.json({
      id: null,
      status: "SUCCEEDED",
      inputs,
      outputs: {
        post: finalPost,
        images: [],
        alt_text: "Generated LinkedIn post",
        hashtags: ["#Ecommerce", "#MarketingAutomation"],
        meta: { style_version_used: style.version || null }
      },
      created_at: new Date().toISOString()
    });
  } catch (e: any) {
    res.status(500).json({
      status: "FAILED",
      error: e?.message || String(e)
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server on :${port}`);
});
