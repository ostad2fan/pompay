import { useEffect, useState, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import { Platform, Alert, AppState, AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import { TradeSignal, AppSettings, SignalType, CustomIndicator } from '@/types/crypto';
import { scanAllSignals } from '@/utils/binanceApi';
import { sendTelegramSignalNotification, startTelegramPolling, stopTelegramPolling } from '@/utils/telegramService';
import {
  GainzAlgoSignal,
  getStoredGainzAlgoSignals,
  mergeServerGainzSignals,
  setGainzAlgoUpdateListener,
  startGainzAlgoScheduler,
  stopGainzAlgoScheduler,
  runGainzAlgoScanCycle,
} from '@/utils/gainzAlgoService';
import {
  CustomIndicatorSignal,
  mergeServerCustomSignals,
  setCustomIndicatorsUpdateListener,
  startCustomIndicatorsScheduler,
  stopCustomIndicatorsScheduler,
} from '@/utils/customIndicatorsService';
import {
  HookReversalSignal,
  HOOK_TF_LABEL,
  getStoredHookSignals,
  mergeServerHookSignals,
  runHookScanCycle,
  setHookReversalUpdateListener,
  startHookReversalScheduler,
  stopHookReversalScheduler,
  updateHookReversalTimeframes,
} from '@/utils/hookReversalService';
import { fetchServerSignals, fetchServerPumpDumpSignals, syncScanConfig } from '@/utils/scanServerApi';
import { setThemeMode as applyPalette, getThemeMode, type ThemeMode } from '@/constants/colors';
import { registerPushOnServer, ensureNotificationPermission } from '@/utils/pushService';

const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  apiSecret: '',
  scanInterval: 60,
  volumeThreshold: 2.0,
  notificationsEnabled: true,
  scannerNotifications: true,
  whaleNotifications: true,
  exchange: 'binance',
  marginAmount: 100,
  leverage: 10,
  riskRewardRatio: 2,
  indicators: [],
  selectedIndicatorIds: [],
  customCoins: [],
  useCustomCoinsOnly: false,
  refreshInterval: 5,
  scanFilterMode: 'all',
  useVolumeOnlySignals: false,
  memeShortNotifications: true,
  preListingNotifications: true,
  tradeAiNotifications: true,
  gainzAlgoNotifications: true,
  gainzTimeframes: ['1d'],
  arzinjaApiKey: '70c505037afe7c40be8dd6b10ba92d73',
  arzinjaApiSecret: '6986dce5b5d4f758da59b85d7102a7d7f05ebf30df320018610b8c9281319419',
  hookReversalNotifications: true,
  hookTimeframes: ['1d'],
  telegramBotToken: '',
  telegramChatId: '',
  telegramEnabled: false,
  themeMode: 'dark' as ThemeMode,
};

const SETTINGS_KEY = '@crypto_scanner_settings';
const SIGNALS_KEY = '@crypto_scanner_signals';

async function loadGainzSignals(): Promise<GainzAlgoSignal[]> {
  return getStoredGainzAlgoSignals();
}

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

async function registerForPushNotifications() {
  if (Platform.OS === 'web') return;
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.log('[Notifications] Permission not granted');
      return;
    }
    console.log('[Notifications] Permission granted');
  } catch (e) {
    console.log('[Notifications] Error requesting permission:', e);
  }
}

async function loadSettings(): Promise<AppSettings> {
  try {
    const stored = await AsyncStorage.getItem(SETTINGS_KEY);
    if (stored) return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
  } catch (e) {
    console.log('[AppContext] Error loading settings:', e);
  }
  return DEFAULT_SETTINGS;
}

async function loadSignals(): Promise<TradeSignal[]> {
  try {
    const stored = await AsyncStorage.getItem(SIGNALS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.map((s: TradeSignal) => ({ ...s, detectedAt: new Date(s.detectedAt) }));
    }
  } catch (e) {
    console.log('[AppContext] Error loading signals:', e);
  }
  return [];
}

