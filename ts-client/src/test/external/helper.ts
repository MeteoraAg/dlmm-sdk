import { Program, web3 } from "@coral-xyz/anchor";
import { TransferHookCounter } from "./transfer_hook_counter";
import { getExtraAccountMetaAddress } from "@solana/spl-token";

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
    .accounts({
      mint,
      counterAccount,
      extraAccountMetaList,
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
