-- DiditのセッションURLはセッション作成時にしか返らず、decision取得APIでは再取得できない。
-- 進行中セッションを再開・確認する画面のために、非機密の遷移先URLだけを保持する。

ALTER TABLE seller_verifications
  ADD COLUMN session_url text;

COMMENT ON COLUMN seller_verifications.session_url IS
  'Diditセッション作成時に返るホスト画面URL。session_token等の秘密情報は含まない。';
