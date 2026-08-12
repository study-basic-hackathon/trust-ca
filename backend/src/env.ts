export type OnchainConfig = {
  enabled: boolean;
  rpcUrl: string;
  chainId: number;
  chainName: string;
  contractAddress: `0x${string}`;
  operatorPrivateKey: `0x${string}`;
  confirmations: number;
  receiptTimeoutMs: number;
  pollIntervalMs: number;
  batchSize: number;
  lockTimeoutSeconds: number;
  maxAttempts: number;
  workerId: string;
  internalToken: string;
};

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

function positiveInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name}には正の整数を指定してください。`);
  }
  return parsed;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}が未設定です。`);
  return value;
}

export function getOnchainConfig(): OnchainConfig {
  const enabled = process.env.ONCHAIN_MVP_ENABLED === "true";
  const rpcUrl = process.env.ONCHAIN_RPC_URL?.trim() ?? "";
  const contractAddress = process.env.ONCHAIN_ANCHOR_CONTRACT?.trim() ?? "";
  const operatorPrivateKey =
    process.env.ONCHAIN_OPERATOR_PRIVATE_KEY?.trim() ?? "";
  const internalToken = process.env.ONCHAIN_INTERNAL_TOKEN?.trim() ?? "";

  if (enabled) {
    required("ONCHAIN_RPC_URL");
    required("ONCHAIN_ANCHOR_CONTRACT");
    required("ONCHAIN_OPERATOR_PRIVATE_KEY");
    required("ONCHAIN_INTERNAL_TOKEN");
    if (!ADDRESS_PATTERN.test(contractAddress)) {
      throw new Error("ONCHAIN_ANCHOR_CONTRACTの形式が不正です。");
    }
    if (!PRIVATE_KEY_PATTERN.test(operatorPrivateKey)) {
      throw new Error("ONCHAIN_OPERATOR_PRIVATE_KEYの形式が不正です。");
    }
    if (internalToken.length < 32) {
      throw new Error("ONCHAIN_INTERNAL_TOKENは32文字以上で指定してください。");
    }
  }

  return {
    enabled,
    rpcUrl,
    chainId: positiveInteger("ONCHAIN_CHAIN_ID", 31_337),
    chainName: process.env.ONCHAIN_CHAIN_NAME?.trim() || "Trustca Local",
    contractAddress: contractAddress.toLowerCase() as `0x${string}`,
    operatorPrivateKey: operatorPrivateKey as `0x${string}`,
    confirmations: positiveInteger("ONCHAIN_CONFIRMATIONS", 1),
    receiptTimeoutMs: positiveInteger("ONCHAIN_RECEIPT_TIMEOUT_MS", 60_000),
    pollIntervalMs: positiveInteger("ONCHAIN_POLL_INTERVAL_MS", 3_000),
    batchSize: positiveInteger("ONCHAIN_BATCH_SIZE", 5),
    lockTimeoutSeconds: positiveInteger("ONCHAIN_LOCK_TIMEOUT_SECONDS", 120),
    maxAttempts: positiveInteger("ONCHAIN_MAX_ATTEMPTS", 8),
    workerId:
      process.env.ONCHAIN_WORKER_ID?.trim() ||
      `worker-${process.pid}-${Date.now().toString(36)}`,
    internalToken,
  };
}
