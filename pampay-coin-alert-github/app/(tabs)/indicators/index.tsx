import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { LineChart, Plus, RefreshCw, Trash2, Pencil, Code2, Zap, Activity } from 'lucide-react-native';
import colors from '@/constants/colors';
import { createThemedStyles } from '@/utils/themeStyles';
import { useApp } from '@/contexts/AppContext';
import GainzSignalCard from '@/components/GainzSignalCard';
import EmptyState from '@/components/EmptyState';
import { GainzAlgoSignal, mergeServerGainzSignals } from '@/utils/gainzAlgoService';
import type { GainzTimeframe } from '@/types/crypto';
import {
  UserIndicator,
  CustomIndicatorSignal,
  getUserIndicators,
  saveUserIndicator,
  deleteUserIndicator,
  runCustomScanCycle,
  getStoredCustomSignals,
  getIndicatorErrors,
  mergeServerCustomSignals,
} from '@/utils/customIndicatorsService';
import {
  HookReversalSignal,
  HookTimeframe,
  HOOK_TF_LABEL,
} from '@/utils/hookReversalService';
import {
  fetchServerSignals,
  syncScanConfig,
  ServerSignalsResponse,
} from '@/utils/scanServerApi';

/** Merges server-computed signals into the local list (dedupe by id). */
function mergeSignals<T extends { id: string }>(primary: T[], extra: T[]): T[] {
  if (extra.length === 0) return primary;
  const ids = new Set(primary.map((s) => s.id));
  return [...primary, ...extra.filter((s) => !ids.has(s.id))];
}

function formatFaDay(dateStr: string): string {
  try {
    return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('fa-IR');
  } catch {
    return dateStr;
  }
}

type Segment = 'gainz' | 'custom' | 'hook';
type DayFilter = 0 | 3 | 7 | 'all';

const TIMEFRAMES: { key: UserIndicator['timeframe']; label: string }[] = [
  { key: '15m', label: '۱۵ دقیقه' },
  { key: '30m', label: '۳۰ دقیقه' },
  { key: '1h', label: '۱ ساعت' },
  { key: '4h', label: '۴ ساعت' },
  { key: '1d', label: 'روزانه' },
];

interface EditorState {
  id: string | null;
  name: string;
  timeframe: UserIndicator['timeframe'];
  code: string;
  receiveSignals: boolean;
}

