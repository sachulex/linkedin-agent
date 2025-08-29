import { Router, Request, Response } from "express";
import crypto from "crypto";
import { query } from "./db";

const ORG_ID = "demo";
export const router = Router();

// ---------- helpers ----------
function sha256(x: any) {
  return "sha256:" + crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex");
}

function deepMerge<T = any>(base: T, patch: any): T {
  if (Array.isArray(patch)) return patch as any;
  if (patch && typeof patch === "object") {
    const out: any = Array.isArray(base) ? [] : { ...(base as any) };
    for (const k of Object.keys(patch)) {
      const bv = (base as any)?.[k];
      const pv = (patch as any)[k];
      out[k] = deepMerge(bv, pv);
    }
    return out;
  }
  return patch;
}

async function ensureTable() {
  await query(`
    create table if not exists knowledge_state (
      org_id text primary key,
      version int not null,
      checksum text not null,
      data jsonb not null,
      updated_at timestamptz not null default now()
    );
  `);
}

type Row = { version: number; checksum: string; data: any; updated_at: string };

async function readState(): Promise<Row> {
  await ensureTable();
  const r = await query<Row>("select version, checksum, data, updated_at from knowledge_state where org_id=$1", [ORG_ID]);
  if (r.rows.length) return r.rows[0];

  // seed (minimal defaults)
  const seed = {
    brand: { voice_rules: {}, post_structure: {} },
    design: { image_style: {} },
    company: { name: "Bark AI", positioning: "E-commerce intelligence for profit clarity", proof_points: [] },
    sales: { pitch_frames: ["Problem → Insight → Action"] }
  };
  const checksum = sha256(seed);
  await query(
    "insert into knowledge_state(org_id, version, checksum, data, updated_at) values($1,$2,$3,$4, now())",
    [ORG_ID, 1, checksum, JSON.stringify(seed)]
  );
  return { version: 1, checksum, data: seed, updated_at: new Date().toISOString() };
}

async function writePatch(patch: any, source?: string): Promise<Row> {
  const current = await readState();
  const nextData = deepMerge(current.data, patch);
  const version = current.version + 1;
  const checksum = sha256(nextData);
  await query(
    `insert into knowledge_state(org_id, version, checksum, data, updated_at)
     values($1,$2,$3,$4, now())
     on conflict (org_id) do update set
       version=excluded.version, checksum=excluded.checksum, data=excluded.data, updated_at=now()`,
    [ORG_ID, version, checksum, JSON.stringify(nextData)]
  );
  return { version, checksum, data: nextData, updated_at: new Date().toISOString() };
}

function makePacks(data: any, select: string[]) {
  const want = (k: string) => (select.length === 0 ? true : select.includes(k));
  const packs: Record<string, any> = {};
  if (want("brand")) {
    packs.brand = {
      rules: data.brand?.voice_rules || {},
      structure: data.brand?.post_structure || {}
    };
  }
  if (want("design")) {
    packs.design = { image: data.design?.image_style || {} };
  }
  if (want("company")) {
    packs.company = {
      name: data.company?.name || "",
      positioning: data.company?.positioning || "",
      proof_points: data.company?.proof_points || []
    };
  }
  if (want("sales")) {
    packs.sales = {
      frames: data.sales?.pitch_frames || [],
      objections: data.sales?.objections || []
    };
  }
  if (want("product")) {
    packs.product = {
      offers: data.product?.offers || [],
      cases: data.product?.cases || []
    };
  }
  return packs;
}

// ---------- routes ----------
router.get("/v1/knowledge", async (req: Request, res: Response) => {
  const row = await readState();
  const selectParam = (req.query.select as string | undefined) || "";
  const select = selectParam.split(",").map((s) => s.trim()).filter(Boolean);

  const etag = row.checksum;
  const inm = req.header("if-none-match");
  if (inm && inm === etag) return res.status(304).end();

  const payload = select.length ? select.reduce((acc, k) => { (acc as any)[k] = row.data?.[k]; return acc; }, {} as any) : row.data;
  res.setHeader("ETag", etag);
  res.json({ version: row.version, checksum: row.checksum, updated_at: row.updated_at, data: payload });
});

router.get("/v1/knowledge/packs", async (req: Request, res: Response) => {
  const row = await readState();
  const selectParam = (req.query.select as string | undefined) || "";
  const select = selectParam.split(",").map((s) => s.trim()).filter(Boolean);
  const packs = makePacks(row.data, select);
  res.setHeader("ETag", row.checksum);
  res.json({ version: row.version, checksum: row.checksum, updated_at: row.updated_at, packs });
});

// diff stub (version-aware)
router.get("/v1/knowledge/diff", async (req: Request, res: Response) => {
  const row = await readState();
  const since = parseInt(String(req.query.since ?? "0"), 10);
  if (!since || since >= row.version) return res.json({ version: row.version, changed: {} });
  // For now, return full packs as "changed"
  res.json({ version: row.version, changed: row.data });
});

// upsert via POST
router.post("/v1/knowledge", async (req: Request, res: Response) => {
  const body = req.body || {};
  const next = await writePatch(body, "manual");
  res.json({ ok: true, version: next.version, checksum: next.checksum });
});

// webhook style updater
router.post("/v1/knowledge/webhook", async (req: Request, res: Response) => {
  const body = req.body || {};
  const next = await writePatch(body, String(req.query.source || "webhook"));
  res.json({ ok: true, version: next.version, checksum: next.checksum, source: String(req.query.source || "webhook") });
});

// local getter for in-process use (reads DB each call)
export async function getPacksLocal(select: string[]) {
  const row = await readState();
  return { version: row.version, checksum: row.checksum, updated_at: row.updated_at, packs: makePacks(row.data, select) };
}

export default router;
