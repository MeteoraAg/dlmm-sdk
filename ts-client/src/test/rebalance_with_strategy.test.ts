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
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import fs from "fs";
import { BASIS_POINT_MAX, LBCLMM_PROGRAM_IDS } from "../dlmm/constants";
import IDL from "../dlmm/dlmm.json";
import {
  deriveLbPairWithPresetParamWithIndexKey,
  derivePresetParameterWithIndex,
  Opt,
} from "../dlmm/helpers";
import { DLMM } from "../dlmm/index";
import { StrategyType } from "../dlmm/types";
import {
  assertEqRebalanceSimulationWithActualResult,
  assertionWithPercentageTolerance,
  assertionWithTolerance,
  createTestProgram,
  logPositionLiquidities,
  swap,
} from "./helper";

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

const CONSTANTS = Object.entries(IDL.constants);
export const MAX_BIN_PER_ARRAY = new BN(
  CONSTANTS.find(([k, v]) => v.name == "MAX_BIN_PER_ARRAY")[1].value
);

const DEFAULT_ACTIVE_ID = new BN(1);
const DEFAULT_BIN_STEP = new BN(10);
const DEFAULT_BASE_FACTOR_2 = new BN(4000);

const programId = new web3.PublicKey(LBCLMM_PROGRAM_IDS["localhost"]);
const opt: Opt = { cluster: "localhost" };

let BTC: web3.PublicKey;
let USDC: web3.PublicKey;
let lbPairPubkey: web3.PublicKey;
let userBTC: web3.PublicKey;
let userUSDC: web3.PublicKey;
let presetParamPda2: web3.PublicKey;
let position: web3.PublicKey;

async function closeAndCreateNewPositionWithSpotLiquidity(
  dlmm: DLMM,
  owner: Keypair
) {
  if (position) {
    const positionState = await dlmm.program.account.positionV2.fetch(position);
    const dlmm2 = await DLMM.create(
      dlmm.program.provider.connection,
      positionState.lbPair,
      opt
    );

    const txs = await dlmm2.removeLiquidity({
      user: owner.publicKey,
      position,
      fromBinId: positionState.lowerBinId,
      toBinId: positionState.upperBinId,
      shouldClaimAndClose: true,
      bps: new BN(BASIS_POINT_MAX),
    });

    await Promise.all(
      txs.map((tx) => sendAndConfirmTransaction(connection, tx, [owner]))
    );
  }
  console.log("Create empty position");
  const positionKp = Keypair.generate();
  position = positionKp.publicKey;

  const lowerBinId = DEFAULT_ACTIVE_ID.subn(34);
  const upperBinId = DEFAULT_ACTIVE_ID.addn(34);

  let rawTx = await dlmm.createEmptyPosition({
    positionPubKey: position,
    minBinId: lowerBinId.toNumber(),
    maxBinId: upperBinId.toNumber(),
    user: keypair.publicKey,
  });

  await sendAndConfirmTransaction(connection, rawTx, [positionKp, keypair]);

  const positionState = await dlmm.program.account.positionV2.fetch(position);

  rawTx = await dlmm.addLiquidityByStrategy({
    positionPubKey: position,
    totalXAmount: new BN(1_000_000_000),
    totalYAmount: new BN(1_000_000_000),
    strategy: {
      strategyType: StrategyType.Spot,
      minBinId: positionState.lowerBinId,
      maxBinId: positionState.upperBinId,
    },
    user: keypair.publicKey,
    slippage: 0,
  });

  await sendAndConfirmTransaction(connection, rawTx, [keypair]);
}

