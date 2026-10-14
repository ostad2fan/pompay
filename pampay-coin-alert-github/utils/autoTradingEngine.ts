/**
 * autoTradingEngine.ts — v1.4.19
 *
 * «معامله‌گر خودکار» — copies WHALE positions and trades INDICATOR signals
 * automatically, in DEMO or REAL mode, with the user's own risk settings:
 *
 *   • انتخاب منبع: نهنگِ ردیابی‌شده (کپی پوزیشن باز/بسته) و/یا اندیکاتورهای
 *     آماده/دستی — هر سیگنال بیاید، معامله اتوماتیک باز می‌شود.
 *   • تنظیمات هر معامله: لوریج، حجم (دلاری)، حداکثر ضرر (٪ → استاپ‌لاس
 *     اتوماتیک نسبت به نقطه ورود) و ریوارد R:R (→ تیک‌پرافیت اتوماتیک).
 *   • حالت دمو: پوزیشن‌های شبیه‌سازی‌شده روی دستگاه — SL/TP ساعت‌شمار
 *     با قیمت لحظه‌ای بایننس چک می‌شود.
 *   • حالت واقعی: سفارش مارکت + استاپ مارکت + تیک‌پرافیت مارکت روی
 *     فیوچرز بایننس با کلید API خود کاربر (همان utils/binanceFuturesTrading).
 *
 * Engine lifecycle: the UI (real-trade screen) runs runAutoCycle() on an
 * interval while the bot is enabled and the screen is open. Real-mode keys
 * never leave the device.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  fetchAccountState,
  fetchAllMids,
  parsePositions,
} from './hyperliquidApi';
import {
  closePosition as closeRealPosition,
  openRealPosition,
} from './binanceFuturesTrading';
import { getUserIndicators, scanCustomIndicators } from './customIndicatorsService';
import type { CustomIndicatorSignal } from './customIndicatorsService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AutoMode = 'demo' | 'real';

export interface AutoWhaleSource {
  enabled: boolean;
  /** Hyperliquid address of the tracked whale to mirror. */
  address: string;
  label: string;
  /** true = same direction as the whale (کپی مستقیم). */
  mirrorSide: boolean;
}

export interface AutoIndicatorSource {
  enabled: boolean;
  /** selected custom-indicator ids (from getUserIndicators). */
  indicatorIds: string[];
}

export interface AutoTradeSettings {
  enabled: boolean;
  mode: AutoMode;
  whale: AutoWhaleSource;
  indicators: AutoIndicatorSource;
  /** لوریج هر پوزیشن */
  leverage: number;
  /** حجم هر پوزیشن (دلار مارجین) */
  positionSizeUsd: number;
  /** حداکثر ضرر — درصدِ حجم → فاصله استاپ‌لاس از نقطه ورود */
  maxLossPercent: number;
  /** ریوارد R:R — تیک‌پرافیت = فاصله استاپ × این عدد */
  rewardRatio: number;
  /** حداکثر پوزیشن باز همزمان */
  maxOpenPositions: number;
}

export interface DemoAutoPosition {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  qty: number;
  sizeUsd: number;
  leverage: number;
  stopPrice: number;
  takePrice: number;
  openedAt: number;
  source: 'whale' | 'indicator';
  sourceLabel: string;
  status: 'open' | 'closed';
  lastPrice: number;
  closeReason?: 'stop' | 'take' | 'signal' | 'whale-close' | 'manual';
  closedAt?: number;
  realizedPnl?: number;
}

export interface AutoEngineLog {
  id: string;
  at: number;
  kind: 'open' | 'close' | 'error' | 'info';
  message: string;
}

export interface AutoCycleResult {
  opened: number;
  closed: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const SETTINGS_KEY = '@auto_trade_settings_v2';
const DEMO_POSITIONS_KEY = '@auto_trade_demo_positions_v1';
const WHALE_SNAPSHOT_KEY = '@auto_trade_whale_snapshot_v1';
const LAST_SIGNAL_AT_KEY = '@auto_trade_last_signal_at_v1';
const LOG_KEY = '@auto_trade_engine_log_v1';

export const DEFAULT_AUTO_SETTINGS: AutoTradeSettings = {
  enabled: false,
  mode: 'demo',
  whale: { enabled: false, address: '', label: '', mirrorSide: true },
  indicators: { enabled: false, indicatorIds: [] },
  leverage: 5,
  positionSizeUsd: 50,
  maxLossPercent: 5,
  rewardRatio: 2,
  maxOpenPositions: 3,
};

export async function loadAutoSettings(): Promise<AutoTradeSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_AUTO_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AutoTradeSettings>;
    return { ...DEFAULT_AUTO_SETTINGS, ...parsed, whale: { ...DEFAULT_AUTO_SETTINGS.whale, ...parsed.whale }, indicators: { ...DEFAULT_AUTO_SETTINGS.indicators, ...parsed.indicators } };
  } catch {
    return DEFAULT_AUTO_SETTINGS;
  }
}

