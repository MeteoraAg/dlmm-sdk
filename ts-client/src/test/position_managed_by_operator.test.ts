import { BN, web3 } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import Decimal from "decimal.js";
import fs from "fs";
import { LBCLMM_PROGRAM_IDS, MAX_BIN_PER_POSITION } from "../dlmm/constants";
import { derivePermissionLbPair, derivePosition } from "../dlmm/helpers";
import { DLMM } from "../dlmm/index";
import { ActivationType, StrategyType } from "../dlmm/types";

const keypairBuffer = fs.readFileSync(
  "../keys/localnet/admin-bossj3JvwiNK7pvjr149DqdtJxf2gdygbcmEPTkb2F1.json",
  "utf-8"
);
const connection = new Connection("http://127.0.0.1:8899", "confirmed");
const keypair = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(keypairBuffer))
);
const programId = new PublicKey(LBCLMM_PROGRAM_IDS["localhost"]);

describe("Position by operator", () => {
  describe("Position by operator management", () => {
    const baseKeypair = Keypair.generate();
    const wenDecimal = 5;
    const usdcDecimal = 6;
    const feeBps = new BN(500);

    let WEN: web3.PublicKey;
    let USDC: web3.PublicKey;
    let operatorWEN: web3.PublicKey;
    let operatorUSDC: web3.PublicKey;
    let pairKey: web3.PublicKey;
    let pair: DLMM;
    let position: web3.PublicKey;

    const toLamportMultiplier = new Decimal(10 ** (wenDecimal - usdcDecimal));

    const minPrice = 1;
    const binStep = 100;

    const minBinId = DLMM.getBinIdFromPrice(
      new Decimal(minPrice).mul(toLamportMultiplier),
      binStep,
      false
    );

    const operatorKeypair = Keypair.generate();
    const mockMultisigKeypair = Keypair.generate();

    beforeAll(async () => {
      const signature = await connection.requestAirdrop(
        operatorKeypair.publicKey,
        10 * LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(signature, "finalized");

      WEN = await createMint(
        connection,
        keypair,
        keypair.publicKey,
        null,
        wenDecimal,
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

      const operatorWenInfo = await getOrCreateAssociatedTokenAccount(
        connection,
        keypair,
        WEN,
        operatorKeypair.publicKey,
        false,
        "confirmed",
        {
          commitment: "confirmed",
        },
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      operatorWEN = operatorWenInfo.address;

      const mockMultisigWenInfo = await getOrCreateAssociatedTokenAccount(
        connection,
        keypair,
        WEN,
        mockMultisigKeypair.publicKey,
        true,
        "confirmed",
        {
          commitment: "confirmed",
        },
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const operatorUsdcInfo = await getOrCreateAssociatedTokenAccount(
        connection,
        keypair,
        USDC,
        operatorKeypair.publicKey,
        false,
        "confirmed",
        {
          commitment: "confirmed",
        },
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      operatorUSDC = operatorUsdcInfo.address;

      await mintTo(
        connection,
        keypair,
        WEN,
        operatorWEN,
        keypair.publicKey,
        200_000_000_000 * 10 ** wenDecimal,
        [],
        {
          commitment: "confirmed",
        },
        TOKEN_PROGRAM_ID
      );

      await mintTo(
        connection,
        keypair,
        USDC,
        operatorUSDC,
        keypair.publicKey,
        1_000_000_000 * 10 ** usdcDecimal,
        [],
        {
          commitment: "confirmed",
        },
        TOKEN_PROGRAM_ID
      );

      await mintTo(
        connection,
        keypair,
        WEN,
        mockMultisigWenInfo.address,
        keypair.publicKey,
        200_000_000_000 * 10 ** wenDecimal,
        [],
        {}
      );

      let rawTx = await DLMM.createPermissionLbPair(
        connection,
        new BN(binStep),
        WEN,
        USDC,
        new BN(minBinId.toString()),
        baseKeypair.publicKey,
        keypair.publicKey,
        feeBps,
        ActivationType.Slot,
        { cluster: "localhost" }
      );
      let txHash = await sendAndConfirmTransaction(connection, rawTx, [
        keypair,
        baseKeypair,
      ]).catch((e) => {
        console.error(e);
        throw e;
      });
      console.log("Create permissioned LB pair", txHash);

      [pairKey] = derivePermissionLbPair(
        baseKeypair.publicKey,
        WEN,
        USDC,
        new BN(binStep),
        programId
      );

      pair = await DLMM.create(connection, pairKey, {
        cluster: "localhost",
      });
    });

    it("Create position with operator", async () => {
      await pair.refetchStates();

      const lowerBinId = new BN(minBinId).sub(
        MAX_BIN_PER_POSITION.div(new BN(2))
      );
      const positionWidth = new BN(MAX_BIN_PER_POSITION);

      const transaction = await pair.initializePositionByOperator({
        lowerBinId,
        positionWidth: new BN(MAX_BIN_PER_POSITION),
        owner: mockMultisigKeypair.publicKey,
        feeOwner: mockMultisigKeypair.publicKey,
        operator: operatorKeypair.publicKey,
        payer: operatorKeypair.publicKey,
        base: baseKeypair.publicKey,
        lockReleasePoint: new BN(0),
      });

      const txHash = await sendAndConfirmTransaction(connection, transaction, [
        operatorKeypair,
        baseKeypair,
      ]).catch((e) => {
        console.error(e);
        throw e;
      });

      console.log("Initialize position with operator", txHash);

      [position] = derivePosition(
        pair.pubkey,
        baseKeypair.publicKey,
        lowerBinId,
        positionWidth,
        pair.program.programId
      );

      const positionState = await pair.program.account.positionV2.fetch(
        position
      );

      expect(positionState.owner.toBase58()).toBe(
        mockMultisigKeypair.publicKey.toBase58()
      );
      expect(positionState.feeOwner.toBase58()).toBe(
        mockMultisigKeypair.publicKey.toBase58()
      );
      expect(positionState.operator.toBase58()).toBe(
        operatorKeypair.publicKey.toBase58()
      );
    });

    it("Operator add liquidity to the position", async () => {
      await pair.refetchStates();

      const positionState = await pair.program.account.positionV2.fetch(
        position
      );

      const [beforeOperatorTokenX, beforeOperatorTokenY] = await Promise.all([
        connection
          .getTokenAccountBalance(operatorWEN)
          .then((b) => new BN(b.value.amount)),
        connection
          .getTokenAccountBalance(operatorUSDC)
          .then((b) => new BN(b.value.amount)),
      ]);

      let transaction = await pair.addLiquidityByStrategy({
        positionPubKey: position,
        totalXAmount: new BN(1000 * 10 ** wenDecimal),
        totalYAmount: new BN(0),
        strategy: {
          strategyType: StrategyType.SpotImBalanced,
          maxBinId: positionState.upperBinId,
          minBinId,
        },
        user: operatorKeypair.publicKey,
        slippage: 0,
      });

      let txHash = await sendAndConfirmTransaction(connection, transaction, [
        operatorKeypair,
      ]).catch((e) => {
        console.error(e);
        throw e;
      });

      transaction = await pair.addLiquidityByStrategy({
        positionPubKey: position,
        totalXAmount: new BN(0),
        totalYAmount: new BN(1000 * 10 ** usdcDecimal),
        strategy: {
          strategyType: StrategyType.SpotImBalanced,
          maxBinId: minBinId - 1,
          minBinId: positionState.lowerBinId,
        },
        user: operatorKeypair.publicKey,
        slippage: 0,
      });

      txHash = await sendAndConfirmTransaction(connection, transaction, [
        operatorKeypair,
      ]).catch((e) => {
        console.error(e);
        throw e;
      });

      const [afterOperatorTokenX, afterOperatorTokenY] = await Promise.all([
        connection
          .getTokenAccountBalance(operatorWEN)
          .then((b) => new BN(b.value.amount)),
        connection
          .getTokenAccountBalance(operatorUSDC)
          .then((b) => new BN(b.value.amount)),
      ]);

      // Debit from operator
      expect(afterOperatorTokenY.lt(beforeOperatorTokenY)).toBeTruthy();
      expect(afterOperatorTokenX.lt(beforeOperatorTokenX)).toBeTruthy();

      console.log("Operator add liquidity to the position", txHash);
    });

    it("Operator remove liquidity from the position, owner (multisig) receive the liquidity", async () => {
      await pair.refetchStates();

      const positionState = await pair.program.account.positionV2.fetch(
        position
      );

      const mockMultisigWEN = getAssociatedTokenAddressSync(
        WEN,
        positionState.owner,
        true,
        TOKEN_PROGRAM_ID
      );
      const mockMultisigUSDC = getAssociatedTokenAddressSync(
        USDC,
        positionState.owner,
        true,
        TOKEN_PROGRAM_ID
      );

      const [beforeOwnerWEN, beforeOwnerUSDC] = await Promise.all([
        connection
          .getTokenAccountBalance(mockMultisigWEN)
          .then((b) => new BN(b.value.amount))
          .catch((_) => new BN(0)),
        connection
          .getTokenAccountBalance(mockMultisigUSDC)
          .then((b) => new BN(b.value.amount))
          .catch((_) => new BN(0)),
      ]);

      const binIds = [];

      for (
        let i = positionState.lowerBinId;
        i <= positionState.upperBinId;
        i++
      ) {
        binIds.push(i);
      }

      const transaction = await pair.removeLiquidity({
        user: operatorKeypair.publicKey,
        position,
        binIds,
        bps: new BN(10000),
        shouldClaimAndClose: true,
      });

      const transactions = [];
      if (!Array.isArray(transaction)) {
        transactions.push(transaction);
      } else {
        transactions.push(...transaction);
      }

      for (const tx of transactions) {
        const txHash = await sendAndConfirmTransaction(connection, tx, [
          operatorKeypair,
        ]).catch((e) => {
          console.error(e);
          throw e;
        });

        console.log(
          "Withdraw to owner, claim fees, and close transaction",
          txHash
        );
      }

      const [afterOwnerWEN, afterOwnerUSDC] = await Promise.all([
        connection
          .getTokenAccountBalance(mockMultisigWEN)
          .then((b) => new BN(b.value.amount)),
        connection
          .getTokenAccountBalance(mockMultisigUSDC)
          .then((b) => new BN(b.value.amount)),
      ]);

      // Credit to owner
      expect(afterOwnerWEN.gt(beforeOwnerUSDC)).toBeTruthy();
      expect(afterOwnerUSDC.gt(beforeOwnerUSDC)).toBeTruthy();
    });
  });
});
