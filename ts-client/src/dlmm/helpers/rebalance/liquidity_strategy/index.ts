import BN from "bn.js";
import { StrategyType } from "../../../types";
import { BidAskStrategyParameterBuilder } from "./bidAsk";
import { CurveStrategyParameterBuilder } from "./curve";
import { SpotStrategyParameterBuilder } from "./spot";

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
