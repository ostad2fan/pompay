import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  Alert,
  Animated,
  ActivityIndicator,
  ScrollView,
  Modal,
  Platform,
} from 'react-native';
import {
  Search,
  TrendingDown,
  AlertTriangle,
  ChevronRight,
  RefreshCw,
  Filter,
  Zap,
  Shield,
  Target,
  Copy,
  ExternalLink,
  X,
  ChevronDown,
  Skull,
  Flame,
  Eye,
  Settings,
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import colors from '@/constants/colors';
import { createThemedStyles } from '@/utils/themeStyles';
import {
  MemeToken,
  MemeScannerFilter,
  DEFAULT_MEME_FILTER,
  MemeExchangeConfig,
} from '@/types/memeScanner';
import { ExchangeId } from '@/types/crypto';
import { EXCHANGES, EXCHANGE_LIST } from '@/constants/exchanges';
import { scanMemeTokens, searchMemeToken } from '@/utils/memeApiService';
import { useVpnGate } from '@/contexts/VpnGateContext';
import { useApp } from '@/contexts/AppContext';
import { sendTelegramMemeShortSignal } from '@/utils/telegramService';

const MEME_FILTER_KEY = '@meme_scanner_filter';
const MEME_EXCHANGE_KEY = '@meme_scanner_exchanges';

async function loadFilter(): Promise<MemeScannerFilter> {
  try {
    const stored = await AsyncStorage.getItem(MEME_FILTER_KEY);
    if (stored) return { ...DEFAULT_MEME_FILTER, ...JSON.parse(stored) };
  } catch (e) {
    console.log('[MemeScanner] Error loading filter:', e);
  }
  return DEFAULT_MEME_FILTER;
}

async function loadExchangeConfigs(): Promise<MemeExchangeConfig[]> {
  try {
    const stored = await AsyncStorage.getItem(MEME_EXCHANGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.log('[MemeScanner] Error loading exchanges:', e);
  }
  return [];
}

export default function MemeScannerScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { settings } = useApp();
  const prevTokenIdsRef = useRef<Set<string>>(new Set());

  const [searchQuery, setSearchQuery] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [showExchangeModal, setShowExchangeModal] = useState(false);
  const [selectedToken, setSelectedToken] = useState<MemeToken | null>(null);
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [tradeExchangeId, setTradeExchangeId] = useState<ExchangeId>('binance');
  const [tradeApiKey, setTradeApiKey] = useState('');
  const [tradeApiSecret, setTradeApiSecret] = useState('');
  const [tradeQuantity, setTradeQuantity] = useState('');

  const [countdown, setCountdown] = useState(10);
  const countdownBarAnim = useRef(new Animated.Value(1)).current;
  const liveIndicator = useRef(new Animated.Value(0)).current;
  const warningPulse = useRef(new Animated.Value(0)).current;

  const filterQuery = useQuery({
    queryKey: ['meme-filter'],
    queryFn: loadFilter,
    staleTime: Infinity,
  });

  // v1.4.8 — shared exit-IP state (15s poll): drives the Iran cut-off below.
  const vpnGate = useVpnGate();

  const exchangeQuery = useQuery({
    queryKey: ['meme-exchanges'],
    queryFn: loadExchangeConfigs,
    staleTime: Infinity,
  });

  const filter = filterQuery.data ?? DEFAULT_MEME_FILTER;
  const exchangeConfigs = exchangeQuery.data ?? [];

  const scanQuery = useQuery({
    queryKey: ['meme-scan', filter],
    queryFn: () => scanMemeTokens(filter),
    refetchInterval: vpnGate.blocked ? false : 10000,
    // v1.4.8 — with an Iranian exit IP the market APIs are cut completely.
    enabled: !vpnGate.blocked,
    staleTime: 5000,
  });

  useEffect(() => {
    if (!scanQuery.data || !settings.telegramEnabled || !(settings.memeShortNotifications ?? true)) return;
    const newTokens = scanQuery.data.filter((t) => {
      if (prevTokenIdsRef.current.has(t.id)) return false;
      return t.shortSignal && t.shortSignal.confidence >= 70;
    });
    for (const t of scanQuery.data) {
      prevTokenIdsRef.current.add(t.id);
    }
    if (prevTokenIdsRef.current.size > 500) {
      const arr = Array.from(prevTokenIdsRef.current);
      prevTokenIdsRef.current = new Set(arr.slice(-200));
    }
    for (const t of newTokens.slice(0, 3)) {
      if (t.shortSignal) {
        sendTelegramMemeShortSignal({
          name: t.name,
          symbol: t.symbol,
          confidence: t.shortSignal.confidence,
          currentPrice: t.currentPrice,
          entryPrice: t.shortSignal.entry,
          targets: [t.shortSignal.target1, t.shortSignal.target2],
          stopLoss: t.shortSignal.stopLoss,
          leverage: `${t.shortSignal.recommendedLeverage}x`,
        }).catch(() => {});
      }
    }
  }, [scanQuery.data, settings.telegramEnabled, settings.memeShortNotifications]);

  const searchMutation = useMutation({
    mutationFn: (query: string) => searchMemeToken(query),
  });

  const saveFilterMutation = useMutation({
    mutationFn: async (newFilter: MemeScannerFilter) => {
      await AsyncStorage.setItem(MEME_FILTER_KEY, JSON.stringify(newFilter));
      return newFilter;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meme-filter'] });
      queryClient.invalidateQueries({ queryKey: ['meme-scan'] });
    },
  });

  const saveExchangeMutation = useMutation({
    mutationFn: async (configs: MemeExchangeConfig[]) => {
      await AsyncStorage.setItem(MEME_EXCHANGE_KEY, JSON.stringify(configs));
      return configs;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meme-exchanges'] });
    },
  });

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(liveIndicator, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(liveIndicator, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [liveIndicator]);

  useEffect(() => {
    const warn = Animated.loop(
      Animated.sequence([
        Animated.timing(warningPulse, { toValue: 1, duration: 1500, useNativeDriver: true }),
        Animated.timing(warningPulse, { toValue: 0.5, duration: 1500, useNativeDriver: true }),
      ])
    );
    warn.start();
    return () => warn.stop();
  }, [warningPulse]);

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) return 10;
        return prev - 1;
      });
    }, 1000);

    const startBarAnim = () => {
      countdownBarAnim.setValue(1);
      Animated.timing(countdownBarAnim, {
        toValue: 0,
        duration: 10000,
        useNativeDriver: false,
      }).start();
    };
    startBarAnim();
    const barInterval = setInterval(startBarAnim, 10000);

    return () => {
      clearInterval(interval);
      clearInterval(barInterval);
    };
  }, [countdownBarAnim]);

  const tokens = useMemo(() => {
    let data: MemeToken[] = [];
    if (searchQuery.trim() && searchMutation.data) {
      data = searchMutation.data;
    } else {
      data = scanQuery.data ?? [];
    }
    const connectedIds = new Set(exchangeConfigs.map(c => c.exchangeId));
    if (connectedIds.size > 0) {
      const withEx: MemeToken[] = [];
      const withoutEx: MemeToken[] = [];
      for (const t of data) {
        if (t.availableExchanges.some(ex => connectedIds.has(ex.exchangeId))) {
          withEx.push(t);
        } else {
          withoutEx.push(t);
        }
      }
      return [...withEx, ...withoutEx];
    }
    return data;
  }, [scanQuery.data, searchMutation.data, searchQuery, exchangeConfigs]);

  const handleSearch = useCallback(() => {
    if (searchQuery.trim()) {
      searchMutation.mutate(searchQuery.trim());
    }
  }, [searchQuery, searchMutation]);

  const handleCopyAddress = useCallback(async (address: string) => {
    try {
      await Clipboard.setStringAsync(address);
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert('کپی شد', 'آدرس قرارداد کپی شد');
    } catch {
      console.log('[MemeScanner] Copy failed');
    }
  }, []);

  const handleOpenToken = useCallback((token: MemeToken) => {
    router.push({
      pathname: '/meme-scanner/token-detail' as any,
      params: {
        tokenId: token.id,
        tokenData: JSON.stringify(token),
      },
    });
  }, [router]);

  const handleShortTrade = useCallback((token: MemeToken) => {
    setSelectedToken(token);
    setShowTradeModal(true);
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  }, []);

  const handleExecuteShort = useCallback(() => {
    if (!selectedToken) return;
    if (!tradeApiKey.trim() || !tradeApiSecret.trim()) {
      Alert.alert('خطا', 'لطفاً API Key و Secret صرافی را وارد کنید');
      return;
    }
    if (!tradeQuantity.trim() || parseFloat(tradeQuantity) <= 0) {
      Alert.alert('خطا', 'لطفاً حجم معامله را وارد کنید');
      return;
    }

    Alert.alert(
      'تأیید شورت',
      `آیا مطمئنید می‌خواهید ${selectedToken.symbol} را در ${EXCHANGES[tradeExchangeId]?.name ?? tradeExchangeId} شورت کنید؟\n\nحجم: ${tradeQuantity} USDT\nلوریج: ${selectedToken.shortSignal?.recommendedLeverage ?? 3}x\nورود: $${selectedToken.shortSignal?.entry?.toFixed(8) ?? selectedToken.currentPrice}\nSL: $${selectedToken.shortSignal?.stopLoss?.toFixed(8) ?? 'N/A'}`,
      [
        { text: 'انصراف', style: 'cancel' },
        {
          text: 'اجرا',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'ارسال شد',
              `سفارش شورت ${selectedToken.symbol} با حجم ${tradeQuantity} USDT ارسال شد.\n\nبرای مشاهده وضعیت به صرافی مراجعه کنید.`
            );
            setShowTradeModal(false);
            setSelectedToken(null);
            setTradeQuantity('');
          },
        },
      ]
    );
  }, [selectedToken, tradeApiKey, tradeApiSecret, tradeQuantity, tradeExchangeId]);

  const handleSaveExchange = useCallback(() => {
    if (!tradeApiKey.trim() || !tradeApiSecret.trim()) {
      Alert.alert('خطا', 'لطفاً API Key و Secret را وارد کنید');
      return;
    }
    const newConfig: MemeExchangeConfig = {
      id: `${tradeExchangeId}-${Date.now()}`,
      exchangeId: tradeExchangeId,
      apiKey: tradeApiKey.trim(),
      apiSecret: tradeApiSecret.trim(),
    };
    const updated = [...exchangeConfigs.filter(c => c.exchangeId !== tradeExchangeId), newConfig];
    saveExchangeMutation.mutate(updated);
    Alert.alert('ذخیره شد', `API صرافی ${EXCHANGES[tradeExchangeId]?.name} ذخیره شد`);
    setShowExchangeModal(false);
  }, [tradeApiKey, tradeApiSecret, tradeExchangeId, exchangeConfigs, saveExchangeMutation]);

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return colors.dark.red;
    if (confidence >= 65) return colors.dark.orange;
    return colors.dark.textMuted;
  };

  const getConfidenceIcon = (confidence: number) => {
    if (confidence >= 80) return <Skull size={14} color={colors.dark.red} />;
    if (confidence >= 65) return <Flame size={14} color={colors.dark.orange} />;
    return <Eye size={14} color={colors.dark.textMuted} />;
  };

  const renderToken = useCallback(({ item }: { item: MemeToken }) => {
    const signal = item.shortSignal;
    const confColor = getConfidenceColor(signal?.confidence ?? 0);
    const hasExchange = item.availableExchanges.length > 0;

    return (
      <Pressable
        style={({ pressed }) => [styles.tokenCard, pressed && styles.cardPressed]}
        onPress={() => handleOpenToken(item)}
        testID={`meme-token-${item.id}`}
      >
        <View style={styles.tokenHeader}>
          <View style={styles.tokenLeft}>
            <View style={[styles.chainBadge, { backgroundColor: getChainColor(item.chain) + '22' }]}>
              <Text style={[styles.chainText, { color: getChainColor(item.chain) }]}>
                {item.chain.toUpperCase().slice(0, 3)}
              </Text>
            </View>
            <View style={styles.tokenInfo}>
              <View style={styles.symbolRow}>
                <Text style={styles.tokenSymbol}>{item.symbol}</Text>
                {item.availableExchanges.length > 0 && (
                  <View style={styles.inlineExBadges}>
                    {item.availableExchanges.slice(0, 2).map((ex) => (
                      <View key={ex.exchangeId} style={styles.inlineExBadge}>
                        <Text style={styles.inlineExText}>{ex.exchangeId.slice(0, 3).toUpperCase()}</Text>
                      </View>
                    ))}
                    {item.availableExchanges.length > 2 && (
                      <Text style={styles.inlineExMore}>+{item.availableExchanges.length - 2}</Text>
                    )}
                  </View>
                )}
              </View>
              <Text style={styles.tokenName} numberOfLines={1}>{item.name}</Text>
            </View>
          </View>
          <View style={styles.tokenRight}>
            {signal && (
              <View style={[styles.confidenceBadge, { backgroundColor: confColor + '18', borderColor: confColor + '44' }]}>
                {getConfidenceIcon(signal.confidence)}
                <Text style={[styles.confidenceText, { color: confColor }]}>
                  {signal.confidence}٪
                </Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.tokenStats}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>قیمت</Text>
            <Text style={styles.statValue}>
              ${item.currentPrice < 0.001 ? item.currentPrice.toExponential(2) : item.currentPrice.toFixed(6)}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>پامپ ۲۴س</Text>
            <Text style={[styles.statValue, { color: item.priceChange24h > 0 ? colors.dark.green : colors.dark.red }]}>
              {item.priceChange24h > 0 ? '+' : ''}{item.priceChange24h.toFixed(0)}٪
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>حجم ۲۴س</Text>
            <Text style={styles.statValue}>
              ${item.volume24h > 1000000 ? (item.volume24h / 1000000).toFixed(1) + 'M' : (item.volume24h / 1000).toFixed(0) + 'K'}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>مارکت‌کپ</Text>
            <Text style={styles.statValue}>
              ${item.marketCap > 1000000 ? (item.marketCap / 1000000).toFixed(1) + 'M' : (item.marketCap / 1000).toFixed(0) + 'K'}
            </Text>
          </View>
        </View>

        {signal && signal.level !== 'avoid' && (
          <View style={[styles.signalBar, { borderColor: confColor + '33' }]}>
            <View style={styles.signalRow}>
              <Text style={[styles.signalLevel, { color: confColor }]}>{signal.levelText}</Text>
              <Text style={styles.signalLev}>لوریج: {signal.recommendedLeverage}x</Text>
            </View>
            {signal.entry > 0 && (
              <View style={styles.tradePoints}>
                <Text style={styles.tradePointText}>
                  ورود: ${signal.entry < 0.001 ? signal.entry.toExponential(2) : signal.entry.toFixed(6)}
                </Text>
                <Text style={[styles.tradePointText, { color: colors.dark.green }]}>
                  TP1: ${signal.target1 < 0.001 ? signal.target1.toExponential(2) : signal.target1.toFixed(6)}
                </Text>
                <Text style={[styles.tradePointText, { color: colors.dark.red }]}>
                  SL: ${signal.stopLoss < 0.001 ? signal.stopLoss.toExponential(2) : signal.stopLoss.toFixed(6)}
                </Text>
              </View>
            )}
          </View>
        )}

        <View style={styles.tokenFooter}>
          <Pressable
            style={styles.copyBtn}
            onPress={(e) => {
              e.stopPropagation?.();
              handleCopyAddress(item.contractAddress);
            }}
            hitSlop={8}
          >
            <Copy size={12} color={colors.dark.textMuted} />
            <Text style={styles.contractText} numberOfLines={1}>
              {item.contractAddress.slice(0, 8)}...{item.contractAddress.slice(-6)}
            </Text>
          </Pressable>

          <View style={styles.footerActions}>
            {hasExchange && (
              <Pressable
                style={styles.shortBtn}
                onPress={(e) => {
                  e.stopPropagation?.();
                  handleShortTrade(item);
                }}
              >
                <TrendingDown size={13} color="#FFF" />
                <Text style={styles.shortBtnText}>شورت</Text>
              </Pressable>
            )}
            {item.availableExchanges.length > 0 && (
              <View style={styles.exchangeBadges}>
                {item.availableExchanges.slice(0, 3).map((ex) => (
                  <View key={ex.exchangeId} style={styles.miniExBadge}>
                    <Text style={styles.miniExText}>{ex.exchangeId.slice(0, 3).toUpperCase()}</Text>
                  </View>
                ))}
                {item.availableExchanges.length > 3 && (
                  <Text style={styles.moreExText}>+{item.availableExchanges.length - 3}</Text>
                )}
              </View>
            )}
            <Text style={styles.moreInfoLabel}>اطلاعات بیشتر</Text>
            <ChevronRight size={14} color={colors.dark.textMuted} />
          </View>
        </View>
      </Pressable>
    );
  }, [handleOpenToken, handleCopyAddress, handleShortTrade, exchangeConfigs]);

  return (
    <View style={styles.container}>
      <View style={styles.warningBanner}>
        <Animated.View style={{ opacity: warningPulse }}>
          <AlertTriangle size={14} color={colors.dark.orange} />
        </Animated.View>
        <Text style={styles.warningText}>
          شورت میم‌کوین بسیار پرریسک است. ممکن است Short Squeeze رخ دهد!
        </Text>
      </View>

      <View style={styles.refreshTimerBar}>
        <View style={styles.refreshTimerLeft}>
          <Animated.View style={[styles.liveDot, { opacity: liveIndicator }]} />
          <Text style={styles.liveText}>اسکنر شورت میم</Text>
          <View style={styles.tokenCountBadge}>
            <Text style={styles.tokenCountText}>{tokens.length}</Text>
          </View>
        </View>
        <View style={styles.refreshTimerRight}>
          <View style={styles.countdownBadge}>
            <Text style={styles.countdownText}>{countdown}</Text>
          </View>
          <View style={styles.countdownBarTrack}>
            <Animated.View
              style={[
                styles.countdownBarFill,
                {
                  width: countdownBarAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0%', '100%'],
                  }),
                },
              ]}
            />
          </View>
        </View>
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Search size={16} color={colors.dark.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="جستجوی توکن یا آدرس..."
            placeholderTextColor={colors.dark.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            autoCapitalize="none"
            autoCorrect={false}
            testID="meme-search-input"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => { setSearchQuery(''); searchMutation.reset(); }}>
              <X size={16} color={colors.dark.textMuted} />
            </Pressable>
          )}
        </View>
        <Pressable
          style={[styles.filterBtn, showFilter && styles.filterBtnActive]}
          onPress={() => setShowFilter(!showFilter)}
        >
          <Filter size={16} color={showFilter ? colors.dark.background : colors.dark.accent} />
        </Pressable>
        <Pressable
          style={styles.exchangeBtn}
          onPress={() => setShowExchangeModal(true)}
        >
          <Settings size={16} color={colors.dark.blue} />
        </Pressable>
      </View>

      {showFilter && (
        <FilterPanel
          filter={filter}
          onSave={(newFilter) => {
            saveFilterMutation.mutate(newFilter);
            setShowFilter(false);
          }}
          onClose={() => setShowFilter(false)}
        />
      )}

      {(scanQuery.isLoading || searchMutation.isPending) && tokens.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.dark.red} />
          <Text style={styles.loadingText}>در حال اسکن میم‌کوین‌ها...</Text>
        </View>
      ) : tokens.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Skull size={48} color={colors.dark.textMuted} />
          <Text style={styles.emptyTitle}>میم‌کوینی برای شورت پیدا نشد</Text>
          <Text style={styles.emptySubtitle}>فیلترها را تغییر دهید یا منتظر بمانید</Text>
          <Pressable
            style={styles.retryBtn}
            onPress={() => queryClient.invalidateQueries({ queryKey: ['meme-scan'] })}
          >
            <RefreshCw size={16} color={colors.dark.accent} />
            <Text style={styles.retryBtnText}>اسکن مجدد</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={tokens}
          renderItem={renderToken}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          testID="meme-tokens-list"
        />
      )}

      <Modal visible={showTradeModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>شورت {selectedToken?.symbol}</Text>
              <Pressable onPress={() => setShowTradeModal(false)}>
                <X size={22} color={colors.dark.text} />
              </Pressable>
            </View>

            {selectedToken?.shortSignal && (
              <View style={styles.tradeInfoBox}>
                <Text style={styles.tradeInfoTitle}>اطلاعات سیگنال</Text>
                <View style={styles.tradeInfoRow}>
                  <Text style={styles.tradeInfoLabel}>Confidence:</Text>
                  <Text style={[styles.tradeInfoValue, { color: getConfidenceColor(selectedToken.shortSignal.confidence) }]}>
                    {selectedToken.shortSignal.confidence}٪
                  </Text>
                </View>
                <View style={styles.tradeInfoRow}>
                  <Text style={styles.tradeInfoLabel}>ورود:</Text>
                  <Text style={styles.tradeInfoValue}>
                    ${selectedToken.shortSignal.entry < 0.001 ? selectedToken.shortSignal.entry.toExponential(3) : selectedToken.shortSignal.entry.toFixed(8)}
                  </Text>
                </View>
                <View style={styles.tradeInfoRow}>
                  <Text style={styles.tradeInfoLabel}>هدف ۱:</Text>
                  <Text style={[styles.tradeInfoValue, { color: colors.dark.green }]}>
                    ${selectedToken.shortSignal.target1 < 0.001 ? selectedToken.shortSignal.target1.toExponential(3) : selectedToken.shortSignal.target1.toFixed(8)}
                  </Text>
                </View>
                <View style={styles.tradeInfoRow}>
                  <Text style={styles.tradeInfoLabel}>حد ضرر:</Text>
                  <Text style={[styles.tradeInfoValue, { color: colors.dark.red }]}>
                    ${selectedToken.shortSignal.stopLoss < 0.001 ? selectedToken.shortSignal.stopLoss.toExponential(3) : selectedToken.shortSignal.stopLoss.toFixed(8)}
                  </Text>
                </View>
                <View style={styles.tradeInfoRow}>
                  <Text style={styles.tradeInfoLabel}>لوریج:</Text>
                  <Text style={styles.tradeInfoValue}>{selectedToken.shortSignal.recommendedLeverage}x</Text>
                </View>
                <View style={styles.tradeInfoRow}>
                  <Text style={styles.tradeInfoLabel}>ریسک/ریوارد:</Text>
                  <Text style={styles.tradeInfoValue}>۱:{selectedToken.shortSignal.riskReward}</Text>
                </View>
              </View>
            )}

            <Text style={styles.inputLabel}>صرافی</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.exchangeScroll}>
              {selectedToken?.availableExchanges.map((ex) => (
                <Pressable
                  key={ex.exchangeId}
                  style={[styles.exchangeChip, tradeExchangeId === ex.exchangeId && styles.exchangeChipActive]}
                  onPress={() => {
                    setTradeExchangeId(ex.exchangeId);
                    const saved = exchangeConfigs.find(c => c.exchangeId === ex.exchangeId);
                    if (saved) {
                      setTradeApiKey(saved.apiKey);
                      setTradeApiSecret(saved.apiSecret);
                    }
                  }}
                >
                  <Text style={[styles.exchangeChipText, tradeExchangeId === ex.exchangeId && styles.exchangeChipTextActive]}>
                    {ex.exchangeName}
                  </Text>
                </Pressable>
              ))}
              {(selectedToken?.availableExchanges.length ?? 0) === 0 && (
                <View style={styles.noExchangeBox}>
                  <Text style={styles.noExchangeText}>این توکن در صرافی متمرکزی موجود نیست (فقط DEX)</Text>
                </View>
              )}
            </ScrollView>

            <Text style={styles.inputLabel}>API Key</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="API Key صرافی"
              placeholderTextColor={colors.dark.textMuted}
              value={tradeApiKey}
              onChangeText={setTradeApiKey}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.inputLabel}>API Secret</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="API Secret صرافی"
              placeholderTextColor={colors.dark.textMuted}
              value={tradeApiSecret}
              onChangeText={setTradeApiSecret}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <Text style={styles.inputLabel}>حجم ورودی (USDT)</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="مثال: 50"
              placeholderTextColor={colors.dark.textMuted}
              value={tradeQuantity}
              onChangeText={setTradeQuantity}
              keyboardType="numeric"
            />

            <Pressable
              style={[styles.executeBtn, (selectedToken?.availableExchanges.length ?? 0) === 0 && styles.executeBtnDisabled]}
              onPress={handleExecuteShort}
              disabled={(selectedToken?.availableExchanges.length ?? 0) === 0}
            >
              <TrendingDown size={18} color="#FFF" />
              <Text style={styles.executeBtnText}>اجرای شورت</Text>
            </Pressable>

            <View style={styles.riskWarning}>
              <AlertTriangle size={13} color={colors.dark.orange} />
              <Text style={styles.riskWarningText}>
                شورت میم‌کوین بسیار پرریسک است. فقط با سرمایه‌ای که حاضرید از دست بدهید وارد شوید.
              </Text>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showExchangeModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>تنظیم API صرافی</Text>
              <Pressable onPress={() => setShowExchangeModal(false)}>
                <X size={22} color={colors.dark.text} />
              </Pressable>
            </View>

            <Text style={styles.inputLabel}>صرافی</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.exchangeScroll}>
              {EXCHANGE_LIST.map((ex) => (
                <Pressable
                  key={ex.id}
                  style={[styles.exchangeChip, tradeExchangeId === ex.id && styles.exchangeChipActive]}
                  onPress={() => {
                    setTradeExchangeId(ex.id);
                    const saved = exchangeConfigs.find(c => c.exchangeId === ex.id);
                    if (saved) {
                      setTradeApiKey(saved.apiKey);
                      setTradeApiSecret(saved.apiSecret);
                    } else {
                      setTradeApiKey('');
                      setTradeApiSecret('');
                    }
                  }}
                >
                  <Text style={[styles.exchangeChipText, tradeExchangeId === ex.id && styles.exchangeChipTextActive]}>
                    {ex.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={styles.inputLabel}>API Key</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="API Key"
              placeholderTextColor={colors.dark.textMuted}
              value={tradeApiKey}
              onChangeText={setTradeApiKey}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.inputLabel}>API Secret</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="API Secret"
              placeholderTextColor={colors.dark.textMuted}
              value={tradeApiSecret}
              onChangeText={setTradeApiSecret}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />

            <Pressable style={styles.saveExBtn} onPress={handleSaveExchange}>
              <Shield size={16} color="#FFF" />
              <Text style={styles.saveExBtnText}>ذخیره API</Text>
            </Pressable>

            {exchangeConfigs.length > 0 && (
              <View style={styles.savedExList}>
                <Text style={styles.savedExTitle}>صرافی‌های ذخیره شده:</Text>
                {exchangeConfigs.map((c) => (
                  <View key={c.id} style={styles.savedExItem}>
                    <Text style={styles.savedExName}>{EXCHANGES[c.exchangeId]?.name ?? c.exchangeId}</Text>
                    <Text style={styles.savedExKey}>{c.apiKey.slice(0, 8)}...{c.apiKey.slice(-4)}</Text>
                    <Pressable
                      onPress={() => {
                        const updated = exchangeConfigs.filter(x => x.id !== c.id);
                        saveExchangeMutation.mutate(updated);
                      }}
                    >
                      <X size={14} color={colors.dark.red} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function FilterPanel({
  filter,
  onSave,
  onClose,
}: {
  filter: MemeScannerFilter;
  onSave: (f: MemeScannerFilter) => void;
  onClose: () => void;
}) {
  const [local, setLocal] = useState<MemeScannerFilter>(filter);

  return (
    <View style={filterStyles.container}>
      <View style={filterStyles.row}>
        <View style={filterStyles.field}>
          <Text style={filterStyles.label}>حداقل پامپ ٪</Text>
          <TextInput
            style={filterStyles.input}
            value={String(local.minPump)}
            onChangeText={(t) => setLocal({ ...local, minPump: Number(t) || 0 })}
            keyboardType="numeric"
          />
        </View>
        <View style={filterStyles.field}>
          <Text style={filterStyles.label}>حداقل حجم $</Text>
          <TextInput
            style={filterStyles.input}
            value={String(local.minVolume)}
            onChangeText={(t) => setLocal({ ...local, minVolume: Number(t) || 0 })}
            keyboardType="numeric"
          />
        </View>
      </View>
      <View style={filterStyles.row}>
        <View style={filterStyles.field}>
          <Text style={filterStyles.label}>مارکت‌کپ حداقل $</Text>
          <TextInput
            style={filterStyles.input}
            value={String(local.minMarketCap)}
            onChangeText={(t) => setLocal({ ...local, minMarketCap: Number(t) || 0 })}
            keyboardType="numeric"
          />
        </View>
        <View style={filterStyles.field}>
          <Text style={filterStyles.label}>مارکت‌کپ حداکثر $</Text>
          <TextInput
            style={filterStyles.input}
            value={String(local.maxMarketCap)}
            onChangeText={(t) => setLocal({ ...local, maxMarketCap: Number(t) || 0 })}
            keyboardType="numeric"
          />
        </View>
      </View>
      <View style={filterStyles.row}>
        <View style={filterStyles.field}>
          <Text style={filterStyles.label}>حداقل Confidence ٪</Text>
          <TextInput
            style={filterStyles.input}
            value={String(local.minConfidence)}
            onChangeText={(t) => setLocal({ ...local, minConfidence: Number(t) || 0 })}
            keyboardType="numeric"
          />
        </View>
        <View style={filterStyles.field}>
          <Text style={filterStyles.label}>حداقل لیکوییدیتی $</Text>
          <TextInput
            style={filterStyles.input}
            value={String(local.minLiquidity)}
            onChangeText={(t) => setLocal({ ...local, minLiquidity: Number(t) || 0 })}
            keyboardType="numeric"
          />
        </View>
      </View>
      <View style={filterStyles.chainRow}>
        {['solana', 'ethereum', 'bsc', 'base', 'arbitrum'].map((chain) => (
          <Pressable
            key={chain}
            style={[filterStyles.chainChip, local.chains.includes(chain) && filterStyles.chainChipActive]}
            onPress={() => {
              const chains = local.chains.includes(chain)
                ? local.chains.filter((c) => c !== chain)
                : [...local.chains, chain];
              setLocal({ ...local, chains });
            }}
          >
            <Text style={[filterStyles.chainChipText, local.chains.includes(chain) && filterStyles.chainChipTextActive]}>
              {chain}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={filterStyles.actions}>
        <Pressable style={filterStyles.cancelBtn} onPress={onClose}>
          <Text style={filterStyles.cancelText}>انصراف</Text>
        </Pressable>
        <Pressable style={filterStyles.saveBtn} onPress={() => onSave(local)}>
          <Text style={filterStyles.saveText}>اعمال فیلتر</Text>
        </Pressable>
      </View>
    </View>
  );
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

const filterStyles = createThemedStyles(() => StyleSheet.create({
  container: {
    backgroundColor: colors.dark.surface,
    marginHorizontal: 16,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.dark.border,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  field: {
    flex: 1,
  },
  label: {
    fontSize: 11,
    color: colors.dark.textSecondary,
    marginBottom: 4,
    textAlign: 'right',
  },
  input: {
    backgroundColor: colors.dark.inputBg,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: colors.dark.text,
    borderWidth: 1,
    borderColor: colors.dark.border,
    textAlign: 'center',
  },
  chainRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  chainChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.dark.inputBg,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  chainChipActive: {
    backgroundColor: colors.dark.accent + '22',
    borderColor: colors.dark.accent + '55',
  },
  chainChipText: {
    fontSize: 11,
    color: colors.dark.textMuted,
    fontWeight: '600' as const,
  },
  chainChipTextActive: {
    color: colors.dark.accent,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.dark.inputBg,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 13,
    color: colors.dark.textSecondary,
    fontWeight: '600' as const,
  },
  saveBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.dark.accent,
    alignItems: 'center',
  },
  saveText: {
    fontSize: 13,
    color: colors.dark.background,
    fontWeight: '700' as const,
  },
}));

const styles = createThemedStyles(() => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.background,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark.orange + '12',
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.dark.orange + '33',
    gap: 8,
  },
  warningText: {
    fontSize: 11,
    color: colors.dark.orange,
    flex: 1,
    textAlign: 'right',
    lineHeight: 18,
  },
  refreshTimerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.dark.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: colors.dark.red + '33',
  },
  refreshTimerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  refreshTimerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.dark.red,
  },
  liveText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  tokenCountBadge: {
    backgroundColor: colors.dark.red + '22',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  tokenCountText: {
    fontSize: 11,
    fontWeight: '800' as const,
    color: colors.dark.red,
  },
  countdownBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.dark.red + '22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownText: {
    fontSize: 12,
    fontWeight: '800' as const,
    color: colors.dark.red,
  },
  countdownBarTrack: {
    width: 60,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.dark.border,
    overflow: 'hidden',
  },
  countdownBarFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.dark.red,
  },
  searchRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.dark.border,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: colors.dark.text,
    textAlign: 'right',
  },
  filterBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: colors.dark.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.dark.accent + '44',
  },
  filterBtnActive: {
    backgroundColor: colors.dark.accent,
  },
  exchangeBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: colors.dark.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.dark.blue + '44',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 14,
    color: colors.dark.textSecondary,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: colors.dark.text,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: colors.dark.textSecondary,
    textAlign: 'center',
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.dark.accent + '22',
    marginTop: 8,
  },
  retryBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.dark.accent,
  },
  listContent: {
    paddingTop: 4,
    paddingBottom: 24,
  },
  tokenCard: {
    backgroundColor: colors.dark.surface,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  cardPressed: {
    opacity: 0.85,
    backgroundColor: colors.dark.surfaceLight,
  },
  tokenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  tokenLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  chainBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  chainText: {
    fontSize: 9,
    fontWeight: '800' as const,
  },
  tokenInfo: {
    flex: 1,
  },
  tokenSymbol: {
    fontSize: 15,
    fontWeight: '800' as const,
    color: colors.dark.text,
  },
  tokenName: {
    fontSize: 11,
    color: colors.dark.textSecondary,
    marginTop: 1,
  },
  tokenRight: {
    alignItems: 'flex-end',
  },
  confidenceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
  },
  confidenceText: {
    fontSize: 13,
    fontWeight: '800' as const,
  },
  tokenStats: {
    flexDirection: 'row',
    backgroundColor: colors.dark.card,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statLabel: {
    fontSize: 9,
    color: colors.dark.textMuted,
  },
  statValue: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  signalBar: {
    backgroundColor: colors.dark.card,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
  },
  signalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  signalLevel: {
    fontSize: 11,
    fontWeight: '700' as const,
  },
  signalLev: {
    fontSize: 11,
    color: colors.dark.textSecondary,
    fontWeight: '600' as const,
  },
  tradePoints: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tradePointText: {
    fontSize: 10,
    color: colors.dark.textSecondary,
    fontWeight: '600' as const,
  },
  tokenFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  contractText: {
    fontSize: 10,
    color: colors.dark.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  footerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  shortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.dark.red,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  shortBtnText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  exchangeBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  miniExBadge: {
    backgroundColor: colors.dark.blue + '22',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  miniExText: {
    fontSize: 8,
    fontWeight: '700' as const,
    color: colors.dark.blue,
  },
  moreExText: {
    fontSize: 9,
    color: colors.dark.textMuted,
  },
  symbolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inlineExBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  inlineExBadge: {
    backgroundColor: colors.dark.blue + '22',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  inlineExText: {
    fontSize: 7,
    fontWeight: '700' as const,
    color: colors.dark.blue,
  },
  inlineExMore: {
    fontSize: 8,
    color: colors.dark.textMuted,
  },
  moreInfoLabel: {
    fontSize: 10,
    color: colors.dark.accent,
    fontWeight: '600' as const,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.dark.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800' as const,
    color: colors.dark.text,
  },
  tradeInfoBox: {
    backgroundColor: colors.dark.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  tradeInfoTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: colors.dark.text,
    marginBottom: 10,
    textAlign: 'center',
  },
  tradeInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  tradeInfoLabel: {
    fontSize: 12,
    color: colors.dark.textSecondary,
  },
  tradeInfoValue: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  inputLabel: {
    fontSize: 12,
    color: colors.dark.textSecondary,
    marginBottom: 6,
    marginTop: 10,
    textAlign: 'right',
  },
  exchangeScroll: {
    maxHeight: 40,
    marginBottom: 4,
  },
  exchangeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.dark.inputBg,
    marginRight: 8,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  exchangeChipActive: {
    backgroundColor: colors.dark.accent + '22',
    borderColor: colors.dark.accent,
  },
  exchangeChipText: {
    fontSize: 11,
    color: colors.dark.textMuted,
    fontWeight: '600' as const,
  },
  exchangeChipTextActive: {
    color: colors.dark.accent,
  },
  noExchangeBox: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  noExchangeText: {
    fontSize: 11,
    color: colors.dark.orange,
  },
  modalInput: {
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
  executeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dark.red,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 16,
    gap: 8,
  },
  executeBtnDisabled: {
    opacity: 0.4,
  },
  executeBtnText: {
    fontSize: 15,
    fontWeight: '800' as const,
    color: '#FFF',
  },
  riskWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    backgroundColor: colors.dark.orange + '12',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  riskWarningText: {
    fontSize: 10,
    color: colors.dark.orange,
    flex: 1,
    textAlign: 'right',
    lineHeight: 16,
  },
  saveExBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dark.blue,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 16,
    gap: 8,
  },
  saveExBtnText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  savedExList: {
    marginTop: 16,
  },
  savedExTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: colors.dark.text,
    marginBottom: 8,
    textAlign: 'right',
  },
  savedExItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.dark.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  savedExName: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: colors.dark.text,
    flex: 1,
  },
  savedExKey: {
    fontSize: 10,
    color: colors.dark.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginHorizontal: 8,
  },
}));
