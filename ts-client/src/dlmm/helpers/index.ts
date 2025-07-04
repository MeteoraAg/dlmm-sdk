import { AnchorProvider, BN, EventParser, Program } from "@coral-xyz/anchor";
import { IdlDiscriminator } from "@coral-xyz/anchor/dist/cjs/idl";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import {
  Cluster,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  LBCLMM_PROGRAM_IDS,
  MAX_BINS_PER_POSITION,
  SCALE_OFFSET,
  U64_MAX,
} from "../constants";
import IDL from "../dlmm.json";
import { LbClmm } from "../idl";
import {
  AccountName,
  Bin,
  BinArray,
  BinArrayBitmapExtension,
  ClmmProgram,
  GetOrCreateATAResponse,
  LbPair,
  Position,
  PositionV2,
  PresetParameter,
  PresetParameter2,
} from "../types";
import {
  MAX_CU_BUFFER,
  MIN_CU_BUFFER,
  getSimulationComputeUnits,
} from "./computeUnit";
import { Rounding, mulShr, shlDiv } from "./math";
import { LiquidityStrategyParameters } from "./rebalance";

export * from "./binArray";
export * from "./derive";
export * from "./fee";
export * from "./lbPair";
export * from "./positions";
export * from "./rebalance";
export * from "./strategy";
export * from "./weight";
export * from "./weightToAmounts";

export function chunks<T>(array: T[], size: number): T[][] {
  return Array.apply(0, new Array(Math.ceil(array.length / size))).map(
    (_, index) => array.slice(index * size, (index + 1) * size)
  );
}

