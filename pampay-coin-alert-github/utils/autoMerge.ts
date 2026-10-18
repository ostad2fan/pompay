/**
 * utils/autoMerge.ts — v1.5.4
 *
 * منطق merge دو لیست پوزیشن بر اساس id — سمت برنامه (sync از سرور):
 *   • آرایه خالی سرور هرگز داده محلی را پاک نمی‌کند (باگ «روشن کردن
 *     سوییچ تلگرام، همه‌چیز پاک شد»).
 *   • نسخه سرور روی id مشترک برنده است (سرور همان پوزیشن را مدیریت
 *     می‌کند)؛ رکوردهای فقط‌محلی (تاریخچه) حفظ می‌شوند؛ موارد جدید سرور
 *     اضافه می‌شوند.
 *
 * فایل جدا (بدون import از react-native) تا با tsc جداگانه کامپایل و در
 * Node تست شود (scripts/test-backtest-engine-154.cjs).
 */

/** merge-by-id: server wins conflicts, local-only records preserved. */
export function mergePositionsById<T extends { id: string }>(local: T[], server: T[]): T[] {
  if (server.length === 0) return local;
  const map = new Map<string, T>();
  for (const p of local) map.set(p.id, p);
  for (const p of server) map.set(p.id, p);
  return Array.from(map.values());
}
