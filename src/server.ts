import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { fetchStyleLocal, enforceStyleOnPost, Style } from "./style";
import OpenAI from "openai";
import crypto from "crypto";

const app = express();
app.use(cors());
app.use(bodyParser.json());

/** In-memory style blob, flat JSON (as proven by /v1/style behavior) */
let STYLE_BLOB: Style = { voice_rules: {}, post_structure: {}, image_style: {} };

/** Basic health */
app.get("/healthz", (_req, res) => res.send("ok"));

/** Read current style (flat JSON) */
app.get("/v1/style", (_req, res) => {
  res.json(STYLE_BLOB || { voice_rules: {}, post_structure: {}, image_style: {} });
});

/** Upsert style — accepts both flat and nested { value: {...} } */
app.post("/v1/style", (req, res) => {
  const body = req.body || {};
  const incoming = body && typeof body === "object" && body.value && typeof body.value === "object" ? body.value : body;
  if (!incoming || typeof incoming !== "object") {
    return res.status(400).json({ ok: false, error: "invalid style payload" });
  }
  STYLE_BLOB = incoming;
  res.json({ ok: true, accepted_shape: body && body.value ? "nested" : "flat" });
});

/** Feedback (stub to keep API contract) */
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

/** POST /v1/runs — synchronous: fetches style, generates, enforces, returns */
app.post("/v1/runs", async (req, res) => {
  try {
    const inputs = req.body?.inputs || {};

    // Fetch freshest style from our own /v1/style (mirror of Base44)
    const style = await fetchStyleLocal();

    // Build prompts
    const { system, user } = buildPromptsFromStyle(style, inputs);

    // Generate
    const rawPost = await generateLinkedInPost(system, user);

    // Enforce style
    const finalPost = enforceStyleOnPost(rawPost, style);

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
    res.status(500).json({ status: "FAILED", error: e?.message || String(e) });
  }
});

/* =======================
   Base44 Knowledge Webhook
   ======================= */

type Base44Payload = {
  brand?: { voice_rules?: { tone?: string; avoid_words?: string[] }, structure?: any };
  company?: { name?: string; positioning?: string };
  sales?: any;
  design?: any;
  [k: string]: any;
};

function verifyHmac(raw: string, sigHeader: string | undefined, secret: string | undefined): boolean {
  if (!secret) return true; // if no secret configured, skip verification (dev mode)
  if (!sigHeader) return false;
  const m = sigHeader.match(/^sha256=(.+)$/i);
  if (!m) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(m[1], "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

function transformBase44ToStyle(p: Base44Payload): Style {
  const voice = p?.brand?.voice_rules || {};
  const company = p?.company || {};
  const persona = voice.tone ? String(voice.tone) : undefined;
  const banned = Array.isArray(voice.avoid_words) ? voice.avoid_words : undefined;
  const topic = company.positioning || undefined;

  return {
    version: new Date().toISOString(),
    voice_rules: {
      persona: persona || "Casual yet professional, concise, human.",
      banned_words: banned || [],
      formatting: { no_dashes: true }
    },
    post_structure: {
      topic_focus: topic || "",
      closing_cta: "If you want the exact setup details, ask for the README."
    },
    image_style: { enabled: false }
  };
}

// Use express.raw for signature verification; keep a parallel JSON parser route
app.post(["/v1/knowledge", "/v1/knowledge/webhook"], express.raw({ type: "application/json" }), (req: any, res) => {
  const secret = process.env.KNOWLEDGE_WEBHOOK_SECRET;
  const sig = req.headers["x-signature-256"] as string | undefined;
  const raw = req.body?.toString?.() ?? req.body; // Buffer from express.raw

  const rawStr = typeof raw === "string" ? raw : JSON.stringify(raw || {});
  if (!verifyHmac(rawStr, sig, secret)) {
    return res.status(401).json({ ok: false, error: "invalid signature" });
  }

  let payload: Base44Payload;
  try {
    payload = typeof raw === "string" ? JSON.parse(raw || "{}") : raw;
  } catch {
    return res.status(400).json({ ok: false, error: "invalid JSON" });
  }

  const style = transformBase44ToStyle(payload || {});
  STYLE_BLOB = style;

  return res.json({ ok: true, accepted_shape: "base44", mapped_to: "style", version: style.version });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server on :${port}`);
});
