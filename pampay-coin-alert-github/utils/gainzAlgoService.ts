import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchFuturesTickers, fetchKlines } from '@/utils/binanceApi';
import { sendTelegramMessage } from '@/utils/telegramService';
import type { GainzTimeframe } from '@/types/crypto';

/**
 * GainzAlgo Pro indicator — TypeScript port of the Pine Script v5 indicator.
 * Runs on the daily timeframe using Binance Futures public API and detects
 * BUY/SELL signals exactly like the original:
 *   - stable candle: |close - open| / trueRange > candleStabilityIndex
 *   - bullish/bearish engulfing
 *   - RSI(14) below/above the threshold
 *   - decrease/increase over the candle-delta-length period
 * Only confirmed daily candles are evaluated (equivalent to barstate.isconfirmed),
 * so a signal fires once per closed daily candle per symbol.
 */

export interface GainzAlgoParams {
  /** Candle Stability Index: body-to-wick ratio (0-1), default 0.5 */
  candleStabilityIndex: number;
  /** RSI Index threshold (0-100), default 50 */
  rsiIndex: number;
  /** Candle Delta Length: lookback for price increase/decrease, default 5 */
  candleDeltaLength: number;
  /** Remove repeating signal clusters (Pine "Disable Repeating Signals") */
  disableRepeatingSignals: boolean;
}

export const DEFAULT_GAINZ_PARAMS: GainzAlgoParams = {
  candleStabilityIndex: 0.5,
  rsiIndex: 50,
  candleDeltaLength: 5,
  disableRepeatingSignals: true,
};

export interface GainzAlgoSignal {
  id: string;
  symbol: string;
  displayName: string;
  action: 'buy' | 'sell';
  price: number;
  rsi: number;
  candleOpenTime: number;
  detectedAt: number;
  /** Present on signals fetched from the scan server (client scans are daily). */
  timeframe?: GainzTimeframe;
  /** Binance markets where the symbol trades: 'futures' and/or 'spot'. */
  markets?: string[];
  /** True when the signal was detected on the still-forming (live) candle. */
  live?: boolean;
}

/** Persian labels for every GainzAlgo timeframe (shared across the app). */
export const GAINZ_TF_LABEL: Record<GainzTimeframe, string> = {
  '15m': '۱۵ دقیقه',
  '30m': '۳۰ دقیقه',
  '1h': '۱ ساعته',
  '4h': '۴ ساعته',
  '1d': 'روزانه',
};

/** Display order for grouping signals by timeframe (largest first). */
export const GAINZ_TF_ORDER: GainzTimeframe[] = ['1d', '4h', '1h', '30m', '15m'];

interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const GAINZ_SIGNALS_KEY = '@gainz_algo_signals';
const GAINZ_NOTIFIED_KEY = '@gainz_algo_notified_keys';
const SETTINGS_KEY = '@crypto_scanner_settings';

/** RSI with Wilder's smoothing (same as ta.rsi in Pine). */
function calculateRSI(closes: number[], period = 14): number[] {
  const rsi: number[] = new Array(closes.length).fill(0);
  if (closes.length <= period) return rsi;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

/** True range like ta.tr in Pine (uses previous close). */
function calculateTrueRange(candles: Candle[]): number[] {
  const tr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      tr.push(candles[0].high - candles[0].low);
      continue;
    }
    const prevClose = candles[i - 1].close;
    tr.push(
      Math.max(candles[i].high, prevClose) - Math.min(candles[i].low, prevClose)
    );
  }
  return tr;
}

/**
 * Replays all confirmed candles through the GainzAlgo logic (keeping the
 * last_signal state machine so "disable repeating signals" behaves like Pine)
 * and returns the signal that fired on the LAST confirmed bar, if any.
 */
