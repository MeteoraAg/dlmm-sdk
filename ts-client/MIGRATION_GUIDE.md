# Migration Guide — v1.9.3 → v1.10.0

This guide covers breaking changes introduced in DLMM SDK v1.10.0 (program v0.12.0).

---

## Breaking Changes

### 1. `functionType` renamed to `concreteFunctionType`

In pool initialization params (`CreatePermissionLbPair`, `CreateCustomizablePermissionlessLbPair`), the field `functionType` has been renamed to `concreteFunctionType` to match the program's updated account layout.

**Before:**
```ts
{
  functionType: FunctionType.LiquidityMining,
  // ...
}
```

**After:**
```ts
{
  concreteFunctionType: FunctionType.LiquidityMining,
  // ...
}
```

### 2. New required field: `collectFeeMode`

Pool initialization now requires `collectFeeMode: 0` in the params:

```ts
{
  concreteFunctionType: FunctionType.LiquidityMining,
  collectFeeMode: 0,
  // ...
}
```

### 3. `Position` type aliased to `PositionV2`

`Position` is now a type alias for `PositionV2`. `PositionV2` includes two new fields:
- `collectFeeMode: number`
- `concreteFunctionType: number`

If you are accessing position data and casting types, update your type references. The alias is backward compatible at the type level, but the on-chain account layout has changed.

### 4. `FunctionType` enum values updated

| Value | v1.9.3 | v1.10.0 |
|---|---|---|
| `0` | `LiquidityMining` | `Undetermined` |
| `1` | *(new)* | `LiquidityMining` |
| `2` | *(new)* | `LimitOrder` |

**Update any hardcoded numeric values** that relied on `FunctionType.LiquidityMining === 0`.

---

## New Features

### Limit Orders

```ts
// Place a limit order
const { transaction, limitOrderKeypair } = await dlmm.placeLimitOrder({
  user,
  isAskSide: true,         // true = selling tokenX (ask), false = selling tokenY (bid)
  bins: [{ id: 1234, amount: new BN(1_000_000) }],
  relativeBin: { activeId: 1200, maxActiveBinSlippage: 5 },
});

// Cancel specific bins from a limit order
const cancelTx = await dlmm.cancelLimitOrder({
  user,
  limitOrder: limitOrderPubkey,
  binIds: [1234],
});

// Close limit order account when all bins are empty
const closeTx = await dlmm.closeLimitOrderIfEmpty({
  user,
  limitOrder: limitOrderPubkey,
});
```

### `addLiquidityByWeight2` (Token2022 + transfer hook support)

Use `addLiquidityByWeight2` instead of `addLiquidityByWeight` when working with Token2022 mints or pools that use transfer hooks. Bin arrays are passed as remaining accounts automatically.

```ts
const addLiqTx = await dlmm.addLiquidityByWeight2({
  user,
  position: positionKeypair.publicKey,
  totalXAmount: new BN(1_000_000),
  totalYAmount: new BN(1_000_000),
  xYAmountDistribution: [...],
});
```

### `setPermissionlessOperationBits`

Allows position owners to set permissionless operation bits on their position:

```ts
const tx = await dlmm.setPermissionlessOperationBits({
  owner,
  position: positionPubkey,
  bits: 1,
});
```

---

## Removed

- `closeBinArray` — admin-only instruction removed from the client SDK. Use the program directly if you need this.
