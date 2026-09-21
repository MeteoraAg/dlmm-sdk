import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SYSVAR_CLOCK_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { DLMM } from "../dlmm";
import fs from "fs";
import BN from "bn.js";
import {
  ActivationType,
  Clock,
  ClockLayout,
  StrategyType,
} from "../dlmm/types";
import { deriveCustomizablePermissionlessLbPair } from "../dlmm/helpers";
import { LBCLMM_PROGRAM_IDS, MAX_BIN_PER_POSITION } from "../dlmm/constants";
import { Key } from "readline";

const rawKeypair = fs.readFileSync(process.env.PRIVATE_KEYPAIR_PATH, "utf-8");
const keypairBuffer = new Uint8Array(JSON.parse(rawKeypair));
const user = Keypair.fromSecretKey(keypairBuffer);
const cluster = "devnet";
const RPC = process.env.RPC || "https://api.devnet.solana.com";
const connection = new Connection(RPC, "confirmed");

async function createLFGPool(
  connection: Connection,
  binStep: BN,
  tokenX: PublicKey,
  tokenY: PublicKey,
  activeId: BN,
  feeBps: BN,
  activationSecondsIntoFuture: BN,
  userKeypair: Keypair,
  programId: PublicKey
) {
  const [lbPair] = deriveCustomizablePermissionlessLbPair(
    tokenX,
    tokenY,
    programId
  );

  const lbPairAccount = await connection.getAccountInfo(lbPair);

  if (lbPairAccount) {
    console.log("LFG pool already exists");
    return lbPair;
  }

  const clock = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
  const clockState: Clock = ClockLayout.decode(clock!.data);
  const activationPoint = clockState.unixTimestamp.add(
    activationSecondsIntoFuture
  );

  const transaction = await DLMM.createCustomizablePermissionlessLbPair2(
    connection,
    binStep,
    tokenX,
    tokenY,
    activeId,
    feeBps,
    ActivationType.Timestamp,
    false,
    userKeypair.publicKey,
    activationPoint,
    false,
    {
      cluster,
    }
  );

  console.log("Create LFG pool");
  await sendAndConfirmTransaction(connection, transaction, [userKeypair]);

  return lbPair;
}

async function seedLFGPoolDoubleSided(
  lbPair: PublicKey,
  seedBaseAmount: BN,
  owner: PublicKey,
  curvature: number,
  minPrice: number,
  maxPrice: number,
  feeOwner: PublicKey,
  lockReleasePoint: BN,
  baseKeypair: Keypair,
  operatorKeypair: Keypair,
  payerKeypair: Keypair,
  seedQuoteAmount: BN,
  quotePositionCount: number
) {
  const lfgPool = await DLMM.create(connection, lbPair, {
    cluster,
  });

  console.log("Seed LFG pool");
  await seedLFGPool(
    lfgPool,
    seedBaseAmount,
    owner,
    curvature,
    minPrice,
    maxPrice,
    feeOwner,
    lockReleasePoint,
    baseKeypair,
    operatorKeypair,
    payerKeypair,
    connection
  );

  await lfgPool.refetchStates();

  console.log("Add buy liquidity");
  await addBuyLiquidity(seedQuoteAmount, lfgPool, quotePositionCount, user);
}

async function addBuyLiquidity(
  quoteAmount: BN,
  lfgPool: DLMM,
  quotePositionCount: number,
  userKeypair: Keypair
) {
  const amountPerPosition = quoteAmount.divn(quotePositionCount);
  const loss = quoteAmount.sub(amountPerPosition.muln(quotePositionCount));

  const addLiquidityIxs: TransactionInstruction[][] = [];
  const positionKeypairs: Keypair[] = [];

  let upperBinId = lfgPool.lbPair.activeId - 1;

  for (let i = 0; i < quotePositionCount; i++) {
    const lowerBinId = upperBinId - MAX_BIN_PER_POSITION.toNumber() + 1;
    const totalYAmount =
      i + 1 == quotePositionCount
        ? amountPerPosition.add(loss)
        : amountPerPosition;

    const positionKeypair = Keypair.generate();
    const tx = await lfgPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: positionKeypair.publicKey,
      totalXAmount: new BN(0),
      totalYAmount,
      strategy: {
        strategyType: StrategyType.Spot,
        minBinId: lowerBinId,
        maxBinId: upperBinId,
      },
      slippage: 0,
      user: userKeypair.publicKey,
    });

    upperBinId = lowerBinId - 1;

    addLiquidityIxs.push(tx.instructions);
    positionKeypairs.push(positionKeypair);
  }

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();

  await Promise.all(
    addLiquidityIxs.map(async (ixs, i) => {
      const tx = new Transaction({
        blockhash,
        lastValidBlockHeight,
      });

      tx.add(...ixs);

      await sendAndConfirmTransaction(connection, tx, [
        userKeypair,
        positionKeypairs[i],
      ]);
    })
  );
}

