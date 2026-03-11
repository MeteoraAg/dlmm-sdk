import { Wallet } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  createInitializeTransferHookInstruction,
  ExtensionType,
  getAssociatedTokenAddressSync,
  getMintLen,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Cluster,
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
import Decimal from "decimal.js";
import fs from "fs";
import { DLMM } from "../dlmm";
import {
  CollectFeeMode,
  ConcreteFunctionType,
  LBCLMM_PROGRAM_IDS,
} from "../dlmm/constants";
import {
  deriveLbPairWithPresetParamWithIndexKey,
  derivePresetParameterWithIndex,
  deriveTokenBadge,
  wrapSOLInstruction,
} from "../dlmm/helpers";
import { LimitOrderStatus } from "../dlmm/types";
import { createExtraAccountMetaListAndCounter } from "./external/helper";
import {
  createTransferHookCounterProgram,
  TRANSFER_HOOK_COUNTER_PROGRAM_ID,
} from "./external/program";
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

const btcDecimal = 9;
const solDecimal = 9;

const BTCKeypair = Keypair.generate();

const BTC2022 = BTCKeypair.publicKey;
const SOL = NATIVE_MINT;

const transferFeeBps = 100; // 5%
const maxFee = BigInt(100_000) * BigInt(10 ** btcDecimal);

let pairKeyCollectFeeInput: PublicKey;
let pairKeyCollectFeeY: PublicKey;

const program = createTestProgram(
  connection,
  new PublicKey(LBCLMM_PROGRAM_IDS["localhost"]),
  adminKeypair,
);

type Opt = {
  cluster?: Cluster | "localhost";
  programId?: PublicKey;
  skipSolWrappingOperation?: boolean;
};

const opt: Opt = {
  cluster: "localhost",
  skipSolWrappingOperation: true,
};

