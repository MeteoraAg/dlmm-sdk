import {
  addExtraAccountMetasForExecute,
  createTransferCheckedInstruction,
  getTransferHook,
  TOKEN_PROGRAM_ID,
  unpackMint,
} from "@solana/spl-token";
import {
  AccountInfo,
  AccountMeta,
  Connection,
  PublicKey,
} from "@solana/web3.js";

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
