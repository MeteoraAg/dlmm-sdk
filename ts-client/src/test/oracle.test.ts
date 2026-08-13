import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import {
  DynamicOracle,
  Observation,
} from "../dlmm/helpers/oracle/wrapper";
import { Oracle } from "../dlmm/types";
import { getPriceOfBinByBinId } from "../dlmm/helpers/weight";

function obs(
  cumulative: number,
  createdAt: number,
  lastUpdatedAt: number
): Observation {
  return new Observation(
    new BN(cumulative),
    new BN(createdAt),
    new BN(lastUpdatedAt)
  );
}

const UNINIT = obs(0, 0, 0);

function createOracle(params: {
  idx: number;
  activeSize: number;
  observations: Observation[];
  binStep?: number;
  currentActiveBinId?: number;
  baseTokenDecimals?: number;
  quoteTokenDecimals?: number;
}): DynamicOracle {
  const metadata = {
    idx: new BN(params.idx),
    activeSize: new BN(params.activeSize),
    length: new BN(params.observations.length),
  } as Oracle;

  return new DynamicOracle(
    PublicKey.default,
    metadata,
    params.observations,
    params.binStep ?? 1,
    new BN(params.currentActiveBinId ?? 100),
    params.baseTokenDecimals ?? 9,
    params.quoteTokenDecimals ?? 6
  );
}

