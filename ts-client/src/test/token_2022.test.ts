import { Wallet } from "@coral-xyz/anchor";
import {
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  createInitializeTransferHookInstruction,
  ExtensionType,
  getExtraAccountMetaAddress,
  getMintLen,
  TOKEN_2022_PROGRAM_ID,
  unpackMint,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { BN } from "bn.js";
import fs from "fs";
import {
  calculateTransferFeeExcludedAmount,
  calculateTransferFeeIncludedAmount,
  getExtraAccountMetasForTransferHook,
  getMultipleMintsExtraAccountMetasForTransferHook,
} from "../dlmm/helpers/token_2022";
import {
  createExtraAccountMetaListAndCounter,
  deriveCounter,
} from "./external/helper";
import {
  createTransferHookCounterProgram,
  TRANSFER_HOOK_COUNTER_PROGRAM_ID,
} from "./external/program";

const connection = new Connection("http://127.0.0.1:8899", "confirmed");

const keypairBuffer = fs.readFileSync(
  "../keys/localnet/admin-bossj3JvwiNK7pvjr149DqdtJxf2gdygbcmEPTkb2F1.json",
  "utf-8"
);
const keypair = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(keypairBuffer))
);

const BTCKeypair = Keypair.generate();
const USDCKeypair = Keypair.generate();

const BTCWithTransferHook: PublicKey = BTCKeypair.publicKey;
const USDCWithTransferFeeAndHook: PublicKey = USDCKeypair.publicKey;

const transferFeeBps = 500; // 5%
const maxFee = BigInt(100_000);

async function createMintWithExtensions(
  owner: Keypair,
  mintKeypair: Keypair,
  extensionWithIx: {
    createIx: TransactionInstruction;
    extensionType: ExtensionType;
  }[],
  decimals: number
) {
  const extensions = extensionWithIx.map((e) => e.extensionType);
  const mintLen = getMintLen(extensions);
  const minLamports = await connection.getMinimumBalanceForRentExemption(
    mintLen
  );

  const transaction = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: keypair.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: mintLen,
      lamports: minLamports,
      programId: TOKEN_2022_PROGRAM_ID,
    })
  );

  for (const { createIx } of extensionWithIx) {
    transaction.add(createIx);
  }

  transaction.add(
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      decimals,
      owner.publicKey,
      null,
      TOKEN_2022_PROGRAM_ID
    )
  );

  await sendAndConfirmTransaction(
    connection,
    transaction,
    [keypair, mintKeypair],
    {
      commitment: "confirmed",
    }
  );
}

