/**
 * Integration tests for Limit Order methods (DLMM program v0.12.0)
 *
 * Requires a running local validator with the DLMM program deployed.
 * Run with: npm test (after starting the local validator)
 */
import { BN, web3 } from "@coral-xyz/anchor";
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
} from "@solana/web3.js";
import fs from "fs";
import {
  FunctionType,
  LBCLMM_PROGRAM_IDS,
} from "../dlmm/constants";
import IDL from "../dlmm/idl/idl.json";
import {
  deriveLbPair2,
  derivePresetParameter2,
} from "../dlmm/helpers";
import { DLMM } from "../dlmm/index";
import {
  createTestProgram,
  createWhitelistOperator,
  OperatorPermission,
} from "./helper";

const keypairBuffer = fs.readFileSync(
  "../keys/localnet/admin-bossj3JvwiNK7pvjr149DqdtJxf2gdygbcmEPTkb2F1.json",
  "utf-8"
);
const connection = new Connection("http://127.0.0.1:8899", "confirmed");
const keypair = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(keypairBuffer))
);

const btcDecimal = 8;
const usdcDecimal = 6;

const CONSTANTS = Object.entries(IDL.constants);

const DEFAULT_ACTIVE_ID = new BN(5660);
const DEFAULT_BIN_STEP = new BN(10);
const DEFAULT_BASE_FACTOR = new BN(10000);

const programId = new web3.PublicKey(LBCLMM_PROGRAM_IDS["localhost"]);

let BTC: PublicKey;
let USDC: PublicKey;
let lbClmm: DLMM;
let lbPairPubkey: PublicKey;
let userBTC: PublicKey;
let userUSDC: PublicKey;
let presetParamPda: PublicKey;

