import { AnchorProvider, Program, Wallet, web3 } from "@coral-xyz/anchor";
import {
  TransferHookCounter,
  IDL as TransferHookCounterIDL,
} from "./transfer_hook_counter";
import { Connection } from "@solana/web3.js";

export const TRANSFER_HOOK_COUNTER_PROGRAM_ID = new web3.PublicKey(
  "EBZDYx7599krFc4m2govwBdZcicr4GgepqC78m71nsHS"
);

export function createTransferHookCounterProgram(
  wallet: Wallet,
  programId: web3.PublicKey,
  connection: Connection
): Program<TransferHookCounter> {
  const provider = new AnchorProvider(connection, wallet, {
    maxRetries: 3,
  });

  const program = new Program<TransferHookCounter>(
    TransferHookCounterIDL,
    programId,
    provider
  );

  return program;
}
