/**
 * utils/exchangeFutures.ts — v1.5.22
 *
 * لایه آداپتور فیوچرز چندصرافی برای ربات بک‌تست (حالت واقعی).
 *
 *   • تا v1.5.18 اجرای واقعی ربات فقط روی فیوچرز بایننس بود.
 *   • v1.5.19 — بایننس + بای‌بیت.
 *   • v1.5.20 — بیتیونیکس، توبیت، بینگ‌ایکس، OKX و بیتگت.
 *   • v1.5.21 — مکسی، گیت، کوکوین (جمعاً ۱۰ صرافی).
 *   • v1.5.22 — «همهٔ پوزیشن‌های واقعی حتماً ایزوله»: OKX از کراس به
 *     isolated، مکسی openType از ۲ (کراس) به ۱ (ایزوله)، گیت فقط leverage
 *     مثبت (= ایزوله) بدون cross_leverage_limit، و بای‌بیت/توبیت/بینگ‌ایکس
 *     قبل از سفارش marginType/switch-isolated صریح می‌زنند (بایننس و بیتگت
 *     از قبل ایزوله‌اند). + متد getFuturesBalance (موجودی کیف فیوچرز برای
 *     نمایش در PnL واقعی) + صرافی یازدهم: اوربیت (Ourbit — فیوچرزش
 *     هم‌راستای API مکسی است؛ امضا با هدرهای ApiKey/Request-Time/Signature).
 *   • بقیه صرافی‌ها (آل‌بانک=LBank و KCEX) — API معاملاتی عمومی ندارند؛
 *     اجرای ربات رویشان ممکن نیست (نامشان در UI نمی‌آید).
 *
 * کلیدها همیشه روی دستگاه می‌مانند (هرگز به هیچ سروری نمی‌روند).
 */

import { Platform } from 'react-native';
import CryptoJS from 'crypto-js';
import type { ExchangeId } from '@/types/crypto';
import {
  setLeverage as binanceSetLeverage,
  openRealPosition as binanceOpenRealPosition,
  closePosition as binanceClosePosition,
  closePartialPosition as binanceClosePartialPosition,
  getPositions as binanceGetPositions,
  updateStopLoss as binanceUpdateStopLoss,
  updateTakeProfit as binanceUpdateTakeProfit,
  getFuturesBalance as binanceGetFuturesBalance,
} from './binanceFuturesTrading';

/** کلیدهای صرافی (KuCoin/OKX به passphrase هم نیاز دارند — برای آینده). */
export interface ExchangeKeys {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
}

/** نتیجه باز کردن پوزیشن مارکت (qty واقعی که صرافی ثبت کرد). */
export interface OpenMarketResult {
  qty: number;
}

/** ردیف پوزیشن زندهٔ صرافی — هم‌شکلِ خروجی getPositions بایننس تا موتور
 *  بدون تغییر کار کند (symbol با پسوند USDT، positionAmt علامت‌دار، markPrice). */
export interface LivePositionRow {
  symbol: string;
  positionAmt: string;
  markPrice: string;
  entryPrice: string;
}

export interface FuturesAdapter {
  id: ExchangeId;
  /** آیا اجرای ربات روی این صرافی پیاده‌سازی شده؟ */
  executable: boolean;
  /** نقشهٔ قیمت همهٔ نمادها ("BTCUSDT" → قیمت) برای MTM. */
  priceMap(maxAgeMs?: number): Promise<Record<string, number>>;
  setLeverage(keys: ExchangeKeys, symbol: string, leverage: number): Promise<void>;
  /** سفارش مارکت با SL/TP (واقعی) — qty داخلی محاسبه می‌شود. */
  openMarket(
    keys: ExchangeKeys,
    symbol: string,
    side: 'long' | 'short',
    sizeUsd: number,
    leverage: number,
    stopPrice: number,
    takePrice: number
  ): Promise<OpenMarketResult>;
  /** پوزیشن‌های باز زندهٔ صرافی. */
  listPositions(keys: ExchangeKeys): Promise<LivePositionRow[]>;
  /** بستن کامل پوزیشن (reduce-only). */
  closeAll(keys: ExchangeKeys, symbol: string, side: 'long' | 'short'): Promise<void>;
  /** بستن کسری از حجم (۰ تا ۱) — reduce-only. */
  closePartial(keys: ExchangeKeys, symbol: string, side: 'long' | 'short', fraction: number): Promise<void>;
  /** به‌روزرسانی SL/TP روی پوزیشن باز — trailing فقط SL جابه‌جا می‌کند
   *  (updateTake=false) تا TP بی‌دلیل لغو/بازنویسی نشود؛ ویرایش دستی هر دو. */
  updateTradingStop(
    keys: ExchangeKeys,
    symbol: string,
    side: 'long' | 'short',
    stopPrice: number,
    takePrice: number,
    qty: number,
    updateTake?: boolean
  ): Promise<void>;
  /** v1.5.22 — موجودی کیف فیوچرز صرافی (USDT) برای نمایش در PnL واقعی؛
   *  fail-soft: اگر صرافی ندهد null برمی‌گردد (UI چیزی نشان نمی‌دهد). */
  getFuturesBalance(keys: ExchangeKeys): Promise<{ available: number; equity: number } | null>;
}

// ---------------------------------------------------------------------------
// BINANCE — همان مسیر قبلی (binanceFuturesTrading.ts)
// ---------------------------------------------------------------------------

const binanceAdapter: FuturesAdapter = {
  id: 'binance',
  executable: true,
  async priceMap() {
    const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/price');
    if (!res.ok) throw new Error(`Binance ticker ${res.status}`);
    const arr = (await res.json()) as { symbol: string; price: string }[];
    const map: Record<string, number> = {};
    for (const t of arr) map[t.symbol] = parseFloat(t.price);
    return map;
  },
  async getFuturesBalance(keys) {
    return binanceGetFuturesBalance(keys.apiKey, keys.apiSecret);
  },
  async setLeverage(keys, symbol, leverage) {
    await binanceSetLeverage(keys.apiKey, keys.apiSecret, symbol, leverage);
  },
  async openMarket(keys, symbol, side, sizeUsd, leverage, stopPrice, takePrice) {
    // openRealPosition بایننس خودش قیمت/دقت/لوریج/ایزوله را مدیریت می‌کند و
    // {order, slOrder, tpOrder} برمی‌گرداند (نه qty) — qty مثل موتور از
    // حجم×لوریج÷قیمت تخمین زده می‌شود.
    const res = await binanceOpenRealPosition(
      keys.apiKey,
      keys.apiSecret,
      symbol,
      side,
      sizeUsd,
      leverage,
      stopPrice,
      takePrice
    );
    const fillPrice = parseFloat(res?.order?.avgPrice ?? '0') || (stopPrice > 0 ? stopPrice : takePrice);
    const qty = fillPrice > 0 ? (sizeUsd * leverage) / fillPrice : 0;
    return { qty };
  },
  async listPositions(keys) {
    return binanceGetPositions(keys.apiKey, keys.apiSecret);
  },
  async closeAll(keys, symbol, side) {
    // closePosition بایننس positionAmt علامت‌دار می‌گیرد: لانگ +، شورت −
    await binanceClosePosition(keys.apiKey, keys.apiSecret, symbol, side === 'long' ? 1 : -1);
  },
  async closePartial(keys, symbol, side, fraction) {
    // closePartialPosition بایننس (side، qty مطلق) می‌گیرد — اندازهٔ فعلی را
    // از پوزیشن‌های زنده می‌خوانیم.
    const rows = await binanceGetPositions(keys.apiKey, keys.apiSecret);
    const row = rows.find((r) => r.symbol === symbol && parseFloat(r.positionAmt) !== 0);
    if (!row) return;
    const size = Math.abs(parseFloat(row.positionAmt));
    const qty = size * Math.min(1, Math.max(0, fraction));
    if (!(qty > 0)) return;
    await binanceClosePartialPosition(keys.apiKey, keys.apiSecret, symbol, side, qty);
  },
  async updateTradingStop(keys, symbol, side, stopPrice, takePrice, qty, updateTake) {
    await binanceUpdateStopLoss(keys.apiKey, keys.apiSecret, symbol, side, qty > 0 ? qty : 1, stopPrice);
    // فقط ویرایش دستی TP را بازنویسی می‌کند (تریلینگ = SL فقط)
    if (updateTake && takePrice > 0) {
      await binanceUpdateTakeProfit(keys.apiKey, keys.apiSecret, symbol, side, qty > 0 ? qty : 1, takePrice);
    }
  },
};

// ---------------------------------------------------------------------------
// BYBIT V5 — پیاده‌سازی کامل اجرا (linear USDT perpetual)
// ---------------------------------------------------------------------------

const BYBIT_BASE = 'https://api.bybit.com';
const BYBIT_RECV_WINDOW = '10000';

/** کش دقت/گام نمادهای بای‌بیت (qtyPrecision + priceScale) — ۱ ساعت. */
let bybitInstrCache: { at: number; map: Record<string, { qtyStep: number; priceStep: number; minQty: number }> } | null = null;

function roundToStep(v: number, step: number): number {
  if (!(step > 0)) return v;
  const s = parseFloat(step.toPrecision(6));
  const r = Math.floor(v / s) * s;
  return parseFloat(r.toFixed(8));
}

async function bybitGet(path: string, query?: Record<string, string>): Promise<any> {
  const qs = query ? '?' + new URLSearchParams(query).toString() : '';
  const res = await fetch(`${BYBIT_BASE}${path}${qs}`);
  if (!res.ok) throw new Error(`Bybit ${path} ${res.status}`);
  const data = (await res.json()) as { retCode: number; retMsg: string; result?: any };
  if (data.retCode !== 0) throw new Error(`Bybit: ${data.retMsg}`);
  return data.result;
}

