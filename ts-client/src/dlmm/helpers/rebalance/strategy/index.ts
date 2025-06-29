import BN from "bn.js";
import { BASIS_POINT_MAX } from "../../../constants";
import {
  RebalanceWithDeposit,
  RebalanceWithWithdraw,
} from "../rebalancePosition";

export interface RebalanceDepositWithdrawParameters {
  shouldClaimFee: boolean;
  shouldClaimReward: boolean;
  deposits: RebalanceWithDeposit[];
  withdraws: RebalanceWithWithdraw[];
}

export interface RebalanceStrategyBuilder {
  buildRebalanceStrategyParameters(): RebalanceDepositWithdrawParameters;
}

export const MAX_BPS = new BN(BASIS_POINT_MAX);

export function capBps(bps: BN) {
  return bps.lt(new BN(0))
    ? new BN(0)
    : bps.gt(MAX_BPS)
    ? new BN(MAX_BPS)
    : bps;
}
