import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  Switch,
  Alert,
  Platform,
  Modal,
  FlatList,
  Animated,
  Linking,
  Image,
} from 'react-native';
import { Plus, Trash2, Pencil, Check, X, Search, Save, HelpCircle, ChevronDown, ChevronUp, Instagram, Send, Bot, MessageCircle, Globe, Download, RefreshCw, Sun, Moon, Bell } from 'lucide-react-native';
import { sendTelegramWelcome, startTelegramPolling } from '@/utils/telegramService';
import { getServerUrl, setServerUrl, testServerUrl, syncScanConfig, sendServerTelegramTest } from '@/utils/scanServerApi';
import { registerPushOnServer, sendTestLocalNotification } from '@/utils/pushService';
import {
  AppUpdateInfo,
  fetchUpdateInfo,
  getInstalledVersion,
  onUpdateInfoChanged,
  openApkDownload,
} from '@/utils/appUpdate';
import AsyncStorage from '@react-native-async-storage/async-storage';
import colors from '@/constants/colors';
import { createThemedStyles } from '@/utils/themeStyles';
import { useApp } from '@/contexts/AppContext';
import { EXCHANGE_LIST, LEVERAGE_OPTIONS, EXCHANGES, RISK_REWARD_OPTIONS, TIMEFRAME_OPTIONS } from '@/constants/exchanges';
import { ExchangeId, CustomIndicator } from '@/types/crypto';
import DropdownPicker from '@/components/DropdownPicker';

const POPULAR_COINS = [
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'MATIC',
  'LINK', 'UNI', 'ATOM', 'LTC', 'ETC', 'FIL', 'APT', 'ARB', 'OP', 'SUI',
  'NEAR', 'ICP', 'FTM', 'SAND', 'MANA', 'AXS', 'GALA', 'ENJ', 'CHZ', 'AAVE',
  'MKR', 'CRV', 'SNX', 'COMP', 'SUSHI', 'YFI', 'BAL', '1INCH', 'DYDX', 'GMX',
  'LDO', 'RPL', 'SSV', 'FXS', 'LQTY', 'PENDLE', 'RDNT', 'MAGIC', 'GNS', 'JOE',
  'PEPE', 'SHIB', 'FLOKI', 'WIF', 'BONK', 'ORDI', 'SATS', 'INJ', 'TIA', 'SEI',
  'BLUR', 'STRK', 'MANTA', 'DYM', 'JUP', 'WLD', 'PYTH', 'JTO', 'ONDO', 'ENA',
  'TON', 'NOT', 'AEVO', 'ETHFI', 'W', 'TNSR', 'TAO', 'RENDER', 'FET', 'AGIX',
  'PEOPLE', 'CFX', 'STORJ', 'IMX', 'ALGO', 'EGLD', 'THETA', 'VET', 'HBAR', 'XLM',
];

const REFRESH_INTERVAL_OPTIONS = [
  { key: '0.05', label: '۳ ثانیه' },
  { key: '0.1', label: '۶ ثانیه' },
  { key: '0.17', label: '۱۰ ثانیه' },
  { key: '0.25', label: '۱۵ ثانیه' },
  { key: '0.5', label: '۳۰ ثانیه' },
  { key: '1', label: '۱ دقیقه' },
  { key: '2', label: '۲ دقیقه' },
  { key: '3', label: '۳ دقیقه' },
  { key: '5', label: '۵ دقیقه' },
  { key: '10', label: '۱۰ دقیقه' },
  { key: '15', label: '۱۵ دقیقه' },
  { key: '30', label: '۳۰ دقیقه' },
];

