import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { IDL } from "../idl";
import { BN } from "@coral-xyz/anchor";
import Decimal from "decimal.js";

export const LBCLMM_PROGRAM_IDS = {
  devnet: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
  localhost: "LbVRzDTvBDEcrthxfZ4RL6yiq3uZw8bS6MwtdY6UhFQ",
  "mainnet-beta": "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
};

export const ADMIN = {
  devnet: "6WaLrrRfReGKBYUSkmx2K6AuT21ida4j8at2SUiZdXu8",
  localhost: "bossj3JvwiNK7pvjr149DqdtJxf2gdygbcmEPTkb2F1",
};

export enum Network {
  MAINNET = "mainnet-beta",
  TESTNET = "testnet",
  DEVNET = "devnet",
  LOCAL = "localhost",
}

export const BASIS_POINT_MAX = 10000;
export const SCALE_OFFSET = 64;
export const SCALE = new BN(1).shln(SCALE_OFFSET);

export const FEE_PRECISION = new BN(1_000_000_000);
export const MAX_FEE_RATE = new BN(100_000_000);
// https://solscan.io/tx/5JgHgEiVoqV61p3SASYzP4gnedvYFLhewPchBdFgPQZjHEiitjZCqs8u4rXyDYnGJ9zqAscknv9NoBiodsfDE1qR
export const BIN_ARRAY_FEE = 0.07143744;
// https://solscan.io/tx/37yEmHsTU6tKjUc6iGG8GPiEuPHxiyBezwexsnnsqXQQKuDgwsNciEzkQZFWJShcdLpfug5xqNBPJkzit7eWvkDD
export const POSITION_FEE = 0.05740608;
export const TOKEN_ACCOUNT_FEE = 0.00203928;
// https://solscan.io/tx/4QkTyVZbZgS3Go7ksEWzmHef7SBVgoJ8Fjjxk3eL9LZBBmrXHJarVM4TPy5Nq3XcjwdhWALeCCbL7xonExBGpNry
export const POOL_FEE = 0.00718272;
export const BIN_ARRAY_BITMAP_FEE = 0.01180416;

export const BIN_ARRAY_FEE_BN = new BN(
  new Decimal(BIN_ARRAY_FEE).mul(LAMPORTS_PER_SOL).toString()
);
export const POSITION_FEE_BN = new BN(
  new Decimal(POSITION_FEE).mul(LAMPORTS_PER_SOL).toString()
);
export const TOKEN_ACCOUNT_FEE_BN = new BN(
  new Decimal(TOKEN_ACCOUNT_FEE).mul(LAMPORTS_PER_SOL).toString()
);
export const POOL_FEE_BN = new BN(
  new Decimal(POOL_FEE).mul(LAMPORTS_PER_SOL).toString()
);
export const BIN_ARRAY_BITMAP_FEE_BN = new BN(
  new Decimal(BIN_ARRAY_BITMAP_FEE).mul(LAMPORTS_PER_SOL).toString()
);

const CONSTANTS = Object.entries(IDL.constants);

export const MAX_BIN_ARRAY_SIZE = new BN(
  CONSTANTS.find(([k, v]) => v.name == "MAX_BIN_PER_ARRAY")?.[1].value ?? 0
);
export const MAX_BIN_PER_POSITION = new BN(
  CONSTANTS.find(([k, v]) => v.name == "MAX_BIN_PER_POSITION")?.[1].value ?? 0
);
export const BIN_ARRAY_BITMAP_SIZE = new BN(
  CONSTANTS.find(([k, v]) => v.name == "BIN_ARRAY_BITMAP_SIZE")?.[1].value ?? 0
);
export const EXTENSION_BINARRAY_BITMAP_SIZE = new BN(
  CONSTANTS.find(([k, v]) => v.name == "EXTENSION_BINARRAY_BITMAP_SIZE")?.[1]
    .value ?? 0
);

export const SIMULATION_USER = new PublicKey(
  "HrY9qR5TiB2xPzzvbBu5KrBorMfYGQXh9osXydz4jy9s"
);

export const PRECISION = 18446744073709551616;

export const MAX_CLAIM_ALL_ALLOWED = 3;

export const MAX_BIN_LENGTH_ALLOWED_IN_ONE_TX = 26;
export const MAX_BIN_PER_TX = 69;

export const MAX_ACTIVE_BIN_SLIPPAGE = 3;

export const ILM_BASE = new PublicKey(
  "MFGQxwAmB91SwuYX36okv2Qmdc9aMuHTwWGUrp4AtB1"
);

export const MAX_EXTRA_BIN_ARRAYS = 3;
export const U64_MAX = new BN("18446744073709551615");
