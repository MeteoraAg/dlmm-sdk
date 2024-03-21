import { BN } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { DLMM } from "..";

/** private */
function sortTokenMints(tokenX: PublicKey, tokenY: PublicKey) {
  const [minKey, maxKey] =
    tokenX.toBuffer().compare(tokenY.toBuffer()) == 1
      ? [tokenY, tokenX]
      : [tokenX, tokenY];
  return [minKey, maxKey];
}
/** private */

export function derivePresetParameter(binStep: BN, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("preset_parameter"),
      new Uint8Array(binStep.toBuffer("le", 2)),
    ],
    programId
  );
}

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

export async function checkPoolExists(
  connection: Connection,
  tokenX: PublicKey,
  tokenY: PublicKey,
  binStep: BN,
  programId: PublicKey
): Promise<PublicKey | false> {
  try {
    const [lbPairKey] = deriveLbPair(tokenX, tokenY, binStep, programId);
    const dlmm = await DLMM.create(connection, lbPairKey);
    await dlmm.program.account.lbPair.fetch(lbPairKey);
    return lbPairKey;
  } catch {
    return false;
  }
}

export function deriveOracle(lbPair: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), lbPair.toBytes()],
    programId
  );
}

export function derivePosition(mint: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), mint.toBuffer()],
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
