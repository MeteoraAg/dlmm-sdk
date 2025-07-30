import babar from "babar";
import BN from "bn.js";
import { SCALE_OFFSET } from "../dlmm/constants";
import { getQPriceFromId } from "../dlmm/helpers/math";
import {
  AmountIntoBin,
  buildLiquidityStrategyParameters,
  getLiquidityStrategyParameterBuilder,
  suggestBalancedXParametersFromY,
  suggestBalancedYParametersFromX,
  toAmountIntoBins,
} from "../dlmm/helpers/rebalance";
import { StrategyType } from "../dlmm/types";
import { assertionWithTolerance } from "./helper";

function assertBinDepositResult(
  activeId: BN,
  minDeltaId: BN,
  maxDeltaId: BN,
  favorXInActiveBin: boolean,
  amountInBins: AmountIntoBin[],
  amountX: BN,
  amountY: BN,
  tolerance: BN
) {
  const minBinId = activeId.add(minDeltaId);
  const maxBinId = activeId.add(maxDeltaId);

  let totalAmountX = new BN(0);
  let totalAmountY = new BN(0);

  for (let i = 0; i < amountInBins.length; i++) {
    const { binId, amountX, amountY } = amountInBins[i];

    // 1. Check bin range
    expect(binId.gte(minBinId)).toBeTruthy();
    expect(binId.lte(maxBinId)).toBeTruthy();

    // 2. Check amount
    if (binId.lt(activeId)) {
      expect(amountY.gt(new BN(0))).toBeTruthy();
      expect(amountX.isZero()).toBeTruthy();
    } else if (binId.gt(activeId)) {
      expect(amountX.gt(new BN(0))).toBeTruthy();
      expect(amountY.isZero()).toBeTruthy();
    } else {
      if (favorXInActiveBin) {
        expect(amountX.gt(new BN(0))).toBeTruthy();
        expect(amountY.isZero()).toBeTruthy();
      } else {
        expect(amountY.gt(new BN(0))).toBeTruthy();
        expect(amountX.isZero()).toBeTruthy();
      }
    }

    totalAmountX = totalAmountX.add(amountX);
    totalAmountY = totalAmountY.add(amountY);
  }

  // 3. Assert total amount
  assertionWithTolerance(totalAmountX, amountX, tolerance);
  assertionWithTolerance(totalAmountY, amountY, tolerance);
}

function logLiquidityInfo(
  amountX: BN,
  amountY: BN,
  amountInBins: AmountIntoBin[],
  binStep: BN
) {
  const { totalAmountX, totalAmountY } = amountInBins.reduce(
    (total, { amountX, amountY }) => {
      return {
        totalAmountX: total.totalAmountX.add(amountX),
        totalAmountY: total.totalAmountY.add(amountY),
      };
    },
    { totalAmountX: new BN(0), totalAmountY: new BN(0) }
  );

  console.log(
    "Total amount X",
    totalAmountX.toString(),
    "Amount X",
    amountX.toString()
  );
  console.log(
    "Total amount Y",
    totalAmountY.toString(),
    "Amount Y",
    amountY.toString()
  );

  const liquidities = amountInBins.map(({ amountX, amountY, binId }) => {
    const qPrice = getQPriceFromId(binId, binStep);
    return amountX.mul(qPrice).shrn(SCALE_OFFSET).add(amountY).toString();
  });

  console.log(babar(liquidities.map((liq, idx) => [idx, Number(liq)])));
  console.log("Liquidity distribution", JSON.stringify(liquidities));
}

