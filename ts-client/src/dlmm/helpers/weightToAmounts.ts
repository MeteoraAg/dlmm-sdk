import { BN } from "@coral-xyz/anchor";
import { Mint } from "@solana/spl-token";
import Decimal from "decimal.js";
import { Clock } from "../types";
import {
  calculateTransferFeeExcludedAmount,
  calculateTransferFeeIncludedAmount,
} from "./token_2022";
import { getPriceOfBinByBinId } from "./weight";

/**
 * Distribute totalAmount to all bid side bins according to given distributions.
 * @param activeId active bin id
 * @param totalAmount total amount of token Y to be distributed
 * @param distributions weight distribution of each bin
 * @param mintY mint of token Y, get from DLMM instance
 * @param clock clock of the program, for calculating transfer fee, get from DLMM instance
 * @returns array of {binId, amount} where amount is the amount of token Y in each bin
 */
export function toAmountBidSide(
  activeId: number,
  totalAmount: BN,
  distributions: { binId: number; weight: number }[],
  mintY: Mint,
  clock: Clock
): {
  binId: number;
  amount: BN;
}[] {
  totalAmount = calculateTransferFeeExcludedAmount(
    totalAmount,
    mintY,
    clock.epoch.toNumber()
  ).amount;

  // get sum of weight
  const totalWeight = distributions.reduce(function (sum, el) {
    return el.binId > activeId ? sum : sum.add(el.weight); // skip all ask side
  }, new Decimal(0));

  if (totalWeight.cmp(new Decimal(0)) != 1) {
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
        amount: new BN(
          new Decimal(totalAmount.toString())
            .mul(new Decimal(bin.weight).div(totalWeight))
            .floor()
            .toString()
        ),
      };
    }
  });
}

/**
 * Distribute totalAmount to all ask side bins according to given distributions.
 * @param activeId active bin id
 * @param totalAmount total amount of token Y to be distributed
 * @param distributions weight distribution of each bin
 * @param mintX mint of token X, get from DLMM instance
 * @param clock clock of the program, for calculating transfer fee, get from DLMM instance
 * @returns array of {binId, amount} where amount is the amount of token X in each bin
 */
export function toAmountAskSide(
  activeId: number,
  binStep: number,
  totalAmount: BN,
  distributions: { binId: number; weight: number }[],
  mintX: Mint,
  clock: Clock
): {
  binId: number;
  amount: BN;
}[] {
  totalAmount = calculateTransferFeeExcludedAmount(
    totalAmount,
    mintX,
    clock.epoch.toNumber()
  ).amount;

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

  if (totalWeight.cmp(new Decimal(0)) != 1) {
    throw Error("Invalid parameteres");
  }

  return distributions.map((bin) => {
    if (bin.binId < activeId) {
      return {
        binId: bin.binId,
        amount: new BN(0),
      };
    } else {
      const price = getPriceOfBinByBinId(bin.binId, binStep);
      const weightPerPrice = new Decimal(bin.weight).div(price);
      return {
        binId: bin.binId,
        amount: new BN(
          new Decimal(totalAmount.toString())
            .mul(weightPerPrice)
            .div(totalWeight)
            .floor()
            .toString()
        ),
      };
    }
  });
}

/**
 * Distributes the given amounts of tokens X and Y to both bid and ask side bins
 * based on the provided weight distributions.
 *
 * @param activeId - The id of the active bin.
 * @param binStep - The step interval between bin ids.
 * @param amountX - Total amount of token X to distribute.
 * @param amountY - Total amount of token Y to distribute.
 * @param amountXInActiveBin - Amount of token X already in the active bin.
 * @param amountYInActiveBin - Amount of token Y already in the active bin.
 * @param distributions - Array of bins with their respective weight distributions.
 * @param mintX - Mint information for token X. Get from DLMM instance.
 * @param mintY - Mint information for token Y. Get from DLMM instance.
 * @param clock - Clock instance. Get from DLMM instance.
 * @returns An array of objects containing binId, amountX, and amountY for each bin.
 */

