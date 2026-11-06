import React, { useEffect, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, Animated, Pressable } from 'react-native';
import { TrendingUp, TrendingDown, Zap, BarChart3, Target, ShieldAlert, Clock } from 'lucide-react-native';
import colors from '@/constants/colors';
import { createThemedStyles } from '@/utils/themeStyles';
import { TradeSignal } from '@/types/crypto';
import { useApp } from '@/contexts/AppContext';
import { EXCHANGES } from '@/constants/exchanges';

interface SignalCardProps {
  signal: TradeSignal;
  index: number;
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.01) return price.toFixed(5);
  return price.toFixed(8);
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(1)}B`;
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
  return vol.toFixed(0);
}

function getStrengthColor(strength: string) {
  switch (strength) {
    case 'high': return colors.dark.green;
    case 'medium': return colors.dark.accent;
    case 'low': return colors.dark.blue;
    default: return colors.dark.textSecondary;
  }
}

function getStrengthLabel(strength: string) {
  switch (strength) {
    case 'high': return 'قوی';
    case 'medium': return 'متوسط';
    case 'low': return 'ضعیف';
    default: return '';
  }
}

function timeAgo(date: Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'همین الان';
  if (mins < 60) return `${mins} دقیقه پیش`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ساعت پیش`;
  const days = Math.floor(hrs / 24);
  return `${days} روز پیش`;
}

