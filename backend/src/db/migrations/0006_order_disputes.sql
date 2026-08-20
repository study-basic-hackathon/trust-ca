-- 紛争申告の内容をorders上へ保存する(screen-design.md §6.4)
ALTER TABLE orders ADD COLUMN dispute_reason_code varchar(32);
ALTER TABLE orders ADD COLUMN dispute_description varchar(1000);
ALTER TABLE orders ADD COLUMN disputed_at timestamp with time zone;
ALTER TABLE orders ADD CONSTRAINT orders_dispute_reason_check CHECK (
  dispute_reason_code IS NULL OR dispute_reason_code IN (
    'not_delivered', 'not_as_described', 'suspected_fake', 'other'
  )
);
