// src/crawler/pageClassifier.ts

export type PageType =
  | "home"
  | "about"
  | "contact"
  | "pricing"
  | "product"
  | "blog"
  | "case-study"
  | "privacy"
  | "terms"
  | "other";

export interface ClassifiedPage {
  type: PageType;
  confidence: number; // 0.0–1.0
}

function safeUrl(u: string): URL | null {
  try {
    return new URL(u);
  } catch {
    return null;
  }
}

function hasAny(hay: string, needles: string[]) {
  hay = hay.toLowerCase();
  return needles.some(n => hay.includes(n));
}

export function classifyPage(url: string, title?: string, text?: string): ClassifiedPage {
  const u = safeUrl(url);
  const pathname = (u?.pathname || "/").toLowerCase();
  const lowerTitle = (title || "").toLowerCase();
  const lowerText = (text || "").toLowerCase();

  // Normalize trailing slashes (but keep root as "/")
  const path = pathname === "" ? "/" : pathname;

  // 1) HOME — only when the path is exactly "/"
  if (path === "/" || path === "/index" || path === "/index.html") {
    return { type: "home", confidence: 0.95 };
  }

  // 2) URL path segment heuristics (high confidence)
  const segs = path.split("/").filter(Boolean);

  // Helper to check a segment list for keywords
  const pathHas = (...keywords: string[]) => hasAny(path, keywords);

  if (pathHas("about", "team", "company", "who-we-are")) {
    return { type: "about", confidence: 0.9 };
  }
  if (pathHas("contact", "contact-us", "support", "help", "get-in-touch")) {
    return { type: "contact", confidence: 0.9 };
  }
  if (pathHas("pricing", "plans", "plan", "packages")) {
    return { type: "pricing", confidence: 0.92 };
  }
  if (pathHas("privacy", "privacy-policy")) {
    return { type: "privacy", confidence: 0.98 };
  }
  if (pathHas("terms", "terms-of-service", "tos", "legal")) {
    return { type: "terms", confidence: 0.95 };
  }
  if (pathHas("blog", "news", "stories", "insights", "articles")) {
    return { type: "blog", confidence: 0.85 };
  }
  if (pathHas("case", "case-study", "case-studies", "customers", "success-stories")) {
    return { type: "case-study", confidence: 0.85 };
  }
  if (pathHas("product", "products", "shop", "store", "item", "sku", "catalog")) {
    return { type: "product", confidence: 0.75 };
  }

  // 3) Title-based fallbacks (medium confidence)
  if (hasAny(lowerTitle, ["about", "our team", "company"])) {
    return { type: "about", confidence: 0.7 };
  }
  if (hasAny(lowerTitle, ["contact", "support"])) {
    return { type: "contact", confidence: 0.7 };
  }
  if (hasAny(lowerTitle, ["pricing", "plans", "packages"])) {
    return { type: "pricing", confidence: 0.75 };
  }
  if (hasAny(lowerTitle, ["privacy"])) {
    return { type: "privacy", confidence: 0.85 };
  }
  if (hasAny(lowerTitle, ["terms"])) {
    return { type: "terms", confidence: 0.85 };
  }
  if (hasAny(lowerTitle, ["blog", "news", "insights", "stories", "articles"])) {
    return { type: "blog", confidence: 0.7 };
  }
  if (hasAny(lowerTitle, ["case study", "case studies", "customers", "success stories"])) {
    return { type: "case-study", confidence: 0.7 };
  }
  if (hasAny(lowerTitle, ["product", "shop", "store"])) {
    return { type: "product", confidence: 0.65 };
  }

  // 4) Text-based hints (lower confidence guardrail)
  if (hasAny(lowerText.slice(0, 2000), ["privacy policy"])) {
    return { type: "privacy", confidence: 0.7 };
  }
  if (hasAny(lowerText.slice(0, 2000), ["terms of service", "terms and conditions"])) {
    return { type: "terms", confidence: 0.7 };
  }

  return { type: "other", confidence: 0.3 };
}
