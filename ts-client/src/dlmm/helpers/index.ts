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
import { DLMM } from "..";
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
  ActionType,
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
  RebalanceAddLiquidityParam,
  StrategyParameters,
} from "../types";
import {
  deriveBinArrayBitmapExtension,
  isOverflowDefaultBinArrayBitmap,
} from "./binArray";
import {
  DEFAULT_ADD_LIQUIDITY_CU,
  DEFAULT_CLOSE_ATA_CU,
  DEFAULT_INIT_ATA_CU,
  DEFAULT_INIT_BIN_ARRAY_CU,
  DEFAULT_INIT_BITMAP_EXTENSION_CU,
  DEFAULT_REBALANCE_ADD_LIQUIDITY_CU,
  MAX_CU,
  MAX_CU_BUFFER,
  MIN_CU_BUFFER,
  getSimulationComputeUnits,
} from "./computeUnit";
import { deriveBinArray, derivePlaceHolderAccountMeta } from "./derive";
import { Rounding, mulShr, shlDiv } from "./math";
import { chunkBinRange, getBinArrayIndexesCoverage } from "./positions";
import {
  LiquidityStrategyParameters,
  buildBitFlagAndNegateStrategyParameters,
  toAmountIntoBins,
} from "./rebalance";
import { calculateTransferFeeIncludedAmount } from "./token_2022";
import Decimal from "decimal.js";

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
    { ...IDL, address: opt?.programId ?? LBCLMM_PROGRAM_IDS[cluster] },
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

/**
 * Caps a slippage percentage to be between 0 and 100.
 * @param slippage The slippage percentage to be capped.
 * @returns The capped slippage percentage.
 */
export function capSlippagePercentage(slippage: number) {
  if (slippage > 100) {
    slippage = 100;
  }

  if (slippage < 0) {
    slippage = 0;
  }

  return slippage;
}
/**
 * Given a slippage percentage and a bin step, calculate the maximum number of bins
 * that the user is willing to allow the active bin to drift from the target price.
 * If the slippage percentage is 0 or null, return the maxActiveBinSlippage instead.
 *
 * @param slippagePercentage The slippage percentage in basis points.
 * @param binStep The bin step of the pair.
 * @param maxActiveBinSlippage The maximum number of bins that the active bin can drift.
 * @returns The maximum number of bins that the user is willing to allow the active bin to drift.
 */
export function getAndCapMaxActiveBinSlippage(
  slippagePercentage: number,
  binStep: number,
  maxActiveBinSlippage: number
) {
  return slippagePercentage
    ? Math.ceil(slippagePercentage / (binStep / 100))
    : maxActiveBinSlippage;
}

/**
 * Calculates the number of bins in a given range.
 *
 * @param minBinId The minimum bin id of the range.
 * @param maxBinId The maximum bin id of the range.
 * @returns The number of bins in the range.
 */
export function getBinCount(minBinId: number, maxBinId: number) {
  return maxBinId - minBinId + 1;
}

/**
 * Calculates the maximum amount of tokens after applying slippage to the given amount.
 *
 * @param amount The amount of tokens before slippage.
 * @param slippage The percentage of slippage to apply.
 * @returns The maximum amount of tokens after applying slippage. If the slippage is 100%, the maximum amount is U64_MAX.
 *
 **/
export function getSlippageMaxAmount(amount: BN, slippage: number) {
  if (slippage == 100) {
    return U64_MAX;
  }

  const amountDecimal = new Decimal(amount.toString());

  const slippageAppliedAmount = new BN(
    amountDecimal
      .mul(new Decimal(100 + slippage))
      .div(new Decimal(100))
      .floor()
      .toString()
  );

  return slippageAppliedAmount;
}

/**
 * Calculates the minimum amount of tokens after applying slippage to the given amount.
 *
 * @param amount The amount of tokens before slippage.
 * @param slippage The percentage of slippage to apply.
 * @returns The minimum amount of tokens after applying slippage.
 */
