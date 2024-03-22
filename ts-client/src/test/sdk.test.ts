import { AnchorProvider, BN, Program, Wallet, web3 } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import fs from "fs";
import { DLMM } from "../dlmm/index";
import { deriveLbPair, derivePresetParameter } from "../dlmm/helpers";
import { BASIS_POINT_MAX, LBCLMM_PROGRAM_IDS } from "../dlmm/constants";
import { IDL } from "../dlmm/idl";

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
const BIN_ARRAY_BITMAP_SIZE = new BN(
  CONSTANTS.find(([k, v]) => v.name == "BIN_ARRAY_BITMAP_SIZE")[1].value
);
export const MAX_BIN_PER_ARRAY = new BN(
  CONSTANTS.find(([k, v]) => v.name == "MAX_BIN_PER_ARRAY")[1].value
);

const ACTIVE_ID_OUT_OF_RANGE = BIN_ARRAY_BITMAP_SIZE.mul(MAX_BIN_PER_ARRAY);
const DEFAULT_ACTIVE_ID = new BN(5660);
const DEFAULT_BIN_STEP = new BN(10);

const programId = new web3.PublicKey(LBCLMM_PROGRAM_IDS["localhost"]);

let BTC: web3.PublicKey;
let USDC: web3.PublicKey;
let lbClmm: DLMM;
let lbClmmWithBitMapExt: DLMM;
let lbPairPubkey: web3.PublicKey;
let lbPairWithBitMapExtPubkey: web3.PublicKey;
let userBTC: web3.PublicKey;
let userUSDC: web3.PublicKey;
let presetParamPda: web3.PublicKey;

const positionKeypair = Keypair.generate();

function assertAmountWithPrecision(
  actualAmount: number,
  expectedAmount: number,
  precisionPercent: number
) {
  if (expectedAmount == 0 && actualAmount == 0) {
    return;
  }
  let maxAmount, minAmount;
  if (expectedAmount > actualAmount) {
    maxAmount = expectedAmount;
    minAmount = actualAmount;
  } else {
    maxAmount = actualAmount;
    minAmount = expectedAmount;
  }
  let diff = ((maxAmount - minAmount) * 100) / maxAmount;
  expect(diff).toBeLessThan(precisionPercent);
}

