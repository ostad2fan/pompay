/**
 * auto-trade.tsx — v1.5.0
 *
 * «معامله خودکار» — the DEDICATED screen for the auto-trading bot
 * (third section of «ترید با AI»). The bot itself works in demo AND real
 * (its own mode toggle); real keys are read from the saved exchange
 * configs, so demo works with NO exchange configured at all.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Info } from 'lucide-react-native';
import colors from '@/constants/colors';
import TradeAiSegmentHeader from '@/components/TradeAiSegmentHeader';
import AutoTradingBotSection from '@/components/AutoTradingBotSection';

export default function AutoTradeScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TradeAiSegmentHeader active="auto" />

      <AutoTradingBotSection />

      {/* ── short in-page explanation (full guide: تنظیمات ← راهنمای کامل) ── */}
      <View style={styles.aboutBox}>
        <View style={styles.aboutHead}>
          <Info size={13} color={colors.dark.blue} />
          <Text style={styles.aboutTitle}>معامله‌گر خودکار چطور کار می‌کند؟</Text>
        </View>
        <Text style={styles.aboutText}>
          {'• منبع سیگنال‌ها (مثل ردیابی نهنگ‌ها، با کلید روشن/خاموش): کپی معاملات نهنگ انتخابی و/یا سیگنال اندیکاتورهای آماده (هوک ریورسال، GainzAlgo Pro) و اندیکاتورهای دستی شما — برای هر اندیکاتور ۱ یا ۲ تایم‌فریم انتخاب می‌کنید.\n\n• هر معامله: لوریج، حجم دلاری، حداکثر ضرر (٪) و ریوارد R:R خودتان را می‌گذارید؛ استاپ‌لاس و تیک‌پرافیت نسبت به نقطه ورود اتوماتیک محاسبه و ثبت می‌شوند.\n\n• تریلینگ استاپ برای «همه» معاملات خودش فعال است: معامله سودده هرگز با ضرر بسته نمی‌شود و اگر ریسک‌فری شود، حداقل کارمزد صرافی بیرون می‌آید.\n\n• مدیریت سرمایه هوشمند: بعد از ضررهای پیاپی حجم پله‌ای کم می‌شود؛ با رسیدن سقف ضرر روزانه، پوزیشن جدید باز نمی‌شود.\n\n• دمو بدون هیچ صرافی کار می‌کند؛ برای واقعی، از تب «ترید واقعی» کلید API بایننس را اضافه کنید.\n\n• ربات روشن می‌ماند: تنظیمِ روشن بودن ذخیره می‌شود و با بستن برنامه خاموش نمی‌شود؛ موتور در کل برنامه هر ۶۰ ثانیه و با باز شدن دوباره برنامه چرخه می‌زند. در حالت واقعی، استاپ و تیک‌پرافیت روی خود صرافی live می‌مانند و حتی وقتی برنامه بسته است محافظت می‌کنند.\n\n• PnL ربات در تایم‌فریم‌های مختلف (امروز/۷/۳۰/همه) با خروجی عکس — قابل ذخیره در گالری و اشتراک‌گذاری در هر برنامه.\n\n• راهنمای کامل: تنظیمات ← «راهنمای کامل برنامه» ← معامله‌گر خودکار.'}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.background,
  },
  content: {
    padding: 12,
    paddingBottom: 40,
  },
  aboutBox: {
    backgroundColor: colors.dark.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    padding: 12,
  },
  aboutHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  aboutTitle: {
    fontSize: 11.5,
    fontWeight: '800',
    color: colors.dark.text,
  },
  aboutText: {
    fontSize: 9.5,
    lineHeight: 16,
    color: colors.dark.textSecondary,
  },
});