describe("Token 2022 helper test", () => {
  beforeAll(async () => {
    const signature = await connection.requestAirdrop(
      keypair.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(signature, "confirmed");

    const transferHookCounterProgram = createTransferHookCounterProgram(
      new Wallet(keypair),
      TRANSFER_HOOK_COUNTER_PROGRAM_ID,
      connection
    );

    await createMintWithExtensions(
      keypair,
      USDCKeypair,
      [
        {
          createIx: createInitializeTransferHookInstruction(
            USDCKeypair.publicKey,
            keypair.publicKey,
            TRANSFER_HOOK_COUNTER_PROGRAM_ID,
            TOKEN_2022_PROGRAM_ID
          ),
          extensionType: ExtensionType.TransferHook,
        },
        {
          createIx: createInitializeTransferFeeConfigInstruction(
            USDCKeypair.publicKey,
            keypair.publicKey,
            null,
            transferFeeBps,
            maxFee,
            TOKEN_2022_PROGRAM_ID
          ),
          extensionType: ExtensionType.TransferFeeConfig,
        },
      ],
      6
    ).then(() => {
      return createExtraAccountMetaListAndCounter(
        transferHookCounterProgram,
        USDCWithTransferFeeAndHook
      );
    });

    await createMintWithExtensions(
      keypair,
      BTCKeypair,
      [
        {
          createIx: createInitializeTransferHookInstruction(
            BTCKeypair.publicKey,
            keypair.publicKey,
            TRANSFER_HOOK_COUNTER_PROGRAM_ID,
            TOKEN_2022_PROGRAM_ID
          ),
          extensionType: ExtensionType.TransferHook,
        },
      ],
      6
    ).then(() => {
      return createExtraAccountMetaListAndCounter(
        transferHookCounterProgram,
        BTCWithTransferHook
      );
    });
  });

  it("getExtraAccountMetasForTransferHook return correct accounts", async () => {
    const mintAccount = await connection.getAccountInfo(
      USDCWithTransferFeeAndHook
    );

    const extraAccountMetas = await getExtraAccountMetasForTransferHook(
      connection,
      USDCWithTransferFeeAndHook,
      mintAccount
    );

    const counterPda = deriveCounter(
      USDCWithTransferFeeAndHook,
      TRANSFER_HOOK_COUNTER_PROGRAM_ID
    );

    expect(extraAccountMetas.length).toBe(3);

    const account0 = extraAccountMetas[0].pubkey.toBase58();
    expect(account0).toBe(counterPda.toBase58());

    const account1 = extraAccountMetas[1].pubkey.toBase58();
    expect(account1).toBe(TRANSFER_HOOK_COUNTER_PROGRAM_ID.toBase58());

    const account2 = extraAccountMetas[2].pubkey.toBase58();
    expect(account2).toBe(
      getExtraAccountMetaAddress(
        USDCWithTransferFeeAndHook,
        TRANSFER_HOOK_COUNTER_PROGRAM_ID
      ).toBase58()
    );
  });

  it("getMultipleMintsExtraAccountMetasForTransferHook return correct accounts", async () => {
    const [usdcMintAccount, btcMintAccount] =
      await connection.getMultipleAccountsInfo([
        USDCWithTransferFeeAndHook,
        BTCWithTransferHook,
      ]);

    const multipleMintsExtraAccountMetas =
      await getMultipleMintsExtraAccountMetasForTransferHook(connection, [
        {
          mintAddress: USDCWithTransferFeeAndHook,
          mintAccountInfo: usdcMintAccount,
        },
        {
          mintAddress: BTCWithTransferHook,
          mintAccountInfo: btcMintAccount,
        },
      ]);

    for (const [mintAddress, accounts] of multipleMintsExtraAccountMetas) {
      expect(accounts.length).toBe(3);
      const mintKey = new PublicKey(mintAddress);

      const counterPda = deriveCounter(
        mintKey,
        TRANSFER_HOOK_COUNTER_PROGRAM_ID
      );

      const account0 = accounts[0].pubkey.toBase58();
      expect(account0).toBe(counterPda.toBase58());

      const account1 = accounts[1].pubkey.toBase58();
      expect(account1).toBe(TRANSFER_HOOK_COUNTER_PROGRAM_ID.toBase58());

      const account2 = accounts[2].pubkey.toBase58();
      expect(account2).toBe(
        getExtraAccountMetaAddress(
          mintKey,
          TRANSFER_HOOK_COUNTER_PROGRAM_ID
        ).toBase58()
      );
    }
  });

  it("calculateTransferFeeIncludedAmount return more value than original value", async () => {
    const usdcMintAccount = await connection.getAccountInfo(
      USDCWithTransferFeeAndHook
    );

    const mint = unpackMint(
      USDCWithTransferFeeAndHook,
      usdcMintAccount,
      usdcMintAccount.owner
    );

    const transferFeeExcludedAmount = new BN(100_000);

    const transferFeeIncludedAmount = calculateTransferFeeIncludedAmount(
      transferFeeExcludedAmount,
      mint,
      0
    ).amount;

    expect(
      transferFeeIncludedAmount.gt(transferFeeExcludedAmount)
    ).toBeTruthy();
  });

  it("calculateTransferFeeExcludedAmount return less value than original value", async () => {
    const usdcMintAccount = await connection.getAccountInfo(
      USDCWithTransferFeeAndHook
    );

    const mint = unpackMint(
      USDCWithTransferFeeAndHook,
      usdcMintAccount,
      usdcMintAccount.owner
    );

    const transferFeeIncludedAmount = new BN(100_000);

    const transferFeeExcludedAmount = calculateTransferFeeExcludedAmount(
      transferFeeIncludedAmount,
      mint,
      0
    ).amount;

    expect(
      transferFeeIncludedAmount.gt(transferFeeExcludedAmount)
    ).toBeTruthy();
  });
});
