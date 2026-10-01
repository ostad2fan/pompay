/**
 * StartupIpGate.tsx — v1.4.7 full-screen Iran-IP gate shown when the app opens.
 *
 * Behavior (exactly as requested):
 *   1. On cold start the phone's public exit IP + country are detected and
 *      SHOWN («IP فعلی شما X، کشور Y»).
 *   2. Iranian IP → «برای استفاده از برنامه فیلترشکن را روشن کنید» + a
 *      «تأیید و خروج» button that CLOSES the app, plus «بررسی مجدد» so the
 *      user can turn the VPN on and continue without restarting.
 *   3. Non-Iranian exit (VPN on) → green message + automatic entry.
 *   4. 'unknown' (all geo providers unreachable) → the app stays usable
 *      (gate can't brick the app when the check itself fails) — the in-app
 *      wallet banner + hard query gate still protect the exchange keys.
 *   5. Re-arms whenever the app comes back from the background
 *      (AppState 'active'), so switching the VPN off and reopening re-checks.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, BackHandler, AppState } from 'react-native';
import { ShieldAlert, ShieldCheck, Globe, RefreshCw, LogOut } from 'lucide-react-native';
import colors from '@/constants/colors';
import { createThemedStyles } from '@/utils/themeStyles';
import { getIpInfo, IpInfo } from '@/utils/vpnGuard';

export default function StartupIpGate() {
  const [visible, setVisible] = useState(true);
  const [checking, setChecking] = useState(true);
  const [info, setInfo] = useState<IpInfo | null>(null);
  const appState = useRef(AppState.currentState);

  const runCheck = useCallback(async (force: boolean) => {
    setChecking(true);
    try {
      const result = await getIpInfo(force);
      setInfo(result);
      if (result.status === 'iran') {
        setVisible(true); // blocked — gate stays
      } else {
        // Non-Iran (or unknown) → let the user in. A short beat shows the
        // green status first so the message is actually readable.
        setTimeout(() => setVisible(false), 1200);
      }
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void runCheck(true);
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appState.current;
      appState.current = next;
      // Coming back from background → re-verify the exit IP.
      if (prev.match(/inactive|background/) && next === 'active') {
        void runCheck(true);
      }
    });
    return () => sub.remove();
  }, [runCheck]);

  // While the blocking gate is up, the Android hardware back button exits
  // the app too (there is no "sneaking past" the gate).
  useEffect(() => {
    if (!visible || info?.status !== 'iran') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      BackHandler.exitApp();
      return true;
    });
    return () => sub.remove();
  }, [visible, info?.status]);

  if (!visible) return null;

  const isIran = info?.status === 'iran';
  const isOk = info?.status === 'vpn';
  const countryLabel = info?.countryNameFa ?? info?.country ?? '—';

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <View style={[styles.iconWrap, { backgroundColor: isIran ? colors.dark.orangeDim : isOk ? colors.dark.greenDim : colors.dark.surface }]}>
          {checking ? (
            <Globe size={30} color={colors.dark.accent} />
          ) : isIran ? (
            <ShieldAlert size={30} color={colors.dark.orange} />
          ) : (
            <ShieldCheck size={30} color={colors.dark.green} />
          )}
        </View>

        <Text style={styles.title}>بررسی IP برنامه</Text>

        {checking ? (
          <>
            <ActivityIndicator size="small" color={colors.dark.accent} />
            <Text style={styles.body}>در حال تشخیص IP و کشور فعلی شما...</Text>
          </>
        ) : (
          <>
            <View style={styles.ipRow}>
              <Text style={styles.ipLabel}>IP فعلی شما:</Text>
              <Text style={styles.ipValue} selectable>
                {info?.ip ?? 'نامشخص'}
              </Text>
            </View>
            <View style={styles.ipRow}>
              <Text style={styles.ipLabel}>کشور:</Text>
              <Text style={styles.ipValue}>{countryLabel}</Text>
            </View>

            {isIran && (
              <>
                <Text style={styles.blockedMessage}>
                  برای استفاده از برنامه فیلترشکن را روشن کنید. برنامه با IP ایران
                  اجازه ورود ندارد؛ صرافی‌های خارجی هم IP ایران را مسدود می‌کنند و
                  اتصال مستقیم می‌تواند امنیت حساب شما را به خطر بیندازد.
                </Text>
                <Pressable style={styles.exitBtn} onPress={() => BackHandler.exitApp()}>
                  <LogOut size={14} color="#FFF" />
                  <Text style={styles.exitBtnText}>تأیید و خروج از برنامه</Text>
                </Pressable>
                <Pressable style={styles.recheckBtn} onPress={() => void runCheck(true)}>
                  <RefreshCw size={12} color={colors.dark.accent} />
                  <Text style={styles.recheckBtnText}>
                    فیلترشکن را وصل کردم — بررسی مجدد
                  </Text>
                </Pressable>
              </>
            )}

            {isOk && (
              <Text style={styles.okMessage}>
                ✓ اتصال از کشور {countryLabel} برقرار است — ورود به برنامه...
              </Text>
            )}

            {info?.status === 'unknown' && (
              <>
                <Text style={styles.unknownMessage}>
                  تشخیص کشور در دسترس نبود (سرویس‌های تشخیص IP پاسخ ندادند).
                  ورود انجام می‌شود؛ در بخش مدیریت دارایی، اگر IP ایران تشخیص داده
                  شود، صرافی‌های خارجی به‌صورت خودکار مسدود می‌شوند.
                </Text>
                <Pressable style={styles.recheckBtn} onPress={() => void runCheck(true)}>
                  <RefreshCw size={12} color={colors.dark.accent} />
                  <Text style={styles.recheckBtnText}>بررسی مجدد</Text>
                </Pressable>
                <Pressable style={styles.enterBtn} onPress={() => setVisible(false)}>
                  <Text style={styles.enterBtnText}>ادامه</Text>
                </Pressable>
              </>
            )}
          </>
        )}
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
    },
    title: {
      fontSize: 16,
      fontWeight: '800' as const,
      color: colors.dark.text,
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
    body: {
      fontSize: 12,
      color: colors.dark.textSecondary,
      textAlign: 'right',
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
    okMessage: {
      fontSize: 12,
      lineHeight: 19,
      color: colors.dark.green,
      textAlign: 'right',
    },
    unknownMessage: {
      fontSize: 11,
      lineHeight: 17,
      color: colors.dark.textSecondary,
      textAlign: 'right',
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
    enterBtn: {
      alignItems: 'center',
      backgroundColor: colors.dark.accent,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 18,
      alignSelf: 'stretch',
    },
    enterBtnText: {
      color: '#FFF',
      fontSize: 12,
      fontWeight: '800' as const,
    },
  })
);
