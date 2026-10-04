import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
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
} from 'react-native';
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Minus,
  Play,
  Square,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Target,
  ShieldAlert,
  Zap,
  BarChart3,
  DollarSign,
  Clock,
  Award,
  X,
  RefreshCw,
  ArrowRight,
  Activity,
  Timer,
  Bot,
  Hand,
  Layers,
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import colors from '@/constants/colors';
import { createThemedStyles } from '@/utils/themeStyles';
import { useApp } from '@/contexts/AppContext';
import {
  TradingStrategy,
  STRATEGY_CONFIGS,
  AITradeSignal,
  DemoPortfolio,
  ConfluenceBreakdown,
} from '@/types/tradeAi';
import {
  getAITradeSignal,
  createDemoPortfolio,
  openDemoPosition,
  closeDemoPosition,
  updateDemoPositions,
} from '@/utils/tradeAiService';
import { fetchFuturesTickers } from '@/utils/binanceApi';
import { sendTelegramAISignal, sendTelegramTradeNotification } from '@/utils/telegramService';
import DropdownPicker from '@/components/DropdownPicker';

const DEMO_KEY = '@trade_ai_demo';
const SIGNALS_HISTORY_KEY = '@trade_ai_signals';

const STRATEGY_OPTIONS = Object.entries(STRATEGY_CONFIGS).map(([key, val]) => ({
  key,
  label: `${val.name} (${val.nameEn})`,
}));

const POPULAR_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
  'UNIUSDT', 'ATOMUSDT', 'NEARUSDT', 'INJUSDT', 'SUIUSDT',
  'PEPEUSDT', 'WIFUSDT', 'BONKUSDT', 'SHIBUSDT', 'FLOKIUSDT',
];

