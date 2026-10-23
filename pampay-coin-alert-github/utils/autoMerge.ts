/**
 * utils/autoMerge.ts — v1.5.4 → v1.5.11
 *
 * منطق merge دو لیست پوزیشن بر اساس id — سمت برنامه (sync از سرور):
 *   • آرایه خالی سرور هرگز داده محلی را پاک نمی‌کند (باگ «روشن کردن
 *     سوییچ تلگرام، همه‌چیز پاک شد»).
 *   • رکوردهای فقط‌محلی (تاریخچه) حفظ می‌شوند؛ موارد جدید سرور اضافه
 *     می‌شوند.
 *
 * v1.5.11 — «بسته‌شدن، قطعی است» (ریشه‌ی «الارم‌های تکراری با هر رفرش»):
 *   قبلاً نسخه سرور روی id مشترک «بی‌قید و شرط» برنده می‌شد؛ نتیجه:
 *   برنامه پوزیشن را بسته و اعلام می‌کرد → sync نسخه‌ی «بازِ» قدیمیِ سرور
 *   را برمی‌گرداند → چرخه بعدی دوباره می‌بست و دوباره اعلام می‌کرد →
 *   تکرار بی‌نهایتِ همان اعلان + دوبل‌شدن PnL. حالا:
 *   • نسخه «بسته» همیشه بر نسخه «باز» با همان id برنده است (از هر طرفی
 *     که باشد — بسته‌شدن واقعیت است و برگشت‌پذیر نیست).
 *   • بین دو نسخه «بسته»، جدیدترین closedAt برنده است (مساوی → سرور).
 *   • بین دو نسخه «باز»، سرور برنده است (همان رفتار قبلی — سرور همان
 *     پوزیشن را با قیمت/تریل تازه‌تر مدیریت می‌کند).
 *
 * فایل جدا (بدون import از react-native) تا با tsc جداگانه کامپایل و در
 * Node تست شود (scripts/test-v1511.cjs).
 */

interface MergePositionShape {
  id: string;
  status?: string;
  closedAt?: number;
}

/** merge-by-id — v1.5.11: «closed wins», سپس جدیدترین closedAt، سپس سرور. */
export function mergePositionsById<T extends { id: string; status?: string; closedAt?: number }>(
  local: T[],
  server: T[]
): T[] {
  if (server.length === 0) return local;
  const map = new Map<string, T>();
  for (const p of local) map.set(p.id, p);
  for (const s of server) {
    const l = map.get(s.id);
    if (!l) {
      map.set(s.id, s);
      continue;
    }
    const lClosed = l.status === 'closed';
    const sClosed = s.status === 'closed';
    if (lClosed && !sClosed) continue; // بسته‌شدن محلی قطعی است — نسخه باز سرور رد می‌شود
    if (!lClosed && sClosed) {
      map.set(s.id, s); // سرور بسته است — همان واقعیت نهایی است
      continue;
    }
    if (lClosed && sClosed) {
      // هر دو بسته — جدیدترین closedAt (مساوی → سرور)
      const lAt = typeof l.closedAt === 'number' ? l.closedAt : 0;
      const sAt = typeof s.closedAt === 'number' ? s.closedAt : 0;
      map.set(s.id, sAt >= lAt ? s : l);
      continue;
    }
    map.set(s.id, s); // هر دو باز — سرور (رفتار قبلی)
  }
  return Array.from(map.values());
}
