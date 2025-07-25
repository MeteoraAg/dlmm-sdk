import BN from "bn.js";
import {
  capBps,
  MAX_BPS,
  RebalanceDepositWithdrawParameters,
  RebalanceStrategyBuilder,
} from ".";
import { PositionData, StrategyType } from "../../../types";
import {
  buildLiquidityStrategyParameters,
  getLiquidityStrategyParameterBuilder,
} from "../liquidity_strategy";
import {
  RebalanceWithDeposit,
  RebalanceWithWithdraw,
} from "../rebalancePosition";

export class BalancedStrategyBuilder implements RebalanceStrategyBuilder {
  constructor(
    public activeId: BN,
    public binStep: BN,
    public positionData: PositionData,
    public topUpAmountX: BN,
    public topUpAmountY: BN,
    public xWithdrawBps: BN,
    public yWithdrawBps: BN,
    public strategy: StrategyType,
    public favorXIfImbalance: boolean = false,
    public favorXInActiveBin: boolean = false
  ) {}

  // Rebalance to active bin by withdrawing all liquidities and redeposit portion of withdrawn liquidity, together with topup amount
  buildRebalanceStrategyParameters(): RebalanceDepositWithdrawParameters {
    const xWithdrawBps = capBps(this.xWithdrawBps);
    const yWithdrawBps = capBps(this.yWithdrawBps);

    let totalXAmountOut = new BN(this.positionData.totalXAmount);
    let totalYAmountOut = new BN(this.positionData.totalYAmount);

    totalXAmountOut = totalXAmountOut.add(new BN(this.positionData.feeX));
    totalYAmountOut = totalYAmountOut.add(new BN(this.positionData.feeY));

    const redepositAmountX = totalXAmountOut
      .mul(MAX_BPS.sub(xWithdrawBps))
      .div(MAX_BPS);
    const redepositAmountY = totalYAmountOut
      .mul(MAX_BPS.sub(yWithdrawBps))
      .div(MAX_BPS);

    const depositAmountX = this.topUpAmountX.add(redepositAmountX);
    const depositAmountY = this.topUpAmountY.add(redepositAmountY);

    const width =
      this.positionData.upperBinId - this.positionData.lowerBinId + 1;
    const binPerSide = Math.floor(width / 2);
    const rem = width % 2;

    let binPerAsk = binPerSide;
    let binPerBid = binPerSide;

    if (rem == 0) {
      if (this.favorXIfImbalance) {
        binPerAsk += 1;
        binPerBid -= 1;
      } else {
        binPerAsk -= 1;
        binPerBid += 1;
      }
    }

    const minDeltaId = new BN(binPerBid).neg();
    const maxDeltaId = new BN(binPerAsk);

    const strategyParameters = buildLiquidityStrategyParameters(
      depositAmountX,
      depositAmountY,
      minDeltaId,
      maxDeltaId,
      this.binStep,
      this.favorXInActiveBin,
      this.activeId,
      getLiquidityStrategyParameterBuilder(this.strategy)
    );

    const depositParam: RebalanceWithDeposit = {
      minDeltaId,
      maxDeltaId,
      x0: strategyParameters.x0,
      y0: strategyParameters.y0,
      deltaX: strategyParameters.deltaX,
      deltaY: strategyParameters.deltaY,
      favorXInActiveBin: this.favorXInActiveBin,
    };

    const withdrawParam: RebalanceWithWithdraw = {
      minBinId: new BN(this.positionData.lowerBinId),
      maxBinId: new BN(this.positionData.upperBinId),
      bps: MAX_BPS,
    };

    return {
      shouldClaimFee: true,
      shouldClaimReward: true,
      deposits: [depositParam],
      withdraws: [withdrawParam],
    };
  }
}
