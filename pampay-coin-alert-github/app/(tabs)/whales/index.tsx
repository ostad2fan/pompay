import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  FlatList,
  Alert,
  Animated,
  Platform,
} from 'react-native';
import {
  Search,
  Plus,
  Trash2,
  Eye,
  Trophy,
  TrendingUp,
  Wallet,
  ChevronRight,
  Crown,
  Star,
  Target,
  Copy,
  Info,
  RefreshCw,
  X,
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import colors from '@/constants/colors';
import { createThemedStyles } from '@/utils/themeStyles';
import { WhaleWallet, TopWhale } from '@/types/whale';
import { MOCK_TOP_WHALES } from '@/mocks/whales';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const TRACKED_WALLETS_KEY = '@tracked_whale_wallets';

type TabType = 'tracked' | 'top';

async function loadTrackedWallets(): Promise<WhaleWallet[]> {
  try {
    const stored = await AsyncStorage.getItem(TRACKED_WALLETS_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.log('[WhaleTracker] Error loading wallets:', e);
  }
  return [];
}

export default function WhaleTrackerScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabType>('tracked');
  const [addressInput, setAddressInput] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const formAnim = useRef(new Animated.Value(0)).current;

  const [countdown, setCountdown] = useState(3);
  const countdownBarAnim = useRef(new Animated.Value(1)).current;
  const liveIndicator = useRef(new Animated.Value(0)).current;

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
      setCountdown((prev) => {
        if (prev <= 1) {
          queryClient.invalidateQueries({ queryKey: ['tracked-wallets'] });
          return 3;
        }
        return prev - 1;
      });
    }, 1000);

    const startBarAnim = () => {
      countdownBarAnim.setValue(1);
      Animated.timing(countdownBarAnim, {
        toValue: 0,
        duration: 3000,
        useNativeDriver: false,
      }).start();
    };
    startBarAnim();
    const barInterval = setInterval(startBarAnim, 3000);

    return () => {
      clearInterval(interval);
      clearInterval(barInterval);
    };
  }, [countdownBarAnim, queryClient]);

  const walletsQuery = useQuery({
    queryKey: ['tracked-wallets'],
    queryFn: loadTrackedWallets,
    staleTime: Infinity,
  });

  const trackedWallets = walletsQuery.data ?? [];

  const saveMutation = useMutation({
    mutationFn: async (wallets: WhaleWallet[]) => {
      await AsyncStorage.setItem(TRACKED_WALLETS_KEY, JSON.stringify(wallets));
      return wallets;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tracked-wallets'] });
    },
  });

  useEffect(() => {
    Animated.timing(formAnim, {
      toValue: showAddForm ? 1 : 0,
      duration: 250,
      useNativeDriver: false,
    }).start();
  }, [showAddForm]);

  const handleAddWallet = useCallback(() => {
    if (!addressInput.trim()) {
      Alert.alert('خطا', 'لطفاً آدرس کیف پول را وارد کنید');
      return;
    }
    if (addressInput.trim().length < 10) {
      Alert.alert('خطا', 'آدرس کیف پول نامعتبر است');
      return;
    }
    const exists = trackedWallets.some((w) => w.address === addressInput.trim());
    if (exists) {
      Alert.alert('توجه', 'این آدرس قبلاً در لیست ردیابی شماست');
      return;
    }
    const newWallet: WhaleWallet = {
      id: Date.now().toString(),
      address: addressInput.trim(),
      label: labelInput.trim() || `نهنگ ${trackedWallets.length + 1}`,
      addedAt: Date.now(),
      pnl30d: Math.random() * 500000 + 50000,
      winRate: Math.random() * 30 + 60,
    };
    const updated = [...trackedWallets, newWallet];
    saveMutation.mutate(updated);
    setAddressInput('');
    setLabelInput('');
    setShowAddForm(false);
  }, [addressInput, labelInput, trackedWallets]);

  const handleRemoveWallet = useCallback(
    (id: string) => {
      Alert.alert('حذف نهنگ', 'آیا از حذف این نهنگ از لیست ردیابی اطمینان دارید؟', [
        { text: 'انصراف', style: 'cancel' },
        {
          text: 'حذف',
          style: 'destructive',
          onPress: () => {
            const updated = trackedWallets.filter((w) => w.id !== id);
            saveMutation.mutate(updated);
          },
        },
      ]);
    },
    [trackedWallets]
  );

  const handleTrackTopWhale = useCallback(
    (whale: TopWhale) => {
      const exists = trackedWallets.some((w) => w.address === whale.address);
      if (exists) {
        Alert.alert('حذف از لیست ردیابی', `آیا می‌خواهید "${whale.label}" را از لیست ردیابی حذف کنید؟`, [
          { text: 'انصراف', style: 'cancel' },
          {
            text: 'حذف',
            style: 'destructive',
            onPress: () => {
              const updated = trackedWallets.filter((w) => w.address !== whale.address);
              saveMutation.mutate(updated);
              Alert.alert('حذف شد', `${whale.label} از لیست ردیابی حذف شد`);
            },
          },
        ]);
        return;
      }
      const newWallet: WhaleWallet = {
        id: Date.now().toString(),
        address: whale.address,
        label: whale.label,
        addedAt: Date.now(),
        pnl30d: whale.pnl30d,
        winRate: whale.winRate,
      };
      const updated = [...trackedWallets, newWallet];
      saveMutation.mutate(updated);
      Alert.alert('موفق', `${whale.label} به لیست ردیابی اضافه شد`);
    },
    [trackedWallets]
  );

  const handleCopyAddress = useCallback(async (address: string) => {
    try {
      await Clipboard.setStringAsync(address);
      Alert.alert('کپی شد', 'آدرس کیف پول کپی شد');
    } catch {
      console.log('[WhaleTracker] Copy failed');
    }
  }, []);

  const handleOpenWallet = useCallback(
    (wallet: WhaleWallet) => {
      router.push({
        pathname: '/whales/wallet-detail' as any,
        params: { address: wallet.address, label: wallet.label, walletId: wallet.id },
      });
    },
    [router]
  );

  const formHeight = formAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 200],
  });

  const renderTrackedWallet = ({ item }: { item: WhaleWallet }) => {
    const isTrackedFromTop = MOCK_TOP_WHALES.some((tw) => tw.address === item.address);
    return (
      <Pressable
        style={({ pressed }) => [styles.walletCard, pressed && styles.cardPressed]}
        onPress={() => handleOpenWallet(item)}
        testID={`wallet-${item.id}`}
      >
        <View style={styles.walletCardLeft}>
          <View style={[styles.walletIcon, isTrackedFromTop && styles.walletIconGold]}>
            <Wallet size={18} color={isTrackedFromTop ? colors.dark.accent : colors.dark.blue} />
          </View>
          <View style={styles.walletInfo}>
            <Text style={styles.walletLabel}>{item.label}</Text>
            <Pressable
              style={styles.addressCopyRow}
              onPress={(e) => {
                e.stopPropagation?.();
                handleCopyAddress(item.address);
              }}
              hitSlop={8}
            >
              <Copy size={10} color={colors.dark.textMuted} />
              <Text style={styles.walletAddress} numberOfLines={1}>
                {item.address.slice(0, 8)}...{item.address.slice(-6)}
              </Text>
            </Pressable>
            <View style={styles.walletStats}>
              <Text style={styles.pnlText}>
                سود ۳۰ روزه:{' '}
                <Text style={{ color: colors.dark.green }}>
                  ${item.pnl30d.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </Text>
              </Text>
            </View>
          </View>
        </View>
        <View style={styles.walletCardRight}>
          <Pressable
            style={styles.deleteBtn}
            onPress={(e) => {
              e.stopPropagation?.();
              handleRemoveWallet(item.id);
            }}
            hitSlop={10}
          >
            <Trash2 size={16} color={colors.dark.red} />
          </Pressable>
          <View style={styles.moreInfoBadge}>
            <Info size={12} color={colors.dark.blue} />
          </View>
          <ChevronRight size={16} color={colors.dark.textMuted} />
        </View>
      </Pressable>
    );
  };

  const renderTopWhale = ({ item }: { item: TopWhale }) => {
    const isTracked = trackedWallets.some((w) => w.address === item.address);

    return (
      <View style={styles.topWhaleCard}>
        <View style={styles.topWhaleHeader}>
          <View style={styles.topWhaleInfo}>
            <Text style={styles.topWhaleLabel}>{item.label}</Text>
            <Pressable
              style={styles.addressCopyRow}
              onPress={() => handleCopyAddress(item.address)}
              hitSlop={8}
            >
              <Copy size={10} color={colors.dark.textMuted} />
              <Text style={styles.topWhaleAddress}>
                {item.address.slice(0, 8)}...{item.address.slice(-6)}
              </Text>
            </Pressable>
          </View>
          <Pressable
            style={[styles.trackBtn, isTracked && styles.trackBtnActive]}
            onPress={() => handleTrackTopWhale(item)}
          >
            {isTracked ? (
              <X size={14} color={colors.dark.red} />
            ) : (
              <Plus size={14} color={colors.dark.accent} />
            )}
            <Text style={[styles.trackBtnText, isTracked && styles.trackBtnTextActive]}>
              {isTracked ? 'حذف' : 'ردیابی'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.topWhaleStats}>
          <View style={styles.statBox}>
            <TrendingUp size={13} color={colors.dark.green} />
            <Text style={styles.statLabel}>سود ۳۰ روزه</Text>
            <Text style={[styles.statValue, { color: colors.dark.green }]}>
              ${item.pnl30d.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Target size={13} color={colors.dark.blue} />
            <Text style={styles.statLabel}>نرخ برد</Text>
            <Text style={[styles.statValue, { color: colors.dark.blue }]}>
              {item.winRate.toFixed(1)}%
            </Text>
          </View>
        </View>

        <View style={styles.topTradesRow}>
          <Star size={12} color={colors.dark.accent} />
          <Text style={styles.topTradesLabel}>بهترین معاملات:</Text>
          {item.topTrades.map((trade, i) => (
            <View key={i} style={styles.tradeBadge}>
              <Text style={styles.tradeBadgeText}>{trade}</Text>
            </View>
          ))}
        </View>

        <Pressable
          style={styles.moreInfoBtn}
          onPress={() => {
            const wallet: WhaleWallet = {
              id: `top-${item.address}`,
              address: item.address,
              label: item.label,
              addedAt: Date.now(),
              pnl30d: item.pnl30d,
              winRate: item.winRate,
            };
            handleOpenWallet(wallet);
          }}
        >
          <Info size={13} color={colors.dark.blue} />
          <Text style={styles.moreInfoBtnText}>اطلاعات بیشتر</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.refreshTimerBar}>
        <View style={styles.refreshTimerLeft}>
          <Animated.View style={[styles.liveDot, { opacity: liveIndicator }]} />
          <Text style={styles.liveText}>ردیابی نهنگ‌ها</Text>
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

      <View style={styles.tabBar}>
        <Pressable
          style={[styles.tab, activeTab === 'tracked' && styles.tabActive]}
          onPress={() => setActiveTab('tracked')}
        >
          <Eye size={15} color={activeTab === 'tracked' ? colors.dark.accent : colors.dark.textMuted} />
          <Text style={[styles.tabText, activeTab === 'tracked' && styles.tabTextActive]}>
            لیست ردیابی
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, activeTab === 'top' && styles.tabActive]}
          onPress={() => setActiveTab('top')}
        >
          <Trophy size={15} color={activeTab === 'top' ? colors.dark.accent : colors.dark.textMuted} />
          <Text style={[styles.tabText, activeTab === 'top' && styles.tabTextActive]}>
            نهنگ‌های برتر
          </Text>
        </Pressable>
      </View>

      {activeTab === 'tracked' && (
        <View style={styles.content}>
          <Pressable
            style={[styles.addButton, showAddForm && styles.addButtonActive]}
            onPress={() => setShowAddForm(!showAddForm)}
          >
            <Plus size={18} color={showAddForm ? colors.dark.background : colors.dark.accent} />
            <Text style={[styles.addButtonText, showAddForm && styles.addButtonTextActive]}>
              {showAddForm ? 'بستن' : 'افزودن کیف پول جدید'}
            </Text>
          </Pressable>

          <Animated.View style={[styles.addForm, { height: formHeight, overflow: 'hidden' }]}>
            <View style={styles.addFormInner}>
              <TextInput
                style={styles.input}
                placeholder="آدرس کیف پول (مثل 0x5b5d...)"
                placeholderTextColor={colors.dark.textMuted}
                value={addressInput}
                onChangeText={setAddressInput}
                autoCapitalize="none"
                autoCorrect={false}
                testID="wallet-address-input"
              />
              <TextInput
                style={styles.input}
                placeholder="نام/برچسب (اختیاری)"
                placeholderTextColor={colors.dark.textMuted}
                value={labelInput}
                onChangeText={setLabelInput}
                testID="wallet-label-input"
              />
              <Pressable
                style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.8 }]}
                onPress={handleAddWallet}
                testID="add-wallet-btn"
              >
                <Search size={16} color={colors.dark.background} />
                <Text style={styles.submitBtnText}>ردیابی کیف پول</Text>
              </Pressable>
            </View>
          </Animated.View>

          <FlatList
            data={trackedWallets}
            renderItem={renderTrackedWallet}
            keyExtractor={(item) => item.id}
            contentContainerStyle={
              trackedWallets.length === 0 ? styles.emptyContainer : styles.listContent
            }
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Wallet size={48} color={colors.dark.textMuted} />
                <Text style={styles.emptyTitle}>هنوز نهنگی ردیابی نمی‌شود</Text>
                <Text style={styles.emptySubtitle}>
                  آدرس کیف پول نهنگ را وارد کنید یا از لیست نهنگ‌های برتر انتخاب کنید
                </Text>
              </View>
            }
            testID="tracked-wallets-list"
          />
        </View>
      )}

      {activeTab === 'top' && (
        <FlatList
          data={MOCK_TOP_WHALES}
          renderItem={renderTopWhale}
          keyExtractor={(item) => item.address}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.topHeader}>
              <Trophy size={18} color={colors.dark.accent} />
              <Text style={styles.topHeaderText}>
                نهنگ‌هایی که در ۳۰ روز گذشته بیشترین سود را داشته‌اند
              </Text>
            </View>
          }
          testID="top-whales-list"
        />
      )}
    </View>
  );
}

