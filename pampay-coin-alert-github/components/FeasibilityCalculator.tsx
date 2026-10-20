/**
 * components/FeasibilityCalculator.tsx — v1.5.7 (R9)
 *
 * «محاسبه‌گر بک‌تست واقعی» — کاربر صرافی + نوع استراتژی + تعداد معاملات در
 * روز + لوریج + حجم مارجین کل + حجم هر معامله + حد ضرر + ریوارد + حد ضرر
 * روزانه را وارد می‌کند و برنامه با کارمزد فیوچرز همان صرافی محاسبه می‌کند
 * که اجرای ربات روی آن صرافی می‌ارزد یا نه؛ اگر نه، اعداد پیشنهادی تنظیمات
 * (ریوارد/حدضرر/تعداد معاملات/صرافی ارزان‌تر/سفارش لیمیت) ارائه می‌شود.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, Switch, ActivityIndicator } from 'react-native';
import { Calculator, ChevronDown, ChevronUp, CheckCircle2, XCircle, Save, Rocket } from 'lucide-react-native';
import colors from '@/constants/colors';
import { ThemedAlert } from '@/components/ThemedAlert';
import {
  EXCHANGE_FEE_PROFILES,
  FeasibilityResult,
  computeFeasibility,
} from '@/utils/feasibilityCalculator';
import { STRATEGY_CONFIGS, TradingStrategy } from '@/types/tradeAi';
import { STRATEGY_ORDER } from '@/utils/tradeAiService';
import { saveAutoSettings, loadAutoSettings } from '@/utils/autoTradingEngine';
import { saveEnabledStrategies } from '@/utils/tradeAiService';
import {
  FeasibilityPreset,
  applyFeasibilityPresetToSettings,
  saveFeasibilityPreset,
} from '@/utils/feasibilityPresets';

/** تبدیل ارقام فارسی به لاتین برای ورودی‌های عددی. */
const faToEn = (s: string): string =>
  s.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d).toString());

interface NumField {
  label: string;
  value: string;
  onChange: (t: string) => void;
  suffix?: string;
  hint?: string;
}

function NumInput({ label, value, onChange, suffix, hint }: NumField) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}
        {suffix ? <Text style={styles.fieldSuffix}> ({suffix})</Text> : null}
      </Text>
      <TextInput
        style={styles.fieldInput}
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={colors.dark.textMuted}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

