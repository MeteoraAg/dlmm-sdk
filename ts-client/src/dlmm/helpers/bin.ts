import BN from "bn.js";
import { mulShr, Rounding, shlDiv } from "./math";
import {
  Bin,
  getExcludedFeeAmount,
  getIncludedFeeAmount,
  getTotalFee,
  SCALE_OFFSET,
  sParameters,
  splitFee,
  U64_MAX,
  vParameters,
} from "../..";

export function getAmountIn(
  amountOut: BN,
  price: BN,
  swapForY: Boolean,
  rounding: Rounding,
): BN {
  if (swapForY) {
    return shlDiv(amountOut, price, SCALE_OFFSET, rounding);
  } else {
    return mulShr(amountOut, price, SCALE_OFFSET, rounding);
  }
}

export function getAmountOut(bin: Bin, inAmount: BN, swapForY: boolean) {
  return swapForY
    ? mulShr(inAmount, bin.price, SCALE_OFFSET, Rounding.Down)
    : shlDiv(inAmount, bin.price, SCALE_OFFSET, Rounding.Down);
}

export function swapExactOutQuoteAtBin(
  bin: Bin,
  binStep: number,
  sParameter: sParameters,
  vParameter: vParameters,
  outAmount: BN,
  swapForY: boolean,
  supportLimitOrder: boolean,
  feeOnInput: boolean,
): {
  amountIn: BN;
  amountOut: BN;
  fee: BN;
  protocolFee: BN;
} {
  const tradeFeeNumerator = getTotalFee(binStep, sParameter, vParameter);

  let includedFeeAmountOut = outAmount;

  if (!feeOnInput) {
    const { includedFeeAmount } = getIncludedFeeAmount(
      outAmount,
      tradeFeeNumerator,
    );

    includedFeeAmountOut = includedFeeAmount;
  }

  const maxAmountOut = getBinMaxAmountOut(bin, swapForY, supportLimitOrder);

  if (includedFeeAmountOut.gte(maxAmountOut)) {
    return swapExactInQuoteAtBin(
      bin,
      binStep,
      sParameter,
      vParameter,
      U64_MAX,
      swapForY,
      supportLimitOrder,
      feeOnInput,
    );
  } else {
    const excludedFeeAmountIn = getAmountIn(
      includedFeeAmountOut,
      bin.price,
      swapForY,
      Rounding.Up,
    );

    let includedFeeAmountIn = excludedFeeAmountIn;

    if (feeOnInput) {
      const { includedFeeAmount } = getIncludedFeeAmount(
        excludedFeeAmountIn,
        tradeFeeNumerator,
      );

      includedFeeAmountIn = includedFeeAmount;
    }

    let {
      amountIn,
      amountOut: quotedAmountOut,
      fee,
      protocolFee,
    } = swapExactInQuoteAtBin(
      bin,
      binStep,
      sParameter,
      vParameter,
      includedFeeAmountIn,
      swapForY,
      supportLimitOrder,
      feeOnInput,
    );

    const delta = quotedAmountOut.sub(outAmount);
    if (delta.gt(new BN(1))) {
      protocolFee = protocolFee.add(delta);
    }

    return {
      amountIn,
      amountOut: outAmount,
      fee,
      protocolFee,
    };
  }
}

function calculateExactInFillAmount(
  bin: Bin,
  amount: BN,
  maxAmountOut: BN,
  swapForY: boolean,
): {
  amountIn: BN;
  amountLeft: BN;
  outAmount: BN;
} {
  const maxAmountIn = getAmountIn(
    maxAmountOut,
    bin.price,
    swapForY,
    Rounding.Up,
  );
  if (amount.gte(maxAmountIn)) {
    return {
      amountIn: maxAmountIn,
      amountLeft: amount.sub(maxAmountIn),
      outAmount: maxAmountOut,
    };
  } else {
    const outAmount = getAmountOut(bin, amount, swapForY);
    return {
      amountIn: amount,
      amountLeft: new BN(0),
      outAmount,
    };
  }
}

function getLimitOrderAmountsBySwapDirection(bin: Bin, swapForY: boolean) {
  const isAskSide = Boolean(bin.limitOrderAskSide);
  if ((swapForY && !isAskSide) || (!swapForY && isAskSide)) {
    return {
      openOrderAmount: bin.openOrderAmount,
      processedOrderRemainingAmount: bin.processedOrderRemainingAmount,
    };
  }

  return {
    openOrderAmount: new BN(0),
    processedOrderRemainingAmount: new BN(0),
  };
}

