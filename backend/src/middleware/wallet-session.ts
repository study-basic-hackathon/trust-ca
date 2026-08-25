import type { Context } from "hono";
import type { PaymentConfig } from "../env.js";
import {
  sessionFromAuthorization,
  type WalletSession,
} from "../services/session-token.js";

/**
 * Authorizationヘッダーのwallet sessionを検証する。
 * 失敗時はnullを返し、呼び出し側で401レスポンスを返す。
 */
export async function resolveWalletSession(
  c: Context,
  config: PaymentConfig,
): Promise<WalletSession | null> {
  return sessionFromAuthorization(c.req.header("authorization"), config);
}

export const UNAUTHORIZED_RESPONSE = {
  error: {
    code: "UNAUTHORIZED",
    message: "ログインが必要です。ウォレット署名でログインしてください。",
  },
} as const;
