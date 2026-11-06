import { getCachedLastTab, type KnownTab, tabToHref } from '@/utils/lastTab';

export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}) {
  if (path === '/') {
    // v1.5.12 — «روی آخرین تب بمونه نره روی تنظیمات باز»: شروع سرد روی «/»
    // به آخرین تبِ ذخیره‌شده هدایت می‌شود (اگر کش آماده باشد). فول‌بک:
    // تنظیمات — و لایه‌ی بازیابیِ (tabs)/_layout هم بعد از mount، تبِ آخر
    // را از AsyncStorage برمی‌گرداند.
    const tab = getCachedLastTab();
    if (tab) {
      return tabToHref(tab);
    }
    return '/settings';
  }
  return path;
}
