/**
 * components/SocialImageViewer.tsx — v1.5.14
 *
 * نمایشگر تمام‌صفحه عکس چارت سیگنال‌های سوشال‌مدیا، طبق درخواست کاربر:
 *   • روی عکس هر سیگنال که بزنی، عکس «تمام‌صفحه» باز می‌شود؛
 *   • زوم دو انگشتی (پینچ) تا ۸ برابر + جابه‌جایی با کشیدن — جزئیات چارت
 *     دقیقاً مثل گالری گوشی قابل بررسی است (ScrollView بومی با
 *     maximumZoomScale = زوم نرم و بدون لگ، بدون کتابخانه اضافه)؛
 *   • دکمه «ذخیره در گالری» عکس را دانلود و در گالری گوشی ذخیره می‌کند تا
 *     بعد از دانلود هم جزئیات با زوم گالری دیده شود؛
 *   • ضربدر بالا = بستن. لمس پس‌زمینه هم می‌بندد.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
  Dimensions,
  StatusBar,
} from 'react-native';
import { X, Download, Check } from 'lucide-react-native';
// SDK 54: cacheDirectory/downloadAsync live in the legacy entry (theme compat)
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import colors from '@/constants/colors';

const WIN = Dimensions.get('window');

interface Props {
  visible: boolean;
  imageUrl: string | null;
  onClose: () => void;
}

export default function SocialImageViewer({ visible, imageUrl, onClose }: Props) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setSaved(false);
      setSaveError(null);
      setSaving(false);
    }
  }, [visible, imageUrl]);

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
      const name = `pampi-signal-${Date.now()}.jpg`;
      const local = `${FileSystem.cacheDirectory}${name}`;
      const res = await FileSystem.downloadAsync(imageUrl, local);
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
        {/* زوم: پینچ دو انگشتی تا ۸ برابر + پن با کشیدن (ScrollView بومی) */}
        <ScrollView
          style={styles.zoomArea}
          contentContainerStyle={styles.zoomContent}
          maximumZoomScale={8}
          minimumZoomScale={1}
          bouncesZoom
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
        >
          {imageUrl ? (
            <Image
              source={{ uri: imageUrl }}
              style={styles.image}
              resizeMode="contain"
              accessibilityLabel="چارت سیگنال — تمام‌صفحه"
            />
          ) : null}
        </ScrollView>

        <View style={styles.topBar} pointerEvents="box-none">
          <Pressable style={styles.iconBtn} onPress={onClose} hitSlop={8} testID="social-image-close">
            <X size={20} color="#fff" />
          </Pressable>
          <Text style={styles.hint} numberOfLines={1}>
            زوم با دو انگشت
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
              {saved ? 'عکس در گالری گوشی ذخیره شد ✓' : saveError}
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
  },
  zoomContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: WIN.width,
    height: WIN.height * 0.92,
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
