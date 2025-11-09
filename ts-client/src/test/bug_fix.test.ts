import {
  createAssociatedTokenAccountIdempotent,
  createAssociatedTokenAccountIdempotentInstruction,
  createMint,
  getAssociatedTokenAddressSync,
  mintTo,
  NATIVE_MINT,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { BN, min } from "bn.js";
import { DLMM } from "../dlmm";
import { LBCLMM_PROGRAM_IDS } from "../dlmm/constants";
import {
  decodeAccount,
  deriveCustomizablePermissionlessLbPair,
  deriveLbPairWithPresetParamWithIndexKey,
  derivePresetParameterWithIndex,
} from "../dlmm/helpers";
import { StrategyType } from "../dlmm/types";
import { createTestProgram } from "./helper";
import fs from "fs";

const connection = new Connection("http://127.0.0.1:8899", "confirmed");

const keypairBuffer = fs.readFileSync(
  "../keys/localnet/admin-bossj3JvwiNK7pvjr149DqdtJxf2gdygbcmEPTkb2F1.json",
  "utf-8"
);

const adminKeypair = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(keypairBuffer))
);

async function createMintAndCustomizablePair(
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

async function createMintAndStandardPair(
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
  const baseFactor = new BN(10_000);
  const filterPeriod = new BN(30);
  const decayPeriod = new BN(600);
  const reductionFactor = new BN(5_000);
  const variableFeeControl = new BN(40_000);
  const protocolShare = new BN(0);
  const maxVolatilityAccumulator = new BN(350_000);
  const baseFeePowerFactor = new BN(0);

  const { presetParameter2 } = await DLMM.getAllPresetParameters(connection, {
    cluster: "localhost",
  });

  const index = new BN(presetParameter2.length);
  const programId = new PublicKey(LBCLMM_PROGRAM_IDS["localhost"]);
  const presetParamsPda = derivePresetParameterWithIndex(index, programId)[0];

  const program = createTestProgram(connection, programId, keypair);
  const initIx = await program.methods
    .initializePresetParameter2({
      index: index.toNumber(),
      binStep: binStep.toNumber(),
      baseFactor: baseFactor.toNumber(),
      filterPeriod: filterPeriod.toNumber(),
      decayPeriod: decayPeriod.toNumber(),
      reductionFactor: reductionFactor.toNumber(),
      variableFeeControl: variableFeeControl.toNumber(),
      protocolShare: protocolShare.toNumber(),
      maxVolatilityAccumulator: maxVolatilityAccumulator.toNumber(),
      baseFeePowerFactor: baseFeePowerFactor.toNumber(),
    })
    .accountsPartial({
      admin: keypair.publicKey,
      presetParameter: presetParamsPda,
    })
    .instruction();

  const tx = new Transaction();
  tx.add(initIx);

  let latestBlockhashInfo = await connection.getLatestBlockhash();
  tx.recentBlockhash = latestBlockhashInfo.blockhash;
  tx.feePayer = keypair.publicKey;

  tx.sign(keypair);
  const serializedTx = tx.serialize();

  let txSig = await connection.sendRawTransaction(serializedTx);
  await connection.confirmTransaction(txSig, "confirmed");

  const pairAddress = deriveLbPairWithPresetParamWithIndexKey(
    presetParamsPda,
    mintA instanceof Keypair ? mintA.publicKey : mintA,
    mintB instanceof Keypair ? mintB.publicKey : mintB,
    programId
  )[0];

  const initPairTx = await DLMM.createLbPair2(
    connection,
    keypair.publicKey,
    mintA instanceof Keypair ? mintA.publicKey : mintA,
    mintB instanceof Keypair ? mintB.publicKey : mintB,
    presetParamsPda,
    new BN(0),
    {
      cluster: "localhost",
    }
  );

  latestBlockhashInfo = await connection.getLatestBlockhash();
  initPairTx.recentBlockhash = latestBlockhashInfo.blockhash;
  initPairTx.feePayer = keypair.publicKey;

  initPairTx.sign(keypair);
  const serializedInitPairTx = initPairTx.serialize();

  txSig = await connection.sendRawTransaction(serializedInitPairTx);
  await connection.confirmTransaction(txSig, "confirmed");

  return pairAddress;
}

describe("Bug fixes", () => {
  it("Rebalance wrap more tokens than needed", async () => {
    const user = adminKeypair;

    const mintA = Keypair.generate();
    const mintB = NATIVE_MINT;

    const pairAddress = await createMintAndCustomizablePair(mintA, mintB, user);
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
    let txSig = await connection.sendRawTransaction(initPositionTx.serialize());
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
      slippage: 12,
    });

    expect(addLiquidityTxs.length).toBe(1);

    const addLiquidityTx = addLiquidityTxs[0];
    await addLiquidityTx.sign(user);

    const result = await connection.simulateTransaction(addLiquidityTx, [user]);
    expect(result.value.err).toBeNull();
  });

  it("Deposit with rebalance wrap extra SOL for slippage", async () => {
    const user = adminKeypair;

    const mintA = NATIVE_MINT;
    const mintB = Keypair.generate();

    const pairAddress = await createMintAndStandardPair(mintA, mintB, user);

    const dlmm = await DLMM.create(connection, pairAddress, {
      cluster: "localhost",
    });

    const positionKeypairGenerator = async (count: number) => {
      const keypairs: Keypair[] = [];
      for (let i = 0; i < count; i++) {
        keypairs.push(Keypair.generate());
      }
      return keypairs;
    };

    const { instructionsByPositions } =
      await dlmm.initializeMultiplePositionAndAddLiquidityByStrategy2(
        positionKeypairGenerator,
        new BN(1e9),
        new BN(1e9),
        {
          strategyType: StrategyType.Spot,
          minBinId: dlmm.lbPair.activeId - 100,
          maxBinId: dlmm.lbPair.activeId + 100,
        },
        user.publicKey,
        user.publicKey,
        1
      );

    for (const {
      positionKeypair,
      transactionInstructions,
    } of instructionsByPositions) {
      for (const ixs of transactionInstructions) {
        const tx = new Transaction();
        tx.add(...ixs);
        const latestBlockhashInfo = await connection.getLatestBlockhash();
        tx.recentBlockhash = latestBlockhashInfo.blockhash;
        tx.feePayer = user.publicKey;

        await tx.sign(user, positionKeypair);
        const serializedTx = tx.serialize();

        const txSig = await connection.sendRawTransaction(serializedTx);
        await connection.confirmTransaction(txSig, "confirmed");
      }
    }

    await dlmm.refetchStates();
    console.log(dlmm.lbPair.activeId);

    const binArraysForSwap = await dlmm.getBinArrayForSwap(true);
    const swapTx = await dlmm.swap({
      lbPair: dlmm.pubkey,
      inToken: dlmm.tokenX.mint.address,
      outToken: dlmm.tokenY.mint.address,
      inAmount: new BN(5e7),
      minOutAmount: new BN(0),
      binArraysPubkey: binArraysForSwap.map((b) => b.publicKey),
      user: user.publicKey,
    });

    let latestBlockhashInfo = await connection.getLatestBlockhash();
    swapTx.recentBlockhash = latestBlockhashInfo.blockhash;
    swapTx.feePayer = user.publicKey;

    await swapTx.sign(user);
    let serializedTx = swapTx.serialize();

    let txSig = await connection.sendRawTransaction(serializedTx);
    await connection.confirmTransaction(txSig, "confirmed");

    for (const {
      positionKeypair,
      transactionInstructions,
    } of instructionsByPositions) {
      for (const ixs of transactionInstructions) {
        const tx = new Transaction();
        tx.add(...ixs);
        const latestBlockhashInfo = await connection.getLatestBlockhash();
        tx.recentBlockhash = latestBlockhashInfo.blockhash;
        tx.feePayer = user.publicKey;

        const simResult = await connection.simulateTransaction(tx, [
          user,
          positionKeypair,
        ]);

        expect(simResult.value.err).toBeNull();
      }
    }
  });
});
