import { AnchorProvider, BN, Program, Wallet, web3 } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transfer,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import Decimal from "decimal.js";
import fs from "fs";
import { MAX_BIN_PER_POSITION, LBCLMM_PROGRAM_IDS } from "../dlmm/constants";
import {
  binIdToBinArrayIndex,
  deriveBinArray,
  deriveLbPair2,
  deriveOracle,
  derivePermissionLbPair,
  derivePresetParameter2,
  deriveReserve,
} from "../dlmm/helpers";
import { computeBaseFactorFromFeeBps } from "../dlmm/helpers/math";
import { IDL } from "../dlmm/idl";
import { DLMM } from "../dlmm/index";
import { ActivationType, PairType, StrategyType } from "../dlmm/types";
import { wrapPosition } from "../dlmm/helpers/positions";

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
const DEFAULT_BASE_FACTOR_2 = new BN(4000);

const programId = new web3.PublicKey(LBCLMM_PROGRAM_IDS["localhost"]);
const provider = new AnchorProvider(
  connection,
  new Wallet(keypair),
  AnchorProvider.defaultOptions()
);

let BTC: web3.PublicKey;
let USDC: web3.PublicKey;
let lbClmm: DLMM;
let lbClmmWithBitMapExt: DLMM;
let lbPairPubkey: web3.PublicKey;
let lbPairWithBitMapExtPubkey: web3.PublicKey;
let userBTC: web3.PublicKey;
let userUSDC: web3.PublicKey;
let presetParamPda: web3.PublicKey;
let presetParamPda2: web3.PublicKey;

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
      DEFAULT_BASE_FACTOR_2,
      programId
    );
    [presetParamPda] = derivePresetParameter2(
      DEFAULT_BIN_STEP,
      DEFAULT_BASE_FACTOR,
      programId
    );
    [presetParamPda2] = derivePresetParameter2(
      DEFAULT_BIN_STEP,
      DEFAULT_BASE_FACTOR_2,
      programId
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

    const presetParamState2 =
      await program.account.presetParameter.fetchNullable(presetParamPda2);

    if (!presetParamState2) {
      await program.methods
        .initializePresetParameter({
          binStep: DEFAULT_BIN_STEP.toNumber(),
          baseFactor: DEFAULT_BASE_FACTOR_2.toNumber(),
          filterPeriod: 30,
          decayPeriod: 600,
          reductionFactor: 5000,
          variableFeeControl: 40000,
          protocolShare: 0,
          maxVolatilityAccumulator: 350000,
        })
        .accounts({
          admin: keypair.publicKey,
          presetParameter: presetParamPda2,
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

    beforeAll(async () => {
      await connection.requestAirdrop(
        customFeeOwnerPositionOwner.publicKey,
        2 * LAMPORTS_PER_SOL
      );

      const feeBps = new BN(50);
      const protocolFeeBps = new BN(50);

      try {
        const program = new Program(
          IDL,
          LBCLMM_PROGRAM_IDS["localhost"],
          provider
        );

        [pairKey] = derivePermissionLbPair(
          baseKeypair.publicKey,
          BTC,
          USDC,
          DEFAULT_BIN_STEP,
          programId
        );

        const [reserveX] = deriveReserve(BTC, pairKey, programId);
        const [reserveY] = deriveReserve(USDC, pairKey, programId);

        const [oracle] = deriveOracle(pairKey, program.programId);

        const [baseFactor, basePowerFactor] = computeBaseFactorFromFeeBps(
          DEFAULT_BIN_STEP,
          feeBps
        );

        const initPermissionPairTx = await program.methods
          .initializePermissionLbPair({
            activeId: DEFAULT_ACTIVE_ID.toNumber(),
            binStep: DEFAULT_BIN_STEP.toNumber(),
            baseFactor: baseFactor.toNumber(),
            baseFeePowerFactor: basePowerFactor.toNumber(),
            activationType: ActivationType.Slot,
            protocolShare: protocolFeeBps.toNumber(),
          })
          .accounts({
            base: baseKeypair.publicKey,
            lbPair: pairKey,
            binArrayBitmapExtension: program.programId,
            tokenMintX: BTC,
            tokenMintY: USDC,
            reserveX,
            reserveY,
            oracle,
            admin: keypair.publicKey,
            tokenBadgeX: program.programId,
            tokenBadgeY: program.programId,
            tokenProgramX: TOKEN_PROGRAM_ID,
            tokenProgramY: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
            program: program.programId,
          })
          .transaction();

        await sendAndConfirmTransaction(connection, initPermissionPairTx, [
          keypair,
          baseKeypair,
        ]);

        pair = await DLMM.create(connection, pairKey, {
          cluster: "localhost",
        });

        const pairState = pair.lbPair;
        expect(pairState.pairType).toBe(PairType.Permissioned);
      } catch (error) {
        console.log(JSON.parse(JSON.stringify(error)));
        throw error;
      }
    });

    it("initialize position and add liquidity both side", async () => {
      const program = pair.program;
      const baseKeypair = Keypair.generate();
      const width = MAX_BIN_PER_POSITION;
      const lowerBinId = DEFAULT_ACTIVE_ID.sub(width.div(new BN(2)));

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

      const operatorTokenX = await getOrCreateAssociatedTokenAccount(
        connection,
        keypair,
        BTC,
        keypair.publicKey
      );

      const ownerTokenX = await getOrCreateAssociatedTokenAccount(
        connection,
        keypair,
        BTC,
        customFeeOwnerPositionOwner.publicKey
      );

      await transfer(
        connection,
        keypair,
        operatorTokenX.address,
        ownerTokenX.address,
        keypair,
        BigInt(1)
      );

      console.log("Initialize position by operator");

      const initializePositionByOperatorTx = await program.methods
        .initializePositionByOperator(
          lowerBinId.toNumber(),
          width.toNumber(),
          customFeeOwnerPositionFeeOwner.publicKey,
          new BN(0)
        )
        .accounts({
          lbPair: pair.pubkey,
          position: customFeeOwnerPosition,
          base: baseKeypair.publicKey,
          operator: keypair.publicKey,
          operatorTokenX: operatorTokenX.address,
          ownerTokenX: ownerTokenX.address,
          owner: customFeeOwnerPositionOwner.publicKey,
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

      const position = await program.account.positionV2.fetch(
        customFeeOwnerPosition
      );

      console.log("Add liquidity by strategy");

      let addLiquidityTx = await pair.addLiquidityByStrategy({
        positionPubKey: customFeeOwnerPosition,
        totalXAmount: new BN(0),
        totalYAmount: usdcInAmount,
        strategy: {
          strategyType: StrategyType.Spot,
          minBinId: position.lowerBinId,
          maxBinId: pair.lbPair.activeId - 1,
        },
        user: keypair.publicKey,
        slippage: 0,
      });

      await sendAndConfirmTransaction(connection, addLiquidityTx, [keypair]);

      addLiquidityTx = await pair.addLiquidityByStrategy({
        positionPubKey: customFeeOwnerPosition,
        totalXAmount: btcInAmount,
        totalYAmount: new BN(0),
        strategy: {
          strategyType: StrategyType.Spot,
          minBinId: pair.lbPair.activeId,
          maxBinId: position.upperBinId,
        },
        user: keypair.publicKey,
        slippage: 0,
      });

      await pair.refetchStates();
    });

    it("Normal position add only buy side", async () => {
      const minBinId = pair.lbPair.activeId - MAX_BIN_PER_POSITION.toNumber();
      const maxBinId = pair.lbPair.activeId - 1;

      const initPositionAddLiquidityTx =
        await pair.initializePositionAndAddLiquidityByStrategy({
          positionPubKey: normalPosition.publicKey,
          totalXAmount: new BN(0),
          totalYAmount: usdcInAmount,
          strategy: {
            strategyType: StrategyType.Spot,
            maxBinId,
            minBinId,
          },
          user: keypair.publicKey,
          slippage: 0,
        });

      await sendAndConfirmTransaction(connection, initPositionAddLiquidityTx, [
        keypair,
        normalPosition,
      ]);

      const positionAccount = await connection.getAccountInfo(
        normalPosition.publicKey
      );

      const position = wrapPosition(
        pair.program,
        normalPosition.publicKey,
        positionAccount
      );

      const lowerBinId = position.lowerBinId();
      const upperBinId = position.upperBinId();
      const share = position.liquidityShares();

      for (let i = lowerBinId.toNumber(); i <= upperBinId.toNumber(); i++) {
        const idx = i - lowerBinId.toNumber();
        if (i < pair.lbPair.activeId) {
          expect(share[idx].isZero()).toBeFalsy();
        } else {
          expect(share[idx].isZero()).toBeTruthy();
        }
      }
    });

    it("update activation point", async () => {
      try {
        const currentSlot = await connection.getSlot();
        const activationPoint = new BN(currentSlot + 10);
        const rawTx = await pair.setActivationPoint(new BN(currentSlot + 10));
        const txHash = await sendAndConfirmTransaction(connection, rawTx, [
          keypair,
        ]);
        console.log("Update activation point", txHash);
        expect(txHash).not.toBeNull();

        await pair.refetchStates();

        const pairState = pair.lbPair;
        expect(pairState.activationPoint.eq(activationPoint)).toBeTruthy();
      } catch (error) {
        console.log(JSON.parse(JSON.stringify(error)));
      }
    });

    it("normal position add liquidity both side with full position width after activation", async () => {
      while (true) {
        const currentSlot = await connection.getSlot();
        if (currentSlot >= pair.lbPair.activationPoint.toNumber()) {
          break;
        } else {
          await new Promise((res) => setTimeout(res, 1000));
        }
      }

      const positionV2 = await pair.program.account.positionV2.fetch(
        normalPosition.publicKey
      );

      const addLiquidityTx = await pair.addLiquidityByStrategy({
        positionPubKey: normalPosition.publicKey,
        totalXAmount: btcInAmount,
        totalYAmount: usdcInAmount,
        strategy: {
          strategyType: StrategyType.Spot,
          minBinId: positionV2.lowerBinId,
          maxBinId: positionV2.upperBinId,
        },
        user: keypair.publicKey,
        slippage: 0,
      });

      await sendAndConfirmTransaction(connection, addLiquidityTx, [keypair]);

      const positionAccount = await connection.getAccountInfo(
        normalPosition.publicKey
      );

      const position = wrapPosition(
        pair.program,
        normalPosition.publicKey,
        positionAccount
      );

      const lowerBinId = position.lowerBinId();
      const upperBinId = position.upperBinId();
      const share = position.liquidityShares();

      for (let i = lowerBinId.toNumber(); i <= upperBinId.toNumber(); i++) {
        const idx = i - lowerBinId.toNumber();
        expect(share[idx].isZero()).toBeFalsy();
      }
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
        inAmount: new BN(10000000),
        outToken: USDC,
        minOutAmount: new BN(0),
        user: keypair.publicKey,
        inToken: BTC,
        lbPair: pair.pubkey,
        binArraysPubkey: [activeBinArray],
      });

      await sendAndConfirmTransaction(connection, swapTx, [keypair]);

      swapTx = await pair.swap({
        inAmount: new BN(100).mul(new BN(10 ** usdcDecimal)),
        outToken: BTC,
        minOutAmount: new BN(0),
        user: keypair.publicKey,
        inToken: USDC,
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

      const positionV2 = await pair.program.account.positionV2.fetch(
        customFeeOwnerPosition
      );

      const removeLiquidityTx = await pair.removeLiquidity({
        user: customFeeOwnerPositionOwner.publicKey,
        fromBinId: positionV2.lowerBinId,
        toBinId: positionV2.upperBinId,
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

      const positionV2 = await pair.program.account.positionV2.fetch(
        normalPosition.publicKey
      );

      const removeLiquidityTx = await pair.removeLiquidity({
        user: keypair.publicKey,
        fromBinId: positionV2.lowerBinId,
        toBinId: positionV2.upperBinId,
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

  it("create LB pair", async () => {
    try {
      const rawTx = await DLMM.createLbPair(
        connection,
        keypair.publicKey,
        BTC,
        USDC,
        new BN(DEFAULT_BIN_STEP),
        new BN(DEFAULT_BASE_FACTOR),
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
    const { presetParameter } = await DLMM.getAllPresetParameters(connection, {
      cluster: "localhost",
    });

    expect(presetParameter.length).toBeGreaterThan(0);
  });

  it("create LB pair with bitmap extension", async () => {
    try {
      const rawTx = await DLMM.createLbPair(
        connection,
        keypair.publicKey,
        NATIVE_MINT,
        USDC,
        new BN(DEFAULT_BIN_STEP),
        new BN(DEFAULT_BASE_FACTOR_2),
        presetParamPda2,
        ACTIVE_ID_OUT_OF_RANGE,
        { cluster: "localhost" }
      );
      const txHash = await sendAndConfirmTransaction(connection, rawTx, [
        keypair,
      ]);
      expect(txHash).not.toBeNull();
      console.log("Create LB pair with bitmap extension", txHash);
    } catch (error) {
      console.log("🚀 ~ it ~ error:", JSON.parse(JSON.stringify(error)));
    }
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
    await lbClmm.refetchStates();
    const btcInAmount = new BN(1).mul(new BN(10 ** btcDecimal));
    const usdcInAmount = new BN(24000).mul(new BN(10 ** usdcDecimal));

    const minBinId = lbClmm.lbPair.activeId - 5;
    const maxBinId = lbClmm.lbPair.activeId + 5;

    const rawTxs = await lbClmm.initializePositionAndAddLiquidityByStrategy({
      user: keypair.publicKey,
      positionPubKey: positionKeypair.publicKey,
      totalXAmount: btcInAmount,
      totalYAmount: usdcInAmount,
      strategy: {
        minBinId,
        maxBinId,
        strategyType: StrategyType.Curve,
      },
    });

    if (Array.isArray(rawTxs)) {
      for (const rawTx of rawTxs) {
        // Do not alter the order of the signers. Some weird bug from solana where it keep throwing error about positionKeypair has no balance.
        const txHash = await sendAndConfirmTransaction(connection, rawTx, [
          keypair,
          positionKeypair,
        ]);
        expect(txHash).not.toBeNull();
        console.log("Create bin arrays, position, and add liquidity", txHash);
      }
    } else {
      // console.log(rawTxs.instructions);
      const txHash = await sendAndConfirmTransaction(connection, rawTxs, [
        keypair,
        positionKeypair,
      ]);
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
    expect(positionBinWithLiquidity.length).toBe(maxBinId - minBinId + 1);
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
    describe("Swap exact in", () => {
      let btcInAmount: BN;
      let usdcInAmount: BN;
      let quotedOutAmount: BN;
      let actualOutAmount: BN;
      let binArraysPubkeyForSwap: PublicKey[];

      beforeEach(async () => {
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

    describe("Swap exact out", () => {
      let outAmount: BN;
      let quotedInAmount: BN;
      let binArraysPubkeyForSwap: PublicKey[];
      let quotedMaxInAmount: BN;
      let quotedInFee: BN;
      let actualOutAmount: BN;
      let actualInAmount: BN;

      beforeEach(async () => {
        await lbClmm.refetchStates();
      });

      it("quote X -> Y", async () => {
        outAmount = new BN(0);
        const bins = await lbClmm.getBinsBetweenLowerAndUpperBound(
          lbClmm.lbPair.activeId,
          lbClmm.lbPair.activeId
        );

        const activeBin = bins.bins.pop();
        const halfTokenYAmount = new BN(activeBin.yAmount.div(new BN(2)));
        outAmount = halfTokenYAmount;
        const binArrays = await lbClmm.getBinArrays();

        const {
          fee,
          inAmount,
          maxInAmount,
          protocolFee,
          binArraysPubkey,
          priceImpact,
        } = lbClmm.swapQuoteExactOut(outAmount, true, new BN(5), binArrays);

        expect(inAmount.toString()).not.toEqual("0");
        expect(fee.toString()).not.toEqual("0");
        expect(protocolFee.toString()).toEqual("0");
        expect(binArraysPubkey.length).toBeGreaterThan(0);
        expect(priceImpact.toNumber()).toBe(0);

        binArraysPubkeyForSwap = binArraysPubkey;
        quotedMaxInAmount = maxInAmount;
        quotedInFee = fee;
        quotedInAmount = inAmount;
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

        const rawTx = await lbClmm.swapExactOut({
          maxInAmount: quotedMaxInAmount.add(quotedInFee),
          inToken: BTC,
          outToken: USDC,
          outAmount,
          user: keypair.publicKey,
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
        actualInAmount = beforeBtc.sub(afterBtc);
      });

      it("quote matches actual swap result (X -> Y)", () => {
        expect(actualOutAmount.toString()).toBe(outAmount.toString());
        expect(actualInAmount.toString()).toBe(quotedInAmount.toString());
      });

      it("quote Y -> X", async () => {
        outAmount = new BN(0);
        const bins = await lbClmm.getBinsBetweenLowerAndUpperBound(
          lbClmm.lbPair.activeId,
          lbClmm.lbPair.activeId
        );

        const activeBin = bins.bins.pop();
        const halfTokenXAmount = new BN(activeBin.xAmount.div(new BN(2)));
        outAmount = halfTokenXAmount;
        const binArrays = await lbClmm.getBinArrays();

        const {
          fee,
          inAmount,
          maxInAmount,
          protocolFee,
          binArraysPubkey,
          priceImpact,
        } = lbClmm.swapQuoteExactOut(outAmount, false, new BN(5), binArrays);

        expect(inAmount.toString()).not.toEqual("0");
        expect(fee.toString()).not.toEqual("0");
        expect(protocolFee.toString()).toEqual("0");
        expect(binArraysPubkey.length).toBeGreaterThan(0);
        expect(priceImpact.toNumber()).toBe(0);

        binArraysPubkeyForSwap = binArraysPubkey;
        quotedMaxInAmount = maxInAmount;
        quotedInFee = fee;
        quotedInAmount = inAmount;
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

        const rawTx = await lbClmm.swapExactOut({
          maxInAmount: quotedMaxInAmount.add(quotedInFee),
          inToken: USDC,
          outToken: BTC,
          outAmount,
          user: keypair.publicKey,
          lbPair: lbPairPubkey,
          binArraysPubkey: binArraysPubkeyForSwap,
        });

        const txHash = await sendAndConfirmTransaction(connection, rawTx, [
          keypair,
        ]).catch((err) => {
          console.error(err);
          throw err;
        });

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
        actualInAmount = beforeUsdc.sub(afterUsdc);
      });

      it("quote matches actual swap result (Y -> X)", () => {
        expect(actualOutAmount.toString()).toBe(outAmount.toString());
        expect(actualInAmount.toString()).toBe(quotedInAmount.toString());
      });
    });
  });

  describe("Swap with 2 bin", () => {
    describe("Swap exact in", () => {
      let btcInAmount: BN;
      let usdcInAmount: BN;
      let quotedOutAmount: BN;
      let actualOutAmount: BN;
      let binArraysPubkeyForSwap: PublicKey[];

      beforeEach(async () => {
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

    describe("Swap exact out", () => {
      let outAmount: BN;
      let quotedInAmount: BN;
      let binArraysPubkeyForSwap: PublicKey[];
      let quotedMaxInAmount: BN;
      let quotedInFee: BN;
      let actualOutAmount: BN;
      let actualInAmount: BN;

      beforeEach(async () => {
        await lbClmm.refetchStates();
      });

      it("quote X -> Y", async () => {
        outAmount = new BN(0);
        const { bins } = await lbClmm.getBinsBetweenLowerAndUpperBound(
          lbClmm.lbPair.activeId - 1,
          lbClmm.lbPair.activeId
        );

        const sortedBins = bins.sort((a, b) => b.binId - a.binId);

        const activeBin = sortedBins.pop();
        outAmount = outAmount.add(activeBin.yAmount);
        const beforeActiveBin = sortedBins.pop();
        outAmount = outAmount.add(beforeActiveBin.yAmount.div(new BN(2)));

        const binArrays = await lbClmm.getBinArrays();

        const {
          fee,
          inAmount,
          maxInAmount,
          protocolFee,
          binArraysPubkey,
          priceImpact,
        } = lbClmm.swapQuoteExactOut(outAmount, true, new BN(5), binArrays);

        expect(inAmount.toString()).not.toEqual("0");
        expect(fee.toString()).not.toEqual("0");
        expect(protocolFee.toString()).toEqual("0");
        expect(binArraysPubkey.length).toBeGreaterThan(0);
        expect(priceImpact.toNumber()).toBeGreaterThan(0);

        binArraysPubkeyForSwap = binArraysPubkey;
        quotedMaxInAmount = maxInAmount;
        quotedInFee = fee;
        quotedInAmount = inAmount;
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

        const rawTx = await lbClmm.swapExactOut({
          maxInAmount: quotedMaxInAmount.add(quotedInFee),
          inToken: BTC,
          outToken: USDC,
          outAmount,
          user: keypair.publicKey,
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
        actualInAmount = beforeBtc.sub(afterBtc);
      });

      it("quote matches actual swap result (X -> Y)", () => {
        expect(actualOutAmount.toString()).toBe(outAmount.toString());
        expect(actualInAmount.toString()).toBe(quotedInAmount.toString());
      });

      it("quote Y -> X", async () => {
        outAmount = new BN(0);
        const { bins } = await lbClmm.getBinsBetweenLowerAndUpperBound(
          lbClmm.lbPair.activeId,
          lbClmm.lbPair.activeId + 1
        );

        const sortedBins = bins.sort((a, b) => a.binId - b.binId);

        const activeBin = sortedBins.pop();
        outAmount = outAmount.add(activeBin.xAmount);
        const afterActiveBin = sortedBins.pop();
        outAmount = outAmount.add(afterActiveBin.xAmount.div(new BN(2)));

        const binArrays = await lbClmm.getBinArrays();

        const {
          fee,
          inAmount,
          maxInAmount,
          protocolFee,
          binArraysPubkey,
          priceImpact,
        } = lbClmm.swapQuoteExactOut(outAmount, false, new BN(5), binArrays);

        expect(inAmount.toString()).not.toEqual("0");
        expect(fee.toString()).not.toEqual("0");
        expect(protocolFee.toString()).toEqual("0");
        expect(binArraysPubkey.length).toBeGreaterThan(0);
        expect(priceImpact.toNumber()).toBeGreaterThan(0);

        binArraysPubkeyForSwap = binArraysPubkey;
        quotedMaxInAmount = maxInAmount;
        quotedInFee = fee;
        quotedInAmount = inAmount;
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

        const rawTx = await lbClmm.swapExactOut({
          maxInAmount: quotedMaxInAmount.add(quotedInFee),
          inToken: USDC,
          outToken: BTC,
          outAmount,
          user: keypair.publicKey,
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
        actualInAmount = beforeUsdc.sub(afterUsdc);
      });

      it("quote matches actual swap result (Y -> X)", () => {
        expect(actualOutAmount.toString()).toBe(outAmount.toString());
        expect(actualInAmount.toString()).toBe(quotedInAmount.toString());
      });
    });
  });
});

describe("SDK Test with Mainnet RPC", () => {
  let mainnetRpc: string =
    process.env.RPC || "https://api.mainnet-beta.solana.com";
  let connection: Connection;

  beforeAll(async () => {
    connection = new Connection(mainnetRpc);
  });

  it("quote X -> Y with maxExtraBinArrays", async () => {
    const pair = new PublicKey("5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6");
    const lbPair = await DLMM.create(connection, pair);
    const swapForY = true;
    const inAmount = new BN(1 * 10 ** 9);
    const allowedSlippage = new BN(2);
    const isPartialFill = false;

    const binArrays = await lbPair.getBinArrayForSwap(swapForY);
    expect(binArrays.length).toBeGreaterThan(1);
    let quote = lbPair.swapQuote(
      inAmount,
      swapForY,
      allowedSlippage,
      binArrays,
      isPartialFill,
      0
    );
    expect(quote.binArraysPubkey.length).toEqual(1);
    const binArrayToSwapPubkey = quote.binArraysPubkey[0];
    const binArrayToSwap = await lbPair.program.account.binArray.fetch(
      binArrayToSwapPubkey
    );

    quote = lbPair.swapQuote(
      inAmount,
      swapForY,
      allowedSlippage,
      binArrays,
      isPartialFill,
      3
    );
    expect(quote.binArraysPubkey.length).toEqual(4);

    // expect binArrays are in correct order
    expect(quote.binArraysPubkey[0]).toEqual(binArrayToSwapPubkey);

    let lastBinArrayIdx = binArrayToSwap.index;
    for (let i = 1; i < binArrays.length; i++) {
      let assertBinArrayPubkey = quote.binArraysPubkey[i];

      const assertBinArray = await lbPair.program.account.binArray.fetch(
        assertBinArrayPubkey
      );
      console.log(assertBinArray.index);
      if (swapForY) {
        expect(assertBinArray.index).toEqual(lastBinArrayIdx.sub(new BN(1)));
      } else {
        expect(assertBinArray.index).toEqual(lastBinArrayIdx.add(new BN(1)));
      }

      lastBinArrayIdx = assertBinArray.index;
    }
  });

  it("quote Y -> X with maxExtraBinArrays", async () => {
    const pair = new PublicKey("5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6");
    const lbPair = await DLMM.create(connection, pair);
    const swapForY = true;
    const inAmount = new BN(1_000 * 10 ** 6);
    const allowedSlippage = new BN(2);
    const isPartialFill = false;

    const binArrays = await lbPair.getBinArrayForSwap(swapForY);
    expect(binArrays.length).toBeGreaterThan(1);
    let quote = lbPair.swapQuote(
      inAmount,
      swapForY,
      allowedSlippage,
      binArrays,
      isPartialFill,
      0
    );
    expect(quote.binArraysPubkey.length).toEqual(1);

    const binArrayToSwapPubkey = quote.binArraysPubkey[0];
    const binArrayToSwap = await lbPair.program.account.binArray.fetch(
      binArrayToSwapPubkey
    );

    quote = lbPair.swapQuote(
      inAmount,
      swapForY,
      allowedSlippage,
      binArrays,
      isPartialFill,
      3
    );
    expect(quote.binArraysPubkey.length).toEqual(4);

    // expect binArrays are in correct order
    expect(quote.binArraysPubkey[0]).toEqual(binArrayToSwapPubkey);

    let lastBinArrayIdx = binArrayToSwap.index;
    for (let i = 1; i < binArrays.length; i++) {
      let assertBinArrayPubkey = quote.binArraysPubkey[i];

      const assertBinArray = await lbPair.program.account.binArray.fetch(
        assertBinArrayPubkey
      );
      console.log(assertBinArray.index);
      if (swapForY) {
        expect(assertBinArray.index).toEqual(lastBinArrayIdx.sub(new BN(1)));
      } else {
        expect(assertBinArray.index).toEqual(lastBinArrayIdx.add(new BN(1)));
      }

      lastBinArrayIdx = assertBinArray.index;
    }
  });
});
