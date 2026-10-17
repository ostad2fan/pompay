/**
 * autoTradingEngine.ts — v1.5.0
 *
 * «معامله‌گر خودکار» — copies WHALE positions and trades INDICATOR signals
 * automatically, in DEMO or REAL mode, with the user's own risk settings:
 *
 *   • انتخاب منبع: نهنگِ ردیابی‌شده (کپی پوزیشن باز/بسته) و/یا اندیکاتورهای
 *     آماده (هوک ریورسال + GainzAlgo Pro) و دستی — هر کدام با انتخاب
 *     تایم‌فریم (۱ یا ۲ تایم‌فریم) برای اینکه سیگنالِ همان تایم‌فریم معامله شود.
 *   • تنظیمات هر معامله: لوریج، حجم (دلاری)، حداکثر ضرر (٪ → استاپ‌لاس
 *     اتوماتیک نسبت به نقطه ورود) و ریوارد R:R (→ تیک‌پرافیت اتوماتیک).
 *   • v1.5.0 تریلینگ استاپ همیشه‌فعال: سیستم خودش برای «همه» معاملات تریل
 *     می‌گذارد — وقتی معامله در سود برود، استاپ تا نقطه سربه‌سر+کارمزد
 *     کشیده می‌شود تا «هیچ معامله سودده‌ای با ضرر بسته نشود» و اگر ریسک‌فری
 *     شود حداقل کارمزد صرافی بیرون بیاید.
 *   • v1.5.0 مدیریت سرمایه هوشمند (AI): بعد از ضررهای پیاپی حجم را پله‌ای
 *     کم می‌کند، بعد از سودها برمی‌گرداند؛ سقف ضرر روزانه دارد و به آن که
 *     رسید دیگر پوزیشن جدید باز نمی‌کند.
 *   • v1.5.0 موتور GLOBAL: چرخه ربات در کل برنامه می‌چرخد (هر صفحه که
 *     باشید) و با باز شدن دوباره برنامه فوراً یک چرخه می‌زند؛ تنظیمِ روشن
 *     بودن ربات ذخیره می‌شود — با بستن برنامه خاموش نمی‌شود. در حالت واقعی
 *     استاپ/تیپی روی خود صرافی live می‌ماند و پوزیشن‌ها محافظت می‌شوند.
 *   • حالت دمو: پوزیشن‌های شبیه‌سازی‌شده روی دستگاه — MTM + SL/TP/تریل با
 *     قیمت لحظه‌ای بایننس.
 *   • حالت واقعی: سفارش مارکت + استاپ مارکت + تیک‌پرافیت مارکت روی
 *     فیوچرز بایننس با کلید API خود کاربر (کلید هرگز از دستگاه خارج نمی‌شود).
 *   • v1.5.0 PnL ربات در تایم‌فریم‌های مختلف (امروز/۷/۳۰/همه) + آمار برد.
 */

import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import {
  fetchAccountState,
  parsePositions,
} from './hyperliquidApi';
import {
  closePosition as closeRealPosition,
  getPositions,
  openRealPosition,
  updateStopLoss,
  updateTakeProfit,
} from './binanceFuturesTrading';
import { getUserIndicators, scanCustomIndicators } from './customIndicatorsService';
import { getStoredHookSignals } from './hookReversalService';
import { getStoredGainzAlgoSignals } from './gainzAlgoService';
import { getServerUrl, getInstallSecret } from './scanServerApi';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AutoMode = 'demo' | 'real';

/** Timeframes the auto-trader can filter signals by. */
export type AutoTf = '15m' | '30m' | '1h' | '4h' | '1d';

export const AUTO_TF_LABEL: Record<AutoTf, string> = {
  '15m': '۱۵ دقیقه',
  '30m': '۳۰ دقیقه',
  '1h': '۱ ساعته',
  '4h': '۴ ساعته',
  '1d': 'روزانه',
};

export const AUTO_TFS: AutoTf[] = ['15m', '30m', '1h', '4h', '1d'];

export interface AutoWhaleSource {
  enabled: boolean;
  /** Hyperliquid address of the tracked whale to mirror. */
  address: string;
  label: string;
  /** true = same direction as the whale (کپی مستقیم). */
  mirrorSide: boolean;
}

/** v1.5.0 — one selected indicator (builtin or custom) + its timeframes. */
export interface IndicatorSelection {
  /** 'builtin:hook' | 'builtin:gainz' | user-indicator id. */
  id: string;
  /** 1–2 timeframes; EMPTY = all timeframes of that indicator. */
  timeframes: AutoTf[];
}

export interface AutoIndicatorSource {
  enabled: boolean;
  /** v1.5.0 — per-indicator selections (replaces the old flat indicatorIds). */
  selections: IndicatorSelection[];
}

export interface AutoTrailingSettings {
  /** default TRUE — «سیستم خودش برای همه معاملات فعال کنه». */
  enabled: boolean;
  /** arm the trail once price moves this × risk-distance in favor (0.5). */
  activationRatio: number;
  /** trail distance behind the extreme = this × risk-distance (0.5). */
  trailRatio: number;
}

export interface AutoAiCapitalSettings {
  /** default TRUE — «هوش مصنوعی مدیریت سرمایه انجام بدهد». */
  enabled: boolean;
  /** pause NEW entries after −X% of the trading capital in a day (3). */
  dailyLossLimitPercent: number;
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
  /** حداکثر پوزیشن باز همزمان (v1.5.2 — تا ۱۰۰؛ طبق درخواست کاربر بیشتر از ۱۰) */
  maxOpenPositions: number;
  /** v1.5.0 — trailing stop (system-managed, on by default). */
  trailing: AutoTrailingSettings;
  /** v1.5.0 — AI capital management (on by default). */
  aiCapital: AutoAiCapitalSettings;
  /** v1.5.2 — سرمایه اولیه برای محاسبه PnL/ROI (مثل خروجی فیوچرز بایننس). */
  initialCapitalUsd: number;
  /** v1.5.2 — اعلام تلگرام ۲۴/۷ از سرور (حتی وقتی برنامه بسته است). */
  server247: { enabled: boolean };
}

/** v1.5.0 — indicator option row for the auto-trader picker UI. */
export interface IndicatorOption {
  id: string;
  name: string;
  kind: 'hook' | 'gainz' | 'custom';
  /** selectable timeframes for this indicator. */
  timeframes: AutoTf[];
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
  /** v1.5.0 — trailing-stop bookkeeping. */
  initialStopPrice?: number;
  highWater?: number;
  lowWater?: number;
  trailArmed?: boolean;
}

