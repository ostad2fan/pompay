# راهنمای آپلود نسخه ۱.۴.۱۵ روی گیتهاب

این فایل‌ها نسبت به نسخه ۱.۴.۱۴ تغییر کرده‌اند (۶ فایل + این راهنما):

```
app.json                                    (نسخه 1.4.15 / code 20)
apk/version.json                            (1.4.15/20 + لینک APK جدید)
apk/PampDumpCoins-v1.4.15.apk               (فایل نصبی جدید)
CHANGES-1.4.15.md                            (گزارش تغییرات)
utils/appUpdate.ts                           (ثابت نسخه)
utils/tgjuHistoryApi.ts                      (نماد دلار برای PnL)
components/LocalAssetsSection.tsx            (ردیف دلار کاغذی + PnL در بالا)
```

(اختیاری: `PampDumpCoins-latest.apk` — همان فایل 1.4.15 با نام latest؛ اگر خواستید، آن را جداگانه با Rename آپلود کنید. زیپ آپدیت برای زیر ماندن از حد ۲۵MB آپلود وب گیتهاب فقط یک نسخه APK دارد.)

## مراحل
1. زیپ `pompay-github-v1.4.15-update.zip` را باز کنید — پوشه `pampay-coin-alert-github` را می‌بینید.
2. در ریپو `ostad2fan/pompay` روی «Add file → Upload files» بزنید.
3. محتویات پوشه را (خود پوشه را نه، فایل‌های داخلش با ساختار کامل مسیر) درگ کنید — فایل‌های هم‌نام Replace می‌شوند.
4. Commit message: `v1.4.15`
5. بعد از آپلود بررسی کنید:
   - `https://raw.githubusercontent.com/ostad2fan/pompay/main/pampay-coin-alert-github/apk/version.json` باید 1.4.15/20 نشان دهد.
   - آپدیت داخل خود اپ (تنظیمات → بررسی آپدیت) نسخه جدید را پیدا می‌کند.
   - لینک دائمی APK: `https://cdn.jsdelivr.net/gh/ostad2fan/pompay@main/pampay-coin-alert-github/apk/PampDumpCoins-v1.4.15.apk`

## نکته
- این نسخه فقط اپ است — تغییری در سرور Railway لازم نیست (بدون ری‌دیپلوی هم کار می‌کند).
- نصب روی ۱.۴.۱۴ / ۱.۴.۱۳ بدون حذف انجام می‌شود (همان کلید امضا).
