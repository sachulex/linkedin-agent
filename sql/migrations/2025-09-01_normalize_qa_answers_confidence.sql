-- Normalize qa_answers.confidence from numeric → text enum ('high'|'medium'|'low')

-- 1) Convert numeric to text with a sensible mapping
--    >= 0.8 → 'high'; >= 0.4 → 'medium'; else → 'low'; null → 'low'
ALTER TABLE qa_answers
  ALTER COLUMN confidence TYPE TEXT
  USING (
    CASE
      WHEN confidence IS NULL THEN 'low'
      WHEN confidence::numeric >= 0.8 THEN 'high'
      WHEN confidence::numeric >= 0.4 THEN 'medium'
      ELSE 'low'
    END
  );

-- 2) Set default + not null
ALTER TABLE qa_answers
  ALTER COLUMN confidence SET DEFAULT 'low';

UPDATE qa_answers
SET confidence = 'low'
WHERE confidence IS NULL;

ALTER TABLE qa_answers
  ALTER COLUMN confidence SET NOT NULL;

-- 3) Add CHECK constraint if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_qa_answers_confidence'
      AND conrelid = 'qa_answers'::regclass
  ) THEN
    ALTER TABLE qa_answers
      ADD CONSTRAINT chk_qa_answers_confidence
      CHECK (confidence IN ('high','medium','low'));
  END IF;
END$$;

