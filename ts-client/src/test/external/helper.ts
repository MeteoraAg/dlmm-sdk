import { Program, web3 } from "@coral-xyz/anchor";
import { TransferHookCounter } from "./transfer_hook_counter";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getExtraAccountMetaAddress,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { SystemProgram } from "@solana/web3.js";

export async function createExtraAccountMetaListAndCounter(
  program: Program<TransferHookCounter>,
  mint: web3.PublicKey
) {
  const extraAccountMetaList = getExtraAccountMetaAddress(
    mint,
    program.programId
  );
  const counterAccount = deriveCounter(mint, program.programId);

  await program.methods
    .initializeExtraAccountMetaList()
    .accountsStrict({
      mint,
      counterAccount,
      extraAccountMetaList,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      payer: program.provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();

  return [extraAccountMetaList, counterAccount];
}

export function deriveCounter(mint: web3.PublicKey, programId: web3.PublicKey) {
  const [counter] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("counter"), mint.toBuffer()],
    programId
  );

  return counter;
}