/** درخواست امضاشدهٔ خصوصی V5 — HMAC-SHA256(timestamp+key+recvWindow+body). */
async function bybitPost(keys: ExchangeKeys, path: string, body: Record<string, unknown>): Promise<any> {
  const timestamp = Date.now().toString();
  const payload = JSON.stringify(body);
  const signSrc = `${timestamp}${keys.apiKey}${BYBIT_RECV_WINDOW}${payload}`;
  const sign = hmacSha256Hex(keys.apiSecret, signSrc);
  const res = await fetch(`${BYBIT_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-BAPI-API-KEY': keys.apiKey,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': BYBIT_RECV_WINDOW,
      'X-BAPI-SIGN': sign,
    },
    body: payload,
  });
  if (!res.ok) throw new Error(`Bybit ${path} ${res.status}`);
  const data = (await res.json()) as { retCode: number; retMsg: string; result?: any };
  if (data.retCode !== 0) throw new Error(`Bybit: ${data.retMsg}`);
  return data.result;
}

function hmacSha256Hex(secret: string, message: string): string {
  // همان الگوی امضای بایننس پروژه (crypto-js — روی Hermes/اندروید آزموده‌شده)
  return CryptoJS.HmacSHA256(message, secret).toString(CryptoJS.enc.Hex);
}

function sha256Hex(message: string): string {
  return CryptoJS.SHA256(message).toString(CryptoJS.enc.Hex);
}

function hmacSha256B64(secret: string, message: string): string {
  return CryptoJS.HmacSHA256(message, secret).toString(CryptoJS.enc.Base64);
}

/** فرم x-www-form-urlencoded با مقادیر انکدشده (توبیت/بینگ‌ایکس). */
function formUrlencode(params: Record<string, string | number | boolean>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.join('&');
}

function randomHex(len: number): string {
  let s = '';
  while (s.length < len) s += Math.random().toString(16).slice(2);
  return s.slice(0, len);
}

/** خواب کوتاه بین تلاش‌های مجدد (مثل پیدا شدن پوزیشن بعد از سفارش). */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function bybitInstruments(): Promise<Record<string, { qtyStep: number; priceStep: number; minQty: number }>> {
  if (bybitInstrCache && Date.now() - bybitInstrCache.at < 3_600_000) return bybitInstrCache.map;
  const result = await bybitGet('/v5/market/instruments-info', { category: 'linear', limit: '1000' });
  const map: Record<string, { qtyStep: number; priceStep: number; minQty: number }> = {};
  for (const ins of result?.list ?? []) {
    const f = ins.lotSizeFilter ?? {};
    map[ins.symbol] = {
      qtyStep: parseFloat(f.qtyStep ?? '0.001') || 0.001,
      priceStep: parseFloat(ins.priceScale ? Math.pow(10, -Number(ins.priceScale)).toPrecision(8) : '0.01') || 0.01,
      minQty: parseFloat(f.minOrderQty ?? '0.001') || 0.001,
    };
  }
  if (Object.keys(map).length > 0) bybitInstrCache = { at: Date.now(), map };
  return map;
}

const bybitAdapter: FuturesAdapter = {
  id: 'bybit',
  executable: true,
  async priceMap() {
    const result = await bybitGet('/v5/market/tickers', { category: 'linear' });
    const map: Record<string, number> = {};
    for (const t of result?.list ?? []) map[t.symbol] = parseFloat(t.lastPrice);
    return map;
  },
  async setLeverage(keys, symbol, leverage) {
    const lev = String(leverage);
    // v1.5.22 — «همهٔ پوزیشن‌های واقعی ایزوله»: قبل از سفارش، مارجین نماد
    // صریحاً روی ایزوله می‌رود (tradeMode:1). اگر همین باشد صرافی خطای
    // غیرمرگبار می‌دهد → catch-soft.
    await bybitPost(keys, '/v5/position/switch-isolated', {
      category: 'linear',
      symbol,
      tradeMode: 1,
      buyLeverage: lev,
      sellLeverage: lev,
    }).catch(() => {});
    await bybitPost(keys, '/v5/position/set-leverage', {
      category: 'linear',
      symbol,
      buyLeverage: lev,
      sellLeverage: lev,
      leverage: lev,
    });
  },
  async getFuturesBalance(keys) {
    const result = await bybitGet('/v5/account/wallet-balance', { accountType: 'UNIFIED', coin: 'USDT' });
    const list = result?.list?.[0];
    const coin = list?.coin?.find((c: any) => c.coin === 'USDT') ?? list?.coin?.[0];
    const equity = parseFloat(coin?.walletBalance ?? list?.totalWalletBalance ?? '0');
    const available = parseFloat(coin?.availableToWithdraw ?? list?.totalAvailableBalance ?? '0');
    if (!Number.isFinite(equity) && !Number.isFinite(available)) return null;
    return { available: Number.isFinite(available) ? available : 0, equity: Number.isFinite(equity) ? equity : 0 };
  },
  async openMarket(keys, symbol, side, sizeUsd, leverage, stopPrice, takePrice) {
    const price = stopPrice > 0 ? stopPrice : takePrice;
    const tickers = await bybitAdapter.priceMap().catch(() => ({} as Record<string, number>));
    const last = tickers[symbol] ?? price;
    if (!(last > 0)) throw new Error('Bybit: قیمت نماد در دسترس نیست');
    const instr = (await bybitInstruments())[symbol];
    await bybitAdapter.setLeverage(keys, symbol, leverage).catch(() => {
      // اگر لوریج همان قبلی باشد صرافی خطای 110043 می‌دهد — غیرمرگبار
    });
    const rawQty = (sizeUsd * leverage) / last;
    const qty = roundToStep(Math.max(rawQty, instr?.minQty ?? 0), instr?.qtyStep ?? 0.001);
    if (!(qty > 0)) throw new Error('Bybit: حجم محاسبه‌شده نامعتبر است');
    await bybitPost(keys, '/v5/order/create', {
      category: 'linear',
      symbol,
      side: side === 'long' ? 'Buy' : 'Sell',
      orderType: 'Market',
      qty: String(qty),
      timeInForce: 'IOC',
      positionIdx: 0,
      stopLoss: stopPrice > 0 ? String(roundToStep(stopPrice, instr?.priceStep ?? 0.01)) : undefined,
      takeProfit: takePrice > 0 ? String(roundToStep(takePrice, instr?.priceStep ?? 0.01)) : undefined,
    });
    return { qty };
  },
  async listPositions(keys) {
    const result = await bybitGet('/v5/position/list', { category: 'linear', limit: '200' });
    const rows: LivePositionRow[] = [];
    for (const p of result?.list ?? []) {
      const size = parseFloat(p.size ?? '0');
      if (!(size > 0)) continue;
      rows.push({
        symbol: p.symbol,
        // علامت‌دار مثل بایننس: لانگ +، شورت −
        positionAmt: p.side === 'Sell' ? String(-size) : String(size),
        markPrice: String(p.markPrice ?? p.avgPrice ?? '0'),
        entryPrice: String(p.avgPrice ?? '0'),
      });
    }
    return rows;
  },
  async closeAll(keys, symbol, side) {
    const instr = (await bybitInstruments())[symbol];
    const result = await bybitGet('/v5/position/list', { category: 'linear', symbol });
    const p = (result?.list ?? []).find((x: any) => x.symbol === symbol && parseFloat(x.size) > 0);
    if (!p) return;
    const size = parseFloat(p.size);
    const qty = roundToStep(size, instr?.qtyStep ?? 0.001);
    await bybitPost(keys, '/v5/order/create', {
      category: 'linear',
      symbol,
      side: p.side === 'Buy' ? 'Sell' : 'Buy',
      orderType: 'Market',
      qty: String(qty),
      timeInForce: 'IOC',
      positionIdx: 0,
      reduceOnly: true,
    });
  },
  async closePartial(keys, symbol, side, fraction) {
    const instr = (await bybitInstruments())[symbol];
    const result = await bybitGet('/v5/position/list', { category: 'linear', symbol });
    const p = (result?.list ?? []).find((x: any) => x.symbol === symbol && parseFloat(x.size) > 0);
    if (!p) return;
    const size = parseFloat(p.size) * Math.min(1, Math.max(0, fraction));
    const qty = roundToStep(size, instr?.qtyStep ?? 0.001);
    if (!(qty > 0)) return;
    await bybitPost(keys, '/v5/order/create', {
      category: 'linear',
      symbol,
      side: p.side === 'Buy' ? 'Sell' : 'Buy',
      orderType: 'Market',
      qty: String(qty),
      timeInForce: 'IOC',
      positionIdx: 0,
      reduceOnly: true,
    });
  },
  async updateTradingStop(keys, symbol, side, stopPrice, takePrice, _qty, updateTake) {
    const instr = (await bybitInstruments())[symbol];
    const body: Record<string, unknown> = { category: 'linear', symbol, positionIdx: 0 };
    if (stopPrice > 0) body.stopLoss = String(roundToStep(stopPrice, instr?.priceStep ?? 0.01));
    // بای‌بیت partial-update است: فیلدهای فرستاده‌شده عوض می‌شوند، بقیه می‌مانند
    if (updateTake && takePrice > 0) body.takeProfit = String(roundToStep(takePrice, instr?.priceStep ?? 0.01));
    await bybitPost(keys, '/v5/position/trading-stop', body);
  },
};

// ---------------------------------------------------------------------------
// BITUNIX (fapi.bitunix.com) — امضای دوبل SHA256 + nonce (تأییدشده با SDK رسمی‌گونه)
// ---------------------------------------------------------------------------

const BITUNIX_BASE = 'https://fapi.bitunix.com';

/** کش دقت نمادها (qtyStep/minQty) — ۱ ساعت. */
let bitunixPairsCache: { at: number; map: Record<string, { qtyStep: number; minQty: number }> } | null = null;

async function bitunixPairs(): Promise<Record<string, { qtyStep: number; minQty: number }>> {
  if (bitunixPairsCache && Date.now() - bitunixPairsCache.at < 3_600_000) return bitunixPairsCache.map;
  const res = await fetch(`${BITUNIX_BASE}/api/v1/futures/market/trading_pairs`);
  const data = (await res.json()) as { code: number; data?: any[] };
  const map: Record<string, { qtyStep: number; minQty: number }> = {};
  for (const p of data?.data ?? []) {
    const sym = String(p.symbol ?? '');
    if (!sym.endsWith('USDT')) continue;
    const prec = Number(p.qtyPrecision ?? p.quantityPrecision ?? p.accuracy ?? 3);
    const step = p.qtyStep ? parseFloat(p.qtyStep) : Math.pow(10, -prec);
    map[sym] = { qtyStep: step > 0 ? step : 0.001, minQty: parseFloat(p.minQty ?? p.minQuantity ?? '0') || 0 };
  }
  if (Object.keys(map).length > 0) bitunixPairsCache = { at: Date.now(), map };
  return map;
}

/** امضای بیتیونیکس: sha256(sha256(nonce+ts+key+query+body) + secret) */
function bitunixSign(keys: ExchangeKeys, nonce: string, timestamp: string, sortedQuery: string, body: string): string {
  return sha256Hex(sha256Hex(`${nonce}${timestamp}${keys.apiKey}${sortedQuery}${body}`) + keys.apiSecret);
}

function bitunixHeaders(keys: ExchangeKeys, sortedQuery: string, body: string): Record<string, string> {
  const timestamp = Date.now().toString();
  const nonce = randomHex(32);
  const sign = bitunixSign(keys, nonce, timestamp, sortedQuery, body);
  return {
    'Content-Type': 'application/json',
    'api-key': keys.apiKey,
    timestamp,
    nonce,
    sign,
  };
}

/** POST خصوصی — بدنهٔ JSON فشرده (امضا روی همان رشتهٔ ارسالی). */
async function bitunixPost(keys: ExchangeKeys, path: string, bodyObj: Record<string, unknown>): Promise<any> {
  const body = JSON.stringify(bodyObj);
  const res = await fetch(`${BITUNIX_BASE}${path}`, {
    method: 'POST',
    headers: bitunixHeaders(keys, '', body),
    body,
  });
  const data = (await res.json()) as { code: number; msg?: string; data?: any };
  if (data.code !== 0) throw new Error(`Bitunix: ${data.msg ?? data.code}`);
  return data.data;
}

/** GET خصوصی — پارامترها هم در URL (انکد) و هم در امضا (مرتب‌شدهٔ خام). */
async function bitunixGet(keys: ExchangeKeys, path: string, params: Record<string, string | number> = {}): Promise<any> {
  const entries = Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1));
  const sortedQuery = entries.map(([k, v]) => `${k}${v}`).join('');
  const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
  const res = await fetch(`${BITUNIX_BASE}${path}${qs ? `?${qs}` : ''}`, {
    headers: bitunixHeaders(keys, sortedQuery, ''),
  });
  const data = (await res.json()) as { code: number; msg?: string; data?: any };
  if (data.code !== 0) throw new Error(`Bitunix: ${data.msg ?? data.code}`);
  return data.data;
}

function bitunixPositionQty(p: any): number {
  return Number(p.qty ?? p.positionQty ?? p.volume ?? p.holdQty ?? 0);
}

const bitunixAdapter: FuturesAdapter = {
  id: 'bitunix',
  executable: true,
  async priceMap() {
    const res = await fetch(`${BITUNIX_BASE}/api/v1/futures/market/tickers`);
    const data = (await res.json()) as { code: number; data?: any[] };
    const map: Record<string, number> = {};
    for (const t of data?.data ?? []) {
      const sym = String(t.symbol ?? '');
      if (sym.endsWith('USDT')) map[sym] = Number(t.lastPrice ?? t.price ?? t.last ?? 0);
    }
    return map;
  },
  async setLeverage(keys, symbol, leverage) {
    await bitunixGet(keys, '/api/v1/futures/account/change_leverage', {
      symbol,
      leverage,
      marginCoin: 'USDT',
    });
  },
  async getFuturesBalance(keys) {
    // صفحهٔ موجودی بیتیونیکس در مستندات برای خوانندهٔ ما بلاک بود؛ اندپوینت
    // wallet را بدون سندِ باز حدس نمی‌زنیم → UI چیزی نشان نمی‌دهد (null).
    return null;
  },
  async openMarket(keys, symbol, side, sizeUsd, leverage, stopPrice, takePrice) {
    const tickers = await bitunixAdapter.priceMap().catch(() => ({}) as Record<string, number>);
    const last = tickers[symbol] || stopPrice || takePrice;
    if (!(last > 0)) throw new Error('Bitunix: قیمت نماد در دسترس نیست');
    const pair = (await bitunixPairs())[symbol];
    await bitunixAdapter.setLeverage(keys, symbol, leverage).catch(() => {
      // لوریج تکراری/ثابت — غیرمرگبار
    });
    const qty = roundToStep((sizeUsd * leverage) / last, pair?.qtyStep ?? 0.001);
    if (!(qty > 0)) throw new Error('Bitunix: حجم محاسبه‌شده نامعتبر است');
    await bitunixPost(keys, '/api/v1/futures/trade/place_order', {
      symbol,
      side: side === 'long' ? 'BUY' : 'SELL',
      qty: String(qty),
      orderType: 'MARKET',
      effect: 'GTC',
    });
    // استاپ/حد سود جدا از سفارش است → «اولویت حفاظت»: اگر ثبت SL/TP نشد،
    // پوزیشن همان لحظه بسته می‌شود تا بدون حفاظ نماند.
    let positionId: string | undefined;
    for (let i = 0; i < 7 && !positionId; i++) {
      if (i > 0) await sleep(700);
      const positions = (await bitunixGet(keys, '/api/v1/futures/position/get_pending_positions').catch(() => [])) as any[];
      const p = (positions ?? []).find((x) => x.symbol === symbol);
      positionId = p ? String(p.positionId ?? '') : undefined;
    }
    if (!positionId) throw new Error('Bitunix: پوزیشن بازشده پیدا نشد (SL/TP ثبت نشد — پوزیشن بسته شد)');
    try {
      if (stopPrice > 0) {
        await bitunixPost(keys, '/api/v1/futures/tpsl/place_order', {
          symbol,
          positionId,
          slPrice: String(stopPrice),
          slQty: String(qty),
        });
      }
      if (takePrice > 0) {
        await bitunixPost(keys, '/api/v1/futures/tpsl/place_order', {
          symbol,
          positionId,
          tpPrice: String(takePrice),
          tpQty: String(qty),
        });
      }
    } catch (e) {
      await bitunixAdapter.closeAll(keys, symbol, side).catch(() => {});
      throw new Error(`Bitunix: ثبت SL/TP ناموفق بود و پوزیشن برای امنیت بسته شد (${e instanceof Error ? e.message : 'خطا'})`);
    }
    return { qty };
  },
  async listPositions(keys) {
    const positions = (await bitunixGet(keys, '/api/v1/futures/position/get_pending_positions').catch(() => [])) as any[];
    const rows: LivePositionRow[] = [];
    for (const p of positions ?? []) {
      const qty = bitunixPositionQty(p);
      if (!(qty > 0)) continue;
      const sideStr = String(p.positionSide ?? p.side ?? '').toUpperCase();
      const isShort = sideStr.includes('SHORT') || qty < 0;
      rows.push({
        symbol: String(p.symbol ?? ''),
        positionAmt: isShort ? String(-qty) : String(qty),
        markPrice: String(p.markPrice ?? p.lastPrice ?? p.avgPrice ?? 0),
        entryPrice: String(p.avgPrice ?? p.avgEntryPrice ?? p.openPrice ?? 0),
      });
    }
    return rows;
  },
  async closeAll(keys, symbol, side) {
    const positions = (await bitunixGet(keys, '/api/v1/futures/position/get_pending_positions').catch(() => [])) as any[];
    const p = (positions ?? []).find((x) => x.symbol === symbol);
    const qty = p ? bitunixPositionQty(p) : 0;
    if (!(qty > 0)) return;
    const pair = (await bitunixPairs())[symbol];
    const q = roundToStep(qty, pair?.qtyStep ?? 0.001);
    const body = {
      symbol,
      side: side === 'long' ? 'SELL' : 'BUY',
      qty: String(q),
      orderType: 'MARKET',
      effect: 'GTC',
      reduceOnly: true,
    };
    try {
      await bitunixPost(keys, '/api/v1/futures/trade/place_order', body);
    } catch {
      const { reduceOnly: _drop, ...bodyNoReduce } = body;
      await bitunixPost(keys, '/api/v1/futures/trade/place_order', bodyNoReduce);
    }
  },
  async closePartial(keys, symbol, side, fraction) {
    const positions = (await bitunixGet(keys, '/api/v1/futures/position/get_pending_positions').catch(() => [])) as any[];
    const p = (positions ?? []).find((x) => x.symbol === symbol);
    const qty = p ? bitunixPositionQty(p) : 0;
    if (!(qty > 0)) return;
    const pair = (await bitunixPairs())[symbol];
    const q = roundToStep(qty * Math.min(1, Math.max(0, fraction)), pair?.qtyStep ?? 0.001);
    if (!(q > 0)) return;
    const body = {
      symbol,
      side: side === 'long' ? 'SELL' : 'BUY',
      qty: String(q),
      orderType: 'MARKET',
      effect: 'GTC',
      reduceOnly: true,
    };
    try {
      await bitunixPost(keys, '/api/v1/futures/trade/place_order', body);
    } catch {
      const { reduceOnly: _drop, ...bodyNoReduce } = body;
      await bitunixPost(keys, '/api/v1/futures/trade/place_order', bodyNoReduce);
    }
  },
  async updateTradingStop(keys, symbol, side, stopPrice, takePrice, _qty, updateTake) {
    // tpsl/place_order برای همان پوزیشن دوباره صدا می‌شود (جایگزینی مقادیر)
    const positions = (await bitunixGet(keys, '/api/v1/futures/position/get_pending_positions').catch(() => [])) as any[];
    const p = (positions ?? []).find((x) => x.symbol === symbol);
    if (!p) return;
    const positionId = String(p.positionId ?? '');
    const qty = bitunixPositionQty(p);
    const pair = (await bitunixPairs())[symbol];
    if (stopPrice > 0) {
      await bitunixPost(keys, '/api/v1/futures/tpsl/place_order', {
        symbol,
        positionId,
        slPrice: String(stopPrice),
        slQty: String(roundToStep(qty, pair?.qtyStep ?? 0.001)),
      });
    }
    if (updateTake && takePrice > 0) {
      await bitunixPost(keys, '/api/v1/futures/tpsl/place_order', {
        symbol,
        positionId,
        tpPrice: String(takePrice),
        tpQty: String(roundToStep(qty, pair?.qtyStep ?? 0.001)),
      });
    }
  },
};

// ---------------------------------------------------------------------------
// TOOBIT (api.toobit.com) — فرم بایننس‌مانند + ساید BUY_OPEN/SELL_CLOSE + SL/TP پیوسته
// ---------------------------------------------------------------------------

const TOOBIT_BASE = 'https://api.toobit.com';

/** "BTCUSDT" → "BTC-SWAP-USDT" و برعکس */
function toobitToSym(binanceSymbol: string): string {
  return binanceSymbol.replace(/USDT$/, '-SWAP-USDT');
}
function toobitFromSym(exchangeSymbol: string): string {
  return exchangeSymbol.replace('-SWAP-USDT', 'USDT');
}

async function toobitSigned(
  keys: ExchangeKeys,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  params: Record<string, string | number | boolean>
): Promise<any> {
  const all = { ...params, timestamp: Date.now() };
  const form = formUrlencode(all);
  const signature = hmacSha256Hex(keys.apiSecret, form);
  const signed = `${form}&signature=${signature}`;
  const url = method === 'GET' || method === 'DELETE' ? `${TOOBIT_BASE}${path}?${signed}` : `${TOOBIT_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: { 'X-BB-APIKEY': keys.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'POST' ? signed : undefined,
  });
  const data = (await res.json()) as { code: number | string; msg?: string; data?: any };
  const code = String(data.code);
  if (code !== '200' && code !== '0') throw new Error(`Toobit: ${data.msg ?? data.code}`);
  return data.data;
}

let toobitInfoCache: { at: number; map: Record<string, { qtyStep: number; minQty: number }> } | null = null;

async function toobitInstruments(): Promise<Record<string, { qtyStep: number; minQty: number }>> {
  if (toobitInfoCache && Date.now() - toobitInfoCache.at < 3_600_000) return toobitInfoCache.map;
  const res = await fetch(`${TOOBIT_BASE}/api/v1/exchangeInfo`);
  const data = (await res.json()) as { symbols?: any[] };
  const map: Record<string, { qtyStep: number; minQty: number }> = {};
  for (const s of data?.symbols ?? []) {
    const filters = Array.isArray(s.filters) ? s.filters : [];
    const lot = filters.find((f: any) => (f.filterType ?? '').toUpperCase() === 'LOT_SIZE');
    const sym = String(s.symbol ?? '');
    if (!sym) continue;
    map[sym] = {
      qtyStep: parseFloat(lot?.stepSize ?? '0.001') || 0.001,
      minQty: parseFloat(lot?.minQty ?? '0') || 0,
    };
  }
  if (Object.keys(map).length > 0) toobitInfoCache = { at: Date.now(), map };
  return map;
}

const toobitAdapter: FuturesAdapter = {
  id: 'toobit',
  executable: true,
  async priceMap() {
    const res = await fetch(`${TOOBIT_BASE}/quote/v1/contract/ticker/price`);
    const arr = (await res.json()) as { symbol: string; price: string }[];
    const map: Record<string, number> = {};
    for (const t of arr ?? []) map[toobitFromSym(t.symbol)] = parseFloat(t.price);
    return map;
  },
  async setLeverage(keys, symbol, leverage) {
    // v1.5.22 — مارجین نماد صریحاً ISOLATED می‌رود (مستندات رسمی توبیت:
    // POST /api/v1/futures/marginType)؛ اگر همین باشد خطای غیرمرگبار می‌دهد.
    await toobitSigned(keys, 'POST', '/api/v1/futures/marginType', {
      symbol: toobitToSym(symbol),
      marginType: 'ISOLATED',
    }).catch(() => {});
    await toobitSigned(keys, 'POST', '/api/v1/futures/leverage', {
      symbol: toobitToSym(symbol),
      leverage,
    });
  },
  async getFuturesBalance(keys) {
    const arr = (await toobitSigned(keys, 'GET', '/api/v1/futures/balance', {}).catch(() => null)) as any[] | null;
    const row = (arr ?? []).find((b: any) => String(b.coin ?? '').toUpperCase() === 'USDT');
    if (!row) return null;
    const available = parseFloat(row.availableBalance ?? '0');
    const equity = parseFloat(row.balance ?? '0');
    return { available: Number.isFinite(available) ? available : 0, equity: Number.isFinite(equity) ? equity : 0 };
  },
  async openMarket(keys, symbol, side, sizeUsd, leverage, stopPrice, takePrice) {
    const sym = toobitToSym(symbol);
    const prices = await toobitAdapter.priceMap().catch(() => ({}) as Record<string, number>);
    const last = prices[symbol] || stopPrice || takePrice;
    if (!(last > 0)) throw new Error('Toobit: قیمت نماد در دسترس نیست');
    const instr = (await toobitInstruments())[sym];
    await toobitAdapter.setLeverage(keys, symbol, leverage).catch(() => {});
    const qty = roundToStep((sizeUsd * leverage) / last, instr?.qtyStep ?? 0.001);
    if (!(qty > 0)) throw new Error('Toobit: حجم محاسبه‌شده نامعتبر است');
    // نکتهٔ توبیت: سفارش مارکت = type:LIMIT + priceType:MARKET (رفتار خود صرافی)
    await toobitSigned(keys, 'POST', '/api/v1/futures/order', {
      symbol: sym,
      quantity: String(qty),
      side: side === 'long' ? 'BUY_OPEN' : 'SELL_OPEN',
      type: 'LIMIT',
      priceType: 'MARKET',
      ...(stopPrice > 0 ? { stopLoss: String(stopPrice) } : {}),
      ...(takePrice > 0 ? { takeProfit: String(takePrice) } : {}),
      newClientOrderId: randomHex(16),
    });
    return { qty };
  },
  async listPositions(keys) {
    const positions = (await toobitSigned(keys, 'GET', '/api/v1/futures/positions', {}).catch(() => [])) as any[];
    const rows: LivePositionRow[] = [];
    for (const p of positions ?? []) {
      const qty = Number(p.position ?? p.positionAmt ?? 0);
      if (!(qty > 0)) continue;
      const isShort = String(p.side ?? '').toUpperCase() === 'SHORT';
      rows.push({
        symbol: toobitFromSym(String(p.symbol ?? '')),
        positionAmt: isShort ? String(-qty) : String(qty),
        markPrice: String(p.markPrice ?? p.lastPrice ?? p.avgPrice ?? 0),
        entryPrice: String(p.avgPrice ?? 0),
      });
    }
    return rows;
  },
  async closeAll(keys, symbol, side) {
    const positions = (await toobitSigned(keys, 'GET', '/api/v1/futures/positions', {}).catch(() => [])) as any[];
    const p = (positions ?? []).find((x: any) => toobitFromSym(x.symbol) === symbol);
    const qty = p ? Number(p.position ?? 0) : 0;
    if (!(qty > 0)) return;
    await toobitSigned(keys, 'POST', '/api/v1/futures/order', {
      symbol: toobitToSym(symbol),
      quantity: String(qty),
      side: side === 'long' ? 'SELL_CLOSE' : 'BUY_CLOSE',
      type: 'LIMIT',
      priceType: 'MARKET',
    });
  },
  async closePartial(keys, symbol, side, fraction) {
    const positions = (await toobitSigned(keys, 'GET', '/api/v1/futures/positions', {}).catch(() => [])) as any[];
    const p = (positions ?? []).find((x: any) => toobitFromSym(x.symbol) === symbol);
    const qty = p ? Number(p.position ?? 0) : 0;
    if (!(qty > 0)) return;
    const instr = (await toobitInstruments())[toobitToSym(symbol)];
    const q = roundToStep(qty * Math.min(1, Math.max(0, fraction)), instr?.qtyStep ?? 0.001);
    if (!(q > 0)) return;
    await toobitSigned(keys, 'POST', '/api/v1/futures/order', {
      symbol: toobitToSym(symbol),
      quantity: String(q),
      side: side === 'long' ? 'SELL_CLOSE' : 'BUY_CLOSE',
      type: 'LIMIT',
      priceType: 'MARKET',
    });
  },
  async updateTradingStop(keys, symbol, side, stopPrice, takePrice) {
    // آپدیت استاپ روی پوزیشن باز: سفارش شرطی بسته‌شونده (fail-soft — اگر
    // نشد، استاپ قبلی روی صرافی همچنان فعال می‌ماند).
    const positions = (await toobitSigned(keys, 'GET', '/api/v1/futures/positions', {}).catch(() => [])) as any[];
    const p = (positions ?? []).find((x: any) => toobitFromSym(x.symbol) === symbol);
    const qty = p ? Number(p.position ?? 0) : 0;
    if (!(qty > 0)) return;
    const instr = (await toobitInstruments())[toobitToSym(symbol)];
    const q = roundToStep(qty, instr?.qtyStep ?? 0.001);
    await toobitSigned(keys, 'POST', '/api/v1/futures/order', {
      symbol: toobitToSym(symbol),
      quantity: String(q),
      side: side === 'long' ? 'SELL_CLOSE' : 'BUY_CLOSE',
      type: 'LIMIT',
      priceType: 'MARKET',
      stopPrice: String(stopPrice > 0 ? stopPrice : takePrice),
    });
  },
};

// ---------------------------------------------------------------------------
// BINGX (open-api.bingx.com) — پارامترها در query امضا می‌شوند + SL/TP JSON پیوسته
// ---------------------------------------------------------------------------

const BINGX_BASE = 'https://open-api.bingx.com';

function bingxToSym(binanceSymbol: string): string {
  return binanceSymbol.replace(/USDT$/, '-USDT');
}
function bingxFromSym(exchangeSymbol: string): string {
  return exchangeSymbol.replace('-USDT', 'USDT');
}

/** ساین بینگ‌ایکس: همهٔ پارامترها در query-string + signature؛ بدنه خالی. */
async function bingxSigned(
  keys: ExchangeKeys,
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string | number | boolean>
): Promise<any> {
  const all: Record<string, string | number | boolean> = { ...params, timestamp: Date.now() };
  const sorted: Record<string, string | number | boolean> = {};
  for (const k of Object.keys(all).sort()) sorted[k] = all[k];
  const qs = formUrlencode(sorted);
  const signature = hmacSha256Hex(keys.apiSecret, qs);
  const res = await fetch(`${BINGX_BASE}${path}?${qs}&signature=${signature}`, {
    method,
    headers: { 'X-BX-APIKEY': keys.apiKey },
  });
  const data = (await res.json()) as { code: number | string; msg?: string; data?: any };
  if (String(data.code) !== '0') throw new Error(`BingX: ${data.msg ?? data.code}`);
  return data.data;
}

let bingxContractsCache: { at: number; map: Record<string, { qtyStep: number; minQty: number }> } | null = null;

async function bingxContracts(): Promise<Record<string, { qtyStep: number; minQty: number }>> {
  if (bingxContractsCache && Date.now() - bingxContractsCache.at < 3_600_000) return bingxContractsCache.map;
  const map: Record<string, { qtyStep: number; minQty: number }> = {};
  // v2 و بعد v1 — ساختار هر دو دفاعی پارس می‌شود
  for (const url of [`${BINGX_BASE}/openApi/swap/v2/market/contracts`, `${BINGX_BASE}/openApi/swap/v1/market/contracts`]) {
    try {
      const res = await fetch(url);
      const body = (await res.json()) as { data?: any[] };
      for (const c of body?.data ?? []) {
        const sym = String(c.symbol ?? '');
        if (!sym.endsWith('-USDT')) continue;
        const prec = Number(c.quantityPrecision ?? c.qtyPrecision ?? c.volumePrecision ?? 3);
        map[sym] = {
          qtyStep: c.qtyStep ? parseFloat(c.qtyStep) : Math.pow(10, -prec),
          minQty: parseFloat(c.minQty ?? c.minTradeQty ?? '0') || 0,
        };
      }
      if (Object.keys(map).length > 0) break;
    } catch {}
  }
  if (Object.keys(map).length > 0) bingxContractsCache = { at: Date.now(), map };
  return map;
}

const bingxAdapter: FuturesAdapter = {
  id: 'bingx',
  executable: true,
  async priceMap() {
    const res = await fetch(`${BINGX_BASE}/openApi/swap/v2/quote/ticker`);
    const body = (await res.json()) as { data?: any[] };
    const map: Record<string, number> = {};
    for (const t of body?.data ?? []) {
      const sym = String(t.symbol ?? '');
      if (sym.endsWith('-USDT')) map[bingxFromSym(sym)] = Number(t.lastPrice ?? t.last ?? 0);
    }
    if (Object.keys(map).length === 0) throw new Error('BingX: تیکرها خالی بود');
    return map;
  },
  async setLeverage() {
    // بینگ‌ایکس v2 لوریج از API قابل تنظیم نیست (در حساب کاربر تنظیم می‌شود)
  },
  async getFuturesBalance(keys) {
    const body = (await bingxSigned(keys, 'GET', '/openApi/swap/v3/user/balance', {}).catch(() => null)) as any;
    const rows = Array.isArray(body) ? body : (body?.data ?? body ?? []);
    const row = (rows as any[]).find((b) => {
      const asset = String(b.asset ?? b.marginCoin ?? b.currency ?? '').toUpperCase();
      return !asset || asset === 'USDT';
    });
    if (!row) return null;
    const available = parseFloat(row.availableMargin ?? row.availableBalance ?? '0');
    const equity = parseFloat(row.equity ?? row.balance ?? '0');
    return { available: Number.isFinite(available) ? available : 0, equity: Number.isFinite(equity) ? equity : 0 };
  },
  async openMarket(keys, symbol, side, sizeUsd, leverage, stopPrice, takePrice) {
    const sym = bingxToSym(symbol);
    const prices = await bingxAdapter.priceMap().catch(() => ({}) as Record<string, number>);
    const last = prices[symbol] || stopPrice || takePrice;
    if (!(last > 0)) throw new Error('BingX: قیمت نماد در دسترس نیست');
    const instr = (await bingxContracts())[sym];
    const qty = roundToStep((sizeUsd * leverage) / last, instr?.qtyStep ?? 0.001);
    if (!(qty > 0)) throw new Error('BingX: حجم محاسبه‌شده نامعتبر است');
    // v1.5.22 — مارجین نماد صریحاً ISOLATED می‌رود (مستندات رسمی BingX:
    // POST /openApi/swap/v2/trade/marginType)؛ اگر همین باشد خطای غیرمرگبار می‌دهد.
    await bingxSigned(keys, 'POST', '/openApi/swap/v2/trade/marginType', {
      symbol: sym,
      marginType: 'ISOLATED',
    }).catch(() => {});
    // SL/TP داخل خود سفارش (JSON رشته‌ای) — حفاظت هم‌زمان با باز شدن
    await bingxSigned(keys, 'POST', '/openApi/swap/v2/trade/order', {
      symbol: sym,
      type: 'MARKET',
      side: side === 'long' ? 'BUY' : 'SELL',
      positionSide: 'BOTH',
      quantity: String(qty),
      ...(stopPrice > 0
        ? {
            stopLoss: JSON.stringify({
              stopPrice: String(stopPrice),
              workingType: 'MARK_PRICE',
              type: 'STOP_MARKET',
              quantity: String(qty),
            }),
          }
        : {}),
      ...(takePrice > 0
        ? {
            takeProfit: JSON.stringify({
              stopPrice: String(takePrice),
              workingType: 'MARK_PRICE',
              type: 'TAKE_PROFIT_MARKET',
              quantity: String(qty),
            }),
          }
        : {}),
    });
    return { qty };
  },
  async listPositions(keys) {
    const body = (await bingxSigned(keys, 'GET', '/openApi/swap/v2/user/positions', {}).catch(() => undefined)) as any;
    const positions = Array.isArray(body) ? body : (body?.data ?? []);
    const rows: LivePositionRow[] = [];
    for (const p of positions ?? []) {
      const qty = Number(p.positionAmt ?? 0);
      if (!(qty > 0)) continue;
      const isShort = String(p.positionSide ?? '').toUpperCase() === 'SHORT';
      rows.push({
        symbol: bingxFromSym(String(p.symbol ?? '')),
        positionAmt: isShort ? String(-qty) : String(qty),
        markPrice: String(p.markPrice ?? 0),
        entryPrice: String(p.avgPrice ?? 0),
      });
    }
    return rows;
  },
  async closeAll(keys, symbol, side) {
    const rows = await bingxAdapter.listPositions(keys);
    const row = rows.find((r) => r.symbol === symbol && parseFloat(r.positionAmt) !== 0);
    if (!row) return;
    const instr = (await bingxContracts())[bingxToSym(symbol)];
    const qty = roundToStep(Math.abs(parseFloat(row.positionAmt)), instr?.qtyStep ?? 0.001);
    if (!(qty > 0)) return;
    await bingxSigned(keys, 'POST', '/openApi/swap/v2/trade/order', {
      symbol: bingxToSym(symbol),
      type: 'MARKET',
      side: side === 'long' ? 'SELL' : 'BUY',
      positionSide: 'BOTH',
      quantity: String(qty),
      reduceOnly: 'true',
    });
  },
  async closePartial(keys, symbol, side, fraction) {
    const rows = await bingxAdapter.listPositions(keys);
    const row = rows.find((r) => r.symbol === symbol && parseFloat(r.positionAmt) !== 0);
    if (!row) return;
    const instr = (await bingxContracts())[bingxToSym(symbol)];
    const qty = roundToStep(Math.abs(parseFloat(row.positionAmt)) * Math.min(1, Math.max(0, fraction)), instr?.qtyStep ?? 0.001);
    if (!(qty > 0)) return;
    await bingxSigned(keys, 'POST', '/openApi/swap/v2/trade/order', {
      symbol: bingxToSym(symbol),
      type: 'MARKET',
      side: side === 'long' ? 'SELL' : 'BUY',
      positionSide: 'BOTH',
      quantity: String(qty),
      reduceOnly: 'true',
    });
  },
  async updateTradingStop(keys, symbol, side, stopPrice) {
    // استاپ شرطی جدید (fail-soft — استاپ قبلی می‌ماند)
    const rows = await bingxAdapter.listPositions(keys);
    const row = rows.find((r) => r.symbol === symbol && parseFloat(r.positionAmt) !== 0);
    if (!row) return;
    const instr = (await bingxContracts())[bingxToSym(symbol)];
    const qty = roundToStep(Math.abs(parseFloat(row.positionAmt)), instr?.qtyStep ?? 0.001);
    await bingxSigned(keys, 'POST', '/openApi/swap/v2/trade/order', {
      symbol: bingxToSym(symbol),
      type: 'STOP_MARKET',
      side: side === 'long' ? 'SELL' : 'BUY',
      positionSide: 'BOTH',
      stopPrice: String(stopPrice),
      quantity: String(qty),
      reduceOnly: 'true',
    });
  },
};

// ---------------------------------------------------------------------------
// OKX (www.okx.com) — V5: attachAlgoOrds برای SL/TP + حجم بر حسب «قرارداد» (ctVal)
// ---------------------------------------------------------------------------

const OKX_BASE = 'https://www.okx.com';

function okxToSym(binanceSymbol: string): string {
  return binanceSymbol.replace(/USDT$/, '-USDT-SWAP');
}
function okxFromSym(exchangeSymbol: string): string {
  return exchangeSymbol.replace('-USDT-SWAP', 'USDT');
}

async function okxSigned(
  keys: ExchangeKeys,
  method: 'GET' | 'POST',
  path: string,
  bodyObj?: Record<string, unknown> | Array<Record<string, unknown>>,
  query = ''
): Promise<any> {
  const ts = new Date().toISOString();
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  const requestPath = path + query;
  const sign = hmacSha256B64(keys.apiSecret, `${ts}${method}${requestPath}${body}`);
  const res = await fetch(`${OKX_BASE}${requestPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'OK-ACCESS-KEY': keys.apiKey,
      'OK-ACCESS-SIGN': sign,
      'OK-ACCESS-TIMESTAMP': ts,
      'OK-ACCESS-PASSPHRASE': keys.passphrase ?? '',
    },
    body: body || undefined,
  });
  const data = (await res.json()) as { code: string; msg: string; data?: any[] };
  if (data.code !== '0') throw new Error(`OKX: ${data.msg ?? data.code}`);
  const first = data.data?.[0];
  if (first && first.sCode !== undefined && String(first.sCode) !== '0') {
    throw new Error(`OKX: ${first.sMsg ?? first.sCode}`);
  }
  return data.data;
}

let okxInstrCache: { at: number; map: Record<string, { ctVal: number; lotSz: number; minSz: number }> } | null = null;

async function okxInstruments(): Promise<Record<string, { ctVal: number; lotSz: number; minSz: number }>> {
  if (okxInstrCache && Date.now() - okxInstrCache.at < 3_600_000) return okxInstrCache.map;
  const res = await fetch(`${OKX_BASE}/api/v5/public/instruments?instType=SWAP`);
  const data = (await res.json()) as { data?: any[] };
  const map: Record<string, { ctVal: number; lotSz: number; minSz: number }> = {};
  for (const ins of data?.data ?? []) {
    if (String(ins.instId ?? '').endsWith('-USDT-SWAP')) {
      map[ins.instId] = {
        ctVal: parseFloat(ins.ctVal ?? '1') || 1,
        lotSz: parseFloat(ins.lotSz ?? '1') || 1,
        minSz: parseFloat(ins.minSz ?? '1') || 1,
      };
    }
  }
  if (Object.keys(map).length > 0) okxInstrCache = { at: Date.now(), map };
  return map;
}

/** مارجین دلاری → تعداد قرارداد (گیرِ ctVal و گام lotSz). */
function okxContractsFor(notionalUsd: number, price: number, ins: { ctVal: number; lotSz: number; minSz: number }): number {
  const raw = notionalUsd / price / ins.ctVal;
  const n = Math.max(ins.minSz, roundToStep(raw, ins.lotSz));
  if (!(n > 0)) throw new Error('OKX: حجم پایین‌تر از حداقل قرارداد است');
  return n;
}

const okxAdapter: FuturesAdapter = {
  id: 'okx',
  executable: true,
  async priceMap() {
    const res = await fetch(`${OKX_BASE}/api/v5/market/tickers?instType=SWAP`);
    const data = (await res.json()) as { data?: any[] };
    const map: Record<string, number> = {};
    for (const t of data?.data ?? []) {
      const sym = String(t.instId ?? '');
      if (sym.endsWith('-USDT-SWAP')) map[okxFromSym(sym)] = parseFloat(t.last ?? '0');
    }
    return map;
  },
  async setLeverage(keys, symbol, leverage) {
    await okxSigned(keys, 'POST', '/api/v5/account/set-leverage', {
      instId: okxToSym(symbol),
      lever: String(leverage),
      mgnMode: 'isolated',
    });
  },
  async getFuturesBalance(keys) {
    const data = (await okxSigned(keys, 'GET', '/api/v5/account/balance', undefined, '?ccy=USDT').catch(
      () => null
    )) as any[] | null;
    const details = data?.[0]?.details;
    const row = (details ?? []).find((d: any) => d.ccy === 'USDT') ?? details?.[0];
    if (!row) return null;
    const equity = parseFloat(row.eq ?? row.eqUsd ?? '0');
    const available = parseFloat(row.availBal ?? '0');
    return { available: Number.isFinite(available) ? available : 0, equity: Number.isFinite(equity) ? equity : 0 };
  },
  async openMarket(keys, symbol, side, sizeUsd, leverage, stopPrice, takePrice) {
    const sym = okxToSym(symbol);
    const prices = await okxAdapter.priceMap().catch(() => ({}) as Record<string, number>);
    const last = prices[symbol] || stopPrice || takePrice;
    if (!(last > 0)) throw new Error('OKX: قیمت نماد در دسترس نیست');
    const ins = (await okxInstruments())[sym];
    if (!ins) throw new Error('OKX: اطلاعات قرارداد نماد پیدا نشد');
    await okxAdapter.setLeverage(keys, symbol, leverage).catch(() => {});
    const contracts = okxContractsFor(sizeUsd * leverage, last, ins);
    // یک‌طرفه (posSide: net) با تلاش مجدد در حالت دوجهته؛ SL/TP با attachAlgoOrds
    const base = {
      instId: sym,
      tdMode: 'isolated',
      side: side === 'long' ? 'buy' : 'sell',
      ordType: 'market',
      sz: String(contracts),
      attachAlgoOrds: [
        {
          ...(stopPrice > 0 ? { slTriggerPx: String(stopPrice), slOrdPx: '-1' } : {}),
          ...(takePrice > 0 ? { tpTriggerPx: String(takePrice), tpOrdPx: '-1' } : {}),
        },
      ],
    };
    try {
      await okxSigned(keys, 'POST', '/api/v5/trade/order', { ...base, posSide: 'net' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (/posSide|position mode|51000|51001/i.test(msg)) {
        await okxSigned(keys, 'POST', '/api/v5/trade/order', {
          ...base,
          posSide: side === 'long' ? 'long' : 'short',
        });
      } else {
        throw e;
      }
    }
    return { qty: contracts * ins.ctVal };
  },
  async listPositions(keys) {
    const data = (await okxSigned(keys, 'GET', '/api/v5/account/positions', undefined, '?instType=SWAP').catch(
      () => []
    )) as any[];
    const instr = await okxInstruments().catch(() => ({}) as Record<string, { ctVal: number; lotSz: number; minSz: number }>);
    const rows: LivePositionRow[] = [];
    for (const p of data ?? []) {
      const pos = parseFloat(p.pos ?? '0');
      if (!(pos > 0) && !(pos < 0)) continue;
      const instId = String(p.instId ?? '');
      const ctVal = instr[instId]?.ctVal ?? 1;
      const qty = Math.abs(pos) * ctVal;
      rows.push({
        symbol: okxFromSym(instId),
        positionAmt: pos > 0 ? String(qty) : String(-qty),
        markPrice: String(p.markPx ?? 0),
        entryPrice: String(p.avgPx ?? 0),
      });
    }
    return rows;
  },
  async closeAll(keys, symbol, side) {
    const sym = okxToSym(symbol);
    try {
      await okxSigned(keys, 'POST', '/api/v5/trade/close-position', {
        instId: sym,
        mgnMode: 'isolated',
        posSide: 'net',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (/posSide|position mode|51000|51001/i.test(msg)) {
        await okxSigned(keys, 'POST', '/api/v5/trade/close-position', {
          instId: sym,
          mgnMode: 'isolated',
          posSide: side === 'long' ? 'long' : 'short',
        });
      } else {
        throw e;
      }
    }
  },
  async closePartial(keys, symbol, side, fraction) {
    const sym = okxToSym(symbol);
    const rows = await okxAdapter.listPositions(keys);
    const row = rows.find((r) => r.symbol === symbol && parseFloat(r.positionAmt) !== 0);
    if (!row) return;
    const ins = (await okxInstruments())[sym];
    if (!ins) return;
    const baseQty = Math.abs(parseFloat(row.positionAmt));
    const contracts = roundToStep((baseQty * Math.min(1, Math.max(0, fraction))) / ins.ctVal, ins.lotSz);
    if (!(contracts > 0)) return;
    await okxSigned(keys, 'POST', '/api/v5/trade/order', {
      instId: sym,
      tdMode: 'isolated',
      side: side === 'long' ? 'sell' : 'buy',
      posSide: 'net',
      ordType: 'market',
      sz: String(contracts),
      reduceOnly: true,
    });
  },
  async updateTradingStop(keys, symbol, side, stopPrice, takePrice, _qty, updateTake) {
    // الگوریتم‌های شرطی قبلی لغو و OCO جدید گذاشته می‌شود (fail-soft)
    const sym = okxToSym(symbol);
    const rows = await okxAdapter.listPositions(keys);
    const row = rows.find((r) => r.symbol === symbol && parseFloat(r.positionAmt) !== 0);
    if (!row) return;
    const ins = (await okxInstruments())[sym];
    if (!ins) return;
    const contracts = roundToStep(Math.abs(parseFloat(row.positionAmt)) / (ins.ctVal || 1), ins.lotSz);
    try {
      const pending = (await okxSigned(
        keys,
        'GET',
        '/api/v5/trade/orders-algo-pending',
        undefined,
        `?ordType=conditional&instId=${sym}`
      )) as any[];
      const ids = (pending ?? []).map((a) => ({ algoId: a.algoId, instId: sym }));
      if (ids.length > 0) await okxSigned(keys, 'POST', '/api/v5/trade/cancel-algos', ids);
    } catch {}
    await okxSigned(keys, 'POST', '/api/v5/trade/order-algo', {
      instId: sym,
      tdMode: 'isolated',
      side: side === 'long' ? 'sell' : 'buy',
      posSide: 'net',
      ordType: 'oco',
      sz: String(contracts),
      reduceOnly: true,
      ...(stopPrice > 0 ? { slTriggerPx: String(stopPrice), slOrdPx: '-1' } : {}),
      ...(updateTake && takePrice > 0 ? { tpTriggerPx: String(takePrice), tpOrdPx: '-1' } : {}),
    });
  },
};

// ---------------------------------------------------------------------------
// BITGET (api.bitget.com) — v2 mix: presetStop روی خود سفارش + امضای base64
// ---------------------------------------------------------------------------

const BITGET_BASE = 'https://api.bitget.com';

async function bitgetSigned(
  keys: ExchangeKeys,
  method: 'GET' | 'POST',
  path: string,
  bodyObj?: Record<string, unknown>,
  query = ''
): Promise<any> {
  const ts = Date.now().toString();
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  const sign = hmacSha256B64(keys.apiSecret, `${ts}${method}${path}${query}${body}`);
  const res = await fetch(`${BITGET_BASE}${path}${query}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'ACCESS-KEY': keys.apiKey,
      'ACCESS-SIGN': sign,
      'ACCESS-TIMESTAMP': ts,
      'ACCESS-PASSPHRASE': keys.passphrase ?? '',
    },
    body: body || undefined,
  });
  const data = (await res.json()) as { code: string; msg: string; data?: any };
  if (data.code !== '00000') throw new Error(`Bitget: ${data.msg ?? data.code}`);
  return data.data;
}

