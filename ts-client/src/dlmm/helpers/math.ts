import { BN } from "@coral-xyz/anchor";
import { BASIS_POINT_MAX, SCALE_OFFSET } from "../constants";
import Decimal from "decimal.js";
import { ONE, pow } from "./u64xu64_math";

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

export function getQPriceFromId(binId: BN, binStep: BN) {
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
    if (qPrice.gt(minQPrice)) {
      break;
    } else {
      minBinId = minBinId.add(new BN(1));
    }
  }

  while (true) {
    const qPrice = getQPriceFromId(maxBinId, binStep);
    if (qPrice.lt(maxQPrice)) {
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
