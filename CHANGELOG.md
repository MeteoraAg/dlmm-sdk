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

## @mercurial-finance/dlmm-sdk [1.0.27] - PR #57

### Fixed

- Fix position quotation calculation for position count.

## @mercurial-finance/dlmm-sdk [1.0.29] - PR #59

## Fixed

- Fix position quotation calculation for bin array creation.

## @mercurial-finance/dlmm-sdk [1.0.30] - PR #65

- Fix create permission lb pair browser compatibility

## @mercurial-finance/dynamic-amm-sdk [1.0.32] - PR #58

### Added

- A new function to sync outdated pool to nearest market price bin

## @mercurial-finance/dynamic-amm-sdk [1.0.33] - PR #67

### Fixed

- Fix position liquidity withdraw to position owner, instead of customized fee owner

## @meteora-ag/dlmm [1.0.34] - PR #49

### Features

- Support creation of permissionless pair with same binstep, different fee tier.

### Deprecated

- `deriveLbPair` no longer in use. Use `deriveLbPair2` for new pair PDA.
- `derivePresetParameter` no longer in use. Use `derivePresetParameter2` for new preset parameter PDA.

## lb_clmm [0.5.1] - PR #49

### Features

- Support creation of permissionless pair with same binstep but a different fee tier.

### Deprecated

- `derive_lb_pair_pda` no longer in use. Use `derive_lb_pair_pda2` for new pair PDA.
- `derive_preset_parameter_pda` no longer in use. Use `derive_preset_parameter_pda2` for new pair PDA.

### Breaking

- Initialization of `LbPair` PDA require `base_factor` as the fourth seed now. This break `InitializeLbPair` account context.
- Initialization of `PresetParameter` PDA require `base_factor` as the third seed now. This break `InitializePresetParameter` account context.

## lb_clmm [0.5.2] - PR #59

### Added

- Add deposit single sided with exact amount endpoint

## @meteora-ag/dlmm [1.0.35] - PR #59

### Added

- Support liquidity seeding for launch pool (permission pair) based on https://ilm.jup.ag/

### Fixed

- `findSwappableMinMaxBinId` returned invalid min/max bin id under some edge case
- `derivePosition` using invalid seed

## @meteora-ag/dlmm [1.0.36] - PR #68

### Added

- `getPairPubkeyIfExists` function to get the public key of existing pool address, if the pool doesn't exists return null

## @meteora-ag/dlmm [1.0.37] - PR #68

### Added

- `initializePositionByOperator` function allow operator to initialize positio for other user

### Fixed

- `withdrawLiquidity` error when close position due to rent receiver must be position owner

## @meteora-ag/dlmm [1.0.38] - PR #71

### Added

- `getTokensMintFromPoolAddress` helper function to get tokenX mint & tokenY mint from lb pair address

## lb_clmm [0.6.0] - PR #75

### Added

- Introduces `pre_activation_swap_address` and pre_activation_slot_duration
  `pre_activation_slot_duration` fields.

### Removed

- `swap_cap_amount` and `swap_cap_deactivate_slot` fields.

### Breaking

- Reduced whitelisted_wallet from the size of 2 to 1. This break the `update_whitelisted_wallet` endpoint.

## @meteora-ag/dlmm [1.0.40] - PR #74

### Added

- `getMaxPriceInBinArrays` to get the max price of a bin that has liquidity

## @meteora-ag/dlmm [1.0.41] - PR #77

### Fixed

- `swapQuote` not working on pool with bitmap extension

## @meteora-ag/dlmm [1.0.42] - PR #78

### Fixed

- `swapQuote` not working on pool with bitmap extension when in token is tokenX

## lb_clmm [0.6.1] - PR #79

### Added

- Staging program id

## @meteora-ag/dlmm [1.0.43] - PR #76

### Changed

- update static function to support param program id

## commons [0.1.0] - PR #80

### Added

- Swap exact in quote

## @meteora-ag/dlmm [1.0.44] - PR #81

### Added

- `getEmissionRate` should not return ended reward, which can be read from `rewardDurationEnd`

## @meteora-ag/dlmm [1.0.45] - PR #76

### Fixed

- fix `addLiquidityByStrategy` not working when active bin is not within the liquidity

## @meteora-ag/dlmm [1.0.45] - PR #76

### Improvement

- improve `getAllLbPairPositionsByUser` on some promise to run in parallel
