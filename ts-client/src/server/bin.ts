import BN from "bn.js";
import { decodeRewardPerTokenStored } from "../dlmm/helpers";
import { Bin } from "../dlmm/types";

export function serializeBin(bin: Bin, supportLimitOrder: boolean) {
  return {
    ...bin,
    amountX: bin.amountX.toString("hex"),
    amountY: bin.amountY.toString("hex"),
    price: bin.price.toString("hex"),
    liquiditySupply: bin.liquiditySupply.toString("hex"),
    fulfilledOrderAmountX: bin.fulfilledOrderAmountX.toString("hex"),
    fulfilledOrderAmountY: bin.fulfilledOrderAmountY.toString("hex"),
    limitOrderFeeAskSide: bin.limitOrderFeeAskSide.toString("hex"),
    limitOrderFeeBidSide: bin.limitOrderFeeBidSide.toString("hex"),
    feeAmountXPerTokenStored: bin.feeAmountXPerTokenStored.toString("hex"),
    feeAmountYPerTokenStored: bin.feeAmountYPerTokenStored.toString("hex"),
    openOrderAmount: bin.openOrderAmount.toString("hex"),
    totalProcessingOrderAmount: bin.totalProcessingOrderAmount.toString("hex"),
    processedOrderRemainingAmount:
      bin.processedOrderRemainingAmount.toString("hex"),
    // Keep the legacy Python field for liquidity-mining pools.
    rewardPerTokenStored: (supportLimitOrder
      ? [new BN(0), new BN(0)]
      : decodeRewardPerTokenStored(bin)
    ).map((reward) => reward.toString("hex")),
  };
}

export function deserializeBin(
  bin: Record<string, any>,
  supportLimitOrder: boolean,
): Bin {
  const hex = (field: string, optional = false): BN => {
    const value = bin[field];
    if (value == null && optional) return new BN(0);
    if (typeof value !== "string" || !/^[0-9a-f]+$/i.test(value)) {
      throw new Error(
        `Invalid or missing bin field ${field}; refetch bin arrays`,
      );
    }
    return new BN(value, 16);
  };

  // Legacy liquidity-mining responses did not carry limit-order fields. On
  // pools supporting orders, missing values must never be treated as zero.
  const askSide = bin.limitOrderAskSide;
  if (
    (askSide == null && supportLimitOrder) ||
    (askSide != null &&
      (!Number.isInteger(askSide) || askSide < 0 || askSide > 255))
  ) {
    throw new Error(
      "Invalid or missing bin field limitOrderAskSide; refetch bin arrays",
    );
  }

  return {
    amountX: hex("amountX"),
    amountY: hex("amountY"),
    price: hex("price"),
    liquiditySupply: hex("liquiditySupply"),
    fulfilledOrderAmountX: hex("fulfilledOrderAmountX", true),
    fulfilledOrderAmountY: hex("fulfilledOrderAmountY", true),
    limitOrderFeeAskSide: hex("limitOrderFeeAskSide", true),
    limitOrderFeeBidSide: hex("limitOrderFeeBidSide", true),
    feeAmountXPerTokenStored: hex("feeAmountXPerTokenStored"),
    feeAmountYPerTokenStored: hex("feeAmountYPerTokenStored"),
    openOrderAmount: hex("openOrderAmount", !supportLimitOrder),
    totalProcessingOrderAmount: hex("totalProcessingOrderAmount", true),
    processedOrderRemainingAmount: hex(
      "processedOrderRemainingAmount",
      !supportLimitOrder,
    ),
    orderAge: bin.orderAge ?? 0,
    limitOrderAskSide: askSide ?? 0,
    padding1: bin.padding1 ?? [0, 0, 0],
  };
}
