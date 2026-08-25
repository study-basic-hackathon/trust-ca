import {
  createPublicClient,
  decodeEventLog,
  decodeFunctionData,
  defineChain,
  getAddress,
  http,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";
import type { PaymentConfig } from "../env.js";

export const jpycAbi = [
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "Transfer",
    anonymous: false,
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

export type JpycTokenMetadata = {
  address: Address;
  symbol: string;
  decimals: number;
};

export type ExpectedJpycTransfer = {
  payerAddress: Address;
  payeeAddress: Address;
  amountAtomic: bigint;
};

export class JpycPaymentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "JpycPaymentError";
  }
}

export class JpycPaymentClient {
  private readonly publicClient: PublicClient;
  private metadata: JpycTokenMetadata | null = null;

  constructor(private readonly config: PaymentConfig) {
    const chain = defineChain({
      id: config.chainId,
      name: config.chainName,
      nativeCurrency: { name: "Native Token", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [config.rpcUrl] } },
    });
    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    });
  }

  async getMetadata(): Promise<JpycTokenMetadata> {
    if (this.metadata) return this.metadata;
    try {
      const [chainId, bytecode, symbol, decimals] = await Promise.all([
        this.publicClient.getChainId(),
        this.publicClient.getCode({ address: this.config.tokenAddress }),
        this.publicClient.readContract({
          address: this.config.tokenAddress,
          abi: jpycAbi,
          functionName: "symbol",
        }),
        this.publicClient.readContract({
          address: this.config.tokenAddress,
          abi: jpycAbi,
          functionName: "decimals",
        }),
      ]);
      if (chainId !== this.config.chainId) {
        throw new JpycPaymentError(
          "PAYMENT_CHAIN_ID_MISMATCH",
          `chain IDが設定と一致しません: expected=${this.config.chainId} actual=${chainId}`,
          false,
        );
      }
      if (!bytecode || bytecode === "0x") {
        throw new JpycPaymentError(
          "JPYC_CONTRACT_NOT_DEPLOYED",
          "設定されたJPYC contractがデプロイされていません。",
          false,
        );
      }
      if (symbol !== this.config.expectedSymbol) {
        throw new JpycPaymentError(
          "JPYC_SYMBOL_MISMATCH",
          `token symbolが設定と一致しません: expected=${this.config.expectedSymbol} actual=${symbol}`,
          false,
        );
      }
      const normalizedDecimals = Number(decimals);
      if (!Number.isSafeInteger(normalizedDecimals) || normalizedDecimals < 0 || normalizedDecimals > 255) {
        throw new JpycPaymentError(
          "JPYC_DECIMALS_INVALID",
          "token decimalsを正しく取得できませんでした。",
          false,
        );
      }
      this.metadata = {
        address: getAddress(this.config.tokenAddress),
        symbol,
        decimals: normalizedDecimals,
      };
      return this.metadata;
    } catch (error) {
      if (error instanceof JpycPaymentError) throw error;
      throw new JpycPaymentError(
        "JPYC_METADATA_UNAVAILABLE",
        "JPYC contractのmetadataを取得できませんでした。",
        true,
        error,
      );
    }
  }

  async assertReady(): Promise<void> {
    await this.getMetadata();
  }

  async verifyTransfer(
    txHash: Hash,
    expected: ExpectedJpycTransfer,
  ): Promise<{ blockNumber: bigint }> {
    try {
      const [receipt, transaction] = await Promise.all([
        this.publicClient.getTransactionReceipt({ hash: txHash }),
        this.publicClient.getTransaction({ hash: txHash }),
      ]);
      const currentBlock = await this.publicClient.getBlockNumber();
      const confirmations = currentBlock - receipt.blockNumber + 1n;
      if (confirmations < BigInt(this.config.confirmations)) {
        throw new JpycPaymentError(
          "JPYC_CONFIRMATIONS_PENDING",
          `確定数が不足しています: required=${this.config.confirmations} actual=${confirmations}`,
          true,
        );
      }
      if (receipt.status !== "success") {
        throw new JpycPaymentError(
          "JPYC_TRANSACTION_REVERTED",
          "JPYC transfer transactionがrevertしました。",
          false,
        );
      }
      // 送信経路の判定:
      // - 直接送金(EOA): transaction.to がJPYC contract。from・calldata・eventの
      //   全一致を要求する(jpyc-payment.md §6.2)。
      // - smart account(ERC-4337 / ZeroDev Kernel): transactionはbundler経由で
      //   EntryPointへ届くため、fromはbundler・toはEntryPointになる。この場合は
      //   支払元(payer=smart account)のJPYC Transfer eventの完全一致で検証する。
      //   eventはtoken contract自身が発行するため、payer視点の偽装はできない。
      const isDirectTransfer =
        transaction.to?.toLowerCase() === this.config.tokenAddress.toLowerCase();
      if (isDirectTransfer) {
        if (
          transaction.from.toLowerCase() !== expected.payerAddress.toLowerCase()
        ) {
          throw new JpycPaymentError(
            "JPYC_PAYER_MISMATCH",
            "transaction送信元が支払元walletと一致しません。",
            false,
          );
        }

        let decoded;
        try {
          decoded = decodeFunctionData({ abi: jpycAbi, data: transaction.input });
        } catch (error) {
          throw new JpycPaymentError(
            "JPYC_CALLDATA_INVALID",
            "transaction inputをJPYC transferとして解釈できません。",
            false,
            error,
          );
        }
        const [recipient, amount] = decoded.args ?? [];
        if (
          decoded.functionName !== "transfer" ||
          typeof recipient !== "string" ||
          recipient.toLowerCase() !== expected.payeeAddress.toLowerCase() ||
          amount !== expected.amountAtomic
        ) {
          throw new JpycPaymentError(
            "JPYC_TRANSFER_INPUT_MISMATCH",
            "JPYC transferの受取先または金額がpayment intentと一致しません。",
            false,
          );
        }
      }

      const transferEventFound = receipt.logs.some((log) => {
        if (log.address.toLowerCase() !== this.config.tokenAddress.toLowerCase()) {
          return false;
        }
        try {
          const event = decodeEventLog({
            abi: jpycAbi,
            data: log.data,
            topics: log.topics,
          });
          return (
            event.eventName === "Transfer" &&
            event.args.from.toLowerCase() === expected.payerAddress.toLowerCase() &&
            event.args.to.toLowerCase() === expected.payeeAddress.toLowerCase() &&
            event.args.value === expected.amountAtomic
          );
        } catch {
          return false;
        }
      });
      if (!transferEventFound) {
        throw new JpycPaymentError(
          "JPYC_TRANSFER_EVENT_MISMATCH",
          "receiptに期待するJPYC Transfer eventがありません。",
          false,
        );
      }
      return { blockNumber: receipt.blockNumber };
    } catch (error) {
      if (error instanceof JpycPaymentError) throw error;
      throw new JpycPaymentError(
        "JPYC_RECEIPT_PENDING",
        "JPYC transfer receiptをまだ確認できません。",
        true,
        error,
      );
    }
  }
}
