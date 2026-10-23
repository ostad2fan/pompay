# GITHUB-UPDATE — v1.5.10 (versionCode 35)

این فایل را بعد از آپلود zip در مخزن نگه ندارید — فقط مراحل را انجام دهید.

## مراحل آپلود (مخزن `ostad2fan/pompay` ← پوشه `pampay-coin-alert-github`)

۱. محتوای zip آپدیت را دقیقاً روی همان مسیرها جایگزین کنید (فایل‌های تغییر یافته):

```
app.json
app/(tabs)/settings/index.tsx
components/AutoTradingBotSection.tsx
utils/appUpdate.ts
utils/backtestPdf.ts
apk/version.json
apk/PampDumpCoins-v1.5.10.apk          ← فایل جدید (⚠️ حتماً!)
server/src/index.ts                    ← ⚠️ کد سرور — Railway حتماً redeploy
CHANGES-1.5.10.md                        ← فایل جدید
```

۲. **قدم اضافه (۱ دقیقه):** فایل `apk/PampDumpCoins-v1.5.10.apk` را یک کپی بگیرید و اسم کپی را بگذارید `PampDumpCoins-latest.apk` — سپس آن را هم در همان پوشه `apk` آپلود کنید تا `latest` قدیمی جایگزین شود.

> چرا این قدم؟ در آپلودهای ۱.۵.۷ / ۱.۵.۸ / ۱.۵.۹ فقط فایل latest آپلود شده بود و فایل نسخه‌دار نبود → لینک دانلودِ داخل برنامه 404 می‌داد.
> برنامه‌ی خودِ ۱.۵.۱۰ دیگر مشکلی ندارد (اگر نسخه‌دار نبود خودکار latest را پیدا می‌کند)، ولی نسخه‌های قدیمی‌تر هنوز به فایل نسخه‌دار نیاز دارند — و latest هم همیشه بروز می‌ماند.

۳. فایل APK قدیمی اگر با اسم نسخه‌ی قبل (`PampDumpCoins-v1.5.9.apk` و قدیمی‌ترها) در مخزن بود حذف کنید (فقط `PampDumpCoins-v1.5.10.apk` + `PampDumpCoins-latest.apk` بماند).

۴. **Railway را حتماً دوباره deploy کنید** (Deploy latest commit):
   - بدون redeploy: بیدارماندن سرور (keep-alive هر ۴ دقیقه — جلوگیری از خواب Railway و قطع نشدن اعلان‌های برنامه‌ی بسته) فعال نمی‌شود.

۵. بعد از آپلود این آدرس را چک کنید:
```
https://raw.githubusercontent.com/ostad2fan/pompay/main/pampay-coin-alert-github/apk/version.json
```
باید 1.5.10 / 35 نشان بدهد. و لینک دانلود آن باید 200 بدهد:
```
https://cdn.jsdelivr.net/gh/ostad2fan/pompay@main/pampay-coin-alert-github/apk/PampDumpCoins-v1.5.10.apk
```
(اگر 404 داد یعنی فایل نسخه‌دار آپلود نشده — مرحله ۱ را کامل کنید.)

۶. (تست پیشنهادی) در برنامه: بک‌تست ← تاریخچه ← بازه «۷ روز» ← دکمه «PDF» — باید جدول ریز همه معاملات با ستون «قیمت خروج» ساخته شود.
