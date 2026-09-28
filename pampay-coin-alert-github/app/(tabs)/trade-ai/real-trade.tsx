import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  ActivityIndicator,
  Animated,
  Platform,
  Modal,
  Switch,
} from 'react-native';
import {
  Zap,
  TrendingUp,
  TrendingDown,
  Minus,
  Target,
  ShieldAlert,
  X,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Settings,
  AlertTriangle,
  Play,
  Square,
  Edit3,
  Check,
  Bell,
  Activity,
  Lock,
  Bot,
  Hand,
  Plus,
  Trash2,
  Shield,
  BarChart3,
} from 'lucide-react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import colors from '@/constants/colors';
import { createThemedStyles } from '@/utils/themeStyles';
import { EXCHANGES, EXCHANGE_LIST } from '@/constants/exchanges';
import { useApp } from '@/contexts/AppContext';
import { AITradeSignal } from '@/types/tradeAi';
import { ExchangeId } from '@/types/crypto';
import {
  getPositions,
  getAccountInfo,
  openRealPosition,
  closePosition,
  updateStopLoss,
  updateTakeProfit,
  setTrailingStop,
  parsePositions,
  cancelAllOrders,
  getOpenOrders,
} from '@/utils/binanceFuturesTrading';
import type { RealPosition, BinanceAccountInfo } from '@/utils/binanceFuturesTrading';
import DropdownPicker from '@/components/DropdownPicker';
import { sendTelegramTradeNotification, sendTelegramAISignal } from '@/utils/telegramService';

const SIGNALS_HISTORY_KEY = '@trade_ai_signals';
const PREV_SIGNALS_KEY = '@trade_ai_prev_signal_states';
const AUTO_TRADE_CONFIG_KEY = '@real_trade_auto_config';
const EXCHANGE_CONFIGS_KEY = '@real_trade_exchange_configs';
const AUTO_TRADE_LOG_KEY = '@real_trade_auto_log';

type TradeMode = 'manual' | 'auto';
type TradeSource = 'ai' | 'scanner' | 'both';

interface ExchangeConfig {
  id: string;
  exchangeId: ExchangeId;
  apiKey: string;
  apiSecret: string;
  enabled: boolean;
  tradeSource: TradeSource;
  selectedSymbols: string[];
  tradeAllSymbols: boolean;
}

interface AutoTradeConfig {
  enabled: boolean;
  entryAmount: number;
  maxLeverage: number;
  minConfidence: number;
  maxOpenPositions: number;
  maxRiskPercent: number;
  preserveCapitalPercent: number;
}

interface AutoTradeLog {
  id: string;
  timestamp: number;
  symbol: string;
  action: string;
  confidence: number;
  amount: number;
  exchangeId: string;
  status: 'success' | 'failed';
  message: string;
}

interface EditingPosition {
  position: RealPosition;
  field: 'sl' | 'tp' | 'trailing';
  value: string;
}

const DEFAULT_AUTO_CONFIG: AutoTradeConfig = {
  enabled: false,
  entryAmount: 50,
  maxLeverage: 10,
  minConfidence: 78,
  maxOpenPositions: 3,
  maxRiskPercent: 5,
  preserveCapitalPercent: 80,
};

const EXCHANGE_OPTIONS = EXCHANGE_LIST.map((ex) => ({
  key: ex.id,
  label: ex.name,
}));

