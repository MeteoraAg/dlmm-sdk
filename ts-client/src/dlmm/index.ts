import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import {
  AccountLayout,
  Mint,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  unpackAccount,
  unpackMint,
} from "@solana/spl-token";
import {
  AccountMeta,
  Cluster,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import Decimal from "decimal.js";
import {
  BASIS_POINT_MAX,
  BIN_ARRAY_BITMAP_FEE_BN,
  BIN_ARRAY_FEE,
  BIN_ARRAY_FEE_BN,
  LBCLMM_PROGRAM_IDS as DLMM_PROGRAM_IDS,
  FEE_PRECISION,
  MAX_ACTIVE_BIN_SLIPPAGE,
  MAX_BIN_ARRAY_SIZE,
  MAX_BIN_LENGTH_ALLOWED_IN_ONE_TX,
  MAX_BIN_PER_POSITION,
  MAX_BIN_PER_TX,
  MAX_CLAIM_ALL_ALLOWED,
  MAX_EXTRA_BIN_ARRAYS,
  MAX_FEE_RATE,
  POSITION_FEE,
  POSITION_FEE_BN,
  PRECISION,
  SCALE_OFFSET,
  TOKEN_ACCOUNT_FEE_BN,
  U64_MAX,
} from "./constants";
import { DlmmSdkError } from "./error";
import {
  binIdToBinArrayIndex,
  chunkedGetMultipleAccountInfos,
  chunks,
  computeFeeFromAmount,
  deriveBinArray,
  deriveBinArrayBitmapExtension,
  deriveCustomizablePermissionlessLbPair,
  deriveLbPair,
  deriveLbPair2,
  deriveLbPairWithPresetParamWithIndexKey,
  deriveOracle,
  derivePosition,
  deriveReserve,
  deriveTokenBadge,
  enumerateBins,
  findNextBinArrayIndexWithLiquidity,
  findNextBinArrayWithLiquidity,
  getBinArrayLowerUpperBinId,
  getBinFromBinArray,
  getEstimatedComputeUnitIxWithBuffer,
  getOrCreateATAInstruction,
  getOutAmount,
  getPriceOfBinByBinId,
  getTokenProgramId,
  getTotalFee,
  isBinIdWithinBinArray,
  isOverflowDefaultBinArrayBitmap,
  range,
  swapExactInQuoteAtBin,
  swapExactOutQuoteAtBin,
  toStrategyParameters,
  toWeightDistribution,
  unwrapSOLInstruction,
  wrapSOLInstruction,
} from "./helpers";
import {
  binArrayLbPairFilter,
  positionLbPairFilter,
  positionOwnerFilter,
  presetParameter2BaseFactorFilter,
  presetParameter2BaseFeePowerFactor,
  presetParameter2BinStepFilter,
} from "./helpers/accountFilters";
import { DEFAULT_ADD_LIQUIDITY_CU } from "./helpers/computeUnit";
import {
  Rounding,
  compressBinAmount,
  computeBaseFactorFromFeeBps,
  distributeAmountToCompressedBinsByRatio,
  findOptimumDecompressMultiplier,
  generateAmountForBinRange,
  getPositionCount,
  mulShr,
} from "./helpers/math";
import {
  IPosition,
  PositionV2Wrapper,
  getBinArrayAccountMetasCoverage,
  getBinArrayIndexesCoverage,
  isPositionNoFee,
  isPositionNoReward,
  wrapPosition,
} from "./helpers/positions";
import {
  calculateTransferFeeExcludedAmount,
  calculateTransferFeeIncludedAmount,
  getExtraAccountMetasForTransferHook,
  getMultipleMintsExtraAccountMetasForTransferHook,
} from "./helpers/token_2022";
import { IDL } from "./idl";
import {
  ActionType,
  ActivationType,
  Bin,
  BinAndAmount,
  BinArray,
  BinArrayAccount,
  BinArrayBitmapExtension,
  BinArrayBitmapExtensionAccount,
  BinLiquidity,
  ClmmProgram,
  Clock,
  ClockLayout,
  EmissionRate,
  FeeInfo,
  InitCustomizablePermissionlessPairIx,
  LbPair,
  LbPairAccount,
  LbPosition,
  LiquidityOneSideParameter,
  LiquidityParameterByStrategy,
  LiquidityParameterByWeight,
  PairLockInfo,
  MEMO_PROGRAM_ID,
  PairStatus,
  PairType,
  PositionBinData,
  PositionData,
  PositionInfo,
  PositionVersion,
  ProgramStrategyParameter,
  RemainingAccountsInfoSlice,
  SwapExactOutParams,
  SwapParams,
  SwapQuote,
  SwapQuoteExactOut,
  SwapWithPriceImpactParams,
  TInitializePositionAndAddLiquidityParams,
  TInitializePositionAndAddLiquidityParamsByStrategy,
  TQuoteCreatePositionParams,
  TokenReserve,
  sParameters,
  vParameters,
  SeedLiquidityResponse,
  PositionV2,
  CompressedBinDepositAmounts,
  BinLiquidityDistribution,
  LiquidityParameter,
  SeedLiquidityCostBreakdown,
  SeedLiquiditySingleBinResponse,
} from "./types";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { u64 } from "@coral-xyz/borsh";

type Opt = {
  cluster?: Cluster | "localhost";
  programId?: PublicKey;
};

export class DLMM {
  constructor(
    public pubkey: PublicKey,
    public program: ClmmProgram,
    public lbPair: LbPair,
    public binArrayBitmapExtension: BinArrayBitmapExtensionAccount | null,
    public tokenX: TokenReserve,
    public tokenY: TokenReserve,
    public rewards: Array<TokenReserve | null>,
    public clock: Clock,
    private opt?: Opt
  ) {}

  /** Static public method */

  /**
   * The function `getLbPairs` retrieves a list of LB pair accounts using a connection and optional
   * parameters.
   * @param {Connection} connection - The `connection` parameter is an instance of the `Connection`
   * class, which represents the connection to the Solana blockchain network.
   * @param {Opt} [opt] - The `opt` parameter is an optional object that contains additional options
   * for the function. It can have the following properties:
   * @returns The function `getLbPairs` returns a Promise that resolves to an array of
   * `LbPairAccount` objects.
   */
  public static async getLbPairs(
    connection: Connection,
    opt?: Opt
  ): Promise<LbPairAccount[]> {
    const provider = new AnchorProvider(
      connection,
      {} as any,
      AnchorProvider.defaultOptions()
    );
    const program = new Program(
      IDL,
      opt?.programId ?? DLMM_PROGRAM_IDS[opt?.cluster ?? "mainnet-beta"],
      provider
    );

    return program.account.lbPair.all();
  }

  /**
   * Retrieves the public key of a LB pair if it exists.
   * @param connection The connection to the Solana cluster.
   * @param tokenX The mint address of token X.
   * @param tokenY The mint address of token Y.
   * @param binStep The bin step of the LB pair.
   * @param baseFactor The base factor of the LB pair.
   * @param baseFeePowerFactor The base fee power factor of the LB pair. It allow small bin step to have bigger fee rate.
   * @param opt Optional parameters.
   * @returns The public key of the LB pair if it exists, or null.
   */
  public static async getPairPubkeyIfExists(
    connection: Connection,
    tokenX: PublicKey,
    tokenY: PublicKey,
    binStep: BN,
    baseFactor: BN,
    baseFeePowerFactor: BN,
    opt?: Opt
  ): Promise<PublicKey | null> {
    const cluster = opt?.cluster || "mainnet-beta";

    const provider = new AnchorProvider(
      connection,
      {} as any,
      AnchorProvider.defaultOptions()
    );
    const program = new Program(
      IDL,
      opt?.programId ?? DLMM_PROGRAM_IDS[cluster],
      provider
    );

    try {
      const [lbPair2Key] = deriveLbPair2(
        tokenX,
        tokenY,
        binStep,
        baseFactor,
        program.programId
      );
      const account2 = await program.account.lbPair.fetchNullable(lbPair2Key);
      if (account2) return lbPair2Key;

      const [lbPairKey] = deriveLbPair(
        tokenX,
        tokenY,
        binStep,
        program.programId
      );

      const account = await program.account.lbPair.fetchNullable(lbPairKey);
      if (account && account.parameters.baseFactor === baseFactor.toNumber()) {
        return lbPairKey;
      }

      const presetParametersWithIndex =
        await program.account.presetParameter2.all([
          presetParameter2BinStepFilter(binStep),
          presetParameter2BaseFactorFilter(baseFactor),
          presetParameter2BaseFeePowerFactor(baseFeePowerFactor),
        ]);

      if (presetParametersWithIndex.length > 0) {
        const possibleLbPairKeys = presetParametersWithIndex.map((account) => {
          return deriveLbPairWithPresetParamWithIndexKey(
            account.publicKey,
            tokenX,
            tokenY,
            program.programId
          )[0];
        });

        const accounts = await chunkedGetMultipleAccountInfos(
          program.provider.connection,
          possibleLbPairKeys
        );

        for (let i = 0; i < possibleLbPairKeys.length; i++) {
          const pairKey = possibleLbPairKeys[i];
          const account = accounts[i];

          if (account) {
            return pairKey;
          }
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  public static async getCustomizablePermissionlessLbPairIfExists(
    connection: Connection,
    tokenX: PublicKey,
    tokenY: PublicKey,
    opt?: Opt
  ): Promise<PublicKey | null> {
    const cluster = opt?.cluster || "mainnet-beta";

    const provider = new AnchorProvider(
      connection,
      {} as any,
      AnchorProvider.defaultOptions()
    );
    const program = new Program(
      IDL,
      opt?.programId ?? DLMM_PROGRAM_IDS[cluster],
      provider
    );

    try {
      const [lpPair] = deriveCustomizablePermissionlessLbPair(
        tokenX,
        tokenY,
        program.programId
      );
      const account = await program.account.lbPair.fetchNullable(lpPair);
      if (account) return lpPair;

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * The `create` function is a static method that creates a new instance of the `DLMM` class
   * @param {Connection} connection - The `connection` parameter is an instance of the `Connection`
   * class, which represents the connection to the Solana blockchain network.
   * @param {PublicKey} dlmm - The PublicKey of LB Pair.
   * @param {Opt} [opt] - The `opt` parameter is an optional object that can contain additional options
   * for the `create` function. It has the following properties:
   * @returns The `create` function returns a `Promise` that resolves to a `DLMM` object.
   */
  static async create(
    connection: Connection,
    dlmm: PublicKey,
    opt?: Opt
  ): Promise<DLMM> {
    const cluster = opt?.cluster || "mainnet-beta";

    const provider = new AnchorProvider(
      connection,
      {} as any,
      AnchorProvider.defaultOptions()
    );
    const program = new Program(
      IDL,
      opt?.programId ?? DLMM_PROGRAM_IDS[cluster],
      provider
    );

    const binArrayBitMapExtensionPubkey = deriveBinArrayBitmapExtension(
      dlmm,
      program.programId
    )[0];
    let accountsToFetch = [
      dlmm,
      binArrayBitMapExtensionPubkey,
      SYSVAR_CLOCK_PUBKEY,
    ];

    const accountsInfo = await chunkedGetMultipleAccountInfos(
      connection,
      accountsToFetch
    );

    const lbPairAccountInfoBuffer = accountsInfo[0]?.data;
    if (!lbPairAccountInfoBuffer)
      throw new Error(`LB Pair account ${dlmm.toBase58()} not found`);

    const lbPairAccInfo: LbPair = program.coder.accounts.decode(
      program.account.lbPair.idlAccount.name,
      lbPairAccountInfoBuffer
    );

    const binArrayBitMapAccountInfoBuffer = accountsInfo[1]?.data;

    let binArrayBitMapExtensionAccInfo: BinArrayBitmapExtension | null = null;
    if (binArrayBitMapAccountInfoBuffer) {
      binArrayBitMapExtensionAccInfo = program.coder.accounts.decode(
        program.account.binArrayBitmapExtension.idlAccount.name,
        binArrayBitMapAccountInfoBuffer
      );
    }

    const clockAccountInfoBuffer = accountsInfo[2]?.data;
    if (!clockAccountInfoBuffer) throw new Error(`Clock account not found`);
    const clock = ClockLayout.decode(clockAccountInfoBuffer) as Clock;

    accountsToFetch = [
      lbPairAccInfo.reserveX,
      lbPairAccInfo.reserveY,
      lbPairAccInfo.tokenXMint,
      lbPairAccInfo.tokenYMint,
      lbPairAccInfo.rewardInfos[0].vault,
      lbPairAccInfo.rewardInfos[1].vault,
      lbPairAccInfo.rewardInfos[0].mint,
      lbPairAccInfo.rewardInfos[1].mint,
    ];

    const [
      reserveXAccount,
      reserveYAccount,
      tokenXMintAccount,
      tokenYMintAccount,
      reward0VaultAccount,
      reward1VaultAccount,
      reward0MintAccount,
      reward1MintAccount,
    ] = await chunkedGetMultipleAccountInfos(
      program.provider.connection,
      accountsToFetch
    );

    let binArrayBitmapExtension: BinArrayBitmapExtensionAccount | null;
    if (binArrayBitMapExtensionAccInfo) {
      binArrayBitmapExtension = {
        account: binArrayBitMapExtensionAccInfo,
        publicKey: binArrayBitMapExtensionPubkey,
      };
    }

    const reserveXBalance = AccountLayout.decode(reserveXAccount.data);
    const reserveYBalance = AccountLayout.decode(reserveYAccount.data);

    const mintX = unpackMint(
      lbPairAccInfo.tokenXMint,
      tokenXMintAccount,
      tokenXMintAccount.owner
    );

    const mintY = unpackMint(
      lbPairAccInfo.tokenYMint,
      tokenYMintAccount,
      tokenYMintAccount.owner
    );

    const [
      tokenXTransferHook,
      tokenYTransferHook,
      reward0TransferHook,
      reward1TransferHook,
    ] = await Promise.all([
      getExtraAccountMetasForTransferHook(
        connection,
        lbPairAccInfo.tokenXMint,
        tokenXMintAccount
      ),
      getExtraAccountMetasForTransferHook(
        connection,
        lbPairAccInfo.tokenYMint,
        tokenYMintAccount
      ),
      reward0MintAccount
        ? getExtraAccountMetasForTransferHook(
            connection,
            lbPairAccInfo.rewardInfos[0].mint,
            reward0MintAccount
          )
        : [],
      reward1MintAccount
        ? getExtraAccountMetasForTransferHook(
            connection,
            lbPairAccInfo.rewardInfos[1].mint,
            reward1MintAccount
          )
        : [],
    ]);

    const tokenX: TokenReserve = {
      publicKey: lbPairAccInfo.tokenXMint,
      reserve: lbPairAccInfo.reserveX,
      amount: reserveXBalance.amount,
      mint: mintX,
      owner: tokenXMintAccount.owner,
      transferHookAccountMetas: tokenXTransferHook,
    };

    const tokenY: TokenReserve = {
      publicKey: lbPairAccInfo.tokenYMint,
      reserve: lbPairAccInfo.reserveY,
      amount: reserveYBalance.amount,
      mint: mintY,
      owner: tokenYMintAccount.owner,
      transferHookAccountMetas: tokenYTransferHook,
    };

    const reward0: TokenReserve = !lbPairAccInfo.rewardInfos[0].mint.equals(
      PublicKey.default
    )
      ? {
          publicKey: lbPairAccInfo.rewardInfos[0].mint,
          reserve: lbPairAccInfo.rewardInfos[0].vault,
          amount: AccountLayout.decode(reward0VaultAccount.data).amount,
          mint: unpackMint(
            lbPairAccInfo.rewardInfos[0].mint,
            reward0MintAccount,
            reward0MintAccount.owner
          ),
          owner: reward0MintAccount.owner,
          transferHookAccountMetas: reward0TransferHook,
        }
      : null;

    const reward1: TokenReserve = !lbPairAccInfo.rewardInfos[1].mint.equals(
      PublicKey.default
    )
      ? {
          publicKey: lbPairAccInfo.rewardInfos[1].mint,
          reserve: lbPairAccInfo.rewardInfos[1].vault,
          amount: AccountLayout.decode(reward1VaultAccount.data).amount,
          mint: unpackMint(
            lbPairAccInfo.rewardInfos[1].mint,
            reward1MintAccount,
            reward1MintAccount.owner
          ),
          owner: reward1MintAccount.owner,
          transferHookAccountMetas: reward1TransferHook,
        }
      : null;

    return new DLMM(
      dlmm,
      program,
      lbPairAccInfo,
      binArrayBitmapExtension,
      tokenX,
      tokenY,
      [reward0, reward1],
      clock,
      opt
    );
  }

  /**
   * Similar to `create` function, but it accept multiple lbPairs to be initialized.
   * @param {Connection} connection - The `connection` parameter is an instance of the `Connection`
   * class, which represents the connection to the Solana blockchain network.
   * @param dlmmList - An Array of PublicKey of LB Pairs.
   * @param {Opt} [opt] - An optional parameter of type `Opt`.
   * @returns The function `createMultiple` returns a Promise that resolves to an array of `DLMM`
   * objects.
   */
  static async createMultiple(
    connection: Connection,
    dlmmList: Array<PublicKey>,
    opt?: Opt
  ): Promise<DLMM[]> {
    const cluster = opt?.cluster || "mainnet-beta";

    const provider = new AnchorProvider(
      connection,
      {} as any,
      AnchorProvider.defaultOptions()
    );
    const program = new Program(
      IDL,
      opt?.programId ?? DLMM_PROGRAM_IDS[cluster],
      provider
    );

    const binArrayBitMapExtensions = dlmmList.map(
      (lbPair) => deriveBinArrayBitmapExtension(lbPair, program.programId)[0]
    );
    const accountsToFetch = [
      ...dlmmList,
      ...binArrayBitMapExtensions,
      SYSVAR_CLOCK_PUBKEY,
    ];

    let accountsInfo = await chunkedGetMultipleAccountInfos(
      connection,
      accountsToFetch
    );

    const clockAccount = accountsInfo.pop();
    const clockAccountInfoBuffer = clockAccount?.data;
    if (!clockAccountInfoBuffer) throw new Error(`Clock account not found`);
    const clock = ClockLayout.decode(clockAccountInfoBuffer) as Clock;

    const lbPairArraysMap = new Map<string, LbPair>();
    for (let i = 0; i < dlmmList.length; i++) {
      const lbPairPubKey = dlmmList[i];
      const lbPairAccountInfoBuffer = accountsInfo[i]?.data;
      if (!lbPairAccountInfoBuffer)
        throw new Error(`LB Pair account ${lbPairPubKey.toBase58()} not found`);
      const binArrayAccInfo = program.coder.accounts.decode(
        program.account.lbPair.idlAccount.name,
        lbPairAccountInfoBuffer
      );
      lbPairArraysMap.set(lbPairPubKey.toBase58(), binArrayAccInfo);
    }

    const binArrayBitMapExtensionsMap = new Map<
      string,
      BinArrayBitmapExtension
    >();
    for (let i = dlmmList.length; i < accountsInfo.length; i++) {
      const index = i - dlmmList.length;
      const lbPairPubkey = dlmmList[index];
      const binArrayBitMapAccountInfoBuffer = accountsInfo[i]?.data;
      if (binArrayBitMapAccountInfoBuffer) {
        const binArrayBitMapExtensionAccInfo = program.coder.accounts.decode(
          program.account.binArrayBitmapExtension.idlAccount.name,
          binArrayBitMapAccountInfoBuffer
        );
        binArrayBitMapExtensionsMap.set(
          lbPairPubkey.toBase58(),
          binArrayBitMapExtensionAccInfo
        );
      }
    }

    const reservePublicKeys = Array.from(lbPairArraysMap.values())
      .map(({ reserveX, reserveY }) => [reserveX, reserveY])
      .flat();

    const tokenMintPublicKeys = Array.from(lbPairArraysMap.values())
      .map(({ tokenXMint, tokenYMint }) => [tokenXMint, tokenYMint])
      .flat();

    const rewardVaultPublicKeys = Array.from(lbPairArraysMap.values())
      .map(({ rewardInfos }) => rewardInfos.map(({ vault }) => vault))
      .flat();

    const rewardMintPublicKeys = Array.from(lbPairArraysMap.values())
      .map(({ rewardInfos }) => rewardInfos.map(({ mint }) => mint))
      .flat();

    accountsInfo = await chunkedGetMultipleAccountInfos(
      program.provider.connection,
      [
        ...reservePublicKeys,
        ...tokenMintPublicKeys,
        ...rewardVaultPublicKeys,
        ...rewardMintPublicKeys,
      ]
    );

    const offsetToTokenMint = reservePublicKeys.length;
    const offsetToRewardMint =
      reservePublicKeys.length +
      tokenMintPublicKeys.length +
      rewardVaultPublicKeys.length;

    const tokenMintAccounts = accountsInfo.slice(
      offsetToTokenMint,
      offsetToTokenMint + tokenMintPublicKeys.length
    );

    const rewardMintAccounts = accountsInfo.slice(
      offsetToRewardMint,
      offsetToRewardMint + rewardMintPublicKeys.length
    );

    const tokenMintsWithAccount = tokenMintPublicKeys
      .map((key, idx) => {
        return {
          mintAddress: key,
          mintAccountInfo: tokenMintAccounts[idx],
        };
      })
      .filter(({ mintAddress }) => mintAddress !== PublicKey.default);

    const rewardMintsWithAccount = rewardMintPublicKeys
      .map((key, idx) => {
        return {
          mintAddress: key,
          mintAccountInfo: rewardMintAccounts[idx],
        };
      })
      .filter(({ mintAddress }) => mintAddress !== PublicKey.default);

    const uniqueMintWithAccounts = Array.from(
      new Set(tokenMintsWithAccount.concat(rewardMintsWithAccount))
    );

    const mintHookAccountsMap =
      await getMultipleMintsExtraAccountMetasForTransferHook(
        connection,
        uniqueMintWithAccounts
      );

    const lbClmmImpl = dlmmList.map((lbPair, index) => {
      const lbPairState = lbPairArraysMap.get(lbPair.toBase58());
      if (!lbPairState)
        throw new Error(`LB Pair ${lbPair.toBase58()} state not found`);

      const binArrayBitmapExtensionState = binArrayBitMapExtensionsMap.get(
        lbPair.toBase58()
      );
      const binArrayBitmapExtensionPubkey = binArrayBitMapExtensions[index];

      let binArrayBitmapExtension: BinArrayBitmapExtensionAccount | null = null;
      if (binArrayBitmapExtensionState) {
        binArrayBitmapExtension = {
          account: binArrayBitmapExtensionState,
          publicKey: binArrayBitmapExtensionPubkey,
        };
      }

      const reserveXAccountInfo = accountsInfo[index * 2];
      const reserveYAccountInfo = accountsInfo[index * 2 + 1];

      let offsetToTokenMint = reservePublicKeys.length;

      const tokenXMintAccountInfo = accountsInfo[offsetToTokenMint + index * 2];
      const tokenYMintAccountInfo =
        accountsInfo[offsetToTokenMint + index * 2 + 1];

      const offsetToRewardVaultAccountInfos =
        offsetToTokenMint + tokenMintPublicKeys.length;

      const reward0VaultAccountInfo =
        accountsInfo[offsetToRewardVaultAccountInfos + index * 2];
      const reward1VaultAccountInfo =
        accountsInfo[offsetToRewardVaultAccountInfos + index * 2 + 1];

      const offsetToRewardMintAccountInfos =
        offsetToRewardVaultAccountInfos + rewardVaultPublicKeys.length;

      const reward0MintAccountInfo =
        accountsInfo[offsetToRewardMintAccountInfos + index * 2];
      const reward1MintAccountInfo =
        accountsInfo[offsetToRewardMintAccountInfos + index * 2 + 1];

      if (!reserveXAccountInfo || !reserveYAccountInfo)
        throw new Error(
          `Reserve account for LB Pair ${lbPair.toBase58()} not found`
        );

      const reserveXBalance = AccountLayout.decode(reserveXAccountInfo.data);
      const reserveYBalance = AccountLayout.decode(reserveYAccountInfo.data);

      const mintX = unpackMint(
        lbPairState.tokenXMint,
        tokenXMintAccountInfo,
        tokenXMintAccountInfo.owner
      );

      const mintY = unpackMint(
        lbPairState.tokenYMint,
        tokenYMintAccountInfo,
        tokenYMintAccountInfo.owner
      );

      const tokenX: TokenReserve = {
        publicKey: lbPairState.tokenXMint,
        reserve: lbPairState.reserveX,
        mint: mintX,
        amount: reserveXBalance.amount,
        owner: tokenXMintAccountInfo.owner,
        transferHookAccountMetas:
          mintHookAccountsMap.get(lbPairState.tokenXMint.toBase58()) ?? [],
      };

      const tokenY: TokenReserve = {
        publicKey: lbPairState.tokenYMint,
        reserve: lbPairState.reserveY,
        amount: reserveYBalance.amount,
        mint: mintY,
        owner: tokenYMintAccountInfo.owner,
        transferHookAccountMetas:
          mintHookAccountsMap.get(lbPairState.tokenYMint.toBase58()) ?? [],
      };

      const reward0: TokenReserve = !lbPairState.rewardInfos[0].mint.equals(
        PublicKey.default
      )
        ? {
            publicKey: lbPairState.rewardInfos[0].mint,
            reserve: lbPairState.rewardInfos[0].vault,
            amount: AccountLayout.decode(reward0VaultAccountInfo.data).amount,
            mint: unpackMint(
              lbPairState.rewardInfos[0].mint,
              reward0MintAccountInfo,
              reward0MintAccountInfo.owner
            ),
            owner: reward0MintAccountInfo.owner,
            transferHookAccountMetas:
              mintHookAccountsMap.get(
                lbPairState.rewardInfos[0].mint.toBase58()
              ) ?? [],
          }
        : null;

      const reward1: TokenReserve = !lbPairState.rewardInfos[1].mint.equals(
        PublicKey.default
      )
        ? {
            publicKey: lbPairState.rewardInfos[1].mint,
            reserve: lbPairState.rewardInfos[1].vault,
            amount: AccountLayout.decode(reward1VaultAccountInfo.data).amount,
            mint: unpackMint(
              lbPairState.rewardInfos[1].mint,
              reward1MintAccountInfo,
              reward1MintAccountInfo.owner
            ),
            owner: reward1MintAccountInfo.owner,
            transferHookAccountMetas:
              mintHookAccountsMap.get(
                lbPairState.rewardInfos[1].mint.toBase58()
              ) ?? [],
          }
        : null;

      return new DLMM(
        lbPair,
        program,
        lbPairState,
        binArrayBitmapExtension,
        tokenX,
        tokenY,
        [reward0, reward1],
        clock,
        opt
      );
    });

    return lbClmmImpl;
  }

  /**
   * The `getAllPresetParameters` function retrieves all preset parameter accounts
   * for the given DLMM program.
   *
   * @param {Connection} connection - The connection to the Solana cluster.
   * @param {Opt} [opt] - The optional parameters for the function.
   *
   * @returns A promise that resolves to an object containing the preset parameter
   * accounts, with the following properties:
   * - `presetParameter`: The preset parameter accounts for the original `PresetParameter` struct.
   * - `presetParameter2`: The preset parameter accounts for the `PresetParameter2` struct.
   */
  static async getAllPresetParameters(connection: Connection, opt?: Opt) {
    const provider = new AnchorProvider(
      connection,
      {} as any,
      AnchorProvider.defaultOptions()
    );

    const program = new Program(
      IDL,
      opt?.programId ?? DLMM_PROGRAM_IDS[opt?.cluster ?? "mainnet-beta"],
      provider
    );

    const [presetParameter, presetParameter2] = await Promise.all([
      program.account.presetParameter.all(),
      program.account.presetParameter2.all(),
    ]);

    return {
      presetParameter,
      presetParameter2,
    };
  }

  /**
   * The function `getAllLbPairPositionsByUser` retrieves all liquidity pool pair positions for a given
   * user.
   * @param {Connection} connection - The `connection` parameter is an instance of the `Connection`
   * class, which represents the connection to the Solana blockchain.
   * @param {PublicKey} userPubKey - The user's wallet public key.
   * @param {Opt} [opt] - An optional object that contains additional options for the function.
   * @returns The function `getAllLbPairPositionsByUser` returns a `Promise` that resolves to a `Map`
   * object. The `Map` object contains key-value pairs, where the key is a string representing the LB
   * Pair account, and the value is an object of PositionInfo
   */
  static async getAllLbPairPositionsByUser(
    connection: Connection,
    userPubKey: PublicKey,
    opt?: Opt
  ): Promise<Map<string, PositionInfo>> {
    const cluster = opt?.cluster || "mainnet-beta";

    const provider = new AnchorProvider(
      connection,
      {} as any,
      AnchorProvider.defaultOptions()
    );
    const program = new Program(
      IDL,
      opt?.programId ?? DLMM_PROGRAM_IDS[cluster],
      provider
    );

    const positionsV2 = await program.account.positionV2.all([
      positionOwnerFilter(userPubKey),
    ]);

    const positionWrappers: IPosition[] = [
      ...positionsV2.map((p) => new PositionV2Wrapper(p.publicKey, p.account)),
    ];

    const binArrayPubkeySetV2 = new Set<string>();
    const lbPairSetV2 = new Set<string>();

    positionWrappers.forEach((p) => {
      const binArrayKeys = p.getBinArrayKeysCoverage(program.programId);
      binArrayKeys.forEach((binArrayKey) => {
        binArrayPubkeySetV2.add(binArrayKey.toBase58());
      });
      lbPairSetV2.add(p.lbPair().toBase58());
    });

    const binArrayPubkeyArrayV2 = Array.from(binArrayPubkeySetV2).map(
      (pubkey) => new PublicKey(pubkey)
    );
    const lbPairKeys = Array.from(lbPairSetV2).map(
      (pubkey) => new PublicKey(pubkey)
    );

    const [clockAccInfo, ...binArraysAccInfo] =
      await chunkedGetMultipleAccountInfos(connection, [
        SYSVAR_CLOCK_PUBKEY,
        ...binArrayPubkeyArrayV2,
        ...lbPairKeys,
      ]);

    const positionBinArraysMapV2 = new Map();

    for (let i = 0; i < binArrayPubkeyArrayV2.length; i++) {
      const binArrayPubkey = binArrayPubkeyArrayV2[i];
      const binArrayAccInfoBufferV2 = binArraysAccInfo[i];
      if (binArrayAccInfoBufferV2) {
        const binArrayAccInfo: BinArray = program.coder.accounts.decode(
          program.account.binArray.idlAccount.name,
          binArrayAccInfoBufferV2.data
        );
        positionBinArraysMapV2.set(binArrayPubkey.toBase58(), binArrayAccInfo);
      }
    }

    const lbPairMap = new Map<string, LbPair>();
    for (
      let i = binArrayPubkeyArrayV2.length;
      i < binArraysAccInfo.length;
      i++
    ) {
      const lbPairPubkey = lbPairKeys[i - binArrayPubkeyArrayV2.length];
      const lbPairAccInfoBufferV2 = binArraysAccInfo[i];
      if (!lbPairAccInfoBufferV2)
        throw new Error(`LB Pair account ${lbPairPubkey.toBase58()} not found`);
      const lbPairAccInfo = program.coder.accounts.decode(
        program.account.lbPair.idlAccount.name,
        lbPairAccInfoBufferV2.data
      );
      lbPairMap.set(lbPairPubkey.toBase58(), lbPairAccInfo);
    }

    const accountKeys = Array.from(lbPairMap.values())
      .map(({ reserveX, reserveY, tokenXMint, tokenYMint, rewardInfos }) => [
        reserveX,
        reserveY,
        tokenXMint,
        tokenYMint,
        rewardInfos[0].mint,
        rewardInfos[1].mint,
      ])
      .flat();

    const accountInfos = await chunkedGetMultipleAccountInfos(
      program.provider.connection,
      accountKeys
    );

    const lbPairReserveMap = new Map<
      string,
      { reserveX: bigint; reserveY: bigint }
    >();

    const lbPairMintMap = new Map<
      string,
      {
        mintX: Mint;
        mintY: Mint;
        rewardMint0: Mint | null;
        rewardMint1: Mint | null;
      }
    >();

    lbPairKeys.forEach((lbPair, idx) => {
      const index = idx * 6;
      const reserveXAccount = accountInfos[index];
      const reserveYAccount = accountInfos[index + 1];

      if (!reserveXAccount || !reserveYAccount)
        throw new Error(
          `Reserve account for LB Pair ${lbPair.toBase58()} not found`
        );

      const reserveAccX = AccountLayout.decode(reserveXAccount.data);
      const reserveAccY = AccountLayout.decode(reserveYAccount.data);

      lbPairReserveMap.set(lbPair.toBase58(), {
        reserveX: reserveAccX.amount,
        reserveY: reserveAccY.amount,
      });

      const mintXAccount = accountInfos[index + 2];
      const mintYAccount = accountInfos[index + 3];
      if (!mintXAccount || !mintYAccount)
        throw new Error(
          `Mint account for LB Pair ${lbPair.toBase58()} not found`
        );

      const mintX = unpackMint(
        reserveAccX.mint,
        mintXAccount,
        mintXAccount.owner
      );

      const mintY = unpackMint(
        reserveAccY.mint,
        mintYAccount,
        mintYAccount.owner
      );

      const rewardMint0Account = accountInfos[index + 4];
      const rewardMint1Account = accountInfos[index + 5];

      const lbPairState = lbPairMap.get(lbPair.toBase58());

      let rewardMint0: Mint | null = null;
      let rewardMint1: Mint | null = null;

      if (!lbPairState.rewardInfos[0].mint.equals(PublicKey.default)) {
        rewardMint0 = unpackMint(
          lbPairState.rewardInfos[0].mint,
          rewardMint0Account,
          rewardMint0Account.owner
        );
      }

      if (!lbPairState.rewardInfos[1].mint.equals(PublicKey.default)) {
        rewardMint1 = unpackMint(
          lbPairState.rewardInfos[1].mint,
          rewardMint1Account,
          rewardMint1Account.owner
        );
      }

      lbPairMintMap.set(lbPair.toBase58(), {
        mintX,
        mintY,
        rewardMint0,
        rewardMint1,
      });
    });

    const clock: Clock = ClockLayout.decode(clockAccInfo.data);

    const positionsMap: Map<
      string,
      {
        publicKey: PublicKey;
        lbPair: LbPair;
        tokenX: TokenReserve;
        tokenY: TokenReserve;
        lbPairPositionsData: Array<{
          publicKey: PublicKey;
          positionData: PositionData;
          version: PositionVersion;
        }>;
      }
    > = new Map();

    for (const position of positionWrappers) {
      const lbPair = position.lbPair();
      const positionPubkey = position.address();
      const version = position.version();

      const lbPairAcc = lbPairMap.get(lbPair.toBase58());
      const { mintX, mintY, rewardMint0, rewardMint1 } = lbPairMintMap.get(
        lbPair.toBase58()
      );

      const reserveXBalance =
        lbPairReserveMap.get(lbPair.toBase58())?.reserveX ?? BigInt(0);
      const reserveYBalance =
        lbPairReserveMap.get(lbPair.toBase58())?.reserveY ?? BigInt(0);

      const { tokenXProgram, tokenYProgram } = getTokenProgramId(lbPairAcc);

      const tokenX: TokenReserve = {
        publicKey: lbPairAcc.tokenXMint,
        reserve: lbPairAcc.reserveX,
        amount: reserveXBalance,
        mint: mintX,
        owner: tokenXProgram,
        transferHookAccountMetas: [], // No need, the TokenReserve created just for processing position info, doesn't require any transaction
      };

      const tokenY: TokenReserve = {
        publicKey: lbPairAcc.tokenYMint,
        reserve: lbPairAcc.reserveY,
        amount: reserveYBalance,
        mint: mintY,
        owner: tokenYProgram,
        transferHookAccountMetas: [], // No need, the TokenReserve created just for processing position info, doesn't require any transaction
      };

      const positionData = await DLMM.processPosition(
        program,
        lbPairAcc,
        clock,
        position,
        mintX,
        mintY,
        rewardMint0,
        rewardMint1,
        positionBinArraysMapV2
      );

      if (positionData) {
        positionsMap.set(lbPair.toBase58(), {
          publicKey: lbPair,
          lbPair: lbPairAcc,
          tokenX,
          tokenY,
          lbPairPositionsData: [
            ...(positionsMap.get(lbPair.toBase58())?.lbPairPositionsData ?? []),
            {
              publicKey: positionPubkey,
              positionData,
              version,
            },
          ],
        });
      }
    }

    return positionsMap;
  }

  public static getPricePerLamport(
    tokenXDecimal: number,
    tokenYDecimal: number,
    price: number
  ): string {
    return new Decimal(price)
      .mul(new Decimal(10 ** (tokenYDecimal - tokenXDecimal)))
      .toString();
  }

  public static getBinIdFromPrice(
    price: string | number | Decimal,
    binStep: number,
    min: boolean
  ): number {
    const binStepNum = new Decimal(binStep).div(new Decimal(BASIS_POINT_MAX));
    const binId = new Decimal(price)
      .log()
      .dividedBy(new Decimal(1).add(binStepNum).log());
    return (min ? binId.floor() : binId.ceil()).toNumber();
  }

  /**
   * The function `getLbPairLockInfo` retrieves all pair positions that has locked liquidity.
   * @param {number} [lockDurationOpt] - An optional value indicating the minimum position lock duration that the function should return.
   * Depending on the lbPair activationType, the param should be a number of seconds or a number of slots.
   * @returns The function `getLbPairLockInfo` returns a `Promise` that resolves to a `PairLockInfo`
   * object. The `PairLockInfo` object contains an array of `PositionLockInfo` objects.
   */
  public async getLbPairLockInfo(
    lockDurationOpt?: number
  ): Promise<PairLockInfo> {
    const lockDuration = lockDurationOpt | 0;

    const lbPairPositions = await this.program.account.positionV2.all([
      {
        memcmp: {
          bytes: bs58.encode(this.pubkey.toBuffer()),
          offset: 8,
        },
      },
    ]);

    // filter positions has lock_release_point > currentTimestamp + lockDurationSecs
    const clockAccInfo = await this.program.provider.connection.getAccountInfo(
      SYSVAR_CLOCK_PUBKEY
    );
    const clock = ClockLayout.decode(clockAccInfo.data) as Clock;

    const currentPoint =
      this.lbPair.activationType == ActivationType.Slot
        ? clock.slot
        : clock.unixTimestamp;

    const minLockReleasePoint = currentPoint.add(new BN(lockDuration));

    const positionsWithLock = lbPairPositions.filter((p) =>
      p.account.lockReleasePoint.gt(minLockReleasePoint)
    );

    if (positionsWithLock.length == 0) {
      return {
        positions: [],
      };
    }

    const positions = [
      ...positionsWithLock.map(
        (p) => new PositionV2Wrapper(p.publicKey, p.account)
      ),
    ];

    const binArrayPubkeySetV2 = new Set<string>();
    positions.forEach((position) => {
      const binArrayKeys = position.getBinArrayKeysCoverage(
        this.program.programId
      );

      binArrayKeys.forEach((key) => {
        binArrayPubkeySetV2.add(key.toBase58());
      });
    });

    const binArrayPubkeyArrayV2 = Array.from(binArrayPubkeySetV2).map(
      (pubkey) => new PublicKey(pubkey)
    );

    const binArraysAccInfo = await chunkedGetMultipleAccountInfos(
      this.program.provider.connection,
      binArrayPubkeyArrayV2
    );

    const positionBinArraysMapV2 = new Map();

    for (let i = 0; i < binArraysAccInfo.length; i++) {
      const binArrayPubkey = binArrayPubkeyArrayV2[i];
      const binArrayAccBufferV2 = binArraysAccInfo[i];
      if (!binArrayAccBufferV2)
        throw new Error(
          `Bin Array account ${binArrayPubkey.toBase58()} not found`
        );
      const binArrayAccInfo = this.program.coder.accounts.decode(
        this.program.account.binArray.idlAccount.name,
        binArrayAccBufferV2.data
      );
      positionBinArraysMapV2.set(binArrayPubkey.toBase58(), binArrayAccInfo);
    }

    const positionsLockInfo = await Promise.all(
      positions.map(async (position) => {
        const positionData = await DLMM.processPosition(
          this.program,
          this.lbPair,
          clock,
          position,
          this.tokenX.mint,
          this.tokenY.mint,
          this.rewards[0].mint,
          this.rewards[1].mint,
          positionBinArraysMapV2
        );

        return {
          positionAddress: position.address(),
          owner: position.owner(),
          lockReleasePoint: position.lockReleasePoint().toNumber(),
          tokenXAmount: positionData.totalXAmount,
          tokenYAmount: positionData.totalYAmount,
        };
      })
    );

    return {
      positions: positionsLockInfo,
    };
  }

  /** Public methods */

  /**
   * Create a new customizable permissionless pair. Support both token and token 2022.
   * @param connection A connection to the Solana cluster.
   * @param binStep The bin step for the pair.
   * @param tokenX The mint of the first token.
   * @param tokenY The mint of the second token.
   * @param activeId The ID of the initial active bin. Represent the starting price.
   * @param feeBps The fee rate for swaps in the pair, in basis points.
   * @param activationType The type of activation for the pair.
   * @param hasAlphaVault Whether the pair has an alpha vault.
   * @param creatorKey The public key of the creator of the pair.
   * @param activationPoint The timestamp at which the pair will be activated.
   * @param opt An options object.
   * @returns A transaction that creates the pair.
   */
  public static async createCustomizablePermissionlessLbPair2(
    connection: Connection,
    binStep: BN,
    tokenX: PublicKey,
    tokenY: PublicKey,
    activeId: BN,
    feeBps: BN,
    activationType: ActivationType,
    hasAlphaVault: boolean,
    creatorKey: PublicKey,
    activationPoint?: BN,
    creatorPoolOnOffControl?: boolean,
    opt?: Opt
  ): Promise<Transaction> {
    const provider = new AnchorProvider(
      connection,
      {} as any,
      AnchorProvider.defaultOptions()
    );
    const program = new Program(
      IDL,
      opt?.programId ?? DLMM_PROGRAM_IDS[opt.cluster],
      provider
    );

    const [tokenBadgeX] = deriveTokenBadge(tokenX, program.programId);
    const [tokenBadgeY] = deriveTokenBadge(tokenY, program.programId);

    const [
      tokenXAccount,
      tokenYAccount,
      tokenBadgeXAccount,
      tokenBadgeYAccount,
    ] = await provider.connection.getMultipleAccountsInfo([
      tokenX,
      tokenY,
      tokenBadgeX,
      tokenBadgeY,
    ]);

    const [lbPair] = deriveCustomizablePermissionlessLbPair(
      tokenX,
      tokenY,
      program.programId
    );

    const [reserveX] = deriveReserve(tokenX, lbPair, program.programId);
    const [reserveY] = deriveReserve(tokenY, lbPair, program.programId);
    const [oracle] = deriveOracle(lbPair, program.programId);

    const activeBinArrayIndex = binIdToBinArrayIndex(activeId);
    const binArrayBitmapExtension = isOverflowDefaultBinArrayBitmap(
      activeBinArrayIndex
    )
      ? deriveBinArrayBitmapExtension(lbPair, program.programId)[0]
      : null;

    const [baseFactor, baseFeePowerFactor] = computeBaseFactorFromFeeBps(
      binStep,
      feeBps
    );

    const ixData: InitCustomizablePermissionlessPairIx = {
      activeId: activeId.toNumber(),
      binStep: binStep.toNumber(),
      baseFactor: baseFactor.toNumber(),
      activationType,
      activationPoint: activationPoint ? activationPoint : null,
      hasAlphaVault,
      creatorPoolOnOffControl: creatorPoolOnOffControl
        ? creatorPoolOnOffControl
        : false,
      baseFeePowerFactor: baseFeePowerFactor.toNumber(),
      padding: Array(63).fill(0),
    };

    const userTokenX = getAssociatedTokenAddressSync(
      tokenX,
      creatorKey,
      true,
      tokenXAccount.owner
    );

    const userTokenY = getAssociatedTokenAddressSync(
      tokenY,
      creatorKey,
      true,
      tokenYAccount.owner
    );

    return program.methods
      .initializeCustomizablePermissionlessLbPair2(ixData)
      .accounts({
        tokenBadgeX: tokenBadgeXAccount ? tokenBadgeX : program.programId,
        tokenBadgeY: tokenBadgeYAccount ? tokenBadgeY : program.programId,
        lbPair,
        reserveX,
        reserveY,
        binArrayBitmapExtension,
        tokenMintX: tokenX,
        tokenMintY: tokenY,
        oracle,
        systemProgram: SystemProgram.programId,
        userTokenX,
        userTokenY,
        funder: creatorKey,
        tokenProgramX: tokenXAccount.owner,
        tokenProgramY: tokenYAccount.owner,
      })
      .transaction();
  }

  /**
   * Create a new customizable permissionless pair. Support only token program.
   * @param connection A connection to the Solana cluster.
   * @param binStep The bin step for the pair.
   * @param tokenX The mint of the first token.
   * @param tokenY The mint of the second token.
   * @param activeId The ID of the initial active bin. Represent the starting price.
   * @param feeBps The fee rate for swaps in the pair, in basis points.
   * @param activationType The type of activation for the pair.
   * @param hasAlphaVault Whether the pair has an alpha vault.
   * @param creatorKey The public key of the creator of the pair.
   * @param activationPoint The timestamp at which the pair will be activated.
   * @param opt An options object.
   * @returns A transaction that creates the pair.
   */
  public static async createCustomizablePermissionlessLbPair(
    connection: Connection,
    binStep: BN,
    tokenX: PublicKey,
    tokenY: PublicKey,
    activeId: BN,
    feeBps: BN,
    activationType: ActivationType,
    hasAlphaVault: boolean,
    creatorKey: PublicKey,
    activationPoint?: BN,
    creatorPoolOnOffControl?: boolean,
    opt?: Opt
  ): Promise<Transaction> {
    const provider = new AnchorProvider(
      connection,
      {} as any,
      AnchorProvider.defaultOptions()
    );

    const program = new Program(
      IDL,
      opt?.programId ?? DLMM_PROGRAM_IDS[opt.cluster],
      provider
    );

    const [mintXAccount, mintYAccount] =
      await connection.getMultipleAccountsInfo([tokenX, tokenY]);

    const [lbPair] = deriveCustomizablePermissionlessLbPair(
      tokenX,
      tokenY,
      program.programId
    );

    const [reserveX] = deriveReserve(tokenX, lbPair, program.programId);
    const [reserveY] = deriveReserve(tokenY, lbPair, program.programId);
    const [oracle] = deriveOracle(lbPair, program.programId);

    const activeBinArrayIndex = binIdToBinArrayIndex(activeId);
    const binArrayBitmapExtension = isOverflowDefaultBinArrayBitmap(
      activeBinArrayIndex
    )
      ? deriveBinArrayBitmapExtension(lbPair, program.programId)[0]
      : null;

    const [baseFactor, baseFeePowerFactor] = computeBaseFactorFromFeeBps(
      binStep,
      feeBps
    );

    if (!baseFeePowerFactor.isZero()) {
      throw "base factor for the give fee bps overflow u16";
    }

    const ixData: InitCustomizablePermissionlessPairIx = {
      activeId: activeId.toNumber(),
      binStep: binStep.toNumber(),
      baseFactor: baseFactor.toNumber(),
      activationType,
      activationPoint: activationPoint ? activationPoint : null,
      hasAlphaVault,
      baseFeePowerFactor: 0,
      creatorPoolOnOffControl: creatorPoolOnOffControl
        ? creatorPoolOnOffControl
        : false,
      padding: Array(63).fill(0),
    };

    const userTokenX = getAssociatedTokenAddressSync(tokenX, creatorKey);
    const userTokenY = getAssociatedTokenAddressSync(tokenY, creatorKey);

    return program.methods
      .initializeCustomizablePermissionlessLbPair(ixData)
      .accounts({
        lbPair,
        reserveX,
        reserveY,
        binArrayBitmapExtension,
        tokenMintX: tokenX,
        tokenMintY: tokenY,

        oracle,
        systemProgram: SystemProgram.programId,
        userTokenX,
        userTokenY,
        funder: creatorKey,
      })
      .transaction();
  }

  /**
   * Create a new liquidity pair. Support only token program.
   * @param connection A connection to the Solana cluster.
   * @param funder The public key of the funder of the pair.
   * @param tokenX The mint of the first token.
   * @param tokenY The mint of the second token.
   * @param binStep The bin step for the pair.
   * @param baseFactor The base factor for the pair.
   * @param presetParameter The public key of the preset parameter account.
   * @param activeId The ID of the initial active bin. Represent the starting price.
   * @param opt An options object.
   * @returns A transaction that creates the pair.
   * @throws If the pair already exists.
   */
  public static async createLbPair(
    connection: Connection,
    funder: PublicKey,
    tokenX: PublicKey,
    tokenY: PublicKey,
    binStep: BN,
    baseFactor: BN,
    presetParameter: PublicKey,
    activeId: BN,
    opt?: Opt
  ): Promise<Transaction> {
    const provider = new AnchorProvider(
      connection,
      {} as any,
      AnchorProvider.defaultOptions()
    );
    const program = new Program(
      IDL,
      opt?.programId ?? DLMM_PROGRAM_IDS[opt.cluster],
      provider
    );

    const existsPool = await this.getPairPubkeyIfExists(
      connection,
      tokenX,
      tokenY,
      binStep,
      baseFactor,
      new BN(0)
    );

    if (existsPool) {
      throw new Error("Pool already exists");
    }

    const [lbPair] = deriveLbPair2(
      tokenX,
      tokenY,
      binStep,
      baseFactor,
      program.programId
    );

    const [reserveX] = deriveReserve(tokenX, lbPair, program.programId);
    const [reserveY] = deriveReserve(tokenY, lbPair, program.programId);
    const [oracle] = deriveOracle(lbPair, program.programId);

    const activeBinArrayIndex = binIdToBinArrayIndex(activeId);
    const binArrayBitmapExtension = isOverflowDefaultBinArrayBitmap(
      activeBinArrayIndex
    )
      ? deriveBinArrayBitmapExtension(lbPair, program.programId)[0]
      : null;

    return program.methods
      .initializeLbPair(activeId.toNumber(), binStep.toNumber())
      .accounts({
        funder,
        lbPair,
        rent: SYSVAR_RENT_PUBKEY,
        reserveX,
        reserveY,
        binArrayBitmapExtension,
        tokenMintX: tokenX,
        tokenMintY: tokenY,
        tokenProgram: TOKEN_PROGRAM_ID,
        oracle,
        presetParameter,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
  }

  /**
   * Create a new liquidity pair. Support both token and token2022 program.
   * @param connection A connection to the Solana cluster.
   * @param funder The public key of the funder of the pair.
   * @param tokenX The mint of the first token.
   * @param tokenY The mint of the second token.
   * @param presetParameter The public key of the preset parameter account.
   * @param activeId The ID of the initial active bin. Represent the starting price.
   * @param opt An options object.
   * @returns A transaction that creates the pair.
   * @throws If the pair already exists.
   */
  public static async createLbPair2(
    connection: Connection,
    funder: PublicKey,
    tokenX: PublicKey,
    tokenY: PublicKey,
    presetParameter: PublicKey,
    activeId: BN,
    opt?: Opt
  ): Promise<Transaction> {
    const provider = new AnchorProvider(
      connection,
      {} as any,
      AnchorProvider.defaultOptions()
    );
    const program = new Program(
      IDL,
      opt?.programId ?? DLMM_PROGRAM_IDS[opt.cluster],
      provider
    );

    const [tokenBadgeX] = deriveTokenBadge(tokenX, program.programId);
    const [tokenBadgeY] = deriveTokenBadge(tokenY, program.programId);

    const [
      tokenXAccount,
      tokenYAccount,
      tokenBadgeXAccount,
      tokenBadgeYAccount,
    ] = await provider.connection.getMultipleAccountsInfo([
      tokenX,
      tokenY,
      tokenBadgeX,
      tokenBadgeY,
    ]);

    const presetParameterState = await program.account.presetParameter2.fetch(
      presetParameter
    );

    const existsPool = await this.getPairPubkeyIfExists(
      connection,
      tokenX,
      tokenY,
      new BN(presetParameterState.binStep),
      new BN(presetParameterState.baseFactor),
      new BN(presetParameterState.baseFactor)
    );

    if (existsPool) {
      throw new Error("Pool already exists");
    }

    const [lbPair] = deriveLbPairWithPresetParamWithIndexKey(
      presetParameter,
      tokenX,
      tokenY,
      program.programId
    );

    const [reserveX] = deriveReserve(tokenX, lbPair, program.programId);
    const [reserveY] = deriveReserve(tokenY, lbPair, program.programId);
    const [oracle] = deriveOracle(lbPair, program.programId);

    const activeBinArrayIndex = binIdToBinArrayIndex(activeId);
    const binArrayBitmapExtension = isOverflowDefaultBinArrayBitmap(
      activeBinArrayIndex
    )
      ? deriveBinArrayBitmapExtension(lbPair, program.programId)[0]
      : null;

    return program.methods
      .initializeLbPair2({
        activeId: activeId.toNumber(),
        padding: Array(96).fill(0),
      })
      .accounts({
        funder,
        lbPair,
        reserveX,
        reserveY,
        binArrayBitmapExtension,
        tokenMintX: tokenX,
        tokenMintY: tokenY,
        tokenBadgeX: tokenBadgeXAccount ? tokenBadgeX : program.programId,
        tokenBadgeY: tokenBadgeYAccount ? tokenBadgeY : program.programId,
        tokenProgramX: tokenXAccount.owner,
        tokenProgramY: tokenYAccount.owner,
        oracle,
        presetParameter,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
  }

  /**
   * The function `refetchStates` retrieves and updates various states and data related to bin arrays
   * and lb pairs.
   */
  public async refetchStates(): Promise<void> {
    const binArrayBitmapExtensionPubkey = deriveBinArrayBitmapExtension(
      this.pubkey,
      this.program.programId
    )[0];

    const [
      lbPairAccountInfo,
      binArrayBitmapExtensionAccountInfo,
      reserveXAccountInfo,
      reserveYAccountInfo,
      mintXAccountInfo,
      mintYAccountInfo,
      reward0VaultAccountInfo,
      reward1VaultAccountInfo,
      rewardMint0AccountInfo,
      rewardMint1AccountInfo,
      clockAccountInfo,
    ] = await chunkedGetMultipleAccountInfos(this.program.provider.connection, [
      this.pubkey,
      binArrayBitmapExtensionPubkey,
      this.lbPair.reserveX,
      this.lbPair.reserveY,
      this.lbPair.tokenXMint,
      this.lbPair.tokenYMint,
      this.lbPair.rewardInfos[0].vault,
      this.lbPair.rewardInfos[1].vault,
      this.lbPair.rewardInfos[0].mint,
      this.lbPair.rewardInfos[1].mint,
      SYSVAR_CLOCK_PUBKEY,
    ]);

    const lbPairState: LbPair = this.program.coder.accounts.decode(
      this.program.account.lbPair.idlAccount.name,
      lbPairAccountInfo.data
    );
    if (binArrayBitmapExtensionAccountInfo) {
      const binArrayBitmapExtensionState = this.program.coder.accounts.decode(
        this.program.account.binArrayBitmapExtension.idlAccount.name,
        binArrayBitmapExtensionAccountInfo.data
      );

      if (binArrayBitmapExtensionState) {
        this.binArrayBitmapExtension = {
          account: binArrayBitmapExtensionState,
          publicKey: binArrayBitmapExtensionPubkey,
        };
      }
    }

    const reserveXBalance = AccountLayout.decode(reserveXAccountInfo.data);
    const reserveYBalance = AccountLayout.decode(reserveYAccountInfo.data);

    const [
      tokenXTransferHook,
      tokenYTransferHook,
      reward0TransferHook,
      reward1TransferHook,
    ] = await Promise.all([
      getExtraAccountMetasForTransferHook(
        this.program.provider.connection,
        lbPairState.tokenXMint,
        mintXAccountInfo
      ),
      getExtraAccountMetasForTransferHook(
        this.program.provider.connection,
        lbPairState.tokenYMint,
        mintYAccountInfo
      ),
      rewardMint0AccountInfo
        ? getExtraAccountMetasForTransferHook(
            this.program.provider.connection,
            lbPairState.rewardInfos[0].mint,
            rewardMint0AccountInfo
          )
        : [],
      rewardMint1AccountInfo
        ? getExtraAccountMetasForTransferHook(
            this.program.provider.connection,
            lbPairState.rewardInfos[1].mint,
            rewardMint1AccountInfo
          )
        : [],
    ]);

    const mintX = unpackMint(
      this.tokenX.publicKey,
      mintXAccountInfo,
      mintXAccountInfo.owner
    );

    const mintY = unpackMint(
      this.tokenY.publicKey,
      mintYAccountInfo,
      mintYAccountInfo.owner
    );

    this.tokenX = {
      amount: reserveXBalance.amount,
      mint: mintX,
      publicKey: lbPairState.tokenXMint,
      reserve: lbPairState.reserveX,
      owner: mintXAccountInfo.owner,
      transferHookAccountMetas: tokenXTransferHook,
    };

    this.tokenY = {
      amount: reserveYBalance.amount,
      mint: mintY,
      publicKey: lbPairState.tokenYMint,
      reserve: lbPairState.reserveY,
      owner: mintYAccountInfo.owner,
      transferHookAccountMetas: tokenYTransferHook,
    };

    this.rewards[0] = null;
    this.rewards[1] = null;

    if (!lbPairState.rewardInfos[0].mint.equals(PublicKey.default)) {
      this.rewards[0] = {
        publicKey: lbPairState.rewardInfos[0].mint,
        reserve: lbPairState.rewardInfos[0].vault,
        mint: unpackMint(
          lbPairState.rewardInfos[0].mint,
          rewardMint0AccountInfo,
          rewardMint0AccountInfo.owner
        ),
        amount: AccountLayout.decode(reward0VaultAccountInfo.data).amount,
        owner: rewardMint0AccountInfo.owner,
        transferHookAccountMetas: reward0TransferHook,
      };
    }

    if (!lbPairState.rewardInfos[1].mint.equals(PublicKey.default)) {
      this.rewards[1] = {
        publicKey: lbPairState.rewardInfos[1].mint,
        reserve: lbPairState.rewardInfos[1].vault,
        mint: unpackMint(
          lbPairState.rewardInfos[1].mint,
          rewardMint1AccountInfo,
          rewardMint1AccountInfo.owner
        ),
        amount: AccountLayout.decode(reward1VaultAccountInfo.data).amount,
        owner: rewardMint1AccountInfo.owner,
        transferHookAccountMetas: reward1TransferHook,
      };
    }

    const clock = ClockLayout.decode(clockAccountInfo.data) as Clock;
    this.clock = clock;

    this.lbPair = lbPairState;
  }

  /**
   * Set the status of a permissionless LB pair to either enabled or disabled. This require pool field `creator_pool_on_off_control` to be true and type `CustomizablePermissionless`.
   * Pool creator can enable/disable the pair anytime before the pool is opened / activated. Once the pool activation time is passed, the pool creator can only enable the pair.
   * Useful for token launches which do not have fixed activation time.
   * @param enable If true, the pair will be enabled. If false, the pair will be disabled.
   * @param creator The public key of the pool creator.
   * @returns a Promise that resolves to the transaction.
   */
  public async setPairStatusPermissionless(
    enable: boolean,
    creator: PublicKey
  ) {
    const status: PairStatus = enable ? 0 : 1; // 0 = enable, 1 = disable

    const tx = await this.program.methods
      .setPairStatusPermissionless(status)
      .accounts({
        lbPair: this.pubkey,
        creator,
      })
      .transaction();

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");

    return new Transaction({
      feePayer: this.lbPair.creator,
      blockhash,
      lastValidBlockHeight,
    }).add(tx);
  }

  /**
   * The function `getBinArrays` returns an array of `BinArrayAccount` objects
   * @returns a Promise that resolves to an array of BinArrayAccount objects.
   */
  public async getBinArrays(): Promise<BinArrayAccount[]> {
    return this.program.account.binArray.all([
      binArrayLbPairFilter(this.pubkey),
    ]);
  }

  /**
   * The function `getBinArrayAroundActiveBin` retrieves a specified number of `BinArrayAccount`
   * objects from the blockchain, based on the active bin and its surrounding bin arrays.
   * @param
   *    swapForY - The `swapForY` parameter is a boolean value that indicates whether the swap is using quote token as input.
   *    [count=4] - The `count` parameter is the number of bin arrays to retrieve on left and right respectively. By default, it is set to 4.
   * @returns an array of `BinArrayAccount` objects.
   */
  public async getBinArrayForSwap(
    swapForY,
    count = 4
  ): Promise<BinArrayAccount[]> {
    await this.refetchStates();

    const binArraysPubkey = new Set<string>();

    let shouldStop = false;
    let activeIdToLoop = this.lbPair.activeId;

    while (!shouldStop) {
      const binArrayIndex = findNextBinArrayIndexWithLiquidity(
        swapForY,
        new BN(activeIdToLoop),
        this.lbPair,
        this.binArrayBitmapExtension?.account ?? null
      );
      if (binArrayIndex === null) shouldStop = true;
      else {
        const [binArrayPubKey] = deriveBinArray(
          this.pubkey,
          binArrayIndex,
          this.program.programId
        );
        binArraysPubkey.add(binArrayPubKey.toBase58());

        const [lowerBinId, upperBinId] =
          getBinArrayLowerUpperBinId(binArrayIndex);
        activeIdToLoop = swapForY
          ? lowerBinId.toNumber() - 1
          : upperBinId.toNumber() + 1;
      }

      if (binArraysPubkey.size === count) shouldStop = true;
    }

    const accountsToFetch = Array.from(binArraysPubkey).map(
      (pubkey) => new PublicKey(pubkey)
    );

    const binArraysAccInfoBuffer = await chunkedGetMultipleAccountInfos(
      this.program.provider.connection,
      accountsToFetch
    );

    const binArrays: BinArrayAccount[] = await Promise.all(
      binArraysAccInfoBuffer.map(async (accInfo, idx) => {
        const account: BinArray = this.program.coder.accounts.decode(
          this.program.account.binArray.idlAccount.name,
          accInfo.data
        );
        const publicKey = accountsToFetch[idx];
        return {
          account,
          publicKey,
        };
      })
    );

    return binArrays;
  }

  /**
   * The function `calculateFeeInfo` calculates the base fee rate percentage and maximum fee rate percentage
   * given the base factor, bin step, and optional base fee power factor.
   * @param baseFactor - The base factor of the pair.
   * @param binStep - The bin step of the pair.
   * @param baseFeePowerFactor - Optional parameter to allow small bin step to have bigger fee rate. Default to 0.
   * @returns an object of type `Omit<FeeInfo, "protocolFeePercentage">` with the following properties: baseFeeRatePercentage and maxFeeRatePercentage.
   */
  public static calculateFeeInfo(
    baseFactor: number | string,
    binStep: number | string,
    baseFeePowerFactor?: number | string
  ): Omit<FeeInfo, "protocolFeePercentage"> {
    const baseFeeRate = new BN(baseFactor)
      .mul(new BN(binStep))
      .mul(new BN(10))
      .mul(new BN(10).pow(new BN(baseFeePowerFactor ?? 0)));
    const baseFeeRatePercentage = new Decimal(baseFeeRate.toString())
      .mul(new Decimal(100))
      .div(new Decimal(FEE_PRECISION.toString()));
    const maxFeeRatePercentage = new Decimal(MAX_FEE_RATE.toString())
      .mul(new Decimal(100))
      .div(new Decimal(FEE_PRECISION.toString()));

    return {
      baseFeeRatePercentage,
      maxFeeRatePercentage,
    };
  }

  /**
   * The function `getFeeInfo` calculates and returns the base fee rate percentage, maximum fee rate
   * percentage, and protocol fee percentage.
   * @returns an object of type `FeeInfo` with the following properties: baseFeeRatePercentage, maxFeeRatePercentage, and protocolFeePercentage.
   */
  public getFeeInfo(): FeeInfo {
    const { baseFactor, protocolShare } = this.lbPair.parameters;

    const { baseFeeRatePercentage, maxFeeRatePercentage } =
      DLMM.calculateFeeInfo(
        baseFactor,
        this.lbPair.binStep,
        this.lbPair.parameters.baseFeePowerFactor
      );

    const protocolFeePercentage = new Decimal(protocolShare.toString())
      .mul(new Decimal(100))
      .div(new Decimal(BASIS_POINT_MAX));

    return {
      baseFeeRatePercentage,
      maxFeeRatePercentage,
      protocolFeePercentage,
    };
  }

  /**
   * The function calculates and returns a dynamic fee
   * @returns a Decimal value representing the dynamic fee.
   */
  public getDynamicFee(): Decimal {
    let vParameterClone = Object.assign({}, this.lbPair.vParameters);
    let activeId = new BN(this.lbPair.activeId);
    const sParameters = this.lbPair.parameters;

    const currentTimestamp = Date.now() / 1000;
    this.updateReference(
      activeId.toNumber(),
      vParameterClone,
      sParameters,
      currentTimestamp
    );
    this.updateVolatilityAccumulator(
      vParameterClone,
      sParameters,
      activeId.toNumber()
    );

    const totalFee = getTotalFee(
      this.lbPair.binStep,
      sParameters,
      vParameterClone
    );
    return new Decimal(totalFee.toString())
      .div(new Decimal(FEE_PRECISION.toString()))
      .mul(100);
  }

  /**
   * The function `getEmissionRate` returns the emission rates for two rewards.
   * @returns an object of type `EmissionRate`. The object has two properties: `rewardOne` and
   * `rewardTwo`, both of which are of type `Decimal`.
   */
  public getEmissionRate(): EmissionRate {
    const now = Date.now() / 1000;
    const [rewardOneEmissionRate, rewardTwoEmissionRate] =
      this.lbPair.rewardInfos.map(({ rewardRate, rewardDurationEnd }) =>
        now > rewardDurationEnd.toNumber() ? undefined : rewardRate
      );

    return {
      rewardOne: rewardOneEmissionRate
        ? new Decimal(rewardOneEmissionRate.toString()).div(PRECISION)
        : undefined,
      rewardTwo: rewardTwoEmissionRate
        ? new Decimal(rewardTwoEmissionRate.toString()).div(PRECISION)
        : undefined,
    };
  }

  /**
   * The function `getBinsAroundActiveBin` retrieves a specified number of bins to the left and right
   * of the active bin and returns them along with the active bin ID.
   * @param {number} numberOfBinsToTheLeft - The parameter `numberOfBinsToTheLeft` represents the
   * number of bins to the left of the active bin that you want to retrieve. It determines how many
   * bins you want to include in the result that are positioned to the left of the active bin.
   * @param {number} numberOfBinsToTheRight - The parameter `numberOfBinsToTheRight` represents the
   * number of bins to the right of the active bin that you want to retrieve.
   * @returns an object with two properties: "activeBin" and "bins". The value of "activeBin" is the
   * value of "this.lbPair.activeId", and the value of "bins" is the result of calling the "getBins"
   * function with the specified parameters.
   */
  public async getBinsAroundActiveBin(
    numberOfBinsToTheLeft: number,
    numberOfBinsToTheRight: number
  ): Promise<{ activeBin: number; bins: BinLiquidity[] }> {
    const lowerBinId = this.lbPair.activeId - numberOfBinsToTheLeft - 1;
    const upperBinId = this.lbPair.activeId + numberOfBinsToTheRight + 1;

    const bins = await this.getBins(
      this.pubkey,
      lowerBinId,
      upperBinId,
      this.tokenX.mint.decimals,
      this.tokenY.mint.decimals
    );

    return { activeBin: this.lbPair.activeId, bins };
  }

  /**
   * The function `getBinsBetweenMinAndMaxPrice` retrieves a list of bins within a specified price
   * range.
   * @param {number} minPrice - The minimum price value for filtering the bins.
   * @param {number} maxPrice - The `maxPrice` parameter is the maximum price value that you want to
   * use for filtering the bins.
   * @returns an object with two properties: "activeBin" and "bins". The value of "activeBin" is the
   * active bin ID of the lbPair, and the value of "bins" is an array of BinLiquidity objects.
   */
  public async getBinsBetweenMinAndMaxPrice(
    minPrice: number,
    maxPrice: number
  ): Promise<{ activeBin: number; bins: BinLiquidity[] }> {
    const lowerBinId = this.getBinIdFromPrice(minPrice, true) - 1;
    const upperBinId = this.getBinIdFromPrice(maxPrice, false) + 1;

    const bins = await this.getBins(
      this.pubkey,
      lowerBinId,
      upperBinId,
      this.tokenX.mint.decimals,
      this.tokenX.mint.decimals
    );

    return { activeBin: this.lbPair.activeId, bins };
  }

  /**
   * The function `getBinsBetweenLowerAndUpperBound` retrieves a list of bins between a lower and upper
   * bin ID and returns the active bin ID and the list of bins.
   * @param {number} lowerBinId - The lowerBinId parameter is a number that represents the ID of the
   * lowest bin.
   * @param {number} upperBinId - The upperBinID parameter is a number that represents the ID of the
   * highest bin.
   * @param {BinArray} [lowerBinArrays] - The `lowerBinArrays` parameter is an optional parameter of
   * type `BinArray`. It represents an array of bins that are below the lower bin ID.
   * @param {BinArray} [upperBinArrays] - The parameter `upperBinArrays` is an optional parameter of
   * type `BinArray`. It represents an array of bins that are above the upper bin ID.
   * @returns an object with two properties: "activeBin" and "bins". The value of "activeBin" is the
   * active bin ID of the lbPair, and the value of "bins" is an array of BinLiquidity objects.
   */
  public async getBinsBetweenLowerAndUpperBound(
    lowerBinId: number,
    upperBinId: number,
    lowerBinArray?: BinArray,
    upperBinArray?: BinArray
  ): Promise<{ activeBin: number; bins: BinLiquidity[] }> {
    const bins = await this.getBins(
      this.pubkey,
      lowerBinId,
      upperBinId,
      this.tokenX.mint.decimals,
      this.tokenY.mint.decimals,
      lowerBinArray,
      upperBinArray
    );

    return { activeBin: this.lbPair.activeId, bins };
  }

  /**
   * The function converts a real price of bin to a lamport value
   * @param {number} price - The `price` parameter is a number representing the price of a token.
   * @returns {string} price per Lamport of bin
   */
  public toPricePerLamport(price: number): string {
    return DLMM.getPricePerLamport(
      this.tokenX.mint.decimals,
      this.tokenY.mint.decimals,
      price
    );
  }

  /**
   * The function converts a price per lamport value to a real price of bin
   * @param {number} pricePerLamport - The parameter `pricePerLamport` is a number representing the
   * price per lamport.
   * @returns {string} real price of bin
   */
  public fromPricePerLamport(pricePerLamport: number): string {
    return new Decimal(pricePerLamport)
      .div(
        new Decimal(
          10 ** (this.tokenY.mint.decimals - this.tokenX.mint.decimals)
        )
      )
      .toString();
  }

  /**
   * The function retrieves the active bin ID and its corresponding price.
   * @returns an object with two properties: "binId" which is a number, and "price" which is a string.
   */
  public async getActiveBin(): Promise<BinLiquidity> {
    const { activeId } = await this.program.account.lbPair.fetch(this.pubkey);
    const [activeBinState] = await this.getBins(
      this.pubkey,
      activeId,
      activeId,
      this.tokenX.mint.decimals,
      this.tokenY.mint.decimals
    );
    return activeBinState;
  }

  /**
   * The function get bin ID based on a given price and a boolean flag indicating whether to
   * round down or up.
   * @param {number} price - The price parameter is a number that represents the price value.
   * @param {boolean} min - The "min" parameter is a boolean value that determines whether to round
   * down or round up the calculated binId. If "min" is true, the binId will be rounded down (floor),
   * otherwise it will be rounded up (ceil).
   * @returns {number} which is the binId calculated based on the given price and whether the minimum
   * value should be used.
   */
  public getBinIdFromPrice(price: number, min: boolean): number {
    return DLMM.getBinIdFromPrice(price, this.lbPair.binStep, min);
  }

  /**
   * The function `getPositionsByUserAndLbPair` retrieves positions by user and LB pair, including
   * active bin and user positions.
   * @param {PublicKey} [userPubKey] - The `userPubKey` parameter is an optional parameter of type
   * `PublicKey`. It represents the public key of a user. If no `userPubKey` is provided, the function
   * will return an object with an empty `userPositions` array and the active bin information obtained
   * from the `getActive
   * @returns The function `getPositionsByUserAndLbPair` returns a Promise that resolves to an object
   * with two properties:
   *    - "activeBin" which is an object with two properties: "binId" and "price". The value of "binId"
   *     is the active bin ID of the lbPair, and the value of "price" is the price of the active bin.
   *   - "userPositions" which is an array of Position objects.
   */
  public async getPositionsByUserAndLbPair(userPubKey?: PublicKey): Promise<{
    activeBin: BinLiquidity;
    userPositions: Array<LbPosition>;
  }> {
    const promiseResults = await Promise.all([
      this.getActiveBin(),
      userPubKey &&
        this.program.account.positionV2.all([
          positionOwnerFilter(userPubKey),
          positionLbPairFilter(this.pubkey),
        ]),
    ]);

    const [activeBin, positionsV2] = promiseResults;

    if (!activeBin) {
      throw new Error("Error fetching active bin");
    }

    if (!userPubKey) {
      return {
        activeBin,
        userPositions: [],
      };
    }

    const positions = [
      ...positionsV2.map((p) => new PositionV2Wrapper(p.publicKey, p.account)),
    ];

    if (!positions) {
      throw new Error("Error fetching positions");
    }

    const binArrayPubkeySetV2 = new Set<string>();
    positions.forEach((position) => {
      const binArrayKeys = position.getBinArrayKeysCoverage(
        this.program.programId
      );

      binArrayKeys.forEach((key) => {
        binArrayPubkeySetV2.add(key.toBase58());
      });
    });

    const binArrayPubkeyArrayV2 = Array.from(binArrayPubkeySetV2).map(
      (pubkey) => new PublicKey(pubkey)
    );

    const lbPairAndBinArrays = await chunkedGetMultipleAccountInfos(
      this.program.provider.connection,
      [this.pubkey, SYSVAR_CLOCK_PUBKEY, ...binArrayPubkeyArrayV2]
    );

    const [lbPairAccInfo, clockAccInfo, ...binArraysAccInfo] =
      lbPairAndBinArrays;

    const positionBinArraysMapV2 = new Map();
    for (let i = 0; i < binArraysAccInfo.length; i++) {
      const binArrayPubkey = binArrayPubkeyArrayV2[i];
      const binArrayAccBufferV2 = binArraysAccInfo[i];
      if (binArrayAccBufferV2) {
        const binArrayAccInfo = this.program.coder.accounts.decode(
          this.program.account.binArray.idlAccount.name,
          binArrayAccBufferV2.data
        );
        positionBinArraysMapV2.set(binArrayPubkey.toBase58(), binArrayAccInfo);
      }
    }

    if (!lbPairAccInfo)
      throw new Error(`LB Pair account ${this.pubkey.toBase58()} not found`);

    const clock: Clock = ClockLayout.decode(clockAccInfo.data);

    const userPositions = await Promise.all(
      positions.map(async (position) => {
        return {
          publicKey: position.address(),
          positionData: await DLMM.processPosition(
            this.program,
            this.lbPair,
            clock,
            position,
            this.tokenX.mint,
            this.tokenY.mint,
            this.rewards[0]?.mint,
            this.rewards[1]?.mint,
            positionBinArraysMapV2
          ),
          version: position.version(),
        };
      })
    );

    return {
      activeBin,
      userPositions,
    };
  }

  public async quoteCreatePosition({ strategy }: TQuoteCreatePositionParams) {
    const { minBinId, maxBinId } = strategy;

    const lowerBinArrayIndex = binIdToBinArrayIndex(new BN(minBinId));
    const upperBinArrayIndex = BN.max(
      binIdToBinArrayIndex(new BN(maxBinId)),
      lowerBinArrayIndex.add(new BN(1))
    );

    const binArraysCount = (
      await this.binArraysToBeCreate(lowerBinArrayIndex, upperBinArrayIndex)
    ).length;
    const positionCount = Math.ceil((maxBinId - minBinId + 1) / MAX_BIN_PER_TX);

    const binArrayCost = binArraysCount * BIN_ARRAY_FEE;
    const positionCost = positionCount * POSITION_FEE;
    return {
      binArraysCount,
      binArrayCost,
      positionCount,
      positionCost,
    };
  }

  /**
   * Creates an empty position and initializes the corresponding bin arrays if needed.
   * @param param0 The settings of the requested new position.
   * @returns A promise that resolves into a transaction for creating the requested position.
   */
  public async createEmptyPosition({
    positionPubKey,
    minBinId,
    maxBinId,
    user,
  }: {
    positionPubKey: PublicKey;
    minBinId: number;
    maxBinId: number;
    user: PublicKey;
  }) {
    const createPositionIx = await this.program.methods
      .initializePosition(minBinId, maxBinId - minBinId + 1)
      .accounts({
        payer: user,
        position: positionPubKey,
        lbPair: this.pubkey,
        owner: user,
      })
      .instruction();

    const lowerBinArrayIndex = binIdToBinArrayIndex(new BN(minBinId));
    const upperBinArrayIndex = BN.max(
      lowerBinArrayIndex.add(new BN(1)),
      binIdToBinArrayIndex(new BN(maxBinId))
    );

    const binArrayIndexes: BN[] = Array.from(
      { length: upperBinArrayIndex.sub(lowerBinArrayIndex).toNumber() + 1 },
      (_, index) => index + lowerBinArrayIndex.toNumber()
    ).map((idx) => new BN(idx));

    const createBinArrayIxs = await this.createBinArraysIfNeeded(
      binArrayIndexes,
      user
    );

    const instructions = [createPositionIx, ...createBinArrayIxs];
    const setCUIx = await getEstimatedComputeUnitIxWithBuffer(
      this.program.provider.connection,
      instructions,
      user
    );

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");
    return new Transaction({
      blockhash,
      lastValidBlockHeight,
      feePayer: user,
    }).add(setCUIx, ...instructions);
  }

  /**
   * The function `getPosition` retrieves position information for a given public key and processes it
   * using various data to return a `LbPosition` object.
   * @param {PublicKey} positionPubKey - The `getPosition` function you provided is an asynchronous
   * function that fetches position information based on a given public key. Here's a breakdown of the
   * parameters used in the function:
   * @returns The `getPosition` function returns a Promise that resolves to an object of type
   * `LbPosition`. The object contains the following properties:
   * - `publicKey`: The public key of the position account
   * - `positionData`: Position Object
   * - `version`: The version of the position (in this case, `Position.V2`)
   */
  public async getPosition(positionPubKey: PublicKey): Promise<LbPosition> {
    const positionAccountInfo =
      await this.program.provider.connection.getAccountInfo(positionPubKey);

    if (!positionAccountInfo) {
      throw new Error(
        `Position account ${positionPubKey.toBase58()} not found`
      );
    }

    let position: IPosition = wrapPosition(
      this.program,
      positionPubKey,
      positionAccountInfo
    );

    const binArrayKeys = position.getBinArrayKeysCoverage(
      this.program.programId
    );

    const [clockAccInfo, ...binArrayAccountsInfo] =
      await chunkedGetMultipleAccountInfos(this.program.provider.connection, [
        SYSVAR_CLOCK_PUBKEY,
        ...binArrayKeys,
      ]);

    const clock: Clock = ClockLayout.decode(clockAccInfo.data);

    const binArrayMap = new Map<String, BinArray>();

    for (let i = 0; i < binArrayAccountsInfo.length; i++) {
      if (binArrayAccountsInfo[i]) {
        const binArrayState: BinArray = this.program.coder.accounts.decode(
          this.program.account.binArray.idlAccount.name,
          binArrayAccountsInfo[i].data
        );

        binArrayMap.set(binArrayKeys[i].toBase58(), binArrayState);
      }
    }

    return {
      publicKey: positionPubKey,
      positionData: await DLMM.processPosition(
        this.program,
        this.lbPair,
        clock,
        position,
        this.tokenX.mint,
        this.tokenY.mint,
        this.rewards[0]?.mint,
        this.rewards[1]?.mint,
        binArrayMap
      ),
      version: position.version(),
    };
  }

  /**
   * The function `initializePositionAndAddLiquidityByStrategy` function is used to initializes a position and adds liquidity
   * @param {TInitializePositionAndAddLiquidityParamsByStrategy}
   *    - `positionPubKey`: The public key of the position account. (usually use `new Keypair()`)
   *    - `totalXAmount`: The total amount of token X to be added to the liquidity pool.
   *    - `totalYAmount`: The total amount of token Y to be added to the liquidity pool.
   *    - `strategy`: The strategy parameters to be used for the liquidity pool (Can use `calculateStrategyParameter` to calculate).
   *    - `user`: The public key of the user account.
   *    - `slippage`: The slippage percentage to be used for the liquidity pool.
   * @returns {Promise<Transaction>} The function `initializePositionAndAddLiquidityByStrategy` returns a `Promise` that
   * resolves to either a single `Transaction` object.
   */
  public async initializePositionAndAddLiquidityByStrategy({
    positionPubKey,
    totalXAmount,
    totalYAmount,
    strategy,
    user,
    slippage,
  }: TInitializePositionAndAddLiquidityParamsByStrategy) {
    const { maxBinId, minBinId } = strategy;

    const maxActiveBinSlippage = slippage
      ? Math.ceil(slippage / (this.lbPair.binStep / 100))
      : MAX_ACTIVE_BIN_SLIPPAGE;

    const preInstructions: TransactionInstruction[] = [];
    const initializePositionIx = await this.program.methods
      .initializePosition(minBinId, maxBinId - minBinId + 1)
      .accounts({
        payer: user,
        position: positionPubKey,
        lbPair: this.pubkey,
        owner: user,
      })
      .instruction();
    preInstructions.push(initializePositionIx);

    const binArrayIndexes = getBinArrayIndexesCoverage(
      new BN(minBinId),
      new BN(maxBinId)
    );

    const binArrayAccountMetas = getBinArrayAccountMetasCoverage(
      new BN(minBinId),
      new BN(maxBinId),
      this.pubkey,
      this.program.programId
    );

    const createBinArrayIxs = await this.createBinArraysIfNeeded(
      binArrayIndexes,
      user
    );
    preInstructions.push(...createBinArrayIxs);

    const [
      { ataPubKey: userTokenX, ix: createPayerTokenXIx },
      { ataPubKey: userTokenY, ix: createPayerTokenYIx },
    ] = await Promise.all([
      getOrCreateATAInstruction(
        this.program.provider.connection,
        this.tokenX.publicKey,
        user,
        this.tokenX.owner
      ),
      getOrCreateATAInstruction(
        this.program.provider.connection,
        this.tokenY.publicKey,
        user,
        this.tokenY.owner
      ),
    ]);
    createPayerTokenXIx && preInstructions.push(createPayerTokenXIx);
    createPayerTokenYIx && preInstructions.push(createPayerTokenYIx);

    if (this.tokenX.publicKey.equals(NATIVE_MINT) && !totalXAmount.isZero()) {
      const wrapSOLIx = wrapSOLInstruction(
        user,
        userTokenX,
        BigInt(totalXAmount.toString())
      );

      preInstructions.push(...wrapSOLIx);
    }

    if (this.tokenY.publicKey.equals(NATIVE_MINT) && !totalYAmount.isZero()) {
      const wrapSOLIx = wrapSOLInstruction(
        user,
        userTokenY,
        BigInt(totalYAmount.toString())
      );

      preInstructions.push(...wrapSOLIx);
    }

    const postInstructions: Array<TransactionInstruction> = [];
    if (
      [
        this.tokenX.publicKey.toBase58(),
        this.tokenY.publicKey.toBase58(),
      ].includes(NATIVE_MINT.toBase58())
    ) {
      const closeWrappedSOLIx = await unwrapSOLInstruction(user);
      closeWrappedSOLIx && postInstructions.push(closeWrappedSOLIx);
    }

    const minBinArrayIndex = binIdToBinArrayIndex(new BN(minBinId));
    const maxBinArrayIndex = binIdToBinArrayIndex(new BN(maxBinId));

    const useExtension =
      isOverflowDefaultBinArrayBitmap(minBinArrayIndex) ||
      isOverflowDefaultBinArrayBitmap(maxBinArrayIndex);

    const binArrayBitmapExtension = useExtension
      ? deriveBinArrayBitmapExtension(this.pubkey, this.program.programId)[0]
      : null;

    const activeId = this.lbPair.activeId;

    const strategyParameters: LiquidityParameterByStrategy["strategyParameters"] =
      toStrategyParameters(strategy) as ProgramStrategyParameter;

    const liquidityParams: LiquidityParameterByStrategy = {
      amountX: totalXAmount,
      amountY: totalYAmount,
      activeId,
      maxActiveBinSlippage,
      strategyParameters,
    };

    const addLiquidityAccounts = {
      position: positionPubKey,
      lbPair: this.pubkey,
      userTokenX,
      userTokenY,
      reserveX: this.lbPair.reserveX,
      reserveY: this.lbPair.reserveY,
      tokenXMint: this.lbPair.tokenXMint,
      tokenYMint: this.lbPair.tokenYMint,
      binArrayBitmapExtension,
      sender: user,
      tokenXProgram: this.tokenX.owner,
      tokenYProgram: this.tokenY.owner,
      memoProgram: MEMO_PROGRAM_ID,
    };

    const { slices, accounts: transferHookAccounts } =
      this.getPotentialToken2022IxDataAndAccounts(ActionType.Liquidity);

    const programMethod = this.program.methods.addLiquidityByStrategy2(
      liquidityParams,
      {
        slices,
      }
    );

    const addLiquidityIx = await programMethod
      .accounts(addLiquidityAccounts)
      .remainingAccounts(transferHookAccounts)
      .remainingAccounts(binArrayAccountMetas)
      .instruction();

    const instructions = [
      ...preInstructions,
      addLiquidityIx,
      ...postInstructions,
    ];

    const setCUIx = await getEstimatedComputeUnitIxWithBuffer(
      this.program.provider.connection,
      instructions,
      user
    );

    instructions.unshift(setCUIx);

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");
    return new Transaction({
      blockhash,
      lastValidBlockHeight,
      feePayer: user,
    }).add(...instructions);
  }

  /**
   * @deprecated Use `initializePositionAndAddLiquidityByStrategy` instead which support both token and token2022.
   * The function `initializePositionAndAddLiquidityByWeight` function is used to initializes a position and adds liquidity
   * @param {TInitializePositionAndAddLiquidityParams}
   *    - `positionPubKey`: The public key of the position account. (usually use `new Keypair()`)
   *    - `totalXAmount`: The total amount of token X to be added to the liquidity pool.
   *    - `totalYAmount`: The total amount of token Y to be added to the liquidity pool.
   *    - `xYAmountDistribution`: An array of objects of type `XYAmountDistribution` that represents (can use `calculateSpotDistribution`, `calculateBidAskDistribution` & `calculateNormalDistribution`)
   *    - `user`: The public key of the user account.
   *    - `slippage`: The slippage percentage to be used for the liquidity pool.
   * @returns {Promise<Transaction|Transaction[]>} The function `initializePositionAndAddLiquidityByWeight` returns a `Promise` that
   * resolves to either a single `Transaction` object (if less than 26bin involved) or an array of `Transaction` objects.
   */
  public async initializePositionAndAddLiquidityByWeight({
    positionPubKey,
    totalXAmount,
    totalYAmount,
    xYAmountDistribution,
    user,
    slippage,
  }: TInitializePositionAndAddLiquidityParams): Promise<
    Transaction | Transaction[]
  > {
    const { lowerBinId, upperBinId, binIds } =
      this.processXYAmountDistribution(xYAmountDistribution);

    const maxActiveBinSlippage = slippage
      ? Math.ceil(slippage / (this.lbPair.binStep / 100))
      : MAX_ACTIVE_BIN_SLIPPAGE;

    if (upperBinId >= lowerBinId + MAX_BIN_PER_POSITION.toNumber()) {
      throw new Error(
        `Position must be within a range of 1 to ${MAX_BIN_PER_POSITION.toNumber()} bins.`
      );
    }

    const preInstructions: Array<TransactionInstruction> = [];
    const initializePositionIx = await this.program.methods
      .initializePosition(lowerBinId, upperBinId - lowerBinId + 1)
      .accounts({
        payer: user,
        position: positionPubKey,
        lbPair: this.pubkey,
        owner: user,
      })
      .instruction();
    preInstructions.push(initializePositionIx);

    const lowerBinArrayIndex = binIdToBinArrayIndex(new BN(lowerBinId));
    const [binArrayLower] = deriveBinArray(
      this.pubkey,
      lowerBinArrayIndex,
      this.program.programId
    );

    const upperBinArrayIndex = BN.max(
      lowerBinArrayIndex.add(new BN(1)),
      binIdToBinArrayIndex(new BN(upperBinId))
    );
    const [binArrayUpper] = deriveBinArray(
      this.pubkey,
      upperBinArrayIndex,
      this.program.programId
    );

    const createBinArrayIxs = await this.createBinArraysIfNeeded(
      [lowerBinArrayIndex, upperBinArrayIndex],
      user
    );
    preInstructions.push(...createBinArrayIxs);

    const [
      { ataPubKey: userTokenX, ix: createPayerTokenXIx },
      { ataPubKey: userTokenY, ix: createPayerTokenYIx },
    ] = await Promise.all([
      getOrCreateATAInstruction(
        this.program.provider.connection,
        this.tokenX.publicKey,
        user,
        this.tokenX.owner
      ),
      getOrCreateATAInstruction(
        this.program.provider.connection,
        this.tokenY.publicKey,
        user,
        this.tokenY.owner
      ),
    ]);
    createPayerTokenXIx && preInstructions.push(createPayerTokenXIx);
    createPayerTokenYIx && preInstructions.push(createPayerTokenYIx);

    if (this.tokenX.publicKey.equals(NATIVE_MINT) && !totalXAmount.isZero()) {
      const wrapSOLIx = wrapSOLInstruction(
        user,
        userTokenX,
        BigInt(totalXAmount.toString())
      );

      preInstructions.push(...wrapSOLIx);
    }

    if (this.tokenY.publicKey.equals(NATIVE_MINT) && !totalYAmount.isZero()) {
      const wrapSOLIx = wrapSOLInstruction(
        user,
        userTokenY,
        BigInt(totalYAmount.toString())
      );

      preInstructions.push(...wrapSOLIx);
    }

    const postInstructions: Array<TransactionInstruction> = [];
    if (
      [
        this.tokenX.publicKey.toBase58(),
        this.tokenY.publicKey.toBase58(),
      ].includes(NATIVE_MINT.toBase58())
    ) {
      const closeWrappedSOLIx = await unwrapSOLInstruction(user);
      closeWrappedSOLIx && postInstructions.push(closeWrappedSOLIx);
    }

    const minBinId = Math.min(...binIds);
    const maxBinId = Math.max(...binIds);

    const minBinArrayIndex = binIdToBinArrayIndex(new BN(minBinId));
    const maxBinArrayIndex = binIdToBinArrayIndex(new BN(maxBinId));

    const useExtension =
      isOverflowDefaultBinArrayBitmap(minBinArrayIndex) ||
      isOverflowDefaultBinArrayBitmap(maxBinArrayIndex);

    const binArrayBitmapExtension = useExtension
      ? deriveBinArrayBitmapExtension(this.pubkey, this.program.programId)[0]
      : null;

    const activeId = this.lbPair.activeId;

    const binLiquidityDist: LiquidityParameterByWeight["binLiquidityDist"] =
      toWeightDistribution(
        totalXAmount,
        totalYAmount,
        xYAmountDistribution.map((item) => ({
          binId: item.binId,
          xAmountBpsOfTotal: item.xAmountBpsOfTotal,
          yAmountBpsOfTotal: item.yAmountBpsOfTotal,
        })),
        this.lbPair.binStep
      );

    if (binLiquidityDist.length === 0) {
      throw new Error("No liquidity to add");
    }

    const liquidityParams: LiquidityParameterByWeight = {
      amountX: totalXAmount,
      amountY: totalYAmount,
      binLiquidityDist,
      activeId,
      maxActiveBinSlippage,
    };

    const addLiquidityAccounts = {
      position: positionPubKey,
      lbPair: this.pubkey,
      userTokenX,
      userTokenY,
      reserveX: this.lbPair.reserveX,
      reserveY: this.lbPair.reserveY,
      tokenXMint: this.lbPair.tokenXMint,
      tokenYMint: this.lbPair.tokenYMint,
      binArrayLower,
      binArrayUpper,
      binArrayBitmapExtension,
      sender: user,
      tokenXProgram: TOKEN_PROGRAM_ID,
      tokenYProgram: TOKEN_PROGRAM_ID,
    };

    const oneSideLiquidityParams: LiquidityOneSideParameter = {
      amount: totalXAmount.isZero() ? totalYAmount : totalXAmount,
      activeId,
      maxActiveBinSlippage,
      binLiquidityDist,
    };

    const oneSideAddLiquidityAccounts = {
      binArrayLower,
      binArrayUpper,
      lbPair: this.pubkey,
      binArrayBitmapExtension: null,
      sender: user,
      position: positionPubKey,
      reserve: totalXAmount.isZero()
        ? this.lbPair.reserveY
        : this.lbPair.reserveX,
      tokenMint: totalXAmount.isZero()
        ? this.lbPair.tokenYMint
        : this.lbPair.tokenXMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      userToken: totalXAmount.isZero() ? userTokenY : userTokenX,
    };

    const isOneSideDeposit = totalXAmount.isZero() || totalYAmount.isZero();
    const programMethod = isOneSideDeposit
      ? this.program.methods.addLiquidityOneSide(oneSideLiquidityParams)
      : this.program.methods.addLiquidityByWeight(liquidityParams);

    if (xYAmountDistribution.length < MAX_BIN_LENGTH_ALLOWED_IN_ONE_TX) {
      const addLiqIx = await programMethod
        .accounts(
          isOneSideDeposit ? oneSideAddLiquidityAccounts : addLiquidityAccounts
        )
        .instruction();

      const instructions = [...preInstructions, addLiqIx, ...postInstructions];

      const setCUIx = await getEstimatedComputeUnitIxWithBuffer(
        this.program.provider.connection,
        instructions,
        user
      );

      instructions.unshift(setCUIx);

      const { blockhash, lastValidBlockHeight } =
        await this.program.provider.connection.getLatestBlockhash("confirmed");
      return new Transaction({
        blockhash,
        lastValidBlockHeight,
        feePayer: user,
      }).add(...instructions);
    }

    const addLiqIx = await programMethod
      .accounts(
        isOneSideDeposit ? oneSideAddLiquidityAccounts : addLiquidityAccounts
      )
      .instruction();

    const setCUIx = await getEstimatedComputeUnitIxWithBuffer(
      this.program.provider.connection,
      [addLiqIx],
      user,
      DEFAULT_ADD_LIQUIDITY_CU // The function return multiple transactions that dependent on each other, simulation will fail
    );

    const mainInstructions = [setCUIx, addLiqIx];

    const transactions: Transaction[] = [];
    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");

    if (preInstructions.length) {
      const preInstructionsTx = new Transaction({
        blockhash,
        lastValidBlockHeight,
        feePayer: user,
      }).add(...preInstructions);
      transactions.push(preInstructionsTx);
    }

    const mainTx = new Transaction({
      blockhash,
      lastValidBlockHeight,
      feePayer: user,
    }).add(...mainInstructions);
    transactions.push(mainTx);

    if (postInstructions.length) {
      const postInstructionsTx = new Transaction({
        blockhash,
        lastValidBlockHeight,
        feePayer: user,
      }).add(...postInstructions);
      transactions.push(postInstructionsTx);
    }

    return transactions;
  }

  /**
   * The `addLiquidityByStrategy` function is used to add liquidity to existing position
   * @param {TInitializePositionAndAddLiquidityParamsByStrategy}
   *    - `positionPubKey`: The public key of the position account. (usually use `new Keypair()`)
   *    - `totalXAmount`: The total amount of token X to be added to the liquidity pool.
   *    - `totalYAmount`: The total amount of token Y to be added to the liquidity pool.
   *    - `strategy`: The strategy parameters to be used for the liquidity pool (Can use `calculateStrategyParameter` to calculate).
   *    - `user`: The public key of the user account.
   *    - `slippage`: The slippage percentage to be used for the liquidity pool.
   * @returns {Promise<Transaction>} The function `addLiquidityByWeight` returns a `Promise` that resolves to either a single
   * `Transaction` object
   */
  public async addLiquidityByStrategy({
    positionPubKey,
    totalXAmount,
    totalYAmount,
    strategy,
    user,
    slippage,
  }: TInitializePositionAndAddLiquidityParamsByStrategy): Promise<Transaction> {
    const { maxBinId, minBinId } = strategy;

    const maxActiveBinSlippage = slippage
      ? Math.ceil(slippage / (this.lbPair.binStep / 100))
      : MAX_ACTIVE_BIN_SLIPPAGE;

    const preInstructions: TransactionInstruction[] = [];

    const minBinArrayIndex = binIdToBinArrayIndex(new BN(minBinId));
    const maxBinArrayIndex = binIdToBinArrayIndex(new BN(maxBinId));

    const useExtension =
      isOverflowDefaultBinArrayBitmap(minBinArrayIndex) ||
      isOverflowDefaultBinArrayBitmap(maxBinArrayIndex);

    const binArrayBitmapExtension = useExtension
      ? deriveBinArrayBitmapExtension(this.pubkey, this.program.programId)[0]
      : null;

    const strategyParameters: LiquidityParameterByStrategy["strategyParameters"] =
      toStrategyParameters(strategy) as ProgramStrategyParameter;

    const binArrayIndexes = getBinArrayIndexesCoverage(
      new BN(minBinId),
      new BN(maxBinId)
    );

    const binArrayAccountsMeta = getBinArrayAccountMetasCoverage(
      new BN(minBinId),
      new BN(maxBinId),
      this.pubkey,
      this.program.programId
    );

    const createBinArrayIxs = await this.createBinArraysIfNeeded(
      binArrayIndexes,
      user
    );
    preInstructions.push(...createBinArrayIxs);

    const [
      { ataPubKey: userTokenX, ix: createPayerTokenXIx },
      { ataPubKey: userTokenY, ix: createPayerTokenYIx },
    ] = await Promise.all([
      getOrCreateATAInstruction(
        this.program.provider.connection,
        this.tokenX.publicKey,
        user,
        this.tokenX.owner
      ),
      getOrCreateATAInstruction(
        this.program.provider.connection,
        this.tokenY.publicKey,
        user,
        this.tokenY.owner
      ),
    ]);

    createPayerTokenXIx && preInstructions.push(createPayerTokenXIx);
    createPayerTokenYIx && preInstructions.push(createPayerTokenYIx);

    if (this.tokenX.publicKey.equals(NATIVE_MINT) && !totalXAmount.isZero()) {
      const wrapSOLIx = wrapSOLInstruction(
        user,
        userTokenX,
        BigInt(totalXAmount.toString())
      );

      preInstructions.push(...wrapSOLIx);
    }

    if (this.tokenY.publicKey.equals(NATIVE_MINT) && !totalYAmount.isZero()) {
      const wrapSOLIx = wrapSOLInstruction(
        user,
        userTokenY,
        BigInt(totalYAmount.toString())
      );

      preInstructions.push(...wrapSOLIx);
    }

    const postInstructions: Array<TransactionInstruction> = [];
    if (
      [
        this.tokenX.publicKey.toBase58(),
        this.tokenY.publicKey.toBase58(),
      ].includes(NATIVE_MINT.toBase58())
    ) {
      const closeWrappedSOLIx = await unwrapSOLInstruction(user);
      closeWrappedSOLIx && postInstructions.push(closeWrappedSOLIx);
    }

    const liquidityParams: LiquidityParameterByStrategy = {
      amountX: totalXAmount,
      amountY: totalYAmount,
      activeId: this.lbPair.activeId,
      maxActiveBinSlippage,
      strategyParameters,
    };

    const addLiquidityAccounts = {
      position: positionPubKey,
      lbPair: this.pubkey,
      userTokenX,
      userTokenY,
      reserveX: this.lbPair.reserveX,
      reserveY: this.lbPair.reserveY,
      tokenXMint: this.lbPair.tokenXMint,
      tokenYMint: this.lbPair.tokenYMint,
      binArrayBitmapExtension,
      sender: user,
      tokenXProgram: this.tokenX.owner,
      tokenYProgram: this.tokenY.owner,
      memoProgram: MEMO_PROGRAM_ID,
    };

    const { slices, accounts: transferHookAccounts } =
      this.getPotentialToken2022IxDataAndAccounts(ActionType.Liquidity);

    const programMethod = this.program.methods.addLiquidityByStrategy2(
      liquidityParams,
      {
        slices,
      }
    );

    const addLiquidityIx = await programMethod
      .accounts(addLiquidityAccounts)
      .remainingAccounts(transferHookAccounts)
      .remainingAccounts(binArrayAccountsMeta)
      .instruction();

    const instructions = [
      ...preInstructions,
      addLiquidityIx,
      ...postInstructions,
    ];

    const setCUIx = await getEstimatedComputeUnitIxWithBuffer(
      this.program.provider.connection,
      instructions,
      user
    );

    instructions.unshift(setCUIx);

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");
    return new Transaction({
      blockhash,
      lastValidBlockHeight,
      feePayer: user,
    }).add(...instructions);
  }

  /**
   * @deprecated Use `addLiquidityByStrategy` instead which support both token and token2022.
   * The `addLiquidityByWeight` function is used to add liquidity to existing position
   * @param {TInitializePositionAndAddLiquidityParams}
   *    - `positionPubKey`: The public key of the position account. (usually use `new Keypair()`)
   *    - `totalXAmount`: The total amount of token X to be added to the liquidity pool.
   *    - `totalYAmount`: The total amount of token Y to be added to the liquidity pool.
   *    - `xYAmountDistribution`: An array of objects of type `XYAmountDistribution` that represents (can use `calculateSpotDistribution`, `calculateBidAskDistribution` & `calculateNormalDistribution`)
   *    - `user`: The public key of the user account.
   *    - `slippage`: The slippage percentage to be used for the liquidity pool.
   * @returns {Promise<Transaction|Transaction[]>} The function `addLiquidityByWeight` returns a `Promise` that resolves to either a single
   * `Transaction` object (if less than 26bin involved) or an array of `Transaction` objects.
   */
  public async addLiquidityByWeight({
    positionPubKey,
    totalXAmount,
    totalYAmount,
    xYAmountDistribution,
    user,
    slippage,
  }: TInitializePositionAndAddLiquidityParams): Promise<
    Transaction | Transaction[]
  > {
    const maxActiveBinSlippage = slippage
      ? Math.ceil(slippage / (this.lbPair.binStep / 100))
      : MAX_ACTIVE_BIN_SLIPPAGE;

    const positionAccount = await this.program.account.positionV2.fetch(
      positionPubKey
    );
    const { lowerBinId, upperBinId, binIds } =
      this.processXYAmountDistribution(xYAmountDistribution);

    if (lowerBinId < positionAccount.lowerBinId)
      throw new Error(
        `Lower Bin ID (${lowerBinId}) lower than Position Lower Bin Id (${positionAccount.lowerBinId})`
      );
    if (upperBinId > positionAccount.upperBinId)
      throw new Error(
        `Upper Bin ID (${upperBinId}) higher than Position Upper Bin Id (${positionAccount.upperBinId})`
      );

    const minBinId = Math.min(...binIds);
    const maxBinId = Math.max(...binIds);

    const minBinArrayIndex = binIdToBinArrayIndex(new BN(minBinId));
    const maxBinArrayIndex = binIdToBinArrayIndex(new BN(maxBinId));

    const useExtension =
      isOverflowDefaultBinArrayBitmap(minBinArrayIndex) ||
      isOverflowDefaultBinArrayBitmap(maxBinArrayIndex);

    const binArrayBitmapExtension = useExtension
      ? deriveBinArrayBitmapExtension(this.pubkey, this.program.programId)[0]
      : null;

    const activeId = this.lbPair.activeId;

    const binLiquidityDist: LiquidityParameterByWeight["binLiquidityDist"] =
      toWeightDistribution(
        totalXAmount,
        totalYAmount,
        xYAmountDistribution.map((item) => ({
          binId: item.binId,
          xAmountBpsOfTotal: item.xAmountBpsOfTotal,
          yAmountBpsOfTotal: item.yAmountBpsOfTotal,
        })),
        this.lbPair.binStep
      );

    if (binLiquidityDist.length === 0) {
      throw new Error("No liquidity to add");
    }

    const lowerBinArrayIndex = binIdToBinArrayIndex(
      new BN(positionAccount.lowerBinId)
    );
    const [binArrayLower] = deriveBinArray(
      this.pubkey,
      lowerBinArrayIndex,
      this.program.programId
    );

    const upperBinArrayIndex = BN.max(
      lowerBinArrayIndex.add(new BN(1)),
      binIdToBinArrayIndex(new BN(positionAccount.upperBinId))
    );
    const [binArrayUpper] = deriveBinArray(
      this.pubkey,
      upperBinArrayIndex,
      this.program.programId
    );

    const preInstructions: TransactionInstruction[] = [];
    const createBinArrayIxs = await this.createBinArraysIfNeeded(
      [lowerBinArrayIndex, upperBinArrayIndex],
      user
    );
    preInstructions.push(...createBinArrayIxs);

    const [
      { ataPubKey: userTokenX, ix: createPayerTokenXIx },
      { ataPubKey: userTokenY, ix: createPayerTokenYIx },
    ] = await Promise.all([
      getOrCreateATAInstruction(
        this.program.provider.connection,
        this.tokenX.publicKey,
        user,
        this.tokenX.owner
      ),
      getOrCreateATAInstruction(
        this.program.provider.connection,
        this.tokenY.publicKey,
        user,
        this.tokenY.owner
      ),
    ]);
    createPayerTokenXIx && preInstructions.push(createPayerTokenXIx);
    createPayerTokenYIx && preInstructions.push(createPayerTokenYIx);

    if (this.tokenX.publicKey.equals(NATIVE_MINT) && !totalXAmount.isZero()) {
      const wrapSOLIx = wrapSOLInstruction(
        user,
        userTokenX,
        BigInt(totalXAmount.toString())
      );

      preInstructions.push(...wrapSOLIx);
    }

    if (this.tokenY.publicKey.equals(NATIVE_MINT) && !totalYAmount.isZero()) {
      const wrapSOLIx = wrapSOLInstruction(
        user,
        userTokenY,
        BigInt(totalYAmount.toString())
      );

      preInstructions.push(...wrapSOLIx);
    }

    const postInstructions: Array<TransactionInstruction> = [];
    if (
      [
        this.tokenX.publicKey.toBase58(),
        this.tokenY.publicKey.toBase58(),
      ].includes(NATIVE_MINT.toBase58())
    ) {
      const closeWrappedSOLIx = await unwrapSOLInstruction(user);
      closeWrappedSOLIx && postInstructions.push(closeWrappedSOLIx);
    }

    const liquidityParams: LiquidityParameterByWeight = {
      amountX: totalXAmount,
      amountY: totalYAmount,
      binLiquidityDist,
      activeId,
      maxActiveBinSlippage,
    };

    const addLiquidityAccounts = {
      position: positionPubKey,
      lbPair: this.pubkey,
      userTokenX,
      userTokenY,
      reserveX: this.lbPair.reserveX,
      reserveY: this.lbPair.reserveY,
      tokenXMint: this.lbPair.tokenXMint,
      tokenYMint: this.lbPair.tokenYMint,
      binArrayLower,
      binArrayUpper,
      binArrayBitmapExtension,
      sender: user,
      tokenXProgram: TOKEN_PROGRAM_ID,
      tokenYProgram: TOKEN_PROGRAM_ID,
    };

    const oneSideLiquidityParams: LiquidityOneSideParameter = {
      amount: totalXAmount.isZero() ? totalYAmount : totalXAmount,
      activeId,
      maxActiveBinSlippage,
      binLiquidityDist,
    };

    const oneSideAddLiquidityAccounts = {
      binArrayLower,
      binArrayUpper,
      lbPair: this.pubkey,
      binArrayBitmapExtension: null,
      sender: user,
      position: positionPubKey,
      reserve: totalXAmount.isZero()
        ? this.lbPair.reserveY
        : this.lbPair.reserveX,
      tokenMint: totalXAmount.isZero()
        ? this.lbPair.tokenYMint
        : this.lbPair.tokenXMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      userToken: totalXAmount.isZero() ? userTokenY : userTokenX,
    };

    const isOneSideDeposit = totalXAmount.isZero() || totalYAmount.isZero();
    const programMethod = isOneSideDeposit
      ? this.program.methods.addLiquidityOneSide(oneSideLiquidityParams)
      : this.program.methods.addLiquidityByWeight(liquidityParams);

    if (xYAmountDistribution.length < MAX_BIN_LENGTH_ALLOWED_IN_ONE_TX) {
      const addLiqIx = await programMethod
        .accounts(
          isOneSideDeposit ? oneSideAddLiquidityAccounts : addLiquidityAccounts
        )
        .instruction();

      const instructions = [...preInstructions, addLiqIx, ...postInstructions];

      const setCUIx = await getEstimatedComputeUnitIxWithBuffer(
        this.program.provider.connection,
        instructions,
        user
      );

      instructions.unshift(setCUIx);

      const { blockhash, lastValidBlockHeight } =
        await this.program.provider.connection.getLatestBlockhash("confirmed");
      return new Transaction({
        blockhash,
        lastValidBlockHeight,
        feePayer: user,
      }).add(...instructions);
    }

    const addLiqIx = await programMethod
      .accounts(
        isOneSideDeposit ? oneSideAddLiquidityAccounts : addLiquidityAccounts
      )
      .instruction();

    const setCUIx = await getEstimatedComputeUnitIxWithBuffer(
      this.program.provider.connection,
      [addLiqIx],
      user
    );

    const mainInstructions = [setCUIx, addLiqIx];

    const transactions: Transaction[] = [];
    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");
    if (preInstructions.length) {
      const preInstructionsTx = new Transaction({
        blockhash,
        lastValidBlockHeight,
        feePayer: user,
      }).add(...preInstructions);
      transactions.push(preInstructionsTx);
    }

    const mainTx = new Transaction({
      blockhash,
      lastValidBlockHeight,
      feePayer: user,
    }).add(...mainInstructions);
    transactions.push(mainTx);

    if (postInstructions.length) {
      const postInstructionsTx = new Transaction({
        blockhash,
        lastValidBlockHeight,
        feePayer: user,
      }).add(...postInstructions);
      transactions.push(postInstructionsTx);
    }

    return transactions;
  }

  /**
   * The `removeLiquidity` function is used to remove liquidity from a position,
   * with the option to claim rewards and close the position.
   * @param
   *    - `user`: The public key of the user account.
   *    - `position`: The public key of the position account.
   *    - `fromBinId`: The ID of the starting bin to remove liquidity from. Must within position range.
   *    - `toBinId`: The ID of the ending bin to remove liquidity from. Must within position range.
   *    - `liquiditiesBpsToRemove`: An array of numbers (percentage) that represent the liquidity to remove from each bin.
   *    - `shouldClaimAndClose`: A boolean flag that indicates whether to claim rewards and close the position.
   * @returns {Promise<Transaction | Transaction[]>}
   */
  public async removeLiquidity({
    user,
    position,
    fromBinId,
    toBinId,
    bps,
    shouldClaimAndClose = false,
  }: {
    user: PublicKey;
    position: PublicKey;
    fromBinId: number;
    toBinId: number;
    bps: BN;
    shouldClaimAndClose?: boolean;
  }): Promise<Transaction | Transaction[]> {
    const positionAccount =
      await this.program.provider.connection.getAccountInfo(position);

    const positionState = wrapPosition(this.program, position, positionAccount);

    const lbPair = positionState.lbPair();
    const owner = positionState.owner();
    const feeOwner = positionState.feeOwner();
    const liquidityShares = positionState.liquidityShares();

    const liqudityShareWithBinId = liquidityShares.map((share, i) => {
      return {
        share,
        binId: positionState.lowerBinId().add(new BN(i)),
      };
    });

    const binIdsWithLiquidity = liqudityShareWithBinId.filter((bin) => {
      return !bin.share.isZero();
    });

    if (binIdsWithLiquidity.length == 0) {
      throw new Error("No liquidity to remove");
    }

    const lowerBinIdWithLiquidity = binIdsWithLiquidity[0].binId.toNumber();
    const upperBinIdWithLiquidity =
      binIdsWithLiquidity[binIdsWithLiquidity.length - 1].binId.toNumber();

    // Avoid to attempt to load uninitialized bin array on the program
    if (fromBinId < lowerBinIdWithLiquidity) {
      fromBinId = lowerBinIdWithLiquidity;
    }

    if (toBinId > upperBinIdWithLiquidity) {
      toBinId = upperBinIdWithLiquidity;
    }

    const { slices, accounts: transferHookAccounts } =
      this.getPotentialToken2022IxDataAndAccounts(ActionType.Liquidity);

    const binArrayAccountsMeta = getBinArrayAccountMetasCoverage(
      new BN(fromBinId),
      new BN(toBinId),
      this.pubkey,
      this.program.programId
    );

    const preInstructions: Array<TransactionInstruction> = [];

    const walletToReceiveFee = feeOwner.equals(PublicKey.default)
      ? user
      : feeOwner;

    const [
      { ataPubKey: userTokenX, ix: createPayerTokenXIx },
      { ataPubKey: userTokenY, ix: createPayerTokenYIx },
      { ataPubKey: feeOwnerTokenX, ix: createFeeOwnerTokenXIx },
      { ataPubKey: feeOwnerTokenY, ix: createFeeOwnerTokenYIx },
    ] = await Promise.all([
      getOrCreateATAInstruction(
        this.program.provider.connection,
        this.tokenX.publicKey,
        owner,
        this.tokenX.owner,
        user
      ),
      getOrCreateATAInstruction(
        this.program.provider.connection,
        this.tokenY.publicKey,
        owner,
        this.tokenY.owner,
        user
      ),
      getOrCreateATAInstruction(
        this.program.provider.connection,
        this.tokenX.publicKey,
        walletToReceiveFee,
        this.tokenX.owner,
        user
      ),
      getOrCreateATAInstruction(
        this.program.provider.connection,
        this.tokenY.publicKey,
        walletToReceiveFee,
        this.tokenY.owner,
        user
      ),
    ]);

    createPayerTokenXIx && preInstructions.push(createPayerTokenXIx);
    createPayerTokenYIx && preInstructions.push(createPayerTokenYIx);

    if (!walletToReceiveFee.equals(owner)) {
      createFeeOwnerTokenXIx && preInstructions.push(createFeeOwnerTokenXIx);
      createFeeOwnerTokenYIx && preInstructions.push(createFeeOwnerTokenYIx);
    }

    const secondTransactionsIx: TransactionInstruction[] = [];
    const postInstructions: Array<TransactionInstruction> = [];

    if (shouldClaimAndClose) {
      const claimSwapFeeIx = await this.program.methods
        .claimFee2(fromBinId, toBinId, {
          slices,
        })
        .accounts({
          lbPair: this.pubkey,
          sender: user,
          position,
          reserveX: this.lbPair.reserveX,
          reserveY: this.lbPair.reserveY,
          tokenXMint: this.tokenX.publicKey,
          tokenYMint: this.tokenY.publicKey,
          userTokenX: feeOwnerTokenX,
          userTokenY: feeOwnerTokenY,
          tokenProgramX: this.tokenX.owner,
          tokenProgramY: this.tokenY.owner,
          memoProgram: MEMO_PROGRAM_ID,
        })
        .remainingAccounts(transferHookAccounts)
        .remainingAccounts(binArrayAccountsMeta)
        .instruction();

      postInstructions.push(claimSwapFeeIx);

      for (let i = 0; i < 2; i++) {
        const rewardInfo = this.lbPair.rewardInfos[i];
        if (!rewardInfo || rewardInfo.mint.equals(PublicKey.default)) continue;

        const { ataPubKey, ix: rewardAtaIx } = await getOrCreateATAInstruction(
          this.program.provider.connection,
          rewardInfo.mint,
          user,
          this.rewards[i].owner
        );
        rewardAtaIx && preInstructions.push(rewardAtaIx);

        const { slices, accounts: transferHookAccounts } =
          this.getPotentialToken2022IxDataAndAccounts(ActionType.Reward, i);

        const claimRewardIx = await this.program.methods
          .claimReward2(new BN(i), fromBinId, toBinId, {
            slices,
          })
          .accounts({
            lbPair: this.pubkey,
            sender: user,
            position,
            rewardVault: rewardInfo.vault,
            rewardMint: rewardInfo.mint,
            tokenProgram: this.rewards[i].owner,
            userTokenAccount: ataPubKey,
            memoProgram: MEMO_PROGRAM_ID,
          })
          .remainingAccounts(transferHookAccounts)
          .remainingAccounts(binArrayAccountsMeta)
          .instruction();

        secondTransactionsIx.push(claimRewardIx);
      }

      const closePositionIx = await this.program.methods
        .closePositionIfEmpty()
        .accounts({
          rentReceiver: owner, // Must be position owner
          position,
          sender: user,
        })
        .instruction();

      if (secondTransactionsIx.length) {
        secondTransactionsIx.push(closePositionIx);
      } else {
        postInstructions.push(closePositionIx);
      }
    }

    if (
      [
        this.tokenX.publicKey.toBase58(),
        this.tokenY.publicKey.toBase58(),
      ].includes(NATIVE_MINT.toBase58())
    ) {
      const closeWrappedSOLIx = await unwrapSOLInstruction(user);
      closeWrappedSOLIx && postInstructions.push(closeWrappedSOLIx);
    }

    const binArrayBitmapExtension = this.binArrayBitmapExtension
      ? this.binArrayBitmapExtension.publicKey
      : this.program.programId;

    const removeLiquidityTx = await this.program.methods
      .removeLiquidityByRange2(fromBinId, toBinId, bps.toNumber(), {
        slices,
      })
      .accounts({
        position,
        lbPair,
        userTokenX,
        userTokenY,
        reserveX: this.lbPair.reserveX,
        reserveY: this.lbPair.reserveY,
        tokenXMint: this.tokenX.publicKey,
        tokenYMint: this.tokenY.publicKey,
        binArrayBitmapExtension,
        tokenXProgram: this.tokenX.owner,
        tokenYProgram: this.tokenY.owner,
        sender: user,
        memoProgram: MEMO_PROGRAM_ID,
      })
      .remainingAccounts(transferHookAccounts)
      .remainingAccounts(binArrayAccountsMeta)
      .instruction();

    const instructions = [
      ...preInstructions,
      removeLiquidityTx,
      ...postInstructions,
    ];

    const setCUIx = await getEstimatedComputeUnitIxWithBuffer(
      this.program.provider.connection,
      instructions,
      user
    );

    instructions.unshift(setCUIx);

    if (secondTransactionsIx.length) {
      const setCUIx = await getEstimatedComputeUnitIxWithBuffer(
        this.program.provider.connection,
        secondTransactionsIx,
        user
      );

      const { blockhash, lastValidBlockHeight } =
        await this.program.provider.connection.getLatestBlockhash("confirmed");

      const claimRewardsTx = new Transaction({
        blockhash,
        lastValidBlockHeight,
        feePayer: user,
      }).add(setCUIx, ...secondTransactionsIx);

      const mainTx = new Transaction({
        blockhash,
        lastValidBlockHeight,
        feePayer: user,
      }).add(...instructions);

      return [mainTx, claimRewardsTx];
    } else {
      const { blockhash, lastValidBlockHeight } =
        await this.program.provider.connection.getLatestBlockhash("confirmed");

      return new Transaction({
        blockhash,
        lastValidBlockHeight,
        feePayer: user,
      }).add(...instructions);
    }
  }

  /**
   * The `closePositionIfEmpty` function closes a position if it is empty. Else, it does nothing.
   */
  public async closePositionIfEmpty({
    owner,
    position,
  }: {
    owner: PublicKey;
    position: LbPosition;
  }): Promise<Transaction> {
    const closePositionIfEmptyIx = await this.program.methods
      .closePositionIfEmpty()
      .accounts({
        rentReceiver: owner,
        position: position.publicKey,
        sender: owner,
      })
      .instruction();

    const setCUIx = await getEstimatedComputeUnitIxWithBuffer(
      this.program.provider.connection,
      [closePositionIfEmptyIx],
      owner
    );

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");

    return new Transaction({
      blockhash,
      lastValidBlockHeight,
      feePayer: owner,
    }).add(setCUIx, closePositionIfEmptyIx);
  }

  /**
   * The `closePosition` function closes a position
   * @param
   *    - `owner`: The public key of the owner of the position.
   *    - `position`: The public key of the position account.
   * @returns {Promise<Transaction>}
   */
  public async closePosition({
    owner,
    position,
  }: {
    owner: PublicKey;
    position: LbPosition;
  }): Promise<Transaction> {
    const closePositionIx = await this.program.methods
      .closePosition2()
      .accounts({
        rentReceiver: owner,
        position: position.publicKey,
        sender: owner,
      })
      .instruction();

    const setCUIx = await getEstimatedComputeUnitIxWithBuffer(
      this.program.provider.connection,
      [closePositionIx],
      owner
    );

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");

    return new Transaction({
      blockhash,
      lastValidBlockHeight,
      feePayer: owner,
    }).add(setCUIx, closePositionIx);
  }

  /**
   * The `swapQuoteExactOut` function returns a quote for a swap
   * @param
   *    - `outAmount`: Amount of lamport to swap out
   *    - `swapForY`: Swap token X to Y when it is true, else reversed.
   *    - `allowedSlippage`: Allowed slippage for the swap. Expressed in BPS. To convert from slippage percentage to BPS unit: SLIPPAGE_PERCENTAGE * 100
   *    - `maxExtraBinArrays`: Maximum number of extra binArrays to return
   * @returns {SwapQuote}
   *    - `inAmount`: Amount of lamport to swap in
   *    - `outAmount`: Amount of lamport to swap out
   *    - `fee`: Fee amount
   *    - `protocolFee`: Protocol fee amount
   *    - `maxInAmount`: Maximum amount of lamport to swap in
   *    - `binArraysPubkey`: Array of bin arrays involved in the swap
   * @throws {DlmmSdkError}
   *
   */
  public swapQuoteExactOut(
    outAmount: BN,
    swapForY: boolean,
    allowedSlippage: BN,
    binArrays: BinArrayAccount[],
    maxExtraBinArrays: number = 0
  ): SwapQuoteExactOut {
    const currentTimestamp = Date.now() / 1000;

    const [inMint, outMint] = swapForY
      ? [this.tokenX.mint, this.tokenY.mint]
      : [this.tokenY.mint, this.tokenX.mint];

    let outAmountLeft = calculateTransferFeeIncludedAmount(
      outAmount,
      outMint,
      this.clock.epoch.toNumber()
    ).amount;

    if (maxExtraBinArrays < 0 || maxExtraBinArrays > MAX_EXTRA_BIN_ARRAYS) {
      throw new DlmmSdkError(
        "INVALID_MAX_EXTRA_BIN_ARRAYS",
        `maxExtraBinArrays must be a value between 0 and ${MAX_EXTRA_BIN_ARRAYS}`
      );
    }

    let vParameterClone = Object.assign({}, this.lbPair.vParameters);
    let activeId = new BN(this.lbPair.activeId);

    const binStep = this.lbPair.binStep;
    const sParameters = this.lbPair.parameters;

    this.updateReference(
      activeId.toNumber(),
      vParameterClone,
      sParameters,
      currentTimestamp
    );

    let startBinId = activeId;
    let binArraysForSwap = new Map();
    let actualInAmount: BN = new BN(0);
    let feeAmount: BN = new BN(0);
    let protocolFeeAmount: BN = new BN(0);

    while (!outAmountLeft.isZero()) {
      let binArrayAccountToSwap = findNextBinArrayWithLiquidity(
        swapForY,
        activeId,
        this.lbPair,
        this.binArrayBitmapExtension?.account ?? null,
        binArrays
      );

      if (binArrayAccountToSwap == null) {
        throw new DlmmSdkError(
          "SWAP_QUOTE_INSUFFICIENT_LIQUIDITY",
          "Insufficient liquidity in binArrays"
        );
      }

      binArraysForSwap.set(binArrayAccountToSwap.publicKey, true);

      this.updateVolatilityAccumulator(
        vParameterClone,
        sParameters,
        activeId.toNumber()
      );

      if (
        isBinIdWithinBinArray(activeId, binArrayAccountToSwap.account.index)
      ) {
        const bin = getBinFromBinArray(
          activeId.toNumber(),
          binArrayAccountToSwap.account
        );
        const { amountIn, amountOut, fee, protocolFee } =
          swapExactOutQuoteAtBin(
            bin,
            binStep,
            sParameters,
            vParameterClone,
            outAmountLeft,
            swapForY
          );

        if (!amountOut.isZero()) {
          outAmountLeft = outAmountLeft.sub(amountOut);
          actualInAmount = actualInAmount.add(amountIn);
          feeAmount = feeAmount.add(fee);
          protocolFeeAmount = protocolFee.add(protocolFee);
        }
      }

      if (!outAmountLeft.isZero()) {
        if (swapForY) {
          activeId = activeId.sub(new BN(1));
        } else {
          activeId = activeId.add(new BN(1));
        }
      }
    }

    const startPrice = getPriceOfBinByBinId(
      startBinId.toNumber(),
      this.lbPair.binStep
    );
    const endPrice = getPriceOfBinByBinId(
      activeId.toNumber(),
      this.lbPair.binStep
    );

    const priceImpact = startPrice
      .sub(endPrice)
      .abs()
      .div(startPrice)
      .mul(new Decimal(100));

    actualInAmount = calculateTransferFeeIncludedAmount(
      actualInAmount.add(feeAmount),
      inMint,
      this.clock.epoch.toNumber()
    ).amount;

    const maxInAmount = actualInAmount
      .mul(new BN(BASIS_POINT_MAX).add(allowedSlippage))
      .div(new BN(BASIS_POINT_MAX));

    if (maxExtraBinArrays > 0 && maxExtraBinArrays <= MAX_EXTRA_BIN_ARRAYS) {
      const extraBinArrays: Array<PublicKey> = new Array<PublicKey>();

      while (extraBinArrays.length < maxExtraBinArrays) {
        let binArrayAccountToSwap = findNextBinArrayWithLiquidity(
          swapForY,
          activeId,
          this.lbPair,
          this.binArrayBitmapExtension?.account ?? null,
          binArrays
        );

        if (binArrayAccountToSwap == null) {
          break;
        }

        const binArrayAccountToSwapExisted = binArraysForSwap.has(
          binArrayAccountToSwap.publicKey
        );

        if (binArrayAccountToSwapExisted) {
          if (swapForY) {
            activeId = activeId.sub(new BN(1));
          } else {
            activeId = activeId.add(new BN(1));
          }
        } else {
          extraBinArrays.push(binArrayAccountToSwap.publicKey);
          const [lowerBinId, upperBinId] = getBinArrayLowerUpperBinId(
            binArrayAccountToSwap.account.index
          );

          if (swapForY) {
            activeId = lowerBinId.sub(new BN(1));
          } else {
            activeId = upperBinId.add(new BN(1));
          }
        }
      }

      // save to binArraysForSwap result
      extraBinArrays.forEach((binArrayPubkey) => {
        binArraysForSwap.set(binArrayPubkey, true);
      });
    }

    const binArraysPubkey = Array.from(binArraysForSwap.keys());

    return {
      inAmount: actualInAmount,
      maxInAmount,
      outAmount,
      priceImpact,
      fee: feeAmount,
      protocolFee: protocolFeeAmount,
      binArraysPubkey,
    };
  }

  /**
   * The `swapQuote` function returns a quote for a swap
   * @param
   *    - `inAmount`: Amount of lamport to swap in
   *    - `swapForY`: Swap token X to Y when it is true, else reversed.
   *    - `allowedSlippage`: Allowed slippage for the swap. Expressed in BPS. To convert from slippage percentage to BPS unit: SLIPPAGE_PERCENTAGE * 100
   *    - `binArrays`: binArrays for swapQuote.
   *    - `isPartialFill`: Flag to check whether the the swapQuote is partial fill, default = false.
   *    - `maxExtraBinArrays`: Maximum number of extra binArrays to return
   * @returns {SwapQuote}
   *    - `consumedInAmount`: Amount of lamport to swap in
   *    - `outAmount`: Amount of lamport to swap out
   *    - `fee`: Fee amount
   *    - `protocolFee`: Protocol fee amount
   *    - `minOutAmount`: Minimum amount of lamport to swap out
   *    - `priceImpact`: Price impact of the swap
   *    - `binArraysPubkey`: Array of bin arrays involved in the swap
   * @throws {DlmmSdkError}
   */
  public swapQuote(
    inAmount: BN,
    swapForY: boolean,
    allowedSlippage: BN,
    binArrays: BinArrayAccount[],
    isPartialFill?: boolean,
    maxExtraBinArrays: number = 0
  ): SwapQuote {
    const currentTimestamp = Date.now() / 1000;

    if (maxExtraBinArrays < 0 || maxExtraBinArrays > MAX_EXTRA_BIN_ARRAYS) {
      throw new DlmmSdkError(
        "INVALID_MAX_EXTRA_BIN_ARRAYS",
        `maxExtraBinArrays must be a value between 0 and ${MAX_EXTRA_BIN_ARRAYS}`
      );
    }

    const [inMint, outMint] = swapForY
      ? [this.tokenX.mint, this.tokenY.mint]
      : [this.tokenY.mint, this.tokenX.mint];

    let transferFeeExcludedAmountIn = calculateTransferFeeExcludedAmount(
      inAmount,
      inMint,
      this.clock.epoch.toNumber()
    ).amount;

    let inAmountLeft = transferFeeExcludedAmountIn;

    let vParameterClone = Object.assign({}, this.lbPair.vParameters);
    let activeId = new BN(this.lbPair.activeId);

    const binStep = this.lbPair.binStep;
    const sParameters = this.lbPair.parameters;

    this.updateReference(
      activeId.toNumber(),
      vParameterClone,
      sParameters,
      currentTimestamp
    );

    let startBin: Bin | null = null;
    let binArraysForSwap = new Map();
    let totalOutAmount: BN = new BN(0);
    let feeAmount: BN = new BN(0);
    let protocolFeeAmount: BN = new BN(0);
    let lastFilledActiveBinId = activeId;

    while (!inAmountLeft.isZero()) {
      let binArrayAccountToSwap = findNextBinArrayWithLiquidity(
        swapForY,
        activeId,
        this.lbPair,
        this.binArrayBitmapExtension?.account ?? null,
        binArrays
      );

      if (binArrayAccountToSwap == null) {
        if (isPartialFill) {
          break;
        } else {
          throw new DlmmSdkError(
            "SWAP_QUOTE_INSUFFICIENT_LIQUIDITY",
            "Insufficient liquidity in binArrays for swapQuote"
          );
        }
      }

      binArraysForSwap.set(binArrayAccountToSwap.publicKey, true);

      this.updateVolatilityAccumulator(
        vParameterClone,
        sParameters,
        activeId.toNumber()
      );

      if (
        isBinIdWithinBinArray(activeId, binArrayAccountToSwap.account.index)
      ) {
        const bin = getBinFromBinArray(
          activeId.toNumber(),
          binArrayAccountToSwap.account
        );
        const { amountIn, amountOut, fee, protocolFee } = swapExactInQuoteAtBin(
          bin,
          binStep,
          sParameters,
          vParameterClone,
          inAmountLeft,
          swapForY
        );

        if (!amountIn.isZero()) {
          inAmountLeft = inAmountLeft.sub(amountIn);
          totalOutAmount = totalOutAmount.add(amountOut);
          feeAmount = feeAmount.add(fee);
          protocolFeeAmount = protocolFee.add(protocolFee);

          if (!startBin) {
            startBin = bin;
          }

          lastFilledActiveBinId = activeId;
        }
      }

      if (!inAmountLeft.isZero()) {
        if (swapForY) {
          activeId = activeId.sub(new BN(1));
        } else {
          activeId = activeId.add(new BN(1));
        }
      }
    }

    if (!startBin) {
      // The pool insufficient liquidity
      throw new DlmmSdkError(
        "SWAP_QUOTE_INSUFFICIENT_LIQUIDITY",
        "Insufficient liquidity"
      );
    }

    const actualInAmount = transferFeeExcludedAmountIn.sub(inAmountLeft);

    let transferFeeIncludedInAmount = calculateTransferFeeIncludedAmount(
      actualInAmount,
      inMint,
      this.clock.epoch.toNumber()
    ).amount;

    transferFeeIncludedInAmount = transferFeeIncludedInAmount.gt(inAmount)
      ? inAmount
      : transferFeeIncludedInAmount;

    const outAmountWithoutSlippage = getOutAmount(
      startBin,
      actualInAmount.sub(
        computeFeeFromAmount(
          binStep,
          sParameters,
          vParameterClone,
          actualInAmount
        )
      ),
      swapForY
    );

    const priceImpact = new Decimal(totalOutAmount.toString())
      .sub(new Decimal(outAmountWithoutSlippage.toString()))
      .div(new Decimal(outAmountWithoutSlippage.toString()))
      .mul(new Decimal(100));

    const endPrice = getPriceOfBinByBinId(
      lastFilledActiveBinId.toNumber(),
      this.lbPair.binStep
    );

    if (maxExtraBinArrays > 0 && maxExtraBinArrays <= MAX_EXTRA_BIN_ARRAYS) {
      const extraBinArrays: Array<PublicKey> = new Array<PublicKey>();

      while (extraBinArrays.length < maxExtraBinArrays) {
        let binArrayAccountToSwap = findNextBinArrayWithLiquidity(
          swapForY,
          activeId,
          this.lbPair,
          this.binArrayBitmapExtension?.account ?? null,
          binArrays
        );

        if (binArrayAccountToSwap == null) {
          break;
        }

        const binArrayAccountToSwapExisted = binArraysForSwap.has(
          binArrayAccountToSwap.publicKey
        );

        if (binArrayAccountToSwapExisted) {
          if (swapForY) {
            activeId = activeId.sub(new BN(1));
          } else {
            activeId = activeId.add(new BN(1));
          }
        } else {
          extraBinArrays.push(binArrayAccountToSwap.publicKey);
          const [lowerBinId, upperBinId] = getBinArrayLowerUpperBinId(
            binArrayAccountToSwap.account.index
          );

          if (swapForY) {
            activeId = lowerBinId.sub(new BN(1));
          } else {
            activeId = upperBinId.add(new BN(1));
          }
        }
      }

      // save to binArraysForSwap result
      extraBinArrays.forEach((binArrayPubkey) => {
        binArraysForSwap.set(binArrayPubkey, true);
      });
    }

    const binArraysPubkey = Array.from(binArraysForSwap.keys());
    const transferFeeExcludedAmountOut = calculateTransferFeeExcludedAmount(
      totalOutAmount,
      outMint,
      this.clock.epoch.toNumber()
    ).amount;

    const minOutAmount = transferFeeExcludedAmountOut
      .mul(new BN(BASIS_POINT_MAX).sub(allowedSlippage))
      .div(new BN(BASIS_POINT_MAX));

    return {
      consumedInAmount: transferFeeIncludedInAmount,
      outAmount: transferFeeExcludedAmountOut,
      fee: feeAmount,
      protocolFee: protocolFeeAmount,
      minOutAmount,
      priceImpact,
      binArraysPubkey,
      endPrice,
    };
  }

  public async swapExactOut({
    inToken,
    outToken,
    outAmount,
    maxInAmount,
    lbPair,
    user,
    binArraysPubkey,
  }: SwapExactOutParams): Promise<Transaction> {
    const preInstructions: TransactionInstruction[] = [];
    const postInstructions: Array<TransactionInstruction> = [];

    const [inTokenProgram, outTokenProgram] = inToken.equals(
      this.lbPair.tokenXMint
    )
      ? [this.tokenX.owner, this.tokenY.owner]
      : [this.tokenY.owner, this.tokenX.owner];

    const [
      { ataPubKey: userTokenIn, ix: createInTokenAccountIx },
      { ataPubKey: userTokenOut, ix: createOutTokenAccountIx },
    ] = await Promise.all([
      getOrCreateATAInstruction(
        this.program.provider.connection,
        inToken,
        user,
        inTokenProgram
      ),
      getOrCreateATAInstruction(
        this.program.provider.connection,
        outToken,
        user,
        outTokenProgram
      ),
    ]);
    createInTokenAccountIx && preInstructions.push(createInTokenAccountIx);
    createOutTokenAccountIx && preInstructions.push(createOutTokenAccountIx);

    if (inToken.equals(NATIVE_MINT)) {
      const wrapSOLIx = wrapSOLInstruction(
        user,
        userTokenIn,
        BigInt(maxInAmount.toString())
      );

      preInstructions.push(...wrapSOLIx);
      const closeWrappedSOLIx = await unwrapSOLInstruction(user);
      closeWrappedSOLIx && postInstructions.push(closeWrappedSOLIx);
    }

    if (outToken.equals(NATIVE_MINT)) {
      const closeWrappedSOLIx = await unwrapSOLInstruction(user);
      closeWrappedSOLIx && postInstructions.push(closeWrappedSOLIx);
    }

    const { slices, accounts: transferHookAccounts } =
      this.getPotentialToken2022IxDataAndAccounts(ActionType.Liquidity);

    const binArrays: AccountMeta[] = binArraysPubkey.map((pubkey) => {
      return {
        isSigner: false,
        isWritable: true,
        pubkey,
      };
    });

    const swapIx = await this.program.methods
      .swapExactOut2(maxInAmount, outAmount, { slices })
      .accounts({
        lbPair,
        reserveX: this.lbPair.reserveX,
        reserveY: this.lbPair.reserveY,
        tokenXMint: this.lbPair.tokenXMint,
        tokenYMint: this.lbPair.tokenYMint,
        tokenXProgram: this.tokenX.owner,
        tokenYProgram: this.tokenY.owner,
        user,
        userTokenIn,
        userTokenOut,
        binArrayBitmapExtension: this.binArrayBitmapExtension
          ? this.binArrayBitmapExtension.publicKey
          : null,
        oracle: this.lbPair.oracle,
        hostFeeIn: null,
        memoProgram: MEMO_PROGRAM_ID,
      })
      .remainingAccounts(transferHookAccounts)
      .remainingAccounts(binArrays)
      .instruction();

    const instructions = [...preInstructions, swapIx, ...postInstructions];

    // const setCUIx = await getEstimatedComputeUnitIxWithBuffer(
    //   this.program.provider.connection,
    //   instructions,
    //   user
    // );

    // instructions.unshift(setCUIx);

    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: 1_400_000,
      })
    );

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");
    return new Transaction({
      blockhash,
      lastValidBlockHeight,
      feePayer: user,
    }).add(...instructions);
  }

  /**
   * Returns a transaction to be signed and sent by user performing swap.
   * @param {SwapWithPriceImpactParams}
   *    - `inToken`: The public key of the token to be swapped in.
   *    - `outToken`: The public key of the token to be swapped out.
   *    - `inAmount`: The amount of token to be swapped in.
   *    - `priceImpact`: Accepted price impact bps.
   *    - `lbPair`: The public key of the liquidity pool.
   *    - `user`: The public key of the user account.
   *    - `binArraysPubkey`: Array of bin arrays involved in the swap
   * @returns {Promise<Transaction>}
   */
  public async swapWithPriceImpact({
    inToken,
    outToken,
    inAmount,
    lbPair,
    user,
    priceImpact,
    binArraysPubkey,
  }: SwapWithPriceImpactParams): Promise<Transaction> {
    const preInstructions: TransactionInstruction[] = [];
    const postInstructions: Array<TransactionInstruction> = [];

    const [
      { ataPubKey: userTokenIn, ix: createInTokenAccountIx },
      { ataPubKey: userTokenOut, ix: createOutTokenAccountIx },
    ] = await Promise.all([
      getOrCreateATAInstruction(
        this.program.provider.connection,
        inToken,
        user,
        this.tokenX.owner
      ),
      getOrCreateATAInstruction(
        this.program.provider.connection,
        outToken,
        user,
        this.tokenY.owner
      ),
    ]);
    createInTokenAccountIx && preInstructions.push(createInTokenAccountIx);
    createOutTokenAccountIx && preInstructions.push(createOutTokenAccountIx);

    if (inToken.equals(NATIVE_MINT)) {
      const wrapSOLIx = wrapSOLInstruction(
        user,
        userTokenIn,
        BigInt(inAmount.toString())
      );

      preInstructions.push(...wrapSOLIx);
      const closeWrappedSOLIx = await unwrapSOLInstruction(user);
      closeWrappedSOLIx && postInstructions.push(closeWrappedSOLIx);
    }

    if (outToken.equals(NATIVE_MINT)) {
      const closeWrappedSOLIx = await unwrapSOLInstruction(user);
      closeWrappedSOLIx && postInstructions.push(closeWrappedSOLIx);
    }

    // TODO: needs some refinement in case binArray not yet initialized
    const binArrays: AccountMeta[] = binArraysPubkey.map((pubkey) => {
      return {
        isSigner: false,
        isWritable: true,
        pubkey,
      };
    });

    const { slices, accounts: transferHookAccounts } =
      this.getPotentialToken2022IxDataAndAccounts(ActionType.Liquidity);

    const swapIx = await this.program.methods
      .swapWithPriceImpact2(
        inAmount,
        this.lbPair.activeId,
        priceImpact.toNumber(),
        { slices }
      )
      .accounts({
        lbPair,
        reserveX: this.lbPair.reserveX,
        reserveY: this.lbPair.reserveY,
        tokenXMint: this.lbPair.tokenXMint,
        tokenYMint: this.lbPair.tokenYMint,
        tokenXProgram: this.tokenX.owner,
        tokenYProgram: this.tokenY.owner,
        user,
        userTokenIn,
        userTokenOut,
        binArrayBitmapExtension: this.binArrayBitmapExtension
          ? this.binArrayBitmapExtension.publicKey
          : null,
        oracle: this.lbPair.oracle,
        hostFeeIn: null,
        memoProgram: MEMO_PROGRAM_ID,
      })
      .remainingAccounts(transferHookAccounts)
      .remainingAccounts(binArrays)
      .instruction();

    const instructions = [...preInstructions, swapIx, ...postInstructions];

    const setCUIx = await getEstimatedComputeUnitIxWithBuffer(
      this.program.provider.connection,
      instructions,
      user
    );

    instructions.unshift(setCUIx);

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");
    return new Transaction({
      blockhash,
      lastValidBlockHeight,
      feePayer: user,
    }).add(...instructions);
  }

  /**
   * Returns a transaction to be signed and sent by user performing swap.
   * @param {SwapParams}
   *    - `inToken`: The public key of the token to be swapped in.
   *    - `outToken`: The public key of the token to be swapped out.
   *    - `inAmount`: The amount of token to be swapped in.
   *    - `minOutAmount`: The minimum amount of token to be swapped out.
   *    - `lbPair`: The public key of the liquidity pool.
   *    - `user`: The public key of the user account.
   *    - `binArraysPubkey`: Array of bin arrays involved in the swap
   * @returns {Promise<Transaction>}
   */
  public async swap({
    inToken,
    outToken,
    inAmount,
    minOutAmount,
    lbPair,
    user,
    binArraysPubkey,
  }: SwapParams): Promise<Transaction> {
    const preInstructions: TransactionInstruction[] = [];
    const postInstructions: Array<TransactionInstruction> = [];

    const [inTokenProgram, outTokenProgram] = inToken.equals(
      this.lbPair.tokenXMint
    )
      ? [this.tokenX.owner, this.tokenY.owner]
      : [this.tokenY.owner, this.tokenX.owner];

    const [
      { ataPubKey: userTokenIn, ix: createInTokenAccountIx },
      { ataPubKey: userTokenOut, ix: createOutTokenAccountIx },
    ] = await Promise.all([
      getOrCreateATAInstruction(
        this.program.provider.connection,
        inToken,
        user,
        inTokenProgram
      ),
      getOrCreateATAInstruction(
        this.program.provider.connection,
        outToken,
        user,
        outTokenProgram
      ),
    ]);
    createInTokenAccountIx && preInstructions.push(createInTokenAccountIx);
    createOutTokenAccountIx && preInstructions.push(createOutTokenAccountIx);

    if (inToken.equals(NATIVE_MINT)) {
      const wrapSOLIx = wrapSOLInstruction(
        user,
        userTokenIn,
        BigInt(inAmount.toString())
      );

      preInstructions.push(...wrapSOLIx);
      const closeWrappedSOLIx = await unwrapSOLInstruction(user);
      closeWrappedSOLIx && postInstructions.push(closeWrappedSOLIx);
    }

    if (outToken.equals(NATIVE_MINT)) {
      const closeWrappedSOLIx = await unwrapSOLInstruction(user);
      closeWrappedSOLIx && postInstructions.push(closeWrappedSOLIx);
    }

    // TODO: needs some refinement in case binArray not yet initialized
    const binArrays: AccountMeta[] = binArraysPubkey.map((pubkey) => {
      return {
        isSigner: false,
        isWritable: true,
        pubkey,
      };
    });

    const { slices, accounts: transferHookAccounts } =
      this.getPotentialToken2022IxDataAndAccounts(ActionType.Liquidity);

    const swapIx = await this.program.methods
      .swap2(inAmount, minOutAmount, { slices })
      .accounts({
        lbPair,
        reserveX: this.lbPair.reserveX,
        reserveY: this.lbPair.reserveY,
        tokenXMint: this.lbPair.tokenXMint,
        tokenYMint: this.lbPair.tokenYMint,
        tokenXProgram: this.tokenX.owner,
        tokenYProgram: this.tokenY.owner,
        user,
        userTokenIn,
        userTokenOut,
        binArrayBitmapExtension: this.binArrayBitmapExtension
          ? this.binArrayBitmapExtension.publicKey
          : null,
        oracle: this.lbPair.oracle,
        hostFeeIn: null,
        memoProgram: MEMO_PROGRAM_ID,
      })
      .remainingAccounts(transferHookAccounts)
      .remainingAccounts(binArrays)
      .instruction();

    const instructions = [...preInstructions, swapIx, ...postInstructions];

    const setCUIx = await getEstimatedComputeUnitIxWithBuffer(
      this.program.provider.connection,
      instructions,
      user
    );

    instructions.unshift(setCUIx);

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");
    return new Transaction({
      blockhash,
      lastValidBlockHeight,
      feePayer: user,
    }).add(...instructions);
  }

  /**
   * The claimLMReward function is used to claim rewards for a specific position owned by a specific owner.
   * @param
   *    - `owner`: The public key of the owner of the position.
   *    - `position`: The public key of the position account.
   * @returns {Promise<Transaction>} Claim LM reward transactions.
   */
  public async claimLMReward({
    owner,
    position,
  }: {
    owner: PublicKey;
    position: LbPosition;
  }): Promise<Transaction> {
    if (isPositionNoReward(position.positionData)) {
      throw new Error("No LM reward to claim");
    }

    const claimTransactions = await this.createClaimBuildMethod({
      owner,
      position,
    });
    if (!claimTransactions.length) return;

    const instructions = claimTransactions.map((t) => t.instructions).flat();

    const setCUIx = await getEstimatedComputeUnitIxWithBuffer(
      this.program.provider.connection,
      instructions,
      owner
    );

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");

    return new Transaction({
      blockhash,
      lastValidBlockHeight,
      feePayer: owner,
    }).add(setCUIx, ...claimTransactions);
  }

  /**
   * The `claimAllLMRewards` function is used to claim all liquidity mining rewards for a given owner
   * and their positions.
   * @param
   *    - `owner`: The public key of the owner of the positions.
   *    - `positions`: An array of objects of type `PositionData` that represents the positions to claim rewards from.
   * @returns {Promise<Transaction[]>} Array of claim LM reward and fees transactions.
   */
  public async claimAllLMRewards({
    owner,
    positions,
  }: {
    owner: PublicKey;
    positions: LbPosition[];
  }): Promise<Transaction[]> {
    if (
      positions.every((position) => isPositionNoReward(position.positionData))
    ) {
      throw new Error("No LM reward to claim");
    }

    const claimAllTxs = (
      await Promise.all(
        positions
          .filter(
            ({ positionData: { rewardOne, rewardTwo } }) =>
              !rewardOne.isZero() || !rewardTwo.isZero()
          )
          .map(async (position, idx) => {
            return await this.createClaimBuildMethod({
              owner,
              position,
            });
          })
      )
    ).flat();

    const chunkedClaimAllTx = chunks(claimAllTxs, MAX_CLAIM_ALL_ALLOWED);

    if (chunkedClaimAllTx.length === 0) return [];

    const chunkedClaimAllTxIx = await Promise.all(
      chunkedClaimAllTx.map(async (txs) => {
        const ixs = txs.map((t) => t.instructions).flat();
        const setCUIx = await getEstimatedComputeUnitIxWithBuffer(
          this.program.provider.connection,
          ixs,
          owner
        );

        return [setCUIx, ...ixs];
      })
    );

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");

    return Promise.all(
      chunkedClaimAllTxIx.map(async (claimAllTx) => {
        return new Transaction({
          feePayer: owner,
          blockhash,
          lastValidBlockHeight,
        }).add(...claimAllTx);
      })
    );
  }

  public async setActivationPoint(activationPoint: BN) {
    const setActivationPointTx = await this.program.methods
      .setActivationPoint(activationPoint)
      .accounts({
        lbPair: this.pubkey,
        admin: this.lbPair.creator,
      })
      .transaction();

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");

    return new Transaction({
      feePayer: this.lbPair.creator,
      blockhash,
      lastValidBlockHeight,
    }).add(setActivationPointTx);
  }

  public async setPairStatus(enabled: boolean): Promise<Transaction> {
    const pairStatus = enabled ? 0 : 1;
    const tx = await this.program.methods
      .setPairStatus(pairStatus)
      .accounts({
        lbPair: this.pubkey,
        admin: this.lbPair.creator,
      })
      .transaction();

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");

    return new Transaction({
      feePayer: this.lbPair.creator,
      blockhash,
      lastValidBlockHeight,
    }).add(tx);
  }

  /**
   * The function `claimSwapFee` is used to claim swap fees for a specific position owned by a specific owner.
   * @param
   *    - `owner`: The public key of the owner of the position.
   *    - `position`: The public key of the position account.
   *    - `binRange`: The bin range to claim swap fees for. If not provided, the function claim swap fees for full range.
   * @returns {Promise<Transaction>} Claim swap fee transactions.
   */
  public async claimSwapFee({
    owner,
    position,
  }: {
    owner: PublicKey;
    position: LbPosition;
  }): Promise<Transaction | null> {
    if (isPositionNoFee(position.positionData)) {
      throw new Error("No fee to claim");
    }

    const claimFeeTx = await this.createClaimSwapFeeMethod({ owner, position });

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");

    const setCUIx = await getEstimatedComputeUnitIxWithBuffer(
      this.program.provider.connection,
      claimFeeTx.instructions,
      owner
    );

    return new Transaction({
      blockhash,
      lastValidBlockHeight,
      feePayer: owner,
    }).add(setCUIx, ...claimFeeTx.instructions);
  }

  /**
   * The `claimAllSwapFee` function to claim swap fees for multiple positions owned by a specific owner.
   * @param
   *    - `owner`: The public key of the owner of the positions.
   *    - `positions`: An array of objects of type `PositionData` that represents the positions to claim swap fees from.
   * @returns {Promise<Transaction[]>} Array of claim swap fee transactions.
   */
  public async claimAllSwapFee({
    owner,
    positions,
  }: {
    owner: PublicKey;
    positions: LbPosition[];
  }): Promise<Transaction[]> {
    if (positions.every((position) => isPositionNoFee(position.positionData))) {
      throw new Error("No fee to claim");
    }

    const claimAllTxs = (
      await Promise.all(
        positions
          .filter(
            ({ positionData: { feeX, feeY } }) =>
              !feeX.isZero() || !feeY.isZero()
          )
          .map(async (position) => {
            return await this.createClaimSwapFeeMethod({
              owner,
              position,
            });
          })
      )
    ).flat();

    const chunkedClaimAllTx = chunks(claimAllTxs, MAX_CLAIM_ALL_ALLOWED);

    if (chunkedClaimAllTx.length === 0) return [];

    const chunkedClaimAllTxIxs = await Promise.all(
      chunkedClaimAllTx.map(async (tx) => {
        const ixs = tx.map((t) => t.instructions).flat();

        const setCUIx = await getEstimatedComputeUnitIxWithBuffer(
          this.program.provider.connection,
          ixs,
          owner
        );

        return [setCUIx, ...ixs];
      })
    );

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");

    return Promise.all(
      chunkedClaimAllTxIxs.map(async (claimAllTx) => {
        return new Transaction({
          feePayer: owner,
          blockhash,
          lastValidBlockHeight,
        }).add(...claimAllTx);
      })
    );
  }

  /**
   * The function `claimAllRewardsByPosition` allows a user to claim all rewards for a specific
   * position.
   * @param
   *    - `owner`: The public key of the owner of the position.
   *    - `position`: The public key of the position account.
   * @returns {Promise<Transaction[]>} Array of claim reward transactions.
   */
  public async claimAllRewardsByPosition({
    owner,
    position,
  }: {
    owner: PublicKey;
    position: LbPosition;
  }): Promise<Transaction[]> {
    if (
      isPositionNoFee(position.positionData) &&
      isPositionNoReward(position.positionData)
    ) {
      throw new Error("No fee/reward to claim");
    }

    const claimAllSwapFeeTxs = await this.createClaimSwapFeeMethod({
      owner,
      position,
    });

    const claimAllLMTxs = await this.createClaimBuildMethod({
      owner,
      position,
    });

    const claimAllTxs = chunks(
      [claimAllSwapFeeTxs, ...claimAllLMTxs],
      MAX_CLAIM_ALL_ALLOWED
    );

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");

    return Promise.all(
      claimAllTxs.map(async (claimAllTx) => {
        const instructions = claimAllTx.map((t) => t.instructions).flat();

        const setCUIx = await getEstimatedComputeUnitIxWithBuffer(
          this.program.provider.connection,
          instructions,
          owner
        );

        const tx = new Transaction({
          feePayer: owner,
          blockhash,
          lastValidBlockHeight,
        }).add(setCUIx, ...instructions);

        return tx;
      })
    );
  }

  /**
   * The `seedLiquidity` function create multiple grouped instructions. The grouped instructions will be [init ata + send lamport for token provde], [initialize bin array + initialize position instructions] and [deposit instruction]. Each grouped instructions can be executed parallelly.
   * @param
   *    - `owner`: The public key of the positions owner.
   *    - `seedAmount`: Lamport amount to be seeded to the pool.
   *    - `minPrice`: Start price in UI format
   *    - `maxPrice`: End price in UI format
   *    - `base`: Base key
   *    - `txPayer`: Account rental fee payer
   *    - `feeOwner`: Fee owner key. Default to position owner
   *    - `operator`: Operator key
   *    - `lockReleasePoint`: Timelock. Point (slot/timestamp) the position can withdraw the liquidity,
   *    - `shouldSeedPositionOwner` (optional): Whether to send 1 lamport amount of token X to the position owner to prove ownership.
   * @returns {Promise<SeedLiquidityResponse>}
   */
  public async seedLiquidity(
    owner: PublicKey,
    seedAmount: BN,
    curvature: number,
    minPrice: number,
    maxPrice: number,
    base: PublicKey,
    payer: PublicKey,
    feeOwner: PublicKey,
    operator: PublicKey,
    lockReleasePoint: BN,
    shouldSeedPositionOwner: boolean = false
  ): Promise<SeedLiquidityResponse> {
    let tokenOwnerProveAssociatedTokenAccountLamports = new BN(0);
    let totalPositionCount = new BN(0);
    let totalPositionLamports = new BN(0);
    let totalBinArraysCount = new BN(0);
    let totalBinArraysLamports = new BN(0);
    let binArrayBitmapLamports = new BN(0);

    const toLamportMultiplier = new Decimal(
      10 ** (this.tokenY.mint.decimals - this.tokenX.mint.decimals)
    );

    const minPricePerLamport = new Decimal(minPrice).mul(toLamportMultiplier);
    const maxPricePerLamport = new Decimal(maxPrice).mul(toLamportMultiplier);

    const minBinId = new BN(
      DLMM.getBinIdFromPrice(minPricePerLamport, this.lbPair.binStep, false)
    );

    const maxBinId = new BN(
      DLMM.getBinIdFromPrice(maxPricePerLamport, this.lbPair.binStep, true)
    );

    if (minBinId.toNumber() < this.lbPair.activeId) {
      throw new Error("minPrice < current pair price");
    }

    if (minBinId.toNumber() >= maxBinId.toNumber()) {
      throw new Error("Price range too small");
    }

    // Generate amount for each bin
    const k = 1.0 / curvature;

    const binDepositAmount = generateAmountForBinRange(
      seedAmount,
      this.lbPair.binStep,
      this.tokenX.mint.decimals,
      this.tokenY.mint.decimals,
      minBinId,
      maxBinId,
      k
    );

    const decompressMultiplier = findOptimumDecompressMultiplier(
      binDepositAmount,
      new BN(this.tokenX.mint.decimals)
    );

    let { compressedBinAmount, compressionLoss } = compressBinAmount(
      binDepositAmount,
      decompressMultiplier
    );

    // Distribute loss after compression back to bins based on bin ratio with total deposited amount
    let {
      newCompressedBinAmount: compressedBinDepositAmount,
      loss: finalLoss,
    } = distributeAmountToCompressedBinsByRatio(
      compressedBinAmount,
      compressionLoss,
      decompressMultiplier,
      new BN(2 ** 32 - 1) // u32
    );

    // This amount will be deposited to the last bin without compression
    const positionCount = getPositionCount(minBinId, maxBinId.sub(new BN(1)));

    const seederTokenX = getAssociatedTokenAddressSync(
      this.lbPair.tokenXMint,
      operator,
      false,
      this.tokenX.owner
    );

    const seederTokenY = getAssociatedTokenAddressSync(
      this.lbPair.tokenYMint,
      operator,
      false,
      this.tokenY.owner
    );

    const ownerTokenX = getAssociatedTokenAddressSync(
      this.lbPair.tokenXMint,
      owner,
      false,
      this.tokenX.owner
    );

    const [binArrayBitmapExtension] = deriveBinArrayBitmapExtension(
      this.pubkey,
      this.program.programId
    );

    const sendPositionOwnerTokenProveIxs = [];
    const initializeBinArraysAndPositionIxs = [];
    const addLiquidityIxs = [];
    const appendedInitBinArrayIx = new Set();
    let appendedInitBinArrayBitmap = false;

    if (shouldSeedPositionOwner) {
      const positionOwnerTokenX =
        await this.program.provider.connection.getAccountInfo(ownerTokenX);

      let requireTokenProve = false;

      if (positionOwnerTokenX) {
        const ownerTokenXState = unpackAccount(
          ownerTokenX,
          positionOwnerTokenX,
          this.tokenX.owner
        );

        requireTokenProve = ownerTokenXState.amount == 0n;
      } else {
        requireTokenProve = true;
      }

      if (requireTokenProve) {
        if (!positionOwnerTokenX) {
          tokenOwnerProveAssociatedTokenAccountLamports =
            tokenOwnerProveAssociatedTokenAccountLamports.add(
              TOKEN_ACCOUNT_FEE_BN
            );
        }

        const initPositionOwnerTokenX =
          createAssociatedTokenAccountIdempotentInstruction(
            payer,
            ownerTokenX,
            owner,
            this.lbPair.tokenXMint,
            this.tokenX.owner
          );

        const proveAmount = calculateTransferFeeIncludedAmount(
          new BN(1),
          this.tokenX.mint,
          this.clock.epoch.toNumber()
        ).amount;

        sendPositionOwnerTokenProveIxs.push(initPositionOwnerTokenX);

        const transferIx = createTransferCheckedInstruction(
          seederTokenX,
          this.lbPair.tokenXMint,
          ownerTokenX,
          operator,
          BigInt(proveAmount.toString()),
          this.tokenX.mint.decimals,
          [],
          this.tokenX.owner
        );
        transferIx.keys.push(...this.tokenX.transferHookAccountMetas);
        sendPositionOwnerTokenProveIxs.push(transferIx);
      }
    }

    const slices: RemainingAccountsInfoSlice[] = [
      {
        accountsType: {
          transferHookX: {},
        },
        length: this.tokenX.transferHookAccountMetas.length,
      },
    ];
    const transferHookAccountMetas = this.tokenX.transferHookAccountMetas;

    for (let i = 0; i < positionCount.toNumber(); i++) {
      const lowerBinId = minBinId.add(MAX_BIN_PER_POSITION.mul(new BN(i)));
      const upperBinId = lowerBinId.add(MAX_BIN_PER_POSITION).sub(new BN(1));

      const binArrayAccountMetas = getBinArrayAccountMetasCoverage(
        lowerBinId,
        upperBinId,
        this.pubkey,
        this.program.programId
      );

      const binArrayIndexes = getBinArrayIndexesCoverage(
        lowerBinId,
        upperBinId
      );

      const [positionPda, _bump] = derivePosition(
        this.pubkey,
        base,
        lowerBinId,
        MAX_BIN_PER_POSITION,
        this.program.programId
      );

      const accounts =
        await this.program.provider.connection.getMultipleAccountsInfo([
          ...binArrayAccountMetas.map((acc) => acc.pubkey),
          positionPda,
        ]);

      let instructions: TransactionInstruction[] = [];

      const binArrayAccounts = accounts.splice(0, binArrayAccountMetas.length);

      for (let i = 0; i < binArrayAccountMetas.length; i++) {
        const account = binArrayAccounts[i];
        const pubkey = binArrayAccountMetas[i].pubkey.toBase58();
        const index = binArrayIndexes[i];

        if (!account && !appendedInitBinArrayIx.has(pubkey)) {
          totalBinArraysCount = totalBinArraysCount.add(new BN(1));
          totalBinArraysLamports = totalBinArraysLamports.add(BIN_ARRAY_FEE_BN);

          instructions.push(
            await this.program.methods
              .initializeBinArray(index)
              .accounts({
                lbPair: this.pubkey,
                binArray: pubkey,
                funder: payer,
              })
              .instruction()
          );
        }
      }

      const positionAccount = accounts.pop();
      if (!positionAccount) {
        totalPositionCount = totalPositionCount.add(new BN(1));
        totalPositionLamports = totalPositionLamports.add(POSITION_FEE_BN);

        instructions.push(
          await this.program.methods
            .initializePositionByOperator(
              lowerBinId.toNumber(),
              MAX_BIN_PER_POSITION.toNumber(),
              feeOwner,
              lockReleasePoint
            )
            .accounts({
              lbPair: this.pubkey,
              position: positionPda,
              base,
              owner,
              operator,
              operatorTokenX: seederTokenX,
              ownerTokenX,
              systemProgram: SystemProgram.programId,
              payer,
            })
            .instruction()
        );
      }

      // Initialize bin arrays and initialize position account in 1 tx
      if (instructions.length > 0) {
        initializeBinArraysAndPositionIxs.push(instructions);
        instructions = [];
      }

      const positionDeposited =
        positionAccount &&
        this.program.coder.accounts
          .decode<PositionV2>(
            this.program.account.positionV2.idlAccount.name,
            positionAccount.data
          )
          .liquidityShares.reduce((total, cur) => total.add(cur), new BN(0))
          .gt(new BN(0));

      if (!positionDeposited) {
        let overflowDefaultBinArrayBitmap = false;
        for (const binArrayIndex of binArrayIndexes) {
          if (isOverflowDefaultBinArrayBitmap(binArrayIndex)) {
            if (!this.binArrayBitmapExtension && !appendedInitBinArrayBitmap) {
              initializeBinArraysAndPositionIxs.push(
                await this.program.methods
                  .initializeBinArrayBitmapExtension()
                  .accounts({
                    binArrayBitmapExtension,
                    funder: payer,
                    lbPair: this.pubkey,
                  })
                  .instruction()
              );

              appendedInitBinArrayBitmap = true;
              binArrayBitmapLamports = binArrayBitmapLamports.add(
                BIN_ARRAY_BITMAP_FEE_BN
              );
            }

            overflowDefaultBinArrayBitmap = true;
          }
        }

        const cappedUpperBinId = Math.min(
          upperBinId.toNumber(),
          maxBinId.toNumber() - 1
        );

        const bins: CompressedBinDepositAmounts = [];

        for (let i = lowerBinId.toNumber(); i <= cappedUpperBinId; i++) {
          bins.push({
            binId: i,
            amount: compressedBinDepositAmount.get(i).toNumber(),
          });
        }

        instructions.push(
          await this.program.methods
            .addLiquidityOneSidePrecise2(
              {
                bins,
                decompressMultiplier,
                maxAmount: U64_MAX,
              },
              {
                slices,
              }
            )
            .accounts({
              position: positionPda,
              lbPair: this.pubkey,
              binArrayBitmapExtension: overflowDefaultBinArrayBitmap
                ? binArrayBitmapExtension
                : this.program.programId,
              userToken: seederTokenX,
              reserve: this.lbPair.reserveX,
              tokenMint: this.lbPair.tokenXMint,
              sender: operator,
              tokenProgram: this.tokenX.owner,
            })
            .remainingAccounts([
              ...transferHookAccountMetas,
              ...binArrayAccountMetas,
            ])
            .instruction()
        );

        // Last position
        if (i + 1 >= positionCount.toNumber() && !finalLoss.isZero()) {
          const finalLossIncludesTransferFee =
            calculateTransferFeeIncludedAmount(
              finalLoss,
              this.tokenX.mint,
              this.clock.epoch.toNumber()
            ).amount;

          instructions.push(
            await this.program.methods
              .addLiquidity2(
                {
                  amountX: finalLossIncludesTransferFee,
                  amountY: new BN(0),
                  binLiquidityDist: [
                    {
                      binId: cappedUpperBinId,
                      distributionX: BASIS_POINT_MAX,
                      distributionY: BASIS_POINT_MAX,
                    },
                  ],
                },
                {
                  slices,
                }
              )
              .accounts({
                position: positionPda,
                lbPair: this.pubkey,
                binArrayBitmapExtension: overflowDefaultBinArrayBitmap
                  ? binArrayBitmapExtension
                  : this.program.programId,
                userTokenX: seederTokenX,
                userTokenY: seederTokenY,
                reserveX: this.lbPair.reserveX,
                reserveY: this.lbPair.reserveY,
                tokenXMint: this.lbPair.tokenXMint,
                tokenYMint: this.lbPair.tokenYMint,
                tokenXProgram: this.tokenX.owner,
                tokenYProgram: this.tokenY.owner,
                sender: operator,
              })
              .remainingAccounts([
                ...transferHookAccountMetas,
                ...getBinArrayAccountMetasCoverage(
                  new BN(cappedUpperBinId),
                  new BN(cappedUpperBinId),
                  this.pubkey,
                  this.program.programId
                ),
              ])
              .instruction()
          );
        }

        addLiquidityIxs.push([
          ComputeBudgetProgram.setComputeUnitLimit({
            units: DEFAULT_ADD_LIQUIDITY_CU,
          }),
          ...instructions,
        ]);
      }
    }

    return {
      sendPositionOwnerTokenProveIxs,
      initializeBinArraysAndPositionIxs,
      addLiquidityIxs,
      costBreakdown: {
        tokenOwnerProveAssociatedTokenAccountLamports,
        totalBinArraysCount,
        totalBinArraysLamports,
        totalPositionCount,
        totalPositionLamports,
        binArrayBitmapLamports,
      },
    };
  }

  /**
   * The `seedLiquiditySingleBin` function seed liquidity into a single bin.
   * @param
   *    - `payer`: The public key of the tx payer.
   *    - `base`: Base key
   *    - `seedAmount`: Token X lamport amount to be seeded to the pool.
   *    - `price`: TokenX/TokenY Price in UI format
   *    - `roundingUp`: Whether to round up the price
   *    - `positionOwner`: The owner of the position
   *    - `feeOwner`: Position fee owner
   *    - `operator`: Operator of the position. Operator able to manage the position on behalf of the position owner. However, liquidity withdrawal issue by the operator can only send to the position owner.
   *    - `lockReleasePoint`: The lock release point of the position.
   *    - `shouldSeedPositionOwner` (optional): Whether to send 1 lamport amount of token X to the position owner to prove ownership.
   *
   * The returned instructions need to be executed sequentially if it was separated into multiple transactions.
   * @returns {Promise<SeedLiquiditySingleBinResponse>}
   */
  public async seedLiquiditySingleBin(
    payer: PublicKey,
    base: PublicKey,
    seedAmount: BN,
    price: number,
    roundingUp: boolean,
    positionOwner: PublicKey,
    feeOwner: PublicKey,
    operator: PublicKey,
    lockReleasePoint: BN,
    shouldSeedPositionOwner: boolean = false
  ): Promise<SeedLiquiditySingleBinResponse> {
    let tokenOwnerProveAssociatedTokenAccountLamports = new BN(0);
    let totalPositionCount = new BN(0);
    let totalPositionLamports = new BN(0);
    let totalBinArraysCount = new BN(0);
    let totalBinArraysLamports = new BN(0);
    let binArrayBitmapLamports = new BN(0);

    const pricePerLamport = DLMM.getPricePerLamport(
      this.tokenX.mint.decimals,
      this.tokenY.mint.decimals,
      price
    );
    const binIdNumber = DLMM.getBinIdFromPrice(
      pricePerLamport,
      this.lbPair.binStep,
      !roundingUp
    );

    const binId = new BN(binIdNumber);

    const [positionPda] = derivePosition(
      this.pubkey,
      base,
      binId,
      new BN(1),
      this.program.programId
    );

    const binArrayIndex = binIdToBinArrayIndex(binId);
    const [binArrayKey] = deriveBinArray(
      this.pubkey,
      binArrayIndex,
      this.program.programId
    );

    const preInstructions = [];

    const [
      { ataPubKey: userTokenX, ix: createPayerTokenXIx },
      { ataPubKey: userTokenY, ix: createPayerTokenYIx },
    ] = await Promise.all([
      getOrCreateATAInstruction(
        this.program.provider.connection,
        this.tokenX.publicKey,
        operator,
        this.tokenX.owner,
        payer
      ),
      getOrCreateATAInstruction(
        this.program.provider.connection,
        this.tokenY.publicKey,
        operator,
        this.tokenY.owner,
        payer
      ),
    ]);

    // create userTokenX and userTokenY accounts
    createPayerTokenXIx && preInstructions.push(createPayerTokenXIx);
    createPayerTokenYIx && preInstructions.push(createPayerTokenYIx);

    let [binArrayBitmapExtension] = deriveBinArrayBitmapExtension(
      this.pubkey,
      this.program.programId
    );

    const [binArrayAccount, positionAccount, bitmapExtensionAccount] =
      await this.program.provider.connection.getMultipleAccountsInfo([
        binArrayKey,
        positionPda,
        binArrayBitmapExtension,
      ]);

    if (isOverflowDefaultBinArrayBitmap(binArrayIndex)) {
      if (!bitmapExtensionAccount) {
        preInstructions.push(
          await this.program.methods
            .initializeBinArrayBitmapExtension()
            .accounts({
              binArrayBitmapExtension,
              funder: payer,
              lbPair: this.pubkey,
            })
            .instruction()
        );

        binArrayBitmapLamports = binArrayBitmapLamports.add(
          BIN_ARRAY_BITMAP_FEE_BN
        );
      }
    } else {
      binArrayBitmapExtension = this.program.programId;
    }

    const operatorTokenX = getAssociatedTokenAddressSync(
      this.lbPair.tokenXMint,
      operator,
      true,
      this.tokenX.owner
    );
    const positionOwnerTokenX = getAssociatedTokenAddressSync(
      this.lbPair.tokenXMint,
      positionOwner,
      true,
      this.tokenX.owner
    );

    if (shouldSeedPositionOwner) {
      const positionOwnerTokenXAccount =
        await this.program.provider.connection.getAccountInfo(
          positionOwnerTokenX
        );

      const proveAmount = calculateTransferFeeIncludedAmount(
        new BN(1),
        this.tokenX.mint,
        this.clock.epoch.toNumber()
      ).amount;

      if (positionOwnerTokenXAccount) {
        const account = unpackAccount(
          positionOwnerTokenX,
          positionOwnerTokenXAccount,
          this.tokenX.owner
        );

        if (account.amount == BigInt(0)) {
          // send 1 lamport to position owner token X to prove ownership
          const transferIx = createTransferCheckedInstruction(
            operatorTokenX,
            this.lbPair.tokenXMint,
            positionOwnerTokenX,
            operator,
            BigInt(proveAmount.toString()),
            this.tokenX.mint.decimals,
            [],
            this.tokenX.owner
          );
          transferIx.keys.push(...this.tokenX.transferHookAccountMetas);
          preInstructions.push(transferIx);
        }
      } else {
        const createPositionOwnerTokenXIx =
          createAssociatedTokenAccountIdempotentInstruction(
            payer,
            positionOwnerTokenX,
            positionOwner,
            this.lbPair.tokenXMint,
            this.tokenX.owner
          );
        preInstructions.push(createPositionOwnerTokenXIx);

        // send 1 lamport to position owner token X to prove ownership
        const transferIx = createTransferCheckedInstruction(
          operatorTokenX,
          this.lbPair.tokenXMint,
          positionOwnerTokenX,
          operator,
          BigInt(proveAmount.toString()),
          this.tokenX.mint.decimals,
          [],
          this.tokenX.owner
        );
        transferIx.keys.push(...this.tokenX.transferHookAccountMetas);
        preInstructions.push(transferIx);

        tokenOwnerProveAssociatedTokenAccountLamports =
          tokenOwnerProveAssociatedTokenAccountLamports.add(
            TOKEN_ACCOUNT_FEE_BN
          );
      }
    }

    if (!binArrayAccount) {
      preInstructions.push(
        await this.program.methods
          .initializeBinArray(binArrayIndex)
          .accounts({
            binArray: binArrayKey,
            funder: payer,
            lbPair: this.pubkey,
          })
          .instruction()
      );

      totalBinArraysCount = totalBinArraysCount.add(new BN(1));
      totalBinArraysLamports = totalBinArraysLamports.add(BIN_ARRAY_FEE_BN);
    }

    if (!positionAccount) {
      preInstructions.push(
        await this.program.methods
          .initializePositionByOperator(
            binId.toNumber(),
            1,
            feeOwner,
            lockReleasePoint
          )
          .accounts({
            payer,
            base,
            position: positionPda,
            lbPair: this.pubkey,
            owner: positionOwner,
            operator,
            operatorTokenX,
            ownerTokenX: positionOwnerTokenX,
          })
          .instruction()
      );

      totalPositionCount = totalPositionCount.add(new BN(1));
      totalPositionLamports = totalPositionLamports.add(POSITION_FEE_BN);
    }

    const slices: RemainingAccountsInfoSlice[] = [
      {
        accountsType: {
          transferHookX: {},
        },
        length: this.tokenX.transferHookAccountMetas.length,
      },
    ];
    const transferHookAccountMetas = this.tokenX.transferHookAccountMetas;

    const binLiquidityDist: BinLiquidityDistribution = {
      binId: binIdNumber,
      distributionX: BASIS_POINT_MAX,
      distributionY: BASIS_POINT_MAX,
    };

    const seedAmountIncludeTransferFee = calculateTransferFeeIncludedAmount(
      seedAmount,
      this.tokenX.mint,
      this.clock.epoch.toNumber()
    ).amount;

    const addLiquidityParams: LiquidityParameter = {
      amountX: seedAmountIncludeTransferFee,
      amountY: new BN(0),
      binLiquidityDist: [binLiquidityDist],
    };

    const depositLiquidityIx = await this.program.methods
      .addLiquidity2(addLiquidityParams, {
        slices,
      })
      .accounts({
        position: positionPda,
        lbPair: this.pubkey,
        binArrayBitmapExtension,
        userTokenX,
        userTokenY,
        reserveX: this.lbPair.reserveX,
        reserveY: this.lbPair.reserveY,
        tokenXMint: this.lbPair.tokenXMint,
        tokenYMint: this.lbPair.tokenYMint,
        sender: operator,
        tokenXProgram: this.tokenX.owner,
        tokenYProgram: this.tokenY.owner,
      })
      .remainingAccounts([
        ...transferHookAccountMetas,
        {
          pubkey: binArrayKey,
          isSigner: false,
          isWritable: true,
        },
      ])
      .instruction();

    const instructions = [...preInstructions, depositLiquidityIx];
    return {
      instructions,
      costBreakdown: {
        tokenOwnerProveAssociatedTokenAccountLamports,
        totalBinArraysCount,
        totalBinArraysLamports,
        totalPositionCount,
        totalPositionLamports,
        binArrayBitmapLamports,
      },
    };
  }

  /**
   * Initializes bin arrays for the given bin array indexes if it wasn't initialized.
   *
   * @param {BN[]} binArrayIndexes - An array of bin array indexes to initialize.
   * @param {PublicKey} funder - The public key of the funder.
   * @return {Promise<TransactionInstruction[]>} An array of transaction instructions to initialize the bin arrays.
   */
  public async initializeBinArrays(binArrayIndexes: BN[], funder: PublicKey) {
    const ixs: TransactionInstruction[] = [];

    for (const idx of binArrayIndexes) {
      const [binArray] = deriveBinArray(
        this.pubkey,
        idx,
        this.program.programId
      );

      const binArrayAccount =
        await this.program.provider.connection.getAccountInfo(binArray);

      if (binArrayAccount === null) {
        const initBinArrayIx = await this.program.methods
          .initializeBinArray(idx)
          .accounts({
            binArray,
            funder,
            lbPair: this.pubkey,
          })
          .instruction();
        ixs.push(initBinArrayIx);
      }
    }

    if (ixs.length > 0) {
      const setCUIx = await getEstimatedComputeUnitIxWithBuffer(
        this.program.provider.connection,
        ixs,
        funder
      );

      ixs.unshift(setCUIx);
    }

    return ixs;
  }

  /**
   *
   * @param
   *    - `lowerBinId`: Lower bin ID of the position. This represent the lowest price of the position
   *    - `positionWidth`: Width of the position. This will decide the upper bin id of the position, which represents the highest price of the position. UpperBinId = lowerBinId + positionWidth
   *    - `owner`: Owner of the position.
   *    - `operator`: Operator of the position. Operator able to manage the position on behalf of the position owner. However, liquidity withdrawal issue by the operator can only send to the position owner.
   *    - `base`: Base key
   *    - `feeOwner`: Owner of the fees earned by the position.
   *    - `payer`: Payer for the position account rental.
   *    - `lockReleasePoint`: The lock release point of the position.
   * @returns
   */
  public async initializePositionByOperator({
    lowerBinId,
    positionWidth,
    owner,
    feeOwner,
    base,
    operator,
    payer,
    lockReleasePoint,
  }: {
    lowerBinId: BN;
    positionWidth: BN;
    owner: PublicKey;
    feeOwner: PublicKey;
    operator: PublicKey;
    payer: PublicKey;
    base: PublicKey;
    lockReleasePoint: BN;
  }): Promise<Transaction> {
    const [positionPda, _bump] = derivePosition(
      this.pubkey,
      base,
      lowerBinId,
      positionWidth,
      this.program.programId
    );

    const operatorTokenX = getAssociatedTokenAddressSync(
      this.lbPair.tokenXMint,
      operator,
      true,
      this.tokenX.owner
    );

    const ownerTokenX = getAssociatedTokenAddressSync(
      this.lbPair.tokenXMint,
      owner,
      true,
      this.tokenY.owner
    );

    const initializePositionByOperatorTx = await this.program.methods
      .initializePositionByOperator(
        lowerBinId.toNumber(),
        MAX_BIN_PER_POSITION.toNumber(),
        feeOwner,
        lockReleasePoint
      )
      .accounts({
        lbPair: this.pubkey,
        position: positionPda,
        base,
        operator,
        owner,
        ownerTokenX,
        operatorTokenX,
        payer,
      })
      .transaction();

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");
    return new Transaction({
      feePayer: operator,
      blockhash,
      lastValidBlockHeight,
    }).add(initializePositionByOperatorTx);
  }

  /**
   * The `claimAllRewards` function to claim swap fees and LM rewards for multiple positions owned by a specific owner.
   * @param
   *    - `owner`: The public key of the owner of the positions.
   *    - `positions`: An array of objects of type `PositionData` that represents the positions to claim swap fees and LM rewards from.
   * @returns {Promise<Transaction[]>} Array of claim swap fee and LM reward transactions.
   */
  public async claimAllRewards({
    owner,
    positions,
  }: {
    owner: PublicKey;
    positions: LbPosition[];
  }): Promise<Transaction[]> {
    // Filter only position with fees and/or rewards
    positions = positions.filter(
      ({ positionData: { feeX, feeY, rewardOne, rewardTwo } }) =>
        !feeX.isZero() ||
        !feeY.isZero() ||
        !rewardOne.isZero() ||
        !rewardTwo.isZero()
    );

    const claimAllSwapFeeTxs = (
      await Promise.all(
        positions.map(async (position) => {
          return await this.createClaimSwapFeeMethod({
            owner,
            position,
          });
        })
      )
    ).flat();

    const claimAllLMTxs = (
      await Promise.all(
        positions.map(async (position) => {
          return await this.createClaimBuildMethod({
            owner,
            position,
          });
        })
      )
    ).flat();

    const chunkedClaimAllTx = chunks(
      [...claimAllSwapFeeTxs, ...claimAllLMTxs],
      MAX_CLAIM_ALL_ALLOWED
    );

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");

    return Promise.all(
      chunkedClaimAllTx.map(async (claimAllTx) => {
        const instructions = claimAllTx.map((t) => t.instructions).flat();

        const setCUIx = await getEstimatedComputeUnitIxWithBuffer(
          this.program.provider.connection,
          instructions,
          owner
        );

        const tx = new Transaction({
          feePayer: owner,
          blockhash,
          lastValidBlockHeight,
        }).add(setCUIx, ...instructions);

        return tx;
      })
    );
  }

  public canSyncWithMarketPrice(marketPrice: number, activeBinId: number) {
    const marketPriceBinId = this.getBinIdFromPrice(
      Number(
        DLMM.getPricePerLamport(
          this.tokenX.mint.decimals,
          this.tokenY.mint.decimals,
          marketPrice
        )
      ),
      false
    );

    const marketPriceBinArrayIndex = binIdToBinArrayIndex(
      new BN(marketPriceBinId)
    );

    const swapForY = marketPriceBinId < activeBinId;
    const toBinArrayIndex = findNextBinArrayIndexWithLiquidity(
      swapForY,
      new BN(activeBinId),
      this.lbPair,
      this.binArrayBitmapExtension?.account ?? null
    );
    if (toBinArrayIndex === null) return true;

    return swapForY
      ? marketPriceBinArrayIndex.gt(toBinArrayIndex)
      : marketPriceBinArrayIndex.lt(toBinArrayIndex);
  }

  /**
   * The `syncWithMarketPrice` function is used to sync the liquidity pool with the market price.
   * @param
   *    - `marketPrice`: The market price to sync with.
   *    - `owner`: The public key of the owner of the liquidity pool.
   * @returns {Promise<Transaction>}
   */
  public async syncWithMarketPrice(marketPrice: number, owner: PublicKey) {
    const marketPriceBinId = this.getBinIdFromPrice(
      Number(
        DLMM.getPricePerLamport(
          this.tokenX.mint.decimals,
          this.tokenY.mint.decimals,
          marketPrice
        )
      ),
      false
    );
    const activeBin = await this.getActiveBin();
    const activeBinId = activeBin.binId;

    if (!this.canSyncWithMarketPrice(marketPrice, activeBinId)) {
      throw new Error(
        "Unable to sync with market price due to bin with liquidity between current and market price bin"
      );
    }

    const fromBinArrayIndex = binIdToBinArrayIndex(new BN(activeBinId));

    const swapForY = marketPriceBinId < activeBinId;
    const toBinArrayIndex = findNextBinArrayIndexWithLiquidity(
      swapForY,
      new BN(activeBinId),
      this.lbPair,
      this.binArrayBitmapExtension?.account ?? null
    );
    const marketPriceBinArrayIndex = binIdToBinArrayIndex(
      new BN(marketPriceBinId)
    );
    const accountsToFetch = [];
    const binArrayBitMapExtensionPubkey = isOverflowDefaultBinArrayBitmap(
      new BN(marketPriceBinArrayIndex)
    )
      ? deriveBinArrayBitmapExtension(this.pubkey, this.program.programId)[0]
      : null;

    binArrayBitMapExtensionPubkey &&
      accountsToFetch.push(binArrayBitMapExtensionPubkey);
    const [fromBinArrayPubkey] = deriveBinArray(
      this.pubkey,
      fromBinArrayIndex,
      this.program.programId
    );
    accountsToFetch.push(fromBinArrayPubkey);
    const toBinArrayPubkey = (() => {
      if (!toBinArrayIndex) return null;

      const [toBinArrayPubkey] = deriveBinArray(
        this.pubkey,
        toBinArrayIndex,
        this.program.programId
      );

      accountsToFetch.push(toBinArrayPubkey);

      return toBinArrayPubkey;
    })();

    const binArrayAccounts =
      await this.program.provider.connection.getMultipleAccountsInfo(
        accountsToFetch
      );

    const preInstructions: TransactionInstruction[] = [];
    let fromBinArray: PublicKey | null = null;
    let toBinArray: PublicKey | null = null;
    let binArrayBitmapExtension: PublicKey | null = null;
    if (binArrayBitMapExtensionPubkey) {
      binArrayBitmapExtension = binArrayBitMapExtensionPubkey;
      if (!binArrayAccounts?.[0]) {
        const initializeBitmapExtensionIx = await this.program.methods
          .initializeBinArrayBitmapExtension()
          .accounts({
            binArrayBitmapExtension: binArrayBitMapExtensionPubkey,
            funder: owner,
            lbPair: this.pubkey,
          })
          .instruction();
        preInstructions.push(initializeBitmapExtensionIx);
      }
    }
    if (!!binArrayAccounts?.[1]) {
      fromBinArray = fromBinArrayPubkey;
    }

    if (!!binArrayAccounts?.[2] && !!toBinArrayIndex) {
      toBinArray = toBinArrayPubkey;
    }

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");
    const syncWithMarketPriceTx = await this.program.methods
      .goToABin(marketPriceBinId)
      .accounts({
        lbPair: this.pubkey,
        binArrayBitmapExtension,
        fromBinArray,
        toBinArray,
      })
      .preInstructions(preInstructions)
      .transaction();

    return new Transaction({
      feePayer: owner,
      blockhash,
      lastValidBlockHeight,
    }).add(syncWithMarketPriceTx);
  }

  public async getMaxPriceInBinArrays(
    binArrayAccounts: BinArrayAccount[]
  ): Promise<string> {
    // Don't mutate
    const sortedBinArrays = [...binArrayAccounts].sort(
      ({ account: { index: indexA } }, { account: { index: indexB } }) =>
        indexA.toNumber() - indexB.toNumber()
    );
    let count = sortedBinArrays.length - 1;
    let binPriceWithLastLiquidity;
    while (count >= 0) {
      const binArray = sortedBinArrays[count];
      if (binArray) {
        const bins = binArray.account.bins;
        if (bins.every(({ amountX }) => amountX.isZero())) {
          count--;
        } else {
          const lastBinWithLiquidityIndex = bins.findLastIndex(
            ({ amountX }) => !amountX.isZero()
          );
          binPriceWithLastLiquidity =
            bins[lastBinWithLiquidityIndex].price.toString();
          count = -1;
        }
      }
    }

    return this.fromPricePerLamport(
      Number(binPriceWithLastLiquidity) / (2 ** 64 - 1)
    );
  }

  /**
   *
   * @param swapInitiator Address of the swap initiator
   * @returns
   */
  public isSwapDisabled(swapInitiator: PublicKey) {
    if (this.lbPair.status == PairStatus.Disabled) {
      return true;
    }

    if (this.lbPair.pairType == PairType.Permissioned) {
      const currentPoint =
        this.lbPair.activationType == ActivationType.Slot
          ? this.clock.slot
          : this.clock.unixTimestamp;

      const preActivationSwapPoint = this.lbPair.activationPoint.sub(
        this.lbPair.preActivationDuration
      );

      const activationPoint =
        !this.lbPair.preActivationSwapAddress.equals(PublicKey.default) &&
        this.lbPair.preActivationSwapAddress.equals(swapInitiator)
          ? preActivationSwapPoint
          : this.lbPair.activationPoint;

      if (currentPoint < activationPoint) {
        return true;
      }
    }

    return false;
  }

  /** Private static method */

  private static async getBinArrays(
    program: ClmmProgram,
    lbPairPubkey: PublicKey
  ): Promise<Array<BinArrayAccount>> {
    return program.account.binArray.all([binArrayLbPairFilter(lbPairPubkey)]);
  }

  private static async processPosition(
    program: ClmmProgram,
    lbPair: LbPair,
    clock: Clock,
    position: IPosition,
    baseMint: Mint,
    quoteMint: Mint,
    rewardMint0: Mint | null,
    rewardMint1: Mint | null,
    binArrayMap: Map<String, BinArray>
  ): Promise<PositionData | null> {
    const lbPairKey = position.lbPair();
    const lowerBinId = position.lowerBinId();
    const upperBinId = position.upperBinId();

    const posShares = position.liquidityShares();
    const lastUpdatedAt = position.lastUpdatedAt();
    const feeInfos = position.feeInfos();

    const totalClaimedFeeXAmount = position.totalClaimedFeeXAmount();
    const totalClaimedFeeYAmount = position.totalClaimedFeeYAmount();

    const positionRewardInfos = position.rewardInfos();

    const feeOwner = position.feeOwner();

    const bins = this.getBinsBetweenLowerAndUpperBound(
      lbPairKey,
      lbPair,
      lowerBinId.toNumber(),
      upperBinId.toNumber(),
      baseMint.decimals,
      quoteMint.decimals,
      binArrayMap,
      program.programId
    );

    if (!bins.length) return null;

    const positionData: PositionBinData[] = [];

    let totalXAmount = new Decimal(0);
    let totalYAmount = new Decimal(0);

    const ZERO = new BN(0);

    let feeX = ZERO;
    let feeY = ZERO;

    let rewards = [ZERO, ZERO];

    bins.forEach((bin, idx) => {
      const binSupply = bin.supply;
      const posShare = posShares[idx];
      const posBinRewardInfo = positionRewardInfos[idx];

      const positionXAmount = binSupply.eq(ZERO)
        ? ZERO
        : posShare.mul(bin.xAmount).div(binSupply);

      const positionYAmount = binSupply.eq(ZERO)
        ? ZERO
        : posShare.mul(bin.yAmount).div(binSupply);

      totalXAmount = totalXAmount.add(new Decimal(positionXAmount.toString()));
      totalYAmount = totalYAmount.add(new Decimal(positionYAmount.toString()));

      const feeInfo = feeInfos[idx];

      const newFeeX = mulShr(
        posShares[idx].shrn(SCALE_OFFSET),
        bin.feeAmountXPerTokenStored.sub(feeInfo.feeXPerTokenComplete),
        SCALE_OFFSET,
        Rounding.Down
      );

      const newFeeY = mulShr(
        posShares[idx].shrn(SCALE_OFFSET),
        bin.feeAmountYPerTokenStored.sub(feeInfo.feeYPerTokenComplete),
        SCALE_OFFSET,
        Rounding.Down
      );

      const claimableFeeX = newFeeX.add(feeInfo.feeXPending);
      const claimableFeeY = newFeeY.add(feeInfo.feeYPending);

      feeX = feeX.add(claimableFeeX);
      feeY = feeY.add(claimableFeeY);

      const claimableRewardsInBin = [new BN(0), new BN(0)];

      for (let j = 0; j < claimableRewardsInBin.length; j++) {
        const pairRewardInfo = lbPair.rewardInfos[j];

        if (!pairRewardInfo.mint.equals(PublicKey.default)) {
          let rewardPerTokenStored = bin.rewardPerTokenStored[j];

          if (bin.binId == lbPair.activeId && !bin.supply.isZero()) {
            const currentTime = new BN(
              Math.min(
                clock.unixTimestamp.toNumber(),
                pairRewardInfo.rewardDurationEnd.toNumber()
              )
            );

            const delta = currentTime.sub(pairRewardInfo.lastUpdateTime);
            const liquiditySupply = bin.supply.shrn(SCALE_OFFSET);

            const rewardPerTokenStoredDelta = pairRewardInfo.rewardRate
              .mul(delta)
              .div(new BN(15))
              .div(liquiditySupply);

            rewardPerTokenStored = rewardPerTokenStored.add(
              rewardPerTokenStoredDelta
            );
          }

          const delta = rewardPerTokenStored.sub(
            posBinRewardInfo.rewardPerTokenCompletes[j]
          );

          const newReward = mulShr(
            delta,
            posShares[idx].shrn(SCALE_OFFSET),
            SCALE_OFFSET,
            Rounding.Down
          );

          const claimableReward = newReward.add(
            posBinRewardInfo.rewardPendings[j]
          );

          claimableRewardsInBin[j] =
            claimableRewardsInBin[j].add(claimableReward);
          rewards[j] = rewards[j].add(claimableReward);
        }
      }

      positionData.push({
        binId: bin.binId,
        price: bin.price,
        pricePerToken: bin.pricePerToken,
        binXAmount: bin.xAmount.toString(),
        binYAmount: bin.yAmount.toString(),
        binLiquidity: binSupply.toString(),
        positionLiquidity: posShare.toString(),
        positionXAmount: positionXAmount.toString(),
        positionYAmount: positionYAmount.toString(),
        positionFeeXAmount: claimableFeeX.toString(),
        positionFeeYAmount: claimableFeeY.toString(),
        positionRewardAmount: claimableRewardsInBin.map((amount) =>
          amount.toString()
        ),
      });
    });

    const currentEpoch = clock.epoch.toNumber();

    const feeXExcludeTransferFee = calculateTransferFeeExcludedAmount(
      feeX,
      baseMint,
      currentEpoch
    ).amount;

    const feeYExcludeTransferFee = calculateTransferFeeExcludedAmount(
      feeY,
      quoteMint,
      currentEpoch
    ).amount;

    const rewardOne = rewards[0];
    const rewardTwo = rewards[1];

    let rewardOneExcludeTransferFee = new BN(0);
    let rewardTwoExcludeTransferFee = new BN(0);

    if (rewardMint0) {
      rewardOneExcludeTransferFee = calculateTransferFeeExcludedAmount(
        rewardOne,
        rewardMint0,
        currentEpoch
      ).amount;
    }

    if (rewardMint1) {
      rewardTwoExcludeTransferFee = calculateTransferFeeExcludedAmount(
        rewardTwo,
        rewardMint1,
        currentEpoch
      ).amount;
    }

    const totalXAmountExcludeTransferFee = calculateTransferFeeExcludedAmount(
      new BN(totalXAmount.floor().toString()),
      baseMint,
      currentEpoch
    ).amount;

    const totalYAmountExcludeTransferFee = calculateTransferFeeExcludedAmount(
      new BN(totalYAmount.floor().toString()),
      quoteMint,
      currentEpoch
    ).amount;

    return {
      totalXAmount: totalXAmount.toString(),
      totalYAmount: totalYAmount.toString(),
      positionBinData: positionData,
      lastUpdatedAt,
      lowerBinId: lowerBinId.toNumber(),
      upperBinId: upperBinId.toNumber(),
      feeX,
      feeY,
      rewardOne,
      rewardTwo,
      feeOwner,
      totalClaimedFeeXAmount,
      totalClaimedFeeYAmount,
      totalXAmountExcludeTransferFee,
      totalYAmountExcludeTransferFee,
      rewardOneExcludeTransferFee,
      rewardTwoExcludeTransferFee,
      feeXExcludeTransferFee,
      feeYExcludeTransferFee,
      owner: position.owner(),
    };
  }

  private static getBinsBetweenLowerAndUpperBound(
    lbPairKey: PublicKey,
    lbPair: LbPair,
    lowerBinId: number,
    upperBinId: number,
    baseTokenDecimal: number,
    quoteTokenDecimal: number,
    binArrayMap: Map<String, BinArray>,
    programId: PublicKey
  ): BinLiquidity[] {
    const lowerBinArrayIndex = binIdToBinArrayIndex(new BN(lowerBinId));
    const upperBinArrayIndex = binIdToBinArrayIndex(new BN(upperBinId));

    let bins: BinLiquidity[] = [];
    const ZERO = new BN(0);

    for (
      let binArrayIndex = lowerBinArrayIndex.toNumber();
      binArrayIndex <= upperBinArrayIndex.toNumber();
      binArrayIndex++
    ) {
      const binArrayIndexBN = new BN(binArrayIndex);
      const binArrayKey = deriveBinArray(
        lbPairKey,
        binArrayIndexBN,
        programId
      )[0];

      const [lowerBinIdForBinArray] =
        getBinArrayLowerUpperBinId(binArrayIndexBN);

      const binArray = binArrayMap.get(binArrayKey.toBase58());

      for (let i = 0; i < MAX_BIN_ARRAY_SIZE.toNumber(); i++) {
        const binId = lowerBinIdForBinArray.toNumber() + i;

        if (binId >= lowerBinId && binId <= upperBinId) {
          const pricePerLamport = getPriceOfBinByBinId(
            binId,
            lbPair.binStep
          ).toString();

          if (!binArray) {
            bins.push({
              binId,
              xAmount: ZERO,
              yAmount: ZERO,
              supply: ZERO,
              feeAmountXPerTokenStored: ZERO,
              feeAmountYPerTokenStored: ZERO,
              rewardPerTokenStored: [ZERO, ZERO],
              price: pricePerLamport,
              version: 2,
              pricePerToken: new Decimal(pricePerLamport)
                .mul(new Decimal(10 ** (baseTokenDecimal - quoteTokenDecimal)))
                .toString(),
            });
          } else {
            const bin = binArray.bins[i];

            bins.push({
              binId,
              xAmount: bin.amountX,
              yAmount: bin.amountY,
              supply: bin.liquiditySupply,
              feeAmountXPerTokenStored: bin.feeAmountXPerTokenStored,
              feeAmountYPerTokenStored: bin.feeAmountYPerTokenStored,
              rewardPerTokenStored: bin.rewardPerTokenStored,
              price: pricePerLamport,
              version: binArray.version,
              pricePerToken: new Decimal(pricePerLamport)
                .mul(new Decimal(10 ** (baseTokenDecimal - quoteTokenDecimal)))
                .toString(),
            });
          }
        }
      }
    }

    return bins;
  }

  /** Private method */

  private processXYAmountDistribution(xYAmountDistribution: BinAndAmount[]) {
    let currentBinId: number | null = null;
    const xAmountDistribution: BN[] = [];
    const yAmountDistribution: BN[] = [];
    const binIds: number[] = [];

    xYAmountDistribution.forEach((binAndAmount) => {
      xAmountDistribution.push(binAndAmount.xAmountBpsOfTotal);
      yAmountDistribution.push(binAndAmount.yAmountBpsOfTotal);
      binIds.push(binAndAmount.binId);

      if (currentBinId && binAndAmount.binId !== currentBinId + 1) {
        throw new Error("Discontinuous Bin ID");
      } else {
        currentBinId = binAndAmount.binId;
      }
    });

    return {
      lowerBinId: xYAmountDistribution[0].binId,
      upperBinId: xYAmountDistribution[xYAmountDistribution.length - 1].binId,
      xAmountDistribution,
      yAmountDistribution,
      binIds,
    };
  }

  private async getBins(
    lbPairPubKey: PublicKey,
    lowerBinId: number,
    upperBinId: number,
    baseTokenDecimal: number,
    quoteTokenDecimal: number,
    lowerBinArray?: BinArray,
    upperBinArray?: BinArray
  ) {
    const lowerBinArrayIndex = binIdToBinArrayIndex(new BN(lowerBinId));
    const upperBinArrayIndex = binIdToBinArrayIndex(new BN(upperBinId));

    const hasCachedLowerBinArray = lowerBinArray != null;
    const hasCachedUpperBinArray = upperBinArray != null;
    const isSingleBinArray = lowerBinArrayIndex.eq(upperBinArrayIndex);

    const lowerBinArrayIndexOffset = hasCachedLowerBinArray ? 1 : 0;
    const upperBinArrayIndexOffset = hasCachedUpperBinArray ? -1 : 0;

    const binArrayPubkeys = range(
      lowerBinArrayIndex.toNumber() + lowerBinArrayIndexOffset,
      upperBinArrayIndex.toNumber() + upperBinArrayIndexOffset,
      (i) => deriveBinArray(lbPairPubKey, new BN(i), this.program.programId)[0]
    );
    const fetchedBinArrays =
      binArrayPubkeys.length !== 0
        ? await this.program.account.binArray.fetchMultiple(binArrayPubkeys)
        : [];
    const binArrays = [
      ...(hasCachedLowerBinArray ? [lowerBinArray] : []),
      ...fetchedBinArrays,
      ...(hasCachedUpperBinArray && !isSingleBinArray ? [upperBinArray] : []),
    ];

    const binsById = new Map(
      binArrays
        .filter((x) => x != null)
        .flatMap(({ bins, index }) => {
          const [lowerBinId] = getBinArrayLowerUpperBinId(index);
          return bins.map(
            (b, i) => [lowerBinId.toNumber() + i, b] as [number, Bin]
          );
        })
    );
    const version =
      binArrays.find((binArray) => binArray != null)?.version ?? 1;

    return Array.from(
      enumerateBins(
        binsById,
        lowerBinId,
        upperBinId,
        this.lbPair.binStep,
        baseTokenDecimal,
        quoteTokenDecimal,
        version
      )
    );
  }

  private async binArraysToBeCreate(
    lowerBinArrayIndex: BN,
    upperBinArrayIndex: BN
  ) {
    const binArrayIndexes: BN[] = Array.from(
      { length: upperBinArrayIndex.sub(lowerBinArrayIndex).toNumber() + 1 },
      (_, index) => index + lowerBinArrayIndex.toNumber()
    ).map((idx) => new BN(idx));

    const binArrays: PublicKey[] = [];
    for (const idx of binArrayIndexes) {
      const [binArrayPubKey] = deriveBinArray(
        this.pubkey,
        idx,
        this.program.programId
      );
      binArrays.push(binArrayPubKey);
    }

    const binArrayAccounts =
      await this.program.provider.connection.getMultipleAccountsInfo(binArrays);

    return binArrayAccounts
      .filter((binArray) => binArray === null)
      .map((_, index) => binArrays[index]);
  }

  private async createBinArraysIfNeeded(
    binArrayIndexes: BN[],
    funder: PublicKey
  ): Promise<TransactionInstruction[]> {
    const ixs: TransactionInstruction[] = [];

    for (const idx of binArrayIndexes) {
      const [binArrayKey] = deriveBinArray(
        this.pubkey,
        idx,
        this.program.programId
      );
      const binArrayAccount =
        await this.program.provider.connection.getAccountInfo(binArrayKey);

      if (binArrayAccount === null) {
        ixs.push(
          await this.program.methods
            .initializeBinArray(idx)
            .accounts({
              binArray: binArrayKey,
              funder,
              lbPair: this.pubkey,
            })
            .instruction()
        );
      }
    }
    return ixs;
  }

  private updateVolatilityAccumulator(
    vParameter: vParameters,
    sParameter: sParameters,
    activeId: number
  ) {
    const deltaId = Math.abs(vParameter.indexReference - activeId);
    const newVolatilityAccumulator =
      vParameter.volatilityReference + deltaId * BASIS_POINT_MAX;

    vParameter.volatilityAccumulator = Math.min(
      newVolatilityAccumulator,
      sParameter.maxVolatilityAccumulator
    );
  }

  private updateReference(
    activeId: number,
    vParameter: vParameters,
    sParameter: sParameters,
    currentTimestamp: number
  ) {
    const elapsed =
      currentTimestamp - vParameter.lastUpdateTimestamp.toNumber();

    if (elapsed >= sParameter.filterPeriod) {
      vParameter.indexReference = activeId;
      if (elapsed < sParameter.decayPeriod) {
        const decayedVolatilityReference = Math.floor(
          (vParameter.volatilityAccumulator * sParameter.reductionFactor) /
            BASIS_POINT_MAX
        );
        vParameter.volatilityReference = decayedVolatilityReference;
      } else {
        vParameter.volatilityReference = 0;
      }
    }
  }

  private async createClaimBuildMethod({
    owner,
    position,
  }: {
    owner: PublicKey;
    position: LbPosition;
  }) {
    const { lowerBinId, upperBinId } = position.positionData;

    const binArrayAccountsMeta = getBinArrayAccountMetasCoverage(
      new BN(lowerBinId),
      new BN(upperBinId),
      this.pubkey,
      this.program.programId
    );

    const claimTransactions: Transaction[] = [];
    for (let i = 0; i < 2; i++) {
      const rewardInfo = this.lbPair.rewardInfos[i];
      if (!rewardInfo || rewardInfo.mint.equals(PublicKey.default)) continue;

      const preInstructions = [];
      const { ataPubKey, ix } = await getOrCreateATAInstruction(
        this.program.provider.connection,
        rewardInfo.mint,
        owner,
        this.rewards[i].owner
      );
      ix && preInstructions.push(ix);

      const { slices, accounts: transferHookAccounts } =
        this.getPotentialToken2022IxDataAndAccounts(ActionType.Reward, i);

      const claimTransaction = await this.program.methods
        .claimReward2(new BN(i), lowerBinId, upperBinId, {
          slices,
        })
        .accounts({
          lbPair: this.pubkey,
          sender: owner,
          position: position.publicKey,
          rewardVault: rewardInfo.vault,
          rewardMint: rewardInfo.mint,
          tokenProgram: this.rewards[i].owner,
          userTokenAccount: ataPubKey,
          memoProgram: MEMO_PROGRAM_ID,
        })
        .remainingAccounts(transferHookAccounts)
        .remainingAccounts(binArrayAccountsMeta)
        .preInstructions(preInstructions)
        .transaction();
      claimTransactions.push(claimTransaction);
    }

    return claimTransactions;
  }

  private async createClaimSwapFeeMethod({
    owner,
    position,
  }: {
    owner: PublicKey;
    position: LbPosition;
  }) {
    const { lowerBinId, upperBinId } = position.positionData;

    const binArrayAccountsMeta = getBinArrayAccountMetasCoverage(
      new BN(lowerBinId),
      new BN(upperBinId),
      this.pubkey,
      this.program.programId
    );

    const { feeOwner } = position.positionData;

    const walletToReceiveFee = feeOwner.equals(PublicKey.default)
      ? owner
      : feeOwner;

    const preInstructions: TransactionInstruction[] = [];
    const [
      { ataPubKey: userTokenX, ix: createInTokenAccountIx },
      { ataPubKey: userTokenY, ix: createOutTokenAccountIx },
    ] = await Promise.all([
      getOrCreateATAInstruction(
        this.program.provider.connection,
        this.tokenX.publicKey,
        walletToReceiveFee,
        this.tokenX.owner,
        owner
      ),
      getOrCreateATAInstruction(
        this.program.provider.connection,
        this.tokenY.publicKey,
        walletToReceiveFee,
        this.tokenY.owner,
        owner
      ),
    ]);
    createInTokenAccountIx && preInstructions.push(createInTokenAccountIx);
    createOutTokenAccountIx && preInstructions.push(createOutTokenAccountIx);

    const postInstructions: Array<TransactionInstruction> = [];
    if (
      [
        this.tokenX.publicKey.toBase58(),
        this.tokenY.publicKey.toBase58(),
      ].includes(NATIVE_MINT.toBase58())
    ) {
      const closeWrappedSOLIx = await unwrapSOLInstruction(owner);
      closeWrappedSOLIx && postInstructions.push(closeWrappedSOLIx);
    }

    const { slices, accounts: transferHookAccounts } =
      this.getPotentialToken2022IxDataAndAccounts(ActionType.Liquidity);

    const claimFeeTx = await this.program.methods
      .claimFee2(lowerBinId, upperBinId, {
        slices,
      })
      .accounts({
        lbPair: this.pubkey,
        sender: owner,
        position: position.publicKey,
        reserveX: this.lbPair.reserveX,
        reserveY: this.lbPair.reserveY,
        tokenProgramX: this.tokenX.owner,
        tokenProgramY: this.tokenY.owner,
        tokenXMint: this.tokenX.publicKey,
        tokenYMint: this.tokenY.publicKey,
        userTokenX,
        userTokenY,
        memoProgram: MEMO_PROGRAM_ID,
      })
      .remainingAccounts(transferHookAccounts)
      .remainingAccounts(binArrayAccountsMeta)
      .preInstructions(preInstructions)
      .postInstructions(postInstructions)
      .transaction();

    return claimFeeTx;
  }

  private getPotentialToken2022IxDataAndAccounts(
    actionType: ActionType,
    rewardIndex?: number
  ): { slices: RemainingAccountsInfoSlice[]; accounts: AccountMeta[] } {
    if (actionType == ActionType.Liquidity) {
      return {
        slices: [
          {
            accountsType: {
              transferHookX: {},
            },
            length: this.tokenX.transferHookAccountMetas.length,
          },
          {
            accountsType: {
              transferHookY: {},
            },
            length: this.tokenY.transferHookAccountMetas.length,
          },
        ],
        accounts: this.tokenX.transferHookAccountMetas.concat(
          this.tokenY.transferHookAccountMetas
        ),
      };
    }
    return {
      slices: [
        {
          accountsType: {
            transferHookReward: {},
          },
          length: this.rewards[rewardIndex].transferHookAccountMetas.length,
        },
      ],
      accounts: this.rewards[rewardIndex].transferHookAccountMetas,
    };
  }
}
