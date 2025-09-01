import type { CrawlOptions, CrawlResult } from "./types";
import { normalizeUrl, sameOrigin, allowedByRobots } from "./utils";

export async function crawlSite(opts: CrawlOptions): Promise<CrawlResult> {
  // will implement in the next step using these helpers
  return { pages: [], errors: [] };
}

export default crawlSite;

