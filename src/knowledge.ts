import { Router, Request, Response } from "express";
import { createHash } from "crypto";

type KnowledgeData = {
  brand?: any;
  design?: any;
  company?: any;
  product?: any;
  sales?: any;
};

let version = 1;
let data: KnowledgeData = {
  brand: { voice_rules: {}, post_structure: {} },
  design: { image_style: {} },
  company: { name: "Bark AI", positioning: "" },
};

const checksumOf = (d: any) =>
  "sha256:" + createHash("sha256").update(JSON.stringify(d)).digest("hex");

let checksum = checksumOf(data);

const pick = (obj: any, keys: string[]) => {
  const out: any = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
};

const router = Router();

router.get("/v1/knowledge", (req: Request, res: Response) => {
  const selectParam = (req.query.select as string | undefined) || "";
  const select = selectParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let payload = data;
  if (select.length) payload = pick(data as any, select);

  const etag = checksum;
  const inm = req.header("if-none-match");
  if (inm && inm === etag) return res.status(304).end();

  res.setHeader("ETag", etag);
  res.json({
    version,
    checksum,
    updated_at: new Date().toISOString(),
    data: payload,
  });
});

router.get("/v1/knowledge/diff", (req: Request, res: Response) => {
  const since = parseInt(String(req.query.since ?? "0"), 10);
  if (!since || since >= version) return res.json({ version, changed: {} });
  // Stub: until DB-backed diffs exist, return full data
  res.json({ version, changed: data });
});

router.post("/v1/knowledge", (req: Request, res: Response) => {
  const incoming = (req.body && (req.body.data ?? req.body)) || null;
  if (!incoming || typeof incoming !== "object") {
    return res
      .status(400)
      .json({ error: "Missing knowledge data (object expected)" });
  }

  data = { ...data, ...incoming };
  version += 1;
  checksum = checksumOf(data);
  res.json({ ok: true, version, checksum });
});

export default router;
// redeploy trigger Fri Aug 29 13:30:21 IDT 2025
