import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { randomInt } from "crypto";
import fs from "fs";
import { DLMM } from "../dlmm";
import {
  CollectFeeMode,
  ConcreteFunctionType,
  LBCLMM_PROGRAM_IDS,
} from "../dlmm/constants";
import {
  binIdToBinArrayIndex,
  deriveBinArray,
  deriveLbPairWithPresetParamWithIndexKey,
  deriveOracle,
  derivePresetParameterWithIndex,
  deriveReserve,
  getBinArrayLowerUpperBinId,
  getBinIdIndexInBinArray,
} from "../dlmm/helpers";
import { Bin, StrategyType } from "../dlmm/types";
import {
  createTestProgram,
  createWhitelistOperator,
  OperatorPermission,
  sendTransactionAndConfirm,
} from "./helper";

const keypairBuffer = fs.readFileSync(
  "../keys/localnet/admin-bossj3JvwiNK7pvjr149DqdtJxf2gdygbcmEPTkb2F1.json",
  "utf-8",
);
const connection = new Connection("http://127.0.0.1:8899", "confirmed");
const adminKeypair = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(keypairBuffer)),
);

const operatorKeypair = Keypair.generate();

const tokenXDecimal = 9;
const tokenYDecimal = 9;

const opt = { cluster: "localhost" as const };

const program = createTestProgram(
  connection,
  new PublicKey(LBCLMM_PROGRAM_IDS["localhost"]),
  adminKeypair,
);

let tokenX: PublicKey;
let tokenY: PublicKey;
let userTokenX: PublicKey;
let userTokenY: PublicKey;
let operatorPda: PublicKey;
let activeBin: Bin;

async function sendAndExpectSwapDeltas(
  swapTransaction: Transaction,
  expectedInAmount: BN,
  expectedOutAmount: BN,
) {
  const [userXBefore, userYBefore] = await Promise.all([
    connection.getTokenAccountBalance(userTokenX, "confirmed"),
    connection.getTokenAccountBalance(userTokenY, "confirmed"),
  ]);

  await sendAndConfirmTransaction(connection, swapTransaction, [adminKeypair], {
    commitment: "confirmed",
  });

  const [userXAfter, userYAfter] = await Promise.all([
    connection.getTokenAccountBalance(userTokenX, "confirmed"),
    connection.getTokenAccountBalance(userTokenY, "confirmed"),
  ]);

  const userXDelta = new BN(userXBefore.value.amount).sub(
    new BN(userXAfter.value.amount),
  );
  const userYDelta = new BN(userYAfter.value.amount).sub(
    new BN(userYBefore.value.amount),
  );

  expect(userXDelta.toString()).toEqual(expectedInAmount.toString());
  expect(userYDelta.toString()).toEqual(expectedOutAmount.toString());
}

