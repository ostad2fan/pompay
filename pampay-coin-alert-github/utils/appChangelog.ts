/**
 * utils/appChangelog.ts — v1.5.15
 *
 * «تغییرات این نسخه» برای مودال بار اول بعد از نصب:
 *   • کلید دیدنِ هر نسخه جدا نگهداری می‌شود (@whatsnew_seen_v<version>)؛
 *   • بعد از رد کردن مودال دیگر برای همان نسخه نمایش داده نمی‌شود؛
 *   • با نصب نسخه بعدی، مودالِ همان نسخه یک بار می‌آید.
 * محتوای هر نسخه را همین‌جا اضافه کنید (فقط نسخه‌هایی که UI دارند).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { APP_VERSION } from './appUpdate';

export interface VersionChanges {
  version: string;
  title: string;
  items: string[];
}

export const CHANGELOG: Record<string, { title: string; items: string[] }> = {
  '1.5.15': {
    title: 'نسخه ۱.۵.۱۵ — رفع زوم و کیفیت عکس + دانلود همیشه آخرین نسخه',
    items: [
      '🖼️ زوم واقعی در نمایشگر تمام‌صفحه عکس: پینچ دو انگشتی تا ۸ برابر (باگ اندروید رفع شد) + دابل‌تپ برای زوم سریع + جابه‌جایی با یک انگشت بعد از زوم',
      '✨ کیفیت عکس سیگنال‌ها بالا رفت: نمایش و عکس تلگرام با نسخه large توییتر؛ دکمه ذخیره، فایل اصلی (original) را در گالری می‌گذارد — اعداد و قیمت‌ها حالا دقیق خوانده می‌شوند',
      '⬇️ رفع باگ دانلود نسخه قدیمی: دکمه بروزرسانی تنظیمات همیشه اول نسخه جدید را چک می‌کند و APK را از «آخرین ریلیز» گیت‌هاب می‌گیرد (دیگر ۱.۵.۱۳ دانلود نمی‌شود)',
      '📋 این مودال: بعد از نصب هر نسخه جدید، تغییراتش را یک بار نشان می‌دهد و با رد کردن دیگر نمی‌آید',
    ],
  },
};

const seenKey = (v: string) => `@whatsnew_seen_v${v}`;

/** آیا مودال «تغییرات نسخه فعلی» هنوز دیده نشده؟ */
export async function shouldShowWhatsNew(version: string = APP_VERSION): Promise<boolean> {
  try {
    if (!CHANGELOG[version]) return false;
    const seen = await AsyncStorage.getItem(seenKey(version));
    return seen !== '1';
  } catch {
    return false;
  }
}

/** رد کردن مودال برای این نسخه (دیگر نشان داده نمی‌شود). */
export async function markWhatsNewSeen(version: string = APP_VERSION): Promise<void> {
  try {
    await AsyncStorage.setItem(seenKey(version), '1');
  } catch {}
}

/** محتوای تغییرات نسخه فعلی (اگر تعریف شده باشد). */
export function getWhatsNew(version: string = APP_VERSION): VersionChanges | null {
  const entry = CHANGELOG[version];
  return entry ? { version, ...entry } : null;
}
