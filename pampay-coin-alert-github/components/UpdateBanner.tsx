/**
 * UpdateBanner — slides down from the very top of the screen when a newer
 * app version is published on GitHub (apk/version.json). Tapping the button
 * opens the browser and the APK file downloads directly. The banner can be
 * dismissed — it stays hidden for that version only (a newer release will
 * show it again). Checks: on mount, every 30 minutes and on app foreground.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Download, X } from 'lucide-react-native';
import colors from '@/constants/colors';
import { createThemedStyles } from '@/utils/themeStyles';
import {
  AppUpdateInfo,
  dismissUpdate,
  fetchUpdateInfo,
  isUpdateDismissed,
  onUpdateInfoChanged,
  openApkDownload,
  apkFileNameFor,
} from '@/utils/appUpdate';

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export default function UpdateBanner() {
  const [info, setInfo] = useState<AppUpdateInfo | null>(null);
  const [hidden, setHidden] = useState(true);
  const slide = useRef(new Animated.Value(-120)).current;
  const busy = useRef(false);

  const check = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const result = await fetchUpdateInfo();
    busy.current = false;
    if (!result || !result.available) return;
    const dismissed = await isUpdateDismissed(result.latestVersion);
    if (dismissed) return;
    setInfo(result);
    setHidden(false);
    Animated.spring(slide, {
      toValue: 0,
      useNativeDriver: true,
      friction: 7,
      tension: 60,
    }).start();
  }, [slide]);

  // Re-render whenever ANY check (also from Settings) refreshes the info.
  useEffect(() => {
    const off = onUpdateInfoChanged((latest) => {
      if (latest && latest.available) {
        isUpdateDismissed(latest.latestVersion).then((dismissed) => {
          if (dismissed) return;
          setInfo(latest);
          setHidden(false);
          Animated.spring(slide, {
            toValue: 0,
            useNativeDriver: true,
            friction: 7,
            tension: 60,
          }).start();
        });
      }
    });
    return off;
  }, [slide]);

  useEffect(() => {
    check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [check]);

  const handleClose = useCallback(async () => {
    if (!info) return;
    setHidden(true);
    Animated.timing(slide, {
      toValue: -120,
      duration: 220,
      useNativeDriver: true,
    }).start();
    await dismissUpdate(info.latestVersion);
  }, [info, slide]);

  const handleDownload = useCallback(async () => {
    if (!info) return;
    try {
      await openApkDownload(info.apkUrl);
    } catch {}
  }, [info]);

  if (hidden || !info) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrapper, { transform: [{ translateY: slide }] }]}
    >
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.card}>
          <View style={styles.textBlock}>
            <Text style={styles.title}>
              🎉 نسخه جدید {info.latestVersion} منتشر شد!
            </Text>
            <Text style={styles.subtitle} numberOfLines={3}>
              {`فایل دانلودی: ${apkFileNameFor(info)}\n`}
              {info.notes?.trim()
                ? info.notes
                : 'نسخه نصب‌شده شما قدیمی است. برای دریافت امکانات جدید، بروزرسانی کنید.'}
            </Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.downloadBtn, pressed && { opacity: 0.8 }]}
            onPress={handleDownload}
            testID="update-banner-download"
          >
            <Download size={15} color="#0B0E11" />
            {/* v1.4.10 — شماره نسخه روی خود دکمه، تا کاربر بداند چه نسخه‌ای
                دانلود می‌شود (نام فایل هم شامل نسخه است). */}
            <Text style={styles.downloadText}>{`دانلود ${info.latestVersion}`}</Text>
          </Pressable>
          <Pressable onPress={handleClose} hitSlop={10} style={styles.closeBtn}>
            <X size={17} color={colors.dark.textSecondary} />
          </Pressable>
        </View>
      </SafeAreaView>
    </Animated.View>
  );
}

const styles = createThemedStyles(() => StyleSheet.create({
  wrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    elevation: 1000,
  },
  safe: {
    backgroundColor: 'rgba(11,14,17,0.97)',
    borderBottomWidth: 1,
    borderBottomColor: colors.dark.accent + '55',
  },
  card: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  textBlock: {
    flex: 1,
  },
  title: {
    color: colors.dark.accent,
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'right',
  },
  subtitle: {
    color: colors.dark.textSecondary,
    fontSize: 11,
    marginTop: 3,
    textAlign: 'right',
    lineHeight: 16,
  },
  downloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.dark.accent,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 10,
  },
  downloadText: {
    color: '#0B0E11',
    fontSize: 12,
    fontWeight: '800',
  },
  closeBtn: {
    padding: 4,
  },
}));
