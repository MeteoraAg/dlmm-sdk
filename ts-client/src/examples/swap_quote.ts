import { Connection, PublicKey } from "@solana/web3.js";
import { DLMM } from "../dlmm";
import BN from "bn.js";

async function swapQuote(
  poolAddress: PublicKey,
  swapAmount: BN,
  swapYtoX: boolean,
  isPartialFill: boolean,
  maxExtraBinArrays: number = 0
) {
  let rpc = "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpc, "finalized");
  const dlmmPool = await DLMM.create(connection, poolAddress, {
    cluster: "mainnet-beta",
  });

  const binArrays = await dlmmPool.getBinArrayForSwap(swapYtoX);
  const swapQuote = dlmmPool.swapQuote(
    swapAmount,
    swapYtoX,
    new BN(10),
    binArrays,
    isPartialFill,
    maxExtraBinArrays
  );
  console.log("🚀 ~ swapQuote:", swapQuote);
  console.log(
    "consumedInAmount: %s, outAmount: %s",
    swapQuote.consumedInAmount.toString(),
    swapQuote.outAmount.toString()
  );
}

async function main() {
  await swapQuote(
    new PublicKey("8gJ7UWboMeQ6z6AQwFP3cAZwSYG8udVS2UesyCbH79r7"),
    new BN(1_000_000 * 10 ** 6),
    true,
    true,
  );
}

main();