export async function saveAutoSettings(s: AutoTradeSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export async function loadDemoPositions(): Promise<DemoAutoPosition[]> {
  try {
    const raw = await AsyncStorage.getItem(DEMO_POSITIONS_KEY);
    return raw ? (JSON.parse(raw) as DemoAutoPosition[]) : [];
  } catch {
    return [];
  }
}

export async function saveDemoPositions(list: DemoAutoPosition[]): Promise<void> {
  await AsyncStorage.setItem(DEMO_POSITIONS_KEY, JSON.stringify(list));
}

export async function getAutoLogs(): Promise<AutoEngineLog[]> {
  try {
    const raw = await AsyncStorage.getItem(LOG_KEY);
    return raw ? (JSON.parse(raw) as AutoEngineLog[]) : [];
  } catch {
    return [];
  }
}

async function appendLog(kind: AutoEngineLog['kind'], message: string): Promise<void> {
  try {
    const logs = await getAutoLogs();
    logs.unshift({ id: `l-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), kind, message });
    await AsyncStorage.setItem(LOG_KEY, JSON.stringify(logs.slice(0, 60)));
  } catch {}
}

// ---------------------------------------------------------------------------
// Price helpers
// ---------------------------------------------------------------------------

let binanceTickerCache: { at: number; map: Record<string, number> } | null = null;

async function getBinancePrices(): Promise<Record<string, number>> {
  if (binanceTickerCache && Date.now() - binanceTickerCache.at < 30_000) {
    return binanceTickerCache.map;
  }
  const map: Record<string, number> = {};
  try {
    const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/price');
    if (res.ok) {
      const rows = (await res.json()) as { symbol: string; price: string }[];
      for (const r of rows) map[r.symbol] = parseFloat(r.price);
    }
  } catch {}
  binanceTickerCache = { at: Date.now(), map };
  return map;
}

// ---------------------------------------------------------------------------
// SL/TP math — «خودش اتومات استاپ و تیپی را نسبت به نقطه ورود بگذارد»
// ---------------------------------------------------------------------------

export function computeStopTake(
  side: 'long' | 'short',
  entry: number,
  maxLossPercent: number,
  rewardRatio: number
): { stopPrice: number; takePrice: number } {
  // loss distance = maxLossPercent of the position VALUE (notional) → as a
  // price fraction this equals maxLossPercent/leverage-free price distance:
  // risk fraction of price = maxLossPercent / 100 (of notional) ÷ 1 → the
  // simple, robust interpretation users expect: x% below/above entry.
  const risk = (Math.max(0.5, Math.min(90, maxLossPercent)) / 100) * entry;
  const stopPrice = side === 'long' ? entry - risk : entry + risk;
  const takePrice =
    side === 'long' ? entry + risk * Math.max(0.5, rewardRatio) : entry - risk * Math.max(0.5, rewardRatio);
  return { stopPrice, takePrice };
}

// ---------------------------------------------------------------------------
// Demo positions
// ---------------------------------------------------------------------------

async function openDemo(
  settings: AutoTradeSettings,
  symbol: string,
  side: 'long' | 'short',
  price: number,
  source: 'whale' | 'indicator',
  sourceLabel: string
): Promise<boolean> {
  const positions = await loadDemoPositions();
  if (positions.filter((p) => p.status === 'open').length >= settings.maxOpenPositions) return false;
  // one position per symbol+side — stacking the same signal is not useful
  if (positions.some((p) => p.status === 'open' && p.symbol === symbol && p.side === side)) return false;
  const { stopPrice, takePrice } = computeStopTake(side, price, settings.maxLossPercent, settings.rewardRatio);
  const qty = settings.positionSizeUsd * settings.leverage / price;
  const pos: DemoAutoPosition = {
    id: `d-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    symbol,
    side,
    entryPrice: price,
    qty,
    sizeUsd: settings.positionSizeUsd,
    leverage: settings.leverage,
    stopPrice,
    takePrice,
    openedAt: Date.now(),
    source,
    sourceLabel,
    status: 'open',
    lastPrice: price,
  };
  await saveDemoPositions([pos, ...positions]);
  await appendLog('open', `دمو ${side === 'long' ? 'خرید' : 'فروش'} ${symbol} @ ${price} (${sourceLabel}) — SL ${stopPrice.toFixed(4)} / TP ${takePrice.toFixed(4)}`);
  return true;
}

async function closeDemo(
  id: string,
  price: number,
  reason: DemoAutoPosition['closeReason']
): Promise<boolean> {
  const positions = await loadDemoPositions();
  const idx = positions.findIndex((p) => p.id === id && p.status === 'open');
  if (idx < 0) return false;
  const p = positions[idx];
  const dir = p.side === 'long' ? 1 : -1;
  const pnl = (price - p.entryPrice) * dir * p.qty;
  positions[idx] = { ...p, status: 'closed', closedAt: Date.now(), closeReason: reason, realizedPnl: pnl, lastPrice: price };
  await saveDemoPositions(positions);
  await appendLog('close', `بستن دمو ${p.symbol} (${reason === 'stop' ? 'استاپ' : reason === 'take' ? 'تیک‌پرافیت' : reason === 'whale-close' ? 'بستن نهنگ' : 'سیگنال'}): ${pnl >= 0 ? '+' : '−'}$${Math.abs(pnl).toFixed(2)}`);
  return true;
}

/** mark-to-market + SL/TP trigger checks for all open demo positions */
async function markDemoPositions(prices: Record<string, number>): Promise<number> {
  const positions = await loadDemoPositions();
  let changed = 0;
  let closedAny = false;
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    if (p.status !== 'open') continue;
    const px = prices[`${p.symbol}USDT`];
    if (!px || !(px > 0)) continue;
    positions[i].lastPrice = px;
    changed++;
    const hitStop = p.side === 'long' ? px <= p.stopPrice : px >= p.stopPrice;
    const hitTake = p.side === 'long' ? px >= p.takePrice : px <= p.takePrice;
    if (hitStop || hitTake) {
      closedAny = true;
      const dir = p.side === 'long' ? 1 : -1;
      const exit = hitStop ? p.stopPrice : p.takePrice;
      const pnl = (exit - p.entryPrice) * dir * p.qty;
      positions[i] = {
        ...positions[i],
        status: 'closed',
        closedAt: Date.now(),
        closeReason: hitStop ? 'stop' : 'take',
        realizedPnl: pnl,
        lastPrice: px,
      };
      await appendLog('close', `بستن دمو ${p.symbol} (${hitStop ? 'استاپ‌لاس' : 'تیک‌پرافیت'}): ${pnl >= 0 ? '+' : '−'}$${Math.abs(pnl).toFixed(2)}`);
    }
  }
  if (changed > 0 || closedAny) await saveDemoPositions(positions);
  return 0;
}

// ---------------------------------------------------------------------------
// Whale mirror — diff Hyperliquid positions vs the stored snapshot
// ---------------------------------------------------------------------------

interface WhaleSnapshotEntry {
  coin: string;
  side: 'long' | 'short';
  szi: number;
}

async function loadWhaleSnapshot(): Promise<WhaleSnapshotEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(WHALE_SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as WhaleSnapshotEntry[]) : [];
  } catch {
    return [];
  }
}

