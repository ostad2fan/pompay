import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Alert } from 'react-native';
import {
  Link as LinkIcon,
  Plus,
  Trash2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  Lock,
  Info,
  AlertTriangle,
  ShieldAlert,
  RefreshCcw,
} from 'lucide-react-native';
import colors from '@/constants/colors';
import { createThemedStyles } from '@/utils/themeStyles';
import { formatToman } from '@/utils/nobitexApi';
import { formatFullToman } from '@/utils/iranMarketApi';
import { VpnStatus } from '@/utils/vpnGuard';
import {
  BlockchainWallet,
  BlockchainWalletData,
  BlockchainNetwork,
  NETWORKS,
  NETWORK_ORDER,
  shortAddress,
  validateBlockchainAddress,
} from '@/utils/blockchainWallets';
import {
  BlockchainPnlSummary,
  PNL_PERIODS,
  PnlPeriod,
} from '@/utils/blockchainWalletApi';

/**
 * BlockchainWalletsSection — v1.4.16
 *
 * The 4th top tab of the asset-management screen: «کیف پول بلاکچین».
 *
 * READ-ONLY blockchain wallets (Trust Wallet & any personal wallet):
 *   - The user enters ONLY a public address + network + display name.
 *   - Balances/prices are read from public keyless APIs (blockchainWalletApi).
 *   - The add form carries the step-by-step READ-ONLY GUIDE (how to copy an
 *     address from Trust Wallet) + a red security warning (never enter the
 *     seed phrase / private key anywhere).
 *   - Total card: USD value + TOMAN value + overall PnL with the same
 *     ۷/۳۰/۹۰/۱۸۰-day period chips as the other sections.
 */

const PNL_PERIOD_LABEL: Record<PnlPeriod, string> = {
  7: '۷ روز',
  30: '۳۰ روز',
  90: '۹۰ روز',
  180: '۱۸۰ روز',
};

export interface BlockchainWalletsSectionProps {
  wallets: BlockchainWallet[];
  balanceByWallet: Record<
    string,
    { data?: BlockchainWalletData; isFetching: boolean; error?: unknown }
  >;
  usdtToToman: number;
  pnlSummary?: BlockchainPnlSummary;
  pnlLoading: boolean;
  vpnStatus: VpnStatus;
  vpnChecking: boolean;
  onRecheckVpn: () => void;
  onAddWallet: (name: string, network: BlockchainNetwork, address: string) => Promise<boolean>;
  onRemoveWallet: (id: string, name: string) => void;
  onRefreshAll: () => void;
  onRefreshWallet: (id: string) => void;
}

