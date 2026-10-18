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
  Alert,
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
  Share2,
  Save,
  ShieldCheck,
  Edit3,
  Send,
  RotateCcw,
  Scissors,
} from 'lucide-react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import colors from '@/constants/colors';
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
  updatePositionTpsl,
} from '@/utils/autoTradingEngine';

/** v1.5.3 — لوگوی مشکی‌پس‌زمینه (بدون قاب سفید) برای بک‌گراند عکس PnL. */
const APP_LOGO = require('@/assets/images/icon-dark.png');

/** v1.5.2 — رفرش پوزیشن‌های ربات هر ۳ ثانیه (طبق درخواست کاربر). */
const UI_REFRESH_MS = 3_000;

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
  /** v1.5.2 — وضعیت اتصال سرور ۲۴/۷ (تلگرام). */
  const [server247State, setServer247State] = useState<{ busy: boolean; lastOk: boolean | null; error?: string }>({
    busy: false,
    lastOk: null,
  });
  const pnlCardRef = useRef<View>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

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
    })().catch(() => setLoaded(true));
  }, [realKeysProp]);

  const persist = useCallback(async (next: AutoTradeSettings) => {
    const wasServer = settingsRef.current.server247.enabled;
    setSettings(next);
    await saveAutoSettings(next);
    // v1.5.2 — اعلام تلگرام ۲۴/۷: با هر تغییر تنظیمات (روشن/خاموش شدن سوییچ
    // سرور، شروع/توقف ربات، تغییر حالت یا مقادیر) کانفیگ به سرور push می‌شود
    // تا ربات روی سرور با تنظیمات تازه اجرا/متوقف شود.
    if (next.server247.enabled || wasServer) {
      setServer247State((s) => ({ ...s, busy: true }));
      const r = await pushAutoTradeConfigToServer(next);
      setServer247State((s) => ({ ...s, busy: false, lastOk: r.ok, error: r.error }));
    }
  }, []);

  const refreshPositions = useCallback(async () => {
    setPositions(await loadDemoPositions());
    setRealPositions(await loadRealPositions());
    setLogs((await getAutoLogs()).slice(0, 30));
    setLastCycleAt(getLastGlobalCycleAt());
  }, []);

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

  // v1.5.1 — فیلتر روز تاریخچه معاملات (امروز/۷/۳۰/همه)
  const histWindowMs = useCallback(
    (p: AutoPnlPeriod): number =>
      p === 'today' ? 24 * 3600_000 : p === '7d' ? 7 * 24 * 3600_000 : p === '30d' ? 30 * 24 * 3600_000 : Infinity,
    []
  );

  const openPositions = useMemo(() => positions.filter((p) => p.status === 'open'), [positions]);
  const closedPositions = useMemo(() => {
    const win = histWindowMs(histPeriod);
    const now = Date.now();
    return positions
      .filter((p) => p.status === 'closed' && (win === Infinity || (!!p.closedAt && now - p.closedAt <= win)))
      .slice()
      .reverse()
      .slice(0, 30);
  }, [positions, histPeriod, histWindowMs]);
  const realOpen = useMemo(() => realPositions.filter((p) => p.status === 'open'), [realPositions]);
  const realClosed = useMemo(() => {
    const win = histWindowMs(histPeriod);
    const now = Date.now();
    return realPositions
      .filter((p) => p.status === 'closed' && (win === Infinity || (!!p.closedAt && now - p.closedAt <= win)))
      .slice()
      .reverse()
      .slice(0, 30);
  }, [realPositions, histPeriod, histWindowMs]);

  const totalPnl = openPositions.reduce((s, p) => {
    const dir = p.side === 'long' ? 1 : -1;
    return s + (p.lastPrice - p.entryPrice) * dir * p.qty;
  }, 0);
  const realTotalPnl = realOpen.reduce((s, p) => {
    const dir = p.side === 'long' ? 1 : -1;
    return s + (p.lastPrice - p.entryPrice) * dir * p.qty;
  }, 0);

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
      Alert.alert('منبع انتخاب نشده', 'حداقل یکی از دو منبع (نهنگ یا اندیکاتور) را فعال و انتخاب کنید.');
      return;
    }
    if (settings.whale.enabled && !settings.whale.address) {
      Alert.alert('نهنگ انتخاب نشده', 'از لیست، نهنگ موردنظر برای کپی معاملات را انتخاب کنید.');
      return;
    }
    if (settings.indicators.enabled && settings.indicators.selections.length === 0) {
      Alert.alert('اندیکاتور انتخاب نشده', 'از منوی کشویی، حداقل یک اندیکاتور انتخاب کنید.');
      return;
    }
    if (settings.mode === 'real' && !realKeys) {
      Alert.alert('کلید API نیست', 'برای معامله واقعی، ابتدا کلید API فیوچرز بایننس را در تب «واقعی» اضافه کنید.');
      return;
    }
    Alert.alert(
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
        Alert.alert('وب', 'خروجی عکس فقط روی گوشی (اندروید/iOS) پشتیبانی می‌شود.');
        return;
      }
      const uri = await capturePnl();
      if (!uri) {
        Alert.alert('خطا', 'ساخت عکس PnL ممکن نشد.');
        return;
      }
      setPreviewUri(uri);
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
        Alert.alert('غيرممکن', 'اشتراک‌گذاری روی این دستگاه در دسترس نیست.');
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
        Alert.alert('دسترسی داده نشد', 'برای ذخیره عکس در گالری، دسترسی رسانه را تأیید کنید.');
        return;
      }
      await MediaLibrary.saveToLibraryAsync(previewUri);
      Alert.alert('ذخیره شد ✅', 'عکس PnL ربات در گالری گوشی ذخیره شد.');
    } catch {
      Alert.alert('خطا', 'ذخیره عکس انجام نشد.');
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
      Alert.alert('خطا', 'قیمت استاپ و تیک‌پرافیت را درست وارد کنید (بزرگ‌تر از صفر).');
      return;
    }
    const long = editTpsl.side === 'long';
    if (long && newStop >= newTake) {
      Alert.alert('خطا', 'در پوزیشن لانگ، استاپ باید پایین‌تر از تیک‌پرافیت باشد.');
      return;
    }
    if (!long && newStop <= newTake) {
      Alert.alert('خطا', 'در پوزیشن شورت، استاپ باید بالاتر از تیک‌پرافیت باشد.');
      return;
    }
    setTpslBusy(true);
    try {
      const ok = await updatePositionTpsl(settings, realKeys, editTpsl, newStop, newTake);
      if (ok) {
        setEditTpsl(null);
        await refreshPositions();
      } else {
        Alert.alert('ناموفق', 'تغییر TP/SL انجام نشد — اعداد را دوباره چک کنید و دوباره تلاش کنید.');
      }
    } finally {
      setTpslBusy(false);
    }
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
    Alert.alert(
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
                const r = await resetDemoBacktest();
                await refreshPositions();
                if (r.server.ok) {
                  Alert.alert('ریست شد ✅', 'بک‌تست دمو از صفر شروع شد — سرور ۲۴/۷ هم ریست شد.');
                } else if (settings.server247.enabled) {
                  Alert.alert('ریست شد ✅', `بک‌تست دمو از صفر شروع شد.\n(ریست سرور ناموفق: ${r.server.error ?? 'خطا'})`);
                }
              } finally {
                setResetBusy(false);
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
                ? `${settings.mode === 'demo' ? 'دمو' : 'واقعی'} فعال • ${settings.mode === 'demo' ? `${openPositions.length} پوزیشن دمو` : `${realOpen.length} پوزیشن واقعی`} • همیشه روشن`
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
          {settings.enabled && (
            <View style={styles.engineBadge}>
              <ShieldCheck size={11} color={colors.dark.green} />
              <Text style={styles.engineBadgeText}>
                موتور همیشه‌فعال: هر ۶۰ ثانیه + هنگام باز شدن برنامه چرخه می‌زند — با بستن برنامه خاموش نمی‌شود.
                {lastCycleAt ? ` آخرین چرخه: ${Math.max(0, Math.round((Date.now() - lastCycleAt) / 1000))} ثانیه پیش.` : ''}
              </Text>
            </View>
          )}

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

          {/* v1.5.2 — اعلام تلگرام ۲۴/۷ از سرور: باز/بسته شدن پوزیشن‌های دمو یا
              واقعیِ بک‌تست حتی وقتی برنامه بسته است به تلگرام اعلام می‌شود */}
          <View style={styles.sourceBox}>
            <View style={styles.sourceHead}>
              <Send size={13} color={colors.dark.blue} />
              <Text style={styles.sourceTitle}>اعلام تلگرام ۲۴/۷ (سرور)</Text>
              {server247State.busy ? (
                <ActivityIndicator size="small" color={colors.dark.accent} />
              ) : (
                <Switch
                  value={settings.server247.enabled}
                  onValueChange={(v) => void persist({ ...settings, server247: { ...settings.server247, enabled: v } })}
                  trackColor={{ true: colors.dark.green + '88', false: colors.dark.card }}
                  thumbColor={settings.server247.enabled ? colors.dark.green : colors.dark.textMuted}
                  style={{ transform: [{ scale: 0.7 }] }}
                  testID="server247-switch"
                />
              )}
            </View>
            <Text style={styles.sourceHint}>
              وقتی روشن باشد، ربات بک‌تست روی سرور ۲۴/۷ اجرا می‌شود و هر باز/بسته شدن پوزیشن (دمو یا واقعی) با سود/زیانش به تلگرام شما اعلام می‌شود — حتی وقتی برنامه بسته است. تنظیمات با هر تغییر، خودکار به سرور می‌روند.
            </Text>
            {settings.server247.enabled && (
              <View style={[styles.engineBadge, server247State.lastOk === false && { borderColor: colors.dark.red + '44', backgroundColor: colors.dark.red + '0F' }]}>
                <ShieldCheck size={11} color={server247State.lastOk === false ? colors.dark.red : colors.dark.green} />
                <Text style={[styles.engineBadgeText, server247State.lastOk === false && { color: colors.dark.red }]}>
                  {server247State.lastOk === false
                    ? `اتصال سرور ناموفق: ${server247State.error ?? 'خطا'} — ربات روی خود گوشی ادامه می‌دهد.`
                    : 'ربات روی سرور فعال است — فعالیت‌ها به تلگرام اعلام می‌شود. در حالت واقعی، کلید API برای اجرای روی سرور ارسال و روی سرور شما ذخیره می‌شود.'}
                </Text>
              </View>
            )}
          </View>

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
                      onPress={() => setPnlPeriod(p)}
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

              {/* v1.5.1 — پیش‌نمایش عکس PnL: بعد از دیدن عکس، ذخیره یا اشتراک را انتخاب کنید */}
              <Modal visible={!!previewUri} transparent animationType="fade">
                <Pressable style={styles.previewOverlay} onPress={() => setPreviewUri(null)}>
                  <View style={styles.previewCard} onStartShouldSetResponder={() => true}>
                    <View style={styles.previewHead}>
                      <Text style={styles.previewTitle}>پیش‌نمایش عکس PnL</Text>
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

          {/* demo positions — فقط حالت دمو (در واقعی، ریز معاملات دمو نمایش داده نمی‌شود) */}
          {settings.mode === 'demo' && (
            <View style={styles.sourceBox}>
              <View style={styles.sourceHead}>
                <TrendingUp size={13} color={totalPnl >= 0 ? colors.dark.green : colors.dark.red} />
                <Text style={styles.sourceTitle}>پوزیشن‌های ربات (دمو)</Text>
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
                      <Text style={styles.posPrices}>
                        ورود: {fmtExact(p.entryPrice)} → فعلی: {fmtExact(p.lastPrice)}
                      </Text>
                      <Text style={styles.posPrices}>
                        SL {fmtExact(p.stopPrice)} / TP {fmtExact(p.takePrice)}
                      </Text>
                      {/* v1.5.3 — ساعت و تاریخ باز شدن معامله */}
                      <Text style={styles.posTime}>باز شد: {fmtOpenTime(p.openedAt)}</Text>
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
                      {/* v1.5.3 — «بصورت دستی هم بشه بخشی از حجم را ببندم» */}
                      <Pressable
                        style={styles.posHalfBtn}
                        hitSlop={6}
                        onPress={() =>
                          void manualPartialClosePosition(settings, realKeys, {
                            id: p.id,
                            symbol: p.symbol,
                            side: p.side,
                            lastPrice: p.lastPrice,
                          }).then(refreshPositions)
                        }
                        testID={`pos-half-${p.id}`}
                      >
                        <Scissors size={11} color={colors.dark.blue} />
                      </Pressable>
                      <Pressable style={styles.posCloseBtn} onPress={() => void manualClosePosition(settings, realKeys, p).then(refreshPositions)}>
                        <X size={11} color={colors.dark.red} />
                      </Pressable>
                    </View>
                  </View>
                );
              })}
              {closedPositions.length > 0 && (
                <View style={styles.closedBox}>
                  <Text style={styles.closedTitle}>تاریخچه معاملات:</Text>
                  <View style={styles.histPeriodRow}>
                    {AUTO_PNL_PERIODS.map((p) => (
                      <Pressable
                        key={p}
                        style={[styles.histPeriodChip, histPeriod === p && styles.histPeriodChipActive]}
                        onPress={() => setHistPeriod(p)}
                        testID={`auto-hist-${p}`}
                      >
                        <Text style={[styles.histPeriodText, histPeriod === p && styles.histPeriodTextActive]}>
                          {AUTO_PNL_PERIOD_LABEL[p]}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {(() => {
                    const sum = closedPositions.reduce((s, p) => s + (p.realizedPnl ?? 0), 0);
                    return (
                      <View style={styles.histSummary}>
                        <Text style={styles.histSummaryText}>
                          {closedPositions.length.toLocaleString('fa-IR')} معامله در این بازه
                        </Text>
                        <Text style={[styles.histSummaryPnl, { color: sum >= 0 ? colors.dark.green : colors.dark.red }]}>
                          {sum >= 0 ? '+' : '−'}${Math.abs(sum).toFixed(2)}
                        </Text>
                      </View>
                    );
                  })()}
                  {closedPositions.map((p) => (
                    <View key={p.id} style={styles.closedRow}>
                      <Text style={styles.closedText} numberOfLines={2}>
                        {/* v1.5.3 — نام استراتژی + نوع اندیکاتور کنار نام ارز */}
                        {p.symbol}
                        {p.strategyName ? ` • ${p.strategyName}` : ''}
                        {p.sourceLabel ? ` • ${p.sourceLabel}` : ''}
                        {' '}({p.closeReason === 'stop' ? 'استاپ' : p.closeReason === 'take' ? 'تیک‌پرافیت' : p.closeReason === 'whale-close' ? 'نهنگ بست' : p.closeReason === 'signal' ? 'سیگنال' : p.closeReason === 'partial' ? 'برداشت سود (نصف حجم)' : p.closeReason === 'partial-manual' ? 'نصف دستی' : 'دستی'})
                      </Text>
                      <Text style={[styles.posPnl, { color: (p.realizedPnl ?? 0) >= 0 ? colors.dark.green : colors.dark.red }]}>
                        {(p.realizedPnl ?? 0) >= 0 ? '+' : '−'}${Math.abs(p.realizedPnl ?? 0).toFixed(2)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* real positions (tracked by the engine) — فقط حالت واقعی */}
          {settings.mode === 'real' && realKeys && (
            <View style={styles.sourceBox}>
              <View style={styles.sourceHead}>
                <TrendingUp size={13} color={realTotalPnl >= 0 ? colors.dark.green : colors.dark.red} />
                <Text style={styles.sourceTitle}>پوزیشن‌های ربات (واقعی)</Text>
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
                      <Text style={styles.posPrices}>
                        ورود: {fmtExact(p.entryPrice)} → فعلی: {fmtExact(p.lastPrice)}
                      </Text>
                      <Text style={styles.posPrices}>
                        SL {fmtExact(p.stopPrice)} / TP {fmtExact(p.takePrice)}
                      </Text>
                      {/* v1.5.3 — ساعت و تاریخ باز شدن معامله */}
                      <Text style={styles.posTime}>باز شد: {fmtOpenTime(p.openedAt)}</Text>
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
                      {/* v1.5.3 — بستن دستی نصف حجم (واقعی) */}
                      <Pressable
                        style={styles.posHalfBtn}
                        hitSlop={6}
                        onPress={() =>
                          void manualPartialClosePosition(settings, realKeys, {
                            id: p.id,
                            symbol: p.symbol,
                            side: p.side,
                            lastPrice: p.lastPrice,
                          }).then(refreshPositions)
                        }
                      >
                        <Scissors size={11} color={colors.dark.blue} />
                      </Pressable>
                      <Pressable
                        style={styles.posCloseBtn}
                        onPress={() =>
                          void manualClosePosition(settings, realKeys, {
                            id: p.id,
                            symbol: p.symbol,
                            side: p.side,
                            lastPrice: p.lastPrice,
                          }).then(refreshPositions)
                        }
                      >
                        <X size={11} color={colors.dark.red} />
                      </Pressable>
                    </View>
                  </View>
                );
              })}
              {realClosed.length > 0 && (
                <View style={styles.closedBox}>
                  <Text style={styles.closedTitle}>تاریخچه معاملات (واقعی):</Text>
                  <View style={styles.histPeriodRow}>
                    {AUTO_PNL_PERIODS.map((p) => (
                      <Pressable
                        key={p}
                        style={[styles.histPeriodChip, histPeriod === p && styles.histPeriodChipActive]}
                        onPress={() => setHistPeriod(p)}
                      >
                        <Text style={[styles.histPeriodText, histPeriod === p && styles.histPeriodTextActive]}>
                          {AUTO_PNL_PERIOD_LABEL[p]}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {(() => {
                    const sum = realClosed.reduce((s, p) => s + (p.realizedPnl ?? 0), 0);
                    return (
                      <View style={styles.histSummary}>
                        <Text style={styles.histSummaryText}>
                          {realClosed.length.toLocaleString('fa-IR')} معامله در این بازه
                        </Text>
                        <Text style={[styles.histSummaryPnl, { color: sum >= 0 ? colors.dark.green : colors.dark.red }]}>
                          {sum >= 0 ? '+' : '−'}${Math.abs(sum).toFixed(2)}
                        </Text>
                      </View>
                    );
                  })()}
                  {realClosed.map((p) => (
                    <View key={p.id} style={styles.closedRow}>
                      <Text style={styles.closedText} numberOfLines={2}>
                        {/* v1.5.3 — نام استراتژی + نوع اندیکاتور کنار نام ارز */}
                        {p.symbol}
                        {p.strategyName ? ` • ${p.strategyName}` : ''}
                        {p.sourceLabel ? ` • ${p.sourceLabel}` : ''}
                        {' '}({p.closeReason === 'stop' ? 'استاپ' : p.closeReason === 'take' ? 'روی صرافی' : p.closeReason === 'whale-close' ? 'نهنگ بست' : p.closeReason === 'signal' ? 'سیگنال' : p.closeReason === 'partial' ? 'برداشت سود (نصف حجم)' : p.closeReason === 'partial-manual' ? 'نصف دستی' : 'دستی'})
                      </Text>
                      <Text style={[styles.posPnl, { color: (p.realizedPnl ?? 0) >= 0 ? colors.dark.green : colors.dark.red }]}>
                        {(p.realizedPnl ?? 0) >= 0 ? '+' : '−'}${Math.abs(p.realizedPnl ?? 0).toFixed(2)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
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

function PnlRow({ label, value, pct, bold }: { label: string; value: number; pct?: number; bold?: boolean }) {
  return (
    <View style={styles.pnlShareRow}>
      <Text style={[styles.pnlShareRowLabel, bold && { fontWeight: '800' }]}>{label}</Text>
      {/* v1.5.2 — سود/زیان هم دلاری هم درصدی (مثل بایننس) */}
      <View style={styles.pnlShareRowRight}>
        <Text style={[styles.pnlShareRowValue, { color: value >= 0 ? colors.dark.green : colors.dark.red }, bold && { fontWeight: '800' }]}>
          {value >= 0 ? '+' : '−'} ${Math.abs(value).toFixed(2)}
        </Text>
        {typeof pct === 'number' && (
          <Text style={[styles.pnlShareRowPct, { color: pct >= 0 ? colors.dark.green : colors.dark.red }, bold && { fontWeight: '800' }]}>
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
});
