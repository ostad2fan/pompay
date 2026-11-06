/**
 * StartupIpGate.tsx — full-screen Iran-IP gate (v1.4.8 uses the shared
 * VpnGateContext as its single source of truth).
 *
 *   1. Cold start: IP + country are detected and shown
 *      («IP فعلی شما X، کشور Y»).
 *   2. Iranian IP → «برای استفاده از برنامه فیلترشکن را روشن کنید» +
 *      «تأیید و خروج» (closes the app; the Android back button exits too) +
 *      «بررسی مجدد» so the user can turn the VPN on and continue.
 *   3. Non-Iranian exit → green message → automatic entry.
 *   4. MID-SESSION VPN drop / IP change to Iran (v1.4.8): the gate RE-APPEARS
 *      with «فیلترشکن خاموش شد» — every polling consumer (scanner, wallets,
 *      market queries) is cut at the same moment via the shared context, and
 *      this overlay blocks the whole UI until the VPN is re-checked.
 */

import React, { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, BackHandler } from 'react-native';
import { ShieldAlert, ShieldCheck, Globe, RefreshCw, LogOut, WifiOff } from 'lucide-react-native';
import colors from '@/constants/colors';
import { createThemedStyles } from '@/utils/themeStyles';
import { useVpnGate } from '@/contexts/VpnGateContext';

export default function StartupIpGate() {
  const { status, ip, countryNameFa, country, checking, reArmedAt, recheck } = useVpnGate();

  const visible = status === 'iran';

  // While the blocking gate is up, the Android hardware back button exits
  // the app too (there is no "sneaking past" the gate).
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      BackHandler.exitApp();
      return true;
    });
    return () => sub.remove();
  }, [visible]);

  if (!visible) return null;

  const countryLabel = countryNameFa ?? country ?? '—';
  const midSession = reArmedAt !== null;

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <View style={[styles.iconWrap, { backgroundColor: colors.dark.orangeDim }]}>
          {midSession ? (
            <WifiOff size={30} color={colors.dark.orange} />
          ) : (
            <ShieldAlert size={30} color={colors.dark.orange} />
          )}
        </View>

        <Text style={styles.title}>
          {midSession ? 'فیلترشکن خاموش شد / IP تغییر کرد' : 'بررسی IP برنامه'}
        </Text>

        <View style={styles.ipRow}>
          <Text style={styles.ipLabel}>IP فعلی شما:</Text>
          <Text style={styles.ipValue} selectable>
            {ip ?? 'نامشخص'}
          </Text>
        </View>
        <View style={styles.ipRow}>
          <Text style={styles.ipLabel}>کشور:</Text>
          <Text style={styles.ipValue}>{countryLabel}</Text>
        </View>

        <Text style={styles.blockedMessage}>
          {midSession
            ? 'IP شما الان ایران تشخیص داده شد — اتصال همه بخش‌های برنامه (اسکنر، کیف پول‌ها و داده‌های بازار) همان لحظه قطع شد و این پیام تا زمان وصل شدن فیلترشکن نمایش داده می‌شود.'
            : 'برای استفاده از برنامه فیلترشکن را روشن کنید. برنامه با IP ایران اجازه ورود ندارد؛ صرافی‌های خارجی هم IP ایران را مسدود می‌کنند و اتصال مستقیم می‌تواند امنیت حساب شما را به خطر بیندازد.'}
        </Text>

        <Pressable style={styles.exitBtn} onPress={() => BackHandler.exitApp()}>
          <LogOut size={14} color="#FFF" />
          <Text style={styles.exitBtnText}>تأیید و خروج از برنامه</Text>
        </Pressable>

        <Pressable style={styles.recheckBtn} onPress={() => void recheck()} disabled={checking}>
          <RefreshCw size={12} color={colors.dark.accent} />
          <Text style={styles.recheckBtnText}>
            {checking ? 'در حال بررسی...' : 'فیلترشکن را وصل کردم — بررسی مجدد'}
          </Text>
        </Pressable>

        {checking && <ActivityIndicator size="small" color={colors.dark.accent} />}
      </View>
    </View>
  );
}

const styles = createThemedStyles(() =>
  StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.88)',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 999,
      elevation: 999,
      paddingHorizontal: 20,
    },
    card: {
      width: '100%',
      maxWidth: 380,
      backgroundColor: colors.dark.surface,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.dark.border,
      padding: 22,
      alignItems: 'center',
      gap: 12,
    },
    iconWrap: {
      width: 60,
      height: 60,
      borderRadius: 30,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.dark.orangeDim,
    },
    title: {
      fontSize: 16,
      fontWeight: '800' as const,
      color: colors.dark.text,
      textAlign: 'center',
    },
    ipRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      alignSelf: 'stretch',
      justifyContent: 'space-between',
      paddingHorizontal: 6,
    },
    ipLabel: {
      fontSize: 12,
      color: colors.dark.textSecondary,
    },
    ipValue: {
      fontSize: 13,
      fontWeight: '700' as const,
      color: colors.dark.text,
    },
    blockedMessage: {
      fontSize: 12,
      lineHeight: 20,
      color: colors.dark.orange,
      textAlign: 'right',
      backgroundColor: colors.dark.orangeDim,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.dark.orange + '55',
      padding: 10,
      alignSelf: 'stretch',
    },
    exitBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.dark.red,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 18,
      alignSelf: 'stretch',
    },
    exitBtnText: {
      color: '#FFF',
      fontSize: 13,
      fontWeight: '800' as const,
    },
    recheckBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.dark.accentDim,
      borderRadius: 10,
      paddingVertical: 9,
      paddingHorizontal: 14,
      alignSelf: 'stretch',
    },
    recheckBtnText: {
      color: colors.dark.accent,
      fontSize: 12,
      fontWeight: '700' as const,
    },
  })
);
