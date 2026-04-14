import { Connection, PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { DLMM } from "../dlmm";
import { IDynamicOracle } from "../dlmm/helpers";
import { Clock, ClockLayout } from "../dlmm/types";
import BN from "bn.js";

const poolAddress = new PublicKey(
  "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6",
);

async function main() {
  const rpc = process.env.RPC || "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpc, "finalized");
  const dlmmPool = await DLMM.create(connection, poolAddress, {
    cluster: "mainnet-beta",
  });

  const oracle: IDynamicOracle = await dlmmPool.getOracle();

  // Current on-chain timestamp from clock sysvar
  const clockAccInfo = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
  const clock: Clock = ClockLayout.decode(clockAccInfo.data);
  const currentTimestamp = clock.unixTimestamp;

  // Max observable duration
  const maxDuration = oracle.getMaxDuration(currentTimestamp);
  console.log("Max oracle duration (seconds):", maxDuration.toString());

  if (maxDuration.isZero()) {
    console.log("Oracle has no observations yet.");
    return;
  }

  // TWAP active bin ID from earliest to now
  const twapActiveId = oracle.getActiveId(currentTimestamp);
  console.log("TWAP active bin ID:", twapActiveId?.value.toString());
  console.log("TWAP duration (seconds):", twapActiveId?.duration.toString());

  // TWAP UI price over the last 10 minutes (or max duration if shorter)
  const tenMinutes = new BN(600);
  const duration = BN.min(tenMinutes, maxDuration);
  const timePoint0 = currentTimestamp.sub(duration);
  const timePoint1 = currentTimestamp;

  const twapPrice = oracle.getUiPriceByTime(timePoint0, timePoint1);
  if (twapPrice) {
    console.log(
      `TWAP UI price (last ${duration.toString()}s):`,
      twapPrice.value.toString(),
    );
  } else {
    console.log("Not enough oracle data for the requested time range.");
  }

  // Query TWAP for each quarter of the observable window [currentTimestamp - maxDuration, currentTimestamp].
  // To extend the observable window, use dlmmPool.increaseOracleLength(lengthToAdd, funder)
  // to allocate more observation slots. A larger oracle stores more history, enabling TWAP
  // queries over longer time ranges.
  const windowStart = currentTimestamp.sub(maxDuration);
  const windows = 4;
  const quarterDuration = maxDuration.div(new BN(windows));

  for (let i = 0; i < windows; i++) {
    const from = windowStart.add(quarterDuration.mul(new BN(i)));
    const to = windowStart.add(quarterDuration.mul(new BN(i + 1)));

    const windowPrice = oracle.getUiPriceByTime(from, to);
    if (windowPrice) {
      console.log(
        `Window ${i + 1}/${windows} [${from.toString()} -> ${to.toString()}] (${windowPrice.duration.toString()}s): ${windowPrice.value.toString()}`,
      );
    } else {
      console.log(
        `Window ${i + 1}/${windows} [${from.toString()} -> ${to.toString()}]: insufficient oracle data`,
      );
    }
  }
}

main();
