# Trustca blockchain

監査eventのhashをEVM chainへ非同期に固定するMVP contract。カード情報、氏名、住所等の原文はchainへ書かない。

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
