import { AccountMeta, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { binIdToBinArrayIndex } from "../binArray";
import { deriveBinArray } from "../derive";
import { PositionData } from "../../types";

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
    (b) => !new BN(b.binLiquidity).isZero()
  );

  return binWithLiquidity.length > 0
    ? {
        lowerBinId: new BN(binWithLiquidity[0].binId),
        upperBinId: new BN(binWithLiquidity[binWithLiquidity.length - 1].binId),
      }
    : null;
}

export function isPositionNoFee(
  position: PositionData
): boolean {
  return (
    position.feeX.isZero() &&
    position.feeY.isZero()
  );
}

export function isPositionNoReward(
  position: PositionData
): boolean {
  return (
    position.rewardOne.isZero() &&
    position.rewardTwo.isZero()
  );
}
