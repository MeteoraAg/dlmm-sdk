import { Mint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import {
  SCALED_UI_AMOUNT_CONFIG_EXTENSION_TYPE,
  SCALED_UI_AMOUNT_CONFIG_SIZE,
} from "../dlmm/helpers/token_2022";

/** Matches `ExtensionType.TransferFeeConfig` in @solana/spl-token. */
export const TRANSFER_FEE_CONFIG_EXTENSION_TYPE = 1;

/** Builds a single TLV entry: type (u16 LE), length (u16 LE), then `data`. */
export function tlvEntry(extensionType: number, data: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16LE(extensionType, 0);
  header.writeUInt16LE(data.length, 2);
  return Buffer.concat([header, data]);
}

/**
 * Builds the ScaledUiAmountConfig payload, mirroring the layout the decoder in
 * `helpers/token_2022.ts` reads back.
 */
export function scaledUiAmountConfigData(params: {
  multiplier: number;
  newMultiplierEffectiveTimestamp: number;
  newMultiplier: number;
}): Buffer {
  const data = Buffer.alloc(SCALED_UI_AMOUNT_CONFIG_SIZE);
  // authority occupies bytes 0..31 and is not read by the decoder.
  data.writeDoubleLE(params.multiplier, 32);
  data.writeBigUInt64LE(BigInt(params.newMultiplierEffectiveTimestamp), 40);
  data.writeDoubleLE(params.newMultiplier, 48);
  return data;
}

export function mintWithTlv(tlvData: Buffer, decimals = 9): Mint {
  return {
    address: PublicKey.default,
    mintAuthority: null,
    supply: BigInt(0),
    decimals,
    isInitialized: true,
    freezeAuthority: null,
    tlvData,
  };
}

/** A mint carrying no Token-2022 extensions at all. */
export function mintWithoutExtensions(decimals = 9): Mint {
  return mintWithTlv(Buffer.alloc(0), decimals);
}

/**
 * A mint carrying a ScaledUiAmountConfig extension.
 *
 * `newMultiplierEffectiveTimestamp` defaults to the far future, so the
 * scheduled switch never fires unless a test asks for it.
 */
export function mintWithScaledUiAmountMultiplier(
  multiplier: number,
  options: {
    newMultiplierEffectiveTimestamp?: number;
    newMultiplier?: number;
    precededByAnotherExtension?: boolean;
    decimals?: number;
  } = {},
): Mint {
  const config = scaledUiAmountConfigData({
    multiplier,
    newMultiplierEffectiveTimestamp:
      options.newMultiplierEffectiveTimestamp ?? Number.MAX_SAFE_INTEGER,
    newMultiplier: options.newMultiplier ?? multiplier,
  });

  const entries: Buffer[] = [];
  if (options.precededByAnotherExtension) {
    entries.push(
      tlvEntry(TRANSFER_FEE_CONFIG_EXTENSION_TYPE, Buffer.alloc(108, 7)),
    );
  }
  entries.push(tlvEntry(SCALED_UI_AMOUNT_CONFIG_EXTENSION_TYPE, config));

  return mintWithTlv(Buffer.concat(entries), options.decimals);
}