import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { DLMM } from "../dlmm";

async function fetchLbPairLockInfoExample() {
  const poolAddress = new PublicKey(
    "9DiruRpjnAnzhn6ts5HGLouHtJrT1JGsPbXNYCrFz2ad"
  );

  let rpc = process.env.RPC || "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpc, "finalized");
  const dlmmPool = await DLMM.create(connection, poolAddress, {
    cluster: "mainnet-beta",
  });

  const lbPairLockInfo = await dlmmPool.getLbPairLockInfo();
  console.log(lbPairLockInfo);
}

fetchLbPairLockInfoExample();
