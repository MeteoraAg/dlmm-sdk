import { PublicKey } from "@solana/web3.js";
import { IDL } from "../idl";
import { BN } from "@coral-xyz/anchor";

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
export const BIN_ARRAY_FEE = 0.07054656;
export const POSITION_FEE = 0.0565152;

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