async function seedLFGPool(
  lfgPool: DLMM,
  seedBaseAmount: BN,
  owner: PublicKey,
  curvature: number,
  minPrice: number,
  maxPrice: number,
  feeOwner: PublicKey,
  lockReleasePoint: BN,
  baseKeypair: Keypair,
  operatorKeypair: Keypair,
  payerKeypair: Keypair,
  connection: Connection
) {
  const {
    sendPositionOwnerTokenProveIxs,
    initializeBinArraysAndPositionIxs,
    addLiquidityIxs,
  } = await lfgPool.seedLiquidity(
    owner,
    seedBaseAmount,
    curvature,
    minPrice,
    maxPrice,
    baseKeypair.publicKey,
    payerKeypair.publicKey,
    feeOwner,
    operatorKeypair.publicKey,
    lockReleasePoint,
    true
  );

  if (sendPositionOwnerTokenProveIxs.length > 0) {
    const { lastValidBlockHeight, blockhash } =
      await connection.getLatestBlockhash();

    const transaction = new Transaction({
      lastValidBlockHeight,
      blockhash,
    }).add(...sendPositionOwnerTokenProveIxs);

    await sendAndConfirmTransaction(connection, transaction, [
      operatorKeypair,
      payerKeypair,
    ]);
  }

  if (initializeBinArraysAndPositionIxs.length > 0) {
    const { lastValidBlockHeight, blockhash } =
      await connection.getLatestBlockhash();

    const transactions = initializeBinArraysAndPositionIxs.map((groupIx) => {
      const tx = new Transaction({
        lastValidBlockHeight,
        blockhash,
      }).add(...groupIx);

      return tx;
    });

    await Promise.all(
      transactions.map((tx) =>
        sendAndConfirmTransaction(connection, tx, [
          baseKeypair,
          operatorKeypair,
          payerKeypair,
        ])
      )
    );
  }

  if (addLiquidityIxs.length > 0) {
    const { lastValidBlockHeight, blockhash } =
      await connection.getLatestBlockhash();

    const transactions = addLiquidityIxs.map((groupIx) => {
      const tx = new Transaction({
        lastValidBlockHeight,
        blockhash,
      }).add(...groupIx);

      return tx;
    });

    await Promise.all(
      transactions.map((tx) =>
        sendAndConfirmTransaction(connection, tx, [
          operatorKeypair,
          payerKeypair,
        ])
      )
    );
  }
}

async function main() {
  const activeId = new BN(0);
  const binStep = new BN(80);
  const feeBps = new BN(500);
  const ONE_WEEK = new BN(86400).muln(7);
  const tokenX = new PublicKey("3VEKER354qq9WbddVRTViKPmqPLe9HNihnx6Nny9kohC");
  const tokenY = new PublicKey("BQeBKWSyDSW7iijt9KJAVoEu5F53Mkqxer6srdaJTtJf");
  const programId = new PublicKey(LBCLMM_PROGRAM_IDS[cluster]);

  const lbPair = await createLFGPool(
    connection,
    binStep,
    tokenX,
    tokenY,
    activeId,
    feeBps,
    ONE_WEEK,
    user,
    programId
  );

  console.log("Pair", lbPair.toBase58());

  const seedBaseAmount = new BN(50_000).mul(new BN(10 ** 9));
  const minPrice = 1000;
  const maxPrice = 8888;
  const curvature = 1.3;
  const owner = user.publicKey;
  const feeOwner = user.publicKey;
  const lockReleasePoint = new BN(0);

  const seedQuoteAmount = new BN(10_510_000).mul(new BN(10 ** 6));
  const quotePositionCount = 2;

  await seedLFGPoolDoubleSided(
    lbPair,
    seedBaseAmount,
    owner,
    curvature,
    minPrice,
    maxPrice,
    feeOwner,
    lockReleasePoint,
    user,
    user,
    user,
    seedQuoteAmount,
    quotePositionCount
  );
}

main();
