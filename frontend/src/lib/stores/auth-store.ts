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

type AuthState = {
  status: AuthStatus;
  session: AuthSession | null;
  /** sessionトークンはメモリのみに保持する(localStorage禁止: jpyc-payment.md §5.2) */
  setStatus: (status: AuthStatus) => void;
  setSession: (session: AuthSession) => void;
  clear: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  status: "signed_out",
  session: null,
  setStatus: (status) => set({ status }),
  setSession: (session) => set({ session, status: "signed_in" }),
  clear: () => set({ session: null, status: "signed_out" }),
}));
