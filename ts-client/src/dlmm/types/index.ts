import {
  BN,
  IdlAccounts,
  IdlTypes,
  Program,
  ProgramAccount,
} from "@coral-xyz/anchor";
import { LbClmm } from "../idl";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import Decimal from "decimal.js";
import { struct, s16, u16, s32 } from "@solana/buffer-layout";

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
  amount: bigint;
  decimal: number;
}

export type ClmmProgram = Program<LbClmm>;

export type LbPair = IdlAccounts<LbClmm>["lbPair"];
export type LbPairAccount = ProgramAccount<IdlAccounts<LbClmm>["lbPair"]>;

export type Bin = IdlTypes<LbClmm>["Bin"];
export type BinArray = IdlAccounts<LbClmm>["binArray"];
export type BinArrayAccount = ProgramAccount<IdlAccounts<LbClmm>["binArray"]>;

export type Position = IdlAccounts<LbClmm>["position"];

export type vParameters = IdlAccounts<LbClmm>["lbPair"]["vParameters"];
export type sParameters = IdlAccounts<LbClmm>["lbPair"]["parameters"];

export type BinLiquidityDistribution =
  IdlTypes<LbClmm>["BinLiquidityDistribution"];
export type BinLiquidityReduction = IdlTypes<LbClmm>["BinLiquidityReduction"];

export type BinArrayBitmapExtensionAccount = ProgramAccount<
  IdlAccounts<LbClmm>["binArrayBitmapExtension"]
>;
export type BinArrayBitmapExtension =
  IdlAccounts<LbClmm>["binArrayBitmapExtension"];

export type LiquidityParameterByWeight =
  IdlTypes<LbClmm>["LiquidityParameterByWeight"];
export type LiquidityOneSideParameter =
  IdlTypes<LbClmm>["LiquidityOneSideParameter"];

export type LiquidityParameterByStrategy =
  IdlTypes<LbClmm>["LiquidityParameterByStrategy"];
export type LiquidityParameterByStrategyOneSide =
  IdlTypes<LbClmm>["LiquidityParameterByStrategyOneSide"];

export type ProgramStrategyParameter = IdlTypes<LbClmm>["StrategyParameters"];
export type ProgramStrategyType = IdlTypes<LbClmm>["StrategyType"];

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
  rewardOne: Decimal;
  rewardTwo: Decimal;
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

export enum StrategyType {
  Spot,
  Curve,
  BidAsk,
}

export interface StrategyParameters {
  maxBinId: number;
  minBinId: number;
  strategyType: StrategyType;
  aRight: number; // for curve or bid/ask
  aLeft: number; // for curve or bid/ask
  centerBinId: number; // for curve or bid/ask
  weightRight: number; // for spot
  weightLeft: number; // for spot
}

export type ParabolicParameter = IdlTypes<LbClmm>["ParabolicParameter"];
export const parabolicParameter = struct<ParabolicParameter>([
  s16("aRight"),
  s16("aLeft"),
  s32(`centerBinId`),
]);

export type SpotParameter = IdlTypes<LbClmm>["SpotParameter"];
export const spotParameter = struct<SpotParameter>([
  u16("weightRight"),
  u16("weightLeft"),
  s32(`centerBinId`),
]);

export interface TInitializePositionAndAddLiquidityParams {
  lbPairPubKey: PublicKey;
  positionPubKey: PublicKey;
  totalXAmount: BN;
  totalYAmount: BN;
  xYAmountDistribution: BinAndAmount[];
  user: PublicKey;
  slippage?: number;
}

export interface TInitializePositionAndAddLiquidityParamsByStrategy {
  lbPairPubKey: PublicKey;
  positionPubKey: PublicKey;
  totalXAmount: BN;
  totalYAmount: BN;
  strategy: StrategyParameters;
  user: PublicKey;
  slippage?: number;
}

export interface BinLiquidity {
  binId: number;
  xAmount: BN;
  yAmount: BN;
  supply: BN;
  version: number;
  price: string;
  pricePerToken: string;
}

export interface SwapQuote {
  consumedInAmount: BN;
  outAmount: BN;
  fee: BN;
  protocolFee: BN;
  minOutAmount: BN;
  priceImpact: Decimal;
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

export interface GetOrCreateATAResponse {
  ataPubKey: PublicKey;
  ix?: TransactionInstruction;
}

export enum BitmapType {
  U1024,
  U512,
}