export default function TradeAiScreen() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { settings } = useApp();
  const [strategy, setStrategy] = useState<TradingStrategy>('balanced');
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');
  const [customSymbol, setCustomSymbol] = useState('');
  const [demoAmount, setDemoAmount] = useState('100');
  const [showPositions, setShowPositions] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedSignal, setExpandedSignal] = useState<string | null>(null);
  const [autoDemoEnabled, setAutoDemoEnabled] = useState(false);
  const [expandedConfluence, setExpandedConfluence] = useState<string | null>(null);
  const autoDemoRef = useRef(false);
  autoDemoRef.current = autoDemoEnabled;

  const [countdown, setCountdown] = useState(3);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const countdownBarAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.05, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const refreshRef = useRef<{ mutate: () => void }>({ mutate: () => {} });
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  const demoQuery = useQuery({
    queryKey: ['trade-ai-demo'],
    queryFn: async () => {
      const stored = await AsyncStorage.getItem(DEMO_KEY);
      if (stored) return JSON.parse(stored) as DemoPortfolio;
      return createDemoPortfolio();
    },
    staleTime: Infinity,
  });

  const signalsQuery = useQuery({
    queryKey: ['trade-ai-signals'],
    queryFn: async () => {
      const stored = await AsyncStorage.getItem(SIGNALS_HISTORY_KEY);
      if (stored) return JSON.parse(stored) as AITradeSignal[];
      return [] as AITradeSignal[];
    },
    staleTime: Infinity,
  });

  const portfolio = demoQuery.data ?? createDemoPortfolio();
  const signalHistory = signalsQuery.data ?? [];

  const saveDemoMutation = useMutation({
    mutationFn: async (p: DemoPortfolio) => {
      await AsyncStorage.setItem(DEMO_KEY, JSON.stringify(p));
      return p;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-ai-demo'] });
    },
  });

  const saveSignalsMutation = useMutation({
    mutationFn: async (signals: AITradeSignal[]) => {
      await AsyncStorage.setItem(SIGNALS_HISTORY_KEY, JSON.stringify(signals.slice(0, 50)));
      return signals;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-ai-signals'] });
    },
  });

  const analyzeSymbolFn = useCallback(async (symbolInput: string): Promise<AITradeSignal> => {
    const cleanSymbol = symbolInput.endsWith('USDT') ? symbolInput : `${symbolInput}USDT`;
    console.log(`[TradeAI] Analyzing ${cleanSymbol}...`);

    const tickers = await fetchFuturesTickers();
    const ticker = tickers.find((t) => t.symbol === cleanSymbol);
    if (!ticker) throw new Error(`ارز ${cleanSymbol} یافت نشد`);

    const currentPrice = parseFloat(ticker.lastPrice);
    const priceChange = parseFloat(ticker.priceChangePercent);
    const volume = parseFloat(ticker.quoteVolume);

    const signal = await getAITradeSignal(cleanSymbol, strategy, currentPrice, priceChange, volume, settings.useVolumeOnlySignals ?? false);
    if (!signal) throw new Error(`AI نتوانست سیگنال برای ${cleanSymbol} تولید کند`);

    if (settings.telegramEnabled && (settings.tradeAiNotifications ?? true)) {
      sendTelegramAISignal(signal).catch(() => {});
    }

    return signal;
  }, [strategy, settings]);

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const raw = customSymbol.trim().toUpperCase() || selectedSymbol;
      const symbols = raw.split(/[,،\s]+/).map((s) => s.trim()).filter(Boolean);

      if (symbols.length === 0) throw new Error('ارزی وارد نشده');

      const allSignals: AITradeSignal[] = [];
      const errors: string[] = [];

      for (const sym of symbols) {
        try {
          const signal = await analyzeSymbolFn(sym);
          allSignals.push(signal);
        } catch (e) {
          errors.push(`${sym}: ${(e as Error).message}`);
          console.log(`[TradeAI] Error analyzing ${sym}:`, e);
        }
      }

      if (allSignals.length === 0) {
        throw new Error(errors.length > 0 ? errors.join('\n') : 'هیچ سیگنالی تولید نشد');
      }

      const updated = [...allSignals, ...signalHistory].slice(0, 50);
      saveSignalsMutation.mutate(updated);

      return allSignals[0];
    },
  });

  const openPositionMutation = useMutation({
    mutationFn: async (signal: AITradeSignal) => {
      const amount = parseFloat(demoAmount);
      if (isNaN(amount) || amount <= 0) throw new Error('مبلغ نامعتبر');
      if (amount > portfolio.balance) throw new Error('موجودی کافی نیست');
      if (signal.action === 'hold') throw new Error('سیگنال hold قابل معامله نیست');

      const updated = openDemoPosition(portfolio, signal, amount);
      saveDemoMutation.mutate(updated);

      if (settings.telegramEnabled) {
        sendTelegramTradeNotification({
          type: 'open',
          symbol: signal.symbol,
          side: signal.action === 'buy' ? 'long' : 'short',
          amount,
          leverage: signal.leverage,
          price: signal.entryPrice,
          isDemo: true,
        }).catch(() => {});
      }

      return updated;
    },
    onSuccess: () => {
      Alert.alert('موفق', 'پوزیشن دمو باز شد');
    },
    onError: (err) => {
      Alert.alert('خطا', err.message);
    },
  });

  const closePositionMutation = useMutation({
    mutationFn: async ({ positionId, price }: { positionId: string; price: number }) => {
      const updated = closeDemoPosition(portfolio, positionId, price, 'manual');
      saveDemoMutation.mutate(updated);
      return updated;
    },
    onSuccess: () => {
      Alert.alert('موفق', 'پوزیشن بسته شد');
    },
  });

  const handleClosePosition = useCallback((positionId: string, currentPrice: number) => {
    Alert.alert('بستن پوزیشن', 'آیا مطمئنید؟', [
      { text: 'لغو', style: 'cancel' },
      {
        text: 'بستن',
        style: 'destructive',
        onPress: () => closePositionMutation.mutate({ positionId, price: currentPrice }),
      },
    ]);
  }, [closePositionMutation]);

  const handleResetDemo = useCallback(() => {
    Alert.alert('ریست دمو', 'تمام پوزیشن‌ها و تاریخچه پاک می‌شود. مطمئنید؟', [
      { text: 'لغو', style: 'cancel' },
      {
        text: 'ریست',
        style: 'destructive',
        onPress: () => {
          const fresh = createDemoPortfolio();
          saveDemoMutation.mutate(fresh);
          saveSignalsMutation.mutate([]);
        },
      },
    ]);
  }, [saveDemoMutation, saveSignalsMutation]);

  const refreshPricesMutation = useMutation({
    mutationFn: async () => {
      if (portfolio.positions.length === 0) return portfolio;
      const tickers = await fetchFuturesTickers();
      const priceMap: Record<string, number> = {};
      for (const t of tickers) {
        priceMap[t.symbol] = parseFloat(t.lastPrice);
      }
      const updated = updateDemoPositions(portfolio, priceMap);
      saveDemoMutation.mutate(updated);
      return updated;
    },
  });

  refreshRef.current = refreshPricesMutation;

  const autoDemoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyzeSymbolFnRef = useRef(analyzeSymbolFn);
  analyzeSymbolFnRef.current = analyzeSymbolFn;
  const portfolioRef = useRef(portfolio);
  portfolioRef.current = portfolio;
  const signalHistoryRef = useRef(signalHistory);
  signalHistoryRef.current = signalHistory;

  useEffect(() => {
    if (!autoDemoEnabled) {
      if (autoDemoIntervalRef.current) {
        clearInterval(autoDemoIntervalRef.current);
        autoDemoIntervalRef.current = null;
      }
      return;
    }

    console.log('[TradeAI] Auto demo trading enabled');

    const runAutoDemoTrade = async () => {
      try {
        const raw = customSymbol.trim().toUpperCase() || selectedSymbol;
        const symbols = raw.split(/[,،\s]+/).map((s) => s.trim()).filter(Boolean);
        if (symbols.length === 0) return;

        const sym = symbols[Math.floor(Math.random() * symbols.length)];
        console.log(`[AutoDemo] Analyzing ${sym}...`);

        const signal = await analyzeSymbolFnRef.current(sym);
        if (!signal) return;

        const currentHistory = signalHistoryRef.current;
        const updatedHistory = [signal, ...currentHistory].slice(0, 50);
        saveSignalsMutation.mutate(updatedHistory);

        if (signal.action !== 'hold' && signal.confidence >= 78) {
          const currentPortfolio = portfolioRef.current;
          const amount = parseFloat(demoAmount) || 100;
          if (amount <= currentPortfolio.balance) {
            const alreadyOpen = currentPortfolio.positions.some((p) => p.symbol === signal.symbol);
            if (!alreadyOpen && currentPortfolio.positions.length < 5) {
              const updatedPortfolio = openDemoPosition(currentPortfolio, signal, amount);
              saveDemoMutation.mutate(updatedPortfolio);
              console.log(`[AutoDemo] Opened demo position: ${signal.symbol} ${signal.action} confidence=${signal.confidence}%`);

              if (settings.telegramEnabled) {
                sendTelegramTradeNotification({
                  type: 'open',
                  symbol: signal.symbol,
                  side: signal.action === 'buy' ? 'long' : 'short',
                  amount,
                  leverage: signal.leverage,
                  price: signal.entryPrice,
                  isDemo: true,
                }).catch(() => {});
              }
            }
          }
        } else {
          console.log(`[AutoDemo] Signal for ${signal.symbol}: ${signal.action} confidence=${signal.confidence}% - skipped (below threshold)`);
        }
      } catch (e) {
        console.log('[AutoDemo] Error:', e);
      }
    };

    runAutoDemoTrade();
    autoDemoIntervalRef.current = setInterval(runAutoDemoTrade, 15000);

    return () => {
      if (autoDemoIntervalRef.current) {
        clearInterval(autoDemoIntervalRef.current);
        autoDemoIntervalRef.current = null;
      }
    };
  }, [autoDemoEnabled, selectedSymbol, customSymbol, demoAmount, settings.telegramEnabled]);

  useEffect(() => {
    let count = 3;
    const interval = setInterval(() => {
      count -= 1;
      if (count <= 0) {
        refreshRef.current.mutate();
        queryClientRef.current.invalidateQueries({ queryKey: ['trade-ai-signals'] });
        queryClientRef.current.invalidateQueries({ queryKey: ['trade-ai-demo'] });
        countdownBarAnim.setValue(1);
        Animated.timing(countdownBarAnim, {
          toValue: 0,
          duration: 3000,
          useNativeDriver: false,
        }).start();
        count = 3;
      }
      setCountdown(count);
    }, 1000);

    countdownBarAnim.setValue(1);
    Animated.timing(countdownBarAnim, {
      toValue: 0,
      duration: 3000,
      useNativeDriver: false,
    }).start();

    return () => clearInterval(interval);
  }, [countdownBarAnim]);

  const symbolOptions = useMemo(
    () => POPULAR_SYMBOLS.map((s) => ({
      key: s,
      label: s.replace('USDT', '/USDT'),
    })),
    []
  );

  const latestSignal = analyzeMutation.data;
  const config = STRATEGY_CONFIGS[strategy];
  const totalPnlPercent = portfolio.initialBalance > 0
    ? ((portfolio.balance + portfolio.positions.reduce((s, p) => s + (p.size * p.currentPrice / p.leverage), 0) - portfolio.initialBalance) / portfolio.initialBalance) * 100
    : 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.refreshTimerBar}>
        <View style={styles.refreshTimerLeft}>
          <Activity size={12} color={colors.dark.green} />
          <Text style={styles.refreshTimerText}>بروزرسانی خودکار</Text>
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

      <View style={styles.heroCard}>
        <View style={styles.heroTop}>
          <Animated.View style={[styles.heroIconWrap, { transform: [{ scale: pulseAnim }] }]}>
            <Brain size={28} color={colors.dark.accent} />
          </Animated.View>
          <View style={styles.heroTextWrap}>
            <Text style={styles.heroTitle}>معامله‌گر هوشمند</Text>
            <Text style={styles.heroSub}>تحلیل بازار با هوش مصنوعی و اندیکاتورهای تکنیکال</Text>
          </View>
        </View>

        <View style={styles.demoBalanceRow}>
          <View style={styles.demoBalanceItem}>
            <Text style={styles.demoBalanceLabel}>موجودی دمو</Text>
            <Text style={styles.demoBalanceValue}>${portfolio.balance.toFixed(2)}</Text>
          </View>
          <View style={styles.demoBalanceDivider} />
          <View style={styles.demoBalanceItem}>
            <Text style={styles.demoBalanceLabel}>سود/زیان کل</Text>
            <Text style={[
              styles.demoBalanceValue,
              { color: totalPnlPercent >= 0 ? colors.dark.green : colors.dark.red },
            ]}>
              {totalPnlPercent >= 0 ? '+' : ''}{totalPnlPercent.toFixed(2)}%
            </Text>
          </View>
          <View style={styles.demoBalanceDivider} />
          <View style={styles.demoBalanceItem}>
            <Text style={styles.demoBalanceLabel}>نرخ برد</Text>
            <Text style={styles.demoBalanceValue}>
              {portfolio.winRate.toFixed(0)}%
            </Text>
          </View>
        </View>

        <View style={styles.demoStatsRow}>
          <View style={styles.demoStatChip}>
            <Award size={12} color={colors.dark.accent} />
            <Text style={styles.demoStatText}>{portfolio.totalTrades} معامله</Text>
          </View>
          <View style={styles.demoStatChip}>
            <Target size={12} color={colors.dark.green} />
            <Text style={styles.demoStatText}>{portfolio.positions.length} پوزیشن باز</Text>
          </View>
          <Pressable style={styles.resetBtn} onPress={handleResetDemo}>
            <RotateCcw size={12} color={colors.dark.red} />
            <Text style={styles.resetBtnText}>ریست</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>انتخاب استراتژی</Text>
        <DropdownPicker
          label="استراتژی معاملاتی"
          value={strategy}
          options={STRATEGY_OPTIONS}
          onSelect={(key) => setStrategy(key as TradingStrategy)}
          testID="strategy-dropdown"
        />
        <View style={styles.strategyInfo}>
          <View style={styles.strategyInfoRow}>
            <ShieldAlert size={12} color={colors.dark.orange} />
            <Text style={styles.strategyInfoText}>{config.description}</Text>
          </View>
          <View style={styles.strategyDetails}>
            <View style={styles.strategyDetail}>
              <Text style={styles.strategyDetailLabel}>حداکثر اهرم</Text>
              <Text style={styles.strategyDetailValue}>{config.maxLeverage}x</Text>
            </View>
            <View style={styles.strategyDetail}>
              <Text style={styles.strategyDetailLabel}>حد ضرر</Text>
              <Text style={styles.strategyDetailValue}>{config.stopLossPercent}%</Text>
            </View>
            <View style={styles.strategyDetail}>
              <Text style={styles.strategyDetailLabel}>TP ضریب</Text>
              <Text style={styles.strategyDetailValue}>{config.takeProfitMultiplier}x</Text>
            </View>
            {config.dcaEnabled && (
              <View style={styles.strategyDetail}>
                <Text style={styles.strategyDetailLabel}>DCA</Text>
                <Text style={[styles.strategyDetailValue, { color: colors.dark.green }]}>فعال</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>انتخاب ارز</Text>
        <DropdownPicker
          label="انتخاب ارز"
          value={selectedSymbol}
          options={symbolOptions}
          onSelect={setSelectedSymbol}
          testID="symbol-dropdown"
        />
        <Text style={styles.orText}>یا نام ارز را وارد کنید:</Text>
        <TextInput
          style={styles.input}
          value={customSymbol}
          onChangeText={setCustomSymbol}
          placeholder="مثال: PEPE, WIF, BONK"
          placeholderTextColor={colors.dark.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          testID="custom-symbol-input"
        />

        <Text style={styles.inputLabel}>مبلغ ورود (دمو - USDT)</Text>
        <TextInput
          style={styles.input}
          value={demoAmount}
          onChangeText={setDemoAmount}
          placeholder="100"
          placeholderTextColor={colors.dark.textMuted}
          keyboardType="decimal-pad"
          testID="demo-amount-input"
        />

        <View style={styles.demoModeRow}>
          <Pressable
            style={[styles.demoModeBtn, !autoDemoEnabled && styles.demoModeBtnActive]}
            onPress={() => setAutoDemoEnabled(false)}
          >
            <Hand size={14} color={!autoDemoEnabled ? colors.dark.background : colors.dark.textMuted} />
            <Text style={[styles.demoModeBtnText, !autoDemoEnabled && styles.demoModeBtnTextActive]}>دستی</Text>
          </Pressable>
          <Pressable
            style={[styles.demoModeBtn, autoDemoEnabled && styles.demoModeBtnActiveAuto]}
            onPress={() => setAutoDemoEnabled(true)}
          >
            <Bot size={14} color={autoDemoEnabled ? '#fff' : colors.dark.textMuted} />
            <Text style={[styles.demoModeBtnText, autoDemoEnabled && { color: '#fff' }]}>اتوماتیک (بک‌تست)</Text>
          </Pressable>
        </View>

        {autoDemoEnabled && (
          <View style={styles.autoDemoInfo}>
            <Bot size={14} color={colors.dark.blue} />
            <Text style={styles.autoDemoInfoText}>
              ربات هر ۳ ثانیه تحلیل می‌کند و سیگنال‌های بالای ۷۸٪ را معامله می‌کند. مناسب برای بک‌تست استراتژی.
            </Text>
          </View>
        )}

        <Pressable
          style={({ pressed }) => [
            styles.analyzeBtn,
            analyzeMutation.isPending && styles.analyzeBtnDisabled,
            pressed && { opacity: 0.85 },
          ]}
          onPress={() => analyzeMutation.mutate()}
          disabled={analyzeMutation.isPending}
          testID="analyze-button"
        >
          {analyzeMutation.isPending ? (
            <ActivityIndicator size="small" color={colors.dark.background} />
          ) : (
            <Brain size={18} color={colors.dark.background} />
          )}
          <Text style={styles.analyzeBtnText}>
            {analyzeMutation.isPending ? 'در حال تحلیل...' : 'تحلیل با AI'}
          </Text>
        </Pressable>

        {analyzeMutation.error && (
          <View style={styles.errorBox}>
            <ShieldAlert size={14} color={colors.dark.red} />
            <Text style={styles.errorText}>{(analyzeMutation.error as Error).message}</Text>
          </View>
        )}
      </View>

      {latestSignal && (
        <View style={[
          styles.signalCard,
          latestSignal.action === 'buy' && styles.signalCardBuy,
          latestSignal.action === 'sell' && styles.signalCardSell,
          latestSignal.action === 'hold' && styles.signalCardHold,
        ]}>
          <View style={styles.signalHeader}>
            <View style={styles.signalHeaderLeft}>
              {latestSignal.action === 'buy' ? (
                <View style={[styles.signalBadge, { backgroundColor: colors.dark.green + '22' }]}>
                  <TrendingUp size={16} color={colors.dark.green} />
                  <Text style={[styles.signalBadgeText, { color: colors.dark.green }]}>خرید (Long)</Text>
                </View>
              ) : latestSignal.action === 'sell' ? (
                <View style={[styles.signalBadge, { backgroundColor: colors.dark.red + '22' }]}>
                  <TrendingDown size={16} color={colors.dark.red} />
                  <Text style={[styles.signalBadgeText, { color: colors.dark.red }]}>فروش (Short)</Text>
                </View>
              ) : (
                <View style={[styles.signalBadge, { backgroundColor: colors.dark.orange + '22' }]}>
                  <Minus size={16} color={colors.dark.orange} />
                  <Text style={[styles.signalBadgeText, { color: colors.dark.orange }]}>صبر کنید</Text>
                </View>
              )}
              <Text style={styles.signalSymbol}>{latestSignal.symbol.replace('USDT', '/USDT')}</Text>
            </View>
            <View style={styles.confidenceBadge}>
              <Text style={styles.confidenceText}>{latestSignal.confidence}%</Text>
              <Text style={styles.confidenceLabel}>اطمینان</Text>
            </View>
          </View>

          <View style={styles.signalGrid}>
            <View style={styles.signalGridItem}>
              <Text style={styles.signalGridLabel}>ورود</Text>
              <Text style={styles.signalGridValue}>${latestSignal.entryPrice.toFixed(4)}</Text>
            </View>
            <View style={styles.signalGridItem}>
              <Text style={styles.signalGridLabel}>هدف</Text>
              <Text style={[styles.signalGridValue, { color: colors.dark.green }]}>
                ${latestSignal.targetPrice.toFixed(4)}
              </Text>
            </View>
            <View style={styles.signalGridItem}>
              <Text style={styles.signalGridLabel}>حد ضرر</Text>
              <Text style={[styles.signalGridValue, { color: colors.dark.red }]}>
                ${latestSignal.stopLoss.toFixed(4)}
              </Text>
            </View>
            <View style={styles.signalGridItem}>
              <Text style={styles.signalGridLabel}>اهرم</Text>
              <Text style={styles.signalGridValue}>{latestSignal.leverage}x</Text>
            </View>
            <View style={styles.signalGridItem}>
              <Text style={styles.signalGridLabel}>R:R</Text>
              <Text style={styles.signalGridValue}>1:{latestSignal.riskReward}</Text>
            </View>
            <View style={styles.signalGridItem}>
              <Text style={styles.signalGridLabel}>تایم‌فریم</Text>
              <Text style={styles.signalGridValue}>{latestSignal.timeframe}</Text>
            </View>
          </View>

          {latestSignal.confluence && (
            <View style={styles.confluenceBox}>
              <Text style={styles.confluenceTitle}>Confluence Score: {Math.round(
                latestSignal.confluence.technical * 0.4 +
                latestSignal.confluence.onChain * 0.25 +
                latestSignal.confluence.sentiment * 0.15 +
                latestSignal.confluence.derivatives * 0.1 +
                latestSignal.confluence.multiTimeframe * 0.1
              )}%</Text>
              {[
                { key: 'technical', label: 'تکنیکال', score: latestSignal.confluence.technical, weight: '40%', color: colors.dark.accent },
                { key: 'onChain', label: 'آنچین', score: latestSignal.confluence.onChain, weight: '25%', color: colors.dark.blue },
                { key: 'sentiment', label: 'سنتیمنت', score: latestSignal.confluence.sentiment, weight: '15%', color: colors.dark.orange },
                { key: 'derivatives', label: 'مشتقات', score: latestSignal.confluence.derivatives, weight: '10%', color: colors.dark.green },
                { key: 'multiTimeframe', label: 'چند تایم‌فریم', score: latestSignal.confluence.multiTimeframe, weight: '10%', color: '#9b59b6' },
              ].map((item) => {
                const isExpanded = expandedConfluence === item.key;
                const details = latestSignal.confluence?.details[item.key as keyof ConfluenceBreakdown['details']] ?? [];
                return (
                  <Pressable key={item.key} onPress={() => setExpandedConfluence(isExpanded ? null : item.key)}>
                    <View style={styles.confluenceRow}>
                      <View style={[styles.confluenceDot, { backgroundColor: item.color }]} />
                      <Text style={styles.confluenceLabel}>{item.label} ({item.weight})</Text>
                      <View style={styles.confluenceBarTrack}>
                        <View style={[styles.confluenceBarFill, { width: `${item.score}%`, backgroundColor: item.color }]} />
                      </View>
                      <Text style={[styles.confluenceScore, { color: item.color }]}>{item.score.toFixed(0)}</Text>
                      {isExpanded ? <ChevronUp size={12} color={colors.dark.textMuted} /> : <ChevronDown size={12} color={colors.dark.textMuted} />}
                    </View>
                    {isExpanded && details.length > 0 && (
                      <View style={styles.confluenceDetails}>
                        {details.map((d, i) => (
                          <Text key={i} style={styles.confluenceDetailText}>• {d}</Text>
                        ))}
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}

          <View style={styles.indicatorsBox}>
            <Pressable onPress={() => setExpandedConfluence(expandedConfluence === 'indicators' ? null : 'indicators')}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.indicatorsTitle}>اندیکاتورها ({latestSignal.indicators.length})</Text>
                {expandedConfluence === 'indicators' ? <ChevronUp size={14} color={colors.dark.textMuted} /> : <ChevronDown size={14} color={colors.dark.textMuted} />}
              </View>
            </Pressable>
            {expandedConfluence === 'indicators' && latestSignal.indicators.map((ind, idx) => (
              <View key={idx} style={styles.indicatorRow}>
                <View style={[
                  styles.indicatorDot,
                  ind.signal === 'bullish' && { backgroundColor: colors.dark.green },
                  ind.signal === 'bearish' && { backgroundColor: colors.dark.red },
                  ind.signal === 'neutral' && { backgroundColor: colors.dark.orange },
                ]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.indicatorName}>{ind.name}</Text>
                  <Text style={{ fontSize: 10, color: colors.dark.textMuted, textAlign: 'right' }}>{ind.description}</Text>
                </View>
                <Text style={[
                  styles.indicatorSignal,
                  ind.signal === 'bullish' && { color: colors.dark.green },
                  ind.signal === 'bearish' && { color: colors.dark.red },
                  ind.signal === 'neutral' && { color: colors.dark.orange },
                ]}>
                  {ind.signal === 'bullish' ? 'صعودی' : ind.signal === 'bearish' ? 'نزولی' : 'خنثی'}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.reasoningBox}>
            <Text style={styles.reasoningTitle}>تحلیل AI</Text>
            <Text style={styles.reasoningText}>{latestSignal.reasoning}</Text>
          </View>

          {latestSignal.action !== 'hold' && (
            <Pressable
              style={({ pressed }) => [
                styles.openPositionBtn,
                latestSignal.action === 'buy' ? styles.openPositionBtnBuy : styles.openPositionBtnSell,
                pressed && { opacity: 0.85 },
              ]}
              onPress={() => openPositionMutation.mutate(latestSignal)}
              disabled={openPositionMutation.isPending}
            >
              {openPositionMutation.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Play size={16} color="#fff" />
              )}
              <Text style={styles.openPositionBtnText}>
                باز کردن پوزیشن دمو (${demoAmount})
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {portfolio.positions.length > 0 && (
        <View style={styles.section}>
          <Pressable
            style={styles.sectionHeaderBtn}
            onPress={() => setShowPositions(!showPositions)}
          >
            <View style={styles.sectionHeaderLeft}>
              <Zap size={16} color={colors.dark.accent} />
              <Text style={styles.sectionTitle}>پوزیشن‌های باز ({portfolio.positions.length})</Text>
            </View>
            <View style={styles.sectionHeaderRight}>
              <Pressable style={styles.refreshSmallBtn} onPress={() => refreshPricesMutation.mutate()}>
                {refreshPricesMutation.isPending ? (
                  <ActivityIndicator size="small" color={colors.dark.accent} />
                ) : (
                  <RefreshCw size={14} color={colors.dark.accent} />
                )}
              </Pressable>
              {showPositions ? (
                <ChevronUp size={16} color={colors.dark.textMuted} />
              ) : (
                <ChevronDown size={16} color={colors.dark.textMuted} />
              )}
            </View>
          </Pressable>

          {showPositions && portfolio.positions.map((pos) => (
            <View key={pos.id} style={styles.positionCard}>
              <View style={styles.positionHeader}>
                <View style={styles.positionLeft}>
                  <View style={[
                    styles.sideBadge,
                    pos.side === 'long' ? styles.sideBadgeLong : styles.sideBadgeShort,
                  ]}>
                    <Text style={[
                      styles.sideBadgeText,
                      pos.side === 'long' ? { color: colors.dark.green } : { color: colors.dark.red },
                    ]}>
                      {pos.side === 'long' ? 'LONG' : 'SHORT'}
                    </Text>
                  </View>
                  <Text style={styles.positionSymbol}>
                    {pos.symbol.replace('USDT', '/USDT')}
                  </Text>
                  <Text style={styles.positionLeverage}>{pos.leverage}x</Text>
                </View>
                <Pressable
                  style={styles.closePositionBtn}
                  onPress={() => handleClosePosition(pos.id, pos.currentPrice)}
                >
                  <X size={14} color={colors.dark.red} />
                </Pressable>
              </View>
              <View style={styles.positionDetails}>
                <View style={styles.positionDetail}>
                  <Text style={styles.positionDetailLabel}>ورود</Text>
                  <Text style={styles.positionDetailValue}>${pos.entryPrice.toFixed(4)}</Text>
                </View>
                <View style={styles.positionDetail}>
                  <Text style={styles.positionDetailLabel}>فعلی</Text>
                  <Text style={styles.positionDetailValue}>${pos.currentPrice.toFixed(4)}</Text>
                </View>
                <View style={styles.positionDetail}>
                  <Text style={styles.positionDetailLabel}>سود/زیان</Text>
                  <Text style={[
                    styles.positionDetailValue,
                    { color: pos.pnl >= 0 ? colors.dark.green : colors.dark.red },
                  ]}>
                    {pos.pnl >= 0 ? '+' : ''}${pos.pnl.toFixed(2)} ({pos.pnlPercent.toFixed(2)}%)
                  </Text>
                </View>
              </View>
              <View style={styles.positionTargets}>
                <View style={styles.positionTarget}>
                  <Target size={10} color={colors.dark.green} />
                  <Text style={styles.positionTargetText}>TP: ${pos.takeProfit.toFixed(4)}</Text>
                </View>
                <View style={styles.positionTarget}>
                  <ShieldAlert size={10} color={colors.dark.red} />
                  <Text style={styles.positionTargetText}>SL: ${pos.stopLoss.toFixed(4)}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      {signalHistory.length > 0 && (
        <View style={styles.section}>
          <Pressable
            style={styles.sectionHeaderBtn}
            onPress={() => setShowHistory(!showHistory)}
          >
            <View style={styles.sectionHeaderLeft}>
              <Clock size={16} color={colors.dark.blue} />
              <Text style={styles.sectionTitle}>تاریخچه سیگنال‌ها ({signalHistory.length})</Text>
            </View>
            {showHistory ? (
              <ChevronUp size={16} color={colors.dark.textMuted} />
            ) : (
              <ChevronDown size={16} color={colors.dark.textMuted} />
            )}
          </Pressable>

          {showHistory && signalHistory.slice(0, 10).map((sig) => {
            const isExpanded = expandedSignal === sig.id;
            return (
              <Pressable
                key={sig.id}
                style={styles.historyItem}
                onPress={() => setExpandedSignal(isExpanded ? null : sig.id)}
              >
                <View style={styles.historyHeader}>
                  <View style={[
                    styles.historyAction,
                    sig.action === 'buy' && { backgroundColor: colors.dark.greenDim },
                    sig.action === 'sell' && { backgroundColor: colors.dark.redDim },
                    sig.action === 'hold' && { backgroundColor: colors.dark.orangeDim },
                  ]}>
                    <Text style={[
                      styles.historyActionText,
                      sig.action === 'buy' && { color: colors.dark.green },
                      sig.action === 'sell' && { color: colors.dark.red },
                      sig.action === 'hold' && { color: colors.dark.orange },
                    ]}>
                      {sig.action === 'buy' ? 'خرید' : sig.action === 'sell' ? 'فروش' : 'صبر'}
                    </Text>
                  </View>
                  <Text style={styles.historySymbol}>{sig.symbol.replace('USDT', '')}</Text>
                  <Text style={styles.historyConfidence}>{sig.confidence}%</Text>
                  <Text style={styles.historyTime}>
                    {new Date(sig.timestamp).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                  {isExpanded ? (
                    <ChevronUp size={14} color={colors.dark.textMuted} />
                  ) : (
                    <ChevronDown size={14} color={colors.dark.textMuted} />
                  )}
                </View>
                {isExpanded && (
                  <View style={styles.historyExpanded}>
                    <Text style={styles.historyReasoning}>{sig.reasoning}</Text>
                    <View style={styles.historyPrices}>
                      <Text style={styles.historyPrice}>ورود: ${sig.entryPrice.toFixed(4)}</Text>
                      <Text style={[styles.historyPrice, { color: colors.dark.green }]}>
                        هدف: ${sig.targetPrice.toFixed(4)}
                      </Text>
                      <Text style={[styles.historyPrice, { color: colors.dark.red }]}>
                        SL: ${sig.stopLoss.toFixed(4)}
                      </Text>
                    </View>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      )}

      {portfolio.closedTrades.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeaderLeft}>
            <BarChart3 size={16} color={colors.dark.accent} />
            <Text style={styles.sectionTitle}>عملکرد معاملات</Text>
          </View>

          <View style={styles.performanceGrid}>
            <View style={styles.performanceItem}>
              <Text style={styles.performanceLabel}>کل معاملات</Text>
              <Text style={styles.performanceValue}>{portfolio.totalTrades}</Text>
            </View>
            <View style={styles.performanceItem}>
              <Text style={styles.performanceLabel}>نرخ برد</Text>
              <Text style={[styles.performanceValue, { color: colors.dark.green }]}>
                {portfolio.winRate.toFixed(1)}%
              </Text>
            </View>
            <View style={styles.performanceItem}>
              <Text style={styles.performanceLabel}>سود/زیان کل</Text>
              <Text style={[
                styles.performanceValue,
                { color: portfolio.totalPnl >= 0 ? colors.dark.green : colors.dark.red },
              ]}>
                {portfolio.totalPnl >= 0 ? '+' : ''}${portfolio.totalPnl.toFixed(2)}
              </Text>
            </View>
            <View style={styles.performanceItem}>
              <Text style={styles.performanceLabel}>بهترین معامله</Text>
              <Text style={[styles.performanceValue, { color: colors.dark.green }]}>
                +${Math.max(0, ...portfolio.closedTrades.map((t) => t.pnl)).toFixed(2)}
              </Text>
            </View>
          </View>

          {portfolio.closedTrades.slice(-5).reverse().map((trade) => (
            <View key={trade.id} style={styles.tradeRow}>
              <View style={styles.tradeRowLeft}>
                <View style={[
                  styles.sideBadgeSmall,
                  trade.side === 'long' ? styles.sideBadgeLong : styles.sideBadgeShort,
                ]}>
                  <Text style={[
                    styles.sideBadgeSmallText,
                    { color: trade.side === 'long' ? colors.dark.green : colors.dark.red },
                  ]}>
                    {trade.side === 'long' ? 'L' : 'S'}
                  </Text>
                </View>
                <Text style={styles.tradeSymbol}>{trade.symbol.replace('USDT', '')}</Text>
              </View>
              <Text style={[
                styles.tradePnl,
                { color: trade.pnl >= 0 ? colors.dark.green : colors.dark.red },
              ]}>
                {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
              </Text>
              <Text style={styles.tradeTime}>
                {new Date(trade.closedAt).toLocaleDateString('fa-IR', { month: 'short', day: 'numeric' })}
              </Text>
            </View>
          ))}
        </View>
      )}

      <Pressable
        style={({ pressed }) => [
          styles.realTradeBtn,
          pressed && { opacity: 0.85 },
        ]}
        onPress={() => router.push('/trade-ai/real-trade')}
        testID="go-real-trade"
      >
        <View style={styles.realTradeBtnLeft}>
          <Zap size={18} color="#fff" />
          <View>
            <Text style={styles.realTradeBtnTitle}>ترید واقعی</Text>
            <Text style={styles.realTradeBtnSub}>معامله واقعی با API صرافی</Text>
          </View>
        </View>
        <ArrowRight size={18} color="#fff" />
      </Pressable>

      <View style={styles.disclaimer}>
        <Text style={styles.disclaimerText}>
          ⚠️ این بخش فقط حالت دمو (شبیه‌سازی) است. معاملات واقعی انجام نمی‌شود. تحلیل‌های AI صرفاً جنبه آموزشی دارند.
        </Text>
      </View>
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
  heroCard: {
    backgroundColor: colors.dark.surface,
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.dark.accent + '33',
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  heroIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.dark.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTextWrap: {
    flex: 1,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: colors.dark.text,
    marginBottom: 4,
  },
  heroSub: {
    fontSize: 12,
    color: colors.dark.textSecondary,
    lineHeight: 18,
  },
  demoBalanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  demoBalanceItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  demoBalanceDivider: {
    width: 1,
    height: 30,
    backgroundColor: colors.dark.border,
  },
  demoBalanceLabel: {
    fontSize: 10,
    color: colors.dark.textMuted,
  },
  demoBalanceValue: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  demoStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  demoStatChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.dark.card,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  demoStatText: {
    fontSize: 11,
    color: colors.dark.textSecondary,
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 'auto',
    backgroundColor: colors.dark.redDim,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  resetBtnText: {
    fontSize: 11,
    color: colors.dark.red,
    fontWeight: '600' as const,
  },
  section: {
    backgroundColor: colors.dark.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.dark.cardBorder,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: colors.dark.text,
    marginBottom: 12,
    textAlign: 'right',
  },
  sectionHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  refreshSmallBtn: {
    padding: 4,
  },
  strategyInfo: {
    marginTop: 10,
    backgroundColor: colors.dark.surface,
    borderRadius: 12,
    padding: 12,
  },
  strategyInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  strategyInfoText: {
    fontSize: 12,
    color: colors.dark.textSecondary,
    flex: 1,
    textAlign: 'right',
  },
  strategyDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  strategyDetail: {
    backgroundColor: colors.dark.card,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: 'center',
  },
  strategyDetailLabel: {
    fontSize: 9,
    color: colors.dark.textMuted,
    marginBottom: 2,
  },
  strategyDetailValue: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: colors.dark.accent,
  },
  orText: {
    fontSize: 12,
    color: colors.dark.textMuted,
    textAlign: 'center',
    marginVertical: 8,
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
  analyzeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dark.accent,
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
  },
  analyzeBtnDisabled: {
    opacity: 0.6,
  },
  analyzeBtnText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: colors.dark.background,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.dark.redDim,
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
  },
  errorText: {
    fontSize: 12,
    color: colors.dark.red,
    flex: 1,
    textAlign: 'right',
  },
  signalCard: {
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1.5,
  },
  signalCardBuy: {
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.green + '44',
  },
  signalCardSell: {
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.red + '44',
  },
  signalCardHold: {
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.orange + '44',
  },
  signalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  signalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  signalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  signalBadgeText: {
    fontSize: 13,
    fontWeight: '700' as const,
  },
  signalSymbol: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  confidenceBadge: {
    alignItems: 'center',
    backgroundColor: colors.dark.accentDim,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  confidenceText: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: colors.dark.accent,
  },
  confidenceLabel: {
    fontSize: 9,
    color: colors.dark.textMuted,
  },
  signalGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  signalGridItem: {
    width: '30%',
    backgroundColor: colors.dark.surface,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    gap: 4,
  },
  signalGridLabel: {
    fontSize: 10,
    color: colors.dark.textMuted,
  },
  signalGridValue: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  indicatorsBox: {
    backgroundColor: colors.dark.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  indicatorsTitle: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: colors.dark.textSecondary,
    textAlign: 'right',
    marginBottom: 8,
  },
  indicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  indicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  indicatorName: {
    flex: 1,
    fontSize: 12,
    color: colors.dark.text,
  },
  indicatorSignal: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  reasoningBox: {
    backgroundColor: colors.dark.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  reasoningTitle: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: colors.dark.accent,
    marginBottom: 6,
    textAlign: 'right',
  },
  reasoningText: {
    fontSize: 13,
    color: colors.dark.text,
    lineHeight: 22,
    textAlign: 'right',
  },
  openPositionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  openPositionBtnBuy: {
    backgroundColor: colors.dark.green,
  },
  openPositionBtnSell: {
    backgroundColor: colors.dark.red,
  },
  openPositionBtnText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#fff',
  },
  positionCard: {
    backgroundColor: colors.dark.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  positionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  positionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sideBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  sideBadgeLong: {
    backgroundColor: colors.dark.greenDim,
  },
  sideBadgeShort: {
    backgroundColor: colors.dark.redDim,
  },
  sideBadgeText: {
    fontSize: 11,
    fontWeight: '700' as const,
  },
  sideBadgeSmall: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  sideBadgeSmallText: {
    fontSize: 10,
    fontWeight: '700' as const,
  },
  positionSymbol: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  positionLeverage: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: colors.dark.accent,
    backgroundColor: colors.dark.accentDim,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  closePositionBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: colors.dark.redDim,
  },
  positionDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  positionDetail: {
    alignItems: 'center',
    gap: 2,
  },
  positionDetailLabel: {
    fontSize: 10,
    color: colors.dark.textMuted,
  },
  positionDetailValue: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  positionTargets: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
  },
  positionTarget: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  positionTargetText: {
    fontSize: 10,
    color: colors.dark.textMuted,
  },
  historyItem: {
    backgroundColor: colors.dark.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  historyAction: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  historyActionText: {
    fontSize: 11,
    fontWeight: '700' as const,
  },
  historySymbol: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: colors.dark.text,
    flex: 1,
  },
  historyConfidence: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: colors.dark.accent,
  },
  historyTime: {
    fontSize: 10,
    color: colors.dark.textMuted,
  },
  historyExpanded: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.dark.border,
  },
  historyReasoning: {
    fontSize: 12,
    color: colors.dark.textSecondary,
    lineHeight: 20,
    textAlign: 'right',
    marginBottom: 8,
  },
  historyPrices: {
    flexDirection: 'row',
    gap: 12,
  },
  historyPrice: {
    fontSize: 11,
    color: colors.dark.textMuted,
  },
  performanceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
    marginBottom: 12,
  },
  performanceItem: {
    width: '47%',
    backgroundColor: colors.dark.surface,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    gap: 4,
  },
  performanceLabel: {
    fontSize: 10,
    color: colors.dark.textMuted,
  },
  performanceValue: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: colors.dark.text,
  },
  tradeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.dark.border,
    gap: 10,
  },
  tradeRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  tradeSymbol: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.dark.text,
  },
  tradePnl: {
    fontSize: 13,
    fontWeight: '700' as const,
  },
  tradeTime: {
    fontSize: 10,
    color: colors.dark.textMuted,
  },
  realTradeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.dark.green,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  realTradeBtnLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  realTradeBtnTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#fff',
  },
  realTradeBtnSub: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 2,
  },
  disclaimer: {
    backgroundColor: colors.dark.orangeDim,
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
  },
  disclaimerText: {
    fontSize: 12,
    color: colors.dark.orange,
    textAlign: 'right',
    lineHeight: 20,
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
    gap: 6,
  },
  refreshTimerText: {
    fontSize: 11,
    color: colors.dark.green,
    fontWeight: '600' as const,
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
  demoModeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  demoModeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.dark.surface,
    borderWidth: 1,
    borderColor: colors.dark.border,
  },
  demoModeBtnActive: {
    backgroundColor: colors.dark.accent,
    borderColor: colors.dark.accent,
  },
  demoModeBtnActiveAuto: {
    backgroundColor: colors.dark.blue,
    borderColor: colors.dark.blue,
  },
  demoModeBtnText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: colors.dark.textMuted,
  },
  demoModeBtnTextActive: {
    color: colors.dark.background,
  },
  autoDemoInfo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.dark.blueDim,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  autoDemoInfoText: {
    fontSize: 11,
    color: colors.dark.blue,
    flex: 1,
    lineHeight: 18,
    textAlign: 'right',
  },
  confluenceBox: {
    backgroundColor: colors.dark.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  confluenceTitle: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: colors.dark.accent,
    textAlign: 'right',
    marginBottom: 10,
  },
  confluenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  confluenceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  confluenceLabel: {
    fontSize: 11,
    color: colors.dark.textSecondary,
    width: 80,
  },
  confluenceBarTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.dark.card,
    overflow: 'hidden',
  },
  confluenceBarFill: {
    height: 6,
    borderRadius: 3,
  },
  confluenceScore: {
    fontSize: 12,
    fontWeight: '700' as const,
    width: 28,
    textAlign: 'center',
  },
  confluenceDetails: {
    paddingLeft: 14,
    paddingBottom: 6,
    gap: 2,
  },
  confluenceDetailText: {
    fontSize: 10,
    color: colors.dark.textMuted,
    lineHeight: 16,
    textAlign: 'right',
  },
}));
