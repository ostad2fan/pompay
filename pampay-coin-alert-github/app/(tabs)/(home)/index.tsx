import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  Animated,
  RefreshControl,
} from 'react-native';
import { Radar, Play, Square, AlertTriangle, TrendingUp, TrendingDown, BarChart3 } from 'lucide-react-native';
import colors from '@/constants/colors';
import { createThemedStyles } from '@/utils/themeStyles';
import { useApp } from '@/contexts/AppContext';
import SignalCard from '@/components/SignalCard';
import EmptyState from '@/components/EmptyState';
import { TradeSignal, SignalType } from '@/types/crypto';

type FilterType = SignalType | 'all';

export default function HomeScreen() {
  const {
    signals,
    pumpCount,
    dumpCount,
    activeFilter,
    setActiveFilter,
    isScanning,
    scanError,
    lastScanTime,
    scan,
    startAutoScan,
    stopAutoScan,
    settings,
  } = useApp();

  // Auto mode is persisted in settings — survives app restarts (a previous
  // bug: the button always reset to OFF after reopening the app).
  const autoScanActive = settings.autoScanEnabled === true;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isScanning) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.6,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isScanning]);

  const handleToggleAutoScan = () => {
    if (autoScanActive) {
      stopAutoScan();
    } else {
      startAutoScan();
    }
  };

  const filters: { key: FilterType; label: string; color: string; icon: React.ReactNode }[] = [
    {
      key: 'all',
      label: 'همه',
      color: colors.dark.accent,
      icon: <BarChart3 size={13} color={activeFilter === 'all' ? colors.dark.background : colors.dark.textSecondary} />,
    },
    {
      key: 'pump',
      label: `پامپ (${pumpCount})`,
      color: colors.dark.green,
      icon: <TrendingUp size={13} color={activeFilter === 'pump' ? colors.dark.background : colors.dark.green} />,
    },
    {
      key: 'dump',
      label: `دامپ (${dumpCount})`,
      color: colors.dark.red,
      icon: <TrendingDown size={13} color={activeFilter === 'dump' ? colors.dark.background : colors.dark.red} />,
    },
  ];

  const renderItem = ({ item, index }: { item: TradeSignal; index: number }) => (
    <SignalCard signal={item} index={index} />
  );

  const keyExtractor = (item: TradeSignal) => item.id;

  return (
    <View style={styles.container}>
      <View style={styles.controlBar}>
        <Pressable
          style={({ pressed }) => [
            styles.scanButton,
            pressed && styles.scanButtonPressed,
            isScanning && styles.scanButtonActive,
          ]}
          onPress={scan}
          disabled={isScanning}
          testID="scan-button"
        >
          {isScanning ? (
            <Animated.View style={{ opacity: pulseAnim }}>
              <ActivityIndicator size="small" color={colors.dark.background} />
            </Animated.View>
          ) : (
            <Radar size={18} color={colors.dark.background} />
          )}
          <Text style={styles.scanButtonText}>
            {isScanning ? 'در حال اسکن...' : 'اسکن'}
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.autoButton,
            autoScanActive && styles.autoButtonActive,
            pressed && styles.autoButtonPressed,
          ]}
          onPress={handleToggleAutoScan}
          testID="auto-scan-button"
        >
          {autoScanActive ? (
            <Square size={14} color={colors.dark.red} />
          ) : (
            <Play size={14} color={colors.dark.green} />
          )}
          <Text
            style={[
              styles.autoButtonText,
              autoScanActive && { color: colors.dark.red },
            ]}
          >
            {autoScanActive ? 'توقف' : 'خودکار'}
          </Text>
        </Pressable>
      </View>

      <View style={styles.filterRow}>
        {filters.map((f) => (
          <Pressable
            key={f.key}
            style={[
              styles.filterChip,
              activeFilter === f.key && { backgroundColor: f.color },
            ]}
            onPress={() => setActiveFilter(f.key)}
            testID={`filter-${f.key}`}
          >
            {f.icon}
            <Text
              style={[
                styles.filterChipText,
                activeFilter === f.key && styles.filterChipTextActive,
              ]}
            >
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {scanError && (
        <View style={styles.errorBanner}>
          <AlertTriangle size={14} color={colors.dark.red} />
          <Text style={styles.errorText}>{scanError}</Text>
        </View>
      )}

      {lastScanTime && (
        <Text style={styles.lastScan}>
          آخرین اسکن: {lastScanTime.toLocaleTimeString('fa-IR')}
          {' • '}
          {signals.length} سیگنال
        </Text>
      )}

      <FlatList
        data={signals}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={signals.length === 0 ? styles.emptyContainer : styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isScanning}
            onRefresh={scan}
            tintColor={colors.dark.accent}
            colors={[colors.dark.accent]}
            progressBackgroundColor={colors.dark.surface}
          />
        }
        ListEmptyComponent={
          !isScanning ? (
            <EmptyState
              title="هنوز سیگنالی نیست"
              subtitle="دکمه اسکن را بزنید تا ارزهای با پتانسیل پامپ و دامپ شناسایی شوند"
            />
          ) : null
        }
        testID="signals-list"
      />
    </View>
  );
}

const styles = createThemedStyles(() => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark.background,
  },
  controlBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  scanButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dark.accent,
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
  },
  scanButtonPressed: {
    opacity: 0.85,
  },
  scanButtonActive: {
    backgroundColor: colors.dark.accent + 'CC',
  },
  scanButtonText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: colors.dark.background,
  },
  autoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: colors.dark.surface,
    borderWidth: 1,
    borderColor: colors.dark.border,
    gap: 6,
  },
  autoButtonActive: {
    borderColor: colors.dark.red + '66',
    backgroundColor: colors.dark.redDim,
  },
  autoButtonPressed: {
    opacity: 0.85,
  },
  autoButtonText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.dark.textSecondary,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 8,
  },
  filterChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: colors.dark.surface,
    borderWidth: 1,
    borderColor: colors.dark.border,
    gap: 5,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: colors.dark.textSecondary,
  },
  filterChipTextActive: {
    color: colors.dark.background,
    fontWeight: '700' as const,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark.redDim,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    gap: 8,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 12,
    color: colors.dark.red,
    flex: 1,
    textAlign: 'right',
  },
  lastScan: {
    fontSize: 11,
    color: colors.dark.textMuted,
    textAlign: 'center',
    marginBottom: 8,
  },
  listContent: {
    paddingBottom: 20,
    paddingTop: 4,
  },
  emptyContainer: {
    flex: 1,
  },
}));
