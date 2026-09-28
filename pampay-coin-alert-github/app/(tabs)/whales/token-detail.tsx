import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  Alert,
} from 'react-native';
import {
  Copy,
  Building2,
  Globe,
  TrendingUp,
  TrendingDown,
  Coins,
  AlertTriangle,
  DollarSign,
  FileCode,
  ExternalLink,
} from 'lucide-react-native';
import { useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useQuery } from '@tanstack/react-query';
import colors from '@/constants/colors';
import { createThemedStyles } from '@/utils/themeStyles';
import { ExchangeListing } from '@/types/whale';
import { fetchUsdtTomanPrice, formatToman } from '@/utils/nobitexApi';

export default function TokenDetailScreen() {
  const {
    symbol,
    name,
    contractAddress,
    amount,
    valueUsd,
    priceChange,
    isMeme,
    exchanges,
  } = useLocalSearchParams<{
    symbol: string;
    name: string;
    contractAddress: string;
    amount: string;
    valueUsd: string;
    priceChange: string;
    isMeme: string;
    exchanges: string;
  }>();

  const tomanQuery = useQuery({
    queryKey: ['usdt-toman-price'],
    queryFn: fetchUsdtTomanPrice,
    staleTime: 60000,
  });

  const usdtToToman = tomanQuery.data?.usdtToToman ?? 0;

  const parsedExchanges: ExchangeListing[] = exchanges ? JSON.parse(exchanges) : [];
  const priceChangeNum = parseFloat(priceChange ?? '0');
  const amountNum = parseFloat(amount ?? '0');
  const valueNum = parseFloat(valueUsd ?? '0');
  const isMemeToken = isMeme === '1';

  const cexExchanges = parsedExchanges.filter((e) => e.type === 'cex');
  const dexExchanges = parsedExchanges.filter((e) => e.type === 'dex');

  const handleCopyContract = async () => {
    if (contractAddress) {
      await Clipboard.setStringAsync(contractAddress);
      Alert.alert('کپی شد', 'آدرس قرارداد کپی شد');
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000000) return `${(num / 1000000000).toFixed(2)}B`;
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(2)}K`;
    return num.toFixed(2);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.tokenHeader}>
        <View style={[styles.tokenIconBig, isMemeToken && styles.tokenIconMeme]}>
          <Text style={styles.tokenIconText}>{symbol?.slice(0, 2)}</Text>
        </View>
        <View style={styles.tokenHeaderInfo}>
          <View style={styles.tokenTitleRow}>
            <Text style={styles.tokenTitle}>{symbol}</Text>
            {isMemeToken && (
              <View style={styles.memeBadge}>
                <AlertTriangle size={10} color={colors.dark.orange} />
                <Text style={styles.memeBadgeText}>MEME</Text>
              </View>
            )}
          </View>
          <Text style={styles.tokenSubtitle}>{name || symbol}</Text>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Coins size={18} color={colors.dark.blue} />
          <Text style={styles.statCardLabel}>مقدار</Text>
          <Text style={styles.statCardValue}>{formatNumber(amountNum)}</Text>
        </View>
        <View style={styles.statCard}>
          <DollarSign size={18} color={colors.dark.green} />
          <Text style={styles.statCardLabel}>ارزش</Text>
          <Text style={styles.statCardValue}>
            ${valueNum.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </Text>
          {usdtToToman > 0 && valueNum > 0 && (
            <Text style={styles.statCardToman}>
              {formatToman(valueNum * usdtToToman)} ت
            </Text>
          )}
        </View>
        <View style={styles.statCard}>
          {priceChangeNum >= 0 ? (
            <TrendingUp size={18} color={colors.dark.green} />
          ) : (
            <TrendingDown size={18} color={colors.dark.red} />
          )}
          <Text style={styles.statCardLabel}>تغییر ۲۴ ساعته</Text>
          <Text
            style={[
              styles.statCardValue,
              { color: priceChangeNum >= 0 ? colors.dark.green : colors.dark.red },
            ]}
          >
            {priceChangeNum >= 0 ? '+' : ''}{priceChangeNum.toFixed(1)}%
          </Text>
        </View>
      </View>

      <View style={styles.contractSection}>
        <View style={styles.contractHeader}>
          <FileCode size={16} color={colors.dark.accent} />
          <Text style={styles.sectionTitle}>آدرس قرارداد (Contract)</Text>
        </View>
        {contractAddress && contractAddress.length > 2 ? (
          <View style={styles.contractWrapper}>
            {isMemeToken && (
              <View style={styles.memeContractAlert}>
                <AlertTriangle size={12} color={colors.dark.orange} />
                <Text style={styles.memeContractAlertText}>
                  {'میم‌کوین — قبل از خرید حتماً قرارداد را بررسی کنید'}
                </Text>
              </View>
            )}
            <Pressable style={styles.contractCard} onPress={handleCopyContract}>
              <View style={styles.contractTextCol}>
                <Text style={styles.contractLabel}>Contract Address</Text>
                <Text style={styles.contractText} numberOfLines={2}>
                  {contractAddress}
                </Text>
              </View>
              <View style={styles.contractCopyBtn}>
                <Copy size={16} color={colors.dark.accent} />
                <Text style={styles.contractCopyText}>کپی</Text>
              </View>
            </Pressable>
            <View style={styles.contractLinks}>
              <View style={styles.contractLinkChip}>
                <ExternalLink size={11} color={colors.dark.blue} />
                <Text style={styles.contractLinkText}>Etherscan</Text>
              </View>
              <View style={styles.contractLinkChip}>
                <ExternalLink size={11} color={colors.dark.blue} />
                <Text style={styles.contractLinkText}>DexScreener</Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.noContractBox}>
            <Text style={styles.noContractText}>آدرس قرارداد در دسترس نیست</Text>
          </View>
        )}
      </View>

      <View style={styles.exchangesSection}>
        <Text style={styles.sectionTitle}>صرافی‌های موجود</Text>

        {cexExchanges.length > 0 && (
          <View style={styles.exchangeGroup}>
            <View style={styles.exchangeGroupHeader}>
              <Building2 size={16} color={colors.dark.blue} />
              <Text style={styles.exchangeGroupTitle}>صرافی‌های متمرکز (CEX)</Text>
            </View>
            <View style={styles.exchangeList}>
              {cexExchanges.map((ex, i) => (
                <View key={i} style={styles.exchangeChip}>
                  <View style={[styles.exchangeDot, { backgroundColor: colors.dark.blue }]} />
                  <Text style={styles.exchangeChipText}>{ex.name}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {dexExchanges.length > 0 && (
          <View style={styles.exchangeGroup}>
            <View style={styles.exchangeGroupHeader}>
              <Globe size={16} color={colors.dark.green} />
              <Text style={styles.exchangeGroupTitle}>صرافی‌های غیرمتمرکز (DEX)</Text>
            </View>
            <View style={styles.exchangeList}>
              {dexExchanges.map((ex, i) => (
                <View key={i} style={styles.exchangeChip}>
                  <View style={[styles.exchangeDot, { backgroundColor: colors.dark.green }]} />
                  <Text style={styles.exchangeChipText}>{ex.name}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {cexExchanges.length === 0 && dexExchanges.length === 0 && (
          <View style={styles.noExchangeBox}>
            <Text style={styles.noExchangeText}>اطلاعات صرافی در دسترس نیست</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = createThemedStyles(() => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.background,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  tokenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 14,
  },
  tokenIconBig: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: colors.dark.blueDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tokenIconMeme: {
    backgroundColor: colors.dark.orangeDim,
  },
  tokenIconText: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: colors.dark.text,
  },
  tokenHeaderInfo: {
    flex: 1,
  },
  tokenTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tokenTitle: {
    fontSize: 24,
    fontWeight: '800' as const,
    color: colors.dark.text,
  },
  memeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark.orangeDim,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.dark.orange + '33',
  },
  memeBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: colors.dark.orange,
  },
  tokenSubtitle: {
    fontSize: 14,
    color: colors.dark.textSecondary,
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: colors.dark.accent + '33',
    marginHorizontal: 20,
    marginTop: 18,
  },
  statsGrid: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginTop: 18,
    gap: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.dark.surface,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  statCardLabel: {
    fontSize: 10,
    color: colors.dark.textMuted,
  },
  statCardValue: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  statCardToman: {
    fontSize: 9,
    color: colors.dark.blue,
    fontWeight: '600' as const,
  },
  contractSection: {
    paddingHorizontal: 16,
    marginTop: 24,
  },
  contractHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: colors.dark.accent,
    textAlign: 'right',
  },
  contractWrapper: {
    gap: 8,
  },
  memeContractAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.dark.orangeDim,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.dark.orange + '33',
  },
  memeContractAlertText: {
    fontSize: 11,
    color: colors.dark.orange,
    flex: 1,
    textAlign: 'right',
    lineHeight: 18,
  },
  contractCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark.surface,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.dark.accent + '33',
    gap: 10,
  },
  contractTextCol: {
    flex: 1,
    gap: 4,
  },
  contractLabel: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: colors.dark.textMuted,
    letterSpacing: 0.5,
  },
  contractText: {
    fontSize: 12,
    color: colors.dark.text,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 18,
  },
  contractCopyBtn: {
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
  },
  contractCopyText: {
    fontSize: 9,
    fontWeight: '600' as const,
    color: colors.dark.accent,
  },
  contractLinks: {
    flexDirection: 'row',
    gap: 8,
  },
  contractLinkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark.blueDim,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    gap: 5,
  },
  contractLinkText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: colors.dark.blue,
  },
  noContractBox: {
    backgroundColor: colors.dark.surface,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.dark.border,
    alignItems: 'center',
  },
  noContractText: {
    fontSize: 12,
    color: colors.dark.textMuted,
  },
  exchangesSection: {
    paddingHorizontal: 16,
    marginTop: 24,
    gap: 12,
  },
  exchangeGroup: {
    backgroundColor: colors.dark.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  exchangeGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  exchangeGroupTitle: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.dark.textSecondary,
  },
  exchangeList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  exchangeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark.card,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  exchangeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  exchangeChipText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.dark.text,
  },
  noExchangeBox: {
    backgroundColor: colors.dark.surface,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  noExchangeText: {
    fontSize: 13,
    color: colors.dark.textMuted,
  },
}));
