import { BN } from "@coral-xyz/anchor";
import gaussian, { Gaussian } from "gaussian";
import { BASIS_POINT_MAX } from "../constants";
import {
  StrategyParameters,
  StrategyType,
  parabolicParameter,
  spotParameter,
} from "../types";
import Decimal from "decimal.js";

export function getPriceOfBinByBinId(binId: number, binStep: number): Decimal {
  const binStepNum = new Decimal(binStep).div(new Decimal(BASIS_POINT_MAX));
  return new Decimal(1).add(new Decimal(binStepNum)).pow(new Decimal(binId));
}

/// Build a gaussian distribution from the bins, with active bin as the mean.
function buildGaussianFromBins(activeBin: number, binIds: number[]) {
  const smallestBin = Math.min(...binIds);
  const largestBin = Math.max(...binIds);

  // Define the Gaussian distribution. The mean will be active bin when active bin is within the bin ids. Else, use left or right most bin id as the mean.
  let mean = 0;
  const isAroundActiveBin = binIds.find((bid) => bid == activeBin);
  // The liquidity will be distributed surrounding active bin
  if (isAroundActiveBin) {
    mean = activeBin;
  }
  // The liquidity will be distributed to the right side of the active bin.
  else if (activeBin < smallestBin) {
    mean = smallestBin;
  }
  // The liquidity will be distributed to the left side of the active bin.
  else {
    mean = largestBin;
  }

  const TWO_STANDARD_DEVIATION = 4;
  const stdDev = (largestBin - smallestBin) / TWO_STANDARD_DEVIATION;
  const variance = Math.max(stdDev ** 2, 1);

  return gaussian(mean, variance);
}

/// Find the probability of the bin id over the gaussian. The probability ranged from 0 - 1 and will be used as liquidity allocation for that particular bin.
function generateBinLiquidityAllocation(
  gaussian: Gaussian,
  binIds: number[],
  invert: boolean
) {
  const allocations = binIds.map((bid) =>
    invert ? 1 / gaussian.pdf(bid) : gaussian.pdf(bid)
  );
  const totalAllocations = allocations.reduce((acc, v) => acc + v, 0);
  // Gaussian impossible to cover 100%, normalized it to have total of 100%
  return allocations.map((a) => a / totalAllocations);
}

/// Convert liquidity allocation from 0..1 to 0..10000 bps unit. The sum of allocations must be 1. Return BPS and the loss after conversion.
function computeAllocationBps(allocations: number[]): {
  bpsAllocations: BN[];
  pLoss: BN;
} {
  let totalAllocation = new BN(0);
  const bpsAllocations: BN[] = [];

  for (const allocation of allocations) {
    const allocBps = new BN(allocation * 10000);
    bpsAllocations.push(allocBps);
    totalAllocation = totalAllocation.add(allocBps);
  }

  const pLoss = new BN(10000).sub(totalAllocation);
  return {
    bpsAllocations,
    pLoss,
  };
}
/** private */

export function toWeightDistribution(
  amountX: BN,
  amountY: BN,
  distributions: {
    binId: number;
    xAmountBpsOfTotal: BN;
    yAmountBpsOfTotal: BN;
  }[],
  binStep: number
): { binId: number; weight: number }[] {
  // get all quote amount
  let totalQuote = new BN(0);
  const precision = 1_000_000_000_000;
  const quoteDistributions = distributions.map((bin) => {
    const price = new BN(
      getPriceOfBinByBinId(bin.binId, binStep).mul(precision).floor().toString()
    );
    const quoteValue = amountX
      .mul(new BN(bin.xAmountBpsOfTotal))
      .mul(new BN(price))
      .div(new BN(BASIS_POINT_MAX))
      .div(new BN(precision));
    const quoteAmount = quoteValue.add(
      amountY.mul(new BN(bin.yAmountBpsOfTotal)).div(new BN(BASIS_POINT_MAX))
    );
    totalQuote = totalQuote.add(quoteAmount);
    return {
      binId: bin.binId,
      quoteAmount,
    };
  });

  if (totalQuote.eq(new BN(0))) {
    return [];
  }

  const distributionWeights = quoteDistributions
    .map((bin) => {
      const weight = Math.floor(
        bin.quoteAmount.mul(new BN(65535)).div(totalQuote).toNumber()
      );
      return {
        binId: bin.binId,
        weight,
      };
    })
    .filter((item) => item.weight > 0);

  return distributionWeights;
}

