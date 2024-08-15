import { Connection, PublicKey } from '@solana/web3.js';
import express from 'express';
import { DLMM } from '../dlmm';
import { StrategyType } from '../dlmm/types';
import { BN } from 'bn.js';

const RPC = "https://api.devnet.solana.com";
const connection = new Connection(RPC, 'finalized');

const app = express();
app.use(express.urlencoded());
app.use(express.json());
app.use(function(req, res, next) {
  console.log(req.method, req.url);
  console.log(req.body);
  next();
})

app.get('/', (req, res) => {
  res.send('Hello World!');
});

function safeStringify(obj: Record<string, any>): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return;
      }
      seen.add(value);
    }
    return value;
  });
}

app.post('/dlmm/create', async (req, res) => {
  try {
    const publicKey = "3W2HKgUa96Z69zzG3LK1g8KdcRAWzAttiLiHfYnKuPw5";
    const poolAddress = new PublicKey(publicKey);
    const dlmm = await DLMM.create(connection, poolAddress);
    return res.status(200).send(safeStringify(dlmm));
  }
  catch (error) {
    return res.status(400)
  }
})

app.post('/dlmm/create-multiple', async (req, res) => {
  try {
    const poolAddresses = req.body.publicKeys.map((publicKey: string) => new PublicKey(publicKey))
    const dlmm = await DLMM.createMultiple(connection, poolAddresses);
    return res.status(200).send(safeStringify(dlmm));
  }
  catch (error) {
    return res.status(400).send(error)
  }
})

app.post("/dlmm/get-active-bin", async (req, res) => {
  try {
    const publicKey = req.body.publicKey;
    const poolAddress = new PublicKey(publicKey);
    const dlmm = await DLMM.create(connection, poolAddress);
    const activeBin = await dlmm.getActiveBin();
    return res.status(200).send(safeStringify(activeBin));
  }
  catch (error) {
    console.log(error)
    return res.status(400).send(error)
  }
})

app.post("/dlmm/from-price-per-lamport", async (req, res) => {
  try {
    const publicKey = req.body.publicKey;
    const pricePerLamport = req.body.price;
    const poolAddress = new PublicKey(publicKey);
    const dlmm = await DLMM.create(connection, poolAddress);
    const from = dlmm.fromPricePerLamport(pricePerLamport);
    return res.status(200).send({ price: from });
  }
  catch (error) {
    console.log(error)
    return res.status(400).send(error)
  }
})

app.post("/dlmm/initialize-position-and-add-liquidity-by-strategy", async (req, res) => {
  try {
    const publicKey = req.body.publicKey;

    const positionPublicKey = req.body.positionPubKey;
    const userPublicKey = req.body.userPublicKey;
    const totalXAmount = new BN(req.body.totalXAmount);
    const totalYAmount = new BN(req.body.totalYAmount);
    const maxBinId = req.body.maxBinId;
    const minBinId = req.body.minBinId;
    const strategyType = req.body.strategyType as StrategyType;
    const data = {
      positionPubKey: new PublicKey(positionPublicKey),
      user: new PublicKey(userPublicKey),
      totalXAmount,
      totalYAmount,
      strategy: {
        maxBinId,
        minBinId,
        strategyType
      }
    }
    const poolAddress = new PublicKey(publicKey);
    const dlmm = await DLMM.create(connection, poolAddress);
    const position = await dlmm.initializePositionAndAddLiquidityByStrategy(data);
    return res.status(200).send(safeStringify(position));
  }
  catch (error) {
    console.log(error)
    return res.status(400).send(error)
  }
})

app.post("/dlmm/add-liquidity-by-strategy", async (req, res) => {
  try {
    const publicKey = req.body.publicKey;
    const positionPublicKey = req.body.positionPubKey;
    const userPublicKey = req.body.userPublicKey;
    const totalXAmount = new BN(req.body.totalXAmount);
    const totalYAmount = new BN(req.body.totalYAmount);
    const maxBinId = req.body.maxBinId;
    const minBinId = req.body.minBinId;
    const strategyType = req.body.strategyType as StrategyType;
    const data = {
      positionPubKey: new PublicKey(positionPublicKey),
      user: new PublicKey(userPublicKey),
      totalXAmount,
      totalYAmount,
      strategy: {
        maxBinId,
        minBinId,
        strategyType
      }
    }
    const poolAddress = new PublicKey(publicKey);
    const dlmm = await DLMM.create(connection, poolAddress);
    const position = await dlmm.addLiquidityByStrategy(data);
    return res.status(200).send(safeStringify(position));
  }
  catch (error) {
    console.log(error)
    return res.status(400).send(error)
  }
})