export function analyzeGainzAlgoCandles(
  candles: Candle[],
  params: GainzAlgoParams = DEFAULT_GAINZ_PARAMS
): { action: 'buy' | 'sell'; price: number; rsi: number } | null {
  const n = candles.length;
  const delta = params.candleDeltaLength;
  const startIndex = Math.max(14, delta + 1);
  if (n < startIndex + 2) return null;

  const closes = candles.map((c) => c.close);
  const rsiSeries = calculateRSI(closes, 14);
  const trSeries = calculateTrueRange(candles);

  let lastSignal: 'buy' | 'sell' | null = null;

  for (let i = startIndex; i < n; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = trSeries[i];
    if (!tr || tr === 0) continue;

    // stable_candle = math.abs(close - open) / ta.tr > index
    const isStableCandle = Math.abs(c.close - c.open) / tr > params.candleStabilityIndex;

    const currentRsi = rsiSeries[i];
    const closeOverDelta = candles[i - delta].close;

    // bull: engulfing up + stable + RSI below index + price decreased over length
    const bullishEngulfing =
      prev.close < prev.open && c.close > c.open && c.close > prev.open;
    const bull =
      bullishEngulfing &&
      isStableCandle &&
      currentRsi < params.rsiIndex &&
      c.close < closeOverDelta;

    // bear: engulfing down + stable + RSI above (100 - index) + price increased over length
    const bearishEngulfing =
      prev.close > prev.open && c.close < c.open && c.close < prev.open;
    const bear =
      bearishEngulfing &&
      isStableCandle &&
      currentRsi > 100 - params.rsiIndex &&
      c.close > closeOverDelta;

    if (params.disableRepeatingSignals) {
      if (bull && lastSignal !== 'buy') lastSignal = 'buy';
      else if (bear && lastSignal !== 'sell') lastSignal = 'sell';
      else continue;
    } else {
      if (bull) lastSignal = 'buy';
      else if (bear) lastSignal = 'sell';
      else continue;
    }

    // Only report when the signal fired on the most recent confirmed bar
    if (i === n - 1) {
      return {
        action: lastSignal,
        price: c.close,
        rsi: Math.round(currentRsi * 10) / 10,
      };
    }
  }

  return null;
}

function parseRawKlines(raw: number[][]): Candle[] {
  // The last kline is still forming -> exclude it (barstate.isconfirmed)
  return raw.slice(0, -1).map((k) => ({
    openTime: Number(k[0]),
    open: parseFloat(String(k[1])),
    high: parseFloat(String(k[2])),
    low: parseFloat(String(k[3])),
    close: parseFloat(String(k[4])),
  }));
}

/**
 * Scans the top USDT futures pairs for GainzAlgo signals on the given
 * timeframes (defaults to the daily timeframe). All signals of every selected
 * timeframe are returned — no truncation.
 */
export async function scanGainzAlgoDailySignals(options?: {
  maxSymbols?: number;
  timeframes?: GainzTimeframe[];
}): Promise<GainzAlgoSignal[]> {
  const maxSymbols = options?.maxSymbols ?? 40;
  const timeframes: GainzTimeframe[] =
    options?.timeframes && options.timeframes.length > 0 ? options.timeframes : ['1d'];
  console.log(`[GainzAlgo] Scanning ${timeframes.join('/')} timeframes for top ${maxSymbols} pairs...`);

  const tickers = await fetchFuturesTickers();
  const sorted = [...tickers]
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, maxSymbols);

  const signals: GainzAlgoSignal[] = [];
  const batchSize = 6;

  for (const tf of timeframes) {
    for (let i = 0; i < sorted.length; i += batchSize) {
      const batch = sorted.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (ticker) => {
          try {
            const raw = await fetchKlines(ticker.symbol, tf, 60);
            const candles = parseRawKlines(raw);
            if (candles.length < 25) return;

            const result = analyzeGainzAlgoCandles(candles);
            if (!result) return;

            signals.push({
              id: `gainz-${tf}-${ticker.symbol}-${result.action}-${candles[candles.length - 1].openTime}`,
              symbol: ticker.symbol,
              displayName: ticker.symbol.replace('USDT', '/USDT'),
              action: result.action,
              price: result.price,
              rsi: result.rsi,
              timeframe: tf,
              candleOpenTime: candles[candles.length - 1].openTime,
              detectedAt: Date.now(),
            });
          } catch (e) {
            console.log(`[GainzAlgo] Error analyzing ${ticker.symbol}:`, e);
          }
        })
      );
    }
  }

  signals.sort((a, b) =>
    b.action.localeCompare(a.action) || b.detectedAt - a.detectedAt
  );
  console.log(`[GainzAlgo] Found ${signals.length} signals across ${timeframes.join('/')}`);
  return signals;
}

