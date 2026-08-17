import { beforeEach, describe, expect, it, vi } from "vitest";
import { JpycPaymentError } from "../src/blockchain/jpyc-payment.js";
import type { PaymentConfig } from "../src/env.js";

const repository = vi.hoisted(() => ({
  claimPaymentVerificationJobs: vi.fn(),
  markPaymentConfirmed: vi.fn(),
  markPaymentVerificationFailure: vi.fn(),
}));

vi.mock("../src/db/payments.js", () => repository);

const { PaymentVerificationWorker, computePaymentRetryDelayMs } = await import(
  "../src/services/payment-worker.js"
);

const config: PaymentConfig = {
  enabled: true,
  rpcUrl: "http://localhost:8545",
  chainId: 31337,
  chainName: "Trustca Local",
  tokenAddress: `0x${"1".repeat(40)}`,
  expectedSymbol: "JPYC",
  confirmations: 1,
  pollIntervalMs: 100,
  batchSize: 5,
  lockTimeoutSeconds: 60,
  verificationTimeoutSeconds: 3_600,
  intentLifetimeSeconds: 900,
  workerId: "payment-worker-test",
  sessionSecret: "s".repeat(32),
  sessionTtlSeconds: 3_600,
  siweDomain: "localhost:3000",
  siweUri: "http://localhost:3000",
  challengeTtlSeconds: 300,
};

const baseJob = {
  id: "0198a34a-4a6c-7000-8000-000000000001",
  orderId: "0198a34a-4a6c-7000-8000-000000000002",
  chainId: config.chainId,
  tokenAddress: config.tokenAddress,
  payerAddress: `0x${"2".repeat(40)}` as const,
  payeeAddress: `0x${"3".repeat(40)}` as const,
  amountAtomic: 12_000n * 10n ** 18n,
  txHash: `0x${"4".repeat(64)}` as const,
  attemptCount: 1,
  submittedAt: new Date(),
};

describe("PaymentVerificationWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repository.markPaymentVerificationFailure.mockResolvedValue("submitted");
  });

  it("期待値と一致するJPYC transferをconfirmedへ進める", async () => {
    repository.claimPaymentVerificationJobs.mockResolvedValue([baseJob]);
    const paymentClient = {
      verifyTransfer: vi.fn().mockResolvedValue({ blockNumber: 21n }),
    };

    const summary = await new PaymentVerificationWorker(
      {} as never,
      paymentClient,
      config,
    ).runOnce();

    expect(summary).toEqual({ claimed: 1, confirmed: 1, retried: 0, failed: 0 });
    expect(paymentClient.verifyTransfer).toHaveBeenCalledWith(baseJob.txHash, {
      payerAddress: baseJob.payerAddress,
      payeeAddress: baseJob.payeeAddress,
      amountAtomic: baseJob.amountAtomic,
    });
    expect(repository.markPaymentConfirmed).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ blockNumber: 21n }),
    );
  });

  it("receipt確定待ちはbackoffして再検証する", async () => {
    repository.claimPaymentVerificationJobs.mockResolvedValue([baseJob]);
    const paymentClient = {
      verifyTransfer: vi.fn().mockRejectedValue(
        new JpycPaymentError(
          "JPYC_CONFIRMATIONS_PENDING",
          "確定待ちです。",
          true,
        ),
      ),
    };

    const summary = await new PaymentVerificationWorker(
      {} as never,
      paymentClient,
      config,
    ).runOnce();

    expect(summary.retried).toBe(1);
    expect(repository.markPaymentVerificationFailure).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ terminal: false }),
    );
  });

  it("金額等の不一致はfailedへ進める", async () => {
    repository.claimPaymentVerificationJobs.mockResolvedValue([baseJob]);
    repository.markPaymentVerificationFailure.mockResolvedValue("failed");
    const paymentClient = {
      verifyTransfer: vi.fn().mockRejectedValue(
        new JpycPaymentError(
          "JPYC_TRANSFER_INPUT_MISMATCH",
          "transfer内容が一致しません。",
          false,
        ),
      ),
    };

    const summary = await new PaymentVerificationWorker(
      {} as never,
      paymentClient,
      config,
    ).runOnce();

    expect(summary.failed).toBe(1);
    expect(repository.markPaymentVerificationFailure).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ terminal: true }),
    );
  });

  it("検証期限を超えたjobはretryable errorでもfailedにする", async () => {
    repository.claimPaymentVerificationJobs.mockResolvedValue([
      {
        ...baseJob,
        submittedAt: new Date(Date.now() - 3_601_000),
      },
    ]);
    repository.markPaymentVerificationFailure.mockResolvedValue("failed");
    const paymentClient = {
      verifyTransfer: vi.fn().mockRejectedValue(new Error("RPC timeout")),
    };

    await new PaymentVerificationWorker(
      {} as never,
      paymentClient,
      config,
    ).runOnce();

    expect(repository.markPaymentVerificationFailure).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        errorCode: "JPYC_VERIFICATION_TIMEOUT",
        terminal: true,
      }),
    );
  });

  it("指数backoffを5分で打ち切る", () => {
    expect(computePaymentRetryDelayMs(1)).toBe(3_000);
    expect(computePaymentRetryDelayMs(3)).toBe(12_000);
    expect(computePaymentRetryDelayMs(99)).toBe(300_000);
  });
});