function formatTime(date: Date): string {
  const d = new Date(date);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export default React.memo(function SignalCard({ signal, index }: SignalCardProps) {
  const { settings } = useApp();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const strengthColor = getStrengthColor(signal.strength);

  const isPump = signal.signalType === 'pump';
  const signalColor = isPump ? colors.dark.green : colors.dark.red;
  const signalLabel = isPump ? 'لانگ (خرید)' : 'شورت (فروش)';
  const signalEmoji = isPump ? '📈' : '📉';
  const signalTypeLabel = isPump ? 'پامپ' : 'دامپ';

  const exchangeInfo = EXCHANGES[settings.exchange];

  const tradeCalc = useMemo(() => {
    const margin = settings.marginAmount;
    const lev = settings.leverage;
    const positionSize = margin * lev;
    const takerFee = exchangeInfo.takerFee;

    const entryFee = positionSize * takerFee;
    const exitFee = positionSize * takerFee;
    const totalFee = entryFee + exitFee;

    const targetPct = isPump
      ? signal.suggestedTarget / signal.suggestedEntry - 1
      : 1 - signal.suggestedTarget / signal.suggestedEntry;
    const stopPct = isPump
      ? 1 - signal.suggestedStopLoss / signal.suggestedEntry
      : signal.suggestedStopLoss / signal.suggestedEntry - 1;

    const grossProfit = positionSize * targetPct;
    const netProfit = grossProfit - totalFee;

    const grossLoss = positionSize * stopPct;
    const netLoss = grossLoss + totalFee;

    const fundingCost = positionSize * Math.abs(signal.fundingRate);

    const rr = settings.riskRewardRatio;
    const rrTargetPct = stopPct * rr;
    const rrGrossProfit = positionSize * rrTargetPct;
    const rrNetProfit = rrGrossProfit - totalFee;

    return {
      positionSize,
      totalFee,
      netProfit,
      netLoss,
      fundingCost,
      targetPct: targetPct * 100,
      stopPct: stopPct * 100,
      riskRewardRatio: rr,
      rrNetProfit,
      rrTargetPct: rrTargetPct * 100,
    };
  }, [settings.marginAmount, settings.leverage, settings.riskRewardRatio, exchangeInfo, signal, isPump]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        delay: index * 100,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 400,
        delay: index * 100,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const onPressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.97,
      useNativeDriver: true,
    }).start();
  };

  const onPressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 3,
      useNativeDriver: true,
    }).start();
  };

  const TrendIcon = isPump ? TrendingUp : TrendingDown;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }, { scale: scaleAnim }],
        },
      ]}
    >
      <Pressable onPressIn={onPressIn} onPressOut={onPressOut}>
        <View style={[styles.topStripe, { backgroundColor: signalColor }]} />

        <View style={styles.signalTypeBadgeRow}>
          <View style={[styles.signalTypeBadge, { backgroundColor: signalColor + '18' }]}>
            <TrendIcon size={12} color={signalColor} />
            <Text style={[styles.signalTypeBadgeText, { color: signalColor }]}>
              {signalTypeLabel}
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: strengthColor + '22' }]}>
            <Zap size={10} color={strengthColor} />
            <Text style={[styles.badgeText, { color: strengthColor }]}>
              {getStrengthLabel(signal.strength)}
            </Text>
          </View>
        </View>

        <View style={styles.header}>
          <View style={styles.headerRight}>
            <Text style={styles.symbol}>{signal.displayName}</Text>
            <Text style={styles.reason}>{signal.reason}</Text>
          </View>
          <View style={styles.headerLeft}>
            <Text style={styles.price}>${formatPrice(signal.currentPrice)}</Text>
            <View style={[
              styles.changeContainer,
              { backgroundColor: signal.priceChangePercent >= 0 ? colors.dark.greenDim : colors.dark.redDim },
            ]}>
              <TrendIcon
                size={10}
                color={signal.priceChangePercent >= 0 ? colors.dark.green : colors.dark.red}
              />
              <Text style={[
                styles.changeText,
                { color: signal.priceChangePercent >= 0 ? colors.dark.green : colors.dark.red },
              ]}>
                {signal.priceChangePercent >= 0 ? '+' : ''}{signal.priceChangePercent.toFixed(2)}%
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <BarChart3 size={13} color={colors.dark.textSecondary} />
            <Text style={styles.statLabel}>حجم ۲۴ ساعته</Text>
            <Text style={styles.statValue}>${formatVolume(signal.volume24h)}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <TrendIcon size={13} color={colors.dark.accent} />
            <Text style={styles.statLabel}>نسبت حجم</Text>
            <Text style={[styles.statValue, { color: colors.dark.accent }]}>
              {signal.volumeChangeRatio.toFixed(1)}x
            </Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Zap size={13} color={isPump ? colors.dark.green : colors.dark.red} />
            <Text style={styles.statLabel}>{isPump ? 'خریداران' : 'فروشندگان'}</Text>
            <Text style={[styles.statValue, { color: isPump ? colors.dark.green : colors.dark.red }]}>
              {isPump
                ? (signal.buyVolumeRatio * 100).toFixed(0)
                : (signal.sellVolumeRatio * 100).toFixed(0)
              }%
            </Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={{ fontSize: 11 }}>%</Text>
            <Text style={styles.statLabel}>فاندینگ ریت</Text>
            <Text style={[styles.statValue, { color: signal.fundingRate >= 0 ? colors.dark.green : colors.dark.red }]}>
              {(signal.fundingRate * 100).toFixed(4)}%
            </Text>
          </View>
        </View>

        <View style={styles.timeframeBadgeRow}>
          <View style={styles.timeframeBadge}>
            <Clock size={11} color={colors.dark.blue} />
            <Text style={styles.timeframeBadgeText}>تایم‌فریم: {signal.timeframe}</Text>
          </View>
        </View>

        <View style={styles.positionBox}>
          <Text style={styles.positionTitle}>
            {signalEmoji} موقعیت {signalLabel} پیشنهادی
          </Text>
          <View style={styles.positionRow}>
            <View style={styles.positionItem}>
              <Target size={12} color={signalColor} />
              <Text style={styles.positionLabel}>ورود</Text>
              <Text style={[styles.positionValue, { color: signalColor }]}>
                ${formatPrice(signal.suggestedEntry)}
              </Text>
            </View>
            <View style={styles.positionItem}>
              <TrendIcon size={12} color={colors.dark.accent} />
              <Text style={styles.positionLabel}>هدف</Text>
              <Text style={[styles.positionValue, { color: colors.dark.accent }]}>
                ${formatPrice(signal.suggestedTarget)}
              </Text>
            </View>
            <View style={styles.positionItem}>
              <ShieldAlert size={12} color={colors.dark.red} />
              <Text style={styles.positionLabel}>حد ضرر</Text>
              <Text style={[styles.positionValue, { color: colors.dark.red }]}>
                ${formatPrice(signal.suggestedStopLoss)}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.calcBox}>
          <Text style={styles.calcTitle}>
            💰 محاسبه سود/ضرر — مارجین ${settings.marginAmount} • اهرم {settings.leverage}x
          </Text>
          <View style={styles.calcGrid}>
            <View style={styles.calcRow}>
              <Text style={styles.calcLabel}>حجم پوزیشن:</Text>
              <Text style={styles.calcValue}>${tradeCalc.positionSize.toLocaleString()}</Text>
            </View>
            <View style={styles.calcRow}>
              <Text style={styles.calcLabel}>کارمزد (ورود+خروج):</Text>
              <Text style={[styles.calcValue, { color: colors.dark.orange }]}>
                -${tradeCalc.totalFee.toFixed(2)}
              </Text>
            </View>
            <View style={styles.calcRow}>
              <Text style={styles.calcLabel}>فاندینگ ریت (هر ۸ ساعت):</Text>
              <Text style={[styles.calcValue, { color: colors.dark.orange }]}>
                -${tradeCalc.fundingCost.toFixed(2)}
              </Text>
            </View>
            <View style={styles.calcSeparator} />
            <View style={styles.calcRow}>
              <Text style={styles.calcLabel}>سود خالص (هدف {tradeCalc.targetPct.toFixed(1)}%):</Text>
              <Text style={[styles.calcValue, styles.calcProfit]}>
                +${tradeCalc.netProfit.toFixed(2)}
              </Text>
            </View>
            <View style={styles.calcRow}>
              <Text style={styles.calcLabel}>ضرر خالص (استاپ {tradeCalc.stopPct.toFixed(1)}%):</Text>
              <Text style={[styles.calcValue, styles.calcLoss]}>
                -${tradeCalc.netLoss.toFixed(2)}
              </Text>
            </View>
            <View style={styles.calcSeparator} />
            <View style={styles.calcRow}>
              <Text style={styles.calcLabel}>ریسک/ریوارد (1:{tradeCalc.riskRewardRatio}):</Text>
              <Text style={[styles.calcValue, { color: colors.dark.blue }]}>
                سود: +${tradeCalc.rrNetProfit.toFixed(2)} ({tradeCalc.rrTargetPct.toFixed(1)}%)
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.signalSourceRow}>
          <View style={styles.signalSourceBadge}>
            <BarChart3 size={10} color={colors.dark.textSecondary} />
            <Text style={styles.signalSourceText}>
              سیگنال بر اساس: حجم معاملات ({signal.volumeChangeRatio.toFixed(1)}x)
            </Text>
          </View>
        </View>

        <View style={styles.footer}>
          <View style={styles.footerTimeRow}>
            <Clock size={10} color={colors.dark.textMuted} />
            <Text style={styles.footerText}>
              {formatTime(signal.detectedAt)} — {timeAgo(signal.detectedAt)}
            </Text>
          </View>
          <View style={styles.footerTimeRow}>
            <Text style={styles.footerText}>تایم‌فریم پیشنهادی: {signal.timeframe}</Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
});

