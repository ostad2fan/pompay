# راهنمای آپلود نسخه ۱.۴.۱۶ روی گیتهاب

این فایل‌ها نسبت به نسخه ۱.۴.۱۵ تغییر کرده‌اند (۸ فایل + این راهنما):

```
app.json                                     (نسخه 1.4.16 / code 21)
apk/version.json                             (1.4.16/21 + لینک APK جدید)
apk/PampDumpCoins-v1.4.16.apk                (فایل نصبی جدید)
CHANGES-1.4.16.md                            (گزارش تغییرات)
utils/appUpdate.ts                           (ثابت نسخه)
utils/blockchainWallets.ts                   (جدید — تایپ‌ها/شبکه‌ها/اعتبارسنجی/ذخیره‌سازی)
utils/blockchainWalletApi.ts                 (جدید — موجودی/قیمت/PnL همه شبکه‌ها)
components/BlockchainWalletsSection.tsx      (جدید — UI تب چهارم)
app/(tabs)/wallet/index.tsx                  (تب چهارم + کوئری‌ها + اتصال به تب ریالی)
components/LocalAssetsSection.tsx            (چیدمان جدید + ردیف کیف بلاکچین)
```

(اختیاری: `PampDumpCoins-latest.apk` — همان فایل ۱.۴.۱۶ با نام latest.)

## مراحل
1. زیپ آپدیت را باز کنید — پوشه `pampay-coin-alert-github` را می‌بینید.
2. در ریپو `ostad2fan/pompay` روی «Add file → Upload files» بزنید.
3. محتویات پوشه را (فایل‌های داخلش با ساختار کامل مسیر، نه خود پوشه) درگ کنید — فایل‌های هم‌نام Replace می‌شوند.
4. Commit message: `v1.4.16`
5. بعد از آپلود بررسی کنید:
   - `https://raw.githubusercontent.com/ostad2fan/pompay/main/pampay-coin-alert-github/apk/version.json` باید 1.4.16/21 نشان دهد.
   - آپدیت داخل خود اپ (تنظیمات → بررسی آپدیت) نسخه جدید را پیدا می‌کند.
   - لینک دائمی APK: `https://cdn.jsdelivr.net/gh/ostad2fan/pompay@main/pampay-coin-alert-github/apk/PampDumpCoins-v1.4.16.apk`

## نکته
- این نسخه فقط اپ است — تغییری در سرور Railway لازم نیست (بدون ری‌دیپلوی هم کار می‌کند).
- ⚠️ نسخه ۱.۴.۱۵ روی گیت‌هاب فایل APK هم‌نام نداشت (لینکش خراب بود)؛ اگر بیلد ۱.۴.۱۵ را نصب نکرده‌اید مشکلی نیست — این نسخه مستقیم روی ۱.۴.۱۴/۱۳ هم نصب می‌شود.
- نصب روی ۱.۴.۱۵ / ۱.۴.۱۴ / ۱.۴.۱۳ بدون حذف انجام می‌شود (همان کلید امضا).
- «کیف پول بلاکچین» فقط خواندنی است: فقط آدرس عمومی ذخیره می‌شود (روی حافظه دستگاه) و هیچ کلید خصوصی/عبارت بازیابی از کاربر خواسته نمی‌شود.
