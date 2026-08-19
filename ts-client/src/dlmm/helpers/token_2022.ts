import {
  addExtraAccountMetasForExecute,
  calculateFee,
  createTransferCheckedInstruction,
  getEpochFee,
  getTransferFeeConfig,
  getTransferHook,
  MAX_FEE_BASIS_POINTS,
  Mint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TransferFee,
  unpackMint,
} from "@solana/spl-token";
import {
  AccountInfo,
  AccountMeta,
  Connection,
  PublicKey,
} from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";

export async function getMultipleMintsExtraAccountMetasForTransferHook(
  connection: Connection,
  mintAddressesWithAccountInfo: {
    mintAddress: PublicKey;
    mintAccountInfo: AccountInfo<Buffer>;
  }[]
): Promise<Map<String, AccountMeta[]>> {
  const extraAccountMetas = await Promise.all(
    mintAddressesWithAccountInfo.map(({ mintAddress, mintAccountInfo }) =>
      getExtraAccountMetasForTransferHook(
        connection,
        mintAddress,
        mintAccountInfo
      )
    )
  );

  const mintsWithHookAccountMap = new Map<String, AccountMeta[]>();

  for (let i = 0; i < extraAccountMetas.length; i++) {
    const { mintAddress } = mintAddressesWithAccountInfo[i];
    const transferHooks = extraAccountMetas[i];

    mintsWithHookAccountMap.set(mintAddress.toBase58(), transferHooks);
  }

  return mintsWithHookAccountMap;
}