describe("DynamicOracle", () => {
  // Standard buffer: constant bin ID = 100, cumId(t) = 100 * t
  // idx=2, activeSize=3 → earliest at obs[0] (nextIndex=0)
  const standardObs = () => [
    obs(10000, 100, 100), // t=100
    obs(20000, 200, 200), // t=200
    obs(30000, 300, 300), // t=300 (latest)
  ];

  describe("nextIndex", () => {
    it("wraps to 0 when idx is at last position", () => {
      const oracle = createOracle({
        idx: 4,
        activeSize: 5,
        observations: [obs(0, 1, 1), obs(0, 1, 1), obs(0, 1, 1), obs(0, 1, 1), obs(0, 1, 1)],
      });
      expect(oracle.nextIndex()).toBe(0);
    });

    it("wraps with activeSize=1", () => {
      const oracle = createOracle({
        idx: 0,
        activeSize: 1,
        observations: [obs(0, 1, 1)],
      });
      expect(oracle.nextIndex()).toBe(0);
    });
  });

  describe("getEarliestSample / getLatestSample", () => {
    it("getLatestSample returns observations[idx]", () => {
      const oracle = createOracle({ idx: 1, activeSize: 3, observations: standardObs() });
      expect(oracle.getLatestSample().cumulativeActiveBinId.toNumber()).toBe(20000);
    });

    it("getEarliestSample returns observations[nextIndex()]", () => {
      // idx=1, activeSize=3 → nextIndex=2
      const oracle = createOracle({ idx: 1, activeSize: 3, observations: standardObs() });
      expect(oracle.getEarliestSample().cumulativeActiveBinId.toNumber()).toBe(30000);
    });

    it("both return same observation when activeSize=1", () => {
      const oracle = createOracle({ idx: 0, activeSize: 1, observations: [obs(10, 100, 100)] });
      expect(oracle.getEarliestSample()).toBe(oracle.getLatestSample());
    });
  });

  describe("getEarliestTimestamp", () => {
    it("returns lastUpdatedAt when earliest is initialized", () => {
      const oracle = createOracle({ idx: 2, activeSize: 3, observations: standardObs() });
      // nextIndex=0, earliest=obs[0] with lastUpdatedAt=100
      expect(oracle.getEarliestTimestamp().toNumber()).toBe(100);
    });

    it("returns null when earliest is uninitialized", () => {
      // idx=0, activeSize=2 → earliest=obs[1] which is UNINIT
      const oracle = createOracle({ idx: 0, activeSize: 2, observations: [obs(10, 100, 100), UNINIT] });
      expect(oracle.getEarliestTimestamp()).toBeNull();
    });
  });

  describe("getMaxDuration", () => {
    it("returns currentTimestamp - earliest when valid", () => {
      const oracle = createOracle({ idx: 2, activeSize: 3, observations: standardObs() });
      expect(oracle.getMaxDuration(new BN(500)).toNumber()).toBe(400);
    });

    it("returns 0 when no initialized observations", () => {
      const oracle = createOracle({ idx: 0, activeSize: 2, observations: [UNINIT, UNINIT] });
      expect(oracle.getMaxDuration(new BN(500)).toNumber()).toBe(0);
    });

    it("returns 0 when currentTimestamp <= earliest", () => {
      const oracle = createOracle({ idx: 2, activeSize: 3, observations: standardObs() });
      expect(oracle.getMaxDuration(new BN(100)).toNumber()).toBe(0);
      expect(oracle.getMaxDuration(new BN(50)).toNumber()).toBe(0);
    });
  });

  describe("findCumulativeActiveIdByTimestamp", () => {
    const activeId = new BN(100);

    describe("null cases", () => {
      it("returns null when latest sample is uninitialized", () => {
        const oracle = createOracle({ idx: 0, activeSize: 1, observations: [UNINIT] });
        expect(oracle.findCumulativeActiveIdByTimestamp(activeId, new BN(100))).toBeNull();
      });

      it("returns null when timestamp is before earliest", () => {
        const oracle = createOracle({ idx: 2, activeSize: 3, observations: standardObs() });
        // earliest at t=100, query t=50
        expect(oracle.findCumulativeActiveIdByTimestamp(activeId, new BN(50))).toBeNull();
      });
    });

    describe("forward extrapolation", () => {
      it("timestamp equals latest returns latest cumId", () => {
        const oracle = createOracle({ idx: 2, activeSize: 3, observations: standardObs() });
        // latest at t=300, cumId=30000. delta=0, so result=30000
        const result = oracle.findCumulativeActiveIdByTimestamp(activeId, new BN(300));
        expect(result.toNumber()).toBe(30000);
      });

      it("timestamp after latest extrapolates with activeId", () => {
        const oracle = createOracle({ idx: 2, activeSize: 3, observations: standardObs() });
        // latest cumId=30000, t=300. query t=400. delta=100. result=30000 + 100*100 = 40000
        const result = oracle.findCumulativeActiveIdByTimestamp(activeId, new BN(400));
        expect(result.toNumber()).toBe(40000);
      });

      it("extrapolation with negative activeId", () => {
        const oracle = createOracle({
          idx: 2,
          activeSize: 3,
          observations: standardObs(),
          currentActiveBinId: -50,
        });
        // latest cumId=30000, t=300. query t=500. delta=200. result=30000 + (-50)*200 = 20000
        const result = oracle.findCumulativeActiveIdByTimestamp(new BN(-50), new BN(500));
        expect(result.toNumber()).toBe(20000);
      });
    });

    describe("interpolation", () => {
      it("timestamp exactly at a non-latest observation", () => {
        const oracle = createOracle({ idx: 2, activeSize: 3, observations: standardObs() });
        // Walk: (2,1). timestamp=200 >= obs[1].lastUpdatedAt=200? Yes.
        // totalWeight=300-200=100, prevWeight=300-200=100, nextWeight=200-200=0
        // result = (20000*100 + 30000*0) / 100 = 20000
        const result = oracle.findCumulativeActiveIdByTimestamp(activeId, new BN(200));
        expect(result.toNumber()).toBe(20000);
      });

      it("timestamp at midpoint between two observations", () => {
        const oracle = createOracle({ idx: 2, activeSize: 3, observations: standardObs() });
        // Walk: (2,1). timestamp=250 >= obs[1].lastUpdatedAt=200? Yes.
        // totalWeight=100, prevWeight=50, nextWeight=50
        // result = (20000*50 + 30000*50) / 100 = 25000
        const result = oracle.findCumulativeActiveIdByTimestamp(activeId, new BN(250));
        expect(result.toNumber()).toBe(25000);
      });

      it("circular buffer wraparound during walk", () => {
        // idx=1, activeSize=4 → walk: (1,0), (0,3), (3,2)
        // earliest = obs[2] (nextIndex=2)
        const observations = [
          obs(100, 200, 200),  // obs[0]
          obs(300, 400, 400),  // obs[1] (latest, idx=1)
          obs(0, 100, 100),    // obs[2] (earliest, nextIndex=2)
          obs(50, 150, 150),   // obs[3]
        ];
        const oracle = createOracle({ idx: 1, activeSize: 4, observations });

        // Query timestamp=125 (between obs[2] at t=100 and obs[3] at t=150)
        // Walk: (1,0): 125 >= obs[0].lastUpdatedAt=200? No.
        //        (0,3): wrap. 125 >= obs[3].lastUpdatedAt=150? No.
        //        (3,2): 125 >= obs[2].lastUpdatedAt=100? Yes.
        // totalWeight=150-100=50, prevWeight=150-125=25, nextWeight=125-100=25
        // result = (0*25 + 50*25) / 50 = 25
        const result = oracle.findCumulativeActiveIdByTimestamp(activeId, new BN(125));
        expect(result.toNumber()).toBe(25);
      });

      it("negative cumulative values", () => {
        const observations = [
          obs(-500, 100, 100), // obs[0] (earliest)
          obs(-200, 200, 200), // obs[1] (latest)
        ];
        const oracle = createOracle({ idx: 1, activeSize: 2, observations });

        // Query timestamp=150 (midpoint)
        // Walk: (1,0). 150 >= obs[0].lastUpdatedAt=100? Yes.
        // totalWeight=100, prevWeight=50, nextWeight=50
        // result = (-500*50 + -200*50) / 100 = -35000 / 100 = -350
        const result = oracle.findCumulativeActiveIdByTimestamp(activeId, new BN(150));
        expect(result.toNumber()).toBe(-350);
      });
    });
  });

  describe("getActiveIdByTime", () => {
    it("constant active bin TWAP equals that bin ID", () => {
      // cumId(t) = 100*t. TWAP(100, 300) = (30000 - 10000) / 200 = 100
      const oracle = createOracle({ idx: 2, activeSize: 3, observations: standardObs() });
      const result = oracle.getActiveIdByTime(new BN(100), new BN(300));
      expect(result.value.toNumber()).toBe(100);
      expect(result.duration.toNumber()).toBe(200);
    });
  });

  describe("getActiveId", () => {
    it("returns TWAP from earliest to currentTimestamp", () => {
      const oracle = createOracle({
        idx: 2,
        activeSize: 3,
        observations: standardObs(),
        currentActiveBinId: 100,
      });
      // earliest=100, currentTimestamp=400
      // cumId(100)=10000, cumId(400)=30000+100*100=40000
      // TWAP = (40000 - 10000) / 300 = 100
      const result = oracle.getActiveId(new BN(400));
      expect(result.value.toNumber()).toBe(100);
      expect(result.duration.toNumber()).toBe(300);
    });
  });

  describe("getPriceByTime", () => {
    it("positive bin ID produces correct price", () => {
      // TWAP bin ID = 100 with binStep=10
      const oracle = createOracle({
        idx: 2,
        activeSize: 3,
        observations: standardObs(),
        binStep: 10,
      });
      const result = oracle.getPriceByTime(new BN(100), new BN(300));
      const expectedPrice = getPriceOfBinByBinId(100, 10);
      expect(result.value.eq(expectedPrice)).toBe(true);
      expect(result.duration.toNumber()).toBe(200);
    });
  });

  describe("getUiPriceByTime", () => {
    it("base=9 quote=6 applies multiplier and floors to quoteDecimals", () => {
      // TWAP bin ID = 100, binStep=10, base=9, quote=6
      const oracle = createOracle({
        idx: 2,
        activeSize: 3,
        observations: standardObs(),
        binStep: 10,
        baseTokenDecimals: 9,
        quoteTokenDecimals: 6,
      });
      const result = oracle.getUiPriceByTime(new BN(100), new BN(300));

      const rawPrice = getPriceOfBinByBinId(100, 10);
      const uiMultiplier = new Decimal(10).pow(9 - 6);
      const quoteAdjustment = new Decimal(10).pow(6);
      const expectedUiPrice = rawPrice
        .mul(uiMultiplier)
        .mul(quoteAdjustment)
        .floor()
        .div(quoteAdjustment);

      expect(result.value.eq(expectedUiPrice)).toBe(true);
      expect(result.duration.toNumber()).toBe(200);
    });
  });
});
