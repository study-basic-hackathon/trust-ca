# Trust-CA frontend

Next.js(App Router)。Firebase App HostingでのSSRを前提にしており、`output: "export"`は使わない。

サーバー側の役割はSSR/画面描画に付随する処理までで、業務ロジックは持たない。業務ロジックはすべて[backend/](../backend/)(Hono API)に集約する方針。詳細は[docs/design/system-architecture.md](../docs/design/system-architecture.md)を参照。

## セットアップ

```bash
cp .env.example .env
pnpm install
```

## ローカル起動(単体)

```bash
pnpm dev
# → http://localhost:3000
```

`BACKEND_URL`と`NEXT_PUBLIC_BACKEND_URL`が指すbackendに到達できる状態で起動する必要がある(`docker compose up backend`等)。前者はSSR用、後者はブラウザからの直接fetch用であり、秘密情報を`NEXT_PUBLIC_*`へ指定してはならない。

## Docker Composeでの起動

リポジトリルートで:

```bash
docker compose up
```

frontend・backend・db(PostgreSQL)がまとめて起動する。frontendは`http://localhost:3000`。トップページはbackendの疎通状況を表示し、PSA証明書番号の照会フォームからbackendへ直接リクエストする。

## JPYC決済MVP画面

`/payments/demo`はMetaMask Embedded Wallets（旧Web3Auth）v11とWagmi 3を使い、SIWE認証、payment intent確認、JPYC transfer、非同期確定statusを日本語UIで検証する。

```dotenv
NEXT_PUBLIC_BACKEND_URL=http://localhost:8080
NEXT_PUBLIC_WEB3AUTH_CLIENT_ID=<Dashboardで発行したclient ID>
NEXT_PUBLIC_PAYMENT_CHAIN_ID=31337
NEXT_PUBLIC_PAYMENT_RPC_URL=http://localhost:8545
```

client ID未設定時はwallet SDKを初期化せず、設定案内だけを表示する。Trustca sessionは画面のmemory内だけに保持し、`localStorage`へ保存しない。手順と安全上の注意は[JPYC決済・ウォレット認証MVP設計書](../docs/design/jpyc-payment.md)を参照する。
