-- Bring existing qa_answers table up to the expected schema

-- 1) Add missing columns if needed
ALTER TABLE qa_answers
  ADD COLUMN IF NOT EXISTS evidence JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE qa_answers
  ADD COLUMN IF NOT EXISTS confidence TEXT NOT NULL DEFAULT 'low';

ALTER TABLE qa_answers
  ADD COLUMN IF NOT EXISTS has_pricing BOOLEAN
  GENERATED ALWAYS AS ((answer ILIKE '%price%' OR answer ILIKE '%pricing%')) STORED;

ALTER TABLE qa_answers
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2) Add CHECK constraint for confidence if not present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname = 'chk_qa_answers_confidence'
           AND conrelid = 'qa_answers'::regclass
  ) THEN
    ALTER TABLE qa_answers
      ADD CONSTRAINT chk_qa_answers_confidence
      CHECK (confidence IN ('high','medium','low'));
  END IF;
END$$;

-- 3) Create indexes (idempotent)
CREATE INDEX IF NOT EXISTS idx_qa_answers_crawl_id ON qa_answers (crawl_id);
CREATE INDEX IF NOT EXISTS idx_qa_answers_confidence ON qa_answers (confidence);
CREATE INDEX IF NOT EXISTS idx_qa_answers_created_at ON qa_answers (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qa_answers_evidence_gin ON qa_answers USING GIN (evidence jsonb_path_ops);

