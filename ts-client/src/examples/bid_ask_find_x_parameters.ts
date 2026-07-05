import babar from "babar";
import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { DLMM } from "../dlmm";
import { SCALE_OFFSET } from "../dlmm/constants";
import { getQPriceFromId } from "../dlmm/helpers/math";
import { BidAskStrategyParameterBuilder } from "../dlmm/helpers/rebalance/liquidity_strategy/bidAsk";
import { getAmountInBinsAskSide } from "../dlmm/helpers/rebalance/rebalancePosition";

const poolAddress = new PublicKey(
  "FU9FfXDG6UeUXdcN4GqFX1PC2HJvGReeCgQLA4fzMzvN",
);

// Ask side (token X) always spans 71 bins; the starting delta from the active
// bin (startDelta) is varied per case: 0, 20, 50.
const BIN_COUNT = 71;

function toRawAmount(uiAmount: number, decimals: number): BN {
  return new BN(
    new Decimal(uiAmount).mul(new Decimal(10).pow(decimals)).toFixed(0),
  );
}

// Liquidity per bin, matching rebalance_parameter_builder.test.ts: the Q64.64
// price times amountX is shifted back down to token units, then amountY added.
function getLiquidity(x: BN, y: BN, price: BN): BN {
  return x.mul(price).shrn(SCALE_OFFSET).add(y);
}

function runFindXParameters(
  builder: BidAskStrategyParameterBuilder,
  label: string,
  uiAmount: number,
  decimals: number,
  binStep: BN,
  activeId: BN,
  startDelta: number = 0,
) {
  const amountX = toRawAmount(uiAmount, decimals);
  const minDeltaId = new BN(startDelta);
  const maxDeltaId = new BN(startDelta + BIN_COUNT - 1);

  console.log(`\n=== ${label}: findXParameters ===`);
  console.log(`  uiAmount   = ${uiAmount.toLocaleString()}`);
  console.log(`  amountX    = ${amountX.toString()} (raw, ${decimals} dp)`);
  console.log(`  bins       = ${BIN_COUNT} (delta ${minDeltaId.toString()}..${maxDeltaId.toString()}, binId ${activeId.add(minDeltaId).toString()}..${activeId.add(maxDeltaId).toString()})`);

  const start = Date.now();
  const { base, delta } = builder.findXParameters(
    amountX,
    minDeltaId,
    maxDeltaId,
    binStep,
    activeId,
  );
  const elapsedMs = Date.now() - start;

  // Reconstruct the per-bin amounts from the returned parameters, then measure
  // how much of the requested amount is left undeposited (rounding dust).
  const amountInBins = getAmountInBinsAskSide(
    activeId,
    binStep,
    minDeltaId,
    maxDeltaId,
    delta,
    base,
  );

  let totalAmountX = new BN(0);
  let totalLiquidity = new BN(0);

  // Per-bin liquidity, indexed 0..70 within this window for the babar graph
  // (bin 0 sits at deltaId = startDelta).
  const liquidities = amountInBins.map((bin) => {
    const price = getQPriceFromId(bin.binId, binStep);
    const liquidity = getLiquidity(bin.amountX, bin.amountY, price);

    totalAmountX = totalAmountX.add(bin.amountX);
    totalLiquidity = totalLiquidity.add(liquidity);

    return liquidity;
  });

  const diff = amountX.sub(totalAmountX);
  const diffPct = amountX.isZero()
    ? new Decimal(0)
    : new Decimal(diff.toString()).div(amountX.toString()).mul(100);

  // Bar graph of liquidity across the ask-side bins (x = delta id, y = liquidity).
  console.log(`  liquidity distribution (x = deltaId, y = liquidity):`);
  console.log(babar(liquidities.map((liq, idx) => [idx, Number(liq.toString())])));

  console.log(`  -> x0 (base)     = ${base.toString()}`);
  console.log(`  -> deltaX        = ${delta.toString()}`);
  console.log(`  -> totalAmountX  = ${totalAmountX.toString()}`);
  console.log(`  -> totalLiquidity= ${totalLiquidity.toString()}`);
  console.log(`  -> diff          = ${diff.toString()} (${diffPct.toSignificantDigits(6)}% of amountX)`);
  console.log(`  -> elapsed       = ${elapsedMs} ms`);
}

async function main() {
  const rpc = process.env.RPC || "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpc, "finalized");

  const dlmmPool = await DLMM.create(connection, poolAddress, {
    cluster: "mainnet-beta",
  });

  const binStep = new BN(dlmmPool.lbPair.binStep);
  const activeId = new BN(dlmmPool.lbPair.activeId);
  const decimalsX = dlmmPool.tokenX.mint.decimals;

  console.log("Pool:", poolAddress.toBase58());
  console.log("  binStep       =", binStep.toString());
  console.log("  activeId      =", activeId.toString());
  console.log("  tokenX decimals =", decimalsX);

  const builder = new BidAskStrategyParameterBuilder();

  runFindXParameters(builder, "10K", 10_000, decimalsX, binStep, activeId);
  runFindXParameters(builder, "500K", 500_000, decimalsX, binStep, activeId);

  // Same 71 bins and amount, but pushed away from the active bin so the bin ids
  // (and thus the price magnitudes) are higher: startDelta = 20 and 50.
  runFindXParameters(builder, "500K @Δ20", 500_000, decimalsX, binStep, activeId, 20);
  runFindXParameters(builder, "500K @Δ50", 500_000, decimalsX, binStep, activeId, 50);
}

main();