const HELP_SECTIONS = [
  {
    id: 'scanner',
    title: '🔍 اسکنر سیگنال',
    content: 'اسکنر به صورت خودکار تمام جفت‌ارزهای فیوچرز را بررسی می‌کند. دو حالت سیگنال‌دهی دارد:\n\n۱. حالت حجمی: فقط بر اساس حجم معاملات و نسبت خرید/فروش سیگنال می‌دهد.\n\n۲. حالت تحلیل پیشرفته (Confluence): سیگنال‌ها بر اساس ترکیب چندلایه تحلیل می‌شوند:\n• تکنیکال (۴۰٪): ۱۰ اندیکاتور شامل RSI, MACD, EMA, BB, ATR, ADX, StochRSI, OBV, Ichimoku, Fibonacci\n• آنچین (۲۵٪): حجم/مارکت‌کپ، تغییرات ۷ و ۳۰ روزه، فاصله از ATH\n• سنتیمنت (۱۵٪): Fear & Greed Index، تسلط بازار\n• مشتقات (۱۰٪): Funding Rate، Long/Short Ratio، Open Interest\n• چند تایم‌فریم (۱۰٪): بررسی همگرایی ۱۵ دقیقه، ۱ ساعته و ۴ ساعته\n\nسطوح Confidence:\n• بالای ۸۲٪: قوی (ورود با اطمینان)\n• ۷۰-۸۱٪: متوسط (ورود با احتیاط)\n• ۵۵-۶۹٪: ضعیف (فقط مشاهده)\n• زیر ۵۵٪: اجتناب',
  },
  {
    id: 'trade-ai',
    title: '🤖 ترید با هوش مصنوعی',
    content: 'این بخش از هوش مصنوعی برای تحلیل جامع استفاده می‌کند. AI از ۱۰ اندیکاتور تکنیکال + داده‌های آنچین + سنتیمنت + مشتقات + تحلیل چند تایم‌فریم استفاده می‌کند.\n\nسه حالت معامله:\n• دمو دستی: تحلیل کنید و خودتان پوزیشن باز کنید\n• دمو اتوماتیک: بک‌تست استراتژی روی ارز خاص - ربات خودکار سیگنال‌ها را معامله می‌کند\n• ریل: معامله واقعی با API صرافی\n\nامتیازدهی Confluence:\n• تکنیکال: ۴۰٪ وزن (RSI + MACD + EMA + BB + ADX + StochRSI + OBV + Ichimoku + ATR + Fibonacci)\n• آنچین: ۲۵٪ وزن (حجم/مارکت‌کپ، تغییرات قیمت ۷ و ۳۰ روزه)\n• سنتیمنت: ۱۵٪ وزن (Fear & Greed Index)\n• مشتقات: ۱۰٪ وزن (Funding Rate + L/S Ratio + Open Interest)\n• چند تایم‌فریم: ۱۰٪ وزن (همگرایی ۱۵m + ۱h + ۴h)\n\nحد ضرر بر اساس ATR×۱.۵-۲ تنظیم می‌شود (نه عدد ثابت).',
  },
  {
    id: 'real-trade',
    title: '💰 ترید واقعی',
    content: 'در این بخش می‌توانید با اتصال API صرافی خود معاملات واقعی فیوچرز انجام دهید. دو حالت دستی و اتوماتیک دارد:\n\n• حالت دستی: سیگنال AI را انتخاب کنید، حجم و اهرم تنظیم کنید و معامله باز کنید. حد ضرر، تارگت و تریل استاپ قابل تغییر است.\n\n• حالت اتوماتیک (ربات): ربات خودکار سیگنال‌ها را رصد کرده و فقط سیگنال‌های با اطمینان بالا را معامله می‌کند. مدیریت سرمایه شامل حفظ سرمایه اولیه، حداکثر ریسک و حداکثر پوزیشن باز است.\n\nمی‌توانید تا ۲ صرافی اضافه کنید و برای هر کدام منبع سیگنال و ارزهای خاص تنظیم کنید.',
  },
  {
    id: 'whales',
    title: '🐋 ردیابی نهنگ‌ها',
    content: 'نهنگ‌ها کیف پول‌هایی با حجم بالای سرمایه هستند که تأثیر زیادی بر بازار دارند. در این بخش می‌توانید:\n\n• آدرس کیف پول نهنگ‌ها را وارد و ردیابی کنید\n• از لیست نهنگ‌های برتر (بیشترین سود ۳۰ روزه) انتخاب کنید\n• معاملات اخیر هر نهنگ و توکن‌های نگهداری شده را ببینید\n• از تغییرات پورتفوی نهنگ‌ها مطلع شوید\n\nاطلاعات هر ۳ ثانیه بروزرسانی می‌شود.',
  },
  {
    id: 'wallet',
    title: '👛 مدیریت دارایی',
    content: 'در این بخش می‌توانید صرافی‌های خود را اضافه کرده و موجودی کامل (Overview) حساب را ببینید: اسپات + Earn (سپرده‌گذاری) + فاندینگ + فیوچرز + آلفا — برای هر دارایی سود/زیان تقریبی (PnL) و برای کل صرافی یک PnL کلی نمایش داده می‌شود؛ پوزیشن‌های باز فیوچرز نیز با سود/زیان شناور (uPnL) و ROE دیده می‌شوند. مجموع کل دارایی از همه صرافی‌های متصل (دلاری و تومانی) در کارت بالای همین صفحه نمایش داده می‌شود. قیمت تتر به تومان به‌صورت خودکار و پنهان (بدون هیچ تنظیماتی) از صرافی ارزینجا و در صورت قطعی آن از منابع پشتیبان (نوبیتکس، الن‌چند، والکس و...) خوانده می‌شود و طبق «بازه بروزرسانی» (پیش‌فرض هر ۵ دقیقه) رفرش می‌گردد و ارزش کل پورتفوی و سود/زیان هر ارز بر همین اساس محاسبه می‌گردد.',
  },
  {
    id: 'hook-reversal',
    title: '🪝 هوک ریورسال',
    content: 'این بخش الگوی کلاسیک هوک ریورسال (Hook Reversal) را روی کندل‌های Binance شناسایی می‌کند:\n\n🟢 هوک صعودی: کندل جدید کف پایین‌تری از کندل قبلی می‌زند ولی بالای کفِ قبلیِ قیمت می‌بندد (Close جدید > Close قبلی) → جذب فروشنده و احتمال برگشت به بالا.\n🔴 هوک نزولی: کندل جدید سقف بالاتری می‌زند ولی زیر سقف قبلی می‌بندد (Close جدید < Close قبلی) → توزیع و احتمال برگشت به پایین.\n\n• تایم‌فریم‌های اسکن را خودتان انتخاب می‌کنید: روزانه و ۴ ساعته (چندانتخابی)\n• سرور خودکار اسکن می‌کند: هر ۴ ساعت تایم‌فریم ۴ ساعته و شبانه تایم‌فریم روزانه بعد از بسته شدن کندل‌ها — حتی وقتی برنامه کاملاً بسته است\n• هر سیگنال شامل نام ارز، جهت (صعودی/نزولی)، قیمت لحظه‌ی شناسایی، تایم‌فریم و بازار Binance (فیوچرز/اسپات) است\n• سیگنال‌ها در همین بخش، در اعلان‌های گوشی و در ربات تلگرام (دستور /hook و پیام خودکار) دریافت می‌شوند\n• کندل در حال ساخت هم بررسی می‌شود و با برچسب «زنده» مشخص است\n\nبا سوئیچ «دریافت سیگنال‌های هوک ریورسال» می‌توانید اعلان‌های آن را غیرفعال کنید؛ انتخاب تایم‌فریم‌ها بلافاصله به سرور هم اعمال می‌شود.',
  },
  {
    id: 'indicators',
    title: '📊 اندیکاتورها (GainzAlgo Pro و اندیکاتور من)',
    content: 'این بخش دو زیربخش دارد و سیگنال‌هایش حتی وقتی برنامه کاملاً بسته است توسط سرور اسکن می‌شود و از طریق ربات تلگرام اعلام می‌گردد:\n\n📊 اندیکاتور آماده (GainzAlgo Pro):\n• سیگنال‌های خرید (BUY) و فروش (SELL) بر اساس کندل پوششی (Engulfing)، پایداری کندل و RSI(14)\n• تایم‌فریم‌های اسکن را خودتان انتخاب می‌کنید: روزانه، ۴ ساعته و ۱ ساعته (هر ترکیبی)\n• سرور هر ساعت تایم‌فریم ۱ ساعته، هر ۴ ساعت تایم‌فریم ۴ ساعته و شبانه تایم‌فریم روزانه را بعد از بسته شدن کندل‌ها اسکن می‌کند\n• سیگنال‌های کندل در حال ساخت (زنده) هم اعلام می‌شوند و روی کارت با برچسب «زنده» مشخص هستند\n• نوع بازار Binance هر ارز (فیوچرز / اسپات) روی کارت هر سیگنال نمایش داده می‌شود\n\n🧩 اندیکاتور من:\n• کد اندیکاتور خود را (Pine Script مانند) با نام و تایم‌فریم دلخواه اضافه کنید\n• اندیکاتورهای فعال روزانه اسکن می‌شوند و سیگنال‌هایشان در همین بخش، در اعلان‌ها و در تلگرام می‌آید\n\nفیلترهای «امروز / ۳ روز / ۷ روز / همه» سیگنال‌ها را بر اساس زمان کشف سیگنال محدود می‌کنند؛ یعنی کندل روزانه‌ای که شب قبل بسته شده و سیگنالش امروز اعلام شده، زیر فیلتر «امروز» می‌آید. دکمه «اسکن فوری» همان لحظه اسکن می‌کند. سیگنال‌های سرور با سیگنال‌های محلی ادغام می‌شوند؛ پس هیچ سیگنالی از دست نمی‌رود.',
  },
  {
    id: 'signal-methodology',
    title: '🎯 روش سیگنال‌دهی پیشرفته',
    content: 'سیستم امتیازدهی Confluence چندلایه:\n\n۱. تحلیل چند تایم‌فریم:\nهمیشه سیگنال روی ۳ تایم‌فریم (۱۵m + ۱h + ۴h) بررسی می‌شود. اگر همگرا باشند امتیاز +۱۰٪\n\n۲. اندیکاتورهای اضافی:\nADX (بالای ۲۵ = روند قوی)، Stochastic RSI، OBV، Ichimoku Cloud، Fibonacci\n\n۳. داده‌های آنچین:\nحجم/مارکت‌کپ، تغییرات ۷ و ۳۰ روزه، فاصله از ATH\n\n۴. سنتیمنت بازار:\nFear & Greed Index، تسلط بازار\n\n۵. داده‌های مشتقات:\nFunding Rate (مثبت = لانگ‌ها تسلط)، Long/Short Ratio، Open Interest\n\n۶. مدیریت ریسک:\n• فقط سیگنال‌های بالای ۷۰٪ Confidence پیشنهاد ورود می‌دهند\n• حد ضرر بر اساس ATR×۱.۵-۲ (نه عدد ثابت)\n• R:R حداقل ۱:۲',
  },
  {
    id: 'strategies',
    title: '📋 استراتژی‌ها',
    content: '۴ استراتژی معاملاتی:\n\n• محافظه‌کارانه: کم‌ریسک، اهرم پایین، مناسب مبتدیان\n• متعادل: تعادل بین ریسک و سود، مناسب اکثر کاربران\n• تهاجمی: ریسک بالا، سود بالقوه بیشتر، مناسب حرفه‌ای‌ها\n• اسکالپر: معاملات سریع و کوتاه‌مدت، نیاز به نظارت مداوم',
  },
  {
    id: 'settings-info',
    title: '⚙️ تنظیمات',
    content: '• انتخاب صرافی: صرافی مورد نظر خود را انتخاب و API را وارد کنید\n• تنظیمات معامله: حجم مارجین، اهرم و نسبت ریسک به ریوارد\n• اندیکاتورها: فعال/غیرفعال کردن اندیکاتورهای مختلف برای سیگنال‌دهی\n• حالت سیگنال‌دهی: انتخاب بین فقط حجمی یا تحلیل پیشرفته Confluence\n• انتخاب ارز: فقط ارزهای خاص را بررسی کنید\n• فیلتر اسکنر: محدود کردن اسکن به دسته خاصی از ارزها\n• بازه بروزرسانی: فرکانس بروزرسانی اطلاعات (از ۳ ثانیه تا ۳۰ دقیقه)\n• اعلان‌ها: اعلان سیگنال‌های جدید و فعالیت نهنگ‌ها',
  },
  {
    id: 'meme-short',
    title: '💀 اسکنر شورت میم‌کوین',
    content: 'این بخش میم‌کوین‌هایی را پیدا می‌کند که در حال پامپ بوده ولی علائم ریزش/دامپ/رگ نشان می‌دهند و سیگنال شورت (Sell) با لوریج پایین (حداکثر ۳x) می‌دهد.\n\nاستراتژی کلی:\n۱. فاز پامپ را پیدا کن (جدید، حجم ناگهانی، بوست اجتماعی)\n۲. فاز پیک/ریزش اولیه را تشخیص بده (فروش غالب، واگرایی، فید سنتیمنت)\n۳. فقط وقتی سیگنال بده که حداقل ۳-۴ لایه confluence داشته باشه\n۴. لوریج حداکثر ۳x + ریسک ۰.۵-۱٪ per trade\n\nامتیازدهی Meme Short Confidence:\n• تکنیکال (۳۰٪): RSI بالا + واگرایی نزولی + شکست بولینگر + کاهش حجم\n• آنچین (۲۵٪): فروش‌ها بیشتر از خریدها + لیکوییدیتی پایین\n• سنتیمنت (۲۰٪): کاهش حجم اجتماعی + بدون حساب رسمی\n• مشتقات (۱۵٪): Funding Rate مثبت بالا + لانگ‌ها در حال سوختن\n• هایپ میم (۱۰٪): پامپ بالا اما مومنتوم مرده\n\nداده‌ها از DexScreener، Birdeye و CoinGlass دریافت می‌شود. اسکن هر ۱۰ ثانیه انجام می‌شود.',
  },
  {
    id: 'pre-listing',
    title: '🚀 اسکنر قبل لیست شدن',
    content: 'این بخش میم‌کوین‌هایی را شناسایی می‌کند که هنوز در صرافی‌های متمرکز (CEX) لیست نشده‌اند اما پتانسیل لیست شدن دارند.\n\nمعیارهای بررسی:\n• مارکت‌کپ بین ۱۰۰K تا ۱۰۰M دلار\n• حجم معاملات ۲۴ ساعته بالای ۱۰K دلار\n• عمر توکن کمتر از ۷ روز\n• بررسی امنیت: لیکوییدیتی/مارکت‌کپ، نسبت فروش/خرید\n\nاحتمال لیست شدن بر اساس:\n• مارکت‌کپ بالاتر = احتمال لیست بیشتر\n• حجم معاملات بالاتر = توجه بیشتر صرافی‌ها\n• وجود شبکه اجتماعی فعال\n• رشد قیمت قابل توجه\n\nهشدار: خرید میم‌کوین قبل از لیست بسیار پرریسک است. حتماً بررسی کنید که پروژه کلاهبرداری نباشد.\n\nاطلاعات هر ۳ ثانیه بروزرسانی می‌شود.',
  },
];

const SCAN_FILTER_OPTIONS = [
  { key: 'all', label: 'همه ارزهای فیوچرز' },
  { key: 'top_gainers', label: 'تاپ گینرها (بیشترین رشد)' },
  { key: 'top_losers', label: 'تاپ لوزرها (بیشترین ریزش)' },
  { key: 'new_listings', label: 'ارزهای جدید صرافی' },
];

