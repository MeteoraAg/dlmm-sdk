import { BN, web3 } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import babar from "babar";
import Decimal from "decimal.js";
import fs from "fs";
import { LBCLMM_PROGRAM_IDS } from "../dlmm/constants";
import {
  deriveCustomizablePermissionlessLbPair,
  getBinArrayLowerUpperBinId,
  getPriceOfBinByBinId,
} from "../dlmm/helpers";
import { DLMM } from "../dlmm/index";
import { ActivationType } from "../dlmm/types";

const keypairBuffer = fs.readFileSync(
  "../keys/localnet/admin-bossj3JvwiNK7pvjr149DqdtJxf2gdygbcmEPTkb2F1.json",
  "utf-8"
);
const connection = new Connection("http://127.0.0.1:8899", "confirmed");

const operator = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(keypairBuffer))
);

const positionOwner = Keypair.generate();
const feeOwner = Keypair.generate();
const lockDuration = new BN(86400 * 31);

const programId = new PublicKey(LBCLMM_PROGRAM_IDS["localhost"]);

describe("ILM test", () => {
  describe("WEN", () => {
    const baseKeypair = Keypair.generate();
    const wenDecimal = 5;
    const usdcDecimal = 6;
    const feeBps = new BN(500);

    let WEN: web3.PublicKey;
    let USDC: web3.PublicKey;
    let userWEN: web3.PublicKey;
    let userUSDC: web3.PublicKey;
    let pairKey: web3.PublicKey;
    let pair: DLMM;

    const toLamportMultiplier = new Decimal(10 ** (wenDecimal - usdcDecimal));

    const minPrice = 0.000001;
    const maxPrice = 0.00003;
    const binStep = 100;
    const curvature = 0.6;
    const seedAmount = new BN(200_000_000_000);

    const minBinId = DLMM.getBinIdFromPrice(
      new Decimal(minPrice).mul(toLamportMultiplier),
      binStep,
      false
    );

    beforeAll(async () => {
      WEN = await createMint(
        connection,
        operator,
        operator.publicKey,
        null,
        wenDecimal,
        Keypair.generate(),
        null,
        TOKEN_PROGRAM_ID
      );

      USDC = await createMint(
        connection,
        operator,
        operator.publicKey,
        null,
        usdcDecimal,
        Keypair.generate(),
        null,
        TOKEN_PROGRAM_ID
      );

      const userWenInfo = await getOrCreateAssociatedTokenAccount(
        connection,
        operator,
        WEN,
        operator.publicKey,
        false,
        "confirmed",
        {
          commitment: "confirmed",
        },
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      userWEN = userWenInfo.address;

      const userUsdcInfo = await getOrCreateAssociatedTokenAccount(
        connection,
        operator,
        USDC,
        operator.publicKey,
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
        operator,
        WEN,
        userWEN,
        operator.publicKey,
        200_000_000_000 * 10 ** wenDecimal,
        [],
        {
          commitment: "confirmed",
        },
        TOKEN_PROGRAM_ID
      );

      await mintTo(
        connection,
        operator,
        USDC,
        userUSDC,
        operator.publicKey,
        1_000_000_000 * 10 ** usdcDecimal,
        [],
        {
          commitment: "confirmed",
        },
        TOKEN_PROGRAM_ID
      );

      const slot = await connection.getSlot();
      const activationPoint = new BN(slot).add(new BN(100));

      let rawTx = await DLMM.createCustomizablePermissionlessLbPair(
        connection,
        new BN(binStep),
        WEN,
        USDC,
        new BN(minBinId.toString()),
        feeBps,
        ActivationType.Slot,
        false, // No alpha vault. Set to true the program will deterministically whitelist the alpha vault to swap before the pool start trading. Check: https://github.com/MeteoraAg/alpha-vault-sdk initialize{Prorata|Fcfs}Vault method to create the alpha vault.
        operator.publicKey,
        activationPoint,
        false,
        {
          cluster: "localhost",
        }
      );

      let txHash = await sendAndConfirmTransaction(connection, rawTx, [
        operator,
      ]).catch((e) => {
        console.error(e);
        throw e;
      });
      console.log("Create permissioned LB pair", txHash);

      [pairKey] = deriveCustomizablePermissionlessLbPair(WEN, USDC, programId);

      pair = await DLMM.create(connection, pairKey, {
        cluster: "localhost",
      });
    });

    it("seed liquidity", async () => {
      const currentSlot = await connection.getSlot();

      const lockReleaseSlot = lockDuration.add(new BN(currentSlot));

      const {
        sendPositionOwnerTokenProveIxs,
        initializeBinArraysAndPositionIxs,
        addLiquidityIxs,
      } = await pair.seedLiquidity(
        positionOwner.publicKey,
        seedAmount,
        curvature,
        minPrice,
        maxPrice,
        baseKeypair.publicKey,
        operator.publicKey,
        feeOwner.publicKey,
        operator.publicKey,
        lockReleaseSlot,
        true
      );

      // Send token prove
      {
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");

        const transaction = new Transaction({
          feePayer: operator.publicKey,
          blockhash,
          lastValidBlockHeight,
        }).add(...sendPositionOwnerTokenProveIxs);

        await sendAndConfirmTransaction(connection, transaction, [operator]);
      }

      // Initialize all bin array and position, transaction order can be in sequence or not
      {
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");
        const transactions = [];

        for (const groupIx of initializeBinArraysAndPositionIxs) {
          const tx = new Transaction({
            feePayer: operator.publicKey,
            blockhash,
            lastValidBlockHeight,
          }).add(...groupIx);

          const signers = [operator, baseKeypair];

          transactions.push(sendAndConfirmTransaction(connection, tx, signers));
        }

        await Promise.all(transactions)
          .then((txs) => {
            txs.map(console.log);
          })
          .catch((e) => {
            console.error(e);
            throw e;
          });
      }

      const beforeTokenXBalance = await connection
        .getTokenAccountBalance(userWEN)
        .then((i) => new BN(i.value.amount));

      {
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");

        const transactions = [];

        // Deposit to positions created in above step. The add liquidity order can be in sequence or not.
        for (const groupIx of addLiquidityIxs) {
          const tx = new Transaction({
            feePayer: operator.publicKey,
            blockhash,
            lastValidBlockHeight,
          }).add(...groupIx);

          const signers = [operator];

          transactions.push(sendAndConfirmTransaction(connection, tx, signers));
        }

        await Promise.all(transactions)
          .then((txs) => {
            txs.map(console.log);
          })
          .catch((e) => {
            console.error(e);
            throw e;
          });
      }

      const afterTokenXBalance = await connection
        .getTokenAccountBalance(userWEN)
        .then((i) => new BN(i.value.amount));

      const actualDepositedAmount = beforeTokenXBalance.sub(afterTokenXBalance);
      expect(actualDepositedAmount.toString()).toEqual(seedAmount.toString());

      const positions = await pair.getPositionsByUserAndLbPair(
        positionOwner.publicKey
      );

      const positionKeys = positions.userPositions.map((p) => p.publicKey);
      const positionStates =
        await pair.program.account.positionV2.fetchMultiple(positionKeys);

      for (const state of positionStates) {
        expect(state.feeOwner.toBase58()).toBe(feeOwner.publicKey.toBase58());
        expect(state.owner.toBase58()).toBe(positionOwner.publicKey.toBase58());
        expect(state.lockReleasePoint.toString()).toBe(
          lockReleaseSlot.toString()
        );
      }

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

      console.log(binLiquidities.filter((b) => b[1] > 0).reverse());
      console.log(binLiquidities.filter((b) => b[1] > 0));
      console.log(babar(binLiquidities));
    });
  });

  describe("Shaky", () => {
    const baseKeypair = Keypair.generate();
    const sharkyDecimal = 6;
    const usdcDecimal = 6;
    const feeBps = new BN(250);

    let SHARKY: web3.PublicKey;
    let USDC: web3.PublicKey;
    let userSHAKY: web3.PublicKey;
    let userUSDC: web3.PublicKey;
    let pairKey: web3.PublicKey;
    let pair: DLMM;

    const toLamportMultiplier = new Decimal(
      10 ** (sharkyDecimal - usdcDecimal)
    );

    const minPrice = 0.5;
    const maxPrice = 1.62;
    const binStep = 80;
    const curvature = 1;
    const seedAmount = new BN(5_000_000_000_000);

    const minBinId = DLMM.getBinIdFromPrice(
      new Decimal(minPrice).mul(toLamportMultiplier),
      binStep,
      false
    );

    beforeAll(async () => {
      SHARKY = await createMint(
        connection,
        operator,
        operator.publicKey,
        null,
        sharkyDecimal,
        Keypair.generate(),
        null,
        TOKEN_PROGRAM_ID
      );

      USDC = await createMint(
        connection,
        operator,
        operator.publicKey,
        null,
        usdcDecimal,
        Keypair.generate(),
        null,
        TOKEN_PROGRAM_ID
      );

      const userShakyInfo = await getOrCreateAssociatedTokenAccount(
        connection,
        operator,
        SHARKY,
        operator.publicKey,
        false,
        "confirmed",
        {
          commitment: "confirmed",
        },
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      userSHAKY = userShakyInfo.address;

      const userUsdcInfo = await getOrCreateAssociatedTokenAccount(
        connection,
        operator,
        USDC,
        operator.publicKey,
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
        operator,
        SHARKY,
        userSHAKY,
        operator.publicKey,
        200_000_000_000 * 10 ** sharkyDecimal,
        [],
        {
          commitment: "confirmed",
        },
        TOKEN_PROGRAM_ID
      );

      await mintTo(
        connection,
        operator,
        USDC,
        userUSDC,
        operator.publicKey,
        1_000_000_000 * 10 ** usdcDecimal,
        [],
        {
          commitment: "confirmed",
        },
        TOKEN_PROGRAM_ID
      );

      const slot = await connection.getSlot();
      const activationPoint = new BN(slot).add(new BN(100));

      let rawTx = await DLMM.createCustomizablePermissionlessLbPair(
        connection,
        new BN(binStep),
        SHARKY,
        USDC,
        new BN(minBinId.toString()),
        feeBps,
        ActivationType.Slot,
        false, // No alpha vault. Set to true the program will deterministically whitelist the alpha vault to swap before the pool start trading. Check: https://github.com/MeteoraAg/alpha-vault-sdk initialize{Prorata|Fcfs}Vault method to create the alpha vault.
        operator.publicKey,
        activationPoint,
        false,
        {
          cluster: "localhost",
        }
      );

      let txHash = await sendAndConfirmTransaction(connection, rawTx, [
        operator,
      ]).catch((e) => {
        console.error(e);
        throw e;
      });
      console.log("Create permissioned LB pair", txHash);

      [pairKey] = deriveCustomizablePermissionlessLbPair(
        SHARKY,
        USDC,
        programId
      );

      pair = await DLMM.create(connection, pairKey, {
        cluster: "localhost",
      });
    });

    it("seed liquidity", async () => {
      const currentSlot = await connection.getSlot();

      const lockReleaseSlot = new BN(currentSlot).add(lockDuration);

      const {
        sendPositionOwnerTokenProveIxs,
        initializeBinArraysAndPositionIxs,
        addLiquidityIxs,
      } = await pair.seedLiquidity(
        positionOwner.publicKey,
        seedAmount,
        curvature,
        minPrice,
        maxPrice,
        baseKeypair.publicKey,
        operator.publicKey,
        feeOwner.publicKey,
        operator.publicKey,
        lockReleaseSlot,
        true
      );

      // Send token prove
      {
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");

        const transaction = new Transaction({
          feePayer: operator.publicKey,
          blockhash,
          lastValidBlockHeight,
        }).add(...sendPositionOwnerTokenProveIxs);

        await sendAndConfirmTransaction(connection, transaction, [operator]);
      }

      // Initialize all bin array and position, transaction order can be in sequence or not
      {
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");
        const transactions = [];

        for (const groupIx of initializeBinArraysAndPositionIxs) {
          const tx = new Transaction({
            feePayer: operator.publicKey,
            blockhash,
            lastValidBlockHeight,
          }).add(...groupIx);

          const signers = [operator, baseKeypair];

          transactions.push(sendAndConfirmTransaction(connection, tx, signers));
        }

        await Promise.all(transactions)
          .then((txs) => {
            txs.map(console.log);
          })
          .catch((e) => {
            console.error(e);
            throw e;
          });
      }

      const beforeTokenXBalance = await connection
        .getTokenAccountBalance(userSHAKY)
        .then((i) => new BN(i.value.amount));

      {
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");

        const transactions = [];

        // Deposit to positions created in above step. The add liquidity order can be in sequence or not.
        for (const groupIx of addLiquidityIxs) {
          const tx = new Transaction({
            feePayer: operator.publicKey,
            blockhash,
            lastValidBlockHeight,
          }).add(...groupIx);

          const signers = [operator];

          transactions.push(sendAndConfirmTransaction(connection, tx, signers));
        }

        await Promise.all(transactions)
          .then((txs) => {
            txs.map(console.log);
          })
          .catch((e) => {
            console.error(e);
            throw e;
          });
      }

      const afterTokenXBalance = await connection
        .getTokenAccountBalance(userSHAKY)
        .then((i) => new BN(i.value.amount));

      const actualDepositedAmount = beforeTokenXBalance.sub(afterTokenXBalance);
      expect(actualDepositedAmount.toString()).toEqual(seedAmount.toString());

      const positions = await pair.getPositionsByUserAndLbPair(
        positionOwner.publicKey
      );

      const positionKeys = positions.userPositions.map((p) => p.publicKey);
      const positionStates =
        await pair.program.account.positionV2.fetchMultiple(positionKeys);

      for (const state of positionStates) {
        expect(state.feeOwner.toBase58()).toBe(feeOwner.publicKey.toBase58());
        expect(state.owner.toBase58()).toBe(positionOwner.publicKey.toBase58());
        expect(state.lockReleasePoint.toString()).toBe(
          lockReleaseSlot.toString()
        );
      }

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

      console.log(binLiquidities.filter((b) => b[1] > 0).reverse());
      console.log(binLiquidities.filter((b) => b[1] > 0));
      console.log(babar(binLiquidities));
    });
  });
});
