import { BN, EventParser } from "@coral-xyz/anchor";
import {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import { SCALE_OFFSET } from "../constants";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { Bin, ClmmProgram, GetOrCreateATAResponse } from "../types";
import { Rounding, mulShr, shlDiv } from "./math";

export * from "./derive";
export * from "./binArray";
export * from "./strategy";
export * from "./fee";

export function chunks<T>(array: T[], size: number): T[][] {
  return Array.apply(0, new Array(Math.ceil(array.length / size))).map(
    (_, index) => array.slice(index * size, (index + 1) * size)
  );
}

export async function chunkedFetchMultiplePoolAccount(
  program: ClmmProgram,
  pks: PublicKey[],
  chunkSize: number = 100
) {
  const accounts = (
    await Promise.all(
      chunks(pks, chunkSize).map((chunk) =>
        program.account.lbPair.fetchMultiple(chunk)
      )
    )
  ).flat();

  return accounts.filter(Boolean);
}

export async function chunkedFetchMultipleBinArrayBitmapExtensionAccount(
  program: ClmmProgram,
  pks: PublicKey[],
  chunkSize: number = 100
) {
  const accounts = (
    await Promise.all(
      chunks(pks, chunkSize).map((chunk) =>
        program.account.binArrayBitmapExtension.fetchMultiple(chunk)
      )
    )
  ).flat();

  return accounts;
}

export function getOutAmount(bin: Bin, inAmount: BN, swapForY: boolean) {
  return swapForY
    ? mulShr(inAmount, bin.price, SCALE_OFFSET, Rounding.Down)
    : shlDiv(inAmount, bin.price, SCALE_OFFSET, Rounding.Down);
}

export async function getTokenDecimals(conn: Connection, mint: PublicKey) {
  const token = await getMint(conn, mint);
  return await token.decimals;
}

export const getOrCreateATAInstruction = async (
  connection: Connection,
  tokenMint: PublicKey,
  owner: PublicKey,
  payer: PublicKey = owner,
  allowOwnerOffCurve = true
): Promise<GetOrCreateATAResponse> => {
  const toAccount = getAssociatedTokenAddressSync(
    tokenMint,
    owner,
    allowOwnerOffCurve
  );

  try {
    await getAccount(connection, toAccount);

    return { ataPubKey: toAccount, ix: undefined };
  } catch (e) {
    if (
      e instanceof TokenAccountNotFoundError ||
      e instanceof TokenInvalidAccountOwnerError
    ) {
      const ix = createAssociatedTokenAccountInstruction(
        payer,
        toAccount,
        owner,
        tokenMint
      );

      return { ataPubKey: toAccount, ix };
    } else {
      /* handle error */
      console.error("Error::getOrCreateATAInstruction", e);
      throw e;
    }
  }
};

export async function getTokenBalance(
  conn: Connection,
  tokenAccount: PublicKey
): Promise<bigint> {
  const acc = await getAccount(conn, tokenAccount);
  return acc.amount;
}

export const parseLogs = <T>(eventParser: EventParser, logs: string[]) => {
  if (!logs.length) throw new Error("No logs found");

  for (const event of eventParser?.parseLogs(logs)) {
    return event.data as T;
  }

  throw new Error("No events found");
};

export const wrapSOLInstruction = (
  from: PublicKey,
  to: PublicKey,
  amount: bigint
): TransactionInstruction[] => {
  return [
    SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: to,
      lamports: amount,
    }),
    new TransactionInstruction({
      keys: [
        {
          pubkey: to,
          isSigner: false,
          isWritable: true,
        },
      ],
      data: Buffer.from(new Uint8Array([17])),
      programId: TOKEN_PROGRAM_ID,
    }),
  ];
};

export const unwrapSOLInstruction = async (owner: PublicKey) => {
  const wSolATAAccount = getAssociatedTokenAddressSync(NATIVE_MINT, owner);
  if (wSolATAAccount) {
    const closedWrappedSolInstruction = createCloseAccountInstruction(
      wSolATAAccount,
      owner,
      owner,
      [],
      TOKEN_PROGRAM_ID
    );
    return closedWrappedSolInstruction;
  }
  return null;
};

export async function chunkedGetMultipleAccountInfos(
  connection: Connection,
  pks: PublicKey[],
  chunkSize: number = 100
) {
  const accountInfos = (
    await Promise.all(
      chunks(pks, chunkSize).map((chunk) =>
        connection.getMultipleAccountsInfo(chunk)
      )
    )
  ).flat();

  return accountInfos;
}

export const computeBudgetIx = () => {
  return ComputeBudgetProgram.setComputeUnitLimit({
    units: 1_400_000,
  });
};
