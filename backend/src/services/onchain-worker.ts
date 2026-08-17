import type { Pool } from "pg";
import type { Hash } from "viem";
import { OnchainAnchorError, type AuditAnchorClient } from "../blockchain/audit-anchor.js";
import {
  claimOnchainJobs,
  markOnchainConfirmed,
  markOnchainFailure,
  saveSubmittedTransaction,
  type OnchainOutboxJob,
} from "../db/onchain-outbox.js";
import type { OnchainConfig } from "../env.js";

export type WorkerRunSummary = {
  claimed: number;
  confirmed: number;
  retried: number;
  dead: number;
};

export function computeRetryDelayMs(attemptCount: number): number {
  return Math.min(3_600_000, 30_000 * 2 ** Math.max(0, attemptCount - 1));
}

export class OnchainOutboxWorker {
  constructor(
    private readonly pool: Pool,
    private readonly anchorClient: Pick<AuditAnchorClient, "submit" | "confirm">,
    private readonly config: OnchainConfig,
  ) {}

  async runOnce(): Promise<WorkerRunSummary> {
    const jobs = await claimOnchainJobs(this.pool, {
      workerId: this.config.workerId,
      batchSize: this.config.batchSize,
      lockTimeoutSeconds: this.config.lockTimeoutSeconds,
    });
    const summary: WorkerRunSummary = {
      claimed: jobs.length,
      confirmed: 0,
      retried: 0,
      dead: 0,
    };

    for (const job of jobs) {
      const outcome = await this.processJob(job);
      summary[outcome] += 1;
    }
    return summary;
  }

  private async processJob(
    job: OnchainOutboxJob,
  ): Promise<"confirmed" | "retried" | "dead"> {
    let txHash = job.txHash as Hash | null;
    try {
      if (
        job.chainId !== this.config.chainId ||
        job.contractAddress.toLowerCase() !==
          this.config.contractAddress.toLowerCase()
      ) {
        throw new OnchainAnchorError(
          "OUTBOX_DESTINATION_MISMATCH",
          "outboxのchainまたはcontractがworker設定と一致しません。",
          false,
        );
      }

      if (!txHash) {
        txHash = await this.anchorClient.submit({
          auditEventId: job.auditEventId,
          payloadSha256: job.payloadSha256,
          occurredAt: job.occurredAt,
        });
        await saveSubmittedTransaction(this.pool, {
          auditEventId: job.auditEventId,
          workerId: this.config.workerId,
          txHash,
        });
      }

      const receipt = await this.anchorClient.confirm(txHash);
      await markOnchainConfirmed(this.pool, {
        auditEventId: job.auditEventId,
        workerId: this.config.workerId,
        txHash: receipt.txHash,
        blockNumber: receipt.blockNumber,
      });
      return "confirmed";
    } catch (error) {
      const anchorError =
        error instanceof OnchainAnchorError
          ? error
          : new OnchainAnchorError(
              "UNEXPECTED_WORKER_ERROR",
              "予期しないworker errorが発生しました。",
              true,
              txHash ?? undefined,
              error,
            );
      const status = await markOnchainFailure(this.pool, {
        auditEventId: job.auditEventId,
        workerId: this.config.workerId,
        errorCode: anchorError.code,
        errorMessage: anchorError.message,
        retryable: anchorError.retryable,
        attemptCount: job.attemptCount,
        maxAttempts: this.config.maxAttempts,
        txHash: anchorError.txHash ?? txHash,
        retryDelayMs: computeRetryDelayMs(job.attemptCount),
      });
      console.error(
        `[onchain-worker] event=${job.auditEventId} status=${status} code=${anchorError.code}`,
      );
      return status === "dead" ? "dead" : "retried";
    }
  }
}
