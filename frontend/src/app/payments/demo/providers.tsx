"use client";

import type { ReactNode } from "react";

/**
 * Web3Auth / Wagmi / QueryClient はアプリ全体のAppProviders
 * (src/components/providers.tsx)が提供するため、本コンポーネントは
 * 二重初期化を避ける透過ラッパーとして残している。
 * 本画面は購入フロー実装(/orders)へ統合後に削除予定。
 */
export function PaymentProviders({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
