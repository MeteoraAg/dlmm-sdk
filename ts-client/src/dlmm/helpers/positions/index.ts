import { AccountMeta, Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { binIdToBinArrayIndex } from "../binArray";
import { deriveBinArray } from "../derive";
import {
  ExtendedPositionBinData,
  LbPosition,
  POSITION_BIN_DATA_SIZE,
  POSITION_MIN_SIZE,
  PositionData,
  PositionV2,
} from "../../types";
import { DEFAULT_BIN_PER_POSITION, POSITION_MAX_LENGTH } from "../../constants";
import { Program } from "@coral-xyz/anchor";
import { LbClmm } from "../../idl";

export * from "./wrapper";

export function getBinArrayIndexesCoverage(lowerBinId: BN, upperBinId: BN) {
  const lowerBinArrayIndex = binIdToBinArrayIndex(lowerBinId);
  const upperBinArrayIndex = binIdToBinArrayIndex(upperBinId);

  const binArrayIndexes: BN[] = [];

  for (
    let i = lowerBinArrayIndex.toNumber();
    i <= upperBinArrayIndex.toNumber();
    i++
  ) {
    binArrayIndexes.push(new BN(i));
  }

  return binArrayIndexes;
}

export function getBinArrayKeysCoverage(
  lowerBinId: BN,
  upperBinId: BN,
  lbPair: PublicKey,
  programId: PublicKey
) {
  const binArrayIndexes = getBinArrayIndexesCoverage(lowerBinId, upperBinId);

  return binArrayIndexes.map((index) => {
    return deriveBinArray(lbPair, index, programId)[0];
  });
}

export function getBinArrayAccountMetasCoverage(
  lowerBinId: BN,
  upperBinId: BN,
  lbPair: PublicKey,
  programId: PublicKey
): AccountMeta[] {
  return getBinArrayKeysCoverage(lowerBinId, upperBinId, lbPair, programId).map(
    (key) => {
      return {
        pubkey: key,
        isSigner: false,
        isWritable: true,
      };
    }
  );
}

export function getPositionLowerUpperBinIdWithLiquidity(
  position: PositionData
): { lowerBinId: BN; upperBinId: BN } | null {
  const binWithLiquidity = position.positionBinData.filter(
    (b) =>
      !new BN(b.binLiquidity).isZero() ||
      !new BN(b.positionFeeXAmount.toString()).isZero() ||
      !new BN(b.positionFeeYAmount.toString()).isZero() ||
      !new BN(b.positionRewardAmount[0].toString()).isZero() ||
      !new BN(b.positionRewardAmount[1].toString()).isZero()
  );

  return binWithLiquidity.length > 0
    ? {
        lowerBinId: new BN(binWithLiquidity[0].binId),
        upperBinId: new BN(binWithLiquidity[binWithLiquidity.length - 1].binId),
      }
    : null;
}

export function isPositionNoFee(position: PositionData): boolean {
  return position.feeX.isZero() && position.feeY.isZero();
}

export function isPositionNoReward(position: PositionData): boolean {
  return position.rewardOne.isZero() && position.rewardTwo.isZero();
}

/**
 * Divides a range of bin IDs into chunks, each with a maximum length defined by POSITION_MAX_LENGTH,
 * and returns an array of objects representing the lower and upper bin IDs for each chunk.
 *
 * @param {number} minBinId - The starting bin ID of the range.
 * @param {number} maxBinId - The ending bin ID of the range.
 * @returns {{ lowerBinId: number; upperBinId: number }[]} An array of objects, each containing a
 *   'lowerBinId' and 'upperBinId', representing the range of bin IDs in each chunk.
 */

export function chunkBinRangeIntoExtendedPositions(
  minBinId: number,
  maxBinId: number
): { lowerBinId: number; upperBinId: number }[] {
  const chunkedBinRange = [];

  for (
    let currentMinBinId = minBinId;
    currentMinBinId <= maxBinId;
    currentMinBinId += POSITION_MAX_LENGTH.toNumber()
  ) {
    const currentMaxBinId = Math.min(
      currentMinBinId + POSITION_MAX_LENGTH.toNumber() - 1,
      maxBinId
    );

    chunkedBinRange.push({
      lowerBinId: currentMinBinId,
      upperBinId: currentMaxBinId,
    });
  }

  return chunkedBinRange;
}

/**
 * Divides a range of bin IDs into chunks, each with a length defined by DEFAULT_BIN_PER_POSITION,
 * and returns an array of objects representing the lower and upper bin IDs for each chunk.
 * Mainly used for chunking bin range to execute multiple add/remove liquidity, claim fee/reward
 *
 * @param {number} minBinId - The starting bin ID of the range.
 * @param {number} maxBinId - The ending bin ID of the range.
 * @returns {{ lowerBinId: number; upperBinId: number }[]} An array of objects, each containing a
 *   'lowerBinId' and 'upperBinId', representing the range of bin IDs in each chunk.
 */
export function chunkBinRange(
  minBinId: number,
  maxBinId: number
): { lowerBinId: number; upperBinId: number }[] {
  const chunkedBinRange = [];
  let startBinId = minBinId;

  while (startBinId <= maxBinId) {
    const endBinId = Math.min(
      startBinId + DEFAULT_BIN_PER_POSITION.toNumber() - 1,
      maxBinId
    );

    chunkedBinRange.push({
      lowerBinId: startBinId,
      upperBinId: endBinId,
    });

    startBinId += DEFAULT_BIN_PER_POSITION.toNumber();
  }

  return chunkedBinRange;
}

export function chunkPositionBinRange(
  position: LbPosition,
  minBinId: number,
  maxBinId: number
) {
  const chunkedFeesAndRewards: {
    minBinId: number;
    maxBinId: number;
    amountX: BN;
    amountY: BN;
    feeXAmount: BN;
    feeYAmount: BN;
    rewardAmounts: BN[];
  }[] = [];

  let totalAmountX = new BN(0);
  let totalAmountY = new BN(0);
  let totalFeeXAmount = new BN(0);
  let totalFeeYAmount = new BN(0);
  let totalRewardAmounts = [new BN(0), new BN(0)];
  let count = 0;

  for (let i = 0; i < position.positionData.positionBinData.length; i++) {
    const positionBinData = position.positionData.positionBinData[i];

    if (
      positionBinData.binId >= minBinId &&
      positionBinData.binId <= maxBinId
    ) {
      totalFeeXAmount = totalFeeXAmount.add(
        new BN(positionBinData.positionFeeXAmount)
      );
      totalFeeYAmount = totalFeeYAmount.add(
        new BN(positionBinData.positionFeeYAmount)
      );
      totalAmountX = totalAmountX.add(new BN(positionBinData.positionXAmount));
      totalAmountY = totalAmountY.add(new BN(positionBinData.positionYAmount));

      for (const [
        index,
        reward,
      ] of positionBinData.positionRewardAmount.entries()) {
        totalRewardAmounts[index] = totalRewardAmounts[index].add(
          new BN(reward)
        );
      }

      count++;
    }

    if (
      count === DEFAULT_BIN_PER_POSITION.toNumber() ||
      positionBinData.binId == maxBinId
    ) {
      chunkedFeesAndRewards.push({
        minBinId: positionBinData.binId - count + 1,
        maxBinId: positionBinData.binId,
        feeXAmount: totalFeeXAmount,
        feeYAmount: totalFeeYAmount,
        rewardAmounts: totalRewardAmounts,
        amountX: totalAmountX,
        amountY: totalAmountY,
      });

      totalFeeXAmount = new BN(0);
      totalFeeYAmount = new BN(0);
      totalAmountX = new BN(0);
      totalAmountY = new BN(0);
      totalRewardAmounts = [new BN(0), new BN(0)];

      count = 0;
    }
  }

  return chunkedFeesAndRewards;
}

export function calculatePositionSize(binCount: BN) {
  const extraBinCount = binCount.gt(DEFAULT_BIN_PER_POSITION)
    ? binCount.sub(DEFAULT_BIN_PER_POSITION)
    : new BN(0);
  return new BN(POSITION_MIN_SIZE).add(
    extraBinCount.mul(new BN(POSITION_BIN_DATA_SIZE))
  );
}

/**
 * Get the minimum balance required to pay for the rent exemption of a
 * position with the given bin count.
 *
 * @param connection The connection to the Solana RPC node.
 * @param binCount The number of bins in the position.
 * @returns The minimum balance required to pay for the rent exemption.
 */
export function getPositionRentExemption(connection: Connection, binCount: BN) {
  const size = calculatePositionSize(binCount);
  return connection.getMinimumBalanceForRentExemption(size.toNumber());
}

/**
 * Calculate the minimum lamports required to expand a position to a given
 * width.
 *
 * The function takes into account the current width of the position and the
 * width to expand to. If the expanded width is less than or equal to the
 * default bin count per position, the function returns 0.
 *
 * @param currentMinBinId The current minimum bin ID of the position.
 * @param currentMaxBinId The current maximum bin ID of the position.
 * @param connection The connection to the Solana RPC node.
 * @param binCountToExpand The number of bins to expand the position by.
 * @returns The minimum lamports required to expand the position to the given
 * width.
 */
export async function getPositionExpandRentExemption(
  currentMinBinId: BN,
  currentMaxBinId: BN,
  connection: Connection,
  binCountToExpand: BN
) {
  const currentPositionWidth = currentMaxBinId.sub(currentMinBinId).addn(1);
  const positionWidthAfterExpand = currentPositionWidth.add(binCountToExpand);
  if (positionWidthAfterExpand.lte(DEFAULT_BIN_PER_POSITION)) {
    return 0;
  } else {
    const binCountInExpandedBytes = positionWidthAfterExpand.sub(
      DEFAULT_BIN_PER_POSITION
    );
    const expandSize =
      binCountInExpandedBytes.toNumber() * POSITION_BIN_DATA_SIZE;
    const [minimumLamports, rentExemptionLamports] = await Promise.all([
      connection.getMinimumBalanceForRentExemption(0),
      connection.getMinimumBalanceForRentExemption(expandSize),
    ]);

    return rentExemptionLamports - minimumLamports;
  }
}

/**
 * Calculate the number of extended bins in a position.
 *
 * @param minBinId The minimum bin ID of the position.
 * @param maxBinId The maximum bin ID of the position.
 * @returns The number of extended bins in the position. If the position width is
 * less than or equal to the default bin count per position, returns 0.
 */
export function getExtendedPositionBinCount(minBinId: BN, maxBinId: BN) {
  const width = maxBinId.sub(minBinId).addn(1);
  const extended = width.sub(DEFAULT_BIN_PER_POSITION);

  return extended.lte(new BN(0)) ? new BN(0) : extended;
}

/**
 * Decode the extended position data.
 *
 * @param base The base position with the base data.
 * @param program The program that the position is associated with.
 * @param bytes The buffer of bytes to decode.
 * @returns The decoded extended position data.
 */
export function decodeExtendedPosition(
  base: PositionV2,
  program: Program<LbClmm>,
  bytes: Buffer
): ExtendedPositionBinData[] {
  const width = base.upperBinId - base.lowerBinId + 1;
  const extendedWidth = width - DEFAULT_BIN_PER_POSITION.toNumber();

  const extendedPosition: ExtendedPositionBinData[] = [];

  for (let i = 0; i < extendedWidth; i++) {
    const offset = i * POSITION_BIN_DATA_SIZE;
    const data = bytes.subarray(offset, offset + POSITION_BIN_DATA_SIZE);
    const decodedPositionBinData = program.coder.types.decode(
      // TODO: Find a type safe way
      "positionBinData",
      data
    ) as ExtendedPositionBinData;
    extendedPosition.push(decodedPositionBinData);
  }

  return extendedPosition;
}
