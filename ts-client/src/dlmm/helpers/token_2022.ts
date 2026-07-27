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

/** Token-2022 ScaledUiAmount extension discriminator in the mint TLV data. */
const SCALED_UI_AMOUNT_CONFIG_EXTENSION_TYPE = 25;
/** Byte size of the ScaledUiAmount config: authority(32) + multiplier(8) + timestamp(8) + newMultiplier(8). */
const SCALED_UI_AMOUNT_CONFIG_SIZE = 56;

/**
 * Returns the Token-2022 ScaledUiAmount extension multiplier for a mint at the
 * given unix timestamp. Returns 1 when the mint has no ScaledUiAmount extension,
 * so callers can multiply unconditionally.
 *
 * The extension supports a scheduled multiplier switch: once the current time
 * reaches `newMultiplierEffectiveTimestamp`, `newMultiplier` takes over from
 * `multiplier`. This mirrors the on-chain UI amount computation.
 */
export function getScaledUiAmountMultiplier(
  mint: Mint,
  unixTimestamp: number
): Decimal {
  const tlvData = mint.tlvData;
  if (!tlvData || tlvData.length === 0) {
    return new Decimal(1);
  }

  // Walk the mint's TLV entries (type: u16 LE, length: u16 LE, then `length`
  // bytes of data) and decode the ScaledUiAmount config directly. Decoding it
  // here — rather than importing `getScaledUiAmountConfig` from
  // @solana/spl-token — keeps this working regardless of the installed
  // spl-token version (the getter only exists in newer 0.4.x releases).
  let offset = 0;
  while (offset + 4 <= tlvData.length) {
    const extensionType = tlvData.readUInt16LE(offset);
    const length = tlvData.readUInt16LE(offset + 2);
    const dataStart = offset + 4;

    if (
      extensionType === SCALED_UI_AMOUNT_CONFIG_EXTENSION_TYPE &&
      dataStart + SCALED_UI_AMOUNT_CONFIG_SIZE <= tlvData.length
    ) {
      // Layout: authority(32) | multiplier f64(8) |
      //         newMultiplierEffectiveTimestamp u64(8) | newMultiplier f64(8)
      const multiplier = tlvData.readDoubleLE(dataStart + 32);
      const newMultiplierEffectiveTimestamp = tlvData.readBigUInt64LE(
        dataStart + 40
      );
      const newMultiplier = tlvData.readDoubleLE(dataStart + 48);

      const effectiveMultiplier =
        BigInt(unixTimestamp) >= newMultiplierEffectiveTimestamp
          ? newMultiplier
          : multiplier;

      return new Decimal(effectiveMultiplier);
    }

    offset = dataStart + length;
  }

  return new Decimal(1);
}

/**
 * Scales a raw token amount by a ScaledUiAmount multiplier, flooring to the
 * nearest integer lamport. Returns the amount unchanged when the multiplier is 1.
 */
export function scaleAmountByMultiplier(amount: BN, multiplier: Decimal): BN {
  if (multiplier.eq(1)) {
    return amount;
  }

  return new BN(
    new Decimal(amount.toString()).mul(multiplier).floor().toString()
  );
}

/**
 * Scales a decimals-adjusted price (`pricePerToken`, expressed as quote per base)
 * by the ScaledUiAmount multipliers of both mints:
 * `pricePerToken * quoteMultiplier / baseMultiplier`.
 *
 * Falls back to the unscaled price when `baseMultiplier` is zero (a pathological
 * mint configuration) to avoid producing `Infinity`.
 */
export function scalePricePerToken(
  pricePerToken: string,
  baseMultiplier: Decimal,
  quoteMultiplier: Decimal
): string {
  if (baseMultiplier.isZero()) {
    return pricePerToken;
  }

  return new Decimal(pricePerToken)
    .mul(quoteMultiplier)
    .div(baseMultiplier)
    .toString();
}
