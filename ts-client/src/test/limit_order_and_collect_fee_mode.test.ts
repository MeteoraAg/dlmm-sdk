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

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

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

const transferFeeBps = 100;
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

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/** Convert raw BN amount to UI-scale Decimal. */
function toUi(amount: BN, decimals: number): Decimal {
  return new Decimal(amount.toString()).div(new Decimal(10).pow(decimals));
}

/** Get the raw token balance for an ATA. */
async function getBalance(ata: PublicKey): Promise<BN> {
  const res = await connection.getTokenAccountBalance(ata);
  return new BN(res.value.amount);
}

/** UI-scaled results from a single swap. */
interface SwapResult {
  outAmount: Decimal;
  fee: Decimal;
  protocolFee: Decimal;
}

/** Execute a swap: refetch state, quote, swap, return UI-scaled results. */
async function executeSwap(
  pair: DLMM,
  swapForY: boolean,
  rawSwapAmount: BN,
  inToken: PublicKey,
  outToken: PublicKey,
  user: Keypair,
  uiDecimals: number,
): Promise<SwapResult> {
  await pair.refetchStates();
  const binArrays = await pair.getBinArrayForSwap(swapForY);

  const quote = await pair.swapQuote(
    rawSwapAmount,
    swapForY,
    new BN(0),
    binArrays,
  );

  const swapTx = await pair.swap({
    inToken,
    outToken,
    inAmount: quote.consumedInAmount,
    minOutAmount: quote.minOutAmount,
    lbPair: pair.pubkey,
    user: user.publicKey,
    binArraysPubkey: binArrays.map((b) => b.publicKey),
  });

  await sendAndConfirmTransaction(connection, swapTx, [user], {
    commitment: "confirmed",
  });

  return {
    outAmount: toUi(quote.outAmount, uiDecimals),
    fee: toUi(quote.fee, uiDecimals),
    protocolFee: toUi(quote.protocolFee, uiDecimals),
  };
}

/** Sum two SwapResults into cumulative totals. */
function accumulate(a: SwapResult, b: SwapResult): SwapResult {
  return {
    outAmount: a.outAmount.add(b.outAmount),
    fee: a.fee.add(b.fee),
    protocolFee: a.protocolFee.add(b.protocolFee),
  };
}

/** Get user ATAs for a pair's X and Y tokens. */
function getUserAtas(pair: DLMM, user: PublicKey) {
  const userXAta = getAssociatedTokenAddressSync(
    pair.tokenX.mint.address,
    user,
    true,
    pair.tokenX.owner,
  );
  const userYAta = getAssociatedTokenAddressSync(
    pair.tokenY.mint.address,
    user,
    true,
    pair.tokenY.owner,
  );
  return { userXAta, userYAta };
}

/** Assert that a bin in limit order data has the expected status. */
function assertBinStatus(
  limitOrderData: any,
  binId: number,
  expectedStatus: LimitOrderStatus,
) {
  const bin = limitOrderData.limitOrderBinData.find(
    (b: any) => b.binId == binId,
  );
  expect(bin.status).toBe(expectedStatus);
}

