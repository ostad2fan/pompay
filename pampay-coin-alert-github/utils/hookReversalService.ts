import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchFuturesTickers, fetchKlines } from '@/utils/binanceApi';
import { sendTelegramMessage } from '@/utils/telegramService';

/**
 * Hook Reversal indicator.
 * Detects the classic hook reversal price-action pattern on 4h/1d candles:
 *  - Bullish hook (buy): candle makes a LOWER LOW than the previous candle but
 *    CLOSES ABOVE the previous close (sellers absorbed → potential reversal up).
 *  - Bearish hook (sell): candle makes a HIGHER HIGH but CLOSES BELOW the
 *    previous close (buyers exhausted → potential reversal down).
 * The scan server runs the same detection on a schedule so signals arrive on
 * Telegram even when the app is fully closed; this module provides the
 * local in-app scan, persistence and Telegram announcement.
 */

export type HookTimeframe = '4h' | '1d';

export interface HookReversalSignal {
  id: string;
  symbol: string;
  displayName: string;
  /** 'buy' = bullish hook, 'sell' = bearish hook. */
  action: 'buy' | 'sell';
  /** Price of the candle at detection time. */
  price: number;
  timeframe: HookTimeframe;
  candleOpenTime: number;
  detectedAt: number;
  /** Present on signals fetched from the scan server. */
  markets?: string[];
  /** True when detected on the still-forming (live) candle. */
  live?: boolean;
}

const SIGNALS_KEY = '@hook_reversal_signals';
const NOTIFY_KEY = '@hook_reversal_notify_keys';

const SCAN_SYMBOL_COUNT = 40;
const SIGNAL_CAP = 200;
const NOTIFY_CAP = 700;

export const HOOK_TF_LABEL: Record<HookTimeframe, string> = {
  '4h': '۴ ساعته',
  '1d': 'روزانه',
};

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export async function getStoredHookSignals(): Promise<HookReversalSignal[]> {
  try {
    const stored = await AsyncStorage.getItem(SIGNALS_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.log('[HookReversal] Error loading signals:', e);
  }
  return [];
}

/**
 * Merges server-computed hook signals into local storage (dedupe by id) so
 * the indicators tab AND the Telegram bot /hook command also show what the
 * server found while the app was closed. Entries the server re-detected later
 * get their detectedAt refreshed so they don't fall out of the "امروز" filter.
 */
export async function mergeServerHookSignals(
  server: HookReversalSignal[]
): Promise<HookReversalSignal[]> {
  if (server.length === 0) return getStoredHookSignals();
  const existing = await getStoredHookSignals();
  const serverById = new Map(server.map((s) => [s.id, s]));
  const refreshed = existing.map((s) => {
    const srv = serverById.get(s.id);
    return srv && srv.detectedAt > s.detectedAt ? srv : s;
  });
  const ids = new Set(refreshed.map((s) => s.id));
  const merged = [...server.filter((s) => !ids.has(s.id)), ...refreshed].slice(0, SIGNAL_CAP);
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
  const entries = Object.keys(map).slice(-NOTIFY_CAP);
  const bounded: Record<string, boolean> = {};
  for (const key of entries) bounded[key] = true;
  try {
    await AsyncStorage.setItem(NOTIFY_KEY, JSON.stringify(bounded));
  } catch {}
}

// ---------------------------------------------------------------------------
// Detection & scanning
// ---------------------------------------------------------------------------

interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

function parseRawKlines(raw: number[][], includeForming = false): Candle[] {
  // By default the last kline is still forming -> excluded (confirmed bars only)
  const list = includeForming ? raw : raw.slice(0, -1);
  return list.map((k) => ({
    openTime: Number(k[0]),
    open: parseFloat(String(k[1])),
    high: parseFloat(String(k[2])),
    low: parseFloat(String(k[3])),
    close: parseFloat(String(k[4])),
  }));
}

/** Bullish hook: lower low + higher close. Bearish hook: higher high + lower close. */
export function detectHook(
  candles: Candle[]
): { action: 'buy' | 'sell'; price: number } | null {
  const n = candles.length;
  if (n < 2) return null;
  const c = candles[n - 1];
  const prev = candles[n - 2];
  if (c.low < prev.low && c.close > prev.close) return { action: 'buy', price: c.close };
  if (c.high > prev.high && c.close < prev.close) return { action: 'sell', price: c.close };
  return null;
}

export async function scanHookReversal(
  timeframes: HookTimeframe[]
): Promise<HookReversalSignal[]> {
  const tickers = await fetchFuturesTickers();
  const sorted = [...tickers]
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, SCAN_SYMBOL_COUNT);

  const signals: HookReversalSignal[] = [];
  const batchSize = 6;
  for (const tf of timeframes) {
    for (let i = 0; i < sorted.length; i += batchSize) {
      const batch = sorted.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (ticker) => {
          try {
            const raw = await fetchKlines(ticker.symbol, tf, 30);
            const evaluate = (candles: Candle[], live: boolean) => {
              const result = detectHook(candles);
              if (!result) return;
              const last = candles[candles.length - 1];
              signals.push({
                id: `hook-${tf}-${ticker.symbol}-${result.action}-${last.openTime}`,
                symbol: ticker.symbol,
                displayName: ticker.symbol.replace('USDT', '/USDT'),
                action: result.action,
                price: result.price,
                timeframe: tf,
                live,
                candleOpenTime: last.openTime,
                detectedAt: Date.now(),
              });
            };
            // Just-closed candle + the currently forming (live) candle.
            evaluate(parseRawKlines(raw), false);
            evaluate(parseRawKlines(raw, true), true);
          } catch (e) {
            console.log(`[HookReversal] kline error ${ticker.symbol}:`, e);
          }
        })
      );
    }
  }
  signals.sort((a, b) => b.action.localeCompare(a.action) || b.detectedAt - a.detectedAt);
  return signals;
}