const DEFAULT_INDICATORS: CustomIndicator[] = [
  {
    id: 'default-ema',
    name: 'EMA Cross (9/21)',
    code: 'ema9 = ta.ema(close, 9)\nema21 = ta.ema(close, 21)\nbuy = ta.crossover(ema9, ema21)\nsell = ta.crossunder(ema9, ema21)',
    timeframe: '1h',
    enabled: false,
    createdAt: 0,
  },
  {
    id: 'default-macd',
    name: 'MACD Signal',
    code: '[macdLine, signalLine, hist] = ta.macd(close, 12, 26, 9)\nbuy = ta.crossover(macdLine, signalLine)\nsell = ta.crossunder(macdLine, signalLine)',
    timeframe: '1h',
    enabled: false,
    createdAt: 0,
  },
  {
    id: 'default-rsi',
    name: 'RSI Overbought/Oversold',
    code: 'rsi = ta.rsi(close, 14)\nbuy = rsi < 30\nsell = rsi > 70',
    timeframe: '1h',
    enabled: false,
    createdAt: 0,
  },
  {
    id: 'default-bb',
    name: 'Bollinger Bands',
    code: '[middle, upper, lower] = ta.bb(close, 20, 2)\nbuy = close < lower\nsell = close > upper',
    timeframe: '4h',
    enabled: false,
    createdAt: 0,
  },
];

