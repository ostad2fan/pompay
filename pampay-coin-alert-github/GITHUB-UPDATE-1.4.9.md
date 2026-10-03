# راهنمای به‌روزرسانی گیت‌هاب به نسخه ۱.۴.۹

مخزن شما الان نسخه ۱.۴.۸ را دارد — **این ۲۱ فایل** را جایگزین/اضافه کنید.

## روش آپلود

1. گیت‌هاب → مخزن `ostad2fan/pompay` → پوشه `pampay-coin-alert-github` → زیرپوشه مربوط به هر فایل را باز کنید.
2. **Add file → Upload files** → فایل‌ها را بکشید → **Commit changes**.
3. برای فایل‌های داخل زیرپوشه‌ها، اول داخل همان زیرپوشه بروید (مثلا `utils/` برای فایل‌های utils).

## فایل‌های تغییر یافته (۲۱)

| فایل | تغییر |
|---|---|
| `README.md` | بخش تغییرات ۱.۴.۹ |
| `CHANGES-1.4.9.md` | **جدید** — گزارش کامل فارسی |
| `app.json` | version 1.4.9 / versionCode 14 |
| `utils/appUpdate.ts` | نسخه ۱.۴.۹ / کد ۱۴ |
| `apk/version.json` | 1.4.9 / 14 + توضیحات |
| `apk/PampDumpCoins-latest.apk` | **APK جدید** (نصب روی ۱.۴.۸ بدون حذف) |
| `app/(tabs)/wallet/index.tsx` | درخواست پله‌ای + تلاش مجدد تاخیری + هشدار صرافی گم‌شده در مجموع + PnL اسپات موازی + بیت‌پرپ perpetual_balance + فیلتر ۵ سنت |
| `utils/bitperpApi.ts` | کد -۱ = داده معتبر + perpetual_balance + رشته‌ها + آستانه صفر |
| `utils/foreignExchangeBalances.ts` | بیتگت فیوچرز (mix) + XT v4 کامل + رفع نقشه قیمت |
| `scripts/patch_android.py` + `scripts/patch_gradle_ram.py` | بیلد محلی (اگر از قبل ندارید) |
| `docs/02-BUILD-APK.md` | مسیرهای toolchain ماندگار (به‌روز) |

## بعد از آپلود

1. `https://raw.githubusercontent.com/ostad2fan/pompay/main/pampay-coin-alert-github/apk/version.json` باید ۱.۴.۹ نشان دهد.
2. کش jsDelivr را خالی کنید: https://www.jsdelivr.com/tools/purge با آدرس version.json
3. سرور Railway نیازی به Redeploy ندارد (کد سرور تغییر نکرد).
