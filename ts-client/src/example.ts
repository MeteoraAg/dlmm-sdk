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
import BN from "bn.js";
import { BinLiquidity, LbPosition, StrategyType } from "./dlmm/types";

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

let activeBin: BinLiquidity;
let userPositions: LbPosition[] = [];

const newBalancePosition = new Keypair();
const newImbalancePosition = new Keypair();
const newOneSidePosition = new Keypair();

async function getActiveBin(dlmmPool: DLMM) {
  // Get pool state
  activeBin = await dlmmPool.getActiveBin();
  console.log("🚀 ~ activeBin:", activeBin);
}

// To create a balance deposit position
async function createBalancePosition(dlmmPool: DLMM) {
  const TOTAL_RANGE_INTERVAL = 10; // 10 bins on each side of the active bin
  const minBinId = activeBin.binId - TOTAL_RANGE_INTERVAL;
  const maxBinId = activeBin.binId + TOTAL_RANGE_INTERVAL;

  const activeBinPricePerToken = dlmmPool.fromPricePerLamport(
    Number(activeBin.price)
  );
  const totalXAmount = new BN(100);
  const totalYAmount = totalXAmount.mul(new BN(Number(activeBinPricePerToken)));

  // Create Position
  const createPositionTx =
    await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: newBalancePosition.publicKey,
      user: user.publicKey,
      totalXAmount,
      totalYAmount,
      strategy: {
        maxBinId,
        minBinId,
        strategyType: StrategyType.SpotBalanced,
      },
    });

  try {
    const createBalancePositionTxHash = await sendAndConfirmTransaction(
      connection,
      createPositionTx,
      [user, newBalancePosition]
    );
    console.log(
      "🚀 ~ createBalancePositionTxHash:",
      createBalancePositionTxHash
    );
  } catch (error) {
    console.log("🚀 ~ error:", JSON.parse(JSON.stringify(error)));
  }
}

async function createImbalancePosition(dlmmPool: DLMM) {
  const TOTAL_RANGE_INTERVAL = 10; // 10 bins on each side of the active bin
  const minBinId = activeBin.binId - TOTAL_RANGE_INTERVAL;
  const maxBinId = activeBin.binId + TOTAL_RANGE_INTERVAL;

  const totalXAmount = new BN(100);
  const totalYAmount = new BN(50);

  // Create Position
  const createPositionTx =
    await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: newImbalancePosition.publicKey,
      user: user.publicKey,
      totalXAmount,
      totalYAmount,
      strategy: {
        maxBinId,
        minBinId,
        strategyType: StrategyType.SpotImBalanced,
      },
    });

  try {
    const createImbalancePositionTxHash = await sendAndConfirmTransaction(
      connection,
      createPositionTx,
      [user, newImbalancePosition]
    );
    console.log(
      "🚀 ~ createImbalancePositionTxHash:",
      createImbalancePositionTxHash
    );
  } catch (error) {
    console.log("🚀 ~ error:", JSON.parse(JSON.stringify(error)));
  }
}

async function createOneSidePosition(dlmmPool: DLMM) {
  const TOTAL_RANGE_INTERVAL = 10; // 10 bins on each side of the active bin
  const minBinId = activeBin.binId;
  const maxBinId = activeBin.binId + TOTAL_RANGE_INTERVAL * 2;

  const totalXAmount = new BN(100);
  const totalYAmount = new BN(0);

  // Create Position
  const createPositionTx =
    await dlmmPool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: newOneSidePosition.publicKey,
      user: user.publicKey,
      totalXAmount,
      totalYAmount,
      strategy: {
        maxBinId,
        minBinId,
        strategyType: StrategyType.SpotOneSide,
      },
    });

  try {
    const createOneSidePositionTxHash = await sendAndConfirmTransaction(
      connection,
      createPositionTx,
      [user, newOneSidePosition]
    );
    console.log(
      "🚀 ~ createOneSidePositionTxHash:",
      createOneSidePositionTxHash
    );
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
  const TOTAL_RANGE_INTERVAL = 10; // 10 bins on each side of the active bin
  const minBinId = activeBin.binId - TOTAL_RANGE_INTERVAL;
  const maxBinId = activeBin.binId + TOTAL_RANGE_INTERVAL;

  const activeBinPricePerToken = dlmmPool.fromPricePerLamport(
    Number(activeBin.price)
  );
  const totalXAmount = new BN(100);
  const totalYAmount = totalXAmount.mul(new BN(Number(activeBinPricePerToken)));

  // Add Liquidity to existing position
  const addLiquidityTx = await dlmmPool.addLiquidityByStrategy({
    positionPubKey: newBalancePosition.publicKey,
    user: user.publicKey,
    totalXAmount,
    totalYAmount,
    strategy: {
      maxBinId,
      minBinId,
      strategyType: StrategyType.SpotBalanced,
    },
  });

  try {
    const addLiquidityTxHash = await sendAndConfirmTransaction(
      connection,
      addLiquidityTx,
      [user]
    );
    console.log("🚀 ~ addLiquidityTxHash:", addLiquidityTxHash);
  } catch (error) {
    console.log("🚀 ~ error:", JSON.parse(JSON.stringify(error)));
  }
}

