/**
 * AutoTradingBotSection.tsx — v1.5.2
 *
 * «معامله‌گر خودکار» (بک‌تست) UI — کپی پوزیشن‌های نهنگ + سیگنال اندیکاتورها را
 * اتوماتیک (دمو یا واقعی) معامله می‌کند با تنظیمات کاربر: لوریج، حجم،
 * حداکثر ضرر (→ استاپ‌لاس اتوماتیک) و ریوارد R:R (→ تیک‌پرافیت اتوماتیک).
 *
 * v1.5.0:
 *  • منبع اندیکاتور: کشویی از اندیکاتورهای آماده (هوک ریورسال + GainzAlgo
 *    Pro) + اندیکاتورهای دستی خود کاربر؛ برای هر اندیکاتور ۱ یا ۲
 *    تایم‌فریم انتخاب می‌شود (خالی = همه).
 *  • تریلینگ استاپ و مدیریت سرمایه هوشمند همیشه‌فعال (سیستم خودش).
 *  • موتور GLOBAL در کل برنامه می‌چرخد (utils/autoTradingEngine)؛ روشن بودن
 *    ربات ذخیره می‌شود و با بستن برنامه خاموش نمی‌شود.
 *  • رفرش پوزیشن‌های ربات = اجرای کامل یک چرخه (قیمت تازه + SL/TP + تریل).
 *
 * v1.5.1:
 *  • نمایش سخت‌گیرانه: در هر حالت فقط ریز معاملات همان حالت نشان داده
 *    می‌شود (در واقعی، جزئیات دمو پنهان است) + بستن دستی پوزیشن باز.
 *  • خروجی عکس PnL: اول عکس ساخته و «پیش‌نمایش» داده می‌شود؛ بعد از دیدن،
 *    ذخیره در گالری یا اشتراک‌گذاری انتخاب می‌شود.
 *  • تاریخچه معاملات با فیلتر روز (امروز/۷/۳۰/همه) + جمع PnL همان بازه.
 *
 * v1.5.2:
 *  • داخل تب «بک‌تست» (دمو | بک‌تست | واقعی).
 *  • رفرش پوزیشن‌ها هر ۳ ثانیه (چرخه سبک MTM + تریل — بدون اسکن سیگنال).
 *  • هر پوزیشن باز: درصد سود/زیان + ویرایش دستی TP/SL از روی خود پوزیشن.
 *  • حداکثر پوزیشن تا ۱۰۰ (قبلاً سقف ۱۰ بود).
 *  • سرمایه اولیه برای PnL/ROI — خروجی دقیقاً مثل فیوچرز بایننس (دلاری + درصد).
 *  • عکس PnL: لوگوی برنامه در بک‌گراند + سود/زیان به درصد و دلاری.
 *  • اعلام تلگرام ۲۴/۷ از سرور (حتی وقتی برنامه بسته است) — دمو و واقعی.
 *
 * v1.5.3:
 *  • حد ضرر با لوریج: «۳٪ با لوریج ۵ = دقیقاً ۱۵٪» — فاصله قیمت = ضرر÷لوریج.
 *  • تریل استاپ در سود: ۱٪ اسپات → ریسک‌فری؛ استاپ روی نصفِ بیشترین سود.
 *  • برداشت سود پله‌ای ۲۵٪/۵۰٪ (ربات خودش نصف حجم می‌بندد) + دکمه «بستن نصف».
 *  • ریست کامل دمو (همه‌چیز حتی تاریخچه پاک می‌شود).
 *  • هر پوزیشن: ساعت و تاریخ باز شدن + قیمت ورود دقیق (خط جدا).
 *  • تاریخچه: نام استراتژی + نوع اندیکاتور کنار نام ارز.
 *  • فیلتر پیش‌فرض تاریخچه و PnL = «امروز» + موجودی (سرمایه اولیه ± PnL).
 *  • عکس PnL: لوگو با پس‌زمینه مشکی (بدون قاب) بهتر دیده می‌شود.
 *
 * v1.5.6 — نسخه تجمیعی (ادغام کامل v1.5.4 + v1.5.5):
 *  • بازیابی همه قابلیت‌های v1.5.4 که در v1.5.5 از قلم افتاده بود: خروجی PDF
 *    تاریخچه (utils/backtestPdf.ts + expo-print)، فیلتر سودها/ضررها + نوع بستن،
 *    صفحه‌بندی ۱۰۰تایی (قبلی/بعدی)، پیغام تایید قبل از بستن کامل، رفرش ۵
 *    ثانیه‌ای، قیمت با دقت بایننس (formatBinancePrice)، مارجین درگیر/آزاد.
 *  • حفظ همه بهبودهای v1.5.5: بک‌فیل ۷ روزه (تا سقف تنظیم‌شده)، سقف ۱۰۰ معامله
 *    تاریخچه، سربرگ «X از Y پوزیشن»، امضای RSA البانک (10203)، merge ایمن sync،
 *    حذف کامل موتور سروری ۲۴/۷ (ربات فقط روی گوشی) و اسکن هوک ۸۰ ارزی.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Switch,
  ActivityIndicator,
  ScrollView,
  Platform,
  Modal,
  Image,
} from 'react-native';
import {
  Bot,
  Waves,
  Gauge,
  Play,
  Square,
  X,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Wallet2,
  Zap,
  ChevronDown,
  ChevronUp,
  Camera,
  CalendarDays,
  Share2,
  Save,
  ShieldCheck,
  Edit3,
  RotateCcw,
  Scissors,
  FileText,
  ChevronRight,
  ChevronLeft,
  Calculator,
  Trash2,
} from 'lucide-react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
// v1.5.6 — بازیابی خروجی PDF تاریخچه (expo-print + utils/backtestPdf.ts)
import * as Print from 'expo-print';
import colors from '@/constants/colors';
// v1.5.7 — همه پیغام‌ها با مودال درون‌برنامه‌ای هماهنگ با تم
import { ThemedAlert } from '@/components/ThemedAlert';
// v1.5.8 — R2: پریست‌های ذخیره‌شده‌ی محاسبه‌گر بک‌تست واقعی
import {
  FeasibilityPreset,
  loadFeasibilityPresets,
  deleteFeasibilityPreset,
  applyFeasibilityPresetToSettings,
  presetSummary,
} from '@/utils/feasibilityPresets';
import { saveEnabledStrategies, STRATEGY_ORDER } from '@/utils/tradeAiService';
import type { TradingStrategy } from '@/types/tradeAi';
// v1.5.6 — بازیابی دقت قیمت بایننس (getFuturesPricePrecisionMap از v1.5.4)
import {
  formatBinancePrice,
  getFuturesPricePrecisionMap,
  fetchIncomeRows,
  summarizeFeesForPosition,
  type BinanceIncomeRow,
} from '@/utils/binanceFuturesTrading';
import { BacktestPdfRow, buildBacktestPdfHtml } from '@/utils/backtestPdf';
import {
  AutoPnlPeriod,
  AutoTf,
  AutoTradeSettings,
  DEFAULT_AUTO_SETTINGS,
  DemoAutoPosition,
  IndicatorOption,
  IndicatorSelection,
  RealAutoPosition,
  RealKeys,
  AUTO_PNL_PERIODS,
  AUTO_PNL_PERIOD_LABEL,
  AUTO_TF_LABEL,
  computeAutoPnlStats,
  closeAllOpenPositions,
  getAutoLogs,
  getLastGlobalCycleAt,
  listIndicatorOptions,
  listTrackedWhales,
  loadAutoSettings,
  loadDemoPositions,
  loadRealKeys,
  loadRealPositions,
  manualClosePosition,
  manualPartialClosePosition,
  positionPnlPercent,
  pushAutoTradeConfigToServer,
  resetDemoBacktest,
  runGlobalCycleNow,
  runLightMtm,
  saveAutoSettings,
  sendAppOpenHeartbeat,
  subscribeAutoSettings,
  syncAutoTradeStateFromServer,
  updatePositionTpsl,
} from '@/utils/autoTradingEngine';

/** v1.5.3 — لوگوی مشکی‌پس‌زمینه (بدون قاب سفید) برای بک‌گراند عکس PnL. */
const APP_LOGO = require('@/assets/images/icon-dark.png');

/** v1.5.4 (بازیابی‌شده در v1.5.6) — رفرش پوزیشن‌های باز هر ۵ ثانیه. */
// v1.5.11 — «با رفرش بخش پی ان ال خیلی سریعتر همیشه بروز باشه»: چرخه‌ی
// سبک + ریلود ویو هر ۲ ثانیه (قبلاً ۵) و کش قیمت ۱.۵ ثانیه‌ای در موتور.
const UI_REFRESH_MS = 2_000;

/** v1.5.4 (بازیابی‌شده در v1.5.6) — صفحه‌بندی تاریخچه: ۱۰۰ معامله در هر صفحه
 * («بالای ۱۰۰ بره صفحه دو و بشه دید در صفحات بعدی»). */
const HIST_PAGE_SIZE = 100;

/**
 * v1.5.12 — سقف ردیفِ جدول PDF («۷ روزه اصلا ساخته نمیشه»): هزاران معامله
 * یعنی HTML چند مگابایتی که موتور چاپ اندروید را عملاً معلق می‌کند. ۸۰۰ ردیف
 * آخر (جدیدترین‌ها) با همه‌ی ۱۴ ستون چاپ می‌شود و جمع‌های کارت آمار «کلِ»
 * بازه را نشان می‌دهد (fullStats) — سرعت تضمین‌شده.
 */
const PDF_MAX_ROWS = 800;

/** v1.5.12 — «تقویم ۳۰ روزه جدولی که سود و زیان کلی هر روز را نشان بدهد». */
const CAL_DAYS = 30;

/** v1.5.4 (بازیابی‌شده در v1.5.6) — فیلتر نوع تاریخچه: همه / فقط سودها /
 *  فقط ضررها / استاپ / تیک‌پرافیت / بستن دستی / بستن حجمی. */
type HistTypeFilter = 'all' | 'wins' | 'losses' | 'stop' | 'take' | 'manual' | 'partial';
const HIST_TYPE_FILTERS: { key: HistTypeFilter; label: string }[] = [
  { key: 'all', label: 'همه' },
  { key: 'wins', label: 'سودها' },
  { key: 'losses', label: 'ضررها' },
  { key: 'stop', label: 'استاپ' },
  { key: 'take', label: 'تیک‌پرافیت' },
  { key: 'manual', label: 'دستی' },
  { key: 'partial', label: 'بستن حجمی' },
];
const HIST_TYPE_FILTER_LABEL: Record<HistTypeFilter, string> = {
  all: 'همه',
  wins: 'فقط سودها',
  losses: 'فقط ضررها',
  stop: 'استاپ',
  take: 'تیک‌پرافیت',
  manual: 'بستن دستی',
  partial: 'بستن حجمی',
};

/** v1.5.8 — R2: نام فارسی استراتژی‌ها در لیست پریست‌های محاسبه‌گر. */
const STRATEGY_LABELS_FA: Record<string, string> = {
  conservative: 'محافظه‌کارانه',
  balanced: 'متعادل',
  aggressive: 'تهاجمی',
  scalper: 'اسکالپر',
};

/** v1.5.4 (بازیابی‌شده در v1.5.6) — تطبیق لیست تاریخچه با فیلتر نوع. */
function matchHistType<T extends { realizedPnl?: number; closeReason?: string }>(list: T[], f: HistTypeFilter): T[] {
  switch (f) {
    case 'wins':
      return list.filter((p) => (p.realizedPnl ?? 0) >= 0);
    case 'losses':
      return list.filter((p) => (p.realizedPnl ?? 0) < 0);
    case 'stop':
      return list.filter((p) => p.closeReason === 'stop');
    case 'take':
      return list.filter((p) => p.closeReason === 'take');
    case 'manual':
      return list.filter((p) => p.closeReason === 'manual');
    case 'partial':
      return list.filter((p) => p.closeReason === 'partial' || p.closeReason === 'partial-manual');
    default:
      return list;
  }
}

/** v1.5.4 (بازیابی‌شده در v1.5.6) — مارجین ورودی پوزیشن: حجم × قیمت ورود ÷ لوریج. */
function marginOfPosition(p: { qty: number; entryPrice: number; leverage?: number; sizeUsd?: number }): number {
  const lev = p.leverage ?? 0;
  return lev > 0 ? (p.qty * p.entryPrice) / lev : (p.sizeUsd ?? 0);
}

/** پوزیشن در حال ویرایش TP/SL (دمو یا واقعی). */
interface EditTpslTarget {
  kind: 'demo' | 'real';
  id: string;
  symbol: string;
  side: 'long' | 'short';
  qty: number;
  stopPrice: number;
  takePrice: number;
  lastPrice: number;
}

/** v1.5.4 — پوزیشن هدف «بستن بخشی از معامله» (دکمه ✂ — درصد دلخواه + تایید). */
interface PartialCloseTarget {
  kind: 'demo' | 'real';
  id: string;
  symbol: string;
  side: 'long' | 'short';
  qty: number;
  entryPrice: number;
  leverage: number;
  lastPrice: number;
}

