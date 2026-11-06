/**
 * app/(tabs)/trade-ai/auto-trade.tsx — v1.5.3
 *
 * تب «بک‌تست» — معامله‌گر خودکار ربات (کپی نهنگ + سیگنال اندیکاتورها)
 * که طبق درخواست کاربر از داخل تب دمو جدا شد و اسمش «بک‌تست» شد.
 *
 *   • هدر سه‌تبی (دمو / بک‌تست / واقعی) ثابت بالای صفحه.
 *   • استراتژی‌های معاملاتی (روشن/خاموش) — همان لیست مشترک دمو/واقعی.
 *   • v1.5.3 — «هر نوع استراتژی انتخاب میکنم بک‌تست طبق همون جدولشو پر کنه»:
 *     با روشن کردن هر استراتژی، جدول «تنظیمات هر معامله» ربات همان لحظه
 *     با پارامترهای همان استراتژی پر می‌شود (مثلاً اسکالپر: لوریج ۷،
 *     حد ضرر ۱٪، ریوارد ۱.۲) — جدول با استراتژی مچ و پر می‌شود.
 *   • خودِ ربات: components/AutoTradingBotSection
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Bot, Gauge } from 'lucide-react-native';
import colors from '@/constants/colors';
import TradeAiSegmentHeader from '@/components/TradeAiSegmentHeader';
import AutoTradingBotSection from '@/components/AutoTradingBotSection';
import FeasibilityCalculator from '@/components/FeasibilityCalculator';
import { ThemedAlert } from '@/components/ThemedAlert';
import {
  EnabledStrategies,
  STRATEGY_ORDER,
  DEFAULT_ENABLED_STRATEGIES,
  loadEnabledStrategiesFor,
  saveEnabledStrategiesFor,
  primaryStrategy,
  type StrategyOwner,
} from '@/utils/tradeAiService';
import { STRATEGY_CONFIGS, TradingStrategy } from '@/types/tradeAi';
import {
  loadAutoSettings,
  saveAutoSettings,
  subscribeAutoSettings,
  withModeParams,
  type AutoMode,
} from '@/utils/autoTradingEngine';

export default function AutoTradeScreen() {
  const queryClient = useQueryClient();
  const [enabledStrategies, setEnabledStrategies] = useState<EnabledStrategies>(DEFAULT_ENABLED_STRATEGIES);
  /** v1.5.13 — استراتژی‌های معاملاتی «به‌تفکیک مود»: لیست این بخش، لیستِ
   *  مودِ فعلیِ ربات (دمو/واقعی — دکمه‌های داخل کارت ربات) است و تغییرش
   *  فقط همان مود را عوض می‌کند، نه هر دو را. */
  const [owner, setOwner] = useState<StrategyOwner>('demo');
  const [loaded, setLoaded] = useState(false);

  const reloadForOwner = useCallback(async (o: StrategyOwner) => {
    setEnabledStrategies(await loadEnabledStrategiesFor(o));
  }, []);

  useEffect(() => {
    (async () => {
      const cur = await loadAutoSettings();
      const o: StrategyOwner = cur.mode === 'real' ? 'real' : 'demo';
      setOwner(o);
      await reloadForOwner(o);
      setLoaded(true);
    })().catch(() => setLoaded(true));
    // وقتی کاربر داخل کارت ربات مود را عوض می‌کند، لیست استراتژی‌ها هم
    // همان لحظه به لیست همان مود می‌رود (subscribeAutoSettings).
    const unsub = subscribeAutoSettings((next) => {
      const o: StrategyOwner = next.mode === 'real' ? 'real' : 'demo';
      setOwner(o);
      void loadEnabledStrategiesFor(o).then(setEnabledStrategies).catch(() => {});
    });
    return unsub;
  }, [reloadForOwner]);

  const toggleStrategy = useCallback(
    (key: TradingStrategy) => {
      setEnabledStrategies((prev) => {
        const next = { ...prev, [key]: !prev[key] };
        if (!STRATEGY_ORDER.some((s) => next[s])) {
          ThemedAlert.alert('غیرممکن', 'حداقل یک استراتژی باید روشن باشد.');
          return prev;
        }
        // v1.5.13 — ذخیره فقط برای مود فعلی (دمو یا واقعی)
        void saveEnabledStrategiesFor(owner, next).then(() => {
          queryClient.invalidateQueries({ queryKey: ['trading-strategies'] });
        });
        // v1.5.3 — «هر نوع استراتژی انتخاب میکنم بک‌تست طبق همون جدولشو پر کنه»:
        // با روشن شدن هر استراتژی، جدول تنظیمات هر معامله ربات با پارامترهای
        // همان استراتژی هم‌مقدار می‌شود (اسکالپر → لوریج ۷ / حد ضرر ۱٪ / RR ۱.۲).
        // v1.5.7 — R7 ریشه‌ی باگ «پر نمیشه برام اصلا»: saveAutoSettings حالا به
        // کامپوننت ربات خبر می‌دهد (subscribeAutoSettings) → جدول همان لحظه
        // پریست را نشان می‌دهد و persistهای بعدی مقدار کهنه را برنمی‌گردانند.
        if (next[key]) {
          const preset = STRATEGY_CONFIGS[key];
          void (async () => {
            try {
              const cur = await loadAutoSettings();
              // v1.5.13 — پریست استراتژی فقط روی جدول همین مود اعمال می‌شود
              const updated = withModeParams(cur, {
                leverage: preset.maxLeverage,
                maxLossPercent: preset.stopLossPercent,
                rewardRatio: preset.takeProfitMultiplier,
              }, owner);
              await saveAutoSettings(updated);
              ThemedAlert.alert(
                'جدول با استراتژی مچ شد ✅',
                `تنظیمات هر معامله با پارامترهای «${preset.name}» پر شد:\nلوریج ${preset.maxLeverage}x • حد ضرر ${preset.stopLossPercent}٪ • ریوارد ${preset.takeProfitMultiplier}`
              );
            } catch {}
          })();
        }
        return next;
      });
    },
    [queryClient, owner]
  );

  const strategy = primaryStrategy(enabledStrategies);

  return (
    <View style={styles.container}>
      {/* v1.5.2 — هدر تب‌ها ثابت بالای صفحه */}
      <View style={styles.segmentWrap}>
        <TradeAiSegmentHeader active="backtest" />
      </View>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* v1.5.2 — استراتژی‌های معاملاتی داخل تب بک‌تست (طبق درخواست کاربر) */}
        {loaded && (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Gauge size={14} color={colors.dark.accent} />
              <Text style={styles.sectionTitle}>
                استراتژی‌های معاملاتی (روشن/خاموش) — حالت {owner === 'real' ? 'واقعی' : 'دمو'}
              </Text>
            </View>
            <Text style={styles.hint}>
              v1.5.13 — لیست استراتژی‌های هر حالت جدا است: آنچه برای «حالت واقعی» انتخاب می‌کنید فقط ربات واقعی را عوض می‌کند و تنظیمات «دمو» دست‌نخورده می‌ماند (و برعکس). با عوض کردن مود در کارت رباتِ پایین، همین لیست به لیست همان مود می‌رود. حداقل یک استراتژی باید روشن بماند.
              {'\n'}★ با روشن کردن هر استراتژی، جدول «تنظیمات هر معامله» (لوریج / حد ضرر / ریوارد) همان لحظه با پارامترهای همان استراتژی پر می‌شود — مثلاً اسکالپر: لوریج ۷ و حد ضرر ۱٪.
            </Text>
            {STRATEGY_ORDER.map((key) => {
              const cfg = STRATEGY_CONFIGS[key];
              const on = enabledStrategies[key];
              return (
                <View key={key} style={[styles.strategyRow, on && styles.strategyRowActive]}>
                  <View style={styles.strategyTexts}>
                    <Text style={styles.strategyName}>
                      {cfg.name} ({cfg.nameEn}){strategy === key ? ' — اصلی' : ''}
                    </Text>
                    <Text style={styles.strategyDesc} numberOfLines={2}>
                      {cfg.description} • اهرم {cfg.maxLeverage}x • حد ضرر {cfg.stopLossPercent}٪
                    </Text>
                  </View>
                  <Switch
                    value={on}
                    onValueChange={() => toggleStrategy(key)}
                    trackColor={{ true: colors.dark.green + '88', false: colors.dark.card }}
                    thumbColor={on ? colors.dark.green : colors.dark.textMuted}
                    style={{ transform: [{ scale: 0.75 }] }}
                  />
                </View>
              );
            })}
          </View>
        )}

        {/* ربات بک‌تست */}
        <AutoTradingBotSection />

        {/* v1.5.7 — R9: محاسبه‌گر بک‌تست واقعی (کارمزد صرافی) */}
        <FeasibilityCalculator />

        <View style={styles.disclaimer}>
          <Bot size={14} color={colors.dark.textMuted} />
          <Text style={styles.disclaimerText}>
            ربات بک‌تست در حالت «دمو» شبیه‌سازی می‌کند و در حالت «واقعی» با کلید API شما روی صرافی معامله می‌کند. فعالیت‌های آن (باز/بسته شدن پوزیشن‌ها) به تلگرام شما هم اعلام می‌شود — حتی وقتی برنامه بسته است.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.background,
  },
  segmentWrap: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 2,
    backgroundColor: colors.dark.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 40,
  },
  section: {
    backgroundColor: colors.dark.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    padding: 12,
    marginBottom: 12,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  sectionTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
    color: colors.dark.text,
  },
  hint: {
    fontSize: 9.5,
    color: colors.dark.textSecondary,
    lineHeight: 14,
    marginBottom: 8,
  },
  strategyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.dark.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    padding: 10,
    marginBottom: 6,
  },
  strategyRowActive: {
    borderColor: colors.dark.green + '55',
    backgroundColor: colors.dark.green + '0D',
  },
  strategyTexts: {
    flex: 1,
  },
  strategyName: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.dark.text,
  },
  strategyDesc: {
    fontSize: 9,
    color: colors.dark.textSecondary,
    marginTop: 2,
    lineHeight: 13,
  },
  disclaimer: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'flex-start',
    backgroundColor: colors.dark.surface,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 9.5,
    color: colors.dark.textSecondary,
    lineHeight: 15,
  },
});
