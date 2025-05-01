import { BN, web3 } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  transfer,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import Decimal from "decimal.js";
import fs from "fs";
import {
  BASIS_POINT_MAX,
  DEFAULT_BIN_PER_POSITION,
  LBCLMM_PROGRAM_IDS,
} from "../dlmm/constants";
import IDL from "../dlmm/dlmm.json";
import {
  binIdToBinArrayIndex,
  deriveBinArray,
  deriveLbPair2,
  deriveLbPairWithPresetParamWithIndexKey,
  deriveOracle,
  derivePermissionLbPair,
  derivePresetParameter2,
  derivePresetParameterWithIndex,
  deriveReserve,
} from "../dlmm/helpers";
import { computeBaseFactorFromFeeBps } from "../dlmm/helpers/math";
import { wrapPosition } from "../dlmm/helpers/positions";
import { DLMM } from "../dlmm/index";
import {
  ActivationType,
  LbPosition,
  PairType,
  StrategyType,
} from "../dlmm/types";
import { createTestProgram } from "./helper";
import { RebalancePosition } from "../dlmm/helpers/rebalance";

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

const DEFAULT_ACTIVE_ID = new BN(5660);
const DEFAULT_BIN_STEP = new BN(10);
const DEFAULT_BASE_FACTOR = new BN(10000);
const DEFAULT_BASE_FACTOR_2 = new BN(4000);

const programId = new web3.PublicKey(LBCLMM_PROGRAM_IDS["localhost"]);

let BTC: web3.PublicKey;
let USDC: web3.PublicKey;
let lbPairPubkey: web3.PublicKey;
let userBTC: web3.PublicKey;
let userUSDC: web3.PublicKey;
let presetParamPda2: web3.PublicKey;

const positionKeypair = Keypair.generate();

describe("Rebalance", () => {
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

    const dlmm = await DLMM.create(connection, lbPairPubkey, {
      cluster: "localhost",
    });

    rawTx = await dlmm.createEmptyPosition({
      positionPubKey: positionKeypair.publicKey,
      user: keypair.publicKey,
      minBinId: dlmm.lbPair.activeId - 30,
      maxBinId: dlmm.lbPair.activeId + 30,
    });

    await sendAndConfirmTransaction(connection, rawTx, [
      positionKeypair,
      keypair,
    ]);
  });

  it("Rebalance with only deposit", async () => {
    const dlmm = await DLMM.create(connection, lbPairPubkey, {
      cluster: "localhost",
    });
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
            amountX: new BN(100_000_000),
            amountY: new BN(10_000_000),
            strategyX: StrategyType.BidAsk,
            strategyY: StrategyType.Spot,
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

    const afterPosition = await dlmm.getPosition(positionKeypair.publicKey);
    assertEqRebalanceSimulationWithActualResult(
      rebalancePosition,
      afterPosition
    );
  });
});

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
