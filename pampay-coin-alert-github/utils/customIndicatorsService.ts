import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchFuturesTickers, fetchKlines } from '@/utils/binanceApi';
import { sendTelegramMessage } from '@/utils/telegramService';
import {
  evaluatePineSubset,
  PineCandle,
} from '@/utils/customIndicatorPine';

/**
 * Custom (user-provided) indicator signals.
 * Users paste their own Pine-Script-like code in the "اندیکاتورها" tab;
 * enabled indicators are scanned on their chosen timeframe and every BUY/SELL
 * signal is shown in-app AND announced on Telegram.
 */

export interface UserIndicator {
  id: string;
  name: string;
  code: string;
  timeframe: '15m' | '30m' | '1h' | '4h' | '1d';
  receiveSignals: boolean;
  createdAt: number;
}

export interface CustomIndicatorSignal {
  id: string;
  indicatorId: string;
  indicatorName: string;
  symbol: string;
  displayName: string;
  action: 'buy' | 'sell';
  price: number;
  candleOpenTime: number;
  detectedAt: number;
  /** Present on signals fetched from the scan server. */
  markets?: string[];
  /** Timeframe of the scan that produced the signal (server signals). */
  timeframe?: '15m' | '30m' | '1h' | '4h' | '1d';
  /** True while the candle is still forming (server/live signals). */
  live?: boolean;
}

const INDICATORS_KEY = '@user_custom_indicators';
const SIGNALS_KEY = '@custom_indicator_signals';
const NOTIFY_KEY = '@custom_indicator_notify_keys';
const ERRORS_KEY = '@custom_indicator_errors';

