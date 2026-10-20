/**
 * autoTradingEngine.ts — v1.5.3
 *
 * v1.5.3 (طبق بازخورد کاربر):
 *   • حد ضرر با لوریج دقیق می‌بندد: «حد ضرر ۳٪ با لوریج ۵ = دقیقاً ۱۵٪ ضرر
 *     حساب» — فاصله قیمت استاپ = حد ضرر ÷ لوریج.
 *   • تریل استاپ جدید: با ۱٪ حرکت اسپات به سود (با لوریج ۵ یعنی ۵٪ سود)
 *     معامله ریسک‌فری می‌شود؛ بعدش استاپ همیشه روی نصفِ بیشترین سود
 *     می‌نشیند (۲٪ اسپات × ۵ = ۱۰٪ → استاپ روی ۵٪ سود).
 *   • برداشت سود پله‌ای: وقتی سود حساب به ۲۵٪ یا ۵۰٪ برسد ربات خودش
 *     نصف حجم را می‌بندد + دکمه «بستن نصف» دستی برای هر پوزیشن.
 *   • ریست کامل دمو (پاک شدن همه‌چیز حتی تاریخچه).
 *   • اعلام تلگرام حتی وقتی سرور ۲۴/۷ فعال نیست (برنامه باز → پیام می‌رود).
 *   • هر پوزیشن نام استراتژی فعال موقع باز شدن را نگه می‌دارد (تاریخچه).
 *
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
  closePartialPosition,
  getPositions,
  openRealPosition,
  updateStopLoss,
  updateTakeProfit,
} from './binanceFuturesTrading';
import { getUserIndicators, scanCustomIndicators } from './customIndicatorsService';
import { getStoredHookSignals } from './hookReversalService';
import { getStoredGainzAlgoSignals } from './gainzAlgoService';
import { getServerUrl, getInstallSecret } from './scanServerApi';
import { mergePositionsById } from './autoMerge';

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
  closeReason?: 'stop' | 'take' | 'signal' | 'whale-close' | 'manual' | 'partial' | 'partial-manual';
  closedAt?: number;
  realizedPnl?: number;
  /** v1.5.0 — trailing-stop bookkeeping. */
  initialStopPrice?: number;
  highWater?: number;
  lowWater?: number;
  trailArmed?: boolean;
  /** v1.5.3 — نام استراتژی فعال در لحظه باز شدن (برای تاریخچه). */
  strategyName?: string;
  /** v1.5.3 — چند بار ربات خودش نصف حجم بسته (۰/۱/۲ — آستانه ۲۵٪ و ۵۰٪). */
  partialsDone?: number;
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
  closeReason?: 'stop' | 'take' | 'signal' | 'whale-close' | 'manual' | 'partial' | 'partial-manual';
  closedAt?: number;
  realizedPnl?: number;
  initialStopPrice?: number;
  highWater?: number;
  lowWater?: number;
  trailArmed?: boolean;
  /** v1.5.3 — نام استراتژی فعال در لحظه باز شدن (برای تاریخچه). */
  strategyName?: string;
  /** v1.5.3 — چند بار ربات خودش نصف حجم بسته (۰/۱/۲ — آستانه ۲۵٪ و ۵۰٪). */
  partialsDone?: number;
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
// v1.5.5 — بک‌فیل: شناسه سیگنال‌هایی که قبلاً برای پر کردن سقف پوزیشن‌های
// همزمان باز شده‌اند (هر سیگنال فقط یک بار بک‌فیل می‌شود).
const BACKFILL_SEEN_KEY = '@auto_trade_backfill_seen_v1';
const BACKFILL_WINDOW_MS = 7 * 86_400_000;
const BACKFILL_SEEN_CAP = 600;

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
  // v1.5.5 — سوییچ «اعلام تلگرام ۲۴/۷ (سرور)» حذف شد (فلگ همیشه خاموش).
  server247: { enabled: false },
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
    const merged: AutoTradeSettings = {
      ...DEFAULT_AUTO_SETTINGS,
      ...parsed,
      whale: { ...DEFAULT_AUTO_SETTINGS.whale, ...parsed.whale },
      indicators: { enabled: parsed.indicators?.enabled ?? false, selections: sel },
      trailing: { ...DEFAULT_AUTO_SETTINGS.trailing, ...parsed.trailing },
      aiCapital: { ...DEFAULT_AUTO_SETTINGS.aiCapital, ...parsed.aiCapital },
      initialCapitalUsd: typeof parsed.initialCapitalUsd === 'number' && parsed.initialCapitalUsd > 0 ? parsed.initialCapitalUsd : DEFAULT_AUTO_SETTINGS.initialCapitalUsd,
      server247: { ...DEFAULT_AUTO_SETTINGS.server247, ...parsed.server247 },
    };
    // v1.5.7 — حذف مهاجرتِ «خاموش‌کردن قهوه‌ای server247» (v1.5.5): کاربر
    // می‌خواهد اعلان‌های بک‌تست با برنامه بسته هم در تلگرام بیاید (مثل
    // اسکنرهای میم‌کوین). حالت ۲۴/۷ دیگر سوییچ دستی نیست؛ وقتی ربات روشن
    // باشد + آدرس سرور + توکن تلگرام تنظیم باشند، خودکار فعال می‌شود
    // (enabled = settings.enabled && telegram در pushAutoTradeConfigToServer).
    return merged;
  } catch {
    return DEFAULT_AUTO_SETTINGS;
  }
}

// ---------------------------------------------------------------------------
// v1.5.7 — تنظیماتِ خودکار: pub/sub کوچک برای تغییرات بیرونی.
// «طبق توضیحاتی که درون برنامه دادی با روشن کردن هر استراتژی تنظیمات با
// همون پارامترهای استراتژی پر نمیشه» — ریشه‌ی باگ: auto-trade.tsx پریست
// استراتژی را در storage می‌نوشت ولی کامپوننتِ ربات state کهنه داشت و
// persist بعدی همان مقادیر کهنه را برمی‌گرداند. حالا saveAutoSettings به
// شنونده‌ها خبر می‌دهد و AutoTradingBotSection تنظیمات را دوباره می‌خواند
// (اگر خودش ننوشته باشد) — پریست استراتژی هم لحظه‌ای در جدول دیده می‌شود
// و دیگر با نوشتنِ بعدی پاک نمی‌شود.
// ---------------------------------------------------------------------------