async function saveWhaleSnapshot(list: WhaleSnapshotEntry[]): Promise<void> {
  await AsyncStorage.setItem(WHALE_SNAPSHOT_KEY, JSON.stringify(list));
}

function diffWhalePositions(
  prev: WhaleSnapshotEntry[],
  next: WhaleSnapshotEntry[]
): { opened: { coin: string; side: 'long' | 'short' }[]; closed: { coin: string; side: 'long' | 'short' }[] } {
  const key = (p: { coin: string; side: string }) => `${p.coin}:${p.side}`;
  const prevMap = new Map(prev.map((p) => [key(p), p]));
  const nextMap = new Map(next.map((p) => [key(p), p]));
  const opened: { coin: string; side: 'long' | 'short' }[] = [];
  const closed: { coin: string; side: 'long' | 'short' }[] = [];
  for (const [k, p] of nextMap) if (!prevMap.has(k)) opened.push({ coin: p.coin, side: p.side });
  for (const [k, p] of prevMap) if (!nextMap.has(k)) closed.push({ coin: p.coin, side: p.side });
  return { opened, closed };
}

// ---------------------------------------------------------------------------
// Indicator signals — new signals of the SELECTED indicators
// ---------------------------------------------------------------------------

async function collectNewIndicatorSignals(
  settings: AutoTradeSettings
): Promise<CustomIndicatorSignal[]> {
  if (!settings.indicators.enabled || settings.indicators.indicatorIds.length === 0) return [];
  let scan: { signals: CustomIndicatorSignal[] } | null = null;
  try {
    scan = await scanCustomIndicators();
  } catch {
    return [];
  }
  if (!scan || !Array.isArray(scan.signals)) return [];
  let lastAt = 0;
  try {
    lastAt = Number((await AsyncStorage.getItem(LAST_SIGNAL_AT_KEY)) ?? 0) || 0;
  } catch {}
  const fresh = scan.signals.filter(
    (s) =>
      settings.indicators.indicatorIds.includes(s.indicatorId) &&
      s.detectedAt > lastAt
  );
  if (scan.signals.length > 0) {
    const maxAt = Math.max(...scan.signals.map((s) => s.detectedAt));
    if (maxAt > lastAt) await AsyncStorage.setItem(LAST_SIGNAL_AT_KEY, String(maxAt));
  }
  return fresh;
}

