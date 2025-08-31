import "dotenv/config";

import { upsertMemory, readMemory } from "./db";

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { fetchStyleLocal, enforceStyleOnPost, Style } from "./style";
import OpenAI from "openai";
import crypto from "crypto";

const app = express();
app.use(cors());

// Capture RAW body for HMAC, and parse JSON
app.use(
  bodyParser.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf ? buf.toString("utf8") : "";
    },
  })
);

/** ===== In-memory style blob + metadata ===== */
let STYLE_BLOB: Style = { voice_rules: {}, post_structure: {}, image_style: {} };
let STYLE_META = {
  version: "",
  updated_at: "",
  source: "init",
};

function isoNow() { return new Date().toISOString(); }

function isNonEmptyStyle(s: any): s is Style {
  if (!s || typeof s !== "object") return false;
  const keys = ["voice_rules","post_structure","image_style","version"];
  return keys.some(k => Object.prototype.hasOwnProperty.call(s, k) && (k === "version" ? true : Object.keys(s[k] || {}).length > 0));
}

function isNewerVersion(newV?: string, oldV?: string) {
  if (!newV) return true;               // allow if new has no version (but will set one)
  if (!oldV) return true;
  // Compare ISO timestamps if they look like ISO; otherwise accept update
  const a = Date.parse(newV), b = Date.parse(oldV);
  if (!isNaN(a) && !isNaN(b)) return a >= b;
  return true;
}

/** ===== Health ===== */
app.get("/healthz", (_req, res) => res.send("ok"));

// GET /v1/style  → return DB-backed style_profile (or sane empty defaults)
app.get("/v1/style", async (req: any, res) => {
  try {
    const orgId = (req.headers["x-org-id"] as string) || "demo";
    const row = await readMemory(orgId, "style_profile"); // { value: <json> } | null
    if (row?.value) return res.json(row.value);
    return res.json({ voice_rules: {}, post_structure: {}, image_style: {} });
  } catch (e) {
    console.error("style read failed", e);
    return res.status(500).json({ ok: false, error: "style_read_failed" });
  }
});


// GET /v1/style/debug  → quick visibility into what’s stored
app.get("/v1/style/debug", async (req: any, res) => {
  try {
    const orgId = (req.headers["x-org-id"] as string) || "demo";
    const style = await readMemory(orgId, "style_profile");
    const knowledge = await readMemory(orgId, "knowledge_layer");
    return res.json({
      has_style: !!style?.value,
      has_knowledge: !!knowledge?.value,
      style_preview: style?.value ?? {},
      knowledge_meta: knowledge?.value?.meta ?? null,
    });
  } catch (e) {
    console.error("style debug failed", e);
    return res.status(500).json({ ok: false, error: "style_debug_failed" });
  }
});


// POST /v1/style  → allow direct writes to style_profile (handy for tools/tests)
app.post("/v1/style", async (req: any, res) => {
  try {
    const orgId = (req.headers["x-org-id"] as string) || "demo";
    const style = req.body && typeof req.body === "object" ? req.body : {};
    await upsertMemory(orgId, "style_profile", style);
    return res.json({ ok: true, updated_at: new Date().toISOString() });
  } catch (e) {
    console.error("style write failed", e);
    return res.status(500).json({ ok: false, error: "style_write_failed" });
  }
});

  if (!isNonEmptyStyle(incoming)) {
    return res.status(400).json({ ok: false, error: "invalid or empty style payload" });
  }

  // Ensure version exists and is monotonic
  const incomingVersion: string = incoming.version || isoNow();
  if (!isNewerVersion(incomingVersion, STYLE_META.version)) {
    return res.status(409).json({ ok: false, error: "stale style version", current_version: STYLE_META.version, incoming_version: incomingVersion });
  }

  STYLE_BLOB = { ...incoming, version: incomingVersion };
  STYLE_META = { version: incomingVersion, updated_at: isoNow(), source: req.get("x-style-source") || "manual-style" };

  res.json({ ok: true, accepted_shape: body && body.value ? "nested" : "flat", meta: STYLE_META });
});

/** ===== Feedback (stub) ===== */
app.post("/v1/feedback", (_req, res) => {
  res.json({ ok: true });
});

/** ===== OpenAI ===== */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateLinkedInPost(systemPrompt: string, userPrompt: string): Promise<string> {
  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  return resp.choices?.[0]?.message?.content?.trim() || "";
}

/** ===== Prompt building (compact → token-efficient) ===== */
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
    `Keep it concise and actionable.`,
  ].join("\n");

  return { system, user };
}

/** ===== Runs: synchronous generation using current style ===== */
app.post("/v1/runs", async (req, res) => {
  try {
    const inputs = (req.body as any)?.inputs || {};
    const style = await fetchStyleLocal(); // hits /v1/style, which is STYLE_BLOB

    const { system, user } = buildPromptsFromStyle(style, inputs);
    const rawPost = await generateLinkedInPost(system, user);
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
        meta: { style_version_used: (style as any).version || null },
      },
      created_at: isoNow(),
    });
  } catch (e: any) {
    res.status(500).json({ status: "FAILED", error: e?.message || String(e) });
  }
});

