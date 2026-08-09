import { Mint } from "@solana/spl-token";
import BN from "bn.js";
import Decimal from "decimal.js";
import { DLMM } from "../dlmm";
import {
  PriceScale,
  getScaledUiAmountMultiplier,
} from "../dlmm/helpers/token_2022";
import {
  TRANSFER_FEE_CONFIG_EXTENSION_TYPE,
  mintWithScaledUiAmountMultiplier,
  mintWithTlv,
  mintWithoutExtensions,
  tlvEntry,
} from "./scaled_ui_amount_helper";

function scaledMint(params: {
  multiplier: number;
  newMultiplierEffectiveTimestamp?: number;
  newMultiplier?: number;
  precededByAnotherExtension?: boolean;
}): Mint {
  const { multiplier, ...options } = params;
  return mintWithScaledUiAmountMultiplier(multiplier, options);
}

const plainMint = () => mintWithoutExtensions();

describe("getScaledUiAmountMultiplier", () => {
  it("returns 1 when the mint has no TLV data", () => {
    expect(getScaledUiAmountMultiplier(plainMint(), 1_000).toString()).toBe(
      "1",
    );
  });

  it("returns 1 when the mint has extensions but not ScaledUiAmount", () => {
    const mint = mintWithTlv(
      tlvEntry(TRANSFER_FEE_CONFIG_EXTENSION_TYPE, Buffer.alloc(108, 7)),
    );
    expect(getScaledUiAmountMultiplier(mint, 1_000).toString()).toBe("1");
  });

  it("finds the config when another extension precedes it", () => {
    const mint = scaledMint({
      multiplier: 2,
      precededByAnotherExtension: true,
    });
    expect(getScaledUiAmountMultiplier(mint, 1_000).toString()).toBe("2");
  });

  it("returns the current multiplier before the effective timestamp", () => {
    const mint = scaledMint({
      multiplier: 2,
      newMultiplierEffectiveTimestamp: 5_000,
      newMultiplier: 8,
    });
    expect(getScaledUiAmountMultiplier(mint, 4_999).toString()).toBe("2");
  });

  it("returns the new multiplier at the effective timestamp", () => {
    const mint = scaledMint({
      multiplier: 2,
      newMultiplierEffectiveTimestamp: 5_000,
      newMultiplier: 8,
    });
    expect(getScaledUiAmountMultiplier(mint, 5_000).toString()).toBe("8");
  });

  it("returns the new multiplier after the effective timestamp", () => {
    const mint = scaledMint({
      multiplier: 2,
      newMultiplierEffectiveTimestamp: 5_000,
      newMultiplier: 8,
    });
    expect(getScaledUiAmountMultiplier(mint, 5_001).toString()).toBe("8");
  });

  it("reads a fractional multiplier", () => {
    const mint = scaledMint({ multiplier: 0.5 });
    expect(getScaledUiAmountMultiplier(mint, 1_000).toString()).toBe("0.5");
  });

  it("throws on a zero multiplier", () => {
    expect(() => getScaledUiAmountMultiplier(scaledMint({ multiplier: 0 }), 1))
      .toThrow(/multiplier/i);
  });

  it("throws on a negative multiplier", () => {
    expect(() => getScaledUiAmountMultiplier(scaledMint({ multiplier: -1 }), 1))
      .toThrow(/multiplier/i);
  });

  it("throws on a NaN multiplier", () => {
    expect(() =>
      getScaledUiAmountMultiplier(scaledMint({ multiplier: NaN }), 1),
    ).toThrow(/multiplier/i);
  });

  it("throws when the scheduled multiplier is invalid and in effect", () => {
    const mint = scaledMint({
      multiplier: 2,
      newMultiplierEffectiveTimestamp: 5_000,
      newMultiplier: 0,
    });
    expect(getScaledUiAmountMultiplier(mint, 4_999).toString()).toBe("2");
    expect(() => getScaledUiAmountMultiplier(mint, 5_000)).toThrow(
      /multiplier/i,
    );
  });
});