export function calculateSpotDistribution(
  activeBin: number,
  binIds: number[]
): { binId: number; xAmountBpsOfTotal: BN; yAmountBpsOfTotal: BN }[] {
  if (!binIds.includes(activeBin)) {
    const { div: dist, mod: rem } = new BN(10_000).divmod(
      new BN(binIds.length)
    );
    const loss = rem.isZero() ? new BN(0) : new BN(1);

    const distributions =
      binIds[0] < activeBin
        ? binIds.map((binId) => ({
          binId,
          xAmountBpsOfTotal: new BN(0),
          yAmountBpsOfTotal: dist,
        }))
        : binIds.map((binId) => ({
          binId,
          xAmountBpsOfTotal: dist,
          yAmountBpsOfTotal: new BN(0),
        }));

    // Add the loss to the left most bin
    if (binIds[0] < activeBin) {
      distributions[0].yAmountBpsOfTotal.add(loss);
    }
    // Add the loss to the right most bin
    else {
      distributions[binIds.length - 1].xAmountBpsOfTotal.add(loss);
    }

    return distributions;
  }

  const binYCount = binIds.filter((binId) => binId < activeBin).length;
  const binXCount = binIds.filter((binId) => binId > activeBin).length;

  const totalYBinCapacity = binYCount + 0.5;
  const totalXBinCapacity = binXCount + 0.5;

  const yBinBps = new BN(10_000 / totalYBinCapacity);
  const yActiveBinBps = new BN(10_000).sub(yBinBps.mul(new BN(binYCount)));

  const xBinBps = new BN(10_000 / totalXBinCapacity);
  const xActiveBinBps = new BN(10_000).sub(xBinBps.mul(new BN(binXCount)));

  return binIds.map((binId) => {
    const isYBin = binId < activeBin;
    const isXBin = binId > activeBin;
    const isActiveBin = binId === activeBin;

    if (isYBin) {
      return {
        binId,
        xAmountBpsOfTotal: new BN(0),
        yAmountBpsOfTotal: yBinBps,
      };
    }

    if (isXBin) {
      return {
        binId,
        xAmountBpsOfTotal: xBinBps,
        yAmountBpsOfTotal: new BN(0),
      };
    }

    if (isActiveBin) {
      return {
        binId,
        xAmountBpsOfTotal: xActiveBinBps,
        yAmountBpsOfTotal: yActiveBinBps,
      };
    }
  });
}

