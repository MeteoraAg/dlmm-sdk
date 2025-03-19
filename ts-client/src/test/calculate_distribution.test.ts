import { BN } from "@coral-xyz/anchor";
import {
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  createMint,
  ExtensionType,
  getMintLen,
  Mint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  unpackMint,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import babar from "babar";
import fs from "fs";
import {
  calculateBidAskDistribution,
  calculateNormalDistribution,
  calculateSpotDistribution,
  toAmountsBothSideByStrategy,
  toWeightDistribution,
} from "../dlmm/helpers";
import { Clock, ClockLayout, StrategyType } from "../dlmm/types";

interface Distribution {
  binId: number;
  xAmountBpsOfTotal;
  yAmountBpsOfTotal;
}

expect.extend({
  toBeCloseTo(received: number, expected: number, precision: number) {
    const pass = Math.abs(received - expected) <= precision;
    return {
      pass,
      message: () =>
        `expected ${received} to be close to ${expected} with precision ${precision}`,
    };
  },
});

// Print out distribution in console for debugging
function debugDistributionChart(distributions: Distribution[]) {
  const bars = [];
  for (const dist of distributions) {
    bars.push([
      dist.binId,
      dist.xAmountBpsOfTotal.add(dist.yAmountBpsOfTotal).toNumber(),
    ]);
  }
  console.log(babar(bars));
}

const connection = new Connection("http://127.0.0.1:8899", "confirmed");

const keypairBuffer = fs.readFileSync(
  "../keys/localnet/admin-bossj3JvwiNK7pvjr149DqdtJxf2gdygbcmEPTkb2F1.json",
  "utf-8"
);
const keypair = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(keypairBuffer))
);

