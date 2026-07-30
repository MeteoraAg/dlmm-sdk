import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  getBinArraysRequiredByPositionRange2,
  deriveBinArray,
} from "../dlmm/helpers";

describe("getBinArraysRequiredByPositionRange2", () => {
  const pair = new PublicKey("So11111111111111111111111111111111111111112");
  const programId = new PublicKey(
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  );

  const MAX_BIN_PER_ARRAY = 70;
  const expectedIndex = (binId: number) =>
    Math.floor(binId / MAX_BIN_PER_ARRAY);

  const expectedKey = (index: number) =>
    deriveBinArray(pair, new BN(index), programId)[0].toBase58();

  const indexesOf = (from: number, to: number) =>
    getBinArraysRequiredByPositionRange2(
      pair,
      new BN(from),
      new BN(to),
      programId,
    ).map((r) => r.index.toNumber());

  const keysOf = (from: number, to: number) =>
    getBinArraysRequiredByPositionRange2(
      pair,
      new BN(from),
      new BN(to),
      programId,
    ).map((r) => r.key.toBase58());

  test("range within a single bin array returns exactly one bin array", () => {
    const result = getBinArraysRequiredByPositionRange2(
      pair,
      new BN(0),
      new BN(10),
      programId,
    );

    expect(result).toHaveLength(1);
    expect(result[0].index.toNumber()).toBe(expectedIndex(0));
    expect(result[0].key.toBase58()).toBe(expectedKey(expectedIndex(0)));
  });

  test("single bin (from == to) returns one bin array", () => {
    const result = getBinArraysRequiredByPositionRange2(
      pair,
      new BN(5),
      new BN(5),
      programId,
    );

    expect(result).toHaveLength(1);
    expect(result[0].index.toNumber()).toBe(expectedIndex(5));
    expect(result[0].key.toBase58()).toBe(expectedKey(expectedIndex(5)));
  });

  test("range spanning multiple bin arrays returns contiguous coverage without gaps", () => {
    expect(indexesOf(0, 200)).toEqual([0, 1, 2]);
    expect(keysOf(0, 200)).toEqual([
      expectedKey(0),
      expectedKey(1),
      expectedKey(2),
    ]);
  });

  test("result is symmetric regardless of from/to order", () => {
    const forward = getBinArraysRequiredByPositionRange2(
      pair,
      new BN(0),
      new BN(200),
      programId,
    );
    const reversed = getBinArraysRequiredByPositionRange2(
      pair,
      new BN(200),
      new BN(0),
      programId,
    );

    expect(reversed.map((r) => r.index.toNumber())).toEqual(
      forward.map((r) => r.index.toNumber()),
    );
    expect(reversed.map((r) => r.key.toBase58())).toEqual(
      forward.map((r) => r.key.toBase58()),
    );
  });

  test("bin ids on bin array boundaries map to the correct bin arrays", () => {
    expect(indexesOf(69, 70)).toEqual([0, 1]);
    expect(indexesOf(70, 139)).toEqual([1]);
  });

  test("negative bin ids derive the correct (floored) bin array indexes", () => {
    expect(indexesOf(-100, -1)).toEqual([-2, -1]);
    expect(keysOf(-100, -1)).toEqual([expectedKey(-2), expectedKey(-1)]);
  });
});
