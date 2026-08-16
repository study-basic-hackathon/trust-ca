import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { parseUnits, zeroAddress } from "viem";

describe("MockJPYC", async () => {
  const { viem } = await network.create();
  const [deployer, buyer, seller] = await viem.getWalletClients();

  async function deploy() {
    return viem.deployContract("MockJPYC", [
      buyer.account.address,
      parseUnits("1000000", 18),
    ]);
  }

  it("local E2E用のJPYC metadataと初期残高を持つ", async () => {
    const contract = await deploy();
    assert.equal(await contract.read.symbol(), "JPYC");
    assert.equal(await contract.read.decimals(), 18);
    assert.equal(
      await contract.read.balanceOf([buyer.account.address]),
      parseUnits("1000000", 18),
    );
  });

  it("保有者から販売者へtransferできる", async () => {
    const contract = await deploy();
    const amount = parseUnits("12000", 18);
    await viem.assertions.emitWithArgs(
      contract.write.transfer([seller.account.address, amount], {
        account: buyer.account,
      }),
      contract,
      "Transfer",
      [buyer.account.address, seller.account.address, amount],
    );
    assert.equal(await contract.read.balanceOf([seller.account.address]), amount);
  });

  it("残高不足とzero addressへのtransferを拒否する", async () => {
    const contract = await deploy();
    await assert.rejects(
      contract.write.transfer([seller.account.address, 1n], {
        account: deployer.account,
      }),
    );
    await assert.rejects(
      contract.write.transfer([zeroAddress, 1n], { account: buyer.account }),
    );
  });
});
