# راهنمای به‌روزرسانی گیت‌هاب — نسخه ۱.۴.۱۷

## فایل‌هایی که باید در گیت‌هاب جایگزین شوند
(در مخزن `ostad2fan/pompay` داخل پوشه `pampay-coin-alert-github/`)

```
app.json                                          (version 1.4.17 / versionCode 22)
apk/version.json                                  (1.4.17 + لینک APK جدید)
apk/PampDumpCoins-v1.4.17.apk                     (فایل APK جدید — جایگزین قبلی)
apk/PampDumpCoins-latest.apk                      (همان APK جدید با نام latest)
utils/blockchainWallets.ts                        (بازنویسی‌شده)
utils/blockchainWalletApi.ts                      (بازنویسی‌شده)
components/BlockchainWalletsSection.tsx           (بازنویسی‌شده)
app/(tabs)/wallet/index.tsx                       (به‌روزرسانی‌شده)
utils/appUpdate.ts                                (1.4.17/22)
CHANGES-1.4.17.md                                 (جدید)
GITHUB-UPDATE-1.4.17.md                           (همین فایل)
```

## مراحل
1. وارد مخزن `ostad2fan/pompay` شوید.
2. پوشه `pampay-coin-alert-github` را باز کنید.
3. فایل‌های بالا را با نسخه‌های جدید جایگزین کنید (Upload file / Replace).
   - داخل پوشه `app/(tabs)/wallet/` فایل `index.tsx` را جایگزین کنید.
   - APK قدیمی `PampDumpCoins-v1.4.16.apk` را می‌توانید حذف کنید تا حجم مخزن کم بماند.
   ⚠️ حجم هر فایل باید زیر ۲۵ مگابایت باشد (APK حدود ۱۷.۴ مگابایت است — اوکی).
4. بعد از آپلود، لینک زیر باید JSON نسخه ۱.۴.۱۷ را برگرداند:
   `https://raw.githubusercontent.com/ostad2fan/pompay/main/pampay-coin-alert-github/apk/version.json`
5. داخل برنامه: تنظیمات ← «بررسی به‌روزرسانی» ← دانلود و نصب (روی نسخه قبلی بدون حذف نصب می‌شود).

## نکته مهم
فایل `version.json` حتماً باید قبل از APK آپلود/هم‌زمان شود تا به‌روزرسان داخلی درست کار کند.
لینک apkUrl در version.json به jsdelivr اشاره می‌کند (CDN گیت‌هاب) — بعد از آپلود چند دقیقه طول می‌کشد تا CDN تازه شود.
