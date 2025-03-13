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
import { BASIS_POINT_MAX, LBCLMM_PROGRAM_IDS } from "../dlmm/constants";
import {
  binIdToBinArrayIndex,
  deriveBinArray,
  deriveCustomizablePermissionlessLbPair,
  deriveLbPairWithPresetParamWithIndexKey,
  derivePresetParameterWithIndex,
  deriveRewardVault,
  deriveTokenBadge,
  toAmountsBothSideByStrategy,
} from "../dlmm/helpers";
import {
  calculateTransferFeeExcludedAmount,
  getExtraAccountMetasForTransferHook,
} from "../dlmm/helpers/token_2022";
import { IDL } from "../dlmm/idl";
import { ActivationType, StrategyType } from "../dlmm/types";
import { createExtraAccountMetaListAndCounter } from "./external/helper";
import {
  createTransferHookCounterProgram,
  TRANSFER_HOOK_COUNTER_PROGRAM_ID,
} from "./external/program";

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

const positionKeypair0 = Keypair.generate();
const positionKeypair1 = Keypair.generate();

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

    await createExtraAccountMetaListAndCounter(
      transferHookCounterProgram,
      MET2022
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
          false,
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

  describe("Empty position management", () => {
    beforeAll(async () => {
      const rewardIndex = new BN(0);
      const rewardDuration = new BN(300);
      const fundingReward = new BN(
        (BigInt(1_000_000) * BigInt(10 ** metDecimal)).toString()
      );

      const funder = keypair.publicKey;

      const [rewardVault] = deriveRewardVault(
        pairKey,
        rewardIndex,
        program.programId
      );

      const metAccount = await connection.getAccountInfo(MET2022);

      const [tokenBadge] = deriveTokenBadge(MET2022, program.programId);

      await program.methods
        .initializeReward(rewardIndex, rewardDuration, funder)
        .accounts({
          lbPair: pairKey,
          rewardMint: MET2022,
          rewardVault,
          admin: keypair.publicKey,
          tokenBadge,
          tokenProgram: metAccount.owner,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const dlmm = await DLMM.create(connection, pairKey, opt);
      const activeBinArrayIndex = binIdToBinArrayIndex(
        new BN(dlmm.lbPair.activeId)
      );
      const activeBinArrayKey = deriveBinArray(
        dlmm.pubkey,
        activeBinArrayIndex,
        dlmm.program.programId
      )[0];

      const initActiveBinArrayIxs = await dlmm.initializeBinArrays(
        [activeBinArrayIndex],
        funder
      );

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");

      const tx = new Transaction({
        blockhash,
        lastValidBlockHeight,
      }).add(...initActiveBinArrayIxs);

      await sendAndConfirmTransaction(connection, tx, [keypair]);

      const metTransferHookAccountMetas =
        await getExtraAccountMetasForTransferHook(
          connection,
          MET2022,
          metAccount
        );

      const metAtaKey = getAssociatedTokenAddressSync(
        MET2022,
        funder,
        true,
        metAccount.owner
      );

      await program.methods
        .fundReward(rewardIndex, fundingReward, true, {
          slices: [
            {
              accountsType: {
                transferHookReward: {},
              },
              length: metTransferHookAccountMetas.length,
            },
          ],
        })
        .accounts({
          lbPair: pairKey,
          rewardMint: MET2022,
          rewardVault,
          funder,
          binArray: activeBinArrayKey,
          funderTokenAccount: metAtaKey,
          tokenProgram: metAccount.owner,
        })
        .remainingAccounts(metTransferHookAccountMetas)
        .rpc();
    });

    it("createEmptyPosition", async () => {
      const dlmm = await DLMM.create(connection, pairKey, opt);

      const minBinId = -30;
      const maxBinId = 30;

      const createPositionAndBinArraysTx = await dlmm.createEmptyPosition({
        positionPubKey: positionKeypair0.publicKey,
        minBinId,
        maxBinId,
        user: keypair.publicKey,
      });

      await sendAndConfirmTransaction(
        connection,
        createPositionAndBinArraysTx,
        [keypair, positionKeypair0]
      );

      const position = await dlmm.getPosition(positionKeypair0.publicKey);
      expect(position.publicKey.toBase58()).toBe(
        positionKeypair0.publicKey.toBase58()
      );

      const { positionData } = position;
      expect(positionData.lowerBinId).toBe(minBinId);
      expect(positionData.upperBinId).toBe(maxBinId);

      const binCount = maxBinId - minBinId + 1;
      expect(positionData.positionBinData.length).toBe(binCount);
    });
  });

  describe("Add liquidity", () => {
    it("Add liquidity by strategy", async () => {
      const totalXAmount = new BN(100_000).mul(new BN(10 ** btcDecimal));
      const totalYAmount = new BN(100_000).mul(new BN(10 ** usdcDecimal));

      const dlmm = await DLMM.create(connection, pairKey, opt);
      let position = await dlmm.getPosition(positionKeypair0.publicKey);

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
        StrategyType.Spot,
        dlmm.tokenX.mint,
        dlmm.tokenY.mint,
        dlmm.clock
      );

      const addLiquidityTx = await dlmm.addLiquidityByStrategy({
        positionPubKey: positionKeypair0.publicKey,
        totalXAmount,
        totalYAmount,
        user: keypair.publicKey,
        strategy: {
          strategyType: StrategyType.Spot,
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
      position = await dlmm.getPosition(positionKeypair0.publicKey);

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
        StrategyType.Spot,
        dlmm.tokenX.mint,
        dlmm.tokenY.mint,
        dlmm.clock
      );

      const initAndAddLiquidityTx =
        await dlmm.initializePositionAndAddLiquidityByStrategy({
          positionPubKey: positionKeypair1.publicKey,
          totalXAmount,
          totalYAmount,
          strategy: {
            strategyType: StrategyType.Spot,
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
        positionKeypair1,
      ]);

      const [afterReserveXAccount, afterReserveYAccount] =
        await connection.getMultipleAccountsInfo([
          dlmm.tokenX.reserve,
          dlmm.tokenY.reserve,
        ]);

      await dlmm.refetchStates();

      const position = await dlmm.getPosition(positionKeypair1.publicKey);
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
    it("SwapExactIn quote X into Y and execute swap", async () => {
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

    it("SwapExactOut quote Y into X and execute swap", async () => {
      const dlmm = await DLMM.create(connection, pairKey, opt);
      const outAmount = new BN(100_000).mul(new BN(10 ** btcDecimal));
      const swapForY = false;

      const askBinArrays = await dlmm.getBinArrayForSwap(swapForY, 3);
      const quoteResult = dlmm.swapQuoteExactOut(
        outAmount,
        swapForY,
        new BN(0),
        askBinArrays
      );

      console.log(
        quoteResult.inAmount.toString(),
        quoteResult.outAmount.toString()
      );

      const swapTx = await dlmm.swapExactOut({
        outAmount,
        inToken: dlmm.tokenY.publicKey,
        outToken: dlmm.tokenX.publicKey,
        maxInAmount: quoteResult.maxInAmount,
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

      expect(consumedYAmount.toString()).toBe(quoteResult.inAmount.toString());
      expect(receivedXAmount.toString()).toBe(quoteResult.outAmount.toString());
    });

    it("SwapExactOut quote X into Y and execute swap", async () => {
      const dlmm = await DLMM.create(connection, pairKey, opt);
      const outAmount = new BN(100_000).mul(new BN(10 ** usdcDecimal));
      const swapForY = true;

      const bidBinArrays = await dlmm.getBinArrayForSwap(swapForY, 3);
      const quoteResult = dlmm.swapQuoteExactOut(
        outAmount,
        swapForY,
        new BN(0),
        bidBinArrays
      );

      console.log(
        quoteResult.inAmount.toString(),
        quoteResult.outAmount.toString()
      );

      const swapTx = await dlmm.swapExactOut({
        outAmount,
        inToken: dlmm.tokenX.publicKey,
        outToken: dlmm.tokenY.publicKey,
        maxInAmount: quoteResult.maxInAmount,
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

      expect(consumedXAmount.toString()).toBe(quoteResult.inAmount.toString());
      expect(receivedYAmount.toString()).toBe(quoteResult.outAmount.toString());
    });

    it("SwapExactIn quote Y into X and execute swap", async () => {
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

  const generateSwapFees = async () => {
    const dlmm = await DLMM.create(connection, pairKey, opt);

    // Generate some swap fees
    const inAmount = new BN(100_000);
    for (const [inToken, outToken] of [
      [dlmm.tokenX, dlmm.tokenY],
      [dlmm.tokenY, dlmm.tokenX],
    ]) {
      const binArraysPubkey = await dlmm
        .getBinArrayForSwap(inToken.publicKey.equals(dlmm.tokenX.publicKey), 3)
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
  };

  describe("Claim fees and rewards", () => {
    let userXAta: PublicKey, userYAta: PublicKey, userRewardAta: PublicKey;

    beforeEach(async () => {
      const dlmm = await DLMM.create(connection, pairKey, opt);
      await generateSwapFees();

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

      userRewardAta = getAssociatedTokenAddressSync(
        dlmm.rewards[0].publicKey,
        keypair.publicKey,
        true,
        dlmm.rewards[0].owner
      );
    });

    const assertUserTokenBalanceWithDelta = (
      beforeAccount: AccountInfo<Buffer>,
      afterAccount: AccountInfo<Buffer>,
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

    describe("Claim swap fee", () => {
      it("Claim all swap fees", async () => {
        const dlmm = await DLMM.create(connection, pairKey, opt);

        const [beforeUserXAccount, beforeUserYAccount] =
          await connection.getMultipleAccountsInfo([userXAta, userYAta]);

        const [beforeWidePosition, beforeTightPosition] = await Promise.all([
          dlmm.getPosition(positionKeypair0.publicKey),
          dlmm.getPosition(positionKeypair1.publicKey),
        ]);

        const totalClaimableFeeX =
          beforeWidePosition.positionData.feeXExcludeTransferFee.add(
            beforeTightPosition.positionData.feeXExcludeTransferFee
          );

        const totalClaimableFeeY =
          beforeWidePosition.positionData.feeYExcludeTransferFee.add(
            beforeTightPosition.positionData.feeYExcludeTransferFee
          );

        const claimFeeTxs = await dlmm.claimAllSwapFee({
          owner: keypair.publicKey,
          positions: [beforeWidePosition, beforeTightPosition],
        });

        expect(claimFeeTxs.length).toBeGreaterThanOrEqual(1);

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

        const [afterWidePosition, afterTightPosition] = await Promise.all([
          dlmm.getPosition(positionKeypair0.publicKey),
          dlmm.getPosition(positionKeypair1.publicKey),
        ]);

        expect(afterWidePosition.positionData.feeX.isZero()).toBeTruthy();
        expect(afterWidePosition.positionData.feeY.isZero()).toBeTruthy();

        expect(afterTightPosition.positionData.feeX.isZero()).toBeTruthy();
        expect(afterTightPosition.positionData.feeY.isZero()).toBeTruthy();
      });

      it("Claim swap fee", async () => {
        const dlmm = await DLMM.create(connection, pairKey, opt);

        for (const positionKey of [
          positionKeypair0.publicKey,
          positionKeypair1.publicKey,
        ]) {
          const beforePosition = await dlmm.getPosition(positionKey);

          const [beforeUserXAccount, beforeUserYAccount] =
            await connection.getMultipleAccountsInfo([userXAta, userYAta]);

          const claimFeeTxs = await dlmm.claimSwapFee({
            owner: keypair.publicKey,
            position: beforePosition,
          });

          await sendAndConfirmTransaction(connection, claimFeeTxs, [keypair]);

          const [afterUserXAccount, afterUserYAccount] =
            await connection.getMultipleAccountsInfo([userXAta, userYAta]);

          assertUserTokenBalanceWithDelta(
            beforeUserXAccount,
            afterUserXAccount,
            beforePosition.positionData.feeXExcludeTransferFee
          );

          assertUserTokenBalanceWithDelta(
            beforeUserYAccount,
            afterUserYAccount,
            beforePosition.positionData.feeYExcludeTransferFee
          );

          const afterPosition = await dlmm.getPosition(positionKey);
          expect(afterPosition.positionData.feeX.isZero()).toBeTruthy();
          expect(afterPosition.positionData.feeY.isZero()).toBeTruthy();
        }
      });
    });

    describe("Claim rewards", () => {
      beforeEach(async () => {
        // Generate some fees
        await new Promise((res) => setTimeout(res, 1000));
      });

      it("Claim reward", async () => {
        for (const positionKey of [
          positionKeypair0.publicKey,
          positionKeypair1.publicKey,
        ]) {
          const dlmm = await DLMM.create(connection, pairKey, opt);
          const position = await dlmm.getPosition(positionKey);

          const beforeUserRewardAccount = await connection.getAccountInfo(
            userRewardAta
          );

          const claimTxs = await dlmm.claimLMReward({
            owner: keypair.publicKey,
            position,
          });

          await sendAndConfirmTransaction(connection, claimTxs, [keypair]);

          const afterUserRewardAccount = await connection.getAccountInfo(
            userRewardAta
          );

          const beforeUserReward = unpackAccount(
            userRewardAta,
            beforeUserRewardAccount,
            beforeUserRewardAccount.owner
          );

          const afterUserReward = unpackAccount(
            userRewardAta,
            afterUserRewardAccount,
            afterUserRewardAccount.owner
          );

          const claimedReward = new BN(
            (afterUserReward.amount - beforeUserReward.amount).toString()
          );

          expect(
            claimedReward.gte(position.positionData.rewardOneExcludeTransferFee)
          ).toBeTruthy();
        }
      });

      it("Claim all rewards", async () => {
        const dlmm = await DLMM.create(connection, pairKey, opt);

        const beforeUserRewardAccount = await connection.getAccountInfo(
          userRewardAta
        );

        const [beforeWidePosition, beforeTightPosition] = await Promise.all([
          dlmm.getPosition(positionKeypair0.publicKey),
          dlmm.getPosition(positionKeypair1.publicKey),
        ]);

        const totalClaimableReward0 =
          beforeWidePosition.positionData.rewardOneExcludeTransferFee.add(
            beforeTightPosition.positionData.rewardOneExcludeTransferFee
          );

        const claimTxs = await dlmm.claimAllLMRewards({
          owner: keypair.publicKey,
          positions: [beforeWidePosition, beforeTightPosition],
        });

        expect(claimTxs.length).toBeGreaterThanOrEqual(1);

        await Promise.all(
          claimTxs.map((tx) =>
            sendAndConfirmTransaction(connection, tx, [keypair])
          )
        );

        const afterUserRewardAccount = await connection.getAccountInfo(
          userRewardAta
        );

        const beforeUserReward = unpackAccount(
          userRewardAta,
          beforeUserRewardAccount,
          beforeUserRewardAccount.owner
        );

        const afterUserReward = unpackAccount(
          userRewardAta,
          afterUserRewardAccount,
          afterUserRewardAccount.owner
        );

        const claimedAmount = new BN(
          (
            BigInt(afterUserReward.amount) - BigInt(beforeUserReward.amount)
          ).toString()
        );

        expect(claimedAmount.gte(totalClaimableReward0)).toBeTruthy();

        const [afterWidePosition, afterTightPosition] = await Promise.all([
          dlmm.getPosition(positionKeypair0.publicKey),
          dlmm.getPosition(positionKeypair1.publicKey),
        ]);

        expect(
          afterWidePosition.positionData.rewardOneExcludeTransferFee.lt(
            beforeWidePosition.positionData.rewardOneExcludeTransferFee
          )
        ).toBeTruthy();
        expect(
          afterTightPosition.positionData.rewardOneExcludeTransferFee.lt(
            beforeTightPosition.positionData.rewardOneExcludeTransferFee
          )
        ).toBeTruthy();
      });
    });

    describe("Claim fees and rewards together", () => {
      beforeEach(async () => {
        // Generate some fees
        await new Promise((res) => setTimeout(res, 1000));
      });

      it("Claim fee and reward by position", async () => {
        for (const positionKey of [
          positionKeypair0.publicKey,
          positionKeypair1.publicKey,
        ]) {
          const dlmm = await DLMM.create(connection, pairKey, opt);
          const beforePositionState = await dlmm.getPosition(positionKey);

          const [
            beforeUserRewardAccount,
            beforeUserXAccount,
            beforeUserYAccount,
          ] = await connection.getMultipleAccountsInfo([
            userRewardAta,
            userXAta,
            userYAta,
          ]);

          const claimTxs = await dlmm.claimAllRewardsByPosition({
            position: beforePositionState,
            owner: keypair.publicKey,
          });

          expect(claimTxs.length).toBeGreaterThanOrEqual(1);

          await Promise.all(
            claimTxs.map((tx) => {
              return sendAndConfirmTransaction(connection, tx, [keypair]);
            })
          );

          const afterPositionState = await dlmm.getPosition(positionKey);
          expect(afterPositionState.positionData.feeX.isZero()).toBeTruthy();
          expect(afterPositionState.positionData.feeY.isZero()).toBeTruthy();

          const [afterUserRewardAccount, afterUserXAccount, afterUserYAccount] =
            await connection.getMultipleAccountsInfo([
              userRewardAta,
              userXAta,
              userYAta,
            ]);

          const beforeUserReward = unpackAccount(
            userRewardAta,
            beforeUserRewardAccount,
            beforeUserRewardAccount.owner
          );

          const afterUserReward = unpackAccount(
            userRewardAta,
            afterUserRewardAccount,
            afterUserRewardAccount.owner
          );

          const actualClaimedReward = new BN(
            (afterUserReward.amount - beforeUserReward.amount).toString()
          );

          expect(
            actualClaimedReward.gte(
              beforePositionState.positionData.rewardOneExcludeTransferFee
            )
          ).toBeTruthy();

          const beforeUserX = unpackAccount(
            userXAta,
            beforeUserXAccount,
            beforeUserXAccount.owner
          );

          const afterUserX = unpackAccount(
            userXAta,
            afterUserXAccount,
            afterUserXAccount.owner
          );

          const claimedFeeX = new BN(
            (afterUserX.amount - beforeUserX.amount).toString()
          );

          expect(claimedFeeX.toString()).toBe(
            beforePositionState.positionData.feeXExcludeTransferFee.toString()
          );

          const beforeUserY = unpackAccount(
            userYAta,
            beforeUserYAccount,
            beforeUserYAccount.owner
          );

          const afterUserY = unpackAccount(
            userYAta,
            afterUserYAccount,
            afterUserYAccount.owner
          );

          const claimedFeeY = new BN(
            (afterUserY.amount - beforeUserY.amount).toString()
          );

          expect(claimedFeeY.toString()).toBe(
            beforePositionState.positionData.feeYExcludeTransferFee.toString()
          );
        }
      });

      it("Claim all positions fees and rewards", async () => {
        const dlmm = await DLMM.create(connection, pairKey, opt);

        const [beforeWidePosition, beforeTightPosition] = await Promise.all([
          dlmm.getPosition(positionKeypair0.publicKey),
          dlmm.getPosition(positionKeypair1.publicKey),
        ]);

        const [
          beforeUserRewardAccount,
          beforeUserXAccount,
          beforeUserYAccount,
        ] = await connection.getMultipleAccountsInfo([
          userRewardAta,
          userXAta,
          userYAta,
        ]);

        const totalClaimableFeeX =
          beforeWidePosition.positionData.feeXExcludeTransferFee.add(
            beforeTightPosition.positionData.feeXExcludeTransferFee
          );

        const totalClaimableFeeY =
          beforeWidePosition.positionData.feeYExcludeTransferFee.add(
            beforeTightPosition.positionData.feeYExcludeTransferFee
          );

        const totalClaimableReward =
          beforeWidePosition.positionData.rewardOneExcludeTransferFee.add(
            beforeTightPosition.positionData.rewardOneExcludeTransferFee
          );

        const claimTxs = await dlmm.claimAllRewards({
          owner: keypair.publicKey,
          positions: [beforeWidePosition, beforeTightPosition],
        });

        expect(claimTxs.length).toBeGreaterThanOrEqual(1);

        await Promise.all(
          claimTxs.map((tx) => {
            return sendAndConfirmTransaction(connection, tx, [keypair]);
          })
        );

        const [afterUserRewardAccount, afterUserXAccount, afterUserYAccount] =
          await connection.getMultipleAccountsInfo([
            userRewardAta,
            userXAta,
            userYAta,
          ]);

        const [afterWidePosition, afterTightPosition] = await Promise.all([
          dlmm.getPosition(positionKeypair0.publicKey),
          dlmm.getPosition(positionKeypair1.publicKey),
        ]);

        expect(afterWidePosition.positionData.feeX.isZero()).toBeTruthy();
        expect(afterWidePosition.positionData.feeY.isZero()).toBeTruthy();

        expect(afterTightPosition.positionData.feeX.isZero()).toBeTruthy();
        expect(afterTightPosition.positionData.feeY.isZero()).toBeTruthy();

        const beforeUserReward = unpackAccount(
          userRewardAta,
          beforeUserRewardAccount,
          beforeUserRewardAccount.owner
        );

        const afterUserReward = unpackAccount(
          userRewardAta,
          afterUserRewardAccount,
          afterUserRewardAccount.owner
        );

        const actualClaimedReward = new BN(
          (afterUserReward.amount - beforeUserReward.amount).toString()
        );

        expect(actualClaimedReward.gte(totalClaimableReward)).toBeTruthy();

        const beforeUserX = unpackAccount(
          userXAta,
          beforeUserXAccount,
          beforeUserXAccount.owner
        );

        const afterUserX = unpackAccount(
          userXAta,
          afterUserXAccount,
          afterUserXAccount.owner
        );

        const claimedFeeX = new BN(
          (afterUserX.amount - beforeUserX.amount).toString()
        );

        expect(claimedFeeX.toString()).toBe(totalClaimableFeeX.toString());

        const beforeUserY = unpackAccount(
          userYAta,
          beforeUserYAccount,
          beforeUserYAccount.owner
        );

        const afterUserY = unpackAccount(
          userYAta,
          afterUserYAccount,
          afterUserYAccount.owner
        );

        const claimedFeeY = new BN(
          (afterUserY.amount - beforeUserY.amount).toString()
        );

        expect(claimedFeeY.toString()).toBe(totalClaimableFeeY.toString());
      });
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

  describe("Remove liquidity", () => {
    beforeAll(async () => {
      await generateSwapFees();
      // Generate some reward
      await new Promise((res) => setTimeout(res, 1000));
    });

    it("Remove liquidity without claim and close successfully", async () => {
      const dlmm = await DLMM.create(connection, pairKey, opt);

      const beforePosition = await dlmm.getPosition(positionKeypair0.publicKey);

      const fromBinId = dlmm.lbPair.activeId - 1;
      const toBinId = dlmm.lbPair.activeId + 1;

      let expectedAmountX = new BN(0);
      let expectedAmountY = new BN(0);

      const userXAta = getAssociatedTokenAddressSync(
        dlmm.tokenX.publicKey,
        keypair.publicKey,
        true,
        dlmm.tokenX.owner
      );

      const userYAta = getAssociatedTokenAddressSync(
        dlmm.tokenY.publicKey,
        keypair.publicKey,
        true,
        dlmm.tokenY.owner
      );

      const [beforeUserXAccount, beforeUserYAccount] =
        await connection.getMultipleAccountsInfo([userXAta, userYAta]);

      for (const binData of beforePosition.positionData.positionBinData) {
        if (binData.binId >= fromBinId && binData.binId <= toBinId) {
          expect(new BN(binData.positionLiquidity).isZero()).toBeFalsy();
          expectedAmountX = expectedAmountX.add(
            new BN(binData.positionXAmount)
          );

          expectedAmountY = expectedAmountY.add(
            new BN(binData.positionYAmount)
          );
        }
      }

      const expectedAmountXExcludeTranferFee =
        calculateTransferFeeExcludedAmount(
          expectedAmountX,
          dlmm.tokenX.mint,
          dlmm.clock.epoch.toNumber()
        ).amount;

      const expectedAmountYExcludeTranferFee =
        calculateTransferFeeExcludedAmount(
          expectedAmountY,
          dlmm.tokenY.mint,
          dlmm.clock.epoch.toNumber()
        ).amount;

      const removeLiquidityTxs = await dlmm.removeLiquidity({
        position: positionKeypair0.publicKey,
        fromBinId,
        toBinId,
        bps: new BN(BASIS_POINT_MAX),
        user: keypair.publicKey,
        shouldClaimAndClose: false,
      });

      expect(Array.isArray(removeLiquidityTxs)).toBeFalsy();

      await sendAndConfirmTransaction(
        connection,
        removeLiquidityTxs as Transaction,
        [keypair]
      );

      const [afterUserXAccount, afterUserYAccount] =
        await connection.getMultipleAccountsInfo([userXAta, userYAta]);

      const beforeUserX = unpackAccount(
        userXAta,
        beforeUserXAccount,
        beforeUserXAccount.owner
      );
      const beforeUserY = unpackAccount(
        userYAta,
        beforeUserYAccount,
        beforeUserYAccount.owner
      );

      const afterUserX = unpackAccount(
        userXAta,
        afterUserXAccount,
        afterUserXAccount.owner
      );

      const afterUserY = unpackAccount(
        userYAta,
        afterUserYAccount,
        afterUserYAccount.owner
      );

      const amountX = new BN(
        (afterUserX.amount - beforeUserX.amount).toString()
      );
      const amountY = new BN(
        (afterUserY.amount - beforeUserY.amount).toString()
      );

      expect(amountX.toString()).toBe(
        expectedAmountXExcludeTranferFee.toString()
      );
      expect(amountY.toString()).toBe(
        expectedAmountYExcludeTranferFee.toString()
      );
    });

    it("Remove liquidity with claim and close successfully", async () => {
      const dlmm = await DLMM.create(connection, pairKey, opt);

      const beforePosition = await dlmm.getPosition(positionKeypair0.publicKey);

      const fromBinId = beforePosition.positionData.lowerBinId;
      const toBinId = beforePosition.positionData.upperBinId;

      let expectedAmountX = new BN(0);
      let expectedAmountY = new BN(0);

      const userXAta = getAssociatedTokenAddressSync(
        dlmm.tokenX.publicKey,
        keypair.publicKey,
        true,
        dlmm.tokenX.owner
      );

      const userYAta = getAssociatedTokenAddressSync(
        dlmm.tokenY.publicKey,
        keypair.publicKey,
        true,
        dlmm.tokenY.owner
      );

      const [beforeUserXAccount, beforeUserYAccount] =
        await connection.getMultipleAccountsInfo([userXAta, userYAta]);

      for (const binData of beforePosition.positionData.positionBinData) {
        if (binData.binId >= fromBinId && binData.binId <= toBinId) {
          expectedAmountX = expectedAmountX
            .add(new BN(binData.positionXAmount))
            .add(new BN(binData.positionFeeXAmount));

          expectedAmountY = expectedAmountY
            .add(new BN(binData.positionYAmount))
            .add(new BN(binData.positionFeeYAmount));
        }
      }

      const expectedAmountXExcludeTranferFee =
        calculateTransferFeeExcludedAmount(
          expectedAmountX,
          dlmm.tokenX.mint,
          dlmm.clock.epoch.toNumber()
        ).amount;

      const expectedAmountYExcludeTranferFee =
        calculateTransferFeeExcludedAmount(
          expectedAmountY,
          dlmm.tokenY.mint,
          dlmm.clock.epoch.toNumber()
        ).amount;

      const removeLiquidityTxs = (await dlmm.removeLiquidity({
        position: positionKeypair0.publicKey,
        fromBinId,
        toBinId,
        bps: new BN(BASIS_POINT_MAX),
        user: keypair.publicKey,
        shouldClaimAndClose: true,
      })) as Transaction[];

      expect(Array.isArray(removeLiquidityTxs)).toBeTruthy();
      expect(removeLiquidityTxs.length).toBeGreaterThan(1);

      for (const tx of removeLiquidityTxs) {
        await sendAndConfirmTransaction(connection, tx, [keypair]);
      }

      const [afterUserXAccount, afterUserYAccount] =
        await connection.getMultipleAccountsInfo([userXAta, userYAta]);

      const beforeUserX = unpackAccount(
        userXAta,
        beforeUserXAccount,
        beforeUserXAccount.owner
      );
      const beforeUserY = unpackAccount(
        userYAta,
        beforeUserYAccount,
        beforeUserYAccount.owner
      );

      const afterUserX = unpackAccount(
        userXAta,
        afterUserXAccount,
        afterUserXAccount.owner
      );

      const afterUserY = unpackAccount(
        userYAta,
        afterUserYAccount,
        afterUserYAccount.owner
      );

      const amountX = new BN(
        (afterUserX.amount - beforeUserX.amount).toString()
      );
      const amountY = new BN(
        (afterUserY.amount - beforeUserY.amount).toString()
      );

      // LTE due to multiple transfer fee round down precision loss
      expect(amountX.lte(expectedAmountXExcludeTranferFee)).toBeTruthy();
      expect(amountY.lte(expectedAmountYExcludeTranferFee)).toBeTruthy();

      const positionAccount = await connection.getAccountInfo(
        positionKeypair0.publicKey
      );

      expect(positionAccount).toBeNull();
    });
  });
});