export default function FeasibilityCalculator() {
  const [open, setOpen] = useState(false);
  const [exchangeId, setExchangeId] = useState('binance');
  const [strategy, setStrategy] = useState<TradingStrategy>('scalper');
  const [tradesPerDay, setTradesPerDay] = useState('10');
  const [leverage, setLeverage] = useState('7');
  const [totalMargin, setTotalMargin] = useState('1000');
  const [volumePerTrade, setVolumePerTrade] = useState('50');
  const [slPercent, setSlPercent] = useState('1');
  const [rewardRatio, setRewardRatio] = useState('1.2');
  const [dailyLossPercent, setDailyLossPercent] = useState('3');
  const [winRatePercent, setWinRatePercent] = useState('50');
  const [useMaker, setUseMaker] = useState(true);
  const [takerText, setTakerText] = useState('');
  /** v1.5.8 — R2: در حال ذخیره/اعمال پریست روی ربات. */
  const [actionBusy, setActionBusy] = useState(false);

  const exchange = EXCHANGE_FEE_PROFILES.find((e) => e.id === exchangeId) ?? EXCHANGE_FEE_PROFILES[0];

  /** v1.5.8 — R2: پریستِ همین ورودی‌ها (صرافی + استراتژی + اعداد). */
  const buildPreset = (): Omit<FeasibilityPreset, 'id' | 'createdAt'> => ({
    exchangeId: exchange.id,
    exchangeName: exchange.name,
    strategy,
    tradesPerDay: num(tradesPerDay),
    leverage: num(leverage),
    totalMarginUsd: num(totalMargin),
    volumePerTradeUsd: num(volumePerTrade),
    slPercent: num(slPercent),
    rewardRatio: num(rewardRatio),
    dailyLossPercent: num(dailyLossPercent) || 100,
    winRatePercent: num(winRatePercent) || 50,
    useMaker,
    takerPercent: takerText.trim() ? num(takerText) : exchange.takerPercent,
  });

  /** v1.5.8 — R2: «ذخیره تنظیمات» — هر ترکیب صرافی/اعداد برای بعد ذخیره
   *  می‌شود و در حالت «واقعی» ربات قابل انتخاب است. */
  const handleSavePreset = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await saveFeasibilityPreset(buildPreset());
      ThemedAlert.alert(
        'تنظیمات ذخیره شد ✅',
        `همین تنظیمات برای صرافی «${exchange.name}» ذخیره شد.\nهر موقع خواستید، در حالت «واقعی» ربات، از بخش «تنظیمات محاسبه‌گر (ذخیره‌شده)» همین پریست را انتخاب کنید و معامله را شروع کنید.`
      );
    } finally {
      setActionBusy(false);
    }
  };

  /** v1.5.8 — R2: «شروع معامله واقعی با همین تنظیمات» — ربات به حالت
   *  واقعی می‌رود، جدولش با اعداد محاسبه‌گر پری می‌شود، استراتژی انتخابی
   *  روشن می‌شود؛ کاربر فقط دکمه شروع ربات را می‌زند. */
  const handleStartReal = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      const preset = buildPreset();
      await saveFeasibilityPreset(preset);
      const cur = await loadAutoSettings();
      const next = applyFeasibilityPresetToSettings(cur, { ...preset, id: '', createdAt: 0 }, {
        realMode: true,
      });
      await saveAutoSettings(next);
      // همان استراتژیِ محاسبه‌گر روشن شود تا برچسب پوزیشن‌ها هم درست باشد.
      const strategyMap = Object.fromEntries(
        STRATEGY_ORDER.map((s) => [s, s === strategy])
      ) as Record<TradingStrategy, boolean>;
      await saveEnabledStrategies(strategyMap);
      const binanceNote =
        exchange.id === 'binance'
          ? ''
          : `\n⚠️ اجرای سفارش واقعی فعلاً با کلید API فیوچرز بایننس انجام می‌شود؛ اعداد همین صرافی روی ربات اعمال شد و برای محاسبه‌ی کارمزد همان صرافی معتبر است.`;
      ThemedAlert.alert(
        'رفتی به حالت واقعی ربات 🚀',
        `ربات به حالت «واقعی» رفت و جدول تنظیمات با همین اعداد محاسبه‌گر پر شد:\n${[
          `لوریج ${next.leverage}x`,
          `حد ضرر ${next.maxLossPercent}٪`,
          `R:R 1:${next.rewardRatio}`,
          `حجم مارجین هر معامله $${next.positionSizeUsd}`,
          `سرمایه اولیه $${next.initialCapitalUsd}`,
          `حد ضرر روزانه ${next.aiCapital.dailyLossLimitPercent}٪`,
        ].join(' • ')}\n\nاگر کلید API بایننس ندارید، اول در همان بخش واقعی کلیدها را وارد کنید؛ بعد دکمه «شروع واقعی» را بزنید.${binanceNote}`
      );
    } catch {
      ThemedAlert.alert('خطا', 'اعمال تنظیمات روی ربات انجام نشد — دوباره تلاش کنید.');
    } finally {
      setActionBusy(false);
    }
  };

  const applyStrategy = (s: TradingStrategy) => {
    const cfg = STRATEGY_CONFIGS[s];
    setStrategy(s);
    setLeverage(String(cfg.maxLeverage));
    setSlPercent(String(cfg.stopLossPercent));
    setRewardRatio(String(cfg.takeProfitMultiplier));
  };

  const num = (t: string): number => {
    const v = parseFloat(faToEn(t).replace(/[^0-9.]/g, ''));
    return Number.isFinite(v) ? v : 0;
  };

  const result: FeasibilityResult | null = useMemo(() => {
    if (
      num(leverage) <= 0 ||
      num(totalMargin) <= 0 ||
      num(volumePerTrade) <= 0 ||
      num(tradesPerDay) < 0 ||
      num(slPercent) <= 0 ||
      num(rewardRatio) <= 0
    ) {
      return null;
    }
    const taker = takerText.trim() ? num(takerText) : exchange.takerPercent;
    return computeFeasibility({
      takerPercent: taker,
      makerPercent: exchange.makerPercent,
      tradesPerDay: num(tradesPerDay),
      leverage: num(leverage),
      totalMarginUsd: num(totalMargin),
      volumePerTradeUsd: num(volumePerTrade),
      slPercent: num(slPercent),
      rewardRatio: num(rewardRatio),
      dailyLossPercent: num(dailyLossPercent) || 100,
      winRatePercent: num(winRatePercent) || 50,
      entryStyle: useMaker ? 'mixed' : 'taker',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    exchangeId,
    takerText,
    tradesPerDay,
    leverage,
    totalMargin,
    volumePerTrade,
    slPercent,
    rewardRatio,
    dailyLossPercent,
    winRatePercent,
    useMaker,
  ]);

  return (
    <View style={styles.card}>
      <Pressable style={styles.head} onPress={() => setOpen((v) => !v)}>
        <Calculator size={15} color={colors.dark.accent} />
        <Text style={styles.title}>محاسبه‌گر بک‌تست واقعی (کارمزد صرافی)</Text>
        <View style={styles.chev}>
          {open ? <ChevronUp size={14} color={colors.dark.textSecondary} /> : <ChevronDown size={14} color={colors.dark.textSecondary} />}
        </View>
      </Pressable>
      {!open ? (
        <Text style={styles.closedHint}>
          صرافی و تنظیمات معامله را بدهید؛ برنامه با کارمزد فیوچرز همان صرافی محاسبه می‌کند اجرای ربات می‌ارزد یا نه — و اگر نه، اعداد پیشنهادی می‌دهد.
        </Text>
      ) : (
        <>
          {/* انتخاب صرافی */}
          <Text style={styles.sectionLabel}>صرافی</Text>
          <View style={styles.chipRow}>
            {EXCHANGE_FEE_PROFILES.map((e) => (
              <Pressable
                key={e.id}
                style={[styles.chip, exchangeId === e.id && styles.chipActive]}
                onPress={() => {
                  setExchangeId(e.id);
                  setTakerText('');
                }}
              >
                <Text style={[styles.chipText, exchangeId === e.id && styles.chipTextActive]} numberOfLines={1}>
                  {e.name}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.feeNote}>
            کارمزد تیکر: {exchange.takerPercent}٪ • میکر: {exchange.makerPercent}٪{exchange.note ? ` • ${exchange.note}` : ''} — سطح عادی (VIP0)؛ اگر کارمزد شما فرق دارد در کادر زیر بنویسید.
          </Text>
          <NumInput label="کارمزد تیکر من" value={takerText} onChange={setTakerText} suffix="٪" hint="خالی = همان عدد پیش‌فرض صرافی" />

          {/* انتخاب استراتژی */}
          <Text style={styles.sectionLabel}>نوع استراتژی (پارامترها خودکار پر می‌شوند)</Text>
          <View style={styles.chipRow}>
            {STRATEGY_ORDER.map((s) => (
              <Pressable
                key={s}
                style={[styles.chip, strategy === s && styles.chipActive]}
                onPress={() => applyStrategy(s)}
              >
                <Text style={[styles.chipText, strategy === s && styles.chipTextActive]} numberOfLines={1}>
                  {STRATEGY_CONFIGS[s].name}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* ورودی‌های عددی */}
          <View style={styles.grid}>
            <View style={styles.gridItem}>
              <NumInput label="معاملات در روز" value={tradesPerDay} onChange={setTradesPerDay} />
            </View>
            <View style={styles.gridItem}>
              <NumInput label="لوریج" value={leverage} onChange={setLeverage} suffix="x" />
            </View>
            <View style={styles.gridItem}>
              <NumInput label="مارجین کل" value={totalMargin} onChange={setTotalMargin} suffix="$" />
            </View>
            <View style={styles.gridItem}>
              <NumInput label="حجم هر معامله" value={volumePerTrade} onChange={setVolumePerTrade} suffix="$" />
            </View>
            <View style={styles.gridItem}>
              <NumInput label="حد ضرر" value={slPercent} onChange={setSlPercent} suffix="٪" />
            </View>
            <View style={styles.gridItem}>
              <NumInput label="ریوارد (R:R)" value={rewardRatio} onChange={setRewardRatio} />
            </View>
            <View style={styles.gridItem}>
              <NumInput label="حد ضرر روزانه" value={dailyLossPercent} onChange={setDailyLossPercent} suffix="٪" />
            </View>
            <View style={styles.gridItem}>
              <NumInput label="حدس نرخ برد شما" value={winRatePercent} onChange={setWinRatePercent} suffix="٪" hint="پیش‌فرض ۵۰٪" />
            </View>
          </View>

          <View style={styles.makerRow}>
            <Text style={styles.makerText}>ورود با سفارش لیمیت (میکر) — بسته به‌صورت تیکر</Text>
            <Switch
              value={useMaker}
              onValueChange={setUseMaker}
              trackColor={{ true: colors.dark.green + '88', false: colors.dark.card }}
              thumbColor={useMaker ? colors.dark.green : colors.dark.textMuted}
              style={{ transform: [{ scale: 0.7 }] }}
            />
          </View>

          {result && (
            <View style={[styles.verdictBox, result.ok ? styles.verdictOk : styles.verdictBad]}>
              {result.ok ? (
                <CheckCircle2 size={16} color={colors.dark.green} />
              ) : (
                <XCircle size={16} color={colors.dark.red} />
              )}
              <Text style={[styles.verdictText, { color: result.ok ? colors.dark.green : colors.dark.red }]}>
                {result.ok
                  ? 'می‌ارزد! با این تنظیمات و نرخ‌برد فرضی شما، بعد از کارمزد هم انتظار سود روزانه مثبت است.'
                  : 'نمی‌ارزد! با این تنظیمات، کارمزد/ریسک نسبت به سود خیلی سنگین است — پیشنهادها را پایین ببینید.'}
              </Text>
            </View>
          )}

          {result && (
            <View style={styles.statsBox}>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>مارجین هر معامله (حجم ÷ لوریج)</Text>
                <Text style={styles.statValue}>${result.marginPerTrade}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>ریسک هر معامله (در استاپ)</Text>
                <Text style={[styles.statValue, { color: colors.dark.red }]}>−${Math.abs(result.riskPerTrade)}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>سود هر معامله (در تیک‌پرافیت)</Text>
                <Text style={[styles.statValue, { color: colors.dark.green }]}>+${Math.abs(result.rewardPerTrade)}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>کارمزد رفت‌وبرگشت هر معامله</Text>
                <Text style={[styles.statValue, { color: '#F0B90B' }]}>${result.feePerTrade}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>سهم کارمزد از ریسک</Text>
                <Text style={[styles.statValue, { color: result.feeToRiskPercent > 30 ? colors.dark.red : colors.dark.green }]}>
                  ٪{result.feeToRiskPercent}
                </Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>امید ریاضی هر معامله (با نرخ‌برد شما)</Text>
                <Text style={[styles.statValue, { color: result.evPerTrade >= 0 ? colors.dark.green : colors.dark.red }]}>
                  {result.evPerTrade >= 0 ? '+' : '−'}${Math.abs(result.evPerTrade)}
                </Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>کارمزد روزانه ({tradesPerDay} معامله)</Text>
                <Text style={[styles.statValue, { color: '#F0B90B' }]}>${result.feesPerDay}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>سود/زیان روزانه موردانتظار (بعد از کارمزد)</Text>
                <Text style={[styles.statValue, { color: result.evPerDay >= 0 ? colors.dark.green : colors.dark.red }]}>
                  {result.evPerDay >= 0 ? '+' : '−'}${Math.abs(result.evPerDay)}
                </Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>نرخ‌برد سربه‌سر</Text>
                <Text style={[styles.statValue, { color: result.winRateMarginPoints >= 5 ? colors.dark.green : colors.dark.red }]}>
                  ٪{result.breakevenWinRate} (حاشیه شما: {result.winRateMarginPoints >= 0 ? '+' : '−'}
                  {Math.abs(result.winRateMarginPoints)} پوینت)
                </Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>تعداد باخت تا حد ضرر روزانه</Text>
                <Text style={styles.statValue}>{result.lossesUntilDailyStop.toLocaleString('fa-IR')} باخت</Text>
              </View>
            </View>
          )}

          {result?.warnings.map((w, i) => (
            <Text key={`w-${i}`} style={styles.warnText}>
              ⚠ {w}
            </Text>
          ))}

          {result && !result.ok && result.suggestions.length > 0 && (
            <View style={styles.suggestBox}>
              <Text style={styles.suggestTitle}>پیشنهاد تنظیمات تا صرفه‌ اقتصادی شود:</Text>
              {result.suggestions.map((s, i) => (
                <Text key={`s-${i}`} style={styles.suggestText}>
                  {'\u2713'} {s.text}
                </Text>
              ))}
            </View>
          )}

          {result && (
            <View style={styles.actionRow}>
              <Pressable
                style={[styles.actionBtn, styles.actionBtnSave]}
                disabled={actionBusy}
                onPress={() => void handleSavePreset()}
              >
                {actionBusy ? (
                  <ActivityIndicator size="small" color={colors.dark.accent} />
                ) : (
                  <Save size={13} color={colors.dark.accent} />
                )}
                <Text style={styles.actionBtnSaveText}>ذخیره این تنظیمات</Text>
              </Pressable>
              <Pressable
                style={[styles.actionBtn, styles.actionBtnStart]}
                disabled={actionBusy}
                onPress={() => void handleStartReal()}
              >
                {actionBusy ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Rocket size={13} color="#FFF" />
                )}
                <Text style={styles.actionBtnStartText}>شروع معامله واقعی با این تنظیمات</Text>
              </Pressable>
            </View>
          )}

          {result?.bestExchange && result.bestExchange.id !== exchangeId && (
            <Text style={styles.bestText}>
              💡 کم‌کارمزدترین صرافی لیست: {result.bestExchange.name} (تیکر {result.bestExchange.takerPercent}٪ / میکر {result.bestExchange.makerPercent}٪)
            </Text>
          )}

          <Pressable
            style={styles.explainBtn}
            onPress={() =>
              ThemedAlert.alert(
                'این محاسبه چه می‌گوید؟',
                'مارجین هر معامله = حجم ÷ لوریج. ریسک = مارجین × حد ضرر (فاصله قیمت = ضرر ÷ لوریج). سود در هدف = ریسک × ریوارد. کارمزد رفت‌وبرگشت روی «حجم» محاسبه می‌شود نه مارجین — برای همین با لوریج بالا و حدضرر کوچک، کارمزد گاهی از خودِ ریسک بزرگ‌تر می‌شود.\n\nحکم «می‌ارزد» یعنی: بعد از کارمزد، سود روزانه موردانتظار مثبت است + حاشیه‌ی نرخ‌برد شما بالاتر از نرخ‌برد سربه‌سر است + مارجین در حساب جا می‌شود.\n\nاین تخمینی است: فاندینگ، لغزش قیمت و کیفیت واقعی سیگنالها در آن نیست. اعداد کارمزد هر صرافی را از پنل خودتان چک کنید.'
              )
            }
          >
            <Text style={styles.explainBtnText}>توضیح محاسبه</Text>
          </Pressable>
        </>
      )}
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
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '900',
    color: colors.dark.text,
  },
  chev: {
    padding: 2,
  },
  closedHint: {
    fontSize: 9,
    color: colors.dark.textSecondary,
    lineHeight: 14,
    marginTop: 6,
  },
  sectionLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    color: colors.dark.accent,
    marginTop: 10,
    marginBottom: 6,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    backgroundColor: colors.dark.background,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 4,
  },
  chipActive: {
    borderColor: colors.dark.accent,
    backgroundColor: colors.dark.accent + '1A',
  },
  chipText: {
    fontSize: 10,
    color: colors.dark.textSecondary,
    fontWeight: '700',
  },
  chipTextActive: {
    color: colors.dark.text,
  },
  feeNote: {
    fontSize: 9,
    color: colors.dark.textSecondary,
    lineHeight: 13,
    marginTop: 6,
    marginBottom: 2,
  },
  field: {
    marginTop: 8,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.dark.text,
  },
  fieldSuffix: {
    fontSize: 9,
    color: colors.dark.textSecondary,
    fontWeight: '400',
  },
  fieldInput: {
    backgroundColor: colors.dark.background,
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
    marginTop: 4,
  },
  fieldHint: {
    fontSize: 8.5,
    color: colors.dark.textMuted,
    marginTop: 3,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  gridItem: {
    flexBasis: '47%',
    flexGrow: 1,
  },
  makerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    backgroundColor: colors.dark.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  makerText: {
    flex: 1,
    fontSize: 9.5,
    color: colors.dark.textSecondary,
    lineHeight: 14,
  },
  verdictBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    marginTop: 12,
  },
  verdictOk: {
    backgroundColor: colors.dark.green + '10',
    borderColor: colors.dark.green + '40',
  },
  verdictBad: {
    backgroundColor: colors.dark.red + '10',
    borderColor: colors.dark.red + '40',
  },
  verdictText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 16,
  },
  statsBox: {
    backgroundColor: colors.dark.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    padding: 10,
    marginTop: 8,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
  },
  statLabel: {
    flex: 1,
    fontSize: 9.5,
    color: colors.dark.textSecondary,
  },
  statValue: {
    fontSize: 10.5,
    fontWeight: '900',
    color: colors.dark.text,
    direction: 'ltr',
  },
  warnText: {
    fontSize: 9,
    color: '#F0B90B',
    lineHeight: 14,
    marginTop: 6,
  },
  suggestBox: {
    backgroundColor: colors.dark.green + '08',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.dark.green + '30',
    padding: 10,
    marginTop: 8,
  },
  suggestTitle: {
    fontSize: 10.5,
    fontWeight: '900',
    color: colors.dark.green,
    marginBottom: 5,
  },
  suggestText: {
    fontSize: 9.5,
    color: colors.dark.text,
    lineHeight: 16,
    marginBottom: 4,
  },
  bestText: {
    fontSize: 9,
    color: colors.dark.textSecondary,
    lineHeight: 14,
    marginTop: 8,
  },
  explainBtn: {
    alignSelf: 'center',
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.dark.border,
    backgroundColor: colors.dark.surface,
  },
  explainBtnText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.dark.accent,
  },
  /* v1.5.8 — R2: دکمه‌های ذخیره/شروع واقعی */
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  actionBtnSave: {
    flexBasis: '38%',
    flexGrow: 1,
    backgroundColor: colors.dark.surface,
    borderColor: colors.dark.accent + '66',
  },
  actionBtnStart: {
    flexBasis: '62%',
    flexGrow: 2,
    backgroundColor: colors.dark.accent,
    borderColor: colors.dark.accent,
  },
  actionBtnSaveText: {
    fontSize: 9.5,
    fontWeight: '900',
    color: colors.dark.accent,
    textAlign: 'center',
    flex: 1,
  },
  actionBtnStartText: {
    fontSize: 9.5,
    fontWeight: '900',
    color: '#FFF',
    textAlign: 'center',
    flex: 1,
  },
});
