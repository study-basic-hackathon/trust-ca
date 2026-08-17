import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: { version: "0.8.28" },
      production: {
        version: "0.8.28",
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
    },
  },
  networks: {
    hardhatMainnet: { type: "edr-simulated", chainType: "l1" },
    localhost: {
      type: "http",
      chainType: "l1",
      url: process.env.LOCALHOST_RPC_URL ?? "http://127.0.0.1:8545",
    },
    amoy: {
      type: "http",
      chainType: "l1",
      chainId: 80002,
      url: configVariable("POLYGON_AMOY_RPC_URL"),
      accounts: [configVariable("ONCHAIN_OPERATOR_PRIVATE_KEY")],
    },
  },
});
