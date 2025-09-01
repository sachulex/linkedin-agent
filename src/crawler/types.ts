// src/crawler/types.ts

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

export interface PageRecord {
  url: string;
  title?: string;
  type?: string;    // e.g., 'home' | 'about' | 'pricing' | 'product' | 'blog' | 'case_study' | 'contact' | 'legal' | ...
  depth: number;
  status?: number | null;
  text?: string;    // cleaned text (HTML → text)
  links?: string[]; // internal absolute links discovered on this page
}

export interface NormalizedPage extends PageRecord {
  summary?: string;
}

export interface EvidenceItem {
  url: string;
  snippet: string;
}

export type Confidence = 'high' | 'medium' | 'low';

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
  status: 'SUCCEEDED' | 'FAILED';
  inputs: Record<string, any>;
  outputs: WebsiteResearchOutputs;
  created_at: string;
}
