# DLMM Program Interface

### Functionalities

| Endpoint      | Description                                                                                                                   | Example                                                                                                                                                                                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| add_liquidity | Add liquidity to a position by spreading `amount_x` and `amount_y` into `bins` based on `distribution_x` and `distribution_y` | amount_x = 1_000_000_000<br/>amount_y = 100_000_000<br/>bins = [-1, 0, 1]<br/>distribution_x=[0, 2500, 7500]<br/>distribution_y=[7500, 2500, 0]<br/><br/>The position will be depositing:<br/><table><tr><th>Bin</th><th>amount_x</th><th>amount_y</th><tr><td>-1</td><td>1_000_000_000 * 0 / 10_000 = 0</td><td>100_000_000 * 7500 / 10_000 = 75_000_000</td></tr><tr><td>0</td><td>1_000_000_000 * 2500 / 10_000 = 250_000_000</td><td>100_000_000 * 2500 / 10_000 = 25_000_000</td></tr><tr><td>1</td><td>1_000_000_000 * 7500 / 10_000 = 750_000_000</td><td>100_000_000 * 0 / 10_000 = 0</td></tr></table> |
| add_liquidity_by_weight | Add liquidity to a position, based on the `weight`. The weight is in term of `token_y`.<br/>If the deposit price range include active bin, `amount_x` and `amount_y` into active bin will be **adjusted to same ratio** as the token X/Y ratio in the active bin to avoid internal swap fee.<br/> * *The endpoint doesn't support deposit only single side. Please use **add_liquidity_one_side*** | Assume active bin is bin 0, and have 1:1 token X:Y ratio<br/> amount_x = 1_000_000_000<br/>amount_y = 100_000_000<br/>bins=[-1, 0, 1]<br/>weight=[10, 10, 10]<br/><br/> The position will be depositing:<table><tr><th>Bin (price)</th><th>weight</th><th>amount_x</th><th>amount_y</th></tr><tr><td>-1 (0.9999)</td><td>adjusted_weight_x = 10 / 0.9999 = 10.001<br/>adjusted_weight_y = 10</td><td>1_000_000_000 * 10.001 / {total_adjusted_weight_x}</td><td>100_000_000 * 10 / {total_adjusted_weight_y}</td></tr><tr><td>0 (1.0000)</td><td>to fill up</td><td>to fill up</td><td>to fill up</td></tr><tr><td>1 (1.0001)</td><td>adjusted_weight_x = 10 / 1.0001 = 9.999<br/>adjusted_weight_y = 10</td><td>1_000_000_000 * 9.999 / {total_adjusted_weight_x}</td><td>100_000_000 * 10 / {total_adjusted_weight_y}</td></tr></table> |
| add_liquidity_one_side | Similar as **add_liquidity_by_weight**, but without involvement of active bin | Similar as **add_liquidity_by_weight** |
| initialize_position | Create a position | |
| claim_fee | Claim swap fee of a position | |
| claim_reward | Claim farm reward of a position |
| close_position | Close a position. The position must not have any unclaimed fee, and farm rewards | |
| increase_oracle_length | Extend the oracle observations | |
| initialize_bin_array_bitmap_extension | Create bin array bitmap extension account for indexing bin array with liquidity. Used to index bin array with price ranges fall outside the range of internal bin array bitmap in LBPair account |
| initialize_bin_array | Create a bin array | |
| remove_liquidity | Remove liquidity from a position | |
| swap | Swap token X to Y, or reverse | |


### Conversion between price and bin id

```
// Convert bin ID to price
pricePerTokenFromBinId = (1 + binStep / 10_000) ** binId

// Convert price to bin ID
binIdFromPricePerToken =  Math.floor(Math.log(price) / Math.log(1 + binStep / 10_000))
```

### Adjust price to UI amount

```
priceAdjustedToUiAmount = pricePerTokenFromBinId ** (baseToken.decimals - quoteToken.decimals)
```

### Time weighted average price
Check [dlmm-integration-example](../dlmm-integration-example) program [get_twap.rs](../dlmm-integration-example/src/instructions/get_twap.rs) for more details.

Build

```
anchor build --program-name dlmm_program_interface
```
