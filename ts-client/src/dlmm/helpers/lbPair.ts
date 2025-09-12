import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Cluster, Connection, PublicKey } from "@solana/web3.js";
import { LBCLMM_PROGRAM_IDS } from "../constants";
import { LbPair } from "../types";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { createProgram } from ".";

/**
 * It fetches the pool account from the AMM program, and returns the mint addresses for the two tokens
 * @param {Connection} connection - Connection - The connection to the Solana cluster
 * @param {string} poolAddress - The address of the pool account.
 * @returns The tokenAMint and tokenBMint addresses for the pool.
 */
export async function getTokensMintFromPoolAddress(
  connection: Connection,
  poolAddress: string,
  opt?: {
    cluster?: Cluster;
    programId?: PublicKey;
  }
) {
  const program = createProgram(connection, opt);

  const poolAccount = await program.account.lbPair.fetchNullable(
    new PublicKey(poolAddress)
  );

  if (!poolAccount) throw new Error("Pool account not found");

  return {
    tokenXMint: poolAccount.tokenXMint,
    tokenYMint: poolAccount.tokenYMint,
  };
}

export function getTokenProgramId(lbPairState: LbPair) {
  const getTokenProgramIdByFlag = (flag: number) => {
    return flag == 0 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
  };
  return {
    tokenXProgram: getTokenProgramIdByFlag(lbPairState.tokenMintXProgramFlag),
    tokenYProgram: getTokenProgramIdByFlag(lbPairState.tokenMintYProgramFlag),
  };
}
