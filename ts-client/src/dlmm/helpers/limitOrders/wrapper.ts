import { Program } from "@coral-xyz/anchor";
import { Mint } from "@solana/spl-token";
import { AccountInfo, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { decodeLimitOrderBinData } from ".";
import {
  binIdToBinArrayIndex,
  decodeAccount,
  deriveBinArray,
  getAccountDiscriminator,
  getAmountIn,
  getBinFromBinArray,
} from "..";
import { CollectFeeMode } from "../../constants";
import { LbClmm } from "../../idl/idl";
import {
  Bin,
  BinArray,
  Clock,
  LbPair,
  LIMIT_ORDER_MIN_SIZE,
  LimitOrder,
  LimitOrderBinData,
  LimitOrderStatus,
} from "../../types";
import { Rounding } from "../math";
import { calculateTransferFeeExcludedAmount } from "../token_2022";

export interface ILimitOrderBinData {
  amount(): BN;
  age(): number;
  binId(): number;
  isAsk(): boolean;
  isEmpty(): boolean;
}

export interface ILimitOrder {
  address(): PublicKey;
  lbPair(): PublicKey;
  owner(): PublicKey;
  binCount(): number;
  orders(): ILimitOrderBinData[];
  getBinArrayIndexesCoverage(): BN[];
  getBinArrayKeysCoverage(programId: PublicKey): PublicKey[];
  parseInfo(
    programId: PublicKey,
    lbPair: LbPair,
    baseMint: Mint,
    quoteMint: Mint,
    clock: Clock,
    binArrayMap: Map<String, BinArray>,
  ): ParsedLimitOrder;
}

export interface ParsedLimitOrderBinData {
  binId: number;
  empty: boolean;
  depositAmountX: string;
  depositAmountY: string;
  unfilledAmountX: string;
  unfilledAmountY: string;
  swappedAmountX: string;
  swappedAmountY: string;
  isAskSide: boolean;
  filledAmountX: string;
  filledAmountY: string;
  feeAmountX: string;
  feeAmountY: string;
  status: LimitOrderStatus;
}

export interface ParsedLimitOrder {
  totalDepositAmountX: string;
  totalDepositAmountY: string;
  limitOrderBinData: ParsedLimitOrderBinData[];
  totalUnfilledAmountX: string;
  totalUnfilledAmountY: string;
  totalFilledAmountX: string;
  totalFilledAmountY: string;
  totalSwappedAmountX: string;
  totalSwappedAmountY: string;
  totalFeeAmountX: string;
  totalFeeAmountY: string;
  transferFeeExcludedWithdrawableAmountX: string;
  transferFeeExcludedWithdrawableAmountY: string;
}

export class LimitOrderBinDataWrapper implements ILimitOrderBinData {
  constructor(public inner: LimitOrderBinData) {}

  amount(): BN {
    return this.inner.amount;
  }

  age(): number {
    return this.inner.age;
  }

  binId(): number {
    return this.inner.binId;
  }

  isAsk(): boolean {
    return Boolean(this.inner.isAsk);
  }

  isEmpty(): boolean {
    return this.inner.age == 0 && this.inner.amount.isZero();
  }
}

export class LimitOrderV1Wrapper implements ILimitOrder {
  constructor(
    public limitOrderAddress: PublicKey,
    public inner: LimitOrder,
    public limitOrderBinData: ILimitOrderBinData[],
  ) {}

  address(): PublicKey {
    return this.limitOrderAddress;
  }

  lbPair(): PublicKey {
    return this.inner.lbPair;
  }

  owner(): PublicKey {
    return this.inner.owner;
  }

  binCount(): number {
    return this.inner.binCount;
  }

  orders(): ILimitOrderBinData[] {
    return this.limitOrderBinData;
  }

  getBinArrayIndexesCoverage(): BN[] {
    const binArrayIndexes = new Set<number>();
    for (const bin of this.limitOrderBinData) {
      const binArrayIndex = binIdToBinArrayIndex(new BN(bin.binId()));
      binArrayIndexes.add(binArrayIndex.toNumber());
    }

    return [...binArrayIndexes].map((index) => new BN(index));
  }

  getBinArrayKeysCoverage(programId: PublicKey): PublicKey[] {
    return this.getBinArrayIndexesCoverage().map(
      (index) => deriveBinArray(this.lbPair(), index, programId)[0],
    );
  }

  parseInfo(
    programId: PublicKey,
    lbPair: LbPair,
    baseMint: Mint,
    quoteMint: Mint,
    clock: Clock,
    binArrayMap: Map<string, BinArray>,
  ): ParsedLimitOrder {
    let totalAmountXDeposited = new BN(0);
    let totalAmountYDeposited = new BN(0);
    let totalFilledAmountX = new BN(0);
    let totalFilledAmountY = new BN(0);
    let totalUnfilledAmountX = new BN(0);
    let totalUnfilledAmountY = new BN(0);
    let totalSwappedAmountX = new BN(0);
    let totalSwappedAmountY = new BN(0);
    let totalFeeAmountX = new BN(0);
    let totalFeeAmountY = new BN(0);

    const collectFeeMode: CollectFeeMode = lbPair.parameters.collectFeeMode;
    const parsedLimitOrderBinData: ParsedLimitOrderBinData[] = [];

    const tokenXUiMultiplier = new Decimal(10).pow(
      new Decimal(baseMint.decimals),
    );
    const tokenYUiMultiplier = new Decimal(10).pow(
      new Decimal(quoteMint.decimals),
    );

    for (const loBin of this.limitOrderBinData) {
      const binArrayIndex = binIdToBinArrayIndex(new BN(loBin.binId()));
      const binArrayPubkey = deriveBinArray(
        this.lbPair(),
        binArrayIndex,
        programId,
      )[0];

      const binArrayState = binArrayMap.get(binArrayPubkey.toString());
      if (!binArrayState) {
        throw new Error("Missing bin array for limit order");
      }

      const bin = getBinFromBinArray(loBin.binId(), binArrayState);
      if (!bin) {
        throw new Error("Missing bin for limit order");
      }

      const limitOrderStatus = getLimitOrderStatus(loBin, bin);

      const updatedLimitOrderAmount = getUpdatedLimitOrderAmount(
        limitOrderStatus,
        loBin,
        bin,
        collectFeeMode,
      );

      let depositAmountX = new BN(0);
      let depositAmountY = new BN(0);
      let swappedAmountX = new BN(0);
      let swappedAmountY = new BN(0);
      let filledAmountX = new BN(0);
      let filledAmountY = new BN(0);
      let unFilledAmountX = new BN(0);
      let unFilledAmountY = new BN(0);
      let feeAmountX = new BN(0);
      let feeAmountY = new BN(0);

      if (loBin.isAsk()) {
        depositAmountX = loBin.amount();
        filledAmountX = updatedLimitOrderAmount.fulFilledAmount;
        unFilledAmountX = updatedLimitOrderAmount.unFilledAmount;
        swappedAmountY = updatedLimitOrderAmount.swappedAmount;
      } else {
        depositAmountY = loBin.amount();
        filledAmountY = updatedLimitOrderAmount.fulFilledAmount;
        unFilledAmountY = updatedLimitOrderAmount.unFilledAmount;
        swappedAmountX = updatedLimitOrderAmount.swappedAmount;
      }

      feeAmountX = updatedLimitOrderAmount.feeXAmount;
      feeAmountY = updatedLimitOrderAmount.feeYAmount;

      totalFeeAmountX = totalFeeAmountX.add(feeAmountX);
      totalFeeAmountY = totalFeeAmountY.add(feeAmountY);
      totalAmountXDeposited = totalAmountXDeposited.add(depositAmountX);
      totalAmountYDeposited = totalAmountYDeposited.add(depositAmountY);
      totalFilledAmountX = totalFilledAmountX.add(filledAmountX);
      totalFilledAmountY = totalFilledAmountY.add(filledAmountY);
      totalUnfilledAmountX = totalUnfilledAmountX.add(unFilledAmountX);
      totalUnfilledAmountY = totalUnfilledAmountY.add(unFilledAmountY);
      totalSwappedAmountX = totalSwappedAmountX.add(swappedAmountX);
      totalSwappedAmountY = totalSwappedAmountY.add(swappedAmountY);

      parsedLimitOrderBinData.push({
        binId: loBin.binId(),
        empty: loBin.isEmpty(),
        depositAmountX: new Decimal(depositAmountX.toString())
          .div(tokenXUiMultiplier)
          .toString(),
        depositAmountY: new Decimal(depositAmountY.toString())
          .div(tokenYUiMultiplier)
          .toString(),
        unfilledAmountX: new Decimal(unFilledAmountX.toString())
          .div(tokenXUiMultiplier)
          .toString(),
        unfilledAmountY: new Decimal(unFilledAmountY.toString())
          .div(tokenYUiMultiplier)
          .toString(),
        swappedAmountX: new Decimal(swappedAmountX.toString())
          .div(tokenXUiMultiplier)
          .toString(),
        swappedAmountY: new Decimal(swappedAmountY.toString())
          .div(tokenYUiMultiplier)
          .toString(),
        isAskSide: loBin.isAsk(),
        filledAmountX: new Decimal(filledAmountX.toString())
          .div(tokenXUiMultiplier)
          .toString(),
        filledAmountY: new Decimal(filledAmountY.toString())
          .div(tokenYUiMultiplier)
          .toString(),
        feeAmountX: new Decimal(feeAmountX.toString())
          .div(tokenXUiMultiplier)
          .toString(),
        feeAmountY: new Decimal(feeAmountY.toString())
          .div(tokenYUiMultiplier)
          .toString(),
        status: limitOrderStatus,
      });
    }

    const totalXAmount = totalFeeAmountX
      .add(totalSwappedAmountX)
      .add(totalUnfilledAmountX);

    const totalYAmount = totalFeeAmountY
      .add(totalSwappedAmountY)
      .add(totalUnfilledAmountY);

    const transferFeeExcludedWithdrawableAmountX =
      calculateTransferFeeExcludedAmount(
        totalXAmount,
        baseMint,
        clock.epoch.toNumber(),
      ).amount;

    const transferFeeExcludedWithdrawableAmountY =
      calculateTransferFeeExcludedAmount(
        totalYAmount,
        quoteMint,
        clock.epoch.toNumber(),
      ).amount;

    return {
      totalDepositAmountX: new Decimal(totalAmountXDeposited.toString())
        .div(tokenXUiMultiplier)
        .toString(),
      totalDepositAmountY: new Decimal(totalAmountYDeposited.toString())
        .div(tokenYUiMultiplier)
        .toString(),
      limitOrderBinData: parsedLimitOrderBinData,
      totalUnfilledAmountX: new Decimal(totalUnfilledAmountX.toString())
        .div(tokenXUiMultiplier)
        .toString(),
      totalUnfilledAmountY: new Decimal(totalUnfilledAmountY.toString())
        .div(tokenYUiMultiplier)
        .toString(),
      totalFilledAmountX: new Decimal(totalFilledAmountX.toString())
        .div(tokenXUiMultiplier)
        .toString(),
      totalFilledAmountY: new Decimal(totalFilledAmountY.toString())
        .div(tokenYUiMultiplier)
        .toString(),
      totalSwappedAmountX: new Decimal(totalSwappedAmountX.toString())
        .div(tokenXUiMultiplier)
        .toString(),
      totalSwappedAmountY: new Decimal(totalSwappedAmountY.toString())
        .div(tokenYUiMultiplier)
        .toString(),
      totalFeeAmountX: new Decimal(totalFeeAmountX.toString())
        .div(tokenXUiMultiplier)
        .toString(),
      totalFeeAmountY: new Decimal(totalFeeAmountY.toString())
        .div(tokenYUiMultiplier)
        .toString(),
      transferFeeExcludedWithdrawableAmountX: new Decimal(
        transferFeeExcludedWithdrawableAmountX.toString(),
      )
        .div(tokenXUiMultiplier)
        .toString(),
      transferFeeExcludedWithdrawableAmountY: new Decimal(
        transferFeeExcludedWithdrawableAmountY.toString(),
      )
        .div(tokenYUiMultiplier)
        .toString(),
    };
  }
}

function getUpdatedLimitOrderAmount(
  limitOrderStatus: LimitOrderStatus,
  limitOrderData: ILimitOrderBinData,
  bin: Bin,
  collectFeeMode: CollectFeeMode,
): {
  fulFilledAmount: BN;
  unFilledAmount: BN;
  swappedAmount: BN;
  feeXAmount: BN;
  feeYAmount: BN;
} {
  let fulFilledAmount = new BN(0);
  let unFilledAmount = new BN(0);

  switch (limitOrderStatus) {
    case LimitOrderStatus.NotFilled:
      unFilledAmount = limitOrderData.amount();
      break;
    case LimitOrderStatus.PartialFilled:
      unFilledAmount = limitOrderData
        .amount()
        .mul(bin.processedOrderRemainingAmount)
        .add(bin.totalProcessingOrderAmount.sub(new BN(1)))
        .div(bin.totalProcessingOrderAmount);

      fulFilledAmount = limitOrderData.amount().sub(unFilledAmount);
      break;
    case LimitOrderStatus.Fulfilled:
      fulFilledAmount = limitOrderData.amount();
      break;
  }

  const swappedAmount = getAmountIn(
    fulFilledAmount,
    bin.price,
    !limitOrderData.isAsk(),
    Rounding.Down,
  );

  const { feeX, feeY } = calculateLimitOrderFee(
    fulFilledAmount,
    limitOrderData.isAsk(),
    collectFeeMode,
    bin,
  );

  return {
    fulFilledAmount,
    unFilledAmount,
    swappedAmount,
    feeXAmount: feeX,
    feeYAmount: feeY,
  };
}

function calculateLimitOrderFee(
  fulfilledAmount: BN,
  isAskSide: boolean,
  collectFeeMode: CollectFeeMode,
  bin: Bin,
): {
  feeX: BN;
  feeY: BN;
} {
  if (
    fulfilledAmount.isZero() ||
    (bin.fulfilledOrderAmountX.isZero() && isAskSide) ||
    (bin.fulfilledOrderAmountY.isZero() && !isAskSide)
  ) {
    return {
      feeX: new BN(0),
      feeY: new BN(0),
    };
  }

  let limitOrderFee = new BN(0);

  if (isAskSide) {
    limitOrderFee = bin.limitOrderFeeAskSide
      .mul(fulfilledAmount)
      .div(bin.fulfilledOrderAmountX);
  } else {
    limitOrderFee = bin.limitOrderFeeBidSide
      .mul(fulfilledAmount)
      .div(bin.fulfilledOrderAmountY);
  }

  switch (collectFeeMode) {
    case CollectFeeMode.InputOnly:
      if (isAskSide) {
        return {
          feeX: new BN(0),
          feeY: limitOrderFee,
        };
      } else {
        return {
          feeX: limitOrderFee,
          feeY: new BN(0),
        };
      }
    case CollectFeeMode.OnlyY:
      return {
        feeX: new BN(0),
        feeY: limitOrderFee,
      };
  }
}

function getLimitOrderStatus(
  limitOrderBinData: ILimitOrderBinData,
  bin: Bin,
): LimitOrderStatus {
  if (limitOrderBinData.age() == bin.orderAge) {
    return LimitOrderStatus.NotFilled;
  } else if (limitOrderBinData.age() + 1 == bin.orderAge) {
    if (
      bin.openOrderAmount.isZero() &&
      bin.processedOrderRemainingAmount.isZero()
    ) {
      return LimitOrderStatus.Fulfilled;
    } else {
      return LimitOrderStatus.PartialFilled;
    }
  } else if (limitOrderBinData.age() + 2 <= bin.orderAge) {
    return LimitOrderStatus.Fulfilled;
  } else {
    throw new Error("Fail to get limit order status");
  }
}

export function wrapLimitOrder(
  program: Program<LbClmm>,
  key: PublicKey,
  account: AccountInfo<Buffer>,
): ILimitOrder {
  const disc = account.data.subarray(0, 8);
  if (disc.equals(Buffer.from(getAccountDiscriminator("limitOrder")))) {
    const state = decodeAccount<LimitOrder>(
      program,
      "limitOrder",
      account.data,
    );

    const limitOrderBinData = decodeLimitOrderBinData(
      state,
      program,
      account.data.subarray(8 + LIMIT_ORDER_MIN_SIZE),
    ).map((binData) => new LimitOrderBinDataWrapper(binData));

    return new LimitOrderV1Wrapper(key, state, limitOrderBinData);
  } else {
    throw new Error("Unknown position account");
  }
}
