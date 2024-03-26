import BN from "bn.js";
import { SCALE_OFFSET } from "../constants";

const MAX_EXPONENTIAL = new BN(0x80000);

export const ONE = new BN(1).shln(SCALE_OFFSET);
const MAX = new BN(2).pow(new BN(128)).sub(new BN(1));

export function pow(base: BN, exp: BN): BN {
  let invert = exp.isNeg();

  if (exp.isZero()) {
    return ONE;
  }

  exp = invert ? exp.abs() : exp;

  if (exp.gt(MAX_EXPONENTIAL)) {
    return new BN(0);
  }

  let squaredBase = base;
  let result = ONE;

  if (squaredBase.gte(result)) {
    squaredBase = MAX.div(squaredBase);
    invert = !invert;
  }

  if (!exp.and(new BN(0x1)).isZero()) {
    result = result.mul(squaredBase).shrn(SCALE_OFFSET);
  }

  squaredBase = squaredBase.mul(squaredBase).shrn(SCALE_OFFSET);

  if (!exp.and(new BN(0x2)).isZero()) {
    result = result.mul(squaredBase).shrn(SCALE_OFFSET);
  }

  squaredBase = squaredBase.mul(squaredBase).shrn(SCALE_OFFSET);

  if (!exp.and(new BN(0x4)).isZero()) {
    result = result.mul(squaredBase).shrn(SCALE_OFFSET);
  }

  squaredBase = squaredBase.mul(squaredBase).shrn(SCALE_OFFSET);

  if (!exp.and(new BN(0x8)).isZero()) {
    result = result.mul(squaredBase).shrn(SCALE_OFFSET);
  }

  squaredBase = squaredBase.mul(squaredBase).shrn(SCALE_OFFSET);

  if (!exp.and(new BN(0x10)).isZero()) {
    result = result.mul(squaredBase).shrn(SCALE_OFFSET);
  }

  squaredBase = squaredBase.mul(squaredBase).shrn(SCALE_OFFSET);

  if (!exp.and(new BN(0x20)).isZero()) {
    result = result.mul(squaredBase).shrn(SCALE_OFFSET);
  }

  squaredBase = squaredBase.mul(squaredBase).shrn(SCALE_OFFSET);

  if (!exp.and(new BN(0x40)).isZero()) {
    result = result.mul(squaredBase).shrn(SCALE_OFFSET);
  }

  squaredBase = squaredBase.mul(squaredBase).shrn(SCALE_OFFSET);

  if (!exp.and(new BN(0x80)).isZero()) {
    result = result.mul(squaredBase).shrn(SCALE_OFFSET);
  }

  squaredBase = squaredBase.mul(squaredBase).shrn(SCALE_OFFSET);

  if (!exp.and(new BN(0x100)).isZero()) {
    result = result.mul(squaredBase).shrn(SCALE_OFFSET);
  }

  squaredBase = squaredBase.mul(squaredBase).shrn(SCALE_OFFSET);

  if (!exp.and(new BN(0x200)).isZero()) {
    result = result.mul(squaredBase).shrn(SCALE_OFFSET);
  }

  squaredBase = squaredBase.mul(squaredBase).shrn(SCALE_OFFSET);

  if (!exp.and(new BN(0x400)).isZero()) {
    result = result.mul(squaredBase).shrn(SCALE_OFFSET);
  }

  squaredBase = squaredBase.mul(squaredBase).shrn(SCALE_OFFSET);

  if (!exp.and(new BN(0x800)).isZero()) {
    result = result.mul(squaredBase).shrn(SCALE_OFFSET);
  }

  squaredBase = squaredBase.mul(squaredBase).shrn(SCALE_OFFSET);

  if (!exp.and(new BN(0x1000)).isZero()) {
    result = result.mul(squaredBase).shrn(SCALE_OFFSET);
  }

  squaredBase = squaredBase.mul(squaredBase).shrn(SCALE_OFFSET);

  if (!exp.and(new BN(0x2000)).isZero()) {
    result = result.mul(squaredBase).shrn(SCALE_OFFSET);
  }

  squaredBase = squaredBase.mul(squaredBase).shrn(SCALE_OFFSET);

  if (!exp.and(new BN(0x4000)).isZero()) {
    result = result.mul(squaredBase).shrn(SCALE_OFFSET);
  }

  squaredBase = squaredBase.mul(squaredBase).shrn(SCALE_OFFSET);

  if (!exp.and(new BN(0x8000)).isZero()) {
    result = result.mul(squaredBase).shrn(SCALE_OFFSET);
  }

  squaredBase = squaredBase.mul(squaredBase).shrn(SCALE_OFFSET);

  if (!exp.and(new BN(0x10000)).isZero()) {
    result = result.mul(squaredBase).shrn(SCALE_OFFSET);
  }

  squaredBase = squaredBase.mul(squaredBase).shrn(SCALE_OFFSET);

  if (!exp.and(new BN(0x20000)).isZero()) {
    result = result.mul(squaredBase).shrn(SCALE_OFFSET);
  }

  squaredBase = squaredBase.mul(squaredBase).shrn(SCALE_OFFSET);

  if (!exp.and(new BN(0x40000)).isZero()) {
    result = result.mul(squaredBase).shrn(SCALE_OFFSET);
  }

  if (result.isZero()) {
    return new BN(0);
  }

  if (invert) {
    result = MAX.div(result);
  }

  return result;
}
