import { Router, Request, Response } from "express";
import { createHash } from "crypto";

type KnowledgeData = {
  brand?: any;
  design?: any;
  company?: any;
  product?: any;
  sales?: any;
};

let version = 2;
let data: KnowledgeData = {
  brand: { voice_rules: {}, post_structure: {} },
  design: { image_style: {} },
  company: { name: "Bark AI", positioning: "E-commerce intelligence for profit clarity" },
  sales: { pitch_frames: ["Problem → Insight → Action"] },
};

const checksumOf = (d: any) =>
  "sha256:" + createHash("sha256").update(JSON.stringify(d)).digest("hex");

let checksum = checksumOf(data);

const pick = (obj: any, keys: string[]) => {
  const out: any = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
};

const packBrand = (d: any) => ({
  rules: d?.voice_rules ?? {},
  structure: d?.post_structure ?? {},
});
const packDesign = (d: any) => ({
  image: d?.image_style ?? {},
});
const packCompany = (d: any) => ({
  name: d?.name ?? "",
  positioning: d?.positioning ?? "",
  proof_points: (d?.proof_points ?? []).slice(0, 6),
});
const packProduct = (d: any) => ({
  offers: (d?.offers ?? []).slice(0, 6),
  cases: (d?.case_studies ?? []).slice(0, 6),
});
const packSales = (d: any) => ({
  frames: (d?.pitch_frames ?? []).slice(0, 6),
  objections: (d?.objections ?? []).slice(0, 10),
});

const makePacks = (full: KnowledgeData, select: string[]) => {
  const want = (k: string) => select.length === 0 || select.includes(k);
  const packs: any = {};
  if (want("brand")) packs.brand = packBrand(full.brand);
  if (want("design")) packs.design = packDesign(full.design);
  if (want("company")) packs.company = packCompany(full.company);
  if (want("product")) packs.product = packProduct(full.product);
  if (want("sales")) packs.sales = packSales(full.sales);
  return packs;
};

const router = Router();

router.get("/v1/knowledge", (req: Request, res: Response) => {
  const selectParam = (req.query.select as string | undefined) || "";
  const select = selectParam.split(",").map((s) => s.trim()).filter(Boolean);
  let payload = data;
  if (select.length) payload = pick(data as any, select);
  const etag = checksum;
  const inm = req.header("if-none-match");
  if (inm && inm === etag) return res.status(304).end();
  res.setHeader("ETag", etag);
  res.json({ version, checksum, updated_at: new Date().toISOString(), data: payload });
});

router.get("/v1/knowledge/diff", (req: Request, res: Response) => {
  const since = parseInt(String(req.query.since ?? "0"), 10);
  if (!since || since >= version) return res.json({ version, changed: {} });
  res.json({ version, changed: data });
});

router.get("/v1/knowledge/packs", (req: Request, res: Response) => {
  const selectParam = (req.query.select as string | undefined) || "";
  const select = selectParam.split(",").map((s) => s.trim()).filter(Boolean);
  const packs = makePacks(data, select);
  const etag = checksum + ":packs:" + (select.sort().join("|") || "all");
  const inm = req.header("if-none-match");
  if (inm && inm === etag) return res.status(304).end();
  res.setHeader("ETag", etag);
  res.json({ version, checksum, updated_at: new Date().toISOString(), packs });
});

router.post("/v1/knowledge", (req: Request, res: Response) => {
  const incoming = (req.body && (req.body.data ?? req.body)) || null;
  if (!incoming || typeof incoming !== "object")
    return res.status(400).json({ error: "Missing knowledge data (object expected)" });
  data = { ...data, ...incoming };
  version += 1;
  checksum = checksumOf(data);
  res.json({ ok: true, version, checksum });
});

router.post("/v1/knowledge/webhook", (req: Request, res: Response) => {
  const source = String(req.query.source || "base44");
  const incoming = (req.body && (req.body.data ?? req.body)) || null;
  if (!incoming || typeof incoming !== "object")
    return res.status(400).json({ error: "Missing knowledge data (object expected)" });
  data = { ...data, ...incoming };
  version += 1;
  checksum = checksumOf(data);
  res.json({ ok: true, version, checksum, source });
});

export default router;
