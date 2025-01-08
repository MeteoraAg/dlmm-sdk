import BN from "bn.js";
import { binIdToBinArrayIndex } from "../binArray";
import { AccountMeta, Connection, PublicKey } from "@solana/web3.js";
import { deriveBinArray } from "../derive";
import { LbPosition } from "../../types";
import { DEFAULT_BIN_PER_POSITION } from "../../constants";
import {
  POSITION_BIN_DATA_LENGTH,
  POSITION_V3_METADATA_LENGTH,
} from "./wrapper";

export * from "./wrapper";

export function getBinArrayIndexBound(lowerBinId: BN, upperBinId: BN) {
  const lowerBinArrayIndex = binIdToBinArrayIndex(lowerBinId);
  const upperBinArrayIndex = binIdToBinArrayIndex(upperBinId);

  return [lowerBinArrayIndex, upperBinArrayIndex];
}

export function getBinArrayIndexesCoverage(lowerBinId: BN, upperBinId: BN) {
  const [lowerBinArrayIndex, upperBinArrayIndex] = getBinArrayIndexBound(
    lowerBinId,
    upperBinId
  );

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
  const [lowerBinArrayIndex, upperBinArrayIndex] = getBinArrayIndexBound(
    lowerBinId,
    upperBinId
  );

  const binArrayKeys: PublicKey[] = [];

  for (
    let i = lowerBinArrayIndex.toNumber();
    i <= upperBinArrayIndex.toNumber();
    i++
  ) {
    binArrayKeys.push(deriveBinArray(lbPair, new BN(i), programId)[0]);
  }

  return binArrayKeys;
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

export function chunkPositionFeesAndRewards(
  position: LbPosition,
  minBinId: number,
  maxBinId: number
) {
  const chunkedFeesAndRewards: {
    minBinId: number;
    maxBinId: number;
    feeXAmount: BN;
    feeYAmount: BN;
    rewardAmounts: BN[];
  }[] = [];

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
      });

      totalFeeXAmount = new BN(0);
      totalFeeYAmount = new BN(0);
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
