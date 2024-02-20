import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SYSVAR_CLOCK_PUBKEY,
  ParsedAccountData,
} from "@solana/web3.js";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { DLMM } from "./dlmm";
import { calculateSpotDistribution } from "./dlmm/helpers";
import BN from "bn.js";

const user = Keypair.fromSecretKey(
  new Uint8Array(bs58.decode(process.env.USER_PRIVATE_KEY))
);
const RPC = process.env.RPC || "https://api.devnet.solana.com";
const connection = new Connection(RPC, "finalized");

const devnetPool = new PublicKey(
  "3W2HKgUa96Z69zzG3LK1g8KdcRAWzAttiLiHfYnKuPw5"
);

/** Utils */
export interface ParsedClockState {
  info: {
    epoch: number;
    epochStartTimestamp: number;
    leaderScheduleEpoch: number;
    slot: number;
    unixTimestamp: number;
  };
  type: string;
  program: string;
  space: number;
}

let activeBin;
let userPositions;
let totalXAmount;
let totalYAmount;
let spotXYAmountDistribution;

const newPosition = new Keypair();

async function getActiveBin(dlmmPool: DLMM) {
  // Get pool state
  activeBin = await dlmmPool.getActiveBin();
  console.log("🚀 ~ activeBin:", activeBin);
}

async function createPosition(dlmmPool: DLMM) {
  const TOTAL_RANGE_INTERVAL = 10; // 10 bins on each side of the active bin
  const bins = [activeBin.binId]; // Make sure bins is less than 70, as currently only support up to 70 bins for 1 position
  for (
    let i = activeBin.binId;
    i < activeBin.binId + TOTAL_RANGE_INTERVAL / 2;
    i++
  ) {
    const rightNextBinId = i + 1;
    const leftPrevBinId = activeBin.binId - (rightNextBinId - activeBin.binId);
    bins.push(rightNextBinId);
    bins.unshift(leftPrevBinId);
  }

  const activeBinPricePerToken = dlmmPool.fromPricePerLamport(
    Number(activeBin.price)
  );
  totalXAmount = new BN(100);
  totalYAmount = totalXAmount.mul(new BN(Number(activeBinPricePerToken)));

  // Get spot distribution
  spotXYAmountDistribution = calculateSpotDistribution(activeBin.binId, bins);

  // Create Position
  const createPositionTx =
    await dlmmPool.initializePositionAndAddLiquidityByWeight({
      positionPubKey: newPosition.publicKey,
      lbPairPubKey: dlmmPool.pubkey,
      user: user.publicKey,
      totalXAmount,
      totalYAmount,
      xYAmountDistribution: spotXYAmountDistribution,
    });

  try {
    for (let tx of Array.isArray(createPositionTx)
      ? createPositionTx
      : [createPositionTx]) {
      const createPositionTxHash = await sendAndConfirmTransaction(
        connection,
        tx,
        [user, newPosition]
      );
      console.log("🚀 ~ createPositionTxHash:", createPositionTxHash);
    }
  } catch (error) {
    console.log("🚀 ~ error:", JSON.parse(JSON.stringify(error)));
  }
}

async function getPositionsState(dlmmPool: DLMM) {
  // Get position state
  const positionsState = await dlmmPool.getPositionsByUserAndLbPair(
    user.publicKey
  );

  userPositions = positionsState.userPositions;
  console.log("🚀 ~ userPositions:", userPositions);
}

async function addLiquidityToExistingPosition(dlmmPool: DLMM) {
  // Add Liquidity to existing position
  const addLiquidityTx = await dlmmPool.addLiquidityByWeight({
    positionPubKey: userPositions[0].publicKey,
    lbPairPubKey: dlmmPool.pubkey,
    user: user.publicKey,
    totalXAmount,
    totalYAmount,
    xYAmountDistribution: spotXYAmountDistribution,
  });

  try {
    for (let tx of Array.isArray(addLiquidityTx)
      ? addLiquidityTx
      : [addLiquidityTx]) {
      const addLiquidityTxHash = await sendAndConfirmTransaction(
        connection,
        tx,
        [user, newPosition]
      );
      console.log("🚀 ~ addLiquidityTxHash:", addLiquidityTxHash);
    }
  } catch (error) {
    console.log("🚀 ~ error:", JSON.parse(JSON.stringify(error)));
  }
}

