# Research: JPYC決済MVP

## 1. Embedded Wallets

Web3AuthはMetaMask Embedded Walletsとして提供されている。現行React SDK v11の`Web3AuthProvider`、Wagmi provider、connect/disconnect hookを採用する。localhostではSapphire Devnet、productionではdashboard設定と利用networkを再確認する。

- [Embedded Wallets](https://docs.metamask.io/embedded-wallets/)
- [React SDK](https://docs.metamask.io/embedded-wallets/sdk/react/)

## 2. SIWE

[EIP-4361](https://eips.ethereum.org/EIPS/eip-4361)はdomain、address、URI、version、chain ID、nonce、issued-at等のmessage formatと、EOAでのERC-191検証を定義する。MVPはbackendがmessageを発行し、全fieldを保存値と照合する。

EIP-1271 contract accountはchain stateを参照する追加設計が必要なため対象外とする。

## 3. JPYC

[JPYC公式GitHub](https://github.com/jpycoin)では2026-08-13時点でPolygon chain ID 137とcontract `0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29`が案内されている。旧前払式JPYCと異なるため、addressを混同しない。

[JPYC EX正式リリース](https://corporate.jpyc.co.jp/news/posts/jpyc-ex-launch)によると、現行JPYCは電子決済手段として2025年10月27日に発行開始し、Polygon、Ethereum、Avalancheに対応する。

仕様変更と誤token対策として、addressをenvへ置き、起動時にchain、bytecode、symbol、decimalsを取得する。

## 4. 直接送金とエスクロー

MVPはbuyer→sellerの直接`transfer`を採用する。Trustcaがcustodyを持たず実装も小さい一方、カード配送・返品と送金はatomicにならない。エスクローはUXを改善し得るが、contract audit、鍵・upgrade権限、返金、法規制の検討が必要であり別featureとする。

## 5. Node-Stayとの差分

- in-memory nonceをPostgreSQL challengeへ変更
- Web3Auth v10をEmbedded Wallets v11へ更新
- decimals決め打ちをruntime metadataへ変更
- tx hash申告をreceipt + calldata + log検証へ変更
- browser中心の状態をPostgreSQL workerへ変更
