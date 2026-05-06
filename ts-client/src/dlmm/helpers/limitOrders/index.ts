import { Program } from "@coral-xyz/anchor";
import { LbClmm } from "../../idl/idl";
import {
  LIMIT_ORDER_BIN_DATA_SIZE,
  LimitOrder,
  LimitOrderBinData,
} from "../../types";

export * from "./wrapper";

export function decodeLimitOrderBinData(
  limitOrder: LimitOrder,
  program: Program<LbClmm>,
  bytes: Buffer,
): LimitOrderBinData[] {
  const limitOrderBinData: LimitOrderBinData[] = [];

  for (let i = 0; i < limitOrder.binCount; i++) {
    const offset = i * LIMIT_ORDER_BIN_DATA_SIZE;
    const data = bytes.subarray(offset, offset + LIMIT_ORDER_BIN_DATA_SIZE);
    const decodedLimitOrderBinData = program.coder.types.decode(
      // TODO: Find a type safe way
      "limitOrderBinData",
      data,
    ) as LimitOrderBinData;

    limitOrderBinData.push(decodedLimitOrderBinData);
  }

  return limitOrderBinData;
}
