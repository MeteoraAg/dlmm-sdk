import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { Oracle } from "../../types";
import Decimal from "decimal.js";
import { getPriceOfBinByBinId } from "../weight";
import { Program } from "@coral-xyz/anchor";
import { LbClmm } from "../../idl/idl";
import { decodeAccount } from "..";

/** Size in bytes of the oracle account metadata (discriminator + header fields). */
const ORACLE_METADATA_SIZE = 8 + 24;
/** Size in bytes of a single observation entry (cumulativeActiveBinId: 16 + createdAt: 8 + lastUpdatedAt: 8). */
const OBSERVATION_SIZE = 32;

/** Result of a TWAP (Time-Weighted Average Price) computation over a time range. */
export interface TwapResult<T> {
  /** The computed TWAP value (active bin ID or price depending on the query). */
  value: T;
  /** Duration in seconds over which the TWAP was computed. */
  duration: BN;
}

/**
 * Interface for querying time-weighted average data from an on-chain DLMM oracle.
 * Provides methods to retrieve TWAP active bin IDs and prices over arbitrary time ranges.
 */
export interface IDynamicOracle {
  /** Returns the maximum observable duration from the earliest sample to the given timestamp. */
  getMaxDuration(currentTimestamp: BN): BN;
  /**
   * Computes the TWAP active bin ID between two arbitrary time points.
   * @param timePoint0 - First time boundary (order does not matter).
   * @param timePoint1 - Second time boundary (order does not matter).
   * @returns The TWAP active bin ID and duration, or null if the range is not covered by oracle data.
   */
  getActiveIdByTime(timePoint0: BN, timePoint1: BN): TwapResult<BN> | null;
  /**
   * Computes the TWAP active bin ID from the earliest available observation to the current timestamp.
   * @param currentTimestamp - The current on-chain timestamp.
   * @returns The TWAP active bin ID and duration, or null if no data is available.
   */
  getActiveId(currentTimestamp: BN): TwapResult<BN> | null;
  /**
   * Computes the TWAP price (as a raw Decimal) between two time points.
   * @param timePoint0 - First time boundary.
   * @param timePoint1 - Second time boundary.
   * @returns The TWAP price and duration, or null if the range is not covered.
   */
  getPriceByTime(timePoint0: BN, timePoint1: BN): TwapResult<Decimal> | null;
  /**
   * Computes the TWAP price adjusted for token decimals (human-readable) between two time points.
   * @param timePoint0 - First time boundary.
   * @param timePoint1 - Second time boundary.
   * @returns The UI-friendly TWAP price and duration, or null if the range is not covered.
   */
  getUiPriceByTime(timePoint0: BN, timePoint1: BN): TwapResult<Decimal> | null;
}

export class Observation {
  constructor(
    public cumulativeActiveBinId: BN,
    public createdAt: BN,
    public lastUpdatedAt: BN,
  ) {}

  isInitialized(): boolean {
    return !this.createdAt.isZero() && !this.lastUpdatedAt.isZero();
  }
}

export function wrapOracle(
  oracleAddress: PublicKey,
  data: Buffer,
  binStep: number,
  currentActiveBinId: BN,
  baseTokenDecimals: number,
  quoteTokenDecimals: number,
  program: Program<LbClmm>,
) {
  const oracleBaseData = data.subarray(0, ORACLE_METADATA_SIZE);
  const oracleState: Oracle = decodeAccount(program, "oracle", oracleBaseData);

  const observationSlice = data.subarray(ORACLE_METADATA_SIZE);
  let observations: Observation[] = [];

  for (let i = 0; i < oracleState.length.toNumber(); i++) {
    let offset = i * OBSERVATION_SIZE;

    const cumulativeActiveBinIdSlice = observationSlice.subarray(
      offset,
      offset + 16,
    );

    const cumulativeActiveBinId = new BN(
      cumulativeActiveBinIdSlice,
      "le",
    ).fromTwos(128);

    offset += 16;

    const createdAtSlice = observationSlice.subarray(offset, offset + 8);
    const createdAt = new BN(createdAtSlice, "le");

    offset += 8;

    const lastUpdatedAtSlice = observationSlice.subarray(offset, offset + 8);
    const lastUpdatedAt = new BN(lastUpdatedAtSlice, "le");

    observations.push(
      new Observation(cumulativeActiveBinId, createdAt, lastUpdatedAt),
    );
  }

  return new DynamicOracle(
    oracleAddress,
    oracleState,
    observations,
    binStep,
    currentActiveBinId,
    baseTokenDecimals,
    quoteTokenDecimals,
  );
}

export class DynamicOracle implements IDynamicOracle {
  constructor(
    public oracleAddress: PublicKey,
    public metadata: Oracle,
    private observations: Observation[],
    private binStep: number,
    private currentActiveBinId: BN,
    private baseTokenDecimals: number,
    private quoteTokenDecimals: number,
  ) {}

