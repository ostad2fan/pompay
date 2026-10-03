# راهنمای آپلود نسخه ۱.۴.۱۰ در گیت‌هاب

این نسخه روی ۱.۴.۹ ساخته شده و همان کلید امضا را دارد → **نصب روی ۱.۴.۹ / ۱.۴.۸ / ۱.۴.۵ بدون حذف نسخه قبلی**.

## فایل‌هایی که باید در گیت‌هاب عوض/اضافه شوند (۱۶ فایل)

مسیرها نسبت به ریشه مخزن (همان‌جایی که پوشه `pampay-coin-alert-github` قرار دارد، داخل همین پوشه آپلود کنید):

| # | فایل | وضعیت |
|---|------|--------|
| 1 | `pampay-coin-alert-github/apk/version.json` | عوض شود |
| 2 | `pampay-coin-alert-github/apk/PampDumpCoins-v1.4.10.apk` | **جدید — حتماً آپلود شود** |
| 3 | `pampay-coin-alert-github/apk/PampDumpCoins-latest.apk` | عوض شود (همان فایل ۱.۴.۱۰) |
| 4 | `pampay-coin-alert-github/app.json` | عوض شود |
| 5 | `pampay-coin-alert-github/app/(tabs)/_layout.tsx` | عوض شود |
| 6 | `pampay-coin-alert-github/app/(tabs)/settings/index.tsx` | عوض شود |
| 7 | `pampay-coin-alert-github/app/(tabs)/wallet/index.tsx` | عوض شود |
| 8 | `pampay-coin-alert-github/components/UpdateBanner.tsx` | عوض شود |
| 9 | `pampay-coin-alert-github/utils/exchangeClock.ts` | **جدید** |
| 10 | `pampay-coin-alert-github/utils/appUpdate.ts` | عوض شود |
| 11 | `pampay-coin-alert-github/utils/foreignExchangeBalances.ts` | عوض شود |
| 12 | `pampay-coin-alert-github/utils/foreignExchangePnl.ts` | عوض شود |
| 13 | `pampay-coin-alert-github/server/src/index.ts` | عوض شود (ریلوی خودش دوباره دیپلوی می‌شود) |
| 14 | `pampay-coin-alert-github/scripts/patch_android.py` | عوض شود |
| 15 | `pampay-coin-alert-github/scripts/build-apk-local.sh` | عوض شود |
| 16 | `pampay-coin-alert-github/CHANGES-1.4.10.md` | جدید |

## مراحل

1. وارد مخزن `ostad2fan/pompay` شوید.
2. فایل‌های بالا را با دکمه **Add file → Upload files** بکشید و رهای کنید (پوشه‌ها خودکار ساخته می‌شوند؛ فقط داخل مسیر درست باشند).
3. **هر دو فایل APK** را آپلود کنید (نسخه‌دار + latest). اگر سایت گیت‌هاب روی یکی خطای «too large» داد، فایل ۲۰ مگابایتی است — چند ثانیه صبر کنید و دوباره امتحان کنید؛ حتماً هر دو باید بالا بروند چون برنامه‌های قدیمی به `PampDumpCoins-latest.apk` و برنامه‌های جدید به `PampDumpCoins-v1.4.10.apk` نگاه می‌کنند.
4. Commit بزنید.
5. بعد از آپلود، این لینک باید نسخه ۱.۴.۱۰ را نشان دهد (۱-۲ دقیقه طول می‌کشد):
   `https://raw.githubusercontent.com/ostad2fan/pompay/main/pampay-coin-alert-github/apk/version.json`
6. سرور ریلوی هم بعد از آپلود `server/src/index.ts` خودش ری‌دیپلوی می‌شود (۲-۳ دقیقه) — مسیر بررسی از طریق سرور برنامه هم به‌روز می‌شود.

## بعد از آپلود

- داخل برنامه (۱.۴.۹ یا قدیمی‌تر) → تنظیمات → «بررسی نسخه جدید» → دکمه «بروزرسانی به 1.4.10» فعال می‌شود.
- روی دکمه دانلود، شماره نسخه و نام فایل (`PampDumpCoins-v1.4.10.apk`) نوشته شده — همیشه همین فایل دانلود می‌شود (آدرس‌ها کش‌شکن دارند و دیگر هرگز نسخه قدیمی از کش مرورگر نمی‌آید).

## نکته مهم درباره ساعت گوشی

خطای 700003 مکسی و «موجودی یافت نشد» بایننس ریشه ساعتی داشت. برنامه حالا ساعت را از خود صرافی‌ها می‌گیرد، ولی برای اطمینان در تنظیمات گوشی: **تنظیمات → تاریخ و ساعت → خودکار (Automatic date & time) روشن** باشد.
