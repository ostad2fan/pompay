import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import {
  Wallet,
  Plus,
  Trash2,
  RefreshCw,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Save,
  Key,
  ShieldAlert,
  DollarSign,
  TrendingUp,
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import CryptoJS from 'crypto-js';
import colors from '@/constants/colors';
import { createThemedStyles } from '@/utils/themeStyles';
import { EXCHANGE_LIST } from '@/constants/exchanges';
import { ExchangeId } from '@/types/crypto';
import DropdownPicker from '@/components/DropdownPicker';
import { useApp } from '@/contexts/AppContext';
import { fetchUsdtTomanPrice, formatToman, arzinjaAuthHeaders } from '@/utils/nobitexApi';

interface ExchangeWallet {
  id: string;
  exchangeId: ExchangeId;
  exchangeName: string;
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  addedAt: number;
}

type WalletSection = 'spot' | 'earn' | 'funding' | 'futures' | 'alpha';

interface WalletBalance {
  asset: string;
  /** Which exchange account the asset lives in (اسپات/Earn/فاندینگ/فیوچرز/آلفا). */
  section?: WalletSection;
  free: number;
  locked: number;
  total: number;
  valueUsd: number;
  /** Average buy price from trade history (approximate cost basis). */
  avgCost?: number;
  /** Unrealized profit/loss for the held quantity (USD, approximate). */
  pnlUsd?: number;
  pnlPercent?: number;
}

interface FuturesPosition {
  symbol: string;
  positionSide: string;
  leverage: number;
  entryPrice: number;
  markPrice: number;
  notionalUsd: number;
  unrealizedPnl: number;
  roePercent: number;
}

interface ExchangeBalanceData {
  walletId: string;
  balances: WalletBalance[];
  totalValueUsd: number;
  lastUpdated: number;
  /** Open futures positions with unrealized PnL (Binance). */
  futuresPositions?: FuturesPosition[];
  futuresRealizedPnl?: number;
  futuresUnrealizedPnl?: number;
  /** Approximate total profit/loss of the whole exchange account. */
  totalPnlUsd?: number;
  /** Display note (e.g. approximation explanation). */
  pnlNote?: string;
}

const SECTION_LABEL: Record<WalletSection, string> = {
  spot: 'اسپات',
  earn: 'Earn (سپرده‌گذاری)',
  funding: 'فاندینگ',
  futures: 'فیوچرز',
  alpha: 'آلفا (Alpha)',
};

function formatSignedUsd(value: number): string {
  const sign = value > 0 ? '+' : '';
  const abs = Math.abs(value);
  const digits = abs < 100 ? 2 : 0;
  return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: digits })}`;
}

const WALLETS_KEY = '@exchange_wallets';

async function loadWallets(): Promise<ExchangeWallet[]> {
  try {
    const stored = await AsyncStorage.getItem(WALLETS_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.log('[Wallet] Error loading wallets:', e);
  }
  return [];
}

function signBinanceQuery(queryString: string, apiSecret: string): string {
  return CryptoJS.HmacSHA256(queryString, apiSecret).toString(CryptoJS.enc.Hex);
}

/**
 * Shared USD price map (asset -> USDT price) with a 60s cache — used to value
 * funding-wallet / Iranian-exchange assets that don't come with a USD value.
 */
let usdPriceMapCache: { at: number; map: Record<string, number> } | null = null;

async function getUsdPriceMap(): Promise<Record<string, number>> {
  if (usdPriceMapCache && Date.now() - usdPriceMapCache.at < 60_000) {
    return usdPriceMapCache.map;
  }
  const map: Record<string, number> = {};
  try {
    const pricesRes = await fetch('https://api.binance.com/api/v3/ticker/price');
    if (pricesRes.ok) {
      const prices = await pricesRes.json();
      if (Array.isArray(prices)) {
        for (const p of prices) map[p.symbol] = parseFloat(p.price);
      }
    }
  } catch (e) {
    console.log('[Wallet] Price map fetch error:', e);
  }
  usdPriceMapCache = { at: Date.now(), map };
  return map;
}

function stableCoinValueUsd(asset: string, amount: number): number | null {
  if (['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'DAI'].includes(asset)) return amount;
  return null;
}

/**
 * Signed Binance request helper (HMAC SHA256). Each section is optional — a
 * missing permission / unsupported endpoint never breaks the whole overview.
 */
async function binanceSigned<T>(
  url: string,
  wallet: ExchangeWallet,
  extra: Record<string, string> = {},
  method: 'GET' | 'POST' = 'GET'
): Promise<T | null> {
  try {
    const params = new URLSearchParams({ timestamp: String(Date.now()), recvWindow: '10000', ...extra });
    const signature = signBinanceQuery(params.toString(), wallet.apiSecret);
    const res = await fetch(`${url}?${params.toString()}&signature=${signature}`, {
      method,
      headers: { 'X-MBX-APIKEY': wallet.apiKey },
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => null);
      console.log(`[Wallet] Binance ${url} -> ${res.status}`, errData);
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    console.log(`[Wallet] Binance ${url} error:`, e);
    return null;
  }
}

interface MyTrade {
  id: number;
  price: string;
  qty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
}

/**
 * Approximate per-asset cost basis + unrealized PnL from spot trade history
 * (weighted-average method) — the same approach the Binance app uses for its
 * approximate PNL. Returns null for stablecoins / missing history.
 */
async function computeAssetPnl(
  wallet: ExchangeWallet,
  asset: string,
  totalQty: number,
  currentPrice: number
): Promise<{ avgCost: number; pnlUsd: number; pnlPercent: number } | null> {
  const STABLES = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'DAI'];
  if (STABLES.includes(asset) || totalQty <= 0 || currentPrice <= 0) return null;
  try {
    const trades = await binanceSigned<MyTrade[]>(
      'https://api.binance.com/api/v3/myTrades',
      wallet,
      { symbol: `${asset}USDT`, limit: '1000' }
    );
    if (!trades || trades.length === 0) return null;

    let qty = 0;
    let cost = 0;
    for (const t of trades) {
      const q = parseFloat(t.qty);
      const p = parseFloat(t.price);
      if (t.isBuyer) {
        qty += q;
        cost += q * p;
      } else {
        const avg = qty > 0 ? cost / qty : 0;
        const sellQty = Math.min(q, qty);
        qty -= sellQty;
        cost -= sellQty * avg;
      }
    }
    if (qty <= 0 || cost <= 0) return null;
    const avgCost = cost / qty;
    const heldQty = Math.min(totalQty, qty);
    const pnlUsd = (currentPrice - avgCost) * heldQty;
    const invested = avgCost * heldQty;
    const pnlPercent = invested > 0 ? (pnlUsd / invested) * 100 : 0;
    return { avgCost, pnlUsd, pnlPercent };
  } catch (e) {
    console.log(`[Wallet] myTrades error for ${asset}:`, e);
    return null;
  }
}

interface BinanceFullAccount {
  balances: WalletBalance[];
  futuresPositions: FuturesPosition[];
  futuresRealizedPnl: number;
  futuresUnrealizedPnl: number;
  totalPnlUsd: number;
}

async function fetchBinanceBalance(wallet: ExchangeWallet): Promise<WalletBalance[]> {
  const data = await fetchBinanceFullAccount(wallet);
  return data.balances;
}

/**
 * FULL Binance account overview: Spot + Earn (flexible & locked) + Funding +
 * Futures (balances, open positions, realized income) + Alpha — with
 * approximate per-asset PnL and a total PnL for the whole exchange.
 */
async function fetchBinanceFullAccount(wallet: ExchangeWallet): Promise<BinanceFullAccount> {
  const balances: WalletBalance[] = [];
  const futuresPositions: FuturesPosition[] = [];
  let futuresRealizedPnl = 0;
  let futuresUnrealizedPnl = 0;

  // ---- Spot (api/v3/account) ----
  const spotData = await binanceSigned<{ balances?: Array<{ asset: string; free: string; locked: string }> }>(
    'https://api.binance.com/api/v3/account',
    wallet
  );
  if (spotData?.balances) {
    for (const b of spotData.balances) {
      const free = parseFloat(b.free);
      const locked = parseFloat(b.locked);
      if (free > 0.0001 || locked > 0.0001) {
        balances.push({ asset: b.asset, section: 'spot', free, locked, total: free + locked, valueUsd: 0 });
      }
    }
  }

  // ---- Earn: Simple Earn flexible + locked positions ----
  const earnFlex = await binanceSigned<{ rows?: Array<{ asset?: string; totalAmount?: string; totalInUSDT?: string }> }>(
    'https://api.binance.com/sapi/v1/simple-earn/flexible/position',
    wallet
  );
  if (Array.isArray(earnFlex?.rows)) {
    for (const r of earnFlex.rows) {
      const amount = parseFloat(r.totalAmount ?? '0');
      if (amount > 0.0001 && r.asset) {
        const valueUsd = parseFloat(r.totalInUSDT ?? '0');
        balances.push({
          asset: r.asset, section: 'earn', free: amount, locked: 0, total: amount,
          valueUsd: valueUsd > 0 ? valueUsd : 0,
        });
      }
    }
  }
  const earnLocked = await binanceSigned<{ rows?: Array<{ asset?: string; amount?: string; totalAmount?: string; totalInUSDT?: string }> }>(
    'https://api.binance.com/sapi/v1/simple-earn/locked/position',
    wallet
  );
  if (Array.isArray(earnLocked?.rows)) {
    for (const r of earnLocked.rows) {
      const amount = parseFloat(r.amount ?? r.totalAmount ?? '0');
      if (amount > 0.0001 && r.asset) {
        const valueUsd = parseFloat(r.totalInUSDT ?? '0');
        const existing = balances.find((b) => b.section === 'earn' && b.asset === r.asset);
        if (existing) {
          existing.free += amount;
          existing.total += amount;
          existing.valueUsd += valueUsd;
        } else {
          balances.push({
            asset: r.asset, section: 'earn', free: amount, locked: 0, total: amount,
            valueUsd: valueUsd > 0 ? valueUsd : 0,
          });
        }
      }
    }
  }

  // ---- Funding wallet (sapi get-funding-asset, POST) ----
  const fundData = await binanceSigned<Array<{ asset: string; free: string; locked?: string }>>(
    'https://api.binance.com/sapi/v1/asset/get-funding-asset',
    wallet,
    {},
    'POST'
  );
  if (Array.isArray(fundData)) {
    for (const b of fundData) {
      const free = parseFloat(b.free);
      const locked = parseFloat(b.locked ?? '0');
      if (free > 0.0001 || locked > 0.0001) {
        balances.push({ asset: b.asset, section: 'funding', free, locked, total: free + locked, valueUsd: 0 });
      }
    }
  }

  // ---- Alpha wallet (graceful — hidden when the API is unavailable) ----
  const alphaData = await binanceSigned<Array<{ asset?: string; balance?: string; walletType?: string }>>(
    'https://api.binance.com/sapi/v1/asset/wallet/balance',
    wallet,
    { walletType: 'ALPHA' }
  );
  if (Array.isArray(alphaData)) {
    for (const b of alphaData) {
      const amount = parseFloat(b.balance ?? '0');
      if (amount > 0.0001 && b.asset) {
        balances.push({ asset: b.asset, section: 'alpha', free: amount, locked: 0, total: amount, valueUsd: 0 });
      }
    }
  }

  // ---- Futures: wallet balances ----
  const futBalances = await binanceSigned<Array<{ asset: string; balance: string; availableBalance: string; crossUnPnl?: string }>>(
    'https://fapi.binance.com/fapi/v2/balance',
    wallet
  );
  if (Array.isArray(futBalances)) {
    for (const b of futBalances) {
      const balance = parseFloat(b.balance);
      if (balance > 0.001) {
        const available = parseFloat(b.availableBalance);
        const unPnl = parseFloat(b.crossUnPnl ?? '0');
        balances.push({
          asset: b.asset, section: 'futures',
          free: available, locked: Math.max(0, balance - available), total: balance,
          valueUsd: balance,
        });
        futuresUnrealizedPnl += unPnl;
      }
    }
  }

  // ---- Futures: open positions with unrealized PnL ----
  const positions = await binanceSigned<Array<{
    symbol: string; positionSide: string; leverage: string;
    entryPrice: string; markPrice: string; notional: string;
    unRealizedProfit: string; roePercent?: string; positionAmt: string;
  }>>('https://fapi.binance.com/fapi/v2/positionRisk', wallet);
  if (Array.isArray(positions)) {
    for (const p of positions) {
      const amt = Math.abs(parseFloat(p.positionAmt));
      if (amt <= 0) continue;
      futuresPositions.push({
        symbol: p.symbol,
        positionSide: p.positionSide,
        leverage: parseInt(p.leverage, 10) || 1,
        entryPrice: parseFloat(p.entryPrice),
        markPrice: parseFloat(p.markPrice),
        notionalUsd: Math.abs(parseFloat(p.notional)),
        unrealizedPnl: parseFloat(p.unRealizedProfit),
        roePercent: parseFloat(p.roePercent ?? '0'),
      });
    }
  }

  // ---- Futures: realized income (REALIZED_PNL, last 1000 records) ----
  const income = await binanceSigned<Array<{ incomeType: string; income: string; time: number }>>(
    'https://fapi.binance.com/fapi/v1/income',
    wallet,
    { incomeType: 'REALIZED_PNL', limit: '1000' }
  );
  if (Array.isArray(income)) {
    for (const row of income) futuresRealizedPnl += parseFloat(row.income);
  }

  // ---- USD pricing for spot / earn / funding / alpha + per-asset PnL ----
  try {
    const priceMap = await getUsdPriceMap();
    for (const bal of balances) {
      if (bal.valueUsd > 0) continue;
      const stable = stableCoinValueUsd(bal.asset, bal.total);
      if (stable !== null) {
        bal.valueUsd = stable;
      } else if (priceMap[`${bal.asset}USDT`]) {
        bal.valueUsd = bal.total * priceMap[`${bal.asset}USDT`];
      }
    }

    const priceOf = (asset: string): number => {
      const stable = stableCoinValueUsd(asset, 1);
      if (stable !== null) return 1;
      return priceMap[`${asset}USDT`] ?? 0;
    };
    const nonFuturesAssets = new Set(
      balances.filter((b) => b.section !== 'futures').map((b) => b.asset)
    );
    const assetList = Array.from(nonFuturesAssets).slice(0, 25);
    const batchSize = 5;
    for (let i = 0; i < assetList.length; i += batchSize) {
      const batch = assetList.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (asset) => {
          const price = priceOf(asset);
          if (price <= 0) return;
          const totalQty = balances
            .filter((b) => b.asset === asset && b.section !== 'futures')
            .reduce((sum, b) => sum + b.total, 0);
          const pnl = await computeAssetPnl(wallet, asset, totalQty, price);
          if (!pnl) return;
          for (const b of balances) {
            if (b.asset === asset && b.section !== 'futures') {
              b.avgCost = pnl.avgCost;
              b.pnlUsd = pnl.pnlUsd * (b.total / Math.max(totalQty, 1e-12));
              b.pnlPercent = pnl.pnlPercent;
            }
          }
        })
      );
    }
  } catch (priceErr) {
    console.log('[Wallet] Price fetch error:', priceErr);
  }

  // ---- Total approximate PnL for the whole exchange ----
  const holdingPnl = balances
    .filter((b) => b.section !== 'futures')
    .reduce((sum, b) => sum + (b.pnlUsd ?? 0), 0);
  const totalPnlUsd = holdingPnl + futuresUnrealizedPnl + futuresRealizedPnl;

  return { balances, futuresPositions, futuresRealizedPnl, futuresUnrealizedPnl, totalPnlUsd };
}


async function fetchBybitBalance(wallet: ExchangeWallet): Promise<WalletBalance[]> {
  const balances: WalletBalance[] = [];
  const timestamp = Date.now().toString();
  const recvWindow = '10000';
  const accountType = 'UNIFIED';

  try {
    const queryString = `accountType=${accountType}`;
    const preSign = `${timestamp}${wallet.apiKey}${recvWindow}${queryString}`;
    const signature = CryptoJS.HmacSHA256(preSign, wallet.apiSecret).toString(CryptoJS.enc.Hex);

    const response = await fetch(
      `https://api.bybit.com/v5/account/wallet-balance?${queryString}`,
      {
        headers: {
          'X-BAPI-API-KEY': wallet.apiKey,
          'X-BAPI-SIGN': signature,
          'X-BAPI-SIGN-TYPE': '2',
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': recvWindow,
        },
      }
    );

    if (response.ok) {
      const data = await response.json();
      console.log('[Wallet] Bybit response:', JSON.stringify(data).slice(0, 300));
      const accounts = data?.result?.list;
      if (Array.isArray(accounts)) {
        for (const account of accounts) {
          const coins = account?.coin;
          if (Array.isArray(coins)) {
            for (const c of coins) {
              const total = parseFloat(c.walletBalance || '0');
              const free = parseFloat(c.availableToWithdraw || '0');
              if (total > 0.0001) {
                balances.push({
                  asset: c.coin,
                  free,
                  locked: total - free,
                  total,
                  valueUsd: parseFloat(c.usdValue || '0'),
                });
              }
            }
          }
        }
      }
    } else {
      const errData = await response.json().catch(() => null);
      console.log('[Wallet] Bybit error:', response.status, errData);
      console.log('[Wallet] Bybit unified balance failed — trying funding wallet only');
    }
  } catch (e) {
    console.log('[Wallet] Bybit fetch error:', e);
  }

  // Funding wallet — the UNIFIED query above misses the funding balance.
  try {
    const fundQuery = 'accountType=FUND';
    const fundPreSign = `${timestamp}${wallet.apiKey}${recvWindow}${fundQuery}`;
    const fundSignature = CryptoJS.HmacSHA256(fundPreSign, wallet.apiSecret).toString(
      CryptoJS.enc.Hex
    );
    const fundResponse = await fetch(
      `https://api.bybit.com/v5/asset/transfer/query-account-coins-balance?${fundQuery}`,
      {
        headers: {
          'X-BAPI-API-KEY': wallet.apiKey,
          'X-BAPI-SIGN': fundSignature,
          'X-BAPI-SIGN-TYPE': '2',
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': recvWindow,
        },
      }
    );
    if (fundResponse.ok) {
      const fundData = await fundResponse.json();
      const fundAccounts = fundData?.result?.list;
      if (Array.isArray(fundAccounts)) {
        for (const account of fundAccounts) {
          const coins = account?.coin;
          if (Array.isArray(coins)) {
            for (const c of coins) {
              const total = parseFloat(c.walletBalance || '0');
              if (total > 0.0001) {
                balances.push({
                  asset: `${c.coin} (فاندینگ)`,
                  free: parseFloat(c.transferBalance || c.walletBalance || '0'),
                  locked: total - parseFloat(c.transferBalance || c.walletBalance || '0'),
                  total,
                  valueUsd: parseFloat(c.usdValue || '0'),
                });
              }
            }
          }
        }
      }
    } else {
      console.log('[Wallet] Bybit funding error:', fundResponse.status);
    }
  } catch (e) {
    console.log('[Wallet] Bybit funding fetch error:', e);
  }

  // Value the assets that came back without a USD value (funding coins).
  try {
    const priceMap = await getUsdPriceMap();
    for (const bal of balances) {
      if (bal.valueUsd > 0) continue;
      const cleanAsset = bal.asset.replace(' (فاندینگ)', '');
      const stable = stableCoinValueUsd(cleanAsset, bal.total);
      if (stable !== null) {
        bal.valueUsd = stable;
      } else if (priceMap[`${cleanAsset}USDT`]) {
        bal.valueUsd = bal.total * priceMap[`${cleanAsset}USDT`];
      }
    }
  } catch {}

  return balances;
}

