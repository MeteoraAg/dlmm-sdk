import BN from "bn.js";
import Decimal from "decimal.js";
import { MAX_BIN_ID_PER_BIN_STEP, U64_MAX } from "../dlmm/constants";
import { findBaseDeltaX } from "../dlmm/helpers/rebalance/liquidity_strategy/bidAsk";
import { getAmountInBinsAskSide } from "../dlmm/helpers/rebalance/rebalancePosition";

// Sample of on-chain preset bin steps (the program's PRESET_BIN_STEP; not exposed in the TS SDK).
const BIN_STEPS = [1, 2, 4, 5, 8, 10, 15, 20, 25, 50, 60, 100];

function supportedBound(binStep: number): number {
  return Math.trunc(MAX_BIN_ID_PER_BIN_STEP / binStep);
}

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function randAmount(min: BN, max: BN): BN {
  const span = new Decimal(max.sub(min).add(new BN(1)).toString());
  const offset = span.mul(Decimal.random()).floor();
  return min.add(new BN(offset.toFixed(0)));
}

interface Case {
  amountX: BN;
  minDeltaId: number;
  maxDeltaId: number;
  binStep: number;
  activeId: number;
}

// Mirrors the first iteration of the while loop in findX0AndDeltaX
// (src/dlmm/helpers/rebalance/liquidity_strategy/bidAsk.ts:189).
function checkCase(c: Case): string | null {
  const amountX = c.amountX;
  const minDeltaId = new BN(c.minDeltaId);
  const maxDeltaId = new BN(c.maxDeltaId);
  const binStep = new BN(c.binStep);
  const activeId = new BN(c.activeId);

  const baseDeltaX = findBaseDeltaX(
    amountX,
    minDeltaId,
    maxDeltaId,
    binStep,
    activeId,
  );
  // No representable slope -> nothing deposited on the first iteration.
  if (baseDeltaX.lte(new BN(0))) return null;

  const x0 = minDeltaId.neg().addn(1).mul(baseDeltaX);

  const amountInBins = getAmountInBinsAskSide(
    activeId,
    binStep,
    minDeltaId,
    maxDeltaId,
    baseDeltaX,
    x0,
  );

  const totalAmountX = amountInBins.reduce(
    (acc, { amountX }) => acc.add(amountX),
    new BN(0),
  );

  if (totalAmountX.gt(amountX)) {
    return (
      `totalAmountX > amountX\n` +
      `  binStep=${c.binStep} activeId=${c.activeId} ` +
      `minDeltaId=${c.minDeltaId} maxDeltaId=${c.maxDeltaId}\n` +
      `  amountX     =${amountX.toString()}\n` +
      `  baseDeltaX  =${baseDeltaX.toString()}\n` +
      `  x0          =${x0.toString()}\n` +
      `  totalAmountX=${totalAmountX.toString()}\n` +
      `  overBy      =${totalAmountX.sub(amountX).toString()}`
    );
  }
  return null;
}

function randomCase(): Case {
  const binStep = BIN_STEPS[randInt(0, BIN_STEPS.length - 1)];
  const bound = supportedBound(binStep);

  const minDeltaId = randInt(0, 20);
  const width = randInt(0, 150);
  const maxDeltaId = minDeltaId + width;

  const loActive = -bound - minDeltaId;
  const hiActive = bound - maxDeltaId;
  const activeId = randInt(loActive, hiActive);

  // Random upper bound spanning many magnitudes (10^4 .. 10^20), capped at u64::MAX,
  // so amountX is a random value above 1000 up to the max.
  const maxAmount = BN.min(new BN(10).pow(new BN(randInt(4, 20))), U64_MAX);
  const amountX = randAmount(new BN(1000), maxAmount);

  return { amountX, minDeltaId, maxDeltaId, binStep, activeId };
}

describe("BidAsk findBaseDeltaX first-iteration property", () => {
  it("totalAmountX <= amountX over fuzzed ask-side inputs", () => {
    // Default kept CI-friendly; crank it up with PROPTEST_ITERATIONS=200000 locally.
    const ITERATIONS = Number(process.env.PROPTEST_ITERATIONS ?? 20_000);
    let checked = 0;

    for (let i = 0; i < ITERATIONS; i++) {
      const c = randomCase();
      const failure = checkCase(c);
      if (failure) {
        throw new Error(`Property violated at iteration ${i}:\n${failure}`);
      }
      checked++;
    }

    expect(checked).toBe(ITERATIONS);
  }, 120_000);

  it("holds for known hard / regression cases", () => {
    const cases: Case[] = [
      {
        amountX: new BN("18446744073709551615"),
        minDeltaId: 0,
        maxDeltaId: 2,
        binStep: 5,
        activeId: -50000,
      },
      {
        amountX: new BN("18446744073709551615"),
        minDeltaId: 0,
        maxDeltaId: 0,
        binStep: 1,
        activeId: 0,
      },
      {
        amountX: new BN("18446744073709551615"),
        minDeltaId: 1,
        maxDeltaId: 2,
        binStep: 100,
        activeId: -2900,
      },
      {
        amountX: new BN("18446744073709551615"),
        minDeltaId: 0,
        maxDeltaId: 1,
        binStep: 10,
        activeId: 20000 - 1,
      },
      {
        amountX: new BN(1),
        minDeltaId: 0,
        maxDeltaId: 0,
        binStep: 1,
        activeId: 0,
      },
      {
        amountX: new BN(3),
        minDeltaId: 1,
        maxDeltaId: 5,
        binStep: 100,
        activeId: -2895,
      },
    ];

    for (const c of cases) {
      const failure = checkCase(c);
      expect(failure).toBeNull();
    }
  });
});