export function getSlippageMinAmount(amount: BN, slippage: number) {
  const amountDecimal = new Decimal(amount.toString());
  return new BN(
    amountDecimal
      .mul(new Decimal(100 - slippage))
      .div(new Decimal(100))
      .ceil()
      .toString()
  );
}

/**
 * Calculates the number of positions required to cover a range of bins.
 *
 * @param binCount The number of bins in the range.
 * @returns The number of positions required to cover the range of bins.
 */
export function getPositionCountByBinCount(binCount: number) {
  return Math.ceil(binCount / MAX_BINS_PER_POSITION.toNumber());
}

/**
 * Adjusts the liquidity parameters to reset uninvolved liquidity based on delta IDs.
 *
 * This function modifies the provided liquidity strategy parameters by resetting
 * the x0, y0, deltaX, and deltaY values when certain conditions regarding the
 * minDeltaId and maxDeltaId are met. If the maxDeltaId is less than or equal
 * to the end of the bid side delta ID, x0 and deltaX are set to zero. If the
 * minDeltaId is greater than or equal to the start of the ask side delta ID,
 * y0 and deltaY are set to zero.
 *
 * @param minDeltaId - The minimum delta ID.
 * @param maxDeltaId - The maximum delta ID.
 * @param favorXInActiveId - A boolean indicating if X is favored in the active bin.
 * @param params - The liquidity strategy parameters containing x0, y0, deltaX, and deltaY.
 * @returns An object containing the adjusted x0, y0, deltaX, and deltaY values.
 */

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

