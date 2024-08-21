import { Connection, PublicKey } from "@solana/web3.js";
import { DLMM } from "../dlmm";
import BN from "bn.js";

async function swapQuote(
  poolAddress: PublicKey,
  swapAmount: BN,
  swapYtoX: boolean,
  isPartialFill: boolean
) {
  let rpc = "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpc, "finalized");
  const dlmmPool = await DLMM.create(connection, poolAddress, {
    cluster: "mainnet-beta",
  });

  const binArrays = await dlmmPool.getBinArrayForSwap(swapYtoX);
  const swapQuote = await dlmmPool.swapQuote(
    swapAmount,
    swapYtoX,
    new BN(10),
    binArrays,
    isPartialFill
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
    new PublicKey("8kCbYxnF8ggdJACxz4NLYtVhEEz6EBvN5NQcKAazpkEY"),
    new BN(1_000_000_000),
    true,
    true
  );
}

main();
