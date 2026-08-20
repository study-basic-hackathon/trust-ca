import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
  type Hex,
  type PublicClient,
} from "viem";
import {
  createSiweMessage,
  generateSiweNonce,
  parseSiweMessage,
} from "viem/siwe";
import {
  ChallengeUnavailableError,
  consumeWalletChallenge,
  createWalletChallenge,
  getWalletChallenge,
} from "../db/wallet-auth.js";
import type { PaymentConfig } from "../env.js";
import { issueWalletSession } from "./session-token.js";

const SIWE_STATEMENT = "Sign in to Trustca.";

export class WalletAuthenticationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WalletAuthenticationError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class WalletAuthService {
  /**
   * 署名検証用のRPC client。EOAはオフライン検証で完結するが、
   * smart account(ZeroDev Kernel等)のERC-1271 / ERC-6492署名は
   * chain上のisValidSignature照会が必要なためpublic clientを使う。
   * 機能無効時(rpcUrl未設定)にも構築できるよう遅延初期化する。
   */
  private publicClient: PublicClient | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly config: PaymentConfig,
  ) {}

  private getPublicClient(): PublicClient {
    if (!this.publicClient) {
      const chain = defineChain({
        id: this.config.chainId,
        name: this.config.chainName,
        nativeCurrency: { name: "Native Token", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [this.config.rpcUrl] } },
      });
      this.publicClient = createPublicClient({
        chain,
        transport: http(this.config.rpcUrl),
      });
    }
    return this.publicClient;
  }

  async createChallenge(input: {
    address: `0x${string}`;
    chainId: number;
  }): Promise<{
    challengeId: string;
    message: string;
    expiresAt: string;
  }> {
    if (input.chainId !== this.config.chainId) {
      throw new WalletAuthenticationError(
        "CHAIN_NOT_SUPPORTED",
        `対応chain IDは${this.config.chainId}です。`,
      );
    }
    const address = getAddress(input.address);
    const challengeId = randomUUID();
    const nonce = generateSiweNonce();
    const issuedAt = new Date();
    const expiresAt = new Date(
      issuedAt.getTime() + this.config.challengeTtlSeconds * 1_000,
    );
    const message = createSiweMessage({
      address,
      chainId: input.chainId,
      domain: this.config.siweDomain,
      uri: this.config.siweUri,
      version: "1",
      nonce,
      issuedAt,
      expirationTime: expiresAt,
      requestId: challengeId,
      statement: SIWE_STATEMENT,
    });

    await createWalletChallenge(this.pool, {
      id: challengeId,
      chainId: input.chainId,
      address: address.toLowerCase() as `0x${string}`,
      nonceSha256: sha256(nonce),
      domain: this.config.siweDomain,
      expiresAt,
    });
    return {
      challengeId,
      message,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async verifyChallenge(input: {
    challengeId: string;
    message: string;
    signature: Hex;
  }): Promise<{
    token: string;
    expiresIn: number;
    userId: string;
    walletAddress: `0x${string}`;
    chainId: number;
  }> {
    const challenge = await getWalletChallenge(this.pool, input.challengeId);
    if (!challenge || challenge.usedAt || challenge.expiresAt <= new Date()) {
      throw new WalletAuthenticationError(
        "CHALLENGE_UNAVAILABLE",
        "署名チャレンジは使用済み、または期限切れです。",
      );
    }

    let parsed;
    try {
      parsed = parseSiweMessage(input.message);
    } catch {
      throw new WalletAuthenticationError(
        "SIWE_MESSAGE_INVALID",
        "署名メッセージの形式が不正です。",
      );
    }
    const issuedAt = parsed.issuedAt?.getTime();
    const createdAt = challenge.createdAt.getTime();
    const expirationTime = parsed.expirationTime?.getTime();
    const messageMatches =
      parsed.address?.toLowerCase() === challenge.address &&
      parsed.chainId === challenge.chainId &&
      parsed.domain === challenge.domain &&
      parsed.uri === this.config.siweUri &&
      parsed.version === "1" &&
      parsed.requestId === challenge.id &&
      parsed.statement === SIWE_STATEMENT &&
      typeof parsed.nonce === "string" &&
      sha256(parsed.nonce) === challenge.nonceSha256 &&
      typeof issuedAt === "number" &&
      issuedAt >= createdAt - 5_000 &&
      issuedAt <= Date.now() + 60_000 &&
      expirationTime === challenge.expiresAt.getTime();

    if (!messageMatches) {
      throw new WalletAuthenticationError(
        "SIWE_MESSAGE_MISMATCH",
        "署名メッセージが発行済みチャレンジと一致しません。",
      );
    }

    let signatureValid = false;
    try {
      // publicClient.verifyMessageはEOA署名に加え、smart accountの
      // ERC-1271(デプロイ済み)・ERC-6492(未デプロイ)署名も検証できる
      signatureValid = await this.getPublicClient().verifyMessage({
        address: getAddress(challenge.address),
        message: input.message,
        signature: input.signature,
      });
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) {
      throw new WalletAuthenticationError(
        "INVALID_WALLET_SIGNATURE",
        "ウォレット署名を確認できませんでした。",
      );
    }

    let wallet;
    try {
      wallet = await consumeWalletChallenge(this.pool, {
        challengeId: challenge.id,
        chainId: challenge.chainId,
        address: challenge.address,
      });
    } catch (error) {
      if (error instanceof ChallengeUnavailableError) {
        throw new WalletAuthenticationError(
          "CHALLENGE_UNAVAILABLE",
          error.message,
        );
      }
      throw error;
    }
    const token = await issueWalletSession(
      {
        userId: wallet.userId,
        walletAddress: wallet.address,
        chainId: wallet.chainId,
      },
      this.config,
    );
    return {
      token,
      expiresIn: this.config.sessionTtlSeconds,
      userId: wallet.userId,
      walletAddress: wallet.address,
      chainId: wallet.chainId,
    };
  }
}
