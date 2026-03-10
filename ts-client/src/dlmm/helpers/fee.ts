import { BN } from "@coral-xyz/anchor";
import {
  BASIS_POINT_MAX,
  FEE_PRECISION,
  LIMIT_ORDER_FEE_SHARE,
  MAX_FEE_RATE,
} from "../constants";
import { sParameters, vParameters } from "../types";

export function getBaseFee(binStep: number, sParameter: sParameters) {
  return new BN(sParameter.baseFactor)
    .mul(new BN(binStep))
    .mul(new BN(10))
    .mul(new BN(10).pow(new BN(sParameter.baseFeePowerFactor)));
}

export function getVariableFee(
  binStep: number,
  sParameter: sParameters,
  vParameter: vParameters,
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
  vParameter: vParameters,
) {
  const totalFee = getBaseFee(binStep, sParameter).add(
    getVariableFee(binStep, sParameter, vParameter),
  );
  return totalFee.gt(MAX_FEE_RATE) ? MAX_FEE_RATE : totalFee;
}

export function computeFee(
  binStep: number,
  sParameter: sParameters,
  vParameter: vParameters,
  inAmount: BN,
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
  inAmountWithFees: BN,
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

export function getExcludedFeeAmount(
  includedFeeAmount: BN,
  tradeFeeNumerator: BN,
): {
  excludedFeeAmount: BN;
  fee: BN;
} {
  const tradingFee = includedFeeAmount
    .mul(tradeFeeNumerator)
    .add(FEE_PRECISION.sub(new BN(1)))
    .div(FEE_PRECISION);
  const excludedFeeAmount = includedFeeAmount.sub(tradingFee);
  return {
    excludedFeeAmount,
    fee: tradingFee,
  };
}

export function getIncludedFeeAmount(
  excludedFeeAmount: BN,
  tradeFeeNumerator: BN,
): {
  includedFeeAmount: BN;
  fee: BN;
} {
  const denominator = FEE_PRECISION.sub(tradeFeeNumerator);

  const includedFeeAmount = excludedFeeAmount
    .mul(FEE_PRECISION)
    .add(denominator.sub(new BN(1)))
    .div(denominator);

  const fee = includedFeeAmount.sub(excludedFeeAmount);
  return {
    includedFeeAmount,
    fee,
  };
}

export function splitFee(
  tradingFee: BN,
  protocolShare: BN,
  mmAmountIn: BN,
  totalAmountIn: BN,
) {
  const mmFee = tradingFee
    .mul(mmAmountIn)
    .add(totalAmountIn.sub(new BN(1)))
    .div(totalAmountIn);

  const totalLoFee = tradingFee.sub(mmFee);

  const loFee = totalLoFee
    .mul(LIMIT_ORDER_FEE_SHARE)
    .div(new BN(BASIS_POINT_MAX));

  const loProtocolFee = totalLoFee.sub(loFee);
  const mmProtocolFee = mmFee.mul(protocolShare).div(new BN(BASIS_POINT_MAX));

  const totalProtocolFee = loProtocolFee.add(mmProtocolFee);
  const totalUserFee = tradingFee.sub(totalProtocolFee);

  return {
    fee: totalUserFee,
    protocolFee: totalProtocolFee,
  };
}