async function removeLiquidity(dlmmPool: DLMM) {
  // Remove Liquidity
  const binIdsToRemove = userPositions[0].positionData.positionBinData.map(
    (bin) => bin.binId
  );
  const removeLiquidityTx = await dlmmPool.removeLiquidity({
    position: userPositions[0].publicKey,
    user: user.publicKey,
    binIds: binIdsToRemove,
    liquiditiesBpsToRemove: new Array(binIdsToRemove.length).fill(
      new BN(100 * 100)
    ), // 100% (range from 0 to 100)
    shouldClaimAndClose: true, // should claim swap fee and close position together
  });

  try {
    for (let tx of Array.isArray(removeLiquidityTx)
      ? removeLiquidityTx
      : [removeLiquidityTx]) {
      const removeLiquidityTxHash = await sendAndConfirmTransaction(
        connection,
        tx,
        [user, newPosition],
        { skipPreflight: false, preflightCommitment: "singleGossip" }
      );
      console.log("🚀 ~ removeLiquidityTxHash:", removeLiquidityTxHash);
    }
  } catch (error) {
    console.log("🚀 ~ error:", JSON.parse(JSON.stringify(error)));
  }
}

async function swap(dlmmPool: DLMM) {
  const swapAmount = new BN(100);
  // Swap quote
  const swapYtoX = true;
  const binArrays = await dlmmPool.getBinArrayForSwap(swapYtoX);

  // check whether it is permission or permissionless pool
  let maxSwappedAmount: BN;
  let throttledStats: boolean;
  if (!swapYtoX && dlmmPool.lbPair.pairType == 1) {
    // get current slot
    const parsedClock = await connection.getParsedAccountInfo(
      SYSVAR_CLOCK_PUBKEY
    );
    const parsedClockAccount = (parsedClock.value!.data as ParsedAccountData)
      .parsed as ParsedClockState;
    if (
      parsedClockAccount.info.slot <=
      dlmmPool.lbPair.swapCapDeactivateSlot.toNumber()
    ) {
      throttledStats = true;
      maxSwappedAmount = dlmmPool.lbPair.maxSwappedAmount;
    }
  }
  const swapQuote = throttledStats
    ? await dlmmPool.swapQuoteWithCap(
        swapAmount,
        swapYtoX,
        new BN(10),
        maxSwappedAmount,
        binArrays
      )
    : await dlmmPool.swapQuote(swapAmount, swapYtoX, new BN(10), binArrays);

  console.log("🚀 ~ swapQuote:", swapQuote);

  // Swap
  const swapTx = await dlmmPool.swap({
    inToken: dlmmPool.tokenX.publicKey,
    binArraysPubkey: swapQuote.binArraysPubkey,
    inAmount: swapAmount,
    lbPair: dlmmPool.pubkey,
    user: user.publicKey,
    minOutAmount: swapQuote.minOutAmount,
    outToken: dlmmPool.tokenY.publicKey,
  });

  try {
    const swapTxHash = await sendAndConfirmTransaction(connection, swapTx, [
      user,
    ]);
    console.log("🚀 ~ swapTxHash:", swapTxHash);
  } catch (error) {
    console.log("🚀 ~ error:", JSON.parse(JSON.stringify(error)));
  }
}

async function main() {
  const dlmmPool = await DLMM.create(connection, devnetPool, {
    cluster: "devnet",
  });

  await getActiveBin(dlmmPool);
  await createPosition(dlmmPool);
  await getPositionsState(dlmmPool);
  await addLiquidityToExistingPosition(dlmmPool);
  await removeLiquidity(dlmmPool);
  await swap(dlmmPool);
}

main();
