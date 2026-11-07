/**
 * components/WhatsNewModal.tsx — v1.5.15
 *
 * مودال «تغییرات این نسخه»: وقتی کاربر نسخه جدید را نصب کرد و وارد برنامه
 * شد، تغییرات همان نسخه را فقط «بار اول» نشان می‌دهد؛ با دکمه «متوجه شدم»
 * (یا رد کردن) دیگر برای همان نسخه نمایش داده نمی‌شود. نسخه بعدی مودال
 * خودش را دارد.
 */

import React, { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import colors from '@/constants/colors';
import {
  getWhatsNew,
  markWhatsNewSeen,
  shouldShowWhatsNew,
} from '@/utils/appChangelog';

export default function WhatsNewModal() {
  const [visible, setVisible] = useState(false);
  const whatsNew = getWhatsNew();

  useEffect(() => {
    let alive = true;
    // کمی تاخیر تا اسپلش/لود اولیه تمام شود
    const t = setTimeout(() => {
      void shouldShowWhatsNew().then((show) => {
        if (alive && show) setVisible(true);
      });
    }, 1200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, []);

  const dismiss = () => {
    void markWhatsNewSeen();
    setVisible(false);
  };

  if (!whatsNew) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.head}>
            <Sparkles size={18} color={colors.dark.accent} />
            <Text style={styles.title}>{whatsNew.title}</Text>
          </View>
          <ScrollView style={styles.bodyScroll} showsVerticalScrollIndicator={false}>
            {whatsNew.items.map((line, i) => (
              <Text key={i} style={styles.item}>
                {line}
              </Text>
            ))}
          </ScrollView>
          <Pressable style={({ pressed }) => [styles.okBtn, pressed && { opacity: 0.85 }]} onPress={dismiss}>
            <Text style={styles.okText}>متوجه شدم</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    backgroundColor: colors.dark.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.dark.accent + '44',
    padding: 18,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  title: {
    fontSize: 15,
    fontWeight: '800' as const,
    color: colors.dark.text,
    flex: 1,
    textAlign: 'right',
  },
  bodyScroll: {
    marginBottom: 14,
  },
  item: {
    fontSize: 13,
    color: colors.dark.textSecondary,
    lineHeight: 22,
    textAlign: 'right',
    marginBottom: 10,
  },
  okBtn: {
    backgroundColor: colors.dark.accent,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  okText: {
    color: '#fff',
    fontWeight: '800' as const,
    fontSize: 14,
  },
});
