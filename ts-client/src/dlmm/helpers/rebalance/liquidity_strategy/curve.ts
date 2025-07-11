import BN from "bn.js";
import { BidAskParameters, LiquidityStrategyParameterBuilder } from ".";
import { SCALE_OFFSET } from "../../../constants";
import { getQPriceBaseFactor, getQPriceFromId } from "../../math";
import {
  getAmountInBinsAskSide,
  getAmountInBinsBidSide,
  toAmountIntoBins,
} from "../rebalancePosition";
import { getPriceOfBinByBinId } from "../../weight";
import Decimal from "decimal.js";

function findBaseY0(amountY: BN, minDeltaId: BN, maxDeltaId: BN) {
  // min_delta_id = -m1, max_delta_id = -m2
  //
  // active_id - m2 = y0 + delta_y * m2
  // active_id - (m2 + 1) = y0 + delta_y * (m2-1)
  // ...
  // active_id - m1 = y0 + delta_y * m1
  //
  // sum(amounts) = y0 * (m1-m2+1) + delta_y * (m1 * (m1+1)/2 - m2 * (m2-1)/2)
  // set delta_y = -y0 / m1
  // sum(amounts) = y0 * (m1-m2+1) - y0 * (m1 * (m1+1)/2 - m2 * (m2-1)/2) / m1
  // A = (m1-m2+1) - (m1 * (m1+1)/2 - m2 * (m2-1)/2) / m1
  // y0 = sum(amounts) / A
  if (minDeltaId.gt(maxDeltaId) || amountY.lte(new BN(0))) {
    return new BN(0);
  }

  if (minDeltaId.eq(maxDeltaId)) {
    return amountY;
  }

  const m1 = minDeltaId.neg();
  const m2 = maxDeltaId.neg();

  // A = b - (c - d) / m1
  // b = (m1-m2+1)
  // c = m1 * (m1+1)/2
  // d =  m2 * (m2-1)/2

  // seems like if we set delta_y = -y0 / (m1 + 1) the amount will be closer to desired amount
  const b = m1.sub(m2).addn(1);
  const c = m1.mul(m1.addn(1)).divn(2);
  const d = m2.mul(m2.subn(1)).divn(2);

  const a = b.sub(c.sub(d).div(m1.addn(1)));
  return amountY.div(a);
}

function findY0AndDeltaY(
  amountY: BN,
  minDeltaId: BN,
  maxDeltaId: BN,
  activeId: BN
): BidAskParameters {
  if (minDeltaId.gt(maxDeltaId) || amountY.isZero()) {
    return {
      base: new BN(0),
      delta: new BN(0),
    };
  }

  let baseY0 = findBaseY0(amountY, minDeltaId, maxDeltaId);

  while (true) {
    const deltaY = baseY0.neg().div(minDeltaId.neg().addn(1));

    const amountInBins = getAmountInBinsBidSide(
      activeId,
      minDeltaId,
      maxDeltaId,
      deltaY,
      baseY0
    );

    const totalAmountY = amountInBins.reduce((acc, { amountY }) => {
      return acc.add(amountY);
    }, new BN(0));

    if (totalAmountY.gt(amountY)) {
      baseY0 = baseY0.sub(new BN(1));
    } else {
      return {
        base: baseY0,
        delta: deltaY,
      };
    }
  }
}

function findBaseX0(
  amountX: BN,
  minDeltaId: BN,
  maxDeltaId: BN,
  binStep: BN,
  activeId: BN
) {
  if (minDeltaId.gt(maxDeltaId) || amountX.lte(new BN(0))) {
    return new BN(0);
  }

  // min_delta_id = m1, max_delta_id = m2
  // pm = (1+b)^-(active_id + m)
  //
  // active_id + m1 = (x0 + m1 * delta_x) * p(m1)
  // active_id + m1 + 1 = (x0 + (m1 + 1) * delta_x) * p(m1+1)
  // ...
  // active_id + m2 =  (x0 + m2 * delta_x) * p(m2)
  //
  // sum(amounts) = x0 * (p(m1)+..+p(m2)) + delta_x * (m1 * p(m1) + ... + m2 * p(m2))
  // set delta_x = -x0 / m2

  // sum(amounts) = x0 * (p(m1)+..+p(m2)) - x0 * (m1 * p(m1) + ... + m2 * p(m2)) / m2
  // A = (p(m1)+..+p(m2)) - (m1 * p(m1) + ... + m2 * p(m2)) / m2
  // B = (p(m1)+..+p(m2))
  // C = (m1 * p(m1) + ... + m2 * p(m2)) / m2
  // x0 = sum(amounts) / (B-C)

  let b = new BN(0);
  let c = new BN(0);
  let m1 = minDeltaId;
  let m2 = maxDeltaId;

  for (let m = m1.toNumber(); m <= m2.toNumber(); m++) {
    const binId = activeId.addn(m);

    const pm = getQPriceFromId(binId.neg(), binStep);
    b = b.add(pm);

    const cDelta = new BN(m).mul(pm).div(m2);
    c = c.add(cDelta);
  }

  return amountX.shln(SCALE_OFFSET).div(b.sub(c));
}

