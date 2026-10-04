# آپلود نسخه ۱.۴.۱۱ در گیت‌هاب (بروزرسانی درون‌برنامه‌ای)

برای اینکه دکمه «دانلود» داخل برنامه نسخه ۱.۴.۱۱ را بیاورد، این فایل‌ها باید در مخزن
`github.com/ostad2fan/pompay` (شاخه `main`، داخل پوشه `pampay-coin-alert-github`) قرار بگیرند.

## فایل‌های APK (هر دو)

| فایل | مسیر مقصد در مخزن |
|------|-------------------|
| `PampDumpCoins-v1.4.11.apk` | `pampay-coin-alert-github/apk/PampDumpCoins-v1.4.11.apk` |
| `PampDumpCoins-latest.apk` | `pampay-coin-alert-github/apk/PampDumpCoins-latest.apk` |

- فایل نسخه‌دار، فایل اصلی دانلود است (آدرس تازه = هیچ‌وقت با کش مرورگر نسخه قدیمی برنمی‌گردد).
- فایل `latest` برای نسخه‌های خیلی قدیمیِ نصب‌شده روی گوشی‌ها به‌عنوان فول‌بک می‌ماند.

## فایل‌های تغییر یافته (نسبت به ۱.۴.۱۰)

این فایل‌ها عیناً همان نسخه ساخته‌شده در ۱.۴.۱۱ هستند و اگر مخزن را با پوشه کامل جایگزین کنید نیازی به تک‌تک آپلود نیست:

```
pampay-coin-alert-github/app.json                          (version 1.4.11, versionCode 16)
pampay-coin-alert-github/apk/version.json                  (latestVersion 1.4.11)
pampay-coin-alert-github/apk/PampDumpCoins-v1.4.11.apk     (جدید)
pampay-coin-alert-github/apk/PampDumpCoins-latest.apk      (همان فایل ۱.۴.۱۱)
pampay-coin-alert-github/utils/appUpdate.ts                (APP_VERSION 1.4.11)
pampay-coin-alert-github/app/+native-intent.tsx            (رفع کرش: «/» → «/settings»)
pampay-coin-alert-github/app/(tabs)/_layout.tsx            (رفع کرش: حذف router.replace استارتاپ + initialRouteName)
pampay-coin-alert-github/app/(tabs)/whales/index.tsx       (ناوبری درست)
pampay-coin-alert-github/app/(tabs)/whales/wallet-detail.tsx (ناوبری درست)
pampay-coin-alert-github/app/(tabs)/meme-scanner/index.tsx (ناوبری درست)
pampay-coin-alert-github/app/(tabs)/trade-ai/index.tsx     (ناوبری درست)
pampay-coin-alert-github/CHANGES-1.4.11.md                 (گزارش تغییرات)
pampay-coin-alert-github/GITHUB-UPDATE-1.4.11.md           (همین فایل)
```

## بعد از آپلود، این آدرس‌ها باید درست جواب بدهند

1. `https://raw.githubusercontent.com/ostad2fan/pompay/main/pampay-coin-alert-github/apk/version.json`
   → باید `latestVersion: 1.4.11` نشان بدهد.
2. `https://cdn.jsdelivr.net/gh/ostad2fan/pompay@main/pampay-coin-alert-github/apk/PampDumpCoins-v1.4.11.apk`
   → باید دانلود شروع شود (jsDelivr ممکن است چند دقیقه تا آینه‌سازی طول بکشد).

## نکته‌ها

- کلید امضا همان نسل ۴ است → نصب روی ۱.۴.۱۰ / ۱.۴.۹ / ۱.۴.۸ بدون حذف انجام می‌شود.
- اگر گوشی روی ۱.۴.۱۰ کرش می‌کند: فایل ۱.۴.۱۱ را از تلگرام/لینک مستقیم نصب کنید (روی همان نسخه، بدون حذف).
- سرور Railway نیازی به تغییر ندارد.
