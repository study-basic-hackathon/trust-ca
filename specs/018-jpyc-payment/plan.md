# Implementation Plan: JPYC決済MVP

## 1. 方針

Node-Stayのwallet接続・chain interactionを参考にしつつ、Trustcaの分離済みNext.js/Hono/PostgreSQL構成へ移植する。認証とreceipt検証をbackendへ寄せ、clientを信頼境界の外に置く。

## 2. 実装単位

1. `0002_payment_verification_queue.sql`でpayment workerの状態列を追加する。
2. SIWE challenge repository、wallet auth service、session token、API routeを実装する。
3. JPYC metadata・transaction・receipt検証clientを実装する。
4. payment intent repository/APIと非同期workerを実装する。
5. `MockJPYC`、deploy、Hardhat testを追加する。
6. Docker Composeへpayment設定とworkerを追加する。
7. Embedded Wallets v11 + Wagmi 3の日本語demo UIを追加する。
8. unit、migration、local chain E2E、audit、production buildを実行する。

## 3. Branch / PR

- branch: `feat/18-jpyc-payment`
- base: `main`
- 依存: Issue #17のchain/viem/Compose基盤、およびIssue #14のDB schema
- PRでは先行PRのmerge順を明記する。

## 4. Gate

- E2Eが通るまでmainnet addressをdefault有効にしない。
- browser申告だけで`paid`へ進む経路を作らない。
- エスクローへscopeを拡張しない。
- frontend hookはEmbedded Wallets provider配下だけでrenderする。
