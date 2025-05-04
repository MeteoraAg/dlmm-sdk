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
import {
  BASIS_POINT_MAX,
  DEFAULT_BIN_PER_POSITION,
  LBCLMM_PROGRAM_IDS,
  POSITION_MAX_LENGTH,
} from "../dlmm/constants";
import {
  binIdToBinArrayIndex,
  deriveBinArray,
  deriveCustomizablePermissionlessLbPair,
  deriveLbPairWithPresetParamWithIndexKey,
  derivePresetParameterWithIndex,
  deriveRewardVault,
  deriveTokenBadge,
  getBinArrayLowerUpperBinId,
  toAmountsBothSideByStrategy,
} from "../dlmm/helpers";
import {
  calculateTransferFeeExcludedAmount,
  getExtraAccountMetasForTransferHook,
} from "../dlmm/helpers/token_2022";
import { ActivationType, ResizeSide, StrategyType } from "../dlmm/types";
import { createExtraAccountMetaListAndCounter } from "./external/helper";
import {
  createTransferHookCounterProgram,
  TRANSFER_HOOK_COUNTER_PROGRAM_ID,
} from "./external/program";
import { createTestProgram } from "./helper";
import Decimal from "decimal.js";
import babar from "babar";

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

const program = createTestProgram(
  connection,
  new PublicKey(LBCLMM_PROGRAM_IDS["localhost"]),
  keypair
);

const nonExtendedPositionKeypair0 = Keypair.generate();
const nonExtendedPositionKeypair1 = Keypair.generate();

const extendedPositionKeypair0 = Keypair.generate();
const extendedPositionKeypair1 = Keypair.generate();

