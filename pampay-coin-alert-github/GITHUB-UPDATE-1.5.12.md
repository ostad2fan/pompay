# GITHUB-UPDATE-1.5.12 — راهنمای آپلود نسخه ۱.۵.۱۲

> مثل ۱.۵.۱۱: فایل‌های zip **دقیقاً با همان ساختار پوشه‌های پروژه** ساخته شده‌اند —
> هر فایل داخل پوشه‌ی خودش (`app/(tabs)/...`، `utils/`، `server/src/` و …). فقط
> محتویات zip را روی پوشه‌ی `pampay-coin-alert-github` مخزن GitHub **جایگزین**
> کنید (کپی + Replace) — فایل‌ها خودشان سر جای درست می‌نشینند.

## فایل‌های تغییرکرده نسبت به ۱.۵.۱۱

مسیرها نسبت به ریشه‌ی `pampay-coin-alert-github/`:

1. `app.json` — نسخه 1.5.12 / versionCode 37
2. `apk/version.json` — latestVersion 1.5.12 / 37 + apkUrl جدید (jsdelivr)
3. `apk/PampDumpCoins-v1.5.12.apk` — بیلد امضاشده (نصب روی ۱.۵.۱۱ بدون حذف)
4. `CHANGES-1.5.12.md` — گزارش کامل تغییرات این نسخه
5. `utils/lastTab.ts` — **فایل جدید**: ذخیره/بازیابی آخرین تب (کش هم‌زمان + دیسک)
6. `app/(tabs)/_layout.tsx` — بازیابی آخرین تب هنگام باز شدن برنامه؛ حذف هر سه
   لایه‌ی اجبار به «تنظیمات» (۱.۲ ثانیه / ۵ ثانیه بک‌گراند / AppState)
7. `app/+native-intent.tsx` — شروع سرد روی «/» → آخرین تب (فول‌بک: تنظیمات)
8. `components/AutoTradingBotSection.tsx` — تقویم ۳۰ روزه + عکس تقویم؛ سود بخش
   بسته‌شده روی پوزیشن باز؛ فاندینگ/کارمزد در پوزیشن باز و تاریخچه؛ PDF با سقف
   ۸۰۰ ردیف + fullStats + فول‌بک خلاصه‌ی تضمینی
9. `utils/backtestPdf.ts` — fullStats + truncatedNote + feesText + اصلاح حلقه‌ی جدول
10. `utils/autoTradingEngine.ts` — فیلد `partialRealizedPnl` (دمو + واقعی، انباشت
    در برداشت جزئی)
11. `utils/binanceFuturesTrading.ts` — API جدید درآمد بایننس: `fetchIncomeRows` +
    `summarizeFeesForPosition` (فاندینگ/کارمزد هر پوزیشن، کش ۶۰ ثانیه)
12. `utils/iranMarketApi.ts` — `goldOunceUsd` (انس جهانی طلا از TGJU نماد `ons`) +
    کش v2
13. `components/LocalAssetsSection.tsx` — چیپ «انس جهانی طلا ($)» + فونت بزرگ‌تر
    قیمت‌های لحظه‌ای (۱۴.۵)
14. `app/(tabs)/wallet/index.tsx` — بازه‌ی «امروز» در PnL دوره‌ای صرافی‌ها +
    تابع واحد `periodStartMs`
15. `utils/blockchainWalletApi.ts` + `components/BlockchainWalletsSection.tsx` —
    بازه‌ی «امروز» در PnL بلاکچین
16. `utils/hyperliquidApi.ts` + `app/(tabs)/whales/wallet-detail.tsx` +
    `app/(tabs)/wallet/wallet-detail.tsx` — چیپ «امروز» در PnL نهنگ‌ها
17. `server/src/backtestEngine.ts` — پاریتی سرور: `partialRealizedPnl` در
    اینترفیس/sanitize/برداشت جزئی دمو و واقعی
18. `scripts/test-v1512.cjs` — تست‌های smoke این نسخه (۱۳/۱۳ PASS)

## مراحل کامل

1. فایل `pompay-github-v1.5.12-update.zip` را باز کنید — پوشه‌ی
   `pampay-coin-alert-github` داخلش با همین ساختارِ مخزن است.
2. همه‌ی فایل‌ها/پوشه‌های داخلش را روی GitHub (مخزن `ostad2fan/pompay` ← پوشه‌ی
   `pampay-coin-alert-github`) جایگزین کنید (Replace) — شامل
   `apk/PampDumpCoins-v1.5.12.apk`.
3. فایل قدیمی `apk/PampDumpCoins-v1.5.11.apk` را می‌توانید حذف کنید (آپدیتر
   فقط به v1.5.12 اشاره می‌کند).
4. ⚠ **Railway را حتماً redeploy کنید** — `server/src/backtestEngine.ts` این
   نسخه فیلد جدید `partialRealizedPnl` را روی پوزیشن‌های باز انباشته می‌کند؛
   تا redeploy نشود «سود بخش بسته‌شده» فقط بعد از بسته‌شدن در گوشی (نه سرور)
   دیده می‌شود و sync ممکن است آن را پاک کند.
5. بعد از آپلود، این آدرس باید 1.5.12 / 37 را نشان دهد:
   `https://cdn.jsdelivr.net/gh/ostad2fan/pompay@main/pampay-coin-alert-github/apk/version.json`
   (اگر کش jsdelivr قدیمی بود، چند دقیقه صبر کنید — CDN خودش به‌روز می‌شود.)
6. نصب روی گوشی: `PampDumpCoins-v1.5.12.apk` را **روی نسخه قبل نصب کنید**
   (بدون حذف) — امضای دیجیتال یکسان است.