// ---------------------------------------------------------------------------
// REAL execution (Binance futures — keys stay on the device)
// ---------------------------------------------------------------------------

export interface RealKeys {
  apiKey: string;
  apiSecret: string;
}

async function openReal(
  settings: AutoTradeSettings,
  keys: RealKeys,
  symbol: string,
  side: 'long' | 'short',
  price: number,
  sourceLabel: string
): Promise<void> {
  const { stopPrice, takePrice } = computeStopTake(side, price, settings.maxLossPercent, settings.rewardRatio);
  await openRealPosition(
    keys.apiKey,
    keys.apiSecret,
    `${symbol}USDT`,
    side,
    settings.positionSizeUsd,
    settings.leverage,
    Number(stopPrice.toFixed(6)),
    Number(takePrice.toFixed(6))
  );
  await appendLog('open', `واقعی ${side === 'long' ? 'خرید' : 'فروش'} ${symbol} @ ~${price} (${sourceLabel}) — SL ${stopPrice.toFixed(4)} / TP ${takePrice.toFixed(4)}`);
}

async function closeReal(keys: RealKeys, symbol: string, side: 'long' | 'short'): Promise<void> {
  // closePosition takes positionAmt (signed) — long = +, short = −
  const positionAmt = side === 'long' ? 1 : -1;
  await closeRealPosition(keys.apiKey, keys.apiSecret, `${symbol}USDT`, positionAmt);
  await appendLog('close', `بستن واقعی ${symbol} (${side === 'long' ? 'لانگ' : 'شورت'}) — کپی بستن نهنگ`);
}

// ---------------------------------------------------------------------------
// THE CYCLE — run every ~60s while the bot is on
// ---------------------------------------------------------------------------

export interface RunCycleCtx {
  settings: AutoTradeSettings;
  /** required only for mode === 'real' */
  realKeys?: RealKeys;
}

