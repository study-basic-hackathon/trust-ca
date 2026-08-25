"use client";

import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
} from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  encodeFunctionData,
  http,
  type Address,
  type EIP1193Provider,
  type Hash,
} from "viem";

const chainId = Number(process.env.NEXT_PUBLIC_PAYMENT_CHAIN_ID ?? 137);
const rpcUrl =
  process.env.NEXT_PUBLIC_PAYMENT_RPC_URL ?? "https://polygon-rpc.com";
const zerodevProjectId = process.env.NEXT_PUBLIC_ZERODEV_PROJECT_ID ?? "";

const chain = defineChain({
  id: chainId,
  name: process.env.NEXT_PUBLIC_PAYMENT_CHAIN_NAME ?? "Polygon",
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});

const entryPoint = getEntryPoint("0.7");
const kernelVersion = KERNEL_V3_1;

export type KernelContext = {
  ownerAddress: Address;
  aaAddress: Address;
  /** SIWEメッセージへの署名。未デプロイ時はERC-6492でラップされる */
  signMessage: (message: string) => Promise<`0x${string}`>;
  /** JPYC transferをUserOperationとして送信し、取り込まれたtx hashを返す */
  sendJpycTransfer: (input: {
    tokenAddress: Address;
    to: Address;
    amountAtomic: bigint;
  }) => Promise<Hash>;
};

export function isAaEnabled(): boolean {
  return zerodevProjectId.length > 0;
}

// sessionと同じ寿命のメモリキャッシュ(ownerアドレス単位)
let cached: { ownerAddress: Address; context: KernelContext } | null = null;

export function getActiveKernel(): KernelContext | null {
  return cached?.context ?? null;
}

export function clearActiveKernel(): void {
  cached = null;
}

const transferAbi = [
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
] as const;

/**
 * Web3Authのowner EOAからZeroDev Kernel account(v3.1)を構築する。
 * Bundler / PaymasterはZeroDevのv3 RPC(1本のURL)を使い、
 * Paymasterがgasを肩代わりすることでソーシャルログイン利用者は
 * POL残高なしでJPYC送金できる。参考: Node-Stayの kernelClient.ts
 */
export async function buildKernelContext(
  provider: EIP1193Provider,
): Promise<KernelContext> {
  if (!isAaEnabled()) {
    throw new Error("NEXT_PUBLIC_ZERODEV_PROJECT_IDが設定されていません");
  }

  const probeClient = createWalletClient({
    chain,
    transport: custom(provider),
  });
  const [ownerAddress] = await probeClient.getAddresses();
  if (!ownerAddress) {
    throw new Error("ウォレットのアドレスを取得できませんでした");
  }
  if (cached && cached.ownerAddress === ownerAddress) {
    return cached.context;
  }
  // ownerのjson-rpc accountを持つwallet clientをKernelのsignerにする
  const ownerClient = createWalletClient({
    account: ownerAddress,
    chain,
    transport: custom(provider),
  });

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const zerodevRpc = `https://rpc.zerodev.app/api/v3/${zerodevProjectId}/chain/${chainId}`;

  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    signer: ownerClient,
    entryPoint,
    kernelVersion,
  });
  const account = await createKernelAccount(publicClient, {
    plugins: { sudo: ecdsaValidator },
    entryPoint,
    kernelVersion,
  });
  const paymaster = createZeroDevPaymasterClient({
    chain,
    transport: http(zerodevRpc),
  });
  const kernelClient = createKernelAccountClient({
    account,
    chain,
    bundlerTransport: http(zerodevRpc),
    client: publicClient,
    paymaster: {
      getPaymasterData: (userOperation) =>
        paymaster.sponsorUserOperation({ userOperation }),
    },
  });

  const context: KernelContext = {
    ownerAddress,
    aaAddress: account.address,
    signMessage: (message) => account.signMessage({ message }),
    sendJpycTransfer: async ({ tokenAddress, to, amountAtomic }) => {
      const userOpHash = await kernelClient.sendUserOperation({
        callData: await account.encodeCalls([
          {
            to: tokenAddress,
            value: 0n,
            data: encodeFunctionData({
              abi: transferAbi,
              functionName: "transfer",
              args: [to, amountAtomic],
            }),
          },
        ]),
      });
      const receipt = await kernelClient.waitForUserOperationReceipt({
        hash: userOpHash,
      });
      return receipt.receipt.transactionHash;
    },
  };
  cached = { ownerAddress, context };
  return context;
}