describe("Rebalance with strategy", () => {
  beforeEach(async () => {
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

    const { presetParameter2 } = await DLMM.getAllPresetParameters(
      connection,
      opt
    );

    const index = new BN(presetParameter2.length);

    [presetParamPda2] = derivePresetParameterWithIndex(index, programId);

    const program = createTestProgram(connection, programId, keypair);

    const presetParamState2 =
      await program.account.presetParameter.fetchNullable(presetParamPda2);

    if (!presetParamState2) {
      await program.methods
        .initializePresetParameter2({
          index: index.toNumber(),
          binStep: DEFAULT_BIN_STEP.toNumber(),
          baseFactor: DEFAULT_BASE_FACTOR_2.toNumber(),
          filterPeriod: 30,
          decayPeriod: 600,
          reductionFactor: 5000,
          variableFeeControl: 40000,
          protocolShare: 0,
          maxVolatilityAccumulator: 350000,
          baseFeePowerFactor: 0,
        })
        .accountsPartial({
          admin: keypair.publicKey,
          presetParameter: presetParamPda2,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([keypair])
        .rpc({
          commitment: "confirmed",
        });
    }

    console.log("Create lb pair");
    let rawTx = await DLMM.createLbPair2(
      connection,
      keypair.publicKey,
      BTC,
      USDC,
      presetParamPda2,
      DEFAULT_ACTIVE_ID,
      opt
    );
    await sendAndConfirmTransaction(connection, rawTx, [keypair]);

    [lbPairPubkey] = deriveLbPairWithPresetParamWithIndexKey(
      presetParamPda2,
      BTC,
      USDC,
      programId
    );

    const dlmm = await DLMM.create(connection, lbPairPubkey, opt);
  });

  describe("Balanced strategy", () => {
    it("Without adjust liquidity", async () => {
      for (const strategy of [
        StrategyType.Spot,
        StrategyType.Curve,
        StrategyType.BidAsk,
      ]) {
        const dlmm = await DLMM.create(connection, lbPairPubkey, opt);
        await closeAndCreateNewPositionWithSpotLiquidity(dlmm, keypair);

        for (const swapForY of [true, false]) {
          console.log(`Before swap active id ${dlmm.lbPair.activeId}`);
          await swap(swapForY, new BN(250_000_000), dlmm, keypair);
          await dlmm.refetchStates();
          console.log(`After swap active id ${dlmm.lbPair.activeId}`);

          let parsedPosition = await dlmm.getPosition(position);

          let beforeBinPerBidSide =
            dlmm.lbPair.activeId - parsedPosition.positionData.lowerBinId;
          let beforeBinPerAskSide =
            parsedPosition.positionData.upperBinId - dlmm.lbPair.activeId;

          const { rebalancePosition, simulationResult } =
            await dlmm.simulateRebalancePositionWithBalancedStrategy(
              position,
              parsedPosition.positionData,
              strategy,
              new BN(0),
              new BN(0),
              new BN(0),
              new BN(0)
            );

          const { initBinArrayInstructions, rebalancePositionInstruction } =
            await dlmm.rebalancePosition(
              { rebalancePosition, simulationResult },
              new BN(0),
              keypair.publicKey,
              0
            );

          let latestBlockHash = await connection.getLatestBlockhash();

          await Promise.all(
            initBinArrayInstructions.map((ix) =>
              sendAndConfirmTransaction(
                connection,
                new Transaction({ ...latestBlockHash }).add(ix),
                [keypair]
              )
            )
          );

          latestBlockHash = await connection.getLatestBlockhash();

          const beforeUsdcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userUSDC)
            .then((acc) => new BN(acc.value.amount));

          const beforeBtcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userBTC)
            .then((acc) => new BN(acc.value.amount));

          await sendAndConfirmTransaction(
            connection,
            new Transaction({ ...latestBlockHash }).add(
              ...rebalancePositionInstruction
            ),
            [keypair]
          );

          const afterUsdcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userUSDC)
            .then((acc) => new BN(acc.value.amount));

          const afterBtcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userBTC)
            .then((acc) => new BN(acc.value.amount));

          expect(afterUsdcBalance.gte(beforeUsdcBalance)).toBeTruthy();
          expect(afterBtcBalance.gte(beforeBtcBalance)).toBeTruthy();

          console.log("Before liquidity");
          logPositionLiquidities(parsedPosition.positionData);
          parsedPosition = await dlmm.getPosition(position);
          console.log("After liquidity");
          logPositionLiquidities(parsedPosition.positionData);

          let afterBinPerBidSide =
            dlmm.lbPair.activeId - parsedPosition.positionData.lowerBinId;
          let afterBinPerAskSide =
            parsedPosition.positionData.upperBinId - dlmm.lbPair.activeId;

          expect(beforeBinPerBidSide).not.toBe(beforeBinPerAskSide);
          expect(afterBinPerBidSide).toBe(afterBinPerAskSide);

          assertEqRebalanceSimulationWithActualResult(
            rebalancePosition,
            parsedPosition
          );
        }
      }
    });

    it("Deposit more at bid side", async () => {
      for (const strategy of [
        StrategyType.Spot,
        StrategyType.Curve,
        StrategyType.BidAsk,
      ]) {
        const dlmm = await DLMM.create(connection, lbPairPubkey, opt);
        await closeAndCreateNewPositionWithSpotLiquidity(dlmm, keypair);
        for (const swapForY of [true, false]) {
          console.log(`Before swap active id ${dlmm.lbPair.activeId}`);
          await swap(swapForY, new BN(250_000_000), dlmm, keypair);
          await dlmm.refetchStates();
          console.log(`After swap active id ${dlmm.lbPair.activeId}`);

          let parsedPosition = await dlmm.getPosition(position);

          let beforeBinPerBidSide =
            dlmm.lbPair.activeId - parsedPosition.positionData.lowerBinId;
          let beforeBinPerAskSide =
            parsedPosition.positionData.upperBinId - dlmm.lbPair.activeId;

          const { rebalancePosition, simulationResult } =
            await dlmm.simulateRebalancePositionWithBalancedStrategy(
              position,
              parsedPosition.positionData,
              strategy,
              new BN(0),
              new BN(100_000_000),
              new BN(0),
              new BN(0)
            );

          const { initBinArrayInstructions, rebalancePositionInstruction } =
            await dlmm.rebalancePosition(
              { rebalancePosition, simulationResult },
              new BN(0),
              keypair.publicKey,
              0
            );

          let latestBlockHash = await connection.getLatestBlockhash();

          await Promise.all(
            initBinArrayInstructions.map((ix) =>
              sendAndConfirmTransaction(
                connection,
                new Transaction({ ...latestBlockHash }).add(ix),
                [keypair]
              )
            )
          );

          latestBlockHash = await connection.getLatestBlockhash();

          const beforeUsdcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userUSDC)
            .then((acc) => new BN(acc.value.amount));

          const beforeBtcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userBTC)
            .then((acc) => new BN(acc.value.amount));

          await sendAndConfirmTransaction(
            connection,
            new Transaction({ ...latestBlockHash }).add(
              ...rebalancePositionInstruction
            ),
            [keypair]
          );

          const afterUsdcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userUSDC)
            .then((acc) => new BN(acc.value.amount));

          const afterBtcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userBTC)
            .then((acc) => new BN(acc.value.amount));

          expect(afterUsdcBalance.lt(beforeUsdcBalance)).toBeTruthy();
          expect(afterBtcBalance.gte(beforeBtcBalance)).toBeTruthy();

          console.log("Before liquidity");
          logPositionLiquidities(parsedPosition.positionData);
          parsedPosition = await dlmm.getPosition(position);
          console.log("After liquidity");
          logPositionLiquidities(parsedPosition.positionData);

          let afterBinPerBidSide =
            dlmm.lbPair.activeId - parsedPosition.positionData.lowerBinId;
          let afterBinPerAskSide =
            parsedPosition.positionData.upperBinId - dlmm.lbPair.activeId;

          expect(beforeBinPerBidSide).not.toBe(beforeBinPerAskSide);
          expect(afterBinPerBidSide).toBe(afterBinPerAskSide);

          assertEqRebalanceSimulationWithActualResult(
            rebalancePosition,
            parsedPosition
          );
        }
      }
    });

    it("Deposit more at ask side", async () => {
      for (const strategy of [
        StrategyType.Spot,
        StrategyType.Curve,
        StrategyType.BidAsk,
      ]) {
        const dlmm = await DLMM.create(connection, lbPairPubkey, opt);
        await closeAndCreateNewPositionWithSpotLiquidity(dlmm, keypair);
        for (const swapForY of [true, false]) {
          console.log(`Before swap active id ${dlmm.lbPair.activeId}`);
          await swap(swapForY, new BN(250_000_000), dlmm, keypair);
          await dlmm.refetchStates();
          console.log(`After swap active id ${dlmm.lbPair.activeId}`);

          let parsedPosition = await dlmm.getPosition(position);

          let beforeBinPerBidSide =
            dlmm.lbPair.activeId - parsedPosition.positionData.lowerBinId;
          let beforeBinPerAskSide =
            parsedPosition.positionData.upperBinId - dlmm.lbPair.activeId;

          const { rebalancePosition, simulationResult } =
            await dlmm.simulateRebalancePositionWithBalancedStrategy(
              position,
              parsedPosition.positionData,
              strategy,
              new BN(100_000_000),
              new BN(0),
              new BN(0),
              new BN(0)
            );

          const { initBinArrayInstructions, rebalancePositionInstruction } =
            await dlmm.rebalancePosition(
              { rebalancePosition, simulationResult },
              new BN(0),
              keypair.publicKey,
              0
            );

          let latestBlockHash = await connection.getLatestBlockhash();

          await Promise.all(
            initBinArrayInstructions.map((ix) =>
              sendAndConfirmTransaction(
                connection,
                new Transaction({ ...latestBlockHash }).add(ix),
                [keypair]
              )
            )
          );

          latestBlockHash = await connection.getLatestBlockhash();

          const beforeUsdcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userUSDC)
            .then((acc) => new BN(acc.value.amount));

          const beforeBtcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userBTC)
            .then((acc) => new BN(acc.value.amount));

          await sendAndConfirmTransaction(
            connection,
            new Transaction({ ...latestBlockHash }).add(
              ...rebalancePositionInstruction
            ),
            [keypair]
          );

          const afterUsdcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userUSDC)
            .then((acc) => new BN(acc.value.amount));

          const afterBtcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userBTC)
            .then((acc) => new BN(acc.value.amount));

          expect(afterUsdcBalance.gte(beforeUsdcBalance)).toBeTruthy();
          expect(afterBtcBalance.lt(beforeBtcBalance)).toBeTruthy();

          console.log("Before liquidity");
          logPositionLiquidities(parsedPosition.positionData);
          parsedPosition = await dlmm.getPosition(position);
          console.log("After liquidity");
          logPositionLiquidities(parsedPosition.positionData);

          let afterBinPerBidSide =
            dlmm.lbPair.activeId - parsedPosition.positionData.lowerBinId;
          let afterBinPerAskSide =
            parsedPosition.positionData.upperBinId - dlmm.lbPair.activeId;

          expect(beforeBinPerBidSide).not.toBe(beforeBinPerAskSide);
          expect(afterBinPerBidSide).toBe(afterBinPerAskSide);

          assertEqRebalanceSimulationWithActualResult(
            rebalancePosition,
            parsedPosition
          );
        }
      }
    });

    it("Deposit more at both side", async () => {
      for (const strategy of [
        StrategyType.Spot,
        StrategyType.Curve,
        StrategyType.BidAsk,
      ]) {
        const dlmm = await DLMM.create(connection, lbPairPubkey, opt);
        await closeAndCreateNewPositionWithSpotLiquidity(dlmm, keypair);
        for (const swapForY of [true, false]) {
          console.log(`Before swap active id ${dlmm.lbPair.activeId}`);
          await swap(swapForY, new BN(250_000_000), dlmm, keypair);
          await dlmm.refetchStates();
          console.log(`After swap active id ${dlmm.lbPair.activeId}`);

          let parsedPosition = await dlmm.getPosition(position);

          let beforeBinPerBidSide =
            dlmm.lbPair.activeId - parsedPosition.positionData.lowerBinId;
          let beforeBinPerAskSide =
            parsedPosition.positionData.upperBinId - dlmm.lbPair.activeId;

          const { rebalancePosition, simulationResult } =
            await dlmm.simulateRebalancePositionWithBalancedStrategy(
              position,
              parsedPosition.positionData,
              strategy,
              new BN(100_000_000),
              new BN(100_000_000),
              new BN(0),
              new BN(0)
            );

          const { initBinArrayInstructions, rebalancePositionInstruction } =
            await dlmm.rebalancePosition(
              { rebalancePosition, simulationResult },
              new BN(0),
              keypair.publicKey,
              0
            );

          let latestBlockHash = await connection.getLatestBlockhash();

          await Promise.all(
            initBinArrayInstructions.map((ix) =>
              sendAndConfirmTransaction(
                connection,
                new Transaction({ ...latestBlockHash }).add(ix),
                [keypair]
              )
            )
          );

          latestBlockHash = await connection.getLatestBlockhash();

          const beforeUsdcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userUSDC)
            .then((acc) => new BN(acc.value.amount));

          const beforeBtcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userBTC)
            .then((acc) => new BN(acc.value.amount));

          await sendAndConfirmTransaction(
            connection,
            new Transaction({ ...latestBlockHash }).add(
              ...rebalancePositionInstruction
            ),
            [keypair]
          );

          const afterUsdcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userUSDC)
            .then((acc) => new BN(acc.value.amount));

          const afterBtcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userBTC)
            .then((acc) => new BN(acc.value.amount));

          expect(afterUsdcBalance.lt(beforeUsdcBalance)).toBeTruthy();
          expect(afterBtcBalance.lt(beforeBtcBalance)).toBeTruthy();

          console.log("Before liquidity");
          logPositionLiquidities(parsedPosition.positionData);
          parsedPosition = await dlmm.getPosition(position);
          console.log("After liquidity");
          logPositionLiquidities(parsedPosition.positionData);

          let afterBinPerBidSide =
            dlmm.lbPair.activeId - parsedPosition.positionData.lowerBinId;
          let afterBinPerAskSide =
            parsedPosition.positionData.upperBinId - dlmm.lbPair.activeId;

          expect(beforeBinPerBidSide).not.toBe(beforeBinPerAskSide);
          expect(afterBinPerBidSide).toBe(afterBinPerAskSide);

          assertEqRebalanceSimulationWithActualResult(
            rebalancePosition,
            parsedPosition
          );
        }
      }
    });

    it("Withdraw more at bid side", async () => {
      for (const strategy of [
        StrategyType.Spot,
        StrategyType.Curve,
        StrategyType.BidAsk,
      ]) {
        const dlmm = await DLMM.create(connection, lbPairPubkey, opt);
        await closeAndCreateNewPositionWithSpotLiquidity(dlmm, keypair);
        for (const swapForY of [true, false]) {
          console.log(`Before swap active id ${dlmm.lbPair.activeId}`);
          await swap(swapForY, new BN(250_000_000), dlmm, keypair);
          await dlmm.refetchStates();
          console.log(`After swap active id ${dlmm.lbPair.activeId}`);

          let parsedPosition = await dlmm.getPosition(position);

          let beforeBinPerBidSide =
            dlmm.lbPair.activeId - parsedPosition.positionData.lowerBinId;
          let beforeBinPerAskSide =
            parsedPosition.positionData.upperBinId - dlmm.lbPair.activeId;

          const { rebalancePosition, simulationResult } =
            await dlmm.simulateRebalancePositionWithBalancedStrategy(
              position,
              parsedPosition.positionData,
              strategy,
              new BN(0),
              new BN(0),
              new BN(0),
              new BN(5000)
            );

          const { initBinArrayInstructions, rebalancePositionInstruction } =
            await dlmm.rebalancePosition(
              { rebalancePosition, simulationResult },
              new BN(0),
              keypair.publicKey,
              0
            );

          let latestBlockHash = await connection.getLatestBlockhash();

          await Promise.all(
            initBinArrayInstructions.map((ix) =>
              sendAndConfirmTransaction(
                connection,
                new Transaction({ ...latestBlockHash }).add(ix),
                [keypair]
              )
            )
          );

          latestBlockHash = await connection.getLatestBlockhash();

          const beforeUsdcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userUSDC)
            .then((acc) => new BN(acc.value.amount));

          const beforeBtcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userBTC)
            .then((acc) => new BN(acc.value.amount));

          await sendAndConfirmTransaction(
            connection,
            new Transaction({ ...latestBlockHash }).add(
              ...rebalancePositionInstruction
            ),
            [keypair]
          );

          const afterUsdcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userUSDC)
            .then((acc) => new BN(acc.value.amount));

          const afterBtcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userBTC)
            .then((acc) => new BN(acc.value.amount));

          const minPositionYAmountWithdrawn = new BN(
            parsedPosition.positionData.totalYAmount
          )
            .mul(new BN(5000))
            .div(new BN(BASIS_POINT_MAX));

          expect(afterUsdcBalance.gt(beforeUsdcBalance)).toBeTruthy();
          const usdcDiff = afterUsdcBalance.sub(beforeUsdcBalance);
          expect(usdcDiff.gte(minPositionYAmountWithdrawn)).toBeTruthy();

          assertionWithTolerance(
            afterBtcBalance,
            beforeBtcBalance,
            new BN(1000)
          );

          console.log("Before liquidity");
          logPositionLiquidities(parsedPosition.positionData);
          parsedPosition = await dlmm.getPosition(position);
          console.log("After liquidity");
          logPositionLiquidities(parsedPosition.positionData);

          let afterBinPerBidSide =
            dlmm.lbPair.activeId - parsedPosition.positionData.lowerBinId;
          let afterBinPerAskSide =
            parsedPosition.positionData.upperBinId - dlmm.lbPair.activeId;

          expect(beforeBinPerBidSide).not.toBe(beforeBinPerAskSide);
          expect(afterBinPerBidSide).toBe(afterBinPerAskSide);

          assertEqRebalanceSimulationWithActualResult(
            rebalancePosition,
            parsedPosition
          );
        }
      }
    });

    it("Withdraw more at ask side", async () => {
      for (const strategy of [
        StrategyType.Spot,
        StrategyType.Curve,
        StrategyType.BidAsk,
      ]) {
        const dlmm = await DLMM.create(connection, lbPairPubkey, opt);
        await closeAndCreateNewPositionWithSpotLiquidity(dlmm, keypair);
        for (const swapForY of [true, false]) {
          console.log(`Before swap active id ${dlmm.lbPair.activeId}`);
          await swap(swapForY, new BN(250_000_000), dlmm, keypair);
          await dlmm.refetchStates();
          console.log(`After swap active id ${dlmm.lbPair.activeId}`);

          let parsedPosition = await dlmm.getPosition(position);

          let beforeBinPerBidSide =
            dlmm.lbPair.activeId - parsedPosition.positionData.lowerBinId;
          let beforeBinPerAskSide =
            parsedPosition.positionData.upperBinId - dlmm.lbPair.activeId;

          const { rebalancePosition, simulationResult } =
            await dlmm.simulateRebalancePositionWithBalancedStrategy(
              position,
              parsedPosition.positionData,
              strategy,
              new BN(0),
              new BN(0),
              new BN(5000),
              new BN(0)
            );

          const { initBinArrayInstructions, rebalancePositionInstruction } =
            await dlmm.rebalancePosition(
              { rebalancePosition, simulationResult },
              new BN(0),
              keypair.publicKey,
              0
            );

          let latestBlockHash = await connection.getLatestBlockhash();

          await Promise.all(
            initBinArrayInstructions.map((ix) =>
              sendAndConfirmTransaction(
                connection,
                new Transaction({ ...latestBlockHash }).add(ix),
                [keypair]
              )
            )
          );

          latestBlockHash = await connection.getLatestBlockhash();

          const beforeUsdcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userUSDC)
            .then((acc) => new BN(acc.value.amount));

          const beforeBtcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userBTC)
            .then((acc) => new BN(acc.value.amount));

          await sendAndConfirmTransaction(
            connection,
            new Transaction({ ...latestBlockHash }).add(
              ...rebalancePositionInstruction
            ),
            [keypair]
          );

          const afterUsdcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userUSDC)
            .then((acc) => new BN(acc.value.amount));

          const afterBtcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userBTC)
            .then((acc) => new BN(acc.value.amount));

          const positionWithdrawnXAMount = new BN(
            parsedPosition.positionData.totalXAmount
          )
            .muln(5000)
            .divn(10000);

          const btcDiff = afterBtcBalance.sub(beforeBtcBalance);

          assertionWithPercentageTolerance(
            btcDiff,
            positionWithdrawnXAMount,
            0.05
          );
          assertionWithTolerance(
            afterUsdcBalance,
            beforeUsdcBalance,
            new BN(1000)
          );

          console.log("Before liquidity");
          logPositionLiquidities(parsedPosition.positionData);
          parsedPosition = await dlmm.getPosition(position);
          console.log("After liquidity");
          logPositionLiquidities(parsedPosition.positionData);

          let afterBinPerBidSide =
            dlmm.lbPair.activeId - parsedPosition.positionData.lowerBinId;
          let afterBinPerAskSide =
            parsedPosition.positionData.upperBinId - dlmm.lbPair.activeId;

          expect(beforeBinPerBidSide).not.toBe(beforeBinPerAskSide);
          expect(afterBinPerBidSide).toBe(afterBinPerAskSide);

          assertEqRebalanceSimulationWithActualResult(
            rebalancePosition,
            parsedPosition
          );
        }
      }
    });

    it("Withdraw more at both side", async () => {
      for (const strategy of [
        StrategyType.Spot,
        StrategyType.Curve,
        StrategyType.BidAsk,
      ]) {
        const dlmm = await DLMM.create(connection, lbPairPubkey, opt);
        await closeAndCreateNewPositionWithSpotLiquidity(dlmm, keypair);
        for (const swapForY of [true, false]) {
          console.log(`Before swap active id ${dlmm.lbPair.activeId}`);
          await swap(swapForY, new BN(250_000_000), dlmm, keypair);
          await dlmm.refetchStates();
          console.log(`After swap active id ${dlmm.lbPair.activeId}`);

          let parsedPosition = await dlmm.getPosition(position);

          let beforeBinPerBidSide =
            dlmm.lbPair.activeId - parsedPosition.positionData.lowerBinId;
          let beforeBinPerAskSide =
            parsedPosition.positionData.upperBinId - dlmm.lbPair.activeId;

          const { rebalancePosition, simulationResult } =
            await dlmm.simulateRebalancePositionWithBalancedStrategy(
              position,
              parsedPosition.positionData,
              strategy,
              new BN(0),
              new BN(5000),
              new BN(5000),
              new BN(0)
            );

          const { initBinArrayInstructions, rebalancePositionInstruction } =
            await dlmm.rebalancePosition(
              { rebalancePosition, simulationResult },
              new BN(0),
              keypair.publicKey,
              0
            );

          let latestBlockHash = await connection.getLatestBlockhash();

          await Promise.all(
            initBinArrayInstructions.map((ix) =>
              sendAndConfirmTransaction(
                connection,
                new Transaction({ ...latestBlockHash }).add(ix),
                [keypair]
              )
            )
          );

          latestBlockHash = await connection.getLatestBlockhash();

          const beforeUsdcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userUSDC)
            .then((acc) => new BN(acc.value.amount));

          const beforeBtcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userBTC)
            .then((acc) => new BN(acc.value.amount));

          await sendAndConfirmTransaction(
            connection,
            new Transaction({ ...latestBlockHash }).add(
              ...rebalancePositionInstruction
            ),
            [keypair]
          );

          const afterUsdcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userUSDC)
            .then((acc) => new BN(acc.value.amount));

          const afterBtcBalance = await dlmm.program.provider.connection
            .getTokenAccountBalance(userBTC)
            .then((acc) => new BN(acc.value.amount));

          const positionWithdrawnXAMount = new BN(
            parsedPosition.positionData.totalXAmount
          )
            .muln(5000)
            .divn(10000);

          const positionWithdrawnYAMount = new BN(
            parsedPosition.positionData.totalYAmount
          )
            .muln(5000)
            .divn(10000);

          const btcDiff = afterBtcBalance.sub(beforeBtcBalance);
          const usdcDiff = afterUsdcBalance.sub(beforeUsdcBalance);

          assertionWithPercentageTolerance(
            btcDiff,
            positionWithdrawnXAMount,
            0.05
          );
          assertionWithPercentageTolerance(
            usdcDiff,
            positionWithdrawnYAMount,
            0.05
          );

          console.log("Before liquidity");
          logPositionLiquidities(parsedPosition.positionData);
          parsedPosition = await dlmm.getPosition(position);
          console.log("After liquidity");
          logPositionLiquidities(parsedPosition.positionData);

          let afterBinPerBidSide =
            dlmm.lbPair.activeId - parsedPosition.positionData.lowerBinId;
          let afterBinPerAskSide =
            parsedPosition.positionData.upperBinId - dlmm.lbPair.activeId;

          expect(beforeBinPerBidSide).not.toBe(beforeBinPerAskSide);
          expect(afterBinPerBidSide).toBe(afterBinPerAskSide);

          assertEqRebalanceSimulationWithActualResult(
            rebalancePosition,
            parsedPosition
          );
        }
      }
    });

    it("DCA buy", async () => {
      for (const strategy of [
        StrategyType.Spot,
        StrategyType.Curve,
        StrategyType.BidAsk,
      ]) {
        const dlmm = await DLMM.create(connection, lbPairPubkey, opt);
        await closeAndCreateNewPositionWithSpotLiquidity(dlmm, keypair);
        console.log(`Before swap active id ${dlmm.lbPair.activeId}`);
        await swap(true, new BN(250_000_000), dlmm, keypair);
        await dlmm.refetchStates();
        console.log(`After swap active id ${dlmm.lbPair.activeId}`);

        let parsedPosition = await dlmm.getPosition(position);

        let beforeBinPerBidSide =
          dlmm.lbPair.activeId - parsedPosition.positionData.lowerBinId;
        let beforeBinPerAskSide =
          parsedPosition.positionData.upperBinId - dlmm.lbPair.activeId;

        const { rebalancePosition, simulationResult } =
          await dlmm.simulateRebalancePositionWithBalancedStrategy(
            position,
            parsedPosition.positionData,
            strategy,
            new BN(0),
            new BN(0),
            new BN(10000),
            new BN(0)
          );

        const { initBinArrayInstructions, rebalancePositionInstruction } =
          await dlmm.rebalancePosition(
            { rebalancePosition, simulationResult },
            new BN(0),
            keypair.publicKey,
            0
          );

        let latestBlockHash = await connection.getLatestBlockhash();

        await Promise.all(
          initBinArrayInstructions.map((ix) =>
            sendAndConfirmTransaction(
              connection,
              new Transaction({ ...latestBlockHash }).add(ix),
              [keypair]
            )
          )
        );

        latestBlockHash = await connection.getLatestBlockhash();

        await sendAndConfirmTransaction(
          connection,
          new Transaction({ ...latestBlockHash }).add(
            ...rebalancePositionInstruction
          ),
          [keypair]
        );

        console.log("Before liquidity");
        logPositionLiquidities(parsedPosition.positionData);
        parsedPosition = await dlmm.getPosition(position);
        console.log("After liquidity");
        logPositionLiquidities(parsedPosition.positionData);

        expect(
          new BN(parsedPosition.positionData.totalXAmount)
            .add(new BN(parsedPosition.positionData.feeX))
            .isZero()
        ).toBeTruthy();

        let afterBinPerBidSide =
          dlmm.lbPair.activeId - parsedPosition.positionData.lowerBinId;
        let afterBinPerAskSide =
          parsedPosition.positionData.upperBinId - dlmm.lbPair.activeId;

        expect(beforeBinPerBidSide).not.toBe(beforeBinPerAskSide);
        expect(afterBinPerBidSide).toBe(afterBinPerAskSide);

        assertEqRebalanceSimulationWithActualResult(
          rebalancePosition,
          parsedPosition
        );
      }
    });

    it("DCA sell", async () => {
      for (const strategy of [
        StrategyType.Spot,
        StrategyType.Curve,
        StrategyType.BidAsk,
      ]) {
        const dlmm = await DLMM.create(connection, lbPairPubkey, opt);
        await closeAndCreateNewPositionWithSpotLiquidity(dlmm, keypair);
        console.log(`Before swap active id ${dlmm.lbPair.activeId}`);
        await swap(false, new BN(250_000_000), dlmm, keypair);
        await dlmm.refetchStates();
        console.log(`After swap active id ${dlmm.lbPair.activeId}`);

        let parsedPosition = await dlmm.getPosition(position);

        let beforeBinPerBidSide =
          dlmm.lbPair.activeId - parsedPosition.positionData.lowerBinId;
        let beforeBinPerAskSide =
          parsedPosition.positionData.upperBinId - dlmm.lbPair.activeId;

        const { rebalancePosition, simulationResult } =
          await dlmm.simulateRebalancePositionWithBalancedStrategy(
            position,
            parsedPosition.positionData,
            strategy,
            new BN(0),
            new BN(0),
            new BN(0),
            new BN(10000)
          );

        const { initBinArrayInstructions, rebalancePositionInstruction } =
          await dlmm.rebalancePosition(
            { rebalancePosition, simulationResult },
            new BN(0),
            keypair.publicKey,
            0
          );

        let latestBlockHash = await connection.getLatestBlockhash();

        await Promise.all(
          initBinArrayInstructions.map((ix) =>
            sendAndConfirmTransaction(
              connection,
              new Transaction({ ...latestBlockHash }).add(ix),
              [keypair]
            )
          )
        );

        latestBlockHash = await connection.getLatestBlockhash();

        await sendAndConfirmTransaction(
          connection,
          new Transaction({ ...latestBlockHash }).add(
            ...rebalancePositionInstruction
          ),
          [keypair]
        );

        console.log("Before liquidity");
        logPositionLiquidities(parsedPosition.positionData);
        parsedPosition = await dlmm.getPosition(position);
        console.log("After liquidity");
        logPositionLiquidities(parsedPosition.positionData);

        expect(
          new BN(parsedPosition.positionData.totalYAmount)
            .add(new BN(parsedPosition.positionData.feeY))
            .isZero()
        ).toBeTruthy();

        let afterBinPerBidSide =
          dlmm.lbPair.activeId - parsedPosition.positionData.lowerBinId;
        let afterBinPerAskSide =
          parsedPosition.positionData.upperBinId - dlmm.lbPair.activeId;

        expect(beforeBinPerBidSide).not.toBe(beforeBinPerAskSide);
        expect(afterBinPerBidSide).toBe(afterBinPerAskSide);

        assertEqRebalanceSimulationWithActualResult(
          rebalancePosition,
          parsedPosition
        );
      }
    });
  });
});