function findX0AndDeltaX(
  amountX: BN,
  minDeltaId: BN,
  maxDeltaId: BN,
  binStep: BN,
  activeId: BN
) {
  if (minDeltaId.gt(maxDeltaId) || amountX.lte(new BN(0)) || amountX.isZero()) {
    return {
      base: new BN(0),
      delta: new BN(0),
    };
  }

  let baseX0 = findBaseX0(amountX, minDeltaId, maxDeltaId, binStep, activeId);
  const deltaX = baseX0.neg().div(maxDeltaId);

  while (true) {
    const amountInBins = getAmountInBinsAskSide(
      activeId,
      binStep,
      minDeltaId,
      maxDeltaId,
      deltaX,
      baseX0
    );

    const totalAmountX = amountInBins.reduce((acc, { amountX }) => {
      return acc.add(amountX);
    }, new BN(0));

    if (totalAmountX.gt(amountX)) {
      baseX0 = baseX0.sub(new BN(1));
    } else {
      return {
        base: baseX0,
        delta: deltaX,
      };
    }
  }
}

export class CurveStrategyParameterBuilder
  implements LiquidityStrategyParameterBuilder
{
  findXParameters(
    amountX: BN,
    minDeltaId: BN,
    maxDeltaId: BN,
    binStep: BN,
    activeId: BN
  ): BidAskParameters {
    return findX0AndDeltaX(amountX, minDeltaId, maxDeltaId, binStep, activeId);
  }

  findYParameters(
    amountY: BN,
    minDeltaId: BN,
    maxDeltaId: BN,
    activeId: BN
  ): BidAskParameters {
    return findY0AndDeltaY(amountY, minDeltaId, maxDeltaId, activeId);
  }

  suggestBalancedXParametersFromY(
    activeId: BN,
    binStep: BN,
    favorXInActiveBin: boolean,
    minDeltaId: BN,
    maxDeltaId: BN,
    amountY: BN
  ): BidAskParameters & { amountX: BN } {
    // p(m) = (1+b)^-(active_id + m)
    // active_id = x0 * p(0)
    // active_id + 1= (x0 + delta_x) * p(1)
    // ...
    // active_id + max_delta_id =  (x0 + max_delta_id * delta_x) * p(max_delta_id)
    // Total quote = x0 + (x0 + delta_x) + ... + (x0 + max_delta_id * delta_x)
    // = x0 * (max_delta_id + 1) + delta_x * (1+2+...+max_delta_id)
    //
    // set delta_x = -x0 / max_delta_id
    // Total quote  = x0 * (max_delta_id + 1) - x0 * (1+2+...+max_delta_id) / max_delta_id = x0 * (max_delta_id + 1) / 2
    // x0 = total_amount_y * 2 / (max_delta_id + 1)

    const x0 = amountY.muln(2).div(maxDeltaId.addn(1));
    const deltaX = x0.neg().div(maxDeltaId);

    const totalAmountX = toAmountIntoBins(
      activeId,
      minDeltaId,
      maxDeltaId,
      deltaX,
      new BN(0),
      x0,
      new BN(0),
      binStep,
      favorXInActiveBin
    ).reduce((acc, bin) => {
      return acc.add(bin.amountX);
    }, new BN(0));

    return {
      base: x0,
      delta: deltaX,
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
    // set delta_y = -y0 / m1
    // sum(amounts) = y0 * (m1-m2+1) - y0 * (m1 * (m1+1)/2 - m2 * (m2-1)/2) / m1
    // A = (m1-m2+1) - (m1 * (m1+1)/2 - m2 * (m2-1)/2) / m1
    // y0 = sum(amounts) / A
    //
    // pm = (1+b)(active_id + m)
    //
    // Total quote = sum(amounts) = x0 * (p(m1)+..+p(m2)) + delta_x * (m1 * p(m1) + ... + m2 * p(m2))
    // y0 = x0 * (p(m1)+..+p(m2)) + delta_x * (m1 * p(m1) + ... + m2 * p(m2)) / A

    const m1 = minDeltaId.neg();
    const m2 = maxDeltaId.neg();

    const a1 = m1.sub(m2).addn(1);
    const a2 = m1.mul(m1.addn(1)).divn(2);
    const a3 = m2.mul(m2.subn(1)).divn(2);

    const a = m1.sub(a3.sub(a2)).div(m1);

    const y0 = amountXInQuoteValue.div(a);
    const deltaY = y0.neg().div(m1);

    const amountY = toAmountIntoBins(
      activeId,
      minDeltaId,
      maxDeltaId,
      new BN(0),
      deltaY,
      new BN(0),
      y0,
      binStep,
      favorXInActiveBin
    ).reduce((acc, bin) => {
      return acc.add(bin.amountY);
    }, new BN(0));

    return {
      base: y0,
      delta: deltaY,
      amountY,
    };
  }
}