export async function getStoredGainzAlgoSignals(): Promise<GainzAlgoSignal[]> {
  try {
    const stored = await AsyncStorage.getItem(GAINZ_SIGNALS_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.log('[GainzAlgo] Error loading stored signals:', e);
  }
  return [];
}

/**
 * Merges server-computed signals (all timeframes, incl. live-candle ones)
 * into local storage (dedupe by id) so the indicators tab AND the Telegram
 * bot /gainz command also show what the server found while the app was
 * closed. Returns the merged list.
 */
export async function mergeServerGainzSignals(
  server: GainzAlgoSignal[]
): Promise<GainzAlgoSignal[]> {
  if (server.length === 0) return getStoredGainzAlgoSignals();
  const existing = await getStoredGainzAlgoSignals();
  const serverById = new Map(server.map((s) => [s.id, s]));
  // Refresh entries the server has re-detected later (e.g. a daily candle that
  // closed last night: the stored copy keeps its old detectedAt and would
  // disappear from the "امروز" day filter).
  const refreshed = existing.map((s) => {
    const srv = serverById.get(s.id);
    return srv && srv.detectedAt > s.detectedAt ? srv : s;
  });
  const ids = new Set(refreshed.map((s) => s.id));
  const merged = [...server.filter((s) => !ids.has(s.id)), ...refreshed].slice(0, 240);
  try {
    await AsyncStorage.setItem(GAINZ_SIGNALS_KEY, JSON.stringify(merged));
  } catch {}
  return merged;
}

async function loadNotifiedKeys(): Promise<Record<string, boolean>> {
  try {
    const stored = await AsyncStorage.getItem(GAINZ_NOTIFIED_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return {};
}

async function saveNotifiedKeys(map: Record<string, boolean>): Promise<void> {
  // Keep the map bounded to ~500 recent entries
  const entries = Object.keys(map).slice(-500);
  const bounded: Record<string, boolean> = {};
  for (const key of entries) bounded[key] = true;
  try {
    await AsyncStorage.setItem(GAINZ_NOTIFIED_KEY, JSON.stringify(bounded));
  } catch {}
}

function buildGainzTelegramText(signals: GainzAlgoSignal[]): string {
  const lines = ['📊 <b>اندیکاتور GainzAlgo Pro</b>\n'];
  // Group by timeframe so large signal sets stay readable — every signal of
  // every timeframe is included (no truncation).
  for (const tf of GAINZ_TF_ORDER) {
    const group = signals.filter((s) => (s.timeframe ?? '1d') === tf);
    if (group.length === 0) continue;
    lines.push(`⏱ <b>تایم‌فریم ${GAINZ_TF_LABEL[tf]}</b> — ${group.length} سیگنال`);
    for (const sig of group) {
      const icon = sig.action === 'buy' ? '🟢' : '🔴';
      const action = sig.action === 'buy' ? 'سیگنال خرید (BUY)' : 'سیگنال فروش (SELL)';
      lines.push(
        `${icon} <b>${sig.displayName}</b> — ${action}`,
        `   💰 قیمت بسته شدن کندل: $${sig.price.toFixed(4)}`,
        `   📈 RSI(14): ${sig.rsi}`,
        `   🕐 کندل ${GAINZ_TF_LABEL[tf]}: ${new Date(sig.candleOpenTime).toLocaleString('fa-IR')}`,
        ''
      );
    }
  }
  lines.push('📉 داده از Binance Futures • فقط کندل‌های تکمیل‌شده بررسی می‌شوند');
  return lines.join('\n');
}

/** Sends the GainzAlgo daily signals to Telegram. Returns false if not configured/disabled. */
export async function sendGainzAlgoTelegramNotification(
  signals: GainzAlgoSignal[]
): Promise<boolean> {
  if (signals.length === 0) return false;
  try {
    const settingsStr = await AsyncStorage.getItem(SETTINGS_KEY);
    const settings = settingsStr ? JSON.parse(settingsStr) : {};
    if (settings.gainzAlgoNotifications === false) return false;
    return sendTelegramMessage(buildGainzTelegramText(signals));
  } catch (e) {
    console.log('[GainzAlgo] Telegram notify error:', e);
    return false;
  }
}

type GainzUpdateListener = (signals: GainzAlgoSignal[]) => void;
let updateListener: GainzUpdateListener | null = null;
let scanInProgress = false;

export function setGainzAlgoUpdateListener(fn: GainzUpdateListener | null): void {
  updateListener = fn;
}

/**
 * Runs one full scan cycle: scans Binance daily candles, merges results with
 * history, notifies Telegram about brand-new signals and persists everything.
 * On the very first run, existing signals are seeded silently (no spam).
 */
export async function runGainzAlgoScanCycle(): Promise<GainzAlgoSignal[]> {
  if (scanInProgress) return getStoredGainzAlgoSignals();
  scanInProgress = true;

  try {
    // Scan every timeframe the user selected (fallback: daily).
    let timeframes: GainzTimeframe[] | undefined;
    try {
      const settingsStr = await AsyncStorage.getItem(SETTINGS_KEY);
      const settings = settingsStr ? JSON.parse(settingsStr) : {};
      if (Array.isArray(settings.gainzTimeframes) && settings.gainzTimeframes.length > 0) {
        timeframes = settings.gainzTimeframes;
      }
    } catch {}
    const freshSignals = await scanGainzAlgoDailySignals({ timeframes });
    const existing = await getStoredGainzAlgoSignals();
    const existingIds = new Set(existing.map((s) => s.id));

    const merged = [
      ...freshSignals.filter((s) => !existingIds.has(s.id)),
      ...existing,
    ].slice(0, 120);

    const notifiedKeys = await loadNotifiedKeys();
    const isFirstRun = Object.keys(notifiedKeys).length === 0;

    const newToAnnounce = freshSignals.filter((s) => !notifiedKeys[s.id]);

    for (const sig of freshSignals) notifiedKeys[sig.id] = true;

    // Always announce genuinely-new signals after the initial seeding pass
    if (!isFirstRun && newToAnnounce.length > 0) {
      const sent = await sendGainzAlgoTelegramNotification(newToAnnounce);
      if (sent) console.log(`[GainzAlgo] Announced ${newToAnnounce.length} new signals`);
    }

    await saveNotifiedKeys(notifiedKeys);
    await AsyncStorage.setItem(GAINZ_SIGNALS_KEY, JSON.stringify(merged));

    if (updateListener && newToAnnounce.length > 0) {
      updateListener(newToAnnounce);
    }

    console.log(
      `[GainzAlgo] Cycle done: ${freshSignals.length} current, ${newToAnnounce.length} new (firstRun=${isFirstRun})`
    );
    return merged;
  } catch (e) {
    console.log('[GainzAlgo] Scan cycle error:', e);
    return getStoredGainzAlgoSignals();
  } finally {
    scanInProgress = false;
  }
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let midnightTimeout: ReturnType<typeof setTimeout> | null = null;

/** Milliseconds until the next UTC midnight (daily candle close), +5s safety. */
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

/** Starts scanning: precisely at UTC 00:00 (daily candle close) plus hourly catch-ups. */
export function startGainzAlgoScheduler(intervalMs: number = 60 * 60 * 1000): void {
  stopGainzAlgoScheduler();
  console.log('[GainzAlgo] Starting scheduler (UTC midnight + hourly catch-up)...');
  runGainzAlgoScanCycle();
  schedulerInterval = setInterval(() => {
    runGainzAlgoScanCycle();
  }, intervalMs);
  // Precise scan right after the daily candle closes at 00:00 UTC
  const scheduleMidnight = (): void => {
    midnightTimeout = setTimeout(() => {
      console.log('[GainzAlgo] UTC midnight daily scan');
      runGainzAlgoScanCycle();
      scheduleMidnight();
    }, msUntilNextUtcMidnight());
  };
  scheduleMidnight();
}

export function stopGainzAlgoScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  if (midnightTimeout) {
    clearTimeout(midnightTimeout);
    midnightTimeout = null;
  }
  console.log('[GainzAlgo] Scheduler stopped');
}
