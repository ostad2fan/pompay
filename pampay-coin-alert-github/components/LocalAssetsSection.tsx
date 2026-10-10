import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Landmark,
  Banknote,
  Gem,
  Medal,
  Coins,
  Wallet,
  TrendingUp,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import colors from '@/constants/colors';
import { createThemedStyles } from '@/utils/themeStyles';
import {
  fetchIranMarketPrices,
  parseTomanInput,
  formatFullToman,
} from '@/utils/iranMarketApi';
import { formatToman } from '@/utils/nobitexApi';

/**
 * LocalAssetsSection — v1.4.13
 *
 * «دارایی ریالی و فلزات» inside the wallet tab:
 *  - Live Iranian prices (Toman): gold 18/24 per gram, silver 999/925 per
 *    gram, Emami/Bahar/half/quarter coins, and the tether price (passed in
 *    from the portfolio card — same source).
 *  - User inputs: Rial cash, gold grams (+karat), silver grams (+type),
 *    coin counts — persisted in AsyncStorage.
 *  - EVERY asset row shows its own Toman value next to it.
 *  - Grand total = Rial + gold + silver + coins + crypto (crypto USD value
 *    comes from the wallet's first header, converted at the live tether rate).
 */

const ASSETS_KEY = '@local_assets_v1';

interface LocalAssets {
  rialCash: string;
  goldGrams: string;
  goldKarat: '18' | '24';
  silverGrams: string;
  silverType: '999' | '925';
  coinEmami: string;
  coinBahar: string;
  coinNim: string;
  coinRob: string;
}

const EMPTY_ASSETS: LocalAssets = {
  rialCash: '',
  goldGrams: '',
  goldKarat: '18',
  silverGrams: '',
  silverType: '999',
  coinEmami: '',
  coinBahar: '',
  coinNim: '',
  coinRob: '',
};

async function loadAssets(): Promise<LocalAssets> {
  try {
    const stored = await AsyncStorage.getItem(ASSETS_KEY);
    if (stored) return { ...EMPTY_ASSETS, ...(JSON.parse(stored) as Partial<LocalAssets>) };
  } catch {}
  return EMPTY_ASSETS;
}

async function saveAssets(a: LocalAssets): Promise<void> {
  try {
    await AsyncStorage.setItem(ASSETS_KEY, JSON.stringify(a));
  } catch {}
}

interface Props {
  /** Live USDT/Toman rate from the portfolio card's tether row. */
  usdtToToman: number;
  /** Dollar value of ALL crypto assets — read from the wallet's first header. */
  totalPortfolioUsd: number;
}