app.post("/dlmm/get-positions-by-user-and-lb-pair", async (req, res) => {
  try {
    const publicKey = req.body.publicKey;
    const userPublicKey = req.body.userPublicKey;
    const poolAddress = new PublicKey(publicKey);
    const dlmm = await DLMM.create(connection, poolAddress);
    const positions = await dlmm.getPositionsByUserAndLbPair(new PublicKey(userPublicKey));
    return res.status(200).send(safeStringify(positions));
  }
  catch (error) {
    console.log(error)
    return res.status(400).send(error)
  }
})

app.post("/dlmm/remove-liquidity", async (req, res) => {
  try {
    const publicKey = req.body.publicKey;
    const positionPublicKey = req.body.positionPublicKey;
    const userPublicKey = req.body.userPublicKey;
    const binIds = req.body.binIds;
    const bps = req.body.bps;
    const shouldClaimAndClose = req.body.shouldClaimAndClose;

    const poolAddress = new PublicKey(publicKey);
    const dlmm = await DLMM.create(connection, poolAddress);
    const removeTxs = await dlmm.removeLiquidity({
      position: new PublicKey(positionPublicKey),
      user: new PublicKey(userPublicKey),
      binIds,
      bps,
      shouldClaimAndClose
    });
    return res.status(200).send(safeStringify(removeTxs));
  }
  catch (error) {
    console.log(error)
    return res.status(400).send(error)
  }
})

app.post("/dlmm/get-bin-array-for-swap", async (req, res) => {
  try {
    const publicKey = req.body.publicKey;
    const swapYtoX = req.body.swapYtoX;
    const count = req.body.count;
    const poolAddress = new PublicKey(publicKey);
    const dlmm = await DLMM.create(connection, poolAddress);
    const binArray = await dlmm.getBinArrayForSwap(swapYtoX, count);
    return res.status(200).send(safeStringify(binArray));
  }
  catch (error) {
    console.log(error)
    return res.status(400).send(error)
  }
})

app.post("/dlmm/swap-quote", async (req, res) => {
  try {
    const publicKey = req.body.publicKey;
    const swapYtoX = req.body.swapYtoX;
    const swapAmount = req.body.amount;
    const allowedSlippage = req.body.allowedSlippage;
    const binArrays = req.body.binArrays;
    const isPartialFill = req.body.isPartialFill;

    const poolAddress = new PublicKey(publicKey);
    const dlmm = await DLMM.create(connection, poolAddress);
    const quote = dlmm.swapQuote(swapYtoX, swapAmount, allowedSlippage, binArrays, isPartialFill);
    return res.status(200).send(safeStringify(quote));
  }
  catch (error) {
    console.log(error)
    return res.status(400).send(error)
  }
})

app.post("/dlmm/swap", async (req, res) => {
  try {
    const publicKey = req.body.publicKey;
    const inToken = new PublicKey(req.body.inToken);
    const outToken = new PublicKey(req.body.outToken);
    const inAmount = req.body.inAmount;
    const minOutAmount = req.body.minOutAmount;
    const lbPair = new PublicKey(req.body.lbPair);
    const user = new PublicKey(req.body.userPublicKey);
    const binArraysPubkey = req.body.binArrays;

    const poolAddress = new PublicKey(publicKey);
    const dlmm = await DLMM.create(connection, poolAddress);
    const swap = await dlmm.swap({
      inToken, 
      outToken, 
      inAmount, 
      minOutAmount, 
      lbPair, 
      user,
      binArraysPubkey
    });
    return res.status(200).send(safeStringify(swap));
  }
  catch (error) {
    console.log(error)
    return res.status(400).send(error)
  }
})

app.listen(3000, () => {
  console.log('Server is running on http://localhost:3000');
});