describe("Limit Order tests", () => {
  beforeAll(async () => {
    BTC = await createMint(
      connection,
      keypair,
      keypair.publicKey,
      null,
      btcDecimal,
      Keypair.generate(),
      null,
      TOKEN_PROGRAM_ID
    );

    USDC = await createMint(
      connection,
      keypair,
      keypair.publicKey,
      null,
      usdcDecimal,
      Keypair.generate(),
      null,
      TOKEN_PROGRAM_ID
    );

    const userBtcInfo = await getOrCreateAssociatedTokenAccount(
      connection,
      keypair,
      BTC,
      keypair.publicKey,
      false,
      "confirmed",
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    userBTC = userBtcInfo.address;

    const userUsdcInfo = await getOrCreateAssociatedTokenAccount(
      connection,
      keypair,
      USDC,
      keypair.publicKey,
      false,
      "confirmed",
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    userUSDC = userUsdcInfo.address;

    await mintTo(
      connection,
      keypair,
      BTC,
      userBTC,
      keypair.publicKey,
      100_000_000 * 10 ** btcDecimal,
      [],
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID
    );

    await mintTo(
      connection,
      keypair,
      USDC,
      userUSDC,
      keypair.publicKey,
      100_000_000 * 10 ** usdcDecimal,
      [],
      { commitment: "confirmed" },
      TOKEN_PROGRAM_ID
    );

    [lbPairPubkey] = deriveLbPair2(BTC, USDC, DEFAULT_BIN_STEP, DEFAULT_BASE_FACTOR, programId);
    [presetParamPda] = derivePresetParameter2(DEFAULT_BIN_STEP, DEFAULT_BASE_FACTOR, programId);

    const program = createTestProgram(connection, programId, keypair);

    const operatorPda = await createWhitelistOperator(
      connection,
      keypair,
      keypair.publicKey,
      [OperatorPermission.InitializePresetParameter],
      programId
    );

    const presetParamState =
      await program.account.presetParameter.fetchNullable(presetParamPda);

    if (!presetParamState) {
      await program.methods
        .initializePresetParameter({
          index: 0,
          binStep: DEFAULT_BIN_STEP.toNumber(),
          baseFactor: DEFAULT_BASE_FACTOR.toNumber(),
          concreteFunctionType: FunctionType.LiquidityMining,
          filterPeriod: 30,
          decayPeriod: 600,
          reductionFactor: 5000,
          variableFeeControl: 40000,
          protocolShare: 0,
          maxVolatilityAccumulator: 350000,
          baseFeePowerFactor: 0,
          collectFeeMode: 0,
        })
        .accountsPartial({
          signer: keypair.publicKey,
          presetParameter: presetParamPda,
          systemProgram: web3.SystemProgram.programId,
          operator: operatorPda,
        })
        .signers([keypair])
        .rpc({ commitment: "confirmed" });
    }

    // Initialize the LB pair if it doesn't exist
    const lbPairState = await program.account.lbPair.fetchNullable(lbPairPubkey);
    if (!lbPairState) {
      await DLMM.createPermissionlessLbPair(
        connection,
        DEFAULT_BIN_STEP,
        BTC,
        USDC,
        DEFAULT_ACTIVE_ID,
        presetParamPda,
        keypair.publicKey,
        programId,
        { cluster: "localhost" }
      ).then((tx) => sendAndConfirmTransaction(connection, tx, [keypair]));
    }

    lbClmm = await DLMM.create(connection, lbPairPubkey, {
      cluster: "localhost",
    });
  });

  describe("placeLimitOrder", () => {
    it("should return a transaction and a limitOrderKeypair", async () => {
      const activeBinId = lbClmm.lbPair.activeId;
      // Place a bid (sell USDC) one bin below active
      const bidBinId = activeBinId - 2;
      const amount = new BN(1_000_000); // 1 USDC

      const result = await lbClmm.placeLimitOrder({
        user: keypair.publicKey,
        isAskSide: false, // bid side — selling USDC
        bins: [{ id: bidBinId, amount }],
      });

      expect(result).toHaveProperty("transaction");
      expect(result).toHaveProperty("limitOrderKeypair");
      expect(result.limitOrderKeypair).toBeInstanceOf(Keypair);
      expect(result.transaction.instructions.length).toBeGreaterThan(0);
    });

    it("should create an on-chain limit order account", async () => {
      const activeBinId = lbClmm.lbPair.activeId;
      const bidBinId = activeBinId - 3;
      const amount = new BN(500_000);

      const { transaction, limitOrderKeypair } = await lbClmm.placeLimitOrder({
        user: keypair.publicKey,
        isAskSide: false,
        bins: [{ id: bidBinId, amount }],
      });

      await sendAndConfirmTransaction(connection, transaction, [
        keypair,
        limitOrderKeypair,
      ]);

      const program = createTestProgram(connection, programId, keypair);
      const limitOrderAccount = await program.account.limitOrder.fetchNullable(
        limitOrderKeypair.publicKey
      );
      expect(limitOrderAccount).not.toBeNull();
      expect(limitOrderAccount!.owner.toBase58()).toBe(
        keypair.publicKey.toBase58()
      );
    });

    it("should support relativeBin slippage protection", async () => {
      const activeBinId = lbClmm.lbPair.activeId;
      const askBinId = activeBinId + 2;
      const amount = new BN(1_000); // 0.00001 BTC

      const result = await lbClmm.placeLimitOrder({
        user: keypair.publicKey,
        isAskSide: true,
        bins: [{ id: askBinId, amount }],
        relativeBin: {
          activeId: activeBinId,
          maxActiveBinSlippage: 5,
        },
      });

      expect(result).toHaveProperty("transaction");
      expect(result.transaction.instructions.length).toBeGreaterThan(0);
    });
  });

  describe("cancelLimitOrder", () => {
    let limitOrderPubkey: PublicKey;
    let limitOrderKeypairForCancel: Keypair;

    beforeAll(async () => {
      const activeBinId = lbClmm.lbPair.activeId;
      const bidBinId = activeBinId - 4;
      const amount = new BN(200_000);

      const { transaction, limitOrderKeypair } = await lbClmm.placeLimitOrder({
        user: keypair.publicKey,
        isAskSide: false,
        bins: [{ id: bidBinId, amount }],
      });

      await sendAndConfirmTransaction(connection, transaction, [
        keypair,
        limitOrderKeypair,
      ]);

      limitOrderPubkey = limitOrderKeypair.publicKey;
      limitOrderKeypairForCancel = limitOrderKeypair;
    });

    it("should cancel a limit order bin and return a transaction", async () => {
      const activeBinId = lbClmm.lbPair.activeId;
      const bidBinId = activeBinId - 4;

      const cancelTx = await lbClmm.cancelLimitOrder({
        user: keypair.publicKey,
        limitOrder: limitOrderPubkey,
        binIds: [bidBinId],
      });

      expect(cancelTx).toBeDefined();
      expect(cancelTx.instructions.length).toBeGreaterThan(0);

      await sendAndConfirmTransaction(connection, cancelTx, [keypair]);
    });
  });

  describe("closeLimitOrderIfEmpty", () => {
    let emptyLimitOrderPubkey: PublicKey;

    beforeAll(async () => {
      // Place and then cancel a limit order so it's empty
      const activeBinId = lbClmm.lbPair.activeId;
      const bidBinId = activeBinId - 5;
      const amount = new BN(100_000);

      const { transaction, limitOrderKeypair } = await lbClmm.placeLimitOrder({
        user: keypair.publicKey,
        isAskSide: false,
        bins: [{ id: bidBinId, amount }],
      });

      await sendAndConfirmTransaction(connection, transaction, [
        keypair,
        limitOrderKeypair,
      ]);

      emptyLimitOrderPubkey = limitOrderKeypair.publicKey;

      // Cancel all bins to make it empty
      const cancelTx = await lbClmm.cancelLimitOrder({
        user: keypair.publicKey,
        limitOrder: emptyLimitOrderPubkey,
        binIds: [bidBinId],
      });
      await sendAndConfirmTransaction(connection, cancelTx, [keypair]);
    });

    it("should close an empty limit order account", async () => {
      const closeTx = await lbClmm.closeLimitOrderIfEmpty({
        user: keypair.publicKey,
        limitOrder: emptyLimitOrderPubkey,
      });

      expect(closeTx).toBeDefined();
      expect(closeTx.instructions.length).toBeGreaterThan(0);

      await sendAndConfirmTransaction(connection, closeTx, [keypair]);

      // Account should be gone
      const accountInfo = await connection.getAccountInfo(emptyLimitOrderPubkey);
      expect(accountInfo).toBeNull();
    });
  });

  describe("addLiquidityByWeight2", () => {
    it("should return a transaction for adding liquidity (Token2022 path)", async () => {
      const positionKeypair = Keypair.generate();
      const activeBinId = lbClmm.lbPair.activeId;
      const minBinId = activeBinId - 5;
      const maxBinId = activeBinId + 5;

      // Open a position first
      const openPositionTx =
        await lbClmm.initializePositionAndAddLiquidityByWeight({
          positionPubKey: positionKeypair.publicKey,
          user: keypair.publicKey,
          totalXAmount: new BN(10_000),
          totalYAmount: new BN(10_000),
          xYAmountDistribution: [
            { binId: activeBinId, xAmountBpsOfTotal: new BN(5000), yAmountBpsOfTotal: new BN(5000) },
          ],
          slippage: 1,
        });

      await sendAndConfirmTransaction(connection, openPositionTx, [
        keypair,
        positionKeypair,
      ]);

      // Now test addLiquidityByWeight2
      const addLiqTx = await lbClmm.addLiquidityByWeight2({
        positionPubKey: positionKeypair.publicKey,
        user: keypair.publicKey,
        totalXAmount: new BN(1_000),
        totalYAmount: new BN(1_000),
        xYAmountDistribution: [
          { binId: activeBinId, xAmountBpsOfTotal: new BN(5000), yAmountBpsOfTotal: new BN(5000) },
        ],
        slippage: 1,
      });

      expect(addLiqTx).toBeDefined();
      expect(addLiqTx.instructions.length).toBeGreaterThan(0);
    });
  });
});
