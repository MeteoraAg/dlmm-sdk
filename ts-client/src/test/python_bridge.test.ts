import { AccountInfo, Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, unpackMint } from "@solana/spl-token";
import BN from "bn.js";
import fs from "fs";
import http, { Server } from "http";
import { AddressInfo } from "net";
import path from "path";
import { DLMM } from "../dlmm";
import { CollectFeeMode, FunctionType } from "../dlmm/constants";
import { createProgram, deriveBinArray } from "../dlmm/helpers";
import { Bin, BinArrayAccount, LbPair, TokenReserve } from "../dlmm/types";
import { app } from "../server";

// Existing repository account fixtures; no validator or external RPC is needed.
const fixtureKey = "9t3EyC9FweyL7PBWvKz3mrXg8B9fwFc9SK3QxM4ENqhd";
const fixtureDir = path.resolve(
  __dirname,
  "../../../commons/tests/fixtures",
  fixtureKey,
);
const poolKey = new PublicKey(fixtureKey);
const read = (name: string) => fs.readFileSync(path.join(fixtureDir, name));

describe("Python bridge bin round trips", () => {
  let server: Server;
  let port: number;
  let client: DLMM;
  let arrays: BinArrayAccount[];

  beforeAll(async () => {
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  beforeEach(() => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    const connection = new Connection("http://127.0.0.1:8899");
    const program = createProgram(connection);
    const pool = program.coder.accounts.decode(
      "lbPair",
      read("lb_pair.bin"),
    ) as LbPair;
    const account = program.coder.accounts.decode(
      "binArray",
      read("bin_array_1.bin"),
    );
    const emptyBin = Object.fromEntries(
      Object.entries(account.bins[0]).map(([key, value]) => [
        key,
        BN.isBN(value) ? new BN(0) : value,
      ]),
    ) as Bin;
    emptyBin.price = new BN(1).shln(64);

    pool.activeId = -1;
    pool.parameters.functionType = FunctionType.LimitOrder;
    pool.parameters.collectFeeMode = CollectFeeMode.InputOnly;
    pool.parameters.baseFactor = 0;
    pool.parameters.variableFeeControl = 0;
    pool.vParameters.indexReference = -1;
    pool.vParameters.volatilityAccumulator = 0;
    pool.vParameters.volatilityReference = 0;
    pool.vParameters.lastUpdateTimestamp = new BN(
      Math.floor(Date.now() / 1000),
    );
    pool.binArrayBitmap = Array.from({ length: 16 }, () => new BN(0));
    pool.binArrayBitmap[7] = new BN(1).shln(63); // array index -1

    account.index = new BN(-1);
    account.lbPair = poolKey;
    account.bins = Array.from({ length: 70 }, () => ({ ...emptyBin }));
    arrays = [
      {
        publicKey: deriveBinArray(poolKey, account.index, program.programId)[0],
        account,
      },
    ];

    const token = (
      mintKey: PublicKey,
      reserve: PublicKey,
      file: string,
    ): TokenReserve => {
      const info: AccountInfo<Buffer> = {
        data: read(file),
        owner: TOKEN_PROGRAM_ID,
        executable: false,
        lamports: 1,
        rentEpoch: 0,
      };
      return {
        publicKey: mintKey,
        reserve,
        mint: unpackMint(mintKey, info, TOKEN_PROGRAM_ID),
        amount: 0n,
        owner: TOKEN_PROGRAM_ID,
        transferHookAccountMetas: [],
      };
    };
    client = new DLMM(
      poolKey,
      program,
      pool,
      null,
      token(pool.tokenXMint, pool.reserveX, "token_x_mint.bin"),
      token(pool.tokenYMint, pool.reserveY, "token_y_mint.bin"),
      [],
      {
        slot: new BN(1),
        epochStartTimestamp: new BN(0),
        epoch: new BN(0),
        leaderScheduleEpoch: new BN(0),
        unixTimestamp: new BN(Math.floor(Date.now() / 1000)),
      },
    );
    // Only account loading is replaced. Quotes run the actual SDK math.
    jest.spyOn(DLMM, "create").mockResolvedValue(client);
    jest.spyOn(client, "getBinArrayForSwap").mockResolvedValue(arrays);
    jest.spyOn(client, "getBinArrays").mockResolvedValue(arrays);
  });

  afterEach(() => jest.restoreAllMocks());

  function request(
    method: string,
    route: string,
    body?: unknown,
  ): Promise<{ status: number; body: any }> {
    const payload = body === undefined ? "" : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          method,
          path: route,
          headers: {
            pool: fixtureKey,
            rpc: "http://127.0.0.1:8899",
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

  async function fetchArrays(route: string) {
    const response =
      route === "/dlmm/get-bin-arrays"
        ? await request("GET", route)
        : await request("POST", route, { swapYtoX: true, count: 1 });
    expect(response.status).toBe(200);
    return response.body;
  }

  function quote(binArrays: unknown, swapForY = true) {
    return request("POST", "/dlmm/swap-quote", {
      swapYToX: swapForY,
      amount: 1000,
      allowedSlippage: 0,
      binArrays,
      isPartialFilled: false,
    });
  }

  it.each([
    ["/dlmm/get-bin-array-for-swap", true],
    ["/dlmm/get-bin-array-for-swap", false],
    ["/dlmm/get-bin-arrays", true],
    ["/dlmm/get-bin-arrays", false],
  ])(
    "round-trips %s into a %s quote with limit-order liquidity",
    async (route, swapForY) => {
      const bin = arrays[0].account.bins[69];
      bin.openOrderAmount = new BN("9007199254740993");
      bin.processedOrderRemainingAmount = new BN(300);
      bin.limitOrderAskSide = swapForY ? 0 : 1;
      const expected = client.swapQuote(
        new BN(1000),
        swapForY,
        new BN(0),
        arrays,
      );

      const wire = await fetchArrays(route);
      expect(new BN(wire[0].account.index, 16).toNumber()).toBe(-1);
      const wireBin = wire[0].account.bins[69];
      expect(new BN(wireBin.openOrderAmount, 16).eq(bin.openOrderAmount)).toBe(
        true,
      );
      expect(new BN(wireBin.processedOrderRemainingAmount, 16).toNumber()).toBe(
        300,
      );
      expect(wireBin.limitOrderAskSide).toBe(bin.limitOrderAskSide);
      expect(wireBin.rewardPerTokenStored).toHaveLength(2);
      const response = await quote(wire, swapForY);
      expect(response.status).toBe(200);
      expect(new BN(response.body.outAmount, 16).eq(expected.outAmount)).toBe(
        true,
      );
      expect(new BN(response.body.consumedInAmount, 16).toNumber()).toBe(1000);
    },
  );

  it.each([
    ["/dlmm/get-bin-array-for-swap", true],
    ["/dlmm/get-bin-array-for-swap", false],
    ["/dlmm/get-bin-arrays", true],
    ["/dlmm/get-bin-arrays", false],
  ])(
    "quotes processed-only order liquidity from %s in the %s direction",
    async (route, swapForY) => {
      const bin = arrays[0].account.bins[69];
      bin.processedOrderRemainingAmount = new BN(1500);
      bin.limitOrderAskSide = swapForY ? 0 : 1;
      const expected = client.swapQuote(
        new BN(1000),
        swapForY,
        new BN(0),
        arrays,
      );

      const wire = await fetchArrays(route);
      const response = await quote(wire, swapForY);
      expect(response.status).toBe(200);
      for (const field of [
        "consumedInAmount",
        "outAmount",
        "fee",
        "protocolFee",
        "minOutAmount",
      ] as const) {
        expect(new BN(response.body[field], 16).eq(expected[field])).toBe(true);
      }
      expect(new BN(response.body.outAmount, 16).toNumber()).toBe(1000);
    },
  );

  it.each([
    "openOrderAmount",
    "processedOrderRemainingAmount",
    "limitOrderAskSide",
  ])(
    "rejects missing %s on a limit-order pool instead of assuming zero",
    async (field) => {
      arrays[0].account.bins[69].openOrderAmount = new BN(5000);
      const wire = await fetchArrays("/dlmm/get-bin-array-for-swap");
      delete wire[0].account.bins[69][field];
      const calculate = jest.spyOn(client, "swapQuote");
      const response = await quote(wire);
      expect(response.status).toBe(400);
      expect(calculate).not.toHaveBeenCalled();
    },
  );

  it("accepts legacy bins without limit-order fields on liquidity-mining pools", async () => {
    client.lbPair.parameters.functionType = FunctionType.LiquidityMining;
    arrays[0].account.bins[69].amountY = new BN(5000);
    const wire = await fetchArrays("/dlmm/get-bin-arrays");
    for (const bin of wire[0].account.bins) {
      delete bin.openOrderAmount;
      delete bin.processedOrderRemainingAmount;
      delete bin.limitOrderAskSide;
    }
    const response = await quote(wire);
    expect(response.status).toBe(200);
    expect(new BN(response.body.outAmount, 16).toNumber()).toBe(1000);
  });

  it("does not invent liquidity for zero-balance bins", async () => {
    const wire = await fetchArrays("/dlmm/get-bin-array-for-swap");
    expect((await quote(wire)).status).toBe(400);
  });
});