// ---------------------------------------------------------------------------
// Scan cycle (persistence + Telegram + listener)
// ---------------------------------------------------------------------------

type HookUpdateListener = (signals: HookReversalSignal[]) => void;
let updateListener: HookUpdateListener | null = null;
let scanInProgress = false;

export function setHookReversalUpdateListener(fn: HookUpdateListener | null): void {
  updateListener = fn;
}

function marketsLabel(markets: string[] | undefined): string {
  const list = markets && markets.length > 0 ? markets : ['futures'];
  return list
    .map((m) => (m === 'futures' ? 'فیوچرز' : m === 'spot' ? 'اسپات' : m))
    .join(' + ');
}

function buildTelegramText(signals: HookReversalSignal[]): string {
  const lines = ['🪝 <b>هوک ریورسال</b>\n'];
  for (const sig of signals) { // ALL signals — split into multiple Telegram messages
    const icon = sig.action === 'buy' ? '🟢' : '🔴';
    const label = sig.action === 'buy' ? 'هوک صعودی' : 'هوک نزولی';
    lines.push(
      `${icon} <b>${sig.displayName}</b> — ${label}`,
      `   💰 قیمت لحظه‌ی شناسایی: $${sig.price.toFixed(4)}`,
      `   ⏱ تایم‌فریم: ${HOOK_TF_LABEL[sig.timeframe]}`,
      `   🏦 بازار Binance: ${marketsLabel(sig.markets)}`,
      `   🕐 کندل: ${new Date(sig.candleOpenTime).toLocaleDateString('fa-IR')}`,
      ''
    );
  }
  return lines.join('\n');
}

/**
 * Runs one full local scan cycle on the given timeframes, persists results,
 * announces genuinely-new signals on Telegram (first run seeds silently).
 */
export async function runHookScanCycle(
  timeframes: HookTimeframe[]
): Promise<HookReversalSignal[]> {
  if (timeframes.length === 0) return getStoredHookSignals();
  if (scanInProgress) return getStoredHookSignals();
  scanInProgress = true;

  try {
    const freshSignals = await scanHookReversal(timeframes);

    const existing = await getStoredHookSignals();
    const existingIds = new Set(existing.map((s) => s.id));
    const merged = [
      ...freshSignals.filter((s) => !existingIds.has(s.id)),
      ...existing,
    ].slice(0, SIGNAL_CAP);

    const notifyKeys = await loadNotifyKeys();
    const isFirstRun = Object.keys(notifyKeys).length === 0;
    const newToAnnounce = freshSignals.filter((s) => !notifyKeys[s.id]);
    for (const sig of freshSignals) notifyKeys[sig.id] = true;

    if (!isFirstRun && newToAnnounce.length > 0) {
      const sent = await sendTelegramMessage(buildTelegramText(newToAnnounce));
      if (sent) console.log(`[HookReversal] Announced ${newToAnnounce.length} new signals`);
    }

    await saveNotifyKeys(notifyKeys);
    await AsyncStorage.setItem(SIGNALS_KEY, JSON.stringify(merged));

    if (updateListener && newToAnnounce.length > 0) updateListener(newToAnnounce);

    console.log(
      `[HookReversal] Cycle done: ${freshSignals.length} current, ${newToAnnounce.length} new (firstRun=${isFirstRun})`
    );
    return merged;
  } catch (e) {
    console.log('[HookReversal] Scan cycle error:', e);
    return getStoredHookSignals();
  } finally {
    scanInProgress = false;
  }
}

// ---------------------------------------------------------------------------
// Scheduler (only runs while the app is open; the server covers closed hours)
// ---------------------------------------------------------------------------

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let midnightTimeout: ReturnType<typeof setTimeout> | null = null;
let activeTimeframes: HookTimeframe[] = [];

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
export function startHookReversalScheduler(
  timeframes: HookTimeframe[],
  intervalMs: number = 60 * 60 * 1000
): void {
  activeTimeframes = timeframes;
  stopHookReversalScheduler();
  if (timeframes.length === 0) return;
  runHookScanCycle(activeTimeframes);
  schedulerInterval = setInterval(() => {
    runHookScanCycle(activeTimeframes);
  }, intervalMs);
  const scheduleMidnight = (): void => {
    midnightTimeout = setTimeout(() => {
      console.log('[HookReversal] UTC midnight daily scan');
      runHookScanCycle(activeTimeframes);
      scheduleMidnight();
    }, msUntilNextUtcMidnight());
  };
  scheduleMidnight();
}

/** Updates the timeframes used by the running scheduler. */
export function updateHookReversalTimeframes(timeframes: HookTimeframe[]): void {
  activeTimeframes = timeframes;
}

export function stopHookReversalScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  if (midnightTimeout) {
    clearTimeout(midnightTimeout);
    midnightTimeout = null;
  }
}
