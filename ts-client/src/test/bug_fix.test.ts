import {
  createAssociatedTokenAccountIdempotent,
  createAssociatedTokenAccountIdempotentInstruction,
  createMint,
  getAssociatedTokenAddressSync,
  mintTo,
  NATIVE_MINT,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { BN } from "bn.js";
import { DLMM } from "../dlmm";
import { FunctionType, LBCLMM_PROGRAM_IDS } from "../dlmm/constants";
import { deriveCustomizablePermissionlessLbPair } from "../dlmm/helpers";
import { StrategyType } from "../dlmm/types";

const connection = new Connection("http://127.0.0.1:8899", "confirmed");

async function createMintAndPair(
  mintA: Keypair | PublicKey,
  mintB: Keypair | PublicKey,
  keypair: Keypair
) {
  for (const mint of [mintA, mintB]) {
    if (mint instanceof Keypair) {
      await createMint(connection, keypair, keypair.publicKey, null, 9, mint);

      const userToken = getAssociatedTokenAddressSync(
        mint.publicKey,
        keypair.publicKey
      );

      await createAssociatedTokenAccountIdempotent(
        connection,
        keypair,
        mint.publicKey,
        keypair.publicKey
      );

      await mintTo(
        connection,
        keypair,
        mint.publicKey,
        userToken,
        keypair,
        BigInt("1000000000000")
      );
    }
  }

  const binStep = new BN(10);
  const activeId = new BN(0);
  const feeBps = new BN(100);

  const initTx = await DLMM.createCustomizablePermissionlessLbPair2(
    connection,
    binStep,
    mintA instanceof Keypair ? mintA.publicKey : mintA,
    mintB instanceof Keypair ? mintB.publicKey : mintB,
    activeId,
    feeBps,
    1,
    false,
    keypair.publicKey,
    null,
    null,
    {
      cluster: "localhost",
    }
  );

  const userTokenX = getAssociatedTokenAddressSync(
    mintA instanceof Keypair ? mintA.publicKey : mintA,
    keypair.publicKey
  );

  const userTokenY = getAssociatedTokenAddressSync(
    mintB instanceof Keypair ? mintB.publicKey : mintB,
    keypair.publicKey
  );

  const initUserTokenXIx = createAssociatedTokenAccountIdempotentInstruction(
    keypair.publicKey,
    userTokenX,
    keypair.publicKey,
    mintA instanceof Keypair ? mintA.publicKey : mintA
  );

  const initUserTokenYIx = createAssociatedTokenAccountIdempotentInstruction(
    keypair.publicKey,
    userTokenY,
    keypair.publicKey,
    mintB instanceof Keypair ? mintB.publicKey : mintB
  );

  const latestBlockhashInfo = await connection.getLatestBlockhash();
  const tx = new Transaction({
    ...latestBlockhashInfo,
  }).add(initUserTokenXIx, initUserTokenYIx, ...initTx.instructions);

  tx.sign(keypair);
  const serializedTx = tx.serialize();

  const txSig = await connection.sendRawTransaction(serializedTx);
  await connection.confirmTransaction(txSig, "confirmed");

  const pairAddress = await deriveCustomizablePermissionlessLbPair(
    mintA instanceof Keypair ? mintA.publicKey : mintA,
    mintB instanceof Keypair ? mintB.publicKey : mintB,
    new PublicKey(LBCLMM_PROGRAM_IDS["localhost"])
  )[0];

  return pairAddress;
}

describe("Bug fixes", () => {
  it("Rebalance wrap more tokens than needed", async () => {
    const user = Keypair.generate();

    let txSig = await connection.requestAirdrop(user.publicKey, 5e9);
    await connection.confirmTransaction(txSig, "confirmed");

    const mintA = Keypair.generate();
    const mintB = NATIVE_MINT;

    const pairAddress = await createMintAndPair(mintA, mintB, user);
    const dlmm = await DLMM.create(connection, pairAddress, {
      cluster: "localhost",
    });

    const positionKeypair = Keypair.generate();

    const minBinId = dlmm.lbPair.activeId - 59;
    const maxBinId = dlmm.lbPair.activeId - 1;

    const initPositionTx = await dlmm.createEmptyPosition({
      positionPubKey: positionKeypair.publicKey,
      minBinId,
      maxBinId,
      user: user.publicKey,
    });

    await initPositionTx.sign(user, positionKeypair);
    txSig = await connection.sendRawTransaction(initPositionTx.serialize());
    await connection.confirmTransaction(txSig, "confirmed");

    const addLiquidityTxs = await dlmm.addLiquidityByStrategyChunkable({
      positionPubKey: positionKeypair.publicKey,
      totalXAmount: new BN(0),
      totalYAmount: new BN(4e9),
      strategy: {
        minBinId,
        maxBinId,
        strategyType: StrategyType.Curve,
      },
      user: user.publicKey,
      slippage: 0,
    });

    expect(addLiquidityTxs.length).toBe(1);

    const addLiquidityTx = addLiquidityTxs[0];
    await addLiquidityTx.sign(user);

    const result = await connection.simulateTransaction(addLiquidityTx, [user]);
    expect(result.value.err).toBeNull();
  });
});
