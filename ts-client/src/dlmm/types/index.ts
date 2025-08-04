import {
  BN,
  BorshAccountsCoder,
  IdlAccounts,
  IdlTypes,
  Program,
  ProgramAccount,
} from "@coral-xyz/anchor";
import { LbClmm } from "../idl";
import { getPriceOfBinByBinId } from "../helpers";
import {
  AccountMeta,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import Decimal from "decimal.js";
import { u64, i64, struct, rustEnum } from "@coral-xyz/borsh";
import { Mint } from "@solana/spl-token";
import { AllAccountsMap } from "@coral-xyz/anchor/dist/cjs/program/namespace/types";
import { RebalancePosition, SimulateRebalanceResp } from "../helpers/rebalance";

export interface FeeInfo {
  baseFeeRatePercentage: Decimal;
  maxFeeRatePercentage: Decimal;
  protocolFeePercentage: Decimal;
}

export interface BinAndAmount {
  binId: number;
  xAmountBpsOfTotal: BN;
  yAmountBpsOfTotal: BN;
}

export interface TokenReserve {
  publicKey: PublicKey;
  reserve: PublicKey;
  mint: Mint;
  amount: bigint;
  owner: PublicKey;
  transferHookAccountMetas: AccountMeta[];
}

export type ClmmProgram = Program<LbClmm>;

export type LbPair = IdlAccounts<LbClmm>["lbPair"];
export type LbPairAccount = ProgramAccount<IdlAccounts<LbClmm>["lbPair"]>;

export type AccountName = keyof AllAccountsMap<LbClmm>;

export type Bin = IdlTypes<LbClmm>["bin"];
export type BinArray = IdlAccounts<LbClmm>["binArray"];
export type BinArrayAccount = ProgramAccount<IdlAccounts<LbClmm>["binArray"]>;

export type Position = IdlAccounts<LbClmm>["position"];
export type PositionV2 = IdlAccounts<LbClmm>["positionV2"];

export type PresetParameter = IdlAccounts<LbClmm>["presetParameter"];
export type PresetParameter2 = IdlAccounts<LbClmm>["presetParameter2"];

export type vParameters = IdlAccounts<LbClmm>["lbPair"]["vParameters"];
export type sParameters = IdlAccounts<LbClmm>["lbPair"]["parameters"];
export type RewardInfos = IdlAccounts<LbClmm>["lbPair"]["rewardInfos"];
export type RewardInfo = IdlTypes<LbClmm>["rewardInfo"];

export type UserRewardInfo = IdlTypes<LbClmm>["userRewardInfo"];
export type UserFeeInfo = IdlTypes<LbClmm>["feeInfo"];
export type RebalanceAddLiquidityParam = IdlTypes<LbClmm>["addLiquidityParams"];
export type RebalanceRemoveLiquidityParam =
  IdlTypes<LbClmm>["removeLiquidityParams"];

export type InitPermissionPairIx = IdlTypes<LbClmm>["initPermissionPairIx"];
export type InitCustomizablePermissionlessPairIx =
  IdlTypes<LbClmm>["customizableParams"];

export type BinLiquidityDistribution =
  IdlTypes<LbClmm>["binLiquidityDistribution"];
export type BinLiquidityReduction = IdlTypes<LbClmm>["binLiquidityReduction"];

export type BinArrayBitmapExtensionAccount = ProgramAccount<
  IdlAccounts<LbClmm>["binArrayBitmapExtension"]
>;
export type BinArrayBitmapExtension =
  IdlAccounts<LbClmm>["binArrayBitmapExtension"];

export type LiquidityParameterByWeight =
  IdlTypes<LbClmm>["liquidityParameterByWeight"];
export type LiquidityOneSideParameter =
  IdlTypes<LbClmm>["liquidityOneSideParameter"];

export type LiquidityParameterByStrategy =
  IdlTypes<LbClmm>["liquidityParameterByStrategy"];
export type LiquidityParameterByStrategyOneSide =
  IdlTypes<LbClmm>["liquidityParameterByStrategyOneSide"];
export type LiquidityParameter = IdlTypes<LbClmm>["liquidityParameter"];

export type ProgramStrategyParameter = IdlTypes<LbClmm>["strategyParameters"];
export type ProgramStrategyType = IdlTypes<LbClmm>["strategyType"];

export type RemainingAccountInfo = IdlTypes<LbClmm>["remainingAccountsInfo"];
export type RemainingAccountsInfoSlice =
  IdlTypes<LbClmm>["remainingAccountsSlice"];

export type CompressedBinDepositAmount =
  IdlTypes<LbClmm>["compressedBinDepositAmount"];
export type CompressedBinDepositAmounts = CompressedBinDepositAmount[];

export type ResizeSideEnum = IdlTypes<LbClmm>["resizeSide"];
export type ExtendedPositionBinData = IdlTypes<LbClmm>["positionBinData"];

export interface LbPosition {
  publicKey: PublicKey;
  positionData: PositionData;
  version: PositionVersion;
}

export interface PositionInfo {
  publicKey: PublicKey;
  lbPair: LbPair;
  tokenX: TokenReserve;
  tokenY: TokenReserve;
  lbPairPositionsData: Array<LbPosition>;
}

export interface FeeInfo {
  baseFeeRatePercentage: Decimal;
  maxFeeRatePercentage: Decimal;
  protocolFeePercentage: Decimal;
}

export interface EmissionRate {
  rewardOne: Decimal | undefined;
  rewardTwo: Decimal | undefined;
}

export interface SwapFee {
  feeX: BN;
  feeY: BN;
}

export interface LMRewards {
  rewardOne: BN;
  rewardTwo: BN;
}

export enum PositionVersion {
  V1,
  V2,
}

export enum PairType {
  Permissionless,
  Permissioned,
}

export const Strategy = {
  SpotBalanced: { spotBalanced: {} },
  CurveBalanced: { curveBalanced: {} },
  BidAskBalanced: { bidAskBalanced: {} },
  SpotImBalanced: { spotImBalanced: {} },
  CurveImBalanced: { curveImBalanced: {} },
  BidAskImBalanced: { bidAskImBalanced: {} },
};

export enum StrategyType {
  Spot,
  Curve,
  BidAsk,
}

export enum ActivationType {
  Slot,
  Timestamp,
}

// This is position struct size, it doesn't include the discriminator bytes
export const POSITION_MIN_SIZE = 8112;
export const POSITION_BIN_DATA_SIZE = 112;

export interface StrategyParameters {
  maxBinId: number;
  minBinId: number;
  strategyType: StrategyType;
  singleSidedX?: boolean;
}

export interface TQuoteCreatePositionParams {
  strategy: StrategyParameters;
}

export interface TInitializePositionAndAddLiquidityParams {
  positionPubKey: PublicKey;
  totalXAmount: BN;
  totalYAmount: BN;
  xYAmountDistribution: BinAndAmount[];
  user: PublicKey;
  slippage?: number;
}

export interface TInitializePositionAndAddLiquidityParamsByStrategy {
  positionPubKey: PublicKey;
  totalXAmount: BN;
  totalYAmount: BN;
  strategy: StrategyParameters;
  user: PublicKey;
  slippage?: number;
}

export interface InitializeMultiplePositionAndAddLiquidityByStrategyResponse {
  instructionsByPositions: {
    positionKeypair: Keypair;
    initializePositionIx: TransactionInstruction;
    initializeAtaIxs: TransactionInstruction[];
    suggestedCuIxForInitializePositionAndAta: TransactionInstruction[];
    addLiquidityIxs: TransactionInstruction[][];
  }[];
}

export interface TInitializeMultiplePositionAndAddLiquidityParamsByStrategy {
  totalXAmount: BN;
  totalYAmount: BN;
  strategy: StrategyParameters;
  user: PublicKey;
  slippage?: number;
  customKeyPairGenerator?: () => Promise<Keypair>;
}

export interface BinLiquidity {
  binId: number;
  xAmount: BN;
  yAmount: BN;
  supply: BN;
  version: number;
  price: string;
  pricePerToken: string;
  feeAmountXPerTokenStored: BN;
  feeAmountYPerTokenStored: BN;
  rewardPerTokenStored: BN[];
}

export module BinLiquidity {
  export function fromBin(
    bin: Bin,
    binId: number,
    binStep: number,
    baseTokenDecimal: number,
    quoteTokenDecimal: number,
    version: number
  ): BinLiquidity {
    const pricePerLamport = getPriceOfBinByBinId(binId, binStep).toString();
    return {
      binId,
      xAmount: bin.amountX,
      yAmount: bin.amountY,
      supply: bin.liquiditySupply,
      price: pricePerLamport,
      version,
      pricePerToken: new Decimal(pricePerLamport)
        .mul(new Decimal(10 ** (baseTokenDecimal - quoteTokenDecimal)))
        .toString(),
      feeAmountXPerTokenStored: bin.feeAmountXPerTokenStored,
      feeAmountYPerTokenStored: bin.feeAmountYPerTokenStored,
      rewardPerTokenStored: bin.rewardPerTokenStored,
    };
  }

  export function empty(
    binId: number,
    binStep: number,
    baseTokenDecimal: number,
    quoteTokenDecimal: number,
    version: number
  ): BinLiquidity {
    const pricePerLamport = getPriceOfBinByBinId(binId, binStep).toString();
    return {
      binId,
      xAmount: new BN(0),
      yAmount: new BN(0),
      supply: new BN(0),
      price: pricePerLamport,
      version,
      pricePerToken: new Decimal(pricePerLamport)
        .mul(new Decimal(10 ** (baseTokenDecimal - quoteTokenDecimal)))
        .toString(),
      feeAmountXPerTokenStored: new BN(0),
      feeAmountYPerTokenStored: new BN(0),
      rewardPerTokenStored: [new BN(0), new BN(0)],
    };
  }
}

export interface SwapQuote {
  consumedInAmount: BN;
  outAmount: BN;
  fee: BN;
  protocolFee: BN;
  minOutAmount: BN;
  priceImpact: Decimal;
  binArraysPubkey: any[];
  endPrice: Decimal;
}

export interface SwapQuoteExactOut {
  inAmount: BN;
  outAmount: BN;
  fee: BN;
  priceImpact: Decimal;
  protocolFee: BN;
  maxInAmount: BN;
  binArraysPubkey: any[];
}

export interface IAccountsCache {
  binArrays: Map<String, BinArray>;
  lbPair: LbPair;
}

export interface PositionBinData {
  binId: number;
  price: string;
  pricePerToken: string;
  binXAmount: string;
  binYAmount: string;
  binLiquidity: string;
  positionLiquidity: string;
  positionXAmount: string;
  positionYAmount: string;
  positionFeeXAmount: string;
  positionFeeYAmount: string;
  positionRewardAmount: string[];
}

export interface PositionData {
  totalXAmount: string;
  totalYAmount: string;
  positionBinData: PositionBinData[];
  lastUpdatedAt: BN;
  upperBinId: number;
  lowerBinId: number;
  feeX: BN;
  feeY: BN;
  rewardOne: BN;
  rewardTwo: BN;
  feeOwner: PublicKey;
  totalClaimedFeeXAmount: BN;
  totalClaimedFeeYAmount: BN;
  feeXExcludeTransferFee: BN;
  feeYExcludeTransferFee: BN;
  rewardOneExcludeTransferFee: BN;
  rewardTwoExcludeTransferFee: BN;
  totalXAmountExcludeTransferFee: BN;
  totalYAmountExcludeTransferFee: BN;
  owner: PublicKey;
}

export interface SwapWithPriceImpactParams {
  /**
   * mint of in token
   */
  inToken: PublicKey;
  /**
   * mint of out token
   */
  outToken: PublicKey;
  /**
   * in token amount
   */
  inAmount: BN;
  /**
   * price impact in bps
   */
  priceImpact: BN;
  /**
   * desired lbPair to swap against
   */
  lbPair: PublicKey;
  /**
   * user
   */
  user: PublicKey;
  binArraysPubkey: PublicKey[];
}

export interface SwapParams {
  /**
   * mint of in token
   */
  inToken: PublicKey;
  /**
   * mint of out token
   */
  outToken: PublicKey;
  /**
   * in token amount
   */
  inAmount: BN;
  /**
   * minimum out with slippage
   */
  minOutAmount: BN;
  /**
   * desired lbPair to swap against
   */
  lbPair: PublicKey;
  /**
   * user
   */
  user: PublicKey;
  binArraysPubkey: PublicKey[];
}

export interface SwapExactOutParams {
  /**
   * mint of in token
   */
  inToken: PublicKey;
  /**
   * mint of out token
   */
  outToken: PublicKey;
  /**
   * out token amount
   */
  outAmount: BN;
  /**
   * maximum in amount, also known as slippage
   */
  maxInAmount: BN;
  /**
   * desired lbPair to swap against
   */
  lbPair: PublicKey;
  /**
   * user
   */
  user: PublicKey;
  binArraysPubkey: PublicKey[];
}

export interface GetOrCreateATAResponse {
  ataPubKey: PublicKey;
  ix?: TransactionInstruction;
}

export enum BitmapType {
  U1024,
  U512,
}

export interface SeedLiquidityResponse {
  sendPositionOwnerTokenProveIxs: TransactionInstruction[];
  initializeBinArraysAndPositionIxs: TransactionInstruction[][];
  addLiquidityIxs: TransactionInstruction[][];
  costBreakdown: SeedLiquidityCostBreakdown;
}

export interface SeedLiquiditySingleBinResponse {
  instructions: TransactionInstruction[];
  costBreakdown: SeedLiquidityCostBreakdown;
}

export interface SeedLiquidityCostBreakdown {
  tokenOwnerProveAssociatedTokenAccountLamports: BN;
  totalPositionLamports: BN;
  totalBinArraysLamports: BN;
  totalPositionCount: BN;
  totalBinArraysCount: BN;
  binArrayBitmapLamports: BN;
}

export interface Clock {
  slot: BN;
  epochStartTimestamp: BN;
  epoch: BN;
  leaderScheduleEpoch: BN;
  unixTimestamp: BN;
}

export const ClockLayout = struct([
  u64("slot"),
  i64("epochStartTimestamp"),
  u64("epoch"),
  u64("leaderScheduleEpoch"),
  i64("unixTimestamp"),
]);

export enum PairStatus {
  Enabled,
  Disabled,
}

export interface PairLockInfo {
  positions: Array<PositionLockInfo>;
}

export interface PositionLockInfo {
  positionAddress: PublicKey;
  owner: PublicKey;
  tokenXAmount: string;
  tokenYAmount: string;
  lockReleasePoint: number;
}

export enum ActionType {
  Liquidity,
  Reward,
}

export enum ResizeSide {
  Lower,
  Upper,
}

export const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);

export interface RebalancePositionResponse {
  rebalancePosition: RebalancePosition;
  simulationResult: SimulateRebalanceResp;
}

export interface RebalancePositionBinArrayRentalCostQuote {
  binArrayExistence: Set<string>;
  binArrayCount: number;
  binArrayCost: number;
  bitmapExtensionCost: number;
}
