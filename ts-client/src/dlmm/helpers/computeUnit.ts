import { AddressLookupTableAccount, Commitment, ComputeBudgetProgram, Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

// https://solscan.io/tx/4ryJKTB1vYmGU6YnUWwbLps18FaJjiTwgRozcgdP8RFcwp7zUZi85vgWE7rARNx2NvzDJiM9CUWArqzY7LHv38WL
export const DEFAULT_ADD_LIQUIDITY_CU = 800_000;

export const MIN_CU_BUFFER = 50_000;
export const MAX_CU_BUFFER = 200_000;

export const getSimulationComputeUnits = async (
    connection: Connection,
    instructions: Array<TransactionInstruction>,
    payer: PublicKey,
    lookupTables: Array<AddressLookupTableAccount> | [],
    commitment: Commitment = "confirmed",
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
      }).compileToV0Message(lookupTables),
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
          JSON.stringify(rpcResponse?.value?.err),
      );
    }
  
    return rpcResponse.value.unitsConsumed || null;
  };
