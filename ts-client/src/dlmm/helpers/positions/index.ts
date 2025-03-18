import { AccountMeta, Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { binIdToBinArrayIndex } from "../binArray";
import { deriveBinArray } from "../derive";
import { LbPosition, PositionData } from "../../types";
import {
  POSITION_BIN_DATA_LENGTH,
  POSITION_V3_METADATA_LENGTH,
} from "./wrapper";
import { DEFAULT_BIN_PER_POSITION } from "../../constants";

export * from "./wrapper";

export function getBinArrayIndexBound(lowerBinId: BN, upperBinId: BN) {
  const lowerBinArrayIndex = binIdToBinArrayIndex(lowerBinId);
  const upperBinArrayIndex = binIdToBinArrayIndex(upperBinId);

  return [lowerBinArrayIndex, upperBinArrayIndex];
}

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
  position: PositionData,
  lowerBinIdBound: BN,
  upperBinIdBound: BN
): { lowerBinId: BN; upperBinId: BN } | null {
  const binWithLiquidity = position.positionBinData.filter(
    (b) =>
      !new BN(b.binLiquidity).isZero() &&
      b.binId >= lowerBinIdBound.toNumber() &&
      b.binId <= upperBinIdBound.toNumber()
  );

  return binWithLiquidity.length > 0
    ? {
        lowerBinId: new BN(binWithLiquidity[0].binId),
        upperBinId: new BN(binWithLiquidity[binWithLiquidity.length - 1].binId),
      }
    : null;
}

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
  return (
    POSITION_V3_METADATA_LENGTH + binCount.toNumber() * POSITION_BIN_DATA_LENGTH
  );
}

export function getPositionRentExemption(connection: Connection, binCount: BN) {
  const size = calculatePositionSize(binCount);
  return connection.getMinimumBalanceForRentExemption(size);
}

export function getPositionExpandRentExemption(
  connection: Connection,
  binCountToExpand: BN
) {
  const expandSize = binCountToExpand.toNumber() * POSITION_BIN_DATA_LENGTH;
  return connection.getMinimumBalanceForRentExemption(expandSize);
}
