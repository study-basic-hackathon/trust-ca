-- Trustca初期スキーマ。
-- UUIDはNode.js側で生成し、Cloud SQL上のextension権限へ依存しない。

CREATE OR REPLACE FUNCTION trustca_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TABLE users (
  id uuid PRIMARY KEY,
  display_name varchar(100) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active',
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT users_display_name_not_blank CHECK (btrim(display_name) <> ''),
  CONSTRAINT users_status_check CHECK (status IN ('active', 'suspended', 'withdrawn'))
);

COMMENT ON TABLE users IS '購入者・販売者を含むTrustcaアカウント。取引監査を保つため物理削除せずstatusを変更する。';

CREATE TABLE seller_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  onboarding_status varchar(24) NOT NULL DEFAULT 'pending_kyc',
  approved_at timestamp with time zone,
  suspended_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT seller_profiles_status_check CHECK (
    onboarding_status IN ('pending_kyc', 'in_review', 'approved', 'declined', 'suspended')
  )
);

COMMENT ON TABLE seller_profiles IS '販売者としての審査・利用状態。eKYC単体のstatusとは分離する。';

CREATE TABLE seller_limits (
  seller_id uuid PRIMARY KEY REFERENCES seller_profiles(user_id),
  active_listing_limit integer NOT NULL DEFAULT 3,
  max_listing_amount_minor bigint NOT NULL DEFAULT 100000,
  currency char(3) NOT NULL DEFAULT 'JPY',
  withdrawal_hold_hours integer NOT NULL DEFAULT 72,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT seller_limits_listing_count_check CHECK (active_listing_limit >= 0),
  CONSTRAINT seller_limits_amount_check CHECK (max_listing_amount_minor >= 0),
  CONSTRAINT seller_limits_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT seller_limits_hold_check CHECK (withdrawal_hold_hours >= 0)
);

COMMENT ON TABLE seller_limits IS 'eKYC承認後も段階的に適用する出品数・金額・出金保留制限。';

CREATE TABLE wallet_accounts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  provider varchar(32) NOT NULL,
  chain_id integer NOT NULL,
  address_normalized varchar(42) NOT NULL,
  verified_at timestamp with time zone NOT NULL,
  disabled_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT wallet_accounts_provider_not_blank CHECK (btrim(provider) <> ''),
  CONSTRAINT wallet_accounts_chain_id_check CHECK (chain_id > 0),
  CONSTRAINT wallet_accounts_address_check CHECK (
    address_normalized = lower(address_normalized)
    AND address_normalized ~ '^0x[0-9a-f]{40}$'
  ),
  CONSTRAINT wallet_accounts_chain_address_unique UNIQUE (chain_id, address_normalized),
  CONSTRAINT wallet_accounts_id_chain_address_unique UNIQUE (id, chain_id, address_normalized)
);

CREATE INDEX wallet_accounts_user_id_idx ON wallet_accounts (user_id, disabled_at);

COMMENT ON TABLE wallet_accounts IS '署名検証済みEVMウォレット。秘密鍵は保存しない。';

