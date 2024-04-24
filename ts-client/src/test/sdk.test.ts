import { AnchorProvider, BN, Program, Wallet, web3 } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
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
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import fs from "fs";
import { DLMM } from "../dlmm/index";
import {
  binIdToBinArrayIndex,
  deriveBinArray,
  deriveLbPair2,
  derivePermissionLbPair,
  derivePresetParameter2,
  derivePresetParameter,
  getBinArrayLowerUpperBinId,
  getPriceOfBinByBinId,
} from "../dlmm/helpers";
import {
  BASIS_POINT_MAX,
  LBCLMM_PROGRAM_IDS,
  MAX_BIN_PER_POSITION,
} from "../dlmm/constants";
import { IDL } from "../dlmm/idl";
import { PairType, StrategyType } from "../dlmm/types";
import Decimal from "decimal.js";
import babar from "babar";
import {
  findSwappableMinMaxBinId,
  getQPriceFromId,
} from "../dlmm/helpers/math";

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
const DEFAULT_BASE_FACTOR = new BN(10000);

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
      100_000_000 * 10 ** btcDecimal,
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
      100_000_000 * 10 ** usdcDecimal,
      [],
      {
        commitment: "confirmed",
      },
      TOKEN_PROGRAM_ID
    );

    [lbPairPubkey] = deriveLbPair2(
      BTC,
      USDC,
      DEFAULT_BIN_STEP,
      DEFAULT_BASE_FACTOR,
      programId
    );
    [lbPairWithBitMapExtPubkey] = deriveLbPair2(
      NATIVE_MINT,
      USDC,
      DEFAULT_BIN_STEP,
      DEFAULT_BASE_FACTOR,
      programId
    );
    [presetParamPda] = derivePresetParameter2(
      DEFAULT_BIN_STEP,
      DEFAULT_BASE_FACTOR,
      programId
    );

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
          baseFactor: DEFAULT_BASE_FACTOR.toNumber(),
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

  describe("Permissioned lb pair", () => {
    const baseKeypair = Keypair.generate();

    let pairKey: PublicKey;
    let pair: DLMM;
    let customFeeOwnerPosition: PublicKey;

    const customFeeOwnerPositionFeeOwner = Keypair.generate();
    const customFeeOwnerPositionOwner = Keypair.generate();

    const normalPosition = Keypair.generate();
    const normalPositionOwner = keypair.publicKey;

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

    beforeAll(async () => {
      await connection.requestAirdrop(
        customFeeOwnerPositionOwner.publicKey,
        2 * LAMPORTS_PER_SOL
      );
    });

    it("findSwappableMinMaxBinId returned min/max bin id are 1 bit from max/min value", () => {
      for (let binStep = 1; binStep <= 500; binStep++) {
        const { minBinId, maxBinId } = findSwappableMinMaxBinId(
          new BN(binStep)
        );
        const minQPrice = getQPriceFromId(minBinId, new BN(binStep));
        const maxQPrice = getQPriceFromId(maxBinId, new BN(binStep));
        expect(minQPrice.toString()).toBe("2");
        expect(maxQPrice.toString()).toBe(
          "170141183460469231731687303715884105727"
        );

        const nextMinQPrice = getQPriceFromId(
          minBinId.sub(new BN(1)),
          new BN(binStep)
        );
        const nextMaxQPrice = getQPriceFromId(
          maxBinId.add(new BN(1)),
          new BN(binStep)
        );
        expect(nextMinQPrice.toString()).toBe("1");
        expect(nextMaxQPrice.toString()).toBe(
          "340282366920938463463374607431768211455"
        );
      }
    });

    it("create permissioned LB pair", async () => {
      const feeBps = new BN(50);
      const lockDurationInSlot = new BN(0);

      try {
        const rawTx = await DLMM.createPermissionLbPair(
          connection,
          DEFAULT_BIN_STEP,
          BTC,
          USDC,
          DEFAULT_ACTIVE_ID,
          baseKeypair.publicKey,
          keypair.publicKey,
          feeBps,
          lockDurationInSlot,
          { cluster: "localhost" }
        );
        const txHash = await sendAndConfirmTransaction(connection, rawTx, [
          keypair,
          baseKeypair,
        ]);
        expect(txHash).not.toBeNull();
        console.log("Create permissioned LB pair", txHash);

        [pairKey] = derivePermissionLbPair(
          baseKeypair.publicKey,
          BTC,
          USDC,
          DEFAULT_BIN_STEP,
          programId
        );

        pair = await DLMM.create(connection, pairKey, {
          cluster: "localhost",
        });

        const pairState = pair.lbPair;
        expect(pairState.pairType).toBe(PairType.Permissioned);
      } catch (error) {
        console.log(JSON.parse(JSON.stringify(error)));
      }
    });

    it("update whitelisted wallet", async () => {
      try {
        const walletToWhitelist = keypair.publicKey;
        const rawTx = await pair.updateWhitelistedWallet(walletToWhitelist);
        const txHash = await sendAndConfirmTransaction(connection, rawTx, [
          keypair,
        ]);
        console.log("Update whitelisted wallet", txHash);
        expect(txHash).not.toBeNull();

        await pair.refetchStates();

        const pairState = pair.lbPair;
        expect(pairState.whitelistedWallet[0].toBase58()).toBe(
          walletToWhitelist.toBase58()
        );
      } catch (error) {
        console.log(JSON.parse(JSON.stringify(error)));
      }
    });

    it("initialize position by operator and add liquidity", async () => {
      const updateWhitelistedWalletRawTx = await pair.updateWhitelistedWallet(
        keypair.publicKey
      );
      await sendAndConfirmTransaction(
        connection,
        updateWhitelistedWalletRawTx,
        [keypair]
      );

      const program = pair.program;
      const baseKeypair = Keypair.generate();
      const lowerBinId = DEFAULT_ACTIVE_ID.sub(new BN(30));
      const width = MAX_BIN_PER_POSITION;

      const lowerBinIdBytes = lowerBinId.isNeg()
        ? lowerBinId.toTwos(32).toArrayLike(Buffer, "le", 4)
        : lowerBinId.toArrayLike(Buffer, "le", 4);

      const widthBytes = width.isNeg()
        ? width.toTwos(32).toArrayLike(Buffer, "le", 4)
        : width.toArrayLike(Buffer, "le", 4);

      [customFeeOwnerPosition] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("position"),
          pair.pubkey.toBuffer(),
          baseKeypair.publicKey.toBuffer(),
          lowerBinIdBytes,
          widthBytes,
        ],
        pair.program.programId
      );

      const initializePositionByOperatorTx = await program.methods
        .initializePositionByOperator(
          lowerBinId.toNumber(),
          width.toNumber(),
          customFeeOwnerPositionOwner.publicKey,
          customFeeOwnerPositionFeeOwner.publicKey
        )
        .accounts({
          lbPair: pair.pubkey,
          position: customFeeOwnerPosition,
          base: baseKeypair.publicKey,
          operator: keypair.publicKey,
          program: program.programId,
          payer: keypair.publicKey,
        })
        .transaction();

      await sendAndConfirmTransaction(
        connection,
        initializePositionByOperatorTx,
        [keypair, baseKeypair]
      ).catch((e) => {
        console.error(e);
        throw e;
      });

      await pair.refetchStates();

      let addLiquidityTxs = await pair.addLiquidityByWeight({
        positionPubKey: customFeeOwnerPosition,
        totalXAmount: btcInAmount,
        totalYAmount: usdcInAmount,
        xYAmountDistribution,
        user: keypair.publicKey,
        slippage: 0,
      });

      addLiquidityTxs = Array.isArray(addLiquidityTxs)
        ? addLiquidityTxs[0]
        : addLiquidityTxs;

      await sendAndConfirmTransaction(connection, addLiquidityTxs, [keypair]);

      await pair.refetchStates();
    });

    it("update activation slot", async () => {
      try {
        const currentSlot = await connection.getSlot();
        const activationSlot = new BN(currentSlot + 10);
        const rawTx = await pair.setActivationSlot(new BN(currentSlot + 10));
        const txHash = await sendAndConfirmTransaction(connection, rawTx, [
          keypair,
        ]);
        console.log("Update activation slot", txHash);
        expect(txHash).not.toBeNull();

        await pair.refetchStates();

        const pairState = pair.lbPair;
        expect(pairState.activationSlot.eq(activationSlot)).toBeTruthy();
      } catch (error) {
        console.log(JSON.parse(JSON.stringify(error)));
      }
    });

    it("normal position add liquidity after activation", async () => {
      while (true) {
        const currentSlot = await connection.getSlot();
        if (currentSlot >= pair.lbPair.activationSlot.toNumber()) {
          break;
        } else {
          await new Promise((res) => setTimeout(res, 1000));
        }
      }

      const initPositionAddLiquidityTx =
        await pair.initializePositionAndAddLiquidityByStrategy({
          positionPubKey: normalPosition.publicKey,
          totalXAmount: btcInAmount,
          totalYAmount: usdcInAmount,
          strategy: {
            strategyType: StrategyType.SpotBalanced,
            maxBinId:
              xYAmountDistribution[xYAmountDistribution.length - 1].binId,
            minBinId: xYAmountDistribution[0].binId,
          },
          user: keypair.publicKey,
          slippage: 0,
        });

      await sendAndConfirmTransaction(connection, initPositionAddLiquidityTx, [
        keypair,
        normalPosition,
      ]);
    });

    it("remove liquidity from position with custom owner, capital to position owner, but fee to fee owner", async () => {
      const activeBinArrayIdx = binIdToBinArrayIndex(
        new BN(pair.lbPair.activeId)
      );
      const [activeBinArray] = deriveBinArray(
        pair.pubkey,
        activeBinArrayIdx,
        pair.program.programId
      );

      let swapTx = await pair.swap({
        inAmount: new BN(10000).mul(new BN(10 ** usdcDecimal)),
        outToken: BTC,
        minOutAmount: new BN(0),
        user: keypair.publicKey,
        inToken: USDC,
        lbPair: pair.pubkey,
        binArraysPubkey: [activeBinArray],
      });

      await sendAndConfirmTransaction(connection, swapTx, [keypair]);

      swapTx = await pair.swap({
        inAmount: new BN(1000000),
        outToken: USDC,
        minOutAmount: new BN(0),
        user: keypair.publicKey,
        inToken: BTC,
        lbPair: pair.pubkey,
        binArraysPubkey: [activeBinArray],
      });

      await sendAndConfirmTransaction(connection, swapTx, [keypair]);

      const ownerTokenXAta = getAssociatedTokenAddressSync(
        pair.tokenX.publicKey,
        customFeeOwnerPositionOwner.publicKey
      );
      const ownerTokenYAta = getAssociatedTokenAddressSync(
        pair.tokenY.publicKey,
        customFeeOwnerPositionOwner.publicKey
      );
      const feeOwnerTokenXAta = getAssociatedTokenAddressSync(
        pair.tokenX.publicKey,
        customFeeOwnerPositionFeeOwner.publicKey
      );
      const feeOwnerTokenYAta = getAssociatedTokenAddressSync(
        pair.tokenY.publicKey,
        customFeeOwnerPositionFeeOwner.publicKey
      );

      const [
        beforeOwnerTokenX,
        beforeOwnerTokenY,
        beforeFeeOwnerTokenX,
        beforeFeeOwnerTokenY,
      ] = await Promise.all([
        connection
          .getTokenAccountBalance(ownerTokenXAta)
          .then((b) => new BN(b.value.amount))
          .catch((_) => new BN(0)),
        connection
          .getTokenAccountBalance(ownerTokenYAta)
          .then((b) => new BN(b.value.amount))
          .catch((_) => new BN(0)),
        connection
          .getTokenAccountBalance(feeOwnerTokenXAta)
          .then((b) => new BN(b.value.amount))
          .catch((_) => new BN(0)),
        connection
          .getTokenAccountBalance(feeOwnerTokenYAta)
          .then((b) => new BN(b.value.amount))
          .catch((_) => new BN(0)),
      ]);

      const removeLiquidityTx = await pair.removeLiquidity({
        user: customFeeOwnerPositionOwner.publicKey,
        binIds: xYAmountDistribution.map((dist) => dist.binId),
        position: customFeeOwnerPosition,
        bps: new BN(10_000),
        shouldClaimAndClose: true,
      });

      if (Array.isArray(removeLiquidityTx)) {
        for (const tx of removeLiquidityTx) {
          const txHash = await sendAndConfirmTransaction(connection, tx, [
            customFeeOwnerPositionOwner,
          ]);
          console.log(txHash);
        }
      } else {
        const txHash = await sendAndConfirmTransaction(
          connection,
          removeLiquidityTx,
          [customFeeOwnerPositionOwner]
        );
        console.log(txHash);
      }

      const [
        afterOwnerTokenX,
        afterOwnerTokenY,
        afterFeeOwnerTokenX,
        afterFeeOwnerTokenY,
      ] = await Promise.all([
        connection
          .getTokenAccountBalance(ownerTokenXAta)
          .then((b) => new BN(b.value.amount)),
        connection
          .getTokenAccountBalance(ownerTokenYAta)
          .then((b) => new BN(b.value.amount)),
        connection
          .getTokenAccountBalance(feeOwnerTokenXAta)
          .then((b) => new BN(b.value.amount)),
        connection
          .getTokenAccountBalance(feeOwnerTokenYAta)
          .then((b) => new BN(b.value.amount)),
      ]);

      expect(
        afterOwnerTokenX.sub(beforeOwnerTokenX).toNumber()
      ).toBeGreaterThan(0);
      expect(
        afterOwnerTokenY.sub(beforeOwnerTokenY).toNumber()
      ).toBeGreaterThan(0);
      expect(
        afterFeeOwnerTokenX.sub(beforeFeeOwnerTokenX).toNumber()
      ).toBeGreaterThan(0);
      expect(
        afterFeeOwnerTokenY.sub(beforeFeeOwnerTokenY).toNumber()
      ).toBeGreaterThan(0);
    });

    it("remove liquidity from position, capital and fee to position owner", async () => {
      await pair.refetchStates();

      const positionState = await pair
        .getPositionsByUserAndLbPair(normalPositionOwner)
        .then((positions) => {
          return positions.userPositions.find((p) =>
            p.publicKey.equals(normalPosition.publicKey)
          );
        });

      const fullAmountX = new Decimal(
        positionState.positionData.feeX.toString()
      )
        .add(positionState.positionData.totalXAmount)
        .floor();

      const fullAmountY = new Decimal(
        positionState.positionData.feeY.toString()
      )
        .add(positionState.positionData.totalYAmount)
        .floor();

      const ownerTokenXAta = getAssociatedTokenAddressSync(
        pair.tokenX.publicKey,
        normalPositionOwner
      );
      const ownerTokenYAta = getAssociatedTokenAddressSync(
        pair.tokenY.publicKey,
        normalPositionOwner
      );

      const [beforeOwnerTokenX, beforeOwnerTokenY] = await Promise.all([
        connection
          .getTokenAccountBalance(ownerTokenXAta)
          .then((b) => new BN(b.value.amount)),
        connection
          .getTokenAccountBalance(ownerTokenYAta)
          .then((b) => new BN(b.value.amount)),
      ]);

      const removeLiquidityTx = await pair.removeLiquidity({
        user: keypair.publicKey,
        binIds: xYAmountDistribution.map((dist) => dist.binId),
        position: normalPosition.publicKey,
        bps: new BN(10_000),
        shouldClaimAndClose: true,
      });

      if (Array.isArray(removeLiquidityTx)) {
        for (const tx of removeLiquidityTx) {
          const txHash = await sendAndConfirmTransaction(connection, tx, [
            keypair,
          ]);
          console.log(txHash);
        }
      } else {
        const txHash = await sendAndConfirmTransaction(
          connection,
          removeLiquidityTx,
          [keypair]
        );
        console.log(txHash);
      }

      const [afterOwnerTokenX, afterOwnerTokenY] = await Promise.all([
        connection
          .getTokenAccountBalance(ownerTokenXAta)
          .then((b) => new BN(b.value.amount)),
        connection
          .getTokenAccountBalance(ownerTokenYAta)
          .then((b) => new BN(b.value.amount)),
      ]);

      const amountX = afterOwnerTokenX.sub(beforeOwnerTokenX);
      const amountY = afterOwnerTokenY.sub(beforeOwnerTokenY);

      expect(fullAmountX.toString()).toBe(amountX.toString());
      expect(fullAmountY.toString()).toBe(amountY.toString());
    });
  });

  describe("seed liquidity", () => {
    let baseKeypair: Keypair;
    let pairKey: PublicKey;
    let pair: DLMM;

    beforeEach(async () => {
      await mintTo(
        connection,
        keypair,
        BTC,
        userBTC,
        keypair.publicKey,
        1_000_000_000 * 10 ** btcDecimal,
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
        1_000_000_000 * 10 ** usdcDecimal,
        [],
        {
          commitment: "confirmed",
        },
        TOKEN_PROGRAM_ID
      );

      baseKeypair = Keypair.generate();
      const feeBps = new BN(50);
      const lockDurationInSlot = new BN(0);

      let rawTx = await DLMM.createPermissionLbPair(
        connection,
        DEFAULT_BIN_STEP,
        BTC,
        USDC,
        DEFAULT_ACTIVE_ID,
        baseKeypair.publicKey,
        keypair.publicKey,
        feeBps,
        lockDurationInSlot,
        { cluster: "localhost" }
      );
      let txHash = await sendAndConfirmTransaction(connection, rawTx, [
        keypair,
        baseKeypair,
      ]);
      expect(txHash).not.toBeNull();
      console.log("Create permissioned LB pair", txHash);

      [pairKey] = derivePermissionLbPair(
        baseKeypair.publicKey,
        BTC,
        USDC,
        DEFAULT_BIN_STEP,
        programId
      );

      pair = await DLMM.create(connection, pairKey, {
        cluster: "localhost",
      });

      let pairState = pair.lbPair;
      expect(pairState.pairType).toBe(PairType.Permissioned);

      const walletToWhitelist = keypair.publicKey;
      rawTx = await pair.updateWhitelistedWallet(walletToWhitelist);
      txHash = await sendAndConfirmTransaction(connection, rawTx, [keypair]);
      console.log("Update whitelisted wallet", txHash);
      expect(txHash).not.toBeNull();

      await pair.refetchStates();

      pairState = pair.lbPair;
      expect(pairState.whitelistedWallet[0].toBase58()).toBe(
        walletToWhitelist.toBase58()
      );
    });

    it("Rerun if failed at first deposit", async () => {
      const seedAmount = new BN(100_000_000).mul(new BN(10 ** btcDecimal));
      const curvature = 0.8;

      const priceMultiplier = new Decimal(
        10 ** (pair.tokenX.decimal - pair.tokenY.decimal)
      );

      const minPrice = new Decimal(
        pair.getPriceOfBinByBinId(pair.lbPair.activeId) + 1
      ).mul(priceMultiplier);

      const maxPrice = new Decimal(
        pair.getPriceOfBinByBinId(
          pair.lbPair.activeId + 1 + MAX_BIN_PER_POSITION.toNumber() * 3
        )
      ).mul(priceMultiplier);

      const firstDepositIndex = 1; // Init position + bin arrays first, then deposit
      let groupedInstructions = await pair.seedLiquidity(
        keypair.publicKey,
        keypair.publicKey,
        keypair.publicKey,
        seedAmount,
        curvature,
        minPrice.toNumber(),
        maxPrice.toNumber(),
        baseKeypair.publicKey
      );

      let beforeTokenXBalance = await connection
        .getTokenAccountBalance(userBTC)
        .then((i) => new BN(i.value.amount));

      for (const [idx, groupIx] of groupedInstructions.entries()) {
        if (idx == firstDepositIndex) {
          continue;
        }
        const requireBaseSignature = groupIx.find((ix) =>
          ix.keys.find((key) => key.pubkey.equals(baseKeypair.publicKey))
        );

        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");

        const tx = new Transaction({
          feePayer: keypair.publicKey,
          blockhash,
          lastValidBlockHeight,
        }).add(...groupIx);

        const signers = [keypair];

        if (requireBaseSignature) {
          signers.push(baseKeypair);
        }

        const txHash = await sendAndConfirmTransaction(
          connection,
          tx,
          signers
        ).catch((e) => {
          console.error(e);
          throw e;
        });
        console.log(txHash);
      }

      let afterTokenXBalance = await connection
        .getTokenAccountBalance(userBTC)
        .then((i) => new BN(i.value.amount));

      const actualDepositedAmount = beforeTokenXBalance.sub(afterTokenXBalance);
      expect(actualDepositedAmount.toString()).not.toEqual(
        seedAmount.toString()
      );

      groupedInstructions = await pair.seedLiquidity(
        keypair.publicKey,
        keypair.publicKey,
        keypair.publicKey,
        seedAmount,
        curvature,
        minPrice.toNumber(),
        maxPrice.toNumber(),
        baseKeypair.publicKey
      );

      expect(groupedInstructions.length).toBe(1);

      beforeTokenXBalance = afterTokenXBalance;
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");

      const tx = new Transaction({
        feePayer: keypair.publicKey,
        blockhash,
        lastValidBlockHeight,
      }).add(...groupedInstructions[0]);

      const txHash = await sendAndConfirmTransaction(connection, tx, [
        keypair,
      ]).catch((e) => {
        console.error(e);
        throw e;
      });
      console.log(txHash);

      afterTokenXBalance = await connection
        .getTokenAccountBalance(userBTC)
        .then((i) => new BN(i.value.amount));

      const depositedAmount = beforeTokenXBalance.sub(afterTokenXBalance);
      expect(actualDepositedAmount.add(depositedAmount).toString()).toEqual(
        seedAmount.toString()
      );

      let binArrays = await pair.getBinArrays();
      binArrays = binArrays.sort((a, b) =>
        a.account.index.cmp(b.account.index)
      );
      const binLiquidities = binArrays
        .map((ba) => {
          const [lowerBinId, upperBinId] = getBinArrayLowerUpperBinId(
            ba.account.index
          );
          const binWithLiquidity: [number, number][] = [];
          for (let i = lowerBinId.toNumber(); i <= upperBinId.toNumber(); i++) {
            const binAmountX =
              ba.account.bins[i - lowerBinId.toNumber()].amountX;
            const binPrice = getPriceOfBinByBinId(i, pair.lbPair.binStep);
            const liquidity = new Decimal(binAmountX.toString())
              .mul(binPrice)
              .floor()
              .toNumber();
            binWithLiquidity.push([i, liquidity]);
          }
          return binWithLiquidity;
        })
        .flat();

      console.log(babar(binLiquidities));
    });

    it("Rerun if failed at middle deposit", async () => {
      const seedAmount = new BN(100_000_000).mul(new BN(10 ** btcDecimal));
      const curvature = 0.8;

      const priceMultiplier = new Decimal(
        10 ** (pair.tokenX.decimal - pair.tokenY.decimal)
      );

      const minPrice = new Decimal(
        pair.getPriceOfBinByBinId(pair.lbPair.activeId) + 1
      ).mul(priceMultiplier);

      const maxPrice = new Decimal(
        pair.getPriceOfBinByBinId(
          pair.lbPair.activeId + 1 + MAX_BIN_PER_POSITION.toNumber() * 3
        )
      ).mul(priceMultiplier);

      const middleDepositIndex = 3; // 0 - InitPosition + BinArrays, 1 - Deposit, 2 - InitPosition + BinArrays, 3 - Deposit
      let groupedInstructions = await pair.seedLiquidity(
        keypair.publicKey,
        keypair.publicKey,
        keypair.publicKey,
        seedAmount,
        curvature,
        minPrice.toNumber(),
        maxPrice.toNumber(),
        baseKeypair.publicKey
      );

      let beforeTokenXBalance = await connection
        .getTokenAccountBalance(userBTC)
        .then((i) => new BN(i.value.amount));

      for (const [idx, groupIx] of groupedInstructions.entries()) {
        if (idx == middleDepositIndex) {
          continue;
        }
        const requireBaseSignature = groupIx.find((ix) =>
          ix.keys.find((key) => key.pubkey.equals(baseKeypair.publicKey))
        );

        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");

        const tx = new Transaction({
          feePayer: keypair.publicKey,
          blockhash,
          lastValidBlockHeight,
        }).add(...groupIx);

        const signers = [keypair];

        if (requireBaseSignature) {
          signers.push(baseKeypair);
        }

        const txHash = await sendAndConfirmTransaction(
          connection,
          tx,
          signers
        ).catch((e) => {
          console.error(e);
          throw e;
        });
        console.log(txHash);
      }

      let afterTokenXBalance = await connection
        .getTokenAccountBalance(userBTC)
        .then((i) => new BN(i.value.amount));

      const actualDepositedAmount = beforeTokenXBalance.sub(afterTokenXBalance);
      expect(actualDepositedAmount.toString()).not.toEqual(
        seedAmount.toString()
      );

      groupedInstructions = await pair.seedLiquidity(
        keypair.publicKey,
        keypair.publicKey,
        keypair.publicKey,
        seedAmount,
        curvature,
        minPrice.toNumber(),
        maxPrice.toNumber(),
        baseKeypair.publicKey
      );

      expect(groupedInstructions.length).toBe(1);

      beforeTokenXBalance = afterTokenXBalance;
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");

      const tx = new Transaction({
        feePayer: keypair.publicKey,
        blockhash,
        lastValidBlockHeight,
      }).add(...groupedInstructions[0]);

      const txHash = await sendAndConfirmTransaction(connection, tx, [
        keypair,
      ]).catch((e) => {
        console.error(e);
        throw e;
      });
      console.log(txHash);

      afterTokenXBalance = await connection
        .getTokenAccountBalance(userBTC)
        .then((i) => new BN(i.value.amount));

      const depositedAmount = beforeTokenXBalance.sub(afterTokenXBalance);
      expect(actualDepositedAmount.add(depositedAmount).toString()).toEqual(
        seedAmount.toString()
      );

      let binArrays = await pair.getBinArrays();
      binArrays = binArrays.sort((a, b) =>
        a.account.index.cmp(b.account.index)
      );
      const binLiquidities = binArrays
        .map((ba) => {
          const [lowerBinId, upperBinId] = getBinArrayLowerUpperBinId(
            ba.account.index
          );
          const binWithLiquidity: [number, number][] = [];
          for (let i = lowerBinId.toNumber(); i <= upperBinId.toNumber(); i++) {
            const binAmountX =
              ba.account.bins[i - lowerBinId.toNumber()].amountX;
            const binPrice = getPriceOfBinByBinId(i, pair.lbPair.binStep);
            const liquidity = new Decimal(binAmountX.toString())
              .mul(binPrice)
              .floor()
              .toNumber();
            binWithLiquidity.push([i, liquidity]);
          }
          return binWithLiquidity;
        })
        .flat();

      console.log(babar(binLiquidities));
    });

    it("Rerun if failed at last deposit", async () => {
      const seedAmount = new BN(100_000_000).mul(new BN(10 ** btcDecimal));
      const curvature = 0.8;

      const priceMultiplier = new Decimal(
        10 ** (pair.tokenX.decimal - pair.tokenY.decimal)
      );

      const minPrice = new Decimal(
        pair.getPriceOfBinByBinId(pair.lbPair.activeId) + 1
      ).mul(priceMultiplier);

      const maxPrice = new Decimal(
        pair.getPriceOfBinByBinId(
          pair.lbPair.activeId + 1 + MAX_BIN_PER_POSITION.toNumber() * 3
        )
      ).mul(priceMultiplier);

      let groupedInstructions = await pair.seedLiquidity(
        keypair.publicKey,
        keypair.publicKey,
        keypair.publicKey,
        seedAmount,
        curvature,
        minPrice.toNumber(),
        maxPrice.toNumber(),
        baseKeypair.publicKey
      );
      const lastDepositIndex = groupedInstructions.length - 1;

      let beforeTokenXBalance = await connection
        .getTokenAccountBalance(userBTC)
        .then((i) => new BN(i.value.amount));

      for (const [idx, groupIx] of groupedInstructions.entries()) {
        if (idx == lastDepositIndex) {
          continue;
        }
        const requireBaseSignature = groupIx.find((ix) =>
          ix.keys.find((key) => key.pubkey.equals(baseKeypair.publicKey))
        );

        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");

        const tx = new Transaction({
          feePayer: keypair.publicKey,
          blockhash,
          lastValidBlockHeight,
        }).add(...groupIx);

        const signers = [keypair];

        if (requireBaseSignature) {
          signers.push(baseKeypair);
        }

        const txHash = await sendAndConfirmTransaction(
          connection,
          tx,
          signers
        ).catch((e) => {
          console.error(e);
          throw e;
        });
        console.log(txHash);
      }

      let afterTokenXBalance = await connection
        .getTokenAccountBalance(userBTC)
        .then((i) => new BN(i.value.amount));

      const actualDepositedAmount = beforeTokenXBalance.sub(afterTokenXBalance);
      expect(actualDepositedAmount.toString()).not.toEqual(
        seedAmount.toString()
      );

      groupedInstructions = await pair.seedLiquidity(
        keypair.publicKey,
        keypair.publicKey,
        keypair.publicKey,
        seedAmount,
        curvature,
        minPrice.toNumber(),
        maxPrice.toNumber(),
        baseKeypair.publicKey
      );

      expect(groupedInstructions.length).toBe(1);

      beforeTokenXBalance = afterTokenXBalance;
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");

      const tx = new Transaction({
        feePayer: keypair.publicKey,
        blockhash,
        lastValidBlockHeight,
      }).add(...groupedInstructions[0]);

      const txHash = await sendAndConfirmTransaction(connection, tx, [
        keypair,
      ]).catch((e) => {
        console.error(e);
        throw e;
      });
      console.log(txHash);

      afterTokenXBalance = await connection
        .getTokenAccountBalance(userBTC)
        .then((i) => new BN(i.value.amount));

      const depositedAmount = beforeTokenXBalance.sub(afterTokenXBalance);
      expect(actualDepositedAmount.add(depositedAmount).toString()).toEqual(
        seedAmount.toString()
      );

      let binArrays = await pair.getBinArrays();
      binArrays = binArrays.sort((a, b) =>
        a.account.index.cmp(b.account.index)
      );
      const binLiquidities = binArrays
        .map((ba) => {
          const [lowerBinId, upperBinId] = getBinArrayLowerUpperBinId(
            ba.account.index
          );
          const binWithLiquidity: [number, number][] = [];
          for (let i = lowerBinId.toNumber(); i <= upperBinId.toNumber(); i++) {
            const binAmountX =
              ba.account.bins[i - lowerBinId.toNumber()].amountX;
            const binPrice = getPriceOfBinByBinId(i, pair.lbPair.binStep);
            const liquidity = new Decimal(binAmountX.toString())
              .mul(binPrice)
              .floor()
              .toNumber();
            binWithLiquidity.push([i, liquidity]);
          }
          return binWithLiquidity;
        })
        .flat();

      console.log(babar(binLiquidities));
    });

    it("Happy path", async () => {
      const seedAmount = new BN(Math.random() * 1_000_000_000)
        .add(new BN(100_000_000))
        .mul(new BN(10 ** btcDecimal));

      const curvature = Math.floor((Math.random() * 1.5 + 0.5) * 100) / 100;

      const priceMultiplier = new Decimal(
        10 ** (pair.tokenX.decimal - pair.tokenY.decimal)
      );

      const positionNeeded = Math.floor(Math.random() * 11 + 1);

      const minPrice = new Decimal(
        pair.getPriceOfBinByBinId(pair.lbPair.activeId) + 1
      ).mul(priceMultiplier);

      const maxPrice = new Decimal(
        pair.getPriceOfBinByBinId(
          pair.lbPair.activeId +
            1 +
            MAX_BIN_PER_POSITION.toNumber() * positionNeeded
        )
      ).mul(priceMultiplier);

      console.log("SeedAmount", seedAmount.toString());
      console.log("Curvature", curvature);
      console.log("PositionNeeded", positionNeeded);
      console.log("Min/Max price", minPrice, maxPrice);
      console.log("Binstep", pair.lbPair.binStep);

      const groupedInstructions = await pair.seedLiquidity(
        keypair.publicKey,
        keypair.publicKey,
        keypair.publicKey,
        seedAmount,
        curvature,
        minPrice.toNumber(),
        maxPrice.toNumber(),
        baseKeypair.publicKey
      );

      const beforeTokenXBalance = await connection
        .getTokenAccountBalance(userBTC)
        .then((i) => new BN(i.value.amount));

      for (const groupIx of groupedInstructions) {
        const requireBaseSignature = groupIx.find((ix) =>
          ix.keys.find((key) => key.pubkey.equals(baseKeypair.publicKey))
        );

        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");

        const tx = new Transaction({
          feePayer: keypair.publicKey,
          blockhash,
          lastValidBlockHeight,
        }).add(...groupIx);

        const signers = [keypair];

        if (requireBaseSignature) {
          signers.push(baseKeypair);
        }

        const txHash = await sendAndConfirmTransaction(
          connection,
          tx,
          signers
        ).catch((e) => {
          console.error(e);
          throw e;
        });
        console.log(txHash);
      }

      const afterTokenXBalance = await connection
        .getTokenAccountBalance(userBTC)
        .then((i) => new BN(i.value.amount));

      const actualDepositedAmount = beforeTokenXBalance.sub(afterTokenXBalance);
      expect(actualDepositedAmount.toString()).toEqual(seedAmount.toString());

      let binArrays = await pair.getBinArrays();
      binArrays = binArrays.sort((a, b) =>
        a.account.index.cmp(b.account.index)
      );

      const binLiquidities = binArrays
        .map((ba) => {
          const [lowerBinId, upperBinId] = getBinArrayLowerUpperBinId(
            ba.account.index
          );
          const binWithLiquidity: [number, number][] = [];
          for (let i = lowerBinId.toNumber(); i <= upperBinId.toNumber(); i++) {
            const binAmountX =
              ba.account.bins[i - lowerBinId.toNumber()].amountX;
            const binPrice = getPriceOfBinByBinId(i, pair.lbPair.binStep);
            const liquidity = new Decimal(binAmountX.toString())
              .mul(binPrice)
              .floor()
              .toNumber();
            binWithLiquidity.push([i, liquidity]);
          }
          return binWithLiquidity;
        })
        .flat();

      // console.log(binLiquidities.filter((b) => b[1] > 0).reverse());
      // console.log(binLiquidities.filter((b) => b[1] > 0));
      console.log(babar(binLiquidities));
    });
  });

  it("create LB pair", async () => {
    try {
      const presetParamState = await DLMM.getAllPresetParameters(connection, {
        cluster: "localhost",
      });
      const rawTx = await DLMM.createLbPair(
        connection,
        keypair.publicKey,
        BTC,
        USDC,
        new BN(presetParamState[0].account.binStep),
        new BN(presetParamState[0].account.baseFactor),
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
    const presetParamState = await DLMM.getAllPresetParameters(connection, {
      cluster: "localhost",
    });
    const rawTx = await DLMM.createLbPair(
      connection,
      keypair.publicKey,
      NATIVE_MINT,
      USDC,
      new BN(presetParamState[0].account.binStep),
      new BN(presetParamState[0].account.baseFactor),
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
