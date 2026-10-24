import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * lastTab.ts — v1.5.12
 *
 * «وقتی برنامه را باز میکنم از روی تب اسکن نپره رو تب تنظیمات … روی آخرین
 * تب بمونه نره روی تنظیمات باز» — آخرین تبِ فعال کاربر ذخیره و هنگام باز
 * شدن برنامه (سرد یا بعد از خاموش‌شدن صفحه) همان تب بازیابی می‌شود؛ دیگر
 * همیشه روی «تنظیمات» باز نمی‌شود.
 *
 * دو مصرف‌کننده:
 *   1. app/(tabs)/_layout.tsx — با useSegments هر تعویض تب را ذخیره می‌کند
 *      و یک‌بار در هر اجرا تبِ ذخیره‌شده را بازیابی می‌کند.
 *   2. app/+native-intent.tsx — برای مسیر «/» در شروع سرد، اگر کش آماده
 *      باشد همان تب برگردانده می‌شود (فول‌بک: تنظیمات).
 *
 * کش هم‌زمانِ ماژول (synchronous) برای لحظه‌هایی که async await ممکن نیست.
 */

export const LAST_TAB_KEY = '@pompay_last_tab_v1';

/** همه‌ی تب‌های معتبر (نام فایل اسکرین داخل app/(tabs)/). */
export const KNOWN_TABS = [
  'settings',
  'wallet',
  'trade-ai',
  'indicators',
  'whales',
  'pre-listing',
  'meme-scanner',
  '(home)',
] as const;

export type KnownTab = (typeof KNOWN_TABS)[number];

function isKnownTab(v: string): v is KnownTab {
  return (KNOWN_TABS as readonly string[]).includes(v);
}

/** کش هم‌زمان — با setLastTab پر می‌شود و با warmLastTabCache از دیسک. */
let cachedLastTab: KnownTab | null = null;
let warmed = false;

/** در ابتدای لود ماژول layout صدا زده می‌شود تا کش زودتر از ناوبری آماده باشد. */
export function warmLastTabCache(): void {
  if (warmed) return;
  warmed = true;
  AsyncStorage.getItem(LAST_TAB_KEY)
    .then((v) => {
      if (v && isKnownTab(v)) cachedLastTab = v;
    })
    .catch(() => {});
}

export function getCachedLastTab(): KnownTab | null {
  return cachedLastTab;
}

/** ذخیره‌ی تب فعال (کش هم‌زمان + دیسک). ورودی نامعتبر نادیده گرفته می‌شود. */
export async function setLastTab(tab: string): Promise<void> {
  if (!isKnownTab(tab)) return;
  cachedLastTab = tab;
  try {
    await AsyncStorage.setItem(LAST_TAB_KEY, tab);
  } catch {
    // دیسک در دسترس نیست — کش ماژول کافی است.
  }
}

/** href بدون گروهِ تب‌ها برای router.replace (تب (home) مسیرش گروه است). */
export function tabToHref(tab: KnownTab): string {
  return tab === '(home)' ? '/(tabs)/(home)' : `/(tabs)/${tab}`;
}
