import {
  createAssociatedTokenAccountIdempotent,
  createAssociatedTokenAccountIdempotentInstruction,
  createMint,
  getAssociatedTokenAddressSync,
  mintTo,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { BN } from "bn.js";
import fs from "fs";
import { DLMM } from "../dlmm";
import { ConcreteFunctionType, LBCLMM_PROGRAM_IDS } from "../dlmm/constants";
import {
  binIdToBinArrayIndex,
  deriveBinArray,
  deriveCustomizablePermissionlessLbPair,
  deriveOperator,
  deriveRewardVault,
} from "../dlmm/helpers";
import { StrategyType } from "../dlmm/types";
import {
  createTestProgram,
  createWhitelistOperator,
  OperatorPermission,
  swap,
} from "./helper";

const connection = new Connection("http://127.0.0.1:8899", "confirmed");

const adminKeypairBuffer = fs.readFileSync(
  "../keys/localnet/admin-bossj3JvwiNK7pvjr149DqdtJxf2gdygbcmEPTkb2F1.json",
  "utf-8",
);
const adminKeypair = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(adminKeypairBuffer)),
);
const programId = new PublicKey(LBCLMM_PROGRAM_IDS["localhost"]);

async function createMintAndPair(
  mintA: Keypair | PublicKey,
  mintB: Keypair | PublicKey,
  keypair: Keypair,
) {
  for (const mint of [mintA, mintB]) {
    if (mint instanceof Keypair) {
      await createMint(connection, keypair, keypair.publicKey, null, 9, mint);

      const userToken = getAssociatedTokenAddressSync(
        mint.publicKey,
        keypair.publicKey,
      );

      await createAssociatedTokenAccountIdempotent(
        connection,
        keypair,
        mint.publicKey,
        keypair.publicKey,
      );

      await mintTo(
        connection,
        keypair,
        mint.publicKey,
        userToken,
        keypair,
        BigInt("1000000000000"),
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
    ConcreteFunctionType.LiquidityMining,
    null,
    {
      cluster: "localhost",
    },
  );

  const userTokenX = getAssociatedTokenAddressSync(
    mintA instanceof Keypair ? mintA.publicKey : mintA,
    keypair.publicKey,
  );

  const userTokenY = getAssociatedTokenAddressSync(
    mintB instanceof Keypair ? mintB.publicKey : mintB,
    keypair.publicKey,
  );

  const initUserTokenXIx = createAssociatedTokenAccountIdempotentInstruction(
    keypair.publicKey,
    userTokenX,
    keypair.publicKey,
    mintA instanceof Keypair ? mintA.publicKey : mintA,
  );

  const initUserTokenYIx = createAssociatedTokenAccountIdempotentInstruction(
    keypair.publicKey,
    userTokenY,
    keypair.publicKey,
    mintB instanceof Keypair ? mintB.publicKey : mintB,
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
    new PublicKey(LBCLMM_PROGRAM_IDS["localhost"]),
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

  it("removeLiquidity with shouldClaimAndClose when fees exist in empty bins", async () => {
    const user = Keypair.generate();
    let txSig = await connection.requestAirdrop(user.publicKey, 5e9);
    await connection.confirmTransaction(txSig, "confirmed");

    const mintA = Keypair.generate();
    const mintB = Keypair.generate();

    const pairAddress = await createMintAndPair(mintA, mintB, user);
    const dlmm = await DLMM.create(connection, pairAddress, {
      cluster: "localhost",
    });

    const positionKeypair = Keypair.generate();
    const minBinId = dlmm.lbPair.activeId - 5;
    const maxBinId = dlmm.lbPair.activeId + 5;

    const initPositionTx = await dlmm.createEmptyPosition({
      positionPubKey: positionKeypair.publicKey,
      minBinId,
      maxBinId,
      user: user.publicKey,
    });
    await sendAndConfirmTransaction(connection, initPositionTx, [
      user,
      positionKeypair,
    ]);

    const addLiquidityTxs = await dlmm.addLiquidityByStrategyChunkable({
      positionPubKey: positionKeypair.publicKey,
      totalXAmount: new BN(100e9),
      totalYAmount: new BN(100e9),
      strategy: {
        minBinId,
        maxBinId,
        strategyType: StrategyType.Spot,
      },
      user: user.publicKey,
      slippage: 0,
    });
    for (const tx of addLiquidityTxs) {
      await sendAndConfirmTransaction(connection, tx, [user]);
    }

    await swap(true, new BN(10e9), dlmm, user);
    await swap(false, new BN(10e9), dlmm, user);

    await dlmm.refetchStates();
    const removeTxs = await dlmm.removeLiquidity({
      user: user.publicKey,
      position: positionKeypair.publicKey,
      fromBinId: minBinId,
      toBinId: maxBinId,
      bps: new BN(10_000),
      shouldClaimAndClose: false,
    });
    for (const tx of removeTxs) {
      await sendAndConfirmTransaction(connection, tx, [user]);
    }

    await dlmm.refetchStates();
    const { userPositions } = await dlmm.getPositionsByUserAndLbPair(
      user.publicKey,
    );
    const pos = userPositions.find((p) =>
      p.publicKey.equals(positionKeypair.publicKey),
    );
    // position has no liquidity
    expect(Number(pos.positionData.totalXAmount)).toBe(0);
    expect(Number(pos.positionData.totalYAmount)).toBe(0);

    const claimAndCloseTxs = await dlmm.removeLiquidity({
      user: user.publicKey,
      position: positionKeypair.publicKey,
      fromBinId: minBinId,
      toBinId: maxBinId,
      bps: new BN(10_000),
      shouldClaimAndClose: true,
    });
    for (const tx of claimAndCloseTxs) {
      await sendAndConfirmTransaction(connection, tx, [user]);
    }

    const positionAccount = await connection.getAccountInfo(
      positionKeypair.publicKey,
    );
    expect(positionAccount).toBeNull();
  });

  it("removeLiquidity with shouldClaimAndClose when rewards exist in empty bins", async () => {
    const user = Keypair.generate();
    let txSig = await connection.requestAirdrop(user.publicKey, 5e9);
    await connection.confirmTransaction(txSig, "confirmed");
    txSig = await connection.requestAirdrop(adminKeypair.publicKey, 5e9);
    await connection.confirmTransaction(txSig, "confirmed");

    const mintA = Keypair.generate();
    const mintB = Keypair.generate();

    const rewardMintKeypair = Keypair.generate();
    await createMint(
      connection,
      adminKeypair,
      adminKeypair.publicKey,
      null,
      9,
      rewardMintKeypair,
    );
    const adminRewardAta = await createAssociatedTokenAccountIdempotent(
      connection,
      adminKeypair,
      rewardMintKeypair.publicKey,
      adminKeypair.publicKey,
    );
    await mintTo(
      connection,
      adminKeypair,
      rewardMintKeypair.publicKey,
      adminRewardAta,
      adminKeypair,
      BigInt("1000000000000"),
    );

    const pairAddress = await createMintAndPair(mintA, mintB, user);
    let dlmm = await DLMM.create(connection, pairAddress, {
      cluster: "localhost",
    });

    await createWhitelistOperator(
      connection,
      adminKeypair,
      adminKeypair.publicKey,
      [OperatorPermission.InitializeReward],
      programId,
    );

    const program = createTestProgram(connection, programId, adminKeypair);
    const rewardIndex = new BN(0);
    const rewardDuration = new BN(300);

    const [rewardVault] = deriveRewardVault(
      pairAddress,
      rewardIndex,
      programId,
    );

    const operatorPda = deriveOperator(adminKeypair.publicKey, programId);

    await program.methods
      .initializeReward(rewardIndex, rewardDuration, adminKeypair.publicKey)
      .accountsPartial({
        lbPair: pairAddress,
        rewardMint: rewardMintKeypair.publicKey,
        rewardVault,
        signer: adminKeypair.publicKey,
        tokenBadge: null,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        operator: operatorPda,
      })
      .signers([adminKeypair])
      .rpc();

    const activeBinArrayIndex = binIdToBinArrayIndex(
      new BN(dlmm.lbPair.activeId),
    );
    const activeBinArrayKey = deriveBinArray(
      pairAddress,
      activeBinArrayIndex,
      programId,
    )[0];

    const initBinArrayIxs = await dlmm.initializeBinArrays(
      [activeBinArrayIndex],
      adminKeypair.publicKey,
    );
    if (initBinArrayIxs.length > 0) {
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      const initBinTx = new Transaction({
        blockhash,
        lastValidBlockHeight,
      }).add(...initBinArrayIxs);
      await sendAndConfirmTransaction(connection, initBinTx, [adminKeypair]);
    }

    const fundingAmount = new BN("1000000000000");
    await program.methods
      .fundReward(rewardIndex, fundingAmount, true, {
        slices: [],
      })
      .accountsPartial({
        lbPair: pairAddress,
        rewardMint: rewardMintKeypair.publicKey,
        rewardVault,
        funder: adminKeypair.publicKey,
        binArray: activeBinArrayKey,
        funderTokenAccount: adminRewardAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([adminKeypair])
      .rpc();

    // Re-create DLMM so it picks up the new reward mint in lbPair state
    dlmm = await DLMM.create(connection, pairAddress, {
      cluster: "localhost",
    });

    const positionKeypair = Keypair.generate();
    const minBinId = dlmm.lbPair.activeId - 5;
    const maxBinId = dlmm.lbPair.activeId + 5;

    const initPositionTx = await dlmm.createEmptyPosition({
      positionPubKey: positionKeypair.publicKey,
      minBinId,
      maxBinId,
      user: user.publicKey,
    });
    await sendAndConfirmTransaction(connection, initPositionTx, [
      user,
      positionKeypair,
    ]);

    const addLiquidityTxs = await dlmm.addLiquidityByStrategyChunkable({
      positionPubKey: positionKeypair.publicKey,
      totalXAmount: new BN(100e9),
      totalYAmount: new BN(100e9),
      strategy: {
        minBinId,
        maxBinId,
        strategyType: StrategyType.Spot,
      },
      user: user.publicKey,
      slippage: 0,
    });
    for (const tx of addLiquidityTxs) {
      await sendAndConfirmTransaction(connection, tx, [user]);
    }

    await swap(true, new BN(10e9), dlmm, user);
    await swap(false, new BN(10e9), dlmm, user);
    // sleep for rewards
    await new Promise((resolve) => setTimeout(resolve, 2000));

    await dlmm.refetchStates();
    const removeTxs = await dlmm.removeLiquidity({
      user: user.publicKey,
      position: positionKeypair.publicKey,
      fromBinId: minBinId,
      toBinId: maxBinId,
      bps: new BN(10_000),
      shouldClaimAndClose: false,
    });
    for (const tx of removeTxs) {
      await sendAndConfirmTransaction(connection, tx, [user]);
    }

    await dlmm.refetchStates();
    const { userPositions } = await dlmm.getPositionsByUserAndLbPair(
      user.publicKey,
    );
    const pos = userPositions.find((p) =>
      p.publicKey.equals(positionKeypair.publicKey),
    );
    //  position has no liquidity
    expect(Number(pos.positionData.totalXAmount)).toBe(0);
    expect(Number(pos.positionData.totalYAmount)).toBe(0);

    // claim fee. so only rewards is left
    const claimFeeTxs = await dlmm.claimSwapFee({
      owner: user.publicKey,
      position: pos,
    });
    for (const tx of claimFeeTxs) {
      await sendAndConfirmTransaction(connection, tx, [user]);
    }

    const claimAndCloseTxs = await dlmm.removeLiquidity({
      user: user.publicKey,
      position: positionKeypair.publicKey,
      fromBinId: minBinId,
      toBinId: maxBinId,
      bps: new BN(10_000),
      shouldClaimAndClose: true,
    });
    for (const tx of claimAndCloseTxs) {
      await sendAndConfirmTransaction(connection, tx, [user]);
    }

    const positionAccount = await connection.getAccountInfo(
      positionKeypair.publicKey,
    );
    expect(positionAccount).toBeNull();
  });
});