async function fetchOkxBalance(wallet: ExchangeWallet): Promise<WalletBalance[]> {
  const balances: WalletBalance[] = [];
  const timestamp = new Date().toISOString();
  const method = 'GET';
  const requestPath = '/api/v5/account/balance';

  try {
    const preSign = `${timestamp}${method}${requestPath}`;
    const signature = CryptoJS.enc.Base64.stringify(
      CryptoJS.HmacSHA256(preSign, wallet.apiSecret)
    );

    const headers: Record<string, string> = {
      'OK-ACCESS-KEY': wallet.apiKey,
      'OK-ACCESS-SIGN': signature,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': wallet.passphrase || '',
    };

    const response = await fetch(`https://www.okx.com${requestPath}`, { headers });

    if (response.ok) {
      const data = await response.json();
      console.log('[Wallet] OKX response:', JSON.stringify(data).slice(0, 300));
      const details = data?.data?.[0]?.details;
      if (Array.isArray(details)) {
        for (const d of details) {
          const total = parseFloat(d.cashBal || '0');
          const free = parseFloat(d.availBal || '0');
          if (total > 0.0001) {
            balances.push({
              asset: d.ccy,
              free,
              locked: total - free,
              total,
              valueUsd: parseFloat(d.eqUsd || '0'),
            });
          }
        }
      }
    } else {
      const errData = await response.json().catch(() => null);
      console.log('[Wallet] OKX error:', response.status, errData);
      console.log('[Wallet] OKX trading balance failed — trying funding wallet only');
    }
  } catch (e) {
    console.log('[Wallet] OKX fetch error:', e);
  }

  // Funding wallet — the trading-account query above misses funding assets.
  try {
    const fundPath = '/api/v5/asset/balances';
    const fundPreSign = `${timestamp}GET${fundPath}`;
    const fundSignature = CryptoJS.enc.Base64.stringify(
      CryptoJS.HmacSHA256(fundPreSign, wallet.apiSecret)
    );
    const fundResponse = await fetch(`https://www.okx.com${fundPath}`, {
      headers: {
        'OK-ACCESS-KEY': wallet.apiKey,
        'OK-ACCESS-SIGN': fundSignature,
        'OK-ACCESS-TIMESTAMP': timestamp,
        'OK-ACCESS-PASSPHRASE': wallet.passphrase || '',
      },
    });
    if (fundResponse.ok) {
      const fundData = await fundResponse.json();
      const fundDetails = fundData?.data;
      if (Array.isArray(fundDetails)) {
        for (const d of fundDetails) {
          const total = parseFloat(d.bal || '0');
          const free = parseFloat(d.availBal || '0');
          if (total > 0.0001) {
            balances.push({
              asset: `${d.ccy} (فاندینگ)`,
              free,
              locked: total - free,
              total,
              valueUsd: 0,
            });
          }
        }
      }
    }
  } catch (e) {
    console.log('[Wallet] OKX funding fetch error:', e);
  }

  // Value assets that came back without a USD value (funding coins).
  try {
    const priceMap = await getUsdPriceMap();
    for (const bal of balances) {
      if (bal.valueUsd > 0) continue;
      const cleanAsset = bal.asset.replace(' (فاندینگ)', '');
      const stable = stableCoinValueUsd(cleanAsset, bal.total);
      if (stable !== null) {
        bal.valueUsd = stable;
      } else if (priceMap[`${cleanAsset}USDT`]) {
        bal.valueUsd = bal.total * priceMap[`${cleanAsset}USDT`];
      }
    }
  } catch {}

  return balances;
}