CREATE TABLE wallet_auth_challenges (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  chain_id integer NOT NULL,
  address_normalized varchar(42) NOT NULL,
  nonce_sha256 varchar(64) NOT NULL,
  domain varchar(255) NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  used_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT wallet_auth_challenges_chain_id_check CHECK (chain_id > 0),
  CONSTRAINT wallet_auth_challenges_address_check CHECK (
    address_normalized = lower(address_normalized)
    AND address_normalized ~ '^0x[0-9a-f]{40}$'
  ),
  CONSTRAINT wallet_auth_challenges_nonce_check CHECK (nonce_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT wallet_auth_challenges_nonce_unique UNIQUE (nonce_sha256),
  CONSTRAINT wallet_auth_challenges_domain_not_blank CHECK (btrim(domain) <> ''),
  CONSTRAINT wallet_auth_challenges_expiration_check CHECK (expires_at > created_at)
);

CREATE INDEX wallet_auth_challenges_expiration_idx
  ON wallet_auth_challenges (expires_at)
  WHERE used_at IS NULL;

COMMENT ON TABLE wallet_auth_challenges IS 'ウォレット署名認証用の使い捨てchallenge。nonce本文ではなくSHA-256だけを保存する。';

CREATE TABLE seller_verifications (
  id uuid PRIMARY KEY,
  seller_id uuid NOT NULL REFERENCES seller_profiles(user_id),
  provider varchar(32) NOT NULL,
  provider_session_id varchar(255) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'not_started',
  provider_status varchar(64),
  checks jsonb,
  source varchar(24) NOT NULL DEFAULT 'created',
  requested_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at timestamp with time zone,
  expires_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT seller_verifications_provider_not_blank CHECK (btrim(provider) <> ''),
  CONSTRAINT seller_verifications_session_not_blank CHECK (btrim(provider_session_id) <> ''),
  CONSTRAINT seller_verifications_provider_session_unique UNIQUE (provider, provider_session_id),
  CONSTRAINT seller_verifications_status_check CHECK (
    status IN ('not_started', 'in_progress', 'in_review', 'approved', 'declined', 'abandoned', 'expired')
  ),
  CONSTRAINT seller_verifications_source_check CHECK (source IN ('created', 'webhook', 'poll', 'operator')),
  CONSTRAINT seller_verifications_checks_object_check CHECK (
    checks IS NULL OR jsonb_typeof(checks) = 'object'
  ),
  CONSTRAINT seller_verifications_expiration_check CHECK (
    expires_at IS NULL OR expires_at > requested_at
  )
);

CREATE UNIQUE INDEX seller_verifications_one_active_per_seller_uq
  ON seller_verifications (seller_id)
  WHERE status IN ('not_started', 'in_progress', 'in_review');

CREATE INDEX seller_verifications_seller_created_idx
  ON seller_verifications (seller_id, created_at DESC);

COMMENT ON TABLE seller_verifications IS 'PIIを除いた販売者eKYCの現在状態。外部の未知statusはbackendでin_reviewへ正規化する。';

CREATE TABLE verification_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  verification_id uuid NOT NULL REFERENCES seller_verifications(id),
  event_type varchar(32) NOT NULL,
  from_status varchar(24),
  to_status varchar(24) NOT NULL,
  checks jsonb,
  source varchar(24) NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  reason text,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT verification_events_type_check CHECK (
    event_type IN ('session_created', 'status_changed', 'checks_updated', 'operator_decision')
  ),
  CONSTRAINT verification_events_from_status_check CHECK (
    from_status IS NULL OR from_status IN (
      'not_started', 'in_progress', 'in_review', 'approved', 'declined', 'abandoned', 'expired'
    )
  ),
  CONSTRAINT verification_events_to_status_check CHECK (
    to_status IN ('not_started', 'in_progress', 'in_review', 'approved', 'declined', 'abandoned', 'expired')
  ),
  CONSTRAINT verification_events_source_check CHECK (source IN ('created', 'webhook', 'poll', 'operator')),
  CONSTRAINT verification_events_checks_object_check CHECK (
    checks IS NULL OR jsonb_typeof(checks) = 'object'
  )
);

CREATE INDEX verification_events_verification_created_idx
  ON verification_events (verification_id, created_at, id);

COMMENT ON TABLE verification_events IS 'eKYC状態変更のappend-only監査履歴。';

CREATE TABLE webhook_events (
  id uuid PRIMARY KEY,
  provider varchar(32) NOT NULL,
  provider_event_id varchar(255),
  event_type varchar(64),
  provider_status varchar(64),
  payload_sha256 varchar(64) NOT NULL,
  signature_method varchar(24),
  signature_valid boolean NOT NULL,
  received_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at timestamp with time zone,
  processing_error_code varchar(64),
  CONSTRAINT webhook_events_provider_not_blank CHECK (btrim(provider) <> ''),
  CONSTRAINT webhook_events_payload_hash_check CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT webhook_events_signature_method_check CHECK (
    signature_method IS NULL OR signature_method IN ('v2', 'raw', 'simple')
  )
);

