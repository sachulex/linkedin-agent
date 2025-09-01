// src/crawler/types.ts

/** -------- Input shape for the website research workflow -------- */
export interface WebsiteResearchInputs {
  /** Either provide a start URL or reuse a previous crawl_id (one of them is required upstream). */
  start_url?: string;
  crawl_id?: string;

  max_pages?: number;
  max_depth?: number;
  include_sitemap?: boolean;
  /** Optional natural-language questions to answer. */
  questions?: string[];
}

/** -------- Helpful enums / aliases -------- */
export type PageType =
  | "home"
  | "about"
  | "pricing"
  | "product"
  | "blog"
  | "contact"
  | "legal"
  | "other";

/** -------- Core page record used across crawler modules -------- */
export interface PageRecord {
  url: string;
  title?: string;

  /** Your original field used by some modules (string-based) */
  type?: string; // e.g., 'home' | 'about' | 'pricing' | 'product' | 'blog' | 'case_study' | 'contact' | 'legal' | ...

  /** Optional enum version used by other code paths */
  page_type?: PageType;

  depth: number;

  /** Your original status + an optional status_code alias for other modules */
  status?: number | null;
  status_code?: number;

  /** Text + links captured by the crawler */
  text?: string;       // cleaned text (HTML → text)
  links?: string[];    // internal absolute links discovered on this page

  /** Frequently referenced optional fields in save/smoke/extract code */
  summary?: string;
  metaDescription?: string;
  language?: string;
  fetchedAt?: string;      // ISO timestamp
  parentUrl?: string;
  contentType?: string;    // e.g. "text/html"
  userAgent?: string;
}

/** A normalized page variant kept from your original definitions */
export interface NormalizedPage extends PageRecord {
  summary?: string;
}

/** -------- Q&A + findings types (kept from your originals) -------- */
export interface EvidenceItem {
  url: string;
  snippet: string;
}

export type Confidence = "high" | "medium" | "low";

export interface QAAnswer {
  question: string;
  answer: string;
  confidence: Confidence;
  evidence: EvidenceItem[];
}

export interface Findings {
  mentions_pricing: boolean;
  pricing_page_urls: string[];
  value_prop: string | null;
  key_features: string[];
  partners_integrations: string[];  // normalized partner names
  noteworthy_metrics: string[];     // sentences containing numbers + business context
  coverage: {
    pages_considered: number;
    unique_urls_in_evidence: number;
  };
}

/** -------- Workflow output shapes (kept from your originals) -------- */
export interface WebsiteResearchOutputs {
  highlights: string[];
  pages: Array<{
    url: string;
    title?: string;
    type?: string;
    depth: number;
    summary?: string;
  }>;
  sitemap?: {
    flat: Array<{ url: string; depth: number; parent: string | null }>;
  };
  qa: QAAnswer[];
  findings?: Findings | null;
}

export interface WebsiteResearchResponse {
  id: string | null; // usually the crawl_id if present
  status: "SUCCEEDED" | "FAILED";
  inputs: Record<string, any>;
  outputs: WebsiteResearchOutputs;
  created_at: string;
}

/** -------- Crawler-wide types referenced by other files -------- */
export interface CrawlOptions {
  startUrl: string;
  maxPages: number;
  maxDepth: number;
  userAgent?: string;
}

export interface CrawlResult {
  pages: PageRecord[];
  errors?: number;
}
