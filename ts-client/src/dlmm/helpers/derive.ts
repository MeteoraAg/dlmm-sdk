import { BN } from "@coral-xyz/anchor";
import { AccountMeta, Connection, PublicKey } from "@solana/web3.js";
import { DLMM } from "..";
import { ILM_BASE } from "../constants";

/** private */
function sortTokenMints(tokenX: PublicKey, tokenY: PublicKey) {
  const [minKey, maxKey] =
    tokenX.toBuffer().compare(tokenY.toBuffer()) == 1
      ? [tokenY, tokenX]
      : [tokenX, tokenY];
  return [minKey, maxKey];
}
/** private */

export function derivePresetParameterWithIndex(
  index: BN,
  programId: PublicKey,
) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("preset_parameter2"),
      new Uint8Array(index.toArrayLike(Buffer, "le", 2)),
    ],
    programId,
  );
}

export function deriveLbPairWithPresetParamWithIndexKey(
  presetParameterKey: PublicKey,
  tokenX: PublicKey,
  tokenY: PublicKey,
  programId: PublicKey,
) {
  const [minKey, maxKey] = sortTokenMints(tokenX, tokenY);
  return PublicKey.findProgramAddressSync(
    [presetParameterKey.toBuffer(), minKey.toBuffer(), maxKey.toBuffer()],
    programId,
  );
}

/**
 *
 * @deprecated Use derivePresetParameter2
 */
export function derivePresetParameter(binStep: BN, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("preset_parameter"),
      new Uint8Array(binStep.toArrayLike(Buffer, "le", 2)),
    ],
    programId,
  );
}

export function derivePresetParameter2(
  binStep: BN,
  baseFactor: BN,
  programId: PublicKey,
) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("preset_parameter"),
      new Uint8Array(binStep.toArrayLike(Buffer, "le", 2)),
      new Uint8Array(baseFactor.toArrayLike(Buffer, "le", 2)),
    ],
    programId,
  );
}

export function deriveLbPair2(
  tokenX: PublicKey,
  tokenY: PublicKey,
  binStep: BN,
  baseFactor: BN,
  programId: PublicKey,
) {
  const [minKey, maxKey] = sortTokenMints(tokenX, tokenY);
  return PublicKey.findProgramAddressSync(
    [
      minKey.toBuffer(),
      maxKey.toBuffer(),
      new Uint8Array(binStep.toArrayLike(Buffer, "le", 2)),
      new Uint8Array(baseFactor.toArrayLike(Buffer, "le", 2)),
    ],
    programId,
  );
}

/**
 *
 * @deprecated Use deriveLbPair2
 */

export function deriveLbPair(
  tokenX: PublicKey,
  tokenY: PublicKey,
  binStep: BN,
  programId: PublicKey,
) {
  const [minKey, maxKey] = sortTokenMints(tokenX, tokenY);
  return PublicKey.findProgramAddressSync(
    [
      minKey.toBuffer(),
      maxKey.toBuffer(),
      new Uint8Array(binStep.toArrayLike(Buffer, "le", 2)),
    ],
    programId,
  );
}

export function deriveCustomizablePermissionlessLbPair(
  tokenX: PublicKey,
  tokenY: PublicKey,
  programId: PublicKey,
) {
  const [minKey, maxKey] = sortTokenMints(tokenX, tokenY);
  return PublicKey.findProgramAddressSync(
    [ILM_BASE.toBuffer(), minKey.toBuffer(), maxKey.toBuffer()],
    programId,
  );
}

export function derivePermissionLbPair(
  baseKey: PublicKey,
  tokenX: PublicKey,
  tokenY: PublicKey,
  binStep: BN,
  programId: PublicKey,
) {
  const [minKey, maxKey] = sortTokenMints(tokenX, tokenY);
  return PublicKey.findProgramAddressSync(
    [
      baseKey.toBuffer(),
      minKey.toBuffer(),
      maxKey.toBuffer(),
      new Uint8Array(binStep.toArrayLike(Buffer, "le", 2)),
    ],
    programId,
  );
}

export function deriveOracle(lbPair: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), lbPair.toBytes()],
    programId,
  );
}

export function derivePosition(
  lbPair: PublicKey,
  base: PublicKey,
  lowerBinId: BN,
  width: BN,
  programId: PublicKey,
) {
  let lowerBinIdBytes: Uint8Array;
  if (lowerBinId.isNeg()) {
    lowerBinIdBytes = new Uint8Array(
      lowerBinId.toTwos(32).toArrayLike(Buffer, "le", 4),
    );
  } else {
    lowerBinIdBytes = new Uint8Array(lowerBinId.toArrayLike(Buffer, "le", 4));
  }
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("position"),
      lbPair.toBuffer(),
      base.toBuffer(),
      lowerBinIdBytes,
      new Uint8Array(width.toArrayLike(Buffer, "le", 4)),
    ],
    programId,
  );
}

/**
 * Derives the BinArray PDA for a given lb pair and bin array index.
 *
 * Seeds: `["bin_array", lb_pair, index_i64_le]`
 *
 * The index is a signed 64-bit integer encoded as 8 bytes, little-endian.
 * Negative indices use two's complement:
 * `-5` -> `fb ff ff ff ff ff ff ff`, `-8` -> `f8 ff ff ff ff ff ff ff`.
 *
 * Note: the absolute value must NOT be used for negative indices. `abs(-5)`
 * produces the same seed bytes as `+5`, which would silently resolve to a
 * different bin array's address.
 *
 * @param lbPair The lb pair the bin array belongs to.
 * @param index The signed bin array index (not the bin id).
 * @param programId The lb_clmm program id.
 * @returns The bin array address and its bump seed.
 */
export function deriveBinArray(
  lbPair: PublicKey,
  index: BN,
  programId: PublicKey,
) {
  let binArrayBytes: Uint8Array;
  if (index.isNeg()) {
    binArrayBytes = new Uint8Array(
      index.toTwos(64).toArrayLike(Buffer, "le", 8),
    );
  } else {
    binArrayBytes = new Uint8Array(index.toArrayLike(Buffer, "le", 8));
  }
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bin_array"), lbPair.toBytes(), binArrayBytes],
    programId,
  );
}

export function deriveReserve(
  token: PublicKey,
  lbPair: PublicKey,
  programId: PublicKey,
) {
  return PublicKey.findProgramAddressSync(
    [lbPair.toBuffer(), token.toBuffer()],
    programId,
  );
}

export function deriveTokenBadge(mint: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("token_badge"), mint.toBuffer()],
    programId,
  );
}

export function deriveEventAuthority(programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    programId,
  );
}

export function deriveRewardVault(
  lbPair: PublicKey,
  rewardIndex: BN,
  programId: PublicKey,
) {
  return PublicKey.findProgramAddressSync(
    [lbPair.toBuffer(), rewardIndex.toArrayLike(Buffer, "le", 8)],
    programId,
  );
}

export function derivePlaceHolderAccountMeta(
  programId: PublicKey,
): AccountMeta {
  return {
    pubkey: programId,
    isWritable: false,
    isSigner: false,
  };
}

export function deriveOperator(
  whitelistedSigner: PublicKey,
  programId: PublicKey,
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("operator"), whitelistedSigner.toBuffer()],
    programId,
  )[0];
}
