import { NATIVE_MINT } from "@solana/spl-token";
import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { DLMM } from "../dlmm";

import fs from "fs";
import { StrategyType } from "../dlmm/types";

async function main() {
  const keypair = Keypair.fromSecretKey(
    new Uint8Array(
      JSON.parse(fs.readFileSync("/Users/tian/.config/solana/id.json", "utf-8"))
    )
  );

  console.log(keypair.publicKey.toBase58());

  const poolAddress = new PublicKey(
    "FJbEo74c2W4QLBBVUfUvi8VBWXtMdJVPuFpq2f6UV1iB"
  );

  const connection = new Connection(clusterApiUrl("devnet"));
  const dlmm = await DLMM.create(connection, poolAddress);

  const binId = dlmm.lbPair.activeId - 1 - 70 * 2;
  const positionKeypair = Keypair.generate();
  let depositTx = await dlmm.initializePositionAndAddLiquidityByStrategy({
    positionPubKey: positionKeypair.publicKey,
    totalXAmount: new BN(0),
    totalYAmount: new BN(1_000_000),
    strategy: {
      strategyType: StrategyType.Spot,
      minBinId: binId,
      maxBinId: binId,
    },
    user: keypair.publicKey,
  });

  const blockhash = await connection.getLatestBlockhash();
  depositTx.recentBlockhash = blockhash.blockhash;
  depositTx.feePayer = keypair.publicKey;
  depositTx.sign(positionKeypair);
  depositTx.sign(keypair);

  const depositSig = await sendAndConfirmTransaction(
    connection,
    depositTx,
    [keypair, positionKeypair],
    { commitment: "confirmed" }
  );
  console.log("Deposit tx:", depositSig);
}

main();