export function range<T>(min: number, max: number, mapfn: (i: number) => T) {
  const length = max - min + 1;
  return Array.from({ length }, (_, i) => mapfn(min + i));
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
  programId?: PublicKey,
  payer: PublicKey = owner,
  allowOwnerOffCurve = true
): Promise<GetOrCreateATAResponse> => {
  programId = programId ?? TOKEN_PROGRAM_ID;
  const toAccount = getAssociatedTokenAddressSync(
    tokenMint,
    owner,
    allowOwnerOffCurve,
    programId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  try {
    await getAccount(connection, toAccount, connection.commitment, programId);

    return { ataPubKey: toAccount, ix: undefined };
  } catch (e) {
    if (
      e instanceof TokenAccountNotFoundError ||
      e instanceof TokenInvalidAccountOwnerError
    ) {
      const ix = createAssociatedTokenAccountIdempotentInstruction(
        payer,
        toAccount,
        owner,
        tokenMint,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID
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

export const unwrapSOLInstruction = async (
  owner: PublicKey,
  allowOwnerOffCurve = true
) => {
  const wSolATAAccount = getAssociatedTokenAddressSync(
    NATIVE_MINT,
    owner,
    allowOwnerOffCurve
  );
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

/**
 * Gets the estimated compute unit usage with a buffer.
 * @param connection A Solana connection object.
 * @param instructions The instructions of the transaction to simulate.
 * @param feePayer The public key of the fee payer.
 * @param buffer The buffer to add to the estimated compute unit usage. Max value is 1. Default value is 0.1 if not provided, and will be capped between 50k - 200k.
 * @returns The estimated compute unit usage with the buffer.
 */
export const getEstimatedComputeUnitUsageWithBuffer = async (
  connection: Connection,
  instructions: TransactionInstruction[],
  feePayer: PublicKey,
  buffer?: number
) => {
  if (!buffer) {
    buffer = 0.1;
  }
  // Avoid negative value
  buffer = Math.max(0, buffer);
  // Limit buffer to 1
  buffer = Math.min(1, buffer);

  const estimatedComputeUnitUsage = await getSimulationComputeUnits(
    connection,
    instructions,
    feePayer,
    []
  );

  let extraComputeUnitBuffer = estimatedComputeUnitUsage * buffer;
  if (extraComputeUnitBuffer > MAX_CU_BUFFER) {
    extraComputeUnitBuffer = MAX_CU_BUFFER;
  } else if (extraComputeUnitBuffer < MIN_CU_BUFFER) {
    extraComputeUnitBuffer = MIN_CU_BUFFER;
  }

  return estimatedComputeUnitUsage + extraComputeUnitBuffer;
};

/**
 * Gets the estimated compute unit usage with a buffer and converts it to a SetComputeUnitLimit instruction.
 * If the estimated compute unit usage cannot be retrieved, returns a SetComputeUnitLimit instruction with the fallback unit.
 * @param connection A Solana connection object.
 * @param instructions The instructions of the transaction to simulate.
 * @param feePayer The public key of the fee payer.
 * @param buffer The buffer to add to the estimated compute unit usage. Max value is 1. Default value is 0.1 if not provided, and will be capped between 50k - 200k.
 * @returns A SetComputeUnitLimit instruction with the estimated compute unit usage.
 */
export const getEstimatedComputeUnitIxWithBuffer = async (
  connection: Connection,
  instructions: TransactionInstruction[],
  feePayer: PublicKey,
  buffer?: number
) => {
  const units = await getEstimatedComputeUnitUsageWithBuffer(
    connection,
    instructions,
    feePayer,
    buffer
  ).catch((error) => {
    console.error("Error::getEstimatedComputeUnitUsageWithBuffer", error);
    return 1_400_000;
  });

  return ComputeBudgetProgram.setComputeUnitLimit({ units });
};

export type Opt = {
  cluster?: Cluster | "localhost";
  programId?: PublicKey;
};

export function createProgram(connection: Connection, opt?: Opt) {
  const cluster = opt?.cluster || "mainnet-beta";
  const provider = new AnchorProvider(
    connection,
    {} as any,
    AnchorProvider.defaultOptions()
  );

  return new Program<LbClmm>(
    { ...IDL, address: LBCLMM_PROGRAM_IDS[cluster] },
    provider
  );
}

export function decodeAccount<
  T extends
    | LbPair
    | BinArrayBitmapExtension
    | BinArray
    | PositionV2
    | Position
    | PresetParameter
    | PresetParameter2
>(program: Program<LbClmm>, accountName: AccountName, buffer: Buffer): T {
  return program.coder.accounts.decode(accountName, buffer);
}

export function getAccountDiscriminator(
  accountName: AccountName
): IdlDiscriminator {
  return IDL.accounts.find(
    (acc) => acc.name.toLowerCase() === accountName.toLowerCase()
  )?.discriminator;
}

export function capSlippagePercentage(slippage: number) {
  if (slippage > 100) {
    slippage = 100;
  }

  if (slippage < 0) {
    slippage = 0;
  }

  return slippage;
}

export function getAndCapMaxActiveBinSlippage(
  slippagePercentage: number,
  binStep: number,
  maxActiveBinSlippage: number
) {
  return slippagePercentage
    ? Math.ceil(slippagePercentage / (binStep / 100))
    : maxActiveBinSlippage;
}

export function getBinCount(minBinId: number, maxBinId: number) {
  return maxBinId - minBinId + 1;
}

export function getSlippageMaxAmount(amount: BN, slippage: number) {
  return slippage == 100 ? U64_MAX : amount.muln(100 + slippage).divn(100);
}

export function getSlippageMinAmount(amount: BN, slippage: number) {
  return amount.muln(100 - slippage).divn(100);
}

export function getPositionCountByBinCount(binCount: number) {
  return Math.ceil(binCount / MAX_BINS_PER_POSITION.toNumber());
}

export function resetUninvolvedLiquidityParams(
  minDeltaId: BN,
  maxDeltaId: BN,
  favorXInActiveId: boolean,
  params: LiquidityStrategyParameters
) {
  const endBidSideDeltaId = favorXInActiveId ? new BN(-1) : new BN(0);
  const startAskSideDeltaId = endBidSideDeltaId.addn(1);

  let x0 = params.x0;
  let y0 = params.y0;
  let deltaX = params.deltaX;
  let deltaY = params.deltaY;

  if (maxDeltaId.lte(endBidSideDeltaId)) {
    deltaX = new BN(0);
    x0 = new BN(0);
  }

  if (minDeltaId.gte(startAskSideDeltaId)) {
    deltaY = new BN(0);
    y0 = new BN(0);
  }

  return {
    x0,
    y0,
    deltaX,
    deltaY,
  };
}
