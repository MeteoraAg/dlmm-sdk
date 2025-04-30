import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { chunkedGetMultipleAccountInfos, decodeAccount } from ".";
import { LbClmm } from "../idl";
import {
  Bin,
  BinArray,
  Clock,
  PositionBinData,
  PositionData,
  RewardInfos,
  StrategyType,
} from "../types";
import {
  binIdToBinArrayIndex,
  getBinArrayLowerUpperBinId,
  getBinIdIndexInBinArray,
  updateBinArray,
} from "./binArray";
import { deriveBinArray } from "./derive";
import { DLMM } from "..";

interface RebalanceWithDeposit {
  /// minBinId = activeId + minDeltaId
  minDeltaId: BN;
  /// maxBinId = activeId + maxDeltaId
  maxDeltaId: BN;
  /// Amount X to be deposited into bin range of minBinId to maxBinId
  amountX: BN;
  /// Amount Y to be deposited into bin range of minBinId to maxBinId
  amountY: BN;
  /// Strategy type for token X
  strategyX: StrategyType;
  /// Strategy type for token Y
  strategyY: StrategyType;
  /// Deposit token X or Y in active bin
  favorXInActiveBin: boolean;
}

interface RebalanceWithWithdraw {
  /// Withdraw start from minBinId. When it's `null`, it will start from activeId.
  minBinId: BN | null;
  /// Withdraw end at maxBinId. When it's `null`, it will end at activeId.
  maxBinId: BN | null;
  /// BPS of liquidity to be withdrawn from minBinId to maxBinId
  bps: BN;
}

interface SimulateRebalanceParams {
  positionData: PositionData;
  shouldClaimFee: boolean;
  shouldClaimReward: boolean;
  deposits: RebalanceWithDeposit[];
  withdraws: RebalanceWithWithdraw[];
}

interface SimulateRebalanceResp {}

function deltaIdToBinRange(
  activeId: BN,
  minDeltaId: BN,
  maxDeltaId: BN
): [BN, BN] {
  const minBinId = activeId.add(minDeltaId);
  const maxBinId = activeId.add(maxDeltaId);
  return [minBinId, maxBinId];
}

function binRangeToBinIdArray(minBinId: BN, maxBinId: BN): BN[] {
  const binIdArray = [];

  const fromBinId = minBinId.toNumber();
  const toBinId = maxBinId.toNumber();

  for (let binId = fromBinId; binId <= toBinId; binId++) {
    binIdArray.push(new BN(binId));
  }

  return binIdArray;
}

/// Fetch required bin arrays from the cluster for simulating position rebalancing
async function fetchPositionRebalanceSimulationBinArrays(
  program: Program<LbClmm>,
  pairAddress: PublicKey,
  activeId: BN,
  deposits: RebalanceWithDeposit[],
  withdraws: RebalanceWithWithdraw[]
): Promise<Map<String, BinArray>> {
  const uniqueBinArrayAddress = new Set<String>();

  const generateBinArrayAddressForRange = (fromBinId: BN, toBinId: BN) => {
    let binArrayIndex = binIdToBinArrayIndex(fromBinId);
    let [_, upperBinId] = getBinArrayLowerUpperBinId(binArrayIndex);

    while (true) {
      const binArrayAddress = deriveBinArray(
        pairAddress,
        binArrayIndex,
        program.programId
      )[0].toString();

      uniqueBinArrayAddress.add(binArrayAddress);

      // If the current bin array includes the full range, we're done
      if (toBinId.lt(upperBinId)) break;

      // Move to the next bin array index
      binArrayIndex = binArrayIndex.add(new BN(1));
      [_, upperBinId] = getBinArrayLowerUpperBinId(binArrayIndex);
    }
  };

  for (const { minDeltaId, maxDeltaId } of deposits) {
    const [minBinId, maxBinId] = deltaIdToBinRange(
      activeId,
      minDeltaId,
      maxDeltaId
    );
    generateBinArrayAddressForRange(minBinId, maxBinId);
  }

  for (const { minBinId, maxBinId } of withdraws) {
    if (minBinId == null && maxBinId == null) {
      continue;
    }
    const fromBinId = minBinId ?? activeId;
    const toBinId = maxBinId ?? activeId;
    generateBinArrayAddressForRange(fromBinId, toBinId);
  }

  const binArrayKeys = Array.from(uniqueBinArrayAddress).map(
    (address) => new PublicKey(address)
  );
  const binArrayAccounts = await chunkedGetMultipleAccountInfos(
    program.provider.connection,
    binArrayKeys
  );

  return new Map(
    binArrayAccounts.map((account, idx) => {
      const address = binArrayKeys[idx].toString();
      const binArrayState = decodeAccount<BinArray>(
        program,
        "binArray",
        account.data
      );
      return [address, binArrayState];
    })
  );
}

