// src/workflows/website_research_v1.ts

export type WebsiteResearchInputs = {
  start_url: string;
  max_pages?: number;        // default 50
  max_depth?: number;        // default 2
  include_sitemap?: boolean; // default true
  questions?: string[];      // optional business questions to answer
};

export type WebsiteResearchOutputs = {
  highlights: string[];
  qa: Array<{ question: string; answer: string; confidence: number; evidence?: string[] }>;
  pages: Array<{
    url: string;
    status: number;
    depth: number;
    type: string;          // e.g., "home" | "about" | "pricing" | "product" | "blog" | "other"
    title?: string;
    summary?: string;
  }>;
  sitemap?: Array<{ url: string; depth: number; type: string }>;
  metrics: {
    pages_visited: number;
    elapsed_ms: number;
    errors: string[];
  };
};

// Minimal stub executor for v1
export async function runWebsiteResearchV1(
  inputs: WebsiteResearchInputs
): Promise<WebsiteResearchOutputs> {
  const start = Date.now();

  const defaults = {
    max_pages: 50,
    max_depth: 2,
    include_sitemap: true,
  };

  const cfg = { ...defaults, ...inputs };
  const questions = Array.isArray(inputs.questions) ? inputs.questions : [];

  return {
    highlights: [
      `Scaffold OK. start_url=${inputs.start_url}`,
      `Limits: max_pages=${cfg.max_pages}, max_depth=${cfg.max_depth}, include_sitemap=${cfg.include_sitemap}`,
    ],
    qa: questions.map((q) => ({
      question: q,
      answer: "Stub answer — crawling not implemented yet.",
      confidence: 0.1,
    })),
    pages: [
      {
        url: inputs.start_url,
        status: 200,
        depth: 0,
        type: "home",
        title: "Stub Title",
        summary: "This is a stub page summary. Chapter 3 will add a real crawler.",
      },
    ],
    sitemap: cfg.include_sitemap
      ? [{ url: inputs.start_url, depth: 0, type: "home" }]
      : undefined,
    metrics: {
      pages_visited: 1,
      elapsed_ms: Date.now() - start,
      errors: [],
    },
  };
}
