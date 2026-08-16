import type { Pool } from "pg";
import {
  JpycPaymentError,
  type JpycPaymentClient,
} from "../blockchain/jpyc-payment.js";
import {
  claimPaymentVerificationJobs,
  markPaymentConfirmed,
  markPaymentVerificationFailure,
  type PaymentVerificationJob,
} from "../db/payments.js";
import type { PaymentConfig } from "../env.js";

export type PaymentWorkerRunSummary = {
  claimed: number;
  confirmed: number;
  retried: number;
  failed: number;
};

export function computePaymentRetryDelayMs(attemptCount: number): number {
  return Math.min(300_000, 3_000 * 2 ** Math.max(0, attemptCount - 1));
}

export class PaymentVerificationWorker {
  constructor(
    private readonly pool: Pool,
    private readonly paymentClient: Pick<JpycPaymentClient, "verifyTransfer">,
    private readonly config: PaymentConfig,
  ) {}

  async runOnce(): Promise<PaymentWorkerRunSummary> {
    const jobs = await claimPaymentVerificationJobs(this.pool, {
      workerId: this.config.workerId,
      batchSize: this.config.batchSize,
      lockTimeoutSeconds: this.config.lockTimeoutSeconds,
    });
    const summary: PaymentWorkerRunSummary = {
      claimed: jobs.length,
      confirmed: 0,
      retried: 0,
      failed: 0,
    };
    for (const job of jobs) {
      const outcome = await this.processJob(job);
      summary[outcome] += 1;
    }
    return summary;
  }

  private async processJob(
    job: PaymentVerificationJob,
  ): Promise<"confirmed" | "retried" | "failed"> {
    try {
      if (
        job.chainId !== this.config.chainId ||
        job.tokenAddress.toLowerCase() !== this.config.tokenAddress.toLowerCase()
      ) {
        throw new JpycPaymentError(
          "PAYMENT_DESTINATION_MISMATCH",
          "payment intentのchainまたはtokenがworker設定と一致しません。",
          false,
        );
      }
      const receipt = await this.paymentClient.verifyTransfer(job.txHash, {
        payerAddress: job.payerAddress,
        payeeAddress: job.payeeAddress,
        amountAtomic: job.amountAtomic,
      });
      await markPaymentConfirmed(this.pool, {
        paymentIntentId: job.id,
        workerId: this.config.workerId,
        blockNumber: receipt.blockNumber,
      });
      return "confirmed";
    } catch (error) {
      const paymentError =
        error instanceof JpycPaymentError
          ? error
          : new JpycPaymentError(
              "UNEXPECTED_PAYMENT_WORKER_ERROR",
              "予期しないpayment worker errorが発生しました。",
              true,
              error,
            );
      const timedOut =
        Date.now() - job.submittedAt.getTime() >=
        this.config.verificationTimeoutSeconds * 1_000;
      const status = await markPaymentVerificationFailure(this.pool, {
        paymentIntentId: job.id,
        workerId: this.config.workerId,
        errorCode: timedOut
          ? "JPYC_VERIFICATION_TIMEOUT"
          : paymentError.code,
        errorMessage: timedOut
          ? "JPYC transferを検証期限内に確認できませんでした。"
          : paymentError.message,
        terminal: timedOut || !paymentError.retryable,
        retryDelayMs: computePaymentRetryDelayMs(job.attemptCount),
      });
      console.error(
        `[payment-worker] intent=${job.id} status=${status} code=${paymentError.code}`,
      );
      return status === "failed" ? "failed" : "retried";
    }
  }
}