const styles = createThemedStyles(() => StyleSheet.create({
  container: {
    backgroundColor: colors.dark.card,
    borderRadius: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    overflow: 'hidden',
  },
  topStripe: {
    height: 3,
    width: '100%',
  },
  signalTypeBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  signalTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  signalTypeBadgeText: {
    fontSize: 12,
    fontWeight: '700' as const,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
  },
  headerRight: {
    flex: 1,
  },
  headerLeft: {
    alignItems: 'flex-end',
  },
  symbol: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: colors.dark.text,
    letterSpacing: 0.5,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    gap: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600' as const,
  },
  reason: {
    fontSize: 12,
    color: colors.dark.textSecondary,
    marginTop: 4,
  },
  price: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  changeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 3,
    marginTop: 4,
  },
  changeText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.dark.border,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.dark.border,
  },
  statLabel: {
    fontSize: 9,
    color: colors.dark.textMuted,
  },
  statValue: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  positionBox: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 8,
    backgroundColor: colors.dark.surfaceLight + '60',
    borderRadius: 12,
    padding: 12,
  },
  positionTitle: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: colors.dark.textSecondary,
    marginBottom: 10,
    textAlign: 'right',
  },
  positionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  positionItem: {
    alignItems: 'center',
    gap: 4,
  },
  positionLabel: {
    fontSize: 10,
    color: colors.dark.textMuted,
  },
  positionValue: {
    fontSize: 13,
    fontWeight: '700' as const,
  },
  calcBox: {
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: colors.dark.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  calcTitle: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: colors.dark.textSecondary,
    textAlign: 'right',
    marginBottom: 10,
  },
  calcGrid: {
    gap: 6,
  },
  calcRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  calcLabel: {
    fontSize: 11,
    color: colors.dark.textMuted,
  },
  calcValue: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  calcSeparator: {
    height: 1,
    backgroundColor: colors.dark.border,
    marginVertical: 4,
  },
  calcProfit: {
    color: colors.dark.green,
  },
  calcLoss: {
    color: colors.dark.red,
  },
  timeframeBadgeRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 2,
  },
  timeframeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark.blueDim,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  timeframeBadgeText: {
    fontSize: 11,
    color: colors.dark.blue,
    fontWeight: '600' as const,
  },
  footer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    alignItems: 'flex-end',
  },
  footerTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  footerText: {
    fontSize: 10,
    color: colors.dark.textMuted,
  },
  signalSourceRow: {
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  signalSourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark.surfaceLight,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 5,
    alignSelf: 'flex-start',
  },
  signalSourceText: {
    fontSize: 10,
    color: colors.dark.textSecondary,
    fontWeight: '500' as const,
  },
}));
