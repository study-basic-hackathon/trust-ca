import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import type { Hash } from "viem";

describe("TrustcaAuditAnchor", async () => {
  const { viem } = await network.create();
  const [operator, other] = await viem.getWalletClients();

  async function deploy() {
    return viem.deployContract("TrustcaAuditAnchor", [operator.account.address]);
  }

  it("operatorがイベントハッシュを記録できる", async () => {
    const contract = await deploy();
    const eventKey = `0x${"11".repeat(32)}` as Hash;
    const payloadHash = `0x${"22".repeat(32)}` as Hash;

    await viem.assertions.emitWithArgs(
      contract.write.anchor([eventKey, payloadHash, 1_786_579_200n]),
      contract,
      "AuditAnchored",
      [eventKey, payloadHash, 1_786_579_200n],
    );
    assert.equal(await contract.read.anchors([eventKey]), payloadHash);
  });

  it("同じイベントとハッシュの再実行は成功し、状態を変えない", async () => {
    const contract = await deploy();
    const eventKey = `0x${"33".repeat(32)}` as Hash;
    const payloadHash = `0x${"44".repeat(32)}` as Hash;

    await contract.write.anchor([eventKey, payloadHash, 100n]);
    await contract.write.anchor([eventKey, payloadHash, 100n]);

    assert.equal(await contract.read.anchors([eventKey]), payloadHash);
  });

  it("同じイベントへ異なるハッシュを上書きできない", async () => {
    const contract = await deploy();
    const eventKey = `0x${"55".repeat(32)}` as Hash;
    await contract.write.anchor([
      eventKey,
      `0x${"66".repeat(32)}` as Hash,
      100n,
    ]);

    await assert.rejects(
      contract.write.anchor([
        eventKey,
        `0x${"77".repeat(32)}` as Hash,
        101n,
      ]),
    );
  });

  it("operator以外は記録できない", async () => {
    const contract = await deploy();
    await assert.rejects(
      contract.write.anchor(
        [
          `0x${"88".repeat(32)}` as Hash,
          `0x${"99".repeat(32)}` as Hash,
          100n,
        ],
        { account: other.account },
      ),
    );
  });

  it("operatorをゼロアドレス以外へ安全に変更できる", async () => {
    const contract = await deploy();
    await contract.write.transferOperator([other.account.address]);

    await assert.rejects(
      contract.write.anchor([
        `0x${"aa".repeat(32)}` as Hash,
        `0x${"bb".repeat(32)}` as Hash,
        100n,
      ]),
    );
    await contract.write.anchor(
      [
        `0x${"aa".repeat(32)}` as Hash,
        `0x${"bb".repeat(32)}` as Hash,
        100n,
      ],
      { account: other.account },
    );
    assert.equal(
      (await contract.read.operator()).toLowerCase(),
      other.account.address.toLowerCase(),
    );
  });
});
