import robotsParser from "robots-parser";

type RobotsCacheEntry = {
  parser: ReturnType<typeof robotsParser>;
  fetchedAt: number;
};

const ROBOTS_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const robotsCache = new Map<string, RobotsCacheEntry>();

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) {
      u.port = "";
    }
    if (u.pathname !== "/" && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return raw;
  }
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.protocol === ub.protocol && ua.hostname === ub.hostname && ua.port === ub.port;
  } catch {
    return false;
  }
}

export function getRobotsUrl(siteUrl: string): string {
  const u = new URL(siteUrl);
  u.pathname = "/robots.txt";
  u.search = "";
  u.hash = "";
  return u.toString();
}

export async function getRobotsParser(startUrl: string, userAgent: string): Promise<ReturnType<typeof robotsParser>> {
  const robotsUrl = getRobotsUrl(startUrl);
  const now = Date.now();
  const cached = robotsCache.get(robotsUrl);
  if (cached && now - cached.fetchedAt < ROBOTS_TTL_MS) {
    return cached.parser;
  }

  const { fetch } = await import("undici");
  let body = "";
  try {
    const res = await fetch(robotsUrl, { headers: { "User-Agent": userAgent } });
    body = res.ok ? await res.text() : "";
  } catch {
    body = "";
  }

  const parser = robotsParser(robotsUrl, body);
  robotsCache.set(robotsUrl, { parser, fetchedAt: now });
  return parser;
}

export async function allowedByRobots(url: string, userAgent: string): Promise<boolean> {
  try {
    const parser = await getRobotsParser(url, userAgent);
    return parser.isAllowed(url, userAgent) !== false;
  } catch {
    return true; // fail open
  }
}
