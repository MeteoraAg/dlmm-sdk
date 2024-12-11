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
const keypair = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(keypairBuffer))
);
const programId = new PublicKey(LBCLMM_PROGRAM_IDS["localhost"]);