export const [AppProvider, useApp] = createContextHook(() => {
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [signals, setSignals] = useState<TradeSignal[]>([]);
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);
  const [activeFilter, setActiveFilter] = useState<SignalType | 'all' | 'gainz'>('all');
  const [gainzSignals, setGainzSignals] = useState<GainzAlgoSignal[]>([]);
  const [hookSignals, setHookSignals] = useState<HookReversalSignal[]>([]);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const knownGainzIdsRef = useRef<Set<string>>(new Set());
  const knownHookIdsRef = useRef<Set<string>>(new Set());

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: loadSettings,
    staleTime: Infinity,
  });

  const signalsQuery = useQuery({
    queryKey: ['stored-signals'],
    queryFn: loadSignals,
    staleTime: Infinity,
  });

  const gainzSignalsQuery = useQuery({
    queryKey: ['gainz-algo-signals'],
    queryFn: loadGainzSignals,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (settingsQuery.data) {
      setSettings(settingsQuery.data);
    }
  }, [settingsQuery.data]);

  // Apply the persisted UI theme as soon as settings load (palette mutation
  // + themeVersion bump → every themed StyleSheet rebuilds on next access).
  useEffect(() => {
    applyPalette((settings.themeMode as ThemeMode) ?? 'dark');
  }, [settings.themeMode]);

  useEffect(() => {
    if (signalsQuery.data) {
      setSignals(signalsQuery.data);
    }
  }, [signalsQuery.data]);

  useEffect(() => {
    if (gainzSignalsQuery.data) {
      setGainzSignals(gainzSignalsQuery.data);
      knownGainzIdsRef.current = new Set(gainzSignalsQuery.data.map((s) => s.id));
    }
  }, [gainzSignalsQuery.data]);

  useEffect(() => {
    let cancelled = false;
    getStoredHookSignals().then((stored) => {
      if (cancelled) return;
      setHookSignals(stored);
      knownHookIdsRef.current = new Set(stored.map((s) => s.id));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveSettingsMutation = useMutation({
    mutationFn: async (newSettings: AppSettings) => {
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
      return newSettings;
    },
    onSuccess: (data) => {
      setSettings(data);
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      console.log('[AppContext] Starting full scan...');
      try {
        const results = await scanAllSignals(settings.volumeThreshold);
        return results;
      } catch (directError) {
        // Binance API is geo-blocked on many Iranian mobile networks — fall back
        // to the server-computed pump/dump scan (the Railway server can reach Binance).
        console.log('[AppContext] Direct scan failed, trying server fallback...', directError);
        const serverSignals = await fetchServerPumpDumpSignals(settings.volumeThreshold);
        if (serverSignals && serverSignals.length > 0) {
          return serverSignals;
        }
        throw directError;
      }
    },
    onSuccess: async (results) => {
      let filteredResults = results;

      if (settings.useCustomCoinsOnly && settings.customCoins.length > 0) {
        filteredResults = results.filter((r) =>
          settings.customCoins.some((coin) =>
            r.symbol.toUpperCase().includes(coin.toUpperCase())
          )
        );
        console.log(`[AppContext] Filtered to ${filteredResults.length} signals for custom coins`);
      }

      const newSignals = filteredResults.filter(
        (r) => !signals.some((s) => s.symbol === r.symbol && s.signalType === r.signalType)
      );

      if (newSignals.length > 0 && settings.notificationsEnabled) {
        sendNotification(newSignals);
        if (settings.telegramEnabled && settings.scannerNotifications) {
          sendTelegramSignalNotification(newSignals).catch(() => {});
        }
      }

      setSignals(filteredResults);
      setLastScanTime(new Date());
      try {
        await AsyncStorage.setItem(SIGNALS_KEY, JSON.stringify(filteredResults));
      } catch (e) {
        console.log('[AppContext] Error saving signals:', e);
      }
    },
    onError: (error) => {
      console.log('[AppContext] Scan error:', error);
    },
  });

  useEffect(() => {
    if (settings.notificationsEnabled) {
      registerForPushNotifications();
    }
  }, [settings.notificationsEnabled]);

  // Indicator schedulers + listeners: GainzAlgo scans daily candles hourly and
  // user-defined indicators scan their own timeframes; new BUY/SELL signals go
  // to local notifications here and to Telegram (inside the services).
  useEffect(() => {
    if (!settings.telegramEnabled) {
      stopGainzAlgoScheduler();
      stopCustomIndicatorsScheduler();
      return;
    }
    setGainzAlgoUpdateListener((newSignals: GainzAlgoSignal[]) => {
      setGainzSignals((prev) => {
        const prevIds = new Set(prev.map((s) => s.id));
        const merged = [...newSignals.filter((s) => !prevIds.has(s.id)), ...prev].slice(0, 120);
        return merged;
      });
      for (const sig of newSignals) {
        if (knownGainzIdsRef.current.has(sig.id)) continue;
        knownGainzIdsRef.current.add(sig.id);
        if (Platform.OS === 'web') continue;
        if (settings.gainzAlgoNotifications === false) continue;
        const icon = sig.action === 'buy' ? '🟢' : '🔴';
        const tfLabels: Record<string, string> = {
          '15m': '۱۵ دقیقه',
          '30m': '۳۰ دقیقه',
          '1h': '۱ ساعته',
          '4h': '۴ ساعته',
          '1d': 'روزانه',
        };
        const tfLabel = tfLabels[sig.timeframe ?? '1d'] ?? sig.timeframe ?? 'روزانه';
        const title = `${icon} سیگنال اندیکاتور GainzAlgo`;
        const body = `${sig.displayName} — ${sig.action === 'buy' ? 'خرید' : 'فروش'} در تایم‌فریم ${tfLabel}${sig.live ? ' (کندل در حال ساخت)' : ''} | قیمت: $${sig.price.toFixed(4)}`;
        Notifications.scheduleNotificationAsync({
          content: { title, body, sound: 'default' },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1 },
        }).catch(() => {});
      }
    });
    setCustomIndicatorsUpdateListener((newSignals: CustomIndicatorSignal[]) => {
      for (const sig of newSignals) {
        if (knownGainzIdsRef.current.has(sig.id)) continue;
        knownGainzIdsRef.current.add(sig.id);
        if (Platform.OS === 'web') continue;
        const icon = sig.action === 'buy' ? '🟢' : '🔴';
        const title = `${icon} سیگنال اندیکاتور «${sig.indicatorName}»`;
        const body = `${sig.displayName} — ${sig.action === 'buy' ? 'خرید' : 'فروش'} | قیمت: $${sig.price.toFixed(4)}`;
        Notifications.scheduleNotificationAsync({
          content: { title, body, sound: 'default' },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1 },
        }).catch(() => {});
      }
    });
    setHookReversalUpdateListener((newSignals: HookReversalSignal[]) => {
      setHookSignals((prev) => {
        const prevIds = new Set(prev.map((s) => s.id));
        const extra = newSignals.filter((s) => !prevIds.has(s.id));
        return extra.length > 0 ? [...extra, ...prev].slice(0, 200) : prev;
      });
      for (const sig of newSignals) {
        if (knownHookIdsRef.current.has(sig.id)) continue;
        knownHookIdsRef.current.add(sig.id);
        if (Platform.OS === 'web') continue;
        if (settings.hookReversalNotifications === false) continue;
        const icon = sig.action === 'buy' ? '🟢' : '🔴';
        const title = `${icon} هوک ${sig.action === 'buy' ? 'صعودی' : 'نزولی'} ریورسال`;
        const body = `${sig.displayName} | قیمت: $${sig.price.toFixed(4)} | تایم‌فریم ${HOOK_TF_LABEL[sig.timeframe] ?? sig.timeframe}`;
        Notifications.scheduleNotificationAsync({
          content: { title, body, sound: 'default' },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1 },
        }).catch(() => {});
      }
    });
    startGainzAlgoScheduler();
    startCustomIndicatorsScheduler();
    startHookReversalScheduler(settings.hookTimeframes ?? ['1d']);
    return () => {
      stopGainzAlgoScheduler();
      stopCustomIndicatorsScheduler();
      stopHookReversalScheduler();
      setGainzAlgoUpdateListener(null);
      setCustomIndicatorsUpdateListener(null);
      setHookReversalUpdateListener(null);
    };
  }, [settings.telegramEnabled]);

  // Keep the running hook scheduler in sync with the selected timeframes.
  useEffect(() => {
    updateHookReversalTimeframes(settings.hookTimeframes ?? ['1d']);
  }, [settings.hookTimeframes]);

  const refreshGainzScan = useCallback(async (): Promise<GainzAlgoSignal[]> => {
    const results = await runGainzAlgoScanCycle();
    setGainzSignals(results);
    return results;
  }, []);

  const refreshHookScan = useCallback(async (): Promise<HookReversalSignal[]> => {
    const results = await runHookScanCycle(settings.hookTimeframes ?? ['1d']);
    setHookSignals(results);
    return results;
  }, [settings.hookTimeframes]);

  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active' && scanIntervalRef.current) {
        console.log('[AppContext] App became active, triggering scan...');
        scanMutation.mutate();
      }
    };
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, []);

  const sendNotification = useCallback(async (newSignals: TradeSignal[]) => {
    const pumpCount = newSignals.filter((s) => s.signalType === 'pump').length;
    const dumpCount = newSignals.filter((s) => s.signalType === 'dump').length;
    const names = newSignals.map((s) => `${s.displayName} (${s.signalType === 'pump' ? 'پامپ' : 'دامپ'})`).join('، ');

    const title = '🔔 سیگنال جدید!';
    const body = `${pumpCount > 0 ? `${pumpCount} پامپ` : ''}${pumpCount > 0 && dumpCount > 0 ? ' و ' : ''}${dumpCount > 0 ? `${dumpCount} دامپ` : ''} شناسایی شد:\n${names}`;

    if (Platform.OS === 'web') {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body });
      }
    } else {
      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title,
            body,
            sound: 'default',
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1 },
        });
        console.log('[Notifications] Local notification sent');
      } catch (e) {
        console.log('[Notifications] Error sending notification:', e);
        Alert.alert(title, body);
      }
    }
  }, []);

  const updateSettings = useCallback(
    (newSettings: Partial<AppSettings>) => {
      const updated = { ...settings, ...newSettings };
      saveSettingsMutation.mutate(updated);
    },
    [settings]
  );

  /** Switch the whole app between dark and light mode (persisted). */
  const setAppThemeMode = useCallback(
    (mode: ThemeMode) => {
      applyPalette(mode);
      const updated = { ...settings, themeMode: mode };
      saveSettingsMutation.mutate(updated);
    },
    [settings]
  );

  const addIndicator = useCallback(
    (indicator: CustomIndicator) => {
      const updated = {
        ...settings,
        indicators: [...settings.indicators, indicator],
      };
      saveSettingsMutation.mutate(updated);
    },
    [settings]
  );

  const updateIndicator = useCallback(
    (indicator: CustomIndicator) => {
      const updated = {
        ...settings,
        indicators: settings.indicators.map((i) => (i.id === indicator.id ? indicator : i)),
      };
      saveSettingsMutation.mutate(updated);
    },
    [settings]
  );

  const deleteIndicator = useCallback(
    (id: string) => {
      const updated = {
        ...settings,
        indicators: settings.indicators.filter((i) => i.id !== id),
        selectedIndicatorIds: settings.selectedIndicatorIds.filter((sid) => sid !== id),
      };
      saveSettingsMutation.mutate(updated);
    },
    [settings]
  );

  const toggleIndicatorSelection = useCallback(
    (id: string) => {
      const isSelected = settings.selectedIndicatorIds.includes(id);
      const updated = {
        ...settings,
        selectedIndicatorIds: isSelected
          ? settings.selectedIndicatorIds.filter((sid) => sid !== id)
          : [...settings.selectedIndicatorIds, id],
      };
      saveSettingsMutation.mutate(updated);
    },
    [settings]
  );

  const startAutoScan = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
    }
    // Persist the ON state so auto-scan resumes after app restarts
    // (previously the toggle always reset to OFF on reopen).
    if (settings.autoScanEnabled !== true) {
      saveSettingsMutation.mutate({ ...settings, autoScanEnabled: true });
    }
    scanMutation.mutate();
    scanIntervalRef.current = setInterval(() => {
      scanMutation.mutate();
    }, settings.scanInterval * 1000);
  }, [settings]);

  const stopAutoScan = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (settings.autoScanEnabled === true) {
      saveSettingsMutation.mutate({ ...settings, autoScanEnabled: false });
    }
  }, [settings]);

  // Auto-resume the persisted auto-scan mode as soon as settings load.
  const autoScanResumedRef = useRef(false);
  useEffect(() => {
    if (settings.autoScanEnabled === true && !autoScanResumedRef.current) {
      autoScanResumedRef.current = true;
      startAutoScan();
    }
  }, [settings.autoScanEnabled, startAutoScan]);

  // Register for native push notifications on launch (non-fatal — Telegram
  // remains the always-on background-alerts channel).
  useEffect(() => {
    ensureNotificationPermission().then((granted) => {
      if (granted) {
        registerPushOnServer().catch(() => {});
      }
    });
  }, []);

  useEffect(() => {
    if (settings.telegramEnabled && settings.telegramBotToken && settings.telegramChatId) {
      console.log('[AppContext] Telegram enabled, starting polling...');
      startTelegramPolling();
    } else {
      stopTelegramPolling();
    }
  }, [settings.telegramEnabled, settings.telegramBotToken, settings.telegramChatId]);

  // Sync the scan config to the server so the daily UTC-midnight scan runs
  // even when the app is fully closed (signals announced via Telegram).
  useEffect(() => {
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

  // Pull the signals the server computed while the app was closed into local
  // storage + state, so the indicators tab AND the Telegram bot commands
  // (/gainz, /indicators) show them. No local notification here — the server
  // already announced these on Telegram when they were detected.
  useEffect(() => {
    if (!settings.telegramEnabled) return;
    let cancelled = false;
    (async () => {
      try {
        const server = await fetchServerSignals();
        if (!server || cancelled) return;
        if (server.customSignals.length > 0) {
          await mergeServerCustomSignals(server.customSignals);
        }
        if (server.gainzSignals.length > 0) {
          const merged = await mergeServerGainzSignals(server.gainzSignals);
          if (cancelled) return;
          setGainzSignals((prev) => {
            const prevIds = new Set(prev.map((s) => s.id));
            const extra = merged.filter((s) => !prevIds.has(s.id));
            return extra.length > 0 ? [...prev, ...extra] : prev;
          });
        }
        if (server.hookSignals.length > 0) {
          const mergedHook = await mergeServerHookSignals(server.hookSignals);
          if (cancelled) return;
          setHookSignals((prev) => {
            const prevIds = new Set(prev.map((s) => s.id));
            const extra = mergedHook.filter((s) => !prevIds.has(s.id));
            return extra.length > 0 ? [...extra, ...prev] : prev;
          });
        }
        console.log('[AppContext] Server signals pulled into local storage');
      } catch (e) {
        console.log('[AppContext] Server signal pull failed:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.telegramEnabled]);

  useEffect(() => {
    return () => {
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
      }
      stopTelegramPolling();
      stopGainzAlgoScheduler();
      stopCustomIndicatorsScheduler();
      stopHookReversalScheduler();
    };
  }, []);

  const filteredSignals = signals.filter((s) => {
    if (activeFilter === 'all') return true;
    return s.signalType === activeFilter;
  });

  const pumpCount = signals.filter((s) => s.signalType === 'pump').length;
  const dumpCount = signals.filter((s) => s.signalType === 'dump').length;

  return {
    settings,
    signals: filteredSignals,
    allSignals: signals,
    pumpCount,
    dumpCount,
    gainzSignals,
    refreshGainzScan,
    hookSignals,
    refreshHookScan,
    activeFilter,
    setActiveFilter,
    lastScanTime,
    isScanning: scanMutation.isPending,
    scanError: scanMutation.error?.message ?? null,
    isLoading: settingsQuery.isLoading,
    updateSettings,
    setAppThemeMode,
    themeMode: (getThemeMode() as ThemeMode),
    addIndicator,
    updateIndicator,
    deleteIndicator,
    toggleIndicatorSelection,
    scan: () => scanMutation.mutate(),
    startAutoScan,
    stopAutoScan,
  };
});
