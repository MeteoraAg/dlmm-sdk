import BN from "bn.js";
import { binIdToBinArrayIndex } from "../binArray";
import { AccountMeta, PublicKey } from "@solana/web3.js";
import { deriveBinArray } from "../derive";

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
