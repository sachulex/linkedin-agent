import { Router, Request, Response } from "express";
import { getKnowledgePacks } from "./knowledgeClient";

const router = Router();

function asLines(arr?: any[]): string {
  if (!Array.isArray(arr) || arr.length === 0) return "-";
  return arr.map((v) => `- ${String(v)}`).join("\n");
}

function formatPromptContext(packs: Record<string, any>): string {
  const brand = packs.brand || {};
  const company = packs.company || {};
  const design = packs.design || {};
  const product = packs.product || {};
  const sales = packs.sales || {};

  const tone = brand.rules?.tone ? `tone: ${brand.rules.tone}` : "-";
  const avoid = asLines(brand.rules?.avoid_words);
  const structure = Object.keys(brand.structure || {}).length
    ? JSON.stringify(brand.structure)
    : "-";

  const companyName = company.name || "-";
  const positioning = company.positioning || "-";
  const proof = asLines(company.proof_points);

  const image = Object.keys(design.image || {}).length
    ? JSON.stringify(design.image)
    : "-";

  const offers = asLines(product.offers);
  const cases = asLines(product.cases);

  const frames = asLines(sales.frames);
  const objections = asLines(sales.objections);

  return [
    "=== KNOWLEDGE CONTEXT ===",
    "Brand:",
    `  ${tone}`,
    "  avoid words:",
    `  ${avoid}`,
    "  structure:",
    `  ${structure}`,
    "",
    "Company:",
    `  name: ${companyName}`,
    `  positioning: ${positioning}`,
    "  proof points:",
    `  ${proof}`,
    "",
    "Design:",
    `  image: ${image}`,
    "",
    "Product:",
    "  offers:",
    `  ${offers}`,
    "  cases:",
    `  ${cases}`,
    "",
    "Sales:",
    "  frames:",
    `  ${frames}`,
    "  objections:",
    `  ${objections}`,
  ].join("\n");
}

router.get("/v1/prompt-context", async (req: Request, res: Response) => {
  try {
    const select = String(req.query.select || "brand,company,design")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const { version, checksum, packs } = await getKnowledgePacks(select);
    const context = formatPromptContext(packs);
    res.json({ version, checksum, context, packs });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

export default router;
