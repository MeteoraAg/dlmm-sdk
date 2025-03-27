import { BN } from "@coral-xyz/anchor";
import {
  BASIS_POINT_MAX,
  MAX_BIN_PER_POSITION,
  SCALE_OFFSET,
} from "../constants";
import Decimal from "decimal.js";
import { ONE, pow } from "./u64xu64_math";
import { DLMM } from "..";
import { getPriceOfBinByBinId } from "./weight";

export enum Rounding {
  Up,
  Down,
}

export function mulShr(x: BN, y: BN, offset: number, rounding: Rounding) {
  const denominator = new BN(1).shln(offset);
  return mulDiv(x, y, denominator, rounding);
}

export function shlDiv(x: BN, y: BN, offset: number, rounding: Rounding) {
  const scale = new BN(1).shln(offset);
  return mulDiv(x, scale, y, rounding);
}

export function mulDiv(x: BN, y: BN, denominator: BN, rounding: Rounding) {
  const { div, mod } = x.mul(y).divmod(denominator);

  if (rounding == Rounding.Up && !mod.isZero()) {
    return div.add(new BN(1));
  }
  return div;
}

export function computeBaseFactorFromFeeBps(binStep: BN, feeBps: BN) {
  const U16_MAX = 65535;
  const computedBaseFactor =
    (feeBps.toNumber() * BASIS_POINT_MAX) / binStep.toNumber();

  // Sanity check
  const computedBaseFactorFloor = Math.floor(computedBaseFactor);
  if (computedBaseFactor != computedBaseFactorFloor) {
    if (computedBaseFactorFloor >= U16_MAX) {
      throw "base factor for the give fee bps overflow u16";
    }

    if (computedBaseFactorFloor == 0) {
      throw "base factor for the give fee bps underflow";
    }

    if (computedBaseFactor % 1 != 0) {
      throw "couldn't compute base factor for the exact fee bps";
    }
  }

  return new BN(computedBaseFactor);
}

export function getQPriceFromId(binId: BN, binStep: BN): BN {
  const bps = binStep.shln(SCALE_OFFSET).div(new BN(BASIS_POINT_MAX));
  const base = ONE.add(bps);
  return pow(base, binId);
}

export function findSwappableMinMaxBinId(binStep: BN) {
  const base = 1 + binStep.toNumber() / BASIS_POINT_MAX;
  const maxQPriceSupported = new Decimal("18446744073709551615");
  const n = maxQPriceSupported.log(10).div(new Decimal(base).log(10)).floor();

  let minBinId = new BN(n.neg().toString());
  let maxBinId = new BN(n.toString());

  let minQPrice = new BN(1);
  let maxQPrice = new BN("340282366920938463463374607431768211455");

  while (true) {
    const qPrice = getQPriceFromId(minBinId, binStep);
    if (qPrice.gt(minQPrice) && !qPrice.isZero()) {
      break;
    } else {
      minBinId = minBinId.add(new BN(1));
    }
  }

  while (true) {
    const qPrice = getQPriceFromId(maxBinId, binStep);
    if (qPrice.lt(maxQPrice) && !qPrice.isZero()) {
      break;
    } else {
      maxBinId = maxBinId.sub(new BN(1));
    }
  }

  return {
    minBinId,
    maxBinId,
  };
}

export function getC(
  amount: BN,
  binStep: number,
  binId: BN,
  baseTokenDecimal: number,
  quoteTokenDecimal: number,
  minPrice: Decimal,
  maxPrice: Decimal,
  k: number
) {
  const currentPricePerLamport = new Decimal(1 + binStep / 10000).pow(
    binId.toNumber()
  );
  const currentPricePerToken = currentPricePerLamport.mul(
    new Decimal(10 ** (baseTokenDecimal - quoteTokenDecimal))
  );
  const priceRange = maxPrice.sub(minPrice);
  const currentPriceDeltaFromMin = currentPricePerToken.sub(
    new Decimal(minPrice)
  );

  const c = new Decimal(amount.toString()).mul(
    currentPriceDeltaFromMin.div(priceRange).pow(k)
  );

  return c.floor();
}

