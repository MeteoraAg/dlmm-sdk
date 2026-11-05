import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { deriveBinArray } from "../dlmm/helpers";
import { LBCLMM_PROGRAM_IDS } from "../dlmm/constants";

const PROGRAM_ID = new PublicKey(LBCLMM_PROGRAM_IDS["mainnet-beta"]);

interface BinArrayVector {
  lbPair: string;
  index: number;
  binArray: string;
  bump: number;
}

/**
 * Regression vectors taken from the live mainnet deployment.
 *
 * Every entry below was cross-checked against the actual on-chain BinArray
 * account: owner is lb_clmm, the account is 10136 bytes, discriminator is
 * 5c8e5cdc059446b5, and the account's own `index` (offset 8) and `lb_pair`
 * (offset 24) fields equal the values used here.
 *
 * These exist to pin the seed encoding, in particular that negative indices are
 * encoded as signed i64 little-endian (two's complement) and not as |index|.
 */
const VECTORS: BinArrayVector[] = [
  {
    lbPair: "Rj6obu9pSJGKHNBvNQ7FuW77uNyvpEERcNyoVuCL6SA",
    index: -5,
    binArray: "48Ng1ksqMaBbaRsX6XodovPV3a7tfMGMxT3nJKckxbgp",
    bump: 252,
  },
  {
    lbPair: "Rj6obu9pSJGKHNBvNQ7FuW77uNyvpEERcNyoVuCL6SA",
    index: -4,
    binArray: "7sMPa9fgjVBG6UuzsUb2PwUzGBsWYkerBD74566XqAL9",
    bump: 255,
  },
  {
    lbPair: "2Gqg1qs2GD49CvXK4ZyTdd7d9Ne8FZwrWDfEbpo2zhwE",
    index: -15,
    binArray: "DeF7ajmi6Mxqvq7VwHwakZc1SQE1MNm62hH5U2tNN86h",
    bump: 255,
  },
  {
    lbPair: "2Gqg1qs2GD49CvXK4ZyTdd7d9Ne8FZwrWDfEbpo2zhwE",
    index: -16,
    binArray: "G9ycC3X5Z5GbLvS31DGFdzwr95ryfrNs8kbdJgGXV3m8",
    bump: 255,
  },
  {
    lbPair: "39FCEpSTHugmkQSRPRnFWgvmkojWQTgQkjq4crb6TFas",
    index: -119,
    binArray: "8WPwXzQiAUj1PnGfroEVWpAHwm9DZQdc6SCwFbinPvS6",
    bump: 253,
  },
  {
    lbPair: "39FCEpSTHugmkQSRPRnFWgvmkojWQTgQkjq4crb6TFas",
    index: -120,
    binArray: "Hx5WsWinaFFFWiLmwKiDkaEHNWDfTcZ4vAKpXWxV2cPW",
    bump: 255,
  },
  {
    lbPair: "rj5LngbE5C6oQ84z6JyzKShifAWVZ2tXMcJSLu8sHM7",
    index: -385,
    binArray: "JPWerU1i8P3TH5eZfHnXmF6U7UQmpkLPgbTBkdSMhVx",
    bump: 251,
  },
  {
    lbPair: "rj5LngbE5C6oQ84z6JyzKShifAWVZ2tXMcJSLu8sHM7",
    index: -386,
    binArray: "6zCABSDCdeEpJs77thwJwNTrMnaDdMZMLmr9KSJyMifr",
    bump: 255,
  },
  {
    lbPair: "112JU91seUnMLBmXxwqiyXbaZhbFRxGJprvh7pYWT98",
    index: 23,
    binArray: "93pG2L38KM3MBR4ZrGTjNJ8o1droM5yHvpkMgz2onnJ3",
    bump: 254,
  },
];

describe("deriveBinArray", () => {
  it.each(VECTORS)(
    "derives bin array $binArray for lb_pair $lbPair at index $index",
    ({ lbPair, index, binArray, bump }) => {
      const [key, derivedBump] = deriveBinArray(
        new PublicKey(lbPair),
        new BN(index),
        PROGRAM_ID,
      );

      expect(key.toBase58()).toBe(binArray);
      expect(derivedBump).toBe(bump);
    },
  );

  it("derives different addresses for -n and +n", () => {
    // Guards against encoding the index as its absolute value: |−5| and +5
    // would otherwise share the same seed bytes and resolve to one address.
    const lbPair = new PublicKey(VECTORS[0].lbPair);

    const negative = deriveBinArray(lbPair, new BN(-5), PROGRAM_ID)[0];
    const positive = deriveBinArray(lbPair, new BN(5), PROGRAM_ID)[0];

    expect(negative.toBase58()).not.toBe(positive.toBase58());
  });
});
