import {
  AddressLookupTableAccount,
  Commitment,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { ResizeSide } from "../types";

// https://solscan.io/tx/4ryJKTB1vYmGU6YnUWwbLps18FaJjiTwgRozcgdP8RFcwp7zUZi85vgWE7rARNx2NvzDJiM9CUWArqzY7LHv38WL
export const DEFAULT_ADD_LIQUIDITY_CU = 1_000_000;
export const DEFAULT_EXTEND_POSITION_HIGH_CU = 1_000_000;
export const DEFAULT_EXTEND_POSITION_LOW_CU = 30_000;
export const DEFAULT_INIT_POSITION_CU = 25_000;
export const DEFAULT_INIT_BIN_ARRAY_CU = 300_000;
// https://explorer.solana.com/tx/2M5gDryEQqNfmZHuteUyL6H1yustaz7MsMiQYLi6ZpkWqHh2F3i2pAcmsDjRbqHzBYk7UREmWdCpRJECD14wu4QA?cluster=devnet
export const DEFAULT_INIT_ATA_CU = 28_000;
export const DEFAULT_CLOSE_ATA_CU = 5000;
export const DEFAULT_INIT_BITMAP_EXTENSION_CU = 10_000;
// https://solscan.io/tx/4zvVUkW8XFHVffpEHARbdfdjdNm9KhitWLD3BntwL8Dr61bGsf2tmXm4npqmxFSRM1RZE4p7MzLpJksmeghPYcWS
export const DEFAULT_REBALANCE_ADD_LIQUIDITY_CU = 450_000;

export const MIN_CU_BUFFER = 50_000;
export const MAX_CU_BUFFER = 200_000;
export const MAX_CU = 1_400_000;

// CU estimate is difficult due to the CU estimated is based on current position state. We use hardcoded value ...
export const getDefaultExtendPositionCU = (side: ResizeSide) => {
  switch (side) {
    case ResizeSide.Lower:
      return DEFAULT_EXTEND_POSITION_HIGH_CU;
    case ResizeSide.Upper:
      return DEFAULT_EXTEND_POSITION_LOW_CU;
  }
};

export const getSimulationComputeUnits = async (
  connection: Connection,
  instructions: Array<TransactionInstruction>,
  payer: PublicKey,
  lookupTables: Array<AddressLookupTableAccount> | [],
  commitment: Commitment = "confirmed"
): Promise<number | null> => {
  const testInstructions = [
    // Set an arbitrarily high number in simulation
    // so we can be sure the transaction will succeed
    // and get the real compute units used
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ...instructions,
  ];

  const testTransaction = new VersionedTransaction(
    new TransactionMessage({
      instructions: testInstructions,
      payerKey: payer,
      // RecentBlockhash can by any public key during simulation
      // since 'replaceRecentBlockhash' is set to 'true' below
      recentBlockhash: PublicKey.default.toString(),
    }).compileToV0Message(lookupTables)
  );

  const rpcResponse = await connection.simulateTransaction(testTransaction, {
    replaceRecentBlockhash: true,
    sigVerify: false,
    commitment,
  });

  if (rpcResponse?.value?.err) {
    const logs = rpcResponse.value.logs?.join("\n  • ") || "No logs available";
    throw new Error(
      `Transaction simulation failed:\n  •${logs}` +
        JSON.stringify(rpcResponse?.value?.err)
    );
  }

  return rpcResponse.value.unitsConsumed || null;
};
