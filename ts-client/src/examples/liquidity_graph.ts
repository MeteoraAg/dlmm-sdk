import { clusterApiUrl, Connection, PublicKey } from "@solana/web3.js";
import { DLMM } from "../dlmm";
import {
  getBinArrayLowerUpperBinId,
  getPriceOfBinByBinId,
} from "../dlmm/helpers";
import Decimal from "decimal.js";

const RPC = process.env.RPC || clusterApiUrl("mainnet-beta");
const connection = new Connection(RPC, "confirmed");

const poolAddress = new PublicKey(
  "HMn6o5rM2NGgNAuYeH7JxRKfQNoQgsiqyxVUYwVpuZcV"
);

async function main() {
  const dlmmPool = await DLMM.create(connection, poolAddress, {
    cluster: "mainnet-beta",
  });

  const priceAdjustFactor = new Decimal(
    10 ** (dlmmPool.tokenX.mint.decimals - dlmmPool.tokenY.mint.decimals)
  );

  const tokenXUiPriceFactor = new Decimal(10 ** dlmmPool.tokenX.mint.decimals);
  const tokenYUiPriceFactor = new Decimal(10 ** dlmmPool.tokenY.mint.decimals);

  const binArrays = await dlmmPool.getBinArrays();
  binArrays.sort((a, b) => a.account.index.cmp(b.account.index));

  const liquidityBarChart: {
    price: Decimal;
    tokenXAmount: Decimal;
    tokenYAmount: Decimal;
    liquidity: Decimal;
  }[] = [];

  for (const binArray of binArrays) {
    let binId = getBinArrayLowerUpperBinId(
      binArray.account.index
    )[0].toNumber();

    for (const bin of binArray.account.bins) {
      const binPrice = getPriceOfBinByBinId(binId, dlmmPool.lbPair.binStep);

      const adjustedBinPrice = binPrice
        .mul(priceAdjustFactor)
        .mul(tokenYUiPriceFactor)
        .round()
        .div(tokenYUiPriceFactor);

      const price = adjustedBinPrice;
      const tokenXAmount = new Decimal(bin.amountX.toString()).div(
        tokenXUiPriceFactor
      );
      const tokenYAmount = new Decimal(bin.amountY.toString()).div(
        tokenYUiPriceFactor
      );
      const liquidity = tokenXAmount.mul(price).add(tokenYAmount);

      liquidityBarChart.push({
        price,
        tokenXAmount,
        tokenYAmount,
        liquidity,
      });

      binId++;
    }
  }

  for (const point of liquidityBarChart) {
    if (point.liquidity.gt(0)) {
      console.log(point);
    }
  }
}

main();
