/**
 * allSignalsBackgroundTask.ts — v1.5.18
 *
 * اعلان «بدون سرور» برای همهٔ بخش‌ها حتی وقتی برنامه بسته است:
 * expo-background-fetch هر ≥۱۵ دقیقه گوشی را بیدار می‌کند و یک چرخهٔ
 * «موتور معامله‌گر خودکار + اسکنر پامپ/دامپ» اجرا می‌شود:
 *
 *   • موتور ربات (runGlobalCycleNow): سیگنال‌ها ← معامله دمو/واقعی +
 *     نوتیفیکیشن محلی باز/بستن + اعلام تلگرام مستقیم از خود گوشی
 *     (اگر تلگرام در تنظیمات روشن باشد) — بدون هیچ سروری.
 *   • اسکنر پامپ/دامپ: مثل اسکنِ داخل برنامه (اول بایننس مستقیم از
 *     اینترنت گوشی) و سیگنال جدید → نوتیفیکیشن محلی + (اختیاری) تلگرام.
 *
 * محدودیت صادقانه: اگر برنامه از recents کشیده شود یا قاتل پس‌زمینه
 * فعال باشد، اندروید اجازهٔ بک‌فچ نمی‌دهد؛ آن‌وقت اعلان‌ها با باز شدن
 * برنامه می‌رسند. سرور رله برای هیچ بخشی لازم نیست.
 */

import { Platform } from 'react-native';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TradeSignal, AppSettings } from '@/types/crypto';
import { scanAllSignals } from '@/utils/binanceApi';
import { checkVpnStatus } from '@/utils/vpnGuard';
import { runGlobalCycleNow } from '@/utils/autoTradingEngine';
import { sendTelegramSignalNotification } from '@/utils/telegramService';

export const ALL_SIGNALS_BG_TASK = '@pampay_all_signals_bg_fetch';

const SCANNER_SETTINGS_KEY = '@crypto_scanner_settings';
const SCANNER_SIGNALS_KEY = '@crypto_scanner_signals';

let registered = false;

/** ثبت تسک پس‌زمینه (بهترین‌تلاش — خطا غیرمهلک است). */
export async function registerAllSignalsBackgroundTask(minMinutes = 15): Promise<void> {
  if (Platform.OS === 'web' || registered) return;
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(ALL_SIGNALS_BG_TASK);
    if (!isRegistered) {
      await BackgroundFetch.registerTaskAsync(ALL_SIGNALS_BG_TASK, {
        minimumInterval: Math.max(15, minMinutes) * 60,
        stopOnTerminate: false,
        startOnBoot: true,
      });
      console.log('[AllSignalsBg] background fetch registered (every >=15 min)');
    }
    registered = true;
  } catch (e) {
    console.log('[AllSignalsBg] register failed:', (e as Error).message);
  }
}

async function loadScannerSettings(): Promise<Partial<AppSettings>> {
  try {
    const raw = await AsyncStorage.getItem(SCANNER_SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as Partial<AppSettings>) : {};
  } catch {
    return {};
  }
}

async function loadStoredSignals(): Promise<TradeSignal[]> {
  try {
    const raw = await AsyncStorage.getItem(SCANNER_SIGNALS_KEY);
    return raw ? (JSON.parse(raw) as TradeSignal[]) : [];
  } catch {
    return [];
  }
}

/**
 * چرخهٔ اسکنر پامپ/دامپ — همان منطق اسکن داخل برنامه (dedup روی
 * symbol+signalType)، فقط بایننس مستقیم با اینترنت گوشی؛ بدون سرور.
 */
async function runScannerCycle(): Promise<void> {
  const s = await loadScannerSettings();
  if (s.notificationsEnabled === false) return;
  // با IP ایران اصلاً به بایننس دست نمی‌زنیم (همان قانون داخل برنامه)
  if ((await checkVpnStatus()) === 'iran') return;

  const results = await scanAllSignals(s.volumeThreshold ?? 2.0);
  if (!results || results.length === 0) return;

  const stored = await loadStoredSignals();
  const newSignals = results.filter(
    (r) => !stored.some((x) => x.symbol === r.symbol && x.signalType === r.signalType)
  );

  if (newSignals.length > 0) {
    const pumpCount = newSignals.filter((x) => x.signalType === 'pump').length;
    const dumpCount = newSignals.filter((x) => x.signalType === 'dump').length;
    const names = newSignals
      .slice(0, 4)
      .map((x) => `${x.displayName} (${x.signalType === 'pump' ? 'پامپ' : 'دامپ'})`)
      .join('، ');
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🔔 سیگنال جدید!',
        body: `${pumpCount > 0 ? `${pumpCount} پامپ` : ''}${pumpCount > 0 && dumpCount > 0 ? ' و ' : ''}${dumpCount > 0 ? `${dumpCount} دامپ` : ''} شناسایی شد:\n${names}`,
        sound: 'default',
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1 },
    }).catch(() => {});
    if (s.telegramEnabled && s.scannerNotifications !== false) {
      await sendTelegramSignalNotification(newSignals).catch(() => {});
    }
  }

  await AsyncStorage.setItem(SCANNER_SIGNALS_KEY, JSON.stringify(results)).catch(() => {});
}

if (Platform.OS !== 'web') {
  TaskManager.defineTask(ALL_SIGNALS_BG_TASK, async () => {
    let ran = false;
    try {
      await runGlobalCycleNow();
      ran = true;
    } catch (e) {
      console.log('[AllSignalsBg] engine error:', (e as Error).message);
    }
    try {
      await runScannerCycle();
      ran = true;
    } catch (e) {
      console.log('[AllSignalsBg] scanner error:', (e as Error).message);
    }
    return ran
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  });
}
