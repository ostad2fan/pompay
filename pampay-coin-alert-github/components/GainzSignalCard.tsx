import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ArrowUpRight, ArrowDownRight, Activity } from 'lucide-react-native';
import colors from '@/constants/colors';
import { createThemedStyles } from '@/utils/themeStyles';
import { GainzAlgoSignal } from '@/utils/gainzAlgoService';

interface GainzSignalCardProps {
  signal: GainzAlgoSignal;
  index?: number;
}

const TF_LABELS: Record<string, string> = { '15m': '۱۵ دقیقه', '30m': '۳۰ دقیقه', '1h': '۱ ساعته', '4h': '۴ ساعته', '1d': 'روزانه' };
const MARKET_LABELS: Record<string, string> = { futures: 'فیوچرز', spot: 'اسپات' };

/**
 * Card for GainzAlgo Pro daily BUY/SELL signals (TradingView-style label bubble).
 */
export default function GainzSignalCard({ signal }: GainzSignalCardProps) {
  const isBuy = signal.action === 'buy';
  const actionColor = isBuy ? colors.dark.green : colors.dark.red;
  const tfLabel =
    (TF_LABELS[signal.timeframe ?? '1d'] ?? 'روزانه') + (signal.live ? ' (زنده)' : '');
  const marketLabel = (signal.markets && signal.markets.length > 0 ? signal.markets : ['futures'])
    .map((m) => MARKET_LABELS[m] ?? m)
    .join(' + ');

  return (
    <View style={[styles.card, { borderLeftColor: actionColor }]} testID="gainz-signal-card">
      <View style={styles.headerRow}>
        <View style={[styles.labelBubble, { backgroundColor: actionColor }]}>
          <Text style={styles.labelText}>{isBuy ? 'BUY' : 'SELL'}</Text>
        </View>
        <Text style={styles.symbol}>{signal.displayName}</Text>
        <View style={styles.rsiRow}>
          <Activity size={12} color={colors.dark.textSecondary} />
          <Text style={styles.rsiText}>RSI(14): {signal.rsi}</Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>قیمت بستن کندل</Text>
          <Text style={[styles.statValue, { color: actionColor }]}>
            ${signal.price.toFixed(4)}
          </Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>کندل {tfLabel}</Text>
          <Text style={styles.statValue}>
            {new Date(signal.candleOpenTime).toLocaleDateString('fa-IR')}
          </Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>بازار Binance</Text>
          <Text style={styles.statValue}>{marketLabel}</Text>
        </View>
      </View>

      <View style={styles.footerRow}>
        {isBuy ? (
          <ArrowUpRight size={12} color={colors.dark.green} />
        ) : (
          <ArrowDownRight size={12} color={colors.dark.red} />
        )}
        <Text style={styles.footerText}>
          اندیکاتور GainzAlgo Pro • تایم‌فریم {tfLabel}
        </Text>
      </View>
    </View>
  );
}

const styles = createThemedStyles(() => StyleSheet.create({
  card: {
    backgroundColor: colors.dark.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.dark.border,
    borderLeftWidth: 3,
    padding: 14,
    marginBottom: 10,
    marginHorizontal: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  labelBubble: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  labelText: {
    fontSize: 11,
    fontWeight: '800' as const,
    color: '#FFFFFF',
  },
  symbol: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: colors.dark.text,
    flex: 1,
    textAlign: 'right',
  },
  rsiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rsiText: {
    fontSize: 11,
    color: colors.dark.textSecondary,
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 12,
  },
  statItem: {
    flex: 1,
    backgroundColor: colors.dark.surfaceLight ?? colors.dark.background,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 10,
    color: colors.dark.textMuted,
    marginBottom: 2,
  },
  statValue: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: colors.dark.text,
    textAlign: 'center',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 5,
    marginTop: 10,
  },
  footerText: {
    fontSize: 10,
    color: colors.dark.textMuted,
    textAlign: 'right',
  },
}));
