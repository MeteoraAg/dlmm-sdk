import { BN } from "@coral-xyz/anchor";
import {
  BASIS_POINT_MAX,
  FEE_PRECISION,
  MAX_FEE_RATE,
  SCALE_OFFSET,
} from "../constants";
import { Bin, sParameters, vParameters } from "../types";
import { Rounding, mulShr, shlDiv } from "./math";
import { getOutAmount } from ".";

export function getBaseFee(binStep: number, sParameter: sParameters) {
  return new BN(sParameter.baseFactor).mul(new BN(binStep)).mul(new BN(10));
}

export function getVariableFee(
  binStep: number,
  sParameter: sParameters,
  vParameter: vParameters
) {
  if (sParameter.variableFeeControl > 0) {
    const square_vfa_bin = new BN(vParameter.volatilityAccumulator)
      .mul(new BN(binStep))
      .pow(new BN(2));
    const v_fee = new BN(sParameter.variableFeeControl).mul(square_vfa_bin);

    return v_fee.add(new BN(99_999_999_999)).div(new BN(100_000_000_000));
  }
  return new BN(0);
}

export function getTotalFee(
  binStep: number,
  sParameter: sParameters,
  vParameter: vParameters
) {
  const totalFee = getBaseFee(binStep, sParameter).add(
    getVariableFee(binStep, sParameter, vParameter)
  );
  return totalFee.gt(MAX_FEE_RATE) ? MAX_FEE_RATE : totalFee;
}

export function computeFee(
  binStep: number,
  sParameter: sParameters,
  vParameter: vParameters,
  inAmount: BN
) {
  const totalFee = getTotalFee(binStep, sParameter, vParameter);
  const denominator = FEE_PRECISION.sub(totalFee);

  return inAmount
    .mul(totalFee)
    .add(denominator)
    .sub(new BN(1))
    .div(denominator);
}

export function computeFeeFromAmount(
  binStep: number,
  sParameter: sParameters,
  vParameter: vParameters,
  inAmountWithFees: BN
) {
  const totalFee = getTotalFee(binStep, sParameter, vParameter);
  return inAmountWithFees
    .mul(totalFee)
    .add(FEE_PRECISION.sub(new BN(1)))
    .div(FEE_PRECISION);
}

export function computeProtocolFee(feeAmount: BN, sParameter: sParameters) {
  return feeAmount
    .mul(new BN(sParameter.protocolShare))
    .div(new BN(BASIS_POINT_MAX));
}

export function swapQuoteAtBin(
  bin: Bin,
  binStep: number,
  sParameter: sParameters,
  vParameter: vParameters,
  inAmount: BN,
  swapForY: boolean
): {
  amountIn: BN;
  amountOut: BN;
  fee: BN;
  protocolFee: BN;
} {
  if (swapForY && bin.amountY.isZero()) {
    return {
      amountIn: new BN(0),
      amountOut: new BN(0),
      fee: new BN(0),
      protocolFee: new BN(0),
    };
  }

  if (!swapForY && bin.amountX.isZero()) {
    return {
      amountIn: new BN(0),
      amountOut: new BN(0),
      fee: new BN(0),
      protocolFee: new BN(0),
    };
  }

  let maxAmountOut: BN;
  let maxAmountIn: BN;

  if (swapForY) {
    maxAmountOut = bin.amountY;
    maxAmountIn = shlDiv(bin.amountY, bin.price, SCALE_OFFSET, Rounding.Up);
  } else {
    maxAmountOut = bin.amountX;
    maxAmountIn = mulShr(bin.amountX, bin.price, SCALE_OFFSET, Rounding.Up);
  }

  const maxFee = computeFee(binStep, sParameter, vParameter, maxAmountIn);
  maxAmountIn = maxAmountIn.add(maxFee);

  let amountInWithFees: BN;
  let amountOut: BN;
  let fee: BN;
  let protocolFee: BN;

  if (inAmount.gt(maxAmountIn)) {
    amountInWithFees = maxAmountIn;
    amountOut = maxAmountOut;
    fee = maxFee;
    protocolFee = computeProtocolFee(maxFee, sParameter);
  } else {
    fee = computeFeeFromAmount(binStep, sParameter, vParameter, inAmount);
    const amountInAfterFee = inAmount.sub(fee);
    const computedOutAmount = getOutAmount(bin, amountInAfterFee, swapForY);

    amountOut = computedOutAmount.gt(maxAmountOut)
      ? maxAmountOut
      : computedOutAmount;
    protocolFee = computeProtocolFee(fee, sParameter);
    amountInWithFees = inAmount;
  }

  return {
    amountIn: amountInWithFees,
    amountOut,
    fee,
    protocolFee,
  };
}
