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
  let precision = 1_000_000_000_000;
  let quoteDistributions = distributions.map((bin) => {
    let price = new BN(
      getPriceOfBinByBinId(bin.binId, binStep).mul(precision).toNumber()
    );
    let quoteValue = amountX
      .mul(new BN(bin.xAmountBpsOfTotal))
      .mul(new BN(price))
      .div(new BN(BASIS_POINT_MAX))
      .div(new BN(precision));
    let quoteAmount = quoteValue.add(
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

export function fromStrategyParamstoWeightDistribution(
  activeId: number,
  strategyParameters: StrategyParameters
): { binId: number; weight: number }[] {
  const {
    maxBinId,
    minBinId,
    strategyType,
    aAsk,
    aBid,
    aActiveBin,
    centerBinId,
    weightAsk,
    weightBid,
    weightActiveBin,
  } = strategyParameters;
  // validate firstly
  if (maxBinId < minBinId) {
    throw new Error("maxBinId cannot be smaller than minBinId");
  }
  let distributionWeights: Array<{ binId: number; weight: number }> = [];
  switch (strategyType) {
    case StrategyType.Spot: {
      for (let i = minBinId; i <= maxBinId; i++) {
        if (i < activeId) {
          distributionWeights.push({
            binId: i,
            weight: weightBid,
          });
        }
        if (i > activeId) {
          distributionWeights.push({
            binId: i,
            weight: weightAsk,
          });
        }
        if (i == activeId) {
          distributionWeights.push({
            binId: i,
            weight: weightActiveBin,
          });
        }
      }
      break;
    }
    case StrategyType.Curve: {
      if (aAsk >= 0 || aAsk < -32768) {
        throw new Error("aAsk is out of range");
      }
      if (aBid >= 0 || aBid < -32768) {
        throw new Error("aBid is out of range");
      }
      const midBinId = centerBinId;
      const binWidth = maxBinId - midBinId;
      const b = binWidth * binWidth;
      for (let i = minBinId; i <= maxBinId; i++) {
        let binDelta = i - midBinId;
        let a = aActiveBin;
        if (i < activeId) {
          a = aBid;
        } else if (i > activeId) {
          a = aAsk;
        }
        distributionWeights.push({
          binId: i,
          weight: Math.max(
            Math.floor(a * binDelta * binDelta - a * b) / 15000,
            0
          ),
        });
      }
      break;
    }
    case StrategyType.BidAsk: {
      if (aAsk <= 0 || aAsk > 32768) {
        throw new Error("aAsk is out of range");
      }
      if (aBid <= 0 || aBid > 32768) {
        throw new Error("aBid is out of range");
      }
      const midBinId = centerBinId;
      for (let i = minBinId; i <= maxBinId; i++) {
        let binDelta = i - midBinId;
        let a = aActiveBin;
        if (i < activeId) {
          a = aBid;
        } else if (i > activeId) {
          a = aAsk;
        }
        distributionWeights.push({
          binId: i,
          weight: Math.max(Math.floor(a * binDelta * binDelta) / 15000, 0),
        });
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
    aAsk,
    aBid,
    aActiveBin,
    centerBinId,
    weightAsk,
    weightBid,
    weightActiveBin,
  } = strategyParameters;
  switch (strategyType) {
    case StrategyType.Spot: {
      const data = Buffer.alloc(spotParameter.span);
      spotParameter.encode(
        {
          weightAsk,
          weightBid,
          weightActiveBin,
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
          aAsk,
          aBid,
          aActiveBin,
          centerBinId,
        },
        data
      );
      let parameters = Buffer.concat([
        data,
        Buffer.from(new Array<number>(54).fill(0)),
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
          aAsk,
          aBid,
          aActiveBin,
          centerBinId,
        },
        data
      );
      let parameters = Buffer.concat([
        data,
        Buffer.from(new Array<number>(54).fill(0)),
      ]);
      return {
        minBinId,
        maxBinId,
        strategyType: { bidAsk: {} },
        parameteres: parameters.toJSON().data,
      };
  }
}