const SCAN_SYMBOL_COUNT = 30;

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export async function getUserIndicators(): Promise<UserIndicator[]> {
  try {
    const stored = await AsyncStorage.getItem(INDICATORS_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.log('[CustomIndicators] Error loading indicators:', e);
  }
  return [];
}

export async function saveUserIndicator(indicator: UserIndicator): Promise<void> {
  const list = await getUserIndicators();
  const idx = list.findIndex((i) => i.id === indicator.id);
  if (idx >= 0) list[idx] = indicator;
  else list.push(indicator);
  await AsyncStorage.setItem(INDICATORS_KEY, JSON.stringify(list));
}

export async function deleteUserIndicator(id: string): Promise<void> {
  const list = await getUserIndicators();
  const filtered = list.filter((i) => i.id !== id);
  await AsyncStorage.setItem(INDICATORS_KEY, JSON.stringify(filtered));

  // Remove its stored signals as well
  const signals = await getStoredCustomSignals();
  const remaining = signals.filter((s) => s.indicatorId !== id);
  await AsyncStorage.setItem(SIGNALS_KEY, JSON.stringify(remaining));
}

export async function getStoredCustomSignals(): Promise<CustomIndicatorSignal[]> {
  try {
    const stored = await AsyncStorage.getItem(SIGNALS_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.log('[CustomIndicators] Error loading signals:', e);
  }
  return [];
}

/**
 * Merges server-computed custom-indicator signals into local storage
 * (dedupe by id) so the indicators tab AND the Telegram bot /indicators
 * command also show what the server found while the app was closed.
 * Returns the merged list.
 */
export async function mergeServerCustomSignals(
  server: CustomIndicatorSignal[]
): Promise<CustomIndicatorSignal[]> {
  if (server.length === 0) return getStoredCustomSignals();
  const existing = await getStoredCustomSignals();
  const serverById = new Map(server.map((s) => [s.id, s]));
  // Refresh entries the server re-detected later so stale detectedAt values
  // don't push a signal out of the "امروز" day filter.
  const refreshed = existing.map((s) => {
    const srv = serverById.get(s.id);
    return srv && srv.detectedAt > s.detectedAt ? srv : s;
  });
  const ids = new Set(refreshed.map((s) => s.id));
  const merged = [...server.filter((s) => !ids.has(s.id)), ...refreshed].slice(0, 200);
  try {
    await AsyncStorage.setItem(SIGNALS_KEY, JSON.stringify(merged));
  } catch {}
  return merged;
}

async function loadNotifyKeys(): Promise<Record<string, boolean>> {
  try {
    const stored = await AsyncStorage.getItem(NOTIFY_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return {};
}

async function saveNotifyKeys(map: Record<string, boolean>): Promise<void> {
  const entries = Object.keys(map).slice(-600);
  const bounded: Record<string, boolean> = {};
  for (const key of entries) bounded[key] = true;
  try {
    await AsyncStorage.setItem(NOTIFY_KEY, JSON.stringify(bounded));
  } catch {}
}

async function saveIndicatorErrors(errors: Record<string, string>): Promise<void> {
  try {
    await AsyncStorage.setItem(ERRORS_KEY, JSON.stringify(errors));
  } catch {}
}

export async function getIndicatorErrors(): Promise<Record<string, string>> {
  try {
    const stored = await AsyncStorage.getItem(ERRORS_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return {};
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

function parseRawKlines(raw: number[][]): PineCandle[] {
  // last kline is still forming -> excluded (confirmed bars only)
  return raw.slice(0, -1).map((k) => ({
    openTime: Number(k[0]),
    open: parseFloat(String(k[1])),
    high: parseFloat(String(k[2])),
    low: parseFloat(String(k[3])),
    close: parseFloat(String(k[4])),
    volume: parseFloat(String(k[5])),
  }));
}

export async function scanCustomIndicators(): Promise<{
  signals: CustomIndicatorSignal[];
  errors: Record<string, string>;
}> {
  const indicators = await getUserIndicators();
  const active = indicators.filter((i) => i.receiveSignals && i.code.trim().length > 0);

  if (active.length === 0) return { signals: [], errors: {} };
  console.log(`[CustomIndicators] Scanning ${active.length} indicators...`);

  const tickers = await fetchFuturesTickers();
  const sorted = [...tickers]
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, SCAN_SYMBOL_COUNT);

  // Cache klines per symbol+timeframe across all indicators within this cycle
  const klineCache = new Map<string, PineCandle[]>();
  const signals: CustomIndicatorSignal[] = [];
  const errors: Record<string, string> = {};

  for (const indicator of active) {
    let evaluated = 0;
    for (const ticker of sorted) {
      const cacheKey = `${ticker.symbol}:${indicator.timeframe}`;
      try {
        let candles = klineCache.get(cacheKey);
        if (!candles) {
          const raw = await fetchKlines(ticker.symbol, indicator.timeframe, 150);
          candles = parseRawKlines(raw);
          klineCache.set(cacheKey, candles);
        }
        if (candles.length < 25) continue;
        evaluated++;

        const result = evaluatePineSubset(indicator.code, candles);
        if (!result || (!result.buySignal && !result.sellSignal)) continue;

        const action: 'buy' | 'sell' = result.buySignal ? 'buy' : 'sell';
        const signalCandle = candles[candles.length - 1];
        signals.push({
          id: `ci-${indicator.id}-${ticker.symbol}-${action}-${signalCandle.openTime}`,
          indicatorId: indicator.id,
          indicatorName: indicator.name,
          symbol: ticker.symbol,
          displayName: ticker.symbol.replace('USDT', '/USDT'),
          action,
          price: signalCandle.close,
          candleOpenTime: signalCandle.openTime,
          detectedAt: Date.now(),
        });
      } catch (e) {
        errors[indicator.id] = e instanceof Error ? e.message : String(e);
      }
    }

    if (evaluated > 0 && !errors[indicator.id]) delete errors[indicator.id];
    console.log(`[CustomIndicators] "${indicator.name}" evaluated ${evaluated} symbols`);
  }

  return { signals, errors };
}

type CustomUpdateListener = (signals: CustomIndicatorSignal[]) => void;
let updateListener: CustomUpdateListener | null = null;
let scanInProgress = false;

export function setCustomIndicatorsUpdateListener(fn: CustomUpdateListener | null): void {
  updateListener = fn;
}

function buildTelegramText(signals: CustomIndicatorSignal[]): string {
  const lines = ['🧩 <b>سیگنال اندیکاتور دستی</b>\n'];
  // ALL signals — long texts are split into multiple messages by
  // sendTelegramMessage (telegramService.ts).
  for (const sig of signals) {
    const icon = sig.action === 'buy' ? '🟢' : '🔴';
    lines.push(
      `${icon} <b>${sig.displayName}</b> — ${sig.action === 'buy' ? '<b>BUY</b>' : '<b>SELL</b>'}`,
      `   🧩 اندیکاتور: ${sig.indicatorName}`,
      `   💰 قیمت: $${sig.price.toFixed(4)}`,
      `   🕐 کندل: ${new Date(sig.candleOpenTime).toLocaleDateString('fa-IR')}`,
      ''
    );
  }
  return lines.join('\n');
}

/**
 * Runs one full cycle: scans enabled custom indicators, persists results,
 * announces genuinely-new signals on Telegram (first run seeds silently).
 */
export async function runCustomScanCycle(): Promise<CustomIndicatorSignal[]> {
  if (scanInProgress) return getStoredCustomSignals();
  scanInProgress = true;

  try {
    const { signals: freshSignals, errors } = await scanCustomIndicators();
    await saveIndicatorErrors(errors);

    const existing = await getStoredCustomSignals();
    const existingIds = new Set(existing.map((s) => s.id));
    const merged = [
      ...freshSignals.filter((s) => !existingIds.has(s.id)),
      ...existing,
    ].slice(0, 200);

    const notifyKeys = await loadNotifyKeys();
    const isFirstRun = Object.keys(notifyKeys).length === 0;
    const newToAnnounce = freshSignals.filter((s) => !notifyKeys[s.id]);
    for (const sig of freshSignals) notifyKeys[sig.id] = true;

    if (!isFirstRun && newToAnnounce.length > 0) {
      const sent = await sendTelegramMessage(buildTelegramText(newToAnnounce));
      if (sent) console.log(`[CustomIndicators] Announced ${newToAnnounce.length} new signals`);
    }

    await saveNotifyKeys(notifyKeys);
    await AsyncStorage.setItem(SIGNALS_KEY, JSON.stringify(merged));

    if (updateListener && newToAnnounce.length > 0) updateListener(newToAnnounce);

    console.log(
      `[CustomIndicators] Cycle done: ${freshSignals.length} current, ${newToAnnounce.length} new (firstRun=${isFirstRun})`
    );
    return merged;
  } catch (e) {
    console.log('[CustomIndicators] Scan cycle error:', e);
    return getStoredCustomSignals();
  } finally {
    scanInProgress = false;
  }
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let midnightTimeout: ReturnType<typeof setTimeout> | null = null;

/** Milliseconds until the next UTC midnight, +5s safety margin. */
function msUntilNextUtcMidnight(): number {
  const now = new Date();
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    5,
    0
  );
  return Math.max(next - now.getTime(), 1000);
}

/** Scans precisely after UTC 00:00 (daily candle close) plus hourly catch-ups. */
export function startCustomIndicatorsScheduler(intervalMs: number = 60 * 60 * 1000): void {
  stopCustomIndicatorsScheduler();
  runCustomScanCycle();
  schedulerInterval = setInterval(() => {
    runCustomScanCycle();
  }, intervalMs);
  const scheduleMidnight = (): void => {
    midnightTimeout = setTimeout(() => {
      console.log('[CustomIndicators] UTC midnight daily scan');
      runCustomScanCycle();
      scheduleMidnight();
    }, msUntilNextUtcMidnight());
  };
  scheduleMidnight();
}

export function stopCustomIndicatorsScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  if (midnightTimeout) {
    clearTimeout(midnightTimeout);
    midnightTimeout = null;
  }
  console.log('[CustomIndicators] Scheduler stopped');
}
