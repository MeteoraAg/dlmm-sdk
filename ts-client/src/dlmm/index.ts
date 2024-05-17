import {
  Cluster,
  Connection,
  PublicKey,
  TransactionInstruction,
  Transaction,
  AccountMeta,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import { IDL } from "./idl";
import {
  BASIS_POINT_MAX,
  FEE_PRECISION,
  LBCLMM_PROGRAM_IDS,
  MAX_BIN_PER_POSITION,
  MAX_FEE_RATE,
  MAX_CLAIM_ALL_ALLOWED,
  PRECISION,
  MAX_BIN_LENGTH_ALLOWED_IN_ONE_TX,
  SCALE_OFFSET,
  MAX_ACTIVE_BIN_SLIPPAGE,
  BIN_ARRAY_FEE,
  POSITION_FEE,
  MAX_BIN_PER_TX,
} from "./constants";
import {
  BinLiquidity,
  ClmmProgram,
  LbPair,
  LbPairAccount,
  Position,
  PositionBinData,
  PositionData,
  TokenReserve,
  TInitializePositionAndAddLiquidityParams,
  BinAndAmount,
  vParameters,
  sParameters,
  BinArrayAccount,
  SwapParams,
  BinArrayBitmapExtensionAccount,
  Bin,
  BinArray,
  LiquidityParameterByWeight,
  LiquidityOneSideParameter,
  BinArrayBitmapExtension,
  PositionVersion,
  LbPosition,
  FeeInfo,
  EmissionRate,
  PositionInfo,
  SwapQuote,
  SwapFee,
  LMRewards,
  TInitializePositionAndAddLiquidityParamsByStrategy,
  LiquidityParameterByStrategy,
  ProgramStrategyParameter,
  LiquidityParameterByStrategyOneSide,
  TQuoteCreatePositionParams,
  InitPermissionPairIx,
  CompressedBinDepositAmounts,
  PositionV2,
  SeedLiquidityResponse,
} from "./types";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import {
  binIdToBinArrayIndex,
  chunks,
  computeFeeFromAmount,
  deriveBinArray,
  deriveBinArrayBitmapExtension,
  deriveReserve,
  getBinArrayLowerUpperBinId,
  getBinFromBinArray,
  getOrCreateATAInstruction,
  getOutAmount,
  getTokenDecimals,
  isBinIdWithinBinArray,
  isOverflowDefaultBinArrayBitmap,
  swapQuoteAtBin,
  unwrapSOLInstruction,
  wrapSOLInstruction,
  findNextBinArrayWithLiquidity,
  getTotalFee,
  toWeightDistribution,
  chunkedGetMultipleAccountInfos,
  deriveOracle,
  computeBudgetIx,
  findNextBinArrayIndexWithLiquidity,
  swapQuoteAtBinWithCap,
  toStrategyParameters,
  derivePermissionLbPair,
  deriveLbPair2,
  derivePosition,
  deriveLbPair,
} from "./helpers";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import Decimal from "decimal.js";
import {
  AccountLayout,
  MintLayout,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Rounding,
  compressBinAmount,
  computeBaseFactorFromFeeBps,
  distributeAmountToCompressedBinsByRatio,
  findSwappableMinMaxBinId,
  generateAmountForBinRange,
  getPositionCount,
  mulShr,
} from "./helpers/math";

type Opt = {
  cluster: Cluster | "localhost";
};

export class DLMM {
  constructor(
    public pubkey: PublicKey,
    public program: ClmmProgram,
    public lbPair: LbPair,
    public binArrayBitmapExtension: BinArrayBitmapExtensionAccount | null,
    public tokenX: TokenReserve,
    public tokenY: TokenReserve,
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
      LBCLMM_PROGRAM_IDS[opt?.cluster ?? "mainnet-beta"],
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
  ) {
    const cluster = opt?.cluster || "mainnet-beta";

    const provider = new AnchorProvider(
      connection,
      {} as any,
      AnchorProvider.defaultOptions()
    );
    const program = new Program(IDL, LBCLMM_PROGRAM_IDS[cluster], provider);

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
    const program = new Program(IDL, LBCLMM_PROGRAM_IDS[cluster], provider);

    const binArrayBitMapExtensionPubkey = deriveBinArrayBitmapExtension(
      dlmm,
      program.programId
    )[0];
    const accountsToFetch = [dlmm, binArrayBitMapExtensionPubkey];

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
    const program = new Program(IDL, LBCLMM_PROGRAM_IDS[cluster], provider);

    const binArrayBitMapExtensions = dlmmList.map(
      (lbPair) => deriveBinArrayBitmapExtension(lbPair, program.programId)[0]
    );
    const accountsToFetch = [...dlmmList, ...binArrayBitMapExtensions];

    const accountsInfo = await chunkedGetMultipleAccountInfos(
      connection,
      accountsToFetch
    );

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
      LBCLMM_PROGRAM_IDS[opt?.cluster ?? "mainnet-beta"],
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
    const program = new Program(IDL, LBCLMM_PROGRAM_IDS[cluster], provider);

    const positions = await program.account.position.all([
      {
        memcmp: {
          bytes: bs58.encode(userPubKey.toBuffer()),
          offset: 8 + 32,
        },
      },
    ]);

    const positionsV2 = await program.account.positionV2.all([
      {
        memcmp: {
          bytes: bs58.encode(userPubKey.toBuffer()),
          offset: 8 + 32,
        },
      },
    ]);

    const binArrayPubkeySet = new Set<string>();
    const lbPairSet = new Set<string>();
    positions.forEach(({ account: { upperBinId, lowerBinId, lbPair } }) => {
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
      binArrayPubkeySet.add(lowerBinArrayPubKey.toBase58());
      binArrayPubkeySet.add(upperBinArrayPubKey.toBase58());
      lbPairSet.add(lbPair.toBase58());
    });
    const binArrayPubkeyArray = Array.from(binArrayPubkeySet).map(
      (pubkey) => new PublicKey(pubkey)
    );
    const lbPairArray = Array.from(lbPairSet).map(
      (pubkey) => new PublicKey(pubkey)
    );

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
        ...binArrayPubkeyArray,
        ...lbPairArray,
        ...binArrayPubkeyArrayV2,
        ...lbPairArrayV2,
      ]);

    const positionBinArraysMap = new Map();
    for (let i = 0; i < binArrayPubkeyArray.length; i++) {
      const binArrayPubkey = binArrayPubkeyArray[i];
      const binArrayAccInfoBuffer = binArraysAccInfo[i];
      if (!binArrayAccInfoBuffer)
        throw new Error(
          `Bin Array account ${binArrayPubkey.toBase58()} not found`
        );
      const binArrayAccInfo = program.coder.accounts.decode(
        "binArray",
        binArrayAccInfoBuffer.data
      );
      positionBinArraysMap.set(binArrayPubkey.toBase58(), binArrayAccInfo);
    }

    const lbPairArraysMap = new Map<string, LbPair>();
    for (
      let i = binArrayPubkeyArray.length;
      i < binArrayPubkeyArray.length + lbPairArray.length;
      i++
    ) {
      const lbPairPubkey = lbPairArray[i - binArrayPubkeyArray.length];
      const lbPairAccInfoBuffer = binArraysAccInfo[i];
      if (!lbPairAccInfoBuffer)
        throw new Error(`LB Pair account ${lbPairPubkey.toBase58()} not found`);
      const lbPairAccInfo = program.coder.accounts.decode(
        "lbPair",
        lbPairAccInfoBuffer.data
      );
      lbPairArraysMap.set(lbPairPubkey.toBase58(), lbPairAccInfo);
    }

    const reservePublicKeys = Array.from(lbPairArraysMap.values())
      .map(({ reserveX, reserveY, tokenXMint, tokenYMint }) => [
        reserveX,
        reserveY,
        tokenXMint,
        tokenYMint,
      ])
      .flat();

    const positionBinArraysMapV2 = new Map();
    for (
      let i = binArrayPubkeyArray.length + lbPairArray.length;
      i <
      binArrayPubkeyArray.length +
        lbPairArray.length +
        binArrayPubkeyArrayV2.length;
      i++
    ) {
      const binArrayPubkey =
        binArrayPubkeyArrayV2[
          i - (binArrayPubkeyArray.length + lbPairArray.length)
        ];
      const binArrayAccInfoBufferV2 = binArraysAccInfo[i];
      if (!binArrayAccInfoBufferV2)
        throw new Error(
          `Bin Array account ${binArrayPubkey.toBase58()} not found`
        );
      const binArrayAccInfo = program.coder.accounts.decode(
        "binArray",
        binArrayAccInfoBufferV2.data
      );
      positionBinArraysMapV2.set(binArrayPubkey.toBase58(), binArrayAccInfo);
    }

    const lbPairArraysMapV2 = new Map<string, LbPair>();
    for (
      let i =
        binArrayPubkeyArray.length +
        lbPairArray.length +
        binArrayPubkeyArrayV2.length;
      i < binArraysAccInfo.length;
      i++
    ) {
      const lbPairPubkey =
        lbPairArrayV2[
          i -
            (binArrayPubkeyArray.length +
              lbPairArray.length +
              binArrayPubkeyArrayV2.length)
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
      [...reservePublicKeys, ...reservePublicKeysV2]
    );

    const lbPairReserveMap = new Map<
      string,
      { reserveX: bigint; reserveY: bigint }
    >();
    const lbPairMintMap = new Map<
      string,
      { mintXDecimal: number; mintYDecimal: number }
    >();
    lbPairArray.forEach((lbPair, idx) => {
      const index = idx * 4;
      const reserveAccBufferX = reserveAccountsInfo[index];
      const reserveAccBufferY = reserveAccountsInfo[index + 1];
      if (!reserveAccBufferX || !reserveAccBufferY)
        throw new Error(
          `Reserve account for LB Pair ${lbPair.toBase58()} not found`
        );
      const reserveAccX = AccountLayout.decode(reserveAccBufferX.data);
      const reserveAccY = AccountLayout.decode(reserveAccBufferY.data);

      lbPairReserveMap.set(lbPair.toBase58(), {
        reserveX: reserveAccX.amount,
        reserveY: reserveAccY.amount,
      });

      const mintXBuffer = reserveAccountsInfo[index + 2];
      const mintYBuffer = reserveAccountsInfo[index + 3];
      if (!mintXBuffer || !mintYBuffer)
        throw new Error(
          `Mint account for LB Pair ${lbPair.toBase58()} not found`
        );
      const mintX = MintLayout.decode(mintXBuffer.data);
      const mintY = MintLayout.decode(mintYBuffer.data);

      lbPairMintMap.set(lbPair.toBase58(), {
        mintXDecimal: mintX.decimals,
        mintYDecimal: mintY.decimals,
      });
    });

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
        reserveAccountsInfo[reservePublicKeys.length + index];
      const reserveAccBufferYV2 =
        reserveAccountsInfo[reservePublicKeys.length + index + 1];
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
        reserveAccountsInfo[reservePublicKeys.length + index + 2];
      const mintYBufferV2 =
        reserveAccountsInfo[reservePublicKeys.length + index + 3];
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
    for (let position of positions) {
      const { account, publicKey: positionPubKey } = position;

      const { upperBinId, lowerBinId, lbPair } = account;
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
      const lowerBinArray = positionBinArraysMap.get(
        lowerBinArrayPubKey.toBase58()
      );
      const upperBinArray = positionBinArraysMap.get(
        upperBinArrayPubKey.toBase58()
      );
      const lbPairAcc = lbPairArraysMap.get(lbPair.toBase58());
      const { mintXDecimal, mintYDecimal } = lbPairMintMap.get(
        lbPair.toBase58()
      );
      const reserveXBalance =
        lbPairReserveMap.get(lbPair.toBase58())?.reserveX ?? BigInt(0);
      const reserveYBalance =
        lbPairReserveMap.get(lbPair.toBase58())?.reserveY ?? BigInt(0);
      const tokenX = {
        publicKey: lbPairAcc.tokenXMint,
        reserve: lbPairAcc.reserveX,
        amount: reserveXBalance,
        decimal: mintXDecimal,
      };
      const tokenY = {
        publicKey: lbPairAcc.tokenYMint,
        reserve: lbPairAcc.reserveY,
        amount: reserveYBalance,
        decimal: mintYDecimal,
      };
      const positionData = await DLMM.processPosition(
        program,
        PositionVersion.V1,
        lbPairAcc,
        onChainTimestamp,
        account,
        mintXDecimal,
        mintYDecimal,
        lowerBinArray,
        upperBinArray,
        PublicKey.default
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
              publicKey: positionPubKey,
              positionData,
              version: PositionVersion.V1,
            },
          ],
        });
      }
    }

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
      const positionData = await DLMM.processPosition(
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

  static async migratePosition(
    connection: Connection,
    positions: PublicKey[],
    newPositions: PublicKey[],
    walletPubkey: PublicKey,
    opt?: Opt
  ): Promise<Transaction[]> {
    const cluster = opt?.cluster || "mainnet-beta";

    const provider = new AnchorProvider(
      connection,
      {} as any,
      AnchorProvider.defaultOptions()
    );
    const program = new Program(IDL, LBCLMM_PROGRAM_IDS[cluster], provider);

    const positionsState = await program.account.position.fetchMultiple(
      positions
    );

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    return Promise.all(
      positionsState.map(async ({ lbPair, lowerBinId }, idx) => {
        const position = positions[idx];
        const lowerBinArrayIndex = binIdToBinArrayIndex(new BN(lowerBinId));
        const upperBinArrayIndex = lowerBinArrayIndex.add(new BN(1));

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

        const migrateTx = await program.methods
          .migratePosition()
          .accounts({
            binArrayLower: lowerBinArrayPubKey,
            binArrayUpper: upperBinArrayPubKey,
            lbPair,
            owner: walletPubkey,
            positionV1: position,
            positionV2: newPositions[idx],
            program: program.programId,
            rentReceiver: walletPubkey,
            systemProgram: SystemProgram.programId,
          })
          .transaction();

        return new Transaction({
          blockhash,
          lastValidBlockHeight,
          feePayer: walletPubkey,
        }).add(migrateTx);
      })
    );
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
    lockDurationInSlot: BN,
    opt?: Opt
  ) {
    const provider = new AnchorProvider(
      connection,
      {} as any,
      AnchorProvider.defaultOptions()
    );
    const program = new Program(IDL, LBCLMM_PROGRAM_IDS[opt.cluster], provider);

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
      lockDurationInSlot,
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
    const program = new Program(IDL, LBCLMM_PROGRAM_IDS[opt.cluster], provider);

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
    const [rewardOneEmissionRate, rewardTwoEmissionRate] =
      this.lbPair.rewardInfos.map(({ rewardRate }) => rewardRate);

    return {
      rewardOne: new Decimal(rewardOneEmissionRate.toString()).div(PRECISION),
      rewardTwo: new Decimal(rewardTwoEmissionRate.toString()).div(PRECISION),
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
    lowerBinArrays?: BinArray,
    upperBinArrays?: BinArray
  ): Promise<{ activeBin: number; bins: BinLiquidity[] }> {
    const bins = await this.getBins(
      this.pubkey,
      lowerBinId,
      upperBinId,
      this.tokenX.decimal,
      this.tokenY.decimal,
      lowerBinArrays,
      upperBinArrays
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
   * The function get the price of a bin based on its bin ID.
   * @param {number} binId - The `binId` parameter is a number that represents the ID of a bin.
   * @returns {number} the calculated price of a bin based on the provided binId.
   */
  public getPriceOfBinByBinId(binId: number): string {
    const binStepNum = new Decimal(this.lbPair.binStep).div(
      new Decimal(BASIS_POINT_MAX)
    );
    return new Decimal(1)
      .add(new Decimal(binStepNum))
      .pow(new Decimal(binId))
      .toString();
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
        this.program.account.position.all([
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

    const [activeBin, positions, positionsV2] = promiseResults;

    if (!activeBin) {
      throw new Error("Error fetching active bin");
    }

    if (!userPubKey) {
      return {
        activeBin,
        userPositions: [],
      };
    }

    if (!positions || !positionsV2) {
      throw new Error("Error fetching positions");
    }

    const binArrayPubkeySet = new Set<string>();
    positions.forEach(({ account: { upperBinId, lowerBinId } }) => {
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
      binArrayPubkeySet.add(lowerBinArrayPubKey.toBase58());
      binArrayPubkeySet.add(upperBinArrayPubKey.toBase58());
    });
    const binArrayPubkeyArray = Array.from(binArrayPubkeySet).map(
      (pubkey) => new PublicKey(pubkey)
    );

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
        ...binArrayPubkeyArray,
        ...binArrayPubkeyArrayV2,
      ]
    );

    const [lbPairAccInfo, clockAccInfo, ...binArraysAccInfo] =
      lbPairAndBinArrays;

    const positionBinArraysMap = new Map();
    for (let i = 0; i < binArrayPubkeyArray.length; i++) {
      const binArrayPubkey = binArrayPubkeyArray[i];
      const binArrayAccBuffer = binArraysAccInfo[i];
      if (!binArrayAccBuffer)
        throw new Error(
          `Bin Array account ${binArrayPubkey.toBase58()} not found`
        );
      const binArrayAccInfo = this.program.coder.accounts.decode(
        "binArray",
        binArrayAccBuffer.data
      );
      positionBinArraysMap.set(binArrayPubkey.toBase58(), binArrayAccInfo);
    }

    const positionBinArraysMapV2 = new Map();
    for (let i = binArrayPubkeyArray.length; i < binArraysAccInfo.length; i++) {
      const binArrayPubkey =
        binArrayPubkeyArrayV2[i - binArrayPubkeyArray.length];
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
    const userPositions = await Promise.all(
      positions.map(async ({ publicKey, account }) => {
        const { lowerBinId, upperBinId } = account;
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
        const lowerBinArray = positionBinArraysMap.get(
          lowerBinArrayPubKey.toBase58()
        );
        const upperBinArray = positionBinArraysMap.get(
          upperBinArrayPubKey.toBase58()
        );
        return {
          publicKey,
          positionData: await DLMM.processPosition(
            this.program,
            PositionVersion.V1,
            this.lbPair,
            onChainTimestamp,
            account,
            this.tokenX.decimal,
            this.tokenY.decimal,
            lowerBinArray,
            upperBinArray,
            PublicKey.default
          ),
          version: PositionVersion.V1,
        };
      })
    );

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
      userPositions: [...userPositions, ...userPositionsV2],
    };
  }

  public async quoteCreatePosition({ strategy }: TQuoteCreatePositionParams) {
    const { minBinId, maxBinId } = strategy;

    const lowerBinArrayIndex = binIdToBinArrayIndex(new BN(minBinId));
    const upperBinArrayIndex = binIdToBinArrayIndex(new BN(maxBinId));

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

    const setComputeUnitLimitIx = computeBudgetIx();
    const preInstructions = [setComputeUnitLimitIx];
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

    const oneSideLiquidityParams: LiquidityParameterByStrategyOneSide = {
      amount: totalXAmount.isZero() ? totalYAmount : totalXAmount,
      activeId,
      maxActiveBinSlippage,
      strategyParameters,
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
      ? this.program.methods.addLiquidityByStrategyOneSide(
          oneSideLiquidityParams
        )
      : this.program.methods.addLiquidityByStrategy(liquidityParams);

    const createPositionTx = await programMethod
      .accounts(
        isOneSideDeposit ? oneSideAddLiquidityAccounts : addLiquidityAccounts
      )
      .preInstructions(preInstructions)
      .postInstructions(postInstructions)
      .transaction();

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");
    return new Transaction({
      blockhash,
      lastValidBlockHeight,
      feePayer: user,
    }).add(createPositionTx);
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

    const setComputeUnitLimitIx = computeBudgetIx();

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
      const addLiqTx = await programMethod
        .accounts(
          isOneSideDeposit ? oneSideAddLiquidityAccounts : addLiquidityAccounts
        )
        .preInstructions([setComputeUnitLimitIx, ...preInstructions])
        .postInstructions(postInstructions)
        .transaction();

      const { blockhash, lastValidBlockHeight } =
        await this.program.provider.connection.getLatestBlockhash("confirmed");
      return new Transaction({
        blockhash,
        lastValidBlockHeight,
        feePayer: user,
      }).add(addLiqTx);
    }

    const addLiqTx = await programMethod
      .accounts(
        isOneSideDeposit ? oneSideAddLiquidityAccounts : addLiquidityAccounts
      )
      .preInstructions([setComputeUnitLimitIx])
      .transaction();

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
    }).add(addLiqTx);
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

    const setComputeUnitLimitIx = computeBudgetIx();
    preInstructions.push(setComputeUnitLimitIx);

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

    const oneSideLiquidityParams: LiquidityParameterByStrategyOneSide = {
      amount: totalXAmount.isZero() ? totalYAmount : totalXAmount,
      activeId,
      maxActiveBinSlippage,
      strategyParameters,
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
      ? this.program.methods.addLiquidityByStrategyOneSide(
          oneSideLiquidityParams
        )
      : this.program.methods.addLiquidityByStrategy(liquidityParams);

    const createPositionTx = await programMethod
      .accounts(
        isOneSideDeposit ? oneSideAddLiquidityAccounts : addLiquidityAccounts
      )
      .preInstructions(preInstructions)
      .postInstructions(postInstructions)
      .transaction();

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");
    return new Transaction({
      blockhash,
      lastValidBlockHeight,
      feePayer: user,
    }).add(createPositionTx);
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

    const setComputeUnitLimitIx = computeBudgetIx();

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
      const addLiqTx = await programMethod
        .accounts(
          isOneSideDeposit ? oneSideAddLiquidityAccounts : addLiquidityAccounts
        )
        .preInstructions([setComputeUnitLimitIx, ...preInstructions])
        .postInstructions(postInstructions)
        .transaction();

      const { blockhash, lastValidBlockHeight } =
        await this.program.provider.connection.getLatestBlockhash("confirmed");
      return new Transaction({
        blockhash,
        lastValidBlockHeight,
        feePayer: user,
      }).add(addLiqTx);
    }

    const addLiqTx = await programMethod
      .accounts(
        isOneSideDeposit ? oneSideAddLiquidityAccounts : addLiquidityAccounts
      )
      .preInstructions([setComputeUnitLimitIx])
      .transaction();

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
    }).add(addLiqTx);
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
    const { lbPair, lowerBinId, owner, feeOwner } =
      await this.program.account.positionV2.fetch(position);

    const { reserveX, reserveY, tokenXMint, tokenYMint } =
      await this.program.account.lbPair.fetch(lbPair);
    const lowerBinArrayIndex = binIdToBinArrayIndex(new BN(lowerBinId));
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
    const setComputeUnitLimitIx = computeBudgetIx();
    preInstructions.push(setComputeUnitLimitIx);

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
          reserveX,
          reserveY,
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

    const removeLiquidityTx = await this.program.methods
      .removeLiquidityByRange(minBinId, maxBinId, bps.toNumber())
      .accounts({
        position,
        lbPair,
        userTokenX,
        userTokenY,
        reserveX,
        reserveY,
        tokenXMint,
        tokenYMint,
        binArrayLower,
        binArrayUpper,
        binArrayBitmapExtension,
        tokenXProgram: TOKEN_PROGRAM_ID,
        tokenYProgram: TOKEN_PROGRAM_ID,
        sender: user,
      })
      .preInstructions(preInstructions)
      .postInstructions(postInstructions)
      .transaction();

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");
    if (secondTransactionsIx.length) {
      const claimRewardsTx = new Transaction({
        blockhash,
        lastValidBlockHeight,
        feePayer: user,
      }).add(...secondTransactionsIx);

      const mainTx = new Transaction({
        blockhash,
        lastValidBlockHeight,
        feePayer: user,
      }).add(removeLiquidityTx);

      return [mainTx, claimRewardsTx];
    } else {
      return new Transaction({
        blockhash,
        lastValidBlockHeight,
        feePayer: user,
      }).add(removeLiquidityTx);
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
   * The `swapQuoteWithCap` function returns a quote for a swap in permission pool
   * @param
   *    - `inAmount`: Amount of lamport to swap in
   *    - `swapForY`: Swap token X to Y when it is true, else reversed.
   *    - `allowedSlipage`: Allowed slippage for the swap. Expressed in BPS. To convert from slippage percentage to BPS unit: SLIPPAGE_PERCENTAGE * 100
   *    - `maxSwappedAmount`: Max swapped amount
   * @returns {SwapQuote}
   *    - `consumedInAmount`: Amount of lamport to swap in
   *    - `outAmount`: Amount of lamport to swap out
   *    - `fee`: Fee amount
   *    - `protocolFee`: Protocol fee amount
   *    - `minOutAmount`: Minimum amount of lamport to swap out
   *    - `priceImpact`: Price impact of the swap
   *    - `binArraysPubkey`: Array of bin arrays involved in the swap
   */
  public swapQuoteWithCap(
    inAmount: BN,
    swapForY: boolean,
    allowedSlippage: BN,
    maxSwappedAmount: BN,
    binArrays: BinArrayAccount[]
  ): SwapQuote {
    // TODO: Should we use onchain clock ? Volatile fee rate is sensitive to time. Caching clock might causes the quoted fee off ...
    const currentTimestamp = Date.now() / 1000;
    let inAmountLeft = inAmount;

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

    while (!inAmountLeft.isZero()) {
      let binArrayAccountToSwap = findNextBinArrayWithLiquidity(
        swapForY,
        activeId,
        this.lbPair,
        this.binArrayBitmapExtension?.account,
        binArrays
      );

      if (binArrayAccountToSwap == null) {
        throw new Error("Insufficient liquidity");
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
        const { isReachCap, amountIn, amountOut, fee, protocolFee } =
          swapQuoteAtBinWithCap(
            bin,
            binStep,
            sParameters,
            vParameterClone,
            inAmountLeft,
            swapForY,
            maxSwappedAmount.sub(actualOutAmount)
          );

        if (!amountIn.isZero()) {
          inAmountLeft = inAmountLeft.sub(amountIn);
          actualOutAmount = actualOutAmount.add(amountOut);
          feeAmount = feeAmount.add(fee);
          protocolFeeAmount = protocolFee.add(protocolFee);

          if (!startBin) {
            startBin = bin;
          }
        }
        if (isReachCap) {
          break;
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

    if (!startBin) throw new Error("Invalid start bin");

    // deduct inAmountLeft
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

    return {
      consumedInAmount: inAmount,
      outAmount: actualOutAmount,
      fee: feeAmount,
      protocolFee: protocolFeeAmount,
      minOutAmount,
      priceImpact,
      binArraysPubkey: [...binArraysForSwap.keys()],
    };
  }

  /**
   * The `swapQuote` function returns a quote for a swap
   * @param
   *    - `inAmount`: Amount of lamport to swap in
   *    - `swapForY`: Swap token X to Y when it is true, else reversed.
   *    - `allowedSlipage`: Allowed slippage for the swap. Expressed in BPS. To convert from slippage percentage to BPS unit: SLIPPAGE_PERCENTAGE * 100
   * @returns {SwapQuote}
   *    - `consumedInAmount`: Amount of lamport to swap in
   *    - `outAmount`: Amount of lamport to swap out
   *    - `fee`: Fee amount
   *    - `protocolFee`: Protocol fee amount
   *    - `minOutAmount`: Minimum amount of lamport to swap out
   *    - `priceImpact`: Price impact of the swap
   *    - `binArraysPubkey`: Array of bin arrays involved in the swap
   */
  public swapQuote(
    inAmount: BN,
    swapForY: boolean,
    allowedSlippage: BN,
    binArrays: BinArrayAccount[]
  ): SwapQuote {
    // TODO: Should we use onchain clock ? Volatile fee rate is sensitive to time. Caching clock might causes the quoted fee off ...
    const currentTimestamp = Date.now() / 1000;
    let inAmountLeft = inAmount;

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

    while (!inAmountLeft.isZero()) {
      let binArrayAccountToSwap = findNextBinArrayWithLiquidity(
        swapForY,
        activeId,
        this.lbPair,
        this.binArrayBitmapExtension?.account,
        binArrays
      );

      if (binArrayAccountToSwap == null) {
        throw new Error("Insufficient liquidity");
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
        const { amountIn, amountOut, fee, protocolFee } = swapQuoteAtBin(
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

    if (!startBin) throw new Error("Invalid start bin");

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

    return {
      consumedInAmount: inAmount,
      outAmount: actualOutAmount,
      fee: feeAmount,
      protocolFee: protocolFeeAmount,
      minOutAmount,
      priceImpact,
      binArraysPubkey: [...binArraysForSwap.keys()],
    };
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
    const { tokenXMint, tokenYMint, reserveX, reserveY, activeId, oracle } =
      await this.program.account.lbPair.fetch(lbPair);

    const preInstructions: TransactionInstruction[] = [computeBudgetIx()];

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
    }

    const postInstructions: Array<TransactionInstruction> = [];
    if (outToken.equals(NATIVE_MINT)) {
      const closeWrappedSOLIx = await unwrapSOLInstruction(user);
      closeWrappedSOLIx && postInstructions.push(closeWrappedSOLIx);
    }

    let swapForY = true;
    if (outToken.equals(tokenXMint)) swapForY = false;

    // TODO: needs some refinement in case binArray not yet initialized
    const binArrays: AccountMeta[] = binArraysPubkey.map((pubkey) => {
      return {
        isSigner: false,
        isWritable: true,
        pubkey,
      };
    });

    const swapTx = await this.program.methods
      .swap(inAmount, minOutAmount)
      .accounts({
        lbPair,
        reserveX,
        reserveY,
        tokenXMint,
        tokenYMint,
        tokenXProgram: TOKEN_PROGRAM_ID, // dont use 2022 first; lack familiarity
        tokenYProgram: TOKEN_PROGRAM_ID, // dont use 2022 first; lack familiarity
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
      .preInstructions(preInstructions)
      .postInstructions(postInstructions)
      .transaction();

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");
    return new Transaction({
      blockhash,
      lastValidBlockHeight,
      feePayer: user,
    }).add(swapTx);
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

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");
    return new Transaction({
      blockhash,
      lastValidBlockHeight,
      feePayer: owner,
    }).add(...claimTransactions);
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
        positions.map(async (position, idx) => {
          return await this.createClaimBuildMethod({
            owner,
            position,
            shouldIncludePreIx: idx === 0,
          });
        })
      )
    ).flat();

    const chunkedClaimAllTx = chunks(claimAllTxs, MAX_CLAIM_ALL_ALLOWED);

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");
    return Promise.all(
      chunkedClaimAllTx.map(async (claimAllTx) => {
        return new Transaction({
          feePayer: owner,
          blockhash,
          lastValidBlockHeight,
        })
          .add(computeBudgetIx())
          .add(...claimAllTx);
      })
    );
  }

  public async setActivationSlot(activationSlot: BN) {
    const setActivationSlotTx = await this.program.methods
      .setActivationSlot(activationSlot)
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
    }).add(setActivationSlotTx);
  }

  /**
   * The function `updateWhitelistedWallet` is used to whitelist a wallet, enabling it to deposit into a permissioned pool before the activation slot.
   * @param
   *    - `walletsToWhitelist`: The public key of the wallet.
   *    - `overrideIndexes`: Index of the whitelisted wallet to be inserted. Check DLMM.lbPair.whitelistedWallet for the index
   * @returns {Promise<Transaction>}
   */
  public async updateWhitelistedWallet(
    walletsToWhitelist: PublicKey[],
    overrideIndexes?: number[]
  ) {
    let emptyIndexes = this.lbPair.whitelistedWallet
      .map((pk, idx) => (pk.equals(PublicKey.default) ? idx : -1))
      .filter((idx) => idx >= 0);

    if (emptyIndexes.length < walletsToWhitelist.length) {
      if (!overrideIndexes) {
        throw new Error(
          "Whitelist wallets are full. Please manually specify index of the wallet to be replaced"
        );
      } else if (overrideIndexes.length != walletsToWhitelist.length) {
        throw new Error(
          "Index provided do not match the number of wallets to be whitelist."
        );
      } else {
        emptyIndexes = overrideIndexes;
      }
    }

    const instructions = [];

    for (const [idx, wallet] of walletsToWhitelist.entries()) {
      const updateWhitelistedWalletIx = await this.program.methods
        .updateWhitelistedWallet(idx, wallet)
        .accounts({
          lbPair: this.pubkey,
          creator: this.lbPair.creator,
        })
        .instruction();

      instructions.push(updateWhitelistedWalletIx);
    }

    const { blockhash, lastValidBlockHeight } =
      await this.program.provider.connection.getLatestBlockhash("confirmed");

    return new Transaction({
      feePayer: this.lbPair.creator,
      blockhash,
      lastValidBlockHeight,
    }).add(...instructions);
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
        positions.map(async (position, idx) => {
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

    return Promise.all(
      chunkedClaimAllTx.map(async (claimAllTx) => {
        const { recentBlockhash, lastValidBlockHeight } = claimAllTx[0];
        return new Transaction({
          feePayer: owner,
          blockhash: recentBlockhash,
          lastValidBlockHeight,
        })
          .add(computeBudgetIx())
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
        const tx = new Transaction({
          feePayer: owner,
          blockhash,
          lastValidBlockHeight,
        }).add(computeBudgetIx());

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
   *    - `operator`: The public key of the operator. Operator can add liquidity for the position owner, withdraw on behalf of position owner (only can withdraw to position owner), and claim fee on behalf of position owner / fee owner (only can claim fee to position / fee owner)
   *    - `feeOwner`: The public key to receive claimed fee.
   *    - `seedAmount`: Lamport amount to be seeded to the pool.
   *    - `minPrice`: Start price in UI format
   *    - `maxPrice`: End price in UI format
   *    - `base`: Base key
   * @returns {Promise<SeedLiquidityResponse>}
   */
  public async seedLiquidity(
    owner: PublicKey,
    operator: PublicKey,
    feeOwner: PublicKey,
    seedAmount: BN,
    curvature: number,
    minPrice: number,
    maxPrice: number,
    base: PublicKey
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

    const initializeBinArraysAndPositionIxs = [];
    const addLiquidityIxs = [];
    const appendedInitBinArrayIx = new Set();

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

      let instructions = [computeBudgetIx()];

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
              funder: operator,
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
              funder: operator,
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
              owner,
              feeOwner
            )
            .accounts({
              lbPair: this.pubkey,
              position: positionPda,
              base,
              operator,
              payer: operator,
            })
            .instruction()
        );
      }

      // Initialize bin arrays and initialize position account in 1 tx
      if (instructions.length > 1) {
        initializeBinArraysAndPositionIxs.push(instructions);
        instructions = [computeBudgetIx()];
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

        addLiquidityIxs.push(instructions);
      }
    }

    return {
      initializeBinArraysAndPositionIxs,
      addLiquidityIxs,
    };
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
  }: {
    lowerBinId: BN;
    positionWidth: BN;
    owner: PublicKey;
    feeOwner: PublicKey;
    operator: PublicKey;
    payer: PublicKey;
    base: PublicKey;
  }): Promise<Transaction> {
    const [positionPda, _bump] = derivePosition(
      this.pubkey,
      base,
      lowerBinId,
      positionWidth,
      this.program.programId
    );
    let initializePositionByOperatorTx = await this.program.methods
      .initializePositionByOperator(
        lowerBinId.toNumber(),
        MAX_BIN_PER_POSITION.toNumber(),
        owner,
        feeOwner
      )
      .accounts({
        lbPair: this.pubkey,
        position: positionPda,
        base,
        operator,
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
        positions.map(async (position) => {
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
        positions.map(async (position) => {
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
        const tx = new Transaction({
          feePayer: owner,
          blockhash,
          lastValidBlockHeight,
        }).add(computeBudgetIx());

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

      let posShare;
      if (bin.version === 1 && version === PositionVersion.V1) {
        posShare = new Decimal(posShares[idx].shln(64).toString());
      } else {
        posShare = new Decimal(posShares[idx].toString());
      }
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
          const pricePerLamport = this.getPriceOfBinByBinId(
            lbPair.binStep,
            binId
          );
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
            const pricePerLamport = this.getPriceOfBinByBinId(
              lbPair.binStep,
              binId
            );
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

  private static getPriceOfBinByBinId(binStep: number, binId: number): string {
    const binStepNum = new Decimal(binStep).div(new Decimal(BASIS_POINT_MAX));
    return new Decimal(1)
      .add(new Decimal(binStepNum))
      .pow(new Decimal(binId))
      .toString();
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
    lowerBinArrays?: BinArray,
    upperBinArrays?: BinArray
  ): Promise<BinLiquidity[]> {
    const lowerBinArrayIndex = binIdToBinArrayIndex(new BN(lowerBinId));
    const upperBinArrayIndex = binIdToBinArrayIndex(new BN(upperBinId));

    let bins: BinLiquidity[] = [];
    if (lowerBinArrayIndex.eq(upperBinArrayIndex)) {
      const [binArrayPubKey] = deriveBinArray(
        lbPairPubKey,
        lowerBinArrayIndex,
        this.program.programId
      );
      const binArray =
        lowerBinArrays ??
        (await this.program.account.binArray.fetch(binArrayPubKey).catch(() => {
          const [lowerBinId, upperBinId] =
            getBinArrayLowerUpperBinId(lowerBinArrayIndex);

          const binArrayBins: Bin[] = [];
          for (let i = lowerBinId.toNumber(); i <= upperBinId.toNumber(); i++) {
            const binId = new BN(i);
            const pricePerLamport = this.getPriceOfBinByBinId(binId.toNumber());
            binArrayBins.push({
              amountX: new BN(0),
              amountY: new BN(0),
              liquiditySupply: new BN(0),
              rewardPerTokenStored: [new BN(0), new BN(0)],
              amountXIn: new BN(0),
              amountYIn: new BN(0),
              feeAmountXPerTokenStored: new BN(0),
              feeAmountYPerTokenStored: new BN(0),
              price: new BN(0),
            });
          }

          return {
            bins: binArrayBins,
            index: lowerBinArrayIndex,
            version: 1,
          };
        }));

      const [lowerBinIdForBinArray] = getBinArrayLowerUpperBinId(
        binArray.index
      );

      binArray.bins.forEach((bin, idx) => {
        const binId = lowerBinIdForBinArray.toNumber() + idx;

        if (binId >= lowerBinId && binId <= upperBinId) {
          const pricePerLamport = this.getPriceOfBinByBinId(binId);
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
      const [lowerBinArrayPubKey] = deriveBinArray(
        lbPairPubKey,
        lowerBinArrayIndex,
        this.program.programId
      );
      const [upperBinArrayPubKey] = deriveBinArray(
        lbPairPubKey,
        upperBinArrayIndex,
        this.program.programId
      );

      const binArrays = await (async () => {
        if (!lowerBinArrays || !upperBinArrays) {
          return (
            await this.program.account.binArray.fetchMultiple([
              lowerBinArrayPubKey,
              upperBinArrayPubKey,
            ])
          ).filter((binArray) => binArray !== null);
        }

        return [lowerBinArrays, upperBinArrays];
      })();

      binArrays.forEach((binArray) => {
        if (!binArray) return;
        const [lowerBinIdForBinArray] = getBinArrayLowerUpperBinId(
          binArray.index
        );
        binArray.bins.forEach((bin, idx) => {
          const binId = lowerBinIdForBinArray.toNumber() + idx;
          if (binId >= lowerBinId && binId <= upperBinId) {
            const pricePerLamport = this.getPriceOfBinByBinId(binId);
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
      const [binArray] = deriveBinArray(
        this.pubkey,
        idx,
        this.program.programId
      );
      const binArrayAccount =
        await this.program.provider.connection.getAccountInfo(binArray);

      if (binArrayAccount === null) {
        binArrays.push(binArray);
      }
    }
    return binArrays;
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
