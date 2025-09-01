// src/server.ts
import "dotenv/config";

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import OpenAI from "openai";
import crypto from "crypto";

import { upsertMemory, readMemory } from "./db";
import { fetchStyleLocal, enforceStyleOnPost, Style } from "./style";
import { runWebsiteResearchV1 } from "./workflows/website_research_v1";

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

// ===== Utils =====
function isoNow() {
  return new Date().toISOString();
}

// Conservative non empty check for Style
function isNonEmptyStyle(s: any): s is Style {
  if (!s || typeof s !== "object") return false;
  const keys = ["voice_rules", "post_structure", "image_style", "version"];
  return keys.some((k) =>
    Object.prototype.hasOwnProperty.call(s, k)
      ? k === "version" || Object.keys((s as any)[k] || {}).length > 0
      : false
  );
}

/** ===== Health ===== */
app.get("/healthz", (_req, res) => res.send("ok"));

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

/** ===== Prompt building ===== */
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
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    `Write a short LinkedIn post.`,
    `Audience: ${inputs?.audience || "Ecommerce founders"}`,
    `Tone: ${inputs?.tone || "casual"}`,
    `Topic: ${inputs?.topic || "update"}`,
    `Keep it concise and actionable.`,
  ].join("\n");

  return { system, user };
}

/** ===== Base44 Knowledge Webhook types + helpers ===== */
type Base44Payload = {
  brand?: { voice_rules?: { tone?: string; avoid_words?: string[] }; structure?: any };
  company?: { name?: string; positioning?: string };
  sales?: any;
  design?: any;
  [k: string]: any;
};

// Minimal transform so webhook can mirror to DB even if style.ts lacks helpers
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

/**
 * Verify HMAC-SHA256 over the exact raw request body.
 * Accepts Buffer (preferred) or UTF-8 string.
 */
function verifyHmac(rawBody: Buffer | string, sigHeader: string | undefined, secret: string) {
  if (!secret || !sigHeader?.startsWith("sha256=")) return false;
  const sent = sigHeader.slice(7).toLowerCase();
  const bodyBuf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");
  const calc = crypto.createHmac("sha256", secret).update(bodyBuf).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sent, "hex"), Buffer.from(calc, "hex"));
  } catch {
    return false;
  }
}

// --- Base44 merge + upsert helpers ---
const COLLECTION_KEYS = [
  "products","team","icps","customers","sales_processes","competitors","complements"
];

function isObject(x: any) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function upsertByIdOrSlug<T extends { id?: string; slug?: string }>(existing: T[] = [], incoming: T[] = []): T[] {
  const out = [...existing];
  const idxFor = (it: T) =>
    out.findIndex(x => (it.id && x.id === it.id) || (it.slug && x.slug === it.slug));
  for (const it of incoming) {
    const i = idxFor(it);
    if (i >= 0) out[i] = { ...(out[i] as any), ...(it as any) };
    else out.push(it);
  }
  return out;
}

function deepMergeBase(a: any, b: any): any {
  if (!isObject(a) || !isObject(b)) return b ?? a;
  const result: any = { ...a };
  for (const k of Object.keys(b)) {
    const av = a[k], bv = b[k];
    if (COLLECTION_KEYS.includes(k)) {
      result[k] = upsertByIdOrSlug(Array.isArray(av) ? av : [], Array.isArray(bv) ? bv : []);
    } else if (Array.isArray(av) && Array.isArray(bv)) {
      result[k] = bv; // non-collection arrays: replace
    } else if (isObject(av) && isObject(bv)) {
      result[k] = deepMergeBase(av, bv);
    } else {
      result[k] = bv;
    }
  }
  return result;
}

function mergeFullDocument(existingDoc: any, incomingDoc: any, mergeRequested: boolean) {
  return mergeRequested ? deepMergeBase(existingDoc || {}, incomingDoc || {}) : incomingDoc;
}