export default function BlockchainWalletsSection({
  wallets,
  balanceByWallet,
  usdtToToman,
  pnlSummary,
  pnlLoading,
  vpnStatus,
  vpnChecking,
  onRecheckVpn,
  onAddWallet,
  onRemoveWallet,
  onRefreshAll,
  onRefreshWallet,
}: BlockchainWalletsSectionProps) {
  const [expandedWallet, setExpandedWallet] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [pnlPeriod, setPnlPeriod] = useState<PnlPeriod>(7);

  const totalUsd = useMemo(
    () =>
      wallets.reduce(
        (s, w) => s + (balanceByWallet[w.id]?.data?.totalUsd ?? 0),
        0
      ),
    [wallets, balanceByWallet]
  );
  const totalToman = usdtToToman > 0 ? totalUsd * usdtToToman : 0;
  const anyFetching = wallets.some((w) => balanceByWallet[w.id]?.isFetching);
  const vpnBlocked = vpnStatus === 'iran';

  const pnl = pnlSummary?.byPeriod[pnlPeriod];
  const pnlUsd = pnl ? pnl.usdNow - pnl.usdThen : 0;
  const pnlPct = pnl && pnl.usdThen > 0 ? (pnlUsd / pnl.usdThen) * 100 : 0;
  const pnlPositive = pnlUsd >= 0;

  return (
    <>
      {/* ── کارت مجموع کیف پول‌های بلاکچین ── */}
      <View style={styles.portfolioCard}>
        <View style={styles.portfolioHeader}>
          <LinkIcon size={20} color={colors.dark.accent} />
          <Text style={styles.portfolioTitle}>مجموع کیف پول‌های بلاکچین</Text>
          <Pressable style={styles.refreshAllBtn} onPress={onRefreshAll} disabled={anyFetching}>
            {anyFetching ? (
              <ActivityIndicator size="small" color={colors.dark.accent} />
            ) : (
              <RefreshCw size={16} color={colors.dark.accent} />
            )}
          </Pressable>
        </View>

        <View style={styles.portfolioValues}>
          <View style={styles.portfolioValueRow}>
            <TrendingUp size={14} color={colors.dark.green} />
            <Text style={styles.portfolioValueLabel}>ارزش دلاری:</Text>
            <Text style={styles.portfolioValueAmount}>
              ${totalUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </Text>
          </View>
          {usdtToToman > 0 && (
            <View style={styles.portfolioValueRow}>
              <TrendingUp size={14} color={colors.dark.blue} />
              <Text style={styles.portfolioValueLabel}>ارزش تومانی:</Text>
              <Text style={[styles.portfolioValueAmount, { color: colors.dark.blue }]}>
                {formatToman(totalToman)} تومان
              </Text>
            </View>
          )}
        </View>

        <View style={styles.tomanPriceRow}>
          <Text style={styles.tomanPriceLabel}>قیمت تتر</Text>
          <Text style={styles.tomanPriceValue}>
            {usdtToToman > 0 ? `${usdtToToman.toLocaleString('fa-IR')} تومان` : 'در حال دریافت...'}
          </Text>
        </View>

        <View style={styles.portfolioBreakdown}>
          {wallets.map((w) => (
            <View key={w.id} style={styles.portfolioBreakdownRow}>
              <Text style={styles.portfolioBreakdownName}>
                {w.name} ({NETWORKS[w.network].short})
              </Text>
              <Text style={styles.portfolioBreakdownValue}>
                {balanceByWallet[w.id]?.data
                  ? `$${balanceByWallet[w.id].data!.totalUsd.toLocaleString('en-US', {
                      maximumFractionDigits: 2,
                    })}`
                  : '—'}
              </Text>
            </View>
          ))}
        </View>

        <Text style={styles.portfolioSub}>
          {wallets.length > 0
            ? `${wallets.length.toLocaleString('fa-IR')} کیف پول متصل • فقط خواندنی`
            : 'هنوز کیف پولی اضافه نشده'}
        </Text>

        {/* ── سود/زیان کلی (همه تایم‌فریم‌ها مثل بقیه بخش‌ها) ── */}
        {wallets.length > 0 && (
          <BlockchainPnlCard
            pnlSummary={pnlSummary}
            pnlLoading={pnlLoading}
            period={pnlPeriod}
            onPeriod={setPnlPeriod}
            usdtToToman={usdtToToman}
          />
        )}
      </View>

      {/* ── گیت فیلترشکن: بلاکچین‌ها API خارجی هستند ── */}
      {vpnBlocked && wallets.length > 0 && (
        <View style={styles.vpnGateCard}>
          <ShieldAlert size={22} color={colors.dark.red} />
          <View style={styles.vpnGateTexts}>
            <Text style={styles.vpnGateTitle}>فیلترشکن خاموش است (IP ایران)</Text>
            <Text style={styles.vpnGateSub}>
              خواندن موجودی کیف پول‌های بلاکچین به شبکه بین‌المللی نیاز دارد — با روشن‌کردن
              فیلترشکن، موجودی‌ها خودکار تازه می‌شوند.
            </Text>
          </View>
          <Pressable style={styles.vpnGateBtn} onPress={onRecheckVpn} disabled={vpnChecking}>
            {vpnChecking ? (
              <ActivityIndicator size="small" color={colors.dark.red} />
            ) : (
              <RefreshCcw size={16} color={colors.dark.red} />
            )}
          </Pressable>
        </View>
      )}

      {/* ── فرم افزودن کیف پول (با راهنمای فقط‌خواندنی) ── */}
      {showAddForm ? (
        <AddBlockchainWalletForm
          onCancel={() => setShowAddForm(false)}
          onSubmit={async (name, network, address) => {
            const ok = await onAddWallet(name, network, address);
            if (ok) setShowAddForm(false);
            return ok;
          }}
        />
      ) : (
        <Pressable
          style={styles.addButton}
          onPress={() => setShowAddForm(true)}
          testID="add-blockchain-wallet-button"
        >
          <Plus size={18} color={colors.dark.accent} />
          <Text style={styles.addButtonText}>افزودن کیف پول بلاکچین</Text>
        </Pressable>
      )}

      {/* ── کارت هر کیف پول ── */}
      {wallets.map((wallet) => (
        <BlockchainWalletCard
          key={wallet.id}
          wallet={wallet}
          isExpanded={expandedWallet === wallet.id}
          data={balanceByWallet[wallet.id]?.data}
          isFetching={balanceByWallet[wallet.id]?.isFetching ?? false}
          error={balanceByWallet[wallet.id]?.error}
          usdtToToman={usdtToToman}
          onToggle={() =>
            setExpandedWallet(expandedWallet === wallet.id ? null : wallet.id)
          }
          onRemove={() => onRemoveWallet(wallet.id, wallet.name)}
          onRefresh={() => onRefreshWallet(wallet.id)}
        />
      ))}

      {/* ── حالت خالی ── */}
      {wallets.length === 0 && !showAddForm && (
        <View style={styles.emptyState}>
          <Lock size={44} color={colors.dark.textMuted} />
          <Text style={styles.emptyTitle}>کیف پول بلاکچینی اضافه نشده</Text>
          <Text style={styles.emptySubtitle}>
            کیف پول خود را در حالت فقط‌خواندنی اضافه کنید (مثل تراست ولتم) — فقط با آدرس عمومی،
            بدون کلید خصوصی؛ موجودی و سود/زیان آن همراه دارایی‌هایتان محاسبه می‌شود.
          </Text>
        </View>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// PnL card — same period chips / layout as the other sections
// ---------------------------------------------------------------------------

function BlockchainPnlCard({
  pnlSummary,
  pnlLoading,
  period,
  onPeriod,
  usdtToToman,
}: {
  pnlSummary?: BlockchainPnlSummary;
  pnlLoading: boolean;
  period: PnlPeriod;
  onPeriod: (p: PnlPeriod) => void;
  usdtToToman: number;
}) {
  const pnl = pnlSummary?.byPeriod[period];
  const usdPnl = pnl ? pnl.usdNow - pnl.usdThen : 0;
  const pct = pnl && pnl.usdThen > 0 ? (usdPnl / pnl.usdThen) * 100 : 0;
  const positive = usdPnl >= 0;
  const tomanPnl = usdtToToman > 0 ? usdPnl * usdtToToman : 0;

  return (
    <View style={styles.pnlBox}>
      <View style={styles.pnlHeadRow}>
        {positive ? (
          <TrendingUp size={14} color={colors.dark.green} />
        ) : (
          <TrendingDown size={14} color={colors.dark.red} />
        )}
        <Text style={styles.pnlTitle}>سود / زیان کیف پول‌ها (تغییر قیمت بازار)</Text>
      </View>

      <View style={styles.pnlPeriodRow}>
        {PNL_PERIODS.map((d) => (
          <Pressable
            key={d}
            style={[styles.pnlPeriodChip, period === d && styles.pnlPeriodChipActive]}
            onPress={() => onPeriod(d)}
          >
            <Text style={[styles.pnlPeriodText, period === d && styles.pnlPeriodTextActive]}>
              {PNL_PERIOD_LABEL[d]}
            </Text>
          </Pressable>
        ))}
      </View>

      {pnlLoading && !pnlSummary ? (
        <View style={styles.pnlLoading}>
          <ActivityIndicator size="small" color={colors.dark.accent} />
          <Text style={styles.pnlLoadingText}>دریافت تاریخچه قیمت‌ها…</Text>
        </View>
      ) : !pnl || pnl.tokens.length === 0 ? (
        <Text style={styles.pnlEmpty}>
          برای این بازه تاریخچه قیمت در دسترس نیست — بعداً دوباره تلاش می‌شود
        </Text>
      ) : (
        <>
          <Text style={[styles.pnlTotal, { color: positive ? colors.dark.green : colors.dark.red }]}>
            {positive ? '+' : '−'} ${Math.abs(usdPnl).toLocaleString('en-US', {
              maximumFractionDigits: 2,
            })}
          </Text>
          <View style={styles.pnlPctRow}>
            <View style={[styles.pnlPctChip, !positive && { backgroundColor: colors.dark.red + '1C' }]}>
              <Text style={[styles.pnlPctText, !positive && { color: colors.dark.red }]}>
                {positive ? '▲' : '▼'} {Math.abs(pct).toLocaleString('fa-IR', {
                  maximumFractionDigits: 1,
                })}٪ در {PNL_PERIOD_LABEL[period]}
              </Text>
            </View>
          </View>
          {usdtToToman > 0 && (
            <Text style={[styles.pnlToman, { color: positive ? colors.dark.green : colors.dark.red }]}>
              معادل تومانی: {positive ? '+' : '−'} {formatFullToman(Math.abs(Math.round(tomanPnl)))} تومان
            </Text>
          )}
          {pnl.tokens.slice(0, 12).map((t) => (
            <View key={t.label} style={styles.pnlRow}>
              <Text style={styles.pnlRowLabel}>{t.label}</Text>
              <Text
                style={[
                  styles.pnlRowValue,
                  { color: t.pnl >= 0 ? colors.dark.green : colors.dark.red },
                ]}
              >
                {t.pnl >= 0 ? '+' : '−'} ${Math.abs(t.pnl).toLocaleString('en-US', {
                  maximumFractionDigits: 2,
                })}
              </Text>
            </View>
          ))}
          <Text style={styles.pnlNote}>
            مبنا: موجودی امروز × قیمت پایان روزِ {PNL_PERIOD_LABEL[period]} پیش (بایننس).
            تغییر ارزش بازار است، نه سود واقعی نسبت به قیمت خرید شما.
          </Text>
        </>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Add-wallet form — name / network / address + READ-ONLY GUIDE + warning
// ---------------------------------------------------------------------------

function AddBlockchainWalletForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (name: string, network: BlockchainNetwork, address: string) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [network, setNetwork] = useState<BlockchainNetwork>('ethereum');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);

  const validation = useMemo(
    () => (address.trim() ? validateBlockchainAddress(network, address.trim()) : null),
    [network, address]
  );

  const submit = async () => {
    if (busy) return;
    const finalName = name.trim() || `کیف پول ${NETWORKS[network].label}`;
    const v = validateBlockchainAddress(network, address.trim());
    if (!v.ok) {
      Alert.alert('آدرس نامعتبر', v.message ?? 'آدرس را بررسی کنید');
      return;
    }
    setBusy(true);
    try {
      await onSubmit(finalName, network, address.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.addForm}>
      <Text style={styles.addFormTitle}>افزودن کیف پول بلاکچین</Text>
      <View style={styles.readonlyBadge}>
        <Lock size={12} color={colors.dark.green} />
        <Text style={styles.readonlyBadgeText}>
          فقط‌خواندنی — فقط آدرس عمومی، بدون کلید خصوصی
        </Text>
      </View>

      <Text style={styles.inputLabel}>نام کیف پول</Text>
      <TextInput
        style={[styles.input, styles.inputFa]}
        value={name}
        onChangeText={setName}
        placeholder="مثلاً: تراست ولتم — کیف اصلی"
        placeholderTextColor={colors.dark.textMuted}
        maxLength={40}
      />

      <Text style={styles.inputLabel}>شبکه بلاکچین</Text>
      <View style={styles.networkGrid}>
        {NETWORK_ORDER.map((n) => {
          const meta = NETWORKS[n];
          const active = network === n;
          return (
            <Pressable
              key={n}
              style={[styles.networkChip, active && styles.networkChipActive]}
              onPress={() => setNetwork(n)}
              testID={`network-chip-${n}`}
            >
              <Text style={[styles.networkChipLabel, active && styles.networkChipLabelActive]}>
                {meta.label}
              </Text>
              <Text style={styles.networkChipHint}>{meta.addrHint}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.inputLabel}>آدرس عمومی کیف پول</Text>
      <TextInput
        style={[styles.input, validation?.ok && styles.inputValid]}
        value={address}
        onChangeText={(t) => setAddress(t.replace(/\s+/g, ''))}
        placeholder={NETWORKS[network].addrHint}
        placeholderTextColor={colors.dark.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="default"
        testID="blockchain-address-input"
      />
      {validation && (
        <Text style={[styles.inputHint, validation.ok ? styles.inputHintOk : styles.inputHintErr]}>
          {validation.ok ? '✓ آدرس معتبر است' : validation.message}
        </Text>
      )}

      {/* ── راهنمای فقط‌خواندنی (خواستهٔ کاربر: زیر فرم) ── */}
      <View style={styles.guideBox}>
        <View style={styles.guideTitleRow}>
          <Info size={14} color={colors.dark.blue} />
          <Text style={styles.guideTitle}>آدرس فقط‌خواندنی را از تراست ولتم چطور بگیرم؟</Text>
        </View>
        <View style={styles.guideStep}>
          <View style={styles.guideStepNum}>
            <Text style={styles.guideStepNumText}>۱</Text>
          </View>
          <Text style={styles.guideStepText}>
            برنامه <Text style={styles.guideBold}>تراست ولتم</Text> را باز کنید و کیف پول مورد
            نظر را انتخاب کنید.
          </Text>
        </View>
        <View style={styles.guideStep}>
          <View style={styles.guideStepNum}>
            <Text style={styles.guideStepNumText}>۲</Text>
          </View>
          <Text style={styles.guideStepText}>
            آدرس بالای صفحه را <Text style={styles.guideBold}>لمس کنید تا کپی شود</Text> (آیکون
            کپی کنار آدرس) — یا منوی <Text style={styles.guideBold}>⋯ ← View on Block Explorer</Text>.
          </Text>
        </View>
        <View style={styles.guideStep}>
          <View style={styles.guideStepNum}>
            <Text style={styles.guideStepNumText}>۳</Text>
          </View>
          <Text style={styles.guideStepText}>
            هر شبکه آدرس جدا دارد: دکمه{' '}
            <Text style={styles.guideBold}>دریافت (Receive)</Text> ← انتخاب شبکه ←{' '}
            <Text style={styles.guideBold}>کپی آدرس</Text>. مثلاً ترون با T شروع می‌شود و اتریوم
            با 0x.
          </Text>
        </View>
        <View style={styles.guideStep}>
          <View style={styles.guideStepNum}>
            <Text style={styles.guideStepNumText}>۴</Text>
          </View>
          <Text style={styles.guideStepText}>
            آدرس را در کادر بالا <Text style={styles.guideBold}>Paste</Text> کنید. برای کیف‌های
            دیگر دوباره «افزودن کیف پول» را بزنید — هر کیف، آدرس و شبکه خودش را دارد.
          </Text>
        </View>
      </View>

      {/* ── هشدار امنیتی ── */}
      <View style={styles.warnBox}>
        <View style={styles.warnTitleRow}>
          <AlertTriangle size={14} color={colors.dark.red} />
          <Text style={styles.warnTitle}>هشدار امنیتی — خیلی مهم</Text>
        </View>
        <Text style={styles.warnText}>
          هرگز عبارت بازیابی ۱۲ کلمه‌ای یا کلید خصوصی را در هیچ برنامه‌ای (حتی این برنامه) وارد
          نکنید. این بخش فقط آدرس عمومی می‌گیرد؛ خواندن موجودی از بلاکچین عمومی انجام می‌شود و
          هیچ‌کس — از جمله این برنامه — نمی‌تواند از کیف شما برداشت کند.
        </Text>
      </View>

      <View style={styles.formActions}>
        <Pressable
          style={[styles.formBtn, styles.formBtnSave]}
          disabled={busy}
          onPress={() => void submit()}
          testID="blockchain-add-save"
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.dark.background} />
          ) : (
            <>
              <Plus size={16} color={colors.dark.background} />
              <Text style={styles.formBtnSaveText}>افزودن و نمایش موجودی</Text>
            </>
          )}
        </Pressable>
        <Pressable style={[styles.formBtn, styles.formBtnCancel]} onPress={onCancel} disabled={busy}>
          <Text style={styles.formBtnCancelText}>انصراف</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Per-wallet card (collapsible) — token rows + read-only footer
// ---------------------------------------------------------------------------

function BlockchainWalletCard({
  wallet,
  isExpanded,
  data,
  isFetching,
  error,
  usdtToToman,
  onToggle,
  onRemove,
  onRefresh,
}: {
  wallet: BlockchainWallet;
  isExpanded: boolean;
  data?: BlockchainWalletData;
  isFetching: boolean;
  error?: unknown;
  usdtToToman: number;
  onToggle: () => void;
  onRemove: () => void;
  onRefresh: () => void;
}) {
  const meta = NETWORKS[wallet.network];
  const tomanValue = data && usdtToToman > 0 ? data.totalUsd * usdtToToman : 0;

  return (
    <View style={styles.walletCard}>
      <Pressable style={styles.walletHeader} onPress={onToggle}>
        <View style={[styles.walletAvatar, { backgroundColor: meta.color + '33' }]}>
          <Text style={[styles.walletAvatarText, { color: meta.color }]}>{meta.short}</Text>
        </View>
        <View style={styles.walletNameCol}>
          <Text style={styles.walletName}>{wallet.name}</Text>
          <Text style={styles.walletAddress}>{shortAddress(wallet.address)}</Text>
        </View>
        <View style={styles.walletTotalCol}>
          {isFetching && !data ? (
            <ActivityIndicator size="small" color={colors.dark.accent} />
          ) : (
            <>
              <Text style={styles.walletTotalUsd}>
                ${data ? data.totalUsd.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}
              </Text>
              {tomanValue > 0 && (
                <Text style={styles.walletTotalToman}>{formatToman(tomanValue)} ت</Text>
              )}
            </>
          )}
        </View>
        <View style={styles.walletActions}>
          <Pressable style={styles.walletIconBtn} onPress={onRemove} hitSlop={8}>
            <Trash2 size={13} color={colors.dark.red} />
          </Pressable>
          <Pressable style={styles.walletIconBtn} onPress={onRefresh} hitSlop={8}>
            <RefreshCw size={13} color={data ? colors.dark.accent : colors.dark.textMuted} />
          </Pressable>
          {isExpanded ? (
            <ChevronUp size={15} color={colors.dark.textSecondary} />
          ) : (
            <ChevronDown size={15} color={colors.dark.textSecondary} />
          )}
        </View>
      </Pressable>

      {isExpanded && (
        <View style={styles.walletBody}>
          <View style={styles.networkBadgeRow}>
            <Text style={styles.networkBadge}>{meta.label} • {meta.native}</Text>
            <Text style={styles.networkBadgeReadonly}>
              <Lock size={9} color={colors.dark.green} /> فقط‌خواندنی
            </Text>
          </View>

          {!data && !!error && (
            <Text style={styles.walletError}>
              دریافت موجودی ناموفق بود — دوباره تلاش کنید (آدرس/شبکه را بررسی کنید)
            </Text>
          )}
          {data && data.tokens.length === 0 && (
            <Text style={styles.walletEmptyText}>
              این آدرس موجودی مثبتی ندارد یا هنوز تراکنشی انجام نداده است
            </Text>
          )}

          {data?.tokens.map((t) => (
            <View key={`${t.symbol}-${t.name}`} style={styles.tokenRow}>
              <View style={[styles.tokenIcon, { backgroundColor: meta.color + '26' }]}>
                <Text style={[styles.tokenIconText, { color: meta.color }]}>
                  {t.symbol.slice(0, 1)}
                </Text>
              </View>
              <View style={styles.tokenMain}>
                <Text style={styles.tokenSymbol}>{t.symbol}</Text>
                <Text style={styles.tokenName} numberOfLines={1}>
                  {t.name}
                </Text>
              </View>
              <Text style={styles.tokenQty}>
                {t.qty.toLocaleString('en-US', {
                  maximumFractionDigits: t.qty < 1 ? 8 : 4,
                })}
              </Text>
              <View style={styles.tokenValueCol}>
                <Text style={styles.tokenValue}>
                  {t.priceUsd > 0
                    ? `$${t.valueUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
                    : 'قیمت نامشخص'}
                </Text>
                {t.change24hPct !== null && t.change24hPct !== undefined && (
                  <Text
                    style={[
                      styles.tokenChange,
                      { color: (t.change24hPct ?? 0) >= 0 ? colors.dark.green : colors.dark.red },
                    ]}
                  >
                    {(t.change24hPct ?? 0) >= 0 ? '▲' : '▼'}{' '}
                    {Math.abs(t.change24hPct ?? 0).toLocaleString('fa-IR', {
                      maximumFractionDigits: 2,
                    })}٪
                  </Text>
                )}
              </View>
            </View>
          ))}

          {data && (
            <Text style={styles.walletFetchedAt}>
              آخرین دریافت: {new Date(data.fetchedAt).toLocaleTimeString('fa-IR')} •{' '}
              {data.tokens.length.toLocaleString('fa-IR')} دارایی
            </Text>
          )}

          <View style={styles.lockNote}>
            <Lock size={11} color={colors.dark.green} />
            <Text style={styles.lockNoteText}>
              آدرس عمومی در حافظه دستگاه ذخیره می‌شود — امکان برداشت وجود ندارد
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// styles
// ---------------------------------------------------------------------------

const styles = createThemedStyles(() =>
  StyleSheet.create({
    portfolioCard: {
      backgroundColor: colors.dark.surface,
      borderRadius: 16,
      padding: 20,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.dark.accent + '33',
    },
    portfolioHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 12,
    },
    portfolioTitle: {
      fontSize: 14,
      fontWeight: '600' as const,
      color: colors.dark.textSecondary,
      flex: 1,
      textAlign: 'right',
    },
    refreshAllBtn: {
      padding: 6,
      borderRadius: 8,
      backgroundColor: colors.dark.accentDim,
    },
    portfolioValues: {
      gap: 8,
      marginBottom: 10,
    },
    portfolioValueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.dark.card,
      padding: 10,
      borderRadius: 10,
    },
    portfolioValueLabel: {
      fontSize: 12,
      color: colors.dark.textSecondary,
    },
    portfolioValueAmount: {
      flex: 1,
      textAlign: 'left',
      fontSize: 15,
      fontWeight: '700' as const,
      color: colors.dark.green,
    },
    tomanPriceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.dark.surfaceLight,
      borderRadius: 10,
      paddingVertical: 9,
      paddingHorizontal: 12,
      marginBottom: 6,
    },
    tomanPriceLabel: {
      fontSize: 12,
      fontWeight: '700' as const,
      color: colors.dark.text,
    },
    tomanPriceValue: {
      fontSize: 16,
      fontWeight: '800' as const,
      color: colors.dark.accent,
    },
    portfolioBreakdown: {
      marginTop: 10,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.dark.border,
      gap: 4,
    },
    portfolioBreakdownRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    portfolioBreakdownName: {
      fontSize: 12,
      color: colors.dark.textSecondary,
    },
    portfolioBreakdownValue: {
      fontSize: 12,
      fontWeight: '600' as const,
      color: colors.dark.text,
    },
    portfolioSub: {
      fontSize: 10.5,
      color: colors.dark.textMuted,
      marginTop: 9,
    },

    // ── VPN gate card ──
    vpnGateCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.dark.redDim,
      borderWidth: 1,
      borderColor: colors.dark.red + '40',
      borderRadius: 14,
      padding: 14,
      marginBottom: 14,
    },
    vpnGateTexts: {
      flex: 1,
      gap: 3,
    },
    vpnGateTitle: {
      fontSize: 12.5,
      fontWeight: '700' as const,
      color: colors.dark.red,
    },
    vpnGateSub: {
      fontSize: 10,
      lineHeight: 16,
      color: colors.dark.textSecondary,
    },
    vpnGateBtn: {
      padding: 8,
      borderRadius: 10,
      backgroundColor: colors.dark.red + '18',
    },

    // ── add form ──
    addForm: {
      backgroundColor: colors.dark.surface,
      borderRadius: 16,
      padding: 18,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.dark.border,
    },
    addFormTitle: {
      fontSize: 15,
      fontWeight: '700' as const,
      color: colors.dark.text,
      textAlign: 'right',
      marginBottom: 8,
    },
    readonlyBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      backgroundColor: colors.dark.greenDim,
      borderRadius: 9,
      paddingHorizontal: 10,
      paddingVertical: 5,
      marginBottom: 12,
    },
    readonlyBadgeText: {
      fontSize: 10,
      fontWeight: '700' as const,
      color: colors.dark.green,
    },
    inputLabel: {
      fontSize: 11.5,
      fontWeight: '700' as const,
      color: colors.dark.textSecondary,
      marginTop: 10,
      marginBottom: 6,
      textAlign: 'right',
    },
    input: {
      backgroundColor: colors.dark.surfaceLight,
      borderWidth: 1,
      borderColor: colors.dark.border,
      borderRadius: 10,
      color: colors.dark.text,
      fontSize: 13,
      fontWeight: '600' as const,
      paddingHorizontal: 12,
      paddingVertical: 10,
      textAlign: 'left',
    },
    inputFa: {
      textAlign: 'right',
    },
    inputValid: {
      borderColor: colors.dark.green + '66',
    },
    inputHint: {
      fontSize: 9.5,
      marginTop: 5,
      textAlign: 'right',
    },
    inputHintOk: {
      color: colors.dark.green,
    },
    inputHintErr: {
      color: colors.dark.red,
    },
    networkGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    networkChip: {
      backgroundColor: colors.dark.card,
      borderWidth: 1,
      borderColor: colors.dark.border,
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 7,
      minWidth: '30%' as unknown as number,
      flexGrow: 1,
      flexBasis: '30%' as unknown as number,
      alignItems: 'center',
    },
    networkChipActive: {
      backgroundColor: colors.dark.blueDim,
      borderColor: colors.dark.blue + '77',
    },
    networkChipLabel: {
      fontSize: 10.5,
      fontWeight: '700' as const,
      color: colors.dark.text,
    },
    networkChipLabelActive: {
      color: colors.dark.blue,
    },
    networkChipHint: {
      fontSize: 8,
      color: colors.dark.textMuted,
      marginTop: 1,
    },

    // ── guide box (blue) ──
    guideBox: {
      backgroundColor: colors.dark.blueDim,
      borderWidth: 1,
      borderColor: colors.dark.blue + '40',
      borderRadius: 12,
      padding: 12,
      marginTop: 14,
    },
    guideTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 8,
    },
    guideTitle: {
      fontSize: 11.5,
      fontWeight: '800' as const,
      color: colors.dark.blue,
      flex: 1,
      textAlign: 'right',
    },
    guideStep: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 7,
    },
    guideStepNum: {
      width: 17,
      height: 17,
      borderRadius: 9,
      backgroundColor: colors.dark.blue + '22',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 1,
    },
    guideStepNumText: {
      fontSize: 9.5,
      fontWeight: '800' as const,
      color: colors.dark.blue,
    },
    guideStepText: {
      flex: 1,
      fontSize: 10,
      lineHeight: 17,
      color: colors.dark.textSecondary,
      textAlign: 'right',
    },
    guideBold: {
      color: colors.dark.text,
      fontWeight: '700' as const,
    },

    // ── security warning (red) ──
    warnBox: {
      backgroundColor: colors.dark.redDim,
      borderWidth: 1,
      borderColor: colors.dark.red + '42',
      borderRadius: 12,
      padding: 12,
      marginTop: 10,
    },
    warnTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 5,
    },
    warnTitle: {
      fontSize: 11,
      fontWeight: '800' as const,
      color: colors.dark.red,
      flex: 1,
      textAlign: 'right',
    },
    warnText: {
      fontSize: 9.8,
      lineHeight: 17,
      color: colors.dark.textSecondary,
      textAlign: 'right',
    },

    formActions: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 16,
    },
    formBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderRadius: 10,
      paddingVertical: 11,
      paddingHorizontal: 12,
    },
    formBtnSave: {
      flex: 1.7,
      backgroundColor: colors.dark.accent,
    },
    formBtnSaveText: {
      fontSize: 12.5,
      fontWeight: '800' as const,
      color: colors.dark.background,
    },
    formBtnCancel: {
      flex: 1,
      backgroundColor: colors.dark.card,
      borderWidth: 1,
      borderColor: colors.dark.border,
    },
    formBtnCancelText: {
      fontSize: 12.5,
      fontWeight: '700' as const,
      color: colors.dark.textSecondary,
    },

    addButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.dark.accentDim,
      borderWidth: 1,
      borderColor: colors.dark.accent + '55',
      borderRadius: 14,
      paddingVertical: 13,
      marginBottom: 14,
    },
    addButtonText: {
      fontSize: 13,
      fontWeight: '800' as const,
      color: colors.dark.accent,
    },

    // ── wallet card ──
    walletCard: {
      backgroundColor: colors.dark.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.dark.border,
      padding: 14,
      marginBottom: 12,
    },
    walletHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
    },
    walletAvatar: {
      width: 38,
      height: 38,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    walletAvatarText: {
      fontSize: 10.5,
      fontWeight: '900' as const,
    },
    walletNameCol: {
      flex: 1,
      gap: 2,
    },
    walletName: {
      fontSize: 13,
      fontWeight: '800' as const,
      color: colors.dark.text,
      textAlign: 'right',
    },
    walletAddress: {
      fontSize: 9.5,
      color: colors.dark.textMuted,
      textAlign: 'right',
    },
    walletTotalCol: {
      alignItems: 'flex-start',
      minWidth: 70,
      gap: 2,
    },
    walletTotalUsd: {
      fontSize: 14,
      fontWeight: '800' as const,
      color: colors.dark.green,
    },
    walletTotalToman: {
      fontSize: 9,
      color: colors.dark.textSecondary,
    },
    walletActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    walletIconBtn: {
      padding: 6,
      borderRadius: 8,
      backgroundColor: colors.dark.card,
    },
    walletBody: {
      marginTop: 10,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.dark.border,
    },
    networkBadgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    networkBadge: {
      fontSize: 10,
      fontWeight: '700' as const,
      color: colors.dark.textSecondary,
      backgroundColor: colors.dark.card,
      borderRadius: 8,
      paddingHorizontal: 9,
      paddingVertical: 4,
      overflow: 'hidden',
    },
    networkBadgeReadonly: {
      fontSize: 9.5,
      fontWeight: '700' as const,
      color: colors.dark.green,
      backgroundColor: colors.dark.greenDim,
      borderRadius: 8,
      paddingHorizontal: 9,
      paddingVertical: 4,
      overflow: 'hidden',
    },
    walletError: {
      fontSize: 10,
      color: colors.dark.red,
      textAlign: 'right',
      marginBottom: 8,
      lineHeight: 16,
    },
    walletEmptyText: {
      fontSize: 10.5,
      color: colors.dark.textSecondary,
      textAlign: 'right',
      paddingVertical: 8,
    },
    tokenRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.dark.card,
      borderRadius: 10,
      padding: 9,
      marginBottom: 6,
    },
    tokenIcon: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tokenIconText: {
      fontSize: 11,
      fontWeight: '800' as const,
    },
    tokenMain: {
      flex: 1,
      gap: 1,
      overflow: 'hidden',
    },
    tokenSymbol: {
      fontSize: 11.5,
      fontWeight: '700' as const,
      color: colors.dark.text,
    },
    tokenName: {
      fontSize: 9,
      color: colors.dark.textMuted,
    },
    tokenQty: {
      fontSize: 10.5,
      fontWeight: '600' as const,
      color: colors.dark.textSecondary,
      minWidth: 64,
      textAlign: 'left',
    },
    tokenValueCol: {
      minWidth: 74,
      alignItems: 'flex-start',
      gap: 1,
    },
    tokenValue: {
      fontSize: 11.5,
      fontWeight: '700' as const,
      color: colors.dark.text,
    },
    tokenChange: {
      fontSize: 9,
      fontWeight: '600' as const,
    },
    walletFetchedAt: {
      fontSize: 9,
      color: colors.dark.textMuted,
      marginTop: 4,
      textAlign: 'right',
    },
    lockNote: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.dark.greenDim,
      borderRadius: 9,
      paddingHorizontal: 10,
      paddingVertical: 7,
      marginTop: 8,
    },
    lockNoteText: {
      flex: 1,
      fontSize: 9,
      lineHeight: 14,
      color: colors.dark.green,
      fontWeight: '600' as const,
      textAlign: 'right',
    },

    // ── empty state ──
    emptyState: {
      alignItems: 'center',
      paddingVertical: 34,
      gap: 8,
    },
    emptyTitle: {
      fontSize: 14,
      fontWeight: '700' as const,
      color: colors.dark.text,
    },
    emptySubtitle: {
      fontSize: 10.5,
      lineHeight: 18,
      color: colors.dark.textSecondary,
      textAlign: 'center',
      paddingHorizontal: 14,
    },

    // ── PnL card ──
    pnlBox: {
      marginTop: 12,
      backgroundColor: colors.dark.card,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.dark.border,
    },
    pnlHeadRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 8,
    },
    pnlTitle: {
      fontSize: 12,
      fontWeight: '700' as const,
      color: colors.dark.text,
      flex: 1,
      textAlign: 'right',
    },
    pnlPeriodRow: {
      flexDirection: 'row',
      gap: 6,
      marginBottom: 10,
    },
    pnlPeriodChip: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 5,
      borderRadius: 8,
      backgroundColor: colors.dark.surface,
      borderWidth: 1,
      borderColor: colors.dark.border,
    },
    pnlPeriodChipActive: {
      backgroundColor: colors.dark.accentDim,
      borderColor: colors.dark.accent,
    },
    pnlPeriodText: {
      fontSize: 10.5,
      fontWeight: '600' as const,
      color: colors.dark.textSecondary,
    },
    pnlPeriodTextActive: {
      color: colors.dark.accent,
      fontWeight: '700' as const,
    },
    pnlLoading: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      justifyContent: 'center',
      paddingVertical: 10,
    },
    pnlLoadingText: {
      fontSize: 11,
      color: colors.dark.textSecondary,
    },
    pnlEmpty: {
      fontSize: 10.5,
      lineHeight: 17,
      color: colors.dark.textSecondary,
      textAlign: 'center',
      paddingVertical: 8,
    },
    pnlTotal: {
      fontSize: 20,
      fontWeight: '800' as const,
      textAlign: 'right',
    },
    pnlPctRow: {
      flexDirection: 'row',
      justifyContent: 'flex-start',
      marginVertical: 6,
    },
    pnlPctChip: {
      backgroundColor: colors.dark.green + '18',
      borderRadius: 9,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    pnlPctText: {
      fontSize: 11,
      fontWeight: '800' as const,
      color: colors.dark.green,
    },
    pnlToman: {
      fontSize: 10.5,
      fontWeight: '700' as const,
      marginBottom: 6,
      textAlign: 'right',
    },
    pnlRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 5,
      borderTopWidth: 1,
      borderTopColor: colors.dark.border + '33',
    },
    pnlRowLabel: {
      fontSize: 11,
      fontWeight: '600' as const,
      color: colors.dark.textSecondary,
    },
    pnlRowValue: {
      fontSize: 12,
      fontWeight: '700' as const,
    },
    pnlNote: {
      fontSize: 9,
      lineHeight: 15,
      color: colors.dark.textMuted,
      textAlign: 'right',
      marginTop: 8,
    },
  })
);
