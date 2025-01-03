import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  createInitializeTransferHookInstruction,
  createMint,
  ExtensionType,
  getAssociatedTokenAddressSync,
  getMintLen,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackAccount,
} from "@solana/spl-token";
import {
  AccountInfo,
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
import fs from "fs";
import { DLMM } from "../dlmm";
import { LBCLMM_PROGRAM_IDS } from "../dlmm/constants";
import {
  deriveCustomizablePermissionlessLbPair,
  deriveLbPairWithPresetParamWithIndexKey,
  derivePermissionLbPair,
  derivePresetParameterWithIndex,
  deriveRewardVault,
  deriveTokenBadge,
  toAmountsBothSideByStrategy,
} from "../dlmm/helpers";
import { IDL } from "../dlmm/idl";
import { ActivationType, ResizeSide, StrategyType } from "../dlmm/types";
import { createExtraAccountMetaListAndCounter } from "./external/helper";
import {
  createTransferHookCounterProgram,
  TRANSFER_HOOK_COUNTER_PROGRAM_ID,
} from "./external/program";
import Decimal from "decimal.js";

const keypairBuffer = fs.readFileSync(
  "../keys/localnet/admin-bossj3JvwiNK7pvjr149DqdtJxf2gdygbcmEPTkb2F1.json",
  "utf-8"
);
const connection = new Connection("http://127.0.0.1:8899", "confirmed");
const keypair = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(keypairBuffer))
);

const btcDecimal = 6;
const usdcDecimal = 6;
const metDecimal = 6;

const BTCKeypair = Keypair.generate();
const USDCKeypair = Keypair.generate();
const METKeypair = Keypair.generate();

const BTC2022 = BTCKeypair.publicKey;
const USDC = USDCKeypair.publicKey;
const MET2022 = METKeypair.publicKey;

const transferFeeBps = 500; // 5%
const maxFee = BigInt(100_000) * BigInt(10 ** btcDecimal);

let presetParameter2Key: PublicKey;
let pairKey: PublicKey;

const provider = new AnchorProvider(
  connection,
  new Wallet(keypair),
  AnchorProvider.defaultOptions()
);
const program = new Program(IDL, LBCLMM_PROGRAM_IDS["localhost"], provider);

const widePositionKeypair = Keypair.generate();
const tightPositionKeypair = Keypair.generate();

type Opt = {
  cluster?: Cluster | "localhost";
  programId?: PublicKey;
};

const opt: Opt = {
  cluster: "localhost",
};

