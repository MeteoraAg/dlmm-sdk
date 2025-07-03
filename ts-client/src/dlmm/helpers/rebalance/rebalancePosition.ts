import { Program } from "@coral-xyz/anchor";
import { Connection, PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { decodeAccount, deriveBinArray } from "..";
import { DLMM } from "../..";
import {
  BASIS_POINT_MAX,
  DEFAULT_BIN_PER_POSITION,
  FEE_PRECISION,
  SCALE_OFFSET,
} from "../../constants";
import { LbClmm } from "../../idl";
import {
  Bin,
  Clock,
  ClockLayout,
  LbPair,
  POSITION_BIN_DATA_SIZE,
  PositionData,
  RebalanceAddLiquidityParam,
  RebalanceRemoveLiquidityParam,
  sParameters,
  vParameters,
} from "../../types";
import {
  binIdToBinArrayIndex,
  deriveBinArrayBitmapExtension,
  getBinArrayLowerUpperBinId,
  getBinIdIndexInBinArray,
  isOverflowDefaultBinArrayBitmap,
} from "../binArray";
import { getTotalFee } from "../fee";
import { getQPriceBaseFactor, getQPriceFromId } from "../math";
import { pow } from "../u64xu64_math";
import { getPriceOfBinByBinId } from "../weight";

export function buildBitFlagAndNegateStrategyParameters(
  x0: BN,
  y0: BN,
  deltaX: BN,
  deltaY: BN
): {
  bitFlag: number;
  x0: BN;
  y0: BN;
  deltaX: BN;
  deltaY: BN;
} {
  let bitFlag = 0;

  if (x0.isNeg()) {
    bitFlag |= 0b1;
    x0 = x0.neg();
  }

  if (y0.isNeg()) {
    bitFlag |= 0b10;
    y0 = y0.neg();
  }

  if (deltaX.isNeg()) {
    bitFlag |= 0b100;
    deltaX = deltaX.neg();
  }

  if (deltaY.isNeg()) {
    bitFlag |= 0b1000;
    deltaY = deltaY.neg();
  }

  return {
    bitFlag,
    x0,
    y0,
    deltaX,
    deltaY,
  };
}

export interface AmountIntoBin {
  binId: BN;
  amountX: BN;
  amountY: BN;
}

function toRebalancePositionBinData(
  positionData: PositionData
): RebalancePositionBinData[] {
  return positionData.positionBinData.map(
    ({
      binId,
      price,
      pricePerToken,
      positionXAmount,
      positionYAmount,
      positionFeeXAmount,
      positionFeeYAmount,
      positionRewardAmount,
    }) => {
      return {
        binId,
        price,
        pricePerToken: pricePerToken,
        amountX: new BN(positionXAmount),
        amountY: new BN(positionYAmount),
        claimableRewardAmount: positionRewardAmount.map(
          (amount) => new BN(amount)
        ),
        claimableFeeXAmount: new BN(positionFeeXAmount),
        claimableFeeYAmount: new BN(positionFeeYAmount),
      };
    }
  );
}

function getDepositBinIds(activeId: BN, deposits: RebalanceWithDeposit[]) {
  const uniqueBinId = new Set<number>();

  for (const { minDeltaId, maxDeltaId } of deposits) {
    const minBinId = activeId.add(minDeltaId);
    const maxBinId = activeId.add(maxDeltaId);

    for (
      let binId = minBinId.toNumber();
      binId <= maxBinId.toNumber();
      binId++
    ) {
      uniqueBinId.add(binId);
    }
  }

  const binIds = Array.from(uniqueBinId);
  binIds.sort((a, b) => a - b);

  return binIds;
}

function findMinMaxBinIdWithLiquidity(
  rebalancePositionBinData: RebalancePositionBinData[]
) {
  let minBinId = null;
  let maxBinId = null;

  for (const binData of rebalancePositionBinData) {
    if (
      binData.amountX.isZero() &&
      binData.amountY.isZero() &&
      binData.claimableFeeXAmount.isZero() &&
      binData.claimableFeeYAmount.isZero() &&
      binData.claimableRewardAmount.every((amount) => amount.isZero())
    ) {
      continue;
    }

    if (minBinId == null || binData.binId < minBinId) {
      minBinId = binData.binId;
    }

    if (maxBinId == null || binData.binId > maxBinId) {
      maxBinId = binData.binId;
    }
  }

  return [minBinId, maxBinId];
}

function onlyDepositToBidSide(maxDeltaId: BN, favorXInActiveBin: boolean) {
  if (favorXInActiveBin) {
    return maxDeltaId.lt(new BN(0));
  }
  return maxDeltaId.lte(new BN(0));
}

function onlyDepositToAskSide(minDeltaId: BN, favorXInActiveBin: boolean) {
  if (favorXInActiveBin) {
    return minDeltaId.gte(new BN(0));
  }
  return minDeltaId.gt(new BN(0));
}

export function getAmountInBinsBidSide(
  activeId: BN,
  minDeltaId: BN,
  maxDeltaId: BN,
  deltaY: BN,
  y0: BN
) {
  const amountInBins: AmountIntoBin[] = [];

  const minBinId = activeId.add(minDeltaId);
  const maxBinId = activeId.add(maxDeltaId);

  for (let binId = minBinId.toNumber(); binId <= maxBinId.toNumber(); binId++) {
    const deltaBin = activeId.toNumber() - binId;
    const totalDeltaY = deltaY.mul(new BN(deltaBin));
    const amountY = y0.add(totalDeltaY);
    amountInBins.push({
      binId: new BN(binId),
      amountX: new BN(0),
      amountY,
    });
  }

  return amountInBins;
}

export function getAmountInBinsAskSide(
  activeId: BN,
  binStep: BN,
  minDeltaId: BN,
  maxDeltaId: BN,
  deltaX: BN,
  x0: BN
) {
  const binCount = maxDeltaId.sub(minDeltaId).add(new BN(1));

  const minBinId = activeId.add(minDeltaId);
  const maxBinId = activeId.add(maxDeltaId);

  const amountInBins: AmountIntoBin[] = new Array(binCount.toNumber());

  const base = getQPriceBaseFactor(binStep);
  let inverseBasePrice = pow(base, maxBinId.neg());

  for (let binId = maxBinId.toNumber(); binId >= minBinId.toNumber(); binId--) {
    const delta = binId - activeId.toNumber();
    const totalDeltaX = deltaX.mul(new BN(delta));
    const amountX = x0
      .add(totalDeltaX)
      .mul(inverseBasePrice)
      .shrn(SCALE_OFFSET);
    const idx = binId - minBinId.toNumber();
    amountInBins[idx] = {
      binId: new BN(binId),
      amountX,
      amountY: new BN(0),
    };
    inverseBasePrice = inverseBasePrice.mul(base).shrn(SCALE_OFFSET);
  }

  return amountInBins;
}

export function toAmountIntoBins(
  activeId: BN,
  minDeltaId: BN,
  maxDeltaId: BN,
  deltaX: BN,
  deltaY: BN,
  x0: BN,
  y0: BN,
  binStep: BN,
  favorXInActiveBin: boolean
): AmountIntoBin[] {
  if (onlyDepositToBidSide(maxDeltaId, favorXInActiveBin)) {
    return getAmountInBinsBidSide(activeId, minDeltaId, maxDeltaId, deltaY, y0);
  }

  if (onlyDepositToAskSide(minDeltaId, favorXInActiveBin)) {
    return getAmountInBinsAskSide(
      activeId,
      binStep,
      minDeltaId,
      maxDeltaId,
      deltaX,
      x0
    );
  }

  const [bidSideEndDeltaId, askSideStartDeltaId] = favorXInActiveBin
    ? [-1, 0]
    : [0, 1];

  const amountInBinsBidSide = getAmountInBinsBidSide(
    activeId,
    minDeltaId,
    new BN(bidSideEndDeltaId),
    deltaY,
    y0
  );

  const amountInBinsAskSide = getAmountInBinsAskSide(
    activeId,
    binStep,
    new BN(askSideStartDeltaId),
    maxDeltaId,
    deltaX,
    x0
  );

  return amountInBinsBidSide.concat(amountInBinsAskSide);
}

function getLiquidity(x: BN, y: BN, price: BN) {
  const px = price.mul(x);
  const shly = y.shln(SCALE_OFFSET);
  return px.add(shly);
}

function computeCompositionFee(
  binStep: BN,
  sParameters: sParameters,
  vParameters: vParameters,
  outAmountX: BN,
  inAmountX: BN,
  outAmountY: BN,
  inAmountY: BN
) {
  if (outAmountX.gt(inAmountX)) {
    const delta = inAmountY.sub(outAmountY);
    const totalFeeRate = getTotalFee(
      binStep.toNumber(),
      sParameters,
      vParameters
    );
    const feeAmount = delta.mul(totalFeeRate);
    return feeAmount
      .mul(FEE_PRECISION.add(totalFeeRate))
      .div(FEE_PRECISION.pow(new BN(2)));
  }
  return new BN(0);
}

function simulateDepositBin(
  binId: BN,
  binStep: BN,
  amountX: BN,
  amountY: BN,
  bin: Bin
) {
  if (!bin) {
    return {
      amountXIntoBin: amountX,
      amountYIntoBin: amountY,
    };
  }

  const price = getQPriceFromId(binId, binStep);
  const inLiquidity = getLiquidity(amountX, amountY, price);
  const binLiquidity = getLiquidity(bin.amountX, bin.amountY, price);

  if (bin.liquiditySupply.isZero()) {
    return {
      amountXIntoBin: amountX,
      amountYIntoBin: amountY,
    };
  }

  const liquidityShare = inLiquidity.mul(bin.liquiditySupply).div(binLiquidity);
  const updatedBinXAmount = bin.amountX.add(amountX);
  const updatedBinYAmount = bin.amountY.add(amountY);
  const updatedBinSupply = bin.liquiditySupply.add(liquidityShare);

  let amountXIntoBin = liquidityShare.mul(
    updatedBinXAmount.div(updatedBinSupply)
  );
  let amountYIntoBin = liquidityShare.mul(
    updatedBinYAmount.div(updatedBinSupply)
  );

  if (amountXIntoBin.gt(amountX)) {
  }

  return {
    amountXIntoBin,
    amountYIntoBin,
  };
}

interface SimulateWithdrawResult {
  liquidityAndFeeXWithdrawn: BN;
  liquidityAndFeeYWithdrawn: BN;
  rewardsAmountClaimed: BN[];
}

interface SimulateDepositResult {
  totalAmountXDeposited: BN;
  totalAmountYDeposited: BN;
  actualTotalAmountXDeposited: BN;
  actualTotalAmountYDeposited: BN;
  actualLiquidityAndFeeXWithdrawn: BN;
  actualLiquidityAndFeeYWithdrawn: BN;
}

export interface CreateRebalancePositionParams {
  program: Program<LbClmm>;
  pairAddress: PublicKey;
  positionAddress: PublicKey;
  positionData: PositionData;
  shouldClaimFee: boolean;
  shouldClaimReward: boolean;
}

export class RebalancePosition {
  public address: PublicKey;
  public lowerBinId: BN;
  public upperBinId: BN;
  public lbPair: LbPair;
  public owner: PublicKey;
  public shouldClaimFee: boolean;
  public shouldClaimReward: boolean;
  public rebalancePositionBinData: RebalancePositionBinData[];
  public activeBin: Bin;
  public currentTimestamp: BN;

  constructor(
    positionAddress: PublicKey,
    positionData: PositionData,
    lbPair: LbPair,
    activeBin: Bin,
    shouldClaimFee: boolean,
    shouldClaimReward: boolean,
    currentTimestamp: BN
  ) {
    this.address = positionAddress;
    this.rebalancePositionBinData = toRebalancePositionBinData(positionData);
    this.lowerBinId = new BN(positionData.lowerBinId);
    this.upperBinId = new BN(positionData.upperBinId);
    this.lbPair = lbPair;
    this.shouldClaimFee = shouldClaimFee;
    this.shouldClaimReward = shouldClaimReward;
    this.owner = positionData.owner;
    this.activeBin = activeBin;
    this.currentTimestamp = currentTimestamp;
  }

  static async create(
    params: CreateRebalancePositionParams
  ): Promise<RebalancePosition> {
    const {
      program,
      positionAddress,
      pairAddress,
      positionData,
      shouldClaimFee,
      shouldClaimReward,
    } = params;
    const [lbPairAccount, clockAccount] =
      await program.provider.connection.getMultipleAccountsInfo([
        pairAddress,
        SYSVAR_CLOCK_PUBKEY,
      ]);

    const lbPair = decodeAccount<LbPair>(program, "lbPair", lbPairAccount.data);
    const clock = ClockLayout.decode(clockAccount.data) as Clock;

    const activeBinArrayIdx = binIdToBinArrayIndex(new BN(lbPair.activeId));
    const [activeBinArrayPubkey] = deriveBinArray(
      pairAddress,
      activeBinArrayIdx,
      program.programId
    );
    const activeBinArrayState = await program.account.binArray.fetch(
      activeBinArrayPubkey
    );
    const [lowerBinId, upperBinId] =
      getBinArrayLowerUpperBinId(activeBinArrayIdx);
    const idx = getBinIdIndexInBinArray(
      new BN(lbPair.activeId),
      lowerBinId,
      upperBinId
    );
    const activeBin = activeBinArrayState[idx.toNumber()];

    return new RebalancePosition(
      positionAddress,
      positionData,
      lbPair,
      activeBin,
      shouldClaimFee,
      shouldClaimReward,
      clock.unixTimestamp
    );
  }

  _simulateDeposit(
    binStep: BN,
    tokenXDecimal: BN,
    tokenYDecimal: BN,
    deposits: RebalanceWithDeposit[],
    simulatedWithdrawResult: SimulateWithdrawResult
  ): {
    result: SimulateDepositResult;
    depositParams: RebalanceAddLiquidityParam[];
  } {
    const { liquidityAndFeeXWithdrawn, liquidityAndFeeYWithdrawn } =
      simulatedWithdrawResult;

    const activeId = new BN(this.lbPair.activeId);
    const depositBinIds = getDepositBinIds(activeId, deposits);

    if (depositBinIds.length > 0) {
      const depositMinBinId = depositBinIds[0];
      const depositMaxBinId = depositBinIds[depositBinIds.length - 1];

      this._simulateResize(
        new BN(depositMinBinId),
        new BN(depositMaxBinId),
        binStep,
        tokenXDecimal,
        tokenYDecimal
      );
    }

    let totalAmountXDeposited = new BN(0);
    let totalAmountYDeposited = new BN(0);

    const addLiquidityParam: RebalanceAddLiquidityParam[] = [];

    for (const {
      x0,
      y0,
      favorXInActiveBin,
      deltaX,
      deltaY,
      minDeltaId,
      maxDeltaId,
    } of deposits) {
      const params = buildBitFlagAndNegateStrategyParameters(
        x0,
        y0,
        deltaX,
        deltaY
      );

      addLiquidityParam.push({
        minDeltaId: minDeltaId.toNumber(),
        maxDeltaId: maxDeltaId.toNumber(),
        x0: params.x0,
        y0: params.y0,
        deltaX: params.deltaX,
        deltaY: params.deltaY,
        bitFlag: params.bitFlag,
        padding: Array(16).fill(0),
        favorXInActiveId: favorXInActiveBin,
      });

      const amountIntoBins = toAmountIntoBins(
        activeId,
        minDeltaId,
        maxDeltaId,
        deltaX,
        deltaY,
        x0,
        y0,
        binStep,
        favorXInActiveBin
      );

      for (const { binId, amountX, amountY } of amountIntoBins) {
        totalAmountXDeposited = totalAmountXDeposited.add(amountX);
        totalAmountYDeposited = totalAmountYDeposited.add(amountY);

        const idx = this.rebalancePositionBinData.findIndex(
          (data) => data.binId == binId.toNumber()
        );

        if (binId.eq(activeId)) {
          const vParameters = Object.assign({}, this.lbPair.vParameters);
          const sParameters = Object.assign({}, this.lbPair.parameters);
          DLMM.updateReference(
            activeId.toNumber(),
            vParameters,
            sParameters,
            this.currentTimestamp.toNumber()
          );
          DLMM.updateVolatilityAccumulator(
            vParameters,
            sParameters,
            activeId.toNumber()
          );
          const { amountXIntoBin, amountYIntoBin } = simulateDepositBin(
            binId,
            binStep,
            amountX,
            amountY,
            this.activeBin
          );
          const feeY = computeCompositionFee(
            binStep,
            sParameters,
            vParameters,
            amountXIntoBin,
            amountX,
            amountYIntoBin,
            amountY
          );
          const feeX = computeCompositionFee(
            binStep,
            sParameters,
            vParameters,
            amountYIntoBin,
            amountY,
            amountXIntoBin,
            amountX
          );
          const amountXIntoBinExcludeFee = amountXIntoBin.sub(feeX);
          const amountYIntoBinExcludeFee = amountYIntoBin.sub(feeY);
          this.rebalancePositionBinData[idx].amountX =
            this.rebalancePositionBinData[idx].amountX.add(
              amountXIntoBinExcludeFee
            );
          this.rebalancePositionBinData[idx].amountY =
            this.rebalancePositionBinData[idx].amountY.add(
              amountYIntoBinExcludeFee
            );
        } else {
          this.rebalancePositionBinData[idx].amountX =
            this.rebalancePositionBinData[idx].amountX.add(amountX);
          this.rebalancePositionBinData[idx].amountY =
            this.rebalancePositionBinData[idx].amountY.add(amountY);
        }
      }
    }

    let actualTotalAmountXDeposited = totalAmountXDeposited;
    let actualTotalAmountYDeposited = totalAmountYDeposited;
    let actualLiquidityAndFeeXWithdrawn = liquidityAndFeeXWithdrawn;
    let actualLiquidityAndFeeYWithdrawn = liquidityAndFeeYWithdrawn;

    if (actualTotalAmountXDeposited.gt(actualLiquidityAndFeeXWithdrawn)) {
      actualTotalAmountXDeposited = actualTotalAmountXDeposited.sub(
        actualLiquidityAndFeeXWithdrawn
      );
      actualLiquidityAndFeeXWithdrawn = new BN(0);
    } else {
      actualLiquidityAndFeeXWithdrawn = actualLiquidityAndFeeXWithdrawn.sub(
        actualTotalAmountXDeposited
      );
      actualTotalAmountXDeposited = new BN(0);
    }

    if (actualTotalAmountYDeposited.gt(actualLiquidityAndFeeYWithdrawn)) {
      actualTotalAmountYDeposited = actualTotalAmountYDeposited.sub(
        actualLiquidityAndFeeYWithdrawn
      );
      actualLiquidityAndFeeYWithdrawn = new BN(0);
    } else {
      actualLiquidityAndFeeYWithdrawn = actualLiquidityAndFeeYWithdrawn.sub(
        actualTotalAmountYDeposited
      );
      actualTotalAmountYDeposited = new BN(0);
    }

    return {
      result: {
        totalAmountXDeposited,
        totalAmountYDeposited,
        actualLiquidityAndFeeXWithdrawn,
        actualLiquidityAndFeeYWithdrawn,
        actualTotalAmountXDeposited,
        actualTotalAmountYDeposited,
      },
      depositParams: addLiquidityParam,
    };
  }

  _simulateResize(
    depositMinBinId: BN,
    depositMaxBinId: BN,
    binStep: BN,
    tokenXDecimal: BN,
    tokenYDecimal: BN
  ) {
    const tokenXMultiplier = new Decimal(10 ** tokenXDecimal.toNumber());
    const tokenYMultiplier = new Decimal(10 ** tokenYDecimal.toNumber());

    const [minBinId, maxBinId] = findMinMaxBinIdWithLiquidity(
      this.rebalancePositionBinData
    );

    const newMinBinId = new BN(
      Math.min(depositMinBinId.toNumber(), minBinId ?? Number.MAX_SAFE_INTEGER)
    );
    const newMaxBinId = new BN(
      Math.max(depositMaxBinId.toNumber(), maxBinId ?? Number.MIN_SAFE_INTEGER)
    );

    if (newMinBinId.lt(this.lowerBinId)) {
      const binCountToExpand = this.lowerBinId.sub(depositMinBinId);
      for (let i = 1; i <= binCountToExpand.toNumber(); i++) {
        const binId = this.lowerBinId.subn(i);
        const price = getPriceOfBinByBinId(
          binId.toNumber(),
          binStep.toNumber()
        );
        const adjustedPrice = price.mul(tokenXMultiplier).div(tokenYMultiplier);

        this.rebalancePositionBinData.unshift({
          binId: binId.toNumber(),
          price: adjustedPrice.toString(),
          pricePerToken: adjustedPrice.toString(),
          amountX: new BN(0),
          amountY: new BN(0),
          claimableRewardAmount: [new BN(0), new BN(0)],
          claimableFeeXAmount: new BN(0),
          claimableFeeYAmount: new BN(0),
        });
      }
    } else {
      const binCountToShrink = newMinBinId.sub(this.lowerBinId);
      for (let i = 1; i <= binCountToShrink.toNumber(); i++) {
        this.rebalancePositionBinData.shift();
      }
    }

    if (newMaxBinId.gt(this.upperBinId)) {
      const binCountToExpand = newMaxBinId.sub(this.upperBinId);
      for (let i = 1; i <= binCountToExpand.toNumber(); i++) {
        const binId = this.upperBinId.addn(i);
        const price = getPriceOfBinByBinId(
          binId.toNumber(),
          binStep.toNumber()
        );
        const adjustedPrice = price.mul(tokenXMultiplier).div(tokenYMultiplier);

        this.rebalancePositionBinData.push({
          binId: binId.toNumber(),
          price: adjustedPrice.toString(),
          pricePerToken: adjustedPrice.toString(),
          amountX: new BN(0),
          amountY: new BN(0),
          claimableRewardAmount: [new BN(0), new BN(0)],
          claimableFeeXAmount: new BN(0),
          claimableFeeYAmount: new BN(0),
        });
      }
    } else {
      const binCountToShrink = this.upperBinId.sub(newMaxBinId);
      for (let i = 1; i <= binCountToShrink.toNumber(); i++) {
        this.rebalancePositionBinData.pop();
      }
    }

    this.lowerBinId = newMinBinId;
    this.upperBinId = newMaxBinId;
  }

  _simulateWithdraw(withdraws: RebalanceWithWithdraw[]): {
    result: SimulateWithdrawResult;
    withdrawParams: RebalanceRemoveLiquidityParam[];
  } {
    let liquidityAndFeeXWithdrawn = new BN(0);
    let liquidityAndFeeYWithdrawn = new BN(0);
    let rewardsAmountClaimed = [new BN(0), new BN(0)];

    const activeId = new BN(this.lbPair.activeId);

    for (const { minBinId, maxBinId, bps } of withdraws) {
      const fromBinId = minBinId ?? activeId;
      const toBinId = maxBinId ?? activeId;

      const binIds = binRangeToBinIdArray(fromBinId, toBinId).filter(
        (binId) => binId.gte(this.lowerBinId) && binId.lte(this.upperBinId)
      );

      for (const binId of binIds) {
        const idx = this.rebalancePositionBinData.findIndex(
          (b) => b.binId === binId.toNumber()
        );

        const binData = this.rebalancePositionBinData[idx];

        // 1. Withdraw
        const amountXWithdrawn = binData.amountX.mul(bps).divn(BASIS_POINT_MAX);
        const amountYWithdrawn = binData.amountY.mul(bps).divn(BASIS_POINT_MAX);

        liquidityAndFeeXWithdrawn =
          liquidityAndFeeXWithdrawn.add(amountXWithdrawn);
        liquidityAndFeeYWithdrawn =
          liquidityAndFeeYWithdrawn.add(amountYWithdrawn);

        binData.amountX = binData.amountX.sub(amountXWithdrawn);
        binData.amountY = binData.amountY.sub(amountYWithdrawn);

        // 2. Claim fee
        if (this.shouldClaimFee) {
          liquidityAndFeeXWithdrawn = liquidityAndFeeXWithdrawn.add(
            binData.claimableFeeXAmount
          );
          liquidityAndFeeYWithdrawn = liquidityAndFeeYWithdrawn.add(
            binData.claimableFeeYAmount
          );

          binData.claimableFeeXAmount = new BN(0);
          binData.claimableFeeYAmount = new BN(0);
        }

        // 3. Claim reward
        if (this.shouldClaimReward) {
          for (const [idx, amount] of binData.claimableRewardAmount.entries()) {
            rewardsAmountClaimed[idx] = rewardsAmountClaimed[idx].add(amount);
            binData.claimableRewardAmount[idx] = new BN(0);
          }
        }

        // Update state
        this.rebalancePositionBinData[idx] = binData;
      }
    }

    const withdrawParams: RebalanceRemoveLiquidityParam[] = withdraws.map(
      ({ minBinId, maxBinId, bps }) => {
        return {
          minBinId: minBinId ? minBinId.toNumber() : null,
          maxBinId: maxBinId ? maxBinId.toNumber() : null,
          bps: bps.toNumber(),
          padding: Array(16).fill(0),
        };
      }
    );

    return {
      result: {
        liquidityAndFeeXWithdrawn,
        liquidityAndFeeYWithdrawn,
        rewardsAmountClaimed,
      },
      withdrawParams,
    };
  }

  async simulateRebalance(
    connection: Connection,
    binStep: BN,
    tokenXDecimal: BN,
    tokenYDecimal: BN,
    withdraws: RebalanceWithWithdraw[],
    deposits: RebalanceWithDeposit[]
  ): Promise<SimulateRebalanceResp> {
    if (withdraws.length == 0 && deposits.length == 0) {
      throw "No rebalance action";
    }

    const activeId = new BN(this.lbPair.activeId);

    withdraws = validateAndSortRebalanceWithdraw(withdraws, activeId);
    deposits = validateAndSortRebalanceDeposit(deposits);

    const beforeWidth = getPositionWidthWithMinWidth(
      this.lowerBinId.toNumber(),
      this.upperBinId.toNumber()
    );

    const { withdrawParams, result: withdrawResult } =
      this._simulateWithdraw(withdraws);

    const { depositParams, result: depositResult } = this._simulateDeposit(
      binStep,
      tokenXDecimal,
      tokenYDecimal,
      deposits,
      withdrawResult
    );

    const afterWidth = getPositionWidthWithMinWidth(
      this.lowerBinId.toNumber(),
      this.upperBinId.toNumber()
    );

    const widthDelta = afterWidth - beforeWidth;

    let rentalCostLamports = new BN(0);

    if (widthDelta != 0) {
      const sizeChanges = Math.abs(widthDelta) * POSITION_BIN_DATA_SIZE;
      const [minimumLamports, rentExemptionLamports] = await Promise.all([
        connection.getMinimumBalanceForRentExemption(0),
        connection.getMinimumBalanceForRentExemption(sizeChanges),
      ]);

      const lamportChanges = new BN(rentExemptionLamports).sub(
        new BN(minimumLamports)
      );

      if (widthDelta > 0) {
        rentalCostLamports = rentalCostLamports.add(lamportChanges);
      } else {
        rentalCostLamports = rentalCostLamports.sub(lamportChanges);
      }
    }

    return {
      amountXDeposited: depositResult.totalAmountXDeposited,
      amountYDeposited: depositResult.totalAmountYDeposited,
      actualAmountXDeposited: depositResult.actualTotalAmountXDeposited,
      actualAmountYDeposited: depositResult.actualTotalAmountYDeposited,
      actualAmountXWithdrawn: depositResult.actualLiquidityAndFeeXWithdrawn,
      actualAmountYWithdrawn: depositResult.actualLiquidityAndFeeYWithdrawn,
      rewardAmountsClaimed: withdrawResult.rewardsAmountClaimed,
      withdrawParams,
      depositParams,
      rentalCostLamports,
    };
  }

  totalAmounts(): BN[] {
    let totalAmountX = new BN(0);
    let totalAmountY = new BN(0);

    for (const binData of this.rebalancePositionBinData) {
      totalAmountX = totalAmountX.add(binData.amountX);
      totalAmountY = totalAmountY.add(binData.amountY);
    }

    return [totalAmountX, totalAmountY];
  }

  totalFeeAmounts(): BN[] {
    let totalFeeXAmount = new BN(0);
    let totalFeeYAmount = new BN(0);

    for (const binData of this.rebalancePositionBinData) {
      totalFeeXAmount = totalFeeXAmount.add(binData.claimableFeeXAmount);
      totalFeeYAmount = totalFeeYAmount.add(binData.claimableFeeYAmount);
    }

    return [totalFeeXAmount, totalFeeYAmount];
  }

  totalRewardAmounts(): BN[] {
    let totalRewardAmounts = [new BN(0), new BN(0)];

    for (const binData of this.rebalancePositionBinData) {
      totalRewardAmounts[0] = totalRewardAmounts[0].add(
        binData.claimableRewardAmount[0]
      );
      totalRewardAmounts[1] = totalRewardAmounts[1].add(
        binData.claimableRewardAmount[1]
      );
    }

    return totalRewardAmounts;
  }
}

function getPositionWidthWithMinWidth(lowerBinId: number, upperBinId: number) {
  const width = upperBinId - lowerBinId + 1;
  return Math.max(width, DEFAULT_BIN_PER_POSITION.toNumber());
}

function validateAndSortRebalanceDeposit(deposits: RebalanceWithDeposit[]) {
  const sortedDeposits = deposits.sort((a, b) =>
    a.minDeltaId.sub(b.minDeltaId).toNumber()
  );

  for (const deposit of deposits) {
    if (deposit.minDeltaId.gte(deposit.maxDeltaId)) {
      throw "Invalid minDeltaId or maxDeltaId";
    }
  }

  for (let i = 1; i < sortedDeposits.length; i++) {
    const prevDeposit = sortedDeposits[i - 1];
    const currDeposit = sortedDeposits[i];

    if (prevDeposit.maxDeltaId.gte(currDeposit.minDeltaId)) {
      throw "Overlap deposit bin range";
    }
  }

  return sortedDeposits;
}

function validateAndSortRebalanceWithdraw(
  withdraws: RebalanceWithWithdraw[],
  activeId: BN
) {
  const filledWithdraws: RebalanceWithWithdraw[] = [];

  for (const { minBinId, maxBinId, bps } of withdraws) {
    if (bps.toNumber() < 0 || bps.toNumber() > BASIS_POINT_MAX) {
      throw "Invalid bps";
    }

    const filledMinBinId = minBinId ?? activeId;
    const filledMaxBinId = maxBinId ?? activeId;

    if (filledMinBinId.gt(filledMaxBinId)) {
      throw "Invalid minBinId or maxBinId";
    }

    filledWithdraws.push({
      minBinId: filledMinBinId,
      maxBinId: filledMaxBinId,
      bps,
    });
  }

  filledWithdraws.sort((a, b) => {
    return a.minBinId.sub(b.minBinId).toNumber();
  });

  for (let i = 1; i < filledWithdraws.length; i++) {
    const prev = filledWithdraws[i - 1];
    const curr = filledWithdraws[i];
    if (curr.minBinId.lte(prev.maxBinId)) {
      throw "Overlap withdraw bin range";
    }
  }

  return filledWithdraws;
}

interface RebalancePositionBinData {
  /// Bin ID
  binId: number;
  /// Price of the bin
  price: string;
  /// Price per token of the bin
  pricePerToken: string;
  /// Amount X in the bin
  amountX: BN;
  /// Amount Y in the bin
  amountY: BN;
  /// Claimable reward amount in the bin
  claimableRewardAmount: BN[];
  /// Claimable fee X amount in the bin
  claimableFeeXAmount: BN;
  /// Claimable fee Y amount in the bin
  claimableFeeYAmount: BN;
}

export interface RebalanceWithDeposit {
  /// minBinId = activeId + minDeltaId
  minDeltaId: BN;
  /// maxBinId = activeId + maxDeltaId
  maxDeltaId: BN;
  /// X0
  x0: BN;
  /// Y0
  y0: BN;
  /// Delta X
  deltaX: BN;
  /// Delta Y
  deltaY: BN;
  /// Deposit token X or Y in active bin
  favorXInActiveBin: boolean;
}

export interface RebalanceWithWithdraw {
  /// Withdraw start from minBinId. When it's `null`, it will start from activeId.
  minBinId: BN | null;
  /// Withdraw end at maxBinId. When it's `null`, it will end at activeId.
  maxBinId: BN | null;
  /// BPS of liquidity to be withdrawn from minBinId to maxBinId
  bps: BN;
}

export interface SimulateRebalanceResp {
  amountXDeposited: BN;
  amountYDeposited: BN;
  actualAmountXDeposited: BN;
  actualAmountYDeposited: BN;
  actualAmountXWithdrawn: BN;
  actualAmountYWithdrawn: BN;
  rewardAmountsClaimed: BN[];
  depositParams: RebalanceAddLiquidityParam[];
  withdrawParams: RebalanceRemoveLiquidityParam[];
  rentalCostLamports: BN;
}

function binRangeToBinIdArray(minBinId: BN, maxBinId: BN): BN[] {
  const binIdArray = [];

  const fromBinId = minBinId.toNumber();
  const toBinId = maxBinId.toNumber();

  for (let binId = fromBinId; binId <= toBinId; binId++) {
    binIdArray.push(new BN(binId));
  }

  return binIdArray;
}

export function getRebalanceBinArrayIndexesAndBitmapCoverage(
  adds: RebalanceAddLiquidityParam[],
  removes: RebalanceRemoveLiquidityParam[],
  activeId: number,
  pairAddress: PublicKey,
  programId: PublicKey
): {
  binArrayIndexes: BN[];
  binArrayBitmap: PublicKey;
} {
  let indexMap: Map<number, boolean> = new Map();
  removes.forEach((value) => {
    let minBinId = value.minBinId;
    if (minBinId == null) {
      minBinId = activeId;
    }
    let maxBinId = value.maxBinId;
    if (maxBinId == null) {
      maxBinId = activeId;
    }
    let binArrayIndex = binIdToBinArrayIndex(new BN(minBinId));
    const upperBinId = new BN(maxBinId);
    while (true) {
      indexMap.set(binArrayIndex.toNumber(), true);
      const [binArrayLowerBinId, binArrayUpperBinId] =
        getBinArrayLowerUpperBinId(binArrayIndex);

      if (
        upperBinId.gte(binArrayLowerBinId) &&
        upperBinId.lte(binArrayUpperBinId)
      ) {
        break;
      } else {
        binArrayIndex = binArrayIndex.add(new BN(1));
      }
    }
  });

  adds.forEach((value) => {
    const minBinId = activeId + value.minDeltaId;
    const maxBinId = activeId + value.maxDeltaId;
    let binArrayIndex = binIdToBinArrayIndex(new BN(minBinId));
    const upperBinId = new BN(maxBinId);
    while (true) {
      indexMap.set(binArrayIndex.toNumber(), true);
      const [binArrayLowerBinId, binArrayUpperBinId] =
        getBinArrayLowerUpperBinId(binArrayIndex);

      if (
        upperBinId.gte(binArrayLowerBinId) &&
        upperBinId.lte(binArrayUpperBinId)
      ) {
        break;
      } else {
        binArrayIndex = binArrayIndex.add(new BN(1));
      }
    }
  });
  const binArrayIndexes = Array.from(indexMap.keys()).map((idx) => new BN(idx));

  const requireBitmapExtension = binArrayIndexes.some((index) =>
    isOverflowDefaultBinArrayBitmap(new BN(index))
  );

  return {
    binArrayIndexes,
    binArrayBitmap: requireBitmapExtension
      ? deriveBinArrayBitmapExtension(pairAddress, programId)[0]
      : programId,
  };
}