export function calculateBidAskDistribution(
  activeBin: number,
  binIds: number[]
): {
  binId: number;
  xAmountBpsOfTotal: BN;
  yAmountBpsOfTotal: BN;
}[] {
  const smallestBin = Math.min(...binIds);
  const largestBin = Math.max(...binIds);

  const rightOnly = activeBin < smallestBin;
  const leftOnly = activeBin > largestBin;

  const gaussian = buildGaussianFromBins(activeBin, binIds);
  const allocations = generateBinLiquidityAllocation(gaussian, binIds, true);

  // To the right of active bin, liquidity distribution consists of only token X.
  if (rightOnly) {
    const { bpsAllocations, pLoss } = computeAllocationBps(allocations);
    const binDistributions = binIds.map((bid, idx) => ({
      binId: bid,
      xAmountBpsOfTotal: bpsAllocations[idx],
      yAmountBpsOfTotal: new BN(0),
    }));
    const idx = binDistributions.length - 1;
    binDistributions[idx].xAmountBpsOfTotal =
      binDistributions[idx].xAmountBpsOfTotal.add(pLoss);
    return binDistributions;
  }

  // To the left of active bin, liquidity distribution consists of only token Y.
  if (leftOnly) {
    const { bpsAllocations, pLoss } = computeAllocationBps(allocations);
    const binDistributions = binIds.map((bid, idx) => ({
      binId: bid,
      xAmountBpsOfTotal: new BN(0),
      yAmountBpsOfTotal: bpsAllocations[idx],
    }));
    binDistributions[0].yAmountBpsOfTotal =
      binDistributions[0].yAmountBpsOfTotal.add(pLoss);
    return binDistributions;
  }

  // Find total X, and Y bps allocations for normalization.
  const [totalXAllocation, totalYAllocation] = allocations.reduce(
    ([xAcc, yAcc], allocation, idx) => {
      const binId = binIds[idx];
      if (binId > activeBin) {
        return [xAcc + allocation, yAcc];
      } else if (binId < activeBin) {
        return [xAcc, yAcc + allocation];
      } else {
        const half = allocation / 2;
        return [xAcc + half, yAcc + half];
      }
    },
    [0, 0]
  );

  // Normalize and convert to BPS
  const [normXAllocations, normYAllocations] = allocations.reduce<[BN[], BN[]]>(
    ([xAllocations, yAllocations], allocation, idx) => {
      const binId = binIds[idx];
      if (binId > activeBin) {
        const distX = new BN((allocation * 10000) / totalXAllocation);
        xAllocations.push(distX);
      }
      if (binId < activeBin) {
        const distY = new BN((allocation * 10000) / totalYAllocation);
        yAllocations.push(distY);
      }
      if (binId == activeBin) {
        const half = allocation / 2;
        const distX = new BN((half * 10000) / totalXAllocation);
        const distY = new BN((half * 10000) / totalYAllocation);
        xAllocations.push(distX);
        yAllocations.push(distY);
      }
      return [xAllocations, yAllocations];
    },
    [[], []]
  );

  const totalXNormAllocations = normXAllocations.reduce(
    (acc, v) => acc.add(v),
    new BN(0)
  );
  const totalYNormAllocations = normYAllocations.reduce(
    (acc, v) => acc.add(v),
    new BN(0)
  );

  const xPLoss = new BN(10000).sub(totalXNormAllocations);
  const yPLoss = new BN(10000).sub(totalYNormAllocations);

  const distributions = binIds.map((binId) => {
    if (binId === activeBin) {
      return {
        binId,
        xAmountBpsOfTotal: normXAllocations.shift(),
        yAmountBpsOfTotal: normYAllocations.shift(),
      };
    }

    if (binId > activeBin) {
      return {
        binId,
        xAmountBpsOfTotal: normXAllocations.shift(),
        yAmountBpsOfTotal: new BN(0),
      };
    }

    if (binId < activeBin) {
      return {
        binId,
        xAmountBpsOfTotal: new BN(0),
        yAmountBpsOfTotal: normYAllocations.shift(),
      };
    }
  });

  if (!yPLoss.isZero()) {
    distributions[0].yAmountBpsOfTotal =
      distributions[0].yAmountBpsOfTotal.add(yPLoss);
  }

  if (!xPLoss.isZero()) {
    const last = distributions.length - 1;
    distributions[last].xAmountBpsOfTotal =
      distributions[last].xAmountBpsOfTotal.add(xPLoss);
  }

  return distributions;
}

