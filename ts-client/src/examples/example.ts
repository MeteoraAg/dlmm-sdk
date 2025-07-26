import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { DLMM } from "../dlmm";
import BN from "bn.js";
import { BinLiquidity, LbPosition, StrategyType } from "../dlmm/types";

const user = Keypair.fromSecretKey(
  new Uint8Array(bs58.decode(process.env.USER_PRIVATE_KEY))
);
const RPC = process.env.RPC || "https://api.devnet.solana.com";
const connection = new Connection(RPC, "finalized");

const poolAddress = new PublicKey(
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
const newEmptyPosition = new Keypair();

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
        strategyType: StrategyType.Spot,
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
        strategyType: StrategyType.Spot,
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
        strategyType: StrategyType.Spot,
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
      strategyType: StrategyType.Spot,
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

async function removePositionLiquidity(dlmmPool: DLMM) {
  // Remove Liquidity
  const removeLiquidityTxs = (
    await Promise.all(
      userPositions.map(({ publicKey, positionData }) => {
        const binIdsToRemove = positionData.positionBinData.map(
          (bin) => bin.binId
        );
        return dlmmPool.removeLiquidity({
          position: publicKey,
          user: user.publicKey,
          fromBinId: binIdsToRemove[0],
          toBinId: binIdsToRemove[binIdsToRemove.length - 1],
          bps: new BN(100 * 100),
          shouldClaimAndClose: true, // should claim swap fee and close position together
        });
      })
    )
  ).flat();

  try {
    for (let tx of removeLiquidityTxs) {
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

async function swap(dlmmPool: DLMM) {
  const swapAmount = new BN(100);
  // Swap quote
  const swapYtoX = true;
  const binArrays = await dlmmPool.getBinArrayForSwap(swapYtoX);

  const swapQuote = await dlmmPool.swapQuote(
    swapAmount,
    swapYtoX,
    new BN(10),
    binArrays
  );

  console.log("🚀 ~ swapQuote:", swapQuote);

  const [inToken, outToken] = swapYtoX
  ? [dlmmPool.tokenY.publicKey, dlmmPool.tokenX.publicKey]
  : [dlmmPool.tokenX.publicKey, dlmmPool.tokenY.publicKey];

  // Swap
  const swapTx = await dlmmPool.swap({
    inToken,
    binArraysPubkey: swapQuote.binArraysPubkey,
    inAmount: swapAmount,
    lbPair: dlmmPool.pubkey,
    user: user.publicKey,
    minOutAmount: swapQuote.minOutAmount,
    outToken,
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

async function  addPriorityFeeToTransaction(
  connection: Connection, 
  originalTx: Transaction, 
  microLamports: number = 10000
): Promise<Transaction> {
  // Create a new transaction
  const priorityFeeTx = new Transaction();
  
  priorityFeeTx.add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports })
  );

  // Add all instructions from the original transaction
  originalTx.instructions.forEach(instruction => {
      priorityFeeTx.add(instruction);
  });

  // Set recent blockhash and fee payer
  const { blockhash } = await connection.getLatestBlockhash();
  priorityFeeTx.recentBlockhash = blockhash;
  priorityFeeTx.feePayer = user.publicKey;

  return priorityFeeTx;
}

async function createEmptyPosition(dlmmPool:DLMM) {
    const minBinId = activeBin.binId - 68/2; //Below 69 Bins for standard position 
    const maxBinId = activeBin.binId + 68/2;   //34 Bins each side of current active bin
    const emptyPositionTx = await dlmmPool.createEmptyPosition({
      positionPubKey: newEmptyPosition.publicKey,
      user: user.publicKey,
        maxBinId,
        minBinId,
    });
  
    try {
      /*
      Adding priority fee as an example here can be implemented in other functions as well 
      by replacing emptyPositionTx with priorityFeeTX 
      */
      const priorityFeeTx = await addPriorityFeeToTransaction(
        connection, 
        emptyPositionTx
      );

      const addLiquidityTxHash = await sendAndConfirmTransaction(connection, priorityFeeTx, [user,newEmptyPosition]);
      console.log("🚀 ~ Created Empty Position:", addLiquidityTxHash);
    } catch (error) {
      console.log("🚀 ~ error:", JSON.parse(JSON.stringify(error)));
    }
}



async function claimRewards(dlmmPool:DLMM) {
  
  const claimTx = await dlmmPool.claimAllRewardsByPosition({owner:user.publicKey,position:userPositions[0]}); //Claiming fee for first position if exists
          
  try {
      for (const tx of claimTx) {
        const txHash = await sendAndConfirmTransaction(connection, tx, [user]);
        console.log("🚀 ~ claimAllRewardsTxHash:", txHash);
      }
    } catch (error) {
      console.log("🚀 ~ error:", JSON.parse(JSON.stringify(error)));
    }
}

async function closeAnEmptyPosition(dlmmPool:DLMM) {
  const closetx = await dlmmPool.closePosition(
    {owner:user.publicKey,
    position:userPositions[0] //Closing first empty position
    })

    try {
      const closePositionTx = await sendAndConfirmTransaction(connection, closetx, [user]);
      console.log("🚀 ~ closePositionTxHash:", closePositionTx);
    } catch (error) {
     console.log("🚀 ~ error:", JSON.parse(JSON.stringify(error)));
    }
}

async function main() {
  const dlmmPool = await DLMM.create(connection, poolAddress, {
    cluster: "devnet",
  });

  await getActiveBin(dlmmPool);
  await createBalancePosition(dlmmPool);
  await createImbalancePosition(dlmmPool);
  await createOneSidePosition(dlmmPool);
  await getPositionsState(dlmmPool);
  await addLiquidityToExistingPosition(dlmmPool);
  await removePositionLiquidity(dlmmPool);
  await swap(dlmmPool);
  await closeAnEmptyPosition(dlmmPool);
  await claimRewards(dlmmPool);
  await createEmptyPosition(dlmmPool)
}

main();
