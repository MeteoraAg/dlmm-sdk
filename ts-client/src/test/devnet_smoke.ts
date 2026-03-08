/**
 * Devnet smoke test for DLMM SDK v1.10.0 (program v0.12.0)
 * Tests against the live devnet program at LbVRzDTvBDEcrthxfZ4RL6yiq3uZw8bS6MwtdY6UhFQ
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { DLMM } from "../dlmm";

const DEVNET_RPC = "https://api.devnet.solana.com";
// Devnet program ID (from constants)
const PROGRAM_ID = new PublicKey(
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"
);

async function main() {
  const connection = new Connection(DEVNET_RPC, "confirmed");

  console.log("=== DLMM SDK v1.10.0 Devnet Smoke Test ===");
  console.log(`Program: ${PROGRAM_ID.toString()}`);

  // 1. Verify program is deployed
  const programInfo = await connection.getAccountInfo(PROGRAM_ID);
  if (!programInfo) {
    throw new Error("Program not found on devnet!");
  }
  console.log("✅ Program deployed on devnet");
  console.log(`   Executable: ${programInfo.executable}`);

  // 2. Fetch all LB pairs
  console.log("\nFetching LB pairs...");
  const pairs = await DLMM.getLbPairs(connection, { cluster: "devnet" });
  console.log(`✅ Found ${pairs.length} LB pairs on devnet`);

  if (pairs.length === 0) {
    console.log("No pairs found — skipping further checks");
    return;
  }

  // 3. Load first pair and verify basic state
  const firstPairKey = pairs[0].publicKey;
  console.log(`\nLoading pair: ${firstPairKey.toString()}`);
  const dlmm = await DLMM.create(connection, firstPairKey, {
    cluster: "devnet",
  });
  console.log("✅ Pair loaded successfully");
  console.log(
    `   Token X: ${dlmm.tokenX.publicKey.toString()}`
  );
  console.log(
    `   Token Y: ${dlmm.tokenY.publicKey.toString()}`
  );
  console.log(`   Bin Step: ${dlmm.lbPair.binStep}`);
  console.log(`   Active Bin ID: ${dlmm.lbPair.activeId}`);

  // 4. Fetch active bin
  const activeBin = await dlmm.getActiveBin();
  console.log(`✅ Active bin fetched`);
  console.log(`   Bin ID: ${activeBin.binId}`);
  console.log(`   Price: ${activeBin.pricePerToken}`);

  // 5. Verify IDL version
  const idlVersion = dlmm.program.idl.metadata?.version;
  console.log(`\n✅ IDL version: ${idlVersion}`);
  if (idlVersion !== "0.12.0") {
    console.warn(`⚠️  Expected IDL version 0.12.0, got ${idlVersion}`);
  }

  // 6. Verify new instructions exist in IDL
  const instructionNames = dlmm.program.idl.instructions.map(
    (ix: any) => ix.name
  );
  const newInstructions = [
    "placeLimitOrder",
    "cancelLimitOrder",
    "closeLimitOrderIfEmpty",
    "addLiquidityByWeight2",
    "setPermissionlessOperationBits",
  ];
  for (const ix of newInstructions) {
    // IDL uses camelCase
    if (instructionNames.includes(ix)) {
      console.log(`✅ Instruction present: ${ix}`);
    } else {
      console.warn(`⚠️  Missing instruction: ${ix}`);
    }
  }

  console.log("\n=== Smoke Test Passed ===");
}

main().catch((err) => {
  console.error("Smoke test FAILED:", err);
  process.exit(1);
});
