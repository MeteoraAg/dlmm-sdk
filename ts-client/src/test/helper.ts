import { PublicKey } from "@solana/web3.js";
import { Position } from "../dlmm/types";
import { DLMM } from "../dlmm";
import BN from "bn.js";

export function assertAmountWithPrecision(
  actualAmount: number,
  expectedAmount: number,
  precisionPercent: number
) {
  if (expectedAmount == 0 && actualAmount == 0) {
    return;
  }
  let maxAmount, minAmount;
  if (expectedAmount > actualAmount) {
    maxAmount = expectedAmount;
    minAmount = actualAmount;
  } else {
    maxAmount = actualAmount;
    minAmount = expectedAmount;
  }
  let diff = ((maxAmount - minAmount) * 100) / maxAmount;
  expect(diff).toBeLessThan(precisionPercent);
}

export async function assertPosition({
  lbClmm,
  positionPubkey,
  userPublicKey,
  xAmount,
  yAmount,
}: {
  lbClmm: DLMM;
  positionPubkey: PublicKey;
  userPublicKey: PublicKey;
  xAmount: BN;
  yAmount: BN;
}) {
  const positionState: Position = await lbClmm.program.account.positionV2.fetch(
    positionPubkey
  );

  const { userPositions } = await lbClmm.getPositionsByUserAndLbPair(
    userPublicKey
  );

  expect(userPositions.length).toBeGreaterThan(0);
  const position = userPositions.find((ps) =>
    ps.publicKey.equals(positionPubkey)
  );
  expect(position).not.toBeUndefined();
  expect(position.positionData.positionBinData.length).toBe(
    positionState.upperBinId - positionState.lowerBinId + 1
  );
  expect(position.positionData.positionBinData[0].binId).toBe(
    positionState.lowerBinId
  );
  expect(
    position.positionData.positionBinData[
      position.positionData.positionBinData.length - 1
    ].binId
  ).toBe(positionState.upperBinId);
  expect(+position.positionData.totalXAmount).toBeLessThan(xAmount.toNumber());
  assertAmountWithPrecision(
    +position.positionData.totalXAmount,
    xAmount.toNumber(),
    5
  );
  expect(+position.positionData.totalYAmount).toBeLessThan(yAmount.toNumber());
  assertAmountWithPrecision(
    +position.positionData.totalYAmount,
    yAmount.toNumber(),
    5
  );

  return { bins: position.positionData.positionBinData };
}
