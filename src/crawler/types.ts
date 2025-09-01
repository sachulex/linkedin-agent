export interface CrawlOptions {
  startUrl: string;
  maxPages: number;
  maxDepth: number;
  userAgent?: string;
}

export interface PageRecord {
  url: string;
  depth: number;
  status: number | null;
  contentType?: string;
  title?: string;
  text?: string;
  fetchedAt: string;
  parentUrl?: string | null;
}

export interface CrawlResult {
  pages: PageRecord[];
  errors: Array<{ url: string; error: string }>;
}
