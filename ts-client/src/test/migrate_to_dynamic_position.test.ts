import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { BN } from "bn.js";
import fs from "fs";
import { DLMM } from "../dlmm";
import { DEFAULT_BIN_PER_POSITION } from "../dlmm/constants";
import { IPosition, wrapPosition } from "../dlmm/helpers/positions";
import { PositionInfo, PositionVersion } from "../dlmm/types";

// 1. Dump the account: target/debug/cli download-user-pool-files --wallet-key <wallet key> --override-wallet-key bossj3JvwiNK7pvjr149DqdtJxf2gdygbcmEPTkb2F1 --pool-key 6StaAqeVjKUPTgMLmcLmdpmUjoYHRcZ6uViLdWNdUghM --output-path $(readlink -f ./artifacts/jlp-hubsol-6StaAqeVjKUPTgMLmcLmdpmUjoYHRcZ6uViLdWNdUghM)
// 2. Run local validator: solana-test-validator --bpf-program LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo ./artifacts/lb_clmm.so --account-dir ./artifacts/jlp-hubsol-6StaAqeVjKUPTgMLmcLmdpmUjoYHRcZ6uViLdWNdUghM --reset
const poolKey = new PublicKey("6StaAqeVjKUPTgMLmcLmdpmUjoYHRcZ6uViLdWNdUghM");

const keypairBuffer = fs.readFileSync(
  "../keys/localnet/admin-bossj3JvwiNK7pvjr149DqdtJxf2gdygbcmEPTkb2F1.json",
  "utf-8"
);
const connection = new Connection("http://127.0.0.1:8899", "confirmed");
const keypair = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(keypairBuffer))
);