function updateActiveBinArrayRewards(
  binArrays: Map<String, BinArray>,
  pair: DLMM
) {
  const activeId = new BN(pair.lbPair.activeId);

  const activeBinArrayIndex = binIdToBinArrayIndex(activeId);

  const [activeBinArrayAddress] = deriveBinArray(
    pair.pubkey,
    activeBinArrayIndex,
    pair.program.programId
  );

  const activeBinArray = binArrays.get(activeBinArrayAddress.toString());

  if (!activeBinArray) {
    return;
  }

  const updatedActiveBinArray = updateBinArray(
    activeId,
    pair.clock,
    pair.lbPair.rewardInfos,
    activeBinArray
  );

  binArrays.set(activeBinArrayAddress.toString(), updatedActiveBinArray);
}

async function simulateBinRebalanceWithdraw(
  positionBinData: PositionBinData,
  bin: Bin,
  shouldClaimFee: boolean,
  shouldClaimReward: boolean
) {
  const {
    binId,
    positionLiquidity,
    positionXAmount,
    positionYAmount,
    positionFeeXAmount,
    positionFeeYAmount,
    positionRewardAmount,
  } = positionBinData;
}

async function simulateRebalanceWithdraw(
  positionData: PositionData,
  withdraws: RebalanceWithWithdraw[],
  shouldClaimFee: boolean,
  shouldClaimReward: boolean,
  binArrays: Map<String, BinArray>,
  pair: DLMM
) {
  if (withdraws.length == 0) {
    return;
  }

  for (const { minBinId, maxBinId } of withdraws) {
    const fromBinId = new BN(minBinId ?? pair.lbPair.activeId);
    const toBinId = new BN(maxBinId ?? pair.lbPair.activeId);

    const binIdArray = binRangeToBinIdArray(fromBinId, toBinId).filter(
      (binId) =>
        binId.gten(positionData.lowerBinId) &&
        binId.lten(positionData.upperBinId)
    );
    let binId = binIdArray.shift();

    let binArrayIndex = binIdToBinArrayIndex(fromBinId);
    let [binArrayAddress] = deriveBinArray(
      pair.pubkey,
      binArrayIndex,
      pair.program.programId
    );
    let binArray = binArrays.get(binArrayAddress.toString());
    let [lowerBinId, upperBinId] = getBinArrayLowerUpperBinId(binArrayIndex);

    while (true) {
      if (!binId) {
        break;
      }

      if (!binArray) {
        throw "bin array not found during rebalance withdraw";
      }

      if (binId.gte(lowerBinId) && binId.lte(upperBinId)) {
        const positionBinData = positionData.positionBinData.find(
          (bin) => bin.binId == binId.toNumber()
        );

        const binIdx = getBinIdIndexInBinArray(
          binId,
          lowerBinId,
          upperBinId
        ).toNumber();

        const bin = binArray.bins[binIdx];

        binId = binIdArray.shift();
      } else {
        binArrayIndex = binArrayIndex.add(new BN(1));
        [binArrayAddress] = deriveBinArray(
          pair.pubkey,
          binArrayIndex,
          pair.program.programId
        );
        binArray = binArrays.get(binArrayAddress.toString());
        [lowerBinId, upperBinId] = getBinArrayLowerUpperBinId(binArrayIndex);
      }
    }
  }
}

/// Simulate position state after rebalancing.
async function simulatePositionRebalance(
  pair: DLMM,
  params: SimulateRebalanceParams
) {
  const {
    deposits,
    withdraws,
    positionData,
    shouldClaimFee,
    shouldClaimReward,
  } = params;

  const binArrays = await fetchPositionRebalanceSimulationBinArrays(
    pair.program,
    pair.pubkey,
    new BN(pair.lbPair.activeId),
    deposits,
    withdraws
  );

  updateActiveBinArrayRewards(binArrays, pair);
}
