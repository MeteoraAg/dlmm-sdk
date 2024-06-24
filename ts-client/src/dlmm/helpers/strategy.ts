import { BN } from "@coral-xyz/anchor";
import { StrategyType, StrategyParameters } from "../types";
import {
  autoFillXByWeight,
  autoFillYByWeight,
  toAmountAskSide,
  toAmountBidSide,
  toAmountBothSide,
} from "./weightToAmounts";
import Decimal from "decimal.js";
const DEFAULT_MAX_WEIGHT = 2000;
const DEFAULT_MIN_WEIGHT = 200;

function toWeightSpotBalanced(
  minBinId: number,
  maxBinId: number
): {
  binId: number;
  weight: number;
}[] {
  let distributions = [];
  for (let i = minBinId; i <= maxBinId; i++) {
    distributions.push({
      binId: i,
      weight: 1,
    });
  }
  return distributions;
}

function toWeightDecendingOrder(
  minBinId: number,
  maxBinId: number
): {
  binId: number;
  weight: number;
}[] {
  let distributions = [];
  for (let i = minBinId; i <= maxBinId; i++) {
    distributions.push({
      binId: i,
      weight: maxBinId - i + 1,
    });
  }
  return distributions;
}

function toWeightAscendingOrder(
  minBinId: number,
  maxBinId: number
): {
  binId: number;
  weight: number;
}[] {
  let distributions = [];
  for (let i = minBinId; i <= maxBinId; i++) {
    distributions.push({
      binId: i,
      weight: i - minBinId + 1,
    });
  }
  return distributions;
}

function toWeightCurve(
  minBinId: number,
  maxBinId: number,
  activeId: number
): {
  binId: number;
  weight: number;
}[] {
  if (activeId < minBinId || activeId > maxBinId) {
    throw "Invalid strategy params";
  }
  let maxWeight = DEFAULT_MAX_WEIGHT;
  let minWeight = DEFAULT_MIN_WEIGHT;

  let diffWeight = maxWeight - minWeight;
  let diffMinWeight =
    activeId > minBinId ? Math.floor(diffWeight / (activeId - minBinId)) : 0;
  let diffMaxWeight =
    maxBinId > activeId ? Math.floor(diffWeight / (maxBinId - activeId)) : 0;

  let distributions = [];
  for (let i = minBinId; i <= maxBinId; i++) {
    if (i < activeId) {
      distributions.push({
        binId: i,
        weight: maxWeight - (activeId - i) * diffMinWeight,
      });
    } else if (i > activeId) {
      distributions.push({
        binId: i,
        weight: maxWeight - (i - activeId) * diffMaxWeight,
      });
    } else {
      distributions.push({
        binId: i,
        weight: maxWeight,
      });
    }
  }
  return distributions;
}

function toWeightBidAsk(
  minBinId: number,
  maxBinId: number,
  activeId: number
): {
  binId: number;
  weight: number;
}[] {
  if (activeId < minBinId || activeId > maxBinId) {
    throw "Invalid strategy params";
  }
  let maxWeight = DEFAULT_MAX_WEIGHT;
  let minWeight = DEFAULT_MIN_WEIGHT;

  let diffWeight = maxWeight - minWeight;
  let diffMinWeight =
    activeId > minBinId ? Math.floor(diffWeight / (activeId - minBinId)) : 0;
  let diffMaxWeight =
    maxBinId > activeId ? Math.floor(diffWeight / (maxBinId - activeId)) : 0;

  let distributions = [];
  for (let i = minBinId; i <= maxBinId; i++) {
    if (i < activeId) {
      distributions.push({
        binId: i,
        weight: minWeight + (activeId - i) * diffMinWeight,
      });
    } else if (i > activeId) {
      distributions.push({
        binId: i,
        weight: minWeight + (i - activeId) * diffMaxWeight,
      });
    } else {
      distributions.push({
        binId: i,
        weight: minWeight,
      });
    }
  }
  return distributions;
}

export function toAmountsOneSideByStrategy(
  activeId: number,
  binStep: number,
  minBinId: number,
  maxBinId: number,
  amount: BN,
  strategyType: StrategyType,
  depositForY: boolean
): {
  binId: number;
  amount: BN;
}[] {
  let weights = [];
  switch (strategyType) {
    case StrategyType.SpotBalanced:
    case StrategyType.CurveBalanced:
    case StrategyType.BidAskBalanced:
    case StrategyType.SpotImBalanced:
    case StrategyType.CurveImBalanced:
    case StrategyType.BidAskImBalanced: {
      throw "Invalid Strategy Parameters";
    }
    case StrategyType.SpotOneSide: {
      weights = toWeightSpotBalanced(minBinId, maxBinId);
      break;
    }
    case StrategyType.CurveOneSide: {
      if (depositForY) {
        weights = toWeightAscendingOrder(minBinId, maxBinId);
      } else {
        weights = toWeightDecendingOrder(minBinId, maxBinId);
      }
      break;
    }
    case StrategyType.BidAskOneSide: {
      if (depositForY) {
        weights = toWeightDecendingOrder(minBinId, maxBinId);
      } else {
        weights = toWeightAscendingOrder(minBinId, maxBinId);
      }
      break;
    }
  }
  if (depositForY) {
    return toAmountBidSide(activeId, amount, weights);
  } else {
    return toAmountAskSide(activeId, binStep, amount, weights);
  }
}

