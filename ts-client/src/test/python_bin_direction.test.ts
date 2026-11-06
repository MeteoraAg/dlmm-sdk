import {
  AccountInfo,
  Connection,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import express from "express";
import fs from "fs";
import http, { Server } from "http";
import { AddressInfo } from "net";
import path from "path";
import { DLMM } from "../dlmm";
import { CollectFeeMode, FunctionType } from "../dlmm/constants";
import {
  createProgram,
  deriveBinArray,
  getQPriceFromId,
} from "../dlmm/helpers";

const fixtureKey = "9t3EyC9FweyL7PBWvKz3mrXg8B9fwFc9SK3QxM4ENqhd";
const poolKey = new PublicKey(fixtureKey);
const fixtureDir = path.resolve(
  __dirname,
  "../../../commons/tests/fixtures",
  fixtureKey,
);
const read = (name: string) => fs.readFileSync(path.join(fixtureDir, name));

describe("Python bin-array direction contract", () => {
  let server: Server;
  let port: number;
  let client: DLMM;

  beforeAll(async () => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    const now = Math.floor(Date.now() / 1000);
    jest.spyOn(Date, "now").mockReturnValue(now * 1000);
    const connection = new Connection("http://offline.invalid");
    const program = createProgram(connection);
    const pool = program.coder.accounts.decode(
      "lbPair",
      read("lb_pair.bin"),
    ) as any;
    const template = program.coder.accounts.decode(
      "binArray",
      read("bin_array_1.bin"),
    ) as any;
    pool.activeId = 0;
    pool.parameters.functionType = FunctionType.LiquidityMining;
    pool.parameters.collectFeeMode = CollectFeeMode.InputOnly;
    pool.parameters.baseFactor = 0;
    pool.parameters.variableFeeControl = 0;
    pool.vParameters.indexReference = 0;
    pool.vParameters.volatilityAccumulator = 0;
    pool.vParameters.volatilityReference = 0;
    pool.vParameters.lastUpdateTimestamp = new BN(now);
    pool.rewardInfos.forEach((reward) => {
      reward.mint = PublicKey.default;
      reward.vault = PublicKey.default;
    });
    pool.binArrayBitmap = Array.from({ length: 16 }, () => new BN(0));
    const accounts = new Map<string, AccountInfo<Buffer>>();
    const info = (
      data: Buffer,
      owner = TOKEN_PROGRAM_ID,
    ): AccountInfo<Buffer> => ({
      data,
      owner,
      lamports: 10000000,
      executable: false,
      rentEpoch: 0,
    });
    const encode = (name: string, account: any) => {
      const coder = program.coder.accounts;
      // The public Anchor encoder allocates only 1000 bytes; arrays need more.
      const buffer = Buffer.alloc(coder.size(name));
      const length = (coder as any).accountLayouts
        .get(name)
        .layout.encode(account, buffer);
      return Buffer.concat([
        (coder as any).accountDiscriminator(name),
        buffer.subarray(0, length),
      ]);
    };
    for (const index of [-3, -2, -1, 0, 1, 2, 3]) {
      const bit = index + 512;
      pool.binArrayBitmap[Math.floor(bit / 64)].iadd(new BN(1).shln(bit % 64));
      const bins = Array.from({ length: 70 }, (_, offset) => {
        const bin: any = Object.fromEntries(
          Object.entries(template.bins[0]).map(([key, value]) => [
            key,
            BN.isBN(value)
              ? new BN(0)
              : Array.isArray(value)
                ? value.map(() => 0)
                : 0,
          ]),
        );
        bin.price = getQPriceFromId(
          new BN(index * 70 + offset),
          new BN(pool.binStep),
        );
        return bin;
      });
      const bin = bins[index < 0 ? 69 : 0];
      bin.liquiditySupply = new BN(2000);
      if (index === 0) {
        bin.amountX = new BN(200);
        bin.amountY = new BN(200);
      } else {
        bin[index < 0 ? "amountY" : "amountX"] = new BN(2000);
      }
      const account = {
        ...template,
        index: new BN(index),
        lbPair: poolKey,
        bins,
      };
      const key = deriveBinArray(poolKey, account.index, program.programId)[0];
      accounts.set(
        key.toBase58(),
        info(encode("binArray", account), program.programId),
      );
    }
    accounts.set(fixtureKey, info(encode("lbPair", pool), program.programId));
    accounts.set(pool.tokenXMint.toBase58(), info(read("token_x_mint.bin")));
    accounts.set(pool.tokenYMint.toBase58(), info(read("token_y_mint.bin")));
    accounts.set(pool.reserveX.toBase58(), info(read("reserve_x.bin")));
    accounts.set(pool.reserveY.toBase58(), info(read("reserve_y.bin")));
    const clock = Buffer.alloc(40);
    clock.writeBigUInt64LE(1n, 0);
    clock.writeBigInt64LE(BigInt(now), 32);
    accounts.set(
      SYSVAR_CLOCK_PUBKEY.toBase58(),
      info(clock, PublicKey.default),
    );
    // Only RPC data is replaced; SDK creation, refetch, traversal and quotes run.
    jest
      .spyOn(Connection.prototype, "getMultipleAccountsInfo")
      .mockImplementation(async (keys) =>
        keys.map((key) => accounts.get(key.toBase58()) ?? null),
      );
    jest
      .spyOn(Connection.prototype, "getAccountInfo")
      .mockImplementation(async (key) => accounts.get(key.toBase58()) ?? null);
    client = await DLMM.create(connection, poolKey);

    // Import the real server with an ephemeral port, preserving its CLI startup.
    const listen = jest
      .spyOn(express.application, "listen")
      .mockImplementation(function (this: express.Application) {
        server = http.createServer(this);
        return server.listen(0, "127.0.0.1");
      });
    try {
      require("../server");
    } finally {
      listen.mockRestore();
    }
    await new Promise<void>((resolve) => server.once("listening", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    if (server)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    jest.restoreAllMocks();
  });

  function request(
    route: string,
    body: unknown,
  ): Promise<{ status: number; body: any }> {
    const payload = JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          method: "POST",
          path: route,
          headers: {
            pool: fixtureKey,
            rpc: "http://offline.invalid",
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            try {
              resolve({
                status: res.statusCode!,
                body: JSON.parse(Buffer.concat(chunks).toString()),
              });
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      req.on("error", reject);
      req.end(payload);
    });
  }

  function indexes(wire: any[]) {
    return wire.map((array) => new BN(array.account.index, 16).toNumber());
  }

  it.each(
    [true, false].flatMap((direction) =>
      [1, 2, 4].map((count) => [direction, count] as const),
    ),
  )("uses Python's direction %s with count %s", async (direction, count) => {
    const result = await request("/dlmm/get-bin-array-for-swap", {
      swapYToX: direction,
      count,
    });
    expect(result.status).toBe(200);
    expect(indexes(result.body)).toEqual(
      Array.from({ length: count }, (_, i) => (direction && i > 0 ? -i : i)),
    );
  });

  it.each([true, false])(
    "retains the legacy key with direction %s",
    async (direction) => {
      const result = await request("/dlmm/get-bin-array-for-swap", {
        swapYtoX: direction,
        count: 2,
      });
      expect(result.status).toBe(200);
      expect(indexes(result.body)).toEqual(direction ? [0, -1] : [0, 1]);
    },
  );

  it.each([true, false])(
    "gives the Python key precedence, including explicit %s",
    async (direction) => {
      const result = await request("/dlmm/get-bin-array-for-swap", {
        swapYToX: direction,
        swapYtoX: !direction,
        count: 2,
      });
      expect(result.status).toBe(200);
      expect(indexes(result.body)).toEqual(direction ? [0, -1] : [0, 1]);
    },
  );

  it.each([true, false])(
    "quotes across an array boundary in direction %s",
    async (direction) => {
      const directArrays = await client.getBinArrayForSwap(direction, 4);
      const direct = client.swapQuote(
        new BN(1000),
        direction,
        new BN(0),
        directArrays,
      );
      const fetched = await request("/dlmm/get-bin-array-for-swap", {
        swapYToX: direction,
        count: 4,
      });
      expect(fetched.status).toBe(200);
      const result = await request("/dlmm/swap-quote", {
        swapYToX: direction,
        amount: 1000,
        allowedSlippage: 0,
        binArrays: fetched.body,
        isPartialFilled: false,
      });
      expect(result.status).toBe(200);
      for (const field of [
        "consumedInAmount",
        "outAmount",
        "fee",
        "protocolFee",
        "minOutAmount",
      ] as const)
        expect(new BN(result.body[field], 16).eq(direct[field])).toBe(true);
      expect(result.body.binArraysPubkey).toHaveLength(2);
    },
  );

  it.each([true, false])(
    "also quotes within the active array in direction %s",
    async (direction) => {
      const fetched = await request("/dlmm/get-bin-array-for-swap", {
        swapYToX: direction,
        count: 4,
      });
      const result = await request("/dlmm/swap-quote", {
        swapYToX: direction,
        amount: 16,
        allowedSlippage: 0,
        binArrays: fetched.body,
        isPartialFilled: false,
      });
      expect(result.status).toBe(200);
      expect(new BN(result.body.outAmount, 16).toNumber()).toBe(16);
      expect(result.body.binArraysPubkey).toHaveLength(1);
    },
  );
});
