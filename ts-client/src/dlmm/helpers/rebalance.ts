import BN, { max } from "bn.js";
import {
  POSITION_BIN_DATA_SIZE,
  PositionData,
  RebalanceAddLiquidityParam,
  RebalanceRemoveLiquidityParam,
  StrategyType,
  toStrategyParamType,
} from "../types";
import { AccountMeta, Connection, PublicKey } from "@solana/web3.js";
import {
  BASIS_POINT_MAX,
  DEFAULT_BIN_PER_POSITION,
  SCALE_OFFSET,
} from "../constants";
import { getPriceOfBinByBinId } from "./weight";
import Decimal from "decimal.js";
import { getQPriceBaseFactor, getQPriceFromId } from "./math";
import { ONE } from "./u64xu64_math";
import {
  binIdToBinArrayIndex,
  deriveBinArrayBitmapExtension,
  getBinArrayLowerUpperBinId,
  isOverflowDefaultBinArrayBitmap,
} from "./binArray";
import { deriveBinArray } from "./derive";

interface AmountIntoBin {
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

function findX0OneLoop(
  amountX: BN,
  minDeltaId: BN,
  maxDeltaId: BN,
  binStep: BN,
  isCurve: boolean
) {
  let totalWeight = new BN(0);
  const precision = new BN(100_000_000);

  const binCount = maxDeltaId.sub(minDeltaId).addn(1);

  let base = getQPriceBaseFactor(binStep);
  let basePrice = ONE;

  for (
    let binId = minDeltaId.toNumber();
    binId <= maxDeltaId.toNumber();
    binId++
  ) {
    const binDelta = isCurve
      ? new BN(binId).sub(minDeltaId)
      : maxDeltaId.subn(binId);
    const weight = precision.sub(precision.mul(binDelta).div(binCount));
    const weightDelta = weight.mul(basePrice);
    totalWeight = totalWeight.add(weightDelta);

    basePrice = basePrice.mul(base).shrn(SCALE_OFFSET);
  }

  const x0 = amountX.shln(SCALE_OFFSET).mul(precision).div(totalWeight);
  return x0;
}

function findY0OneLoop(amountY: BN, minDeltaId: BN, maxDeltaId: BN) {
  let totalWeight = new BN(0);
  const precision = new BN(100_000_000);

  const binCount = maxDeltaId.sub(minDeltaId).addn(1);

  for (
    let deltaId = minDeltaId.toNumber();
    deltaId <= maxDeltaId.toNumber();
    deltaId++
  ) {
    const binDelta = maxDeltaId.subn(deltaId);
    const delta = precision.sub(precision.mul(binDelta).div(binCount));
    totalWeight = totalWeight.add(delta);
  }

  const y0 = amountY.mul(precision).div(totalWeight);
  return y0;
}

function findY0(
  amountY: BN,
  minDeltaId: BN,
  maxDeltaId: BN,
  strategy: StrategyType,
  activeId: BN
): BN {
  const binCount = maxDeltaId.sub(minDeltaId).addn(1);
  switch (strategy) {
    case StrategyType.Spot:
      return amountY.div(binCount);
    case StrategyType.Curve:
    case StrategyType.BidAsk:
      let y0 = findY0OneLoop(amountY, minDeltaId, maxDeltaId);
      while (true) {
        const amountIntoBins = getAmountIntoBinBidSide(
          activeId,
          minDeltaId,
          maxDeltaId,
          y0,
          strategy
        );

        const amountYReference = amountIntoBins.reduce(
          (total, { amountY }) => total.add(amountY),
          new BN(0)
        );

        if (amountYReference.gt(amountY)) {
          y0 = y0.subn(1);
        } else {
          break;
        }
      }

      return y0;
  }
}

function findX0(
  amountX: BN,
  minDeltaId: BN,
  maxDeltaId: BN,
  binStep: BN,
  strategy: StrategyType,
  activeId: BN
) {
  const binCount = maxDeltaId.sub(minDeltaId).addn(1);
  switch (strategy) {
    case StrategyType.Spot:
      let totalWeight = new BN(0);

      for (let i = 0; i < binCount.toNumber(); i++) {
        const basePrice = getQPriceFromId(new BN(i), binStep);
        totalWeight = totalWeight.add(basePrice);
      }

      return amountX.shln(SCALE_OFFSET).div(totalWeight);
    case StrategyType.Curve:
    case StrategyType.BidAsk:
      let x0 = findX0OneLoop(
        amountX,
        minDeltaId,
        maxDeltaId,
        binStep,
        strategy == StrategyType.Curve
      );

      while (true) {
        const amountIntoBins = getAmountIntoBinAskSide(
          activeId,
          binStep,
          minDeltaId,
          maxDeltaId,
          x0,
          strategy
        );

        const amountXReference = amountIntoBins.reduce(
          (total, { amountX }) => total.add(amountX),
          new BN(0)
        );

        if (amountXReference.gt(amountX)) {
          x0 = x0.subn(1);
        } else {
          break;
        }
      }

      return x0;
  }
}

function getAmountIntoBinBidSide(
  activeId: BN,
  minDeltaId: BN,
  maxDeltaId: BN,
  y0: BN,
  strategy: StrategyType
): AmountIntoBin[] {
  const amountIntoBin: AmountIntoBin[] = [];

  switch (strategy) {
    case StrategyType.Spot:
      for (
        let binDeltaId = minDeltaId.toNumber();
        binDeltaId <= maxDeltaId.toNumber();
        binDeltaId++
      ) {
        const binId = activeId.addn(binDeltaId);
        amountIntoBin.push({ binId, amountX: new BN(0), amountY: y0 });
      }
      break;
    case StrategyType.Curve:
    case StrategyType.BidAsk:
      const binCount = maxDeltaId.sub(minDeltaId).addn(1);
      const deltaY = y0.div(binCount);
      for (
        let binDeltaId = minDeltaId.toNumber();
        binDeltaId <= maxDeltaId.toNumber();
        binDeltaId++
      ) {
        const binDelta =
          strategy == StrategyType.Curve
            ? maxDeltaId.subn(binDeltaId)
            : new BN(binDeltaId).sub(minDeltaId);

        const delta = deltaY.mul(binDelta);
        const binId = activeId.addn(binDeltaId);
        amountIntoBin.push({
          binId,
          amountX: new BN(0),
          amountY: y0.sub(delta),
        });
      }
      break;
  }

  return amountIntoBin;
}

function getAmountIntoBinAskSide(
  activeId: BN,
  binStep: BN,
  minDeltaId: BN,
  maxDeltaId: BN,
  x0: BN,
  strategy: StrategyType
): AmountIntoBin[] {
  let base = getQPriceBaseFactor(binStep);
  let basePrice = ONE;

  const amountIntoBin: AmountIntoBin[] = [];

  switch (strategy) {
    case StrategyType.Spot:
      for (
        let deltaId = maxDeltaId.toNumber();
        deltaId >= minDeltaId.toNumber();
        deltaId--
      ) {
        const amountX = basePrice.mul(x0).shrn(SCALE_OFFSET);
        amountIntoBin.unshift({
          binId: activeId.addn(deltaId),
          amountX,
          amountY: new BN(0),
        });

        basePrice = basePrice.mul(base).shrn(SCALE_OFFSET);
      }
      break;
    case StrategyType.BidAsk:
    case StrategyType.Curve:
      const binCount = maxDeltaId.sub(minDeltaId).addn(1);
      const deltaX = x0.div(binCount);

      for (
        let deltaBinId = maxDeltaId.toNumber();
        deltaBinId >= minDeltaId.toNumber();
        deltaBinId--
      ) {
        const binDelta =
          strategy == StrategyType.Curve
            ? new BN(deltaBinId).sub(minDeltaId)
            : maxDeltaId.subn(deltaBinId);

        const delta = deltaX.mul(binDelta);
        const amountX = x0.sub(delta).mul(basePrice).shrn(SCALE_OFFSET);

        amountIntoBin.unshift({
          binId: activeId.addn(deltaBinId),
          amountX,
          amountY: new BN(0),
        });

        basePrice = basePrice.mul(base).shrn(SCALE_OFFSET);
      }
      break;
  }

  return amountIntoBin;
}

function toAmountIntoBin(
  activeId: BN,
  binStep: BN,
  minDeltaId: BN,
  maxDeltaId: BN,
  strategyX: StrategyType,
  strategyY: StrategyType,
  amountX: BN,
  amountY: BN,
  favorXInActiveBin: boolean
): {
  x0: BN;
  y0: BN;
  amountIntoBins: AmountIntoBin[];
} {
  if (maxDeltaId.toNumber() < 0) {
    const y0 = findY0(amountY, minDeltaId, maxDeltaId, strategyY, activeId);
    const amountIntoBins = getAmountIntoBinBidSide(
      activeId,
      minDeltaId,
      maxDeltaId,
      y0,
      strategyY
    );

    return {
      x0: new BN(0),
      y0,
      amountIntoBins,
    };
  }

  if (minDeltaId.toNumber() > 0) {
    const x0 = findX0(
      amountX,
      minDeltaId,
      maxDeltaId,
      binStep,
      strategyX,
      activeId
    );

    const amountIntoBins = getAmountIntoBinAskSide(
      activeId,
      binStep,
      minDeltaId,
      maxDeltaId,
      x0,
      strategyX
    );

    return {
      x0,
      y0: new BN(0),
      amountIntoBins,
    };
  }

  const [bidSideEndDeltaId, askSideStartDeltaId] = favorXInActiveBin
    ? [-1, 0]
    : [0, 1];

  const y0 = findY0(
    amountY,
    minDeltaId,
    new BN(bidSideEndDeltaId),
    strategyY,
    activeId
  );

  const x0 = findX0(
    amountX,
    new BN(askSideStartDeltaId),
    maxDeltaId,
    binStep,
    strategyX,
    activeId
  );

  const amountIntoBinsBidSide = minDeltaId.lte(new BN(bidSideEndDeltaId))
    ? getAmountIntoBinBidSide(
        activeId,
        minDeltaId,
        new BN(bidSideEndDeltaId),
        y0,
        strategyY
      )
    : [];

  const amountIntoBinsAskSide = maxDeltaId.gte(new BN(askSideStartDeltaId))
    ? getAmountIntoBinAskSide(
        activeId,
        binStep,
        new BN(askSideStartDeltaId),
        maxDeltaId,
        x0,
        strategyX
      )
    : [];

  return {
    x0,
    y0,
    amountIntoBins: amountIntoBinsBidSide.concat(amountIntoBinsAskSide),
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

export class RebalancePosition {
  public address: PublicKey;
  public lowerBinId: BN;
  public upperBinId: BN;
  public activeId: BN;
  public owner: PublicKey;
  public shouldClaimFee: boolean;
  public shouldClaimReward: boolean;
  public rebalancePositionBinData: RebalancePositionBinData[];

  constructor(
    positionAddress: PublicKey,
    positionData: PositionData,
    activeId: BN,
    shouldClaimFee: boolean,
    shouldClaimReward: boolean
  ) {
    this.address = positionAddress;
    this.rebalancePositionBinData = toRebalancePositionBinData(positionData);
    this.lowerBinId = new BN(positionData.lowerBinId);
    this.upperBinId = new BN(positionData.upperBinId);
    this.activeId = activeId;
    this.shouldClaimFee = shouldClaimFee;
    this.shouldClaimReward = shouldClaimReward;
    this.owner = positionData.owner;
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

    const depositBinIds = getDepositBinIds(this.activeId, deposits);

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
      amountX,
      amountY,
      favorXInActiveBin,
      strategyX,
      strategyY,
      minDeltaId,
      maxDeltaId,
    } of deposits) {
      const { x0, y0, amountIntoBins } = toAmountIntoBin(
        this.activeId,
        binStep,
        minDeltaId,
        maxDeltaId,
        strategyX,
        strategyY,
        amountX,
        amountY,
        favorXInActiveBin
      );

      addLiquidityParam.push({
        minDeltaId: minDeltaId.toNumber(),
        maxDeltaId: maxDeltaId.toNumber(),
        x0,
        y0,
        strategyX: toStrategyParamType(strategyX),
        strategyY: toStrategyParamType(strategyY),
        padding: Array(16).fill(0),
        favorXInActiveId: favorXInActiveBin,
      });

      for (const { binId, amountX, amountY } of amountIntoBins) {
        totalAmountXDeposited = totalAmountXDeposited.add(amountX);
        totalAmountYDeposited = totalAmountYDeposited.add(amountY);

        const idx = this.rebalancePositionBinData.findIndex(
          (data) => data.binId == binId.toNumber()
        );
        this.rebalancePositionBinData[idx].amountX =
          this.rebalancePositionBinData[idx].amountX.add(amountX);
        this.rebalancePositionBinData[idx].amountY =
          this.rebalancePositionBinData[idx].amountY.add(amountY);
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

    for (const { minBinId, maxBinId, bps } of withdraws) {
      const fromBinId = minBinId ?? this.activeId;
      const toBinId = maxBinId ?? this.activeId;

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
    withdraws = validateAndSortRebalanceWithdraw(withdraws, this.activeId);
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
    if (deposit.minDeltaId.gt(deposit.maxDeltaId)) {
      throw "Invalid minDeltaId or maxDeltaId";
    }
  }

  for (let i = 1; i < sortedDeposits.length; i++) {
    const prevDeposit = sortedDeposits[i - 1];
    const currDeposit = sortedDeposits[i];

    if (prevDeposit.maxDeltaId.gte(currDeposit.minDeltaId)) {
      throw "Invalid minDeltaId or maxDeltaId";
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

    if (filledMinBinId.gte(filledMaxBinId)) {
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
  /// Amount X to be deposited into bin range of minBinId to maxBinId
  amountX: BN;
  /// Amount Y to be deposited into bin range of minBinId to maxBinId
  amountY: BN;
  /// Strategy type for token X
  strategyX: StrategyType;
  /// Strategy type for token Y
  strategyY: StrategyType;
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
  let indexMap: Map<BN, boolean> = new Map();
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
      indexMap.set(binArrayIndex, true);
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
      indexMap.set(binArrayIndex, true);
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
  const binArrayIndexes = Array.from(indexMap.keys());

  const requireBitmapExtension = binArrayIndexes.some((index) =>
    isOverflowDefaultBinArrayBitmap(index)
  );

  return {
    binArrayIndexes,
    binArrayBitmap: requireBitmapExtension
      ? deriveBinArrayBitmapExtension(pairAddress, programId)[0]
      : programId,
  };
}