/** v1.5.0 — a REAL position the engine opened (tracked for trailing/PnL). */
export interface RealAutoPosition {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  qty: number;
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
  initialStopPrice?: number;
  highWater?: number;
  lowWater?: number;
  trailArmed?: boolean;
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
// PnL stats (v1.5.0 — «PnL در تایم‌فریم‌های مختلف» for demo AND real)
// ---------------------------------------------------------------------------

export type AutoPnlPeriod = 'today' | '7d' | '30d' | 'all';
export const AUTO_PNL_PERIODS: AutoPnlPeriod[] = ['today', '7d', '30d', 'all'];
export const AUTO_PNL_PERIOD_LABEL: Record<AutoPnlPeriod, string> = {
  today: 'امروز',
  '7d': '۷ روز',
  '30d': '۳۰ روز',
  all: 'همه',
};

export interface AutoPnlStats {
  /** realized PnL of trades closed inside the window. */
  realized: number;
  /** unrealized PnL of currently-open trades (mark). */
  open: number;
  trades: number;
  wins: number;
}

export function computeAutoPnlStats(
  period: AutoPnlPeriod,
  closed: { closedAt?: number; realizedPnl?: number }[],
  openUnrealized: number,
  now = Date.now()
): AutoPnlStats {
  const windowMs =
    period === 'today'
      ? now - new Date(new Date(now).setHours(0, 0, 0, 0)).getTime()
      : period === '7d'
        ? 7 * 86_400_000
        : period === '30d'
          ? 30 * 86_400_000
          : Number.POSITIVE_INFINITY;
  let realized = 0;
  let trades = 0;
  let wins = 0;
  for (const t of closed) {
    if (t.closedAt && now - t.closedAt <= windowMs) {
      const pnl = t.realizedPnl ?? 0;
      realized += pnl;
      trades++;
      if (pnl > 0) wins++;
    }
  }
  return { realized, open: openUnrealized, trades, wins };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const SETTINGS_KEY = '@auto_trade_settings_v3';
const DEMO_POSITIONS_KEY = '@auto_trade_demo_positions_v1';
const REAL_POSITIONS_KEY = '@auto_trade_real_positions_v1';
const WHALE_SNAPSHOT_KEY = '@auto_trade_whale_snapshot_v1';
const LAST_SIGNAL_AT_KEY = '@auto_trade_last_signal_at_v1';
const LOG_KEY = '@auto_trade_engine_log_v1';
const DAILY_KEY = '@auto_trade_daily_stats_v1';
const EXCHANGE_CONFIGS_KEY = '@real_trade_exchange_configs';

export const DEFAULT_AUTO_SETTINGS: AutoTradeSettings = {
  enabled: false,
  mode: 'demo',
  whale: { enabled: false, address: '', label: '', mirrorSide: true },
  indicators: { enabled: false, selections: [] },
  leverage: 5,
  positionSizeUsd: 50,
  maxLossPercent: 5,
  rewardRatio: 2,
  maxOpenPositions: 3,
  // v1.5.0 — «سیستم خودش اتومات تریل کندن استاپ را برای همه معاملات
  // فعال کنه تا معامله سودده با ضرر بسته نشود»:
  trailing: { enabled: true, activationRatio: 0.5, trailRatio: 0.5 },
  aiCapital: { enabled: true, dailyLossLimitPercent: 3 },
  // v1.5.2 — سرمایه اولیه برای PnL/ROI (مثل فیوچرز بایننس) + تلگرام ۲۴/۷
  initialCapitalUsd: 1000,
  server247: { enabled: true },
};

export async function loadAutoSettings(): Promise<AutoTradeSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    // v1.4.19 settings (v2 key) — migrate indicators.indicatorIds → selections.
    const rawV2 = raw ?? (await AsyncStorage.getItem('@auto_trade_settings_v2'));
    if (!rawV2) return DEFAULT_AUTO_SETTINGS;
    const parsed = JSON.parse(rawV2) as Partial<AutoTradeSettings> & {
      indicators?: Partial<AutoIndicatorSource> & { indicatorIds?: string[] };
    };
    const sel: IndicatorSelection[] =
      parsed.indicators?.selections ??
      (parsed.indicators?.indicatorIds ?? []).map((id) => ({ id, timeframes: [] }));
    return {
      ...DEFAULT_AUTO_SETTINGS,
      ...parsed,
      whale: { ...DEFAULT_AUTO_SETTINGS.whale, ...parsed.whale },
      indicators: { enabled: parsed.indicators?.enabled ?? false, selections: sel },
      trailing: { ...DEFAULT_AUTO_SETTINGS.trailing, ...parsed.trailing },
      aiCapital: { ...DEFAULT_AUTO_SETTINGS.aiCapital, ...parsed.aiCapital },
      initialCapitalUsd: typeof parsed.initialCapitalUsd === 'number' && parsed.initialCapitalUsd > 0 ? parsed.initialCapitalUsd : DEFAULT_AUTO_SETTINGS.initialCapitalUsd,
      server247: { ...DEFAULT_AUTO_SETTINGS.server247, ...parsed.server247 },
    };
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

export async function loadRealPositions(): Promise<RealAutoPosition[]> {
  try {
    const raw = await AsyncStorage.getItem(REAL_POSITIONS_KEY);
    return raw ? (JSON.parse(raw) as RealAutoPosition[]) : [];
  } catch {
    return [];
  }
}

export async function saveRealPositions(list: RealAutoPosition[]): Promise<void> {
  await AsyncStorage.setItem(REAL_POSITIONS_KEY, JSON.stringify(list));
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

/** v1.5.0 — local notification for every auto open/close (non-fatal). */
async function notifyAutoTrade(title: string, body: string): Promise<void> {
  try {
    if (Platform.OS === 'web') return;
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: null,
    });
  } catch {}
}

// ---------------------------------------------------------------------------
// Price helpers
// ---------------------------------------------------------------------------

let binanceTickerCache: { at: number; map: Record<string, number> } | null = null;

async function getBinancePrices(maxAgeMs = 30_000): Promise<Record<string, number>> {
  if (binanceTickerCache && Date.now() - binanceTickerCache.at < maxAgeMs) {
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
  const risk = (Math.max(0.5, Math.min(90, maxLossPercent)) / 100) * entry;
  const stopPrice = side === 'long' ? entry - risk : entry + risk;
  const takePrice =
    side === 'long' ? entry + risk * Math.max(0.5, rewardRatio) : entry - risk * Math.max(0.5, rewardRatio);
  return { stopPrice, takePrice };
}

// ---------------------------------------------------------------------------
// v1.5.0 — TRAILING STOP math («هیچ معامله سودده با ضرر بسته نشود»)
// ---------------------------------------------------------------------------

/** Binance futures taker fee ≈ 0.05% per side → 0.1% round trip of notional. */
const FEE_ROUNDTRIP = 0.001;
/** arm the breakeven+fee floor once the favorable excursion exceeds fee + margin. */
const FEE_ARM_MARGIN = 0.0015;

export interface TrailingUpdate {
  newStop: number;
  armed: boolean;
  highWater: number;
  lowWater: number;
  /** true when the stop actually moved (needs persist / exchange update). */
  changed: boolean;
}

/**
 * Ratchet a position's stop upward (long) / downward (short):
 *  1. FEE FLOOR (independent, earliest): the moment the favorable excursion
 *     covers the round-trip fee, the stop floors at breakeven+fee → from
 *     then on the trade can NEVER close at a loss, and a risk-freed trade
 *     always takes at least the exchange fee out («هیچ معامله سودده‌ای با
 *     ضرر بسته نمی‌شود» + «اگر ریسک‌فری شود حداقل کارمزد در می‌آید»).
 *  2. TRAIL: arms once the excursion reaches activationRatio × risk, then
 *     follows the best price at trailRatio × risk behind it.
 */
export function computeTrailing(
  p: {
    side: 'long' | 'short';
    entryPrice: number;
    stopPrice: number;
    initialStopPrice?: number;
    highWater?: number;
    lowWater?: number;
    trailArmed?: boolean;
  },
  px: number,
  t: AutoTrailingSettings
): TrailingUpdate {
  const initialStop = p.initialStopPrice ?? p.stopPrice;
  const risk = Math.abs(p.entryPrice - initialStop);
  const highWater = Math.max(p.highWater ?? p.entryPrice, px);
  const lowWater = Math.min(p.lowWater ?? p.entryPrice, px);
  if (!t.enabled || !(risk > 0)) {
    return { newStop: p.stopPrice, armed: p.trailArmed ?? false, highWater, lowWater, changed: false };
  }
  const long = p.side === 'long';
  const best = long ? highWater : lowWater;
  const favorable = long ? best - p.entryPrice : p.entryPrice - best;
  const armed = (p.trailArmed ?? false) || favorable >= t.activationRatio * risk;
  // candidate starts as "no change"
  let candidate = long ? -Infinity : Infinity;
  // 1) fee-guaranteed breakeven floor — as soon as the excursion covers fees
  const excursionPct = favorable / p.entryPrice;
  if (excursionPct > FEE_ARM_MARGIN) {
    const breakeven = long
      ? p.entryPrice * (1 + FEE_ROUNDTRIP)
      : p.entryPrice * (1 - FEE_ROUNDTRIP);
    candidate = long ? Math.max(candidate, breakeven) : Math.min(candidate, breakeven);
  }
  // 2) trailing behind the extreme once armed
  if (armed) {
    const trailDist = t.trailRatio * risk;
    const c = long ? best - trailDist : best + trailDist;
    candidate = long ? Math.max(candidate, c) : Math.min(candidate, c);
  }
  if (!Number.isFinite(candidate)) {
    return { newStop: p.stopPrice, armed, highWater, lowWater, changed: false };
  }
  // ratchet: never widen the risk side.
  const newStop = long ? Math.max(p.stopPrice, candidate) : Math.min(p.stopPrice, candidate);
  const changed = newStop !== p.stopPrice;
  return { newStop, armed, highWater, lowWater, changed };
}

// ---------------------------------------------------------------------------
// v1.5.0 — AI capital management (anti-martingale + daily loss cap)
// ---------------------------------------------------------------------------

interface DailyStats {
  date: string;
  realized: number;
  entries: number;
}

interface LossStreak {
  consecutiveLosses: number;
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

async function loadDaily(): Promise<DailyStats> {
  try {
    const raw = await AsyncStorage.getItem(DAILY_KEY);
    if (!raw) return { date: todayKey(), realized: 0, entries: 0 };
    const parsed = JSON.parse(raw) as DailyStats;
    if (parsed.date !== todayKey()) return { date: todayKey(), realized: 0, entries: 0 };
    return parsed;
  } catch {
    return { date: todayKey(), realized: 0, entries: 0 };
  }
}

async function saveDaily(d: DailyStats): Promise<void> {
  try {
    await AsyncStorage.setItem(DAILY_KEY, JSON.stringify(d));
  } catch {}
}

async function loadLossStreak(): Promise<LossStreak> {
  try {
    const raw = await AsyncStorage.getItem(`${DAILY_KEY}:streak`);
    return raw ? (JSON.parse(raw) as LossStreak) : { consecutiveLosses: 0 };
  } catch {
    return { consecutiveLosses: 0 };
  }
}

async function recordClosedPnl(pnl: number): Promise<void> {
  const d = await loadDaily();
  d.realized += pnl;
  await saveDaily(d);
  const streak = await loadLossStreak();
  if (pnl < 0) streak.consecutiveLosses = Math.min(10, streak.consecutiveLosses + 1);
  else if (pnl > 0) streak.consecutiveLosses = 0;
  try {
    await AsyncStorage.setItem(`${DAILY_KEY}:streak`, JSON.stringify(streak));
  } catch {}
}

/**
 * Returns the effective position size for the NEXT entry (AI capital rules)
 * and an optional reason why entries are paused.
 */
async function aiCapitalGate(
  settings: AutoTradeSettings
): Promise<{ sizeUsd: number; pausedReason?: string }> {
  if (!settings.aiCapital.enabled) return { sizeUsd: settings.positionSizeUsd };
  const streak = await loadLossStreak();
  let sizeUsd = settings.positionSizeUsd;
  if (streak.consecutiveLosses > 0) {
    // پله‌ای کم شدن حجم بعد از ضررهای پیاپی (هر ضرر ۲۵٪ کمتر، کف ۲۵٪)
    sizeUsd = settings.positionSizeUsd * Math.max(0.25, Math.pow(0.75, streak.consecutiveLosses));
  }
  const daily = await loadDaily();
  const capital = settings.positionSizeUsd * Math.max(1, settings.maxOpenPositions);
  const cap = (settings.aiCapital.dailyLossLimitPercent / 100) * capital;
  if (cap > 0 && daily.realized <= -cap) {
    return {
      sizeUsd,
      pausedReason: `مدیریت سرمایه هوشمند: سقف ضرر روزانه (${settings.aiCapital.dailyLossLimitPercent}٪) پر شده — باز کردن پوزیشن جدید تا فردا متوقف شد`,
    };
  }
  const d = await loadDaily();
  d.entries += 1;
  await saveDaily(d);
  return { sizeUsd };
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
  const gate = await aiCapitalGate(settings);
  if (gate.pausedReason) {
    await appendLog('info', `${symbol}: ${gate.pausedReason}`);
    return false;
  }
  const sizeUsd = gate.sizeUsd;
  const { stopPrice, takePrice } = computeStopTake(side, price, settings.maxLossPercent, settings.rewardRatio);
  const qty = (sizeUsd * settings.leverage) / price;
  const pos: DemoAutoPosition = {
    id: `d-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    symbol,
    side,
    entryPrice: price,
    qty,
    sizeUsd,
    leverage: settings.leverage,
    stopPrice,
    takePrice,
    openedAt: Date.now(),
    source,
    sourceLabel,
    status: 'open',
    lastPrice: price,
    initialStopPrice: stopPrice,
    highWater: price,
    lowWater: price,
    trailArmed: false,
  };
  await saveDemoPositions([pos, ...positions]);
  await appendLog(
    'open',
    `دمو ${side === 'long' ? 'خرید' : 'فروش'} ${symbol} @ ${price} (${sourceLabel}) — SL ${stopPrice.toFixed(4)} / TP ${takePrice.toFixed(4)}${sizeUsd !== settings.positionSizeUsd ? ` • حجم هوشمند: $${sizeUsd.toFixed(1)}` : ''}`
  );
  await notifyAutoTrade(
    `🤖 ربات: ${side === 'long' ? 'خرید' : 'فروش'} ${symbol}`,
    `ورود ${price} • استاپ ${stopPrice.toFixed(4)} • تیک‌پرافیت ${takePrice.toFixed(4)} (${sourceLabel} — دمو)`
  );
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
  await recordClosedPnl(pnl);
  await appendLog(
    'close',
    `بستن دمو ${p.symbol} (${reason === 'stop' ? 'استاپ' : reason === 'take' ? 'تیک‌پرافیت' : reason === 'whale-close' ? 'بستن نهنگ' : reason === 'signal' ? 'سیگنال' : 'دستی'}): ${pnl >= 0 ? '+' : '−'}$${Math.abs(pnl).toFixed(2)}`
  );
  await notifyAutoTrade(
    `🤖 ربات: بستن ${p.symbol}`,
    `${reason === 'stop' ? 'استاپ' : reason === 'take' ? 'تیک‌پرافیت' : reason === 'whale-close' ? 'بستن نهنگ' : 'سیگنال'} • ${pnl >= 0 ? 'سود' : 'ضرر'} $${Math.abs(pnl).toFixed(2)} (دمو)`
  );
  return true;
}

/** mark-to-market + SL/TP + trailing-stop ratchet for all open demo positions */
async function markDemoPositions(prices: Record<string, number>, settings: AutoTradeSettings): Promise<number> {
  const positions = await loadDemoPositions();
  let dirty = false;
  let closedCount = 0;
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    if (p.status !== 'open') continue;
    const px = prices[`${p.symbol}USDT`];
    if (!px || !(px > 0)) continue;
    positions[i].lastPrice = px;
    dirty = true;
    // v1.5.0 — trailing ratchet BEFORE the SL/TP check (a tightened stop can
    // trigger this very tick).
    const tr = computeTrailing(positions[i], px, settings.trailing);
    positions[i].stopPrice = tr.newStop;
    positions[i].highWater = tr.highWater;
    positions[i].lowWater = tr.lowWater;
    positions[i].trailArmed = tr.armed;
    if (tr.changed) {
      await appendLog('info', `تریلینگ استاپ ${p.symbol} → ${tr.newStop.toFixed(4)}${tr.armed ? ' (فعال)' : ''}`);
    }
    const hitStop = p.side === 'long' ? px <= tr.newStop : px >= tr.newStop;
    const hitTake = p.side === 'long' ? px >= p.takePrice : px <= p.takePrice;
    if (hitStop || hitTake) {
      closedCount++;
      const dir = p.side === 'long' ? 1 : -1;
      const exit = hitStop ? tr.newStop : p.takePrice;
      const pnl = (exit - p.entryPrice) * dir * p.qty;
      positions[i] = {
        ...positions[i],
        status: 'closed',
        closedAt: Date.now(),
        closeReason: hitStop ? 'stop' : 'take',
        realizedPnl: pnl,
        lastPrice: px,
      };
      await recordClosedPnl(pnl);
      await appendLog(
        'close',
        `بستن دمو ${p.symbol} (${hitStop ? 'استاپ‌لاس' : 'تیک‌پرافیت'}${hitStop && pnl >= 0 ? ' — ریسک‌فری' : ''}): ${pnl >= 0 ? '+' : '−'}$${Math.abs(pnl).toFixed(2)}`
      );
      await notifyAutoTrade(
        `🤖 ربات: بستن ${p.symbol}`,
        `${hitStop ? 'استاپ' : 'تیک‌پرافیت'} • ${pnl >= 0 ? 'سود' : 'ضرر'} $${Math.abs(pnl).toFixed(2)} (دمو)`
      );
    }
  }
  if (dirty) await saveDemoPositions(positions);
  return closedCount;
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
// v1.5.0 — Indicator signals: builtin Hook Reversal + GainzAlgo + custom,
// each filtered by its SELECTED timeframes (1–2) and freshness.
// ---------------------------------------------------------------------------

interface NormalizedSignal {
  symbol: string;
  action: 'buy' | 'sell';
  price: number;
  detectedAt: number;
  indicatorId: string;
  indicatorName: string;
}

function tfOf(s: { timeframe?: string }, fallback: string): string {
  return s.timeframe && AUTO_TFS.includes(s.timeframe as AutoTf) ? s.timeframe : fallback;
}

async function collectNewIndicatorSignals(settings: AutoTradeSettings): Promise<NormalizedSignal[]> {
  if (!settings.indicators.enabled || settings.indicators.selections.length === 0) return [];
  let lastAt = 0;
  try {
    lastAt = Number((await AsyncStorage.getItem(LAST_SIGNAL_AT_KEY)) ?? 0) || 0;
  } catch {}

  const out: NormalizedSignal[] = [];
  const needsHook = settings.indicators.selections.some((s) => s.id === 'builtin:hook');
  const needsGainz = settings.indicators.selections.some((s) => s.id === 'builtin:gainz');
  const customSels = settings.indicators.selections.filter(
    (s) => s.id !== 'builtin:hook' && s.id !== 'builtin:gainz'
  );

  if (needsHook) {
    try {
      const signals = await getStoredHookSignals();
      for (const s of signals) {
        const sel = settings.indicators.selections.find((x) => x.id === 'builtin:hook')!;
        // empty timeframes = all timeframes of the indicator
        if (sel.timeframes.length > 0 && !sel.timeframes.includes(tfOf(s, '1d') as AutoTf)) continue;
        if (s.detectedAt <= lastAt) continue;
        out.push({
          symbol: s.symbol,
          action: s.action,
          price: s.price,
          detectedAt: s.detectedAt,
          indicatorId: 'builtin:hook',
          indicatorName: 'هوک ریورسال',
        });
      }
    } catch {}
  }

  if (needsGainz) {
    try {
      const signals = await getStoredGainzAlgoSignals();
      const sel = settings.indicators.selections.find((x) => x.id === 'builtin:gainz')!;
      for (const s of signals) {
        if (sel.timeframes.length > 0 && !sel.timeframes.includes(tfOf(s, '1d') as AutoTf)) continue;
        if (s.detectedAt <= lastAt) continue;
        out.push({
          symbol: s.symbol,
          action: s.action,
          price: s.price,
          detectedAt: s.detectedAt,
          indicatorId: 'builtin:gainz',
          indicatorName: 'GainzAlgo Pro',
        });
      }
    } catch {}
  }

  if (customSels.length > 0) {
    try {
      const scan = await scanCustomIndicators();
      if (scan && Array.isArray(scan.signals)) {
        for (const s of scan.signals) {
          const sel = customSels.find((x) => x.id === s.indicatorId);
          if (!sel) continue;
          // signals without a timeframe (local scans) match leniently.
          if (sel.timeframes.length > 0 && s.timeframe && !sel.timeframes.includes(s.timeframe as AutoTf)) continue;
          if (sel.timeframes.length > 0 && !s.timeframe) {
            // custom indicators are scanned at their own timeframe — find it
            const ind = await findUserIndicatorTimeframe(s.indicatorId);
            if (ind && !sel.timeframes.includes(ind)) continue;
          }
          if (s.detectedAt <= lastAt) continue;
          out.push({
            symbol: s.symbol,
            action: s.action,
            price: s.price,
            detectedAt: s.detectedAt,
            indicatorId: s.indicatorId,
            indicatorName: s.indicatorName,
          });
        }
      }
    } catch {}
  }

  // advance the freshness cursor so each signal trades once
  const maxAt = out.reduce((m, s) => Math.max(m, s.detectedAt), 0);
  if (maxAt > lastAt) {
    try {
      await AsyncStorage.setItem(LAST_SIGNAL_AT_KEY, String(maxAt));
    } catch {}
  }
  return out;
}

async function findUserIndicatorTimeframe(id: string): Promise<AutoTf | null> {
  try {
    const arr = await getUserIndicators();
    const ind = arr.find((i) => i.id === id);
    return (ind?.timeframe as AutoTf) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// REAL execution (Binance futures — keys stay on the device)
// ---------------------------------------------------------------------------

export interface RealKeys {
  apiKey: string;
  apiSecret: string;
}

/** v1.5.0 — real keys straight from the exchange-config storage (global engine). */
export async function loadRealKeys(): Promise<RealKeys | undefined> {
  try {
    const raw = await AsyncStorage.getItem(EXCHANGE_CONFIGS_KEY);
    if (!raw) return undefined;
    const arr = JSON.parse(raw) as { exchangeId: string; apiKey: string; apiSecret: string; enabled: boolean }[];
    const binance = arr.find((e) => e.enabled && e.exchangeId === 'binance' && e.apiKey && e.apiSecret);
    return binance ? { apiKey: binance.apiKey, apiSecret: binance.apiSecret } : undefined;
  } catch {
    return undefined;
  }
}

async function openReal(
  settings: AutoTradeSettings,
  keys: RealKeys,
  symbol: string,
  side: 'long' | 'short',
  price: number,
  sourceLabel: string
): Promise<RealAutoPosition | null> {
  const gate = await aiCapitalGate(settings);
  if (gate.pausedReason) {
    await appendLog('info', `${symbol}: ${gate.pausedReason}`);
    return null;
  }
  const sizeUsd = gate.sizeUsd;
  const { stopPrice, takePrice } = computeStopTake(side, price, settings.maxLossPercent, settings.rewardRatio);
  await openRealPosition(
    keys.apiKey,
    keys.apiSecret,
    `${symbol}USDT`,
    side,
    sizeUsd,
    settings.leverage,
    Number(stopPrice.toFixed(6)),
    Number(takePrice.toFixed(6))
  );
  const qty = (sizeUsd * settings.leverage) / price;
  const pos: RealAutoPosition = {
    id: `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    symbol,
    side,
    entryPrice: price,
    qty,
    leverage: settings.leverage,
    stopPrice,
    takePrice,
    openedAt: Date.now(),
    source: sourceLabel.includes('نهنگ') ? 'whale' : 'indicator',
    sourceLabel,
    status: 'open',
    lastPrice: price,
    initialStopPrice: stopPrice,
    highWater: price,
    lowWater: price,
    trailArmed: false,
  };
  const tracked = await loadRealPositions();
  await saveRealPositions([pos, ...tracked]);
  await appendLog(
    'open',
    `واقعی ${side === 'long' ? 'خرید' : 'فروش'} ${symbol} @ ~${price} (${sourceLabel}) — SL ${stopPrice.toFixed(4)} / TP ${takePrice.toFixed(4)}${sizeUsd !== settings.positionSizeUsd ? ` • حجم هوشمند: $${sizeUsd.toFixed(1)}` : ''}`
  );
  await notifyAutoTrade(
    `🤖 ربات واقعی: ${side === 'long' ? 'خرید' : 'فروش'} ${symbol}`,
    `ورود ~${price} • استاپ ${stopPrice.toFixed(4)} • تیک‌پرافیت ${takePrice.toFixed(4)} (${sourceLabel})`
  );
  return pos;
}

async function closeReal(keys: RealKeys, symbol: string, side: 'long' | 'short', reason: string): Promise<void> {
  // closePosition takes positionAmt (signed) — long = +, short = −
  const positionAmt = side === 'long' ? 1 : -1;
  await closeRealPosition(keys.apiKey, keys.apiSecret, `${symbol}USDT`, positionAmt);
  await appendLog('close', `بستن واقعی ${symbol} (${side === 'long' ? 'لانگ' : 'شورت'}) — ${reason}`);
}

/**
 * v1.5.0 — manage tracked REAL positions every cycle:
 *  • sync mark price / size from the exchange;
 *  • ratchet the SL upward via updateStopLoss (trailing + breakeven+fee);
 *  • detect positions closed on the exchange (SL/TP hit) and book their PnL.
 */
async function manageRealPositions(
  settings: AutoTradeSettings,
  keys: RealKeys
): Promise<{ closed: number; errors: string[] }> {
  const errors: string[] = [];
  let closed = 0;
  const tracked = await loadRealPositions();
  const openTracked = tracked.filter((p) => p.status === 'open');
  if (openTracked.length === 0) return { closed, errors };
  let live: { symbol: string; positionAmt: string; markPrice: string }[];
  try {
    live = await getPositions(keys.apiKey, keys.apiSecret);
  } catch (e) {
    errors.push(`پوزیشن‌های واقعی: ${e instanceof Error ? e.message.slice(0, 60) : 'خطا'}`);
    return { closed, errors };
  }
  const liveMap = new Map(live.map((p) => [p.symbol, p]));
  for (let i = 0; i < tracked.length; i++) {
    const p = tracked[i];
    if (p.status !== 'open') continue;
    const lp = liveMap.get(`${p.symbol}USDT`);
    if (!lp || parseFloat(lp.positionAmt) === 0) {
      // closed on the exchange (SL/TP/manual) — book approximate PnL
      const dir = p.side === 'long' ? 1 : -1;
      const pnl = (p.lastPrice - p.entryPrice) * dir * p.qty;
      tracked[i] = { ...p, status: 'closed', closedAt: Date.now(), closeReason: 'take', realizedPnl: pnl };
      closed++;
      await recordClosedPnl(pnl);
      await appendLog(
        'close',
        `بستن واقعی ${p.symbol} (روی صرافی): ${pnl >= 0 ? '+' : '−'}$${Math.abs(pnl).toFixed(2)} تقریبی`
      );
      await notifyAutoTrade(
        `🤖 ربات واقعی: بستن ${p.symbol}`,
        `بسته شد روی صرافی • ${pnl >= 0 ? 'سود' : 'ضرر'} ~$${Math.abs(pnl).toFixed(2)}`
      );
      continue;
    }
    const mark = parseFloat(lp.markPrice) || p.lastPrice;
    const liveQty = Math.abs(parseFloat(lp.positionAmt));
    tracked[i].lastPrice = mark;
    if (liveQty > 0) tracked[i].qty = liveQty;
    const tr = computeTrailing(tracked[i], mark, settings.trailing);
    tracked[i].stopPrice = tr.newStop;
    tracked[i].highWater = tr.highWater;
    tracked[i].lowWater = tr.lowWater;
    tracked[i].trailArmed = tr.armed;
    if (tr.changed) {
      try {
        await updateStopLoss(
          keys.apiKey,
          keys.apiSecret,
          `${p.symbol}USDT`,
          p.side,
          liveQty > 0 ? liveQty : p.qty,
          Number(tr.newStop.toFixed(6))
        );
        await appendLog('info', `تریلینگ استاپ واقعی ${p.symbol} → ${tr.newStop.toFixed(4)}`);
      } catch (e) {
        errors.push(`تریلینگ ${p.symbol}: ${e instanceof Error ? e.message.slice(0, 60) : 'خطا'}`);
      }
    }
  }
  await saveRealPositions(tracked);
  return { closed, errors };
}

// ---------------------------------------------------------------------------
// THE CYCLE — run every ~60s while the bot is on (global engine)
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
    // 1) demo mark-to-market + trailing + SL/TP checks (always — even real
    //    mode usually has no demo positions, this is a cheap no-op then)
    await markDemoPositions(prices, settings);
  } catch (e) {
    result.errors.push(`MTM: ${e instanceof Error ? e.message : 'خطا'}`);
  }

  // 1.5) v1.5.0 — manage tracked REAL positions (trailing + closed detection)
  if (settings.mode === 'real' && ctx.realKeys) {
    try {
      const m = await manageRealPositions(settings, ctx.realKeys);
      result.closed += m.closed;
      result.errors.push(...m.errors);
    } catch (e) {
      result.errors.push(`پوزیشن واقعی: ${e instanceof Error ? e.message.slice(0, 60) : 'خطا'}`);
    }
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
              if (await openReal(settings, ctx.realKeys, o.coin, side, price, label)) result.opened++;
            } catch (e) {
              result.errors.push(`واقعی ${o.coin}: ${e instanceof Error ? e.message : 'خطا'}`);
            }
          }
        } else {
          if (await openDemo(settings, o.coin, side, price, 'whale', label)) result.opened++;
        }
      }
      for (const c of closed) {
        if (settings.mode === 'real') {
          if (ctx.realKeys) {
            const side = settings.whale.mirrorSide ? c.side : c.side === 'long' ? 'short' : 'long';
            try {
              await closeReal(ctx.realKeys, c.coin, side, 'کپی بستن نهنگ');
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

  // 3) indicator signals (builtin hook/gainz + custom, per-timeframe)
  if (settings.indicators.enabled && settings.indicators.selections.length > 0) {
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
            if (await openReal(settings, ctx.realKeys, coin, side, price, label)) result.opened++;
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

// ---------------------------------------------------------------------------
// v1.5.0 — GLOBAL ENGINE: app-wide loop + AppState resume + persistence
// («وقتی برنامه را می‌بندم گزینه معامله خودکار خاموش نشه و همیشه فعال بمونه»)
// ---------------------------------------------------------------------------

let engineTimer: ReturnType<typeof setInterval> | null = null;
let engineAppStateSub: { remove: () => void } | null = null;
let cycleRunning = false;
let lastGlobalCycleAt: number | null = null;

export function isGlobalEngineRunning(): boolean {
  return engineTimer !== null;
}

export function getLastGlobalCycleAt(): number | null {
  return lastGlobalCycleAt;
}

/** Idempotent — call once from the root layout; the enabled flag is read
 *  fresh from storage on EVERY tick, so toggling the bot takes ≤60s. */
export function startGlobalAutoEngine(): void {
  if (engineTimer) return;
  engineTimer = setInterval(() => {
    void runGlobalCycle();
  }, 60_000);
  engineAppStateSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      // coming back to the app → run a cycle right away (1.5s grace)
      setTimeout(() => {
        void runGlobalCycle();
      }, 1500);
    }
  });
  void runGlobalCycle();
}

export function stopGlobalAutoEngine(): void {
  if (engineTimer) {
    clearInterval(engineTimer);
    engineTimer = null;
  }
  if (engineAppStateSub) {
    engineAppStateSub.remove();
    engineAppStateSub = null;
  }
}

/** manual trigger (the UI «رفرش پوزیشن‌های ربات» button). */
export async function runGlobalCycleNow(): Promise<void> {
  await runGlobalCycle();
}

async function runGlobalCycle(): Promise<void> {
  if (cycleRunning) return;
  cycleRunning = true;
  try {
    const settings = await loadAutoSettings();
    if (!settings.enabled) return;
    // v1.5.2 — سرور ۲۴/۷ فعال است؟ چرخه معاملاتی روی سرور اجرا می‌شود
    // (اعلام تلگرام با برنامه بسته)؛ اینجا فقط state را sync می‌کنیم.
    if (settings.server247.enabled && (await isServerModeActive())) {
      await syncAutoTradeStateFromServer();
      return;
    }
    const realKeys = settings.mode === 'real' ? await loadRealKeys() : undefined;
    const res = await runAutoCycle({ settings, realKeys });
    for (const e of res.errors.slice(0, 2)) await appendLog('error', e);
  } catch {
    // never let the loop die
  } finally {
    lastGlobalCycleAt = Date.now();
    cycleRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Pickers for the UI
// ---------------------------------------------------------------------------

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

/** v1.5.0 — full indicator picker list: READY indicators (Hook Reversal,
 *  GainzAlgo Pro) + the user's own custom indicators. */
export async function listIndicatorOptions(): Promise<IndicatorOption[]> {
  const custom: IndicatorOption[] = [];
  try {
    const arr = await getUserIndicators();
    for (const c of arr) {
      custom.push({
        id: c.id,
        name: `${c.name} (اندیکاتور من)`,
        kind: 'custom',
        timeframes: [c.timeframe as AutoTf],
      });
    }
  } catch {}
  return [
    {
      id: 'builtin:hook',
      name: 'هوک ریورسال (آماده)',
      kind: 'hook',
      timeframes: ['4h', '1d'],
    },
    {
      id: 'builtin:gainz',
      name: 'GainzAlgo Pro (آماده)',
      kind: 'gainz',
      timeframes: ['1d', '4h', '1h', '30m', '15m'],
    },
    ...custom,
  ];
}

/** user's custom indicators (kept for compatibility). */
export async function listUserIndicators(): Promise<{ id: string; name: string }[]> {
  try {
    const arr = await getUserIndicators();
    return Array.isArray(arr) ? arr.map((i) => ({ id: i.id, name: i.name })) : [];
  } catch {
    return [];
  }
}

/** manual close from the UI (both modes) — accepts demo or real shapes. */
export async function manualClosePosition(
  settings: AutoTradeSettings,
  keys: RealKeys | undefined,
  pos: { id: string; symbol: string; side: 'long' | 'short'; lastPrice: number }
): Promise<boolean> {
  if (settings.mode === 'demo') return closeDemo(pos.id, pos.lastPrice, 'manual');
  if (keys) {
    try {
      await closeReal(keys, pos.symbol, pos.side, 'دستی');
      const tracked = await loadRealPositions();
      const idx = tracked.findIndex(
        (p) => p.status === 'open' && p.symbol === pos.symbol && p.side === pos.side
      );
      if (idx >= 0) {
        const dir = tracked[idx].side === 'long' ? 1 : -1;
        const pnl = (tracked[idx].lastPrice - tracked[idx].entryPrice) * dir * tracked[idx].qty;
        tracked[idx] = { ...tracked[idx], status: 'closed', closedAt: Date.now(), closeReason: 'manual', realizedPnl: pnl };
        await saveRealPositions(tracked);
        await recordClosedPnl(pnl);
      }
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// v1.5.2 — ویرایش دستی TP/SL هر پوزیشن باز («بشه هر معامله را تی‌پی و استاپش
// را دستی هم تغییر داد») + درصد سود/زیان هر پوزیشن در UI
// ---------------------------------------------------------------------------

export async function updatePositionTpsl(
  settings: AutoTradeSettings,
  keys: RealKeys | undefined,
  pos: { id: string; symbol: string; side: 'long' | 'short'; qty: number; stopPrice: number; takePrice: number },
  newStop: number,
  newTake: number
): Promise<boolean> {
  if (!(newStop > 0) || !(newTake > 0) || !Number.isFinite(newStop) || !Number.isFinite(newTake)) {
    return false;
  }
  const long = pos.side === 'long';
  // جهت منطقی: برای لانگ استاپ پایین‌تر از تیک‌پرافیت (و برعکس برای شورت)
  if (long && newStop >= newTake) return false;
  if (!long && newStop <= newTake) return false;

  if (settings.mode === 'demo') {
    const positions = await loadDemoPositions();
    const idx = positions.findIndex((p) => p.id === pos.id && p.status === 'open');
    if (idx < 0) return false;
    positions[idx].stopPrice = newStop;
    positions[idx].takePrice = newTake;
    await saveDemoPositions(positions);
    await appendLog('info', `ویرایش دستی TP/SL ${pos.symbol}: SL ${newStop.toFixed(4)} / TP ${newTake.toFixed(4)}`);
    return true;
  }

  if (keys) {
    try {
      await updateStopLoss(keys.apiKey, keys.apiSecret, `${pos.symbol}USDT`, pos.side, pos.qty, newStop);
      await updateTakeProfit(keys.apiKey, keys.apiSecret, `${pos.symbol}USDT`, pos.side, pos.qty, newTake);
      const tracked = await loadRealPositions();
      const idx = tracked.findIndex((p) => p.id === pos.id && p.status === 'open');
      if (idx >= 0) {
        tracked[idx].stopPrice = newStop;
        tracked[idx].takePrice = newTake;
        await saveRealPositions(tracked);
      }
      await appendLog('info', `ویرایش دستی TP/SL واقعی ${pos.symbol}: SL ${newStop.toFixed(4)} / TP ${newTake.toFixed(4)}`);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** درصد PnL لحظه‌ای یک پوزیشن نسبت به مارجین (حجم دلاری × لوریج) — برای UI. */
export function positionPnlPercent(
  p: { side: 'long' | 'short'; entryPrice: number; lastPrice: number; qty: number; sizeUsd?: number; leverage?: number },
  marginUsd?: number
): number {
  const dir = p.side === 'long' ? 1 : -1;
  const pnl = (p.lastPrice - p.entryPrice) * dir * p.qty;
  const margin = marginUsd && marginUsd > 0 ? marginUsd : p.sizeUsd && p.sizeUsd > 0 ? p.sizeUsd : (p.leverage ?? 1) > 0 ? (p.qty * p.entryPrice) / (p.leverage ?? 1) : 0;
  if (!(margin > 0)) return 0;
  return (pnl / margin) * 100;
}

// ---------------------------------------------------------------------------
// v1.5.2 — رفرش سبک هر ۳ ثانیه («پوزیشن‌های ربات بک‌تست هر ۳ ثانیه رفرش
// بشن»): قیمت تازه + MTM + SL/TP + تریل — بدون اسکن سیگنال/نهنگ.
// ---------------------------------------------------------------------------

let lightMtmRunning = false;

export async function runLightMtm(): Promise<void> {
  if (lightMtmRunning) return;
  lightMtmRunning = true;
  try {
    const settings = await loadAutoSettings();
    if (!settings.enabled) return;
    // حالت سرور ۲۴/۷: فقط state سرور را sync می‌کنیم (سرور خودش چرخه می‌زند)
    if (settings.server247.enabled && (await isServerModeActive())) {
      await syncAutoTradeStateFromServer();
      return;
    }
    // قیمت با کش ۲.۵ ثانیه‌ای تا PnL نمایش واقعاً هر ۳ ثانیه تازه شود
    const prices = await getBinancePrices(2_500).catch(() => ({}) as Record<string, number>);
    try {
      await markDemoPositions(prices, settings);
    } catch {}
    if (settings.mode === 'real') {
      const keys = await loadRealKeys();
      if (keys) {
        try {
          await manageRealPositions(settings, keys);
        } catch {}
      }
    }
  } catch {
    // never die
  } finally {
    lightMtmRunning = false;
  }
}

// ---------------------------------------------------------------------------
// v1.5.2 — SERVER 24/7 («سیگنال‌های دمو یا واقعی بک‌تست در تلگرامم بیاد؛
// حتماً برنامه بسته باشه این فعالیت‌هاش در تل اعلام بشه»):
//   • pushAutoTradeConfigToServer — تنظیمات ربات (+ کلید بایننس در حالت
//     واقعی) به سرور Railway می‌رود تا ربات روی سرور ۲۴/۷ اجرا شود.
//   • syncAutoTradeStateFromServer — پوزیشن‌ها/لاگ‌ها از سرور برمی‌گردند و
//     در همان کلیدهای محلی ذخیره می‌شوند (UI بدون تغییر کار می‌کند).
// ---------------------------------------------------------------------------

const SERVER_OK_KEY = '@auto_trade_server_ok_v1';

async function isServerModeActive(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SERVER_OK_KEY)) === '1';
  } catch {
    return false;
  }
}

async function setServerModeActive(on: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(SERVER_OK_KEY, on ? '1' : '0');
  } catch {}
}

export async function isAutoServerModeActive(): Promise<boolean> {
  return isServerModeActive();
}

export interface ServerAutoTradeState {
  ok: boolean;
  enabled: boolean;
  mode: AutoMode;
  demoPositions: DemoAutoPosition[];
  realPositions: RealAutoPosition[];
  logs: AutoEngineLog[];
  lastCycleAt: number | null;
  serverNow: number;
}

export async function pushAutoTradeConfigToServer(
  settings: AutoTradeSettings
): Promise<{ ok: boolean; error?: string }> {
  try {
    const base = await getServerUrl();
    if (!base) return { ok: false, error: 'آدرس سرور تنظیم نشده' };
    const secret = await getInstallSecret();
    const serverEnabled = settings.enabled && settings.server247.enabled;
    const keys = settings.mode === 'real' && serverEnabled ? await loadRealKeys() : undefined;
    if (settings.mode === 'real' && serverEnabled && !keys) {
      return { ok: false, error: 'کلید API بایننس برای حالت واقعی پیدا نشد' };
    }
    const payload = {
      secret,
      config: {
        // سرور فقط وقتی اجرا می‌شود که هم سوییچ ۲۴/۷ روشن باشد و هم خود ربات
        enabled: settings.enabled && settings.server247.enabled,
        mode: settings.mode,
        whale: settings.whale,
        indicators: settings.indicators,
        leverage: settings.leverage,
        positionSizeUsd: settings.positionSizeUsd,
        maxLossPercent: settings.maxLossPercent,
        rewardRatio: settings.rewardRatio,
        maxOpenPositions: settings.maxOpenPositions,
        trailing: settings.trailing,
        aiCapital: settings.aiCapital,
        initialCapitalUsd: settings.initialCapitalUsd,
        binanceKeys: keys ? { apiKey: keys.apiKey, apiSecret: keys.apiSecret } : undefined,
      },
    };
    const res = await fetch(`${base}/autotrade/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (res.ok && data?.ok) {
      await setServerModeActive(serverEnabled);
      return { ok: true };
    }
    await setServerModeActive(false);
    return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
  } catch (e) {
    await setServerModeActive(false);
    return { ok: false, error: e instanceof Error ? e.message : 'خطای شبکه' };
  }
}

export async function syncAutoTradeStateFromServer(): Promise<boolean> {
  try {
    const settings = await loadAutoSettings();
    if (!settings.server247.enabled) return false;
    const base = await getServerUrl();
    if (!base) return false;
    const secret = await getInstallSecret();
    const res = await fetch(`${base}/autotrade/state?secret=${encodeURIComponent(secret)}`);
    if (!res.ok) return false;
    const data = (await res.json()) as ServerAutoTradeState;
    if (!data?.ok) return false;
    if (Array.isArray(data.demoPositions)) await saveDemoPositions(data.demoPositions);
    if (Array.isArray(data.realPositions)) await saveRealPositions(data.realPositions);
    if (Array.isArray(data.logs)) {
      await AsyncStorage.setItem(LOG_KEY, JSON.stringify(data.logs.slice(0, 60)));
    }
    if (typeof data.lastCycleAt === 'number') lastGlobalCycleAt = data.lastCycleAt;
    return true;
  } catch {
    return false;
  }
}
