# DLMM SDK

<p align="center">
<img align="center" src="https://vaults.mercurial.finance/icons/logo.svg" width="180" height="180" />
</p>
<br>

## Getting started

NPM: https://www.npmjs.com/package/@meteora-ag/dlmm

SDK: https://github.com/MeteoraAg/dlmm-sdk

<!-- Docs: https://docs.mercurial.finance/mercurial-dynamic-yield-infra/ -->

Discord: https://discord.com/channels/841152225564950528/864859354335412224

## Install

1. Install deps

```
npm i @meteora-ag/dlmm @coral-xyz/anchor @solana/web3.js
```

2. Initialize DLMM instance

```ts
import DLMM from '@meteora-ag/dlmm'

const USDC_USDT_POOL = new PublicKey('ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq') // You can get your desired pool address from the API https://dlmm-api.meteora.ag/pair/all
const dlmmPool = await DLMM.create(connection, USDC_USDT_POOL);

// If you need to create multiple, can consider using `createMultiple`
const dlmmPool = await DLMM.create(connection, [USDC_USDT_POOL, ...]);

```

3. To interact with the AmmImpl

- Get Active Bin

```ts
const activeBin = await dlmmPool.getActiveBin();
const activeBinPriceLamport = activeBin.price;
const activeBinPricePerToken = dlmmPool.fromPricePerLamport(
  Number(activeBin.price)
);
```

- Create Position

```ts
const TOTAL_RANGE_INTERVAL = 10; // 10 bins on each side of the active bin
const bins = [activeBin.binId]; // Make sure bins is less than 70, as currently only support up to 70 bins for 1 position
for (
  let i = activeBin.binId;
  i < activeBin.binId + TOTAL_RANGE_INTERVAL / 2;
  i++
) {
  const rightNextBinId = i + 1;
  const leftPrevBinId = activeBin.binId - (rightNextBinId - activeBin.binId);
  bins.push(rightNextBinId);
  bins.unshift(leftPrevBinId);
}

const activeBinPricePerToken = dlmmPool.fromPricePerLamport(
  Number(activeBin.price)
);
const totalXAmount = new BN(100);
const totalYAmount = totalXAmount.mul(new BN(Number(activeBinPricePerToken)));

// Create Position (Spot Balance deposit, Please refer ``example.ts` for more example)
const createPositionTx =
  await dlmmPool.initializePositionAndAddLiquidityByStrategy({
    positionPubKey: newBalancePosition.publicKey,
    user: user.publicKey,
    totalXAmount,
    totalYAmount,
    strategy: {
      maxBinId: bins[bins.length - 1],
      minBinId: bins[0],
      strategyType: StrategyType.SpotBalanced,
    },
  });

try {
  const createBalancePositionTxHash = await sendAndConfirmTransaction(
    connection,
    createPositionTx,
    [user, newBalancePosition]
  );
} catch (error) {}
```

- Get list of positions

```ts
const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(
  user.publicKey
);
const binData = userPositions[0].positionData.positionBinData;
```

- Add liquidity to existing position

```ts
const TOTAL_RANGE_INTERVAL = 10; // 10 bins on each side of the active bin
const bins = [activeBin.binId]; // Make sure bins is less than 70, as currently only support up to 70 bins for 1 position
for (
  let i = activeBin.binId;
  i < activeBin.binId + TOTAL_RANGE_INTERVAL / 2;
  i++
) {
  const rightNextBinId = i + 1;
  const leftPrevBinId = activeBin.binId - (rightNextBinId - activeBin.binId);
  bins.push(rightNextBinId);
  bins.unshift(leftPrevBinId);
}

const activeBinPricePerToken = dlmmPool.fromPricePerLamport(
  Number(activeBin.price)
);
const totalXAmount = new BN(100);
const totalYAmount = totalXAmount.mul(new BN(Number(activeBinPricePerToken)));

// Add Liquidity to existing position
const addLiquidityTx = await dlmmPool.addLiquidityByStrategy({
  positionPubKey: newBalancePosition.publicKey,
  user: user.publicKey,
  totalXAmount,
  totalYAmount,
  strategy: {
    maxBinId: bins[bins.length - 1],
    minBinId: bins[0],
    strategyType: StrategyType.SpotBalanced,
  },
});

try {
  const addLiquidityTxHash = await sendAndConfirmTransaction(
    connection,
    addLiquidityTx,
    [user]
  );
} catch (error) {}
```

- Remove Liquidity

```ts
const userPosition = userPositions.find(({ publicKey }) =>
  publicKey.equals(newBalancePosition.publicKey)
);
// Remove Liquidity
const binIdsToRemove = userPosition.positionData.positionBinData.map(
  (bin) => bin.binId
);
const removeLiquidityTx = await dlmmPool.removeLiquidity({
  position: userPosition.publicKey,
  user: user.publicKey,
  binIds: binIdsToRemove,
  liquiditiesBpsToRemove: new Array(binIdsToRemove.length).fill(
    new BN(100 * 100)
  ), // 100% (range from 0 to 100)
  shouldClaimAndClose: true, // should claim swap fee and close position together
});