export function toAmountsBothSideByStrategy(
  activeId: number,
  binStep: number,
  minBinId: number,
  maxBinId: number,
  amountX: BN,
  amountY: BN,
  amountXInActiveBin: BN,
  amountYInActiveBin: BN,
  strategyType: StrategyType
): {
  binId: number;
  amountX: BN;
  amountY: BN;
}[] {
  const isSingleSideX = amountY.isZero();
  switch (strategyType) {
    case StrategyType.SpotOneSide:
    case StrategyType.CurveOneSide:
    case StrategyType.BidAskOneSide: {
      throw "Invalid Strategy Parameters";
    }
    case StrategyType.SpotImBalanced: {
      if (activeId < minBinId || activeId > maxBinId) {
        const weights = toWeightSpotBalanced(minBinId, maxBinId);
        return toAmountBothSide(
          activeId,
          binStep,
          amountX,
          amountY,
          amountXInActiveBin,
          amountYInActiveBin,
          weights
        );
      }
      const amountsInBin = [];
      if (!isSingleSideX) {
        if (minBinId <= activeId) {
          const weights = toWeightSpotBalanced(minBinId, activeId);
          const amounts = toAmountBidSide(activeId, amountY, weights);

          for (let bin of amounts) {
            amountsInBin.push({
              binId: bin.binId,
              amountX: new BN(0),
              amountY: bin.amount,
            });
          }
        }
        if (activeId < maxBinId) {
          const weights = toWeightSpotBalanced(activeId + 1, maxBinId);
          const amounts = toAmountAskSide(activeId, binStep, amountX, weights);
          for (let bin of amounts) {
            amountsInBin.push({
              binId: bin.binId,
              amountX: bin.amount,
              amountY: new BN(0),
            });
          }
        }
      } else {
        if (minBinId < activeId) {
          const weights = toWeightSpotBalanced(minBinId, activeId - 1);
          const amountsIntoBidSide = toAmountBidSide(
            activeId,
            amountY,
            weights
          );
          for (let bin of amountsIntoBidSide) {
            amountsInBin.push({
              binId: bin.binId,
              amountX: new BN(0),
              amountY: bin.amount,
            });
          }
        }
        if (activeId <= maxBinId) {
          const weights = toWeightSpotBalanced(activeId, maxBinId);
          const amountsIntoAskSide = toAmountAskSide(
            activeId,
            binStep,
            amountX,
            weights
          );
          for (let bin of amountsIntoAskSide) {
            amountsInBin.push({
              binId: bin.binId,
              amountX: bin.amount,
              amountY: new BN(0),
            });
          }
        }
      }
      return amountsInBin;
    }
    case StrategyType.CurveImBalanced: {
      // ask side
      if (activeId < minBinId) {
        let weights = toWeightDecendingOrder(minBinId, maxBinId);
        return toAmountBothSide(
          activeId,
          binStep,
          amountX,
          amountY,
          amountXInActiveBin,
          amountYInActiveBin,
          weights
        );
      }
      // bid side
      if (activeId > maxBinId) {
        const weights = toWeightAscendingOrder(minBinId, maxBinId);
        return toAmountBothSide(
          activeId,
          binStep,
          amountX,
          amountY,
          amountXInActiveBin,
          amountYInActiveBin,
          weights
        );
      }
      const amountsInBin = [];
      if (!isSingleSideX) {
        if (minBinId <= activeId) {
          const weights = toWeightAscendingOrder(minBinId, activeId);
          const amounts = toAmountBidSide(activeId, amountY, weights);

          for (let bin of amounts) {
            amountsInBin.push({
              binId: bin.binId,
              amountX: new BN(0),
              amountY: bin.amount,
            });
          }
        }
        if (activeId < maxBinId) {
          const weights = toWeightDecendingOrder(activeId + 1, maxBinId);
          const amounts = toAmountAskSide(activeId, binStep, amountX, weights);
          for (let bin of amounts) {
            amountsInBin.push({
              binId: bin.binId,
              amountX: bin.amount,
              amountY: new BN(0),
            });
          }
        }
      } else {
        if (minBinId < activeId) {
          const weights = toWeightAscendingOrder(minBinId, activeId - 1);
          const amountsIntoBidSide = toAmountBidSide(
            activeId,
            amountY,
            weights
          );
          for (let bin of amountsIntoBidSide) {
            amountsInBin.push({
              binId: bin.binId,
              amountX: new BN(0),
              amountY: bin.amount,
            });
          }
        }
        if (activeId <= maxBinId) {
          const weights = toWeightDecendingOrder(activeId, maxBinId);
          const amountsIntoAskSide = toAmountAskSide(
            activeId,
            binStep,
            amountX,
            weights
          );
          for (let bin of amountsIntoAskSide) {
            amountsInBin.push({
              binId: bin.binId,
              amountX: bin.amount,
              amountY: new BN(0),
            });
          }
        }
      }
      return amountsInBin;
    }
    case StrategyType.BidAskImBalanced: {
      // ask side
      if (activeId < minBinId) {
        const weights = toWeightAscendingOrder(minBinId, maxBinId);
        return toAmountBothSide(
          activeId,
          binStep,
          amountX,
          amountY,
          amountXInActiveBin,
          amountYInActiveBin,
          weights
        );
      }
      // bid side
      if (activeId > maxBinId) {
        const weights = toWeightDecendingOrder(minBinId, maxBinId);
        return toAmountBothSide(
          activeId,
          binStep,
          amountX,
          amountY,
          amountXInActiveBin,
          amountYInActiveBin,
          weights
        );
      }
      const amountsInBin = [];
      if (!isSingleSideX) {
        if (minBinId <= activeId) {
          const weights = toWeightDecendingOrder(minBinId, activeId);
          const amounts = toAmountBidSide(activeId, amountY, weights);

          for (let bin of amounts) {
            amountsInBin.push({
              binId: bin.binId,
              amountX: new BN(0),
              amountY: bin.amount,
            });
          }
        }
        if (activeId < maxBinId) {
          const weights = toWeightAscendingOrder(activeId + 1, maxBinId);
          const amounts = toAmountAskSide(activeId, binStep, amountX, weights);
          for (let bin of amounts) {
            amountsInBin.push({
              binId: bin.binId,
              amountX: bin.amount,
              amountY: new BN(0),
            });
          }
        }
      } else {
        if (minBinId < activeId) {
          const weights = toWeightDecendingOrder(minBinId, activeId - 1);
          const amountsIntoBidSide = toAmountBidSide(
            activeId,
            amountY,
            weights
          );
          for (let bin of amountsIntoBidSide) {
            amountsInBin.push({
              binId: bin.binId,
              amountX: new BN(0),
              amountY: bin.amount,
            });
          }
        }
        if (activeId <= maxBinId) {
          const weights = toWeightAscendingOrder(activeId, maxBinId);
          const amountsIntoAskSide = toAmountAskSide(
            activeId,
            binStep,
            amountX,
            weights
          );
          for (let bin of amountsIntoAskSide) {
            amountsInBin.push({
              binId: bin.binId,
              amountX: bin.amount,
              amountY: new BN(0),
            });
          }
        }
      }
      return amountsInBin;
    }
    case StrategyType.SpotBalanced: {
      let weights = toWeightSpotBalanced(minBinId, maxBinId);
      return toAmountBothSide(
        activeId,
        binStep,
        amountX,
        amountY,
        amountXInActiveBin,
        amountYInActiveBin,
        weights
      );
    }
    case StrategyType.CurveBalanced: {
      let weights = toWeightCurve(minBinId, maxBinId, activeId);
      return toAmountBothSide(
        activeId,
        binStep,
        amountX,
        amountY,
        amountXInActiveBin,
        amountYInActiveBin,
        weights
      );
    }
    case StrategyType.BidAskBalanced: {
      let weights = toWeightBidAsk(minBinId, maxBinId, activeId);
      return toAmountBothSide(
        activeId,
        binStep,
        amountX,
        amountY,
        amountXInActiveBin,
        amountYInActiveBin,
        weights
      );
    }
  }
}