export function toAmountBothSide(
  activeId: number,
  binStep: number,
  amountX: BN,
  amountY: BN,
  amountXInActiveBin: BN,
  amountYInActiveBin: BN,
  distributions: { binId: number; weight: number }[],
  mintX: Mint,
  mintY: Mint,
  clock: Clock
): {
  binId: number;
  amountX: BN;
  amountY: BN;
}[] {
  // only bid side
  if (activeId > distributions[distributions.length - 1].binId) {
    let amounts = toAmountBidSide(
      activeId,
      amountY,
      distributions,
      mintY,
      clock
    );
    return amounts.map((bin) => {
      return {
        binId: bin.binId,
        amountX: new BN(0),
        amountY: bin.amount,
      };
    });
  }
  // only ask side
  if (activeId < distributions[0].binId) {
    let amounts = toAmountAskSide(
      activeId,
      binStep,
      amountX,
      distributions,
      mintX,
      clock
    );
    return amounts.map((bin) => {
      return {
        binId: bin.binId,
        amountX: bin.amount,
        amountY: new BN(0),
      };
    });
  }

  amountX = calculateTransferFeeIncludedAmount(
    amountX,
    mintX,
    clock.epoch.toNumber()
  ).amount;

  amountY = calculateTransferFeeIncludedAmount(
    amountY,
    mintY,
    clock.epoch.toNumber()
  ).amount;

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
      let amountXInActiveBinDec = new Decimal(amountXInActiveBin.toString());
      let amountYInActiveBinDec = new Decimal(amountYInActiveBin.toString());

      if (!amountXInActiveBin.isZero()) {
        wx0 = new Decimal(activeBin.weight).div(
          p0.add(amountYInActiveBinDec.div(amountXInActiveBinDec))
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
    const kx = new Decimal(amountX.toString()).div(totalWeightX);
    const ky = new Decimal(amountY.toString()).div(totalWeightY);
    let k = kx.lessThan(ky) ? kx : ky;
    return distributions.map((bin) => {
      if (bin.binId < activeId) {
        const amount = k.mul(new Decimal(bin.weight));
        return {
          binId: bin.binId,
          amountX: new BN(0),
          amountY: new BN(amount.floor().toString()),
        };
      }
      if (bin.binId > activeId) {
        const price = getPriceOfBinByBinId(bin.binId, binStep);
        const weighPerPrice = new Decimal(bin.weight).div(price);
        const amount = k.mul(weighPerPrice);
        return {
          binId: bin.binId,
          amountX: new BN(amount.floor().toString()),
          amountY: new BN(0),
        };
      }

      const amountXActiveBin = k.mul(wx0);
      const amountYActiveBin = k.mul(wy0);
      return {
        binId: bin.binId,
        amountX: new BN(amountXActiveBin.floor().toString()),
        amountY: new BN(amountYActiveBin.floor().toString()),
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

    let kx = new Decimal(amountX.toString()).div(totalWeightX);
    let ky = new Decimal(amountY.toString()).div(totalWeightY);
    let k = kx.lessThan(ky) ? kx : ky;

    return distributions.map((bin) => {
      if (bin.binId < activeId) {
        const amount = k.mul(new Decimal(bin.weight));
        return {
          binId: bin.binId,
          amountX: new BN(0),
          amountY: new BN(amount.floor().toString()),
        };
      } else {
        let price = getPriceOfBinByBinId(bin.binId, binStep);
        let weighPerPrice = new Decimal(bin.weight).div(price);
        const amount = k.mul(weighPerPrice);
        return {
          binId: bin.binId,
          amountX: new BN(amount.floor().toString()),
          amountY: new BN(0),
        };
      }
    });
  }
}

export function autoFillYByWeight(
  activeId: number,
  binStep: number,
  amountX: BN,
  amountXInActiveBin: BN,
  amountYInActiveBin: BN,
  distributions: { binId: number; weight: number }[]
): BN {
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
      let amountXInActiveBinDec = new Decimal(amountXInActiveBin.toString());
      let amountYInActiveBinDec = new Decimal(amountYInActiveBin.toString());

      if (!amountXInActiveBin.isZero()) {
        wx0 = new Decimal(activeBin.weight).div(
          p0.add(amountYInActiveBinDec.div(amountXInActiveBinDec))
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
        const price = getPriceOfBinByBinId(element.binId, binStep);
        const weighPerPrice = new Decimal(element.weight).div(price);
        totalWeightX = totalWeightX.add(weighPerPrice);
      }
    });
    const kx = totalWeightX.isZero()
      ? new Decimal(1)
      : new Decimal(amountX.toString()).div(totalWeightX);
    const amountY = kx.mul(totalWeightY);
    return new BN(amountY.floor().toString());
  } else {
    let totalWeightX = new Decimal(0);
    let totalWeightY = new Decimal(0);
    distributions.forEach((element) => {
      if (element.binId < activeId) {
        totalWeightY = totalWeightY.add(new Decimal(element.weight));
      } else {
        const price = getPriceOfBinByBinId(element.binId, binStep);
        const weighPerPrice = new Decimal(element.weight).div(price);
        totalWeightX = totalWeightX.add(weighPerPrice);
      }
    });
    const kx = totalWeightX.isZero()
      ? new Decimal(1)
      : new Decimal(amountX.toString()).div(totalWeightX);
    const amountY = kx.mul(totalWeightY);
    return new BN(amountY.floor().toString());
  }
}

export function autoFillXByWeight(
  activeId: number,
  binStep: number,
  amountY: BN,
  amountXInActiveBin: BN,
  amountYInActiveBin: BN,
  distributions: { binId: number; weight: number }[]
): BN {
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
      let amountXInActiveBinDec = new Decimal(amountXInActiveBin.toString());
      let amountYInActiveBinDec = new Decimal(amountYInActiveBin.toString());

      if (!amountXInActiveBin.isZero()) {
        wx0 = new Decimal(activeBin.weight).div(
          p0.add(amountYInActiveBinDec.div(amountXInActiveBinDec))
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
        const price = getPriceOfBinByBinId(element.binId, binStep);
        const weighPerPrice = new Decimal(element.weight).div(price);
        totalWeightX = totalWeightX.add(weighPerPrice);
      }
    });
    const ky = totalWeightY.isZero()
      ? new Decimal(1)
      : new Decimal(amountY.toString()).div(totalWeightY);
    const amountX = ky.mul(totalWeightX);
    return new BN(amountX.floor().toString());
  } else {
    let totalWeightX = new Decimal(0);
    let totalWeightY = new Decimal(0);
    distributions.forEach((element) => {
      if (element.binId < activeId) {
        totalWeightY = totalWeightY.add(new Decimal(element.weight));
      } else {
        const price = getPriceOfBinByBinId(element.binId, binStep);
        const weighPerPrice = new Decimal(element.weight).div(price);
        totalWeightX = totalWeightX.add(weighPerPrice);
      }
    });
    const ky = totalWeightY.isZero()
      ? new Decimal(1)
      : new Decimal(amountY.toString()).div(totalWeightY);
    const amountX = ky.mul(totalWeightX);
    return new BN(amountX.floor().toString());
  }
}
