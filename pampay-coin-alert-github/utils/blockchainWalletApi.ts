/**
 * blockchainWalletApi.ts — v1.4.17
 *
 * Keyless read-only balance fetching for the «کیف پول بلاکچین» 4th tab.
 * EVERY source below was live-verified before implementation:
 *
 *  EVM (ETH / BSC / Polygon / Arbitrum / Base / Filecoin-FEVM):
 *    - Primary: Blockscout API v2 — GET {root}/api/v2/addresses/{addr}
 *      + /token-balances → native coin + ALL ERC-20 tokens with decimals and
 *      a USD `exchange_rate` per token (full discovery, no key). NOTE: a
 *      browser-like User-Agent header is REQUIRED — bare clients get a
 *      Cloudflare HTML challenge (verified live).
 *    - Fallback (PRIMARY for BSC — no public Blockscout exists there):
 *      public RPC eth_getBalance + Multicall3 aggregate3 over a LARGE token
 *      set (curated hardcoded list + runtime token lists: PancakeSwap top-100
 *      for BSC, Uniswap default list for ETH) — ONE RPC call per ~120 tokens.
 *  Tron: api.trongrid.io (no key) — /wallet/getaccount for TRX +
 *    /wallet/triggerconstantcontract balanceOf probes for curated TRC-20
 *    (contracts verified on-chain).
 *  Bitcoin: mempool.space/api/address (UTXO sum) + blockstream.info fallback.
 *  Solana: public RPC getBalance + getTokenAccountsByOwner(jsonParsed);
 *    SPL prices via Jupiter lite-api (keyless, includes 24h change).
 *  Filecoin: glif public RPC — eth_getBalance for 0x (FEVM) addresses and
 *    Filecoin.WalletBalance for native f1/f3/f4 addresses (both live-verified).
 *
 * v1.4.17 — prices: Binance spot ticker batch FIRST, then Binance USDT-M
 * FUTURES ticker batch (fapi) for coins that have no spot pair (POPCAT and
 * friends) — the «فقط یه ارز / قیمت نامشخص» gap. Stables = $1.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BlockchainNetwork,
  BlockchainTokenBalance,
  BlockchainWallet,
  BlockchainWalletData,
  CURATED_TRC20,
  NETWORKS,
  tronHexAddress,
  Trc20Token,
  writeBlockchainBalanceCache,
} from './blockchainWallets';

const UA =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

const TIMEOUT_MS = 20_000;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  return fetchJson<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** "0x…" hex → number via BigInt (exact for balances up to 2^53 units). */
function numFromBigIntHex(hex: string): number {
  if (!hex || hex === '0x') return 0;
  try {
    return Number(BigInt(hex));
  } catch {
    const n = parseInt(hex, 16);
    return Number.isFinite(n) ? n : 0;
  }
}

/**
 * "0x…" hex, integer decimal string or float string → number.
 * Integer decimal strings go through BigInt first — 18-decimal raw balances
 * (BSC USDT etc.) exceed 2^53 and parseFloat loses digits silently.
 */
