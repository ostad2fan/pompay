/**
 * IpStatusCard.tsx — v1.4.8 live IP/country card, pinned at the TOP of the
 * settings list («اول اینکه بعد از تشخیص IP و کشورش اونو در بخش تنظیمات
 * در ابتدای لیست نشون بده»).
 *
 * Shows: connection status badge, exit IP, country (Persian name when known)
 * + last-check time + a manual re-check button. Live from the shared
 * VpnGateContext (15s polling) — the same state that drives the full-screen
 * gate and the query cut-offs.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { ShieldCheck, ShieldAlert, HelpCircle, RefreshCw, Globe } from 'lucide-react-native';
import colors from '@/constants/colors';
import { createThemedStyles } from '@/utils/themeStyles';
import { useVpnGate } from '@/contexts/VpnGateContext';

export default function IpStatusCard() {
  const { status, ip, country, countryNameFa, checking, lastCheckedAt, recheck } = useVpnGate();

  const isOk = status === 'vpn';
  const isIran = status === 'iran';
  const countryLabel = countryNameFa ?? country ?? 'نامشخص';

  return (
    <View
      style={[
        styles.card,
        isOk && styles.cardOk,
        isIran && styles.cardIran,
      ]}
    >
      <View style={styles.headerRow}>
        {isOk ? (
          <ShieldCheck size={16} color={colors.dark.green} />
        ) : isIran ? (
          <ShieldAlert size={16} color={colors.dark.orange} />
        ) : (
          <HelpCircle size={16} color={colors.dark.textSecondary} />
        )}
        <Text style={[styles.title, isOk && styles.titleOk, isIran && styles.titleIran]}>
          وضعیت اتصال (IP)
        </Text>
        {checking && <ActivityIndicator size="small" color={colors.dark.accent} />}
        <Pressable style={styles.refreshBtn} onPress={() => void recheck()} hitSlop={6}>
          <RefreshCw size={12} color={colors.dark.accent} />
        </Pressable>
      </View>

      <View style={styles.row}>
        <Globe size={12} color={colors.dark.textSecondary} />
        <Text style={styles.rowLabel}>IP فعلی:</Text>
        <Text style={styles.rowValue} selectable>
          {ip ?? 'در حال تشخیص...'}
        </Text>
      </View>
      <View style={styles.row}>
        <Globe size={12} color={colors.dark.textSecondary} />
        <Text style={styles.rowLabel}>کشور:</Text>
        <Text style={styles.rowValue}>{countryLabel}</Text>
      </View>

      <Text style={[styles.statusText, isOk && styles.statusOk, isIran && styles.statusIran]}>
        {isOk
          ? '✓ فیلترشکن روشن است — اتصال از کشور خارجی انجام می‌شود و همه بخش‌ها فعال‌اند'
          : isIran
            ? '⚠ IP ایران — اتصال همه بخش‌های برنامه قطع شده؛ فیلترشکن را وصل کنید'
            : 'تشخیص IP موقتاً در دسترس نیست (سرویس‌های تشخیص پاسخ ندادند)'}
      </Text>

      {lastCheckedAt && (
        <Text style={styles.lastCheck}>
          آخرین بررسی: {new Date(lastCheckedAt).toLocaleTimeString('fa-IR')}
        </Text>
      )}
    </View>
  );
}

const styles = createThemedStyles(() =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.dark.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.dark.border,
      padding: 14,
      gap: 8,
    },
    cardOk: {
      borderColor: colors.dark.green + '55',
    },
    cardIran: {
      borderColor: colors.dark.orange + '66',
      backgroundColor: colors.dark.orangeDim,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    title: {
      fontSize: 13,
      fontWeight: '800' as const,
      color: colors.dark.text,
      flex: 1,
      textAlign: 'right',
    },
    titleOk: { color: colors.dark.green },
    titleIran: { color: colors.dark.orange },
    refreshBtn: {
      padding: 6,
      borderRadius: 8,
      backgroundColor: colors.dark.accentDim,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    rowLabel: {
      fontSize: 11,
      color: colors.dark.textSecondary,
      minWidth: 52,
    },
    rowValue: {
      fontSize: 12,
      fontWeight: '700' as const,
      color: colors.dark.text,
      flex: 1,
      textAlign: 'left',
    },
    statusText: {
      fontSize: 11,
      lineHeight: 17,
      color: colors.dark.textSecondary,
      textAlign: 'right',
    },
    statusOk: { color: colors.dark.green },
    statusIran: { color: colors.dark.orange },
    lastCheck: {
      fontSize: 10,
      color: colors.dark.textMuted,
      textAlign: 'right',
    },
  })
);
