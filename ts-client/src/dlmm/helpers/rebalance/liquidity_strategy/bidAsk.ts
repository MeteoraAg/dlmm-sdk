import BN from "bn.js";
import { BidAskParameters, LiquidityStrategyParameterBuilder } from ".";
import { SCALE_OFFSET } from "../../../constants";
import { getQPriceBaseFactor, getQPriceFromId } from "../../math";
import {
  getAmountInBinsAskSide,
  getAmountInBinsBidSide,
  toAmountIntoBins,
} from "../rebalancePosition";
import { pow } from "../../u64xu64_math";

function findMinY0(amountY: BN, minDeltaId: BN, maxDeltaId: BN) {
  const binCount = maxDeltaId.sub(minDeltaId).addn(1);
  const totalWeight = binCount.mul(binCount.addn(1)).divn(2);
  return amountY.div(totalWeight);
}

function findBaseDeltaY(amountY: BN, minDeltaId: BN, maxDeltaId: BN) {
  // min_delta_id = -m1, max_delta_id = -m2
  //
  // active_id - m2 = y0 + delta_y * m2
  // active_id - (m2 + 1) = y0 + delta_y * (m2-1)
  // ...
  // active_id - m1 = y0 + delta_y * m1
  //
  // sum(amounts) = y0 * (m1-m2+1) + delta_y * (m1 * (m1+1)/2 - m2 * (m2-1)/2)
  // ** default formula is, set y0 = -delta_y * m2, but we don't want last bin amount is 0
  // set y0 = -delta_y * (m2 - 1)
  // sum(amounts) = -delta_y * (m2 - 1) * (m1-m2+1) + delta_y * (m1 * (m1+1)/2 - m2 * (m2-1)/2)
  // A = (-m2 + 1) * (m1-m2+1) + (m1 * (m1+1)/2 - m2 * (m2-1)/2)
  // delta_y = sum(amounts) / A
  if (minDeltaId.gt(maxDeltaId) || amountY.lte(new BN(0))) {
    return new BN(0);
  }
  if (minDeltaId.eq(maxDeltaId)) {
    return amountY;
  }
  const m1 = minDeltaId.neg();
  const m2 = maxDeltaId.neg();
  // A = b + (c - d)
  // b = (-m2 + 1) * (m1-m2+1)
  // c = m1 * (m1+1)/2
  // d =  m2 * (m2-1)/2
  const b = m2.neg().addn(1).mul(m1.sub(m2).addn(1));
  const c = m1.mul(m1.addn(1)).divn(2);
  const d = m2.mul(m2.subn(1)).divn(2);
  const a = b.add(c.sub(d));
  return amountY.div(a);
}

function findY0AndDeltaY(
  amountY: BN,
  minDeltaId: BN,
  maxDeltaId: BN,
  activeId: BN,
): BidAskParameters {
  if (minDeltaId.gt(maxDeltaId) || amountY.isZero()) {
    return {
      base: new BN(0),
      delta: new BN(0),
    };
  }

  let baseDeltaY = findBaseDeltaY(amountY, minDeltaId, maxDeltaId);
  const y0 = baseDeltaY.neg().mul(maxDeltaId.neg().subn(1));

  while (true) {
    const amountInBins = getAmountInBinsBidSide(
      activeId,
      minDeltaId,
      maxDeltaId,
      baseDeltaY,
      y0,
    );

    const totalAmountY = amountInBins.reduce((acc, { amountY }) => {
      return acc.add(amountY);
    }, new BN(0));

    if (totalAmountY.gt(amountY)) {
      baseDeltaY = baseDeltaY.sub(new BN(1));
    } else {
      return {
        base: y0,
        delta: baseDeltaY,
      };
    }
  }
}

function findMinX0(
  amountX: BN,
  minDeltaId: BN,
  maxDeltaId: BN,
  activeId: BN,
  binStep: BN,
) {
  const minBinId = activeId.add(minDeltaId);
  const maxBinId = activeId.add(maxDeltaId);

  let totalWeight = new BN(0);

  for (let binId = minBinId.toNumber(); binId <= maxBinId.toNumber(); binId++) {
    const binDelta = binId - minBinId.toNumber() + 1;
    const binPrice = getQPriceFromId(new BN(binId), binStep);
    const weight = new BN(binDelta).mul(binPrice);
    totalWeight = totalWeight.add(weight);
  }

  return amountX.shln(SCALE_OFFSET).div(totalWeight);
}

export function findBaseDeltaX(
  amountX: BN,
  minDeltaId: BN,
  maxDeltaId: BN,
  binStep: BN,
  activeId: BN,
) {
  if (minDeltaId.gt(maxDeltaId) || amountX.lte(new BN(0))) {
    return new BN(0);
  }

  // min_delta_id = m1, max_delta_id = m2
  // p(m) = (1+b)^-(active_id + m)
  //
  // amount(m1)   = (x0 + m1 * delta_x)     * p(m1)
  // amount(m1+1) = (x0 + (m1 + 1) * delta_x) * p(m1+1)
  // ...
  // amount(m2)   = (x0 + m2 * delta_x)     * p(m2)
  //
  // sum(amounts) = x0 * (p(m1)+..+p(m2)) + delta_x * (m1 * p(m1) + ... + m2 * p(m2))
  //             = x0 * S + delta_x * C
  // where S = p(m1)+..+p(m2), C = m1 * p(m1) + ... + m2 * p(m2)
  //
  // the base bin (m = m1) must be non-zero, so set x0 = (-m1 + 1) * delta_x:
  // sum(amounts) = (-m1 + 1) * delta_x * S + delta_x * C
  //             = delta_x * (C - m1 * S + S)
  //             = delta_x * (C - B + S), where B = m1 * S
  // delta_x = sum(amounts) / (C - B + S)
  const m1 = minDeltaId;
  const m2 = maxDeltaId;

  let b = new BN(0); // B = m1 * (p(m1)+..+p(m2))
  let c = new BN(0); // C = m1 * p(m1) + ... + m2 * p(m2)
  let s = new BN(0); // S = p(m1)+..+p(m2)

  const base = getQPriceBaseFactor(binStep);
  const maxBinId = activeId.add(maxDeltaId);
  let inverseBasePrice = pow(base, maxBinId.neg());

  for (let m = m2.toNumber(); m >= m1.toNumber(); m--) {
    const pm = inverseBasePrice;

    b = b.add(m1.mul(pm));
    c = c.add(new BN(m).mul(pm));
    s = s.add(pm);

    inverseBasePrice = inverseBasePrice.mul(base).shrn(SCALE_OFFSET);
  }

  return amountX.shln(SCALE_OFFSET).div(c.sub(b).add(s));
}