/**
 * Iranian exchanges (Arzinja / Nobitex — same Nobitex-compatible platform):
 * reads the FULL wallet overview (Toman + USDT + every funded asset) using
 * the user's API keys with a multi-format auth fallback.
 */
async function fetchNobitexBalance(wallet: ExchangeWallet): Promise<WalletBalance[]> {
  const balances: WalletBalance[] = [];
  const authVariants = await arzinjaAuthHeaders();
  const bases = ['https://api.arzinja.ir', 'https://api.nobitex.ir'];

  let walletsPayload: unknown = null;
  let lastError = 'unknown';

  for (const base of bases) {
    for (const headers of authVariants) {
      try {
        // Preferred endpoint: complete wallet list with per-asset balances.
        const response = await fetch(`${base}/users/wallets/list`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ tokens: 'all' }),
        });
        if (response.ok) {
          const data = await response.json();
          if (data?.wallets) {
            walletsPayload = data;
            break;
          }
          if (data?.balances) {
            walletsPayload = { wallets: Object.entries(data.balances).map(([currency, balance]) => ({
              currency,
              balance: String(balance),
              blockedBalance: '0',
            })) };
            break;
          }
        } else {
          lastError = `HTTP ${response.status}`;
        }
      } catch (e) {
        lastError = String(e);
      }
    }
    if (walletsPayload) break;
  }

  if (!walletsPayload) {
    throw new Error(
      `دریافت موجودی ${wallet.exchangeName} ناموفق بود (${lastError}). کلید API را بررسی کنید و مطمئن شوید دسترسی «خواندن» فعال است.`
    );
  }

  // Value Toman balances at the live USDT/Toman rate.
  let usdtToToman = 0;
  try {
    usdtToToman = (await fetchUsdtTomanPrice()).usdtToToman;
  } catch {}

  const payload = walletsPayload as {
    wallets?: Array<{ currency?: string; balance?: string; blockedBalance?: string }>;
  };

  for (const w of payload.wallets ?? []) {
    const currency = (w.currency ?? '').toLowerCase();
    const free = parseFloat(w.balance ?? '0');
    const locked = parseFloat(w.blockedBalance ?? '0');
    const total = free + locked;
    if (!currency || total <= 0) continue;

    if (currency === 'rls' || currency === 'irt') {
      // Toman wallet (Rial values are divided by 10).
      const toman = currency === 'rls' ? total / 10 : total;
      const valueUsd = usdtToToman > 0 ? toman / usdtToToman : 0;
      balances.push({
        asset: 'تومان',
        free: currency === 'rls' ? free / 10 : free,
        locked: currency === 'rls' ? locked / 10 : locked,
        total: toman,
        valueUsd,
      });
    } else {
      const assetName = currency === 'usdt' ? 'تتر' : currency.toUpperCase();
      const priceMap = await getUsdPriceMap();
      const stable = currency === 'usdt' ? total : stableCoinValueUsd(currency.toUpperCase(), total);
      const valueUsd = stable !== null ? stable : (priceMap[`${currency.toUpperCase()}USDT`] ?? 0) * total;
      balances.push({
        asset: assetName,
        free,
        locked,
        total,
        valueUsd,
      });
    }
  }

  return balances;
}

