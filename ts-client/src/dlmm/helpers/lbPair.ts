import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Cluster, Connection, PublicKey } from "@solana/web3.js";
import { IDL } from "../idl";
import { LBCLMM_PROGRAM_IDS } from "../constants";

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
  }
) {
  const provider = new AnchorProvider(
    connection,
    {} as any,
    AnchorProvider.defaultOptions()
  );
  const program = new Program(
    IDL,
    LBCLMM_PROGRAM_IDS[opt?.cluster ?? "mainnet-beta"],
    provider
  );

  const poolAccount = await program.account.lbPair.fetchNullable(
    new PublicKey(poolAddress)
  );

  if (!poolAccount) return;

  return {
    tokenXMint: poolAccount.tokenXMint,
    tokenYMint: poolAccount.tokenYMint,
  };
}