// only apply for
export function autoFillYByStrategy(
  activeId: number,
  binStep: number,
  amountX: BN,
  amountXInActiveBin: BN,
  amountYInActiveBin: BN,
  minBinId: number,
  maxBinId: number,
  strategyType: StrategyType
): BN {
  switch (strategyType) {
    case StrategyType.SpotOneSide:
    case StrategyType.CurveOneSide:
    case StrategyType.BidAskOneSide:

    case StrategyType.SpotImBalanced:
    case StrategyType.CurveImBalanced:
    case StrategyType.BidAskImBalanced: {
      throw "Invalid Strategy Parameters";
    }
    case StrategyType.SpotBalanced: {
      let weights = toWeightSpotBalanced(minBinId, maxBinId);
      return autoFillYByWeight(
        activeId,
        binStep,
        amountX,
        amountXInActiveBin,
        amountYInActiveBin,
        weights
      );
    }
    case StrategyType.CurveBalanced: {
      let weights = toWeightCurve(minBinId, maxBinId, activeId);
      return autoFillYByWeight(
        activeId,
        binStep,
        amountX,
        amountXInActiveBin,
        amountYInActiveBin,
        weights
      );
    }
    case StrategyType.BidAskBalanced: {
      let weights = toWeightBidAsk(minBinId, maxBinId, activeId);
      return autoFillYByWeight(
        activeId,
        binStep,
        amountX,
        amountXInActiveBin,
        amountYInActiveBin,
        weights
      );
    }
  }
}

