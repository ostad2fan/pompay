/**
 * TradeAiSegmentHeader.tsx — v1.5.0
 *
 * «ترید با AI» now has THREE sections (user demand):
 *   ۱) تحلیل هوش مصنوعی (همان بخش قبلی)
 *   ۲) ترید واقعی (به داخل همین بخش آمد)
 *   ۳) معامله خودکار (خودش دو حالت دمو/واقعی دارد)
 *
 * Shared segment switcher rendered at the top of all three screens.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Brain, Wallet2, Bot } from 'lucide-react-native';
import colors from '@/constants/colors';

export type TradeAiSegment = 'ai' | 'real' | 'auto';

const SEGMENTS: {
  key: TradeAiSegment;
  label: string;
  route: string;
  icon: (size: number, color: string) => React.ReactNode;
}[] = [
  {
    key: 'ai',
    label: 'تحلیل هوش مصنوعی',
    route: '/trade-ai',
    icon: (s, c) => <Brain size={s} color={c} />,
  },
  {
    key: 'real',
    label: 'ترید واقعی',
    route: '/trade-ai/real-trade',
    icon: (s, c) => <Wallet2 size={s} color={c} />,
  },
  {
    key: 'auto',
    label: 'معامله خودکار',
    route: '/trade-ai/auto-trade',
    icon: (s, c) => <Bot size={s} color={c} />,
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
            {seg.icon(on ? 13 : 13, on ? colors.dark.background : colors.dark.textSecondary)}
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
    marginBottom: 12,
    gap: 3,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 9,
    paddingVertical: 8,
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
