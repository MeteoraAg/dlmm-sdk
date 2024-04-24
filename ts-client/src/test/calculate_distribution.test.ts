import { BN } from "@coral-xyz/anchor";
import {
  calculateBidAskDistribution,
  calculateNormalDistribution,
  calculateSpotDistribution,
  toWeightDistribution,
  fromWeightDistributionToAmount,
  getPriceOfBinByBinId,
  fromWeightDistributionToAmountOneSide,
  toAmountsOneSideByStrategy,
} from "../dlmm/helpers";
import { StrategyType } from "../dlmm/types";
import babar from "babar";
import Decimal from "decimal.js";
import {
  compressBinAmount,
  distributeAmountToCompressedBinsByRatio,
  generateAmountForBinRange,
  getC,
  getPositionCount,
} from "../dlmm/helpers/math";

interface Distribution {
  binId: number;
  xAmountBpsOfTotal;
  yAmountBpsOfTotal;
}

expect.extend({
  toBeCloseTo(received: number, expected: number, precision: number) {
    const pass = Math.abs(received - expected) <= precision;
    return {
      pass,
      message: () =>
        `expected ${received} to be close to ${expected} with precision ${precision}`,
    };
  },
});

// Print out distribution in console for debugging
function debugDistributionChart(distributions: Distribution[]) {
  const bars = [];
  for (const dist of distributions) {
    bars.push([
      dist.binId,
      dist.xAmountBpsOfTotal.add(dist.yAmountBpsOfTotal).toNumber(),
    ]);
  }
  console.log(babar(bars));
}