async function fetchGenericBalance(wallet: ExchangeWallet): Promise<WalletBalance[]> {
  console.log(`[Wallet] Exchange ${wallet.exchangeId} - trying Binance-compatible API...`);
  throw new Error(`صرافی ${wallet.exchangeName} فعلاً پشتیبانی نمی‌شود. فقط Binance، Bybit، OKX، BitPerp، Nobitex و Arzinja پشتیبانی می‌شوند.`);
}

/**
 * BitPerp (بیت‌پرپ) — صرافی فیوچرز دائمی با REST API اختصاصی
 * (backend از نوع FastAPI؛ مسیرهای /api/balance و /api/positions).
 * مستندات عمومی ندارد؛ طرح هدر احراز هویت به‌ترتیب امتحان می‌شود
 * (X-API-KEY بعد Authorization Bearer) و پاسخ انعطاف‌پذیر parse می‌شود.
 */
async function bitperpRequest(
  wallet: ExchangeWallet,
  path: string
): Promise<{ status: number; ok: boolean; data: unknown } | null> {
  const schemes: Array<Record<string, string>> = [
    { 'X-API-KEY': wallet.apiKey, 'X-API-SECRET': wallet.apiSecret },
    { Authorization: `Bearer ${wallet.apiKey}` },
    { 'X-MBX-APIKEY': wallet.apiKey },
  ];
  for (const headers of schemes) {
    try {
      const res = await fetch(`https://bitperp.com${path}`, { headers });
      if (res.status === 401 || res.status === 403) continue; // طرح بعدی را امتحان کن
      const text = await res.text();
      let data: unknown = null;
      try {
        data = JSON.parse(text);
      } catch {
        return { status: res.status, ok: false, data: null }; // صفحه HTML SPA — نه API
      }
      return { status: res.status, ok: res.ok, data };
    } catch (e) {
      console.log('[Wallet] BitPerp request error:', e);
    }
  }
  return null;
}

/** Parse انعطاف‌پذیر لیست دارایی‌ها از اشکال مختلف پاسخ BitPerp. */
function parseBitperpBalances(payload: unknown): WalletBalance[] {
  const balances: WalletBalance[] = [];
  let root: any = payload;
  if (root && typeof root === 'object' && !Array.isArray(root) && 'data' in root) {
    root = (root as Record<string, unknown>).data;
  }
  if (root && typeof root === 'object' && !Array.isArray(root)) {
    for (const key of ['balances', 'coins', 'assets', 'list', 'rows', 'wallet']) {
      const candidate = (root as Record<string, unknown>)[key];
      if (Array.isArray(candidate)) {
        root = candidate;
        break;
      }
    }
  }
  if (!Array.isArray(root)) return balances;

  for (const item of root) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const asset = String(
      rec.asset ?? rec.coin ?? rec.currency ?? rec.symbol ?? ''
    ).toUpperCase();
    if (!asset) continue;
    const total = parseFloat(
      String(rec.total ?? rec.balance ?? rec.amount ?? rec.equity ?? rec.walletBalance ?? '0')
    );
    if (!Number.isFinite(total) || total <= 0.0001) continue;
    const freeRaw = parseFloat(
      String(
        rec.available ?? rec.free ?? rec.availableBalance ?? rec.availableToWithdraw ?? rec.usable ?? total
      )
    );
    const free = Number.isFinite(freeRaw) ? freeRaw : total;
    const valueUsd =
      parseFloat(String(rec.usdValue ?? rec.valueUsd ?? rec.value ?? '0')) || 0;
    balances.push({
      asset,
      free,
      locked: Math.max(total - free, 0),
      total,
      valueUsd,
      section: 'futures',
    });
  }
  return balances;
}

async function fetchBitperpBalance(wallet: ExchangeWallet): Promise<WalletBalance[]> {
  console.log('[Wallet] Fetching BitPerp balance...');
  const res = await bitperpRequest(wallet, '/api/balance');

  if (!res || !res.ok) {
    const status = res?.status ?? 0;
    if (status === 401 || status === 403) {
      throw new Error('کلید API بیت‌پرپ قبول نشد — کلید API را در سایت BitPerp بسازید و دوباره امتحان کنید.');
    }
    throw new Error(
      `اتصال به BitPerp ناموفق بود${status ? ` (کد ${status})` : ''} — کلید شما ذخیره شد؛ اگر API این صرافی محدود بود در نسخه بعدی تکمیل می‌شود.`
    );
  }

  const balances = parseBitperpBalances(res.data);

  // ارزش‌گذاری دارایی‌هایی که بدون ارزش دلاری برگشته‌اند
  try {
    const priceMap = await getUsdPriceMap();
    for (const bal of balances) {
      if (bal.valueUsd > 0) continue;
      const stable = stableCoinValueUsd(bal.asset, bal.total);
      if (stable !== null) {
        bal.valueUsd = stable;
      } else if (priceMap[`${bal.asset}USDT`]) {
        bal.valueUsd = bal.total * priceMap[`${bal.asset}USDT`];
      }
    }
  } catch {}

  return balances;
}

