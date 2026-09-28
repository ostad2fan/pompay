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
  Linking,
} from 'react-native';
import {
  Search,
  TrendingUp,
  AlertTriangle,
  ChevronRight,
  RefreshCw,
  Filter,
  Copy,
  ExternalLink,
  X,
  Shield,
  Zap,
  Calendar,
  CheckCircle,
  XCircle,
  Clock,
  Star,
} from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import colors from '@/constants/colors';
import { createThemedStyles } from '@/utils/themeStyles';
import { EXCHANGES } from '@/constants/exchanges';
import { useApp } from '@/contexts/AppContext';
import { sendTelegramPreListingAlert } from '@/utils/telegramService';

interface PreListingToken {
  id: string;
  name: string;
  symbol: string;
  contractAddress: string;
  chain: string;
  currentPrice: number;
  priceChange24h: number;
  volume24h: number;
  marketCap: number;
  liquidity: number;
  holders: number;
  dexUrl: string;
  expectedListingDate: string;
  expectedExchange: string;
  listingConfidence: number;
  isScam: boolean;
  scamReason: string;
  socialScore: number;
  devWalletPercent: number;
  mintAuthority: boolean;
  topHolderPercent: number;
  buyLink: string;
  scanTimestamp: number;
}

const DEXSCREENER_BASE = 'https://api.dexscreener.com';