describe("calculate_distribution", () => {
  describe("consists of only 1 bin id", () => {
    describe("when the deposit bin at the left of the active bin", () => {
      const binIds = [-10000];
      const activeBin = -3333;

      const distributions = calculateNormalDistribution(activeBin, binIds);

      expect(distributions.length).toBe(1);
      expect(distributions[0].binId).toBe(binIds[0]);
      expect(distributions[0].xAmountBpsOfTotal.toNumber()).toBe(0);
      expect(distributions[0].yAmountBpsOfTotal.toNumber()).toBe(10000);
    });

    describe("when the deposit bin at the right of the active bin", () => {
      const binIds = [-2222];
      const activeBin = -3333;

      const distributions = calculateNormalDistribution(activeBin, binIds);

      expect(distributions.length).toBe(1);
      expect(distributions[0].binId).toBe(binIds[0]);
      expect(distributions[0].xAmountBpsOfTotal.toNumber()).toBe(10000);
      expect(distributions[0].yAmountBpsOfTotal.toNumber()).toBe(0);
    });

    describe("when the deposit bin is the active bin", () => {
      const binIds = [-3333];
      const activeBin = -3333;

      const distributions = calculateNormalDistribution(activeBin, binIds);

      expect(distributions.length).toBe(1);
      expect(distributions[0].binId).toBe(binIds[0]);
      expect(distributions[0].xAmountBpsOfTotal.toNumber()).toBe(10000);
      expect(distributions[0].yAmountBpsOfTotal.toNumber()).toBe(10000);
    });
  });

  describe("spot distribution", () => {
    test("should return correct distribution with equal delta", () => {
      const binIds = [1, 2, 3, 4, 5];
      const activeBin = 3;

      const distributions = calculateSpotDistribution(activeBin, binIds);

      const yNonActiveBinPct = Math.floor(10_000 / 2.5);
      const xNonActiveBinPct = Math.floor(10_000 / 2.5);

      expect(distributions[0].binId).toBe(1);
      expect(distributions[0].yAmountBpsOfTotal.toNumber()).toBe(
        yNonActiveBinPct
      );
      expect(distributions[0].xAmountBpsOfTotal.toNumber()).toBe(0);

      expect(distributions[1].binId).toBe(2);
      expect(distributions[1].yAmountBpsOfTotal.toNumber()).toBe(
        yNonActiveBinPct
      );
      expect(distributions[1].xAmountBpsOfTotal.toNumber()).toBe(0);

      expect(distributions[2].binId).toBe(3);
      expect(distributions[2].yAmountBpsOfTotal.toNumber()).toBe(
        Math.floor(yNonActiveBinPct * 0.5)
      );
      expect(distributions[2].xAmountBpsOfTotal.toNumber()).toBe(
        Math.floor(xNonActiveBinPct * 0.5)
      );

      expect(distributions[3].binId).toBe(4);
      expect(distributions[3].yAmountBpsOfTotal.toNumber()).toBe(0);
      expect(distributions[3].xAmountBpsOfTotal.toNumber()).toBe(
        xNonActiveBinPct
      );

      expect(distributions[4].binId).toBe(5);
      expect(distributions[4].yAmountBpsOfTotal.toNumber()).toBe(0);
      expect(distributions[4].xAmountBpsOfTotal.toNumber()).toBe(
        xNonActiveBinPct
      );

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(10_000);
      expect(yTokenTotalBps).toBe(10_000);
    });

    test("should return correct distribution with unequal delta", () => {
      const binIds = [1, 2, 3, 4, 5];
      const activeBin = 4;

      const distributions = calculateSpotDistribution(activeBin, binIds);

      const yNonActiveBinPct = Math.floor(10_000 / 3.5);
      const xNonActiveBinPct = Math.floor(10_000 / 1.5);

      expect(distributions[0].binId).toBe(1);
      expect(distributions[0].yAmountBpsOfTotal.toNumber()).toBe(
        yNonActiveBinPct
      );
      expect(distributions[0].xAmountBpsOfTotal.toNumber()).toBe(0);

      expect(distributions[1].binId).toBe(2);
      expect(distributions[1].yAmountBpsOfTotal.toNumber()).toBe(
        yNonActiveBinPct
      );
      expect(distributions[1].xAmountBpsOfTotal.toNumber()).toBe(0);

      expect(distributions[2].binId).toBe(3);
      expect(distributions[2].yAmountBpsOfTotal.toNumber()).toBe(
        yNonActiveBinPct
      );
      expect(distributions[2].xAmountBpsOfTotal.toNumber()).toBe(0);

      expect(distributions[3].binId).toBe(4);
      // Precision loss added to active bin
      expect(distributions[3].yAmountBpsOfTotal.toNumber()).toBeCloseTo(
        Math.floor(yNonActiveBinPct * 0.5),
        1
      );
      expect(distributions[3].xAmountBpsOfTotal.toNumber()).toBeCloseTo(
        Math.floor(xNonActiveBinPct * 0.5),
        1
      );

      expect(distributions[4].binId).toBe(5);
      expect(distributions[4].yAmountBpsOfTotal.toNumber()).toBe(0);
      expect(distributions[4].xAmountBpsOfTotal.toNumber()).toBe(
        xNonActiveBinPct
      );

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(10_000);
      expect(yTokenTotalBps).toBe(10_000);
    });

    test("should return correct distribution with liquidity at the left side of the active bin", () => {
      const binIds = [1, 2, 3, 4, 5];
      const activeBin = 10;

      const distributions = calculateSpotDistribution(activeBin, binIds);

      const yNonActiveBinPct = Math.floor(10_000 / 5);

      expect(distributions[0].binId).toBe(1);
      expect(distributions[0].yAmountBpsOfTotal.toNumber()).toBe(
        yNonActiveBinPct
      );
      expect(distributions[0].xAmountBpsOfTotal.toNumber()).toBe(0);

      expect(distributions[1].binId).toBe(2);
      expect(distributions[1].yAmountBpsOfTotal.toNumber()).toBe(
        yNonActiveBinPct
      );
      expect(distributions[1].xAmountBpsOfTotal.toNumber()).toBe(0);

      expect(distributions[2].binId).toBe(3);
      expect(distributions[2].yAmountBpsOfTotal.toNumber()).toBe(
        yNonActiveBinPct
      );
      expect(distributions[2].xAmountBpsOfTotal.toNumber()).toBe(0);

      expect(distributions[3].binId).toBe(4);
      expect(distributions[3].yAmountBpsOfTotal.toNumber()).toBe(
        yNonActiveBinPct
      );
      expect(distributions[3].xAmountBpsOfTotal.toNumber()).toBe(0);

      expect(distributions[4].binId).toBe(5);
      expect(distributions[4].yAmountBpsOfTotal.toNumber()).toBe(
        yNonActiveBinPct
      );
      expect(distributions[4].xAmountBpsOfTotal.toNumber()).toBe(0);

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(0);
      expect(yTokenTotalBps).toBe(10_000);
    });

    test("should return correct distribution with liquidity at the right side of the active bin", () => {
      const binIds = [5, 6, 7, 8, 9];
      const activeBin = 1;

      const distributions = calculateSpotDistribution(activeBin, binIds);

      const xNonActiveBinPct = Math.floor(10_000 / 5);

      expect(distributions[0].binId).toBe(5);
      expect(distributions[0].yAmountBpsOfTotal.toNumber()).toBe(0);
      expect(distributions[0].xAmountBpsOfTotal.toNumber()).toBe(
        xNonActiveBinPct
      );

      expect(distributions[1].binId).toBe(6);
      expect(distributions[1].yAmountBpsOfTotal.toNumber()).toBe(0);
      expect(distributions[1].xAmountBpsOfTotal.toNumber()).toBe(
        xNonActiveBinPct
      );

      expect(distributions[2].binId).toBe(7);
      expect(distributions[2].yAmountBpsOfTotal.toNumber()).toBe(0);
      expect(distributions[2].xAmountBpsOfTotal.toNumber()).toBe(
        xNonActiveBinPct
      );

      expect(distributions[3].binId).toBe(8);
      expect(distributions[3].yAmountBpsOfTotal.toNumber()).toBe(0);
      expect(distributions[3].xAmountBpsOfTotal.toNumber()).toBe(
        xNonActiveBinPct
      );

      expect(distributions[4].binId).toBe(9);
      expect(distributions[4].yAmountBpsOfTotal.toNumber()).toBe(0);
      expect(distributions[4].xAmountBpsOfTotal.toNumber()).toBe(
        xNonActiveBinPct
      );

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(10_000);
      expect(yTokenTotalBps).toBe(0);
    });
  });

  describe("curve distribution", () => {
    // Assert correct distribution when liquidity is surrounding the active bin
    function assertDistributionAroundActiveBin(
      activeBin: number,
      distributions: Distribution[]
    ) {
      let beforeXBps: number = undefined;
      let beforeYBps: number = undefined;

      for (const dist of distributions) {
        const { binId, xAmountBpsOfTotal, yAmountBpsOfTotal } = dist;
        if (binId < activeBin) {
          expect(xAmountBpsOfTotal.isZero()).toBeTruthy();
          expect(yAmountBpsOfTotal.isZero()).toBeFalsy();
          if (beforeYBps != undefined) {
            // The bps should be increasing
            expect(beforeYBps < yAmountBpsOfTotal.toNumber()).toBeTruthy();
          }
          beforeYBps = yAmountBpsOfTotal.toNumber();
        } else if (binId == activeBin) {
          expect(xAmountBpsOfTotal.isZero()).toBeFalsy();
          expect(yAmountBpsOfTotal.isZero()).toBeFalsy();
        } else {
          expect(xAmountBpsOfTotal.isZero()).toBeFalsy();
          expect(yAmountBpsOfTotal.isZero()).toBeTruthy();
          if (beforeXBps != undefined) {
            // The bps should be decreasing
            expect(beforeXBps > xAmountBpsOfTotal.toNumber()).toBeTruthy();
          }
          beforeXBps = xAmountBpsOfTotal.toNumber();
        }
      }
    }

    test("should return correct distribution with liquidity concentrated around right side of the active bin", () => {
      const binIds = [
        5505, 5506, 5507, 5508, 5509, 5510, 5511, 5512, 5513, 5514, 5515, 5516,
        5517, 5518, 5519, 5520, 5521,
      ];
      const activeBin = 5518;

      const distributions = calculateNormalDistribution(activeBin, binIds);

      expect(distributions.length).toBe(binIds.length);

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(10_000);
      expect(yTokenTotalBps).toBe(10_000);

      debugDistributionChart(distributions);
      assertDistributionAroundActiveBin(activeBin, distributions);
    });

    test("should return correct distribution with liquidity concentrated around left side of the active bin", () => {
      const binIds = [
        5505, 5506, 5507, 5508, 5509, 5510, 5511, 5512, 5513, 5514, 5515, 5516,
        5517, 5518, 5519, 5520, 5521,
      ];
      const activeBin = 5508;

      const distributions = calculateNormalDistribution(activeBin, binIds);

      expect(distributions.length).toBe(binIds.length);

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(10_000);
      expect(yTokenTotalBps).toBe(10_000);

      debugDistributionChart(distributions);
      assertDistributionAroundActiveBin(activeBin, distributions);
    });

    test("should return correct distribution with liquidity concentrated around the active bin", () => {
      const binIds = [
        5505, 5506, 5507, 5508, 5509, 5510, 5511, 5512, 5513, 5514, 5515, 5516,
        5517, 5518, 5519, 5520, 5521,
      ];
      const activeBin = 5513;

      const distributions = calculateNormalDistribution(activeBin, binIds);

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(10_000);
      expect(yTokenTotalBps).toBe(10_000);

      debugDistributionChart(distributions);
      assertDistributionAroundActiveBin(activeBin, distributions);
    });

    test("should return correct distribution with liquidity to far right of the active bin", () => {
      const binIds = [5505, 5506, 5507, 5508, 5509, 5510, 5511, 5512, 5513];
      const activeBin = 3000;

      const distributions = calculateNormalDistribution(activeBin, binIds);
      expect(distributions.length).toBe(binIds.length);

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(10_000);
      expect(yTokenTotalBps).toBe(0);

      debugDistributionChart(distributions);
      assertDistributionAroundActiveBin(activeBin, distributions);
    });

    test("should return correct distribution with liquidity to far left of the active bin", () => {
      const binIds = [5505, 5506, 5507, 5508, 5509, 5510, 5511, 5512, 5513];
      const activeBin = 8000;

      const distributions = calculateNormalDistribution(activeBin, binIds);
      expect(distributions.length).toBe(binIds.length);

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(0);
      expect(yTokenTotalBps).toBe(10_000);

      debugDistributionChart(distributions);
      assertDistributionAroundActiveBin(activeBin, distributions);
    });
  });

  describe("bid ask distribution", () => {
    // Assert correct distribution when liquidity is surrounding the active bin
    function assertDistributionAroundActiveBin(
      activeBin: number,
      distributions: Distribution[]
    ) {
      let beforeXBps: number = undefined;
      let beforeYBps: number = undefined;

      for (const dist of distributions) {
        const { binId, xAmountBpsOfTotal, yAmountBpsOfTotal } = dist;
        if (binId < activeBin) {
          expect(xAmountBpsOfTotal.isZero()).toBeTruthy();
          expect(yAmountBpsOfTotal.isZero()).toBeFalsy();
          if (beforeYBps != undefined) {
            // The bps should be decreasing
            expect(beforeYBps > yAmountBpsOfTotal.toNumber()).toBeTruthy();
          }
          beforeYBps = yAmountBpsOfTotal.toNumber();
        } else if (binId == activeBin) {
          expect(xAmountBpsOfTotal.isZero()).toBeFalsy();
          expect(yAmountBpsOfTotal.isZero()).toBeFalsy();
        } else {
          expect(xAmountBpsOfTotal.isZero()).toBeFalsy();
          expect(yAmountBpsOfTotal.isZero()).toBeTruthy();
          if (beforeXBps != undefined) {
            // The bps should be increasing
            expect(beforeXBps < xAmountBpsOfTotal.toNumber()).toBeTruthy();
          }
          beforeXBps = xAmountBpsOfTotal.toNumber();
        }
      }
    }

    test("should return correct distribution with liquidity concentrated around right side of the active bin", () => {
      const binIds = [
        5505, 5506, 5507, 5508, 5509, 5510, 5511, 5512, 5513, 5514, 5515, 5516,
        5517, 5518, 5519, 5520, 5521,
      ];
      const activeBin = 5518;

      const distributions = calculateBidAskDistribution(activeBin, binIds);

      expect(distributions.length).toBe(binIds.length);

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(10_000);
      expect(yTokenTotalBps).toBe(10_000);

      debugDistributionChart(distributions);
      assertDistributionAroundActiveBin(activeBin, distributions);
    });

    test("should return correct distribution with liquidity concentrated around left side of the active bin", () => {
      const binIds = [
        5505, 5506, 5507, 5508, 5509, 5510, 5511, 5512, 5513, 5514, 5515, 5516,
        5517, 5518, 5519, 5520, 5521,
      ];
      const activeBin = 5508;

      const distributions = calculateBidAskDistribution(activeBin, binIds);

      expect(distributions.length).toBe(binIds.length);

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(10_000);
      expect(yTokenTotalBps).toBe(10_000);

      debugDistributionChart(distributions);
      assertDistributionAroundActiveBin(activeBin, distributions);
    });

    test("should return correct distribution with liquidity concentrated around the active bin", () => {
      const binIds = [
        5505, 5506, 5507, 5508, 5509, 5510, 5511, 5512, 5513, 5514, 5515, 5516,
        5517, 5518, 5519, 5520, 5521,
      ];
      const activeBin = 5513;

      const distributions = calculateBidAskDistribution(activeBin, binIds);

      expect(distributions.length).toBe(binIds.length);

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(10_000);
      expect(yTokenTotalBps).toBe(10_000);

      debugDistributionChart(distributions);
      assertDistributionAroundActiveBin(activeBin, distributions);
    });

    test("should return correct distribution with liquidity to far right of the active bin", () => {
      const binIds = [5505, 5506, 5507, 5508, 5509, 5510, 5511, 5512, 5513];
      const activeBin = 3000;

      const distributions = calculateBidAskDistribution(activeBin, binIds);
      expect(distributions.length).toBe(binIds.length);

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(10_000);
      expect(yTokenTotalBps).toBe(0);

      debugDistributionChart(distributions);
      assertDistributionAroundActiveBin(activeBin, distributions);
    });

    test("should return correct distribution with liquidity to far left of the active bin", () => {
      const binIds = [5505, 5506, 5507, 5508, 5509, 5510, 5511, 5512, 5513];
      const activeBin = 8000;

      const distributions = calculateBidAskDistribution(activeBin, binIds);
      expect(distributions.length).toBe(binIds.length);

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(0);
      expect(yTokenTotalBps).toBe(10_000);

      debugDistributionChart(distributions);
      assertDistributionAroundActiveBin(activeBin, distributions);
    });

    test("to weight distribution", () => {
      const binIds = [
        -3563, -3562, -3561, -3560, -3559, -3558, -3557, -3556, -3555,
      ];
      const activeBin = -3556;

      const distributions = calculateSpotDistribution(activeBin, binIds);

      let weightDistribution = toWeightDistribution(
        new BN(1000000000),
        new BN(57000000),
        distributions,
        8
      );
      console.log(weightDistribution);
      const bars = [];
      for (const dist of weightDistribution) {
        bars.push([dist.binId, dist.weight]);
      }
      console.log(babar(bars));
    });

    test("to amount one side by strategy", () => {
      let activeId = 10;
      let minBinId = 20;
      let maxBinId = 70;
      let binStep = 10;
      let amount = new BN(10000);
      let amountInBins = toAmountsOneSideByStrategy(
        activeId,
        binStep,
        minBinId,
        maxBinId,
        amount,
        StrategyType.SpotOneSide,
        false
      );
      const bars = [];
      for (const dist of amountInBins) {
        let price = getPriceOfBinByBinId(dist.binId, binStep);
        let liquidity = price.mul(new Decimal(dist.amount.toString()));
        bars.push([dist.binId, liquidity.floor()]);
      }
      console.log(babar(bars));
    });
  });

  describe("seed liquidity", () => {
    const amount = new BN(100_000);
    const binStep = 10;
    const baseTokenDecimal = 9;
    const quoteTokenDecimal = 6;
    const priceMultiplier = new Decimal(
      10 ** (baseTokenDecimal - quoteTokenDecimal)
    );
    const minBinId = 0;
    const maxBinId = 100;
    const minPrice = getPriceOfBinByBinId(0, binStep).mul(priceMultiplier);
    const maxPrice = getPriceOfBinByBinId(100, binStep).mul(priceMultiplier);
    const k = 1.25;

    it("getPositionCount return number of position required correctly", () => {
      expect(getPositionCount(new BN(0), new BN(0)).toNumber()).toBe(1);
      expect(getPositionCount(new BN(0), new BN(69)).toNumber()).toBe(1);
      expect(getPositionCount(new BN(0), new BN(70)).toNumber()).toBe(2);
      expect(getPositionCount(new BN(0), new BN(85)).toNumber()).toBe(2);
      expect(getPositionCount(new BN(0), new BN(209)).toNumber()).toBe(3);
      expect(getPositionCount(new BN(0), new BN(210)).toNumber()).toBe(4);
    });

    it("distribute amount to compressed bin with remaining cap returned as loss", () => {
      const multiplier = new BN(1000);
      const binsAmount = new Map<number, BN>();

      binsAmount.set(0, new BN(1_294_967_295_999));
      binsAmount.set(1, new BN(2_294_967_295_999));
      binsAmount.set(2, new BN(3_294_967_295_999));
      binsAmount.set(3, new BN(4_294_967_295_999));

      const { compressedBinAmount, compressionLoss } = compressBinAmount(
        binsAmount,
        multiplier
      );

      expect(compressionLoss.toString()).toBe((999 * 4).toString());
      expect(compressedBinAmount.get(0).toString()).toBe("1294967295");
      expect(compressedBinAmount.get(1).toString()).toBe("2294967295");
      expect(compressedBinAmount.get(2).toString()).toBe("3294967295");
      expect(compressedBinAmount.get(3).toString()).toBe("4294967295");

      const { newCompressedBinAmount, loss } =
        distributeAmountToCompressedBinsByRatio(
          compressedBinAmount,
          compressionLoss,
          multiplier,
          new BN(2 ** 32 - 1)
        );

      // (4294967295 + 3294967296 + 2294967295 + 1294967295) - (4294967295 + 3294967295 + 2294967295 + 1294967295) * multiplier = 1000 (deposited uncompressed 1000, 1 if compressed)
      // loss = 999 * 4 - 1000 = 2996

      expect(loss.toString()).toBe("2996");
      expect(newCompressedBinAmount.get(0).toString()).toBe("1294967295");
      expect(newCompressedBinAmount.get(1).toString()).toBe("2294967295");
      expect(newCompressedBinAmount.get(2).toString()).toBe("3294967296");
      expect(newCompressedBinAmount.get(3).toString()).toBe("4294967295");
    });

    it("distribute amount to compressed bin correctly", () => {
      const multiplier = new BN(1000);
      const binsAmount = new Map<number, BN>();

      binsAmount.set(0, new BN(1_999));
      binsAmount.set(1, new BN(2_999));
      binsAmount.set(2, new BN(3_999));
      binsAmount.set(3, new BN(4_999));

      const { compressedBinAmount, compressionLoss } = compressBinAmount(
        binsAmount,
        multiplier
      );

      expect(compressionLoss.toString()).toBe((999 * 4).toString());
      expect(compressedBinAmount.get(0).toString()).toBe("1");
      expect(compressedBinAmount.get(1).toString()).toBe("2");
      expect(compressedBinAmount.get(2).toString()).toBe("3");
      expect(compressedBinAmount.get(3).toString()).toBe("4");

      const { newCompressedBinAmount, loss } =
        distributeAmountToCompressedBinsByRatio(
          compressedBinAmount,
          compressionLoss,
          multiplier,
          new BN(2 ** 32 - 1)
        );

      // ((5+4+2+1) - (4+3+2+1)) * multiplier = 2000 (deposited uncompressed 2000, 2 if compressed)
      // loss = 999 * 4 - 2000 = 1996

      expect(loss.toString()).toBe("1996");
      expect(newCompressedBinAmount.get(0).toString()).toBe("1");
      expect(newCompressedBinAmount.get(1).toString()).toBe("2");
      expect(newCompressedBinAmount.get(2).toString()).toBe("4");
      expect(newCompressedBinAmount.get(3).toString()).toBe("5");
    });

    it("compress bin amount correctly", () => {
      const multiplier = new BN(100);
      const binsAmount = new Map<number, BN>();
      binsAmount.set(0, new BN(100_000));
      binsAmount.set(1, new BN(123_456));

      const { compressedBinAmount, compressionLoss } = compressBinAmount(
        binsAmount,
        multiplier
      );

      expect(compressionLoss.toString()).toBe("56");
      expect(compressedBinAmount.get(0).toString()).toBe("1000");
      expect(compressedBinAmount.get(1).toString()).toBe("1234");
    });

    it("generateAmountForBinRange total amount equals seed amount", () => {
      const binsAmount = generateAmountForBinRange(
        amount,
        binStep,
        baseTokenDecimal,
        quoteTokenDecimal,
        new BN(minBinId),
        new BN(maxBinId),
        k
      );

      let totalAmount = new BN(0);
      for (const [_binId, amount] of binsAmount) {
        totalAmount = totalAmount.add(amount);
      }

      expect(totalAmount.toString()).toBe(amount.toString());
    });

    it("getC c1 > c0", () => {
      const c0 = getC(
        amount,
        binStep,
        new BN(minBinId),
        baseTokenDecimal,
        quoteTokenDecimal,
        minPrice,
        maxPrice,
        k
      );

      const c1 = getC(
        amount,
        binStep,
        new BN(minBinId + 1),
        baseTokenDecimal,
        quoteTokenDecimal,
        minPrice,
        maxPrice,
        k
      );

      expect(c1.gt(c0)).toBeTruthy();
    });
  });
});
