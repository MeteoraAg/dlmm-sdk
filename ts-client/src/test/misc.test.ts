import { Connection, PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";
import { DEFAULT_BIN_PER_POSITION } from "../dlmm/constants";
import {
  chunkBinRange,
  chunkPositionBinRange,
} from "../dlmm/helpers/positions";
import { LbPosition, PositionData, PositionVersion } from "../dlmm/types";

describe("Misc", () => {
  describe("chunkPositionBinRange", () => {
    const minBinId = -100;
    const maxBinId = 100;

    const ZERO = new BN(0);

    let position: LbPosition;

    beforeEach(() => {
      const positionData: PositionData = {
        totalXAmount: ZERO.toString(),
        totalYAmount: ZERO.toString(),
        positionBinData: [],
        lastUpdatedAt: ZERO,
        upperBinId: maxBinId,
        lowerBinId: minBinId,
        feeX: ZERO,
        feeY: ZERO,
        rewardOne: ZERO,
        rewardTwo: ZERO,
        feeOwner: PublicKey.default,
        totalClaimedFeeXAmount: ZERO,
        totalClaimedFeeYAmount: ZERO,
        feeXExcludeTransferFee: ZERO,
        feeYExcludeTransferFee: ZERO,
        rewardOneExcludeTransferFee: ZERO,
        rewardTwoExcludeTransferFee: ZERO,
        totalXAmountExcludeTransferFee: ZERO,
        totalYAmountExcludeTransferFee: ZERO,
        owner: PublicKey.default,
      };

      for (let i = minBinId; i <= maxBinId; i++) {
        positionData.positionBinData.push({
          binId: i,
          price: ZERO.toString(),
          binLiquidity: ZERO.toString(),
          binXAmount: ZERO.toString(),
          binYAmount: ZERO.toString(),
          positionLiquidity: ZERO.toString(),
          positionXAmount: ZERO.toString(),
          positionYAmount: ZERO.toString(),
          positionFeeXAmount: ZERO.toString(),
          positionFeeYAmount: ZERO.toString(),
          positionRewardAmount: [ZERO.toString(), ZERO.toString()],
          pricePerToken: ZERO.toString(),
        });
      }

      position = {
        publicKey: PublicKey.default,
        positionData,
        version: PositionVersion.V3,
      };
    });

    test("chunkPositionFeesAndRewards full", async () => {
      const chunkedFeesAndRewards = chunkPositionBinRange(
        position,
        minBinId,
        maxBinId
      );

      expect(chunkedFeesAndRewards.length).toBe(3);
      let prevChunkMaxBinId: number;

      for (const chunk of chunkedFeesAndRewards) {
        const size = chunk.maxBinId - chunk.minBinId + 1;

        if (chunk.maxBinId != maxBinId) {
          expect(size).toBe(DEFAULT_BIN_PER_POSITION.toNumber());
        }

        expect(chunk.minBinId >= minBinId).toBeTruthy();
        expect(chunk.maxBinId <= maxBinId).toBeTruthy();

        if (prevChunkMaxBinId) {
          expect(chunk.minBinId - 1).toBe(prevChunkMaxBinId);
        }
        prevChunkMaxBinId = chunk.maxBinId;
      }
    });

    test("chunkPositionFeesAndRewards partial", async () => {
      const minBinId = -80;
      const maxBinId = 80;

      let prevChunkMaxBinId: number;

      const chunkedFeesAndRewards = chunkPositionBinRange(
        position,
        minBinId,
        maxBinId
      );

      for (const chunk of chunkedFeesAndRewards) {
        const size = chunk.maxBinId - chunk.minBinId + 1;

        if (chunk.maxBinId != maxBinId) {
          expect(size).toBe(DEFAULT_BIN_PER_POSITION.toNumber());
        }

        expect(chunk.minBinId >= minBinId).toBeTruthy();
        expect(chunk.maxBinId <= maxBinId).toBeTruthy();

        if (prevChunkMaxBinId) {
          expect(chunk.minBinId - 1).toBe(prevChunkMaxBinId);
        }
        prevChunkMaxBinId = chunk.maxBinId;
      }
    });
  });

  it("chunk bin range", () => {
    const minBinId = -100;
    const maxBinId = 100;

    const chunkedBinRange = chunkBinRange(minBinId, maxBinId);

    let lastMaxBinId = null;
    for (const binRange of chunkedBinRange) {
      expect(binRange.upperBinId >= binRange.lowerBinId).toBeTruthy();
      expect(binRange.lowerBinId >= minBinId).toBeTruthy();
      expect(binRange.upperBinId <= maxBinId).toBeTruthy();

      if (lastMaxBinId) {
        expect(binRange.lowerBinId).toBe(lastMaxBinId + 1);
      }
      lastMaxBinId = binRange.upperBinId;
    }

    expect(chunkBinRange(maxBinId, minBinId).length).toBe(0);
  });
});