export default function LocalAssetsSection({ usdtToToman, totalPortfolioUsd }: Props) {
  const [assets, setAssets] = useState<LocalAssets>(EMPTY_ASSETS);
  const [expanded, setExpanded] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    let mounted = true;
    loadAssets().then((a) => {
      if (mounted) setAssets(a);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const pricesQuery = useQuery({
    queryKey: ['iran-market-prices'],
    queryFn: fetchIranMarketPrices,
    refetchInterval: 5 * 60 * 1000, // same cadence as the tether price row
    staleTime: 60 * 1000,
  });
  const p = pricesQuery.data;

  const update = useCallback((patch: Partial<LocalAssets>) => {
    setAssets((prev) => {
      const next = { ...prev, ...patch };
      void saveAssets(next);
      return next;
    });
  }, []);

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['iran-market-prices'] });
  }, [queryClient]);

  // ── computed Toman values (each asset separately) ──
  const rialValue = parseTomanInput(assets.rialCash) || 0;
  const goldUnit = assets.goldKarat === '24' ? p?.gold24 ?? 0 : p?.gold18 ?? 0;
  const goldValue = (parseTomanInput(assets.goldGrams) || 0) * goldUnit;
  const silverUnit = assets.silverType === '925' ? p?.silver925 ?? 0 : p?.silver999 ?? 0;
  const silverValue = (parseTomanInput(assets.silverGrams) || 0) * silverUnit;
  const coinValues = {
    emami: (parseTomanInput(assets.coinEmami) || 0) * (p?.coinEmami ?? 0),
    bahar: (parseTomanInput(assets.coinBahar) || 0) * (p?.coinBahar ?? 0),
    nim: (parseTomanInput(assets.coinNim) || 0) * (p?.coinNim ?? 0),
    rob: (parseTomanInput(assets.coinRob) || 0) * (p?.coinRob ?? 0),
  };
  const coinsValue =
    coinValues.emami + coinValues.bahar + coinValues.nim + coinValues.rob;
  const cryptoToman = usdtToToman > 0 ? totalPortfolioUsd * usdtToToman : 0;
  const grandTotal = rialValue + goldValue + silverValue + coinsValue + cryptoToman;
  const hasAnyInput =
    rialValue > 0 || goldValue > 0 || silverValue > 0 || coinsValue > 0 || totalPortfolioUsd > 0;

  const minutesOld = p ? Math.max(1, Math.round((Date.now() - p.updatedAt) / 60000)) : 0;

  return (
    <View style={styles.card}>
      {/* ── header ── */}
      <View style={styles.header}>
        <Landmark size={18} color={colors.dark.accent} />
        <Text style={styles.title}>دارایی ریالی و فلزات</Text>
        <Pressable style={styles.refreshBtn} onPress={refresh}>
          {pricesQuery.isFetching ? (
            <ActivityIndicator size="small" color={colors.dark.accent} />
          ) : (
            <RefreshCw size={14} color={colors.dark.accent} />
          )}
        </Pressable>
        <Pressable style={styles.chevronBtn} onPress={() => setExpanded((v) => !v)}>
          {expanded ? (
            <ChevronUp size={14} color={colors.dark.textSecondary} />
          ) : (
            <ChevronDown size={14} color={colors.dark.textSecondary} />
          )}
        </Pressable>
      </View>

      {/* ── live price list ── */}
      <View style={styles.priceBlock}>
        <Text style={styles.blockLabel}>قیمت‌های لحظه‌ای (تومان)</Text>
        <View style={styles.priceGrid}>
          <PriceChip label="طلای ۱۸ عیار (گرم)" value={p?.gold18} />
          <PriceChip label="طلای ۲۴ عیار (گرم)" value={p?.gold24} />
          <PriceChip label="نقره ۹۹۹ (گرم)" value={p?.silver999} />
          <PriceChip label="نقره ۹۲۵ (گرم)" value={p?.silver925} />
          <PriceChip label="سکه امامی" value={p?.coinEmami} />
          <PriceChip label="سکه بهار آزادی" value={p?.coinBahar} />
          <PriceChip label="نیم سکه" value={p?.coinNim} />
          <PriceChip label="ربع سکه" value={p?.coinRob} />
          <PriceChip
            label="تتر"
            value={usdtToToman > 0 ? usdtToToman : undefined}
          />
        </View>
        {p && (
          <Text style={styles.priceNote}>منبع: TGJU • {minutesOld} دقیقه پیش</Text>
        )}
        {!p && !pricesQuery.isFetching && (
          <Text style={styles.priceNote}>قیمت‌ها در دسترس نیست — بعداً تازه‌سازی کنید</Text>
        )}
      </View>

      {expanded && (
        <>
          <View style={styles.divider} />

          {/* ── my assets (inputs + per-asset Toman value) ── */}
          <Text style={styles.blockLabel}>دارایی‌های من</Text>

          <AssetRow
            icon={<Banknote size={14} color={colors.dark.green} />}
            label="ریال / تومان نقدی"
            value={assets.rialCash}
            onChangeText={(t) => update({ rialCash: t })}
            placeholder="مثلاً 50000000"
            keyboardType="number-pad"
            unitLabel="تومان"
            tomanValue={rialValue}
            valueHint="مقدار را به تومان وارد کنید"
          />

          <AssetRow
            icon={<Gem size={14} color="#FFD54F" />}
            label="طلا (گرم)"
            value={assets.goldGrams}
            onChangeText={(t) => update({ goldGrams: t })}
            placeholder="مثلاً 12.5"
            keyboardType="decimal-pad"
            unitLabel="گرم"
            tomanValue={goldValue}
            valueHint={
              goldUnit > 0 ? `قیمت هر گرم: ${formatFullToman(goldUnit)}` : 'قیمت در حال دریافت'
            }
          >
            <Selector
              options={[
                { key: '18', label: 'عیار ۱۸' },
                { key: '24', label: 'عیار ۲۴' },
              ]}
              active={assets.goldKarat}
              onSelect={(k) => update({ goldKarat: k as '18' | '24' })}
            />
          </AssetRow>

          <AssetRow
            icon={<Medal size={14} color="#B0BEC5" />}
            label="نقره (گرم)"
            value={assets.silverGrams}
            onChangeText={(t) => update({ silverGrams: t })}
            placeholder="مثلاً 100"
            keyboardType="decimal-pad"
            unitLabel="گرم"
            tomanValue={silverValue}
            valueHint={
              silverUnit > 0
                ? `قیمت هر گرم: ${formatFullToman(silverUnit)}`
                : 'قیمت در حال دریافت'
            }
          >
            <Selector
              options={[
                { key: '999', label: 'عیار ۹۹۹' },
                { key: '925', label: 'عیار ۹۲۵' },
              ]}
              active={assets.silverType}
              onSelect={(k) => update({ silverType: k as '999' | '925' })}
            />
          </AssetRow>

          <AssetRow
            icon={<Coins size={14} color={'#FFC107'} />}
            label="سکه امامی (تعداد)"
            value={assets.coinEmami}
            onChangeText={(t) => update({ coinEmami: t })}
            placeholder="مثلاً 2"
            keyboardType="number-pad"
            unitLabel="عدد"
            tomanValue={coinValues.emami}
            valueHint={
              p?.coinEmami ? `قیمت هر عدد: ${formatFullToman(p.coinEmami)}` : 'قیمت در حال دریافت'
            }
          />

          <AssetRow
            icon={<Coins size={14} color={'#FFC107'} />}
            label="سکه بهار آزادی (تعداد)"
            value={assets.coinBahar}
            onChangeText={(t) => update({ coinBahar: t })}
            placeholder="مثلاً 1"
            keyboardType="number-pad"
            unitLabel="عدد"
            tomanValue={coinValues.bahar}
            valueHint={
              p?.coinBahar ? `قیمت هر عدد: ${formatFullToman(p.coinBahar)}` : 'قیمت در حال دریافت'
            }
          />

          <AssetRow
            icon={<Coins size={14} color={'#FFC107'} />}
            label="نیم سکه (تعداد)"
            value={assets.coinNim}
            onChangeText={(t) => update({ coinNim: t })}
            placeholder="مثلاً 3"
            keyboardType="number-pad"
            unitLabel="عدد"
            tomanValue={coinValues.nim}
            valueHint={p?.coinNim ? `قیمت هر عدد: ${formatFullToman(p.coinNim)}` : 'قیمت در حال دریافت'}
          />

          <AssetRow
            icon={<Coins size={14} color={'#FFC107'} />}
            label="ربع سکه (تعداد)"
            value={assets.coinRob}
            onChangeText={(t) => update({ coinRob: t })}
            placeholder="مثلاً 5"
            keyboardType="number-pad"
            unitLabel="عدد"
            tomanValue={coinValues.rob}
            valueHint={p?.coinRob ? `قیمت هر عدد: ${formatFullToman(p.coinRob)}` : 'قیمت در حال دریافت'}
          />

          {/* ── crypto row (read from the wallet's first header) ── */}
          <View style={styles.assetRow}>
            <Wallet size={14} color={colors.dark.blue} />
            <View style={styles.assetMain}>
              <Text style={styles.assetLabel}>ارزهای دیجیتال (همه صرافی‌ها)</Text>
              <Text style={styles.assetHint}>
                {totalPortfolioUsd > 0
                  ? `ارزش دلاری: $${totalPortfolioUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
                  : 'صرافی متصل نیست یا موجودی صفر'}
              </Text>
            </View>
            <View style={styles.assetValueCol}>
              <Text style={[styles.assetValue, { color: colors.dark.blue }]}>
                {cryptoToman > 0 ? `${formatFullToman(cryptoToman)} ت` : '—'}
              </Text>
              {usdtToToman > 0 && (
                <Text style={styles.assetRate}>تتر: {formatFullToman(usdtToToman)}</Text>
              )}
            </View>
          </View>

          {/* ── grand total ── */}
          <View style={styles.totalBox}>
            <View style={styles.totalRow}>
              <TrendingUp size={16} color={colors.dark.green} />
              <Text style={styles.totalLabel}>مجموع کل دارایی (ریال + طلا + نقره + سکه + ارز)</Text>
            </View>
            <Text style={styles.totalAmount}>
              {hasAnyInput ? `${formatToman(grandTotal)} تومان` : '—'}
            </Text>
            {hasAnyInput && grandTotal >= 1000 && (
              <Text style={styles.totalExact}>{formatFullToman(Math.round(grandTotal))} تومان</Text>
            )}
            <View style={styles.totalBreakdown}>
              <Text style={styles.breakdownText}>
                ریال {formatToman(rialValue)} • طلا {formatToman(goldValue)} • نقره {formatToman(silverValue)} • سکه {formatToman(coinsValue)} • ارز {formatToman(cryptoToman)}
              </Text>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

// ── sub-components ──

function PriceChip({ label, value }: { label: string; value?: number }) {
  return (
    <View style={styles.priceChip}>
      <Text style={styles.priceChipLabel}>{label}</Text>
      <Text style={[styles.priceChipValue, !value && styles.priceChipEmpty]}>
        {value && value > 0 ? formatFullToman(value) : '…'}
      </Text>
    </View>
  );
}

interface AssetRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  keyboardType: 'number-pad' | 'decimal-pad';
  unitLabel: string;
  tomanValue: number;
  valueHint: string;
  children?: React.ReactNode;
}

function AssetRow({
  icon,
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  unitLabel,
  tomanValue,
  valueHint,
  children,
}: AssetRowProps) {
  return (
    <View style={styles.assetRow}>
      {icon}
      <View style={styles.assetMain}>
        <Text style={styles.assetLabel}>{label}</Text>
        <View style={styles.assetInputRow}>
          <TextInput
            style={styles.assetInput}
            value={value}
            onChangeText={onChangeText}
            onEndEditing={(e) => {
              // Normalize what the user typed (commas/Persian digits) once focus leaves.
              const n = parseTomanInput(e.nativeEvent.text);
              onChangeText(Number.isFinite(n) && n > 0 ? String(n) : '');
            }}
            placeholder={placeholder}
            placeholderTextColor={colors.dark.textSecondary}
            keyboardType={keyboardType}
            inputMode={keyboardType === 'decimal-pad' ? 'decimal' : 'numeric'}
            returnKeyType="done"
            maxLength={14}
            textAlign="left"
          />
          <Text style={styles.assetUnit}>{unitLabel}</Text>
        </View>
        <Text style={styles.assetHint}>{valueHint}</Text>
        {children}
      </View>
      <View style={styles.assetValueCol}>
        <Text style={[styles.assetValue, !(tomanValue > 0) && styles.assetValueEmpty]}>
          {tomanValue > 0 ? `${formatFullToman(Math.round(tomanValue))} ت` : '—'}
        </Text>
      </View>
    </View>
  );
}

function Selector({
  options,
  active,
  onSelect,
}: {
  options: { key: string; label: string }[];
  active: string;
  onSelect: (key: string) => void;
}) {
  return (
    <View style={styles.selector}>
      {options.map((o) => (
        <Pressable
          key={o.key}
          style={[styles.selectorChip, active === o.key && styles.selectorChipActive]}
          onPress={() => onSelect(o.key)}
        >
          <Text
            style={[
              styles.selectorChipText,
              active === o.key && styles.selectorChipTextActive,
            ]}
          >
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// ── styles ──

const styles = createThemedStyles(() =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.dark.surface,
      borderRadius: 16,
      padding: 16,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.dark.accent + '26',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 12,
    },
    title: {
      fontSize: 14,
      fontWeight: '600' as const,
      color: colors.dark.text,
      flex: 1,
      textAlign: 'right',
    },
    refreshBtn: {
      padding: 6,
      borderRadius: 8,
      backgroundColor: colors.dark.accentDim,
    },
    chevronBtn: {
      padding: 6,
      borderRadius: 8,
    },
    blockLabel: {
      fontSize: 11,
      fontWeight: '600' as const,
      color: colors.dark.textSecondary,
      marginBottom: 8,
      textAlign: 'right',
    },
    priceBlock: {
      backgroundColor: colors.dark.card,
      borderRadius: 10,
      padding: 10,
    },
    priceGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    priceChip: {
      flexBasis: '31%',
      flexGrow: 1,
      backgroundColor: colors.dark.surface,
      borderRadius: 8,
      paddingVertical: 6,
      paddingHorizontal: 6,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.dark.border,
    },
    priceChipLabel: {
      fontSize: 9,
      color: colors.dark.textSecondary,
      textAlign: 'center',
    },
    priceChipValue: {
      fontSize: 11,
      fontWeight: '700' as const,
      color: colors.dark.text,
      marginTop: 2,
    },
    priceChipEmpty: {
      color: colors.dark.textSecondary,
      fontWeight: '400' as const,
    },
    priceNote: {
      fontSize: 9,
      color: colors.dark.textSecondary,
      marginTop: 6,
      textAlign: 'left',
    },
    divider: {
      height: 1,
      backgroundColor: colors.dark.border,
      marginVertical: 12,
    },
    assetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 8,
    },
    assetMain: {
      flex: 1,
      gap: 4,
    },
    assetLabel: {
      fontSize: 12,
      fontWeight: '600' as const,
      color: colors.dark.text,
      textAlign: 'right',
    },
    assetInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    assetInput: {
      flex: 1,
      backgroundColor: colors.dark.card,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.dark.border,
      color: colors.dark.text,
      fontSize: 13,
      fontWeight: '600' as const,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    assetUnit: {
      fontSize: 11,
      color: colors.dark.textSecondary,
      minWidth: 30,
    },
    assetHint: {
      fontSize: 9,
      color: colors.dark.textSecondary,
      textAlign: 'right',
    },
    assetValueCol: {
      minWidth: 92,
      alignItems: 'flex-start',
    },
    assetValue: {
      fontSize: 12,
      fontWeight: '700' as const,
      color: colors.dark.green,
    },
    assetValueEmpty: {
      color: colors.dark.textSecondary,
      fontWeight: '400' as const,
    },
    assetRate: {
      fontSize: 9,
      color: colors.dark.textSecondary,
      marginTop: 2,
    },
    selector: {
      flexDirection: 'row',
      gap: 6,
      marginTop: 2,
    },
    selectorChip: {
      backgroundColor: colors.dark.card,
      borderWidth: 1,
      borderColor: colors.dark.border,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    selectorChipActive: {
      backgroundColor: colors.dark.accentDim,
      borderColor: colors.dark.accent,
    },
    selectorChipText: {
      fontSize: 10,
      fontWeight: '600' as const,
      color: colors.dark.textSecondary,
    },
    selectorChipTextActive: {
      color: colors.dark.accent,
      fontWeight: '700' as const,
    },
    totalBox: {
      marginTop: 10,
      backgroundColor: colors.dark.card,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.dark.green + '33',
    },
    totalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 6,
    },
    totalLabel: {
      fontSize: 11,
      fontWeight: '600' as const,
      color: colors.dark.textSecondary,
      flex: 1,
      textAlign: 'right',
    },
    totalAmount: {
      fontSize: 22,
      fontWeight: '800' as const,
      color: colors.dark.green,
      textAlign: 'right',
    },
    totalExact: {
      fontSize: 10,
      color: colors.dark.textSecondary,
      textAlign: 'right',
      marginTop: 2,
    },
    totalBreakdown: {
      marginTop: 8,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: colors.dark.border,
    },
    breakdownText: {
      fontSize: 9,
      color: colors.dark.textSecondary,
      textAlign: 'right',
      lineHeight: 16,
    },
  })
);

