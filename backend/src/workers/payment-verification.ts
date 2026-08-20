import { setTimeout as sleep } from "node:timers/promises";
import { JpycPaymentClient } from "../blockchain/jpyc-payment.js";
import { pool } from "../db.js";
import { getOnchainConfig, getPaymentConfig } from "../env.js";
import { PaymentVerificationWorker } from "../services/payment-worker.js";

const config = getPaymentConfig();
if (!config.enabled) {
  throw new Error("PAYMENT_MVP_ENABLED=trueを指定してworkerを起動してください。");
}

const paymentClient = new JpycPaymentClient(config);
await paymentClient.assertReady();
const onchainConfig = getOnchainConfig();
const worker = new PaymentVerificationWorker(
  pool,
  paymentClient,
  config,
  onchainConfig.enabled
    ? {
        chainId: onchainConfig.chainId,
        contractAddress: onchainConfig.contractAddress,
      }
    : undefined,
);
const abortController = new AbortController();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => abortController.abort());
}

console.log(
  `[payment-worker] 起動しました worker=${config.workerId} chain=${config.chainId}`,
);

try {
  while (!abortController.signal.aborted) {
    const summary = await worker.runOnce();
    if (summary.claimed > 0) {
      console.log(
        `[payment-worker] claimed=${summary.claimed} confirmed=${summary.confirmed} retried=${summary.retried} failed=${summary.failed}`,
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
  console.log("[payment-worker] 停止しました。");
}
