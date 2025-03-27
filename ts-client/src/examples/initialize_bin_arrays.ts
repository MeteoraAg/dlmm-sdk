import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { DLMM } from "../dlmm";
import BN from "bn.js";
import Decimal from "decimal.js";
import { getBinArraysRequiredByPositionRange } from "../dlmm/helpers";
import { simulateTransaction } from "@coral-xyz/anchor/dist/cjs/utils/rpc";

async function initializeBinArrayExample() {
  const funder = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(process.env.WALLET))
  );

  console.log("Connected wallet", funder.publicKey.toBase58());

  const poolAddress = new PublicKey(
    "BfxJcifavkCgznhvAtLsBHQpyNwaTMs2cR986qbH4fPh"
  );

  let rpc = "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpc, "finalized");
  const dlmmPool = await DLMM.create(connection, poolAddress, {
    cluster: "mainnet-beta",
  });

  const fromUIPrice = 1.0;
  const toUIPrice = 4.0;

  const toLamportMultiplier = new Decimal(
    10 ** (dlmmPool.tokenY.decimal - dlmmPool.tokenX.decimal)
  );

  const minPricePerLamport = new Decimal(fromUIPrice).mul(toLamportMultiplier);
  const maxPricePerLamport = new Decimal(toUIPrice).mul(toLamportMultiplier);

  const minBinId = new BN(
    DLMM.getBinIdFromPrice(minPricePerLamport, dlmmPool.lbPair.binStep, false)
  );

  const maxBinId = new BN(
    DLMM.getBinIdFromPrice(maxPricePerLamport, dlmmPool.lbPair.binStep, false)
  );

  const binArraysRequired = getBinArraysRequiredByPositionRange(
    poolAddress,
    minBinId,
    maxBinId,
    dlmmPool.program.programId
  );

  console.log(binArraysRequired);

  const initializeBinArrayIxs = await dlmmPool.initializeBinArrays(
    binArraysRequired.map((b) => b.index),
    funder.publicKey
  );

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();

  const transaction = new Transaction({
    blockhash,
    lastValidBlockHeight,
    feePayer: funder.publicKey,
  }).add(...initializeBinArrayIxs);

  transaction.sign(funder);

  const simulationResult = await simulateTransaction(connection, transaction, [
    funder,
  ]);

  console.log(simulationResult);
}

initializeBinArrayExample();