export default function RealTradeScreen() {
  const queryClient = useQueryClient();
  const { settings, allSignals: scannerSignals } = useApp();
  const [tradeMode, setTradeMode] = useState<TradeMode>('manual');
  const [selectedSignal, setSelectedSignal] = useState<AITradeSignal | null>(null);
  const [entryAmount, setEntryAmount] = useState('50');
  const [customLeverage, setCustomLeverage] = useState('');
  const [customSL, setCustomSL] = useState('');
  const [customTP, setCustomTP] = useState('');
  const [showSignalPicker, setShowSignalPicker] = useState(false);
  const [editingPos, setEditingPos] = useState<EditingPosition | null>(null);
  const [trailingRate, setTrailingRate] = useState('1');
  const [showTrailingModal, setShowTrailingModal] = useState<RealPosition | null>(null);

  const [exchangeConfigs, setExchangeConfigs] = useState<ExchangeConfig[]>([]);
  const [activeExchangeIdx, setActiveExchangeIdx] = useState(0);
  const [showExchangeForm, setShowExchangeForm] = useState(false);
  const [newExchangeId, setNewExchangeId] = useState<ExchangeId>('binance');
  const [newApiKey, setNewApiKey] = useState('');
  const [newApiSecret, setNewApiSecret] = useState('');
  const [newTradeSource, setNewTradeSource] = useState<TradeSource>('ai');
  const [newTradeAllSymbols, setNewTradeAllSymbols] = useState(true);
  const [newSelectedSymbols, setNewSelectedSymbols] = useState<string[]>([]);
  const [newCoinInput, setNewCoinInput] = useState('');

  const [autoConfig, setAutoConfig] = useState<AutoTradeConfig>(DEFAULT_AUTO_CONFIG);
  const [autoLogs, setAutoLogs] = useState<AutoTradeLog[]>([]);
  const [showAutoLogs, setShowAutoLogs] = useState(false);
  const [showAutoSettings, setShowAutoSettings] = useState(false);

  const [countdown, setCountdown] = useState(3);
  const countdownBarAnim = useRef(new Animated.Value(1)).current;
  const liveIndicator = useRef(new Animated.Value(0)).current;
  const prevSignalStatesRef = useRef<Record<string, string>>({});
  const shouldRefreshRef = useRef(false);
  const autoBotActiveRef = useRef(false);

  const activeExchange = exchangeConfigs[activeExchangeIdx] ?? null;
  const hasApiKeys = Boolean(activeExchange?.apiKey && activeExchange?.apiSecret);

  const exchangeInfo = activeExchange
    ? (EXCHANGES[activeExchange.exchangeId] ?? EXCHANGES.binance)
    : EXCHANGES[settings.exchange] ?? EXCHANGES.binance;

  useEffect(() => {
    const loadConfigs = async () => {
      try {
        const stored = await AsyncStorage.getItem(EXCHANGE_CONFIGS_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as ExchangeConfig[];
          setExchangeConfigs(parsed);
        } else if (settings.apiKey && settings.apiSecret) {
          const defaultConfig: ExchangeConfig = {
            id: `ex-${Date.now()}`,
            exchangeId: settings.exchange,
            apiKey: settings.apiKey,
            apiSecret: settings.apiSecret,
            enabled: true,
            tradeSource: 'ai',
            selectedSymbols: [],
            tradeAllSymbols: true,
          };
          setExchangeConfigs([defaultConfig]);
          await AsyncStorage.setItem(EXCHANGE_CONFIGS_KEY, JSON.stringify([defaultConfig]));
        }
      } catch (e) {
        console.log('[RealTrade] Error loading exchange configs:', e);
      }
    };
    loadConfigs();
  }, []);

  useEffect(() => {
    const loadAutoConfig = async () => {
      try {
        const stored = await AsyncStorage.getItem(AUTO_TRADE_CONFIG_KEY);
        if (stored) setAutoConfig(JSON.parse(stored));
        const logs = await AsyncStorage.getItem(AUTO_TRADE_LOG_KEY);
        if (logs) setAutoLogs(JSON.parse(logs));
      } catch (e) {
        console.log('[RealTrade] Error loading auto config:', e);
      }
    };
    loadAutoConfig();
  }, []);

  const saveExchangeConfigs = useCallback(async (configs: ExchangeConfig[]) => {
    setExchangeConfigs(configs);
    await AsyncStorage.setItem(EXCHANGE_CONFIGS_KEY, JSON.stringify(configs));
  }, []);

  const saveAutoConfig = useCallback(async (config: AutoTradeConfig) => {
    setAutoConfig(config);
    await AsyncStorage.setItem(AUTO_TRADE_CONFIG_KEY, JSON.stringify(config));
  }, []);

  const addAutoLog = useCallback(async (log: AutoTradeLog) => {
    const updated = [log, ...autoLogs].slice(0, 50);
    setAutoLogs(updated);
    await AsyncStorage.setItem(AUTO_TRADE_LOG_KEY, JSON.stringify(updated));
  }, [autoLogs]);

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(liveIndicator, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(liveIndicator, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [liveIndicator]);

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          shouldRefreshRef.current = true;
          return 3;
        }
        return prev - 1;
      });
    }, 1000);

    countdownBarAnim.setValue(1);
    Animated.timing(countdownBarAnim, {
      toValue: 0,
      duration: 3000,
      useNativeDriver: false,
    }).start();

    return () => clearInterval(interval);
  }, [countdownBarAnim]);

  useEffect(() => {
    if (!shouldRefreshRef.current) return;
    shouldRefreshRef.current = false;

    queryClient.invalidateQueries({ queryKey: ['binance-account'] });
    queryClient.invalidateQueries({ queryKey: ['binance-positions'] });
    queryClient.invalidateQueries({ queryKey: ['binance-orders'] });
    queryClient.invalidateQueries({ queryKey: ['trade-ai-signals'] });

    countdownBarAnim.setValue(1);
    Animated.timing(countdownBarAnim, {
      toValue: 0,
      duration: 3000,
      useNativeDriver: false,
    }).start();
  }, [countdown, queryClient, countdownBarAnim]);

  const signalsQuery = useQuery({
    queryKey: ['trade-ai-signals'],
    queryFn: async () => {
      const stored = await AsyncStorage.getItem(SIGNALS_HISTORY_KEY);
      if (stored) return JSON.parse(stored) as AITradeSignal[];
      return [] as AITradeSignal[];
    },
    staleTime: 5000,
  });

  const signals = signalsQuery.data ?? [];
  const activeSignals = useMemo(
    () => signals.filter(s => s.action !== 'hold').slice(0, 20),
    [signals]
  );

  useEffect(() => {
    const loadPrevStates = async () => {
      try {
        const stored = await AsyncStorage.getItem(PREV_SIGNALS_KEY);
        if (stored) prevSignalStatesRef.current = JSON.parse(stored);
      } catch {}
    };
    loadPrevStates();
  }, []);

  useEffect(() => {
    if (signals.length === 0) return;
    const prevStates = prevSignalStatesRef.current;
    const newStates: Record<string, string> = {};
    for (const sig of signals) {
      const key = sig.symbol;
      newStates[key] = sig.action;
      if (prevStates[key] && prevStates[key] === 'hold' && sig.action !== 'hold') {
        console.log(`[RealTrade] Signal changed for ${sig.symbol}: hold -> ${sig.action}`);
        sendSignalAlert(sig);
      }
    }
    prevSignalStatesRef.current = newStates;
    AsyncStorage.setItem(PREV_SIGNALS_KEY, JSON.stringify(newStates)).catch(() => {});
  }, [signals]);

  const sendSignalAlert = useCallback(async (sig: AITradeSignal) => {
    const title = sig.action === 'buy' ? '🟢 سیگنال خرید!' : '🔴 سیگنال فروش!';
    const body = `${sig.symbol.replace('USDT', '/USDT')} - ${sig.action === 'buy' ? 'Long' : 'Short'} با اطمینان ${sig.confidence}%\nورود: $${sig.entryPrice.toFixed(4)}`;
    try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch {}
    if (Platform.OS === 'web') {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body });
      }
      Alert.alert(title, body);
    } else {
      try {
        await Notifications.scheduleNotificationAsync({
          content: { title, body, sound: 'default' },
          trigger: null,
        });
      } catch {
        Alert.alert(title, body);
      }
    }
  }, []);

  const accountQuery = useQuery({
    queryKey: ['binance-account', activeExchange?.apiKey],
    queryFn: async () => {
      if (!hasApiKeys || !activeExchange) return null;
      return getAccountInfo(activeExchange.apiKey, activeExchange.apiSecret);
    },
    enabled: hasApiKeys,
    refetchInterval: 3000,
    staleTime: 2000,
  });

  const positionsQuery = useQuery({
    queryKey: ['binance-positions', activeExchange?.apiKey],
    queryFn: async () => {
      if (!hasApiKeys || !activeExchange) return [];
      const positions = await getPositions(activeExchange.apiKey, activeExchange.apiSecret);
      return parsePositions(positions);
    },
    enabled: hasApiKeys,
    refetchInterval: 3000,
    staleTime: 2000,
  });

  const ordersQuery = useQuery({
    queryKey: ['binance-orders', activeExchange?.apiKey],
    queryFn: async () => {
      if (!hasApiKeys || !activeExchange) return [];
      return getOpenOrders(activeExchange.apiKey, activeExchange.apiSecret);
    },
    enabled: hasApiKeys,
    refetchInterval: 3000,
    staleTime: 2000,
  });

  const account = accountQuery.data;
  const positions = positionsQuery.data ?? [];
  const openOrdersList = ordersQuery.data ?? [];

  const autoBotMutation = useMutation({
    mutationFn: async (sig: AITradeSignal) => {
      if (!activeExchange) throw new Error('صرافی انتخاب نشده');
      if (!autoConfig.enabled) throw new Error('ربات غیرفعال');

      const totalBalance = account ? parseFloat(account.totalWalletBalance) : 0;
      const preserveAmount = totalBalance * (autoConfig.preserveCapitalPercent / 100);
      const availableForTrade = totalBalance - preserveAmount;

      if (availableForTrade <= 0) {
        throw new Error('موجودی کافی نیست (حفظ سرمایه)');
      }

      if (positions.length >= autoConfig.maxOpenPositions) {
        throw new Error(`حداکثر ${autoConfig.maxOpenPositions} پوزیشن باز مجاز است`);
      }

      const existingPos = positions.find(p => p.symbol === sig.symbol);
      if (existingPos) {
        throw new Error(`پوزیشن فعال روی ${sig.symbol} وجود دارد`);
      }

      let amount = autoConfig.entryAmount;
      const maxRiskAmount = totalBalance * (autoConfig.maxRiskPercent / 100);
      if (amount > maxRiskAmount) {
        amount = maxRiskAmount;
      }
      if (amount > availableForTrade) {
        amount = Math.floor(availableForTrade);
      }
      if (amount < 5) {
        throw new Error('حجم معامله خیلی کم است');
      }

      const leverage = Math.min(sig.leverage, autoConfig.maxLeverage);
      const side = sig.action === 'buy' ? 'long' : 'short';

      console.log(`[AutoBot] Opening ${side} ${sig.symbol} $${amount} ${leverage}x (confidence: ${sig.confidence}%)`);

      const result = await openRealPosition(
        activeExchange.apiKey,
        activeExchange.apiSecret,
        sig.symbol,
        side as 'long' | 'short',
        amount,
        leverage,
        sig.stopLoss,
        sig.targetPrice,
      );
      return { result, sig, amount };
    },
    onSuccess: async ({ sig, amount }) => {
      try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
      const log: AutoTradeLog = {
        id: `log-${Date.now()}`,
        timestamp: Date.now(),
        symbol: sig.symbol,
        action: sig.action,
        confidence: sig.confidence,
        amount,
        exchangeId: activeExchange?.exchangeId ?? 'binance',
        status: 'success',
        message: `${sig.action === 'buy' ? 'Long' : 'Short'} باز شد`,
      };
      addAutoLog(log);
      queryClient.invalidateQueries({ queryKey: ['binance-positions'] });
      queryClient.invalidateQueries({ queryKey: ['binance-account'] });

      if (settings.telegramEnabled) {
        sendTelegramTradeNotification({
          type: 'open',
          symbol: sig.symbol,
          side: sig.action === 'buy' ? 'long' : 'short',
          amount,
          leverage: sig.leverage,
          price: sig.entryPrice,
          exchangeName: EXCHANGES[activeExchange?.exchangeId ?? 'binance']?.name,
          isDemo: false,
        }).catch(() => {});
      }
    },
    onError: (err, sig) => {
      const log: AutoTradeLog = {
        id: `log-${Date.now()}`,
        timestamp: Date.now(),
        symbol: sig.symbol,
        action: sig.action,
        confidence: sig.confidence,
        amount: autoConfig.entryAmount,
        exchangeId: activeExchange?.exchangeId ?? 'binance',
        status: 'failed',
        message: (err as Error).message,
      };
      addAutoLog(log);
      console.log('[AutoBot] Error:', (err as Error).message);
    },
  });

  const processedSignalsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (tradeMode !== 'auto' || !autoConfig.enabled || !hasApiKeys || autoBotMutation.isPending) return;

    const eligibleSignals: AITradeSignal[] = [];

    if (!activeExchange) return;

    const source = activeExchange.tradeSource;

    if (source === 'ai' || source === 'both') {
      for (const sig of signals) {
        if (sig.action === 'hold') continue;
        if (sig.confidence < autoConfig.minConfidence) continue;
        const sigKey = `${sig.id}-${sig.action}`;
        if (processedSignalsRef.current.has(sigKey)) continue;
        if (!activeExchange.tradeAllSymbols && activeExchange.selectedSymbols.length > 0) {
          const base = sig.symbol.replace('USDT', '');
          if (!activeExchange.selectedSymbols.includes(base)) continue;
        }
        eligibleSignals.push(sig);
      }
    }

    if (source === 'scanner' || source === 'both') {
      for (const scanSig of scannerSignals) {
        if (scanSig.strength === 'low') continue;
        const syntheticConfidence = scanSig.strength === 'high' ? 85 : 70;
        if (syntheticConfidence < autoConfig.minConfidence) continue;
        const sigKey = `scanner-${scanSig.id}`;
        if (processedSignalsRef.current.has(sigKey)) continue;
        if (!activeExchange.tradeAllSymbols && activeExchange.selectedSymbols.length > 0) {
          const base = scanSig.symbol.replace('USDT', '');
          if (!activeExchange.selectedSymbols.includes(base)) continue;
        }
        const aiSig: AITradeSignal = {
          id: `scanner-${scanSig.id}`,
          symbol: scanSig.symbol,
          action: scanSig.signalType === 'pump' ? 'buy' : 'sell',
          confidence: syntheticConfidence,
          strategy: 'balanced',
          entryPrice: scanSig.suggestedEntry,
          targetPrice: scanSig.suggestedTarget,
          stopLoss: scanSig.suggestedStopLoss,
          leverage: settings.leverage,
          reasoning: scanSig.reason,
          indicators: [],
          timestamp: new Date(scanSig.detectedAt).getTime(),
          timeframe: scanSig.timeframe,
          riskReward: 2,
        };
        eligibleSignals.push(aiSig);
      }
    }

    if (eligibleSignals.length > 0) {
      const best = eligibleSignals.sort((a, b) => b.confidence - a.confidence)[0];
      const sigKey = `${best.id}-${best.action}`;
      processedSignalsRef.current.add(sigKey);
      if (processedSignalsRef.current.size > 200) {
        const arr = Array.from(processedSignalsRef.current);
        processedSignalsRef.current = new Set(arr.slice(-100));
      }
      console.log(`[AutoBot] Found eligible signal: ${best.symbol} ${best.action} ${best.confidence}%`);
      autoBotMutation.mutate(best);
    }
  }, [signals, scannerSignals, tradeMode, autoConfig.enabled, hasApiKeys, autoBotMutation.isPending, activeExchange, autoConfig.minConfidence]);

  const openPositionMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSignal) throw new Error('سیگنال انتخاب نشده');
      if (!hasApiKeys || !activeExchange) throw new Error('API Key وارد نشده');
      const amount = parseFloat(entryAmount);
      if (isNaN(amount) || amount <= 0) throw new Error('مبلغ نامعتبر');
      const leverage = customLeverage ? parseInt(customLeverage, 10) : selectedSignal.leverage;
      const sl = customSL ? parseFloat(customSL) : selectedSignal.stopLoss;
      const tp = customTP ? parseFloat(customTP) : selectedSignal.targetPrice;
      const side = selectedSignal.action === 'buy' ? 'long' : 'short';
      return openRealPosition(activeExchange.apiKey, activeExchange.apiSecret, selectedSignal.symbol, side as 'long' | 'short', amount, leverage, sl, tp);
    },
    onSuccess: () => {
      try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
      Alert.alert('موفق', 'پوزیشن واقعی باز شد!');
      queryClient.invalidateQueries({ queryKey: ['binance-positions'] });
      queryClient.invalidateQueries({ queryKey: ['binance-account'] });
      queryClient.invalidateQueries({ queryKey: ['binance-orders'] });

      if (settings.telegramEnabled && selectedSignal) {
        sendTelegramTradeNotification({
          type: 'open',
          symbol: selectedSignal.symbol,
          side: selectedSignal.action === 'buy' ? 'long' : 'short',
          amount: parseFloat(entryAmount) || 0,
          leverage: selectedSignal.leverage,
          price: selectedSignal.entryPrice,
          exchangeName: EXCHANGES[activeExchange?.exchangeId ?? 'binance']?.name,
          isDemo: false,
        }).catch(() => {});
      }
    },
    onError: (err) => {
      try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); } catch {}
      Alert.alert('خطا', (err as Error).message);
    },
  });

  const closePositionMutation = useMutation({
    mutationFn: async (pos: RealPosition) => {
      if (!activeExchange) throw new Error('صرافی انتخاب نشده');
      const posAmt = pos.side === 'long' ? pos.size : -pos.size;
      return closePosition(activeExchange.apiKey, activeExchange.apiSecret, pos.symbol, posAmt);
    },
    onSuccess: (_data, pos) => {
      try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
      Alert.alert('موفق', 'پوزیشن بسته شد');
      queryClient.invalidateQueries({ queryKey: ['binance-positions'] });
      queryClient.invalidateQueries({ queryKey: ['binance-account'] });

      if (settings.telegramEnabled) {
        sendTelegramTradeNotification({
          type: 'close',
          symbol: pos.symbol,
          side: pos.side,
          amount: 0,
          leverage: pos.leverage,
          price: pos.markPrice,
          pnl: pos.pnl,
          exchangeName: EXCHANGES[activeExchange?.exchangeId ?? 'binance']?.name,
          isDemo: false,
        }).catch(() => {});
      }
    },
    onError: (err) => Alert.alert('خطا', (err as Error).message),
  });

  const updateSLMutation = useMutation({
    mutationFn: async ({ pos, newSL }: { pos: RealPosition; newSL: number }) => {
      if (!activeExchange) throw new Error('صرافی انتخاب نشده');
      return updateStopLoss(activeExchange.apiKey, activeExchange.apiSecret, pos.symbol, pos.side, pos.size, newSL);
    },
    onSuccess: () => {
      Alert.alert('موفق', 'حد ضرر بروزرسانی شد');
      setEditingPos(null);
      queryClient.invalidateQueries({ queryKey: ['binance-orders'] });
    },
    onError: (err) => Alert.alert('خطا', (err as Error).message),
  });

  const updateTPMutation = useMutation({
    mutationFn: async ({ pos, newTP }: { pos: RealPosition; newTP: number }) => {
      if (!activeExchange) throw new Error('صرافی انتخاب نشده');
      return updateTakeProfit(activeExchange.apiKey, activeExchange.apiSecret, pos.symbol, pos.side, pos.size, newTP);
    },
    onSuccess: () => {
      Alert.alert('موفق', 'تارگت بروزرسانی شد');
      setEditingPos(null);
      queryClient.invalidateQueries({ queryKey: ['binance-orders'] });
    },
    onError: (err) => Alert.alert('خطا', (err as Error).message),
  });

  const setTrailingMutation = useMutation({
    mutationFn: async ({ pos, rate }: { pos: RealPosition; rate: number }) => {
      if (!activeExchange) throw new Error('صرافی انتخاب نشده');
      return setTrailingStop(activeExchange.apiKey, activeExchange.apiSecret, pos.symbol, pos.side, pos.size, rate);
    },
    onSuccess: () => {
      Alert.alert('موفق', 'تریل استاپ فعال شد');
      setShowTrailingModal(null);
      queryClient.invalidateQueries({ queryKey: ['binance-orders'] });
    },
    onError: (err) => Alert.alert('خطا', (err as Error).message),
  });

  const handleClosePosition = useCallback((pos: RealPosition) => {
    Alert.alert(
      'بستن پوزیشن واقعی',
      `آیا مطمئنید می‌خواهید پوزیشن ${pos.symbol} را ببندید؟\nسود/زیان: ${pos.pnl >= 0 ? '+' : ''}$${pos.pnl.toFixed(2)}`,
      [
        { text: 'لغو', style: 'cancel' },
        { text: 'بستن فوری', style: 'destructive', onPress: () => closePositionMutation.mutate(pos) },
      ]
    );
  }, [closePositionMutation]);

  const handleConfirmEdit = useCallback(() => {
    if (!editingPos) return;
    const val = parseFloat(editingPos.value);
    if (isNaN(val) || val <= 0) { Alert.alert('خطا', 'مقدار نامعتبر'); return; }
    if (editingPos.field === 'sl') updateSLMutation.mutate({ pos: editingPos.position, newSL: val });
    else if (editingPos.field === 'tp') updateTPMutation.mutate({ pos: editingPos.position, newTP: val });
  }, [editingPos, updateSLMutation, updateTPMutation]);

  const handleSelectSignal = useCallback((sig: AITradeSignal) => {
    setSelectedSignal(sig);
    setCustomSL(sig.stopLoss.toFixed(4));
    setCustomTP(sig.targetPrice.toFixed(4));
    setCustomLeverage(sig.leverage.toString());
    setShowSignalPicker(false);
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
  }, []);

  const handleOpenPosition = useCallback(() => {
    if (!selectedSignal) { Alert.alert('خطا', 'ابتدا یک سیگنال انتخاب کنید'); return; }
    const amount = parseFloat(entryAmount);
    if (isNaN(amount) || amount <= 0) { Alert.alert('خطا', 'مبلغ ورودی نامعتبر'); return; }
    Alert.alert(
      'تایید معامله واقعی',
      `${selectedSignal.action === 'buy' ? '🟢 Long' : '🔴 Short'} ${selectedSignal.symbol.replace('USDT', '/USDT')}\nمبلغ: $${amount}\nاهرم: ${customLeverage || selectedSignal.leverage}x\nحد ضرر: $${customSL || selectedSignal.stopLoss.toFixed(4)}\nتارگت: $${customTP || selectedSignal.targetPrice.toFixed(4)}`,
      [
        { text: 'لغو', style: 'cancel' },
        { text: 'تایید و باز کردن', style: 'default', onPress: () => openPositionMutation.mutate() },
      ]
    );
  }, [selectedSignal, entryAmount, customLeverage, customSL, customTP, openPositionMutation]);

  const handleAddExchange = useCallback(() => {
    if (!newApiKey.trim() || !newApiSecret.trim()) {
      Alert.alert('خطا', 'API Key و Secret الزامی است');
      return;
    }
    if (exchangeConfigs.length >= 2) {
      Alert.alert('خطا', 'حداکثر ۲ صرافی مجاز است');
      return;
    }
    const config: ExchangeConfig = {
      id: `ex-${Date.now()}`,
      exchangeId: newExchangeId,
      apiKey: newApiKey.trim(),
      apiSecret: newApiSecret.trim(),
      enabled: true,
      tradeSource: newTradeSource,
      selectedSymbols: newTradeAllSymbols ? [] : newSelectedSymbols,
      tradeAllSymbols: newTradeAllSymbols,
    };
    const updated = [...exchangeConfigs, config];
    saveExchangeConfigs(updated);
    setNewApiKey('');
    setNewApiSecret('');
    setNewSelectedSymbols([]);
    setNewCoinInput('');
    setShowExchangeForm(false);
    Alert.alert('موفق', `صرافی ${EXCHANGES[newExchangeId].name} اضافه شد`);
  }, [newApiKey, newApiSecret, newExchangeId, newTradeSource, newTradeAllSymbols, exchangeConfigs, saveExchangeConfigs]);

  const handleRemoveExchange = useCallback((idx: number) => {
    Alert.alert('حذف صرافی', 'آیا مطمئنید؟', [
      { text: 'لغو', style: 'cancel' },
      {
        text: 'حذف', style: 'destructive',
        onPress: () => {
          const updated = exchangeConfigs.filter((_, i) => i !== idx);
          saveExchangeConfigs(updated);
          if (activeExchangeIdx >= updated.length) setActiveExchangeIdx(Math.max(0, updated.length - 1));
        },
      },
    ]);
  }, [exchangeConfigs, activeExchangeIdx, saveExchangeConfigs]);

  const handleToggleAutoTrade = useCallback((enabled: boolean) => {
    if (enabled && !hasApiKeys) {
      Alert.alert('خطا', 'ابتدا API صرافی را وارد کنید');
      return;
    }
    if (enabled) {
      Alert.alert(
        'فعال‌سازی ربات',
        `ربات با حداقل ${autoConfig.minConfidence}% اطمینان و حداکثر ${autoConfig.maxOpenPositions} پوزیشن معامله می‌کند.\nحفظ ${autoConfig.preserveCapitalPercent}% سرمایه اولیه.\n\nادامه می‌دهید؟`,
        [
          { text: 'لغو', style: 'cancel' },
          {
            text: 'فعال‌سازی',
            onPress: () => {
              processedSignalsRef.current = new Set();
              saveAutoConfig({ ...autoConfig, enabled: true });
            },
          },
        ]
      );
    } else {
      saveAutoConfig({ ...autoConfig, enabled: false });
    }
  }, [hasApiKeys, autoConfig, saveAutoConfig]);

  const sourceOptions = useMemo(() => [
    { key: 'ai', label: 'تحلیل هوش مصنوعی' },
    { key: 'scanner', label: 'اسکنر سیگنال' },
    { key: 'both', label: 'هر دو (AI + اسکنر)' },
  ], []);

  if (exchangeConfigs.length === 0) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.centerContent}>
        <View style={styles.noApiCard}>
          <Lock size={48} color={colors.dark.accent} />
          <Text style={styles.noApiTitle}>صرافی وارد نشده</Text>
          <Text style={styles.noApiDesc}>
            برای استفاده از ترید واقعی، ابتدا حداقل یک صرافی با API Key فیوچرز اضافه کنید.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.addExchangeBtnLarge, pressed && { opacity: 0.85 }]}
            onPress={() => setShowExchangeForm(true)}
          >
            <Plus size={18} color={colors.dark.background} />
            <Text style={styles.addExchangeBtnLargeText}>افزودن صرافی</Text>
          </Pressable>
        </View>

        <Modal visible={showExchangeForm} transparent animationType="slide">
          <Pressable style={styles.modalOverlay} onPress={() => setShowExchangeForm(false)}>
            <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
              {renderExchangeForm()}
            </View>
          </Pressable>
        </Modal>
      </ScrollView>
    );
  }

  function renderExchangeForm() {
    return (
      <View>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>افزودن صرافی</Text>
          <Pressable onPress={() => setShowExchangeForm(false)}>
            <X size={20} color={colors.dark.textMuted} />
          </Pressable>
        </View>
        <Text style={styles.inputLabel}>انتخاب صرافی</Text>
        <DropdownPicker
          label="صرافی"
          value={newExchangeId}
          options={EXCHANGE_OPTIONS}
          onSelect={(key) => setNewExchangeId(key as ExchangeId)}
          testID="new-exchange-dropdown"
        />
        <View style={styles.spacer} />
        <Text style={styles.inputLabel}>API Key</Text>
        <TextInput
          style={styles.input}
          value={newApiKey}
          onChangeText={setNewApiKey}
          placeholder="API Key صرافی"
          placeholderTextColor={colors.dark.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.inputLabel}>API Secret</Text>
        <TextInput
          style={styles.input}
          value={newApiSecret}
          onChangeText={setNewApiSecret}
          placeholder="API Secret صرافی"
          placeholderTextColor={colors.dark.textMuted}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.inputLabel}>منبع سیگنال</Text>
        <DropdownPicker
          label="منبع"
          value={newTradeSource}
          options={sourceOptions}
          onSelect={(key) => setNewTradeSource(key as TradeSource)}
          testID="new-source-dropdown"
        />
        <View style={styles.spacer} />
        <View style={styles.switchRow}>
          <Switch
            value={newTradeAllSymbols}
            onValueChange={setNewTradeAllSymbols}
            trackColor={{ false: colors.dark.surfaceLight, true: colors.dark.accent + '66' }}
            thumbColor={newTradeAllSymbols ? colors.dark.accent : colors.dark.textMuted}
          />
          <Text style={styles.switchLabel}>ترید روی همه ارزها</Text>
        </View>
        {!newTradeAllSymbols && (
          <View style={styles.specificCoinsBox}>
            <Text style={styles.inputLabel}>ارزهای خاص برای ترید</Text>
            <View style={styles.coinInputRow}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                value={newCoinInput}
                onChangeText={setNewCoinInput}
                placeholder="نماد ارز (مثل BTC, ETH)"
                placeholderTextColor={colors.dark.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <Pressable
                style={styles.addCoinSmallBtn}
                onPress={() => {
                  const coin = newCoinInput.trim().toUpperCase();
                  if (coin && !newSelectedSymbols.includes(coin)) {
                    setNewSelectedSymbols((prev) => [...prev, coin]);
                    setNewCoinInput('');
                  }
                }}
              >
                <Plus size={14} color={colors.dark.background} />
              </Pressable>
            </View>
            {newSelectedSymbols.length > 0 && (
              <View style={styles.selectedCoinsWrap}>
                {newSelectedSymbols.map((coin) => (
                  <Pressable
                    key={coin}
                    style={styles.selectedCoinChip}
                    onPress={() => setNewSelectedSymbols((prev) => prev.filter((c) => c !== coin))}
                  >
                    <Text style={styles.selectedCoinChipText}>{coin}</Text>
                    <X size={10} color={colors.dark.accent} />
                  </Pressable>
                ))}
              </View>
            )}
            {newSelectedSymbols.length === 0 && (
              <Text style={styles.hintText}>حداقل یک ارز اضافه کنید</Text>
            )}
          </View>
        )}
        <View style={styles.spacer} />
        <Pressable
          style={({ pressed }) => [styles.openBtn, pressed && { opacity: 0.85 }]}
          onPress={handleAddExchange}
        >
          <Check size={16} color={colors.dark.background} />
          <Text style={styles.openBtnText}>افزودن صرافی</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.refreshTimerBar}>
        <View style={styles.refreshTimerLeft}>
          <Animated.View style={[styles.liveDot, { opacity: liveIndicator }]} />
          <Text style={styles.liveText}>
            {tradeMode === 'auto' && autoConfig.enabled ? '🤖 ربات فعال' : 'ترید واقعی'}
            {activeExchange ? ` - ${EXCHANGES[activeExchange.exchangeId]?.name ?? ''}` : ''}
          </Text>
        </View>
        <View style={styles.refreshTimerRight}>
          <View style={styles.countdownBadge}>
            <Text style={styles.countdownText}>{countdown}</Text>
          </View>
          <View style={styles.countdownBarTrack}>
            <Animated.View
              style={[
                styles.countdownBarFill,
                {
                  width: countdownBarAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0%', '100%'],
                  }),
                },
              ]}
            />
          </View>
        </View>
      </View>

      {exchangeConfigs.length > 0 && (
        <View style={styles.exchangeTabsRow}>
          {exchangeConfigs.map((ex, idx) => (
            <Pressable
              key={ex.id}
              style={[styles.exchangeTab, idx === activeExchangeIdx && styles.exchangeTabActive]}
              onPress={() => setActiveExchangeIdx(idx)}
            >
              <Text style={[styles.exchangeTabText, idx === activeExchangeIdx && styles.exchangeTabTextActive]}>
                {EXCHANGES[ex.exchangeId]?.name ?? ex.exchangeId}
              </Text>
              <Pressable style={styles.exchangeTabDelete} onPress={() => handleRemoveExchange(idx)}>
                <Trash2 size={12} color={colors.dark.red} />
              </Pressable>
            </Pressable>
          ))}
          {exchangeConfigs.length < 2 && (
            <Pressable style={styles.exchangeTabAdd} onPress={() => setShowExchangeForm(true)}>
              <Plus size={14} color={colors.dark.accent} />
            </Pressable>
          )}
        </View>
      )}

      <View style={styles.modeToggleRow}>
        <Pressable
          style={[styles.modeBtn, tradeMode === 'manual' && styles.modeBtnActive]}
          onPress={() => setTradeMode('manual')}
        >
          <Hand size={16} color={tradeMode === 'manual' ? colors.dark.background : colors.dark.textMuted} />
          <Text style={[styles.modeBtnText, tradeMode === 'manual' && styles.modeBtnTextActive]}>دستی</Text>
        </Pressable>
        <Pressable
          style={[styles.modeBtn, tradeMode === 'auto' && styles.modeBtnActiveBot]}
          onPress={() => setTradeMode('auto')}
        >
          <Bot size={16} color={tradeMode === 'auto' ? colors.dark.background : colors.dark.textMuted} />
          <Text style={[styles.modeBtnText, tradeMode === 'auto' && styles.modeBtnTextActive]}>اتوماتیک (ربات)</Text>
        </Pressable>
      </View>

      {account && (
        <View style={styles.accountCard}>
          <View style={styles.accountRow}>
            <View style={styles.accountItem}>
              <Text style={styles.accountLabel}>موجودی کل</Text>
              <Text style={styles.accountValue}>${parseFloat(account.totalWalletBalance).toFixed(2)}</Text>
            </View>
            <View style={styles.accountDivider} />
            <View style={styles.accountItem}>
              <Text style={styles.accountLabel}>سود/زیان باز</Text>
              <Text style={[styles.accountValue, { color: parseFloat(account.totalUnrealizedProfit) >= 0 ? colors.dark.green : colors.dark.red }]}>
                {parseFloat(account.totalUnrealizedProfit) >= 0 ? '+' : ''}${parseFloat(account.totalUnrealizedProfit).toFixed(2)}
              </Text>
            </View>
            <View style={styles.accountDivider} />
            <View style={styles.accountItem}>
              <Text style={styles.accountLabel}>قابل برداشت</Text>
              <Text style={styles.accountValue}>${parseFloat(account.availableBalance).toFixed(2)}</Text>
            </View>
          </View>
        </View>
      )}

      {accountQuery.isLoading && (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.dark.accent} />
          <Text style={styles.loadingText}>اتصال به صرافی...</Text>
        </View>
      )}

      {accountQuery.error && (
        <View style={styles.errorBox}>
          <AlertTriangle size={14} color={colors.dark.red} />
          <Text style={styles.errorText}>{(accountQuery.error as Error).message}</Text>
        </View>
      )}

      {tradeMode === 'auto' && (
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionHeaderLeft}>
              <Bot size={16} color={colors.dark.accent} />
              <Text style={styles.sectionTitle}>ربات ترید اتوماتیک</Text>
            </View>
            <Switch
              value={autoConfig.enabled}
              onValueChange={handleToggleAutoTrade}
              trackColor={{ false: colors.dark.surfaceLight, true: colors.dark.green + '66' }}
              thumbColor={autoConfig.enabled ? colors.dark.green : colors.dark.textMuted}
            />
          </View>

          {autoConfig.enabled && (
            <View style={styles.botStatusBar}>
              <View style={[styles.botStatusDot, { backgroundColor: colors.dark.green }]} />
              <Text style={styles.botStatusText}>ربات فعال - در حال رصد سیگنال‌ها</Text>
              {autoBotMutation.isPending && (
                <ActivityIndicator size="small" color={colors.dark.accent} />
              )}
            </View>
          )}

          <View style={styles.capitalManagementBox}>
            <View style={styles.capitalHeader}>
              <Shield size={14} color={colors.dark.accent} />
              <Text style={styles.capitalTitle}>مدیریت سرمایه</Text>
            </View>
            <View style={styles.capitalGrid}>
              <View style={styles.capitalItem}>
                <Text style={styles.capitalLabel}>حفظ سرمایه</Text>
                <Text style={styles.capitalValue}>{autoConfig.preserveCapitalPercent}%</Text>
              </View>
              <View style={styles.capitalItem}>
                <Text style={styles.capitalLabel}>حداکثر ریسک</Text>
                <Text style={styles.capitalValue}>{autoConfig.maxRiskPercent}%</Text>
              </View>
              <View style={styles.capitalItem}>
                <Text style={styles.capitalLabel}>حداقل اطمینان</Text>
                <Text style={styles.capitalValue}>{autoConfig.minConfidence}%</Text>
              </View>
              <View style={styles.capitalItem}>
                <Text style={styles.capitalLabel}>حداکثر پوزیشن</Text>
                <Text style={styles.capitalValue}>{autoConfig.maxOpenPositions}</Text>
              </View>
            </View>
          </View>

          <Pressable
            style={styles.settingsToggle}
            onPress={() => setShowAutoSettings(!showAutoSettings)}
          >
            <Settings size={14} color={colors.dark.textSecondary} />
            <Text style={styles.settingsToggleText}>تنظیمات ربات</Text>
            {showAutoSettings ? <ChevronUp size={14} color={colors.dark.textMuted} /> : <ChevronDown size={14} color={colors.dark.textMuted} />}
          </Pressable>

          {showAutoSettings && (
            <View style={styles.autoSettingsBox}>
              <Text style={styles.inputLabel}>حجم هر معامله (USDT)</Text>
              <TextInput
                style={styles.input}
                value={String(autoConfig.entryAmount)}
                onChangeText={(t) => {
                  const val = parseFloat(t) || 0;
                  saveAutoConfig({ ...autoConfig, entryAmount: val });
                }}
                keyboardType="decimal-pad"
                placeholderTextColor={colors.dark.textMuted}
              />
              <Text style={styles.inputLabel}>حداکثر اهرم</Text>
              <TextInput
                style={styles.input}
                value={String(autoConfig.maxLeverage)}
                onChangeText={(t) => {
                  const val = parseInt(t, 10) || 1;
                  saveAutoConfig({ ...autoConfig, maxLeverage: val });
                }}
                keyboardType="number-pad"
                placeholderTextColor={colors.dark.textMuted}
              />
              <Text style={styles.inputLabel}>حداقل درصد اطمینان برای ورود</Text>
              <TextInput
                style={styles.input}
                value={String(autoConfig.minConfidence)}
                onChangeText={(t) => {
                  const val = parseInt(t, 10) || 50;
                  saveAutoConfig({ ...autoConfig, minConfidence: Math.min(100, Math.max(50, val)) });
                }}
                keyboardType="number-pad"
                placeholderTextColor={colors.dark.textMuted}
              />
              <Text style={styles.inputLabel}>حداکثر تعداد پوزیشن باز</Text>
              <TextInput
                style={styles.input}
                value={String(autoConfig.maxOpenPositions)}
                onChangeText={(t) => {
                  const val = parseInt(t, 10) || 1;
                  saveAutoConfig({ ...autoConfig, maxOpenPositions: Math.min(10, Math.max(1, val)) });
                }}
                keyboardType="number-pad"
                placeholderTextColor={colors.dark.textMuted}
              />
              <Text style={styles.inputLabel}>حداکثر ریسک هر معامله (% از کل سرمایه)</Text>
              <TextInput
                style={styles.input}
                value={String(autoConfig.maxRiskPercent)}
                onChangeText={(t) => {
                  const val = parseFloat(t) || 1;
                  saveAutoConfig({ ...autoConfig, maxRiskPercent: Math.min(20, Math.max(1, val)) });
                }}
                keyboardType="decimal-pad"
                placeholderTextColor={colors.dark.textMuted}
              />
              <Text style={styles.inputLabel}>حفظ سرمایه اولیه (% حداقل باقیمانده)</Text>
              <TextInput
                style={styles.input}
                value={String(autoConfig.preserveCapitalPercent)}
                onChangeText={(t) => {
                  const val = parseInt(t, 10) || 50;
                  saveAutoConfig({ ...autoConfig, preserveCapitalPercent: Math.min(95, Math.max(50, val)) });
                }}
                keyboardType="number-pad"
                placeholderTextColor={colors.dark.textMuted}
              />

              {activeExchange && (
                <>
                  <Text style={styles.inputLabel}>منبع سیگنال این صرافی</Text>
                  <DropdownPicker
                    label="منبع سیگنال"
                    value={activeExchange.tradeSource}
                    options={sourceOptions}
                    onSelect={(key) => {
                      const updated = exchangeConfigs.map((ex, i) =>
                        i === activeExchangeIdx ? { ...ex, tradeSource: key as TradeSource } : ex
                      );
                      saveExchangeConfigs(updated);
                    }}
                    testID="exchange-source-dropdown"
                  />
                  <View style={styles.spacer} />
                  <View style={styles.switchRow}>
                    <Switch
                      value={activeExchange.tradeAllSymbols}
                      onValueChange={(val) => {
                        const updated = exchangeConfigs.map((ex, i) =>
                          i === activeExchangeIdx ? { ...ex, tradeAllSymbols: val } : ex
                        );
                        saveExchangeConfigs(updated);
                      }}
                      trackColor={{ false: colors.dark.surfaceLight, true: colors.dark.accent + '66' }}
                      thumbColor={activeExchange.tradeAllSymbols ? colors.dark.accent : colors.dark.textMuted}
                    />
                    <Text style={styles.switchLabel}>ترید روی همه ارزها</Text>
                  </View>
                  {!activeExchange.tradeAllSymbols && (
                    <View style={styles.specificCoinsBox}>
                      <Text style={styles.inputLabel}>ارزهای خاص برای ترید</Text>
                      <View style={styles.coinInputRow}>
                        <TextInput
                          style={[styles.input, { flex: 1, marginBottom: 0 }]}
                          value={newCoinInput}
                          onChangeText={setNewCoinInput}
                          placeholder="نماد ارز (مثل BTC)"
                          placeholderTextColor={colors.dark.textMuted}
                          autoCapitalize="characters"
                          autoCorrect={false}
                        />
                        <Pressable
                          style={styles.addCoinSmallBtn}
                          onPress={() => {
                            const coin = newCoinInput.trim().toUpperCase();
                            if (coin && !activeExchange.selectedSymbols.includes(coin)) {
                              const updated = exchangeConfigs.map((ex, i) =>
                                i === activeExchangeIdx ? { ...ex, selectedSymbols: [...ex.selectedSymbols, coin] } : ex
                              );
                              saveExchangeConfigs(updated);
                              setNewCoinInput('');
                            }
                          }}
                        >
                          <Plus size={14} color={colors.dark.background} />
                        </Pressable>
                      </View>
                      {activeExchange.selectedSymbols.length > 0 && (
                        <View style={styles.selectedCoinsWrap}>
                          {activeExchange.selectedSymbols.map((coin) => (
                            <Pressable
                              key={coin}
                              style={styles.selectedCoinChip}
                              onPress={() => {
                                const updated = exchangeConfigs.map((ex, i) =>
                                  i === activeExchangeIdx ? { ...ex, selectedSymbols: ex.selectedSymbols.filter((c) => c !== coin) } : ex
                                );
                                saveExchangeConfigs(updated);
                              }}
                            >
                              <Text style={styles.selectedCoinChipText}>{coin}</Text>
                              <X size={10} color={colors.dark.accent} />
                            </Pressable>
                          ))}
                        </View>
                      )}
                      {activeExchange.selectedSymbols.length === 0 && (
                        <Text style={styles.hintText}>حداقل یک ارز اضافه کنید</Text>
                      )}
                    </View>
                  )}
                </>
              )}
            </View>
          )}

          {autoLogs.length > 0 && (
            <View style={styles.logsSection}>
              <Pressable style={styles.settingsToggle} onPress={() => setShowAutoLogs(!showAutoLogs)}>
                <BarChart3 size={14} color={colors.dark.blue} />
                <Text style={styles.settingsToggleText}>لاگ ربات ({autoLogs.length})</Text>
                {showAutoLogs ? <ChevronUp size={14} color={colors.dark.textMuted} /> : <ChevronDown size={14} color={colors.dark.textMuted} />}
              </Pressable>
              {showAutoLogs && autoLogs.slice(0, 10).map((log) => (
                <View key={log.id} style={[styles.logItem, log.status === 'failed' && styles.logItemFailed]}>
                  <View style={styles.logHeader}>
                    <View style={[styles.logStatusDot, { backgroundColor: log.status === 'success' ? colors.dark.green : colors.dark.red }]} />
                    <Text style={styles.logSymbol}>{log.symbol.replace('USDT', '')}</Text>
                    <Text style={[styles.logAction, { color: log.action === 'buy' ? colors.dark.green : colors.dark.red }]}>
                      {log.action === 'buy' ? 'Long' : 'Short'}
                    </Text>
                    <Text style={styles.logConfidence}>{log.confidence}%</Text>
                  </View>
                  <Text style={styles.logMessage}>{log.message}</Text>
                  <Text style={styles.logTime}>
                    {new Date(log.timestamp).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {tradeMode === 'manual' && (
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionHeaderLeft}>
              <Zap size={16} color={colors.dark.accent} />
              <Text style={styles.sectionTitle}>باز کردن معامله دستی</Text>
            </View>
            <Bell size={14} color={colors.dark.orange} />
          </View>

          <Pressable style={styles.signalSelector} onPress={() => setShowSignalPicker(true)} testID="signal-selector">
            {selectedSignal ? (
              <View style={styles.selectedSignalRow}>
                <View style={[styles.signalActionBadge, selectedSignal.action === 'buy' ? { backgroundColor: colors.dark.greenDim } : { backgroundColor: colors.dark.redDim }]}>
                  {selectedSignal.action === 'buy' ? <TrendingUp size={14} color={colors.dark.green} /> : <TrendingDown size={14} color={colors.dark.red} />}
                  <Text style={[styles.signalActionText, { color: selectedSignal.action === 'buy' ? colors.dark.green : colors.dark.red }]}>
                    {selectedSignal.action === 'buy' ? 'Long' : 'Short'}
                  </Text>
                </View>
                <Text style={styles.selectedSignalSymbol}>{selectedSignal.symbol.replace('USDT', '/USDT')}</Text>
                <Text style={styles.selectedSignalConfidence}>{selectedSignal.confidence}%</Text>
                <ChevronDown size={14} color={colors.dark.textMuted} />
              </View>
            ) : (
              <View style={styles.signalPlaceholderRow}>
                <Text style={styles.signalPlaceholder}>انتخاب سیگنال از تحلیل AI</Text>
                <ChevronDown size={14} color={colors.dark.textMuted} />
              </View>
            )}
          </Pressable>

          {selectedSignal && (
            <View style={styles.signalPreview}>
              <View style={styles.signalPreviewGrid}>
                <View style={styles.previewItem}>
                  <Text style={styles.previewLabel}>ورود</Text>
                  <Text style={styles.previewValue}>${selectedSignal.entryPrice.toFixed(4)}</Text>
                </View>
                <View style={styles.previewItem}>
                  <Text style={styles.previewLabel}>اطمینان</Text>
                  <Text style={[styles.previewValue, { color: colors.dark.accent }]}>{selectedSignal.confidence}%</Text>
                </View>
                <View style={styles.previewItem}>
                  <Text style={styles.previewLabel}>R:R</Text>
                  <Text style={styles.previewValue}>1:{selectedSignal.riskReward}</Text>
                </View>
              </View>
            </View>
          )}

          <Text style={styles.inputLabel}>حجم ورودی (USDT)</Text>
          <TextInput style={styles.input} value={entryAmount} onChangeText={setEntryAmount} placeholder="50" placeholderTextColor={colors.dark.textMuted} keyboardType="decimal-pad" testID="entry-amount" />

          <View style={styles.inputRow}>
            <View style={styles.inputHalf}>
              <Text style={styles.inputLabel}>اهرم (Leverage)</Text>
              <TextInput style={styles.input} value={customLeverage} onChangeText={setCustomLeverage} placeholder={selectedSignal ? `${selectedSignal.leverage}` : '10'} placeholderTextColor={colors.dark.textMuted} keyboardType="number-pad" testID="custom-leverage" />
            </View>
          </View>

          <View style={styles.inputRow}>
            <View style={styles.inputHalf}>
              <Text style={styles.inputLabel}>حد ضرر (SL)</Text>
              <TextInput style={styles.input} value={customSL} onChangeText={setCustomSL} placeholder={selectedSignal ? `${selectedSignal.stopLoss.toFixed(4)}` : '0'} placeholderTextColor={colors.dark.textMuted} keyboardType="decimal-pad" testID="custom-sl" />
            </View>
            <View style={styles.inputHalf}>
              <Text style={styles.inputLabel}>تارگت (TP)</Text>
              <TextInput style={styles.input} value={customTP} onChangeText={setCustomTP} placeholder={selectedSignal ? `${selectedSignal.targetPrice.toFixed(4)}` : '0'} placeholderTextColor={colors.dark.textMuted} keyboardType="decimal-pad" testID="custom-tp" />
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [styles.openBtn, !selectedSignal && styles.openBtnDisabled, openPositionMutation.isPending && styles.openBtnDisabled, pressed && { opacity: 0.85 }]}
            onPress={handleOpenPosition}
            disabled={!selectedSignal || openPositionMutation.isPending}
            testID="open-real-position"
          >
            {openPositionMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Play size={16} color="#fff" />}
            <Text style={styles.openBtnText}>{openPositionMutation.isPending ? 'در حال اجرا...' : 'باز کردن معامله واقعی'}</Text>
          </Pressable>
        </View>
      )}

      {positions.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionHeaderLeft}>
              <Target size={16} color={colors.dark.green} />
              <Text style={styles.sectionTitle}>پوزیشن‌های فعال ({positions.length})</Text>
            </View>
            {positionsQuery.isFetching && <ActivityIndicator size="small" color={colors.dark.accent} />}
          </View>

          {positions.map((pos) => {
            const posOrders = openOrdersList.filter(o => o.symbol === pos.symbol);
            const slOrder = posOrders.find(o => o.type === 'STOP_MARKET');
            const tpOrder = posOrders.find(o => o.type === 'TAKE_PROFIT_MARKET');
            const tsOrder = posOrders.find(o => o.type === 'TRAILING_STOP_MARKET');

            return (
              <View key={pos.id} style={styles.positionCard}>
                <View style={styles.posHeader}>
                  <View style={styles.posLeft}>
                    <View style={[styles.posSideBadge, pos.side === 'long' ? styles.posSideLong : styles.posSideShort]}>
                      <Text style={[styles.posSideText, { color: pos.side === 'long' ? colors.dark.green : colors.dark.red }]}>
                        {pos.side === 'long' ? 'LONG' : 'SHORT'}
                      </Text>
                    </View>
                    <Text style={styles.posSymbol}>{pos.symbol.replace('USDT', '/USDT')}</Text>
                    <Text style={styles.posLeverage}>{pos.leverage}x</Text>
                  </View>
                  <Pressable style={styles.closeBtn} onPress={() => handleClosePosition(pos)} disabled={closePositionMutation.isPending}>
                    {closePositionMutation.isPending ? (
                      <ActivityIndicator size="small" color={colors.dark.red} />
                    ) : (
                      <>
                        <Square size={12} color={colors.dark.red} />
                        <Text style={styles.closeBtnText}>بستن فوری</Text>
                      </>
                    )}
                  </Pressable>
                </View>

                <View style={styles.posGrid}>
                  <View style={styles.posGridItem}>
                    <Text style={styles.posGridLabel}>ورود</Text>
                    <Text style={styles.posGridValue}>${pos.entryPrice.toFixed(4)}</Text>
                  </View>
                  <View style={styles.posGridItem}>
                    <Text style={styles.posGridLabel}>مارک</Text>
                    <Text style={styles.posGridValue}>${pos.markPrice.toFixed(4)}</Text>
                  </View>
                  <View style={styles.posGridItem}>
                    <Text style={styles.posGridLabel}>سود/زیان</Text>
                    <Text style={[styles.posGridValue, { color: pos.pnl >= 0 ? colors.dark.green : colors.dark.red }]}>
                      {pos.pnl >= 0 ? '+' : ''}${pos.pnl.toFixed(2)}
                    </Text>
                  </View>
                  <View style={styles.posGridItem}>
                    <Text style={styles.posGridLabel}>درصد</Text>
                    <Text style={[styles.posGridValue, { color: pos.pnlPercent >= 0 ? colors.dark.green : colors.dark.red }]}>
                      {pos.pnlPercent >= 0 ? '+' : ''}{pos.pnlPercent.toFixed(2)}%
                    </Text>
                  </View>
                  <View style={styles.posGridItem}>
                    <Text style={styles.posGridLabel}>حجم</Text>
                    <Text style={styles.posGridValue}>{pos.size}</Text>
                  </View>
                  <View style={styles.posGridItem}>
                    <Text style={styles.posGridLabel}>لیکویید</Text>
                    <Text style={[styles.posGridValue, { color: colors.dark.orange }]}>${pos.liquidationPrice.toFixed(4)}</Text>
                  </View>
                </View>

                <View style={styles.ordersRow}>
                  <Pressable style={styles.orderChip} onPress={() => setEditingPos({ position: pos, field: 'sl', value: slOrder ? slOrder.stopPrice : '' })}>
                    <ShieldAlert size={12} color={colors.dark.red} />
                    <Text style={styles.orderChipText}>SL: {slOrder ? `$${parseFloat(slOrder.stopPrice).toFixed(4)}` : 'ندارد'}</Text>
                    <Edit3 size={10} color={colors.dark.textMuted} />
                  </Pressable>
                  <Pressable style={styles.orderChip} onPress={() => setEditingPos({ position: pos, field: 'tp', value: tpOrder ? tpOrder.stopPrice : '' })}>
                    <Target size={12} color={colors.dark.green} />
                    <Text style={styles.orderChipText}>TP: {tpOrder ? `$${parseFloat(tpOrder.stopPrice).toFixed(4)}` : 'ندارد'}</Text>
                    <Edit3 size={10} color={colors.dark.textMuted} />
                  </Pressable>
                  <Pressable style={[styles.orderChip, tsOrder ? styles.orderChipActive : null]} onPress={() => setShowTrailingModal(pos)}>
                    <Activity size={12} color={tsOrder ? colors.dark.accent : colors.dark.textMuted} />
                    <Text style={[styles.orderChipText, tsOrder ? { color: colors.dark.accent } : null]}>
                      {tsOrder ? 'Trail فعال' : 'تریل استاپ'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {positions.length === 0 && !positionsQuery.isLoading && hasApiKeys && (
        <View style={styles.emptyCard}>
          <Target size={32} color={colors.dark.textMuted} />
          <Text style={styles.emptyText}>پوزیشن فعالی ندارید</Text>
          <Text style={styles.emptySubText}>
            {tradeMode === 'auto' ? 'ربات در حال رصد سیگنال‌های مناسب...' : 'ابتدا از بخش دمو تحلیل بگیرید و سپس معامله واقعی باز کنید'}
          </Text>
        </View>
      )}

      <View style={styles.warningBox}>
        <AlertTriangle size={14} color={colors.dark.orange} />
        <Text style={styles.warningText}>
          هشدار: معاملات واقعی با پول واقعی انجام می‌شود. مدیریت ریسک را رعایت کنید.
        </Text>
      </View>

      <Modal visible={showSignalPicker} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => setShowSignalPicker(false)}>
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>انتخاب سیگنال</Text>
              <Pressable onPress={() => setShowSignalPicker(false)}>
                <X size={20} color={colors.dark.textMuted} />
              </Pressable>
            </View>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {activeSignals.length === 0 && (
                <View style={styles.modalEmpty}>
                  <Text style={styles.modalEmptyText}>سیگنال فعالی وجود ندارد. ابتدا از بخش دمو تحلیل AI بگیرید.</Text>
                </View>
              )}
              {activeSignals.map((sig) => (
                <Pressable
                  key={sig.id}
                  style={[styles.signalOption, selectedSignal?.id === sig.id && styles.signalOptionActive]}
                  onPress={() => handleSelectSignal(sig)}
                >
                  <View style={styles.signalOptionHeader}>
                    <View style={[styles.signalActionBadge, sig.action === 'buy' ? { backgroundColor: colors.dark.greenDim } : { backgroundColor: colors.dark.redDim }]}>
                      {sig.action === 'buy' ? <TrendingUp size={12} color={colors.dark.green} /> : <TrendingDown size={12} color={colors.dark.red} />}
                      <Text style={[styles.signalActionText, { color: sig.action === 'buy' ? colors.dark.green : colors.dark.red }]}>
                        {sig.action === 'buy' ? 'Long' : 'Short'}
                      </Text>
                    </View>
                    <Text style={styles.signalOptionSymbol}>{sig.symbol.replace('USDT', '/USDT')}</Text>
                    <Text style={styles.signalOptionConfidence}>{sig.confidence}%</Text>
                  </View>
                  <View style={styles.signalOptionDetails}>
                    <Text style={styles.signalOptionDetail}>ورود: ${sig.entryPrice.toFixed(4)}</Text>
                    <Text style={[styles.signalOptionDetail, { color: colors.dark.green }]}>TP: ${sig.targetPrice.toFixed(4)}</Text>
                    <Text style={[styles.signalOptionDetail, { color: colors.dark.red }]}>SL: ${sig.stopLoss.toFixed(4)}</Text>
                    <Text style={styles.signalOptionDetail}>{sig.leverage}x</Text>
                  </View>
                  <Text style={styles.signalOptionTime}>
                    {new Date(sig.timestamp).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={editingPos !== null} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setEditingPos(null)}>
          <View style={styles.editModal} onStartShouldSetResponder={() => true}>
            <Text style={styles.editModalTitle}>{editingPos?.field === 'sl' ? 'تغییر حد ضرر' : 'تغییر تارگت'}</Text>
            <Text style={styles.editModalSymbol}>{editingPos?.position.symbol.replace('USDT', '/USDT')}</Text>
            <TextInput
              style={styles.editInput}
              value={editingPos?.value ?? ''}
              onChangeText={(text) => { if (editingPos) setEditingPos({ ...editingPos, value: text }); }}
              placeholder="قیمت جدید"
              placeholderTextColor={colors.dark.textMuted}
              keyboardType="decimal-pad"
              autoFocus
            />
            <View style={styles.editBtnRow}>
              <Pressable style={styles.editCancelBtn} onPress={() => setEditingPos(null)}>
                <Text style={styles.editCancelText}>لغو</Text>
              </Pressable>
              <Pressable
                style={styles.editConfirmBtn}
                onPress={handleConfirmEdit}
                disabled={updateSLMutation.isPending || updateTPMutation.isPending}
              >
                {(updateSLMutation.isPending || updateTPMutation.isPending) ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Check size={14} color="#fff" />
                    <Text style={styles.editConfirmText}>تایید</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={showTrailingModal !== null} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setShowTrailingModal(null)}>
          <View style={styles.editModal} onStartShouldSetResponder={() => true}>
            <Text style={styles.editModalTitle}>تریل استاپ</Text>
            <Text style={styles.editModalSymbol}>{showTrailingModal?.symbol.replace('USDT', '/USDT')}</Text>
            <Text style={styles.trailingDesc}>
              نرخ بازگشت (Callback Rate) را بر حسب درصد وارد کنید.
            </Text>
            <TextInput
              style={styles.editInput}
              value={trailingRate}
              onChangeText={setTrailingRate}
              placeholder="1"
              placeholderTextColor={colors.dark.textMuted}
              keyboardType="decimal-pad"
              autoFocus
            />
            <View style={styles.editBtnRow}>
              <Pressable style={styles.editCancelBtn} onPress={() => setShowTrailingModal(null)}>
                <Text style={styles.editCancelText}>لغو</Text>
              </Pressable>
              <Pressable
                style={styles.editConfirmBtn}
                onPress={() => {
                  if (!showTrailingModal) return;
                  const rate = parseFloat(trailingRate);
                  if (isNaN(rate) || rate <= 0 || rate > 5) {
                    Alert.alert('خطا', 'نرخ بازگشت باید بین ۰.۱ تا ۵ باشد');
                    return;
                  }
                  setTrailingMutation.mutate({ pos: showTrailingModal, rate });
                }}
                disabled={setTrailingMutation.isPending}
              >
                {setTrailingMutation.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Check size={14} color="#fff" />
                    <Text style={styles.editConfirmText}>فعال‌سازی</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={showExchangeForm} transparent animationType="slide">
        <Pressable style={styles.modalOverlay} onPress={() => setShowExchangeForm(false)}>
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            {renderExchangeForm()}
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = createThemedStyles(() => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.background,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
  },
  centerContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  refreshTimerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.dark.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.dark.green + '33',
  },
  refreshTimerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  refreshTimerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  countdownBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.dark.green + '22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownText: {
    fontSize: 12,
    fontWeight: '800' as const,
    color: colors.dark.green,
  },
  countdownBarTrack: {
    width: 60,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.dark.border,
    overflow: 'hidden',
  },
  countdownBarFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.dark.green,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.dark.green,
  },
  liveText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  exchangeTabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  exchangeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.dark.surface,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  exchangeTabActive: {
    borderColor: colors.dark.accent + '66',
    backgroundColor: colors.dark.accentDim,
  },
  exchangeTabText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: colors.dark.textMuted,
    flex: 1,
    textAlign: 'center',
  },
  exchangeTabTextActive: {
    color: colors.dark.accent,
  },
  exchangeTabDelete: {
    padding: 4,
  },
  exchangeTabAdd: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.dark.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.dark.accent + '44',
    borderStyle: 'dashed',
  },
  modeToggleRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.dark.surface,
    borderRadius: 12,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: colors.dark.border,
  },
  modeBtnActive: {
    backgroundColor: colors.dark.accent,
    borderColor: colors.dark.accent,
  },
  modeBtnActiveBot: {
    backgroundColor: colors.dark.green,
    borderColor: colors.dark.green,
  },
  modeBtnText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: colors.dark.textMuted,
  },
  modeBtnTextActive: {
    color: colors.dark.background,
  },
  accountCard: {
    backgroundColor: colors.dark.surface,
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.dark.accent + '33',
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  accountItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  accountDivider: {
    width: 1,
    height: 32,
    backgroundColor: colors.dark.border,
  },
  accountLabel: {
    fontSize: 10,
    color: colors.dark.textMuted,
  },
  accountValue: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  loadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 20,
  },
  loadingText: {
    fontSize: 13,
    color: colors.dark.textSecondary,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.dark.redDim,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 12,
    color: colors.dark.red,
    flex: 1,
    textAlign: 'right',
  },
  section: {
    backgroundColor: colors.dark.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  botStatusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.dark.greenDim,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.dark.green + '33',
  },
  botStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  botStatusText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: colors.dark.green,
    flex: 1,
  },
  capitalManagementBox: {
    backgroundColor: colors.dark.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.dark.accent + '22',
  },
  capitalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  capitalTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: colors.dark.accent,
  },
  capitalGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  capitalItem: {
    width: '47%',
    backgroundColor: colors.dark.card,
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    gap: 4,
  },
  capitalLabel: {
    fontSize: 10,
    color: colors.dark.textMuted,
  },
  capitalValue: {
    fontSize: 15,
    fontWeight: '800' as const,
    color: colors.dark.text,
  },
  settingsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.dark.border,
  },
  settingsToggleText: {
    fontSize: 13,
    color: colors.dark.textSecondary,
    flex: 1,
  },
  autoSettingsBox: {
    paddingTop: 10,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  switchLabel: {
    fontSize: 13,
    color: colors.dark.text,
    flex: 1,
    textAlign: 'right',
  },
  spacer: {
    height: 10,
  },
  logsSection: {
    marginTop: 8,
  },
  logItem: {
    backgroundColor: colors.dark.surface,
    borderRadius: 10,
    padding: 10,
    marginTop: 6,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  logItemFailed: {
    borderColor: colors.dark.red + '33',
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  logStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  logSymbol: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  logAction: {
    fontSize: 11,
    fontWeight: '600' as const,
  },
  logConfidence: {
    fontSize: 11,
    color: colors.dark.accent,
    marginLeft: 'auto',
  },
  logMessage: {
    fontSize: 11,
    color: colors.dark.textSecondary,
    textAlign: 'right',
  },
  logTime: {
    fontSize: 10,
    color: colors.dark.textMuted,
    textAlign: 'right',
    marginTop: 4,
  },
  signalSelector: {
    backgroundColor: colors.dark.inputBg,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: colors.dark.border,
    marginBottom: 12,
  },
  selectedSignalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  signalPlaceholderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  signalPlaceholder: {
    fontSize: 13,
    color: colors.dark.textMuted,
    textAlign: 'right',
    flex: 1,
  },
  signalActionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  signalActionText: {
    fontSize: 11,
    fontWeight: '700' as const,
  },
  selectedSignalSymbol: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: colors.dark.text,
    flex: 1,
  },
  selectedSignalConfidence: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.dark.accent,
  },
  signalPreview: {
    backgroundColor: colors.dark.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  signalPreviewGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  previewItem: {
    alignItems: 'center',
    gap: 4,
  },
  previewLabel: {
    fontSize: 10,
    color: colors.dark.textMuted,
  },
  previewValue: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  inputLabel: {
    fontSize: 12,
    color: colors.dark.textSecondary,
    marginBottom: 6,
    textAlign: 'right',
  },
  input: {
    backgroundColor: colors.dark.inputBg,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.dark.text,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.dark.border,
    textAlign: 'right',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  inputHalf: {
    flex: 1,
  },
  openBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dark.accent,
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
    marginTop: 4,
  },
  openBtnDisabled: {
    opacity: 0.5,
  },
  openBtnText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: colors.dark.background,
  },
  positionCard: {
    backgroundColor: colors.dark.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  posHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  posLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  posSideBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  posSideLong: {
    backgroundColor: colors.dark.greenDim,
  },
  posSideShort: {
    backgroundColor: colors.dark.redDim,
  },
  posSideText: {
    fontSize: 11,
    fontWeight: '700' as const,
  },
  posSymbol: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  posLeverage: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: colors.dark.accent,
    backgroundColor: colors.dark.accentDim,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  closeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.dark.redDim,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  closeBtnText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: colors.dark.red,
  },
  posGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  posGridItem: {
    width: '31%',
    backgroundColor: colors.dark.card,
    borderRadius: 8,
    padding: 8,
    alignItems: 'center',
    gap: 2,
  },
  posGridLabel: {
    fontSize: 9,
    color: colors.dark.textMuted,
  },
  posGridValue: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  ordersRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  orderChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.dark.card,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  orderChipActive: {
    borderColor: colors.dark.accent + '55',
    backgroundColor: colors.dark.accentDim,
  },
  orderChipText: {
    fontSize: 10,
    color: colors.dark.textSecondary,
  },
  emptyCard: {
    backgroundColor: colors.dark.card,
    borderRadius: 16,
    padding: 30,
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: colors.dark.textSecondary,
  },
  emptySubText: {
    fontSize: 12,
    color: colors.dark.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.dark.orangeDim,
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
  },
  warningText: {
    fontSize: 12,
    color: colors.dark.orange,
    flex: 1,
    textAlign: 'right',
    lineHeight: 20,
  },
  noApiCard: {
    backgroundColor: colors.dark.card,
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    gap: 16,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
  },
  noApiTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  noApiDesc: {
    fontSize: 13,
    color: colors.dark.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  addExchangeBtnLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.dark.accent,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
    width: '100%',
  },
  addExchangeBtnLargeText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: colors.dark.background,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.dark.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '80%',
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  modalScroll: {
    maxHeight: 500,
  },
  modalEmpty: {
    padding: 30,
    alignItems: 'center',
  },
  modalEmptyText: {
    fontSize: 13,
    color: colors.dark.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  signalOption: {
    backgroundColor: colors.dark.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  signalOptionActive: {
    borderColor: colors.dark.accent + '55',
    backgroundColor: colors.dark.accentDim,
  },
  signalOptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  signalOptionSymbol: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: colors.dark.text,
    flex: 1,
  },
  signalOptionConfidence: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.dark.accent,
  },
  signalOptionDetails: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  signalOptionDetail: {
    fontSize: 11,
    color: colors.dark.textSecondary,
  },
  signalOptionTime: {
    fontSize: 10,
    color: colors.dark.textMuted,
    marginTop: 6,
    textAlign: 'right',
  },
  editModal: {
    backgroundColor: colors.dark.card,
    borderRadius: 20,
    padding: 24,
    margin: 24,
    alignSelf: 'center',
    width: '85%',
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
  },
  editModalTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: colors.dark.text,
    textAlign: 'center',
    marginBottom: 6,
  },
  editModalSymbol: {
    fontSize: 13,
    color: colors.dark.textSecondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  editInput: {
    backgroundColor: colors.dark.inputBg,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.dark.text,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.dark.border,
    textAlign: 'center',
  },
  editBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  editCancelBtn: {
    flex: 1,
    backgroundColor: colors.dark.surface,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  editCancelText: {
    fontSize: 14,
    color: colors.dark.textSecondary,
    fontWeight: '600' as const,
  },
  editConfirmBtn: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.dark.accent,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  editConfirmText: {
    fontSize: 14,
    color: colors.dark.background,
    fontWeight: '700' as const,
  },
  trailingDesc: {
    fontSize: 12,
    color: colors.dark.textSecondary,
    textAlign: 'right',
    lineHeight: 20,
    marginBottom: 14,
  },
  specificCoinsBox: {
    marginTop: 10,
    backgroundColor: colors.dark.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  coinInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  addCoinSmallBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.dark.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedCoinsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  selectedCoinChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark.accentDim,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.dark.accent + '44',
  },
  selectedCoinChipText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: colors.dark.accent,
  },
  hintText: {
    fontSize: 11,
    color: colors.dark.textMuted,
    textAlign: 'right',
    marginTop: 4,
  },
}));
