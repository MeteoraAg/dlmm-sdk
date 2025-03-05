import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import {
  AccountLayout,
  MintLayout,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  unpackAccount,
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
  BIN_ARRAY_FEE,
  FEE_PRECISION,
  LBCLMM_PROGRAM_IDS,
  MAX_ACTIVE_BIN_SLIPPAGE,
  MAX_BIN_LENGTH_ALLOWED_IN_ONE_TX,
  MAX_BIN_PER_POSITION,
  MAX_BIN_PER_TX,
  MAX_CLAIM_ALL_ALLOWED,
  MAX_EXTRA_BIN_ARRAYS,
  MAX_FEE_RATE,
  POSITION_FEE,
  PRECISION,
  SCALE_OFFSET,
} from "./constants";
import { DlmmSdkError } from "./error";
import {
  binIdToBinArrayIndex,
  chunkedGetMultipleAccountInfos,
  chunks,
  computeFee,
  computeFeeFromAmount,
  deriveBinArray,
  deriveBinArrayBitmapExtension,
  deriveCustomizablePermissionlessLbPair,
  deriveLbPair,
  deriveLbPair2,
  deriveOracle,
  derivePermissionLbPair,
  derivePosition,
  deriveReserve,
  findNextBinArrayIndexWithLiquidity,
  findNextBinArrayWithLiquidity,
  getBinArrayLowerUpperBinId,
  getBinFromBinArray,
  getEstimatedComputeUnitIxWithBuffer,
  getOrCreateATAInstruction,
  getOutAmount,
  getPriceOfBinByBinId,
  getTokenDecimals,
  getTotalFee,
  isBinIdWithinBinArray,
  isOverflowDefaultBinArrayBitmap,
  swapExactInQuoteAtBin,
  swapExactOutQuoteAtBin,
  toStrategyParameters,
  toWeightDistribution,
  unwrapSOLInstruction,
  wrapSOLInstruction,
  enumerateBins,
  range,
} from "./helpers";
import {
  Rounding,
  compressBinAmount,
  computeBaseFactorFromFeeBps,
  distributeAmountToCompressedBinsByRatio,
  findSwappableMinMaxBinId,
  generateAmountForBinRange,
  getPositionCount,
  getQPriceFromId,
  mulDiv,
  mulShr,
  shlDiv,
} from "./helpers/math";
import { IDL } from "./idl";
import {
  ActivationType,
  Bin,
  BinAndAmount,
  BinArray,
  BinArrayAccount,
  BinArrayBitmapExtension,
  BinArrayBitmapExtensionAccount,
  BinLiquidity,
  BinLiquidityDistribution,
  ClmmProgram,
  Clock,
  ClockLayout,
  CompressedBinDepositAmounts,
  EmissionRate,
  FeeInfo,
  InitCustomizablePermissionlessPairIx,
  InitPermissionPairIx,
  LMRewards,
  LbPair,
  LbPairAccount,
  LbPosition,
  LiquidityOneSideParameter,
  LiquidityParameter,
  LiquidityParameterByStrategy,
  LiquidityParameterByWeight,
  PairLockInfo,
  PairStatus,
  PairType,
  Position,
  PositionBinData,
  PositionData,
  PositionInfo,
  PositionV2,
  PositionVersion,
  ProgramStrategyParameter,
  SeedLiquidityResponse,
  SwapExactOutParams,
  SwapFee,
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
} from "./types";
import { DEFAULT_ADD_LIQUIDITY_CU } from "./helpers/computeUnit";
import { max, min } from "bn.js";

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
    public clock: Clock,
    private opt?: Opt
  ) { }

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
      opt?.programId ?? LBCLMM_PROGRAM_IDS[opt?.cluster ?? "mainnet-beta"],
      provider
    );

    return program.account.lbPair.all();
  }

  public static async getPairPubkeyIfExists(
    connection: Connection,
    tokenX: PublicKey,
    tokenY: PublicKey,
    binStep: BN,
    baseFactor: BN,
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
      opt?.programId ?? LBCLMM_PROGRAM_IDS[cluster],
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
      opt?.programId ?? LBCLMM_PROGRAM_IDS[cluster],
      provider
    );

    const binArrayBitMapExtensionPubkey = deriveBinArrayBitmapExtension(
      dlmm,
      program.programId
    )[0];
    const accountsToFetch = [
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
      "lbPair",
      lbPairAccountInfoBuffer
    );
    const binArrayBitMapAccountInfoBuffer = accountsInfo[1]?.data;
    let binArrayBitMapExtensionAccInfo: BinArrayBitmapExtension | null = null;
    if (binArrayBitMapAccountInfoBuffer) {
      binArrayBitMapExtensionAccInfo = program.coder.accounts.decode(
        "binArrayBitmapExtension",
        binArrayBitMapAccountInfoBuffer
      );
    }

    const clockAccountInfoBuffer = accountsInfo[2]?.data;
    if (!clockAccountInfoBuffer) throw new Error(`Clock account not found`);
    const clock = ClockLayout.decode(clockAccountInfoBuffer) as Clock;

    const reserveAccountsInfo = await chunkedGetMultipleAccountInfos(
      program.provider.connection,
      [
        lbPairAccInfo.reserveX,
        lbPairAccInfo.reserveY,
        lbPairAccInfo.tokenXMint,
        lbPairAccInfo.tokenYMint,
      ]
    );
    let binArrayBitmapExtension: BinArrayBitmapExtensionAccount | null;
    if (binArrayBitMapExtensionAccInfo) {
      binArrayBitmapExtension = {
        account: binArrayBitMapExtensionAccInfo,
        publicKey: binArrayBitMapExtensionPubkey,
      };
    }

    const reserveXBalance = AccountLayout.decode(reserveAccountsInfo[0].data);
    const reserveYBalance = AccountLayout.decode(reserveAccountsInfo[1].data);
    const tokenXDecimal = MintLayout.decode(
      reserveAccountsInfo[2].data
    ).decimals;
    const tokenYDecimal = MintLayout.decode(
      reserveAccountsInfo[3].data
    ).decimals;
    const tokenX = {
      publicKey: lbPairAccInfo.tokenXMint,
      reserve: lbPairAccInfo.reserveX,
      amount: reserveXBalance.amount,
      decimal: tokenXDecimal,
    };
    const tokenY = {
      publicKey: lbPairAccInfo.tokenYMint,
      reserve: lbPairAccInfo.reserveY,
      amount: reserveYBalance.amount,
      decimal: tokenYDecimal,
    };
    return new DLMM(
      dlmm,
      program,
      lbPairAccInfo,
      binArrayBitmapExtension,
      tokenX,
      tokenY,
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
      opt?.programId ?? LBCLMM_PROGRAM_IDS[cluster],
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

    const accountsInfo = await chunkedGetMultipleAccountInfos(
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
        "lbPair",
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
          "binArrayBitmapExtension",
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

    const reserveAndTokenMintAccountsInfo =
      await chunkedGetMultipleAccountInfos(program.provider.connection, [
        ...reservePublicKeys,
        ...tokenMintPublicKeys,
      ]);

    const lbClmmImpl = await Promise.all(
      dlmmList.map(async (lbPair, index) => {
        const lbPairState = lbPairArraysMap.get(lbPair.toBase58());
        if (!lbPairState)
          throw new Error(`LB Pair ${lbPair.toBase58()} state not found`);

        const binArrayBitmapExtensionState = binArrayBitMapExtensionsMap.get(
          lbPair.toBase58()
        );
        const binArrayBitmapExtensionPubkey = binArrayBitMapExtensions[index];

        let binArrayBitmapExtension: BinArrayBitmapExtensionAccount | null =
          null;
        if (binArrayBitmapExtensionState) {
          binArrayBitmapExtension = {
            account: binArrayBitmapExtensionState,
            publicKey: binArrayBitmapExtensionPubkey,
          };
        }

        const reserveXAccountInfo = reserveAndTokenMintAccountsInfo[index * 2];
        const reserveYAccountInfo =
          reserveAndTokenMintAccountsInfo[index * 2 + 1];
        const tokenXMintAccountInfo =
          reserveAndTokenMintAccountsInfo[reservePublicKeys.length + index * 2];
        const tokenYMintAccountInfo =
          reserveAndTokenMintAccountsInfo[
          reservePublicKeys.length + index * 2 + 1
          ];

        if (!reserveXAccountInfo || !reserveYAccountInfo)
          throw new Error(
            `Reserve account for LB Pair ${lbPair.toBase58()} not found`
          );

        const reserveXBalance = AccountLayout.decode(reserveXAccountInfo.data);
        const reserveYBalance = AccountLayout.decode(reserveYAccountInfo.data);
        const tokenXDecimal = MintLayout.decode(
          tokenXMintAccountInfo.data
        ).decimals;
        const tokenYDecimal = MintLayout.decode(
          tokenYMintAccountInfo.data
        ).decimals;
        const tokenX = {
          publicKey: lbPairState.tokenXMint,
          reserve: lbPairState.reserveX,
          amount: reserveXBalance.amount,
          decimal: tokenXDecimal,
        };
        const tokenY = {
          publicKey: lbPairState.tokenYMint,
          reserve: lbPairState.reserveY,
          amount: reserveYBalance.amount,
          decimal: tokenYDecimal,
        };
        return new DLMM(
          lbPair,
          program,
          lbPairState,
          binArrayBitmapExtension,
          tokenX,
          tokenY,
          clock,
          opt
        );
      })
    );

    return lbClmmImpl;
  }

  static async getAllPresetParameters(connection: Connection, opt?: Opt) {
    const provider = new AnchorProvider(
      connection,
      {} as any,
      AnchorProvider.defaultOptions()
    );
    const program = new Program(
      IDL,
      opt?.programId ?? LBCLMM_PROGRAM_IDS[opt?.cluster ?? "mainnet-beta"],
      provider
    );

    const presetParameter = await program.account.presetParameter.all();
    return presetParameter;
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
      opt?.programId ?? LBCLMM_PROGRAM_IDS[cluster],
      provider
    );

    const positionsV2 = await program.account.positionV2.all([
      {
        memcmp: {
          bytes: bs58.encode(userPubKey.toBuffer()),
          offset: 8 + 32,
        },
      },
    ]);

    const binArrayPubkeySetV2 = new Set<string>();
    const lbPairSetV2 = new Set<string>();
    positionsV2.forEach(({ account: { upperBinId, lowerBinId, lbPair } }) => {
      const lowerBinArrayIndex = binIdToBinArrayIndex(new BN(lowerBinId));
      const upperBinArrayIndex = binIdToBinArrayIndex(new BN(upperBinId));

      const [lowerBinArrayPubKey] = deriveBinArray(
        lbPair,
        lowerBinArrayIndex,
        program.programId
      );
      const [upperBinArrayPubKey] = deriveBinArray(
        lbPair,
        upperBinArrayIndex,
        program.programId
      );
      binArrayPubkeySetV2.add(lowerBinArrayPubKey.toBase58());
      binArrayPubkeySetV2.add(upperBinArrayPubKey.toBase58());
      lbPairSetV2.add(lbPair.toBase58());
    });
    const binArrayPubkeyArrayV2 = Array.from(binArrayPubkeySetV2).map(
      (pubkey) => new PublicKey(pubkey)
    );
    const lbPairArrayV2 = Array.from(lbPairSetV2).map(
      (pubkey) => new PublicKey(pubkey)
    );

    const [clockAccInfo, ...binArraysAccInfo] =
      await chunkedGetMultipleAccountInfos(connection, [
        SYSVAR_CLOCK_PUBKEY,
        ...binArrayPubkeyArrayV2,
        ...lbPairArrayV2,
      ]);

    const positionBinArraysMapV2 = new Map();

    for (
      let i = 0;
      i < binArrayPubkeyArrayV2.length;
      i++
    ) {
      const binArrayPubkey =
        binArrayPubkeyArrayV2[
        i
        ];
      const binArrayAccInfoBufferV2 = binArraysAccInfo[i];
      if (binArrayAccInfoBufferV2) {
        const binArrayAccInfo = program.coder.accounts.decode(
          "binArray",
          binArrayAccInfoBufferV2.data
        );
        positionBinArraysMapV2.set(binArrayPubkey.toBase58(), binArrayAccInfo);
      }
    }

    const lbPairArraysMapV2 = new Map<string, LbPair>();
    for (
      let i =
        binArrayPubkeyArrayV2.length;
      i < binArraysAccInfo.length;
      i++
    ) {
      const lbPairPubkey =
        lbPairArrayV2[
        i - binArrayPubkeyArrayV2.length
        ];
      const lbPairAccInfoBufferV2 = binArraysAccInfo[i];
      if (!lbPairAccInfoBufferV2)
        throw new Error(`LB Pair account ${lbPairPubkey.toBase58()} not found`);
      const lbPairAccInfo = program.coder.accounts.decode(
        "lbPair",
        lbPairAccInfoBufferV2.data
      );
      lbPairArraysMapV2.set(lbPairPubkey.toBase58(), lbPairAccInfo);
    }

    const reservePublicKeysV2 = Array.from(lbPairArraysMapV2.values())
      .map(({ reserveX, reserveY, tokenXMint, tokenYMint }) => [
        reserveX,
        reserveY,
        tokenXMint,
        tokenYMint,
      ])
      .flat();

    const reserveAccountsInfo = await chunkedGetMultipleAccountInfos(
      program.provider.connection,
      reservePublicKeysV2
    );

    const lbPairReserveMapV2 = new Map<
      string,
      { reserveX: bigint; reserveY: bigint }
    >();
    const lbPairMintMapV2 = new Map<
      string,
      { mintXDecimal: number; mintYDecimal: number }
    >();
    lbPairArrayV2.forEach((lbPair, idx) => {
      const index = idx * 4;
      const reserveAccBufferXV2 =
        reserveAccountsInfo[index];
      const reserveAccBufferYV2 =
        reserveAccountsInfo[index + 1];
      if (!reserveAccBufferXV2 || !reserveAccBufferYV2)
        throw new Error(
          `Reserve account for LB Pair ${lbPair.toBase58()} not found`
        );
      const reserveAccX = AccountLayout.decode(reserveAccBufferXV2.data);
      const reserveAccY = AccountLayout.decode(reserveAccBufferYV2.data);

      lbPairReserveMapV2.set(lbPair.toBase58(), {
        reserveX: reserveAccX.amount,
        reserveY: reserveAccY.amount,
      });

      const mintXBufferV2 =
        reserveAccountsInfo[index + 2];
      const mintYBufferV2 =
        reserveAccountsInfo[index + 3];
      if (!mintXBufferV2 || !mintYBufferV2)
        throw new Error(
          `Mint account for LB Pair ${lbPair.toBase58()} not found`
        );
      const mintX = MintLayout.decode(mintXBufferV2.data);
      const mintY = MintLayout.decode(mintYBufferV2.data);
      lbPairMintMapV2.set(lbPair.toBase58(), {
        mintXDecimal: mintX.decimals,
        mintYDecimal: mintY.decimals,
      });
    });

    const onChainTimestamp = new BN(
      clockAccInfo.data.readBigInt64LE(32).toString()
    ).toNumber();
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
    for (let position of positionsV2) {
      const { account, publicKey: positionPubKey } = position;

      const { upperBinId, lowerBinId, lbPair, feeOwner } = account;
      const lowerBinArrayIndex = binIdToBinArrayIndex(new BN(lowerBinId));
      const upperBinArrayIndex = binIdToBinArrayIndex(new BN(upperBinId));

      const [lowerBinArrayPubKey] = deriveBinArray(
        lbPair,
        lowerBinArrayIndex,
        program.programId
      );
      const [upperBinArrayPubKey] = deriveBinArray(
        lbPair,
        upperBinArrayIndex,
        program.programId
      );
      const lowerBinArray = positionBinArraysMapV2.get(
        lowerBinArrayPubKey.toBase58()
      );
      const upperBinArray = positionBinArraysMapV2.get(
        upperBinArrayPubKey.toBase58()
      );

      const lbPairAcc = lbPairArraysMapV2.get(lbPair.toBase58());
      const [baseTokenDecimal, quoteTokenDecimal] = await Promise.all([
        getTokenDecimals(program.provider.connection, lbPairAcc.tokenXMint),
        getTokenDecimals(program.provider.connection, lbPairAcc.tokenYMint),
      ]);
      const reserveXBalance =
        lbPairReserveMapV2.get(lbPair.toBase58())?.reserveX ?? BigInt(0);
      const reserveYBalance =
        lbPairReserveMapV2.get(lbPair.toBase58())?.reserveY ?? BigInt(0);
      const tokenX = {
        publicKey: lbPairAcc.tokenXMint,
        reserve: lbPairAcc.reserveX,
        amount: reserveXBalance,
        decimal: baseTokenDecimal,
      };
      const tokenY = {
        publicKey: lbPairAcc.tokenYMint,
        reserve: lbPairAcc.reserveY,
        amount: reserveYBalance,
        decimal: quoteTokenDecimal,
      };
      const positionData = !!lowerBinArray && !!upperBinArray ? await DLMM.processPosition(
        program,
        PositionVersion.V2,
        lbPairAcc,
        onChainTimestamp,
        account,
        baseTokenDecimal,
        quoteTokenDecimal,
        lowerBinArray,
        upperBinArray,
        feeOwner
      ) : {
        totalXAmount: '0',
        totalYAmount: '0',
        positionBinData: [],
        lastUpdatedAt: new BN(0),
        upperBinId,
        lowerBinId,
        feeX: new BN(0),
        feeY: new BN(0),
        rewardOne: new BN(0),
        rewardTwo: new BN(0),
        feeOwner,
        totalClaimedFeeXAmount: new BN(0),
        totalClaimedFeeYAmount: new BN(0),
      };

      if (positionData) {
        positionsMap.set(lbPair.toBase58(), {
          publicKey: lbPair,
          lbPair: lbPairAcc,
          tokenX,
          tokenY,
          lbPairPositionsData: [
            ...(positionsMap.get(lbPair.toBase58())?.lbPairPositionsData ?? []),
            {
              publicKey: positionPubKey,
              positionData,
              version: PositionVersion.V2,
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
  public async getLbPairLockInfo(lockDurationOpt?: number): Promise<PairLockInfo> {
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
    const clockAccInfo = await this.program.provider.connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
    const clock = ClockLayout.decode(clockAccInfo.data) as Clock;

    const currentPoint = this.lbPair.activationType == ActivationType.Slot ? clock.slot : clock.unixTimestamp;
    const minLockReleasePoint = currentPoint.add(new BN(lockDuration));
    const positionsWithLock = lbPairPositions.filter(p => p.account.lockReleasePoint.gt(minLockReleasePoint));

    if (positionsWithLock.length == 0) {
      return {
        positions: [],
      }
    }

    const binArrayPubkeySetV2 = new Set<string>();
    positionsWithLock.forEach(({ account: { upperBinId, lowerBinId, lbPair } }) => {
      const lowerBinArrayIndex = binIdToBinArrayIndex(new BN(lowerBinId));
      const upperBinArrayIndex = binIdToBinArrayIndex(new BN(upperBinId));

      const [lowerBinArrayPubKey] = deriveBinArray(
        this.pubkey,
        lowerBinArrayIndex,
        this.program.programId
      );
      const [upperBinArrayPubKey] = deriveBinArray(
        this.pubkey,
        upperBinArrayIndex,
        this.program.programId
      );
      binArrayPubkeySetV2.add(lowerBinArrayPubKey.toBase58());
      binArrayPubkeySetV2.add(upperBinArrayPubKey.toBase58());
    });
    const binArrayPubkeyArrayV2 = Array.from(binArrayPubkeySetV2).map(
      (pubkey) => new PublicKey(pubkey)
    );

    const binArraysAccInfo = await chunkedGetMultipleAccountInfos(
      this.program.provider.connection,
      binArrayPubkeyArrayV2,
    );

    const positionBinArraysMapV2 = new Map();
    for (let i = 0; i < binArraysAccInfo.length; i++) {
      const binArrayPubkey =
        binArrayPubkeyArrayV2[i];
      const binArrayAccBufferV2 = binArraysAccInfo[i];
      if (!binArrayAccBufferV2)
        throw new Error(
          `Bin Array account ${binArrayPubkey.toBase58()} not found`
        );
      const binArrayAccInfo = this.program.coder.accounts.decode(
        "binArray",
        binArrayAccBufferV2.data
      );
      positionBinArraysMapV2.set(binArrayPubkey.toBase58(), binArrayAccInfo);
    }



    const positionsLockInfo = await Promise.all(
      positionsWithLock.map(async ({ publicKey, account }) => {
        const { lowerBinId, upperBinId, feeOwner } = account;
        const lowerBinArrayIndex = binIdToBinArrayIndex(new BN(lowerBinId));
        const upperBinArrayIndex = binIdToBinArrayIndex(new BN(upperBinId));

        const [lowerBinArrayPubKey] = deriveBinArray(
          this.pubkey,
          lowerBinArrayIndex,
          this.program.programId
        );
        const [upperBinArrayPubKey] = deriveBinArray(
          this.pubkey,
          upperBinArrayIndex,
          this.program.programId
        );
        const lowerBinArray = positionBinArraysMapV2.get(
          lowerBinArrayPubKey.toBase58()
        );
        const upperBinArray = positionBinArraysMapV2.get(
          upperBinArrayPubKey.toBase58()
        );

        const positionData = await DLMM.processPosition(
          this.program,
          PositionVersion.V2,
          this.lbPair,
          clock.unixTimestamp.toNumber(),
          account,
          this.tokenX.decimal,
          this.tokenY.decimal,
          lowerBinArray,
          upperBinArray,
          feeOwner
        );
        return {
          positionAddress: publicKey,
          owner: account.owner,
          lockReleasePoint: account.lockReleasePoint.toNumber(),
          tokenXAmount: positionData.totalXAmount,
          tokenYAmount: positionData.totalYAmount,
        };
      })
    );

    return {
      positions: positionsLockInfo
    };
  }

  /** Public methods */

  public static async createPermissionLbPair(
    connection: Connection,
    binStep: BN,
    tokenX: PublicKey,
    tokenY: PublicKey,
    activeId: BN,
    baseKey: PublicKey,
    creatorKey: PublicKey,
    feeBps: BN,
    activationType: ActivationType,
    opt?: Opt
  ) {
    const provider = new AnchorProvider(
      connection,
      {} as any,
      AnchorProvider.defaultOptions()
    );
    const program = new Program(
      IDL,
      opt?.programId ?? LBCLMM_PROGRAM_IDS[opt.cluster],
      provider
    );

    const [lbPair] = derivePermissionLbPair(
      baseKey,
      tokenX,
      tokenY,
      binStep,
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

    const { minBinId, maxBinId } = findSwappableMinMaxBinId(binStep);

    const ixData: InitPermissionPairIx = {
      activeId: activeId.toNumber(),
      binStep: binStep.toNumber(),
      baseFactor: computeBaseFactorFromFeeBps(binStep, feeBps).toNumber(),
      minBinId: minBinId.toNumber(),
      maxBinId: maxBinId.toNumber(),
      activationType,
    };

    return program.methods
      .initializePermissionLbPair(ixData)
      .accounts({
        lbPair,
        rent: SYSVAR_RENT_PUBKEY,
        reserveX,
        reserveY,
        binArrayBitmapExtension,
        tokenMintX: tokenX,
        tokenMintY: tokenY,
        tokenProgram: TOKEN_PROGRAM_ID,
        oracle,
        systemProgram: SystemProgram.programId,
        admin: creatorKey,
        base: baseKey,
      })
      .transaction();
  }

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
      opt?.programId ?? LBCLMM_PROGRAM_IDS[opt.cluster],
      provider
    );

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

    const ixData: InitCustomizablePermissionlessPairIx = {
      activeId: activeId.toNumber(),
      binStep: binStep.toNumber(),
      baseFactor: computeBaseFactorFromFeeBps(binStep, feeBps).toNumber(),
      activationType,
      activationPoint: activationPoint ? activationPoint : null,
      hasAlphaVault,
      creatorPoolOnOffControl: creatorPoolOnOffControl ? creatorPoolOnOffControl : false,
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
        tokenProgram: TOKEN_PROGRAM_ID,
        oracle,
        systemProgram: SystemProgram.programId,
        userTokenX,
        userTokenY,
        funder: creatorKey,
      })
      .transaction();
  }

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
      opt?.programId ?? LBCLMM_PROGRAM_IDS[opt.cluster],
      provider
    );

    const existsPool = await this.getPairPubkeyIfExists(
      connection,
      tokenX,
      tokenY,
      binStep,
      baseFactor
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
    ] = await chunkedGetMultipleAccountInfos(this.program.provider.connection, [
      this.pubkey,
      binArrayBitmapExtensionPubkey,
      this.lbPair.reserveX,
      this.lbPair.reserveY,
    ]);

    const lbPairState = this.program.coder.accounts.decode(
      "lbPair",
      lbPairAccountInfo.data
    );
    if (binArrayBitmapExtensionAccountInfo) {
      const binArrayBitmapExtensionState = this.program.coder.accounts.decode(
        "binArrayBitmapExtension",
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
    const [tokenXDecimal, tokenYDecimal] = await Promise.all([
      getTokenDecimals(
        this.program.provider.connection,
        lbPairState.tokenXMint
      ),
      getTokenDecimals(
        this.program.provider.connection,
        lbPairState.tokenYMint
      ),
    ]);

    this.tokenX = {
      amount: reserveXBalance.amount,
      decimal: tokenXDecimal,
      publicKey: lbPairState.tokenXMint,
      reserve: lbPairState.reserveX,
    };
    this.tokenY = {
      amount: reserveYBalance.amount,
      decimal: tokenYDecimal,
      publicKey: lbPairState.tokenYMint,
      reserve: lbPairState.reserveY,
    };

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
  public async setPairStatusPermissionless(enable: boolean, creator: PublicKey) {
    const tx = await this.program.methods.setPairStatusPermissionless(Number(enable))
      .accounts({
        lbPair: this.pubkey,
        creator
      }).transaction();

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
      {
        memcmp: {
          bytes: bs58.encode(this.pubkey.toBuffer()),
          offset: 8 + 16,
        },
      },
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
          "binArray",
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

  public static calculateFeeInfo(
    baseFactor: number | string,
    binStep: number | string
  ): Omit<FeeInfo, "protocolFeePercentage"> {
    const baseFeeRate = new BN(baseFactor).mul(new BN(binStep)).mul(new BN(10));
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
      DLMM.calculateFeeInfo(baseFactor, this.lbPair.binStep);

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
      this.tokenX.decimal,
      this.tokenY.decimal
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
      this.tokenX.decimal,
      this.tokenX.decimal
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
      this.tokenX.decimal,
      this.tokenY.decimal,
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
      this.tokenX.decimal,
      this.tokenY.decimal,
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
      .div(new Decimal(10 ** (this.tokenY.decimal - this.tokenX.decimal)))
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
      this.tokenX.decimal,
      this.tokenY.decimal
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
        {
          memcmp: {
            bytes: bs58.encode(userPubKey.toBuffer()),
            offset: 8 + 32,
          },
        },
        {
          memcmp: {
            bytes: bs58.encode(this.pubkey.toBuffer()),
            offset: 8,
          },
        },
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

    if (!positionsV2) {
      throw new Error("Error fetching positions");
    }

    const binArrayPubkeySetV2 = new Set<string>();
    positionsV2.forEach(({ account: { upperBinId, lowerBinId, lbPair } }) => {
      const lowerBinArrayIndex = binIdToBinArrayIndex(new BN(lowerBinId));
      const upperBinArrayIndex = binIdToBinArrayIndex(new BN(upperBinId));

      const [lowerBinArrayPubKey] = deriveBinArray(
        this.pubkey,
        lowerBinArrayIndex,
        this.program.programId
      );
      const [upperBinArrayPubKey] = deriveBinArray(
        this.pubkey,
        upperBinArrayIndex,
        this.program.programId
      );
      binArrayPubkeySetV2.add(lowerBinArrayPubKey.toBase58());
      binArrayPubkeySetV2.add(upperBinArrayPubKey.toBase58());
    });
    const binArrayPubkeyArrayV2 = Array.from(binArrayPubkeySetV2).map(
      (pubkey) => new PublicKey(pubkey)
    );

    const lbPairAndBinArrays = await chunkedGetMultipleAccountInfos(
      this.program.provider.connection,
      [
        this.pubkey,
        SYSVAR_CLOCK_PUBKEY,
        ...binArrayPubkeyArrayV2,
      ]
    );

    const [lbPairAccInfo, clockAccInfo, ...binArraysAccInfo] =
      lbPairAndBinArrays;

    const positionBinArraysMapV2 = new Map();
    for (let i = 0; i < binArraysAccInfo.length; i++) {
      const binArrayPubkey =
        binArrayPubkeyArrayV2[i];
      const binArrayAccBufferV2 = binArraysAccInfo[i];
      if (!binArrayAccBufferV2)
        throw new Error(
          `Bin Array account ${binArrayPubkey.toBase58()} not found`
        );
      const binArrayAccInfo = this.program.coder.accounts.decode(
        "binArray",
        binArrayAccBufferV2.data
      );
      positionBinArraysMapV2.set(binArrayPubkey.toBase58(), binArrayAccInfo);
    }

    if (!lbPairAccInfo)
      throw new Error(`LB Pair account ${this.pubkey.toBase58()} not found`);

    const onChainTimestamp = new BN(
      clockAccInfo.data.readBigInt64LE(32).toString()
    ).toNumber();

    const userPositionsV2 = await Promise.all(
      positionsV2.map(async ({ publicKey, account }) => {
        const { lowerBinId, upperBinId, feeOwner } = account;
        const lowerBinArrayIndex = binIdToBinArrayIndex(new BN(lowerBinId));
        const upperBinArrayIndex = binIdToBinArrayIndex(new BN(upperBinId));

        const [lowerBinArrayPubKey] = deriveBinArray(
          this.pubkey,
          lowerBinArrayIndex,
          this.program.programId
        );
        const [upperBinArrayPubKey] = deriveBinArray(
          this.pubkey,
          upperBinArrayIndex,
          this.program.programId
        );
        const lowerBinArray = positionBinArraysMapV2.get(
          lowerBinArrayPubKey.toBase58()
        );
        const upperBinArray = positionBinArraysMapV2.get(
          upperBinArrayPubKey.toBase58()
        );
        return {
          publicKey,
          positionData: await DLMM.processPosition(
            this.program,
            PositionVersion.V2,
            this.lbPair,
            onChainTimestamp,
            account,
            this.tokenX.decimal,
            this.tokenY.decimal,
            lowerBinArray,
            upperBinArray,
            feeOwner
          ),
          version: PositionVersion.V2,
        };
      })
    );

    return {
      activeBin,
      userPositions: userPositionsV2,
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
    const createBinArrayIxs = await this.createBinArraysIfNeeded(
      upperBinArrayIndex,
      lowerBinArrayIndex,
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
    const positionAccountInfo = await this.program.account.positionV2.fetch(positionPubKey);
    if (!positionAccountInfo) {
      throw new Error(`Position account ${positionPubKey.toBase58()} not found`);
    }

    const { lowerBinId, upperBinId, feeOwner } = positionAccountInfo;
    const lowerBinArrayIndex = binIdToBinArrayIndex(new BN(lowerBinId));
    const upperBinArrayIndex = binIdToBinArrayIndex(new BN(upperBinId));
    const [lowerBinArrayPubKey] = deriveBinArray(
      this.pubkey,
      lowerBinArrayIndex,
      this.program.programId
    );
    const [upperBinArrayPubKey] = deriveBinArray(
      this.pubkey,
      upperBinArrayIndex,
      this.program.programId
    );

    const [clockAccInfo, lowerBinArrayAccInfo, upperBinArrayAccInfo] = await chunkedGetMultipleAccountInfos(
      this.program.provider.connection,
      [
        SYSVAR_CLOCK_PUBKEY,
        lowerBinArrayPubKey,
        upperBinArrayPubKey,
      ]
    );

    if (!lowerBinArrayAccInfo || !upperBinArrayAccInfo) {
      return {
        publicKey: positionPubKey,
        positionData: {
          totalXAmount: '0',
          totalYAmount: '0',
          positionBinData: [],
          lastUpdatedAt: new BN(0),
          upperBinId,
          lowerBinId,
          feeX: new BN(0),
          feeY: new BN(0),
          rewardOne: new BN(0),
          rewardTwo: new BN(0),
          feeOwner,
          totalClaimedFeeXAmount: new BN(0),
          totalClaimedFeeYAmount: new BN(0),
        },
        version: PositionVersion.V2,
      }
    }

    const onChainTimestamp = new BN(
      clockAccInfo.data.readBigInt64LE(32).toString()
    ).toNumber();

    const lowerBinArray = this.program.coder.accounts.decode(
      "binArray",
      lowerBinArrayAccInfo.data
    )
    const upperBinArray = this.program.coder.accounts.decode(
      "binArray",
      upperBinArrayAccInfo.data
    )

    return {
      publicKey: positionPubKey,
      positionData: await DLMM.processPosition(
        this.program,
        PositionVersion.V2,
        this.lbPair,
        onChainTimestamp,
        positionAccountInfo,
        this.tokenX.decimal,
        this.tokenY.decimal,
        lowerBinArray,
        upperBinArray,
        feeOwner
      ),
      version: PositionVersion.V2,
    }
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
   * @returns {Promise<Transaction>} The function `initializePositionAndAddLiquidityByWeight` returns a `Promise` that
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

    const lowerBinArrayIndex = binIdToBinArrayIndex(new BN(minBinId));
    const [binArrayLower] = deriveBinArray(
      this.pubkey,
      lowerBinArrayIndex,
      this.program.programId
    );

    const upperBinArrayIndex = BN.max(
      lowerBinArrayIndex.add(new BN(1)),
      binIdToBinArrayIndex(new BN(maxBinId))
    );
    const [binArrayUpper] = deriveBinArray(
      this.pubkey,
      upperBinArrayIndex,
      this.program.programId
    );

    const createBinArrayIxs = await this.createBinArraysIfNeeded(
      upperBinArrayIndex,
      lowerBinArrayIndex,
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
        user
      ),
      getOrCreateATAInstruction(
        this.program.provider.connection,
        this.tokenY.publicKey,
        user
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
      binArrayLower,
      binArrayUpper,
      binArrayBitmapExtension,
      sender: user,
      tokenXProgram: TOKEN_PROGRAM_ID,
      tokenYProgram: TOKEN_PROGRAM_ID,
    };

    const programMethod =
      this.program.methods.addLiquidityByStrategy(liquidityParams);

    const addLiquidityIx = await programMethod
      .accounts(addLiquidityAccounts)
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
      upperBinArrayIndex,
      lowerBinArrayIndex,
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
        user
      ),
      getOrCreateATAInstruction(
        this.program.provider.connection,
        this.tokenY.publicKey,
        user
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

    const positionAccount = await this.program.account.positionV2.fetch(
      positionPubKey
    );

    const lowerBinArrayIndex = binIdToBinArrayIndex(
      new BN(positionAccount.lowerBinId)
    );
    const upperBinArrayIndex = lowerBinArrayIndex.add(new BN(1));

    const [binArrayLower] = deriveBinArray(
      this.pubkey,
      lowerBinArrayIndex,
      this.program.programId
    );
    const [binArrayUpper] = deriveBinArray(
      this.pubkey,
      upperBinArrayIndex,
      this.program.programId
    );

    const createBinArrayIxs = await this.createBinArraysIfNeeded(
      upperBinArrayIndex,
      lowerBinArrayIndex,
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
        user
      ),
      getOrCreateATAInstruction(
        this.program.provider.connection,
        this.tokenY.publicKey,
        user
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
      binArrayLower,
      binArrayUpper,
      binArrayBitmapExtension,
      sender: user,
      tokenXProgram: TOKEN_PROGRAM_ID,
      tokenYProgram: TOKEN_PROGRAM_ID,
    };

    const programMethod =
      this.program.methods.addLiquidityByStrategy(liquidityParams);

    const addLiquidityIx = await programMethod
      .accounts(addLiquidityAccounts)
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
      upperBinArrayIndex,
      lowerBinArrayIndex,
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
        user
      ),
      getOrCreateATAInstruction(
        this.program.provider.connection,
        this.tokenY.publicKey,
        user
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
   *    - `binIds`: An array of numbers that represent the bin IDs to remove liquidity from.
   *    - `liquiditiesBpsToRemove`: An array of numbers (percentage) that represent the liquidity to remove from each bin.
   *    - `shouldClaimAndClose`: A boolean flag that indicates whether to claim rewards and close the position.
   * @returns {Promise<Transaction|Transaction[]>}
   */
  public async removeLiquidity({
    user,
    position,
    binIds,
    bps,
    shouldClaimAndClose = false,
  }: {
    user: PublicKey;
    position: PublicKey;
    binIds: number[];
    bps: BN;
    shouldClaimAndClose?: boolean;
  }): Promise<Transaction | Transaction[]> {
    const lowerBinIdToRemove = Math.min(...binIds);
    const upperBinIdToRemove = Math.max(...binIds);
    const { lbPair, owner, feeOwner, lowerBinId: positionLowerBinId, liquidityShares } = await this.program.account.positionV2.fetch(position);

    if (liquidityShares.every((share) => share.isZero())) {
      throw new Error("No liquidity to remove");
    }

    const lowerBinArrayIndex = binIdToBinArrayIndex(new BN(positionLowerBinId));
    const upperBinArrayIndex = lowerBinArrayIndex.add(new BN(1));
    const [binArrayLower] = deriveBinArray(
      lbPair,
      lowerBinArrayIndex,
      this.program.programId
    );
    const [binArrayUpper] = deriveBinArray(
      lbPair,
      upperBinArrayIndex,
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
        user
      ),
      getOrCreateATAInstruction(
        this.program.provider.connection,
        this.tokenY.publicKey,
        owner,
        user
      ),
      getOrCreateATAInstruction(
        this.program.provider.connection,
        this.tokenX.publicKey,
        walletToReceiveFee,
        user
      ),
      getOrCreateATAInstruction(
        this.program.provider.connection,
        this.tokenY.publicKey,
        walletToReceiveFee,
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
        .claimFee()
        .accounts({
          binArrayLower,
          binArrayUpper,
          lbPair: this.pubkey,
          sender: user,
          position,
          reserveX: this.lbPair.reserveX,
          reserveY: this.lbPair.reserveY,
          tokenProgram: TOKEN_PROGRAM_ID,
          tokenXMint: this.tokenX.publicKey,
          tokenYMint: this.tokenY.publicKey,
          userTokenX: feeOwnerTokenX,
          userTokenY: feeOwnerTokenY,
        })
        .instruction();
      postInstructions.push(claimSwapFeeIx);

      for (let i = 0; i < 2; i++) {
        const rewardInfo = this.lbPair.rewardInfos[i];
        if (!rewardInfo || rewardInfo.mint.equals(PublicKey.default)) continue;

        const { ataPubKey, ix: rewardAtaIx } = await getOrCreateATAInstruction(
          this.program.provider.connection,
          rewardInfo.mint,
          user
        );
        rewardAtaIx && preInstructions.push(rewardAtaIx);

        const claimRewardIx = await this.program.methods
          .claimReward(new BN(i))
          .accounts({
            lbPair: this.pubkey,
            sender: user,
            position,
            binArrayLower,
            binArrayUpper,
            rewardVault: rewardInfo.vault,
            rewardMint: rewardInfo.mint,
            tokenProgram: TOKEN_PROGRAM_ID,
            userTokenAccount: ataPubKey,
          })
          .instruction();
        secondTransactionsIx.push(claimRewardIx);
      }

      const closePositionIx = await this.program.methods
        .closePosition()
        .accounts({
          binArrayLower,
          binArrayUpper,
          rentReceiver: owner, // Must be position owner
          position,
          lbPair: this.pubkey,
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

    const minBinArrayIndex = binIdToBinArrayIndex(new BN(lowerBinIdToRemove));
    const maxBinArrayIndex = binIdToBinArrayIndex(new BN(upperBinIdToRemove));

    const useExtension =
      isOverflowDefaultBinArrayBitmap(minBinArrayIndex) ||
      isOverflowDefaultBinArrayBitmap(maxBinArrayIndex);

    const binArrayBitmapExtension = useExtension
      ? deriveBinArrayBitmapExtension(this.pubkey, this.program.programId)[0]
      : null;

    const removeLiquidityTx = await this.program.methods
      .removeLiquidityByRange(lowerBinIdToRemove, upperBinIdToRemove, bps.toNumber())
      .accounts({
        position,
        lbPair,
        userTokenX,
        userTokenY,
        reserveX: this.lbPair.reserveX,
        reserveY: this.lbPair.reserveY,
        tokenXMint: this.tokenX.publicKey,
        tokenYMint: this.tokenY.publicKey,
        binArrayLower,
        binArrayUpper,
        binArrayBitmapExtension,
        tokenXProgram: TOKEN_PROGRAM_ID,
        tokenYProgram: TOKEN_PROGRAM_ID,
        sender: user,
      })
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
    const { lowerBinId } = await this.program.account.positionV2.fetch(
      position.publicKey
    );

    const lowerBinArrayIndex = binIdToBinArrayIndex(new BN(lowerBinId));
    const [binArrayLower] = deriveBinArray(
      this.pubkey,
      lowerBinArrayIndex,
      this.program.programId
    );

    const upperBinArrayIndex = lowerBinArrayIndex.add(new BN(1));
    const [binArrayUpper] = deriveBinArray(
      this.pubkey,
      upperBinArrayIndex,
      this.program.programId
    );

    const closePositionTx = await this.program.methods
      .closePosition()
      .accounts({
        binArrayLower,
        binArrayUpper,
        rentReceiver: owner,
        position: position.publicKey,
        lbPair: this.pubkey,
        sender: owner,
      })
      .transaction();

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");
    return new Transaction({
      blockhash,
      lastValidBlockHeight,
      feePayer: owner,
    }).add(closePositionTx);
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
    // TODO: Should we use onchain clock ? Volatile fee rate is sensitive to time. Caching clock might causes the quoted fee off ...
    const currentTimestamp = Date.now() / 1000;
    let outAmountLeft = outAmount;
    if (maxExtraBinArrays < 0 || maxExtraBinArrays > MAX_EXTRA_BIN_ARRAYS) {
      throw new DlmmSdkError("INVALID_MAX_EXTRA_BIN_ARRAYS", `maxExtraBinArrays must be a value between 0 and ${MAX_EXTRA_BIN_ARRAYS}`);
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

        const binArrayAccountToSwapExisted = binArraysForSwap.has(binArrayAccountToSwap.publicKey);

        if (binArrayAccountToSwapExisted) {
          if (swapForY) {
            activeId = activeId.sub(new BN(1));
          } else {
            activeId = activeId.add(new BN(1));
          }
        } else {
          extraBinArrays.push(binArrayAccountToSwap.publicKey);
          const [lowerBinId, upperBinId] = getBinArrayLowerUpperBinId(binArrayAccountToSwap.account.index);

          if (swapForY) {
            activeId = lowerBinId.sub(new BN(1));
          } else {
            activeId = upperBinId.add(new BN(1));
          }
        }
      }

      // save to binArraysForSwap result
      extraBinArrays.forEach(binArrayPubkey => {
        binArraysForSwap.set(binArrayPubkey, true);
      })
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
    // TODO: Should we use onchain clock ? Volatile fee rate is sensitive to time. Caching clock might causes the quoted fee off ...
    const currentTimestamp = Date.now() / 1000;
    let inAmountLeft = inAmount;
    if (maxExtraBinArrays < 0 || maxExtraBinArrays > MAX_EXTRA_BIN_ARRAYS) {
      throw new DlmmSdkError("INVALID_MAX_EXTRA_BIN_ARRAYS", `maxExtraBinArrays must be a value between 0 and ${MAX_EXTRA_BIN_ARRAYS}`);
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

    let startBin: Bin | null = null;
    let binArraysForSwap = new Map();
    let actualOutAmount: BN = new BN(0);
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
          actualOutAmount = actualOutAmount.add(amountOut);
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

    // in case partialFill is true
    inAmount = inAmount.sub(inAmountLeft);

    const outAmountWithoutSlippage = getOutAmount(
      startBin,
      inAmount.sub(
        computeFeeFromAmount(binStep, sParameters, vParameterClone, inAmount)
      ),
      swapForY
    );

    const priceImpact = new Decimal(actualOutAmount.toString())
      .sub(new Decimal(outAmountWithoutSlippage.toString()))
      .div(new Decimal(outAmountWithoutSlippage.toString()))
      .mul(new Decimal(100));

    const minOutAmount = actualOutAmount
      .mul(new BN(BASIS_POINT_MAX).sub(allowedSlippage))
      .div(new BN(BASIS_POINT_MAX));

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

        const binArrayAccountToSwapExisted = binArraysForSwap.has(binArrayAccountToSwap.publicKey);

        if (binArrayAccountToSwapExisted) {
          if (swapForY) {
            activeId = activeId.sub(new BN(1));
          } else {
            activeId = activeId.add(new BN(1));
          }
        } else {
          extraBinArrays.push(binArrayAccountToSwap.publicKey);
          const [lowerBinId, upperBinId] = getBinArrayLowerUpperBinId(binArrayAccountToSwap.account.index);

          if (swapForY) {
            activeId = lowerBinId.sub(new BN(1));
          } else {
            activeId = upperBinId.add(new BN(1));
          }
        }
      }

      // save to binArraysForSwap result
      extraBinArrays.forEach(binArrayPubkey => {
        binArraysForSwap.set(binArrayPubkey, true);
      })
    }

    const binArraysPubkey = Array.from(binArraysForSwap.keys());

    return {
      consumedInAmount: inAmount,
      outAmount: actualOutAmount,
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
    const { tokenXMint, tokenYMint, reserveX, reserveY, activeId, oracle } =
      await this.program.account.lbPair.fetch(lbPair);

    const preInstructions: TransactionInstruction[] = [];
    const postInstructions: Array<TransactionInstruction> = [];

    const [
      { ataPubKey: userTokenIn, ix: createInTokenAccountIx },
      { ataPubKey: userTokenOut, ix: createOutTokenAccountIx },
    ] = await Promise.all([
      getOrCreateATAInstruction(
        this.program.provider.connection,
        inToken,
        user
      ),
      getOrCreateATAInstruction(
        this.program.provider.connection,
        outToken,
        user
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

    let swapForY = true;
    if (outToken.equals(tokenXMint)) swapForY = false;

    const binArrays: AccountMeta[] = binArraysPubkey.map((pubkey) => {
      return {
        isSigner: false,
        isWritable: true,
        pubkey,
      };
    });

    const swapIx = await this.program.methods
      .swapExactOut(maxInAmount, outAmount)
      .accounts({
        lbPair,
        reserveX,
        reserveY,
        tokenXMint,
        tokenYMint,
        tokenXProgram: TOKEN_PROGRAM_ID,
        tokenYProgram: TOKEN_PROGRAM_ID,
        user,
        userTokenIn,
        userTokenOut,
        binArrayBitmapExtension: this.binArrayBitmapExtension
          ? this.binArrayBitmapExtension.publicKey
          : null,
        oracle,
        hostFeeIn: null,
      })
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
        user
      ),
      getOrCreateATAInstruction(
        this.program.provider.connection,
        outToken,
        user
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

    const swapIx = await this.program.methods
      .swapWithPriceImpact(
        inAmount,
        this.lbPair.activeId,
        priceImpact.toNumber()
      )
      .accounts({
        lbPair,
        reserveX: this.lbPair.reserveX,
        reserveY: this.lbPair.reserveY,
        tokenXMint: this.lbPair.tokenXMint,
        tokenYMint: this.lbPair.tokenYMint,
        tokenXProgram: TOKEN_PROGRAM_ID,
        tokenYProgram: TOKEN_PROGRAM_ID,
        user,
        userTokenIn,
        userTokenOut,
        binArrayBitmapExtension: this.binArrayBitmapExtension
          ? this.binArrayBitmapExtension.publicKey
          : null,
        oracle: this.lbPair.oracle,
        hostFeeIn: null,
      })
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

    const [
      { ataPubKey: userTokenIn, ix: createInTokenAccountIx },
      { ataPubKey: userTokenOut, ix: createOutTokenAccountIx },
    ] = await Promise.all([
      getOrCreateATAInstruction(
        this.program.provider.connection,
        inToken,
        user
      ),
      getOrCreateATAInstruction(
        this.program.provider.connection,
        outToken,
        user
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

    const swapIx = await this.program.methods
      .swap(inAmount, minOutAmount)
      .accounts({
        lbPair,
        reserveX: this.lbPair.reserveX,
        reserveY: this.lbPair.reserveY,
        tokenXMint: this.lbPair.tokenXMint,
        tokenYMint: this.lbPair.tokenYMint,
        tokenXProgram: TOKEN_PROGRAM_ID, // dont use 2022 first; lack familiarity
        tokenYProgram: TOKEN_PROGRAM_ID, // dont use 2022 first; lack familiarity
        user,
        userTokenIn,
        userTokenOut,
        binArrayBitmapExtension: this.binArrayBitmapExtension
          ? this.binArrayBitmapExtension.publicKey
          : null,
        oracle: this.lbPair.oracle,
        hostFeeIn: null,
      })
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
   * @returns {Promise<Transaction>}
   */
  public async claimLMReward({
    owner,
    position,
  }: {
    owner: PublicKey;
    position: LbPosition;
  }): Promise<Transaction> {
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
   * @returns {Promise<Transaction[]>}
   */
  public async claimAllLMRewards({
    owner,
    positions,
  }: {
    owner: PublicKey;
    positions: LbPosition[];
  }): Promise<Transaction[]> {
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
              shouldIncludePreIx: idx === 0,
            });
          })
      )
    ).flat();

    const chunkedClaimAllTx = chunks(claimAllTxs, MAX_CLAIM_ALL_ALLOWED);

    if (chunkedClaimAllTx.length === 0) return [];

    const setCUIx = await getEstimatedComputeUnitIxWithBuffer(
      this.program.provider.connection,
      // First tx simulation will success because it will create all the ATA. Then, we use the simulated CU as references for the rest
      chunkedClaimAllTx[0].map((t) => t.instructions).flat(),
      owner
    );

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");
    return Promise.all(
      chunkedClaimAllTx.map(async (claimAllTx) => {
        return new Transaction({
          feePayer: owner,
          blockhash,
          lastValidBlockHeight,
        })
          .add(setCUIx)
          .add(...claimAllTx);
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

  public async setPairStatus(
    enabled: boolean,
  ): Promise<Transaction> {
    const pairStatus = enabled ? 0 : 1;
    const tx = await this.program.methods.setPairStatus(pairStatus).accounts(
      {
        lbPair: this.pubkey,
        admin: this.lbPair.creator
      }
    ).transaction();

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
   * @returns {Promise<Transaction>}
   */
  public async claimSwapFee({
    owner,
    position,
  }: {
    owner: PublicKey;
    position: LbPosition;
  }): Promise<Transaction> {
    const claimFeeTx = await this.createClaimSwapFeeMethod({ owner, position });

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");
    return new Transaction({
      blockhash,
      lastValidBlockHeight,
      feePayer: owner,
    }).add(claimFeeTx);
  }

  /**
   * The `claimAllSwapFee` function to claim swap fees for multiple positions owned by a specific owner.
   * @param
   *    - `owner`: The public key of the owner of the positions.
   *    - `positions`: An array of objects of type `PositionData` that represents the positions to claim swap fees from.
   * @returns {Promise<Transaction[]>}
   */
  public async claimAllSwapFee({
    owner,
    positions,
  }: {
    owner: PublicKey;
    positions: LbPosition[];
  }): Promise<Transaction[]> {
    const claimAllTxs = (
      await Promise.all(
        positions
          .filter(
            ({ positionData: { feeX, feeY } }) =>
              !feeX.isZero() || !feeY.isZero()
          )
          .map(async (position, idx, positions) => {
            return await this.createClaimSwapFeeMethod({
              owner,
              position,
              shouldIncludePretIx: idx === 0,
              shouldIncludePostIx: idx === positions.length - 1,
            });
          })
      )
    ).flat();

    const chunkedClaimAllTx = chunks(claimAllTxs, MAX_CLAIM_ALL_ALLOWED);

    if (chunkedClaimAllTx.length === 0) return [];

    const setCUIx = await getEstimatedComputeUnitIxWithBuffer(
      this.program.provider.connection,
      // First tx simulation will success because it will create all the ATA. Then, we use the simulated CU as references for the rest
      chunkedClaimAllTx[0].map((t) => t.instructions).flat(),
      owner
    );

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");

    return Promise.all(
      chunkedClaimAllTx.map(async (claimAllTx) => {
        return new Transaction({
          feePayer: owner,
          blockhash,
          lastValidBlockHeight,
        })
          .add(setCUIx)
          .add(...claimAllTx);
      })
    );
  }

  /**
   * The function `claimAllRewardsByPosition` allows a user to claim all rewards for a specific
   * position.
   * @param
   *    - `owner`: The public key of the owner of the position.
   *    - `position`: The public key of the position account.
   * @returns {Promise<Transaction[]>}
   */
  public async claimAllRewardsByPosition({
    owner,
    position,
  }: {
    owner: PublicKey;
    position: LbPosition;
  }): Promise<Transaction[]> {
    const preInstructions: TransactionInstruction[] = [];

    const pairTokens = [this.tokenX.publicKey, this.tokenY.publicKey];
    const tokensInvolved = [...pairTokens];

    for (let i = 0; i < 2; i++) {
      const rewardMint = this.lbPair.rewardInfos[i].mint;
      if (
        !tokensInvolved.some((pubkey) => rewardMint.equals(pubkey)) &&
        !rewardMint.equals(PublicKey.default)
      ) {
        tokensInvolved.push(this.lbPair.rewardInfos[i].mint);
      }
    }

    const feeOwner = position.positionData.feeOwner.equals(PublicKey.default)
      ? owner
      : position.positionData.feeOwner;

    const createATAAccAndIx = await Promise.all(
      tokensInvolved.map((token) => {
        // Single position. Swap fee only belongs to owner, or the customized fee owner.

        if (pairTokens.some((t) => t.equals(token))) {
          return getOrCreateATAInstruction(
            this.program.provider.connection,
            token,
            feeOwner,
            owner
          );
        }

        // Reward
        return getOrCreateATAInstruction(
          this.program.provider.connection,
          token,
          owner
        );
      })
    );
    createATAAccAndIx.forEach(({ ix }) => ix && preInstructions.push(ix));

    const claimAllSwapFeeTxs = await this.createClaimSwapFeeMethod({
      owner,
      position,
      shouldIncludePostIx: false,
      shouldIncludePretIx: false,
    });
    const claimAllLMTxs = await this.createClaimBuildMethod({
      owner,
      position,
      shouldIncludePreIx: false,
    });

    const claimAllTxs = chunks(
      [claimAllSwapFeeTxs, ...claimAllLMTxs],
      MAX_CLAIM_ALL_ALLOWED
    );

    const postInstructions: TransactionInstruction[] = [];
    if (tokensInvolved.some((pubkey) => pubkey.equals(NATIVE_MINT))) {
      const closeWrappedSOLIx = await unwrapSOLInstruction(owner);
      closeWrappedSOLIx && postInstructions.push(closeWrappedSOLIx);
    }

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");
    return Promise.all(
      claimAllTxs.map(async (claimAllTx) => {
        const mainInstructions = claimAllTx.map((t) => t.instructions).flat();
        const instructions = [
          ...preInstructions,
          ...mainInstructions,
          ...postInstructions,
        ];

        const setCUIx = await getEstimatedComputeUnitIxWithBuffer(
          this.program.provider.connection,
          instructions,
          owner
        );

        const tx = new Transaction({
          feePayer: owner,
          blockhash,
          lastValidBlockHeight,
        }).add(setCUIx);

        if (preInstructions.length) tx.add(...preInstructions);
        tx.add(...claimAllTx);
        if (postInstructions.length) tx.add(...postInstructions);

        return tx;
      })
    );
  }

  /**
   * The `seedLiquidity` function create multiple grouped instructions. The grouped instructions will be either [initialize bin array + initialize position instructions] or [deposit instruction] combination.
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
    const toLamportMultiplier = new Decimal(
      10 ** (this.tokenY.decimal - this.tokenX.decimal)
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
      this.tokenX.decimal,
      this.tokenY.decimal,
      minBinId,
      maxBinId,
      k
    );

    const decompressMultiplier = new BN(10 ** this.tokenX.decimal);

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
      false
    );

    const seederTokenY = getAssociatedTokenAddressSync(
      this.lbPair.tokenYMint,
      operator,
      false,
    );

    const ownerTokenX = getAssociatedTokenAddressSync(
      this.lbPair.tokenXMint,
      owner, 
      false
    );

    const sendPositionOwnerTokenProveIxs = [];
    const initializeBinArraysAndPositionIxs = [];
    const addLiquidityIxs = [];
    const appendedInitBinArrayIx = new Set();

    if (shouldSeedPositionOwner) {
      const positionOwnerTokenX =
        await this.program.provider.connection.getAccountInfo(ownerTokenX);

      let requireTokenProve = false;

      if (positionOwnerTokenX) {
        const ownerTokenXState = unpackAccount(
          ownerTokenX,
          positionOwnerTokenX,
          TOKEN_PROGRAM_ID,
        );

        requireTokenProve = ownerTokenXState.amount == 0n;
      } else {
        requireTokenProve = true;
      }

      if (requireTokenProve) {
        const initPositionOwnerTokenX =
          createAssociatedTokenAccountIdempotentInstruction(
            payer,
            ownerTokenX,
            owner,
            this.lbPair.tokenXMint,
            TOKEN_PROGRAM_ID
          );

        sendPositionOwnerTokenProveIxs.push(initPositionOwnerTokenX);
        sendPositionOwnerTokenProveIxs.push(
          createTransferInstruction(
            seederTokenX,
            ownerTokenX,
            operator,
            1n
          )
        );
      }
    }

    for (let i = 0; i < positionCount.toNumber(); i++) {
      const lowerBinId = minBinId.add(MAX_BIN_PER_POSITION.mul(new BN(i)));
      const upperBinId = lowerBinId.add(MAX_BIN_PER_POSITION).sub(new BN(1));

      const lowerBinArrayIndex = binIdToBinArrayIndex(lowerBinId);
      const upperBinArrayIndex = binIdToBinArrayIndex(upperBinId);

      const [positionPda, _bump] = derivePosition(
        this.pubkey,
        base,
        lowerBinId,
        MAX_BIN_PER_POSITION,
        this.program.programId
      );

      const [lowerBinArray] = deriveBinArray(
        this.pubkey,
        lowerBinArrayIndex,
        this.program.programId
      );

      const [upperBinArray] = deriveBinArray(
        this.pubkey,
        upperBinArrayIndex,
        this.program.programId
      );

      const accounts =
        await this.program.provider.connection.getMultipleAccountsInfo([
          lowerBinArray,
          upperBinArray,
          positionPda,
        ]);

      let instructions: TransactionInstruction[] = [];

      const lowerBinArrayAccount = accounts[0];
      if (
        !lowerBinArrayAccount &&
        !appendedInitBinArrayIx.has(lowerBinArray.toBase58())
      ) {
        instructions.push(
          await this.program.methods
            .initializeBinArray(lowerBinArrayIndex)
            .accounts({
              lbPair: this.pubkey,
              binArray: lowerBinArray,
              funder: payer,
            })
            .instruction()
        );

        appendedInitBinArrayIx.add(lowerBinArray.toBase58());
      }

      const upperBinArrayAccount = accounts[1];
      if (
        !upperBinArrayAccount &&
        !appendedInitBinArrayIx.has(upperBinArray.toBase58())
      ) {
        instructions.push(
          await this.program.methods
            .initializeBinArray(upperBinArrayIndex)
            .accounts({
              lbPair: this.pubkey,
              binArray: upperBinArray,
              funder: payer,
            })
            .instruction()
        );

        appendedInitBinArrayIx.add(upperBinArray.toBase58());
      }

      const positionAccount = accounts[2];
      if (!positionAccount) {
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
              payer,
              operator,
              operatorTokenX: seederTokenX,
              ownerTokenX,
              systemProgram: SystemProgram.programId,
            })
            .instruction()
        );
      }

      // Initialize bin arrays and initialize position account in 1 tx
      if (instructions.length > 1) {
        instructions.push(
          await getEstimatedComputeUnitIxWithBuffer(
            this.program.provider.connection,
            instructions,
            payer
          )
        );
        initializeBinArraysAndPositionIxs.push(instructions);
        instructions = [];
      }

      const positionDeposited =
        positionAccount &&
        this.program.coder.accounts
          .decode<PositionV2>("positionV2", positionAccount.data)
          .liquidityShares.reduce((total, cur) => total.add(cur), new BN(0))
          .gt(new BN(0));

      if (!positionDeposited) {
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
            .addLiquidityOneSidePrecise({
              bins,
              decompressMultiplier,
            })
            .accounts({
              position: positionPda,
              lbPair: this.pubkey,
              binArrayBitmapExtension: this.binArrayBitmapExtension
                ? this.binArrayBitmapExtension.publicKey
                : this.program.programId,
              userToken: seederTokenX,
              reserve: this.lbPair.reserveX,
              tokenMint: this.lbPair.tokenXMint,
              binArrayLower: lowerBinArray,
              binArrayUpper: upperBinArray,
              sender: operator,
            })
            .instruction()
        );

        // Last position
        if (i + 1 >= positionCount.toNumber() && !finalLoss.isZero()) {
          instructions.push(
            await this.program.methods
              .addLiquidityOneSide({
                amount: finalLoss,
                activeId: this.lbPair.activeId,
                maxActiveBinSlippage: 0,
                binLiquidityDist: [
                  {
                    binId: cappedUpperBinId,
                    weight: 1,
                  },
                ],
              })
              .accounts({
                position: positionPda,
                lbPair: this.pubkey,
                binArrayBitmapExtension: this.binArrayBitmapExtension
                  ? this.binArrayBitmapExtension.publicKey
                  : this.program.programId,
                userToken: seederTokenX,
                reserve: this.lbPair.reserveX,
                tokenMint: this.lbPair.tokenXMint,
                binArrayLower: lowerBinArray,
                binArrayUpper: upperBinArray,
                sender: operator,
              })
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
    };
  }

  /**
 * The `seedLiquidity` function create multiple grouped instructions. The grouped instructions will be either [initialize bin array + initialize position instructions] or [deposit instruction] combination.
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
 * @returns {Promise<TransactionInstruction[]>}
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
  ): Promise<TransactionInstruction[]> {
    const pricePerLamport = DLMM.getPricePerLamport(
      this.tokenX.decimal,
      this.tokenY.decimal,
      price
    );
    const binIdNumber = DLMM.getBinIdFromPrice(
      pricePerLamport,
      this.lbPair.binStep,
      !roundingUp
    );

    const binId = new BN(binIdNumber);
    const lowerBinArrayIndex = binIdToBinArrayIndex(binId);
    const upperBinArrayIndex = lowerBinArrayIndex.add(new BN(1));

    const [lowerBinArray] = deriveBinArray(this.pubkey, lowerBinArrayIndex, this.program.programId);
    const [upperBinArray] = deriveBinArray(this.pubkey, upperBinArrayIndex, this.program.programId);
    const [positionPda] = derivePosition(this.pubkey, base, binId, new BN(1), this.program.programId);

    const preInstructions = [];

    const [
      { ataPubKey: userTokenX, ix: createPayerTokenXIx },
      { ataPubKey: userTokenY, ix: createPayerTokenYIx },
    ] = await Promise.all([
      getOrCreateATAInstruction(
        this.program.provider.connection,
        this.tokenX.publicKey,
        operator,
        payer
      ),
      getOrCreateATAInstruction(
        this.program.provider.connection,
        this.tokenY.publicKey,
        operator,
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
    const accounts =
      await this.program.provider.connection.getMultipleAccountsInfo([
        lowerBinArray,
        upperBinArray,
        positionPda,
        binArrayBitmapExtension,
      ]);

    if (isOverflowDefaultBinArrayBitmap(lowerBinArrayIndex)) {
      const bitmapExtensionAccount = accounts[3];
      if (!bitmapExtensionAccount) {
        preInstructions.push(await this.program.methods.initializeBinArrayBitmapExtension().accounts({
          binArrayBitmapExtension,
          funder: payer,
          lbPair: this.pubkey
        }).instruction());
      }
    } else {
      binArrayBitmapExtension = this.program.programId;
    }

    const operatorTokenX = getAssociatedTokenAddressSync(
      this.lbPair.tokenXMint,
      operator,
      true
    );
    const positionOwnerTokenX = getAssociatedTokenAddressSync(
      this.lbPair.tokenXMint,
      positionOwner,
      true
    );

    if (shouldSeedPositionOwner) {
      const positionOwnerTokenXAccount = await this.program.provider.connection.getAccountInfo(positionOwnerTokenX);
      if (positionOwnerTokenXAccount) {
        const account = AccountLayout.decode(positionOwnerTokenXAccount.data);
        if (account.amount == BigInt(0)) {
          // send 1 lamport to position owner token X to prove ownership
          const transferIx = createTransferInstruction(operatorTokenX, positionOwnerTokenX, payer, 1);
          preInstructions.push(transferIx);
        }
      } else {
        const createPositionOwnerTokenXIx = createAssociatedTokenAccountInstruction(payer, positionOwnerTokenX, positionOwner, this.lbPair.tokenXMint);
        preInstructions.push(createPositionOwnerTokenXIx);

        // send 1 lamport to position owner token X to prove ownership
        const transferIx = createTransferInstruction(operatorTokenX, positionOwnerTokenX, payer, 1);
        preInstructions.push(transferIx);
      }
    }

    const lowerBinArrayAccount = accounts[0];
    const upperBinArrayAccount = accounts[1];
    const positionAccount = accounts[2];

    if (!lowerBinArrayAccount) {
      preInstructions.push(
        await this.program.methods
          .initializeBinArray(lowerBinArrayIndex)
          .accounts({
            binArray: lowerBinArray,
            funder: payer,
            lbPair: this.pubkey,
          })
          .instruction()
      );
    }

    if (!upperBinArrayAccount) {
      preInstructions.push(
        await this.program.methods
          .initializeBinArray(upperBinArrayIndex)
          .accounts({
            binArray: upperBinArray,
            funder: payer,
            lbPair: this.pubkey,
          })
          .instruction()
      );
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
    }

    const binLiquidityDist: BinLiquidityDistribution = {
      binId: binIdNumber,
      distributionX: BASIS_POINT_MAX,
      distributionY: 0,
    };

    const addLiquidityParams: LiquidityParameter = {
      amountX: seedAmount,
      amountY: new BN(0),
      binLiquidityDist: [binLiquidityDist],
    };

    const depositLiquidityIx = await this.program.methods.addLiquidity(addLiquidityParams).accounts({
      position: positionPda,
      lbPair: this.pubkey,
      binArrayBitmapExtension,
      userTokenX,
      userTokenY,
      reserveX: this.lbPair.reserveX,
      reserveY: this.lbPair.reserveY,
      tokenXMint: this.lbPair.tokenXMint,
      tokenYMint: this.lbPair.tokenYMint,
      binArrayLower: lowerBinArray,
      binArrayUpper: upperBinArray,
      sender: operator,
      tokenXProgram: TOKEN_PROGRAM_ID,
      tokenYProgram: TOKEN_PROGRAM_ID,
    }).instruction();

    return [...preInstructions, depositLiquidityIx];
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
        ixs.push(
          await this.program.methods
            .initializeBinArray(idx)
            .accounts({
              binArray,
              funder,
              lbPair: this.pubkey,
            })
            .instruction()
        );
      }
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
      true
    );

    const ownerTokenX = getAssociatedTokenAddressSync(
      this.lbPair.tokenXMint,
      owner,
      true
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
   * @returns {Promise<Transaction[]>}
   */
  public async claimAllRewards({
    owner,
    positions,
  }: {
    owner: PublicKey;
    positions: LbPosition[];
  }): Promise<Transaction[]> {
    const preInstructions: TransactionInstruction[] = [];
    const pairsToken = [this.tokenX.publicKey, this.tokenY.publicKey];
    const tokensInvolved = [...pairsToken];
    for (let i = 0; i < 2; i++) {
      const rewardMint = this.lbPair.rewardInfos[i].mint;
      if (
        !tokensInvolved.some((pubkey) => rewardMint.equals(pubkey)) &&
        !rewardMint.equals(PublicKey.default)
      ) {
        tokensInvolved.push(this.lbPair.rewardInfos[i].mint);
      }
    }

    // Filter only position with fees and/or rewards
    positions = positions.filter(
      ({ positionData: { feeX, feeY, rewardOne, rewardTwo } }) =>
        !feeX.isZero() ||
        !feeY.isZero() ||
        !rewardOne.isZero() ||
        !rewardTwo.isZero()
    );

    const feeOwners = [
      ...new Set([
        owner.toBase58(),
        ...positions
          .filter((p) => !p.positionData.feeOwner.equals(PublicKey.default))
          .map((p) => p.positionData.feeOwner.toBase58()),
      ]),
    ].map((pk) => new PublicKey(pk));

    const createATAAccAndIx = await Promise.all(
      tokensInvolved
        .map((token) => {
          // There's multiple positions, therefore swap fee ATA might includes account from owner, and customized fee owners
          if (pairsToken.some((p) => p.equals(token))) {
            return feeOwners.map((customOwner) =>
              getOrCreateATAInstruction(
                this.program.provider.connection,
                token,
                customOwner,
                owner
              )
            );
          }
          //
          return [
            getOrCreateATAInstruction(
              this.program.provider.connection,
              token,
              owner
            ),
          ];
        })
        .flat()
    );

    createATAAccAndIx.forEach(({ ix }) => ix && preInstructions.push(ix));

    const claimAllSwapFeeTxs = (
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
              shouldIncludePretIx: false,
              shouldIncludePostIx: false,
            });
          })
      )
    ).flat();

    const claimAllLMTxs = (
      await Promise.all(
        positions
          .filter(
            ({ positionData: { rewardOne, rewardTwo } }) =>
              !rewardOne.isZero() || !rewardTwo.isZero()
          )
          .map(async (position) => {
            return await this.createClaimBuildMethod({
              owner,
              position,
              shouldIncludePreIx: false,
            });
          })
      )
    ).flat();

    const chunkedClaimAllTx = chunks(
      [...claimAllSwapFeeTxs, ...claimAllLMTxs],
      MAX_CLAIM_ALL_ALLOWED
    );

    const postInstructions: TransactionInstruction[] = [];
    if (tokensInvolved.some((pubkey) => pubkey.equals(NATIVE_MINT))) {
      const closeWrappedSOLIx = await unwrapSOLInstruction(owner);
      closeWrappedSOLIx && postInstructions.push(closeWrappedSOLIx);
    }

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");
    return Promise.all(
      chunkedClaimAllTx.map(async (claimAllTx) => {
        const mainIxs = claimAllTx.map((t) => t.instructions).flat();
        const instructions = [
          ...preInstructions,
          ...mainIxs,
          ...postInstructions,
        ];

        const setCUIx = await getEstimatedComputeUnitIxWithBuffer(
          this.program.provider.connection,
          instructions,
          owner
        );

        const tx = new Transaction({
          feePayer: owner,
          blockhash,
          lastValidBlockHeight,
        }).add(setCUIx);

        if (preInstructions.length) tx.add(...preInstructions);
        tx.add(...claimAllTx);
        if (postInstructions.length) tx.add(...postInstructions);

        return tx;
      })
    );
  }

  public canSyncWithMarketPrice(marketPrice: number, activeBinId: number) {
    const marketPriceBinId = this.getBinIdFromPrice(
      Number(
        DLMM.getPricePerLamport(
          this.tokenX.decimal,
          this.tokenY.decimal,
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
          this.tokenX.decimal,
          this.tokenY.decimal,
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
    const accountsToFetch = [];
    const [binArrayBitMapExtensionPubkey] = deriveBinArrayBitmapExtension(
      this.pubkey,
      this.program.programId
    );
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

    let fromBinArray: PublicKey | null = null;
    let toBinArray: PublicKey | null = null;
    let binArrayBitmapExtension: PublicKey | null = null;
    if (!!binArrayAccounts?.[0]) {
      binArrayBitmapExtension = binArrayBitMapExtensionPubkey;
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

  public getAmountOutWithdrawSingleSide(
    maxLiquidityShare: BN,
    price: BN,
    bin: Bin,
    isWithdrawForY: boolean
  ) {
    const amountX = mulDiv(
      maxLiquidityShare,
      bin.amountX,
      bin.liquiditySupply,
      Rounding.Down
    );
    const amountY = mulDiv(
      maxLiquidityShare,
      bin.amountY,
      bin.liquiditySupply,
      Rounding.Down
    );

    const amount0 = isWithdrawForY ? amountX : amountY;
    const amount1 = isWithdrawForY ? amountY : amountX;
    const remainAmountX = bin.amountX.sub(amountX);
    const remainAmountY = bin.amountY.sub(amountY);

    if (amount0.eq(new BN(0))) {
      return {
        withdrawAmount: amount1,
      };
    }

    let maxAmountOut = isWithdrawForY ? remainAmountY : remainAmountX;
    let maxAmountIn = isWithdrawForY
      ? shlDiv(remainAmountY, price, SCALE_OFFSET, Rounding.Up)
      : mulShr(remainAmountX, price, SCALE_OFFSET, Rounding.Up);

    let maxFee = computeFee(
      this.lbPair.binStep,
      this.lbPair.parameters,
      this.lbPair.vParameters,
      maxAmountIn
    );

    maxAmountIn = maxAmountIn.add(maxFee);

    if (amount0.gt(maxAmountIn)) {
      return {
        withdrawAmount: amount1.add(maxAmountOut),
      };
    }
    const fee = computeFeeFromAmount(
      this.lbPair.binStep,
      this.lbPair.parameters,
      this.lbPair.vParameters,
      amount0
    );
    const amount0AfterFee = amount0.sub(fee);
    const amountOut = isWithdrawForY
      ? mulShr(price, amount0AfterFee, SCALE_OFFSET, Rounding.Down)
      : shlDiv(amount0AfterFee, price, SCALE_OFFSET, Rounding.Down);

    return {
      withdrawAmount: amount1.add(amountOut),
    };
  }

  public async getWithdrawSingleSideAmount(
    positionPubkey: PublicKey,
    isWithdrawForY: boolean
  ) {
    let totalWithdrawAmount = new BN(0);
    let lowerBinArray: BinArray | undefined | null;
    let upperBinArray: BinArray | undefined | null;

    const position = await this.program.account.positionV2.fetch(
      positionPubkey
    );
    const lowerBinArrayIdx = binIdToBinArrayIndex(new BN(position.lowerBinId));
    const [lowerBinArrayPubKey] = deriveBinArray(
      position.lbPair,
      lowerBinArrayIdx,
      this.program.programId
    );
    const upperBinArrayIdx = lowerBinArrayIdx.add(new BN(1));
    const [upperBinArrayPubKey] = deriveBinArray(
      position.lbPair,
      upperBinArrayIdx,
      this.program.programId
    );

    [lowerBinArray, upperBinArray] =
      await this.program.account.binArray.fetchMultiple([
        lowerBinArrayPubKey,
        upperBinArrayPubKey,
      ]);

    for (let idx = 0; idx < position.liquidityShares.length; idx++) {
      const shareToRemove = position.liquidityShares[idx];

      if (shareToRemove.eq(new BN(0))) {
        continue;
      }

      const binId = new BN(position.lowerBinId).add(new BN(idx));
      const binArrayIndex = binIdToBinArrayIndex(binId);
      const binArray = binArrayIndex.eq(lowerBinArrayIdx)
        ? lowerBinArray
        : upperBinArray;

      if (!binArray) {
        throw new Error("BinArray not found");
      }

      const bin = getBinFromBinArray(binId.toNumber(), binArray);

      if (isWithdrawForY) {
        if (binId.gt(new BN(this.lbPair.activeId))) {
          break;
        }
      } else {
        if (binId.lt(new BN(this.lbPair.activeId))) {
          continue;
        }
      }

      const price = getQPriceFromId(binId, new BN(this.lbPair.binStep));
      const { withdrawAmount } = this.getAmountOutWithdrawSingleSide(
        shareToRemove,
        price,
        bin,
        isWithdrawForY
      );

      totalWithdrawAmount = totalWithdrawAmount.add(withdrawAmount);
    }
    return totalWithdrawAmount;
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
    return program.account.binArray.all([
      {
        memcmp: {
          bytes: bs58.encode(lbPairPubkey.toBuffer()),
          offset: 8 + 16,
        },
      },
    ]);
  }

  private static async getClaimableLMReward(
    program: ClmmProgram,
    positionVersion: PositionVersion,
    lbPair: LbPair,
    onChainTimestamp: number,
    position: Position,
    lowerBinArray?: BinArray,
    upperBinArray?: BinArray
  ): Promise<LMRewards> {
    const lowerBinArrayIdx = binIdToBinArrayIndex(new BN(position.lowerBinId));

    let rewards = [new BN(0), new BN(0)];

    let _lowerBinArray: BinArray | undefined | null = lowerBinArray;
    let _upperBinArray: BinArray | undefined | null = upperBinArray;
    if (!lowerBinArray || !upperBinArray) {
      const lowerBinArrayIdx = binIdToBinArrayIndex(
        new BN(position.lowerBinId)
      );
      const [lowerBinArray] = deriveBinArray(
        position.lbPair,
        lowerBinArrayIdx,
        program.programId
      );

      const upperBinArrayIdx = lowerBinArrayIdx.add(new BN(1));
      const [upperBinArray] = deriveBinArray(
        position.lbPair,
        upperBinArrayIdx,
        program.programId
      );

      [_lowerBinArray, _upperBinArray] =
        await program.account.binArray.fetchMultiple([
          lowerBinArray,
          upperBinArray,
        ]);
    }

    if (!_lowerBinArray || !_upperBinArray)
      throw new Error("BinArray not found");

    for (let i = position.lowerBinId; i <= position.upperBinId; i++) {
      const binArrayIdx = binIdToBinArrayIndex(new BN(i));
      const binArray = binArrayIdx.eq(lowerBinArrayIdx)
        ? _lowerBinArray
        : _upperBinArray;
      const binState = getBinFromBinArray(i, binArray);
      const binIdxInPosition = i - position.lowerBinId;

      const positionRewardInfo = position.rewardInfos[binIdxInPosition];
      const liquidityShare =
        positionVersion === PositionVersion.V1
          ? position.liquidityShares[binIdxInPosition]
          : position.liquidityShares[binIdxInPosition].shrn(64);

      for (let j = 0; j < 2; j++) {
        const pairRewardInfo = lbPair.rewardInfos[j];

        if (!pairRewardInfo.mint.equals(PublicKey.default)) {
          let rewardPerTokenStored = binState.rewardPerTokenStored[j];

          if (i == lbPair.activeId && !binState.liquiditySupply.isZero()) {
            const currentTime = new BN(
              Math.min(
                onChainTimestamp,
                pairRewardInfo.rewardDurationEnd.toNumber()
              )
            );
            const delta = currentTime.sub(pairRewardInfo.lastUpdateTime);
            const liquiditySupply =
              binArray.version == 0
                ? binState.liquiditySupply
                : binState.liquiditySupply.shrn(64);
            const rewardPerTokenStoredDelta = pairRewardInfo.rewardRate
              .mul(delta)
              .div(new BN(15))
              .div(liquiditySupply);
            rewardPerTokenStored = rewardPerTokenStored.add(
              rewardPerTokenStoredDelta
            );
          }

          const delta = rewardPerTokenStored.sub(
            positionRewardInfo.rewardPerTokenCompletes[j]
          );
          const newReward = mulShr(
            delta,
            liquidityShare,
            SCALE_OFFSET,
            Rounding.Down
          );
          rewards[j] = rewards[j]
            .add(newReward)
            .add(positionRewardInfo.rewardPendings[j]);
        }
      }
    }

    return {
      rewardOne: rewards[0],
      rewardTwo: rewards[1],
    };
  }

  private static async getClaimableSwapFee(
    program: ClmmProgram,
    positionVersion: PositionVersion,
    position: Position,
    lowerBinArray?: BinArray,
    upperBinArray?: BinArray
  ): Promise<SwapFee> {
    const lowerBinArrayIdx = binIdToBinArrayIndex(new BN(position.lowerBinId));

    let feeX = new BN(0);
    let feeY = new BN(0);

    let _lowerBinArray: BinArray | undefined | null = lowerBinArray;
    let _upperBinArray: BinArray | undefined | null = upperBinArray;
    if (!lowerBinArray || !upperBinArray) {
      const lowerBinArrayIdx = binIdToBinArrayIndex(
        new BN(position.lowerBinId)
      );
      const [lowerBinArray] = deriveBinArray(
        position.lbPair,
        lowerBinArrayIdx,
        program.programId
      );

      const upperBinArrayIdx = lowerBinArrayIdx.add(new BN(1));
      const [upperBinArray] = deriveBinArray(
        position.lbPair,
        upperBinArrayIdx,
        program.programId
      );

      [_lowerBinArray, _upperBinArray] =
        await program.account.binArray.fetchMultiple([
          lowerBinArray,
          upperBinArray,
        ]);
    }

    if (!_lowerBinArray || !_upperBinArray)
      throw new Error("BinArray not found");

    for (let i = position.lowerBinId; i <= position.upperBinId; i++) {
      const binArrayIdx = binIdToBinArrayIndex(new BN(i));
      const binArray = binArrayIdx.eq(lowerBinArrayIdx)
        ? _lowerBinArray
        : _upperBinArray;
      const binState = getBinFromBinArray(i, binArray);
      const binIdxInPosition = i - position.lowerBinId;

      const feeInfos = position.feeInfos[binIdxInPosition];
      const liquidityShare =
        positionVersion === PositionVersion.V1
          ? position.liquidityShares[binIdxInPosition]
          : position.liquidityShares[binIdxInPosition].shrn(64);

      const newFeeX = mulShr(
        liquidityShare,
        binState.feeAmountXPerTokenStored.sub(feeInfos.feeXPerTokenComplete),
        SCALE_OFFSET,
        Rounding.Down
      );

      const newFeeY = mulShr(
        liquidityShare,
        binState.feeAmountYPerTokenStored.sub(feeInfos.feeYPerTokenComplete),
        SCALE_OFFSET,
        Rounding.Down
      );

      feeX = feeX.add(newFeeX).add(feeInfos.feeXPending);
      feeY = feeY.add(newFeeY).add(feeInfos.feeYPending);
    }

    return { feeX, feeY };
  }

  private static async processPosition(
    program: ClmmProgram,
    version: PositionVersion,
    lbPair: LbPair,
    onChainTimestamp: number,
    position: Position,
    baseTokenDecimal: number,
    quoteTokenDecimal: number,
    lowerBinArray: BinArray,
    upperBinArray: BinArray,
    feeOwner: PublicKey
  ): Promise<PositionData | null> {
    const {
      lowerBinId,
      upperBinId,
      liquidityShares: posShares,
      lastUpdatedAt,
      totalClaimedFeeXAmount,
      totalClaimedFeeYAmount,
    } = position;

    const bins = this.getBinsBetweenLowerAndUpperBound(
      lbPair,
      lowerBinId,
      upperBinId,
      baseTokenDecimal,
      quoteTokenDecimal,
      lowerBinArray,
      upperBinArray
    );

    if (!bins.length) return null;

    /// assertion
    if (
      bins[0].binId !== lowerBinId ||
      bins[bins.length - 1].binId !== upperBinId
    )
      throw new Error("Bin ID mismatch");

    const positionData: PositionBinData[] = [];
    let totalXAmount = new Decimal(0);
    let totalYAmount = new Decimal(0);

    bins.forEach((bin, idx) => {
      const binSupply = new Decimal(bin.supply.toString());

      const posShare = new Decimal(posShares[idx].toString());
      const positionXAmount = binSupply.eq(new Decimal("0"))
        ? new Decimal("0")
        : posShare.mul(bin.xAmount.toString()).div(binSupply);
      const positionYAmount = binSupply.eq(new Decimal("0"))
        ? new Decimal("0")
        : posShare.mul(bin.yAmount.toString()).div(binSupply);

      totalXAmount = totalXAmount.add(positionXAmount);
      totalYAmount = totalYAmount.add(positionYAmount);

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
      });
    });

    const { feeX, feeY } = await this.getClaimableSwapFee(
      program,
      version,
      position,
      lowerBinArray,
      upperBinArray
    );
    const { rewardOne, rewardTwo } = await this.getClaimableLMReward(
      program,
      version,
      lbPair,
      onChainTimestamp,
      position,
      lowerBinArray,
      upperBinArray
    );

    return {
      totalXAmount: totalXAmount.toString(),
      totalYAmount: totalYAmount.toString(),
      positionBinData: positionData,
      lastUpdatedAt,
      lowerBinId,
      upperBinId,
      feeX,
      feeY,
      rewardOne,
      rewardTwo,
      feeOwner,
      totalClaimedFeeXAmount,
      totalClaimedFeeYAmount,
    };
  }

  private static getBinsBetweenLowerAndUpperBound(
    lbPair: LbPair,
    lowerBinId: number,
    upperBinId: number,
    baseTokenDecimal: number,
    quoteTokenDecimal: number,
    lowerBinArrays: BinArray,
    upperBinArrays: BinArray
  ): BinLiquidity[] {
    const lowerBinArrayIndex = binIdToBinArrayIndex(new BN(lowerBinId));
    const upperBinArrayIndex = binIdToBinArrayIndex(new BN(upperBinId));

    let bins: BinLiquidity[] = [];
    if (lowerBinArrayIndex.eq(upperBinArrayIndex)) {
      const binArray = lowerBinArrays;

      const [lowerBinIdForBinArray] = getBinArrayLowerUpperBinId(
        binArray.index
      );

      binArray.bins.forEach((bin, idx) => {
        const binId = lowerBinIdForBinArray.toNumber() + idx;

        if (binId >= lowerBinId && binId <= upperBinId) {
          const pricePerLamport = getPriceOfBinByBinId(
            binId,
            lbPair.binStep
          ).toString();
          bins.push({
            binId,
            xAmount: bin.amountX,
            yAmount: bin.amountY,
            supply: bin.liquiditySupply,
            price: pricePerLamport,
            version: binArray.version,
            pricePerToken: new Decimal(pricePerLamport)
              .mul(new Decimal(10 ** (baseTokenDecimal - quoteTokenDecimal)))
              .toString(),
          });
        }
      });
    } else {
      const binArrays = [lowerBinArrays, upperBinArrays];

      binArrays.forEach((binArray) => {
        const [lowerBinIdForBinArray] = getBinArrayLowerUpperBinId(
          binArray.index
        );
        binArray.bins.forEach((bin, idx) => {
          const binId = lowerBinIdForBinArray.toNumber() + idx;
          if (binId >= lowerBinId && binId <= upperBinId) {
            const pricePerLamport = getPriceOfBinByBinId(
              binId,
              lbPair.binStep
            ).toString();
            bins.push({
              binId,
              xAmount: bin.amountX,
              yAmount: bin.amountY,
              supply: bin.liquiditySupply,
              price: pricePerLamport,
              version: binArray.version,
              pricePerToken: new Decimal(pricePerLamport)
                .mul(new Decimal(10 ** (baseTokenDecimal - quoteTokenDecimal)))
                .toString(),
            });
          }
        });
      });
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
      i => deriveBinArray(lbPairPubKey, new BN(i), this.program.programId)[0]
    );
    const fetchedBinArrays = binArrayPubkeys.length !== 0 ?
      await this.program.account.binArray.fetchMultiple(binArrayPubkeys) : [];
    const binArrays = [
      ...(hasCachedLowerBinArray ? [lowerBinArray] : []),
      ...fetchedBinArrays,
      ...((hasCachedUpperBinArray && !isSingleBinArray) ? [upperBinArray] : [])
    ];

    const binsById = new Map(binArrays
      .filter(x => x != null)
      .flatMap(({ bins, index }) => {
        const [lowerBinId] = getBinArrayLowerUpperBinId(index);
        return bins.map((b, i) => [lowerBinId.toNumber() + i, b] as [number, Bin]);
      }));
    const version = binArrays.find(binArray => binArray != null)?.version ?? 1;

    return Array.from(enumerateBins(
      binsById,
      lowerBinId,
      upperBinId,
      this.lbPair.binStep,
      baseTokenDecimal,
      quoteTokenDecimal,
      version,
    ));
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
    upperBinArrayIndex: BN,
    lowerBinArrayIndex: BN,
    funder: PublicKey
  ): Promise<TransactionInstruction[]> {
    const ixs: TransactionInstruction[] = [];

    const binArrayIndexes: BN[] = Array.from(
      { length: upperBinArrayIndex.sub(lowerBinArrayIndex).toNumber() + 1 },
      (_, index) => index + lowerBinArrayIndex.toNumber()
    ).map((idx) => new BN(idx));

    for (const idx of binArrayIndexes) {
      const [binArray] = deriveBinArray(
        this.pubkey,
        idx,
        this.program.programId
      );

      const binArrayAccount =
        await this.program.provider.connection.getAccountInfo(binArray);

      if (binArrayAccount === null) {
        ixs.push(
          await this.program.methods
            .initializeBinArray(idx)
            .accounts({
              binArray,
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
    shouldIncludePreIx = true,
  }: {
    owner: PublicKey;
    position: LbPosition;
    shouldIncludePreIx?: boolean;
  }) {
    const lowerBinArrayIndex = binIdToBinArrayIndex(
      new BN(position.positionData.lowerBinId)
    );
    const [binArrayLower] = deriveBinArray(
      this.pubkey,
      lowerBinArrayIndex,
      this.program.programId
    );

    const upperBinArrayIndex = lowerBinArrayIndex.add(new BN(1));
    const [binArrayUpper] = deriveBinArray(
      this.pubkey,
      upperBinArrayIndex,
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
        owner
      );
      ix && preInstructions.push(ix);
      const claimTransaction = await this.program.methods
        .claimReward(new BN(i))
        .accounts({
          lbPair: this.pubkey,
          sender: owner,
          position: position.publicKey,
          binArrayLower,
          binArrayUpper,
          rewardVault: rewardInfo.vault,
          rewardMint: rewardInfo.mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          userTokenAccount: ataPubKey,
        })
        .preInstructions(shouldIncludePreIx ? preInstructions : [])
        .transaction();
      claimTransactions.push(claimTransaction);
    }

    return claimTransactions;
  }

  private async createClaimSwapFeeMethod({
    owner,
    position,
    shouldIncludePretIx = true,
    shouldIncludePostIx = true,
  }: {
    owner: PublicKey;
    position: LbPosition;
    shouldIncludePretIx?: boolean;
    shouldIncludePostIx?: boolean;
  }) {
    const { lowerBinId, feeOwner } = position.positionData;

    const lowerBinArrayIndex = binIdToBinArrayIndex(new BN(lowerBinId));
    const [binArrayLower] = deriveBinArray(
      this.pubkey,
      lowerBinArrayIndex,
      this.program.programId
    );

    const upperBinArrayIndex = lowerBinArrayIndex.add(new BN(1));
    const [binArrayUpper] = deriveBinArray(
      this.pubkey,
      upperBinArrayIndex,
      this.program.programId
    );

    const [reserveX] = deriveReserve(
      this.tokenX.publicKey,
      this.pubkey,
      this.program.programId
    );
    const [reserveY] = deriveReserve(
      this.tokenY.publicKey,
      this.pubkey,
      this.program.programId
    );

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
        owner
      ),
      getOrCreateATAInstruction(
        this.program.provider.connection,
        this.tokenY.publicKey,
        walletToReceiveFee,
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

    const claimFeeTx = await this.program.methods
      .claimFee()
      .accounts({
        binArrayLower,
        binArrayUpper,
        lbPair: this.pubkey,
        sender: owner,
        position: position.publicKey,
        reserveX,
        reserveY,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenXMint: this.tokenX.publicKey,
        tokenYMint: this.tokenY.publicKey,
        userTokenX,
        userTokenY,
      })
      .preInstructions(shouldIncludePretIx ? preInstructions : [])
      .postInstructions(shouldIncludePostIx ? postInstructions : [])
      .transaction();

    return claimFeeTx;
  }
}