  nextIndex(): number {
    const currentIndex = this.metadata.idx.toNumber();
    const nextIndex = currentIndex + 1;
    return nextIndex >= this.metadata.activeSize.toNumber() ? 0 : nextIndex;
  }

  getEarliestSample(): Observation {
    const earliestIndex = this.nextIndex();
    return this.observations[earliestIndex];
  }

  getLatestSample(): Observation {
    return this.observations[this.metadata.idx.toNumber()];
  }

  findCumulativeActiveIdByTimestamp(activeId: BN, timestamp: BN): BN | null {
    const latestSample = this.getLatestSample();

    if (!latestSample.isInitialized()) {
      return null;
    }

    if (timestamp.gte(latestSample.lastUpdatedAt)) {
      const deltaSeconds = timestamp.sub(latestSample.lastUpdatedAt);
      const accumulatedActiveId = activeId.mul(deltaSeconds);
      return latestSample.cumulativeActiveBinId.add(accumulatedActiveId);
    }

    const earliestSample = this.getEarliestSample();

    if (
      !earliestSample.isInitialized() ||
      timestamp.lt(earliestSample.lastUpdatedAt)
    ) {
      return null;
    }

    let currentIndex = this.metadata.idx.toNumber();

    while (true) {
      let previousIndex =
        currentIndex == 0
          ? this.metadata.activeSize.toNumber() - 1
          : currentIndex - 1;

      if (previousIndex == this.metadata.idx.toNumber()) {
        return null;
      }

      const currentSample = this.observations[currentIndex];
      const previousSample = this.observations[previousIndex];

      if (timestamp.gte(previousSample.lastUpdatedAt)) {
        const totalWeight = currentSample.lastUpdatedAt.sub(
          previousSample.lastUpdatedAt,
        );
        if (totalWeight.isZero()) {
          return previousSample.cumulativeActiveBinId;
        }
        const prevWeight = currentSample.lastUpdatedAt.sub(timestamp);
        const nextWeight = timestamp.sub(previousSample.lastUpdatedAt);
        return previousSample.cumulativeActiveBinId
          .mul(prevWeight)
          .add(currentSample.cumulativeActiveBinId.mul(nextWeight))
          .div(totalWeight);
      }

      currentIndex = previousIndex;
    }
  }

  getActiveIdByTime(timePoint0: BN, timePoint1: BN): TwapResult<BN> | null {
    const t0 = BN.min(timePoint0, timePoint1);
    const t1 = BN.max(timePoint0, timePoint1);
    const duration = t1.sub(t0);

    if (duration.isZero()) {
      return null;
    }

    const cumulativeActiveBinId0 = this.findCumulativeActiveIdByTimestamp(
      this.currentActiveBinId,
      t0,
    );

    if (cumulativeActiveBinId0 === null) {
      return null;
    }

    const cumulativeActiveBinId1 = this.findCumulativeActiveIdByTimestamp(
      this.currentActiveBinId,
      t1,
    );

    if (cumulativeActiveBinId1 === null) {
      return null;
    }

    return {
      value: cumulativeActiveBinId1.sub(cumulativeActiveBinId0).div(duration),
      duration,
    };
  }

  getActiveId(currentTimestamp: BN): TwapResult<BN> | null {
    const timePoint0 = this.getEarliestTimestamp();

    if (timePoint0 === null) {
      return { value: this.currentActiveBinId, duration: new BN(0) };
    }

    const timePoint1 = currentTimestamp;
    return this.getActiveIdByTime(timePoint0, timePoint1);
  }

  getEarliestTimestamp(): BN | null {
    const earliestSample = this.getEarliestSample();
    return earliestSample.isInitialized() ? earliestSample.lastUpdatedAt : null;
  }

  getPriceByTime(timePoint0: BN, timePoint1: BN): TwapResult<Decimal> | null {
    const result = this.getActiveIdByTime(timePoint0, timePoint1);

    if (result === null) {
      return null;
    }

    return {
      value: getPriceOfBinByBinId(result.value.toNumber(), this.binStep),
      duration: result.duration,
    };
  }

  getUiPriceByTime(timePoint0: BN, timePoint1: BN): TwapResult<Decimal> | null {
    const result = this.getPriceByTime(timePoint0, timePoint1);

    if (result === null) {
      return null;
    }

    const uiMultiplier = new Decimal(10).pow(
      this.baseTokenDecimals - this.quoteTokenDecimals,
    );
    const quoteAdjustment = new Decimal(10).pow(this.quoteTokenDecimals);

    return {
      value: result.value
        .mul(uiMultiplier)
        .mul(quoteAdjustment)
        .floor()
        .div(quoteAdjustment),
      duration: result.duration,
    };
  }

  getMaxDuration(currentTimestamp: BN): BN {
    const earliestTimestamp = this.getEarliestTimestamp();

    if (earliestTimestamp === null) {
      return new BN(0);
    }

    if (currentTimestamp.lte(earliestTimestamp)) {
      return new BN(0);
    }

    return currentTimestamp.sub(earliestTimestamp);
  }
}