// Fallback: derive style_profile if client didn’t send /v1/style
function deriveStyleFromFullDocument(doc: any) {
  const bv = doc?.content?.brand_voice || {};
  const visuals = doc?.content?.brand_visuals || {};
  const colors = Array.isArray(visuals.colors) && visuals.length > 0
    ? visuals.colors.map((c: any) => c?.hex).filter(Boolean)
    : (visuals.palette || []);
  return {
    voice_rules: {
      tone_words: bv.tone_words ?? [],
      banned_words: bv.banned_words ?? [],
      phrases_to_use: bv.phrases_to_use ?? [],
      do: bv.do ?? [],
      dont: bv.dont ?? [],
      narrative_themes: bv.narrative_themes ?? []
    },
    image_style: {
      colors,
      fonts: visuals.fonts ?? [],
      imagery_style: visuals.imagery_style ?? [],
      mascot_guidelines: visuals.mascot_guidelines ?? "",
      logo_assets: visuals.logo_assets ?? [],
      meta: visuals.meta ?? { character_name: "", seed: 0 }
    }
  };
}
// --- end Base44 helpers ---


/** ===== Runs: route by workflow ===== */
app.post("/v1/runs", async (req, res) => {
  const body = (req.body as any) || {};
  const workflow: string | undefined = body.workflow;
  const inputs: any = body.inputs || {};

  try {
    // 1) Website Research (synchronous stub for now)
    if (workflow === "website_research_v1") {
      const outputs = await runWebsiteResearchV1(inputs || {});
      return res.json({
        id: null,
        status: "SUCCEEDED",
        inputs,
        outputs,
        created_at: isoNow(),
      });
    }

    // 2) Default / linkedin_post_v1
    if (!workflow || workflow === "linkedin_post_v1") {
      const style = await fetchStyleLocal(); // hits /v1/style
      const { system, user } = buildPromptsFromStyle(style, inputs);
      const rawPost = await generateLinkedInPost(system, user);
      const finalPost = enforceStyleOnPost(rawPost, style);

      return res.json({
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
    }

    // 3) Unknown workflow
    return res.status(400).json({ status: "FAILED", error: `unknown_workflow: ${workflow}` });
  } catch (e: any) {
    return res.status(500).json({ status: "FAILED", error: e?.message || String(e) });
  }
});

/** ===== Knowledge Layer: save full document (HMAC) ===== */
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

  // Parse now
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

  const orgId = (req.headers["x-org-id"] as string) || "demo";

  // Persist full knowledge doc
  await upsertMemory(orgId, "knowledge_layer", knowledge);

  // Mirror style if present
  const style = parsed?.knowledge?.style ?? parsed?.style;
  if (style) {
    await upsertMemory(orgId, "style_profile", style);
  }

  return res.json({
    ok: true,
    accepted_shape: "base44",
    updated_at: isoNow(),
  });
});

/** ===== Knowledge Layer: fetch full document ===== */
app.get("/v1/knowledge", async (req: any, res) => {
  const orgId = (req.headers["x-org-id"] as string) || "demo";
  try {
    const row = await readMemory(orgId, "knowledge_layer"); // { value: <json> } | null
    return res.json(row?.value ? { knowledge: row.value } : {});
  } catch (e) {
    console.error("knowledge read failed", e);
    return res.status(500).json({ ok: false, error: "read_failed" });
  }
});

/** ===== Style webhook: transform + mirror to DB (HMAC) ===== */
app.post("/v1/knowledge/webhook", async (req: any, res) => {
  const secret = process.env.KNOWLEDGE_WEBHOOK_SECRET;
  const sig = req.headers["x-signature-256"] as string | undefined;

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

  const orgId = (req.headers["x-org-id"] as string) || "demo";
  await upsertMemory(orgId, "style_profile", incoming);

  return res.json({ ok: true, updated_at: isoNow() });
});

/** ===== Style: DB-backed endpoints ===== */

// GET /v1/style → style_profile from DB (or sane defaults)
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

// GET /v1/style/debug → quick visibility
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

// POST /v1/style → direct write to style_profile (testing/tools)
app.post("/v1/style", async (req: any, res) => {
  try {
    const orgId = (req.headers["x-org-id"] as string) || "demo";
    const style = req.body && typeof req.body === "object" ? req.body : {};
    await upsertMemory(orgId, "style_profile", style);
    return res.json({ ok: true, updated_at: isoNow() });
  } catch (e) {
    console.error("style write failed", e);
    return res.status(500).json({ ok: false, error: "style_write_failed" });
  }
});

// ===== Start server =====
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Server on :${port}`);
});