async function removePositionLiquidity1(dlmmPool: DLMM) {
  const userPosition = userPositions.find(({ publicKey }) =>
    publicKey.equals(newBalancePosition.publicKey)
  );
  // Remove Liquidity
  const binIdsToRemove = userPosition.positionData.positionBinData.map(
    (bin) => bin.binId
  );
  const removeLiquidityTx = await dlmmPool.removeLiquidity({
    position: userPosition.publicKey,
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
      const removeBalanceLiquidityTxHash = await sendAndConfirmTransaction(
        connection,
        tx,
        [user],
        { skipPreflight: false, preflightCommitment: "confirmed" }
      );
      console.log(
        "🚀 ~ removeBalanceLiquidityTxHash:",
        removeBalanceLiquidityTxHash
      );
    }
  } catch (error) {
    console.log("🚀 ~ error:", JSON.parse(JSON.stringify(error)));
  }
}

async function removePositionLiquidity2(dlmmPool: DLMM) {
  const userPosition = userPositions.find(({ publicKey }) =>
    publicKey.equals(newImbalancePosition.publicKey)
  );
  // Remove Liquidity
  const binIdsToRemove = userPosition.positionData.positionBinData.map(
    (bin) => bin.binId
  );
  const removeLiquidityTx = await dlmmPool.removeLiquidity({
    position: userPosition.publicKey,
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
      const removeImbalanceLiquidityTxHash = await sendAndConfirmTransaction(
        connection,
        tx,
        [user],
        { skipPreflight: false, preflightCommitment: "confirmed" }
      );
      console.log(
        "🚀 ~ removeImbalanceLiquidityTxHash:",
        removeImbalanceLiquidityTxHash
      );
    }
  } catch (error) {
    console.log("🚀 ~ error:", JSON.parse(JSON.stringify(error)));
  }
}

async function removePositionLiquidity3(dlmmPool: DLMM) {
  const userPosition = userPositions.find(({ publicKey }) =>
    publicKey.equals(newOneSidePosition.publicKey)
  );
  // Remove Liquidity
  const binIdsToRemove = userPosition.positionData.positionBinData.map(
    (bin) => bin.binId
  );
  const removeLiquidityTx = await dlmmPool.removeLiquidity({
    position: userPosition.publicKey,
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
      const removeOneSideLiquidityTxHash = await sendAndConfirmTransaction(
        connection,
        tx,
        [user],
        { skipPreflight: false, preflightCommitment: "confirmed" }
      );
      console.log(
        "🚀 ~ removeOneSideLiquidityTxHash:",
        removeOneSideLiquidityTxHash
      );
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
  await createBalancePosition(dlmmPool);
  await createImbalancePosition(dlmmPool);
  await createOneSidePosition(dlmmPool);
  await getPositionsState(dlmmPool);
  await addLiquidityToExistingPosition(dlmmPool);
  await removePositionLiquidity1(dlmmPool);
  await removePositionLiquidity2(dlmmPool);
  await removePositionLiquidity3(dlmmPool);
  await swap(dlmmPool);
}

main();
