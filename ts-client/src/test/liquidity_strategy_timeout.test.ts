import BN from "bn.js";

function sleepMs(ms: number) {
  const start = Date.now();
  while (Date.now() - start < ms) {}
}

describe("Liquidity strategy timeouts", () => {
  const activeId = new BN(1000);
  const binStep = new BN(10);

  it("Spot and Curve builders complete within 15s", () => {
    jest.resetModules();
    const {
      buildLiquidityStrategyParameters,
      getLiquidityStrategyParameterBuilder,
    } = require("../dlmm/helpers/rebalance");
    const { StrategyType } = require("../dlmm/types");
    const amountX = new BN(10_000);
    const amountY = new BN(10_000);
    const minDeltaId = new BN(-3);
    const maxDeltaId = new BN(3);
    const favorXInActiveBin = false;

    const builders = [
      getLiquidityStrategyParameterBuilder(StrategyType.Spot),
      getLiquidityStrategyParameterBuilder(StrategyType.Curve),
    ];

    for (const builder of builders) {
      const start = Date.now();
      buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        binStep,
        favorXInActiveBin,
        activeId,
        builder
      );
      const elapsedMs = Date.now() - start;
      expect(elapsedMs).toBeLessThan(15_000);
    }
  });

  it("BidAsk can exceed 15s with pathological bid-side loops", () => {
    jest.resetModules();
    const amountX = new BN(0);
    const amountY = new BN(20_000);
    const minDeltaId = new BN(-1);
    const maxDeltaId = new BN(-1);
    const favorXInActiveBin = false;

    jest.doMock("../dlmm/helpers/rebalance/rebalancePosition", () => {
      const actual = jest.requireActual(
        "../dlmm/helpers/rebalance/rebalancePosition"
      );
      return {
        ...actual,
        getAmountInBinsBidSide: jest.fn((_activeId, _min, _max, deltaY) => {
          sleepMs(100);
          if (deltaY.gt(new BN(0))) {
            return [
              { binId: activeId, amountX: new BN(0), amountY: amountY.addn(1) },
            ];
          }

          return [{ binId: activeId, amountX: new BN(0), amountY }];
        }),
      };
    });

    const rebalancePosition = require("../dlmm/helpers/rebalance/rebalancePosition");
    const getAmountInBinsBidSide = rebalancePosition.getAmountInBinsBidSide;
    expect(jest.isMockFunction(getAmountInBinsBidSide)).toBe(true);
    const {
      buildLiquidityStrategyParameters,
      getLiquidityStrategyParameterBuilder,
    } = require("../dlmm/helpers/rebalance");
    const { StrategyType } = require("../dlmm/types");
    const builder = getLiquidityStrategyParameterBuilder(StrategyType.BidAsk);

    const start = Date.now();
    buildLiquidityStrategyParameters(
      amountX,
      amountY,
      minDeltaId,
      maxDeltaId,
      binStep,
      favorXInActiveBin,
      activeId,
      builder
    );
    const elapsedMs = Date.now() - start;
    expect(elapsedMs).toBeLessThan(15_000);
  }, 15_000);
});