export function calculateNormalDistribution(
  activeBin: number,
  binIds: number[]
): {
  binId: number;
  xAmountBpsOfTotal: BN;
  yAmountBpsOfTotal: BN;
}[] {
  const smallestBin = Math.min(...binIds);
  const largestBin = Math.max(...binIds);

  const rightOnly = activeBin < smallestBin;
  const leftOnly = activeBin > largestBin;

  const gaussian = buildGaussianFromBins(activeBin, binIds);
  const allocations = generateBinLiquidityAllocation(gaussian, binIds, false);

  // To the right of active bin, liquidity distribution consists of only token X.
  if (rightOnly) {
    const { bpsAllocations, pLoss } = computeAllocationBps(allocations);
    const binDistributions = binIds.map((bid, idx) => ({
      binId: bid,
      xAmountBpsOfTotal: bpsAllocations[idx],
      yAmountBpsOfTotal: new BN(0),
    }));
    // When contains only X token, bin closest to active bin will be index 0.
    // Add back the precision loss
    binDistributions[0].xAmountBpsOfTotal =
      binDistributions[0].xAmountBpsOfTotal.add(pLoss);
    return binDistributions;
  }

  // To the left of active bin, liquidity distribution consists of only token Y.
  if (leftOnly) {
    const { bpsAllocations, pLoss } = computeAllocationBps(allocations);
    const binDistributions = binIds.map((bid, idx) => ({
      binId: bid,
      xAmountBpsOfTotal: new BN(0),
      yAmountBpsOfTotal: bpsAllocations[idx],
    }));
    // When contains only Y token, bin closest to active bin will be last index.
    // Add back the precision loss
    const idx = binDistributions.length - 1;
    binDistributions[idx].yAmountBpsOfTotal =
      binDistributions[idx].yAmountBpsOfTotal.add(pLoss);
    return binDistributions;
  }

  // The liquidity distribution consists of token X and Y. Allocations from gaussian only says how much liquidity percentage per bin over the full bin range.
  // Normalize liquidity allocation percentage into X - 100%, Y - 100%.

  // Find total X, and Y bps allocations for normalization.
  const [totalXAllocation, totalYAllocation] = allocations.reduce(
    ([xAcc, yAcc], allocation, idx) => {
      const binId = binIds[idx];
      if (binId > activeBin) {
        return [xAcc + allocation, yAcc];
      } else if (binId < activeBin) {
        return [xAcc, yAcc + allocation];
      } else {
        const half = allocation / 2;
        return [xAcc + half, yAcc + half];
      }
    },
    [0, 0]
  );

  // Normalize and convert to BPS
  const [normXAllocations, normYAllocations] = allocations.reduce(
    ([xAllocations, yAllocations], allocation, idx) => {
      const binId = binIds[idx];
      if (binId > activeBin) {
        const distX = new BN((allocation * 10000) / totalXAllocation);
        xAllocations.push(distX);
      }
      if (binId < activeBin) {
        const distY = new BN((allocation * 10000) / totalYAllocation);
        yAllocations.push(distY);
      }
      return [xAllocations, yAllocations];
    },
    [[], []]
  );

  const normXActiveBinAllocation = normXAllocations.reduce(
    (maxBps, bps) => maxBps.sub(bps),
    new BN(10_000)
  );
  const normYActiveBinAllocation = normYAllocations.reduce(
    (maxBps, bps) => maxBps.sub(bps),
    new BN(10_000)
  );

  return binIds.map((binId) => {
    if (binId === activeBin) {
      return {
        binId,
        xAmountBpsOfTotal: normXActiveBinAllocation,
        yAmountBpsOfTotal: normYActiveBinAllocation,
      };
    }

    if (binId > activeBin) {
      return {
        binId,
        xAmountBpsOfTotal: normXAllocations.shift(),
        yAmountBpsOfTotal: new BN(0),
      };
    }

    if (binId < activeBin) {
      return {
        binId,
        xAmountBpsOfTotal: new BN(0),
        yAmountBpsOfTotal: normYAllocations.shift(),
      };
    }
  });
}