// only apply for balanced deposit
export function autoFillXByStrategy(
  activeId: number,
  binStep: number,
  amountY: BN,
  amountXInActiveBin: BN,
  amountYInActiveBin: BN,
  minBinId: number,
  maxBinId: number,
  strategyType: StrategyType
): BN {
  switch (strategyType) {
    case StrategyType.SpotOneSide:
    case StrategyType.CurveOneSide:
    case StrategyType.BidAskOneSide:

    case StrategyType.SpotImBalanced:
    case StrategyType.CurveImBalanced:
    case StrategyType.BidAskImBalanced: {
      throw "Invalid Strategy Parameters";
    }
    case StrategyType.SpotBalanced: {
      let weights = toWeightSpotBalanced(minBinId, maxBinId);
      return autoFillXByWeight(
        activeId,
        binStep,
        amountY,
        amountXInActiveBin,
        amountYInActiveBin,
        weights
      );
    }
    case StrategyType.CurveBalanced: {
      let weights = toWeightCurve(minBinId, maxBinId, activeId);
      return autoFillXByWeight(
        activeId,
        binStep,
        amountY,
        amountXInActiveBin,
        amountYInActiveBin,
        weights
      );
    }
    case StrategyType.BidAskBalanced: {
      let weights = toWeightBidAsk(minBinId, maxBinId, activeId);
      return autoFillXByWeight(
        activeId,
        binStep,
        amountY,
        amountXInActiveBin,
        amountYInActiveBin,
        weights
      );
    }
  }
}

// this this function to convert correct type for program
export function toStrategyParameters({
  maxBinId,
  minBinId,
  strategyType,
  singleSidedX,
}: StrategyParameters) {
  const parameters = [singleSidedX ? 1 : 0, ...new Array<number>(63).fill(0)];
  switch (strategyType) {
    case StrategyType.SpotOneSide: {
      return {
        minBinId,
        maxBinId,
        strategyType: { spotOneSide: {} },
        parameteres: Buffer.from(parameters).toJSON().data,
      };
    }
    case StrategyType.CurveOneSide: {
      return {
        minBinId,
        maxBinId,
        strategyType: { curveOneSide: {} },
        parameteres: Buffer.from(parameters).toJSON().data,
      };
    }
    case StrategyType.BidAskOneSide: {
      return {
        minBinId,
        maxBinId,
        strategyType: { bidAskOneSide: {} },
        parameteres: Buffer.from(parameters).toJSON().data,
      };
    }
    case StrategyType.SpotBalanced: {
      return {
        minBinId,
        maxBinId,
        strategyType: { spotBalanced: {} },
        parameteres: Buffer.from(parameters).toJSON().data,
      };
    }
    case StrategyType.CurveBalanced: {
      return {
        minBinId,
        maxBinId,
        strategyType: { curveBalanced: {} },
        parameteres: Buffer.from(parameters).toJSON().data,
      };
    }
    case StrategyType.BidAskBalanced: {
      return {
        minBinId,
        maxBinId,
        strategyType: { bidAskBalanced: {} },
        parameteres: Buffer.from(parameters).toJSON().data,
      };
    }

    case StrategyType.SpotImBalanced: {
      return {
        minBinId,
        maxBinId,
        strategyType: { spotImBalanced: {} },
        parameteres: Buffer.from(parameters).toJSON().data,
      };
    }
    case StrategyType.CurveImBalanced: {
      return {
        minBinId,
        maxBinId,
        strategyType: { curveImBalanced: {} },
        parameteres: Buffer.from(parameters).toJSON().data,
      };
    }
    case StrategyType.BidAskImBalanced: {
      return {
        minBinId,
        maxBinId,
        strategyType: { bidAskImBalanced: {} },
        parameteres: Buffer.from(parameters).toJSON().data,
      };
    }
  }
}
