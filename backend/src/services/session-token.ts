import { randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { isAddress } from "viem";
import type { PaymentConfig } from "../env.js";

const ISSUER = "trustca";
const AUDIENCE = "trustca-api";

export type WalletSession = {
  userId: string;
  walletAddress: `0x${string}`;
  chainId: number;
};

function signingKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function issueWalletSession(
  session: WalletSession,
  config: PaymentConfig,
): Promise<string> {
  return new SignJWT({
    walletAddress: session.walletAddress.toLowerCase(),
    chainId: session.chainId,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(session.userId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${config.sessionTtlSeconds}s`)
    .sign(signingKey(config.sessionSecret));
}

export async function verifyWalletSession(
  token: string,
  config: PaymentConfig,
): Promise<WalletSession> {
  const { payload } = await jwtVerify(token, signingKey(config.sessionSecret), {
    algorithms: ["HS256"],
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  if (
    typeof payload.sub !== "string" ||
    typeof payload.walletAddress !== "string" ||
    !isAddress(payload.walletAddress) ||
    typeof payload.chainId !== "number" ||
    !Number.isSafeInteger(payload.chainId) ||
    payload.chainId <= 0
  ) {
    throw new Error("session tokenのclaimが不正です。");
  }
  return {
    userId: payload.sub,
    walletAddress: payload.walletAddress.toLowerCase() as `0x${string}`,
    chainId: payload.chainId,
  };
}

export async function sessionFromAuthorization(
  header: string | undefined,
  config: PaymentConfig,
): Promise<WalletSession | null> {
  if (!header?.startsWith("Bearer ")) return null;
  try {
    return await verifyWalletSession(header.slice(7), config);
  } catch {
    return null;
  }
}
