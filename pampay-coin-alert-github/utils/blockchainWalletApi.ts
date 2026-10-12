/**
 * blockchainWalletApi.ts — v1.4.16
 *
 * Keyless read-only balance fetching for the «کیف پول بلاکچین» 4th tab.
 * EVERY source below was live-verified before implementation:
 *
 *  EVM (ETH / BSC / Polygon / Arbitrum / Base):
 *    - Primary: Blockscout API v2 — GET {root}/api/v2/addresses/{addr}
 *      + /token-balances → native coin + ALL ERC-20 tokens with decimals and
 *      a USD `exchange_rate` per token (full discovery, no key). NOTE: a
 *      browser-like User-Agent header is REQUIRED — bare clients get a
 *      Cloudflare HTML challenge (verified live).
 *    - Fallback: public RPC eth_getBalance + eth_call balanceOf over a small
 *      verified token set, prices then resolved via Binance/CoinGecko.
 *  Tron: api.trongrid.io (no key) — /wallet/getaccount for TRX +
 *    /wallet/triggerconstantcontract balanceOf probes for curated TRC-20
 *    (USDT/USDC — contracts verified on-chain).
 *  Bitcoin: mempool.space/api/address (UTXO sum) + blockstream.info fallback.
 *  Solana: public RPC getBalance + getTokenAccountsByOwner(jsonParsed);
 *    SPL prices via Jupiter lite-api (keyless, includes 24h change).
 *
 * Prices for native coins + RPC-fallback tokens: Binance public market-data
 * host data-api.binance.vision (ticker/24hr — batch, includes 24h change),
 * CoinGecko simple price as fallback.
 */

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

function hexToNumber(hex: string): number {
  if (!hex || hex === '0x') return 0;
  const n = parseInt(hex, 16);
  return Number.isFinite(n) ? n : 0;
}

/** "0x…" hex or decimal string → number (lossy ok for balances we display). */
function bigStrToNumber(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  const s = String(raw);
  if (s.startsWith('0x') || s.startsWith('0X')) return hexToNumber(s);
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Binance prices (batch) — includes 24h change
// ---------------------------------------------------------------------------

const BINANCE_HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];

interface BinanceTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
}

const priceCache = new Map<string, { at: number; price: number; chg: number | null }>();
const PRICE_TTL = 60_000;

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

/** Symbol → Binance pair guess (ETH → ETHUSDT). */
function binancePairFor(symbol: string): string | undefined {
  const s = symbol.toUpperCase();
  if (['USDT', 'USDC', 'DAI', 'TUSD', 'FDUSD', 'BUSD', 'USDD', 'PYUSD'].includes(s)) {
    return undefined; // stables are $1
  }
  if (['POL', 'MATIC'].includes(s)) return 'POLUSDT';
  if (s === 'WBTC') return 'BTCUSDT';
  if (s === 'WETH' || s === 'WBETH' || s === 'RETH' || s === 'STETH') return 'ETHUSDT';
  return `${s}USDT`;
}

// ---------------------------------------------------------------------------
// EVM balances — Blockscout primary + RPC fallback
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

/** RPC helpers (fallback path). */
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

