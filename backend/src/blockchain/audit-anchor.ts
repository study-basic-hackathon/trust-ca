import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  toBytes,
  type Hash,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { OnchainConfig } from "../env.js";

export const auditAnchorAbi = [
  {
    type: "function",
    name: "anchor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "eventKey", type: "bytes32" },
      { name: "payloadHash", type: "bytes32" },
      { name: "occurredAt", type: "uint64" },
    ],
    outputs: [{ name: "created", type: "bool" }],
  },
  {
    type: "function",
    name: "anchors",
    stateMutability: "view",
    inputs: [{ name: "eventKey", type: "bytes32" }],
    outputs: [{ name: "payloadHash", type: "bytes32" }],
  },
  {
    type: "function",
    name: "operator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "operatorAddress", type: "address" }],
  },
] as const;

export type AnchorReceipt = {
  txHash: Hash;
  blockNumber: bigint;
};

export class OnchainAnchorError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly txHash?: Hash,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "OnchainAnchorError";
  }
}

export function eventKeyFromAuditEventId(auditEventId: string): Hash {
  return keccak256(toBytes(auditEventId));
}

export class AuditAnchorClient {
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly account;

  constructor(private readonly config: OnchainConfig) {
    const chain = defineChain({
      id: config.chainId,
      name: config.chainName,
      nativeCurrency: { name: "Native Token", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [config.rpcUrl] } },
    });
    this.account = privateKeyToAccount(config.operatorPrivateKey);
    this.publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(config.rpcUrl),
    });
  }

  async assertReady(): Promise<void> {
    const [chainId, bytecode, operator] = await Promise.all([
      this.publicClient.getChainId(),
      this.publicClient.getCode({ address: this.config.contractAddress }),
      this.publicClient.readContract({
        address: this.config.contractAddress,
        abi: auditAnchorAbi,
        functionName: "operator",
      }),
    ]);
    if (chainId !== this.config.chainId) {
      throw new OnchainAnchorError(
        "CHAIN_ID_MISMATCH",
        `chain IDが設定と一致しません: expected=${this.config.chainId} actual=${chainId}`,
        false,
      );
    }
    if (!bytecode || bytecode === "0x") {
      throw new OnchainAnchorError(
        "CONTRACT_NOT_DEPLOYED",
        "監査anchor contractがデプロイされていません。",
        false,
      );
    }
    if (operator.toLowerCase() !== this.account.address.toLowerCase()) {
      throw new OnchainAnchorError(
        "OPERATOR_MISMATCH",
        "operator walletがcontract設定と一致しません。",
        false,
      );
    }
  }

  async submit(input: {
    auditEventId: string;
    payloadSha256: string;
    occurredAt: Date;
  }): Promise<Hash> {
    const eventKey = eventKeyFromAuditEventId(input.auditEventId);
    const payloadHash = `0x${input.payloadSha256}` as Hash;
    const occurredAt = BigInt(Math.floor(input.occurredAt.getTime() / 1_000));

    try {
      const storedHash = await this.publicClient.readContract({
        address: this.config.contractAddress,
        abi: auditAnchorAbi,
        functionName: "anchors",
        args: [eventKey],
      });
      if (
        storedHash !== `0x${"0".repeat(64)}` &&
        storedHash.toLowerCase() !== payloadHash.toLowerCase()
      ) {
        throw new OnchainAnchorError(
          "ANCHOR_HASH_CONFLICT",
          "同じevent keyに異なるpayload hashが記録されています。",
          false,
        );
      }

      const { request } = await this.publicClient.simulateContract({
        account: this.account,
        address: this.config.contractAddress,
        abi: auditAnchorAbi,
        functionName: "anchor",
        args: [eventKey, payloadHash, occurredAt],
      });
      return await this.walletClient.writeContract(request);
    } catch (error) {
      if (error instanceof OnchainAnchorError) throw error;
      throw new OnchainAnchorError(
        "ANCHOR_SUBMIT_FAILED",
        "anchor transactionの送信に失敗しました。",
        true,
        undefined,
        error,
      );
    }
  }

  async confirm(txHash: Hash): Promise<AnchorReceipt> {
    try {
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash: txHash,
        confirmations: this.config.confirmations,
        timeout: this.config.receiptTimeoutMs,
      });
      if (receipt.status !== "success") {
        throw new OnchainAnchorError(
          "ANCHOR_TRANSACTION_REVERTED",
          "anchor transactionがrevertしました。",
          false,
          txHash,
        );
      }
      return { txHash, blockNumber: receipt.blockNumber };
    } catch (error) {
      if (error instanceof OnchainAnchorError) throw error;
      throw new OnchainAnchorError(
        "ANCHOR_CONFIRMATION_PENDING",
        "anchor transactionの確定をまだ確認できません。",
        true,
        txHash,
        error,
      );
    }
  }
}