export function fromStrategyParamsToWeightDistribution(
  strategyParameters: StrategyParameters
): { binId: number; weight: number }[] {
  const {
    maxBinId,
    minBinId,
    strategyType,
    aRight,
    aLeft,
    centerBinId,
    weightRight,
    weightLeft,
  } = strategyParameters;
  // validate firstly
  if (maxBinId < minBinId) {
    throw new Error("maxBinId cannot be smaller than minBinId");
  }
  if (centerBinId < minBinId || centerBinId > maxBinId) {
    throw new Error("centerBinId must be between minBinId and maxBinId");
  }
  const distributionWeights: Array<{ binId: number; weight: number }> = [];
  switch (strategyType) {
    case StrategyType.Spot: {
      for (let i = minBinId; i <= maxBinId; i++) {
        if (i < centerBinId) {
          distributionWeights.push({
            binId: i,
            weight: weightLeft,
          });
        }
        if (i > centerBinId) {
          distributionWeights.push({
            binId: i,
            weight: weightRight,
          });
        }
        if (i == centerBinId) {
          distributionWeights.push({
            binId: i,
            weight: weightLeft > weightRight ? weightLeft : weightRight,
          });
        }
      }
      break;
    }
    case StrategyType.Curve: {
      if (aRight < 0 || aRight > 32768) {
        throw new Error("aRight is out of range");
      }
      if (aLeft < 0 || aLeft > 32768) {
        throw new Error("aBid is out of range");
      }
      const bLeft = (centerBinId - minBinId) * (centerBinId - minBinId);
      const bRight = (maxBinId - centerBinId) * (maxBinId - centerBinId);
      for (let i = minBinId; i <= maxBinId; i++) {
        if (i < centerBinId) {
          const b = (i - centerBinId) * (i - centerBinId);
          const weight = (aLeft * (bLeft - b)) / 15000;
          distributionWeights.push({
            binId: i,
            weight: Math.max(weight, 0),
          });
        } else if (i > centerBinId) {
          const b = (i - centerBinId) * (i - centerBinId);
          const weight = (aRight * (bRight - b)) / 15000;
          distributionWeights.push({
            binId: i,
            weight: Math.max(weight, 0),
          });
        } else {
          const a = bLeft > bRight ? aLeft : aRight;
          const b = bLeft > bRight ? bLeft : bRight;
          const weight = (a * b) / 15000;
          distributionWeights.push({
            binId: i,
            weight: Math.max(weight, 0),
          });
        }
      }
      break;
    }
    case StrategyType.BidAsk: {
      if (aRight < 0 || aRight > 32768) {
        throw new Error("aRight is out of range");
      }
      if (aLeft < 0 || aLeft > 32768) {
        throw new Error("aBid is out of range");
      }
      for (let i = minBinId; i <= maxBinId; i++) {
        if (i < centerBinId) {
          const b = (i - centerBinId) * (i - centerBinId);
          const weight = (aLeft * b) / 15000;
          distributionWeights.push({
            binId: i,
            weight: Math.max(weight, 0),
          });
        } else if (i > centerBinId) {
          const b = (i - centerBinId) * (i - centerBinId);
          const weight = (aRight * b) / 15000;
          distributionWeights.push({
            binId: i,
            weight: Math.max(weight, 0),
          });
        } else {
          distributionWeights.push({
            binId: i,
            weight: 0,
          });
        }
      }
      break;
    }
  }
  return distributionWeights;
}

// this this function to convert correct type for program
export function toStrategyParameters(strategyParameters: StrategyParameters) {
  const {
    maxBinId,
    minBinId,
    strategyType,
    aRight,
    aLeft,
    centerBinId,
    weightRight,
    weightLeft,
  } = strategyParameters;
  switch (strategyType) {
    case StrategyType.Spot: {
      const data = Buffer.alloc(spotParameter.span);
      spotParameter.encode(
        {
          weightRight,
          weightLeft,
          centerBinId,
        },
        data
      );
      let parameters = Buffer.concat([
        data,
        Buffer.from(new Array<number>(58).fill(0)),
      ]);
      return {
        minBinId,
        maxBinId,
        strategyType: { spot: {} },
        parameteres: parameters.toJSON().data,
      };
    }
    case StrategyType.Curve: {
      const data = Buffer.alloc(parabolicParameter.span);
      parabolicParameter.encode(
        {
          aRight,
          aLeft,
          centerBinId,
        },
        data
      );
      let parameters = Buffer.concat([
        data,
        Buffer.from(new Array<number>(58).fill(0)),
      ]);
      return {
        minBinId,
        maxBinId,
        strategyType: { curve: {} },
        parameteres: parameters.toJSON().data,
      };
    }
    case StrategyType.BidAsk:
      const data = Buffer.alloc(parabolicParameter.span);
      parabolicParameter.encode(
        {
          aRight,
          aLeft,
          centerBinId,
        },
        data
      );
      let parameters = Buffer.concat([
        data,
        Buffer.from(new Array<number>(58).fill(0)),
      ]);
      return {
        minBinId,
        maxBinId,
        strategyType: { bidAsk: {} },
        parameteres: parameters.toJSON().data,
      };
  }
}

