/**
 * utils/feasibilityPresets.ts — v1.5.8 (R2)
 *
 * «وقتی در محاسبه‌گر تنظیمات را پیدا می‌کنم یه گزینه بزار که با اون
 * تنظیمات ت بزنم برا همون صرافی و وارد بشم به بخش واقعی ربات و یا یه گزینه
 * ذخیره که با همون تنظیمات هر کاربر برا خودش پیدا می‌کنه برا هر صرافیش که
 * پیدا کرد هر موقع خواست در واقعی همونو انتخاب کنه و بتونه از اون صرافی و
 * تنظیماتی که قبلا پیدا کرده معامله را شروع کنه»
 *
 * ذخیره‌ی تنظیمات پیدا‌شده در محاسبه‌گر بک‌تست واقعی، به تفکیک صرافی:
 *  - saveFeasibilityPreset: هر ترکیب صرافی/اعداد را با یک شناسه ذخیره می‌کند.
 *  - applyFeasibilityPresetToSettings: پریست را روی جدول تنظیمات ربات
 *    (AutoTradeSettings) اعمال می‌کند — حجم مارجین = حجم ÷ لوریج (همان
 *    منطق موتور)، سرمایه اولیه = مارجین کل، حد ضرر روزانه → aiCapital.
 *  - دکمه «شروع معامله واقعی» در محاسبه‌گر: پریست را ذخیره و همان لحظه
 *    تنظیمات ربات را به حالت «واقعی» با همان اعداد ذخیره می‌کند
 *    (saveAutoSettings به بخش ربات خبر می‌دهد — جدول زنده به‌روز می‌شود).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AutoTradeSettings } from '@/utils/autoTradingEngine';
import type { TradingStrategy } from '@/types/tradeAi';

const PRESETS_KEY = '@feasibility_presets_v1';
const MAX_PRESETS = 20;

export interface FeasibilityPreset {
  id: string;
  createdAt: number;
  /** صرافی انتخاب‌شده در محاسبه‌گر (نمایشی + کارمزد). */
  exchangeId: string;
  exchangeName: string;
  /** استراتژی انتخاب‌شده (روشن کردن همان استراتژی در لیست استراتژی‌ها). */
  strategy: TradingStrategy;
  tradesPerDay: number;
  leverage: number;
  /** مارجین کل ($) — سرمایه اولیه‌ی ربات. */
  totalMarginUsd: number;
  /** حجم هر معامله ($) — مارجینِ هر معامله = حجم ÷ لوریج. */
  volumePerTradeUsd: number;
  slPercent: number;
  rewardRatio: number;
  dailyLossPercent: number;
  winRatePercent: number;
  useMaker: boolean;
  /** کارمزد تیکر مؤثر (سفارشی یا پیش‌فرض صرافی) — فقط برای مرجوع. */
  takerPercent: number;
}

export async function loadFeasibilityPresets(): Promise<FeasibilityPreset[]> {
  try {
    const raw = await AsyncStorage.getItem(PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as FeasibilityPreset[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveFeasibilityPreset(
  preset: Omit<FeasibilityPreset, 'id' | 'createdAt'>
): Promise<FeasibilityPreset> {
  const full: FeasibilityPreset = {
    ...preset,
    id: `fp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
  };
  const list = await loadFeasibilityPresets();
  // همان صرافی + همان اعداد → جایگزین (به‌جای انباشت پریست‌های تکراری)
  const dupIdx = list.findIndex(
    (p) =>
      p.exchangeId === full.exchangeId &&
      p.strategy === full.strategy &&
      Math.abs(p.leverage - full.leverage) < 1e-9 &&
      Math.abs(p.slPercent - full.slPercent) < 1e-9 &&
      Math.abs(p.rewardRatio - full.rewardRatio) < 1e-9 &&
      Math.abs(p.volumePerTradeUsd - full.volumePerTradeUsd) < 1e-9
  );
  const next = dupIdx >= 0 ? list.map((p, i) => (i === dupIdx ? full : p)) : [full, ...list];
  await persistPresets(next.slice(0, MAX_PRESETS));
  return full;
}

export async function deleteFeasibilityPreset(id: string): Promise<void> {
  const list = await loadFeasibilityPresets();
  await persistPresets(list.filter((p) => p.id !== id));
}

async function persistPresets(list: FeasibilityPreset[]): Promise<void> {
  try {
    await AsyncStorage.setItem(PRESETS_KEY, JSON.stringify(list));
  } catch {}
}

/**
 * اعمال پریست روی تنظیمات ربات:
 *  - مارجین هر معامله (positionSizeUsd) = حجم ÷ لوریج — همان رابطه‌ای که
 *    محاسبه‌گر نشان می‌دهد («مارجین هر معامله = حجم ÷ لوریج»).
 *  - حداکثر پوزیشن همزمان = مارجین کل ÷ مارجین هر معامله (همه‌ی معاملاتی
 *    که در مارجین کل جا می‌شوند) — حداقل ۱، حداکثر ۱۰۰.
 *  - حد ضرر روزانه‌ی محاسبه‌گر → سقف ضرر روزانه aiCapital.
 *  - سرمایه اولیه = مارجین کل محاسبه‌گر.
 * mode/enabled دست‌نخورده می‌ماند (روشن‌کردن ربات با خود کاربر).
 */
export function applyFeasibilityPresetToSettings(
  current: AutoTradeSettings,
  preset: FeasibilityPreset,
  opts: { realMode?: boolean } = {}
): AutoTradeSettings {
  const leverage = Math.max(1, Math.round(preset.leverage || 1));
  const marginPerTrade = Math.max(5, Math.round(preset.volumePerTradeUsd / leverage));
  const maxOpen = Math.max(
    1,
    Math.min(100, Math.floor((preset.totalMarginUsd || marginPerTrade) / marginPerTrade))
  );
  return {
    ...current,
    ...(opts.realMode ? { mode: 'real' as const } : {}),
    leverage,
    positionSizeUsd: marginPerTrade,
    maxLossPercent: Math.max(0.5, Math.min(90, preset.slPercent || current.maxLossPercent)),
    rewardRatio: Math.max(0.5, Math.min(20, preset.rewardRatio || current.rewardRatio)),
    maxOpenPositions: maxOpen,
    initialCapitalUsd: Math.max(1, Math.round(preset.totalMarginUsd || current.initialCapitalUsd)),
    aiCapital: {
      ...current.aiCapital,
      enabled: true,
      dailyLossLimitPercent: Math.max(
        0.5,
        Math.min(50, preset.dailyLossPercent > 0 ? preset.dailyLossPercent : current.aiCapital.dailyLossLimitPercent)
      ),
    },
  };
}

/** خلاصه‌ی فارسیِ یک پریست برای نمایش در لیست. */
export function presetSummary(p: FeasibilityPreset): string {
  return [
    `${p.exchangeName}`,
    `لوریج ${p.leverage}x`,
    `حد ضرر ${p.slPercent}٪`,
    `R:R 1:${p.rewardRatio}`,
    `حجم $${p.volumePerTradeUsd}`,
    `مارجین کل $${p.totalMarginUsd}`,
  ].join(' • ');
}
