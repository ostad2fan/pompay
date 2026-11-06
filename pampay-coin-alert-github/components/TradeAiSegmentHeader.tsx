/**
 * TradeAiSegmentHeader.tsx — v1.5.2 / v1.5.13
 *
 * «ترید با AI» has FOUR main tabs (user demand):
 *   ۱) دمو — تحلیل هوش مصنوعی (همان بخش قبلی)
 *   ۲) بک‌تست — معامله‌گر خودکار (ربات)؛ اسمش طبق درخواست کاربر «بک‌تست» شد
 *   ۳) واقعی — ترید واقعی (بخش کامل خودش)
 *   ۴) سوشال‌مدیا (v1.5.13) — سیگنال‌های توییتر بدون سرور
 *
 * v1.5.2: هدر ثابت بالای صفحه (بیرون از ScrollView) — تب‌ها سر جایشان
 * می‌مانند و با اسکرول بالا/پایین نمی‌روند.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { FlaskConical, Bot, Wallet2, MessagesSquare } from 'lucide-react-native';
import colors from '@/constants/colors';

export type TradeAiSegment = 'demo' | 'backtest' | 'real' | 'social';

const SEGMENTS: {
  key: TradeAiSegment;
  label: string;
  route: string;
  icon: (size: number, color: string) => React.ReactNode;
}[] = [
  {
    key: 'demo',
    label: 'دمو (تحلیل AI)',
    route: '/trade-ai',
    icon: (s, c) => <FlaskConical size={s} color={c} />,
  },
  {
    key: 'backtest',
    label: 'بک‌تست (ربات)',
    route: '/trade-ai/auto-trade',
    icon: (s, c) => <Bot size={s} color={c} />,
  },
  {
    key: 'real',
    label: 'واقعی',
    route: '/trade-ai/real-trade',
    icon: (s, c) => <Wallet2 size={s} color={c} />,
  },
  {
    key: 'social',
    label: 'سوشال‌مدیا',
    route: '/trade-ai/social-signals',
    icon: (s, c) => <MessagesSquare size={s} color={c} />,
  },
];

export default function TradeAiSegmentHeader({ active }: { active: TradeAiSegment }) {
  const router = useRouter();
  return (
    <View style={styles.wrap}>
      {SEGMENTS.map((seg) => {
        const on = seg.key === active;
        return (
          <Pressable
            key={seg.key}
            style={[styles.btn, on && styles.btnActive]}
            onPress={() => {
              if (on) return;
              router.replace(seg.route as never);
            }}
            testID={`trade-ai-segment-${seg.key}`}
          >
            {seg.icon(14, on ? colors.dark.background : colors.dark.textSecondary)}
            <Text style={[styles.btnText, on && styles.btnTextActive]} numberOfLines={1}>
              {seg.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    backgroundColor: colors.dark.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.dark.border,
    padding: 3,
    paddingHorizontal: 6,
    gap: 3,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 9,
    paddingVertical: 9,
    paddingHorizontal: 2,
    backgroundColor: 'transparent',
  },
  btnActive: {
    backgroundColor: colors.dark.accent,
  },
  btnText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: colors.dark.textSecondary,
  },
  btnTextActive: {
    color: colors.dark.background,
    fontWeight: '800',
  },
});
