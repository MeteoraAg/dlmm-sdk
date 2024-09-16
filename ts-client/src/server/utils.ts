import { PublicKey } from "@solana/web3.js";
import { LbPosition } from "../dlmm/types";
import BN from "bn.js";

export const convertToPosition = (rawPosition: any): LbPosition => {
    return {
        ...rawPosition,
        publicKey: new PublicKey(rawPosition.publicKey),
        positionData: {
          ...rawPosition.positionData,
          lastUpdatedAt: new BN(rawPosition.positionData.lastUpdatedAt, 16),
          feeX: new BN(rawPosition.positionData.feeX, 16),
          feeY: new BN(rawPosition.positionData.feeY, 16),
          rewardOne: new BN(rawPosition.positionData.rewardOne, 16),
          rewardTwo: new BN(rawPosition.positionData.rewardTwo, 16),
          feeOwner: new PublicKey(rawPosition.positionData.feeOwner),
          totalClaimedFeeXAmount: new BN(rawPosition.positionData.totalClaimedFeeXAmount, 16),
          totalClaimedFeeYAmount: new BN(rawPosition.positionData.totalClaimedFeeYAmount, 16),
        },
      }
}