async function fetchExchangeBalance(wallet: ExchangeWallet): Promise<ExchangeBalanceData> {
  console.log('[Wallet] Fetching balance for', wallet.exchangeName, wallet.exchangeId);

  let balances: WalletBalance[] = [];
  let account: BinanceFullAccount | null = null;

  try {
    switch (wallet.exchangeId) {
      case 'binance':
        account = await fetchBinanceFullAccount(wallet);
        balances = account.balances;
        break;
      case 'bybit':
        balances = await fetchBybitBalance(wallet);
        break;
      case 'okx':
        balances = await fetchOkxBalance(wallet);
        break;
      case 'arzinja':
      case 'nobitex':
        balances = await fetchNobitexBalance(wallet);
        break;
      case 'bitperp':
        balances = await fetchBitperpBalance(wallet);
        break;
      default:
        balances = await fetchGenericBalance(wallet);
        break;
    }
  } catch (e) {
    console.log('[Wallet] Fetch error:', e);
    throw e;
  }

  // Normalize sections: legacy fetchers mark accounts via asset suffixes
  // ("BTC (فاندینگ)") — strip them into the proper section field.
  for (const bal of balances) {
    if (bal.asset.endsWith(' (فاندینگ)')) {
      bal.asset = bal.asset.replace(' (فاندینگ)', '');
      bal.section = bal.section ?? 'funding';
    } else if (bal.asset.endsWith(' (فیوچرز)')) {
      bal.asset = bal.asset.replace(' (فیوچرز)', '');
      bal.section = bal.section ?? 'futures';
    }
    bal.section = bal.section ?? 'spot';
  }

  const sectionOrder: Record<WalletSection, number> = { spot: 0, earn: 1, funding: 2, futures: 3, alpha: 4 };
  balances.sort(
    (a, b) =>
      (sectionOrder[a.section!] - sectionOrder[b.section!]) || b.valueUsd - a.valueUsd
  );
  const totalValueUsd = balances.reduce((sum, b) => sum + b.valueUsd, 0);

  const result: ExchangeBalanceData = {
    walletId: wallet.id,
    balances,
    totalValueUsd,
    lastUpdated: Date.now(),
  };

  // Binance extras: open positions + realized/unrealized + total exchange PnL
  if (account) {
    result.futuresPositions = account.futuresPositions;
    result.futuresRealizedPnl = account.futuresRealizedPnl;
    result.futuresUnrealizedPnl = account.futuresUnrealizedPnl;
    result.totalPnlUsd = account.totalPnlUsd;
    result.pnlNote =
      'PnL تقریبی بر اساس تاریخچه معاملات اسپات + پوزیشن‌های باز و سود/زیان محقق‌شده فیوچرز';
  }

  return result;
}

