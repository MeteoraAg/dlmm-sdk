import { BN, Program } from "@coral-xyz/anchor";
import { LbClmm } from "../../idl/idl";
import {
  LIMIT_ORDER_BIN_DATA_SIZE,
  LimitOrder,
  LimitOrderBinData,
} from "../../types";

export * from "./wrapper";

function decodeLimitOrderBinDataSlice(data: Buffer): LimitOrderBinData {
  return {
    amount: new BN(data.subarray(0, 8), "le"),
    age: data.readUInt32LE(8),
    binId: data.readInt32LE(16),
    isAsk: data.readUInt8(20),
  };
}

export function decodeLimitOrderBinData(
  limitOrder: LimitOrder,
  _program: Program<LbClmm>,
  bytes: Buffer,
): LimitOrderBinData[] {
  const out: LimitOrderBinData[] = [];

  for (let i = 0; i < limitOrder.binCount; i++) {
    const offset = i * LIMIT_ORDER_BIN_DATA_SIZE;
    const slice = bytes.subarray(offset, offset + LIMIT_ORDER_BIN_DATA_SIZE);
    out.push(decodeLimitOrderBinDataSlice(slice));
  }

  return out;
}