export function fromWeightDistributionToAmountOneSide(
  amount: BN,
  distributions: { binId: number; weight: number }[],
  binStep: number,
  activeId: number,
  depositForY: boolean,
): { binId: number; amount: BN }[] {
  if (depositForY) {
    // get sum of weight
    const totalWeight = distributions.reduce(function (sum, el) {
      return el.binId > activeId ? sum : sum.add(el.weight); // skip all ask side
    }, new Decimal(0));

    if (totalWeight.cmp(new Decimal(0)) == 0) {
      throw Error("Invalid parameteres");
    }
    return distributions.map((bin) => {
      if (bin.binId > activeId) {
        return {
          binId: bin.binId,
          amount: new BN(0),
        };
      } else {
        return {
          binId: bin.binId,
          amount: new BN(new Decimal(amount.toString())
            .mul(new Decimal(bin.weight).div(totalWeight))
            .floor().toString()),
        };
      }
    });
  } else {
    // get sum of weight
    const totalWeight: Decimal = distributions.reduce(function (sum, el) {
      if (el.binId < activeId) {
        return sum;
      } else {
        const price = getPriceOfBinByBinId(el.binId, binStep);
        const weightPerPrice = new Decimal(el.weight).div(price);
        return sum.add(weightPerPrice);
      }
    }, new Decimal(0));

    if (totalWeight.cmp(new Decimal(0)) == 0) {
      throw Error("Invalid parameteres");
    }

    return distributions.map((bin) => {
      if (bin.binId < activeId) {
        return {
          binId: bin.binId,
          amount: new BN(0),
        };
      } else {
        return {
          binId: bin.binId,
          amount: new BN(new Decimal(amount.toString())
            .mul(new Decimal(bin.weight).div(totalWeight))
            .floor().toString()),
        };
      }
    })
  }
}