export default function IndicatorsScreen() {
  const { settings, updateSettings, gainzSignals, refreshGainzScan, hookSignals, refreshHookScan } = useApp();

  const [segment, setSegment] = useState<Segment>('gainz');
  const [isScanningGainz, setIsScanningGainz] = useState(false);
  const [indicators, setIndicators] = useState<UserIndicator[]>([]);
  const [customSignals, setCustomSignals] = useState<CustomIndicatorSignal[]>([]);
  const [indicatorErrors, setIndicatorErrors] = useState<Record<string, string>>({});
  const [editorVisible, setEditorVisible] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [isSavingIndicator, setIsSavingIndicator] = useState(false);
  const [dayFilter, setDayFilter] = useState<DayFilter>(0);
  const [serverSignals, setServerSignals] = useState<ServerSignalsResponse | null>(null);

  // Signals of the current/last N days, based on when the signal was DETECTED
  // (UTC days). A daily candle that closed last night has yesterday's
  // candleOpenTime but is detected today -> it must show under "امروز".
  const filterByDays = useCallback(
    <T extends { detectedAt: number }>(list: T[]): T[] => {
      if (dayFilter === 'all') return list;
      const startOfTodayUtc = new Date();
      startOfTodayUtc.setUTCHours(0, 0, 0, 0);
      const since = startOfTodayUtc.getTime() - (dayFilter - 1) * 86400000;
      return list.filter((s) => s.detectedAt >= since);
    },
    [dayFilter]
  );

  // Server signals (scanned even when the app was closed) merged with local ones
  const mergedGainzSignals = useMemo(
    () => mergeSignals(gainzSignals, serverSignals?.gainzSignals ?? []),
    [gainzSignals, serverSignals]
  );
  const mergedCustomSignals = useMemo(
    () => mergeSignals(customSignals, serverSignals?.customSignals ?? []),
    [customSignals, serverSignals]
  );
  const mergedHookSignals = useMemo(
    () => mergeSignals(hookSignals, serverSignals?.hookSignals ?? []),
    [hookSignals, serverSignals]
  );

  const visibleGainzSignals = filterByDays(mergedGainzSignals);
  const visibleCustomSignals = filterByDays(mergedCustomSignals);
  const visibleHookSignals = filterByDays(mergedHookSignals);

  const loadCustomData = useCallback(async () => {
    try {
      const [list, signals, errors, server] = await Promise.all([
        getUserIndicators(),
        getStoredCustomSignals(),
        getIndicatorErrors(),
        fetchServerSignals(),
      ]);
      setIndicators(list);
      setIndicatorErrors(errors);
      if (server) {
        setServerSignals(server);
        // Persist server signals locally too, so the Telegram bot commands
        // (/gainz, /indicators) also show what the server found while the
        // app was closed.
        if (server.gainzSignals.length > 0) {
          await mergeServerGainzSignals(server.gainzSignals);
        }
        if (server.customSignals.length > 0) {
          const mergedCustom = await mergeServerCustomSignals(server.customSignals);
          setCustomSignals(mergedCustom);
        } else {
          setCustomSignals(signals);
        }
      } else {
        setCustomSignals(signals);
      }
    } catch (e) {
      console.log('[Indicators] Error loading custom data:', e);
    }
  }, []);

  React.useEffect(() => {
    loadCustomData();
  }, [loadCustomData]);

  // Push the latest config (token/chat/indicators/timeframes) to the scan server
  // so the UTC-midnight scan runs even when the app is fully closed.
  const syncServer = useCallback(() => {
    if (!settings.telegramEnabled || !settings.telegramBotToken || !settings.telegramChatId) return;
    syncScanConfig({
      botToken: settings.telegramBotToken,
      chatId: settings.telegramChatId,
      gainzAlgoEnabled: settings.gainzAlgoNotifications,
      gainzTimeframes: settings.gainzTimeframes ?? ['1d'],
      hookEnabled: settings.hookReversalNotifications !== false,
      hookTimeframes: settings.hookTimeframes ?? ['1d'],
    });
  }, [
    settings.telegramEnabled,
    settings.telegramBotToken,
    settings.telegramChatId,
    settings.gainzAlgoNotifications,
    settings.gainzTimeframes,
    settings.hookReversalNotifications,
    settings.hookTimeframes,
  ]);

  /** Multi-select of GainzAlgo scan timeframes (synced to the scan server). */
  const toggleGainzTimeframe = useCallback(
    (tf: GainzTimeframe) => {
      const current = settings.gainzTimeframes ?? ['1d'];
      const next = current.includes(tf) ? current.filter((t) => t !== tf) : [...current, tf];
      updateSettings({ gainzTimeframes: next.length > 0 ? next : ['1d'] });
    },
    [settings.gainzTimeframes, updateSettings]
  );

  /** Multi-select of Hook Reversal scan timeframes (synced to the scan server). */
  const toggleHookTimeframe = useCallback(
    (tf: HookTimeframe) => {
      const current = settings.hookTimeframes ?? ['1d'];
      const next = current.includes(tf) ? current.filter((t) => t !== tf) : [...current, tf];
      updateSettings({ hookTimeframes: next.length > 0 ? next : ['1d'] });
    },
    [settings.hookTimeframes, updateSettings]
  );

  const handleScanHook = async () => {
    setIsScanningGainz(true);
    try {
      await refreshHookScan();
    } finally {
      setIsScanningGainz(false);
    }
  };

  const handleScanGainz = async () => {
    setIsScanningGainz(true);
    try {
      await refreshGainzScan();
    } finally {
      setIsScanningGainz(false);
    }
  };

  const handleRescanCustom = async () => {
    setIsScanningGainz(true);
    try {
      const result = await runCustomScanCycle();
      await loadCustomData();
      Alert.alert(
        'اسکن کامل شد',
        result.length > 0
          ? `${result.length} سیگنال پیدا شد و به تلگرام ارسال شد.` : 'هیچ سیگنال فعالی یافت نشد.'
      );
    } catch {
      Alert.alert('خطا', 'در حین اسکن مشکلی پیش آمد.');
    } finally {
      setIsScanningGainz(false);
    }
  };

  const openNewEditor = () => {
    setEditor({
      id: null,
      name: '',
      timeframe: '1h',
      code: '',
      receiveSignals: true,
    });
    setEditorVisible(true);
  };

  const openEditEditor = (indicator: UserIndicator) => {
    setEditor({ ...indicator });
    setEditorVisible(true);
  };

  const handleSaveIndicator = async () => {
    if (!editor || !editor.name.trim()) {
      Alert.alert('خطا', 'لطفاً یک نام برای اندیکاتور وارد کنید.');
      return;
    }
    if (!editor.code.trim()) {
      Alert.alert('خطا', 'کد اندیکاتور را وارد کنید.');
      return;
    }
    setIsSavingIndicator(true);
    try {
      await saveUserIndicator({
        id: editor.id ?? `ci-${Date.now()}`,
        name: editor.name.trim(),
        code: editor.code.trim(),
        timeframe: editor.timeframe,
        receiveSignals: editor.receiveSignals,
        createdAt: Date.now(),
      });
      setEditorVisible(false);
      setEditor(null);
      await loadCustomData();
      syncServer();
      Alert.alert('ذخیره شد', 'اندیکاتور شما ذخیره شد؛ سیگنال‌های آن در همین صفحه و تلگرام دریافت می‌شود.');
    } catch {
      Alert.alert('خطا', 'ذخیره اندیکاتور موفق نبود.');
    } finally {
      setIsSavingIndicator(false);
    }
  };

  const handleDelete = (indicator: UserIndicator) => {
    Alert.alert('حذف اندیکاتور', `«${indicator.name}» حذف شود؟`, [
      { text: 'انصراف', style: 'cancel' },
      {
        text: 'حذف',
        style: 'destructive',
        onPress: () => {
          deleteUserIndicator(indicator.id)
            .then(loadCustomData)
            .then(syncServer)
            .catch(() => {});
        },
      },
    ]);
  };

  const toggleReceive = async (indicator: UserIndicator, value: boolean) => {
    await saveUserIndicator({ ...indicator, receiveSignals: value });
    await loadCustomData();
    syncServer();
  };

  return (
    <View style={styles.container}>
      {/* Segmented Control */}
      <View style={styles.segmentRow}>
        <Pressable
          style={[styles.segmentBtn, segment === 'gainz' && styles.segmentBtnActive]}
          onPress={() => setSegment('gainz')}
          testID="segment-gainz"
        >
          <Zap size={15} color={segment === 'gainz' ? colors.dark.background : colors.dark.textSecondary} />
          <Text style={[styles.segmentText, segment === 'gainz' && styles.segmentTextActive]}>
            اندیکاتور آماده
          </Text>
        </Pressable>
        <Pressable
          style={[styles.segmentBtn, segment === 'custom' && styles.segmentBtnActive]}
          onPress={() => setSegment('custom')}
          testID="segment-custom"
        >
          <Code2 size={15} color={segment === 'custom' ? colors.dark.background : colors.dark.textSecondary} />
          <Text style={[styles.segmentText, segment === 'custom' && styles.segmentTextActive]}>
            اندیکاتور من ({indicators.length})
          </Text>
        </Pressable>
        <Pressable
          style={[styles.segmentBtn, segment === 'hook' && styles.segmentBtnActive]}
          onPress={() => setSegment('hook')}
          testID="segment-hook"
        >
          <Activity size={15} color={segment === 'hook' ? colors.dark.background : colors.dark.textSecondary} />
          <Text style={[styles.segmentText, segment === 'hook' && styles.segmentTextActive]}>
            هوک ریورسال
          </Text>
        </Pressable>
      </View>

      <View style={styles.dayFilterRow}>
        {([
          { key: 0 as DayFilter, label: 'امروز' },
          { key: 3 as DayFilter, label: '۳ روز اخیر' },
          { key: 7 as DayFilter, label: '۷ روز اخیر' },
          { key: 'all' as DayFilter, label: 'همه' },
        ]).map((opt) => (
          <Pressable
            key={String(opt.key)}
            style={[styles.dayChip, dayFilter === opt.key && styles.dayChipActive]}
            onPress={() => setDayFilter(opt.key)}
            testID={`day-filter-${String(opt.key)}`}
          >
            <Text
              style={[
                styles.dayChipText,
                dayFilter === opt.key && styles.dayChipTextActive,
              ]}
            >
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {!!(serverSignals?.lastScanAt || serverSignals?.lastScanDate) && (
        <Text style={styles.serverScanText}>
          {'🖥 آخرین اسکن سرور: '}
          {serverSignals?.lastScanAt
            ? new Date(serverSignals.lastScanAt).toLocaleString('fa-IR')
            : formatFaDay(serverSignals?.lastScanDate ?? '')}
        </Text>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {segment === 'gainz' && (
          <>
            <View style={styles.sectionCard}>
              <View style={styles.headerRow}>
                <LineChart size={18} color={colors.dark.blue} />
                <Text style={styles.title}>اندیکاتور GainzAlgo Pro</Text>
              </View>
              <Text style={styles.desc}>
                سیگنال‌های خرید/فروش از Binance با منطق پوشش گیاهی، RSI و پایداری کندل.
                سرور تایم‌فریم‌های انتخابی را طبق بازه هر کندل اسکن می‌کند
                (۱۵ دقیقه‌ای، ۳۰ دقیقه‌ای، ۱ ساعته، ۴ ساعته و روزانه)؛ سیگنال‌های کندل
                در حال ساخت هم اعلام می‌شوند و بازار هر ارز (فیوچرز/اسپات) ذکر می‌شود.
              </Text>
              <View style={styles.switchRow}>
                <Switch
                  value={settings.gainzAlgoNotifications !== false}
                  onValueChange={(v) => updateSettings({ gainzAlgoNotifications: v })}
                  trackColor={{ false: colors.dark.surfaceLight, true: colors.dark.blue + '66' }}
                  thumbColor={
                    settings.gainzAlgoNotifications !== false
                      ? colors.dark.blue
                      : colors.dark.textMuted
                  }
                />
                <Text style={styles.switchLabel}>دریافت سیگنال‌ها از این اندیکاتور</Text>
              </View>
              <Text style={styles.tfSelectLabel}>تایم‌فریم اسکن سرور:</Text>
              <View style={styles.tfSelectChips}>
                {([
                  { key: '1d' as const, label: 'روزانه' },
                  { key: '4h' as const, label: '۴ ساعته' },
                  { key: '1h' as const, label: '۱ ساعته' },
                  { key: '30m' as const, label: '۳۰ دقیقه' },
                  { key: '15m' as const, label: '۱۵ دقیقه' },
                ]).map((opt) => {
                  const active = (settings.gainzTimeframes ?? ['1d']).includes(opt.key);
                  return (
                    <Pressable
                      key={opt.key}
                      style={[styles.tfSelectChip, active && styles.tfSelectChipActive]}
                      onPress={() => toggleGainzTimeframe(opt.key)}
                      testID={`gainz-tf-${opt.key}`}
                    >
                      <Text
                        style={[
                          styles.tfSelectChipText,
                          active && styles.tfSelectChipTextActive,
                        ]}
                      >
                        {active ? '✓ ' : ''}
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.countRow}>
              <Text style={styles.countText}>{visibleGainzSignals.length} سیگنال ثبت شده</Text>
              <Pressable
                style={({ pressed }) => [styles.rescanButton, pressed && { opacity: 0.85 }]}
                onPress={handleScanGainz}
                disabled={isScanningGainz}
              >
                {isScanningGainz ? (
                  <ActivityIndicator size="small" color={colors.dark.accent} />
                ) : (
                  <RefreshCw size={14} color={colors.dark.accent} />
                )}
                <Text style={styles.rescanText}>اسکن فوری</Text>
              </Pressable>
            </View>

            {visibleGainzSignals.map((sig) => (
              <GainzSignalCard key={sig.id} signal={sig} />
            ))}
            {visibleGainzSignals.length === 0 && (
              <EmptyState
                title={dayFilter === 0 ? 'امروز سیگنالی نبوده' : 'در این بازه سیگنالی نیست'}
                subtitle={
                  dayFilter === 0
                    ? 'اسکن سرور طبق بازه هر تایم‌فریم انتخابی (۱۵ دقیقه تا روزانه) انجام می‌شود'
                    : 'بازه زمانی دیگری را انتخاب کنید یا اسکن فوری بزنید'
                }
              />
            )}
          </>
        )}

        {segment === 'hook' && (
          <>
            <View style={styles.sectionCard}>
              <View style={styles.headerRow}>
                <Activity size={18} color={colors.dark.accent} />
                <Text style={styles.title}>هوک ریورسال</Text>
              </View>
              <Text style={styles.desc}>
                الگوی برگشتی هوک روی کندل‌های بایننس:
                🟢 هوک صعودی = کف پایین‌تر از کندل قبل + بسته‌شدن بالاتر
                🔴 هوک نزولی = سقف بالاتر از کندل قبل + بسته‌شدن پایین‌تر.
                سرور به‌صورت خودکار حتی وقتی برنامه بسته است اسکن می‌کند و
                سیگنال‌ها در همین بخش، اعلان گوشی و ربات تلگرام (/hook) می‌آید.
              </Text>
              <View style={styles.switchRow}>
                <Switch
                  value={settings.hookReversalNotifications !== false}
                  onValueChange={(v) => updateSettings({ hookReversalNotifications: v })}
                  trackColor={{ false: colors.dark.surfaceLight, true: colors.dark.accent + '66' }}
                  thumbColor={
                    settings.hookReversalNotifications !== false
                      ? colors.dark.accent
                      : colors.dark.textMuted
                  }
                />
                <Text style={styles.switchLabel}>دریافت سیگنال‌های هوک ریورسال</Text>
              </View>
              <Text style={styles.tfSelectLabel}>تایم‌فریم اسکن سرور:</Text>
              <View style={styles.tfSelectChips}>
                {([
                  { key: '1d' as HookTimeframe, label: HOOK_TF_LABEL['1d'] },
                  { key: '4h' as HookTimeframe, label: HOOK_TF_LABEL['4h'] },
                ]).map((opt) => {
                  const active = (settings.hookTimeframes ?? ['1d']).includes(opt.key);
                  return (
                    <Pressable
                      key={opt.key}
                      style={[styles.tfSelectChip, active && styles.tfSelectChipActive]}
                      onPress={() => toggleHookTimeframe(opt.key)}
                      testID={`hook-tf-${opt.key}`}
                    >
                      <Text
                        style={[
                          styles.tfSelectChipText,
                          active && styles.tfSelectChipTextActive,
                        ]}
                      >
                        {active ? '✓ ' : ''}
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.countRow}>
              <Text style={styles.countText}>{visibleHookSignals.length} سیگنال ثبت شده</Text>
              <Pressable
                style={({ pressed }) => [styles.rescanButton, pressed && { opacity: 0.85 }]}
                onPress={handleScanHook}
                disabled={isScanningGainz}
              >
                {isScanningGainz ? (
                  <ActivityIndicator size="small" color={colors.dark.accent} />
                ) : (
                  <RefreshCw size={14} color={colors.dark.accent} />
                )}
                <Text style={styles.rescanText}>اسکن فوری</Text>
              </Pressable>
            </View>

            {visibleHookSignals.map((sig) => (
              <HookSignalCard key={sig.id} signal={sig} />
            ))}
            {visibleHookSignals.length === 0 && (
              <EmptyState
                title={dayFilter === 0 ? 'امروز هوکی ثبت نشده' : 'در این بازه هوکی نیست'}
                subtitle={
                  dayFilter === 0
                    ? 'سرور هر ۴ ساعت و روزانه بعد از بسته شدن کندل‌ها اسکن می‌کند'
                    : 'بازه زمانی دیگری را انتخاب کنید یا اسکن فوری بزنید'
                }
              />
            )}
          </>
        )}

        {segment === 'custom' && (
          <>
            <View style={styles.sectionCard}>
              <View style={styles.headerRow}>
                <Code2 size={18} color={colors.dark.green} />
                <Text style={styles.title}>اندیکاتور اختصاصی خودتان</Text>
              </View>
              <Text style={styles.desc}>
                کد اندیکاتور خود را (Pine Script سبک TradingView) اضافه کنید؛
                سیگنال‌های خرید/فروش همزمان در همین بخش و ربات تلگرام دریافت می‌شوند.
                توابع پشتیبانی‌شده: ta.rsi، ta.sma، ta.ema، ta.crossover، ta.crossunder، math.abs و…
              </Text>
            </View>

            <View style={styles.buttonRow}>
              <Pressable style={styles.addButton} onPress={openNewEditor} testID="add-indicator">
                <Plus size={16} color={colors.dark.background} />
                <Text style={styles.addButtonText}>افزودن اندیکاتور</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.rescanButton2, pressed && { opacity: 0.85 }]}
                onPress={handleRescanCustom}
                disabled={isScanningGainz}
              >
                {isScanningGainz ? (
                  <ActivityIndicator size="small" color={colors.dark.textSecondary} />
                ) : (
                  <RefreshCw size={14} color={colors.dark.textSecondary} />
                )}
                <Text style={styles.rescanText2}>اسکن حالا</Text>
              </Pressable>
            </View>

            {indicators.map((ind) => (
              <View key={ind.id} style={styles.indicatorItem} testID={`indicator-${ind.name}`}>
                <View style={styles.indicatorMain}>
                  <View style={styles.indicatorTitleRow}>
                    <Text style={styles.indicatorName}>{ind.name}</Text>
                    <View style={styles.tfBadge}>
                      <Text style={styles.tfBadgeText}>{ind.timeframe}</Text>
                    </View>
                  </View>
                  <Text style={styles.indicatorCodePreview} numberOfLines={1}>
                    {ind.code}
                  </Text>
                  {!!indicatorErrors[ind.id] && (
                    <Text style={styles.errorText} numberOfLines={1}>
                      ⚠️ {indicatorErrors[ind.id]}
                    </Text>
                  )}
                  <View style={styles.indicatorActions}>
                    <Switch
                      value={ind.receiveSignals}
                      onValueChange={(v) => toggleReceive(ind, v)}
                      trackColor={{ false: colors.dark.surfaceLight, true: colors.dark.green + '66' }}
                      thumbColor={ind.receiveSignals ? colors.dark.green : colors.dark.textMuted}
                    />
                    <Text style={styles.switchLabelSmall}>دریافت سیگنال</Text>
                    <View style={styles.spacer} />
                    <Pressable
                      style={styles.iconBtn}
                      onPress={() => openEditEditor(ind)}
                      hitSlop={8}
                    >
                      <Pencil size={16} color={colors.dark.textSecondary} />
                    </Pressable>
                    <Pressable
                      style={styles.iconBtn}
                      onPress={() => handleDelete(ind)}
                      hitSlop={8}
                    >
                      <Trash2 size={16} color={colors.dark.red} />
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}

            {indicators.length > 0 && visibleCustomSignals.length > 0 && (
              <>
                <Text style={styles.signalsHeading}>
                  سیگنال‌های اندیکاتورهای شما ({visibleCustomSignals.length}):
                </Text>
                {visibleCustomSignals.map((sig) => (
                  <CustomSignalCard key={sig.id} signal={sig} />
                ))}
              </>
            )}

            {indicators.length === 0 && (
              <EmptyState
                title="اندیکاتوری اضافه نشده"
                subtitle="اولین اندیکاتور اختصاصی خود را بسازید تا سیگنال‌هایش را بگیرید"
              />
            )}
          </>
        )}
      </ScrollView>

      {/* Add/Edit Modal */}
      <Modal
        visible={editorVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setEditorVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>
                {editor?.id ? 'ویرایش اندیکاتور' : 'اندیکاتور جدید'}
              </Text>

              <Text style={styles.inputLabel}>نام اندیکاتور</Text>
              <TextInput
                style={styles.input}
                value={editor?.name ?? ''}
                onChangeText={(t) => editor && setEditor({ ...editor, name: t })}
                placeholder="مثلاً استراتژی روند من"
                placeholderTextColor={colors.dark.textMuted}
              />

              <Text style={styles.inputLabel}>تایم‌فریم</Text>
              <View style={styles.tfRow}>
                {TIMEFRAMES.map((tf) => (
                  <Pressable
                    key={tf.key}
                    style={[
                      styles.tfChip,
                      editor?.timeframe === tf.key && styles.tfChipActive,
                    ]}
                    onPress={() => {
                      if (editor) setEditor({ ...editor, timeframe: tf.key });
                    }}
                  >
                    <Text
                      style={[
                        styles.tfChipText,
                        editor?.timeframe === tf.key && styles.tfChipTextActive,
                      ]}
                    >
                      {tf.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.inputLabel}>کد اندیکاتور</Text>
              <TextInput
                style={[styles.input, styles.codeInput]}
                value={editor?.code ?? ''}
                onChangeText={(t) => editor && setEditor({ ...editor, code: t })}
                placeholder={'bull = close[1] < open[1] and close > open and ta.rsi(close, 14) < 30\nbear = ...'}
                placeholderTextColor={colors.dark.textMuted}
                multiline
                textAlignVertical="top"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <View style={styles.switchRow}>
                <Switch
                  value={editor?.receiveSignals ?? true}
                  onValueChange={(v) => {
                    if (editor) setEditor({ ...editor, receiveSignals: v });
                  }}
                  trackColor={{ false: colors.dark.surfaceLight, true: colors.dark.green + '66' }}
                  thumbColor={editor?.receiveSignals ? colors.dark.green : colors.dark.textMuted}
                />
                <Text style={styles.switchLabel}>دریافت سیگنال از این اندیکاتور</Text>
              </View>

              <View style={styles.modalButtons}>
                <Pressable
                  style={[styles.modalBtn, styles.cancelBtn]}
                  onPress={() => setEditorVisible(false)}
                >
                  <Text style={styles.cancelBtnText}>لغو</Text>
                </Pressable>
                <Pressable
                  style={[styles.modalBtn, styles.saveBtn]}
                  onPress={handleSaveIndicator}
                  disabled={isSavingIndicator}
                >
                  {isSavingIndicator ? (
                    <ActivityIndicator size="small" color={colors.dark.background} />
                  ) : (
                    <Text style={styles.saveBtnText}>ذخیره</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** Compact card for Hook Reversal signals (bullish/bearish hook). */
function HookSignalCard({ signal }: { signal: HookReversalSignal }) {
  const isBuy = signal.action === 'buy';
  const actionColor = isBuy ? colors.dark.green : colors.dark.red;
  const marketLabel = (signal.markets ?? ['futures'])
    .map((m) => (m === 'futures' ? 'فیوچرز' : m === 'spot' ? 'اسپات' : m))
    .join(' + ');

  return (
    <View style={[styles.signalCard, { borderLeftColor: actionColor }]}>
      <View style={styles.headerRow}>
        <View style={[styles.labelBubble, { backgroundColor: actionColor }]}>
          <Text style={styles.labelBubbleText}>{isBuy ? '🟢 صعودی' : '🔴 نزولی'}</Text>
        </View>
        <Text style={styles.symbol}>{signal.displayName}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{HOOK_TF_LABEL[signal.timeframe] ?? signal.timeframe}{signal.live ? ' • زنده' : ''}</Text>
        </View>
      </View>
      <View style={styles.cardStatsRow}>
        <Text style={styles.cardStat}>💰 ${signal.price.toFixed(4)}</Text>
        <Text style={styles.cardStat}>🏦 {marketLabel}</Text>
        <Text style={styles.cardStat}>
          🕐 {new Date(signal.candleOpenTime).toLocaleDateString('fa-IR')}
        </Text>
      </View>
    </View>
  );
}

/** Compact card for signals produced by user-defined indicators. */
function CustomSignalCard({ signal }: { signal: CustomIndicatorSignal }) {
  const isBuy = signal.action === 'buy';
  const actionColor = isBuy ? colors.dark.green : colors.dark.red;
  const marketLabel = (signal.markets ?? [])
    .map((m) => (m === 'futures' ? 'فیوچرز' : m === 'spot' ? 'اسپات' : m))
    .join(' + ');

  return (
    <View style={[styles.signalCard, { borderLeftColor: actionColor }]}>
      <View style={styles.headerRow}>
        <View style={[styles.labelBubble, { backgroundColor: actionColor }]}>
          <Text style={styles.labelBubbleText}>{isBuy ? 'BUY' : 'SELL'}</Text>
        </View>
        <Text style={styles.symbol}>{signal.displayName}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{signal.indicatorName}</Text>
        </View>
      </View>
      <View style={styles.cardStatsRow}>
        <Text style={styles.cardStat}>💰 ${signal.price.toFixed(4)}</Text>
        {marketLabel.length > 0 && <Text style={styles.cardStat}>🏦 {marketLabel}</Text>}
        <Text style={styles.cardStat}>
          🕐 {new Date(signal.candleOpenTime).toLocaleDateString('fa-IR')}
        </Text>
      </View>
    </View>
  );
}

const styles = createThemedStyles(() => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.background,
    paddingTop: 20,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  segmentRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: colors.dark.surface,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  segmentBtnActive: {
    backgroundColor: colors.dark.accent,
    borderColor: colors.dark.accent,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.dark.textSecondary,
  },
  segmentTextActive: {
    color: colors.dark.background,
  },
  dayFilterRow: {
    flexDirection: 'row-reverse',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 10,
  },
  dayChip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: colors.dark.surface,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  dayChipActive: {
    backgroundColor: colors.dark.blue,
    borderColor: colors.dark.blue,
  },
  dayChipText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: colors.dark.textSecondary,
  },
  dayChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700' as const,
  },
  serverScanText: {
    fontSize: 11,
    color: colors.dark.textMuted,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  tfSelectLabel: {
    fontSize: 12,
    color: colors.dark.textMuted,
    marginTop: 12,
    marginBottom: 8,
    textAlign: 'right',
  },
  tfSelectChips: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
  },
  tfSelectChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: colors.dark.background,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  tfSelectChipActive: {
    backgroundColor: colors.dark.blue,
    borderColor: colors.dark.blue,
  },
  tfSelectChipText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: colors.dark.textSecondary,
  },
  tfSelectChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700' as const,
  },
  sectionCard: {
    backgroundColor: colors.dark.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.dark.border,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: colors.dark.text,
    flex: 1,
    textAlign: 'right',
  },
  desc: {
    fontSize: 12,
    lineHeight: 20,
    color: colors.dark.textSecondary,
    textAlign: 'right',
    marginBottom: 8,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  switchLabel: {
    fontSize: 12,
    color: colors.dark.textSecondary,
    textAlign: 'right',
    flexShrink: 1,
  },
  countRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginBottom: 10,
  },
  countText: {
    fontSize: 12,
    color: colors.dark.textSecondary,
  },
  rescanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.dark.surface,
    borderWidth: 1,
    borderColor: colors.dark.border,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
  },
  rescanText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: colors.dark.accent,
  },
  buttonRow: {
    flexDirection: 'row-reverse',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: colors.dark.accent,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  addButtonText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: colors.dark.background,
  },
  rescanButton2: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.dark.surface,
    borderWidth: 1,
    borderColor: colors.dark.border,
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  rescanText2: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: colors.dark.textSecondary,
  },
  indicatorItem: {
    backgroundColor: colors.dark.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.dark.border,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 10,
  },
  indicatorMain: {
    gap: 6,
  },
  indicatorTitleRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  indicatorName: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: colors.dark.text,
    flex: 1,
    textAlign: 'right',
  },
  tfBadge: {
    backgroundColor: colors.dark.surfaceLight,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tfBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: colors.dark.textSecondary,
  },
  indicatorCodePreview: {
    fontSize: 11,
    fontFamily: undefined,
    color: colors.dark.textMuted,
    textAlign: 'left',
  },
  errorText: {
    fontSize: 11,
    color: colors.dark.red,
    textAlign: 'right',
  },
  indicatorActions: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  switchLabelSmall: {
    fontSize: 11,
    color: colors.dark.textSecondary,
  },
  spacer: {
    flex: 1,
  },
  iconBtn: {
    padding: 6,
  },
  signalsHeading: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: colors.dark.text,
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 10,
    textAlign: 'right',
  },
  signalCard: {
    backgroundColor: colors.dark.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.dark.border,
    borderLeftWidth: 3,
    padding: 14,
    marginBottom: 10,
    marginHorizontal: 16,
  },
  labelBubble: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  labelBubbleText: {
    fontSize: 11,
    fontWeight: '800' as const,
    color: '#FFFFFF',
  },
  symbol: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: colors.dark.text,
    flex: 1,
    textAlign: 'right',
  },
  badge: {
    backgroundColor: colors.dark.accentDim,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: colors.dark.accent,
  },
  cardStatsRow: {
    flexDirection: 'row-reverse',
    gap: 14,
    marginTop: 10,
  },
  cardStat: {
    fontSize: 11,
    color: colors.dark.textSecondary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: '#000000AA',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.dark.card ?? colors.dark.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '92%',
    padding: 20,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: colors.dark.text,
    textAlign: 'right',
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: colors.dark.textSecondary,
    marginBottom: 6,
    marginTop: 10,
    textAlign: 'right',
  },
  input: {
    backgroundColor: colors.dark.inputBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.dark.border,
    color: colors.dark.text,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    textAlign: 'right',
  },
  codeInput: {
    minHeight: 150,
    textAlign: 'left',
    fontFamily: undefined,
  },
  tfRow: {
    flexDirection: 'row-reverse',
    gap: 8,
    flexWrap: 'wrap',
  },
  tfChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 9,
    backgroundColor: colors.dark.inputBg,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  tfChipActive: {
    backgroundColor: colors.dark.accent,
    borderColor: colors.dark.accent,
  },
  tfChipText: {
    fontSize: 12,
    color: colors.dark.textSecondary,
  },
  tfChipTextActive: {
    color: colors.dark.background,
    fontWeight: '700' as const,
  },
  modalButtons: {
    flexDirection: 'row-reverse',
    gap: 10,
    marginTop: 20,
  },
  modalBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 12,
  },
  cancelBtn: {
    backgroundColor: colors.dark.surfaceLight,
  },
  cancelBtnText: {
    color: colors.dark.text,
    fontWeight: '600' as const,
    fontSize: 14,
  },
  saveBtn: {
    backgroundColor: colors.dark.accent,
  },
  saveBtnText: {
    color: colors.dark.background,
    fontWeight: '700' as const,
    fontSize: 14,
  },
}));
