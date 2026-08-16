import type { Pool } from "pg";
import type { Hash } from "viem";
import type { JpycPaymentClient } from "../blockchain/jpyc-payment.js";
import {
  createPaymentIntent,
  getPaymentIntentForSession,
  submitPaymentTransaction,
} from "../db/payments.js";
import type { PaymentConfig } from "../env.js";
import type { WalletSession } from "./session-token.js";

export class PaymentService {
  constructor(
    private readonly pool: Pool,
    private readonly paymentClient: Pick<JpycPaymentClient, "getMetadata">,
    private readonly config: PaymentConfig,
  ) {}

  async createIntent(orderId: string, session: WalletSession) {
    const metadata = await this.paymentClient.getMetadata();
    return createPaymentIntent(this.pool, {
      orderId,
      session,
      chainId: this.config.chainId,
      tokenAddress: metadata.address,
      tokenDecimals: metadata.decimals,
      lifetimeSeconds: this.config.intentLifetimeSeconds,
    });
  }

  async submitTransaction(
    paymentIntentId: string,
    txHash: Hash,
    session: WalletSession,
  ) {
    return submitPaymentTransaction(this.pool, {
      paymentIntentId,
      txHash,
      session,
    });
  }

  async getIntent(paymentIntentId: string, session: WalletSession) {
    return getPaymentIntentForSession(this.pool, { paymentIntentId, session });
  }
}