describe.only("Limit order, collect fee mode", () => {
  // Token setup
  beforeAll(async () => {
    const [txSig0, txSig1] = await Promise.all([
      connection.requestAirdrop(adminKeypair.publicKey, 200 * LAMPORTS_PER_SOL),
      connection.requestAirdrop(
        operatorKeypair.publicKey,
        10 * LAMPORTS_PER_SOL,
      ),
    ]);

    await Promise.all([
      connection.confirmTransaction(txSig0, "confirmed"),
      connection.confirmTransaction(txSig1, "confirmed"),
    ]);

    const userWsolAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      adminKeypair,
      SOL,
      adminKeypair.publicKey,
      true,
      "confirmed",
      {
        commitment: "confirmed",
      },
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const wrapSolIx = await wrapSOLInstruction(
      adminKeypair.publicKey,
      userWsolAccount.address,
      BigInt(100) * BigInt(10 ** solDecimal),
    );

    const wrapSolTx = new Transaction({
      ...(await connection.getLatestBlockhash("confirmed")),
      feePayer: adminKeypair.publicKey,
    }).add(...wrapSolIx);

    await sendAndConfirmTransaction(connection, wrapSolTx, [adminKeypair], {
      commitment: "confirmed",
    });

    const extensions = [
      ExtensionType.TransferFeeConfig,
      ExtensionType.TransferHook,
    ];

    const mintLen = getMintLen(extensions);
    const minLamports =
      await connection.getMinimumBalanceForRentExemption(mintLen);

    const createBtcTx = new Transaction()
      .add(
        SystemProgram.createAccount({
          fromPubkey: adminKeypair.publicKey,
          newAccountPubkey: BTCKeypair.publicKey,
          space: mintLen,
          lamports: minLamports,
          programId: TOKEN_2022_PROGRAM_ID,
        }),
      )
      .add(
        createInitializeTransferFeeConfigInstruction(
          BTC2022,
          adminKeypair.publicKey,
          adminKeypair.publicKey,
          transferFeeBps,
          maxFee,
          TOKEN_2022_PROGRAM_ID,
        ),
      )
      .add(
        createInitializeTransferHookInstruction(
          BTC2022,
          adminKeypair.publicKey,
          TRANSFER_HOOK_COUNTER_PROGRAM_ID,
          TOKEN_2022_PROGRAM_ID,
        ),
      )
      .add(
        createInitializeMintInstruction(
          BTC2022,
          btcDecimal,
          adminKeypair.publicKey,
          null,
          TOKEN_2022_PROGRAM_ID,
        ),
      );

    await sendAndConfirmTransaction(
      connection,
      createBtcTx,
      [adminKeypair, BTCKeypair],
      { commitment: "confirmed" },
    );

    const transferHookCounterProgram = createTransferHookCounterProgram(
      new Wallet(adminKeypair),
      TRANSFER_HOOK_COUNTER_PROGRAM_ID,
      connection,
    );

    await createExtraAccountMetaListAndCounter(
      connection,
      adminKeypair,
      transferHookCounterProgram,
      BTC2022,
    );

    const userBtcAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      adminKeypair,
      BTC2022,
      adminKeypair.publicKey,
      true,
      "confirmed",
      {
        commitment: "confirmed",
      },
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const userBtcAta = userBtcAccount.address;

    await mintTo(
      connection,
      adminKeypair,
      BTC2022,
      userBtcAta,
      adminKeypair,
      BigInt(1_000_000_000) * BigInt(10 ** btcDecimal),
      [],
      {
        commitment: "confirmed",
      },
      TOKEN_2022_PROGRAM_ID,
    );
  });

  // DLMM related setup
  beforeAll(async () => {
    const operatorPda = await createWhitelistOperator(
      connection,
      adminKeypair,
      operatorKeypair.publicKey,
      [
        OperatorPermission.InitializePresetParameter,
        OperatorPermission.InitializeTokenBadge,
      ],
      program.programId,
    );

    const [btcTokenBadge] = deriveTokenBadge(BTC2022, program.programId);
    const btcTokenBadgeAccount = await connection.getAccountInfo(btcTokenBadge);

    if (!btcTokenBadgeAccount) {
      const initBtcTokenBadgeIx = await program.methods
        .initializeTokenBadge()
        .accountsPartial({
          tokenBadge: btcTokenBadge,
          signer: operatorKeypair.publicKey,
          systemProgram: SystemProgram.programId,
          tokenMint: BTC2022,
          operator: operatorPda,
          payer: operatorKeypair.publicKey,
        })
        .instruction();

      await sendTransactionAndConfirm(
        connection,
        [initBtcTokenBadgeIx],
        operatorKeypair,
        [operatorKeypair],
      );
    }

    for (const collectFeeMode of [
      CollectFeeMode.InputOnly,
      CollectFeeMode.OnlyY,
    ]) {
      const presetParameter2 = await program.account.presetParameter2.all();
      const idx =
        presetParameter2.length + randomInt(1000) + Number(collectFeeMode);

      const presetParameter = derivePresetParameterWithIndex(
        new BN(idx),
        program.programId,
      )[0];

      const initPresetParamIx = await program.methods
        .initializePresetParameter({
          index: idx,
          binStep: 10,
          baseFactor: 10_000,
          concreteFunctionType: ConcreteFunctionType.LimitOrder,
          filterPeriod: 30,
          decayPeriod: 600,
          reductionFactor: 5000,
          variableFeeControl: 40000,
          protocolShare: 0,
          maxVolatilityAccumulator: 350000,
          baseFeePowerFactor: 1,
          collectFeeMode: Number(collectFeeMode),
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

      const createLbPair2Tx = await DLMM.createLbPair2(
        connection,
        adminKeypair.publicKey,
        BTC2022,
        SOL,
        presetParameter,
        activeId,
        opt,
      );

      await sendAndConfirmTransaction(
        connection,
        createLbPair2Tx,
        [adminKeypair],
        {
          commitment: "confirmed",
        },
      );

      switch (collectFeeMode) {
        case CollectFeeMode.InputOnly:
          [pairKeyCollectFeeInput] = deriveLbPairWithPresetParamWithIndexKey(
            presetParameter,
            BTC2022,
            SOL,
            program.programId,
          );
          break;
        case CollectFeeMode.OnlyY:
          [pairKeyCollectFeeY] = deriveLbPairWithPresetParamWithIndexKey(
            presetParameter,
            BTC2022,
            SOL,
            program.programId,
          );
          break;
      }
    }
  });

  describe("Full flow ", () => {
    it("Happy path limit order collect fee only Y", async () => {
      const pair = await DLMM.create(connection, pairKeyCollectFeeY, opt);
      const limitOrderKeypair = Keypair.generate();

      const depositUiAmount = new BN(5);
      const rawDepositAmount = depositUiAmount.mul(new BN(10 ** solDecimal));
      const id0 = pair.lbPair.activeId - 1;
      const id1 = pair.lbPair.activeId;

      const placeLimitOrderIx = await pair.placeLimitOrder({
        owner: adminKeypair.publicKey,
        sender: adminKeypair.publicKey,
        payer: adminKeypair.publicKey,
        limitOrder: limitOrderKeypair.publicKey,
        params: {
          isAskSide: false,
          relativeBin: null,
          bins: [
            {
              id: id0,
              amount: rawDepositAmount,
            },
            {
              id: id1,
              amount: rawDepositAmount,
            },
          ],
        },
      });

      await sendAndConfirmTransaction(connection, placeLimitOrderIx, [
        adminKeypair,
        limitOrderKeypair,
      ]);

      let limitOrders = await pair.getLimitOrderByUserAndLbPair(
        adminKeypair.publicKey,
      );

      expect(limitOrders.length).toBe(1);
      await pair.refetchStates();

      let binArrays = await pair.getBinArrayForSwap(true);

      // 1. Active bin partial fill
      let quoteResult = await pair.swapQuote(
        // Active bin = 0, the price is ~= 1.00, both token has the same decimal so swapping in exact equal value of deposit amount will only partial fill it due to fee
        depositUiAmount.mul(new BN(10 ** btcDecimal)),
        true,
        new BN(0),
        binArrays,
      );

      let consumedInAmount = quoteResult.consumedInAmount;
      let outAmount = quoteResult.outAmount;
      let fee = quoteResult.fee;
      let protocolFee = quoteResult.protocolFee;
      let minOutAmount = quoteResult.minOutAmount;

      let swapIx = await pair.swap({
        inToken: pair.tokenX.mint.address,
        outToken: pair.tokenY.mint.address,
        inAmount: consumedInAmount,
        minOutAmount,
        lbPair: pair.pubkey,
        user: adminKeypair.publicKey,
        binArraysPubkey: binArrays.map((b) => b.publicKey),
      });

      await sendAndConfirmTransaction(connection, swapIx, [adminKeypair], {
        commitment: "confirmed",
      });

      let loAfterSwap = await pair.getLimitOrder(limitOrderKeypair.publicKey);

      let uiOutAmount = new Decimal(outAmount.toString()).div(
        new Decimal(10).pow(solDecimal),
      );

      let uiFeeAmount = new Decimal(fee.toString()).div(
        new Decimal(10).pow(solDecimal),
      );

      let uiProtocolFeeAmount = new Decimal(protocolFee.toString()).div(
        new Decimal(10).pow(solDecimal),
      );

      expect(uiFeeAmount.toString()).toBe(
        loAfterSwap.limitOrderData.totalFeeAmountY,
      );

      expect(
        uiOutAmount.add(uiProtocolFeeAmount).add(uiFeeAmount).toString(),
      ).toBe(loAfterSwap.limitOrderData.totalFilledAmountY);

      let loBin = loAfterSwap.limitOrderData.limitOrderBinData.find(
        (b) => b.binId == id1,
      );

      expect(loBin.status).toBe(LimitOrderStatus.PartialFilled);

      // 2. Active bin fulfilled, next bin partial fill
      await pair.refetchStates();

      binArrays = await pair.getBinArrayForSwap(true);

      quoteResult = await pair.swapQuote(
        depositUiAmount.mul(new BN(10 ** btcDecimal)),
        true,
        new BN(0),
        binArrays,
      );

      consumedInAmount = quoteResult.consumedInAmount;
      outAmount = quoteResult.outAmount;
      fee = quoteResult.fee;
      protocolFee = quoteResult.protocolFee;
      minOutAmount = quoteResult.minOutAmount;

      swapIx = await pair.swap({
        inToken: pair.tokenX.mint.address,
        outToken: pair.tokenY.mint.address,
        inAmount: consumedInAmount,
        minOutAmount,
        lbPair: pair.pubkey,
        user: adminKeypair.publicKey,
        binArraysPubkey: binArrays.map((b) => b.publicKey),
      });

      await sendAndConfirmTransaction(connection, swapIx, [adminKeypair], {
        commitment: "confirmed",
      });

      loAfterSwap = await pair.getLimitOrder(limitOrderKeypair.publicKey);

      let prevUiOutAmount = uiOutAmount;
      uiOutAmount = new Decimal(outAmount.toString()).div(
        new Decimal(10).pow(solDecimal),
      );

      let prevUiFeeAmount = uiFeeAmount;
      uiFeeAmount = new Decimal(fee.toString()).div(
        new Decimal(10).pow(solDecimal),
      );

      let prevUiProtocolFeeAmount = uiProtocolFeeAmount;
      uiProtocolFeeAmount = new Decimal(protocolFee.toString()).div(
        new Decimal(10).pow(solDecimal),
      );

      expect(uiFeeAmount.add(prevUiFeeAmount).toString()).toBe(
        loAfterSwap.limitOrderData.totalFeeAmountY,
      );

      expect(
        uiOutAmount
          .add(prevUiOutAmount)
          .add(uiProtocolFeeAmount)
          .add(prevUiProtocolFeeAmount)
          .add(uiFeeAmount)
          .add(prevUiFeeAmount)
          .toString(),
      ).toBe(loAfterSwap.limitOrderData.totalFilledAmountY);

      loBin = loAfterSwap.limitOrderData.limitOrderBinData.find(
        (b) => b.binId == id1,
      );

      expect(loBin.status).toBe(LimitOrderStatus.Fulfilled);

      loBin = loAfterSwap.limitOrderData.limitOrderBinData.find(
        (b) => b.binId == id0,
      );

      expect(loBin.status).toBe(LimitOrderStatus.PartialFilled);

      const userXAta = getAssociatedTokenAddressSync(
        pair.tokenX.mint.address,
        adminKeypair.publicKey,
        true,
        pair.tokenX.owner,
      );

      const userYAta = getAssociatedTokenAddressSync(
        pair.tokenY.mint.address,
        adminKeypair.publicKey,
        true,
        pair.tokenY.owner,
      );

      const beforeUserXBalance = await connection
        .getTokenAccountBalance(userXAta)
        .then((res) => new BN(res.value.amount));

      const beforeUserYBalance = await connection
        .getTokenAccountBalance(userYAta)
        .then((res) => new BN(res.value.amount));

      await pair.refetchStates();

      // 3. Cancel the remaining limit order
      const cancelLimitOrderIx = await pair.cancelLimitOrder({
        limitOrderPubkey: limitOrderKeypair.publicKey,
        owner: adminKeypair.publicKey,
        rentReceiver: adminKeypair.publicKey,
        binIds: [id0, id1],
      });

      await sendAndConfirmTransaction(
        connection,
        cancelLimitOrderIx,
        [adminKeypair],
        {
          commitment: "confirmed",
        },
      );

      limitOrders = await pair.getLimitOrderByUserAndLbPair(
        adminKeypair.publicKey,
      );

      expect(limitOrders.length).toBe(0);

      const afterUserXBalance = await connection
        .getTokenAccountBalance(userXAta)
        .then((res) => new BN(res.value.amount));

      const afterUserYBalance = await connection
        .getTokenAccountBalance(userYAta)
        .then((res) => new BN(res.value.amount));

      const deltaX = afterUserXBalance.sub(beforeUserXBalance);
      const deltaY = afterUserYBalance.sub(beforeUserYBalance);

      const uiDeltaX = new Decimal(deltaX.toString()).div(
        new Decimal(10).pow(btcDecimal),
      );
      const uiDeltaY = new Decimal(deltaY.toString()).div(
        new Decimal(10).pow(solDecimal),
      );

      expect(uiDeltaX.toString()).toBe(
        loAfterSwap.limitOrderData.transferFeeExcludedWithdrawableAmountX,
      );

      expect(uiDeltaY.toString()).toBe(
        loAfterSwap.limitOrderData.transferFeeExcludedWithdrawableAmountY,
      );
    });

    it("Happy path limit order collect fee only input", async () => {
      const pair = await DLMM.create(connection, pairKeyCollectFeeInput, opt);
      const limitOrderKeypair = Keypair.generate();

      const depositUiAmount = new BN(5);
      const rawDepositAmount = depositUiAmount.mul(new BN(10 ** btcDecimal));
      const id0 = pair.lbPair.activeId;
      const id1 = pair.lbPair.activeId + 1;

      const placeLimitOrderIx = await pair.placeLimitOrder({
        owner: adminKeypair.publicKey,
        sender: adminKeypair.publicKey,
        payer: adminKeypair.publicKey,
        limitOrder: limitOrderKeypair.publicKey,
        params: {
          isAskSide: true,
          relativeBin: null,
          bins: [
            {
              id: id0,
              amount: rawDepositAmount,
            },
            {
              id: id1,
              amount: rawDepositAmount,
            },
          ],
        },
      });

      await sendAndConfirmTransaction(connection, placeLimitOrderIx, [
        adminKeypair,
        limitOrderKeypair,
      ]);

      let limitOrders = await pair.getLimitOrderByUserAndLbPair(
        adminKeypair.publicKey,
      );

      expect(limitOrders.length).toBe(1);
      await pair.refetchStates();

      let binArrays = await pair.getBinArrayForSwap(false);

      // 1. Active bin partial fill
      let quoteResult = await pair.swapQuote(
        // Active bin = 0, the price is ~= 1.00, both token has the same decimal so swapping in exact equal value of deposit amount will only partial fill it due to fee
        depositUiAmount.mul(new BN(10 ** solDecimal)),
        false,
        new BN(0),
        binArrays,
      );

      let consumedInAmount = quoteResult.consumedInAmount;
      let outAmount = quoteResult.outAmount;
      let fee = quoteResult.fee;
      let protocolFee = quoteResult.protocolFee;
      let minOutAmount = quoteResult.minOutAmount;

      let swapIx = await pair.swap({
        inToken: pair.tokenY.mint.address,
        outToken: pair.tokenX.mint.address,
        inAmount: consumedInAmount,
        minOutAmount,
        lbPair: pair.pubkey,
        user: adminKeypair.publicKey,
        binArraysPubkey: binArrays.map((b) => b.publicKey),
      });

      await sendAndConfirmTransaction(connection, swapIx, [adminKeypair], {
        commitment: "confirmed",
      });

      let loAfterSwap = await pair.getLimitOrder(limitOrderKeypair.publicKey);

      let uiOutAmount = new Decimal(outAmount.toString()).div(
        new Decimal(10).pow(solDecimal),
      );

      let uiFeeAmount = new Decimal(fee.toString()).div(
        new Decimal(10).pow(solDecimal),
      );

      let uiProtocolFeeAmount = new Decimal(protocolFee.toString()).div(
        new Decimal(10).pow(solDecimal),
      );

      expect(uiFeeAmount.toString()).toBe(
        loAfterSwap.limitOrderData.totalFeeAmountY,
      );

      const totalFilledAmountX = new Decimal(
        loAfterSwap.limitOrderData.totalFilledAmountX,
      );

      // Due to transfer fee
      expect(uiOutAmount.lessThan(totalFilledAmountX)).toBeTruthy();
      // Fee at input side
      expect(uiFeeAmount.toString()).toBe(
        loAfterSwap.limitOrderData.totalFeeAmountY,
      );

      let loBin = loAfterSwap.limitOrderData.limitOrderBinData.find(
        (b) => b.binId == id0,
      );

      expect(loBin.status).toBe(LimitOrderStatus.PartialFilled);

      // 2. Active bin fulfilled, next bin partial fill
      await pair.refetchStates();

      binArrays = await pair.getBinArrayForSwap(false);

      quoteResult = await pair.swapQuote(
        depositUiAmount.mul(new BN(10 ** solDecimal)),
        false,
        new BN(0),
        binArrays,
      );

      consumedInAmount = quoteResult.consumedInAmount;
      outAmount = quoteResult.outAmount;
      fee = quoteResult.fee;
      protocolFee = quoteResult.protocolFee;
      minOutAmount = quoteResult.minOutAmount;

      swapIx = await pair.swap({
        inToken: pair.tokenY.mint.address,
        outToken: pair.tokenX.mint.address,
        inAmount: consumedInAmount,
        minOutAmount,
        lbPair: pair.pubkey,
        user: adminKeypair.publicKey,
        binArraysPubkey: binArrays.map((b) => b.publicKey),
      });

      await sendAndConfirmTransaction(connection, swapIx, [adminKeypair], {
        commitment: "confirmed",
      });

      loAfterSwap = await pair.getLimitOrder(limitOrderKeypair.publicKey);

      let prevUiOutAmount = uiOutAmount;
      uiOutAmount = new Decimal(outAmount.toString()).div(
        new Decimal(10).pow(solDecimal),
      );

      let prevUiFeeAmount = uiFeeAmount;
      uiFeeAmount = new Decimal(fee.toString()).div(
        new Decimal(10).pow(solDecimal),
      );

      let prevUiProtocolFeeAmount = uiProtocolFeeAmount;
      uiProtocolFeeAmount = new Decimal(protocolFee.toString()).div(
        new Decimal(10).pow(solDecimal),
      );

      expect(uiFeeAmount.add(prevUiFeeAmount).toString()).toBe(
        loAfterSwap.limitOrderData.totalFeeAmountY,
      );

      const totalOutAmount = uiOutAmount.add(prevUiOutAmount);

      expect(
        totalOutAmount.lt(
          new Decimal(loAfterSwap.limitOrderData.totalFilledAmountX),
        ),
      ).toBeTruthy();

      loBin = loAfterSwap.limitOrderData.limitOrderBinData.find(
        (b) => b.binId == id0,
      );

      expect(loBin.status).toBe(LimitOrderStatus.Fulfilled);

      loBin = loAfterSwap.limitOrderData.limitOrderBinData.find(
        (b) => b.binId == id1,
      );

      expect(loBin.status).toBe(LimitOrderStatus.PartialFilled);

      const userXAta = getAssociatedTokenAddressSync(
        pair.tokenX.mint.address,
        adminKeypair.publicKey,
        true,
        pair.tokenX.owner,
      );

      const userYAta = getAssociatedTokenAddressSync(
        pair.tokenY.mint.address,
        adminKeypair.publicKey,
        true,
        pair.tokenY.owner,
      );

      const beforeUserXBalance = await connection
        .getTokenAccountBalance(userXAta)
        .then((res) => new BN(res.value.amount));

      const beforeUserYBalance = await connection
        .getTokenAccountBalance(userYAta)
        .then((res) => new BN(res.value.amount));

      await pair.refetchStates();

      // 3. Cancel the remaining limit order
      const cancelLimitOrderIx = await pair.cancelLimitOrder({
        limitOrderPubkey: limitOrderKeypair.publicKey,
        owner: adminKeypair.publicKey,
        rentReceiver: adminKeypair.publicKey,
        binIds: [id0, id1],
      });

      await sendAndConfirmTransaction(
        connection,
        cancelLimitOrderIx,
        [adminKeypair],
        {
          commitment: "confirmed",
        },
      );

      limitOrders = await pair.getLimitOrderByUserAndLbPair(
        adminKeypair.publicKey,
      );

      expect(limitOrders.length).toBe(0);

      const afterUserXBalance = await connection
        .getTokenAccountBalance(userXAta)
        .then((res) => new BN(res.value.amount));

      const afterUserYBalance = await connection
        .getTokenAccountBalance(userYAta)
        .then((res) => new BN(res.value.amount));

      const deltaX = afterUserXBalance.sub(beforeUserXBalance);
      const deltaY = afterUserYBalance.sub(beforeUserYBalance);

      const uiDeltaX = new Decimal(deltaX.toString()).div(
        new Decimal(10).pow(btcDecimal),
      );
      const uiDeltaY = new Decimal(deltaY.toString()).div(
        new Decimal(10).pow(solDecimal),
      );

      expect(uiDeltaX.toString()).toBe(
        loAfterSwap.limitOrderData.transferFeeExcludedWithdrawableAmountX,
      );

      expect(uiDeltaY.toString()).toBe(
        loAfterSwap.limitOrderData.transferFeeExcludedWithdrawableAmountY,
      );
    });
  });
});
