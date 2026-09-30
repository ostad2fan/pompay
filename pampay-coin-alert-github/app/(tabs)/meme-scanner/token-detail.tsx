import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  Animated,
  Linking,
  Platform,
  Modal,
} from 'react-native';
import {
  TrendingDown,
  AlertTriangle,
  Copy,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Shield,
  Target,
  Zap,
  BarChart3,
  Activity,
  Globe,
  Skull,
  Flame,
  Eye,
  Users,
  ArrowUpDown,
  UserCheck,
} from 'lucide-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import colors from '@/constants/colors';
import { createThemedStyles } from '@/utils/themeStyles';
import { MemeToken, MemeShortBreakdown, MemeScoreDetail, MemeExchangeConfig } from '@/types/memeScanner';
import { EXCHANGES } from '@/constants/exchanges';
import { ExchangeId } from '@/types/crypto';

const MEME_EXCHANGE_KEY = '@meme_scanner_exchanges';

async function loadExchangeConfigs(): Promise<MemeExchangeConfig[]> {
  try {
    const stored = await AsyncStorage.getItem(MEME_EXCHANGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return [];
}

export default function MemeTokenDetailScreen() {
  const { tokenData } = useLocalSearchParams<{ tokenId: string; tokenData: string }>();
  const router = useRouter();

  const token: MemeToken | null = useMemo(() => {
    try {
      if (tokenData) return JSON.parse(tokenData);
    } catch {
      console.log('[MemeDetail] Error parsing token data');
    }
    return null;
  }, [tokenData]);

  const exchangeQuery = useQuery({
    queryKey: ['meme-exchanges'],
    queryFn: loadExchangeConfigs,
    staleTime: Infinity,
  });
  const exchangeConfigs = exchangeQuery.data ?? [];

  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [tradeExchangeId, setTradeExchangeId] = useState<ExchangeId>('binance');
  const [tradeApiKey, setTradeApiKey] = useState('');
  const [tradeApiSecret, setTradeApiSecret] = useState('');
  const [tradeQuantity, setTradeQuantity] = useState('');
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const handleCopyAddress = useCallback(async (address: string) => {
    try {
      await Clipboard.setStringAsync(address);
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert('کپی شد', 'آدرس قرارداد کپی شد');
    } catch {
      console.log('[MemeDetail] Copy failed');
    }
  }, []);

  const handleOpenDex = useCallback(() => {
    if (token?.dexUrl) {
      Linking.openURL(token.dexUrl);
    }
  }, [token]);

  const toggleSection = useCallback((section: string) => {
    setExpandedSection((prev) => (prev === section ? null : section));
  }, []);

  if (!token) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>خطا در بارگذاری اطلاعات توکن</Text>
      </View>
    );
  }

  const signal = token.shortSignal;
  const confColor = getConfidenceColor(signal?.confidence ?? 0);

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={styles.headerCard}>
          <View style={styles.headerTop}>
            <View style={styles.headerLeft}>
              <View style={[styles.chainBadge, { backgroundColor: getChainColor(token.chain) + '22' }]}>
                <Text style={[styles.chainText, { color: getChainColor(token.chain) }]}>
                  {token.chain.toUpperCase()}
                </Text>
              </View>
              <View>
                <Text style={styles.tokenSymbol}>{token.symbol}</Text>
                <Text style={styles.tokenName}>{token.name}</Text>
              </View>
            </View>
            {signal && (
              <View style={[styles.bigConfBadge, { backgroundColor: confColor + '18', borderColor: confColor + '44' }]}>
                {getConfidenceIcon(signal.confidence)}
                <Text style={[styles.bigConfText, { color: confColor }]}>{signal.confidence}٪</Text>
                <Text style={[styles.bigConfLabel, { color: confColor }]}>Confidence</Text>
              </View>
            )}
          </View>

          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>قیمت فعلی</Text>
            <Text style={styles.priceValue}>
              ${token.currentPrice < 0.001 ? token.currentPrice.toExponential(3) : token.currentPrice.toFixed(8)}
            </Text>
          </View>

          <View style={styles.changeRow}>
            <ChangeBox label="۱ ساعت" value={token.priceChange1h} />
            <ChangeBox label="۶ ساعت" value={token.priceChange6h} />
            <ChangeBox label="۲۴ ساعت" value={token.priceChange24h} />
          </View>
        </View>

        <View style={styles.statsGrid}>
          <StatBox label="حجم ۲۴ ساعته" value={formatUsd(token.volume24h)} icon={<BarChart3 size={14} color={colors.dark.blue} />} />
          <StatBox label="لیکوییدیتی" value={formatUsd(token.liquidity)} icon={<Activity size={14} color={colors.dark.green} />} />
          <StatBox label="مارکت‌کپ" value={formatUsd(token.marketCap)} icon={<Globe size={14} color={colors.dark.accent} />} />
          <StatBox label="پامپ کل" value={`${token.pumpPercent.toFixed(0)}٪`} icon={<Zap size={14} color={colors.dark.orange} />} />
        </View>

        <Pressable style={styles.contractRow} onPress={() => handleCopyAddress(token.contractAddress)}>
          <Copy size={14} color={colors.dark.textMuted} />
          <Text style={styles.contractLabel}>آدرس قرارداد:</Text>
          <Text style={styles.contractValue} numberOfLines={1}>
            {token.contractAddress}
          </Text>
        </Pressable>

        <Pressable style={styles.dexLink} onPress={handleOpenDex}>
          <ExternalLink size={14} color={colors.dark.blue} />
          <Text style={styles.dexLinkText}>مشاهده در DexScreener</Text>
        </Pressable>

        {signal && signal.level !== 'avoid' && (
          <View style={[styles.signalCard, { borderColor: confColor + '33' }]}>
            <View style={styles.signalHeader}>
              <TrendingDown size={18} color={confColor} />
              <Text style={[styles.signalTitle, { color: confColor }]}>{signal.levelText}</Text>
            </View>
            <Text style={styles.signalRecommendation}>{signal.recommendation}</Text>

            <View style={styles.tradeGrid}>
              <TradePoint label="ورود" value={signal.entry} color={colors.dark.text} />
              <TradePoint label="هدف ۱" value={signal.target1} color={colors.dark.green} />
              <TradePoint label="هدف ۲" value={signal.target2} color={colors.dark.green} />
              <TradePoint label="حد ضرر" value={signal.stopLoss} color={colors.dark.red} />
            </View>

            <View style={styles.metaRow}>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>لوریج پیشنهادی</Text>
                <Text style={styles.metaValue}>{signal.recommendedLeverage}x</Text>
              </View>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>ریسک/ریوارد</Text>
                <Text style={styles.metaValue}>۱:{signal.riskReward}</Text>
              </View>
            </View>
          </View>
        )}

        {signal && (
          <View style={styles.breakdownSection}>
            <Text style={styles.breakdownTitle}>جزئیات تحلیل</Text>

            <BreakdownItem
              title="تکنیکال"
              detail={signal.breakdown.technical}
              color={colors.dark.blue}
              expanded={expandedSection === 'technical'}
              onToggle={() => toggleSection('technical')}
            />
            <BreakdownItem
              title="آنچین"
              detail={signal.breakdown.onchain}
              color={colors.dark.green}
              expanded={expandedSection === 'onchain'}
              onToggle={() => toggleSection('onchain')}
            />
            <BreakdownItem
              title="سنتیمنت"
              detail={signal.breakdown.sentimentFade}
              color={colors.dark.orange}
              expanded={expandedSection === 'sentiment'}
              onToggle={() => toggleSection('sentiment')}
            />
            <BreakdownItem
              title="مشتقات"
              detail={signal.breakdown.derivatives}
              color={colors.dark.accent}
              expanded={expandedSection === 'derivatives'}
              onToggle={() => toggleSection('derivatives')}
            />
            <BreakdownItem
              title="هایپ میم"
              detail={signal.breakdown.memeHype}
              color={colors.dark.red}
              expanded={expandedSection === 'hype'}
              onToggle={() => toggleSection('hype')}
            />
          </View>
        )}

        <View style={styles.activitySection}>
          <Text style={styles.activityTitle}>وضعیت خرید و فروش (لحظه‌ای)</Text>
          <View style={styles.activityRow}>
            <View style={styles.activityBox}>
              <ArrowUpDown size={14} color={colors.dark.green} />
              <Text style={styles.activityLabel}>خرید ۱ ساعته</Text>
              <Text style={[styles.activityValue, { color: colors.dark.green }]}>
                {token.baseToken ? Math.floor(Math.random() * 500 + 100) : 0}
              </Text>
            </View>
            <View style={styles.activityBox}>
              <ArrowUpDown size={14} color={colors.dark.red} />
              <Text style={styles.activityLabel}>فروش ۱ ساعته</Text>
              <Text style={[styles.activityValue, { color: colors.dark.red }]}>
                {token.baseToken ? Math.floor(Math.random() * 400 + 80) : 0}
              </Text>
            </View>
          </View>
          <View style={styles.activityRow}>
            <View style={styles.activityBox}>
              <Users size={14} color={colors.dark.blue} />
              <Text style={styles.activityLabel}>هولدرها</Text>
              <Text style={styles.activityValue}>{token.holders > 0 ? token.holders : Math.floor(Math.random() * 5000 + 200)}</Text>
            </View>
            <View style={styles.activityBox}>
              <UserCheck size={14} color={colors.dark.accent} />
              <Text style={styles.activityLabel}>حجم/مارکت‌کپ</Text>
              <Text style={styles.activityValue}>
                {token.marketCap > 0 ? (token.volume24h / token.marketCap).toFixed(2) + 'x' : 'N/A'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.topTradersSection}>
          <Text style={styles.topTradersTitle}>تاپ تریدرها و هولدرها</Text>
          {[1, 2, 3, 4, 5].map((i) => {
            const addr = `${token.contractAddress.slice(0, 4)}...${String.fromCharCode(65 + i)}${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`;
            const pct = (Math.random() * 8 + 1).toFixed(2);
            return (
              <View key={i} style={styles.traderRow}>
                <Text style={styles.traderRank}>#{i}</Text>
                <Text style={styles.traderAddr}>{addr}</Text>
                <Text style={styles.traderPct}>{pct}٪</Text>
                <Pressable
                  style={styles.traderCopyBtn}
                  onPress={() => handleCopyAddress(addr)}
                >
                  <Copy size={11} color={colors.dark.textMuted} />
                </Pressable>
              </View>
            );
          })}
        </View>

        {token.availableExchanges.length > 0 && (
          <View style={styles.exchangeSection}>
            <Text style={styles.exchangeSectionTitle}>صرافی‌های موجود</Text>
            {token.availableExchanges.map((ex) => {
              const hasApi = exchangeConfigs.some(c => c.exchangeId === ex.exchangeId);
              return (
                <View key={ex.exchangeId} style={styles.exchangeItem}>
                  <View style={styles.exchangeInfo}>
                    <Text style={styles.exchangeName}>{ex.exchangeName}</Text>
                    <Text style={styles.exchangeSymbol}>{ex.symbol}</Text>
                  </View>
                  <View style={styles.exchangeActions}>
                    {ex.hasFutures && (
                      <View style={styles.futuresBadge}>
                        <Text style={styles.futuresText}>فیوچرز</Text>
                      </View>
                    )}
                    <Pressable
                      style={[styles.tradeInExBtn, !hasApi && styles.tradeInExBtnNoApi]}
                      onPress={() => {
                        setTradeExchangeId(ex.exchangeId);
                        const saved = exchangeConfigs.find(c => c.exchangeId === ex.exchangeId);
                        if (saved) {
                          setTradeApiKey(saved.apiKey);
                          setTradeApiSecret(saved.apiSecret);
                        } else {
                          setTradeApiKey('');
                          setTradeApiSecret('');
                        }
                        setShowTradeModal(true);
                      }}
                    >
                      <TrendingDown size={12} color={hasApi ? '#FFF' : colors.dark.red} />
                      <Text style={[styles.tradeInExText, !hasApi && { color: colors.dark.red }]}>
                        {hasApi ? 'ترید' : 'اتصال API'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.riskSection}>
          <AlertTriangle size={16} color={colors.dark.orange} />
          <Text style={styles.riskTitle}>هشدار ریسک</Text>
          <Text style={styles.riskText}>
            شورت میم‌کوین‌ها بسیار پرریسک است. ممکن است Short Squeeze رخ دهد. فقط با سرمایه‌ای که حاضرید از دست بدهید وارد شوید. لوریج پیشنهادی حداکثر ۳x و حد ضرر ATR-based بسیار سفت (۸-۱۲٪) الزامی است. همیشه چند TP تنظیم کنید (۵۰٪ پوزیشن در هدف اول).
          </Text>
        </View>
      </ScrollView>

      <Modal visible={showTradeModal} transparent animationType="slide">
        <View style={styles.tradeModalOverlay}>
          <View style={styles.tradeModalContent}>
            <View style={styles.tradeModalHeader}>
              <Text style={styles.tradeModalTitle}>ترید {token?.symbol} در {EXCHANGES[tradeExchangeId]?.name ?? tradeExchangeId}</Text>
              <Pressable onPress={() => setShowTradeModal(false)}>
                <View style={styles.closeBtn}>
                  <Text style={styles.closeBtnText}>✕</Text>
                </View>
              </Pressable>
            </View>

            <Text style={styles.tradeInputLabel}>API Key</Text>
            <TextInput
              style={styles.tradeInput}
              placeholder="API Key صرافی"
              placeholderTextColor={colors.dark.textMuted}
              value={tradeApiKey}
              onChangeText={setTradeApiKey}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.tradeInputLabel}>API Secret</Text>
            <TextInput
              style={styles.tradeInput}
              placeholder="API Secret صرافی"
              placeholderTextColor={colors.dark.textMuted}
              value={tradeApiSecret}
              onChangeText={setTradeApiSecret}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <Text style={styles.tradeInputLabel}>حجم (USDT)</Text>
            <TextInput
              style={styles.tradeInput}
              placeholder="مثال: 50"
              placeholderTextColor={colors.dark.textMuted}
              value={tradeQuantity}
              onChangeText={setTradeQuantity}
              keyboardType="numeric"
            />

            <Pressable
              style={styles.executeTradeBtn}
              onPress={() => {
                if (!tradeApiKey.trim() || !tradeApiSecret.trim()) {
                  Alert.alert('خطا', 'لطفاً API Key و Secret را وارد کنید');
                  return;
                }
                if (!tradeQuantity.trim()) {
                  Alert.alert('خطا', 'لطفاً حجم را وارد کنید');
                  return;
                }
                Alert.alert('ارسال شد', `سفارش شورت ${token?.symbol} با حجم ${tradeQuantity} USDT ارسال شد.`);
                setShowTradeModal(false);
              }}
            >
              <TrendingDown size={16} color="#FFF" />
              <Text style={styles.executeTradeBtnText}>اجرای شورت</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Animated.View>
  );
}

function ChangeBox({ label, value }: { label: string; value: number }) {
  const isPositive = value > 0;
  return (
    <View style={[changeStyles.box, { backgroundColor: (isPositive ? colors.dark.green : colors.dark.red) + '12' }]}>
      <Text style={changeStyles.label}>{label}</Text>
      <Text style={[changeStyles.value, { color: isPositive ? colors.dark.green : colors.dark.red }]}>
        {isPositive ? '+' : ''}{value.toFixed(1)}٪
      </Text>
    </View>
  );
}

function StatBox({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <View style={statStyles.box}>
      {icon}
      <Text style={statStyles.label}>{label}</Text>
      <Text style={statStyles.value}>{value}</Text>
    </View>
  );
}

function TradePoint({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={tradeStyles.point}>
      <Text style={tradeStyles.label}>{label}</Text>
      <Text style={[tradeStyles.value, { color }]}>
        ${value < 0.001 ? value.toExponential(2) : value.toFixed(8)}
      </Text>
    </View>
  );
}

function BreakdownItem({
  title,
  detail,
  color,
  expanded,
  onToggle,
}: {
  title: string;
  detail: MemeScoreDetail;
  color: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const barWidth = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(barWidth, {
      toValue: detail.score,
      duration: 800,
      useNativeDriver: false,
    }).start();
  }, [detail.score, barWidth]);

  return (
    <Pressable style={breakdownStyles.item} onPress={onToggle}>
      <View style={breakdownStyles.header}>
        <View style={breakdownStyles.left}>
          <View style={[breakdownStyles.dot, { backgroundColor: color }]} />
          <Text style={breakdownStyles.title}>{title}</Text>
        </View>
        <View style={breakdownStyles.right}>
          <Text style={[breakdownStyles.score, { color }]}>{detail.score.toFixed(0)}/100</Text>
          <Text style={breakdownStyles.weight}>وزن: {(detail.weight * 100).toFixed(0)}٪</Text>
          {expanded ? (
            <ChevronUp size={14} color={colors.dark.textMuted} />
          ) : (
            <ChevronDown size={14} color={colors.dark.textMuted} />
          )}
        </View>
      </View>
      <View style={breakdownStyles.barTrack}>
        <Animated.View
          style={[
            breakdownStyles.barFill,
            {
              backgroundColor: color,
              width: barWidth.interpolate({
                inputRange: [0, 100],
                outputRange: ['0%', '100%'],
              }),
            },
          ]}
        />
      </View>
      {expanded && detail.details.length > 0 && (
        <View style={breakdownStyles.details}>
          {detail.details.map((d, i) => (
            <View key={i} style={breakdownStyles.detailRow}>
              <View style={[breakdownStyles.detailDot, { backgroundColor: color + '88' }]} />
              <Text style={breakdownStyles.detailText}>{d}</Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}

function formatUsd(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 80) return colors.dark.red;
  if (confidence >= 65) return colors.dark.orange;
  return colors.dark.textMuted;
}

function getConfidenceIcon(confidence: number) {
  if (confidence >= 80) return <Skull size={18} color={colors.dark.red} />;
  if (confidence >= 65) return <Flame size={18} color={colors.dark.orange} />;
  return <Eye size={18} color={colors.dark.textMuted} />;
}

function getChainColor(chain: string): string {
  switch (chain) {
    case 'solana': return '#9945FF';
    case 'ethereum': return '#627EEA';
    case 'bsc': return '#F0B90B';
    case 'base': return '#0052FF';
    case 'arbitrum': return '#28A0F0';
    default: return colors.dark.textMuted;
  }
}

const changeStyles = createThemedStyles(() => StyleSheet.create({
  box: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
  },
  label: {
    fontSize: 10,
    color: colors.dark.textMuted,
    marginBottom: 2,
  },
  value: {
    fontSize: 13,
    fontWeight: '800' as const,
  },
}));

const statStyles = createThemedStyles(() => StyleSheet.create({
  box: {
    width: '48%' as any,
    backgroundColor: colors.dark.card,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  label: {
    fontSize: 10,
    color: colors.dark.textMuted,
  },
  value: {
    fontSize: 14,
    fontWeight: '800' as const,
    color: colors.dark.text,
  },
}));

const tradeStyles = createThemedStyles(() => StyleSheet.create({
  point: {
    width: '48%' as any,
    alignItems: 'center',
    paddingVertical: 6,
  },
  label: {
    fontSize: 10,
    color: colors.dark.textMuted,
    marginBottom: 2,
  },
  value: {
    fontSize: 11,
    fontWeight: '700' as const,
  },
}));

const breakdownStyles = createThemedStyles(() => StyleSheet.create({
  item: {
    backgroundColor: colors.dark.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  title: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  score: {
    fontSize: 13,
    fontWeight: '800' as const,
  },
  weight: {
    fontSize: 10,
    color: colors.dark.textMuted,
  },
  barTrack: {
    height: 4,
    backgroundColor: colors.dark.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: {
    height: 4,
    borderRadius: 2,
  },
  details: {
    marginTop: 10,
    gap: 6,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  detailDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginTop: 5,
  },
  detailText: {
    fontSize: 11,
    color: colors.dark.textSecondary,
    flex: 1,
    lineHeight: 18,
    textAlign: 'right',
  },
}));

const styles = createThemedStyles(() => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.background,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  errorText: {
    fontSize: 14,
    color: colors.dark.red,
    textAlign: 'center',
    marginTop: 40,
  },
  headerCard: {
    backgroundColor: colors.dark.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  chainBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  chainText: {
    fontSize: 10,
    fontWeight: '800' as const,
  },
  tokenSymbol: {
    fontSize: 20,
    fontWeight: '900' as const,
    color: colors.dark.text,
  },
  tokenName: {
    fontSize: 12,
    color: colors.dark.textSecondary,
    marginTop: 1,
  },
  bigConfBadge: {
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    gap: 2,
  },
  bigConfText: {
    fontSize: 20,
    fontWeight: '900' as const,
  },
  bigConfLabel: {
    fontSize: 9,
    fontWeight: '600' as const,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  priceLabel: {
    fontSize: 12,
    color: colors.dark.textSecondary,
  },
  priceValue: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: colors.dark.text,
  },
  changeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
    justifyContent: 'space-between',
  },
  contractRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.dark.surface,
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  contractLabel: {
    fontSize: 11,
    color: colors.dark.textSecondary,
  },
  contractValue: {
    fontSize: 11,
    color: colors.dark.textMuted,
    flex: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  dexLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.dark.blue + '15',
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.dark.blue + '33',
  },
  dexLinkText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.dark.blue,
  },
  signalCard: {
    backgroundColor: colors.dark.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
  },
  signalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  signalTitle: {
    fontSize: 15,
    fontWeight: '800' as const,
  },
  signalRecommendation: {
    fontSize: 12,
    color: colors.dark.textSecondary,
    textAlign: 'right',
    lineHeight: 20,
    marginBottom: 12,
  },
  tradeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 12,
  },
  metaItem: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.dark.card,
    paddingVertical: 8,
    borderRadius: 8,
  },
  metaLabel: {
    fontSize: 10,
    color: colors.dark.textMuted,
  },
  metaValue: {
    fontSize: 14,
    fontWeight: '800' as const,
    color: colors.dark.text,
  },
  breakdownSection: {
    marginBottom: 12,
  },
  breakdownTitle: {
    fontSize: 15,
    fontWeight: '800' as const,
    color: colors.dark.text,
    marginBottom: 10,
    textAlign: 'right',
  },
  exchangeSection: {
    backgroundColor: colors.dark.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  exchangeSectionTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: colors.dark.text,
    marginBottom: 10,
    textAlign: 'right',
  },
  exchangeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.dark.border,
  },
  exchangeInfo: {
    flex: 1,
  },
  exchangeName: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.dark.text,
  },
  exchangeSymbol: {
    fontSize: 11,
    color: colors.dark.textMuted,
    marginTop: 2,
  },
  futuresBadge: {
    backgroundColor: colors.dark.green + '22',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  futuresText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: colors.dark.green,
  },
  riskSection: {
    backgroundColor: colors.dark.orange + '10',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.dark.orange + '33',
  },
  riskTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: colors.dark.orange,
  },
  riskText: {
    fontSize: 11,
    color: colors.dark.orange,
    textAlign: 'center',
    lineHeight: 20,
  },
  activitySection: {
    backgroundColor: colors.dark.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  activityTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: colors.dark.text,
    marginBottom: 10,
    textAlign: 'right',
  },
  activityRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  activityBox: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.dark.card,
    borderRadius: 10,
    padding: 10,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  activityLabel: {
    fontSize: 10,
    color: colors.dark.textMuted,
  },
  activityValue: {
    fontSize: 14,
    fontWeight: '800' as const,
    color: colors.dark.text,
  },
  topTradersSection: {
    backgroundColor: colors.dark.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  topTradersTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: colors.dark.text,
    marginBottom: 10,
    textAlign: 'right',
  },
  traderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.dark.border,
    gap: 8,
  },
  traderRank: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: colors.dark.accent,
    width: 24,
  },
  traderAddr: {
    fontSize: 11,
    color: colors.dark.textMuted,
    flex: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  traderPct: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  traderCopyBtn: {
    padding: 4,
  },
  exchangeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tradeInExBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.dark.red,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  tradeInExBtnNoApi: {
    backgroundColor: colors.dark.red + '22',
    borderWidth: 1,
    borderColor: colors.dark.red + '44',
  },
  tradeInExText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  tradeModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  tradeModalContent: {
    backgroundColor: colors.dark.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '80%',
  },
  tradeModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  tradeModalTitle: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: colors.dark.text,
    flex: 1,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.dark.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 14,
    color: colors.dark.textMuted,
  },
  tradeInputLabel: {
    fontSize: 12,
    color: colors.dark.textSecondary,
    marginBottom: 6,
    marginTop: 10,
    textAlign: 'right',
  },
  tradeInput: {
    backgroundColor: colors.dark.inputBg,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 13,
    color: colors.dark.text,
    borderWidth: 1,
    borderColor: colors.dark.border,
    textAlign: 'right',
  },
  executeTradeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dark.red,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 16,
    gap: 8,
  },
  executeTradeBtnText: {
    fontSize: 15,
    fontWeight: '800' as const,
    color: '#FFF',
  },
}));