let bitgetContractsCache: { at: number; map: Record<string, { qtyStep: number; minQty: number }> } | null = null;

async function bitgetContracts(): Promise<Record<string, { qtyStep: number; minQty: number }>> {
  if (bitgetContractsCache && Date.now() - bitgetContractsCache.at < 3_600_000) return bitgetContractsCache.map;
  const res = await fetch(`${BITGET_BASE}/api/v2/mix/market/contracts?productType=USDT-FUTURES`);
  const data = (await res.json()) as { data?: any[] };
  const map: Record<string, { qtyStep: number; minQty: number }> = {};
  for (const c of data?.data ?? []) {
    const sym = String(c.symbol ?? '');
    if (!sym.endsWith('USDT')) continue;
    const prec = Number(c.quantityPrecision ?? c.numPrecision ?? 3);
    map[sym] = {
      qtyStep: c.stepVolume ? parseFloat(c.stepVolume) : Math.pow(10, -prec),
      minQty: parseFloat(c.minTradeNum ?? c.minQty ?? '0') || 0,
    };
  }
  if (Object.keys(map).length > 0) bitgetContractsCache = { at: Date.now(), map };
  return map;
}

const bitgetAdapter: FuturesAdapter = {
  id: 'bitget',
  executable: true,
  async priceMap() {
    const res = await fetch(`${BITGET_BASE}/api/v2/mix/market/tickers?productType=USDT-FUTURES`);
    const data = (await res.json()) as { data?: any[] };
    const map: Record<string, number> = {};
    for (const t of data?.data ?? []) {
      const sym = String(t.symbol ?? '');
      if (sym.endsWith('USDT')) map[sym] = parseFloat(t.lastPr ?? t.last ?? '0');
    }
    if (Object.keys(map).length === 0) throw new Error('Bitget: تیکرها خالی بود');
    return map;
  },
  async setLeverage(keys, symbol, leverage) {
    await bitgetSigned(keys, 'POST', '/api/v2/mix/account/set-leverage', {
      symbol,
      productType: 'USDT-FUTURES',
      marginCoin: 'USDT',
      leverage: String(leverage),
    });
  },
  async getFuturesBalance(keys) {
    const data = (await bitgetSigned(
      keys,
      'GET',
      '/api/v2/mix/account/accounts',
      undefined,
      '?productType=USDT-FUTURES'
    ).catch(() => null)) as any[] | null;
    const row = data?.[0];
    if (!row) return null;
    const available = parseFloat(row.available ?? '0');
    const equity = parseFloat(row.usdtEquity ?? row.accountEquity ?? '0');
    return { available: Number.isFinite(available) ? available : 0, equity: Number.isFinite(equity) ? equity : 0 };
  },
  async openMarket(keys, symbol, side, sizeUsd, leverage, stopPrice, takePrice) {
    const prices = await bitgetAdapter.priceMap().catch(() => ({}) as Record<string, number>);
    const last = prices[symbol] || stopPrice || takePrice;
    if (!(last > 0)) throw new Error('Bitget: قیمت نماد در دسترس نیست');
    const instr = (await bitgetContracts())[symbol];
    await bitgetAdapter.setLeverage(keys, symbol, leverage).catch(() => {});
    const qty = roundToStep((sizeUsd * leverage) / last, instr?.qtyStep ?? 0.001);
    if (!(qty > 0)) throw new Error('Bitget: حجم محاسبه‌شده نامعتبر است');
    const base = {
      symbol,
      productType: 'USDT-FUTURES',
      marginMode: 'isolated',
      marginCoin: 'USDT',
      size: String(qty),
      side: side === 'long' ? 'buy' : 'sell',
      orderType: 'market',
      force: 'gtc',
      ...(stopPrice > 0 ? { presetStopLossPrice: String(stopPrice) } : {}),
      ...(takePrice > 0 ? { presetStopSurplusPrice: String(takePrice) } : {}),
    };
    // یک‌طرفه؛ اگر حساب دوجهته باشد با tradeSide تلاش مجدد
    try {
      await bitgetSigned(keys, 'POST', '/api/v2/mix/order/place-order', base);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (/posSide|position mode|40774|40787/i.test(msg)) {
        await bitgetSigned(keys, 'POST', '/api/v2/mix/order/place-order', {
          ...base,
          tradeSide: 'open',
        });
      } else {
        throw e;
      }
    }
    return { qty };
  },
  async listPositions(keys) {
    const data = (await bitgetSigned(
      keys,
      'GET',
      '/api/v2/mix/position/all-position',
      undefined,
      '?productType=USDT-FUTURES&marginCoin=USDT'
    ).catch(() => [])) as any[];
    const rows: LivePositionRow[] = [];
    for (const p of data ?? []) {
      const qty = Number(p.total ?? p.positionAmount ?? 0);
      if (!(qty > 0)) continue;
      const isShort = String(p.posSide ?? p.holdSide ?? '').toLowerCase().includes('short') || String(p.posSide ?? '').toLowerCase() === 'sell';
      rows.push({
        symbol: String(p.symbol ?? ''),
        positionAmt: isShort ? String(-qty) : String(qty),
        markPrice: String(p.markPrice ?? p.currentPrice ?? 0),
        entryPrice: String(p.openPriceAvg ?? p.avgPrice ?? p.entryPrice ?? 0),
      });
    }
    return rows;
  },
  async closeAll(keys, symbol, side) {
    const rows = await bitgetAdapter.listPositions(keys);
    const row = rows.find((r) => r.symbol === symbol && parseFloat(r.positionAmt) !== 0);
    if (!row) return;
    const instr = (await bitgetContracts())[symbol];
    const qty = roundToStep(Math.abs(parseFloat(row.positionAmt)), instr?.qtyStep ?? 0.001);
    if (!(qty > 0)) return;
    const base = {
      symbol,
      productType: 'USDT-FUTURES',
      marginMode: 'isolated',
      marginCoin: 'USDT',
      size: String(qty),
      side: side === 'long' ? 'sell' : 'buy',
      orderType: 'market',
      force: 'gtc',
      reduceOnly: 'YES',
    };
    try {
      await bitgetSigned(keys, 'POST', '/api/v2/mix/order/place-order', base);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (/posSide|position mode|40774|40787/i.test(msg)) {
        await bitgetSigned(keys, 'POST', '/api/v2/mix/order/place-order', {
          ...base,
          tradeSide: 'close',
          reduceOnly: undefined as unknown as string,
        });
      } else {
        throw e;
      }
    }
  },
  async closePartial(keys, symbol, side, fraction) {
    const rows = await bitgetAdapter.listPositions(keys);
    const row = rows.find((r) => r.symbol === symbol && parseFloat(r.positionAmt) !== 0);
    if (!row) return;
    const instr = (await bitgetContracts())[symbol];
    const qty = roundToStep(Math.abs(parseFloat(row.positionAmt)) * Math.min(1, Math.max(0, fraction)), instr?.qtyStep ?? 0.001);
    if (!(qty > 0)) return;
    await bitgetSigned(keys, 'POST', '/api/v2/mix/order/place-order', {
      symbol,
      productType: 'USDT-FUTURES',
      marginMode: 'isolated',
      marginCoin: 'USDT',
      size: String(qty),
      side: side === 'long' ? 'sell' : 'buy',
      orderType: 'market',
      force: 'gtc',
      reduceOnly: 'YES',
    });
  },
  async updateTradingStop(keys, symbol, side, stopPrice, takePrice, _qty, updateTake) {
    // پلن‌های tpsl قبلی لغو و پلن جدید گذاشته می‌شود (fail-soft)
    try {
      const current = (await bitgetSigned(
        keys,
        'GET',
        '/api/v2/mix/order/current-plan-order',
        undefined,
        `?symbol=${symbol}&productType=USDT-FUTURES&planType=loss_plan&isPlan=1`
      )) as any;
      const list: any[] = Array.isArray(current) ? current : (current?.list ?? current?.data ?? []);
      for (const plan of list ?? []) {
        if (plan.orderId) {
          await bitgetSigned(keys, 'POST', '/api/v2/mix/order/cancel-plan-order', {
            symbol,
            productType: 'USDT-FUTURES',
            marginCoin: 'USDT',
            orderId: plan.orderId,
          }).catch(() => {});
        }
      }
    } catch {}
    const rows = await bitgetAdapter.listPositions(keys);
    const row = rows.find((r) => r.symbol === symbol && parseFloat(r.positionAmt) !== 0);
    if (!row) return;
    const instr = (await bitgetContracts())[symbol];
    const qty = roundToStep(Math.abs(parseFloat(row.positionAmt)), instr?.qtyStep ?? 0.001);
    await bitgetSigned(keys, 'POST', '/api/v2/mix/order/place-tpsl-order', {
      symbol,
      productType: 'USDT-FUTURES',
      marginCoin: 'USDT',
      planType: 'loss_plan',
      triggerPrice: String(stopPrice),
      triggerType: 'mark_price',
      holdSide: side === 'long' ? 'long' : 'short',
      size: String(qty),
      executePrice: '0',
      rangeType: '1',
    });
    if (updateTake && takePrice > 0) {
      await bitgetSigned(keys, 'POST', '/api/v2/mix/order/place-tpsl-order', {
        symbol,
        productType: 'USDT-FUTURES',
        marginCoin: 'USDT',
        planType: 'profit_plan',
        triggerPrice: String(takePrice),
        triggerType: 'mark_price',
        holdSide: side === 'long' ? 'long' : 'short',
        size: String(qty),
        executePrice: '0',
        rangeType: '1',
      });
    }
  },
};

