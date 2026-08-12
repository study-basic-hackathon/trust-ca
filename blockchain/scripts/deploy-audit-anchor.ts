import { network } from "hardhat";
import type { Address } from "viem";

const { viem } = await network.create("localhost");
const [deployer] = await viem.getWalletClients();
const expectedAddress = process.env.EXPECTED_ANCHOR_CONTRACT?.toLowerCase();

async function deploy(): Promise<void> {
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

await deploy();
