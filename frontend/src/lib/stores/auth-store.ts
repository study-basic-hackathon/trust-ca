"use client";

import { create } from "zustand";
import type { Address } from "viem";

export type AuthStatus =
  | "signed_out" // 未接続
  | "connected" // wallet接続済み・Trustca session未発行
  | "signing" // SIWE署名・検証中
  | "signed_in"; // Trustca session保持

export type AuthSession = {
  token: string;
  walletAddress: Address;
  chainId: number;
};

/**
 * sessionトークンはsessionStorageに保持する。
 *
 * 設計上の判断: 当初はXSS対策としてメモリのみ(リロードで消滅)としていたが、
 * eKYC(Diditへの全画面リダイレクト)やマイページ等の複数ステップのフローで
 * リロード/外部遷移のたびにログアウトしてしまい実用に耐えなかった。
 * sessionStorageはタブを閉じると消え、他タブとも共有されないため、メモリ保持と
 * XSSリスクは実質同等(いずれもページ内JSから読める)である一方、リロード・
 * 外部リダイレクト後のセッション維持という実用性を得られる。真のトークン漏洩対策
 * (httpOnly cookie等)は別途の課題とする。
 */
const STORAGE_KEY = "trustca.session";

/** JWTのexpクレームを検証する。復号できない・期限切れは無効とみなす */
function isTokenValid(token: string): boolean {
  try {
    const payload = token.split(".")[1];
    if (!payload) return false;
    const json = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { exp?: number };
    if (typeof json.exp !== "number") return false;
    // 30秒のマージンを取り、期限直前のトークンは無効扱いにする
    return json.exp * 1000 > Date.now() + 30_000;
  } catch {
    return false;
  }
}

function loadPersistedSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (
      typeof parsed?.token !== "string" ||
      typeof parsed?.walletAddress !== "string" ||
      typeof parsed?.chainId !== "number" ||
      !isTokenValid(parsed.token)
    ) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function persistSession(session: AuthSession | null): void {
  if (typeof window === "undefined") return;
  try {
    if (session) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ストレージ書き込み不可(プライベートモード等)は致命的でないため握りつぶす
  }
}

type AuthState = {
  status: AuthStatus;
  session: AuthSession | null;
  setStatus: (status: AuthStatus) => void;
  setSession: (session: AuthSession) => void;
  clear: () => void;
};

const persisted = loadPersistedSession();

export const useAuthStore = create<AuthState>((set) => ({
  status: persisted ? "signed_in" : "signed_out",
  session: persisted,
  setStatus: (status) => set({ status }),
  setSession: (session) => {
    persistSession(session);
    set({ session, status: "signed_in" });
  },
  clear: () => {
    persistSession(null);
    set({ session: null, status: "signed_out" });
  },
}));
