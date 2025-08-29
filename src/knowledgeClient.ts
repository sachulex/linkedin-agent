const BASE = process.env.KNOWLEDGE_BASE_URL || "https://linkedin-agent-kozf.onrender.com";

type PacksResponse = {
  version: number;
  checksum: string;
  updated_at: string;
  packs: Record<string, any>;
};

const etagCache: Record<string, { etag: string; data: PacksResponse }> = {};

/**
 * Fetch slim "prompt packs" from the Knowledge API with ETag caching.
 * @param select array of namespaces to include (e.g., ["brand","design","company"])
 */
export async function getKnowledgePacks(select: string[]): Promise<PacksResponse> {
  const key = (select && select.length ? select.slice().sort().join(",") : "all");
  const url = `${BASE}/v1/knowledge/packs?select=${encodeURIComponent(key)}`;
  const headers: Record<string,string> = {};
  if (etagCache[key]?.etag) headers["If-None-Match"] = etagCache[key].etag;

  const res = await fetch(url, { headers });
  if (res.status === 304 && etagCache[key]) return etagCache[key].data;

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Knowledge fetch failed: ${res.status} ${text}`);
  }

  const etag = res.headers.get("etag") || "";
  const data = (await res.json()) as PacksResponse;
  etagCache[key] = { etag, data };
  return data;
}