try {
  for (let tx of Array.isArray(removeLiquidityTx)
    ? removeLiquidityTx
    : [removeLiquidityTx]) {
    const removeBalanceLiquidityTxHash = await sendAndConfirmTransaction(
      connection,
      tx,
      [user],
      { skipPreflight: false, preflightCommitment: "singleGossip" }
    );
  }
} catch (error) {}
```

- Swap

```ts
const swapAmount = new BN(100);
// Swap quote
const swapYtoX = true;
const binArrays = await dlmmPool.getBinArrayForSwap(swapYtoX);
const swapQuote = await dlmmPool.swapQuote(
  swapAmount,
  swapYtoX,
  new BN(10),
  binArrays
);

// Swap
const swapTx = await dlmmPool.swap({
  inToken: dlmmPool.tokenX.publicKey,
  binArraysPubkey: swapQuote.binArraysPubkey,
  inAmount: swapAmount,
  lbPair: dlmmPool.pubkey,
  user: user.publicKey,
  minOutAmount: swapQuote.minOutAmount,
  outToken: dlmmPool.tokenY.publicKey,
});

try {
  const swapTxHash = await sendAndConfirmTransaction(connection, swapTx, [
    user,
  ]);
} catch (error) {}
```

## Static functions

| Function                      | Description                                                                        | Return                               |
| ----------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------ |
| `create`                      | Given the DLMM address, create an instance to access the state and functions       | `Promise<DLMM>`                      |
| `createMultiple`              | Given a list of DLMM addresses, create instances to access the state and functions | `Promise<Array<DLMM>>`               |
| `getAllLbPairPositionsByUser` | Given a list of DLMM addresses, create instances to access the state and functions | `Promise<Map<string, PositionInfo>>` |

## DLMM instance functions

| Function                                      | Description                                                                                                                   | Return                                                                                   |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `refetchStates`                               | Update onchain state of DLMM instance. It's recommend to call this before interact with the program (Deposit/ Withdraw/ Swap) | `Promise<void>`                                                                          |
| `getBinArrays`                                | Retrieves List of Bin Arrays                                                                                                  | `Promise<BinArrayAccount[]>`                                                             |
| `getBinArrayForSwap`                          | Retrieves List of Bin Arrays for swap purpose                                                                                 | `Promise<BinArrayAccount[]>`                                                             |
| `getFeeInfo`                                  | Retrieves LbPair's fee info including `base fee`, `protocol fee` & `max fee`                                                  | `FeeInfo`                                                                                |
| `getDynamicFee`                               | Retrieves LbPair's dynamic fee                                                                                                | `Decimal`                                                                                |
| `getBinsAroundActiveBin`                      | retrieves a specified number of bins to the left and right of the active bin and returns them along with the active bin ID.   | `Promise<{ activeBin: number; bins: BinLiquidity[] }>`                                   |
| `getBinsBetweenMinAndMaxPrice`                | Retrieves a list of bins within a specified price                                                                             | `Promise<{ activeBin: number; bins: BinLiquidity[] }>`                                   |
| `getBinsBetweenLowerAndUpperBound`            | retrieves a list of bins between a lower and upper bin ID and returns the active bin ID and the list of bins.                 | `Promise<{ activeBin: number; bins: BinLiquidity[] }>`                                   |
| `toPricePerLamport`                           | Converts a real price of bin to lamport price                                                                                 | `string`                                                                                 |
| `fromPricePerLamport`                         | converts a price per lamport value to a real price of bin                                                                     | `string`                                                                                 |
| `getActiveBin`                                | Retrieves the active bin ID and its corresponding price                                                                       | `Promise<{ binId: number; price: string }>`                                              |
| `getPriceOfBinByBinId`                        | Get the price of a bin based on its bin ID                                                                                    | `string`                                                                                 |
| `getBinIdFromPrice`                           | get bin ID based on a given price and a boolean flag indicating whether to round down or up.                                  | `number`                                                                                 |
| `getPositionsByUserAndLbPair`                 | Retrieves positions by user and LB pair, including active bin and user positions.                                             | `Promise<{ activeBin: { binId: any; price: string; }; userPositions: Array<Position>;}>` |
| `initializePositionAndAddLiquidityByStrategy` | Initializes a position and adds liquidity                                                                                     | `Promise<Transaction\|Transaction[]>`                                                    |
| `addLiquidityByStrategy`                      | Add liquidity to existing position                                                                                            | `Promise<Transaction\|Transaction[]>`                                                    |
| `removeLiquidity`                             | function is used to remove liquidity from a position, with the option to claim rewards and close the position.                | `Promise<Transaction\|Transaction[]>`                                                    |
| `closePosition`                               | Closes a position                                                                                                             | `Promise<Transaction\|Transaction[]>`                                                    |
| `swapQuote`                                   | Quote for a swap                                                                                                              | `SwapQuote`                                                                              |
| `swap`                                        | Swap token within the LbPair                                                                                                  | `Promise<Transaction>`                                                                   |
| `claimLMReward`                               | Claim rewards for a specific position owned by a specific owner                                                               | `Promise<Transaction>`                                                                   |
| `claimAllLMRewards`                           | Claim all liquidity mining rewards for a given owner and their positions.                                                     | `Promise<Transaction[]>`                                                                 |
| `claimSwapFee`                                | Claim swap fees for a specific position owned by a specific owner                                                             | `Promise<Transaction>`                                                                   |
| `claimAllSwapFee`                             | Claim swap fees for multiple positions owned by a specific owner                                                              | `Promise<Transaction>`                                                                   |
| `claimAllRewards`                             | Claim swap fees and LM rewards for multiple positions owned by a specific owner                                               | `Promise<Transaction[]>`                                                                 |

```

```
