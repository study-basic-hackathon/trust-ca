import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnchainConfig } from "../src/env.js";

const repository = vi.hoisted(() => ({
  claimOnchainJobs: vi.fn(),
  markOnchainConfirmed: vi.fn(),
  markOnchainFailure: vi.fn(),
  saveSubmittedTransaction: vi.fn(),
}));

vi.mock("../src/db/onchain-outbox.js", () => repository);

const { OnchainOutboxWorker, computeRetryDelayMs } = await import(
  "../src/services/onchain-worker.js"
);

const config: OnchainConfig = {
  enabled: true,
  rpcUrl: "http://localhost:8545",
  chainId: 31337,
  chainName: "Trustca Local",
  contractAddress: `0x${"1".repeat(40)}`,
  operatorPrivateKey: `0x${"2".repeat(64)}`,
  confirmations: 1,
  receiptTimeoutMs: 1_000,
  pollIntervalMs: 100,
  batchSize: 5,
  lockTimeoutSeconds: 60,
  maxAttempts: 3,
  workerId: "worker-test",
  internalToken: "x".repeat(32),
};

const baseJob = {
  auditEventId: "0198a34a-4a6c-7000-8000-000000000001",
  chainId: 31337,
  contractAddress: config.contractAddress,
  attemptCount: 1,
  txHash: null,
  payloadSha256: "a".repeat(64),
  occurredAt: new Date("2026-08-13T00:00:00Z"),
};

describe("OnchainOutboxWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repository.markOnchainFailure.mockResolvedValue("retry");
  });

  it("未送信jobを送信しreceipt確定まで記録する", async () => {
    repository.claimOnchainJobs.mockResolvedValue([baseJob]);
    const anchorClient = {
      submit: vi.fn().mockResolvedValue(`0x${"3".repeat(64)}`),
      confirm: vi.fn().mockResolvedValue({
        txHash: `0x${"3".repeat(64)}`,
        blockNumber: 12n,
      }),
    };

    const summary = await new OnchainOutboxWorker(
      {} as never,
      anchorClient,
      config,
    ).runOnce();

    expect(summary).toEqual({ claimed: 1, confirmed: 1, retried: 0, dead: 0 });
    expect(repository.saveSubmittedTransaction).toHaveBeenCalledOnce();
    expect(repository.markOnchainConfirmed).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ blockNumber: 12n }),
    );
  });

  it("tx hashがある再開jobは再送せずreceiptだけ確認する", async () => {
    const txHash = `0x${"4".repeat(64)}`;
    repository.claimOnchainJobs.mockResolvedValue([{ ...baseJob, txHash }]);
    const anchorClient = {
      submit: vi.fn(),
      confirm: vi.fn().mockResolvedValue({ txHash, blockNumber: 13n }),
    };

    await new OnchainOutboxWorker(
      {} as never,
      anchorClient,
      config,
    ).runOnce();

    expect(anchorClient.submit).not.toHaveBeenCalled();
    expect(anchorClient.confirm).toHaveBeenCalledWith(txHash);
  });

  it("確定待ちerrorはtx hashを保持してsubmittedへ戻す", async () => {
    const txHash = `0x${"5".repeat(64)}`;
    repository.claimOnchainJobs.mockResolvedValue([{ ...baseJob, txHash }]);
    repository.markOnchainFailure.mockResolvedValue("submitted");
    const anchorClient = {
      submit: vi.fn(),
      confirm: vi.fn().mockRejectedValue(new Error("RPC timeout")),
    };

    const summary = await new OnchainOutboxWorker(
      {} as never,
      anchorClient,
      config,
    ).runOnce();

    expect(summary.retried).toBe(1);
    expect(repository.markOnchainFailure).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ txHash, retryable: true }),
    );
  });

  it("送信先がworker設定と違うjobはdeadにする", async () => {
    repository.claimOnchainJobs.mockResolvedValue([
      { ...baseJob, chainId: 80002 },
    ]);
    repository.markOnchainFailure.mockResolvedValue("dead");
    const anchorClient = { submit: vi.fn(), confirm: vi.fn() };

    const summary = await new OnchainOutboxWorker(
      {} as never,
      anchorClient,
      config,
    ).runOnce();

    expect(summary.dead).toBe(1);
    expect(anchorClient.submit).not.toHaveBeenCalled();
    expect(repository.markOnchainFailure).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        errorCode: "OUTBOX_DESTINATION_MISMATCH",
        retryable: false,
      }),
    );
  });

  it("指数backoffを1時間で打ち切る", () => {
    expect(computeRetryDelayMs(1)).toBe(30_000);
    expect(computeRetryDelayMs(3)).toBe(120_000);
    expect(computeRetryDelayMs(99)).toBe(3_600_000);
  });
});
