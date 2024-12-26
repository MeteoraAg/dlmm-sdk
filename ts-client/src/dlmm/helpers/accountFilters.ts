import { GetProgramAccountsFilter, PublicKey } from "@solana/web3.js";
import { POSITION_V3_DISC } from "../types";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";

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

export const positionV3DiscFilter = (): GetProgramAccountsFilter => {
  return {
    memcmp: {
      bytes: bs58.encode(POSITION_V3_DISC),
      offset: 0,
    },
  };
};