function findX0AndDeltaX(
  amountX: BN,
  minDeltaId: BN,
  maxDeltaId: BN,
  binStep: BN,
  activeId: BN,
) {
  if (minDeltaId.gt(maxDeltaId) || amountX.lte(new BN(0)) || amountX.isZero()) {
    return {
      base: new BN(0),
      delta: new BN(0),
    };
  }

  let baseDeltaX = findBaseDeltaX(
    amountX,
    minDeltaId,
    maxDeltaId,
    binStep,
    activeId,
  );

  let maxProbe = 100;

  while (true) {
    if (maxProbe < 0) {
      throw new Error(
        "Something wrong: Unable to find suitable x0 and delta_x within probe limit",
      );
    }

    const x0 = minDeltaId.neg().addn(1).mul(baseDeltaX);

    const amountInBins = getAmountInBinsAskSide(
      activeId,
      binStep,
      minDeltaId,
      maxDeltaId,
      baseDeltaX,
      x0,
    );

    const totalAmountX = amountInBins.reduce((acc, { amountX }) => {
      return acc.add(amountX);
    }, new BN(0));

    if (totalAmountX.gt(amountX)) {
      baseDeltaX = baseDeltaX.subn(1);
      maxProbe--;
    } else {
      return {
        base: x0,
        delta: baseDeltaX,
      };
    }
  }
}

export class BidAskStrategyParameterBuilder implements LiquidityStrategyParameterBuilder {
  findXParameters(
    amountX: BN,
    minDeltaId: BN,
    maxDeltaId: BN,
    binStep: BN,
    activeId: BN,
  ): BidAskParameters {
    return findX0AndDeltaX(amountX, minDeltaId, maxDeltaId, binStep, activeId);
  }

  findYParameters(
    amountY: BN,
    minDeltaId: BN,
    maxDeltaId: BN,
    activeId: BN,
  ): BidAskParameters {
    return findY0AndDeltaY(amountY, minDeltaId, maxDeltaId, activeId);
  }

  suggestBalancedXParametersFromY(
    activeId: BN,
    binStep: BN,
    favorXInActiveBin: boolean,
    minDeltaId: BN,
    maxDeltaId: BN,
    amountY: BN,
  ): BidAskParameters & { amountX: BN } {
    // sum(amounts) = x0 * (p(m1)+..+p(m2)) + delta_x * (m1 * p(m1) + ... + m2 * p(m2))
    // default formula is, set x0 = -m1 * delta_x
    // set x0 = -m1 * delta_x + e where e = delta_x
    // Total quote = delta_x * (1 + 2 + ... + max_delta_id)
    // delta_x = total_quote / (1 + 2 + ... + max_delta_id)

    const deltaX = amountY.div(
      maxDeltaId.addn(1).mul(maxDeltaId.addn(2)).divn(2),
    );

    const x0 = minDeltaId.neg().mul(deltaX).add(deltaX);

    const totalAmountX = toAmountIntoBins(
      activeId,
      minDeltaId,
      maxDeltaId,
      deltaX,
      new BN(0),
      x0,
      new BN(0),
      binStep,
      favorXInActiveBin,
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
    amountXInQuoteValue: BN,
  ): BidAskParameters & { amountY: BN } {
    // set y0 = -delta_y * m2
    // sum(amounts) = -delta_y * m2 * (m1-m2+1) + delta_y * (m1 * (m1+1)/2 - m2 * (m2-1)/2)
    // A = -m2 * (m1-m2+1) + (m1 * (m1+1)/2 - m2 * (m2-1)/2)
    // delta_y = sum(amounts) / A

    // Total quote = sum(amounts) = x0 * (p(m1)+..+p(m2)) + delta_x * (m1 * p(m1) + ... + m2 * p(m2))
    // delta_y = sum(amounts) / A

    // extra sub 1 to ensure no zero amount
    const m1 = minDeltaId.neg().subn(1);
    const m2 = maxDeltaId.neg();

    const a1 = m2.neg().mul(m1.sub(m2).addn(1));
    const a2 = m1.mul(m1.addn(1)).divn(2);
    const a3 = m2.mul(m2.subn(1)).divn(2);

    const a = a1.add(a2.sub(a3));

    const deltaY = amountXInQuoteValue.div(a);
    const y0 = deltaY.neg().mul(m2).add(deltaY); // add the subtracted deltaY back to y0

    const amountY = toAmountIntoBins(
      activeId,
      minDeltaId,
      maxDeltaId,
      new BN(0),
      deltaY,
      new BN(0),
      y0,
      binStep,
      favorXInActiveBin,
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
