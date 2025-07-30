import { AnchorProvider, Program, Wallet, web3 } from "@coral-xyz/anchor";
import { TransferHookCounter } from "./transfer_hook_counter";
import TransferHookCounterIDL from "./transfer_hook_counter.json";
import { Connection } from "@solana/web3.js";

export const TRANSFER_HOOK_COUNTER_PROGRAM_ID = new web3.PublicKey(
  "abcSyangMHdGzUGKhBhKoQzSFdJKUdkPGf5cbXVHpEw"
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
    { ...TransferHookCounterIDL, address: programId },
    provider
  );

  return program;
}