// ---------------------------------------------------------------------------
// MEXC (api.mexc.com) — قرارداد آینده‌دار: امضای ApiKey+RequestTime+path،
// side عددی (۱/۳ باز کردن، ۲/۴ بستن)، حجم بر حسب «قرارداد» (setSize)،
// استاپ/حدسود با planorder جدا + safety-close.
// ---------------------------------------------------------------------------

const MEXC_BASE = 'https://api.mexc.com';

function mexcToSym(binanceSymbol: string): string {
  return binanceSymbol.replace(/USDT$/, '_USDT');
}
function mexcFromSym(exchangeSymbol: string): string {
  return exchangeSymbol.replace('_USDT', 'USDT');
}

async function mexcSigned(
  keys: ExchangeKeys,
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string | number | boolean> = {}
): Promise<any> {
  const ts = Date.now().toString();
  let auth = '';
  let url = `${MEXC_BASE}${path}`;
  let body: string | undefined;
  if (method === 'POST') {
    auth = JSON.stringify(params);
    body = auth;
  } else {
    const sorted: Record<string, string | number | boolean> = {};
    for (const k of Object.keys(params).sort()) sorted[k] = params[k];
    auth = formUrlencode(sorted);
    if (auth) url += `?${auth}`;
  }
  const sign = hmacSha256Hex(keys.apiSecret, `${keys.apiKey}${ts}${auth}`);
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ApiKey: keys.apiKey,
      'Request-Time': ts,
      Signature: sign,
      source: 'pampdumpcoins',
    },
    body,
  });
  const data = (await res.json()) as { success?: boolean; code?: number | string; msg?: string; data?: any };
  const ok = data.success === true || String(data.code ?? '') === '0' || String(data.code ?? '') === '200';
  if (!ok) throw new Error(`MEXC: ${data.msg ?? data.code}`);
  return data.data;
}

