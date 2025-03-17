import {
  addExtraAccountMetasForExecute,
  calculateFee,
  createTransferCheckedInstruction,
  getEpochFee,
  getTransferFeeConfig,
  getTransferHook,
  MAX_FEE_BASIS_POINTS,
  Mint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TransferFee,
  unpackMint,
} from "@solana/spl-token";
import {
  AccountInfo,
  AccountMeta,
  Connection,
  PublicKey,
} from "@solana/web3.js";
import BN from "bn.js";

export async function getMultipleMintsExtraAccountMetasForTransferHook(
  connection: Connection,
  mintAddressesWithAccountInfo: {
    mintAddress: PublicKey;
    mintAccountInfo: AccountInfo<Buffer>;
  }[]
): Promise<Map<String, AccountMeta[]>> {
  const extraAccountMetas = await Promise.all(
    mintAddressesWithAccountInfo.map(({ mintAddress, mintAccountInfo }) =>
      getExtraAccountMetasForTransferHook(
        connection,
        mintAddress,
        mintAccountInfo
      )
    )
  );

  const mintsWithHookAccountMap = new Map<String, AccountMeta[]>();

  for (let i = 0; i < extraAccountMetas.length; i++) {
    const { mintAddress } = mintAddressesWithAccountInfo[i];
    const transferHooks = extraAccountMetas[i];

    mintsWithHookAccountMap.set(mintAddress.toBase58(), transferHooks);
  }

  return mintsWithHookAccountMap;
}

export async function getExtraAccountMetasForTransferHook(
  connection: Connection,
  mintAddress: PublicKey,
  mintAccountInfo: AccountInfo<Buffer>
) {
  if (
    ![TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(
      mintAccountInfo.owner.toBase58()
    )
  ) {
    return [];
  }

  const mintState = unpackMint(
    mintAddress,
    mintAccountInfo,
    mintAccountInfo.owner
  );

  if (mintAccountInfo.owner.equals(TOKEN_PROGRAM_ID)) {
    return [];
  }

  const transferHook = getTransferHook(mintState);

  if (!transferHook || transferHook.programId.equals(PublicKey.default)) {
    return [];
  } else {
    // We just need the instruction, therefore we do not need source and destination key
    const instruction = createTransferCheckedInstruction(
      PublicKey.default,
      mintAddress,
      PublicKey.default,
      PublicKey.default,
      BigInt(0),
      mintState.decimals,
      [],
      mintAccountInfo.owner
    );

    await addExtraAccountMetasForExecute(
      connection,
      instruction,
      transferHook.programId,
      PublicKey.default,
      mintAddress,
      PublicKey.default,
      PublicKey.default,
      BigInt(0)
    );

    // Only 4 keys needed if it's single signer. https://github.com/solana-labs/solana-program-library/blob/d72289c79a04411c69a8bf1054f7156b6196f9b3/token/js/src/extensions/transferFee/instructions.ts#L251
    const transferHookAccounts = instruction.keys.slice(4);

    // Token 2022 program allow transfer hook program to be invoked without any accounts. https://github.com/solana-program/transfer-hook/blob/e00f3b5c591fd55b4aed6a1e9b1ccc502cb6da05/interface/src/onchain.rs#L37
    if (transferHookAccounts.length == 0) {
      transferHookAccounts.push({
        pubkey: transferHook.programId,
        isSigner: false,
        isWritable: false,
      });
    }

    return transferHookAccounts;
  }
}

function calculatePreFeeAmount(transferFee: TransferFee, postFeeAmount: BN) {
  if (postFeeAmount.isZero()) {
    return new BN(0);
  }

  if (transferFee.transferFeeBasisPoints === 0) {
    return postFeeAmount;
  }

  const maximumFee = new BN(transferFee.maximumFee.toString());

  if (transferFee.transferFeeBasisPoints === MAX_FEE_BASIS_POINTS) {
    return postFeeAmount.add(maximumFee);
  }

  const ONE_IN_BASIS_POINTS = new BN(MAX_FEE_BASIS_POINTS);
  const numerator = postFeeAmount.mul(ONE_IN_BASIS_POINTS);
  const denominator = ONE_IN_BASIS_POINTS.sub(
    new BN(transferFee.transferFeeBasisPoints)
  );

  const rawPreFeeAmount = numerator
    .add(denominator)
    .sub(new BN(1))
    .div(denominator);

  if (rawPreFeeAmount.sub(postFeeAmount).gte(maximumFee)) {
    return postFeeAmount.add(maximumFee);
  }

  return rawPreFeeAmount;
}

function calculateInverseFee(transferFee: TransferFee, postFeeAmount: BN) {
  const preFeeAmount = calculatePreFeeAmount(transferFee, postFeeAmount);
  return new BN(
    calculateFee(transferFee, BigInt(preFeeAmount.toString())).toString()
  );
}

interface TransferFeeIncludedAmount {
  amount: BN;
  transferFee: BN;
}

export function calculateTransferFeeIncludedAmount(
  transferFeeExcludedAmount: BN,
  mint: Mint,
  currentEpoch: number
): TransferFeeIncludedAmount {
  if (transferFeeExcludedAmount.isZero()) {
    return {
      amount: new BN(0),
      transferFee: new BN(0),
    };
  }

  const transferFeeConfig = getTransferFeeConfig(mint);

  if (transferFeeConfig === null) {
    return {
      amount: transferFeeExcludedAmount,
      transferFee: new BN(0),
    };
  }

  const epochFee = getEpochFee(transferFeeConfig, BigInt(currentEpoch));

  const transferFee =
    epochFee.transferFeeBasisPoints == MAX_FEE_BASIS_POINTS
      ? new BN(epochFee.maximumFee.toString())
      : calculateInverseFee(epochFee, transferFeeExcludedAmount);

  const transferFeeIncludedAmount = transferFeeExcludedAmount.add(transferFee);

  return {
    amount: transferFeeIncludedAmount,
    transferFee,
  };
}

interface TransferFeeExcludedAmount {
  amount: BN;
  transferFee: BN;
}

export function calculateTransferFeeExcludedAmount(
  transferFeeIncludedAmount: BN,
  mint: Mint,
  currentEpoch: number
): TransferFeeExcludedAmount {
  const transferFeeConfig = getTransferFeeConfig(mint);
  if (transferFeeConfig === null) {
    return {
      amount: transferFeeIncludedAmount,
      transferFee: new BN(0),
    };
  }

  const transferFeeIncludedAmountN = BigInt(
    transferFeeIncludedAmount.toString()
  );

  const transferFee = calculateFee(
    getEpochFee(transferFeeConfig, BigInt(currentEpoch)),
    transferFeeIncludedAmountN
  );

  const transferFeeExcludedAmount = new BN(
    (transferFeeIncludedAmountN - transferFee).toString()
  );

  return {
    amount: transferFeeExcludedAmount,
    transferFee: new BN(transferFee.toString()),
  };
}
