import BN from "bn.js";
import {
  ExtendedPositionBinData,
  POSITION_BIN_DATA_SIZE,
  POSITION_MIN_SIZE,
  PositionV2,
  PositionVersion,
  UserFeeInfo,
  UserRewardInfo,
} from "../../types";
import { AccountInfo, PublicKey } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { LbClmm } from "../../idl";
import {
  decodeExtendedPosition,
  getBinArrayIndexesCoverage,
  getBinArrayKeysCoverage,
} from ".";
import { binIdToBinArrayIndex } from "../binArray";
import { deriveBinArray } from "../derive";
import { decodeAccount, getAccountDiscriminator } from "..";

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
  width(): BN;
}

interface CombinedPositionBinData {
  liquidityShares: BN[];
  rewardInfos: UserRewardInfo[];
  feeInfos: UserFeeInfo[];
}

function combineBaseAndExtendedPositionBinData(
  base: PositionV2,
  extended: ExtendedPositionBinData[]
): CombinedPositionBinData {
  const combinedLiquidityShares = base.liquidityShares;
  const combinedRewardInfos = base.rewardInfos;
  const combinedFeeInfos = base.feeInfos;

  for (const binData of extended) {
    combinedLiquidityShares.push(binData.liquidityShare);
    combinedRewardInfos.push(binData.rewardInfo);
    combinedFeeInfos.push(binData.feeInfo);
  }

  return {
    liquidityShares: combinedLiquidityShares,
    rewardInfos: combinedRewardInfos,
    feeInfos: combinedFeeInfos,
  };
}

export function wrapPosition(
  program: Program<LbClmm>,
  key: PublicKey,
  account: AccountInfo<Buffer>
): IPosition {
  const disc = account.data.subarray(0, 8);
  if (disc.equals(Buffer.from(getAccountDiscriminator("positionV2")))) {
    const state = decodeAccount<PositionV2>(
      program,
      "positionV2",
      account.data
    );

    const extended = decodeExtendedPosition(
      state,
      program,
      account.data.subarray(8 + POSITION_MIN_SIZE)
    );

    const combinedPositionBinData = combineBaseAndExtendedPositionBinData(
      state,
      extended
    );

    return new PositionV2Wrapper(key, state, extended, combinedPositionBinData);
  } else {
    throw new Error("Unknown position account");
  }
}

export class PositionV2Wrapper implements IPosition {
  constructor(
    public positionAddress: PublicKey,
    public inner: PositionV2,
    public extended: ExtendedPositionBinData[],
    public combinedPositionBinData: CombinedPositionBinData
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
    return this.combinedPositionBinData.liquidityShares;
  }

  rewardInfos(): UserRewardInfo[] {
    return this.combinedPositionBinData.rewardInfos;
  }

  feeInfos(): UserFeeInfo[] {
    return this.combinedPositionBinData.feeInfos;
  }

  lastUpdatedAt(): BN {
    return this.inner.lastUpdatedAt;
  }

  getBinArrayIndexesCoverage(): BN[] {
    const isExtended = this.extended.length > 0;
    if (isExtended) {
      return getBinArrayIndexesCoverage(this.lowerBinId(), this.upperBinId());
    } else {
      const lowerBinArrayIndex = binIdToBinArrayIndex(this.lowerBinId());
      const upperBinArrayIndex = lowerBinArrayIndex.add(new BN(1));
      return [lowerBinArrayIndex, upperBinArrayIndex];
    }
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

  width(): BN {
    return this.upperBinId().sub(this.lowerBinId()).add(new BN(1));
  }
}
