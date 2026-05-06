import { Program, web3 } from "@coral-xyz/anchor";
import { TransferHookCounter } from "./transfer_hook_counter";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getExtraAccountMetaAddress,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

export async function createExtraAccountMetaListAndCounter(
  connection: Connection,
  keypair: Keypair,
  program: Program<TransferHookCounter>,
  mint: web3.PublicKey,
) {
  const extraAccountMetaList = getExtraAccountMetaAddress(
    mint,
    program.programId,
  );
  const counterAccount = deriveCounter(mint, program.programId);

  const initIx = await program.methods
    .initializeExtraAccountMetaList()
    .accountsStrict({
      mint,
      counterAccount,
      extraAccountMetaList,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      payer: keypair.publicKey,
      systemProgram: SystemProgram.programId,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .instruction();

  const latestBlockhash = await connection.getLatestBlockhash();
  const tx = new Transaction({
    ...latestBlockhash,
    feePayer: keypair.publicKey,
  });
  tx.add(initIx);

  await sendAndConfirmTransaction(connection, tx, [keypair]);

  return [extraAccountMetaList, counterAccount];
}

export function deriveCounter(mint: web3.PublicKey, programId: web3.PublicKey) {
  const [counter] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("counter"), mint.toBuffer()],
    programId,
  );

  return counter;
}
