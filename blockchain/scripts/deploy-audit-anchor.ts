import { network } from "hardhat";
import type { Address } from "viem";

const { viem } = await network.create("localhost");
const [deployer] = await viem.getWalletClients();
const walletClients = await viem.getWalletClients();
const buyer = walletClients[1];
const expectedAddress = process.env.EXPECTED_ANCHOR_CONTRACT?.toLowerCase();
const expectedJpycAddress = process.env.EXPECTED_JPYC_TOKEN?.toLowerCase();

async function deployAuditAnchor(): Promise<void> {
  if (expectedAddress) {
    const publicClient = await viem.getPublicClient();
    const bytecode = await publicClient.getCode({
      address: expectedAddress as Address,
    });
    if (bytecode && bytecode !== "0x") {
      const existing = await viem.getContractAt(
        "TrustcaAuditAnchor",
        expectedAddress as Address,
      );
      const operator = await existing.read.operator();
      if (operator.toLowerCase() !== deployer.account.address.toLowerCase()) {
        throw new Error(
          `既存contractのoperatorが想定外です: expected=${deployer.account.address} actual=${operator}`,
        );
      }
      console.log(
        `TrustcaAuditAnchorはデプロイ済みです: ${expectedAddress}`,
      );
      return;
    }
  }

  const contract = await viem.deployContract("TrustcaAuditAnchor", [
    deployer.account.address,
  ]);
  if (expectedAddress && contract.address.toLowerCase() !== expectedAddress) {
    throw new Error(
      `contract addressが想定外です: expected=${expectedAddress} actual=${contract.address}`,
    );
  }
  console.log(`TrustcaAuditAnchorをデプロイしました: ${contract.address}`);
}

async function deployMockJpyc(): Promise<void> {
  if (!buyer) throw new Error("MockJPYCの初期保有walletが見つかりません。");
  if (expectedJpycAddress) {
    const publicClient = await viem.getPublicClient();
    const bytecode = await publicClient.getCode({
      address: expectedJpycAddress as Address,
    });
    if (bytecode && bytecode !== "0x") {
      const existing = await viem.getContractAt(
        "MockJPYC",
        expectedJpycAddress as Address,
      );
      const [symbol, decimals] = await Promise.all([
        existing.read.symbol(),
        existing.read.decimals(),
      ]);
      if (symbol !== "JPYC" || decimals !== 18) {
        throw new Error("既存MockJPYCのmetadataが想定外です。");
      }
      console.log(`MockJPYCはデプロイ済みです: ${expectedJpycAddress}`);
      return;
    }
  }

  const initialSupply = 1_000_000n * 10n ** 18n;
  const contract = await viem.deployContract("MockJPYC", [
    buyer.account.address,
    initialSupply,
  ]);
  if (
    expectedJpycAddress &&
    contract.address.toLowerCase() !== expectedJpycAddress
  ) {
    throw new Error(
      `MockJPYC addressが想定外です: expected=${expectedJpycAddress} actual=${contract.address}`,
    );
  }
  console.log(
    `MockJPYCをデプロイしました: ${contract.address} holder=${buyer.account.address}`,
  );
}

await deployAuditAnchor();
await deployMockJpyc();