describe("Migrate to dynamic position", () => {
  let dlmm: DLMM;

  const positionAddresses = [
    "AwnJvVkbuYfG84kHiBcyVmZKU6A2SPW1NaaVBhtdLdZA",
    "2kCAXMS8t8AT8FjXnSBHTPz8gwJZdrpFxtwTtahVbYXX",
  ];

  // These values were getting from the UI
  const expectedTotalAmountX = new BN(94568);
  const expectedTotalAmountY = new BN(27401428);
  const expectedTotalFeeX = new BN(2973);
  const expectedTotalFeeY = new BN(61825);
  const expectedTotalReward0 = new BN(91745);
  const expectedTotalReward1 = new BN(0);

  const positionStateBeforeAfter: Map<
    string,
    { before: IPosition; after: IPosition }
  > = new Map();

  beforeAll(async () => {
    dlmm = await DLMM.create(connection, poolKey, {
      cluster: "mainnet-beta",
    });

    const signature = await connection.requestAirdrop(
      keypair.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(signature, "confirmed");
  });

  describe("Before migrate", () => {
    it("Fetch pair and position correctly", async () => {
      const positionsBeforeMigrate = await DLMM.getAllLbPairPositionsByUser(
        connection,
        keypair.publicKey,
        {
          cluster: "mainnet-beta",
        }
      );

      const pairAddresses = Array.from(positionsBeforeMigrate.keys());
      expect(pairAddresses.length).toBe(1);
      expect(pairAddresses[0]).toBe(poolKey.toBase58());

      const positionContainer = positionsBeforeMigrate.get(poolKey.toBase58());

      let totalAmountX = new BN(0);
      let totalAmountY = new BN(0);
      let totalFeeX = new BN(0);
      let totalFeeY = new BN(0);
      let totalReward0 = new BN(0);
      let totalReward1 = new BN(0);

      for (const position of positionContainer.lbPairPositionsData) {
        expect(
          positionAddresses.includes(position.publicKey.toBase58())
        ).toBeTruthy();

        expect(position.version).toBe(PositionVersion.V2);

        const {
          totalXAmount: amountX,
          totalYAmount: amountY,
          feeX,
          feeY,
          rewardOne,
          rewardTwo,
        } = position.positionData;

        totalAmountX = totalAmountX.add(new BN(amountX));
        totalAmountY = totalAmountY.add(new BN(amountY));
        totalFeeX = totalFeeX.add(feeX);
        totalFeeY = totalFeeY.add(feeY);
        totalReward0 = totalReward0.add(rewardOne);
        totalReward1 = totalReward1.add(rewardTwo);
      }

      expect(totalAmountX.toString()).toBe(expectedTotalAmountX.toString());
      expect(totalAmountY.toString()).toBe(expectedTotalAmountY.toString());

      expect(totalFeeX.toString()).toBe(expectedTotalFeeX.toString());
      expect(totalFeeY.toString()).toBe(expectedTotalFeeY.toString());

      expect(totalReward0.toString()).toBe(expectedTotalReward0.toString());
      expect(totalReward1.toString()).toBe(expectedTotalReward1.toString());
    });
  });

  describe("Migrate", () => {
    it("Migrate to dynamic position", async () => {
      const positionsBeforeMigrate = await DLMM.getAllLbPairPositionsByUser(
        connection,
        keypair.publicKey,
        {
          cluster: "mainnet-beta",
        }
      );
      const positionContainer = positionsBeforeMigrate.get(poolKey.toBase58());
      const positions = positionContainer.lbPairPositionsData;

      const saveBeforeMigrationState = async (positionKey: PublicKey) => {
        const account = await connection.getAccountInfo(positionKey);
        positionStateBeforeAfter.set(positionKey.toBase58(), {
          before: wrapPosition(dlmm.program, positionKey, account),
          after: null,
        });
      };

      const saveAfterMigrationState = async (
        beforePositionKey: PublicKey,
        afterPositionKey: PublicKey
      ) => {
        const account = await connection.getAccountInfo(afterPositionKey);
        let migrationState = positionStateBeforeAfter.get(
          beforePositionKey.toBase58()
        );
        migrationState.after = wrapPosition(
          dlmm.program,
          afterPositionKey,
          account
        );
        positionStateBeforeAfter.set(
          beforePositionKey.toBase58(),
          migrationState
        );
      };

      for (const position of positions) {
        const positionV3Keypair = Keypair.generate();

        console.log("Migrate position", position.publicKey.toBase58());

        await saveBeforeMigrationState(position.publicKey);

        const migrateTx = await dlmm.migratePositionV3({
          positionV2: position.publicKey,
          positionV3: positionV3Keypair.publicKey,
          feePayer: keypair.publicKey,
        });

        await sendAndConfirmTransaction(
          connection,
          migrateTx,
          [keypair, positionV3Keypair],
          {
            commitment: "confirmed",
          }
        );

        await saveAfterMigrationState(
          position.publicKey,
          positionV3Keypair.publicKey
        );
      }
    });
  });

  describe("After migrate", () => {
    let positionsAfterMigrate: Map<string, PositionInfo> = null;

    it("Fetch pair and position correctly", async () => {
      positionsAfterMigrate = await DLMM.getAllLbPairPositionsByUser(
        connection,
        keypair.publicKey,
        {
          cluster: "mainnet-beta",
        }
      );

      const pairAddresses = Array.from(positionsAfterMigrate.keys());
      expect(pairAddresses.length).toBe(1);
      expect(pairAddresses[0]).toBe(poolKey.toBase58());

      const positionContainer = positionsAfterMigrate.get(poolKey.toBase58());

      let totalAmountX = new BN(0);
      let totalAmountY = new BN(0);
      let totalFeeX = new BN(0);
      let totalFeeY = new BN(0);
      let totalReward0 = new BN(0);
      let totalReward1 = new BN(0);

      for (const position of positionContainer.lbPairPositionsData) {
        expect(position.version).toBe(PositionVersion.V3);

        const {
          totalXAmount: amountX,
          totalYAmount: amountY,
          feeX,
          feeY,
          rewardOne,
          rewardTwo,
        } = position.positionData;

        totalAmountX = totalAmountX.add(new BN(amountX));
        totalAmountY = totalAmountY.add(new BN(amountY));
        totalFeeX = totalFeeX.add(feeX);
        totalFeeY = totalFeeY.add(feeY);
        totalReward0 = totalReward0.add(rewardOne);
        totalReward1 = totalReward1.add(rewardTwo);
      }

      expect(totalAmountX.toString()).toBe(expectedTotalAmountX.toString());
      expect(totalAmountY.toString()).toBe(expectedTotalAmountY.toString());

      expect(totalFeeX.toString()).toBe(expectedTotalFeeX.toString());
      expect(totalFeeY.toString()).toBe(expectedTotalFeeY.toString());

      expect(totalReward0.toString()).toBe(expectedTotalReward0.toString());
      expect(totalReward1.toString()).toBe(expectedTotalReward1.toString());
    });

    it("Before and after have exact raw position state", () => {
      for (const [_, migrationState] of positionStateBeforeAfter) {
        const before = migrationState.before;
        const after = migrationState.after;

        expect(before.lbPair().toBase58()).toEqual(after.lbPair().toBase58());
        expect(before.lastUpdatedAt().toString()).toEqual(
          after.lastUpdatedAt().toString()
        );
        expect(before.lockReleasePoint().toString()).toEqual(
          after.lockReleasePoint().toString()
        );
        expect(before.operator().toBase58()).toEqual(
          after.operator().toBase58()
        );
        expect(before.owner().toBase58()).toEqual(after.owner().toBase58());
        expect(before.feeOwner().toBase58()).toEqual(
          after.feeOwner().toBase58()
        );
        expect(before.lowerBinId().toString()).toEqual(
          after.lowerBinId().toString()
        );
        expect(before.upperBinId().toString()).toEqual(
          after.upperBinId().toString()
        );
        expect(before.totalClaimedFeeXAmount().toString()).toEqual(
          after.totalClaimedFeeXAmount().toString()
        );

        expect(before.totalClaimedFeeYAmount().toString()).toEqual(
          after.totalClaimedFeeYAmount().toString()
        );

        const shareLength = before
          .upperBinId()
          .sub(before.lowerBinId())
          .add(new BN(1))
          .toNumber();

        expect(before.liquidityShares().length).toEqual(
          DEFAULT_BIN_PER_POSITION.toNumber()
        );

        expect(after.liquidityShares().length).toEqual(shareLength);

        expect(before.feeInfos().length).toEqual(
          DEFAULT_BIN_PER_POSITION.toNumber()
        );

        expect(after.feeInfos().length).toEqual(shareLength);

        for (let i = 0; i < shareLength; i++) {
          expect(before.liquidityShares()[i].toString()).toEqual(
            after.liquidityShares()[i].toString()
          );
          expect(before.feeInfos()[i].toString()).toEqual(
            after.feeInfos()[i].toString()
          );
        }

        for (let i = 0; i < shareLength; i++) {
          const rewardBefore = before.rewardInfos()[i];
          const rewardAfter = after.rewardInfos()[i];

          for (let j = 0; j < 0; j++) {
            expect(rewardBefore.rewardPendings[j].toString()).toEqual(
              rewardAfter.rewardPendings[j].toString()
            );

            expect(rewardBefore.rewardPerTokenCompletes[j].toString()).toEqual(
              rewardAfter.rewardPerTokenCompletes[j].toString()
            );
          }
        }
      }
    });
  });
});
