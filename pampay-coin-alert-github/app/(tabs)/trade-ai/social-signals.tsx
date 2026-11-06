/**
 * app/(tabs)/trade-ai/social-signals.tsx — v1.5.14
 *
 * تب «سوشال‌مدیا» — سیگنال‌های سوشال‌مدیا بدون هیچ سروری (فقط اینترنت گوشی).
 *
 * طبق درخواست کاربر (دموی تاییدشده + اصلاحات نهایی):
 *   • هیچ کادر «منبع پیش‌فرض» در صفحه نیست — توضیحش فقط داخل راهنمای همین تب.
 *   • توییت‌های بدون عکس چارت اصلاً نمایش داده نمی‌شوند (نه کارت، نه پیام فیلتر).
 *   • نام کاربری (آیدی) منبع و لینک توییت به‌صورت پیش‌فرض هیچ‌جا (برنامه و
 *     تلگرام) نمایش داده نمی‌شود — دو کلید روشن/خاموش داخل «راهنما و تنظیمات
 *     نمایش» همین تب هستند و پیش‌فرض خاموش‌اند.
 *   • بروزرسانی خودکار طبق «بازه بروزرسانی» تنظیمات برنامه (توضیح در راهنما).
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Image,
  Switch,
  Linking,
  RefreshControl,
} from 'react-native';
import {
  MessagesSquare,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  Clock,
  ImageOff,
  ShieldCheck,
  User,
  Link2,
  HelpCircle,
  Send,
} from 'lucide-react-native';
import colors from '@/constants/colors';
import { createThemedStyles } from '@/utils/themeStyles';
import { useApp } from '@/contexts/AppContext';
import TradeAiSegmentHeader from '@/components/TradeAiSegmentHeader';
import { ThemedAlert } from '@/components/ThemedAlert';
import SocialImageViewer from '@/components/SocialImageViewer';
import {
  SocialSignal,
  SocialSource,
  loadSocialSignals,
  runSocialSignalsCycle,
  listSocialSources,
  addSocialSource,
  removeSocialSource,
  sendSocialTelegramTest,
} from '@/utils/socialSignalsService';

function timeAgoFa(ms: number): string {
  const mins = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  if (mins < 1) return 'همین حالا';
  if (mins < 60) return `${mins.toLocaleString('fa-IR')} دقیقه پیش`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h.toLocaleString('fa-IR')} ساعت پیش`;
  return `${Math.floor(h / 24).toLocaleString('fa-IR')} روز پیش`;
}

export default function SocialSignalsScreen() {
  const { settings, updateSettings } = useApp();
  const [signals, setSignals] = useState<SocialSignal[]>([]);
  const [sources, setSources] = useState<SocialSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);
  // v1.5.14 — راهنما و تنظیمات نمایش: به‌صورت پیش‌فرض جمع‌شده است و با
  // زدن فلش باز می‌شود (خواندنش با کاربر است).
  const [guideOpen, setGuideOpen] = useState(false);
  const [newSource, setNewSource] = useState('');
  const [adding, setAdding] = useState(false);
  const [viewerImage, setViewerImage] = useState<string | null>(null);
  const [testingTg, setTestingTg] = useState(false);

  const showSourceName = settings.socialShowSourceName === true;
  const showLink = settings.socialShowSourceLink === true;

  const refreshSignals = useCallback(async () => {
    const [list, srcs] = await Promise.all([loadSocialSignals(), listSocialSources()]);
    setSignals(list);
    setSources(srcs);
    if (list.length > 0) setLastFetchAt(Math.max(...list.map((s) => s.fetchedAt)));
  }, []);

  useEffect(() => {
    refreshSignals().finally(() => setLoading(false));
    // وقتی کاربر به این تب برمی‌گردد، یک چرخه تازه بزن تا لیست به‌روز باشد.
    void runSocialSignalsCycle()
      .then(() => refreshSignals())
      .catch(() => {});
  }, [refreshSignals]);

  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await runSocialSignalsCycle();
      await refreshSignals();
    } catch {} finally {
      setRefreshing(false);
    }
  }, [refreshSignals]);

  const handleAddSource = useCallback(async () => {
    if (!newSource.trim()) return;
    setAdding(true);
    try {
      const res = await addSocialSource(newSource.trim());
      if (!res.ok) {
        ThemedAlert.alert('افزودن نشد', res.error ?? 'خطا');
      } else {
        setNewSource('');
        await refreshSignals();
        // چرخه فوری برای منبع تازه
        void runSocialSignalsCycle().then(() => refreshSignals()).catch(() => {});
      }
    } finally {
      setAdding(false);
    }
  }, [newSource, refreshSignals]);

  const handleRemoveSource = useCallback(
    (user: string) => {
      ThemedAlert.alert('حذف منبع', `منبع @${user} حذف شود؟`, [
        { text: 'لغو', style: 'cancel' },
        {
          text: 'حذف',
          style: 'destructive',
          onPress: () => {
            void removeSocialSource(user).then(() => refreshSignals());
          },
        },
      ]);
    },
    [refreshSignals]
  );

  const toggleSourceName = useCallback(
    (v: boolean) => updateSettings({ socialShowSourceName: v }),
    [updateSettings]
  );
  const toggleSourceLink = useCallback(
    (v: boolean) => updateSettings({ socialShowSourceLink: v }),
    [updateSettings]
  );

  const openLink = useCallback((url: string) => {
    Linking.openURL(url).catch(() => {});
  }, []);

  /** v1.5.14 — تست ارسال ۲ سیگنال آخر (همراه عکس چارت) به تلگرام. */
  const handleTelegramTest = useCallback(async () => {
    if (testingTg) return;
    setTestingTg(true);
    try {
      const res = await sendSocialTelegramTest();
      if (res.error === 'telegram_disabled') {
        ThemedAlert.alert(
          'تلگرام فعال نیست',
          'اول در «تنظیمات برنامه» بخش تلگرام، ربات و چت‌آیدی را ثبت و تلگرام را روشن کنید؛ بعد دوباره این تست را بزنید.'
        );
      } else if (res.error === 'no_signals') {
        ThemedAlert.alert(
          'سیگنالی برای تست نیست',
          'هنوز هیچ سیگنالی ذخیره نشده. صفحه را به پایین بکشید تا بروزرسانی شود و بعد دوباره تست را بزنید.'
        );
      } else if (res.ok) {
        ThemedAlert.alert(
          'تست تلگرام موفق ✓',
          `${res.sent.toLocaleString('fa-IR')} سیگنال (با عکس چارت) به تلگرام ارسال شد — ربات شما را چک کنید.`
        );
      } else {
        ThemedAlert.alert(
          'ارسال به تلگرام نشد',
          'اتصال اینترنت یا توکن ربات را چک کنید. اگر عکس از سمت تلگرام باز نشود، متن سیگنال فرستاده می‌شود (خطای جزئیات در لاگ).'
        );
      }
    } finally {
      setTestingTg(false);
    }
  }, [testingTg]);

  return (
    <View style={styles.container}>
      <View style={styles.segmentWrap}>
        <TradeAiSegmentHeader active="social" />
      </View>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleManualRefresh}
            tintColor={colors.dark.accent}
            colors={[colors.dark.accent]}
          />
        }
      >
        {/* ── راهنما و تنظیمات نمایش (سوییچ‌ها اینجاست — پیش‌فرض خاموش) ── */}
        <View style={styles.guideCard}>
          <Pressable style={styles.guideHead} onPress={() => setGuideOpen(!guideOpen)}>
            <View style={styles.guideHeadLeft}>
              <HelpCircle size={15} color={colors.dark.accent} />
              <Text style={styles.guideTitle}>راهنما و تنظیمات نمایش منبع</Text>
            </View>
            {guideOpen ? (
              <ChevronUp size={15} color={colors.dark.textMuted} />
            ) : (
              <ChevronDown size={15} color={colors.dark.textMuted} />
            )}
          </Pressable>

          {guideOpen && (
            <View style={styles.guideBody}>
              <Text style={styles.guideText}>
                این بخش توییت‌های معتبرِ منابع انتخابی شما را «بدون هیچ سروری» و فقط با اینترنت گوشی می‌گیرد. از آنجا که توییتر API رایگان عمومی ندارد، برنامه از گیت‌وی‌های عمومی RSS استفاده می‌کند و اگر یکی قطع بود خودش سراغ بعدی می‌رود؛ آخرین گیت‌وی سالم برای دفعات بعدی به‌خاطر سپرده می‌شود.
              </Text>
              <Text style={styles.guideText}>
                • منبع پیش‌فرض، آیدی توییتری است که در «افزودن منبع» می‌بینید؛ هر کاربر توییتر دیگری را هم می‌توانید اضافه یا حذف کنید (لینک پروفایل مثل x.com/username یا فقط آیدی).
                {'\n'}• بروزرسانی خودکار طبق «بازه بروزرسانی» در تنظیمات برنامه انجام می‌شود؛ هر بار که این تب را باز کنید یا به برنامه برگردید هم یک چرخه تازه زده می‌شود — پس توییت تازه منبع پیش‌فرض سریع در برنامه و تلگرام می‌افتد.
                {'\n'}• فقط توییت‌هایی سیگنال محسوب می‌شوند که هم تیکر دلار ($) داشته باشند و هم عکس چارت؛ توییت‌های بدون عکس چارت اصلاً نمایش داده نمی‌شوند و پیامی هم برایشان نمی‌آید.
                {'\n'}• روی عکس هر سیگنال بزنید تا تمام‌صفحه باز شود؛ با دو انگشت زوم کنید (تا ۸ برابر) و جزئیات چارت را ببینید؛ دکمه دانلود بالای صفحه، عکس را در گالری گوشی ذخیره می‌کند.
                {'\n'}• ارسال به تلگرام هم بدون سرور و مستقیم از گوشی انجام می‌شود؛ کافی است تلگرام در تنظیمات برنامه فعال باشد. دکمه «تست ارسال به تلگرام» پایین همین بخش، ۲ سیگنال آخر را با عکس می‌فرستد تا مطمئن شوید اتصال درست است.
              </Text>

              <View style={styles.privacyBox}>
                <ShieldCheck size={14} color={colors.dark.blue} />
                <Text style={styles.privacyText}>
                  حریم خصوصی منبع: نام کاربری و لینک توییت به‌صورت پیش‌فرض در برنامه و تلگرام مخفی است. با کلیدهای زیر می‌توانید نمایش‌شان بدهید:
                </Text>
              </View>

              <View style={styles.switchRow}>
                <View style={styles.switchRowLeft}>
                  <User size={13} color={showSourceName ? colors.dark.green : colors.dark.textMuted} />
                  <Text style={styles.switchLabel}>نمایش نام کاربری منبع (برنامه + تلگرام)</Text>
                </View>
                <Switch
                  value={showSourceName}
                  onValueChange={toggleSourceName}
                  trackColor={{ false: colors.dark.border, true: colors.dark.green }}
                  thumbColor="#fff"
                  testID="social-show-source-name"
                />
              </View>
              <View style={styles.switchRow}>
                <View style={styles.switchRowLeft}>
                  <Link2 size={13} color={showLink ? colors.dark.green : colors.dark.textMuted} />
                  <Text style={styles.switchLabel}>نمایش لینک توییت (برنامه + تلگرام)</Text>
                </View>
                <Switch
                  value={showLink}
                  onValueChange={toggleSourceLink}
                  trackColor={{ false: colors.dark.border, true: colors.dark.green }}
                  thumbColor="#fff"
                  testID="social-show-source-link"
                />
              </View>

              {/* v1.5.14 — تست ارسال ۲ سیگنال آخر (همراه عکس چارت) به تلگرام */}
              <Pressable
                style={({ pressed }) => [styles.testTgBtn, pressed && { opacity: 0.85 }]}
                onPress={handleTelegramTest}
                disabled={testingTg}
                testID="social-telegram-test"
              >
                {testingTg ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Send size={14} color="#fff" />
                )}
                <Text style={styles.testTgText}>تست ارسال به تلگرام (۲ سیگنال آخر با عکس)</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* ── افزودن منبع + لیست منابع ── */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Plus size={14} color={colors.dark.accent} />
            <Text style={styles.sectionTitle}>افزودن منبع (هر کاربر توییتر)</Text>
          </View>
          <View style={styles.addRow}>
            <TextInput
              style={styles.input}
              value={newSource}
              onChangeText={setNewSource}
              placeholder="x.com/username یا username"
              placeholderTextColor={colors.dark.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              testID="social-source-input"
            />
            <Pressable
              style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}
              onPress={handleAddSource}
              disabled={adding}
            >
              {adding ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Plus size={16} color="#fff" />
              )}
            </Pressable>
          </View>
          <View style={styles.sourcesWrap}>
            {sources.map((s) => (
              <View key={s.user} style={styles.sourceChip}>
                <Text style={styles.sourceChipText}>@{s.user}</Text>
                {s.builtin ? (
                  <Text style={styles.sourceChipBuiltin}>پیش‌فرض</Text>
                ) : (
                  <Pressable onPress={() => handleRemoveSource(s.user)} hitSlop={8}>
                    <Trash2 size={13} color={colors.dark.red} />
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        </View>

        {/* ── سربرگ لیست سیگنال‌ها ── */}
        <View style={styles.listHead}>
          <View style={styles.listHeadLeft}>
            <MessagesSquare size={15} color={colors.dark.accent} />
            <Text style={styles.sectionTitle}>سیگنال‌های امروز ({signals.length.toLocaleString('fa-IR')})</Text>
          </View>
          <Pressable style={styles.refreshBtn} onPress={handleManualRefresh} disabled={refreshing}>
            {refreshing ? (
              <ActivityIndicator size="small" color={colors.dark.accent} />
            ) : (
              <RefreshCw size={14} color={colors.dark.accent} />
            )}
          </Pressable>
        </View>
        {lastFetchAt != null && (
          <View style={styles.lastFetchRow}>
            <Clock size={11} color={colors.dark.textMuted} />
            <Text style={styles.lastFetchText}>آخرین بروزرسانی: {timeAgoFa(lastFetchAt)}</Text>
          </View>
        )}

        {/* ── کارت‌های سیگنال ── */}
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={colors.dark.accent} />
            <Text style={styles.loadingText}>در حال دریافت سیگنال‌ها…</Text>
          </View>
        ) : signals.length === 0 ? (
          <View style={styles.emptyBox}>
            <ImageOff size={26} color={colors.dark.textMuted} />
            <Text style={styles.emptyTitle}>هنوز سیگنالی نیست</Text>
            <Text style={styles.emptyText}>
              هر توییت فقط وقتی سیگنال است که تیکر ($) و عکس چارت داشته باشد. با کشیدن صفحه به پایین، همین حالا بروزرسانی کنید.
            </Text>
          </View>
        ) : (
          signals.map((sig) => (
            <View key={sig.id} style={styles.signalCard}>
              <View style={styles.signalHead}>
                <View style={styles.tagRow}>
                  {sig.tickers.slice(0, 3).map((t) => (
                    <View key={t} style={styles.tagChip}>
                      <Text style={styles.tagText}>${t}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.timeText}>{timeAgoFa(sig.publishedAt)}</Text>
              </View>

              {/* نام کاربری فقط با کلید راهنما (پیش‌فرض خاموش) */}
              {showSourceName && (
                <View style={styles.sourceRow}>
                  <User size={12} color={colors.dark.textMuted} />
                  <Text style={styles.sourceText}>منبع: @{sig.sourceUser}</Text>
                </View>
              )}

              {/* v1.5.14 — لمس عکس = نمایشگر تمام‌صفحه با زوم دو انگشتی + ذخیره در گالری */}
              <Pressable onPress={() => setViewerImage(sig.imageUrl)} testID={`social-img-${sig.id}`}>
                <Image
                  source={{ uri: sig.imageUrl }}
                  style={styles.chartImage}
                  resizeMode="cover"
                  accessibilityLabel="چارت سیگنال — برای تمام‌صفحه بزنید"
                />
              </Pressable>
              <Text style={styles.signalText} numberOfLines={8}>
                {sig.text}
              </Text>

              {/* لینک توییت فقط با کلید راهنما (پیش‌فرض خاموش) */}
              {showLink && (
                <Pressable style={styles.linkBtn} onPress={() => openLink(sig.link)}>
                  <Link2 size={12} color={colors.dark.blue} />
                  <Text style={styles.linkText}>مشاهده توییت</Text>
                </Pressable>
              )}
            </View>
          ))
        )}
      </ScrollView>

      {/* v1.5.14 — نمایشگر تمام‌صفحه عکس چارت (زوم + ذخیره در گالری) */}
      <SocialImageViewer
        visible={viewerImage != null}
        imageUrl={viewerImage}
        onClose={() => setViewerImage(null)}
      />
    </View>
  );
}

const styles = createThemedStyles(() =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.dark.background,
    },
    segmentWrap: {
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 6,
    },
    scrollView: {
      flex: 1,
    },
    content: {
      paddingHorizontal: 16,
      paddingBottom: 40,
    },
    guideCard: {
      backgroundColor: colors.dark.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.dark.accent + '33',
      marginBottom: 14,
      overflow: 'hidden',
    },
    guideHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 13,
    },
    guideHeadLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    guideTitle: {
      fontSize: 13,
      fontWeight: '800' as const,
      color: colors.dark.text,
    },
    guideBody: {
      paddingHorizontal: 13,
      paddingBottom: 13,
    },
    guideText: {
      fontSize: 12,
      color: colors.dark.textSecondary,
      lineHeight: 21,
      textAlign: 'right',
      marginBottom: 8,
    },
    privacyBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      backgroundColor: colors.dark.blueDim,
      borderRadius: 10,
      padding: 10,
      marginBottom: 10,
    },
    privacyText: {
      flex: 1,
      fontSize: 11,
      color: colors.dark.blue,
      lineHeight: 18,
      textAlign: 'right',
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.dark.card,
      borderRadius: 10,
      padding: 10,
      marginBottom: 8,
    },
    switchRowLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flex: 1,
    },
    switchLabel: {
      fontSize: 12,
      color: colors.dark.text,
      flex: 1,
      textAlign: 'right',
    },
    section: {
      backgroundColor: colors.dark.card,
      borderRadius: 16,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.dark.cardBorder,
      marginBottom: 14,
    },
    sectionHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 10,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '800' as const,
      color: colors.dark.text,
    },
    addRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 10,
    },
    input: {
      flex: 1,
      backgroundColor: colors.dark.inputBg,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 13,
      color: colors.dark.text,
      borderWidth: 1,
      borderColor: colors.dark.border,
      textAlign: 'right',
    },
    addBtn: {
      width: 44,
      borderRadius: 12,
      backgroundColor: colors.dark.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sourcesWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    sourceChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.dark.surface,
      borderWidth: 1,
      borderColor: colors.dark.border,
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    sourceChipText: {
      fontSize: 12,
      fontWeight: '700' as const,
      color: colors.dark.text,
    },
    sourceChipBuiltin: {
      fontSize: 10,
      color: colors.dark.textMuted,
    },
    listHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 6,
      marginTop: 2,
    },
    listHeadLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    refreshBtn: {
      width: 34,
      height: 34,
      borderRadius: 10,
      backgroundColor: colors.dark.surface,
      borderWidth: 1,
      borderColor: colors.dark.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    lastFetchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 12,
    },
    lastFetchText: {
      fontSize: 11,
      color: colors.dark.textMuted,
    },
    loadingBox: {
      alignItems: 'center',
      gap: 12,
      paddingVertical: 40,
    },
    loadingText: {
      fontSize: 12,
      color: colors.dark.textMuted,
    },
    emptyBox: {
      backgroundColor: colors.dark.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.dark.cardBorder,
      alignItems: 'center',
      gap: 10,
      padding: 28,
      marginTop: 8,
    },
    emptyTitle: {
      fontSize: 14,
      fontWeight: '800' as const,
      color: colors.dark.text,
    },
    emptyText: {
      fontSize: 12,
      color: colors.dark.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
    },
    signalCard: {
      backgroundColor: colors.dark.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.dark.cardBorder,
      padding: 14,
      marginBottom: 14,
    },
    signalHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    tagRow: {
      flexDirection: 'row',
      gap: 6,
      flexWrap: 'wrap',
    },
    tagChip: {
      backgroundColor: colors.dark.accentDim,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    tagText: {
      fontSize: 12,
      fontWeight: '800' as const,
      color: colors.dark.accent,
    },
    timeText: {
      fontSize: 11,
      color: colors.dark.textMuted,
    },
    sourceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 8,
    },
    sourceText: {
      fontSize: 11,
      color: colors.dark.textMuted,
    },
    chartImage: {
      width: '100%',
      height: 220,
      borderRadius: 12,
      backgroundColor: colors.dark.surface,
      marginBottom: 10,
    },
    signalText: {
      fontSize: 13,
      color: colors.dark.text,
      lineHeight: 21,
      textAlign: 'right',
      marginBottom: 8,
    },
    linkBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      backgroundColor: colors.dark.blueDim,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    linkText: {
      fontSize: 11,
      fontWeight: '700' as const,
      color: colors.dark.blue,
    },
    testTgBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.dark.accent,
      borderRadius: 10,
      paddingVertical: 11,
      marginTop: 4,
    },
    testTgText: {
      fontSize: 12,
      fontWeight: '800' as const,
      color: '#fff',
    },
  })
);
