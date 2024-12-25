import {
  addExtraAccountMetasForExecute,
  createTransferCheckedInstruction,
  getTransferHook,
  TOKEN_PROGRAM_ID,
  unpackMint,
} from "@solana/spl-token";
import { AccountInfo, Connection, PublicKey } from "@solana/web3.js";

export async function getExtraAccountMetasForTransferHook(
  connection: Connection,
  mintAddress: PublicKey,
  mintAccountInfo: AccountInfo<Buffer>
) {
  const mintState = unpackMint(
    mintAddress,
    mintAccountInfo,
    mintAccountInfo.owner
  );

  if (mintAccountInfo.owner.equals(TOKEN_PROGRAM_ID)) {
    return [];
  }

  const transferHook = getTransferHook(mintState);

  if (!transferHook) {
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
    return instruction.keys.slice(4);
  }
}
