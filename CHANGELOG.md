# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

## @meteora-ag/dlmm [1.3.8] - PR #144

### Fixed

- Fix `getOrCreateATAInstruction` to use `createAssociatedTokenAccountIdempotentInstruction` 

## @meteora-ag/dlmm [1.3.7] - PR #143

### Fixed

- Fix `swapQuote` end price

## @meteora-ag/dlmm [1.3.6] - PR #116

### Changed

- Refactored; remove `position(V1)` interaction from SDK
- Throw error in `removeLiquidity` function if position doesn't have any liquidity 

### Fixed

- Removed unused rpc call in `swap`

### Added

- Function `getPosition` to retrieve a single position data

## @meteora-ag/dlmm [1.3.5] - PR #136

### Fixed

- Fixed the `getBins` method to handle the corner case when no bin arrays created for the requested bin ids.

## @meteora-ag/dlmm [1.3.4] - PR #127

### Changed

- Use estimated compute unit instead of 1.4m compute unit for instructions.

## @meteora-ag/dlmm [1.3.3] - PR #133

### Changed

- Update parameters for `ts-client` function `seedLiquiditySingleBin`

## @meteora-ag/dlmm [1.3.2] - PR #134

### Changed

- Close wrap SOL ATA when SOL is swap in direction.

## lb_clmm [0.8.2] - PR #115

### Added

- Add a new endpoint `initialize_customizable_permissionless_lb_pair`, that allows pool creator to be able to create pool with input `active_id`, `bin_step`, `base_factor`, `activation_point` and `alpha-vault`

### Changed

- Add a new PairType `CustomizablePermissionless`, that is set by using the new endpoint above.

- Remove `whitelisted_wallet` and `lock_duration` in pool state.

- Remove `subjected_to_bootstrap_liquidity_locking` in position state.

- With PairType as `Permission` and `CustomizablePermissionless`, `token_y_mint` is always quote token (SOL/USDC). Users are able to deposit both quote token and base token before `activation_slot`, but those pools doesn't allow user to deposit quote token in active_bin before `activation_slot`. After `activation_slot`, that are free for everyone.

- `PairType::Permission` allows user to withdraw base token before `activation_slot`, but `PairType::CustomizablePermissionless` doesn't allow user to withdraw base token before `activation_slot`

- Refactoring on file structures

### Removed

- Remove endpoint `set_lock_release_point`
- Remove endpoint `update_whitelisted_address`

### Breaking Changes

- Endpoint `initialize_position_by_operator` requires a new field `lock_release_point`, to allow position liquidity locking for compatibility with old launch mechanism in permissioned lb pair

## @meteora-ag/dlmm [1.3.0] - PR #115

### Added

- Add `createCustomizablePermissionlessLbPair` to allow user to create launch pool with more flexible configuration.

### Removed

- Remove `updateWhitelistedWallet`

### Breaking Changes

- `createPermissionLbPair` removed `lockDuration`
- `initializePositionByOperator` added `lockReleasePoint`
- `seedLiquidity` removed `operator` and `feeOwner`

## cli [0.4.0] - PR #115

### Added

- Add `initialize_customizable_permission_lb_pair`

### Removed

- Remove `update_whitelisted_wallet`

## @meteora-ag/dlmm [1.2.4] - PR #119

### Fixed

- Refactor `getBins` to work with any bin ranges

## @meteora-ag/dlmm [1.2.3] - PR #112

### Fixed

- Fixed `addLiquidityByStrategy` incorrect array bin indices calculation

## @meteora-ag/dlmm [1.2.2] - PR #110

### Fixed

- Fixed `quoteCreatePosition` incorrect result if bin range too short

## @meteora-ag/dlmm [1.2.0] - PR #109

### Removed

- Removed `removeLiquiditySingleSide`

## @meteora-ag/dlmm [1.1.6] - PR #108

### Added

- new method `createEmptyPosition` allows to create an empty position with the corresponding bin arrays.

## @meteora-ag/dlmm [1.1.5] - PR #107

### Fixed

- fix `getPairPubkeyIfExists` return type

## @meteora-ag/dlmm [1.1.4] - PR #107

### Fixed

- `removeLiquiditySingleSide`. Add in unwrap sol in post instructions

## @meteora-ag/dlmm [1.1.2] - PR #104

### Fixed

- `isSwapDisabled` checked against wrong field

## @meteora-ag/dlmm [1.1.1] - PR #103

### Removed

- Removed `swapInitiator` parameter from `swapQuoteExactOut` and `swapQuote`.

### Added

- `isSwapDisabled` to check whether the pool allow swap

