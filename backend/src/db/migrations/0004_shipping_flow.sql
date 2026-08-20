-- 発送・購入完了フロー(docs/design/shipping-flow.md)
-- orders状態へ shipped / delivered を追加し、shipments と
-- order_shipping_addresses(配送先PIIの唯一の保存場所)を新設する。

-- 1. orders: 発送関連の状態と時刻列を追加
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (
  status IN (
    'pending_payment', 'payment_submitted', 'paid',
    'shipped', 'delivered', 'completed',
    'cancelled', 'disputed', 'refunded'
  )
);
ALTER TABLE orders DROP CONSTRAINT orders_paid_at_check;
ALTER TABLE orders ADD CONSTRAINT orders_paid_at_check CHECK (
  status NOT IN ('paid', 'shipped', 'delivered', 'completed', 'refunded', 'disputed')
  OR paid_at IS NOT NULL
);
ALTER TABLE orders ADD COLUMN shipped_at timestamp with time zone;
ALTER TABLE orders ADD COLUMN delivered_at timestamp with time zone;

-- 2. shipments: 追跡番号による発送記録(1注文1件)
CREATE TABLE shipments (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
  carrier varchar(24) NOT NULL,
  carrier_name_other varchar(100),
  tracking_number varchar(64) NOT NULL,
  shipped_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT shipments_carrier_check CHECK (
    carrier IN ('yamato', 'sagawa', 'japan_post', 'other')
  ),
  CONSTRAINT shipments_carrier_other_check CHECK (
    carrier <> 'other' OR carrier_name_other IS NOT NULL
  ),
  CONSTRAINT shipments_tracking_number_check CHECK (
    tracking_number ~ '^[A-Za-z0-9-]{4,64}$'
  )
);

COMMENT ON TABLE shipments IS '発送記録。配送業者APIとは連携せず、キャリア公式追跡ページへの外部リンクで参照する。';

CREATE TRIGGER shipments_set_updated_at
  BEFORE UPDATE ON shipments
  FOR EACH ROW
  EXECUTE FUNCTION trustca_set_updated_at();

-- 3. order_shipping_addresses: 配送先PIIの唯一の保存場所
--    参照は取引当事者と運営者のみ。取引完了から90日で削除対象
--    (retention_untilは受領確認時に設定する)。
CREATE TABLE order_shipping_addresses (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
  recipient_name varchar(100) NOT NULL,
  postal_code varchar(8) NOT NULL,
  prefecture varchar(20) NOT NULL,
  city varchar(100) NOT NULL,
  address_line1 varchar(200) NOT NULL,
  address_line2 varchar(200),
  phone_number varchar(15) NOT NULL,
  retention_until timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT osa_recipient_name_not_blank CHECK (btrim(recipient_name) <> ''),
  CONSTRAINT osa_postal_code_check CHECK (postal_code ~ '^[0-9]{3}-[0-9]{4}$'),
  CONSTRAINT osa_phone_number_check CHECK (phone_number ~ '^[0-9-]{10,15}$')
);

COMMENT ON TABLE order_shipping_addresses IS '配送先PII。audit_events・ログ・オンチェーンへ複製しない(shipping-flow.md §3.3)。';

CREATE INDEX order_shipping_addresses_retention_idx
  ON order_shipping_addresses (retention_until)
  WHERE retention_until IS NOT NULL;