const styles = createThemedStyles(() => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.background,
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
    marginTop: 10,
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
  countdownBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.dark.green + '22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownText: {
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
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.dark.surface,
    borderWidth: 1,
    borderColor: colors.dark.border,
    gap: 6,
  },
  tabActive: {
    backgroundColor: colors.dark.accent + '18',
    borderColor: colors.dark.accent + '44',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.dark.textMuted,
  },
  tabTextActive: {
    color: colors.dark.accent,
  },
  content: {
    flex: 1,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.dark.accent + '44',
    borderStyle: 'dashed',
    gap: 8,
  },
  addButtonActive: {
    backgroundColor: colors.dark.accent,
    borderStyle: 'solid',
    borderColor: colors.dark.accent,
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: colors.dark.accent,
  },
  addButtonTextActive: {
    color: colors.dark.background,
  },
  addForm: {
    marginHorizontal: 16,
  },
  addFormInner: {
    paddingTop: 12,
    gap: 10,
  },
  input: {
    backgroundColor: colors.dark.inputBg,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.dark.text,
    borderWidth: 1,
    borderColor: colors.dark.border,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dark.blue,
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },
  submitBtnText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  walletCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  walletCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  walletIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.dark.blueDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletIconGold: {
    backgroundColor: colors.dark.accentDim,
  },
  walletInfo: {
    flex: 1,
  },
  walletLabel: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: colors.dark.text,
    textAlign: 'right',
  },
  addressCopyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  walletAddress: {
    fontSize: 11,
    color: colors.dark.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  walletStats: {
    flexDirection: 'row',
    marginTop: 4,
  },
  pnlText: {
    fontSize: 11,
    color: colors.dark.textSecondary,
  },
  walletCardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  deleteBtn: {
    padding: 6,
  },
  moreInfoBadge: {
    padding: 4,
    borderRadius: 6,
    backgroundColor: colors.dark.blueDim,
  },
  topWhaleCard: {
    backgroundColor: colors.dark.surface,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  topWhaleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  topWhaleInfo: {
    flex: 1,
  },
  topWhaleLabel: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: colors.dark.text,
    textAlign: 'right',
  },
  topWhaleAddress: {
    fontSize: 10,
    color: colors.dark.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: 2,
  },
  trackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: colors.dark.accentDim,
    gap: 4,
  },
  trackBtnActive: {
    backgroundColor: colors.dark.redDim,
  },
  trackBtnText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: colors.dark.accent,
  },
  trackBtnTextActive: {
    color: colors.dark.red,
  },
  topWhaleStats: {
    flexDirection: 'row',
    marginTop: 12,
    backgroundColor: colors.dark.card,
    borderRadius: 10,
    padding: 10,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.dark.border,
  },
  statLabel: {
    fontSize: 10,
    color: colors.dark.textMuted,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '700' as const,
  },
  topTradesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 6,
    flexWrap: 'wrap',
  },
  topTradesLabel: {
    fontSize: 11,
    color: colors.dark.textSecondary,
  },
  tradeBadge: {
    backgroundColor: colors.dark.greenDim,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tradeBadgeText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: colors.dark.green,
  },
  moreInfoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.dark.blueDim,
    borderWidth: 1,
    borderColor: colors.dark.blue + '33',
    gap: 6,
  },
  moreInfoBtnText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: colors.dark.blue,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  topHeaderText: {
    fontSize: 12,
    color: colors.dark.textSecondary,
    textAlign: 'center',
  },
  emptyContainer: {
    flex: 1,
  },
  listContent: {
    paddingTop: 12,
    paddingBottom: 20,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingTop: 60,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: colors.dark.text,
    marginTop: 16,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: colors.dark.textSecondary,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
  },
}));