/** v1.5.4 — ارقام فارسی/عربی → لاتین (ورودی درصد کاربر). */
function parseFaPercent(text: string): number {
  const faToEn = (s: string): string =>
    s
      .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
      .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
      .replace(/٫/g, '.')
      .replace(/[٪%]/g, '')
      .replace(/[^0-9.]/g, '');
  const n = parseFloat(faToEn(text).replace(/\.(?=.*\.)/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

export default function AutoTradingBotSection({ realKeys: realKeysProp }: { realKeys?: RealKeys }) {
  const [settings, setSettings] = useState<AutoTradeSettings>(DEFAULT_AUTO_SETTINGS);
  const [whales, setWhales] = useState<{ address: string; label: string }[]>([]);
  const [indicatorOptions, setIndicatorOptions] = useState<IndicatorOption[]>([]);
  const [positions, setPositions] = useState<DemoAutoPosition[]>([]);
  const [realPositions, setRealPositions] = useState<RealAutoPosition[]>([]);
  const [logs, setLogs] = useState<{ id: string; at: number; kind: string; message: string }[]>([]);
  const [cycleBusy, setCycleBusy] = useState(false);
  const [lastCycleAt, setLastCycleAt] = useState<number | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [realKeys, setRealKeys] = useState<RealKeys | undefined>(realKeysProp);
  const [indDropdownOpen, setIndDropdownOpen] = useState(false);
  const [pnlPeriod, setPnlPeriod] = useState<AutoPnlPeriod>('today');
  const [captureBusy, setCaptureBusy] = useState(false);
  /** v1.5.1 — پیش‌نمایش عکس PnL: اول عکس ساخته و نشان داده می‌شود، بعد ذخیره/اشتراک. */
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  /** v1.5.1 — فیلتر روزِ تاریخچه معاملات ربات (v1.5.3 — پیش‌فرض «امروز»). */
  const [histPeriod, setHistPeriod] = useState<AutoPnlPeriod>('today');
  /** v1.5.3 — ریست کامل دمو در حال انجام. */
  const [resetBusy, setResetBusy] = useState(false);
  /** v1.5.2 — ویرایش دستی TP/SL پوزیشن باز. */
  const [editTpsl, setEditTpsl] = useState<EditTpslTarget | null>(null);
  const [editStopText, setEditStopText] = useState('');
  const [editTakeText, setEditTakeText] = useState('');
  const [tpslBusy, setTpslBusy] = useState(false);
  /** v1.5.4 — بستن بخشی از حجم با درصد دلخواه + تایید (دکمه ✂). */
  const [partialTarget, setPartialTarget] = useState<PartialCloseTarget | null>(null);
  const [partialPctText, setPartialPctText] = useState('50');
  const [partialBusy, setPartialBusy] = useState(false);
  const [partialHint, setPartialHint] = useState('');
  /** v1.5.4 (بازیابی‌شده در v1.5.6) — فیلتر نوع تاریخچه + صفحه‌بندی دمو/واقعی + PDF. */
  const [histTypeFilter, setHistTypeFilter] = useState<HistTypeFilter>('all');
  const [histPage, setHistPage] = useState(1);
  const [realHistPage, setRealHistPage] = useState(1);
  const [pdfBusy, setPdfBusy] = useState(false);
  // v1.5.11 — وضعیت ساخت PDF (تعداد معامله + مرحله) تا کاربر بداند چه
  // چیزی در حال ساخت است و چقدر طول می‌کشد (قبلاً فقط «در حال ساخت…»).
  const [pdfStatus, setPdfStatus] = useState('');
  /** v1.5.12 — تقویم ۳۰ روزه: باز/بسته + رفر عکس + نوع پیش‌نمایش (PnL یا تقویم). */
  const [calOpen, setCalOpen] = useState(false);
  const [previewKind, setPreviewKind] = useState<'pnl' | 'cal'>('pnl');
  /** v1.5.12 — رخدادهای درآمد بایننس (فاندینگ + کارمزد) برای پوزیشن‌های واقعی. */
  const [realFeeRows, setRealFeeRows] = useState<BinanceIncomeRow[]>([]);
  /** v1.5.4 (بازیابی‌شده در v1.5.6) — دقت قیمت بایننس (symbol → pricePrecision). */
  const [pricePrecision, setPricePrecision] = useState<Record<string, number>>({});
  const pnlCardRef = useRef<View>(null);
  /** v1.5.12 — رفر کارت تقویم ۳۰ روزه برای ساخت عکس اشتراک/ذخیره. */
  const calCardRef = useRef<View>(null);

  /** v1.5.8 — R2: پریست‌های محاسبه‌گر (حالت واقعی) */
  const [feasPresets, setFeasPresets] = useState<FeasibilityPreset[]>([]);
  const [feasOpen, setFeasOpen] = useState(true);
  /** v1.5.9 — بستن همه پوزیشن‌های باز (با پیغام تایید). */
  const [closeAllBusy, setCloseAllBusy] = useState(false);

  // load everything on mount
  useEffect(() => {
    (async () => {
      const [s, w, opts, p, rp, l, keys] = await Promise.all([
        loadAutoSettings(),
        listTrackedWhales(),
        listIndicatorOptions(),
        loadDemoPositions(),
        loadRealPositions(),
        getAutoLogs(),
        realKeysProp ? Promise.resolve(realKeysProp) : loadRealKeys(),
      ]);
      setSettings(s);
      setWhales(w);
      setIndicatorOptions(opts);
      setPositions(p);
      setRealPositions(rp);
      setLogs(l.slice(0, 30));
      setRealKeys(keys);
      setLastCycleAt(getLastGlobalCycleAt());
      setLoaded(true);
      // v1.5.9 — شروع برنامه: فقط sync سبک + heartbeat برنامه‌باز. دیگر
      // کانفیگ با هر باز شدن برنامه push نمی‌شود — ریشه‌ی «هر بار برنامه را
      // باز می‌کنم در تلگرام می‌زنه ربات بک‌تست فعال شد». سرور کانفیگ خودش
      // را دارد؛ فقط وضعیتِ شبانه برمی‌گردد و lease برنامه‌باز تازه می‌شود.
      if (s.enabled) {
        void syncAutoTradeStateFromServer(true).catch(() => {});
        void sendAppOpenHeartbeat(true).catch(() => {});
      }
    })().catch(() => setLoaded(true));
  }, [realKeysProp]);

  const persist = useCallback(
    async (next: AutoTradeSettings) => {
      setSettings(next);
      await saveAutoSettings(next);
      // v1.5.7 — حالت ۲۴/۷ خودکار: با هر تغییر تنظیمات (روشن/خاموش ربات یا
      // پارامترها)، کانفیگ به سرور push می‌شود. ربات روشن + تلگرام تنظیم →
      // سرور ۲۴/۷ اجرا و اعلام می‌کند؛ ربات خاموش → سرور متوقف. غیرfatal.
      // v1.5.9 — سرور جدید فقط در گذارِ خاموش→روشن اعلام می‌کند؛ تغییر
      // پارامترها هیچ پیام/لاگ تکراری تولید نمی‌کند.
      void pushAutoTradeConfigToServer(next).catch(() => {});
    },
    []
  );

  // v1.5.7 — R7 ریشه‌ی باگ «پریست استراتژی جدول را پر نمی‌کند»: وقتی بیرونِ
  // این کامپوننت (توقف/روشن‌کردن استراتژی در auto-trade.tsx) تنظیمات ذخیره
  // شود، همین‌جا state تازه می‌شود — جدول لحظه‌ای پریست را نشان می‌دهد و
  // persistهای بعدی دیگر مقادیر کهنه را برنمی‌گردانند.
  useEffect(() => {
    const unsub = subscribeAutoSettings((next) => {
      setSettings((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
    });
    return unsub;
  }, []);

  const refreshPositions = useCallback(async () => {
    setPositions(await loadDemoPositions());
    setRealPositions(await loadRealPositions());
    setLogs((await getAutoLogs()).slice(0, 30));
    setLastCycleAt(getLastGlobalCycleAt());
  }, []);

  // v1.5.8 — R2: پریست‌های محاسبه‌گر در حالت واقعی هر بار که مود عوض می‌شود
  //  دوباره خوانده می‌شوند (ذخیره/حذف در محاسبه‌گر لحظه‌ای منعکس می‌شود).
  useEffect(() => {
    if (settings.mode !== 'real') return;
    let cancelled = false;
    loadFeasibilityPresets().then((list) => {
      if (!cancelled) setFeasPresets(list);
    });
    return () => {
      cancelled = true;
    };
  }, [settings.mode]);

  /** v1.5.8 — R2: اعمال یک پریست محاسبه‌گر روی جدول تنظیمات ربات. */
  const applyFeasibilityPreset = useCallback(
    (preset: FeasibilityPreset) => {
      const next = applyFeasibilityPresetToSettings(settings, preset);
      void persist(next).then(async () => {
        try {
          const map = Object.fromEntries(
            STRATEGY_ORDER.map((s) => [s, s === preset.strategy])
          ) as Record<TradingStrategy, boolean>;
          await saveEnabledStrategies(map);
        } catch {}
        ThemedAlert.alert(
          'تنظیمات محاسبه‌گر اعمال شد ✅',
          `جدول ربات با پریست «${preset.exchangeName}» هم‌مقدار شد:\n${presetSummary(preset)}\n\nحالا دکمه «شروع ربات» را بزنید تا معامله با همین تنظیمات شروع شود.`
        );
      });
    },
    [persist, settings]
  );

  // v1.5.2 — «پوزیشن‌های ربات هر ۳ ثانیه رفرش شوند»: چرخه سبک MTM
  // (قیمت تازه + تریل + چک SL/TP — بدون اسکن سیگنال/نهنگ) + ریلود ویو.
  useEffect(() => {
    if (!loaded) return;
    const t = setInterval(() => {
      void (async () => {
        await runLightMtm();
        await refreshPositions();
      })();
    }, UI_REFRESH_MS);
    return () => clearInterval(t);
  }, [loaded, refreshPositions]);

  // v1.5.0 — «رفرش پوزیشن‌های ربات» = run a FULL engine cycle (fresh prices,
  // SL/TP checks, trailing, whale/indicator sweep) then reload the view.
  const runCycleAndRefresh = useCallback(async () => {
    if (cycleBusy) return;
    setCycleBusy(true);
    try {
      await runGlobalCycleNow();
      await refreshPositions();
    } catch {}
    setCycleBusy(false);
  }, [cycleBusy, refreshPositions]);

  // v1.5.4 (بازیابی‌شده در v1.5.6) — «قیمت را طبق بایننس تا هر چند رقم اعشار
  // داره نشون بده»: نقشه دقت قیمت‌ها از exchangeInfo فیوچرز بایننس (کش ۱
  // ساعته در خود ماژول).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const m = await getFuturesPricePrecisionMap();
        if (!cancelled && Object.keys(m).length > 0) setPricePrecision(m);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // v1.5.1 — فیلتر روز تاریخچه معاملات (امروز/۷/۳۰/همه)
  const histWindowMs = useCallback(
    (p: AutoPnlPeriod): number =>
      p === 'today' ? 24 * 3600_000 : p === '7d' ? 7 * 24 * 3600_000 : p === '30d' ? 30 * 24 * 3600_000 : Infinity,
    []
  );

  const openPositions = useMemo(() => positions.filter((p) => p.status === 'open'), [positions]);
  // v1.5.7 — R2: فیلتر بازه + فیلتر نوع + مرتب‌سازی «جدیدترین بسته‌شده اول».
  // سقف ۱۰۰تایی v1.5.5 حذف شد — صفحه‌بندی ۱۰۰تایی خودش کار نمایش را می‌کند و
  // PDF/جمع بازه روی «تمام» معاملات همان بازه محاسبه می‌شود (نه فقط ۱۰۰ تای
  // روی صفحه). معاملاتی که closedAt ندارند (رکوردهای خیلی قدیمی) با openedAt
  // فیلتر می‌شوند تا «در اون بازه نشون نمیده» رخ ندهد.
  const closedFiltered = useMemo(() => {
    const win = histWindowMs(histPeriod);
    const now = Date.now();
    return matchHistType(
      positions.filter((p) => {
        if (p.status !== 'closed') return false;
        if (win === Infinity) return true;
        const at = p.closedAt ?? p.openedAt;
        return !!at && now - at <= win;
      }),
      histTypeFilter
       ).sort((a, b) => (b.closedAt ?? b.openedAt ?? 0) - (a.closedAt ?? a.openedAt ?? 0));
  }, [positions, histPeriod, histWindowMs, histTypeFilter]);
  const closedTotalPages = Math.max(1, Math.ceil(closedFiltered.length / HIST_PAGE_SIZE));
  const closedPositions = useMemo(() => {
    const page = Math.min(histPage, closedTotalPages);
    return closedFiltered.slice((page - 1) * HIST_PAGE_SIZE, page * HIST_PAGE_SIZE);
  }, [closedFiltered, histPage, closedTotalPages]);
  const realOpen = useMemo(() => realPositions.filter((p) => p.status === 'open'), [realPositions]);
  const realClosedFiltered = useMemo(() => {
    const win = histWindowMs(histPeriod);
    const now = Date.now();
    return matchHistType(
      realPositions.filter((p) => {
        if (p.status !== 'closed') return false;
        if (win === Infinity) return true;
        const at = p.closedAt ?? p.openedAt;
        return !!at && now - at <= win;
      }),
      histTypeFilter
    ).sort((a, b) => (b.closedAt ?? b.openedAt ?? 0) - (a.closedAt ?? a.openedAt ?? 0));
  }, [realPositions, histPeriod, histWindowMs, histTypeFilter]);
  const realClosedTotalPages = Math.max(1, Math.ceil(realClosedFiltered.length / HIST_PAGE_SIZE));
  const realClosed = useMemo(() => {
    const page = Math.min(realHistPage, realClosedTotalPages);
    return realClosedFiltered.slice((page - 1) * HIST_PAGE_SIZE, page * HIST_PAGE_SIZE);
  }, [realClosedFiltered, realHistPage, realClosedTotalPages]);

  // ── v1.5.12 — «اگه فاندینگ ریت یا کارمزدی کم میشه در اون پوزیشن باز نشون
  // بده هم در تاریخچه» (ترید واقعی): درآمد حساب (/fapi/v1/income) یک‌جا و
  // با کش ۶۰ ثانیه‌ای گرفته می‌شود و سهم هر نماد سمت گوشی تفکیک می‌شود.
  // دمو کارمزد/فاندینگ ندارد → چیزی نمایش داده نمی‌شود (واقعیتِ حساب).
  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (settings.mode !== 'real' || !realKeys?.apiKey || !realKeys?.apiSecret) {
      setRealFeeRows([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const candidates = realPositions.filter(
        (p) => p.status === 'open' || (p.status === 'closed' && (p.closedAt ?? p.openedAt) && Date.now() - (p.closedAt ?? p.openedAt)! <= 7 * 86_400_000)
      );
      if (candidates.length === 0) {
        if (!cancelled) setRealFeeRows([]);
        return;
      }
      const since = Math.min(...candidates.map((p) => p.openedAt));
      try {
        const rows = await fetchIncomeRows(realKeys.apiKey, realKeys.apiSecret, since);
        if (!cancelled) setRealFeeRows(rows);
      } catch {
        // بی‌صدا — ردیف‌ها بدون خط کارمزد می‌مانند.
      }
    };
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.mode, realKeys?.apiKey, realKeys?.apiSecret, realPositions.map((p) => p.id).join('|')]);

  /** v1.5.12 — کارمزد + فاندینگ یک پوزیشن واقعی (null = چیزی کم نشده). */
  const realFeesOf = useCallback(
    (p: { symbol: string; openedAt: number; status: string; closedAt?: number }) => {
      if (settings.mode !== 'real') return null;
      const f = summarizeFeesForPosition(
        realFeeRows,
        p.symbol,
        p.openedAt,
        p.status === 'closed' ? p.closedAt ?? undefined : undefined
      );
      if (f.funding === 0 && f.commission === 0) return null;
      return f;
    },
    [settings.mode, realFeeRows]
  );

  // ── v1.5.12 — «تقویم ۳۰ روزه جدولی که در هر روز سود و زیان کلی اون روز را
  // نشان بدهد تفکیک شده» — سطر هر روز: تعداد، سود، ضرر، خالص (جدیدترین اول).
  const calendarRows = useMemo(() => {
    const rowsSrc = settings.mode === 'demo' ? positions : realPositions;
    const now = Date.now();
    const win = CAL_DAYS * 86_400_000;
    const map = new Map<
      string,
      { key: string; label: string; ts: number; trades: number; wins: number; profit: number; loss: number; net: number }
    >();
    for (const p of rowsSrc) {
      if (p.status !== 'closed') continue;
      const at = p.closedAt ?? p.openedAt;
      if (!at || now - at > win) continue;
      const d = new Date(at);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
      let row = map.get(key);
      if (!row) {
        row = { key, label: d.toLocaleDateString('fa-IR'), ts: at, trades: 0, wins: 0, profit: 0, loss: 0, net: 0 };
        map.set(key, row);
      }
      const pnl = p.realizedPnl ?? 0;
      row.trades += 1;
      if (pnl >= 0) {
        row.wins += 1;
        row.profit += pnl;
      } else {
        row.loss += pnl;
      }
      row.net += pnl;
    }
    return Array.from(map.values()).sort((a, b) => b.ts - a.ts);
  }, [settings.mode, positions, realPositions]);

  /** v1.5.12 — ردیف جمع کل تقویم. */
  const calTotals = useMemo(
    () =>
      calendarRows.reduce(
        (acc, r) => ({ trades: acc.trades + r.trades, profit: acc.profit + r.profit, loss: acc.loss + r.loss, net: acc.net + r.net }),
        { trades: 0, profit: 0, loss: 0, net: 0 }
      ),
    [calendarRows]
  );
  // v1.5.7 — R2: جمع سود/زیانِ «تمام» معاملات همان بازه در سرتیتر تاریخچه
  // محاسبه می‌شود (closedFiltered دیگر سقف ۱۰۰تایی ندارد — PDF هم همین است).

  const totalPnl = openPositions.reduce((s, p) => {
    const dir = p.side === 'long' ? 1 : -1;
    return s + (p.lastPrice - p.entryPrice) * dir * p.qty;
  }, 0);
  const realTotalPnl = realOpen.reduce((s, p) => {
    const dir = p.side === 'long' ? 1 : -1;
    return s + (p.lastPrice - p.entryPrice) * dir * p.qty;
  }, 0);

  // v1.5.4 (بازیابی‌شده در v1.5.6) — مارجین درگیر پوزیشن‌های باز حالت فعال
  // (حجم ÷ لوریج) — «حجم مارجین درگیر را هم نشون بده تا بدونم چقد آزاد دارم».
  const engagedMarginUsd = useMemo(() => {
    const list = settings.mode === 'demo' ? openPositions : realOpen;
    return list.reduce((s, p) => s + marginOfPosition(p), 0);
  }, [settings.mode, openPositions, realOpen]);

  // ── PnL stats per period (demo + real) ──
  const demoStats = useMemo(
    () => computeAutoPnlStats(pnlPeriod, positions.filter((p) => p.status === 'closed'), totalPnl),
    [pnlPeriod, positions, totalPnl]
  );
  const realStats = useMemo(
    () => computeAutoPnlStats(pnlPeriod, realPositions.filter((p) => p.status === 'closed'), realTotalPnl),
    [pnlPeriod, realPositions, realTotalPnl]
  );

  // ── indicator selection helpers ──
  const selectionOf = (id: string) => settings.indicators.selections.find((s) => s.id === id);

  const toggleIndicator = (id: string) => {
    const cur = settings.indicators.selections;
    const next: IndicatorSelection[] = cur.some((s) => s.id === id)
      ? cur.filter((s) => s.id !== id)
      : [...cur, { id, timeframes: [] }];
    void persist({ ...settings, indicators: { ...settings.indicators, selections: next } });
  };

  const toggleIndicatorTf = (id: string, tf: AutoTf) => {
    const sel = selectionOf(id);
    if (!sel) return;
    const has = sel.timeframes.includes(tf);
    // «یک یا دو تایم‌فریم»: max 2 — adding a third replaces the oldest.
    let tfs: AutoTf[];
    if (has) {
      tfs = sel.timeframes.filter((x) => x !== tf);
    } else {
      tfs = [...sel.timeframes, tf].slice(-2);
    }
    const next = settings.indicators.selections.map((s) => (s.id === id ? { ...s, timeframes: tfs } : s));
    void persist({ ...settings, indicators: { ...settings.indicators, selections: next } });
  };

  if (!loaded) {
    return (
      <View style={styles.card}>
        <ActivityIndicator size="small" color={colors.dark.accent} />
      </View>
    );
  }

  const startBot = () => {
    if (!settings.whale.enabled && !settings.indicators.enabled) {
      ThemedAlert.alert('منبع انتخاب نشده', 'حداقل یکی از دو منبع (نهنگ یا اندیکاتور) را فعال و انتخاب کنید.');
      return;
    }
    if (settings.whale.enabled && !settings.whale.address) {
      ThemedAlert.alert('نهنگ انتخاب نشده', 'از لیست، نهنگ موردنظر برای کپی معاملات را انتخاب کنید.');
      return;
    }
    if (settings.indicators.enabled && settings.indicators.selections.length === 0) {
      ThemedAlert.alert('اندیکاتور انتخاب نشده', 'از منوی کشویی، حداقل یک اندیکاتور انتخاب کنید.');
      return;
    }
    if (settings.mode === 'real' && !realKeys) {
      ThemedAlert.alert('کلید API نیست', 'برای معامله واقعی، ابتدا کلید API فیوچرز بایننس را در تب «واقعی» اضافه کنید.');
      return;
    }
    ThemedAlert.alert(
      settings.mode === 'demo' ? 'شروع دمو' : 'شروع واقعی',
      settings.mode === 'demo'
        ? 'ربات در حالت دمو شروع می‌شود — پوزیشن‌های شبیه‌سازی‌شده با تنظیمات شما باز/بسته می‌شوند. ربات روشن می‌ماند و با بستن برنامه خاموش نمی‌شود.'
        : 'ربات با پول واقعی شروع می‌شود! هر سیگنال = سفارش مارکت + استاپ + تیک‌پرافیت روی فیوچرز بایننس. استاپ و تیک‌پرافیت روی خود صرافی live می‌مانند و حتی با بسته بودن برنامه محافظت می‌کنند. مطمئنید؟',
      [
        { text: 'لغو', style: 'cancel' },
        {
          text: 'شروع',
          style: settings.mode === 'real' ? 'destructive' : 'default',
          onPress: () => {
            void persist({ ...settings, enabled: true }).then(() => {
              void runCycleAndRefresh();
            });
          },
        },
      ]
    );
  };

  // ── v1.5.0 — PnL share image (save to gallery / share to other apps) ──
  const capturePnl = async (): Promise<string | null> => {
    try {
      if (!pnlCardRef.current) return null;
      const uri = await captureRef(pnlCardRef, { format: 'png', quality: 1, result: 'tmpfile' });
      return uri;
    } catch {
      return null;
    }
  };

  // ── v1.5.1 — PnL image: FIRST capture + preview, THEN choose save/share ──
  const handleMakePnlImage = async () => {
    if (captureBusy) return;
    setCaptureBusy(true);
    try {
      if (Platform.OS === 'web') {
        ThemedAlert.alert('وب', 'خروجی عکس فقط روی گوشی (اندروید/iOS) پشتیبانی می‌شود.');
        return;
      }
      const uri = await capturePnl();
      if (!uri) {
        ThemedAlert.alert('خطا', 'ساخت عکس PnL ممکن نشد.');
        return;
      }
      setPreviewKind('pnl');
      setPreviewUri(uri);
    } finally {
      setCaptureBusy(false);
    }
  };

  // ── v1.5.12 — «گزینه اشتراک عکسو ذخیره هم ذخیره باشه» برای تقویم ۳۰ روزه:
  // اول عکس ساخته و در همان پیش‌نمایش نشان داده می‌شود؛ بعد ذخیره/اشتراک.
  const handleMakeCalImage = async () => {
    if (captureBusy) return;
    setCaptureBusy(true);
    try {
      if (Platform.OS === 'web') {
        ThemedAlert.alert('وب', 'خروجی عکس فقط روی گوشی (اندروید/iOS) پشتیبانی می‌شود.');
        return;
      }
      if (!calCardRef.current) return;
      const uri = await captureRef(calCardRef, { format: 'png', quality: 1, result: 'tmpfile' });
      setPreviewKind('cal');
      setPreviewUri(uri);
    } catch {
      ThemedAlert.alert('خطا', 'ساخت عکس تقویم ممکن نشد.');
    } finally {
      setCaptureBusy(false);
    }
  };

  const handleSharePreview = async () => {
    if (!previewUri || captureBusy) return;
    setCaptureBusy(true);
    try {
      const available = await Sharing.isAvailableAsync().catch(() => false);
      if (!available) {
        ThemedAlert.alert('غيرممکن', 'اشتراک‌گذاری روی این دستگاه در دسترس نیست.');
        return;
      }
      await Sharing.shareAsync(previewUri, {
        mimeType: 'image/png',
        dialogTitle: 'اشتراک‌گذاری PnL معامله‌گر خودکار',
      });
    } finally {
      setCaptureBusy(false);
    }
  };

  const handleSavePreview = async () => {
    if (!previewUri || captureBusy) return;
    setCaptureBusy(true);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync().catch(() => ({ granted: false }) as { granted: boolean });
      if (!perm.granted) {
        ThemedAlert.alert('دسترسی داده نشد', 'برای ذخیره عکس در گالری، دسترسی رسانه را تأیید کنید.');
        return;
      }
      await MediaLibrary.saveToLibraryAsync(previewUri);
      ThemedAlert.alert('ذخیره شد ✅', 'عکس در گالری گوشی ذخیره شد.');
    } catch {
      ThemedAlert.alert('خطا', 'ذخیره عکس انجام نشد.');
    } finally {
      setCaptureBusy(false);
    }
  };

  // v1.5.2 — باز کردن مودال ویرایش دستی TP/SL برای یک پوزیشن باز
  const openEditTpsl = (t: EditTpslTarget) => {
    setEditTpsl(t);
    setEditStopText(String(t.stopPrice));
    setEditTakeText(String(t.takePrice));
  };

  const applyEditTpsl = async () => {
    if (!editTpsl || tpslBusy) return;
    const newStop = parseFloat(editStopText.replace(/[^\d.]/g, ''));
    const newTake = parseFloat(editTakeText.replace(/[^\d.]/g, ''));
    if (!(newStop > 0) || !(newTake > 0)) {
      ThemedAlert.alert('خطا', 'قیمت استاپ و تیک‌پرافیت را درست وارد کنید (بزرگ‌تر از صفر).');
      return;
    }
    const long = editTpsl.side === 'long';
    if (long && newStop >= newTake) {
      ThemedAlert.alert('خطا', 'در پوزیشن لانگ، استاپ باید پایین‌تر از تیک‌پرافیت باشد.');
      return;
    }
    if (!long && newStop <= newTake) {
      ThemedAlert.alert('خطا', 'در پوزیشن شورت، استاپ باید بالاتر از تیک‌پرافیت باشد.');
      return;
    }
    setTpslBusy(true);
    try {
      const ok = await updatePositionTpsl(settings, realKeys, editTpsl, newStop, newTake);
      if (ok) {
        setEditTpsl(null);
        await refreshPositions();
      } else {
        ThemedAlert.alert('ناموفق', 'تغییر TP/SL انجام نشد — اعداد را دوباره چک کنید و دوباره تلاش کنید.');
      }
    } finally {
      setTpslBusy(false);
    }
  };

  /**
   * v1.5.4 — «دکمه کات را می‌زنم یه پیغام بده و بهم بگه چند درصد از حجم را
   * می‌خوای ببندی با انتخاب خودم و تایید» — بستن درصد دلخواه از حجم معامله
   * بعد از تأیید. ۱۰۰٪ = بستن کامل.
   */
  const applyPartialClose = async () => {
    if (!partialTarget || partialBusy) return;
    const pct = parseFaPercent(partialPctText);
    if (!Number.isFinite(pct) || pct < 10) {
      setPartialHint('درصد را بین ۱۰ تا ۱۰۰ وارد کنید (کمتر از ۱۰٪ مجاز نیست).');
      return;
    }
    setPartialHint('');
    setPartialBusy(true);
    try {
      let ok = false;
      if (pct >= 95) {
        // بستن کامل
        ok = await manualClosePosition(settings, realKeys, partialTarget);
      } else {
        ok = await manualPartialClosePosition(settings, realKeys, partialTarget, pct / 100);
      }
      if (ok) {
        setPartialTarget(null);
        await refreshPositions();
      } else {
        setPartialHint('بستن انجام نشد — دوباره تلاش کنید (در حالت واقعی اتصال صرافی لازم است).');
      }
    } finally {
      setPartialBusy(false);
    }
  };

  /** v1.5.4 — باز کردن مودال درصد برای دکمه ✂ (پیش‌فرض ۵۰٪). */
  const openPartialClose = (t: PartialCloseTarget) => {
    setPartialHint('');
    setPartialPctText('50');
    setPartialTarget(t);
  };

  // v1.5.1 — نمایش سخت‌گیرانه: در هر حالت فقط داده‌های همان حالت (واقعی = بدون ریز دمو)
  const hasAnyPosition = settings.mode === 'demo'
    ? openPositions.length > 0 || positions.some((p) => p.status === 'closed')
    : realOpen.length > 0 || realPositions.some((p) => p.status === 'closed');

  // v1.5.2 — ROI٪ بر سرمایه اولیه (مثل خروجی فیوچرز بایننس)
  // (plain function, not a hook — placed after the early `!loaded` return)
  const roiOf = (pnlUsd: number): number =>
    settings.initialCapitalUsd > 0 ? (pnlUsd / settings.initialCapitalUsd) * 100 : 0;

  // v1.5.3 — «عدد ورود را دقیق نشون بده»: نمایش قیمت با حداکثر ۸ رقم مؤثر
  // (بدون گرد کردن‌های toFixed(4) که قیمت‌های کوچک را خراب می‌کرد).
  const fmtExact = (v: number): string => {
    if (!Number.isFinite(v) || v <= 0) return '—';
    const abs = Math.abs(v);
    if (abs >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (abs >= 1) return String(Number(v.toPrecision(8)));
    return String(Number(v.toPrecision(8)));
  };

  // v1.5.4 (بازیابی‌شده در v1.5.6) — قیمت با دقتِ خود بایننس (مثلاً BTC دو رقم
  // اعشار — نه ۵–۸ رقم). (plain function, not a hook — after early return)
  const fmtPrice = (symbol: string, price: number): string => formatBinancePrice(symbol, price, pricePrecision);

  // v1.5.4 (بازیابی‌شده در v1.5.6) — «بستن هر معامله با پیغام تایید»: قبل از
  // بسته شدن کامل، تایید می‌گیرد.
  const confirmClosePosition = (t: { id: string; symbol: string; side: 'long' | 'short'; lastPrice: number }) => {
    ThemedAlert.alert(
      'بستن معامله',
      `معامله ${t.symbol} (${t.side === 'long' ? 'لانگ 🟢' : 'شورت 🔴'}) کامل بسته شود؟`,
      [
        { text: 'لغو', style: 'cancel' },
        {
          text: 'بله، بسته شود',
          style: 'destructive',
          onPress: () => {
            void manualClosePosition(settings, realKeys, t).then(refreshPositions);
          },
        },
      ]
    );
  };

  // v1.5.4 (بازیابی‌شده در v1.5.6) — خروجی PDF کل تاریخچه‌ی فیلتر فعلی (بازه
  // روز + فیلتر نوع) با تمام مشخصات هر پوزیشن.
  const handleExportHistoryPdf = async () => {
    if (pdfBusy) return;
    setPdfBusy(true);
    setPdfStatus('در حال آماده‌سازی داده‌ها…');
    try {
      if (Platform.OS === 'web') {
        ThemedAlert.alert('وب', 'خروجی PDF فقط روی گوشی (اندروید/iOS) پشتیبانی می‌شود.');
        return;
      }
      const isDemo = settings.mode === 'demo';
      const source = isDemo ? closedFiltered : realClosedFiltered;
      if (source.length === 0) {
        ThemedAlert.alert('تاریخچه خالی', 'در این بازه/فیلتر معامله‌ای برای PDF نیست.');
        return;
      }
      // v1.5.12 — «۷ روزه اصلا ساخته نمیشه»: ریشه، حجم HTML بود. ۸۰۰ ردیف
      // آخر (جدیدترین‌ها) جدول می‌شود؛ آمارِ کارت از «کلِ» بازه (fullStats).
      const capped = source.length > PDF_MAX_ROWS;
      const rowsSource = capped ? source.slice(0, PDF_MAX_ROWS) : source;
      const fullWins = source.filter((p) => (p.realizedPnl ?? 0) >= 0).length;
      const fullStats = {
        trades: source.length,
        wins: fullWins,
        losses: source.length - fullWins,
        realized: source.reduce((s2, p) => s2 + (p.realizedPnl ?? 0), 0),
      };
      setPdfStatus(`در حال ساخت PDF (${source.length.toLocaleString('fa-IR')} معامله)…`);
      const rows: BacktestPdfRow[] = rowsSource.map((p) => {
        // v1.5.12 — «کارمزد + فاندینگ» فقط ترید واقعی (دمو کارمزد ندارد).
        let feesText: string | undefined;
        if (!isDemo) {
          const f = realFeesOf(p);
          if (f) {
            feesText = `فاندینگ ${f.funding >= 0 ? '−' : '+'}$${Math.abs(f.funding).toFixed(2)} • کارمزد ${f.commission >= 0 ? '−' : '+'}$${Math.abs(f.commission).toFixed(2)}`;
          }
        }
        return {
          symbol: p.symbol,
          side: p.side,
          strategyName: p.strategyName,
          sourceLabel: p.sourceLabel,
          entryPrice: p.entryPrice,
          stopPrice: p.stopPrice,
          takePrice: p.takePrice,
          marginUsd: marginOfPosition(p),
          qty: p.qty,
          leverage: p.leverage,
          openedAt: p.openedAt,
          closedAt: p.closedAt,
          closeReason: p.closeReason,
          realizedPnl: p.realizedPnl,
          entryText: fmtPrice(p.symbol, p.entryPrice),
          stopText: fmtPrice(p.symbol, p.stopPrice),
          takeText: fmtPrice(p.symbol, p.takePrice),
          exitText: p.lastPrice > 0 ? fmtPrice(p.symbol, p.lastPrice) : '—',
          feesText,
        };
      });
      const windowDays = histWindowMs(histPeriod) / 86400000;
      const truncatedNote = capped
        ? `از ${source.length.toLocaleString('fa-IR')} معامله‌ی این بازه، ${PDF_MAX_ROWS.toLocaleString('fa-IR')} معامله‌ی آخر در جدول آمده (برای سرعتِ چاپ) — جمع‌های آمار بالای گزارش شامل «همه‌ی» معاملات است.`
        : undefined;
      const metaBase = {
        mode: settings.mode,
        periodLabel: AUTO_PNL_PERIOD_LABEL[histPeriod],
        filterLabel: HIST_TYPE_FILTER_LABEL[histTypeFilter],
        initialCapitalUsd: settings.initialCapitalUsd,
        engagedMarginUsd,
        openPnlUsd: isDemo ? totalPnl : realTotalPnl,
        generatedAt: Date.now(),
        fullStats,
        truncatedNote,
      };
      // تلاش اول: قالب چاپ سریع با جدول (۸۰۰ ردیف آخر). تلاش دوم (فول‌بک):
      // فقط خلاصه‌ی آمار بدون جدول تا کاربر «همیشه» یک PDF تحویل بگیرد.
      const attempt = async (withTables: boolean): Promise<{ uri: string } | null> => {
        const html = buildBacktestPdfHtml(rows, {
          ...metaBase,
          windowDays: withTables ? windowDays : 30,
        });
        let timedOut = false;
        const timeout = new Promise<null>((resolve) => {
          setTimeout(() => {
            timedOut = true;
            resolve(null);
          }, 90_000);
        });
        const printResult = await Promise.race([
          Print.printToFileAsync({ html }).catch(() => null),
          timeout,
        ]);
        if (timedOut) return null;
        return printResult;
      };
      let printResult = await attempt(true);
      let usedFallback = false;
      if (!printResult) {
        usedFallback = true;
        setPdfStatus('جدول طول کشید — ساخت نسخه‌ی خلاصه…');
        printResult = await attempt(false);
      }
      if (!printResult) {
        ThemedAlert.alert(
          'ساخت PDF انجام نشد',
          'حتی نسخه‌ی خلاصه هم در ۹۰ ثانیه آماده نشد — اتصال اینترنت/حافظه‌ی دستگاه را بررسی کنید یا فیلتر کوچک‌تری (امروز) را انتخاب کنید.'
        );
        return;
      }
      if (usedFallback) {
        ThemedAlert.alert(
          'PDF خلاصه ساخته شد',
          'جدول ریز معاملات برای این تعداد بیش از حد طول کشید؛ PDF با کارت آمار کامل (بدون جدول) ساخته شد. برای جدول ریز، بازه‌ی «امروز» را امتحان کنید.'
        );
      }
      const { uri } = printResult;
      setPdfStatus('آماده شد — باز کردن اشتراک‌گذاری…');
      const available = await Sharing.isAvailableAsync().catch(() => false);
      if (!available) {
        ThemedAlert.alert('PDF ساخته شد', 'فایل ساخته شد اما اشتراک‌گذاری روی این دستگاه در دسترس نیست.');
        return;
      }
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'گزارش تاریخچه بک‌تست (PDF)' });
    } catch {
      ThemedAlert.alert('خطا', 'ساخت PDF انجام نشد — دوباره تلاش کنید.');
    } finally {
      setPdfBusy(false);
      setPdfStatus('');
    }
  };

  // v1.5.3 — ساعت + تاریخ شمسی باز شدن معامله
  const fmtOpenTime = (ms?: number): string => {
    if (!ms) return '';
    try {
      const d = new Date(ms);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const fa = d.toLocaleDateString('fa-IR');
      return `${hh}:${mm} — ${fa}`;
    } catch {
      return '';
    }
  };

  // v1.5.3 — «برای حالت دمو گزینه ریست بزار که همه چی از اول بتونم بک‌تست بگیرم»
  const handleResetDemo = () => {
    ThemedAlert.alert(
      'ریست کامل بک‌تست دمو',
      'همه پوزیشن‌های دمو، تاریخچه، آمار روزانه و لاگ‌ها پاک می‌شوند و از صفر شروع می‌کنید. (حالت واقعی دست‌نخورده می‌ماند.)',
      [
        { text: 'لغو', style: 'cancel' },
        {
          text: 'ریست کامل',
          style: 'destructive',
          onPress: () => {
            if (resetBusy) return;
            setResetBusy(true);
            void (async () => {
              try {
                await resetDemoBacktest();
                await refreshPositions();
                ThemedAlert.alert('ریست شد ✅', 'بک‌تست دمو از صفر شروع شد — در اولین چرخه، سیگنال‌های ۷ روز اخیر دوباره تا سقف پوزیشن‌های همزمان باز می‌شوند.');
              } finally {
                setResetBusy(false);
              }
            })();
          },
        },
      ]
    );
  };

  // v1.5.9 — «یه گزینه بستن همه پوزیشن‌های باز با پیغام تایید در بک‌تست»:
  // اول پیغام تایید (تعداد + حالت)، بعد از تأیید همه پوزیشن‌های باز همان
  // حالت با قیمت لحظه‌ای بسته می‌شوند (واقعی: سفارش مارکت روی بایننس).
  const handleCloseAllPositions = () => {
    const count = settings.mode === 'demo' ? openPositions.length : realOpen.length;
    if (count === 0) {
      ThemedAlert.alert('پوزیشنی نیست', 'هیچ پوزیشن بازی برای بستن وجود ندارد.');
      return;
    }
    ThemedAlert.alert(
      'بستن همه پوزیشن‌های باز',
      `همه ${count.toLocaleString('fa-IR')} پوزیشن بازِ ${settings.mode === 'demo' ? 'دمو' : 'واقعی'} با قیمت لحظه‌ای بسته می‌شود${settings.mode === 'real' ? ' (سفارش مارکت روی بایننس — برگشت‌ناپذیر است)' : ''}. مطمئن هستید؟`,
      [
        { text: 'لغو', style: 'cancel' },
        {
          text: `بله، همه بسته شود (${count.toLocaleString('fa-IR')})`,
          style: 'destructive',
          onPress: () => {
            if (closeAllBusy) return;
            setCloseAllBusy(true);
            void (async () => {
              try {
                const res = await closeAllOpenPositions(settings, realKeys);
                await refreshPositions();
                ThemedAlert.alert(
                  'بسته شد ✅',
                  `${res.closed.toLocaleString('fa-IR')} پوزیشن بسته شد${res.failed > 0 ? ` • ${res.failed.toLocaleString('fa-IR')} ناموفق (دوباره تلاش کنید)` : ''}`
                );
              } catch {
                ThemedAlert.alert('خطا', 'بستن گروهی انجام نشد — دوباره تلاش کنید.');
              } finally {
                setCloseAllBusy(false);
              }
            })();
          },
        },
      ]
    );
  };

  return (
    <View style={styles.card}>
      <Pressable style={styles.header} onPress={() => setShowDetail((v) => !v)}>
        <View style={styles.headerRight}>
          <View style={[styles.headerIcon, settings.enabled && styles.headerIconActive]}>
            <Bot size={16} color={settings.enabled ? colors.dark.background : colors.dark.accent} />
          </View>
          <View>
            <Text style={styles.title}>معامله‌گر خودکار</Text>
            <Text style={styles.subtitle}>
              {settings.enabled
                ? `${settings.mode === 'demo' ? 'دمو' : 'واقعی'} فعال • ${settings.mode === 'demo' ? `${openPositions.length}/${settings.maxOpenPositions} پوزیشن دمو` : `${realOpen.length} پوزیشن واقعی`} • همیشه روشن`
                : 'کپی نهنگ‌ها + سیگنال اندیکاتورها — دمو یا واقعی'}
            </Text>
          </View>
        </View>
        <View style={styles.headerLeft}>
          {cycleBusy && <ActivityIndicator size="small" color={colors.dark.accent} />}
          {settings.enabled ? (
            <Square size={16} color={colors.dark.red} />
          ) : (
            <Play size={16} color={colors.dark.green} />
          )}
        </View>
      </Pressable>

      {(settings.enabled || showDetail) && (
        <View style={styles.body}>
          {/* mode + enable */}
          <View style={styles.row}>
            <View style={styles.modeToggle}>
              {(['demo', 'real'] as const).map((m) => (
                <Pressable
                  key={m}
                  style={[styles.modeBtn, settings.mode === m && styles.modeBtnActive, m === 'real' && settings.mode === m && styles.modeBtnReal]}
                  onPress={() => void persist({ ...settings, mode: m, enabled: settings.enabled && m === 'demo' ? settings.enabled : false })}
                >
                  <Text style={[styles.modeBtnText, settings.mode === m && styles.modeBtnTextActive]}>
                    {m === 'demo' ? 'دمو' : 'واقعی'}
                  </Text>
                </Pressable>
              ))}
            </View>
            {settings.enabled ? (
              <Pressable style={styles.stopBtn} onPress={() => void persist({ ...settings, enabled: false })}>
                <Square size={12} color={colors.dark.red} />
                <Text style={styles.stopBtnText}>توقف</Text>
              </Pressable>
            ) : (
              <Pressable style={styles.startBtn} onPress={startBot}>
                <Play size={12} color={colors.dark.background} />
                <Text style={styles.startBtnText}>شروع ربات</Text>
              </Pressable>
            )}
            {/* v1.5.3 — ریست کامل بک‌تست دمو (همه‌چیز حتی تاریخچه پاک شود) */}
            {settings.mode === 'demo' && (
              <Pressable style={styles.resetBtn} onPress={handleResetDemo} disabled={resetBusy} testID="demo-reset-btn">
                {resetBusy ? (
                  <ActivityIndicator size="small" color={colors.dark.accent} />
                ) : (
                  <RotateCcw size={12} color={colors.dark.accent} />
                )}
                <Text style={styles.resetBtnText}>ریست کامل</Text>
              </Pressable>
            )}
          </View>
          {settings.mode === 'real' && !realKeys && (
            <Text style={styles.warn}>کلید API فیوچرز بایننس اضافه نشده — از تب «واقعی» اضافه کنید (برای دمو لازم نیست).</Text>
          )}
          {settings.mode === 'real' && realKeys && (
            <Text style={styles.warnReal}>⚠ حالت واقعی: هر سیگنال با پول واقعی معامله می‌شود — استاپ/تیپی روی صرافی live می‌ماند.</Text>
          )}

          {/* ── v1.5.8 — R2: «تنظیمات محاسبه‌گر (ذخیره‌شده)» — پریست‌هایی که
              کاربر در محاسبه‌گر برای هر صرافی پیدا و ذخیره کرده؛ هر موقع
              خواست همین‌جا انتخاب می‌کند و با همان صرافی/اعداد معامله را
              شروع می‌کند. ── */}
          {settings.mode === 'real' && (
            <View style={styles.feasBox}>
              <Pressable style={styles.feasHead} onPress={() => setFeasOpen((v) => !v)}>
                <Calculator size={13} color={colors.dark.accent} />
                <Text style={styles.feasTitle}>تنظیمات محاسبه‌گر (ذخیره‌شده)</Text>
                <View style={styles.feasChev}>
                  {feasOpen ? (
                    <ChevronUp size={13} color={colors.dark.textSecondary} />
                  ) : (
                    <ChevronDown size={13} color={colors.dark.textSecondary} />
                  )}
                </View>
              </Pressable>
              {feasOpen && (
                <>
                  {feasPresets.length === 0 ? (
                    <Text style={styles.feasHint}>
                      هنوز تنظیماتی ذخیره نکرده‌اید — در «محاسبه‌گر بک‌تست واقعی» (پایین همین تب) تنظیمات مناسب هر صرافی را پیدا کنید و دکمه «ذخیره این تنظیمات» را بزنید؛ این‌جا قابل انتخاب می‌شود.
                    </Text>
                  ) : (
                    feasPresets.map((p) => (
                      <View key={p.id} style={styles.feasRow}>
                        <Pressable style={styles.feasTexts} onPress={() => applyFeasibilityPreset(p)}>
                          <Text style={styles.feasRowTitle} numberOfLines={1}>
                            {p.exchangeName} • {STRATEGY_LABELS_FA[p.strategy] ?? p.strategy}
                          </Text>
                          <Text style={styles.feasRowSub} numberOfLines={2}>
                            {presetSummary(p)}
                          </Text>
                          <Text style={styles.feasRowDate}>
                            ذخیره: {new Date(p.createdAt).toLocaleDateString('fa-IR')} — برای اعمال بزنید
                          </Text>
                        </Pressable>
                        <Pressable
                          style={styles.feasDel}
                          onPress={() => {
                            void deleteFeasibilityPreset(p.id).then(() => {
                              setFeasPresets((prev) => prev.filter((x) => x.id !== p.id));
                            });
                          }}
                        >
                          <Trash2 size={13} color={colors.dark.red} />
                        </Pressable>
                      </View>
                    ))
                  )}
                </>
              )}
            </View>
          )}
          {settings.enabled && (
            <View style={styles.engineBadge}>
              <ShieldCheck size={11} color={colors.dark.green} />
              <Text style={styles.engineBadgeText}>
                موتور همیشه‌فعال: هر ۶۰ ثانیه + هنگام باز شدن برنامه چرخه می‌زند — با بستن برنامه خاموش نمی‌شود.
                {lastCycleAt ? ` آخرین چرخه: ${Math.max(0, Math.round((Date.now() - lastCycleAt) / 1000))} ثانیه پیش.` : ''}
              </Text>
            </View>
          )}
          {/* v1.5.9 — نشان «اعلام تلگرام ۲۴/۷» از کارت بک‌تست حذف شد
              (بازخورد کاربر: «گزینه متن اعلان تلگرام ۷/۲۴ را از بک‌تست حذف کن»)
              — وضعیت کامل اعلان‌های ۲۴/۷ در تنظیمات ← «بررسی سلامت اعلان‌های ۲۴/۷». */}

          {/* whale source — on/off like whale-tracking toggles */}
          <View style={styles.sourceBox}>
            <View style={styles.sourceHead}>
              <Waves size={13} color={colors.dark.blue} />
              <Text style={styles.sourceTitle}>کپی معاملات نهنگ</Text>
              <Switch
                value={settings.whale.enabled}
                onValueChange={(v) => void persist({ ...settings, whale: { ...settings.whale, enabled: v } })}
                trackColor={{ true: colors.dark.green + '88', false: colors.dark.card }}
                thumbColor={settings.whale.enabled ? colors.dark.green : colors.dark.textMuted}
                style={{ transform: [{ scale: 0.7 }] }}
              />
            </View>
            {settings.whale.enabled && (
              <>
                {whales.length === 0 ? (
                  <Text style={styles.sourceHint}>هنوز نهنگی ردیابی نکرده‌اید — از تب «ردیابی نهنگ‌ها» اضافه کنید.</Text>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
                    {whales.map((w) => (
                      <Pressable
                        key={w.address}
                        style={[styles.chip, settings.whale.address === w.address && styles.chipActive]}
                        onPress={() => void persist({ ...settings, whale: { ...settings.whale, address: w.address, label: w.label } })}
                      >
                        <Text style={[styles.chipText, settings.whale.address === w.address && styles.chipTextActive]} numberOfLines={1}>
                          🐋 {w.label}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
                <Pressable style={styles.miniRow} onPress={() => void persist({ ...settings, whale: { ...settings.whale, mirrorSide: !settings.whale.mirrorSide } })}>
                  <Zap size={11} color={colors.dark.accent} />
                  <Text style={styles.miniText}>
                    جهت معامله: {settings.whale.mirrorSide ? 'همان جهت نهنگ (کپی مستقیم)' : 'برعکس نهنگ (ضدجهت)'} — برای تغییر بزنید
                  </Text>
                </Pressable>
              </>
            )}
          </View>

          {/* indicator source — dropdown of ready + custom indicators,
              per-indicator 1-2 timeframe selection */}
          <View style={styles.sourceBox}>
            <View style={styles.sourceHead}>
              <Gauge size={13} color={colors.dark.blue} />
              <Text style={styles.sourceTitle}>سیگنال اندیکاتورها (آماده/دستی)</Text>
              <Switch
                value={settings.indicators.enabled}
                onValueChange={(v) => void persist({ ...settings, indicators: { ...settings.indicators, enabled: v } })}
                trackColor={{ true: colors.dark.green + '88', false: colors.dark.card }}
                thumbColor={settings.indicators.enabled ? colors.dark.green : colors.dark.textMuted}
                style={{ transform: [{ scale: 0.7 }] }}
              />
            </View>
            {settings.indicators.enabled && (
              <>
                <Pressable style={styles.indDropdownBtn} onPress={() => setIndDropdownOpen((v) => !v)}>
                  <Text style={styles.indDropdownText}>
                    انتخاب اندیکاتور (کشویی) — {settings.indicators.selections.length.toLocaleString('fa-IR')} انتخاب‌شده
                  </Text>
                  {indDropdownOpen ? (
                    <ChevronUp size={14} color={colors.dark.accent} />
                  ) : (
                    <ChevronDown size={14} color={colors.dark.accent} />
                  )}
                </Pressable>
                {indDropdownOpen && (
                  <View style={styles.indDropdownPanel}>
                    {indicatorOptions.length === 0 && (
                      <Text style={styles.sourceHint}>اندیکاتوری موجود نیست — از تب «اندیکاتورها» اضافه کنید.</Text>
                    )}
                    {indicatorOptions.map((opt) => {
                      const sel = selectionOf(opt.id);
                      const on = !!sel;
                      return (
                        <Pressable
                          key={opt.id}
                          style={[styles.indRow, on && styles.indRowActive]}
                          onPress={() => toggleIndicator(opt.id)}
                        >
                          <View style={styles.indRowTexts}>
                            <Text style={styles.indRowLabel}>
                              {opt.kind === 'hook' ? '🪝 ' : opt.kind === 'gainz' ? '📊 ' : '🧩 '}
                              {opt.name}
                            </Text>
                            <Text style={styles.indRowHint}>
                              تایم‌فریم‌ها: {opt.timeframes.map((t) => AUTO_TF_LABEL[t]).join(' / ')}
                            </Text>
                          </View>
                          <View style={[styles.checkbox, on && { backgroundColor: colors.dark.accent, borderColor: colors.dark.accent }]}>
                            {on && <Text style={styles.checkboxTick}>✓</Text>}
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                {settings.indicators.selections.length > 0 && (
                  <View style={styles.selList}>
                    {settings.indicators.selections.map((sel) => {
                      const opt = indicatorOptions.find((o) => o.id === sel.id);
                      if (!opt) return null;
                      return (
                        <View key={sel.id} style={styles.selRow}>
                          <View style={styles.selRowHead}>
                            <Text style={styles.selRowName} numberOfLines={1}>{opt.name}</Text>
                            <Pressable hitSlop={8} onPress={() => toggleIndicator(opt.id)}>
                              <X size={12} color={colors.dark.red} />
                            </Pressable>
                          </View>
                          <Text style={styles.selTfLabel}>
                            معامله سیگنال کدام تایم‌فریم: (خالی = همه • حداکثر ۲)
                          </Text>
                          <View style={styles.tfChipsRow}>
                            {opt.timeframes.map((tf) => {
                              const on = sel.timeframes.includes(tf);
                              return (
                                <Pressable
                                  key={tf}
                                  style={[styles.tfChip, on && styles.tfChipActive]}
                                  onPress={() => toggleIndicatorTf(opt.id, tf)}
                                >
                                  <Text style={[styles.tfChipText, on && styles.tfChipTextActive]}>
                                    {AUTO_TF_LABEL[tf]}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </>
            )}
          </View>

          {/* trade settings */}
          <View style={styles.sourceBox}>
            <View style={styles.sourceHead}>
              <Wallet2 size={13} color={colors.dark.green} />
              <Text style={styles.sourceTitle}>تنظیمات هر معامله</Text>
            </View>
            <View style={styles.settingsGrid}>
              <View style={styles.settingCell}>
                <Text style={styles.settingLabel}>لوریج</Text>
                <TextInput
                  style={styles.settingInput}
                  value={String(settings.leverage)}
                  onChangeText={(t) => setSettings((s) => ({ ...s, leverage: Math.max(1, Math.min(125, parseInt(t.replace(/\D/g, '') || '1', 10) || 1)) }))}
                  onEndEditing={() => void persist(settings)}
                  keyboardType="number-pad"
                />
              </View>
              <View style={styles.settingCell}>
                <Text style={styles.settingLabel}>حجم ($)</Text>
                <TextInput
                  style={styles.settingInput}
                  value={String(settings.positionSizeUsd)}
                  onChangeText={(t) => setSettings((s) => ({ ...s, positionSizeUsd: Math.max(5, parseInt(t.replace(/\D/g, '') || '5', 10) || 5) }))}
                  onEndEditing={() => void persist(settings)}
                  keyboardType="number-pad"
                />
              </View>
              <View style={styles.settingCell}>
                <Text style={styles.settingLabel}>حد ضرر (٪)</Text>
                <TextInput
                  style={styles.settingInput}
                  value={String(settings.maxLossPercent)}
                  onChangeText={(t) => setSettings((s) => ({ ...s, maxLossPercent: Math.max(0.5, Math.min(90, parseFloat(t.replace(/[^\d.]/g, '') || '5') || 5)) }))}
                  onEndEditing={() => void persist(settings)}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.settingCell}>
                <Text style={styles.settingLabel}>ریوارد (R:R)</Text>
                <TextInput
                  style={styles.settingInput}
                  value={String(settings.rewardRatio)}
                  onChangeText={(t) => setSettings((s) => ({ ...s, rewardRatio: Math.max(0.5, Math.min(20, parseFloat(t.replace(/[^\d.]/g, '') || '2') || 2)) }))}
                  onEndEditing={() => void persist(settings)}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.settingCell}>
                <Text style={styles.settingLabel}>حداکثر پوزیشن</Text>
                <TextInput
                  style={styles.settingInput}
                  value={String(settings.maxOpenPositions)}
                  onChangeText={(t) => setSettings((s) => ({ ...s, maxOpenPositions: Math.max(1, Math.min(100, parseInt(t.replace(/\D/g, '') || '3', 10) || 3)) }))}
                  onEndEditing={() => void persist(settings)}
                  keyboardType="number-pad"
                />
                <Text style={styles.settingHint}>۱ تا ۱۰۰ — قبلاً سقف ۱۰ بود</Text>
              </View>
              {/* v1.5.2 — سرمایه اولیه برای محاسبه PnL/ROI (مثل فیوچرز بایننس) */}
              <View style={styles.settingCell}>
                <Text style={styles.settingLabel}>سرمایه اولیه ($)</Text>
                <TextInput
                  style={styles.settingInput}
                  value={String(settings.initialCapitalUsd)}
                  onChangeText={(t) =>
                    setSettings((s) => ({
                      ...s,
                      initialCapitalUsd: Math.max(1, Math.min(10_000_000, parseFloat(t.replace(/[^\d.]/g, '') || '1000') || 1000)),
                    }))
                  }
                  onEndEditing={() => void persist(settings)}
                  keyboardType="decimal-pad"
                  testID="initial-capital-input"
                />
                <Text style={styles.settingHint}>درصد PnL نسبت به این حساب می‌شود</Text>
              </View>
            </View>
            <Text style={styles.sourceHint}>
              استاپ‌لاس با لوریج حساب می‌شود: حد ضرر {settings.maxLossPercent}٪ با لوریج {settings.leverage} = ضررِ حساب {Number(settings.maxLossPercent) * settings.leverage}٪ (فاصله قیمت = حد ضرر ÷ لوریج). تیک‌پرافیت = فاصله استاپ × {settings.rewardRatio} (R:R).
            </Text>
          </View>

          {/* v1.5.0 — smart risk management (trailing + AI capital) */}
          <View style={styles.sourceBox}>
            <View style={styles.sourceHead}>
              <ShieldCheck size={13} color={colors.dark.blue} />
              <Text style={styles.sourceTitle}>مدیریت ریسک هوشمند (سیستم خودش)</Text>
            </View>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchRowTitle}>تریلینگ استاپ (در سود حرکت می‌کند)</Text>
                <Text style={styles.switchRowHint}>
                  با ۱٪ حرکت قیمت به سود (با لوریج ۵ = ۵٪ سود) معامله ریسک‌فری می‌شود؛ بعدش استاپ روی نصفِ بیشترین سود می‌نشیند (مثلاً ۱۰٪ سود → استاپ روی ۵٪) تا با برگشت قیمت حداقل نصف سود از آب دربیاید. وقتی سود به ۲۵٪ یا ۵۰٪ برسد ربات خودش نصف حجم را می‌بندد تا سودی از دست نرود.
                </Text>
              </View>
              <Switch
                value={settings.trailing.enabled}
                onValueChange={(v) => void persist({ ...settings, trailing: { ...settings.trailing, enabled: v } })}
                trackColor={{ true: colors.dark.green + '88', false: colors.dark.card }}
                thumbColor={settings.trailing.enabled ? colors.dark.green : colors.dark.textMuted}
                style={{ transform: [{ scale: 0.7 }] }}
              />
            </View>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchRowTitle}>مدیریت سرمایه با هوش مصنوعی</Text>
                <Text style={styles.switchRowHint}>
                  بعد از ضررهای پیاپی حجم پله‌ای کم می‌شود و بعد از سود برمی‌گردد؛ با پر شدن سقف ضرر روزانه، پوزیشن جدید باز نمی‌شود.
                </Text>
              </View>
              <Switch
                value={settings.aiCapital.enabled}
                onValueChange={(v) => void persist({ ...settings, aiCapital: { ...settings.aiCapital, enabled: v } })}
                trackColor={{ true: colors.dark.green + '88', false: colors.dark.card }}
                thumbColor={settings.aiCapital.enabled ? colors.dark.green : colors.dark.textMuted}
                style={{ transform: [{ scale: 0.7 }] }}
              />
            </View>
            {settings.aiCapital.enabled && (
              <View style={styles.settingCellInline}>
                <Text style={styles.settingLabel}>سقف ضرر روزانه (٪ سرمایه معاملاتی)</Text>
                <TextInput
                  style={styles.settingInputInline}
                  value={String(settings.aiCapital.dailyLossLimitPercent)}
                  onChangeText={(t) =>
                    setSettings((s) => ({
                      ...s,
                      aiCapital: { ...s.aiCapital, dailyLossLimitPercent: Math.max(0.5, Math.min(50, parseFloat(t.replace(/[^\d.]/g, '') || '3') || 3)) },
                    }))
                  }
                  onEndEditing={() => void persist(settings)}
                  keyboardType="decimal-pad"
                />
              </View>
            )}
          </View>

          {/* v1.5.5 — سوییچ «اعلام تلگرام ۲۴/۷ (سرور)» حذف شد (بازخورد کاربر:
              روشن‌کردنش چرخه محلی را قطع می‌کرد و هیچ داده‌ای نه در برنامه و نه
              در تلگرام نمی‌آمد). ربات روی خود گوشی اجرا می‌شود؛ اعلام‌های
              تلگرام باز/بسته شدن از خود برنامه ارسال می‌شوند و ربات سیگنال
              سرور ۲۴/۷ (نهنگ/اندیکاتور) مستقل از این مورد کار می‌کند. */}

          {/* v1.5.0 — PnL card (capturable as image) — v1.5.2: دقیقاً مثل
              خروجی فیوچرز بایننس (دلاری + درصد بر اساس سرمایه اولیه) +
              لوگوی برنامه در بک‌گراند عکس */}
          {hasAnyPosition && (
            <View style={styles.sourceBox}>
              <View style={styles.sourceHead}>
                <TrendingUp size={13} color={(demoStats.realized + demoStats.open + realStats.realized + realStats.open) >= 0 ? colors.dark.green : colors.dark.red} />
                <Text style={styles.sourceTitle}>PnL ربات (USDT) — مثل فیوچرز بایننس</Text>
              </View>
              <View ref={pnlCardRef} collapsable={false} style={styles.pnlShareCard}>
                {/* v1.5.3 — لوگوی مشکی‌پس‌زمینه (بدون قاب) — دیده‌شدنی در عکس خروجی */}
                <Image source={APP_LOGO} style={styles.pnlLogoBg} resizeMode="contain" />
                <Text style={styles.pnlShareTitle}>🤖 بک‌تست — PNL (USDT)</Text>
                {/* انتخاب بازه (همان چیپ‌های قبلی) */}
                <View style={styles.pnlPeriodRow}>
                  {AUTO_PNL_PERIODS.map((p) => (
                    <Pressable
                      key={p}
                      style={[styles.pnlPeriodChip, pnlPeriod === p && styles.pnlPeriodChipActive]}
                      onPress={() => {
                        // v1.5.7 — R2: «تایم‌فریم PnL را عوض می‌کنم ولی تاریخچه
                        // در اون بازه نشون داده نمی‌شه» — بازه‌ی تاریخچه هم
                        // همان لحظه با بازه‌ی PnL هم‌گام می‌شود + صفحه اول.
                        setPnlPeriod(p);
                        setHistPeriod(p);
                        setHistPage(1);
                        setRealHistPage(1);
                      }}
                    >
                      <Text style={[styles.pnlPeriodText, pnlPeriod === p && styles.pnlPeriodTextActive]}>
                        {AUTO_PNL_PERIOD_LABEL[p]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {settings.mode === 'demo' ? (
                  <View style={styles.pnlModeBlock}>
                    <Text style={styles.pnlModeLabel}>دمو</Text>
                    {/* ردیف‌های بایننس‌مانند: سود/زیان دلاری + درصد ROI بر سرمایه اولیه */}
                    <PnlRow label="PNL بسته‌شده" value={demoStats.realized} pct={roiOf(demoStats.realized)} />
                    <PnlRow label="PNL باز (لحظه‌ای)" value={demoStats.open} pct={roiOf(demoStats.open)} />
                    <PnlRow label="مجموع PNL" value={demoStats.realized + demoStats.open} pct={roiOf(demoStats.realized + demoStats.open)} bold />
                    {/* v1.5.3 — «سرمایه اولیه هر چی میزنم سود و زیان به اون موجودی اضافه/کم بشه» */}
                    <PnlRow label="موجودی فعلی (سرمایه اولیه + PNL)" value={settings.initialCapitalUsd + demoStats.realized + demoStats.open} pct={roiOf(demoStats.realized + demoStats.open)} bold />
                    {/* v1.5.6 — مارجین درگیر/آزاد (بازیابی از v1.5.4): «حجم مارجین
                        درگیر را هم نشون بده تا بدونم چقد آزاد دارم» */}
                    <PnlRow label="مارجین درگیر (پوزیشن‌های باز)" value={engagedMarginUsd} neutral />
                    <PnlRow
                      label="مارجین آزاد (قابل معامله)"
                      value={Math.max(0, settings.initialCapitalUsd + demoStats.realized - engagedMarginUsd)}
                      neutral
                    />
                    <Text style={styles.pnlMetaText}>
                      {demoStats.trades.toLocaleString('fa-IR')} معامله • نرخ برد{' '}
                      {demoStats.trades > 0
                        ? Math.round((demoStats.wins / demoStats.trades) * 100).toLocaleString('fa-IR')
                        : '۰'}
                      ٪
                    </Text>
                  </View>
                ) : null}
                {settings.mode === 'real' && (
                  <View style={[styles.pnlModeBlock, styles.pnlModeBlockReal]}>
                    <Text style={styles.pnlModeLabel}>واقعی</Text>
                    <PnlRow label="PNL بسته‌شده" value={realStats.realized} pct={roiOf(realStats.realized)} />
                    <PnlRow label="PNL باز (لحظه‌ای)" value={realStats.open} pct={roiOf(realStats.open)} />
                    <PnlRow label="مجموع PNL" value={realStats.realized + realStats.open} pct={roiOf(realStats.realized + realStats.open)} bold />
                    {/* v1.5.3 — موجودی = سرمایه اولیه ± PnL */}
                    <PnlRow label="موجودی فعلی (سرمایه اولیه + PNL)" value={settings.initialCapitalUsd + realStats.realized + realStats.open} pct={roiOf(realStats.realized + realStats.open)} bold />
                    {/* v1.5.6 — مارجین درگیر/آزاد در حالت واقعی (بازیابی از v1.5.4) */}
                    <PnlRow label="مارجین درگیر (پوزیشن‌های باز)" value={engagedMarginUsd} neutral />
                    <PnlRow
                      label="مارجین آزاد (قابل معامله)"
                      value={Math.max(0, settings.initialCapitalUsd + realStats.realized - engagedMarginUsd)}
                      neutral
                    />
                    <Text style={styles.pnlMetaText}>
                      {realStats.trades.toLocaleString('fa-IR')} معامله • نرخ برد{' '}
                      {realStats.trades > 0
                        ? Math.round((realStats.wins / realStats.trades) * 100).toLocaleString('fa-IR')
                        : '۰'}
                      ٪
                    </Text>
                  </View>
                )}
                <Text style={styles.pnlShareFooter}>
                  PampDumpCoins • سرمایه اولیه ${settings.initialCapitalUsd.toLocaleString('en-US')} • {AUTO_PNL_PERIOD_LABEL[pnlPeriod]}
                </Text>
              </View>
              <View style={styles.shareBtnRow}>
                {/* v1.5.1 — اول عکس ساخته و پیش‌نمایش داده می‌شود؛ ذخیره/اشتراک از داخل پیش‌نمایش */}
                <Pressable style={styles.shareBtn} onPress={() => void handleMakePnlImage()} disabled={captureBusy} testID="pnl-make-image">
                  {captureBusy ? <ActivityIndicator size="small" color={colors.dark.background} /> : <Camera size={13} color={colors.dark.background} />}
                  <Text style={styles.shareBtnText}>ساخت عکس PnL (پیش‌نمایش)</Text>
                </Pressable>
              </View>

              {/* ── v1.5.12 — تقویم ۳۰ روزه سود/زیان (جدولی، تفکیک روزانه،
                  با فلش باز/بسته + ساخت عکس برای ذخیره/اشتراک) ── */}
              {hasAnyPosition && (
                <View style={styles.calBox}>
                  <Pressable style={styles.calHead} onPress={() => setCalOpen((v) => !v)} testID="cal-toggle">
                    <CalendarDays size={13} color={colors.dark.accent} />
                    <Text style={styles.calTitle}>
                      تقویم ۳۰ روزه سود/زیان — {settings.mode === 'demo' ? 'دمو' : 'واقعی'}
                    </Text>
                    <View style={styles.calHeadSpace} />
                    {calOpen ? (
                      <ChevronUp size={14} color={colors.dark.textMuted} />
                    ) : (
                      <ChevronDown size={14} color={colors.dark.textMuted} />
                    )}
                  </Pressable>
                  {calOpen && (
                    <View>
                      <View ref={calCardRef} collapsable={false} style={styles.calCard}>
                        <Text style={styles.calCardTitle}>
                          🤖 بک‌تست — تقویم ۳۰ روزه ({settings.mode === 'demo' ? 'دمو' : 'واقعی'})
                        </Text>
                        <View style={[styles.calGridRow, styles.calGridHead]}>
                          <Text style={[styles.calCell, styles.calCellDate, styles.calCellHead]}>تاریخ</Text>
                          <Text style={[styles.calCell, styles.calCellHead]}>معاملات</Text>
                          <Text style={[styles.calCell, styles.calCellHead]}>سود</Text>
                          <Text style={[styles.calCell, styles.calCellHead]}>ضرر</Text>
                          <Text style={[styles.calCell, styles.calCellHead]}>خالص</Text>
                        </View>
                        {calendarRows.map((r) => (
                          <View key={r.key} style={styles.calGridRow}>
                            <Text style={[styles.calCell, styles.calCellDate]}>{r.label}</Text>
                            <Text style={styles.calCell}>{r.trades.toLocaleString('fa-IR')}</Text>
                            <Text style={[styles.calCell, { color: r.profit > 0 ? colors.dark.green : colors.dark.textMuted }]}>
                              +${r.profit.toFixed(2)}
                            </Text>
                            <Text style={[styles.calCell, { color: r.loss < 0 ? colors.dark.red : colors.dark.textMuted }]}>
                              −${Math.abs(r.loss).toFixed(2)}
                            </Text>
                            <Text style={[styles.calCell, styles.calCellNet, { color: r.net >= 0 ? colors.dark.green : colors.dark.red }]}>
                              {r.net >= 0 ? '+' : '−'}${Math.abs(r.net).toFixed(2)}
                            </Text>
                          </View>
                        ))}
                        {calendarRows.length === 0 && (
                          <Text style={styles.calEmpty}>در ۳۰ روز اخیر معامله‌ی بسته‌شده‌ای نیست.</Text>
                        )}
                        {calendarRows.length > 0 && (
                          <View style={[styles.calGridRow, styles.calGridTotal]}>
                            <Text style={[styles.calCell, styles.calCellDate, styles.calCellTotalLabel]}>مجموع ۳۰ روز</Text>
                            <Text style={[styles.calCell, styles.calCellTotalLabel]}>{calTotals.trades.toLocaleString('fa-IR')}</Text>
                            <Text style={[styles.calCell, { color: calTotals.profit > 0 ? colors.dark.green : colors.dark.textMuted }]}>
                              +${calTotals.profit.toFixed(2)}
                            </Text>
                            <Text style={[styles.calCell, { color: calTotals.loss < 0 ? colors.dark.red : colors.dark.textMuted }]}>
                              −${Math.abs(calTotals.loss).toFixed(2)}
                            </Text>
                            <Text style={[styles.calCell, styles.calCellNet, { color: calTotals.net >= 0 ? colors.dark.green : colors.dark.red }]}>
                              {calTotals.net >= 0 ? '+' : '−'}${Math.abs(calTotals.net).toFixed(2)}
                            </Text>
                          </View>
                        )}
                        <Text style={styles.calFooter}>PampDumpCoins • سود/زیان روزانه‌ی معاملات بسته‌شده در ۳۰ روز اخیر</Text>
                      </View>
                      <Pressable style={styles.shareBtn} onPress={() => void handleMakeCalImage()} disabled={captureBusy} testID="cal-make-image">
                        {captureBusy ? (
                          <ActivityIndicator size="small" color={colors.dark.background} />
                        ) : (
                          <Camera size={13} color={colors.dark.background} />
                        )}
                        <Text style={styles.shareBtnText}>ساخت عکس تقویم (پیش‌نمایش)</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              )}
              {/* v1.5.1 — پیش‌نمایش عکس PnL: بعد از دیدن عکس، ذخیره یا اشتراک را انتخاب کنید */}
              <Modal visible={!!previewUri} transparent animationType="fade">
                <Pressable style={styles.previewOverlay} onPress={() => setPreviewUri(null)}>
                  <View style={styles.previewCard} onStartShouldSetResponder={() => true}>
                    <View style={styles.previewHead}>
                      <Text style={styles.previewTitle}>{previewKind === 'cal' ? 'پیش‌نمایش عکس تقویم' : 'پیش‌نمایش عکس PnL'}</Text>
                      <Pressable hitSlop={8} onPress={() => setPreviewUri(null)}>
                        <X size={18} color={colors.dark.textMuted} />
                      </Pressable>
                    </View>
                    {previewUri && (
                      <Image
                        source={{ uri: previewUri }}
                        style={styles.previewImage}
                        resizeMode="contain"
                      />
                    )}
                    <Text style={styles.previewHint}>
                      اول عکس را ببینید؛ بعد ذخیره در گالری یا اشتراک‌گذاری را انتخاب کنید.
                    </Text>
                    <View style={styles.previewBtnRow}>
                      <Pressable style={[styles.shareBtn, styles.saveBtn]} onPress={() => void handleSavePreview()} disabled={captureBusy} testID="pnl-preview-save">
                        {captureBusy ? <ActivityIndicator size="small" color={colors.dark.background} /> : <Save size={13} color={colors.dark.background} />}
                        <Text style={styles.shareBtnText}>ذخیره در گالری</Text>
                      </Pressable>
                      <Pressable style={styles.shareBtn} onPress={() => void handleSharePreview()} disabled={captureBusy} testID="pnl-preview-share">
                        <Share2 size={13} color={colors.dark.background} />
                        <Text style={styles.shareBtnText}>اشتراک‌گذاری</Text>
                      </Pressable>
                    </View>
                  </View>
                </Pressable>
              </Modal>
            </View>
          )}

          {/* v1.5.2 — مودال ویرایش دستی TP/SL یک پوزیشن باز (دمو یا واقعی) */}
          <Modal visible={!!editTpsl} transparent animationType="fade">
            <Pressable style={styles.previewOverlay} onPress={() => setEditTpsl(null)}>
              <View style={styles.tpslModal} onStartShouldSetResponder={() => true}>
                <View style={styles.previewHead}>
                  <Text style={styles.previewTitle}>
                    ویرایش TP/SL — {editTpsl?.symbol} ({editTpsl?.side === 'long' ? 'لانگ' : 'شورت'})
                  </Text>
                  <Pressable hitSlop={8} onPress={() => setEditTpsl(null)}>
                    <X size={18} color={colors.dark.textMuted} />
                  </Pressable>
                </View>
                {editTpsl && (
                  <>
                    <Text style={styles.tpslHint}>
                      قیمت فعلی: {editTpsl.lastPrice.toFixed(4)} • ورود از مودال: {editTpsl.stopPrice.toFixed(4)} / {editTpsl.takePrice.toFixed(4)}
                      {'\n'}
                      {editTpsl.kind === 'real'
                        ? 'در حالت واقعی، استاپ و تیک‌پرافیت روی خود صرافی بایننس جایگزین می‌شوند.'
                        : 'در حالت دمو، مقادیر همین پوزیشن شبیه‌سازی‌شده عوض می‌شوند.'}
                    </Text>
                    <Text style={styles.tpslLabel}>قیمت استاپ‌لاس (SL)</Text>
                    <TextInput
                      style={styles.tpslInput}
                      value={editStopText}
                      onChangeText={setEditStopText}
                      keyboardType="decimal-pad"
                      testID="tpsl-stop-input"
                    />
                    <Text style={styles.tpslLabel}>قیمت تیک‌پرافیت (TP)</Text>
                    <TextInput
                      style={styles.tpslInput}
                      value={editTakeText}
                      onChangeText={setEditTakeText}
                      keyboardType="decimal-pad"
                      testID="tpsl-take-input"
                    />
                    <Pressable style={styles.tpslSaveBtn} onPress={() => void applyEditTpsl()} disabled={tpslBusy} testID="tpsl-apply">
                      {tpslBusy ? (
                        <ActivityIndicator size="small" color={colors.dark.background} />
                      ) : (
                        <Save size={14} color={colors.dark.background} />
                      )}
                      {/* v1.5.3 — «بنویس ذخیره که کاربر بدونه» + دکمه تمام‌عرض (قبلاً خیلی باریک بود) */}
                      <Text style={styles.tpslSaveBtnText}>ذخیره</Text>
                    </Pressable>
                  </>
                )}
              </View>
            </Pressable>
          </Modal>

          {/* v1.5.4 — مودال «بستن بخشی از معامله» (دکمه ✂): درصد دلخواه + تایید */}
          <Modal visible={!!partialTarget} transparent animationType="fade">
            <Pressable style={styles.previewOverlay} onPress={() => setPartialTarget(null)}>
              <View style={styles.tpslModal} onStartShouldSetResponder={() => true}>
                <View style={styles.previewHead}>
                  <Text style={styles.previewTitle}>
                    بستن بخشی از معامله — {partialTarget?.symbol} ({partialTarget?.side === 'long' ? 'لانگ' : 'شورت'})
                  </Text>
                  <Pressable hitSlop={8} onPress={() => setPartialTarget(null)}>
                    <X size={18} color={colors.dark.textMuted} />
                  </Pressable>
                </View>
                {partialTarget && (
                  <>
                    {(() => {
                      const margin = partialTarget.leverage > 0 ? (partialTarget.qty * partialTarget.entryPrice) / partialTarget.leverage : 0;
                      const pct = parseFaPercent(partialPctText);
                      const closeUsd = Number.isFinite(pct) ? (margin * pct) / 100 : 0;
                      return (
                        <Text style={styles.tpslHint}>
                          حجم فعلی: {partialTarget.qty.toPrecision(6)} • مارجین: ${margin.toFixed(2)}
                          {'\n'}
                          {Number.isFinite(pct) && pct >= 10 && pct < 95
                            ? `با ${partialPctText}٪ ≈ $${closeUsd.toFixed(2)} از مارجین این معامله بسته می‌شود`
                            : Number.isFinite(pct) && pct >= 95
                              ? 'بستن ۱۰۰٪ — کل معامله بسته می‌شود'
                              : 'درصد بستن را انتخاب یا وارد کنید (۱۰ تا ۱۰۰)'}
                        </Text>
                      );
                    })()}
                    <View style={styles.partialChipRow}>
                      {['25', '50', '75'].map((v) => (
                        <Pressable
                          key={v}
                          style={[styles.partialChip, partialPctText === v && styles.partialChipActive]}
                          onPress={() => {
                            setPartialPctText(v);
                            setPartialHint('');
                          }}
                          testID={`partial-chip-${v}`}
                        >
                          <Text style={[styles.partialChipText, partialPctText === v && styles.partialChipTextActive]}>{v}٪</Text>
                        </Pressable>
                      ))}
                    </View>
                    <Text style={styles.tpslLabel}>درصد حجم برای بستن (۱۰ تا ۱۰۰)</Text>
                    <TextInput
                      style={styles.tpslInput}
                      value={partialPctText}
                      onChangeText={(t) => {
                        setPartialPctText(t);
                        setPartialHint('');
                      }}
                      keyboardType="decimal-pad"
                      testID="partial-pct-input"
                    />
                    {partialHint ? <Text style={styles.partialHintText}>{partialHint}</Text> : null}
                    <Pressable style={styles.partialCloseBtn} onPress={() => void applyPartialClose()} disabled={partialBusy} testID="partial-apply">
                      {partialBusy ? (
                        <ActivityIndicator size="small" color={colors.dark.background} />
                      ) : (
                        <Scissors size={14} color={colors.dark.background} />
                      )}
                      <Text style={styles.tpslSaveBtnText}>ببند ({partialPctText || '—'}٪)</Text>
                    </Pressable>
                    <Text style={styles.partialNoteText}>
                      {partialTarget.kind === 'real'
                        ? 'در حالت واقعی سفارش reduceOnly فرستاده می‌شود — استاپ و تیک‌پرافیت صرافی روی حجم باقی‌مانده فعال می‌ماند.'
                        : 'در حالت دمو، بخش بسته‌شده با دلیل «بستن دستی بخشی از حجم» در تاریخچه و PnL ثبت می‌شود.'}
                    </Text>
                  </>
                )}
              </View>
            </Pressable>
          </Modal>

          {/* demo positions — فقط حالت دمو (در واقعی، ریز معاملات دمو نمایش داده نمی‌شود) */}
          {settings.mode === 'demo' && (
            <View style={styles.sourceBox}>
              <View style={styles.sourceHead}>
                <TrendingUp size={13} color={totalPnl >= 0 ? colors.dark.green : colors.dark.red} />
                <Text style={styles.sourceTitle}>پوزیشن‌های ربات (دمو)</Text>
                {/* v1.5.9 — بستن همه پوزیشن‌های باز با تایید */}
                {openPositions.length > 0 && (
                  <Pressable style={styles.closeAllBtn} onPress={handleCloseAllPositions} disabled={closeAllBusy} hitSlop={4} testID="close-all-btn">
                    {closeAllBusy ? (
                      <ActivityIndicator size="small" color={colors.dark.red} />
                    ) : (
                      <Text style={styles.closeAllBtnText}>بستن همه</Text>
                    )}
                  </Pressable>
                )}
                <Pressable onPress={() => void runCycleAndRefresh()} hitSlop={8}>
                  {cycleBusy ? (
                    <ActivityIndicator size="small" color={colors.dark.accent} />
                  ) : (
                    <RefreshCw size={12} color={colors.dark.accent} />
                  )}
                </Pressable>
              </View>
              {openPositions.length === 0 && (
                <Text style={styles.sourceHint}>پوزیشن بازی نیست — با اولین سیگنال/حرکت نهنگ باز می‌شود.</Text>
              )}
              {openPositions.map((p) => {
                const dir = p.side === 'long' ? 1 : -1;
                const pnl = (p.lastPrice - p.entryPrice) * dir * p.qty;
                // v1.5.2 — درصد سود/زیان هر معامله باز (نسبت به مارجین)
                const pnlPct = positionPnlPercent(p);
                // v1.5.4 — «حجم مارجین ورودی تو پوزیشنا باز هم نشون بده»
                const posMarginUsd = p.leverage > 0 ? (p.qty * p.entryPrice) / p.leverage : 0;
                const posNotionalUsd = p.qty * p.entryPrice;
                return (
                  <View key={p.id} style={styles.posRow}>
                    <View style={styles.posMain}>
                      <Text style={styles.posSymbol}>
                        {p.side === 'long' ? '🟢' : '🔴'} {p.symbol} ×{p.leverage}
                        {p.trailArmed ? ' 🛡' : ''}
                        {/* v1.5.3 — نام استراتژی کنار ارز */}
                        {p.strategyName ? <Text style={styles.posStrategy}> • {p.strategyName}</Text> : null}
                      </Text>
                      <Text style={styles.posSource} numberOfLines={1}>
                        {p.source === 'whale' ? '🐋 ' : '📈 '}{p.sourceLabel}
                      </Text>
                      {/* v1.5.3 — قیمت ورود دقیق در خط جدا + قیمت فعلی/SL/TP در خط بعد */}
                      {/* v1.5.6 — قیمت با دقت بایننس (BTC دو رقم — نه ۵–۸ رقم) */}
                      <Text style={styles.posPrices}>
                        ورود: {fmtPrice(p.symbol, p.entryPrice)} → فعلی: {fmtPrice(p.symbol, p.lastPrice)}
                      </Text>
                      <Text style={styles.posPrices}>
                        SL {fmtPrice(p.symbol, p.stopPrice)} / TP {fmtPrice(p.symbol, p.takePrice)}
                      </Text>
                      {/* v1.5.4 — مارجین ورودی + ارزش فعلی پوزیشن */}
                      <Text style={styles.posMargin}>
                        مارجین ورودی: ${posMarginUsd.toFixed(2)} • ارزش پوزیشن: ${posNotionalUsd.toFixed(2)}
                      </Text>
                      {/* v1.5.3 — ساعت و تاریخ باز شدن معامله */}
                      <Text style={styles.posTime}>باز شد: {fmtOpenTime(p.openedAt)}</Text>
                      {/* v1.5.12 — سود بخش‌های بسته‌شده روی همان پوزیشن باز */}
                      {p.partialRealizedPnl != null && p.partialRealizedPnl !== 0 ? (
                        <Text style={[styles.posPartial, { color: p.partialRealizedPnl >= 0 ? colors.dark.green : colors.dark.red }]}>
                          سود بخش بسته‌شده: {p.partialRealizedPnl >= 0 ? '+' : '−'}${Math.abs(p.partialRealizedPnl).toFixed(2)} ({(p.partialsDone ?? 0).toLocaleString('fa-IR')} برداشت)
                        </Text>
                      ) : null}
                    </View>
                    <View style={styles.posSide}>
                      <Text style={[styles.posPnl, { color: pnl >= 0 ? colors.dark.green : colors.dark.red }]}>
                        {pnl >= 0 ? '+' : '−'}${Math.abs(pnl).toFixed(2)}
                      </Text>
                      <Text style={[styles.posPnlPct, { color: pnlPct >= 0 ? colors.dark.green : colors.dark.red }]}>
                        {pnlPct >= 0 ? '+' : '−'}{Math.abs(pnlPct).toFixed(2)}٪
                      </Text>
                      {/* v1.5.3 — ویرایش دستی TP/SL این معامله */}
                      <Pressable
                        style={styles.posEditBtn}
                        hitSlop={6}
                        onPress={() =>
                          openEditTpsl({
                            kind: 'demo',
                            id: p.id,
                            symbol: p.symbol,
                            side: p.side,
                            qty: p.qty,
                            stopPrice: p.stopPrice,
                            takePrice: p.takePrice,
                            lastPrice: p.lastPrice,
                          })
                        }
                        testID={`pos-edit-tpsl-${p.id}`}
                      >
                        <Edit3 size={11} color={colors.dark.accent} />
                      </Pressable>
                      {/* v1.5.4 — ✂ بستن درصد دلخواه (اول درصد پرسیده می‌شود) */}
                      <Pressable
                        style={styles.posHalfBtn}
                        hitSlop={6}
                        onPress={() =>
                          openPartialClose({
                            kind: 'demo',
                            id: p.id,
                            symbol: p.symbol,
                            side: p.side,
                            qty: p.qty,
                            entryPrice: p.entryPrice,
                            leverage: p.leverage,
                            lastPrice: p.lastPrice,
                          })
                        }
                        testID={`pos-half-${p.id}`}
                      >
                        <Scissors size={11} color={colors.dark.blue} />
                      </Pressable>
                      {/* v1.5.6 — بستن کامل فقط با پیغام تایید (بازیابی از v1.5.4) */}
                      <Pressable
                        style={styles.posCloseBtn}
                        onPress={() =>
                          confirmClosePosition({ id: p.id, symbol: p.symbol, side: p.side, lastPrice: p.lastPrice })
                        }
                        testID={`pos-close-${p.id}`}
                      >
                        <X size={11} color={colors.dark.red} />
                      </Pressable>
                    </View>
                  </View>
                );
              })}
              {closedFiltered.length > 0 || histTypeFilter !== 'all' ? (
                <View style={styles.closedBox}>
                  {/* v1.5.6 — سرتیتر + دکمه PDF کل تاریخچه‌ی فیلتر فعلی (بازیابی از v1.5.4) */}
                  <View style={styles.closedTitleRow}>
                    <Text style={styles.closedTitle}>تاریخچه معاملات:</Text>
                    <Pressable
                      style={styles.histPdfBtn}
                      onPress={() => void handleExportHistoryPdf()}
                      disabled={pdfBusy}
                      testID="hist-pdf-btn"
                    >
                      {pdfBusy ? (
                        <ActivityIndicator size="small" color={colors.dark.background} />
                      ) : (
                        <FileText size={11} color={colors.dark.background} />
                      )}
                      <Text style={styles.histPdfBtnText}>{pdfBusy ? 'در حال ساخت…' : 'PDF'}</Text>
                    </Pressable>
                  </View>
                  {pdfBusy && pdfStatus ? (
                    <Text style={{ color: colors.dark.textSecondary, fontSize: 10, marginBottom: 4 }}>{pdfStatus}</Text>
                  ) : null}
                  <View style={styles.histPeriodRow}>
                    {AUTO_PNL_PERIODS.map((p) => (
                      <Pressable
                        key={p}
                        style={[styles.histPeriodChip, histPeriod === p && styles.histPeriodChipActive]}
                        onPress={() => { setHistPeriod(p); setHistPage(1); }}
                        testID={`auto-hist-${p}`}
                      >
                        <Text style={[styles.histPeriodText, histPeriod === p && styles.histPeriodTextActive]}>
                          {AUTO_PNL_PERIOD_LABEL[p]}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {/* v1.5.6 — فیلتر جداگانه سودها/ضررها + نوع بستن (بازیابی از v1.5.4) */}
                  <View style={styles.histTypeRow}>
                    {HIST_TYPE_FILTERS.map((f) => (
                      <Pressable
                        key={f.key}
                        style={[styles.histTypeChip, histTypeFilter === f.key && styles.histTypeChipActive]}
                        onPress={() => { setHistTypeFilter(f.key); setHistPage(1); }}
                        testID={`auto-hist-type-${f.key}`}
                      >
                        <Text style={[styles.histPeriodText, histTypeFilter === f.key && styles.histPeriodTextActive]}>
                          {f.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {(() => {
                    const sum = closedFiltered.reduce((s, p) => s + (p.realizedPnl ?? 0), 0);
                    return (
                      <View style={styles.histSummary}>
                        <Text style={styles.histSummaryText}>
                          {closedFiltered.length.toLocaleString('fa-IR')} معامله در این بازه
                        </Text>
                        <Text style={[styles.histSummaryPnl, { color: sum >= 0 ? colors.dark.green : colors.dark.red }]}>
                          {sum >= 0 ? '+' : '−'}${Math.abs(sum).toFixed(2)}
                        </Text>
                      </View>
                    );
                  })()}
                  {closedPositions.length === 0 && (
                    <Text style={styles.sourceHint}>در این فیلتر معامله‌ای نیست — فیلتر دیگری را انتخاب کنید.</Text>
                  )}
                  {closedPositions.map((p) => (
                    <View key={p.id} style={styles.closedRow}>
                      <Text style={styles.closedText} numberOfLines={2}>
                        {/* v1.5.3 — نام استراتژی + نوع اندیکاتور کنار نام ارز */}
                        {/* v1.5.6 — جدیدترین بسته‌شده اول + زمان بسته شدن (بازیابی از v1.5.4) */}
                        {p.symbol}
                        {p.strategyName ? ` • ${p.strategyName}` : ''}
                        {p.sourceLabel ? ` • ${p.sourceLabel}` : ''}
                        {' '}({p.closeReason === 'stop' ? 'استاپ' : p.closeReason === 'take' ? 'تیک‌پرافیت' : p.closeReason === 'whale-close' ? 'نهنگ بست' : p.closeReason === 'signal' ? 'سیگنال' : p.closeReason === 'partial' ? 'برداشت سود (نصف حجم)' : p.closeReason === 'partial-manual' ? 'بستن حجمی' : 'دستی'})
                        {p.closedAt ? ` • ${fmtOpenTime(p.closedAt)}` : ''}
                      </Text>
                      <Text style={[styles.posPnl, { color: (p.realizedPnl ?? 0) >= 0 ? colors.dark.green : colors.dark.red }]}>
                        {(p.realizedPnl ?? 0) >= 0 ? '+' : '−'}${Math.abs(p.realizedPnl ?? 0).toFixed(2)}
                      </Text>
                    </View>
                  ))}
                  {/* v1.5.6 — صفحه‌بندی ۱۰۰تایی: معاملات بالای ۱۰۰ → صفحه بعد (بازیابی از v1.5.4) */}
                  {closedTotalPages > 1 && (
                    <View style={styles.histPagerRow}>
                      <Pressable
                        style={[styles.histPagerBtn, histPage <= 1 && styles.histPagerBtnDisabled]}
                        disabled={histPage <= 1}
                        onPress={() => setHistPage((v) => Math.max(1, v - 1))}
                      >
                        <ChevronRight size={13} color={colors.dark.accent} />
                        <Text style={styles.histPagerBtnText}>قبلی</Text>
                      </Pressable>
                      <Text style={styles.histPagerText}>
                        صفحه {histPage.toLocaleString('fa-IR')} از {closedTotalPages.toLocaleString('fa-IR')}
                      </Text>
                      <Pressable
                        style={[styles.histPagerBtn, histPage >= closedTotalPages && styles.histPagerBtnDisabled]}
                        disabled={histPage >= closedTotalPages}
                        onPress={() => setHistPage((v) => Math.min(closedTotalPages, v + 1))}
                      >
                        <Text style={styles.histPagerBtnText}>بعدی</Text>
                        <ChevronLeft size={13} color={colors.dark.accent} />
                      </Pressable>
                    </View>
                  )}
                </View>
              ) : null}
            </View>
          )}

          {/* real positions (tracked by the engine) — فقط حالت واقعی */}
          {settings.mode === 'real' && realKeys && (
            <View style={styles.sourceBox}>
              <View style={styles.sourceHead}>
                <TrendingUp size={13} color={realTotalPnl >= 0 ? colors.dark.green : colors.dark.red} />
                <Text style={styles.sourceTitle}>پوزیشن‌های ربات (واقعی)</Text>
                {/* v1.5.9 — بستن همه پوزیشن‌های باز با تایید */}
                {realOpen.length > 0 && (
                  <Pressable style={styles.closeAllBtn} onPress={handleCloseAllPositions} disabled={closeAllBusy} hitSlop={4}>
                    {closeAllBusy ? (
                      <ActivityIndicator size="small" color={colors.dark.red} />
                    ) : (
                      <Text style={styles.closeAllBtnText}>بستن همه</Text>
                    )}
                  </Pressable>
                )}
                <Pressable onPress={() => void runCycleAndRefresh()} hitSlop={8}>
                  {cycleBusy ? (
                    <ActivityIndicator size="small" color={colors.dark.accent} />
                  ) : (
                    <RefreshCw size={12} color={colors.dark.accent} />
                  )}
                </Pressable>
              </View>
              {realOpen.length === 0 && (
                <Text style={styles.sourceHint}>پوزیشن واقعی بازی نیست — با اولین سیگنال باز می‌شود.</Text>
              )}
              {realOpen.map((p) => {
                const dir = p.side === 'long' ? 1 : -1;
                const pnl = (p.lastPrice - p.entryPrice) * dir * p.qty;
                // v1.5.2 — درصد سود/زیان هر معامله باز (نسبت به مارجین)
                const marginUsd = p.leverage > 0 ? (p.qty * p.entryPrice) / p.leverage : 0;
                const pnlPct = positionPnlPercent(p, marginUsd);
                // v1.5.4 — «حجم مارجین ورودی تو پوزیشنا باز هم نشون بده»
                const posNotionalUsd = p.qty * p.entryPrice;
                return (
                  <View key={p.id} style={styles.posRow}>
                    <View style={styles.posMain}>
                      <Text style={styles.posSymbol}>
                        {p.side === 'long' ? '🟢' : '🔴'} {p.symbol} ×{p.leverage}
                        {p.trailArmed ? ' 🛡' : ''}
                        {/* v1.5.3 — نام استراتژی کنار ارز */}
                        {p.strategyName ? <Text style={styles.posStrategy}> • {p.strategyName}</Text> : null}
                      </Text>
                      <Text style={styles.posSource} numberOfLines={1}>
                        {p.source === 'whale' ? '🐋 ' : '📈 '}{p.sourceLabel}
                      </Text>
                      {/* v1.5.3 — قیمت ورود دقیق در خط جدا + قیمت فعلی/SL/TP */}
                      {/* v1.5.6 — قیمت با دقت بایننس (BTC دو رقم — نه ۵–۸ رقم) */}
                      <Text style={styles.posPrices}>
                        ورود: {fmtPrice(p.symbol, p.entryPrice)} → فعلی: {fmtPrice(p.symbol, p.lastPrice)}
                      </Text>
                      <Text style={styles.posPrices}>
                        SL {fmtPrice(p.symbol, p.stopPrice)} / TP {fmtPrice(p.symbol, p.takePrice)}
                      </Text>
                      {/* v1.5.4 — مارجین ورودی + ارزش فعلی پوزیشن */}
                      <Text style={styles.posMargin}>
                        مارجین ورودی: ${marginUsd.toFixed(2)} • ارزش پوزیشن: ${posNotionalUsd.toFixed(2)}
                      </Text>
                      {/* v1.5.3 — ساعت و تاریخ باز شدن معامله */}
                      <Text style={styles.posTime}>باز شد: {fmtOpenTime(p.openedAt)}</Text>
                      {/* v1.5.12 — سود بخش‌های بسته‌شده روی همان پوزیشن باز */}
                      {p.partialRealizedPnl != null && p.partialRealizedPnl !== 0 ? (
                        <Text style={[styles.posPartial, { color: p.partialRealizedPnl >= 0 ? colors.dark.green : colors.dark.red }]}>
                          سود بخش بسته‌شده: {p.partialRealizedPnl >= 0 ? '+' : '−'}${Math.abs(p.partialRealizedPnl).toFixed(2)} ({(p.partialsDone ?? 0).toLocaleString('fa-IR')} برداشت)
                        </Text>
                      ) : null}
                      {/* v1.5.12 — فاندینگ + کارمزد کم‌شده از پوزیشن واقعی */}
                      {(() => {
                        const f = realFeesOf(p);
                        return f ? (
                          <Text style={styles.posFees}>
                            فاندینگ {f.funding >= 0 ? '−' : '+'}${Math.abs(f.funding).toFixed(2)} • کارمزد {f.commission >= 0 ? '−' : '+'}${Math.abs(f.commission).toFixed(2)}
                          </Text>
                        ) : null;
                      })()}
                    </View>
                    <View style={styles.posSide}>
                      <Text style={[styles.posPnl, { color: pnl >= 0 ? colors.dark.green : colors.dark.red }]}>
                        {pnl >= 0 ? '+' : '−'}${Math.abs(pnl).toFixed(2)}
                      </Text>
                      <Text style={[styles.posPnlPct, { color: pnlPct >= 0 ? colors.dark.green : colors.dark.red }]}>
                        {pnlPct >= 0 ? '+' : '−'}{Math.abs(pnlPct).toFixed(2)}٪
                      </Text>
                      {/* v1.5.2 — ویرایش دستی TP/SL این معامله واقعی */}
                      <Pressable
                        style={styles.posEditBtn}
                        hitSlop={6}
                        onPress={() =>
                          openEditTpsl({
                            kind: 'real',
                            id: p.id,
                            symbol: p.symbol,
                            side: p.side,
                            qty: p.qty,
                            stopPrice: p.stopPrice,
                            takePrice: p.takePrice,
                            lastPrice: p.lastPrice,
                          })
                        }
                      >
                        <Edit3 size={11} color={colors.dark.accent} />
                      </Pressable>
                      {/* v1.5.4 — ✂ بستن درصد دلخواه (اول درصد پرسیده می‌شود) */}
                      <Pressable
                        style={styles.posHalfBtn}
                        hitSlop={6}
                        onPress={() =>
                          openPartialClose({
                            kind: 'real',
                            id: p.id,
                            symbol: p.symbol,
                            side: p.side,
                            qty: p.qty,
                            entryPrice: p.entryPrice,
                            leverage: p.leverage,
                            lastPrice: p.lastPrice,
                          })
                        }
                        testID={`pos-half-real-${p.id}`}
                      >
                        <Scissors size={11} color={colors.dark.blue} />
                      </Pressable>
                      {/* v1.5.6 — بستن کامل فقط با پیغام تایید (بازیابی از v1.5.4) */}
                      <Pressable
                        style={styles.posCloseBtn}
                        onPress={() =>
                          confirmClosePosition({ id: p.id, symbol: p.symbol, side: p.side, lastPrice: p.lastPrice })
                        }
                        testID={`pos-close-real-${p.id}`}
                      >
                        <X size={11} color={colors.dark.red} />
                      </Pressable>
                    </View>
                  </View>
                );
              })}
              {realClosedFiltered.length > 0 || histTypeFilter !== 'all' ? (
                <View style={styles.closedBox}>
                  {/* v1.5.6 — سرتیتر + دکمه PDF (بازیابی از v1.5.4) */}
                  <View style={styles.closedTitleRow}>
                    <Text style={styles.closedTitle}>تاریخچه معاملات (واقعی):</Text>
                    <Pressable
                      style={styles.histPdfBtn}
                      onPress={() => void handleExportHistoryPdf()}
                      disabled={pdfBusy}
                      testID="hist-pdf-btn-real"
                    >
                      {pdfBusy ? (
                        <ActivityIndicator size="small" color={colors.dark.background} />
                      ) : (
                        <FileText size={11} color={colors.dark.background} />
                      )}
                      <Text style={styles.histPdfBtnText}>{pdfBusy ? 'در حال ساخت…' : 'PDF'}</Text>
                    </Pressable>
                  </View>
                  {pdfBusy && pdfStatus ? (
                    <Text style={{ color: colors.dark.textSecondary, fontSize: 10, marginBottom: 4 }}>{pdfStatus}</Text>
                  ) : null}
                  <View style={styles.histPeriodRow}>
                    {AUTO_PNL_PERIODS.map((p) => (
                      <Pressable
                        key={p}
                        style={[styles.histPeriodChip, histPeriod === p && styles.histPeriodChipActive]}
                        onPress={() => { setHistPeriod(p); setRealHistPage(1); }}
                      >
                        <Text style={[styles.histPeriodText, histPeriod === p && styles.histPeriodTextActive]}>
                          {AUTO_PNL_PERIOD_LABEL[p]}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {/* v1.5.6 — فیلتر جداگانه سودها/ضررها + نوع بستن (بازیابی از v1.5.4) */}
                  <View style={styles.histTypeRow}>
                    {HIST_TYPE_FILTERS.map((f) => (
                      <Pressable
                        key={f.key}
                        style={[styles.histTypeChip, histTypeFilter === f.key && styles.histTypeChipActive]}
                        onPress={() => { setHistTypeFilter(f.key); setRealHistPage(1); }}
                        testID={`auto-hist-type-real-${f.key}`}
                      >
                        <Text style={[styles.histPeriodText, histTypeFilter === f.key && styles.histPeriodTextActive]}>
                          {f.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {(() => {
                    const sum = realClosedFiltered.reduce((s, p) => s + (p.realizedPnl ?? 0), 0);
                    return (
                      <View style={styles.histSummary}>
                        <Text style={styles.histSummaryText}>
                          {realClosedFiltered.length.toLocaleString('fa-IR')} معامله در این بازه
                        </Text>
                        <Text style={[styles.histSummaryPnl, { color: sum >= 0 ? colors.dark.green : colors.dark.red }]}>
                          {sum >= 0 ? '+' : '−'}${Math.abs(sum).toFixed(2)}
                        </Text>
                      </View>
                    );
                  })()}
                  {realClosed.length === 0 && (
                    <Text style={styles.sourceHint}>در این فیلتر معامله‌ای نیست — فیلتر دیگری را انتخاب کنید.</Text>
                  )}
                  {realClosed.map((p) => (
                    <View key={p.id} style={styles.closedRow}>
                      <Text style={styles.closedText} numberOfLines={2}>
                        {/* v1.5.3 — نام استراتژی + نوع اندیکاتور کنار نام ارز */}
                        {/* v1.5.6 — جدیدترین بسته‌شده اول + زمان بسته شدن (بازیابی از v1.5.4) */}
                        {p.symbol}
                        {p.strategyName ? ` • ${p.strategyName}` : ''}
                        {p.sourceLabel ? ` • ${p.sourceLabel}` : ''}
                        {' '}({p.closeReason === 'stop' ? 'استاپ' : p.closeReason === 'take' ? 'روی صرافی' : p.closeReason === 'whale-close' ? 'نهنگ بست' : p.closeReason === 'signal' ? 'سیگنال' : p.closeReason === 'partial' ? 'برداشت سود (نصف حجم)' : p.closeReason === 'partial-manual' ? 'بستن حجمی' : 'دستی'})
                        {p.closedAt ? ` • ${fmtOpenTime(p.closedAt)}` : ''}
                      </Text>
                      <Text style={[styles.posPnl, { color: (p.realizedPnl ?? 0) >= 0 ? colors.dark.green : colors.dark.red }]}>
                        {(p.realizedPnl ?? 0) >= 0 ? '+' : '−'}${Math.abs(p.realizedPnl ?? 0).toFixed(2)}
                      </Text>
                      {(() => {
                        const f = realFeesOf(p);
                        return f ? (
                          <Text style={styles.closedFees}>
                            فاندینگ {f.funding >= 0 ? '−' : '+'}${Math.abs(f.funding).toFixed(2)} • کارمزد {f.commission >= 0 ? '−' : '+'}${Math.abs(f.commission).toFixed(2)}
                          </Text>
                        ) : null;
                      })()}
                    </View>
                  ))}
                  {/* v1.5.6 — صفحه‌بندی ۱۰۰تایی (بازیابی از v1.5.4) */}
                  {realClosedTotalPages > 1 && (
                    <View style={styles.histPagerRow}>
                      <Pressable
                        style={[styles.histPagerBtn, realHistPage <= 1 && styles.histPagerBtnDisabled]}
                        disabled={realHistPage <= 1}
                        onPress={() => setRealHistPage((v) => Math.max(1, v - 1))}
                      >
                        <ChevronRight size={13} color={colors.dark.accent} />
                        <Text style={styles.histPagerBtnText}>قبلی</Text>
                      </Pressable>
                      <Text style={styles.histPagerText}>
                        صفحه {realHistPage.toLocaleString('fa-IR')} از {realClosedTotalPages.toLocaleString('fa-IR')}
                      </Text>
                      <Pressable
                        style={[styles.histPagerBtn, realHistPage >= realClosedTotalPages && styles.histPagerBtnDisabled]}
                        disabled={realHistPage >= realClosedTotalPages}
                        onPress={() => setRealHistPage((v) => Math.min(realClosedTotalPages, v + 1))}
                      >
                        <Text style={styles.histPagerBtnText}>بعدی</Text>
                        <ChevronLeft size={13} color={colors.dark.accent} />
                      </Pressable>
                    </View>
                  )}
                </View>
              ) : null}
            </View>
          )}

          {/* engine log */}
          {logs.length > 0 && (
            <View style={styles.logBox}>
              {logs.slice(0, 8).map((l) => (
                <Text key={l.id} style={styles.logLine} numberOfLines={2}>
                  {l.kind === 'error' ? '✖' : l.kind === 'open' ? '▲' : l.kind === 'close' ? '▼' : '•'} {l.message}
                </Text>
              ))}
              {lastCycleAt && (
                <Text style={styles.logTime}>
                  آخرین چرخه: {Math.max(0, Math.round((Date.now() - lastCycleAt) / 1000))} ثانیه پیش — موتور هر ۶۰ ثانیه (و با باز شدن برنامه) می‌چرخد.
                </Text>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function PnlRow({ label, value, pct, bold, neutral }: { label: string; value: number; pct?: number; bold?: boolean; neutral?: boolean }) {
  // v1.5.6 — neutral (بازیابی از v1.5.4): ردیف‌های مارجین درگیر/آزاد بدون رنگ سود/زیان
  const color = neutral ? colors.dark.text : value >= 0 ? colors.dark.green : colors.dark.red;
  const pctColor = neutral ? colors.dark.textSecondary : pct !== undefined && pct >= 0 ? colors.dark.green : colors.dark.red;
  return (
    <View style={styles.pnlShareRow}>
      <Text style={[styles.pnlShareRowLabel, bold && { fontWeight: '800' }]}>{label}</Text>
      {/* v1.5.2 — سود/زیان هم دلاری هم درصدی (مثل بایننس) */}
      <View style={styles.pnlShareRowRight}>
        <Text style={[styles.pnlShareRowValue, { color }, bold && { fontWeight: '800' }]}>
          {neutral ? '' : value >= 0 ? '+' : '−'} ${Math.abs(value).toFixed(2)}
        </Text>
        {typeof pct === 'number' && (
          <Text style={[styles.pnlShareRowPct, { color: pctColor }, bold && { fontWeight: '800' }]}>
            {pct >= 0 ? '+' : '−'}{Math.abs(pct).toFixed(2)}٪
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.dark.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    padding: 12,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.dark.accent + '22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconActive: {
    backgroundColor: colors.dark.green,
  },
  title: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.dark.text,
  },
  subtitle: {
    fontSize: 9.5,
    color: colors.dark.textSecondary,
    marginTop: 1,
  },
  body: {
    marginTop: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: colors.dark.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    overflow: 'hidden',
  },
  modeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  modeBtnActive: {
    backgroundColor: colors.dark.green,
  },
  modeBtnReal: {
    backgroundColor: colors.dark.red,
  },
  modeBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.dark.textSecondary,
  },
  modeBtnTextActive: {
    color: colors.dark.background,
  },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.dark.green,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  startBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.dark.background,
  },
  stopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.dark.red + '22',
    borderWidth: 1,
    borderColor: colors.dark.red + '55',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  stopBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.dark.red,
  },
  warn: {
    fontSize: 10,
    color: colors.dark.accent,
    marginBottom: 6,
  },
  warnReal: {
    fontSize: 10,
    color: colors.dark.red,
    marginBottom: 6,
  },
  engineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.dark.green + '14',
    borderWidth: 1,
    borderColor: colors.dark.green + '33',
    borderRadius: 8,
    padding: 6,
    marginBottom: 8,
  },
  engineBadgeText: {
    flex: 1,
    fontSize: 9,
    color: colors.dark.green,
    lineHeight: 13,
  },
  /* v1.5.9 — دکمه «بستن همه» پوزیشن‌های باز (کنار عنوان پوزیشن‌ها) */
  closeAllBtn: {
    backgroundColor: colors.dark.red + '18',
    borderWidth: 1,
    borderColor: colors.dark.red + '44',
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  closeAllBtnText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.dark.red,
  },
  sourceBox: {
    backgroundColor: colors.dark.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    padding: 10,
    marginBottom: 8,
  },
  sourceHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  sourceTitle: {
    flex: 1,
    fontSize: 11.5,
    fontWeight: '800',
    color: colors.dark.text,
  },
  sourceHint: {
    fontSize: 9.5,
    color: colors.dark.textSecondary,
    lineHeight: 14,
    marginTop: 2,
  },
  chipsRow: {
    gap: 6,
    paddingVertical: 4,
  },
  chip: {
    backgroundColor: colors.dark.card,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 150,
  },
  chipActive: {
    borderColor: colors.dark.accent,
    backgroundColor: colors.dark.accent + '1C',
  },
  chipText: {
    fontSize: 10,
    color: colors.dark.textSecondary,
  },
  chipTextActive: {
    color: colors.dark.accent,
    fontWeight: '700',
  },
  miniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
    padding: 4,
  },
  miniText: {
    flex: 1,
    fontSize: 9.5,
    color: colors.dark.textSecondary,
  },
  indDropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.dark.card,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  indDropdownText: {
    fontSize: 10,
    color: colors.dark.text,
    fontWeight: '700',
  },
  indDropdownPanel: {
    marginTop: 6,
    backgroundColor: colors.dark.card,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    borderRadius: 8,
    overflow: 'hidden',
  },
  indRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.dark.cardBorder,
    gap: 6,
  },
  indRowActive: {
    backgroundColor: colors.dark.accent + '10',
  },
  indRowTexts: {
    flex: 1,
  },
  indRowLabel: {
    fontSize: 10.5,
    color: colors.dark.text,
    fontWeight: '700',
  },
  indRowHint: {
    fontSize: 9,
    color: colors.dark.textSecondary,
    marginTop: 1,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxTick: {
    color: colors.dark.background,
    fontSize: 12,
    fontWeight: '900',
  },
  selList: {
    gap: 6,
    marginTop: 6,
  },
  selRow: {
    backgroundColor: colors.dark.card,
    borderWidth: 1,
    borderColor: colors.dark.accent + '44',
    borderRadius: 8,
    padding: 8,
  },
  selRowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  selRowName: {
    flex: 1,
    fontSize: 10.5,
    fontWeight: '800',
    color: colors.dark.accent,
  },
  selTfLabel: {
    fontSize: 9,
    color: colors.dark.textSecondary,
    marginTop: 4,
    marginBottom: 4,
  },
  tfChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  tfChip: {
    backgroundColor: colors.dark.background,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tfChipActive: {
    borderColor: colors.dark.accent,
    backgroundColor: colors.dark.accent + '1C',
  },
  tfChipText: {
    fontSize: 9,
    color: colors.dark.textSecondary,
  },
  tfChipTextActive: {
    color: colors.dark.accent,
    fontWeight: '800',
  },
  settingsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  settingCell: {
    flexBasis: '31%',
    flexGrow: 1,
    backgroundColor: colors.dark.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    padding: 6,
  },
  settingLabel: {
    fontSize: 8.5,
    color: colors.dark.textSecondary,
    marginBottom: 3,
  },
  settingInput: {
    fontSize: 12,
    color: colors.dark.text,
    fontWeight: '700',
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  /* v1.5.2 — راهنمای ریز زیر هر سلول تنظیمات */
  settingHint: {
    fontSize: 7.5,
    color: colors.dark.textMuted,
    marginTop: 2,
  },
  settingCellInline: {
    backgroundColor: colors.dark.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    padding: 8,
    marginTop: 6,
  },
  settingInputInline: {
    fontSize: 12,
    color: colors.dark.text,
    fontWeight: '700',
    paddingVertical: 2,
    paddingHorizontal: 4,
    marginTop: 2,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  switchRowTitle: {
    fontSize: 10.5,
    fontWeight: '800',
    color: colors.dark.text,
  },
  switchRowHint: {
    fontSize: 9,
    color: colors.dark.textSecondary,
    lineHeight: 13,
    marginTop: 2,
  },
  posRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    padding: 8,
    marginBottom: 6,
    gap: 6,
  },
  posMain: {
    flex: 1,
  },
  posSymbol: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.dark.text,
  },
  posSource: {
    fontSize: 9,
    color: colors.dark.textSecondary,
    marginTop: 1,
  },
  posPrices: {
    fontSize: 8.5,
    color: colors.dark.textSecondary,
    marginTop: 2,
    direction: 'ltr',
    textAlign: 'left',
  },
  posSide: {
    alignItems: 'flex-end',
    gap: 4,
  },
  posPnl: {
    fontSize: 11,
    fontWeight: '800',
    direction: 'ltr',
  },
  /* v1.5.2 — درصد سود/زیان هر پوزیشن باز */
  posPnlPct: {
    fontSize: 8.5,
    fontWeight: '700',
    direction: 'ltr',
    marginTop: 1,
  },
  /* v1.5.2 — دکمه ویرایش TP/SL روی هر پوزیشن */
  posEditBtn: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: colors.dark.accent + '1C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* v1.5.3 — دکمه «بستن نصف حجم» روی هر پوزیشن */
  posHalfBtn: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: colors.dark.blue + '1C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  posCloseBtn: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: colors.dark.red + '1C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* v1.5.3 — ساعت و تاریخ باز شدن معامله */
  posTime: {
    fontSize: 8.5,
    color: colors.dark.textMuted,
    marginTop: 2,
  },
  /* v1.5.4 — «حجم مارجین ورودی تو پوزیشنا نشون بده» */
  posMargin: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.dark.blue,
    marginTop: 2,
  },
  /* v1.5.4 — مودال بستن درصد دلخواه (✂) */
  partialChipRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 4,
  },
  partialChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: colors.dark.card,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
  },
  partialChipActive: {
    backgroundColor: colors.dark.blue + '26',
    borderColor: colors.dark.blue,
  },
  partialChipText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.dark.textSecondary,
  },
  partialChipTextActive: {
    color: colors.dark.blue,
  },
  partialCloseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'stretch',
    backgroundColor: colors.dark.red,
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 8,
  },
  partialHintText: {
    fontSize: 9,
    color: colors.dark.red,
    marginTop: 4,
  },
  partialNoteText: {
    fontSize: 8.5,
    color: colors.dark.textMuted,
    lineHeight: 13,
    marginTop: 8,
  },
  /* v1.5.3 — برچسب استراتژی کنار نماد ارز */
  posStrategy: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.dark.accent,
  },
  /* v1.5.3 — دکمه ریست کامل دمو */
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.dark.accent + '14',
    borderWidth: 1,
    borderColor: colors.dark.accent + '55',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  resetBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.dark.accent,
  },
  closedBox: {
    marginTop: 4,
    backgroundColor: colors.dark.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    padding: 8,
  },
  /* v1.5.1 — فیلتر روز تاریخچه معاملات ربات */
  histPeriodRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 6,
    marginTop: 2,
  },
  histPeriodChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 5,
    borderRadius: 7,
    backgroundColor: colors.dark.surface,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  histPeriodChipActive: {
    backgroundColor: colors.dark.accent,
    borderColor: colors.dark.accent,
  },
  histPeriodText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.dark.textSecondary,
  },
  histPeriodTextActive: {
    color: colors.dark.background,
    fontWeight: '800',
  },
  histSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.dark.surface,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginBottom: 4,
  },
  histSummaryText: {
    fontSize: 9,
    color: colors.dark.textSecondary,
  },
  histSummaryPnl: {
    fontSize: 10.5,
    fontWeight: '800',
  },
  /* v1.5.1 — پیش‌نمایش عکس PnL */
  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  previewCard: {
    width: '100%',
    backgroundColor: colors.dark.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.dark.border,
    padding: 12,
  },
  /* v1.5.2 — مودال ویرایش دستی TP/SL */
  tpslModal: {
    width: '100%',
    backgroundColor: colors.dark.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.dark.border,
    padding: 14,
  },
  /* v1.5.3 — دکمه ذخیره TP/SL: تمام‌عرض و درشت (قبلاً flex:1 داخل ستون = باریک) */
  tpslSaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'stretch',
    backgroundColor: colors.dark.green,
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 8,
  },
  tpslSaveBtnText: {
    fontSize: 13,
    fontWeight: '900',
    color: colors.dark.background,
  },
  tpslHint: {
    fontSize: 9,
    color: colors.dark.textSecondary,
    lineHeight: 14,
    marginBottom: 8,
  },
  tpslLabel: {
    fontSize: 9.5,
    fontWeight: '700',
    color: colors.dark.text,
    marginTop: 6,
    marginBottom: 3,
  },
  tpslInput: {
    backgroundColor: colors.dark.card,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    borderRadius: 8,
    color: colors.dark.text,
    fontSize: 13,
    fontWeight: '700',
    paddingVertical: 8,
    paddingHorizontal: 10,
    direction: 'ltr',
    textAlign: 'left',
    marginBottom: 6,
  },
  previewHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  previewTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.dark.text,
  },
  previewImage: {
    width: '100%',
    height: 320,
    borderRadius: 10,
    backgroundColor: colors.dark.background,
  },
  previewHint: {
    fontSize: 9.5,
    color: colors.dark.textSecondary,
    textAlign: 'right',
    marginTop: 8,
    marginBottom: 8,
    lineHeight: 15,
  },
  previewBtnRow: {
    flexDirection: 'row',
    gap: 6,
  },
  closedTitle: {
    fontSize: 9.5,
    color: colors.dark.textSecondary,
    marginBottom: 4,
  },
  // ── v1.5.12 — تقویم ۳۰ روزه ──
  calBox: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    backgroundColor: colors.dark.card,
    padding: 8,
  },
  calHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  calTitle: {
    flex: 1,
    fontSize: 11.5,
    fontWeight: '800',
    color: colors.dark.text,
  },
  calHeadSpace: {
    flex: 0,
  },
  calCard: {
    marginTop: 8,
    borderRadius: 10,
    backgroundColor: colors.dark.surface,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    padding: 10,
  },
  calCardTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.dark.text,
    marginBottom: 8,
  },
  calGridRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.dark.border,
  },
  calGridHead: {
    borderBottomWidth: 1,
    borderBottomColor: colors.dark.cardBorder,
  },
  calGridTotal: {
    borderBottomWidth: 0,
    marginTop: 2,
    borderTopWidth: 1,
    borderTopColor: colors.dark.cardBorder,
  },
  calCell: {
    flex: 1,
    fontSize: 10.5,
    fontWeight: '700',
    color: colors.dark.text,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  calCellDate: {
    flex: 1.4,
    textAlign: 'left',
  },
  calCellHead: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.dark.textMuted,
  },
  calCellNet: {
    fontWeight: '800',
  },
  calCellTotalLabel: {
    color: colors.dark.text,
    fontWeight: '800',
  },
  calEmpty: {
    textAlign: 'center',
    color: colors.dark.textMuted,
    fontSize: 10,
    paddingVertical: 10,
  },
  calFooter: {
    marginTop: 8,
    fontSize: 8.5,
    color: colors.dark.textMuted,
    textAlign: 'center',
  },
  // ── v1.5.12 — سود بخش بسته‌شده روی پوزیشن باز + خط کارمزد/فاندینگ ──
  posPartial: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  posFees: {
    fontSize: 9.5,
    color: colors.dark.textSecondary,
    marginTop: 2,
  },
  closedFees: {
    fontSize: 8.5,
    color: colors.dark.textMuted,
    marginTop: 1,
    textAlign: 'left',
  },
  closedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  closedText: {
    flex: 1,
    fontSize: 9.5,
    color: colors.dark.text,
  },
  logBox: {
    backgroundColor: colors.dark.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    padding: 8,
  },
  logLine: {
    fontSize: 8.5,
    color: colors.dark.textSecondary,
    lineHeight: 13,
    marginBottom: 2,
  },
  logTime: {
    fontSize: 8.5,
    color: colors.dark.accent,
    marginTop: 4,
  },
  // ── PnL share card ──
  pnlShareCard: {
    backgroundColor: colors.dark.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.dark.accent + '44',
    padding: 10,
  },
  pnlShareTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: colors.dark.text,
    marginBottom: 6,
    textAlign: 'center',
  },
  pnlPeriodRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
    marginBottom: 8,
  },
  pnlPeriodChip: {
    backgroundColor: colors.dark.background,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pnlPeriodChipActive: {
    borderColor: colors.dark.accent,
    backgroundColor: colors.dark.accent + '1C',
  },
  pnlPeriodText: {
    fontSize: 9,
    color: colors.dark.textSecondary,
  },
  pnlPeriodTextActive: {
    color: colors.dark.accent,
    fontWeight: '800',
  },
  pnlModeBlock: {
    backgroundColor: colors.dark.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.dark.green + '33',
    padding: 8,
    marginBottom: 6,
  },
  pnlModeBlockReal: {
    borderColor: colors.dark.red + '44',
  },
  pnlModeLabel: {
    fontSize: 10,
    fontWeight: '900',
    color: colors.dark.text,
    marginBottom: 4,
  },
  pnlShareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 1.5,
  },
  pnlShareRowLabel: {
    fontSize: 9.5,
    color: colors.dark.textSecondary,
  },
  pnlShareRowValue: {
    fontSize: 10,
    fontWeight: '700',
    direction: 'ltr',
  },
  /* v1.5.2 — دلار + درصد کنار هم در ردیف PnL (مثل بایننس) */
  pnlShareRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pnlShareRowPct: {
    fontSize: 9.5,
    fontWeight: '700',
    direction: 'ltr',
  },
  /* v1.5.2 — لوگوی برنامه در بک‌گراند عکس PnL (v1.5.3: مشکی‌پس‌زمینه + واضح‌تر) */
  pnlLogoBg: {
    position: 'absolute',
    alignSelf: 'center',
    top: 0,
    bottom: 0,
    width: 200,
    height: 200,
    opacity: 0.22,
  },
  pnlMetaText: {
    fontSize: 9,
    color: colors.dark.textSecondary,
    marginTop: 4,
  },
  pnlShareFooter: {
    fontSize: 8,
    color: colors.dark.textMuted,
    textAlign: 'center',
    marginTop: 6,
  },
  shareBtnRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  shareBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.dark.accent,
    borderRadius: 8,
    paddingVertical: 8,
  },
  saveBtn: {
    backgroundColor: colors.dark.blue,
  },
  shareBtnText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.dark.background,
  },
  /* v1.5.6 (بازیابی از v1.5.4) — فیلتر نوع تاریخچه (سودها/ضررها/نوع بستن) */
  histTypeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 6,
    marginTop: 2,
  },
  histTypeChip: {
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 7,
    backgroundColor: colors.dark.surface,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  histTypeChipActive: {
    backgroundColor: colors.dark.accent,
    borderColor: colors.dark.accent,
  },
  /* v1.5.6 — سرتیتر تاریخچه + دکمه PDF کنار هم */
  closedTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  histPdfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.dark.accent,
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  histPdfBtnText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: colors.dark.background,
  },
  /* v1.5.6 — صفحه‌بندی ۱۰۰تایی تاریخچه */
  histPagerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 6,
  },
  histPagerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.dark.surface,
    borderWidth: 1,
    borderColor: colors.dark.accent + '55',
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  histPagerBtnDisabled: {
    opacity: 0.35,
  },
  histPagerBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.dark.accent,
  },
  histPagerText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: colors.dark.textSecondary,
  },
  /* v1.5.8 — R2: کارت «تنظیمات محاسبه‌گر (ذخیره‌شده)» در حالت واقعی */
  feasBox: {
    backgroundColor: colors.dark.card,
    borderWidth: 1,
    borderColor: colors.dark.accent + '3A',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
  },
  feasHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  feasTitle: {
    flex: 1,
    fontSize: 11,
    fontWeight: '900',
    color: colors.dark.text,
    textAlign: 'right',
  },
  feasChev: {
    padding: 4,
  },
  feasHint: {
    fontSize: 9,
    lineHeight: 14,
    color: colors.dark.textSecondary,
    marginTop: 8,
    textAlign: 'right',
  },
  feasRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.dark.background,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    borderRadius: 8,
    padding: 8,
    marginTop: 8,
  },
  feasTexts: {
    flex: 1,
  },
  feasRowTitle: {
    fontSize: 10.5,
    fontWeight: '900',
    color: colors.dark.text,
    textAlign: 'right',
  },
  feasRowSub: {
    fontSize: 9,
    color: colors.dark.textSecondary,
    lineHeight: 14,
    marginTop: 2,
    textAlign: 'right',
  },
  feasRowDate: {
    fontSize: 8.5,
    color: colors.dark.textMuted,
    marginTop: 2,
    textAlign: 'right',
  },
  feasDel: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: colors.dark.red + '14',
  },
});