describe("Rebalance liquidity parameter builder", () => {
  const activeId = new BN(1000);
  const binStep = new BN(10);

  describe("Spot", () => {
    const builder = getLiquidityStrategyParameterBuilder(StrategyType.Spot);

    it("Bid side", () => {
      const amountX = new BN(0);
      const amountY = new BN(100_000_000);
      const minDeltaId = new BN(60).neg();
      const maxDeltaId = new BN(1).neg();
      const favorXInActiveBin = true;

      const { deltaY, y0, deltaX, x0 } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        binStep,
        favorXInActiveBin,
        activeId,
        builder
      );

      const amountInBins = toAmountIntoBins(
        activeId,
        minDeltaId,
        maxDeltaId,
        deltaX,
        deltaY,
        x0,
        y0,
        binStep,
        favorXInActiveBin
      );

      logLiquidityInfo(amountX, amountY, amountInBins, binStep);

      assertBinDepositResult(
        activeId,
        minDeltaId,
        maxDeltaId,
        favorXInActiveBin,
        amountInBins,
        amountX,
        amountY,
        new BN(50)
      );
    });

    it("Bid side and suggest ask side parameters", () => {
      let amountX = new BN(0);
      const amountY = new BN(100_000_000);
      const minDeltaId = new BN(60).neg();
      let maxDeltaId = new BN(1).neg();
      const favorXInActiveBin = true;

      const { deltaY, y0 } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        binStep,
        favorXInActiveBin,
        activeId,
        builder
      );

      maxDeltaId = maxDeltaId.add(maxDeltaId.sub(minDeltaId).addn(1));

      const {
        base: x0,
        delta: deltaX,
        amountX: suggestedAmountX,
      } = suggestBalancedXParametersFromY(
        y0,
        deltaY,
        minDeltaId,
        maxDeltaId,
        activeId,
        binStep,
        favorXInActiveBin,
        builder
      );

      amountX = suggestedAmountX;

      const amountInBins = toAmountIntoBins(
        activeId,
        minDeltaId,
        maxDeltaId,
        deltaX,
        deltaY,
        x0,
        y0,
        binStep,
        favorXInActiveBin
      );

      logLiquidityInfo(amountX, amountY, amountInBins, binStep);

      assertBinDepositResult(
        activeId,
        minDeltaId,
        maxDeltaId,
        favorXInActiveBin,
        amountInBins,
        amountX,
        amountY,
        new BN(50)
      );
    });

    it("Ask side", () => {
      const amountX = new BN(100_000_000);
      const amountY = new BN(0);
      const minDeltaId = new BN(1);
      const maxDeltaId = new BN(60);
      const favorXInActiveBin = false;

      const { deltaX, deltaY, x0, y0 } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        binStep,
        favorXInActiveBin,
        activeId,
        builder
      );

      const amountInBins = toAmountIntoBins(
        activeId,
        minDeltaId,
        maxDeltaId,
        deltaX,
        deltaY,
        x0,
        y0,
        binStep,
        favorXInActiveBin
      );

      logLiquidityInfo(amountX, amountY, amountInBins, binStep);

      assertBinDepositResult(
        activeId,
        minDeltaId,
        maxDeltaId,
        favorXInActiveBin,
        amountInBins,
        amountX,
        amountY,
        new BN(50)
      );
    });

    it("Ask side and suggest bid side parameters", () => {
      const amountX = new BN(100_000_000);
      let amountY = new BN(0);
      let minDeltaId = new BN(1);
      const maxDeltaId = new BN(60);
      const favorXInActiveBin = false;

      const { deltaX, x0 } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        binStep,
        favorXInActiveBin,
        activeId,
        builder
      );

      minDeltaId = minDeltaId.sub(maxDeltaId.sub(minDeltaId).addn(1));

      const {
        base: y0,
        delta: deltaY,
        amountY: suggestedAmountY,
      } = suggestBalancedYParametersFromX(
        x0,
        deltaX,
        minDeltaId,
        maxDeltaId,
        activeId,
        binStep,
        favorXInActiveBin,
        builder
      );

      amountY = suggestedAmountY;

      const amountInBins = toAmountIntoBins(
        activeId,
        minDeltaId,
        maxDeltaId,
        deltaX,
        deltaY,
        x0,
        y0,
        binStep,
        favorXInActiveBin
      );

      logLiquidityInfo(amountX, amountY, amountInBins, binStep);

      assertBinDepositResult(
        activeId,
        minDeltaId,
        maxDeltaId,
        favorXInActiveBin,
        amountInBins,
        amountX,
        amountY,
        new BN(50)
      );
    });

    it("Bid side involve active bin", () => {
      const amountX = new BN(0);
      const amountY = new BN(100_000_000);
      const minDeltaId = new BN(60).neg();
      const maxDeltaId = new BN(0);
      const favorXInActiveBin = false;

      const { deltaX, deltaY, x0, y0 } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        binStep,
        favorXInActiveBin,
        activeId,
        builder
      );

      const amountInBins = toAmountIntoBins(
        activeId,
        minDeltaId,
        maxDeltaId,
        deltaX,
        deltaY,
        x0,
        y0,
        binStep,
        favorXInActiveBin
      );

      logLiquidityInfo(amountX, amountY, amountInBins, binStep);

      assertBinDepositResult(
        activeId,
        minDeltaId,
        maxDeltaId,
        favorXInActiveBin,
        amountInBins,
        amountX,
        amountY,
        new BN(50)
      );
    });

    it("Ask side involve active bin", () => {
      const amountX = new BN(100_000_000);
      const amountY = new BN(0);
      const minDeltaId = new BN(0);
      const maxDeltaId = new BN(60);
      const favorXInActiveBin = true;

      const { deltaX, deltaY, x0, y0 } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        binStep,
        favorXInActiveBin,
        activeId,
        builder
      );

      const amountInBins = toAmountIntoBins(
        activeId,
        minDeltaId,
        maxDeltaId,
        deltaX,
        deltaY,
        x0,
        y0,
        binStep,
        favorXInActiveBin
      );

      logLiquidityInfo(amountX, amountY, amountInBins, binStep);

      assertBinDepositResult(
        activeId,
        minDeltaId,
        maxDeltaId,
        favorXInActiveBin,
        amountInBins,
        amountX,
        amountY,
        new BN(50)
      );
    });

    it("Both side with X in active bin", () => {
      const amountX = new BN(100_000_000);
      const amountY = new BN(100_000_000);
      const minDeltaId = new BN(30).neg();
      const maxDeltaId = new BN(30);
      const favorXInActiveBin = true;

      const { deltaX, deltaY, x0, y0 } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        binStep,
        favorXInActiveBin,
        activeId,
        builder
      );

      const amountInBins = toAmountIntoBins(
        activeId,
        minDeltaId,
        maxDeltaId,
        deltaX,
        deltaY,
        x0,
        y0,
        binStep,
        favorXInActiveBin
      );

      logLiquidityInfo(amountX, amountY, amountInBins, binStep);

      assertBinDepositResult(
        activeId,
        minDeltaId,
        maxDeltaId,
        favorXInActiveBin,
        amountInBins,
        amountX,
        amountY,
        new BN(50)
      );
    });

    it("Both side with Y in active bin", () => {
      const amountX = new BN(100_000_000);
      const amountY = new BN(100_000_000);
      const minDeltaId = new BN(30).neg();
      const maxDeltaId = new BN(30);
      const favorXInActiveBin = false;

      const { deltaX, deltaY, x0, y0 } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        binStep,
        favorXInActiveBin,
        activeId,
        builder
      );

      const amountInBins = toAmountIntoBins(
        activeId,
        minDeltaId,
        maxDeltaId,
        deltaX,
        deltaY,
        x0,
        y0,
        binStep,
        favorXInActiveBin
      );

      logLiquidityInfo(amountX, amountY, amountInBins, binStep);

      assertBinDepositResult(
        activeId,
        minDeltaId,
        maxDeltaId,
        favorXInActiveBin,
        amountInBins,
        amountX,
        amountY,
        new BN(50)
      );
    });
  });

  describe("Curve", () => {
    const builder = getLiquidityStrategyParameterBuilder(StrategyType.Curve);

    it("Bid side", () => {
      const amountX = new BN(0);
      const amountY = new BN(100_000_000);
      const minDeltaId = new BN(60).neg();
      const maxDeltaId = new BN(1).neg();
      const favorXInActiveBin = false;

      const { deltaX, deltaY, x0, y0 } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        binStep,
        favorXInActiveBin,
        activeId,
        builder
      );

      const amountInBins = toAmountIntoBins(
        activeId,
        minDeltaId,
        maxDeltaId,
        deltaX,
        deltaY,
        x0,
        y0,
        binStep,
        favorXInActiveBin
      );

      logLiquidityInfo(amountX, amountY, amountInBins, binStep);

      assertBinDepositResult(
        activeId,
        minDeltaId,
        maxDeltaId,
        favorXInActiveBin,
        amountInBins,
        amountX,
        amountY,
        new BN(50)
      );
    });

    it("Bid side and suggest ask side parameters", () => {
      let amountX = new BN(0);
      const amountY = new BN(100_000_000);
      const minDeltaId = new BN(60).neg();
      let maxDeltaId = new BN(1).neg();
      const favorXInActiveBin = true;

      const { deltaY, y0 } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        binStep,
        favorXInActiveBin,
        activeId,
        builder
      );

      maxDeltaId = maxDeltaId.add(maxDeltaId.sub(minDeltaId).addn(1));

      const {
        base: x0,
        delta: deltaX,
        amountX: suggestedAmountX,
      } = suggestBalancedXParametersFromY(
        y0,
        deltaY,
        minDeltaId,
        maxDeltaId,
        activeId,
        binStep,
        favorXInActiveBin,
        builder
      );

      amountX = suggestedAmountX;

      const amountInBins = toAmountIntoBins(
        activeId,
        minDeltaId,
        maxDeltaId,
        deltaX,
        deltaY,
        x0,
        y0,
        binStep,
        favorXInActiveBin
      );

      logLiquidityInfo(amountX, amountY, amountInBins, binStep);

      assertBinDepositResult(
        activeId,
        minDeltaId,
        maxDeltaId,
        favorXInActiveBin,
        amountInBins,
        amountX,
        amountY,
        new BN(50)
      );
    });

    it("Ask side", () => {
      const amountX = new BN(100_000_000);
      const amountY = new BN(0);
      const minDeltaId = new BN(1);
      const maxDeltaId = new BN(60);
      const favorXInActiveBin = false;

      const { deltaX, deltaY, x0, y0 } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        binStep,
        favorXInActiveBin,
        activeId,
        builder
      );

      const amountInBins = toAmountIntoBins(
        activeId,
        minDeltaId,
        maxDeltaId,
        deltaX,
        deltaY,
        x0,
        y0,
        binStep,
        favorXInActiveBin
      );

      logLiquidityInfo(amountX, amountY, amountInBins, binStep);

      assertBinDepositResult(
        activeId,
        minDeltaId,
        maxDeltaId,
        favorXInActiveBin,
        amountInBins,
        amountX,
        amountY,
        new BN(50)
      );
    });

    it("Ask side and suggest bid side parameters", () => {
      const amountX = new BN(100_000_000);
      let amountY = new BN(0);
      let minDeltaId = new BN(1);
      const maxDeltaId = new BN(60);
      const favorXInActiveBin = false;

      const { deltaX, x0 } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        binStep,
        favorXInActiveBin,
        activeId,
        builder
      );

      minDeltaId = minDeltaId.sub(maxDeltaId.sub(minDeltaId).addn(1));

      const {
        base: y0,
        delta: deltaY,
        amountY: suggestedAmountY,
      } = suggestBalancedYParametersFromX(
        x0,
        deltaX,
        minDeltaId,
        maxDeltaId,
        activeId,
        binStep,
        favorXInActiveBin,
        builder
      );

      amountY = suggestedAmountY;

      const amountInBins = toAmountIntoBins(
        activeId,
        minDeltaId,
        maxDeltaId,
        deltaX,
        deltaY,
        x0,
        y0,
        binStep,
        favorXInActiveBin
      );

      logLiquidityInfo(amountX, amountY, amountInBins, binStep);

      assertBinDepositResult(
        activeId,
        minDeltaId,
        maxDeltaId,
        favorXInActiveBin,
        amountInBins,
        amountX,
        amountY,
        new BN(50)
      );
    });

    it("Bid side involve active bin", () => {
      const amountX = new BN(0);
      const amountY = new BN(100_000_000);
      const minDeltaId = new BN(60).neg();
      const maxDeltaId = new BN(0);
      const favorXInActiveBin = false;

      const { deltaX, deltaY, x0, y0 } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        binStep,
        favorXInActiveBin,
        activeId,
        builder
      );

      const amountInBins = toAmountIntoBins(
        activeId,
        minDeltaId,
        maxDeltaId,
        deltaX,
        deltaY,
        x0,
        y0,
        binStep,
        favorXInActiveBin
      );

      logLiquidityInfo(amountX, amountY, amountInBins, binStep);

      assertBinDepositResult(
        activeId,
        minDeltaId,
        maxDeltaId,
        favorXInActiveBin,
        amountInBins,
        amountX,
        amountY,
        new BN(50)
      );
    });

    it("Ask side involve active bin", () => {
      const amountX = new BN(100_000_000);
      const amountY = new BN(0);
      const minDeltaId = new BN(0);
      const maxDeltaId = new BN(60);
      const favorXInActiveBin = true;

      const { deltaX, deltaY, x0, y0 } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        binStep,
        favorXInActiveBin,
        activeId,
        builder
      );

      const amountInBins = toAmountIntoBins(
        activeId,
        minDeltaId,
        maxDeltaId,
        deltaX,
        deltaY,
        x0,
        y0,
        binStep,
        favorXInActiveBin
      );

      logLiquidityInfo(amountX, amountY, amountInBins, binStep);

      assertBinDepositResult(
        activeId,
        minDeltaId,
        maxDeltaId,
        favorXInActiveBin,
        amountInBins,
        amountX,
        amountY,
        new BN(50)
      );
    });

    it("Both side with X in active bin", () => {
      const amountX = new BN(100_000_000);
      const amountY = new BN(100_000_000);
      const minDeltaId = new BN(30).neg();
      const maxDeltaId = new BN(30);
      const favorXInActiveBin = true;

      const { deltaX, deltaY, x0, y0 } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        binStep,
        favorXInActiveBin,
        activeId,
        builder
      );

      const amountInBins = toAmountIntoBins(
        activeId,
        minDeltaId,
        maxDeltaId,
        deltaX,
        deltaY,
        x0,
        y0,
        binStep,
        favorXInActiveBin
      );

      logLiquidityInfo(amountX, amountY, amountInBins, binStep);

      assertBinDepositResult(
        activeId,
        minDeltaId,
        maxDeltaId,
        favorXInActiveBin,
        amountInBins,
        amountX,
        amountY,
        new BN(50)
      );
    });

    it("Both side with Y in active bin", () => {
      const amountX = new BN(100_000_000);
      const amountY = new BN(100_000_000);
      const minDeltaId = new BN(30).neg();
      const maxDeltaId = new BN(30);
      const favorXInActiveBin = false;

      const { deltaX, deltaY, x0, y0 } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        binStep,
        favorXInActiveBin,
        activeId,
        builder
      );

      const amountInBins = toAmountIntoBins(
        activeId,
        minDeltaId,
        maxDeltaId,
        deltaX,
        deltaY,
        x0,
        y0,
        binStep,
        favorXInActiveBin
      );

      logLiquidityInfo(amountX, amountY, amountInBins, binStep);

      assertBinDepositResult(
        activeId,
        minDeltaId,
        maxDeltaId,
        favorXInActiveBin,
        amountInBins,
        amountX,
        amountY,
        new BN(50)
      );
    });
  });

  describe("BidAsk", () => {
    const builder = getLiquidityStrategyParameterBuilder(StrategyType.BidAsk);

    it("Bid side", () => {
      const amountX = new BN(0);
      const amountY = new BN(100_000_000);
      const minDeltaId = new BN(60).neg();
      const maxDeltaId = new BN(1).neg();
      const favorXInActiveBin = false;

      const { deltaX, deltaY, x0, y0 } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        binStep,
        favorXInActiveBin,
        activeId,
        builder
      );

      const amountInBins = toAmountIntoBins(
        activeId,
        minDeltaId,
        maxDeltaId,
        deltaX,
        deltaY,
        x0,
        y0,
        binStep,
        favorXInActiveBin
      );

      logLiquidityInfo(amountX, amountY, amountInBins, binStep);

      assertBinDepositResult(
        activeId,
        minDeltaId,
        maxDeltaId,
        favorXInActiveBin,
        amountInBins,
        amountX,
        amountY,
        new BN(2000)
      );
    });

    it("Bid side suggest ask side parameters", () => {
      let amountX = new BN(0);
      const amountY = new BN(100_000_000);
      const minDeltaId = new BN(60).neg();
      let maxDeltaId = new BN(1).neg();
      const favorXInActiveBin = true;

      const { deltaY, y0 } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        binStep,
        favorXInActiveBin,
        activeId,
        builder
      );

      maxDeltaId = maxDeltaId.add(maxDeltaId.sub(minDeltaId).addn(1));

      const {
        delta: deltaX,
        base: x0,
        amountX: suggestedAmountX,
      } = suggestBalancedXParametersFromY(
        y0,
        deltaY,
        minDeltaId,
        maxDeltaId,
        activeId,
        binStep,
        favorXInActiveBin,
        builder
      );

      amountX = suggestedAmountX;

      const amountInBins = toAmountIntoBins(
        activeId,
        minDeltaId,
        maxDeltaId,
        deltaX,
        deltaY,
        x0,
        y0,
        binStep,
        favorXInActiveBin
      );

      logLiquidityInfo(amountX, amountY, amountInBins, binStep);

      assertBinDepositResult(
        activeId,
        minDeltaId,
        maxDeltaId,
        favorXInActiveBin,
        amountInBins,
        amountX,
        amountY,
        new BN(2000)
      );
    });

    it("Ask side", () => {
      const amountX = new BN(100_000_000);
      const amountY = new BN(0);
      const minDeltaId = new BN(1);
      const maxDeltaId = new BN(60);
      const favorXInActiveBin = false;

      const { deltaX, deltaY, x0, y0 } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        binStep,
        favorXInActiveBin,
        activeId,
        builder
      );

      const amountInBins = toAmountIntoBins(
        activeId,
        minDeltaId,
        maxDeltaId,
        deltaX,
        deltaY,
        x0,
        y0,
        binStep,
        favorXInActiveBin
      );

      logLiquidityInfo(amountX, amountY, amountInBins, binStep);

      assertBinDepositResult(
        activeId,
        minDeltaId,
        maxDeltaId,
        favorXInActiveBin,
        amountInBins,
        amountX,
        amountY,
        new BN(1000)
      );
    });

    it("Ask side suggest bid side parameters", () => {
      const amountX = new BN(100_000_000);
      let amountY = new BN(0);
      let minDeltaId = new BN(1);
      const maxDeltaId = new BN(60);
      const favorXInActiveBin = false;

      const { deltaX, x0 } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        binStep,
        favorXInActiveBin,
        activeId,
        builder
      );

      minDeltaId = minDeltaId.sub(maxDeltaId.sub(minDeltaId).addn(1));

      const {
        delta: deltaY,
        base: y0,
        amountY: suggestedAmountY,
      } = suggestBalancedYParametersFromX(
        x0,
        deltaX,
        minDeltaId,
        maxDeltaId,
        activeId,
        binStep,
        favorXInActiveBin,
        builder
      );

      amountY = suggestedAmountY;

      const amountInBins = toAmountIntoBins(
        activeId,
        minDeltaId,
        maxDeltaId,
        deltaX,
        deltaY,
        x0,
        y0,
        binStep,
        favorXInActiveBin
      );

      logLiquidityInfo(amountX, amountY, amountInBins, binStep);

      assertBinDepositResult(
        activeId,
        minDeltaId,
        maxDeltaId,
        favorXInActiveBin,
        amountInBins,
        amountX,
        amountY,
        new BN(1000)
      );
    });

    it("Bid side involve active bin", () => {
      const amountX = new BN(0);
      const amountY = new BN(100_000_000);
      const minDeltaId = new BN(60).neg();
      const maxDeltaId = new BN(0);
      const favorXInActiveBin = false;

      const { deltaX, deltaY, x0, y0 } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        binStep,
        favorXInActiveBin,
        activeId,
        builder
      );

      const amountInBins = toAmountIntoBins(
        activeId,
        minDeltaId,
        maxDeltaId,
        deltaX,
        deltaY,
        x0,
        y0,
        binStep,
        favorXInActiveBin
      );

      logLiquidityInfo(amountX, amountY, amountInBins, binStep);

      assertBinDepositResult(
        activeId,
        minDeltaId,
        maxDeltaId,
        favorXInActiveBin,
        amountInBins,
        amountX,
        amountY,
        new BN(2000)
      );
    });

    it("Ask side involve active bin", () => {
      const amountX = new BN(100_000_000);
      const amountY = new BN(0);
      const minDeltaId = new BN(0);
      const maxDeltaId = new BN(60);
      const favorXInActiveBin = true;

      const { deltaX, deltaY, x0, y0 } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        binStep,
        favorXInActiveBin,
        activeId,
        builder
      );

      const amountInBins = toAmountIntoBins(
        activeId,
        minDeltaId,
        maxDeltaId,
        deltaX,
        deltaY,
        x0,
        y0,
        binStep,
        favorXInActiveBin
      );

      assertBinDepositResult(
        activeId,
        minDeltaId,
        maxDeltaId,
        favorXInActiveBin,
        amountInBins,
        amountX,
        amountY,
        new BN(1000)
      );

      logLiquidityInfo(amountX, amountY, amountInBins, binStep);
    });

    it("Both side with X in active bin", () => {
      const amountX = new BN(100_000_000);
      const amountY = new BN(100_000_000);
      const minDeltaId = new BN(30).neg();
      const maxDeltaId = new BN(30);
      const favorXInActiveBin = true;

      const { deltaX, deltaY, x0, y0 } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        binStep,
        favorXInActiveBin,
        activeId,
        builder
      );

      const amountInBins = toAmountIntoBins(
        activeId,
        minDeltaId,
        maxDeltaId,
        deltaX,
        deltaY,
        x0,
        y0,
        binStep,
        favorXInActiveBin
      );

      logLiquidityInfo(amountX, amountY, amountInBins, binStep);

      assertBinDepositResult(
        activeId,
        minDeltaId,
        maxDeltaId,
        favorXInActiveBin,
        amountInBins,
        amountX,
        amountY,
        new BN(1000)
      );
    });

    it("Both side with Y in active bin", () => {
      const amountX = new BN(100_000_000);
      const amountY = new BN(100_000_000);
      const minDeltaId = new BN(30).neg();
      const maxDeltaId = new BN(30);
      const favorXInActiveBin = false;

      const { deltaX, deltaY, x0, y0 } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        binStep,
        favorXInActiveBin,
        activeId,
        builder
      );

      const amountInBins = toAmountIntoBins(
        activeId,
        minDeltaId,
        maxDeltaId,
        deltaX,
        deltaY,
        x0,
        y0,
        binStep,
        favorXInActiveBin
      );

      logLiquidityInfo(amountX, amountY, amountInBins, binStep);

      assertBinDepositResult(
        activeId,
        minDeltaId,
        maxDeltaId,
        favorXInActiveBin,
        amountInBins,
        amountX,
        amountY,
        new BN(1000)
      );
    });
  });
});
