import BN from "bn.js";
import { web3 } from "@coral-xyz/anchor";
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
} from "../dlmm/helpers";
import {
  buildLiquidityStrategyParameters,
  getLiquidityStrategyParameterBuilder,
} from "../dlmm/helpers/rebalance";
import { DLMM } from "../dlmm/index";
import { LbPosition, StrategyType } from "../dlmm/types";
import {
  assertEqRebalanceSimulationWithActualResult,
  createTestProgram,
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
const BIN_ARRAY_BITMAP_SIZE = new BN(
  CONSTANTS.find(([k, v]) => v.name == "BIN_ARRAY_BITMAP_SIZE")[1].value
);
export const MAX_BIN_PER_ARRAY = new BN(
  CONSTANTS.find(([k, v]) => v.name == "MAX_BIN_PER_ARRAY")[1].value
);

const DEFAULT_ACTIVE_ID = new BN(1);
const DEFAULT_BIN_STEP = new BN(10);
const DEFAULT_BASE_FACTOR_2 = new BN(4000);

const programId = new web3.PublicKey(LBCLMM_PROGRAM_IDS["localhost"]);

let BTC: web3.PublicKey;
let USDC: web3.PublicKey;
let lbPairPubkey: web3.PublicKey;
let userBTC: web3.PublicKey;
let userUSDC: web3.PublicKey;
let presetParamPda2: web3.PublicKey;

const strategySet: StrategyType[] = [
  StrategyType.Spot,
  StrategyType.BidAsk,
  StrategyType.Curve,
];

describe("Rebalance", () => {
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

    const { presetParameter2 } = await DLMM.getAllPresetParameters(connection, {
      cluster: "localhost",
    });

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

    let rawTx = await DLMM.createLbPair2(
      connection,
      keypair.publicKey,
      BTC,
      USDC,
      presetParamPda2,
      DEFAULT_ACTIVE_ID,
      { cluster: "localhost" }
    );
    await sendAndConfirmTransaction(connection, rawTx, [keypair]);

    [lbPairPubkey] = deriveLbPairWithPresetParamWithIndexKey(
      presetParamPda2,
      BTC,
      USDC,
      programId
    );
  });

  it("Rebalance with only deposit and auto shrink position", async () => {
    const dlmm = await DLMM.create(connection, lbPairPubkey, {
      cluster: "localhost",
    });

    for (const strategy of strategySet) {
      const positionKeypair = Keypair.generate();

      const initPositionTx = await dlmm.createEmptyPosition({
        positionPubKey: positionKeypair.publicKey,
        user: keypair.publicKey,
        minBinId: dlmm.lbPair.activeId - 30,
        maxBinId: dlmm.lbPair.activeId + 30,
      });

      await sendAndConfirmTransaction(connection, initPositionTx, [
        positionKeypair,
        keypair,
      ]);

      const beforePositionLamports = await connection
        .getAccountInfo(positionKeypair.publicKey)
        .then((account) => account.lamports);

      const beforePosition = await dlmm.getPosition(positionKeypair.publicKey);

      const strategyParamBuilder =
        getLiquidityStrategyParameterBuilder(strategy);

      const minDeltaId = new BN(-10);
      const maxDeltaId = new BN(20);
      const amountX = new BN(10_000_000);
      const amountY = new BN(10_000_000);
      const favorXInActiveBin = false;

      const { x0, y0, deltaX, deltaY } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        new BN(dlmm.lbPair.binStep),
        favorXInActiveBin,
        new BN(dlmm.lbPair.activeId),
        strategyParamBuilder
      );

      const { simulationResult, rebalancePosition } =
        await dlmm.simulateRebalancePosition(
          positionKeypair.publicKey,
          beforePosition.positionData,
          true,
          true,
          [
            {
              x0,
              y0,
              deltaX,
              deltaY,
              minDeltaId,
              maxDeltaId,
              favorXInActiveBin,
            },
          ],
          [
            {
              minBinId: new BN(beforePosition.positionData.lowerBinId),
              maxBinId: new BN(beforePosition.positionData.upperBinId),
              bps: new BN(BASIS_POINT_MAX),
            },
          ]
        );

      const { initBinArrayInstructions, rebalancePositionInstruction } =
        await dlmm.rebalancePosition(
          { simulationResult, rebalancePosition },
          new BN(0)
        );

      const { lastValidBlockHeight, blockhash } =
        await connection.getLatestBlockhash();

      await Promise.all(
        initBinArrayInstructions.map((ix) => {
          const transaction = new Transaction({
            lastValidBlockHeight,
            blockhash,
          }).add(ix);

          return sendAndConfirmTransaction(connection, transaction, [keypair]);
        })
      );

      const rebalanceTx = new Transaction({
        lastValidBlockHeight,
        blockhash,
      }).add(...rebalancePositionInstruction);

      await sendAndConfirmTransaction(connection, rebalanceTx, [keypair]).then(
        console.log
      );

      const afterPositionLamports = await connection
        .getAccountInfo(positionKeypair.publicKey)
        .then((account) => account.lamports);
      const afterPosition = await dlmm.getPosition(positionKeypair.publicKey);

      assertEqRebalanceSimulationWithActualResult(
        rebalancePosition,
        afterPosition
      );

      const rentalChanges = new BN(afterPositionLamports).sub(
        new BN(beforePositionLamports)
      );

      expect(rentalChanges.toString()).toBe(
        simulationResult.rentalCostLamports.toString()
      );

      const [beforeWidth, afterWidth] = getBeforeAfterPositionWidth(
        beforePosition,
        afterPosition
      );

      expect(afterWidth).toBeLessThan(beforeWidth);
      await dlmm.refetchStates();
    }
  });

  it("Rebalance with only deposit and auto expand position", async () => {
    const dlmm = await DLMM.create(connection, lbPairPubkey, {
      cluster: "localhost",
    });

    for (const strategy of strategySet) {
      const positionKeypair = Keypair.generate();

      const initPositionTx = await dlmm.createEmptyPosition({
        positionPubKey: positionKeypair.publicKey,
        user: keypair.publicKey,
        minBinId: dlmm.lbPair.activeId - 30,
        maxBinId: dlmm.lbPair.activeId + 30,
      });

      await sendAndConfirmTransaction(connection, initPositionTx, [
        positionKeypair,
        keypair,
      ]);

      const beforePositionLamports = await connection
        .getAccountInfo(positionKeypair.publicKey)
        .then((account) => account.lamports);

      const beforePosition = await dlmm.getPosition(positionKeypair.publicKey);

      const minDeltaId = new BN(-50);
      const maxDeltaId = new BN(50);
      const amountX = new BN(10_000_000);
      const amountY = new BN(10_000_000);
      const favorXInActiveBin = false;

      const strategyParamBuilder =
        getLiquidityStrategyParameterBuilder(strategy);
      const { x0, y0, deltaX, deltaY } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        new BN(dlmm.lbPair.binStep),
        favorXInActiveBin,
        new BN(dlmm.lbPair.activeId),
        strategyParamBuilder
      );

      const { simulationResult, rebalancePosition } =
        await dlmm.simulateRebalancePosition(
          positionKeypair.publicKey,
          beforePosition.positionData,
          true,
          true,
          [
            {
              minDeltaId,
              maxDeltaId,
              x0,
              y0,
              deltaX,
              deltaY,
              favorXInActiveBin,
            },
          ],
          [
            {
              minBinId: new BN(beforePosition.positionData.lowerBinId),
              maxBinId: new BN(beforePosition.positionData.upperBinId),
              bps: new BN(BASIS_POINT_MAX),
            },
          ]
        );

      const { initBinArrayInstructions, rebalancePositionInstruction } =
        await dlmm.rebalancePosition(
          { simulationResult, rebalancePosition },
          new BN(0)
        );

      const { lastValidBlockHeight, blockhash } =
        await connection.getLatestBlockhash();

      await Promise.all(
        initBinArrayInstructions.map((ix) => {
          const transaction = new Transaction({
            lastValidBlockHeight,
            blockhash,
          }).add(ix);

          return sendAndConfirmTransaction(connection, transaction, [keypair]);
        })
      );

      const rebalanceTx = new Transaction({
        lastValidBlockHeight,
        blockhash,
      }).add(...rebalancePositionInstruction);

      await sendAndConfirmTransaction(connection, rebalanceTx, [keypair]);

      const afterPositionLamports = await connection
        .getAccountInfo(positionKeypair.publicKey)
        .then((account) => account.lamports);
      const afterPosition = await dlmm.getPosition(positionKeypair.publicKey);

      assertEqRebalanceSimulationWithActualResult(
        rebalancePosition,
        afterPosition
      );

      const rentalChanges = new BN(afterPositionLamports).sub(
        new BN(beforePositionLamports)
      );

      expect(rentalChanges.toString()).toBe(
        simulationResult.rentalCostLamports.toString()
      );

      const [beforeWidth, afterWidth] = getBeforeAfterPositionWidth(
        beforePosition,
        afterPosition
      );

      expect(afterWidth).toBeGreaterThan(beforeWidth);
      await dlmm.refetchStates();
    }
  });

  it("Rebalance with claim fee + withdraw + deposit and auto shrink position", async () => {
    const dlmm = await DLMM.create(connection, lbPairPubkey, {
      cluster: "localhost",
    });

    for (const strategy of strategySet) {
      const positionKeypair = Keypair.generate();

      const initPositionTx = await dlmm.createEmptyPosition({
        positionPubKey: positionKeypair.publicKey,
        user: keypair.publicKey,
        minBinId: dlmm.lbPair.activeId - 30,
        maxBinId: dlmm.lbPair.activeId + 30,
      });

      await sendAndConfirmTransaction(connection, initPositionTx, [
        positionKeypair,
        keypair,
      ]);

      console.log("Deposit and generate swap fees");
      {
        const beforePosition = await dlmm.getPosition(
          positionKeypair.publicKey
        );

        const minDeltaId = new BN(beforePosition.positionData.lowerBinId).subn(
          dlmm.lbPair.activeId
        );
        const maxDeltaId = new BN(beforePosition.positionData.upperBinId).subn(
          dlmm.lbPair.activeId
        );

        const amountX = new BN(100_000_000);
        const amountY = new BN(100_000_000);
        const favorXInActiveBin = false;

        const strategyParamBuilder =
          getLiquidityStrategyParameterBuilder(strategy);
        const { x0, y0, deltaX, deltaY } = buildLiquidityStrategyParameters(
          amountX,
          amountY,
          minDeltaId,
          maxDeltaId,
          new BN(dlmm.lbPair.binStep),
          favorXInActiveBin,
          new BN(dlmm.lbPair.activeId),
          strategyParamBuilder
        );

        const { simulationResult, rebalancePosition } =
          await dlmm.simulateRebalancePosition(
            positionKeypair.publicKey,
            beforePosition.positionData,
            true,
            true,
            [
              {
                minDeltaId,
                maxDeltaId,
                x0,
                y0,
                deltaX,
                deltaY,
                favorXInActiveBin,
              },
            ],
            [
              {
                minBinId: new BN(beforePosition.positionData.lowerBinId),
                maxBinId: new BN(beforePosition.positionData.upperBinId),
                bps: new BN(BASIS_POINT_MAX),
              },
            ]
          );

        const { initBinArrayInstructions, rebalancePositionInstruction } =
          await dlmm.rebalancePosition(
            { simulationResult, rebalancePosition },
            new BN(0)
          );

        const { lastValidBlockHeight, blockhash } =
          await connection.getLatestBlockhash();

        await Promise.all(
          initBinArrayInstructions.map((ix) => {
            const transaction = new Transaction({
              lastValidBlockHeight,
              blockhash,
            }).add(ix);

            return sendAndConfirmTransaction(connection, transaction, [
              keypair,
            ]);
          })
        );

        const rebalanceTx = new Transaction({
          lastValidBlockHeight,
          blockhash,
        }).add(...rebalancePositionInstruction);

        await sendAndConfirmTransaction(connection, rebalanceTx, [keypair]);

        for (const swapXToY of [true, false]) {
          const binArraysForSwap = await dlmm.getBinArrayForSwap(swapXToY, 3);

          const [inToken, outToken] = swapXToY
            ? [dlmm.lbPair.tokenXMint, dlmm.lbPair.tokenYMint]
            : [dlmm.lbPair.tokenYMint, dlmm.lbPair.tokenXMint];

          const inAmount = new BN(100_000);

          const { outAmount, binArraysPubkey } = dlmm.swapQuote(
            inAmount,
            swapXToY,
            new BN(0),
            binArraysForSwap,
            true
          );

          const swapTx = await dlmm.swap({
            inToken,
            outToken,
            inAmount,
            minOutAmount: new BN(0),
            binArraysPubkey,
            user: keypair.publicKey,
            lbPair: dlmm.pubkey,
          });

          await sendAndConfirmTransaction(connection, swapTx, [keypair]);
        }
      }

      console.log("Rebalance");
      let beforePosition = await dlmm.getPosition(positionKeypair.publicKey);

      const minDeltaId = new BN(beforePosition.positionData.lowerBinId)
        .subn(dlmm.lbPair.activeId)
        .addn(10);
      const maxDeltaId = new BN(beforePosition.positionData.upperBinId)
        .subn(dlmm.lbPair.activeId)
        .subn(10);
      const amountX = new BN(100_000_000);
      const amountY = new BN(100_000_000);
      const favorXInActiveBin = false;

      const strategyParamBuilder =
        getLiquidityStrategyParameterBuilder(strategy);
      const { x0, y0, deltaX, deltaY } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        new BN(dlmm.lbPair.binStep),
        favorXInActiveBin,
        new BN(dlmm.lbPair.activeId),
        strategyParamBuilder
      );

      // Rebalance
      const { simulationResult, rebalancePosition } =
        await dlmm.simulateRebalancePosition(
          positionKeypair.publicKey,
          beforePosition.positionData,
          true,
          true,
          [
            {
              x0,
              y0,
              deltaX,
              deltaY,
              maxDeltaId,
              minDeltaId,
              favorXInActiveBin,
            },
          ],
          [
            {
              minBinId: new BN(beforePosition.positionData.lowerBinId),
              maxBinId: new BN(beforePosition.positionData.upperBinId),
              bps: new BN(BASIS_POINT_MAX),
            },
          ]
        );

      const beforePositionLamports = await connection
        .getAccountInfo(positionKeypair.publicKey)
        .then((account) => account.lamports);

      const { initBinArrayInstructions, rebalancePositionInstruction } =
        await dlmm.rebalancePosition(
          { simulationResult, rebalancePosition },
          new BN(0)
        );

      const { lastValidBlockHeight, blockhash } =
        await connection.getLatestBlockhash();

      await Promise.all(
        initBinArrayInstructions.map((ix) => {
          const transaction = new Transaction({
            lastValidBlockHeight,
            blockhash,
          }).add(ix);

          return sendAndConfirmTransaction(connection, transaction, [keypair]);
        })
      );

      const rebalanceTx = new Transaction({
        lastValidBlockHeight,
        blockhash,
      }).add(...rebalancePositionInstruction);

      await sendAndConfirmTransaction(connection, rebalanceTx, [keypair]);

      const afterPositionLamports = await connection
        .getAccountInfo(positionKeypair.publicKey)
        .then((account) => account.lamports);

      const afterPosition = await dlmm.getPosition(positionKeypair.publicKey);

      assertEqRebalanceSimulationWithActualResult(
        rebalancePosition,
        afterPosition
      );

      const rentalChanges = new BN(afterPositionLamports).sub(
        new BN(beforePositionLamports)
      );

      expect(rentalChanges.toString()).toBe(
        simulationResult.rentalCostLamports.toString()
      );

      const [beforeWidth, afterWidth] = getBeforeAfterPositionWidth(
        beforePosition,
        afterPosition
      );

      expect(afterWidth).toBeLessThan(beforeWidth);

      // Clean up
      await dlmm
        .simulateRebalancePosition(
          positionKeypair.publicKey,
          afterPosition.positionData,
          true,
          true,
          [],
          [
            {
              minBinId: new BN(afterPosition.positionData.lowerBinId),
              maxBinId: new BN(afterPosition.positionData.upperBinId),
              bps: new BN(BASIS_POINT_MAX),
            },
          ]
        )
        .then(async ({ rebalancePosition, simulationResult }) => {
          const { initBinArrayInstructions: _, rebalancePositionInstruction } =
            await dlmm.rebalancePosition(
              { rebalancePosition, simulationResult },
              new BN(0)
            );

          const { blockhash, lastValidBlockHeight } =
            await connection.getLatestBlockhash();

          const transaction = new Transaction({
            blockhash,
            lastValidBlockHeight,
          }).add(...rebalancePositionInstruction);

          return sendAndConfirmTransaction(connection, transaction, [keypair]);
        });

      await dlmm.refetchStates();
    }
  });

  it("Rebalance with claim fee + withdraw + deposit and auto expand position", async () => {
    const dlmm = await DLMM.create(connection, lbPairPubkey, {
      cluster: "localhost",
    });
    for (const strategy of strategySet) {
      const positionKeypair = Keypair.generate();

      const initPositionTx = await dlmm.createEmptyPosition({
        positionPubKey: positionKeypair.publicKey,
        user: keypair.publicKey,
        minBinId: dlmm.lbPair.activeId - 30,
        maxBinId: dlmm.lbPair.activeId + 30,
      });

      await sendAndConfirmTransaction(connection, initPositionTx, [
        positionKeypair,
        keypair,
      ]);

      console.log("Deposit and generate swap fees");
      {
        const beforePosition = await dlmm.getPosition(
          positionKeypair.publicKey
        );

        const minDeltaId = new BN(beforePosition.positionData.lowerBinId).subn(
          dlmm.lbPair.activeId
        );
        const maxDeltaId = new BN(beforePosition.positionData.upperBinId).subn(
          dlmm.lbPair.activeId
        );
        const amountX = new BN(100_000_000);
        const amountY = new BN(100_000_000);
        const favorXInActiveBin = false;

        const strategyParamBuilder =
          getLiquidityStrategyParameterBuilder(strategy);
        const { x0, y0, deltaX, deltaY } = buildLiquidityStrategyParameters(
          amountX,
          amountY,
          minDeltaId,
          maxDeltaId,
          new BN(dlmm.lbPair.binStep),
          favorXInActiveBin,
          new BN(dlmm.lbPair.activeId),
          strategyParamBuilder
        );

        const { simulationResult, rebalancePosition } =
          await dlmm.simulateRebalancePosition(
            positionKeypair.publicKey,
            beforePosition.positionData,
            true,
            true,
            [
              {
                x0,
                y0,
                deltaX,
                deltaY,
                maxDeltaId,
                minDeltaId,
                favorXInActiveBin,
              },
            ],
            [
              {
                minBinId: new BN(beforePosition.positionData.lowerBinId),
                maxBinId: new BN(beforePosition.positionData.upperBinId),
                bps: new BN(BASIS_POINT_MAX),
              },
            ]
          );

        const { initBinArrayInstructions, rebalancePositionInstruction } =
          await dlmm.rebalancePosition(
            { simulationResult, rebalancePosition },
            new BN(0)
          );

        const { lastValidBlockHeight, blockhash } =
          await connection.getLatestBlockhash();

        await Promise.all(
          initBinArrayInstructions.map((ix) => {
            const transaction = new Transaction({
              lastValidBlockHeight,
              blockhash,
            }).add(ix);

            return sendAndConfirmTransaction(connection, transaction, [
              keypair,
            ]);
          })
        );

        const rebalanceTx = new Transaction({
          lastValidBlockHeight,
          blockhash,
        }).add(...rebalancePositionInstruction);

        await sendAndConfirmTransaction(connection, rebalanceTx, [keypair]);

        for (const swapXToY of [true, false]) {
          const binArraysForSwap = await dlmm.getBinArrayForSwap(swapXToY, 3);

          const [inToken, outToken] = swapXToY
            ? [dlmm.lbPair.tokenXMint, dlmm.lbPair.tokenYMint]
            : [dlmm.lbPair.tokenYMint, dlmm.lbPair.tokenXMint];

          const inAmount = new BN(100_000);

          const { outAmount, binArraysPubkey } = dlmm.swapQuote(
            inAmount,
            swapXToY,
            new BN(0),
            binArraysForSwap,
            true
          );

          const swapTx = await dlmm.swap({
            inToken,
            outToken,
            inAmount,
            minOutAmount: new BN(0),
            binArraysPubkey,
            user: keypair.publicKey,
            lbPair: dlmm.pubkey,
          });

          await sendAndConfirmTransaction(connection, swapTx, [keypair]);
        }
      }

      console.log("Rebalance");
      let beforePosition = await dlmm.getPosition(positionKeypair.publicKey);

      const minDeltaId = new BN(beforePosition.positionData.lowerBinId)
        .subn(dlmm.lbPair.activeId)
        .subn(10);
      const maxDeltaId = new BN(beforePosition.positionData.upperBinId)
        .subn(dlmm.lbPair.activeId)
        .addn(10);
      const amountX = new BN(100_000_000);
      const amountY = new BN(100_000_000);
      const favorXInActiveBin = false;

      const strategyParamBuilder =
        getLiquidityStrategyParameterBuilder(strategy);
      const { x0, y0, deltaX, deltaY } = buildLiquidityStrategyParameters(
        amountX,
        amountY,
        minDeltaId,
        maxDeltaId,
        new BN(dlmm.lbPair.binStep),
        favorXInActiveBin,
        new BN(dlmm.lbPair.activeId),
        strategyParamBuilder
      );

      // Rebalance
      const { simulationResult, rebalancePosition } =
        await dlmm.simulateRebalancePosition(
          positionKeypair.publicKey,
          beforePosition.positionData,
          true,
          true,
          [
            {
              x0,
              y0,
              deltaX,
              deltaY,
              maxDeltaId,
              minDeltaId,
              favorXInActiveBin,
            },
          ],
          [
            {
              minBinId: new BN(beforePosition.positionData.lowerBinId),
              maxBinId: new BN(beforePosition.positionData.upperBinId),
              bps: new BN(BASIS_POINT_MAX),
            },
          ]
        );

      const beforePositionLamports = await connection
        .getAccountInfo(positionKeypair.publicKey)
        .then((account) => account.lamports);

      const { initBinArrayInstructions, rebalancePositionInstruction } =
        await dlmm.rebalancePosition(
          { simulationResult, rebalancePosition },
          new BN(0)
        );

      const { lastValidBlockHeight, blockhash } =
        await connection.getLatestBlockhash();

      await Promise.all(
        initBinArrayInstructions.map((ix) => {
          const transaction = new Transaction({
            lastValidBlockHeight,
            blockhash,
          }).add(ix);

          return sendAndConfirmTransaction(connection, transaction, [keypair]);
        })
      );

      const rebalanceTx = new Transaction({
        lastValidBlockHeight,
        blockhash,
      }).add(...rebalancePositionInstruction);

      await sendAndConfirmTransaction(connection, rebalanceTx, [keypair]);

      const afterPositionLamports = await connection
        .getAccountInfo(positionKeypair.publicKey)
        .then((account) => account.lamports);

      const afterPosition = await dlmm.getPosition(positionKeypair.publicKey);

      assertEqRebalanceSimulationWithActualResult(
        rebalancePosition,
        afterPosition
      );

      const rentalChanges = new BN(afterPositionLamports).sub(
        new BN(beforePositionLamports)
      );

      expect(rentalChanges.toString()).toBe(
        simulationResult.rentalCostLamports.toString()
      );

      const [beforeWidth, afterWidth] = getBeforeAfterPositionWidth(
        beforePosition,
        afterPosition
      );

      expect(afterWidth).toBeGreaterThan(beforeWidth);

      // Clean up
      await dlmm
        .simulateRebalancePosition(
          positionKeypair.publicKey,
          afterPosition.positionData,
          true,
          true,
          [],
          [
            {
              minBinId: new BN(afterPosition.positionData.lowerBinId),
              maxBinId: new BN(afterPosition.positionData.upperBinId),
              bps: new BN(BASIS_POINT_MAX),
            },
          ]
        )
        .then(async ({ rebalancePosition, simulationResult }) => {
          const { initBinArrayInstructions: _, rebalancePositionInstruction } =
            await dlmm.rebalancePosition(
              { rebalancePosition, simulationResult },
              new BN(0)
            );

          const { blockhash, lastValidBlockHeight } =
            await connection.getLatestBlockhash();

          const transaction = new Transaction({
            blockhash,
            lastValidBlockHeight,
          }).add(...rebalancePositionInstruction);

          return sendAndConfirmTransaction(connection, transaction, [keypair]);
        });

      await dlmm.refetchStates();
    }
  });
});

describe("Rebalance with strategy", () => {
  it("Balanced strategy", async () => {});
});

function getBeforeAfterPositionWidth(
  beforePosition: LbPosition,
  afterPosition: LbPosition
) {
  const beforeWidth =
    beforePosition.positionData.upperBinId -
    beforePosition.positionData.lowerBinId +
    1;
  const afterWidth =
    afterPosition.positionData.upperBinId -
    afterPosition.positionData.lowerBinId +
    1;

  return [beforeWidth, afterWidth];
}