function extractIndicatorName(code: string): string {
  const patterns = [
    /(?:indicator|study)\s*\(\s*["']([^"']+)["']/i,
    /(?:\/\/|#)\s*name:\s*(.+)/i,
    /(?:\/\/|#)\s*(.+?)(?:\n|$)/,
  ];
  for (const pattern of patterns) {
    const match = code.match(pattern);
    if (match && match[1]?.trim()) {
      return match[1].trim();
    }
  }

  const keywords = ['ema', 'macd', 'rsi', 'bb', 'sma', 'stoch', 'adx', 'atr', 'vwap', 'ichimoku', 'supertrend'];
  const lowerCode = code.toLowerCase();
  const found = keywords.filter((k) => lowerCode.includes(k));
  if (found.length > 0) {
    return found.map((k) => k.toUpperCase()).join(' + ');
  }

  return '';
}

export default function SettingsScreen() {
  const { settings, updateSettings, setAppThemeMode, addIndicator, updateIndicator, deleteIndicator, toggleIndicatorSelection } = useApp();
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [apiSecret, setApiSecret] = useState(settings.apiSecret);
  const [scanInterval, setScanInterval] = useState(String(settings.scanInterval));
  const [volumeThreshold, setVolumeThreshold] = useState(String(settings.volumeThreshold));
  const [scannerNotifications, setScannerNotifications] = useState(settings.scannerNotifications ?? true);
  const [whaleNotifications, setWhaleNotifications] = useState(settings.whaleNotifications ?? true);
  const [memeShortNotifications, setMemeShortNotifications] = useState(settings.memeShortNotifications ?? true);
  const [preListingNotifications, setPreListingNotifications] = useState(settings.preListingNotifications ?? true);
  const [tradeAiNotifications, setTradeAiNotifications] = useState(settings.tradeAiNotifications ?? true);
  const [gainzNotifications, setGainzNotifications] = useState(settings.gainzAlgoNotifications ?? true);
  const [themeMode, setThemeModeState] = useState<'dark' | 'light'>((settings.themeMode as 'dark' | 'light') ?? 'dark');
  const [selectedExchange, setSelectedExchange] = useState<ExchangeId>(settings.exchange);
  const [marginAmount, setMarginAmount] = useState(String(settings.marginAmount));
  const [leverage, setLeverage] = useState(settings.leverage);
  const [riskRewardRatio, setRiskRewardRatio] = useState(String(settings.riskRewardRatio));
  const [refreshInterval, setRefreshInterval] = useState(String(settings.refreshInterval ?? 5));
  const [scanFilterMode, setScanFilterMode] = useState(settings.scanFilterMode ?? 'all');
  const [serverUrlInput, setServerUrlInput] = useState('');
  const [serverStatus, setServerStatus] = useState('');
  const [serverBusy, setServerBusy] = useState(false);

  // ── In-app update state ───────────────────────────────
  const installedVersion = useMemo(() => getInstalledVersion(), []);
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState('');
  const [updateBusy, setUpdateBusy] = useState(false);

  useEffect(() => {
    // show the last known result immediately, then refresh from GitHub
    fetchUpdateInfo();
    const off = onUpdateInfoChanged((latest) => setUpdateInfo(latest));
    return off;
  }, []);

  useEffect(() => {
    getServerUrl().then((u) => setServerUrlInput(u));
  }, []);

  const [showIndicatorForm, setShowIndicatorForm] = useState(false);
  const [editingIndicator, setEditingIndicator] = useState<CustomIndicator | null>(null);
  const [indicatorName, setIndicatorName] = useState('');
  const [indicatorCode, setIndicatorCode] = useState('');
  const [indicatorTimeframe, setIndicatorTimeframe] = useState('1h');

  const [showCoinPicker, setShowCoinPicker] = useState(false);
  const [coinSearch, setCoinSearch] = useState('');
  const [useCustomCoinsOnly, setUseCustomCoinsOnly] = useState(settings.useCustomCoinsOnly);
  const [customCoins, setCustomCoins] = useState<string[]>(settings.customCoins ?? []);
  const [useVolumeOnlySignals, setUseVolumeOnlySignals] = useState(settings.useVolumeOnlySignals ?? false);
  const [telegramBotToken, setTelegramBotToken] = useState(settings.telegramBotToken ?? '');
  const [telegramChatId, setTelegramChatId] = useState(settings.telegramChatId ?? '');
  const [telegramEnabled, setTelegramEnabled] = useState(settings.telegramEnabled ?? false);

  React.useEffect(() => {
    setApiKey(settings.apiKey);
    setApiSecret(settings.apiSecret);
    setScanInterval(String(settings.scanInterval));
    setVolumeThreshold(String(settings.volumeThreshold));
    setScannerNotifications(settings.scannerNotifications ?? true);
    setWhaleNotifications(settings.whaleNotifications ?? true);
    setMemeShortNotifications(settings.memeShortNotifications ?? true);
    setPreListingNotifications(settings.preListingNotifications ?? true);
    setTradeAiNotifications(settings.tradeAiNotifications ?? true);
    setGainzNotifications(settings.gainzAlgoNotifications ?? true);
    setThemeModeState((settings.themeMode as 'dark' | 'light') ?? 'dark');
    setSelectedExchange(settings.exchange);
    setMarginAmount(String(settings.marginAmount));
    setLeverage(settings.leverage);
    setRiskRewardRatio(String(settings.riskRewardRatio));
    setRefreshInterval(String(settings.refreshInterval ?? 5));
    setScanFilterMode(settings.scanFilterMode ?? 'all');
    setUseCustomCoinsOnly(settings.useCustomCoinsOnly);
    setCustomCoins(settings.customCoins ?? []);
    setUseVolumeOnlySignals(settings.useVolumeOnlySignals ?? false);
    setTelegramBotToken(settings.telegramBotToken ?? '');
    setTelegramChatId(settings.telegramChatId ?? '');
    setTelegramEnabled(settings.telegramEnabled ?? false);
  }, [settings]);

  const [showHelp, setShowHelp] = useState(false);
  const [expandedHelpId, setExpandedHelpId] = useState<string | null>(null);

  React.useEffect(() => {
    const existingIds = new Set(settings.indicators.map((i) => i.id));
    DEFAULT_INDICATORS.forEach((ind) => {
      if (!existingIds.has(ind.id)) {
        addIndicator(ind);
      }
    });
  }, []);

  const handleSave = useCallback(() => {
    const interval = parseInt(scanInterval, 10);
    const threshold = parseFloat(volumeThreshold);
    const margin = parseFloat(marginAmount);

    if (isNaN(interval) || interval < 10) {
      Alert.alert('خطا', 'بازه اسکن باید حداقل ۱۰ ثانیه باشد');
      return;
    }
    if (isNaN(threshold) || threshold < 1) {
      Alert.alert('خطا', 'آستانه حجم باید حداقل ۱ باشد');
      return;
    }
    if (isNaN(margin) || margin <= 0) {
      Alert.alert('خطا', 'حجم مارجین باید بیشتر از صفر باشد');
      return;
    }

    updateSettings({
      apiKey: apiKey.trim(),
      apiSecret: apiSecret.trim(),
      scanInterval: interval,
      volumeThreshold: threshold,
      scannerNotifications,
      whaleNotifications,
      memeShortNotifications,
      preListingNotifications,
      tradeAiNotifications,
      gainzAlgoNotifications: gainzNotifications,
      marginAmount: margin,
      leverage,
      riskRewardRatio: parseFloat(riskRewardRatio),
      useCustomCoinsOnly,
      customCoins,
      refreshInterval: parseFloat(refreshInterval) || 5,
      scanFilterMode,
      useVolumeOnlySignals,
      telegramBotToken: telegramBotToken.trim(),
      telegramChatId: telegramChatId.trim(),
      telegramEnabled,
    });

    Alert.alert('ذخیره شد', 'تنظیمات با موفقیت ذخیره شد. تمام بخش‌ها بروزرسانی می‌شوند.');
  }, [scanInterval, volumeThreshold, marginAmount, apiKey, apiSecret, scannerNotifications, whaleNotifications, memeShortNotifications, preListingNotifications, tradeAiNotifications, gainzNotifications, selectedExchange, leverage, riskRewardRatio, useCustomCoinsOnly, customCoins, refreshInterval, scanFilterMode, useVolumeOnlySignals, telegramBotToken, telegramChatId, telegramEnabled, updateSettings]);

  const selectedExchangeInfo = EXCHANGES[selectedExchange];

  const exchangeOptions = useMemo(
    () => EXCHANGE_LIST.map((ex) => ({ key: ex.id, label: ex.name })),
    []
  );

  const leverageOptions = useMemo(
    () => LEVERAGE_OPTIONS.map((l) => ({ key: String(l), label: `${l}x` })),
    []
  );

  const rrOptions = useMemo(
    () => RISK_REWARD_OPTIONS.map((r) => ({ key: r, label: `1:${r}` })),
    []
  );

  const timeframeOptions = useMemo(
    () => TIMEFRAME_OPTIONS.map((t) => ({ key: t.value, label: t.label })),
    []
  );

  const handleIndicatorCodeChange = useCallback((code: string) => {
    setIndicatorCode(code);
    if (!indicatorName.trim() || editingIndicator === null) {
      const autoName = extractIndicatorName(code);
      if (autoName) {
        setIndicatorName(autoName);
      }
    }
  }, [indicatorName, editingIndicator]);

  const handleAddIndicator = useCallback(() => {
    if (!indicatorCode.trim()) {
      Alert.alert('خطا', 'کد اندیکاتور را وارد کنید');
      return;
    }

    const finalName = indicatorName.trim() || extractIndicatorName(indicatorCode) || `اندیکاتور ${settings.indicators.length + 1}`;

    if (editingIndicator) {
      updateIndicator({
        ...editingIndicator,
        name: finalName,
        code: indicatorCode.trim(),
        timeframe: indicatorTimeframe,
      });
    } else {
      const newIndicator: CustomIndicator = {
        id: `ind-${Date.now()}`,
        name: finalName,
        code: indicatorCode.trim(),
        timeframe: indicatorTimeframe,
        enabled: true,
        createdAt: Date.now(),
      };
      addIndicator(newIndicator);
    }

    setIndicatorName('');
    setIndicatorCode('');
    setIndicatorTimeframe('1h');
    setEditingIndicator(null);
    setShowIndicatorForm(false);
  }, [indicatorName, indicatorCode, indicatorTimeframe, editingIndicator, addIndicator, updateIndicator, settings.indicators.length]);

  const handleEditIndicator = useCallback((indicator: CustomIndicator) => {
    setEditingIndicator(indicator);
    setIndicatorName(indicator.name);
    setIndicatorCode(indicator.code);
    setIndicatorTimeframe(indicator.timeframe);
    setShowIndicatorForm(true);
  }, []);

  const handleDeleteIndicator = useCallback(
    (id: string, name: string) => {
      Alert.alert('حذف اندیکاتور', `آیا از حذف "${name}" اطمینان دارید؟`, [
        { text: 'لغو', style: 'cancel' },
        { text: 'حذف', style: 'destructive', onPress: () => deleteIndicator(id) },
      ]);
    },
    [deleteIndicator]
  );

  const filteredCoins = useMemo(() => {
    if (!coinSearch.trim()) return POPULAR_COINS;
    return POPULAR_COINS.filter((c) =>
      c.toLowerCase().includes(coinSearch.toLowerCase())
    );
  }, [coinSearch]);

  const handleToggleCoin = useCallback((coin: string) => {
    setCustomCoins((prev) =>
      prev.includes(coin) ? prev.filter((c) => c !== coin) : [...prev, coin]
    );
  }, []);

  const handleRemoveCoin = useCallback((coin: string) => {
    setCustomCoins((prev) => prev.filter((c) => c !== coin));
  }, []);

  const hasActiveIndicators = settings.indicators.some(
    (i) => i.enabled && settings.selectedIndicatorIds.includes(i.id)
  );

  const cancelIndicatorForm = useCallback(() => {
    setShowIndicatorForm(false);
    setEditingIndicator(null);
    setIndicatorName('');
    setIndicatorCode('');
    setIndicatorTimeframe('1h');
  }, []);

  const closeCoinPicker = useCallback(() => {
    setShowCoinPicker(false);
    setCoinSearch('');
  }, []);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionIcon}>🏦</Text>
          <Text style={styles.sectionTitle}>انتخاب صرافی</Text>
        </View>
        <DropdownPicker
          label="انتخاب صرافی"
          value={selectedExchange}
          options={exchangeOptions}
          onSelect={(key) => setSelectedExchange(key as ExchangeId)}
          testID="exchange-dropdown"
        />
        <View style={styles.feeInfoBox}>
          <Text style={styles.feeInfoTitle}>کارمزد فیوچرز {selectedExchangeInfo.name}</Text>
          <View style={styles.feeRow}>
            <View style={styles.feeItem}>
              <Text style={styles.feeLabel}>Maker</Text>
              <Text style={styles.feeValue}>{(selectedExchangeInfo.makerFee * 100).toFixed(2)}%</Text>
            </View>
            <View style={styles.feeDivider} />
            <View style={styles.feeItem}>
              <Text style={styles.feeLabel}>Taker</Text>
              <Text style={styles.feeValue}>{(selectedExchangeInfo.takerFee * 100).toFixed(2)}%</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionIcon}>🔑</Text>
          <Text style={styles.sectionTitle}>کلید API {selectedExchangeInfo.name}</Text>
        </View>
        <View style={styles.infoBox}>
          <Text style={styles.infoIcon}>ℹ️</Text>
          <Text style={styles.infoText}>
            کلید API اختیاری است. بدون آن هم اسکنر با API عمومی کار می‌کند.
          </Text>
        </View>
        <Text style={styles.inputLabel}>API Key</Text>
        <TextInput
          style={styles.input}
          value={apiKey}
          onChangeText={setApiKey}
          placeholder="کلید API خود را وارد کنید"
          placeholderTextColor={colors.dark.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          testID="api-key-input"
        />
        <Text style={styles.inputLabel}>API Secret</Text>
        <TextInput
          style={styles.input}
          value={apiSecret}
          onChangeText={setApiSecret}
          placeholder="کلید Secret خود را وارد کنید"
          placeholderTextColor={colors.dark.textMuted}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          testID="api-secret-input"
        />
        <Pressable
          style={({ pressed }) => [styles.saveApiBtn, pressed && { opacity: 0.8 }]}
          onPress={() => {
            updateSettings({ apiKey: apiKey.trim(), apiSecret: apiSecret.trim(), exchange: selectedExchange });
            Alert.alert('ذخیره شد', `کلید API برای ${selectedExchangeInfo.name} ذخیره شد`);
          }}
        >
          <Save size={14} color={colors.dark.background} />
          <Text style={styles.saveApiBtnText}>ذخیره API</Text>
        </Pressable>
      </View>

      {/* ── ظاهر برنامه (تم دارک/روشن) ─────────────────── */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionIcon}>{themeMode === 'light' ? '☀️' : '🌙'}</Text>
          <Text style={styles.sectionTitle}>ظاهر برنامه</Text>
        </View>
        <View style={styles.themeRow}>
          <Pressable
            style={({ pressed }) => [
              styles.themeOption,
              themeMode === 'light' && styles.themeOptionActive,
              pressed && { opacity: 0.85 },
            ]}
            onPress={() => setAppThemeMode('light')}
            testID="theme-light-btn"
          >
            <Sun size={18} color={themeMode === 'light' ? colors.dark.background : colors.dark.textSecondary} />
            <Text
              style={[
                styles.themeOptionText,
                themeMode === 'light' && styles.themeOptionTextActive,
              ]}
            >
              روشن
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.themeOption,
              themeMode === 'dark' && styles.themeOptionActive,
              pressed && { opacity: 0.85 },
            ]}
            onPress={() => setAppThemeMode('dark')}
            testID="theme-dark-btn"
          >
            <Moon size={18} color={themeMode === 'dark' ? colors.dark.background : colors.dark.textSecondary} />
            <Text
              style={[
                styles.themeOptionText,
                themeMode === 'dark' && styles.themeOptionTextActive,
              ]}
            >
              تیره
            </Text>
          </Pressable>
        </View>
        <Text style={styles.hintText}>
          تم انتخابی بلافاصله روی کل برنامه اعمال و ذخیره می‌شود.
        </Text>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionIcon}>💵</Text>
          <Text style={styles.sectionTitle}>تنظیمات معامله</Text>
        </View>
        <Text style={styles.inputLabel}>حجم مارجین ورودی (USDT)</Text>
        <TextInput
          style={styles.input}
          value={marginAmount}
          onChangeText={setMarginAmount}
          placeholder="100"
          placeholderTextColor={colors.dark.textMuted}
          keyboardType="decimal-pad"
          testID="margin-input"
        />
        <Text style={styles.inputLabel}>اهرم (Leverage)</Text>
        <DropdownPicker
          label="انتخاب اهرم"
          value={String(leverage)}
          options={leverageOptions}
          onSelect={(key) => setLeverage(parseInt(key, 10))}
          testID="leverage-dropdown"
        />
        <View style={styles.spacer} />
        <Text style={styles.inputLabel}>نسبت ریسک به ریوارد (R:R)</Text>
        <DropdownPicker
          label="نسبت ریسک به ریوارد"
          value={riskRewardRatio}
          options={rrOptions}
          onSelect={setRiskRewardRatio}
          testID="rr-dropdown"
        />
        <View style={styles.tradePreview}>
          <Text style={styles.tradePreviewTitle}>پیش‌نمایش معامله</Text>
          <View style={styles.tradePreviewRow}>
            <Text style={styles.tradePreviewLabel}>حجم کل پوزیشن:</Text>
            <Text style={styles.tradePreviewValue}>
              ${(parseFloat(marginAmount || '0') * leverage).toLocaleString()} USDT
            </Text>
          </View>
          <View style={styles.tradePreviewRow}>
            <Text style={styles.tradePreviewLabel}>کارمزد ورود (Taker):</Text>
            <Text style={styles.tradePreviewValue}>
              ${((parseFloat(marginAmount || '0') * leverage) * selectedExchangeInfo.takerFee).toFixed(2)} USDT
            </Text>
          </View>
          <View style={styles.tradePreviewRow}>
            <Text style={styles.tradePreviewLabel}>کارمزد رفت و برگشت:</Text>
            <Text style={[styles.tradePreviewValue, styles.orangeText]}>
              ${((parseFloat(marginAmount || '0') * leverage) * selectedExchangeInfo.takerFee * 2).toFixed(2)} USDT
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionIcon}>📊</Text>
          <Text style={styles.sectionTitle}>اندیکاتورها</Text>
        </View>

        <View style={styles.switchRow}>
          <Switch
            value={useVolumeOnlySignals}
            onValueChange={setUseVolumeOnlySignals}
            trackColor={{ false: colors.dark.surfaceLight, true: colors.dark.orange + '66' }}
            thumbColor={useVolumeOnlySignals ? colors.dark.orange : colors.dark.textMuted}
            testID="volume-only-switch"
          />
          <Text style={styles.switchLabel}>فقط بر اساس حجم معاملات (بدون تحلیل پیشرفته)</Text>
        </View>

        {useVolumeOnlySignals && (
          <View style={{ marginTop: 12 }}>
            <Text style={styles.inputLabel}>آستانه نسبت حجم (برابر)</Text>
            <TextInput
              style={styles.input}
              value={volumeThreshold}
              onChangeText={setVolumeThreshold}
              placeholder="2.0"
              placeholderTextColor={colors.dark.textMuted}
              keyboardType="decimal-pad"
              testID="volume-threshold-input"
            />
            <Text style={styles.hintText}>
              هرچه عدد بالاتر باشد، سیگنال‌های کمتر اما دقیق‌تری دریافت می‌کنید
            </Text>
          </View>
        )}

        {!useVolumeOnlySignals && (
          <View style={styles.confluenceInfoBox}>
            <Text style={styles.confluenceInfoTitle}>📊 تحلیل Confluence پیشرفته فعال</Text>
            <Text style={styles.confluenceInfoText}>
              سیگنال‌ها بر اساس ترکیب چندلایه تحلیل می‌شوند:{"\n"}
              • تکنیکال (۴۰٪): RSI, MACD, EMA, BB, ADX, StochRSI, OBV, Ichimoku{"\n"}
              • آنچین (۲۵٪): حجم/مارکت‌کپ, تغییرات قیمت{"\n"}
              • سنتیمنت (۱۵٪): Fear & Greed Index{"\n"}
              • مشتقات (۱۰٪): Funding Rate, L/S Ratio{"\n"}
              • چند تایم‌فریم (۱۰٪): ۱۵m, ۱h, ۴h
            </Text>
          </View>
        )}

        <View style={styles.spacer} />

        {settings.indicators.length > 0 && (
          <View style={styles.indicatorList}>
            {settings.indicators.map((ind) => {
              const isSelected = settings.selectedIndicatorIds.includes(ind.id);
              const isDefault = ind.id.startsWith('default-');
              return (
                <View key={ind.id} style={[styles.indicatorItem, isSelected && styles.indicatorItemSelected]}>
                  <Pressable
                    style={styles.indicatorToggle}
                    onPress={() => toggleIndicatorSelection(ind.id)}
                    testID={`indicator-toggle-${ind.id}`}
                  >
                    <View style={[styles.toggleTrack, isSelected && styles.toggleTrackActive]}>
                      <View style={[styles.toggleDot, isSelected && styles.toggleDotActive]} />
                    </View>
                  </Pressable>
                  <View style={styles.indicatorInfo}>
                    <Text style={styles.indicatorName}>
                      {ind.name}
                      {isDefault ? ' (پیش‌فرض)' : ''}
                    </Text>
                    <Text style={styles.indicatorMeta}>
                      تایم‌فریم: {TIMEFRAME_OPTIONS.find((t) => t.value === ind.timeframe)?.label ?? ind.timeframe}
                    </Text>
                  </View>
                  <View style={styles.indicatorActions}>
                    <Pressable
                      style={styles.indicatorActionBtn}
                      onPress={() => handleEditIndicator(ind)}
                      testID={`indicator-edit-${ind.id}`}
                    >
                      <Pencil size={14} color={colors.dark.blue} />
                    </Pressable>
                    <Pressable
                      style={styles.indicatorActionBtn}
                      onPress={() => handleDeleteIndicator(ind.id, ind.name)}
                      testID={`indicator-delete-${ind.id}`}
                    >
                      <Trash2 size={14} color={colors.dark.red} />
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {showIndicatorForm ? (
          <View style={styles.indicatorFormBox}>
            <Text style={styles.indicatorFormTitle}>
              {editingIndicator ? 'ویرایش اندیکاتور' : 'افزودن اندیکاتور جدید'}
            </Text>
            <Text style={styles.inputLabel}>کد اندیکاتور (Pine Script / متن سیگنال)</Text>
            <TextInput
              style={[styles.input, styles.codeInput]}
              value={indicatorCode}
              onChangeText={handleIndicatorCodeChange}
              placeholder="کد اندیکاتور خود را اینجا وارد کنید..."
              placeholderTextColor={colors.dark.textMuted}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              testID="indicator-code-input"
            />
            <Text style={styles.inputLabel}>نام اندیکاتور (از کد استخراج می‌شود)</Text>
            <TextInput
              style={styles.input}
              value={indicatorName}
              onChangeText={setIndicatorName}
              placeholder="نام خودکار از کد پر می‌شود"
              placeholderTextColor={colors.dark.textMuted}
              testID="indicator-name-input"
            />
            <Text style={styles.inputLabel}>تایم‌فریم</Text>
            <DropdownPicker
              label="انتخاب تایم‌فریم"
              value={indicatorTimeframe}
              options={timeframeOptions}
              onSelect={setIndicatorTimeframe}
              testID="indicator-timeframe-dropdown"
            />
            <View style={styles.spacer} />
            <View style={styles.indicatorFormActions}>
              <Pressable
                style={[styles.indicatorFormBtn, styles.indicatorFormBtnSave]}
                onPress={handleAddIndicator}
              >
                <Check size={16} color={colors.dark.background} />
                <Text style={styles.indicatorFormBtnSaveText}>
                  {editingIndicator ? 'ذخیره تغییرات' : 'افزودن'}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.indicatorFormBtn, styles.indicatorFormBtnCancel]}
                onPress={cancelIndicatorForm}
              >
                <X size={16} color={colors.dark.textSecondary} />
                <Text style={styles.indicatorFormBtnCancelText}>لغو</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            style={styles.addIndicatorBtn}
            onPress={() => setShowIndicatorForm(true)}
            testID="add-indicator-button"
          >
            <Plus size={16} color={colors.dark.accent} />
            <Text style={styles.addIndicatorBtnText}>افزودن اندیکاتور</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionIcon}>🪙</Text>
          <Text style={styles.sectionTitle}>انتخاب ارز‌های خاص</Text>
        </View>
        <View style={styles.switchRow}>
          <Switch
            value={useCustomCoinsOnly}
            onValueChange={setUseCustomCoinsOnly}
            trackColor={{ false: colors.dark.surfaceLight, true: colors.dark.accent + '66' }}
            thumbColor={useCustomCoinsOnly ? colors.dark.accent : colors.dark.textMuted}
            testID="custom-coins-switch"
          />
          <Text style={styles.switchLabel}>فقط ارز‌های انتخابی را بررسی کن</Text>
        </View>

        {useCustomCoinsOnly && (
          <>
            {customCoins.length > 0 && (
              <View style={styles.selectedCoinsContainer}>
                {customCoins.map((coin) => (
                  <Pressable key={coin} style={styles.selectedCoinChip} onPress={() => handleRemoveCoin(coin)}>
                    <Text style={styles.selectedCoinText}>{coin}</Text>
                    <X size={12} color={colors.dark.accent} />
                  </Pressable>
                ))}
              </View>
            )}
            <Pressable
              style={styles.addCoinBtn}
              onPress={() => setShowCoinPicker(true)}
              testID="add-coin-button"
            >
              <Plus size={16} color={colors.dark.orange} />
              <Text style={styles.addCoinBtnText}>انتخاب ارز</Text>
            </Pressable>
          </>
        )}

        {useCustomCoinsOnly && customCoins.length === 0 && (
          <View style={styles.infoBox}>
            <Text style={styles.infoIcon}>ℹ️</Text>
            <Text style={[styles.infoText, styles.orangeText]}>
              هنوز ارزی انتخاب نشده. ارز‌های مورد نظر را اضافه کنید.
            </Text>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionIcon}>🔍</Text>
          <Text style={styles.sectionTitle}>فیلتر اسکنر</Text>
        </View>
        <Text style={styles.inputLabel}>بررسی فقط این دسته از ارزها</Text>
        <DropdownPicker
          label="فیلتر اسکنر"
          value={scanFilterMode}
          options={SCAN_FILTER_OPTIONS}
          onSelect={(key) => setScanFilterMode(key as typeof scanFilterMode)}
          testID="scan-filter-dropdown"
        />
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionIcon}>⏱️</Text>
          <Text style={styles.sectionTitle}>تنظیمات بروزرسانی</Text>
        </View>
        <Text style={styles.inputLabel}>بازه اسکن خودکار (ثانیه)</Text>
        <TextInput
          style={styles.input}
          value={scanInterval}
          onChangeText={setScanInterval}
          placeholder="60"
          placeholderTextColor={colors.dark.textMuted}
          keyboardType="numeric"
          testID="scan-interval-input"
        />
        <Text style={styles.inputLabel}>بازه بروزرسانی خودکار (دقیقه)</Text>
        <DropdownPicker
          label="بازه بروزرسانی"
          value={refreshInterval}
          options={REFRESH_INTERVAL_OPTIONS}
          onSelect={setRefreshInterval}
          testID="refresh-interval-dropdown"
        />
        <Text style={styles.hintText}>
          تمام بخش‌ها (اسکنر، نهنگ‌ها، کیف پول) با بازه انتخابی بروزرسانی می‌شوند
        </Text>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionIcon}>🔔</Text>
          <Text style={styles.sectionTitle}>اعلان‌ها</Text>
        </View>
        <View style={styles.switchRow}>
          <Switch
            value={scannerNotifications}
            onValueChange={setScannerNotifications}
            trackColor={{ false: colors.dark.surfaceLight, true: colors.dark.accent + '66' }}
            thumbColor={scannerNotifications ? colors.dark.accent : colors.dark.textMuted}
            testID="scanner-notifications-switch"
          />
          <Text style={styles.switchLabel}>اعلان اسکنر (سیگنال‌های جدید)</Text>
        </View>
        <View style={[styles.switchRow, { marginTop: 12 }]}>
          <Switch
            value={whaleNotifications}
            onValueChange={setWhaleNotifications}
            trackColor={{ false: colors.dark.surfaceLight, true: colors.dark.accent + '66' }}
            thumbColor={whaleNotifications ? colors.dark.accent : colors.dark.textMuted}
            testID="whale-notifications-switch"
          />
          <Text style={styles.switchLabel}>اعلان نهنگ‌ها (خرید/فروش نهنگ‌های ردیابی شده)</Text>
        </View>
        <View style={[styles.switchRow, { marginTop: 12 }]}>
          <Switch
            value={memeShortNotifications}
            onValueChange={setMemeShortNotifications}
            trackColor={{ false: colors.dark.surfaceLight, true: colors.dark.red + '66' }}
            thumbColor={memeShortNotifications ? colors.dark.red : colors.dark.textMuted}
          />
          <Text style={styles.switchLabel}>اعلان اسکنر شورت میم‌کوین</Text>
        </View>
        <View style={[styles.switchRow, { marginTop: 12 }]}>
          <Switch
            value={preListingNotifications}
            onValueChange={setPreListingNotifications}
            trackColor={{ false: colors.dark.surfaceLight, true: colors.dark.green + '66' }}
            thumbColor={preListingNotifications ? colors.dark.green : colors.dark.textMuted}
          />
          <Text style={styles.switchLabel}>اعلان اسکنر قبل لیست شدن</Text>
        </View>
        <View style={[styles.switchRow, { marginTop: 12 }]}>
          <Switch
            value={tradeAiNotifications}
            onValueChange={setTradeAiNotifications}
            trackColor={{ false: colors.dark.surfaceLight, true: colors.dark.blue + '66' }}
            thumbColor={tradeAiNotifications ? colors.dark.blue : colors.dark.textMuted}
          />
          <Text style={styles.switchLabel}>اعلان ترید با هوش مصنوعی</Text>
        </View>
        <View style={[styles.switchRow, { marginTop: 12 }]}>
          <Switch
            value={gainzNotifications}
            onValueChange={setGainzNotifications}
            trackColor={{ false: colors.dark.surfaceLight, true: colors.dark.blue + '66' }}
            thumbColor={gainzNotifications ? colors.dark.blue : colors.dark.textMuted}
            testID="gainz-notifications-switch"
          />
          <Text style={styles.switchLabel}>اعلان اندیکاتورها (GainzAlgo Pro و اندیکاتور من)</Text>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionIcon}>🤖</Text>
          <Text style={styles.sectionTitle}>ربات تلگرام</Text>
        </View>
        <View style={styles.infoBox}>
          <Text style={styles.infoIcon}>ℹ️</Text>
          <Text style={styles.infoText}>
            با اتصال ربات تلگرام، تمام اعلان‌ها و سیگنال‌ها حتی وقتی برنامه بسته است به تلگرام شما ارسال می‌شود. همچنین می‌توانید از داخل ربات تمام بخش‌ها را مدیریت کنید.
          </Text>
        </View>
        <View style={styles.switchRow}>
          <Switch
            value={telegramEnabled}
            onValueChange={setTelegramEnabled}
            trackColor={{ false: colors.dark.surfaceLight, true: '#0088cc66' }}
            thumbColor={telegramEnabled ? '#0088cc' : colors.dark.textMuted}
            testID="telegram-enabled-switch"
          />
          <Text style={styles.switchLabel}>فعال‌سازی ربات تلگرام</Text>
        </View>
        {telegramEnabled && (
          <View style={{ marginTop: 12 }}>
            <Text style={styles.inputLabel}>توکن ربات تلگرام (Bot Token)</Text>
            <TextInput
              style={styles.input}
              value={telegramBotToken}
              onChangeText={setTelegramBotToken}
              placeholder="مثال: 123456:ABC-DEF1234ghIkl-zyx57W2v..."
              placeholderTextColor={colors.dark.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              testID="telegram-bot-token-input"
            />
            <Text style={styles.inputLabel}>شناسه چت تلگرام (Chat ID)</Text>
            <TextInput
              style={styles.input}
              value={telegramChatId}
              onChangeText={setTelegramChatId}
              placeholder="مثال: 123456789"
              placeholderTextColor={colors.dark.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numeric"
              testID="telegram-chat-id-input"
            />
            <Pressable
              style={({ pressed }) => [styles.testTelegramBtn, pressed && { opacity: 0.8 }]}
              onPress={() => {
                if (!telegramBotToken.trim() || !telegramChatId.trim()) {
                  Alert.alert('خطا', 'لطفاً توکن ربات و شناسه چت را وارد کنید');
                  return;
                }
                const token = telegramBotToken.trim();
                const chatId = telegramChatId.trim();
                const updatedSettings = {
                  ...settings,
                  telegramBotToken: token,
                  telegramChatId: chatId,
                  telegramEnabled: true,
                };
                AsyncStorage.setItem('@crypto_scanner_settings', JSON.stringify(updatedSettings))
                  .then(() => {
                    updateSettings({
                      telegramBotToken: token,
                      telegramChatId: chatId,
                      telegramEnabled: true,
                    });
                    setTelegramEnabled(true);
                    return sendTelegramWelcome();
                  })
                  .then(() => {
                    startTelegramPolling();
                    Alert.alert('موفق', 'ربات تلگرام فعال شد!\n\nدستورات زیر در ربات فعال هستند:\n/status /signals /positions /balance /scanner /meme /whale /help\n\nاعلان‌ها به صورت خودکار ارسال می‌شوند.');
                  })
                  .catch(() => {
                    Alert.alert('خطا', 'خطا در اتصال به سرور تلگرام');
                  });
              }}
            >
              <Send size={14} color="#FFF" />
              <Text style={styles.testTelegramBtnText}>ارسال پیام تست</Text>
            </Pressable>
            <View style={styles.telegramHelpBox}>
              <Bot size={14} color="#0088cc" />
              <Text style={styles.telegramHelpText}>
                ۱. در تلگرام @BotFather را باز کنید{"\n"}
                ۲. /newbot بزنید و نام ربات را انتخاب کنید{"\n"}
                ۳. توکن دریافتی را در فیلد بالا وارد کنید{"\n"}
                ۴. برای Chat ID، ربات @userinfobot را باز کنید و /start بزنید
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* ----- Scanner server (Railway) ----- */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Globe size={16} color="#0088cc" />
          <Text style={styles.sectionTitle}>سرور اسکنر (اعلان با برنامه بسته)</Text>
        </View>
        <Text style={styles.telegramHelpText}>
          آدرس پیش‌فرض سرور (پومپای روی ریلوی) از قبل داخل برنامه قرار داده شده و همین فیلد به‌صورت خودکار پر شده است. فقط اگر نسخه شخصی خودتان را جداگانه دیپلوی کرده‌اید، آدرس خودتان را جایگزین کنید تا اسکن ساعتی/۴ساعته/روزانه حتی با برنامه بسته اجرا شود و سیگنال‌ها به تلگرام و نوتیفیکیشن گوشی برسند.
        </Text>
        <TextInput
          style={styles.input}
          value={serverUrlInput}
          onChangeText={setServerUrlInput}
          placeholder="https://pompay-production.up.railway.app"
          placeholderTextColor={colors.dark.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Pressable
          style={({ pressed }) => [styles.testTelegramBtn, pressed && { opacity: 0.8 }]}
          disabled={serverBusy}
          onPress={async () => {
            if (!serverUrlInput.trim()) {
              Alert.alert('خطا', 'آدرس سرور را وارد کنید');
              return;
            }
            setServerBusy(true);
            setServerStatus('⏳ در حال تست اتصال...');
            try {
              const r = await testServerUrl(serverUrlInput.trim());
              if (r.ok) {
                await setServerUrl(serverUrlInput.trim());
                setServerStatus(`✅ متصل شد (${r.latencyMs}ms${r.version ? ` • ${r.version}` : ''})`);
              } else {
                // v1.4.5: show the exact Persian reason (502 = server down,
                // 404 = wrong address, timeout = network) instead of a generic fail.
                setServerStatus(
                  `❌ ${r.reason ?? `سرور پاسخ نداد (${r.latencyMs}ms)`}`
                );
              }
            } catch {
              setServerStatus('❌ خطا در اتصال');
            }
            setServerBusy(false);
          }}
        >
          <Send size={14} color="#FFF" />
          <Text style={styles.testTelegramBtnText}>تست و ذخیره آدرس سرور</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.testTelegramBtn, pressed && { opacity: 0.8 }]}
          disabled={serverBusy}
          onPress={async () => {
            setServerBusy(true);
            try {
              const ok = await syncScanConfig({
                botToken: (settings.telegramBotToken || '').trim(),
                chatId: (settings.telegramChatId || '').trim(),
                gainzAlgoEnabled: settings.gainzAlgoNotifications !== false,
                gainzTimeframes: settings.gainzTimeframes ?? ['1h', '4h', '1d'],
                hookEnabled: settings.hookReversalNotifications !== false,
                hookTimeframes: settings.hookTimeframes ?? ['4h', '1d'],
              });
              setServerStatus(ok ? '✅ پیکربندی اسکنر روی سرور همگام شد' : '❌ همگام‌سازی ناموفق (آدرس/توکن را چک کنید)');
            } finally {
              setServerBusy(false);
            }
          }}
        >
          <Bot size={14} color="#FFF" />
          <Text style={styles.testTelegramBtnText}>همگام‌سازی پیکربندی اسکنر</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.testTelegramBtn, pressed && { opacity: 0.8 }]}
          disabled={serverBusy}
          onPress={async () => {
            setServerBusy(true);
            try {
              // اول پیکربندی (توکن/چت‌آیدی) با سرور همگام شود بعد تست ارسال شود
              await syncScanConfig({
                botToken: (settings.telegramBotToken || '').trim(),
                chatId: (settings.telegramChatId || '').trim(),
                gainzAlgoEnabled: settings.gainzAlgoNotifications !== false,
                gainzTimeframes: settings.gainzTimeframes ?? ['1h', '4h', '1d'],
                hookEnabled: settings.hookReversalNotifications !== false,
                hookTimeframes: settings.hookTimeframes ?? ['4h', '1d'],
              });
              const r = await sendServerTelegramTest();
              setServerStatus(
                r.ok
                  ? `✅ سرور پیام تست تلگرام را فرستاد — چک کنید ${r.detail ? `(${r.detail})` : ''}`
                  : `❌ ${r.detail ?? 'ارسال تست از سرور ناموفق بود'}`
              );
            } finally {
              setServerBusy(false);
            }
          }}
        >
          <Send size={14} color="#FFF" />
          <Text style={styles.testTelegramBtnText}>تست ارسال تلگرام از سرور</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.testTelegramBtn, pressed && { opacity: 0.8 }]}
          disabled={serverBusy}
          onPress={async () => {
            setServerBusy(true);
            try {
              const r = await registerPushOnServer();
              setServerStatus(
                r.ok
                  ? '✅ نوتیفیکیشن بومی ثبت شد'
                  : `⚠️ ثبت پوش ناموفق: ${r.error ?? 'دلیل نامشخص'} — تلگرام همچنان فعال است`
              );
            } finally {
              setServerBusy(false);
            }
          }}
        >
          <MessageCircle size={14} color="#FFF" />
          <Text style={styles.testTelegramBtnText}>ثبت نوتیفیکیشن گوشی</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.testTelegramBtn, pressed && { opacity: 0.8 }]}
          disabled={serverBusy}
          onPress={async () => {
            setServerBusy(true);
            try {
              const ok = await sendTestLocalNotification();
              setServerStatus(
                ok
                  ? '✅ نوتیف تست ارسال شد — باید همین حالا روی گوشی ببینید'
                  : '❌ اجازه نوتیفیکیشن داده نشد (از تنظیمات گوشی فعال کنید)'
              );
            } finally {
              setServerBusy(false);
            }
          }}
        >
          <Bell size={14} color="#FFF" />
          <Text style={styles.testTelegramBtnText}>تست نمایش نوتیفیکیشن</Text>
        </Pressable>
        {serverStatus ? (
          <Text style={styles.telegramHelpText}>{serverStatus}</Text>
        ) : null}
      </View>

      {/* ── بروزرسانی برنامه ─────────────────────────────── */}
      <View style={[styles.section, updateInfo?.available && styles.updateSectionActive]}>
        <View style={styles.sectionHeader}>
          <Download size={18} color={colors.dark.accent} />
          <Text style={styles.sectionTitle}>بروزرسانی برنامه</Text>
        </View>

        <View style={styles.versionRow}>
          <Text style={styles.versionLabel}>نسخه نصب‌شده:</Text>
          <Text style={styles.versionValue}>{installedVersion}</Text>
          {updateInfo?.available ? (
            <BlinkingUpdateButton
              label={`بروزرسانی به ${updateInfo.latestVersion}`}
              onPress={() => openApkDownload(updateInfo.apkUrl).catch(() => {})}
            />
          ) : (
            <View style={styles.upToDateBadge}>
              <Check size={12} color={colors.dark.green} />
              <Text style={styles.upToDateText}>به‌روز</Text>
            </View>
          )}
        </View>

        {updateInfo?.available && updateInfo.notes ? (
          <Text style={styles.updateNotes}>📝 {updateInfo.notes}</Text>
        ) : null}

        <Text style={styles.telegramHelpText}>
          بررسی نسخه به‌صورت خودکار از گیت‌هاب انجام می‌شود؛ با انتشار نسخه جدید، بنر بالای برنامه ظاهر می‌شود و با زدن دکمه بروزرسانی، فایل APK جدید مستقیماً روی همین نسخه نصب می‌شود (بدون حذف نسخه قبلی).
        </Text>
        <View style={styles.updateButtonsRow}>
          <Pressable
            style={({ pressed }) => [styles.testTelegramBtn, { flex: 1 }, pressed && { opacity: 0.8 }]}
            disabled={updateBusy}
            onPress={async () => {
              setUpdateBusy(true);
              setUpdateStatus('⏳ در حال بررسی نسخه (سرور برنامه → CDN → گیت‌هاب)...');
              const r = await fetchUpdateInfo();
              if (r) {
                if (r.available) {
                  setUpdateStatus(`✅ نسخه جدید ${r.latestVersion} موجود است — دکمه بروزرسانی فعال شد${r.source ? ` (بررسی از ${r.source})` : ''}`);
                } else {
                  setUpdateStatus(`✅ برنامه شما به‌روز است${r.source ? ` (بررسی از ${r.source})` : ''}`);
                }
              } else {
                setUpdateStatus('❌ هیچ‌کدام از مسیرهای بررسی (سرور برنامه، CDN و گیت‌هاب) پاسخ ندادند — اینترنت گوشی را چک کنید و دوباره بزنید');
              }
              setUpdateBusy(false);
            }}
          >
            <RefreshCw size={14} color="#FFF" />
            <Text style={styles.testTelegramBtnText}>بررسی نسخه جدید</Text>
          </Pressable>
        </View>
        {updateStatus ? (
          <Text style={styles.telegramHelpText}>{updateStatus}</Text>
        ) : null}
      </View>

      <Pressable
        style={({ pressed }) => [styles.saveButton, pressed && styles.saveButtonPressed]}
        onPress={handleSave}
        testID="save-settings-button"
      >
        <Save size={18} color={colors.dark.background} />
        <Text style={styles.saveButtonText}>ذخیره تنظیمات</Text>
      </Pressable>

      <View style={styles.section}>
        <Pressable style={styles.sectionHeader} onPress={() => setShowHelp(!showHelp)}>
          <Text style={styles.sectionIcon}>📖</Text>
          <Text style={[styles.sectionTitle, { flex: 1 }]}>راهنمای کامل برنامه</Text>
          {showHelp ? <ChevronUp size={18} color={colors.dark.textMuted} /> : <ChevronDown size={18} color={colors.dark.textMuted} />}
        </Pressable>
        {showHelp && (
          <View style={styles.helpContainer}>
            {HELP_SECTIONS.map((section) => (
              <View key={section.id} style={styles.helpItem}>
                <Pressable
                  style={styles.helpItemHeader}
                  onPress={() => setExpandedHelpId(expandedHelpId === section.id ? null : section.id)}
                >
                  <Text style={styles.helpItemTitle}>{section.title}</Text>
                  {expandedHelpId === section.id ? (
                    <ChevronUp size={14} color={colors.dark.textMuted} />
                  ) : (
                    <ChevronDown size={14} color={colors.dark.textMuted} />
                  )}
                </Pressable>
                {expandedHelpId === section.id && (
                  <Text style={styles.helpItemContent}>{section.content}</Text>
                )}
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={styles.disclaimer}>
        <Text style={styles.disclaimerText}>
          ⚠️ این ابزار صرفاً جهت تحلیل بازار است و سیگنال مالی نیست. مسئولیت معاملات بر عهده خودتان است.
        </Text>
      </View>

      <Pressable
        style={styles.brandingSection}
        onPress={() => {
          if (Platform.OS !== 'web') {
            Linking.openURL('https://www.instagram.com/trade_master65/');
          } else {
            window.open('https://www.instagram.com/trade_master65/', '_blank');
          }
        }}
      >
        <View style={styles.brandingRow}>
          <Image
            source={require('@/assets/images/designer-profile.png')}
            style={styles.brandingAvatarImg}
            resizeMode="cover"
          />
          <View style={styles.brandingInfo}>
            <Text style={styles.brandingName}>trade_master65</Text>
            <Text style={styles.brandingRole}>طراح برنامه</Text>
          </View>
          <InstagramPulse />
        </View>
      </Pressable>

      <Modal visible={showCoinPicker} transparent animationType="slide">
        <View style={styles.coinPickerOverlay}>
          <View style={styles.coinPickerContainer}>
            <View style={styles.coinPickerHeader}>
              <Text style={styles.coinPickerTitle}>انتخاب ارز</Text>
              <Pressable onPress={closeCoinPicker} style={styles.coinPickerClose}>
                <X size={20} color={colors.dark.text} />
              </Pressable>
            </View>
            <View style={styles.coinSearchBox}>
              <Search size={16} color={colors.dark.textMuted} />
              <TextInput
                style={styles.coinSearchInput}
                value={coinSearch}
                onChangeText={setCoinSearch}
                placeholder="جستجوی ارز..."
                placeholderTextColor={colors.dark.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
                testID="coin-search-input"
              />
            </View>
            {customCoins.length > 0 && (
              <View style={styles.coinPickerSelected}>
                <Text style={styles.coinPickerSelectedTitle}>انتخاب شده ({customCoins.length})</Text>
                <View style={styles.coinPickerSelectedChips}>
                  {customCoins.map((coin) => (
                    <Pressable key={coin} style={styles.coinPickerSelectedChip} onPress={() => handleToggleCoin(coin)}>
                      <Text style={styles.coinPickerSelectedChipText}>{coin}</Text>
                      <X size={10} color={colors.dark.accent} />
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
            <FlatList
              data={filteredCoins}
              keyExtractor={(item) => item}
              numColumns={4}
              contentContainerStyle={styles.coinGrid}
              renderItem={({ item }) => {
                const isSelected = customCoins.includes(item);
                return (
                  <Pressable
                    style={[styles.coinGridItem, isSelected && styles.coinGridItemSelected]}
                    onPress={() => handleToggleCoin(item)}
                  >
                    <Text style={[styles.coinGridItemText, isSelected && styles.coinGridItemTextSelected]}>
                      {item}
                    </Text>
                    {isSelected && <Check size={10} color={colors.dark.accent} />}
                  </Pressable>
                );
              }}
            />
            <Pressable style={styles.coinPickerDone} onPress={closeCoinPicker}>
              <Text style={styles.coinPickerDoneText}>تایید ({customCoins.length} ارز)</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function InstagramPulse() {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.2, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  return (
    <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
      <Instagram size={24} color="#E4405F" />
    </Animated.View>
  );
}

/** Blinking (opacity-pulsing) button shown in Settings when an update exists. */
function BlinkingUpdateButton({ label, onPress }: { label: string; onPress: () => void }) {
  const blinkAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const blink = Animated.loop(
      Animated.sequence([
        Animated.timing(blinkAnim, { toValue: 0.25, duration: 550, useNativeDriver: true }),
        Animated.timing(blinkAnim, { toValue: 1, duration: 550, useNativeDriver: true }),
      ])
    );
    blink.start();
    return () => blink.stop();
  }, [blinkAnim]);

  return (
    <Animated.View style={{ opacity: blinkAnim }}>
      <Pressable
        style={({ pressed }) => [styles.updateBlinkBtn, pressed && { opacity: 0.7 }]}
        onPress={onPress}
        testID="settings-update-button"
      >
        <Download size={13} color="#0B0E11" />
        <Text style={styles.updateBlinkBtnText}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = createThemedStyles(() => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.background,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 40,
  },
  section: {
    backgroundColor: colors.dark.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  sectionIcon: {
    fontSize: 14,
  },
  themeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  themeOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.dark.inputBg,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  themeOptionActive: {
    backgroundColor: colors.dark.accent,
    borderColor: colors.dark.accent,
  },
  themeOptionText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: colors.dark.textSecondary,
  },
  themeOptionTextActive: {
    color: colors.dark.background,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: colors.dark.text,
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
  orangeText: {
    color: colors.dark.orange,
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
  codeInput: {
    minHeight: 120,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'left',
  },
  spacer: {
    height: 12,
  },
  hintText: {
    fontSize: 11,
    color: colors.dark.textMuted,
    textAlign: 'right',
    marginTop: -4,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  switchLabel: {
    fontSize: 14,
    color: colors.dark.text,
    flex: 1,
    textAlign: 'right',
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dark.accent,
    paddingVertical: 16,
    borderRadius: 14,
    gap: 8,
    marginBottom: 16,
  },
  saveButtonPressed: {
    opacity: 0.85,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: colors.dark.background,
  },
  saveApiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dark.blue,
    paddingVertical: 12,
    borderRadius: 10,
    gap: 6,
  },
  saveApiBtnText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: colors.dark.background,
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
  feeInfoBox: {
    backgroundColor: colors.dark.surfaceLight + '80',
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  feeInfoTitle: {
    fontSize: 12,
    color: colors.dark.textSecondary,
    textAlign: 'right',
    marginBottom: 10,
  },
  feeRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  feeItem: {
    alignItems: 'center',
    gap: 4,
  },
  feeDivider: {
    width: 1,
    height: 30,
    backgroundColor: colors.dark.border,
  },
  feeLabel: {
    fontSize: 11,
    color: colors.dark.textMuted,
  },
  feeValue: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: colors.dark.accent,
  },
  tradePreview: {
    backgroundColor: colors.dark.surfaceLight + '60',
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  tradePreviewTitle: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: colors.dark.textSecondary,
    textAlign: 'right',
    marginBottom: 10,
  },
  tradePreviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  tradePreviewLabel: {
    fontSize: 12,
    color: colors.dark.textMuted,
  },
  tradePreviewValue: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  indicatorList: {
    gap: 8,
    marginBottom: 14,
  },
  indicatorItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark.surfaceLight,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.dark.border,
    gap: 10,
  },
  indicatorItemSelected: {
    borderColor: colors.dark.green + '66',
    backgroundColor: colors.dark.greenDim,
  },
  indicatorToggle: {
    padding: 2,
  },
  toggleTrack: {
    width: 36,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.dark.surfaceLight,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleTrackActive: {
    backgroundColor: colors.dark.green + '44',
  },
  toggleDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.dark.textMuted,
  },
  toggleDotActive: {
    backgroundColor: colors.dark.green,
    alignSelf: 'flex-end' as const,
  },
  indicatorInfo: {
    flex: 1,
    gap: 2,
  },
  indicatorName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: colors.dark.text,
    textAlign: 'right',
  },
  indicatorMeta: {
    fontSize: 11,
    color: colors.dark.textMuted,
    textAlign: 'right',
  },
  indicatorActions: {
    flexDirection: 'row',
    gap: 8,
  },
  indicatorActionBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: colors.dark.surface,
  },
  addIndicatorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.dark.accent + '44',
    borderStyle: 'dashed',
    gap: 6,
  },
  addIndicatorBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.dark.accent,
  },
  indicatorFormBox: {
    backgroundColor: colors.dark.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.dark.blue + '44',
  },
  indicatorFormTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: colors.dark.blue,
    textAlign: 'right',
    marginBottom: 12,
  },
  indicatorFormActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  indicatorFormBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 6,
  },
  indicatorFormBtnSave: {
    backgroundColor: colors.dark.green,
  },
  indicatorFormBtnSaveText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: colors.dark.background,
  },
  indicatorFormBtnCancel: {
    backgroundColor: colors.dark.surfaceLight,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  indicatorFormBtnCancelText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: colors.dark.textSecondary,
  },
  selectedCoinsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
    marginBottom: 12,
  },
  selectedCoinChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark.accentDim,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.dark.accent + '44',
  },
  selectedCoinText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: colors.dark.accent,
  },
  addCoinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.dark.orange + '44',
    borderStyle: 'dashed',
    gap: 6,
    marginTop: 8,
  },
  addCoinBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.dark.orange,
  },
  coinPickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  coinPickerContainer: {
    backgroundColor: colors.dark.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 16,
    paddingBottom: 24,
    paddingHorizontal: 16,
    maxHeight: '80%',
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    borderBottomWidth: 0,
  },
  coinPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  coinPickerTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  coinPickerClose: {
    padding: 4,
  },
  coinSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark.inputBg,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.dark.border,
    gap: 8,
  },
  coinSearchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.dark.text,
  },
  coinPickerSelected: {
    marginBottom: 12,
  },
  coinPickerSelectedTitle: {
    fontSize: 12,
    color: colors.dark.textSecondary,
    marginBottom: 8,
    textAlign: 'right',
  },
  coinPickerSelectedChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  coinPickerSelectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark.accentDim,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  coinPickerSelectedChipText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: colors.dark.accent,
  },
  coinGrid: {
    paddingBottom: 8,
  },
  coinGridItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    margin: 3,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 10,
    backgroundColor: colors.dark.surfaceLight,
    borderWidth: 1,
    borderColor: colors.dark.border,
    gap: 3,
    minWidth: 70,
  },
  coinGridItemSelected: {
    backgroundColor: colors.dark.accentDim,
    borderColor: colors.dark.accent,
  },
  coinGridItemText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: colors.dark.textSecondary,
  },
  coinGridItemTextSelected: {
    color: colors.dark.accent,
    fontWeight: '700' as const,
  },
  coinPickerDone: {
    backgroundColor: colors.dark.accent,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  coinPickerDoneText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: colors.dark.background,
  },
  helpContainer: {
    gap: 6,
  },
  helpItem: {
    backgroundColor: colors.dark.surfaceLight,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.dark.border,
    overflow: 'hidden',
  },
  helpItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  helpItemTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: colors.dark.text,
    flex: 1,
    textAlign: 'right',
  },
  helpItemContent: {
    fontSize: 13,
    color: colors.dark.textSecondary,
    lineHeight: 24,
    textAlign: 'right',
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 0,
  },
  confluenceInfoBox: {
    backgroundColor: colors.dark.greenDim,
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.dark.green + '33',
  },
  confluenceInfoTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: colors.dark.green,
    marginBottom: 8,
    textAlign: 'right',
  },
  confluenceInfoText: {
    fontSize: 12,
    color: colors.dark.textSecondary,
    lineHeight: 22,
    textAlign: 'right',
    paddingTop: 0,
  },
  brandingSection: {
    backgroundColor: colors.dark.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E4405F33',
  },
  brandingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  brandingAvatarImg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#E4405F44',
  },
  testTelegramBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0088cc',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 6,
    marginBottom: 12,
  },
  testTelegramBtnText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  telegramHelpBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#0088cc12',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#0088cc33',
  },
  telegramHelpText: {
    fontSize: 11,
    color: '#0088cc',
    flex: 1,
    textAlign: 'right',
    lineHeight: 20,
  },
  brandingInfo: {
    flex: 1,
  },
  brandingName: {
    fontSize: 15,
    fontWeight: '800' as const,
    color: colors.dark.text,
  },
  brandingRole: {
    fontSize: 11,
    color: colors.dark.textSecondary,
    marginTop: 2,
  },
  // ── update section ──
  updateSectionActive: {
    borderColor: colors.dark.accent + '88',
    borderWidth: 1,
  },
  versionRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  versionLabel: {
    fontSize: 13,
    color: colors.dark.textSecondary,
  },
  versionValue: {
    fontSize: 14,
    fontWeight: '800' as const,
    color: colors.dark.text,
  },
  upToDateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.dark.greenDim,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  upToDateText: {
    fontSize: 11,
    color: colors.dark.green,
    fontWeight: '700' as const,
  },
  updateNotes: {
    fontSize: 12,
    color: colors.dark.textSecondary,
    marginBottom: 8,
    textAlign: 'right',
    lineHeight: 18,
  },
  updateButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  updateBlinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.dark.accent,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  updateBlinkBtnText: {
    fontSize: 12,
    fontWeight: '800' as const,
    color: '#0B0E11',
  },
}));
