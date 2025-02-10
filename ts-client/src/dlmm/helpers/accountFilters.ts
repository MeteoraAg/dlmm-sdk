import { GetProgramAccountsFilter, PublicKey } from "@solana/web3.js";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import BN from "bn.js";

export const presetParameter2BinStepFilter = (
  binStep: BN
): GetProgramAccountsFilter => {
  return {
    memcmp: {
      bytes: bs58.encode(binStep.toArrayLike(Buffer, "le", 2)),
      offset: 8,
    },
  };
};

export const presetParameter2BaseFactorFilter = (
  baseFactor: BN
): GetProgramAccountsFilter => {
  return {
    memcmp: {
      bytes: bs58.encode(baseFactor.toArrayLike(Buffer, "le", 2)),
      offset: 8 + 2,
    },
  };
};

export const presetParameter2BaseFeePowerFactor = (
  baseFeePowerFactor: BN
): GetProgramAccountsFilter => {
  return {
    memcmp: {
      bytes: bs58.encode(baseFeePowerFactor.toArrayLike(Buffer, "le", 1)),
      offset: 8 + 22,
    },
  };
};

export const binArrayLbPairFilter = (
  lbPair: PublicKey
): GetProgramAccountsFilter => {
  return {
    memcmp: {
      bytes: lbPair.toBase58(),
      offset: 8 + 16,
    },
  };
};

export const positionOwnerFilter = (
  owner: PublicKey
): GetProgramAccountsFilter => {
  return {
    memcmp: {
      bytes: owner.toBase58(),
      offset: 8 + 32,
    },
  };
};

export const positionLbPairFilter = (
  lbPair: PublicKey
): GetProgramAccountsFilter => {
  return {
    memcmp: {
      bytes: bs58.encode(lbPair.toBuffer()),
      offset: 8,
    },
  };
};