/** Assert withdrawn token deltas match the limit order's withdrawable amounts. */
async function assertWithdrawableAmounts(
  pair: DLMM,
  user: PublicKey,
  beforeX: BN,
  beforeY: BN,
  limitOrderData: any,
) {
  const { userXAta, userYAta } = getUserAtas(pair, user);

  const afterX = await getBalance(userXAta);
  const afterY = await getBalance(userYAta);

  const uiDeltaX = toUi(afterX.sub(beforeX), btcDecimal);
  const uiDeltaY = toUi(afterY.sub(beforeY), solDecimal);

  expect(uiDeltaX.toString()).toBe(
    limitOrderData.transferFeeExcludedWithdrawableAmountX,
  );
  expect(uiDeltaY.toString()).toBe(
    limitOrderData.transferFeeExcludedWithdrawableAmountY,
  );
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Limit order, collect fee mode", () => {
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
      { commitment: "confirmed" },
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
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    await mintTo(
      connection,
      adminKeypair,
      BTC2022,
      userBtcAccount.address,
      adminKeypair,
      BigInt(1_000_000_000) * BigInt(10 ** btcDecimal),
      [],
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID,
    );
  });

  // DLMM setup
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
        { commitment: "confirmed" },
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

  // -------------------------------------------------------------------------
  // Tests
  // -------------------------------------------------------------------------

  describe("Full flow", () => {
    it("Happy path limit order collect fee only Y", async () => {
      const pair = await DLMM.create(connection, pairKeyCollectFeeY, opt);
      const limitOrderKeypair = Keypair.generate();

      const depositUiAmount = new BN(5);
      const rawDeposit = depositUiAmount.mul(new BN(10 ** solDecimal));
      const id0 = pair.lbPair.activeId - 1;
      const id1 = pair.lbPair.activeId;

      // 1. Place limit order (bid side)
      const placeTx = await pair.placeLimitOrder({
        owner: adminKeypair.publicKey,
        sender: adminKeypair.publicKey,
        payer: adminKeypair.publicKey,
        limitOrder: limitOrderKeypair.publicKey,
        params: {
          isAskSide: false,
          relativeBin: null,
          bins: [
            { id: id0, amount: rawDeposit },
            { id: id1, amount: rawDeposit },
          ],
        },
      });

      await sendAndConfirmTransaction(connection, placeTx, [
        adminKeypair,
        limitOrderKeypair,
      ]);

      let limitOrders = await pair.getLimitOrderByUserAndLbPair(
        adminKeypair.publicKey,
      );
      expect(limitOrders.length).toBe(1);

      // 2. First swap: active bin partial fill (X -> Y)
      const swap1 = await executeSwap(
        pair,
        true,
        depositUiAmount.mul(new BN(10 ** btcDecimal)),
        pair.tokenX.mint.address,
        pair.tokenY.mint.address,
        adminKeypair,
        solDecimal,
      );

      let loData = (await pair.getLimitOrder(limitOrderKeypair.publicKey))
        .limitOrderData;

      expect(swap1.fee.toString()).toBe(loData.totalFeeAmountY);
      expect(
        swap1.outAmount.add(swap1.protocolFee).add(swap1.fee).toString(),
      ).toBe(loData.totalFilledAmountY);
      assertBinStatus(loData, id1, LimitOrderStatus.PartialFilled);

      // 3. Second swap: active bin fulfilled, next bin partial fill
      const swap2 = await executeSwap(
        pair,
        true,
        depositUiAmount.mul(new BN(10 ** btcDecimal)),
        pair.tokenX.mint.address,
        pair.tokenY.mint.address,
        adminKeypair,
        solDecimal,
      );

      loData = (await pair.getLimitOrder(limitOrderKeypair.publicKey))
        .limitOrderData;

      const cumulative = accumulate(swap1, swap2);

      expect(cumulative.fee.toString()).toBe(loData.totalFeeAmountY);
      expect(
        cumulative.outAmount
          .add(cumulative.protocolFee)
          .add(cumulative.fee)
          .toString(),
      ).toBe(loData.totalFilledAmountY);
      assertBinStatus(loData, id1, LimitOrderStatus.Fulfilled);
      assertBinStatus(loData, id0, LimitOrderStatus.PartialFilled);

      // 4. Cancel and verify withdrawal
      const { userXAta, userYAta } = getUserAtas(pair, adminKeypair.publicKey);
      const beforeX = await getBalance(userXAta);
      const beforeY = await getBalance(userYAta);

      await pair.refetchStates();

      const cancelTx = await pair.cancelLimitOrder({
        limitOrderPubkey: limitOrderKeypair.publicKey,
        owner: adminKeypair.publicKey,
        rentReceiver: adminKeypair.publicKey,
        binIds: [id0, id1],
      });

      await sendAndConfirmTransaction(connection, cancelTx, [adminKeypair], {
        commitment: "confirmed",
      });

      limitOrders = await pair.getLimitOrderByUserAndLbPair(
        adminKeypair.publicKey,
      );
      expect(limitOrders.length).toBe(0);

      await assertWithdrawableAmounts(
        pair,
        adminKeypair.publicKey,
        beforeX,
        beforeY,
        loData,
      );
    });

    it("Happy path limit order collect fee only input", async () => {
      const pair = await DLMM.create(connection, pairKeyCollectFeeInput, opt);
      const limitOrderKeypair = Keypair.generate();

      const depositUiAmount = new BN(5);
      const rawDeposit = depositUiAmount.mul(new BN(10 ** btcDecimal));
      const id0 = pair.lbPair.activeId;
      const id1 = pair.lbPair.activeId + 1;

      // 1. Place limit order (ask side)
      const placeTx = await pair.placeLimitOrder({
        owner: adminKeypair.publicKey,
        sender: adminKeypair.publicKey,
        payer: adminKeypair.publicKey,
        limitOrder: limitOrderKeypair.publicKey,
        params: {
          isAskSide: true,
          relativeBin: null,
          bins: [
            { id: id0, amount: rawDeposit },
            { id: id1, amount: rawDeposit },
          ],
        },
      });

      await sendAndConfirmTransaction(connection, placeTx, [
        adminKeypair,
        limitOrderKeypair,
      ]);

      let limitOrders = await pair.getLimitOrderByUserAndLbPair(
        adminKeypair.publicKey,
      );
      expect(limitOrders.length).toBe(1);

      // 2. First swap: active bin partial fill (Y -> X)
      const swap1 = await executeSwap(
        pair,
        false,
        depositUiAmount.mul(new BN(10 ** solDecimal)),
        pair.tokenY.mint.address,
        pair.tokenX.mint.address,
        adminKeypair,
        solDecimal,
      );

      let loData = (await pair.getLimitOrder(limitOrderKeypair.publicKey))
        .limitOrderData;

      // Fee tracked in Y (input side)
      expect(swap1.fee.toString()).toBe(loData.totalFeeAmountY);
      // outAmount < totalFilledAmountX due to transfer fee on token2022 X
      expect(
        swap1.outAmount.lessThan(new Decimal(loData.totalFilledAmountX)),
      ).toBeTruthy();
      assertBinStatus(loData, id0, LimitOrderStatus.PartialFilled);

      // 3. Second swap: active bin fulfilled, next bin partial fill
      const swap2 = await executeSwap(
        pair,
        false,
        depositUiAmount.mul(new BN(10 ** solDecimal)),
        pair.tokenY.mint.address,
        pair.tokenX.mint.address,
        adminKeypair,
        solDecimal,
      );

      loData = (await pair.getLimitOrder(limitOrderKeypair.publicKey))
        .limitOrderData;

      const cumulative = accumulate(swap1, swap2);

      // Fee tracked in Y
      expect(cumulative.fee.toString()).toBe(loData.totalFeeAmountY);
      // Cumulative out < totalFilledAmountX due to transfer fee
      expect(
        cumulative.outAmount.lt(new Decimal(loData.totalFilledAmountX)),
      ).toBeTruthy();
      assertBinStatus(loData, id0, LimitOrderStatus.Fulfilled);
      assertBinStatus(loData, id1, LimitOrderStatus.PartialFilled);

      // 4. Cancel and verify withdrawal
      const { userXAta, userYAta } = getUserAtas(pair, adminKeypair.publicKey);
      const beforeX = await getBalance(userXAta);
      const beforeY = await getBalance(userYAta);

      await pair.refetchStates();

      const cancelTx = await pair.cancelLimitOrder({
        limitOrderPubkey: limitOrderKeypair.publicKey,
        owner: adminKeypair.publicKey,
        rentReceiver: adminKeypair.publicKey,
        binIds: [id0, id1],
      });

      await sendAndConfirmTransaction(connection, cancelTx, [adminKeypair], {
        commitment: "confirmed",
      });

      limitOrders = await pair.getLimitOrderByUserAndLbPair(
        adminKeypair.publicKey,
      );
      expect(limitOrders.length).toBe(0);

      await assertWithdrawableAmounts(
        pair,
        adminKeypair.publicKey,
        beforeX,
        beforeY,
        loData,
      );
    });
  });
});