describe("calculate_distribution", () => {
  const mint = Keypair.generate();
  const mintWithTransferFee = Keypair.generate();

  let mintAccount: Mint = null;
  let mintWithTransferFeeAccount: Mint = null;
  let clock: Clock;

  beforeAll(async () => {
    const decimal = 6;
    await connection.requestAirdrop(keypair.publicKey, 10 * LAMPORTS_PER_SOL);
    // 1. Create mint
    await createMint(
      connection,
      keypair,
      keypair.publicKey,
      null,
      decimal,
      mint,
      {
        commitment: "confirmed",
      },
      TOKEN_PROGRAM_ID
    );

    // 2. Create mint with transfer fee
    const extensions = [ExtensionType.TransferFeeConfig];
    const mintLen = getMintLen(extensions);
    const feeBasisPoint = 5000;
    const maxFee = BigInt(100_000 * 10 ** decimal);
    const minLamports =
      await connection.getMinimumBalanceForRentExemption(mintLen);
    const transaction = new Transaction()
      .add(
        SystemProgram.createAccount({
          fromPubkey: keypair.publicKey,
          newAccountPubkey: mintWithTransferFee.publicKey,
          space: mintLen,
          lamports: minLamports,
          programId: TOKEN_2022_PROGRAM_ID,
        })
      )
      .add(
        createInitializeTransferFeeConfigInstruction(
          mintWithTransferFee.publicKey,
          keypair.publicKey,
          keypair.publicKey,
          feeBasisPoint,
          maxFee,
          TOKEN_2022_PROGRAM_ID
        )
      )
      .add(
        createInitializeMintInstruction(
          mintWithTransferFee.publicKey,
          decimal,
          keypair.publicKey,
          null,
          TOKEN_2022_PROGRAM_ID
        )
      );

    await sendAndConfirmTransaction(
      connection,
      transaction,
      [keypair, mintWithTransferFee],
      {
        commitment: "confirmed",
      }
    );

    const accounts = await connection.getMultipleAccountsInfo(
      [mint.publicKey, mintWithTransferFee.publicKey, SYSVAR_CLOCK_PUBKEY],
      {
        commitment: "confirmed",
      }
    );

    mintAccount = unpackMint(mint.publicKey, accounts[0], TOKEN_PROGRAM_ID);
    mintWithTransferFeeAccount = unpackMint(
      mintWithTransferFee.publicKey,
      accounts[1],
      TOKEN_2022_PROGRAM_ID
    );
    clock = ClockLayout.decode(accounts[2].data) as Clock;
  });

  describe("consists of only 1 bin id", () => {
    describe("when the deposit bin at the left of the active bin", () => {
      const binIds = [-10000];
      const activeBin = -3333;

      const distributions = calculateNormalDistribution(activeBin, binIds);

      expect(distributions.length).toBe(1);
      expect(distributions[0].binId).toBe(binIds[0]);
      expect(distributions[0].xAmountBpsOfTotal.toNumber()).toBe(0);
      expect(distributions[0].yAmountBpsOfTotal.toNumber()).toBe(10000);
    });

    describe("when the deposit bin at the right of the active bin", () => {
      const binIds = [-2222];
      const activeBin = -3333;

      const distributions = calculateNormalDistribution(activeBin, binIds);

      expect(distributions.length).toBe(1);
      expect(distributions[0].binId).toBe(binIds[0]);
      expect(distributions[0].xAmountBpsOfTotal.toNumber()).toBe(10000);
      expect(distributions[0].yAmountBpsOfTotal.toNumber()).toBe(0);
    });

    describe("when the deposit bin is the active bin", () => {
      const binIds = [-3333];
      const activeBin = -3333;

      const distributions = calculateNormalDistribution(activeBin, binIds);

      expect(distributions.length).toBe(1);
      expect(distributions[0].binId).toBe(binIds[0]);
      expect(distributions[0].xAmountBpsOfTotal.toNumber()).toBe(10000);
      expect(distributions[0].yAmountBpsOfTotal.toNumber()).toBe(10000);
    });
  });

  describe("spot distribution", () => {
    test("should return correct distribution with equal delta", () => {
      const binIds = [1, 2, 3, 4, 5];
      const activeBin = 3;

      const distributions = calculateSpotDistribution(activeBin, binIds);

      const yNonActiveBinPct = Math.floor(10_000 / 2.5);
      const xNonActiveBinPct = Math.floor(10_000 / 2.5);

      expect(distributions[0].binId).toBe(1);
      expect(distributions[0].yAmountBpsOfTotal.toNumber()).toBe(
        yNonActiveBinPct
      );
      expect(distributions[0].xAmountBpsOfTotal.toNumber()).toBe(0);

      expect(distributions[1].binId).toBe(2);
      expect(distributions[1].yAmountBpsOfTotal.toNumber()).toBe(
        yNonActiveBinPct
      );
      expect(distributions[1].xAmountBpsOfTotal.toNumber()).toBe(0);

      expect(distributions[2].binId).toBe(3);
      expect(distributions[2].yAmountBpsOfTotal.toNumber()).toBe(
        Math.floor(yNonActiveBinPct * 0.5)
      );
      expect(distributions[2].xAmountBpsOfTotal.toNumber()).toBe(
        Math.floor(xNonActiveBinPct * 0.5)
      );

      expect(distributions[3].binId).toBe(4);
      expect(distributions[3].yAmountBpsOfTotal.toNumber()).toBe(0);
      expect(distributions[3].xAmountBpsOfTotal.toNumber()).toBe(
        xNonActiveBinPct
      );

      expect(distributions[4].binId).toBe(5);
      expect(distributions[4].yAmountBpsOfTotal.toNumber()).toBe(0);
      expect(distributions[4].xAmountBpsOfTotal.toNumber()).toBe(
        xNonActiveBinPct
      );

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(10_000);
      expect(yTokenTotalBps).toBe(10_000);
    });

    test("should return correct distribution with unequal delta", () => {
      const binIds = [1, 2, 3, 4, 5];
      const activeBin = 4;

      const distributions = calculateSpotDistribution(activeBin, binIds);

      const yNonActiveBinPct = Math.floor(10_000 / 3.5);
      const xNonActiveBinPct = Math.floor(10_000 / 1.5);

      expect(distributions[0].binId).toBe(1);
      expect(distributions[0].yAmountBpsOfTotal.toNumber()).toBe(
        yNonActiveBinPct
      );
      expect(distributions[0].xAmountBpsOfTotal.toNumber()).toBe(0);

      expect(distributions[1].binId).toBe(2);
      expect(distributions[1].yAmountBpsOfTotal.toNumber()).toBe(
        yNonActiveBinPct
      );
      expect(distributions[1].xAmountBpsOfTotal.toNumber()).toBe(0);

      expect(distributions[2].binId).toBe(3);
      expect(distributions[2].yAmountBpsOfTotal.toNumber()).toBe(
        yNonActiveBinPct
      );
      expect(distributions[2].xAmountBpsOfTotal.toNumber()).toBe(0);

      expect(distributions[3].binId).toBe(4);
      // Precision loss added to active bin
      expect(distributions[3].yAmountBpsOfTotal.toNumber()).toBeCloseTo(
        Math.floor(yNonActiveBinPct * 0.5),
        1
      );
      expect(distributions[3].xAmountBpsOfTotal.toNumber()).toBeCloseTo(
        Math.floor(xNonActiveBinPct * 0.5),
        1
      );

      expect(distributions[4].binId).toBe(5);
      expect(distributions[4].yAmountBpsOfTotal.toNumber()).toBe(0);
      expect(distributions[4].xAmountBpsOfTotal.toNumber()).toBe(
        xNonActiveBinPct
      );

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(10_000);
      expect(yTokenTotalBps).toBe(10_000);
    });

    test("should return correct distribution with liquidity at the left side of the active bin", () => {
      const binIds = [1, 2, 3, 4, 5];
      const activeBin = 10;

      const distributions = calculateSpotDistribution(activeBin, binIds);

      const yNonActiveBinPct = Math.floor(10_000 / 5);

      expect(distributions[0].binId).toBe(1);
      expect(distributions[0].yAmountBpsOfTotal.toNumber()).toBe(
        yNonActiveBinPct
      );
      expect(distributions[0].xAmountBpsOfTotal.toNumber()).toBe(0);

      expect(distributions[1].binId).toBe(2);
      expect(distributions[1].yAmountBpsOfTotal.toNumber()).toBe(
        yNonActiveBinPct
      );
      expect(distributions[1].xAmountBpsOfTotal.toNumber()).toBe(0);

      expect(distributions[2].binId).toBe(3);
      expect(distributions[2].yAmountBpsOfTotal.toNumber()).toBe(
        yNonActiveBinPct
      );
      expect(distributions[2].xAmountBpsOfTotal.toNumber()).toBe(0);

      expect(distributions[3].binId).toBe(4);
      expect(distributions[3].yAmountBpsOfTotal.toNumber()).toBe(
        yNonActiveBinPct
      );
      expect(distributions[3].xAmountBpsOfTotal.toNumber()).toBe(0);

      expect(distributions[4].binId).toBe(5);
      expect(distributions[4].yAmountBpsOfTotal.toNumber()).toBe(
        yNonActiveBinPct
      );
      expect(distributions[4].xAmountBpsOfTotal.toNumber()).toBe(0);

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(0);
      expect(yTokenTotalBps).toBe(10_000);
    });

    test("should return correct distribution with liquidity at the right side of the active bin", () => {
      const binIds = [5, 6, 7, 8, 9];
      const activeBin = 1;

      const distributions = calculateSpotDistribution(activeBin, binIds);

      const xNonActiveBinPct = Math.floor(10_000 / 5);

      expect(distributions[0].binId).toBe(5);
      expect(distributions[0].yAmountBpsOfTotal.toNumber()).toBe(0);
      expect(distributions[0].xAmountBpsOfTotal.toNumber()).toBe(
        xNonActiveBinPct
      );

      expect(distributions[1].binId).toBe(6);
      expect(distributions[1].yAmountBpsOfTotal.toNumber()).toBe(0);
      expect(distributions[1].xAmountBpsOfTotal.toNumber()).toBe(
        xNonActiveBinPct
      );

      expect(distributions[2].binId).toBe(7);
      expect(distributions[2].yAmountBpsOfTotal.toNumber()).toBe(0);
      expect(distributions[2].xAmountBpsOfTotal.toNumber()).toBe(
        xNonActiveBinPct
      );

      expect(distributions[3].binId).toBe(8);
      expect(distributions[3].yAmountBpsOfTotal.toNumber()).toBe(0);
      expect(distributions[3].xAmountBpsOfTotal.toNumber()).toBe(
        xNonActiveBinPct
      );

      expect(distributions[4].binId).toBe(9);
      expect(distributions[4].yAmountBpsOfTotal.toNumber()).toBe(0);
      expect(distributions[4].xAmountBpsOfTotal.toNumber()).toBe(
        xNonActiveBinPct
      );

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(10_000);
      expect(yTokenTotalBps).toBe(0);
    });
  });

  describe("curve distribution", () => {
    // Assert correct distribution when liquidity is surrounding the active bin
    function assertDistributionAroundActiveBin(
      activeBin: number,
      distributions: Distribution[]
    ) {
      let beforeXBps: number = undefined;
      let beforeYBps: number = undefined;

      for (const dist of distributions) {
        const { binId, xAmountBpsOfTotal, yAmountBpsOfTotal } = dist;
        if (binId < activeBin) {
          expect(xAmountBpsOfTotal.isZero()).toBeTruthy();
          expect(yAmountBpsOfTotal.isZero()).toBeFalsy();
          if (beforeYBps != undefined) {
            // The bps should be increasing
            expect(beforeYBps < yAmountBpsOfTotal.toNumber()).toBeTruthy();
          }
          beforeYBps = yAmountBpsOfTotal.toNumber();
        } else if (binId == activeBin) {
          expect(xAmountBpsOfTotal.isZero()).toBeFalsy();
          expect(yAmountBpsOfTotal.isZero()).toBeFalsy();
        } else {
          expect(xAmountBpsOfTotal.isZero()).toBeFalsy();
          expect(yAmountBpsOfTotal.isZero()).toBeTruthy();
          if (beforeXBps != undefined) {
            // The bps should be decreasing
            expect(beforeXBps > xAmountBpsOfTotal.toNumber()).toBeTruthy();
          }
          beforeXBps = xAmountBpsOfTotal.toNumber();
        }
      }
    }

    test("should return correct distribution with liquidity concentrated around right side of the active bin", () => {
      const binIds = [
        5505, 5506, 5507, 5508, 5509, 5510, 5511, 5512, 5513, 5514, 5515, 5516,
        5517, 5518, 5519, 5520, 5521,
      ];
      const activeBin = 5518;

      const distributions = calculateNormalDistribution(activeBin, binIds);

      expect(distributions.length).toBe(binIds.length);

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(10_000);
      expect(yTokenTotalBps).toBe(10_000);

      debugDistributionChart(distributions);
      assertDistributionAroundActiveBin(activeBin, distributions);
    });

    test("should return correct distribution with liquidity concentrated around left side of the active bin", () => {
      const binIds = [
        5505, 5506, 5507, 5508, 5509, 5510, 5511, 5512, 5513, 5514, 5515, 5516,
        5517, 5518, 5519, 5520, 5521,
      ];
      const activeBin = 5508;

      const distributions = calculateNormalDistribution(activeBin, binIds);

      expect(distributions.length).toBe(binIds.length);

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(10_000);
      expect(yTokenTotalBps).toBe(10_000);

      debugDistributionChart(distributions);
      assertDistributionAroundActiveBin(activeBin, distributions);
    });

    test("should return correct distribution with liquidity concentrated around the active bin", () => {
      const binIds = [
        5505, 5506, 5507, 5508, 5509, 5510, 5511, 5512, 5513, 5514, 5515, 5516,
        5517, 5518, 5519, 5520, 5521,
      ];
      const activeBin = 5513;

      const distributions = calculateNormalDistribution(activeBin, binIds);

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(10_000);
      expect(yTokenTotalBps).toBe(10_000);

      debugDistributionChart(distributions);
      assertDistributionAroundActiveBin(activeBin, distributions);
    });

    test("should return correct distribution with liquidity to far right of the active bin", () => {
      const binIds = [5505, 5506, 5507, 5508, 5509, 5510, 5511, 5512, 5513];
      const activeBin = 3000;

      const distributions = calculateNormalDistribution(activeBin, binIds);
      expect(distributions.length).toBe(binIds.length);

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(10_000);
      expect(yTokenTotalBps).toBe(0);

      debugDistributionChart(distributions);
      assertDistributionAroundActiveBin(activeBin, distributions);
    });

    test("should return correct distribution with liquidity to far left of the active bin", () => {
      const binIds = [5505, 5506, 5507, 5508, 5509, 5510, 5511, 5512, 5513];
      const activeBin = 8000;

      const distributions = calculateNormalDistribution(activeBin, binIds);
      expect(distributions.length).toBe(binIds.length);

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(0);
      expect(yTokenTotalBps).toBe(10_000);

      debugDistributionChart(distributions);
      assertDistributionAroundActiveBin(activeBin, distributions);
    });
  });

  describe("bid ask distribution", () => {
    // Assert correct distribution when liquidity is surrounding the active bin
    function assertDistributionAroundActiveBin(
      activeBin: number,
      distributions: Distribution[]
    ) {
      let beforeXBps: number = undefined;
      let beforeYBps: number = undefined;

      for (const dist of distributions) {
        const { binId, xAmountBpsOfTotal, yAmountBpsOfTotal } = dist;
        if (binId < activeBin) {
          expect(xAmountBpsOfTotal.isZero()).toBeTruthy();
          expect(yAmountBpsOfTotal.isZero()).toBeFalsy();
          if (beforeYBps != undefined) {
            // The bps should be decreasing
            expect(beforeYBps > yAmountBpsOfTotal.toNumber()).toBeTruthy();
          }
          beforeYBps = yAmountBpsOfTotal.toNumber();
        } else if (binId == activeBin) {
          expect(xAmountBpsOfTotal.isZero()).toBeFalsy();
          expect(yAmountBpsOfTotal.isZero()).toBeFalsy();
        } else {
          expect(xAmountBpsOfTotal.isZero()).toBeFalsy();
          expect(yAmountBpsOfTotal.isZero()).toBeTruthy();
          if (beforeXBps != undefined) {
            // The bps should be increasing
            expect(beforeXBps < xAmountBpsOfTotal.toNumber()).toBeTruthy();
          }
          beforeXBps = xAmountBpsOfTotal.toNumber();
        }
      }
    }

    test("should return correct distribution with liquidity concentrated around right side of the active bin", () => {
      const binIds = [
        5505, 5506, 5507, 5508, 5509, 5510, 5511, 5512, 5513, 5514, 5515, 5516,
        5517, 5518, 5519, 5520, 5521,
      ];
      const activeBin = 5518;

      const distributions = calculateBidAskDistribution(activeBin, binIds);

      expect(distributions.length).toBe(binIds.length);

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(10_000);
      expect(yTokenTotalBps).toBe(10_000);

      debugDistributionChart(distributions);
      assertDistributionAroundActiveBin(activeBin, distributions);
    });

    test("should return correct distribution with liquidity concentrated around left side of the active bin", () => {
      const binIds = [
        5505, 5506, 5507, 5508, 5509, 5510, 5511, 5512, 5513, 5514, 5515, 5516,
        5517, 5518, 5519, 5520, 5521,
      ];
      const activeBin = 5508;

      const distributions = calculateBidAskDistribution(activeBin, binIds);

      expect(distributions.length).toBe(binIds.length);

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(10_000);
      expect(yTokenTotalBps).toBe(10_000);

      debugDistributionChart(distributions);
      assertDistributionAroundActiveBin(activeBin, distributions);
    });

    test("should return correct distribution with liquidity concentrated around the active bin", () => {
      const binIds = [
        5505, 5506, 5507, 5508, 5509, 5510, 5511, 5512, 5513, 5514, 5515, 5516,
        5517, 5518, 5519, 5520, 5521,
      ];
      const activeBin = 5513;

      const distributions = calculateBidAskDistribution(activeBin, binIds);

      expect(distributions.length).toBe(binIds.length);

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(10_000);
      expect(yTokenTotalBps).toBe(10_000);

      debugDistributionChart(distributions);
      assertDistributionAroundActiveBin(activeBin, distributions);
    });

    test("should return correct distribution with liquidity to far right of the active bin", () => {
      const binIds = [5505, 5506, 5507, 5508, 5509, 5510, 5511, 5512, 5513];
      const activeBin = 3000;

      const distributions = calculateBidAskDistribution(activeBin, binIds);
      expect(distributions.length).toBe(binIds.length);

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(10_000);
      expect(yTokenTotalBps).toBe(0);

      debugDistributionChart(distributions);
      assertDistributionAroundActiveBin(activeBin, distributions);
    });

    test("should return correct distribution with liquidity to far left of the active bin", () => {
      const binIds = [5505, 5506, 5507, 5508, 5509, 5510, 5511, 5512, 5513];
      const activeBin = 8000;

      const distributions = calculateBidAskDistribution(activeBin, binIds);
      expect(distributions.length).toBe(binIds.length);

      const xTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.xAmountBpsOfTotal.toNumber(),
        0
      );
      const yTokenTotalBps = distributions.reduce(
        (acc, d) => acc + d.yAmountBpsOfTotal.toNumber(),
        0
      );

      expect(xTokenTotalBps).toBe(0);
      expect(yTokenTotalBps).toBe(10_000);

      debugDistributionChart(distributions);
      assertDistributionAroundActiveBin(activeBin, distributions);
    });

    test("to weight distribution", () => {
      const binIds = [
        -3563, -3562, -3561, -3560, -3559, -3558, -3557, -3556, -3555,
      ];
      const activeBin = -3556;

      const distributions = calculateSpotDistribution(activeBin, binIds);

      let weightDistribution = toWeightDistribution(
        new BN(1000000000),
        new BN(57000000),
        distributions,
        8
      );
      console.log(weightDistribution);
      const bars = [];
      for (const dist of weightDistribution) {
        bars.push([dist.binId, dist.weight]);
      }
      console.log(babar(bars));
    });

    test("to amount both side by strategy", () => {
      let activeId = 45;
      let minBinId = 20;
      let maxBinId = 70;
      let binStep = 10;
      let amount = new BN(10000);

      // 1. Without transfer fee
      let amountInBins = toAmountsBothSideByStrategy(
        activeId,
        binStep,
        minBinId,
        maxBinId,
        amount,
        amount,
        new BN(0),
        new BN(0),
        StrategyType.Spot,
        mintAccount,
        mintAccount,
        clock
      );

      let totalAmountX = amountInBins.reduce((total, { amountX }) => {
        return total.add(amountX);
      }, new BN(0));

      let totalAmountY = amountInBins.reduce((total, { amountY }) => {
        return total.add(amountY);
      }, new BN(0));

      // Precision loss
      let diff = amount.sub(totalAmountX);
      expect(diff.lt(new BN(30))).toBeTruthy();

      diff = amount.sub(totalAmountY);
      expect(diff.lt(new BN(30))).toBeTruthy();

      // 2. With transfer fee
      amountInBins = toAmountsBothSideByStrategy(
        activeId,
        binStep,
        minBinId,
        maxBinId,
        amount,
        amount,
        new BN(0),
        new BN(0),
        StrategyType.Spot,
        mintWithTransferFeeAccount,
        mintAccount,
        clock
      );

      totalAmountX = amountInBins.reduce((total, { amountX }) => {
        return total.add(amountX);
      }, new BN(0));

      totalAmountY = amountInBins.reduce((total, { amountY }) => {
        return total.add(amountY);
      }, new BN(0));

      expect(totalAmountX.lt(amount.div(new BN(2)))).toBeTruthy();

      diff = amount.sub(totalAmountY);
      expect(diff.lt(new BN(30))).toBeTruthy();
    });
  });
});
