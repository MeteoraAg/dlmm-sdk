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
} from "../dlmm/helpers";
import { RebalancePosition } from "../dlmm/helpers/rebalance";
import { DLMM } from "../dlmm/index";
import { LbPosition, StrategyType } from "../dlmm/types";
import { createTestProgram } from "./helper";

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

const strategySet: { strategyX: StrategyType; strategyY: StrategyType }[] = [
  {
    strategyX: StrategyType.Spot,
    strategyY: StrategyType.Spot,
  },
  {
    strategyX: StrategyType.Curve,
    strategyY: StrategyType.Spot,
  },
  {
    strategyX: StrategyType.BidAsk,
    strategyY: StrategyType.Spot,
  },
  {
    strategyX: StrategyType.Curve,
    strategyY: StrategyType.Spot,
  },
  {
    strategyX: StrategyType.Curve,
    strategyY: StrategyType.Curve,
  },
  {
    strategyX: StrategyType.Curve,
    strategyY: StrategyType.BidAsk,
  },
  {
    strategyX: StrategyType.BidAsk,
    strategyY: StrategyType.Spot,
  },
  {
    strategyX: StrategyType.BidAsk,
    strategyY: StrategyType.Curve,
  },
  {
    strategyX: StrategyType.BidAsk,
    strategyY: StrategyType.BidAsk,
  },
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

    for (const { strategyX, strategyY } of strategySet) {
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

      const { simulationResult, rebalancePosition } =
        await dlmm.simulateRebalancePosition(
          positionKeypair.publicKey,
          beforePosition.positionData,
          true,
          true,
          [
            {
              minDeltaId: new BN(-10),
              maxDeltaId: new BN(20),
              amountX: new BN(10_000_000),
              amountY: new BN(10_000_000),
              strategyX,
              strategyY,
              favorXInActiveBin: false,
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

      expect(afterWidth).toBeLessThan(beforeWidth);
      await dlmm.refetchStates();
    }
  });

  it("Rebalance with only deposit and auto expand position", async () => {
    const dlmm = await DLMM.create(connection, lbPairPubkey, {
      cluster: "localhost",
    });

    for (const { strategyX, strategyY } of strategySet) {
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

      const { simulationResult, rebalancePosition } =
        await dlmm.simulateRebalancePosition(
          positionKeypair.publicKey,
          beforePosition.positionData,
          true,
          true,
          [
            {
              minDeltaId: new BN(-50),
              maxDeltaId: new BN(50),
              amountX: new BN(10_000_000),
              amountY: new BN(10_000_000),
              strategyX,
              strategyY,
              favorXInActiveBin: false,
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
    for (const { strategyX, strategyY } of strategySet) {
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

        const { simulationResult, rebalancePosition } =
          await dlmm.simulateRebalancePosition(
            positionKeypair.publicKey,
            beforePosition.positionData,
            true,
            true,
            [
              {
                minDeltaId: new BN(beforePosition.positionData.lowerBinId).subn(
                  dlmm.lbPair.activeId
                ),
                maxDeltaId: new BN(beforePosition.positionData.upperBinId).subn(
                  dlmm.lbPair.activeId
                ),
                amountX: new BN(100_000_000),
                amountY: new BN(100_000_000),
                strategyX,
                strategyY,
                favorXInActiveBin: false,
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

      // Rebalance
      const { simulationResult, rebalancePosition } =
        await dlmm.simulateRebalancePosition(
          positionKeypair.publicKey,
          beforePosition.positionData,
          true,
          true,
          [
            {
              minDeltaId: new BN(beforePosition.positionData.lowerBinId)
                .subn(dlmm.lbPair.activeId)
                .addn(10),
              maxDeltaId: new BN(beforePosition.positionData.upperBinId)
                .subn(dlmm.lbPair.activeId)
                .subn(10),
              amountX: new BN(100_000_000),
              amountY: new BN(100_000_000),
              strategyX,
              strategyY,
              favorXInActiveBin: false,
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
    for (const { strategyX, strategyY } of strategySet) {
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

        const { simulationResult, rebalancePosition } =
          await dlmm.simulateRebalancePosition(
            positionKeypair.publicKey,
            beforePosition.positionData,
            true,
            true,
            [
              {
                minDeltaId: new BN(beforePosition.positionData.lowerBinId).subn(
                  dlmm.lbPair.activeId
                ),
                maxDeltaId: new BN(beforePosition.positionData.upperBinId).subn(
                  dlmm.lbPair.activeId
                ),
                amountX: new BN(100_000_000),
                amountY: new BN(100_000_000),
                strategyX,
                strategyY,
                favorXInActiveBin: false,
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

      // Rebalance
      const { simulationResult, rebalancePosition } =
        await dlmm.simulateRebalancePosition(
          positionKeypair.publicKey,
          beforePosition.positionData,
          true,
          true,
          [
            {
              minDeltaId: new BN(beforePosition.positionData.lowerBinId)
                .subn(dlmm.lbPair.activeId)
                .subn(10),
              maxDeltaId: new BN(beforePosition.positionData.upperBinId)
                .subn(dlmm.lbPair.activeId)
                .addn(10),
              amountX: new BN(100_000_000),
              amountY: new BN(100_000_000),
              strategyX,
              strategyY,
              favorXInActiveBin: false,
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

function assertEqRebalanceSimulationWithActualResult(
  rebalancePosition: RebalancePosition,
  position: LbPosition
) {
  const [simulatedAmountX, simulatedAmountY] = rebalancePosition.totalAmounts();

  expect(position.positionData.totalXAmount.toString()).toBe(
    simulatedAmountX.toString()
  );

  expect(position.positionData.totalYAmount.toString()).toBe(
    simulatedAmountY.toString()
  );

  expect(position.positionData.lowerBinId).toBe(
    rebalancePosition.lowerBinId.toNumber()
  );

  expect(position.positionData.upperBinId).toBe(
    rebalancePosition.upperBinId.toNumber()
  );

  expect(rebalancePosition.rebalancePositionBinData.length).toBe(
    position.positionData.positionBinData.length
  );

  for (let i = 0; i < position.positionData.positionBinData.length; i++) {
    const simBinData = rebalancePosition.rebalancePositionBinData[i];
    const binData = position.positionData.positionBinData[i];

    expect(simBinData.binId).toBe(binData.binId);
    expect(simBinData.amountX.toString()).toBe(binData.positionXAmount);
    expect(simBinData.amountY.toString()).toBe(binData.positionYAmount);

    expect(simBinData.claimableFeeXAmount.toString()).toBe(
      binData.positionFeeXAmount
    );
    expect(simBinData.claimableFeeYAmount.toString()).toBe(
      binData.positionFeeYAmount
    );
    expect(simBinData.claimableRewardAmount[0].toString()).toBe(
      binData.positionRewardAmount[0]
    );
    expect(simBinData.claimableRewardAmount[1].toString()).toBe(
      binData.positionRewardAmount[1]
    );
  }
}