## @meteora-ag/dlmm [1.1.0] - PR #101

### Changed

- `swapQuoteExactOut` and `swapQuote` require an additional `swapInitiator` parameter. `swapInitiator` is the address of the user who will initiate the swap transaction.

## lb_clmm [0.8.0] - PR #96

### Added

- Pool supports 2 modes now defined by `activation_type`. If `activation_type == 0`, activation is calculated based on slot. If `activation_type == 1`, activation is calculated based on timestamp.

### Changed

- Pool state added a new field `activation_type`
- Rename `pool.activation_slot` to `pool.activation_point`
- Rename `pool.pre_activation_slot_duration` to `pool.pre_activation_duration`
- Rename `pool.lock_duration_in_slot` to `pool.lock_duration`
- Rename `position.lock_release_slot` to `position.lock_release_point`

### Breaking Changes

- The activation condition for all endpoints will by validated by slot or timestamp based on `activation_type` in pool state
- All program endpoints to modify permissioned pool will migrate parameters with post_fix `_slot` to `_point`
- Rename endpoint `set_activation_slot` to `set_activation_point`
- Rename endpoint `set_pre_activation_slot_duration` to `set_pre_activation_duration`
- Rename endpoint `set_lock_release_slot` to `set_lock_release_point`
- Endpoint `initialize_permission_lb_pair` requires a new field `activation_type` in input parameters

### Removed

- `update_fee_owner` endpoint is removed

## common [0.3.0] - PR #96

### Changed

- `quote_exact_out` and `quote_exact_in` throw error when pool is disabled, or not activated for swap yet.

### Breaking Changes

- `quote_exact_out` and `quote_exact_in` require a new field `current_slot` in input parameters

## cli [0.3.0] - PR #96

### Removed

- `update_fee_owner` command is removed

### Breaking Changes

- Rename command `set_activation_slot` to `set_activation_point`
- Rename command `set_pre_activation_slot_duration` to `set_pre_activation_duration`
- Command `initialize_permission_lb_pair` require new `activation_type` parameter

## @meteora-ag/dlmm [1.0.55] - PR #96

### Changed

- `swapQuoteExactOut` and `swapQuote` throw error when pool is disabled, or not activated for swap yet.

### Breaking Changes

- Renamed `setActivationSlot` to `setActivationPoint`
- `createPermissionLbPair` require new `ActivationType` parameter

## @mercurial-finance/dynamic-amm-sdk [1.0.54] - PR #99

### Fixed

- `getAmountOutWithdrawSingleSide`. Ensured the correct withdrawal amount is returned

## @meteora-ag/dlmm [1.0.53] - PR #98

### Added

- `removeLiquiditySingleSide`. Withdraw only 1 token in the pair for the position
- `getWithdrawSingleSideAmount`. Calculates the total single-sided withdrawable amount

## @meteora-ag/dlmm [1.0.52] - PR #90

### Added

- extra field (`endPrice`) in swapQuote

## @meteora-ag/dlmm [1.0.51] - PR #94

### Added

- `getBinArraysRequiredByPositionRange`. Retrieves the bin arrays required to initialize multiple positions in continuous range.
- `initializeBinArrays`. Initializes bin arrays for the given bin array indexes if it wasn't initialized.

## @meteora-ag/dlmm [1.0.50] - PR #91

### Changed

- Support partial fill in `swapQuote` function

## @meteora-ag/dlmm [1.0.49] - PR #88

### Improvement

- Improve the `claimAllRewards` method with a more distinct filtering for claiming non empty swap fees and lm rewards per each kind.
- Filter positions with non zero LM rewards in the `claimAllLMRewards` method.
- Filter positions with non zero swap fees in the `claimAllSwapFee` method.

## @meteora-ag/dlmm [1.0.48] - PR #87

### Improvement

- Exclude positions without any fees and/or rewards from reward claims in the `claimAllRewards` method.

## @meteora-ag/dlmm [1.0.46] - PR #84

### Added

- `swapQuoteExactOut` for swap quote of program endpoint `swap_exact_out`.
- `swapExactOut` to create transaction to swap using program endpoint `swap_exact_out`.
- `swapWithPriceImpact` to create transaction to swap using program endpoint `swap_with_price_impact`.

### Breaking

- Renamed `swapQuoteAtBin` function to `swapExactInQuoteAtBin`

## lb_clmm [0.7.0] - PR #84

### Added

- Program endpoint `swap_exact_out`. It will consume the in amount until the exact out amount reached.
- Program endpoint `swap_with_price_impact`. Similar to minimum amount out (slippage), but in price impact form.

