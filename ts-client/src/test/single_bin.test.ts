import { BN, web3 } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  AccountLayout,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transfer,
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
import e from "express";

const keypairBuffer = fs.readFileSync(
  "../keys/localnet/admin-bossj3JvwiNK7pvjr149DqdtJxf2gdygbcmEPTkb2F1.json",
  "utf-8"
);
const connection = new Connection("http://127.0.0.1:8899", "confirmed");
const owner = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(keypairBuffer))
);
const programId = new PublicKey(LBCLMM_PROGRAM_IDS["localhost"]);

describe("Single Bin Seed Liquidity Test", () => {
  describe("TokenX decimals < TokenY decimals", () => {
    const baseKeypair = Keypair.generate();
    const positionOwnerKeypair = Keypair.generate();
    const feeOwnerKeypair = Keypair.generate();

    const wenDecimal = 5;
    const usdcDecimal = 6;
    const feeBps = new BN(500);
    const initialPrice = 0.000001;
    const binStep = 100;
    const wenSeedAmount = new BN(200_000 * 10 ** wenDecimal);

    let WEN: web3.PublicKey;
    let USDC: web3.PublicKey;
    let userWEN: web3.PublicKey;
    let userUSDC: web3.PublicKey;
    let pairKey: web3.PublicKey;
    let pair: DLMM;
    let positionOwnerTokenX: web3.PublicKey;

    const initialPricePerLamport = DLMM.getPricePerLamport(wenDecimal, usdcDecimal, initialPrice);
    const binId = DLMM.getBinIdFromPrice(initialPricePerLamport, binStep, false);

    beforeAll(async () => {
      WEN = await createMint(
        connection,
        owner,
        owner.publicKey,
        null,
        wenDecimal,
        Keypair.generate(),
        null,
        TOKEN_PROGRAM_ID
      );

      USDC = await createMint(
        connection,
        owner,
        owner.publicKey,
        null,
        usdcDecimal,
        Keypair.generate(),
        null,
        TOKEN_PROGRAM_ID
      );

      const userWenInfo = await getOrCreateAssociatedTokenAccount(
        connection,
        owner,
        WEN,
        owner.publicKey,
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
        owner,
        USDC,
        owner.publicKey,
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
        owner,
        WEN,
        userWEN,
        owner.publicKey,
        wenSeedAmount.toNumber() + 1,
        [],
        {
          commitment: "confirmed",
        },
        TOKEN_PROGRAM_ID
      );

      await mintTo(
        connection,
        owner,
        USDC,
        userUSDC,
        owner.publicKey,
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
        new BN(binId.toString()),
        feeBps,
        ActivationType.Slot,
        false, // No alpha vault. Set to true the program will deterministically whitelist the alpha vault to swap before the pool start trading. Check: https://github.com/MeteoraAg/alpha-vault-sdk initialize{Prorata|Fcfs}Vault method to create the alpha vault.
        owner.publicKey,
        activationPoint,
        false,
        {
          cluster: "localhost",
        }
      );

      let txHash = await sendAndConfirmTransaction(connection, rawTx, [
        owner,
      ]).catch((e) => {
        console.error(e);
        throw e;
      });
      console.log("Create permissioned LB pair", txHash);

      [pairKey] = deriveCustomizablePermissionlessLbPair(WEN, USDC, programId);

      pair = await DLMM.create(connection, pairKey, {
        cluster: "localhost",
      });

      positionOwnerTokenX = getAssociatedTokenAddressSync(
        WEN, positionOwnerKeypair.publicKey, true
      );
    });

    it("seed liquidity single bin", async () => {
      try {
        const positionOwnerTokenXBalance = await connection.getTokenAccountBalance(positionOwnerTokenX)

        if (positionOwnerTokenXBalance.value.amount == "0") {
          await transfer(connection, owner, userWEN, positionOwnerTokenX, owner, 1);

        }
      } catch (err) {
        await createAssociatedTokenAccount(connection, owner, WEN, positionOwnerKeypair.publicKey);
        await transfer(connection, owner, userWEN, positionOwnerTokenX, owner, 1);
      }

      const ixs = await pair.seedLiquiditySingleBin(
        owner.publicKey,
        baseKeypair.publicKey,
        wenSeedAmount,
        initialPrice,
        true,
        positionOwnerKeypair.publicKey,
        feeOwnerKeypair.publicKey,
        owner.publicKey,
        new BN(0)
      );

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({
        feePayer: owner.publicKey,
        blockhash,
        lastValidBlockHeight,
      }).add(...ixs);


      const beforeTokenXBalance = await connection
        .getTokenAccountBalance(userWEN)
        .then((i) => new BN(i.value.amount));

      await sendAndConfirmTransaction(connection, tx, [
        owner,
        baseKeypair,
      ]).catch((e) => {
        console.error(e)
      });

      const afterTokenXBalance = await connection
        .getTokenAccountBalance(userWEN)
        .then((i) => new BN(i.value.amount));

      // minus 1 send to positionOwnerTokenX account
      const actualDepositedAmount = beforeTokenXBalance.sub(afterTokenXBalance);
      expect(actualDepositedAmount.toString()).toEqual(wenSeedAmount.toString());
    })

  })

});