export async function runAutoCycle(ctx: RunCycleCtx): Promise<AutoCycleResult> {
  const { settings } = ctx;
  const result: AutoCycleResult = { opened: 0, closed: 0, errors: [] };
  if (!settings.enabled) return result;

  const prices = await getBinancePrices().catch(() => ({}) as Record<string, number>);

  try {
    // 1) demo mark-to-market + SL/TP checks (always — even real mode has no
    //    demo positions, this is a cheap no-op then)
    await markDemoPositions(prices);
  } catch (e) {
    result.errors.push(`MTM: ${e instanceof Error ? e.message : 'خطا'}`);
  }

  // 2) whale mirror
  if (settings.whale.enabled && settings.whale.address) {
    try {
      const state = await fetchAccountState(settings.whale.address);
      const positions = await parsePositions(state, {});
      const next: WhaleSnapshotEntry[] = positions.map((p) => ({
        coin: p.symbol,
        side: p.side,
        szi: p.size,
      }));
      const prev = await loadWhaleSnapshot();
      const { opened, closed } = diffWhalePositions(prev, next);
      for (const o of opened) {
        const price = prices[`${o.coin}USDT`] ?? 0;
        if (!(price > 0)) {
          result.errors.push(`قیمت ${o.coin} در دسترس نیست`);
          continue;
        }
        const side = settings.whale.mirrorSide ? o.side : o.side === 'long' ? 'short' : 'long';
        const label = `نهنگ ${settings.whale.label}`;
        if (settings.mode === 'real') {
          if (ctx.realKeys) {
            try {
              await openReal(settings, ctx.realKeys, o.coin, side, price, label);
              result.opened++;
            } catch (e) {
              result.errors.push(`واقعی ${o.coin}: ${e instanceof Error ? e.message : 'خطا'}`);
            }
          }
        } else {
          if (await openDemo(settings, o.coin, side, price, 'whale', label)) result.opened++;
        }
      }
      for (const c of closed) {
        const label = `بستن نهنگ ${settings.whale.label}`;
        if (settings.mode === 'real') {
          if (ctx.realKeys) {
            const side = settings.whale.mirrorSide ? c.side : c.side === 'long' ? 'short' : 'long';
            try {
              await closeReal(ctx.realKeys, c.coin, side);
              result.closed++;
            } catch (e) {
              result.errors.push(`واقعی ${c.coin}: ${e instanceof Error ? e.message : 'خطا'}`);
            }
          }
        } else {
          // close matching open demo positions of that coin
          const open = (await loadDemoPositions()).filter(
            (p) => p.status === 'open' && p.symbol === c.coin && p.source === 'whale'
          );
          for (const p of open) {
            const px = prices[`${p.symbol}USDT`] ?? p.lastPrice;
            if (await closeDemo(p.id, px, 'whale-close')) result.closed++;
          }
        }
      }
      await saveWhaleSnapshot(next);
    } catch (e) {
      result.errors.push(`نهنگ: ${e instanceof Error ? e.message.slice(0, 60) : 'خطا'}`);
    }
  }

  // 3) indicator signals
  if (settings.indicators.enabled && settings.indicators.indicatorIds.length > 0) {
    try {
      const fresh = await collectNewIndicatorSignals(settings);
      for (const s of fresh) {
        const coin = s.symbol.replace(/USDT$/i, '').toUpperCase();
        const price = s.price > 0 ? s.price : prices[`${coin}USDT`] ?? 0;
        if (!(price > 0)) continue;
        const side: 'long' | 'short' = s.action === 'buy' ? 'long' : 'short';
        const label = `اندیکاتور ${s.indicatorName}`;
        // opposite signal closes same-coin indicator positions first
        if (settings.mode === 'demo') {
          const open = (await loadDemoPositions()).filter(
            (p) => p.status === 'open' && p.symbol === coin && p.source === 'indicator' && p.side !== side
          );
          for (const p of open) {
            if (await closeDemo(p.id, price, 'signal')) result.closed++;
          }
          if (await openDemo(settings, coin, side, price, 'indicator', label)) result.opened++;
        } else if (ctx.realKeys) {
          try {
            await openReal(settings, ctx.realKeys, coin, side, price, label);
            result.opened++;
          } catch (e) {
            result.errors.push(`واقعی ${coin}: ${e instanceof Error ? e.message : 'خطا'}`);
          }
        }
      }
    } catch (e) {
      result.errors.push(`اندیکاتور: ${e instanceof Error ? e.message.slice(0, 60) : 'خطا'}`);
    }
  }

  return result;
}

/** list of tracked whales (address + label) for the source picker UI. */
export async function listTrackedWhales(): Promise<{ address: string; label: string }[]> {
  try {
    const raw = await AsyncStorage.getItem('@tracked_whale_wallets');
    if (!raw) return [];
    const arr = JSON.parse(raw) as { address: string; label: string }[];
    return Array.isArray(arr) ? arr.map((w) => ({ address: w.address, label: w.label })) : [];
  } catch {
    return [];
  }
}

/** user's custom indicators for the source picker UI. */
export async function listUserIndicators(): Promise<{ id: string; name: string }[]> {
  try {
    const arr = await getUserIndicators();
    return Array.isArray(arr) ? arr.map((i) => ({ id: i.id, name: i.name })) : [];
  } catch {
    return [];
  }
}

/** manual close from the UI (both modes). */
export async function manualClosePosition(
  settings: AutoTradeSettings,
  keys: RealKeys | undefined,
  pos: DemoAutoPosition
): Promise<boolean> {
  if (settings.mode === 'demo') return closeDemo(pos.id, pos.lastPrice, 'manual');
  if (keys) {
    try {
      await closeReal(keys, pos.symbol, pos.side);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