function getExactInFillAmountResult(
  bin: Bin,
  amountIn: BN,
  swapForY: boolean,
  supportLimitOrder: boolean,
): {
  amountIn: BN;
  amountLeft: BN;
  outAmount: BN;
  mmAmountIn: BN;
  mmAmountOut: BN;
} {
  const mmAmount = swapForY ? bin.amountY : bin.amountX;
  const mmFillInResult = calculateExactInFillAmount(
    bin,
    amountIn,
    mmAmount,
    swapForY,
  );

  if (!supportLimitOrder) {
    return {
      amountIn: mmFillInResult.amountIn,
      amountLeft: mmFillInResult.amountLeft,
      outAmount: mmFillInResult.outAmount,
      mmAmountIn: mmFillInResult.amountIn,
      mmAmountOut: mmFillInResult.outAmount,
    };
  }

  const amountLeftAfterMM = mmFillInResult.amountLeft;

  let processedOrderAmountIn = new BN(0);
  let processedOrderAmountOut = new BN(0);
  let openOrderAmountIn = new BN(0);
  let openOrderAmountOut = new BN(0);

  if (!amountLeftAfterMM.isZero()) {
    const { openOrderAmount, processedOrderRemainingAmount } =
      getLimitOrderAmountsBySwapDirection(bin, swapForY);

    const remainingOrderFillInResult = calculateExactInFillAmount(
      bin,
      amountLeftAfterMM,
      processedOrderRemainingAmount,
      swapForY,
    );

    processedOrderAmountIn = remainingOrderFillInResult.amountIn;
    processedOrderAmountOut = remainingOrderFillInResult.outAmount;

    if (!remainingOrderFillInResult.amountLeft.isZero()) {
      const openOrderFillInResult = calculateExactInFillAmount(
        bin,
        remainingOrderFillInResult.amountLeft,
        openOrderAmount,
        swapForY,
      );

      openOrderAmountIn = openOrderFillInResult.amountIn;
      openOrderAmountOut = openOrderFillInResult.outAmount;
    }
  }

  const totalAmountIn = mmFillInResult.amountIn
    .add(processedOrderAmountIn)
    .add(openOrderAmountIn);
  const totalAmountOut = mmFillInResult.outAmount
    .add(processedOrderAmountOut)
    .add(openOrderAmountOut);

  return {
    amountIn: totalAmountIn,
    amountLeft: amountIn.sub(totalAmountIn),
    outAmount: totalAmountOut,
    mmAmountIn: mmFillInResult.amountIn,
    mmAmountOut: mmFillInResult.outAmount,
  };
}

export function swapExactInQuoteAtBin(
  bin: Bin,
  binStep: number,
  sParameter: sParameters,
  vParameter: vParameters,
  inAmount: BN,
  swapForY: boolean,
  supportLimitOrder: boolean,
  feeOnInput: boolean,
): {
  amountIn: BN;
  amountOut: BN;
  fee: BN;
  protocolFee: BN;
} {
  let tradingFee = new BN(0);
  let excludedFeeAmountIn = inAmount;

  const tradeFeeNumerator = getTotalFee(binStep, sParameter, vParameter);

  if (feeOnInput) {
    const { excludedFeeAmount: amount, fee } = getExcludedFeeAmount(
      inAmount,
      tradeFeeNumerator,
    );
    tradingFee = fee;
    excludedFeeAmountIn = amount;
  }

  const fillAmountResult = getExactInFillAmountResult(
    bin,
    excludedFeeAmountIn,
    swapForY,
    supportLimitOrder,
  );

  const amountLeft = fillAmountResult.amountLeft;
  const outAmount = fillAmountResult.outAmount;

  let includedFeeAmountIn = inAmount;

  if (!amountLeft.isZero()) {
    excludedFeeAmountIn = excludedFeeAmountIn.sub(amountLeft);
    if (feeOnInput) {
      const { includedFeeAmount: amount, fee } = getIncludedFeeAmount(
        excludedFeeAmountIn,
        tradeFeeNumerator,
      );

      tradingFee = fee;
      includedFeeAmountIn = amount;
    }
  }

  let excludedFeeAmountOut = outAmount;

  if (!feeOnInput) {
    const { excludedFeeAmount: amount, fee } = getExcludedFeeAmount(
      outAmount,
      tradeFeeNumerator,
    );
    tradingFee = fee;
    excludedFeeAmountOut = amount;
  }

  const { fee, protocolFee } = splitFee(
    tradingFee,
    new BN(sParameter.protocolShare),
    fillAmountResult.mmAmountIn,
    fillAmountResult.amountIn,
  );

  return {
    amountIn: includedFeeAmountIn,
    amountOut: excludedFeeAmountOut,
    fee,
    protocolFee,
  };
}

export function getLimitOrderLiquidity(
  bin: Bin,
  supportLimitOrder: boolean,
): {
  orderAmountX: BN;
  orderAmountY: BN;
} {
  if (!supportLimitOrder) {
    return {
      orderAmountX: new BN(0),
      orderAmountY: new BN(0),
    };
  }

  const totalOrderAmount = bin.openOrderAmount.add(
    bin.processedOrderRemainingAmount,
  );

  const isAskSide = Boolean(bin.limitOrderAskSide);

  if (isAskSide) {
    return {
      orderAmountX: totalOrderAmount,
      orderAmountY: new BN(0),
    };
  } else {
    return {
      orderAmountX: new BN(0),
      orderAmountY: totalOrderAmount,
    };
  }
}

export function getBinMaxAmountOut(
  bin: Bin,
  swapForY: boolean,
  supportLimitOrder: boolean,
): BN {
  const { orderAmountX, orderAmountY } = getLimitOrderLiquidity(
    bin,
    supportLimitOrder,
  );

  const totalAmount = swapForY
    ? bin.amountY.add(orderAmountY)
    : bin.amountX.add(orderAmountX);

  return totalAmount;
}
