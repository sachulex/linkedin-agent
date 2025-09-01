CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 002_website_research.sql

-- Crawl jobs
CREATE TABLE IF NOT EXISTS site_crawls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  start_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | running | succeeded | failed
  max_pages INT,
  max_depth INT,
  include_sitemap BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Pages crawled
CREATE TABLE IF NOT EXISTS site_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crawl_id UUID REFERENCES site_crawls(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  status_code INT,
  depth INT,
  page_type TEXT, -- home, about, pricing, product, blog, etc.
  title TEXT,
  meta_description TEXT,
  content TEXT, -- cleaned text for NLP
  language TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_pages_crawl_id ON site_pages(crawl_id);
CREATE INDEX IF NOT EXISTS idx_site_pages_url ON site_pages ((lower(url)));

-- Entities extracted
CREATE TABLE IF NOT EXISTS page_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID REFERENCES site_pages(id) ON DELETE CASCADE,
  entity_type TEXT, -- product, integration, price, email, phone, social, etc.
  entity_value TEXT,
  confidence NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_page_entities_page_id ON page_entities(page_id);

-- Business Q&A (final shape)
CREATE TABLE IF NOT EXISTS qa_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crawl_id UUID REFERENCES site_crawls(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT,
  confidence TEXT NOT NULL DEFAULT 'low',
  evidence_url TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  has_pricing BOOLEAN GENERATED ALWAYS AS (
    answer ILIKE '%price%' OR answer ILIKE '%pricing%'
  ) STORED,
  CHECK (confidence IN ('high','medium','low'))
);

CREATE INDEX IF NOT EXISTS idx_qa_answers_crawl_id ON qa_answers(crawl_id);
CREATE INDEX IF NOT EXISTS idx_qa_answers_crawl_question ON qa_answers(crawl_id, question);
CREATE INDEX IF NOT EXISTS idx_qa_answers_confidence ON qa_answers(confidence);
CREATE INDEX IF NOT EXISTS idx_qa_answers_created_at ON qa_answers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qa_answers_evidence_gin ON qa_answers USING gin (evidence jsonb_path_ops);

-- Rollups & highlights (one row per crawl)
CREATE TABLE IF NOT EXISTS site_rollups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crawl_id UUID UNIQUE REFERENCES site_crawls(id) ON DELETE CASCADE,
  highlights JSONB,
  metrics JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_rollups_crawl_id ON site_rollups(crawl_id);