/** ===== Base44 Knowledge Webhook with HMAC over RAW body ===== */
type Base44Payload = {
  brand?: { voice_rules?: { tone?: string; avoid_words?: string[] }; structure?: any };
  company?: { name?: string; positioning?: string };
  sales?: any;
  design?: any;
  [k: string]: any;
};


/**
 * Verify HMAC-SHA256 over the exact raw request body.
 * Accepts Buffer (preferred) or UTF-8 string.
 */
function verifyHmac(rawBody: Buffer | string, sigHeader: string | undefined, secret: string) {
  if (!secret || !sigHeader?.startsWith("sha256=")) return false;

  const sent = sigHeader.slice(7).toLowerCase();

  // Use Buffer directly if provided; otherwise convert string to Buffer (UTF-8)
  const bodyBuf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");

  const calc = crypto.createHmac("sha256", secret).update(bodyBuf).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(sent, "hex"), Buffer.from(calc, "hex"));
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
    version: isoNow(),
    voice_rules: {
      persona: persona || "Casual yet professional, concise, human.",
      banned_words: banned || [],
      formatting: { no_dashes: true },
    },
    post_structure: {
      topic_focus: topic || "",
      closing_cta: "If you want the exact setup details, ask for the README.",
    },
    image_style: { enabled: false },
  };
}

// --- Knowledge Layer: save full document ---
app.post("/v1/knowledge", async (req: any, res) => {
  const secret = process.env.KNOWLEDGE_WEBHOOK_SECRET;
  const sig = req.headers["x-signature-256"] as string | undefined;

  // Raw body (set by bodyParser.verify) → Buffer
  const rawInput = (req as any).rawBody;
  const raw: Buffer = Buffer.isBuffer(rawInput)
    ? rawInput
    : Buffer.from(
        rawInput ?? (typeof req.body === "string" ? req.body : JSON.stringify(req.body || {})),
        "utf8"
      );

  if (!secret || !verifyHmac(raw, sig, secret)) {
    return res.status(401).json({ ok: false, error: "bad_hmac" });
  }

  // Safe to parse now
  let parsed: any;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).json({ ok: false, error: "invalid_json" });
  }

  const knowledge = parsed?.knowledge;
  if (!knowledge || typeof knowledge !== "object") {
    return res.status(422).json({ ok: false, error: "missing_or_invalid_knowledge" });
  }

  // Persist
  const orgId = (req.headers["x-org-id"] as string) || "demo";
  await upsertMemory(orgId, "knowledge_layer", knowledge);

  // Mirror style if present
  const style = parsed?.knowledge?.style ?? parsed?.style;
  if (style) {
    await upsertMemory(orgId, "style_profile", style);
  }

  return res.json({
    ok: true,
    accepted_shape: "base44",
    updated_at: new Date().toISOString(),
  });
});


// --- Knowledge Layer: fetch full document ---
app.get("/v1/knowledge", async (req: any, res) => {
  const orgId = (req.headers["x-org-id"] as string) || "demo";
  try {
    const row = await readMemory(orgId, "knowledge_layer"); // row is { value: <json> } | null
    return res.json(row?.value ? { knowledge: row.value } : {});
  } catch (e) {
    console.error("knowledge read failed", e);
    return res.status(500).json({ ok: false, error: "read_failed" });
  }
});


// --- Style mirror webhook (existing behavior preserved) ---
app.post("/v1/knowledge/webhook", (req: any, res) => {
  const secret = process.env.KNOWLEDGE_WEBHOOK_SECRET;
  const sig = req.headers["x-signature-256"] as string | undefined;

  // Normalize raw body into a Buffer
  const rawInput = (req as any).rawBody;
  const raw: Buffer = Buffer.isBuffer(rawInput)
    ? rawInput
    : Buffer.from(
        rawInput ?? (typeof req.body === "string" ? req.body : JSON.stringify(req.body || {})),
        "utf8"
      );

  if (!secret || !verifyHmac(raw, sig, secret)) {
    return res.status(401).json({ ok: false, error: "invalid signature" });
  }

  const payload = (req.body || {}) as Base44Payload;
  const incoming = transformBase44ToStyle(payload);

  if (!isNonEmptyStyle(incoming)) {
    return res.status(400).json({ ok: false, error: "transformed style is empty" });
  }

  // Monotonic version guard (preserves your previous semantics)
  const incomingVersion = (incoming as any).version || isoNow();
  if (!isNewerVersion(incomingVersion, STYLE_META.version)) {
    return res.status(409).json({
      ok: false,
      error: "stale style version",
      current_version: STYLE_META.version,
      incoming_version: incomingVersion
    });
  }

  STYLE_BLOB = { ...incoming, version: incomingVersion };
  STYLE_META = { version: incomingVersion, updated_at: isoNow(), source: "base44" };

  return res.json({
    ok: true,
    accepted_shape: "base44",
    mapped_to: "style",
    meta: STYLE_META
  });
});



const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server on :${port}`);
});