describe("SDK token2022 test", () => {
  // Token setup
  beforeAll(async () => {
    const airdropSig = await connection.requestAirdrop(
      keypair.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSig, "confirmed");

    await createMint(
      connection,
      keypair,
      keypair.publicKey,
      null,
      usdcDecimal,
      USDCKeypair,
      {
        commitment: "confirmed",
      }
    );

    const userUsdcAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      keypair,
      USDC,
      keypair.publicKey,
      true,
      "confirmed",
      {
        commitment: "confirmed",
      },
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const userUsdcAta = userUsdcAccount.address;

    await mintTo(
      connection,
      keypair,
      USDC,
      userUsdcAta,
      keypair,
      BigInt(1_000_000_000) * BigInt(10 ** usdcDecimal),
      [],
      {
        commitment: "confirmed",
      },
      TOKEN_PROGRAM_ID
    );

    const extensions = [
      ExtensionType.TransferFeeConfig,
      ExtensionType.TransferHook,
    ];

    const mintLen = getMintLen(extensions);
    const minLamports = await connection.getMinimumBalanceForRentExemption(
      mintLen
    );

    const createBtcTx = new Transaction()
      .add(
        SystemProgram.createAccount({
          fromPubkey: keypair.publicKey,
          newAccountPubkey: BTCKeypair.publicKey,
          space: mintLen,
          lamports: minLamports,
          programId: TOKEN_2022_PROGRAM_ID,
        })
      )
      .add(
        createInitializeTransferFeeConfigInstruction(
          BTC2022,
          keypair.publicKey,
          keypair.publicKey,
          transferFeeBps,
          maxFee,
          TOKEN_2022_PROGRAM_ID
        )
      )
      .add(
        createInitializeTransferHookInstruction(
          BTC2022,
          keypair.publicKey,
          TRANSFER_HOOK_COUNTER_PROGRAM_ID,
          TOKEN_2022_PROGRAM_ID
        )
      )
      .add(
        createInitializeMintInstruction(
          BTC2022,
          btcDecimal,
          keypair.publicKey,
          null,
          TOKEN_2022_PROGRAM_ID
        )
      );

    await sendAndConfirmTransaction(
      connection,
      createBtcTx,
      [keypair, BTCKeypair],
      { commitment: "confirmed" }
    );

    const transferHookCounterProgram = createTransferHookCounterProgram(
      new Wallet(keypair),
      TRANSFER_HOOK_COUNTER_PROGRAM_ID,
      connection
    );

    await createExtraAccountMetaListAndCounter(
      transferHookCounterProgram,
      BTC2022
    );

    const userBtcAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      keypair,
      BTC2022,
      keypair.publicKey,
      true,
      "confirmed",
      {
        commitment: "confirmed",
      },
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const userBtcAta = userBtcAccount.address;

    await mintTo(
      connection,
      keypair,
      BTC2022,
      userBtcAta,
      keypair,
      BigInt(1_000_000_000) * BigInt(10 ** btcDecimal),
      [],
      {
        commitment: "confirmed",
      },
      TOKEN_2022_PROGRAM_ID
    );

    const createMetTx = new Transaction()
      .add(
        SystemProgram.createAccount({
          fromPubkey: keypair.publicKey,
          newAccountPubkey: METKeypair.publicKey,
          space: mintLen,
          lamports: minLamports,
          programId: TOKEN_2022_PROGRAM_ID,
        })
      )
      .add(
        createInitializeTransferFeeConfigInstruction(
          MET2022,
          keypair.publicKey,
          keypair.publicKey,
          transferFeeBps,
          maxFee,
          TOKEN_2022_PROGRAM_ID
        )
      )
      .add(
        createInitializeTransferHookInstruction(
          MET2022,
          keypair.publicKey,
          TRANSFER_HOOK_COUNTER_PROGRAM_ID,
          TOKEN_2022_PROGRAM_ID
        )
      )
      .add(
        createInitializeMintInstruction(
          MET2022,
          metDecimal,
          keypair.publicKey,
          null,
          TOKEN_2022_PROGRAM_ID
        )
      );

    await sendAndConfirmTransaction(
      connection,
      createMetTx,
      [keypair, METKeypair],
      { commitment: "confirmed" }
    );

    const userMetAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      keypair,
      MET2022,
      keypair.publicKey,
      true,
      "confirmed",
      {
        commitment: "confirmed",
      },
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const userMetAta = userMetAccount.address;

    await mintTo(
      connection,
      keypair,
      MET2022,
      userMetAta,
      keypair,
      BigInt(1_000_000_000) * BigInt(10 ** metDecimal),
      [],
      {
        commitment: "confirmed",
      },
      TOKEN_2022_PROGRAM_ID
    );
  });

  // DLMM related setup
  beforeAll(async () => {
    const presetParameter2 = await program.account.presetParameter2.all();
    const idx = presetParameter2.length;

    [presetParameter2Key] = derivePresetParameterWithIndex(
      new BN(idx),
      program.programId
    );

    await program.methods
      .initializePresetParameter2({
        index: idx,
        binStep: 10,
        baseFactor: 10_000,
        filterPeriod: 30,
        decayPeriod: 600,
        reductionFactor: 5000,
        variableFeeControl: 40000,
        protocolShare: 0,
        maxVolatilityAccumulator: 350000,
        baseFeePowerFactor: 1,
      })
      .accounts({
        presetParameter: presetParameter2Key,
        admin: keypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const [btcTokenBadge] = deriveTokenBadge(BTC2022, program.programId);

    await program.methods
      .initializeTokenBadge()
      .accounts({
        tokenBadge: btcTokenBadge,
        admin: keypair.publicKey,
        systemProgram: SystemProgram.programId,
        tokenMint: BTC2022,
      })
      .rpc();

    const [metTokenBadge] = deriveTokenBadge(MET2022, program.programId);

    await program.methods
      .initializeTokenBadge()
      .accounts({
        tokenBadge: metTokenBadge,
        admin: keypair.publicKey,
        systemProgram: SystemProgram.programId,
        tokenMint: MET2022,
      })
      .rpc();
  });

  it("getAllPresetParameters return created preset parameter 2", async () => {
    const { presetParameter2 } = await DLMM.getAllPresetParameters(
      connection,
      opt
    );

    expect(presetParameter2.length).toBeGreaterThan(0);
  });

  describe("Pair", () => {
    it("createPermissionPair with token 2022", async () => {
      const binStep = new BN(1);
      const feeBps = new BN(100);
      const protocolFeeBps = new BN(500);
      const activeId = new BN(0);

      const createPermissionPairTx = await DLMM.createPermissionLbPair(
        connection,
        binStep,
        BTC2022,
        USDC,
        activeId,
        keypair.publicKey,
        keypair.publicKey,
        feeBps,
        ActivationType.Timestamp,
        protocolFeeBps,
        opt
      );

      await sendAndConfirmTransaction(connection, createPermissionPairTx, [
        keypair,
      ]);

      const [pairKey] = derivePermissionLbPair(
        keypair.publicKey,
        BTC2022,
        USDC,
        binStep,
        program.programId
      );

      const dlmm = await DLMM.create(connection, pairKey, opt);

      const feeInfo = dlmm.getFeeInfo();
      expect(feeInfo.baseFeeRatePercentage.toNumber()).toBe(1);
      expect(feeInfo.protocolFeePercentage.toNumber()).toBe(5);
    });

    it("createLbPair2 with token 2022", async () => {
      const activeId = new BN(0);

      const createLbPair2Tx = await DLMM.createLbPair2(
        connection,
        keypair.publicKey,
        BTC2022,
        USDC,
        presetParameter2Key,
        activeId,
        opt
      );

      await sendAndConfirmTransaction(connection, createLbPair2Tx, [keypair], {
        commitment: "confirmed",
      });

      [pairKey] = deriveLbPairWithPresetParamWithIndexKey(
        presetParameter2Key,
        BTC2022,
        USDC,
        program.programId
      );

      const dlmm = await DLMM.create(connection, pairKey, opt);

      const feeInfo = dlmm.getFeeInfo();
      expect(feeInfo.baseFeeRatePercentage.toNumber()).toBe(1);
      expect(dlmm.lbPair.binStep).toBe(10);
    });

    it("createCustomizablePermissionlessLbPair2 with token 2022", async () => {
      const binStep = new BN(1);
      const activeId = new BN(0);
      const feeBps = new BN(150);

      const createCustomizablePermissionlessLbPair2Tx =
        await DLMM.createCustomizablePermissionlessLbPair2(
          connection,
          binStep,
          BTC2022,
          USDC,
          activeId,
          feeBps,
          ActivationType.Timestamp,
          false,
          keypair.publicKey,
          null,
          opt
        );

      await sendAndConfirmTransaction(
        connection,
        createCustomizablePermissionlessLbPair2Tx,
        [keypair]
      );

      const [pairKey] = deriveCustomizablePermissionlessLbPair(
        BTC2022,
        USDC,
        program.programId
      );

      const dlmm = await DLMM.create(connection, pairKey, opt);

      const feeInfo = dlmm.getFeeInfo();
      expect(feeInfo.baseFeeRatePercentage.toNumber()).toBe(1.5);
      expect(feeInfo.protocolFeePercentage.toNumber()).toBe(20);
    });

    it("getPairPubkeyIfExists return pair permissionless pair pubkey", async () => {
      const dlmm = await DLMM.create(connection, pairKey, opt);

      const pairPubkey = await DLMM.getPairPubkeyIfExists(
        connection,
        dlmm.lbPair.tokenXMint,
        dlmm.lbPair.tokenYMint,
        new BN(dlmm.lbPair.binStep),
        new BN(dlmm.lbPair.parameters.baseFactor),
        new BN(dlmm.lbPair.parameters.baseFeePowerFactor),
        opt
      );

      expect(pairPubkey.toBase58()).toBe(pairKey.toBase58());
    });

    it("createMultiple works", async () => {
      const lbPairs = await DLMM.getLbPairs(connection, opt);

      const dlmms = await DLMM.createMultiple(
        connection,
        lbPairs.map((x) => x.publicKey),
        opt
      );

      for (let i = 0; i < lbPairs.length; i++) {
        const dlmm = dlmms[i];
        const lbPair = lbPairs[i];

        expect(dlmm.pubkey.toBase58()).toBe(lbPair.publicKey.toBase58());
        expect(dlmm.tokenX.publicKey.toBase58()).toBe(
          lbPair.account.tokenXMint.toBase58()
        );
        expect(dlmm.tokenY.publicKey.toBase58()).toBe(
          lbPair.account.tokenYMint.toBase58()
        );
      }
    });
  });

  describe("Position management", () => {
    beforeAll(async () => {
      const rewardIndex = new BN(0);
      const rewardDuration = new BN(3600);
      const funder = keypair.publicKey;

      const [rewardVault] = deriveRewardVault(
        pairKey,
        rewardIndex,
        program.programId
      );

      const [tokenBadge] = deriveTokenBadge(MET2022, program.programId);

      await program.methods
        .initializeReward(rewardIndex, rewardDuration, funder)
        .accounts({
          lbPair: pairKey,
          rewardMint: MET2022,
          rewardVault,
          admin: keypair.publicKey,
          tokenBadge,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

    it("createEmptyPosition", async () => {
      const dlmm = await DLMM.create(connection, pairKey, opt);

      const minBinId = -30;
      const maxBinId = 30;

      const createPositionAndBinArraysTx = await dlmm.createEmptyPosition({
        positionPubKey: widePositionKeypair.publicKey,
        minBinId,
        maxBinId,
        user: keypair.publicKey,
      });

      await sendAndConfirmTransaction(
        connection,
        createPositionAndBinArraysTx,
        [keypair, widePositionKeypair]
      );

      const position = await dlmm.getPosition(widePositionKeypair.publicKey);
      expect(position.publicKey.toBase58()).toBe(
        widePositionKeypair.publicKey.toBase58()
      );

      const { positionData } = position;
      expect(positionData.lowerBinId).toBe(minBinId);
      expect(positionData.upperBinId).toBe(maxBinId);

      const binCount = maxBinId - minBinId + 1;
      expect(positionData.positionBinData.length).toBe(binCount);
    });

    it("increasePositionLength", async () => {
      const lengthToAdd = 30;

      const dlmm = await DLMM.create(connection, pairKey, opt);

      let before = await dlmm.getPosition(widePositionKeypair.publicKey);

      const increaseBuySideLengthTx = await dlmm.increasePositionLength({
        lengthToAdd: new BN(lengthToAdd),
        position: widePositionKeypair.publicKey,
        payer: keypair.publicKey,
        side: ResizeSide.Lower,
      });

      await sendAndConfirmTransaction(connection, increaseBuySideLengthTx, [
        keypair,
      ]);

      let after = await dlmm.getPosition(widePositionKeypair.publicKey);
      let { positionData } = after;
      expect(positionData.lowerBinId).toBe(
        before.positionData.lowerBinId - lengthToAdd
      );
      expect(positionData.upperBinId).toBe(before.positionData.upperBinId);

      let binCount = positionData.upperBinId - positionData.lowerBinId + 1;
      expect(positionData.positionBinData.length).toBe(binCount);

      before = after;

      const increaseSellSideLengthTx = await dlmm.increasePositionLength({
        lengthToAdd: new BN(lengthToAdd),
        position: widePositionKeypair.publicKey,
        payer: keypair.publicKey,
        side: ResizeSide.Upper,
      });

      await sendAndConfirmTransaction(connection, increaseSellSideLengthTx, [
        keypair,
      ]);

      after = await dlmm.getPosition(widePositionKeypair.publicKey);
      ({ positionData } = after);
      expect(positionData.lowerBinId).toBe(before.positionData.lowerBinId);
      expect(positionData.upperBinId).toBe(
        before.positionData.upperBinId + lengthToAdd
      );

      binCount = positionData.upperBinId - positionData.lowerBinId + 1;
      expect(positionData.positionBinData.length).toBe(binCount);
    });

    it("decreasePositionLength", async () => {
      const lengthToReduce = 5;

      const dlmm = await DLMM.create(connection, pairKey, opt);

      let before = await dlmm.getPosition(widePositionKeypair.publicKey);

      const decreaseBuySideLengthTx = await dlmm.decreasePositionLength({
        lengthToReduce: new BN(lengthToReduce),
        position: widePositionKeypair.publicKey,
        feePayer: keypair.publicKey,
        side: ResizeSide.Lower,
      });

      await sendAndConfirmTransaction(connection, decreaseBuySideLengthTx, [
        keypair,
      ]);

      let after = await dlmm.getPosition(widePositionKeypair.publicKey);
      let { positionData } = after;
      expect(positionData.lowerBinId).toBe(
        before.positionData.lowerBinId + lengthToReduce
      );
      expect(positionData.upperBinId).toBe(before.positionData.upperBinId);

      let binCount = positionData.upperBinId - positionData.lowerBinId + 1;
      expect(positionData.positionBinData.length).toBe(binCount);

      before = after;

      const decreaseSellSideLengthTx = await dlmm.decreasePositionLength({
        lengthToReduce: new BN(lengthToReduce),
        position: widePositionKeypair.publicKey,
        feePayer: keypair.publicKey,
        side: ResizeSide.Upper,
      });

      await sendAndConfirmTransaction(connection, decreaseSellSideLengthTx, [
        keypair,
      ]);

      after = await dlmm.getPosition(widePositionKeypair.publicKey);
      ({ positionData } = after);
      expect(positionData.lowerBinId).toBe(before.positionData.lowerBinId);
      expect(positionData.upperBinId).toBe(
        before.positionData.upperBinId - lengthToReduce
      );

      binCount = positionData.upperBinId - positionData.lowerBinId + 1;
      expect(positionData.positionBinData.length).toBe(binCount);
    });
  });

  describe("Add liquidity", () => {
    it("Add liquidity by strategy", async () => {
      const totalXAmount = new BN(100_000).mul(new BN(10 ** btcDecimal));
      const totalYAmount = new BN(100_000).mul(new BN(10 ** usdcDecimal));

      const dlmm = await DLMM.create(connection, pairKey, opt);
      let position = await dlmm.getPosition(widePositionKeypair.publicKey);

      const activeBinInfo = await dlmm.getActiveBin();

      const computedInBinAmount = toAmountsBothSideByStrategy(
        dlmm.lbPair.activeId,
        dlmm.lbPair.binStep,
        position.positionData.lowerBinId,
        position.positionData.upperBinId,
        totalXAmount,
        totalYAmount,
        activeBinInfo.xAmount,
        activeBinInfo.yAmount,
        StrategyType.SpotImBalanced,
        dlmm.tokenX.mint,
        dlmm.tokenY.mint,
        dlmm.clock
      );

      const addLiquidityTx = await dlmm.addLiquidityByStrategy({
        positionPubKey: widePositionKeypair.publicKey,
        totalXAmount,
        totalYAmount,
        user: keypair.publicKey,
        strategy: {
          strategyType: StrategyType.SpotImBalanced,
          minBinId: position.positionData.lowerBinId,
          maxBinId: position.positionData.upperBinId,
        },
        slippage: 0,
      });

      const [beforeReserveXAccount, beforeReserveYAccount] =
        await connection.getMultipleAccountsInfo([
          dlmm.tokenX.reserve,
          dlmm.tokenY.reserve,
        ]);

      await sendAndConfirmTransaction(connection, addLiquidityTx, [keypair]);
      position = await dlmm.getPosition(widePositionKeypair.publicKey);

      const [afterReserveXAccount, afterReserveYAccount] =
        await connection.getMultipleAccountsInfo([
          dlmm.tokenX.reserve,
          dlmm.tokenY.reserve,
        ]);

      const [computedInAmountX, computedInAmountY] = computedInBinAmount.reduce(
        ([totalXAmount, totalYAmount], { amountX, amountY }) => {
          return [totalXAmount.add(amountX), totalYAmount.add(amountY)];
        },
        [new BN(0), new BN(0)]
      );

      expect(computedInAmountX.lte(totalXAmount)).toBeTruthy();
      expect(computedInAmountY.lte(totalYAmount)).toBeTruthy();

      const beforeReserveX = unpackAccount(
        dlmm.tokenX.reserve,
        beforeReserveXAccount,
        beforeReserveXAccount.owner
      );

      const beforeReserveY = unpackAccount(
        dlmm.tokenY.reserve,
        beforeReserveYAccount,
        beforeReserveYAccount.owner
      );

      const afterReserveX = unpackAccount(
        dlmm.tokenX.reserve,
        afterReserveXAccount,
        afterReserveXAccount.owner
      );

      const afterReserveY = unpackAccount(
        dlmm.tokenY.reserve,
        afterReserveYAccount,
        afterReserveYAccount.owner
      );

      const reserveXReceivedAmount =
        afterReserveX.amount - beforeReserveX.amount;

      const reserveYReceivedAmount =
        afterReserveY.amount - beforeReserveY.amount;

      expect(new BN(reserveXReceivedAmount.toString()).toString()).toBe(
        computedInAmountX.toString()
      );

      expect(new BN(reserveYReceivedAmount.toString()).toString()).toBe(
        computedInAmountY.toString()
      );

      const positionXAmount = new BN(position.positionData.totalXAmount);
      const positionYAmount = new BN(position.positionData.totalYAmount);

      const xDiff = computedInAmountX.sub(positionXAmount);
      const yDiff = computedInAmountY.sub(positionYAmount);

      expect(xDiff.lte(new BN(1))).toBeTruthy();
      expect(yDiff.lte(new BN(1))).toBeTruthy();

      expect(positionXAmount.add(xDiff).toString()).toBe(
        computedInAmountX.toString()
      );

      expect(positionYAmount.add(yDiff).toString()).toBe(
        computedInAmountY.toString()
      );
    });

    it("Initialize position and add liquidity by strategy", async () => {
      const totalXAmount = new BN(100_000).mul(new BN(10 ** btcDecimal));
      const totalYAmount = new BN(100_000).mul(new BN(10 ** usdcDecimal));

      const dlmm = await DLMM.create(connection, pairKey, opt);

      const minBinId = dlmm.lbPair.activeId - 30;
      const maxBinId = dlmm.lbPair.activeId + 30;

      const activeBinInfo = await dlmm.getActiveBin();

      const computedInBinAmount = toAmountsBothSideByStrategy(
        dlmm.lbPair.activeId,
        dlmm.lbPair.binStep,
        minBinId,
        maxBinId,
        totalXAmount,
        totalYAmount,
        activeBinInfo.xAmount,
        activeBinInfo.yAmount,
        StrategyType.SpotImBalanced,
        dlmm.tokenX.mint,
        dlmm.tokenY.mint,
        dlmm.clock
      );

      const initAndAddLiquidityTx =
        await dlmm.initializePositionAndAddLiquidityByStrategy({
          positionPubKey: tightPositionKeypair.publicKey,
          totalXAmount,
          totalYAmount,
          strategy: {
            strategyType: StrategyType.SpotImBalanced,
            minBinId,
            maxBinId,
          },
          slippage: 0,
          user: keypair.publicKey,
        });

      const [beforeReserveXAccount, beforeReserveYAccount] =
        await connection.getMultipleAccountsInfo([
          dlmm.tokenX.reserve,
          dlmm.tokenY.reserve,
        ]);

      await sendAndConfirmTransaction(connection, initAndAddLiquidityTx, [
        keypair,
        tightPositionKeypair,
      ]);

      const [afterReserveXAccount, afterReserveYAccount] =
        await connection.getMultipleAccountsInfo([
          dlmm.tokenX.reserve,
          dlmm.tokenY.reserve,
        ]);

      await dlmm.refetchStates();

      const position = await dlmm.getPosition(tightPositionKeypair.publicKey);
      expect(position.positionData.lowerBinId).toBe(minBinId);
      expect(position.positionData.upperBinId).toBe(maxBinId);

      const [computedInAmountX, computedInAmountY] = computedInBinAmount.reduce(
        ([totalXAmount, totalYAmount], { amountX, amountY }) => {
          return [totalXAmount.add(amountX), totalYAmount.add(amountY)];
        },
        [new BN(0), new BN(0)]
      );

      expect(computedInAmountX.lte(totalXAmount)).toBeTruthy();
      expect(computedInAmountY.lte(totalYAmount)).toBeTruthy();

      const beforeReserveX = unpackAccount(
        dlmm.tokenX.reserve,
        beforeReserveXAccount,
        beforeReserveXAccount.owner
      );

      const beforeReserveY = unpackAccount(
        dlmm.tokenY.reserve,
        beforeReserveYAccount,
        beforeReserveYAccount.owner
      );

      const afterReserveX = unpackAccount(
        dlmm.tokenX.reserve,
        afterReserveXAccount,
        afterReserveXAccount.owner
      );

      const afterReserveY = unpackAccount(
        dlmm.tokenY.reserve,
        afterReserveYAccount,
        afterReserveYAccount.owner
      );

      const reserveXReceivedAmount =
        afterReserveX.amount - beforeReserveX.amount;

      const reserveYReceivedAmount =
        afterReserveY.amount - beforeReserveY.amount;

      expect(new BN(reserveXReceivedAmount.toString()).toString()).toBe(
        computedInAmountX.toString()
      );

      expect(new BN(reserveYReceivedAmount.toString()).toString()).toBe(
        computedInAmountY.toString()
      );

      const positionXAmount = new BN(position.positionData.totalXAmount);
      const positionYAmount = new BN(position.positionData.totalYAmount);

      const xDiff = computedInAmountX.sub(positionXAmount);
      const yDiff = computedInAmountY.sub(positionYAmount);

      expect(xDiff.lte(new BN(1))).toBeTruthy();
      expect(yDiff.lte(new BN(1))).toBeTruthy();

      expect(positionXAmount.add(xDiff).toString()).toBe(
        computedInAmountX.toString()
      );

      expect(positionYAmount.add(yDiff).toString()).toBe(
        computedInAmountY.toString()
      );
    });
  });

  describe("Swap", () => {
    it("Swap quote X into Y and execute swap", async () => {
      const dlmm = await DLMM.create(connection, pairKey, opt);
      const inAmount = new BN(100_000).mul(new BN(10 ** btcDecimal));
      const swapForY = true;

      const bidBinArrays = await dlmm.getBinArrayForSwap(swapForY, 3);
      const quoteResult = dlmm.swapQuote(
        inAmount,
        swapForY,
        new BN(0),
        bidBinArrays,
        false
      );

      const swapTx = await dlmm.swap({
        inAmount,
        inToken: dlmm.tokenX.publicKey,
        outToken: dlmm.tokenY.publicKey,
        minOutAmount: quoteResult.minOutAmount,
        lbPair: pairKey,
        user: keypair.publicKey,
        binArraysPubkey: bidBinArrays.map((b) => b.publicKey),
      });

      const [beforeUserXAccount, beforeUserYAccount] =
        await connection.getMultipleAccountsInfo([
          getAssociatedTokenAddressSync(
            dlmm.tokenX.publicKey,
            keypair.publicKey,
            true,
            dlmm.tokenX.owner
          ),
          getAssociatedTokenAddressSync(
            dlmm.tokenY.publicKey,
            keypair.publicKey,
            true,
            dlmm.tokenY.owner
          ),
        ]);

      await sendAndConfirmTransaction(connection, swapTx, [keypair]);

      const [afterUserXAccount, afterUserYAccount] =
        await connection.getMultipleAccountsInfo([
          getAssociatedTokenAddressSync(
            dlmm.tokenX.publicKey,
            keypair.publicKey,
            true,
            dlmm.tokenX.owner
          ),
          getAssociatedTokenAddressSync(
            dlmm.tokenY.publicKey,
            keypair.publicKey,
            true,
            dlmm.tokenY.owner
          ),
        ]);

      const beforeUserX = unpackAccount(
        dlmm.tokenX.publicKey,
        beforeUserXAccount,
        beforeUserXAccount.owner
      );

      const beforeUserY = unpackAccount(
        dlmm.tokenY.publicKey,
        beforeUserYAccount,
        beforeUserYAccount.owner
      );

      const afterUserX = unpackAccount(
        dlmm.tokenX.publicKey,
        afterUserXAccount,
        afterUserXAccount.owner
      );

      const afterUserY = unpackAccount(
        dlmm.tokenY.publicKey,
        afterUserYAccount,
        afterUserYAccount.owner
      );

      const consumedXAmount = new BN(
        (beforeUserX.amount - afterUserX.amount).toString()
      );
      const receivedYAmount = new BN(
        (afterUserY.amount - beforeUserY.amount).toString()
      );

      expect(consumedXAmount.toString()).toBe(
        quoteResult.consumedInAmount.toString()
      );
      expect(receivedYAmount.toString()).toBe(quoteResult.outAmount.toString());
    });

    it("Swap quote Y into X and execute swap", async () => {
      const dlmm = await DLMM.create(connection, pairKey, opt);
      const inAmount = new BN(100_000).mul(new BN(10 ** usdcDecimal));
      const swapForY = false;

      const askBinArrays = await dlmm.getBinArrayForSwap(swapForY, 3);
      const quoteResult = dlmm.swapQuote(
        inAmount,
        swapForY,
        new BN(0),
        askBinArrays,
        false
      );

      const swapTx = await dlmm.swap({
        inAmount,
        inToken: dlmm.tokenY.publicKey,
        outToken: dlmm.tokenX.publicKey,
        minOutAmount: quoteResult.minOutAmount,
        lbPair: pairKey,
        user: keypair.publicKey,
        binArraysPubkey: askBinArrays.map((b) => b.publicKey),
      });

      const [beforeUserXAccount, beforeUserYAccount] =
        await connection.getMultipleAccountsInfo([
          getAssociatedTokenAddressSync(
            dlmm.tokenX.publicKey,
            keypair.publicKey,
            true,
            dlmm.tokenX.owner
          ),
          getAssociatedTokenAddressSync(
            dlmm.tokenY.publicKey,
            keypair.publicKey,
            true,
            dlmm.tokenY.owner
          ),
        ]);

      await sendAndConfirmTransaction(connection, swapTx, [keypair]);

      const [afterUserXAccount, afterUserYAccount] =
        await connection.getMultipleAccountsInfo([
          getAssociatedTokenAddressSync(
            dlmm.tokenX.publicKey,
            keypair.publicKey,
            true,
            dlmm.tokenX.owner
          ),
          getAssociatedTokenAddressSync(
            dlmm.tokenY.publicKey,
            keypair.publicKey,
            true,
            dlmm.tokenY.owner
          ),
        ]);

      const beforeUserX = unpackAccount(
        dlmm.tokenX.publicKey,
        beforeUserXAccount,
        beforeUserXAccount.owner
      );

      const beforeUserY = unpackAccount(
        dlmm.tokenY.publicKey,
        beforeUserYAccount,
        beforeUserYAccount.owner
      );

      const afterUserX = unpackAccount(
        dlmm.tokenX.publicKey,
        afterUserXAccount,
        afterUserXAccount.owner
      );

      const afterUserY = unpackAccount(
        dlmm.tokenY.publicKey,
        afterUserYAccount,
        afterUserYAccount.owner
      );

      const consumedYAmount = new BN(
        (beforeUserY.amount - afterUserY.amount).toString()
      );
      const receivedXAmount = new BN(
        (afterUserX.amount - beforeUserX.amount).toString()
      );

      expect(consumedYAmount.toString()).toBe(
        quoteResult.consumedInAmount.toString()
      );
      expect(receivedXAmount.toString()).toBe(quoteResult.outAmount.toString());
    });
  });

  describe("Claim fees and rewards", () => {
    let userXAta: PublicKey, userYAta: PublicKey;

    beforeEach(async () => {
      const dlmm = await DLMM.create(connection, pairKey, opt);

      // Generate some swap fees
      const inAmount = new BN(100_000);
      for (const [inToken, outToken] of [
        [dlmm.tokenX, dlmm.tokenY],
        [dlmm.tokenY, dlmm.tokenX],
      ]) {
        const binArraysPubkey = await dlmm
          .getBinArrayForSwap(
            inToken.publicKey.equals(dlmm.tokenX.publicKey),
            3
          )
          .then((b) => b.map((b) => b.publicKey));

        const swapTx = await dlmm.swap({
          inToken: inToken.publicKey,
          outToken: outToken.publicKey,
          inAmount: inAmount.mul(new BN(10 ** inToken.mint.decimals)),
          minOutAmount: new BN(0),
          user: keypair.publicKey,
          lbPair: pairKey,
          binArraysPubkey,
        });

        await sendAndConfirmTransaction(connection, swapTx, [keypair]);
        await dlmm.refetchStates();
      }

      userXAta = getAssociatedTokenAddressSync(
        dlmm.tokenX.publicKey,
        keypair.publicKey,
        true,
        dlmm.tokenX.owner
      );

      userYAta = getAssociatedTokenAddressSync(
        dlmm.tokenY.publicKey,
        keypair.publicKey,
        true,
        dlmm.tokenY.owner
      );
    });

    const assertUserTokenBalanceWithDelta = (
      beforeAccount: AccountInfo<Buffer<ArrayBufferLike>>,
      afterAccount: AccountInfo<Buffer<ArrayBufferLike>>,
      expectedAmount: BN
    ) => {
      const before = unpackAccount(
        PublicKey.default,
        beforeAccount,
        beforeAccount.owner
      );

      const after = unpackAccount(
        PublicKey.default,
        afterAccount,
        afterAccount.owner
      );

      const delta =
        before.amount > after.amount
          ? before.amount - after.amount
          : after.amount - before.amount;

      const deltaBn = new BN(delta.toString());
      expect(deltaBn.toString()).toBe(expectedAmount.toString());
    };

    it("Claim all swap fees", async () => {
      const dlmm = await DLMM.create(connection, pairKey, opt);

      const [beforeUserXAccount, beforeUserYAccount] =
        await connection.getMultipleAccountsInfo([userXAta, userYAta]);

      const [widePosition, tightPosition] = await Promise.all([
        dlmm.getPosition(widePositionKeypair.publicKey),
        dlmm.getPosition(tightPositionKeypair.publicKey),
      ]);

      const totalClaimableFeeX =
        widePosition.positionData.feeXExcludeTransferFee.add(
          tightPosition.positionData.feeXExcludeTransferFee
        );

      const totalClaimableFeeY =
        widePosition.positionData.feeYExcludeTransferFee.add(
          tightPosition.positionData.feeYExcludeTransferFee
        );

      const claimFeeTxs = await dlmm.claimAllSwapFee({
        owner: keypair.publicKey,
        positions: [widePosition, tightPosition],
      });

      await Promise.all(
        claimFeeTxs.map((tx) =>
          sendAndConfirmTransaction(connection, tx, [keypair])
        )
      );

      const [afterUserXAccount, afterUserYAccount] =
        await connection.getMultipleAccountsInfo([userXAta, userYAta]);

      assertUserTokenBalanceWithDelta(
        beforeUserXAccount,
        afterUserXAccount,
        totalClaimableFeeX
      );

      assertUserTokenBalanceWithDelta(
        beforeUserYAccount,
        afterUserYAccount,
        totalClaimableFeeY
      );
    });

    it("Claim swap fee", async () => {
      const dlmm = await DLMM.create(connection, pairKey, opt);

      for (const positionKey of [
        widePositionKeypair.publicKey,
        tightPositionKeypair.publicKey,
      ]) {
        const position = await dlmm.getPosition(positionKey);

        const [beforeUserXAccount, beforeUserYAccount] =
          await connection.getMultipleAccountsInfo([userXAta, userYAta]);

        const claimFeeTx = await dlmm.claimSwapFee({
          owner: keypair.publicKey,
          position,
        });

        await sendAndConfirmTransaction(connection, claimFeeTx, [keypair]);

        const [afterUserXAccount, afterUserYAccount] =
          await connection.getMultipleAccountsInfo([userXAta, userYAta]);

        assertUserTokenBalanceWithDelta(
          beforeUserXAccount,
          afterUserXAccount,
          position.positionData.feeXExcludeTransferFee
        );

        assertUserTokenBalanceWithDelta(
          beforeUserYAccount,
          afterUserYAccount,
          position.positionData.feeYExcludeTransferFee
        );
      }
    });

    it("Claim swap fee chunk", async () => {
      const dlmm = await DLMM.create(connection, pairKey, opt);

      for (const positionKey of [
        widePositionKeypair.publicKey,
        tightPositionKeypair.publicKey,
      ]) {
        const position = await dlmm.getPosition(positionKey);

        const binRangeToShrink =
          (position.positionData.upperBinId -
            position.positionData.lowerBinId) *
          0.4;

        const minBinId = new BN(
          Math.ceil(position.positionData.lowerBinId + binRangeToShrink)
        );

        const maxBinId = new BN(
          Math.floor(position.positionData.upperBinId - binRangeToShrink)
        );

        const [beforeUserXAccount, beforeUserYAccount] =
          await connection.getMultipleAccountsInfo([userXAta, userYAta]);

        const claimFeeTx = await dlmm.claimSwapFee({
          owner: keypair.publicKey,
          position,
          binRange: {
            minBinId,
            maxBinId,
          },
        });

        await sendAndConfirmTransaction(connection, claimFeeTx, [keypair]);

        const [afterUserXAccount, afterUserYAccount] =
          await connection.getMultipleAccountsInfo([userXAta, userYAta]);

        const beforeUserX = unpackAccount(
          dlmm.tokenX.publicKey,
          beforeUserXAccount,
          beforeUserXAccount.owner
        );

        const afterUserX = unpackAccount(
          dlmm.tokenX.publicKey,
          afterUserXAccount,
          afterUserXAccount.owner
        );

        const beforeUserY = unpackAccount(
          dlmm.tokenY.publicKey,
          beforeUserYAccount,
          beforeUserYAccount.owner
        );

        const afterUserY = unpackAccount(
          dlmm.tokenY.publicKey,
          afterUserYAccount,
          afterUserYAccount.owner
        );

        const claimedAmountX = new BN(
          (afterUserX.amount - beforeUserX.amount).toString()
        );

        const claimedAmountY = new BN(
          (afterUserY.amount - beforeUserY.amount).toString()
        );

        console.log(
          claimedAmountX.toString(),
          position.positionData.feeXExcludeTransferFee.toString()
        );

        console.log(
          claimedAmountY.toString(),
          position.positionData.feeYExcludeTransferFee.toString()
        );

        expect(
          claimedAmountX.lt(position.positionData.feeXExcludeTransferFee)
        ).toBeTruthy();
        expect(
          claimedAmountY.lt(position.positionData.feeYExcludeTransferFee)
        ).toBeTruthy();
      }
    });
  });

  describe("Position fetcher", () => {
    const pairWithPositionKey: {
      pair: PublicKey;
      position: PublicKey;
      user: PublicKey;
    }[] = [];

    beforeAll(async () => {
      const pairs = await DLMM.getLbPairs(connection, opt);

      for (const pair of pairs) {
        const userKeypair = Keypair.generate();

        const airdropSig = await connection.requestAirdrop(
          userKeypair.publicKey,
          1 * LAMPORTS_PER_SOL
        );

        await connection.confirmTransaction(airdropSig, "confirmed");

        const positionKeypair = Keypair.generate();
        const dlmm = await DLMM.create(connection, pair.publicKey, opt);

        const minBinId = -30;
        const maxBinId = 30;

        const createPositionAndBinArraysTx = await dlmm.createEmptyPosition({
          positionPubKey: positionKeypair.publicKey,
          minBinId,
          maxBinId,
          user: userKeypair.publicKey,
        });

        await sendAndConfirmTransaction(
          connection,
          createPositionAndBinArraysTx,
          [userKeypair, positionKeypair]
        );

        pairWithPositionKey.push({
          pair: pair.publicKey,
          position: positionKeypair.publicKey,
          user: userKeypair.publicKey,
        });
      }
    });

    it("Load position by user and pair successfully", async () => {
      for (const { pair, position, user } of pairWithPositionKey) {
        const dlmm = await DLMM.create(connection, pair, opt);
        const { userPositions } = await dlmm.getPositionsByUserAndLbPair(user);

        expect(userPositions.length).toBe(1);
        expect(
          userPositions.find((x) => x.publicKey.equals(position))
        ).toBeDefined();
        expect(
          userPositions.filter((x) => x.positionData.owner.equals(user)).length
        ).toBe(userPositions.length);
      }
    });

    it("Load all positions by user successfully", async () => {
      const pairKeyedPosition = await DLMM.getAllLbPairPositionsByUser(
        connection,
        keypair.publicKey,
        opt
      );

      const positionContainers = Array.from(pairKeyedPosition.values());
      const positions = positionContainers.flatMap(
        (x) => x.lbPairPositionsData
      );

      for (const position of positions) {
        expect(
          position.positionData.owner.equals(keypair.publicKey)
        ).toBeTruthy();
      }
    });
  });
});
