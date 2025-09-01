-- Enable UUIDs if not already enabled
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Q&A answers tied to a specific crawl
CREATE TABLE IF NOT EXISTS qa_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crawl_id UUID NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  -- evidence: array of { url, snippet }
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- denormalized hints for quick filtering
  has_pricing BOOLEAN GENERATED ALWAYS AS (
    (answer ILIKE '%price%' OR answer ILIKE '%pricing%')
  ) STORED,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookups
CREATE INDEX IF NOT EXISTS idx_qa_answers_crawl_id ON qa_answers (crawl_id);
CREATE INDEX IF NOT EXISTS idx_qa_answers_confidence ON qa_answers (confidence);
CREATE INDEX IF NOT EXISTS idx_qa_answers_created_at ON qa_answers (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qa_answers_evidence_gin ON qa_answers USING GIN (evidence jsonb_path_ops);

