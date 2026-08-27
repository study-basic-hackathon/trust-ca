-- 所持証明チャレンジと通知欄(screen-design.md §6.1 / §6.6)

-- 1. possession_challenges: 出品時のnonce付き所持証明
CREATE TABLE possession_challenges (
  id uuid PRIMARY KEY,
  card_id uuid NOT NULL REFERENCES cards(id),
  code varchar(16) NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  used_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT possession_challenges_code_check CHECK (code ~ '^[A-Z0-9-]{6,16}$')
);

CREATE INDEX possession_challenges_card_idx
  ON possession_challenges (card_id, created_at DESC);

COMMENT ON TABLE possession_challenges IS '出品時の所持証明用ワンタイムコード。画像はcard_images(image_kind=possession, capture_nonce=code)へ紐付く。';

-- 2. notifications: アプリ内通知欄
CREATE TABLE notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  type varchar(40) NOT NULL,
  title varchar(200) NOT NULL,
  body varchar(500),
  order_id uuid REFERENCES orders(id),
  read_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT notifications_type_check CHECK (
    type IN (
      'order_paid', 'order_shipped', 'order_completed',
      'order_cancelled', 'order_disputed', 'dispute_resolved',
      'kyc_decided', 'listing_reviewed'
    )
  )
);

CREATE INDEX notifications_user_unread_idx
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX notifications_user_idx
  ON notifications (user_id, created_at DESC);

COMMENT ON TABLE notifications IS 'アプリ内通知。メール送信はMVP対象外(screen-design.md §6.6)。';