async function fetchPreListingTokens(): Promise<PreListingToken[]> {
  try {
    console.log('[PreListing] Fetching potential pre-listing tokens...');

    const [boostRes, trendRes] = await Promise.all([
      fetch(`${DEXSCREENER_BASE}/token-boosts/latest/v1`).then(r => r.ok ? r.json() : []).catch(() => []),
      fetch(`${DEXSCREENER_BASE}/latest/dex/search?q=new+launch+meme`).then(r => r.ok ? r.json() : { pairs: [] }).catch(() => ({ pairs: [] })),
    ]);

    const boostedTokens = Array.isArray(boostRes) ? boostRes : [];
    const trendPairs = trendRes?.pairs ?? [];

    const tokenAddresses = boostedTokens.slice(0, 10).map((t: any) => t.tokenAddress).filter(Boolean);
    let boostedPairs: any[] = [];
    for (const addr of tokenAddresses.slice(0, 5)) {
      try {
        const res = await fetch(`${DEXSCREENER_BASE}/latest/dex/tokens/${addr}`);
        if (res.ok) {
          const data = await res.json();
          if (data.pairs) boostedPairs.push(...data.pairs);
        }
      } catch {}
    }

    const allPairs = [...boostedPairs, ...trendPairs];
    const seen = new Set<string>();
    const unique = allPairs.filter((p: any) => {
      const key = `${p.chainId}-${p.pairAddress}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const tokens: PreListingToken[] = unique
      .filter((pair: any) => {
        const fdv = pair.fdv ?? 0;
        const vol = pair.volume?.h24 ?? 0;
        const liq = pair.liquidity?.usd ?? 0;
        const age = (Date.now() - (pair.pairCreatedAt ?? 0)) / (1000 * 60 * 60);
        return fdv > 100000 && fdv < 100000000 && vol > 10000 && liq > 5000 && age < 168;
      })
      .map((pair: any) => {
        const price = parseFloat(pair.priceUsd ?? '0');
        const fdv = pair.fdv ?? 0;
        const vol = pair.volume?.h24 ?? 0;
        const liq = pair.liquidity?.usd ?? 0;
        const change24 = pair.priceChange?.h24 ?? 0;

        const sells24 = pair.txns?.h24?.sells ?? 0;
        const buys24 = pair.txns?.h24?.buys ?? 0;
        const sellRatio = sells24 / Math.max(1, buys24);
        const hasSocials = pair.info?.socials && pair.info.socials.length > 0;

        let listingConf = 30;
        if (fdv > 5000000) listingConf += 20;
        else if (fdv > 1000000) listingConf += 10;
        if (vol > 1000000) listingConf += 15;
        else if (vol > 500000) listingConf += 10;
        if (hasSocials) listingConf += 10;
        if (change24 > 100) listingConf += 10;
        if (liq > 100000) listingConf += 5;
        listingConf = Math.min(95, listingConf);

        let isScam = false;
        let scamReason = '';
        if (liq < 10000 && fdv > 5000000) {
          isScam = true;
          scamReason = 'لیکوییدیتی بسیار پایین نسبت به مارکت‌کپ';
        }
        if (sellRatio > 3) {
          isScam = true;
          scamReason = 'فروش‌ها بسیار بیشتر از خریدها (احتمال راگ)';
        }

        let expectedExchange = 'نامشخص';
        if (fdv > 50000000 && vol > 5000000) expectedExchange = 'بایننس / بای‌بیت';
        else if (fdv > 10000000 && vol > 1000000) expectedExchange = 'بای‌بیت / OKX / MEXC';
        else if (fdv > 5000000) expectedExchange = 'MEXC / Gate.io / Bitget';
        else if (fdv > 1000000) expectedExchange = 'MEXC / Gate.io / LBank';
        else expectedExchange = 'صرافی‌های کوچک‌تر';

        const ageHours = (Date.now() - (pair.pairCreatedAt ?? 0)) / (1000 * 60 * 60);
        let expectedDate = 'نامشخص';
        if (listingConf > 70) {
          const days = Math.max(1, Math.round(7 - (listingConf - 70) / 10));
          const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
          expectedDate = `حدود ${date.toLocaleDateString('fa-IR')}`;
        } else if (listingConf > 50) {
          expectedDate = '۱-۲ هفته آینده';
        } else {
          expectedDate = 'احتمال کم';
        }

        return {
          id: `${pair.chainId}-${pair.pairAddress}`,
          name: pair.baseToken?.name ?? 'Unknown',
          symbol: pair.baseToken?.symbol ?? '???',
          contractAddress: pair.baseToken?.address ?? '',
          chain: pair.chainId ?? 'solana',
          currentPrice: price,
          priceChange24h: change24,
          volume24h: vol,
          marketCap: fdv,
          liquidity: liq,
          holders: buys24 + sells24,
          dexUrl: pair.url ?? '',
          expectedListingDate: expectedDate,
          expectedExchange,
          listingConfidence: listingConf,
          isScam,
          scamReason,
          socialScore: hasSocials ? 70 : 30,
          devWalletPercent: 0,
          mintAuthority: false,
          topHolderPercent: 0,
          buyLink: pair.url ?? '',
          scanTimestamp: Date.now(),
        };
      });

    tokens.sort((a, b) => b.listingConfidence - a.listingConfidence);
    return tokens.filter(t => !t.isScam).slice(0, 40);
  } catch (error) {
    console.log('[PreListing] Scan error:', error);
    return [];
  }
}

export default function PreListingScreen() {
  const queryClient = useQueryClient();
  const { settings } = useApp();
  const prevTokenIdsRef = useRef<Set<string>>(new Set());

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedToken, setSelectedToken] = useState<PreListingToken | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const [countdown, setCountdown] = useState(3);
  const countdownBarAnim = useRef(new Animated.Value(1)).current;
  const liveIndicator = useRef(new Animated.Value(0)).current;

  const scanQuery = useQuery({
    queryKey: ['pre-listing-scan'],
    queryFn: fetchPreListingTokens,
    refetchInterval: 3000,
    staleTime: 2000,
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
    const interval = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? 3 : prev - 1));
    }, 1000);
    const startBarAnim = () => {
      countdownBarAnim.setValue(1);
      Animated.timing(countdownBarAnim, { toValue: 0, duration: 3000, useNativeDriver: false }).start();
    };
    startBarAnim();
    const barInterval = setInterval(startBarAnim, 3000);
    return () => { clearInterval(interval); clearInterval(barInterval); };
  }, [countdownBarAnim]);

  useEffect(() => {
    if (!scanQuery.data || !settings.telegramEnabled || !(settings.preListingNotifications ?? true)) return;
    const newTokens = scanQuery.data.filter((t) => {
      if (prevTokenIdsRef.current.has(t.id)) return false;
      return t.listingConfidence >= 60;
    });
    for (const t of scanQuery.data) {
      prevTokenIdsRef.current.add(t.id);
    }
    if (prevTokenIdsRef.current.size > 500) {
      const arr = Array.from(prevTokenIdsRef.current);
      prevTokenIdsRef.current = new Set(arr.slice(-200));
    }
    for (const t of newTokens.slice(0, 3)) {
      sendTelegramPreListingAlert({
        name: t.name,
        symbol: t.symbol,
        currentPrice: t.currentPrice,
        marketCap: t.marketCap,
        exchange: t.expectedExchange,
        listingDate: t.expectedListingDate,
      }).catch(() => {});
    }
  }, [scanQuery.data, settings.telegramEnabled, settings.preListingNotifications]);

  const tokens = useMemo(() => {
    const data = scanQuery.data ?? [];
    if (!searchQuery.trim()) return data;
    const q = searchQuery.toLowerCase();
    return data.filter(t => t.name.toLowerCase().includes(q) || t.symbol.toLowerCase().includes(q));
  }, [scanQuery.data, searchQuery]);

  const handleCopyAddress = useCallback(async (address: string) => {
    try {
      await Clipboard.setStringAsync(address);
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('کپی شد', 'آدرس قرارداد کپی شد');
    } catch {}
  }, []);

  const getConfidenceColor = (conf: number) => {
    if (conf >= 70) return colors.dark.green;
    if (conf >= 50) return colors.dark.orange;
    return colors.dark.textMuted;
  };

  const renderToken = useCallback(({ item }: { item: PreListingToken }) => {
    const confColor = getConfidenceColor(item.listingConfidence);
    return (
      <Pressable
        style={({ pressed }) => [styles.tokenCard, pressed && styles.cardPressed]}
        onPress={() => { setSelectedToken(item); setShowDetail(true); }}
        testID={`prelisting-token-${item.id}`}
      >
        <View style={styles.tokenHeader}>
          <View style={styles.tokenLeft}>
            <View style={[styles.chainBadge, { backgroundColor: getChainColor(item.chain) + '22' }]}>
              <Text style={[styles.chainText, { color: getChainColor(item.chain) }]}>
                {item.chain.toUpperCase().slice(0, 3)}
              </Text>
            </View>
            <View style={styles.tokenInfo}>
              <Text style={styles.tokenSymbol}>{item.symbol}</Text>
              <Text style={styles.tokenName} numberOfLines={1}>{item.name}</Text>
            </View>
          </View>
          <View style={styles.tokenRight}>
            <View style={[styles.confidenceBadge, { backgroundColor: confColor + '18', borderColor: confColor + '44' }]}>
              <Star size={12} color={confColor} />
              <Text style={[styles.confidenceText, { color: confColor }]}>{item.listingConfidence}٪</Text>
            </View>
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
            <Text style={styles.statLabel}>تغییر ۲۴س</Text>
            <Text style={[styles.statValue, { color: item.priceChange24h > 0 ? colors.dark.green : colors.dark.red }]}>
              {item.priceChange24h > 0 ? '+' : ''}{item.priceChange24h.toFixed(0)}٪
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>حجم</Text>
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

        <View style={styles.listingInfo}>
          <View style={styles.listingRow}>
            <Calendar size={12} color={colors.dark.blue} />
            <Text style={styles.listingLabel}>تاریخ احتمالی لیست:</Text>
            <Text style={styles.listingValue}>{item.expectedListingDate}</Text>
          </View>
          <View style={styles.listingRow}>
            <Zap size={12} color={colors.dark.orange} />
            <Text style={styles.listingLabel}>صرافی احتمالی:</Text>
            <Text style={[styles.listingValue, { color: colors.dark.orange }]}>{item.expectedExchange}</Text>
          </View>
        </View>

        <View style={styles.tokenFooter}>
          <Pressable
            style={styles.copyBtn}
            onPress={(e) => { e.stopPropagation?.(); handleCopyAddress(item.contractAddress); }}
            hitSlop={8}
          >
            <Copy size={12} color={colors.dark.textMuted} />
            <Text style={styles.contractText} numberOfLines={1}>
              {item.contractAddress.slice(0, 8)}...{item.contractAddress.slice(-6)}
            </Text>
          </Pressable>
          <View style={styles.footerRight}>
            <Text style={styles.moreInfoText}>اطلاعات بیشتر</Text>
            <ChevronRight size={14} color={colors.dark.textMuted} />
          </View>
        </View>
      </Pressable>
    );
  }, [handleCopyAddress]);

  return (
    <View style={styles.container}>
      <View style={styles.infoBanner}>
        <AlertTriangle size={14} color={colors.dark.orange} />
        <Text style={styles.infoText}>
          میم‌کوین‌ها قبل از لیست شدن بسیار پرریسک هستند. حتماً تحقیق کنید!
        </Text>
      </View>

      <View style={styles.refreshTimerBar}>
        <View style={styles.refreshTimerLeft}>
          <Animated.View style={[styles.liveDot, { opacity: liveIndicator }]} />
          <Text style={styles.liveText}>اسکنر قبل لیست</Text>
          <View style={styles.tokenCountBadge}>
            <Text style={styles.tokenCountText}>{tokens.length}</Text>
          </View>
        </View>
        <View style={styles.refreshTimerRight}>
          <View style={styles.countdownBadge}>
            <Text style={styles.countdownTextNum}>{countdown}</Text>
          </View>
          <View style={styles.countdownBarTrack}>
            <Animated.View
              style={[styles.countdownBarFill, {
                width: countdownBarAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
              }]}
            />
          </View>
        </View>
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Search size={16} color={colors.dark.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="جستجوی توکن..."
            placeholderTextColor={colors.dark.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')}>
              <X size={16} color={colors.dark.textMuted} />
            </Pressable>
          )}
        </View>
      </View>

      {scanQuery.isLoading && tokens.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.dark.green} />
          <Text style={styles.loadingText}>در حال اسکن میم‌کوین‌ها...</Text>
        </View>
      ) : tokens.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Star size={48} color={colors.dark.textMuted} />
          <Text style={styles.emptyTitle}>توکنی پیدا نشد</Text>
          <Pressable
            style={styles.retryBtn}
            onPress={() => queryClient.invalidateQueries({ queryKey: ['pre-listing-scan'] })}
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
        />
      )}

      <Modal visible={showDetail} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{selectedToken?.symbol} - {selectedToken?.name}</Text>
                <Pressable onPress={() => setShowDetail(false)}>
                  <X size={22} color={colors.dark.text} />
                </Pressable>
              </View>

              {selectedToken && (
                <>
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>اطلاعات توکن</Text>
                    <DetailRow label="قیمت فعلی" value={`$${selectedToken.currentPrice < 0.001 ? selectedToken.currentPrice.toExponential(3) : selectedToken.currentPrice.toFixed(8)}`} />
                    <DetailRow label="تغییر ۲۴ ساعته" value={`${selectedToken.priceChange24h.toFixed(1)}٪`} color={selectedToken.priceChange24h > 0 ? colors.dark.green : colors.dark.red} />
                    <DetailRow label="حجم ۲۴ ساعته" value={`$${formatNum(selectedToken.volume24h)}`} />
                    <DetailRow label="مارکت‌کپ" value={`$${formatNum(selectedToken.marketCap)}`} />
                    <DetailRow label="لیکوییدیتی" value={`$${formatNum(selectedToken.liquidity)}`} />
                    <DetailRow label="شبکه" value={selectedToken.chain.toUpperCase()} />
                  </View>

                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>اطلاعات لیست شدن</Text>
                    <DetailRow label="احتمال لیست شدن" value={`${selectedToken.listingConfidence}٪`} color={getConfidenceColor(selectedToken.listingConfidence)} />
                    <DetailRow label="تاریخ احتمالی" value={selectedToken.expectedListingDate} />
                    <DetailRow label="صرافی احتمالی" value={selectedToken.expectedExchange} color={colors.dark.orange} />
                  </View>

                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>بررسی امنیت</Text>
                    <View style={styles.securityRow}>
                      {selectedToken.isScam ? (
                        <XCircle size={16} color={colors.dark.red} />
                      ) : (
                        <CheckCircle size={16} color={colors.dark.green} />
                      )}
                      <Text style={[styles.securityText, { color: selectedToken.isScam ? colors.dark.red : colors.dark.green }]}>
                        {selectedToken.isScam ? `هشدار: ${selectedToken.scamReason}` : 'بررسی اولیه: مشکوک به کلاهبرداری نیست'}
                      </Text>
                    </View>
                    <DetailRow label="امتیاز اجتماعی" value={`${selectedToken.socialScore}/100`} />
                  </View>

                  <Pressable style={styles.contractBox} onPress={() => handleCopyAddress(selectedToken.contractAddress)}>
                    <Copy size={14} color={colors.dark.textMuted} />
                    <Text style={styles.contractFullText} numberOfLines={1}>{selectedToken.contractAddress}</Text>
                  </Pressable>

                  <View style={styles.detailActions}>
                    <Pressable
                      style={styles.dexBtn}
                      onPress={() => { if (selectedToken.dexUrl) Linking.openURL(selectedToken.dexUrl); }}
                    >
                      <ExternalLink size={16} color={colors.dark.blue} />
                      <Text style={styles.dexBtnText}>مشاهده در DexScreener</Text>
                    </Pressable>

                    <Pressable
                      style={styles.buyBtn}
                      onPress={() => { if (selectedToken.buyLink) Linking.openURL(selectedToken.buyLink); }}
                    >
                      <TrendingUp size={16} color="#FFF" />
                      <Text style={styles.buyBtnText}>خرید توکن</Text>
                    </Pressable>
                  </View>

                  <View style={styles.riskWarning}>
                    <AlertTriangle size={13} color={colors.dark.orange} />
                    <Text style={styles.riskWarningText}>
                      خرید میم‌کوین قبل از لیست بسیار پرریسک است. فقط با سرمایه‌ای که حاضرید از دست بدهید وارد شوید.
                    </Text>
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function DetailRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={detailStyles.row}>
      <Text style={detailStyles.label}>{label}</Text>
      <Text style={[detailStyles.value, color ? { color } : undefined]}>{value}</Text>
    </View>
  );
}

function formatNum(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return n.toFixed(0);
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

const detailStyles = createThemedStyles(() => StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.dark.border,
  },
  label: {
    fontSize: 12,
    color: colors.dark.textSecondary,
  },
  value: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
}));

const styles = createThemedStyles(() => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.background,
  },
  infoBanner: {
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
  infoText: {
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
    borderColor: colors.dark.green + '33',
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
    backgroundColor: colors.dark.green,
  },
  liveText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  tokenCountBadge: {
    backgroundColor: colors.dark.green + '22',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  tokenCountText: {
    fontSize: 11,
    fontWeight: '800' as const,
    color: colors.dark.green,
  },
  countdownBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.dark.green + '22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownTextNum: {
    fontSize: 12,
    fontWeight: '800' as const,
    color: colors.dark.green,
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
    backgroundColor: colors.dark.green,
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
  listingInfo: {
    backgroundColor: colors.dark.card,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    gap: 6,
  },
  listingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  listingLabel: {
    fontSize: 11,
    color: colors.dark.textSecondary,
  },
  listingValue: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: colors.dark.text,
    flex: 1,
    textAlign: 'left',
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
  footerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  moreInfoText: {
    fontSize: 11,
    color: colors.dark.accent,
    fontWeight: '600' as const,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.dark.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '85%',
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: colors.dark.text,
    flex: 1,
  },
  detailSection: {
    backgroundColor: colors.dark.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  detailSectionTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: colors.dark.text,
    marginBottom: 8,
    textAlign: 'right',
  },
  securityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  securityText: {
    fontSize: 12,
    flex: 1,
    textAlign: 'right',
    lineHeight: 20,
  },
  contractBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.dark.surface,
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  contractFullText: {
    fontSize: 11,
    color: colors.dark.textMuted,
    flex: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  detailActions: {
    gap: 8,
    marginBottom: 12,
  },
  dexBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.dark.blue + '15',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.dark.blue + '33',
  },
  dexBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.dark.blue,
  },
  buyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.dark.green,
    padding: 14,
    borderRadius: 12,
  },
  buyBtnText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  riskWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.dark.orange + '10',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.dark.orange + '33',
  },
  riskWarningText: {
    fontSize: 11,
    color: colors.dark.orange,
    flex: 1,
    textAlign: 'right',
    lineHeight: 18,
  },
}));
