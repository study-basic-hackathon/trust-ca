import { setTimeout as sleep } from "node:timers/promises";
import { AuditAnchorClient } from "../blockchain/audit-anchor.js";
import { pool } from "../db.js";
import { getOnchainConfig } from "../env.js";
import { OnchainOutboxWorker } from "../services/onchain-worker.js";

const config = getOnchainConfig();
if (!config.enabled) {
  throw new Error("ONCHAIN_MVP_ENABLED=trueを指定してworkerを起動してください。");
}

const anchorClient = new AuditAnchorClient(config);
await anchorClient.assertReady();
const worker = new OnchainOutboxWorker(pool, anchorClient, config);
const abortController = new AbortController();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => abortController.abort());
}

console.log(
  `[onchain-worker] 起動しました worker=${config.workerId} chain=${config.chainId}`,
);

try {
  while (!abortController.signal.aborted) {
    const summary = await worker.runOnce();
    if (summary.claimed > 0) {
      console.log(
        `[onchain-worker] claimed=${summary.claimed} confirmed=${summary.confirmed} retried=${summary.retried} dead=${summary.dead}`,
      );
    }
    try {
      await sleep(config.pollIntervalMs, undefined, {
        signal: abortController.signal,
      });
    } catch (error) {
      if (!abortController.signal.aborted) throw error;
    }
  }
} finally {
  await pool.end();
  console.log("[onchain-worker] 停止しました。");
}
