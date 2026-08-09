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

export class PriceScale {
  private constructor(
    public readonly factor: Decimal
  ) {}

  /**
   * A no-op scale, for mints without the extension
   * @returns {PriceScale} a scale that leaves every price unchanged.
   */
  static identity(): PriceScale {
    return new PriceScale(ONE);
  }

  /**
   * Builds the scale for a pair from its two mints.
   *
   * @param {Mint} baseMint - the pair's base (X) mint.
   * @param {Mint} quoteMint - the pair's quote (Y) mint.
   * @param {number} unixTimestamp - on-chain unix timestamp, used to resolve a
   * scheduled multiplier switch. Prefer `DLMM.clock.unixTimestamp` over
   * wall-clock time, and use the same clock for every value derived alongside it.
   * @returns {PriceScale} the correction for this pair.
   * @throws {Error} if either mint carries an invalid multiplier.
   */
  static fromMints(
    baseMint: Mint,
    quoteMint: Mint,
    unixTimestamp: number
  ): PriceScale {
    const baseMultiplier = getScaledUiAmountMultiplier(baseMint, unixTimestamp);
    const quoteMultiplier = getScaledUiAmountMultiplier(
      quoteMint,
      unixTimestamp
    );

    if (baseMultiplier.eq(quoteMultiplier)) {
      return PriceScale.identity();
    }

    return new PriceScale(quoteMultiplier.div(baseMultiplier));
  }

  /**
   * @returns {boolean} true when this scale leaves every price unchanged.
   */
  get isIdentity(): boolean {
    return this.factor.eq(ONE);
  }

  /**
   * Converts a raw token-space price to the price a person should see.
   * @param {Decimal} price - an unscaled token-space price.
   * @returns {Decimal} the displayed price.
   */
  scale(price: Decimal): Decimal {
    return this.isIdentity ? price : price.mul(this.factor);
  }

  /**
   * Converts a displayed price back to the raw token-space price.
   * @param {Decimal} price - a displayed token-space price.
   * @returns {Decimal} the unscaled price.
   */
  unscale(price: Decimal): Decimal {
    return this.isIdentity ? price : price.div(this.factor);
  }

  /**
   * {@link scale}, for the call sites that hold prices as strings.
   * @param {string} price - an unscaled token-space price.
   * @returns {string} the displayed price.
   */
  scaleString(price: string): string {
    return this.isIdentity ? price : this.scale(new Decimal(price)).toString();
  }
}
