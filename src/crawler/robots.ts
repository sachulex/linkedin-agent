// src/crawler/robots.ts
import { USER_AGENT } from "./http";

// Very small, cached robots.txt fetcher + parser (supports only User-agent:* and Disallow)
const robotsCache = new Map<string, string[]>();

async function fetchRobotsTxt(origin: string): Promise<string | null> {
  const url = `${origin}/robots.txt`;
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
        "accept": "text/plain,*/*;q=0.1",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const txt = await res.text();
    return txt;
  } catch {
    return null;
  }
}

/**
 * Parse Disallow rules for the `User-agent: *` group.
 * This is intentionally minimal (ignores Allow, Crawl-delay, wildcards).
 */
function parseDisallowForAllAgents(robotsTxt: string): string[] {
  const lines = robotsTxt.split(/\r?\n/);
  let inAll = false;
  const disallows: string[] = [];

  for (const raw of lines) {
    const line = raw.replace(/\s+#.*/, "").trim(); // strip inline comments
    if (!line) continue;

    const m = /^([Uu]ser-[Aa]gent|[Dd]isallow)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;

    const key = m[1].toLowerCase();
    const val = m[2].trim();

    if (key === "user-agent") {
      // enter * group if matches, otherwise leave it
      inAll = (val === "*" || val === '"*"');
    } else if (key === "disallow" && inAll) {
      // empty Disallow means allow everything; we only store non-empty paths
      if (val && val !== '"') disallows.push(val);
    }
  }
  return disallows;
}

/** Get or fetch disallow rules for an origin */
async function getDisallows(origin: string): Promise<string[]> {
  if (robotsCache.has(origin)) return robotsCache.get(origin)!;
  const txt = await fetchRobotsTxt(origin);
  if (!txt) {
    robotsCache.set(origin, []); // no robots => allow all
    return [];
  }
  const rules = parseDisallowForAllAgents(txt);
  robotsCache.set(origin, rules);
  return rules;
}

/**
 * Very simple robots allow check against User-agent:* Disallow rules.
 * - Compares path prefixes (no wildcards)
 * - Uses URL.pathname only (query ignored)
 */
export async function allowedByRobots(url: string): Promise<boolean> {
  const u = new URL(url);
  const origin = `${u.protocol}//${u.host}`;
  const disallows = await getDisallows(origin);

  const path = u.pathname; // ignore query for simplicity
  for (const rule of disallows) {
    // Per spec, Disallow: / blocks everything under /
    // Empty rule means allow all (we skipped empty rules in parser)
    if (rule === "/") return false;
    if (rule && path.startsWith(rule)) return false;
  }
  return true;
}