let mexcContractsCache: { at: number; map: Record<string, { setSize: number; minVol: number }> } | null = null;

async function mexcContracts(): Promise<Record<string, { setSize: number; minVol: number }>> {
  if (mexcContractsCache && Date.now() - mexcContractsCache.at < 3_600_000) return mexcContractsCache.map;
  const res = await fetch(`${MEXC_BASE}/api/v1/contract/detail`);
  const body = (await res.json()) as { data?: any[] };
  const map: Record<string, { setSize: number; minVol: number }> = {};
  for (const c of body?.data ?? []) {
    const sym = String(c.symbol ?? '');
    if (!sym.endsWith('_USDT')) continue;
    map[sym] = {
      setSize: parseFloat(c.setSize ?? '1') || 1,
      minVol: parseFloat(c.minVol ?? '1') || 1,
    };
  }
  if (Object.keys(map).length > 0) mexcContractsCache = { at: Date.now(), map };
  return map;
}

const mexcAdapter: FuturesAdapter = {
  id: 'mexc',
  executable: true,
  async priceMap() {
    const res = await fetch(`${MEXC_BASE}/api/v1/contract/ticker`);
    const body = (await res.json()) as { data?: any[] };
    const map: Record<string, number> = {};
    for (const t of body?.data ?? []) {
      const sym = String(t.symbol ?? '');
      if (sym.endsWith('_USDT')) map[mexcFromSym(sym)] = Number(t.lastPrice ?? t.price ?? 0);
    }
    if (Object.keys(map).length === 0) throw new Error('MEXC: تیکرها خالی بود');
    return map;
  },
  async setLeverage() {
    // لوریج مکسی روی قرارداد اعمال می‌شود (بعد از باز شدن پوزیشن، catch-soft)
  },
  async getFuturesBalance(keys) {
    const row = (await mexcSigned(keys, 'GET', '/api/v1/private/account/asset/USDT').catch(() => null)) as any;
    if (!row) return null;
    const available = parseFloat(row.availableBalance ?? '0');
    const equity = parseFloat(row.equity ?? row.cashBalance ?? '0');
    return { available: Number.isFinite(available) ? available : 0, equity: Number.isFinite(equity) ? equity : 0 };
  },
  async openMarket(keys, symbol, side, sizeUsd, leverage, stopPrice, takePrice) {
    const sym = mexcToSym(symbol);
    const prices = await mexcAdapter.priceMap().catch(() => ({}) as Record<string, number>);
    const last = prices[symbol] || stopPrice || takePrice;
    if (!(last > 0)) throw new Error('MEXC: قیمت نماد در دسترس نیست');
    const cc = (await mexcContracts())[sym];
    const contracts = Math.max(cc?.minVol ?? 1, Math.round((sizeUsd * leverage) / last / (cc?.setSize ?? 1)));
    // side: 1 باز کردن لانگ / 3 باز کردن شورت / type: 6 مارکت / openType: 1 ایزوله (v1.5.22)
    await mexcSigned(keys, 'POST', '/api/v1/private/order/create', {
      symbol: sym,
      vol: contracts,
      side: side === 'long' ? 1 : 3,
      type: 6,
      openType: 1,
    });
    // لوریج روی پوزیشن باز (catch-soft) — change_leverage positionId می‌خواهد
    try {
      const positions = (await mexcSigned(keys, 'GET', '/api/v1/private/position/open_positions')) as any[];
      const p = (positions ?? []).find((x) => x.symbol === sym);
      if (p?.positionId) {
        await mexcSigned(keys, 'POST', '/api/v1/private/position/change_leverage', {
          positionId: String(p.positionId),
          openType: 1,
          leverage,
          symbol: sym,
          positionType: side === 'long' ? 1 : 2,
        });
      }
    } catch {}
    // استاپ/حدسود جدا (planorder) — الگوی «اولویت حفاظت» مثل بیتیونیکس
    const closeSide = side === 'long' ? 4 : 2; // 4 بستن لانگ / 2 بستن شورت
    try {
      if (stopPrice > 0) {
        await mexcSigned(keys, 'POST', '/api/v1/private/planorder/place', {
          symbol: sym,
          vol: contracts,
          side: closeSide,
          type: 5,
          orderType: 5,
          openType: 1,
          triggerPrice: String(stopPrice),
          triggerType: side === 'long' ? 2 : 1, // لانگ: پایین‌تر فعال می‌شود
          executeCycle: 1,
          trend: 1,
        });
      }
      if (takePrice > 0) {
        await mexcSigned(keys, 'POST', '/api/v1/private/planorder/place', {
          symbol: sym,
          vol: contracts,
          side: closeSide,
          type: 5,
          orderType: 5,
          openType: 1,
          triggerPrice: String(takePrice),
          triggerType: side === 'long' ? 1 : 2,
          executeCycle: 1,
          trend: 1,
        });
      }
    } catch (e) {
      await mexcAdapter.closeAll(keys, symbol, side).catch(() => {});
      throw new Error(`MEXC: ثبت SL/TP ناموفق بود و پوزیشن برای امنیت بسته شد (${e instanceof Error ? e.message : 'خطا'})`);
    }
    return { qty: contracts * (cc?.setSize ?? 1) };
  },
  async listPositions(keys) {
    const positions = (await mexcSigned(keys, 'GET', '/api/v1/private/position/open_positions').catch(() => [])) as any[];
    const cc = await mexcContracts().catch(() => ({}) as Record<string, { setSize: number; minVol: number }>);
    const rows: LivePositionRow[] = [];
    for (const p of positions ?? []) {
      const contracts = Number(p.holdNum ?? 0);
      if (!(contracts > 0)) continue;
      const setSize = cc[String(p.symbol ?? '')]?.setSize ?? 1;
      const qty = contracts * setSize;
      const isShort = String(p.positionType ?? '') === '2';
      rows.push({
        symbol: mexcFromSym(String(p.symbol ?? '')),
        positionAmt: isShort ? String(-qty) : String(qty),
        markPrice: String(p.marketPrice ?? 0),
        entryPrice: String(p.holdAvgPrice ?? p.avgPrice ?? 0),
      });
    }
    return rows;
  },
  async closeAll(keys, symbol, side) {
    const positions = (await mexcSigned(keys, 'GET', '/api/v1/private/position/open_positions').catch(() => [])) as any[];
    const p = (positions ?? []).find((x) => mexcFromSym(x.symbol) === symbol);
    const contracts = p ? Number(p.holdNum ?? 0) : 0;
    if (!(contracts > 0)) return;
    await mexcSigned(keys, 'POST', '/api/v1/private/order/create', {
      symbol: mexcToSym(symbol),
      vol: contracts,
      side: side === 'long' ? 4 : 2,
      type: 6,
      openType: 1,
    });
  },
  async closePartial(keys, symbol, side, fraction) {
    const positions = (await mexcSigned(keys, 'GET', '/api/v1/private/position/open_positions').catch(() => [])) as any[];
    const p = (positions ?? []).find((x) => mexcFromSym(x.symbol) === symbol);
    const contracts = p ? Number(p.holdNum ?? 0) : 0;
    if (!(contracts > 0)) return;
    const vol = Math.max(1, Math.round(contracts * Math.min(1, Math.max(0, fraction))));
    if (!(vol > 0)) return;
    await mexcSigned(keys, 'POST', '/api/v1/private/order/create', {
      symbol: mexcToSym(symbol),
      vol,
      side: side === 'long' ? 4 : 2,
      type: 6,
      openType: 1,
    });
  },
  async updateTradingStop(keys, symbol, side, stopPrice, takePrice, _qty, updateTake) {
    // planorder جدید (fail-soft — قدیمی‌ها می‌مانند و اولین فعال‌شده پوزیشن را می‌بندد)
    const positions = (await mexcSigned(keys, 'GET', '/api/v1/private/position/open_positions').catch(() => [])) as any[];
    const p = (positions ?? []).find((x) => mexcFromSym(x.symbol) === symbol);
    const contracts = p ? Number(p.holdNum ?? 0) : 0;
    if (!(contracts > 0)) return;
    const sym = mexcToSym(symbol);
    const closeSide = side === 'long' ? 4 : 2;
    if (stopPrice > 0) {
      await mexcSigned(keys, 'POST', '/api/v1/private/planorder/place', {
        symbol: sym,
        vol: contracts,
        side: closeSide,
        type: 5,
        orderType: 5,
        openType: 1,
        triggerPrice: String(stopPrice),
        triggerType: side === 'long' ? 2 : 1,
        executeCycle: 1,
        trend: 1,
      });
    }
    if (updateTake && takePrice > 0) {
      await mexcSigned(keys, 'POST', '/api/v1/private/planorder/place', {
        symbol: sym,
        vol: contracts,
        side: closeSide,
        type: 5,
        orderType: 5,
        openType: 1,
        triggerPrice: String(takePrice),
        triggerType: side === 'long' ? 1 : 2,
        executeCycle: 1,
        trend: 1,
      });
    }
  },
};

