import { Hono } from "hono";
import type { Pool } from "pg";
import { isAddress, isHex, type Hex } from "viem";
import { ChallengeRateLimitError } from "../db/wallet-auth.js";
import type { PaymentConfig } from "../env.js";
import {
  WalletAuthenticationError,
  WalletAuthService,
} from "../services/wallet-auth.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Dependencies = {
  pool: Pool;
  config: PaymentConfig;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createWalletAuthRoute(dependencies: Dependencies): Hono {
  const route = new Hono();
  const service = new WalletAuthService(dependencies.pool, dependencies.config);

  route.use("/api/v1/wallet-auth/*", async (c, next) => {
    if (!dependencies.config.enabled) {
      return c.json(
        {
          error: {
            code: "PAYMENT_MVP_DISABLED",
            message: "ウォレット認証・JPYC決済機能は現在無効です。",
          },
        },
        503,
      );
    }
    await next();
  });

  route.post("/api/v1/wallet-auth/challenges", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    if (
      !isRecord(body) ||
      typeof body.address !== "string" ||
      !isAddress(body.address) ||
      typeof body.chainId !== "number" ||
      !Number.isSafeInteger(body.chainId) ||
      body.chainId <= 0
    ) {
      return c.json(
        {
          error: {
            code: "INVALID_WALLET_CHALLENGE_REQUEST",
            message: "ウォレットアドレスとchain IDを正しく指定してください。",
          },
        },
        400,
      );
    }
    try {
      const challenge = await service.createChallenge({
        address: body.address,
        chainId: body.chainId,
      });
      return c.json({ data: challenge }, 201);
    } catch (error) {
      if (error instanceof ChallengeRateLimitError) {
        return c.json(
          { error: { code: "CHALLENGE_RATE_LIMITED", message: error.message } },
          429,
        );
      }
      if (error instanceof WalletAuthenticationError) {
        return c.json(
          { error: { code: error.code, message: error.message } },
          400,
        );
      }
      console.error("ウォレット署名チャレンジの発行に失敗しました。");
      return c.json(
        {
          error: {
            code: "WALLET_CHALLENGE_CREATE_FAILED",
            message: "署名リクエストを開始できませんでした。",
          },
        },
        500,
      );
    }
  });

  route.post("/api/v1/wallet-auth/verifications", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    if (
      !isRecord(body) ||
      typeof body.challengeId !== "string" ||
      !UUID_PATTERN.test(body.challengeId) ||
      typeof body.message !== "string" ||
      body.message.length < 50 ||
      body.message.length > 4_096 ||
      typeof body.signature !== "string" ||
      !isHex(body.signature) ||
      body.signature.length !== 132
    ) {
      return c.json(
        {
          error: {
            code: "INVALID_WALLET_VERIFICATION_REQUEST",
            message: "署名検証の入力値が不正です。",
          },
        },
        400,
      );
    }
    try {
      const result = await service.verifyChallenge({
        challengeId: body.challengeId,
        message: body.message,
        signature: body.signature as Hex,
      });
      return c.json({ data: result });
    } catch (error) {
      if (error instanceof WalletAuthenticationError) {
        return c.json(
          { error: { code: error.code, message: error.message } },
          401,
        );
      }
      console.error("ウォレット署名の検証に失敗しました。");
      return c.json(
        {
          error: {
            code: "WALLET_VERIFICATION_FAILED",
            message: "ウォレット署名を検証できませんでした。",
          },
        },
        500,
      );
    }
  });

  return route;
}
