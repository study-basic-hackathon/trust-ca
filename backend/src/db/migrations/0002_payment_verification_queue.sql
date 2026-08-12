-- JPYC payment receiptを非同期検証するためのworker状態。

ALTER TABLE payment_intents
  ADD COLUMN verification_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN next_verification_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN locked_at timestamp with time zone,
  ADD COLUMN locked_by varchar(128),
  ADD COLUMN block_number numeric(78, 0),
  ADD COLUMN last_error_code varchar(64),
  ADD COLUMN last_error_message text,
  ADD CONSTRAINT payment_intents_verification_attempt_check
    CHECK (verification_attempt_count >= 0),
  ADD CONSTRAINT payment_intents_block_number_check
    CHECK (block_number IS NULL OR block_number >= 0),
  ADD CONSTRAINT payment_intents_confirmed_receipt_check
    CHECK (status <> 'confirmed' OR block_number IS NOT NULL);

CREATE INDEX payment_intents_verification_ready_idx
  ON payment_intents (next_verification_at, submitted_at, id)
  WHERE status = 'submitted';

COMMENT ON COLUMN payment_intents.verification_attempt_count IS
  'JPYC transfer receiptの検証試行回数。';
COMMENT ON COLUMN payment_intents.next_verification_at IS
  'receiptを次に検証できる時刻。';