// ---------------------------------------------------------------------------
// GATE.IO (api.gateio.ws) — فیوچرز USDT: سایز علامت‌دار بر حسب قرارداد
// (quanto_multiplier)، استاپ/حدسود با price_orders (rule 1/2).
// امضا همان الگوی تأییدشدهٔ موجود پروژه (HMAC-SHA512).
// ---------------------------------------------------------------------------

const GATE_BASE = 'https://api.gateio.ws';

function gateToSym(binanceSymbol: string): string {
  return binanceSymbol.replace(/USDT$/, '_USDT');
}
function gateFromSym(exchangeSymbol: string): string {
  return exchangeSymbol.replace('_USDT', 'USDT');
}

async function gateSigned(
  keys: ExchangeKeys,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  bodyObj?: Record<string, unknown>,
  query = ''
): Promise<any> {
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  const seconds = Math.floor(Date.now() / 1000).toString();
  const bodyHash = CryptoJS.SHA512(body).toString();
  const sign = CryptoJS.HmacSHA512(
    [method, path + query, query, bodyHash, seconds].join('\n'),
    keys.apiSecret
  ).toString(CryptoJS.enc.Hex);
  const res = await fetch(`${GATE_BASE}${path}${query}`, {
    method,
    headers: {
      KEY: keys.apiKey,
      SIGN: sign,
      Timestamp: seconds,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body || undefined,
  });
  const data = (await res.json()) as any;
  if (data && !Array.isArray(data) && (data.label !== undefined || data.message !== undefined)) {
    throw new Error(`Gate: ${String(data.label ?? '')} ${String(data.message ?? '')}`);
  }
  return data;
}

let gateContractsCache: { at: number; map: Record<string, { multiplier: number }> } | null = null;

async function gateContracts(): Promise<Record<string, { multiplier: number }>> {
  if (gateContractsCache && Date.now() - gateContractsCache.at < 3_600_000) return gateContractsCache.map;
  const res = await fetch(`${GATE_BASE}/api/v4/futures/usdt/contracts`);
  const arr = (await res.json()) as any[];
  const map: Record<string, { multiplier: number }> = {};
  for (const c of arr ?? []) {
    const name = String(c.name ?? '');
    if (!name.endsWith('_USDT')) continue;
    map[name] = { multiplier: parseFloat(c.quanto_multiplier ?? '1') || 1 };
  }
  if (Object.keys(map).length > 0) gateContractsCache = { at: Date.now(), map };
  return map;
}

/** استاپ/حدسود گیت: سفارش شرطی بسته‌شونده روی price_orders. */
async function gatePlaceTpsl(
  keys: ExchangeKeys,
  symbol: string,
  side: 'long' | 'short',
  contracts: number,
  isStop: boolean,
  price: number
): Promise<void> {
  const sym = gateToSym(symbol);
  const closeSize = side === 'long' ? -contracts : contracts;
  // rule: 1 یعنی قیمت ≥ تریگر، 2 یعنی ≤ تریگر (SL لانگ فعال‌شونده پایین، TP لانگ بالا)
  const rule = isStop ? (side === 'long' ? 2 : 1) : side === 'long' ? 1 : 2;
  await gateSigned(keys, 'POST', '/api/v4/futures/usdt/price_orders', {
    initial: {
      contract: sym,
      size: closeSize,
      price: '0',
      tif: 'ioc',
      reduce_only: true,
    },
    trigger: {
      price_type: 1, // قیمت مارک
      price: String(price),
      rule,
    },
  });
}

const gateAdapter: FuturesAdapter = {
  id: 'gateio',
  executable: true,
  async priceMap() {
    const res = await fetch(`${GATE_BASE}/api/v4/futures/usdt/tickers`);
    const arr = (await res.json()) as any[];
    const map: Record<string, number> = {};
    for (const t of arr ?? []) {
      const name = String(t.contract ?? '');
      if (name.endsWith('_USDT')) map[gateFromSym(name)] = parseFloat(t.last ?? '0');
    }
    if (Object.keys(map).length === 0) throw new Error('Gate: تیکرها خالی بود');
    return map;
  },
  async setLeverage(keys, symbol, leverage) {
    // v1.5.22 — ایزوله: در گیت «leverage مثبت = مارجین ایزوله با همان لوریج»
    // و cross_leverage_limit فقط برای کراس است → فقط leverage می‌فرستیم.
    try {
      await gateSigned(keys, 'POST', `/api/v4/futures/usdt/positions/${gateToSym(symbol)}/leverage`, {
        leverage: String(leverage),
      });
    } catch {
      // حالت دوجهته/کراس — غیرمرگبار
    }
  },
  async getFuturesBalance(keys) {
    const row = (await gateSigned(keys, 'GET', '/api/v4/futures/usdt/accounts').catch(() => null)) as any;
    if (!row) return null;
    const available = parseFloat(row.available ?? '0');
    const equity = parseFloat(row.total ?? '0');
    return { available: Number.isFinite(available) ? available : 0, equity: Number.isFinite(equity) ? equity : 0 };
  },
  async openMarket(keys, symbol, side, sizeUsd, leverage, stopPrice, takePrice) {
    const sym = gateToSym(symbol);
    const prices = await gateAdapter.priceMap().catch(() => ({}) as Record<string, number>);
    const last = prices[symbol] || stopPrice || takePrice;
    if (!(last > 0)) throw new Error('Gate: قیمت نماد در دسترس نیست');
    const cc = (await gateContracts())[sym];
    const mult = cc?.multiplier ?? 1;
    const contracts = Math.max(1, Math.round((sizeUsd * leverage) / last / mult));
    await gateAdapter.setLeverage(keys, symbol, leverage);
    // سایز مثبت = لانگ، منفی = شورت؛ price 0 + ioc = مارکت
    await gateSigned(keys, 'POST', '/api/v4/futures/usdt/orders', {
      contract: sym,
      size: side === 'long' ? contracts : -contracts,
      price: '0',
      tif: 'ioc',
    });
    // استاپ/حدسود جدا — الگوی «اولویت حفاظت»
    try {
      if (stopPrice > 0) await gatePlaceTpsl(keys, symbol, side, contracts, true, stopPrice);
      if (takePrice > 0) await gatePlaceTpsl(keys, symbol, side, contracts, false, takePrice);
    } catch (e) {
      await gateAdapter.closeAll(keys, symbol, side).catch(() => {});
      throw new Error(`Gate: ثبت SL/TP ناموفق بود و پوزیشن برای امنیت بسته شد (${e instanceof Error ? e.message : 'خطا'})`);
    }
    return { qty: contracts * mult };
  },
  async listPositions(keys) {
    const positions = (await gateSigned(keys, 'GET', '/api/v4/futures/usdt/positions').catch(() => [])) as any[];
    const cc = await gateContracts().catch(() => ({}) as Record<string, { multiplier: number }>);
    const rows: LivePositionRow[] = [];
    for (const p of positions ?? []) {
      const size = Number(p.size ?? 0);
      if (size === 0) continue;
      const mult = cc[String(p.contract ?? '')]?.multiplier ?? 1;
      const qty = Math.abs(size) * mult;
      rows.push({
        symbol: gateFromSym(String(p.contract ?? '')),
        positionAmt: size > 0 ? String(qty) : String(-qty),
        markPrice: String(p.mark_price ?? 0),
        entryPrice: String(p.entry_price ?? 0),
      });
    }
    return rows;
  },
  async closeAll(keys, symbol, _side) {
    // size:0 + close:true = بستن کامل پوزیشن
    await gateSigned(keys, 'POST', '/api/v4/futures/usdt/orders', {
      contract: gateToSym(symbol),
      size: 0,
      close: true,
      price: '0',
      tif: 'ioc',
    });
  },
  async closePartial(keys, symbol, side, fraction) {
    const rows = await gateAdapter.listPositions(keys);
    const row = rows.find((r) => r.symbol === symbol && parseFloat(r.positionAmt) !== 0);
    if (!row) return;
    const cc = (await gateContracts())[gateToSym(symbol)];
    const mult = cc?.multiplier ?? 1;
    const contracts = Math.max(1, Math.round((Math.abs(parseFloat(row.positionAmt)) * Math.min(1, Math.max(0, fraction))) / mult));
    await gateSigned(keys, 'POST', '/api/v4/futures/usdt/orders', {
      contract: gateToSym(symbol),
      size: side === 'long' ? -contracts : contracts,
      reduce_only: true,
      price: '0',
      tif: 'ioc',
    });
  },
  async updateTradingStop(keys, symbol, side, stopPrice, takePrice, _qty, updateTake) {
    // price_orders قدیمی این قرارداد لغو و جدید گذاشته می‌شود (fail-soft)
    try {
      const pending = (await gateSigned(
        keys,
        'GET',
        '/api/v4/futures/usdt/price_orders',
        undefined,
        `?contract=${gateToSym(symbol)}&status=open`
      )) as any[];
      for (const po of pending ?? []) {
        if (po.id) await gateSigned(keys, 'DELETE', `/api/v4/futures/usdt/price_orders/${po.id}`).catch(() => {});
      }
    } catch {}
    const rows = await gateAdapter.listPositions(keys);
    const row = rows.find((r) => r.symbol === symbol && parseFloat(r.positionAmt) !== 0);
    if (!row) return;
    const cc = (await gateContracts())[gateToSym(symbol)];
    const mult = cc?.multiplier ?? 1;
    const contracts = Math.max(1, Math.round(Math.abs(parseFloat(row.positionAmt)) / mult));
    if (stopPrice > 0) await gatePlaceTpsl(keys, symbol, side, contracts, true, stopPrice);
    if (updateTake && takePrice > 0) await gatePlaceTpsl(keys, symbol, side, contracts, false, takePrice);
  },
};

// ---------------------------------------------------------------------------
// KUCOIN FUTURES (api-futures.kucoin.com) — توکن bullet، هدرهای KC-API-*،
// نماد XBTUSDTM (بایننس BTC)، حجم بر حسب «لوت» (multiplier)،
// استاپ/حدسود پیوسته با triggerStopDown/UpPrice.
// ---------------------------------------------------------------------------

const KUCOIN_BASE = 'https://api-futures.kucoin.com';

function kucoinToSym(binanceSymbol: string): string {
  // کوکوین بیت‌کوین را XBT می‌نامد
  const base = binanceSymbol.replace(/USDT$/, '');
  return `${base === 'BTC' ? 'XBT' : base}USDTM`;
}
function kucoinFromSym(exchangeSymbol: string): string {
  const base = exchangeSymbol.replace(/USDTM$/, '');
  return `${base === 'XBT' ? 'BTC' : base}USDT`;
}

let kucoinTokenCache: { at: number; token: string } | null = null;

async function kucoinToken(keys: ExchangeKeys): Promise<string> {
  if (kucoinTokenCache && Date.now() - kucoinTokenCache.at < 3_600_000) return kucoinTokenCache.token;
  const ts = Date.now().toString();
  const sign = CryptoJS.HmacSHA256(`${ts}POST/api/v1/bullet-private`, keys.apiSecret).toString(CryptoJS.enc.Base64);
  const passphrase = CryptoJS.HmacSHA256(keys.passphrase ?? '', keys.apiSecret).toString(CryptoJS.enc.Base64);
  const res = await fetch(`${KUCOIN_BASE}/api/v1/bullet-private`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'KC-API-KEY': keys.apiKey,
      'KC-API-SIGN': sign,
      'KC-API-TIMESTAMP': ts,
      'KC-API-PASSPHRASE': passphrase,
      'KC-API-KEY-VERSION': '2',
    },
    body: JSON.stringify({}),
  });
  const data = (await res.json()) as { code?: string | number; data?: { token?: string } };
  const token = data?.data?.token;
  if (!token) throw new Error(`KuCoin: توکن نشد (${data.code ?? 'بدون توکن'})`);
  kucoinTokenCache = { at: Date.now(), token };
  return token;
}