describe("PriceScale", () => {
  it("identity has a factor of 1 and reports isIdentity", () => {
    const scale = PriceScale.identity();
    expect(scale.factor.toString()).toBe("1");
    expect(scale.isIdentity).toBe(true);
  });

  it("is identity when neither mint carries the extension", () => {
    const scale = PriceScale.fromMints(plainMint(), plainMint(), 1_000);
    expect(scale.isIdentity).toBe(true);
  });

  it("computes quoteMultiplier / baseMultiplier", () => {
    // base x2 means each displayed base token is worth half as much.
    const scale = PriceScale.fromMints(
      scaledMint({ multiplier: 2 }),
      plainMint(),
      1_000,
    );
    expect(scale.factor.toString()).toBe("0.5");
  });

  it("raises the price when only the quote mint is scaled", () => {
    const scale = PriceScale.fromMints(
      plainMint(),
      scaledMint({ multiplier: 2 }),
      1_000,
    );
    expect(scale.factor.toString()).toBe("2");
  });

  it("cancels when both mints carry the same multiplier", () => {
    const scale = PriceScale.fromMints(
      scaledMint({ multiplier: 4 }),
      scaledMint({ multiplier: 4 }),
      1_000,
    );
    expect(scale.factor.toString()).toBe("1");
    expect(scale.isIdentity).toBe(true);
  });

  it("scales a price by the factor", () => {
    const scale = PriceScale.fromMints(
      scaledMint({ multiplier: 2 }),
      plainMint(),
      1_000,
    );
    expect(scale.scale(new Decimal(100)).toString()).toBe("50");
  });

  it("unscale is the exact inverse of scale", () => {
    const scale = PriceScale.fromMints(
      scaledMint({ multiplier: 8 }),
      scaledMint({ multiplier: 5 }),
      1_000,
    );
    const original = new Decimal("123.456");
    expect(scale.unscale(scale.scale(original)).toString()).toBe(
      original.toString(),
    );
    expect(scale.scale(scale.unscale(original)).toString()).toBe(
      original.toString(),
    );
  });

  it("scaleString round-trips through the string form", () => {
    const scale = PriceScale.fromMints(
      scaledMint({ multiplier: 2 }),
      plainMint(),
      1_000,
    );
    expect(scale.scaleString("100")).toBe("50");
  });

  it("returns the input unchanged when identity", () => {
    const scale = PriceScale.identity();
    const price = new Decimal("0.1");
    expect(scale.scale(price)).toBe(price);
    expect(scale.unscale(price)).toBe(price);
    expect(scale.scaleString("0.1")).toBe("0.1");
  });

  it("honours the scheduled multiplier switch", () => {
    const baseMint = scaledMint({
      multiplier: 1,
      newMultiplierEffectiveTimestamp: 5_000,
      newMultiplier: 2,
    });
    expect(PriceScale.fromMints(baseMint, plainMint(), 4_999).factor.toString())
      .toBe("1");
    expect(PriceScale.fromMints(baseMint, plainMint(), 5_000).factor.toString())
      .toBe("0.5");
  });
});

/**
 * Exercises the price conversion pair without a validator. Both methods are
 * pure arithmetic over `tokenX.mint`, `tokenY.mint` and `clock`, so a prototype
 * instance carrying only those three fields is enough.
 */
function dlmmForPriceConversion(params: {
  baseMint: Mint;
  quoteMint: Mint;
  unixTimestamp: number;
}): DLMM {
  const dlmm: DLMM = Object.create(DLMM.prototype);
  Object.assign(dlmm, {
    tokenX: { mint: params.baseMint },
    tokenY: { mint: params.quoteMint },
    clock: { unixTimestamp: new BN(params.unixTimestamp) },
  });
  return dlmm;
}

describe("price conversion round trip", () => {
  const cases: {
    name: string;
    baseMint: Mint;
    quoteMint: Mint;
    baseDecimals: number;
    quoteDecimals: number;
  }[] = [
    {
      name: "neither mint scaled",
      baseMint: mintWithoutExtensions(9),
      quoteMint: mintWithoutExtensions(6),
      baseDecimals: 9,
      quoteDecimals: 6,
    },
    {
      name: "base mint scaled x2",
      baseMint: mintWithScaledUiAmountMultiplier(2, { decimals: 9 }),
      quoteMint: mintWithoutExtensions(6),
      baseDecimals: 9,
      quoteDecimals: 6,
    },
    {
      name: "quote mint scaled x2",
      baseMint: mintWithoutExtensions(9),
      quoteMint: mintWithScaledUiAmountMultiplier(2, { decimals: 6 }),
      baseDecimals: 9,
      quoteDecimals: 6,
    },
    {
      name: "both mints scaled, different factors",
      baseMint: mintWithScaledUiAmountMultiplier(8, { decimals: 6 }),
      quoteMint: mintWithScaledUiAmountMultiplier(5, { decimals: 9 }),
      baseDecimals: 6,
      quoteDecimals: 9,
    },
  ];

  it.each(cases)(
    "toPricePerLamport(fromPricePerLamport(x)) === x — $name",
    ({ baseMint, quoteMint }) => {
      const dlmm = dlmmForPriceConversion({
        baseMint,
        quoteMint,
        unixTimestamp: 1_000,
      });

      for (const pricePerLamport of [0.1, 1, 12.5, 0.0000001]) {
        const displayed = Number(dlmm.fromPricePerLamport(pricePerLamport));
        const roundTripped = Number(dlmm.toPricePerLamport(displayed));

        expect(roundTripped).toBeCloseTo(pricePerLamport, 12);
      }
    },
  );

  it("fromPricePerLamport applies decimals then the scale factor", () => {
    // base x2 halves the displayed price of the base token.
    const dlmm = dlmmForPriceConversion({
      baseMint: mintWithScaledUiAmountMultiplier(2, { decimals: 9 }),
      quoteMint: mintWithoutExtensions(6),
      unixTimestamp: 1_000,
    });

    // 0.1 quote lamports per base lamport, base=9 quote=6 -> 100 quote per base.
    // Halved by the base multiplier -> 50.
    expect(dlmm.fromPricePerLamport(0.1)).toBe("50");
    expect(dlmm.toPricePerLamport(50)).toBe("0.1");
  });

  it("is unchanged from the pre-extension behaviour when neither mint is scaled", () => {
    const dlmm = dlmmForPriceConversion({
      baseMint: mintWithoutExtensions(9),
      quoteMint: mintWithoutExtensions(6),
      unixTimestamp: 1_000,
    });

    expect(dlmm.fromPricePerLamport(0.1)).toBe("100");
    expect(dlmm.toPricePerLamport(100)).toBe("0.1");
  });
});
