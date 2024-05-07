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