type AutoSettingsListener = (s: AutoTradeSettings) => void;
const autoSettingsListeners = new Set<AutoSettingsListener>();

/** اشتراک در تغییرات تنظیمات ربات (برای UI زنده). خروجی = لغو اشتراک. */
export function subscribeAutoSettings(cb: AutoSettingsListener): () => void {
  autoSettingsListeners.add(cb);
  return () => {
    autoSettingsListeners.delete(cb);
  };
}

export async function saveAutoSettings(s: AutoTradeSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  for (const cb of autoSettingsListeners) {
    try {
      cb(s);
    } catch {}
  }
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
// v1.5.3 — «وقتی حد ضرر را روی مثلا ۳درصد میزارم با لوریج ۵ دقیقا روی
// ۱۵ درصد ببنده»: فاصله قیمت استاپ = حد ضرر ÷ لوریج؛ چون ضرر حساب =
// حرکت قیمت × لوریج، یعنی ضررِ بسته‌شده دقیقاً همان «حد ضرر» می‌شود.
// ---------------------------------------------------------------------------

export function computeStopTake(
  side: 'long' | 'short',
  entry: number,
  maxLossPercent: number,
  rewardRatio: number,
  leverage = 1
): { stopPrice: number; takePrice: number } {
  const lev = Math.max(1, leverage);
  const lossPct = Math.max(0.5, Math.min(90, maxLossPercent));
  // price distance = loss% / leverage (so ACCOUNT loss = loss% exactly)
  const risk = (lossPct / 100 / lev) * entry;
  const stopPrice = side === 'long' ? entry - risk : entry + risk;
  const takePrice =
    side === 'long' ? entry + risk * Math.max(0.5, rewardRatio) : entry - risk * Math.max(0.5, rewardRatio);
  return { stopPrice, takePrice };
}

// ---------------------------------------------------------------------------
// v1.5.3 — TRAILING STOP جدید (طبق مشخصات دقیق کاربر)
//   ۱) ریسک‌فری: وقتی قیمت ۱٪ به سود برود (با لوریج ۵ یعنی ۵٪ سود حساب)،
//      استاپ به نقطه ورود (+کارمزد) می‌چسبد — دیگر ضرر ممکن نیست.
//   ۲) بعد از آن استاپ روی «نصفِ بیشترین سود» می‌نشیند و فقط بالا می‌رود:
//      ۲٪ اسپات × ۵ = ۱۰٪ سود → استاپ روی ۵٪ سود؛ برگشت قیمت = حداقل
//      نصف سود قفل‌شده از آب درمی‌آید.
//   ۳) (این تابع فقط استاپ را جابه‌جا می‌کند؛ برداشت سود پله‌ای ۲۵٪/۵۰٪
//      در markDemoPositions/manageRealPositions انجام می‌شود.)
// ---------------------------------------------------------------------------

/** Binance futures taker fee ≈ 0.05% per side → 0.1% round trip of notional. */
const FEE_ROUNDTRIP = 0.001;
/** ۱٪ حرکت قیمت به سود → فعال‌شدن ریسک‌فری (طبق مثال کاربر با لوریج ۵). */
const RISK_FREE_SPOT_PCT = 0.01;
/** استاپ روی نصفِ بیشترین سود می‌نشیند. */
const LOCK_RATIO = 0.5;
/** آستانه‌های سودِ حساب (٪ مارجین) که ربات نصف حجم را می‌بندد. */
export const PARTIAL_TAKE_PNL_PCTS = [25, 50];

export interface TrailingUpdate {
  newStop: number;
  armed: boolean;
  highWater: number;
  lowWater: number;
  /** true when the stop actually moved (needs persist / exchange update). */
  changed: boolean;
}

/**
 * v1.5.3 — رatchet a position's stop (long up / short down), user spec:
 *  1. RISK-FREE (earliest): favorable price move ≥ 1% (spot) → stop floors at
 *     breakeven+fee → the trade can NEVER close at a loss anymore.
 *  2. TRAIL: after risk-free, the stop follows the best price, locking
 *     LOCK_RATIO (50%) of the PEAK favorable move — with leverage 5: 10%
 *     account profit → stop at 5% account profit, so a reversal still pays.
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
  const highWater = Math.max(p.highWater ?? p.entryPrice, px);
  const lowWater = Math.min(p.lowWater ?? p.entryPrice, px);
  if (!t.enabled) {
    return { newStop: p.stopPrice, armed: p.trailArmed ?? false, highWater, lowWater, changed: false };
  }
  const long = p.side === 'long';
  const best = long ? highWater : lowWater;
  const favorable = long ? best - p.entryPrice : p.entryPrice - best;
  const spotPct = favorable / p.entryPrice;
  // v1.5.3 — ۱٪ حرکت اسپات به سود = فعال شدن ریسک‌فری
  const armed = (p.trailArmed ?? false) || spotPct >= RISK_FREE_SPOT_PCT;
  let candidate = long ? -Infinity : Infinity;
  if (armed && favorable > 0) {
    // ریسک‌فری: حداقل سربه‌سر + کارمزد
    const feeFloor = long
      ? p.entryPrice * (1 + FEE_ROUNDTRIP)
      : p.entryPrice * (1 - FEE_ROUNDTRIP);
    // تریل: نصفِ بیشترین سود قفل شود
    const lockPrice = p.entryPrice + (long ? 1 : -1) * favorable * LOCK_RATIO;
    candidate = long ? Math.max(feeFloor, lockPrice) : Math.min(feeFloor, lockPrice);
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
// v1.5.3 — Partial take-profit («وقتی معامله به ۲۵٪ یا ۵۰٪ رسید نصف معامله
// را ببنده — ربات مدیریت سرمایه کنه که سودی از دست نره») + helperهای مشترک
// ---------------------------------------------------------------------------

/** سود لحظه‌ای به درصدِ مارجینِ باقی‌مانده (بعد از پارشیال هم درست می‌ماند). */
function marginPnlPctOf(
  p: { side: 'long' | 'short'; entryPrice: number; qty: number; leverage?: number; sizeUsd?: number },
  px: number
): number {
  const dir = p.side === 'long' ? 1 : -1;
  const pnl = (px - p.entryPrice) * dir * p.qty;
  const margin = (p.qty * p.entryPrice) / Math.max(1, p.leverage ?? 1);
  return margin > 0 ? (pnl / margin) * 100 : 0;
}

/** v1.5.3 — نام استراتژی فعال (از لیست روشن/خاموش تب بک‌تست). */
const STRATEGY_LABELS: Record<string, string> = {
  conservative: 'محافظه‌کارانه',
  balanced: 'متعادل',
  aggressive: 'تهاجمی',
  scalper: 'اسکالپر',
};

async function currentStrategyLabel(): Promise<string> {
  try {
    const raw = await AsyncStorage.getItem('@trading_strategies_v1');
    if (!raw) return STRATEGY_LABELS.balanced;
    const m = JSON.parse(raw) as Record<string, boolean>;
    const order = ['conservative', 'balanced', 'aggressive', 'scalper'];
    const first = order.find((k) => m[k]);
    return STRATEGY_LABELS[first ?? 'balanced'] ?? STRATEGY_LABELS.balanced;
  } catch {
    return STRATEGY_LABELS.balanced;
  }
}

/** v1.5.3 — اعلام تلگرام سمت برنامه (وقتی برنامه باز است حتی بدون سرور ۲۴/۷).
 *  v1.5.7 — وقتی حالت سرور ۲۴/۷ فعال است، سرور خودش اعلام می‌کند؛ اعلام
 *  محلی قطع می‌شود تا هر رخداد فقط یک بار به تلگرام برسد. */
async function announceTelegram(title: string, text: string): Promise<void> {
  try {
    if (Platform.OS === 'web') return;
    if (await isServerModeActive()) return; // سرور اعلام می‌کند — بدون تکرار
    const raw = await AsyncStorage.getItem('@crypto_scanner_settings');
    if (!raw) return;
    const s = JSON.parse(raw) as { telegramEnabled?: boolean; telegramBotToken?: string; telegramChatId?: string };
    if (!s?.telegramEnabled || !s?.telegramBotToken || !s?.telegramChatId) return;
    await fetch(`https://api.telegram.org/bot${s.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: s.telegramChatId,
        text: `🤖 ${title}\n${text}`,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
  } catch {
    // never fatal
  }
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
  const { stopPrice, takePrice } = computeStopTake(side, price, settings.maxLossPercent, settings.rewardRatio, settings.leverage);
  const strategyName = await currentStrategyLabel();
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
    strategyName,
    partialsDone: 0,
  };
  await saveDemoPositions([pos, ...positions]);
  await appendLog(
    'open',
    `دمو ${side === 'long' ? 'خرید' : 'فروش'} ${symbol} @ ${price} (${sourceLabel} • استراتژی ${strategyName}) — SL ${stopPrice.toFixed(4)} / TP ${takePrice.toFixed(4)}${sizeUsd !== settings.positionSizeUsd ? ` • حجم هوشمند: $${sizeUsd.toFixed(1)}` : ''}`
  );
  await notifyAutoTrade(
    `🤖 ربات: ${side === 'long' ? 'خرید' : 'فروش'} ${symbol}`,
    `ورود ${price} • استاپ ${stopPrice.toFixed(4)} • تیک‌پرافیت ${takePrice.toFixed(4)} (${sourceLabel} — دمو)`
  );
  // v1.5.3 — اعلام تلگرام از خود برنامه (وقتی برنامه باز است)
  await announceTelegram(
    `بک‌تست (دمو): ${side === 'long' ? '🟢 خرید' : '🔴 فروش'} ${symbol}`,
    `ورود ${price} • استاپ ${stopPrice.toFixed(4)} • تیک‌پرافیت ${takePrice.toFixed(4)}\nمنبع: ${sourceLabel} • لوریج ${settings.leverage}x • استراتژی ${strategyName}`
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
  await announceTelegram(
    `بک‌تست (دمو): بستن ${p.symbol}`,
    `${reason === 'stop' ? 'استاپ' : reason === 'take' ? 'تیک‌پرافیت' : reason === 'whale-close' ? 'نهنگ بست' : 'سیگنال'} • ${pnl >= 0 ? '✅ سود' : '❌ ضرر'} $${Math.abs(pnl).toFixed(2)}${p.strategyName ? ` • استراتژی ${p.strategyName}` : ''}`
  );
  return true;
}

/**
 * v1.5.3 — بستن بخشی از یک پوزیشن دمو («نصف معامله را ببند»):
 * حجم باز کم می‌شود و برای بخشِ بسته‌شده یک رکورد «بسته» با دلیل
 * partial ثبت می‌شود (در تاریخچه و PnL حساب می‌آید — مثل بایننس).
 */
async function partialCloseDemo(
  id: string,
  price: number,
  fraction: number,
  reason: 'partial' | 'partial-manual'
): Promise<boolean> {
  const positions = await loadDemoPositions();
  const idx = positions.findIndex((p) => p.id === id && p.status === 'open');
  if (idx < 0) return false;
  const p = positions[idx];
  const dir = p.side === 'long' ? 1 : -1;
  const closedQty = p.qty * Math.max(0.1, Math.min(0.9, fraction));
  const remainingQty = p.qty - closedQty;
  // اگر باقی‌مانده خیلی کوچک شد، کل معامله بسته می‌شود
  if (remainingQty * price < 1) {
    return closeDemo(id, price, reason === 'partial' ? 'take' : 'manual');
  }
  const pnl = (price - p.entryPrice) * dir * closedQty;
  positions[idx] = {
    ...p,
    qty: remainingQty,
    partialsDone: (p.partialsDone ?? 0) + 1,
    lastPrice: price,
  };
  const partialRecord: DemoAutoPosition = {
    ...p,
    id: `${p.id}-p${(p.partialsDone ?? 0) + 1}`,
    qty: closedQty,
    status: 'closed',
    closedAt: Date.now(),
    closeReason: reason,
    realizedPnl: pnl,
    lastPrice: price,
    partialsDone: undefined,
  };
  positions.splice(idx + 1, 0, partialRecord);
  await saveDemoPositions(positions);
  await recordClosedPnl(pnl);
  const label = reason === 'partial' ? 'برداشت سود پله‌ای (نصف حجم)' : 'بستن دستی نصف حجم';
  await appendLog(
    'close',
    `${label} — ${p.symbol}: ${pnl >= 0 ? '+' : '−'}$${Math.abs(pnl).toFixed(2)} (باقی‌مانده حجم: ${remainingQty.toPrecision(4)})`
  );
  await notifyAutoTrade(
    `🤖 ربات: نصف حجم ${p.symbol} بسته شد`,
    `${label} • ${pnl >= 0 ? 'سود' : 'ضرر'} $${Math.abs(pnl).toFixed(2)} (دمو)`
  );
  await announceTelegram(
    `بک‌تست (دمو): نصف حجم ${p.symbol} بسته شد`,
    `${label} • ${pnl >= 0 ? '✅ سود' : '❌ ضرر'} $${Math.abs(pnl).toFixed(2)}${p.strategyName ? ` • استراتژی ${p.strategyName}` : ''}`
  );
  return true;
}

/**
 * v1.5.3 — بستن بخشی از یک پوزیشن واقعی (reduceOnly بدون لغو SL/TP —
 * استاپ/تیکی با closePosition:true روی حجمِ باقی‌مانده محافظت می‌کنند).
 */
async function partialCloseReal(
  keys: RealKeys,
  pos: RealAutoPosition,
  price: number,
  fraction: number,
  reason: 'partial' | 'partial-manual'
): Promise<boolean> {
  const closedQty = pos.qty * Math.max(0.1, Math.min(0.9, fraction));
  if (!(closedQty > 0)) return false;
  try {
    await closePartialPosition(keys.apiKey, keys.apiSecret, `${pos.symbol}USDT`, pos.side, closedQty);
  } catch {
    return false;
  }
  const remainingQty = pos.qty - closedQty;
  const dir = pos.side === 'long' ? 1 : -1;
  const pnl = (price - pos.entryPrice) * dir * closedQty;
  const tracked = await loadRealPositions();
  const idx = tracked.findIndex((p) => p.id === pos.id && p.status === 'open');
  if (idx < 0) return false;
  tracked[idx] = { ...tracked[idx], qty: remainingQty, partialsDone: (tracked[idx].partialsDone ?? 0) + 1, lastPrice: price };
  const partialRecord: RealAutoPosition = {
    ...tracked[idx],
    id: `${pos.id}-p${(pos.partialsDone ?? 0) + 1}`,
    qty: closedQty,
    status: 'closed',
    closedAt: Date.now(),
    closeReason: reason,
    realizedPnl: pnl,
    lastPrice: price,
    partialsDone: undefined,
  };
  tracked.splice(idx + 1, 0, partialRecord);
  await saveRealPositions(tracked);
  await recordClosedPnl(pnl);
  const label = reason === 'partial' ? 'برداشت سود پله‌ای (نصف حجم)' : 'بستن دستی نصف حجم';
  await appendLog('close', `${label} — واقعی ${pos.symbol}: ${pnl >= 0 ? '+' : '−'}$${Math.abs(pnl).toFixed(2)} تقریبی`);
  await announceTelegram(
    `بک‌تست (واقعی): نصف حجم ${pos.symbol} بسته شد`,
    `${label} • ${pnl >= 0 ? '✅ سود' : '❌ ضرر'} ~$${Math.abs(pnl).toFixed(2)}${pos.strategyName ? ` • استراتژی ${pos.strategyName}` : ''}`
  );
  return true;
}

/** mark-to-market + SL/TP + trailing-stop ratchet for all open demo positions */
async function markDemoPositions(prices: Record<string, number>, settings: AutoTradeSettings): Promise<number> {
  const positions = await loadDemoPositions();
  let dirty = false;
  let closedCount = 0;
  for (let i = 0; i < positions.length; i++) {
    let p = positions[i];
    if (p.status !== 'open') continue;
    const px = prices[`${p.symbol}USDT`];
    if (!px || !(px > 0)) continue;
    positions[i].lastPrice = px;
    dirty = true;
    // v1.5.3 — برداشت سود پله‌ای: سود حساب به ۲۵٪ / ۵۰٪ رسید → نصف حجم ببند
    // (سپس در همان چرخه تریل روی حجم باقی‌مانده اعمال می‌شود).
    const marginPct = marginPnlPctOf(positions[i], px);
    const done = positions[i].partialsDone ?? 0;
    if (done < PARTIAL_TAKE_PNL_PCTS.length && marginPct >= PARTIAL_TAKE_PNL_PCTS[done]) {
      await saveDemoPositions(positions);
      await partialCloseDemo(p.id, px, 0.5, 'partial');
      const fresh = await loadDemoPositions();
      positions.length = 0;
      positions.push(...fresh);
      const fi = positions.findIndex((x) => x.id === p.id && x.status === 'open');
      if (fi < 0) {
        dirty = false;
        continue;
      }
      i = fi;
      p = positions[fi];
      dirty = false;
    }
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
      await announceTelegram(
        `بک‌تست (دمو): بستن ${p.symbol}`,
        `${hitStop ? 'استاپ' : 'تیک‌پرافیت'}${hitStop && pnl >= 0 ? ' (ریسک‌فری)' : ''} • ${pnl >= 0 ? '✅ سود' : '❌ ضرر'} $${Math.abs(pnl).toFixed(2)}${p.strategyName ? ` • استراتژی ${p.strategyName}` : ''}`
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
// v1.5.5 — BACKFILL («تعداد بیشتری از معاملات را نشون بده چرا الان ۴ تا باز
// است درحالی که تنظیمات روی ۲۰ گذاشتم»): وقتی پوزیشن بازِ دمو کمتر از سقف
// تنظیم‌شده است، سیگنال‌های ذخیره‌شدهٔ ۷ روز اخیرِ اندیکاتورها (جدیدترین
// اول) به‌صورت بک‌تست بازپخش می‌شوند تا کتاب پوزیشن‌ها تا سقف تنظیم‌شده
// پر شود. هر سیگنال فقط یک بار بک‌فیل می‌شود (BACKFILL_SEEN_KEY) — تاریخچه
// مصنوعیِ بی‌نهایت ساخته نمی‌شود. ورود با قیمت همان سیگنال و زمان همان
// سیگنال ثبت می‌شود (بک‌تست واقعیِ «اگر آن موقع باز می‌شد»).
// ---------------------------------------------------------------------------

interface BackfillCandidate {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  price: number;
  detectedAt: number;
  indicatorName: string;
}

async function loadBackfillSeen(): Promise<Record<string, true>> {
  try {
    const raw = await AsyncStorage.getItem(BACKFILL_SEEN_KEY);
    if (raw) return JSON.parse(raw) as Record<string, true>;
  } catch {}
  return {};
}

async function saveBackfillSeen(map: Record<string, true>): Promise<void> {
  const keys = Object.keys(map);
  if (keys.length <= BACKFILL_SEEN_CAP) {
    try {
      await AsyncStorage.setItem(BACKFILL_SEEN_KEY, JSON.stringify(map));
    } catch {}
    return;
  }
  // keep the NEWEST entries (drop oldest ~20% to avoid unbounded growth)
  const trimmed: Record<string, true> = {};
  for (const k of keys.slice(Math.floor(keys.length * 0.2))) trimmed[k] = true;
  try {
    await AsyncStorage.setItem(BACKFILL_SEEN_KEY, JSON.stringify(trimmed));
  } catch {}
}

async function openDemoBackfill(
  settings: AutoTradeSettings,
  c: BackfillCandidate,
  sizeUsd: number,
  strategyName: string
): Promise<boolean> {
  const positions = await loadDemoPositions();
  if (positions.filter((p) => p.status === 'open').length >= settings.maxOpenPositions) return false;
  if (positions.some((p) => p.status === 'open' && p.symbol === c.symbol && p.side === c.side)) return false;
  const price = c.price > 0 ? c.price : 0;
  if (!(price > 0)) return false;
  const { stopPrice, takePrice } = computeStopTake(c.side, price, settings.maxLossPercent, settings.rewardRatio, settings.leverage);
  const qty = (sizeUsd * settings.leverage) / price;
  const pos: DemoAutoPosition = {
    id: `d-bf-${c.id}-${Math.random().toString(36).slice(2, 6)}`,
    symbol: c.symbol,
    side: c.side,
    entryPrice: price,
    qty,
    sizeUsd,
    leverage: settings.leverage,
    stopPrice,
    takePrice,
    // زمان ورود = زمان همان سیگنال (بک‌تست واقعی، نه الان)
    openedAt: c.detectedAt,
    source: 'indicator',
    sourceLabel: `${c.indicatorName} (بک‌فیل)`,
    status: 'open',
    lastPrice: price,
    initialStopPrice: stopPrice,
    highWater: price,
    lowWater: price,
    trailArmed: false,
    strategyName,
    partialsDone: 0,
  };
  await saveDemoPositions([pos, ...positions]);
  return true;
}

async function backfillDemoPositions(settings: AutoTradeSettings, prices: Record<string, number>): Promise<number> {
  if (settings.mode !== 'demo' || !settings.enabled) return 0;
  const positions = await loadDemoPositions();
  const openCount = positions.filter((p) => p.status === 'open').length;
  const free = settings.maxOpenPositions - openCount;
  if (free <= 0) return 0;

  // فقط اندیکاتورهای انتخاب‌شده‌ی خود کاربر بک‌فیل می‌شوند
  const sel = settings.indicators.selections;
  if (!settings.indicators.enabled || sel.length === 0) return 0;

  const candidates: BackfillCandidate[] = [];
  const now = Date.now();
  const wants = (id: string) => sel.some((x) => x.id === id);

  if (wants('builtin:hook')) {
    try {
      for (const s of await getStoredHookSignals()) {
        if (now - s.detectedAt > BACKFILL_WINDOW_MS) continue;
        candidates.push({
          id: s.id,
          symbol: s.symbol.replace(/USDT$/i, '').toUpperCase(),
          side: s.action === 'buy' ? 'long' : 'short',
          price: s.price,
          detectedAt: s.detectedAt,
          indicatorName: 'هوک ریورسال',
        });
      }
    } catch {}
  }
  if (wants('builtin:gainz')) {
    try {
      for (const s of await getStoredGainzAlgoSignals()) {
        if (now - s.detectedAt > BACKFILL_WINDOW_MS) continue;
        candidates.push({
          id: s.id,
          symbol: s.symbol.replace(/USDT$/i, '').toUpperCase(),
          side: s.action === 'buy' ? 'long' : 'short',
          price: s.price,
          detectedAt: s.detectedAt,
          indicatorName: 'GainzAlgo Pro',
        });
      }
    } catch {}
  }
  if (candidates.length === 0) return 0;

  // جدیدترین اول؛ هر symbol+side فقط یک‌بار (بعد از انتخاب جدیدترین سیگنالش)
  candidates.sort((a, b) => b.detectedAt - a.detectedAt);
  const seen = await loadBackfillSeen();
  const openSet = new Set(
    positions.filter((p) => p.status === 'open').map((p) => `${p.symbol}|${p.side}`)
  );
  const usedSymbolSide = new Set<string>();
  const picked: BackfillCandidate[] = [];
  for (const c of candidates) {
    if (picked.length >= free) break;
    if (seen[c.id]) continue;
    const key = `${c.symbol}|${c.side}`;
    if (openSet.has(key) || usedSymbolSide.has(key)) continue;
    const price = c.price > 0 ? c.price : prices[`${c.symbol}USDT`] ?? 0;
    if (!(price > 0)) continue;
    usedSymbolSide.add(key);
    picked.push({ ...c, price });
  }
  if (picked.length === 0) return 0;

  // دروازه سرمایه هوشمند یک بار برای کل دسته (نه per-position)
  const gate = await aiCapitalGate(settings);
  if (gate.pausedReason) {
    await appendLog('info', `بک‌فیل انجام نشد: ${gate.pausedReason}`);
    return 0;
  }
  const strategyName = await currentStrategyLabel();
  let opened = 0;
  for (const c of picked) {
    seen[c.id] = true;
    if (await openDemoBackfill(settings, c, gate.sizeUsd, strategyName)) opened++;
  }
  await saveBackfillSeen(seen);
  if (opened > 0) {
    await appendLog(
      'info',
      `بک‌فیل بک‌تست: ${opened} پوزیشن از سیگنال‌های ۷ روز اخیر باز شد (پوزیشن باز: ${openCount + opened}/${settings.maxOpenPositions}) — ورود‌ها با قیمت و زمان خود سیگنال`
    );
  }
  return opened;
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
  const { stopPrice, takePrice } = computeStopTake(side, price, settings.maxLossPercent, settings.rewardRatio, settings.leverage);
  const strategyName = await currentStrategyLabel();
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
    strategyName,
    partialsDone: 0,
  };
  const tracked = await loadRealPositions();
  await saveRealPositions([pos, ...tracked]);
  await appendLog(
    'open',
    `واقعی ${side === 'long' ? 'خرید' : 'فروش'} ${symbol} @ ~${price} (${sourceLabel} • استراتژی ${strategyName}) — SL ${stopPrice.toFixed(4)} / TP ${takePrice.toFixed(4)}${sizeUsd !== settings.positionSizeUsd ? ` • حجم هوشمند: $${sizeUsd.toFixed(1)}` : ''}`
  );
  await notifyAutoTrade(
    `🤖 ربات واقعی: ${side === 'long' ? 'خرید' : 'فروش'} ${symbol}`,
    `ورود ~${price} • استاپ ${stopPrice.toFixed(4)} • تیک‌پرافیت ${takePrice.toFixed(4)} (${sourceLabel})`
  );
  await announceTelegram(
    `بک‌تست (واقعی): ${side === 'long' ? '🟢 خرید' : '🔴 فروش'} ${symbol}`,
    `ورود ~${price} • استاپ ${stopPrice.toFixed(4)} • تیک‌پرافیت ${takePrice.toFixed(4)}\nمنبع: ${sourceLabel} • لوریج ${settings.leverage}x • استراتژی ${strategyName}`
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
    let p = tracked[i];
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
      await announceTelegram(
        `بک‌تست (واقعی): بستن ${p.symbol}`,
        `بسته شد روی صرافی (استاپ/تیک‌پرافیت) • ${pnl >= 0 ? '✅ سود' : '❌ ضرر'} ~$${Math.abs(pnl).toFixed(2)}${p.strategyName ? ` • استراتژی ${p.strategyName}` : ''}`
      );
      continue;
    }
    const mark = parseFloat(lp.markPrice) || p.lastPrice;
    const liveQty = Math.abs(parseFloat(lp.positionAmt));
    tracked[i].lastPrice = mark;
    if (liveQty > 0) tracked[i].qty = liveQty;
    // v1.5.3 — برداشت سود پله‌ای روی پوزیشن واقعی (۲۵٪ / ۵۰٪ سود حساب)؛
    // سپس تریل روی حجم باقی‌مانده در همان چرخه اعمال می‌شود.
    const marginPct = marginPnlPctOf(tracked[i], mark);
    const done = tracked[i].partialsDone ?? 0;
    if (done < PARTIAL_TAKE_PNL_PCTS.length && marginPct >= PARTIAL_TAKE_PNL_PCTS[done]) {
      await saveRealPositions(tracked);
      await partialCloseReal(keys, tracked[i], mark, 0.5, 'partial');
      const fresh = await loadRealPositions();
      tracked.length = 0;
      tracked.push(...fresh);
      const fi = tracked.findIndex((x) => x.id === p.id && x.status === 'open');
      if (fi < 0) continue;
      i = fi;
      p = tracked[fi];
    }
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

  // 4) v1.5.5 — بک‌فیل: پوزیشن بازِ دمو تا سقف تنظیم‌شده پر می‌شود
  //    (بازپخش سیگنال‌های ۷ روز اخیر — هر سیگنال یک بار)
  try {
    const bf = await backfillDemoPositions(settings, prices);
    result.opened += bf;
  } catch {}

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
    // v1.5.5 — «اعلام تلگرام ۲۴/۷ (سرور)» حذف شد: چرخه همیشه «محلی» اجرا
    // می‌شود. قبلاً وقتی سوییچ سرور روشن بود، sync موفق کل چرخه محلی را
    // skip می‌کرد (return) و اگر سرور کاری نمی‌کرد، «نه در برنامه نه در
    // تلگرام» چیزی نمی‌آمد — بازخورد کاربر. حالا ربات روی خود گوشی
    // اجرا می‌شود و اعلام تلگرام از خود برنامه ارسال می‌شود.
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

/**
 * v1.5.3 — «بصورت دستی هم بشه بخشی از حجم را ببندم»: بستن نصف (یا کسر دلخواه)
 * یک پوزیشن باز از روی خود پوزیشن. دمو = ریاضی محلی؛ واقعی = سفارش
 * reduceOnly (SL/TP های صرافی حفظ می‌شوند چون closePosition:true هستند).
 */
export async function manualPartialClosePosition(
  settings: AutoTradeSettings,
  keys: RealKeys | undefined,
  pos: { id: string; symbol: string; side: 'long' | 'short'; lastPrice: number },
  fraction = 0.5
): Promise<boolean> {
  if (settings.mode === 'demo') {
    return partialCloseDemo(pos.id, pos.lastPrice, fraction, 'partial-manual');
  }
  if (keys) {
    const tracked = await loadRealPositions();
    const idx = tracked.findIndex(
      (p) => p.status === 'open' && p.id === pos.id
    );
    if (idx < 0) return false;
    return partialCloseReal(keys, tracked[idx], pos.lastPrice, fraction, 'partial-manual');
  }
  return false;
}

/**
 * v1.5.3 — «برای حالت دمو گزینه ریست بزار که همه چیز از اول بتونم بک‌تست
 * بگیرم حتی تاریخچه هم پاک بشه»: پاک‌کردن کامل حالت دمو — پوزیشن‌ها،
 * تاریخچه، لاگ‌ها، آمار روزانه، استریک و اسنپ‌شات نهنگ. اگر سرور ۲۴/۷
 * فعال باشد، سرور هم ریست می‌شود.
 */
export async function resetDemoBacktest(): Promise<{ local: boolean; server: { ok: boolean; error?: string } }> {
  try {
    await AsyncStorage.multiRemove([
      DEMO_POSITIONS_KEY,
      LOG_KEY,
      WHALE_SNAPSHOT_KEY,
      DAILY_KEY,
      `${DAILY_KEY}:streak`,
      LAST_SIGNAL_AT_KEY,
      // v1.5.5 — بک‌فیل هم از صفر شروع شود بعد از ریست کامل
      BACKFILL_SEEN_KEY,
    ]);
  } catch {}
  await appendLog('info', 'ریست کامل بک‌تست دمو انجام شد — همه‌چیز از صفر شروع می‌شود (حتی تاریخچه پاک شد)');
  // سرور ۲۴/۷: اگر روشن است، state سرور هم پاک شود
  let server: { ok: boolean; error?: string } = { ok: false };
  try {
    const settings = await loadAutoSettings();
    if (await isServerModeActive()) {
      server = await pushAutoTradeConfigToServer(settings, true);
    }
  } catch {}
  return { local: true, server };
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

/** درصد PnL لحظه‌ای یک پوزیشن نسبت به مارجین (حجم دلاری × لوریج) — برای UI.
 *  v1.5.3 — مارجین پویا (qty×ورود÷لوریج) تا بعد از بستن نصف حجم هم درصد درست بماند. */
export function positionPnlPercent(
  p: { side: 'long' | 'short'; entryPrice: number; lastPrice: number; qty: number; sizeUsd?: number; leverage?: number },
  marginUsd?: number
): number {
  const dir = p.side === 'long' ? 1 : -1;
  const pnl = (p.lastPrice - p.entryPrice) * dir * p.qty;
  const margin =
    marginUsd && marginUsd > 0
      ? marginUsd
      : (p.leverage ?? 1) > 0
        ? (p.qty * p.entryPrice) / (p.leverage ?? 1)
        : p.sizeUsd && p.sizeUsd > 0
          ? p.sizeUsd
          : 0;
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
    // حالت سرور ۲۴/۷ (خودکار v1.5.7): state سرور sync می‌شود (سرور خودش چرخه می‌زند).
    // v1.5.4 — اگر sync ناموفق بود، MTM محلی ادامه می‌دهد (ربات ساکت نشود).
    if (await isServerModeActive()) {
      const synced = await syncAutoTradeStateFromServer();
      if (synced) return;
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
/** v1.5.8 — آخرین خطای push ربات به سرور (دلیل دقیق برای نشان وضعیت). */
const SERVER_LAST_ERR_KEY = '@auto_trade_server_last_err_v1';

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

/** v1.5.8 — ذخیره/خواندن آخرین خطای push (با مهر زمانی). */
async function saveLastPushError(error: string): Promise<void> {
  try {
    await AsyncStorage.setItem(SERVER_LAST_ERR_KEY, JSON.stringify({ at: Date.now(), error }));
  } catch {}
}

async function clearLastPushError(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SERVER_LAST_ERR_KEY);
  } catch {}
}

async function readLastPushError(): Promise<{ at: number; error: string } | null> {
  try {
    const raw = await AsyncStorage.getItem(SERVER_LAST_ERR_KEY);
    return raw ? (JSON.parse(raw) as { at: number; error: string }) : null;
  } catch {
    return null;
  }
}

export async function isAutoServerModeActive(): Promise<boolean> {
  return isServerModeActive();
}

/**
 * v1.5.7 — وضعیت ۲۴/۷ برای نشانِ داخل کارت ربات:
 *   active: سرور ربات را اجرا می‌کند و اعلان‌ها حتی با برنامه بسته می‌آیند.
 *   inactive + reason: دقیقاً می‌گوید چرا (سرور تنظیم نشده / تلگرام تنظیم
 *   نشده / آخرین push خطا داده / ربات خاموش).
 */
export interface AutoServerStatus {
  active: boolean;
  reason: string;
  lastPushError?: string;
}

export async function getAutoServerStatus(): Promise<AutoServerStatus> {
  const base = await getServerUrl().catch(() => '');
  if (!base) {
    return { active: false, reason: 'آدرس سرور (Railway) در تنظیمات ثبت نشده — اعلان با برنامه بسته فقط با سرور ممکن است' };
  }
  const creds = await loadTelegramAnnounceCreds();
  if (!creds) {
    return { active: false, reason: 'توکن ربات/چت‌آیدی تلگرام در تنظیمات ثبت نشده — برای اعلان ۲۴/۷ تلگرام لازم است' };
  }
  const settings = await loadAutoSettings();
  if (!settings.enabled) {
    return { active: false, reason: 'ربات روشن نیست — با روشن کردن ربات، حالت ۲۴/۷ خودکار فعال می‌شود' };
  }
  const active = await isServerModeActive();
  if (active) {
    return { active: true, reason: 'سرور ربات را ۲۴/۷ اجرا می‌کند — اعلان‌های باز/بسته شدن حتی با برنامه بسته به تلگرام می‌آید' };
  }
  // v1.5.8 — R4: علت دقیق آخرین push ناموفق (مثلاً ۴۰۳ راز نصب) به‌جای
  // پیام کلی «اتصال برقرار نشد» — ریشه‌ی «هیچ اعلانی با برنامه بسته نمی‌آید».
  const lastErr = await readLastPushError();
  if (lastErr) {
    const isSecret = /راز|403|unauthorized/i.test(lastErr.error);
    return {
      active: false,
      reason: `${lastErr.error}${isSecret ? ' — از تنظیمات، «بررسی سلامت اعلان‌های ۲۴/۷» را باز کنید و سرور را با کد تلگرام بازپس‌گیری کنید' : ' — اگر ماند، سرور Railway را redeploy کنید'}`,
      lastPushError: lastErr.error,
    };
  }
  return {
    active: false,
    reason: 'اتصال به سرور برقرار نشد — با ذخیره تنظیمات/باز شدن برنامه دوباره تلاش می‌شود؛ اگر خطا ماند سرور Railway را redeploy کنید',
  };
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
  /** v1.5.4 — آیا توکن/چت‌آیدی تلگرام روی سرور تنظیم شده (اعلان‌ها می‌روند؟). */
  telegramConfigured?: boolean;
}

// v1.5.4 — منطق merge در فایل مستقل utils/autoMerge.ts (قابل تست در Node)
export { mergePositionsById } from './autoMerge';

/**
 * v1.5.4 — توکن/چت‌آیدی تلگرام که برنامه برای اعلان‌های خودش استفاده می‌کند
 * (@crypto_scanner_settings) — حالا با کانفیگ ربات به سرور هم فرستاده می‌شود
 * تا اعلان‌های ۲۴/۷ بدون راه‌اندازی جداگانه ربات تلگرام سرور کار کنند.
 */
async function loadTelegramAnnounceCreds(): Promise<{ botToken: string; chatId: string } | undefined> {
  try {
    const raw = await AsyncStorage.getItem('@crypto_scanner_settings');
    if (!raw) return undefined;
    const s = JSON.parse(raw) as { telegramEnabled?: boolean; telegramBotToken?: string; telegramChatId?: string };
    if (!s?.telegramBotToken || !s?.telegramChatId) return undefined;
    return { botToken: s.telegramBotToken, chatId: s.telegramChatId };
  } catch {
    return undefined;
  }
}

export async function pushAutoTradeConfigToServer(
  settings: AutoTradeSettings,
  reset = false
): Promise<{ ok: boolean; error?: string; telegramConfigured?: boolean }> {
  try {
    const base = await getServerUrl();
    if (!base) return { ok: false, error: 'آدرس سرور تنظیم نشده' };
    const secret = await getInstallSecret();
    // v1.5.7 — حالت ۲۴/۷ خودکار (بدون سوییچ دستی): ربات روشن + توکن تلگرام
    // برنامه (@crypto_scanner_settings) تنظیم باشد → سرور ربات را ۲۴/۷ اجرا
    // می‌کند و همه‌ی باز/بسته‌شدن‌ها را با برنامه بسته هم به تلگرام می‌فرستد
    // (همان الگوی اسکنر میم‌کوین). بدون تلگرام سروری کاری برای اعلام ندارد.
    const telegram = await loadTelegramAnnounceCreds();
    const serverEnabled = settings.enabled && !!telegram;
    const keys = settings.mode === 'real' && serverEnabled ? await loadRealKeys() : undefined;
    if (settings.mode === 'real' && serverEnabled && !keys) {
      return { ok: false, error: 'کلید API بایننس برای حالت واقعی پیدا نشد' };
    }
    // v1.5.4 — snapshot وضعیت محلی به‌عنوان seed: سرور بک‌تست را از همان‌جایی که
    // برنامه بوده ادامه می‌دهد (تاریخچه حفظ می‌شود — «روشن کردن سوییچ تلگرام
    // همه‌چیز را پاک کرد» دیگر رخ نمی‌دهد) + توکن تلگرام برنامه هم فرستاده می‌شود.
    let demoPositions: DemoAutoPosition[] = [];
    let realPositions: RealAutoPosition[] = [];
    let logs: AutoEngineLog[] = [];
    if (!reset) {
      [demoPositions, realPositions, logs] = await Promise.all([
        loadDemoPositions(),
        loadRealPositions(),
        getAutoLogs(),
      ]);
    }
    const payload = {
      secret,
      config: {
        // v1.5.7 — سرور وقتی اجرا می‌شود که ربات روشن باشد و تلگرام تنظیم
        // باشد (حالت ۲۴/۷ خودکار — بدون سوییچ دستی).
        enabled: serverEnabled,
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
        // v1.5.3 — برچسب استراتژی فعال + پرچم ریست کامل دمو
        strategyLabel: await currentStrategyLabel(),
        reset,
        // v1.5.4/v1.5.7 — توکن تلگرام برنامه → اعلان‌های ۲۴/۷ سرور بدون تنظیم جداگانه
        telegram,
        // v1.5.4 — وضعیت فعلی بک‌تست (سرور از همین‌جا ادامه می‌دهد)
        state: {
          demoPositions: demoPositions.slice(0, 600),
          realPositions: realPositions.slice(0, 600),
          logs: logs.slice(0, 60),
        },
        binanceKeys: keys ? { apiKey: keys.apiKey, apiSecret: keys.apiSecret } : undefined,
      },
    };
    const res = await fetch(`${base}/autotrade/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; telegramConfigured?: boolean };
    if (res.ok && data?.ok) {
      await setServerModeActive(serverEnabled);
      // v1.5.8 — push موفق → خطای قبلی پاک شود
      await clearLastPushError();
      return { ok: true, telegramConfigured: !!telegram || !!data?.telegramConfigured };
    }
    await setServerModeActive(false);
    // v1.5.8 — علت دقیق (۴۰۳ راز نصب / ۴۰۴ سرور قدیمی / …) ذخیره می‌شود تا
    // نشان وضعیت داخل کارت ربات همان را نشان دهد.
    const pushErr =
      data?.error ??
      (res.status === 403
        ? 'راز نصب این گوشی با سرور مچ نیست (۴۰۳)'
        : `سرور پیکربندی ربات را نپذیرفت (HTTP ${res.status})`);
    await saveLastPushError(pushErr);
    // v1.5.3 — 404 = سرور هنوز کد موتور بک‌تست را ندارد (Railway دوباره deploy نشده)
    if (res.status === 404) {
      return {
        ok: false,
        error: 'سرور شما موتور بک‌تست ۲۴/۷ را ندارد — کد سرور (پوشه server) را روی Railway دوباره deploy کنید',
      };
    }
    return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
  } catch (e) {
    await setServerModeActive(false);
    await saveLastPushError(
      e instanceof Error && /network|fetch|abort/i.test(e.message)
        ? 'اتصال به سرور برقرار نشد (شبکه/فیلترشکن)'
        : 'خطای نامشخص در ارتباط با سرور'
    );
    return { ok: false, error: e instanceof Error ? e.message : 'خطای شبکه' };
  }
}

export async function syncAutoTradeStateFromServer(): Promise<boolean> {
  try {
    const settings = await loadAutoSettings();
    if (!settings.enabled) return false;
    const base = await getServerUrl();
    if (!base) return false;
    const secret = await getInstallSecret();
    const res = await fetch(`${base}/autotrade/state?secret=${encodeURIComponent(secret)}`);
    if (!res.ok) return false;
    const data = (await res.json()) as ServerAutoTradeState;
    if (!data?.ok) return false;
    // v1.5.4 — ریشه‌ای: sync دیگر هرگز داده محلی را «پاک» نمی‌کند.
    // قبلاً آرایه خالی سرور (مثلاً لحظه اول روشن کردن سوییچ تلگرام که سرور
    // هنوز state نداشت) روی داده‌های محلی نوشته می‌شد و کاربر «همه‌چیز
    // پاک شد، هیچ معامله‌ای نیست» می‌دید. حالا:
    //   • آرایه غیرخالی سرور → merge بر اساس id (نسخه سرور برنده)
    //   • آرایه خالی سرور + داده محلی موجود → محلی دست‌نخورده می‌ماند
    const localDemo = await loadDemoPositions();
    const localReal = await loadRealPositions();
    if (Array.isArray(data.demoPositions)) {
      if (data.demoPositions.length > 0 || localDemo.length === 0) {
        await saveDemoPositions(mergePositionsById(localDemo, data.demoPositions));
      }
    }
    if (Array.isArray(data.realPositions)) {
      if (data.realPositions.length > 0 || localReal.length === 0) {
        await saveRealPositions(mergePositionsById(localReal, data.realPositions));
      }
    }
    if (Array.isArray(data.logs) && data.logs.length > 0) {
      await AsyncStorage.setItem(LOG_KEY, JSON.stringify(data.logs.slice(0, 60)));
    }
    if (typeof data.lastCycleAt === 'number') lastGlobalCycleAt = data.lastCycleAt;
    return true;
  } catch {
    return false;
  }
}