CREATE UNIQUE INDEX webhook_events_provider_event_uq
  ON webhook_events (provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE UNIQUE INDEX webhook_events_payload_hash_uq
  ON webhook_events (provider, payload_sha256);

CREATE INDEX webhook_events_unprocessed_idx
  ON webhook_events (received_at)
  WHERE signature_valid = true AND processed_at IS NULL;

COMMENT ON TABLE webhook_events IS 'Webhook再送排除と署名検証結果。raw payloadやPIIは原則保存しない。';

CREATE TABLE psa_verifications (
  id uuid PRIMARY KEY,
  cert_number varchar(32) NOT NULL,
  status varchar(24) NOT NULL,
  year varchar(16),
  brand varchar(255),
  category varchar(255),
  subject varchar(255),
  variety varchar(255),
  grade varchar(64),
  normalized_result jsonb,
  checked_at timestamp with time zone NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT psa_verifications_cert_number_check CHECK (cert_number ~ '^[0-9]{1,32}$'),
  CONSTRAINT psa_verifications_status_check CHECK (
    status IN ('verified', 'not_found', 'invalid_request', 'unavailable', 'in_review')
  ),
  CONSTRAINT psa_verifications_result_object_check CHECK (
    normalized_result IS NULL OR jsonb_typeof(normalized_result) = 'object'
  ),
  CONSTRAINT psa_verifications_expiration_check CHECK (expires_at > checked_at),
  CONSTRAINT psa_verifications_id_cert_unique UNIQUE (id, cert_number)
);

CREATE INDEX psa_verifications_cert_checked_idx
  ON psa_verifications (cert_number, checked_at DESC);

COMMENT ON TABLE psa_verifications IS 'PSA Public API照会の履歴と正規化結果。APIのraw responseを無制限に保存しない。';

CREATE TABLE cards (
  id uuid PRIMARY KEY,
  current_owner_id uuid NOT NULL REFERENCES users(id),
  psa_cert_number varchar(32),
  latest_psa_verification_id uuid,
  name varchar(255) NOT NULL,
  series varchar(255),
  card_number varchar(64),
  grade varchar(64),
  status varchar(32) NOT NULL DEFAULT 'draft',
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT cards_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT cards_cert_number_check CHECK (
    psa_cert_number IS NULL OR psa_cert_number ~ '^[0-9]{1,32}$'
  ),
  CONSTRAINT cards_latest_psa_requires_cert_check CHECK (
    latest_psa_verification_id IS NULL OR psa_cert_number IS NOT NULL
  ),
  CONSTRAINT cards_status_check CHECK (
    status IN ('draft', 'verification_pending', 'verified', 'in_review', 'rejected', 'archived')
  ),
  CONSTRAINT cards_latest_psa_matches_cert_fk
    FOREIGN KEY (latest_psa_verification_id, psa_cert_number)
    REFERENCES psa_verifications(id, cert_number)
);

CREATE UNIQUE INDEX cards_psa_cert_number_uq
  ON cards (psa_cert_number)
  WHERE psa_cert_number IS NOT NULL;

CREATE INDEX cards_owner_status_idx ON cards (current_owner_id, status, created_at DESC);

COMMENT ON TABLE cards IS '出品ではなく物理カード個体。売買完了時はcurrent_owner_idを更新する。';

CREATE TABLE card_images (
  id uuid PRIMARY KEY,
  card_id uuid NOT NULL REFERENCES cards(id),
  uploaded_by_user_id uuid NOT NULL REFERENCES users(id),
  image_kind varchar(32) NOT NULL,
  storage_bucket varchar(255) NOT NULL,
  storage_object varchar(1024) NOT NULL,
  content_type varchar(100) NOT NULL,
  byte_size bigint NOT NULL,
  sha256 varchar(64) NOT NULL,
  capture_nonce varchar(255),
  retention_until timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT card_images_kind_check CHECK (
    image_kind IN (
      'front', 'back', 'label', 'corner_top_left', 'corner_top_right',
      'corner_bottom_left', 'corner_bottom_right', 'possession'
    )
  ),
  CONSTRAINT card_images_bucket_not_blank CHECK (btrim(storage_bucket) <> ''),
  CONSTRAINT card_images_object_not_blank CHECK (btrim(storage_object) <> ''),
  CONSTRAINT card_images_content_type_check CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT card_images_byte_size_check CHECK (byte_size > 0),
  CONSTRAINT card_images_sha256_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT card_images_storage_object_unique UNIQUE (storage_bucket, storage_object),
  CONSTRAINT card_images_id_card_unique UNIQUE (id, card_id)
);

CREATE INDEX card_images_card_kind_idx ON card_images (card_id, image_kind, created_at DESC);

COMMENT ON TABLE card_images IS '非公開Cloud Storage上のカード画像metadata。画像本文はDBへ保存しない。';

CREATE TABLE card_image_analyses (
  id uuid PRIMARY KEY,
  card_id uuid NOT NULL REFERENCES cards(id),
  source_image_id uuid NOT NULL,
  comparison_image_id uuid,
  analysis_kind varchar(32) NOT NULL,
  provider varchar(32) NOT NULL,
  model varchar(128),
  prompt_version varchar(64),
  status varchar(24) NOT NULL DEFAULT 'pending',
  score numeric(5, 4),
  normalized_result jsonb,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT card_image_analyses_kind_check CHECK (
    analysis_kind IN ('ocr', 'label_detection', 'object_localization', 'image_comparison')
  ),
  CONSTRAINT card_image_analyses_provider_not_blank CHECK (btrim(provider) <> ''),
  CONSTRAINT card_image_analyses_status_check CHECK (
    status IN ('pending', 'processing', 'completed', 'in_review', 'failed')
  ),
  CONSTRAINT card_image_analyses_score_check CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
  CONSTRAINT card_image_analyses_result_object_check CHECK (
    normalized_result IS NULL OR jsonb_typeof(normalized_result) = 'object'
  ),
  CONSTRAINT card_image_analyses_distinct_images_check CHECK (
    comparison_image_id IS NULL OR comparison_image_id <> source_image_id
  ),
  CONSTRAINT card_image_analyses_source_card_fk
    FOREIGN KEY (source_image_id, card_id) REFERENCES card_images(id, card_id),
  CONSTRAINT card_image_analyses_comparison_card_fk
    FOREIGN KEY (comparison_image_id, card_id) REFERENCES card_images(id, card_id)
);

CREATE INDEX card_image_analyses_card_created_idx
  ON card_image_analyses (card_id, created_at DESC);

CREATE INDEX card_image_analyses_pending_idx
  ON card_image_analyses (created_at)
  WHERE status IN ('pending', 'processing');

COMMENT ON TABLE card_image_analyses IS 'Vision/Gemini/自社比較ロジックの補助結果。単独で真贋を保証しない。';

CREATE TABLE listings (
  id uuid PRIMARY KEY,
  card_id uuid NOT NULL REFERENCES cards(id),
  seller_id uuid NOT NULL REFERENCES seller_profiles(user_id),
  title varchar(255) NOT NULL,
  description text,
  price_minor bigint NOT NULL,
  currency char(3) NOT NULL DEFAULT 'JPY',
  status varchar(24) NOT NULL DEFAULT 'draft',
  published_at timestamp with time zone,
  closed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT listings_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT listings_price_check CHECK (price_minor > 0),
  CONSTRAINT listings_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT listings_status_check CHECK (status IN ('draft', 'active', 'reserved', 'sold', 'closed')),
  CONSTRAINT listings_published_at_check CHECK (
    status NOT IN ('active', 'reserved', 'sold') OR published_at IS NOT NULL
  ),
  CONSTRAINT listings_id_seller_unique UNIQUE (id, seller_id)
);

CREATE UNIQUE INDEX listings_one_open_per_card_uq
  ON listings (card_id)
  WHERE status IN ('active', 'reserved');

CREATE INDEX listings_public_idx
  ON listings (published_at DESC, id)
  WHERE status = 'active';

CREATE INDEX listings_seller_status_idx ON listings (seller_id, status, created_at DESC);

COMMENT ON TABLE listings IS 'カードの出品条件と価格。カード個体そのものとは分離する。';

CREATE TABLE orders (
  id uuid PRIMARY KEY,
  listing_id uuid NOT NULL,
  buyer_id uuid NOT NULL REFERENCES users(id),
  seller_id uuid NOT NULL REFERENCES seller_profiles(user_id),
  status varchar(32) NOT NULL DEFAULT 'pending_payment',
  price_minor bigint NOT NULL,
  currency char(3) NOT NULL,
  paid_at timestamp with time zone,
  completed_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT orders_parties_check CHECK (buyer_id <> seller_id),
  CONSTRAINT orders_price_check CHECK (price_minor > 0),
  CONSTRAINT orders_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT orders_status_check CHECK (
    status IN (
      'pending_payment', 'payment_submitted', 'paid', 'cancelled',
      'completed', 'refunded', 'disputed'
    )
  ),
  CONSTRAINT orders_paid_at_check CHECK (
    status NOT IN ('paid', 'completed', 'refunded', 'disputed') OR paid_at IS NOT NULL
  ),
  CONSTRAINT orders_listing_seller_fk
    FOREIGN KEY (listing_id, seller_id) REFERENCES listings(id, seller_id)
);

CREATE UNIQUE INDEX orders_one_open_per_listing_uq
  ON orders (listing_id)
  WHERE status IN ('pending_payment', 'payment_submitted', 'paid', 'completed', 'disputed');

CREATE INDEX orders_buyer_created_idx ON orders (buyer_id, created_at DESC);
CREATE INDEX orders_seller_created_idx ON orders (seller_id, created_at DESC);

COMMENT ON TABLE orders IS '購入時点の販売者・価格・通貨snapshotを保持する取引。';

CREATE TABLE payment_intents (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id),
  payer_wallet_id uuid NOT NULL,
  payee_wallet_id uuid NOT NULL,
  chain_id integer NOT NULL,
  token_address_normalized varchar(42) NOT NULL,
  from_address_normalized varchar(42) NOT NULL,
  to_address_normalized varchar(42) NOT NULL,
  amount_atomic numeric(78, 0) NOT NULL,
  token_decimals smallint NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'created',
  tx_hash varchar(66),
  expires_at timestamp with time zone NOT NULL,
  submitted_at timestamp with time zone,
  confirmed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT payment_intents_chain_id_check CHECK (chain_id > 0),
  CONSTRAINT payment_intents_token_address_check CHECK (
    token_address_normalized = lower(token_address_normalized)
    AND token_address_normalized ~ '^0x[0-9a-f]{40}$'
  ),
  CONSTRAINT payment_intents_from_address_check CHECK (
    from_address_normalized = lower(from_address_normalized)
    AND from_address_normalized ~ '^0x[0-9a-f]{40}$'
  ),
  CONSTRAINT payment_intents_to_address_check CHECK (
    to_address_normalized = lower(to_address_normalized)
    AND to_address_normalized ~ '^0x[0-9a-f]{40}$'
  ),
  CONSTRAINT payment_intents_distinct_addresses_check CHECK (
    from_address_normalized <> to_address_normalized
  ),
  CONSTRAINT payment_intents_amount_check CHECK (amount_atomic > 0),
  CONSTRAINT payment_intents_decimals_check CHECK (token_decimals BETWEEN 0 AND 255),
  CONSTRAINT payment_intents_status_check CHECK (
    status IN ('created', 'submitted', 'confirmed', 'failed', 'expired')
  ),
  CONSTRAINT payment_intents_tx_hash_check CHECK (
    tx_hash IS NULL OR (tx_hash = lower(tx_hash) AND tx_hash ~ '^0x[0-9a-f]{64}$')
  ),
  CONSTRAINT payment_intents_expiration_check CHECK (expires_at > created_at),
  CONSTRAINT payment_intents_submitted_tx_check CHECK (
    status NOT IN ('submitted', 'confirmed') OR tx_hash IS NOT NULL
  ),
  CONSTRAINT payment_intents_confirmed_at_check CHECK (
    status <> 'confirmed' OR confirmed_at IS NOT NULL
  ),
  CONSTRAINT payment_intents_payer_wallet_fk
    FOREIGN KEY (payer_wallet_id, chain_id, from_address_normalized)
    REFERENCES wallet_accounts(id, chain_id, address_normalized),
  CONSTRAINT payment_intents_payee_wallet_fk
    FOREIGN KEY (payee_wallet_id, chain_id, to_address_normalized)
    REFERENCES wallet_accounts(id, chain_id, address_normalized)
);