export function distributeAmountToCompressedBinsByRatio(
  compressedBinAmount: Map<number, BN>,
  uncompressedAmount: BN,
  multiplier: BN,
  binCapAmount: BN
) {
  const newCompressedBinAmount = new Map<number, BN>();
  let totalCompressedAmount = new BN(0);

  for (const compressedAmount of compressedBinAmount.values()) {
    totalCompressedAmount = totalCompressedAmount.add(compressedAmount);
  }

  let totalDepositedAmount = new BN(0);

  for (const [binId, compressedAmount] of compressedBinAmount.entries()) {
    const depositAmount = compressedAmount
      .mul(uncompressedAmount)
      .div(totalCompressedAmount);

    let compressedDepositAmount = depositAmount.div(multiplier);

    let newCompressedAmount = compressedAmount.add(compressedDepositAmount);
    if (newCompressedAmount.gt(binCapAmount)) {
      compressedDepositAmount = compressedDepositAmount.sub(
        newCompressedAmount.sub(binCapAmount)
      );
      newCompressedAmount = binCapAmount;
    }
    newCompressedBinAmount.set(binId, newCompressedAmount);

    totalDepositedAmount = totalDepositedAmount.add(
      compressedDepositAmount.mul(multiplier)
    );
  }

  const loss = uncompressedAmount.sub(totalDepositedAmount);

  return {
    newCompressedBinAmount,
    loss,
  };
}

export function getPositionCount(minBinId: BN, maxBinId: BN) {
  const binDelta = maxBinId.sub(minBinId);
  const positionCount = binDelta.div(MAX_BIN_PER_POSITION);
  return positionCount.add(new BN(1));
}

export function compressBinAmount(binAmount: Map<number, BN>, multiplier: BN) {
  const compressedBinAmount = new Map<number, BN>();

  let totalAmount = new BN(0);
  let compressionLoss = new BN(0);

  for (const [binId, amount] of binAmount) {
    totalAmount = totalAmount.add(amount);
    const compressedAmount = amount.div(multiplier);

    compressedBinAmount.set(binId, compressedAmount);
    let loss = amount.sub(compressedAmount.mul(multiplier));
    compressionLoss = compressionLoss.add(loss);
  }

  return {
    compressedBinAmount,
    compressionLoss,
  };
}

export function generateAmountForBinRange(
  amount: BN,
  binStep: number,
  tokenXDecimal: number,
  tokenYDecimal: number,
  minBinId: BN,
  maxBinId: BN,
  k: number
) {
  const toTokenMultiplier = new Decimal(10 ** (tokenXDecimal - tokenYDecimal));
  const minPrice = getPriceOfBinByBinId(minBinId.toNumber(), binStep).mul(
    toTokenMultiplier
  );
  const maxPrice = getPriceOfBinByBinId(maxBinId.toNumber(), binStep).mul(
    toTokenMultiplier
  );
  const binAmounts = new Map<number, BN>();

  for (let i = minBinId.toNumber(); i < maxBinId.toNumber(); i++) {
    const binAmount = generateBinAmount(
      amount,
      binStep,
      new BN(i),
      tokenXDecimal,
      tokenYDecimal,
      minPrice,
      maxPrice,
      k
    );

    binAmounts.set(i, binAmount);
  }

  return binAmounts;
}

export function generateBinAmount(
  amount: BN,
  binStep: number,
  binId: BN,
  tokenXDecimal: number,
  tokenYDecimal: number,
  minPrice: Decimal,
  maxPrice: Decimal,
  k: number
) {
  const c1 = getC(
    amount,
    binStep,
    binId.add(new BN(1)),
    tokenXDecimal,
    tokenYDecimal,
    minPrice,
    maxPrice,
    k
  );

  const c0 = getC(
    amount,
    binStep,
    binId,
    tokenXDecimal,
    tokenYDecimal,
    minPrice,
    maxPrice,
    k
  );

  return new BN(c1.sub(c0).floor().toString());
}
