import BN from "bn.js";
import {
  POSITION_V2_DISC,
  PositionV2,
  PositionVersion,
  UserFeeInfo,
  UserRewardInfo,
} from "../../types";
import { AccountInfo, PublicKey } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { LbClmm } from "../../idl";
import { getBinArrayKeysCoverage } from ".";
import { binIdToBinArrayIndex } from "../binArray";
import { deriveBinArray } from "../derive";

export interface IPosition {
  address(): PublicKey;
  lowerBinId(): BN;
  upperBinId(): BN;
  liquidityShares(): BN[];
  rewardInfos(): UserRewardInfo[];
  feeInfos(): UserFeeInfo[];
  lastUpdatedAt(): BN;
  lbPair(): PublicKey;
  totalClaimedFeeXAmount(): BN;
  totalClaimedFeeYAmount(): BN;
  totalClaimedRewards(): BN[];
  operator(): PublicKey;
  lockReleasePoint(): BN;
  feeOwner(): PublicKey;
  owner(): PublicKey;
  getBinArrayIndexesCoverage(): BN[];
  getBinArrayKeysCoverage(programId: PublicKey): PublicKey[];
  version(): PositionVersion;
}

export function wrapPosition(
  program: Program<LbClmm>,
  key: PublicKey,
  account: AccountInfo<Buffer>
): IPosition {
  const disc = account.data.subarray(0, 8);
  if (disc.equals(POSITION_V2_DISC)) {
    const state = program.coder.accounts.decode(
      program.account.positionV2.idlAccount.name,
      account.data
    );
    return new PositionV2Wrapper(key, state);
  } else {
    throw new Error("Unknown position account");
  }
}

export class PositionV2Wrapper implements IPosition {
  constructor(
    public positionAddress: PublicKey,
    public inner: PositionV2
  ) {}

  address(): PublicKey {
    return this.positionAddress;
  }

  totalClaimedRewards(): BN[] {
    return this.inner.totalClaimedRewards;
  }

  feeOwner(): PublicKey {
    return this.inner.feeOwner;
  }

  lockReleasePoint(): BN {
    return this.inner.lockReleasePoint;
  }

  operator(): PublicKey {
    return this.inner.operator;
  }

  totalClaimedFeeYAmount(): BN {
    return this.inner.totalClaimedFeeYAmount;
  }

  totalClaimedFeeXAmount(): BN {
    return this.inner.totalClaimedFeeXAmount;
  }

  lbPair(): PublicKey {
    return this.inner.lbPair;
  }

  lowerBinId(): BN {
    return new BN(this.inner.lowerBinId);
  }

  upperBinId(): BN {
    return new BN(this.inner.upperBinId);
  }

  liquidityShares(): BN[] {
    return this.inner.liquidityShares;
  }

  rewardInfos(): UserRewardInfo[] {
    return this.inner.rewardInfos;
  }

  feeInfos(): UserFeeInfo[] {
    return this.inner.feeInfos;
  }

  lastUpdatedAt(): BN {
    return this.inner.lastUpdatedAt;
  }

  getBinArrayIndexesCoverage(): BN[] {
    const lowerBinArrayIndex = binIdToBinArrayIndex(this.lowerBinId());
    const upperBinArrayIndex = lowerBinArrayIndex.add(new BN(1));

    return [lowerBinArrayIndex, upperBinArrayIndex];
  }

  getBinArrayKeysCoverage(programId: PublicKey): PublicKey[] {
    return this.getBinArrayIndexesCoverage().map(
      (index) => deriveBinArray(this.lbPair(), index, programId)[0]
    );
  }

  version(): PositionVersion {
    return PositionVersion.V2;
  }

  owner(): PublicKey {
    return this.inner.owner;
  }
}