export async function getExtraAccountMetasForTransferHook(
  connection: Connection,
  mintAddress: PublicKey,
  mintAccountInfo: AccountInfo<Buffer>
) {
  if (
    ![TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(
      mintAccountInfo.owner.toBase58()
    )
  ) {
    return [];
  }

  const mintState = unpackMint(
    mintAddress,
    mintAccountInfo,
    mintAccountInfo.owner
  );

  if (mintAccountInfo.owner.equals(TOKEN_PROGRAM_ID)) {
    return [];
  }

  const transferHook = getTransferHook(mintState);

  if (!transferHook || transferHook.programId.equals(PublicKey.default)) {
    return [];
  } else {
    // We just need the instruction, therefore we do not need source and destination key
    const instruction = createTransferCheckedInstruction(
      PublicKey.default,
      mintAddress,
      PublicKey.default,
      PublicKey.default,
      BigInt(0),
      mintState.decimals,
      [],
      mintAccountInfo.owner
    );

    await addExtraAccountMetasForExecute(
      connection,
      instruction,
      transferHook.programId,
      PublicKey.default,
      mintAddress,
      PublicKey.default,
      PublicKey.default,
      BigInt(0)
    );

    // Only 4 keys needed if it's single signer. https://github.com/solana-labs/solana-program-library/blob/d72289c79a04411c69a8bf1054f7156b6196f9b3/token/js/src/extensions/transferFee/instructions.ts#L251
    const transferHookAccounts = instruction.keys.slice(4);

    // Token 2022 program allow transfer hook program to be invoked without any accounts. https://github.com/solana-program/transfer-hook/blob/e00f3b5c591fd55b4aed6a1e9b1ccc502cb6da05/interface/src/onchain.rs#L37
    if (transferHookAccounts.length == 0) {
      transferHookAccounts.push({
        pubkey: transferHook.programId,
        isSigner: false,
        isWritable: false,
      });
    }

    return transferHookAccounts;
  }
}

function calculatePreFeeAmount(transferFee: TransferFee, postFeeAmount: BN) {
  if (postFeeAmount.isZero()) {
    return new BN(0);
  }

  if (transferFee.transferFeeBasisPoints === 0) {
    return postFeeAmount;
  }

  const maximumFee = new BN(transferFee.maximumFee.toString());

  if (transferFee.transferFeeBasisPoints === MAX_FEE_BASIS_POINTS) {
    return postFeeAmount.add(maximumFee);
  }

  const ONE_IN_BASIS_POINTS = new BN(MAX_FEE_BASIS_POINTS);
  const numerator = postFeeAmount.mul(ONE_IN_BASIS_POINTS);
  const denominator = ONE_IN_BASIS_POINTS.sub(
    new BN(transferFee.transferFeeBasisPoints)
  );

  const rawPreFeeAmount = numerator
    .add(denominator)
    .sub(new BN(1))
    .div(denominator);

  if (rawPreFeeAmount.sub(postFeeAmount).gte(maximumFee)) {
    return postFeeAmount.add(maximumFee);
  }

  return rawPreFeeAmount;
}

function calculateInverseFee(transferFee: TransferFee, postFeeAmount: BN) {
  const preFeeAmount = calculatePreFeeAmount(transferFee, postFeeAmount);
  return new BN(
    calculateFee(transferFee, BigInt(preFeeAmount.toString())).toString()
  );
}

interface TransferFeeIncludedAmount {
  amount: BN;
  transferFee: BN;
}

export function calculateTransferFeeIncludedAmount(
  transferFeeExcludedAmount: BN,
  mint: Mint,
  currentEpoch: number
): TransferFeeIncludedAmount {
  if (transferFeeExcludedAmount.isZero()) {
    return {
      amount: new BN(0),
      transferFee: new BN(0),
    };
  }

  const transferFeeConfig = getTransferFeeConfig(mint);

  if (transferFeeConfig === null) {
    return {
      amount: transferFeeExcludedAmount,
      transferFee: new BN(0),
    };
  }

  const epochFee = getEpochFee(transferFeeConfig, BigInt(currentEpoch));

  const transferFee =
    epochFee.transferFeeBasisPoints == MAX_FEE_BASIS_POINTS
      ? new BN(epochFee.maximumFee.toString())
      : calculateInverseFee(epochFee, transferFeeExcludedAmount);

  const transferFeeIncludedAmount = transferFeeExcludedAmount.add(transferFee);

  return {
    amount: transferFeeIncludedAmount,
    transferFee,
  };
}

interface TransferFeeExcludedAmount {
  amount: BN;
  transferFee: BN;
}

export function calculateTransferFeeExcludedAmount(
  transferFeeIncludedAmount: BN,
  mint: Mint,
  currentEpoch: number
): TransferFeeExcludedAmount {
  const transferFeeConfig = getTransferFeeConfig(mint);
  if (transferFeeConfig === null) {
    return {
      amount: transferFeeIncludedAmount,
      transferFee: new BN(0),
    };
  }

  const transferFeeIncludedAmountN = BigInt(
    transferFeeIncludedAmount.toString()
  );

  const transferFee = calculateFee(
    getEpochFee(transferFeeConfig, BigInt(currentEpoch)),
    transferFeeIncludedAmountN
  );

  const transferFeeExcludedAmount = new BN(
    (transferFeeIncludedAmountN - transferFee).toString()
  );

  return {
    amount: transferFeeExcludedAmount,
    transferFee: new BN(transferFee.toString()),
  };
}

/**
 * Token-2022 `ScaledUiAmountConfig` extension `ExtensionType.ScaledUiAmountConfig`in @solana/spl-token.
 */
export const SCALED_UI_AMOUNT_CONFIG_EXTENSION_TYPE = 25;

export const SCALED_UI_AMOUNT_CONFIG_SIZE = 56;

const ONE = new Decimal(1);

/**
 * @param {Mint} mint - the mint whose TLV data is searched for the extension.
 * @param {number} unixTimestamp - on-chain unix timestamp, used to resolve a
 * scheduled multiplier switch.
 * @returns {Decimal} the effective multiplier, or 1 when the mint has no
 * ScaledUiAmount extension.
 * @throws {Error} if the effective multiplier is zero, negative or NaN. Such a
 * mint is malformed, and silently falling back to an unscaled price would
 * produce a plausible but wrong number with no signal to the caller.
 */
export function getScaledUiAmountMultiplier(
  mint: Mint,
  unixTimestamp: number
): Decimal {
  const tlvData = mint.tlvData;
  if (!tlvData || tlvData.length === 0) {
    return ONE;
  }

  // Each TLV entry is: type (u16 LE), length (u16 LE), then `length` bytes.
  let offset = 0;
  while (offset + 4 <= tlvData.length) {
    const extensionType = tlvData.readUInt16LE(offset);
    const length = tlvData.readUInt16LE(offset + 2);
    const dataStart = offset + 4;

    if (
      extensionType === SCALED_UI_AMOUNT_CONFIG_EXTENSION_TYPE &&
      dataStart + SCALED_UI_AMOUNT_CONFIG_SIZE <= tlvData.length
    ) {
      // Layout: authority(32) | multiplier f64 | newMultiplierEffectiveTimestamp u64 | newMultiplier f64
      const multiplier = tlvData.readDoubleLE(dataStart + 32);
      const newMultiplierEffectiveTimestamp = tlvData.readBigUInt64LE(
        dataStart + 40
      );
      const newMultiplier = tlvData.readDoubleLE(dataStart + 48);

      const effectiveMultiplier =
        BigInt(unixTimestamp) >= newMultiplierEffectiveTimestamp
          ? newMultiplier
          : multiplier;

      if (!Number.isFinite(effectiveMultiplier) || effectiveMultiplier <= 0) {
        throw new Error(
          `Invalid ScaledUiAmount multiplier ${effectiveMultiplier} for mint ${mint.address.toBase58()}`
        );
      }

      return new Decimal(effectiveMultiplier);
    }

    offset = dataStart + length;
  }

  return ONE;
}

/**
 * The ScaledUiAmount multipliers of both mints of a pair, and the conversions
 * that apply them.
 *
 * An amount is scaled by the multiplier of the mint that the amount belongs to.
 * A price is quote per base, so it is scaled by the quote multiplier divided by
 * the base multiplier.
 */
export class TokenScale {
  /** The quote multiplier divided by the base multiplier. */
  readonly priceFactor: Decimal;

  private constructor(
    readonly baseMultiplier: Decimal,
    readonly quoteMultiplier: Decimal
  ) {
    this.priceFactor = quoteMultiplier.div(baseMultiplier);
  }

  /**
   * Reads the multiplier of each mint of a pair.
   *
   * @param baseMint The base (X) mint of the pair.
   * @param quoteMint The quote (Y) mint of the pair.
   * @param unixTimestamp An on-chain unix timestamp. It resolves a scheduled
   *     multiplier switch. Pass `DLMM.clock.unixTimestamp` instead of
   *     wall-clock time, and pass the same value to every call in one read.
   * @return The scale for the pair.
   * @throws Error If either mint carries an invalid multiplier.
   */
  static fromMints(
    baseMint: Mint,
    quoteMint: Mint,
    unixTimestamp: number
  ): TokenScale {
    return new TokenScale(
      getScaledUiAmountMultiplier(baseMint, unixTimestamp),
      getScaledUiAmountMultiplier(quoteMint, unixTimestamp)
    );
  }

  /**
   * Converts a raw price to the price that a wallet displays.
   *
   * @param price A raw price, in token space.
   * @return The displayed price.
   */
  scalePrice(price: Decimal): Decimal {
    return price.mul(this.priceFactor);
  }

  /**
   * Converts a displayed price back to a raw price. It is the inverse of
   * {@link scalePrice}.
   *
   * @param price A displayed price, in token space.
   * @return The raw price.
   */
  unscalePrice(price: Decimal): Decimal {
    return price.div(this.priceFactor);
  }

  /**
   * Applies {@link scalePrice} to a price held as a string. The string is
   * returned unchanged if the price factor is 1.
   *
   * @param price A raw price, in token space.
   * @return The displayed scaled price.
   */
  scalePriceString(price: string): string {
    return this.priceFactor.eq(ONE)
      ? price
      : this.scalePrice(new Decimal(price)).toString();
  }

  /**
   * Applies one of the pair's two multipliers to an amount.
   *
   * @param amount A raw amount.
   * @param isBaseToken True if the amount is an amount of the base (X) token,
   *     which uses {@link baseMultiplier}. False if it is an amount of the
   *     quote (Y) token, which uses {@link quoteMultiplier}.
   * @return The scaled amount, in the same unit. It is fractional if the
   *     multiplier is fractional. Round it down before you put it in a `BN`.
   */
  scaleAmount(amount: BN | Decimal, isBaseToken: boolean): Decimal {
    const multiplier = isBaseToken ? this.baseMultiplier : this.quoteMultiplier;
    const decimalAmount =
      amount instanceof Decimal ? amount : new Decimal(amount.toString());

    return decimalAmount.mul(multiplier);
  }
}
