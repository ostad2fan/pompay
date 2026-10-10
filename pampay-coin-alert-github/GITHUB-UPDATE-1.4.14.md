# راهنمای آپلود نسخه ۱.۴.۱۴ روی گیتهاب

این فایل‌ها نسبت به نسخه ۱.۴.۱۳ تغییر کرده‌اند (۱۲ فایل + این راهنما):

```
app.json                                    (نسخه 1.4.14 / code 19)
apk/version.json                            (1.4.14/19 + لینک APK جدید)
apk/PampDumpCoins-v1.4.14.apk               (فایل نصبی جدید)
apk/PampDumpCoins-latest.apk                (همان فایل با نام latest)
CHANGES-1.4.14.md                            (گزارش تغییرات)
app/(tabs)/wallet/index.tsx                  (سه تب بالای مدیریت دارایی + بیت‌پرپ جدید)
components/LocalAssetsSection.tsx            (کارت سود/زیان ۷/۳۰/۹۰/۱۸۰ روزه)
components/GoldPredictionSection.tsx         (جدید — تب پیش‌بینی قیمت طلا)
utils/bitperpApi.ts                          (رفع باگ دارایی‌های جدید بیت‌پرپ)
utils/iranMarketApi.ts                        (رفع واحد ریال/تومان + زنجیره دریافت)
utils/tgjuHistoryApi.ts                       (جدید — تاریخچه قیمت برای PnL)
utils/imeFuturesApi.ts                        (جدید — داده آتی IME)
```

## مراحل
1. زیپ `pompay-github-v1.4.14-update.zip` را باز کنید — پوشه `pampay-coin-alert-github` را می‌بینید.
2. در ریپو `ostad2fan/pompay` روی «Add file → Upload files» بزنید.
3. محتویات پوشه را (خود پوشه را نه، فایل‌های داخلش با ساختار کامل مسیر) درگ کنید — فایل‌های هم‌نام Replace می‌شوند.
4. Commit message: `v1.4.14`
5. بعد از آپلود بررسی کنید:
   - `https://raw.githubusercontent.com/ostad2fan/pompay/main/pampay-coin-alert-github/apk/version.json` باید 1.4.14/19 نشان دهد.
   - آپدیت داخل خود اپ (تنظیمات → بررسی آپدیت) نسخه جدید را پیدا می‌کند.

## نکته
- این نسخه فقط اپ است — تغییری در سرور Railway لازم نیست (بدون ری‌دیپلوی هم کار می‌کند).
- نصب روی ۱.۴.۱۳ بدون حذف انجام می‌شود (همان کلید امضا).