export function fromWeightDistributionToAmount(
  amountX: BN,
  amountY: BN,
  distributions: { binId: number; weight: number }[],
  binStep: number,
  activeId: number,
  amountXInActiveBin: BN,
  amountYInActiveBin: BN
): { binId: number; amountX: BN; amountY: BN }[] {
  // sort distribution
  var distributions = distributions.sort((n1, n2) => {
    return n1.binId - n2.binId;
  });

  if (distributions.length == 0) {
    return [];
  }

  // only bid side
  if (activeId > distributions[distributions.length - 1].binId) {
    // get sum of weight
    const totalWeight = distributions.reduce(function (sum, el) {
      return sum.add(el.weight);
    }, new Decimal(0));

    return distributions.map((bin) => {
      const amount = totalWeight.greaterThan(0)
        ? new Decimal(amountY.toString())
          .mul(new Decimal(bin.weight).div(totalWeight))
          .floor()
        : new Decimal(0);
      return {
        binId: bin.binId,
        amountX: new BN(0),
        amountY: new BN(amount.toString()),
      };
    });
  }

  // only ask side
  if (activeId < distributions[0].binId) {
    // get sum of weight
    const totalWeight: Decimal = distributions.reduce(function (sum, el) {
      const price = getPriceOfBinByBinId(el.binId, binStep);
      const weightPerPrice = new Decimal(el.weight).div(price);
      return sum.add(weightPerPrice);
    }, new Decimal(0));

    return distributions.map((bin) => {
      const amount = totalWeight.greaterThan(0)
        ? new Decimal(amountX.toString())
          .mul(new Decimal(bin.weight).div(totalWeight))
          .floor()
        : new Decimal(0);
      return {
        binId: bin.binId,
        amountX: new BN(amount.toString()),
        amountY: new BN(0),
      };
    });
  }

  const activeBins = distributions.filter((element) => {
    return element.binId === activeId;
  });

  if (activeBins.length === 1) {
    const p0 = getPriceOfBinByBinId(activeId, binStep);
    let wx0 = new Decimal(0);
    let wy0 = new Decimal(0);
    const activeBin = activeBins[0];
    if (amountXInActiveBin.isZero() && amountYInActiveBin.isZero()) {
      wx0 = new Decimal(activeBin.weight).div(p0.mul(new Decimal(2)));
      wy0 = new Decimal(activeBin.weight).div(new Decimal(2));
    } else {
      let amountXInActiveBinDec = new Decimal(amountXInActiveBin.toNumber());
      let amountYInActiveBinDec = new Decimal(amountYInActiveBin.toNumber());

      if (!amountXInActiveBin.isZero()) {
        wx0 = new Decimal(activeBin.weight).div(
          p0.add(amountXInActiveBinDec.div(amountYInActiveBinDec))
        );
      }
      if (!amountYInActiveBin.isZero()) {
        wy0 = new Decimal(activeBin.weight).div(
          new Decimal(1).add(
            p0.mul(amountXInActiveBinDec).div(amountYInActiveBinDec)
          )
        );
      }
    }

    let totalWeightX = wx0;
    let totalWeightY = wy0;
    distributions.forEach((element) => {
      if (element.binId < activeId) {
        totalWeightY = totalWeightY.add(new Decimal(element.weight));
      }
      if (element.binId > activeId) {
        let price = getPriceOfBinByBinId(element.binId, binStep);
        let weighPerPrice = new Decimal(element.weight).div(price);
        totalWeightX = totalWeightX.add(weighPerPrice);
      }
    });
    const kx = new Decimal(amountX.toNumber()).div(totalWeightX);
    const ky = new Decimal(amountY.toNumber()).div(totalWeightY);
    let k = (kx.lessThan(ky) ? kx : ky);
    return distributions.map((bin) => {
      if (bin.binId < activeId) {
        const amount = k.mul(new Decimal(bin.weight));
        return {
          binId: bin.binId,
          amountX: new BN(0),
          amountY: new BN(Math.floor(amount.toNumber())),
        };
      }
      if (bin.binId > activeId) {
        const price = getPriceOfBinByBinId(bin.binId, binStep);
        const weighPerPrice = new Decimal(bin.weight).div(price);
        const amount = k.mul(weighPerPrice);
        return {
          binId: bin.binId,
          amountX: new BN(Math.floor(amount.toNumber())),
          amountY: new BN(0),
        };
      }

      const amountXActiveBin = k.mul(wx0);
      const amountYActiveBin = k.mul(wy0);
      return {
        binId: bin.binId,
        amountX: new BN(Math.floor(amountXActiveBin.toNumber())),
        amountY: new BN(Math.floor(amountYActiveBin.toNumber())),
      };
    });
  } else {
    let totalWeightX = new Decimal(0);
    let totalWeightY = new Decimal(0);
    distributions.forEach((element) => {
      if (element.binId < activeId) {
        totalWeightY = totalWeightY.add(new Decimal(element.weight));
      } else {
        let price = getPriceOfBinByBinId(element.binId, binStep);
        let weighPerPrice = new Decimal(element.weight).div(price);
        totalWeightX = totalWeightX.add(weighPerPrice);
      }
    });

    let kx = new Decimal(amountX.toNumber()).div(totalWeightX);
    let ky = new Decimal(amountY.toNumber()).div(totalWeightY);
    let k = kx.lessThan(ky) ? kx : ky;

    return distributions.map((bin) => {
      if (bin.binId < activeId) {
        const amount = k.mul(new Decimal(bin.weight));
        return {
          binId: bin.binId,
          amountX: new BN(0),
          amountY: new BN(Math.floor(amount.toNumber())),
        };
      } else {
        let price = getPriceOfBinByBinId(bin.binId, binStep);
        let weighPerPrice = new Decimal(bin.weight).div(price);
        const amount = k.mul(weighPerPrice);
        return {
          binId: bin.binId,
          amountX: new BN(Math.floor(amount.toNumber())),
          amountY: new BN(0),
        };
      }
    });
  }
  return [];
}

