import BN from "bn.js";
import {
  POSITION_V2_DISC,
  POSITION_V3_DISC,
  PositionBinData,
  PositionBinRawData,
  PositionV2,
  PositionV3,
  PositionVersion,
  UserFeeInfo,
  UserRewardInfo,
} from "../../types";
import { AccountInfo, PublicKey } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { LbClmm } from "../../idl";
import { getBinArrayIndexesCoverage, getBinArrayKeysCoverage } from ".";
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

export const POSITION_V3_METADATA_LENGTH = 336;
export const POSITION_BIN_DATA_LENGTH = 112;

export function wrapPosition(
  program: Program<LbClmm>,
  key: PublicKey,
  account: AccountInfo<Buffer<ArrayBufferLike>>
): IPosition {
  const disc = account.data.subarray(0, 8);
  if (disc.equals(POSITION_V3_DISC)) {
    return DynamicPosition.fromAccount(program, key, account);
  } else if (disc.equals(POSITION_V2_DISC)) {
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

export class DynamicPosition implements IPosition {
  constructor(
    public positionAddress: PublicKey,
    public inner: PositionV3,
    public positionBinsData: PositionBinRawData[]
  ) {}

  public static fromAccount(
    program: Program<LbClmm>,
    address: PublicKey,
    account: AccountInfo<Buffer<ArrayBufferLike>>
  ) {
    const metadataBytes = account.data.subarray(0, POSITION_V3_METADATA_LENGTH);

    const contentBytes = account.data.subarray(
      POSITION_V3_METADATA_LENGTH,
      account.data.length
    );

    const positionV3: PositionV3 = program.coder.accounts.decode(
      program.account.positionV3.idlAccount.name,
      metadataBytes
    );

    const binCount = positionV3.upperBinId - positionV3.lowerBinId + 1;
    const positionBinsData: PositionBinRawData[] = [];

    for (let i = 0; i < binCount; i++) {
      const offset = POSITION_BIN_DATA_LENGTH * i;
      const positionBinDataBytes = contentBytes.subarray(
        offset,
        offset + POSITION_BIN_DATA_LENGTH
      );

      const positionBinData: PositionBinRawData = program.coder.types.decode(
        "PositionBinData",
        positionBinDataBytes
      );

      positionBinsData.push(positionBinData);
    }

    return new DynamicPosition(address, positionV3, positionBinsData);
  }

  address(): PublicKey {
    return this.positionAddress;
  }

  lowerBinId(): BN {
    return new BN(this.inner.lowerBinId);
  }

  upperBinId(): BN {
    return new BN(this.inner.upperBinId);
  }

  liquidityShares(): BN[] {
    return this.positionBinsData.map((p) => p.liquidityShare);
  }

  rewardInfos(): UserRewardInfo[] {
    return this.positionBinsData.map((p) => p.rewardInfo);
  }

  feeInfos(): UserFeeInfo[] {
    return this.positionBinsData.map((p) => p.feeInfo);
  }

  lastUpdatedAt(): BN {
    return this.inner.lastUpdatedAt;
  }

  lbPair(): PublicKey {
    return this.inner.lbPair;
  }

  totalClaimedFeeXAmount(): BN {
    return this.inner.totalClaimedFeeXAmount;
  }

  totalClaimedFeeYAmount(): BN {
    return this.inner.totalClaimedFeeYAmount;
  }

  totalClaimedRewards(): BN[] {
    return this.inner.totalClaimedRewards;
  }

  operator(): PublicKey {
    return this.inner.operator;
  }

  lockReleasePoint(): BN {
    return this.inner.lockReleasePoint;
  }

  feeOwner(): PublicKey {
    return this.inner.feeOwner;
  }

  getBinArrayIndexesCoverage(): BN[] {
    return getBinArrayIndexesCoverage(this.lowerBinId(), this.upperBinId());
  }

  getBinArrayKeysCoverage(programId: PublicKey): PublicKey[] {
    return getBinArrayKeysCoverage(
      this.lowerBinId(),
      this.upperBinId(),
      this.lbPair(),
      programId
    );
  }

  version(): PositionVersion {
    return PositionVersion.V3;
  }

  owner(): PublicKey {
    return this.inner.owner;
  }
}
