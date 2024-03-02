import { BN } from "@coral-xyz/anchor";
import {
  fromStrategyParamsToWeightDistribution,
  fromWeightDistributionToAmount,
  fromWeightDistributionToAmountOneSide,
  calculateStrategyParameter,
  assertEqualNumber
} from "../dlmm/helpers";
import { StrategyType } from "../dlmm/types";
import babar from "babar";

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

describe("calculate strategy parameters", () => {
  describe("One side", () => {
    describe("Ask side", () => {
      test("Spot", () => {
        let minBinId = 0;
        let maxBinId = 69;
        let strategy = StrategyType.Spot;
        let activeBinId = 0;
        let totalXAmount = new BN(100_000);
        let totalYAmount = new BN(0);
        let amountXInActiveBin = new BN(1);
        let amountYInActiveBin = new BN(1);
        let binStep = 10;
        let parameters = {
          minBinId,
          maxBinId,
          strategy,
          activeBinId,
          totalXAmount,
          totalYAmount,
          amountXInActiveBin,
          amountYInActiveBin,
          binStep,
        };
        let strategyParameters = calculateStrategyParameter(parameters);

        // verify
        let distributions = fromStrategyParamsToWeightDistribution(strategyParameters);
        const bars = [];
        for (const dist of distributions) {
          bars.push([dist.binId, dist.weight]);
        }
        console.log(babar(bars));
        let amounts = fromWeightDistributionToAmountOneSide(totalXAmount, distributions, binStep, activeBinId, false);
        const amountX = amounts.reduce(function (sum, el) {
          return sum.add(el.amount);
        }, new BN(0));
        expect(assertEqualNumber(totalXAmount, amountX, new BN(1))).toEqual(true);// 1%
      });

      test("Curve", () => {
        let minBinId = 0;
        let maxBinId = 69;
        let strategy = StrategyType.Curve;
        let activeBinId = 0;
        let totalXAmount = new BN(100_000);
        let totalYAmount = new BN(0);
        let amountXInActiveBin = new BN(1);
        let amountYInActiveBin = new BN(1);
        let binStep = 10;
        let parameters = {
          minBinId,
          maxBinId,
          strategy,
          activeBinId,
          totalXAmount,
          totalYAmount,
          amountXInActiveBin,
          amountYInActiveBin,
          binStep,
        };
        let strategyParameters = calculateStrategyParameter(parameters);

        // verify
        let distributions = fromStrategyParamsToWeightDistribution(strategyParameters);
        const bars = [];
        for (const dist of distributions) {
          bars.push([dist.binId, dist.weight]);
        }
        console.log(babar(bars));
        let amounts = fromWeightDistributionToAmountOneSide(totalXAmount, distributions, binStep, activeBinId, false);
        const amountX = amounts.reduce(function (sum, el) {
          return sum.add(el.amount);
        }, new BN(0));
        expect(assertEqualNumber(totalXAmount, amountX, new BN(1))).toEqual(true);// 1%
      });

      test("BidAsk", () => {
        let minBinId = 0;
        let maxBinId = 69;
        let strategy = StrategyType.BidAsk;
        let activeBinId = 0;
        let totalXAmount = new BN(100_000);
        let totalYAmount = new BN(0);
        let amountXInActiveBin = new BN(1);
        let amountYInActiveBin = new BN(1);
        let binStep = 10;
        let parameters = {
          minBinId,
          maxBinId,
          strategy,
          activeBinId,
          totalXAmount,
          totalYAmount,
          amountXInActiveBin,
          amountYInActiveBin,
          binStep,
        };
        let strategyParameters = calculateStrategyParameter(parameters);

        // verify
        let distributions = fromStrategyParamsToWeightDistribution(strategyParameters);
        const bars = [];
        for (const dist of distributions) {
          bars.push([dist.binId, dist.weight]);
        }
        console.log(babar(bars));
        let amounts = fromWeightDistributionToAmountOneSide(totalXAmount, distributions, binStep, activeBinId, false);
        const amountX = amounts.reduce(function (sum, el) {
          return sum.add(el.amount);
        }, new BN(0));
        expect(assertEqualNumber(totalXAmount, amountX, new BN(1))).toEqual(true);// 1%
      });
    })
    describe("Bid side", () => {
      test("Spot", () => {
        let minBinId = 0;
        let maxBinId = 69;
        let strategy = StrategyType.Spot;
        let activeBinId = 69;
        let totalXAmount = new BN(0);
        let totalYAmount = new BN(100_000);
        let amountXInActiveBin = new BN(1);
        let amountYInActiveBin = new BN(1);
        let binStep = 10;
        let parameters = {
          minBinId,
          maxBinId,
          strategy,
          activeBinId,
          totalXAmount,
          totalYAmount,
          amountXInActiveBin,
          amountYInActiveBin,
          binStep,
        };
        let strategyParameters = calculateStrategyParameter(parameters);

        // verify
        let distributions = fromStrategyParamsToWeightDistribution(strategyParameters);
        const bars = [];
        for (const dist of distributions) {
          bars.push([dist.binId, dist.weight]);
        }
        console.log(babar(bars));
        let amounts = fromWeightDistributionToAmountOneSide(totalYAmount, distributions, binStep, activeBinId, true);
        const amountY = amounts.reduce(function (sum, el) {
          return sum.add(el.amount);
        }, new BN(0));
        expect(assertEqualNumber(totalYAmount, amountY, new BN(1))).toEqual(true);// 1%
      });

      test("Curve", () => {
        let minBinId = 0;
        let maxBinId = 69;
        let strategy = StrategyType.Curve;
        let activeBinId = 69;
        let totalXAmount = new BN(0);
        let totalYAmount = new BN(100_000);
        let amountXInActiveBin = new BN(1);
        let amountYInActiveBin = new BN(1);
        let binStep = 10;
        let parameters = {
          minBinId,
          maxBinId,
          strategy,
          activeBinId,
          totalXAmount,
          totalYAmount,
          amountXInActiveBin,
          amountYInActiveBin,
          binStep,
        };
        let strategyParameters = calculateStrategyParameter(parameters);

        // verify
        let distributions = fromStrategyParamsToWeightDistribution(strategyParameters);
        const bars = [];
        for (const dist of distributions) {
          bars.push([dist.binId, dist.weight]);
        }
        console.log(babar(bars));
        let amounts = fromWeightDistributionToAmountOneSide(totalYAmount, distributions, binStep, activeBinId, true);
        const amountY = amounts.reduce(function (sum, el) {
          return sum.add(el.amount);
        }, new BN(0));
        expect(assertEqualNumber(totalYAmount, amountY, new BN(1))).toEqual(true);// 1%
      });

      test("BidAsk", () => {
        let minBinId = 0;
        let maxBinId = 69;
        let strategy = StrategyType.BidAsk;
        let activeBinId = 69;
        let totalXAmount = new BN(0);
        let totalYAmount = new BN(100_000);
        let amountXInActiveBin = new BN(1);
        let amountYInActiveBin = new BN(1);
        let binStep = 10;
        let parameters = {
          minBinId,
          maxBinId,
          strategy,
          activeBinId,
          totalXAmount,
          totalYAmount,
          amountXInActiveBin,
          amountYInActiveBin,
          binStep,
        };
        let strategyParameters = calculateStrategyParameter(parameters);

        // verify
        let distributions = fromStrategyParamsToWeightDistribution(strategyParameters);
        const bars = [];
        for (const dist of distributions) {
          bars.push([dist.binId, dist.weight]);
        }
        console.log(babar(bars));
        let amounts = fromWeightDistributionToAmountOneSide(totalYAmount, distributions, binStep, activeBinId, true);
        const amountY = amounts.reduce(function (sum, el) {
          return sum.add(el.amount);
        }, new BN(0));
        expect(assertEqualNumber(totalYAmount, amountY, new BN(1))).toEqual(true);// 1%
      });
    })
  });

  describe("Both side", () => {
    test("Spot", () => {
      let minBinId = 0;
      let maxBinId = 69;
      let strategy = StrategyType.Spot;
      let activeBinId = 20;
      let totalXAmount = new BN(100_000);
      let totalYAmount = new BN(1_000_000);
      let amountXInActiveBin = new BN(1);
      let amountYInActiveBin = new BN(1);
      let binStep = 10;
      let parameters = {
        minBinId,
        maxBinId,
        strategy,
        activeBinId,
        totalXAmount,
        totalYAmount,
        amountXInActiveBin,
        amountYInActiveBin,
        binStep,
      };
      let strategyParameters = calculateStrategyParameter(parameters);

      // verify
      let distributions = fromStrategyParamsToWeightDistribution(strategyParameters);
      const bars = [];
      for (const dist of distributions) {
        bars.push([dist.binId, dist.weight]);
      }
      console.log(babar(bars));

      let amounts = fromWeightDistributionToAmount(totalXAmount, totalYAmount, distributions, binStep, activeBinId, amountXInActiveBin, amountYInActiveBin);
      const amountX = amounts.reduce(function (sum, el) {
        return sum.add(el.amountX);
      }, new BN(0));

      const amountY = amounts.reduce(function (sum, el) {
        return sum.add(el.amountY);
      }, new BN(0));
      expect(assertEqualNumber(totalXAmount, amountX, new BN(5))).toEqual(true);// 1%
      expect(assertEqualNumber(totalYAmount, amountY, new BN(5))).toEqual(true);// 1%
    });


    test("Curve", () => {
      let minBinId = 0;
      let maxBinId = 69;
      let strategy = StrategyType.Curve;
      let activeBinId = 20;
      let totalXAmount = new BN(100_000);
      let totalYAmount = new BN(1_000_000);
      let amountXInActiveBin = new BN(1);
      let amountYInActiveBin = new BN(1);
      let binStep = 10;
      let parameters = {
        minBinId,
        maxBinId,
        strategy,
        activeBinId,
        totalXAmount,
        totalYAmount,
        amountXInActiveBin,
        amountYInActiveBin,
        binStep,
      };
      let strategyParameters = calculateStrategyParameter(parameters);

      // verify
      let distributions = fromStrategyParamsToWeightDistribution(strategyParameters);
      const bars = [];
      for (const dist of distributions) {
        bars.push([dist.binId, dist.weight]);
      }
      console.log(babar(bars));

      let amounts = fromWeightDistributionToAmount(totalXAmount, totalYAmount, distributions, binStep, activeBinId, amountXInActiveBin, amountYInActiveBin);
      const amountX = amounts.reduce(function (sum, el) {
        return sum.add(el.amountX);
      }, new BN(0));

      const amountY = amounts.reduce(function (sum, el) {
        return sum.add(el.amountY);
      }, new BN(0));
      expect(assertEqualNumber(totalXAmount, amountX, new BN(5))).toEqual(true);// 1%
      expect(assertEqualNumber(totalYAmount, amountY, new BN(5))).toEqual(true);// 1%
    });

    test("BidAsk", () => {
      let minBinId = 0;
      let maxBinId = 69;
      let strategy = StrategyType.BidAsk;
      let activeBinId = 20;
      let totalXAmount = new BN(100_000);
      let totalYAmount = new BN(1_000_000);
      let amountXInActiveBin = new BN(1);
      let amountYInActiveBin = new BN(1);
      let binStep = 10;
      let parameters = {
        minBinId,
        maxBinId,
        strategy,
        activeBinId,
        totalXAmount,
        totalYAmount,
        amountXInActiveBin,
        amountYInActiveBin,
        binStep,
      };
      let strategyParameters = calculateStrategyParameter(parameters);

      // verify
      let distributions = fromStrategyParamsToWeightDistribution(strategyParameters);
      const bars = [];
      for (const dist of distributions) {
        bars.push([dist.binId, dist.weight]);
      }
      console.log(babar(bars));

      let amounts = fromWeightDistributionToAmount(totalXAmount, totalYAmount, distributions, binStep, activeBinId, amountXInActiveBin, amountYInActiveBin);
      const amountX = amounts.reduce(function (sum, el) {
        return sum.add(el.amountX);
      }, new BN(0));

      const amountY = amounts.reduce(function (sum, el) {
        return sum.add(el.amountY);
      }, new BN(0));
      expect(assertEqualNumber(totalXAmount, amountX, new BN(5))).toEqual(true);// 1%
      expect(assertEqualNumber(totalYAmount, amountY, new BN(5))).toEqual(true);// 1%
    });
  })
});