export function calculateStrategyParameter({
  minBinId,
  maxBinId,
  strategy,
  activeBinId,
  activeBinPrice,
  totalXAmount,
  totalYAmount,
}: {
  minBinId: number;
  maxBinId: number;
  strategy: StrategyType;
  activeBinId: number;
  activeBinPrice: string;
  totalXAmount: BN;
  totalYAmount: BN;
}): StrategyParameters {
  const totalXAmountDecimal = new Decimal(totalXAmount.toString());
  const totalYAmountDecimal = new Decimal(totalYAmount.toString());
  const activeBinPriceDecimal = new Decimal(activeBinPrice);
  const total = totalXAmountDecimal
    .mul(activeBinPriceDecimal)
    .add(totalYAmountDecimal);
  const { aRight, aLeft } = (() => {
    if (strategy === StrategyType.Spot) {
      return {
        aRight: 0,
        aLeft: 0,
      };
    }

    const isYSingleSide = totalXAmount.isZero();
    const isXSingleSide = totalYAmount.isZero();

    const aRight = (() => {
      if (isYSingleSide) return 0;
      if (isXSingleSide) return 2000;

      return Math.floor(
        totalXAmountDecimal
          .mul(activeBinPriceDecimal)
          .div(total)
          .mul(new Decimal(5000))
          .toNumber()
      );
    })();
    const aLeft = (() => {
      if (isYSingleSide) return 2000;
      if (isXSingleSide) return 0;

      return Math.floor(
        totalYAmountDecimal.div(total).mul(new Decimal(5000)).toNumber()
      );
    })();

    return {
      aRight,
      aLeft,
    };
  })();
  const { weightRight, weightLeft } = (() => {
    if (strategy !== StrategyType.Spot) {
      return {
        weightRight: 0,
        weightLeft: 0,
      };
    }
    const binYCount = activeBinId - minBinId;
    const binXCount = maxBinId - activeBinId;
    const bidAmountPerBin = totalYAmountDecimal.div(
      new Decimal(binYCount + 0.5)
    );
    const askAmountPerBin = totalXAmountDecimal.div(
      new Decimal(binXCount + 0.5)
    );

    const weightRight =
      binXCount === 0
        ? new Decimal(1)
        : askAmountPerBin
          .mul(activeBinPriceDecimal)
          .div(total)
          .mul(new Decimal(65535));
    const weightLeft =
      binYCount === 0
        ? new Decimal(1)
        : bidAmountPerBin.div(total).mul(new Decimal(65535));
    return {
      weightRight: Math.floor(weightRight.toNumber()),
      weightLeft: Math.floor(weightLeft.toNumber()),
    };
  })();

  const centerBinId = (() => {
    if (activeBinId > maxBinId && activeBinId < minBinId) {
      return Math.floor(maxBinId + minBinId / 2);
    }

    if (activeBinId > maxBinId) {
      return maxBinId;
    }

    if (activeBinId < minBinId) {
      return minBinId;
    }

    return activeBinId;
  })();

  return {
    strategyType: strategy,
    centerBinId,
    aRight,
    aLeft,
    maxBinId,
    minBinId,
    weightRight,
    weightLeft,
  };
}
