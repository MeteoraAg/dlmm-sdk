import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
} from "@solana/web3.js";
import { LbPosition, Position, PositionData } from "../dlmm/types";
import { DLMM } from "../dlmm";
import BN from "bn.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import IDL from "../dlmm/idl/idl.json";
import { LbClmm } from "../dlmm/idl/idl";
import { RebalancePosition } from "../dlmm/helpers/rebalance";
import babar from "babar";
import Decimal from "decimal.js";
import {
  deriveOperator,
  getBinArrayLowerUpperBinId,
  getPriceOfBinByBinId,
} from "../dlmm/helpers";

export function createTestProgram(
  connection: Connection,
  programId: PublicKey,
  keypair: Keypair
) {
  const provider = new AnchorProvider(
    connection,
    new Wallet(keypair),
    AnchorProvider.defaultOptions()
  );
  return new Program<LbClmm>({ ...IDL, address: programId }, provider);
}

export function assertAmountWithPrecision(
  actualAmount: number,
  expectedAmount: number,
  precisionPercent: number
) {
  if (expectedAmount == 0 && actualAmount == 0) {
    return;
  }
  let maxAmount, minAmount;
  if (expectedAmount > actualAmount) {
    maxAmount = expectedAmount;
    minAmount = actualAmount;
  } else {
    maxAmount = actualAmount;
    minAmount = expectedAmount;
  }
  let diff = ((maxAmount - minAmount) * 100) / maxAmount;
  expect(diff).toBeLessThan(precisionPercent);
}

export async function assertPosition({
  lbClmm,
  positionPubkey,
  userPublicKey,
  xAmount,
  yAmount,
}: {
  lbClmm: DLMM;
  positionPubkey: PublicKey;
  userPublicKey: PublicKey;
  xAmount: BN;
  yAmount: BN;
}) {
  const positionState: Position = await lbClmm.program.account.positionV2.fetch(
    positionPubkey
  );

  const { userPositions } = await lbClmm.getPositionsByUserAndLbPair(
    userPublicKey
  );

  expect(userPositions.length).toBeGreaterThan(0);
  const position = userPositions.find((ps) =>
    ps.publicKey.equals(positionPubkey)
  );
  expect(position).not.toBeUndefined();
  expect(position.positionData.positionBinData.length).toBe(
    positionState.upperBinId - positionState.lowerBinId + 1
  );
  expect(position.positionData.positionBinData[0].binId).toBe(
    positionState.lowerBinId
  );
  expect(
    position.positionData.positionBinData[
      position.positionData.positionBinData.length - 1
    ].binId
  ).toBe(positionState.upperBinId);
  expect(+position.positionData.totalXAmount).toBeLessThan(xAmount.toNumber());
  assertAmountWithPrecision(
    +position.positionData.totalXAmount,
    xAmount.toNumber(),
    5
  );
  expect(+position.positionData.totalYAmount).toBeLessThan(yAmount.toNumber());
  assertAmountWithPrecision(
    +position.positionData.totalYAmount,
    yAmount.toNumber(),
    5
  );

  return { bins: position.positionData.positionBinData };
}

export function assertEqRebalanceSimulationWithActualResult(
  rebalancePosition: RebalancePosition,
  position: LbPosition
) {
  const [simulatedAmountX, simulatedAmountY] = rebalancePosition.totalAmounts();

  expect(position.positionData.totalXAmount.toString()).toBe(
    simulatedAmountX.toString()
  );

  expect(position.positionData.totalYAmount.toString()).toBe(
    simulatedAmountY.toString()
  );

  expect(position.positionData.lowerBinId).toBe(
    rebalancePosition.lowerBinId.toNumber()
  );

  expect(position.positionData.upperBinId).toBe(
    rebalancePosition.upperBinId.toNumber()
  );

  expect(rebalancePosition.rebalancePositionBinData.length).toBe(
    position.positionData.positionBinData.length
  );

  for (let i = 0; i < position.positionData.positionBinData.length; i++) {
    const simBinData = rebalancePosition.rebalancePositionBinData[i];
    const binData = position.positionData.positionBinData[i];

    expect(simBinData.binId).toBe(binData.binId);
    expect(simBinData.amountX.toString()).toBe(binData.positionXAmount);
    expect(simBinData.amountY.toString()).toBe(binData.positionYAmount);

    expect(simBinData.claimableFeeXAmount.toString()).toBe(
      binData.positionFeeXAmount
    );
    expect(simBinData.claimableFeeYAmount.toString()).toBe(
      binData.positionFeeYAmount
    );
    expect(simBinData.claimableRewardAmount[0].toString()).toBe(
      binData.positionRewardAmount[0]
    );
    expect(simBinData.claimableRewardAmount[1].toString()).toBe(
      binData.positionRewardAmount[1]
    );
  }
}