export async function chunkDepositWithRebalanceEndpoint(
  dlmm: DLMM,
  strategy: StrategyParameters,
  slippagePercentage: number,
  maxActiveBinSlippage: number,
  position: PublicKey,
  positionMinBinId: number,
  positionMaxBinId: number,
  liquidityStrategyParameters: LiquidityStrategyParameters,
  owner: PublicKey,
  payer: PublicKey,
  onChainCheckedBinArrays: Set<String>
) {
  const { slices, accounts: transferHookAccounts } =
    dlmm.getPotentialToken2022IxDataAndAccounts(ActionType.Liquidity);

  const userTokenX = getAssociatedTokenAddressSync(
    dlmm.lbPair.tokenXMint,
    owner,
    true,
    dlmm.tokenX.owner
  );

  const userTokenY = getAssociatedTokenAddressSync(
    dlmm.lbPair.tokenYMint,
    owner,
    true,
    dlmm.tokenY.owner
  );

  const createUserTokenXIx = createAssociatedTokenAccountIdempotentInstruction(
    payer,
    userTokenX,
    owner,
    dlmm.lbPair.tokenXMint,
    dlmm.tokenX.owner
  );

  const createUserTokenYIx = createAssociatedTokenAccountIdempotentInstruction(
    payer,
    userTokenY,
    owner,
    dlmm.lbPair.tokenYMint,
    dlmm.tokenY.owner
  );

  const bitmapPubkey = deriveBinArrayBitmapExtension(
    dlmm.pubkey,
    dlmm.program.programId
  )[0];

  let suggestedCU = 0;

  const chunkedAddLiquidityIx: TransactionInstruction[][] = [];
  const chunkedBinRange = chunkBinRange(positionMinBinId, positionMaxBinId);

  const binArrayOrBitmapInitTracking = new Set<String>();

  for (let i = 0; i < chunkedBinRange.length; i++) {
    const chunkMinBinId = chunkedBinRange[i].lowerBinId;
    const chunkMaxBinId = chunkedBinRange[i].upperBinId;

    const initBinArrayIxs: TransactionInstruction[] = [];
    const initBitmapIxs: TransactionInstruction[] = [];

    const binArrayIndexes = getBinArrayIndexesCoverage(
      new BN(chunkMinBinId),
      new BN(chunkMaxBinId)
    );

    const overflowDefaultBinArrayBitmap = binArrayIndexes.reduce(
      (acc, binArrayIndex) =>
        acc || isOverflowDefaultBinArrayBitmap(binArrayIndex),
      false
    );

    if (overflowDefaultBinArrayBitmap) {
      const initBitmapIx = await dlmm.program.methods
        .initializeBinArrayBitmapExtension()
        .accountsPartial({
          binArrayBitmapExtension: bitmapPubkey,
          lbPair: dlmm.pubkey,
          funder: payer,
        })
        .instruction();

      initBitmapIxs.push(initBitmapIx);
      binArrayOrBitmapInitTracking.add(bitmapPubkey.toBase58());

      suggestedCU += DEFAULT_INIT_BITMAP_EXTENSION_CU;
    }

    const binArrayPubkeys = binArrayIndexes.map(
      (index) => deriveBinArray(dlmm.pubkey, index, dlmm.program.programId)[0]
    );

    for (const [idx, binArrayPubkey] of binArrayPubkeys.entries()) {
      if (
        !binArrayOrBitmapInitTracking.has(binArrayPubkey.toBase58()) &&
        !onChainCheckedBinArrays.has(binArrayPubkey.toBase58())
      ) {
        const initBinArrayIx = await dlmm.program.methods
          .initializeBinArray(binArrayIndexes[idx])
          .accountsPartial({
            binArray: binArrayPubkey,
            funder: payer,
            lbPair: dlmm.pubkey,
          })
          .instruction();

        binArrayOrBitmapInitTracking.add(binArrayPubkey.toBase58());
        initBinArrayIxs.push(initBinArrayIx);

        suggestedCU += DEFAULT_INIT_BIN_ARRAY_CU;
      }
    }

    const minDeltaId = new BN(chunkMinBinId - dlmm.lbPair.activeId);
    const maxDeltaId = new BN(chunkMaxBinId - dlmm.lbPair.activeId);

    const { bitFlag, ...baseAndDelta } =
      buildBitFlagAndNegateStrategyParameters(
        liquidityStrategyParameters.x0,
        liquidityStrategyParameters.y0,
        liquidityStrategyParameters.deltaX,
        liquidityStrategyParameters.deltaY
      );

    const { deltaX, deltaY, x0, y0 } = resetUninvolvedLiquidityParams(
      minDeltaId,
      maxDeltaId,
      strategy.singleSidedX,
      {
        ...baseAndDelta,
      }
    );

    const addParam: RebalanceAddLiquidityParam = {
      minDeltaId: minDeltaId.toNumber(),
      maxDeltaId: maxDeltaId.toNumber(),
      x0,
      y0,
      deltaX,
      deltaY,
      bitFlag,
      favorXInActiveId: strategy.singleSidedX,
      padding: Array(36).fill(0),
    };

    const { totalXAmount, totalYAmount } = toAmountIntoBins(
      new BN(dlmm.lbPair.activeId),
      minDeltaId,
      maxDeltaId,
      deltaX,
      deltaY,
      x0,
      y0,
      new BN(dlmm.lbPair.binStep),
      strategy.singleSidedX
    ).reduce(
      (acc, bin) => {
        return {
          totalXAmount: acc.totalXAmount.add(bin.amountX),
          totalYAmount: acc.totalYAmount.add(bin.amountY),
        };
      },
      {
        totalXAmount: new BN(0),
        totalYAmount: new BN(0),
      }
    );

    const totalXAmountIncludeTransferFee = calculateTransferFeeIncludedAmount(
      totalXAmount,
      dlmm.tokenX.mint,
      dlmm.clock.epoch.toNumber()
    ).amount;

    const totalYAmountIncludeTransferFee = calculateTransferFeeIncludedAmount(
      totalYAmount,
      dlmm.tokenY.mint,
      dlmm.clock.epoch.toNumber()
    ).amount;

    const maxDepositXAmount = getSlippageMaxAmount(
      totalXAmountIncludeTransferFee,
      slippagePercentage
    );

    const maxDepositYAmount = getSlippageMaxAmount(
      totalYAmountIncludeTransferFee,
      slippagePercentage
    );

    const rebalanceIx = await dlmm.program.methods
      .rebalanceLiquidity(
        {
          activeId: dlmm.lbPair.activeId,
          maxActiveBinSlippage,
          shouldClaimFee: false,
          shouldClaimReward: false,
          minWithdrawXAmount: new BN(0),
          minWithdrawYAmount: new BN(0),
          maxDepositXAmount,
          maxDepositYAmount,
          removes: [],
          adds: [addParam],
          padding: Array(32).fill(0),
        },
        {
          slices,
        }
      )
      .accountsPartial({
        binArrayBitmapExtension:
          initBitmapIxs.length > 0 ? bitmapPubkey : dlmm.program.programId,
        lbPair: dlmm.pubkey,
        position,
        owner,
        tokenXMint: dlmm.lbPair.tokenXMint,
        tokenYMint: dlmm.lbPair.tokenYMint,
        userTokenX,
        userTokenY,
        tokenXProgram: dlmm.tokenX.owner,
        tokenYProgram: dlmm.tokenY.owner,
        rentPayer: payer,
      })
      .remainingAccounts([
        ...transferHookAccounts,
        ...binArrayPubkeys.map((baPubkey) => ({
          pubkey: baPubkey,
          isWritable: true,
          isSigner: false,
        })),
        derivePlaceHolderAccountMeta(dlmm.program.programId),
      ])
      .instruction();

    suggestedCU += DEFAULT_REBALANCE_ADD_LIQUIDITY_CU;

    const addLiquidityIxs: TransactionInstruction[] = [];

    addLiquidityIxs.push(...initBitmapIxs, ...initBinArrayIxs);

    if (dlmm.tokenX.publicKey.equals(NATIVE_MINT)) {
      const wrapSOLIx = wrapSOLInstruction(
        owner,
        userTokenX,
        BigInt(totalXAmount.toString())
      );

      addLiquidityIxs.push(createUserTokenXIx);
      addLiquidityIxs.push(...wrapSOLIx);

      suggestedCU += DEFAULT_INIT_ATA_CU;
    }

    if (dlmm.tokenY.publicKey.equals(NATIVE_MINT)) {
      const wrapSOLIx = wrapSOLInstruction(
        owner,
        userTokenY,
        BigInt(totalYAmount.toString())
      );

      addLiquidityIxs.push(createUserTokenYIx);
      addLiquidityIxs.push(...wrapSOLIx);

      suggestedCU += DEFAULT_INIT_ATA_CU;
    }

    addLiquidityIxs.push(rebalanceIx);

    if (dlmm.tokenX.publicKey.equals(NATIVE_MINT) && !totalXAmount.isZero()) {
      addLiquidityIxs.push(
        createCloseAccountInstruction(
          userTokenX,
          owner,
          owner,
          [],
          TOKEN_PROGRAM_ID
        )
      );

      suggestedCU += DEFAULT_CLOSE_ATA_CU;
    }

    if (dlmm.tokenY.publicKey.equals(NATIVE_MINT) && !totalYAmount.isZero()) {
      addLiquidityIxs.push(
        createCloseAccountInstruction(
          userTokenY,
          owner,
          owner,
          [],
          TOKEN_PROGRAM_ID
        )
      );

      suggestedCU += DEFAULT_CLOSE_ATA_CU;
    }

    addLiquidityIxs.unshift(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: Math.min(suggestedCU, MAX_CU),
      })
    );

    chunkedAddLiquidityIx.push(addLiquidityIxs);
  }

  return chunkedAddLiquidityIx;
}