## common [0.1.1] - PR #84

### Added

- `quote_exact_out` for swap quote of program endpoint `swap_exact_out`.

### Breaking

- Renamed return type of `swap_exact_in` function, `SwapQuote` to `SwapExactInQuote`

## @meteora-ag/dlmm [1.0.45] - PR #76

### Improvement

- improve `getAllLbPairPositionsByUser` on some promise to run in parallel

## @meteora-ag/dlmm [1.0.45] - PR #76

### Fixed

- fix `addLiquidityByStrategy` not working when active bin is not within the liquidity

## commons [0.1.0] - PR #80

### Added

- Swap exact in quote

## @meteora-ag/dlmm [1.0.44] - PR #81

### Added

- `getEmissionRate` should not return ended reward, which can be read from `rewardDurationEnd`

## @meteora-ag/dlmm [1.0.43] - PR #76

### Changed

- update static function to support param program id

## lb_clmm [0.6.1] - PR #79

### Added

- Staging program id

## @meteora-ag/dlmm [1.0.42] - PR #78

### Fixed

- `swapQuote` not working on pool with bitmap extension when in token is tokenX

## @meteora-ag/dlmm [1.0.41] - PR #77

### Fixed

- `swapQuote` not working on pool with bitmap extension

## @meteora-ag/dlmm [1.0.40] - PR #74

### Added

- `getMaxPriceInBinArrays` to get the max price of a bin that has liquidity

## lb_clmm [0.6.0] - PR #75

### Added

- Introduces `pre_activation_swap_address` and pre_activation_slot_duration
  `pre_activation_slot_duration` fields.

### Removed

- `swap_cap_amount` and `swap_cap_deactivate_slot` fields.

### Breaking

- Reduced whitelisted_wallet from the size of 2 to 1. This break the `update_whitelisted_wallet` endpoint.

## @meteora-ag/dlmm [1.0.38] - PR #71

### Added

- `getTokensMintFromPoolAddress` helper function to get tokenX mint & tokenY mint from lb pair address

## @meteora-ag/dlmm [1.0.37] - PR #68

### Added

- `initializePositionByOperator` function allow operator to initialize positio for other user

### Fixed

- `withdrawLiquidity` error when close position due to rent receiver must be position owner

## @meteora-ag/dlmm [1.0.36] - PR #68

### Added

- `getPairPubkeyIfExists` function to get the public key of existing pool address, if the pool doesn't exists return null

## @meteora-ag/dlmm [1.0.35] - PR #59

### Added

- Support liquidity seeding for launch pool (permission pair) based on https://ilm.jup.ag/

### Fixed

- `findSwappableMinMaxBinId` returned invalid min/max bin id under some edge case
- `derivePosition` using invalid seed

## lb_clmm [0.5.2] - PR #59

### Added

- Add deposit single sided with exact amount endpoint

## lb_clmm [0.5.1] - PR #49

### Features

- Support creation of permissionless pair with same binstep but a different fee tier.

### Deprecated

- `derive_lb_pair_pda` no longer in use. Use `derive_lb_pair_pda2` for new pair PDA.
- `derive_preset_parameter_pda` no longer in use. Use `derive_preset_parameter_pda2` for new pair PDA.

### Breaking

- Initialization of `LbPair` PDA require `base_factor` as the fourth seed now. This break `InitializeLbPair` account context.
- Initialization of `PresetParameter` PDA require `base_factor` as the third seed now. This break `InitializePresetParameter` account context.

## @meteora-ag/dlmm [1.0.34] - PR #49

### Features

- Support creation of permissionless pair with same binstep, different fee tier.

### Deprecated

- `deriveLbPair` no longer in use. Use `deriveLbPair2` for new pair PDA.
- `derivePresetParameter` no longer in use. Use `derivePresetParameter2` for new preset parameter PDA.

## @mercurial-finance/dynamic-amm-sdk [1.0.33] - PR #67

### Fixed

- Fix position liquidity withdraw to position owner, instead of customized fee owner

## @mercurial-finance/dynamic-amm-sdk [1.0.32] - PR #58

### Added

- A new function to sync outdated pool to nearest market price bin

## @mercurial-finance/dlmm-sdk [1.0.30] - PR #65

- Fix create permission lb pair browser compatibility

## @mercurial-finance/dlmm-sdk [1.0.29] - PR #59

## Fixed

- Fix position quotation calculation for bin array creation.

## @mercurial-finance/dlmm-sdk [1.0.27] - PR #57

### Fixed

- Fix position quotation calculation for position count.
