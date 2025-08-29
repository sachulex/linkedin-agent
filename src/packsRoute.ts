import { Router, Request, Response } from "express";
import { getKnowledgePacks } from "./knowledgeClient";

const router = Router();

// Agents call: /v1/packs?select=brand,company
router.get("/v1/packs", async (req: Request, res: Response) => {
  try {
    const select = String(req.query.select || "brand,design,company")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const packs = await getKnowledgePacks(select);
    res.json(packs);
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

export default router;