CREATE UNIQUE INDEX payment_intents_chain_tx_hash_uq
  ON payment_intents (chain_id, tx_hash)
  WHERE tx_hash IS NOT NULL;

CREATE UNIQUE INDEX payment_intents_one_open_per_order_uq
  ON payment_intents (order_id)
  WHERE status IN ('created', 'submitted', 'confirmed');

CREATE INDEX payment_intents_expiration_idx
  ON payment_intents (expires_at)
  WHERE status IN ('created', 'submitted');

COMMENT ON TABLE payment_intents IS 'JPYC等ERC-20支払いの期待値。browser申告ではなくreceipt eventと照合して確定する。';

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  idempotency_key varchar(128) NOT NULL,
  aggregate_type varchar(64) NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type varchar(64) NOT NULL,
  event_version smallint NOT NULL DEFAULT 1,
  canonical_payload jsonb NOT NULL,
  payload_sha256 varchar(64) NOT NULL,
  occurred_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT audit_events_idempotency_key_unique UNIQUE (idempotency_key),
  CONSTRAINT audit_events_aggregate_type_not_blank CHECK (btrim(aggregate_type) <> ''),
  CONSTRAINT audit_events_event_type_not_blank CHECK (btrim(event_type) <> ''),
  CONSTRAINT audit_events_version_check CHECK (event_version > 0),
  CONSTRAINT audit_events_payload_object_check CHECK (jsonb_typeof(canonical_payload) = 'object'),
  CONSTRAINT audit_events_payload_hash_check CHECK (payload_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE INDEX audit_events_aggregate_created_idx
  ON audit_events (aggregate_type, aggregate_id, occurred_at, id);

COMMENT ON TABLE audit_events IS 'PIIを除きcanonical化した改竄検知対象の業務イベント。';

CREATE TABLE onchain_outbox (
  audit_event_id uuid PRIMARY KEY REFERENCES audit_events(id),
  status varchar(24) NOT NULL DEFAULT 'pending',
  chain_id integer NOT NULL,
  contract_address_normalized varchar(42) NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at timestamp with time zone,
  locked_by varchar(128),
  task_enqueued_at timestamp with time zone,
  tx_hash varchar(66),
  block_number numeric(78, 0),
  submitted_at timestamp with time zone,
  confirmed_at timestamp with time zone,
  last_error_code varchar(64),
  last_error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT onchain_outbox_status_check CHECK (
    status IN ('pending', 'processing', 'submitted', 'confirmed', 'retry', 'dead')
  ),
  CONSTRAINT onchain_outbox_chain_id_check CHECK (chain_id > 0),
  CONSTRAINT onchain_outbox_contract_address_check CHECK (
    contract_address_normalized = lower(contract_address_normalized)
    AND contract_address_normalized ~ '^0x[0-9a-f]{40}$'
  ),
  CONSTRAINT onchain_outbox_attempt_count_check CHECK (attempt_count >= 0),
  CONSTRAINT onchain_outbox_tx_hash_check CHECK (
    tx_hash IS NULL OR (tx_hash = lower(tx_hash) AND tx_hash ~ '^0x[0-9a-f]{64}$')
  ),
  CONSTRAINT onchain_outbox_block_number_check CHECK (block_number IS NULL OR block_number >= 0),
  CONSTRAINT onchain_outbox_submitted_tx_check CHECK (
    status NOT IN ('submitted', 'confirmed') OR tx_hash IS NOT NULL
  ),
  CONSTRAINT onchain_outbox_confirmed_receipt_check CHECK (
    status <> 'confirmed'
    OR (confirmed_at IS NOT NULL AND block_number IS NOT NULL)
  )
);

CREATE UNIQUE INDEX onchain_outbox_chain_tx_hash_uq
  ON onchain_outbox (chain_id, tx_hash)
  WHERE tx_hash IS NOT NULL;

CREATE INDEX onchain_outbox_ready_idx
  ON onchain_outbox (next_attempt_at, created_at, audit_event_id)
  WHERE status IN ('pending', 'retry');

CREATE INDEX onchain_outbox_submitted_idx
  ON onchain_outbox (submitted_at, audit_event_id)
  WHERE status = 'submitted';

COMMENT ON TABLE onchain_outbox IS 'Cloud Tasks/workerで非同期処理するオンチェーンanchorのtransactional outbox。';

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION trustca_set_updated_at();

CREATE TRIGGER seller_profiles_set_updated_at
BEFORE UPDATE ON seller_profiles
FOR EACH ROW EXECUTE FUNCTION trustca_set_updated_at();

CREATE TRIGGER seller_limits_set_updated_at
BEFORE UPDATE ON seller_limits
FOR EACH ROW EXECUTE FUNCTION trustca_set_updated_at();

CREATE TRIGGER wallet_accounts_set_updated_at
BEFORE UPDATE ON wallet_accounts
FOR EACH ROW EXECUTE FUNCTION trustca_set_updated_at();

CREATE TRIGGER seller_verifications_set_updated_at
BEFORE UPDATE ON seller_verifications
FOR EACH ROW EXECUTE FUNCTION trustca_set_updated_at();

CREATE TRIGGER cards_set_updated_at
BEFORE UPDATE ON cards
FOR EACH ROW EXECUTE FUNCTION trustca_set_updated_at();

CREATE TRIGGER card_image_analyses_set_updated_at
BEFORE UPDATE ON card_image_analyses
FOR EACH ROW EXECUTE FUNCTION trustca_set_updated_at();

CREATE TRIGGER listings_set_updated_at
BEFORE UPDATE ON listings
FOR EACH ROW EXECUTE FUNCTION trustca_set_updated_at();

CREATE TRIGGER orders_set_updated_at
BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION trustca_set_updated_at();

CREATE TRIGGER payment_intents_set_updated_at
BEFORE UPDATE ON payment_intents
FOR EACH ROW EXECUTE FUNCTION trustca_set_updated_at();

CREATE TRIGGER onchain_outbox_set_updated_at
BEFORE UPDATE ON onchain_outbox
FOR EACH ROW EXECUTE FUNCTION trustca_set_updated_at();
