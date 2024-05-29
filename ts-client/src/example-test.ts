import { Connection, PublicKey } from "@solana/web3.js";
import { DLMM } from "./dlmm";
import { BN } from "bn.js";

const RPC = process.env.RPC;
const connection = new Connection(RPC, "finalized");

async function main() {
  const dlmmPool = await DLMM.create(
    connection,
    new PublicKey("5NXW9f6VGBGQTzyQ2iXoS1e4x2v1msisXrDKmoQCQMri")
  );
  console.log("🚀 ~ main ~ dlmmPool:", dlmmPool);

  const binArrays = await dlmmPool.getBinArrayForSwap(false);
  const swapQuote = dlmmPool.swapQuote(
    new BN(1000000),
    false,
    new BN(0),
    binArrays
  );
  console.log("🚀 ~ main ~ swapQuote:", swapQuote.outAmount.toNumber());
}

main();
