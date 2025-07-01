import BN from "bn.js";
import Decimal from "decimal.js";
import { BidAskParameters, LiquidityStrategyParameterBuilder } from ".";
import { SCALE_OFFSET } from "../../../constants";
import { getQPriceBaseFactor, getQPriceFromId } from "../../math";
import { getPriceOfBinByBinId } from "../../weight";
import { getAmountInBinsAskSide, toAmountIntoBins } from "../rebalancePosition";

function findY0(amountY: BN, minDeltaId: BN, maxDeltaId: BN) {
  if (minDeltaId.gt(maxDeltaId) || amountY.lte(new BN(0)) || amountY.isZero()) {
    return new BN(0);
  }

  // min_delta_id = -m1, max_delta_id = -m2
  //
  // active_id - m2 = y0 + delta_y * m2
  // active_id - (m2 + 1) = y0 + delta_y * (m2-1)
  // ...
  // active_id - m1 = y0 + delta_y * m1
  //
  // sum(amounts) = y0 * (m1-m2+1) + delta_y * (m1 * (m1+1)/2 - m2 * (m2-1)/2)
  // set delta_y = 0
  // sum(amounts) = y0 * (m1-m2+1)
  // A = (m1-m2+1)
  // y0 = sum(amounts) / A

  const m1 = minDeltaId.neg();
  const m2 = maxDeltaId.neg();

  const delta = m1.sub(m2).addn(1);
  return amountY.div(delta);
}

function findBaseX0(
  amountX: BN,
  minDeltaId: BN,
  maxDeltaId: BN,
  binStep: BN,
  activeId: BN
) {
  // min_delta_id = m1, max_delta_id = m2
  // pm = (1+b)^-(active_id + m)
  //
  // active_id + m1 = (x0 + m1 * delta_x) * p(m1)
  // active_id + m1 + 1 = (x0 + (m1 + 1) * delta_x) * p(m1+1)
  // ...
  // active_id + m2 =  (x0 + m2 * delta_x) * p(m2)
  //
  // sum(amounts) = x0 * (p(m1)+..+p(m2)) + delta_x * (m1 * p(m1) + ... + m2 * p(m2))
  // set delta_x = 0

  // sum(amounts) = x0 * (p(m1)+..+p(m2))
  // B = p(m1)+..+p(m2)
  // x0 = sum(amounts) / B

  let totalWeight = new BN(0);

  const minBinId = activeId.add(minDeltaId);
  const maxBinId = activeId.add(maxDeltaId);

  let baseFactor = getQPriceBaseFactor(binStep);
  let basePrice = getQPriceFromId(maxBinId.neg(), binStep);

  for (let binId = minBinId.toNumber(); binId <= maxBinId.toNumber(); binId++) {
    totalWeight = totalWeight.add(basePrice);
    basePrice = basePrice.mul(baseFactor).shrn(SCALE_OFFSET);
  }

  return amountX.shln(SCALE_OFFSET).div(totalWeight);
}

function findX0(
  amountX: BN,
  minDeltaId: BN,
  maxDeltaId: BN,
  binStep: BN,
  activeId: BN
) {
  if (minDeltaId.gt(maxDeltaId) || amountX.lte(new BN(0)) || amountX.isZero()) {
    return new BN(0);
  }
  let x0 = findBaseX0(amountX, minDeltaId, maxDeltaId, binStep, activeId);

  while (true) {
    const amountInBins = getAmountInBinsAskSide(
      activeId,
      binStep,
      minDeltaId,
      maxDeltaId,
      new BN(0),
      x0
    );

    const totalAmountX = amountInBins.reduce((acc, bin) => {
      return acc.add(bin.amountX);
    }, new BN(0));

    if (totalAmountX.lt(amountX)) {
      x0 = x0.add(new BN(1));
    } else {
      x0 = x0.sub(new BN(1));
      return x0;
    }
  }
}

export class SpotStrategyParameterBuilder
  implements LiquidityStrategyParameterBuilder
{
  findXParameters(
    amountX: BN,
    minDeltaId: BN,
    maxDeltaId: BN,
    binStep: BN,
    activeId: BN
  ): BidAskParameters {
    return {
      base: findX0(amountX, minDeltaId, maxDeltaId, binStep, activeId),
      delta: new BN(0),
    };
  }

  findYParameters(
    amountY: BN,
    minDeltaId: BN,
    maxDeltaId: BN,
    _activeId: BN
  ): BidAskParameters {
    return {
      base: findY0(amountY, minDeltaId, maxDeltaId),
      delta: new BN(0),
    };
  }

  suggestBalancedXParametersFromY(
    activeId: BN,
    binStep: BN,
    favorXInActiveBin: boolean,
    minDeltaId: BN,
    maxDeltaId: BN,
    amountY: BN
  ): BidAskParameters & { amountX: BN } {
    // pm = (1+b)^-(active_id + m)
    //
    // sum(amounts) = x0 * (p(m1)+..+p(m2)) + delta_x * (m1 * p(m1) + ... + m2 * p(m2))
    // set delta_x = 0
    // Total quote = x0 * (max_delta_id + 1) = total_amount_y
    // x0 = total_amount_y / (max_delta_id + 1)

    const x0 = amountY.div(maxDeltaId.addn(1));

    const totalAmountX = toAmountIntoBins(
      activeId,
      minDeltaId,
      maxDeltaId,
      new BN(0),
      new BN(0),
      x0,
      new BN(0),
      binStep,
      favorXInActiveBin
    ).reduce((acc, bin) => {
      return acc.add(bin.amountX);
    }, new BN(0));

    return {
      base: new BN(x0.toString()),
      delta: new BN(0),
      amountX: totalAmountX,
    };
  }

  suggestBalancedYParametersFromX(
    activeId: BN,
    binStep: BN,
    favorXInActiveBin: boolean,
    minDeltaId: BN,
    maxDeltaId: BN,
    amountXInQuoteValue: BN
  ): BidAskParameters & { amountY: BN } {
    // sum(amounts) = y0 * (m1-m2+1) + delta_y * (m1 * (m1+1)/2 - m2 * (m2-1)/2)
    // set delta_y = 0
    // sum(amounts) = y0 * (m1-m2+1)
    //
    // pm = (1+b)^(active_id + m)
    //
    // Total quote = sum(amounts) = x0 * (p(m1)+..+p(m2)) + delta_x * (m1 * p(m1) + ... + m2 * p(m2))
    // y0 = sum(amounts) / (m1-m2+1)

    const y0 = amountXInQuoteValue.div(maxDeltaId.sub(minDeltaId).addn(1));

    const amountY = toAmountIntoBins(
      activeId,
      minDeltaId,
      maxDeltaId,
      new BN(0),
      new BN(0),
      new BN(0),
      y0,
      binStep,
      favorXInActiveBin
    ).reduce((acc, bin) => {
      return acc.add(bin.amountY);
    }, new BN(0));

    return {
      base: y0,
      delta: new BN(0),
      amountY,
    };
  }
}