const MAX_ALLOWED_LAMPORT_LOSS = 500;

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
    const minLamports =
      await connection.getMinimumBalanceForRentExemption(mintLen);

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
      .accountsPartial({
        presetParameter: presetParameter2Key,
        admin: keypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const [btcTokenBadge] = deriveTokenBadge(BTC2022, program.programId);

    await program.methods
      .initializeTokenBadge()
      .accountsPartial({
        tokenBadge: btcTokenBadge,
        admin: keypair.publicKey,
        systemProgram: SystemProgram.programId,
        tokenMint: BTC2022,
      })
      .rpc();

    const [metTokenBadge] = deriveTokenBadge(MET2022, program.programId);

    await program.methods
      .initializeTokenBadge()
      .accountsPartial({
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
        .accountsPartial({
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
        .accountsPartial({
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
        positionPubKey: nonExtendedPositionKeypair0.publicKey,
        minBinId,
        maxBinId,
        user: keypair.publicKey,
      });

      await sendAndConfirmTransaction(
        connection,
        createPositionAndBinArraysTx,
        [keypair, nonExtendedPositionKeypair0]
      );

      const position = await dlmm.getPosition(
        nonExtendedPositionKeypair0.publicKey
      );
      expect(position.publicKey.toBase58()).toBe(
        nonExtendedPositionKeypair0.publicKey.toBase58()
      );

      const { positionData } = position;
      expect(positionData.lowerBinId).toBe(minBinId);
      expect(positionData.upperBinId).toBe(maxBinId);

      const binCount = maxBinId - minBinId + 1;
      expect(positionData.positionBinData.length).toBe(binCount);
    });

    it("create multiple empty position", async () => {
      const dlmm = await DLMM.create(connection, pairKey, opt);

      const minBinId =
        dlmm.lbPair.activeId - POSITION_MAX_LENGTH.toNumber() - 100;
      const maxBinId =
        dlmm.lbPair.activeId + POSITION_MAX_LENGTH.toNumber() + 100;

      const { positionKeypairs, initBinArrayTxs, initPositionTxs } =
        await dlmm.createMultipleEmptyPositions({
          minBinId,
          maxBinId,
          user: keypair.publicKey,
        });

      expect(positionKeypairs.length).toBe(3);

      await Promise.all([
        ...initBinArrayTxs.map((tx) =>
          sendAndConfirmTransaction(connection, tx, [keypair])
        ),
        ...initPositionTxs.map((tx, idx) =>
          sendAndConfirmTransaction(connection, tx, [
            positionKeypairs[idx],
            keypair,
          ])
        ),
      ]);
    });

    it("quote create multiple position", async () => {
      const dlmm = await DLMM.create(connection, pairKey, opt);

      const minBinId =
        dlmm.lbPair.activeId - POSITION_MAX_LENGTH.toNumber() - 100;
      const maxBinId =
        dlmm.lbPair.activeId + POSITION_MAX_LENGTH.toNumber() + 100;

      const { positionCost, positionCount, positionExtendCost } =
        await dlmm.quoteCreateMultiplePositions({
          strategy: {
            strategyType: StrategyType.Spot,
            minBinId,
            maxBinId,
          },
        });

      expect(positionCount).toBe(3);

      const { positionKeypairs, initPositionTxs } =
        await dlmm.createMultipleEmptyPositions({
          minBinId,
          maxBinId,
          user: keypair.publicKey,
        });

      expect(positionKeypairs.length).toBe(positionCount);

      await Promise.all(
        initPositionTxs.map((tx, idx) =>
          sendAndConfirmTransaction(connection, tx, [
            positionKeypairs[idx],
            keypair,
          ])
        )
      );

      const accounts = await connection.getMultipleAccountsInfo(
        positionKeypairs.map((k) => k.publicKey)
      );

      const totalRental = accounts
        .reduce((totalAmount, account) => {
          return new Decimal(totalAmount).add(account.lamports);
        }, new Decimal(0))
        .div(new Decimal(LAMPORTS_PER_SOL));

      expect(totalRental.toString()).toBe(
        positionCost.add(positionExtendCost).toString()
      );
    });

    it("quote extend position", async () => {
      const dlmm = await DLMM.create(connection, pairKey, opt);

      const minBinId =
        dlmm.lbPair.activeId - POSITION_MAX_LENGTH.toNumber() / 2;
      const maxBinId = minBinId + DEFAULT_BIN_PER_POSITION.toNumber() - 1;
      const extendedMaxBinId = minBinId + POSITION_MAX_LENGTH.toNumber() - 1;

      const initPositionTx = await dlmm.createEmptyPosition({
        positionPubKey: extendedPositionKeypair0.publicKey,
        minBinId,
        maxBinId,
        user: keypair.publicKey,
      });

      await sendAndConfirmTransaction(connection, initPositionTx, [
        extendedPositionKeypair0,
        keypair,
      ]);

      const lengthToIncrease = new BN(extendedMaxBinId - maxBinId);

      const beforePositionRental = await connection
        .getAccountInfo(extendedPositionKeypair0.publicKey)
        .then((account) =>
          new Decimal(account.lamports).div(new Decimal(LAMPORTS_PER_SOL))
        );

      const { positionExtendCost } = await dlmm.quoteExtendPosition(
        new BN(minBinId),
        new BN(maxBinId),
        lengthToIncrease
      );

      const extendPositionTxs = await dlmm.increasePositionLength(
        extendedPositionKeypair0.publicKey,
        ResizeSide.Upper,
        lengthToIncrease,
        keypair.publicKey,
        true
      );

      await Promise.all(
        extendPositionTxs.map((tx) =>
          sendAndConfirmTransaction(connection, tx, [keypair])
        )
      );

      const afterPositionRental = await connection
        .getAccountInfo(extendedPositionKeypair0.publicKey)
        .then((account) =>
          new Decimal(account.lamports).div(new Decimal(LAMPORTS_PER_SOL))
        );

      const rentalCost = afterPositionRental.sub(beforePositionRental);
      expect(rentalCost.toString()).toBe(positionExtendCost.toString());
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

  const assertUserTokenBalanceWithDelta = (
    beforeAccount: AccountInfo<Buffer>,
    afterAccount: AccountInfo<Buffer>,
    expectedAmount: BN,
    allowedLamportLoss?: number
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
    if (allowedLamportLoss) {
      const diff = expectedAmount.sub(deltaBn);
      expect(diff.lt(new BN(allowedLamportLoss))).toBeTruthy();
    } else {
      expect(deltaBn.toString()).toBe(expectedAmount.toString());
    }
  };

  const initializePositionAndAddLiquidityByStrategyIfNotExists = async (
    positionKeypair: Keypair,
    pairKey: PublicKey,
    totalXAmount: BN,
    totalYAmount: BN,
    strategyType: StrategyType,
    user: Keypair,
    extended = false
  ) => {
    const positionAccount = await connection.getAccountInfo(
      positionKeypair.publicKey
    );

    if (positionAccount) {
      return;
    }

    const dlmm = await DLMM.create(connection, pairKey, opt);

    if (extended) {
      const minBinId =
        dlmm.lbPair.activeId - POSITION_MAX_LENGTH.toNumber() / 2;

      const extendedMaxBinId = minBinId + POSITION_MAX_LENGTH.toNumber() - 1;
      const maxBinId = minBinId + DEFAULT_BIN_PER_POSITION.toNumber() - 1;

      const createEmptyPositionTx = await dlmm.createEmptyPosition({
        positionPubKey: positionKeypair.publicKey,
        minBinId,
        maxBinId,
        user: user.publicKey,
      });

      await sendAndConfirmTransaction(connection, createEmptyPositionTx, [
        positionKeypair,
        user,
      ]);

      const lengthToIncrease = extendedMaxBinId - maxBinId;

      const increasePositionLengthTxs = await dlmm.increasePositionLength(
        positionKeypair.publicKey,
        ResizeSide.Upper,
        new BN(lengthToIncrease),
        user.publicKey,
        true
      );

      await Promise.all(
        increasePositionLengthTxs.map((tx) =>
          sendAndConfirmTransaction(connection, tx, [user])
        )
      );
    } else {
      const minBinId =
        dlmm.lbPair.activeId - DEFAULT_BIN_PER_POSITION.toNumber() / 2;

      const maxBinId = minBinId + DEFAULT_BIN_PER_POSITION.toNumber() - 1;

      const createEmptyPositionTx = await dlmm.createEmptyPosition({
        positionPubKey: positionKeypair.publicKey,
        minBinId,
        maxBinId,
        user: user.publicKey,
      });

      await sendAndConfirmTransaction(connection, createEmptyPositionTx, [
        positionKeypair,
        user,
      ]);
    }

    const positionState = await dlmm.getPosition(positionKeypair.publicKey);

    const addLiquidityTxs = await dlmm.addLiquidityByStrategy({
      positionPubKey: positionKeypair.publicKey,
      totalXAmount,
      totalYAmount,
      strategy: {
        strategyType,
        minBinId: positionState.positionData.lowerBinId,
        maxBinId: positionState.positionData.upperBinId,
      },
      slippage: 0,
      user: user.publicKey,
    });

    await Promise.all(
      addLiquidityTxs.map((tx) =>
        sendAndConfirmTransaction(connection, tx, [user])
      )
    );
  };

  describe("Non extended position", () => {
    afterAll(async () => {
      const dlmm = await DLMM.create(connection, pairKey, opt);

      const positions = await Promise.all(
        [nonExtendedPositionKeypair0, nonExtendedPositionKeypair1].map(
          (positionKeypairs) => {
            return dlmm.getPosition(positionKeypairs.publicKey).catch((e) => {
              // console.error(e);
              return null;
            });
          }
        )
      );

      const nonEmptyPositions = positions.filter(Boolean).filter((position) => {
        const amountX = new BN(position.positionData.totalXAmount.toString());
        const amountY = new BN(position.positionData.totalYAmount.toString());
        return !amountX.isZero() || !amountY.isZero();
      });

      const withdrawAll = nonEmptyPositions.map((position) => {
        return dlmm.removeLiquidity({
          user: position.positionData.owner,
          position: position.publicKey,
          fromBinId: position.positionData.lowerBinId,
          toBinId: position.positionData.upperBinId,
          bps: new BN(BASIS_POINT_MAX),
        });
      });

      const withdrawAllTx = await Promise.all(withdrawAll);

      await Promise.all(
        withdrawAllTx.flat().map((tx) => {
          return sendAndConfirmTransaction(connection, tx, [keypair]);
        })
      );
    });

    describe("Add liquidity", () => {
      it("Add liquidity by strategy", async () => {
        const totalXAmount = new BN(100_000).mul(new BN(10 ** btcDecimal));
        const totalYAmount = new BN(100_000).mul(new BN(10 ** usdcDecimal));

        const dlmm = await DLMM.create(connection, pairKey, opt);
        let position = await dlmm.getPosition(
          nonExtendedPositionKeypair0.publicKey
        );

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

        const addLiquidityTxs = await dlmm.addLiquidityByStrategy({
          positionPubKey: nonExtendedPositionKeypair0.publicKey,
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

        await Promise.all(
          addLiquidityTxs.map((tx) =>
            sendAndConfirmTransaction(connection, tx, [keypair])
          )
        );

        position = await dlmm.getPosition(
          nonExtendedPositionKeypair0.publicKey
        );

        const [afterReserveXAccount, afterReserveYAccount] =
          await connection.getMultipleAccountsInfo([
            dlmm.tokenX.reserve,
            dlmm.tokenY.reserve,
          ]);

        const [computedInAmountX, computedInAmountY] =
          computedInBinAmount.reduce(
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

        // There will be some loss due to:
        // 1. SDK distribute amounts based on strategy (will have loss where total amount in bin <= deposit amount)
        // 2. Chunk the amounts into smaller bin range
        // 3. For each chunk, sum the amounts as deposit amount for the chunk
        // Due to amount feed into step 3 have loss (step 1), the deposit amount passed into the program will be lesser
        let diffX = computedInAmountX.sub(
          new BN(reserveXReceivedAmount.toString())
        );

        let diffY = computedInAmountY.sub(
          new BN(reserveYReceivedAmount.toString())
        );

        expect(diffX.toNumber()).toBeLessThan(MAX_ALLOWED_LAMPORT_LOSS);
        expect(diffY.toNumber()).toBeLessThan(MAX_ALLOWED_LAMPORT_LOSS);

        const positionXAmount = new BN(position.positionData.totalXAmount);
        const positionYAmount = new BN(position.positionData.totalYAmount);

        diffX = computedInAmountX.sub(positionXAmount);
        diffY = computedInAmountY.sub(positionYAmount);

        expect(diffX.toNumber()).toBeLessThan(MAX_ALLOWED_LAMPORT_LOSS);
        expect(diffY.toNumber()).toBeLessThan(MAX_ALLOWED_LAMPORT_LOSS);

        expect(positionXAmount.toString()).toBe(
          reserveXReceivedAmount.toString()
        );
        expect(positionYAmount.toString()).toBe(
          reserveYReceivedAmount.toString()
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
            positionPubKey: nonExtendedPositionKeypair1.publicKey,
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
          nonExtendedPositionKeypair1,
        ]);

        const [afterReserveXAccount, afterReserveYAccount] =
          await connection.getMultipleAccountsInfo([
            dlmm.tokenX.reserve,
            dlmm.tokenY.reserve,
          ]);

        await dlmm.refetchStates();

        const position = await dlmm.getPosition(
          nonExtendedPositionKeypair1.publicKey
        );
        expect(position.positionData.lowerBinId).toBe(minBinId);
        expect(position.positionData.upperBinId).toBe(maxBinId);

        const [computedInAmountX, computedInAmountY] =
          computedInBinAmount.reduce(
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
        expect(receivedYAmount.toString()).toBe(
          quoteResult.outAmount.toString()
        );
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

        expect(consumedYAmount.toString()).toBe(
          quoteResult.inAmount.toString()
        );
        expect(receivedXAmount.toString()).toBe(
          quoteResult.outAmount.toString()
        );
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

        expect(consumedXAmount.toString()).toBe(
          quoteResult.inAmount.toString()
        );
        expect(receivedYAmount.toString()).toBe(
          quoteResult.outAmount.toString()
        );
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
        expect(receivedXAmount.toString()).toBe(
          quoteResult.outAmount.toString()
        );
      });
    });

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

      describe("Claim swap fee", () => {
        it("Claim all swap fees", async () => {
          const dlmm = await DLMM.create(connection, pairKey, opt);

          const [beforeUserXAccount, beforeUserYAccount] =
            await connection.getMultipleAccountsInfo([userXAta, userYAta]);

          const [beforeP0, beforeP1] = await Promise.all([
            dlmm.getPosition(nonExtendedPositionKeypair0.publicKey),
            dlmm.getPosition(nonExtendedPositionKeypair1.publicKey),
          ]);

          const totalClaimableFeeX =
            beforeP0.positionData.feeXExcludeTransferFee.add(
              beforeP1.positionData.feeXExcludeTransferFee
            );

          const totalClaimableFeeY =
            beforeP0.positionData.feeYExcludeTransferFee.add(
              beforeP1.positionData.feeYExcludeTransferFee
            );

          const claimFeeTxs = await dlmm.claimAllSwapFee({
            owner: keypair.publicKey,
            positions: [beforeP0, beforeP1],
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

          const [afterP0, afterP1] = await Promise.all([
            dlmm.getPosition(nonExtendedPositionKeypair0.publicKey),
            dlmm.getPosition(nonExtendedPositionKeypair1.publicKey),
          ]);

          expect(afterP0.positionData.feeX.isZero()).toBeTruthy();
          expect(afterP0.positionData.feeY.isZero()).toBeTruthy();

          expect(afterP1.positionData.feeX.isZero()).toBeTruthy();
          expect(afterP1.positionData.feeY.isZero()).toBeTruthy();
        });

        it("Claim swap fee", async () => {
          const dlmm = await DLMM.create(connection, pairKey, opt);

          for (const positionKey of [
            nonExtendedPositionKeypair0.publicKey,
            nonExtendedPositionKeypair1.publicKey,
          ]) {
            const beforePosition = await dlmm.getPosition(positionKey);

            const [beforeUserXAccount, beforeUserYAccount] =
              await connection.getMultipleAccountsInfo([userXAta, userYAta]);

            const claimFeeTxs = await dlmm.claimSwapFee({
              owner: keypair.publicKey,
              position: beforePosition,
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
            nonExtendedPositionKeypair0.publicKey,
            nonExtendedPositionKeypair1.publicKey,
          ]) {
            const dlmm = await DLMM.create(connection, pairKey, opt);
            const position = await dlmm.getPosition(positionKey);

            const beforeUserRewardAccount =
              await connection.getAccountInfo(userRewardAta);

            const claimTxs = await dlmm.claimLMReward({
              owner: keypair.publicKey,
              position,
            });

            await Promise.all(
              claimTxs.map((tx) =>
                sendAndConfirmTransaction(connection, tx, [keypair])
              )
            );

            const afterUserRewardAccount =
              await connection.getAccountInfo(userRewardAta);

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
              claimedReward.gte(
                position.positionData.rewardOneExcludeTransferFee
              )
            ).toBeTruthy();
          }
        });

        it("Claim all rewards", async () => {
          const dlmm = await DLMM.create(connection, pairKey, opt);

          const beforeUserRewardAccount =
            await connection.getAccountInfo(userRewardAta);

          const [beforeP0, beforeP1] = await Promise.all([
            dlmm.getPosition(nonExtendedPositionKeypair0.publicKey),
            dlmm.getPosition(nonExtendedPositionKeypair1.publicKey),
          ]);

          const totalClaimableReward0 =
            beforeP0.positionData.rewardOneExcludeTransferFee.add(
              beforeP1.positionData.rewardOneExcludeTransferFee
            );

          const claimTxs = await dlmm.claimAllLMRewards({
            owner: keypair.publicKey,
            positions: [beforeP0, beforeP1],
          });

          expect(claimTxs.length).toBeGreaterThanOrEqual(1);

          await Promise.all(
            claimTxs.map((tx) =>
              sendAndConfirmTransaction(connection, tx, [keypair])
            )
          );

          const afterUserRewardAccount =
            await connection.getAccountInfo(userRewardAta);

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

          const [afterP0, afterP1] = await Promise.all([
            dlmm.getPosition(nonExtendedPositionKeypair0.publicKey),
            dlmm.getPosition(nonExtendedPositionKeypair1.publicKey),
          ]);

          expect(
            afterP0.positionData.rewardOneExcludeTransferFee.lt(
              beforeP0.positionData.rewardOneExcludeTransferFee
            )
          ).toBeTruthy();
          expect(
            afterP1.positionData.rewardOneExcludeTransferFee.lt(
              beforeP1.positionData.rewardOneExcludeTransferFee
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
            nonExtendedPositionKeypair0.publicKey,
            nonExtendedPositionKeypair1.publicKey,
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

            const [
              afterUserRewardAccount,
              afterUserXAccount,
              afterUserYAccount,
            ] = await connection.getMultipleAccountsInfo([
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

          const [beforeP0, beforeP1] = await Promise.all([
            dlmm.getPosition(nonExtendedPositionKeypair0.publicKey),
            dlmm.getPosition(nonExtendedPositionKeypair1.publicKey),
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
            beforeP0.positionData.feeXExcludeTransferFee.add(
              beforeP1.positionData.feeXExcludeTransferFee
            );

          const totalClaimableFeeY =
            beforeP0.positionData.feeYExcludeTransferFee.add(
              beforeP1.positionData.feeYExcludeTransferFee
            );

          const totalClaimableReward =
            beforeP0.positionData.rewardOneExcludeTransferFee.add(
              beforeP1.positionData.rewardOneExcludeTransferFee
            );

          const claimTxs = await dlmm.claimAllRewards({
            owner: keypair.publicKey,
            positions: [beforeP0, beforeP1],
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

          const [afterP0, afterP1] = await Promise.all([
            dlmm.getPosition(nonExtendedPositionKeypair0.publicKey),
            dlmm.getPosition(nonExtendedPositionKeypair1.publicKey),
          ]);

          expect(afterP0.positionData.feeX.isZero()).toBeTruthy();
          expect(afterP0.positionData.feeY.isZero()).toBeTruthy();

          expect(afterP1.positionData.feeX.isZero()).toBeTruthy();
          expect(afterP1.positionData.feeY.isZero()).toBeTruthy();

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

    describe("Remove liquidity", () => {
      beforeAll(async () => {
        await generateSwapFees();
        // Generate some reward
        await new Promise((res) => setTimeout(res, 1000));
      });

      it("Remove liquidity without claim and close successfully", async () => {
        const dlmm = await DLMM.create(connection, pairKey, opt);

        const beforePosition = await dlmm.getPosition(
          nonExtendedPositionKeypair0.publicKey
        );

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
          position: nonExtendedPositionKeypair0.publicKey,
          fromBinId,
          toBinId,
          bps: new BN(BASIS_POINT_MAX),
          user: keypair.publicKey,
          shouldClaimAndClose: false,
        });

        await Promise.all(
          removeLiquidityTxs.map((tx) =>
            sendAndConfirmTransaction(connection, tx, [keypair])
          )
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

        const beforePosition = await dlmm.getPosition(
          nonExtendedPositionKeypair0.publicKey
        );

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
          position: nonExtendedPositionKeypair0.publicKey,
          fromBinId,
          toBinId,
          bps: new BN(BASIS_POINT_MAX),
          user: keypair.publicKey,
          shouldClaimAndClose: true,
        })) as Transaction[];

        expect(Array.isArray(removeLiquidityTxs)).toBeTruthy();
        expect(removeLiquidityTxs.length).toBeGreaterThanOrEqual(1);

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
          nonExtendedPositionKeypair0.publicKey
        );

        expect(positionAccount).toBeNull();
      });
    });
  });

  describe("Extended position", () => {
    describe("Extend / Shrink position", () => {
      it("Increase from 1 to 1400 max length", async () => {
        const dlmm = await DLMM.create(connection, pairKey, opt);
        const sides = [ResizeSide.Lower, ResizeSide.Upper];

        for (const side of sides) {
          const positionKp = Keypair.generate();

          const initPositionTx = await dlmm.createEmptyPosition({
            positionPubKey: positionKp.publicKey,
            minBinId: dlmm.lbPair.activeId,
            maxBinId: dlmm.lbPair.activeId,
            user: keypair.publicKey,
          });

          await sendAndConfirmTransaction(connection, initPositionTx, [
            positionKp,
            keypair,
          ]);

          const beforePositionState = await dlmm.getPosition(
            positionKp.publicKey
          );

          const width =
            beforePositionState.positionData.upperBinId -
            beforePositionState.positionData.lowerBinId +
            1;

          const expandPositionTxs = await dlmm.increasePositionLength(
            positionKp.publicKey,
            side,
            POSITION_MAX_LENGTH.sub(new BN(width)),
            keypair.publicKey
          );

          await Promise.all(
            expandPositionTxs.map((tx) => {
              return sendAndConfirmTransaction(connection, tx, [keypair]);
            })
          );

          const afterPositionState = await dlmm.getPosition(
            positionKp.publicKey
          );

          const newWidth =
            afterPositionState.positionData.upperBinId -
            afterPositionState.positionData.lowerBinId +
            1;

          expect(newWidth).toBe(POSITION_MAX_LENGTH.toNumber());

          switch (side) {
            case ResizeSide.Lower: {
              expect(afterPositionState.positionData.lowerBinId).toBeLessThan(
                beforePositionState.positionData.lowerBinId
              );
              break;
            }
            case ResizeSide.Upper: {
              expect(
                afterPositionState.positionData.upperBinId
              ).toBeGreaterThan(beforePositionState.positionData.upperBinId);
              break;
            }
          }
        }
      });

      it("Decrease from 1400 max length to 1", async () => {
        const dlmm = await DLMM.create(connection, pairKey, opt);
        const sides = [ResizeSide.Lower, ResizeSide.Upper];

        for (const side of sides) {
          const positionKp = Keypair.generate();

          const initPositionTx = await dlmm.createEmptyPosition({
            positionPubKey: positionKp.publicKey,
            minBinId: dlmm.lbPair.activeId,
            maxBinId: dlmm.lbPair.activeId,
            user: keypair.publicKey,
          });

          await sendAndConfirmTransaction(connection, initPositionTx, [
            positionKp,
            keypair,
          ]);

          const beforePositionState = await dlmm.getPosition(
            positionKp.publicKey
          );

          const width =
            beforePositionState.positionData.upperBinId -
            beforePositionState.positionData.lowerBinId +
            1;

          const expandPositionTxs = await dlmm.increasePositionLength(
            positionKp.publicKey,
            side,
            POSITION_MAX_LENGTH.sub(new BN(width)),
            keypair.publicKey
          );

          await Promise.all(
            expandPositionTxs.map((tx) => {
              return sendAndConfirmTransaction(connection, tx, [keypair]);
            })
          );

          let afterPositionState = await dlmm.getPosition(positionKp.publicKey);

          let newWidth =
            afterPositionState.positionData.upperBinId -
            afterPositionState.positionData.lowerBinId +
            1;

          expect(newWidth).toBe(POSITION_MAX_LENGTH.toNumber());

          const shrinkPositionTxs = await dlmm.decreasePositionLength(
            positionKp.publicKey,
            side,
            POSITION_MAX_LENGTH,
            true
          );

          await Promise.all(
            shrinkPositionTxs.map((tx) => {
              return sendAndConfirmTransaction(connection, tx, [keypair]);
            })
          );

          afterPositionState = await dlmm.getPosition(positionKp.publicKey);
          newWidth =
            afterPositionState.positionData.upperBinId -
            afterPositionState.positionData.lowerBinId +
            1;

          expect(newWidth).toBe(1);
        }
      });
    });

    describe("Add liquidity", () => {
      it("Add liquidity by strategy", async () => {
        const totalXAmount = new BN(10_000_000).mul(new BN(10 ** btcDecimal));
        const totalYAmount = new BN(10_000_000).mul(new BN(10 ** usdcDecimal));

        const dlmm = await DLMM.create(connection, pairKey, opt);
        let position = await dlmm.getPosition(
          extendedPositionKeypair0.publicKey
        );

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
          StrategyType.Curve,
          dlmm.tokenX.mint,
          dlmm.tokenY.mint,
          dlmm.clock
        );

        const addLiquidityTxs = await dlmm.addLiquidityByStrategy({
          positionPubKey: extendedPositionKeypair0.publicKey,
          totalXAmount,
          totalYAmount,
          user: keypair.publicKey,
          strategy: {
            strategyType: StrategyType.Curve,
            minBinId: position.positionData.lowerBinId,
            maxBinId: position.positionData.upperBinId,
          },
          slippage: 0,
        });

        expect(addLiquidityTxs.length).toBeGreaterThan(1);

        const [beforeReserveXAccount, beforeReserveYAccount] =
          await connection.getMultipleAccountsInfo([
            dlmm.tokenX.reserve,
            dlmm.tokenY.reserve,
          ]);

        await Promise.allSettled(
          addLiquidityTxs.map((tx) =>
            sendAndConfirmTransaction(connection, tx, [keypair])
          )
        );

        position = await dlmm.getPosition(extendedPositionKeypair0.publicKey);

        const [afterReserveXAccount, afterReserveYAccount] =
          await connection.getMultipleAccountsInfo([
            dlmm.tokenX.reserve,
            dlmm.tokenY.reserve,
          ]);

        const [computedInAmountX, computedInAmountY] =
          computedInBinAmount.reduce(
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

        let xDiff = computedInAmountX.sub(
          new BN(reserveXReceivedAmount.toString())
        );

        let yDiff = computedInAmountY.sub(
          new BN(reserveYReceivedAmount.toString())
        );

        expect(xDiff.toNumber()).toBeLessThan(MAX_ALLOWED_LAMPORT_LOSS);
        expect(yDiff.toNumber()).toBeLessThan(MAX_ALLOWED_LAMPORT_LOSS);

        const positionXAmount = new BN(position.positionData.totalXAmount);
        const positionYAmount = new BN(position.positionData.totalYAmount);

        xDiff = computedInAmountX.sub(positionXAmount);
        yDiff = computedInAmountY.sub(positionYAmount);

        expect(xDiff.toNumber()).toBeLessThan(MAX_ALLOWED_LAMPORT_LOSS);
        expect(yDiff.toNumber()).toBeLessThan(MAX_ALLOWED_LAMPORT_LOSS);

        expect(positionXAmount.add(xDiff).toString()).toBe(
          computedInAmountX.toString()
        );
        expect(positionYAmount.add(yDiff).toString()).toBe(
          computedInAmountY.toString()
        );
      });

      it("Initialize multiple positions and add liquidity by strategy", async () => {
        const dlmm = await DLMM.create(connection, pairKey, opt);
        const totalXAmount = new BN(10_000_000).mul(new BN(10 ** btcDecimal));
        const totalYAmount = new BN(10_000_000).mul(new BN(10 ** usdcDecimal));

        const minBinId =
          dlmm.lbPair.activeId - 100 - POSITION_MAX_LENGTH.toNumber();
        const maxBinId =
          dlmm.lbPair.activeId + 100 + POSITION_MAX_LENGTH.toNumber();

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
          StrategyType.Curve,
          dlmm.tokenX.mint,
          dlmm.tokenY.mint,
          dlmm.clock
        );

        const { positionKeypairs, initPositionIxs, addLiquidityIxs } =
          await dlmm.initializeMultiplePositionAndAddLiquidityByStrategy({
            totalXAmount,
            totalYAmount,
            strategy: {
              strategyType: StrategyType.Curve,
              minBinId,
              maxBinId,
            },
            user: keypair.publicKey,
            slippage: 0,
          });

        const [beforeReserveXAccount, beforeReserveYAccount] =
          await connection.getMultipleAccountsInfo([
            dlmm.tokenX.reserve,
            dlmm.tokenY.reserve,
          ]);

        await Promise.all(
          initPositionIxs.map((tx, idx) =>
            sendAndConfirmTransaction(connection, tx, [
              positionKeypairs[idx],
              keypair,
            ])
          )
        );

        await Promise.allSettled(
          addLiquidityIxs.map((tx, idx) =>
            sendAndConfirmTransaction(connection, tx, [keypair])
          )
        );

        const [afterReserveXAccount, afterReserveYAccount] =
          await connection.getMultipleAccountsInfo([
            dlmm.tokenX.reserve,
            dlmm.tokenY.reserve,
          ]);

        const [computedInAmountX, computedInAmountY] =
          computedInBinAmount.reduce(
            ([totalXAmount, totalYAmount], { amountX, amountY }) => {
              return [totalXAmount.add(amountX), totalYAmount.add(amountY)];
            },
            [new BN(0), new BN(0)]
          );

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

        let xDiff = computedInAmountX.sub(
          new BN(reserveXReceivedAmount.toString())
        );

        let yDiff = computedInAmountY.sub(
          new BN(reserveYReceivedAmount.toString())
        );

        const CUSTOM_MAX_ALLOWED_LAMPORT_LOSS =
          MAX_ALLOWED_LAMPORT_LOSS * positionKeypairs.length;

        expect(xDiff.toNumber()).toBeLessThan(CUSTOM_MAX_ALLOWED_LAMPORT_LOSS);
        expect(yDiff.toNumber()).toBeLessThan(CUSTOM_MAX_ALLOWED_LAMPORT_LOSS);

        const positions = await Promise.all(
          positionKeypairs.map((positionKeypair) => {
            return dlmm.getPosition(positionKeypair.publicKey);
          })
        );

        const totalPositionXAmount = positions.reduce(
          (totalAmount, position) => {
            return totalAmount.add(new BN(position.positionData.totalXAmount));
          },
          new BN(0)
        );

        const totalPositionYAmount = positions.reduce(
          (totalAmount, position) => {
            return totalAmount.add(new BN(position.positionData.totalYAmount));
          },
          new BN(0)
        );

        xDiff = computedInAmountX.sub(totalPositionXAmount);
        yDiff = computedInAmountY.sub(totalPositionYAmount);

        expect(xDiff.toNumber()).toBeLessThan(CUSTOM_MAX_ALLOWED_LAMPORT_LOSS);
        expect(yDiff.toNumber()).toBeLessThan(CUSTOM_MAX_ALLOWED_LAMPORT_LOSS);

        expect(totalPositionXAmount.toString()).toBe(
          reserveXReceivedAmount.toString()
        );
        expect(totalPositionYAmount.toString()).toBe(
          reserveYReceivedAmount.toString()
        );

        await dlmm.refetchStates();
        const binArrays = await dlmm.getBinArrays();
        // Just for checking purpose. Leaving it here in case needed in the future
        const labels = [];
        const dataPoints = [];
        const xyPoints = [];

        for (const binArray of binArrays.sort((a, b) =>
          a.account.index.cmp(b.account.index)
        )) {
          let [binId] = getBinArrayLowerUpperBinId(binArray.account.index);

          for (const bin of binArray.account.bins) {
            const binPrice = new Decimal(bin.price.toString()).div(
              new Decimal(2).pow(new Decimal(64))
            );

            const binLiquidity = new Decimal(bin.amountX.toString())
              .mul(binPrice)
              .add(new Decimal(bin.amountY.toString()));
            // const binLiquidity = new Decimal(bin.amountX.toString());

            if (binLiquidity.gt(new Decimal(0))) {
              labels.push(binId.toNumber());
              dataPoints.push(binLiquidity.toNumber());
              xyPoints.push([binId.toNumber(), binLiquidity.toNumber()]);
            }

            binId = binId.addn(1);
          }
        }

        console.log(babar(xyPoints));

        // fs.writeFileSync("./labels.json", JSON.stringify(labels));
        // fs.writeFileSync("./dataPoints.json", JSON.stringify(dataPoints));
      });
    });

    describe("Claim fees and rewards", () => {
      let userXAta: PublicKey, userYAta: PublicKey, userRewardAta: PublicKey;

      beforeEach(async () => {
        const dlmm = await DLMM.create(connection, pairKey, opt);

        const totalXAmount = new BN(10_000_000).mul(new BN(10 ** btcDecimal));
        const totalYAmount = new BN(10_000_000).mul(new BN(10 ** usdcDecimal));

        await Promise.allSettled(
          [extendedPositionKeypair0, extendedPositionKeypair1].map(
            (positionKeypair) => {
              return initializePositionAndAddLiquidityByStrategyIfNotExists(
                positionKeypair,
                pairKey,
                totalXAmount,
                totalYAmount,
                StrategyType.Spot,
                keypair,
                true
              );
            }
          )
        );

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

      describe("Claim swap fee", () => {
        it("Claim all swap fees", async () => {
          const dlmm = await DLMM.create(connection, pairKey, opt);

          const [beforeUserXAccount, beforeUserYAccount] =
            await connection.getMultipleAccountsInfo([userXAta, userYAta]);

          const [beforeP0, beforeP1] = await Promise.all([
            dlmm.getPosition(extendedPositionKeypair0.publicKey),
            dlmm.getPosition(extendedPositionKeypair1.publicKey),
          ]);

          const totalClaimableFeeX =
            beforeP0.positionData.feeXExcludeTransferFee.add(
              beforeP1.positionData.feeXExcludeTransferFee
            );

          const totalClaimableFeeY =
            beforeP0.positionData.feeYExcludeTransferFee.add(
              beforeP1.positionData.feeYExcludeTransferFee
            );

          const claimFeeTxs = await dlmm.claimAllSwapFee({
            owner: keypair.publicKey,
            positions: [beforeP0, beforeP1],
          });

          expect(claimFeeTxs.length).toBeGreaterThanOrEqual(1);

          await Promise.allSettled(
            claimFeeTxs.map((tx) =>
              sendAndConfirmTransaction(connection, tx, [keypair])
            )
          );

          const [afterUserXAccount, afterUserYAccount] =
            await connection.getMultipleAccountsInfo([userXAta, userYAta]);

          // Due to chunked claim fee. Everytime when claim fee, the transfer fee will charge 1 extra lamport due to round up. Therefore, the actual claimed amount will have few lamport lesser
          assertUserTokenBalanceWithDelta(
            beforeUserXAccount,
            afterUserXAccount,
            totalClaimableFeeX,
            5
          );

          assertUserTokenBalanceWithDelta(
            beforeUserYAccount,
            afterUserYAccount,
            totalClaimableFeeY
          );

          const [afterP0, afterP1] = await Promise.all([
            dlmm.getPosition(extendedPositionKeypair0.publicKey),
            dlmm.getPosition(extendedPositionKeypair1.publicKey),
          ]);

          expect(afterP0.positionData.feeX.isZero()).toBeTruthy();
          expect(afterP0.positionData.feeY.isZero()).toBeTruthy();

          expect(afterP1.positionData.feeX.isZero()).toBeTruthy();
          expect(afterP1.positionData.feeY.isZero()).toBeTruthy();
        });

        it("Claim swap fee", async () => {
          const dlmm = await DLMM.create(connection, pairKey, opt);

          const positionKey = extendedPositionKeypair0.publicKey;
          const beforePosition = await dlmm.getPosition(positionKey);

          const [beforeUserXAccount, beforeUserYAccount] =
            await connection.getMultipleAccountsInfo([userXAta, userYAta]);

          const claimFeeTxs = await dlmm.claimSwapFee({
            owner: keypair.publicKey,
            position: beforePosition,
          });

          await Promise.allSettled(
            claimFeeTxs.map((tx) =>
              sendAndConfirmTransaction(connection, tx, [keypair])
            )
          );

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
        });
      });

      describe("Claim rewards", () => {
        beforeEach(async () => {
          // Generate some fees
          await new Promise((res) => setTimeout(res, 1000));
        });

        it("Claim reward", async () => {
          const dlmm = await DLMM.create(connection, pairKey, opt);
          const positionKey = extendedPositionKeypair0.publicKey;
          const position = await dlmm.getPosition(positionKey);

          const beforeUserRewardAccount =
            await connection.getAccountInfo(userRewardAta);

          const claimTxs = await dlmm.claimLMReward({
            owner: keypair.publicKey,
            position,
          });

          await Promise.allSettled(
            claimTxs.map((tx) =>
              sendAndConfirmTransaction(connection, tx, [keypair])
            )
          );

          const afterUserRewardAccount =
            await connection.getAccountInfo(userRewardAta);

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
        });

        it("Claim all rewards", async () => {
          const dlmm = await DLMM.create(connection, pairKey, opt);

          const beforeUserRewardAccount =
            await connection.getAccountInfo(userRewardAta);

          const [beforeP0, beforeP1] = await Promise.all([
            dlmm.getPosition(extendedPositionKeypair0.publicKey),
            dlmm.getPosition(extendedPositionKeypair1.publicKey),
          ]);

          const totalClaimableReward0 =
            beforeP0.positionData.rewardOneExcludeTransferFee.add(
              beforeP1.positionData.rewardOneExcludeTransferFee
            );

          const claimTxs = await dlmm.claimAllLMRewards({
            owner: keypair.publicKey,
            positions: [beforeP0, beforeP1],
          });

          expect(claimTxs.length).toBeGreaterThanOrEqual(1);

          await Promise.allSettled(
            claimTxs.map((tx) =>
              sendAndConfirmTransaction(connection, tx, [keypair])
            )
          );

          const afterUserRewardAccount =
            await connection.getAccountInfo(userRewardAta);

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

          const [afterP0, afterP1] = await Promise.all([
            dlmm.getPosition(extendedPositionKeypair0.publicKey),
            dlmm.getPosition(extendedPositionKeypair0.publicKey),
          ]);

          expect(
            afterP0.positionData.rewardOneExcludeTransferFee.lt(
              beforeP0.positionData.rewardOneExcludeTransferFee
            )
          ).toBeTruthy();
          expect(
            afterP1.positionData.rewardOneExcludeTransferFee.lt(
              beforeP1.positionData.rewardOneExcludeTransferFee
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
            extendedPositionKeypair0.publicKey,
            extendedPositionKeypair1.publicKey,
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

            await Promise.allSettled(
              claimTxs.map((tx) => {
                return sendAndConfirmTransaction(connection, tx, [keypair]);
              })
            );

            const afterPositionState = await dlmm.getPosition(positionKey);
            expect(afterPositionState.positionData.feeX.isZero()).toBeTruthy();
            expect(afterPositionState.positionData.feeY.isZero()).toBeTruthy();

            const [
              afterUserRewardAccount,
              afterUserXAccount,
              afterUserYAccount,
            ] = await connection.getMultipleAccountsInfo([
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

            assertUserTokenBalanceWithDelta(
              beforeUserXAccount,
              afterUserXAccount,
              beforePositionState.positionData.feeXExcludeTransferFee,
              5
            );

            assertUserTokenBalanceWithDelta(
              beforeUserYAccount,
              afterUserYAccount,
              beforePositionState.positionData.feeYExcludeTransferFee
            );
          }
        });

        it("Claim all positions fees and rewards", async () => {
          const dlmm = await DLMM.create(connection, pairKey, opt);

          const [beforeP0, beforeP1] = await Promise.all([
            dlmm.getPosition(extendedPositionKeypair0.publicKey),
            dlmm.getPosition(extendedPositionKeypair1.publicKey),
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
            beforeP0.positionData.feeXExcludeTransferFee.add(
              beforeP1.positionData.feeXExcludeTransferFee
            );

          const totalClaimableFeeY =
            beforeP0.positionData.feeYExcludeTransferFee.add(
              beforeP1.positionData.feeYExcludeTransferFee
            );

          const totalClaimableReward =
            beforeP0.positionData.rewardOneExcludeTransferFee.add(
              beforeP1.positionData.rewardOneExcludeTransferFee
            );

          const claimTxs = await dlmm.claimAllRewards({
            owner: keypair.publicKey,
            positions: [beforeP0, beforeP1],
          });

          expect(claimTxs.length).toBeGreaterThanOrEqual(1);

          // Why duplicate tx?
          await Promise.allSettled(
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

          const [afterP0, afterP1] = await Promise.all([
            dlmm.getPosition(extendedPositionKeypair0.publicKey),
            dlmm.getPosition(extendedPositionKeypair1.publicKey),
          ]);

          expect(afterP0.positionData.feeX.isZero()).toBeTruthy();
          expect(afterP0.positionData.feeY.isZero()).toBeTruthy();

          expect(afterP1.positionData.feeX.isZero()).toBeTruthy();
          expect(afterP1.positionData.feeY.isZero()).toBeTruthy();

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

          // Chunk claim reward on token with transfer fee will causes total claimed reward to be lesser due to token transfer fee round up. However, the LM might still generating which causes claimed reward > current calculated reward.
          // Therefore we check reward diff instead of amount.
          const claimedRewardDiff =
            actualClaimedReward.sub(totalClaimableReward);

          if (claimedRewardDiff.isNeg()) {
            expect(claimedRewardDiff.abs().toNumber()).toBeLessThanOrEqual(10);
          } else {
            expect(actualClaimedReward.gte(totalClaimableReward)).toBeTruthy();
          }

          assertUserTokenBalanceWithDelta(
            beforeUserXAccount,
            afterUserXAccount,
            totalClaimableFeeX,
            5
          );

          assertUserTokenBalanceWithDelta(
            beforeUserYAccount,
            afterUserYAccount,
            totalClaimableFeeY
          );
        });
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
});
