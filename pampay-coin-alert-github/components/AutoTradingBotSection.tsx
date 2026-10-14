/**
 * AutoTradingBotSection.tsx — v1.4.19
 *
 * «معامله‌گر خودکار» UI — کافی‌پوزیشن‌های نهنگ + سیگنال اندیکاتورها را
 * اتوماتیک (دمو یا واقعی) معامله می‌کند با تنظیمات کاربر: لوریج، حجم،
 * حداکثر ضرر (→ استاپ‌لاس اتوماتیک) و ریوارد R:R (→ تیک‌پرافیت اتوماتیک).
 * موتور: utils/autoTradingEngine.ts (runAutoCycle هر ۶۰ ثانیه).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, Switch, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { Bot, Waves, Gauge, Play, Square, X, RefreshCw, TrendingUp, TrendingDown, Wallet2, Zap } from 'lucide-react-native';
import colors from '@/constants/colors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AutoTradeSettings,
  DEFAULT_AUTO_SETTINGS,
  DemoAutoPosition,
  loadAutoSettings,
  saveAutoSettings,
  loadDemoPositions,
  listTrackedWhales,
  listUserIndicators,
  runAutoCycle,
  getAutoLogs,
  manualClosePosition,
  RealKeys,
} from '@/utils/autoTradingEngine';

const CYCLE_MS = 60_000;

export default function AutoTradingBotSection({ realKeys }: { realKeys?: RealKeys }) {
  const [settings, setSettings] = useState<AutoTradeSettings>(DEFAULT_AUTO_SETTINGS);
  const [whales, setWhales] = useState<{ address: string; label: string }[]>([]);
  const [indicators, setIndicators] = useState<{ id: string; name: string }[]>([]);
  const [positions, setPositions] = useState<DemoAutoPosition[]>([]);
  const [logs, setLogs] = useState<{ id: string; at: number; kind: string; message: string }[]>([]);
  const [cycleBusy, setCycleBusy] = useState(false);
  const [lastCycleAt, setLastCycleAt] = useState<number | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // load everything on mount
  useEffect(() => {
    (async () => {
      const [s, w, i, p, l] = await Promise.all([
        loadAutoSettings(),
        listTrackedWhales(),
        listUserIndicators(),
        loadDemoPositions(),
        getAutoLogs(),
      ]);
      setSettings(s);
      setWhales(w);
      setIndicators(i);
      setPositions(p);
      setLogs(l);
      setLoaded(true);
    })().catch(() => setLoaded(true));
  }, []);

  const persist = useCallback(async (next: AutoTradeSettings) => {
    setSettings(next);
    await saveAutoSettings(next);
  }, []);

  const refreshPositions = useCallback(async () => {
    setPositions(await loadDemoPositions());
    setLogs((await getAutoLogs()).slice(0, 30));
  }, []);

  // the bot loop — only while enabled + screen mounted
  useEffect(() => {
    if (!settings.enabled) return;
    let alive = true;
    const tick = async () => {
      if (!alive || cycleBusy) return;
      setCycleBusy(true);
      try {
        await runAutoCycle({ settings: settingsRef.current, realKeys });
        setLastCycleAt(Date.now());
        await refreshPositions();
      } catch {}
      setCycleBusy(false);
    };
    void tick();
    const t = setInterval(tick, CYCLE_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [settings.enabled, realKeys, refreshPositions]);

  const openPositions = useMemo(() => positions.filter((p) => p.status === 'open'), [positions]);
  const closedPositions = useMemo(() => positions.filter((p) => p.status === 'closed').slice(0, 10), [positions]);

  const totalPnl = openPositions.reduce((s, p) => {
    const dir = p.side === 'long' ? 1 : -1;
    return s + (p.lastPrice - p.entryPrice) * dir * p.qty;
  }, 0);

  const whaleOptions = whales;

  const toggleIndicator = (id: string) => {
    const cur = settings.indicators.indicatorIds;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    void persist({ ...settings, indicators: { ...settings.indicators, indicatorIds: next } });
  };

  if (!loaded) {
    return (
      <View style={styles.card}>
        <ActivityIndicator size="small" color={colors.dark.accent} />
      </View>
    );
  }

  const startBot = () => {
    if (!settings.whale.enabled && !settings.indicators.enabled) {
      Alert.alert('منبع انتخاب نشده', 'حداقل یکی از دو منبع (نهنگ یا اندیکاتور) را فعال و انتخاب کنید.');
      return;
    }
    if (settings.whale.enabled && !settings.whale.address) {
      Alert.alert('نهنگ انتخاب نشده', 'از لیست، نهنگ موردنظر برای کپی معاملات را انتخاب کنید.');
      return;
    }
    if (settings.indicators.enabled && settings.indicators.indicatorIds.length === 0) {
      Alert.alert('اندیکاتور انتخاب نشده', 'حداقل یک اندیکاتور از لیست انتخاب کنید.');
      return;
    }
    if (settings.mode === 'real' && !realKeys) {
      Alert.alert('کلید API نیست', 'برای معامله واقعی، ابتدا کلید API فیوچرز بایننس را در همین صفحه اضافه کنید.');
      return;
    }
    Alert.alert(
      settings.mode === 'demo' ? 'شروع دمو' : 'شروع واقعی',
      settings.mode === 'demo'
        ? 'ربات در حالت دمو شروع می‌شود — پوزیشن‌های شبیه‌سازی‌شده با تنظیمات شما باز/بسته می‌شوند.'
        : 'ربات با پول واقعی شروع می‌شود! هر سیگنال = سفارش مارکت + استاپ + تیک‌پرافیت روی فیوچرز بایننس. مطمئنید؟',
      [
        { text: 'لغو', style: 'cancel' },
        { text: 'شروع', style: settings.mode === 'real' ? 'destructive' : 'default', onPress: () => void persist({ ...settings, enabled: true }) },
      ]
    );
  };

  return (
    <View style={styles.card}>
      <Pressable style={styles.header} onPress={() => setShowDetail((v) => !v)}>
        <View style={styles.headerRight}>
          <View style={[styles.headerIcon, settings.enabled && styles.headerIconActive]}>
            <Bot size={16} color={settings.enabled ? colors.dark.background : colors.dark.accent} />
          </View>
          <View>
            <Text style={styles.title}>معامله‌گر خودکار</Text>
            <Text style={styles.subtitle}>
              {settings.enabled
                ? `${settings.mode === 'demo' ? 'دمو' : 'واقعی'} فعال • ${settings.mode === 'demo' ? `${openPositions.length} پوزیشن دمو` : 'سفارش‌های زنده'}`
                : 'کپی نهنگ‌ها + سیگنال اندیکاتورها — دمو یا واقعی'}
            </Text>
          </View>
        </View>
        <View style={styles.headerLeft}>
          {cycleBusy && <ActivityIndicator size="small" color={colors.dark.accent} />}
          {settings.enabled ? (
            <Square size={16} color={colors.dark.red} />
          ) : (
            <Play size={16} color={colors.dark.green} />
          )}
        </View>
      </Pressable>

      {(settings.enabled || showDetail) && (
        <View style={styles.body}>
          {/* mode + enable */}
          <View style={styles.row}>
            <View style={styles.modeToggle}>
              {(['demo', 'real'] as const).map((m) => (
                <Pressable
                  key={m}
                  style={[styles.modeBtn, settings.mode === m && styles.modeBtnActive, m === 'real' && settings.mode === m && styles.modeBtnReal]}
                  onPress={() => void persist({ ...settings, mode: m, enabled: settings.enabled && m === 'demo' ? settings.enabled : false })}
                >
                  <Text style={[styles.modeBtnText, settings.mode === m && styles.modeBtnTextActive]}>
                    {m === 'demo' ? 'دمو' : 'واقعی'}
                  </Text>
                </Pressable>
              ))}
            </View>
            {settings.enabled ? (
              <Pressable style={styles.stopBtn} onPress={() => void persist({ ...settings, enabled: false })}>
                <Square size={12} color={colors.dark.red} />
                <Text style={styles.stopBtnText}>توقف</Text>
              </Pressable>
            ) : (
              <Pressable style={styles.startBtn} onPress={startBot}>
                <Play size={12} color={colors.dark.background} />
                <Text style={styles.startBtnText}>شروع ربات</Text>
              </Pressable>
            )}
          </View>
          {settings.mode === 'real' && !realKeys && (
            <Text style={styles.warn}>کلید API فیوچرز بایننس اضافه نشده — برای حالت واقعی لازم است.</Text>
          )}
          {settings.mode === 'real' && realKeys && (
            <Text style={styles.warnReal}>⚠ حالت واقعی: هر سیگنال با پول واقعی معامله می‌شود.</Text>
          )}

          {/* whale source */}
          <View style={styles.sourceBox}>
            <View style={styles.sourceHead}>
              <Waves size={13} color={colors.dark.blue} />
              <Text style={styles.sourceTitle}>کپی معاملات نهنگ</Text>
              <Switch
                value={settings.whale.enabled}
                onValueChange={(v) => void persist({ ...settings, whale: { ...settings.whale, enabled: v } })}
                trackColor={{ true: colors.dark.green + '88', false: colors.dark.card }}
                thumbColor={settings.whale.enabled ? colors.dark.green : colors.dark.textMuted}
                style={{ transform: [{ scale: 0.7 }] }}
              />
            </View>
            {settings.whale.enabled && (
              <>
                {whaleOptions.length === 0 ? (
                  <Text style={styles.sourceHint}>هنوز نهنگی ردیابی نکرده‌اید — از تب «ردیابی نهنگ‌ها» اضافه کنید.</Text>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
                    {whaleOptions.map((w) => (
                      <Pressable
                        key={w.address}
                        style={[styles.chip, settings.whale.address === w.address && styles.chipActive]}
                        onPress={() => void persist({ ...settings, whale: { ...settings.whale, address: w.address, label: w.label } })}
                      >
                        <Text style={[styles.chipText, settings.whale.address === w.address && styles.chipTextActive]} numberOfLines={1}>
                          🐋 {w.label}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
                <Pressable style={styles.miniRow} onPress={() => void persist({ ...settings, whale: { ...settings.whale, mirrorSide: !settings.whale.mirrorSide } })}>
                  <Zap size={11} color={colors.dark.accent} />
                  <Text style={styles.miniText}>
                    جهت معامله: {settings.whale.mirrorSide ? 'همان جهت نهنگ (کپی مستقیم)' : 'برعکس نهنگ (ضدجهت)'} — برای تغییر بزنید
                  </Text>
                </Pressable>
              </>
            )}
          </View>

          {/* indicator source */}
          <View style={styles.sourceBox}>
            <View style={styles.sourceHead}>
              <Gauge size={13} color={colors.dark.blue} />
              <Text style={styles.sourceTitle}>سیگنال اندیکاتورها (آماده/دستی)</Text>
              <Switch
                value={settings.indicators.enabled}
                onValueChange={(v) => void persist({ ...settings, indicators: { ...settings.indicators, enabled: v } })}
                trackColor={{ true: colors.dark.green + '88', false: colors.dark.card }}
                thumbColor={settings.indicators.enabled ? colors.dark.green : colors.dark.textMuted}
                style={{ transform: [{ scale: 0.7 }] }}
              />
            </View>
            {settings.indicators.enabled && (
              <>
                {indicators.length === 0 ? (
                  <Text style={styles.sourceHint}>اندیکاتور دستی ندارید — از تب «اندیکاتورها» بسازید (اندیکاتورهای آماده هم پشتیبانی می‌شوند).</Text>
                ) : (
                  <View style={styles.chipWrap}>
                    {indicators.map((ind) => {
                      const on = settings.indicators.indicatorIds.includes(ind.id);
                      return (
                        <Pressable
                          key={ind.id}
                          style={[styles.chip, on && styles.chipActive]}
                          onPress={() => toggleIndicator(ind.id)}
                        >
                          <Text style={[styles.chipText, on && styles.chipTextActive]} numberOfLines={1}>
                            {on ? '✓ ' : ''}{ind.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </>
            )}
          </View>

          {/* trade settings */}
          <View style={styles.sourceBox}>
            <View style={styles.sourceHead}>
              <Wallet2 size={13} color={colors.dark.green} />
              <Text style={styles.sourceTitle}>تنظیمات هر معامله</Text>
            </View>
            <View style={styles.settingsGrid}>
              <View style={styles.settingCell}>
                <Text style={styles.settingLabel}>لوریج</Text>
                <TextInput
                  style={styles.settingInput}
                  value={String(settings.leverage)}
                  onChangeText={(t) => setSettings((s) => ({ ...s, leverage: Math.max(1, Math.min(125, parseInt(t.replace(/\D/g, '') || '1', 10) || 1)) }))}
                  onEndEditing={() => void persist(settings)}
                  keyboardType="number-pad"
                />
              </View>
              <View style={styles.settingCell}>
                <Text style={styles.settingLabel}>حجم ($)</Text>
                <TextInput
                  style={styles.settingInput}
                  value={String(settings.positionSizeUsd)}
                  onChangeText={(t) => setSettings((s) => ({ ...s, positionSizeUsd: Math.max(5, parseInt(t.replace(/\D/g, '') || '5', 10) || 5) }))}
                  onEndEditing={() => void persist(settings)}
                  keyboardType="number-pad"
                />
              </View>
              <View style={styles.settingCell}>
                <Text style={styles.settingLabel}>حد ضرر (٪)</Text>
                <TextInput
                  style={styles.settingInput}
                  value={String(settings.maxLossPercent)}
                  onChangeText={(t) => setSettings((s) => ({ ...s, maxLossPercent: Math.max(0.5, Math.min(90, parseFloat(t.replace(/[^\d.]/g, '') || '5') || 5)) }))}
                  onEndEditing={() => void persist(settings)}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.settingCell}>
                <Text style={styles.settingLabel}>ریوارد (R:R)</Text>
                <TextInput
                  style={styles.settingInput}
                  value={String(settings.rewardRatio)}
                  onChangeText={(t) => setSettings((s) => ({ ...s, rewardRatio: Math.max(0.5, Math.min(20, parseFloat(t.replace(/[^\d.]/g, '') || '2') || 2)) }))}
                  onEndEditing={() => void persist(settings)}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.settingCell}>
                <Text style={styles.settingLabel}>حداکثر پوزیشن</Text>
                <TextInput
                  style={styles.settingInput}
                  value={String(settings.maxOpenPositions)}
                  onChangeText={(t) => setSettings((s) => ({ ...s, maxOpenPositions: Math.max(1, Math.min(10, parseInt(t.replace(/\D/g, '') || '3', 10) || 3)) }))}
                  onEndEditing={() => void persist(settings)}
                  keyboardType="number-pad"
                />
              </View>
            </View>
            <Text style={styles.sourceHint}>
              استاپ‌لاس و تیک‌پرافیت اتوماتیک از نقطه ورود محاسبه می‌شوند: استاپ = {settings.maxLossPercent}٪ دورتر
              از ورود؛ تیک‌پرافیت = فاصله استاپ × {settings.rewardRatio} (ریوارد به ریسک).
            </Text>
          </View>

          {/* demo positions */}
          {(settings.mode === 'demo' || openPositions.length > 0) && (
            <View style={styles.sourceBox}>
              <View style={styles.sourceHead}>
                <TrendingUp size={13} color={totalPnl >= 0 ? colors.dark.green : colors.dark.red} />
                <Text style={styles.sourceTitle}>پوزیشن‌های ربات (دمو)</Text>
                <Pressable onPress={() => void refreshPositions()} hitSlop={8}>
                  <RefreshCw size={12} color={colors.dark.accent} />
                </Pressable>
              </View>
              {openPositions.length === 0 && (
                <Text style={styles.sourceHint}>پوزیشن بازی نیست — با اولین سیگنال/حرکت نهنگ باز می‌شود.</Text>
              )}
              {openPositions.map((p) => {
                const dir = p.side === 'long' ? 1 : -1;
                const pnl = (p.lastPrice - p.entryPrice) * dir * p.qty;
                return (
                  <View key={p.id} style={styles.posRow}>
                    <View style={styles.posMain}>
                      <Text style={styles.posSymbol}>
                        {p.side === 'long' ? '🟢' : '🔴'} {p.symbol} ×{p.leverage}
                      </Text>
                      <Text style={styles.posSource} numberOfLines={1}>
                        {p.source === 'whale' ? '🐋 ' : '📈 '}{p.sourceLabel}
                      </Text>
                      <Text style={styles.posPrices}>
                        ورود {p.entryPrice.toFixed(4)} → {p.lastPrice.toFixed(4)} • SL {p.stopPrice.toFixed(3)} / TP {p.takePrice.toFixed(3)}
                      </Text>
                    </View>
                    <View style={styles.posSide}>
                      <Text style={[styles.posPnl, { color: pnl >= 0 ? colors.dark.green : colors.dark.red }]}>
                        {pnl >= 0 ? '+' : '−'}${Math.abs(pnl).toFixed(2)}
                      </Text>
                      <Pressable style={styles.posCloseBtn} onPress={() => void manualClosePosition(settings, realKeys, p).then(refreshPositions)}>
                        <X size={11} color={colors.dark.red} />
                      </Pressable>
                    </View>
                  </View>
                );
              })}
              {closedPositions.length > 0 && (
                <View style={styles.closedBox}>
                  <Text style={styles.closedTitle}>بسته‌شده‌ها:</Text>
                  {closedPositions.map((p) => (
                    <View key={p.id} style={styles.closedRow}>
                      <Text style={styles.closedText} numberOfLines={1}>
                        {p.symbol} ({p.closeReason === 'stop' ? 'استاپ' : p.closeReason === 'take' ? 'تیک‌پرافیت' : p.closeReason === 'whale-close' ? 'نهنگ بست' : p.closeReason === 'signal' ? 'سیگنال' : 'دستی'})
                      </Text>
                      <Text style={[styles.posPnl, { color: (p.realizedPnl ?? 0) >= 0 ? colors.dark.green : colors.dark.red }]}>
                        {(p.realizedPnl ?? 0) >= 0 ? '+' : '−'}${Math.abs(p.realizedPnl ?? 0).toFixed(2)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* engine log */}
          {logs.length > 0 && (
            <View style={styles.logBox}>
              {logs.slice(0, 6).map((l) => (
                <Text key={l.id} style={styles.logLine} numberOfLines={2}>
                  {l.kind === 'error' ? '✖' : l.kind === 'open' ? '▲' : l.kind === 'close' ? '▼' : '•'} {l.message}
                </Text>
              ))}
              {lastCycleAt && (
                <Text style={styles.logTime}>
                  آخرین چرخه: {Math.round((Date.now() - lastCycleAt) / 1000)} ثانیه پیش — هر ۶۰ ثانیه تکرار می‌شود (برنامه باز).
                </Text>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.dark.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    padding: 12,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.dark.accent + '22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconActive: {
    backgroundColor: colors.dark.green,
  },
  title: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.dark.text,
  },
  subtitle: {
    fontSize: 9.5,
    color: colors.dark.textSecondary,
    marginTop: 1,
  },
  body: {
    marginTop: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: colors.dark.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    overflow: 'hidden',
  },
  modeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  modeBtnActive: {
    backgroundColor: colors.dark.green,
  },
  modeBtnReal: {
    backgroundColor: colors.dark.red,
  },
  modeBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.dark.textSecondary,
  },
  modeBtnTextActive: {
    color: colors.dark.background,
  },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.dark.green,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  startBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.dark.background,
  },
  stopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.dark.red + '22',
    borderWidth: 1,
    borderColor: colors.dark.red + '55',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  stopBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.dark.red,
  },
  warn: {
    fontSize: 9,
    color: colors.dark.textMuted,
    marginBottom: 6,
    textAlign: 'right',
  },
  warnReal: {
    fontSize: 9.5,
    color: colors.dark.red,
    marginBottom: 6,
    textAlign: 'right',
    fontWeight: '700',
  },
  sourceBox: {
    backgroundColor: colors.dark.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    padding: 10,
    marginBottom: 8,
  },
  sourceHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sourceTitle: {
    fontSize: 11.5,
    fontWeight: '700',
    color: colors.dark.text,
    flex: 1,
  },
  sourceHint: {
    fontSize: 9,
    color: colors.dark.textMuted,
    marginTop: 6,
    textAlign: 'right',
    lineHeight: 13,
  },
  chipsRow: {
    gap: 6,
    paddingRight: 4,
    marginTop: 8,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7,
    backgroundColor: colors.dark.card,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    maxWidth: 160,
  },
  chipActive: {
    backgroundColor: colors.dark.accent,
    borderColor: colors.dark.accent,
  },
  chipText: {
    fontSize: 10,
    color: colors.dark.textSecondary,
  },
  chipTextActive: {
    color: colors.dark.background,
    fontWeight: '700',
  },
  miniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  miniText: {
    fontSize: 9,
    color: colors.dark.textSecondary,
    flex: 1,
  },
  settingsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  settingCell: {
    flexBasis: '30%',
    flexGrow: 1,
  },
  settingLabel: {
    fontSize: 9,
    color: colors.dark.textMuted,
    marginBottom: 3,
    textAlign: 'right',
  },
  settingInput: {
    backgroundColor: colors.dark.card,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 5,
    fontSize: 11,
    color: colors.dark.text,
    textAlign: 'center',
  },
  posRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
    padding: 8,
    marginTop: 6,
  },
  posMain: {
    flex: 1,
  },
  posSymbol: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.dark.text,
  },
  posSource: {
    fontSize: 8.5,
    color: colors.dark.textMuted,
    marginTop: 1,
  },
  posPrices: {
    fontSize: 8.5,
    color: colors.dark.textSecondary,
    marginTop: 2,
  },
  posSide: {
    alignItems: 'flex-end',
    gap: 4,
  },
  posPnl: {
    fontSize: 11,
    fontWeight: '800',
  },
  posCloseBtn: {
    padding: 4,
  },
  closedBox: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.dark.cardBorder,
  },
  closedTitle: {
    fontSize: 9,
    color: colors.dark.textMuted,
    marginBottom: 4,
  },
  closedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  closedText: {
    fontSize: 9.5,
    color: colors.dark.textSecondary,
    flex: 1,
  },
  logBox: {
    marginTop: 4,
  },
  logLine: {
    fontSize: 8.5,
    color: colors.dark.textMuted,
    lineHeight: 13,
    textAlign: 'right',
  },
  logTime: {
    fontSize: 8,
    color: colors.dark.textMuted,
    marginTop: 4,
    textAlign: 'right',
  },
});
