# DLMM SDK

<p align="center">
<img align="center" src="https://vaults.mercurial.finance/icons/logo.svg" width="180" height="180" />
</p>
<br>

## Static functions

| Function                      | Description                                                                        | Return                               |
| ----------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------ |
| `create`                      | Given the DLMM address, create an instance to access the state and functions       | `Promise<DLMM>`                      |
| `createMultiple`              | Given a list of DLMM addresses, create instances to access the state and functions | `Promise<Array<DLMM>>`               |
| `getAllLbPairPositionsByUser` | Given a list of DLMM addresses, create instances to access the state and functions | `Promise<Map<string, PositionInfo>>` |

## DLMM instance functions

| Function                                    | Description                                                                                                                   | Return                                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `refetchStates`                             | Update onchain state of DLMM instance. It's recommend to call this before interact with the program (Deposit/ Withdraw/ Swap) | `Promise<void>`                                                                          |
| `getBinArrays`                              | Retrieves List of Bin Arrays                                                                                                  | `Promise<BinArrayAccount[]>`                                                             |
| `getFeeInfo`                                | Retrieves LbPair's fee info including `base fee`, `protocol fee` & `max fee`                                                  | `FeeInfo`                                                                                |
| `getDynamicFee`                             | Retrieves LbPair's dynamic fee                                                                                                | `Decimal`                                                                                |
| `getBinsAroundActiveBin`                    | retrieves a specified number of bins to the left and right of the active bin and returns them along with the active bin ID.   | `Promise<{ activeBin: number; bins: BinLiquidity[] }>`                                   |
| `getBinsBetweenMinAndMaxPrice`              | Retrieves a list of bins within a specified price                                                                             | `Promise<{ activeBin: number; bins: BinLiquidity[] }>`                                   |
| `getBinsBetweenLowerAndUpperBound`          | retrieves a list of bins between a lower and upper bin ID and returns the active bin ID and the list of bins.                 | `Promise<{ activeBin: number; bins: BinLiquidity[] }>`                                   |
| `toPricePerLamport`                         | Converts a real price of bin to lamport price                                                                                 | `string`                                                                                 |
| `fromPricePerLamport`                       | converts a price per lamport value to a real price of bin                                                                     | `string`                                                                                 |
| `getActiveBin`                              | Retrieves the active bin ID and its corresponding price                                                                       | `Promise<{ binId: number; price: string }>`                                              |
| `getPriceOfBinByBinId`                      | Get the price of a bin based on its bin ID                                                                                    | `string`                                                                                 |
| `getBinIdFromPrice`                         | get bin ID based on a given price and a boolean flag indicating whether to round down or up.                                  | `number`                                                                                 |
| `getPositionsByUserAndLbPair`               | Retrieves positions by user and LB pair, including active bin and user positions.                                             | `Promise<{ activeBin: { binId: any; price: string; }; userPositions: Array<Position>;}>` |
| `initializePositionAndAddLiquidityByWeight` | Initializes a position and adds liquidity                                                                                     | `Promise<Transaction\|Transaction[]>`                                                    |
| `addLiquidityByWeight`                      | Add liquidity to existing position                                                                                            | `Promise<Transaction\|Transaction[]>`                                                    |
| `removeLiquidity`                           | function is used to remove liquidity from a position, with the option to claim rewards and close the position.                | `Promise<Transaction\|Transaction[]>`                                                    |
| `closePosition`                             | Closes a position                                                                                                             | `Promise<Transaction\|Transaction[]>`                                                    |
| `swapQuote`                                 | Quote for a swap                                                                                                              | `SwapQuote`                                                                              |
| `swap`                                      | Swap token within the LbPair                                                                                                  | `Promise<Transaction>`                                                                   |
| `claimLMReward`                             | Claim rewards for a specific position owned by a specific owner                                                               | `Promise<Transaction>`                                                                   |
| `claimAllLMRewards`                         | Claim all liquidity mining rewards for a given owner and their positions.                                                     | `Promise<Transaction[]>`                                                                 |
| `claimSwapFee`                              | Claim swap fees for a specific position owned by a specific owner                                                             | `Promise<Transaction>`                                                                   |
| `claimAllSwapFee`                           | Claim swap fees for multiple positions owned by a specific owner                                                              | `Promise<Transaction>`                                                                   |
| `claimAllRewards`                           | Claim swap fees and LM rewards for multiple positions owned by a specific owner                                               | `Promise<Transaction[]>`                                                                 |
