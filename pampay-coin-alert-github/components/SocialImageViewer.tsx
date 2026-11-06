/**
 * components/SocialImageViewer.tsx — v1.5.15
 *
 * نمایشگر تمام‌صفحه عکس چارت سیگنال‌های سوشال‌مدیا.
 *
 * v1.5.15 — رفع باگ «زوم کار نمی‌کند»: maximumZoomScale روی ScrollView فقط
 * در iOS رفتار پینچ دارد و در اندروید نادیده گرفته می‌شود. حالا زوم واقعی با
 * react-native-gesture-handler (بدون کتابخانه جدید — از قبل در پروژه هست):
 *   • پینچ دو انگشتی تا ۸ برابر (PinchGestureHandler + Animated)؛
 *   • دابل‌تپ = رفت‌وبرگشت بین ۱× و ۲.۵×؛
 *   • بعد از زوم، با یک انگشت جابه‌جا (PanGestureHandler)؛
 *   • اگر زوم زیر ۱ برود، با فنر به اندازه اصلی برمی‌گردد.
 * کیفیت نمایش هم بالا رفت: عکس با پارامتر name=large توییتر لود می‌شود و
 * دکمه ذخیره، فایل اصلی (name=orig) را در گالری می‌گذارد تا اعداد و قیمت‌ها
 * دقیق خوانده شوند.
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
  StatusBar,
  Animated,
} from 'react-native';
import {
  PinchGestureHandler,
  PanGestureHandler,
  TapGestureHandler,
  State,
} from 'react-native-gesture-handler';
import { X, Download, Check } from 'lucide-react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import colors from '@/constants/colors';
import { upgradeTwitterImageUrl } from '@/utils/socialSignalsService';

const WIN = Dimensions.get('window');
const DOUBLE_TAP_ZOOM = 2.5;

interface Props {
  visible: boolean;
  imageUrl: string | null;
  onClose: () => void;
}

export default function SocialImageViewer({ visible, imageUrl, onClose }: Props) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const zoom = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const zoomRef = useRef(1);
  const doubleTapRef = useRef<TapGestureHandler | null>(null);
  const pinchRef = useRef<PinchGestureHandler | null>(null);

  useEffect(() => {
    const id = zoom.addListener((s) => {
      zoomRef.current = s.value;
    });
    return () => zoom.removeAllListeners();
  }, [zoom]);

  const resetView = useCallback(() => {
    Animated.parallel([
      Animated.spring(zoom, { toValue: 1, useNativeDriver: true, friction: 8 }),
      Animated.spring(tx, { toValue: 0, useNativeDriver: true, friction: 8 }),
      Animated.spring(ty, { toValue: 0, useNativeDriver: true, friction: 8 }),
    ]).start();
  }, [zoom, tx, ty]);

  const toggleDoubleTapZoom = useCallback(() => {
    const target = zoomRef.current > 1.05 ? 1 : DOUBLE_TAP_ZOOM;
    Animated.parallel([
      Animated.spring(zoom, { toValue: target, useNativeDriver: true, friction: 8 }),
      Animated.spring(tx, { toValue: 0, useNativeDriver: true, friction: 8 }),
      Animated.spring(ty, { toValue: 0, useNativeDriver: true, friction: 8 }),
    ]).start();
  }, [zoom, tx, ty]);

  useEffect(() => {
    if (visible) {
      setSaved(false);
      setSaveError(null);
      setSaving(false);
      zoom.setValue(1);
      tx.setValue(0);
      ty.setValue(0);
    }
  }, [visible, imageUrl, zoom, tx, ty]);

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
      // v1.5.15 — فایل اصلی (name=orig) ذخیره می‌شود، نه پیش‌نمایش کوچک RSS
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
      <StatusBar hidden />
      <View style={styles.backdrop}>
        <TapGestureHandler
          ref={doubleTapRef}
          numberOfTaps={2}
          onActivated={toggleDoubleTapZoom}
        >
          <PinchGestureHandler
            ref={pinchRef}
            simultaneousHandlers={doubleTapRef}
            onGestureEvent={Animated.event([{ nativeEvent: { scale: zoom } }], {
              useNativeDriver: true,
            })}
            onHandlerStateChange={(e) => {
              const { state } = e.nativeEvent;
              if (state === State.END && zoomRef.current < 1.02) {
                resetView();
              }
            }}
          >
            <PanGestureHandler
              simultaneousHandlers={[doubleTapRef, pinchRef]}
              onGestureEvent={Animated.event(
                [{ nativeEvent: { translationX: tx, translationY: ty } }],
                { useNativeDriver: true }
              )}
              onHandlerStateChange={(e) => {
                if (e.nativeEvent.state === State.END && zoomRef.current <= 1.02) {
                  Animated.parallel([
                    Animated.spring(tx, { toValue: 0, useNativeDriver: true, friction: 8 }),
                    Animated.spring(ty, { toValue: 0, useNativeDriver: true, friction: 8 }),
                  ]).start();
                }
              }}
            >
              <Animated.View style={styles.zoomArea}>
                <Animated.View
                  style={[
                    styles.imageWrap,
                    {
                      transform: [{ translateX: tx }, { translateY: ty }, { scale: zoom }],
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
              </Animated.View>
            </PanGestureHandler>
          </PinchGestureHandler>
        </TapGestureHandler>

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
  zoomArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  imageWrap: {
    width: WIN.width,
    height: WIN.height * 0.92,
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
