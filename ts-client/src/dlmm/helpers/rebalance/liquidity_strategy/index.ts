import BN from "bn.js";
import { StrategyType } from "../../../types";
import { BidAskStrategyParameterBuilder } from "./bidAsk";
import { CurveStrategyParameterBuilder } from "./curve";
import { SpotStrategyParameterBuilder } from "./spot";
import { toAmountIntoBins } from "../rebalancePosition";
import { getPriceOfBinByBinId } from "../../weight";
import Decimal from "decimal.js";

export interface StrategyParameters {
  x0: BN;
  y0: BN;
  deltaX: BN;
  deltaY: BN;
}

export interface BidAskParameters {
  base: BN;
  delta: BN;
}

export interface LiquidityStrategyParameterBuilder {
  findXParameters(
    amountX: BN,
    minDeltaId: BN,
    maxDeltaId: BN,
    binStep: BN,
    activeId: BN
  ): BidAskParameters;
  findYParameters(
    amountY: BN,
    minDeltaId: BN,
    maxDeltaId: BN,
    activeId: BN
  ): BidAskParameters;
  suggestBalancedXParametersFromY(
    activeId: BN,
    binStep: BN,
    favorXInActiveBin: boolean,
    minDeltaId: BN,
    maxDeltaId: BN,
    amountY: BN
  ): BidAskParameters & { amountX: BN };
  suggestBalancedYParametersFromX(
    activeId: BN,
    binStep: BN,
    favorXInActiveBin: boolean,
    minDeltaId: BN,
    maxDeltaId: BN,
    amountXInQuoteValue: BN
  ): BidAskParameters & { amountY: BN };
}

export function getLiquidityStrategyParameterBuilder(
  strategyType: StrategyType
): LiquidityStrategyParameterBuilder {
  switch (strategyType) {
    case StrategyType.Spot:
      return new SpotStrategyParameterBuilder();
    case StrategyType.Curve:
      return new CurveStrategyParameterBuilder();
    case StrategyType.BidAsk:
      return new BidAskStrategyParameterBuilder();
    default:
      throw new Error("Strategy not supported");
  }
}

export function suggestBalancedXParametersFromY(
  y0: BN,
  deltaY: BN,
  minDeltaId: BN,
  maxDeltaId: BN,
  activeId: BN,
  binStep: BN,
  favorXInActiveBin: boolean,
  builder: LiquidityStrategyParameterBuilder
) {
  const endDeltaIdBidSide = favorXInActiveBin ? new BN(-1) : new BN(0);

  if (maxDeltaId.lte(endDeltaIdBidSide)) {
    return {
      base: new BN(0),
      delta: new BN(0),
      amountX: new BN(0),
    };
  }

  const minYDeltaId = minDeltaId;
  const maxYDeltaId = endDeltaIdBidSide;

  const totalAmountY = toAmountIntoBins(
    activeId,
    minYDeltaId,
    maxYDeltaId,
    new BN(0),
    deltaY,
    new BN(0),
    y0,
    binStep,
    favorXInActiveBin
  ).reduce((acc, bin) => {
    return acc.add(bin.amountY);
  }, new BN(0));

  const minXDeltaId = maxYDeltaId.addn(1);
  const maxXDeltaId = maxDeltaId;

  return builder.suggestBalancedXParametersFromY(
    activeId,
    binStep,
    favorXInActiveBin,
    minXDeltaId,
    maxXDeltaId,
    totalAmountY
  );
}

export function suggestBalancedYParametersFromX(
  x0: BN,
  deltaX: BN,
  minDeltaId: BN,
  maxDeltaId: BN,
  activeId: BN,
  binStep: BN,
  favorXInActiveBin: boolean,
  builder: LiquidityStrategyParameterBuilder
) {
  const startDeltaIdAskSide = favorXInActiveBin ? new BN(0) : new BN(1);

  if (minDeltaId.gte(startDeltaIdAskSide)) {
    return {
      base: new BN(0),
      delta: new BN(0),
      amountY: new BN(0),
    };
  }

  const minXDeltaId = startDeltaIdAskSide;
  const maxXDeltaId = maxDeltaId;

  const amountXInBins = toAmountIntoBins(
    activeId,
    minXDeltaId,
    maxXDeltaId,
    deltaX,
    new BN(0),
    x0,
    new BN(0),
    binStep,
    favorXInActiveBin
  );

  const totalAmountXInQuote = amountXInBins.reduce((acc, bin) => {
    const price = getPriceOfBinByBinId(
      bin.binId.toNumber(),
      binStep.toNumber()
    );
    return acc.add(price.mul(new Decimal(bin.amountX.toString())));
  }, new Decimal(0));

  const totalAmountXInQuoteBN = new BN(totalAmountXInQuote.floor().toString());

  const minYDeltaId = minDeltaId;
  const maxYDeltaId = startDeltaIdAskSide.subn(1);

  return builder.suggestBalancedYParametersFromX(
    activeId,
    binStep,
    favorXInActiveBin,
    minYDeltaId,
    maxYDeltaId,
    totalAmountXInQuoteBN
  );
}

export function buildLiquidityStrategyParameters(
  amountX: BN,
  amountY: BN,
  minDeltaId: BN,
  maxDeltaId: BN,
  binStep: BN,
  favorXInActiveId: boolean,
  activeId: BN,
  strategyParameterBuilder: LiquidityStrategyParameterBuilder
): StrategyParameters {
  if (minDeltaId.gt(maxDeltaId)) {
    return {
      x0: new BN(0),
      y0: new BN(0),
      deltaX: new BN(0),
      deltaY: new BN(0),
    };
  }

  const depositOnlyY =
    maxDeltaId.lt(new BN(0)) || (maxDeltaId.isZero() && !favorXInActiveId);

  const depositOnlyX =
    minDeltaId.gt(new BN(0)) || (minDeltaId.isZero() && favorXInActiveId);

  if (depositOnlyY) {
    const { base, delta } = strategyParameterBuilder.findYParameters(
      amountY,
      minDeltaId,
      maxDeltaId,
      activeId
    );
    return {
      x0: new BN(0),
      deltaX: new BN(0),
      y0: base,
      deltaY: delta,
    };
  }

  if (depositOnlyX) {
    const { base, delta } = strategyParameterBuilder.findXParameters(
      amountX,
      minDeltaId,
      maxDeltaId,
      binStep,
      activeId
    );
    return {
      x0: base,
      deltaX: delta,
      y0: new BN(0),
      deltaY: new BN(0),
    };
  }

  const maxDeltaIdBidSide = favorXInActiveId ? new BN(-1) : new BN(0);
  const minDeltaIdAskSide = favorXInActiveId ? new BN(0) : new BN(1);

  const { base: y0, delta: deltaY } = strategyParameterBuilder.findYParameters(
    amountY,
    minDeltaId,
    maxDeltaIdBidSide,
    activeId
  );

  const { base: x0, delta: deltaX } = strategyParameterBuilder.findXParameters(
    amountX,
    minDeltaIdAskSide,
    maxDeltaId,
    binStep,
    activeId
  );

  return {
    x0,
    deltaX,
    y0,
    deltaY,
  };
}