async function kucoinSigned(
  keys: ExchangeKeys,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  bodyObj?: Record<string, unknown>,
  query = ''
): Promise<any> {
  const ts = Date.now().toString();
  const endpoint = path + query;
  const endpart = bodyObj ? JSON.stringify(bodyObj) : '';
  const sign = CryptoJS.HmacSHA256(`${ts}${method}${endpoint}${endpart}`, keys.apiSecret).toString(CryptoJS.enc.Base64);
  const token = await kucoinToken(keys).catch(() => '');
  const res = await fetch(`${KUCOIN_BASE}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'KC-API-KEY': keys.apiKey,
      'KC-API-SIGN': sign,
      'KC-API-TIMESTAMP': ts,
      'KC-API-PASSPHRASE': CryptoJS.HmacSHA256(keys.passphrase ?? '', keys.apiSecret).toString(CryptoJS.enc.Base64),
      'KC-API-KEY-VERSION': '2',
      ...(token ? { 'KC-API-TOKEN': token } : {}),
    },
    body: endpart || undefined,
  });
  const data = (await res.json()) as { code?: string | number; msg?: string; data?: any };
  if (String(data.code ?? '') !== '200000') throw new Error(`KuCoin: ${data.msg ?? data.code}`);
  return data.data;
}

let kucoinContractsCache: { at: number; map: Record<string, { multiplier: number; lotSize: number }> } | null = null;

async function kucoinContracts(): Promise<Record<string, { multiplier: number; lotSize: number }>> {
  if (kucoinContractsCache && Date.now() - kucoinContractsCache.at < 3_600_000) return kucoinContractsCache.map;
  const res = await fetch(`${KUCOIN_BASE}/api/v1/contracts/active`);
  const data = (await res.json()) as { data?: any[] };
  const map: Record<string, { multiplier: number; lotSize: number }> = {};
  for (const c of data?.data ?? []) {
    const sym = String(c.symbol ?? '');
    if (!sym.endsWith('USDTM')) continue;
    map[sym] = {
      multiplier: parseFloat(c.multiplier ?? '1') || 1,
      lotSize: parseInt(c.lotSize ?? '1', 10) || 1,
    };
  }
  if (Object.keys(map).length > 0) kucoinContractsCache = { at: Date.now(), map };
  return map;
}

const kucoinAdapter: FuturesAdapter = {
  id: 'kucoin',
  executable: true,
  async priceMap() {
    // تیکر همه‌گانی فیوچرز کوکوین نداریم؛ قیمت بایننس برای نمایش MTM کافی است
    return binanceAdapter.priceMap(60_000);
  },
  async setLeverage() {
    // لوریج کوکوین داخل خود سفارش ارسال می‌شود
  },
  async getFuturesBalance(keys) {
    const row = (await kucoinSigned(keys, 'GET', '/api/v1/account-overview', undefined, '?currency=USDT').catch(
      () => null
    )) as any;
    if (!row) return null;
    const equity = parseFloat(row.accountEquity ?? '0');
    const available = parseFloat(row.availableBalance ?? '0');
    return { available: Number.isFinite(available) ? available : 0, equity: Number.isFinite(equity) ? equity : 0 };
  },
  async openMarket(keys, symbol, side, sizeUsd, leverage, stopPrice, takePrice) {
    const sym = kucoinToSym(symbol);
    const prices = await binanceAdapter.priceMap(60_000).catch(() => ({}) as Record<string, number>);
    const last = prices[symbol] || stopPrice || takePrice;
    if (!(last > 0)) throw new Error('KuCoin: قیمت نماد در دسترس نیست');
    const cc = (await kucoinContracts())[sym];
    const mult = cc?.multiplier ?? 1;
    const lot = cc?.lotSize ?? 1;
    const contracts = Math.max(lot, Math.round((sizeUsd * leverage) / last / mult / lot) * lot);
    // v1.5.22 — «همهٔ پوزیشن‌های واقعی ایزوله»: مارجین‌مود نماد صریحاً روی
    // ایزوله می‌رود (کوکوین به‌طور پیش‌فرض ایزوله است؛ این فراخوانی مطمئن
    // می‌شود — اگر همین باشد/پشتیبانی نشود غیرمرگبار است).
    await kucoinSigned(keys, 'POST', '/api/v1/position/margin-mode', {
      symbol: sym,
      isolated: true,
    }).catch(() => {});
    // استاپ/حدسود روی خود سفارش (OCO پیوسته کوکوین)
    await kucoinSigned(keys, 'POST', '/api/v1/orders', {
      clientOid: randomHex(24),
      symbol: sym,
      side: side === 'long' ? 'buy' : 'sell',
      type: 'market',
      size: contracts,
      leverage,
      stopPriceType: 'MP',
      ...(stopPrice > 0 ? { triggerStopDownPrice: String(stopPrice) } : {}),
      ...(takePrice > 0 ? { triggerStopUpPrice: String(takePrice) } : {}),
    });
    return { qty: contracts * mult };
  },
  async listPositions(keys) {
    const positions = (await kucoinSigned(keys, 'GET', '/api/v1/positions').catch(() => [])) as any[];
    const cc = await kucoinContracts().catch(() => ({}) as Record<string, { multiplier: number; lotSize: number }>);
    const rows: LivePositionRow[] = [];
    for (const p of positions ?? []) {
      const size = Number(p.currentQty ?? 0);
      if (size === 0) continue;
      const mult = cc[String(p.symbol ?? '')]?.multiplier ?? 1;
      const qty = Math.abs(size) * mult;
      rows.push({
        symbol: kucoinFromSym(String(p.symbol ?? '')),
        positionAmt: size > 0 ? String(qty) : String(-qty),
        markPrice: String(p.markPrice ?? 0),
        entryPrice: String(p.avgEntryPrice ?? 0),
      });
    }
    return rows;
  },
  async closeAll(keys, symbol, side) {
    const rows = await kucoinAdapter.listPositions(keys);
    const row = rows.find((r) => r.symbol === symbol && parseFloat(r.positionAmt) !== 0);
    if (!row) return;
    const cc = (await kucoinContracts())[kucoinToSym(symbol)];
    const lot = cc?.lotSize ?? 1;
    const contracts = Math.max(lot, Math.round(Math.abs(parseFloat(row.positionAmt)) / (cc?.multiplier ?? 1)));
    await kucoinSigned(keys, 'POST', '/api/v1/orders', {
      clientOid: randomHex(24),
      symbol: kucoinToSym(symbol),
      side: side === 'long' ? 'sell' : 'buy',
      type: 'market',
      size: contracts,
      reduceOnly: true,
    });
  },
  async closePartial(keys, symbol, side, fraction) {
    const rows = await kucoinAdapter.listPositions(keys);
    const row = rows.find((r) => r.symbol === symbol && parseFloat(r.positionAmt) !== 0);
    if (!row) return;
    const cc = (await kucoinContracts())[kucoinToSym(symbol)];
    const lot = cc?.lotSize ?? 1;
    const mult = cc?.multiplier ?? 1;
    const contracts =
      Math.max(lot, Math.round((Math.abs(parseFloat(row.positionAmt)) * Math.min(1, Math.max(0, fraction))) / mult / lot) * lot);
    await kucoinSigned(keys, 'POST', '/api/v1/orders', {
      clientOid: randomHex(24),
      symbol: kucoinToSym(symbol),
      side: side === 'long' ? 'sell' : 'buy',
      type: 'market',
      size: contracts,
      reduceOnly: true,
    });
  },
  async updateTradingStop(keys, symbol, side, stopPrice, takePrice, _qty, updateTake) {
    // سفارش شرطی reduce-only جدید (fail-soft — استاپ قبلی می‌ماند)
    const rows = await kucoinAdapter.listPositions(keys);
    const row = rows.find((r) => r.symbol === symbol && parseFloat(r.positionAmt) !== 0);
    if (!row) return;
    const cc = (await kucoinContracts())[kucoinToSym(symbol)];
    const mult = cc?.multiplier ?? 1;
    const contracts = Math.max(1, Math.round(Math.abs(parseFloat(row.positionAmt)) / mult));
    await kucoinSigned(keys, 'POST', '/api/v1/orders', {
      clientOid: randomHex(24),
      symbol: kucoinToSym(symbol),
      side: side === 'long' ? 'sell' : 'buy',
      type: 'market',
      size: contracts,
      reduceOnly: true,
      stop: side === 'long' ? 'down' : 'up',
      stopPrice: String(stopPrice),
      stopPriceType: 'MP',
      ...(updateTake && takePrice > 0 ? { triggerStopUpPrice: String(takePrice) } : {}),
    });
  },
};

// ---------------------------------------------------------------------------
// OURBIT (futures.ourbit.com) — v1.5.22: صرافی یازدهم. فیوچرزش هم‌راستای API
// مکسی است (نماد BTC_USDT، side 1/3 باز و 4/2 بستن، type 6 مارکت، openType 1
// ایزوله، positionMode 2 یک‌طرفه)؛ امضا: هدر ApiKey/Request-Time/Signature =
// HMAC-SHA256(apiKey + ts + (POST: بدنهٔ JSON دقیق | GET: کوئری انکد مرتب)).
// TP/SL با stoporder/change_price روی orderId سفارش بازشده.
// ---------------------------------------------------------------------------

const OURBIT_BASE = 'https://futures.ourbit.com';

function ourbitToSym(binanceSymbol: string): string {
  return binanceSymbol.replace(/USDT$/, '_USDT');
}
function ourbitFromSym(exchangeSymbol: string): string {
  return exchangeSymbol.replace('_USDT', 'USDT');
}

async function ourbitSigned(
  keys: ExchangeKeys,
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string | number | boolean> = {}
): Promise<any> {
  const ts = Date.now().toString();
  let auth = '';
  let url = `${OURBIT_BASE}${path}`;
  let body: string | undefined;
  if (method === 'POST') {
    auth = JSON.stringify(params);
    body = auth;
  } else {
    const sorted: Record<string, string | number | boolean> = {};
    for (const k of Object.keys(params).sort()) sorted[k] = params[k];
    auth = formUrlencode(sorted);
    if (auth) url += `?${auth}`;
  }
  const sign = hmacSha256Hex(keys.apiSecret, `${keys.apiKey}${ts}${auth}`);
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ApiKey: keys.apiKey,
      'Request-Time': ts,
      Signature: sign,
    },
    body,
  });
  const data = (await res.json()) as { success?: boolean; code?: number | string; msg?: string; data?: any };
  const ok = data.success === true || String(data.code ?? '') === '0' || String(data.code ?? '') === '200';
  if (!ok) throw new Error(`Ourbit: ${data.msg ?? data.code}`);
  return data.data;
}

let ourbitContractsCache: { at: number; map: Record<string, { setSize: number; minVol: number }> } | null = null;

async function ourbitContracts(): Promise<Record<string, { setSize: number; minVol: number }>> {
  if (ourbitContractsCache && Date.now() - ourbitContractsCache.at < 3_600_000) return ourbitContractsCache.map;
  const res = await fetch(`${OURBIT_BASE}/api/v1/contract/detail`);
  const body = (await res.json()) as { data?: any[] };
  const map: Record<string, { setSize: number; minVol: number }> = {};
  for (const c of body?.data ?? []) {
    const sym = String(c.symbol ?? '');
    if (!sym.endsWith('_USDT')) continue;
    map[sym] = {
      setSize: parseFloat(c.setSize ?? '1') || 1,
      minVol: parseFloat(c.minVol ?? '1') || 1,
    };
  }
  if (Object.keys(map).length > 0) ourbitContractsCache = { at: Date.now(), map };
  return map;
}

const ourbitAdapter: FuturesAdapter = {
  id: 'ourbit',
  executable: true,
  async priceMap() {
    const res = await fetch(`${OURBIT_BASE}/api/v1/contract/ticker`);
    const body = (await res.json()) as { data?: any[] };
    const map: Record<string, number> = {};
    for (const t of body?.data ?? []) {
      const sym = String(t.symbol ?? '');
      if (sym.endsWith('_USDT')) map[ourbitFromSym(sym)] = Number(t.lastPrice ?? t.price ?? 0);
    }
    if (Object.keys(map).length === 0) throw new Error('Ourbit: تیکرها خالی بود');
    return map;
  },
  async setLeverage() {
    // لوریج اوربیت روی پوزیشن باز اعمال می‌شود (بعد از باز شدن، catch-soft)
  },
  async getFuturesBalance(keys) {
    const row = (await ourbitSigned(keys, 'GET', '/api/v1/private/account/asset/USDT').catch(() => null)) as any;
    if (!row) return null;
    const available = parseFloat(row.availableBalance ?? '0');
    const equity = parseFloat(row.equity ?? row.cashBalance ?? '0');
    return { available: Number.isFinite(available) ? available : 0, equity: Number.isFinite(equity) ? equity : 0 };
  },
  async openMarket(keys, symbol, side, sizeUsd, leverage, stopPrice, takePrice) {
    const sym = ourbitToSym(symbol);
    const prices = await ourbitAdapter.priceMap().catch(() => ({}) as Record<string, number>);
    const last = prices[symbol] || stopPrice || takePrice;
    if (!(last > 0)) throw new Error('Ourbit: قیمت نماد در دسترس نیست');
    const cc = (await ourbitContracts())[sym];
    const contracts = Math.max(cc?.minVol ?? 1, Math.round((sizeUsd * leverage) / last / (cc?.setSize ?? 1)));
    // side: 1 باز کردن لانگ / 3 باز کردن شورت / type: 6 مارکت / openType: 1 ایزوله
    const res = (await ourbitSigned(keys, 'POST', '/api/v1/private/order/submit', {
      symbol: sym,
      vol: contracts,
      leverage,
      side: side === 'long' ? 1 : 3,
      type: 6,
      openType: 1,
      positionMode: 2,
    })) as { orderId?: string | number } | undefined;
    // لوریج روی پوزیشن باز (catch-soft)
    try {
      const positions = (await ourbitSigned(keys, 'GET', '/api/v1/private/position/open_positions')) as any[];
      const p = (positions ?? []).find((x) => x.symbol === sym);
      if (p?.positionId) {
        await ourbitSigned(keys, 'POST', '/api/v1/private/position/change_leverage', {
          positionId: String(p.positionId),
          openType: 1,
          leverage,
          symbol: sym,
          positionType: side === 'long' ? 1 : 2,
        });
      }
    } catch {}
    // TP/SL روی orderId سفارش بازشده (change_price) — «اولویت حفاظت»
    const orderId = res?.orderId;
    try {
      if (orderId && (stopPrice > 0 || takePrice > 0)) {
        await ourbitSigned(keys, 'POST', '/api/v1/private/stoporder/change_price', {
          orderId: String(orderId),
          ...(stopPrice > 0 ? { stopLossPrice: String(stopPrice) } : {}),
          ...(takePrice > 0 ? { takeProfitPrice: String(takePrice) } : {}),
        });
      }
    } catch (e) {
      await ourbitAdapter.closeAll(keys, symbol, side).catch(() => {});
      throw new Error(`Ourbit: ثبت SL/TP ناموفق بود و پوزیشن برای امنیت بسته شد (${e instanceof Error ? e.message : 'خطا'})`);
    }
    return { qty: contracts * (cc?.setSize ?? 1) };
  },
  async listPositions(keys) {
    const positions = (await ourbitSigned(keys, 'GET', '/api/v1/private/position/open_positions').catch(() => [])) as any[];
    const cc = await ourbitContracts().catch(() => ({}) as Record<string, { setSize: number; minVol: number }>);
    const rows: LivePositionRow[] = [];
    for (const p of positions ?? []) {
      const contracts = Number(p.holdNum ?? 0);
      if (!(contracts > 0)) continue;
      const setSize = cc[String(p.symbol ?? '')]?.setSize ?? 1;
      const qty = contracts * setSize;
      const isShort = String(p.positionType ?? '') === '2';
      rows.push({
        symbol: ourbitFromSym(String(p.symbol ?? '')),
        positionAmt: isShort ? String(-qty) : String(qty),
        markPrice: String(p.marketPrice ?? 0),
        entryPrice: String(p.holdAvgPrice ?? p.avgPrice ?? 0),
      });
    }
    return rows;
  },
  async closeAll(keys, symbol, side) {
    const positions = (await ourbitSigned(keys, 'GET', '/api/v1/private/position/open_positions').catch(() => [])) as any[];
    const p = (positions ?? []).find((x) => ourbitFromSym(x.symbol) === symbol);
    const contracts = p ? Number(p.holdNum ?? 0) : 0;
    if (!(contracts > 0)) return;
    await ourbitSigned(keys, 'POST', '/api/v1/private/order/create', {
      symbol: ourbitToSym(symbol),
      vol: contracts,
      side: side === 'long' ? 4 : 2,
      type: 6,
      openType: 1,
    });
  },
  async closePartial(keys, symbol, side, fraction) {
    const positions = (await ourbitSigned(keys, 'GET', '/api/v1/private/position/open_positions').catch(() => [])) as any[];
    const p = (positions ?? []).find((x) => ourbitFromSym(x.symbol) === symbol);
    const contracts = p ? Number(p.holdNum ?? 0) : 0;
    if (!(contracts > 0)) return;
    const vol = Math.max(1, Math.round(contracts * Math.min(1, Math.max(0, fraction))));
    if (!(vol > 0)) return;
    await ourbitSigned(keys, 'POST', '/api/v1/private/order/create', {
      symbol: ourbitToSym(symbol),
      vol,
      side: side === 'long' ? 4 : 2,
      type: 6,
      openType: 1,
    });
  },
  async updateTradingStop(keys, symbol, side, stopPrice, takePrice, _qty, updateTake) {
    // TP/SL روی پوزیشن باز با positionId — planorder مثل مکسی (fail-soft)
    const positions = (await ourbitSigned(keys, 'GET', '/api/v1/private/position/open_positions').catch(() => [])) as any[];
    const p = (positions ?? []).find((x) => ourbitFromSym(x.symbol) === symbol);
    const contracts = p ? Number(p.holdNum ?? 0) : 0;
    if (!(contracts > 0)) return;
    const sym = ourbitToSym(symbol);
    const closeSide = side === 'long' ? 4 : 2;
    if (stopPrice > 0) {
      await ourbitSigned(keys, 'POST', '/api/v1/private/planorder/place', {
        symbol: sym,
        vol: contracts,
        side: closeSide,
        type: 5,
        orderType: 5,
        openType: 1,
        triggerPrice: String(stopPrice),
        triggerType: side === 'long' ? 2 : 1,
        executeCycle: 1,
        trend: 1,
      });
    }
    if (updateTake && takePrice > 0) {
      await ourbitSigned(keys, 'POST', '/api/v1/private/planorder/place', {
        symbol: sym,
        vol: contracts,
        side: closeSide,
        type: 5,
        orderType: 5,
        openType: 1,
        triggerPrice: String(takePrice),
        triggerType: side === 'long' ? 1 : 2,
        executeCycle: 1,
        trend: 1,
      });
    }
  },
};

// ---------------------------------------------------------------------------

/** آداپتورهای دارای اجرای کامل — به‌ترتیب اولویت نمایش. */
const EXECUTABLE_ADAPTERS: Record<string, FuturesAdapter> = {
  binance: binanceAdapter,
  bybit: bybitAdapter,
  bitunix: bitunixAdapter,
  toobit: toobitAdapter,
  bingx: bingxAdapter,
  okx: okxAdapter,
  bitget: bitgetAdapter,
  mexc: mexcAdapter,
  ourbit: ourbitAdapter,
  gateio: gateAdapter,
  kucoin: kucoinAdapter,
};

/** شناسهٔ صرافی‌های دارای اجرای کامل (برای متن‌های UI — شامل بایننس). */
export const EXECUTABLE_EXCHANGE_IDS: ExchangeId[] = Object.keys(EXECUTABLE_ADAPTERS) as ExchangeId[];

/** صرافی‌هایی که کلیدشان علاوه بر api-key/secret به passphrase هم نیاز دارد. */
const PASSPHRASE_EXCHANGES: ExchangeId[] = ['okx', 'bitget', 'kucoin'];

export function exchangeNeedsPassphrase(exchangeId: ExchangeId | undefined): boolean {
  return !!exchangeId && PASSPHRASE_EXCHANGES.includes(exchangeId);
}

/** آداپتور صرافی؛ برای صرافی‌های «به‌زودی» undefined برمی‌گردد. */
export function futuresAdapterFor(exchangeId: ExchangeId | undefined): FuturesAdapter | undefined {
  if (!exchangeId) return binanceAdapter;
  return EXECUTABLE_ADAPTERS[exchangeId];
}

/** آیا اجرای ربات روی این صرافی الان ممکن است؟ */
export function isExchangeExecutable(exchangeId: ExchangeId | undefined): boolean {
  return !!futuresAdapterFor(exchangeId);
}

/** قیمت‌های MTM: نقشهٔ صرافی انتخابی با fallback بایننس. */
export async function futuresPriceMap(exchangeId: ExchangeId | undefined, maxAgeMs = 30_000): Promise<Record<string, number>> {
  const ad = futuresAdapterFor(exchangeId);
  if (ad) {
    try {
      return await ad.priceMap(maxAgeMs);
    } catch {}
  }
  return binanceAdapter.priceMap(maxAgeMs);
}

/** فقط روی دستگاه‌های نیتیو (وب fetch با هدرهای سفارشی CORS دارد — اجرای واقعی روی وب نیست). */
export function futuresExecutionAllowed(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}