describe("Swap quote multi liquidity", () => {
  let pair: DLMM;
  let pairKey: PublicKey;
  let activeBinId: number;

  // One-time global setup: airdrops, mints, operator account.
  beforeAll(async () => {
    const [adminAirdrop, operatorAirdrop] = await Promise.all([
      connection.requestAirdrop(adminKeypair.publicKey, 200 * LAMPORTS_PER_SOL),
      connection.requestAirdrop(
        operatorKeypair.publicKey,
        10 * LAMPORTS_PER_SOL,
      ),
    ]);

    await Promise.all([
      connection.confirmTransaction(adminAirdrop, "confirmed"),
      connection.confirmTransaction(operatorAirdrop, "confirmed"),
    ]);

    const xMintKeypair = Keypair.generate();
    const yMintKeypair = Keypair.generate();

    [tokenX, tokenY] = await Promise.all([
      createMint(
        connection,
        adminKeypair,
        adminKeypair.publicKey,
        null,
        tokenXDecimal,
        xMintKeypair,
        { commitment: "confirmed" },
        TOKEN_PROGRAM_ID,
      ),
      createMint(
        connection,
        adminKeypair,
        adminKeypair.publicKey,
        null,
        tokenYDecimal,
        yMintKeypair,
        { commitment: "confirmed" },
        TOKEN_PROGRAM_ID,
      ),
    ]);

    const [userXAccount, userYAccount] = await Promise.all([
      getOrCreateAssociatedTokenAccount(
        connection,
        adminKeypair,
        tokenX,
        adminKeypair.publicKey,
        true,
        "confirmed",
        { commitment: "confirmed" },
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
      getOrCreateAssociatedTokenAccount(
        connection,
        adminKeypair,
        tokenY,
        adminKeypair.publicKey,
        true,
        "confirmed",
        { commitment: "confirmed" },
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    ]);
    userTokenX = userXAccount.address;
    userTokenY = userYAccount.address;

    await Promise.all([
      mintTo(
        connection,
        adminKeypair,
        tokenX,
        userTokenX,
        adminKeypair,
        BigInt(1_000_000_000) * BigInt(10 ** tokenXDecimal),
        [],
        { commitment: "confirmed" },
        TOKEN_PROGRAM_ID,
      ),
      mintTo(
        connection,
        adminKeypair,
        tokenY,
        userTokenY,
        adminKeypair,
        BigInt(1_000_000_000) * BigInt(10 ** tokenYDecimal),
        [],
        { commitment: "confirmed" },
        TOKEN_PROGRAM_ID,
      ),
    ]);

    operatorPda = await createWhitelistOperator(
      connection,
      adminKeypair,
      operatorKeypair.publicKey,
      [OperatorPermission.InitializePresetParameter],
      program.programId,
    );
  });

  beforeEach(async () => {
    const firstLimitOrderKeypair = Keypair.generate();
    const secondLimitOrderKeypair = Keypair.generate();
    const positionKeypair = Keypair.generate();

    // Create a new pair
    const presetParameter2 = await program.account.presetParameter2.all();
    const idx = presetParameter2.length + randomInt(10_000);

    const [presetParameter] = derivePresetParameterWithIndex(
      new BN(idx),
      program.programId,
    );

    const initPresetParamIx = await program.methods
      .initializePresetParameter({
        index: idx,
        binStep: 10,
        baseFactor: 10_000,
        concreteFunctionType: ConcreteFunctionType.LimitOrder,
        filterPeriod: 30,
        decayPeriod: 600,
        reductionFactor: 5_000,
        variableFeeControl: 40_000,
        protocolShare: 0,
        maxVolatilityAccumulator: 350_000,
        baseFeePowerFactor: 1,
        collectFeeMode: Number(CollectFeeMode.InputOnly),
      })
      .accountsPartial({
        presetParameter,
        signer: operatorKeypair.publicKey,
        systemProgram: SystemProgram.programId,
        operator: operatorPda,
        payer: operatorKeypair.publicKey,
      })
      .instruction();

    await sendTransactionAndConfirm(
      connection,
      [initPresetParamIx],
      operatorKeypair,
      [operatorKeypair],
    );

    const activeId = new BN(0);

    [pairKey] = deriveLbPairWithPresetParamWithIndexKey(
      presetParameter,
      tokenX,
      tokenY,
      program.programId,
    );

    const [reserveX] = deriveReserve(tokenX, pairKey, program.programId);
    const [reserveY] = deriveReserve(tokenY, pairKey, program.programId);
    const [oracle] = deriveOracle(pairKey, program.programId);

    const createLbPairTx = await program.methods
      .initializeLbPair2({
        activeId: activeId.toNumber(),
        padding: Array(96).fill(0),
      })
      .accountsPartial({
        funder: adminKeypair.publicKey,
        lbPair: pairKey,
        reserveX,
        reserveY,
        binArrayBitmapExtension: null,
        tokenMintX: tokenX,
        tokenMintY: tokenY,
        tokenBadgeX: program.programId,
        tokenBadgeY: program.programId,
        tokenProgramX: TOKEN_PROGRAM_ID,
        tokenProgramY: TOKEN_PROGRAM_ID,
        oracle,
        presetParameter,
        systemProgram: SystemProgram.programId,
      })
      .transaction();

    await sendAndConfirmTransaction(
      connection,
      createLbPairTx,
      [adminKeypair],
      {
        commitment: "confirmed",
      },
    );

    pair = await DLMM.create(connection, pairKey, opt);
    activeBinId = pair.lbPair.activeId;

    // Place limit order single bin
    const firstLimitOrderAmount = new BN(10).mul(new BN(10 ** tokenYDecimal));

    const placeFirstLimitOrderTx = await pair.placeLimitOrder({
      owner: adminKeypair.publicKey,
      sender: adminKeypair.publicKey,
      payer: adminKeypair.publicKey,
      limitOrder: firstLimitOrderKeypair.publicKey,
      params: {
        isAskSide: false,
        relativeBin: null,
        bins: [{ id: activeBinId, amount: firstLimitOrderAmount }],
      },
    });

    await sendAndConfirmTransaction(
      connection,
      placeFirstLimitOrderTx,
      [adminKeypair, firstLimitOrderKeypair],
      { commitment: "confirmed" },
    );

    // Partial fill single bin
    await pair.refetchStates();

    const partialFillAmount = new BN(2).mul(new BN(10 ** tokenXDecimal));
    const binArraysForFill = await pair.getBinArrayForSwap(true);

    const fillQuote = pair.swapQuote(
      partialFillAmount,
      true,
      new BN(0),
      binArraysForFill,
      true,
    );

    const partialFillTx = await pair.swap({
      inToken: pair.tokenX.mint.address,
      outToken: pair.tokenY.mint.address,
      inAmount: fillQuote.consumedInAmount,
      minOutAmount: fillQuote.minOutAmount,
      lbPair: pair.pubkey,
      user: adminKeypair.publicKey,
      binArraysPubkey: binArraysForFill.map((b) => b.publicKey),
    });

    await sendAndConfirmTransaction(connection, partialFillTx, [adminKeypair], {
      commitment: "confirmed",
    });

    // Deposit single side token to the single bin
    await pair.refetchStates();

    const singleSideDepositAmount = new BN(5).mul(new BN(10 ** tokenYDecimal));

    const initPositionTx =
      await pair.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: positionKeypair.publicKey,
        totalXAmount: new BN(0),
        totalYAmount: singleSideDepositAmount,
        strategy: {
          strategyType: StrategyType.Spot,
          minBinId: activeBinId,
          maxBinId: activeBinId,
        },
        user: adminKeypair.publicKey,
        slippage: 0,
      });

    await sendAndConfirmTransaction(
      connection,
      initPositionTx,
      [adminKeypair, positionKeypair],
      { commitment: "confirmed" },
    );

    // Place limit order single bin
    await pair.refetchStates();

    const secondLimitOrderAmount = new BN(7).mul(new BN(10 ** tokenYDecimal));

    const placeSecondLimitOrderTx = await pair.placeLimitOrder({
      owner: adminKeypair.publicKey,
      sender: adminKeypair.publicKey,
      payer: adminKeypair.publicKey,
      limitOrder: secondLimitOrderKeypair.publicKey,
      params: {
        isAskSide: false,
        relativeBin: null,
        bins: [{ id: activeBinId, amount: secondLimitOrderAmount }],
      },
    });

    await sendAndConfirmTransaction(
      connection,
      placeSecondLimitOrderTx,
      [adminKeypair, secondLimitOrderKeypair],
      { commitment: "confirmed" },
    );

    await pair.refetchStates();

    const activeBinArrayIdx = binIdToBinArrayIndex(new BN(activeBinId));
    const activeBinArray = deriveBinArray(
      pair.pubkey,
      activeBinArrayIdx,
      program.programId,
    )[0];

    const activeBinArrayState =
      await program.account.binArray.fetch(activeBinArray);

    const [lowerBinId, upperBinId] =
      getBinArrayLowerUpperBinId(activeBinArrayIdx);

    const binIdx = getBinIdIndexInBinArray(
      new BN(activeBinId),
      lowerBinId,
      upperBinId,
    );

    activeBin = activeBinArrayState.bins[binIdx.toNumber()];
  });

  it("Swap exact out MM liquidity only", async () => {
    const binArrays = await pair.getBinArrayForSwap(true);

    const quoteResult = await pair.swapQuoteExactOut(
      activeBin.amountY,
      true,
      new BN(0),
      binArrays,
    );

    const swapTransaction = await pair.swapExactOut({
      inToken: pair.lbPair.tokenXMint,
      outToken: pair.lbPair.tokenYMint,
      user: adminKeypair.publicKey,
      outAmount: quoteResult.outAmount,
      maxInAmount: quoteResult.inAmount,
      lbPair: pair.pubkey,
      binArraysPubkey: binArrays.map((b) => b.publicKey),
    });

    await sendAndExpectSwapDeltas(
      swapTransaction,
      quoteResult.inAmount,
      quoteResult.outAmount,
    );
  });

  it("Swap exact out MM + processed limit order liquidity", async () => {
    const binArrays = await pair.getBinArrayForSwap(true);

    const outAmount = activeBin.amountY.add(
      activeBin.processedOrderRemainingAmount,
    );

    const quoteResult = await pair.swapQuoteExactOut(
      outAmount,
      true,
      new BN(0),
      binArrays,
    );

    const swapTransaction = await pair.swapExactOut({
      inToken: pair.lbPair.tokenXMint,
      outToken: pair.lbPair.tokenYMint,
      user: adminKeypair.publicKey,
      outAmount: quoteResult.outAmount,
      maxInAmount: quoteResult.inAmount,
      lbPair: pair.pubkey,
      binArraysPubkey: binArrays.map((b) => b.publicKey),
    });

    await sendAndExpectSwapDeltas(
      swapTransaction,
      quoteResult.inAmount,
      quoteResult.outAmount,
    );
  });

  it("Swap exact out MM + processed + open limit order liquidity", async () => {
    const binArrays = await pair.getBinArrayForSwap(true);

    const outAmount = activeBin.amountY
      .add(activeBin.processedOrderRemainingAmount)
      .add(activeBin.openOrderAmount);

    console.log("Out amount: ", outAmount.toString());

    const quoteResult = await pair.swapQuoteExactOut(
      outAmount,
      true,
      new BN(0),
      binArrays,
    );

    const swapTransaction = await pair.swapExactOut({
      inToken: pair.lbPair.tokenXMint,
      outToken: pair.lbPair.tokenYMint,
      user: adminKeypair.publicKey,
      outAmount: quoteResult.outAmount,
      maxInAmount: quoteResult.inAmount,
      lbPair: pair.pubkey,
      binArraysPubkey: binArrays.map((b) => b.publicKey),
    });

    await sendAndExpectSwapDeltas(
      swapTransaction,
      quoteResult.inAmount,
      quoteResult.outAmount,
    );
  });
});