describe("SDK test", () => {
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
      {
        commitment: "confirmed",
      },
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
      {
        commitment: "confirmed",
      },
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
      1000 * 10 ** btcDecimal,
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
      userUSDC,
      keypair.publicKey,
      1_000_000 * 10 ** usdcDecimal,
      [],
      {
        commitment: "confirmed",
      },
      TOKEN_PROGRAM_ID
    );

    [lbPairPubkey] = deriveLbPair(BTC, USDC, DEFAULT_BIN_STEP, programId);
    [lbPairWithBitMapExtPubkey] = deriveLbPair(
      NATIVE_MINT,
      USDC,
      DEFAULT_BIN_STEP,
      programId
    );
    [presetParamPda] = derivePresetParameter(DEFAULT_BIN_STEP, programId);

    const provider = new AnchorProvider(
      connection,
      new Wallet(keypair),
      AnchorProvider.defaultOptions()
    );
    const program = new Program(IDL, LBCLMM_PROGRAM_IDS["localhost"], provider);

    const presetParamState =
      await program.account.presetParameter.fetchNullable(presetParamPda);

    if (!presetParamState) {
      await program.methods
        .initializePresetParameter({
          binStep: DEFAULT_BIN_STEP.toNumber(),
          baseFactor: 10000,
          filterPeriod: 30,
          decayPeriod: 600,
          reductionFactor: 5000,
          variableFeeControl: 40000,
          protocolShare: 0,
          maxBinId: 43690,
          minBinId: -43690,
          maxVolatilityAccumulator: 350000,
        })
        .accounts({
          admin: keypair.publicKey,
          presetParameter: presetParamPda,
          rent: web3.SYSVAR_RENT_PUBKEY,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([keypair])
        .rpc({
          commitment: "confirmed",
        });
    }
  });

  it("create LB pair", async () => {
    try {
      const rawTx = await DLMM.createLbPair(
        connection,
        keypair.publicKey,
        BTC,
        USDC,
        presetParamPda,
        DEFAULT_ACTIVE_ID,
        { cluster: "localhost" }
      );
      const txHash = await sendAndConfirmTransaction(connection, rawTx, [
        keypair,
      ]);
      expect(txHash).not.toBeNull();
      console.log("Create LB pair", txHash);
    } catch (error) {
      console.log(JSON.parse(JSON.stringify(error)));
    }
  });

  it("fetch all preset parameter", async () => {
    const presetParams = await DLMM.getAllPresetParameters(connection, {
      cluster: "localhost",
    });
    expect(presetParams.length).toBeGreaterThan(0);
  });

  it("create LB pair with bitmap extension", async () => {
    const rawTx = await DLMM.createLbPair(
      connection,
      keypair.publicKey,
      NATIVE_MINT,
      USDC,
      presetParamPda,
      ACTIVE_ID_OUT_OF_RANGE,
      { cluster: "localhost" }
    );
    const txHash = await sendAndConfirmTransaction(connection, rawTx, [
      keypair,
    ]);
    expect(txHash).not.toBeNull();
    console.log("Create LB pair with bitmap extension", txHash);
  });

  it("create LBCLMM instance", async () => {
    [lbClmm] = await DLMM.createMultiple(connection, [lbPairPubkey], {
      cluster: "localhost",
    });
    expect(lbClmm).not.toBeNull();
    expect(lbClmm).toBeInstanceOf(DLMM);
    expect(lbClmm.tokenX.publicKey.toBase58()).toBe(BTC.toBase58());
    expect(lbClmm.tokenY.publicKey.toBase58()).toBe(USDC.toBase58());

    lbClmm = await DLMM.create(connection, lbPairPubkey, {
      cluster: "localhost",
    });
    expect(lbClmm).not.toBeNull();
    expect(lbClmm).toBeInstanceOf(DLMM);
    expect(lbClmm.tokenX.publicKey.toBase58()).toBe(BTC.toBase58());
    expect(lbClmm.tokenY.publicKey.toBase58()).toBe(USDC.toBase58());
  });

  it("create LBCLMM instance with bitmap extension", async () => {
    [lbClmmWithBitMapExt] = await DLMM.createMultiple(
      connection,
      [lbPairWithBitMapExtPubkey],
      { cluster: "localhost" }
    );
    expect(lbClmmWithBitMapExt).not.toBeNull();
    expect(lbClmmWithBitMapExt).toBeInstanceOf(DLMM);
    expect(lbClmmWithBitMapExt.tokenX.publicKey.toBase58()).toBe(
      NATIVE_MINT.toBase58()
    );
    expect(lbClmmWithBitMapExt.tokenY.publicKey.toBase58()).toBe(
      USDC.toBase58()
    );

    lbClmmWithBitMapExt = await DLMM.create(
      connection,
      lbPairWithBitMapExtPubkey,
      { cluster: "localhost" }
    );
    expect(lbClmmWithBitMapExt).not.toBeNull();
    expect(lbClmmWithBitMapExt).toBeInstanceOf(DLMM);
    expect(lbClmmWithBitMapExt.tokenX.publicKey.toBase58()).toBe(
      NATIVE_MINT.toBase58()
    );
    expect(lbClmmWithBitMapExt.tokenY.publicKey.toBase58()).toBe(
      USDC.toBase58()
    );
  });

  it("fetch created lb pair", async () => {
    expect(lbClmm.lbPair).not.toBeNull();
    expect(lbClmm.lbPair.tokenXMint.toBase58()).toBe(BTC.toBase58());
    expect(lbClmm.lbPair.tokenYMint.toBase58()).toBe(USDC.toBase58());
    expect(lbClmm.lbPair.activeId).toBe(DEFAULT_ACTIVE_ID.toNumber());
    expect(lbClmm.lbPair.binStep).toBe(DEFAULT_BIN_STEP.toNumber());
  });

  it("fetch all lb pair", async () => {
    const lbPairs = await DLMM.getLbPairs(connection, { cluster: "localhost" });
    expect(lbPairs.length).toBeGreaterThan(0);
    expect(
      lbPairs.find((lps) => lps.publicKey.toBase58() == lbPairPubkey.toBase58())
    ).not.toBeUndefined();
  });

  it("initialize position and add liquidity to non exists bin arrays", async () => {
    const btcInAmount = new BN(1).mul(new BN(10 ** btcDecimal));
    const usdcInAmount = new BN(24000).mul(new BN(10 ** usdcDecimal));

    const xYAmountDistribution = [
      {
        binId: DEFAULT_ACTIVE_ID.sub(new BN(1)).toNumber(),
        xAmountBpsOfTotal: new BN(0),
        yAmountBpsOfTotal: new BN(7500),
      },
      {
        binId: DEFAULT_ACTIVE_ID.toNumber(),
        xAmountBpsOfTotal: new BN(2500),
        yAmountBpsOfTotal: new BN(2500),
      },
      {
        binId: DEFAULT_ACTIVE_ID.add(new BN(1)).toNumber(),
        xAmountBpsOfTotal: new BN(7500),
        yAmountBpsOfTotal: new BN(0),
      },
    ];

    const rawTxs = await lbClmm.initializePositionAndAddLiquidityByWeight({
      user: keypair.publicKey,
      positionPubKey: positionKeypair.publicKey,
      totalXAmount: btcInAmount,
      totalYAmount: usdcInAmount,
      xYAmountDistribution,
    });

    if (Array.isArray(rawTxs)) {
      for (const rawTx of rawTxs) {
        // Do not alter the order of the signers. Some weird bug from solana where it keep throwing error about positionKeypair has no balance.
        const txHash = await sendAndConfirmTransaction(connection, rawTx, [
          keypair,
          positionKeypair,
        ]).catch(console.error);
        expect(txHash).not.toBeNull();
        console.log("Create bin arrays, position, and add liquidity", txHash);
      }
    } else {
      const txHash = await sendAndConfirmTransaction(connection, rawTxs, [
        keypair,
        positionKeypair,
      ]).catch(console.error);
      expect(txHash).not.toBeNull();
      console.log("Create bin arrays, position, and add liquidity", txHash);
    }

    const positionState = await lbClmm.program.account.positionV2.fetch(
      positionKeypair.publicKey
    );

    const lbPairPositionsMap = await DLMM.getAllLbPairPositionsByUser(
      connection,
      keypair.publicKey,
      {
        cluster: "localhost",
      }
    );
    const positions = lbPairPositionsMap.get(lbPairPubkey.toBase58());
    const position = positions.lbPairPositionsData.find(({ publicKey }) =>
      publicKey.equals(positionKeypair.publicKey)
    );
    const { positionData } = position;

    expect(+positionData.totalXAmount).toBeLessThan(btcInAmount.toNumber());
    assertAmountWithPrecision(
      +positionData.totalXAmount,
      btcInAmount.toNumber(),
      5
    );
    expect(+positionData.totalYAmount).toBeLessThan(usdcInAmount.toNumber());
    assertAmountWithPrecision(
      +positionData.totalYAmount,
      usdcInAmount.toNumber(),
      5
    );

    expect(positionData.positionBinData.length).toBe(
      positionState.upperBinId - positionState.lowerBinId + 1
    );

    const positionBinWithLiquidity = positionData.positionBinData.filter(
      (p) => p.positionLiquidity != "0"
    );
    expect(positionBinWithLiquidity.length).toBe(xYAmountDistribution.length);

    for (const [idx, binData] of positionBinWithLiquidity.entries()) {
      const xYDist = xYAmountDistribution[idx];
      expect(binData.binId).toBe(xYDist.binId);
      assertAmountWithPrecision(
        +binData.binXAmount,
        xYDist.xAmountBpsOfTotal
          .mul(btcInAmount)
          .div(new BN(BASIS_POINT_MAX))
          .toNumber(),
        15
      );
      assertAmountWithPrecision(
        +binData.binYAmount,
        xYDist.yAmountBpsOfTotal
          .mul(usdcInAmount)
          .div(new BN(BASIS_POINT_MAX))
          .toNumber(),
        15
      );
    }
  });

  it("get user positions in pool", async () => {
    const positions = await lbClmm.getPositionsByUserAndLbPair(
      keypair.publicKey
    );
    expect(positions.userPositions.length).toBeGreaterThan(0);
    expect(
      positions.userPositions.find(
        (ps) => ps.publicKey.toBase58() == positionKeypair.publicKey.toBase58()
      )
    ).not.toBeUndefined();
  });

  it("fetch all bin arrays of the lb pair", async () => {
    const binArrays = await lbClmm.getBinArrays();
    for (const binArray of binArrays) {
      expect(binArray.account.lbPair.toBase58()).toBe(lbPairPubkey.toBase58());
    }

    const { userPositions } = await lbClmm.getPositionsByUserAndLbPair(
      keypair.publicKey
    );
    expect(userPositions.length).toBeGreaterThan(0);

    userPositions.forEach((position) => {
      expect(position.positionData.positionBinData.length).toBeGreaterThan(0);
    });
  });

  describe("Swap within active bin", () => {
    let btcInAmount: BN;
    let usdcInAmount: BN;
    let quotedOutAmount: BN;
    let actualOutAmount: BN;
    let binArraysPubkeyForSwap: PublicKey[];

    beforeAll(async () => {
      await lbClmm.refetchStates();
    });

    it("quote X -> Y", async () => {
      const bins = await lbClmm.getBinsBetweenLowerAndUpperBound(
        lbClmm.lbPair.activeId,
        lbClmm.lbPair.activeId
      );

      const activeBin = bins.bins.pop();

      const btcAmountToSwapHalfUsdcOfActiveBin = new BN(
        activeBin.yAmount.div(new BN(2)).toNumber() /
          Number.parseFloat(activeBin.price)
      );

      btcInAmount = btcAmountToSwapHalfUsdcOfActiveBin;

      const binArrays = await lbClmm.getBinArrays();
      const { fee, outAmount, priceImpact, protocolFee, binArraysPubkey } =
        lbClmm.swapQuote(btcInAmount, true, new BN(0), binArrays);
      expect(outAmount.toString()).not.toEqual("0");
      expect(fee.toString()).not.toEqual("0");
      // Swap within active bin has no price impact
      expect(priceImpact.isZero()).toBeTruthy();
      expect(protocolFee.toString()).toEqual("0");
      expect(binArraysPubkey.length).toBeGreaterThan(0);

      binArraysPubkeyForSwap = binArraysPubkey;
      quotedOutAmount = outAmount;
    });

    it("swap X -> Y", async () => {
      const [beforeBtc, beforeUsdc] = await Promise.all([
        connection
          .getTokenAccountBalance(userBTC)
          .then((ta) => new BN(ta.value.amount)),
        connection
          .getTokenAccountBalance(userUSDC)
          .then((ta) => new BN(ta.value.amount)),
      ]);

      const rawTx = await lbClmm.swap({
        inAmount: btcInAmount,
        outToken: USDC,
        minOutAmount: new BN(0),
        user: keypair.publicKey,
        inToken: BTC,
        lbPair: lbPairPubkey,
        binArraysPubkey: binArraysPubkeyForSwap,
      });
      const txHash = await sendAndConfirmTransaction(connection, rawTx, [
        keypair,
      ]);
      expect(txHash).not.toBeNull();
      console.log("Swap X -> Y", txHash);

      const [afterBtc, afterUsdc] = await Promise.all([
        connection
          .getTokenAccountBalance(userBTC)
          .then((ta) => new BN(ta.value.amount)),
        connection
          .getTokenAccountBalance(userUSDC)
          .then((ta) => new BN(ta.value.amount)),
      ]);

      expect(afterBtc.lt(beforeBtc)).toBeTruthy();
      expect(afterUsdc.gt(beforeUsdc)).toBeTruthy();

      actualOutAmount = afterUsdc.sub(beforeUsdc);
    });

    it("quote matches actual swap result (X -> Y)", () => {
      expect(actualOutAmount.toString()).toBe(quotedOutAmount.toString());
    });

    it("quote Y -> X", async () => {
      const bins = await lbClmm.getBinsBetweenLowerAndUpperBound(
        lbClmm.lbPair.activeId,
        lbClmm.lbPair.activeId
      );

      const activeBin = bins.bins.pop();

      const usdcAmountToSwapHalfBtcOfActiveBin = new BN(
        activeBin.xAmount.div(new BN(2)).toNumber() *
          Number.parseFloat(activeBin.price)
      );

      usdcInAmount = usdcAmountToSwapHalfBtcOfActiveBin;
      const binArrays = await lbClmm.getBinArrays();
      const { fee, outAmount, priceImpact, protocolFee, binArraysPubkey } =
        lbClmm.swapQuote(usdcInAmount, false, new BN(0), binArrays);
      expect(outAmount.toString()).not.toEqual("0");
      expect(fee.toString()).not.toEqual("0");
      // Swap within active bin has no price impact
      expect(priceImpact.isZero()).toBeTruthy();
      // TODO: Now we disable protocol we. Re-enable it back later.
      expect(protocolFee.toString()).toEqual("0");
      expect(binArraysPubkey.length).toBeGreaterThan(0);

      binArraysPubkeyForSwap = binArraysPubkey;
      quotedOutAmount = outAmount;
    });

    it("swap Y -> X", async () => {
      const [beforeBtc, beforeUsdc] = await Promise.all([
        connection
          .getTokenAccountBalance(userBTC)
          .then((ta) => new BN(ta.value.amount)),
        connection
          .getTokenAccountBalance(userUSDC)
          .then((ta) => new BN(ta.value.amount)),
      ]);

      const rawTx = await lbClmm.swap({
        inAmount: usdcInAmount,
        outToken: BTC,
        minOutAmount: new BN(0),
        user: keypair.publicKey,
        inToken: USDC,
        lbPair: lbPairPubkey,
        binArraysPubkey: binArraysPubkeyForSwap,
      });
      const txHash = await sendAndConfirmTransaction(connection, rawTx, [
        keypair,
      ]);
      expect(txHash).not.toBeNull();
      console.log("Swap Y -> X", txHash);

      const [afterBtc, afterUsdc] = await Promise.all([
        connection
          .getTokenAccountBalance(userBTC)
          .then((ta) => new BN(ta.value.amount)),
        connection
          .getTokenAccountBalance(userUSDC)
          .then((ta) => new BN(ta.value.amount)),
      ]);

      expect(afterBtc.gt(beforeBtc)).toBeTruthy();
      expect(afterUsdc.lt(beforeUsdc)).toBeTruthy();

      actualOutAmount = afterBtc.sub(beforeBtc);
    });

    it("quote matches actual swap result (Y -> X)", () => {
      expect(actualOutAmount.toString()).toBe(quotedOutAmount.toString());
    });
  });

  describe("Swap with 2 bin", () => {
    let btcInAmount: BN;
    let usdcInAmount: BN;
    let quotedOutAmount: BN;
    let actualOutAmount: BN;
    let binArraysPubkeyForSwap: PublicKey[];

    beforeEach(async () => {
      // console.log(lbClmm);
      await lbClmm.refetchStates();
    });

    it("quote X -> Y", async () => {
      const bins = await lbClmm.getBinsBetweenLowerAndUpperBound(
        lbClmm.lbPair.activeId - 1,
        lbClmm.lbPair.activeId
      );

      const beforeActiveBin = bins.bins.pop();
      const activeBin = bins.bins.pop();

      const btcAmountToCrossBin =
        activeBin.yAmount.toNumber() / Number.parseFloat(activeBin.price) +
        beforeActiveBin.yAmount.div(new BN(2)).toNumber() /
          Number.parseFloat(activeBin.price);

      btcInAmount = new BN(btcAmountToCrossBin + 1);

      const binArrays = await lbClmm.getBinArrays();
      const { fee, outAmount, priceImpact, protocolFee, binArraysPubkey } =
        lbClmm.swapQuote(btcInAmount, true, new BN(0), binArrays);
      expect(outAmount.toString()).not.toEqual("0");
      expect(fee.toString()).not.toEqual("0");
      // Swap with crossing bins has price impact
      expect(!priceImpact.isZero()).toBeTruthy();
      expect(protocolFee.toString()).toEqual("0");
      expect(binArraysPubkey.length).toBeGreaterThan(0);

      binArraysPubkeyForSwap = binArraysPubkey;
      quotedOutAmount = outAmount;
    });

    it("swap X -> Y", async () => {
      const [beforeBtc, beforeUsdc] = await Promise.all([
        connection
          .getTokenAccountBalance(userBTC)
          .then((ta) => new BN(ta.value.amount)),
        connection
          .getTokenAccountBalance(userUSDC)
          .then((ta) => new BN(ta.value.amount)),
      ]);

      const rawTx = await lbClmm.swap({
        inAmount: btcInAmount,
        outToken: USDC,
        minOutAmount: new BN(0),
        user: keypair.publicKey,
        inToken: BTC,
        lbPair: lbPairPubkey,
        binArraysPubkey: binArraysPubkeyForSwap,
      });
      const txHash = await sendAndConfirmTransaction(connection, rawTx, [
        keypair,
      ]);
      expect(txHash).not.toBeNull();
      console.log("Swap X -> Y", txHash);

      const [afterBtc, afterUsdc] = await Promise.all([
        connection
          .getTokenAccountBalance(userBTC)
          .then((ta) => new BN(ta.value.amount)),
        connection
          .getTokenAccountBalance(userUSDC)
          .then((ta) => new BN(ta.value.amount)),
      ]);

      expect(afterBtc.lt(beforeBtc)).toBeTruthy();
      expect(afterUsdc.gt(beforeUsdc)).toBeTruthy();

      actualOutAmount = afterUsdc.sub(beforeUsdc);
    });

    it("quote matches actual swap result (X -> Y)", () => {
      expect(actualOutAmount.toString()).toBe(quotedOutAmount.toString());
    });

    it("quote Y -> X", async () => {
      const bins = await lbClmm.getBinsBetweenLowerAndUpperBound(
        lbClmm.lbPair.activeId,
        lbClmm.lbPair.activeId + 1
      );

      const activeBin = bins.bins.pop();
      const afterActiveBin = bins.bins.pop();

      const usdcAmountToCrossBin =
        activeBin.xAmount.toNumber() * Number.parseFloat(activeBin.price) +
        afterActiveBin.xAmount.div(new BN(2)).toNumber() *
          Number.parseFloat(afterActiveBin.price);
      usdcInAmount = new BN(usdcAmountToCrossBin + 1);

      const binArrays = await lbClmm.getBinArrays();
      const { fee, outAmount, priceImpact, protocolFee, binArraysPubkey } =
        lbClmm.swapQuote(usdcInAmount, false, new BN(0), binArrays);
      expect(outAmount.toString()).not.toEqual("0");
      expect(fee.toString()).not.toEqual("0");
      // Swap with crossing bins has price impact
      expect(!priceImpact.isZero()).toBeTruthy();
      expect(protocolFee.toString()).toEqual("0");
      expect(binArraysPubkey.length).toBeGreaterThan(0);

      binArraysPubkeyForSwap = binArraysPubkey;
      quotedOutAmount = outAmount;
    });

    it("swap Y -> X", async () => {
      const [beforeBtc, beforeUsdc] = await Promise.all([
        connection
          .getTokenAccountBalance(userBTC)
          .then((ta) => new BN(ta.value.amount)),
        connection
          .getTokenAccountBalance(userUSDC)
          .then((ta) => new BN(ta.value.amount)),
      ]);

      const rawTx = await lbClmm.swap({
        inAmount: usdcInAmount,
        outToken: BTC,
        minOutAmount: new BN(0),
        user: keypair.publicKey,
        inToken: USDC,
        lbPair: lbPairPubkey,
        binArraysPubkey: binArraysPubkeyForSwap,
      });
      const txHash = await sendAndConfirmTransaction(connection, rawTx, [
        keypair,
      ]);
      expect(txHash).not.toBeNull();
      console.log("Swap Y -> X", txHash);

      const [afterBtc, afterUsdc] = await Promise.all([
        connection
          .getTokenAccountBalance(userBTC)
          .then((ta) => new BN(ta.value.amount)),
        connection
          .getTokenAccountBalance(userUSDC)
          .then((ta) => new BN(ta.value.amount)),
      ]);

      expect(afterBtc.gt(beforeBtc)).toBeTruthy();
      expect(afterUsdc.lt(beforeUsdc)).toBeTruthy();

      actualOutAmount = afterBtc.sub(beforeBtc);
    });

    it("quote matches actual swap result (Y -> X)", () => {
      expect(actualOutAmount.toString()).toBe(quotedOutAmount.toString());
    });
  });
});
