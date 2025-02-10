import { AccountMeta, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { binIdToBinArrayIndex } from "../binArray";
import { deriveBinArray } from "../derive";

export * from "./wrapper";

export function getBinArrayIndexesCoverage(lowerBinId: BN) {
  const lowerBinArrayIndex = binIdToBinArrayIndex(lowerBinId);
  const upperBinArrayIndex = lowerBinArrayIndex.add(new BN(1));

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
  lbPair: PublicKey,
  programId: PublicKey
) {
  const lowerBinArrayIndex = binIdToBinArrayIndex(lowerBinId);
  const upperBinArrayIndex = lowerBinArrayIndex.add(new BN(1));

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
  lbPair: PublicKey,
  programId: PublicKey
): AccountMeta[] {
  return getBinArrayKeysCoverage(lowerBinId, lbPair, programId).map((key) => {
    return {
      pubkey: key,
      isSigner: false,
      isWritable: true,
    };
  });
}
