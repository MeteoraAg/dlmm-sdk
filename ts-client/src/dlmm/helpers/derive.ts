import { BN } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
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
  programId: PublicKey
) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("preset_parameter2"),
      new Uint8Array(index.toArrayLike(Buffer, "le", 2)),
    ],
    programId
  );
}

export function deriveLbPairWithPresetParamWithIndexKey(
  presetParameterKey: PublicKey,
  tokenX: PublicKey,
  tokenY: PublicKey,
  programId: PublicKey
) {
  const [minKey, maxKey] = sortTokenMints(tokenX, tokenY);
  return PublicKey.findProgramAddressSync(
    [presetParameterKey.toBuffer(), minKey.toBuffer(), maxKey.toBuffer()],
    programId
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
    programId
  );
}

export function derivePresetParameter2(
  binStep: BN,
  baseFactor: BN,
  programId: PublicKey
) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("preset_parameter"),
      new Uint8Array(binStep.toArrayLike(Buffer, "le", 2)),
      new Uint8Array(baseFactor.toArrayLike(Buffer, "le", 2)),
    ],
    programId
  );
}

export function deriveLbPair2(
  tokenX: PublicKey,
  tokenY: PublicKey,
  binStep: BN,
  baseFactor: BN,
  programId: PublicKey
) {
  const [minKey, maxKey] = sortTokenMints(tokenX, tokenY);
  return PublicKey.findProgramAddressSync(
    [
      minKey.toBuffer(),
      maxKey.toBuffer(),
      new Uint8Array(binStep.toArrayLike(Buffer, "le", 2)),
      new Uint8Array(baseFactor.toArrayLike(Buffer, "le", 2)),
    ],
    programId
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
  programId: PublicKey
) {
  const [minKey, maxKey] = sortTokenMints(tokenX, tokenY);
  return PublicKey.findProgramAddressSync(
    [
      minKey.toBuffer(),
      maxKey.toBuffer(),
      new Uint8Array(binStep.toArrayLike(Buffer, "le", 2)),
    ],
    programId
  );
}

export function deriveCustomizablePermissionlessLbPair(
  tokenX: PublicKey,
  tokenY: PublicKey,
  programId: PublicKey
) {
  const [minKey, maxKey] = sortTokenMints(tokenX, tokenY);
  return PublicKey.findProgramAddressSync(
    [ILM_BASE.toBuffer(), minKey.toBuffer(), maxKey.toBuffer()],
    programId
  );
}

export function derivePermissionLbPair(
  baseKey: PublicKey,
  tokenX: PublicKey,
  tokenY: PublicKey,
  binStep: BN,
  programId: PublicKey
) {
  const [minKey, maxKey] = sortTokenMints(tokenX, tokenY);
  return PublicKey.findProgramAddressSync(
    [
      baseKey.toBuffer(),
      minKey.toBuffer(),
      maxKey.toBuffer(),
      new Uint8Array(binStep.toArrayLike(Buffer, "le", 2)),
    ],
    programId
  );
}

export function deriveOracle(lbPair: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), lbPair.toBytes()],
    programId
  );
}

export function derivePosition(
  lbPair: PublicKey,
  base: PublicKey,
  lowerBinId: BN,
  width: BN,
  programId: PublicKey
) {
  let lowerBinIdBytes: Uint8Array;
  if (lowerBinId.isNeg()) {
    lowerBinIdBytes = new Uint8Array(
      lowerBinId.toTwos(32).toArrayLike(Buffer, "le", 4)
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
    programId
  );
}

export function deriveBinArray(
  lbPair: PublicKey,
  index: BN,
  programId: PublicKey
) {
  let binArrayBytes: Uint8Array;
  if (index.isNeg()) {
    binArrayBytes = new Uint8Array(
      index.toTwos(64).toArrayLike(Buffer, "le", 8)
    );
  } else {
    binArrayBytes = new Uint8Array(index.toArrayLike(Buffer, "le", 8));
  }
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bin_array"), lbPair.toBytes(), binArrayBytes],
    programId
  );
}

export function deriveReserve(
  token: PublicKey,
  lbPair: PublicKey,
  programId: PublicKey
) {
  return PublicKey.findProgramAddressSync(
    [lbPair.toBuffer(), token.toBuffer()],
    programId
  );
}

export function deriveTokenBadge(mint: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("token_badge"), mint.toBuffer()],
    programId
  );
}

export function deriveEventAuthority(programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    programId
  );
}

export function deriveRewardVault(
  lbPair: PublicKey,
  rewardIndex: BN,
  programId: PublicKey
) {
  return PublicKey.findProgramAddressSync(
    [lbPair.toBuffer(), rewardIndex.toArrayLike(Buffer, "le", 8)],
    programId
  );
}