export async function swap(
  swapForY: boolean,
  inAmount: BN,
  dlmm: DLMM,
  keypair: Keypair
) {
  await dlmm.refetchStates();
  const inToken = swapForY ? dlmm.lbPair.tokenXMint : dlmm.lbPair.tokenYMint;
  const outToken = swapForY ? dlmm.lbPair.tokenYMint : dlmm.lbPair.tokenXMint;
  const binArrays = await dlmm.getBinArrayForSwap(swapForY);
  const { consumedInAmount } = await dlmm.swapQuote(
    inAmount,
    swapForY,
    new BN(0),
    binArrays,
    true
  );
  const swapTx = await dlmm.swap({
    lbPair: dlmm.pubkey,
    inToken,
    outToken,
    inAmount: consumedInAmount,
    minOutAmount: new BN(0),
    binArraysPubkey: binArrays.map((binArray) => binArray.publicKey),
    user: keypair.publicKey,
  });
  await sendAndConfirmTransaction(dlmm.program.provider.connection, swapTx, [
    keypair,
  ]);
}

export function logPositionLiquidities(parsedPosition: PositionData) {
  const { positionBinData } = parsedPosition;
  const liquidities = [];
  for (const data of positionBinData) {
    if (new Decimal(data.binLiquidity).isZero()) {
      liquidities.push([data.binId, 0]);
      continue;
    }
    const liquidityX = new Decimal(data.positionXAmount).mul(
      new Decimal(data.price)
    );
    const liquidityY = new Decimal(data.positionYAmount);
    const liquidity = liquidityX.add(liquidityY);
    liquidities.push([data.binId, liquidity.toNumber()]);
  }
  console.log(babar(liquidities));
}

export function assertionWithTolerance(
  actual: BN,
  expected: BN,
  tolerance: BN
) {
  try {
    expect(actual.sub(expected).abs().lte(tolerance)).toBeTruthy();
  } catch (originalError) {
    const e = `E: ${originalError}. Assertion failed, actual: ${actual.toString()}, expected: ${expected.toString()}, tolerance: ${tolerance.toString()}`;
    throw new Error(e);
  }
}

export function assertionWithPercentageTolerance(
  actual: BN,
  expected: BN,
  tolerancePercentage: number
) {
  const tolerance = actual.sub(expected).abs().muln(100).div(actual);
  try {
    expect(tolerance.ltn(tolerancePercentage)).toBeTruthy();
  } catch (originalError) {
    const e = `E: ${originalError}. Assertion failed, actual: ${actual.toString()}, expected: ${expected.toString()}, tolerance percentage: ${tolerancePercentage}`;
    throw new Error(e);
  }
}

export async function logLbPairLiquidities(
  lbPair: PublicKey,
  binStep: number,
  program: Program<LbClmm>
) {
  const binArrays = await program.account.binArray.all([
    {
      memcmp: {
        offset: 24,
        bytes: lbPair.toBase58(),
      },
    },
  ]);

  binArrays.sort((a, b) => a.account.index.cmp(b.account.index));

  const liquidities = [];
  for (const binArray of binArrays) {
    const [minBinId] = getBinArrayLowerUpperBinId(binArray.account.index);

    for (const [idx, bin] of binArray.account.bins.entries()) {
      const binId = minBinId.toNumber() + idx;

      if (bin.liquiditySupply.isZero()) {
        liquidities.push([binId, 0]);
        continue;
      }
      const liquidityX = new Decimal(bin.amountX.toString()).mul(
        getPriceOfBinByBinId(binId, binStep)
      );
      const liquidityY = new Decimal(bin.amountY.toString());
      const liquidity = liquidityX.add(liquidityY);
      liquidities.push([binId, liquidity.toNumber()]);
    }
  }

  console.log(babar(liquidities));
}

export enum OperatorPermission {
  InitializePresetParameter,
  ClosePresetParameter,
  SetPairStatus,
  UpdateFeeParameters,
  SetActivationPoint,
  InitializePermissionedPool,
  InitializeTokenBadge,
  CloseTokenBadge,
  InitializeReward,
  UpdateRewardFunder,
  UpdateRewardDuration,
  ResetTombstoneFields,
  ClaimProtocolFee,
  ZapProtocolFee,
}

export function encodePermissions(permissions: OperatorPermission[]): BN {
  return permissions.reduce((acc, perm) => {
    return acc.or(new BN(1).shln(perm));
  }, new BN(0));
}

export async function createWhitelistOperator(
  connection: Connection,
  admin: Keypair,
  whitelistOperator: PublicKey,
  permissions: OperatorPermission[],
  programId: PublicKey
) {
  const encodedPermissions = encodePermissions(permissions);
  const program = createTestProgram(connection, programId, admin);
  const operatorPda = deriveOperator(whitelistOperator, program.programId);

  const operatorAccount = await connection.getAccountInfo(operatorPda);
  if (operatorAccount) {
    return operatorPda;
  }

  await program.methods
    .createOperatorAccount(encodedPermissions)
    .accountsPartial({
      signer: admin.publicKey,
      operator: operatorPda,
      whitelistedSigner: whitelistOperator,
      systemProgram: SystemProgram.programId,
    })
    .signers([admin])
    .rpc();

  return operatorPda;
}
