# Trustca blockchain

監査eventのhashをEVM chainへ非同期に固定するMVP contractと、JPYC決済のlocal E2E専用`MockJPYC`を収録する。カード情報、氏名、住所等の原文はchainへ書かない。

## セットアップとテスト

```bash
pnpm install
pnpm build
pnpm test
```

## Local node

```bash
pnpm node
```

別terminalで:

```bash
pnpm deploy:local
```

Docker Composeを使ったPostgreSQL→worker→local chainの検証は[非同期オンチェーン記録設計書](../docs/design/async-onchain-write.md)を参照。

`MockJPYC`はHardhat account #1へ1,000,000 tokenをmintする最小ERC-20 mockであり、本番deployは禁止する。SIWEから支払確定までの検証は[JPYC決済・ウォレット認証MVP設計書](../docs/design/jpyc-payment.md#12-ローカル検証)を参照。
