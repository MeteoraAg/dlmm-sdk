import { Connection, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { Clock, ClockLayout } from "../dlmm/types";

describe("Decode", () => {
  const connection = new Connection("http://127.0.0.1:8899", "processed");

  test("Decode sysvar clock", async () => {
    const currentTime = Math.floor(Date.now() / 1000);

    const clockAccount = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
    const clock = ClockLayout.decode(clockAccount!.data) as Clock;

    console.log(clock.slot.toString());
    console.log(clock.unixTimestamp.toString());

    const secondDiff = Math.abs(currentTime - clock.unixTimestamp.toNumber());

    expect(clock.slot.toNumber()).toBeGreaterThan(0);
    expect(secondDiff).toBeLessThan(30);
  });
});