/** Verified-on-chain fallback ERC-20 sets per EVM chain (only famous ones). */
const FALLBACK_EVM_TOKENS: Partial<Record<BlockchainNetwork, { symbol: string; name: string; contract: string; decimals: number }[]>> = {
  ethereum: [
    { symbol: 'USDT', name: 'Tether USD', contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    { symbol: 'USDC', name: 'USD Coin', contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    { symbol: 'DAI', name: 'Dai Stablecoin', contract: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
    { symbol: 'LINK', name: 'Chainlink', contract: '0x514910771AF9Ca656af840dff83E8264EcF986CA', decimals: 18 },
    { symbol: 'SHIB', name: 'Shiba Inu', contract: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', decimals: 18 },
    { symbol: 'PEPE', name: 'Pepe', contract: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', decimals: 18 },
    { symbol: 'UNI', name: 'Uniswap', contract: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', decimals: 18 },
    { symbol: 'WBTC', name: 'Wrapped BTC', contract: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 },
  ],
  bsc: [
    { symbol: 'USDT', name: 'Tether USD (BSC)', contract: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    { symbol: 'USDC', name: 'USD Coin (BSC)', contract: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
    { symbol: 'CAKE', name: 'PancakeSwap (BSC)', contract: '0x0E09FaBB73BD3aDE0a17ECC321fD13a19e81cE82', decimals: 18 },
    { symbol: 'ETH', name: 'Ethereum (Pegged)', contract: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', decimals: 18 },
    { symbol: 'BTCB', name: 'Bitcoin (Pegged)', contract: '0x7130d2A12B9BCBFAe4f2634d864A1Ee1Ce3Ead9c', decimals: 18 },
  ],
  polygon: [
    { symbol: 'USDC', name: 'USD Coin', contract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
    { symbol: 'USDC.e', name: 'USD Coin (bridged)', contract: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', decimals: 6 },
    { symbol: 'USDT', name: 'Tether USD (Polygon)', contract: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
  ],
  arbitrum: [
    { symbol: 'USDC', name: 'USD Coin', contract: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
    { symbol: 'USDT', name: 'Tether USD (Arbitrum)', contract: '0xFd086bC7CD5C481DCC9C85fEe2EdF96a049e4D0d', decimals: 6 },
  ],
  base: [
    { symbol: 'USDC', name: 'USD Coin', contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
  ],
};

async function fetchEvmBalances(
  network: BlockchainNetwork,
  address: string
): Promise<BlockchainTokenBalance[]> {
  const meta = NETWORKS[network];
  const tokens: BlockchainTokenBalance[] = [];
  let usedFallback = false;

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
        const price = parseFloat(t.token.exchange_rate ?? '') || 0;
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
        });
      }
    } catch {
      usedFallback = true;
    }
  } else {
    usedFallback = true;
  }

  // ── fallback: public RPC (native + verified token set) ──
  if (usedFallback) {
    nativeQty =
      bigStrToNumber(
        await rpcCall<string>(meta.rpcs, 'eth_getBalance', [address, 'latest'])
      ) / 1e18;
    nativePrice = 0;
    const set = FALLBACK_EVM_TOKENS[network] ?? [];
    const results = await Promise.allSettled(
      set.map((t) =>
        rpcCall<string>(meta.rpcs, 'eth_call', [
          { to: t.contract, data: `${BALANCE_OF_SELECTOR}${address.slice(2).toLowerCase().padStart(64, '0')}` },
          'latest',
        ])
      )
    );
    results.forEach((r, i) => {
      if (r.status !== 'fulfilled') return;
      const qty = bigStrToNumber(r.value) / Math.pow(10, set[i].decimals);
      if (!(qty > 0)) return;
      tokens.push({
        symbol: set[i].symbol,
        name: set[i].name,
        kind: 'token',
        qty,
        priceUsd: 0,
        change24hPct: null,
        valueUsd: 0,
        binancePair: binancePairFor(set[i].symbol),
      });
    });
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
    });
  }

  // Fill missing prices via Binance (RPC fallback + zero-price Blockscout rows)
  await fillPricesFromBinance(tokens);
  return tokens;
}

async function fillPricesFromBinance(tokens: BlockchainTokenBalance[]): Promise<void> {
  const pairs = tokens
    .filter((t) => t.priceUsd <= 0 && t.binancePair)
    .map((t) => t.binancePair as string);
  if (pairs.length === 0) return;
  try {
    const map = await fetchBinanceTickers([...new Set(pairs)]);
    for (const t of tokens) {
      if (t.priceUsd > 0 || !t.binancePair) continue;
      const hit = map[t.binancePair];
      if (hit) {
        t.priceUsd = hit.price;
        t.change24hPct = hit.chg;
        t.valueUsd = t.qty * hit.price;
      } else if (['USDT', 'USDC', 'DAI', 'USDD', 'USDC.E', 'TUSD', 'FDUSD'].includes(t.symbol)) {
        t.priceUsd = 1;
        t.change24hPct = 0;
        t.valueUsd = t.qty;
      }
    }
  } catch {
    for (const t of tokens) {
      if (t.priceUsd <= 0 && ['USDT', 'USDC', 'DAI', 'USDD', 'USDC.E', 'TUSD', 'FDUSD'].includes(t.symbol)) {
        t.priceUsd = 1;
        t.change24hPct = 0;
        t.valueUsd = t.qty;
      }
    }
  }
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
  const n = parseInt(raw, 16);
  return Number.isFinite(n) ? n / Math.pow(10, token.decimals) : 0;
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
// Public entry — fetch one wallet (all networks)
// ---------------------------------------------------------------------------

export async function fetchBlockchainWalletData(wallet: BlockchainWallet): Promise<BlockchainWalletData> {
  const nets: Record<BlockchainNetwork, (a: string) => Promise<BlockchainTokenBalance[]>> = {
    ethereum: (a) => fetchEvmBalances('ethereum', a),
    bsc: (a) => fetchEvmBalances('bsc', a),
    polygon: (a) => fetchEvmBalances('polygon', a),
    arbitrum: (a) => fetchEvmBalances('arbitrum', a),
    base: (a) => fetchEvmBalances('base', a),
    tron: fetchTronBalances,
    bitcoin: fetchBitcoinBalances,
    solana: fetchSolanaBalances,
  };

  const raw = await nets[wallet.network](wallet.address.trim());
  // drop dust rows worth < $0.01 (Blockscout returns hundreds of spam tokens)
  const tokens = raw
    .filter((t) => t.qty > 0)
    .filter((t) => t.priceUsd > 0 ? t.valueUsd >= 0.01 : true)
    .sort((a, b) => b.valueUsd - a.valueUsd)
    .slice(0, 40);
  const totalUsd = tokens.reduce((s, t) => s + (Number.isFinite(t.valueUsd) ? t.valueUsd : 0), 0);
  const data: BlockchainWalletData = {
    walletId: wallet.id,
    tokens,
    totalUsd,
    fetchedAt: Date.now(),
  };
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

/** Daily closes for a Binance pair covering the last ~185 days (1 call). */
async function fetchDailyCloses(pair: string): Promise<{ t: number; c: number }[]> {
  const cached = klineCache.get(pair);
  if (cached && Date.now() - cached.at < KLINE_TTL) return cached.closes;
  const start = Date.now() - 186 * 86_400_000;
  let lastErr: unknown = null;
  for (const host of BINANCE_HOSTS) {
    try {
      const k = await fetchJson<unknown[][]>(
        `${host}/api/v3/klines?symbol=${pair}&interval=1d&startTime=${start}&limit=1000`
      );
      const closes = k.map((c) => ({ t: Number(c[0]), c: parseFloat(String(c[4])) }));
      klineCache.set(pair, { at: Date.now(), closes });
      return closes;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('klines ناموفق');
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
  // aggregate token quantities across wallets keyed by price source
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
        stable: ['USDT', 'USDC', 'DAI', 'USDD', 'USDC.E', 'TUSD', 'FDUSD'].includes(t.symbol),
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

  // live prices (for "now" legs) + history (for "then" legs)
  const pairs = entries.filter((e) => e.pair).map((e) => e.pair as string);
  let live: Record<string, { price: number; chg: number | null }> = {};
  if (pairs.length > 0) {
    try {
      live = await fetchBinanceTickers([...new Set(pairs)]);
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
