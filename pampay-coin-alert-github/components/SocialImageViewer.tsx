/**
 * components/SocialImageViewer.tsx — v1.5.17
 *
 * نمایشگر تمام‌صفحه عکس چارت سیگنال‌های سوشال‌مدیا.
 *
 * v1.5.17 — حل ریشه‌ای کرش «لمس عکس → خروج از برنامه» (v1.5.15 و v1.5.16):
 *   علت واقعی پیدا شد: برنامه روی معماری جدید (newArchEnabled=true) اجرا
 *   می‌شود و در آن Animated با useNativeDriver:true کار نمی‌کند — ترکیب
 *   هندلرهای کلاسیک gesture-handler + انیمیشن native-driver داخل Modal همان
 *   چیزی بود که اندروید را می‌بست (هر دو نسخهٔ قبل از همین بود).
 *   این نسخه صددرصد امنِ-کرش است:
 *   • بدون react-native-gesture-handler — فقط PanResponder خالص React Native
 *   • بدون useNativeDriver در هیچ‌جای فایل — همهٔ انیمیشن‌ها JS-driven
 *   • زوم با دو انگشت (پینچ تا ۸ برابر) + دابل‌تپ (۱× ↔ ۲.۵×) + جابه‌جایی
 *     با یک انگشت بعد از زوم — همه در جاوااسکریپت، بدون نود انیمیشن native
 *   • ذخیرهٔ گالری همچنان با فایل اصلی (orig) — اعداد و قیمت‌ها دقیق
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
  ActivityIndicator,
  Dimensions,
  Animated,
  PanResponder,
} from 'react-native';
import { X, Download, Check } from 'lucide-react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import colors from '@/constants/colors';
import { upgradeTwitterImageUrl } from '@/utils/socialSignalsService';

const WIN = Dimensions.get('window');
const DOUBLE_TAP_ZOOM = 2.5;
const MAX_ZOOM = 8;
const clampZoom = (v: number) => Math.min(MAX_ZOOM, Math.max(1, v));

interface Props {
  visible: boolean;
  imageUrl: string | null;
  onClose: () => void;
}

export default function SocialImageViewer({ visible, imageUrl, onClose }: Props) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // انیمیشن JS-driven — استفاده از useNativeDriver در معماری جدید ممنوع است
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;

  // وضعیت ژست در ref معمولی — هیچ listener روی نود انیمیشن وجود ندارد
  const g = useRef({
    scale: 1,
    baseX: 0,
    baseY: 0,
    x: 0,
    y: 0,
    pinchDist0: 0,
    pinchScale0: 1,
    lastTap: 0,
  }).current;

  const springTo = useCallback(
    (sv: number, xv: number, yv: number) => {
      Animated.parallel([
        Animated.spring(scale, { toValue: sv, useNativeDriver: false, friction: 8, tension: 60 }),
        Animated.spring(tx, { toValue: xv, useNativeDriver: false, friction: 8 }),
        Animated.spring(ty, { toValue: yv, useNativeDriver: false, friction: 8 }),
      ]).start();
    },
    [scale, tx, ty]
  );

  const toggleDoubleTapZoom = useCallback(() => {
    const target = g.scale > 1.05 ? 1 : DOUBLE_TAP_ZOOM;
    g.scale = target;
    g.x = 0;
    g.y = 0;
    springTo(target, 0, 0);
  }, [g, springTo]);

  useEffect(() => {
    if (visible) {
      setSaved(false);
      setSaveError(null);
      setSaving(false);
      g.scale = 1;
      g.x = 0;
      g.y = 0;
      g.pinchDist0 = 0;
      g.lastTap = 0;
      scale.setValue(1);
      tx.setValue(0);
      ty.setValue(0);
    }
  }, [visible, imageUrl, g, scale, tx, ty]);

  const panResponder = useRef(
    PanResponder.create({
      // همهٔ لمس‌ها را از همان ابتدا می‌گیریم تا دابل‌تپ و پینچ هر دو دیده شوند
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        const now = Date.now();
        if (now - g.lastTap < 300) {
          g.lastTap = 0;
          toggleDoubleTapZoom();
          return;
        }
        g.lastTap = now;
      },
      onPanResponderMove: (e, gs) => {
        const ts = e.nativeEvent.touches;
        if (ts.length >= 2) {
          // پینچ: نسبت فاصلهٔ دو انگشت نسبت به لحظهٔ شروع
          const a = ts[0];
          const b = ts[1];
          const dx = a.pageX - b.pageX;
          const dy = a.pageY - b.pageY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (g.pinchDist0 <= 0) {
            g.pinchDist0 = dist;
            g.pinchScale0 = g.scale;
          } else if (dist > 1) {
            g.scale = clampZoom(g.pinchScale0 * (dist / g.pinchDist0));
            scale.setValue(g.scale);
          }
        } else if (g.scale > 1.02) {
          // جابه‌جایی با یک انگشت فقط وقتی زوم کرده است
          g.x = g.baseX + gs.dx;
          g.y = g.baseY + gs.dy;
          tx.setValue(g.x);
          ty.setValue(g.y);
        }
      },
      onPanResponderRelease: () => {
        g.pinchDist0 = 0;
        const s = clampZoom(g.scale);
        if (s < 1.02) {
          // برگشت نرم به اندازهٔ اصلی
          g.scale = 1;
          g.x = 0;
          g.y = 0;
          springTo(1, 0, 0);
        } else {
          springTo(s, g.x, g.y);
        }
      },
      onPanResponderTerminate: () => {
        g.pinchDist0 = 0;
      },
    })
  ).current;

  const handleSave = useCallback(async () => {
    if (!imageUrl || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync().catch(
        () => ({ granted: false }) as { granted: boolean }
      );
      if (!perm.granted) {
        setSaveError('اجازه دسترسی به گالری داده نشد — از تنظیمات گوشی فعالش کنید');
        return;
      }
      // فایل اصلی (name=orig) ذخیره می‌شود، نه پیش‌نمایش کوچک RSS
      const orig = upgradeTwitterImageUrl(imageUrl, 'orig');
      const name = `pampi-signal-${Date.now()}.jpg`;
      const local = `${FileSystem.cacheDirectory}${name}`;
      const res = await FileSystem.downloadAsync(orig, local);
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      await MediaLibrary.saveToLibraryAsync(res.uri);
      setSaved(true);
    } catch (e) {
      setSaveError(`ذخیره نشد: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [imageUrl, saving]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop} {...panResponder.panHandlers}>
        <Animated.View
          style={[
            styles.imageWrap,
            {
              transform: [{ translateX: tx }, { translateY: ty }, { scale }],
            },
          ]}
        >
          {imageUrl ? (
            <Image
              source={{ uri: upgradeTwitterImageUrl(imageUrl, 'large') }}
              style={styles.image}
              resizeMode="contain"
              accessibilityLabel="چارت سیگنال — تمام‌صفحه"
            />
          ) : null}
        </Animated.View>

        <View style={styles.topBar} pointerEvents="box-none">
          <Pressable style={styles.iconBtn} onPress={onClose} hitSlop={8} testID="social-image-close">
            <X size={20} color="#fff" />
          </Pressable>
          <Text style={styles.hint} numberOfLines={1}>
            زوم: دو انگشت یا دابل‌تپ
          </Text>
          <Pressable
            style={[styles.iconBtn, saved && styles.iconBtnDone]}
            onPress={handleSave}
            disabled={saving || !imageUrl}
            hitSlop={8}
            testID="social-image-save"
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : saved ? (
              <Check size={20} color={colors.dark.green} />
            ) : (
              <Download size={20} color="#fff" />
            )}
          </Pressable>
        </View>

        {(saveError || saved) && (
          <View style={[styles.toast, saved ? styles.toastOk : styles.toastErr]} pointerEvents="none">
            <Text style={styles.toastText}>
              {saved ? 'عکس با کیفیت اصلی در گالری ذخیره شد ✓' : saveError}
            </Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#000',
  },
  imageWrap: {
    width: WIN.width,
    height: WIN.height * 0.92,
    marginTop: WIN.height * 0.04,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  topBar: {
    position: 'absolute',
    top: 40,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(20,20,24,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnDone: {
    borderColor: colors.dark.green,
  },
  hint: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
  },
  toast: {
    position: 'absolute',
    bottom: 60,
    left: 24,
    right: 24,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  toastOk: {
    backgroundColor: 'rgba(16,64,34,0.92)',
  },
  toastErr: {
    backgroundColor: 'rgba(84,20,20,0.92)',
  },
  toastText: {
    color: '#fff',
    fontSize: 12,
    textAlign: 'center',
  },
});