function bigStrToNumber(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  const s = String(raw).trim();
  if (!s) return 0;
  if (s.startsWith('0x') || s.startsWith('0X')) return numFromBigIntHex(s);
  if (/^-?\d+$/.test(s)) {
    try {
      return Number(BigInt(s));
    } catch {
      return parseFloat(s) || 0;
    }
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Binance prices — SPOT first, FUTURES (fapi) fills futures-only coins
// ---------------------------------------------------------------------------

const BINANCE_HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
const FAPI_HOST = 'https://fapi.binance.com';

interface BinanceTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
}

const priceCache = new Map<string, { at: number; price: number; chg: number | null }>();
const PRICE_TTL = 60_000;

/** Futures (USDT-M perpetual) map — ~800 symbols, cached 5 minutes. */
let futuresMapCache: { at: number; map: Record<string, { price: number; chg: number | null }> } = {
  at: 0,
  map: {},
};

export async function fetchBinanceTickers(pairs: string[]): Promise<Record<string, { price: number; chg: number | null }>> {
  const out: Record<string, { price: number; chg: number | null }> = {};
  const now = Date.now();
  const missing = pairs.filter((p) => {
    const c = priceCache.get(p);
    if (c && now - c.at < PRICE_TTL) {
      out[p] = { price: c.price, chg: c.chg };
      return false;
    }
    return true;
  });
  if (missing.length === 0) return out;
  const symbolsParam = encodeURIComponent(JSON.stringify(missing));
  let lastErr: unknown = null;
  for (const host of BINANCE_HOSTS) {
    try {
      const data = await fetchJson<BinanceTicker[]>(
        `${host}/api/v3/ticker/24hr?symbols=${symbolsParam}`
      );
      for (const t of data) {
        const price = parseFloat(t.lastPrice);
        const chg = parseFloat(t.priceChangePercent);
        const entry = { at: now, price, chg: Number.isFinite(chg) ? chg : null };
        priceCache.set(t.symbol, entry);
        out[t.symbol] = { price, chg: entry.chg };
      }
      return out;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr && Object.keys(out).length === 0) throw lastErr;
  return out;
}

async function fetchBinanceFuturesMap(): Promise<Record<string, { price: number; chg: number | null }>> {
  if (Date.now() - futuresMapCache.at < 5 * 60_000) return futuresMapCache.map;
  let data: BinanceTicker[] | null = null;
  try {
    data = await fetchJson<BinanceTicker[]>(`${FAPI_HOST}/fapi/v1/ticker/24hr`);
  } catch {
    data = null;
  }
  if (!data || !Array.isArray(data)) {
    // 24hr is weight-limited (HTTP 418/429 on busy IPs) — the plain price
    // list is lighter and keyless (no 24h change in that case).
    const plain = await fetchJson<{ symbol: string; price: string }[]>(
      `${FAPI_HOST}/fapi/v1/ticker/price`
    );
    data = plain.map((p) => ({ symbol: p.symbol, lastPrice: p.price, priceChangePercent: '' }));
  }
  const map: Record<string, { price: number; chg: number | null }> = {};
  if (Array.isArray(data)) {
    for (const t of data) {
      const price = parseFloat(t.lastPrice);
      const chg = parseFloat(t.priceChangePercent);
      if (Number.isFinite(price) && price > 0) {
        map[t.symbol] = { price, chg: Number.isFinite(chg) && chg !== 0 ? chg : null };
      }
    }
  }
  futuresMapCache = { at: Date.now(), map };
  return map;
}

/**
 * Spot + futures merged price map for a set of pairs — coins that only trade
 * as perpetuals (POPCAT…) get their live price from fapi.
 */
export async function fetchBinanceSpotAndFutures(
  pairs: string[]
): Promise<Record<string, { price: number; chg: number | null }>> {
  let out: Record<string, { price: number; chg: number | null }> = {};
  try {
    out = await fetchBinanceTickers(pairs);
  } catch {
    out = {};
  }
  const missing = pairs.filter((p) => !out[p]);
  if (missing.length > 0) {
    try {
      const f = await fetchBinanceFuturesMap();
      for (const p of missing) {
        if (f[p]) out[p] = f[p];
      }
    } catch {}
  }
  return out;
}

const STABLE_SYMBOLS = ['USDT', 'USDC', 'DAI', 'USDD', 'USDC.E', 'TUSD', 'FDUSD', 'USDJ', 'STUSDT', 'PYUSD'];

/** Symbol → Binance pair guess (ETH → ETHUSDT). */
function binancePairFor(symbol: string): string | undefined {
  const s = symbol.toUpperCase();
  if (STABLE_SYMBOLS.includes(s)) {
    return undefined; // stables are $1
  }
  if (['POL', 'MATIC', 'WPOL', 'WMATIC'].includes(s)) return 'POLUSDT';
  if (s === 'WBTC' || s === 'BTCB') return 'BTCUSDT';
  if (['WETH', 'WBETH', 'RETH', 'STETH', 'WSTETH'].includes(s)) return 'ETHUSDT';
  return `${s}USDT`;
}

/**
 * Fill every token's price/value — spot → futures → stables = $1.
 * v1.4.17: the $1 stable assumption is capped at 10^12 units — spam tokens
 * NAME themselves "USDT" on explorers and burn-junk quantities would
 * otherwise show as $10^24 fake positions.
 */
async function fillPricesFromBinance(tokens: BlockchainTokenBalance[]): Promise<void> {
  const pairs = tokens
    .filter((t) => t.priceUsd <= 0 && t.binancePair)
    .map((t) => t.binancePair as string);
  const setStable = (t: BlockchainTokenBalance) => {
    if (STABLE_SYMBOLS.includes(t.symbol.toUpperCase()) && t.qty <= 1e12) {
      t.priceUsd = 1;
      t.change24hPct = 0;
      t.valueUsd = t.qty;
    }
  };
  if (pairs.length === 0) {
    tokens.forEach(setStable);
    return;
  }
  try {
    const map = await fetchBinanceSpotAndFutures([...new Set(pairs)]);
    for (const t of tokens) {
      if (t.priceUsd > 0) continue;
      const hit = t.binancePair ? map[t.binancePair] : undefined;
      if (hit) {
        t.priceUsd = hit.price;
        t.change24hPct = hit.chg;
        t.valueUsd = t.qty * hit.price;
      } else {
        setStable(t);
      }
    }
  } catch {
    tokens.forEach(setStable);
  }
}

// ---------------------------------------------------------------------------
// RPC helpers + Multicall3 (fallback path — PRIMARY for BSC)
// ---------------------------------------------------------------------------

async function rpcCall<T>(urls: string[], method: string, params: unknown[]): Promise<T> {
  let lastErr: unknown = null;
  for (const url of urls) {
    try {
      const d = await postJson<{ result?: T; error?: { message: string } }>(url, {
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      });
      if (d.error) throw new Error(d.error.message);
      return d.result as T;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('RPC ناموفق');
}

const BALANCE_OF_SELECTOR = '0x70a08231';

/**
 * v1.4.17 — the canonical multicall address hosts MULTICALL v1 on BSC /
 * Arbitrum / Base (on-chain-verified: aggregate3 selector absent, legacy
 * aggregate present), so we use the LEGACY `aggregate((address,bytes)[])`
 * which exists in Multicall v1/v2/v3 on every chain. Downside: it reverts
 * when ANY inner call fails → batches bisect on failure to isolate bad
 * tokens (see multicallBatch).
 */
const MULTICALL = '0xcA11bde05977b3631167028862bE2a173976CA11';
const AGG_SELECTOR = '0x252dba42';

interface McCall {
  target: string;
  callData: string;
}

/** ABI-encode aggregate((address,bytes)[]) — all callDatas are 36 bytes. */
function encodeAggregate(calls: McCall[]): string {
  const tails: string[] = [];
  for (const c of calls) {
    const h = c.callData.slice(2);
    const lenWord = (h.length / 2).toString(16).padStart(64, '0');
    const paddedLen = Math.ceil(h.length / 64) * 64;
    tails.push(lenWord + h.padEnd(paddedLen, '0'));
  }
  let out = AGG_SELECTOR;
  out += '20'.padStart(64, '0'); // offset to the array
  out += calls.length.toString(16).padStart(64, '0'); // array length
  // element offsets (bytes from the start of the array data, right after the
  // N offset words) — element i starts at N*32 + Σ previous element sizes.
  let acc = 0;
  for (let i = 0; i < calls.length; i++) {
    const elemBytes = 64 + tails[i].length / 2; // head 2 words + tail
    out += (calls.length * 32 + acc).toString(16).padStart(64, '0');
    acc += elemBytes;
  }
  // elements — head: [target][offset-to-bytes = 64], tail: [len][data]
  for (let i = 0; i < calls.length; i++) {
    out += calls[i].target.slice(2).toLowerCase().padStart(64, '0'); // target
    out += (64).toString(16).padStart(64, '0'); // offset to bytes (head = 2 words)
    out += tails[i];
  }
  return out;
}

/**
 * Decode aggregate's return (uint256 blockNumber, bytes[] returnData) into
 * the raw hex payloads (no 0x). Array length sits at word 2, element offsets
 * start at word 3 (each relative to the array data region).
 */
function decodeAggregateReturn(result: string): string[] {
  const h = result.startsWith('0x') ? result.slice(2) : result;
  if (h.length < 192) return [];
  const rd = (i: number) => h.slice(i * 64, (i + 1) * 64);
  const wv = (i: number) => {
    try {
      return Number(BigInt('0x' + rd(i)));
    } catch {
      return 0;
    }
  };
  const arrLen = wv(2);
  if (arrLen <= 0 || arrLen > 2000) return [];
  const out: string[] = [];
  for (let i = 0; i < arrLen; i++) {
    try {
      const offBytes = wv(3 + i);
      const elemWord = 3 + Math.floor(offBytes / 32);
      const lenBytes = wv(elemWord);
      out.push(h.slice((elemWord + 1) * 64, (elemWord + 1) * 64 + lenBytes * 2));
    } catch {
      out.push('');
    }
  }
  return out;
}

interface Erc20Meta {
  symbol: string;
  name: string;
  contract: string;
  decimals: number;
}

/** One multicall batch (~120 tokens) → balanceOf for every token at once. */
async function multicallBalances(
  network: BlockchainNetwork,
  address: string,
  tokens: Erc20Meta[]
): Promise<BlockchainTokenBalance[]> {
  const BATCH = 120;
  const out: BlockchainTokenBalance[] = [];
  for (let start = 0; start < tokens.length; start += BATCH) {
    const batch = tokens.slice(start, start + BATCH);
    out.push(...(await multicallBatch(network, address, batch)));
  }
  return out;
}

/** One aggregate() eth_call — bisects on revert (legacy aggregate reverts when any inner call fails). */
async function multicallBatch(
  network: BlockchainNetwork,
  address: string,
  batch: Erc20Meta[]
): Promise<BlockchainTokenBalance[]> {
  const ownerArg = address.slice(2).toLowerCase().padStart(64, '0');
  const calls: McCall[] = batch.map((t) => ({
    target: t.contract,
    callData: `${BALANCE_OF_SELECTOR}${ownerArg}`,
  }));
  try {
    const result = await rpcCall<string>(NETWORKS[network].rpcs, 'eth_call', [
      { to: MULTICALL, data: encodeAggregate(calls) },
      'latest',
    ]);
    const raw = decodeAggregateReturn(result);
    if (raw.length !== batch.length) return []; // corrupted decode — skip batch
    const out: BlockchainTokenBalance[] = [];
    raw.forEach((dataHex, i) => {
      if (!dataHex || dataHex.length < 64) return;
      const qty = Number(BigInt('0x' + dataHex.slice(0, 64))) / Math.pow(10, batch[i].decimals);
      if (!(qty > 0)) return;
      out.push({
        symbol: batch[i].symbol,
        name: batch[i].name,
        kind: 'token',
        qty,
        priceUsd: 0,
        change24hPct: null,
        valueUsd: 0,
        binancePair: binancePairFor(batch[i].symbol),
        network,
      });
    });
    return out;
  } catch {
    // aggregate reverts when ANY inner call fails — split the batch to
    // isolate the failing token (a few bad contracts never kill the rest).
    if (batch.length > 1) {
      const mid = Math.floor(batch.length / 2);
      const [a, b] = await Promise.all([
        multicallBatch(network, address, batch.slice(0, mid)),
        multicallBatch(network, address, batch.slice(mid)),
      ]);
      return [...a, ...b];
    }
    return []; // a single failing token — drop it
  }
}

// ---------------------------------------------------------------------------
// Runtime token lists (keyless, cached 7 days) + curated fallback sets
// ---------------------------------------------------------------------------

interface TokenListEntry {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}

/** Standard "token list" JSON sources — no API key, public CDNs. */
const TOKEN_LIST_SOURCES: Partial<Record<BlockchainNetwork, { url: string; chainId: number }>> = {
  bsc: { url: 'https://tokens.pancakeswap.finance/pancakeswap-top-100.json', chainId: 56 },
  ethereum: { url: 'https://tokens.uniswap.org', chainId: 1 },
};

const TOKEN_LIST_TTL = 7 * 24 * 3600 * 1000;
const tokenListMem = new Map<BlockchainNetwork, { at: number; tokens: Erc20Meta[] }>();

async function fetchTokenList(network: BlockchainNetwork): Promise<Erc20Meta[]> {
  const src = TOKEN_LIST_SOURCES[network];
  if (!src) return [];
  const mem = tokenListMem.get(network);
  if (mem && Date.now() - mem.at < TOKEN_LIST_TTL) return mem.tokens;
  const storeKey = `@bc_token_list_${network}`;
  try {
    const raw = await AsyncStorage.getItem(storeKey);
    if (raw) {
      const cached = JSON.parse(raw) as { at: number; tokens: Erc20Meta[] };
      if (cached?.tokens && Date.now() - cached.at < TOKEN_LIST_TTL) {
        tokenListMem.set(network, cached);
        return cached.tokens;
      }
    }
  } catch {}
  try {
    const data = await fetchJson<{ tokens?: TokenListEntry[] }>(src.url);
    const list = (data.tokens ?? [])
      .filter((t) => t.chainId === src.chainId && /^0x[0-9a-fA-F]{40}$/.test(t.address ?? ''))
      .map((t) => ({
        symbol: String(t.symbol ?? '').slice(0, 16).toUpperCase(),
        name: String(t.name ?? t.symbol ?? '').slice(0, 40),
        contract: t.address,
        decimals: Number.isFinite(t.decimals) && (t.decimals as number) >= 0 ? (t.decimals as number) : 18,
      }))
      .filter((t) => t.symbol.length > 0)
      .slice(0, 300);
    const payload = { at: Date.now(), tokens: list };
    tokenListMem.set(network, payload);
    try {
      await AsyncStorage.setItem(storeKey, JSON.stringify(payload));
    } catch {}
    return list;
  } catch {
    return [];
  }
}

/** Verified-on-chain fallback ERC-20 sets per EVM chain (famous ones only). */
const FALLBACK_EVM_TOKENS: Partial<Record<BlockchainNetwork, Erc20Meta[]>> = {
  ethereum: [
    { symbol: 'USDT', name: 'Tether USD', contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    { symbol: 'USDC', name: 'USD Coin', contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    { symbol: 'DAI', name: 'Dai Stablecoin', contract: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
    { symbol: 'LINK', name: 'Chainlink', contract: '0x514910771AF9Ca656af840dff83E8264EcF986CA', decimals: 18 },
    { symbol: 'SHIB', name: 'Shiba Inu', contract: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', decimals: 18 },
    { symbol: 'PEPE', name: 'Pepe', contract: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', decimals: 18 },
    { symbol: 'UNI', name: 'Uniswap', contract: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', decimals: 18 },
    { symbol: 'WBTC', name: 'Wrapped BTC', contract: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 },
    { symbol: 'WETH', name: 'Wrapped Ether', contract: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 },
    { symbol: 'STETH', name: 'Lido Staked ETH', contract: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', decimals: 18 },
    { symbol: 'LDO', name: 'Lido DAO', contract: '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32', decimals: 18 },
    { symbol: 'AAVE', name: 'Aave', contract: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', decimals: 18 },
    { symbol: 'MATIC', name: 'Polygon (ERC-20)', contract: '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0', decimals: 18 },
  ],
  bsc: [
    { symbol: 'USDT', name: 'Tether USD (BSC)', contract: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    { symbol: 'USDC', name: 'USD Coin (BSC)', contract: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
    { symbol: 'CAKE', name: 'PancakeSwap (BSC)', contract: '0x0E09FaBB73BD3aDE0a17ECC321fD13a19e81cE82', decimals: 18 },
    { symbol: 'ETH', name: 'Ethereum (Pegged)', contract: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', decimals: 18 },
    { symbol: 'BTCB', name: 'Bitcoin (Pegged)', contract: '0x7130d2A12B9BCBFAe4f2634d864A1Ee1Ce3Ead9c', decimals: 18 },
    { symbol: 'BUSD', name: 'Binance USD (BSC)', contract: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', decimals: 18 },
    { symbol: 'DAI', name: 'Dai Stablecoin (BSC)', contract: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', decimals: 18 },
    { symbol: 'WBNB', name: 'Wrapped BNB', contract: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', decimals: 18 },
    { symbol: 'LINK', name: 'Chainlink (BSC)', contract: '0xF8A0BF9cF54Bb92F17374d9e9A321E6a035E1cE1', decimals: 18 },
  ],
  polygon: [
    { symbol: 'USDC', name: 'USD Coin', contract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
    { symbol: 'USDC.E', name: 'USD Coin (bridged)', contract: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', decimals: 6 },
    { symbol: 'USDT', name: 'Tether USD (Polygon)', contract: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
    { symbol: 'WETH', name: 'Wrapped Ether (bridged)', contract: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', decimals: 18 },
    { symbol: 'WMATIC', name: 'Wrapped POL', contract: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', decimals: 18 },
  ],
  arbitrum: [
    { symbol: 'USDC', name: 'USD Coin', contract: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
    { symbol: 'USDT', name: 'Tether USD (Arbitrum)', contract: '0xFd086bC7CD5C481DCC9C85fEe2EdF96a049e4D0d', decimals: 6 },
    { symbol: 'WBTC', name: 'Wrapped BTC (Arbitrum)', contract: '0x2f2a2543B76A4166549F7aaB2e75Bfb0B16D3202', decimals: 8 },
    { symbol: 'ARB', name: 'Arbitrum', contract: '0x912CE59144191C1204E64559FE8253a0e49E6548', decimals: 18 },
    { symbol: 'WETH', name: 'Wrapped Ether (Arbitrum)', contract: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 },
  ],
  base: [
    { symbol: 'USDC', name: 'USD Coin', contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
    { symbol: 'WETH', name: 'Wrapped Ether (Base)', contract: '0x4200000000000000000000000000000000000006', decimals: 18 },
  ],
  filecoin: [],
};

/** Hardcoded set + runtime token list merged by contract address. */
async function resolveErc20Set(network: BlockchainNetwork): Promise<Erc20Meta[]> {
  const hardcoded = FALLBACK_EVM_TOKENS[network] ?? [];
  const runtime = await fetchTokenList(network).catch(() => [] as Erc20Meta[]);
  const byAddr = new Map<string, Erc20Meta>();
  for (const t of hardcoded) byAddr.set(t.contract.toLowerCase(), t);
  for (const t of runtime) byAddr.set(t.contract.toLowerCase(), t);
  return [...byAddr.values()].slice(0, 260);
}

// ---------------------------------------------------------------------------
// EVM balances — Blockscout primary (full discovery) + Multicall3 fallback
// ---------------------------------------------------------------------------

interface BsToken {
  token: {
    address_hash: string;
    symbol: string | null;
    name: string | null;
    decimals: string | null;
    exchange_rate: string | null;
    type: string | null;
  } | null;
  value: string | null;
}

interface BsAddress {
  coin_balance: string | null;
  exchange_rate: string | null;
}

async function fetchEvmBalances(
  network: BlockchainNetwork,
  address: string
): Promise<BlockchainTokenBalance[]> {
  const meta = NETWORKS[network];
  const tokens: BlockchainTokenBalance[] = [];
  let usedFallback = !meta.blockscout; // BSC has no public Blockscout

  // ── primary: Blockscout (full ERC-20 discovery + USD prices) ──
  let nativeQty = 0;
  let nativePrice = 0;
  if (meta.blockscout) {
    try {
      const addr = await fetchJson<BsAddress>(
        `${meta.blockscout}/api/v2/addresses/${address}`
      );
      nativeQty = bigStrToNumber(addr.coin_balance) / 1e18;
      nativePrice = parseFloat(addr.exchange_rate ?? '') || 0;
      const list = await fetchJson<BsToken[]>(
        `${meta.blockscout}/api/v2/addresses/${address}/token-balances`
      );
      for (const t of list) {
        if (!t.token || t.token.type !== 'ERC-20' || !t.value) continue;
        const qty = bigStrToNumber(t.value) / Math.pow(10, bigStrToNumber(t.token.decimals));
        if (!(qty > 0)) continue;
        const rawPrice = parseFloat(t.token.exchange_rate ?? '') || 0;
        // v1.4.17 — scam tokens report FAKE exchange_rates on explorers →
        // absurd "$10^24" rows. No real single-position plausibly exceeds
        // $50B — treat bigger products as unpriced (qty still shows).
        const price = qty * rawPrice <= 50e9 ? rawPrice : 0;
        const symbol = (t.token.symbol ?? '?').toUpperCase();
        tokens.push({
          symbol,
          name: t.token.name ?? symbol,
          kind: 'token',
          qty,
          priceUsd: price,
          change24hPct: null,
          valueUsd: qty * price,
          binancePair: binancePairFor(symbol),
          network,
        });
      }
    } catch {
      usedFallback = true;
    }
  }

  // ── fallback: public RPC native + Multicall3 over a large token set ──
  if (usedFallback) {
    const rawBalance = await rpcCall<string>(meta.rpcs, 'eth_getBalance', [address, 'latest']);
    nativeQty = numFromBigIntHex(rawBalance) / 1e18;
    nativePrice = 0;
    const set = await resolveErc20Set(network);
    tokens.push(...(await multicallBalances(network, address, set)));
  }

  if (nativeQty > 0) {
    tokens.unshift({
      symbol: meta.native,
      name: `${meta.label} — ${meta.native}`,
      kind: 'native',
      qty: nativeQty,
      priceUsd: nativePrice,
      change24hPct: null,
      valueUsd: nativeQty * nativePrice,
      binancePair: binancePairFor(meta.native),
      network,
    });
  }

  // Fill missing prices via Binance spot + futures (RPC fallback + zero-price rows)
  await fillPricesFromBinance(tokens);
  return tokens;
}

// ---------------------------------------------------------------------------
// Filecoin — 0x (FEVM) via eth_getBalance, f1/f3/f4 via Filecoin.WalletBalance
// ---------------------------------------------------------------------------

async function fetchFilecoinBalances(address: string): Promise<BlockchainTokenBalance[]> {
  const meta = NETWORKS.filecoin;
  const a = address.trim();
  let qty = 0;
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) {
    // FEVM address — same 0x form as other EVM chains (glif live-verified).
    const raw = await rpcCall<string>(meta.rpcs, 'eth_getBalance', [a, 'latest']);
    qty = numFromBigIntHex(raw) / 1e18;
  } else {
    // Native f1/f3/f4 — result is attoFIL as a decimal string.
    const r = await rpcCall<string | number>(meta.rpcs, 'Filecoin.WalletBalance', [a]);
    qty = bigStrToNumber(r) / 1e18;
  }
  const tokens: BlockchainTokenBalance[] = [];
  if (qty > 0) {
    tokens.push({
      symbol: 'FIL',
      name: 'فایل‌کوین',
      kind: 'native',
      qty,
      priceUsd: 0,
      change24hPct: null,
      valueUsd: 0,
      binancePair: 'FILUSDT',
      network: 'filecoin',
    });
  }
  await fillPricesFromBinance(tokens);
  return tokens;
}

// ---------------------------------------------------------------------------
// Tron — TRX + curated TRC-20 probes
// ---------------------------------------------------------------------------

async function trc20Balance(ownerHex: string, token: Trc20Token): Promise<number> {
  const contractHex = tronHexAddress(token.contract);
  if (!contractHex) return 0;
  const d = await postJson<{ constant_result?: string[] }>(
    'https://api.trongrid.io/wallet/triggerconstantcontract',
    {
      owner_address: ownerHex,
      contract_address: contractHex,
      function_selector: 'balanceOf(address)',
      parameter: '0'.repeat(24) + ownerHex.slice(2),
      visible: false,
    }
  );
  const raw = d.constant_result?.[0];
  if (!raw) return 0;
  try {
    return Number(BigInt('0x' + raw)) / Math.pow(10, token.decimals);
  } catch {
    return 0;
  }
}

async function fetchTronBalances(address: string): Promise<BlockchainTokenBalance[]> {
  const ownerHex = tronHexAddress(address);
  if (!ownerHex) throw new Error('آدرس ترون نامعتبر است');
  const acct = await postJson<{ balance?: number }>(
    'https://api.trongrid.io/wallet/getaccount',
    { address: ownerHex, visible: false }
  );
  const tokens: BlockchainTokenBalance[] = [];
  const trxQty = (acct.balance ?? 0) / 1e6;
  if (trxQty > 0) {
    tokens.push({
      symbol: 'TRX',
      name: 'ترون',
      kind: 'native',
      qty: trxQty,
      priceUsd: 0,
      change24hPct: null,
      valueUsd: 0,
      binancePair: 'TRXUSDT',
      network: 'tron',
    });
  }
  const probes = await Promise.allSettled(CURATED_TRC20.map((t) => trc20Balance(ownerHex, t)));
  probes.forEach((r, i) => {
    if (r.status !== 'fulfilled' || !(r.value > 0)) return;
    const t = CURATED_TRC20[i];
    tokens.push({
      symbol: t.symbol,
      name: t.name,
      kind: 'token',
      qty: r.value,
      priceUsd: t.stable ? 1 : 0,
      change24hPct: t.stable ? 0 : null,
      valueUsd: t.stable ? r.value : 0,
      binancePair: binancePairFor(t.symbol),
      network: 'tron',
    });
  });
  await fillPricesFromBinance(tokens);
  return tokens;
}

// ---------------------------------------------------------------------------
// Bitcoin — UTXO sum
// ---------------------------------------------------------------------------

async function fetchBitcoinBalances(address: string): Promise<BlockchainTokenBalance[]> {
  const hosts = ['https://mempool.space/api', 'https://blockstream.info/api'];
  let lastErr: unknown = null;
  for (const host of hosts) {
    try {
      const d = await fetchJson<{
        chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
        mempool_stats: { funded_txo_sum: number; spent_txo_sum: number };
      }>(`${host}/address/${address}`);
      const sats =
        d.chain_stats.funded_txo_sum -
        d.chain_stats.spent_txo_sum +
        d.mempool_stats.funded_txo_sum -
        d.mempool_stats.spent_txo_sum;
      const qty = sats / 1e8;
      if (qty <= 0) return [];
      const tokens: BlockchainTokenBalance[] = [
        {
          symbol: 'BTC',
          name: 'بیت‌کوین',
          kind: 'native',
          qty,
          priceUsd: 0,
          change24hPct: null,
          valueUsd: 0,
          binancePair: 'BTCUSDT',
          network: 'bitcoin',
        },
      ];
      await fillPricesFromBinance(tokens);
      return tokens;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('دریافت موجودی بیت‌کوین ناموفق بود');
}

// ---------------------------------------------------------------------------
// Solana — SOL + SPL token accounts + Jupiter prices
// ---------------------------------------------------------------------------

async function fetchSolanaBalances(address: string): Promise<BlockchainTokenBalance[]> {
  const tokens: BlockchainTokenBalance[] = [];
  const rpcs = NETWORKS.solana.rpcs;
  const call = <T>(method: string, params: unknown[]): Promise<T> =>
    (async () => {
      let lastErr: unknown = null;
      for (const url of rpcs) {
        try {
          const d = await postJson<{ result?: T; error?: { message: string } }>(url, {
            jsonrpc: '2.0',
            id: 1,
            method,
            params,
          });
          if (d.error) throw new Error(d.error.message);
          return d.result as T;
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr ?? new Error('RPC سولانا ناموفق');
    })();

  const lamports = await call<number>('getBalance', [address]);
  const solQty = (lamports ?? 0) / 1e9;
  if (solQty > 0) {
    tokens.push({
      symbol: 'SOL',
      name: 'سولانا',
      kind: 'native',
      qty: solQty,
      priceUsd: 0,
      change24hPct: null,
      valueUsd: 0,
      binancePair: 'SOLUSDT',
      network: 'solana',
    });
  }

  // SPL token accounts (full discovery)
  try {
    const accounts = await call<{
      value: {
        account: { data: { parsed: { info: { mint: string; tokenAmount: { uiAmount: number | null } } } } };
      }[];
    }>('getTokenAccountsByOwner', [
      address,
      { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
      { encoding: 'jsonParsed' },
    ]);
    const spl = accounts?.value ?? [];
    const withBalance = spl
      .map((a) => ({
        mint: a.account.data.parsed.info.mint,
        qty: a.account.data.parsed.info.tokenAmount.uiAmount ?? 0,
      }))
      .filter((x) => x.qty > 0);
    if (withBalance.length > 0) {
      // Jupiter price v3 by mint (keyless, includes 24h change)
      try {
        const jup = await fetchJson<Record<string, { usdPrice?: number; priceChange24h?: number }>>(
          `https://lite-api.jup.ag/price/v3?ids=${withBalance.map((x) => x.mint).join(',')}`
        );
        for (const x of withBalance) {
          const price = jup[x.mint]?.usdPrice ?? 0;
          tokens.push({
            symbol: mintSymbol(x.mint),
            name: mintSymbol(x.mint),
            kind: 'token',
            qty: x.qty,
            priceUsd: price,
            change24hPct: jup[x.mint]?.priceChange24h ?? null,
            valueUsd: x.qty * price,
            network: 'solana',
          });
        }
      } catch {
        for (const x of withBalance) {
          tokens.push({
            symbol: mintSymbol(x.mint),
            name: mintSymbol(x.mint),
            kind: 'token',
            qty: x.qty,
            priceUsd: 0,
            change24hPct: null,
            valueUsd: 0,
            network: 'solana',
          });
        }
      }
    }
  } catch {
    // token accounts are optional — SOL alone is still a valid result
  }

  await fillPricesFromBinance(tokens);
  return tokens;
}

/** Well-known Solana mints → symbol (Jupiter prices are keyed by mint). */
const KNOWN_MINTS: Record<string, string> = {
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
  'Es9vMFrzaCERMLJz2bZhufEhZLXBAPhbhcTXt4y2zKdd': 'USDT',
  'So11111111111111111111111111111111111111112': 'WSOL',
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': 'JUP',
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 'BONK',
  '85VBFQZC9TZKEktBGjDZM1thZccqPzftMZQPx6UkyUat': 'WIF',
  'J1tigo1qU4of4uLQaGE8y3vjgapYgBLptDLtDypqulN': 'JTO',
  'EwjBaeR7WMw7GhERv9Bh1n6tY3sWw6MDrBS3JcZKrfU': 'PYTH',
};

function mintSymbol(mint: string): string {
  const s = KNOWN_MINTS[mint];
  if (s) return s;
  if (mint === 'So11111111111111111111111111111111111111112') return 'WSOL';
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Public entry — fetch ONE wallet across ALL of its selected networks
// ---------------------------------------------------------------------------

const NETWORK_FETCHERS: Record<BlockchainNetwork, (a: string) => Promise<BlockchainTokenBalance[]>> = {
  ethereum: (a) => fetchEvmBalances('ethereum', a),
  bsc: (a) => fetchEvmBalances('bsc', a),
  polygon: (a) => fetchEvmBalances('polygon', a),
  arbitrum: (a) => fetchEvmBalances('arbitrum', a),
  base: (a) => fetchEvmBalances('base', a),
  filecoin: fetchFilecoinBalances,
  tron: fetchTronBalances,
  bitcoin: fetchBitcoinBalances,
  solana: fetchSolanaBalances,
};

export async function fetchBlockchainWalletData(wallet: BlockchainWallet): Promise<BlockchainWalletData> {
  const address = wallet.address.trim();
  // v1.4.17 — read the SAME address on EVERY selected network in parallel.
  const results = await Promise.allSettled(
    wallet.networks.map((n) => NETWORK_FETCHERS[n](address))
  );
  const tokens: BlockchainTokenBalance[] = [];
  const failedLabels: string[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      for (const t of r.value) {
        tokens.push({ ...t, network: t.network ?? wallet.networks[i] });
      }
    } else {
      failedLabels.push(NETWORKS[wallet.networks[i]].label);
    }
  });
  // drop dust rows worth < $0.01 (Blockscout returns hundreds of spam tokens)
  const visible = tokens
    .filter((t) => t.qty > 0)
    .filter((t) => (t.priceUsd > 0 ? t.valueUsd >= 0.01 : true))
    .sort((a, b) => b.valueUsd - a.valueUsd)
    .slice(0, 120);
  const totalUsd = visible.reduce((s, t) => s + (Number.isFinite(t.valueUsd) ? t.valueUsd : 0), 0);
  const data: BlockchainWalletData = {
    walletId: wallet.id,
    tokens: visible,
    totalUsd,
    fetchedAt: Date.now(),
  };
  if (failedLabels.length > 0) {
    data.notice = `خواندن شبکه‌های ${failedLabels.join('، ')} موفق نشد — با «تازه‌سازی» دوباره تلاش می‌شود`;
  }
  await writeBlockchainBalanceCache(data);
  return data;
}

// ---------------------------------------------------------------------------
// PnL — current holdings × historical prices (۷/۳۰/۹۰/۱۸۰ روز)
// ---------------------------------------------------------------------------

export const PNL_PERIODS = [7, 30, 90, 180] as const;
export type PnlPeriod = (typeof PNL_PERIODS)[number];

export interface BlockchainTokenPnl {
  label: string;
  /** qty × (priceNow − priceThen) — USD. */
  pnl: number;
  /** qty × priceThen — USD basis. */
  basis: number;
}

export interface BlockchainPnlPeriod {
  /** Σ qty × priceNow — USD (today's holdings at today's prices). */
  usdNow: number;
  /** Σ qty × priceThen — USD (today's holdings at the period-start price). */
  usdThen: number;
  tokens: BlockchainTokenPnl[];
}

export interface BlockchainPnlSummary {
  byPeriod: Record<number, BlockchainPnlPeriod>;
  fetchedAt: number;
}

const klineCache = new Map<string, { at: number; closes: { t: number; c: number }[] }>();
const KLINE_TTL = 10 * 60_000;

/**
 * Daily closes for a Binance pair covering the last ~185 days (1 call).
 * Spot klines first; futures-only coins (POPCAT…) fall back to fapi klines.
 */
async function fetchDailyCloses(pair: string): Promise<{ t: number; c: number }[]> {
  const cached = klineCache.get(pair);
  if (cached && Date.now() - cached.at < KLINE_TTL) return cached.closes;
  const start = Date.now() - 186 * 86_400_000;
  const parse = (k: unknown[][]) =>
    k.map((c) => ({ t: Number(c[0]), c: parseFloat(String(c[4])) }));
  let lastErr: unknown = null;
  for (const host of BINANCE_HOSTS) {
    try {
      const k = await fetchJson<unknown[][]>(
        `${host}/api/v3/klines?symbol=${pair}&interval=1d&startTime=${start}&limit=1000`
      );
      const closes = parse(k);
      klineCache.set(pair, { at: Date.now(), closes });
      return closes;
    } catch (e) {
      lastErr = e;
    }
  }
  // futures klines (coin has no spot pair)
  try {
    const k = await fetchJson<unknown[][]>(
      `${FAPI_HOST}/fapi/v1/klines?symbol=${pair}&interval=1d&startTime=${start}&limit=1000`
    );
    const closes = parse(k);
    klineCache.set(pair, { at: Date.now(), closes });
    return closes;
  } catch (e) {
    throw lastErr ?? e;
  }
}

function closeAtOrBefore(series: { t: number; c: number }[], target: number): number | null {
  if (series.length === 0) return null;
  if (target <= series[0].t) return series[0].c;
  let lo = 0;
  let hi = series.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (series[mid].t <= target) lo = mid;
    else hi = mid - 1;
  }
  return series[lo].c;
}

/**
 * Computes the market-change PnL of the CURRENT blockchain holdings over all
 * four periods at once (same semantics as the rial/metals PnL card: change of
 * market value of what you hold today, not your actual trade PnL).
 */
export async function computeBlockchainPnl(
  wallets: BlockchainWallet[],
  balanceByWallet: Record<string, BlockchainWalletData | undefined>
): Promise<BlockchainPnlSummary> {
  // aggregate token quantities across wallets AND networks keyed by price source
  const agg = new Map<string, { symbol: string; qty: number; pair?: string; stable: boolean }>();
  for (const w of wallets) {
    const data = balanceByWallet[w.id];
    if (!data) continue;
    for (const t of data.tokens) {
      if (!(t.qty > 0)) continue;
      const key = t.binancePair ?? t.symbol;
      const cur = agg.get(key) ?? {
        symbol: t.symbol,
        qty: 0,
        pair: t.binancePair,
        // stable assumption capped (fake "USDT" junk never counts as $1)
        stable: STABLE_SYMBOLS.includes(t.symbol.toUpperCase()) && t.qty <= 1e12,
      };
      cur.qty += t.qty;
      agg.set(key, cur);
    }
  }

  const entries = [...agg.values()].filter((e) => e.qty > 0);
  const byPeriod: Record<number, BlockchainPnlPeriod> = {};
  for (const p of PNL_PERIODS) byPeriod[p] = { usdNow: 0, usdThen: 0, tokens: [] };
  if (entries.length === 0) {
    return { byPeriod, fetchedAt: Date.now() };
  }

  // live prices (for "now" legs — spot + futures) + history (for "then" legs)
  const pairs = entries.filter((e) => e.pair).map((e) => e.pair as string);
  let live: Record<string, { price: number; chg: number | null }> = {};
  if (pairs.length > 0) {
    try {
      live = await fetchBinanceSpotAndFutures([...new Set(pairs)]);
    } catch {}
  }

  const seriesMap = new Map<string, { t: number; c: number }[]>();
  await Promise.allSettled(
    [...new Set(pairs)].map(async (pair) => {
      seriesMap.set(pair, await fetchDailyCloses(pair));
    })
  );

  for (const e of entries) {
    const nowPrice = e.stable ? 1 : e.pair && live[e.pair] ? live[e.pair].price : 0;
    const series = e.pair ? seriesMap.get(e.pair) : undefined;
    for (const p of PNL_PERIODS) {
      const target = Date.now() - p * 86_400_000;
      let thenPrice: number | null = null;
      if (e.stable) thenPrice = 1;
      else if (series) thenPrice = closeAtOrBefore(series, target);
      if (nowPrice <= 0 || thenPrice === null || thenPrice <= 0) continue;
      const per = byPeriod[p];
      const pnl = e.qty * (nowPrice - thenPrice);
      const basis = e.qty * thenPrice;
      per.usdNow += e.qty * nowPrice;
      per.usdThen += basis;
      const existing = per.tokens.find((x) => x.label === e.symbol);
      if (existing) {
        existing.pnl += pnl;
        existing.basis += basis;
      } else {
        per.tokens.push({ label: e.symbol, pnl, basis });
      }
    }
  }

  for (const p of PNL_PERIODS) {
    byPeriod[p].tokens.sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
  }
  return { byPeriod, fetchedAt: Date.now() };
}
