import { Connection, PublicKey } from "@solana/web3.js";
import { DLMM } from "../dlmm";
import { BN } from "bn.js";

(async function main() {
  const lbPair = await DLMM.create(
    new Connection(process.env.RPC || "https://mainnet-beta.solana.com"),
    new PublicKey("GactypRe52H43kdR3FjmgWQXxDgmhr9o3L4vdAXCTyZ8")
  );
  const binArrays = await lbPair.getBinArrayForSwap(false, 6);
  const { endPrice } = lbPair.swapQuote(
    new BN(300_000 * 10 ** 6),
    false,
    new BN(0),
    binArrays,
    true
  );
  console.log("🚀 ~ main ~ endPrice:", endPrice.toString());
})();
