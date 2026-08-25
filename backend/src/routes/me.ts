import { Hono } from "hono";
import type { Pool } from "pg";
import { getSellerById } from "../db/sellers.js";
import type { DiditConfig, PaymentConfig } from "../env.js";
import {
  resolveWalletSession,
  UNAUTHORIZED_RESPONSE,
} from "../middleware/wallet-session.js";
import { getVerificationStatus } from "../services/verifications.js";

type Dependencies = {
  pool: Pool;
  walletConfig: PaymentConfig;
  diditConfig: DiditConfig;
};

/**
 * ログイン中ユーザーの統合ビュー。
 * wallet(session由来)・販売者プロフィール・eKYC状態を1回で返し、
 * frontendのマイページ・ガード判定の唯一の情報源とする。
 */
export function createMeRoute(dependencies: Dependencies): Hono {
  const route = new Hono();

  route.get("/api/v1/me", async (c) => {
    const session = await resolveWalletSession(c, dependencies.walletConfig);
    if (!session) {
      return c.json(UNAUTHORIZED_RESPONSE, 401);
    }

    const seller = await getSellerById(dependencies.pool, session.userId);

    let verification: Awaited<
      ReturnType<typeof getVerificationStatus>
    > | null = null;
    if (seller) {
      verification = await getVerificationStatus(
        dependencies.pool,
        dependencies.diditConfig,
        seller.id,
        { refresh: false },
      );
    }

    return c.json({
      data: {
        userId: session.userId,
        wallet: {
          address: session.walletAddress,
          chainId: session.chainId,
        },
        seller: seller
          ? {
              id: seller.id,
              displayName: seller.displayName,
              onboardingStatus: seller.onboardingStatus,
            }
          : null,
        verification: verification?.verification
          ? {
              sessionId: verification.verification.providerSessionId,
              status: verification.verification.status,
              checks: verification.verification.checks,
              decidedAt:
                verification.verification.decidedAt?.toISOString() ?? null,
            }
          : null,
        isSellingAllowed: verification?.isSellingAllowed ?? false,
      },
    });
  });

  return route;
}
