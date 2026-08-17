import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import {
  createPublicClient,
  http,
  keccak256,
  toBytes,
} from "viem";

const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8080";
const rpcUrl = process.env.ONCHAIN_RPC_URL ?? "http://localhost:8545";
const internalToken = process.env.ONCHAIN_INTERNAL_TOKEN;

if (!internalToken) {
  throw new Error("ONCHAIN_INTERNAL_TOKENを指定してください。");
}

const auditAnchorAbi = [
  {
    type: "function",
    name: "anchors",
    stateMutability: "view",
    inputs: [{ name: "eventKey", type: "bytes32" }],
    outputs: [{ name: "payloadHash", type: "bytes32" }],
  },
];

async function request(path, init = {}) {
  const response = await globalThis.fetch(`${backendUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${internalToken}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.json();
  return { response, body };
}

const aggregateId = randomUUID();
const body = {
  idempotencyKey: `e2e.order.completed:${randomUUID()}`,
  aggregateType: "order",
  aggregateId,
  eventType: "order.completed",
  eventVersion: 1,
  occurredAt: new Date().toISOString(),
  payload: {
    orderId: aggregateId,
    amount: "12000",
    currency: "JPYC",
    paymentStatus: "confirmed",
  },
};

const first = await request("/api/v1/internal/onchain-anchors", {
  method: "POST",
  body: JSON.stringify(body),
});
assert.equal(first.response.status, 202, JSON.stringify(first.body));
assert.equal(first.body.data.created, true);
const { auditEventId, contractAddress, payloadSha256 } = first.body.data;
console.log(`  OK: outbox登録 event=${auditEventId}`);

const duplicate = await request("/api/v1/internal/onchain-anchors", {
  method: "POST",
  body: JSON.stringify(body),
});
assert.equal(duplicate.response.status, 200, JSON.stringify(duplicate.body));
assert.equal(duplicate.body.data.created, false);
assert.equal(duplicate.body.data.auditEventId, auditEventId);
console.log("  OK: API再送時の冪等性");

const deadline = Date.now() + 45_000;
let status;
while (Date.now() < deadline) {
  const current = await request(
    `/api/v1/internal/onchain-anchors/${auditEventId}`,
  );
  assert.equal(current.response.status, 200, JSON.stringify(current.body));
  status = current.body.data;
  if (status.status === "confirmed" || status.status === "dead") break;
  await sleep(500);
}
assert.equal(status?.status, "confirmed", JSON.stringify(status));
assert.match(status.txHash, /^0x[0-9a-f]{64}$/);
assert.match(status.blockNumber, /^\d+$/);
console.log(`  OK: workerがblock ${status.blockNumber} で確定を記録`);

const publicClient = createPublicClient({ transport: http(rpcUrl) });
const storedHash = await publicClient.readContract({
  address: contractAddress,
  abi: auditAnchorAbi,
  functionName: "anchors",
  args: [keccak256(toBytes(auditEventId))],
});
assert.equal(storedHash.toLowerCase(), `0x${payloadSha256}`.toLowerCase());
console.log("  OK: contract上のhashがPostgreSQLのpayload hashと一致");
console.log("非同期オンチェーン記録E2Eに成功しました。");
