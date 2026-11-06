/**
 * socialBackgroundTask.ts — v1.5.14
 *
 * اعلان سیگنال سوشال‌مدیا «بدون سرور» حتی وقتی برنامه در پس‌زمینه است:
 * expo-background-fetch هر ≥۱۵ دقیقه گوشی را بیدار می‌کند، یک چرخه کامل
 * واکشی/فیلتر/اعلان اجرا می‌شود و نوتیفیکیشن محلی داده می‌شود.
 *
 * محدودیت صادقانه (در راهنما هم آمده): اگر کاربر برنامه را از معماری
 * (recents) بکشد یا قاتل پس‌زمینه گوشی فعال باشد، اندروید اجازه اجرای
 * بک‌فچ را نمی‌دهد — در آن حالت کانال تضمینی همان تلگرام است (برای ربات
 * معامله‌گر) و تب سوشال‌مدیا با باز شدن برنامه بروز می‌شود.
 */

import { Platform } from 'react-native';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { runSocialSignalsCycle, loadSocialDisplayFlags } from './socialSignalsService';

export const SOCIAL_BG_TASK = '@social_signals_bg_fetch';

let registered = false;

/** ثبت تسک پس‌زمینه (بهترین‌تلاش — خطا غیرمهلک است). */
export async function registerSocialBackgroundTask(minMinutes = 15): Promise<void> {
  if (Platform.OS === 'web' || registered) return;
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(SOCIAL_BG_TASK);
    if (!isRegistered) {
      await BackgroundFetch.registerTaskAsync(SOCIAL_BG_TASK, {
        minimumInterval: Math.max(15, minMinutes) * 60,
        stopOnTerminate: false,
        startOnBoot: true,
      });
      console.log('[SocialBg] background fetch registered (every >=15 min)');
    }
    registered = true;
  } catch (e) {
    console.log('[SocialBg] register failed:', (e as Error).message);
  }
}

if (Platform.OS !== 'web') {
  TaskManager.defineTask(SOCIAL_BG_TASK, async () => {
    try {
      const { newSignals } = await runSocialSignalsCycle();
      if (newSignals.length > 0) {
        const flags = await loadSocialDisplayFlags();
        for (const sig of newSignals.slice(0, 4)) {
          const tag = sig.tickers.map((t) => `$${t}`).join(' ');
          const nameLine = flags.showSourceName ? `\n👤 @${sig.sourceUser}` : '';
          const linkLine = flags.showLink ? `\n🔗 ${sig.link}` : '';
          await Notifications.scheduleNotificationAsync({
            content: {
              title: `🔵 سیگنال سوشال‌مدیا — ${tag}`,
              body: `${sig.text.slice(0, 160)}${nameLine}${linkLine}`,
              sound: 'default',
            },
            trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1 },
          }).catch(() => {});
        }
        return BackgroundFetch.BackgroundFetchResult.NewData;
      }
      return BackgroundFetch.BackgroundFetchResult.NoData;
    } catch (e) {
      console.log('[SocialBg] task error:', (e as Error).message);
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });
}