export default function WalletScreen() {
  const queryClient = useQueryClient();
  const { settings } = useApp();
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedExchange, setSelectedExchange] = useState<ExchangeId>('binance');
  const [newApiKey, setNewApiKey] = useState('');
  const [newApiSecret, setNewApiSecret] = useState('');
  const [newPassphrase, setNewPassphrase] = useState('');
  const [showSecrets, setShowSecrets] = useState(false);
  const [expandedWallet, setExpandedWallet] = useState<string | null>(null);

  const walletsQuery = useQuery({
    queryKey: ['exchange-wallets'],
    queryFn: loadWallets,
    staleTime: Infinity,
  });

  // Refresh cadence follows the app's own «بازه بروزرسانی» setting (minutes;
  // the default 5 = exactly the requested 5-minute tether price refresh).
  const refreshMs = Math.max((settings.refreshInterval ?? 5) * 60_000, 10_000);

  const tomanQuery = useQuery({
    queryKey: ['usdt-toman-price'],
    queryFn: fetchUsdtTomanPrice,
    refetchInterval: refreshMs,
    staleTime: 30_000,
  });

  const usdtToToman = tomanQuery.data?.usdtToToman ?? 0;
  const wallets = walletsQuery.data ?? [];

  // All exchange balances are fetched at screen level (via useQueries) so the
  // TOTAL across every connected exchange is reactive — it updates as soon as
  // any per-exchange query resolves instead of staying stale/zero.
  const balanceQueries = useQueries({
    queries: wallets.map((w) => ({
      queryKey: ['exchange-balance', w.id],
      queryFn: () => fetchExchangeBalance(w),
      refetchInterval: refreshMs,
      staleTime: 30_000,
      retry: 1,
    })),
  });

  const balanceByWalletId = useMemo(() => {
    const map: Record<string, ExchangeBalanceData | undefined> = {};
    wallets.forEach((w, i) => {
      map[w.id] = balanceQueries[i]?.data;
    });
    return map;
  }, [wallets, balanceQueries]);

  const totalPortfolioUsd = useMemo(() => {
    let total = 0;
    for (const w of wallets) {
      const data = balanceByWalletId[w.id];
      if (data) total += data.totalValueUsd;
    }
    return total;
  }, [wallets, balanceByWalletId]);

  // Approximate total profit/loss across every connected exchange.
  const totalPortfolioPnl = useMemo(() => {
    let total = 0;
    let found = false;
    for (const w of wallets) {
      const data = balanceByWalletId[w.id];
      if (data && data.totalPnlUsd !== undefined) {
        total += data.totalPnlUsd;
        found = true;
      }
    }
    return found ? total : null;
  }, [wallets, balanceByWalletId]);

  const saveMutation = useMutation({
    mutationFn: async (newWallets: ExchangeWallet[]) => {
      await AsyncStorage.setItem(WALLETS_KEY, JSON.stringify(newWallets));
      return newWallets;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exchange-wallets'] });
    },
  });

  const exchangeOptions = useMemo(
    () => EXCHANGE_LIST.map((ex) => ({ key: ex.id, label: ex.name })),
    []
  );

  const needsPassphrase = selectedExchange === 'okx' || selectedExchange === 'kucoin';

  const handleAddWallet = useCallback(() => {
    if (!newApiKey.trim()) {
      Alert.alert('خطا', 'لطفاً API Key را وارد کنید');
      return;
    }
    if (!newApiSecret.trim()) {
      Alert.alert('خطا', 'لطفاً API Secret را وارد کنید');
      return;
    }
    if (needsPassphrase && !newPassphrase.trim()) {
      Alert.alert('خطا', 'لطفاً Passphrase را وارد کنید');
      return;
    }

    const exchangeInfo = EXCHANGE_LIST.find((e) => e.id === selectedExchange);
    const newWallet: ExchangeWallet = {
      id: `wallet-${Date.now()}`,
      exchangeId: selectedExchange,
      exchangeName: exchangeInfo?.name ?? selectedExchange,
      apiKey: newApiKey.trim(),
      apiSecret: newApiSecret.trim(),
      passphrase: newPassphrase.trim() || undefined,
      addedAt: Date.now(),
    };

    const updated = [...wallets, newWallet];
    saveMutation.mutate(updated);
    setNewApiKey('');
    setNewApiSecret('');
    setNewPassphrase('');
    setShowAddForm(false);
    Alert.alert('موفق', `صرافی ${exchangeInfo?.name} اضافه شد`);
  }, [newApiKey, newApiSecret, newPassphrase, selectedExchange, wallets, needsPassphrase]);

  const handleRemoveWallet = useCallback(
    (id: string, name: string) => {
      Alert.alert('حذف صرافی', `آیا از حذف "${name}" اطمینان دارید؟`, [
        { text: 'لغو', style: 'cancel' },
        {
          text: 'حذف',
          style: 'destructive',
          onPress: () => {
            const updated = wallets.filter((w) => w.id !== id);
            saveMutation.mutate(updated);
            queryClient.removeQueries({ queryKey: ['exchange-balance', id] });
          },
        },
      ]);
    },
    [wallets]
  );

  const handleRefreshAll = useCallback(() => {
    wallets.forEach((w) => {
      queryClient.invalidateQueries({ queryKey: ['exchange-balance', w.id] });
    });
    queryClient.invalidateQueries({ queryKey: ['usdt-toman-price'] });
  }, [wallets]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.portfolioCard}>
        <View style={styles.portfolioHeader}>
          <Wallet size={20} color={colors.dark.accent} />
          <Text style={styles.portfolioTitle}>مجموع دارایی‌ها</Text>
          <Pressable style={styles.refreshAllBtn} onPress={handleRefreshAll}>
            <RefreshCw size={16} color={colors.dark.accent} />
          </Pressable>
        </View>

        <View style={styles.portfolioValues}>
          <View style={styles.portfolioValueRow}>
            <DollarSign size={14} color={colors.dark.green} />
            <Text style={styles.portfolioValueLabel}>ارزش دلاری:</Text>
            <Text style={styles.portfolioValueAmount}>
              ${totalPortfolioUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </Text>
          </View>
          {usdtToToman > 0 && (
            <View style={styles.portfolioValueRow}>
              <TrendingUp size={14} color={colors.dark.blue} />
              <Text style={styles.portfolioValueLabel}>ارزش تومانی:</Text>
              <Text style={[styles.portfolioValueAmount, { color: colors.dark.blue }]}>
                {formatToman(totalPortfolioUsd * usdtToToman)} تومان
              </Text>
            </View>
          )}
          {totalPortfolioPnl !== null && totalPortfolioPnl !== 0 && (
            <View style={styles.portfolioValueRow}>
              <TrendingUp
                size={14}
                color={totalPortfolioPnl > 0 ? colors.dark.green : colors.dark.red}
              />
              <Text style={styles.portfolioValueLabel}>سود/زیان کل (تقریبی):</Text>
              <Text
                style={[
                  styles.portfolioValueAmount,
                  { color: totalPortfolioPnl > 0 ? colors.dark.green : colors.dark.red },
                ]}
              >
                {totalPortfolioPnl > 0 ? '+' : ''}
                {formatSignedUsd(totalPortfolioPnl)}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.tomanPriceRow}>
          <Text style={styles.tomanPriceLabel}>قیمت تتر</Text>
          <Text style={styles.tomanPriceValue}>
            {usdtToToman > 0 ? `${usdtToToman.toLocaleString('fa-IR')} تومان` : 'در حال دریافت...'}
          </Text>
          {tomanQuery.isFetching && (
            <ActivityIndicator size="small" color={colors.dark.accent} />
          )}
        </View>

        {/* Per-exchange breakdown so the total is traceable */}
        {wallets.length > 0 && (
          <View style={styles.portfolioBreakdown}>
            {wallets.map((w) => {
              const data = balanceByWalletId[w.id];
              return (
                <View key={w.id} style={styles.portfolioBreakdownRow}>
                  <Text style={styles.portfolioBreakdownName}>{w.exchangeName}</Text>
                  <Text style={styles.portfolioBreakdownValue}>
                    {data ? `$${data.totalValueUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—'}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        <Text style={styles.portfolioSub}>
          {wallets.length} صرافی متصل
        </Text>
      </View>

      {wallets.map((wallet, idx) => {
        const isExpanded = expandedWallet === wallet.id;

        return (
          <WalletItem
            key={wallet.id}
            wallet={wallet}
            isExpanded={isExpanded}
            usdtToToman={usdtToToman}
            balanceQuery={balanceQueries[idx]}
            onToggle={() => setExpandedWallet(isExpanded ? null : wallet.id)}
            onRemove={() => handleRemoveWallet(wallet.id, wallet.exchangeName)}
            onRefresh={() => queryClient.invalidateQueries({ queryKey: ['exchange-balance', wallet.id] })}
          />
        );
      })}

      {wallets.length === 0 && !showAddForm && (
        <View style={styles.emptyState}>
          <Wallet size={48} color={colors.dark.textMuted} />
          <Text style={styles.emptyTitle}>صرافی‌ای اضافه نشده</Text>
          <Text style={styles.emptySubtitle}>
            با افزودن API صرافی، موجودی و ارزش دارایی‌های خود را مشاهده کنید
          </Text>
        </View>
      )}

      {showAddForm ? (
        <View style={styles.addForm}>
          <Text style={styles.addFormTitle}>افزودن صرافی جدید</Text>

          <Text style={styles.inputLabel}>انتخاب صرافی</Text>
          <DropdownPicker
            label="صرافی"
            value={selectedExchange}
            options={exchangeOptions}
            onSelect={(key) => setSelectedExchange(key as ExchangeId)}
            testID="wallet-exchange-dropdown"
          />

          <View style={styles.spacer} />
          <Text style={styles.inputLabel}>API Key</Text>
          <TextInput
            style={styles.input}
            value={newApiKey}
            onChangeText={setNewApiKey}
            placeholder="API Key را وارد کنید"
            placeholderTextColor={colors.dark.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            testID="wallet-api-key-input"
          />

          <Text style={styles.inputLabel}>API Secret</Text>
          <View style={styles.secretRow}>
            <TextInput
              style={[styles.input, styles.secretInput]}
              value={newApiSecret}
              onChangeText={setNewApiSecret}
              placeholder="API Secret را وارد کنید"
              placeholderTextColor={colors.dark.textMuted}
              secureTextEntry={!showSecrets}
              autoCapitalize="none"
              autoCorrect={false}
              testID="wallet-api-secret-input"
            />
            <Pressable
              style={styles.eyeBtn}
              onPress={() => setShowSecrets(!showSecrets)}
            >
              {showSecrets ? (
                <EyeOff size={18} color={colors.dark.textMuted} />
              ) : (
                <Eye size={18} color={colors.dark.textMuted} />
              )}
            </Pressable>
          </View>

          {needsPassphrase && (
            <>
              <Text style={styles.inputLabel}>Passphrase</Text>
              <TextInput
                style={styles.input}
                value={newPassphrase}
                onChangeText={setNewPassphrase}
                placeholder="Passphrase را وارد کنید"
                placeholderTextColor={colors.dark.textMuted}
                secureTextEntry={!showSecrets}
                autoCapitalize="none"
                autoCorrect={false}
                testID="wallet-passphrase-input"
              />
            </>
          )}

          <View style={styles.infoBox}>
            <Text style={styles.infoIcon}>ℹ️</Text>
            <Text style={styles.infoText}>
              فقط از API با دسترسی Read-Only استفاده کنید. اطلاعات به صورت محلی ذخیره می‌شوند.
            </Text>
          </View>

          <View style={styles.formActions}>
            <Pressable
              style={[styles.formBtn, styles.formBtnSave]}
              onPress={handleAddWallet}
            >
              <Save size={16} color={colors.dark.background} />
              <Text style={styles.formBtnSaveText}>ذخیره</Text>
            </Pressable>
            <Pressable
              style={[styles.formBtn, styles.formBtnCancel]}
              onPress={() => {
                setShowAddForm(false);
                setNewApiKey('');
                setNewApiSecret('');
                setNewPassphrase('');
              }}
            >
              <Text style={styles.formBtnCancelText}>لغو</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          style={styles.addButton}
          onPress={() => setShowAddForm(true)}
          testID="add-wallet-button"
        >
          <Plus size={18} color={colors.dark.accent} />
          <Text style={styles.addButtonText}>افزودن صرافی جدید</Text>
        </Pressable>
      )}

      <View style={styles.disclaimer}>
        <Text style={styles.disclaimerText}>
          ⚠️ اطلاعات API به صورت محلی ذخیره می‌شوند و به هیچ سروری ارسال نمی‌شوند.
        </Text>
      </View>
    </ScrollView>
  );
}

interface WalletItemProps {
  wallet: ExchangeWallet;
  isExpanded: boolean;
  usdtToToman: number;
  balanceQuery: ReturnType<typeof useQuery<ExchangeBalanceData>>;
  onToggle: () => void;
  onRemove: () => void;
  onRefresh: () => void;
}

function WalletItem({ wallet, isExpanded, usdtToToman, balanceQuery, onToggle, onRemove, onRefresh }: WalletItemProps) {
  const data = balanceQuery.data;
  const isLoading = balanceQuery.isLoading;
  const hasError = !!balanceQuery.error;

  // Group balances by account section (اسپات / Earn / فاندینگ / فیوچرز / آلفا)
  const grouped = useMemo(() => {
    if (!data) return [];
    const order: WalletSection[] = ['spot', 'earn', 'funding', 'futures', 'alpha'];
    const groups: Array<{ section: WalletSection; items: WalletBalance[]; totalUsd: number; pnlUsd: number }> = [];
    for (const section of order) {
      const items = data.balances.filter((b) => (b.section ?? 'spot') === section);
      if (items.length === 0) continue;
      const totalUsd = items.reduce((sum, b) => sum + b.valueUsd, 0);
      const pnlUsd = items.reduce((sum, b) => sum + (b.pnlUsd ?? 0), 0);
      groups.push({ section, items, totalUsd, pnlUsd });
    }
    return groups;
  }, [data]);

  return (
    <View style={styles.walletCard}>
      <Pressable style={styles.walletHeader} onPress={onToggle}>
        <View style={styles.walletLeft}>
          <View style={styles.walletIcon}>
            <Key size={18} color={colors.dark.blue} />
          </View>
          <View style={styles.walletInfo}>
            <Text style={styles.walletName}>{wallet.exchangeName}</Text>
            <Text style={styles.walletKey}>
              {wallet.apiKey.slice(0, 8)}...{wallet.apiKey.slice(-4)}
            </Text>
          </View>
        </View>
        <View style={styles.walletRight}>
          <Text style={styles.walletTotal}>
            ${(data?.totalValueUsd ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
          </Text>
          {data?.totalPnlUsd !== undefined && data.totalPnlUsd !== 0 && (
            <Text
              style={[
                styles.walletPnl,
                { color: data.totalPnlUsd > 0 ? colors.dark.green : colors.dark.red },
              ]}
            >
              {data.totalPnlUsd > 0 ? '▲' : '▼'} {formatSignedUsd(data.totalPnlUsd)}
            </Text>
          )}
          {usdtToToman > 0 && data?.totalValueUsd !== undefined && (
            <Text style={styles.walletToman}>
              ≈ {formatToman((data.totalValueUsd ?? 0) * usdtToToman)} تومان
            </Text>
          )}
          <View style={styles.walletActions}>
            <Pressable style={styles.actionBtn} onPress={onRefresh}>
              <RefreshCw size={14} color={colors.dark.accent} />
            </Pressable>
            <Pressable style={styles.actionBtn} onPress={onRemove}>
              <Trash2 size={14} color={colors.dark.red} />
            </Pressable>
            {isExpanded ? (
              <ChevronUp size={16} color={colors.dark.textMuted} />
            ) : (
              <ChevronDown size={16} color={colors.dark.textMuted} />
            )}
          </View>
        </View>
      </Pressable>

      {isExpanded && (
        <View style={styles.walletExpanded}>
          {isLoading && (
            <View style={styles.balanceLoading}>
              <ActivityIndicator size="small" color={colors.dark.accent} />
              <Text style={styles.balanceLoadingText}>دریافت موجودی...</Text>
            </View>
          )}

          {hasError && (
            <View style={styles.balanceError}>
              <ShieldAlert size={14} color={colors.dark.red} />
              <Text style={styles.balanceErrorText}>خطا در دریافت موجودی — مطمئن شوید API معتبر است</Text>
            </View>
          )}

          {data && data.balances.length > 0 && (
            <View style={styles.balanceList}>
              {grouped.map((group) => (
                <View key={group.section} style={styles.sectionBlock}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>{SECTION_LABEL[group.section]}</Text>
                    <Text style={styles.sectionTotal}>
                      ${group.totalUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                      {group.pnlUsd !== 0 && (
                        <Text
                          style={[
                            styles.sectionPnl,
                            { color: group.pnlUsd > 0 ? colors.dark.green : colors.dark.red },
                          ]}
                        >
                          {'  '}{formatSignedUsd(group.pnlUsd)}
                        </Text>
                      )}
                    </Text>
                  </View>
                  {group.items.map((bal) => (
                    <View key={`${group.section}-${bal.asset}`} style={styles.balanceRow}>
                      <View style={styles.balanceLeft}>
                        <View style={styles.assetBadge}>
                          <Text style={styles.assetBadgeText}>{bal.asset.slice(0, 3)}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.assetName}>{bal.asset}</Text>
                          <Text style={styles.assetAmount}>
                            {bal.free.toFixed(4)}{bal.locked > 0 ? ` (+${bal.locked.toFixed(4)} قفل)` : ''}
                          </Text>
                          {bal.avgCost !== undefined && bal.avgCost > 0 && (
                            <Text style={styles.assetAvg}>
                              میانگین خرید: ${bal.avgCost < 1 ? bal.avgCost.toPrecision(4) : bal.avgCost.toFixed(2)}
                            </Text>
                          )}
                        </View>
                      </View>
                      <View style={styles.balanceRight}>
                        <Text style={styles.balanceValue}>
                          ≈ ${bal.valueUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                        </Text>
                        {bal.pnlUsd !== undefined && bal.pnlUsd !== 0 && (
                          <Text
                            style={[
                              styles.balancePnl,
                              { color: bal.pnlUsd > 0 ? colors.dark.green : colors.dark.red },
                            ]}
                          >
                            {formatSignedUsd(bal.pnlUsd)}
                            {bal.pnlPercent !== undefined &&
                              ` (${bal.pnlPercent > 0 ? '+' : ''}${bal.pnlPercent.toFixed(1)}%)`}
                          </Text>
                        )}
                        {usdtToToman > 0 && bal.valueUsd > 0 && (
                          <Text style={styles.balanceToman}>
                            ≈ {formatToman(bal.valueUsd * usdtToToman)} ت
                          </Text>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              ))}

              {/* Open futures positions with unrealized PnL */}
              {data.futuresPositions && data.futuresPositions.length > 0 && (
                <View style={styles.sectionBlock}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>پوزیشن‌های باز فیوچرز</Text>
                    {data.futuresUnrealizedPnl !== undefined && (
                      <Text
                        style={[
                          styles.sectionTotal,
                          {
                            color:
                              data.futuresUnrealizedPnl > 0 ? colors.dark.green : colors.dark.red,
                          },
                        ]}
                      >
                        uPnL: {formatSignedUsd(data.futuresUnrealizedPnl)}
                      </Text>
                    )}
                  </View>
                  {data.futuresPositions.map((pos) => (
                    <View
                      key={`${pos.symbol}-${pos.positionSide}`}
                      style={styles.positionRow}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.positionSymbol}>
                          {pos.symbol.replace('USDT', '/USDT')}{' '}
                          <Text
                            style={{
                              color:
                                pos.positionSide === 'SHORT' || pos.unrealizedPnl < 0
                                  ? colors.dark.red
                                  : colors.dark.green,
                            }}
                          >
                            {pos.positionSide === 'BOTH' ? '' : pos.positionSide} {pos.leverage}x
                          </Text>
                        </Text>
                        <Text style={styles.positionDetail}>
                          ورود: ${pos.entryPrice < 1 ? pos.entryPrice.toPrecision(4) : pos.entryPrice.toFixed(2)} → قیمت: ${pos.markPrice < 1 ? pos.markPrice.toPrecision(4) : pos.markPrice.toFixed(2)}
                        </Text>
                        <Text style={styles.positionDetail}>
                          ارزش پوزیشن: ${pos.notionalUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                        </Text>
                      </View>
                      <View style={styles.positionRight}>
                        <Text
                          style={[
                            styles.positionPnl,
                            {
                              color:
                                pos.unrealizedPnl > 0 ? colors.dark.green : colors.dark.red,
                            },
                          ]}
                        >
                          {formatSignedUsd(pos.unrealizedPnl)}
                        </Text>
                        <Text
                          style={[
                            styles.positionRoe,
                            {
                              color: pos.roePercent > 0 ? colors.dark.green : colors.dark.red,
                            },
                          ]}
                        >
                          ROE: {pos.roePercent > 0 ? '+' : ''}
                          {pos.roePercent.toFixed(2)}%
                        </Text>
                      </View>
                    </View>
                  ))}
                  {data.futuresRealizedPnl !== undefined && (
                    <Text style={styles.futuresRealized}>
                      سود/زیان محقق‌شده فیوچرز: {formatSignedUsd(data.futuresRealizedPnl)}
                    </Text>
                  )}
                </View>
              )}

              {/* Total exchange PnL */}
              {data.totalPnlUsd !== undefined && (
                <View style={styles.walletPnlRow}>
                  <Text style={styles.walletPnlLabel}>سود/زیان کل این صرافی (تقریبی)</Text>
                  <Text
                    style={[
                      styles.walletPnlValue,
                      {
                        color:
                          data.totalPnlUsd > 0 ? colors.dark.green : colors.dark.red,
                      },
                    ]}
                  >
                    {formatSignedUsd(data.totalPnlUsd)}
                  </Text>
                </View>
              )}
              {data.pnlNote && <Text style={styles.pnlNote}>{data.pnlNote}</Text>}
            </View>
          )}

          {data && data.balances.length === 0 && !isLoading && (
            <Text style={styles.noBalance}>موجودی‌ای یافت نشد</Text>
          )}

          {data?.lastUpdated && (
            <Text style={styles.lastUpdate}>
              آخرین بروزرسانی: {new Date(data.lastUpdated).toLocaleTimeString('fa-IR')}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = createThemedStyles(() => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.background,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
  },
  portfolioCard: {
    backgroundColor: colors.dark.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.dark.accent + '33',
  },
  portfolioHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  portfolioTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: colors.dark.textSecondary,
    flex: 1,
    textAlign: 'right',
  },
  refreshAllBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: colors.dark.accentDim,
  },
  portfolioValues: {
    gap: 8,
    marginBottom: 10,
  },
  portfolioValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.dark.card,
    padding: 10,
    borderRadius: 10,
  },
  portfolioValueLabel: {
    fontSize: 12,
    color: colors.dark.textSecondary,
  },
  portfolioValueAmount: {
    flex: 1,
    textAlign: 'left',
    fontSize: 15,
    fontWeight: '700' as const,
    color: colors.dark.green,
  },
  tomanPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 10,
    paddingTop: 12,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderTopColor: colors.dark.border,
  },
  tomanPriceLabel: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: colors.dark.textSecondary,
  },
  tomanPriceValue: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: colors.dark.accent,
    letterSpacing: 0.3,
  },
  portfolioSub: {
    fontSize: 12,
    color: colors.dark.textMuted,
    textAlign: 'center',
    marginTop: 6,
  },
  portfolioBreakdown: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.dark.border,
    gap: 4,
  },
  portfolioBreakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  portfolioBreakdownName: {
    fontSize: 12,
    color: colors.dark.textSecondary,
  },
  portfolioBreakdownValue: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: colors.dark.text,
  },
  walletCard: {
    backgroundColor: colors.dark.surface,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.dark.border,
    overflow: 'hidden',
  },
  walletHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  walletLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  walletIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.dark.blueDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletInfo: {
    flex: 1,
  },
  walletName: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: colors.dark.text,
    textAlign: 'right',
  },
  walletKey: {
    fontSize: 10,
    color: colors.dark.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: 2,
  },
  walletRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  walletTotal: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  walletToman: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: colors.dark.blue,
  },
  walletActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionBtn: {
    padding: 4,
  },
  walletExpanded: {
    borderTopWidth: 1,
    borderTopColor: colors.dark.border,
    padding: 14,
  },
  balanceLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 20,
  },
  balanceLoadingText: {
    fontSize: 13,
    color: colors.dark.textSecondary,
  },
  balanceError: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  balanceErrorText: {
    fontSize: 13,
    color: colors.dark.red,
    flex: 1,
    textAlign: 'right',
  },
  balanceList: {
    gap: 8,
  },
  sectionBlock: {
    gap: 6,
    marginBottom: 6,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.dark.surface,
    borderWidth: 1,
    borderColor: colors.dark.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800' as const,
    color: colors.dark.accent,
  },
  sectionTotal: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: colors.dark.textSecondary,
  },
  sectionPnl: {
    fontSize: 11,
    fontWeight: '800' as const,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.dark.card,
    padding: 12,
    borderRadius: 10,
  },
  balanceLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  assetBadge: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.dark.blueDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assetBadgeText: {
    fontSize: 11,
    fontWeight: '800' as const,
    color: colors.dark.text,
  },
  assetName: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  assetAmount: {
    fontSize: 10,
    color: colors.dark.textMuted,
    marginTop: 2,
  },
  assetAvg: {
    fontSize: 9,
    color: colors.dark.textMuted,
    marginTop: 1,
  },
  balanceRight: {
    alignItems: 'flex-end',
  },
  balanceTotal: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  balanceValue: {
    fontSize: 10,
    color: colors.dark.textSecondary,
    marginTop: 2,
  },
  balancePnl: {
    fontSize: 11,
    fontWeight: '800' as const,
    marginTop: 2,
  },
  balanceToman: {
    fontSize: 10,
    color: colors.dark.blue,
    marginTop: 1,
  },
  positionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.dark.card,
    padding: 12,
    borderRadius: 10,
  },
  positionSymbol: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: colors.dark.text,
  },
  positionDetail: {
    fontSize: 10,
    color: colors.dark.textMuted,
    marginTop: 2,
  },
  positionRight: {
    alignItems: 'flex-end',
  },
  positionPnl: {
    fontSize: 13,
    fontWeight: '800' as const,
  },
  positionRoe: {
    fontSize: 10,
    fontWeight: '700' as const,
    marginTop: 2,
  },
  futuresRealized: {
    fontSize: 10,
    color: colors.dark.textSecondary,
    textAlign: 'right',
    marginTop: 2,
  },
  walletPnlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.dark.surface,
    borderWidth: 1,
    borderColor: colors.dark.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 4,
  },
  walletPnlLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: colors.dark.textSecondary,
    flex: 1,
    textAlign: 'right',
  },
  walletPnlValue: {
    fontSize: 14,
    fontWeight: '800' as const,
  },
  walletPnl: {
    fontSize: 12,
    fontWeight: '800' as const,
    marginTop: 2,
  },
  pnlNote: {
    fontSize: 9,
    color: colors.dark.textMuted,
    textAlign: 'center',
    marginTop: 6,
  },
  noBalance: {
    fontSize: 13,
    color: colors.dark.textMuted,
    textAlign: 'center',
    paddingVertical: 20,
  },
  lastUpdate: {
    fontSize: 10,
    color: colors.dark.textMuted,
    textAlign: 'center',
    marginTop: 10,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  emptySubtitle: {
    fontSize: 13,
    color: colors.dark.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 30,
  },
  addForm: {
    backgroundColor: colors.dark.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.dark.blue + '44',
  },
  addFormTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: colors.dark.blue,
    textAlign: 'right',
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 12,
    color: colors.dark.textSecondary,
    marginBottom: 6,
    textAlign: 'right',
  },
  input: {
    backgroundColor: colors.dark.inputBg,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.dark.text,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.dark.border,
    textAlign: 'right',
  },
  secretRow: {
    position: 'relative' as const,
  },
  secretInput: {
    paddingRight: 48,
  },
  eyeBtn: {
    position: 'absolute' as const,
    right: 12,
    top: 12,
    padding: 2,
  },
  spacer: {
    height: 8,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.dark.blueDim,
    borderRadius: 10,
    padding: 12,
    gap: 8,
    marginBottom: 14,
  },
  infoIcon: {
    fontSize: 12,
  },
  infoText: {
    fontSize: 12,
    color: colors.dark.blue,
    flex: 1,
    lineHeight: 20,
    textAlign: 'right',
  },
  formActions: {
    flexDirection: 'row',
    gap: 10,
  },
  formBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 6,
  },
  formBtnSave: {
    backgroundColor: colors.dark.green,
  },
  formBtnSaveText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: colors.dark.background,
  },
  formBtnCancel: {
    backgroundColor: colors.dark.surfaceLight,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  formBtnCancelText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: colors.dark.textSecondary,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.dark.accent + '44',
    borderStyle: 'dashed',
    gap: 8,
    marginBottom: 16,
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: colors.dark.accent,
  },
  disclaimer: {
    backgroundColor: colors.dark.orangeDim,
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
  },
  disclaimerText: {
    fontSize: 12,
    color: colors.dark.orange,
    textAlign: 'right',
    lineHeight: 20,
  },
}));
